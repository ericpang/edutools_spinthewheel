// pair.html, the computer side: makes a one-time code, waits for the phone, puts the photo back together and hands it
// to the main page that embeds this one (README 4.1, UP-7). This page and send.html are the only ones allowed to
// reach the network (README 7); the main page stays at connect-src 'self'.
import { applyStrings } from '../ui/dom.js';
import { loadSettings } from '../storage/settings.js';
import { t } from '../strings.js';
import { PAIRING } from './config.js';
import { ACK_ERROR, ACK_OK, ProtocolError, Receiver, buildLink, importKey, newSession } from './protocol.js';

const $ = (selector) => document.querySelector(selector);
const el = {
  code: $('#pair-code'), qr: $('#qr'), status: $('#pair-status'), expires: $('#pair-expires'),
  again: $('#btn-again'), copy: $('#btn-copy'), progress: $('#pair-progress'),
};

const theme = loadSettings().theme;
if (theme) document.documentElement.dataset.theme = theme;
applyStrings();

// Without a main page to give the photo to, this page has no job: go to the app.
if (globalThis.parent === globalThis) { globalThis.location.replace('./'); throw new Error('not embedded'); }

let peer = null;
let link = '';
let ticker = 0;
let current = null; // the connection that is sending now

function say(text, kind = '') {
  el.status.textContent = text;
  el.status.classList.toggle('is-error', kind === 'error');
  el.status.classList.toggle('is-good', kind === 'good');
}

function showProgress(fraction) {
  el.progress.hidden = fraction === null;
  if (fraction !== null) el.progress.value = Math.round(fraction * 100);
}

/** Draw the link as a QR code: black on white with the 4-module quiet zone the standard asks for. */
function drawQr(text) {
  const qr = globalThis.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 4;
  const scale = 8; // the canvas is drawn large and shown smaller by CSS, so it stays sharp on high-DPI screens
  const size = (count + quiet * 2) * scale;
  el.qr.width = size;
  el.qr.height = size;
  const ctx = el.qr.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
  }
}

function stop() {
  clearInterval(ticker);
  current = null;
  try { peer?.destroy(); } catch { /* already gone */ }
  peer = null;
}

function fail(text) {
  stop();
  el.code.hidden = true;
  el.expires.hidden = true;
  showProgress(null);
  say(text, 'error');
  el.again.hidden = false;
}

const toBuffer = async (data) => {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  if (data instanceof Blob) return data.arrayBuffer();
  return null;
};

async function start() {
  stop();
  el.again.hidden = true;
  el.code.hidden = true;
  el.expires.hidden = true;
  showProgress(null);
  say(t('pair.starting'));

  if (typeof globalThis.Peer !== 'function' || typeof globalThis.RTCPeerConnection !== 'function' || typeof globalThis.qrcode !== 'function') {
    fail(t('pair.error.unsupported'));
    return;
  }

  const session = newSession();
  const key = await importKey(session.key);
  link = buildLink(new URL('send.html', globalThis.location.href).href, session);

  const { host, port, path, secure, key: serviceKey } = PAIRING.signalling;
  const options = { host, port, path, secure, key: serviceKey, debug: 0 };
  if (PAIRING.iceServers) options.config = { iceServers: PAIRING.iceServers };
  const mine = new globalThis.Peer(session.id, options);
  peer = mine;
  const alive = () => peer === mine;

  const deadline = Date.now() + PAIRING.sessionMinutes * 60_000;
  mine.on('open', () => {
    if (!alive()) return;
    drawQr(link);
    el.code.hidden = false;
    el.expires.hidden = false;
    say(t('pair.waiting'));
    const tick = () => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      el.expires.textContent = t('pair.expires', Math.floor(left / 60), left % 60);
      if (left === 0 && alive()) fail(t('pair.expired'));
    };
    tick();
    ticker = setInterval(tick, 1000);
  });

  mine.on('error', (err) => {
    if (!alive()) return;
    fail(err?.type === 'browser-incompatible' ? t('pair.error.unsupported')
      : ['network', 'server-error', 'socket-error', 'socket-closed'].includes(err?.type) ? t('pair.error.network')
        : t('pair.error.generic'));
  });

  // The pairing service was lost but the code is still good: try to get back to it (a connection already made is not affected).
  mine.on('disconnected', () => { if (alive() && !mine.destroyed) setTimeout(() => { if (alive() && !mine.destroyed) mine.reconnect(); }, 1000); });

  mine.on('connection', (conn) => {
    if (!alive()) return;
    if (current?.open) { conn.on('open', () => conn.close()); return; } // one phone at a time
    current = conn;
    let receiver = new Receiver(key);
    let chain = Promise.resolve(); // messages are decrypted one after the other, in the order they arrived

    const refuse = (code) => {
      try { conn.send(`${ACK_ERROR}${code}`); } catch { /* the phone is gone */ }
      showProgress(null);
      say(t('pair.error.photo'), 'error');
      setTimeout(() => conn.close(), 400); // give the answer time to leave first
    };

    async function handle(data) {
      if (typeof data === 'string') return; // only the phone's plain-text hellos; nothing to do
      const buffer = await toBuffer(data);
      if (!buffer) return;
      try {
        const result = await receiver.push(buffer);
        if (!result.done) {
          say(t('pair.receiving', Math.round((result.received / result.total) * 100)));
          showProgress(result.received / result.total);
          return;
        }
        receiver = new Receiver(key);
        showProgress(null);
        say(t('pair.done'), 'good');
        conn.send(ACK_OK);
        globalThis.parent.postMessage({ type: 'stw:photo', file: result.file }, globalThis.location.origin);
      } catch (err) {
        refuse(err instanceof ProtocolError ? err.code : 'unexpected');
      }
    }

    conn.on('open', () => { if (alive()) say(t('pair.connected')); });
    conn.on('data', (data) => { chain = chain.then(() => handle(data)); });
    conn.on('close', () => { if (current === conn) current = null; });
    conn.on('error', () => { if (current === conn) current = null; });
  });
}

el.again.addEventListener('click', start);
el.copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(link);
    say(t('pair.copied'), 'good');
  } catch {
    say(t('pair.copyFailed'), 'error');
  }
});
globalThis.addEventListener('pagehide', stop);

start();
