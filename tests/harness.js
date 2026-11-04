// A tiny test harness that works in the browser (tests/index.html) and under `node --test tests/`.
export const inNode = typeof process !== 'undefined' && !!process.versions?.node;
const nodeTest = inNode ? (await import('node:test')).test : null;

const queue = [];

/** Register a test. Under Node it is handed to node:test; in the browser it runs when runAll() is called. */
export function test(name, fn) {
  if (nodeTest) nodeTest(name, fn);
  else queue.push({ name, fn });
}

function fail(message, detail) {
  throw new Error(detail === undefined ? message : `${message}\n    ${detail}`);
}

export const assert = {
  ok(value, message = 'expected a truthy value') { if (!value) fail(message); },
  equal(actual, expected, message = 'values differ') {
    if (!Object.is(actual, expected)) fail(message, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  },
  deepEqual(actual, expected, message = 'values differ') {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) fail(message, `expected ${b}, got ${a}`);
  },
  close(actual, expected, epsilon = 1e-9, message = 'numbers differ') {
    if (!(Math.abs(actual - expected) <= epsilon)) fail(message, `expected ${expected} +/- ${epsilon}, got ${actual}`);
  },
  throws(fn, message = 'expected the function to throw') {
    try { fn(); } catch { return; }
    fail(message);
  },
};

/** Browser runner: runs everything that was registered and renders a report into `outputEl`. */
export async function runAll(outputEl) {
  const failures = [];
  let passed = 0;
  const lines = [];
  for (const { name, fn } of queue) {
    try { await fn(); passed++; lines.push(`PASS  ${name}`); }
    catch (err) { failures.push({ name, message: String(err?.message ?? err) }); lines.push(`FAIL  ${name}\n      ${String(err?.message ?? err)}`); }
  }
  const summary = `${passed} passed, ${failures.length} failed, ${queue.length} total`;
  outputEl.textContent = `${summary}\n\n${lines.join('\n')}`;
  document.title = `${failures.length ? 'FAIL' : 'PASS'} - ${summary}`;
  globalThis.__testResults = { passed, failed: failures.length, total: queue.length, failures };
  return globalThis.__testResults;
}
