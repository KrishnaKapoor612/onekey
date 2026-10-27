'use strict';
const api = window.onekey;
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const STATUS_LABEL = {
  idle: 'Ready', listening: 'Listening', pending: 'Pending',
  clarify: 'Input needed', executing: 'Running…',
  success: 'Done', failure: 'Failed', cancelled: 'Cancelled',
};

let historyOpen = false;

// ── Render state ──
function render(s) {
  // Status badge
  const badge = $('statusBadge');
  badge.className = 'status-badge ' + s.status;
  $('statusText').textContent = STATUS_LABEL[s.status] || s.status;

  // Mic button accent when active
  $('micBtn').classList.toggle('active', s.mic === 'active');

  // Message as placeholder when idle, or show in input
  if (s.clearInput) {
    $('cmdInput').value = '';
  }
  if (s.stopListening) {
    $('cmdInput').blur();
  }
  if (s.speakText) {
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(s.speakText);
        u.rate = 1.0;
        window.speechSynthesis.speak(u);
      } catch (_) {}
    }
  }

  if (s.message && s.status !== 'idle') {
    $('cmdInput').placeholder = s.message;
  } else {
    $('cmdInput').placeholder = 'Type or dictate with Wispr Flow...';
  }

  // Confirmation / pending chip
  const showConfirm = s.status === 'pending' && s.preview && s.preview.length;
  $('confirmChip').classList.toggle('hidden', !showConfirm);
  if (showConfirm) {
    const desc = s.preview.join(' → ');
    const prefix = s.pendingMode === 'countdown'
      ? `Auto-run in ${(s.countdownMs / 1000).toFixed(1)}s: `
      : 'Confirm: ';
    $('confirmMsg').textContent = prefix + desc;
    $('confirmBtn').textContent = s.pendingMode === 'countdown' ? 'Run now' : 'Confirm';
  }

  // Also show clarification as a confirm chip
  if (s.status === 'clarify' && s.clarificationQuestion) {
    $('confirmChip').classList.remove('hidden');
    $('confirmMsg').textContent = s.clarificationQuestion;
    $('confirmBtn').classList.add('hidden');
    $('cancelBtn').textContent = 'Cancel';
  } else {
    $('confirmBtn').classList.remove('hidden');
    $('cancelBtn').textContent = 'Cancel';
  }

  // History flyout
  if (historyOpen) renderHistory(s.history || []);

  // Resize window based on what's showing
  api.resize(calcHeight(s));
}

function calcHeight(s) {
  let h = 64; // base pill height
  const showConfirm = (s.status === 'pending' && s.preview && s.preview.length) ||
                      (s.status === 'clarify' && s.clarificationQuestion);
  if (showConfirm) h += 52;
  if (historyOpen) h += 280;
  return h;
}

function renderHistory(history) {
  const ul = $('historyList');
  ul.replaceChildren();
  const items = (history || []).slice(0, 5);
  if (!items.length) {
    ul.appendChild(el('li', 'muted', 'No commands yet.'));
    return;
  }
  items.forEach((e) => {
    const li = el('li');
    li.appendChild(el('div', 'h-phrase', `"${e.phrase}"`));
    const meta = el('div', 'h-meta');
    meta.appendChild(el('span', 'h-time',
      `${new Date(e.time).toLocaleTimeString()} · ${(e.actions || []).join(' → ') || 'none'}`));
    meta.appendChild(el('span', 'h-badge b-' + e.status, e.status));
    li.appendChild(meta);
    ul.appendChild(li);
  });
}

// ── History flyout toggle ──
function toggleHistory() {
  historyOpen = !historyOpen;
  $('historyFlyout').classList.toggle('hidden', !historyOpen);
  $('historyBtn').classList.toggle('open', historyOpen);
  if (historyOpen) api.getState().then((s) => renderHistory(s.history || []));
  api.getState().then((s) => api.resize(calcHeight(s)));
}

// Close history on click outside or Escape
document.addEventListener('click', (e) => {
  if (!historyOpen) return;
  const flyout = $('historyFlyout');
  const btn = $('historyBtn');
  if (!flyout.contains(e.target) && !btn.contains(e.target)) {
    historyOpen = false;
    flyout.classList.add('hidden');
    btn.classList.remove('open');
    api.getState().then((s) => api.resize(calcHeight(s)));
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && historyOpen) {
    historyOpen = false;
    $('historyFlyout').classList.add('hidden');
    $('historyBtn').classList.remove('open');
    api.getState().then((s) => api.resize(calcHeight(s)));
  }
});

// ── Settings dialog ──
const FIELDS = [
  ['hotkey', 'Hotkey (default CapsLock)', 'text'],
  ['fallbackHotkey', 'Fallback hotkey', 'text'],
  ['apps.vscode.exe', 'VS Code executable (.exe)', 'text'],
  ['apps.vscode.processName', 'VS Code process name', 'text'],
  ['apps.browser.exe', 'Browser executable (blank = system default)', 'text'],
  ['apps.browser.processName', 'Browser process name', 'text'],
  ['assistant.url', 'AI assistant URL', 'text'],
  ['assistant.titleHint', 'Assistant tab title contains', 'text'],
  ['assistant.pageLoadDelayMs', 'Page load wait (ms)', 'number'],
  ['copilotShortcut', 'Copilot chat shortcut (SendKeys form)', 'text'],
  ['approvedLocations.documents', 'Approved folder: Documents', 'text'],
  ['approvedLocations.desktop', 'Approved folder: Desktop', 'text'],
  ['approvedLocations.downloads', 'Approved folder: Downloads', 'text'],
  ['autoRunDelayMs', 'Cancel window before auto-run (ms)', 'number'],
  ['confirmAll', 'Confirm every action', 'checkbox'],
  ['llm.enabled', 'Enable LLM fallback parsing', 'checkbox'],
  ['llm.provider', 'LLM provider (openai / gemini / anthropic)', 'text'],
  ['llm.model', 'LLM model name (e.g. llama-3.3-70b-versatile)', 'text'],
  ['llm.apiKey', 'LLM API key (Groq gsk_... / OpenAI / etc.)', 'password'],
  ['llm.baseUrl', 'LLM API base URL (e.g. https://api.groq.com/openai/v1)', 'text'],
];
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) {
  const ks = p.split('.');
  let c = o;
  ks.slice(0, -1).forEach((k) => { c = c[k] = c[k] || {}; });
  c[ks[ks.length - 1]] = v;
}

async function openSettings() {
  api.resize(560);
  const s = await api.getSettings();
  const form = $('form');
  form.replaceChildren();
  FIELDS.forEach(([path, label, type]) => {
    const l = el('label', null, label);
    const i = el('input');
    i.type = type;
    i.dataset.path = path;
    if (type === 'checkbox') i.checked = !!getPath(s, path);
    else i.value = getPath(s, path) ?? '';
    l.appendChild(i);
    form.appendChild(l);
  });
  $('settingsErr').textContent = '';
  $('dlg').showModal();
}
async function saveSettings() {
  const patch = {};
  $('form').querySelectorAll('input').forEach((i) => {
    const v = i.type === 'checkbox' ? i.checked : i.type === 'number' ? Number(i.value) : i.value.trim();
    setPath(patch, i.dataset.path, v);
  });
  const r = await api.saveSettings(patch);
  $('settingsErr').textContent = r.ok ? '' : r.error;
  if (r.ok) {
    $('dlg').close();
    api.getState().then((st) => api.resize(calcHeight(st)));
  }
}

// ── Aliases ──
let editing = '';
function renderAliases() {
  api.getSettings().then((s) => {
    const ul = $('aliasList');
    ul.replaceChildren();
    (s.aliases || []).forEach((a) => {
      const li = el('li');
      li.appendChild(el('div', null, `"${a.phrase}" → ${a.actions.map((x) => x.type).join(' → ')}`));
      const row = el('div', 'alias-row');
      const test = el('button', null, 'Test');
      test.onclick = () => { $('dlg').close(); api.submit(a.phrase); };
      const edit = el('button', null, 'Edit');
      edit.onclick = () => { editing = a.phrase; $('aliasPhrase').value = a.phrase; $('aliasActions').value = JSON.stringify(a.actions, null, 2); };
      const del = el('button', null, 'Delete');
      del.onclick = async () => { await api.deleteAlias(a.phrase); };
      row.append(test, edit, del);
      li.appendChild(row);
      ul.appendChild(li);
    });
  });
}
function aliasDef() {
  let actions;
  try { actions = JSON.parse($('aliasActions').value); } catch (e) { $('aliasErr').textContent = 'Actions must be valid JSON.'; return null; }
  $('aliasErr').textContent = '';
  return { phrase: $('aliasPhrase').value, actions, editing };
}
async function aliasPreview(save) {
  const d = aliasDef();
  if (!d) return;
  const r = await (save ? api.saveAlias(d) : api.previewAlias(d));
  const ul = $('aliasPrev');
  ul.replaceChildren();
  if (!r.ok) { $('aliasErr').textContent = r.error; return; }
  $('aliasErr').textContent = '';
  r.preview.forEach((p, i) => ul.appendChild(el('li', null, `${i + 1}. ${p}`)));
  if (save) { editing = ''; $('aliasPhrase').value = ''; $('aliasActions').value = ''; }
}

// ── Wiring ──
function trySubmitText(raw) {
  const v = raw.trim();
  if (v) {
    api.submit(v);
    $('cmdInput').value = '';
  }
}

// Auto-submit when user presses physical Enter
$('cmdInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    trySubmitText($('cmdInput').value);
  }
});

let autoCmdTimer = null;

// Auto-submit when user speaks "enter" / "and enter" / "hit enter" or "Wispr Flow" / "and Wispr Flow" via Wispr Flow
function checkAutoSubmit() {
  const val = $('cmdInput').value;
  if (!val) return;

  // Immediate local clear if user types or dictates "clear input"
  if (/^clear\s+(?:the\s+)?(?:current\s+)?(?:input|prompt|text|bar)$/i.test(val.trim())) {
    $('cmdInput').value = '';
    api.submit('clear the current input');
    return;
  }

  // Check if text has newlines from dictation
  if (/[\r\n]+$/.test(val)) {
    const clean = val.replace(/[\r\n]+$/, '').trim();
    if (clean) trySubmitText(clean);
    return;
  }

  // Detect spoken "enter", "and enter", "hit enter" or "Wispr Flow", "and Wispr Flow"
  let text = val.trimEnd();
  const triggerPattern = /(?:[,.]?\s+|^)(?:and\s+)?(?:hit\s+|press\s+)?(?:enter|wispr\s*flow)[.?!]*\s*$/i;
  let matched = false;
  while (triggerPattern.test(text)) {
    matched = true;
    text = text.replace(triggerPattern, '').trimEnd();
  }
  if (matched) {
    clearTimeout(autoCmdTimer);
    const clean = text.replace(/[,;.]\s*$/, '').trim();
    if (clean) {
      trySubmitText(clean);
    }
    return;
  }

  // Auto-submit quick control commands if dictated/typed alone without trailing trigger
  const cleanCmd = val.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (/^undo(?:\s+last(?:\s+action)?)?$/.test(cleanCmd)) {
    clearTimeout(autoCmdTimer);
    autoCmdTimer = setTimeout(() => {
      if ($('cmdInput').value.trim().toLowerCase().replace(/[.!?]+$/, '') === cleanCmd) {
        trySubmitText(cleanCmd);
      }
    }, 450);
  }
}

$('cmdInput').addEventListener('input', checkAutoSubmit);
$('cmdInput').addEventListener('keyup', checkAutoSubmit);
$('cmdInput').addEventListener('paste', () => setTimeout(checkAutoSubmit, 50));
$('micBtn').onclick = () => {
  $('cmdInput').focus();
  $('cmdInput').select();
};
$('confirmBtn').onclick = () => api.confirm();
$('cancelBtn').onclick = () => api.cancel();
$('historyBtn').onclick = toggleHistory;
if ($('settingsBtn')) $('settingsBtn').onclick = openSettings;
$('undoBtn').onclick = () => api.submit('undo last action');

// Settings wiring
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === ',') openSettings();
});
$('saveSettings').onclick = saveSettings;
$('closeDlg').onclick = () => {
  $('dlg').close();
  api.getState().then((st) => api.resize(calcHeight(st)));
};
$('aliasPreview').onclick = () => aliasPreview(false);
$('aliasSave').onclick = () => aliasPreview(true);
$('form').addEventListener('submit', (e) => e.preventDefault());

api.onState(render);
api.getState().then(render);
