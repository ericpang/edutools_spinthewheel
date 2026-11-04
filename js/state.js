// Application state: one small observable store and the actions that change it (README 6.5 and 10).
// No DOM in here, so it can be unit-tested in Node. UI modules subscribe to it and call the actions;
// they never call each other.
import {
  DEFAULT_SENSITIVITY, LABEL_MAX, MAX_FACES, MIN_FACES, SENSITIVITY_ORDER, SPIN_SECONDS, SPIN_TURNS,
} from './core/config.js';
import { clampBox } from './core/crop.js';
import {
  applyCap, displayName, eligibleFaces, includedCount, isLowConfidence, makeFace, mergeRedetected, renumber,
} from './core/faces.js';
import { secureRandom } from './core/rng.js';
import { TAU, mod, planSpin } from './core/spin.js';
import { t } from './strings.js';

export const DEFAULT_SETTINGS = Object.freeze({ afterPick: 'keep', spinDuration: 'normal', sound: true, theme: 'system' });
const HISTORY_LIMIT = 50;
const MIN_BOX_PX = 12;

const freshWheel = () => ({ phase: 'idle', rotation: 0, selectedId: null, plan: null, poolIds: null, picks: [] });
const closedPopout = () => ({ open: false, faceId: null, preview: false, origin: null, context: false });
const emptyHistory = () => ({ past: [], future: [] });

function initial(settings = DEFAULT_SETTINGS, env = { reducedMotion: false }) {
  return {
    screen: 'upload',                  // 'upload' | 'review' | 'wheel'
    photo: null,                       // { id, name, width, height, canvas, pyramid, ... }
    faces: [],
    tombstones: [],                    // boxes of automatic faces the teacher deleted
    sensitivity: DEFAULT_SENSITIVITY,
    expected: null,
    history: emptyHistory(),
    detect: { status: 'idle', kind: 'initial', progress: 0, label: '', requestId: 0, error: null, preview: [] },
    wheel: freshWheel(),
    popout: closedPopout(),
    settings,       // the same object on a restart, so subscribers that persist settings see no change
    env,
    notices: [],
    live: { n: 0, text: '' },
  };
}

let state = initial();
const listeners = new Set();
let noticeSeq = 0;

export const getState = () => state;

/** @param {(state: any, prev: any) => void} fn @returns {() => void} unsubscribe */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(patch) {
  const prev = state;
  state = { ...state, ...patch };
  for (const fn of [...listeners]) fn(state, prev);
}

// ---------------------------------------------------------------- selectors
export const faceById = (s, id) => s.faces.find((f) => f.id === id) ?? null;
export const selectedFace = (s) => (s.wheel.selectedId ? faceById(s, s.wheel.selectedId) : null);
export const canBuildWheel = (s) => includedCount(s.faces) >= MIN_FACES;

/**
 * The faces laid out on the wheel. While spinning or showing a result it is the pool fixed when the spin
 * started (so removing the winner after a pick cannot rearrange the wheel under the pointer); otherwise it
 * is the live list of included faces.
 */
export function wheelFaces(s) {
  if (s.wheel.poolIds && (s.wheel.phase === 'spinning' || s.wheel.phase === 'selected')) {
    return s.wheel.poolIds.map((id) => faceById(s, id)).filter(Boolean);
  }
  return eligibleFaces(s.faces, s.settings.afterPick);
}

// ---------------------------------------------------------------- helpers
function notify(text, kind = 'info') {
  const id = ++noticeSeq;
  set({ notices: [...state.notices, { id, text, kind }].slice(-4) });
  return id;
}

function announce(text) {
  set({ live: { n: state.live.n + 1, text } });
}

/** An edit to the face list that can be undone. It also drops any result shown on the wheel. */
function commit(faces, tombstones = state.tombstones) {
  const past = [...state.history.past, { faces: state.faces, tombstones: state.tombstones }].slice(-HISTORY_LIMIT);
  set({
    faces, tombstones, history: { past, future: [] },
    wheel: { ...state.wheel, phase: 'idle', selectedId: null, plan: null, poolIds: null },
    popout: closedPopout(),
  });
}

/** A clean state that keeps the teacher's settings. Always applied through set() so subscribers see the change. */
const fresh = () => initial(state.settings, state.env);

function requestDetection(kind) {
  set({
    detect: {
      status: 'running', kind, progress: 0, label: t('detect.loading'), error: null, preview: [],
      requestId: state.detect.requestId + 1,
    },
  });
}

// ---------------------------------------------------------------- actions
export const actions = {
  // environment and settings
  setEnv(patch) { set({ env: { ...state.env, ...patch } }); },
  loadSettings(settings) { set({ settings: { ...DEFAULT_SETTINGS, ...settings } }); },
  updateSettings(patch) {
    const settings = { ...state.settings, ...patch };
    const afterPickChanged = settings.afterPick !== state.settings.afterPick;
    set({
      settings,
      ...(afterPickChanged ? { wheel: { ...state.wheel, phase: 'idle', selectedId: null, plan: null, poolIds: null }, popout: closedPopout() } : {}),
    });
  },
  notify,
  announce,
  dismissNotice(id) { set({ notices: state.notices.filter((n) => n.id !== id) }); },

  // navigation
  startOver() { set(fresh()); },
  buildWheel() {
    if (!canBuildWheel(state)) { notify(t('review.buildNeed'), 'warn'); return; }
    set({
      screen: 'wheel',
      wheel: { ...state.wheel, phase: 'idle', selectedId: null, plan: null, poolIds: null },
      popout: closedPopout(),
    });
  },
  editFaces() {
    set({
      screen: 'review',
      wheel: { ...state.wheel, phase: 'idle', selectedId: null, plan: null, poolIds: null },
      popout: closedPopout(),
    });
  },

  // photo and detection
  setPhoto(photo) {
    set({ ...fresh(), screen: 'review', photo });
    requestDetection('initial');
    if (photo.downscaledFrom) notify(t('notice.downscaled', photo.downscaledFrom), 'info');
    if (photo.lowRes) notify(t('notice.lowRes'), 'warn');
  },
  setSensitivity(level) {
    if (!SENSITIVITY_ORDER.includes(level) || level === state.sensitivity) return;
    set({ sensitivity: level });
    if (state.photo) requestDetection('redetect');
  },
  retryDetection() { requestDetection(state.faces.length ? 'redetect' : 'initial'); },
  cancelDetection() {
    if (state.detect.status !== 'running') return;
    if (state.detect.kind === 'initial') actions.startOver();
    else set({ detect: { ...state.detect, status: 'done', preview: [] } });
  },
  detectionProgress(progress, label) { set({ detect: { ...state.detect, progress, label: label ?? state.detect.label } }); },
  detectionPreview(preview) { set({ detect: { ...state.detect, preview } }); },
  detectionDone(detections) {
    const redetect = state.faces.length > 0;
    const { faces, added, removed, leftOff } = mergeRedetected({
      oldFaces: state.faces, detections, tombstones: state.tombstones, photoId: state.photo.id,
    });
    const detect = { ...state.detect, status: 'done', progress: 1, label: '', preview: [], error: null };
    if (redetect) { commit(faces); set({ detect }); } else set({ faces, detect, history: emptyHistory() });
    if (!faces.length) notify(t('detect.noFaces'), 'warn');
    else if (leftOff > 0) notify(t('notice.capped', MAX_FACES, leftOff), 'warn'); // FD-8: tell the teacher about the 50-face limit
    if (redetect) notify(t('notice.rescanned', added, removed));
    announce(t('review.summary', faces.length, includedCount(faces)));
  },
  detectionFailed(error) {
    set({ detect: { ...state.detect, status: 'error', error: String(error?.message ?? error), preview: [] } });
  },

  // editing faces (review screen)
  toggleIncluded(id, value) {
    const face = faceById(state, id);
    if (!face) return;
    const next = value ?? !face.included;
    if (next === face.included) return;
    if (next && includedCount(state.faces) >= MAX_FACES) { notify(t('notice.wheelFull'), 'warn'); return; }
    commit(state.faces.map((f) => (f.id === id ? { ...f, included: next } : f)));
  },
  deleteFace(id) {
    const face = faceById(state, id);
    if (!face) return;
    const tombstones = face.source === 'auto' ? [...state.tombstones, face.box] : state.tombstones;
    commit(renumber(state.faces.filter((f) => f.id !== id)), tombstones);
  },
  setLabel(id, label) {
    set({ faces: state.faces.map((f) => (f.id === id ? { ...f, label: label.slice(0, LABEL_MAX) } : f)) });
  },
  addManualFace(box) {
    const b = clampBox(box, state.photo.width, state.photo.height);
    if (Math.min(b.w, b.h) < MIN_BOX_PX) { notify(t('notice.tooSmall'), 'warn'); return null; }
    const face = { ...makeFace({ box: b, source: 'manual', photoId: state.photo.id }), included: includedCount(state.faces) < MAX_FACES };
    commit(renumber([...state.faces, face]));
    if (!face.included) notify(t('notice.wheelFull'), 'warn');
    return face.id;
  },
  includeAll() { commit(applyCap(state.faces.map((f) => ({ ...f, included: true })))); },
  includeNone() { commit(state.faces.map((f) => ({ ...f, included: false }))); },
  switchOffSmall() { commit(state.faces.map((f) => (f.small ? { ...f, included: false } : f))); },
  switchOffLowConfidence() { commit(state.faces.map((f) => (isLowConfidence(f) ? { ...f, included: false } : f))); },
  setExpected(n) { set({ expected: Number.isFinite(n) && n > 0 ? Math.floor(n) : null }); },
  undo() {
    const { past, future } = state.history;
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({
      faces: prev.faces, tombstones: prev.tombstones,
      history: { past: past.slice(0, -1), future: [...future, { faces: state.faces, tombstones: state.tombstones }] },
      wheel: { ...state.wheel, phase: 'idle', selectedId: null, plan: null, poolIds: null },
    });
  },
  redo() {
    const { past, future } = state.history;
    if (!future.length) return;
    const next = future[future.length - 1];
    set({
      faces: next.faces, tombstones: next.tombstones,
      history: { past: [...past, { faces: state.faces, tombstones: state.tombstones }], future: future.slice(0, -1) },
      wheel: { ...state.wheel, phase: 'idle', selectedId: null, plan: null, poolIds: null },
    });
  },

  // the wheel
  /** Draw the winner first, then plan the animation that lands on it. Returns false when nothing was started. */
  requestSpin() {
    const s = state;
    if (s.screen !== 'wheel' || s.wheel.phase === 'spinning' || s.popout.open) return false;
    const pool = eligibleFaces(s.faces, s.settings.afterPick);
    if (!pool.length) { announce(t('wheel.everyone')); return false; }
    const reduced = s.env.reducedMotion;
    const plan = planSpin({
      n: pool.length,
      phi: s.wheel.rotation,
      random: secureRandom,
      seconds: reduced ? [0, 0] : SPIN_SECONDS[s.settings.spinDuration],
      turns: reduced ? 0 : SPIN_TURNS,
    });
    set({
      wheel: {
        ...s.wheel, phase: 'spinning', selectedId: null, poolIds: pool.map((f) => f.id),
        plan: { ...plan, winnerId: pool[plan.winner].id },
      },
    });
    return true;
  },
  finishSpin() {
    const { plan, phase } = state.wheel;
    if (phase !== 'spinning' || !plan) return;
    const faces = state.faces.map((f) => (f.id === plan.winnerId ? { ...f, pickCount: f.pickCount + 1 } : f));
    set({
      faces,
      wheel: {
        ...state.wheel, phase: 'selected', rotation: mod(plan.phiEnd, TAU), selectedId: plan.winnerId,
        plan: null, picks: [...state.wheel.picks, plan.winnerId],
      },
    });
    announce(t('wheel.announceSelected', displayName(faceById(state, plan.winnerId))));
  },
  resetPicks() {
    set({
      faces: state.faces.map((f) => ({ ...f, pickCount: 0 })),
      wheel: { ...state.wheel, phase: 'idle', selectedId: null, plan: null, poolIds: null, picks: [] },
      popout: closedPopout(),
    });
  },

  // the pop-out
  openPopout({ faceId, preview = false, origin = null }) {
    if (!faceById(state, faceId)) return;
    set({ popout: { open: true, faceId, preview, origin, context: false } });
  },
  closePopout() {
    if (!state.popout.open) return;
    set({ popout: { ...state.popout, open: false, origin: null } });
  },
  setPopoutContext(context) { set({ popout: { ...state.popout, context } }); },
  /** PO-8: switch the face off the wheel from inside the pop-out. */
  removeFromWheel(faceId) {
    set({ popout: { ...state.popout, open: false, origin: null } });
    actions.toggleIncluded(faceId, false);
  },
};

/** For tests: back to a clean slate. */
export function resetState() {
  state = initial();
  listeners.clear();
}
