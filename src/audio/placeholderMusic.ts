import { MUSIC, type StemId } from './music';

/**
 * PLACEHOLDER MUSIC. Simple stems synthesised at boot so the adaptive music system can be heard
 * and tested before the real soundtrack exists. Original, but not a finished score: replace them
 * by adding the files listed in src/assets/audio/README.md, which are used automatically.
 *
 * Four bars of A minor at MUSIC.bpm (Am, F, Dm, E), one mono buffer per stem, all the same length
 * so they loop together. Notes that ring past the end wrap round to the start, so every loop is
 * seamless.
 */
const RATE = 22050;
const BEAT = 60 / MUSIC.bpm;
const BARS = MUSIC.loopBars;
const LENGTH = Math.round(BARS * MUSIC.beatsPerBar * BEAT * RATE);

type Wave = 'sine' | 'saw' | 'square';

interface Tone {
  wave: Wave;
  /** Hz at the start, and where it slides to over `slide` seconds. */
  from: number;
  to?: number;
  slide?: number;
  gain: number;
  attack?: number;
  /** Seconds to fall to 1/e; held notes use a long decay and a `length`. */
  decay: number;
  /** Seconds the note sounds for before it is cut (with a short release). */
  length: number;
  /** One-pole low-pass coefficient (0-1); lower is darker. */
  lowpass?: number;
  /** Saturation before the gain: higher is grittier. */
  drive?: number;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Add a tone starting *beat* beats into the loop. */
function tone(out: Float32Array, beat: number, t: Tone): void {
  const start = Math.round(beat * BEAT * RATE);
  const n = Math.round((t.length + 0.05) * RATE);
  let phase = 0;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const s = i / RATE;
    const slide = t.slide ? Math.min(1, s / t.slide) : 1;
    const freq = t.to === undefined ? t.from : t.from + (t.to - t.from) * slide;
    phase = (phase + freq / RATE) % 1;
    let v = t.wave === 'sine' ? Math.sin(2 * Math.PI * phase) : t.wave === 'saw' ? phase * 2 - 1 : phase < 0.5 ? 1 : -1;
    if (t.lowpass !== undefined) { lp += (v - lp) * t.lowpass; v = lp; }
    if (t.drive) v = Math.tanh(v * t.drive);
    const attack = t.attack ? Math.min(1, s / t.attack) : 1;
    const release = s > t.length ? Math.max(0, 1 - (s - t.length) / 0.05) : 1;
    out[(start + i) % LENGTH] += v * t.gain * attack * release * Math.exp(-s / t.decay);
  }
}

/** Add a burst of filtered noise. */
function noise(out: Float32Array, beat: number, rand: () => number, gain: number, decay: number, highpass = 0, lowpass = 1): void {
  const start = Math.round(beat * BEAT * RATE);
  const n = Math.round(decay * 6 * RATE);
  let lp = 0;
  let hpIn = 0;
  let hpOut = 0;
  for (let i = 0; i < n; i++) {
    let v = rand() * 2 - 1;
    lp += (v - lp) * lowpass;
    v = lp;
    if (highpass > 0) { hpOut = (1 - highpass) * (hpOut + v - hpIn); hpIn = v; v = hpOut; }
    out[(start + i) % LENGTH] += v * gain * Math.exp(-i / RATE / decay);
  }
}

/** Chords per bar, low to high, and the bass root under each. */
const CHORDS = [
  { root: 55, notes: [110, 130.81, 164.81], arp: [440, 523.25, 659.25, 880] }, // A minor
  { root: 43.65, notes: [87.31, 110, 130.81], arp: [349.23, 440, 523.25, 698.46] }, // F
  { root: 73.42, notes: [73.42, 87.31, 110], arp: [293.66, 349.23, 440, 587.33] }, // D minor
  { root: 41.2, notes: [82.41, 103.83, 123.47], arp: [329.63, 415.3, 493.88, 659.25] }, // E
];

const STEM_BUILDERS: Record<StemId, (out: Float32Array, rand: () => number) => void> = {
  // A dark bed: detuned saws, slow to open, under a sub.
  pad(out) {
    CHORDS.forEach((chord, bar) => {
      for (const f of chord.notes) {
        for (const d of [0.994, 1.006]) {
          tone(out, bar * 4, { wave: 'saw', from: f * d, gain: 0.16, attack: 0.6, decay: 30, length: 2.3, lowpass: 0.035 });
        }
      }
      tone(out, bar * 4, { wave: 'sine', from: chord.root, gain: 0.25, attack: 0.4, decay: 30, length: 2.2 });
    });
  },
  // Four on the floor, a snare on 2 and 4, hats, and a clank of metal at the end of every other bar.
  drums(out, rand) {
    for (let b = 0; b < BARS * 4; b++) {
      tone(out, b, { wave: 'sine', from: 150, to: 45, slide: 0.08, gain: 1, decay: 0.22, length: 0.45, drive: 1.6 });
      noise(out, b, rand, 0.35, 0.004, 0.6);
      noise(out, b + 0.5, rand, 0.28, 0.03, 0.75);
      for (const g of [0.25, 0.75]) noise(out, b + g, rand, 0.1, 0.02, 0.8);
      if (b % 4 === 1 || b % 4 === 3) {
        noise(out, b, rand, 0.7, 0.13, 0.25, 0.6);
        tone(out, b, { wave: 'sine', from: 200, to: 160, slide: 0.05, gain: 0.3, decay: 0.07, length: 0.2 });
      }
    }
    for (const bar of [1, 3]) {
      for (const [f, g] of [[410, 0.18], [1130, 0.09]]) tone(out, bar * 4 + 3.75, { wave: 'sine', from: f, gain: g, decay: 0.25, length: 0.6 });
    }
  },
  // A driven saw pulsing in sixteenths on the root, jumping the octave now and then.
  bass(out) {
    const pattern = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 2, 1];
    CHORDS.forEach((chord, bar) => {
      pattern.forEach((p, step) => {
        if (!p) return;
        const f = chord.root * (p === 2 ? 2 : 1);
        tone(out, bar * 4 + step / 4, { wave: 'saw', from: f, gain: 0.5, attack: 0.003, decay: 0.12, length: 0.11, lowpass: 0.14, drive: 3 });
      });
    });
  },
  // A square-wave arpeggio over the chords, with an echo three sixteenths behind.
  lead(out) {
    const order = [0, 1, 2, 3, 2, 1, 0, 2, 3, 2, 1, 2, 0, 1, 3, 1];
    CHORDS.forEach((chord, bar) => {
      order.forEach((k, step) => {
        const beat = bar * 4 + step / 4;
        const note: Tone = { wave: 'square', from: chord.arp[k], gain: 0.16, attack: 0.004, decay: 0.09, length: 0.12, lowpass: 0.22 };
        tone(out, beat, note);
        tone(out, beat + 0.75, { ...note, gain: note.gain * 0.35 });
      });
    });
  },
  // The Giant: distorted brass stabs on the root and fifth, and war drums.
  giant(out, rand) {
    CHORDS.forEach((chord, bar) => {
      for (const at of [0, 2.5]) {
        for (const f of [chord.root * 2, chord.root * 3]) {
          for (const d of [0.99, 1.01]) {
            tone(out, bar * 4 + at, { wave: 'saw', from: f * d, gain: 0.22, attack: 0.02, decay: 0.45, length: 0.9, lowpass: 0.07, drive: 4 });
          }
        }
      }
      for (const at of [0, 1.5, 2, 3, 3.5]) {
        tone(out, bar * 4 + at, { wave: 'sine', from: 120, to: 58, slide: 0.15, gain: 0.8, decay: 0.25, length: 0.5 });
        noise(out, bar * 4 + at, rand, 0.2, 0.05, 0, 0.3);
      }
    });
  },
  // Lights out: a heartbeat over a beating low drone and the odd crackle.
  blackout(out, rand) {
    // 55 Hz and 55.375 Hz both finish whole cycles in the 8 s loop, so the drone loops cleanly.
    for (const f of [55, 55.375]) tone(out, 0, { wave: 'sine', from: f, gain: 0.14, decay: 1e6, length: LENGTH / RATE - 0.06 });
    for (let b = 0; b < BARS * 4; b += 2) {
      for (const [at, g] of [[0, 0.9], [0.35, 0.6]]) tone(out, b + at, { wave: 'sine', from: 62, to: 40, slide: 0.1, gain: g, decay: 0.12, length: 0.3 });
    }
    for (let i = 0; i < 24; i++) noise(out, rand() * BARS * 4, rand, 0.05, 0.01, 0.7);
  },
};

/** Peak each stem is scaled to, so the mix table alone sets the balance. */
const PEAK = 0.7;

/** Render every placeholder stem: sample rate, length, and one buffer per stem. */
export function renderPlaceholderStems(): { rate: number; stems: Record<StemId, Float32Array> } {
  const stems = {} as Record<StemId, Float32Array>;
  let seed = 41;
  for (const [id, build] of Object.entries(STEM_BUILDERS) as [StemId, (o: Float32Array, r: () => number) => void][]) {
    const out = new Float32Array(LENGTH);
    build(out, rng(seed++));
    let peak = 0;
    for (let i = 0; i < LENGTH; i++) peak = Math.max(peak, Math.abs(out[i]));
    if (peak > 0) for (let i = 0; i < LENGTH; i++) out[i] = (out[i] / peak) * PEAK;
    stems[id] = out;
  }
  return { rate: RATE, stems };
}
