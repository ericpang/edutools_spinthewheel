// Small DOM helpers shared by the UI modules.
import { t } from '../strings.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Fill static text: data-t="key" sets textContent; data-t-attr="aria-label:key;title:key2" sets attributes. */
export function applyStrings(root = document) {
  for (const el of root.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of root.querySelectorAll('[data-t-attr]')) {
    for (const pair of el.dataset.tAttr.split(';')) {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr.trim(), t(key.trim()));
    }
  }
}

export const prefersReducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Read a CSS custom property of the root element. */
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Run `fn` once per animation frame at most. */
export function frameThrottle(fn) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(); });
  };
}
