'use strict';
const path = require('path');

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fail = (error) => ({ ok: false, error });

// Strict action schema: type -> allowed fields. An action type is only listed if it has an executor.
const SPECS = {
  CREATE_FOLDER: ['name', 'location'],
  OPEN_FOLDER: ['name', 'location'],
  OPEN_APP: ['appId', 'targetId'],
  FOCUS_APP: ['appId', 'targetId'],
  OPEN_URL: ['url'],
  BROWSER_NEW_TAB: [],
  BROWSER_NEXT_TAB: [],
  BROWSER_PREVIOUS_TAB: [],
  DICTATE_TEXT: ['text'],
  SEND_PENDING_TEXT: [],
  CLEAR_PENDING_TEXT: [],
  VS_CODE_GOTO_LINE: ['line'],
  VS_CODE_FIND: ['query'],
  VS_CODE_OPEN_COPILOT: [],
  UNDO_LAST: [],
  // generic actions (any installed app / any window)
  LAUNCH_APP: ['name'],
  FOCUS_WINDOW: ['query', 'targetId'],
  TYPE_TEXT: ['text'],
  PRESS_KEYS: ['keys'],
  MOUSE_MOVE: ['direction', 'amount', 'position'],
  MOUSE_CLICK: ['button', 'count'],
  WINDOW_SNAP: ['mode'],
  WINDOW_CLOSE: [],
  POWER: ['mode'],
  SCREENSHOT: ['mode'],
};
const CONSEQUENTIAL = new Set(['SEND_PENDING_TEXT', 'CLEAR_PENDING_TEXT', 'UNDO_LAST', 'WINDOW_CLOSE']);
const RISKY_POWER = new Set(['restart', 'shutdown', 'signout']);
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .'&+_()-]*$/u;
const POSITIONS = ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
const ALIAS_FORBIDDEN = new Set(['UNDO_LAST']);

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function validateFolderName(raw) {
  if (typeof raw !== 'string') return fail('Folder name must be text.');
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, clarify: { kind: 'folder_name', question: 'What should the folder be called?' } };
  if (name.length > 100) return fail('Folder name is too long (max 100 characters).');
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(name)) return fail('Folder name contains path separators or characters Windows does not allow.');
  if (/^\.+$/.test(name)) return fail('Folder name cannot consist only of dots.');
  if (/[. ]$/.test(name)) return fail('Folder name cannot end with a dot or space.');
  if (RESERVED.test(name)) return fail(`"${name}" is a reserved Windows name.`);
  return { ok: true, name };
}

function resolveFolder(rawName, location, settings) {
  const nv = validateFolderName(rawName);
  if (!nv.ok) return nv;
  const locs = settings.approvedLocations || {};
  const keys = Object.keys(locs);
  const key = typeof location === 'string' ? location.toLowerCase().trim() : '';
  if (!key) {
    return { ok: false, clarify: { kind: 'folder_location', question: `Where should I create "${nv.name}"? Approved locations: ${keys.join(', ')}.`, options: keys } };
  }
  if (!has(locs, key)) return fail(`"${location}" is not an approved location. Approved: ${keys.join(', ')}.`);
  const base = path.resolve(locs[key]);
  const full = path.resolve(base, nv.name);
  const rel = path.relative(base, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || path.dirname(full) !== base) return fail('Unsafe path rejected.');
  return { ok: true, path: full, base, name: nv.name, key };
}

function resolveOpenFolder(rawName, location, settings) {
  const nv = validateFolderName(rawName);
  if (!nv.ok) return nv;
  const locs = settings.approvedLocations || {};
  const keys = Object.keys(locs);
  const key = typeof location === 'string' ? location.toLowerCase().trim() : '';
  if (key) {
    if (!has(locs, key)) return fail(`"${location}" is not an approved location. Approved: ${keys.join(', ')}.`);
    const base = path.resolve(locs[key]);
    const full = path.resolve(base, nv.name);
    const rel = path.relative(base, full);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || path.dirname(full) !== base) return fail('Unsafe path rejected.');
    return { ok: true, path: full, base, name: nv.name, key };
  }
  return { ok: true, name: nv.name, key: null };
}

function normalizeUrl(input) {
  if (typeof input !== 'string') return fail('URL must be text.');
  let s = input.trim();
  if (!s || s.length > 2048 || /[\s\u0000-\u001f]/.test(s)) return fail('URL is empty, too long, or contains whitespace.');
  const sm = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (sm && !/^[^/:]+:\d+(\/|$)/.test(s) && !/^https?:\/\//i.test(s)) {
    return fail(`Unsupported URL scheme "${sm[1]}". Only http and https are allowed.`);
  }
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (_) { return fail('Not a valid URL.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return fail('Only http and https URLs are allowed.');
  if (u.username || u.password) return fail('URLs containing credentials are rejected.');
  const h = u.hostname;
  if (!(h === 'localhost' || h.includes('.') || /^\[.*\]$/.test(h))) return fail('Hostname looks incomplete (expected something like example.com).');
  return { ok: true, url: u.href };
}

// SendKeys strings are restricted to modifier+key tokens and sleeps; free text never goes through here.
const KEY_STEP = /^(?:[\^%+]*(?:\{(?:[A-Z]{2,8}|F\d{1,2}|[0-9])\}|[a-z0-9]))+$/;
function isValidKeys(s) {
  if (typeof s !== 'string' || !s || s.length > 200) return false;
  return s.split('|').every((st) => /^sleep:\d{1,4}$/.test(st) || KEY_STEP.test(st));
}

const noCtl = (s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s);

function validateAction(a, settings) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return fail('Action must be an object.');
  if (!has(SPECS, a.type)) return fail(`Unsupported action type "${String(a.type).slice(0, 40)}".`);
  for (const k of Object.keys(a)) {
    if (k !== 'type' && !SPECS[a.type].includes(k)) return fail(`Field "${k}" is not allowed on ${a.type}.`);
  }
  const apps = settings.apps || {};
  switch (a.type) {
    case 'CREATE_FOLDER': {
      const r = resolveFolder(a.name, a.location, settings);
      if (!r.ok) return r;
      return { ok: true, action: { type: a.type, name: r.name, location: r.key } };
    }
    case 'OPEN_FOLDER': {
      const r = resolveOpenFolder(a.name, a.location, settings);
      if (!r.ok) return r;
      const act = { type: a.type, name: r.name };
      if (r.key) act.location = r.key;
      return { ok: true, action: act };
    }
    case 'OPEN_APP':
    case 'FOCUS_APP': {
      if (typeof a.appId !== 'string' || !has(apps, a.appId)) return fail('Unknown application target.');
      const out = { type: a.type, appId: a.appId };
      if (a.targetId !== undefined) {
        if (!Number.isInteger(a.targetId) || a.targetId <= 0) return fail('Invalid window id.');
        out.targetId = a.targetId;
      }
      return { ok: true, action: out };
    }
    case 'OPEN_URL': {
      const n = normalizeUrl(a.url);
      return n.ok ? { ok: true, action: { type: a.type, url: n.url } } : n;
    }
    case 'DICTATE_TEXT': {
      if (typeof a.text !== 'string') return fail('Text must be a string.');
      const text = a.text.trim();
      if (!text || text.length > 4000 || !noCtl(text)) return fail('Dictated text is empty, too long, or has control characters.');
      return { ok: true, action: { type: a.type, text } };
    }
    case 'VS_CODE_GOTO_LINE': {
      let n = a.line;
      if (typeof n === 'string') { if (!/^\d{1,8}$/.test(n.trim())) return fail('Line number must be a positive whole number.'); n = parseInt(n, 10); }
      if (!Number.isInteger(n) || n < 1 || n > 10000000) return fail('Line number must be a positive whole number.');
      return { ok: true, action: { type: a.type, line: n } };
    }
    case 'VS_CODE_FIND': {
      if (typeof a.query !== 'string') return fail('Search text must be a string.');
      const q = a.query.trim();
      if (!q || q.length > 200 || /[\u0000-\u001f]/.test(q)) return fail('Search text is empty, too long, or has control characters.');
      return { ok: true, action: { type: a.type, query: q } };
    }
    case 'LAUNCH_APP': {
      if (typeof a.name !== 'string') return fail('App name must be text.');
      const name = a.name.trim().replace(/\s+/g, ' ');
      if (!name || name.length > 60 || !NAME_RE.test(name)) return fail('App name is empty, too long, or has unsupported characters.');
      return { ok: true, action: { type: a.type, name } };
    }
    case 'FOCUS_WINDOW': {
      if (typeof a.query !== 'string') return fail('Window name must be text.');
      const query = a.query.trim().replace(/\s+/g, ' ');
      if (!query || query.length > 60 || !NAME_RE.test(query)) return fail('Window name is empty, too long, or has unsupported characters.');
      const out = { type: a.type, query };
      if (a.targetId !== undefined) {
        if (!Number.isInteger(a.targetId) || a.targetId <= 0) return fail('Invalid window id.');
        out.targetId = a.targetId;
      }
      return { ok: true, action: out };
    }
    case 'TYPE_TEXT': {
      if (typeof a.text !== 'string') return fail('Text must be a string.');
      const text = a.text.trim();
      if (!text || text.length > 4000 || !noCtl(text)) return fail('Text is empty, too long, or has control characters.');
      return { ok: true, action: { type: a.type, text } };
    }
    case 'PRESS_KEYS': {
      if (!isValidKeys(a.keys)) return fail('Key combination is not allowed.');
      if (/%\{F4\}/i.test(a.keys)) return fail('Alt+F4 is not allowed. Say \"close window\" instead.');
      return { ok: true, action: { type: a.type, keys: a.keys } };
    }
    case 'MOUSE_MOVE': {
      const hasDir = a.direction !== undefined;
      const hasPos = a.position !== undefined;
      if (hasDir === hasPos) return fail('Give either a direction or a position for the cursor.');
      if (hasPos) {
        if (!POSITIONS.includes(a.position)) return fail('Unknown cursor position.');
        return { ok: true, action: { type: a.type, position: a.position } };
      }
      if (!['left', 'right', 'up', 'down'].includes(a.direction)) return fail('Direction must be left, right, up or down.');
      const amount = a.amount === undefined ? 200 : a.amount;
      if (!Number.isInteger(amount) || amount < 1 || amount > 3000) return fail('Cursor distance must be 1-3000 pixels.');
      return { ok: true, action: { type: a.type, direction: a.direction, amount } };
    }
    case 'MOUSE_CLICK': {
      const button = a.button === undefined ? 'left' : a.button;
      const count = a.count === undefined ? 1 : a.count;
      if (button !== 'left' && button !== 'right') return fail('Button must be left or right.');
      if (count !== 1 && count !== 2) return fail('Click count must be 1 or 2.');
      return { ok: true, action: { type: a.type, button, count } };
    }
    case 'WINDOW_SNAP': {
      if (!['left', 'right', 'maximize', 'minimize', 'restore'].includes(a.mode)) return fail('Unknown window operation.');
      return { ok: true, action: { type: a.type, mode: a.mode } };
    }
    case 'POWER': {
      if (!['sleep', 'lock', 'restart', 'shutdown', 'signout', 'cancel_shutdown'].includes(a.mode)) return fail('Unknown power action.');
      return { ok: true, action: { type: a.type, mode: a.mode } };
    }
    case 'SCREENSHOT': {
      const mode = a.mode === 'screen' ? 'screen' : 'window';
      return { ok: true, action: { type: a.type, mode } };
    }
    default:
      return { ok: true, action: { type: a.type } };
  }
}

function needsConfirmation(actions) {
  return actions.some((a) => CONSEQUENTIAL.has(a.type) || (a.type === 'POWER' && RISKY_POWER.has(a.mode)));
}

function describe(a, settings, pendingPrompt) {
  const apps = (settings && settings.apps) || {};
  const label = (id) => (apps[id] ? apps[id].label : id);
  switch (a.type) {
    case 'CREATE_FOLDER': {
      const r = resolveFolder(a.name, a.location, settings);
      return r.ok ? `Create folder ${r.path}` : `Create folder "${a.name}"`;
    }
    case 'OPEN_FOLDER': return `Open folder "${a.name}"${a.location ? ` in ${a.location}` : ''}`;
    case 'OPEN_APP': return `Open or focus ${label(a.appId)}`;
    case 'FOCUS_APP': return `Focus ${label(a.appId)} (no launch)`;
    case 'OPEN_URL': return `Open ${a.url} in the browser`;
    case 'BROWSER_NEW_TAB': return 'Browser: new tab (Ctrl+T)';
    case 'BROWSER_NEXT_TAB': return 'Browser: next tab (Ctrl+Tab)';
    case 'BROWSER_PREVIOUS_TAB': return 'Browser: previous tab (Ctrl+Shift+Tab)';
    case 'DICTATE_TEXT': return `Type into assistant (NOT submitted): “${a.text}”`;
    case 'SEND_PENDING_TEXT': return pendingPrompt ? `SEND the pending prompt: “${pendingPrompt.text}”` : 'Send the pending prompt';
    case 'CLEAR_PENDING_TEXT': return 'Clear the assistant composer (Ctrl+A, Delete)';
    case 'VS_CODE_GOTO_LINE': return `VS Code: go to line ${a.line}`;
    case 'VS_CODE_FIND': return `VS Code: find “${a.query}” in the current file (literal text)`;
    case 'VS_CODE_OPEN_COPILOT': return 'VS Code: open Copilot chat (configured shortcut)';
    case 'UNDO_LAST': return 'Undo: remove the last created folder if it is still empty';
    case 'LAUNCH_APP': return `Launch the installed app matching “${a.name}”`;
    case 'FOCUS_WINDOW': return `Switch to the window matching “${a.query}”`;
    case 'TYPE_TEXT': return `Type into the active window: “${a.text}”`;
    case 'PRESS_KEYS': return `Press keys ${a.keys} in the active window`;
    case 'MOUSE_MOVE': return a.position ? `Move the cursor to ${a.position}` : `Move the cursor ${a.direction} ${a.amount} px`;
    case 'MOUSE_CLICK': return `${a.count === 2 ? 'Double-click' : 'Click'} (${a.button}) at the cursor`;
    case 'WINDOW_SNAP': return a.mode === 'left' || a.mode === 'right' ? `Snap the active window to the ${a.mode} half` : `${a.mode[0].toUpperCase()}${a.mode.slice(1)} the active window`;
    case 'WINDOW_CLOSE': return 'CLOSE the active window';
    case 'POWER': return a.mode === 'cancel_shutdown' ? 'Cancel a pending shutdown/restart' : `POWER: ${a.mode.replace('_', ' ')} this computer`;
    case 'SCREENSHOT': return a.mode === 'screen' ? 'Take a full-screen screenshot' : 'Take a screenshot of the active window';
    default: return a.type;
  }
}

function validateSettings(s) {
  const e = (m) => ({ ok: false, error: m });
  const str = (v, max) => typeof v === 'string' && v.length <= max;
  if (!s || typeof s !== 'object') return e('Settings must be an object.');
  if (!str(s.hotkey, 40) || !/^[A-Za-z0-9+]+$/.test(s.hotkey)) return e('Invalid hotkey.');
  if (!str(s.fallbackHotkey, 40) || !/^[A-Za-z0-9+]+$/.test(s.fallbackHotkey)) return e('Invalid fallback hotkey.');
  if (!s.speech || !/^[a-z]{2}-[A-Z]{2}$/.test(s.speech.culture) || !Number.isInteger(+s.speech.timeoutSec) || s.speech.timeoutSec < 3 || s.speech.timeoutSec > 30) {
    return e('Speech settings invalid (culture like en-US, timeout 3-30 s).');
  }
  if (!s.approvedLocations || typeof s.approvedLocations !== 'object') return e('approvedLocations missing.');
  for (const [k, v] of Object.entries(s.approvedLocations)) {
    if (!/^[a-z0-9_-]{1,30}$/.test(k)) return e(`Bad location key "${k}".`);
    if (!str(v, 260) || !path.isAbsolute(v) || path.parse(v).root === v) return e(`Location "${k}" must be an absolute folder path (not a drive root).`);
  }
  if (!s.apps || !s.apps.vscode || !s.apps.browser) return e('apps.vscode and apps.browser are required.');
  for (const [id, a] of Object.entries(s.apps)) {
    if (!/^[a-z0-9_-]{1,30}$/.test(id)) return e(`Bad app id "${id}".`);
    if (!a || !str(a.label, 40) || !Array.isArray(a.aliases) || a.aliases.length > 10 || !a.aliases.every((x) => str(x, 40))) return e(`App "${id}" is malformed.`);
    if (!str(a.processName, 60) || !/^[A-Za-z0-9._-]+$/.test(a.processName)) return e(`App "${id}": invalid process name.`);
    if (!str(a.exe, 260) || (a.exe && (!path.isAbsolute(a.exe) || !/\.exe$/i.test(a.exe)))) return e(`App "${id}": executable must be empty or an absolute path ending in .exe.`);
  }
  const as = s.assistant;
  if (!as || !normalizeUrl(as.url).ok || !str(as.titleHint, 40) || !as.titleHint) return e('Assistant URL or title hint invalid.');
  if (!Number.isInteger(+as.pageLoadDelayMs) || as.pageLoadDelayMs < 500 || as.pageLoadDelayMs > 30000) return e('Page load wait must be 500-30000 ms.');
  if (!isValidKeys(as.focusInputKeys)) return e('Assistant focus keys invalid.');
  if (!isValidKeys(s.copilotShortcut)) return e('Copilot shortcut invalid (SendKeys form like ^%i).');
  if (!Number.isInteger(+s.autoRunDelayMs) || s.autoRunDelayMs < 0 || s.autoRunDelayMs > 10000) return e('Auto-run delay must be 0-10000 ms.');
  if (typeof s.confirmAll !== 'boolean' || typeof s.speakResults !== 'boolean') return e('confirmAll/speakResults must be booleans.');
  if (!Array.isArray(s.aliases)) return e('aliases must be an array.');
  return { ok: true, settings: s };
}

module.exports = {
  SPECS, CONSEQUENTIAL, ALIAS_FORBIDDEN,
  validateFolderName, resolveFolder, resolveOpenFolder, normalizeUrl, isValidKeys,
  validateAction, needsConfirmation, describe, validateSettings,
};