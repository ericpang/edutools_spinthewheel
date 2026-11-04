// The review screen (README 3.2, 4.3): the photo with boxes, the face cards, sensitivity, expected count,
// quick actions, undo/redo and the "Build the wheel" button.
import { MAX_FACES, MIN_FACES, SENSITIVITY_ORDER } from '../core/config.js';
import { displayName, includedCount, isLowConfidence, summarize } from '../core/faces.js';
import { getThumb, paintThumb } from '../media/thumbs.js';
import { actions, subscribe } from '../state.js';
import { t } from '../strings.js';
import { $, applyStrings, prefersReducedMotion } from './dom.js';
import { createPhotoViewer } from './photo-viewer.js';

export function initReview() {
  const grid = $('#face-grid');
  const template = $('#tpl-face-card');
  const cards = new Map(); // face id -> <li>
  let activeId = null;
  let addMode = false;
  let current = null;      // latest state, for event handlers

  const viewport = $('#photo-viewport');
  const viewer = createPhotoViewer($('#photo-canvas'), {
    onSelect: (id) => setActive(id, true),
    onHover: (id) => setActive(id, false),
    onAddBox: (box) => {
      const id = actions.addManualFace(box);
      setAddMode(false);
      if (id) setActive(id, true);
    },
    onEscape: () => setAddMode(false),
  });

  // ------------------------------------------------------------ add-a-face mode
  function setAddMode(on) {
    addMode = on;
    viewer.setMode(on ? 'add' : 'pan');
    viewport.classList.toggle('is-adding', on);
    $('#btn-add-face').setAttribute('aria-pressed', String(on));
    $('#add-face-label').textContent = t(on ? 'review.addActive' : 'review.add');
    $('#photo-hint').textContent = t(on ? 'review.addHint' : 'review.photoHint');
  }

  function setActive(id, scroll) {
    if (id === activeId && !scroll) return;
    cards.get(activeId)?.classList.remove('is-active');
    activeId = id;
    viewer.setActive(id);
    const card = id ? cards.get(id) : null;
    card?.classList.add('is-active');
    if (scroll && card) card.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  // ------------------------------------------------------------ face cards (keyed, so typing is never interrupted)
  function createCard() {
    const li = template.content.firstElementChild.cloneNode(true);
    applyStrings(li);
    return li;
  }

  function updateCard(li, face, s, full) {
    li.dataset.id = face.id;
    li.classList.toggle('is-off', !face.included);
    li.classList.toggle('is-active', face.id === activeId);
    const name = displayName(face);

    const canvas = li.querySelector('canvas');
    paintThumb(canvas, getThumb(s.photo, face));
    li.querySelector('.face-num').textContent = `#${face.num}`;

    const badge = li.querySelector('.face-badge');
    const low = isLowConfidence(face);
    badge.hidden = !(low || face.small || face.source === 'manual');
    badge.classList.toggle('is-low', low);
    badge.classList.toggle('is-manual', !low && !face.small && face.source === 'manual');
    badge.textContent = t(low ? 'face.badgeLow' : face.small ? 'face.badgeSmall' : 'face.badgeManual');
    badge.title = t(low ? 'face.low' : face.small ? 'face.small' : 'face.manual');

    const include = li.querySelector('.face-include');
    include.checked = face.included;
    include.disabled = !face.included && full;
    include.title = include.disabled ? t('face.includeFull') : '';
    include.setAttribute('aria-label', `${t('face.include')}: ${name}`);

    const input = li.querySelector('.face-label');
    input.placeholder = t('face.label');
    input.setAttribute('aria-label', t('face.labelFor', face.num));
    if (document.activeElement !== input) input.value = face.label;

    const del = li.querySelector('.face-delete');
    del.setAttribute('aria-label', t('face.delete', name));
    del.title = t('face.delete', name);
  }

  function renderCards(s) {
    const full = includedCount(s.faces) >= MAX_FACES;
    const seen = new Set();
    s.faces.forEach((face, i) => {
      let li = cards.get(face.id);
      if (!li) { li = createCard(); cards.set(face.id, li); }
      updateCard(li, face, s, full);
      seen.add(face.id);
      const at = grid.children[i];
      if (at !== li) grid.insertBefore(li, at ?? null);
    });
    for (const [id, li] of cards) if (!seen.has(id)) { li.remove(); cards.delete(id); }
  }

  grid.addEventListener('change', (e) => {
    const li = e.target.closest('.face-card');
    if (li && e.target.matches('.face-include')) actions.toggleIncluded(li.dataset.id, e.target.checked);
  });
  grid.addEventListener('input', (e) => {
    const li = e.target.closest('.face-card');
    if (li && e.target.matches('.face-label')) actions.setLabel(li.dataset.id, e.target.value);
  });
  grid.addEventListener('click', (e) => {
    const li = e.target.closest('.face-card');
    if (!li) return;
    if (e.target.closest('.face-delete')) { actions.deleteFace(li.dataset.id); return; }
    if (e.target.closest('.face-thumb')) { setActive(li.dataset.id, false); viewer.reveal(li.dataset.id); }
  });
  grid.addEventListener('pointerover', (e) => {
    const li = e.target.closest('.face-card');
    if (li && e.pointerType === 'mouse') setActive(li.dataset.id, false);
  });
  grid.addEventListener('pointerleave', () => setActive(null, false));

  // ------------------------------------------------------------ chrome: summary, controls, overlay
  function renderSummary(s) {
    const { found, included, small, low } = summarize(s.faces);
    const el = $('#review-summary');
    el.textContent = found ? t('review.summary', found, included) : t('review.empty');
    for (const [count, key] of [[small, 'review.summarySmall'], [low, 'review.summaryLow']]) {
      if (!count) continue;
      const note = document.createElement('span');
      note.className = 'sum-note';
      note.textContent = t(key, count);
      el.append(note);
    }

    const warn = $('#expected-warning');
    const mismatch = s.expected && found && included !== s.expected;
    warn.hidden = !mismatch;
    if (mismatch) warn.textContent = t('review.expectedWarn', included, s.expected);
  }

  function renderControls(s) {
    const running = s.detect.status === 'running';
    const { included } = summarize(s.faces);
    const sens = $('#sens-range');
    const level = SENSITIVITY_ORDER.indexOf(s.sensitivity);
    sens.value = String(level);
    sens.disabled = running;
    sens.setAttribute('aria-valuetext', t(`sens.${s.sensitivity}`));
    $('#sens-output').textContent = t(`sens.${s.sensitivity}`);
    const expected = $('#expected-input');
    if (document.activeElement !== expected) expected.value = s.expected ?? '';

    $('#btn-include-all').disabled = running || included === Math.min(s.faces.length, MAX_FACES);
    $('#btn-include-none').disabled = running || included === 0;
    $('#btn-off-small').disabled = running || !s.faces.some((f) => f.small && f.included);
    $('#btn-off-low').disabled = running || !s.faces.some((f) => isLowConfidence(f) && f.included);
    $('#btn-undo').disabled = running || !s.history.past.length;
    $('#btn-redo').disabled = running || !s.history.future.length;
    $('#btn-add-face').disabled = running;

    const build = $('#btn-build');
    build.textContent = t('review.build', included);
    build.disabled = running || included < MIN_FACES;
    const note = $('#build-note');
    note.hidden = running || included >= MIN_FACES;
    note.textContent = t('review.buildNeed');
  }

  function renderDetect(s) {
    const d = s.detect;
    const running = d.status === 'running';
    const failed = d.status === 'error';
    $('#detect-overlay').hidden = !(running || failed);
    $('#detect-busy').hidden = !running;
    $('#detect-failed').hidden = !failed;
    if (running) {
      $('#detect-label').textContent = d.label || t('detect.loading');
      $('#detect-progress').value = Math.round(d.progress * 100);
    }
    if (failed) $('#detect-error-text').textContent = t('detect.error');
    viewer.setPreview(running ? d.preview : []);
  }

  // ------------------------------------------------------------ wiring
  $('#btn-add-face').addEventListener('click', () => setAddMode(!addMode));
  $('#btn-zoom-in').addEventListener('click', () => viewer.zoomBy(1.4));
  $('#btn-zoom-out').addEventListener('click', () => viewer.zoomBy(1 / 1.4));
  $('#btn-zoom-fit').addEventListener('click', () => viewer.fit());
  $('#btn-undo').addEventListener('click', () => actions.undo());
  $('#btn-redo').addEventListener('click', () => actions.redo());
  $('#btn-include-all').addEventListener('click', () => actions.includeAll());
  $('#btn-include-none').addEventListener('click', () => actions.includeNone());
  $('#btn-off-small').addEventListener('click', () => actions.switchOffSmall());
  $('#btn-off-low').addEventListener('click', () => actions.switchOffLowConfidence());
  $('#btn-build').addEventListener('click', () => actions.buildWheel());
  $('#btn-detect-cancel').addEventListener('click', () => actions.cancelDetection());
  $('#btn-detect-retry').addEventListener('click', () => actions.retryDetection());
  $('#btn-start-over').addEventListener('click', () => {
    if (!current?.faces.length || globalThis.confirm(t('review.confirmStartOver'))) actions.startOver();
  });

  const sens = $('#sens-range');
  sens.addEventListener('input', () => { $('#sens-output').textContent = t(`sens.${SENSITIVITY_ORDER[Number(sens.value)]}`); });
  sens.addEventListener('change', () => actions.setSensitivity(SENSITIVITY_ORDER[Number(sens.value)]));
  $('#expected-input').addEventListener('change', (e) => actions.setExpected(Number(e.target.value)));

  document.addEventListener('keydown', (e) => {
    if (current?.screen !== 'review') return;
    if (e.target.matches?.('input[type="text"], input[type="number"]')) return; // leave native undo alone
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) { e.preventDefault(); actions.undo(); }
    else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); actions.redo(); }
  });

  new MutationObserver(() => viewer.refreshColors()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  subscribe((s, prev) => {
    current = s;
    if (s.screen !== 'review') { if (addMode) setAddMode(false); return; }
    const entered = prev.screen !== 'review';
    if (entered || s.photo !== prev.photo) {
      // on narrow screens the viewport takes the photo's shape instead of leaving empty bands (see review.css)
      viewport.style.setProperty('--photo-ar', String(Math.min(1.7, Math.max(0.8, s.photo.width / s.photo.height))));
      viewer.setPhoto(s.photo);
    }
    if (entered || s.faces !== prev.faces || s.photo !== prev.photo) {
      viewer.setFaces(s.faces);
      renderCards(s);
    }
    renderSummary(s);
    renderControls(s);
    renderDetect(s);
  });
}
