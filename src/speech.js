'use strict';
const { spawn } = require('child_process');
const readline = require('readline');

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'];

function listenOnce({ scriptPath, culture, timeoutSec, onReady }) {
  let child = null;
  let finish = () => {};
  const promise = new Promise((resolve) => {
    let settled = false;
    finish = (r) => { if (!settled) { settled = true; resolve(r); } };
    if (process.platform !== 'win32') return finish({ event: 'error', message: 'Windows speech recognition is only available on Windows.' });
    child = spawn('powershell.exe', [...PS_ARGS, scriptPath, '-Culture', culture, '-TimeoutSec', String(timeoutSec)], { windowsHide: true });
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      let m; try { m = JSON.parse(line); } catch (_) { return; }
      if (m.event === 'ready') { if (onReady) onReady(); return; }
      finish(m);
    });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish({ event: 'error', message: e.message }));
    child.on('close', () => finish({ event: 'error', message: err.trim().slice(0, 300) || 'Speech process ended unexpectedly.' }));
  });
  return {
    promise,
    cancel() { finish({ event: 'cancelled' }); try { if (child) child.kill(); } catch (_) {} },
  };
}

function checkSpeech(scriptPath) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ event: 'error', message: 'Not running on Windows.' });
    const c = spawn('powershell.exe', [...PS_ARGS, scriptPath, '-Check'], { windowsHide: true });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('error', (e) => resolve({ event: 'error', message: e.message }));
    c.on('close', () => {
      try { const r = JSON.parse(out.trim().split(/\r?\n/).pop()); r.cultures = [].concat(r.cultures || []); resolve(r); }
      catch (_) { resolve({ event: 'error', message: 'Could not query Windows speech recognizers.' }); }
    });
  });
}

module.exports = { listenOnce, checkSpeech };