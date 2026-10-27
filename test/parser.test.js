'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { parseTranscript } = require('../src/parser');
const { validateAction, normalizeUrl, resolveFolder, isValidKeys } = require('../src/schema');
const { validateAliasDef } = require('../src/aliases');
const { tmp, settingsFor } = require('./helpers');

const S = settingsFor(tmp());
const ctx = { settings: S, aliases: [] };
const parse = (t) => parseTranscript(t, ctx);

test('valid folder command resolves to the approved location', () => {
  const p = parse('Create a folder called Hackathon Demo in Documents.');
  assert.equal(p.type, 'actions');
  assert.deepEqual(p.actions[0], { type: 'CREATE_FOLDER', name: 'Hackathon Demo', location: 'documents' });
  const r = resolveFolder('Hackathon Demo', 'documents', S);
  assert.equal(r.path, path.join(S.approvedLocations.documents, 'Hackathon Demo'));
});

test('missing destination triggers clarification', () => {
  const p = parse('create a folder called Demo');
  const v = validateAction(p.actions[0], S);
  assert.equal(v.ok, false);
  assert.equal(v.clarify.kind, 'folder_location');
});

test('path traversal and unsafe names are rejected', () => {
  for (const name of ['..', '../x', '..\\x', 'a/b', 'C:\\x', 'con', 'x.', 'a|b']) {
    assert.equal(validateAction({ type: 'CREATE_FOLDER', name, location: 'documents' }, S).ok, false, name);
  }
  assert.equal(validateAction({ type: 'CREATE_FOLDER', name: 'ok', location: 'system32' }, S).ok, false);
});

test('URLs: https added, unsupported schemes rejected', () => {
  assert.equal(normalizeUrl('github.com').url, 'https://github.com/');
  for (const u of ['javascript:alert(1)', 'file:///c:/x', 'ms-msdt:foo', 'mailto:a@b.co', 'https://user:pw@x.com']) {
    assert.equal(normalizeUrl(u).ok, false, u);
  }
  const p = parse('go to github dot com');
  assert.equal(validateAction(p.actions[0], S).action.url, 'https://github.com/');
});

test('dictated prompt containing "send" stays a dictation', () => {
  const p = parse('Ask ChatGPT: please send me an example, then send it again');
  assert.equal(p.actions.length, 1);
  assert.equal(p.actions[0].type, 'DICTATE_TEXT');
  assert.match(p.actions[0].text, /send me an example/);
});

test('bare "send" parses to SEND_PENDING_TEXT only as a whole utterance', () => {
  assert.equal(parse('send').actions[0].type, 'SEND_PENDING_TEXT');
  assert.equal(parse('send it').actions[0].type, 'SEND_PENDING_TEXT');
  assert.equal(parse('send an email to bob').type, 'unknown');
});

test('invalid line numbers are rejected', () => {
  for (const line of [0, -3, 'abc', 1.5, '27; calc', 99999999999]) {
    assert.equal(validateAction({ type: 'VS_CODE_GOTO_LINE', line }, S).ok, false, String(line));
  }
  assert.equal(validateAction(parse('go to line 27').actions[0], S).action.line, 27);
  assert.equal(validateAction(parse('go to line twenty seven').actions[0], S).action.line, 27);
});

test('search query is literal text', () => {
  const p = parse('Find foo; rm -rf / in the current file');
  assert.equal(p.actions[0].type, 'VS_CODE_FIND');
  assert.equal(validateAction(p.actions[0], S).action.query, 'foo; rm -rf /');
});

test('ambiguous app names trigger clarification', () => {
  const s2 = JSON.parse(JSON.stringify(S));
  s2.apps.insiders = { label: 'VS Code Insiders', aliases: ['code'], processName: 'Code - Insiders', exe: '' };
  const p = parseTranscript('open code', { settings: s2, aliases: [] });
  assert.equal(p.type, 'clarify');
  assert.equal(p.clarify.kind, 'app');
});

test('unknown commands produce no action', () => {
  assert.equal(parse('format my hard drive').type, 'unknown');
  assert.equal(parse('open notepad').actions[0].type, 'LAUNCH_APP'); // resolved against installed apps at run time
});

test('open folder command parses name and location', () => {
  const p1 = parse('Open the Zigzag Car Adventure folder present on the desktop.');
  assert.equal(p1.type, 'actions');
  assert.deepEqual(p1.actions[0], { type: 'OPEN_FOLDER', name: 'Zigzag Car Adventure', location: 'desktop' });

  const p2 = parse('Open the Zigzag Car Adventure folder on the desktop.');
  assert.equal(p2.type, 'actions');
  assert.deepEqual(p2.actions[0], { type: 'OPEN_FOLDER', name: 'Zigzag Car Adventure', location: 'desktop' });

  const p3 = parse('Open folder Hackathon Demo in Documents');
  assert.equal(p3.type, 'actions');
  assert.deepEqual(p3.actions[0], { type: 'OPEN_FOLDER', name: 'Hackathon Demo', location: 'documents' });

  const p4 = parse('Open the Zigzag Car Adventure folder.');
  assert.equal(p4.type, 'actions');
  assert.deepEqual(p4.actions[0], { type: 'OPEN_FOLDER', name: 'Zigzag Car Adventure' });

  const p5 = parse('Open Zigzag Car Adventure on desktop');
  assert.equal(p5.type, 'actions');
  assert.deepEqual(p5.actions[0], { type: 'OPEN_FOLDER', name: 'Zigzag Car Adventure', location: 'desktop' });
});

test('aliases cannot add unsupported actions, shell commands, or extra fields', () => {
  const bad = [
    [{ type: 'RUN_SHELL', command: 'calc' }],
    [{ type: 'OPEN_URL', url: 'github.com', command: 'calc' }],
    [{ type: 'OPEN_URL', url: 'javascript:alert(1)' }],
    [{ type: 'UNDO_LAST' }],
  ];
  for (const actions of bad) assert.equal(validateAliasDef({ phrase: 'my alias', actions }, S, []).ok, false);
  const good = validateAliasDef({ phrase: 'start my day', actions: [{ type: 'OPEN_APP', appId: 'vscode' }] }, S, []);
  assert.equal(good.ok, true);
  assert.equal(validateAliasDef({ phrase: 'start my day', actions: good.alias.actions }, S, [good.alias]).ok, false, 'duplicate');
  assert.equal(validateAliasDef({ phrase: 'next tab', actions: good.alias.actions }, S, []).ok, false, 'collides with built-in');
});

test('SendKeys strings are restricted', () => {
  assert.equal(isValidKeys('^g|sleep:250|27|{ENTER}'), true);
  assert.equal(isValidKeys('^%i'), true);
  assert.equal(isValidKeys('%{F4}x{'), false);
  assert.equal(isValidKeys('hello world'), false);
});

test('zoom and quick key commands parse directly', () => {
  assert.deepEqual(parse('zoom in').actions[0], { type: 'PRESS_KEYS', keys: '^{ADD}' });
  assert.deepEqual(parse('zoom out').actions[0], { type: 'PRESS_KEYS', keys: '^{SUBTRACT}' });
  assert.deepEqual(parse('reset zoom').actions[0], { type: 'PRESS_KEYS', keys: '^0' });
  assert.deepEqual(parse('enter').actions[0], { type: 'PRESS_KEYS', keys: '{ENTER}' });
  assert.deepEqual(parse('hit enter').actions[0], { type: 'PRESS_KEYS', keys: '{ENTER}' });
  assert.deepEqual(parse('page up').actions[0], { type: 'PRESS_KEYS', keys: '{PGUP}' });
  assert.deepEqual(parse('page down').actions[0], { type: 'PRESS_KEYS', keys: '{PGDN}' });
});

test('web search commands parse directly to search URLs', () => {
  assert.equal(parse('search for quantum computing').actions[0].url, 'https://www.google.com/search?q=quantum%20computing');
  assert.equal(parse('google how to center a div').actions[0].url, 'https://www.google.com/search?q=how%20to%20center%20a%20div');
  assert.equal(parse('search youtube for lofi hip hop').actions[0].url, 'https://www.youtube.com/results?search_query=lofi%20hip%20hop');
  assert.equal(parse('search github for electron').actions[0].url, 'https://github.com/search?q=electron');
});

test('spoken enter or wispr flow at end of sentence is stripped automatically', () => {
  assert.equal(parse('Open VS Code enter').actions[0].type, 'OPEN_APP');
  assert.equal(parse('Open VS Code Wispr Flow').actions[0].type, 'OPEN_APP');
  assert.equal(parse('Open Zigzag Car Adventure on desktop wispr flow').actions[0].type, 'OPEN_FOLDER');
  assert.equal(parse('enter').actions[0].type, 'PRESS_KEYS');
  assert.equal(parse('enter').actions[0].keys, '{ENTER}');
});

test('type in it with and enter executes typing and enter key', () => {
  const p1 = parse('Now type in it. Krishna is a good boy. And Enter.');
  assert.equal(p1.type, 'actions');
  assert.equal(p1.actions.length, 2);
  assert.deepEqual(p1.actions[0], { type: 'TYPE_TEXT', text: 'Krishna is a good boy' });
  assert.deepEqual(p1.actions[1], { type: 'PRESS_KEYS', keys: '{ENTER}' });

  const p2 = parse('type in it hello world and press enter');
  assert.equal(p2.actions.length, 2);
  assert.deepEqual(p2.actions[0], { type: 'TYPE_TEXT', text: 'hello world' });
  assert.deepEqual(p2.actions[1], { type: 'PRESS_KEYS', keys: '{ENTER}' });
});

test('repeated enters and punctuation stripped cleanly', () => {
  const p = parse('Open Microsoft Edge. And enter. Hit Enter.');
  assert.equal(p.actions[0].type, 'OPEN_APP');
  assert.equal(p.actions[0].appId, 'browser');
});
