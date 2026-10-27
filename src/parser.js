'use strict';

const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function wordsToNumber(s) {
  const p = s.trim().toLowerCase().split(/[\s-]+/);
  if (p.length === 1) {
    if (has(ONES, p[0])) return String(ONES[p[0]]);
    if (has(TENS, p[0])) return String(TENS[p[0]]);
  }
  if (p.length === 2 && has(TENS, p[0]) && has(ONES, p[1]) && ONES[p[1]] > 0 && ONES[p[1]] < 10) return String(TENS[p[0]] + ONES[p[1]]);
  return s.trim();
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[,]/g, ' ').replace(/[.!?;:]+$/g, '').replace(/\s+/g, ' ').trim();
}

function resolveApps(phrase, apps) {
  const p = normalize(phrase);
  return Object.keys(apps || {}).filter((id) => {
    const a = apps[id];
    return normalize(a.label) === p || a.aliases.some((x) => normalize(x) === p);
  });
}

const KEY_MODS = { control: '^', ctrl: '^', alt: '%', shift: '+' };
const KEY_NAMES = {
  enter: '{ENTER}', return: '{ENTER}', escape: '{ESC}', esc: '{ESC}', tab: '{TAB}', backspace: '{BKSP}', delete: '{DEL}',
  home: '{HOME}', end: '{END}', up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}', pageup: '{PGUP}', pagedown: '{PGDN}',
};
// "control shift t" -> "^+t"; returns null if it is not a recognisable key combination.
function spokenKeys(s) {
  const toks = normalize(s).replace(/\bplus\b/g, ' ').replace(/\bpage (up|down)\b/g, 'page$1').split(' ').filter(Boolean);
  if (!toks.length) return null;
  let mods = '';
  let i = 0;
  while (i < toks.length - 1 && has(KEY_MODS, toks[i])) mods += KEY_MODS[toks[i++]];
  if (i !== toks.length - 1) return null;
  const k = toks[i];
  let key = has(KEY_NAMES, k) ? KEY_NAMES[k] : null;
  if (!key && /^f([1-9]|1[0-2])$/.test(k)) key = `{${k.toUpperCase()}}`;
  if (!key && /^[a-z0-9]$/.test(k)) key = k;
  if (!key) { const n = wordsToNumber(k); if (/^[0-9]$/.test(n)) key = n; }
  return key ? mods + key : null;
}

function amountFrom(str, dflt) {
  if (!str) return dflt;
  const n = parseInt(wordsToNumber(str), 10);
  return Number.isInteger(n) && n > 0 ? n : dflt;
}

function spokenToUrl(s) {
  return s.trim().replace(/\s+dot\s+/gi, '.').replace(/\s+slash\s+/gi, '/').replace(/\s+/g, '');
}

const ctl = (name, extra) => ({ type: 'control', name, ...(extra || {}) });
const acts = (...a) => ({ type: 'actions', actions: a });

function appClarify(ids, apps, baseType) {
  return { type: 'clarify', clarify: { kind: 'app', baseType, options: ids, question: `Which one did you mean: ${ids.map((i) => apps[i].label).join(' or ')}?` } };
}

function parseTranscript(rawText, ctx) {
  const settings = (ctx && ctx.settings) || {};
  const apps = settings.apps || {};
  let wantEnter = false;
  let orig = String(rawText || '').trim().replace(/[.!?]+$/, '').trim();
  // Strip trailing "enter", "and enter", "hit enter", or "Wispr Flow", "and Wispr Flow" (even repeated or with punctuation/spaces)
  if (!/^(?:hit\s+|press\s+)?enter$/i.test(orig) && !/^(?:and\s+)?wispr\s*flow$/i.test(orig)) {
    const triggerPattern = /[,;.]?\s+(?:and\s+)?(?:hit\s+|press\s+)?(?:enter|wispr\s*flow)[.?!]*\s*$/i;
    while (triggerPattern.test(orig)) {
      wantEnter = true;
      orig = orig.replace(triggerPattern, '').trimEnd();
    }
    orig = orig.replace(/[,;.]\s*$/, '').trim();
  }
  const t = normalize(orig);
  if (!t) return { type: 'unknown' };
  let m;

  // --- control words (whole utterance only) ---
  if (/^(cancel|never mind|nevermind|abort)$/.test(t)) return ctl('cancel');
  if (/^stop listening$/.test(t)) return ctl('stop_listening');
  if (/^clear (the )?(current )?(input|prompt|text|bar)$/.test(t)) return ctl('clear');
  if (/^undo( the)?( last)?( action)?$/.test(t)) return ctl('undo');
  if (/^(confirm|confirmed|yes|yes send|yes send it|go ahead|do it)$/.test(t)) return ctl('confirm');
  if ((m = /^(?:replace\s+(?:the\s+)?(?:content|text)|replace\s+the\s+last\s+sentence|replace)\s+with\s+(.+)$/is.exec(orig))) return ctl('replace_last_sentence', { text: m[1].trim() });

  // --- user aliases (exact phrase) ---
  const al = ((ctx && ctx.aliases) || []).find((a) => normalize(a.phrase) === t);
  if (al) return { type: 'actions', actions: al.actions, via: 'alias' };

  // --- send: only when the WHOLE utterance is a send phrase ---
  if (/^(send|send it|send that|send the prompt|send the message|send prompt|submit)$/.test(t)) return acts({ type: 'SEND_PENDING_TEXT' });

  // --- dictation: everything after the trigger is verbatim text, never parsed again ---
  if ((m = /^(?:ask|tell|prompt)\s+(?:chat\s?gpt|the assistant|the ai|ai)\b\s*[:,]?\s*(.+)$/is.exec(orig))) {
    return acts({ type: 'DICTATE_TEXT', text: m[1].trim() });
  }

  // --- folder ---
  if ((m = /^(?:create|make|new)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:folder|directory)(?:\s+(?:called|named))?\s+(.+)$/is.exec(orig))) {
    let name = m[1].trim();
    let location = '';
    const keys = Object.keys(settings.approvedLocations || {}).map((k) => k.replace(/[^a-z0-9_-]/g, ''));
    if (keys.length) {
      const lm = new RegExp(`^(.*?)\\s+(?:in|inside|under|on)\\s+(?:my\\s+|the\\s+)?(${keys.join('|')})(?:\\s+folder)?$`, 'is').exec(name);
      if (lm) { name = lm[1].trim(); location = lm[2].toLowerCase(); }
    }
    return acts({ type: 'CREATE_FOLDER', name, location });
  }
  if (/^(create|make|new) (a |an |the )?(new )?(folder|directory)$/.test(t)) return acts({ type: 'CREATE_FOLDER', name: '', location: '' });

  // --- open folder ---
  const locKeys = Object.keys(settings.approvedLocations || {}).map((k) => k.replace(/[^a-z0-9_-]/g, ''));
  const locPattern = locKeys.length ? `(?:in|on|under)\\s+(?:the\\s+|my\\s+)?(${locKeys.join('|')})` : '';

  if ((m = /^(?:open|show)\s+(?:the\s+)?(?:folder|directory)(?:\s+(?:called|named))?\s+(.+)$/is.exec(orig)) ||
      (m = /^(?:open|show)\s+(?:the\s+)?(.+?)\s+(?:folder|directory)(?:\s+(?:present\s+)?(?:in|on|under)\s+(.+))?$/is.exec(orig)) ||
      (locKeys.length && (m = new RegExp(`^(?:open|show)\\s+(?:the\\s+)?(.+?)\\s+(?:present\\s+)?${locPattern}\\s*$`, 'is').exec(orig)))) {
    let name = m[1].trim();
    let location = '';
    if (m[2]) {
      const locCandidate = m[2].trim().toLowerCase().replace(/^(?:the|my)\s+/, '').replace(/\s+/g, '');
      const matched = locKeys.find((k) => k.toLowerCase() === locCandidate);
      if (matched) location = matched;
    } else if (locKeys.length) {
      const lm = new RegExp(`\\s+(?:present\\s+)?(?:in|on|under)\\s+(?:the\\s+|my\\s+)?(${locKeys.join('|')})\\s*$`, 'i').exec(name);
      if (lm) {
        location = lm[1].toLowerCase();
        name = name.slice(0, lm.index).trim();
      }
    }
    name = name.replace(/^["'“”]+|["'“”]+$/g, '').trim();
    if (name) {
      const act = { type: 'OPEN_FOLDER', name };
      if (location) act.location = location;
      return acts(act);
    }
  }

  // --- power (shutdown / restart / sign out always need confirmation; see schema.needsConfirmation) ---
  const PC = '(?:\\s+(?:my\\s+|the\\s+)?(?:laptop|computer|pc|system|machine))?';
  if (new RegExp(`^(?:shut\\s?down|power off)${PC}(?:\\s+now)?$`).test(t) || /^turn off (?:my |the )?(?:laptop|computer|pc|system|machine)$/.test(t)) return acts({ type: 'POWER', mode: 'shutdown' });
  if (new RegExp(`^(?:restart|reboot)${PC}(?:\\s+now)?$`).test(t)) return acts({ type: 'POWER', mode: 'restart' });
  if (new RegExp(`^(?:sleep|go to sleep|suspend)${PC}$`).test(t) || /^put (?:my |the )?(?:laptop|computer|pc) (?:to sleep|in sleep mode)$/.test(t)) return acts({ type: 'POWER', mode: 'sleep' });
  if (/^lock(?:\s+(?:my\s+|the\s+)?(?:laptop|computer|pc|screen|system|machine))?$/.test(t)) return acts({ type: 'POWER', mode: 'lock' });
  if (/^(?:sign out|log out|log off|sign off)$/.test(t)) return acts({ type: 'POWER', mode: 'signout' });
  if (/^(?:cancel|abort|stop)\s+(?:the\s+)?(?:shutdown|restart|reboot)$/.test(t)) return acts({ type: 'POWER', mode: 'cancel_shutdown' });

  // --- window management (acts on the window you were last using, never on Wispr Flow itself) ---
  if ((m = /^(?:snap|(?:move|put|shift|dock)\s+(?:(?:this|the|my|current|active)\s+)*window)\s+(?:window\s+)?(?:to\s+(?:the\s+)?)?(left|right)(?:\s+(?:side|half))?$/.exec(t))) return acts({ type: 'WINDOW_SNAP', mode: m[1] });
  if (/^(?:maximi[sz]e|full\s?screen)(?:\s+(?:this\s+|the\s+|my\s+)?window)?$/.test(t)) return acts({ type: 'WINDOW_SNAP', mode: 'maximize' });
  if (/^minimi[sz]e(?:\s+(?:this\s+|the\s+|my\s+)?window)?$/.test(t)) return acts({ type: 'WINDOW_SNAP', mode: 'minimize' });
  if (/^restore(?:\s+(?:this\s+|the\s+|my\s+)?window)?$/.test(t)) return acts({ type: 'WINDOW_SNAP', mode: 'restore' });
  if (/^close\s+(?:this\s+|the\s+|my\s+|current\s+)?(?:window|app|application|program)$/.test(t)) return acts({ type: 'WINDOW_CLOSE' });

  // --- screenshot ---
  if (/^(?:take\s+(?:a\s+|the\s+)?screenshot|capture\s+(?:a\s+|the\s+)?screenshot|screenshot)$/.test(t)) return acts({ type: 'SCREENSHOT', mode: 'window' });
  if (/^(?:take\s+screenshot\s+of\s+(?:the\s+)?window|screenshot\s+window|window\s+screenshot)$/.test(t)) return acts({ type: 'SCREENSHOT', mode: 'window' });
  if (/^(?:take\s+screenshot\s+of\s+(?:the\s+)?(?:full\s+)?screen|full\s+screenshot|screen\s+screenshot)$/.test(t)) return acts({ type: 'SCREENSHOT', mode: 'screen' });

  // --- mouse ---
  const tm = t.replace(/\s+pixels?$/, '');
  if ((m = /^(?:move|put|send)\s+(?:the\s+)?(?:mouse|cursor|pointer)\s+(?:to\s+(?:the\s+)?)?(center|centre|middle|top left|top right|bottom left|bottom right)$/.exec(tm))) {
    const pos = /^(center|centre|middle)$/.test(m[1]) ? 'center' : m[1].replace(' ', '-');
    return acts({ type: 'MOUSE_MOVE', position: pos });
  }
  if ((m = /^(?:move|shift)\s+(?:the\s+)?(?:mouse|cursor|pointer)\s+(?:to\s+(?:the\s+)?)?(left|right|up|down)(?:\s+by)?(?:\s+(\d+|[a-z]+(?:[\s-][a-z]+)?))?$/.exec(tm))) {
    return acts({ type: 'MOUSE_MOVE', direction: m[1], amount: amountFrom(m[2], 200) });
  }
  if ((m = /^(?:(left|right|double|single)\s+)?click$/.exec(t))) {
    return acts({ type: 'MOUSE_CLICK', button: m[1] === 'right' ? 'right' : 'left', count: m[1] === 'double' ? 2 : 1 });
  }

  // --- zoom controls ---
  if (/^(?:zoom\s+in|magnify)$/.test(t)) return acts({ type: 'PRESS_KEYS', keys: '^{ADD}' });
  if (/^(?:zoom\s+out|shrink)$/.test(t)) return acts({ type: 'PRESS_KEYS', keys: '^{SUBTRACT}' });
  if (/^(?:reset\s+zoom|actual\s+size|normal\s+zoom)$/.test(t)) return acts({ type: 'PRESS_KEYS', keys: '^0' });

  // --- keyboard shortcuts / quick keys ---
  if (/^(?:hit\s+|press\s+)?enter$/.test(t)) return acts({ type: 'PRESS_KEYS', keys: '{ENTER}' });
  if (/^(?:hit\s+|press\s+)?(?:page\s+up|pgup)$/.test(t)) return acts({ type: 'PRESS_KEYS', keys: '{PGUP}' });
  if (/^(?:hit\s+|press\s+)?(?:page\s+down|pgdn)$/.test(t)) return acts({ type: 'PRESS_KEYS', keys: '{PGDN}' });
  if (/^(?:hit\s+|press\s+)?escape$/.test(t)) return acts({ type: 'PRESS_KEYS', keys: '{ESC}' });

  // --- keyboard in whatever window you were using ---
  if ((m = /^(?:press|hit)\s+(.+)$/.exec(t))) {
    const k = spokenKeys(m[1]);
    return k ? acts({ type: 'PRESS_KEYS', keys: k }) : { type: 'unknown' };
  }
  // --- typing into the active window ---
  if ((m = /^(?:now\s+)?(?:please\s+)?(?:just\s+)?type(?:\s+(?:in|into)\s+it|\s+in|\s+here)?(?:\s*[:,.]?\s*)(.+)$/is.exec(orig))) {
    let text = m[1].trim();
    const enterMatch = /[,;.]?\s+(?:and\s+)?(?:hit\s+|press\s+)?enter[.?!]*$/i.exec(text);
    if (enterMatch) {
      text = text.slice(0, enterMatch.index).trim();
      wantEnter = true;
    }
    if (wantEnter) {
      return acts({ type: 'TYPE_TEXT', text }, { type: 'PRESS_KEYS', keys: '{ENTER}' });
    }
    return acts({ type: 'TYPE_TEXT', text });
  }

  // --- VS Code ---
  if ((m = /^go to line (.+)$/.exec(t))) return acts({ type: 'VS_CODE_GOTO_LINE', line: wordsToNumber(m[1]) });
  if ((m = /^(?:find|search for|search)\s+(?:the\s+word\s+)?(.+?)\s+in\s+(?:the\s+|this\s+)?(?:current\s+)?(?:file|document|editor)$/is.exec(orig))) {
    return acts({ type: 'VS_CODE_FIND', query: m[1].trim().replace(/^["'“”]+|["'“”]+$/g, '') });
  }
  if (/^open (the )?(github )?copilot\b/.test(t)) return acts({ type: 'VS_CODE_OPEN_COPILOT' });

  // --- search (web & services) ---
  if ((m = /^(?:search\s+for|search(?:\s+google)?\s+for|google|search\s+the\s+web\s+for)\s+(.+)$/is.exec(orig))) {
    const q = encodeURIComponent(m[1].trim());
    return acts({ type: 'OPEN_URL', url: `https://www.google.com/search?q=${q}` });
  }
  if ((m = /^search\s+youtube\s+for\s+(.+)$/is.exec(orig))) {
    const q = encodeURIComponent(m[1].trim());
    return acts({ type: 'OPEN_URL', url: `https://www.youtube.com/results?search_query=${q}` });
  }
  if ((m = /^search\s+github\s+for\s+(.+)$/is.exec(orig))) {
    const q = encodeURIComponent(m[1].trim());
    return acts({ type: 'OPEN_URL', url: `https://github.com/search?q=${q}` });
  }

  // --- browser ---
  if (/^(open (a )?new tab|new tab|(go|move|switch) to (a |the )?new tab)$/.test(t)) return acts({ type: 'BROWSER_NEW_TAB' });
  if (/^(next tab|switch tab|switch the tab|change tab)$/.test(t)) return acts({ type: 'BROWSER_NEXT_TAB' });
  if (/^(previous|prior|last) tab$/.test(t)) return acts({ type: 'BROWSER_PREVIOUS_TAB' });
  if (/^(open|go to|switch to) (the )?chat ?gpt$/.test(t)) return acts({ type: 'OPEN_URL', url: (settings.assistant && settings.assistant.url) || 'https://chatgpt.com/' });

  // --- apps ---
  if ((m = /^(?:switch to|focus|show)\s+(?:the\s+)?(.+)$/.exec(t))) {
    const ids = resolveApps(m[1], apps);
    if (ids.length === 1) return acts({ type: 'FOCUS_APP', appId: ids[0] });
    if (ids.length > 1) return appClarify(ids, apps, 'FOCUS_APP');
    if (/^(?:switch to|focus)\b/.test(t)) return acts({ type: 'FOCUS_WINDOW', query: m[1] });
    return { type: 'unknown' };
  }
  if ((m = /^(?:open|launch|start)\s+(?:the\s+)?(.+)$/.exec(t))) {
    const ids = resolveApps(m[1], apps);
    if (ids.length === 1) return acts({ type: 'OPEN_APP', appId: ids[0] });
    if (ids.length > 1) return appClarify(ids, apps, 'OPEN_APP');
    const u = spokenToUrl(m[1]);
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(u)) return acts({ type: 'OPEN_URL', url: u });
    return acts({ type: 'LAUNCH_APP', name: m[1] });
  }
  if ((m = /^(?:go to|navigate to|visit|open website)\s+(?:the\s+)?(.+)$/.exec(t))) {
    const ids = resolveApps(m[1], apps);
    if (ids.length === 1) return acts({ type: 'FOCUS_APP', appId: ids[0] });
    if (ids.length > 1) return appClarify(ids, apps, 'FOCUS_APP');
    return acts({ type: 'OPEN_URL', url: spokenToUrl(m[1]) });
  }

  return { type: 'unknown' };
}

module.exports = { parseTranscript, normalize, resolveApps, wordsToNumber, spokenToUrl, spokenKeys };