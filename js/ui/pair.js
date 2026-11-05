// "Use a photo from your phone" (UP-7): a dialog that embeds pair.html, which does the networking.
// The main page itself never talks to anyone but its own origin; the embedded page hands the photo back with
// postMessage, and from there it takes the same road as a photo from the file picker.
import { loadPhoto, PhotoError } from '../media/photo.js';
import { PAIRING } from '../pair/config.js';
import { actions, getState } from '../state.js';
import { t } from '../strings.js';
import { $ } from './dom.js';

export function initPair() {
  const button = $('#btn-phone');
  const dialog = $('#pair-dialog');
  const holder = $('#pair-holder');
  if (!PAIRING.enabled || typeof globalThis.RTCPeerConnection !== 'function') { $('#phone-option').hidden = true; return; }

  let frame = null;

  function open() {
    frame = document.createElement('iframe');
    frame.className = 'pair-frame';
    frame.title = t('pair.frame');
    frame.referrerPolicy = 'no-referrer';
    frame.src = 'pair.html';
    holder.replaceChildren(frame);
    dialog.showModal();
  }

  function teardown() {
    // Removing the frame closes its page, which shuts the pairing connection and ends the code's life.
    holder.replaceChildren();
    frame = null;
  }

  // The "close" event follows dialog.close() only later (and not at all in a background tab), so end the pairing
  // right away. The event is still needed for Esc, which closes the dialog without going through here.
  function close() {
    if (dialog.open) dialog.close();
    teardown();
  }

  button.addEventListener('click', open);
  $('#pair-close').addEventListener('click', close);
  dialog.addEventListener('close', teardown);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });

  globalThis.addEventListener('message', async (e) => {
    if (!frame || e.source !== frame.contentWindow || e.origin !== globalThis.location.origin) return;
    const { type, file } = e.data ?? {};
    if (type !== 'stw:photo' || !(file instanceof File) || getState().screen !== 'upload') return;
    close();
    try {
      actions.setPhoto(await loadPhoto(file));
    } catch (err) {
      const code = err instanceof PhotoError ? err.code : 'decode';
      actions.notify(code === 'size' ? t('error.size', err.detail) : t(`error.${code}`), 'warn');
    }
  });
}
