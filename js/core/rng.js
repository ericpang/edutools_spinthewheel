// Unbiased random numbers from the platform's secure generator (WH-5).
const TWO32 = 2 ** 32;

/** A uniformly random unsigned 32-bit integer. */
export function randomUint32() {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0];
}

/**
 * Uniform integer in [0, n). Rejection sampling, so there is no modulo bias.
 * @param {number} n
 * @param {() => number} [rand32] injectable source, for tests
 */
export function randomInt(n, rand32 = randomUint32) {
  if (!Number.isInteger(n) || n < 1 || n > TWO32) throw new RangeError(`randomInt: bad range ${n}`);
  const limit = TWO32 - (TWO32 % n); // a multiple of n; values at or above it would bias the result
  let x;
  do x = rand32(); while (x >= limit);
  return x % n;
}

/** Uniform float in [0, 1). */
export function randomFloat(rand32 = randomUint32) {
  return rand32() / TWO32;
}

/** The default source passed to planSpin. */
export const secureRandom = Object.freeze({
  int: (n) => randomInt(n),
  float: () => randomFloat(),
});
