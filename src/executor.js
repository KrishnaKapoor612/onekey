'use strict';
const nodePath = require('path');
const { validateAction, resolveFolder, normalizeUrl } = require('./schema');
const { matchApps } = require('./appmatch');

const ok = (message, extra) => ({ ok: true, status: 'success', message, ...extra });
const sent = (message, extra) => ({ ok: true, status: 'unverified', message, ...extra });
const fail = (message, extra) => ({ ok: false, status: 'failed', message, ...extra });

function undoEligibility(fs, p, settings) {
  const bases = Object.values(settings.approvedLocations || {}).map((b) => nodePath.resolve(b));
  const full = nodePath.resolve(p);
  if (!bases.some((b) => nodePath.dirname(full) === b)) return { ok: false, reason: 'That folder is not directly inside an approved location.' };
  let st;
  try { st = fs.lstatSync(full); } catch (_) { return { ok: false, reason: 'The folder no longer exists.' }; }
  if (!st.isDirectory()) return { ok: false, reason: 'The path is not a folder.' };
  if (fs.readdirSync(full).length > 0) return { ok: false, reason: 'The folder is not empty, so it was left alone.' };
  return { ok: true };
}

const WINDOW_LABEL = {
  snap_left: 'Snapped to the left half',
  snap_right: 'Snapped to the right half',
  maximize: 'Maximized',
  minimize: 'Minimized',
  restore: 'Restored',
};

function createExecutor(deps) {
  const { fs, win, sys, launch, openExternal, clipboard, sleep, getSettings } = deps;
  const exists = (p) => { try { fs.lstatSync(p); return true; } catch (_) { return false; } };
  const needSys = () => (sys ? null : fail('This action needs the system helper, which is not available.'));

  const keyFail = (k) => fail(k.error === 'wrong-focus' ? 'Focus moved away from the target window; keys were NOT sent.' : (k.message || 'Key injection failed.'));
  const focusFailure = (f, app) => {
    if (f.error === 'ambiguous') return { ok: false, status: 'needs_choice', message: `More than one ${app.label} window is open.`, choices: f.windows };
    if (f.error === 'no-window') return fail(`No ${app.label} window found.`);
    return fail(f.message || `Windows refused to bring ${app.label} to the front. Click it manually and retry.`);
  };

  async function openUrl(url, settings) {
    const n = normalizeUrl(url);
    if (!n.ok) return fail(n.error);
    const b = settings.apps.browser;
    if (b.exe) {
      if (!exists(b.exe)) return fail(`Configured browser executable not found: ${b.exe}`);
      await launch(b.exe, [n.url]);
    } else {
      await openExternal(n.url);
    }
    return sent(`Handed ${n.url} to the browser. Page load is not verified.`);
  }

  async function pasteText(app, text) {
    const prev = clipboard.readText();
    clipboard.writeText(text);
    try {
      const k = await win.keys({ processName: app.processName, keys: '^v' });
      await sleep(250);
      return k;
    } finally {
      clipboard.writeText(prev); // text clipboard only; images/files are not restored
    }
  }

  // Paste into whatever window the user was last working in (never into OneKey itself).
  async function pasteForeground(text) {
    const prev = clipboard.readText();
    clipboard.writeText(text);
    try {
      const k = await sys.keys('^v');
      await sleep(250);
      return k;
    } finally {
      clipboard.writeText(prev);
    }
  }

  async function findAssistant(settings) {
    const hint = settings.assistant.titleHint.toLowerCase();
    const l = await win.list(settings.apps.browser.processName);
    if (!l.ok) return { error: l };
    const m = l.windows.filter((w) => w.title.toLowerCase().includes(hint));
    return { match: m.find((w) => w.active) || m[0] || null };
  }

  // Only ever types into a browser window whose ACTIVE tab title contains the configured hint.
  async function activateAssistant(settings, openIfMissing) {
    const br = settings.apps.browser;
    let f = await findAssistant(settings);
    if (f.error) return { fail: fail(f.error.message || 'Cannot enumerate browser windows.') };
    let opened = false;
    if (!f.match && openIfMissing) {
      const o = await openUrl(settings.assistant.url, settings);
      if (!o.ok) return { fail: o };
      opened = true;
      await sleep(settings.assistant.pageLoadDelayMs);
      f = await findAssistant(settings);
      if (f.error) return { fail: fail(f.error.message || 'Cannot enumerate browser windows.') };
    }
    if (!f.match) {
      return { fail: fail(`No browser window has an active tab titled "${settings.assistant.titleHint}", so nothing was typed. ${opened ? 'The page may still be loading; try again.' : 'Say "open ChatGPT" first.'}`) };
    }
    const fr = await win.focus({ processName: br.processName, targetId: f.match.handle });
    if (!fr.ok || !fr.verified) return { fail: fail('Could not bring the assistant window to the front. Click it and try again.') };
    return { ok: true };
  }

  async function browserKeys(settings, keys, label) {
    try {
      if (sys && sys.keys) {
        const r = await sys.keys(keys);
        if (r && r.ok) return sent(`Sent ${label} to the active window.`);
      }
    } catch (_) {}
    const br = settings.apps.browser;
    if (br && br.processName) {
      const f = await win.focus({ processName: br.processName });
      if (f.ok) {
        const k = await win.keys({ processName: br.processName, keys });
        if (k.ok) return sent(`Sent ${label} to ${br.label}. The effect cannot be verified.`);
      }
    }
    return fail(`Could not send ${label}. Make sure your browser or window is open.`);
  }

  async function vsPrepare(settings) {
    const app = settings.apps.vscode;
    const l = await win.list(app.processName);
    if (!l.ok) return { fail: fail(l.message || 'Cannot enumerate windows.') };
    if (!l.windows.length) return { fail: fail('VS Code is not running. Say "open VS Code" first.') };
    const f = await win.focus({ processName: app.processName });
    if (!f.ok) return { fail: focusFailure(f, app) };
    return { app };
  }
  const VS_NOTE = 'OneKey cannot verify the editor had focus; if nothing happened, click into the editor and retry.';

  async function execute(rawAction, session) {
    const settings = getSettings();
    const v = validateAction(rawAction, settings);
    if (!v.ok) return fail(v.error || (v.clarify && v.clarify.question) || 'Invalid action.');
    const a = v.action;
    try {
      switch (a.type) {
        case 'CREATE_FOLDER': {
          const r = resolveFolder(a.name, a.location, settings);
          if (!exists(r.base)) return fail(`Approved location does not exist: ${r.base}`);
          if (exists(r.path)) return fail(`"${r.path}" already exists. Nothing was changed.`);
          fs.mkdirSync(r.path); // non-recursive, throws if it exists
          if (!fs.statSync(r.path).isDirectory()) return fail('Folder creation could not be confirmed.');
          return ok(`Created folder ${r.path}`, { undo: { kind: 'folder', path: r.path } });
        }
        case 'OPEN_FOLDER': {
          const approved = settings.approvedLocations || {};
          let targetPath = null;
          if (a.location && approved[a.location]) {
            const candidate = nodePath.resolve(approved[a.location], a.name);
            if (exists(candidate)) targetPath = candidate;
          } else {
            for (const loc of Object.values(approved)) {
              const candidate = nodePath.resolve(loc, a.name);
              if (exists(candidate)) {
                targetPath = candidate;
                break;
              }
            }
          }
          if (!targetPath) {
            return fail(`Folder "${a.name}" was not found${a.location ? ` in ${a.location}` : ' in approved locations'}.`);
          }
          try {
            await launch('explorer.exe', [targetPath]);
          } catch (err) {
            return fail(`Could not open File Explorer: ${err.message}`);
          }
          return ok(`Opened folder "${a.name}".`);
        }
        case 'OPEN_APP':
        case 'FOCUS_APP': {
          const app = settings.apps[a.appId];
          const l = await win.list(app.processName);
          const running = l.ok && l.windows.length > 0;
          if (running || a.type === 'FOCUS_APP') {
            const f = await win.focus({ processName: app.processName, targetId: a.targetId });
            if (!f.ok) return focusFailure(f, app);
            return f.verified ? ok(`Focused ${app.label}.`) : sent(`Asked Windows to focus ${app.label}; focus not confirmed.`);
          }
          if (!app.exe) return fail(`${app.label} is not running and no executable is configured. Set it in Settings.`);
          if (!exists(app.exe)) return fail(`Configured executable not found: ${app.exe}`);
          await launch(app.exe, []);
          for (let i = 0; i < 20; i++) {
            await sleep(500);
            const l2 = await win.list(app.processName);
            if (l2.ok && l2.windows.length) {
              const f = await win.focus({ processName: app.processName });
              if (f.ok && f.verified) return ok(`Launched and focused ${app.label}.`);
              return sent(`Launched ${app.label}; focus not confirmed.`);
            }
          }
          return sent(`Launched ${app.label}, but no window was detected within 10 s.`);
        }
        case 'OPEN_URL':
          return openUrl(a.url, settings);
        case 'BROWSER_NEW_TAB': return browserKeys(settings, '^t', 'Ctrl+T');
        case 'BROWSER_NEXT_TAB': return browserKeys(settings, '^{TAB}', 'Ctrl+Tab');
        case 'BROWSER_PREVIOUS_TAB': return browserKeys(settings, '^+{TAB}', 'Ctrl+Shift+Tab');

        case 'DICTATE_TEXT': {
          const act = await activateAssistant(settings, true);
          if (act.fail) return act.fail;
          const br = settings.apps.browser;
          let k = await win.keys({ processName: br.processName, keys: settings.assistant.focusInputKeys });
          if (!k.ok) return keyFail(k);
          await sleep(300);
          k = await pasteText(br, a.text);
          if (!k.ok) return keyFail(k);
          session.setPendingPrompt({ text: a.text, at: Date.now() });
          return sent(`Entered ${a.text.length} characters into the assistant composer. NOT submitted. Check the text is present, then say "send".`);
        }
        case 'SEND_PENDING_TEXT': {
          if (!session.getPendingPrompt()) return fail('There is no pending prompt to send.');
          const act = await activateAssistant(settings, false);
          if (act.fail) return act.fail;
          const br = settings.apps.browser;
          let k = await win.keys({ processName: br.processName, keys: settings.assistant.focusInputKeys });
          if (!k.ok) return keyFail(k);
          await sleep(250);
          k = await win.keys({ processName: br.processName, keys: '{ENTER}' });
          if (!k.ok) return keyFail(k);
          session.setPendingPrompt(null);
          return sent('Pressed Enter in the assistant composer. Submission cannot be verified; check the page.');
        }
        case 'CLEAR_PENDING_TEXT': {
          if (!session.getPendingPrompt()) return fail('There is no pending prompt to clear.');
          const act = await activateAssistant(settings, false);
          if (act.fail) return act.fail;
          const br = settings.apps.browser;
          let k = await win.keys({ processName: br.processName, keys: settings.assistant.focusInputKeys });
          if (!k.ok) return keyFail(k);
          await sleep(250);
          k = await win.keys({ processName: br.processName, keys: '^a|sleep:100|{DEL}' });
          if (!k.ok) return keyFail(k);
          session.setPendingPrompt(null);
          return sent('Sent Select-All + Delete to the assistant composer. Clearing cannot be verified.');
        }

        case 'VS_CODE_GOTO_LINE': {
          const p = await vsPrepare(settings);
          if (p.fail) return p.fail;
          const k = await win.keys({ processName: p.app.processName, keys: `^g|sleep:250|${a.line}|sleep:150|{ENTER}` });
          return k.ok ? sent(`Sent Go to Line ${a.line} to VS Code. ${VS_NOTE}`) : keyFail(k);
        }
        case 'VS_CODE_FIND': {
          const p = await vsPrepare(settings);
          if (p.fail) return p.fail;
          let k = await win.keys({ processName: p.app.processName, keys: '^f|sleep:250|^a' });
          if (!k.ok) return keyFail(k);
          await sleep(100);
          k = await pasteText(p.app, a.query); // literal text via clipboard, never a command
          return k.ok ? sent(`Opened Find in VS Code and entered the literal search text. ${VS_NOTE}`) : keyFail(k);
        }
        case 'VS_CODE_OPEN_COPILOT': {
          const p = await vsPrepare(settings);
          if (p.fail) return p.fail;
          const k = await win.keys({ processName: p.app.processName, keys: settings.copilotShortcut });
          return k.ok ? sent(`Sent the configured Copilot shortcut (${settings.copilotShortcut}). Requires the Copilot extension and default keybindings.`) : keyFail(k);
        }

        // ---------- generic actions (work with any installed app / window) ----------
        case 'LAUNCH_APP': {
          const n = needSys(); if (n) return n;
          const r = await sys.apps();
          if (!r.ok) return fail(r.message || 'Could not list installed apps.');
          const m = matchApps(a.name, r.apps);
          if (!m.length) return fail(`No installed app matches "${a.name}". Use the name shown in the Start menu.`);
          if (m.length > 1) return fail(`Several apps match "${a.name}": ${m.map((x) => x.name).join(', ')}. Say the full name.`);
          const l = await sys.launch(m[0].appId);
          return l.ok ? sent(`Asked Windows to start ${m[0].name}. Launch is not verified.`) : fail(l.message || `Could not start ${m[0].name}.`);
        }
        case 'FOCUS_WINDOW': {
          const n = needSys(); if (n) return n;
          const f = await sys.focusWindow({ query: a.query, targetId: a.targetId });
          if (f.error === 'ambiguous') return { ok: false, status: 'needs_choice', message: `More than one window matches "${a.query}".`, choices: f.windows };
          if (f.error === 'no-window') return fail(`No open window matches "${a.query}".`);
          if (!f.ok) return fail(f.message || 'Windows refused to bring that window to the front.');
          return ok(`Focused "${f.window ? f.window.title : a.query}".`);
        }
        case 'TYPE_TEXT': {
          const n = needSys(); if (n) return n;
          const k = await pasteForeground(a.text);
          return k.ok ? sent(`Typed ${a.text.length} characters into ${k.window ? `"${k.window.title}"` : 'the active window'}. Not verified.`) : keyFail(k);
        }
        case 'PRESS_KEYS': {
          const n = needSys(); if (n) return n;
          const k = await sys.keys(a.keys);
          return k.ok ? sent(`Sent keys ${a.keys} to ${k.window ? `"${k.window.title}"` : 'the active window'}. The effect cannot be verified.`) : keyFail(k);
        }
        case 'MOUSE_MOVE': {
          const n = needSys(); if (n) return n;
          const r = await sys.mouse({ op: 'move', mode: a.position || a.direction, amount: a.amount });
          return r.ok ? ok(a.position ? `Moved the cursor to ${a.position}.` : `Moved the cursor ${a.direction} ${a.amount} px.`) : fail(r.message || 'Could not move the cursor.');
        }
        case 'MOUSE_CLICK': {
          const n = needSys(); if (n) return n;
          const r = await sys.mouse({ op: 'click', mode: a.button, amount: a.count });
          return r.ok ? sent(`${a.count === 2 ? 'Double-clicked' : 'Clicked'} (${a.button}) at the cursor. The effect cannot be verified.`) : fail(r.message || 'Click failed.');
        }
        case 'WINDOW_SNAP': {
          const n = needSys(); if (n) return n;
          const mode = a.mode === 'left' ? 'snap_left' : a.mode === 'right' ? 'snap_right' : a.mode;
          const r = await sys.windowOp({ mode });
          if (!r.ok) return fail(r.error === 'no-window' ? 'No other window found to move.' : (r.message || 'Window operation failed.'));
          return sent(`${WINDOW_LABEL[mode]}: "${r.window ? r.window.title : 'window'}".`);
        }
        case 'WINDOW_CLOSE': {
          const n = needSys(); if (n) return n;
          const r = await sys.windowOp({ mode: 'close' });
          if (!r.ok) return fail(r.error === 'no-window' ? 'No other window found to close.' : (r.message || 'Window operation failed.'));
          return sent(`Asked "${r.window ? r.window.title : 'the window'}" to close. It may still prompt to save.`);
        }
        case 'POWER': {
          const n = needSys(); if (n) return n;
          const r = await sys.power(a.mode);
          if (!r.ok) return fail(r.message || `Power action "${a.mode}" failed.`);
          if (a.mode === 'shutdown') return sent('Shutdown scheduled in 30 seconds. Say "cancel shutdown" to abort.');
          if (a.mode === 'restart') return sent('Restart scheduled in 30 seconds. Say "cancel restart" to abort.');
          if (a.mode === 'cancel_shutdown') return ok('Pending shutdown/restart cancelled.');
          return sent(`Requested ${a.mode}.`);
        }
        case 'SCREENSHOT': {
          const n = needSys(); if (n) return n;
          const r = await sys.screenshot({ mode: a.mode });
          if (!r.ok) return fail(r.message || 'Screenshot failed.');
          return ok(`Screenshot saved: ${r.file} in Pictures\\Screenshots.`);
        }

        case 'UNDO_LAST': {
          const u = session.getUndoable();
          if (!u) return fail('Nothing to undo.');
          const el = undoEligibility(fs, u.undo.path, settings);
          if (!el.ok) return fail(`Undo refused: ${el.reason}`);
          fs.rmdirSync(u.undo.path); // non-recursive: fails on non-empty directories
          session.markUndone(u.id);
          return ok(`Removed empty folder ${u.undo.path}`);
        }
        default:
          return fail(`No executor for ${a.type}.`);
      }
    } catch (e) {
      return fail(`Action failed: ${e && e.code ? e.code + ' - ' : ''}${e && e.message ? e.message : e}`);
    }
  }

  return { execute };
}

module.exports = { createExecutor, undoEligibility };
