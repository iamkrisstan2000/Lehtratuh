# Changelog

All notable changes to Lehtratuh are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.5.0] — 2026-11-02

The first public release. Lehtratuh installs as a real Windows application and
registers itself as an image viewer, so photos open straight from Explorer.

### Added

- **Open with Lehtratuh.** Double-click a photo, or pick Lehtratuh from the
  Open with menu, and it opens directly in the viewer — not the library.
- **The whole folder comes with it.** The viewer lists every image beside the
  opened photo, so Next and Previous walk the folder the way Windows Photo
  Viewer does. The filmstrip fills with the same set and the counter reads
  `3 / 11` rather than `1 / 1`.
- **Edit in Lehtratuh** as a second Explorer verb, opening the photo straight
  into the editor.
- File type registration for JPEG, PNG, GIF, BMP, WebP, TIFF, ICO, AVIF, HEIC
  and JXL.
- Seven library views — Tiles, Cards, Carousel, Collage, Thumbnails, Details and
  Grid — with sorting by name, date or size.
- A photo editor with crop, resize, rotate, flip and live brightness, contrast,
  exposure, saturation, temperature and tint.
- Mica, Acrylic and Solid window materials, following the Windows accent colour.
- A portable build alongside the installer, for running without installation.

### Fixed

- A photo opened from Explorer showed as the only photo, with no way to reach
  the others in its folder.
- Opening a second photo while Lehtratuh was already running did nothing but
  focus the window, because the incoming file was never read.
- The sort button always read "Date added", whatever order was chosen.
- Closing the editor left the window dimmed until the app restarted.
- Maximised and snapped windows kept a rounded corner and a visible outline.

### Notes

- Windows 11 and Windows 10, 64-bit.
- Versions 1.1.2, 1.1.3 and 1.1.4 were internal builds and were never published.
  Their changes are included in 1.5.0.

---

[1.5.0]: https://github.com/iamkrisstan2000/Lehtratuh/releases/tag/v1.5.0
