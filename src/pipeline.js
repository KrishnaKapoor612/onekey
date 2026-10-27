'use strict';
const crypto = require('crypto');
const { validateAction, describe, needsConfirmation } = require('./schema');
const { parseTranscript, normalize } = require('./parser');
const { proposeActions } = require('./llm');

function replaceLastSentence(text, repl) {
  const body = String(text).trimEnd().replace(/[.!?]+$/, '');
  const idx = Math.max(body.lastIndexOf('. '), body.lastIndexOf('! '), body.lastIndexOf('? '));
  const prefix = idx >= 0 ? body.slice(0, idx + 2) : '';
  return prefix + String(repl).trim();
}

class Pipeline {
  constructor(o) {
    this.store = o.store;
    this.executor = o.executor;
    this.onChange = o.onChange || (() => {});
    this.getLLMConfig = o.getLLMConfig || null;
    this.pending = null;
    this.clarification = null;
    this.pendingPrompt = null;
    this.timer = null;
    this.busyFlag = false;
    this.s = { status: 'idle', message: 'Ready.', transcript: '', source: null, preview: [], pendingMode: null, countdownMs: 0, clarificationQuestion: null, pendingPrompt: null, verified: null, lastMessage: '' };
  }

  snapshot() { return { ...this.s, history: this.store.getHistory(30) }; }
  _set(p) { Object.assign(this.s, p); this.onChange(this.snapshot()); }
  setStatus(status, message) { this._set({ status, message }); }
  busy() { return this.busyFlag; }

  get session() {
    return {
      getPendingPrompt: () => this.pendingPrompt,
      setPendingPrompt: (p) => { this.pendingPrompt = p; this.s.pendingPrompt = p ? p.text : null; },
      getUndoable: () => this.store.getHistory(200).find((h) => h.undo && !h.undone) || null,
      markUndone: (id) => this.store.updateHistory(id, { undone: true }),
    };
  }

  _clearTimer() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
  _log(phrase, source, types, status, message, undo) {
    this.store.addHistory({ id: crypto.randomUUID(), time: new Date().toISOString(), source, phrase, actions: types, status, message, ...(undo ? { undo } : {}) });
  }

  async submit(raw, source = 'typed') {
    const text = String(raw || '').trim().slice(0, 1000);
    if (!text) return;
    this._set({ transcript: text, source });
    const settings = this.store.getSettings();
    const ctx = { settings, aliases: settings.aliases || [] };
    const intent = parseTranscript(text, ctx);
    if (intent.type === 'control') return this._control(intent, text, source);
    if (this.pending) {
      this._set({ message: 'An action is waiting. Confirm or say Cancel.' });
      return;
    }
    if (this.clarification) return this._answer(text, source, settings);
    return this._handle(intent, text, source);
  }

  async _handle(intent, text, source) {
    if (intent.type === 'unknown') {
      // LLM fallback: try to parse via configured LLM
      const settings = this.store.getSettings();
      const llmConfig = this.getLLMConfig ? this.getLLMConfig() : (settings.llm || {});
      if (llmConfig.enabled) {
        try {
          this._set({ status: 'executing', message: 'Parsing with AI…' });
          const proposed = await proposeActions(text, {}, llmConfig);
          if (proposed.length > 0) {
            // Validate each proposed action
            const validated = [];
            for (const raw of proposed) {
              const v = validateAction(raw, settings);
              if (v.ok) validated.push(v.action);
            }
            if (validated.length > 0) {
              return this._plan(validated, text, source);
            }
          }
        } catch (err) {
          console.error('LLM fallback error:', err.message);
          return this._reject(text, source, err.message);
        }
      }
      return this._reject(text, source, 'Not a supported command. Nothing was executed.');
    }
    if (intent.type === 'clarify') return this._askClarify({ ...intent.clarify }, text, source);
    return this._plan(intent.actions, text, source);
  }

  _reject(text, source, message) {
    this._log(text, source, [], 'rejected', message);
    this._set({ status: 'failure', message, preview: [], pendingMode: null, verified: null, lastMessage: message });
  }

  _askClarify(c, text, source) {
    this.clarification = { ...c, phrase: text, source };
    this._set({ status: 'clarify', message: c.question, clarificationQuestion: c.question, preview: [] });
  }

  _plan(actions, text, source) {
    const settings = this.store.getSettings();
    const checked = [];
    let hasPrompt = !!this.pendingPrompt;
    for (let i = 0; i < actions.length; i++) {
      const v = validateAction(actions[i], settings);
      if (!v.ok) {
        if (v.clarify) return this._askClarify({ ...v.clarify, actions, index: i }, text, source);
        return this._reject(text, source, v.error);
      }
      const t = v.action.type;
      if (t === 'DICTATE_TEXT') hasPrompt = true;
      if ((t === 'SEND_PENDING_TEXT' || t === 'CLEAR_PENDING_TEXT') && !hasPrompt) {
        return this._reject(text, source, 'There is no pending prompt. Dictate one first ("Ask ChatGPT: …").');
      }
      checked.push(v.action);
    }
    const preview = checked.map((a) => describe(a, settings, this.pendingPrompt));
    const mode = needsConfirmation(checked) || settings.confirmAll ? 'confirm' : 'countdown';
    if (mode === 'countdown' && settings.autoRunDelayMs <= 0) {
      this._set({ preview });
      return this._execute(checked, text, source);
    }
    this.pending = { actions: checked, phrase: text, source, mode };
    this._clearTimer();
    if (mode === 'countdown') {
      this.timer = setTimeout(() => this._runPending(), settings.autoRunDelayMs);
      if (this.timer.unref) this.timer.unref();
    }
    const msg = mode === 'confirm' ? 'Confirmation required. Say "confirm" or "cancel", or use the buttons.' : `Running in ${(settings.autoRunDelayMs / 1000).toFixed(1)} s. Cancel to stop.`;
    this._set({ status: 'pending', message: msg, preview, pendingMode: mode, countdownMs: mode === 'countdown' ? settings.autoRunDelayMs : 0, clarificationQuestion: null });
  }

  async _runPending() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this._clearTimer();
    await this._execute(p.actions, p.phrase, p.source);
  }
  async confirmPending() {
    if (this.pending) return this._runPending();
    this._set({ message: 'Nothing is waiting for confirmation.' });
  }
  cancelPending() { return this._cancel(); }

  _cancel() {
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      this._clearTimer();
      this._log(p.phrase, p.source, p.actions.map((a) => a.type), 'cancelled', 'Cancelled before execution.');
      const msg = 'Cancelled. Nothing was executed.';
      this._set({ status: 'cancelled', message: msg, preview: [], pendingMode: null, countdownMs: 0, lastMessage: msg });
    } else if (this.clarification) {
      this.clarification = null;
      const msg = 'Cancelled.';
      this._set({ status: 'cancelled', message: msg, clarificationQuestion: null, lastMessage: msg });
    } else if (this.pendingPrompt) {
      this.session.setPendingPrompt(null);
      const msg = 'Pending prompt cancelled; Wispr Flow will not send it. The text may still be in the composer; clear it there yourself.';
      this._set({ status: 'cancelled', message: msg, lastMessage: msg });
    } else {
      const msg = 'Nothing to cancel.';
      this._set({ message: msg, lastMessage: msg });
    }
  }

  async _control(intent, text, source) {
    switch (intent.name) {
      case 'cancel': return this._cancel();
      case 'stop_listening':
        return this._set({ status: 'idle', message: 'Stopped listening.', stopListening: true });
      case 'clear':
        if (this.pendingPrompt) return this._plan([{ type: 'CLEAR_PENDING_TEXT' }], text, source);
        if (this.pending) return this._cancel();
        return this._set({ status: 'idle', message: 'Input cleared.', clearInput: true });
      case 'undo': return this._plan([{ type: 'UNDO_LAST' }], text, source);
      case 'confirm':
        if (this.pending) return this._runPending();
        return this._set({ message: 'Nothing is waiting for confirmation.' });
      case 'replace_last_sentence': {
        if (this.pendingPrompt) {
          const next = replaceLastSentence(this.pendingPrompt.text, intent.text);
          return this._plan([{ type: 'CLEAR_PENDING_TEXT' }, { type: 'DICTATE_TEXT', text: next }], text, source);
        }
        return this._plan([{ type: 'PRESS_KEYS', keys: '^a' }, { type: 'TYPE_TEXT', text: intent.text }], text, source);
      }
      default: return;
    }
  }

  async _answer(text, source, settings) {
    const c = this.clarification;
    const t = normalize(text);
    const reask = (msg) => { this._set({ status: 'clarify', message: msg }); };
    if (c.kind === 'folder_name') {
      this.clarification = null;
      const actions = c.actions.slice(); actions[c.index] = { ...actions[c.index], name: text };
      return this._plan(actions, c.phrase, source);
    }
    if (c.kind === 'folder_location') {
      const key = t.replace(/^(in |the |my )+/, '').replace(/ folder$/, '');
      if (!c.options.includes(key)) return reask(`Please choose one of: ${c.options.join(', ')}.`);
      this.clarification = null;
      const actions = c.actions.slice(); actions[c.index] = { ...actions[c.index], location: key };
      return this._plan(actions, c.phrase, source);
    }
    if (c.kind === 'app') {
      const apps = settings.apps;
      const n = parseInt(t, 10);
      const id = (Number.isInteger(n) && c.options[n - 1]) || c.options.find((i) => normalize(apps[i].label) === t || apps[i].aliases.some((x) => normalize(x) === t) || normalize(apps[i].label).includes(t));
      if (!id) return reask(c.question);
      this.clarification = null;
      return this._plan([{ type: c.baseType, appId: id }], c.phrase, source);
    }
    if (c.kind === 'window') {
      const n = parseInt(t, 10);
      const w = (Number.isInteger(n) && c.windows[n - 1]) || c.windows.find((x) => x.title.toLowerCase().includes(t));
      if (!w) return reask(c.question);
      this.clarification = null;
      const rest = c.rest.slice(); rest[0] = { ...rest[0], targetId: w.handle };
      return this._execute(rest, c.phrase, source);
    }
  }

  async _execute(actions, phrase, source) {
    this.busyFlag = true;
    this._clearTimer();
    this.pending = null;
    this._set({ status: 'executing', message: 'Executing…', pendingMode: null, countdownMs: 0 });
    const steps = [];
    let final = 'success';
    let undo = null;
    let choice = null;
    for (let i = 0; i < actions.length; i++) {
      const r = await this.executor.execute(actions[i], this.session);
      steps.push({ type: actions[i].type, status: r.status, message: r.message });
      if (r.undo) undo = r.undo;
      if (r.status === 'needs_choice') { final = 'needs_choice'; choice = { i, windows: r.choices || [] }; break; }
      if (!r.ok) { final = 'failed'; break; }
      if (r.status === 'unverified' && final === 'success') final = 'unverified';
    }
    const last = steps[steps.length - 1];
    let message = steps.map((s) => s.message).join(' ');
    if (final === 'failed' && steps.length > 1) {
      message = `Step ${steps.length} of ${actions.length} failed: ${last.message} Steps 1-${steps.length - 1} had already run.`;
    } else if (final === 'failed' && actions.length > 1) {
      message = `Step 1 of ${actions.length} failed: ${last.message} Nothing else ran.`;
    }
    this._log(phrase, source, actions.map((a) => a.type), final, message, undo);
    this.busyFlag = false;
    if (final === 'needs_choice') {
      const q = `${last.message} Say the number or part of the title: ${choice.windows.map((w, k) => `${k + 1}) ${w.title}`).join('  ')}`;
      this.clarification = { kind: 'window', windows: choice.windows, rest: actions.slice(choice.i), question: q, phrase, source };
      this._set({ status: 'clarify', message: q, clarificationQuestion: q, preview: [], lastMessage: last.message });
      return;
    }
    this._set({ status: final === 'failed' ? 'failure' : 'success', message, verified: final === 'success', lastMessage: message, clarificationQuestion: null });
  }
}

module.exports = { Pipeline, replaceLastSentence };
