// Short messages at the bottom of the screen.
import { actions, subscribe } from '../state.js';
import { t } from '../strings.js';
import { $ } from './dom.js';

export function initToasts() {
  const host = $('#toasts');
  const shown = new Map(); // notice id -> element

  subscribe((s, prev) => {
    if (s.notices === prev.notices) return;
    const ids = new Set(s.notices.map((n) => n.id));
    for (const [id, el] of shown) if (!ids.has(id)) { el.remove(); shown.delete(id); }
    for (const notice of s.notices) {
      if (shown.has(notice.id)) continue;
      const el = document.createElement('div');
      el.className = `toast${notice.kind === 'warn' ? ' toast-warn' : ''}`;
      const text = document.createElement('p');
      text.textContent = notice.text;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'btn btn-icon btn-ghost';
      close.setAttribute('aria-label', t('toast.dismiss'));
      close.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-close"/></svg>';
      close.addEventListener('click', () => actions.dismissNotice(notice.id));
      el.append(text, close);
      host.append(el);
      shown.set(notice.id, el);
      setTimeout(() => actions.dismissNotice(notice.id), notice.kind === 'warn' ? 12000 : 8000);
    }
  });
}
