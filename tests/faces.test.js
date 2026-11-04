import { assert, test } from './harness.js';
import { MAX_FACES } from '../js/core/config.js';
import { applyCap, displayName, eligibleFaces, includedCount, makeFace, mergeRedetected, renumber, summarize } from '../js/core/faces.js';

const det = (x, y, size, score) => ({ x, y, w: size, h: size, score });
const grid = (count, score = () => 0.9) => Array.from({ length: count }, (_, i) => det((i % 10) * 100, Math.floor(i / 10) * 100, 60, score(i)));

test('faces are numbered 1..N in reading order', () => {
  const { faces } = mergeRedetected({ detections: [det(300, 0, 60, 0.9), det(0, 0, 60, 0.9), det(150, 130, 60, 0.9)] });
  assert.deepEqual(faces.map((f) => [f.num, f.box.x, f.box.y]), [[1, 0, 0], [2, 300, 0], [3, 150, 130]]);
});

test('FD-8 / AC-11: 55 faces found gives 50 included, the 5 lowest-confidence switched off', () => {
  const { faces, leftOff } = mergeRedetected({ detections: grid(55, (i) => 0.5 + i * 0.008) });
  assert.equal(faces.length, 55);
  assert.equal(leftOff, 5, 'the merge reports how many faces the cap left off, for the notice');
  assert.equal(includedCount(faces), MAX_FACES);
  const off = faces.filter((f) => !f.included);
  assert.equal(off.length, 5);
  const lowestOn = Math.min(...faces.filter((f) => f.included).map((f) => f.score));
  assert.ok(off.every((f) => f.score <= lowestOn), 'the switched-off faces are the least confident');
});

test('applyCap never touches faces when there is room, and ranks hand-drawn faces as certain', () => {
  const faces = renumber(grid(10).map((d) => makeFace({ box: { x: d.x, y: d.y, w: d.w, h: d.h }, score: d.score })));
  assert.equal(includedCount(applyCap(faces, 50)), 10);
  const manual = makeFace({ box: { x: 5, y: 5, w: 60, h: 60 }, source: 'manual' });
  const capped = applyCap([...faces, manual], 10);
  assert.ok(capped.find((f) => f.id === manual.id).included, 'a hand-drawn face is kept over automatic ones');
  assert.equal(includedCount(capped), 10);
});

test('re-detection keeps labels, switches and hand-drawn faces, and honours deleted faces', () => {
  const first = mergeRedetected({ detections: [det(0, 0, 60, 0.9), det(200, 0, 60, 0.8), det(400, 0, 60, 0.7)] }).faces;
  let faces = first.map((f) => (f.num === 1 ? { ...f, label: 'Ana' } : f.num === 2 ? { ...f, included: false } : f));
  const manual = makeFace({ box: { x: 600, y: 0, w: 60, h: 60 }, source: 'manual' });
  faces = renumber([...faces, manual]);
  const deleted = faces.find((f) => f.num === 3).box;
  faces = faces.filter((f) => f.num !== 3);

  const again = mergeRedetected({
    oldFaces: faces,
    tombstones: [deleted],
    detections: [det(2, 1, 60, 0.95), det(201, 2, 60, 0.85), det(401, 0, 60, 0.75), det(800, 0, 60, 0.6)],
  });
  const byBox = (x) => again.faces.find((f) => Math.abs(f.box.x - x) < 5);
  assert.equal(byBox(0).label, 'Ana');
  assert.equal(byBox(200).included, false, 'the teacher\'s switch is kept');
  assert.equal(byBox(400), undefined, 'a face the teacher deleted stays deleted');
  assert.ok(again.faces.some((f) => f.source === 'manual' && f.id === manual.id));
  assert.equal(again.added, 1);
  assert.equal(again.faces.length, 4);
});

test('new faces from a re-scan only fill the room that is left; included faces are never bumped', () => {
  const full = mergeRedetected({ detections: grid(50, () => 0.6) }).faces;
  assert.equal(includedCount(full), 50);
  const again = mergeRedetected({ oldFaces: full, detections: [...grid(50, () => 0.6), det(2000, 2000, 60, 0.99)] });
  assert.equal(includedCount(again.faces), 50);
  assert.equal(again.faces.length, 51);
  const newcomer = again.faces.find((f) => f.box.x === 2000);
  assert.equal(newcomer.included, false, 'no room, so the newcomer is listed but switched off');
});

test('eligible faces: included ones, minus picked ones when picked faces are removed', () => {
  const faces = [
    { ...makeFace({ box: { x: 0, y: 0, w: 50, h: 50 } }), pickCount: 0 },
    { ...makeFace({ box: { x: 100, y: 0, w: 50, h: 50 } }), pickCount: 2 },
    { ...makeFace({ box: { x: 200, y: 0, w: 50, h: 50 } }), included: false },
  ];
  assert.equal(eligibleFaces(faces, 'keep').length, 2);
  assert.equal(eligibleFaces(faces, 'remove').length, 1);
});

test('display name is the label, or #N', () => {
  const f = { ...makeFace({ box: { x: 0, y: 0, w: 50, h: 50 } }), num: 17 };
  assert.equal(displayName(f), '#17');
  assert.equal(displayName({ ...f, label: '  Ana M. ' }), 'Ana M.');
  assert.deepEqual(summarize([f, { ...f, small: true }]), { found: 2, included: 2, small: 1, low: 0 });
  assert.equal(summarize([{ ...f, score: 0.5 }, { ...f, score: 0.9 }, f]).low, 1, 'only automatic detections below 0.65 are weak');
});
