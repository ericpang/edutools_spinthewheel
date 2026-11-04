// The upload screen: drag and drop, file picker, paste (UP-1 to UP-4).
import { loadPhoto, PhotoError } from '../media/photo.js';
import { actions, getState } from '../state.js';
import { t } from '../strings.js';
import { $ } from './dom.js';

export function initUpload() {
  const zone = $('#dropzone');
  const input = $('#file-input');
  const errorEl = $('#upload-error');
  const title = $('.dz-title', zone);
  const idleTitle = title.textContent;
  let busy = false;

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  async function handleFile(file) {
    if (!file || busy) return;
    busy = true;
    zone.classList.add('is-busy');
    errorEl.hidden = true;
    try {
      actions.setPhoto(await loadPhoto(file));
    } catch (err) {
      const code = err instanceof PhotoError ? err.code : 'decode';
      showError(code === 'size' ? t('error.size', err.detail) : t(`error.${code}`));
    } finally {
      busy = false;
      zone.classList.remove('is-busy');
      input.value = ''; // so choosing the same file again still fires "change"
    }
  }

  input.addEventListener('change', () => handleFile(input.files?.[0]));

  for (const type of ['dragenter', 'dragover']) {
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      zone.classList.add('is-over');
      title.textContent = t('upload.release');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      zone.classList.remove('is-over');
      title.textContent = idleTitle;
    });
  }
  zone.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    handleFile(files.find((f) => f.type.startsWith('image/')) ?? files[0]);
  });
  // A file dropped outside the zone must not make the browser navigate away from the page.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { if (!zone.contains(e.target)) e.preventDefault(); });

  document.addEventListener('paste', (e) => {
    if (getState().screen !== 'upload') return;
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); handleFile(file); }
  });
}
