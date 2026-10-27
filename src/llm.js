'use strict';

/**
 * LLM-backed action proposer for OneKey.
 *
 * When the fast regex parser cannot recognise a transcript, this module sends
 * the text to an LLM (OpenAI-compatible or Anthropic) and asks it to return a
 * JSON array of validated action objects.
 *
 * Supported providers:
 *   - "openai"    → OpenAI, Groq, local Ollama, or any OpenAI-compatible API.
 *   - "anthropic" → Anthropic Claude API.
 *
 * Configuration lives in `settings.llm`:
 *   { provider, apiKey, model, baseUrl, enabled }
 */

const { SPECS } = require('./schema');

// ---------------------------------------------------------------------------
// System prompt generation — always in sync with the action schema
// ---------------------------------------------------------------------------

function buildSystemPrompt() {
  const types = Object.entries(SPECS)
    .map(([type, fields]) => {
      const f = fields.length ? `  fields: ${fields.join(', ')}` : '  (no extra fields)';
      return `- ${type}\n${f}`;
    })
    .join('\n');

  return [
    'You are a desktop-automation command parser for OneKey.',
    'Given a natural-language transcript, return a JSON array of action objects.',
    'Each object MUST have a "type" field matching one of the allowed types below,',
    'plus only the listed fields for that type. Return an empty array if the',
    'transcript does not map to any supported action.',
    '',
    'Allowed action types and their fields:',
    types,
    '',
    'Rules:',
    '1. Return ONLY a valid JSON array — no markdown fences, no explanation.',
    '2. Every action object must pass the OneKey schema validator. Do not invent',
    '   new types or add fields that are not listed.',
    '3. For OPEN_URL, include the full URL (with scheme). For app-related types,',
    '   use the closest matching action (LAUNCH_APP for opening by name,',
    '   FOCUS_WINDOW for switching to a window by title, OPEN_APP/FOCUS_APP only',
    '   when an appId is known).',
    '4. For VS_CODE_GOTO_LINE, the "line" field must be a positive integer.',
    '5. For MOUSE_MOVE, use either "position" (center, top-left, etc.) or',
    '   "direction" + "amount", never both.',
    '6. For TYPE_TEXT, preserve the user\'s intended text exactly.',
    '7. If the user\'s intent is ambiguous or unsupported, return [].',
    '8. NEVER return DICTATE_TEXT unless the user explicitly starts their utterance with "ask chatgpt", "tell chatgpt", or "prompt chatgpt". Never use DICTATE_TEXT for control, repeat, or general statements.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Provider-specific API callers
// ---------------------------------------------------------------------------

async function callGemini(transcript, config) {
  let model = (config.model || 'gemini-3.8-flash').replace(/^models\//, '').trim();
  const apiKey = config.apiKey || '';
  const baseUrl = (config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');

  const doFetch = async (targetModel) => {
    const url = `${baseUrl}/models/${encodeURIComponent(targetModel)}:generateContent`;
    const headers = {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    };
    const body = JSON.stringify({
      systemInstruction: {
        parts: [{ text: buildSystemPrompt() }],
      },
      contents: [
        { role: 'user', parts: [{ text: transcript }] },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
    });
    return fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(30000) });
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let res = await doFetch(model);

  // If 503 (high demand) or 429 (rate limit), retry once after a short backoff
  if (res.status === 503 || res.status === 429) {
    await sleep(800);
    res = await doFetch(model);
  }

  // If still unavailable (503/429) or not found (404), failover to high-availability gemini-3.5-flash-lite
  if (!res.ok && (res.status === 503 || res.status === 429 || res.status === 404)) {
    if (model !== 'gemini-3.5-flash-lite') {
      res = await doFetch('gemini-3.5-flash-lite');
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 503) {
      throw new Error('Gemini servers are currently experiencing high demand. Spikes are temporary; please retry in a few seconds.');
    }
    if (res.status === 429) {
      throw new Error('Gemini API rate limit reached. Please wait a moment before trying again.');
    }
    throw new Error(`Gemini API ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = json.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  return parseJsonResponse(content);
}

async function callOpenAI(transcript, config) {
  const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const body = JSON.stringify({
    model: config.model || 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: transcript },
    ],
  });

  const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM API ${res.status}: ${text.slice(0, 200)}`);
  }
  const rawText = await res.text();
  let json;
  try {
    json = JSON.parse(rawText);
  } catch (_) {
    throw new Error(`LLM endpoint returned invalid format: "${rawText.trim().slice(0, 60)}"`);
  }
  const content = json.choices?.[0]?.message?.content || '[]';
  return parseJsonResponse(content);
}

async function callAnthropic(transcript, config) {
  const url = (config.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '') + '/v1/messages';
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey || '',
    'anthropic-version': '2023-06-01',
  };

  const body = JSON.stringify({
    model: config.model || 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: transcript }],
  });

  const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM API ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = json.content?.[0]?.text || '[]';
  return parseJsonResponse(content);
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseJsonResponse(raw) {
  let text = raw.trim();
  // Strip markdown fences if present
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenceMatch) text = fenceMatch[1].trim();
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ask an LLM to propose action objects for a transcript.
 *
 * @param {string}  transcript  The raw user text.
 * @param {object}  _context    Reserved for future enrichment (e.g. recent history).
 * @param {object}  config      `{ provider, apiKey, model, baseUrl, enabled }`.
 * @returns {Promise<object[]>} Array of raw action objects (must still be validated).
 */
async function proposeActions(transcript, _context, config) {
  if (!config || !config.enabled) return [];
  const provider = (config.provider || 'gemini').toLowerCase();
  switch (provider) {
    case 'gemini':
    case 'google':
      return callGemini(transcript, config);
    case 'anthropic':
      return callAnthropic(transcript, config);
    case 'openai':
    default:
      return callOpenAI(transcript, config);
  }
}

module.exports = { proposeActions, buildSystemPrompt, parseJsonResponse };
