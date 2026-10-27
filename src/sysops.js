'use strict';
const { execFile } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'ps', 'sys.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const bad = (error, message) => ({ ok: false, error, message });
const CTL = /[\u0000-\u001f]/;

// Free-text values (app ids, window queries) travel in an environment variable, never on the command line.
function run(args, arg, timeout = 20000) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(bad('unsupported-platform', 'Desktop control only works on Windows.'));
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-SelfPid', String(process.pid), ...args],
      { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ONEKEY_ARG: String(arg || '') } },
      (err, stdout, stderr) => {
        if (err && !stdout) return resolve(bad('powershell-failed', String(stderr || err.message).slice(0, 300)));
        const line = String(stdout).trim().split(/\r?\n/).pop();
        try { resolve(JSON.parse(line)); } catch (_) { resolve(bad('bad-output', 'Unexpected output from helper script.')); }
      });
  });
}

const mapWin = (w) => ({ handle: w.Handle, pid: w.Pid, title: w.Title, proc: w.Proc, active: !!w.Active });
function normalize(r) {
  if (r.windows !== undefined) r.windows = [].concat(r.windows || []).map(mapWin);
  if (r.window) r.window = mapWin(r.window);
  return r;
}

let cache = { at: 0, apps: null };
async function apps(force = false) {
  if (!force && cache.apps && Date.now() - cache.at < 5 * 60 * 1000) return { ok: true, apps: cache.apps };
  const r = await run(['-Action', 'apps'], '', 40000);
  if (!r.ok) return r;
  const list = [].concat(r.apps || []).map((a) => ({ name: a.name, appId: a.appId })).filter((a) => a.name && a.appId);
  cache = { at: Date.now(), apps: list };
  return { ok: true, apps: list };
}

// Only app ids that Windows itself reported can be launched.
async function launch(appId) {
  if (typeof appId !== 'string' || !appId || appId.length > 600 || CTL.test(appId)) return bad('bad-arg', 'Invalid app id.');
  const known = await apps();
  if (!known.ok) return known;
  if (!known.apps.some((a) => a.appId === appId)) return bad('unknown-app', 'That app is not in the installed apps list.');
  return run(['-Action', 'launch'], appId);
}

async function focusWindow({ query, targetId }) {
  const args = ['-Action', 'focus'];
  if (Number.isInteger(targetId) && targetId > 0) args.push('-TargetId', String(targetId));
  return normalize(await run(args, query || ''));
}

async function keys(k) {
  return normalize(await run(['-Action', 'keys', '-Keys', k], '', 30000));
}

const WINDOW_MODES = new Set(['snap_left', 'snap_right', 'maximize', 'minimize', 'restore', 'close']);
async function windowOp({ mode, targetId }) {
  if (!WINDOW_MODES.has(mode)) return bad('bad-mode', 'Unknown window operation.');
  const args = ['-Action', 'window', '-Mode', mode];
  if (Number.isInteger(targetId) && targetId > 0) args.push('-TargetId', String(targetId));
  return normalize(await run(args, ''));
}

const MOVE_MODES = new Set(['left', 'right', 'up', 'down', 'center', 'top-left', 'top-right', 'bottom-left', 'bottom-right']);
async function mouse({ op, mode, amount }) {
  const n = Number.isInteger(amount) ? amount : 0;
  if (op === 'move') {
    if (!MOVE_MODES.has(mode)) return bad('bad-mode', 'Unknown cursor move.');
    return run(['-Action', 'mouse-move', '-Mode', mode, '-Amount', String(n)], '');
  }
  if (op === 'click') {
    if (mode !== 'left' && mode !== 'right') return bad('bad-mode', 'Unknown mouse button.');
    return run(['-Action', 'mouse-click', '-Mode', mode, '-Amount', String(n || 1)], '');
  }
  return bad('bad-op', 'Unknown mouse operation.');
}

// Power control uses Windows' own tools directly. Shutdown/restart get a 30 s grace period that "cancel shutdown" can abort.
const POWER = {
  lock: ['rundll32.exe', ['user32.dll,LockWorkStation']],
  sleep: ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']],
  shutdown: ['shutdown.exe', ['/s', '/t', '30', '/c', 'OneKey: shutting down in 30 seconds. Say "cancel shutdown" to abort.']],
  restart: ['shutdown.exe', ['/r', '/t', '30', '/c', 'OneKey: restarting in 30 seconds. Say "cancel restart" to abort.']],
  signout: ['shutdown.exe', ['/l']],
  cancel_shutdown: ['shutdown.exe', ['/a']],
};
function power(mode, exec = execFile) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' && exec === execFile) return resolve(bad('unsupported-platform', 'Power control only works on Windows.'));
    const p = Object.prototype.hasOwnProperty.call(POWER, mode) ? POWER[mode] : null;
    if (!p) return resolve(bad('bad-mode', 'Unknown power action.'));
    exec(p[0], p[1], { windowsHide: true }, (err) => {
      if (err && mode === 'cancel_shutdown') return resolve(bad('none-pending', 'No shutdown or restart was pending.'));
      if (err) return resolve(bad('power-failed', String(err.message).slice(0, 200)));
      resolve({ ok: true });
    });
  });
}

async function screenshot({ mode } = {}) {
  const m = mode === 'screen' ? 'screen' : 'window';
  return run(['-Action', 'screenshot', '-Mode', m], '', 30000);
}

module.exports = { apps, launch, focusWindow, keys, windowOp, mouse, power, screenshot };
