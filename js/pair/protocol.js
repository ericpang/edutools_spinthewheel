// Phone-to-computer photo transfer: the link, the encryption and the chunking (README 4.1, UP-7).
// No DOM here, so it is tested in Node. The key travels only in the link's "#" part, which browsers never send
// to any server, and it encrypts every message: the pairing service and any relay on the way see only ciphertext.
import { MAX_FILE_BYTES } from '../core/config.js';

// Each sealed message adds a 12-byte IV and a 16-byte tag, so a chunk of this size makes a message of exactly
// 16 KiB, the size every browser's data channel accepts.
export const CHUNK_BYTES = 16 * 1024 - 28;
const TAG = 'stw1';

/** What the computer answers (as plain text, over the encrypted channel) once a photo is complete or refused. */
export const ACK_OK = 'ok';
export const ACK_ERROR = 'error:'; // followed by a ProtocolError code
export const parseAck = (text) => (text === ACK_OK ? { ok: true } : typeof text === 'string' && text.startsWith(ACK_ERROR) ? { ok: false, code: text.slice(ACK_ERROR.length) } : null);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class ProtocolError extends Error {
  /** @param {'bad-message'|'bad-meta'|'bad-chunk'|'too-large'|'empty'|'unexpected'} code */
  constructor(code, message = code) { super(message); this.code = code; }
}

const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const fromBase64Url = (text) => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

// ---------------------------------------------------------------- session and link
/** A one-time session: `id` names the computer on the pairing service, `key` encrypts everything. */
export function newSession() {
  return {
    // Hex, not base64url: PeerJS refuses ids with a "-" or "_" at the end or two in a row, which base64url often makes.
    id: `stw-${[...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')}`, // 128 bits: 32 characters after the prefix
    key: toBase64Url(crypto.getRandomValues(new Uint8Array(32))),         // AES-256, 43 characters
  };
}

/** The link for the phone: the page, then "#id.key". */
export const buildLink = (pageUrl, { id, key }) => `${pageUrl}#${id}.${key}`;

/** Read "#id.key" back from a link's hash; null when it is not one of ours. */
export function parseLink(hash) {
  const match = /^#?(stw-[0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/.exec(hash ?? '');
  return match ? { id: match[1], key: match[2] } : null;
}

export const importKey = (key) => crypto.subtle.importKey('raw', fromBase64Url(key), 'AES-GCM', false, ['encrypt', 'decrypt']);

/** A file name that is safe to show and to keep: no path characters, at most 100 characters. */
export const safeName = (name) => String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 100) || 'photo';

// ---------------------------------------------------------------- one encrypted message
// Every message gets its own random IV, and the "additional data" ties it to its place in the stream, so a
// chunk that is reordered, dropped, repeated or replayed in another position fails to decrypt.
async function seal(key, bytes, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, key, bytes));
  const out = new Uint8Array(iv.length + body.length);
  out.set(iv);
  out.set(body, iv.length);
  return out.buffer;
}

async function open(key, buffer, aad) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 12 + 16) throw new ProtocolError('bad-message');
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: encoder.encode(aad) }, key, bytes.slice(12)));
  } catch {
    throw new ProtocolError('bad-message', 'could not decrypt');
  }
}

// ---------------------------------------------------------------- the phone side
/**
 * The messages that carry one photo: a sealed description first, then the file in sealed chunks.
 * @param {CryptoKey} key @param {File} file @returns {AsyncGenerator<ArrayBuffer>}
 */
export async function* sealFile(key, file) {
  if (!(file.size > 0)) throw new ProtocolError('empty');
  if (file.size > MAX_FILE_BYTES) throw new ProtocolError('too-large');
  const chunks = Math.ceil(file.size / CHUNK_BYTES);
  const meta = { v: 1, name: safeName(file.name), type: file.type || 'image/jpeg', size: file.size, chunks };
  yield await seal(key, encoder.encode(JSON.stringify(meta)), `${TAG}|meta`);
  for (let i = 1; i <= chunks; i++) {
    const bytes = new Uint8Array(await file.slice((i - 1) * CHUNK_BYTES, i * CHUNK_BYTES).arrayBuffer());
    yield await seal(key, bytes, `${TAG}|${i}|${chunks}`);
  }
}

// ---------------------------------------------------------------- the computer side
/** Puts the messages of one photo back together, checking every one of them. Make a new Receiver for each photo. */
export class Receiver {
  #key;
  #meta = null;
  #parts = [];
  #next = 1;
  #bytes = 0;
  #finished = false;

  constructor(key) { this.#key = key; }

  /** @returns {Promise<{done: false, received: number, total: number} | {done: true, file: File}>} */
  async push(buffer) {
    if (this.#finished) throw new ProtocolError('unexpected');
    if (!this.#meta) {
      const plain = await open(this.#key, buffer, `${TAG}|meta`);
      let meta;
      try { meta = JSON.parse(decoder.decode(plain)); } catch { throw new ProtocolError('bad-meta'); }
      if (Number.isInteger(meta?.size) && meta.size > MAX_FILE_BYTES) throw new ProtocolError('too-large');
      const valid = meta?.v === 1 && Number.isInteger(meta.size) && meta.size > 0
        && meta.chunks === Math.ceil(meta.size / CHUNK_BYTES)
        && typeof meta.type === 'string' && /^image\//.test(meta.type) && typeof meta.name === 'string';
      if (!valid) throw new ProtocolError('bad-meta');
      this.#meta = meta;
      return { done: false, received: 0, total: meta.size };
    }
    const { chunks, size } = this.#meta;
    const index = this.#next;
    const plain = await open(this.#key, buffer, `${TAG}|${index}|${chunks}`);
    const expected = index < chunks ? CHUNK_BYTES : size - (chunks - 1) * CHUNK_BYTES;
    if (plain.length !== expected) throw new ProtocolError('bad-chunk');
    this.#parts.push(plain);
    this.#bytes += plain.length;
    this.#next++;
    if (index < chunks) return { done: false, received: this.#bytes, total: size };
    this.#finished = true;
    return { done: true, file: new File(this.#parts, safeName(this.#meta.name), { type: this.#meta.type }) };
  }
}
