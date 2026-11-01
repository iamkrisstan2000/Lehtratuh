'use strict';

/* ==========================================================================
   Lehtratuh — quick photo editor
   Adjust · Transform · Crop · Remove (content-aware, Poisson/Laplace fill)
   ========================================================================== */

(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const MAX_WORK = 2600; // working resolution cap for interactive editing

  const ed = {
    img: null,
    src: null,
    base: null,       // canvas: rotation / flip / crop applied
    view: null,       // canvas shown on screen
    ctx: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    adj: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, exposure: 0 },
    rotate: 0,
    flipH: false,
    flipV: false,
    crop: null,        // { x, y, w, h } in base pixels
    tool: 'none',      // none | crop | remove
    cropSel: null,     // active crop selection in base px
    brushing: false,
    mask: null,        // mask canvas for remove tool
    maskCtx: null,
    dirty: false,
    raf: 0
  };

  const ui = {};

  function cacheUi() {
    ui.panel = $('#panel-editor');
    ui.scrim = $('#scrim');
    ui.canvas = $('#ed-canvas');
    ui.preview = ui.panel.querySelector('.editor-preview');
    ui.hint = $('#ed-hint');
    ui.quality = $('#ed-quality');
    ui.format = $('#ed-format');
  }

  /* ------------------------------------------------------------ opening */

  async function open(img) {
    if (!ui.panel) cacheUi();
    ed.img = img;
    resetState();

    ui.panel.hidden = false;
    ui.scrim.hidden = false;
    setStatus('Loading photo…');

    try {
      ed.src = await loadImage(img.url);
    } catch (err) {
      window.LHUI.toast('This file cannot be decoded by the editor', 'err', 3600);
      return;
    }

    const scale = Math.min(1, MAX_WORK / Math.max(ed.src.naturalWidth, ed.src.naturalHeight));
    ed.workW = Math.round(ed.src.naturalWidth * scale);
    ed.workH = Math.round(ed.src.naturalHeight * scale);

    rebuildBase();
    paint(true);
    syncSliders();
    setStatus(img.name);
  }

  function resetState() {
    ed.zoom = 1;
    ed.panX = 0;
    ed.panY = 0;
    ed.rotate = 0;
    ed.flipH = false;
    ed.flipV = false;
    ed.crop = null;
    ed.cropSel = null;
    ed.tool = 'none';
    ed.dirty = false;
    ed.adj = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, exposure: 0 };
    ed.mask = null;
    ed.maskCtx = null;
    if (ui.canvas) {
      ui.canvas.style.transform = 'none';
      ui.canvas.style.filter = 'none';
    }
    $$('.ed-crop-bar').forEach((n) => n.remove());
  }

  function close() {
    if (!ui.panel) return;
    ui.panel.hidden = true;
    ed.tool = 'none';
    ed.cropSel = null;
    $$('.ed-crop-bar').forEach((n) => n.remove());
    const pill = ui.preview && ui.preview.querySelector('.tool-pill');
    if (pill) pill.remove();
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('decode failed'));
      im.src = url;
    });
  }

  function setStatus(text) {
    if (ui.hint) ui.hint.textContent = text;
  }

  /* ------------------------------------------------------------ rendering */

  function rebuildBase() {
    const src = ed.src;
    if (!src) return;
    const crop = ed.crop;
    const w = crop ? crop.w : ed.workW;
    const h = crop ? crop.h : ed.workH;

    // source rect in natural coordinates
    const sx = crop ? (crop.x / ed.workW) * src.naturalWidth : 0;
    const sy = crop ? (crop.y / ed.workH) * src.naturalHeight : 0;
    const sw = crop ? (crop.w / ed.workW) * src.naturalWidth : src.naturalWidth;
    const sh = crop ? (crop.h / ed.workH) * src.naturalHeight : src.naturalHeight;

    const outW = Math.max(1, Math.round(w));
    const outH = Math.max(1, Math.round(h));
    const c = document.createElement('canvas');
    c.width = outW;
    c.height = outH;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, outW, outH);
    ed.base = c;

    ed.mask = document.createElement('canvas');
    ed.mask.width = outW;
    ed.mask.height = outH;
    ed.maskCtx = ed.mask.getContext('2d');
  }

  function transformedBase() {
    // applies rotate/flip and returns a canvas (may be the base itself)
    const b = ed.base;
    if (!b) return null;
    if (!ed.rotate && !ed.flipH && !ed.flipV) return b;
    const swap = ed.rotate % 180 !== 0;
    const c = document.createElement('canvas');
    c.width = swap ? b.height : b.width;
    c.height = swap ? b.width : b.height;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((ed.rotate * Math.PI) / 180);
    ctx.scale(ed.flipH ? -1 : 1, ed.flipV ? -1 : 1);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(b, -b.width / 2, -b.height / 2);
    return c;
  }

  function schedulePaint() {
    if (ed.raf) return;
    ed.raf = requestAnimationFrame(() => {
      ed.raf = 0;
      paint();
    });
  }

  function paint(resetZoom) {
    const t = transformedBase();
    if (!t) return;
    if (!ed.view) {
      ed.view = ui.canvas;
    }
    const v = ed.view;
    if (v.width !== t.width || v.height !== t.height) {
      v.width = t.width;
      v.height = t.height;
    }
    const ctx = ed.ctx || (ed.ctx = v.getContext('2d', { willReadFrequently: false }));
    ctx.save();
    ctx.clearRect(0, 0, v.width, v.height);
    ctx.filter = cssFilter();
    ctx.drawImage(t, 0, 0);
    ctx.restore();

    // temperature / tint — warm/cool and green/magenta grade
    const temp = ed.adj.temperature / 100;
    const tint = ed.adj.tint / 100;
    if (Math.abs(temp) > 0.005) {
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = Math.min(0.55, Math.abs(temp) * 0.55);
      ctx.fillStyle = temp > 0 ? '#ff9a3c' : '#3c8bff';
      ctx.fillRect(0, 0, v.width, v.height);
      ctx.restore();
    }
    if (Math.abs(tint) > 0.005) {
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = Math.min(0.45, Math.abs(tint) * 0.45);
      ctx.fillStyle = tint > 0 ? '#e04bd8' : '#3bd07a';
      ctx.fillRect(0, 0, v.width, v.height);
      ctx.restore();
    }

    if (resetZoom) {
      ed.zoom = 1;
      ed.panX = 0;
      ed.panY = 0;
    }
    applyCanvasTransform();
    drawOverlays();
    ed.dirty = isDirty();
  }

  function cssFilter() {
    const a = ed.adj;
    const bright = Math.pow(1 + a.brightness / 100, 1) * Math.pow(2, a.exposure / 130);
    return `brightness(${bright.toFixed(3)}) contrast(${(1 + a.contrast / 100).toFixed(3)}) saturate(${(1 + a.saturation / 100).toFixed(3)})`;
  }

  function applyCanvasTransform() {
    const v = ed.view;
    if (!v) return;
    v.style.transform = `translate(${ed.panX}px, ${ed.panY}px) scale(${ed.zoom})`;
  }

  function fitCanvas() {
    const v = ed.view;
    if (!v) return;
    const box = ui.preview.getBoundingClientRect();
    const availW = box.width - 48;
    const availH = box.height - 48;
    v.style.maxWidth = availW + 'px';
    v.style.maxHeight = availH + 'px';
  }

  function isDirty() {
    const a = ed.adj;
    return !!(
      ed.rotate || ed.flipH || ed.flipV || ed.crop ||
      a.brightness || a.contrast || a.saturation || a.temperature || a.tint || a.exposure
    );
  }

  /* ------------------------------------------------------------ overlays */

  function drawOverlays() {
    // mask preview + crop selection are drawn as DOM layers for crispness
    if (ed.tool === 'remove') drawMaskOverlay();
    if (ed.tool === 'crop' && ed.cropSel) drawCropOverlay();
  }

  function overlayLayer(cls) {
    let layer = ui.preview.querySelector('.' + cls);
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'ed-overlay ' + cls;
      layer.style.position = 'absolute';
      layer.style.inset = '0';
      layer.style.pointerEvents = 'none';
      ui.preview.appendChild(layer);
    }
    return layer;
  }

  function drawMaskOverlay() {
    const layer = overlayLayer('mask-layer');
    layer.innerHTML = '';
    if (!ed.mask) return;
    const m = document.createElement('canvas');
    m.width = ed.mask.width;
    m.height = ed.mask.height;
    const c = m.getContext('2d');
    c.drawImage(ed.mask, 0, 0);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = 'rgba(0, 199, 255, 0.45)';
    c.fillRect(0, 0, m.width, m.height);

    const rect = ui.canvas.getBoundingClientRect();
    const box = ui.preview.getBoundingClientRect();
    Object.assign(m.style, {
      position: 'absolute',
      left: (rect.left - box.left) + 'px',
      top: (rect.top - box.top) + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
      transform: `translate(${ed.panX}px, ${ed.panY}px) scale(${ed.zoom})`,
      transformOrigin: '0 0',
      pointerEvents: 'none'
    });
    layer.appendChild(m);
  }

  function drawCropOverlay() {
    const layer = overlayLayer('crop-layer');
    layer.innerHTML = '';
    const rect = ui.canvas.getBoundingClientRect();
    const box = ui.preview.getBoundingClientRect();
    const scale = rect.width / ed.view.width;
    const s = ed.cropSel;
    const div = document.createElement('div');
    Object.assign(div.style, {
      position: 'absolute',
      left: (rect.left - box.left + s.x * scale) + 'px',
      top: (rect.top - box.top + s.y * scale) + 'px',
      width: (s.w * scale) + 'px',
      height: (s.h * scale) + 'px',
      border: '1.5px solid #fff',
      boxShadow: '0 0 0 1px rgba(0,0,0,.4), 0 0 0 4000px rgba(0,0,0,.45)',
      pointerEvents: 'none'
    });
    // rule-of-thirds guides
    for (let i = 1; i <= 2; i++) {
      const v = document.createElement('div');
      Object.assign(v.style, {
        position: 'absolute', left: (s.w / 3) * i + 'px', top: '0', bottom: '0',
        width: '1px', background: 'rgba(255,255,255,.45)'
      });
      div.appendChild(v);
      const h = document.createElement('div');
      Object.assign(h.style, {
        position: 'absolute', top: (s.h / 3) * i + 'px', left: '0', right: '0',
        height: '1px', background: 'rgba(255,255,255,.45)'
      });
      div.appendChild(h);
    }
    for (const [cls, cx, cy] of [
      ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['w', 0, 0.5],
      ['e', 1, 0.5], ['sw', 0, 1], ['s', 0.5, 1], ['se', 1, 1]
    ]) {
      const h = document.createElement('div');
      Object.assign(h.style, {
        position: 'absolute',
        width: '10px', height: '10px',
        left: `calc(${cx * 100}% - 5px)`,
        top: `calc(${cy * 100}% - 5px)`,
        background: '#fff',
        borderRadius: '2px',
        border: '1px solid rgba(0,0,0,.35)',
        pointerEvents: 'auto',
        cursor: cls.length === 2 ? 'nwse-resize' : cls === 'n' || cls === 's' ? 'ns-resize' : 'ew-resize'
      });
      h.dataset.handle = cls;
      div.appendChild(h);
    }
    layer.appendChild(div);
  }

  /* ------------------------------------------------------------ crop */

  function startCrop() {
    ed.tool = 'crop';
    const w = ed.view.width;
    const h = ed.view.height;
    ed.cropSel = { x: Math.round(w * 0.1), y: Math.round(h * 0.1), w: Math.round(w * 0.8), h: Math.round(h * 0.8) };
    ui.preview.classList.add('cropping');
    showCropBar();
    ui.canvas.style.cursor = 'crosshair';
    enableCropDrag();
    paint();
    setStatus('Drag the handles, then Apply');
  }

  function showCropBar() {
    $$('.ed-crop-bar').forEach((n) => n.remove());
    const bar = document.createElement('div');
    bar.className = 'ed-crop-bar';
    bar.innerHTML = `<button data-c="cancel">Cancel</button>
      <button data-c="free">Free</button>
      <button data-c="square">1:1</button>
      <button data-c="16:9">16:9</button>
      <button data-c="4:3">4:3</button>
      <button data-c="apply" class="primary">Apply crop</button>`;
    bar.addEventListener('click', (e) => {
      const c = e.target.dataset.c;
      if (!c) return;
      if (c === 'apply') applyCrop();
      else if (c === 'cancel') cancelCrop();
      else lockAspect(c);
    });
    ui.preview.appendChild(bar);
  }

  function lockAspect(kind) {
    if (!ed.cropSel) return;
    const s = ed.cropSel;
    let ratio = null;
    if (kind === 'square') ratio = 1;
    if (kind === '16:9') ratio = 16 / 9;
    if (kind === '4:3') ratio = 4 / 3;
    if (!ratio) { ed.aspect = null; return; }
    ed.aspect = ratio;
    s.h = Math.min(ed.view.height - s.y, Math.round(s.w / ratio));
    paint();
  }

  let cropDrag = null;
  function enableCropDrag() {
    const layer = overlayLayer('crop-layer');
    layer.style.pointerEvents = 'none';
    const onDown = (e) => {
      if (ed.tool !== 'crop' || !ed.cropSel) return;
      const rect = ui.canvas.getBoundingClientRect();
      const scale = ed.view.width / rect.width;
      const ox = (e.clientX - rect.left) * scale;
      const oy = (e.clientY - rect.top) * scale;
      const handle = e.target.dataset && e.target.dataset.handle;
      const inSel = ox >= ed.cropSel.x && ox <= ed.cropSel.x + ed.cropSel.w &&
                    oy >= ed.cropSel.y && oy <= ed.cropSel.y + ed.cropSel.h;
      if (!handle && !inSel) {
        ed.cropSel = { x: ox, y: oy, w: 1, h: 1 };
      }
      cropDrag = { handle, ox, oy, orig: { ...ed.cropSel }, start: { x: ox, y: oy } };
      e.preventDefault();
    };
    ui.preview.addEventListener('mousedown', onDown, true);
    window.addEventListener('mousemove', (e) => {
      if (!cropDrag || !ed.cropSel) return;
      const rect = ui.canvas.getBoundingClientRect();
      const scale = ed.view.width / rect.width;
      const px = (e.clientX - rect.left) * scale;
      const py = (e.clientY - rect.top) * scale;
      const o = cropDrag.orig;
      let r = { ...ed.cropSel };
      if (cropDrag.handle) {
        const min = 24;
        if (cropDrag.handle.includes('w')) { const nx = Math.min(px, o.x + o.w - min); r.w = o.x + o.w - nx; r.x = nx; }
        if (cropDrag.handle.includes('e')) r.w = Math.max(min, px - o.x);
        if (cropDrag.handle.includes('n')) { const ny = Math.min(py, o.y + o.h - min); r.h = o.y + o.h - ny; r.y = ny; }
        if (cropDrag.handle.includes('s')) r.h = Math.max(min, py - o.y);
        if (ed.aspect) r.h = Math.round(r.w / ed.aspect);
      } else if (cropDrag.handle === undefined && (o.w <= 1 || o.h <= 1 || !ed.cropSel.wasMoved)) {
        r = {
          x: Math.min(cropDrag.start.x, px),
          y: Math.min(cropDrag.start.y, py),
          w: Math.abs(px - cropDrag.start.x),
          h: Math.abs(py - cropDrag.start.y)
        };
        r.wasMoved = true;
      } else {
        r.x = o.x + (px - cropDrag.start.x);
        r.y = o.y + (py - cropDrag.start.y);
      }
      r.x = Math.max(0, Math.min(ed.view.width - 8, r.x));
      r.y = Math.max(0, Math.min(ed.view.height - 8, r.y));
      r.w = Math.max(8, Math.min(r.w, ed.view.width - r.x));
      r.h = Math.max(8, Math.min(r.h, ed.view.height - r.y));
      r.wasMoved = true;
      ed.cropSel = r;
      paint();
    });
    window.addEventListener('mouseup', () => { cropDrag = null; });
  }

  function applyCrop() {
    if (!ed.cropSel) return;
    const s = ed.cropSel;
    // crop selection is relative to the transformed (rotated) view — bake rotation first
    const baked = transformedBase();
    const c = document.createElement('canvas');
    c.width = Math.max(8, Math.round(s.w));
    c.height = Math.max(8, Math.round(s.h));
    const ctx = c.getContext('2d');
    ctx.drawImage(baked, Math.round(s.x), Math.round(s.y), Math.round(s.w), Math.round(s.h), 0, 0, c.width, c.height);
    ed.base = c;
    ed.rotate = 0;
    ed.flipH = false;
    ed.flipV = false;
    ed.crop = null;
    ed.workW = c.width;
    ed.workH = c.height;
    ed.mask = document.createElement('canvas');
    ed.mask.width = c.width;
    ed.mask.height = c.height;
    ed.maskCtx = ed.mask.getContext('2d');
    finishCrop();
    paint(true);
    window.LHUI.toast('Cropped — remember to save a copy');
  }

  function cancelCrop() {
    finishCrop();
    paint();
  }

  function finishCrop() {
    ed.tool = 'none';
    ed.cropSel = null;
    ui.preview.classList.remove('cropping');
    ui.canvas.style.cursor = '';
    $$('.ed-crop-bar').forEach((n) => n.remove());
    const layer = ui.preview.querySelector('.crop-layer');
    if (layer) layer.innerHTML = '';
    syncToolButtons();
  }

  /* Marks the Crop / Remove button of whichever tool is currently armed, so the
     toolbar says which one is listening rather than looking identical to idle. */
  function syncToolButtons() {
    $$('[data-ed]').forEach((b) => {
      const active = (b.dataset.ed === 'crop' && ed.tool === 'crop')
        || (b.dataset.ed === 'remove' && ed.tool === 'remove');
      b.classList.toggle('is-on', active);
    });
  }

  /* ------------------------------------------------------------ remove tool */

  function startRemoveTool() {
    if (!ed.base) return;
    ed.tool = 'remove';
    ui.preview.classList.add('cropping');
    ui.canvas.style.cursor = 'crosshair';
    if (!ui.preview.querySelector('.tool-pill')) {
      const pill = document.createElement('div');
      pill.className = 'tool-pill';
      pill.innerHTML = `<svg><use href="#i-eraser"/></svg>Remove — brush over what you want gone`;
      ui.preview.appendChild(pill);
    }
    $$('.ed-crop-bar').forEach((n) => n.remove());
    const bar = document.createElement('div');
    bar.className = 'ed-crop-bar';
    bar.innerHTML = `<button data-c="clear">Clear mask</button>
      <button data-c="done">Done</button>
      <button data-c="apply" class="primary">Remove &amp; blend</button>`;
    bar.addEventListener('click', (e) => {
      const c = e.target.dataset.c;
      if (c === 'clear') {
        ed.maskCtx.clearRect(0, 0, ed.mask.width, ed.mask.height);
        drawMaskOverlay();
      } else if (c === 'done') {
        endRemoveTool();
      } else if (c === 'apply') {
        applyRemove();
      }
    });
    ui.preview.appendChild(bar);
    setStatus('Brush the object, then Remove & blend');
    wireBrush();
  }

  function endRemoveTool() {
    ed.tool = 'none';
    ui.preview.classList.remove('cropping');
    ui.canvas.style.cursor = '';
    $$('.ed-crop-bar').forEach((n) => n.remove());
    const pill = ui.preview.querySelector('.tool-pill');
    if (pill) pill.remove();
    const layer = ui.preview.querySelector('.mask-layer');
    if (layer) layer.innerHTML = '';
    setStatus(ed.img ? ed.img.name : '');
  }

  let brushing = false;
  let lastPoint = null;
  function wireBrush() {
    const toBase = (e) => {
      const rect = ui.canvas.getBoundingClientRect();
      const scale = ed.view.width / rect.width;
      return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
    };
    const down = (e) => {
      if (ed.tool !== 'remove') return;
      brushing = true;
      lastPoint = toBase(e);
      strokeBrush(lastPoint, lastPoint);
      e.preventDefault();
    };
    const move = (e) => {
      if (!brushing || ed.tool !== 'remove') return;
      const p = toBase(e);
      strokeBrush(lastPoint, p);
      lastPoint = p;
      drawMaskOverlay();
    };
    const up = () => {
      if (!brushing) return;
      brushing = false;
      drawMaskOverlay();
    };
    ui.preview.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function strokeBrush(a, b) {
    const ctx = ed.maskCtx;
    if (!ctx) return;
    const radius = Math.max(6, Math.min(ed.mask.width, ed.mask.height) * 0.018);
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = radius * 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.x, b.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function applyRemove() {
    const maskCtx = ed.maskCtx;
    const mw = ed.mask.width;
    const mh = ed.mask.height;
    const md = maskCtx.getImageData(0, 0, mw, mh).data;
    let minX = mw, minY = mh, maxX = 0, maxY = 0, count = 0;
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        if (md[(y * mw + x) * 4 + 3] > 24) {
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!count) {
      window.LHUI.toast('Brush over something first', 'err');
      return;
    }

    setStatus('Blending edges…');
    const baseCtx = ed.base.getContext('2d', { willReadFrequently: true });
    const imgData = baseCtx.getImageData(0, 0, ed.base.width, ed.base.height);
    laplaceInpaint(imgData, md, mw, mh, { minX, minY, maxX, maxY });
    baseCtx.putImageData(imgData, 0, 0);

    maskCtx.clearRect(0, 0, mw, mh);
    endRemoveTool();
    paint();
    window.LHUI.toast('Object removed and blended');
  }

  /**
   * Harmonic (Laplace) inpainting — the discrete Poisson blend used by
   * professional healing tools: the masked region is replaced by the
   * solution of ∇²u = 0 with the surrounding pixels as the boundary.
   */
  function laplaceInpaint(imageData, maskData, mw, mh, box) {
    const W = imageData.width;
    const H = imageData.height;
    const data = imageData.data;
    const pad = 6;
    const x0 = Math.max(0, box.minX - pad);
    const y0 = Math.max(0, box.minY - pad);
    const x1 = Math.min(W - 1, box.maxX + pad);
    const y1 = Math.min(H - 1, box.maxY + pad);
    const rw = x1 - x0 + 1;
    const rh = y1 - y0 + 1;

    const R = new Float32Array(rw * rh);
    const G = new Float32Array(rw * rh);
    const B = new Float32Array(rw * rh);
    const known = new Uint8Array(rw * rh);
    const mask = new Uint8Array(rw * rh);

    const maskAt = (x, y) => {
      const mx = Math.min(mw - 1, Math.max(0, Math.round((x / W) * mw)));
      const my = Math.min(mh - 1, Math.max(0, Math.round((y / H) * mh)));
      return maskData[(my * mw + mx) * 4 + 3] > 24;
    };

    let any = false;
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const gi = (y * rw + x);
        const px = x0 + x;
        const py = y0 + y;
        const p = (py * W + px) * 4;
        R[gi] = data[p];
        G[gi] = data[p + 1];
        B[gi] = data[p + 2];
        const m = maskAt(px, py);
        mask[gi] = m ? 1 : 0;
        known[gi] = m ? 0 : 1;
        if (m) any = true;
      }
    }
    if (!any) return;

    // 1) initial guess: propagate boundary colour inward (fast BFS sweep)
    const queue = [];
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const gi = y * rw + x;
        if (!mask[gi]) continue;
        const n = neighborsKnown(x, y);
        if (n.count) {
          R[gi] = n.r / n.count;
          G[gi] = n.g / n.count;
          B[gi] = n.b / n.count;
          queue.push(gi);
        }
      }
    }
    function neighborsKnown(x, y) {
      let r = 0, g = 0, b = 0, c = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) continue;
        const ni = ny * rw + nx;
        if (!known[ni]) continue;
        r += R[ni]; g += G[ni]; b += B[ni]; c++;
      }
      return { r, g, b, count: c };
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const gi = queue[qi];
      const x = gi % rw;
      const y = (gi - x) / rw;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) continue;
        const ni = ny * rw + nx;
        if (mask[ni] && !known[ni] && !queued(ni)) {
          R[ni] = R[gi]; G[ni] = G[gi]; B[ni] = B[gi];
          known[ni] = 1;
          queue.push(ni);
        }
      }
      known[gi] = 1;
    }
    function queued() { return false; }

    // 2) Jacobi relaxation → harmonic (Poisson) fill
    const tmpR = new Float32Array(rw * rh);
    const tmpG = new Float32Array(rw * rh);
    const tmpB = new Float32Array(rw * rh);
    const iterations = Math.min(220, 40 + Math.round(Math.sqrt(rw * rh) / 2));
    for (let it = 0; it < iterations; it++) {
      tmpR.set(R); tmpG.set(G); tmpB.set(B);
      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          const gi = y * rw + x;
          if (!mask[gi]) continue;
          let r = 0, g = 0, b = 0, c = 0;
          if (x > 0) { const i2 = gi - 1; r += tmpR[i2]; g += tmpG[i2]; b += tmpB[i2]; c++; }
          if (x < rw - 1) { const i2 = gi + 1; r += tmpR[i2]; g += tmpG[i2]; b += tmpB[i2]; c++; }
          if (y > 0) { const i2 = gi - rw; r += tmpR[i2]; g += tmpG[i2]; b += tmpB[i2]; c++; }
          if (y < rh - 1) { const i2 = gi + rw; r += tmpR[i2]; g += tmpG[i2]; b += tmpB[i2]; c++; }
          if (c) { R[gi] = r / c; G[gi] = g / c; B[gi] = b / c; }
        }
      }
    }

    // 3) composite with a feathered alpha so the seam disappears
    const feather = 2.2;
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const gi = y * rw + x;
        if (!mask[gi]) continue;
        let dist = feather;
        for (let d = 1; d <= Math.ceil(feather); d++) {
          let boundary = false;
          for (let dy = -d; dy <= d && !boundary; dy++) {
            for (let dx = -d; dx <= d; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) { boundary = true; break; }
              if (!mask[ny * rw + nx]) { boundary = true; break; }
            }
          }
          if (boundary) { dist = d; break; }
        }
        const alpha = Math.min(1, dist / feather);
        const px = x0 + x;
        const py = y0 + y;
        const p = (py * W + px) * 4;
        data[p] = data[p] * (1 - alpha) + R[gi] * alpha;
        data[p + 1] = data[p + 1] * (1 - alpha) + G[gi] * alpha;
        data[p + 2] = data[p + 2] * (1 - alpha) + B[gi] * alpha;
      }
    }
  }

  /* ------------------------------------------------------------ export */

  async function saveCopy() {
    if (!ed.src) return;
    const t = transformedBase();
    if (!t) return;
    const out = document.createElement('canvas');
    out.width = t.width;
    out.height = t.height;
    const ctx = out.getContext('2d');
    ctx.filter = cssFilter();
    ctx.drawImage(t, 0, 0);
    ctx.filter = 'none';
    const temp = ed.adj.temperature / 100;
    const tint = ed.adj.tint / 100;
    if (Math.abs(temp) > 0.005) {
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = Math.min(0.55, Math.abs(temp) * 0.55);
      ctx.fillStyle = temp > 0 ? '#ff9a3c' : '#3c8bff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.restore();
    }
    if (Math.abs(tint) > 0.005) {
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = Math.min(0.45, Math.abs(tint) * 0.45);
      ctx.fillStyle = tint > 0 ? '#e04bd8' : '#3bd07a';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.restore();
    }

    const format = ui.format ? ui.format.value : 'jpeg';
    const quality = (ui.quality ? +ui.quality.value : 92) / 100;
    const mime = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise((resolve) => out.toBlob(resolve, mime, quality));
    const buf = new Uint8Array(await blob.arrayBuffer());
    const base = ed.img ? ed.img.base || 'Untitled' : 'Untitled';
    const ext = format === 'jpeg' ? 'jpg' : format;
    const res = await window.lh.image.save({
      filePath: null,
      data: buf,
      format,
      quality,
      suggestedName: `${base} (edited).${ext}`,
      useDialog: true
    });
    if (res.ok) {
      window.LHUI.toast('Saved — ' + res.path.split(/[\\/]/).pop());
      ed.dirty = false;
    } else if (!res.canceled) {
      window.LHUI.toast(res.error || 'Save failed', 'err');
    }
  }

  /* ------------------------------------------------------------ ui wiring */

  function syncSliders() {
    for (const key of ['brightness', 'contrast', 'saturation', 'temperature', 'tint', 'exposure']) {
      const input = $('#adj-' + key);
      if (!input) continue;
      input.value = ed.adj[key];
      const out = input.parentElement.querySelector('output');
      if (out) out.textContent = ed.adj[key];
      paintRange(input);
    }
  }

  function paintRange(input) {
    const min = +input.min || 0;
    const max = +input.max || 100;
    const pct = ((+input.value - min) / (max - min)) * 100;
    input.style.setProperty('--fill', pct + '%');
  }

  function wirePanel() {
    for (const key of ['brightness', 'contrast', 'saturation', 'temperature', 'tint', 'exposure']) {
      const input = $('#adj-' + key);
      if (!input) continue;
      input.addEventListener('input', () => {
        ed.adj[key] = +input.value;
        const out = input.parentElement.querySelector('output');
        if (out) out.textContent = input.value;
        paintRange(input);
        schedulePaint();
      });
    }

    $$('[data-ed]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmd = btn.dataset.ed;
        if (cmd === 'rotl') { ed.rotate = ((ed.rotate - 90) % 360 + 360) % 360; paint(true); }
        if (cmd === 'rotr') { ed.rotate = (ed.rotate + 90) % 360; paint(true); }
        if (cmd === 'fliph') { ed.flipH = !ed.flipH; paint(); }
        if (cmd === 'flipv') { ed.flipV = !ed.flipV; paint(); }
        if (cmd === 'reset') { resetAdjust(); }
        if (cmd === 'crop') { if (ed.tool === 'crop') cancelCrop(); else startCrop(); }
        if (cmd === 'resize') { resizeDialog(); }
        if (cmd === 'remove') { if (ed.tool === 'remove') cancelCrop(); else startRemoveTool(); }
        syncToolButtons();
      });
    });

    if (ui.quality) {
      ui.quality.addEventListener('input', () => {
        const out = ui.quality.parentElement.querySelector('output');
        if (out) out.textContent = ui.quality.value;
        paintRange(ui.quality);
      });
      paintRange(ui.quality);
    }

    $('#ed-reset').addEventListener('click', resetAdjust);
    $('#ed-save').addEventListener('click', saveCopy);

    // pan & zoom in the editor
    let drag = null;
    ui.preview.addEventListener('mousedown', (e) => {
      if (ed.tool !== 'none') return;
      drag = { x: e.clientX, y: e.clientY, px: ed.panX, py: ed.panY };
      ui.preview.classList.add('dragging');
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      ed.panX = drag.px + (e.clientX - drag.x);
      ed.panY = drag.py + (e.clientY - drag.y);
      applyCanvasTransform();
    });
    window.addEventListener('mouseup', () => {
      if (drag) { drag = null; ui.preview.classList.remove('dragging'); }
    });
    ui.preview.addEventListener('wheel', (e) => {
      if (ed.tool !== 'none') return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      const before = ed.zoom;
      ed.zoom = Math.min(8, Math.max(0.25, ed.zoom * factor));
      if (ed.zoom === before) return;
      applyCanvasTransform();
      if (ed.tool === 'remove') drawMaskOverlay();
      if (ed.tool === 'crop') drawCropOverlay();
    }, { passive: false });

    window.addEventListener('resize', () => {
      fitCanvas();
      if (ed.tool === 'remove') drawMaskOverlay();
      if (ed.tool === 'crop') drawCropOverlay();
    });
  }

  function resetAdjust() {
    ed.rotate = 0;
    ed.flipH = false;
    ed.flipV = false;
    ed.crop = null;
    ed.adj = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, exposure: 0 };
    ed.maskCtx && ed.maskCtx.clearRect(0, 0, ed.mask.width, ed.mask.height);
    rebuildBase();
    paint(true);
    syncSliders();
  }

  async function resizeDialog() {
    if (!ed.base) return;
    const val = await window.LHUI.promptDialog('Resize image', 'Width in pixels — height follows the aspect ratio.', String(ed.base.width), { okLabel: 'Resize' });
    if (val === null) return;
    const target = Math.max(16, Math.min(12000, Math.round(+val || ed.base.width)));
    const ratio = ed.base.height / ed.base.width;
    const height = Math.max(1, Math.round(target * ratio));
    const t = transformedBase();
    const c = document.createElement('canvas');
    c.width = target;
    c.height = height;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(t, 0, 0, target, height);
    ed.base = c;
    ed.rotate = 0;
    ed.flipH = false;
    ed.flipV = false;
    ed.workW = target;
    ed.workH = height;
    ed.mask = document.createElement('canvas');
    ed.mask.width = target;
    ed.mask.height = height;
    ed.maskCtx = ed.mask.getContext('2d');
    paint(true);
    window.LHUI.toast(`Resized to ${target} × ${height}`);
  }

  window.LehtratuhEditor = {
    open: async (img) => {
      cacheUi();
      if (!ui.panel.dataset.wired) {
        wirePanel();
        ui.panel.dataset.wired = '1';
      }
      await open(img);
      fitCanvas();
    },
    close,
    startRemoveTool: () => {
      if (ed.tool !== 'remove') startRemoveTool();
    },
    isOpen: () => ui.panel && !ui.panel.hidden
  };
})();
