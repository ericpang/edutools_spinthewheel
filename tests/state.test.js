import { assert, test } from './harness.js';
import { MAX_FACES } from '../js/core/config.js';
import { includedCount } from '../js/core/faces.js';
import { actions, faceById, getState, resetState, selectedFace, subscribe, wheelFaces } from '../js/state.js';

const photo = { id: 'p1', name: 'class.jpg', width: 3000, height: 2000, canvas: null, pyramid: [], downscaledFrom: null, lowRes: false };
const dets = (count, score = () => 0.9) => Array.from({ length: count }, (_, i) => ({ x: (i % 10) * 100, y: Math.floor(i / 10) * 100, w: 60, h: 60, score: score(i) }));
const setup = (count = 10, score) => { resetState(); actions.setPhoto(photo); actions.detectionDone(dets(count, score)); return getState(); };
const toWheel = (count = 6) => { setup(count); actions.buildWheel(); };

test('setPhoto starts a detection request and moves to the review screen', () => {
  resetState();
  actions.setPhoto(photo);
  const s = getState();
  assert.equal(s.screen, 'review');
  assert.equal(s.detect.status, 'running');
  assert.equal(s.detect.requestId, 1);
});

test('subscribers get the real previous state, also after startOver', () => {
  setup(4);
  actions.buildWheel();
  const seen = [];
  subscribe((s, prev) => seen.push([prev.screen, s.screen]));
  actions.startOver();
  assert.deepEqual(seen.at(-1), ['wheel', 'upload']);
  assert.equal(getState().faces.length, 0);
});

test('AC-11: 55 faces found gives 50 included, 5 listed but off, with a notice; swapping works', () => {
  let s = setup(55, (i) => 0.5 + i * 0.008);
  assert.equal(s.faces.length, 55);
  assert.equal(includedCount(s.faces), MAX_FACES);
  assert.ok(s.notices.some((n) => n.text.includes('Only 50 faces fit on one wheel')));
  const off = s.faces.find((f) => !f.included);
  const noticesBefore = s.notices.length;
  actions.toggleIncluded(off.id, true);
  s = getState();
  assert.equal(faceById(s, off.id).included, false, 'the wheel is full, so the switch is refused');
  assert.equal(s.notices.length, noticesBefore + 1);
  actions.toggleIncluded(s.faces.find((f) => f.included).id, false);
  actions.toggleIncluded(off.id, true);
  s = getState();
  assert.equal(faceById(s, off.id).included, true);
  assert.equal(includedCount(s.faces), MAX_FACES);
});

test('a re-scan that runs into the cap also tells the teacher', () => {
  setup(10);
  assert.ok(!getState().notices.some((n) => n.text.includes('Only 50 faces')), 'no cap notice below the limit');
  actions.detectionDone(dets(70, (i) => 0.9 - i * 0.003));
  const s = getState();
  assert.equal(includedCount(s.faces), MAX_FACES);
  assert.ok(s.notices.some((n) => n.text.includes('Only 50 faces fit on one wheel. 20 faces were left off')), s.notices.map((n) => n.text).join(' | '));
});

test('delete, undo and redo; a deleted automatic face is remembered so a re-scan does not bring it back', () => {
  setup(5);
  const victim = getState().faces[2];
  actions.deleteFace(victim.id);
  assert.equal(getState().faces.length, 4);
  assert.equal(getState().tombstones.length, 1);
  actions.undo();
  assert.equal(getState().faces.length, 5);
  assert.equal(getState().tombstones.length, 0);
  actions.redo();
  assert.equal(getState().faces.length, 4);
  actions.detectionDone(dets(5));
  assert.equal(getState().faces.length, 4, 'the deleted face stays deleted after a re-scan');
});

test('numbers stay 1..N after a delete', () => {
  setup(4);
  actions.deleteFace(getState().faces[0].id);
  assert.deepEqual(getState().faces.map((f) => f.num), [1, 2, 3]);
});

test('addManualFace rejects tiny boxes and adds a numbered, included face', () => {
  setup(3);
  assert.equal(actions.addManualFace({ x: 5, y: 5, w: 4, h: 4 }), null);
  const id = actions.addManualFace({ x: 700, y: 700, w: 80, h: 80 });
  const face = faceById(getState(), id);
  assert.ok(face && face.source === 'manual' && face.included);
  assert.equal(getState().faces.length, 4);
});

test('a hand-drawn face over the cap is kept but switched off', () => {
  setup(50);
  const id = actions.addManualFace({ x: 900, y: 900, w: 80, h: 80 });
  assert.equal(faceById(getState(), id).included, false);
});

test('the wheel needs at least 2 included faces', () => {
  setup(3);
  actions.includeNone();
  actions.buildWheel();
  assert.equal(getState().screen, 'review');
  actions.toggleIncluded(getState().faces[0].id, true);
  actions.buildWheel();
  assert.equal(getState().screen, 'review', 'one face is still not enough');
  actions.toggleIncluded(getState().faces[1].id, true);
  actions.buildWheel();
  assert.equal(getState().screen, 'wheel');
});

test('spin: the winner is drawn first, the plan lands on it, and finishing records the pick', () => {
  toWheel(6);
  assert.ok(actions.requestSpin());
  let s = getState();
  assert.equal(s.wheel.phase, 'spinning');
  assert.equal(s.wheel.plan.n, 6);
  assert.equal(wheelFaces(s)[s.wheel.plan.winner].id, s.wheel.plan.winnerId);
  assert.equal(actions.requestSpin(), false, 'a second spin while spinning is ignored');
  const winnerId = s.wheel.plan.winnerId;
  actions.finishSpin();
  s = getState();
  assert.equal(s.wheel.phase, 'selected');
  assert.equal(selectedFace(s).id, winnerId);
  assert.equal(faceById(s, winnerId).pickCount, 1);
  assert.deepEqual(s.wheel.picks, [winnerId]);
  assert.ok(s.live.text.startsWith('Selected:'));
});

test('reduced motion: no animation time and no extra turns', () => {
  toWheel(6);
  actions.setEnv({ reducedMotion: true });
  actions.requestSpin();
  const { plan } = getState().wheel;
  assert.equal(plan.duration, 0);
  assert.ok(plan.phiEnd - plan.phiStart < 2 * Math.PI);
});

test('"always spin" restores the full spin (3 rounds, real duration) on a device that asks for reduced motion', () => {
  toWheel(6);
  actions.setEnv({ reducedMotion: true });
  actions.updateSettings({ motion: 'always' });
  actions.requestSpin();
  const { plan } = getState().wheel;
  actions.updateSettings({ motion: 'system' }); // settings outlive a single test
  assert.ok(plan.duration > 0, 'the spin takes time');
  assert.ok(plan.phiEnd - plan.phiStart >= 3 * 2 * Math.PI, 'at least 3 full rounds');
  actions.setEnv({ reducedMotion: false });
});

test('"remove picked": the wheel keeps its layout while the result is shown, then drops the winner on the next spin', () => {
  toWheel(4);
  actions.updateSettings({ afterPick: 'remove' });
  actions.requestSpin();
  const winnerId = getState().wheel.plan.winnerId;
  actions.finishSpin();
  assert.equal(wheelFaces(getState()).length, 4, 'the picked face is still on the wheel under the pointer');
  assert.ok(wheelFaces(getState()).some((f) => f.id === winnerId));
  actions.requestSpin();
  assert.equal(wheelFaces(getState()).length, 3);
  assert.ok(!wheelFaces(getState()).some((f) => f.id === winnerId));
  actions.finishSpin();
  actions.requestSpin(); actions.finishSpin();
  actions.requestSpin(); actions.finishSpin();
  assert.equal(actions.requestSpin(), false, 'everyone has been picked');
  assert.ok(getState().live.text.includes('Everyone has been picked'));
  actions.resetPicks();
  assert.ok(actions.requestSpin());
  assert.equal(getState().wheel.plan.n, 4);
});

test('switching a face on or off drops the shown result (the wheel is re-laid out)', () => {
  toWheel(5);
  actions.requestSpin(); actions.finishSpin();
  assert.equal(getState().wheel.phase, 'selected');
  actions.toggleIncluded(getState().faces[0].id, false);
  assert.equal(getState().wheel.phase, 'idle');
  assert.equal(getState().wheel.selectedId, null);
});

test('pop-out: opens for a face, closes, and Remove switches the face off', () => {
  toWheel(5);
  const id = getState().faces[1].id;
  actions.openPopout({ faceId: id, origin: { x: 1, y: 2, size: 30 } });
  assert.ok(getState().popout.open);
  assert.equal(actions.requestSpin(), false, 'no spinning behind an open pop-out');
  actions.setPopoutContext(true);
  assert.ok(getState().popout.context);
  actions.removeFromWheel(id);
  assert.ok(!getState().popout.open);
  assert.equal(faceById(getState(), id).included, false);
  actions.openPopout({ faceId: 'nope' });
  assert.ok(!getState().popout.open);
});

test('sensitivity change asks for a new detection; cancel returns to the upload screen only for the first scan', () => {
  setup(5);
  const before = getState().detect.requestId;
  actions.setSensitivity('high');
  assert.equal(getState().detect.requestId, before + 1);
  assert.equal(getState().detect.kind, 'redetect');
  actions.cancelDetection();
  assert.equal(getState().screen, 'review');
  assert.equal(getState().detect.status, 'done');
  actions.setSensitivity('high');
  assert.equal(getState().detect.requestId, before + 1, 'same level: nothing to do');

  resetState();
  actions.setPhoto(photo);
  actions.cancelDetection();
  assert.equal(getState().screen, 'upload');
});

test('labels are limited to 40 characters and survive an undo', () => {
  setup(3);
  const id = getState().faces[0].id;
  actions.setLabel(id, 'x'.repeat(80));
  assert.equal(faceById(getState(), id).label.length, 40);
});

test('settings changes: after-pick resets a shown result; the rest do not', () => {
  toWheel(4);
  actions.requestSpin(); actions.finishSpin();
  actions.updateSettings({ sound: true });
  assert.equal(getState().wheel.phase, 'selected');
  actions.updateSettings({ afterPick: 'remove' });
  assert.equal(getState().wheel.phase, 'idle');
});
