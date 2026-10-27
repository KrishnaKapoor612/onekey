'use strict';
const path = require('path');

function makeDefaults({ documents, desktop, downloads, localAppData }) {
  const vscodeExe = localAppData ? path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe') : '';
  return {
    hotkey: 'CapsLock',
    fallbackHotkey: 'CommandOrControl+Shift+Space',
    approvedLocations: { documents, desktop, downloads },
    apps: {
      vscode: { label: 'VS Code', aliases: ['vs code', 'vscode', 'visual studio code', 'code'], processName: 'Code', exe: vscodeExe },
      browser: { label: 'Browser', aliases: ['browser', 'web browser', 'chrome', 'edge', 'microsoft edge'], processName: 'chrome', exe: '' },
    },
    assistant: { url: 'https://chatgpt.com/', titleHint: 'ChatGPT', pageLoadDelayMs: 4000, focusInputKeys: '+{ESC}' },
    copilotShortcut: '^%i',
    autoRunDelayMs: 1500,
    confirmAll: false,
    aliases: [],
    llm: {
      enabled: false,
      provider: 'openai',
      model: 'openai/gpt-oss-20b',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: '',
    },
  };
}

module.exports = { makeDefaults };
