# Lehtratuh

**A Fluent Photo Gallery, Editor and Viewer for Windows 11.**

Lehtratuh is a photo viewer that opens instantly, looks like it belongs in Windows 11,
and lets you actually edit what you are looking at — crop, rotate, resize, auto-adjust
and remove objects — without uploading anything anywhere.

Everything runs on your own PC.

---

## Screenshots 

<img width="1919" height="1079" alt="Screenshot 2026-11-02 130117" src="https://github.com/user-attachments/assets/33371468-7357-4c9c-88a3-924a1d6364d3" />
<img width="1919" height="1079" alt="Screenshot 2026-11-02 130112" src="https://github.com/user-attachments/assets/e86f6e65-ab42-493e-ab61-5bfe6e5291c6" />
<img width="1919" height="1079" alt="Screenshot 2026-11-02 130107" src="https://github.com/user-attachments/assets/1db994b0-2bde-4f8b-b4ee-41978119bf97" />
<img width="1919" height="1079" alt="Screenshot 2026-11-02 130045" src="https://github.com/user-attachments/assets/b4efde7f-47fd-42e7-a9d6-a832bbeb8b3a" />
<img width="1919" height="1079" alt="Screenshot 2026-11-02 130036" src="https://github.com/user-attachments/assets/63fee233-9e2c-46a1-8ebd-247e22dfe884" />
<img width="1919" height="1079" alt="Screenshot 2026-11-02 130028" src="https://github.com/user-attachments/assets/029f2ced-8a66-4006-9375-7e6cc5e13c18" />
<img width="1919" height="1079" alt="Screenshot 2026-11-02 130013" src="https://github.com/user-attachments/assets/81088e9a-d6bd-4dac-9411-7308e6327077" />

---

## Install

1. Download **`Lehtratuh-Setup-1.5.0.exe`**.
2. Run it. Windows will ask for administrator permission, because the installer
   registers Lehtratuh as an image viewer for the whole machine.
3. Pick a folder, or keep the default. Done.

Windows 11 and Windows 10 (64-bit) are supported.

**Uninstall** any time from *Settings → Apps → Installed apps → Lehtratuh*. Your photos
are never touched.

---

## What it does

**A real gallery.** Seven ways to look at a folder — Cards, Carousel, Collage,
Thumbnails, Tiles, Details and Grid — with folder grouping, search and sorting.
It reads the folder directly from disk, so there is no import step and no database
to go stale.

**A viewer that gets out of the way.** Arrow keys to move, `F` to fit, `Ctrl` `+`/`-`
to zoom, `I` for file details, `F11` for fullscreen. The filmstrip and the info pane
are both optional.

**An editor with the tools you actually use.**

| Tool | What it does |
| --- | --- |
| Crop | Free, square or fixed ratios |
| Rotate / flip | 90° steps, or mirror |
| Resize | Pixel dimensions, with aspect lock |
| Auto adjust | Brightness, contrast, saturation |
| Remove | Content-aware fill for small objects |

Edit a copy, or write straight back over the original — your choice, every time.
Nothing is saved until you press the check.

**Windows 11 done properly.** Mica and Acrylic materials, rounded corners, real
system accent colour, light and dark themes, and a title bar that behaves.

---

## Opening photos from Explorer

The installer adds Lehtratuh to **Open with** for JPG, JPEG, PNG, GIF, BMP, WebP,
TIFF, ICO, AVIF, HEIC and JPEG XL. Right-click any photo → *Open with* →
*Lehtratuh*.

The photo opens straight in the viewer, and **the rest of its folder comes with
it** — Next and Previous walk the other images beside it, exactly like Windows
Photo Viewer, with the filmstrip along the bottom.

There is a second verb too: *Edit in Lehtratuh* opens the photo directly in the
editor.

It is not forced as your default viewer — that stays your choice. To make it the
default, use *Windows Settings → Apps → Default apps → Lehtratuh*.

---

## Formats

**Full support** — JPG, PNG, GIF, BMP, WebP, ICO, SVG, TGA, QOI, PNM, HDR

**View only** (these display but cannot be re-encoded in-app — use the editor's
*Save a copy* instead) — AVIF, HEIC, HEIF, JPEG XL, TIFF

**RAW preview** — CR2, CR3, NEF, ARW, DNG, ORF, RW2, RAF, PEF, SRW and more

---

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `←` `→` | Previous / next photo |
| `Ctrl` `O` | Open a photo |
| `Ctrl` `,` | Settings |
| `Ctrl` `E` | Auto adjust |
| `Ctrl` `.` / `Ctrl` `/` | Rotate right / left |
| `Ctrl` `R` | Crop |
| `Ctrl` `Z` / `Ctrl` `Y` | Undo / redo |
| `F2` | Rename |
| `Delete` | Move to Recycle Bin |
| `F11` | Fullscreen |

---

## Support this project

Lehtratuh is free, open source, and has no ads, no telemetry and no paid tier.
It is built by one person.

If it earned a place on your taskbar, you can buy me a coffee:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/N7D7292WUD)

Every contribution goes straight back into the app.

---

## Building from source

Requires Node.js 20+ and, on Windows, the standard build tools.

```bash
npm install
npm start          # run it
npm run icons      # regenerate src/icons.js after editing scripts/make-icons.js
npm run dist       # build the installer into ../dist
```

`npm run dist` is usually run on Windows. Cross-building from Linux works but
needs Wine with 32-bit support, because the NSIS uninstaller is a 32-bit binary.

See [CONTRIBUTING.md](CONTRIBUTING.md) before sending a change, and
[CHANGELOG.md](CHANGELOG.md) for what changed in each release.

---

## License

GNU General Public License v3.0 or later. See [LICENSE](LICENSE).

You are free to use, study, share and modify Lehtratuh. If you distribute a
modified version, it has to stay under the same licence.

---

## Credits

Created by **Mr Knight** — [iamkrisstan2000.github.io](https://iamkrisstan2000.github.io/#about)

Built with Electron. Made possible with AI.

November 2026
