'use strict';
/*
 * Renders the README screenshots from the real island renderer, offscreen,
 * over a generated wallpaper with demo data (no personal desktop content).
 *   npx electron scripts/shots/main.js
 * Output: docs/images/*.png
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'images');

app.setPath('userData', path.join(os.tmpdir(), 'mochi-shots'));

// [scene, crop height (CSS px), wait ms]
const SCENES = [
  ['hero', 150, 2200], ['notify', 150, 1800], ['player', 210, 2600], ['mini', 120, 2200], ['shelf', 190, 2200],
  ['timer', 180, 3200], ['tmini', 120, 2200], ['glance', 190, 2200], ['stacked', 200, 2400], ['minimal', 90, 2200],
  ['drop', 170, 1800], ['sleep', 120, 5500],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ipcMain.handle('shot:shelf', async () => {
  const dir = path.join(os.tmpdir(), 'mochi-demo');
  fs.mkdirSync(path.join(dir, 'Holiday photos'), { recursive: true });
  const files = ['Holiday photos', 'Quarterly report.pdf', 'Moodboard.png', 'Notes.txt', 'Budget 2026.xlsx', 'Project.zip'];
  for (const f of files.slice(1)) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) fs.writeFileSync(p, f.endsWith('.png') ? fs.readFileSync(path.join(ROOT, 'build', 'icon.png')) : 'demo');
  }
  const out = [];
  for (const [i, f] of files.entries()) {
    const p = path.join(dir, f);
    let icon = '';
    if (i > 0) { try { icon = (await app.getFileIcon(p, { size: 'large' })).toDataURL(); } catch { /* none */ } }
    out.push({ id: `d${i}`, path: p, name: f, isDir: i === 0, size: 1, icon });
  }
  return out;
});

// Offscreen windows ignore the device-scale switch, so render at 2× size with
// zoom 2: the page still lays out at CSS size but paints at double resolution.
async function capture(file, page, query, width, height, crop, SCALE = 2) {
  const win = new BrowserWindow({
    width: width * SCALE, height: height * SCALE, show: false, frame: false, backgroundColor: '#0b1026',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), offscreen: true, backgroundThrottling: false, zoomFactor: SCALE },
  });
  win.webContents.setFrameRate(60);
  for (let attempt = 0; ; attempt++) {
    try { await win.loadFile(page, { query }); break; } catch (e) { if (attempt >= 3) throw e; await sleep(500); }
  }
  win.webContents.setZoomFactor(SCALE);
  await sleep(query.wait);
  if (process.env.SHOTS_DEBUG) {
    console.log('size', win.getSize(), win.getContentSize(),
      await win.webContents.executeJavaScript('[innerWidth, innerHeight, devicePixelRatio]'));
  }
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: width * SCALE, height: crop * SCALE });
  fs.writeFileSync(path.join(OUT, file), img.toPNG());
  console.log(`${file} ${img.getSize().width}x${img.getSize().height}`);
  win.destroy();
  await sleep(300);
}

app.on('window-all-closed', () => {}); // we open/close one window per scene; don't quit in between
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [scene, crop, wait] of SCENES) {
    await capture(`${scene}.png`, path.join(ROOT, 'renderer', 'index.html'), { scene, wait }, 640, 360, crop);
  }
  // The settings window is tall; render it at 1.3× so it fits on a 1080p screen.
  await capture('settings.png', path.join(ROOT, 'settings', 'index.html'), { wait: 1500 }, 540, 760, 760, 1.3);
  app.quit();
});
