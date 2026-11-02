'use strict';

/* ==========================================================================
   Settings window renderer.

   This window owns nothing but the settings document. All state lives in the
   main process (`settings.json`) and every write goes through
   `window.lh.settings.save`, which broadcasts the new settings to the main
   window. That keeps the two windows in step without either one holding a
   second copy of the truth.
   ========================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ACCENTS = [
  { hex: '#0067c0', name: 'Blue' },
  { hex: '#e3008c', name: 'Magenta' },
  { hex: '#c239b3', name: 'Orchid' },
  { hex: '#7a7574', name: 'Grey' },
  { hex: '#498205', name: 'Green' },
  { hex: '#008373', name: 'Teal' },
  { hex: '#8764b8', name: 'Purple' },
  { hex: '#ca5010', name: 'Orange' },
  { hex: '#0078d4', name: 'Azure' }
];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const state = {
  settings: null,
  info: null,
  systemDark: false,
  systemAccent: null
};

/* ------------------------------------------------------------------ theme */

function applyAccentForeground() {
  // Kept in step with app.js: the accent swatches need a legible foreground on
  // top of whatever accent is active, light or dark.
  const hex = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // sRGB relative luminance, then pick white or near-black by contrast.
  const lum = [r, g, b]
    .map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    })
    .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
  document.documentElement.style.setProperty('--text-on-accent', lum > 0.45 ? '#1b1b1b' : '#fff');
}

function applyTheme() {
  const s = state.settings;
  if (!s) return;
  const mode = s.mode === 'system' ? (state.systemDark ? 'dark' : 'light') : s.mode;
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.dataset.material = s.material;

  if (s.accent === 'system') {
    const sys = state.systemAccent && state.systemAccent.accent;
    if (sys) root.style.setProperty('--accent', sys);
    else root.style.removeProperty('--accent');
  } else {
    root.style.setProperty('--accent', s.accent);
  }
  applyAccentForeground();

  root.style.setProperty('--tint-light', String(s.tint.light));
  root.style.setProperty('--tint-dark', String(s.tint.dark));
  root.dataset.transitions = String(!!s.transitions);
  root.dataset.backdrop = String(!!(state.info && state.info.nativeBackdrop) && s.material !== 'solid');
  // The native backdrop is painted by DWM, which follows the app's own theme
  // setting, not the CSS alone.
  if (window.lh && window.lh.win.theme) window.lh.win.theme(mode);
}

function updateModeHelp() {
  const help = $('#mode-help');
  if (help) {
    help.textContent = `Windows is currently using ${state.systemDark ? 'dark' : 'light'} mode, so System sync will match it.`;
  }
}

async function detectSystemTheme() {
  state.systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    state.systemDark = e.matches;
    if (state.settings && state.settings.mode === 'system') applyTheme();
    updateModeHelp();
  });
}

/* ------------------------------------------------------------------- paint */

function buildAccents() {
  const row = $('#accent-row');
  if (!row) return;
  row.innerHTML = '';

  const group = el('div', 'swatch-group');
  group.appendChild(el('span', 'group-label', 'Colour'));
  const strip = el('div', 'swatch-group-row');

  // System leads the palette, as in the main window, so the row is all one size.
  const sys = el('button', 'swatch system');
  sys.dataset.accent = 'system';
  sys.setAttribute('aria-label', 'Use the Windows accent colour');
  sys.appendChild(el('span', 'swatch-chip'));
  sys.addEventListener('click', () => patch({ accent: 'system' }));
  strip.appendChild(sys);

  for (const c of ACCENTS) {
    const b = el('button', 'swatch');
    b.dataset.accent = c.hex;
    b.style.background = c.hex;
    b.title = c.name;
    b.setAttribute('aria-label', c.name);
    b.addEventListener('click', () => patch({ accent: c.hex }));
    strip.appendChild(b);
  }

  group.appendChild(strip);
  row.appendChild(group);
  paintSystemSwatch();
}

function paintSystemSwatch() {
  const sw = $('#accent-row .swatch[data-accent="system"]');
  if (!sw) return;
  const sys = state.systemAccent && state.systemAccent.accent;
  if (sys) sw.style.setProperty('--swatch', sys);
}

function syncUi() {
  const s = state.settings;
  if (!s) return;

  const folder = $('#set-folder');
  if (folder) {
    folder.value = s.photoFolder || '';
    folder.title = s.photoFolder || '';
  }

  $$('#set-view input').forEach((r) => { r.checked = r.value === s.libraryView; });

  const group = $('#set-group');
  if (group) group.checked = !!s.groupByFolder;
  const filmstrip = $('#set-filmstrip');
  if (filmstrip) filmstrip.checked = !!s.showFilmstrip;
  const transitions = $('#set-transitions');
  if (transitions) transitions.checked = !!s.transitions;
  const filenames = $('#set-filenames');
  if (filenames) filenames.checked = s.showFilenames !== false;

  $$('input[name="mode"]').forEach((r) => { r.checked = r.value === s.mode; });
  updateModeHelp();

  // A saved 'solid' is the automatic no-GPU fallback, not a pick the user can
  // make any more: showing it directly would uncheck both radios.
  const shownMaterial = s.material === 'solid' ? 'acrylic' : s.material;
  $$('input[name="material"]').forEach((r) => { r.checked = r.value === shownMaterial; });

  $$('#accent-row .swatch').forEach((sw) => {
    sw.classList.toggle('active', sw.dataset.accent === s.accent);
  });
  paintSystemSwatch();

}

/* -------------------------------------------------------------------- save */

async function patch(p, also) {
  state.settings = await window.lh.settings.save(p);
  applyTheme();
  syncUi();
  if (typeof also === 'function') also(state.settings);
}

/* ------------------------------------------------------------------- About */

function fillAbout(info) {
  const version = $('#about-version');
  if (version) {
    const buildLabel = info.platform === 'win32'
      ? `${info.osLabel}${info.build ? ' build ' + info.build : ''}`
      : info.osLabel || '';
    version.textContent = `Version ${info.versions.app} · ${buildLabel}`;
  }
  // The r-number and the DWM frame/corner diagnostics used to be printed here.
  // They were build-time debugging, not user-facing information, and the frame
  // status is now visible in the window itself.

  const fl = $('#format-list');
  if (fl) {
    fl.textContent = 'JPG JPEG JPE JFIF JFI PNG APNG BMP DIB GIF TIF TIFF TGA WEBP ICO PSD PNM PPM PGM PBM HDR QOI FF SVG HEIC HEIF JXL DNG CR2 CR3 CRW NEF NRW ARW SRF SR2 ORF RW2 RAF PEF SRW RAW RWL MRW X3F IIQ RWZ MEF MOS MDC CAP 3FR ARI BAY DCR ERF KDC MFW PXN R3D';
  }
}

/* --------------------------------------------------------------------- tabs */

function switchTab(tab) {
  $$('.settings-nav .nav-item').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $$('.settings-tab').forEach((t) => { t.hidden = t.id !== 'tab-' + tab; });
}

/* --------------------------------------------------------------------- wire */

let setNavCollapsed = () => {};

function wire() {
  const shell = $('#settings-shell');
  const toggle = $('#pane-toggle');

  /* Sidebar collapse. The grid column goes to zero and the labels are removed
     rather than squeezed, so nothing looks mangled halfway through. The state is
     saved with the rest of the settings and restored on next open. */
  setNavCollapsed = function (collapsed, persist) {
    shell.classList.toggle('nav-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.title = collapsed ? 'Expand the sidebar' : 'Collapse the sidebar';
    if (persist) patch({ settingsNavCollapsed: collapsed });
  };
  toggle.addEventListener('click', () => {
    setNavCollapsed(!shell.classList.contains('nav-collapsed'), true);
  });

  $('#set-min').addEventListener('click', () => window.lh.win.action('minimize'));
  $('#set-max').addEventListener('click', () => window.lh.win.action('maximize'));
  $('#set-winhide').addEventListener('click', () => window.lh.win.action('close'));
  // Double-clicking the title strip toggles maximize, as every Windows app does.
  $('#settings-titlebar').addEventListener('dblclick', (e) => {
    if (e.target.closest('.caption-btn')) return;
    window.lh.win.action('maximize');
  });

  $$('.settings-nav .nav-item').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });

  $('#set-change').addEventListener('click', async () => {
    const folder = await window.lh.library.chooseFolder();
    if (!folder) return;
    await patch({ photoFolder: folder });
  });
  $('#set-default').addEventListener('click', async () => {
    const def = (state.info && state.info.pictures) || '';
    if (def) await patch({ photoFolder: def });
  });
  // Quick folders are built here rather than in the markup: they depend on the
  // user's own home and Pictures paths, which only the main process knows.
  const quick = $('#quick-folders');
  if (quick) {
    const info = state.info || {};
    const candidates = [
      { label: 'Pictures', path: info.pictures },
      { label: 'Downloads', path: info.home ? info.home + '\\Downloads' : '' },
      { label: 'Desktop', path: info.home ? info.home + '\\Desktop' : '' }
    ].filter((c) => c.path);
    quick.innerHTML = '';
    for (const c of candidates) {
      const b = el('button', 'chip');
      b.dataset.path = c.path;
      b.innerHTML = `<svg><use href="#i-folder"/></svg><span>${c.label}</span>`;
      b.title = c.path;
      b.addEventListener('click', () => patch({ photoFolder: c.path }));
      quick.appendChild(b);
    }
  }

  $$('#set-view input').forEach((r) => {
    r.addEventListener('change', () => patch({ libraryView: r.value }));
  });
  $('#set-group').addEventListener('change', (e) => patch({ groupByFolder: e.target.checked }));
  $('#set-filmstrip').addEventListener('change', (e) => patch({ showFilmstrip: e.target.checked }));
  $('#set-transitions').addEventListener('change', (e) => patch({ transitions: e.target.checked }));
  $('#set-filenames').addEventListener('change', (e) => patch({ showFilenames: e.target.checked }));

  $$('input[name="mode"]').forEach((r) => {
    r.addEventListener('change', () => patch({ mode: r.value }));
  });
  $$('input[name="material"]').forEach((r) => {
    r.addEventListener('change', () => patch({ material: r.value }));
  });

  $$('#accent-row .swatch').forEach((sw) => {
    sw.addEventListener('click', () => patch({ accent: sw.dataset.accent }));
  });

  window.lh.events.accentChanged((next) => {
    if (!next || !next.accent) return;
    state.systemAccent = next;
    applyTheme();
    paintSystemSwatch();
  });

  // The main window can ask for a specific tab (Settings → About, for example),
  // and the tab the user last looked at is restored on reopen.
  window.lh.events.settingsTab((tab) => {
    if (tab) switchTab(tab);
  });

  // Another window wrote to settings.json; take the new values so this one does
  // not sit there showing stale radios.
  window.lh.events.settingsChanged((next) => {
    if (!next) return;
    state.settings = next;
    applyTheme();
    syncUi();
  });

  window.lh.events.state(({ maximized, snapped }) => {
    if (snapped !== undefined) {
      document.documentElement.dataset.snapped = String(snapped);
    }
    if (maximized === undefined) return;
    document.documentElement.dataset.maximized = String(maximized);
    const icon = $('#set-max-icon');
    if (icon) icon.innerHTML = `<use href="#i-chrome_${maximized ? 'restore' : 'max'}"/>`;
    const btn = $('#set-max');
    if (btn) btn.title = maximized ? 'Restore' : 'Maximize';
  });

  // Ctrl+W / Esc close the window, matching the rest of the app's habits.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { window.lh.win.action('close'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      window.lh.win.action('close');
    }
  });

  $$('a[target="_blank"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.lh && window.lh.file) window.lh.file.openExternal(a.href);
    });
  });
}

/* --------------------------------------------------------------------- boot */

function injectIconSprite() {
  // Same contract as app.js: icons.js exposes a sprite string, the document
  // carries an empty <div id="icon-defs"> for it to land in.
  const defs = document.getElementById('icon-defs');
  if (!defs) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.style.width = '0';
  svg.style.height = '0';
  svg.style.overflow = 'hidden';
  svg.innerHTML = (window.ICONS_SPRITE || '').trim();
  defs.appendChild(svg);
}

async function boot() {
  injectIconSprite();
  await detectSystemTheme();

  state.info = await window.lh.info();
  state.systemAccent = state.info.accent || (await window.lh.accent.get());
  state.settings = await window.lh.settings.load();
  // Pulled, not pushed: this handler runs after the async boot, by which point
  // any `settings:tab` event fired at did-finish-load is already gone.
  const requestedTab = await window.lh.settings.tab();

  applyTheme();
  buildAccents();
  syncUi();
  fillAbout(state.info);
  wire();
  switchTab(requestedTab || 'library');
  setNavCollapsed(!!state.settings.settingsNavCollapsed, false);

  const max = await window.lh.win.isMaximized();
  document.documentElement.dataset.maximized = String(max);
  const icon = $('#set-max-icon');
  if (icon) icon.innerHTML = `<use href="#i-chrome_${max ? 'restore' : 'max'}"/>`;

  // The window was created hidden and shown once the settings are painted, so
  // there is never a frame of unthemed white.
  window.lh.win.action('settings-ready');
}

document.addEventListener('DOMContentLoaded', boot);
