// The pop-out (README 4.5, 6.6): the picked face, enlarged. A native <dialog> gives focus handling,
// Esc and an inert background. The face grows out of the selected segment (FLIP animation).
import { contextWindow } from '../core/crop.js';
import { displayName } from '../core/faces.js';
import { makeFullCrop } from '../media/photo.js';
import { getThumb } from '../media/thumbs.js';
import { actions, faceById, getState, subscribe } from '../state.js';
import { t } from '../strings.js';
import { $, prefersReducedMotion } from './dom.js';
import { sound } from './sound.js';

export function initPopout() {
  const dialog = $('#popout');
  const card = $('#popout-card');
  const faceCanvas = $('#popout-face');
  const contextCanvas = $('#popout-context');
  $('#popout-note').title = t('popout.lowResHelp');
  let swipe = null;

  function paintFace(s, face) {
    const full = makeFullCrop(s.photo, face.box); // cut from the full-resolution working copy, not the wheel thumbnail
    faceCanvas.width = full.width;
    faceCanvas.height = full.height;
    faceCanvas.getContext('2d').drawImage(full, 0, 0);
  }

  function paintContext(s, face) {
    const { x, y, size } = contextWindow(face.box, s.photo.width, s.photo.height);
    const out = Math.min(768, Math.max(480, Math.round(size)));
    contextCanvas.width = contextCanvas.height = out;
    const ctx = contextCanvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(s.photo.canvas, x, y, size, size, 0, 0, out, out);
    const k = out / size;
    const b = face.box;
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect((b.x - x) * k, (b.y - y) * k, b.w * k, b.h * k);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#4338ca';
    ctx.strokeRect((b.x - x) * k, (b.y - y) * k, b.w * k, b.h * k);
  }

  function renderMedia(s) {
    const face = faceById(s, s.popout.faceId);
    if (!face) return;
    const context = s.popout.context;
    faceCanvas.hidden = context;
    contextCanvas.hidden = !context;
    $('#popout-context-label').textContent = t(context ? 'popout.showFace' : 'popout.showContext');
    if (context) paintContext(s, face);
  }

  function fill(s) {
    const face = faceById(s, s.popout.faceId);
    const name = displayName(face);
    $('#popout-caption').textContent = name;
    faceCanvas.setAttribute('aria-label', t('face.alt', name));
    contextCanvas.setAttribute('aria-label', t('popout.contextAlt', name));
    $('#popout-note').hidden = !face.small;               // small faces look blurry when enlarged
    $('#popout-preview').hidden = !s.popout.preview;
    $('#popout-remove').hidden = !face.included;
    paintFace(s, face);
    renderMedia(s);
  }

  /** Grow the card out of the thumbnail it came from; a plain fade when the user prefers less motion. */
  function animateOpen(origin) {
    if (prefersReducedMotion() || !origin) {
      card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
      return;
    }
    const media = $('#popout-media').getBoundingClientRect();
    const box = card.getBoundingClientRect();
    const scale = Math.max(0.04, origin.size / media.width);
    const cx = media.left + media.width / 2;
    const cy = media.top + media.height / 2;
    card.style.transformOrigin = `${cx - box.left}px ${cy - box.top}px`;
    card.animate(
      [
        { transform: `translate(${origin.x - cx}px, ${origin.y - cy}px) scale(${scale})`, opacity: 0.15 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 340, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)' },
    );
  }

  function open(s) {
    fill(s);
    if (!dialog.open) dialog.showModal();
    animateOpen(s.popout.origin);
  }

  subscribe((s, prev) => {
    const now = s.popout;
    const before = prev.popout;
    if (now.open && !before.open) open(s);
    else if (!now.open && before.open) { if (dialog.open) dialog.close(); }
    else if (now.open && now.context !== before.context) renderMedia(s);
  });

  // Esc, the close button, a click on the backdrop and a swipe down all go through the store.
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); actions.closePopout(); });
  dialog.addEventListener('close', () => { if (getState().popout.open) actions.closePopout(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) actions.closePopout(); });
  $('#popout-close').addEventListener('click', () => actions.closePopout());
  $('#popout-context-toggle').addEventListener('click', () => actions.setPopoutContext(!getState().popout.context));
  $('#popout-remove').addEventListener('click', () => actions.removeFromWheel(getState().popout.faceId));
  $('#popout-spin').addEventListener('click', () => { sound.prime(); actions.closePopout(); actions.requestSpin(); });

  card.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') swipe = { y: e.clientY, dy: 0 }; });
  card.addEventListener('pointermove', (e) => {
    if (!swipe) return;
    swipe.dy = Math.max(0, e.clientY - swipe.y);
    card.style.transform = `translateY(${swipe.dy * 0.6}px)`;
    card.style.opacity = String(1 - Math.min(0.6, swipe.dy / 400));
  });
  const endSwipe = () => {
    if (!swipe) return;
    const far = swipe.dy > 90;
    swipe = null;
    card.style.transform = '';
    card.style.opacity = '';
    if (far) actions.closePopout();
  };
  card.addEventListener('pointerup', endSwipe);
  card.addEventListener('pointercancel', endSwipe);
}
