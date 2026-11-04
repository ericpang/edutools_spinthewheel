// Wheel geometry shared by the renderer, hit-testing and the pop-out animation (README 6.1, 6.3, 6.4).
import { THUMB_RING_FRACTION } from './config.js';
import { TAU, mod } from './spin.js';

/** Angle of one segment. */
export const segmentAngle = (n) => TAU / n;

/**
 * Where the face thumbnail sits inside a segment: centred on the segment's centre line at
 * ringFraction x R, diameter = min(0.9 x segment width at that radius, 0.4 x R).
 */
export function thumbLayout(R, n, ringFraction = THUMB_RING_FRACTION) {
  const radius = R * ringFraction;
  const chord = n === 1 ? 2 * radius : 2 * radius * Math.sin(Math.PI / n);
  return { radius, diameter: Math.min(0.9 * chord, 0.4 * R) };
}

/** Absolute angle (clockwise from 12 o'clock) of the centre line of segment i, for rotation phi. */
export const segmentCentre = (i, n, phi) => (i + 0.5) * (TAU / n) + phi;

/** Convert an angle measured clockwise from 12 o'clock to a canvas angle (0 = 3 o'clock, clockwise). */
export const toCanvasAngle = (a) => a - Math.PI / 2;

/**
 * Which segment is at (x, y)? -1 for the hub and for anything outside the rim.
 * @param {{x:number,y:number,cx:number,cy:number,R:number,hubR:number,phi:number,n:number}} o
 */
export function hitSegment({ x, y, cx, cy, R, hubR, phi, n }) {
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.hypot(dx, dy);
  if (r < hubR || r > R) return -1;
  const absolute = mod(Math.atan2(dx, -dy), TAU);     // clockwise from 12 o'clock
  const local = mod(absolute - phi, TAU);             // undo the wheel's rotation
  return Math.min(n - 1, Math.floor(local / (TAU / n)));
}

/** Screen position of the centre of segment i's thumbnail. */
export function thumbCentre({ i, n, phi, cx, cy, R }) {
  const { radius } = thumbLayout(R, n);
  const a = segmentCentre(i, n, phi);
  return { x: cx + radius * Math.sin(a), y: cy - radius * Math.cos(a) };
}

/**
 * Palette index for each segment so that neighbours, including last and first, never share a colour (WH-1).
 * @param {number} n @param {number} paletteLength at least 3
 */
export function paletteIndices(n, paletteLength) {
  const L = paletteLength;
  const out = Array.from({ length: n }, (_, i) => i % L);
  if (n > 2 && out[n - 1] === out[0]) {
    let c = (out[n - 1] + 1) % L;
    if (c === out[n - 2] || c === out[0]) c = (c + 1) % L;
    if (c === out[n - 2] || c === out[0]) c = (c + 1) % L;
    out[n - 1] = c;
  }
  return out;
}
