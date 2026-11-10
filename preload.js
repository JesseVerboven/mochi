'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const CHANNELS = new Set(['cursor', 'event', 'stats', 'state', 'geometry', 'settings', 'media', 'shelf', 'shelf-drag-end', 'debug']);

contextBridge.exposeInMainWorld('companion', {
  on: (channel, cb) => {
    if (CHANNELS.has(channel)) ipcRenderer.on(channel, (_e, data) => cb(data));
  },
  ready: () => ipcRenderer.send('ready'),
  setInteractive: (on) => ipcRenderer.send('interactive', !!on),
  captureSource: () => ipcRenderer.invoke('capture-source'),
  mediaCmd: (cmd) => ipcRenderer.send('media-cmd', String(cmd)),
  setSetting: (key, value) => ipcRenderer.send('settings:set', String(key), value),
  openSettings: () => ipcRenderer.send('open-settings'),
  // file shelf
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  shelfAdd: (paths) => ipcRenderer.send('shelf:add', Array.from(paths, String)),
  shelfRemove: (id) => ipcRenderer.send('shelf:remove', String(id)),
  shelfClear: () => ipcRenderer.send('shelf:clear'),
  shelfOpen: (id) => ipcRenderer.send('shelf:open', String(id)),
  shelfReveal: (id) => ipcRenderer.send('shelf:reveal', String(id)),
  shelfDrag: (ids) => ipcRenderer.send('shelf:drag', ids === 'all' ? 'all' : Array.from(ids, String)),
});
