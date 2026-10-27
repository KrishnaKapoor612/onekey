'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createExecutor } = require('../src/executor');
const { tmp, settingsFor, mockDeps, session } = require('./helpers');

function setup(over) {
  const root = tmp();
  const S = settingsFor(root);
  const { deps, calls } = mockDeps(S, over);
  return { S, calls, ex: createExecutor(deps), sess: session() };
}

test('creates a folder and never overwrites an existing one', async () => {
  const { S, ex, sess } = setup();
  const act = { type: 'CREATE_FOLDER', name: 'Hackathon Demo', location: 'documents' };
  const r1 = await ex.execute(act, sess);
  const p = path.join(S.approvedLocations.documents, 'Hackathon Demo');
  assert.equal(r1.ok, true);
  assert.ok(fs.statSync(p).isDirectory());
  fs.writeFileSync(path.join(p, 'keep.txt'), 'x');
  const r2 = await ex.execute(act, sess);
  assert.equal(r2.ok, false);
  assert.ok(fs.existsSync(path.join(p, 'keep.txt')));
});

test('undo removes an empty folder but refuses a non-empty one', async () => {
  const { S, ex, sess } = setup();
  const act = { type: 'CREATE_FOLDER', name: 'Temp', location: 'documents' };
  const r = await ex.execute(act, sess);
  sess._undo.item = { id: '1', undo: r.undo };
  fs.writeFileSync(path.join(r.undo.path, 'f.txt'), 'x');
  const refused = await ex.execute({ type: 'UNDO_LAST' }, sess);
  assert.equal(refused.ok, false);
  assert.ok(fs.existsSync(r.undo.path));
  fs.unlinkSync(path.join(r.undo.path, 'f.txt'));
  const done = await ex.execute({ type: 'UNDO_LAST' }, sess);
  assert.equal(done.ok, true);
  assert.equal(fs.existsSync(r.undo.path), false);
});

test('valid URL goes to the browser; unsupported scheme does not', async () => {
  const { ex, calls, sess } = setup();
  assert.equal((await ex.execute({ type: 'OPEN_URL', url: 'github.com' }, sess)).ok, true);
  assert.deepEqual(calls.open, ['https://github.com/']);
  assert.equal((await ex.execute({ type: 'OPEN_URL', url: 'file:///c:/windows/system32/calc.exe' }, sess)).ok, false);
  assert.equal(calls.open.length, 1);
});

test('dictation enters text but never presses Enter, and leaves the prompt pending', async () => {
  const { ex, calls, sess } = setup();
  const r = await ex.execute({ type: 'DICTATE_TEXT', text: 'Please send help' }, sess);
  assert.equal(r.ok, true);
  assert.ok(calls.keys.length >= 2);
  assert.ok(!calls.keys.some((k) => k.includes('ENTER')), 'no Enter pressed');
  assert.equal(sess.getPendingPrompt().text, 'Please send help');
});

test('dictation refuses to type when the assistant tab cannot be confirmed', async () => {
  const win = {
    list: async () => ({ ok: true, windows: [{ handle: 1, pid: 1, title: 'Some other page', active: true }] }),
    focus: async () => ({ ok: true, verified: true }), keys: async () => ({ ok: true }),
  };
  const { ex, sess } = setup({ win });
  const r = await ex.execute({ type: 'DICTATE_TEXT', text: 'hello' }, sess);
  assert.equal(r.ok, false);
  assert.equal(sess.getPendingPrompt(), null);
});

test('send without a pending prompt fails; with one it presses Enter once', async () => {
  const { ex, calls, sess } = setup();
  assert.equal((await ex.execute({ type: 'SEND_PENDING_TEXT' }, sess)).ok, false);
  assert.ok(!calls.keys.some((k) => k.includes('ENTER')));
  sess.setPendingPrompt({ text: 'hi' });
  assert.equal((await ex.execute({ type: 'SEND_PENDING_TEXT' }, sess)).ok, true);
  assert.equal(calls.keys.filter((k) => k === '{ENTER}').length, 1);
  assert.equal(sess.getPendingPrompt(), null);
});

test('VS Code find pastes the query literally via clipboard', async () => {
  const vs = { list: async () => ({ ok: true, windows: [{ handle: 2, pid: 2, title: 'a.js - Visual Studio Code', active: true }] }), focus: async () => ({ ok: true, verified: true }), keys: async () => ({ ok: true }) };
  const { ex, calls, sess } = setup({ win: vs });
  const r = await ex.execute({ type: 'VS_CODE_FIND', query: '$(calc); rm -rf /' }, sess);
  assert.equal(r.ok, true);
  assert.ok(calls.clip.includes('$(calc); rm -rf /'));
});


test('open folder launches explorer for existing approved folder and fails if missing', async () => {
  const { S, ex, calls, sess } = setup();
  const folderPath = path.join(S.approvedLocations.desktop, 'Zigzag Car Adventure');
  fs.mkdirSync(folderPath, { recursive: true });

  const r1 = await ex.execute({ type: 'OPEN_FOLDER', name: 'Zigzag Car Adventure', location: 'desktop' }, sess);
  assert.equal(r1.ok, true);
  assert.equal(calls.launch.length, 1);
  assert.equal(calls.launch[0][0], 'explorer.exe');
  assert.equal(calls.launch[0][1][0], folderPath);

  const r2 = await ex.execute({ type: 'OPEN_FOLDER', name: 'Nonexistent Folder', location: 'desktop' }, sess);
  assert.equal(r2.ok, false);
});
