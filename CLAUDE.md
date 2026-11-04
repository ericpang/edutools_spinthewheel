# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Spin The Wheel is a classroom random picker: the teacher uploads one class photo, the app finds every face in the browser and turns each into a wheel segment, and clicking the selected segment makes that face pop out enlarged. Version 1 is built (all P0 items, most P1) and tested in Chrome and Edge.

- `README.md` is the spec and the source of truth for behaviour and numbers. Section 13 says what is built and what is not; section 15 lists decisions that are still open (previews from the wheel, names, saved classes, telemetry, phone-to-computer transfer). Don't pick an answer silently; ask or flag it.
- `vendor/README.md` records the source, licence and SHA-256 of the vendored MediaPipe runtime and model.

## Commands

There is no build, no `package.json` and no `npm install`.

- **Run:** serve the folder over HTTP, for example `node tests/e2e/serve.mjs 8080` or `python -m http.server 8080`, then open `http://localhost:8080`. `file://` does not work (ES modules, WebAssembly).
- **Unit tests:** `node --test "tests/*.test.js"` (Node 22+; keep the quotes, a bare folder name is treated as a file). One file: `node --test tests/core.test.js`; one test: add `--test-name-pattern "text"`. Or open `/tests/` in the browser. A new test file must also be imported in `tests/run-browser.js`.
- **End to end:** `node tests/e2e/run.mjs --photo <photo with faces> [--only text] [--slow] [--shots dir]` drives Chrome or Edge over the DevTools protocol (no dependencies). The photo is not in the repo; use one you may use, never real students' photos.

## Constraints decided by the owner

- App code is plain HTML, CSS and JavaScript (ES modules): no framework, bundler, transpiler or TypeScript, nothing that needs `npm install` to run. The vendored WebAssembly runtime and model are the accepted exception.
- The wheel spins only from the SPIN button; a click elsewhere on the wheel must do nothing. The pop-out opens when the user clicks the selected segment (an Enlarge button is the keyboard and touch route), never automatically.
- At most 50 faces on the wheel. A spin is exactly 3 full rounds plus the landing offset. Sounds are on by default (cute Web Audio tones, a Sound button mutes them).

## Architecture

- **Layers.** `js/core/` is pure logic with no DOM (unit-tested in Node). `js/state.js` is the store and every action, also DOM-free. `js/ui/*` modules subscribe to the store and call actions; they never call each other. `js/media/` and `js/detection/` do the DOM-based image work and the search.
- **Store rules.** Subscribers get `(state, prev)` and compare by reference, so change state only through `set()` and keep an object's reference when nothing changed (that is why a restart reuses the same `settings`). Never call an action from inside a subscriber that other subscribers also depend on: `finishSpin()` runs from the animation frame loop for that reason.
- **Detection (the part that needs reading several files).** The model takes 128 px input and is built for prominent faces, so `detection/search.js` cuts overlapping tiles at several scales. Tile edges follow a fixed ladder (94 px x 2^n); the overlap is 35% because a level covers faces up to 34% of its tile and a face cut by an edge in both neighbours is discarded; tiles are cut from a pyramid of halved copies (`media/photo.js`) because downscaling a big canvas with `medium` or `high` smoothing costs about 30 ms a tile, against about 4 ms from the right level. Merging keeps the best box and drops the lower-scoring one when the smaller of two overlapping boxes is mostly inside the larger. Raw detections are cached per level, so a sensitivity change only pays for new levels.
- **Wheel.** `wheel-view.js` paints segments and thumbnails once into an offscreen layer and only rotates it per frame. The winner is drawn first (`core/spin.js`, `planSpin`) and the animation derived from it. The wheel's faces are fixed at spin time (`wheel.poolIds`), so "remove picked" cannot rearrange the wheel under the pointer. `sound.prime()` must be called from a click.
- **Images.** The wheel and roster use 256 px thumbnails; the pop-out cuts a full-resolution crop from the working copy (`photo.canvas`). No AI upscaling.

## Privacy rules that constrain code

- Photos, crops and labels never leave the browser. No CDN or third-party requests; detector files are self-hosted. Only settings and a "notice seen" flag go in `localStorage`; no student data in storage, URLs or caches, and no export of face images. Never commit real students' photos.
- The CSP (a `<meta>` tag in `index.html`) must keep `connect-src 'self'`: MediaPipe's runtime tries to post usage metrics to `odml.pa.googleapis.com` every 60 seconds, and the CSP is what blocks it. The console messages about that are expected and harmless.
- The CSP also has `style-src 'self'`, so no inline `style=""` attributes or `setAttribute('style', ...)`: use classes, or the CSSOM (`el.style.x = ...`, `style.setProperty`).
- Detection only: no recognition, embeddings or attribute inference.

## Editing notes

- `vendor/` and `models/` are copied in unchanged; update them with the procedure in `vendor/README.md`. `.gitattributes` stops line-ending conversion so the recorded checksums stay valid.
- The same numbers appear in several README sections (the 50-face cap is in about a dozen); grep for a number before changing it. Requirement IDs (UP-, FD-, RV-, WH-, PO-, RS-, ST-, PS-, AC-) are cross-referenced, so keep them stable. The README wireframes are fixed-width ASCII: every line in a block must stay the same length. Headings are numbered and links use GitHub slugs, so re-check links after renaming one.
- All UI text lives in `js/strings.js`; static HTML text uses `data-t` attributes.
- In e2e runs, headless Chrome here reports `prefers-reduced-motion: reduce`, so set it explicitly (`emulateMedia`) for any motion test; synthetic key events need virtual key codes (see `tests/e2e/cdp.mjs`).
