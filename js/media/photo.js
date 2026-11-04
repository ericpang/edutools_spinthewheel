// Photo intake and image cutting (UP-1 to UP-4, README 5.1 and 5.4). Needs the DOM; the maths lives in core/.
import { LOW_RES_EDGE_PX, MAX_FILE_BYTES, POPOUT_CROP_CAP, THUMB_SIZE, WORKING_COPY_MAX_PIXELS } from '../core/config.js';
import { squareCrop } from '../core/crop.js';
import { mipLevelFor, tilePlacement } from '../core/tiling.js';

export class PhotoError extends Error {
  /** @param {'type'|'size'|'decode'|'memory'} code */
  constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ACCEPTED_EXT = /\.(jpe?g|png|webp)$/i;
let photoCounter = 0;

/** iOS Safari limits canvas area to about 16.7 MP, so the working copy is smaller there. */
function workingCopyCap() {
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return iOS ? 16_000_000 : WORKING_COPY_MAX_PIXELS;
}

function makeCanvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

/** Halve the photo repeatedly. A 2x downscale with bilinear sampling is an exact 2x2 average, and it is fast. */
export function buildPyramid(base) {
  const levels = [base];
  let cur = base;
  while (Math.min(cur.width, cur.height) >= 512) {
    const next = makeCanvas(Math.max(1, cur.width >> 1), Math.max(1, cur.height >> 1));
    const ctx = next.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(cur, 0, 0, next.width, next.height);
    levels.push(next);
    cur = next;
  }
  return levels;
}

/**
 * Decode a photo file into a working copy: EXIF orientation applied (the browser does that when it
 * decodes an <img>), no metadata kept, and capped in size so the tab does not run out of memory.
 * @returns {Promise<{id:string,name:string,width:number,height:number,canvas:HTMLCanvasElement,pyramid:HTMLCanvasElement[],
 *                    downscaledFrom:number|null,lowRes:boolean}>}
 */
export async function loadPhoto(file) {
  if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXT.test(file.name)) throw new PhotoError('type');
  if (file.size > MAX_FILE_BYTES) throw new PhotoError('size', Math.round(MAX_FILE_BYTES / 1048576));

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { throw new PhotoError('decode'); }
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) throw new PhotoError('decode');

    const cap = workingCopyCap();
    const scale = nw * nh > cap ? Math.sqrt(cap / (nw * nh)) : 1;
    const width = Math.max(1, Math.round(nw * scale));
    const height = Math.max(1, Math.round(nh * scale));
    let canvas;
    try {
      canvas = makeCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);
    } catch { throw new PhotoError('memory'); }

    return {
      id: `photo${++photoCounter}`,
      name: file.name,
      width,
      height,
      canvas,
      pyramid: buildPyramid(canvas),
      downscaledFrom: scale < 1 ? Math.round((nw * nh) / 1e6) : null,
      lowRes: Math.max(nw, nh) < LOW_RES_EDGE_PX,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const LETTERBOX = '#767676';

/** Draw one tile of the photo, letterboxed, into the S x S canvas the detector sees (from the best pyramid level). */
export function drawTile(pyramid, tile, S, ctx) {
  const level = Math.min(mipLevelFor(Math.max(tile.w, tile.h), S), pyramid.length - 1);
  const src = pyramid[level];
  const rx = src.width / pyramid[0].width;
  const ry = src.height / pyramid[0].height;
  const { scale, padX, padY } = tilePlacement(tile, S);
  if (padX > 0.5 || padY > 0.5) { ctx.fillStyle = LETTERBOX; ctx.fillRect(0, 0, S, S); }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(src, tile.x * rx, tile.y * ry, tile.w * rx, tile.h * ry, padX, padY, tile.w * scale, tile.h * scale);
}

/** The square crop for a face, drawn into a new canvas `outSize` pixels wide. */
export function cutCrop(photo, box, outSize) {
  const crop = squareCrop(box, photo.width, photo.height);
  const out = makeCanvas(outSize, outSize);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(photo.canvas, crop.x, crop.y, crop.size, crop.size, 0, 0, outSize, outSize);
  return out;
}

/** 256 px thumbnail for the wheel and the roster. */
export const makeThumb = (photo, box) => cutCrop(photo, box, THUMB_SIZE);

/**
 * Full-resolution crop for the pop-out: the photo's own pixels, capped at 1,024 px (README 5.4).
 * A small source is enlarged 3x here with smooth scaling, so the browser's final stretch to the screen is gentler.
 * Nothing is invented: it is only resampling.
 */
export function makeFullCrop(photo, box) {
  const native = Math.round(squareCrop(box, photo.width, photo.height).size);
  const out = native >= 256 ? Math.min(POPOUT_CROP_CAP, native) : Math.min(768, native * 3);
  return cutCrop(photo, box, Math.max(32, out));
}
