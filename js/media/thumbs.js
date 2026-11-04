// Thumbnail cache: one 256 px bitmap per face, rebuilt only when the face's box changes.
import { makeThumb } from './photo.js';

const cache = new Map(); // face id -> { sig, canvas }

const signature = (photo, face) => `${photo.id}:${face.box.x.toFixed(1)}:${face.box.y.toFixed(1)}:${face.box.w.toFixed(1)}:${face.box.h.toFixed(1)}`;

/** Cheap string that changes when the thumbnail would change; handy for render keys. */
export const thumbSignature = signature;

export function getThumb(photo, face) {
  const sig = signature(photo, face);
  const hit = cache.get(face.id);
  if (hit && hit.sig === sig) return hit.canvas;
  const canvas = makeThumb(photo, face.box);
  cache.set(face.id, { sig, canvas });
  return canvas;
}

export const dropThumb = (id) => cache.delete(id);
export const clearThumbs = () => cache.clear();

/** Copy a thumbnail into a smaller canvas (used by cards and roster rows). */
export function paintThumb(target, source) {
  const ctx = target.getContext('2d');
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, target.width, target.height);
}
