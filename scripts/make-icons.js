// Generates src/icons.js — an inline SVG sprite built from Fluent System Icons.
const fs = require('fs');
const path = require('path');

const iconDir = path.join(__dirname, '..', 'node_modules', '@fluentui', 'svg-icons', 'icons');
const out = path.join(__dirname, '..', 'src', 'icons.js');

// key -> candidate file names (first existing wins)
const ICONS = {
  home: ['home_20_regular', 'home_24_regular'],
  folder: ['folder_20_regular'],
  folder_open: ['folder_open_20_regular'],
  image: ['image_20_regular'],
  image_add: ['image_add_20_regular'],
  image_multiple: ['image_multiple_20_regular'],
  image_edit: ['image_edit_20_regular'],
  image_sparkle: ['image_sparkle_20_regular'],
  // Photo editor: a picture with a pencil on it, not a paintbrush. The brush
  // reads as "paint", which is the wrong promise for a photo tool.
  image_pencil: ['draw_image_20_regular', 'image_edit_20_regular'],
  // Apply: commits the adjustment being previewed to the file on disk.
  check: ['checkmark_20_regular'],
  save: ['save_20_regular'],
  save_as: ['save_edit_20_regular', 'document_save_20_regular', 'save_copy_20_regular', 'save_20_regular'],
  undo: ['arrow_undo_20_regular'],
  redo: ['arrow_redo_20_regular'],
  zoom_in: ['zoom_in_20_regular'],
  zoom_out: ['zoom_out_20_regular'],
  zoom_fit: ['arrow_fit_20_regular', 'arrow_fit_in_20_regular', 'fit_page_20_regular'],
  one_to_one: ['aspect_ratio_20_regular'],
  rotate_left: ['arrow_counterclockwise_20_regular'],
  rotate_right: ['arrow_clockwise_20_regular'],
  flip_h: ['flip_horizontal_20_regular'],
  flip_v: ['flip_vertical_20_regular'],
  crop: ['crop_20_regular'],
  resize: ['resize_20_regular', 'arrow_autofit_width_20_regular', 'slide_size_20_regular'],
  wand: ['wand_20_regular', 'magic_wand_20_regular', 'sparkle_20_regular'],
  eraser: ['eraser_20_regular'],
  delete: ['delete_20_regular'],
  settings: ['settings_20_regular'],
  dismiss: ['dismiss_20_regular'],
  arrow_left: ['arrow_left_20_regular'],
  arrow_right: ['arrow_right_20_regular'],
  arrow_up: ['arrow_up_20_regular'],
  chevron_down: ['chevron_down_20_regular'],
  chevron_up: ['chevron_up_20_regular'],
  chevron_left: ['chevron_left_20_regular'],
  chevron_right: ['chevron_right_20_regular'],
  search: ['search_20_regular'],
  square_multiple: ['square_multiple_20_regular'],
  grid: ['grid_20_regular'],
  apps_list_detail: ['apps_list_detail_20_regular'],
  text_bullet: ['text_bullet_list_square_20_regular', 'text_bullet_list_20_regular'],
  apps: ['apps_20_regular'],
  more: ['more_horizontal_20_regular'],
  checkmark: ['checkmark_20_regular'],
  subtract: ['subtract_20_regular'],
  square: ['square_20_regular'],
  restore: ['square_multiple_20_regular'],
  fullscreen: ['full_screen_maximize_20_regular', 'arrow_maximize_20_regular'],
  info: ['info_20_regular'],
  warning: ['warning_20_regular'],
  error: ['error_circle_20_regular'],
  check_circle: ['checkmark_circle_20_regular'],
  color: ['color_20_regular'],
  dark: ['weather_moon_20_regular'],
  light: ['weather_sunny_20_regular'],
  system: ['desktop_20_regular'],
  book: ['book_20_regular', 'library_20_regular'],
  appearance: ['paint_brush_20_regular'],
  open_folder: ['folder_open_20_regular'],
  copy: ['copy_20_regular'],
  rename: ['rename_20_regular', 'text_edit_20_regular'],
  sparkle: ['sparkle_20_regular'],
  eye: ['eye_20_regular'],
  play: ['play_20_regular'],
  slideshow: ['slide_play_20_regular', 'slide_multiple_20_regular'],
  sort: ['arrow_sort_20_regular'],
  group: ['folder_list_20_regular', 'folder_20_regular'],
  drive: ['hard_drive_20_regular'],
  options: ['options_20_regular'],
  history: ['history_20_regular'],
  pin: ['pin_20_regular'],
  link: ['link_20_regular'],
  layer: ['layer_20_regular'],
  arrow_download: ['arrow_download_20_regular'],
  arrow_upload: ['arrow_upload_20_regular'],
  clipboard: ['clipboard_20_regular'],
  image_off: ['image_off_20_regular'],
  paint: ['paint_brush_20_regular'],
  circle: ['circle_20_regular'],
  arrow_sync: ['arrow_sync_20_regular'],
  star: ['star_20_regular'],
  globe: ['globe_20_regular'],
  window: ['window_20_regular'],
  arrow_clockwise: ['arrow_clockwise_20_regular'],
  broom: ['broom_20_regular'],
  cursor: ['cursor_20_regular'],
  text: ['text_case_20_regular'],
  color_fill: ['color_fill_20_regular'],
  target: ['target_20_regular'],
  selection: ['select_object_20_regular', 'selection_20_regular'],
  dialpad: ['dialpad_20_regular']
};

function load(name) {
  const p = path.join(iconDir, name + '.svg');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function toSymbol(key, svg, id) {
  const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 20 20';
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '').trim();
  return `<symbol id="i-${key}" viewBox="${vb}">${inner}</symbol>`;
}

let sprite = '';
const missing = [];
const found = [];
for (const [key, names] of Object.entries(ICONS)) {
  let done = false;
  for (const n of names) {
    const svg = load(n);
    if (svg) {
      sprite += toSymbol(key, svg) + '\n';
      found.push(`${key}=${n}`);
      done = true;
      break;
    }
  }
  if (!done) missing.push(key);
}

// ---- hand-drawn fluent-style glyphs for window chrome / misc ----
const chrome = `
<symbol id="i-chrome_min" viewBox="0 0 20 20"><path d="M4 10.5h12" stroke="currentColor" stroke-width="1.1" fill="none" stroke-linecap="round"/></symbol>
<symbol id="i-chrome_max" viewBox="0 0 20 20"><rect x="4.5" y="4.5" width="11" height="11" rx="1.6" stroke="currentColor" stroke-width="1.1" fill="none"/></symbol>
<symbol id="i-chrome_restore" viewBox="0 0 20 20"><rect x="4.2" y="6.2" width="9.4" height="9.4" rx="1.5" stroke="currentColor" stroke-width="1.1" fill="none"/><path d="M7.2 6.2V5.6A1.4 1.4 0 0 1 8.6 4.2h5.8a1.4 1.4 0 0 1 1.4 1.4v5.8a1.4 1.4 0 0 1-1.4 1.4h-.6" stroke="currentColor" stroke-width="1.1" fill="none"/></symbol>
<symbol id="i-chrome_close" viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.1" fill="none" stroke-linecap="round"/></symbol>
<symbol id="i-brush" viewBox="0 0 20 20"><path d="M12.6 3.6a1.6 1.6 0 0 1 2.3 0l1.5 1.5a1.6 1.6 0 0 1 0 2.3l-7 7-3.8 1.2 1.2-3.8z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M4 16.4c1.2-.2 2-.5 2.4-1" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/></symbol>
<symbol id="i-aperture" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10 2.8l3.4 6M14.8 5.6L8.2 9M17.2 10h-6.8M15 14.6L11.4 8.4M10 17.2L6.6 11.2M5.2 14.4l6.6-3.4M2.8 10h6.8M5 5.4l3.6 6.2" stroke="currentColor" stroke-width="1.05" fill="none" stroke-linecap="round"/></symbol>
<symbol id="i-acrylic" viewBox="0 0 20 20"><rect x="2.8" y="3.6" width="14.4" height="12.8" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.15"/><path d="M2.8 11.4l4.2-4.2 3.6 3.6 3-3 3.6 3.6" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><circle cx="7.1" cy="7.1" r="1.15" fill="currentColor"/></symbol>
<symbol id="i-ratio_free" viewBox="0 0 20 20"><rect x="3.5" y="5.5" width="13" height="9" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/></symbol>
<symbol id="i-mask" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2.4 2"/><circle cx="10" cy="10" r="2.2" fill="currentColor" opacity=".55"/></symbol>
<symbol id="i-reset" viewBox="0 0 20 20"><path d="M4.2 10a5.8 5.8 0 1 0 1.9-4.3" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><path d="M3.2 4.1v3.4h3.4" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="i-chevron_min" viewBox="0 0 20 20"><path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></symbol>
`;

const js = `/* Auto-generated Fluent System Icons sprite. Do not edit by hand. */\nwindow.ICONS_SPRITE = ${JSON.stringify(sprite + chrome)};\n`;
fs.writeFileSync(out, js);
console.log(`icons.js written — ${found.length} fluent glyphs, missing: ${missing.join(', ') || 'none'}`);
