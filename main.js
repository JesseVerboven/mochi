'use strict';
/*
 * Mochi — main process.
 * A transparent, click-through, always-on-top window at the top-centre of the
 * primary display. It feeds the island renderer with cursor position, system
 * stats and events, runs the media/clipboard helpers, keeps the file shelf,
 * owns the settings, and exposes a tiny local HTTP endpoint for notifications.
 */
const {
  app, BrowserWindow, screen, ipcMain, powerMonitor, shell,
  desktopCapturer, Tray, Menu, nativeImage,
} = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const zlib = require('zlib');
const { spawn } = require('child_process');

const APP_NAME = 'Mochi';
app.setName(APP_NAME);
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));

const WIN_W = 640;
const WIN_H = 360;
const MOODS = ['calm', 'curious', 'happy', 'love', 'excited', 'sleepy', 'alert', 'sad'];
const ICONS = ['bell', 'clip', 'bolt', 'battery', 'wifi', 'wifi-off', 'cpu', 'clock', 'moon', 'heart', 'sparkle', 'check', 'warn', 'tray'];
const SHELF_MAX = 24;

let win = null;
let settingsWin = null;
let tray = null;
let rendererReady = false;

// ---------------------------------------------------------------- settings
// Every setting is declared here; anything not in the schema (or of the wrong
// type) sent from a renderer is rejected.
const SCHEMA = {
  name:             { type: 'string', def: 'Mochi', max: 24 },
  showCompanion:    { type: 'bool', def: true },
  colorTheme:       { type: 'enum', def: 'mood', values: ['mood', 'ocean', 'sunset', 'forest', 'grape', 'mono'] },
  sleepAfter:       { type: 'enum', def: '2', values: ['1', '2', '5', '10', '30', 'never'] },
  refraction:       { type: 'bool', def: true },
  islandStyle:      { type: 'enum', def: 'glass', values: ['glass', 'black'] },
  monochrome:       { type: 'bool', def: false },

  clockStyle:       { type: 'enum', def: 'classic', values: ['classic', 'light', 'bold', 'mono', 'neon', 'stacked'] },
  clockSize:        { type: 'enum', def: 'medium', values: ['small', 'medium', 'large'] },
  hourFormat:       { type: 'enum', def: 'auto', values: ['auto', '12', '24'] },
  showSeconds:      { type: 'bool', def: false },
  showDate:         { type: 'bool', def: true },
  dateFormat:       { type: 'enum', def: 'long', values: ['long', 'short', 'numeric'] },
  restingClock:     { type: 'bool', def: false },

  showStats:        { type: 'bool', def: true },
  statBattery:      { type: 'bool', def: true },
  statCpu:          { type: 'bool', def: true },
  statRam:          { type: 'bool', def: true },

  mediaEnabled:     { type: 'bool', def: true },
  mediaAnyApp:      { type: 'bool', def: false },
  shelfEnabled:     { type: 'bool', def: true },
  timerEnabled:     { type: 'bool', def: true },

  dnd:              { type: 'bool', def: false },
  notifySystem:     { type: 'bool', def: true },
  notifyClipboard:  { type: 'bool', def: true },
  clipboardPreview: { type: 'bool', def: true },
  hourlyReminder:   { type: 'bool', def: true },
  notifyDuration:   { type: 'enum', def: 'normal', values: ['short', 'normal', 'long'] },
  sounds:           { type: 'bool', def: true },

  _greeted:         { type: 'bool', def: false },
  port:             { type: 'int', def: 7877, internal: true },
};
const DEFAULTS = Object.fromEntries(Object.entries(SCHEMA).map(([k, v]) => [k, v.def]));
let settings = { ...DEFAULTS };

const dataPath = (f) => path.join(app.getPath('userData'), f);

function validSetting(key, value) {
  const s = SCHEMA[key];
  if (!s || s.internal) return undefined;
  if (s.type === 'bool') return typeof value === 'boolean' ? value : undefined;
  if (s.type === 'enum') return s.values.includes(value) ? value : undefined;
  if (s.type === 'string') {
    if (typeof value !== 'string') return undefined;
    const v = value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, s.max);
    return v || s.def;
  }
  return undefined;
}

function loadSettings() {
  // One-time migration from the app's previous name.
  const old = path.join(app.getPath('appData'), 'desktop-companion', 'settings.json');
  if (!fs.existsSync(dataPath('settings.json')) && fs.existsSync(old)) {
    try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.copyFileSync(old, dataPath('settings.json')); } catch { /* ignore */ }
  }
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(dataPath('settings.json'), 'utf8')); } catch { /* defaults */ }
  const out = { ...DEFAULTS };
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'port' && Number.isInteger(v) && v > 1024 && v < 65536) out.port = v;
    const ok = validSetting(k, v);
    if (ok !== undefined) out[k] = ok;
  }
  return out;
}
function saveSettings() {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(dataPath('settings.json'), JSON.stringify(settings, null, 2));
  } catch { /* ignore */ }
}

const loginOpts = () => (app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] });
const startAtLogin = () => app.getLoginItemSettings(loginOpts()).openAtLogin;

function broadcastSettings() {
  send('settings', settings);
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('settings', { ...settings, startAtLogin: startAtLogin() });
    settingsWin.setTitle(`${settings.name} Settings`);
  }
  if (tray) { tray.setToolTip(settings.name); buildMenu(); }
}

function setSetting(key, value) {
  if (key === 'startAtLogin') {
    if (typeof value === 'boolean') app.setLoginItemSettings({ ...loginOpts(), openAtLogin: value });
    broadcastSettings();
    return;
  }
  const v = validSetting(key, value);
  if (v === undefined || settings[key] === v) return;
  settings[key] = v;
  saveSettings();
  if (key === 'mediaEnabled') { if (v) startMediaWatcher(); else stopMediaWatcher(); }
  if (key === 'mediaAnyApp') restartMediaWatcher();
  broadcastSettings();
}

ipcMain.handle('settings:get', () => ({ ...settings, startAtLogin: startAtLogin() }));
ipcMain.on('settings:set', (_e, key, value) => { if (typeof key === 'string') setSetting(key, value); });
ipcMain.on('open-settings', () => openSettings());
ipcMain.on('test-notify', () => fire({ title: 'Test notification', body: 'Notifications land right here in the island.', mood: 'excited', icon: 'bell' }));

// ---------------------------------------------------------------- helpers
const send = (channel, data) => {
  if (win && !win.isDestroyed() && rendererReady) win.webContents.send(channel, data);
};

function placement() {
  const d = screen.getPrimaryDisplay();
  return { x: Math.round(d.bounds.x + (d.bounds.width - WIN_W) / 2), y: d.workArea.y, display: d };
}
function sendGeometry() {
  if (!islandAlive()) return;
  const d = screen.getPrimaryDisplay();
  send('geometry', { win: win.getBounds(), display: d.bounds, scale: d.scaleFactor });
}
function reposition() {
  if (!islandAlive()) return;
  const { x, y } = placement();
  win.setBounds({ x, y, width: WIN_W, height: WIN_H });
  sendGeometry();
}

/** Push a notification into the island. Everything is sanitised here. */
function fire(n = {}) {
  const kind = typeof n.kind === 'string' ? n.kind : 'external';
  if (kind === 'clipboard' && !settings.notifyClipboard) return;
  if ((kind === 'power' || kind === 'session') && !settings.notifySystem) return;
  const s = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, 160);
  const dur = Number(n.duration);
  send('event', {
    kind,
    title: s(n.title) || 'Notification',
    body: s(n.body),
    mood: MOODS.includes(n.mood) ? n.mood : 'excited',
    icon: ICONS.includes(n.icon) ? n.icon : 'bell',
    duration: dur > 0 ? Math.min(Math.max(dur, 1500), 15000) : 0, // 0 → user's default
  });
}

// ---------------------------------------------------------------- island window
function createWindow() {
  const { x, y } = placement();
  win = new BrowserWindow({
    x, y, width: WIN_W, height: WIN_H,
    title: APP_NAME,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  // Exclude ourselves from screen capture so the refraction shader can sample
  // what is *behind* the window without seeing its own reflection.
  if (!process.env.COMPANION_NO_PROTECT) win.setContentProtection(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.env.COMPANION_DEBUG) {
    win.webContents.on('console-message', (e) => console.log(`[renderer] ${e.message}`));
    win.webContents.on('preload-error', (_e, p, err) => console.log('[preload-error]', p, err));
  }
  // Never navigate away if something is dropped outside the drop handler.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('render-process-gone', () => { rendererReady = false; win.reload(); });
}

ipcMain.on('ready', () => {
  if (!islandAlive()) return;
  rendererReady = true;
  if (process.env.COMPANION_DEBUG) console.log('[main] renderer ready', win.getBounds());
  sendGeometry();
  send('settings', settings);
  send('state', { locked: false });
  send('shelf', shelfPublic());
  if (lastMedia.state) send('media', lastMedia.state);
  if (lastMedia.art) send('media', lastMedia.art);
  if (!win.isVisible()) win.showInactive();
});

ipcMain.on('interactive', (_e, on) => {
  if (islandAlive()) win.setIgnoreMouseEvents(!on, { forward: true });
});

ipcMain.on('media-cmd', (_e, cmd) => {
  if (typeof cmd === 'string' && /^(toggle|next|prev|seek:\d{1,9})$/.test(cmd) && mediaProc && mediaProc.stdin.writable) {
    mediaProc.stdin.write(`${cmd}\n`);
  }
});

ipcMain.handle('capture-source', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  const primary = screen.getPrimaryDisplay();
  const src = sources.find((s) => String(s.display_id) === String(primary.id)) || sources[0];
  return src ? src.id : null;
});

// ---------------------------------------------------------------- settings window
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 540,
    height: 760,
    minWidth: 460,
    minHeight: 480,
    show: false,
    title: `${settings.name} Settings`,
    icon: trayIcon(),
    backgroundColor: '#0c0d11',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0c0d11', symbolColor: '#e6e7ee', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'settings', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile(path.join(__dirname, 'settings', 'index.html'));
  settingsWin.webContents.on('will-navigate', (e) => e.preventDefault());
  settingsWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---------------------------------------------------------------- file shelf
// Files dropped on the island are kept by path (never copied) so they can be
// dragged back out into any app later. Persisted across restarts.
let shelf = []; // { id, path, name, isDir, size, icon }
const shelfIcons = new Map(); // id → nativeImage (used as the drag image)
let shelfSeq = 0;

const shelfPublic = () => shelf.map(({ id, path: p, name, isDir, size, icon }) => ({ id, path: p, name, isDir, size, icon }));
function saveShelf() {
  try { fs.writeFileSync(dataPath('shelf.json'), JSON.stringify(shelf.map((i) => i.path))); } catch { /* ignore */ }
}
async function addToShelf(paths, announce = true) {
  let added = 0;
  for (const p of paths) {
    if (typeof p !== 'string' || !path.isAbsolute(p) || shelf.length >= SHELF_MAX) continue;
    if (shelf.some((i) => i.path.toLowerCase() === p.toLowerCase())) continue;
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    let img = null;
    // Windows hands back a drive icon for folders; the island draws its own folder glyph instead.
    if (!st.isDirectory()) { try { img = await app.getFileIcon(p, { size: 'large' }); } catch { /* ignore */ } }
    const id = `f${++shelfSeq}`;
    if (img && !img.isEmpty()) shelfIcons.set(id, img);
    shelf.push({
      id, path: p, name: path.basename(p) || p, isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size,
      icon: img && !img.isEmpty() ? img.toDataURL() : '',
    });
    added++;
  }
  if (added) { saveShelf(); send('shelf', shelfPublic()); }
  if (!added && announce && paths.length) send('shelf', shelfPublic()); // still refresh (duplicates)
  return added;
}
function removeFromShelf(id) {
  shelf = shelf.filter((i) => i.id !== id);
  shelfIcons.delete(id);
  saveShelf();
  send('shelf', shelfPublic());
}
function loadShelf() {
  let paths = [];
  try { paths = JSON.parse(fs.readFileSync(dataPath('shelf.json'), 'utf8')); } catch { /* empty */ }
  if (Array.isArray(paths)) addToShelf(paths.filter((p) => typeof p === 'string' && fs.existsSync(p)), false);
}
const shelfItem = (id) => shelf.find((i) => i.id === id);

ipcMain.on('shelf:add', (_e, paths) => { if (Array.isArray(paths)) addToShelf(paths.slice(0, SHELF_MAX)); });
ipcMain.on('shelf:remove', (_e, id) => removeFromShelf(String(id)));
ipcMain.on('shelf:clear', () => { shelf = []; shelfIcons.clear(); saveShelf(); send('shelf', []); });
ipcMain.on('shelf:open', (_e, id) => { const i = shelfItem(String(id)); if (i) shell.openPath(i.path); });
ipcMain.on('shelf:reveal', (_e, id) => { const i = shelfItem(String(id)); if (i) shell.showItemInFolder(i.path); });
ipcMain.on('shelf:drag', (e, ids) => {
  const wanted = ids === 'all' ? shelf : shelf.filter((i) => Array.isArray(ids) && ids.includes(i.id));
  const items = wanted.filter((i) => fs.existsSync(i.path));
  const gone = wanted.filter((i) => !items.includes(i));
  if (gone.length) {
    gone.forEach((i) => removeFromShelf(i.id));
    fire({ title: 'Moved or deleted', body: `${gone[0].name}${gone.length > 1 ? ` and ${gone.length - 1} more` : ''} left the shelf`, mood: 'sad', icon: 'tray' });
  }
  if (!items.length) { e.sender.send('shelf-drag-end'); return; }
  let icon = shelfIcons.get(items[0].id);
  if (!icon || icon.isEmpty()) icon = trayIcon();
  e.sender.startDrag({ file: items[0].path, files: items.map((i) => i.path), icon });
  e.sender.send('shelf-drag-end');
});

// ---------------------------------------------------------------- sensors
function startSensors() {
  // Cursor: poll globally (the window is click-through so DOM events are not enough).
  let last = { x: NaN, y: NaN };
  every(16, () => {
    if (!islandAlive() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    if (p.x === last.x && p.y === last.y) return;
    last = p;
    const b = win.getBounds();
    send('cursor', { x: p.x - b.x, y: p.y - b.y });
  });

  // CPU / memory / idle.
  const cpuTimes = () => os.cpus().reduce((a, c) => {
    const t = c.times;
    a.idle += t.idle;
    a.total += t.user + t.nice + t.sys + t.idle + t.irq;
    return a;
  }, { idle: 0, total: 0 });
  let prev = cpuTimes();
  every(2000, () => {
    const cur = cpuTimes();
    const dTotal = cur.total - prev.total;
    const cpu = dTotal > 0 ? 1 - (cur.idle - prev.idle) / dTotal : 0;
    prev = cur;
    send('stats', {
      cpu: Math.max(0, Math.min(1, cpu)),
      mem: 1 - os.freemem() / os.totalmem(),
      idle: powerMonitor.getSystemIdleTime(),
    });
  });

  startClipboardWatcher();
  if (settings.mediaEnabled) startMediaWatcher();

  // Power / session.
  powerMonitor.on('on-ac', () => fire({ kind: 'power', title: 'Charging', body: 'Plugged in — nom nom nom', mood: 'happy', icon: 'bolt' }));
  powerMonitor.on('on-battery', () => fire({ kind: 'power', title: 'On battery', body: 'Unplugged. I\'ll keep an eye on the juice.', mood: 'curious', icon: 'battery' }));
  powerMonitor.on('lock-screen', () => send('state', { locked: true }));
  powerMonitor.on('unlock-screen', () => {
    send('state', { locked: false });
    fire({ kind: 'session', title: 'Welcome back', body: 'I kept your desktop warm.', mood: 'happy', icon: 'sparkle' });
  });
  powerMonitor.on('suspend', () => send('state', { locked: true }));
  powerMonitor.on('resume', () => {
    send('state', { locked: false });
    fire({ kind: 'session', title: 'Good to see you', body: 'That was a nice nap.', mood: 'happy', icon: 'moon' });
  });

  for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, reposition);

  // Some apps grab topmost; re-assert politely.
  every(5000, () => { if (islandAlive() && win.isVisible()) win.setAlwaysOnTop(true, 'screen-saver'); });
}

// Timers that touch the window. They're all stopped on quit, and every tick
// checks the window is still alive: touching a destroyed BrowserWindow throws
// "Object has been destroyed" in the main process.
const timers = [];
const islandAlive = () => !!win && !win.isDestroyed();
function every(ms, fn) {
  timers.push(setInterval(() => {
    if (app.isQuitting) return;
    try { fn(); } catch (e) { console.warn('[mochi] timer:', e.message); }
  }, ms));
}
function stopTimers() { while (timers.length) clearInterval(timers.pop()); }

/*
 * Clipboard watching runs in a separate PowerShell process. Reading the
 * clipboard on Windows blocks until the app that owns it renders the data, and
 * an unresponsive owner would freeze our main process. The watcher polls
 * GetClipboardSequenceNumber (which never opens the clipboard), and reads the
 * text on a separate STA runspace with a timeout, so a hung owner can never
 * stall it. It also exits on its own when this process goes away.
 */
const CLIP_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Namespace W -Name C -MemberDefinition '[DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();'
$parent = __PARENT_PID__
$reader = {
  Add-Type -AssemblyName System.Windows.Forms
  if ([Windows.Forms.Clipboard]::ContainsText()) { [Windows.Forms.Clipboard]::GetText() } else { '' }
}
function New-Reader {
  $rs = [runspacefactory]::CreateRunspace(); $rs.ApartmentState = 'STA'; $rs.ThreadOptions = 'ReuseThread'; $rs.Open()
  return $rs
}
$rs = New-Reader
$last = [W.C]::GetClipboardSequenceNumber()
while ($true) {
  Start-Sleep -Milliseconds 500
  if (-not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { [Environment]::Exit(0) }
  $n = [W.C]::GetClipboardSequenceNumber()
  if ($n -eq $last) { continue }
  $last = $n
  $ps = [powershell]::Create(); $ps.Runspace = $rs; [void]$ps.AddScript($reader)
  $h = $ps.BeginInvoke()
  if ($h.AsyncWaitHandle.WaitOne(2500)) {
    $t = [string]($ps.EndInvoke($h) | Select-Object -First 1)
    $ps.Dispose()
    if ($t.Length -gt 4000) { $t = $t.Substring(0, 4000) }
    [Console]::Out.WriteLine('=' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t))); [Console]::Out.Flush()
  } else {
    $rs = New-Reader
    [Console]::Out.WriteLine('x'); [Console]::Out.Flush()
  }
}`;
let clipProc = null;
function startClipboardWatcher() {
  if (process.platform !== 'win32' || app.isQuitting) return;
  const encoded = Buffer.from(CLIP_SCRIPT.replace('__PARENT_PID__', String(process.pid)), 'utf16le').toString('base64');
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  clipProc = proc;
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('=')) continue; // 'x' = owner didn't answer; skip silently
      const text = Buffer.from(line.slice(1), 'base64').toString('utf8');
      if (text.trim()) fire({ kind: 'clipboard', title: 'Copied', body: previewClip(text), mood: 'happy', icon: 'clip', duration: 2600 });
    }
  });
  proc.on('error', () => {});
  proc.on('exit', () => {
    if (clipProc === proc) { clipProc = null; setTimeout(startClipboardWatcher, 5000); }
  });
}

function previewClip(text) {
  if (!settings.clipboardPreview) return `${text.length} characters`;
  const oneLine = text.replace(/\s+/g, ' ').trim();
  // Don't flash things that look like passwords / tokens on screen.
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((r) => r.test(oneLine)).length;
  if (/^\S{8,200}$/.test(oneLine) && classes >= 3 && !/^https?:\/\//i.test(oneLine)) return '•••••••• (looks secret, hidden)';
  return oneLine.length > 70 ? `${oneLine.slice(0, 68)}…` : oneLine;
}

/*
 * Now-playing: helpers/media.ps1 talks to Windows' system media sessions
 * (GlobalSystemMediaTransportControls — what the volume flyout uses) and
 * streams JSON lines; we forward them to the island and pipe controls back.
 */
let mediaProc = null;
let mediaFails = 0;
const lastMedia = { state: null, art: null };
function startMediaWatcher() {
  if (process.platform !== 'win32' || app.isQuitting || mediaProc || !settings.mediaEnabled) return;
  // In the packaged app the helper is unpacked next to app.asar (PowerShell can't read inside it).
  const script = path.join(__dirname, 'helpers', 'media.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  const proc = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-ParentPid', String(process.pid), '-AnyApp', settings.mediaAnyApp ? '1' : '0',
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  mediaProc = proc;
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      handleMediaLine(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  });
  proc.stdin.on('error', () => {});
  proc.on('error', () => {});
  proc.on('exit', (code) => {
    if (mediaProc !== proc) return; // replaced or stopped on purpose
    mediaProc = null;
    clearMedia();
    if (code !== 3 && ++mediaFails < 20) setTimeout(startMediaWatcher, 4000);
  });
}
function clearMedia() {
  lastMedia.state = null;
  lastMedia.art = null;
  send('media', { type: 'state', state: 'none' });
}
function stopMediaWatcher() {
  const p = mediaProc;
  mediaProc = null;
  if (p) p.kill();
  clearMedia();
}
function restartMediaWatcher() {
  stopMediaWatcher();
  startMediaWatcher();
}
function handleMediaLine(raw) {
  const line = raw.replace(/^﻿/, '').trim();
  if (!line) return;
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.error) { console.warn('[mochi] media:', m.error); return; }
  const str = (v) => (typeof v === 'string' ? v : '').slice(0, 300);
  if (m.type === 'art') {
    const b64 = typeof m.b64 === 'string' && /^[A-Za-z0-9+/=]+$/.test(m.b64) ? m.b64 : '';
    const mime = b64.startsWith('iVBOR') ? 'image/png' : b64.startsWith('R0lG') ? 'image/gif' : 'image/jpeg';
    lastMedia.art = { type: 'art', key: str(m.key), url: b64 ? `data:${mime};base64,${b64}` : null };
    send('media', lastMedia.art);
  } else if (m.type === 'state') {
    mediaFails = 0;
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    lastMedia.state = {
      type: 'state', state: str(m.state) || 'none', app: str(m.app), title: str(m.title), artist: str(m.artist),
      album: str(m.album), key: str(m.key), pos: num(m.pos), dur: num(m.dur), upd: num(m.upd), next: !!m.next, prev: !!m.prev,
    };
    send('media', lastMedia.state);
  }
}

// ---------------------------------------------------------------- notify server
function startServer() {
  const port = settings.port;
  const okHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const server = http.createServer((req, res) => {
    if (process.env.COMPANION_DEBUG) console.log('[http]', req.method, req.url);
    const u = new URL(req.url, 'http://127.0.0.1');
    if (!okHosts.has(String(req.headers.host))) { res.writeHead(403); return res.end(); } // DNS-rebinding guard
    // Debug-only: drive the island's views for screenshots/testing.
    if (process.env.COMPANION_DEBUG && u.pathname === '/debug' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const j = JSON.parse(body || '{}');
          if (Array.isArray(j.shelfAdd)) addToShelf(j.shelfAdd);
          if (j.set && typeof j.set === 'object') for (const [k, v] of Object.entries(j.set)) setSetting(k, v);
          if (j.openSettings) openSettings();
          if (j.quit) setTimeout(() => app.quit(), 50); // same path as the tray's Quit
          send('debug', j);
          res.end('ok\n');
        } catch { res.writeHead(400); res.end(); }
      });
      return undefined;
    }
    if (u.pathname !== '/notify') { res.writeHead(404); return res.end(); }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end('POST JSON to /notify\n'); }
    // Requiring JSON forces a CORS preflight for browsers, which we never approve.
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) { res.writeHead(415); return res.end('Content-Type must be application/json\n'); }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > 16384) req.destroy(); });
    req.on('end', () => {
      try {
        const n = JSON.parse(body || '{}');
        fire({ ...n, kind: 'external' });
        res.writeHead(200); res.end('ok\n');
      } catch { res.writeHead(400); res.end('invalid JSON\n'); }
    });
  });
  server.on('error', (e) => console.warn('[mochi] notify server:', e.message));
  server.listen(port, '127.0.0.1', () => { if (process.env.COMPANION_DEBUG) console.log('[http] listening', port); });
}

// ---------------------------------------------------------------- tray
function crc32(buf) {
  let crc = ~0;
  for (const b of buf) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(size, pixel) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const i = y * stride + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
let trayIconCache = null;
function trayIcon() {
  if (trayIconCache) return trayIconCache;
  // Prefer the real app icon; fall back to a generated one.
  const file = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
  if (!file.isEmpty()) { trayIconCache = file.resize({ width: 32, height: 32, quality: 'best' }); return trayIconCache; }
  const png = makePng(32, (x, y, s) => {
    const cx = s / 2, cy = s / 2 + 1, R = s * 0.42;
    const d = Math.hypot(x - cx, y - cy) - R;
    const a = Math.max(0, Math.min(1, 0.5 - d));
    const eye = (ex) => Math.hypot((x - ex) / 2.2, (y - (cy - 1)) / 3.4) < 1;
    const t = y / s;
    let r = 94 + (59 - 94) * t, g = 231 + (130 - 231) * t, b = 214 + (246 - 214) * t; // teal→blue
    if (eye(cx - 5) || eye(cx + 5)) { r = 12; g = 12; b = 22; }
    return [r | 0, g | 0, b | 0, Math.round(a * 255)];
  });
  trayIconCache = nativeImage.createFromBuffer(png);
  return trayIconCache;
}

function toggleVisible() {
  if (!islandAlive()) return;
  if (win.isVisible()) win.hide(); else win.showInactive();
  buildMenu();
}

function buildMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `${islandAlive() && win.isVisible() ? 'Hide' : 'Show'} ${settings.name}`, click: toggleVisible },
    { label: 'Settings…', click: openSettings },
    { type: 'separator' },
    { label: 'Do not disturb', type: 'checkbox', checked: settings.dnd, click: (i) => setSetting('dnd', i.checked) },
    { label: 'Send test notification', click: () => fire({ title: 'Test notification', body: 'Notifications land right here in the island.', mood: 'excited', icon: 'bell' }) },
    { type: 'separator' },
    { label: `Quit ${settings.name}`, click: () => app.quit() },
  ]));
}

// ---------------------------------------------------------------- boot
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.mochi.companion');
  app.whenReady().then(() => {
    settings = loadSettings();
    createWindow();
    tray = new Tray(trayIcon());
    tray.setToolTip(settings.name);
    tray.on('click', toggleVisible);
    tray.on('double-click', openSettings);
    buildMenu();
    loadShelf();
    startSensors();
    startServer();
  });
  app.on('second-instance', () => openSettings());
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    app.isQuitting = true;
    stopTimers();
    if (clipProc) { const p = clipProc; clipProc = null; p.kill(); }
    if (mediaProc) { const p = mediaProc; mediaProc = null; p.kill(); }
  });
}
