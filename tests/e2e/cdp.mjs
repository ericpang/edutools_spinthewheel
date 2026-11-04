// A minimal Chrome DevTools Protocol driver. No dependencies: it needs Node 22 or newer (built-in WebSocket)
// and an installed Chrome or Edge. Used by run.mjs; not part of the app.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
];

/** The browser to use: the given path, or the first Chrome or Edge found in the usual places. */
export function findBrowser(explicit) {
  const exe = explicit ?? CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error('No Chrome or Edge found. Pass --browser <path to chrome or msedge>.');
  return exe;
}

export async function launchBrowser({ exe, port = 9222, headless = true, width = 1440, height = 900 }) {
  const dir = await mkdtemp(join(tmpdir(), 'stw-e2e-'));
  const proc = spawn(exe, [
    ...(headless ? ['--headless=new'] : []),
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', 'about:blank',
  ], { stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 150 && !up; i++) {
    try { up = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { await sleep(100); }
  }
  if (!up) { proc.kill(); throw new Error(`The browser did not start on debugging port ${port}.`); }
  return {
    port,
    async close() { try { proc.kill(); } catch { /* already gone */ } await sleep(300); await rm(dir, { recursive: true, force: true }).catch(() => {}); },
  };
}

export async function openPage(port, url = 'about:blank') {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const page = new Page(ws, target.id, port);
  for (const domain of ['Page', 'Runtime', 'Log', 'Network', 'DOM']) await page.send(`${domain}.enable`);
  return page;
}

export class Page {
  constructor(ws, id, port) {
    this.ws = ws; this.targetId = id; this.port = port; this.seq = 0; this.pending = new Map();
    this.console = []; this.requests = []; this.failed = [];
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (p) { this.pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
      } else this.#event(msg);
    };
  }

  send(method, params = {}) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  #event({ method, params }) {
    const show = (a) => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : a.description ?? a.type);
    if (method === 'Runtime.consoleAPICalled') this.console.push(`[${params.type}] ${params.args.map(show).join(' ')}`);
    else if (method === 'Runtime.exceptionThrown') this.console.push(`[exception] ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`);
    else if (method === 'Log.entryAdded') this.console.push(`[log:${params.entry.level}] ${params.entry.text}`);
    else if (method === 'Network.requestWillBeSent') this.requests.push(params.request.url);
    else if (method === 'Network.loadingFailed') this.failed.push(`${params.errorText}${params.blockedReason ? ` (${params.blockedReason})` : ''}`);
    else if (method === 'Page.javascriptDialogOpening') this.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); // confirm() -> OK
  }

  async eval(expression, { awaitPromise = true } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  async waitFor(expression, { timeout = 30000, interval = 100, label } = {}) {
    const t0 = Date.now();
    for (;;) {
      const value = await this.eval(expression).catch(() => false);
      if (value) return value;
      if (Date.now() - t0 > timeout) throw new Error(`timed out after ${timeout} ms waiting for: ${label ?? expression}`);
      await sleep(interval);
    }
  }

  async goto(url) { await this.send('Page.navigate', { url }); await sleep(150); await this.waitFor('document.readyState === "complete"'); }
  async screenshot(path) { await writeFile(path, Buffer.from((await this.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); }
  async mouse(type, x, y, extra = {}) { await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, ...extra }); }
  async click(x, y) { await this.mouse('mouseMoved', x, y); await this.mouse('mousePressed', x, y); await this.mouse('mouseReleased', x, y); }

  async drag(x1, y1, x2, y2, steps = 8) {
    await this.mouse('mouseMoved', x1, y1);
    await this.mouse('mousePressed', x1, y1);
    for (let i = 1; i <= steps; i++) await this.mouse('mouseMoved', x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps, { buttons: 1 });
    await this.mouse('mouseReleased', x2, y2);
  }

  /** A real key press. It needs a virtual key code, or the browser's own handling (Esc closing a dialog, Space on a button) does not run. */
  async key(key, extra = {}) {
    const vk = { Escape: 27, Enter: 13, ' ': 32, Tab: 9, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[key] ?? key.toUpperCase().charCodeAt(0);
    const text = key.length === 1 ? key : key === 'Enter' ? '\r' : undefined;
    const base = { key, code: key === ' ' ? 'Space' : key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...extra };
    await this.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text } : {}) });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  async setFiles(selector, files) {
    const { root } = await this.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await this.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`no element for ${selector}`);
    await this.send('DOM.setFileInputFiles', { files, nodeId });
  }

  viewport(width, height, deviceScaleFactor = 1, mobile = false) { return this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile }); }
  emulateMedia(features) { return this.send('Emulation.setEmulatedMedia', { features }); }

  async rect(selector) {
    return this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
  }

  close() { try { this.ws.close(); } catch { /* closed */ } fetch(`http://127.0.0.1:${this.port}/json/close/${this.targetId}`).catch(() => {}); }
}
