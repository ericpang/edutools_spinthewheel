// A tiny static file server for the e2e tests (and handy for trying the app: node tests/e2e/serve.mjs 8080).
// It sets the right type for .wasm and .mjs, and can serve one extra folder under a URL prefix.
import { createReadStream, statSync } from 'node:fs';
import http from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8',
};

/** @returns {Promise<{url: string, close: () => void}>} */
export function startServer({ root, port = 0, extraPrefix, extraRoot }) {
  const server = http.createServer((req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    let base = root;
    let rel = path;
    if (extraPrefix && path.startsWith(extraPrefix)) { base = extraRoot; rel = path.slice(extraPrefix.length); }
    let file = normalize(join(base, rel));
    let ok = file.startsWith(normalize(base)); // no walking out of the folder
    try { if (ok && statSync(file).isDirectory()) file = join(file, 'index.html'); ok = ok && statSync(file).isFile(); } catch { ok = false; }
    if (!ok) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': statSync(file).size });
    if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
  });
  return new Promise((resolveStart) => {
    server.listen(port, '127.0.0.1', () => resolveStart({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() }));
  });
}

// run directly: node tests/e2e/serve.mjs [port]  serves the project folder
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { url } = await startServer({ root, port: Number(process.argv[2] ?? 8080) });
  console.log(`Serving ${root} at ${url}`);
}
