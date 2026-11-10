'use strict';
(() => {
  const api = window.mochi || { get: async () => ({}), set() {}, onChange() {}, testNotify() {} };
  const root = document.getElementById('root');
  let S = {};
  const syncers = []; // functions that refresh controls from S

  const THEMES = {
    mood:   'conic-gradient(from 200deg, #5ee7d6, #8b5cf6, #ff6fb5, #ffd166, #5ee7d6)',
    ocean:  'linear-gradient(135deg, #5ee7d6, #3b82f6)',
    sunset: 'linear-gradient(135deg, #ffb36b, #ff4f7b)',
    forest: 'linear-gradient(135deg, #a3e635, #059669)',
    grape:  'linear-gradient(135deg, #c084fc, #6d28d9)',
    mono:   'linear-gradient(135deg, #f4f4f5, #71717a)',
  };
  const THEME_ACCENT = {
    mood: ['#5ee7d6', '#7c6cf6'], ocean: ['#5ee7d6', '#3b82f6'], sunset: ['#ffb36b', '#ff4f7b'],
    forest: ['#a3e635', '#059669'], grape: ['#c084fc', '#6d28d9'], mono: ['#e4e4e7', '#71717a'],
  };

  const today = new Date();
  const fmtDate = (f) => today.toLocaleDateString([], f === 'long' ? { weekday: 'long', day: 'numeric', month: 'short' }
    : f === 'short' ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: '2-digit', month: '2-digit', year: 'numeric' });

  const SECTIONS = [
    { title: 'Companion', rows: [
      { key: 'name', type: 'text', label: 'Name', hint: 'What your companion answers to' },
      { key: 'showCompanion', type: 'toggle', label: 'Show companion', hint: 'Turn off to keep only the island' },
      { type: 'button', label: 'Minimal mode', hint: 'Hide the companion and use a clean, solid black island', text: 'Go minimal',
        onClick: () => { api.set('showCompanion', false); api.set('islandStyle', 'black'); } },
      { key: 'colorTheme', type: 'swatches', label: 'Colours', hint: 'Mood changes colour with feelings and album art', options: Object.keys(THEMES), disabledBy: 'monochrome' },
      { key: 'monochrome', type: 'toggle', label: 'Black & white', hint: 'Only black, white and greys: companion, island and accents' },
      { key: 'sleepAfter', type: 'segment', label: 'Dozes off after', hint: 'Minutes without input',
        options: [['1', '1m'], ['2', '2m'], ['5', '5m'], ['10', '10m'], ['30', '30m'], ['never', 'Never']] },
    ] },
    { title: 'Clock', rows: [
      { key: 'clockStyle', type: 'tiles', label: 'Style',
        options: [['classic', 'Classic'], ['light', 'Light'], ['bold', 'Bold'], ['mono', 'Mono'], ['neon', 'Neon'], ['stacked', 'Stacked']] },
      { key: 'clockSize', type: 'segment', label: 'Size', options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] },
      { key: 'hourFormat', type: 'segment', label: 'Hour format', options: [['auto', 'System'], ['12', '12h'], ['24', '24h']] },
      { key: 'showSeconds', type: 'toggle', label: 'Show seconds' },
      { key: 'showDate', type: 'toggle', label: 'Show date' },
      { key: 'dateFormat', type: 'segment', label: 'Date format', sub: true, dependsOn: 'showDate',
        options: [['long', fmtDate('long')], ['short', fmtDate('short')], ['numeric', fmtDate('numeric')]] },
      { key: 'restingClock', type: 'toggle', label: 'Time in the resting island', hint: 'Show the clock even when the island is small' },
    ] },
    { title: 'System stats', rows: [
      { key: 'showStats', type: 'toggle', label: 'Show system stats', hint: 'Rings next to the clock' },
      { key: 'statBattery', type: 'toggle', label: 'Battery', sub: true, dependsOn: 'showStats' },
      { key: 'statCpu', type: 'toggle', label: 'CPU', sub: true, dependsOn: 'showStats' },
      { key: 'statRam', type: 'toggle', label: 'Memory', sub: true, dependsOn: 'showStats' },
    ] },
    { title: 'Island features', rows: [
      { key: 'mediaEnabled', type: 'toggle', label: 'Media player', hint: 'Now playing, album art and controls' },
      { key: 'mediaAnyApp', type: 'toggle', label: 'Any media app', hint: 'Not just Spotify: browsers, players…', sub: true, dependsOn: 'mediaEnabled' },
      { key: 'shelfEnabled', type: 'toggle', label: 'File shelf', hint: 'Drop files on the island, drag them out into any app later' },
      { key: 'timerEnabled', type: 'toggle', label: 'Timer', hint: 'Quick countdowns that live in the island' },
    ] },
    { title: 'Notifications', rows: [
      { key: 'dnd', type: 'toggle', label: 'Do not disturb', hint: 'Silence everything except timers' },
      { key: 'notifySystem', type: 'toggle', label: 'System events', hint: 'Charging, battery, CPU, network, lock' },
      { key: 'notifyClipboard', type: 'toggle', label: 'Clipboard', hint: 'React when you copy text' },
      { key: 'clipboardPreview', type: 'toggle', label: 'Show what was copied', sub: true, dependsOn: 'notifyClipboard', hint: 'Things that look like passwords stay hidden' },
      { key: 'hourlyReminder', type: 'toggle', label: 'Hourly stretch reminder' },
      { key: 'notifyDuration', type: 'segment', label: 'Show notifications for', options: [['short', '3s'], ['normal', '4.5s'], ['long', '7s']] },
      { key: 'sounds', type: 'toggle', label: 'Sounds', hint: 'Timer chime and little pops' },
      { type: 'button', label: 'Try it', hint: 'Send a test notification', text: 'Send test', onClick: () => api.testNotify() },
    ] },
    { title: 'Look & system', rows: [
      { key: 'islandStyle', type: 'segment', label: 'Island style', hint: 'Liquid glass, or a clean solid black pill',
        options: [['glass', 'Liquid glass'], ['black', 'Solid black']] },
      { key: 'refraction', type: 'toggle', label: 'Glass refraction', hint: 'Bend the desktop behind the island', sub: true, dependsOn: 'islandStyle:glass' },
      { key: 'startAtLogin', type: 'toggle', label: 'Start with Windows' },
    ] },
  ];

  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function clockSample(style) {
    const parts = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', hour12: S.hourFormat === 'auto' ? undefined : S.hourFormat === '12' }).formatToParts(new Date());
    const g = (t) => (parts.find((p) => p.type === t) || {}).value || '';
    const h = S.hourFormat === '24' ? g('hour').padStart(2, '0') : g('hour');
    return style === 'stacked' ? `<span>${esc(h)}</span><span>${esc(g('minute'))}</span>` : `${esc(h)}:${esc(g('minute'))}`;
  }

  function control(row) {
    switch (row.type) {
      case 'toggle': {
        const t = el('div', 'toggle');
        t.addEventListener('click', () => api.set(row.key, !S[row.key]));
        syncers.push(() => t.classList.toggle('on', !!S[row.key]));
        return t;
      }
      case 'segment': {
        const seg = el('div', 'seg');
        for (const [v, label] of row.options) {
          const b = el('button', '', esc(label));
          b.addEventListener('click', () => api.set(row.key, v));
          syncers.push(() => b.classList.toggle('on', S[row.key] === v));
          seg.appendChild(b);
        }
        return seg;
      }
      case 'text': {
        const inp = el('input');
        inp.type = 'text'; inp.maxLength = 24; inp.spellcheck = false;
        let timer = null;
        inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => api.set(row.key, inp.value), 450); });
        inp.addEventListener('blur', () => { clearTimeout(timer); api.set(row.key, inp.value); });
        syncers.push(() => { if (document.activeElement !== inp) inp.value = S[row.key] || ''; });
        return inp;
      }
      case 'swatches': {
        const wrap = el('div', 'swatches');
        for (const v of row.options) {
          const s = el('div', 'swatch');
          s.style.background = THEMES[v];
          s.title = v[0].toUpperCase() + v.slice(1);
          s.addEventListener('click', () => api.set(row.key, v));
          syncers.push(() => s.classList.toggle('on', S[row.key] === v));
          wrap.appendChild(s);
        }
        return wrap;
      }
      case 'tiles': {
        const grid = el('div', 'tiles');
        for (const [v, label] of row.options) {
          const t = el('div', 'tile');
          const clk = el('div', `clk clk-${v}`);
          t.append(clk, el('small', '', esc(label)));
          t.addEventListener('click', () => api.set(row.key, v));
          syncers.push(() => { t.classList.toggle('on', S[row.key] === v); clk.innerHTML = clockSample(v); });
          grid.appendChild(t);
        }
        return grid;
      }
      case 'button': {
        const b = el('button', 'btn', esc(row.text));
        b.addEventListener('click', row.onClick);
        return b;
      }
      default: return el('div');
    }
  }

  function build() {
    for (const sec of SECTIONS) {
      const s = el('section');
      s.appendChild(el('h2', '', esc(sec.title)));
      const card = el('div', 'card');
      for (const row of sec.rows) {
        const r = el('div', `row${row.sub ? ' sub' : ''}${row.type === 'tiles' ? ' stack' : ''}`);
        r.appendChild(el('div', 'label', `<b>${esc(row.label)}</b>${row.hint ? `<span>${esc(row.hint)}</span>` : ''}`));
        r.appendChild(control(row));
        if (row.dependsOn) {
          const [dk, dv] = row.dependsOn.split(':');
          syncers.push(() => r.classList.toggle('disabled', dv ? S[dk] !== dv : !S[dk]));
        }
        if (row.disabledBy) syncers.push(() => r.classList.toggle('disabled', !!S[row.disabledBy]));
        card.appendChild(r);
      }
      s.appendChild(card);
      root.appendChild(s);
    }
  }

  function sync() {
    document.getElementById('name-title').textContent = S.name || 'Mochi';
    document.title = `${S.name || 'Mochi'} Settings`;
    const [a, b] = S.monochrome ? ['#f4f4f5', '#8a8a8f'] : THEME_ACCENT[S.colorTheme] || THEME_ACCENT.mood;
    document.documentElement.style.setProperty('--a', a);
    document.documentElement.style.setProperty('--b', b);
    syncers.forEach((f) => f());
  }

  build();
  api.onChange((s) => { S = s; sync(); });
  api.get().then((s) => { S = s; sync(); });
  setInterval(sync, 30000); // keep the clock previews current
})();
