'use strict';

/* ==========================================================================
   Lehtratuh renderer — library, viewer, theming, settings
   ========================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

const state = {
  settings: null,
  info: null,
  library: null,
  images: [],
  filtered: [],
  current: -1,
  query: '',
  selected: new Set(),
  viewImage: null,
  zoom: 1,
  panX: 0,
  panY: 0,
  fitScale: 1,
  natural: { w: 0, h: 0 },
  edits: {},          // { rotate, flipH, flipV, ... } keyed by path (session memory)
  cropMode: false,
  cropRect: null,
  systemDark: false,
  systemAccent: null,   // { accent, light } from Windows, when accent === 'system'
  sorted: []
};

/* ------------------------------------------------------------------ utils */

const APP_NAME = 'Lehtratuh';

/* The left of the title bar carries the app name at Home and the photo's file
   name once one is open — it is never a breadcrumb trail. */
function setTitleBarText(text) {
  const el = document.getElementById('app-title');
  if (!el) return;
  const label = text || APP_NAME;
  el.textContent = label;
  el.title = label;
  el.classList.toggle('is-filename', label !== APP_NAME);
}

/* The window has a single title bar. `data-viewer` flips it into viewer mode so
   the same strip carries the photo's commands and the window caption buttons,
   instead of the viewer stacking a second bar underneath. */
function setViewerMode(on, name) {
  const root = document.documentElement;
  root.dataset.viewer = on ? 'true' : 'false';
  setTitleBarText(on ? (name || 'Photo') : APP_NAME);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtBytes(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function fmtShortDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function toast(message, kind = 'ok', ms = 2600) {
  const wrap = $('#toasts');
  const t = el('div', `toast ${kind}`);
  t.innerHTML = `${icon(kind === 'err' ? 'error' : kind === 'info' ? 'info' : 'check_circle')}<span></span>`;
  t.querySelector('span').textContent = message;
  wrap.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 220);
  }, ms);
}

function debounce(fn, ms) {
  let h;
  return (...args) => {
    clearTimeout(h);
    h = setTimeout(() => fn(...args), ms);
  };
}

/* ------------------------------------------------------------------ theme */

function applyTheme() {
  const s = state.settings;
  const mode = s.mode === 'system' ? (state.systemDark ? 'dark' : 'light') : s.mode;
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.dataset.material = s.material;

  // Accent colour. "system" follows the Windows accent, which main.js reads from
  // the DWM registry value — not a guess derived from dark/light mode.
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
  if (window.lh && window.lh.win.theme) window.lh.win.theme(mode);
  root.dataset.group = String(!!s.groupByFolder);

  const lib = $('#library');
  // The library itself no longer scrolls: the body below the Home banner owns
  // the scrollbar, so the banner stays fixed and the bar starts under it.
  lib.className = 'library view-' + (s.libraryView || 'tiles');
  lib.dataset.group = s.groupByFolder ? 'on' : 'off';
}

async function detectSystemTheme() {
  state.systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    state.systemDark = e.matches;
    if (state.settings.mode === 'system') applyTheme();
  });
}

/* ------------------------------------------------------------------ library */

async function scanLibrary(root) {
  $('#lib-sub').textContent = 'Scanning folder…';
  const res = await window.lh.library.scan(root);
  if (!res || !res.ok) {
    toast(`Could not read folder: ${(res && res.error) || 'unknown error'}`, 'err', 4000);
    state.library = null;
    state.images = [];
    renderLibrary();
    return;
  }
  state.library = res;
  state.images = res.groups.flatMap((g) => g.images);
  applySort();
  renderLibrary();
}

function applySort() {
  const s = state.settings;
  const list = [...state.images];
  switch (s.sort) {
    case 'name-asc': list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })); break;
    case 'name-desc': list.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true })); break;
    case 'date-desc': list.sort((a, b) => b.mtime - a.mtime); break;
    case 'date-asc': list.sort((a, b) => a.mtime - b.mtime); break;
    case 'size-desc': list.sort((a, b) => b.size - a.size); break;
    case 'size-asc': list.sort((a, b) => a.size - b.size); break;
    default: list.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  }
  state.sorted = list;
}

function currentList() {
  if (!state.query) return state.sorted;
  const q = state.query.toLowerCase();
  return state.sorted.filter((i) =>
    i.name.toLowerCase().includes(q) || i.folder.toLowerCase().includes(q) || i.dir.toLowerCase().includes(q)
  );
}

function renderLibrary() {
  const groupsEl = $('#groups');
  const emptyEl = $('#empty-state');
  groupsEl.innerHTML = '';

  const s = state.settings;
  const list = currentList();
  state.filtered = list;

  const root = state.library ? state.library.root : '';
  $('#lib-title').textContent = 'Home';
  const nGroups = state.library ? state.library.groups.length : 0;
  const sub = state.library
    ? `${state.library.total} ${state.library.total === 1 ? 'photo' : 'photos'} · ${root}` +
      (nGroups > 1 ? ` · ${nGroups} folders` : '') +
      (state.query ? ` · ${list.length} matching` : '')
    : 'Choose a folder to get started';
  $('#lib-sub').textContent = sub;
  setTitleBarText(APP_NAME);

  if (!list.length) {
    emptyEl.hidden = false;
    groupsEl.style.display = 'none';
    return;
  }
  emptyEl.hidden = true;
  groupsEl.style.display = '';

  const useGroups = s.groupByFolder && !state.query;
  if (useGroups && state.library) {
    const visible = new Set(list);
    for (const g of state.library.groups) {
      const shown = g.images.filter((i) => visible.has(i));
      if (!shown.length) continue;
      groupsEl.appendChild(buildGroup(g, shown));
    }
  } else {
    const g = { name: state.query ? 'Search results' : (state.library ? state.library.rootName : 'Photos'), path: root, images: list };
    groupsEl.appendChild(buildGroup(g, list));
  }

  // re-observe freshly created images for fade-in
  $$('#groups img').forEach((img) => {
    img.decoding = 'async';
    img.loading = 'lazy';
  });
}

function buildGroup(group, images) {
  const wrap = el('section', 'group');
  const head = el('div', 'group-head');
  head.innerHTML = `${icon('folder')}<span class="g-name"></span>
    <span class="g-path"></span><span class="g-count"></span>
    <span class="g-actions">
      <button class="icon-cmd small" title="Open folder in Explorer">${icon('folder_open')}</button>
    </span>`;
  head.querySelector('.g-name').textContent = group.name;
  head.querySelector('.g-path').textContent = group.path !== group.name ? '› ' + group.path : '';
  head.querySelector('.g-count').textContent = `· ${images.length} ${images.length === 1 ? 'photo' : 'photos'}`;
  head.querySelector('.icon-cmd').addEventListener('click', (e) => {
    e.stopPropagation();
    window.lh.file.openExternal(group.path);
  });
  wrap.appendChild(head);

  const view = state.settings.libraryView;
  if (view === 'details') {
    wrap.appendChild(buildDetails(images));
    return wrap;
  }

  const grid = el('div', 'tiles');
  // A carousel is one row that scrolls sideways, so it loads in much smaller
  // batches — pumping 240 tiles into a single reel would stall the scroll.
  const BATCH = view === 'carousel' ? 40 : 240;
  let shown = 0;
  const addBatch = () => {
    const frag = document.createDocumentFragment();
    const end = Math.min(images.length, shown + BATCH);
    for (let i = shown; i < end; i++) frag.appendChild(buildTile(images[i], i));
    shown = end;
    grid.appendChild(frag);
    $$('img', grid).forEach((im) => { im.loading = 'lazy'; im.decoding = 'async'; });
    more.hidden = shown >= images.length;
    more.textContent = `Show ${Math.min(BATCH, images.length - shown)} more of ${images.length - shown}`;
  };
  const more = el('button', 'btn subtle more-btn');
  more.addEventListener('click', () => {
    more.hidden = true;
    addBatch();
  });
  wrap.appendChild(grid);
  wrap.appendChild(more);
  addBatch();

  if (view === 'carousel') {
    enableCarouselDrag(grid, addBatch, () => more.hidden);
  }
  return wrap;
}

/* Drag-to-scroll for the carousel, plus "load more" when the reel runs out.
   Pointer events cover mouse, pen and touch in one path. */
function enableCarouselDrag(grid, loadMore, moreHidden) {
  let down = false;
  let startX = 0;
  let startScroll = 0;
  let moved = 0;

  grid.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    down = true;
    moved = 0;
    startX = e.clientX;
    startScroll = grid.scrollLeft;
    grid.setPointerCapture?.(e.pointerId);
  });

  grid.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 4) {
      grid.classList.add('dragging');
      moved = Math.abs(dx);
      grid.scrollLeft = startScroll - dx;
    }
  });

  const release = (e) => {
    if (!down) return;
    down = false;
    grid.classList.remove('dragging');
    grid.releasePointerCapture?.(e.pointerId);
    // a drag should not also open the photo
    if (moved > 4) {
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      grid.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => grid.removeEventListener('click', swallow, { capture: true }), 0);
    }
  };
  grid.addEventListener('pointerup', release);
  grid.addEventListener('pointercancel', release);

  // wheel: vertical intent scrolls the reel horizontally (trackpads feel natural)
  grid.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      grid.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });

  // The scrollbar fades in while the reel moves and out again when it settles.
  let scrollTimer = null;
  grid.addEventListener('scroll', () => {
    grid.classList.add('is-scrolling');
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => grid.classList.remove('is-scrolling'), 700);

    // pull in the next batch when the reel reaches its end
    if (!moreHidden() || !loadMore) return;
    const nearEnd = grid.scrollLeft + grid.clientWidth >= grid.scrollWidth - 320;
    if (nearEnd) loadMore();
  }, { passive: true });
}

function buildTile(img, index) {
  const view = state.settings.libraryView;
  const tile = el('button', 'tile');
  tile.dataset.path = img.path;
  tile.style.animationDelay = `${Math.min(index, 14) * 12}ms`;
  if (state.selected.has(img.path)) tile.classList.add('selected');

  const frameWrap = el('div', view === 'cards' ? 'wrap' : '');
  const frame = el('div', 'frame');
  const ph = el('div', 'ph', icon(img.kind === 'raw' ? 'image_edit' : 'image'));
  frame.appendChild(ph);

  const im = document.createElement('img');
  im.loading = 'lazy';
  im.decoding = 'async';
  im.alt = img.name;
  im.src = img.url;
  im.addEventListener('error', () => { im.remove(); });
  frame.appendChild(im);

  if (img.kind === 'raw' || img.kind === 'heif' || img.kind === 'decoded') {
    const badge = el('span', 'badge');
    badge.textContent = img.kind === 'raw' ? 'RAW' : img.kind === 'heif' ? 'HEIF' : img.ext;
    frame.appendChild(badge);
  }

  frameWrap.appendChild(frame);
  tile.appendChild(frameWrap);
  const name = el('div', 'name');
  name.textContent = state.settings.showFilenames ? img.name : '';
  if (!state.settings.showFilenames) name.style.display = 'none';
  tile.appendChild(name);

  tile.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey) {
      state.selected.has(img.path) ? state.selected.delete(img.path) : state.selected.add(img.path);
      tile.classList.toggle('selected');
      return;
    }
    state.selected.clear();
    openViewer(img.path);
  });
  tile.addEventListener('dblclick', () => openViewer(img.path));
  tile.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showImageMenu(e.clientX, e.clientY, [img.path]);
  });
  return tile;
}

function buildDetails(images, showHead = images.length > 2) {
  const table = el('table', 'details-table');
  if (showHead) {
    table.innerHTML = `<thead><tr>
        <th>Name</th><th>Folder</th><th>Type</th><th>Size</th><th>Modified</th>
      </tr></thead>`;
  }
  const body = el('tbody');
  for (const img of images) {
    const tr = el('tr');
    tr.dataset.path = img.path;
    tr.innerHTML = `<td class="d-name"><img loading="lazy" src="${img.url}" alt=""><span></span></td>
      <td></td><td></td><td class="d-size"></td><td class="d-date"></td>`;
    tr.querySelector('.d-name span').textContent = img.name;
    tr.children[1].textContent = img.folder;
    tr.children[2].textContent = img.ext;
    tr.querySelector('.d-size').textContent = fmtBytes(img.size);
    tr.querySelector('.d-date').textContent = fmtShortDate(img.mtime);
    tr.addEventListener('click', () => openViewer(img.path));
    tr.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showImageMenu(e.clientX, e.clientY, [img.path]);
    });
    body.appendChild(tr);
  }
  table.appendChild(body);
  return table;
}

/* ------------------------------------------------------------------ context menu */

let menuEl = null;
function closeMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null; }
}

function showImageMenu(x, y, paths) {
  closeMenu();
  const menu = el('div', 'context-menu');
  const single = paths.length === 1;
  const img = state.images.find((i) => i.path === paths[0]);
  const items = [];
  if (single) items.push({ label: 'Open', icon: 'image', run: () => openViewer(paths[0]) });
  if (single) items.push({ label: 'Edit in photo editor', icon: 'brush', run: () => openEditor(paths[0]) });
  items.push({ sep: true });
  items.push({ label: 'Copy image', icon: 'copy', run: () => copyImage(paths[0]) });
  if (single) items.push({ label: 'Copy path', icon: 'link', run: () => copyText(paths[0]) });
  if (single) items.push({
    label: 'Rename…', icon: 'rename', run: () => renameImage(paths[0])
  });
  items.push({ sep: true });
  items.push({
    label: `Move to Recycle Bin${paths.length > 1 ? ` (${paths.length})` : ''}`,
    icon: 'delete', run: () => trashImages(paths)
  });
  items.push({ label: 'Show in Explorer', icon: 'folder_open', run: () => window.lh.file.reveal(paths[0]) });

  for (const item of items) {
    if (item.sep) { menu.appendChild(el('div', 'menu-sep')); continue; }
    const b = el('button', 'menu-item');
    b.innerHTML = `${icon(item.icon)}<span>${item.label}</span>`;
    b.addEventListener('click', () => { closeMenu(); item.run(); });
    menu.appendChild(b);
  }
  menu.style.left = Math.min(x, window.innerWidth - 250) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - 300) + 'px';
  document.body.appendChild(menu);
  menuEl = menu;
  setTimeout(() => {
    document.addEventListener('mousedown', onDocDownForMenu, { once: true });
  }, 0);
  if (img) { /* reserved for future submenu */ }
}

function onDocDownForMenu(e) {
  if (menuEl && !menuEl.contains(e.target)) closeMenu();
  else if (menuEl) setTimeout(() => document.addEventListener('mousedown', onDocDownForMenu, { once: true }), 0);
}

/* ------------------------------------------------------------------ file ops */

async function copyImage(filePath) {
  try {
    const img = state.images.find((i) => i.path === filePath);
    const url = img ? img.url : 'lhphoto://local/' + encodeURI(filePath.replace(/\\/g, '/'));
    const res = await fetch(url);
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(blob);
    });
    await window.lh.image.copy({ dataUrl, text: filePath });
    toast('Image copied to clipboard');
  } catch (err) {
    toast('Could not copy image', 'err');
  }
}

async function copyText(text) {
  await window.lh.image.copy({ text });
  toast('Path copied to clipboard');
}

async function trashImages(paths) {
  const ok = await confirmDialog(
    paths.length > 1 ? `Move ${paths.length} photos to the Recycle Bin?` : 'Move this photo to the Recycle Bin?',
    paths.length > 1 ? 'They can be restored from the Recycle Bin.' : encodeURI(pathSafeName(paths[0])),
    { okLabel: 'Move to Recycle Bin' }
  );
  if (!ok) return;
  const results = await window.lh.file.trash(paths);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) toast(`Could not delete ${failed.length} file(s)`, 'err');
  else toast(paths.length > 1 ? `${paths.length} photos moved to the Recycle Bin` : 'Photo moved to the Recycle Bin');
  if (state.viewImage && paths.includes(state.viewImage.path)) closeViewer();
  await scanLibrary(state.library ? state.library.root : null);
}

function pathSafeName(p) {
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

async function renameImage(filePath) {
  const oldName = pathSafeName(filePath);
  const res = await promptDialog('Rename photo', 'Enter a new name for this photo.', oldName, {
    okLabel: 'Rename'
  });
  if (res === null) return;
  const out = await window.lh.file.rename({ filePath, newName: res });
  if (!out.ok) {
    toast(out.error || 'Rename failed', 'err', 3600);
    return;
  }
  toast('Renamed');
  if (state.viewImage && state.viewImage.path === filePath) {
    state.viewImage.path = out.path;
    state.viewImage.name = out.name;
    state.viewImage.url = 'lhphoto://local/' + encodeURI(out.path.replace(/\\/g, '/'));
    setViewerMode(true, out.name);
  }
  await scanLibrary(state.library ? state.library.root : null);
}

/* ------------------------------------------------------------------ viewer */

function openViewer(filePath) {
  const list = state.filtered.length ? state.filtered : state.sorted;
  const idx = list.findIndex((i) => i.path === filePath);
  if (idx === -1) {
    showViewerForExternal(filePath);
    return;
  }
  state.current = idx;
  $('#library').hidden = true;
  const viewer = $('#viewer');
  viewer.hidden = false;
  setViewerMode(true, list[idx].name);
  showImage(list[idx]);
  buildFilmstrip();
}

async function showViewerForExternal(filePath, extraPaths) {
  const paths = (extraPaths && extraPaths.length) ? extraPaths : [filePath];
  const entries = [];
  for (const p of paths) {
    const existing = state.sorted.find((i) => i.path === p);
    if (existing) { entries.push(existing); continue; }
    const meta = await window.lh.library.describe(p);
    if (!meta) continue;
    entries.push({
      path: meta.path, url: meta.url, name: meta.name, base: meta.base, ext: meta.ext,
      size: meta.size, mtime: meta.mtime, dir: meta.dir, folder: meta.folder,
      native: meta.native, kind: meta.kind
    });
  }
  if (!entries.length) { toast('Could not open those files', 'err'); return; }
  // if the requested file lives inside the library, keep the whole library navigable
  const first = state.sorted.find((i) => i.path === entries[0].path);
  state.filtered = first ? state.sorted : entries;
  $('#library').hidden = true;
  $('#viewer').hidden = false;
  setViewerMode(true, entries[0].name);
  showImage(entries[0]);
  buildFilmstrip();
}

function closeViewer() {
  $('#viewer').hidden = true;
  $('#library').hidden = false;
  setViewerMode(false);
  setTitleBarText(APP_NAME);
  $('#info-pane').hidden = true;
  state.viewImage = null;
  cancelCrop();
  syncApplyButton();
  syncEditCommands();
  Object.assign(state, { zoom: 1, panX: 0, panY: 0 });
}

async function showImage(img) {
  state.viewImage = img;
  const stageImg = $('#stage-img');
  const list = state.filtered.length ? state.filtered : state.sorted;
  const pos = list.findIndex((i) => i.path === img.path);
  $('#viewer-pos').textContent = `${pos >= 0 ? pos + 1 : '–'} / ${list.length}`;

  const edit = state.edits[img.path];
  $('#edit-pill').hidden = !edit;
  setTitleBarText(img.name);

  // preset transforms from session edits
  const rot = edit && edit.rotate ? edit.rotate : 0;
  stageImg.style.transition = 'none';
  stageImg.src = edit && edit.dataUrl ? edit.dataUrl : img.url;
  stageImg.style.transform = `rotate(${rot}deg)${edit && edit.flipH ? ' scaleX(-1)' : ''}${edit && edit.flipV ? ' scaleY(-1)' : ''}`;

  stageImg.onload = () => {
    state.natural = { w: stageImg.naturalWidth, h: stageImg.naturalHeight };
    syncApplyButton();
    syncEditCommands();
    // Rotation is handled inside fitToWindow (it swaps which axis it measures
    // against), so no max-width clamp belongs here — a clamp set once here
    // outlives every zoom and caps the image for the rest of the session.
    fitToWindow();
    updateZoomPill();
  };
  stageImg.onerror = () => {
    stageImg.style.display = 'none';
    showUnsupported(img);
    toast(`${img.ext} cannot be decoded by the built-in decoder — metadata is still available.`, 'info', 4200);
  };
  stageImg.style.display = '';
  stageImg.draggable = false;
  hideUnsupported();

  $('#nav-prev').disabled = pos <= 0;
  $('#nav-next').disabled = pos === -1 || pos >= list.length - 1;

  // metadata footer
  const meta = $('#viewer-meta');
  meta.innerHTML = '';
  const put = (label, value) => {
    const span = el('span');
    span.innerHTML = label ? `<b>${label}</b> ${value}` : value;
    meta.appendChild(span);
  };
  if (state.natural.w) put('', `${state.natural.w} × ${state.natural.h}`);
  put('', img.ext);
  put('', fmtBytes(img.size));
  put('', fmtShortDate(img.mtime));

  updateFilmstripActive();
  if (!$('#info-pane').hidden) renderInfo();

  // refresh exif / dims asynchronously
  const detail = await window.lh.library.describe(img.path).catch(() => null);
  if (detail && state.viewImage && state.viewImage.path === img.path) {
    img.info = detail.info;
    if (detail.info && detail.info.width) {
      state.natural = { w: detail.info.width, h: detail.info.height };
      meta.innerHTML = '';
      state.natural = { w: detail.info.width, h: detail.info.height };
      if (state.natural.w) put('', `${state.natural.w} × ${state.natural.h}`);
      put('', img.ext);
      put('', fmtBytes(img.size));
      put('', fmtShortDate(img.mtime));
      if (detail.info.exif && detail.info.exif.camera !== undefined) { /* noop */ }
      const e = detail.info.exif;
      if (e) {
        if (e.model) put('·', e.model);
        if (e.exposure) put('·', e.exposure);
        if (e.aperture) put('·', e.aperture);
        if (e.iso) put('·', e.iso);
      }
    }
    if (!$('#info-pane').hidden) renderInfo();
  }
}

function showUnsupported(img) {
  const stage = $('#viewer-stage');
  let card = stage.querySelector('.unsupported-card');
  if (!card) {
    card = el('div', 'unsupported-card');
    stage.appendChild(card);
  }
  card.hidden = false;
  card.innerHTML = `${icon('image_off')}<h3>${escapeHtml(img.ext)} preview unavailable</h3>
    <p>Lehtratuh lists this file and reads its metadata, but the image itself needs a decoder that ships with this build.</p>
    <button class="btn subtle small">${icon('folder_open')}Show in Explorer</button>`;
  card.querySelector('button').addEventListener('click', () => window.lh.file.reveal(img.path));
}

function hideUnsupported() {
  const card = $('#viewer-stage').querySelector('.unsupported-card');
  if (card) card.hidden = true;
}

function fitToWindow() {
  const stage = $('#viewer-stage');
  const canvas = $('#stage-canvas');
  const img = $('#stage-img');
  if (!img.naturalWidth) return;
  const availW = stage.clientWidth - 96;
  const availH = stage.clientHeight - 40;
  const rot = (state.edits[state.viewImage?.path] || {}).rotate || 0;
  const nw = rot % 180 !== 0 ? img.naturalHeight : img.naturalWidth;
  const nh = rot % 180 !== 0 ? img.naturalWidth : img.naturalHeight;
  const scale = Math.min(availW / nw, availH / nh, 4);
  state.fitScale = scale;
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  applyStageTransform();
  canvas.classList.remove('zoomed');
  // The rotation swap is already accounted for above, in `nw`/`nh`, which feed
  // `fitScale`. Do NOT also set max-width/max-height here: an explicit max
  // clamp survives every later zoom-in and caps the image at the fitted size,
  // which is precisely the "cannot go past 100%" the user hit.
}

/* Zoom model.

   `state.zoom` is a multiple of the FIT size: 1 means "fitted to the stage".
   Any continuous multiple is legal inside [i_ZoomMin, i_ZoomMax], including
   values below 1 — zooming out past Fit has to be possible, and previously it
   was not, because the range was clamped to `Math.max(1, ...)`. That clamp is
   why zooming out below Fit simply stopped: the wheel and the buttons were
   both silently pinned at exactly 1.

   The other half of the old bug was that "Fit" was a *mode* as well as a size.
   `applyStageTransform` only released the image's CSS `max-width`/`max-height`
   when zoom > 1.001, so the moment you returned to Fit the CSS clamps grabbed
   the image back, fought the computed size, and the next wheel tick started
   from a size the layout had already overridden. Size and mode are now
   separate: the CSS caps are released whenever the image is being drawn at an
   explicit size, and the pill says "Fit" purely as a label for zoom === 1. */

const ZOOM_MIN = 0.08;   // 8% of the fitted size — effectively "keep shrinking"
const ZOOM_MAX = 16;     // 16x the fitted size

function applyStageTransform() {
  const canvas = $('#stage-canvas');
  const img = $('#stage-img');
  const stage = $('#viewer-stage');
  const atFit = Math.abs(state.zoom - 1) < 0.0005;

  // Never let the CSS caps win: they are a *fallback* for the un-loaded state,
  // not a constraint on a size we are setting explicitly.
  img.style.maxWidth = 'none';
  img.style.maxHeight = 'none';
  canvas.classList.toggle('zoomed', !atFit);

  // Always an explicit pixel size, so what is on screen is exactly what the
  // model says — no dependence on naturalWidth being rounded, no layout fight.
  if (img.naturalWidth) {
    img.style.width = Math.max(1, Math.round(img.naturalWidth * state.fitScale * state.zoom)) + 'px';
    img.style.height = Math.max(1, Math.round(img.naturalHeight * state.fitScale * state.zoom)) + 'px';
  }

  canvas.style.transform = `translate(${state.panX}px, ${state.panY}px)`;
  stage.style.cursor = state.zoom > 1.001 ? 'grab' : 'default';
}

function updateZoomPill() {
  const atFit = Math.abs(state.zoom - 1) < 0.0005;
  $('#zoom-pill').textContent = atFit
    ? 'Fit'
    : Math.round(state.zoom * state.fitScale * 100) + '%';
  syncActualButton();
}

/* The 100% button is a toggle, so its meaning depends on where you are. At 100%
   it turns into "Fit to window" and shows the fit glyph; anywhere else it is
   "Actual size". Driving the label from the zoom state means the button always
   describes what pressing it will do, instead of always claiming one thing. */
function syncActualButton() {
  const btn = document.querySelector('[data-cmd="actual"]');
  if (!btn) return;
  const atActual = Math.abs(state.zoom * state.fitScale - 1) < 0.005;
  const use = btn.querySelector('use');
  if (use) use.setAttribute('href', atActual ? '#i-zoom_fit' : '#i-ratio_free');
  btn.title = atActual ? 'Fit to window (Ctrl+1)' : 'Actual size (Ctrl+1)';
  btn.setAttribute('aria-label', btn.title);
  btn.classList.toggle('is-on', atActual);
}

/* Zoom about a point in stage coordinates, so the pixel under the cursor stays
   under the cursor. `keepPan` is used by the keyboard and the toolbar, which
   have no cursor anchor and should zoom about the centre. */
function applyZoom(next, anchor) {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  const before = state.zoom;
  if (Math.abs(clamped - before) < 1e-6) return false;
  const k = clamped / before;
  state.zoom = clamped;
  if (anchor) {
    state.panX = (state.panX - anchor.x) * k + anchor.x;
    state.panY = (state.panY - anchor.y) * k + anchor.y;
  } else {
    state.panX *= k;
    state.panY *= k;
  }
  applyStageTransform();
  updateZoomPill();
  return true;
}

function zoomBy(factor) {
  applyZoom(state.zoom * factor, null);
}

function setActualSize() {
  if (!state.viewImage) return;
  // 100% = one image pixel per CSS pixel, whatever the fit scale happens to be.
  applyZoom(1 / state.fitScale, null);
}

function navigate(delta) {
  const list = state.filtered.length ? state.filtered : state.sorted;
  const idx = list.findIndex((i) => i.path === state.viewImage?.path);
  const next = idx + delta;
  if (next < 0 || next >= list.length) return;
  state.current = next;
  const img = list[next];
  const stageImg = $('#stage-img');
  if (state.settings.transitions) {
    stageImg.style.transition = 'opacity 120ms ease';
    stageImg.style.opacity = '0';
    setTimeout(() => {
      showImage(img);
      requestAnimationFrame(() => { stageImg.style.opacity = '1'; });
    }, 90);
  } else {
    showImage(img);
  }
}

function buildFilmstrip() {
  const strip = $('#filmstrip');
  strip.innerHTML = '';
  strip.hidden = !state.settings.showFilmstrip;
  // Before the early return: hiding the strip is exactly when the toggle needs
  // to update. Putting this at the end meant the buttons only refreshed while
  // the strip was already visible, so the pressed state was always one action
  // behind — and looked permanently pressed.
  syncFilmstripButtons();
  if (!state.settings.showFilmstrip) return;
  const list = state.filtered.length ? state.filtered : state.sorted;
  const frag = document.createDocumentFragment();
  list.forEach((img) => {
    const b = el('button', 'fs-item');
    b.dataset.path = img.path;
    const im = document.createElement('img');
    im.loading = 'lazy';
    im.src = img.url;
    im.alt = img.name;
    im.addEventListener('error', () => im.remove());
    b.appendChild(im);
    b.title = img.name;
    b.addEventListener('click', () => {
      showImage(img);
      state.current = list.indexOf(img);
    });
    frag.appendChild(b);
  });
  strip.appendChild(frag);
  updateFilmstripActive();
}

/* The filmstrip toggle used to carry `.is-on` whenever the strip was open, which
   is its normal state — so it looked permanently pressed and said nothing about
   what clicking it would do. It now reports state the way a toggle should:
   pressed while open, un-pressed when hidden, with a title that names the action
   and an aria-pressed for screen readers. */
function syncFilmstripButtons() {
  const open = !!state.settings.showFilmstrip;
  const label = open ? 'Hide filmstrip' : 'Show filmstrip';
  ['btn-filmstrip', 'btn-filmstrip-top'].forEach((id) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.classList.toggle('is-on', open);
    b.setAttribute('aria-pressed', String(open));
    b.title = label;
    b.setAttribute('aria-label', label);
  });
}

function updateFilmstripActive() {
  const path = state.viewImage?.path;
  $$('#filmstrip .fs-item').forEach((b) => {
    const active = b.dataset.path === path;
    b.classList.toggle('active', active);
    if (active && b.scrollIntoView) {
      b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
  });
}

/* ------------------------------------------------------------------ info pane */

function renderInfo() {
  const img = state.viewImage;
  if (!img) return;
  const body = $('#info-body');
  const e = img.info ? img.info.exif : null;
  body.innerHTML = '';

  const section = (title, rows) => {
    const s = el('div', 'info-section');
    s.innerHTML = `<h5>${title}</h5>`;
    for (const [k, v] of rows) {
      if (v === undefined || v === null || v === '') continue;
      const r = el('div', 'info-row');
      r.innerHTML = `<span class="k"></span><span class="v"></span>`;
      r.querySelector('.k').textContent = k;
      r.querySelector('.v').textContent = v;
      r.querySelector('.v').title = v;
      s.appendChild(r);
    }
    body.appendChild(s);
  };

  section('File', [
    ['Name', img.name],
    ['Folder', img.folder],
    ['Type', img.ext],
    ['Size', fmtBytes(img.size)],
    ['Modified', fmtDate(img.mtime)],
    ['Path', img.dir]
  ]);

  const dims = state.natural.w ? `${state.natural.w} × ${state.natural.h}` : (img.info && img.info.width ? `${img.info.width} × ${img.info.height}` : '—');
  const mp = state.natural.w ? ((state.natural.w * state.natural.h) / 1e6).toFixed(1) + ' MP' : '—';
  section('Image', [
    ['Dimensions', dims],
    ['Megapixels', mp],
    ['Aspect', aspectLabel(state.natural.w, state.natural.h)]
  ]);

  if (e) {
    section('Camera', [
      ['Camera', [e.make, e.model].filter(Boolean).join(' ')],
      ['Lens', e.lens],
      ['Taken', e.taken ? e.taken.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3') : ''],
      ['Exposure', e.exposure],
      ['Aperture', e.aperture],
      ['ISO', e.iso],
      ['Focal', e.focal],
      ['Bias', e.bias]
    ]);
  } else {
    section('Camera', [['EXIF', 'No camera metadata in this file']]);
  }
}

function aspectLabel(w, h) {
  if (!w || !h) return '—';
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  let rw = w / g;
  let rh = h / g;
  if (rw > 40 || rh > 40) {
    const ratio = w / h;
    return ratio.toFixed(2) + ' : 1';
  }
  return `${rw} : ${rh}`;
}

/* ------------------------------------------------------------------ dialogs */

let dialogResolve = null;
let dialogMode = 'confirm';

function openDialogLayer(which) {
  $('#dialog-layer').hidden = which !== 'dialog';
  $('#resize-layer').hidden = which !== 'resize';
}

function confirmDialog(title, body, opts = {}) {
  return new Promise((resolve) => {
    dialogMode = 'confirm';
    dialogResolve = resolve;
    $('#dialog-title').textContent = title;
    $('#dialog-body').textContent = body || '';
    $('#dialog-body').hidden = !body;
    $('#dialog-field').hidden = true;
    $('#dialog-ok').textContent = opts.okLabel || 'OK';
    $('#dialog-cancel').textContent = opts.cancelLabel || 'Cancel';
    openDialogLayer('dialog');
    $('#dialog-ok').focus();
  });
}

function promptDialog(title, body, value, opts = {}) {
  return new Promise((resolve) => {
    dialogMode = 'prompt';
    dialogResolve = resolve;
    $('#dialog-title').textContent = title;
    $('#dialog-body').textContent = body || '';
    $('#dialog-body').hidden = !body;
    $('#dialog-field').hidden = false;
    $('#dialog-error').hidden = true;
    const input = $('#dialog-input');
    input.value = value || '';
    $('#dialog-ok').textContent = opts.okLabel || 'OK';
    $('#dialog-cancel').textContent = opts.cancelLabel || 'Cancel';
    openDialogLayer('dialog');
    setTimeout(() => {
      input.focus();
      const dot = input.value.lastIndexOf('.');
      if (dot > 0) input.setSelectionRange(0, dot);
      else input.select();
    }, 30);
  });
}

function closeDialog(result) {
  openDialogLayer(null);
  const r = dialogResolve;
  dialogResolve = null;
  if (r) r(result);
}

async function openResizeDialog() {
  const img = state.viewImage;
  if (!img) return;
  const nat = img.info && img.info.width ? { w: img.info.width, h: img.info.height } : state.natural;
  const w = nat.w || 1;
  const h = nat.h || 1;
  $('#rs-width').value = w;
  $('#rs-height').value = h;
  $('#rs-lock').checked = true;
  $('#rs-preset').value = '';
  openDialogLayer('resize');
  $('#rs-width').focus();
  const ratio = h / w;
  $('#rs-width').oninput = () => {
    if ($('#rs-lock').checked) $('#rs-height').value = Math.max(1, Math.round(+$('#rs-width').value * ratio));
  };
  $('#rs-height').oninput = () => {
    if ($('#rs-lock').checked) $('#rs-width').value = Math.max(1, Math.round(+$('#rs-height').value / ratio));
  };
  $('#rs-preset').onchange = () => {
    const v = $('#rs-preset').value;
    if (!v) return;
    const width = +v;
    $('#rs-width').value = width;
    $('#rs-height').value = Math.max(1, Math.round(width * ratio));
  };
}

/* ------------------------------------------------------------------ crop */

function startCrop() {
  if (!state.viewImage) return;
  state.cropMode = true;
  const overlay = $('#crop-overlay');
  overlay.hidden = false;
  const imgEl = $('#stage-img');
  const canvas = $('#stage-canvas');
  // overlay is positioned over the image box inside the stage canvas
  const ir = imgEl.getBoundingClientRect();
  const cr = canvas.getBoundingClientRect();
  overlay.style.left = (ir.left - cr.left) + 'px';
  overlay.style.top = (ir.top - cr.top) + 'px';
  overlay.style.width = ir.width + 'px';
  overlay.style.height = ir.height + 'px';
  overlay.style.inset = 'auto';

  const rect = $('#crop-rect');
  const pad = 0.08;
  rect.style.left = ir.width * pad + 'px';
  rect.style.top = ir.height * pad + 'px';
  rect.style.width = ir.width * (1 - pad * 2) + 'px';
  rect.style.height = ir.height * (1 - pad * 2) + 'px';
  state.cropRect = { x: ir.width * pad, y: ir.height * pad, w: ir.width * (1 - pad * 2), h: ir.height * (1 - pad * 2) };

  overlay.onmousedown = onCropMouseDown;
  $('#zoom-pill').textContent = 'Crop · drag handles';
}

function cancelCrop() {
  state.cropMode = false;
  const overlay = $('#crop-overlay');
  overlay.hidden = true;
  updateZoomPill();
}

function onCropMouseDown(e) {
  const rectEl = $('#crop-rect');
  const overlay = $('#crop-overlay');
  const ob = overlay.getBoundingClientRect();
  const start = { x: e.clientX - ob.left, y: e.clientY - ob.top };
  const handle = e.target.classList.contains('handle') ? Array.from(e.target.classList).find((c) => c !== 'handle') : null;
  const orig = { ...state.cropRect };
  const inside = e.target === rectEl || rectEl.contains(e.target);
  if (!handle && !inside) {
    // start a brand-new selection
    state.cropRect = { x: start.x, y: start.y, w: 1, h: 1 };
  }

  const move = (ev) => {
    const px = ev.clientX - ob.left;
    const py = ev.clientY - ob.top;
    let r = { ...state.cropRect };
    if (!handle && !inside) {
      r.x = Math.min(start.x, px);
      r.y = Math.min(start.y, py);
      r.w = Math.abs(px - start.x);
      r.h = Math.abs(py - start.y);
    } else if (handle) {
      r = { ...orig };
      if (handle.includes('w')) { r.x = Math.min(px, orig.x + orig.w - 20); r.w = orig.x + orig.w - r.x; }
      if (handle.includes('e')) { r.w = Math.max(20, px - orig.x); }
      if (handle.includes('n')) { r.y = Math.min(py, orig.y + orig.h - 20); r.h = orig.y + orig.h - r.y; }
      if (handle.includes('s')) { r.h = Math.max(20, py - orig.y); }
    } else {
      r.x = Math.max(0, Math.min(ob.width - orig.w, orig.x + (px - start.x)));
      r.y = Math.max(0, Math.min(ob.height - orig.h, orig.y + (py - start.y)));
    }
    r.w = Math.min(r.w, ob.width - r.x);
    r.h = Math.min(r.h, ob.height - r.y);
    state.cropRect = r;
    rectEl.style.left = r.x + 'px';
    rectEl.style.top = r.y + 'px';
    rectEl.style.width = r.w + 'px';
    rectEl.style.height = r.h + 'px';
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  e.preventDefault();
}

async function applyCrop() {
  const img = state.viewImage;
  if (!img || !state.cropRect) return;
  const overlay = $('#crop-overlay');
  const ob = overlay.getBoundingClientRect();
  const r = state.cropRect;
  const edits = state.edits[img.path] || {};
  const rot = edits.rotate || 0;
  const src = new Image();
  src.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => {
    src.onload = resolve;
    src.onerror = reject;
    src.src = edits.dataUrl || img.url;
  });
  // bake rotation/flip first so crop coordinates line up with what is on screen
  let source = src;
  if (rot || edits.flipH || edits.flipV) {
    const swap = rot % 180 !== 0;
    const baked = document.createElement('canvas');
    baked.width = swap ? src.naturalHeight : src.naturalWidth;
    baked.height = swap ? src.naturalWidth : src.naturalHeight;
    const bctx = baked.getContext('2d');
    bctx.translate(baked.width / 2, baked.height / 2);
    bctx.rotate((rot * Math.PI) / 180);
    if (edits.flipH) bctx.scale(-1, 1);
    if (edits.flipV) bctx.scale(1, -1);
    bctx.drawImage(src, -src.naturalWidth / 2, -src.naturalHeight / 2);
    source = baked;
  }
  // naturalWidth only exists on <img>; a baked canvas exposes width/height
  const srcW = source.naturalWidth || source.width;
  const srcH = source.naturalHeight || source.height;
  const sx = Math.round((r.x / ob.width) * srcW);
  const sy = Math.round((r.y / ob.height) * srcH);
  const sw = Math.max(1, Math.round((r.w / ob.width) * srcW));
  const sh = Math.max(1, Math.round((r.h / ob.height) * srcH));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  const dataUrl = canvas.toDataURL('image/png');
  state.edits[img.path] = { ...(state.edits[img.path] || {}), dataUrl, rotate: 0, crop: true };
  cancelCrop();
  $('#edit-pill').hidden = false;
  toast('Cropped — use Save a copy to keep it');
  await showImage(img);
}

/* ------------------------------------------------------------------ transforms */

function rotate(delta) {
  const img = state.viewImage;
  if (!img) return;
  const e = state.edits[img.path] || {};
  const rot = (((e.rotate || 0) + delta) % 360 + 360) % 360;
  state.edits[img.path] = { ...e, rotate: rot };
  $('#edit-pill').hidden = false;
  syncApplyButton();
  showImage(img);
}

function flip(axis) {
  const img = state.viewImage;
  if (!img) return;
  const e = state.edits[img.path] || {};
  state.edits[img.path] = { ...e, [axis]: !e[axis] };
  $('#edit-pill').hidden = false;
  syncApplyButton();
  showImage(img);
}

async function autoAdjust() {
  const img = state.viewImage;
  if (!img) { toast('Open a photo first', 'err'); return; }
  toast('Analyzing histogram…', 'info', 1200);
  try {
    const src = new Image();
    src.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => { src.onload = resolve; src.onerror = reject; src.src = img.url; });
    const scale = Math.min(1, 900 / Math.max(src.naturalWidth, src.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.naturalWidth * scale));
    c.height = Math.max(1, Math.round(src.naturalHeight * scale));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const hist = new Array(256).fill(0);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const l = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      hist[l]++;
      sum += l;
    }
    const total = data.length / 4;
    let lo = 0, hi = 255, acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > total * 0.005) { lo = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > total * 0.005) { hi = i; break; } }
    const mean = sum / total;
    const brightness = Math.max(-60, Math.min(60, Math.round((128 - mean) * 0.35)));
    const contrast = Math.max(-40, Math.min(60, Math.round(((255 - (hi - lo)) / 255) * 90 - 10)));
    const saturation = 10;
    state.edits[img.path] = { ...(state.edits[img.path] || {}), autoAdjust: { brightness, contrast, saturation } };
    $('#edit-pill').hidden = false;
    syncApplyButton();
    await renderAutoAdjusted(img, { brightness, contrast, saturation });
    toast('Auto adjusted');
  } catch (err) {
    toast('Auto adjust failed on this file', 'err');
  }
}

async function renderAutoAdjusted(img, adj) {
  const src = new Image();
  src.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => { src.onload = resolve; src.onerror = reject; src.src = img.url; });
  const c = document.createElement('canvas');
  c.width = src.naturalWidth;
  c.height = src.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.filter = `brightness(${1 + adj.brightness / 100}) contrast(${1 + adj.contrast / 100}) saturate(${1 + adj.saturation / 100})`;
  ctx.drawImage(src, 0, 0);
  const dataUrl = c.toDataURL('image/jpeg', 0.94);
  state.edits[img.path] = { ...(state.edits[img.path] || {}), dataUrl, auto: adj };
  const stageImg = $('#stage-img');
  stageImg.src = dataUrl;
  stageImg.style.display = '';
}

async function saveCopy() {
  const img = state.viewImage;
  if (!img) { toast('Open a photo first', 'err'); return; }
  const edit = state.edits[img.path];
  let dataUrl = edit && edit.dataUrl ? edit.dataUrl : null;
  if (!dataUrl) {
    // save the pristine file through a canvas render (handles rotation/flip too)
    try {
      const src = new Image();
      src.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => { src.onload = resolve; src.onerror = reject; src.src = img.url; });
      const c = document.createElement('canvas');
      const rot = (edit && edit.rotate) || 0;
      const swap = rot % 180 !== 0;
      c.width = swap ? src.naturalHeight : src.naturalWidth;
      c.height = swap ? src.naturalWidth : src.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((rot * Math.PI) / 180);
      if (edit && edit.flipH) ctx.scale(-1, 1);
      if (edit && edit.flipV) ctx.scale(1, -1);
      ctx.drawImage(src, -src.naturalWidth / 2, -src.naturalHeight / 2);
      dataUrl = c.toDataURL('image/png');
    } catch {
      toast('This format cannot be re-encoded — copying instead', 'info');
      await saveRawCopy(img);
      return;
    }
  }
  const base64 = dataUrl.split(',')[1];
  const ext = img.ext.toLowerCase();
  const format = ['jpg', 'jpeg'].includes(ext) ? 'jpeg' : ext === 'webp' ? 'webp' : 'png';
  const suggested = `${img.base}${edit ? ' (edited)' : ' copy'}.${format === 'jpeg' ? 'jpg' : format}`;
  const res = await window.lh.image.save({
    filePath: null, data: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
    format, suggestedName: suggested, useDialog: true
  });
  if (res.ok) {
    toast('Saved — ' + pathSafeName(res.path));
    const dir = res.path.replace(/[\\/][^\\/]+$/, '');
    if (state.library && dir.toLowerCase() === state.library.root.toLowerCase()) {
      await scanLibrary(state.library.root);
    }
  } else if (!res.canceled) {
    toast(res.error || 'Save failed', 'err');
  }
}

async function saveRawCopy(img) {
  const buf = await (await fetch(img.url)).arrayBuffer();
  const dot = img.name.lastIndexOf('.');
  const suggested = img.name.slice(0, dot) + ' copy' + img.name.slice(dot);
  const res = await window.lh.image.save({
    filePath: null, data: new Uint8Array(buf), format: 'png', suggestedName: suggested, useDialog: true
  });
  if (res.ok) toast('Saved — ' + pathSafeName(res.path));
}

/* ------------------------------------------------------------------ advanced tools */

async function openEditor(filePath) {
  const img = (filePath && state.images.find((i) => i.path === filePath)) || state.viewImage;
  if (!img) { toast('Open a photo first', 'err'); return; }
  if (!window.LehtratuhEditor) { toast('Editor module not loaded', 'err'); return; }
  await window.LehtratuhEditor.open(img);
}

async function removeTool() {
  if (!state.viewImage) { toast('Open a photo first', 'err'); return; }
  await openEditor(state.viewImage.path);
  window.LehtratuhEditor.startRemoveTool();
}

/* ------------------------------------------------------------------ apply
   Writing edits back over the file that is open. Auto adjust stores a flattened
   preview `dataUrl`; rotate and flip are stored as flags. To commit, the flags
   are baked into the pixels and the result replaces the original file — but only
   after the user confirms, because this is the one action in the app that
   destroys the original rather than producing a copy. */

function hasStagedEdits(img) {
  const e = img && state.edits[img.path];
  if (!e) return false;
  return !!(e.dataUrl || e.autoAdjust || e.auto
    || (e.rotate || 0) % 360 !== 0 || e.flipH || e.flipV);
}

function syncApplyButton() {
  const staged = hasStagedEdits(state.viewImage);
  const apply = $('#btn-apply');
  if (apply) { apply.hidden = !staged; apply.disabled = !staged; }
  const revert = $('#btn-revert');
  if (revert) { revert.hidden = !staged; revert.disabled = !staged; }
  syncEditCommands();
}

/* Rotate, flip and auto adjust all round-trip the file through a canvas, and the
   browser engine cannot decode AVIF, HEIC/HEIF, TIFF, RAW and friends. Rather
   than let the user press a button that will fail, those commands are disabled
   for such files. The editor still has its own rotate and Save a copy, which is
   why this is a disable and not a removal. */
function canEditPixels(img) {
  if (!img) return false;
  if (img.decodable === false) return false;
  return true;
}

function syncEditCommands() {
  const ok = canEditPixels(state.viewImage);
  ['rotateleft', 'rotateright', 'autoadjust'].forEach((cmd) => {
    const b = document.querySelector(`[data-cmd="${cmd}"]`);
    if (!b) return;
    b.disabled = !ok;
    const name = cmd === 'rotateleft' ? 'Rotate left (Ctrl+,)'
      : cmd === 'rotateright' ? 'Rotate right (Ctrl+.)'
        : 'Auto adjust (Ctrl+E)';
    b.title = ok ? name : `${name.split(' (')[0]} — this format cannot be re-encoded`;
  });
}

/* Throw the staged edit away and put the file on screen as it is on disk. */
async function revertEdits() {
  const img = state.viewImage;
  if (!img) return;
  if (!hasStagedEdits(img)) return;
  delete state.edits[img.path];
  $('#edit-pill').hidden = true;
  toast('Changes discarded', 'info', 1800);
  await showImage(img);
  syncApplyButton();
}

function encodableFormat(img) {
  const ext = (img.ext || '').toLowerCase();
  if (['jpg', 'jpeg'].includes(ext)) return 'jpeg';
  if (ext === 'png') return 'png';
  if (ext === 'webp') return 'webp';
  if (ext === 'bmp') return 'bmp';
  return null;
}

async function applyEditsToPhoto() {
  const img = state.viewImage;
  if (!img) return;
  const edit = state.edits[img.path];
  if (!edit || !hasStagedEdits(img)) { toast('Nothing to apply', 'info'); return; }

  const format = encodableFormat(img);
  if (!format) {
    toast(`${img.ext} cannot be re-encoded — use Save a copy instead`, 'info', 4200);
    return;
  }

  const ok = await confirmDialog(
    'Overwrite this photo?',
    `${img.base}.${img.ext} will be replaced with the adjusted version. `
    + 'The change cannot be undone from inside Lehtratuh.',
    { okLabel: 'Overwrite', cancelLabel: 'Cancel' }
  );
  if (!ok) return;

  try {
    // Bake rotation and flips into the pixels. The preview and the saved file
    // have to come from the same render, or "apply" would save something the
    // user was never shown.
    const src = new Image();
    src.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      src.onload = resolve; src.onerror = reject;
      src.src = edit.dataUrl || img.url;
    });
    const rot = ((edit.rotate || 0) % 360 + 360) % 360;
    const swap = rot % 180 !== 0;
    const c = document.createElement('canvas');
    c.width = swap ? src.naturalHeight : src.naturalWidth;
    c.height = swap ? src.naturalWidth : src.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    if (edit.flipH) ctx.scale(-1, 1);
    if (edit.flipV) ctx.scale(1, -1);
    ctx.drawImage(src, -src.naturalWidth / 2, -src.naturalHeight / 2);

    const dataUrl = c.toDataURL(`image/${format}`, 0.95);
    const base64 = dataUrl.split(',')[1];
    const res = await window.lh.image.save({
      filePath: img.path,
      data: Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0)),
      format,
      useDialog: false
    });
    if (!res.ok) { toast(res.error || 'Could not write the file', 'err'); return; }

    // Drop the staged edit: what is on screen is now the file itself.
    delete state.edits[img.path];
    $('#edit-pill').hidden = true;
    syncApplyButton();
    toast('Applied to ' + img.base + '.' + img.ext);
    await scanLibrary(state.library ? state.library.root : null);
    const again = (state.filtered.length ? state.filtered : state.sorted).find((i) => i.path === img.path);
    if (again) await showImage(again);
  } catch (err) {
    toast('Apply failed: ' + (err && err.message ? err.message : 'unknown error'), 'err', 4200);
  }
}

/* ------------------------------------------------------------------ settings UI */

function paintRange(input) {
  const min = +input.min || 0;
  const max = +input.max || 100;
  const pct = ((+input.value - min) / (max - min)) * 100;
  input.style.setProperty('--fill', pct + '%');
}

async function patchSettings(patch) {
  state.settings = await window.lh.settings.save(patch);
  applyTheme();
}

async function setFolder(folder) {
  const saved = await window.lh.settings.save({ photoFolder: folder });
  state.settings = saved;
  await scanLibrary(folder);
  toast('Library folder changed');
  if (state.viewImage) closeViewer();
}

/* Read the real Windows accent. Backed by the DWM registry value, so the swatch,
   the preview and the applied colour are all the user's actual colour. */
async function loadSystemAccent() {
  try {
    const res = await window.lh.accent.get();
    if (res && res.accent) {
      state.systemAccent = res;
      return res;
    }
  } catch { /* fall through */ }
  return state.systemAccent;
}

function systemAccentColor() {
  return (state.systemAccent && state.systemAccent.accent) || '#0067c0';
}

/* Pick black or white text for whatever accent is active, so a pale Windows
   accent does not end up with white text on top of it. */
function relativeLuminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function applyAccentForeground() {
  const s = state.settings;
  const color = s.accent === 'system' ? systemAccentColor() : s.accent;
  const dark = relativeLuminance(color) > 0.55;
  document.documentElement.style.setProperty('--accent-text', dark ? '#101010' : '#ffffff');
}

/* ------------------------------------------------------------------ commands */

const commands = {
  home() {
    if (!$('#viewer').hidden) closeViewer();
    else closePanels();
  },
  open: async () => {
    const files = await window.lh.library.openImages();
    if (files && files.length) {
      await showViewerForExternal(files[0], files);
    }
  },
  save: () => saveCopy(),
  copy: () => state.viewImage && copyImage(state.viewImage.path),
  undo: () => toast('Nothing to undo in the viewer', 'info'),
  redo: () => toast('Nothing to redo in the viewer', 'info'),
  prev: () => navigationGuard(() => navigate(-1)),
  next: () => navigationGuard(() => navigate(1)),
  zoomin: () => { ensureViewer(); zoomBy(1.25); },
  zoomout: () => { ensureViewer(); zoomBy(1 / 1.25); },
  fit: () => { ensureViewer(); fitToWindow(); updateZoomPill(); },
  actual: () => {
    ensureViewer();
    // The button is a toggle between the two named sizes. At 100% it offers Fit,
    // everywhere else it offers 100%, so it never does nothing when pressed.
    if (Math.abs(state.zoom * state.fitScale - 1) < 0.005) {
      fitToWindow();
      updateZoomPill();
    } else {
      setActualSize();
    }
  },
  rotateleft: () => { ensureViewer(); rotate(-90); },
  rotateright: () => { ensureViewer(); rotate(90); },
  fliph: () => { ensureViewer(); flip('flipH'); },
  flipv: () => { ensureViewer(); flip('flipV'); },
  crop: () => {
    ensureViewer();
    if (state.cropMode) confirmCrop();
    else startCrop();
  },
  resize: () => { ensureViewer(); openResizeDialog(); },
  autoadjust: () => { ensureViewer(); autoAdjust(); },
  remove: () => { if (state.viewImage) removeTool(); },
  photoeditor: () => {
    if (state.viewImage) openEditor(state.viewImage.path);
    else toast('Open a photo, then pick the brush to edit it', 'info', 3200);
  },
  delete: () => state.viewImage && trashImages([state.viewImage.path]),
  rename: () => state.viewImage && renameImage(state.viewImage.path),
  settings: () => openSettings(),
  info: () => toggleInfo()
};

function navigationGuard(fn) {
  if ($('#viewer').hidden || !state.viewImage) return;
  fn();
}

function ensureViewer() {
  if ($('#viewer').hidden) toast('Open a photo to use this tool', 'info', 1800);
}

async function confirmCrop() {
  const ok = await confirmDialog('Apply crop?', 'The picture will be cropped in the viewer. The original file is untouched until you save a copy.', { okLabel: 'Apply' });
  if (ok) applyCrop();
  else cancelCrop();
}

/* Settings is a separate native window now: the OS gives it dragging, snapping,
   resize and its own taskbar entry, none of which an in-page overlay can have.
   This just asks the main process to open (or focus) it. */
function openSettings(tab = 'library') {
  window.lh.settings.open(tab);
}

function closePanels() {
  const editorOpen = !$('#panel-editor').hidden;
  if (editorOpen && window.LehtratuhEditor) window.LehtratuhEditor.close();
  const dialogOpen = !$('#dialog-layer').hidden || !$('#resize-layer').hidden;
  if (!dialogOpen) $('#dialog-layer').hidden = true;
}

function toggleInfo() {
  if (!state.viewImage) { toast('Open a photo to see its details', 'info'); return; }
  const pane = $('#info-pane');
  pane.hidden = !pane.hidden;
  if (!pane.hidden) renderInfo();
  const btn = $('#btn-info');
  if (btn) btn.classList.toggle('is-on', !pane.hidden);
  // The pane takes a real column, so the stage just changed width. Re-fit if the
  // user was at Fit; otherwise leave their zoom alone and let it sit off-centre.
  if (Math.abs(state.zoom - 1) < 0.0005) {
    requestAnimationFrame(() => { fitToWindow(); updateZoomPill(); });
  }
}

function toggleFilmstrip() {
  state.settings.showFilmstrip = !state.settings.showFilmstrip;
  window.lh.settings.save({ showFilmstrip: state.settings.showFilmstrip });
  buildFilmstrip();
  syncFilmstripButtons();
  // The stage just got taller or shorter, so re-fit if the photo was fitted —
  // exactly the same rule the info pane follows.
  if (Math.abs(state.zoom - 1) < 0.0005) {
    requestAnimationFrame(() => { fitToWindow(); updateZoomPill(); });
  }
}

/* ------------------------------------------------------------------ wiring */

function wire() {
  // window controls
  $('#btn-min').addEventListener('click', () => window.lh.win.action('minimize'));
  $('#btn-max').addEventListener('click', () => window.lh.win.action('maximize'));
  $('#btn-close').addEventListener('click', () => window.lh.win.action('close'));
  $('#btn-min').addEventListener('dblclick', (e) => e.stopPropagation());

  window.lh.events.accentChanged((next) => {
    if (!next || !next.accent) return;
    state.systemAccent = next;
    applyTheme();
  });

  // The settings window writes to the same settings.json. Without this the
  // library behind it would keep painting the old theme until it was reopened.
  window.lh.events.settingsChanged((next) => {
    if (!next) return;
    const prevFolder = state.settings && state.settings.photoFolder;
    const prevView = state.settings && state.settings.libraryView;
    const prevGroup = state.settings && state.settings.groupByFolder;
    const prevNames = state.settings && state.settings.showFilenames;
    state.settings = next;
    if (next.accent === 'system' && !state.systemAccent) loadSystemAccent();
    applyTheme();
    if (next.photoFolder && next.photoFolder !== prevFolder) {
      setFolder(next.photoFolder);
      return;
    }
    if (!$('#viewer').hidden) {
      buildFilmstrip();
      syncFilmstripButtons();
    }
    if (next.libraryView !== prevView || next.groupByFolder !== prevGroup || next.showFilenames !== prevNames) {
      renderLibrary();
    }
  });

  // A resize changes the available stage, so "fitted" means a different number
  // of pixels. Re-fit on resize (debounced) only while the user is actually at
  // Fit — otherwise a window resize would silently throw away their zoom level.
  let refitTimer = null;
  window.addEventListener('resize', () => {
    if ($('#viewer').hidden || !state.viewImage) return;
    if (Math.abs(state.zoom - 1) > 0.0005) return;
    clearTimeout(refitTimer);
    refitTimer = setTimeout(() => {
      if (Math.abs(state.zoom - 1) > 0.0005) return;
      const wasAtFit = Math.abs(state.zoom - 1) < 0.0005;
      fitToWindow();
      if (wasAtFit) updateZoomPill();
    }, 90);
  });

  window.lh.events.state(({ maximized, fullscreen }) => {
    if (maximized !== undefined) {
      document.documentElement.dataset.maximized = String(maximized);
      $('#max-icon').innerHTML = `<use href="#i-chrome_${maximized ? 'restore' : 'max'}"/>`;
    }
    if (fullscreen !== undefined) {
      document.documentElement.dataset.fullscreen = String(fullscreen);
    }
  });

  // command bar
  $$('[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fn = commands[btn.dataset.cmd];
      if (fn) fn();
    });
  });

  $('#btn-change-folder').addEventListener('click', chooseFolder);
  $('#btn-open-photo').addEventListener('click', commands.open);
  $('#btn-empty-folder').addEventListener('click', chooseFolder);
  $('#btn-empty-open').addEventListener('click', commands.open);

  $('#nav-prev').addEventListener('click', () => navigate(-1));
  $('#nav-next').addEventListener('click', () => navigate(1));
  $('#btn-info').addEventListener('click', toggleInfo);
  $('#info-close').addEventListener('click', () => {
    $('#info-pane').hidden = true;
    $('#btn-info').classList.remove('is-on');
    if (Math.abs(state.zoom - 1) < 0.0005) {
      requestAnimationFrame(() => { fitToWindow(); updateZoomPill(); });
    }
  });
  $('#btn-apply').addEventListener('click', applyEditsToPhoto);
  $('#btn-revert').addEventListener('click', revertEdits);
  $('#btn-filmstrip').addEventListener('click', toggleFilmstrip);
  const fsTop = $('#btn-filmstrip-top');
  if (fsTop) fsTop.addEventListener('click', toggleFilmstrip);

  // zoom with wheel / pan with drag
  const stage = $('#viewer-stage');
  stage.addEventListener('wheel', (e) => {
    if ($('#viewer').hidden || !state.viewImage) return;
    e.preventDefault();
    if (state.cropMode) return;
    {
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const rect = stage.getBoundingClientRect();
      // Anchor on the cursor in stage coordinates. The canvas is the element
      // being transformed, and it sits centred in the stage, so a point in
      // stage space maps to a point relative to the canvas centre — which is
      // what the translate() offset is measured against.
      const anchor = {
        x: e.clientX - rect.left - rect.width / 2,
        y: e.clientY - rect.top - rect.height / 2
      };
      applyZoom(state.zoom * factor, anchor);
    }
  }, { passive: false });

  let dragging = null;
  stage.addEventListener('mousedown', (e) => {
    if (state.cropMode || !state.viewImage) return;
    if (e.button !== 0) return;
    dragging = { x: e.clientX, y: e.clientY, px: state.panX, py: state.panY };
    stage.classList.add('dragging');
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    state.panX = dragging.px + (e.clientX - dragging.x);
    state.panY = dragging.py + (e.clientY - dragging.y);
    $('#stage-canvas').style.transform = `translate(${state.panX}px, ${state.panY}px)`;
  });
  window.addEventListener('mouseup', () => {
    if (dragging) { dragging = null; stage.classList.remove('dragging'); }
  });
  stage.addEventListener('dblclick', () => {
    if (!state.viewImage) return;
    if (Math.abs(state.zoom - 1) > 0.0005) { fitToWindow(); updateZoomPill(); }
    else setActualSize();
  });

  // search
  const search = $('#search');
  search.addEventListener('input', debounce(() => {
    state.query = search.value.trim();
    $('#search-clear').hidden = !state.query;
    renderLibrary();
  }, 120));
  $('#search-clear').addEventListener('click', () => {
    search.value = '';
    state.query = '';
    $('#search-clear').hidden = true;
    renderLibrary();
  });

  // view switch
  $$('#view-switch button').forEach((b) => {
    b.addEventListener('click', () => patchSettings({ libraryView: b.dataset.view }).then(renderLibrary));
  });

  // sort flyout
  $('#btn-sort').addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    showSortMenu(rect.left, rect.bottom + 6);
  });

  // dialogs
  $('#dialog-ok').addEventListener('click', () => {
    if (dialogMode === 'prompt') {
      const v = $('#dialog-input').value.trim();
      if (!v) {
        $('#dialog-error').textContent = 'Please enter a name.';
        $('#dialog-error').hidden = false;
        return;
      }
      closeDialog(v);
    } else {
      closeDialog(true);
    }
  });
  $('#dialog-cancel').addEventListener('click', () => closeDialog(dialogMode === 'prompt' ? null : false));
  $('#dialog-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#dialog-ok').click();
    if (e.key === 'Escape') closeDialog(null);
  });
  $('#dialog-layer').addEventListener('mousedown', (e) => {
    if (e.target === $('#dialog-layer')) closeDialog(dialogMode === 'prompt' ? null : false);
  });
  $('#rs-cancel').addEventListener('click', () => openDialogLayer(null));
  $('#rs-ok').addEventListener('click', () => {
    const w = Math.max(1, Math.round(+$('#rs-width').value || 1));
    const h = Math.max(1, Math.round(+$('#rs-height').value || 1));
    openDialogLayer(null);
    resizeImage(w, h);
  });

  // editor panel close
  $('#ed-close').addEventListener('click', () => closePanels());

  // keyboard
  window.addEventListener('keydown', onKeyDown);

  // drag & drop
  const overlay = $('#drop-overlay');
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragDepth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) overlay.hidden = true;
  });
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    const files = Array.from(e.dataTransfer.files || []);
    const paths = files.map((f) => window.lh.file.pathForFile(f)).filter(Boolean);
    if (paths.length) {
      const images = paths.filter((p) => /\.(jpe?g|jpe|jfif|jfi|png|apng|bmp|dib|gif|webp|avif|ico|svg|tiff?|tga|psd|dds|pnm|ppm|pgm|pbm|hdr|qoi|heics?|heif|jxl|dng|cr[23w]|nef|nrw|arw|srf|sr2|orf|rw2|raf|pef|srw|raw|rwl|mrw|x3f|iiq|rwz|mef|mos|mdc|cap|3fr|ari|bay|dcr|erf|kdc|mfw|pxn|r3d)$/i.test(p));
      if (images.length) await showViewerForExternal(images[0], images);
      else toast('Those files are not images', 'err');
    }
  });

  // context menu on empty library area
  $('#groups').addEventListener('contextmenu', (e) => {
    if (e.target.closest('.tile') || e.target.closest('tr')) return;
    e.preventDefault();
    showLibraryMenu(e.clientX, e.clientY);
  });
}

const SORTS = [
  ['added-desc', 'Date added', 'sort'],
  ['date-desc', 'Newest first', 'history'],
  ['date-asc', 'Oldest first', 'history'],
  ['name-asc', 'Name A to Z', 'text_bullet'],
  ['name-desc', 'Name Z to A', 'text_bullet'],
  ['size-desc', 'Largest first', 'resize'],
  ['size-asc', 'Smallest first', 'resize']
];

function showSortMenu(x, y) {
  closeMenu();
  const menu = el('div', 'context-menu');
  for (const [key, label, ic] of SORTS) {
    const b = el('button', 'menu-item');
    b.innerHTML = `${icon(ic)}<span>${label}</span>${state.settings.sort === key ? '<span class="menu-check">' + icon('checkmark') + '</span>' : ''}`;
    b.addEventListener('click', async () => {
      closeMenu();
      await patchSettings({ sort: key });
      applySort();
      renderLibrary();
    });
    menu.appendChild(b);
  }
  menu.style.left = Math.min(x, window.innerWidth - 250) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - 340) + 'px';
  document.body.appendChild(menu);
  menuEl = menu;
  setTimeout(() => document.addEventListener('mousedown', onDocDownForMenu, { once: true }), 0);
}

function showLibraryMenu(x, y) {
  closeMenu();
  const menu = el('div', 'context-menu');
  const items = [
    { label: 'Open folder in Explorer', icon: 'folder_open', run: () => state.library && window.lh.file.openExternal(state.library.root) },
    { label: 'Change photo folder…', icon: 'folder', run: chooseFolder },
    { sep: true },
    { label: 'Refresh library', icon: 'arrow_sync', run: () => scanLibrary(state.library && state.library.root) },
    { label: 'Settings', icon: 'settings', run: () => openSettings() }
  ];
  for (const item of items) {
    if (item.sep) { menu.appendChild(el('div', 'menu-sep')); continue; }
    const b = el('button', 'menu-item');
    b.innerHTML = `${icon(item.icon)}<span>${item.label}</span>`;
    b.addEventListener('click', () => { closeMenu(); item.run(); });
    menu.appendChild(b);
  }
  menu.style.left = Math.min(x, window.innerWidth - 250) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - 200) + 'px';
  document.body.appendChild(menu);
  menuEl = menu;
  setTimeout(() => document.addEventListener('mousedown', onDocDownForMenu, { once: true }), 0);
}

async function chooseFolder() {
  const folder = await window.lh.library.chooseFolder();
  if (!folder) return;
  state.settings.photoFolder = folder;
  await scanLibrary(folder);
  toast('Library folder changed');
}

async function resizeImage(w, h) {
  const img = state.viewImage;
  if (!img) return;
  const src = new Image();
  src.crossOrigin = 'anonymous';
  try {
    await new Promise((resolve, reject) => { src.onload = resolve; src.onerror = reject; src.src = img.url; });
  } catch {
    toast('This file cannot be resized in place', 'err');
    return;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const dataUrl = c.toDataURL('image/png');
  state.edits[img.path] = { ...(state.edits[img.path] || {}), dataUrl, resized: { w, h } };
  $('#edit-pill').hidden = false;
  toast(`Resized to ${w} × ${h}`);
  await showImage(img);
}

function onKeyDown(e) {
  const target = e.target;
  const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
  const dialogOpen = !$('#dialog-layer').hidden;
  const editorOpen = !$('#panel-editor').hidden;
  const viewerOpen = !$('#viewer').hidden;

  if (e.key === 'Escape') {
    if (dialogOpen) { closeDialog(dialogMode === 'prompt' ? null : false); return; }
    if (state.cropMode) { cancelCrop(); return; }
    if (editorOpen) { closePanels(); return; }
    if (viewerOpen) { closeViewer(); return; }
    return;
  }

  if (typing) return;

  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl) {
    switch (e.key.toLowerCase()) {
      case 'o': e.preventDefault(); commands.open(); return;
      case 's': e.preventDefault(); commands.save(); return;
      case 'h': e.preventDefault(); commands.home(); return;
      case ',': e.preventDefault(); openSettings(); return;
      case 'f': e.preventDefault(); $('#search').focus(); return;
      case 'r': e.preventDefault(); commands.crop(); return;
      case 'e': e.preventDefault(); commands.autoadjust(); return;
      case 'm': e.preventDefault(); commands.remove(); return;
      case '0': e.preventDefault(); commands.fit(); return;
      case '1': e.preventDefault(); commands.actual(); return;
      case 'z': e.preventDefault(); commands.undo(); return;
      case 'y': e.preventDefault(); commands.redo(); return;
      case '=':
      case '+': e.preventDefault(); commands.zoomin(); return;
      case '-': e.preventDefault(); commands.zoomout(); return;
      case '.': e.preventDefault(); commands.rotateright(); return;
      case '/': e.preventDefault(); commands.rotateleft(); return;
      case 'a': if (viewerOpen) { e.preventDefault(); } return;
      default: return;
    }
  }

  if (e.key === 'F2' && viewerOpen) { e.preventDefault(); commands.rename(); return; }
  if (e.key === 'F11') { e.preventDefault(); window.lh.win.action('fullscreen'); return; }
  if (e.key === 'Delete' && viewerOpen) { e.preventDefault(); commands.delete(); return; }

  if (viewerOpen) {
    if (e.key === 'ArrowLeft') { navigate(-1); return; }
    if (e.key === 'ArrowRight') { navigate(1); return; }
    if (e.key === 'ArrowUp') { zoomBy(1.15); return; }
    if (e.key === 'ArrowDown') { zoomBy(1 / 1.15); return; }
    if (e.key.toLowerCase() === 'i') { toggleInfo(); return; }
    if (e.key.toLowerCase() === 'f') { fitToWindow(); updateZoomPill(); return; }
    if (e.key === ' ') { e.preventDefault(); navigate(1); return; }
  }
}

/* ------------------------------------------------------------------ boot */

function injectIconSprite() {
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
  state.settings = await window.lh.settings.load();
  if (!state.settings.accent) state.settings.accent = '#0067c0';

  // the real Windows accent, before the first paint so nothing flashes
  state.systemAccent = (state.info && state.info.accent) || (await loadSystemAccent());

  applyTheme();

  const info = state.info;

  // The material note, the About card and the credit logo all live in the
  // settings window now, so there is nothing left to fill in here.

  wire();
  // The toggle states have to be right before the first paint: they are only
  // otherwise refreshed as a side effect of building the things they describe,
  // which does not happen until a photo is opened.
  syncFilmstripButtons();
  syncApplyButton();

  await scanLibrary(state.settings.photoFolder);

  window.lh.events.ready((payload) => {
    if (payload && payload.startFile) showViewerForExternal(payload.startFile);
  });
  window.lh.events.openFile((file) => showViewerForExternal(file));
  // Launched with no file from the taskbar jump list: go straight to the picker.
  window.lh.events.pickFile(() => commands.open());

  const max = await window.lh.win.isMaximized();
  document.documentElement.dataset.maximized = String(max);
  $('#max-icon').innerHTML = `<use href="#i-chrome_${max ? 'restore' : 'max'}"/>`;
}

function IS_WINDOWS() {
  return state.info && state.info.platform === 'win32';
}

/* Shared UI bridge for the editor module */
window.LHUI = {
  toast,
  confirmDialog,
  promptDialog,
  icon,
  getSettings: () => state.settings
};

document.addEventListener('DOMContentLoaded', boot);
