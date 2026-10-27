'use strict';
const { validateAction, describe, ALIAS_FORBIDDEN } = require('./schema');
const { parseTranscript } = require('./parser');

function normalizePhrase(p) {
  return String(p || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// An alias is a validated sequence of action objects. Never a script.
function validateAliasDef(def, settings, existingAliases) {
  const fail = (error) => ({ ok: false, error });
  if (!def || typeof def !== 'object') return fail('Alias must be an object.');
  const phrase = normalizePhrase(def.phrase);
  if (phrase.length < 2 || phrase.length > 60 || !/^[a-z0-9 '-]+$/.test(phrase)) return fail('Phrase must be 2-60 characters: letters, numbers, spaces, apostrophes, hyphens.');
  if (!Array.isArray(def.actions) || def.actions.length < 1 || def.actions.length > 10) return fail('An alias needs 1-10 actions.');
  const actions = [];
  for (let i = 0; i < def.actions.length; i++) {
    const a = def.actions[i];
    if (a && ALIAS_FORBIDDEN.has(a.type)) return fail(`Step ${i + 1}: ${a.type} is not allowed in aliases.`);
    const v = validateAction(a, settings);
    if (!v.ok) return fail(`Step ${i + 1}: ${v.error || (v.clarify && v.clarify.question)}`);
    actions.push(v.action);
  }
  if ((existingAliases || []).some((e) => normalizePhrase(e.phrase) === phrase)) return fail(`An alias for "${phrase}" already exists (duplicate).`);
  const probe = parseTranscript(phrase, { settings, aliases: [] });
  // LAUNCH_APP / FOCUS_WINDOW are catch-all fallbacks ("open anything"); aliases are matched first, so they may override them.
  const generic = probe.type === 'actions' && probe.actions.length === 1 && ['LAUNCH_APP', 'FOCUS_WINDOW'].includes(probe.actions[0].type);
  if (probe.type !== 'unknown' && !generic) return fail(`"${phrase}" collides with a built-in command; choose a different phrase.`);
  return { ok: true, alias: { phrase, actions }, preview: actions.map((a) => describe(a, settings)) };
}

module.exports = { validateAliasDef, normalizePhrase };