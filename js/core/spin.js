// Fair spin (README 6.1 and 6.2). The winner is drawn FIRST; the animation is derived from it.
import { LANDING_MARGIN, SPIN_TURNS } from './config.js';

export const TAU = Math.PI * 2;

/** Modulo that is never negative. */
export const mod = (a, n) => ((a % n) + n) % n;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Monotonic ease-out: no overshoot, so the wheel never appears to change its mind. */
export const easeOutCubic = (x) => 1 - (1 - x) ** 3;

/**
 * Index of the segment under the fixed pointer at 12 o'clock.
 * Segment i spans [i*theta, (i+1)*theta) clockwise from 12 o'clock on the wheel itself;
 * the wheel is rotated clockwise by phi, so the wheel-local angle under the pointer is -phi.
 */
export function segmentUnderPointer(phi, n) {
  const alpha = mod(-phi, TAU);
  return Math.min(n - 1, Math.floor(alpha / (TAU / n)));
}

/** Fractional position (0..1) of the pointer inside the segment it is over. */
export function positionInSegment(phi, n) {
  const theta = TAU / n;
  return (mod(-phi, TAU) % theta) / theta;
}

/**
 * Decide the winner, then compute the rotation that lands inside that segment: `turns` full rounds
 * (3 by default) plus whatever is left of a turn to reach the landing spot.
 * @param {{ n: number, phi: number, random: {int(n:number):number, float():number},
 *           seconds: readonly number[], turns?: number, margin?: readonly number[] }} o
 */
export function planSpin({ n, phi, random, seconds, turns = SPIN_TURNS, margin = LANDING_MARGIN }) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`planSpin: n must be a positive integer, got ${n}`);
  const theta = TAU / n;
  const winner = random.int(n);
  const delta = theta * (margin[0] + (margin[1] - margin[0]) * random.float()); // where in the segment the pointer rests
  const alpha = winner * theta + delta;                                          // wheel-local angle to end under the pointer
  const phiEnd = phi + TAU * turns + mod(-alpha - phi, TAU);                      // always spins forward
  const duration = seconds[1] > 0 ? seconds[0] + (seconds[1] - seconds[0]) * random.float() : 0;
  return { n, winner, phiStart: phi, phiEnd, duration };
}

/** Rotation at time t (seconds) of a plan; time-based so it lasts the same on any refresh rate. */
export function angleAt(plan, t, ease = easeOutCubic) {
  if (plan.duration <= 0) return plan.phiEnd;
  return plan.phiStart + (plan.phiEnd - plan.phiStart) * ease(clamp(t / plan.duration, 0, 1));
}
