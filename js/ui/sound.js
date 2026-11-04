// Cute synthesised sounds (WH-13): a "ba-doop" when the spin starts, a music-box ripple as the wheel passes each
// segment, and a little jingle at the result. Everything is made with Web Audio, so there are no audio files to
// download and nothing leaves the device. The notes come from a pentatonic scale, so any run of them sounds nice.
let audio = null;
let master = null;

function context() {
  if (!audio) {
    const AudioCtx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioCtx) return null;
    audio = new AudioCtx();
    const compressor = audio.createDynamicsCompressor(); // keeps a burst of notes from clipping
    master = audio.createGain();
    master.gain.value = 0.9;
    master.connect(compressor);
    compressor.connect(audio.destination);
  }
  if (audio.state === 'suspended') audio.resume().catch(() => { /* needs a user gesture; prime() is called from clicks */ });
  return audio;
}

/**
 * One soft music-box note: a sine plus a quiet octave above it, a quick attack and a bell-like decay.
 * `pop` starts the note a little sharp and slides down, which sounds like a tiny bubble.
 */
function note(ctx, freq, { at = 0, gain = 0.06, decay = 0.2, pop = 0, shimmer = 0.3 } = {}) {
  const t0 = ctx.currentTime + at;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
  amp.connect(master);
  for (const [multiple, level] of [[1, 1], [2, shimmer]]) {
    if (level <= 0) continue;
    const osc = ctx.createOscillator();
    const part = ctx.createGain();
    part.gain.value = level;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * multiple * (1 + pop), t0);
    if (pop) osc.frequency.exponentialRampToValueAtTime(freq * multiple, t0 + 0.035);
    osc.connect(part);
    part.connect(amp);
    osc.start(t0);
    osc.stop(t0 + decay + 0.05);
  }
}

// C major pentatonic, C5 up to E6: every note sounds good next to every other, so a random walk stays cute.
const SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51];
let position = 3;
let direction = 1;
let lastTickAt = 0;

function nextTickNote() {
  position += direction * (Math.random() < 0.3 ? 2 : 1);
  if (position >= SCALE.length - 1) { position = SCALE.length - 1; direction = -1; }
  else if (position <= 0) { position = 0; direction = 1; }
  else if (Math.random() < 0.15) direction = -direction;
  return SCALE[position];
}

export const sound = {
  enabled: true,
  /** How many of each sound was played; handy in tests. */
  stats: { start: 0, tick: 0, reveal: 0 },

  /** Call from a click or key press so the browser allows audio. */
  prime() { if (this.enabled) context(); },

  /** "Ba-doop": two quick rising notes as the wheel starts to turn. */
  start() {
    if (!this.enabled) return;
    const ctx = context();
    if (!ctx) return;
    lastTickAt = performance.now();
    note(ctx, 783.99, { gain: 0.06, decay: 0.16, pop: 0.05 });
    note(ctx, 1046.5, { at: 0.08, gain: 0.06, decay: 0.24 });
    this.stats.start++;
  },

  /** One note as the pointer passes a segment edge. A fast wheel gives a soft, quick ripple; a slowing wheel, clear notes. */
  tick() {
    if (!this.enabled) return;
    const now = performance.now();
    const gap = now - lastTickAt;
    if (gap < 55) return; // very fast: skip some, so it stays a ripple rather than a buzz
    const ctx = context();
    if (!ctx) return;
    lastTickAt = now;
    const slow = Math.min(1, gap / 260); // 0 when fast, 1 when the wheel is almost stopped
    note(ctx, nextTickNote(), { gain: 0.03 + 0.05 * slow, decay: 0.12 + 0.2 * slow, pop: 0.06 });
    this.stats.tick++;
  },

  /** A little "ta-da": a rising arpeggio, a soft low C underneath and a sparkle on top. */
  reveal() {
    if (!this.enabled) return;
    const ctx = context();
    if (!ctx) return;
    [1046.5, 1318.51, 1567.98, 2093.0].forEach((freq, i) => note(ctx, freq, { at: i * 0.09, gain: 0.075, decay: 0.5 }));
    note(ctx, 523.25, { gain: 0.06, decay: 0.7, shimmer: 0.15 });
    note(ctx, 2637.02, { at: 0.4, gain: 0.03, decay: 0.55, shimmer: 0 });
    this.stats.reveal++;
  },

  /** Two quick notes to confirm that sound was just turned on. */
  preview() {
    if (!this.enabled) return;
    const ctx = context();
    if (!ctx) return;
    note(ctx, 1046.5, { gain: 0.06, decay: 0.25, pop: 0.04 });
    note(ctx, 1318.51, { at: 0.09, gain: 0.06, decay: 0.3 });
  },
};
