'use strict';
(() => {
  // In a plain browser preview there is no preload bridge; stub it so the page still runs.
  const noop = () => {};
  const api = window.companion || {
    on: noop, ready: noop, setInteractive: noop, mediaCmd: noop, setSetting: noop, openSettings: noop,
    captureSource: async () => null, pathForFile: () => '', shelfAdd: noop, shelfRemove: noop,
    shelfClear: noop, shelfOpen: noop, shelfReveal: noop, shelfDrag: noop,
  };
  const $ = (s) => document.querySelector(s);
  const byId = (id) => document.getElementById(id);
  const canvas = $('#gl');
  const islandEl = $('#island');
  const contentEl = $('#content');

  // ------------------------------------------------------------ constants
  const TOP = 8;
  const BASE_R = 16;
  const HUB_W = 400;
  const SLEEP_AFTER = { 1: 60, 2: 120, 5: 300, 10: 600, 30: 1800, never: Infinity };
  const NOTIFY_MS = { short: 3000, normal: 4500, long: 7000 };
  const CLOCK_PX = { small: 22, medium: 30, large: 42 };
  const TIMER_PRESETS = [1, 5, 10, 15, 25, 45];

  const DEFAULT_CFG = {
    name: 'Mochi', showCompanion: true, colorTheme: 'mood', sleepAfter: '2', refraction: true,
    clockStyle: 'classic', clockSize: 'medium', hourFormat: 'auto', showSeconds: false, showDate: true,
    dateFormat: 'long', restingClock: false, showStats: true, statBattery: true, statCpu: true, statRam: true,
    islandStyle: 'glass', monochrome: false,
    mediaEnabled: true, mediaAnyApp: false, shelfEnabled: true, timerEnabled: true, dnd: false,
    notifySystem: true, notifyClipboard: true, clipboardPreview: true, hourlyReminder: true,
    notifyDuration: 'normal', sounds: true, _greeted: true,
  };

  const MOODS = {
    calm:    { c: ['#5ee7d6', '#3b82f6'], energy: 0.35, breath: 1.7, open: 1.0,  happy: 0, glow: 0.12 },
    curious: { c: ['#7cf3ff', '#8b5cf6'], energy: 0.5,  breath: 2.2, open: 1.1,  happy: 0, glow: 0.2 },
    happy:   { c: ['#ffd166', '#ff6fb5'], energy: 0.8,  breath: 2.6, open: 1.0,  happy: 1, glow: 0.3 },
    love:    { c: ['#ff8fc7', '#ff4d6d'], energy: 0.7,  breath: 2.4, open: 1.0,  happy: 1, glow: 0.4 },
    excited: { c: ['#ff5ea8', '#ffb347'], energy: 1.3,  breath: 4.0, open: 1.2,  happy: 0, glow: 0.45 },
    sleepy:  { c: ['#8187ea', '#2a2f7b'], energy: 0.12, breath: 0.9, open: 0.06, happy: 0, glow: 0.05 },
    alert:   { c: ['#ffa14a', '#ff3d5a'], energy: 1.0,  breath: 3.4, open: 1.05, happy: 0, glow: 0.35 },
    sad:     { c: ['#93a3c0', '#3d4a66'], energy: 0.15, breath: 1.1, open: 0.65, happy: 0, glow: 0.05 },
    // Colours are replaced with the album art's palette whenever the cover changes.
    music:   { c: ['#5eead4', '#7c3aed'], energy: 0.65, breath: 2.4, open: 0.8,  happy: 0, glow: 0.35 },
  };
  const THEMES = {
    ocean: ['#5ee7d6', '#3b82f6'], sunset: ['#ffb36b', '#ff4f7b'], forest: ['#a3e635', '#059669'],
    grape: ['#c084fc', '#6d28d9'], mono: ['#f4f4f5', '#71717a'],
    bw: ['#ffffff', '#8a8a8f'], // black & white mode
  };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  for (const m of Object.values(MOODS)) m.rgb = m.c.map(hex);
  for (const k of Object.keys(THEMES)) THEMES[k] = THEMES[k].map(hex);

  const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const fsvg = (inner) => `<svg viewBox="0 0 24 24" fill="currentColor">${inner}</svg>`;
  const ICONS = {
    bell: svg('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
    clip: svg('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'),
    bolt: svg('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>'),
    battery: svg('<rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2"/>'),
    wifi: svg('<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><path d="M12 20h.01"/>'),
    'wifi-off': svg('<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.86a10 10 0 0 1 5.17-2.7"/><path d="M12 20h.01"/>'),
    cpu: svg('<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>'),
    clock: svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
    moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>'),
    heart: svg('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/>'),
    sparkle: svg('<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    warn: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
    tray: svg('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
    home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/>'),
    music: svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
    timer: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9.5 2h5"/>'),
    pin: svg('<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 4H7l3-4z"/>'),
    sliders: svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
    x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    files: svg('<path d="M15 2H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M15 2v5h5"/><path d="M4 7v13a2 2 0 0 0 2 2h10"/>'),
    folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
    stop: fsvg('<rect x="6" y="6" width="12" height="12" rx="2.5"/>'),
    plus1: svg('<path d="M5 12h8M9 8v8"/><path d="M17 7v10"/><path d="M15 9l2-2"/>'),
  };
  const SKIP = '<path d="M3 5.2v13.6c0 .8.9 1.2 1.5.7L12 13.4v5.4c0 .8.9 1.2 1.5.7l8-6.8a.9.9 0 0 0 0-1.4l-8-6.8c-.6-.5-1.5-.1-1.5.7v5.4L4.5 4.5C3.9 4 3 4.4 3 5.2z"/>';
  const MEDIA_ICONS = {
    play: fsvg('<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>'),
    pause: fsvg('<rect x="6" y="4" width="4.5" height="16" rx="1.2"/><rect x="13.5" y="4" width="4.5" height="16" rx="1.2"/>'),
    next: fsvg(SKIP),
    prev: fsvg(`<g transform="matrix(-1 0 0 1 24 0)">${SKIP}</g>`),
  };

  // ------------------------------------------------------------ math
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  function spring(o, k, vk, target, stiff, damping, dt) {
    o[vk] += (stiff * (target - o[k]) - damping * o[vk]) * dt;
    o[k] += o[vk] * dt;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------ state
  const S = {
    cfg: { ...DEFAULT_CFG }, cfgVer: 0, cfgLoaded: false,
    W: innerWidth, H: innerHeight, t: 0, last: performance.now(),
    cursor: { x: -9999, y: -9999 }, cur: { speed: 0, t: performance.now() },
    lastMoveAt: performance.now(),
    isl: { w: 40, h: 20, vw: 0, vh: 0 },
    blob: { x: innerWidth / 2, y: 30, vx: 0, vy: 0, r: BASE_R }, vis: 1,
    squish: 0, squishV: 0, goo: 18, eyeWide: 0,
    eye: { lx: 0, ly: 0, open: 1, happy: 0 }, blink: { next: 2, t: -1 },
    col: { a: [...MOODS.calm.rgb[0]], b: [...MOODS.calm.rgb[1]] },
    energy: 0.3, glow: 0.1, dark: 0.55,
    transient: null, transientUntil: 0,
    mode: 'compact', contentKey: '', contentChangedAt: 0, hoverSince: 0, pinned: false,
    hubTab: 'home', hubClosedAt: 0, peekUntil: 0,
    queue: [], current: null, currentUntil: 0, nid: 0,
    stats: { cpu: 0, mem: 0, idle: 0 }, cpuHighSince: 0, cpuHigh: false, cpuWarnCd: 0,
    battery: null, batteryPrev: 1, locked: false, online: navigator.onLine, sleeping: false,
    drag: false, dragStart: 0, interactive: false,
    startleCd: 0, pet: 0, petCd: 0, zzzAt: 0, celebrateUntil: 0, nextHop: 0,
    refraction: true, geo: null, lastChimeHour: new Date().getHours(), frameNo: 0,
    media: null, mediaArt: null, beatPh: 0,
    shelf: [], dropHoverAt: 0, draggingOut: false, dragOutAt: 0,
    timer: null, // { total, endAt, remaining, paused }
  };

  // ------------------------------------------------------------ WebGL
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, SHADERS.vert));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, SHADERS.frag));
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  const loc = (n) => (n in U ? U[n] : (U[n] = gl.getUniformLocation(prog, n)));
  const u1 = (n, a) => gl.uniform1f(loc(n), a);
  const u2 = (n, a, b) => gl.uniform2f(loc(n), a, b);
  const u3 = (n, v) => gl.uniform3f(loc(n), v[0], v[1], v[2]);
  const u4 = (n, a, b, c, d) => gl.uniform4f(loc(n), a, b, c, d);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20, 20, 28, 255]));
  for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
  gl.uniform1i(loc('uBg'), 0);

  // ------------------------------------------------------------ desktop capture (for refraction)
  const bgCanvas = document.createElement('canvas');
  const bgCtx = bgCanvas.getContext('2d', { alpha: false });
  let video = null;
  let hasBg = false;
  let capturing = false;

  async function startCapture() {
    if (capturing || api.backdrop) return;
    capturing = true;
    try {
      const id = await api.captureSource();
      if (!id) throw new Error('no screen source');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxFrameRate: 30 } },
      });
      if (!capturing) { stream.getTracks().forEach((t) => t.stop()); return; }
      video = document.createElement('video');
      video.muted = true;
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      console.warn('[mochi] desktop capture unavailable, using fallback backdrop:', e);
      video = null;
      capturing = false;
    }
  }
  function stopCapture() {
    capturing = false;
    if (video && video.srcObject) video.srcObject.getTracks().forEach((t) => t.stop());
    video = null;
    hasBg = false;
  }
  // A fixed backdrop image instead of a live capture (used to render the README screenshots).
  let bgImage = null;
  if (api.backdrop) { const im = new Image(); im.onload = () => { bgImage = im; }; im.src = api.backdrop(); }
  function updateBg() {
    if (bgImage) {
      if (bgCanvas.width !== bgImage.width) { bgCanvas.width = bgImage.width; bgCanvas.height = bgImage.height; }
      bgCtx.drawImage(bgImage, 0, 0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgCanvas);
      hasBg = true;
      return;
    }
    if (!video || !S.geo || video.readyState < 2 || !video.videoWidth) return;
    const { win, display } = S.geo;
    const kx = video.videoWidth / display.width;
    const ky = video.videoHeight / display.height;
    const sx = (win.x - display.x) * kx, sy = (win.y - display.y) * ky;
    const sw = win.width * kx, sh = win.height * ky;
    const cw = Math.max(1, Math.round(sw)), ch = Math.max(1, Math.round(sh));
    if (bgCanvas.width !== cw || bgCanvas.height !== ch) { bgCanvas.width = cw; bgCanvas.height = ch; }
    bgCtx.drawImage(video, sx, sy, sw, sh, 0, 0, cw, ch);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgCanvas);
    hasBg = true;
  }

  // ------------------------------------------------------------ sound (tiny synth, no assets)
  let audioCtx = null;
  function tone(notes, vol = 0.16, len = 0.9) {
    if (!S.cfg.sounds) return;
    try {
      audioCtx = audioCtx || new AudioContext();
      const t0 = audioCtx.currentTime + 0.01;
      for (const [f, at] of notes) {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0, t0 + at);
        g.gain.linearRampToValueAtTime(vol, t0 + at + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0008, t0 + at + len);
        o.connect(g).connect(audioCtx.destination);
        o.start(t0 + at);
        o.stop(t0 + at + len + 0.05);
      }
    } catch { /* no audio device */ }
  }
  const chime = () => tone([[880, 0], [1318.5, 0.16], [1760, 0.32], [1318.5, 0.9], [1760, 1.06]], 0.15, 0.9);
  const pop = () => tone([[660, 0], [990, 0.07]], 0.08, 0.22);

  // ------------------------------------------------------------ helpers
  function setTransient(mood, ms) {
    S.transient = mood;
    S.transientUntil = performance.now() + ms;
  }
  function pushNotify(n) {
    if (S.cfg.dnd && !n.force) return; // do not disturb: only forced (timer) notifications pass
    const duration = n.duration > 0 ? n.duration : NOTIFY_MS[S.cfg.notifyDuration] || 4500;
    S.queue.push({ id: ++S.nid, icon: 'bell', mood: 'excited', ...n, duration });
    if (S.queue.length > 6) S.queue.shift();
  }
  function particle(text, x, y, { dx = 0, dy = -40, size = 14, life = 1.6, rot = 0 } = {}) {
    if (!S.cfg.showCompanion) return; // hearts and z's belong to the companion
    const el = document.createElement('div');
    el.className = 'particle';
    el.textContent = text;
    el.style.cssText = `left:${x}px;top:${y}px;font-size:${size}px;--dx:${dx}px;--dy:${dy}px;--life:${life}s;--rot:${rot}deg`;
    el.addEventListener('animationend', () => el.remove());
    document.body.appendChild(el);
  }
  function anchorFor(isl, r) {
    const bottom = TOP + isl.h;
    return { x: S.W / 2, y: S.sleeping ? bottom - r * 0.5 : bottom + r * 0.2 };
  }
  function hit(x, y) {
    const I = S.isl;
    if (Math.abs(x - S.W / 2) < I.w / 2 + 6 && Math.abs(y - (TOP + I.h / 2)) < I.h / 2 + 6) return 'island';
    if (S.vis > 0.5 && Math.hypot(x - S.blob.x, y - S.blob.y) < S.blob.r * 1.4) return 'blob';
    return null;
  }
  function peek(tab, ms) { S.hubTab = tab; S.peekUntil = performance.now() + ms; }

  // ------------------------------------------------------------ media
  const isPlaying = () => !!S.media && S.media.state === 'Playing';
  const hasMedia = () => S.cfg.mediaEnabled && !!(S.media && S.media.title);
  const fmtTime = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const appName = (id) => (/spotify/i.test(id || '') ? 'Spotify' : String(id || '').split('!').pop().replace(/\.exe$/i, ''));
  function mediaPos() {
    const m = S.media;
    if (!m) return 0;
    const p = isPlaying() ? m.pos + (Date.now() - m.upd) : m.pos;
    return m.dur > 0 ? clamp(p, 0, m.dur) : Math.max(0, p);
  }
  function mediaCmd(cmd) {
    api.mediaCmd(cmd);
    const m = S.media;
    if (!m) return;
    if (cmd === 'toggle') {
      // Optimistic flip so the button and the blob react instantly.
      m.pos = mediaPos(); m.upd = Date.now();
      m.state = isPlaying() ? 'Paused' : 'Playing';
      if (isPlaying()) particle('♪', S.blob.x + 12, S.blob.y - 6, { dx: 22, dy: 20, size: 14 });
    }
    S.squishV += cmd === 'toggle' ? 3 : 4;
    if (cmd === 'next') S.blob.vx += 140;
    if (cmd === 'prev') S.blob.vx -= 140;
  }

  // Tint the "music" mood with the album cover.
  const artCanvas = document.createElement('canvas');
  artCanvas.width = artCanvas.height = 16;
  const artCtx = artCanvas.getContext('2d', { willReadFrequently: true });
  function rgb2hsl([r, g, b]) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  function hsl2rgb([h, s, l]) {
    const f = (n) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)];
  }
  function applyArtColors(url) {
    const def = ['#5eead4', '#7c3aed'].map(hex);
    if (!url) { MOODS.music.rgb = def; return; }
    const img = new Image();
    img.onload = () => {
      artCtx.drawImage(img, 0, 0, 16, 16);
      const d = artCtx.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0, wsum = 0;
      for (let i = 0; i < d.length; i += 4) {
        const px = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
        const [, s, l] = rgb2hsl(px);
        const w = s * s * (1 - Math.abs(l - 0.55) * 1.4) + 0.002; // favour vivid mid-tones
        r += px[0] * w; g += px[1] * w; b += px[2] * w; wsum += w;
      }
      const [h, s] = rgb2hsl([r / wsum, g / wsum, b / wsum]);
      if (s < 0.12) { MOODS.music.rgb = [hsl2rgb([0.7, 0.15, 0.82]), hsl2rgb([0.7, 0.2, 0.42])]; return; } // greyscale cover
      MOODS.music.rgb = [hsl2rgb([h, Math.max(s, 0.6), 0.62]), hsl2rgb([(h + 0.08) % 1, Math.max(s, 0.55), 0.38])];
    };
    img.onerror = () => { MOODS.music.rgb = def; };
    img.src = url;
  }

  // ------------------------------------------------------------ timer
  const timerLeft = () => (!S.timer ? 0 : S.timer.paused ? S.timer.remaining : Math.max(0, S.timer.endAt - Date.now()));
  function startTimer(min) {
    S.timer = { total: min * 60000, endAt: Date.now() + min * 60000, remaining: min * 60000, paused: false };
    setTransient('excited', 900);
    S.squishV += 4;
    pop();
  }
  function timerAct(what) {
    const t = S.timer;
    if (!t) return;
    if (what === 'pause') {
      if (t.paused) { t.endAt = Date.now() + t.remaining; t.paused = false; } else { t.remaining = timerLeft(); t.paused = true; }
    } else if (what === 'add') {
      t.total += 60000;
      if (t.paused) t.remaining += 60000; else t.endAt += 60000;
    } else if (what === 'stop') {
      S.timer = null;
    }
    S.squishV += 2;
  }
  function finishTimer() {
    const mins = Math.round(S.timer.total / 60000);
    S.timer = null;
    pushNotify({ icon: 'timer', title: 'Time’s up!', body: `Your ${mins} minute timer is done.`, mood: 'excited', duration: 8000, force: true });
    S.celebrateUntil = performance.now() + 2200;
    chime();
  }

  // ------------------------------------------------------------ clock
  function timeParts(d) {
    const c = S.cfg;
    const opts = { hour: 'numeric', minute: '2-digit' };
    if (c.showSeconds) opts.second = '2-digit';
    if (c.hourFormat !== 'auto') opts.hour12 = c.hourFormat === '12';
    const parts = new Intl.DateTimeFormat([], opts).formatToParts(d);
    const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
    let hour = get('hour');
    if (c.hourFormat === '24') hour = hour.padStart(2, '0');
    return { hour, minute: get('minute'), second: get('second'), period: get('dayPeriod') };
  }
  function clockHTML(d, compact = false) {
    const p = timeParts(d);
    if (!compact && S.cfg.clockStyle === 'stacked') {
      return `<span class="st-h">${esc(p.hour)}</span><span class="st-m">${esc(p.minute)}${p.second ? `<small>${esc(p.second)}</small>` : ''}</span>`;
    }
    return `${esc(p.hour)}:${esc(p.minute)}${p.second ? `<span class="sec">:${esc(p.second)}</span>` : ''}${p.period && !compact ? `<span class="ampm">${esc(p.period)}</span>` : ''}`;
  }
  function dateText(d) {
    const f = S.cfg.dateFormat;
    return d.toLocaleDateString([], f === 'long' ? { weekday: 'long', day: 'numeric', month: 'short' }
      : f === 'short' ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function statsList() {
    const c = S.cfg;
    if (!c.showStats) return [];
    return [c.statBattery && 'bat', c.statCpu && 'cpu', c.statRam && 'mem'].filter(Boolean);
  }

  // ------------------------------------------------------------ sizes
  function glanceBodyH() {
    const c = S.cfg;
    const px = CLOCK_PX[c.clockSize] || 30;
    let h = c.clockStyle === 'stacked' ? px * 1.8 : px * 1.08;
    if (c.showDate) h += 20;
    if (statsList().length) h = Math.max(h, 60);
    return Math.round(h + 6);
  }
  function hubBodyH(tab) {
    if (tab === 'shelf') return 88;
    if (tab === 'timer') return 84;
    return hasMedia() ? 100 : glanceBodyH();
  }
  function hubTabs() {
    return ['home', S.cfg.shelfEnabled && 'shelf', S.cfg.timerEnabled && 'timer'].filter(Boolean);
  }
  function restingHasContent() {
    return S.cfg.restingClock || S.cfg.dnd || (S.cfg.shelfEnabled && S.shelf.length > 0);
  }
  function sizeFor(mode) {
    switch (mode) {
      case 'compact': return restingHasContent() ? [S.cfg.restingClock ? 214 : 190, 34] : [168, 34];
      case 'sleep': return [120, 30];
      case 'notify': return [380, 76];
      case 'mini': return [236, 34];
      case 'tmini': return [214, 34];
      case 'drop': return [320, 92];
      case 'hub': return [HUB_W, 12 + 26 + 8 + hubBodyH(S.hubTab) + 14];
      default: return [168, 34];
    }
  }

  // ------------------------------------------------------------ island content
  const RING_C = 2 * Math.PI * 17;
  const ring = (id, label) => `
    <div class="stat"><svg viewBox="0 0 42 42"><circle class="track" cx="21" cy="21" r="17" stroke-width="3.5"/>
      <circle class="val" id="${id}-ring" cx="21" cy="21" r="17" stroke-width="3.5" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/></svg>
      <span id="${id}-txt">–</span><label id="${id}-lbl">${label}</label></div>`;
  const STAT_LABEL = { bat: 'Battery', cpu: 'CPU', mem: 'RAM' };
  const EQ = '<div class="eq" id="m-eq"><i></i><i></i><i></i><i></i></div>';
  const MINI_C = 2 * Math.PI * 7;

  function hubHeader() {
    const tabs = hubTabs();
    const tabIcon = { home: hasMedia() ? ICONS.music : ICONS.home, shelf: ICONS.tray, timer: ICONS.timer };
    const tabBtns = tabs.length > 1 ? tabs.map((t) => `<button class="tab${S.hubTab === t ? ' on' : ''}" data-act="tab:${t}" title="${t[0].toUpperCase() + t.slice(1)}">${tabIcon[t]}${
      t === 'shelf' && S.shelf.length ? `<b>${S.shelf.length}</b>` : ''}${t === 'timer' && S.timer ? '<i class="dot"></i>' : ''}</button>`).join('')
      : `<span class="hub-name">${esc(S.cfg.name)}</span>`;
    // Centre: a small clock whenever the body isn't already showing the clock.
    const showsClock = S.hubTab === 'home' && !hasMedia();
    return `<div class="hub-head">
      <div class="tabs">${tabBtns}</div>
      <div class="head-clock" id="h-clock">${showsClock ? '' : clockHTML(new Date(), true)}</div>
      <div class="head-r">
        <button class="hbtn${S.pinned ? ' on' : ''}" data-act="pin" title="Keep open">${ICONS.pin}</button>
        <button class="hbtn${S.cfg.dnd ? ' on' : ''}" data-act="dnd" title="Do not disturb">${ICONS.moon}</button>
        <button class="hbtn" data-act="settings" title="Settings">${ICONS.sliders}</button>
      </div></div>`;
  }

  function homeBody() {
    if (hasMedia()) {
      return `<div class="player"><img class="p-art" id="m-art" alt="">
        <div class="p-main">
          <div class="p-head"><div class="p-titles"><div class="p-title" id="m-title"></div><div class="p-artist" id="m-artist"></div></div>${EQ}</div>
          <div class="p-bar" data-act="seek" id="m-bar"><div class="p-fill" id="m-fill"></div></div>
          <div class="p-times"><span id="m-pos"></span><span id="m-dur"></span></div>
          <div class="p-ctrl">
            <button class="p-btn" data-act="media:prev" id="m-prev">${MEDIA_ICONS.prev}</button>
            <button class="p-btn big" data-act="media:toggle" id="m-toggle"></button>
            <button class="p-btn" data-act="media:next" id="m-next">${MEDIA_ICONS.next}</button>
          </div>
        </div></div>`;
    }
    const c = S.cfg;
    const stats = statsList();
    return `<div class="glance${stats.length ? '' : ' solo'}">
      <div class="g-left">
        <div class="g-time clk-${c.clockStyle} sz-${c.clockSize}" id="g-time"></div>
        ${c.showDate ? '<div class="g-date" id="g-date"></div>' : ''}
      </div>
      ${stats.length ? `<div class="g-right">${stats.map((s) => ring(s, STAT_LABEL[s])).join('')}</div>` : ''}
    </div>`;
  }

  function shelfBody() {
    if (!S.shelf.length) {
      return `<div class="shelf-empty"><div class="se-icon">${ICONS.tray}</div><div>
        <b>Your shelf is empty</b><span>Drop files on the island to park them here, then drag them into any app.</span></div></div>`;
    }
    const chips = S.shelf.map((f) => `<div class="chip" draggable="true" data-drag="${esc(f.id)}" data-id="${esc(f.id)}" title="${esc(f.path)}\nDouble-click to open · right-click to show in folder">
        ${f.icon ? `<img src="${esc(f.icon)}" alt="">` : `<div class="chip-ph">${f.isDir ? ICONS.folder : ICONS.files}</div>`}
        <span>${esc(f.name)}</span>
        <button class="chip-x" data-act="shelf:remove:${esc(f.id)}" title="Remove">${ICONS.x}</button>
      </div>`).join('');
    return `<div class="shelf" id="shelf-row">${chips}
      ${S.shelf.length > 1 ? `<div class="chip action" draggable="true" data-drag="all" title="Drag every file at once"><div class="chip-ph">${ICONS.files}</div><span>Drag all</span></div>` : ''}
      <button class="chip action" data-act="shelf:clear" title="Empty the shelf"><div class="chip-ph">${ICONS.trash}</div><span>Clear</span></button>
    </div>`;
  }

  function timerBody() {
    if (!S.timer) {
      return `<div class="timer-pick">${TIMER_PRESETS.map((m) => `<button class="preset" data-act="timer:start:${m}"><b>${m}</b><span>min</span></button>`).join('')}</div>
        <div class="timer-hint">Pick a timer. ${esc(S.cfg.name)} will ping you when it's done.</div>`;
    }
    return `<div class="timer-run">
      <div class="t-left"><div class="t-time" id="t-time"></div><div class="t-sub" id="t-sub"></div>
        <div class="t-bar"><div class="t-fill" id="t-fill"></div></div></div>
      <div class="t-btns">
        <button class="t-btn" data-act="timer:add" title="+1 minute">+1</button>
        <button class="t-btn big" data-act="timer:pause" id="t-toggle"></button>
        <button class="t-btn" data-act="timer:stop" title="Stop">${ICONS.stop}</button>
      </div></div>`;
  }

  function renderContent(mode) {
    const [w] = sizeFor(mode);
    contentEl.style.width = `${w}px`;
    contentEl.className = `c-${mode}`;
    let html = '';
    if (mode === 'hub') {
      const body = S.hubTab === 'shelf' ? shelfBody() : S.hubTab === 'timer' ? timerBody() : homeBody();
      html = `<div class="hub">${hubHeader()}<div class="hub-body" style="height:${hubBodyH(S.hubTab)}px">${body}</div></div>`;
    } else if (mode === 'mini') {
      html = `<div class="mini"><img class="m-art" id="m-art" alt="">${EQ}</div>`;
    } else if (mode === 'tmini') {
      html = `<div class="tmini"><svg class="tm-ring" viewBox="0 0 18 18"><circle class="track" cx="9" cy="9" r="7"/>
        <circle class="val" id="tm-ring" cx="9" cy="9" r="7" stroke-dasharray="${MINI_C}" stroke-dashoffset="0"/></svg><span id="tm-time"></span></div>`;
    } else if (mode === 'notify' && S.current) {
      const n = S.current;
      html = `<div class="notif"><div class="n-icon">${ICONS[n.icon] || ICONS.bell}</div>
        <div class="n-text"><div class="n-title">${esc(n.title)}</div>${n.body ? `<div class="n-body">${esc(n.body)}</div>` : ''}</div></div>`;
    } else if (mode === 'drop') {
      html = `<div class="dropzone"><div class="dz-icon">${ICONS.tray}</div><div class="dz-text"><b>Drop to keep it here</b>
        <span>${esc(S.cfg.name)} will hold on to it for you</span></div></div>`;
    } else if (mode === 'compact' && restingHasContent()) {
      const ind = `${S.cfg.dnd ? `<span class="r-ico" title="Do not disturb">${ICONS.moon}</span>` : ''}${
        S.cfg.shelfEnabled && S.shelf.length ? `<span class="r-ico r-shelf">${ICONS.tray}<b>${S.shelf.length}</b></span>` : ''}`;
      html = `<div class="rest"><span class="r-clock" id="r-clock">${S.cfg.restingClock ? clockHTML(new Date(), true) : ''}</span><span class="r-ind">${ind}</span></div>`;
    }
    contentEl.innerHTML = html;
    updateDynamic(mode);
  }

  function setRing(id, v, txt, lbl) {
    const r = byId(`${id}-ring`);
    if (!r) return;
    r.setAttribute('stroke-dashoffset', String(RING_C * (1 - clamp(v, 0, 1))));
    byId(`${id}-txt`).textContent = txt;
    if (lbl) byId(`${id}-lbl`).textContent = lbl;
  }
  const setHTML = (id, html) => { const e = byId(id); if (e && e.innerHTML !== html) e.innerHTML = html; };
  const setText = (id, t) => { const e = byId(id); if (e && e.textContent !== t) e.textContent = t; };

  /** Refresh the live parts of whatever is on screen (clock, stats, media, timer). */
  function updateDynamic(mode) {
    const d = new Date();
    if (byId('g-time')) setHTML('g-time', clockHTML(d));
    if (byId('g-date')) setText('g-date', dateText(d));
    if (byId('h-clock') && byId('h-clock').innerHTML) setHTML('h-clock', clockHTML(d, true));
    if (byId('r-clock') && S.cfg.restingClock) setHTML('r-clock', clockHTML(d, true));
    if (byId('bat-ring')) {
      const b = S.battery;
      const noBattery = !b || (b.charging && b.level === 1 && b.chargingTime === 0);
      if (noBattery) setRing('bat', 1, 'AC', 'Power');
      else setRing('bat', b.level, `${Math.round(b.level * 100)}%`, b.charging ? 'Charging' : 'Battery');
    }
    if (byId('cpu-ring')) setRing('cpu', S.stats.cpu, `${Math.round(S.stats.cpu * 100)}%`);
    if (byId('mem-ring')) setRing('mem', S.stats.mem, `${Math.round(S.stats.mem * 100)}%`);

    // media
    const m = S.media;
    if (m) {
      const art = byId('m-art');
      if (art) { if (S.mediaArt) { if (art.getAttribute('src') !== S.mediaArt) art.src = S.mediaArt; } else art.removeAttribute('src'); }
      const eq = byId('m-eq');
      if (eq) eq.classList.toggle('paused', !isPlaying());
      if (byId('m-title')) {
        setText('m-title', m.title || 'Unknown track');
        setText('m-artist', m.artist || appName(m.app));
        const tg = byId('m-toggle');
        const want = isPlaying() ? 'pause' : 'play';
        if (tg.dataset.icon !== want) { tg.dataset.icon = want; tg.innerHTML = MEDIA_ICONS[want]; }
        byId('m-next').classList.toggle('disabled', !m.next);
        byId('m-prev').classList.toggle('disabled', !m.prev);
        const hasDur = m.dur > 1000;
        byId('m-bar').style.visibility = hasDur ? 'visible' : 'hidden';
        const pos = mediaPos();
        byId('m-fill').style.width = hasDur ? `${(pos / m.dur) * 100}%` : '0';
        setText('m-pos', hasDur ? fmtTime(pos) : '');
        setText('m-dur', hasDur ? `-${fmtTime(m.dur - pos)}` : '');
      }
    }

    // timer
    if (S.timer) {
      const left = timerLeft();
      const frac = S.timer.total ? left / S.timer.total : 0;
      if (byId('t-time')) {
        setText('t-time', fmtTime(left + 999));
        setText('t-sub', S.timer.paused ? 'Paused' : `${Math.round(S.timer.total / 60000)} minute timer`);
        byId('t-fill').style.width = `${frac * 100}%`;
        const tg = byId('t-toggle');
        const want = S.timer.paused ? 'play' : 'pause';
        if (tg.dataset.icon !== want) { tg.dataset.icon = want; tg.innerHTML = MEDIA_ICONS[want]; }
      }
      if (byId('tm-time')) {
        setText('tm-time', fmtTime(left + 999));
        byId('tm-ring').setAttribute('stroke-dashoffset', String(MINI_C * (1 - frac)));
        byId('tm-time').classList.toggle('paused', S.timer.paused);
      }
    }
  }

  // ------------------------------------------------------------ mood
  function baseMood(near) {
    if (S.sleeping) return 'sleepy';
    if (!S.online) return 'sad';
    if (S.battery && !S.battery.charging && S.battery.level <= 0.15) return 'alert';
    if (S.cpuHigh) return 'alert';
    if (isPlaying() && S.cfg.mediaEnabled) return 'music';
    if (near) return 'curious';
    return 'calm';
  }

  function wake() {
    setTransient('happy', 1800);
    S.squishV -= 5;
    S.blob.vy += 160;
    particle('!', S.blob.x + 14, S.blob.y - 4, { dx: 12, dy: -10, size: 16, life: 1 });
  }

  // ------------------------------------------------------------ frame
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - S.last) / 1000, 1 / 20);
    S.last = now;
    S.t += dt;
    S.frameNo++;
    const cx = S.W / 2;
    const c = S.cursor;
    const cfg = S.cfg;
    S.cur.speed *= Math.exp(-dt * 6);

    // --- hit testing / click-through
    const dropHover = now - S.dropHoverAt < 180;
    const hitNow = S.drag ? 'blob' : hit(c.x, c.y);
    const overIsland = hitNow === 'island';
    if (overIsland) { if (!S.hoverSince) S.hoverSince = now; } else S.hoverSince = 0;
    const interactive = !!hitNow || dropHover;
    if (interactive !== S.interactive) { S.interactive = interactive; api.setInteractive(interactive); }

    // --- sleep (listening to music while not touching the mouse isn't "idle")
    const idleLimit = SLEEP_AFTER[cfg.sleepAfter] ?? 120;
    const sleeping = S.locked || (S.stats.idle >= idleLimit && now - S.lastMoveAt > 2500 && !isPlaying() && !S.timer);
    if (S.sleeping && !sleeping) wake();
    S.sleeping = sleeping;

    // --- timer
    if (S.timer && !S.timer.paused && timerLeft() <= 0) finishTimer();

    // --- notifications
    if (!S.current && S.queue.length && !S.drag) {
      S.current = S.queue.shift();
      S.currentUntil = now + S.current.duration;
      S.blob.vy -= 280; // hop up into the island
      S.squishV += 5;
    }
    if (S.current && now > S.currentUntil && !overIsland) S.current = null;

    // --- mode
    const wantsPanel = S.pinned || (S.hoverSince && now - S.hoverSince > 140) || now < S.peekUntil;
    let mode;
    if (dropHover && cfg.shelfEnabled) mode = 'drop';
    else if (S.current) mode = 'notify';
    else if (S.sleeping) mode = 'sleep';
    else if (wantsPanel) mode = 'hub';
    else if (S.timer && cfg.timerEnabled) mode = 'tmini';
    else if (isPlaying() && cfg.mediaEnabled) mode = 'mini';
    else mode = 'compact';
    if (mode === 'hub' && S.mode !== 'hub' && now - S.hubClosedAt > 1500 && now >= S.peekUntil) S.hubTab = 'home';
    if (!hubTabs().includes(S.hubTab)) S.hubTab = 'home';
    if (mode !== 'hub' && S.mode === 'hub') S.hubClosedAt = now;
    S.mode = mode;

    const key = mode === 'notify' ? `n${S.current.id}`
      : mode === 'hub' ? `hub:${S.hubTab}:${S.cfgVer}:${hasMedia()}:${S.pinned}:${S.hubTab === 'shelf' || hubTabs().includes('shelf') ? S.shelf.map((f) => f.id).join(',') : ''}:${!!S.timer}`
      : mode === 'compact' ? `compact:${S.cfgVer}:${S.shelf.length}`
      : mode;
    if (key !== S.contentKey) {
      const tabSwitchOnly = S.contentKey.startsWith('hub:') && key.startsWith('hub:');
      S.contentKey = key;
      if (!tabSwitchOnly || !S.contentKey) S.contentChangedAt = now;
      else S.contentChangedAt = now - 120; // quicker cross-fade inside the hub
      renderContent(mode);
    } else if (S.frameNo % 4 === 0) {
      updateDynamic(mode);
    }

    // --- island spring (slight overshoot, like the real thing)
    const [tw, th] = sizeFor(mode);
    spring(S.isl, 'w', 'vw', tw, 240, 20, dt);
    spring(S.isl, 'h', 'vh', th, 240, 20, dt);
    S.isl.w = Math.max(S.isl.w, 20);
    S.isl.h = Math.max(S.isl.h, 14);

    // --- hourly nudge
    if (S.frameNo % 60 === 0) {
      const d = new Date();
      if (d.getHours() !== S.lastChimeHour && d.getMinutes() === 0) {
        S.lastChimeHour = d.getHours();
        if (!S.sleeping && cfg.hourlyReminder) pushNotify({ icon: 'clock', title: `It's ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, body: 'Good moment to stretch and sip some water.', mood: 'happy' });
      }
    }

    // --- mood
    S.vis = damp(S.vis, cfg.showCompanion ? 1 : 0, 6, dt);
    S.breathPh = (S.breathPh || 0) + dt * MOODS[S.moodName || 'calm'].breath;
    const r = BASE_R * (1 + 0.035 * Math.sin(S.breathPh)) * (S.sleeping ? 0.9 : 1) * Math.max(S.vis, 0.02);
    const anchor = anchorFor(S.isl, r);
    anchor.y = lerp(TOP + S.isl.h / 2, anchor.y, S.vis); // hidden → tucked inside the island
    // Groove: a gentle bob and a squish on every beat while music plays.
    if (isPlaying() && cfg.mediaEnabled && !S.sleeping && !S.drag) {
      const prevBeat = Math.floor(S.beatPh);
      S.beatPh += dt * 1.95; // ~117 bpm
      if (Math.floor(S.beatPh) !== prevBeat) S.squishV += 1.1;
      anchor.y += Math.sin(S.beatPh * Math.PI * 2) * 1.6;
    }
    // Celebrate (timer done): a few happy hops.
    if (now < S.celebrateUntil && now > S.nextHop) { S.nextHop = now + 360; S.blob.vy -= 230; S.squishV += 4; }
    const dx = c.x - anchor.x, dy = c.y - anchor.y;
    const dist = Math.hypot(dx, dy) || 1;
    // Interaction reactions win, then the notification on display, then the ambient mood.
    let mood = (S.transient && now < S.transientUntil) ? S.transient
      : (S.current && MOODS[S.current.mood]) ? S.current.mood
      : baseMood(dist < 220);
    if (mode === 'drop') mood = 'excited';
    const M = MOODS[mood];
    S.moodName = mood;
    const target = cfg.monochrome ? THEMES.bw
      : cfg.colorTheme !== 'mood' && THEMES[cfg.colorTheme] ? THEMES[cfg.colorTheme] : M.rgb;
    S.mono = damp(S.mono || 0, cfg.monochrome ? 1 : 0, 5, dt);
    S.plain = damp(S.plain || 0, cfg.islandStyle === 'black' ? 1 : 0, 5, dt);
    for (let i = 0; i < 3; i++) {
      S.col.a[i] = damp(S.col.a[i], target[0][i], 3, dt);
      S.col.b[i] = damp(S.col.b[i], target[1][i], 3, dt);
    }
    S.energy = damp(S.energy, M.energy, 3, dt);
    S.glow = damp(S.glow, M.glow * S.vis, 3, dt);
    S.dark = damp(S.dark, (mode === 'hub' || mode === 'notify' || mode === 'drop') ? 0.88 : (mode === 'mini' || mode === 'tmini' || mode === 'compact' && restingHasContent()) ? 0.72 : 0.55, 5, dt);

    // --- blob physics
    const b = S.blob;
    let tx = anchor.x, ty = anchor.y, k = 140, damping = 13;
    if (S.drag) {
      const l = Math.min(dist, 130);
      tx = anchor.x + (dx / dist) * l;
      ty = anchor.y + (dy / dist) * l;
      k = 420; damping = 26;
    } else if (!S.sleeping && S.vis > 0.5) {
      const prox = smooth(320, 50, dist);
      const reach = Math.min(dist * 0.32, 52) * prox * (S.current || mode === 'hub' ? 0.45 : 1);
      tx += (dx / dist) * reach;
      ty += Math.max((dy / dist) * reach, -r * 0.4);
      if (mood === 'alert') tx += (Math.random() - 0.5) * 1.6;
    }
    b.vx += (k * (tx - b.x) - damping * b.vx) * dt;
    b.vy += (k * (ty - b.y) - damping * b.vy) * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.r = r;

    // --- reactions to the cursor
    const bd = Math.hypot(c.x - b.x, c.y - b.y) || 1;
    if (!S.drag && !S.sleeping && S.vis > 0.5) {
      if (S.cur.speed > 2600 && bd < 170 && now > S.startleCd) {
        S.startleCd = now + 1500;
        setTransient('excited', 1100);
        b.vx -= ((c.x - b.x) / bd) * 260;
        b.vy -= ((c.y - b.y) / bd) * 180;
        S.squishV -= 6;
        S.eyeWide = 1;
      }
      if (bd < r * 1.8 && S.cur.speed > 120 && S.cur.speed < 2000) {
        S.pet += dt;
        if (S.pet > 0.5 && now > S.petCd) {
          S.petCd = now + 700; S.pet = 0;
          setTransient('love', 2200);
          particle('♥', b.x + (Math.random() - 0.5) * 24, b.y - r * 0.5, { dx: (Math.random() - 0.5) * 50, dy: 30 + Math.random() * 20, size: 12 + Math.random() * 6 });
          S.squishV += 3;
        }
      } else S.pet = Math.max(0, S.pet - dt * 0.5);
    }

    // --- sleepy z's
    if (S.sleeping && now - S.zzzAt > 1500) {
      S.zzzAt = now;
      particle('z', cx + S.isl.w / 2 + 6, TOP + S.isl.h / 2 + 4, { dx: 22, dy: 26, size: 11 + Math.random() * 5, life: 2.2, rot: 15 });
    }

    // --- squash & stretch
    S.squishV += (-S.squish * 260 - S.squishV * 9) * dt;
    S.squish += S.squishV * dt;
    let sx = (b.x - anchor.x) * 0.010 + b.vx * 0.0007;
    let sy = (b.y - anchor.y) * 0.010 + b.vy * 0.0007;
    if (S.squish >= 0) sx += S.squish; else sy -= S.squish;
    const sl = Math.hypot(sx, sy);
    if (sl > 0.85) { sx *= 0.85 / sl; sy *= 0.85 / sl; }
    S.goo = damp(S.goo, S.drag ? 18 + Math.min(dist, 130) * 0.22 : 18, 8, dt);

    // --- eyes
    let lx, ly;
    if (S.sleeping) { lx = 0; ly = 0.4; }
    else if (mode === 'drop') { lx = 0; ly = -0.6; } // looking up at what you're bringing
    else if (bd < 700) { const f = Math.min(1, bd / 80); lx = ((c.x - b.x) / bd) * f; ly = ((c.y - b.y) / bd) * f; }
    else { lx = Math.sin(S.t * 0.6) * 0.6; ly = 0.15 + Math.sin(S.t * 0.43) * 0.2; }
    if (mood === 'sad') ly = Math.max(ly, 0.5);
    S.eye.lx = damp(S.eye.lx, lx, 10, dt);
    S.eye.ly = damp(S.eye.ly, ly, 10, dt);
    if (S.t > S.blink.next && !S.sleeping) {
      S.blink.t = 0;
      S.blink.next = S.t + (Math.random() < 0.2 ? 0.3 : 2 + Math.random() * 4.5);
    }
    let blinkF = 1;
    if (S.blink.t >= 0) {
      S.blink.t += dt;
      const u = S.blink.t / 0.16;
      if (u >= 1) S.blink.t = -1; else blinkF = 1 - Math.sin(Math.PI * u);
    }
    S.eyeWide = damp(S.eyeWide, mode === 'drop' ? 1 : 0, 2, dt);
    S.eye.open = damp(S.eye.open, M.open + S.eyeWide * 0.35, 8, dt);
    S.eye.happy = damp(S.eye.happy, M.happy, 6, dt);

    // --- DOM island (content clip) + CSS colour vars
    const iw = S.isl.w, ih = S.isl.h, ir = Math.min(ih / 2, 26 + Math.max(0, ih - 80) * 0.2);
    islandEl.style.cssText = `left:${cx - iw / 2}px;top:${TOP}px;width:${iw}px;height:${ih}px;border-radius:${ir}px`;
    const showsContent = mode !== 'sleep' && (mode !== 'compact' || restingHasContent());
    const fill = Math.min(iw / tw, ih / th);
    const op = showsContent ? smooth(0.78, 0.98, fill) * clamp((now - S.contentChangedAt) / 220, 0, 1) : 0;
    contentEl.style.opacity = op.toFixed(3);
    contentEl.style.filter = op < 0.99 ? `blur(${((1 - op) * 6).toFixed(2)}px)` : 'none';
    if (S.frameNo % 4 === 0) {
      const css = (v) => `rgb(${v.map((x) => Math.round(x * 255)).join(',')})`;
      document.documentElement.style.setProperty('--a', css(S.col.a));
      document.documentElement.style.setProperty('--b', css(S.col.b));
    }

    // --- draw
    if (S.refraction && S.frameNo % 2 === 0) updateBg();
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(S.W * dpr), ph = Math.round(S.H * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    gl.viewport(0, 0, pw, ph);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    u2('uRes', S.W, S.H);
    u1('uDpr', pw / S.W);
    u1('uTime', S.t);
    u4('uIsland', cx, TOP + ih / 2, iw / 2, ih / 2);
    u1('uIslandR', ir);
    gl.uniform3f(loc('uBlob'), b.x, b.y, b.r);
    u2('uStretch', sx, sy);
    u4('uEye', S.eye.lx, S.eye.ly, S.eye.open * blinkF, S.eye.happy);
    u3('uColA', S.col.a);
    u3('uColB', S.col.b);
    u1('uEnergy', S.energy);
    u1('uDark', S.dark);
    u1('uGoo', S.goo * Math.max(S.vis, 0.05));
    u1('uGlow', S.glow);
    u1('uHasBg', S.refraction && hasBg ? 1 : 0);
    u1('uRefr', 1);
    u1('uMono', S.mono);
    u1('uPlain', S.plain);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ------------------------------------------------------------ actions (buttons inside the island)
  function handleAct(act, e) {
    const [k, v, w] = act.split(':');
    switch (k) {
      case 'tab': S.hubTab = v; S.squishV += 1.5; break;
      case 'pin': S.pinned = !S.pinned; break;
      case 'dnd':
        api.setSetting('dnd', !S.cfg.dnd);
        if (!S.cfg.dnd) particle('shh', S.blob.x + 14, S.blob.y - 8, { dx: 14, dy: 18, size: 11, life: 1.2 });
        break;
      case 'settings': api.openSettings(); S.pinned = false; break;
      case 'media': mediaCmd(v); break;
      case 'seek': {
        if (!S.media || !(S.media.dur > 0)) break;
        const rect = byId('m-bar').getBoundingClientRect();
        const ms = Math.round(clamp((e.clientX - rect.left) / rect.width, 0, 1) * S.media.dur);
        api.mediaCmd(`seek:${ms}`);
        S.media.pos = ms; S.media.upd = Date.now();
        break;
      }
      case 'timer':
        if (v === 'start') startTimer(Number(w) || 5); else timerAct(v);
        break;
      case 'shelf':
        if (v === 'remove') api.shelfRemove(w);
        if (v === 'clear') { api.shelfClear(); S.squishV += 4; }
        break;
      default: break;
    }
    updateDynamic(S.mode);
  }

  // ------------------------------------------------------------ input
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const actEl = e.target.closest && e.target.closest('[data-act]');
    if (actEl) {
      if (!actEl.classList.contains('disabled')) handleAct(actEl.dataset.act, e);
      e.preventDefault();
      return;
    }
    if (e.target.closest && e.target.closest('[data-drag]')) return; // let the native drag start
    const h = hit(e.clientX, e.clientY);
    if (h === 'blob') {
      S.drag = true;
      S.dragStart = performance.now();
      S.squishV += 4;
    } else if (h === 'island') {
      if (S.current) { S.current = null; }
      else if (S.mode !== 'hub') S.pinned = true; // a click opens the hub and keeps it open
      S.squishV -= 3;
    }
  });
  document.addEventListener('mouseup', () => {
    if (!S.drag) return;
    S.drag = false;
    const a = anchorFor(S.isl, S.blob.r);
    const pulled = Math.hypot(S.blob.x - a.x, S.blob.y - a.y);
    if (pulled > 40) {
      setTransient('excited', 1400);
      S.squishV -= 7;
      particle('wheee', S.blob.x, S.blob.y - 22, { dy: -16, size: 11, life: 1.2 });
    } else {
      setTransient('happy', 1600);
      S.squishV -= 5;
      particle('♥', S.blob.x, S.blob.y - S.blob.r * 0.5, { dx: 18, dy: 30, size: 14 });
    }
  });

  // Shelf: double-click opens, right-click reveals, wheel scrolls sideways.
  document.addEventListener('dblclick', (e) => {
    const chip = e.target.closest && e.target.closest('.chip[data-id]');
    if (chip) api.shelfOpen(chip.dataset.id);
  });
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const chip = e.target.closest && e.target.closest('.chip[data-id]');
    if (chip) api.shelfReveal(chip.dataset.id);
  });
  document.addEventListener('wheel', (e) => {
    const row = e.target.closest && e.target.closest('.shelf');
    if (row) row.scrollLeft += e.deltaY + e.deltaX;
  }, { passive: true });

  // Drag files OUT of the shelf into any app (native OS drag via main).
  document.addEventListener('dragstart', (e) => {
    const d = e.target.closest && e.target.closest('[data-drag]');
    e.preventDefault();
    if (!d) return;
    S.draggingOut = true;
    S.dragOutAt = performance.now();
    api.shelfDrag(d.dataset.drag === 'all' ? 'all' : [d.dataset.drag]);
    S.squishV += 3;
  });

  // Drag files IN: the island becomes a drop zone.
  const isFileDrag = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  document.addEventListener('dragover', (e) => {
    if (!isFileDrag(e) || !S.cfg.shelfEnabled) return;
    if (S.draggingOut && performance.now() - S.dragOutAt < 15000) return; // our own drag passing by
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (performance.now() - S.dropHoverAt > 400) S.squishV += 2; // first contact
    S.dropHoverAt = performance.now();
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!isFileDrag(e) || !S.cfg.shelfEnabled) return;
    if (S.draggingOut && performance.now() - S.dragOutAt < 15000) return;
    const paths = Array.from(e.dataTransfer.files).map((f) => api.pathForFile(f)).filter(Boolean);
    S.dropHoverAt = 0;
    if (!paths.length) return;
    api.shelfAdd(paths);
    // Gulp!
    S.squishV += 6;
    S.blob.vy -= 200;
    setTransient('happy', 1600);
    particle(`+${paths.length}`, S.blob.x + 16, S.blob.y - 8, { dx: 16, dy: 20, size: 13, life: 1.3 });
    pop();
    peek('shelf', 2600);
  });

  // ------------------------------------------------------------ bridge
  api.on('cursor', (p) => {
    const now = performance.now();
    const dtc = Math.max((now - S.cur.t) / 1000, 1 / 240);
    if (S.cursor.x > -9000) {
      const sp = Math.min(Math.hypot(p.x - S.cursor.x, p.y - S.cursor.y) / dtc, 8000);
      S.cur.speed = S.cur.speed * 0.5 + sp * 0.5;
    }
    S.cur.t = now;
    S.cursor = p;
    S.lastMoveAt = now;
  });
  api.on('event', (n) => pushNotify(n));
  api.on('shelf', (list) => { S.shelf = Array.isArray(list) ? list : []; });
  api.on('shelf-drag-end', () => { S.draggingOut = false; });
  api.on('media', (m) => {
    if (m.type === 'art') {
      if (S.media && m.key !== S.media.key) return; // stale cover from the previous track
      if (m.url === S.mediaArt) return;
      S.mediaArt = m.url;
      applyArtColors(m.url);
      return;
    }
    if (m.state === 'none' || !m.title) { S.media = null; S.mediaArt = null; return; }
    const prev = S.media;
    if (!(m.upd > 1e12)) m.upd = Date.now();
    S.media = m;
    if (!S.cfg.mediaEnabled) return;
    const now = performance.now();
    if (!prev || prev.key !== m.key) {
      if (prev) S.mediaArt = null; // the new cover follows right behind
      if (m.state === 'Playing' && S.mode !== 'hub') {
        peek('home', 3200); // briefly show what's now playing
        S.blob.vy -= 220;
        S.squishV += 4;
      }
    } else if (prev.state !== 'Playing' && m.state === 'Playing') {
      setTransient('happy', 1200);
      particle('♪', S.blob.x + 12, S.blob.y - 6, { dx: 22, dy: 20, size: 14 });
    }
  });
  api.on('state', (s) => { if ('locked' in s) S.locked = !!s.locked; });
  // Only sent by main when COMPANION_DEBUG is set.
  api.on('debug', (d) => {
    if (typeof d.pin === 'boolean') S.pinned = d.pin;
    if (typeof d.tab === 'string') S.hubTab = d.tab;
    if (d.timer > 0) startTimer(Number(d.timer));
    if (d.timerAct) timerAct(String(d.timerAct));
    if (d.drop > 0) S.dropHoverAt = performance.now() + Number(d.drop);
  });
  api.on('geometry', (g) => { S.geo = g; });

  const PREVIEW_KEYS = ['clockStyle', 'clockSize', 'hourFormat', 'showSeconds', 'showDate', 'dateFormat', 'showStats', 'statBattery', 'statCpu', 'statRam'];
  api.on('settings', (s) => {
    const prev = S.cfg;
    S.cfg = { ...DEFAULT_CFG, ...s };
    S.cfgVer++;
    document.documentElement.classList.toggle('mono', !!S.cfg.monochrome);
    if (S.refraction !== !!s.refraction || !S.cfgLoaded) {
      S.refraction = !!s.refraction;
      if (S.refraction) startCapture(); else stopCapture();
    }
    if (S.cfgLoaded) {
      // Live preview: show the clock while it's being customised.
      if (PREVIEW_KEYS.some((k) => prev[k] !== S.cfg[k])) peek('home', 2600);
      if (prev.name !== S.cfg.name) {
        setTransient('happy', 1800);
        S.squishV += 4;
        particle(S.cfg.name, S.blob.x, S.blob.y - 26, { dy: -14, size: 12, life: 1.6 });
      }
      if (prev.colorTheme !== S.cfg.colorTheme) S.squishV += 3;
    } else if (!S.cfg._greeted) {
      setTimeout(() => pushNotify({ icon: 'sparkle', title: `Hi, I'm ${S.cfg.name}!`, body: 'Hover the island · drop files on me · drag me around', mood: 'happy', duration: 6000 }), 900);
      api.setSetting('_greeted', true);
    }
    S.cfgLoaded = true;
  });
  api.on('stats', (st) => {
    S.stats = st;
    const now = performance.now();
    if (st.cpu > 0.85) {
      if (!S.cpuHighSince) S.cpuHighSince = now;
      if (!S.cpuHigh && now - S.cpuHighSince > 6000) {
        S.cpuHigh = true;
        if (now > S.cpuWarnCd && S.cfg.notifySystem) {
          S.cpuWarnCd = now + 5 * 60 * 1000;
          pushNotify({ icon: 'cpu', title: 'Working hard', body: `CPU at ${Math.round(st.cpu * 100)}% — I'm sweating a little`, mood: 'alert' });
        }
      }
    } else if (st.cpu < 0.6) { S.cpuHighSince = 0; S.cpuHigh = false; }
  });

  if (navigator.getBattery) {
    navigator.getBattery().then((bat) => {
      S.battery = bat;
      S.batteryPrev = bat.level;
      bat.addEventListener('levelchange', () => {
        const l = bat.level;
        if (!bat.charging && S.cfg.notifySystem) {
          for (const th of [0.2, 0.1]) {
            if (S.batteryPrev > th && l <= th) pushNotify({ icon: 'battery', title: 'Battery low', body: `${Math.round(l * 100)}% left — feed me?`, mood: 'alert' });
          }
        }
        S.batteryPrev = l;
      });
    }).catch(() => {});
  }
  addEventListener('online', () => { S.online = true; if (S.cfg.notifySystem) pushNotify({ icon: 'wifi', title: 'Back online', body: 'The internet missed you too.', mood: 'happy' }); });
  addEventListener('offline', () => { S.online = false; if (S.cfg.notifySystem) pushNotify({ icon: 'wifi-off', title: 'Offline', body: 'I can\'t reach the internet.', mood: 'sad' }); });
  addEventListener('resize', () => { S.W = innerWidth; S.H = innerHeight; });

  requestAnimationFrame(frame);
  api.ready();
})();
