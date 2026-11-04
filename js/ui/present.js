// Present mode (WH-11): full screen, panels hidden, the wheel as large as possible.
import { subscribe } from '../state.js';
import { $ } from './dom.js';

export function initPresent() {
  const exit = $('#btn-exit-present');
  let on = false;

  async function setPresent(next) {
    on = next;
    document.body.classList.toggle('present', on);
    exit.hidden = !on;
    try {
      if (on && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else if (!on && document.fullscreenElement) await document.exitFullscreen();
    } catch { /* full screen refused (for example on a phone): the hidden panels are still useful */ }
  }

  $('#btn-present').addEventListener('click', () => setPresent(true));
  exit.addEventListener('click', () => setPresent(false));
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && on) { on = false; document.body.classList.remove('present'); exit.hidden = true; }
  });
  subscribe((s) => { if (s.screen !== 'wheel' && on) setPresent(false); });
}
