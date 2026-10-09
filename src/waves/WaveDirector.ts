import Phaser from 'phaser';
import { Walker, WALKER_DIED } from '../entities/Walker';

export interface WaveDefinition {
  /** Walkers the wave sends in total; at most `maxActiveWalkers` are alive at once. */
  readonly walkers: number;
}

/** The authored run, in order. Clearing the last wave ends it. */
export const WAVES: readonly WaveDefinition[] = [
  { walkers: 6 },
  { walkers: 8 },
  { walkers: 9 },
  { walkers: 9 },
  { walkers: 9 },
];

export const WAVE_TUNING = {
  /** Pause before every wave, the first included. */
  intermissionMs: 3000,
  /** Gap between two spawns of the same wave. */
  spawnIntervalMs: 600,
  /** A wave holds back further spawns while this many of its Walkers are alive. */
  maxActiveWalkers: 6,
  /** A spawn point closer than this to the player is not used. */
  minSpawnDistance: 400,
  /** ...nor one within this many px of the camera's view, so nothing appears on screen. */
  offscreenMargin: 64,
  /** ...nor one a living Walker still stands on. Two Walker bodies span 30 px. */
  spawnClearance: 48,
} as const;

/**
 * - intermission: counting down to the wave at `waveNumber`.
 * - active: the wave is spawning or being fought.
 * - complete: the last wave is cleared.
 * - stopped: the player died; nothing advances or spawns any more.
 */
export type WavePhase = 'intermission' | 'active' | 'complete' | 'stopped';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface WaveDirectorOptions {
  /** Authored positions clear of every wall; the director picks among the safe ones. */
  spawnPoints: readonly Point[];
  /** Whether a Walker spawned at *point* could reach the player, e.g. not behind a locked gate. */
  canSpawnAt: (point: Point) => boolean;
  /** Spawned Walkers are added here; the scene owns their colliders and pursuit. */
  walkers: Phaser.GameObjects.Group;
  player: Point;
  /** Called once per Walker of the run, when it dies. */
  onWalkerKilled: (walker: Walker) => void;
  /** Called once per wave, when its last Walker dies; *last* when that ends the run. */
  onWaveCleared: (waveNumber: number, last: boolean) => void;
}

/**
 * Runs the authored waves: an intermission, then the wave's Walkers spawned a few at a time,
 * then the next intermission once every one of them is dead.
 *
 * Driven by `update(now)` from the scene, with no timers or scene listeners of its own, so
 * a scene restart leaves nothing of it behind. The one listener per Walker goes with the
 * Walker when it is destroyed.
 */
export class WaveDirector {
  private readonly scene: Phaser.Scene;
  private readonly options: WaveDirectorOptions;
  private currentPhase: WavePhase = 'intermission';
  private waveIndex = 0;
  private spawned = 0;
  private killed = 0;
  private intermissionEndsAt: number;
  private nextSpawnAt = 0;

  constructor(scene: Phaser.Scene, options: WaveDirectorOptions) {
    this.scene = scene;
    this.options = options;
    this.intermissionEndsAt = scene.time.now + WAVE_TUNING.intermissionMs;
  }

  get phase(): WavePhase {
    return this.currentPhase;
  }

  /** 1-based number of the wave being fought, or coming up next. */
  get waveNumber(): number {
    return this.waveIndex + 1;
  }

  get waveCount(): number {
    return WAVES.length;
  }

  /** Walkers of the current wave not yet killed, spawned or not. */
  get remaining(): number {
    return WAVES[this.waveIndex].walkers - this.killed;
  }

  get alive(): number {
    return this.spawned - this.killed;
  }

  intermissionLeftMs(now: number): number {
    return this.currentPhase === 'intermission' ? Math.max(0, this.intermissionEndsAt - now) : 0;
  }

  update(now: number): void {
    if (this.currentPhase === 'intermission' && now >= this.intermissionEndsAt) {
      this.currentPhase = 'active';
      this.nextSpawnAt = now;
    }
    if (this.currentPhase === 'active') this.trySpawn(now);
  }

  /** End the run where it stands. A completed run stays complete. */
  stop(): void {
    if (this.currentPhase !== 'complete') this.currentPhase = 'stopped';
  }

  private trySpawn(now: number): void {
    const wave = WAVES[this.waveIndex];
    if (now < this.nextSpawnAt || this.spawned >= wave.walkers) return;
    if (this.alive >= WAVE_TUNING.maxActiveWalkers) return;
    const point = this.pickSpawnPoint();
    // Every safe point can be briefly taken; try again next frame.
    if (!point) return;

    const walker = new Walker(this.scene, point.x, point.y);
    walker.once(WALKER_DIED, this.onWalkerDied, this);
    this.options.walkers.add(walker);
    this.spawned++;
    this.nextSpawnAt = now + WAVE_TUNING.spawnIntervalMs;
  }

  private pickSpawnPoint(): Point | undefined {
    const { player, walkers, spawnPoints, canSpawnAt } = this.options;
    const view = Phaser.Geom.Rectangle.Inflate(
      Phaser.Geom.Rectangle.Clone(this.scene.cameras.main.worldView),
      WAVE_TUNING.offscreenMargin,
      WAVE_TUNING.offscreenMargin,
    );
    const living = (walkers.getChildren() as Walker[]).filter((w) => !w.isDead);
    const safe = spawnPoints.filter(
      (p) =>
        Phaser.Math.Distance.BetweenPoints(p, player) >= WAVE_TUNING.minSpawnDistance &&
        !view.contains(p.x, p.y) &&
        canSpawnAt(p) &&
        living.every((w) => Phaser.Math.Distance.BetweenPoints(p, w) >= WAVE_TUNING.spawnClearance),
    );
    return safe.length > 0 ? Phaser.Utils.Array.GetRandom(safe) : undefined;
  }

  private onWalkerDied(walker: Walker): void {
    this.options.onWalkerKilled(walker);
    this.killed++;
    // Death stops progression, so a Walker killed by a bullet still in flight cannot
    // clear the wave.
    if (this.currentPhase !== 'active' || this.remaining > 0) return;
    const cleared = this.waveNumber;
    const last = this.waveIndex === WAVES.length - 1;
    if (last) {
      this.currentPhase = 'complete';
    } else {
      this.waveIndex++;
      this.spawned = 0;
      this.killed = 0;
      this.currentPhase = 'intermission';
      this.intermissionEndsAt = this.scene.time.now + WAVE_TUNING.intermissionMs;
    }
    this.options.onWaveCleared(cleared, last);
  }
}
