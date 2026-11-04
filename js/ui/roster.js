// The roster panel (RS-1, RS-2) and the pick history (WH-12). The roster is also the keyboard and
// screen-reader alternative to the wheel canvas.
import { MAX_FACES } from '../core/config.js';
import { displayName, includedCount } from '../core/faces.js';
import { getThumb, paintThumb } from '../media/thumbs.js';
import { actions, faceById, subscribe } from '../state.js';
import { t } from '../strings.js';
import { $, applyStrings } from './dom.js';

export function initRoster() {
  const list = $('#roster-list');
  const template = $('#tpl-roster-row');
  const historyList = $('#history-list');
  const rows = new Map();

  list.addEventListener('click', (e) => {
    const li = e.target.closest('.roster-row');
    if (!li || !e.target.closest('.roster-main')) return;
    const rect = li.querySelector('canvas').getBoundingClientRect();
    actions.openPopout({ faceId: li.dataset.id, preview: true, origin: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, size: rect.width } });
  });
  list.addEventListener('change', (e) => {
    const li = e.target.closest('.roster-row');
    if (li && e.target.matches('.roster-include')) actions.toggleIncluded(li.dataset.id, e.target.checked);
  });
  $('#btn-reset-picks').addEventListener('click', () => actions.resetPicks());

  function renderRows(s) {
    const spinning = s.wheel.phase === 'spinning';
    const full = includedCount(s.faces) >= MAX_FACES;
    const seen = new Set();
    s.faces.forEach((face, i) => {
      let li = rows.get(face.id);
      if (!li) {
        li = template.content.firstElementChild.cloneNode(true);
        applyStrings(li);
        rows.set(face.id, li);
      }
      const name = displayName(face);
      li.dataset.id = face.id;
      li.classList.toggle('is-off', !face.included);
      li.classList.toggle('is-selected', face.id === s.wheel.selectedId);
      paintThumb(li.querySelector('canvas'), getThumb(s.photo, face));
      li.querySelector('.roster-name').textContent = name;
      li.querySelector('.roster-status').textContent = face.pickCount > 1
        ? t('roster.pickedTimes', face.pickCount)
        : face.pickCount === 1 ? t('roster.picked') : !face.included ? t('roster.off') : '';
      li.querySelector('.roster-main').setAttribute('aria-label', `${t('roster.preview', name)}${face.pickCount ? `, ${t('roster.picked')}` : ''}`);
      const include = li.querySelector('.roster-include');
      include.checked = face.included;
      include.disabled = spinning || (!face.included && full);
      include.setAttribute('aria-label', t('roster.switch', name));
      const at = list.children[i];
      if (at !== li) list.insertBefore(li, at ?? null);
      seen.add(face.id);
    });
    for (const [id, li] of rows) if (!seen.has(id)) { li.remove(); rows.delete(id); }
    $('#roster-title').textContent = t('roster.title', s.faces.length);
  }

  function renderHistory(s) {
    historyList.replaceChildren();
    for (const id of s.wheel.picks) {
      const face = faceById(s, id);
      if (!face) continue;
      const li = document.createElement('li');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 48;
      paintThumb(canvas, getThumb(s.photo, face));
      li.append(canvas, document.createTextNode(displayName(face)));
      historyList.append(li);
    }
    $('#history-empty').hidden = s.wheel.picks.length > 0;
  }

  subscribe((s, prev) => {
    if (s.screen !== 'wheel') return;
    if (s.screen !== prev.screen || s.faces !== prev.faces || s.wheel !== prev.wheel || s.photo !== prev.photo) {
      renderRows(s);
      renderHistory(s);
    }
  });
}
