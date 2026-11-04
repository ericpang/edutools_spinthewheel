// Settings and help dialogs (ST-1), theme, and "Delete all data".
import { clearAll } from '../storage/settings.js';
import { actions, getState } from '../state.js';
import { t } from '../strings.js';
import { $ } from './dom.js';

export const applyTheme = (theme) => { document.documentElement.dataset.theme = theme; };

export function initSettings() {
  const dialog = $('#settings-dialog');
  const help = $('#help-dialog');

  function syncForm(settings) {
    for (const input of dialog.querySelectorAll('input[name]')) {
      if (input.type === 'checkbox') input.checked = Boolean(settings[input.name]);
      else input.checked = settings[input.name] === input.value;
    }
  }

  $('#btn-settings').addEventListener('click', () => { syncForm(getState().settings); dialog.showModal(); });
  $('#btn-help').addEventListener('click', () => help.showModal());

  dialog.addEventListener('change', (e) => {
    const input = e.target;
    if (!input.name) return;
    actions.updateSettings({ [input.name]: input.type === 'checkbox' ? input.checked : input.value });
  });

  $('#btn-delete-data').addEventListener('click', () => {
    if (!globalThis.confirm(t('settings.deleteConfirm'))) return;
    actions.loadSettings({});   // back to the defaults, then start over...
    actions.startOver();
    clearAll();                 // ...and clear storage last, so nothing is written back
    dialog.close();
  });

  // a click on the backdrop closes a dialog
  for (const el of [dialog, help, $('#notice-dialog')]) el.addEventListener('click', (e) => { if (e.target === el) el.close(); });
}
