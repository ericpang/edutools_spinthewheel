// The class photo with a numbered box over every face: zoom (wheel, pinch, buttons), pan (drag),
// click a box to select it, and draw a new box to add a missed face (RV-1, RV-3).
import { isLowConfidence } from '../core/faces.js';
import { cssVar, frameThrottle } from './dom.js';

const MAX_SCALE = 10;

const readColors = () => ({
  on: cssVar('--box-on'), off: cssVar('--box-off'), small: cssVar('--box-small'), low: cssVar('--box-low'),
  manual: cssVar('--box-manual'), text: cssVar('--box-text'), accent: cssVar('--accent'),
});

/** The status a face box is styled by: colour, line style and a glyph in its badge (never colour alone). */
export function boxStatus(face) {
  if (!face.included) return { key: 'off', glyph: '×', dash: [6, 4] };
  if (isLowConfidence(face)) return { key: 'low', glyph: '?', dash: [2, 3] };
  if (face.small) return { key: 'small', glyph: '!', dash: [] };
  if (face.source === 'manual') return { key: 'manual', glyph: '+', dash: [] };
  return { key: 'on', glyph: '', dash: [] };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ onSelect?(id: string|null): void, onHover?(id: string|null): void,
 *           onAddBox?(box: {x:number,y:number,w:number,h:number}): void, onEscape?(): void }} hooks
 */
export function createPhotoViewer(canvas, hooks = {}) {
  const ctx = canvas.getContext('2d');
  let photo = null;
  let faces = [];
  let preview = [];
  let activeId = null;
  let mode = 'pan';
  let view = { scale: 1, tx: 0, ty: 0 };
  let dims = { w: 0, h: 0, dpr: 1 };
  let userMoved = false;
  let colors = readColors();
  let hoverId = null;
  let drag = null;
  let draft = null;
  let pinch = null;
  const pointers = new Map();

  const fitScale = () => (photo ? Math.min((dims.w - 24) / photo.width, (dims.h - 24) / photo.height) : 1);
  const clampScale = (s) => Math.min(MAX_SCALE, Math.max(fitScale() * 0.6, s));
  const toPhoto = (sx, sy) => ({ x: (sx - view.tx) / view.scale, y: (sy - view.ty) / view.scale });
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  function clampView() {
    if (!photo) return;
    const keep = 60; // always keep some of the photo on screen
    view.tx = Math.min(dims.w - keep, Math.max(keep - photo.width * view.scale, view.tx));
    view.ty = Math.min(dims.h - keep, Math.max(keep - photo.height * view.scale, view.ty));
  }

  function fit() {
    if (!photo || !dims.w) return;
    const s = Math.max(0.01, fitScale());
    view = { scale: s, tx: (dims.w - photo.width * s) / 2, ty: (dims.h - photo.height * s) / 2 };
    userMoved = false;
    requestDraw();
  }

  function zoomAt(factor, sx = dims.w / 2, sy = dims.h / 2) {
    if (!photo) return;
    const next = clampScale(view.scale * factor);
    const k = next / view.scale;
    view.tx = sx - (sx - view.tx) * k;
    view.ty = sy - (sy - view.ty) * k;
    view.scale = next;
    userMoved = true;
    clampView();
    requestDraw();
  }

  function faceAt(sx, sy) {
    const p = toPhoto(sx, sy);
    let best = null;
    for (const f of faces) {
      const b = f.box;
      if (p.x < b.x || p.y < b.y || p.x > b.x + b.w || p.y > b.y + b.h) continue;
      if (!best || b.w * b.h < best.box.w * best.box.h) best = f; // the smallest box wins when boxes overlap
    }
    return best?.id ?? null;
  }

  // ------------------------------------------------------------ drawing
  /** The number badge shrinks a little over a small box, so a crowded photo stays readable on a phone. */
  function drawBadge(text, x, y, fill, boxWidth) {
    const font = Math.round(Math.max(9, Math.min(12, boxWidth * 0.5)));
    const h = font + 5;
    ctx.font = `700 ${font}px system-ui, sans-serif`;
    const w = ctx.measureText(text).width + font * 0.8;
    const by = y - h - 2 < 2 ? y + 2 : y - h - 2;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, by, w, h, 5);
    ctx.fill();
    ctx.fillStyle = colors.text;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + font * 0.4, by + h / 2 + 0.5);
  }

  function drawFace(face) {
    const b = face.box;
    const x = view.tx + b.x * view.scale;
    const y = view.ty + b.y * view.scale;
    const w = b.w * view.scale;
    const h = b.h * view.scale;
    if (x > dims.w || y > dims.h || x + w < 0 || y + h < 0) return;
    const st = boxStatus(face);
    const color = colors[st.key];
    const highlighted = face.id === activeId || face.id === hoverId;
    if (highlighted) {
      ctx.setLineDash([]);
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeRect(x, y, w, h);
    }
    ctx.setLineDash(st.dash);
    ctx.lineWidth = highlighted ? 3.5 : 2.25;
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    drawBadge(`${st.glyph}${st.glyph ? ' ' : ''}${face.num}`, x, y, color, w);
  }

  function draw() {
    const { w, h, dpr } = dims;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!photo) return;
    const level = Math.min(photo.pyramid.length - 1, Math.max(0, Math.floor(Math.log2(1 / view.scale))));
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(photo.pyramid[level], view.tx, view.ty, photo.width * view.scale, photo.height * view.scale);

    ctx.lineJoin = 'round';
    for (const p of preview) {
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.strokeRect(view.tx + p.x * view.scale, view.ty + p.y * view.scale, p.w * view.scale, p.h * view.scale);
    }
    ctx.setLineDash([]);
    for (const f of faces) drawFace(f);

    if (draft) {
      const x = view.tx + Math.min(draft.x0, draft.x1) * view.scale;
      const y = view.ty + Math.min(draft.y0, draft.y1) * view.scale;
      const dw = Math.abs(draft.x1 - draft.x0) * view.scale;
      const dh = Math.abs(draft.y1 - draft.y0) * view.scale;
      ctx.fillStyle = 'rgba(56,189,248,0.2)';
      ctx.fillRect(x, y, dw, dh);
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = colors.manual;
      ctx.strokeRect(x, y, dw, dh);
      ctx.setLineDash([]);
    }
  }
  const requestDraw = frameThrottle(draw);

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    dims = { w: rect.width, h: rect.height, dpr };
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    if (!userMoved) fit(); else { clampView(); requestDraw(); }
  }

  // ------------------------------------------------------------ input
  const setCursorHover = (id) => {
    if (id === hoverId) return;
    hoverId = id;
    hooks.onHover?.(id);
    requestDraw();
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (!photo) return;
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: view.scale };
      drag = null;
      draft = null;
    } else if (mode === 'add') {
      const q = toPhoto(p.x, p.y);
      draft = { x0: q.x, y0: q.y, x1: q.x, y1: q.y };
    } else {
      drag = { x: p.x, y: p.y, tx: view.tx, ty: view.ty, moved: false };
      canvas.parentElement.classList.add('is-panning');
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      zoomAt((pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist)) / view.scale, mid.x, mid.y);
    } else if (draft) {
      const q = toPhoto(p.x, p.y);
      draft.x1 = q.x;
      draft.y1 = q.y;
      requestDraw();
    } else if (drag) {
      if (Math.hypot(p.x - drag.x, p.y - drag.y) > 3) drag.moved = true;
      view.tx = drag.tx + (p.x - drag.x);
      view.ty = drag.ty + (p.y - drag.y);
      userMoved = true;
      clampView();
      requestDraw();
    } else if (e.pointerType === 'mouse') {
      setCursorHover(mode === 'pan' ? faceAt(p.x, p.y) : null);
    }
  });

  function endPointer(e, cancelled = false) {
    const p = local(e);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    canvas.parentElement.classList.remove('is-panning');
    if (draft) {
      const box = {
        x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1),
        w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0),
      };
      draft = null;
      requestDraw();
      if (!cancelled) hooks.onAddBox?.(box);
    } else if (drag) {
      const wasClick = !drag.moved && !cancelled;
      drag = null;
      if (wasClick) hooks.onSelect?.(faceAt(p.x, p.y));
    }
  }
  canvas.addEventListener('pointerup', (e) => endPointer(e));
  canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !drag && !draft) setCursorHover(null); });

  canvas.addEventListener('wheel', (e) => {
    if (!photo) return;
    e.preventDefault();
    const p = local(e);
    zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), p.x, p.y);
  }, { passive: false });

  canvas.addEventListener('dblclick', (e) => { if (mode === 'pan') { const p = local(e); zoomAt(2, p.x, p.y); } });

  canvas.addEventListener('keydown', (e) => {
    const step = 60;
    const keys = {
      '+': () => zoomAt(1.25), '=': () => zoomAt(1.25), '-': () => zoomAt(0.8), '0': fit,
      ArrowLeft: () => { view.tx += step; }, ArrowRight: () => { view.tx -= step; },
      ArrowUp: () => { view.ty += step; }, ArrowDown: () => { view.ty -= step; },
      Escape: () => hooks.onEscape?.(),
    };
    const action = keys[e.key];
    if (!action) return;
    e.preventDefault();
    action();
    if (e.key.startsWith('Arrow')) { userMoved = true; clampView(); requestDraw(); }
  });

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas.parentElement);
  globalThis.addEventListener('resize', resize);

  return {
    setPhoto(p) { photo = p; userMoved = false; resize(); fit(); },
    setFaces(list) { faces = list; requestDraw(); },
    setPreview(list) { preview = list; requestDraw(); },
    setActive(id) { if (id !== activeId) { activeId = id; requestDraw(); } },
    setMode(next) { mode = next; draft = null; requestDraw(); },
    zoomBy: (factor) => zoomAt(factor),
    fit,
    refreshColors() { colors = readColors(); requestDraw(); },
    resize,
    /** Make a face visible: pan it into view, and zoom in if it is tiny on screen. */
    reveal(id) {
      const f = faces.find((x) => x.id === id);
      if (!f || !dims.w) return;
      const b = f.box;
      const onScreen = Math.max(b.w, b.h) * view.scale;
      if (onScreen < 40) view.scale = clampScale(Math.min(MAX_SCALE, 120 / Math.max(b.w, b.h)));
      const sx = view.tx + (b.x + b.w / 2) * view.scale;
      const sy = view.ty + (b.y + b.h / 2) * view.scale;
      if (sx < 30 || sy < 30 || sx > dims.w - 30 || sy > dims.h - 30 || onScreen < 40) {
        view.tx = dims.w / 2 - (b.x + b.w / 2) * view.scale;
        view.ty = dims.h / 2 - (b.y + b.h / 2) * view.scale;
        userMoved = true;
        clampView();
      }
      requestDraw();
    },
  };
}
