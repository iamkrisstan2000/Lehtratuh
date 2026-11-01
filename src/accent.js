'use strict';
/* Reads the Windows accent colour.
 *
 * Two sources, most-authoritative first:
 *   1. Electron's `systemPreferences.getAccentColor()` — Chromium's own view of
 *      the accent. On Windows it returns "RRGGBBAA"; we drop the alpha.
 *   2. The DWM registry value (`HKCU\...\DWM\AccentColor`), used if Electron
 *      hands back nothing. Electron's docs describe the DWM value as #AABBGGRR,
 *      which is the reverse byte order of the string we want.
 *
 * No Electron import at the top level on purpose: the pure helpers stay
 * unit-testable in plain Node. */

const { execFileSync } = require('child_process');

const DWM_KEY = 'HKCU\\Software\\Microsoft\\Windows\\DWM';
const FALLBACK = { accent: '#0067c0', light: '#60cdff' };

/* Electron returns "RRGGBBAA" -> "#rrggbb". */
function electronAccentToHex(raw) {
  const s = String(raw || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{8}$/.test(s) && !/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return '#' + s.slice(0, 6).toLowerCase();
}

/* DWM stores #AABBGGRR -> swap to "#rrggbb". */
function dwmDwordToHex(dword) {
  const r = dword & 0xff;
  const g = (dword >> 8) & 0xff;
  const b = (dword >> 16) & 0xff;
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/* Pull a REG_DWORD out of `reg query` output. Returns null when absent. */
function parseRegDword(output) {
  const m = /REG_DWORD\s+0x([0-9a-fA-F]+)/.exec(String(output || ''));
  return m ? parseInt(m[1], 16) : null;
}

function readDword(name, runner) {
  try {
    const out = runner('reg', ['query', DWM_KEY, '/v', name], {
      encoding: 'utf8', windowsHide: true, timeout: 1500
    });
    return parseRegDword(out);
  } catch {
    return null;
  }
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.isWindows]      platform override, for tests
 * @param {Function} [opts.run]           execFileSync-compatible, for tests
 * @param {Function} [opts.electronAccent] () => "RRGGBBAA", for tests
 */
/* Test seam: lets the harness force a colour without touching Windows. */
let probeOverride = null;
function __setProbeForTest(fn) { probeOverride = fn; }

function readWindowsAccent(opts = {}) {
  if (probeOverride) return probeOverride();
  const isWindows = opts.isWindows !== undefined ? opts.isWindows : process.platform === 'win32';
  if (!isWindows) return { ...FALLBACK };

  // 1. Chromium's own answer, when the platform gives us one.
  try {
    const fn = opts.electronAccent || (() => {
      const { systemPreferences } = require('electron');
      return systemPreferences.getAccentColor();
    });
    const fromElectron = electronAccentToHex(fn());
    if (fromElectron) return { accent: fromElectron, light: fromElectron };
  } catch { /* fall through to the registry */ }

  // 2. Registry fallback.
  const runner = opts.run || execFileSync;
  const accentRaw = readDword('AccentColor', runner);
  const lightRaw = readDword('ColorizationColor', runner);
  if (accentRaw === null) return { ...FALLBACK };

  const accent = dwmDwordToHex(accentRaw);
  const light = lightRaw !== null ? dwmDwordToHex(lightRaw) : accent;
  return { accent, light };
}

/* Call `onChange` whenever the accent moves while the app is open. Polling is
   fine here: the value only changes when the user edits Windows Settings, and a
   registry read costs well under a millisecond. */
function watchWindowsAccent(onChange, opts = {}) {
  // When a probe is injected (tests) we still want to poll, whatever the host OS.
  const isWindows = opts.isWindows !== undefined ? opts.isWindows : process.platform === 'win32';
  if (!isWindows && !probeOverride) return () => {};
  const every = opts.interval || 4000;
  let last = readWindowsAccent(opts).accent;
  const timer = setInterval(() => {
    const next = readWindowsAccent(opts);
    if (next.accent !== last) {
      last = next.accent;
      onChange(next);
    }
  }, every);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}

module.exports = {
  readWindowsAccent, watchWindowsAccent, __setProbeForTest,
  dwmDwordToHex, electronAccentToHex, parseRegDword
};
