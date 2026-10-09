import Phaser from 'phaser';
import { Enemy, ENEMY_DIED } from '../entities/Enemy';
import type { EnemyKind } from '../entities/enemies';
import { Giant } from '../entities/Giant';
import { GIANT, rollsGiant } from '../entities/giantRules';
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
  /** A Giant (26 px) arrives at least this far from any living enemy. */
  giantClearance: 64,
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
  /** Called once per enemy of the run, Giants included, when it dies. */
  onEnemyKilled: (enemy: Enemy) => void;
  /**
   * Called once per wave, when its last enemy dies; *last* when that ends the run, which also
   * waits for any Giant to die.
   */
  onWaveCleared: (waveNumber: number, last: boolean) => void;
}

/**
 * Runs the authored waves: an intermission, then the wave's enemies spawned a few at a time,
 * then the next intermission once every one of them is dead.
 *
 * From wave `GIANT.encounter.firstWave` on, each wave rolls once for a Giant as it starts.
 * A Giant is announced `warningMs` ahead, arrives far from the player, and is extra to the
 * wave: it can outlive the wave it came with, and no other Giant is rolled while it lives.
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
  /** The Giant in play, if any. */
  private giant: Giant | null = null;
  /** When an announced Giant is due to arrive; null when none is announced. */
  private giantDueAt: number | null = null;
  /** The last wave is cleared but its Giant still lives. */
  private waitingForGiant = false;
  /** Uniform [0, 1) source for the Giant roll; replaceable for tests. */
  random: () => number = Math.random;

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

  /** The living Giant, for the boss health bar. */
  get boss(): Giant | null {
    return this.giant;
  }

  /** Time until an announced Giant arrives, or 0 when none is announced. */
  giantWarningLeftMs(now: number): number {
    return this.giantDueAt === null ? 0 : Math.max(0, this.giantDueAt - now);
  }

  /** Every wave is cleared and only the Giant stands between the player and the end. */
  get waitingOnGiant(): boolean {
    return this.waitingForGiant;
  }

  intermissionLeftMs(now: number): number {
    return this.currentPhase === 'intermission' ? Math.max(0, this.intermissionEndsAt - now) : 0;
  }

  update(now: number): void {
    if (this.currentPhase === 'intermission' && now >= this.intermissionEndsAt) {
      this.currentPhase = 'active';
      this.nextSpawnAt = now;
      this.rollForGiant(now);
    }
    if (this.currentPhase === 'active') this.trySpawn(now);
    const live = this.currentPhase === 'active' || this.currentPhase === 'intermission';
    if (live && this.giantDueAt !== null && now >= this.giantDueAt) this.trySpawnGiant();
  }

  /** End the run where it stands. A completed run stays complete. No Giant arrives after. */
  stop(): void {
    if (this.currentPhase !== 'complete') this.currentPhase = 'stopped';
    this.giantDueAt = null;
  }

  private rollForGiant(now: number): void {
    if (this.giant || this.giantDueAt !== null) return;
    if (rollsGiant(this.waveNumber, this.random())) this.giantDueAt = now + GIANT.encounter.warningMs;
  }

  private trySpawnGiant(): void {
    const point = this.pickSpawnPoint(GIANT.encounter.minSpawnDistance, WAVE_TUNING.giantClearance);
    // No safe point this frame (all near the player or on screen): keep it announced and retry.
    if (!point) return;
    const giant = new Giant(this.scene, point.x, point.y);
    giant.once(ENEMY_DIED, this.onGiantDied, this);
    this.options.enemies.add(giant);
    this.giant = giant;
    this.giantDueAt = null;
  }

  private onGiantDied(giant: Giant): void {
    this.options.onEnemyKilled(giant);
    this.giant = null;
    if (this.waitingForGiant && this.currentPhase === 'active') {
      this.waitingForGiant = false;
      this.currentPhase = 'complete';
      this.options.onWaveCleared(this.waveNumber, true);
    }
  }

  private trySpawn(now: number): void {
    if (now < this.nextSpawnAt || this.spawned >= this.order.length) return;
    if (this.alive >= WAVE_TUNING.maxActiveEnemies) return;
    const point = this.pickSpawnPoint(WAVE_TUNING.minSpawnDistance, WAVE_TUNING.spawnClearance);
    // Every safe point can be briefly taken; try again next frame.
    if (!point) return;

    const enemy = new Enemy(this.scene, point.x, point.y, this.order[this.spawned]);
    enemy.once(ENEMY_DIED, this.onEnemyDied, this);
    this.options.enemies.add(enemy);
    this.spawned++;
    this.nextSpawnAt = now + WAVE_TUNING.spawnIntervalMs;
  }

  private pickSpawnPoint(minDistance: number, clearance: number): Point | undefined {
    const { player, enemies, spawnPoints, canSpawnAt } = this.options;
    const view = Phaser.Geom.Rectangle.Inflate(
      Phaser.Geom.Rectangle.Clone(this.scene.cameras.main.worldView),
      WAVE_TUNING.offscreenMargin,
      WAVE_TUNING.offscreenMargin,
    );
    const living = (enemies.getChildren() as Enemy[]).filter((e) => !e.isDead);
    const safe = spawnPoints.filter(
      (p) =>
        Phaser.Math.Distance.BetweenPoints(p, player) >= minDistance &&
        !view.contains(p.x, p.y) &&
        canSpawnAt(p) &&
        living.every((e) => Phaser.Math.Distance.BetweenPoints(p, e) >= clearance),
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
    if (last && (this.giant || this.giantDueAt !== null)) {
      // The run ends with the Giant, not before it.
      this.waitingForGiant = true;
      return;
    }
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
