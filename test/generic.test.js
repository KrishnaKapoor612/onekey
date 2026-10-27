'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTranscript, spokenKeys } = require('../src/parser');
const { validateAction, needsConfirmation } = require('../src/schema');
const { validateAliasDef } = require('../src/aliases');
const { matchApps } = require('../src/appmatch');
const { createExecutor } = require('../src/executor');
const { tmp, settingsFor, mockDeps, session } = require('./helpers');

const S = settingsFor(tmp());
const one = (t) => { const r = parseTranscript(t, { settings: S, aliases: [] }); return r.type === 'actions' ? r.actions[0] : r; };

test('power phrases parse, and only risky ones need confirmation', () => {
  assert.deepEqual(one('shutdown'), { type: 'POWER', mode: 'shutdown' });
  assert.deepEqual(one('Shut down my laptop.'), { type: 'POWER', mode: 'shutdown' });
  assert.deepEqual(one('sleep my laptop'), { type: 'POWER', mode: 'sleep' });
  assert.deepEqual(one('sleep'), { type: 'POWER', mode: 'sleep' });
  assert.deepEqual(one('restart'), { type: 'POWER', mode: 'restart' });
  assert.deepEqual(one('lock my computer'), { type: 'POWER', mode: 'lock' });
  assert.deepEqual(one('cancel shutdown'), { type: 'POWER', mode: 'cancel_shutdown' });
  assert.equal(needsConfirmation([one('shutdown')]), true);
  assert.equal(needsConfirmation([one('restart')]), true);
  assert.equal(needsConfirmation([one('sign out')]), true);
  assert.equal(needsConfirmation([one('sleep')]), false);
  assert.equal(needsConfirmation([one('lock')]), false);
  assert.equal(needsConfirmation([one('close window')]), true);
  assert.equal(parseTranscript('cancel', { settings: S, aliases: [] }).type, 'control', 'plain cancel is still the control word');
});

test('window and mouse phrases', () => {
  assert.deepEqual(one('move this window to the left'), { type: 'WINDOW_SNAP', mode: 'left' });
  assert.deepEqual(one('shift my window to the right'), { type: 'WINDOW_SNAP', mode: 'right' });
  assert.deepEqual(one('snap left'), { type: 'WINDOW_SNAP', mode: 'left' });
  assert.deepEqual(one('maximize'), { type: 'WINDOW_SNAP', mode: 'maximize' });
  assert.deepEqual(one('minimize this window'), { type: 'WINDOW_SNAP', mode: 'minimize' });
  assert.deepEqual(one('close window'), { type: 'WINDOW_CLOSE' });
  assert.deepEqual(one('move the cursor left'), { type: 'MOUSE_MOVE', direction: 'left', amount: 200 });
  assert.deepEqual(one('move the mouse right 300 pixels'), { type: 'MOUSE_MOVE', direction: 'right', amount: 300 });
  assert.deepEqual(one('move the cursor to the center'), { type: 'MOUSE_MOVE', position: 'center' });
  assert.deepEqual(one('move cursor to top right'), { type: 'MOUSE_MOVE', position: 'top-right' });
  assert.deepEqual(one('double click'), { type: 'MOUSE_CLICK', button: 'left', count: 2 });
  assert.deepEqual(one('right click'), { type: 'MOUSE_CLICK', button: 'right', count: 1 });
});

test('keys, typing and tabs', () => {
  assert.equal(spokenKeys('control shift t'), '^+t');
  assert.equal(spokenKeys('escape'), '{ESC}');
  assert.equal(spokenKeys('control f5'), '^{F5}');
  assert.equal(spokenKeys('control nonsense'), null);
  assert.deepEqual(one('press control s'), { type: 'PRESS_KEYS', keys: '^s' });
  assert.deepEqual(one('type hello World'), { type: 'TYPE_TEXT', text: 'hello World' });
  assert.equal(one('press banana').type, 'unknown');
  assert.equal(validateAction(one('press alt f4'), S).ok, false, 'Alt+F4 is refused; "close window" has a confirmation');
  assert.equal(one('switch tab').type, 'BROWSER_NEXT_TAB');
  assert.equal(one('move to new tab').type, 'BROWSER_NEW_TAB');
});

test('open/switch: configured apps and URLs win, anything else becomes a generic action', () => {
  assert.equal(one('open vs code').type, 'OPEN_APP');
  assert.equal(one('open github.com').type, 'OPEN_URL');
  assert.deepEqual(one('open WPS Office'), { type: 'LAUNCH_APP', name: 'wps office' });
  assert.deepEqual(one('launch clash of clans'), { type: 'LAUNCH_APP', name: 'clash of clans' });
  assert.deepEqual(one('switch to spotify'), { type: 'FOCUS_WINDOW', query: 'spotify' });
  assert.equal(one('format my hard drive').type, 'unknown');
  assert.equal(one('what can you do').type, 'unknown');
});

test('schema validates the new actions strictly', () => {
  const v = (a) => validateAction(a, S);
  assert.equal(v({ type: 'LAUNCH_APP', name: 'Calculator' }).ok, true);
  assert.equal(v({ type: 'LAUNCH_APP', name: 'calc; rm -rf /' }).ok, false);
  assert.equal(v({ type: 'LAUNCH_APP', name: '-Command evil' }).ok, false);
  assert.equal(v({ type: 'LAUNCH_APP', name: 'x', extra: 1 }).ok, false);
  assert.equal(v({ type: 'POWER', mode: 'format' }).ok, false);
  assert.equal(v({ type: 'MOUSE_MOVE', direction: 'left', amount: 99999 }).ok, false);
  assert.equal(v({ type: 'MOUSE_MOVE', direction: 'left', position: 'center' }).ok, false);
  assert.equal(v({ type: 'MOUSE_MOVE' }).ok, false);
  assert.equal(v({ type: 'WINDOW_SNAP', mode: 'close' }).ok, false, 'close only via WINDOW_CLOSE (confirmed)');
  assert.deepEqual(v({ type: 'MOUSE_CLICK' }).action, { type: 'MOUSE_CLICK', button: 'left', count: 1 });
});

test('aliases may use new actions and may override the generic "open X" fallback', () => {
  const r = validateAliasDef({ phrase: 'open my dev setup', actions: [{ type: 'OPEN_APP', appId: 'vscode' }, { type: 'OPEN_URL', url: 'github.com' }] }, S, []);
  assert.equal(r.ok, true, r.error);
  assert.equal(validateAliasDef({ phrase: 'good night', actions: [{ type: 'POWER', mode: 'sleep' }] }, S, []).ok, true);
  assert.equal(validateAliasDef({ phrase: 'shutdown', actions: [{ type: 'POWER', mode: 'sleep' }] }, S, []).ok, false, 'real built-ins are still protected');
});

const APPS = [
  { name: 'Calculator', appId: 'calc!App' }, { name: 'Notepad', appId: 'notepad' },
  { name: 'Microsoft Edge', appId: 'edge' }, { name: 'Microsoft Edge WebView2 Runtime', appId: 'wv2' },
  { name: 'WPS Office', appId: 'wps' }, { name: 'WPS Writer', appId: 'wpsw' }, { name: 'WPS Spreadsheets', appId: 'wpss' },
  { name: 'Clash of Clans', appId: 'coc' },
];
test('app matching: exact, partial, ambiguous and missing', () => {
  assert.equal(matchApps('calculator', APPS)[0].appId, 'calc!App');
  assert.equal(matchApps('edge', APPS).length, 1);
  assert.equal(matchApps('edge', APPS)[0].name, 'Microsoft Edge');
  assert.equal(matchApps('wps office', APPS)[0].appId, 'wps');
  assert.equal(matchApps('wps', APPS).length, 3, 'ambiguous -> caller asks for the full name');
  assert.equal(matchApps('clash of clans', APPS)[0].appId, 'coc');
  assert.equal(matchApps('photoshop', APPS).length, 0);
});

function sysMock(over = {}) {
  const calls = [];
  const sys = {
    apps: async () => ({ ok: true, apps: APPS }),
    launch: async (id) => { calls.push(['launch', id]); return { ok: true }; },
    focusWindow: async (o) => { calls.push(['focus', o]); return { ok: true, verified: true, window: { title: 'Spotify' } }; },
    keys: async (k) => { calls.push(['keys', k]); return { ok: true, window: { title: 'Notepad' } }; },
    windowOp: async (o) => { calls.push(['window', o.mode]); return { ok: true, window: { title: 'Notepad' } }; },
    mouse: async (o) => { calls.push(['mouse', o]); return { ok: true }; },
    power: async (m) => { calls.push(['power', m]); return { ok: true }; },
    screenshot: async (o) => { calls.push(['screenshot', o.mode]); return { ok: true, file: 'Screenshot_123.png' }; },
    ...over,
  };
  return { sys, calls };
}
const exec = (over) => { const { deps } = mockDeps(S); const m = sysMock(over); return { ex: createExecutor({ ...deps, sys: m.sys }), calls: m.calls }; };

test('executor: launch resolves against installed apps and refuses unknown/ambiguous ones', async () => {
  const { ex, calls } = exec();
  const r = await ex.execute({ type: 'LAUNCH_APP', name: 'calculator' }, session());
  assert.equal(r.ok, true); assert.deepEqual(calls[0], ['launch', 'calc!App']);
  const none = await ex.execute({ type: 'LAUNCH_APP', name: 'photoshop' }, session());
  assert.equal(none.ok, false); assert.match(none.message, /No installed app/);
  const amb = await ex.execute({ type: 'LAUNCH_APP', name: 'wps' }, session());
  assert.equal(amb.ok, false); assert.match(amb.message, /WPS Writer/); assert.equal(calls.length, 1, 'nothing launched');
});

test('executor: focus ambiguity becomes a window choice; typing goes through the clipboard', async () => {
  const { ex } = exec({ focusWindow: async () => ({ ok: false, error: 'ambiguous', windows: [{ handle: 1, title: 'a' }, { handle: 2, title: 'b' }] }) });
  const r = await ex.execute({ type: 'FOCUS_WINDOW', query: 'chrome' }, session());
  assert.equal(r.status, 'needs_choice'); assert.equal(r.choices.length, 2);

  const m = mockDeps(S); const sm = sysMock();
  const ex2 = createExecutor({ ...m.deps, sys: sm.sys });
  const t = await ex2.execute({ type: 'TYPE_TEXT', text: 'hello; {ENTER} ^c' }, session());
  assert.equal(t.ok, true);
  assert.deepEqual(sm.calls[0], ['keys', '^v'], 'free text is never sent as keystrokes');
  assert.equal(m.calls.clip[0], 'hello; {ENTER} ^c');
  assert.equal(m.calls.clip[m.calls.clip.length - 1], 'orig', 'clipboard restored');
});

test('executor: power, window, mouse and keys are forwarded; Alt+F4 never reaches the system', async () => {
  const { ex, calls } = exec();
  const s = session();
  assert.equal((await ex.execute({ type: 'POWER', mode: 'shutdown' }, s)).ok, true);
  assert.equal((await ex.execute({ type: 'WINDOW_SNAP', mode: 'left' }, s)).ok, true);
  assert.equal((await ex.execute({ type: 'MOUSE_MOVE', direction: 'left' }, s)).ok, true);
  assert.equal((await ex.execute({ type: 'PRESS_KEYS', keys: '^s' }, s)).ok, true);
  assert.deepEqual(calls.map((c) => c[0]), ['power', 'window', 'mouse', 'keys']);
  assert.equal(calls[1][1], 'snap_left');
  assert.deepEqual(calls[2][1], { op: 'move', mode: 'left', amount: 200 });
  const before = calls.length;
  assert.equal((await ex.execute({ type: 'PRESS_KEYS', keys: '%{F4}' }, s)).ok, false);
  assert.equal((await ex.execute({ type: 'POWER', mode: 'format' }, s)).ok, false);
  assert.equal(calls.length, before);
});

test('screenshot commands parse, validate, and execute', async () => {
  assert.deepEqual(one('take a screenshot'), { type: 'SCREENSHOT', mode: 'window' });
  assert.deepEqual(one('take the screenshot'), { type: 'SCREENSHOT', mode: 'window' });
  assert.deepEqual(one('capture screenshot'), { type: 'SCREENSHOT', mode: 'window' });
  assert.deepEqual(one('take screenshot of the screen'), { type: 'SCREENSHOT', mode: 'screen' });
  assert.equal(validateAction(one('take the screenshot'), S).ok, true);

  const { ex, calls } = exec();
  const s = session();
  const res = await ex.execute({ type: 'SCREENSHOT', mode: 'window' }, s);
  assert.equal(res.ok, true);
  assert.match(res.message, /Screenshot saved/);
  assert.deepEqual(calls[0], ['screenshot', 'window']);
});

test('Wispr Flow trailing trigger and replace content parsing', () => {
  // Trailing Wispr Flow triggers auto-strip
  assert.deepEqual(one('open calculator and wispr flow'), { type: 'LAUNCH_APP', name: 'calculator' });
  assert.deepEqual(one('move the cursor left Wispr Flow'), { type: 'MOUSE_MOVE', direction: 'left', amount: 200 });
  assert.deepEqual(one('take screenshot wispr flow'), { type: 'SCREENSHOT', mode: 'window' });
  assert.deepEqual(one('open calculator and WisprFlow'), { type: 'LAUNCH_APP', name: 'calculator' });

  // Replace content phrases
  const rep1 = parseTranscript('replace content with hello world', { settings: S, aliases: [] });
  assert.equal(rep1.type, 'control');
  assert.equal(rep1.name, 'replace_last_sentence');
  assert.equal(rep1.text, 'hello world');

  const rep2 = parseTranscript('replace text with new code', { settings: S, aliases: [] });
  assert.equal(rep2.type, 'control');
  assert.equal(rep2.name, 'replace_last_sentence');
  assert.equal(rep2.text, 'new code');
});


