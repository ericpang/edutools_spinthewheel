// The tiled multi-scale face search (README 5.2): pyramid of tile sizes, overlapping tiles,
// drop boxes cut by interior tile edges, merge duplicates, filter.
import { MAX_ASPECT, MIN_ASPECT, MODEL_MIN_SCORE, SENSITIVITY, TILE_CANVAS_PX } from '../core/config.js';
import { clampBox } from '../core/crop.js';
import { mergeDetections } from '../core/nms.js';
import { planLevels, planTiles, tileBoxToPhoto, touchesInteriorEdge } from '../core/tiling.js';
import { drawTile } from '../media/photo.js';

// A macrotask yield that does not suffer the 4 ms clamp of nested setTimeout calls.
const channel = new MessageChannel();
const waiting = [];
channel.port1.onmessage = () => waiting.shift()?.();
const yieldToUi = () => new Promise((resolve) => { waiting.push(resolve); channel.port2.postMessage(0); });

const SLICE_MS = 24;       // work this long, then let the page breathe (FD-4: no long main-thread blocks)
const REPORT_MS = 100;

/** The levels a sensitivity searches, whole photo first, then coarse to fine. */
export function levelsFor(photo, sensitivity) {
  return planLevels({ width: photo.width, height: photo.height, smallestFace: SENSITIVITY[sensitivity].smallest }).reverse();
}

/** Merge cached raw detections for the sensitivity's levels and apply its filters. */
export function collectDetections({ photo, cache, sensitivity }) {
  const { minScore, smallest } = SENSITIVITY[sensitivity];
  const raw = [];
  for (const level of levelsFor(photo, sensitivity)) for (const d of cache.get(level.key) ?? []) if (d.score >= minScore) raw.push(d);
  const minSide = Math.max(12, smallest * 0.75); // a little slack: boxes are measured, not exact
  return mergeDetections(raw)
    .map((d) => ({ ...d, ...clampBox(d, photo.width, photo.height) }))
    .filter((d) => {
      const aspect = d.w / d.h;
      return Math.min(d.w, d.h) >= minSide && aspect >= MIN_ASPECT && aspect <= MAX_ASPECT;
    });
}

/**
 * Search the photo. Levels already in `cache` are not searched again, so changing the sensitivity only
 * pays for the levels it adds.
 * @param {{photo: any, detector: import('./mediapipe.js').FaceDetectorAdapter, sensitivity: string,
 *          cache: Map<string, any[]>, signal?: AbortSignal,
 *          onProgress?: (fraction: number) => void, onLevelDone?: () => void}} o
 */
export async function runSearch({ photo, detector, sensitivity, cache, signal, onProgress, onLevelDone }) {
  const { width, height, pyramid } = photo;
  const S = TILE_CANVAS_PX;
  const plans = levelsFor(photo, sensitivity)
    .filter((level) => !cache.has(level.key))
    .map((level) => ({
      level,
      tiles: level.kind === 'global' ? [{ x: 0, y: 0, w: width, h: height }] : planTiles({ width, height, edge: level.edge }),
    }));
  const total = Math.max(1, plans.reduce((n, p) => n + p.tiles.length, 0));

  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = tileCanvas.height = S;
  const tctx = tileCanvas.getContext('2d');

  let done = 0;
  let sliceStart = performance.now();
  let lastReport = 0;
  for (const { level, tiles } of plans) {
    const found = [];
    const margin = Math.max(2, 0.02 * level.edge);
    for (const tile of tiles) {
      signal?.throwIfAborted();
      drawTile(pyramid, tile, S, tctx);
      const raw = await detector.detect(tileCanvas, { minScore: MODEL_MIN_SCORE });
      for (const r of raw) {
        const box = tileBoxToPhoto(r, tile, S);
        if (level.kind === 'tile' && touchesInteriorEdge(box, tile, width, height, margin)) continue;
        found.push(box);
      }
      done++;
      const now = performance.now();
      if (now - lastReport > REPORT_MS) { lastReport = now; onProgress?.(done / total); }
      if (now - sliceStart > SLICE_MS) { await yieldToUi(); sliceStart = performance.now(); }
    }
    cache.set(level.key, found);
    onLevelDone?.();
  }
  onProgress?.(1);
  return collectDetections({ photo, cache, sensitivity });
}
