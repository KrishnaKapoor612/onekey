'use strict';
const { app, BrowserWindow, globalShortcut, ipcMain, shell, clipboard, screen, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const { pathToFileURL } = require('url');

const { makeDefaults } = require('./src/defaults');
const { createStore } = require('./src/store');
const { createExecutor } = require('./src/executor');
const winops = require('./src/winops');
const sysops = require('./src/sysops');
const { Pipeline } = require('./src/pipeline');
const { validateAliasDef, normalizePhrase } = require('./src/aliases');

const PS_DIR = path.join(__dirname, 'ps').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const INDEX = path.join(__dirname, 'renderer', 'index.html');

let win = null;
let store, pipeline;
let extra = {
  mic: 'idle',
  hotkey: { active: null, message: 'Not registered yet.' },
};

if (!app.requestSingleInstanceLock()) app.quit();

let speakingProcess = null;
function speak(text) {
  if (!text || process.platform !== 'win32') return;
  try {
    if (speakingProcess) {
      try { speakingProcess.kill(); } catch (_) {}
      speakingProcess = null;
    }
    const script = path.join(PS_DIR, 'speak.ps1');
    speakingProcess = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, env: { ...process.env, ONEKEY_TTS: String(text) } }
    );
    speakingProcess.on('exit', () => { speakingProcess = null; });
    speakingProcess.on('error', () => { speakingProcess = null; });
  } catch (_) {}
}

function broadcast() {
  const s = snapshot();
  if (win && !win.isDestroyed()) win.webContents.send('state', s);
  if (s.speakText) {
    speak(s.speakText);
    if (pipeline && pipeline.s) pipeline.s.speakText = null;
  }
}
function snapshot() {
  return { ...pipeline.snapshot(), ...extra };
}

function launch(exe, args) {
  return new Promise((resolve, reject) => {
    const c = spawn(exe, args, { detached: true, stdio: 'ignore' });
    c.once('error', reject);
    c.once('spawn', () => { c.unref(); resolve(); });
  });
}

async function openExternal(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http/https URLs may be opened.');
  await shell.openExternal(url);
}

/**
 * Focus the OneKey input bar and select all text.
 * This is all the hotkey does now — Wispr Flow handles dictation system-wide.
 */
function focusInputBar() {
  if (!win || win.isDestroyed()) return;
  win.show();
  win.webContents.send('focus-input');
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const s = store.getSettings();
  const attempt = (acc) => {
    try { return globalShortcut.register(acc, focusInputBar) && globalShortcut.isRegistered(acc); }
    catch (_) { return false; }
  };
  if (attempt(s.hotkey)) {
    extra.hotkey = { requested: s.hotkey, active: s.hotkey, fallback: false, message: `Hotkey ${s.hotkey} is active.` };
  } else if (attempt(s.fallbackHotkey)) {
    extra.hotkey = {
      requested: s.hotkey, active: s.fallbackHotkey, fallback: true,
      message: `Could not register "${s.hotkey}" (reserved by Windows or another app). Using fallback ${s.fallbackHotkey}. OneKey never changes Caps Lock behavior.`,
    };
  } else {
    extra.hotkey = { requested: s.hotkey, active: null, fallback: false, message: 'No hotkey could be registered. Use the input bar directly.' };
  }
  broadcast();
}

function validSender(e) {
  try {
    const url = e.senderFrame && e.senderFrame.url ? e.senderFrame.url.split('#')[0] : '';
    return url === pathToFileURL(INDEX).href;
  } catch (_) { return false; }
}
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!validSender(e)) throw new Error('Rejected IPC sender.');
    return fn(...args);
  });
}
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workArea;
  const width = 660;
  const height = 64;
  const x = Math.round((sw - width) / 2);
  const y = sh - height - 20;

  win = new BrowserWindow({
    width, height, x, y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(INDEX);
}

app.whenReady().then(() => {
  const defaults = makeDefaults({
    documents: app.getPath('documents'),
    desktop: app.getPath('desktop'),
    downloads: app.getPath('downloads'),
    localAppData: process.env.LOCALAPPDATA || '',
  });
  store = createStore(app.getPath('userData'), defaults);
  const executor = createExecutor({
    fs, win: winops, sys: sysops, launch, openExternal, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    clipboard: { readText: () => clipboard.readText(), writeText: (t) => clipboard.writeText(t) },
    getSettings: () => store.getSettings(),
  });
  pipeline = new Pipeline({
    store, executor,
    onChange: broadcast,
    getLLMConfig: () => {
      const s = store.getSettings();
      const llm = { ...(s.llm || {}) };
      if (!llm.apiKey && llm._encryptedKey && safeStorage.isEncryptionAvailable()) {
        try {
          llm.apiKey = safeStorage.decryptString(Buffer.from(llm._encryptedKey, 'base64'));
        } catch (_) {}
      }
      return llm;
    },
  });

  handle('state:get', () => snapshot());
  handle('speech:speak', (text) => {
    if (typeof text === 'string') speak(text);
    return { ok: true };
  });
  handle('transcript:submit', (p) => {
    if (!isObj(p) || typeof p.text !== 'string' || p.text.length > 1000) throw new Error('Bad payload.');
    return pipeline.submit(p.text, 'typed');
  });
  handle('pending:confirm', () => pipeline.confirmPending());
  handle('pending:cancel', () => pipeline.cancelPending());
  handle('history:clear', () => { store.clearHistory(); broadcast(); });
  handle('settings:get', () => store.getSettings());
  handle('settings:save', (patch) => {
    if (!isObj(patch)) throw new Error('Bad payload.');
    const { aliases, ...rest } = patch;
    // Encrypt LLM API key if safeStorage is available and key is present
    if (rest.llm && rest.llm.apiKey && safeStorage.isEncryptionAvailable()) {
      rest.llm._encryptedKey = safeStorage.encryptString(rest.llm.apiKey).toString('base64');
      delete rest.llm.apiKey;
    }
    const r = store.saveSettings(rest);
    if (r.ok) registerHotkeys();
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  });
  handle('alias:preview', (d) => {
    if (!isObj(d) || JSON.stringify(d).length > 10000) throw new Error('Bad payload.');
    const s = store.getSettings();
    const existing = s.aliases.filter((a) => normalizePhrase(a.phrase) !== normalizePhrase(d.editing || ''));
    const r = validateAliasDef(d, s, existing);
    return r.ok ? { ok: true, preview: r.preview } : { ok: false, error: r.error };
  });
  handle('alias:save', (d) => {
    if (!isObj(d) || JSON.stringify(d).length > 10000) throw new Error('Bad payload.');
    const s = store.getSettings();
    const existing = s.aliases.filter((a) => normalizePhrase(a.phrase) !== normalizePhrase(d.editing || ''));
    const r = validateAliasDef(d, s, existing);
    if (!r.ok) return { ok: false, error: r.error };
    store.setAliases(existing.concat([r.alias]));
    broadcast();
    return { ok: true, preview: r.preview };
  });
  handle('alias:delete', (phrase) => {
    if (typeof phrase !== 'string' || phrase.length > 100) throw new Error('Bad payload.');
    const s = store.getSettings();
    store.setAliases(s.aliases.filter((a) => normalizePhrase(a.phrase) !== normalizePhrase(phrase)));
    broadcast();
    return { ok: true };
  });
  handle('window:resize', (h) => {
    if (!win || win.isDestroyed()) return;
    if (typeof h !== 'number' || h < 48 || h > 600) return;
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workArea;
    const width = 660;
    const x = Math.round((sw - width) / 2);
    const y = sh - h - 20;
    win.setBounds({ x, y, width, height: h });
  });

  createWindow();
  registerHotkeys();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
