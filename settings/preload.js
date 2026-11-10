'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mochi', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (key, value) => ipcRenderer.send('settings:set', String(key), value),
  onChange: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  testNotify: () => ipcRenderer.send('test-notify'),
});
