// Multi-scale tiling plan for finding small faces (README 5.2). Pure maths.
import { MIN_FACE_FRACTION, TILE_OVERLAP } from './config.js';

/** Smallest tile edge ever used: a 16 px face (the smallest the app searches for) fills MIN_FACE_FRACTION of it. */
export const LADDER_BASE = Math.round(16 / MIN_FACE_FRACTION);

/**
 * Pyramid of tile sizes. Tile edges are a fixed ladder (LADDER_BASE x 2^k), so a higher sensitivity only
 * adds finer levels and the ones already searched can be reused. The smallest tile is the largest rung in
 * which a face of the smallest target size still fills at least MIN_FACE_FRACTION of the tile; the last
 * level is the whole photo in one letterboxed tile.
 * @returns {{edge:number, kind:'tile'|'global', key:string}[]}
 */
export function planLevels({ width, height, smallestFace, minFaceFraction = MIN_FACE_FRACTION }) {
  const shorter = Math.min(width, height);
  const wanted = smallestFace / minFaceFraction;
  let edge = LADDER_BASE;
  while (edge * 2 <= wanted) edge *= 2;
  const levels = [];
  for (; edge < shorter; edge *= 2) levels.push({ edge, kind: 'tile', key: `tile:${edge}` });
  const whole = Math.max(width, height);
  levels.push({ edge: whole, kind: 'global', key: `global:${whole}` });
  return levels;
}

/** Evenly spaced start positions, first at 0 and last flush with the far border, never further apart than `stride`. */
function positions(total, size, stride) {
  if (size >= total) return [0];
  const span = total - size;
  const count = Math.ceil(span / stride) + 1;
  return Array.from({ length: count }, (_, i) => Math.round((span * i) / (count - 1)));
}

/** Overlapping tiles of one level, in photo pixels. */
export function planTiles({ width, height, edge, overlap = TILE_OVERLAP }) {
  const w = Math.min(edge, width);
  const h = Math.min(edge, height);
  const stride = Math.max(1, Math.round(edge * (1 - overlap)));
  const tiles = [];
  for (const y of positions(height, h, stride)) for (const x of positions(width, w, stride)) tiles.push({ x, y, w, h });
  return tiles;
}

/** How a tile is letterboxed into the S x S image the model sees. */
export function tilePlacement(tile, S) {
  const scale = S / Math.max(tile.w, tile.h);
  return { scale, padX: (S - tile.w * scale) / 2, padY: (S - tile.h * scale) / 2 };
}

/** Map a box found in the S x S tile image back to photo pixels. */
export function tileBoxToPhoto(box, tile, S) {
  const { scale, padX, padY } = tilePlacement(tile, S);
  return { x: tile.x + (box.x - padX) / scale, y: tile.y + (box.y - padY) / scale, w: box.w / scale, h: box.h / scale, score: box.score };
}

/**
 * A box touching an *interior* tile edge is probably a cut-off face; a whole copy exists in a
 * neighbouring tile or at a larger level. The photo's own border is not a tile edge.
 */
export function touchesInteriorEdge(box, tile, photoW, photoH, margin) {
  return (tile.x > 0 && box.x < tile.x + margin)
    || (tile.x + tile.w < photoW && box.x + box.w > tile.x + tile.w - margin)
    || (tile.y > 0 && box.y < tile.y + margin)
    || (tile.y + tile.h < photoH && box.y + box.h > tile.y + tile.h - margin);
}

/** How many times to halve the photo so that a tile drawn from it is at most a 2x downscale. */
export const mipLevelFor = (tileSide, targetPx) => Math.max(0, Math.floor(Math.log2(tileSide / targetPx)));
