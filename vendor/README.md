# Vendored third-party files

Third-party files that the app loads at runtime. They are copied in **unchanged**: nothing here is edited by hand. To update one, repeat the steps under [How these were obtained](#how-these-were-obtained) and refresh the tables below.

Retrieved on 2026-11-04. Total size is 14.8 MB uncompressed, of which 14.6 MB is the WebAssembly runtime.

**Status:** the files are integrity-checked (see below) and have been run for real in Chrome and Edge 156, under the app's strict Content-Security-Policy, through the whole flow (see the M0 findings in the main [README](../README.md#13-milestones)).

## Contents

| File | What it is | Bytes |
|---|---|---|
| `vendor/mediapipe/vision_bundle.mjs` | MediaPipe Tasks Vision 1.2.2 as an ES module. Import it on the main thread. Self-contained (no further imports). | 156,062 |
| `vendor/mediapipe/vision_bundle.js` | The same library as a classic script that defines a global `Vision`. For use inside a classic Web Worker with `importScripts`. | 156,088 |
| `vendor/mediapipe/wasm/vision_wasm_internal.js` | WebAssembly loader (Emscripten glue code). | 334,128 |
| `vendor/mediapipe/wasm/vision_wasm_internal.wasm` | The WebAssembly runtime that runs the model. | 14,603,354 |
| `vendor/mediapipe/LICENSE` | Apache License 2.0 text. The npm package ships no licence file, so this is the file from the MediaPipe repository. | 12,331 |
| `models/blaze_face_short_range.tflite` | BlazeFace short-range face detector, float16. Input is 128 x 128 px. | 229,746 |

### Checksums (SHA-256)

In `sha256sum` format, with paths relative to the project root:

```
b65acb59b370cd6561afd9d04c29ed7a87e7ed6386922ac1b263af1f1ad06b7d  vendor/mediapipe/vision_bundle.mjs
a8c95ebecb9efca4ef79ce32f7b77fa5cb61b809e7e21a2f3d792d181ca0b822  vendor/mediapipe/vision_bundle.js
f2b9c17131ea79716ec6bf07b117a087b2749a6f8a1e2f1f2e77a9382092db5b  vendor/mediapipe/wasm/vision_wasm_internal.js
f5bd25147ac89d506074293ce2675969b10e827180db95a0d9689c2ed80764ab  vendor/mediapipe/wasm/vision_wasm_internal.wasm
8707eef0533987efc5b155d64761eeb6e20793f50b9bd1a68dad1cf4719d0ed8  vendor/mediapipe/LICENSE
b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f  models/blaze_face_short_range.tflite
```

On Windows: `Get-FileHash <file> -Algorithm SHA256`. On macOS or Linux: `sha256sum -c` with the block above.

## Sources

| Item | Where it came from |
|---|---|
| Library and WebAssembly runtime | npm package `@mediapipe/tasks-vision` 1.2.2: `https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.2.2.tgz`. The tarball's SHA-1 (`72a72ebed675fa3331718eaea8b04d437e97b383`) and SHA-512 match the values the registry publishes for that version. |
| Model | `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`. A valid TensorFlow Lite file (flatbuffer identifier `TFL3`). Google publishes no checksum for it, so the SHA-256 above is simply what was downloaded. |
| Licence text | `https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE` |
| Model card (read, not vendored) | `https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf`, dated June 9, 2021 |

## Licences

- **MediaPipe Tasks Vision** (library and runtime): Apache-2.0, as declared in its `package.json`.
- **BlazeFace short-range model**: Apache License 2.0, as stated on its model card.

This is a record of what the sources say, not a legal review. The compiled runtime also contains other third-party components, so check the upstream notices before any commercial distribution.

## Left out on purpose

- `wasm/vision_wasm_module_internal.js` and `.wasm` (14.6 MB more): the build for ES-module Web Workers. The runtime picks it only when `FilesetResolver.forVisionTasks(path, true)` is called. Add it if the detector is ever run in a module worker.
- `vision_bundle.cjs` (for Node), the `*.map` source maps, and `vision.d.ts` (editor types).

## Privacy: the runtime sends usage metrics unless the browser blocks them

This matters because the app handles photos of children and promises that nothing leaves the device.

The package's own privacy notice (last modified June 5, 2026) says that input data such as images is processed on the device and is not sent to Google, but that "MediaPipe Tasks APIs send metrics about the performance and utilization of the APIs in your app to Google", and that the app developer is responsible for obtaining informed consent as required by law.

What the bundled code does (read in `vision_bundle.mjs` 1.2.2, and observed in Chrome with the CSP on: after 60 seconds the browser reports "Connecting to 'https://odml.pa.googleapis.com/v1/log' violates the following Content Security Policy directive: connect-src 'self'", and detection keeps working):

- Every task instance creates a metrics collector. Every 60 seconds it POSTs a small protobuf message to `https://odml.pa.googleapis.com/v1/log`, without cookies.
- In the code reviewed, the message is built from counters and timings, a task-type code, and a coarse operating-system code derived from the user agent. The code does not read the page URL or the referrer. Any HTTP request still reveals the sender's IP address and browser to the server.
- There is no option to turn it off.
- If the request fails, including because a Content-Security-Policy blocked it, the collector records an error and stops its timer. Detection carries on.

What this project does about it:

1. The app's Content-Security-Policy **must** include `connect-src 'self'`, which makes the browser block the request. See section 7 of the main README.
2. This has been confirmed in a real browser: detection works with the request blocked, and no request leaves the app's origin.
3. If that is not good enough, the fallbacks are to patch the logging out of the vendored bundle (and record the change here, because Apache-2.0 requires modified files to say they were changed) or to choose an engine that does not report anywhere (main README, section 5.3).

## Serving these files

- Serve everything from the app's own origin. The CSP forbids other origins.
- Serve `.wasm` as `application/wasm` and turn on gzip or brotli: the runtime is 14.6 MB raw.
- The runtime and model are fetched only when the first photo is uploaded, then cached.

Expected wiring, for the M0 spike (paths relative to the site root):

```js
// Main thread (ES module)
import { FaceDetector, FilesetResolver } from '/vendor/mediapipe/vision_bundle.mjs';

const fileset = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
const detector = await FaceDetector.createFromModelPath(fileset, '/models/blaze_face_short_range.tflite');
const { detections } = detector.detect(imageOrCanvas);
```

```js
// Inside a classic Web Worker
importScripts('/vendor/mediapipe/vision_bundle.js');
const { FaceDetector, FilesetResolver } = Vision;
// ...then the same calls as above
```

## How these were obtained

1. Read the package's metadata from `https://registry.npmjs.org/@mediapipe/tasks-vision/latest` to get the version, tarball URL, SHA-1 and SHA-512.
2. Download the tarball into a fresh, empty folder outside the project and compare both hashes with the registry's.
3. Extract it into another fresh folder. Nothing from the package was executed.
4. Copy only the files listed above into this repository, then confirm each copy has the same SHA-256 as its source.
5. Download the model and the licence text into their own fresh folders, and check the model's header.

## Phone transfer libraries (added 2026-11-05)

Used only by `pair.html` and `send.html`, never by the main page. They were already in the repository when this record was written, so **the download source and version could not be verified from here**: the files carry no version string. What can be said:

| File | What it is | Licence | SHA-256 |
|---|---|---|---|
| `vendor/peerjs/peerjs.min.js` | PeerJS browser bundle (WebRTC data channels through a pairing server). Its built-in default relay servers (`turn.peerjs.com`) suggest release 1.5.3 or later; unconfirmed. | MIT, `vendor/peerjs/LICENSE` | `7604d8c31bec4f134b0d15c2d80b1d095ea18af005354f439f14291fcd7b4168` |
| `vendor/qrcode/qrcode.js` | qrcode-generator by Kazuhiko Arase (browser build, defines a global `qrcode`). | MIT, `vendor/qrcode/LICENSE` | `79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c` |

**TODO for the owner:** re-download both from npm (`peerjs`, `qrcode-generator`), compare with the hashes above and record the exact versions and URLs here.

PeerJS contacts the pairing service configured in `js/pair/config.js` (default `0.peerjs.com`) and, through WebRTC, Google's STUN server and PeerJS's TURN relays. See README section 7.
