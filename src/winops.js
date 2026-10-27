'use strict';
const { execFile } = require('child_process');
const path = require('path');
const { isValidKeys } = require('./schema');

const SCRIPT = path.join(__dirname, '..', 'ps', 'win.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const NAME_RE = /^[A-Za-z0-9._-]{1,60}$/;
const bad = (error, message) => ({ ok: false, error, message });

function run(args, timeout = 15000) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(bad('unsupported-platform', 'Desktop control only works on Windows.'));
    // execFile with an argument array: no shell, no interpolation.
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args],
      { windowsHide: true, timeout }, (err, stdout, stderr) => {
        if (err && !stdout) return resolve(bad('powershell-failed', String(stderr || err.message).slice(0, 300)));
        const line = String(stdout).trim().split(/\r?\n/).pop();
        try { resolve(JSON.parse(line)); } catch (_) { resolve(bad('bad-output', 'Unexpected output from helper script.')); }
      });
  });
}

const mapWin = (w) => ({ handle: w.Handle, pid: w.Pid, title: w.Title, active: !!w.Active });
function normalize(r) {
  if (r.windows !== undefined) r.windows = [].concat(r.windows || []).map(mapWin);
  if (r.window) r.window = mapWin(r.window);
  return r;
}

async function list(processName) {
  if (!NAME_RE.test(processName)) return bad('bad-process', 'Invalid process name.');
  return normalize(await run(['-Action', 'list', '-ProcessName', processName]));
}
async function focus({ processName, targetId }) {
  if (!NAME_RE.test(processName)) return bad('bad-process', 'Invalid process name.');
  const args = ['-Action', 'focus', '-ProcessName', processName];
  if (Number.isInteger(targetId) && targetId > 0) args.push('-TargetId', String(targetId));
  return normalize(await run(args));
}
async function keys({ processName, keys: k }) {
  if (!NAME_RE.test(processName)) return bad('bad-process', 'Invalid process name.');
  if (!isValidKeys(k)) return bad('bad-keys', 'Key sequence rejected by validation.');
  return normalize(await run(['-Action', 'keys', '-ProcessName', processName, '-Keys', k], 30000));
}

module.exports = { list, focus, keys };