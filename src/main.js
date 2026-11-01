'use strict';

/**
 * Lehtratuh — a remastered Windows Photo Viewer + Gallery.
 * Main process: window chrome, Windows 11 system backdrop (Acrylic / Mica),
 * library scanning, media protocol, EXIF, thumbnails, file operations.
 */

const {
  app, BrowserWindow, ipcMain, dialog, shell, protocol, nativeImage,
  clipboard, Menu, net, screen, nativeTheme, JumpListCategory, JumpListItem
} = require('electron');

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { readWindowsAccent, watchWindowsAccent } = require('./accent');
const { pathToFileURL } = require('url');

const IS_WIN = process.platform === 'win32';
const REV = 'r41';
const IS_MAC = process.platform === 'darwin';

/* ------------------------------------------------------------------ */
/*  Image formats                                                      */
/* ------------------------------------------------------------------ */

const NATIVE_EXT = new Set([
  '.jpg', '.jpeg', '.jpe', '.jfif', '.jfi', '.png', '.apng', '.bmp', '.dib',
  '.gif', '.webp', '.avif', '.ico', '.svg'
]);

const DECODED_EXT = new Set([
  '.tif', '.tiff', '.tga', '.psd', '.dds', '.pnm', '.ppm', '.pgm', '.pbm',
  '.hdr', '.qoi', '.ff'
]);

const RAW_EXT = new Set([
  '.dng', '.cr2', '.cr3', '.crw', '.nef', '.nrw', '.arw', '.srf', '.sr2',
  '.orf', '.rw2', '.raf', '.pef', '.srw', '.raw', '.rwl', '.mrw', '.x3f',
  '.iiq', '.rwz', '.mef', '.mos', '.mdc', '.cap', '.3fr', '.ari', '.bay',
  '.dcr', '.erf', '.kdc', '.mfw', '.pxn', '.r3d'
]);

const HEIF_EXT = new Set(['.heic', '.heif', '.jxl']);

const IMAGE_EXT = new Set([...NATIVE_EXT, ...DECODED_EXT, ...RAW_EXT, ...HEIF_EXT]);

/* Formats Chromium can hand to a canvas element. Deliberately narrower than
   NATIVE_EXT: Electron's nativeImage can read AVIF and ICO, but the renderer
   cannot, so anything that needs a canvas round-trip (rotate, flip, auto adjust,
   apply) is limited to this list. */
const BROWSER_DECODABLE_EXT = new Set([
  '.jpg', '.jpeg', '.jpe', '.jfif', '.jfi', '.png', '.apng', '.bmp', '.dib',
  '.gif', '.webp', '.ico', '.svg'
]);

const SKIP_DIRS = new Set([
  '$recycle.bin', 'system volume information', 'recovery', 'windows', 'winsxs',
  'node_modules', '.git', '.svn', 'appdata', 'program files', 'program files (x86)',
  'programdata', 'perflogs', 'msocache', 'config.msi', 'boot', 'documents and settings'
]);

/* ------------------------------------------------------------------ */
/*  Settings store                                                     */
/* ------------------------------------------------------------------ */

const DEFAULTS = {
  version: 1,
  photoFolder: '',
  mode: 'light',                 // light | dark | system
  accent: '#0067c0',
  material: 'acrylic',           // acrylic | mica | solid
  tint: { light: 4, dark: 8 },   // requested spec: 4% light / 8% dark
  materialOpacity: { light: 92, dark: 88 },
  libraryView: 'tiles',          // tiles | cards | collage | thumbnails | details | grid
  tileSize: 'medium',
  showFilenames: true,
  sort: 'added-desc',
  groupByFolder: true,
  showFilmstrip: true,
  transitions: true,
  windowBounds: null,
  windowMaximized: false
};

let settings = { ...DEFAULTS };
let settingsFile = '';

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('[settings] write failed', err);
  }
}

function loadSettings() {
  const loaded = readJSON(settingsFile, {}) || {};
  settings = { ...DEFAULTS, ...loaded };
  settings.tint = { ...DEFAULTS.tint, ...(loaded.tint || {}) };
  settings.materialOpacity = { ...DEFAULTS.materialOpacity, ...(loaded.materialOpacity || {}) };
  if (!settings.photoFolder || !fs.existsSync(settings.photoFolder)) {
    settings.photoFolder = app.getPath('pictures');
    if (!fs.existsSync(settings.photoFolder)) settings.photoFolder = app.getPath('home');
  }
  syncNativeThemeSource();
}

/* DWM paints the Mica backdrop from `nativeTheme.themeSource`, not from the
   CSS. Nothing ever set it, so the app's own Light/Dark setting only changed
   the page while the backdrop kept following the *machine's* theme. On a
   Windows box running dark mode, choosing Light gave a light page over a dark
   mica backdrop — and since the light veil is only 55%+tint white, that blended
   to a mid grey, which is exactly what "Mica light is greyish" was seeing. */
function syncNativeThemeSource() {
  try {
    nativeTheme.themeSource = settings.mode === 'system' ? 'system' : settings.mode;
  } catch { /* older runtimes */ }
}

function saveSettings(patch) {
  settings = { ...settings, ...(patch || {}) };
  if (patch && patch.tint) settings.tint = { ...settings.tint, ...patch.tint };
  if (patch && patch.materialOpacity) {
    settings.materialOpacity = { ...settings.materialOpacity, ...patch.materialOpacity };
  }
  writeJSON(settingsFile, settings);
  return settings;
}

/* ------------------------------------------------------------------ */
/*  Windows build detection (backdrop support)                         */
/* ------------------------------------------------------------------ */

function windowsBuild() {
  if (!IS_WIN) return 0;
  const m = /^10\.0\.(\d+)/.exec(os.release());
  return m ? parseInt(m[1], 10) : 0;
}

function windowsVersionLabel() {
  if (!IS_WIN) return 'Linux';
  const build = windowsBuild();
  if (build >= 22000) return 'Windows 11';
  if (build >= 10240) return 'Windows 10';
  return 'Windows';
}

/* ------------------------------------------------------------------ */
/*  Main window                                                        */
/* ------------------------------------------------------------------ */

let mainWindow = null;
let settingsWindow = null;
let lastSettingsTab = 'library';

/* ---------------------------------------------------------------------------
   Two separate lines have to be dealt with, and they need different tools.

   1. THE RESIZE FRAME (r30). `thickFrame: true` gives a frameless window a real
      WS_THICKFRAME frame so it can be resized and snapped. Windows paints that
      frame as padding around the client area — about 7 logical pixels down each
      side, none on top or bottom. A CSS border cannot cover it because it lies
      outside the document. The fix is Electron's own `thickFrame: false`.
      Do NOT try to clear the style bits via SetWindowLongW: Electron re-applies
      its style afterwards and the padding comes straight back (r29 confirmed).

   2. THE 1PX OUTLINE (r21). Windows 11 also strokes a hairline around the
      frame. That one is DWM's border colour:
        DWMWA_BORDER_COLOR (34) = DWMWA_COLOR_NONE (0xFFFFFFFE)
      Windows 10 lacks the attribute; the call simply fails there.
--------------------------------------------------------------------------- */
const koffi = (() => {
  try { return require('koffi'); } catch { return null; }
})();

/* Hide the compositor's own 1px outline.
   Windows 11 draws it around any window carrying WS_THICKFRAME, which a frameless
   Electron window needs for edge-resizing, snapping and its drop shadow. The line
   is painted by DWM, never by the page — a hard CSS border at `inset: 0` paints
   over it, which is how we know. Electron has no option for it, so ask DWM
   directly: DWMWA_BORDER_COLOR (34) = DWMWA_COLOR_NONE (0xFFFFFFFE).

   Everything here is guarded. A native call that throws or crashes on launch is
   far worse than a hairline, so on any failure the window simply keeps its
   default frame. Windows 10 lacks the attribute; there the call fails harmlessly.
   `LH_NO_STRIP=1` in the environment skips it, for diagnosing exactly this. */
const DWM_BORDER_COLOR = 34;
const DWM_COLOR_NONE = 0xFFFFFFFE;

/* DWMWA_WINDOW_CORNER_PREFERENCE (33), values from DWM_WINDOW_CORNER_PREFERENCE.

   This has to be DWMWCP_ROUND (2), NOT DWMWCP_DEFAULT (0). DEFAULT means "let
   DWM decide", and DWM's decision is "do not round" for a window with no frame.
   r32 sent DEFAULT and the corners stayed square — DWM accepted the call, wrote
   it, and then declined to act on it, which is why the About readout said ok.

   What the user sees without this: the CSS arc on `body` paints a rounded dark
   shape, but the window below it is still a rectangle carrying a live mica
   backdrop. In the four corner squares the backdrop has no dark surface over
   it, so it shows through the hole, brighter than the window itself. That is
   the "squared edge" — a pale wedge in each corner, not an arc.

   Rounding applies to Acrylic and Mica. Lite is the low-power profile and keeps
   square corners deliberately. */
const DWM_WINDOW_CORNER = 33;
const DWM_CORNER_DONOTROUND = 1;
const DWM_CORNER_ROUND = 2;

let lastCornerResult = 'not attempted';
function setCornerRounding(win, round) {
  if (!IS_WIN) { lastCornerResult = 'not windows'; return false; }
  if (process.env.LH_NO_STRIP === '1') { lastCornerResult = 'disabled by env'; return false; }
  const call = resolveDwm();
  if (!call) { lastCornerResult = 'dwmapi unavailable'; return false; }
  try {
    const handle = win.getNativeWindowHandle();
    const hwnd = handle.length >= 8
      ? Number(handle.readBigUInt64LE(0))
      : handle.readUInt32LE(0);
    const pref = Buffer.alloc(4);
    // ROUND for Mica/Acrylic, DONOTROUND for Lite.
    pref.writeUInt32LE(round ? DWM_CORNER_ROUND : DWM_CORNER_DONOTROUND, 0);
    const hr = call(hwnd, DWM_WINDOW_CORNER, pref, 4);
    lastCornerResult = hr === 0
      ? `ok(0x${hr.toString(16)}) · ${round ? 'rounded' : 'square'}`
      : `HRESULT 0x${(hr >>> 0).toString(16)}`;
    return hr === 0;
  } catch (e) {
    lastCornerResult = 'threw: ' + (e && e.message);
    return false;
  }
}

let dwmSetWindowAttribute = null;
function resolveDwm() {
  if (dwmSetWindowAttribute || !IS_WIN || !koffi) return dwmSetWindowAttribute;
  try {
    const dwmapi = koffi.load('dwmapi.dll');
    dwmSetWindowAttribute = dwmapi.func('__stdcall', 'DwmSetWindowAttribute',
      'long', ['intptr_t', 'uint32_t', 'uint32_t *', 'uint32_t']);
  } catch {
    dwmSetWindowAttribute = null;
  }
  return dwmSetWindowAttribute;
}

let lastStripResult = 'not attempted';
function stripNativeBorder(win) {
  if (!IS_WIN) { lastStripResult = 'not windows'; return false; }
  if (process.env.LH_NO_STRIP === '1') { lastStripResult = 'disabled by env'; return false; }
  const call = resolveDwm();
  if (!call) { lastStripResult = 'dwmapi unavailable'; return false; }
  try {
    const handle = win.getNativeWindowHandle();
    const hwnd = handle.length >= 8
      ? Number(handle.readBigUInt64LE(0))
      : handle.readUInt32LE(0);
    const color = Buffer.alloc(4);
    color.writeUInt32LE(DWM_COLOR_NONE, 0);
    const hr = call(hwnd, DWM_BORDER_COLOR, color, 4);
    lastStripResult = hr === 0 ? `ok(0x${hr.toString(16)})` : `HRESULT 0x${(hr >>> 0).toString(16)}`;
    return hr === 0;
  } catch (e) {
    lastStripResult = 'threw: ' + (e && e.message);
    return false;
  }
}

/* The frame does not exist until the window is on screen, so an early call can
   succeed against a stale frame and be undone when DWM creates the real one.
   Re-assert after show, after the first paint, and on frame changes. */
function pinBorderless(win) {
  const apply = () => {
    if (win.isDestroyed()) return;
    stripNativeBorder(win);
    // The corner preference is reset the same way the border colour is when DWM
    // rebuilds the frame on show or maximize, so it is re-pinned alongside it.
    setCornerRounding(win, settings.material !== 'solid');
  };
  apply();
  win.once('ready-to-show', () => setTimeout(apply, 0));
  win.webContents.once('did-finish-load', () => setTimeout(apply, 60));
  setTimeout(apply, 400);
  setTimeout(apply, 1200);
}

const windows = new Set();

const TITLEBAR_H = 46;

/* ------------------------------------------------------------------ */
/*  Material capability                                                */
/* ------------------------------------------------------------------ */

/* Lite is no longer a choice in Settings — it is the automatic fallback when
   the machine cannot render a real DWM backdrop. Three things disqualify a
   machine, and all three are things the app can actually observe:

     1. not Windows, or a build older than 22621 (no DWM backdrop at all)
     2. the compositor is not hardware accelerated, so a live blur of the
        wallpaper would be drawn on the CPU — this is the "no display driver"
        case, and it is what `getGPUFeatureStatus().gpu_compositing` reports
     3. koffi is missing, so DwmSetWindowAttribute cannot be called and the
        window would keep a title-bar frame

   `featureStatus` starts as null and is filled in from the `gpu-info-update`
   event, because Electron only guarantees it is meaningful after that fires. */
let gpuCompositing = null;   // null = not known yet

function backdropSupported() {
  if (!IS_WIN || windowsBuild() < 22621) return false;
  if (!koffi) return false;
  // Unknown is not treated as failure: if the GPU never reports, the app should
  // still try the good material rather than silently dropping to Lite.
  if (gpuCompositing !== null && !gpuCompositing) return false;
  return true;
}

/* The material actually used right now: the user's choice, unless the machine
   cannot render it, in which case Lite. */
function effectiveMaterial() {
  if (!backdropSupported()) return 'solid';
  return settings.material === 'solid' ? 'solid' : settings.material;
}

function canBackdropForMaterial(material) {
  return backdropSupported() && material !== 'solid';
}

function createWindow(startupFile) {
  const build = windowsBuild();
  const material = effectiveMaterial();
  const canBackdrop = canBackdropForMaterial(material);
  const darkNow = settings.mode === 'dark' || (settings.mode === 'system' && nativeTheme.shouldUseDarkColors);
  // With a DWM backdrop the window contents must be transparent so the material shows
  // through. `transparent: true` is deliberately NOT used: it disables native resizing,
  // snapping and shadows on Windows and breaks the backdrop when maximized.
  // Mica and Lite must stay transparent too. A solid native background colour is
  // painted by the window over the full frame rectangle — it does not follow the
  // CSS `border-radius: 8px` on `body`, so the four corners come out square.
  // That is exactly what happened in r30: Mica and Lite were solid, Acrylic was
  // transparent, and only Acrylic kept its rounded corners. The material is
  // painted by `body::before` in every mode, so the native fill is not needed.
  const contentBg = '#00000000';

  const saved = settings.windowBounds;
  let bounds = saved;
  if (saved) {
    const displays = screen.getAllDisplays();
    const visible = displays.some((d) => {
      const b = d.bounds;
      const overlapX = Math.min(saved.x + saved.width, b.x + b.width) - Math.max(saved.x, b.x);
      const overlapY = Math.min(saved.y + saved.height, b.y + b.height) - Math.max(saved.y, b.y);
      return overlapX > 80 && overlapY > 80;
    });
    if (!visible) bounds = null;
  }
  if (!bounds) {
    const wa = screen.getPrimaryDisplay().workAreaSize;
    const width = Math.min(1360, Math.round(wa.width * 0.86));
    const height = Math.min(880, Math.round(wa.height * 0.88));
    bounds = {
      width,
      height,
      x: Math.round((wa.width - width) / 2),
      y: Math.round((wa.height - height) / 2)
    };
  }

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 780,
    minHeight: 480,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: contentBg,
    roundedCorners: true,
    hasShadow: true,
    // `thickFrame: false` is Electron's own switch for dropping WS_THICKFRAME,
    // and it is the one that works. r29 tried to clear the style bits behind
    // Electron's back with SetWindowLongW; Electron re-applies its own style
    // after that call, so the bits came back and the resizable-frame padding
    // stayed — seven pixels of it down each side, worse than the hairline it was
    // meant to remove. This option is applied in the right order.
    // Cost, by design: the window loses its drop shadow, its open/close
    // animation, and edge-drag resizing.
    thickFrame: false,
    backgroundMaterial: canBackdrop ? material : undefined,
    title: 'Lehtratuh',
    icon: path.join(__dirname, 'assets', 'app.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
      webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  windows.add(win);
  mainWindow = win;

  // Hide the compositor's own 1px outline (Windows 11 only; a no-op elsewhere).
  pinBorderless(win);
  const reframe = () => {
    stripNativeBorder(win);
    setCornerRounding(win, settings.material !== 'solid');
  };
  win.on('maximize', reframe);
  win.on('unmaximize', reframe);

  win.once('ready-to-show', () => {
    win.show();
    if (settings.windowMaximized) win.maximize();
  });

  const reassertBackdrop = () => {
    if (!IS_WIN || settings.material === 'solid') return;
    // DWM can drop the system backdrop across drag/double-click maximise paths
    setTimeout(() => applyMaterial(win, effectiveMaterial()), 60);
    setTimeout(() => applyMaterial(win, effectiveMaterial()), 320);
  };

  win.on('maximize', () => {
    send(win, 'win:state', { maximized: true });
    saveSettings({ windowMaximized: true });
    reassertBackdrop();
  });
  win.on('unmaximize', () => {
    send(win, 'win:state', { maximized: false });
    saveSettings({ windowMaximized: false });
    reassertBackdrop();
  });
  win.on('enter-full-screen', () => send(win, 'win:state', { fullscreen: true }));
  win.on('leave-full-screen', () => send(win, 'win:state', { fullscreen: false }));
  win.on('focus', () => send(win, 'win:focus', true));
  win.on('blur', () => send(win, 'win:focus', false));

  let saveTimer = null;
  const rememberBounds = () => {
    if (win.isMaximized() || win.isFullScreen() || win.isMinimized()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const b = win.getBounds();
        saveSettings({ windowBounds: b });
      } catch { /* window gone */ }
    }, 500);
  };
  win.on('resize', rememberBounds);
  win.on('move', rememberBounds);

  win.on('closed', () => {
    windows.delete(win);
    if (mainWindow === win) mainWindow = null;
  });

  // keep renderer informed about the platform / backdrop capability
  win.webContents.on('did-finish-load', () => {
    send(win, 'app:ready', {
      platform: process.platform,
      osLabel: windowsVersionLabel(),
      build,
      nativeBackdrop: canBackdrop,
      contentScheme: canBackdrop,
      versions: {
        app: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node
      },
      startFile: startupFile || null
    });
    startupFile = null;
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  return win;
}

/* ------------------------------------------------------------------ */
/*  Settings window                                                    */
/* ------------------------------------------------------------------ */

/* Settings is a real top-level window, not an overlay. That buys draggability,
   its own taskbar presence, snapping, resize and correct z-order from the OS
   instead of re-implementing them with a pointer-move transform. It gets the
   same frameless chrome treatment as the main window so the two look alike. */
function createSettingsWindow(tab) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    showSettingsWindow();
    if (tab) send(settingsWindow, 'settings:tab', tab);
    return settingsWindow;
  }

  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const darkNow = settings.mode === 'dark' || (settings.mode === 'system' && nativeTheme.shouldUseDarkColors);

  const win = new BrowserWindow({
    width: 880,
    height: 620,
    minWidth: 700,
    minHeight: 460,
    parent: parent || undefined,
    modal: false,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#00000000',
    roundedCorners: true,
    hasShadow: true,
    thickFrame: false,
    backgroundMaterial: canBackdropForMaterial(effectiveMaterial()) ? effectiveMaterial() : undefined,
    title: 'Settings — Lehtratuh',
    icon: path.join(__dirname, 'assets', 'app.png'),
    autoHideMenuBar: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
      webSecurity: true
    }
  });

  windows.add(win);
  settingsWindow = win;

  pinBorderless(win);
  const reframe = () => {
    stripNativeBorder(win);
    setCornerRounding(win, settings.material !== 'solid');
  };
  win.on('maximize', reframe);
  win.on('unmaximize', reframe);

  win.on('maximize', () => send(win, 'win:state', { maximized: true }));
  win.on('unmaximize', () => send(win, 'win:state', { maximized: false }));

  win.on('closed', () => {
    windows.delete(win);
    if (settingsWindow === win) settingsWindow = null;
    // Closing settings should always hand focus back to the library.
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadFile(path.join(__dirname, 'settings.html'));

  // Remember the tab so reopening lands where the user left off.
  win.webContents.on('did-finish-load', () => {
    send(win, 'settings:tab', tab || lastSettingsTab || 'library');
  });

  return win;
}

function showSettingsWindow(tab) {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    createSettingsWindow(tab);
    return;
  }
  if (tab) send(settingsWindow, 'settings:tab', tab);
  if (settingsWindow.isMinimized()) settingsWindow.restore();
  // Shown from the renderer's first-paint callback, so there is never a flash of
  // unthemed window.
  if (!settingsWindow.isVisible()) settingsWindow.show();
  settingsWindow.focus();
}

function send(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function applyMaterial(win, material) {
  if (!win || win.isDestroyed() || !IS_WIN) return;
  try {
    win.setBackgroundMaterial(material === 'solid' ? 'none' : material);
  } catch (err) {
    console.warn('[backdrop] setBackgroundMaterial failed:', err.message);
  }
  // Lite keeps square corners on purpose; Acrylic and Mica get DWM rounding.
  setCornerRounding(win, material !== 'solid');
}

/* ------------------------------------------------------------------ */
/*  Protocol: lhphoto://local/<absolute path>                          */
/* ------------------------------------------------------------------ */

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jpe': 'image/jpeg',
  '.jfif': 'image/jpeg', '.jfi': 'image/jpeg', '.png': 'image/png',
  '.apng': 'image/apng', '.bmp': 'image/bmp', '.dib': 'image/bmp',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.tif': 'image/tiff',
  '.tiff': 'image/tiff', '.heic': 'image/heic', '.heif': 'image/heif',
  '.jxl': 'image/jxl', '.psd': 'image/vnd.adobe.photoshop', '.tga': 'image/x-tga',
  '.hdr': 'image/vnd.radiance', '.dds': 'image/vnd-ms.dds', '.qoi': 'image/qoi',
  '.dng': 'image/x-adobe-dng', '.cr2': 'image/x-canon-cr2', '.nef': 'image/x-nikon-nef',
  '.arw': 'image/x-sony-arw', '.orf': 'image/x-olympus-orf', '.rw2': 'image/x-panasonic-rw2',
  '.raf': 'image/x-fuji-raf', '.pef': 'image/x-pentax-pef', '.mrw': 'image/x-minolta-mrw'
};

function registerProtocols() {
  protocol.handle('lhphoto', async (request) => {
    try {
      const url = new URL(request.url);
      let filePath = decodeURIComponent(url.pathname);
      if (/^\/[A-Za-z]:[\\/]/.test(filePath)) filePath = filePath.slice(1);
      filePath = path.normalize(filePath);
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) return new Response('Not found', { status: 404 });
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      const res = await net.fetch(pathToFileURL(filePath).toString());
      const headers = new Headers(res.headers);
      headers.set('content-type', type);
      headers.set('cache-control', 'no-cache');
      headers.set('access-control-allow-origin', '*');
      headers.set('cross-origin-resource-policy', 'cross-origin');
      return new Response(res.body, { status: 200, headers });
    } catch (err) {
      return new Response('Error: ' + err.message, { status: 404 });
    }
  });
}

function mediaUrl(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return 'lhphoto://local/' + encodeURI(normalized);
}

/* ------------------------------------------------------------------ */
/*  Library scanning                                                   */
/* ------------------------------------------------------------------ */

function isHidden(name) {
  return name.startsWith('.') || name.startsWith('$');
}

async function listImages(dir, depth, out, budget) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const dirs = [];
  for (const entry of entries) {
    if (out.length >= budget) return;
    if (isHidden(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth > 0 && !SKIP_DIRS.has(entry.name.toLowerCase())) dirs.push(full);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXT.has(ext)) continue;
      let stat;
      try { stat = await fsp.stat(full); } catch { continue; }
      out.push({
        path: full,
        url: mediaUrl(full),
        name: entry.name,
        base: path.basename(entry.name, path.extname(entry.name)),
        ext: ext.slice(1).toUpperCase(),
        size: stat.size,
        mtime: stat.mtimeMs,
        dir,
        folder: path.basename(dir),
        native: NATIVE_EXT.has(ext),
        // Whether the renderer can actually put this file on a canvas. The
        // viewer's rotate and auto adjust both go through canvas, so they are
        // disabled for anything the browser engine cannot decode — independent
        // of whether Electron's own native image reader can manage a thumbnail.
        decodable: BROWSER_DECODABLE_EXT.has(ext),
        kind: RAW_EXT.has(ext) ? 'raw' : HEIF_EXT.has(ext) ? 'heif' : DECODED_EXT.has(ext) ? 'decoded' : 'native'
      });
    }
  }
  for (const d of dirs) {
    if (out.length >= budget) return;
    await listImages(d, depth - 1, out, budget);
  }
}

async function scanLibrary(root) {
  const started = Date.now();
  const top = [];
  let entries = [];
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch (err) {
    return { ok: false, error: err.message, root, groups: [], total: 0 };
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const rootName = path.basename(root) || root;

  // Images that live directly in the root folder
  const loose = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXT.has(ext)) continue;
      const full = path.join(root, entry.name);
      let stat;
      try { stat = await fsp.stat(full); } catch { continue; }
      loose.push({
        path: full,
        url: mediaUrl(full),
        name: entry.name,
        base: path.basename(entry.name, ext),
        ext: ext.slice(1).toUpperCase(),
        size: stat.size,
        mtime: stat.mtimeMs,
        dir: root,
        folder: rootName,
        native: NATIVE_EXT.has(ext),
        // Whether the renderer can actually put this file on a canvas. The
        // viewer's rotate and auto adjust both go through canvas, so they are
        // disabled for anything the browser engine cannot decode — independent
        // of whether Electron's own native image reader can manage a thumbnail.
        decodable: BROWSER_DECODABLE_EXT.has(ext),
        kind: RAW_EXT.has(ext) ? 'raw' : HEIF_EXT.has(ext) ? 'heif' : DECODED_EXT.has(ext) ? 'decoded' : 'native'
      });
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (isHidden(entry.name) || SKIP_DIRS.has(entry.name.toLowerCase())) continue;
    const dir = path.join(root, entry.name);
    const images = [];
    await listImages(dir, 2, images, 4000);
    if (images.length) {
      top.push({ key: dir, name: entry.name, path: dir, depth: 1, images });
    }
  }

  const groups = [];
  if (loose.length) {
    groups.push({ key: root, name: rootName, path: root, depth: 0, images: loose });
  }
  groups.push(...top);

  const total = groups.reduce((n, g) => n + g.images.length, 0);
  const removed = [];

  return {
    ok: true,
    root,
    rootName,
    groups,
    total,
    elapsed: Date.now() - started,
    truncated: total >= 20000
  };
}

/* ------------------------------------------------------------------ */
/*  EXIF                                                               */
/* ------------------------------------------------------------------ */

function readExif(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(262144);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    fd = null;
    if (read < 4) return null;

    // Locate APP1/Exif segment
    let offset = -1;
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < read - 4) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker === 0xe1 && buf.toString('ascii', i + 4, i + 10) === 'Exif\0\0') {
          offset = i + 10;
          break;
        }
        if (marker === 0xda) break;
        i += 2 + len;
      }
    } else {
      return null;
    }
    if (offset < 0) return null;

    const le = buf.toString('ascii', offset, offset + 2) === 'II';
    const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
    const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));

    const ifd0 = offset + u32(offset + 4);
    const tags = {};
    const TAG_NAMES = {
      0x010f: 'Make', 0x0110: 'Model', 0x0112: 'Orientation',
      0x011a: 'XResolution', 0x0131: 'Software', 0x0132: 'DateTime',
      0x8769: 'ExifIFD', 0x8825: 'GPSIFD', 0x013b: 'Artist',
      0xa002: 'PixelXDimension', 0xa003: 'PixelYDimension'
    };
    const EXIF_NAMES = {
      0x829a: 'ExposureTime', 0x829d: 'FNumber', 0x8827: 'ISO',
      0x9003: 'DateTimeOriginal', 0x9004: 'DateTimeDigitized',
      0x920a: 'FocalLength', 0x9207: 'MeteringMode', 0x9209: 'Flash',
      0xa405: 'FocalLengthIn35mm', 0xa434: 'LensModel', 0xa433: 'LensMake',
      0xa402: 'ExposureMode', 0xa403: 'WhiteBalance', 0x9204: 'ExposureBias'
    };

    const readValue = (entry) => {
      const type = u16(entry + 2);
      const count = u32(entry + 4);
      const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
      const size = (sizes[type] || 1) * count;
      const valOffset = size > 4 ? offset + u32(entry + 8) : entry + 8;
      try {
        switch (type) {
          case 1: return buf[valOffset];
          case 2: {
            let s = buf.toString('ascii', valOffset, valOffset + count);
            s = s.replace(/\0+$/, '').trim();
            return s;
          }
          case 3: return u16(valOffset);
          case 4: return u32(valOffset);
          case 5: {
            const n = u32(valOffset);
            const d = u32(valOffset + 4) || 1;
            return n / d;
          }
          case 9: return le ? buf.readInt32LE(valOffset) : buf.readInt32BE(valOffset);
          case 10: {
            const n = le ? buf.readInt32LE(valOffset) : buf.readInt32BE(valOffset);
            const d = le ? buf.readInt32LE(valOffset + 4) : buf.readInt32BE(valOffset + 4);
            return n / (d || 1);
          }
          default: return null;
        }
      } catch {
        return null;
      }
    };

    const readIfd = (start, names, target) => {
      if (start <= 0 || start >= read) return;
      let count;
      try { count = u16(start); } catch { return; }
      for (let i = 0; i < Math.min(count, 400); i++) {
        const entry = start + 2 + i * 12;
        if (entry + 12 > read) break;
        const tag = u16(entry);
        const name = names[tag];
        if (!name) continue;
        const value = readValue(entry);
        if (value !== null && value !== '') target[name] = value;
      }
    };

    readIfd(ifd0, TAG_NAMES, tags);
    if (tags.ExifIFD) readIfd(offset + tags.ExifIFD, EXIF_NAMES, tags);

    const out = {};
    if (tags.Make) out.make = String(tags.Make).trim();
    if (tags.Model) out.model = String(tags.Model).trim();
    if (tags.LensModel) out.lens = String(tags.LensModel).trim();
    if (tags.DateTimeOriginal) out.taken = String(tags.DateTimeOriginal);
    else if (tags.DateTime) out.taken = String(tags.DateTime);
    if (tags.Software) out.software = String(tags.Software);
    if (tags.Orientation) out.orientation = tags.Orientation;

    if (tags.ExposureTime) {
      const t = tags.ExposureTime;
      out.exposure = t >= 1 ? `${t.toFixed(1)} s` : `1/${Math.round(1 / t)} s`;
    }
    if (tags.FNumber) out.aperture = `f/${(+tags.FNumber).toFixed(1).replace(/\.0$/, '')}`;
    if (tags.ISO) out.iso = `ISO ${tags.ISO}`;
    if (tags.FocalLength) out.focal = `${Math.round(tags.FocalLength)} mm`;
    if (tags.ExposureBias !== undefined && tags.ExposureBias !== null) {
      const ev = Number(tags.ExposureBias);
      if (!Number.isNaN(ev) && ev !== 0) out.bias = `${ev > 0 ? '+' : ''}${ev.toFixed(1)} EV`;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Thumbnail / preview helpers                                        */
/* ------------------------------------------------------------------ */

function imageInfo(filePath) {
  const info = { width: null, height: null, exif: null };
  try {
    const img = nativeImage.createFromPath(filePath);
    if (!img.isEmpty()) {
      const size = img.getSize();
      info.width = size.width;
      info.height = size.height;
    }
  } catch { /* not natively decodable */ }
  info.exif = readExif(filePath);
  return info;
}

/* ------------------------------------------------------------------ */
/*  IPC                                                               */
/* ------------------------------------------------------------------ */

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    platform: process.platform,
    osLabel: windowsVersionLabel(),
    build: windowsBuild(),
    nativeBackdrop: canBackdropForMaterial(effectiveMaterial()),
    material: effectiveMaterial(),
    backdropSupported: backdropSupported(),
    versions: {
      app: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      // Bumped whenever a build changes window chrome, so a screenshot can be
      // matched to an exe instead of guessed at.
      rev: REV
    },
    dwmBorder: lastStripResult,
    dwmCorner: lastCornerResult,
    pictures: app.getPath('pictures'),
    home: app.getPath('home'),
    accent: readWindowsAccent()
  }));

  ipcMain.handle('accent:get', () => readWindowsAccent());

  ipcMain.handle('settings:load', () => settings);
  ipcMain.handle('settings:save', (event, patch) => {
    const next = saveSettings(patch);
    syncNativeThemeSource();
    if (patch && patch.material !== undefined) {
      for (const w of windows) applyMaterial(w, effectiveMaterial());
    }
    // The jump list names the library folder, so it has to follow a change.
    if (patch && patch.photoFolder !== undefined) setupJumpList();
    // Settings can now be edited from a second window. Every other window needs
    // the new values, or the library behind the settings window keeps painting
    // the old theme until it is reopened.
    const from = BrowserWindow.fromWebContents(event.sender);
    for (const w of windows) {
      if (w === from) continue;
      // The writer has already applied the change itself; every other window
      // needs to hear about it. (The settings window deliberately does not
      // filter on this side — the reverse direction is the common one.)
      send(w, 'settings:changed', next);
    }
    return next;
  });

  ipcMain.handle('library:scan', async (_e, folder) => {
    const root = folder && fs.existsSync(folder) ? folder : settings.photoFolder;
    return scanLibrary(root);
  });

  ipcMain.handle('dialog:folder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a photo folder',
      properties: ['openDirectory'],
      defaultPath: settings.photoFolder
    });
    if (res.canceled || !res.filePaths.length) return null;
    saveSettings({ photoFolder: res.filePaths[0] });
    return res.filePaths[0];
  });

  ipcMain.handle('dialog:openImages', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Open a photo',
      properties: ['openFile', 'multiSelections'],
      defaultPath: settings.photoFolder,
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'jfif', 'png', 'apng', 'bmp', 'gif', 'webp', 'avif', 'ico', 'svg', 'tif', 'tiff', 'tga', 'psd', 'dds', 'hdr', 'qoi', 'pnm', 'ppm', 'pgm', 'pbm', 'heic', 'heif', 'jxl', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf', 'pef', 'srw', 'raw', 'mrw'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (res.canceled) return [];
    return res.filePaths;
  });

  ipcMain.handle('image:describe', async (_e, filePath) => {
    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat) return null;
    return {
      path: filePath,
      url: mediaUrl(filePath),
      name: path.basename(filePath),
      base: path.basename(filePath, path.extname(filePath)),
      ext: path.extname(filePath).slice(1).toUpperCase(),
      size: stat.size,
      mtime: stat.mtimeMs,
      dir: path.dirname(filePath),
      folder: path.basename(path.dirname(filePath)),
      native: NATIVE_EXT.has(path.extname(filePath).toLowerCase()),
      decodable: BROWSER_DECODABLE_EXT.has(path.extname(filePath).toLowerCase()),
      kind: RAW_EXT.has(path.extname(filePath).toLowerCase()) ? 'raw'
        : HEIF_EXT.has(path.extname(filePath).toLowerCase()) ? 'heif'
        : DECODED_EXT.has(path.extname(filePath).toLowerCase()) ? 'decoded' : 'native',
      info: imageInfo(filePath)
    };
  });

  ipcMain.handle('image:exif', (_e, filePath) => readExif(filePath));

  ipcMain.handle('file:reveal', (_e, filePath) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('file:openExternal', (_e, target) => {
    if (/^https?:/i.test(target)) shell.openExternal(target);
    else shell.openPath(target);
  });

  ipcMain.handle('file:trash', async (_e, paths) => {
    const results = [];
    for (const p of paths) {
      try {
        await shell.trashItem(p);
        results.push({ path: p, ok: true });
      } catch (err) {
        results.push({ path: p, ok: false, error: err.message });
      }
    }
    return results;
  });

  ipcMain.handle('file:rename', async (_e, { filePath, newName }) => {
    try {
      const dir = path.dirname(filePath);
      const clean = String(newName).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim();
      if (!clean) return { ok: false, error: 'Name cannot be empty' };
      let target = path.join(dir, clean);
      if (path.extname(clean) === '') target += path.extname(filePath);
      if (fs.existsSync(target) && target.toLowerCase() !== filePath.toLowerCase()) {
        return { ok: false, error: 'A file with that name already exists' };
      }
      await fsp.rename(filePath, target);
      return { ok: true, path: target, name: path.basename(target) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('image:save', async (_e, { filePath, data, format, quality, useDialog, suggestedName }) => {
    try {
      let target = filePath;
      if (useDialog || !target) {
        const extMap = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif', bmp: 'bmp' };
        const ext = extMap[format] || 'png';
        const res = await dialog.showSaveDialog(mainWindow, {
          title: 'Save image as',
          defaultPath: path.join(settings.photoFolder, suggestedName || `Untitled.${ext}`),
          filters: [
            { name: 'JPEG image', extensions: ['jpg', 'jpeg'] },
            { name: 'PNG image', extensions: ['png'] },
            { name: 'WebP image', extensions: ['webp'] },
            { name: 'BMP image', extensions: ['bmp'] }
          ],
          filterIndex: format === 'jpeg' ? 1 : format === 'png' ? 2 : format === 'webp' ? 3 : 1
        });
        if (res.canceled || !res.filePath) return { ok: false, canceled: true };
        target = res.filePath;
        if (!path.extname(target)) target += '.' + ext;
      }
      await fsp.writeFile(target, Buffer.from(data));
      return { ok: true, path: target };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('clipboard:image', async (_e, { dataUrl, text }) => {
    try {
      if (dataUrl) {
        const img = nativeImage.createFromDataURL(dataUrl);
        if (!img.isEmpty()) clipboard.writeImage(img);
      }
      if (text) clipboard.writeText(text);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('shell:showProperties', async (_e, filePath) => {
    if (IS_WIN) {
      shell.showItemInFolder(filePath);
      return true;
    }
    return false;
  });

  ipcMain.handle('app:version', () => app.getVersion());

  // window controls
  ipcMain.on('win:theme', (event, mode) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const backdrop = canBackdropForMaterial(effectiveMaterial());
    if (!backdrop) {
      try { win.setBackgroundColor(mode === 'dark' ? '#202020' : '#f3f3f3'); } catch { /* noop */ }
    }
  });

  ipcMain.on('win:action', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    switch (action) {
      case 'minimize': win.minimize(); break;
      case 'maximize': win.isMaximized() ? win.unmaximize() : win.maximize(); break;
      case 'close': win.close(); break;
      case 'fullscreen': win.setFullScreen(!win.isFullScreen()); break;
      case 'devtools': win.webContents.toggleDevTools(); break;
      // The settings renderer asks for this once its first paint is done, so
      // the window is never shown as an unthemed flash.
      case 'settings-ready': if (win === settingsWindow) showSettingsWindow(); break;
      default: break;
    }
  });

  /* The tab can change between `loadFile` and the renderer's first script run:
     `did-finish-load` fires before an async boot() has installed its listeners.
     So the renderer *pulls* the tab when it is ready, and the event only covers
     changes made while the window is already open. */
  ipcMain.handle('settings:tab', () => lastSettingsTab);

  ipcMain.handle('settings:open', (_e, tab) => {
    if (tab) lastSettingsTab = tab;
    createSettingsWindow(tab || lastSettingsTab);
    return true;
  });

  ipcMain.handle('win:isMaximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return !!win && win.isMaximized();
  });
}

/* ------------------------------------------------------------------ */
/*  App lifecycle                                                      */
/* ------------------------------------------------------------------ */

/* A shell launch ("Open with", double-click, drag-onto-exe) hands the file in
   argv. Strip the surrounding quotes Windows sometimes leaves in place, and
   resolve relative paths against the working directory so the renderer always
   gets something absolute. */
function startupFilePath() {
  for (const arg of process.argv.slice(1)) {
    const raw = String(arg || '').replace(/^"|"$/g, '').trim();
    if (!raw || raw.startsWith('-')) continue;
    if (!IMAGE_EXT.has(path.extname(raw).toLowerCase())) continue;
    try {
      return path.resolve(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Windows shell integration                                          */
/* ------------------------------------------------------------------ */

/* Taskbar jump list. The first two entries are ordinary app commands; the recent
   folder is the user's own library root, which is what they most often want to
   reach without navigating. */
function setupJumpList() {
  if (!IS_WIN) return;
  try {
    const tasks = [
      new JumpListItem({
        type: 'task',
        title: 'Open a photo',
        program: process.execPath,
        args: '--open-file',
        iconPath: process.execPath,
        iconIndex: 0
      }),
      new JumpListItem({
        type: 'task',
        title: 'Open library folder',
        program: 'explorer.exe',
        args: `"${settings.photoFolder || app.getPath('pictures')}"`
      })
    ];

    const categories = [new JumpListCategory({ type: 'tasks', items: tasks })];

    const folder = settings.photoFolder || app.getPath('pictures');
    if (fs.existsSync(folder)) {
      categories.push(new JumpListCategory({
        type: 'custom',
        name: 'Library',
        items: [
          new JumpListItem({
            type: 'task',
            title: path.basename(folder) || folder,
            program: process.execPath,
            args: `"${folder}"`,
            iconPath: process.execPath,
            iconIndex: 0
          })
        ]
      }));
    }

    app.setJumpList(categories);
  } catch (err) {
    // A jump list is a nicety; never let it stop the app from starting.
    console.warn('jump list unavailable:', err.message);
  }
}

/* A folder in argv means "open the library here", which is what the jump list's
   Library entry passes. */
function startupFolder() {
  for (const arg of process.argv.slice(1)) {
    const raw = String(arg || '').replace(/^"|"$/g, '').trim();
    if (!raw || raw.startsWith('-')) continue;
    try {
      if (fs.existsSync(raw) && fs.statSync(raw).isDirectory()) return path.resolve(raw);
    } catch { /* not a path */ }
  }
  return null;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  /* Explorer double-click while the app is running. The launch arrives as a
     second instance with the file path in argv; hand it to the existing window
     instead of opening a second process. */
  app.on('second-instance', (_e, argv) => {
    const file = startupFilePath();
    if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isFocused() && !file) return;
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow(file || null);
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (file) send(mainWindow, 'app:open-file', file);
  });

  app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'lhphoto',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: false }
    }
  ]);

  app.on('gpu-info-update', () => {
  try {
    const status = app.getGPUFeatureStatus();
    const c = status && status.gpu_compositing;
    // "enabled" / "enabled_readback" are fine; "disabled_software" /
    // "unavailable_software" / "software" mean the compositor is on the CPU.
    gpuCompositing = typeof c === 'string' ? !/software|unavailable|disabled/i.test(c) : null;
  } catch {
    gpuCompositing = null;
  }
});

app.whenReady().then(() => {
    settingsFile = path.join(app.getPath('userData'), 'settings.json');
    loadSettings();
    Menu.setApplicationMenu(null);
    if (IS_WIN) app.setAppUserModelId('com.knightwin.lehtratuh');
    registerProtocols();
    registerIpc();

    // A folder argument wins only when no image was named.
    const startDir = startupFilePath() ? null : startupFolder();
    if (startDir) saveSettings({ photoFolder: startDir });
    // The jump list's "Open a photo" task passes no path; honour it by opening
    // the picker once the window is up.
    const wantsPicker = process.argv.includes('--open-file') && !startupFilePath();
    createWindow(startupFilePath());
    if (wantsPicker && mainWindow) {
      mainWindow.webContents.once('did-finish-load', () => {
        setTimeout(() => send(mainWindow, 'app:pick-file', true), 400);
      });
    }

    // Windows taskbar integration: a jump list with the things a photo app is
    // actually opened to do. Only meaningful on Windows, and only once the app
    // id is set, so it is called here rather than at module load.
    setupJumpList();

    // keep System accent in step with Windows while the app is open
    watchWindowsAccent((next) => {
      for (const w of windows) send(w, 'accent:changed', next);
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(null);
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
