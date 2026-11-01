# Contributing to Lehtratuh

Thanks for taking the time to look. Lehtratuh is a small, single-maintainer
project, so a few ground rules keep it manageable.

## Reporting a bug

Open an issue and include:

- What you did, what you expected, and what actually happened.
- Your Windows version and build number (`winver`).
- Whether the problem happens in Acrylic, Mica and Lite, or only one.
- A screenshot if it is visual. Window-chrome bugs are almost impossible to
  diagnose from a description alone.

Please check the existing issues first — most of what gets reported is already
known and listed under known limitations in the [CHANGELOG](CHANGELOG.md).

## Suggesting a feature

Open an issue describing the problem you are trying to solve rather than the
solution you have in mind. It is much easier to find the right way to fix the
underlying problem than to argue about a specific implementation.

## Submitting code

1. Fork the repository and branch from `main`.
2. Keep the change focused — one concern per pull request.
3. Match the surrounding style. The source is heavily commented on purpose;
   comments explain *why* a thing is done, not *what* the line does. Please keep
   that convention.
4. Run `npm start` and test the change in light and dark mode before opening the
   pull request.

### Things to be careful with

- **`src/icons.js` is generated.** Do not edit it by hand. Add the icon to the
  `ICONS` map in `scripts/make-icons.js` and run `npm run icons`.
- **Window chrome is fragile.** The frameless window, the DWM backdrop and the
  corner radius interact in ways that are easy to break and hard to see. Read the
  comments in `main.js` around `createWindow()` before changing anything there.
- **The two windows share state through the main process**, not through each
  other. Settings writes go through `settings:save` and are broadcast from there.

## Licence

By contributing you agree that your work is released under the
[GNU General Public License v3.0 or later](LICENSE).
