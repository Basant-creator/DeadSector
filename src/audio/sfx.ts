import Phaser from 'phaser';

/**
 * Original sound effects, synthesised at boot into Web Audio buffers: shaped noise for cracks,
 * thuds and rumbles, pitch-swept tones for bodies and voices. No audio files are loaded. Each
 * effect is a recipe of layers; `createSfx` renders them once and registers them as audio
 * assets, so the game plays them like any loaded sound.
 */
type Wave = 'sine' | 'square' | 'saw';

interface Layer {
  /** Noise or a tone sweeping from `from` to `to` Hz over the layer's decay. */
  readonly kind: 'noise' | Wave;
  readonly from?: number;
  readonly to?: number;
  /** Seconds for the envelope to fall to 1/e. */
  readonly decay: number;
  readonly attack?: number;
  readonly gain: number;
  /** One-pole filter on this layer: low-pass keeps the body, high-pass keeps the crack. */
  readonly lowpass?: number;
  readonly highpass?: number;
  /** Vibrato depth (fraction of pitch) and rate (Hz), for voices. */
  readonly vibrato?: [depth: number, rate: number];
  /** Volume wobble: depth (0-1) and rate (Hz), for wind and other slow movement. */
  readonly tremolo?: [depth: number, rate: number];
}

interface Recipe {
  readonly seconds: number;
  readonly layers: readonly Layer[];
  /** Saturation: higher is punchier and louder. */
  readonly drive: number;
  /** Rendered to loop seamlessly: the tail is crossfaded into the start. */
  readonly loop?: boolean;
}

/** Length of the crossfade that hides a looping sound's seam. */
const LOOP_FADE_SECONDS = 0.25;

export const SFX: Readonly<Record<string, Recipe>> = {
  'sfx-pistol': { seconds: 0.22, drive: 1.6, layers: [
    { kind: 'noise', decay: 0.022, gain: 0.9, highpass: 0.5 },
    { kind: 'sine', from: 190, to: 60, decay: 0.05, gain: 0.7 },
    { kind: 'noise', decay: 0.08, gain: 0.22, lowpass: 0.12 },
  ] },
  'sfx-shotgun': { seconds: 0.55, drive: 2.2, layers: [
    { kind: 'noise', decay: 0.015, gain: 0.6, highpass: 0.4 },
    { kind: 'noise', decay: 0.13, gain: 1, lowpass: 0.18 },
    { kind: 'sine', from: 95, to: 34, decay: 0.18, gain: 1 },
  ] },
  'sfx-rifle': { seconds: 0.16, drive: 1.5, layers: [
    { kind: 'noise', decay: 0.016, gain: 0.8, highpass: 0.45 },
    { kind: 'square', from: 230, to: 110, decay: 0.025, gain: 0.2, lowpass: 0.3 },
    { kind: 'sine', from: 150, to: 70, decay: 0.035, gain: 0.45 },
  ] },
  'sfx-impact': { seconds: 0.09, drive: 1.2, layers: [
    { kind: 'noise', decay: 0.01, gain: 0.5, highpass: 0.6 },
    { kind: 'sine', from: 2600, to: 1700, decay: 0.018, gain: 0.12 },
  ] },
  'sfx-hit': { seconds: 0.14, drive: 1.4, layers: [
    { kind: 'noise', decay: 0.035, gain: 0.85, lowpass: 0.15 },
    { kind: 'sine', from: 150, to: 75, decay: 0.05, gain: 0.55 },
  ] },
  'sfx-death': { seconds: 0.5, drive: 1.6, layers: [
    { kind: 'saw', from: 170, to: 65, decay: 0.2, attack: 0.02, gain: 0.32, lowpass: 0.12, vibrato: [0.06, 11] },
    { kind: 'noise', decay: 0.06, gain: 0.7, lowpass: 0.2 },
  ] },
  'sfx-hurt': { seconds: 0.28, drive: 1.5, layers: [
    { kind: 'square', from: 270, to: 165, decay: 0.09, attack: 0.008, gain: 0.32, lowpass: 0.25 },
    { kind: 'noise', decay: 0.04, gain: 0.35, lowpass: 0.3 },
  ] },
  'sfx-slam': { seconds: 1, drive: 2.4, layers: [
    { kind: 'sine', from: 72, to: 26, decay: 0.35, gain: 1 },
    { kind: 'noise', decay: 0.25, gain: 0.85, lowpass: 0.06 },
    { kind: 'noise', decay: 0.02, gain: 0.4, highpass: 0.3 },
  ] },
  'sfx-roar': { seconds: 0.8, drive: 2, layers: [
    { kind: 'saw', from: 78, to: 58, decay: 0.4, attack: 0.08, gain: 0.55, lowpass: 0.08, vibrato: [0.08, 17] },
    { kind: 'noise', decay: 0.35, attack: 0.08, gain: 0.3, lowpass: 0.05 },
  ] },
  'sfx-whoosh': { seconds: 0.5, drive: 1.1, layers: [
    { kind: 'noise', decay: 0.2, attack: 0.15, gain: 0.55, lowpass: 0.07 },
  ] },
  // Props that answer gunfire.
  'sfx-ping': { seconds: 0.35, drive: 1.2, layers: [
    { kind: 'noise', decay: 0.006, gain: 0.45, highpass: 0.6 },
    { kind: 'sine', from: 1900, to: 1650, decay: 0.12, gain: 0.35 },
    { kind: 'sine', from: 3100, to: 2900, decay: 0.07, gain: 0.16 },
  ] },
  'sfx-alarm': { seconds: 1.6, drive: 1.3, layers: [
    { kind: 'square', from: 820, to: 820, decay: 4, attack: 0.02, gain: 0.22, lowpass: 0.2, vibrato: [0.18, 5] },
  ] },
  // Ambience: quiet, slow, and never in the way of the fight.
  'amb-wind': { seconds: 8, drive: 1, loop: true, layers: [
    { kind: 'noise', decay: 1e6, gain: 0.9, lowpass: 0.012, tremolo: [0.55, 0.25] },
    { kind: 'noise', decay: 1e6, gain: 0.25, lowpass: 0.05, tremolo: [0.8, 0.375] },
  ] },
  'amb-siren': { seconds: 3.4, drive: 1, layers: [
    { kind: 'sine', from: 700, to: 700, decay: 1.6, attack: 0.7, gain: 0.5, lowpass: 0.06, vibrato: [0.22, 0.6] },
  ] },
  'amb-moan': { seconds: 2.2, drive: 1.2, layers: [
    { kind: 'saw', from: 105, to: 80, decay: 0.8, attack: 0.35, gain: 0.5, lowpass: 0.03, vibrato: [0.05, 3] },
  ] },
  'amb-clang': { seconds: 1.6, drive: 1, layers: [
    { kind: 'sine', from: 410, to: 405, decay: 0.5, gain: 0.4, lowpass: 0.15 },
    { kind: 'sine', from: 1130, to: 1120, decay: 0.3, gain: 0.2, lowpass: 0.15 },
    { kind: 'noise', decay: 0.01, gain: 0.2, lowpass: 0.1 },
  ] },
  'amb-crow': { seconds: 0.45, drive: 1.6, layers: [
    { kind: 'square', from: 950, to: 650, decay: 0.08, attack: 0.01, gain: 0.3, lowpass: 0.15 },
    { kind: 'noise', decay: 0.06, gain: 0.2, lowpass: 0.2 },
  ] },
  'sfx-crash': { seconds: 0.6, drive: 2, layers: [
    { kind: 'noise', decay: 0.15, gain: 0.9, lowpass: 0.1 },
    { kind: 'sine', from: 110, to: 38, decay: 0.12, gain: 0.8 },
    { kind: 'noise', decay: 0.2, gain: 0.25, highpass: 0.5 },
  ] },
};

/** Render every recipe into the audio cache. Without Web Audio the game simply stays silent. */
export function createSfx(scene: Phaser.Scene): void {
  const manager = scene.sound;
  if (!(manager instanceof Phaser.Sound.WebAudioSoundManager)) return;
  const ctx = manager.context;
  const rand = mulberry(9);
  for (const [key, recipe] of Object.entries(SFX)) {
    const length = Math.ceil(recipe.seconds * ctx.sampleRate);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    if (recipe.loop) {
      // Render past the end, then fade that tail into the start so the loop has no seam.
      const fade = Math.ceil(LOOP_FADE_SECONDS * ctx.sampleRate);
      const long = new Float32Array(length + fade);
      render(recipe, long, ctx.sampleRate, rand);
      for (let i = 0; i < fade; i++) long[i] = long[i] * (i / fade) + long[length + i] * (1 - i / fade);
      buffer.getChannelData(0).set(long.subarray(0, length));
    } else {
      render(recipe, buffer.getChannelData(0), ctx.sampleRate, rand);
    }
    scene.cache.audio.add(key, buffer);
  }
}

function render(recipe: Recipe, out: Float32Array, rate: number, rand: () => number): void {
  for (const layer of recipe.layers) {
    let phase = 0;
    let lp = 0;
    let hpIn = 0;
    let hpOut = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      const attack = layer.attack ? Math.min(1, t / layer.attack) : 1;
      const wobble = layer.tremolo ? 1 - layer.tremolo[0] * (0.5 + 0.5 * Math.sin(2 * Math.PI * layer.tremolo[1] * t)) : 1;
      const env = attack * Math.exp(-t / layer.decay) * wobble;
      if (env < 1e-4 && t > (layer.attack ?? 0)) break;
      let s: number;
      if (layer.kind === 'noise') {
        s = rand() * 2 - 1;
      } else {
        const sweep = Math.min(1, t / (layer.decay * 2));
        let freq = (layer.from ?? 440) + ((layer.to ?? 440) - (layer.from ?? 440)) * sweep;
        if (layer.vibrato) freq *= 1 + layer.vibrato[0] * Math.sin(2 * Math.PI * layer.vibrato[1] * t);
        phase = (phase + freq / rate) % 1;
        s = layer.kind === 'sine' ? Math.sin(2 * Math.PI * phase)
          : layer.kind === 'square' ? (phase < 0.5 ? 1 : -1)
          : phase * 2 - 1;
      }
      if (layer.lowpass !== undefined) { lp += (s - lp) * layer.lowpass; s = lp; }
      if (layer.highpass !== undefined) {
        hpOut = (1 - layer.highpass) * (hpOut + s - hpIn);
        hpIn = s;
        s = hpOut;
      }
      out[i] += s * env * layer.gain;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * recipe.drive) * 0.8;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shortest gap between two plays of the same effect, so a crowd never becomes a wall of noise. */
const MIN_GAP_MS: Readonly<Record<string, number>> = {
  'sfx-hit': 35, 'sfx-impact': 45, 'sfx-death': 40, 'sfx-crash': 80, 'sfx-ping': 60, 'sfx-alarm': 1500,
};
/** Above this many sounds at once, only weapons and the player's own hurt still play. */
const MAX_VOICES = 20;
const ALWAYS = new Set(['sfx-pistol', 'sfx-shotgun', 'sfx-rifle', 'sfx-hurt', 'sfx-slam']);

/** Plays the synthesised effects with per-sound rate limits and a voice cap. */
export class Sfx {
  private readonly scene: Phaser.Scene;
  private readonly lastPlayed = new Map<string, number>();
  // Kept here rather than read back from Phaser: before the first click unlocks audio, the
  // manager's volume and mute getters still report the old values.
  private currentVolume = 1;
  private isMuted = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  get volume(): number {
    return this.currentVolume;
  }

  get muted(): boolean {
    return this.isMuted;
  }

  /** Master volume (0-1) and mute, applied to the whole game. */
  configure(volume: number, muted: boolean): void {
    this.currentVolume = volume;
    this.isMuted = muted;
    this.scene.sound.volume = volume;
    this.scene.sound.mute = muted;
  }

  play(key: string, options: { volume?: number; detune?: number; rate?: number } = {}): boolean {
    const sound = this.scene.sound;
    if (!this.scene.cache.audio.exists(key) || this.isMuted) return false;
    const now = performance.now();
    if (now - (this.lastPlayed.get(key) ?? -Infinity) < (MIN_GAP_MS[key] ?? 0)) return false;
    if (!ALWAYS.has(key) && sound.getAllPlaying().length >= MAX_VOICES) return false;
    this.lastPlayed.set(key, now);
    return sound.play(key, {
      volume: options.volume ?? 1,
      // A little variation, so repeats never sound copy-pasted.
      detune: (options.detune ?? 0) + (Math.random() - 0.5) * 120,
      rate: options.rate ?? 1,
    });
  }
}
