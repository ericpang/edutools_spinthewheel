// Crop geometry (README 5.4). Pure maths: no canvas, no DOM.
import { CROP_PADDING, CROP_SHIFT_UP, SMALL_FACE_PX } from './config.js';
import { clamp } from './spin.js';

/**
 * Square crop around a face box: side = padding x the longer box side, centred on the box and
 * shifted up a little so hair and forehead are included. Shifted back inside the photo if it
 * would leave it, and shrunk to the largest square that fits if the photo is smaller.
 * @param {{x:number,y:number,w:number,h:number}} box
 * @returns {{x:number,y:number,size:number}}
 */
export function squareCrop(box, imgW, imgH, { padding = CROP_PADDING, shiftUp = CROP_SHIFT_UP } = {}) {
  const side = Math.min(padding * Math.max(box.w, box.h), imgW, imgH);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2 - shiftUp * box.h;
  return {
    x: clamp(cx - side / 2, 0, imgW - side),
    y: clamp(cy - side / 2, 0, imgH - side),
    size: side,
  };
}

/** The photo area shown by "Show in class photo": about four face-boxes wide, no upward shift. */
export const contextWindow = (box, imgW, imgH, factor = 4) => squareCrop(box, imgW, imgH, { padding: factor, shiftUp: 0 });

/** A "small face" is a box shorter than 48 px on its shorter side. */
export const isSmallFace = (box) => Math.min(box.w, box.h) < SMALL_FACE_PX;

/** Keep a box inside the photo. */
export function clampBox(box, imgW, imgH) {
  const x = clamp(box.x, 0, imgW);
  const y = clamp(box.y, 0, imgH);
  return { x, y, w: clamp(box.x + box.w, 0, imgW) - x, h: clamp(box.y + box.h, 0, imgH) - y };
}
