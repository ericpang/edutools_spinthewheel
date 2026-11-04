// The only thing kept in the browser: the teacher's settings and whether the first-run notice was seen.
// No student data is ever written here (PS-1, README 7).
const SETTINGS_KEY = 'stw.settings.v1';
const NOTICE_KEY = 'stw.noticeSeen.v1';

const ALLOWED = {
  afterPick: ['keep', 'remove'],
  spinDuration: ['short', 'normal', 'long'],
  theme: ['system', 'light', 'dark'],
};

/** Only known keys with valid values get through, whatever is in storage. */
function sanitize(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, values] of Object.entries(ALLOWED)) if (values.includes(raw[key])) out[key] = raw[key];
  if (typeof raw.sound === 'boolean') out.sound = raw.sound;
  return out;
}

export function loadSettings() {
  try { return sanitize(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null')); } catch { return {}; }
}

export function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitize(settings))); } catch { /* storage blocked: settings just won't persist */ }
}

export function noticeSeen() {
  try { return localStorage.getItem(NOTICE_KEY) === '1'; } catch { return false; }
}

export function markNoticeSeen() {
  try { localStorage.setItem(NOTICE_KEY, '1'); } catch { /* ignore */ }
}

/** "Delete all data": everything this app ever stored. */
export function clearAll() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('stw.')) localStorage.removeItem(key);
  } catch { /* ignore */ }
}
