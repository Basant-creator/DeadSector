import Phaser from 'phaser';
import type { EnemyKind } from '../entities/enemies';

/**
 * Adaptive music: one loop split into stems that always play together, in sync, and a mix per
 * state that says how loud each stem is. Changing state never changes track: the stems fade to
 * the new mix, and only on a bar line, so the music breathes with the fight instead of cutting.
 *
 * The stems come from audio files when a complete set is present (src/assets/audio/README.md),
 * otherwise from placeholder stems synthesised at boot (src/audio/placeholderMusic.ts).
 */
export type MusicState = 'calm' | 'combat' | 'intense' | 'giant' | 'blackout';

export const STEMS = ['pad', 'drums', 'bass', 'lead', 'giant', 'blackout'] as const;
export type StemId = (typeof STEMS)[number];

export const stemKey = (stem: StemId) => `music-${stem}`;

export const MUSIC = {
  /** Every stem shares this tempo and length, so they line up sample for sample. */
  bpm: 120,
  beatsPerBar: 4,
  loopBars: 4,
  /** How loud each stem is in each state, 0 to 1. */
  mix: {
    calm: { pad: 1, drums: 0, bass: 0, lead: 0, giant: 0, blackout: 0 },
    combat: { pad: 0.6, drums: 1, bass: 1, lead: 0, giant: 0, blackout: 0 },
    intense: { pad: 0.4, drums: 1, bass: 1, lead: 0.9, giant: 0, blackout: 0 },
    giant: { pad: 0, drums: 1, bass: 1, lead: 0.45, giant: 1, blackout: 0 },
    blackout: { pad: 0, drums: 0, bass: 0, lead: 0, giant: 0, blackout: 1 },
  } satisfies Record<MusicState, Record<StemId, number>>,
  /** Time for a stem to fade fully in or out. */
  fadeMs: 1800,
  /**
   * Bars a new state must stay wanted before the music follows. Rising waits a bar so a single
   * spawn does not kick the drums in; falling waits four (8 s) so a lull mid-wave does not drop
   * them. The Giant, blackouts and the run ending are events, not moods: they take the next bar
   * line.
   */
  holdBars: { up: 1, down: 4, event: 0 },
  /** How much each living enemy adds to the threat. */
  threatWeight: { walker: 1, runner: 1.5, brute: 2.5, elite: 2.5, giant: 0 } satisfies Record<EnemyKind, number>,
  /** Threat at which the music turns intense; any threat at all means combat. */
  intenseAt: 7,
  /** A hit on the player (or the mech) adds this much threat for a while. */
  hurtThreat: 3,
  hurtThreatMs: 6000,
};

/** Order of the moods, for telling rising from falling. Blackout stands apart. */
const LEVEL: Record<MusicState, number> = { calm: 0, combat: 1, intense: 2, giant: 3, blackout: 4 };

/** What the fight looks like this frame, as far as the music cares. */
export interface MusicSignals {
  /** Weighted sum of the living enemies (MUSIC.threatWeight), plus any recent-hurt bonus. */
  threat: number;
  /** A wave is under way (spawning or being fought). */
  waveActive: boolean;
  /** A Giant is announced or alive. */
  giant: boolean;
  blackout: boolean;
  runOver: boolean;
}

/** The state the fight calls for right now, before any holding back. */
export function desiredState(s: MusicSignals): MusicState {
  if (s.blackout) return 'blackout';
  if (s.runOver) return 'calm';
  if (s.giant) return 'giant';
  if (s.threat >= MUSIC.intenseAt) return 'intense';
  if (s.threat > 0 || s.waveActive) return 'combat';
  return 'calm';
}

/**
 * Decides the music state, one bar line at a time. Pure logic: it is told the bar number and the
 * signals, and answers with the state, so it can be tested without sound.
 */
export class MusicDirector {
  private current: MusicState = 'calm';
  private candidate: MusicState | null = null;
  private candidateSince = 0;
  private lastBar = -1;

  get state(): MusicState {
    return this.current;
  }

  /** Feed this frame's bar number and signals. Returns the new state on the bar it changes, else null. */
  update(bar: number, signals: MusicSignals): MusicState | null {
    if (bar === this.lastBar) return null;
    this.lastBar = bar;
    const want = desiredState(signals);
    if (want === this.current) {
      this.candidate = null;
      return null;
    }
    if (want !== this.candidate) {
      this.candidate = want;
      this.candidateSince = bar;
    }
    if (bar - this.candidateSince < this.holdFor(want, signals)) return null;
    this.current = want;
    this.candidate = null;
    return want;
  }

  private holdFor(want: MusicState, signals: MusicSignals): number {
    const { up, down, event } = MUSIC.holdBars;
    // The run ending is an event too: the music settles at once, not after a lull.
    if (want === 'blackout' || want === 'giant' || this.current === 'blackout' || signals.runOver) return event;
    return LEVEL[want] > LEVEL[this.current] ? up : down;
  }
}

export const barSeconds = () => (60 / MUSIC.bpm) * MUSIC.beatsPerBar;

/**
 * The stems as sounds: started together so they stay in sync, each faded toward the mix of the
 * current state. Fades run on real time in `update`, with no tweens, so a scene shutdown
 * (`destroy`) leaves nothing behind.
 */
export class MusicPlayer {
  private readonly scene: Phaser.Scene;
  private readonly stems: { id: StemId; sound: Phaser.Sound.BaseSound; gain: number; target: number }[] = [];
  private startedAt: number | null = null;
  private bus = 1;
  private lastTick = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    for (const id of STEMS) {
      if (!scene.cache.audio.exists(stemKey(id))) continue;
      this.stems.push({ id, sound: scene.sound.add(stemKey(id), { loop: true, volume: 0 }), gain: 0, target: 0 });
    }
  }

  /** Whether every stem is loaded: music only plays as a complete, synchronised set. */
  get complete(): boolean {
    return this.stems.length === STEMS.length;
  }

  get playing(): boolean {
    return this.startedAt !== null;
  }

  /** Current gain of each stem, before the music volume. */
  gains(): Record<StemId, number> {
    return Object.fromEntries(this.stems.map((s) => [s.id, s.gain])) as Record<StemId, number>;
  }

  /** Start every stem in the same instant. Does nothing if the set is incomplete or already playing. */
  start(): void {
    if (!this.complete || this.startedAt !== null) return;
    for (const stem of this.stems) {
      try {
        stem.sound.play({ loop: true, volume: 0 });
      } catch {
        // A stem that will not play stays silent; the others carry on.
      }
    }
    this.startedAt = this.clock();
    this.lastTick = performance.now();
    // play() reset every volume: put the current gains back.
    for (const stem of this.stems) this.apply(stem);
  }

  /** Bars since the music started; -1 before it has. */
  bar(): number {
    if (this.startedAt === null) return -1;
    return Math.floor((this.clock() - this.startedAt) / barSeconds());
  }

  setState(state: MusicState): void {
    for (const stem of this.stems) stem.target = MUSIC.mix[state][stem.id];
  }

  setBusVolume(volume: number): void {
    this.bus = volume;
    for (const stem of this.stems) this.apply(stem);
  }

  /** Move every stem's gain toward its target. Nothing moves until the music has started. */
  update(): void {
    if (this.startedAt === null) return;
    const now = performance.now();
    const step = Math.min(250, now - this.lastTick) / MUSIC.fadeMs;
    this.lastTick = now;
    for (const stem of this.stems) {
      if (stem.gain === stem.target) continue;
      stem.gain = stem.gain < stem.target ? Math.min(stem.target, stem.gain + step) : Math.max(stem.target, stem.gain - step);
      this.apply(stem);
    }
  }

  destroy(): void {
    for (const stem of this.stems) stem.sound.destroy();
    this.stems.length = 0;
    this.startedAt = null;
  }

  private apply(stem: { sound: Phaser.Sound.BaseSound; gain: number }): void {
    // Equal-power curve: a fade in sounds even rather than arriving all at the end.
    const volume = Math.sin((stem.gain * Math.PI) / 2) * this.bus;
    (stem.sound as Phaser.Sound.WebAudioSound).setVolume?.(volume);
  }

  /** The audio clock where there is one (sample-accurate, unaffected by frame hitches), else wall time. */
  private clock(): number {
    const manager = this.scene.sound;
    return manager instanceof Phaser.Sound.WebAudioSoundManager ? manager.context.currentTime : performance.now() / 1000;
  }
}
