import Phaser from 'phaser';
import { WEAPON_FEEL } from '../combat/feel';
import type { EnemyKind } from '../entities/enemies';
import type { GameEvents } from '../events/GameEvents';
import type { MusicSource } from './assets';
import { MUSIC, MusicDirector, MusicPlayer, type MusicSignals, type MusicState, type StemId } from './music';

/** The three volumes and mute, as saved in the profile. `volume` is the master. */
export interface AudioSettings {
  volume: number;
  music: number;
  sfx: number;
  muted: boolean;
}

/** Shortest gap between two plays of the same effect, so a crowd never becomes a wall of noise. */
const MIN_GAP_MS: Readonly<Record<string, number>> = {
  'sfx-hit': 35, 'sfx-impact': 45, 'sfx-death': 40, 'sfx-crash': 80, 'sfx-ping': 60, 'sfx-alarm': 1500, 'sfx-clank': 60,
  'sfx-deny': 150, 'sfx-switch': 60,
};
/**
 * Above this many effects at once, only weapons and the player's (or the mech's) own hurt still
 * play. Loops (music stems, the wind) do not count: they are always there.
 */
const MAX_VOICES = 20;
const ALWAYS = new Set(['sfx-pistol', 'sfx-shotgun', 'sfx-rifle', 'sfx-hurt', 'sfx-slam', 'sfx-cannon', 'sfx-clank', 'sfx-stomp']);
/** Death sounds pitched by size: small bodies higher, big ones lower, in cents. */
const DEATH_DETUNE: Readonly<Record<EnemyKind, number>> = { walker: 0, runner: 350, brute: -450, elite: -150, giant: -1000 };
/** Gun loudness against each other: the rifle fires ten times a second, the mech's cannon is loud enough. */
const GUN_VOLUME: Readonly<Record<string, number>> = { rifle: 0.7, mech: 0.85 };

type PlayOptions = { volume?: number; detune?: number; rate?: number };

/**
 * Every sound in the game goes through here. Gameplay never plays a sound: it announces what
 * happened on the run's `GameEvents`, and this answers with the cue for it, so each event is
 * heard once however many listeners it has.
 *
 * Three volumes multiply: master (the sound manager's own volume), then music or effects per
 * sound. Effects are rate-limited per key and capped in number; looping beds (wind) and the music
 * stems follow their volume as it changes. The music waits for the browser to unlock audio (the
 * first click or key), and everything this made is stopped when its scene shuts down, so a
 * restart never stacks a second bed or soundtrack.
 */
export class AudioManager {
  private readonly scene: Phaser.Scene;
  private readonly events: GameEvents;
  private readonly lastPlayed = new Map<string, number>();
  private readonly loops: { sound: Phaser.Sound.BaseSound; volume: number }[] = [];
  private readonly music: MusicPlayer;
  private readonly director = new MusicDirector();
  private settings: AudioSettings;
  private blackout = false;
  private hurtUntil = 0;
  private destroyed = false;

  constructor(scene: Phaser.Scene, events: GameEvents, settings: AudioSettings) {
    this.scene = scene;
    this.events = events;
    this.settings = { ...settings };
    this.music = new MusicPlayer(scene);
    this.music.setState(this.director.state);
    this.configure(settings);
    this.listen();
    if (scene.sound.locked) scene.sound.once(Phaser.Sound.Events.UNLOCKED, this.startMusic, this);
    else this.startMusic();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  /** Master volume, 0 to 1. */
  get volume(): number {
    return this.settings.volume;
  }

  get musicVolume(): number {
    return this.settings.music;
  }

  get sfxVolume(): number {
    return this.settings.sfx;
  }

  get muted(): boolean {
    return this.settings.muted;
  }

  get musicState(): MusicState {
    return this.director.state;
  }

  get musicPlaying(): boolean {
    return this.music.playing;
  }

  /** Where the stems came from (set at boot by src/audio/assets.ts). */
  get musicSource(): MusicSource {
    return (this.scene.registry.get('musicSource') as MusicSource | undefined) ?? 'none';
  }

  musicGains(): Record<StemId, number> {
    return this.music.gains();
  }

  /** Apply volumes and mute. Kept here rather than read back from Phaser: before the first click
   * unlocks audio, the manager's volume and mute getters still report the old values. */
  configure(settings: AudioSettings): void {
    this.settings = { ...settings };
    const sound = this.scene.sound;
    sound.volume = settings.volume;
    sound.mute = settings.muted;
    this.music.setBusVolume(settings.music);
    for (const loop of this.loops) (loop.sound as Phaser.Sound.WebAudioSound).setVolume?.(loop.volume * settings.sfx);
  }

  /**
   * Play effect *key* at *volume* (times the effects volume). Returns whether it played: not when
   * muted, missing, too soon after the last one, or over the voice cap. Never throws.
   */
  play(key: string, options: PlayOptions = {}): boolean {
    if (this.destroyed || this.settings.muted || !this.scene.cache.audio.exists(key)) return false;
    const now = performance.now();
    if (now - (this.lastPlayed.get(key) ?? -Infinity) < (MIN_GAP_MS[key] ?? 0)) return false;
    const sound = this.scene.sound;
    if (!ALWAYS.has(key) && sound.getAllPlaying().filter((s) => !(s as Phaser.Sound.WebAudioSound).loop).length >= MAX_VOICES) return false;
    this.lastPlayed.set(key, now);
    try {
      return sound.play(key, {
        volume: (options.volume ?? 1) * this.settings.sfx,
        // A little variation, so repeats never sound copy-pasted.
        detune: (options.detune ?? 0) + (Math.random() - 0.5) * 120,
        rate: options.rate ?? 1,
      });
    } catch {
      return false;
    }
  }

  /** Start a looping effect bed (wind) at *volume*; it follows the effects volume and stops with the scene. */
  loop(key: string, volume: number): Phaser.Sound.BaseSound | null {
    if (this.destroyed || !this.scene.cache.audio.exists(key)) return null;
    const sound = this.scene.sound.add(key, { loop: true, volume: volume * this.settings.sfx });
    this.loops.push({ sound, volume });
    try {
      sound.play();
    } catch {
      // Silent bed; nothing depends on it.
    }
    return sound;
  }

  /**
   * Once a frame: let the music follow the fight. *signals* are what the scene sees; the recent
   * hurt bonus and the blackout come from the events heard here.
   */
  update(signals: Omit<MusicSignals, 'blackout'>): void {
    if (this.destroyed) return;
    const bar = this.music.bar();
    if (bar >= 0) {
      const threat = signals.threat + (performance.now() < this.hurtUntil ? MUSIC.hurtThreat : 0);
      const next = this.director.update(bar, { ...signals, threat, blackout: this.blackout });
      if (next) this.music.setState(next);
    }
    this.music.update();
  }

  private startMusic(): void {
    if (!this.destroyed) this.music.start();
  }

  /** The cue for every game event: the one table that says what the game sounds like. */
  private listen(): void {
    const e = this.events;
    e.on('shot-fired', ({ gun }) => this.play(WEAPON_FEEL[gun].sound, { volume: GUN_VOLUME[gun] ?? 1 }));
    e.on('bullet-impact', ({ material, solid }) => {
      if (material === 'metal') this.play('sfx-ping', { volume: 0.45, detune: solid === 'car' ? 0 : -600 });
      else this.play('sfx-impact', { volume: 0.35 });
    });
    e.on('enemy-hit', ({ enemy, source }) => {
      // A stomp is one blow, heard once in 'mech-stomp', however many it hits.
      if (source === 'stomp') return;
      const giant = enemy.kind === 'giant';
      this.play('sfx-hit', { detune: giant ? -800 : 0, volume: giant ? 1 : 0.75 });
    });
    e.on('enemy-killed', ({ kind }) => this.play('sfx-death', { detune: DEATH_DETUNE[kind] }));
    e.on('player-hurt', () => {
      this.hurtUntil = performance.now() + MUSIC.hurtThreatMs;
      this.play('sfx-hurt');
    });
    e.on('player-died', () => this.play('sfx-player-death'));
    e.on('purchase', () => this.play('sfx-buy', { volume: 0.8 }));
    e.on('purchase-refused', () => this.play('sfx-deny', { volume: 0.7 }));
    e.on('gate-opened', () => this.play('sfx-gate'));
    e.on('weapon-switched', () => this.play('sfx-switch', { volume: 0.6 }));
    e.on('wave-started', () => this.play('sfx-wave', { volume: 0.7 }));
    e.on('giant-warning', () => this.play('sfx-warning', { volume: 0.8 }));
    e.on('giant-arrived', () => this.play('sfx-giant-arrive'));
    e.on('giant-attack', ({ kind, phase }) => {
      if (phase === 'windUp' && kind === 'charge') this.play('sfx-roar');
      else if (phase === 'windUp' && kind === 'slam') this.play('sfx-rumble', { volume: 0.7 });
      else if (phase === 'active' && kind === 'slam') this.play('sfx-slam');
      else if (phase === 'active' && kind === 'debris') this.play('sfx-whoosh');
    });
    e.on('giant-rock-landed', () => this.play('sfx-crash'));
    e.on('mech-online', () => this.play('sfx-mech-on'));
    e.on('mech-boarded', () => this.play('sfx-mech-on', { volume: 0.7 }));
    e.on('mech-ejected', ({ why }) => {
      if (why === 'destroyed') this.play('sfx-explosion');
      else this.play('sfx-mech-off', { volume: why === 'parked' ? 0.6 : 1 });
    });
    e.on('mech-hit', ({ heavy }) => {
      this.hurtUntil = performance.now() + MUSIC.hurtThreatMs;
      this.play('sfx-clank', { volume: heavy ? 1 : 0.8 });
    });
    e.on('mech-stomp', ({ hits }) => {
      this.play('sfx-stomp');
      if (hits > 0) this.play('sfx-hit', { volume: 0.9 });
    });
    e.on('run-ended', ({ outcome }) => {
      if (outcome === 'cleared') this.play('sfx-victory');
    });
    // Future hooks.
    e.on('pickup-collected', () => this.play('sfx-pickup'));
    e.on('blackout-started', () => {
      this.blackout = true;
      this.play('sfx-blackout');
    });
    e.on('blackout-ended', () => {
      this.blackout = false;
      this.play('sfx-mech-on', { volume: 0.6 });
    });
  }

  private destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.sound.off(Phaser.Sound.Events.UNLOCKED, this.startMusic, this);
    this.music.destroy();
    for (const loop of this.loops) loop.sound.destroy();
    this.loops.length = 0;
  }
}
