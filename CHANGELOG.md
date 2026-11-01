# Changelog

All notable changes to Lehtratuh are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] — 2026-11-01

The first public release.

### Added

- **Seven library layouts** — Cards, Carousel, Collage, Thumbnails, Tiles,
  Details and Grid, with folder grouping, search and seven sort orders.
- **Photo viewer** — arrow-key navigation, fit/actual size, zoom, filmstrip,
  file info pane and a fullscreen mode.
- **Photo editor** — crop (free, square, fixed ratios), rotate and flip, resize,
  auto adjust (brightness, contrast, saturation) and a content-aware remove tool.
  Edits can be saved as a copy or written back over the original.
- **Windows 11 materials** — Mica and Acrylic window backdrops, rounded corners,
  light and dark themes, and live system accent colour sync. Lite is used
  automatically on machines that cannot render a backdrop.
- **Separate Settings window** — its own native window with library, appearance
  and about tabs. Changes apply to the open library immediately.
- **Windows shell integration** — registers as an "Open with" handler for JPG,
  PNG, GIF, BMP, WebP, TIFF, AVIF, HEIC and JPEG XL, with an App Paths entry and
  a taskbar jump list.
- **Installer** — per-machine NSIS setup with a custom install location, Desktop
  and Start Menu shortcuts, and a standard uninstaller.

### Known limitations

- AVIF, HEIC, HEIF, JPEG XL and TIFF can be viewed but not re-encoded in the
  viewer. Rotate, flip and auto adjust are disabled for these formats and explain
  why in their tooltip; the editor's rotate and *Save a copy* still work.
- RAW files show an embedded preview rather than a decoded image.
- Windows 10 and 11, 64-bit only.

[1.0.0]: https://github.com/iamkrisstan2000/Lehtratuh/releases/tag/v1.0.0
