// Face-list logic: creating, numbering, the 50-face cap and re-detection (README 4.2, 4.3, FD-8).
import { LOW_CONFIDENCE, MAX_FACES } from './config.js';
import { isSmallFace } from './crop.js';
import { iou } from './nms.js';
import { readingOrder } from './reading-order.js';

/**
 * @typedef {Object} Face
 * @property {string} id
 * @property {string} photoId
 * @property {{x:number,y:number,w:number,h:number}} box  working-copy pixels
 * @property {number|null} score   null for faces added by hand
 * @property {'auto'|'manual'} source
 * @property {string} label        '' means shown as "#N"
 * @property {boolean} included    false means not on the wheel (switched off, absent or over the cap)
 * @property {number} pickCount
 * @property {boolean} small       box shorter side < 48 px
 * @property {number} num          1..N in reading order
 */

let counter = 0;
export const newFaceId = () => `f${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** @returns {Face} */
export function makeFace({ box, score = null, source = 'auto', id = newFaceId(), photoId = 'p1' }) {
  return { id, photoId, box, score, source, label: '', included: true, pickCount: 0, small: isSmallFace(box), num: 0 };
}

/** Sort into reading order and number 1..N (FD-5). */
export const renumber = (faces) => readingOrder(faces).map((f, i) => ({ ...f, num: i + 1 }));

export const includedCount = (faces) => faces.reduce((n, f) => n + (f.included ? 1 : 0), 0);

/** Name shown for a face: its label, or "#N". */
export const displayName = (face) => face.label.trim() || `#${face.num}`;

/** FD-8: keep at most `max` faces included, preferring the highest confidence (hand-drawn boxes rank as certain). */
export function applyCap(faces, max = MAX_FACES) {
  const keep = new Set(
    faces.filter((f) => f.included).sort((a, b) => (b.score ?? 1) - (a.score ?? 1)).slice(0, max).map((f) => f.id),
  );
  return faces.map((f) => (f.included && !keep.has(f.id) ? { ...f, included: false } : f));
}

/** Faces on the wheel right now: included, and not yet picked when the setting removes picked faces. */
export const eligibleFaces = (faces, afterPick) => faces.filter((f) => f.included && (afterPick !== 'remove' || f.pickCount === 0));

/** A weak detection: it may be a wall or a hat rather than a face. Hand-drawn faces are never weak. */
export const isLowConfidence = (face) => face.score !== null && face.score < LOW_CONFIDENCE;

export function summarize(faces) {
  return {
    found: faces.length,
    included: includedCount(faces),
    small: faces.filter((f) => f.small).length,
    low: faces.filter(isLowConfidence).length,
  };
}

/**
 * Combine a fresh detection result with the faces the teacher already has (initial detection is the
 * same call with no old faces). Hand-drawn faces are always kept. A detection that matches an
 * old automatic face (IoU >= 0.5) keeps that face's id, label, switch and pick count. Detections
 * matching a face the teacher deleted (`tombstones`) are ignored. New faces only fill capacity that is
 * left, highest confidence first; faces the teacher already included are never bumped.
 */
export function mergeRedetected({ oldFaces = [], detections, tombstones = [], photoId = 'p1', max = MAX_FACES }) {
  const olds = oldFaces.filter((f) => f.source === 'auto');
  const manual = oldFaces.filter((f) => f.source === 'manual');
  const used = new Set();
  const kept = [];
  const fresh = [];
  for (const d of detections) {
    const box = { x: d.x, y: d.y, w: d.w, h: d.h };
    if (tombstones.some((t) => iou(t, box) >= 0.5)) continue;
    let best = null;
    let bestIou = 0.5;
    for (const o of olds) {
      if (used.has(o.id)) continue;
      const v = iou(o.box, box);
      if (v >= bestIou) { best = o; bestIou = v; }
    }
    if (best) { used.add(best.id); kept.push({ ...best, box, score: d.score, small: isSmallFace(box) }); }
    else fresh.push(makeFace({ box, score: d.score, photoId }));
  }
  let room = Math.max(0, max - includedCount([...kept, ...manual]));
  let leftOff = 0; // new faces listed but switched off because the wheel had no room
  const added = fresh
    .sort((a, b) => b.score - a.score)
    .map((f) => {
      if (room > 0) { room--; return f; }
      leftOff++;
      return { ...f, included: false };
    });
  // Over the cap already (for example after a manual add)? Switch off the lowest-confidence extras.
  const faces = renumber(applyCap([...kept, ...manual, ...added], max));
  return { faces, added: fresh.length, removed: olds.length - used.size, leftOff };
}
