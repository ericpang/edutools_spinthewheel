import { assert, inNode, test } from './harness.js';
import { MAX_FILE_BYTES } from '../js/core/config.js';
import { CHUNK_BYTES, ProtocolError, Receiver, buildLink, importKey, newSession, parseLink, safeName, sealFile } from '../js/pair/protocol.js';

const photo = (size, name = 'class.jpg', type = 'image/jpeg') => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(size, i + 65536)));
  return new File([bytes], name, { type });
};
const messages = async (key, file) => { const out = []; for await (const m of sealFile(key, file)) out.push(m); return out; };
const sameBytes = async (a, b) => { const x = new Uint8Array(await a.arrayBuffer()), y = new Uint8Array(await b.arrayBuffer()); return x.length === y.length && x.every((v, i) => v === y[i]); };
const rejectsWith = async (fn, code) => { try { await fn(); } catch (err) { assert.equal(err.code, code, `expected ${code}, got ${err.code}`); return; } throw new Error(`expected ${code} but nothing was thrown`); };
async function receiveAll(key, msgs) {
  const receiver = new Receiver(key);
  let last;
  for (const m of msgs) last = await receiver.push(m);
  return last;
}

test('a session has a pairing id and a 256-bit key, and the link round-trips', () => {
  const s = newSession();
  assert.ok(/^stw-[0-9a-f]{32}$/.test(s.id) && /^[A-Za-z0-9_-]{43}$/.test(s.key));
  assert.ok(newSession().id !== s.id && newSession().key !== s.key, 'every session is new');
  const link = buildLink('https://example.github.io/spin/send.html', s);
  assert.deepEqual(parseLink(new URL(link).hash), s);
  assert.equal(parseLink('#nonsense'), null);
  assert.equal(parseLink(''), null);
  assert.equal(parseLink(`#${s.id}.${s.key}x`), null, 'a key of the wrong length is refused');
});

test('every session id is one the pairing service accepts (letters and digits, "-" or "_" only between them)', () => {
  const peerJsRule = /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/; // PeerJS util.validateId
  for (let i = 0; i < 2000; i++) assert.ok(peerJsRule.test(newSession().id));
});

test('the secret part of the link is in the fragment, which browsers never send to a server', () => {
  const s = newSession();
  const url = new URL(buildLink('https://example.github.io/spin/send.html', s));
  assert.ok(!url.pathname.includes(s.key) && !url.search.includes(s.key) && !url.host.includes(s.key));
  assert.ok(url.hash.includes(s.key));
});

test('a photo survives the round trip byte for byte (a bit over 6 chunks)', async () => {
  const key = await importKey(newSession().key);
  const file = photo(CHUNK_BYTES * 6 + 123);
  const msgs = await messages(key, file);
  assert.equal(msgs.length, 1 + 7, 'one description plus 7 chunks');
  const result = await receiveAll(key, msgs);
  assert.ok(result.done);
  assert.equal(result.file.name, 'class.jpg');
  assert.equal(result.file.type, 'image/jpeg');
  assert.ok(await sameBytes(result.file, file));
});

test('a photo that is an exact multiple of the chunk size, and a tiny one, both work', async () => {
  const key = await importKey(newSession().key);
  for (const size of [CHUNK_BYTES * 3, 1, CHUNK_BYTES, CHUNK_BYTES + 1]) {
    const file = photo(size);
    const result = await receiveAll(key, await messages(key, file));
    assert.ok(result.done && await sameBytes(result.file, file), `size ${size}`);
  }
});

test('progress is reported as bytes received', async () => {
  const key = await importKey(newSession().key);
  const receiver = new Receiver(key);
  const msgs = await messages(key, photo(CHUNK_BYTES * 2));
  const first = await receiver.push(msgs[0]);
  assert.deepEqual([first.done, first.received, first.total], [false, 0, CHUNK_BYTES * 2]);
  const second = await receiver.push(msgs[1]);
  assert.equal(second.received, CHUNK_BYTES);
});

test('nothing in a message gives the photo away: no plain bytes, and the name is hidden too', async () => {
  const key = await importKey(newSession().key);
  const bytes = new Uint8Array(CHUNK_BYTES).fill(0x41);
  const msgs = await messages(key, new File([bytes], 'secret-class-photo.jpg', { type: 'image/jpeg' }));
  for (const m of msgs) {
    const text = new TextDecoder('latin1').decode(m);
    assert.ok(!text.includes('AAAAAAAAAAAAAAAA'), 'plain content leaked');
    assert.ok(!text.includes('secret-class-photo'), 'the file name leaked');
  }
});

test('a wrong key cannot read anything', async () => {
  const right = await importKey(newSession().key);
  const wrong = await importKey(newSession().key);
  const msgs = await messages(right, photo(5000));
  await rejectsWith(() => new Receiver(wrong).push(msgs[0]), 'bad-message');
});

test('a message that was changed on the way is refused', async () => {
  const key = await importKey(newSession().key);
  const msgs = await messages(key, photo(CHUNK_BYTES * 2));
  const tampered = new Uint8Array(msgs[1]);
  tampered[tampered.length >> 1] ^= 0xff;
  const receiver = new Receiver(key);
  await receiver.push(msgs[0]);
  await rejectsWith(() => receiver.push(tampered.buffer), 'bad-message');
});

test('chunks that are reordered, repeated or skipped are refused', async () => {
  const key = await importKey(newSession().key);
  const msgs = await messages(key, photo(CHUNK_BYTES * 4));
  for (const order of [[0, 2, 1], [0, 1, 1], [0, 2]]) {
    const receiver = new Receiver(key);
    let failed = false;
    try { for (const i of order) await receiver.push(msgs[i]); } catch (err) { failed = err instanceof ProtocolError; }
    assert.ok(failed, `order ${order.join(',')} should be refused`);
  }
});

test('a chunk from one photo cannot be spliced into another', async () => {
  const key = await importKey(newSession().key);
  const a = await messages(key, photo(CHUNK_BYTES * 3));
  const b = await messages(key, photo(CHUNK_BYTES * 3 + 5));
  const receiver = new Receiver(key);
  await receiver.push(a[0]);
  await receiver.push(a[1]);
  await rejectsWith(() => receiver.push(b[3]), 'bad-message'); // b's chunk 3 sits at the wrong place in a different stream
});

test('a stream that stops early never produces a file', async () => {
  const key = await importKey(newSession().key);
  const msgs = await messages(key, photo(CHUNK_BYTES * 3));
  const receiver = new Receiver(key);
  let last;
  for (const m of msgs.slice(0, -1)) last = await receiver.push(m);
  assert.ok(!last.done);
});

test('too large, empty, or not an image: refused on both sides', async () => {
  const key = await importKey(newSession().key);
  await rejectsWith(async () => { for await (const _ of sealFile(key, new File([new Uint8Array(0)], 'x.jpg', { type: 'image/jpeg' }))) { /* drain */ } }, 'empty');
  const big = { size: MAX_FILE_BYTES + 1, name: 'big.jpg', type: 'image/jpeg', slice: () => new Blob([]) };
  await rejectsWith(async () => { for await (const _ of sealFile(key, big)) { /* drain */ } }, 'too-large');
  // a sender that lies about the size is caught by the receiver, even with the right key
  const forge = async (meta) => new Receiver(key).push((await (async () => {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('stw1|meta') }, key, enc.encode(JSON.stringify(meta))));
    const out = new Uint8Array(12 + body.length); out.set(iv); out.set(body, 12); return out.buffer;
  })()));
  await rejectsWith(() => forge({ v: 1, name: 'a.jpg', type: 'image/jpeg', size: MAX_FILE_BYTES + 1, chunks: Math.ceil((MAX_FILE_BYTES + 1) / CHUNK_BYTES) }), 'too-large');
  await rejectsWith(() => forge({ v: 1, name: 'a.exe', type: 'application/x-msdownload', size: 10, chunks: 1 }), 'bad-meta');
  await rejectsWith(() => forge({ v: 1, name: 'a.jpg', type: 'image/jpeg', size: 10, chunks: 5 }), 'bad-meta');
});

test('file names are cleaned before they are kept', () => {
  assert.equal(safeName('../../etc/passwd'), '.._.._etc_passwd');
  assert.equal(safeName('a<b>:c.jpg'), 'a_b__c.jpg');
  assert.equal(safeName(''), 'photo');
  assert.equal(safeName('x'.repeat(300)).length, 100);
});

// The two pages that talk to the network have their own CSP. It must allow exactly the configured pairing host,
// and the main page must stay strict (README 7).
const readText = async (relative) => {
  const url = new URL(relative, import.meta.url);
  if (inNode) return (await import('node:fs/promises')).readFile(url, 'utf8');
  return (await fetch(url)).text();
};
const cspOf = (html) => /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';

test('the pairing pages allow only the configured pairing host; the main page allows no other origin', async () => {
  const { PAIRING } = await import('../js/pair/config.js');
  const { host } = PAIRING.signalling;
  for (const page of ['../pair.html', '../send.html']) {
    const csp = cspOf(await readText(page));
    assert.ok(csp.includes(`connect-src 'self' https://${host} wss://${host}`), `${page}: ${csp}`);
    assert.ok(!/script-src[^;]*'unsafe-(inline|eval)'/.test(csp), `${page} must not allow inline or eval scripts`);
  }
  const main = cspOf(await readText('../index.html'));
  assert.ok(main.includes("connect-src 'self';"), 'the main page may only connect to itself');
  assert.ok(!main.includes(host), 'the main page must not mention the pairing host');
});
