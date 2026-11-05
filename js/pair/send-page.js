// send.html, the phone side: connects to the computer named in the link, then sends the photo you take, encrypted
// with the key that is in the link's "#" part (README 4.1, UP-7). Nothing is stored on the phone.
import { MAX_FILE_BYTES } from '../core/config.js';
import { loadSettings } from '../storage/settings.js';
import { applyStrings } from '../ui/dom.js';
import { t } from '../strings.js';
import { PAIRING } from './config.js';
import { CHUNK_BYTES, ProtocolError, importKey, parseAck, parseLink, sealFile } from './protocol.js';

const $ = (selector) => document.querySelector(selector);
const el = {
  status: $('#send-status'), progress: $('#send-progress'), actions: $('#send-actions'), retry: $('#btn-retry'),
  camera: $('#input-camera'), library: $('#input-library'),
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const theme = loadSettings().theme;
if (theme) document.documentElement.dataset.theme = theme;
applyStrings();

const session = parseLink(globalThis.location.hash);
let peer = null;
let conn = null;
let cryptoKey = null;
let busy = false;
let waitingForAck = null; // { resolve } while a photo is on its way
let attempt = 0;

function say(text, kind = '') {
  el.status.textContent = text;
  el.status.classList.toggle('is-error', kind === 'error');
  el.status.classList.toggle('is-good', kind === 'good');
}

function show({ actions = false, retry = false, progress = null }) {
  el.actions.hidden = !actions;
  el.retry.hidden = !retry;
  el.progress.hidden = progress === null;
  if (progress !== null) el.progress.value = Math.round(progress * 100);
}

function closeConnection() {
  try { peer?.destroy(); } catch { /* already gone */ }
  peer = null;
  conn = null;
}

/** Reach the computer. Resolves when the data channel is open; rejects with a text to show. */
function connect() {
  closeConnection();
  const mine = ++attempt;
  return new Promise((resolve, reject) => {
    if (typeof globalThis.Peer !== 'function' || typeof globalThis.RTCPeerConnection !== 'function') { reject(t('send.error.unsupported')); return; }
    const { host, port, path, secure, key } = PAIRING.signalling;
    const options = { host, port, path, secure, key, debug: 0 };
    if (PAIRING.iceServers) options.config = { iceServers: PAIRING.iceServers };
    const me = new globalThis.Peer(options);
    peer = me;
    const current = () => mine === attempt;
    const timer = setTimeout(() => { if (current()) { closeConnection(); reject(t('send.error.timeout')); } }, PAIRING.connectSeconds * 1000);
    const giveUp = (text) => { clearTimeout(timer); if (current()) { closeConnection(); reject(text); } };

    // Once the data channel is open the pairing service is no longer needed, so its errors do not matter.
    me.on('error', (err) => conn?.open || giveUp(err?.type === 'peer-unavailable' ? t('send.error.gone')
      : ['network', 'server-error', 'socket-error', 'socket-closed'].includes(err?.type) ? t('send.error.timeout')
        : t('send.error.generic')));
    me.on('open', () => {
      if (!current()) return;
      const c = me.connect(session.id, { serialization: 'raw', reliable: true });
      c.on('open', () => {
        clearTimeout(timer);
        if (!current()) return;
        conn = c;
        resolve();
      });
      c.on('data', (data) => {
        const ack = parseAck(data);
        if (ack) waitingForAck?.resolve(ack);
      });
      c.on('close', () => { if (conn === c) { conn = null; waitingForAck?.resolve({ ok: false, code: 'lost' }); } });
      c.on('error', () => giveUp(t('send.error.generic')));
    });
  });
}

async function ready() {
  show({});
  say(t('send.connecting'));
  try {
    await connect();
  } catch (text) {
    say(String(text), 'error');
    show({ retry: true });
    return false;
  }
  say(t('send.ready'));
  show({ actions: true });
  return true;
}

async function sendPhoto(file) {
  if (busy || !file) return;
  if (!file.type.startsWith('image/')) { say(t('send.error.type'), 'error'); return; }
  if (file.size > MAX_FILE_BYTES) { say(t('error.size', Math.round(MAX_FILE_BYTES / 1024 / 1024)), 'error'); return; }
  busy = true;
  show({ progress: 0 });
  try {
    if (!conn?.open && !(await ready())) return;
    show({ progress: 0 });
    const answer = new Promise((resolve) => { waitingForAck = { resolve }; });
    const total = Math.ceil(file.size / CHUNK_BYTES) + 1; // the description, then the chunks
    let sent = 0;
    for await (const message of sealFile(cryptoKey, file)) {
      while (conn?.open && conn.bufferSize > 16) await sleep(25); // let the connection catch up before queuing more
      if (!conn?.open) throw new ProtocolError('unexpected', 'lost');
      conn.send(message);
      sent++;
      say(t('send.sending', Math.round((sent / total) * 100)));
      show({ progress: sent / total });
    }
    say(t('send.waitingAck'));
    show({});
    const result = await Promise.race([answer, sleep(30_000).then(() => ({ ok: false, code: 'timeout' }))]);
    if (result.ok) {
      say(t('send.done'), 'good');
      show({ actions: true });
    } else {
      say(result.code === 'lost' || result.code === 'timeout' ? t('send.error.lost') : t('send.error.refused'), 'error');
      show({ actions: true });
    }
  } catch (err) {
    say(err instanceof ProtocolError && err.message === 'lost' ? t('send.error.lost') : t('send.error.generic'), 'error');
    show({ actions: true });
  } finally {
    waitingForAck = null;
    busy = false;
  }
}

for (const input of [el.camera, el.library]) {
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = ''; // so choosing the same photo again still fires "change"
    sendPhoto(file);
  });
}
el.retry.addEventListener('click', ready);

if (!session) {
  say(t('send.invalid'), 'error');
} else {
  importKey(session.key).then((key) => { cryptoKey = key; return ready(); });
}
