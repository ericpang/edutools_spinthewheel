// End-to-end test of "Use a photo from your phone" (UP-7): one browser page plays the computer, a second plays the phone,
// and a photo travels between them through the real pairing service named in js/pair/config.js.
// So it needs an internet connection. No dependencies; Node 22 or newer and an installed Chrome or Edge.
//
//   node tests/e2e/pair.mjs [--browser <chrome or msedge>] [--port 9444] [--shots <folder>]
//
// The "photo" is a generated noise PNG (about 3 MB, so it spans around 200 encrypted chunks); no real photo is used.
import { deflateSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomFillSync } from 'node:crypto';
import { findBrowser, launchBrowser, openPage } from './cdp.mjs';
import { startServer } from './serve.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// A valid RGB PNG of random bytes: it does not compress, so the file is about as big as the raw pixels.
function noisePng(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  randomFillSync(raw);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0; // filter type "none" at the start of each row
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}

const work = mkdtempSync(join(tmpdir(), 'stw-pair-'));
const PHOTO = join(work, 'noise.png');
writeFileSync(PHOTO, noisePng(1100, 900));

const shots = args.shots ? resolve(args.shots) : null;
if (shots) mkdirSync(shots, { recursive: true });
const server = await startServer({ root });
const browser = await launchBrowser({ exe: findBrowser(args.browser), port: Number(args.port ?? 9444) });
let failed = false;
const step = (text) => console.log(`  ${text}`);

try {
  const computer = await openPage(browser.port);
  await computer.viewport(1280, 800);
  await computer.goto(server.url);
  await computer.waitFor(`!document.getElementById('phone-option').hidden`, { label: 'the phone button' });

  // The computer: open the dialog and wait for the code.
  // The pairing page has a strict CSP (no eval), and it lives in an iframe, so its checks run through the frame's own
  // execution context. DevTools evaluation is not subject to the page's CSP.
  const frameId = (await computer.send('Page.getFrameTree')).frameTree.frame.id;
  const contexts = new Map();
  computer.ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.executionContextCreated') contexts.set(msg.params.context.id, msg.params.context);
    if (msg.method === 'Runtime.executionContextDestroyed') contexts.delete(msg.params.executionContextId);
  });
  await computer.send('Runtime.disable'); // enabling again replays the contexts that already exist
  await computer.send('Runtime.enable');
  const inFrame = async (expression) => {
    const context = [...contexts.values()].reverse().find((c) => c.auxData?.isDefault && c.auxData.frameId !== frameId && c.origin === new URL(server.url).origin);
    if (!context) return null;
    const r = await computer.send('Runtime.evaluate', { contextId: context.id, expression, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails ? null : r.result.value;
  };
  const waitInFrame = async (expression, { timeout = 30000, label } = {}) => {
    for (const t0 = Date.now(); Date.now() - t0 < timeout; await new Promise((r) => setTimeout(r, 150))) {
      const value = await inFrame(expression).catch(() => null);
      if (value) return value;
    }
    throw new Error(`timed out waiting for: ${label ?? expression}`);
  };

  await computer.eval(`document.getElementById('btn-phone').click()`);
  await waitInFrame(`!document.getElementById('pair-code').hidden`, { timeout: 30000, label: 'the QR code (is the pairing service reachable?)' });
  step('the computer shows a code');
  if (shots) await computer.screenshot(join(shots, 'computer-code.png'));

  // Read the link through the "Copy link" button, with the clipboard replaced so no permission is needed.
  await inFrame(`navigator.clipboard.writeText = async (s) => { window.__link = s; }; document.getElementById('btn-copy').click(); 1`);
  const link = await waitInFrame(`window.__link`, { label: 'the link' });
  if (!/\/send\.html#stw-[0-9a-f]{32}\.[\w-]{43}$/.test(link)) throw new Error(`unexpected link: ${link}`);
  step('the link has the expected shape and keeps the key in the # part');

  // The phone: open the link, wait until it is connected, send the photo.
  const phone = await openPage(browser.port);
  await phone.viewport(390, 800, 2, true);
  await phone.goto(link);
  await phone.waitFor(`!document.getElementById('send-actions').hidden`, { timeout: 40000, label: 'the phone to connect' });
  step('the phone connected to the computer');
  if (shots) await phone.screenshot(join(shots, 'phone-ready.png'));
  await waitInFrame(`document.getElementById('pair-status').textContent.includes('Phone connected')`, { label: 'the computer to see the phone' });

  await phone.setFiles('#input-library', [PHOTO]);
  await phone.waitFor(`document.getElementById('send-status').textContent.startsWith('Sent')`, { timeout: 90000, label: 'the phone to report "Sent"' });
  step('the phone reports the photo as sent');
  if (shots) await phone.screenshot(join(shots, 'phone-sent.png'));

  // The computer: the photo arrives and the review screen opens with it.
  await computer.waitFor(`!document.getElementById('screen-review').hidden`, { timeout: 30000, label: 'the review screen' });
  await computer.waitFor(`document.getElementById('photo-canvas').width > 0`, { label: 'the photo on the canvas' });
  if (await computer.eval(`document.getElementById('pair-dialog').open`)) throw new Error('the dialog should have closed');
  step('the photo opened on the review screen and the dialog closed');

  // The computer's pairing page is gone, so the code no longer works: a second phone cannot send to it.
  const late = await openPage(browser.port);
  await late.goto(link);
  await late.waitFor(`document.getElementById('send-status').classList.contains('is-error')`, { timeout: 40000, label: 'the late phone to be refused' }).catch(async (err) => { throw new Error(`${err.message} (it shows: "${await late.eval(`document.getElementById('send-status').textContent`)}")`); });
  step('a second phone using the same link is refused');
  console.log('PASS');
} catch (err) {
  failed = true;
  console.error(`FAIL: ${err.message}`);
} finally {
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
}

