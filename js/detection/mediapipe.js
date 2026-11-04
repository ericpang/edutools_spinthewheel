// FaceDetectorAdapter for MediaPipe Tasks Vision (README 5.3). The runtime and model are vendored
// in vendor/mediapipe/ and models/ and are only fetched when the first photo is uploaded.
import { MODEL_MIN_SCORE } from '../core/config.js';

/**
 * @typedef {{ x: number, y: number, w: number, h: number, score: number }} RawDetection
 * @typedef {Object} FaceDetectorAdapter
 * @property {() => Promise<void>} init
 * @property {(image: HTMLCanvasElement | ImageBitmap | OffscreenCanvas,
 *             opts?: { minScore?: number }) => Promise<RawDetection[]>} detect
 * @property {() => void} dispose
 */

/** @returns {FaceDetectorAdapter} */
export function createMediaPipeDetector({
  wasmPath = new URL('../../vendor/mediapipe/wasm', import.meta.url).href,
  modelPath = new URL('../../models/blaze_face_short_range.tflite', import.meta.url).href,
} = {}) {
  let detector = null;
  return {
    async init() {
      const { FaceDetector, FilesetResolver } = await import('../../vendor/mediapipe/vision_bundle.mjs');
      const fileset = await FilesetResolver.forVisionTasks(wasmPath);
      detector = await FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath, delegate: 'CPU' },
        runningMode: 'IMAGE',
        minDetectionConfidence: MODEL_MIN_SCORE,
        minSuppressionThreshold: 0.3,
      });
    },
    async detect(image, { minScore = MODEL_MIN_SCORE } = {}) {
      const { detections } = detector.detect(image);
      const out = [];
      for (const d of detections) {
        const score = d.categories[0]?.score ?? 0;
        if (score < minScore || !d.boundingBox) continue;
        const b = d.boundingBox;
        out.push({ x: b.originX, y: b.originY, w: b.width, h: b.height, score });
      }
      return out;
    },
    dispose() {
      detector?.close();
      detector = null;
    },
  };
}
