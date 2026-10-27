'use strict';
const fs = require('fs');
const path = require('path');
const { validateSettings } = require('./schema');

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = isPlain(base[k]) && isPlain(over[k]) ? merge(base[k], over[k]) : over[k];
  }
  return out;
}

function createStore(dir, defaults) {
  fs.mkdirSync(dir, { recursive: true });
  const sp = path.join(dir, 'settings.json');
  const hp = path.join(dir, 'history.json');
  const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fb; } };
  const writeJson = (p, o) => { const t = p + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 2)); fs.renameSync(t, p); };

  let settings = merge(defaults, readJson(sp, {}));
  if (!validateSettings(settings).ok) settings = JSON.parse(JSON.stringify(defaults));
  let history = readJson(hp, []);
  if (!Array.isArray(history)) history = [];

  return {
    getSettings: () => settings,
    saveSettings(patch) {
      const next = merge(settings, patch);
      next.aliases = settings.aliases;
      const v = validateSettings(next);
      if (!v.ok) return v;
      settings = next;
      writeJson(sp, settings);
      return { ok: true };
    },
    setAliases(list) { settings = { ...settings, aliases: list }; writeJson(sp, settings); },
    addHistory(entry) {
      history.unshift(entry);
      history = history.slice(0, 200);
      writeJson(hp, history);
    },
    updateHistory(id, patch) {
      const h = history.find((x) => x.id === id);
      if (h) { Object.assign(h, patch); writeJson(hp, history); }
    },
    getHistory: (n = 50) => history.slice(0, n),
    clearHistory() { history = []; writeJson(hp, history); },
  };
}

module.exports = { createStore };