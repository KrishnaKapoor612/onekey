'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const { makeDefaults } = require('../src/defaults');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'onekey-')); }

function settingsFor(root) {
  const docs = path.join(root, 'Documents');
  fs.mkdirSync(docs, { recursive: true });
  const s = makeDefaults({ documents: docs, desktop: path.join(root, 'Desktop'), downloads: path.join(root, 'Downloads'), localAppData: root });
  s.autoRunDelayMs = 5000;
  return s;
}

function mockDeps(settings, over = {}) {
  const calls = { keys: [], focus: [], launch: [], open: [], clip: [] };
  let clip = 'orig';
  const deps = {
    fs, getSettings: () => settings, sleep: async () => {},
    launch: async (e, a) => { calls.launch.push([e, a]); },
    openExternal: async (u) => { calls.open.push(u); },
    clipboard: { readText: () => clip, writeText: (t) => { clip = t; calls.clip.push(t); } },
    win: {
      list: async () => ({ ok: true, windows: [{ handle: 1, pid: 1, title: 'ChatGPT - Chrome', active: true }] }),
      focus: async (o) => { calls.focus.push(o); return { ok: true, verified: true, window: { handle: 1, pid: 1, title: 'x', active: true } }; },
      keys: async (o) => { calls.keys.push(o.keys); return { ok: true }; },
    },
    ...over,
  };
  return { deps, calls };
}

function session() {
  let prompt = null; const undo = { item: null };
  return {
    getPendingPrompt: () => prompt, setPendingPrompt: (p) => { prompt = p; },
    getUndoable: () => undo.item, markUndone: () => { undo.item = null; }, _undo: undo,
  };
}

module.exports = { tmp, settingsFor, mockDeps, session };