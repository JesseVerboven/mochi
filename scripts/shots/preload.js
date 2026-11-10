'use strict';
/*
 * Screenshot harness preload: stands in for Mochi's real bridge, paints a
 * wallpaper for the glass to refract, and plays a scripted scene.
 */
const { contextBridge, ipcRenderer } = require('electron');

const scene = new URLSearchParams(location.search).get('scene') || 'hero';
const handlers = {};
const emit = (ch, d) => (handlers[ch] || []).forEach((f) => f(d));
const at = (ms, fn) => setTimeout(fn, ms);

// ---------------------------------------------------------------- art
function wallpaper() {
  const c = document.createElement('canvas');
  c.width = 1280; c.height = 720;
  const g = c.getContext('2d');
  g.fillStyle = '#0b1026';
  g.fillRect(0, 0, 1280, 720);
  g.filter = 'blur(70px)';
  for (const [x, y, r, col] of [[180, 120, 260, '#ff4fa3'], [980, 40, 240, '#ffb347'], [760, 640, 300, '#2fd6c4'],
    [1200, 420, 220, '#7c4dff'], [420, 520, 200, '#3b82f6'], [620, 140, 150, '#ff7a59']]) {
    g.fillStyle = col;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  g.filter = 'none';
  // a few crisp lines/shapes so the refraction has something to bend
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 2;
  for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(0, 60 + i * 34); g.lineTo(1280, 60 + i * 34); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,.07)';
  g.beginPath(); g.roundRect(140, 210, 1000, 600, 28); g.fill();
  return c.toDataURL('image/png');
}
function albumArt() {
  const c = document.createElement('canvas');
  c.width = c.height = 300;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 300);
  sky.addColorStop(0, '#2b1055'); sky.addColorStop(0.55, '#d53a9d'); sky.addColorStop(1, '#ff9a5a');
  g.fillStyle = sky; g.fillRect(0, 0, 300, 300);
  const sun = g.createLinearGradient(0, 90, 0, 210);
  sun.addColorStop(0, '#ffe58a'); sun.addColorStop(1, '#ff5f7e');
  g.fillStyle = sun; g.beginPath(); g.arc(150, 170, 72, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2b1055';
  for (let i = 0; i < 6; i++) g.fillRect(70, 160 + i * 14, 160, 3 + i * 1.4);
  g.fillStyle = '#1a0b33'; g.fillRect(0, 225, 300, 75);
  g.strokeStyle = '#ff5fd2'; g.lineWidth = 2;
  for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(0, 232 + i * i * 3); g.lineTo(300, 232 + i * i * 3); g.stroke(); }
  for (let i = -6; i <= 6; i++) { g.beginPath(); g.moveTo(150 + i * 12, 225); g.lineTo(150 + i * 60, 300); g.stroke(); }
  return c.toDataURL('image/png');
}

let wp = null;
const backdrop = () => (wp = wp || wallpaper());
window.addEventListener('DOMContentLoaded', () => {
  if (!location.pathname.includes('/settings/')) document.documentElement.style.background = `#0b1026 url(${backdrop()}) 0 0 / 100% 100%`;
});

// ---------------------------------------------------------------- scenes
const BASE = {
  name: 'Mochi', showCompanion: true, colorTheme: 'mood', sleepAfter: '2', refraction: true, islandStyle: 'glass', monochrome: false,
  clockStyle: 'classic', clockSize: 'medium', hourFormat: 'auto', showSeconds: false, showDate: true, dateFormat: 'long',
  restingClock: false, showStats: true, statBattery: true, statCpu: true, statRam: true, mediaEnabled: true, mediaAnyApp: false,
  shelfEnabled: true, timerEnabled: true, dnd: false, notifySystem: true, notifyClipboard: true, clipboardPreview: true,
  hourlyReminder: true, notifyDuration: 'normal', sounds: false, _greeted: true,
};
const TRACK = { type: 'state', state: 'Playing', app: 'Spotify', title: 'Golden Hour Drive', artist: 'Neon Lagoon', album: 'Coastlines', key: 'demo', pos: 83000, dur: 214000, next: true, prev: true };

async function run() {
  const cfg = (o = {}) => emit('settings', { ...BASE, ...o });
  const stats = (idle = 0) => emit('stats', { cpu: 0.23, mem: 0.58, idle });
  const media = () => { emit('media', { ...TRACK, upd: Date.now() }); emit('media', { type: 'art', key: 'demo', url: albumArt() }); };
  const shelf = async () => emit('shelf', await ipcRenderer.invoke('shot:shelf'));
  const far = () => emit('cursor', { x: -5000, y: -5000 });

  switch (scene) {
    case 'hero': cfg(); stats(); emit('cursor', { x: 430, y: 125 }); break;
    case 'notify':
      cfg(); stats(); far();
      emit('event', { title: 'Build finished', body: 'All 42 tests passed in 3.1s', mood: 'happy', icon: 'check', duration: 20000 });
      break;
    case 'player': cfg(); stats(); far(); media(); at(300, () => emit('debug', { pin: true, tab: 'home' })); break;
    case 'mini': cfg(); stats(); far(); media(); at(100, () => emit('debug', { pin: false })); break;
    case 'shelf': cfg(); stats(); far(); await shelf(); emit('debug', { pin: true, tab: 'shelf' }); break;
    case 'timer': cfg(); stats(); far(); emit('debug', { pin: true, tab: 'timer', timer: 25 }); break;
    case 'tmini': cfg(); stats(); far(); emit('debug', { timer: 10 }); break;
    case 'glance':
      cfg({ clockStyle: 'neon', clockSize: 'large', mediaEnabled: false }); stats(); far();
      emit('debug', { pin: true, tab: 'home' });
      break;
    case 'stacked':
      cfg({ clockStyle: 'stacked', clockSize: 'large', monochrome: true, mediaEnabled: false, showStats: false }); stats(); far();
      emit('debug', { pin: true, tab: 'home' });
      break;
    case 'minimal':
      cfg({ showCompanion: false, islandStyle: 'black', restingClock: true, dnd: true }); stats(); far(); await shelf();
      break;
    case 'drop': cfg(); stats(); emit('cursor', { x: 320, y: 40 }); emit('debug', { drop: 60000 }); break;
    case 'sleep': cfg(); stats(999); far(); break;
    default: cfg(); stats();
  }
}

if (location.pathname.includes('/settings/')) {
  contextBridge.exposeInMainWorld('mochi', {
    get: async () => ({ ...BASE, sounds: true, startAtLogin: true }),
    set() {}, onChange() {}, testNotify() {},
  });
} else {
  const noop = () => {};
  contextBridge.exposeInMainWorld('companion', {
    on: (ch, cb) => { (handlers[ch] = handlers[ch] || []).push(cb); },
    ready: () => at(50, run),
    setInteractive: noop, captureSource: async () => null, mediaCmd: noop, setSetting: noop, openSettings: noop,
    pathForFile: () => '', shelfAdd: noop, shelfRemove: noop, shelfClear: noop, shelfOpen: noop, shelfReveal: noop, shelfDrag: noop,
    backdrop,
  });
}
