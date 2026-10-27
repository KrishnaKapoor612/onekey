'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pipeline, replaceLastSentence } = require('../src/pipeline');
const { createStore } = require('../src/store');
const { tmp, settingsFor } = require('./helpers');

function setup() {
  const root = tmp();
  const S = settingsFor(root);
  const store = createStore(root + '-store', S);
  const executed = [];
  const executor = { execute: async (a, session) => { executed.push(a.type); if (a.type === 'DICTATE_TEXT') session.setPendingPrompt({ text: a.text }); return { ok: true, status: 'unverified', message: 'ok' }; } };
  const p = new Pipeline({ store, executor });
  return { p, executed, store };
}

test('unknown commands execute nothing', async () => {
  const { p, executed } = setup();
  await p.submit('delete everything');
  assert.deepEqual(executed, []);
  assert.equal(p.snapshot().status, 'failure');
});

test('spoken cancel prevents a pending action from executing', async () => {
  const { p, executed } = setup();
  await p.submit('go to line 27');
  assert.equal(p.snapshot().status, 'pending');
  await p.submit('cancel');
  assert.equal(p.snapshot().status, 'cancelled');
  assert.deepEqual(executed, []);
  assert.equal(p.pending, null);
});

test('send requires explicit confirmation and a pending prompt', async () => {
  const { p, executed } = setup();
  await p.submit('send');
  assert.deepEqual(executed, [], 'no prompt yet, rejected');
  assert.equal(p.snapshot().status, 'failure');

  p.store.getSettings().autoRunDelayMs = 0; // dictation runs immediately
  await p.submit('Ask ChatGPT: help me, then send it');
  assert.deepEqual(executed, ['DICTATE_TEXT']);
  assert.equal(p.snapshot().pendingPrompt, 'help me, then send it');

  await p.submit('send');
  assert.equal(p.snapshot().pendingMode, 'confirm');
  assert.deepEqual(executed, ['DICTATE_TEXT'], 'not sent before confirmation');
  await p.submit('confirm');
  assert.deepEqual(executed, ['DICTATE_TEXT', 'SEND_PENDING_TEXT']);
});

test('cancel on a pending confirmation never sends', async () => {
  const { p, executed } = setup();
  p.store.getSettings().autoRunDelayMs = 0;
  await p.submit('ask chatgpt hello');
  await p.submit('send');
  await p.submit('cancel');
  assert.deepEqual(executed, ['DICTATE_TEXT']);
});

test('missing folder location asks, then proceeds after the answer', async () => {
  const { p, executed } = setup();
  p.store.getSettings().autoRunDelayMs = 0;
  await p.submit('create a folder called Demo');
  assert.equal(p.snapshot().status, 'clarify');
  assert.deepEqual(executed, []);
  await p.submit('documents');
  assert.deepEqual(executed, ['CREATE_FOLDER']);
});

test('replace last sentence helper', () => {
  assert.equal(replaceLastSentence('First one. Second one.', 'New one.'), 'First one. New one.');
  assert.equal(replaceLastSentence('Only one', 'Other'), 'Other');
});