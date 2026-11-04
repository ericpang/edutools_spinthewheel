// Duplicate merging (README 5.2 step 4): non-maximum suppression plus a containment rule.
import { MERGE_CONTAINMENT, MERGE_IOU } from './config.js';

export const area = (b) => Math.max(0, b.w) * Math.max(0, b.h);

export function intersection(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function iou(a, b) {
  const inter = intersection(a, b);
  return inter === 0 ? 0 : inter / (area(a) + area(b) - inter);
}

/**
 * Keep the highest-scoring box of every cluster. A box is dropped when it overlaps a higher-scoring box
 * by IoU >= iouThreshold (a duplicate of the same face), or when the smaller of the two is mostly inside
 * the larger (a stray box inside a face, or a loose box around a better one).
 * Each kept box carries `support`: how many raw detections of the same face it stands for.
 * @template {{x:number,y:number,w:number,h:number,score:number}} D
 * @param {D[]} detections
 * @returns {(D & {support:number})[]} highest score first
 */
export function mergeDetections(detections, { iouThreshold = MERGE_IOU, containment = MERGE_CONTAINMENT } = {}) {
  const sorted = detections.map((d) => ({ ...d })).sort((a, b) => b.score - a.score);
  const kept = [];
  for (const d of sorted) {
    let owner = null;
    let duplicate = false;
    for (const k of kept) {
      const inter = intersection(d, k);
      if (inter === 0) continue;
      if (inter / (area(d) + area(k) - inter) >= iouThreshold) { owner = k; duplicate = true; break; }
      if (inter / Math.min(area(d), area(k)) >= containment) { owner = k; break; }
    }
    if (!owner) kept.push(Object.assign(d, { support: 1 }));
    else if (duplicate) owner.support += 1;
  }
  return kept;
}
