// End-to-end tests: drive Chrome or Edge through the main flows with real clicks and key presses.
// No dependencies. Needs Node 22 or newer and an installed Chrome or Edge.
//
//   node tests/e2e/run.mjs --photo <class-photo.jpg> [--browser <chrome or msedge>] [--only <text>] [--slow] [--shots <folder>]
//
//   --photo    a photo with faces. It is NOT in the repository: use a group photo you may use (a licensed or
//              public-domain one), never a photo of students you may not share. 20 to 40 clearly visible faces
//              works best; a few checks (the 50-face cap) need a photo that gives more than 50 candidates at
//              Max sensitivity and are skipped otherwise.
//   --only     run only scenarios whose name contains this text
//   --slow     also run the 70-second check that the detector's metrics request is blocked by the CSP
//   --shots    save screenshots into this folder
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser, launchBrowser, openPage, sleep } from './cdp.mjs';
import { startServer } from './serve.mjs';

// ------------------------------------------------------------------ setup
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1]?.startsWith('--') || i + 1 >= process.argv.length ? true : process.argv[++i];
}
if (!args.photo || args.photo === true) { console.error('Usage: node tests/e2e/run.mjs --photo <class-photo.jpg> [--browser <exe>] [--only <text>] [--slow] [--shots <folder>]'); process.exit(2); }

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const work = mkdtempSync(join(tmpdir(), 'stw-fixtures-'));
const photoName = `photo${extname(args.photo).toLowerCase() || '.jpg'}`;
copyFileSync(args.photo, join(work, photoName));
const shotsDir = typeof args.shots === 'string' ? resolve(args.shots) : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

const server = await startServer({ root, extraPrefix: '/__t/', extraRoot: work });
const BASE = server.url;
const browser = await launchBrowser({ exe: findBrowser(typeof args.browser === 'string' ? args.browser : undefined), port: Number(args.port ?? 9333) });
const PHOTO = join(work, photoName);

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? `  [${detail}]` : ''}`); };
const note = (text) => console.log(`  ....  ${text}`);
const shot = (page, name) => (shotsDir ? page.screenshot(join(shotsDir, `${name}.png`)) : null);

async function newPage({ motion = 'reduce', width = 1440, height = 900, dpr = 1, mobile = false } = {}) {
  const page = await openPage(browser.port);
  await page.emulateMedia([{ name: 'prefers-reduced-motion', value: motion }]);
  await page.viewport(width, height, dpr, mobile);
  await page.goto(BASE);
  await page.eval('localStorage.clear()');
  await page.goto(BASE);
  await page.eval(`document.querySelector('#notice-dialog[open] button[type=submit]')?.click()`);
  return page;
}
/** Read from the app's store: st(page, "s.faces.length"). */
const st = (page, expr) => page.eval(`import('/js/state.js').then((m) => { const s = m.getState(); return (${expr}); })`);
const cards = (page) => page.eval(`document.querySelectorAll('#face-grid .face-card').length`);
const waitDetected = (page, timeout = 120000) => page.waitFor(`document.getElementById('detect-overlay').hidden && document.querySelectorAll('#face-grid .face-card').length > 0`, { timeout, label: 'detection to finish' });
const upload = async (page, file) => { await page.setFiles('#file-input', [file]); await page.waitFor(`!document.getElementById('screen-review').hidden`, { label: 'the review screen' }); };
const clickEl = async (page, sel) => { const r = await page.rect(sel); if (!r) throw new Error(`missing ${sel}`); await page.click(r.cx, r.cy); await sleep(120); };
const waitSelected = (page) => page.waitFor(`!document.getElementById('btn-enlarge').hidden`, { timeout: 25000, label: 'a result' });
const visible = (page, sel) => page.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden && e.getBoundingClientRect().width > 0; })()`);
const offLow = (page) => page.eval(`(() => { const b = document.getElementById('btn-off-low'); if (!b.disabled) b.click(); })()`);
async function toWheel(page, { dropLow = true } = {}) {
  await upload(page, PHOTO); await waitDetected(page);
  if (dropLow) await offLow(page);
  await sleep(150);
  await clickEl(page, '#btn-build');
  await page.waitFor(`!document.getElementById('screen-wheel').hidden`); await sleep(400);
}
/** Click the selected segment: it always rests under the pointer at 12 o'clock. */
async function clickSelectedSegment(page) {
  const wc = await page.rect('#wheel-canvas');
  await page.click(wc.cx, wc.y + wc.h * 0.535 - wc.w * 0.45 * 0.8);
}

// ------------------------------------------------------------------ fixtures, built from the given photo in the browser
async function makeFixtures() {
  const page = await openPage(browser.port);
  await page.goto(BASE);
  const make = (w, h, quality) => page.eval(`(async () => {
    const img = new Image(); img.src = '/__t/${photoName}'; await img.decode();
    const c = document.createElement('canvas'); c.width = ${w ?? 'img.naturalWidth'}; c.height = ${h ?? 'img.naturalHeight'};
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', ${quality}));
    const bytes = new Uint8Array(await blob.arrayBuffer()); let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { b64: btoa(s), w: c.width, h: c.height };
  })()`);
  const base = await make(null, null, 0.92);
  const baseBytes = Buffer.from(base.b64, 'base64');
  // EXIF orientation 6 ("rotate 90 degrees clockwise to display"): an APP1 segment right after the JFIF APP0 segment
  const at = 4 + baseBytes.readUInt16BE(4);
  const exif = Buffer.from([0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01,
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  writeFileSync(join(work, 'exif6.jpg'), Buffer.concat([baseBytes.subarray(0, at), exif, baseBytes.subarray(at)]));
  writeFileSync(join(work, 'corrupt.jpg'), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5000, 7)]));
  writeFileSync(join(work, 'notes.txt'), 'this is not an image');
  writeFileSync(join(work, 'huge.jpg'), Buffer.alloc(31 * 1024 * 1024, 1)); // over the 30 MB limit; never decoded
  const big = await make(6200, 4850, 0.8);                                  // about 30 megapixels
  writeFileSync(join(work, 'big30mp.jpg'), Buffer.from(big.b64, 'base64'));
  page.close();
  return { w: base.w, h: base.h };
}
const fixtures = await makeFixtures();

// ------------------------------------------------------------------ scenarios
const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

scenario('happy path: upload, detect, review, build, spin (3 rounds), select, pop-out', async () => {
  const page = await newPage({ motion: 'no-preference' });
  const t0 = Date.now();
  await upload(page, PHOTO); await waitDetected(page);
  note(`detection took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const found = await cards(page);
  check('faces were found and listed as cards', found >= 5, `${found} faces`);
  await shot(page, 'review');
  await offLow(page); await sleep(150);
  check('the build button is enabled', await page.eval(`!document.getElementById('btn-build').disabled`));
  await clickEl(page, '#btn-build');
  await page.waitFor(`!document.getElementById('screen-wheel').hidden`); await sleep(500);
  check('the roster lists every face', (await page.eval(`document.querySelectorAll('#roster-list .roster-row').length`)) === found);
  await shot(page, 'wheel');

  const spinAt = Date.now();
  await clickEl(page, '#btn-spin');
  await sleep(400);
  const plan = await st(page, `({ rounds: (s.wheel.plan.phiEnd - s.wheel.plan.phiStart) / (2 * Math.PI) })`);
  check('the spin is 3 full rounds plus the landing offset', plan.rounds >= 3 && plan.rounds < 4, `${plan.rounds.toFixed(2)} rounds`);
  await sleep(800);
  check('the wheel is spinning after 1.2 s', (await page.eval(`document.getElementById('result-text').textContent`)) === 'Spinning…');
  await shot(page, 'spinning');
  await waitSelected(page);
  const seconds = (Date.now() - spinAt) / 1000;
  check('the spin lasts 4 to 6 seconds', seconds >= 3.8 && seconds <= 6.8, `${seconds.toFixed(1)} s`);
  await sleep(700);
  const result = await page.eval(`document.getElementById('result-text').textContent`);
  check('the result is announced', result.startsWith('Selected: '), result);
  await shot(page, 'selected');

  await clickSelectedSegment(page);
  await page.waitFor(`document.getElementById('popout').open`, { label: 'the pop-out' }); await sleep(600);
  const po = await page.eval(`(() => { const r = document.getElementById('popout-face').getBoundingClientRect(); return { caption: document.getElementById('popout-caption').textContent, w: r.width, h: r.height }; })()`);
  check('clicking the selected segment opens its face', po.caption === result.replace('Selected: ', ''), po.caption);
  check('the face is at least 240 px and square', po.w >= 240 && Math.abs(po.w - po.h) < 1, `${po.w.toFixed(0)} px`);
  await shot(page, 'popout');
  await page.key('Escape'); await sleep(300);
  check('Esc closes the pop-out', !(await page.eval(`document.getElementById('popout').open`)));
  check('no script errors', page.console.every((l) => !/^\[exception\]/.test(l)), page.console.filter((l) => /^\[exception\]/.test(l)).join(' | '));
  check('no request left the app\'s origin', page.requests.every((u) => u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')));
  page.close();
});

scenario('sound and rounds: cute tones on by default, a mute button (WH-6, WH-13)', async () => {
  const page = await newPage({ motion: 'no-preference' });
  const sounds = () => page.eval(`import('/js/ui/sound.js').then((m) => JSON.stringify(m.sound.stats))`).then(JSON.parse);
  await toWheel(page);
  check('sound is on by default', (await st(page, `s.settings.sound`)) === true && (await page.eval(`document.getElementById('btn-sound').getAttribute('aria-pressed')`)) === 'true');
  await clickEl(page, '#btn-spin'); await waitSelected(page); await sleep(900);
  let n = await sounds();
  check('a spin plays a start sound, ticks and one result jingle', n.start === 1 && n.tick >= 10 && n.reveal === 1, JSON.stringify(n));
  await clickEl(page, '#btn-sound');
  check('the Sound button mutes (pressed=false, off icon, remembered)', (await page.eval(`document.getElementById('btn-sound').getAttribute('aria-pressed')`)) === 'false'
    && (await page.eval(`document.getElementById('sound-icon').getAttribute('href')`)) === '#i-sound-off'
    && (await page.eval(`localStorage.getItem('stw.settings.v1')`)).includes('"sound":false'));
  const before = await sounds();
  await clickEl(page, '#btn-spin'); await waitSelected(page); await sleep(500);
  check('while muted a spin makes no sound', JSON.stringify(before) === JSON.stringify(await sounds()));
  await clickEl(page, '#btn-sound');
  await clickEl(page, '#btn-spin'); await waitSelected(page); await sleep(500);
  n = await sounds();
  check('unmuting brings the sounds back', n.start === before.start + 1 && n.reveal === before.reveal + 1, JSON.stringify(n));
  await page.emulateMedia([{ name: 'prefers-reduced-motion', value: 'reduce' }]); await sleep(300);
  const r0 = await sounds();
  await clickEl(page, '#btn-spin'); await waitSelected(page); await sleep(500);
  const r1 = await sounds();
  check('with reduced motion: no ticks, only the start and result sounds', r1.tick === r0.tick && r1.reveal === r0.reveal + 1, JSON.stringify(r1));
  page.close();
});

scenario('reduced motion: no spin animation, the result appears at once (WH-6, AC-10)', async () => {
  const page = await newPage({ motion: 'reduce' });
  await toWheel(page);
  await clickEl(page, '#btn-spin'); await sleep(900);
  check('the result is already shown after 0.9 s', (await page.eval(`document.getElementById('result-text').textContent`)).startsWith('Selected: '));
  await clickEl(page, '#btn-enlarge'); await page.waitFor(`document.getElementById('popout').open`);
  check('the pop-out opens', true);
  page.close();
});

scenario('cap: more than 50 candidates -> 50 on the wheel, the rest listed but switched off (FD-8, AC-11)', async () => {
  const page = await newPage();
  await upload(page, PHOTO); await waitDetected(page);
  await page.eval(`(() => { const r = document.getElementById('sens-range'); r.value = '3'; r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await page.waitFor(`!document.getElementById('detect-overlay').hidden`, { timeout: 8000, label: 'the re-scan to start' });
  await waitDetected(page, 240000);
  const q = () => page.eval(`(() => { const all = [...document.querySelectorAll('#face-grid .face-include')]; return { cards: all.length, on: all.filter((i) => i.checked).length, off: all.filter((i) => !i.checked).length, offDisabled: all.filter((i) => !i.checked && i.disabled).length, toasts: [...document.querySelectorAll('.toast p')].map((p) => p.textContent) }; })()`);
  let r = await q();
  if (r.cards <= 50) { note(`skipped: this photo gives only ${r.cards} candidates at Max sensitivity`); page.close(); return; }
  check('exactly 50 are on the wheel', r.on === 50, `${r.cards} candidates`);
  check('every switched-off face has its checkbox disabled', r.offDisabled === r.off);
  check('a notice explains the 50-face limit', r.toasts.some((t) => t.includes('Only 50 faces fit on one wheel')));
  await shot(page, 'cap');
  await page.eval(`document.querySelector('#face-grid .face-include:checked').scrollIntoView({ block: 'center' })`); await sleep(300);
  const sw = await page.eval(`(() => { const r = document.querySelector('#face-grid .face-include:checked').closest('.switch').getBoundingClientRect(); return { x: r.x + 24, y: r.y + r.height / 2 }; })()`);
  await page.click(sw.x, sw.y); await sleep(300);
  r = await q();
  check('switching one off leaves 49 on and none blocked', r.on === 49 && r.offDisabled === 0, `on=${r.on}`);
  await page.eval(`document.querySelector('#face-grid .face-include:not(:checked)').click()`); await sleep(300);
  check('switching another on brings it back to 50', (await q()).on === 50);
  page.close();
});

scenario('review: add a missed face by drawing, name it, delete, undo, expected count (RV-2 to RV-10)', async () => {
  const page = await newPage();
  await upload(page, PHOTO); await waitDetected(page);
  const before = await cards(page);
  await clickEl(page, '#btn-add-face');
  check('add mode is on', (await page.eval(`document.getElementById('btn-add-face').getAttribute('aria-pressed')`)) === 'true');
  const c = await page.rect('#photo-canvas');
  await page.drag(c.x + 30, c.y + 30, c.x + 110, c.y + 110); await sleep(300);
  check('drawing a box adds a face card', (await cards(page)) === before + 1, `${before} -> ${await cards(page)}`);
  check('the new face is hand-drawn and on the wheel', (await st(page, `s.faces.filter((f) => f.source === 'manual' && f.included).length`)) === 1);
  check('add mode ends after one box', (await page.eval(`document.getElementById('btn-add-face').getAttribute('aria-pressed')`)) === 'false');
  await shot(page, 'added');
  const input = await page.rect('#face-grid .face-card:first-child .face-label');
  await page.click(input.cx, input.cy);
  await page.send('Input.insertText', { text: 'Ana M.' }); await sleep(150);
  await page.eval(`document.querySelector('#face-grid .face-card:nth-child(3) .face-include').click()`); await sleep(250);
  check('a typed name survives other changes', (await st(page, `s.faces.find((f) => f.num === 1).label`)) === 'Ana M.' && (await page.eval(`document.querySelector('#face-grid .face-card:first-child .face-label').value`)) === 'Ana M.');
  const n = await cards(page);
  const del = await page.rect('#face-grid .face-card:nth-child(2) .face-delete');
  await page.click(del.cx, del.cy); await sleep(250);
  check('delete removes the card and renumbers 1..N', (await cards(page)) === n - 1 && (await st(page, `s.faces.every((f, i) => f.num === i + 1)`)));
  await page.eval('document.activeElement.blur()');
  await page.key('z', { modifiers: 2 }); await sleep(250);
  check('Ctrl+Z brings it back', (await cards(page)) === n);
  await page.key('y', { modifiers: 2 }); await sleep(250);
  check('Ctrl+Y deletes it again', (await cards(page)) === n - 1);
  await clickEl(page, '#btn-undo'); await sleep(200);
  check('the Undo button works too', (await cards(page)) === n);
  await page.eval(`(() => { const i = document.getElementById('expected-input'); i.value = '${n + 40}'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(200);
  check('a mismatch with the expected count shows a warning', await visible(page, '#expected-warning'));
  page.close();
});

scenario('wheel: roster preview, keyboard, context view, remove, remove-picked, reset, present (README 4.4 to 4.6)', async () => {
  const page = await newPage();
  await toWheel(page);
  const included = await st(page, `s.faces.filter((f) => f.included).length`);
  check('focus moved to the wheel heading', (await page.eval(`document.activeElement.id`)) === 'wheel-title');

  await clickEl(page, '#roster-list .roster-row:first-child .roster-main');
  await page.waitFor(`document.getElementById('popout').open`);
  check('a roster click opens a pop-out marked Preview', await visible(page, '#popout-preview') && (await page.eval(`document.getElementById('popout-caption').textContent`)) === '#1');
  await page.key('Escape'); await sleep(250);
  check('Esc closes it', !(await page.eval(`document.getElementById('popout').open`)));

  await page.eval(`document.getElementById('btn-spin').focus()`);
  await page.key(' '); await waitSelected(page);
  check('Space on SPIN spins', (await page.eval(`document.getElementById('result-text').textContent`)).startsWith('Selected: '));
  await page.eval(`document.getElementById('btn-enlarge').focus()`);
  await page.key('Enter'); await page.waitFor(`document.getElementById('popout').open`);
  check('Enter on Enlarge opens the pop-out and moves focus inside', await page.eval(`document.getElementById('popout').contains(document.activeElement)`));
  await page.key('Escape'); await sleep(300);
  check('Esc closes it and focus returns to Enlarge', (await page.eval(`document.activeElement.id`)) === 'btn-enlarge');

  await clickSelectedSegment(page);
  await page.waitFor(`document.getElementById('popout').open`);
  await clickEl(page, '#popout-context-toggle');
  check('"Show in class photo" shows the context view', await visible(page, '#popout-context') && !(await visible(page, '#popout-face')));
  await shot(page, 'context');
  await clickEl(page, '#popout-context-toggle');
  check('and toggles back to the face', await visible(page, '#popout-face'));

  const removedId = await st(page, `s.popout.faceId`);
  await clickEl(page, '#popout-remove'); await sleep(300);
  check('Remove closes the pop-out, switches the face off and clears the result', !(await page.eval(`document.getElementById('popout').open`))
    && (await st(page, `s.faces.find((f) => f.id === ${JSON.stringify(removedId)}).included === false && s.wheel.phase === 'idle'`)));

  await clickEl(page, '#btn-settings');
  await clickEl(page, '#settings-dialog input[name=afterPick][value=remove]');
  await page.key('Escape'); await sleep(200);
  const picks = [];
  for (let i = 0; i < 3; i++) { await clickEl(page, '#btn-spin'); await waitSelected(page); picks.push(await st(page, `s.wheel.selectedId`)); await sleep(200); }
  check('three spins gave three different faces', new Set(picks).size === 3);
  const label = await page.eval(`document.getElementById('wheel-canvas').getAttribute('aria-label')`);
  check('the wheel shrank as faces were picked', label.startsWith(`Wheel with ${included - 3} faces`), label);
  const items = await page.eval(`document.querySelectorAll('#history-list li').length`);
  check('the history lists every pick so far', items === (await st(page, `s.wheel.picks.length`)) && items === 4, `${items} items`);
  await shot(page, 'remove-mode');

  await clickEl(page, '#btn-enlarge'); await page.waitFor(`document.getElementById('popout').open`);
  const picksBefore = await st(page, `s.wheel.picks.length`);
  await clickEl(page, '#popout-spin'); await sleep(500);
  check('"Spin again" closes the pop-out and picks someone new', !(await page.eval(`document.getElementById('popout').open`)) && (await st(page, `s.wheel.picks.length`)) === picksBefore + 1);
  await clickEl(page, '#btn-reset-picks'); await sleep(250);
  check('Reset picks clears picks and history', (await st(page, `s.faces.every((f) => f.pickCount === 0) && s.wheel.picks.length === 0`)) && (await page.eval(`document.querySelectorAll('#history-list li').length`)) === 0);

  const total = await page.eval(`document.querySelectorAll('#roster-list .roster-row').length`);
  await clickEl(page, '#btn-edit-faces'); await page.waitFor(`!document.getElementById('screen-review').hidden`);
  check('Edit faces returns to the review screen with the faces kept', (await cards(page)) === total);
  await clickEl(page, '#btn-build'); await page.waitFor(`!document.getElementById('screen-wheel').hidden`); await sleep(300);
  await clickEl(page, '#btn-present'); await sleep(500);
  check('present mode hides the panels', (await page.eval(`document.body.classList.contains('present')`)) && !(await visible(page, '#roster-pane')) && await visible(page, '#btn-exit-present'));
  await shot(page, 'present');
  await clickEl(page, '#btn-exit-present'); await sleep(300);
  check('and exit brings them back', !(await page.eval(`document.body.classList.contains('present')`)) && await visible(page, '#roster-pane'));
  page.close();
});

scenario('settings: theme, help, nothing but settings stored, delete all data (ST-1, PS-1)', async () => {
  const page = await newPage();
  await toWheel(page);
  await clickEl(page, '#btn-settings');
  await clickEl(page, '#settings-dialog input[name=theme][value=dark]');
  check('choosing Dark sets the theme and remembers it', (await page.eval(`document.documentElement.dataset.theme`)) === 'dark' && (await page.eval(`localStorage.getItem('stw.settings.v1')`)).includes('"theme":"dark"'));
  await shot(page, 'settings-dark');
  await page.key('Escape'); await sleep(250);
  await clickEl(page, '#btn-spin'); await waitSelected(page); await sleep(500);
  await shot(page, 'wheel-dark');
  await clickEl(page, '#btn-help');
  check('Help opens', await page.eval(`document.getElementById('help-dialog').open`));
  await page.key('Escape'); await sleep(200);
  const keys = await page.eval(`Object.keys(localStorage).sort().join(',')`);
  check('only the settings and the notice flag are stored, no student data', keys === 'stw.noticeSeen.v1,stw.settings.v1', keys);
  await clickEl(page, '#btn-settings');
  await clickEl(page, '#btn-delete-data'); await sleep(500);
  check('Delete all data empties storage and starts over', (await page.eval(`Object.keys(localStorage).length`)) === 0 && !(await page.eval(`document.getElementById('screen-upload').hidden`)));
  page.close();
});

scenario('upload: wrong type, damaged file, too large, drop, paste (UP-1, UP-3)', async () => {
  let page = await newPage();
  const err = () => page.eval(`(() => { const e = document.getElementById('upload-error'); return e.hidden ? '' : e.textContent; })()`);
  await page.setFiles('#file-input', [join(work, 'notes.txt')]); await sleep(500);
  check('a text file is refused', (await err()).includes('not a JPEG, PNG or WebP'), await err());
  await page.setFiles('#file-input', [join(work, 'corrupt.jpg')]); await sleep(800);
  check('a damaged image is refused', (await err()).includes('could not be opened'), await err());
  await page.setFiles('#file-input', [join(work, 'huge.jpg')]); await sleep(800);
  check('a file over 30 MB is refused, naming the limit', (await err()).includes('30 MB'), await err());
  check('the app stays on the upload screen', !(await page.eval(`document.getElementById('screen-upload').hidden`)));
  await shot(page, 'upload-error');
  page.close();

  for (const [how, name] of [['drop', 'dropped.jpg'], ['paste', 'pasted.jpg']]) {
    page = await newPage();
    await page.eval(`(async () => {
      const blob = await (await fetch('/__t/${photoName}')).blob();
      const dt = new DataTransfer(); dt.items.add(new File([blob], '${name}', { type: blob.type || 'image/jpeg' }));
      ${how === 'drop'
    ? `document.getElementById('dropzone').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));`
    : `document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));`}
    })()`);
    await page.waitFor(`!document.getElementById('screen-review').hidden`, { label: `review after ${how}` });
    check(`${how === 'drop' ? 'dropping' : 'pasting'} a photo works`, (await st(page, `s.photo.name`)) === name);
    page.close();
  }
});

scenario('EXIF orientation is applied (UP-4)', async () => {
  const page = await newPage();
  await upload(page, join(work, 'exif6.jpg'));
  const dims = await st(page, `[s.photo.width, s.photo.height]`);
  check('a photo tagged "rotate 90" comes out with width and height swapped', dims[0] === fixtures.h && dims[1] === fixtures.w, `${dims.join(' x ')} from ${fixtures.w} x ${fixtures.h}`);
  page.close();
});

scenario('large photo: more than 25 MP is reduced once, with a notice (UP-3)', async () => {
  const page = await newPage();
  const t0 = Date.now();
  await upload(page, join(work, 'big30mp.jpg'));
  const loadMs = Date.now() - t0;
  const d = await st(page, `[s.photo.width, s.photo.height, s.photo.pyramid.length]`);
  check('the working copy is capped at 25 MP', d[0] * d[1] <= 25_000_000 && d[0] * d[1] > 15_000_000, `${d[0]} x ${d[1]}, ${loadMs} ms to load`);
  check('a notice says it was reduced', (await page.eval(`[...document.querySelectorAll('.toast p')].map((p) => p.textContent).join(' ')`)).includes('reduced'));
  const t1 = Date.now();
  await waitDetected(page, 240000);
  note(`detection on the ${d[0]} x ${d[1]} copy took ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  check('faces were found', (await cards(page)) >= 5);
  page.close();
});

scenario('phone layout (390 x 844): review, wheel and pop-out are usable', async () => {
  const page = await newPage({ width: 390, height: 844, dpr: 2, mobile: true });
  await upload(page, PHOTO); await waitDetected(page);
  await shot(page, 'phone-review');
  check('no horizontal scrolling on the review screen', (await page.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 1);
  await offLow(page); await sleep(200);
  await page.eval(`document.getElementById('btn-build').click()`);
  await page.waitFor(`!document.getElementById('screen-wheel').hidden`); await sleep(500);
  await shot(page, 'phone-wheel');
  check('no horizontal scrolling on the wheel screen', (await page.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 1);
  const hub = await page.rect('#btn-spin');
  check('the SPIN button is at least 44 px', hub.w >= 44, `${hub.w.toFixed(0)} px`);
  await page.click(hub.cx, hub.cy); await waitSelected(page);
  await page.eval(`document.getElementById('btn-enlarge').click()`);
  await page.waitFor(`document.getElementById('popout').open`); await sleep(500);
  await shot(page, 'phone-popout');
  const face = await page.rect('#popout-face');
  check('the enlarged face is at least 240 px and fits the screen', face.w >= 240 && face.w <= 390, `${face.w.toFixed(0)} px`);
  page.close();
});

if (args.slow) {
  scenario('privacy: the detector\'s metrics request is blocked by the CSP and detection keeps working', async () => {
    const page = await newPage();
    await upload(page, PHOTO); await waitDetected(page);
    note('waiting 70 s for the runtime\'s 60-second metrics timer...');
    await sleep(70000);
    const csp = page.console.filter((l) => /odml\.pa\.googleapis\.com|Content Security Policy/i.test(l));
    check('the metrics request was attempted and blocked by the CSP', csp.length > 0, `${csp.length} console messages`);
    await page.eval(`(() => { const r = document.getElementById('sens-range'); r.value = '2'; r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await page.waitFor(`!document.getElementById('detect-overlay').hidden`, { timeout: 8000 });
    await waitDetected(page, 240000);
    check('a re-scan after the blocked request still works', (await cards(page)) > 0);
    page.close();
  });
}

// ------------------------------------------------------------------ run
try {
  for (const { name, fn } of scenarios) {
    if (typeof args.only === 'string' && !name.toLowerCase().includes(args.only.toLowerCase())) continue;
    console.log(`\n== ${name}`);
    try { await fn(); } catch (err) { failed++; console.log(`  FAIL  the scenario stopped: ${err.message}`); }
  }
} finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
