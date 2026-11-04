// Entry point: checks the browser, wires the modules together and switches screens.
import { startDetectionController } from './detection/controller.js';
import { clearThumbs } from './media/thumbs.js';
import { actions, getState, subscribe } from './state.js';
import { loadSettings, markNoticeSeen, noticeSeen, saveSettings } from './storage/settings.js';
import { $, applyStrings, prefersReducedMotion } from './ui/dom.js';
import { initPopout } from './ui/popout.js';
import { initPresent } from './ui/present.js';
import { initReview } from './ui/review.js';
import { initRoster } from './ui/roster.js';
import { applyTheme, initSettings } from './ui/settings.js';
import { sound } from './ui/sound.js';
import { initToasts } from './ui/toasts.js';
import { initUpload } from './ui/upload.js';
import { initWheel } from './ui/wheel-view.js';

function supported() {
  return typeof WebAssembly === 'object'
    && 'HTMLDialogElement' in globalThis
    && typeof createImageBitmap === 'function'
    && typeof globalThis.crypto?.getRandomValues === 'function'
    && typeof document.createElement('canvas').getContext === 'function';
}

/** Show one screen at a time. This must be set up before the modules that measure their screen (the wheel). */
function initScreens() {
  const sections = { upload: $('#screen-upload'), review: $('#screen-review'), wheel: $('#screen-wheel') };
  const show = (screen) => { for (const [name, el] of Object.entries(sections)) el.hidden = name !== screen; };
  show(getState().screen);
  subscribe((s, prev) => {
    if (s.screen === prev.screen) return;
    show(s.screen);
    globalThis.scrollTo(0, 0);
    sections[s.screen].querySelector('h1')?.focus({ preventScroll: true });
    if (s.screen === 'upload') clearThumbs();
  });
}

function initGlobals() {
  const live = $('#live');
  subscribe((s, prev) => {
    if (s.live !== prev.live) {
      live.textContent = '';
      setTimeout(() => { live.textContent = s.live.text; }, 60);
    }
    if (s.settings !== prev.settings) {
      saveSettings(s.settings);
      applyTheme(s.settings.theme);
      sound.enabled = s.settings.sound;
    }
  });

  const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  motion?.addEventListener('change', (e) => actions.setEnv({ reducedMotion: e.matches }));

  // PS-1: nothing is saved, so warn before a photo and its edits are thrown away by accident
  globalThis.addEventListener('beforeunload', (e) => {
    if (getState().screen === 'upload') return;
    e.preventDefault();
    e.returnValue = '';
  });
}

function boot() {
  applyStrings();
  if (!supported()) { $('#unsupported').hidden = false; return; }

  actions.loadSettings(loadSettings());
  actions.setEnv({ reducedMotion: prefersReducedMotion() });
  const { settings } = getState();
  applyTheme(settings.theme);
  sound.enabled = settings.sound;

  initScreens();
  initGlobals();
  initToasts();
  initUpload();
  initReview();
  initWheel();
  initRoster();
  initPopout();
  initSettings();
  initPresent();
  startDetectionController();

  if (!noticeSeen()) {
    const notice = $('#notice-dialog');
    notice.addEventListener('close', markNoticeSeen, { once: true });
    notice.showModal();
  }
}

boot();
