// The wheel (README 6.3, 6.4): canvas drawing, the spin animation, hit-testing, and the wheel screen's controls.
// The static wheel (segments, thumbnails) is drawn once and only rotated while spinning, so 50 thumbnails stay smooth.
import { displayName, eligibleFaces } from '../core/faces.js';
import { TAU, angleAt, easeOutCubic, positionInSegment, segmentUnderPointer } from '../core/spin.js';
import { hitSegment, paletteIndices, thumbCentre, thumbLayout, toCanvasAngle } from '../core/wheel-geometry.js';
import { getThumb } from '../media/thumbs.js';
import { actions, getState, subscribe, wheelFaces } from '../state.js';
import { t } from '../strings.js';
import { $, cssVar, prefersReducedMotion } from './dom.js';
import { sound } from './sound.js';

// Colour-blind-safe mix of Paul Tol "bright" and Okabe-Ito colours.
const PALETTE = ['#4477aa', '#ee6677', '#228833', '#ccbb44', '#66ccee', '#aa3377', '#e69f00', '#009e73'];
const POINTER_TILT = 0.5;      // radians the pointer is pushed by a peg
const HIGHLIGHT_MS = 380;

const readColors = () => ({
  rim: cssVar('--wheel-rim'), rim2: cssVar('--wheel-rim-2'), sep: cssVar('--wheel-sep'), ring: cssVar('--wheel-ring'),
  pointer: cssVar('--wheel-pointer'), pointerEdge: cssVar('--wheel-pointer-edge'), dim: cssVar('--wheel-dim'), glow: cssVar('--wheel-glow'),
});

export function initWheel() {
  const box = $('#wheel-box');
  const canvas = $('#wheel-canvas');
  const g = canvas.getContext('2d');
  const hub = $('#btn-spin');
  const layer = document.createElement('canvas');

  let geo = null;            // { size, cx, cy, R, hubR, rim } in CSS pixels
  let colors = readColors();
  let dirty = true;          // the static layer needs repainting
  let anim = null;           // { plan, start, lastIndex }
  let phi = 0;               // rotation while animating
  let pointerTilt = 0;
  let selectedSince = 0;
  let raf = 0;

  // ------------------------------------------------------------ layout
  function layout() {
    const rect = box.getBoundingClientRect();
    if (!rect.width) return false;
    const size = rect.width;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const R = size * 0.45;
    geo = { size, cx: size / 2, cy: size * 0.535, R, hubR: R * 0.17, rim: R * 0.03 };
    box.style.setProperty('--hub-cx', `${geo.cx}px`);
    box.style.setProperty('--hub-cy', `${geo.cy}px`);
    box.style.setProperty('--hub-d', `${geo.hubR * 2}px`);
    box.style.setProperty('--hub-d-px', `${geo.hubR * 2}px`);
    dirty = true;
    return true;
  }

  const scaleFor = (ctx) => ctx.setTransform(canvas.width / geo.size, 0, 0, canvas.height / geo.size, 0, 0);

  // ------------------------------------------------------------ static layer
  function drawThumb(ctx, img, d, picked) {
    const r = d / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(img, -r, -r, d, d);
    ctx.restore();
    const lw = Math.max(1.5, d * 0.07);
    ctx.beginPath();
    ctx.arc(0, 0, r + lw / 2, 0, TAU);
    ctx.lineWidth = lw;
    ctx.strokeStyle = colors.ring;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r + lw, 0, TAU);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.stroke();
    if (picked) {
      const br = Math.max(4, d * 0.22);
      ctx.save();
      ctx.translate(r * 0.75, -r * 0.75);
      ctx.beginPath();
      ctx.arc(0, 0, br, 0, TAU);
      ctx.fillStyle = '#16a34a';
      ctx.fill();
      ctx.lineWidth = Math.max(1, br * 0.28);
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-br * 0.45, br * 0.02);
      ctx.lineTo(-br * 0.1, br * 0.38);
      ctx.lineTo(br * 0.5, -br * 0.35);
      ctx.lineWidth = Math.max(1, br * 0.3);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }
  }

  function paintLayer(faces, s) {
    const { size, cx, cy, R, rim } = geo;
    layer.width = canvas.width;
    layer.height = canvas.height;
    const c = layer.getContext('2d');
    scaleFor(c);
    c.clearRect(0, 0, size, size);

    c.beginPath();
    c.arc(cx, cy, R + rim, 0, TAU);
    c.fillStyle = colors.rim;
    c.fill();

    const n = faces.length;
    if (n === 0) {
      c.beginPath();
      c.arc(cx, cy, R, 0, TAU);
      c.fillStyle = '#9aa3b5';
      c.fill();
      return;
    }

    const theta = TAU / n;
    const palette = paletteIndices(n, PALETTE.length);
    for (let i = 0; i < n; i++) {
      c.beginPath();
      c.moveTo(cx, cy);
      c.arc(cx, cy, R, toCanvasAngle(i * theta), toCanvasAngle((i + 1) * theta));
      c.closePath();
      c.fillStyle = PALETTE[palette[i]];
      c.fill();
    }
    const shade = c.createRadialGradient(cx, cy, R * 0.12, cx, cy, R);
    shade.addColorStop(0, 'rgba(255,255,255,0.2)');
    shade.addColorStop(1, 'rgba(0,0,0,0.14)');
    c.beginPath();
    c.arc(cx, cy, R, 0, TAU);
    c.fillStyle = shade;
    c.fill();

    if (n > 1) {
      c.strokeStyle = colors.sep;
      c.lineWidth = Math.max(1, size * 0.0028);
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const a = toCanvasAngle(i * theta);
        c.moveTo(cx, cy);
        c.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
      }
      c.stroke();
    }

    // pegs on the rim, one per segment edge
    c.fillStyle = colors.rim2;
    for (let i = 0; i < n; i++) {
      const a = toCanvasAngle(i * theta);
      c.beginPath();
      c.arc(cx + (R + rim * 0.35) * Math.cos(a), cy + (R + rim * 0.35) * Math.sin(a), Math.max(1.5, rim * 0.5), 0, TAU);
      c.fill();
    }

    const { radius, diameter } = thumbLayout(R, n);
    const keep = s.settings.afterPick === 'keep';
    faces.forEach((face, i) => {
      const a = toCanvasAngle((i + 0.5) * theta);
      c.save();
      c.translate(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
      c.rotate(a + Math.PI / 2); // head points to the rim, so the selected face is upright under the pointer
      drawThumb(c, getThumb(s.photo, face), diameter, keep && face.pickCount > 0);
      c.restore();
    });
  }

  // ------------------------------------------------------------ dynamic drawing
  const liftedDiameter = (R, n) => {
    const { diameter } = thumbLayout(R, n);
    return Math.max(diameter, Math.min(Math.max(diameter * 1.6, 56), R * 0.34));
  };

  function drawSelection(s, faces, rotation, k) {
    const i = faces.findIndex((f) => f.id === s.wheel.selectedId);
    if (i < 0) return;
    const { cx, cy, R, rim, size } = geo;
    const n = faces.length;
    const theta = TAU / n;
    const a0 = toCanvasAngle(i * theta + rotation);
    const a1 = a0 + theta;

    g.save();
    g.globalAlpha = k;
    g.fillStyle = colors.dim;
    g.beginPath();
    g.arc(cx, cy, R + rim * 0.5, 0, TAU);
    g.moveTo(cx, cy);
    g.arc(cx, cy, R, a0, a1);
    g.closePath();
    g.fill('evenodd');
    g.restore();

    g.save();
    g.globalAlpha = k;
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, R, a0, a1);
    g.closePath();
    g.lineJoin = 'round';
    g.lineWidth = Math.max(3, size * 0.007);
    g.strokeStyle = colors.glow;
    g.shadowColor = colors.glow;
    g.shadowBlur = size * 0.03;
    g.stroke();
    g.restore();

    const c = thumbCentre({ i, n, phi: rotation, cx, cy, R });
    const base = thumbLayout(R, n).diameter;
    const d = base + (liftedDiameter(R, n) - base) * k;
    g.save();
    g.translate(c.x, c.y);
    g.rotate((i + 0.5) * theta + rotation);
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = size * 0.025;
    g.shadowOffsetY = size * 0.006;
    drawThumb(g, getThumb(s.photo, faces[i]), d, false);
    g.restore();
  }

  function drawPointer() {
    const { cx, cy, R, size } = geo;
    const w = R * 0.085;
    const top = cy - R - R * 0.14;
    const tip = cy - R + R * 0.075;
    g.save();
    g.translate(cx, top);
    g.rotate(pointerTilt);
    g.beginPath();
    g.moveTo(-w, w);
    g.arc(0, w, w, Math.PI, TAU);
    g.lineTo(0, tip - top);
    g.closePath();
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = size * 0.015;
    g.shadowOffsetY = size * 0.004;
    g.fillStyle = colors.pointer;
    g.fill();
    g.shadowColor = 'transparent';
    g.lineWidth = Math.max(2, size * 0.005);
    g.lineJoin = 'round';
    g.strokeStyle = colors.pointerEdge;
    g.stroke();
    g.beginPath();
    g.arc(0, w, w * 0.34, 0, TAU);
    g.fillStyle = colors.pointerEdge;
    g.fill();
    g.restore();
  }

  function render(now) {
    if (!geo) return;
    const s = getState();
    const faces = wheelFaces(s);
    if (dirty) { paintLayer(faces, s); dirty = false; }
    scaleFor(g);
    g.clearRect(0, 0, geo.size, geo.size);
    const rotation = anim ? phi : s.wheel.rotation;
    g.save();
    g.translate(geo.cx, geo.cy);
    g.rotate(rotation);
    g.drawImage(layer, -geo.cx, -geo.cy, geo.size, geo.size);
    g.restore();
    if (s.wheel.phase === 'selected' && faces.length) {
      // `now` is the frame's start time and `selectedSince` can be a few ms later, so clamp to 0..1
      const progress = (now - selectedSince) / (prefersReducedMotion() ? 1 : HIGHLIGHT_MS);
      drawSelection(s, faces, rotation, easeOutCubic(Math.min(1, Math.max(0, progress))));
    }
    drawPointer();
  }

  // ------------------------------------------------------------ animation loop
  function frame(now) {
    raf = 0;
    const s = getState();
    let more = false;
    if (anim && s.wheel.phase === 'spinning' && s.wheel.plan === anim.plan) {
      const elapsed = (now - anim.start) / 1000;
      const { plan } = anim;
      phi = angleAt(plan, elapsed);
      const index = segmentUnderPointer(phi, plan.n);
      if (index !== anim.lastIndex) { anim.lastIndex = index; sound.tick(); }
      pointerTilt = -POINTER_TILT * Math.max(0, 1 - positionInSegment(phi, plan.n) / 0.12) ** 1.5;
      if (elapsed >= plan.duration) {
        phi = plan.phiEnd;
        anim = null;
        pointerTilt = 0;
        actions.finishSpin();
        sound.reveal();
      } else more = true;
    }
    render(now);
    if (more || (getState().wheel.phase === 'selected' && now - selectedSince < HIGHLIGHT_MS + 40)) schedule();
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(frame); };

  // ------------------------------------------------------------ controls
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  function selectedGeometry(s) {
    const faces = wheelFaces(s);
    const i = faces.findIndex((f) => f.id === s.wheel.selectedId);
    if (i < 0 || !geo) return null;
    const { cx, cy, R, hubR } = geo;
    const c = thumbCentre({ i, n: faces.length, phi: s.wheel.rotation, cx, cy, R });
    return { i, n: faces.length, c, lifted: liftedDiameter(R, faces.length), cx, cy, R, hubR };
  }

  function overSelected(p, s) {
    const sel = selectedGeometry(s);
    if (!sel) return false;
    const hit = hitSegment({ x: p.x, y: p.y, cx: sel.cx, cy: sel.cy, R: sel.R, hubR: sel.hubR, phi: s.wheel.rotation, n: sel.n });
    return hit === sel.i || Math.hypot(p.x - sel.c.x, p.y - sel.c.y) <= sel.lifted / 2;
  }

  function openSelected() {
    const s = getState();
    const sel = selectedGeometry(s);
    if (!sel || s.wheel.phase !== 'selected') return;
    const rect = canvas.getBoundingClientRect();
    actions.openPopout({ faceId: s.wheel.selectedId, origin: { x: rect.left + sel.c.x, y: rect.top + sel.c.y, size: sel.lifted } });
  }

  canvas.addEventListener('click', (e) => {
    const s = getState();
    if (s.wheel.phase === 'selected' && overSelected(local(e), s)) openSelected();
  });
  canvas.addEventListener('pointermove', (e) => {
    const s = getState();
    canvas.classList.toggle('is-clickable', s.wheel.phase === 'selected' && overSelected(local(e), s));
  });
  canvas.addEventListener('pointerleave', () => canvas.classList.remove('is-clickable'));
  $('#btn-enlarge').addEventListener('click', openSelected);
  hub.addEventListener('click', () => { sound.prime(); actions.requestSpin(); });
  $('#btn-sound').addEventListener('click', () => {
    const next = !getState().settings.sound;
    actions.updateSettings({ sound: next });
    if (next) { sound.prime(); sound.preview(); } // a short note confirms that sound is back on
  });
  $('#btn-edit-faces').addEventListener('click', () => actions.editFaces());
  $('#btn-reset-inline').addEventListener('click', () => actions.resetPicks());

  function renderControls(s) {
    const phase = s.wheel.phase;
    const faces = wheelFaces(s);
    const pool = eligibleFaces(s.faces, s.settings.afterPick);
    const everyone = pool.length === 0;
    const selected = s.faces.find((f) => f.id === s.wheel.selectedId);
    hub.disabled = phase === 'spinning' || everyone;
    hub.setAttribute('aria-label', t('wheel.spin'));

    let text = t('wheel.idle');
    if (phase === 'spinning') text = t('wheel.spinning');
    else if (phase === 'selected' && selected) text = t('wheel.selected', displayName(selected));
    else if (everyone) text = t('wheel.everyone');
    $('#result-text').textContent = text;
    $('#result-hint').hidden = phase !== 'selected';
    $('#btn-enlarge').hidden = phase !== 'selected';
    $('#btn-reset-inline').hidden = !everyone || phase === 'spinning';
    $('#btn-reset-picks').disabled = phase === 'spinning' || !s.faces.some((f) => f.pickCount > 0);
    $('#btn-edit-faces').disabled = phase === 'spinning';
    const soundBtn = $('#btn-sound');
    soundBtn.setAttribute('aria-pressed', String(s.settings.sound));
    soundBtn.title = t(s.settings.sound ? 'wheel.soundTitleOn' : 'wheel.soundTitleOff');
    $('#sound-icon').setAttribute('href', s.settings.sound ? '#i-sound' : '#i-sound-off');
    canvas.setAttribute('aria-label', `${t('wheel.aria', faces.length)}${phase === 'selected' && selected ? `. ${t('wheel.selected', displayName(selected))}` : ''}`);
  }

  // ------------------------------------------------------------ wiring
  const relayout = () => { if (layout()) schedule(); };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(relayout).observe(box);
  const retheme = () => { colors = readColors(); dirty = true; schedule(); };
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', retheme);

  subscribe((s, prev) => {
    if (s.screen !== 'wheel') { anim = null; return; }
    const entered = prev.screen !== 'wheel';
    if (entered) { layout(); phi = s.wheel.rotation; }
    if (s.wheel.phase === 'spinning' && s.wheel.plan && (!anim || anim.plan !== s.wheel.plan)) {
      phi = s.wheel.plan.phiStart;
      anim = { plan: s.wheel.plan, start: performance.now(), lastIndex: segmentUnderPointer(s.wheel.plan.phiStart, s.wheel.plan.n) };
      sound.start();
    }
    if (s.wheel.phase === 'selected' && prev.wheel.phase !== 'selected') selectedSince = performance.now();
    if (entered || s.faces !== prev.faces || s.settings !== prev.settings || s.wheel.poolIds !== prev.wheel.poolIds || s.photo !== prev.photo) dirty = true;
    renderControls(s);
    schedule();
  });
}
