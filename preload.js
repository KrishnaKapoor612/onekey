'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('onekey', {
  getState: () => ipcRenderer.invoke('state:get'),
  submit: (text) => ipcRenderer.invoke('transcript:submit', { text }),
  confirm: () => ipcRenderer.invoke('pending:confirm'),
  cancel: () => ipcRenderer.invoke('pending:cancel'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (p) => ipcRenderer.invoke('settings:save', p),
  previewAlias: (d) => ipcRenderer.invoke('alias:preview', d),
  saveAlias: (d) => ipcRenderer.invoke('alias:save', d),
  deleteAlias: (phrase) => ipcRenderer.invoke('alias:delete', phrase),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  resize: (h) => ipcRenderer.invoke('window:resize', h),
  speak: (text) => ipcRenderer.invoke('speech:speak', text),
  onState: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on('state', h);
    return () => ipcRenderer.removeListener('state', h);
  },
  onFocusInput: (cb) => {
    ipcRenderer.on('focus-input', cb);
    return () => ipcRenderer.removeListener('focus-input', cb);
  },
});
