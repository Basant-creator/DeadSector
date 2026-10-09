import Phaser from 'phaser';
import { Enemy, ENEMY_DIED } from '../entities/Enemy';
import type { EnemyKind } from '../entities/enemies';
import { newKinds, spawnOrder, WAVES } from './waves';

export const WAVE_TUNING = {
  /** Pause before every wave, the first included. */
  intermissionMs: 3000,
  /** Gap between two spawns of the same wave. */
  spawnIntervalMs: 600,
  /** A wave holds back further spawns while this many of its enemies are alive. */
  maxActiveEnemies: 6,
  /** A spawn point closer than this to the player is not used. */
  minSpawnDistance: 400,
  /** ...nor one within this many px of the camera's view, so nothing appears on screen. */
  offscreenMargin: 64,
  /** ...nor one a living enemy still stands on. Two Brute bodies span 40 px. */
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
  /** Whether an enemy spawned at *point* could reach the player, e.g. not behind a locked gate. */
  canSpawnAt: (point: Point) => boolean;
  /** Spawned enemies are added here; the scene owns their colliders and pursuit. */
  enemies: Phaser.GameObjects.Group;
  player: Point;
  /** Called once per enemy of the run, when it dies. */
  onEnemyKilled: (enemy: Enemy) => void;
  /** Called once per wave, when its last enemy dies; *last* when that ends the run. */
  onWaveCleared: (waveNumber: number, last: boolean) => void;
}

/**
 * Runs the authored waves: an intermission, then the wave's enemies spawned a few at a time,
 * then the next intermission once every one of them is dead.
 *
 * Driven by `update(now)` from the scene, with no timers or scene listeners of its own, so
 * a scene restart leaves nothing of it behind. The one listener per enemy goes with the
 * enemy when it is destroyed.
 */
export class WaveDirector {
  private readonly scene: Phaser.Scene;
  private readonly options: WaveDirectorOptions;
  private currentPhase: WavePhase = 'intermission';
  private waveIndex = 0;
  /** The current wave's enemies in spawn order; `spawned` indexes the next one. */
  private order: EnemyKind[] = spawnOrder(WAVES[0]);
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

  /** Enemies of the current wave not yet killed, spawned or not. */
  get remaining(): number {
    return this.order.length - this.killed;
  }

  get alive(): number {
    return this.spawned - this.killed;
  }

  /** Enemy types the current wave is the first to send. */
  get newKinds(): EnemyKind[] {
    return newKinds(this.waveIndex);
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
    if (now < this.nextSpawnAt || this.spawned >= this.order.length) return;
    if (this.alive >= WAVE_TUNING.maxActiveEnemies) return;
    const point = this.pickSpawnPoint();
    // Every safe point can be briefly taken; try again next frame.
    if (!point) return;

    const enemy = new Enemy(this.scene, point.x, point.y, this.order[this.spawned]);
    enemy.once(ENEMY_DIED, this.onEnemyDied, this);
    this.options.enemies.add(enemy);
    this.spawned++;
    this.nextSpawnAt = now + WAVE_TUNING.spawnIntervalMs;
  }

  private pickSpawnPoint(): Point | undefined {
    const { player, enemies, spawnPoints, canSpawnAt } = this.options;
    const view = Phaser.Geom.Rectangle.Inflate(
      Phaser.Geom.Rectangle.Clone(this.scene.cameras.main.worldView),
      WAVE_TUNING.offscreenMargin,
      WAVE_TUNING.offscreenMargin,
    );
    const living = (enemies.getChildren() as Enemy[]).filter((e) => !e.isDead);
    const safe = spawnPoints.filter(
      (p) =>
        Phaser.Math.Distance.BetweenPoints(p, player) >= WAVE_TUNING.minSpawnDistance &&
        !view.contains(p.x, p.y) &&
        canSpawnAt(p) &&
        living.every((e) => Phaser.Math.Distance.BetweenPoints(p, e) >= WAVE_TUNING.spawnClearance),
    );
    return safe.length > 0 ? Phaser.Utils.Array.GetRandom(safe) : undefined;
  }

  private onEnemyDied(enemy: Enemy): void {
    this.options.onEnemyKilled(enemy);
    this.killed++;
    // Death stops progression, so an enemy killed by a bullet still in flight cannot
    // clear the wave.
    if (this.currentPhase !== 'active' || this.remaining > 0) return;
    const cleared = this.waveNumber;
    const last = this.waveIndex === WAVES.length - 1;
    if (last) {
      this.currentPhase = 'complete';
    } else {
      this.waveIndex++;
      this.order = spawnOrder(WAVES[this.waveIndex]);
      this.spawned = 0;
      this.killed = 0;
      this.currentPhase = 'intermission';
      this.intermissionEndsAt = this.scene.time.now + WAVE_TUNING.intermissionMs;
    }
    this.options.onWaveCleared(cleared, last);
  }
}
