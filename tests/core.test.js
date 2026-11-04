import { assert, test } from './harness.js';
import { SENSITIVITY, MAX_FACES } from '../js/core/config.js';
import { randomInt, secureRandom } from '../js/core/rng.js';
import { TAU, angleAt, mod, planSpin, positionInSegment, segmentUnderPointer } from '../js/core/spin.js';
import { hitSegment, paletteIndices, thumbCentre, thumbLayout } from '../js/core/wheel-geometry.js';
import { clampBox, contextWindow, isSmallFace, squareCrop } from '../js/core/crop.js';
import { iou, mergeDetections } from '../js/core/nms.js';
import { mipLevelFor, planLevels, planTiles, tileBoxToPhoto, touchesInteriorEdge } from '../js/core/tiling.js';
import { readingOrder } from '../js/core/reading-order.js';

// ---------------------------------------------------------------- rng (AC-5)
test('randomInt stays in range and rejects bad input', () => {
  for (let i = 0; i < 2000; i++) { const v = randomInt(7); assert.ok(Number.isInteger(v) && v >= 0 && v < 7); }
  assert.throws(() => randomInt(0));
  assert.throws(() => randomInt(1.5));
});

test('randomInt rejects values that would bias the result (rejection sampling)', () => {
  // For n = 3 the limit is 2^32 - 1, so 2^32 - 1 must be skipped and the next value used.
  const seq = [2 ** 32 - 1, 7];
  assert.equal(randomInt(3, () => seq.shift()), 7 % 3);
  assert.equal(seq.length, 0, 'both values should have been consumed');
});

test('AC-5: over 100,000 draws with N = 31 every index is within 5 standard deviations', () => {
  const n = 31;
  const draws = 100_000;
  const counts = new Array(n).fill(0);
  for (let i = 0; i < draws; i++) counts[randomInt(n)]++;
  const p = 1 / n;
  const sigma = Math.sqrt(draws * p * (1 - p));
  counts.forEach((c, i) => assert.ok(Math.abs(c - draws * p) <= 5 * sigma, `index ${i} count ${c} is off`));
});

// ---------------------------------------------------------------- spin (AC-6)
test('AC-6: for N = 2..50 the segment under the pointer at the end is the drawn winner, never near an edge', () => {
  for (let n = 2; n <= MAX_FACES; n++) {
    for (let k = 0; k < 400; k++) {
      const phi = (Math.random() - 0.5) * 200; // any starting rotation, negative and large included
      const plan = planSpin({ n, phi, random: secureRandom, seconds: [4, 6] });
      assert.equal(segmentUnderPointer(plan.phiEnd, n), plan.winner, `N=${n}`);
      const pos = positionInSegment(plan.phiEnd, n);
      assert.ok(pos >= 0.15 - 1e-9 && pos <= 0.85 + 1e-9, `rests at ${pos} of the segment (N=${n})`);
    }
  }
});

test('a spin makes 3 full rounds, plus the rest of a turn to the landing spot, and lasts 4 to 6 seconds', () => {
  for (let k = 0; k < 500; k++) {
    const plan = planSpin({ n: 1 + (k % 50), phi: Math.random() * TAU, random: secureRandom, seconds: [4, 6] });
    const rounds = (plan.phiEnd - plan.phiStart) / TAU;
    assert.ok(rounds >= 3 - 1e-9 && rounds < 4, `${rounds.toFixed(3)} rounds`);
    assert.ok(plan.duration >= 4 && plan.duration <= 6);
  }
});

test('reduced motion plan: no extra turns, no duration, still lands on the winner', () => {
  for (let n = 2; n <= 50; n += 7) {
    const plan = planSpin({ n, phi: 1.234, random: secureRandom, seconds: [0, 0], turns: 0 });
    assert.equal(plan.duration, 0);
    assert.ok(plan.phiEnd - plan.phiStart < TAU);
    assert.equal(angleAt(plan, 0), plan.phiEnd);
    assert.equal(segmentUnderPointer(plan.phiEnd, n), plan.winner);
  }
});

test('the rotation is monotonic and ends exactly at phiEnd', () => {
  const plan = planSpin({ n: 12, phi: 0.5, random: secureRandom, seconds: [4, 6] });
  let last = angleAt(plan, 0);
  assert.close(last, plan.phiStart);
  for (let t = 0.05; t <= plan.duration + 1; t += 0.05) {
    const a = angleAt(plan, t);
    assert.ok(a >= last - 1e-12, 'went backwards');
    last = a;
  }
  assert.close(last, plan.phiEnd);
});

test('mod is never negative; a single segment is allowed', () => {
  assert.close(mod(-1, TAU), TAU - 1);
  assert.equal(planSpin({ n: 1, phi: 0, random: secureRandom, seconds: [1, 1] }).winner, 0);
  assert.throws(() => planSpin({ n: 0, phi: 0, random: secureRandom, seconds: [1, 1] }));
});

// ---------------------------------------------------------------- wheel geometry
test('hit-testing agrees with the pointer maths for any rotation', () => {
  const cx = 300, cy = 300, R = 250, hubR = 40;
  for (let k = 0; k < 600; k++) {
    const n = 2 + (k % 49);
    const phi = (Math.random() - 0.5) * 100;
    // the pointer is at 12 o'clock, so a point just inside the rim at the top is "under" it
    assert.equal(hitSegment({ x: cx, y: cy - 0.9 * R, cx, cy, R, hubR, phi, n }), segmentUnderPointer(phi, n));
  }
});

test('hub and outside the rim are not segments', () => {
  const o = { cx: 100, cy: 100, R: 80, hubR: 15, phi: 0.3, n: 8 };
  assert.equal(hitSegment({ ...o, x: 100, y: 100 }), -1);
  assert.equal(hitSegment({ ...o, x: 100, y: 5 }), -1);
  assert.ok(hitSegment({ ...o, x: 100, y: 40 }) >= 0);
});

test('a click on a thumbnail centre hits that thumbnail\'s segment', () => {
  const o = { cx: 300, cy: 300, R: 250, hubR: 40 };
  for (const n of [2, 5, 13, 31, 50]) for (const phi of [0, 1.3, -4, 25]) for (let i = 0; i < n; i++) {
    const c = thumbCentre({ i, n, phi, ...o });
    assert.equal(hitSegment({ x: c.x, y: c.y, ...o, phi, n }), i);
  }
});

test('thumbnail sizes match the README (about 40 px for 30 faces, 25 px for 50, on a 600 px wheel)', () => {
  assert.close(thumbLayout(300, 30).diameter, 41.8, 0.3);
  assert.close(thumbLayout(300, 50).diameter, 25.1, 0.3);
  assert.close(thumbLayout(300, 2).diameter, 0.4 * 300);
});

test('neighbouring segments, last and first included, never share a colour (WH-1)', () => {
  for (const L of [3, 4, 8, 10]) for (let n = 2; n <= 60; n++) {
    const idx = paletteIndices(n, L);
    for (let i = 0; i < n; i++) {
      const next = idx[(i + 1) % n];
      if (n > 1) assert.ok(idx[i] !== next, `L=${L} n=${n} i=${i}`);
      assert.ok(idx[i] >= 0 && idx[i] < L);
    }
  }
});

// ---------------------------------------------------------------- crop
test('squareCrop is square, padded, and stays inside the photo', () => {
  const c = squareCrop({ x: 100, y: 100, w: 50, h: 60 }, 1000, 800);
  assert.close(c.size, 1.8 * 60);
  assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.size <= 1000 && c.y + c.size <= 800);
  const corner = squareCrop({ x: 0, y: 0, w: 40, h: 40 }, 1000, 800);
  assert.equal(corner.x, 0); assert.equal(corner.y, 0);
  const far = squareCrop({ x: 980, y: 780, w: 40, h: 40 }, 1000, 800);
  assert.ok(far.x + far.size <= 1000 + 1e-9 && far.y + far.size <= 800 + 1e-9);
});

test('squareCrop shrinks to the largest square when the photo is smaller than the crop', () => {
  const c = squareCrop({ x: 10, y: 10, w: 90, h: 90 }, 120, 100);
  assert.equal(c.size, 100);
  assert.ok(c.x >= 0 && c.x + c.size <= 120);
});

test('small faces are those with a shorter side under 48 px', () => {
  assert.ok(isSmallFace({ x: 0, y: 0, w: 47, h: 90 }));
  assert.ok(!isSmallFace({ x: 0, y: 0, w: 48, h: 48 }));
  assert.ok(contextWindow({ x: 500, y: 500, w: 50, h: 50 }, 2000, 2000).size === 200);
  assert.deepEqual(clampBox({ x: -5, y: -5, w: 20, h: 20 }, 100, 100), { x: 0, y: 0, w: 15, h: 15 });
});

// ---------------------------------------------------------------- merging
const box = (x, y, w, h, score = 0.9) => ({ x, y, w, h, score });

test('duplicates are merged and the highest score wins; support counts the duplicates', () => {
  const kept = mergeDetections([box(100, 100, 50, 50, 0.6), box(102, 101, 50, 50, 0.9), box(98, 99, 52, 52, 0.7)]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].score, 0.9);
  assert.equal(kept[0].support, 3);
});

test('separate faces are kept, and a stray box mostly inside a higher-scoring one is dropped', () => {
  assert.equal(mergeDetections([box(0, 0, 50, 50), box(200, 0, 50, 50)]).length, 2);
  const kept = mergeDetections([box(0, 0, 100, 100, 0.9), box(30, 30, 40, 40, 0.6)]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].support, 1, 'a contained stray box is not a duplicate of the same face');
});

test('a loose lower-scoring box around a better face is dropped too', () => {
  const kept = mergeDetections([box(100, 100, 100, 100, 0.72), box(120, 125, 60, 60, 0.9)]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].score, 0.9);
});

test('iou is symmetric and bounded', () => {
  const a = box(0, 0, 10, 10), b = box(5, 5, 10, 10);
  assert.close(iou(a, b), iou(b, a));
  assert.close(iou(a, a), 1);
  assert.equal(iou(a, box(50, 50, 5, 5)), 0);
});

// ---------------------------------------------------------------- tiling
test('levels start at the smallest face and double up to a whole-photo level', () => {
  const levels = planLevels({ width: 3000, height: 2171, smallestFace: SENSITIVITY.normal.smallest });
  assert.deepEqual(levels.map((l) => l.edge), [188, 376, 752, 1504, 3000]);
  assert.equal(levels.at(-1).kind, 'global');
  assert.equal(planLevels({ width: 100, height: 80, smallestFace: 32 }).length, 1, 'a tiny photo is searched in one go');
  assert.ok(planLevels({ width: 3000, height: 2171, smallestFace: 16 }).length > levels.length, 'higher sensitivity searches more levels');
});

test('levels sit on a fixed ladder, so a higher sensitivity only adds finer levels (the cache is reused)', () => {
  const keys = (smallestFace) => planLevels({ width: 3000, height: 2171, smallestFace }).map((l) => l.key);
  const normal = keys(SENSITIVITY.normal.smallest);
  const max = keys(SENSITIVITY.max.smallest);
  assert.deepEqual(max.slice(-normal.length), normal, 'every level Normal searches is also searched by Max');
  assert.deepEqual(keys(SENSITIVITY.low.smallest), normal, 'Low and Normal share their levels');
  assert.deepEqual(keys(SENSITIVITY.high.smallest), max);
});

test('tiles cover the whole photo, stay inside it and overlap', () => {
  for (const [W, H, edge] of [[3000, 2171, 188], [3000, 2171, 752], [1000, 1010, 400], [640, 480, 188], [5000, 3000, 1504]]) {
    const tiles = planTiles({ width: W, height: H, edge });
    const xs = new Set(), ys = new Set();
    for (const t of tiles) {
      assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= W && t.y + t.h <= H, 'inside');
      xs.add(t.x); ys.add(t.y);
    }
    const sorted = (s) => [...s].sort((a, b) => a - b);
    for (const [vals, total, size] of [[sorted(xs), W, Math.min(edge, W)], [sorted(ys), H, Math.min(edge, H)]]) {
      assert.equal(vals[0], 0);
      assert.equal(vals.at(-1) + size, total, 'flush with the far border');
      // a face up to 34% of the tile must lie whole in some tile: neighbours must overlap by at least that
      for (let i = 1; i < vals.length; i++) assert.ok(edge - (vals[i] - vals[i - 1]) >= 0.34 * edge - 1, 'consecutive tiles overlap by 34% or more');
    }
    assert.equal(tiles.length, xs.size * ys.size);
  }
});

test('boxes map back from the tile image to photo pixels, letterboxed tiles included', () => {
  const square = { x: 100, y: 200, w: 500, h: 500 };
  const b = tileBoxToPhoto({ x: 128, y: 64, w: 32, h: 32, score: 0.8 }, square, 256);
  assert.close(b.x, 100 + 128 * (500 / 256)); assert.close(b.y, 200 + 64 * (500 / 256)); assert.close(b.w, 32 * (500 / 256));
  const wide = { x: 0, y: 0, w: 1000, h: 500 }; // letterboxed: scale 0.256, vertical padding 64
  const c = tileBoxToPhoto({ x: 0, y: 64, w: 25.6, h: 25.6, score: 1 }, wide, 256);
  assert.close(c.x, 0); assert.close(c.y, 0); assert.close(c.w, 100);
});

test('only interior tile edges cut a face; the photo border does not', () => {
  const tile = { x: 100, y: 0, w: 200, h: 200 };
  assert.ok(touchesInteriorEdge({ x: 101, y: 50, w: 30, h: 30 }, tile, 1000, 1000, 4), 'left edge is interior');
  assert.ok(!touchesInteriorEdge({ x: 150, y: 1, w: 30, h: 30 }, tile, 1000, 1000, 4), 'top edge is the photo border');
  assert.ok(touchesInteriorEdge({ x: 150, y: 150, w: 30, h: 49 }, tile, 1000, 1000, 4), 'bottom edge is interior');
  assert.ok(!touchesInteriorEdge({ x: 150, y: 50, w: 30, h: 30 }, tile, 1000, 1000, 4));
});

test('mip level keeps the final downscale at or under 2x', () => {
  assert.equal(mipLevelFor(188, 256), 0);
  assert.equal(mipLevelFor(376, 256), 0);
  assert.equal(mipLevelFor(512, 256), 1);
  assert.equal(mipLevelFor(3000, 256), 3);
});

// ---------------------------------------------------------------- reading order (FD-5)
test('faces are ordered in rows from top to bottom, left to right', () => {
  const mk = (id, x, y) => ({ id, box: { x, y, w: 40, h: 50 } });
  const items = [mk('b2', 300, 205), mk('a3', 500, 12), mk('a1', 100, 0), mk('b1', 110, 195), mk('a2', 310, 8), mk('b3', 520, 190)];
  assert.deepEqual(readingOrder(items).map((i) => i.id), ['a1', 'a2', 'a3', 'b1', 'b2', 'b3']);
  assert.deepEqual(readingOrder([]), []);
  assert.equal(readingOrder([mk('x', 1, 1)]).length, 1);
});
