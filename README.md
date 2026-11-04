# Spin The Wheel

> **A face-powered random picker for the classroom.** Upload one photo of the class and the app finds every student's face and turns each one into a segment of a spinning wheel. Spin it, then click the selected segment to make that student's face pop out at full size, even when the wheel is so crowded that each face is only a few pixels wide.

| | |
|---|---|
| **Status** | Version 1 is built: every P0 item and most P1 items (see [section 13](#13-milestones)), tested in Chrome and Edge. The detector's WebAssembly runtime and model file are vendored (see [vendor/README.md](vendor/README.md)). |
| **Last updated** | 2026-11-04 |
| **Technology** | Plain HTML, CSS and JavaScript. Runs entirely in the browser: no backend, no framework, no build step. |

## Contents

1. [Overview](#1-overview)
2. [The teacher's flow](#2-the-teachers-flow)
3. [Screens](#3-screens)
4. [Functional requirements](#4-functional-requirements)
5. [Face extraction](#5-face-extraction)
6. [The wheel and the pop-out](#6-the-wheel-and-the-pop-out)
7. [Privacy and safety](#7-privacy-and-safety)
8. [Accessibility and fairness](#8-accessibility-and-fairness)
9. [Non-functional requirements](#9-non-functional-requirements)
10. [Architecture and technology](#10-architecture-and-technology)
11. [Edge cases](#11-edge-cases)
12. [Testing and acceptance criteria](#12-testing-and-acceptance-criteria)
13. [Milestones](#13-milestones)
14. [Risks](#14-risks)
15. [Open questions](#15-open-questions)

---

## 1. Overview

Most spin-the-wheel tools make the teacher type every name into a list. This one starts from something the teacher already has: a photo of the class.

Two ideas make it different:

1. **Photo to wheel.** Upload one class photo. The app detects and crops every face in the browser, and each face becomes one segment of the wheel.
2. **Pop-out for small faces.** In a class of 30 or more, each segment is thin and the face on it is tiny. When the wheel stops, the teacher clicks the **selected segment** and that student's face **pops out** at a large size.

### Terminology

| Term | Meaning |
|---|---|
| Class photo | The image the teacher uploads. |
| Working copy | The decoded class photo (at most 25 megapixels) used for detection and cropping. |
| Face | One detected, or manually added, region of the photo that contains a student's face. |
| Crop | A square, padded image cut from the photo for one face. |
| Segment | One wedge of the wheel. There is one per included face. |
| Selected segment | The segment under the pointer when the wheel stops after a spin. |
| Pop-out | The enlarged view of the selected segment's face. |
| Small face | A face whose detection box is shorter than 48 px (on its shorter side) in the working copy. |

### Goals

- **No typing.** From a photo to a spinning wheel in about a minute, including the quick review.
- **Works for full-size classes.** Up to 50 faces on one wheel, tuned for 10 to 40.
- **Private by design.** Photos and faces never leave the device.
- **Fair.** Every student on the wheel has exactly the same chance.
- **Classroom-ready.** Readable from the back of the room on a projector; works with mouse, touch and keyboard.
- **Simple to build and host.** Plain HTML, CSS and JavaScript, served as static files.

### Non-goals (version 1)

- Face *recognition*. No identifying people, no matching faces to names, no attendance, no face embeddings, no age, gender or emotion estimation. The app only finds *where* faces are.
- Accounts, cloud sync, sharing, or any server-side storage of photos.
- Live camera or video input.
- Downloading or exporting face images.
- AI "enhancement" of small faces. A small face is shown as it is, enlarged with smooth scaling. The app never invents detail.

---

## 2. The teacher's flow

1. **Upload** a class photo (drag and drop, file picker, paste, or the phone camera).
2. **Detect.** The app scans the photo and shows progress. Faces appear as numbered boxes.
3. **Review.** Remove false detections, add any missed face by drawing a box, optionally type names, and switch off anyone who is absent.
4. **Build the wheel.** One segment per included face.
5. **Spin.** One click. The wheel slows down and stops on one segment: the selected segment, highlighted under the pointer.
6. **Click the selected segment.** Its face pops out at full size over the wheel.
7. **Close** the pop-out and spin again, or go back and edit faces.

---

## 3. Screens

The sketches below show layout only, not final visuals.

### 3.1 Upload

A large drop zone ("Drop a class photo here, or choose a file"), a **Choose a photo** button (camera or library on phones) and a paste hint. Under it:

- A one-line privacy statement: *Your photo never leaves this device.*
- Photo tips:
  - Shoot straight on with every face visible. Two or three rows work better than five.
  - Use the camera's highest resolution. Faces should be at least about 50 px wide in the photo.
  - Light the faces evenly and avoid a bright window behind the class.
  - For a big class, take several photos (for example one per table) and add them one by one (P1).
- On the very first visit only, the notice described in [section 7](#7-privacy-and-safety).

### 3.2 Review faces

```
+--------------------------------------------------------------------------+
| 1 Upload  >  2 Review faces  >  3 Spin                    [ Start over ] |
+----------------------------------------+---------------------------------+
| Class photo (zoom: scroll, pan: drag)  | 34 faces found, 31 included     |
| +------------------------------------+ | Sensitivity  [--o----]  Normal  |
| | [1] [2] [3]    [4] [5]    [6]      | | Expected students  [ 32 ]       |
| |   [7] [8]  [9]  [10] [11]          | | ! 31 of 32 - add missing ones   |
| |  [12] [13]   [14]   [15]           | |                                 |
| |          . . .                     | | +------+ +------+ +------+      |
| |                                    | | | face | | face | | face |      |
| +------------------------------------+ | | [x]1 | | [x]2 | | [ ]3 |      |
| [+ Add missing face]  [-] [+] [Fit]    | +------+ +------+ +------+      |
|                                        | Label  [ optional name      ]   |
+----------------------------------------+---------------------------------+
|                                           [ Build the wheel (31 faces) ] |
+--------------------------------------------------------------------------+
```

- Boxes on the photo are styled by status (included, switched off, small face, added by hand) using line style and an icon as well as colour.
- Each card shows the crop, its number, an include checkbox, a delete button and an optional name field.
- **Build the wheel** stays disabled until at least 2 faces are included.
- At most 50 faces can be included. Once 50 are, the include checkbox of every other face is disabled, with the tooltip "The wheel is full. Switch another face off first."

### 3.3 Wheel

```
+--------------------------------------------------------------------------+
| Period 3 Biology                       [ Edit faces ] [ Settings ] [ ? ] |
+----------------------------------------------+---------------------------+
|                       V                      | Students (31)             |
|                    .-----.                   | [x] (o) #1                |
|                 .-'       '-.                | [x] (o) #2    picked      |
|              .-'\           /'-.             | [ ] (o) #3    absent      |
|            .'    \   [O]   /    '.           | [x] (o) #4                |
|           /        \     /        \          | [x] (o) #5                |
|          |    o     \   /     o    |         | [x] (o) #6                |
|          |           \ /           |         | [x] (o) #7                |
|          |--------( SPIN! )--------|         | ...                       |
|          |           / \           |         |                           |
|          |    o     /   \     o    |         |                           |
|           \        /     \        /          |                           |
|            '.    /    o    \    .'           |                           |
|              '-./           \.-'             |                           |
|                 '-.       .-'                |                           |
|                    '-----'                   |                           |
|                                              |                           |
| Selected: #17   [ Enlarge ]                  | [ Reset picks ]           |
| (click the highlighted segment)              |                           |
+----------------------------------------------+---------------------------+
```

- The pointer is fixed at 12 o'clock and the SPIN button sits in the hub.
- After a stop, the selected segment is outlined and lifted, the other segments are dimmed, and the result bar offers **Enlarge**.
- On narrow screens the roster moves into a drawer under the wheel.

### 3.4 Pop-out

```
+--------------------------------------------------------------+
|  (wheel dimmed behind)                                       |
|                                                              |
|          +------------------------------------+      [ X ]   |
|          |                                    |              |
|          |                                    |              |
|          |           enlarged face            |              |
|          |   (cut from the original photo)    |              |
|          |                                    |              |
|          |                                    |              |
|          +------------------------------------+              |
|              #17  -  Ana M.  (name is optional)              |
|      Low-resolution source - shown for small faces only      |
|                                                              |
|     [ Show in class photo ]  [ Remove ]  [ Spin again ]      |
+--------------------------------------------------------------+
```

- Opens over the dimmed wheel. The face grows out of the selected segment, which always rests at the top of the wheel.
- Shows the face as large as comfortably fits, with its name (or `#N`) below.
- The "Low-resolution source" note appears only for small faces.

---

## 4. Functional requirements

Priorities: **P0** = first release, **P1** = soon after, **P2** = later.

### 4.1 Photo upload

| ID | Requirement | Pri |
|---|---|---|
| UP-1 | Accept one image by drag and drop, file picker or clipboard paste. Formats: JPEG, PNG, WebP. | P0 |
| UP-2 | On phones and tablets the picker offers the camera as well as the photo library. | P0 |
| UP-3 | Validate before processing: file type, size (max 30 MB) and pixel count. Photos above 25 MP are downscaled once, with a visible notice. Warn if the long edge is under 1,000 px ("faces may be too small to detect"). | P0 |
| UP-4 | Apply the photo's EXIF orientation so it appears upright. Crops carry no metadata (no GPS, device or timestamp data). | P0 |
| UP-5 | Add more photos to the same class (for example one per table). Faces from every photo go on one wheel, within the 50-face limit (FD-8). | P1 |
| UP-6 | Accept HEIC/HEIF through a lazy-loaded, client-side converter. | P2 |

### 4.2 Face detection and extraction

| ID | Requirement | Pri |
|---|---|---|
| FD-1 | Detect faces entirely in the browser. The photo is never sent over the network. | P0 |
| FD-2 | Find small faces with a multi-scale tiled search ([5.2](#52-finding-small-faces)). Initial targets on the benchmark set: at least 90% of clearly visible, roughly frontal faces 48 px or wider, at least 75% of those 32 to 47 px wide, and precision of at least 95%. | P0 |
| FD-3 | For each face keep its bounding box (working-copy pixels), confidence, source (auto or manual) and square crop ([5.4](#54-crops)). | P0 |
| FD-4 | Show progress and allow cancel. The page stays responsive during detection (no main-thread block longer than about 100 ms). | P0 |
| FD-5 | Number faces #1 to #N in approximate reading order: rows from top to bottom, left to right within a row. A new row starts when a face's vertical centre differs from the current row's average by more than 0.6 times the median face height. | P0 |
| FD-6 | A sensitivity control (Low, Normal, High, Max) re-runs the search without re-uploading. Higher levels find more faces, take longer and allow more false positives. | P0 |
| FD-7 | Detection only. No recognition, identity matching, embeddings or attribute inference. | P0 |
| FD-8 | At most 50 faces on the wheel. If more are detected, the 50 with the highest confidence are included and the rest stay in the review list, switched off, with a notice ("Only 50 faces fit on one wheel"). The teacher can swap faces by switching one off and another on, but can never include more than 50. | P0 |
| FD-9 | The detection engine makes no network requests except for loading its own files from the app's origin. The Content-Security-Policy enforces this ([section 7](#7-privacy-and-safety)). | P0 |

### 4.3 Review and edit

| ID | Requirement | Pri |
|---|---|---|
| RV-1 | Show the photo with a numbered box over each face. Hovering or selecting a box highlights its card, and the other way round. Zoom and pan (wheel, pinch, drag) to inspect tiny faces. | P0 |
| RV-2 | Per face: include/exclude toggle and delete. | P0 |
| RV-3 | Add a missed face by drawing a rectangle on the photo (mouse or touch). Its crop is generated the same way as for detected faces. | P0 |
| RV-4 | Optional label per face (plain text, max 40 characters). Without one the face is called "#N". | P0 |
| RV-5 | Summary line: faces found, included (maximum 50), and flagged small. | P0 |
| RV-6 | **Build the wheel** is enabled when at least 2 faces are included. | P0 |
| RV-7 | Move or resize a box by dragging its handles. The crop updates. | P1 |
| RV-8 | Optional "Expected students" number. Warn when it differs from the number of included faces. | P1 |
| RV-9 | Bulk actions: include all, include none, switch off all small faces, switch off all low-confidence faces. A detection scoring below 0.65 carries a "Check" badge and a red dotted box, because a wall or a hat can score 0.5 to 0.6. | P1 |
| RV-10 | Undo and redo for review edits. | P1 |

### 4.4 Wheel and spin

| ID | Requirement | Pri |
|---|---|---|
| WH-1 | One equal-angle segment per included face, in face-number order, clockwise from 12 o'clock. Neighbouring segments (including last and first) never share a colour. The palette is colour-blind-safe. | P0 |
| WH-2 | Each segment shows its face as a circular thumbnail near the rim, head pointing outward, sized to fit the segment ([6.3](#63-rendering)). | P0 |
| WH-3 | A fixed pointer at 12 o'clock that flicks as segment edges pass under it. | P0 |
| WH-4 | Spin with the hub's SPIN button (Space or Enter when it has focus). Clicking elsewhere on the wheel does not spin, so a missed click on a thin selected segment can never re-spin the wheel by accident. Ignored while already spinning. | P0 |
| WH-5 | Fair selection. The winner is drawn uniformly with a secure random source before the animation starts, and the animation is then computed to land inside that segment ([6.2](#62-fair-spin)). | P0 |
| WH-6 | The wheel makes 3 full rounds, plus the rest of a turn to reach the landing spot, over 4 to 6 seconds (randomised; the Short and Long settings change that), decelerating smoothly, at 60 fps where the device allows. When the user prefers reduced motion there is no spin: the result appears at once, with a short fade (0.5 s or less). | P0 |
| WH-7 | When it stops, the selected segment is highlighted (outline, lift, others dimmed) and a result bar reads "Selected: #17. Click it to enlarge." The result is announced to screen readers. | P0 |
| WH-8 | After-pick setting: keep picked students on the wheel (default; they get a "picked" mark) or remove them until reset. A **Reset picks** button restores everyone. | P0 |
| WH-9 | The wheel fills the available space (up to 90% of the shorter viewport side) and re-lays out on resize or rotation without changing the angle or the result. | P0 |
| WH-10 | **Edit faces** returns to the review screen. Picks are kept for faces that remain. | P0 |
| WH-11 | Present mode: full screen, panels hidden, wheel as large as possible. | P1 |
| WH-12 | Pick history: an ordered list of who was picked this session. | P1 |
| WH-13 | Cute sounds, synthesised with Web Audio (no audio files): a "ba-doop" as the wheel starts, a music-box ripple of pentatonic notes as it passes each segment (soft and quick when the wheel is fast, clearer as it slows), and a little jingle at the result. **On by default** (owner request). A **Sound** button on the wheel screen and a setting mute it. With reduced motion there are no ticks, only the start and result sounds. | P0 |
| WH-14 | Confetti at the result; drag-to-flick spin; weighted or "fair rotation" odds. | P2 |

### 4.5 Pop-out

This is the signature feature: it is what makes tiny faces usable.

| ID | Requirement | Pri |
|---|---|---|
| PO-1 | Clicking or tapping the **selected segment** opens the pop-out. A visible **Enlarge** button does the same, because a canvas segment cannot take keyboard focus and thin segments are hard to tap. | P0 |
| PO-2 | The face grows out of the selected segment toward the centre of the screen (about 300 ms). A plain fade when reduced motion is requested. | P0 |
| PO-3 | The face is shown as large as comfortably fits: up to 70% of the viewport's shorter side, never below 240 px. | P0 |
| PO-4 | The image comes from the full-resolution working copy, not from the wheel thumbnail. The thumbnail shows instantly and is swapped for the full-resolution crop when it is ready. | P0 |
| PO-5 | Caption: the label, or "#N". For a small face, add the note "Low-resolution source". | P0 |
| PO-6 | Close with the X button, Esc, a click outside, or a swipe down on touch. Focus returns to where it was. | P0 |
| PO-7 | **Spin again** closes the pop-out and spins. | P0 |
| PO-8 | **Remove** switches this student off the wheel from inside the pop-out. | P1 |
| PO-9 | **Show in class photo** toggles to the surrounding area of the photo with the face outlined, so a very small face can be recognised by context (seat, neighbours, clothing). | P1 |
| PO-10 | While the wheel is idle or selected, clicking any other segment opens the same pop-out marked "Preview". A preview does not count as a pick. | P1 |

### 4.6 Roster, settings and storage

| ID | Requirement | Pri |
|---|---|---|
| RS-1 | A roster panel lists every face (thumbnail, label, status). A toggle takes a student out of the next spin without deleting them, for absences. It is also the keyboard and screen-reader alternative to the canvas. | P0 |
| RS-2 | Selecting a roster row opens the pop-out as a Preview. | P0 |
| ST-1 | Settings: after-pick behaviour, spin length (short, normal, long), sound (on by default), theme (system, light, dark). Saved in `localStorage`; contains no student data. | P0 |
| ST-2 | **Start over** clears everything in memory after a confirmation. | P0 |
| PS-1 | By default nothing is stored. Photos, crops and labels live in memory and vanish when the tab closes. A "Leave this page?" prompt appears while there are unsaved edits. | P0 |
| PS-2 | Opt-in **Save this class on this device** (IndexedDB): photo, boxes, labels and pick state. A saved-classes list, with delete one or delete all. Warn that anyone using this browser profile can open it. | P1 |
| PS-3 | Export and import a class file to move between devices. | P2 |

---

## 5. Face extraction

### 5.1 Pipeline

```
class photo (File)
   -> decode with EXIF orientation applied
   -> working copy (ImageBitmap, at most 25 MP)
   -> global pass + overlapping tile passes at several scales   (detector, off the main thread if possible)
   -> map boxes back to working-copy coordinates, drop boxes cut by interior tile edges
   -> merge duplicates, filter by confidence and size
   -> sort in reading order, number #1..#N
   -> square padded crops -> 256 px thumbnails (full-resolution crops cut on demand)
   -> review screen
```

### 5.2 Finding small faces

This is the main technical risk. Detection models shrink their input to a small fixed size, typically a few hundred pixels per side or less. In a 4,000 px wide class photo, a 60 px face shrinks to a handful of pixels and is missed. So the photo is searched at several scales:

1. **Pyramid of tile sizes.** The smallest tile is chosen so that a face of the smallest target size fills about 17% of it, which is large enough for the model to find once the tile is resized to the model's input. Each larger level doubles the tile edge, so larger faces also land at a size the model handles well, up to the whole photo. Tile edges sit on a fixed ladder (94 px x 2ⁿ: 94, 188, 376, 752, ...), so a higher sensitivity only adds finer levels and the levels already searched are reused.
   *Worked example, using the proposed default's model card:* the model takes 128 x 128 px input and was evaluated on faces whose sides were at least 15% of the image side (it advises at least 20%). To find 32 px faces, tiles therefore have to be no wider than about 160 to 210 px (the ladder uses 188 px). With the 35% overlap below, a 4,000 x 3,000 px photo needs roughly 1,100 tile runs across five levels (the smallest level alone is about 830 tiles). *Measured in Chrome on a 20-core desktop, which varies with machine load:* a 3,000 x 2,171 px photo takes 2 to 4 s at Normal sensitivity and a 25-megapixel photo 9 to 19 s. High and Max add the 94 px level, which is several times more work (about 11 s on the 3,000 px photo), so they are opt-in.
2. **Overlap.** Tiles overlap by 35%. A level is responsible for faces from 17% to 34% of its tile (the next level takes over at 34%), so the overlap has to be at least that: then every such face lies whole inside at least one tile. *Found in the M0 spike:* with 25% overlap, a face at 28% of the tile fell into the gap between two neighbouring tiles, was cut by an edge in both, and was thrown away (it had been detected at scores of 0.95 and 0.94).
3. **Drop edge-cut boxes.** A box touching an *interior* tile edge is discarded; a whole copy exists in a neighbouring tile or at a larger level. The photo's own border is not a tile edge: faces cut off by the photo border are real and are kept.
4. **Merge.** Map boxes back to photo coordinates, then apply non-maximum suppression (IoU of 0.4 or more) plus a containment rule: when the smaller of two overlapping boxes is 70% or more inside the larger, the lower-scoring one is dropped. That removes a stray box inside a face, and also a loose, bigger box around a better one.
5. **Filter** by confidence, minimum size (0.75 x the smallest face searched) and plausible aspect ratio (0.5 to 2). Detections that pass but score below 0.65 are flagged **Check** in the review: in the test photo a wall or a hat scored 0.5 to 0.6, while real faces scored 0.75 and up. One button switches all of them off.
6. **Sensitivity levels** (FD-6) set the confidence threshold and the smallest face searched, and with it which ladder levels run. Values after tuning on the M0 test photo:

| Level | Min confidence | Smallest face searched | Smallest tile |
|---|---|---|---|
| Low | 0.70 | 48 px | 188 px |
| Normal (default) | 0.50 | 32 px | 188 px |
| High | 0.35 | 24 px | 94 px |
| Max | 0.25 | 16 px | 94 px |

Low and Normal search the same levels, so switching between them is instant; so do High and Max. They differ in the confidence threshold and in the smallest box accepted.

An optimisation still worth trying: run the coarse global pass first, estimate the typical face size from it, and run only the pyramid levels near that size plus the smallest level for the back rows.

Version 1 runs the search on the main thread and yields to the event loop every 24 ms, so the page stays responsive (progress bar, Cancel). Moving it into a Web Worker is possible (the runtime ships a classic-script build for that) but was not needed.

### 5.3 Detector engine

The detector sits behind a small adapter so it can be swapped without touching the rest of the app:

```js
/** @typedef {{ x: number, y: number, w: number, h: number, score: number }} RawDetection */

/**
 * @typedef {Object} FaceDetectorAdapter
 * @property {() => Promise<void>} init
 * @property {(image: ImageBitmap | OffscreenCanvas | HTMLCanvasElement,
 *             opts: { minScore: number }) => Promise<RawDetection[]>} detect
 * @property {() => void} dispose
 */
```

Candidates for the M0 spike:

| Candidate | Why | Watch out for |
|---|---|---|
| MediaPipe Face Detector (`@mediapipe/tasks-vision`, BlazeFace short-range). **Proposed default; its files are already in the repository.** | Small (230 KB model) and fast, runs on-device through WebAssembly, simple API, ships a self-contained ES-module build that needs no bundler. Runtime and model are both Apache-2.0. | Built for prominent, front-facing faces (see the model-card notes below), so it relies on the tiling above. **Its runtime sends usage metrics to Google unless the browser blocks the request** ([section 7](#7-privacy-and-safety)). |
| YuNet (ONNX, through ONNX Runtime Web) | Small model designed to cope with faces at many scales. | A little more integration work. |
| SCRFD or RetinaFace (ONNX, through ONNX Runtime Web) | Strong on small faces. | Larger downloads. Check each model's licence: some pretrained face models are limited to research or non-commercial use. |
| TensorFlow.js based (`face-api.js`, Human) | Prebuilt browser bundles. | Older models, heavier. |

What the proposed default's model card (June 2021) says, and why it matters here:

- It is meant for *prominently displayed* faces within about 2 m, and was trained on consented smartphone-camera images. Faces were at least 15% of the image side in its test sets, and it advises at least 20%. That is why the app tiles the photo, so that each face fills a good part of a tile.
- It is not meant for faces turned away, strongly tilted, or the back of a head, and it may return only a limited number of detections per image (the card says "e.g. 10"). Class photos are full of heads turned or looking down, so the review step with **Add missing face** is essential, and small tiles keep the number of faces per run low.
- Identity recognition and surveillance are explicitly out of scope for it, which matches this app's non-goals.
- On its own test sets of prominent faces, recall was 94.7% to 100% across skin tones and 92.5% to 100% across world regions (99.1% on average). Those test sets are smartphone AR images, and the card asks users to check whether their use case differs from that domain. Class photos of children may, so the benchmark must include them ([section 12](#12-testing-and-acceptance-criteria)).

Selection criteria: recall on small faces (including children), speed, download size, a licence that allows redistribution, use without a bundler, and no network reporting.

**About "HTML, CSS and JavaScript only".** All of the app's own code is plain HTML, CSS and JavaScript. Any in-browser face detector, however, also needs a WebAssembly runtime and a model file (`.tflite` or `.onnx`), which are not HTML, CSS or JavaScript. They are third-party static files, copied unchanged and loaded lazily on the first upload, with no build step. For the proposed default they are already in the repository: about 15 MB uncompressed under `vendor/mediapipe/` (14.6 MB of it is the WebAssembly runtime) plus `models/blaze_face_short_range.tflite` (230 KB). [vendor/README.md](vendor/README.md) records the source, version, licence and SHA-256 of every file, and how to wire them up. They are integrity-checked, and they have been run for real in Chrome and Edge under the strict CSP (see [section 13](#13-milestones)). The browser's built-in `FaceDetector` (Shape Detection API) is not an option because it is not reliably available across browsers.

### 5.4 Crops

- **Shape.** Square, with side 1.8 times the longer side of the face box (tunable, 1.4 to 2.2), centred on the box and shifted up by 5% of the box height so hair and forehead are included.
- **Clamping.** If the square would leave the photo it is shifted back inside. If the photo is smaller than the square, it shrinks to the largest square that fits.
- **Wheel and roster thumbnails.** 256 x 256 bitmaps kept in memory. They are encoded (JPEG) only when a class is saved (PS-2).
- **Pop-out image.** Cut on demand from the working copy, capped at 1,024 px on the long side, with a small cache.
- **Enlarging.** Always with the browser's smooth scaling (`imageSmoothingQuality = 'high'` on canvas). No AI super-resolution or face restoration, because it would invent features and misrepresent how a child looks.

### 5.5 Tunables

Parameters that are not already stated in a requirement row:

| Parameter | Default |
|---|---|
| Tile overlap | 35% |
| Duplicate merge | IoU 0.4 or more, or the smaller box 70% or more inside the larger |
| Low-confidence flag | Detections scoring below 0.65 |
| Crop padding | 1.8 x face box, centre shifted up by 5% |
| Thumbnail size | 256 px |
| Pop-out crop cap | 1,024 px |
| Thumbnail ring radius on the wheel | 0.74 x wheel radius |
| Landing margin | The pointer rests between 15% and 85% across the segment |

---

## 6. The wheel and the pop-out

### 6.1 Geometry

- N included faces give N equal segments of angle `θ = 2π / N`. Segment `i` (0-based) spans `[iθ, (i+1)θ)`, measured clockwise from 12 o'clock on the wheel itself.
- The wheel's rotation is `φ` (radians, clockwise). The pointer is fixed at 12 o'clock, so the wheel-local angle under the pointer is `α = (−φ) mod 2π`, and the selected index is `floor(α / θ)`.

### 6.2 Fair spin

```
winner = randomInt(N)                  // crypto.getRandomValues + rejection sampling, so no modulo bias
delta  = θ × random(0.15 .. 0.85)      // where in the segment the pointer comes to rest
alpha  = winner × θ + delta            // wheel-local angle that must end up under the pointer
phiEnd = phi + 2π × turns + mod(−alpha − phi, 2π)    // turns = 3 full rounds; mod() is never negative
phi(t) = phi + (phiEnd − phi) × easeOut(t / T)        // T = 4 to 6 s; time-based, not frame-based
```

- The winner is decided first and the animation is derived from it. What the pointer shows therefore always equals the announced result, and fairness can be unit-tested without running any animation.
- `easeOut` is monotonic (no overshoot, no backtracking), so the wheel never appears to change its mind at the end.
- The landing margin keeps the pointer away from segment edges, so the result is never ambiguous.
- Time-based animation (`performance.now()`) makes the spin last the same on 30, 60 and 120 Hz displays.

### 6.3 Rendering

- Canvas 2D. The backing store is scaled by `devicePixelRatio` (capped at 2 or 3).
- The static wheel (segments, rings, thumbnails) is drawn once to an offscreen canvas. During the spin only that bitmap is rotated and drawn, then the pointer and hub go on top. This keeps 50 thumbnails smooth. The static layer is redrawn only when the faces, the size or the theme change.
- Each thumbnail is a circle centred on the segment's centre line at about 0.74 x the wheel radius, with diameter `min(0.9 × the segment's width at that radius, 0.4 × the wheel radius)`. It is rotated so the head points to the rim, so at 12 o'clock the selected face appears upright. A thin ring in the segment's colour ties it to its segment.
- Dense wheels get small thumbnails by nature: roughly 40 px for 30 faces and 25 px for 50 faces on a 600 px wheel. That is exactly what the pop-out is for. A staggered two-ring layout that allows bigger thumbnails is a P2 enhancement.

### 6.4 Hit-testing and selection

- Pointer coordinates are converted to wheel-local polar coordinates (undoing the rotation) and then to a segment index. The hub and the area outside the rim are ignored.
- Spinning is by the SPIN button only (WH-4). A click anywhere else on the wheel does nothing, so a missed click on a thin segment can never re-spin the wheel.
- In version 1 only the selected segment responds to a click (PO-1). Because it always rests under the pointer, the pop-out always grows out of the top of the wheel.
- The whole wedge, not just the thumbnail, is the click target, and the cursor becomes a pointer over it.
- Very thin wedges are hard to hit by touch, so the **Enlarge** button is always available.

### 6.5 States

| State | Meaning | Entered when | Left when |
|---|---|---|---|
| `empty` | No photo yet | App opens, or Start over | A photo is chosen |
| `detecting` | Scanning the photo | A photo is chosen | Finished (to `review`) or cancelled (to `empty`) |
| `review` | Editing faces | Detection finishes, or Edit faces | Build the wheel |
| `idle` | Wheel ready, nothing selected | Wheel built, or Reset picks | Spin |
| `spinning` | Animating | Spin | The animation ends |
| `selected` | Winner highlighted | The animation ends, or the pop-out closes | Spin again, Edit faces, or a click on the selected segment |
| `popout` | Dialog open | Click on the selected segment, or Enlarge | Close (back to the previous state) |

Previews (RS-2, PO-10) open the same dialog from `idle` or `selected` and return to that state on close.

### 6.6 Pop-out behaviour

- Built on a native `<dialog>` opened with `showModal()`, which gives a focus trap, Esc handling and an inert background without extra code.
- The grow animation measures the selected thumbnail's on-screen rectangle and animates the dialog image from that rectangle to its final one with the Web Animations API (transform and opacity only).
- Image loading: show the 256 px thumbnail at once, decode the full-resolution crop with `img.decode()` and swap it in when ready, so nothing flashes.
- Context view (PO-9): a second canvas shows the part of the photo about four times the face box wide, centred on the face, with the face outlined.
- Cached full-resolution crops are released on Start over.

---

## 7. Privacy and safety

The photos show children, so privacy is a design constraint, not an afterthought.

- **Everything stays in the browser.** Photos, crops and labels are never uploaded. There is no server component to upload to.
- **Same-origin assets only.** The detector runtime and model are served with the app (no CDN at runtime). A strict Content-Security-Policy with `connect-src 'self'` makes "nothing leaves the device" enforceable by the browser, and it is required (see the next point), not optional hardening. A starting point, to be tightened and verified in M1:

  ```
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval';
    style-src 'self'; img-src 'self' blob: data:; worker-src 'self' blob:;
    connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
  ```

  On hosts that cannot set headers, use a `<meta http-equiv="Content-Security-Policy">` tag (it ignores `frame-ancestors`).
- **Known exception: runtime telemetry.** The proposed default runtime (MediaPipe Tasks) sends performance and usage metrics to Google every 60 seconds (`odml.pa.googleapis.com`). Its privacy notice says input images are not sent, but the request would still reveal the visitor's IP address and browser, the notice puts the duty to obtain consent on the app developer, and there is no setting to turn it off. So the CSP above must block it. In the code, a blocked request just stops the metrics timer and detection carries on; This was confirmed in Chrome: after 60 seconds the runtime tried to send its metrics, the browser blocked the request (a CSP message appears in the console), and detection carried on. Fallbacks: patch the logging out of the vendored bundle (documented, as Apache-2.0 requires) or choose another engine. Details in [vendor/README.md](vendor/README.md).
- **Detect, don't identify.** No recognition, no embeddings, no attribute inference (see non-goals).
- **Memory only by default** (PS-1). Saving is opt-in (PS-2) and clearly explained. A **Delete all data** button in settings wipes IndexedDB, caches and `localStorage`.
- **Face data stays out of** `localStorage`, cookies, URLs, history, the page title, the favicon and the service-worker cache (which holds only the app's static files).
- **No analytics** by default. If ever added: aggregate and cookie-less, with no image data, names or labels.
- **No export, download or share** of face images in version 1.
- **Clean-up.** Metadata is stripped from crops (UP-4). Object URLs are revoked and bitmaps closed as soon as they are no longer needed.
- **First-run notice** (shown once): "Photos stay on this device. Use class photos only as your school's policy allows."

The design makes it easier to comply with rules such as FERPA, COPPA, GDPR and local school policy, but compliance is the responsibility of the school that uses the app. This document is not legal advice.

---

## 8. Accessibility and fairness

- **Standard.** Target WCAG 2.2 level AA.
- **Keyboard.** The whole flow works without a mouse: upload, review, spin (Space or Enter on the SPIN button), **Enlarge**, close with Esc. Focus is always visible.
- **Canvas.** The wheel canvas has a text alternative. The roster list is its accessible equivalent. Results are announced through an `aria-live="polite"` region.
- **Pop-out.** The dialog is labelled by its caption, the face image has alt text ("Student #17" or the label), focus moves in on open and returns on close.
- **Not colour alone.** Selected, picked, switched-off and small-face states always have a second cue: outline, icon or text.
- **Motion.** Honour `prefers-reduced-motion` (spin of 0.5 s or less, fades instead of movement, no confetti). Nothing flashes more than three times per second.
- **Legibility.** Touch targets are at least 44 x 44 px. Text is legible from the back of a classroom; the pop-out caption is at least 32 px.
- **Fairness of detection.** Detectors can perform differently across skin tones, ages, lighting, glasses and head coverings, and a student the detector misses can never be picked. Therefore:
  - the review screen always appears after detection;
  - the expected-count check (RV-8) warns about missing faces;
  - adding a face by hand is only a few clicks;
  - the benchmark must be diverse and report recall per group.

---

## 9. Non-functional requirements

| Area | Requirement |
|---|---|
| Browsers | Latest two versions of Chrome, Edge, Firefox and Safari, including iOS and iPadOS Safari. Needs ES modules, Canvas 2D, `createImageBitmap`, `<dialog>`, WebAssembly and `crypto.getRandomValues`. Web Workers and `OffscreenCanvas` are used where available. |
| Devices | Laptop, tablet, phone and classroom projector (1080p or 4K), with mouse, touch and keyboard. Responsive layout. |
| Detection speed (targets) | A 12 MP photo with about 35 faces: 10 s or less on a mid-range laptop, 30 s or less on a mid-range phone. |
| Wheel performance | 60 fps with 50 segments on a mid-range laptop; at least 30 fps on mid-range phones. |
| Download size | App code (HTML, CSS, JS) under about 200 KB before compression (measured: 164 KB). The detector (about 15 MB uncompressed, far less with gzip or brotli) downloads on the first upload and is cached. |
| Memory | Decoded photos capped at 25 MP. Release bitmaps and URLs when leaving a screen. No growth across repeated spins. |
| Offline | After the first visit the app works offline through a service worker (P1). |
| Security | Strict CSP, no third-party scripts, fonts or analytics, HTTPS in production. |
| Localisation | All UI text lives in one module (`js/strings.js`) so it can be translated later. English first. Numbers formatted with `Intl`. |

---

## 10. Architecture and technology

**Constraint.** The app's own code is plain **HTML, CSS and JavaScript (ES modules)**. No framework, no bundler or transpiler, no TypeScript, and no package manager is needed to run or deploy it. The only non-HTML/CSS/JS files are the third-party detector runtime and model described in [5.3](#53-detector-engine).

| Concern | Approach |
|---|---|
| Markup | One `index.html`. Each screen is a `<section>`, repeated items use `<template>`, and the pop-out is a native `<dialog>`. |
| Styling | Plain CSS files. Custom properties for theme tokens, `prefers-color-scheme` for dark mode, `prefers-reduced-motion` for motion. System font stack, so no web fonts. No preprocessors or utility frameworks. |
| Scripting | ES modules loaded with `<script type="module">`. No inline scripts or event-handler attributes. JSDoc type annotations, with `// @ts-check` available in the editor. |
| State | A small hand-written observable store (`state.js`). UI modules subscribe to it and update the DOM. |
| Wheel | Canvas 2D. |
| Image work | `createImageBitmap`, `<canvas>` or `OffscreenCanvas`, and `canvas.toBlob` when saving. |
| Randomness | `crypto.getRandomValues`. |
| Face detection | Vendored runtime and model behind the adapter in [5.3](#53-detector-engine), in a Web Worker where the engine supports it. |
| Storage | `localStorage` for settings only. IndexedDB for opt-in saved classes (P1), through a small hand-written wrapper. |
| Offline | An optional hand-written service worker (`sw.js`) with a static precache list (P1). |
| Hosting | Any static host (GitHub Pages, Netlify, Cloudflare Pages, a school web server). HTTPS in production. Serve `.wasm` as `application/wasm` and enable gzip or brotli. |

### Running locally

ES modules, Web Workers and WebAssembly do not load from `file://`, so serve the folder over HTTP. For example `python -m http.server 8080` from the project folder, or the VS Code *Live Server* extension, then open `http://localhost:8080`. There is no `npm install` and no build.

Tests: open `http://localhost:8080/tests/` in the browser, or run `node --test "tests/*.test.js"` (Node 22 or newer; keep the quotes, because a bare folder name is treated as a file).

### Deploying to GitHub Pages

Push the folder to a repository, then in Settings, Pages, choose "Deploy from a branch", branch `main`, folder `/ (root)`. The site appears at `https://<user>.github.io/<repository>/`. Everything uses relative paths, so the app works from that sub-folder (tested), and `.nojekyll` stops Pages from running Jekyll over it. GitHub Pages cannot set HTTP headers, so the Content-Security-Policy is a `<meta>` tag in `index.html`; it blocks the detector's metrics request just as well.

GitHub Pages only serves files. Each visitor's browser runs its own copy of the app, and a photo goes nowhere else, so a photo taken on a phone has to be opened in the browser that will run the wheel (see open question 8).

### Structure

```
edutools_spinthewheel/
  index.html              all screens as <section>s, the <template>s and the <dialog>s
  css/
    tokens.css            colours, spacing, light and dark themes
    base.css  layout.css  review.css  wheel.css  popout.css
  js/
    main.js               entry point: wires the modules together and switches screens
    state.js              observable store and every action that changes it
    strings.js            all UI text
    ui/                   DOM code: upload, review, photo-viewer, wheel-view, roster, popout,
                          settings, present, toasts, sound, dom helpers
    core/                 pure logic, no DOM: config, rng, spin, wheel-geometry, crop, tiling,
                          nms, reading-order, faces
    media/                photo decoding, the mip pyramid, crops, the thumbnail cache (needs the DOM)
    detection/            search (tiling and merge), the MediaPipe adapter, the controller
    storage/              settings in localStorage
  vendor/                 third-party files, copied in unchanged
    README.md             source, version, licence and SHA-256 of every file
    mediapipe/            MediaPipe Tasks Vision 1.2.2: bundles, wasm/, LICENSE
  models/                 detector model file(s)
    blaze_face_short_range.tflite
  tests/                  index.html (browser) and *.test.js (the same files run under Node)
    e2e/                  optional browser tests over the DevTools protocol, no dependencies
  .nojekyll               tells GitHub Pages not to run Jekyll over the app
  .gitattributes          no line-ending conversion for the vendored files
  README.md  CLAUDE.md
```

Rules of thumb:

- `js/core/` never touches the DOM, so it can be tested in a browser and in Node.
- UI modules do not call each other. They communicate through `state.js`.
- Dev tooling (a linter, Playwright, a minifier) is optional and never needed to run the app.

### Data model

```js
/** @typedef {{ x: number, y: number, w: number, h: number }} Box   working-copy pixels */

/**
 * @typedef {Object} Photo
 * @property {string} id
 * @property {string} name
 * @property {number} width         working-copy size in px
 * @property {number} height
 * @property {HTMLCanvasElement}   canvas    the working copy: EXIF applied, at most 25 MP, no metadata
 * @property {HTMLCanvasElement[]} pyramid   the working copy halved repeatedly; tiles are cut from the best level
 * @property {number|null} downscaledFrom    megapixels of the original when it was reduced
 * @property {boolean} lowRes                the long edge was under 1,000 px
 */

/**
 * @typedef {Object} Face
 * @property {string}  id
 * @property {string}  photoId
 * @property {Box}     box
 * @property {number|null} score    null for faces added by hand
 * @property {'auto'|'manual'} source
 * @property {string}  label        '' means shown as "#N"
 * @property {boolean} included     false means not on the wheel (excluded or absent)
 * @property {number}  pickCount
 * @property {boolean} small        box shorter side < 48 px
 */

/**
 * @typedef {Object} Settings
 * @property {'keep'|'remove'} afterPick
 * @property {'short'|'normal'|'long'} spinDuration
 * @property {boolean} sound        default true (owner request); the Sound button and the settings dialog change it
 * @property {'system'|'light'|'dark'} theme
 */
```

---

## 11. Edge cases

| Situation | Behaviour |
|---|---|
| No faces found | Message with the photo tips, the **Add missing face** tool, and a prompt to raise sensitivity. |
| Fewer than 2 faces included | The wheel cannot be built; explain why. |
| More than 50 faces detected | The 50 with the highest confidence are included; the rest stay in the review list, switched off, with the notice "Only 50 faces fit on one wheel". To cover a bigger class, make one wheel per group, each from its own photo. |
| Teacher tries to include a 51st face | The checkbox is disabled, with the tooltip "The wheel is full. Switch another face off first." |
| The same face detected twice | Merged by the duplicate rule ([5.2](#52-finding-small-faces)); leftovers are deleted in review. |
| Face at the photo's edge | The crop is shifted inside the photo, or shrunk if needed ([5.4](#54-crops)). |
| Faces turned away, masked, hooded or hidden | May be missed. Add them by hand. |
| Posters, screens or reflections detected | Delete them in review. |
| Huge photo (over 25 MP) | Downscaled once, with a notice (UP-3). |
| Browser runs out of memory during detection | Catch what can be caught and suggest a smaller photo. Nothing is persisted, so a restart is clean. |
| Detector files fail to load (for example offline on a first visit) | Clear error with **Retry**. The rest of the app still works. |
| Browser lacks required features | An "Unsupported browser" page listing the supported browsers. |
| Window resized or device rotated during a spin | Re-layout without changing the angle or the outcome (WH-9). |
| SPIN pressed while spinning, or double-click on the selected segment | The first is ignored; the second opens the pop-out once. |
| After-pick mode "remove" and everyone has been picked | Show "Everyone has been picked" with a **Reset picks** button. |
| A student appears in two photos (P1) | The teacher deletes one face in review. |
| Tab closed with unsaved edits | "Leave this page?" prompt (PS-1). |

---

## 12. Testing and acceptance criteria

### Test layers

- **Unit tests** for the pure `js/core/` modules and the store (`js/state.js`): RNG uniformity (AC-5), landing maths and result consistency (AC-6), the 3 rounds, hit-testing, crop clamping, duplicate merging, tile coverage and overlap, reading order, the 50-face cap and swapping (AC-11), and the spin, pick, undo and settings actions. They are plain ES modules that run in the browser through `tests/index.html` (a tiny in-repo harness, no dependencies) and under Node: `node --test "tests/*.test.js"` (Node 22 or newer; keep the quotes, because a bare folder name is treated as a file).
- **Detection benchmark** (`benchmark/`): at least 20 photos with ground-truth boxes, 10 to 45 faces each (plus at least one photo with more than 50 faces to exercise the cap), covering a mix of resolutions, distances and lighting, children and adults, diverse skin tones, glasses and head coverings. Photos must be licensed, synthetic, or taken with explicit consent. Real students' photos are never committed to the repository. Report recall and precision by face-size band and by group, plus run time. **Not built yet:** so far the search has only been tried on one public-domain group photo (29 people, 3,000 px wide), where it found every face.
- **Manual checklist** (optionally automated with Playwright as a dev-only tool): the full flow with mouse, touch and keyboard only; projector resolution; reduced motion; a real phone and an iPad; a slow device. `tests/e2e/` has a dependency-free script that drives Chrome or Edge through the main flows over the DevTools protocol (see its header); what it cannot cover still needs a person, a real phone and an iPad.

### Acceptance criteria

| ID | Criterion |
|---|---|
| AC-1 Upload to faces | **Given** a benchmark photo with 30 clearly visible faces 48 px or wider, **when** it is uploaded, **then** at least 27 faces are boxed and numbered within 10 s on a mid-range laptop. |
| AC-2 Small faces | **Given** faces 32 to 47 px wide, **when** detection finishes at Normal sensitivity, **then** at least 75% of them are found and all of them are flagged small. |
| AC-3 Manual add | **Given** a missed face, **when** the teacher draws a rectangle around it, **then** a new numbered face with a square crop appears, included. |
| AC-4 Build | **Given** 31 included faces, **when** the teacher builds the wheel, **then** it shows 31 equal segments, each with a face thumbnail, and SPIN is enabled. With 1 included face, building is disabled and explained. |
| AC-5 Fairness | Over 100,000 simulated draws for N = 31, each index's count is within 5 standard deviations of its expected value. |
| AC-6 Result consistency | For N from 2 to 50 and 1,000 random spins each, the segment under the pointer when the animation ends is the drawn winner and is never within 15% of a segment edge. |
| AC-7 Pop-out | **Given** the wheel has stopped on segment #17, **when** the user clicks that segment (or presses **Enlarge**), **then** a dialog opens showing that face at 240 px or larger (or the largest that fits), cut from the full-resolution working copy, captioned "#17" or its label. Focus moves into the dialog. Esc closes it and focus returns. |
| AC-8 Small-face case | **Given** 50 faces on the wheel (thumbnails about 25 px) and a stop on a small face, **when** the user clicks the selected segment, **then** the face appears enlarged and the "Low-resolution source" note is visible. |
| AC-9 Privacy | During upload, detection, review, spin and pop-out, the network log shows no request to any other origin (a blocked MediaPipe metrics request shows up only as a CSP message in the console), all detector files are same-origin, and nothing is written to storage unless the user chose to save. |
| AC-10 Keyboard and motion | The whole flow works with the keyboard alone. With reduced motion on, the result appears within 0.5 s and the pop-out fades in instead of flying. |
| AC-11 Face cap | **Given** a photo with 55 detectable faces, **when** detection finishes, **then** 50 are included, 5 are listed but switched off with the notice, and switching one of the 50 off lets one of the 5 be switched on. |

---

## 13. Milestones

Where things stand: M0 and M1 are done, and most of M2.

- **M0, spike: de-risk detection. Done.** The tiled search was built and run with the vendored MediaPipe files in Chrome and Edge, under the strict CSP, on a public-domain group photo of 29 people. Findings: all 29 faces are found at Normal sensitivity (scores 0.75 to 0.96), with a few low-scoring false boxes (up to 0.60) that the review step removes; the overlap had to go from 25% to 35% ([5.2](#52-finding-small-faces)); canvas downscaling with `medium` or `high` smoothing is slow, so tiles are cut from a pyramid of halved copies (about 4 ms a tile instead of about 30 ms); and the runtime's metrics request is blocked by the CSP while detection carries on ([section 7](#7-privacy-and-safety)). *Still open:* a proper benchmark of 20 or more photos, including children, with recall by group. The FD-2 targets are only checked on the one photo.
- **M1, MVP. Done.** Every P0 item: upload, detect, review, wheel, spin, selected segment, pop-out, roster, settings, privacy basics, keyboard and screen-reader support, and tests.
- **M2, classroom-ready. Mostly done.** Built: present mode (WH-11), pick history (WH-12), context view (PO-9), Remove from the pop-out (PO-8), expected-count warning (RV-8), bulk actions (RV-9), undo and redo (RV-10). Not built: more than one photo (UP-5), box handles (RV-7), previews from the wheel (PO-10, an open question), saved classes (PS-2), offline use.
- **M3, later. Not built:** HEIC (UP-6), export and import (PS-3), confetti and the other P2 items in WH-14, a denser staggered layout.

---

## 14. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Small or far-away faces are missed | A missed student can never be picked | Multi-scale tiling, sensitivity levels, manual add, expected-count check, and the M0 benchmark gate |
| Slow or crashing on phones and tablets | Unusable on common classroom devices | Worker, 25 MP cap, progress and cancel, fewer pyramid levels on mobile, testing on a real mid-range phone and an iPad |
| Detector less accurate for some people (skin tone, age, glasses, head coverings, lighting) | Unfair exclusion. The model card itself reports recall from 94.7% to 100% across skin tones, on prominent faces | Diverse benchmark, including children, with per-group recall; review step; easy manual add |
| Parents or schools worry about children's photos | Adoption blocked | Local-only processing enforced by CSP, nothing stored by default, no export, a plain-language privacy panel |
| The default runtime sends usage metrics to Google | Breaks the "nothing leaves the device" promise and may need user consent | Required CSP `connect-src 'self'`, a real-browser check in M0, and fallbacks: patch the bundle or choose another engine |
| Thin segments are unreadable | The core use case fails | Pop-out, Enlarge button, roster, context view, lifted selected segment |
| Model or runtime licence forbids redistribution or commercial use | Legal exposure | The vendored runtime and model are both Apache-2.0 (recorded in `vendor/README.md`). Check the licence of any other candidate in M0, vendor only permitted files, keep licences next to them |
| Browser differences (iOS Safari memory and canvas limits, WebAssembly support) | Works on desktop, fails on tablets | Cap sizes, feature-detect, keep a browser test matrix |
| No build step means no compiler to catch mistakes | Typos and type errors show up only at runtime | JSDoc with `// @ts-check` in the editor, unit tests for `js/core/`, small modules |

---

## 15. Open questions

1. **Click only, or also automatic?** As requested, the pop-out opens when the user clicks the selected segment. Should there also be a setting to open it automatically when the wheel stops (handy on a projector)? This spec says no for now.
2. **Previews.** PO-10 lets the teacher click any other segment to preview it while the wheel is idle. Keep it?
3. **Names.** Optional per-face labels are included. Is that enough, or should the teacher be able to paste a class list and map names to faces?
4. **Saved classes.** PS-2 is convenient but leaves student faces in the browser. Acceptable as an opt-in?
5. **Class and photo size.** The wheel is capped at 50 faces. What are the typical and the largest class sizes, and what is the typical photo (phone, webcam, lecture hall)? If classes above 50 are common, a "groups" feature (several wheels from one set of photos) could be added.
6. **Runtime telemetry.** The vendored MediaPipe runtime tries to send usage metrics to Google; the CSP blocks it and detection carries on (verified in Chrome, [section 7](#7-privacy-and-safety)). Are you comfortable relying on the CSP to block it, or would you rather use an engine with no reporting at all (for example YuNet through ONNX Runtime Web)?
7. **Reach.** Any languages besides English? Where will it be hosted (public site, school intranet, both)?
8. **Phone to computer.** The photo never leaves the browser that opened it, so a photo taken on a phone has to reach the browser that will run the wheel. Today that means doing everything on the phone and casting it, or moving the photo yourself (AirDrop, Quick Share, Phone Link, Drive, email; send the original, as chat apps compress it). A built-in "send from phone" button would need either a direct phone-to-computer link paired by QR code (no server and no third party, but it only works if both devices are on a network that lets them talk to each other, which many school networks do not) or a relay server (works everywhere, but children's photos then pass through a server, even if encrypted). Which, if either?

---

## License

To be decided.
