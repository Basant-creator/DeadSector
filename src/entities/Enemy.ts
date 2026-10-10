import Phaser from 'phaser';
import { enemyTextureKey, enemyWalkAnim } from '../art/characters';
import { ENEMY_WEIGHT, IMPACT } from '../combat/feel';
import type { GameEvents } from '../events/GameEvents';
import type { NavGrid } from '../world/NavGrid';
import { ENEMIES, type EnemyDef, type EnemyKind } from './enemies';

/** Emitted on the enemy, with the enemy as its argument, the one time it dies. */
export const ENEMY_DIED = 'enemy-died';

/** What an enemy may see and do each frame, handed to `act` by the scene. */
export interface EnemyContext {
  readonly player: { readonly x: number; readonly y: number; readonly isDead: boolean };
  readonly nav: NavGrid;
  /** Deal *amount* to the player. Returns whether it landed (not dead or invulnerable). */
  hurtPlayer(amount: number): boolean;
  /** Camera shake for heavy impacts, scaled by the player's shake setting. */
  shake(intensity: number, durationMs: number): void;
  /** The run's event bus: announce what happened; presentation (sound) answers. */
  events: GameEvents;
  /** Hold the fight still for *ms* (hit-stop), for impacts that should land hard. */
  hitStop(ms: number): void;
}

const HIT_FLASH_MS = 70;
const DEATH_FADE_MS = 180;

/**
 * One enemy of any type; its `def` from `ENEMIES` sets every stat. Faces where it walks, with
 * arms reaching along +x (rotation 0); its look and walk cycle come from `src/art/characters.ts`.
 */
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  readonly def: EnemyDef;
  private hp: number;
  private dead = false;
  /** Knockback in progress: velocity at its start, and when it began and ends. */
  private readonly knock = new Phaser.Math.Vector2();
  private knockStartedAt = 0;
  private knockUntil = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, kind: EnemyKind) {
    super(scene, x, y, enemyTextureKey(kind));
    this.def = ENEMIES[kind];
    this.hp = this.def.maxHp;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    // Circular body centred in the frame (src/art/characters.ts), so rotation never moves it.
    const offset = this.width / 2 - this.def.radius;
    this.setCircle(this.def.radius, offset, offset);
    this.setCollideWorldBounds(true);
    // Below bullets and the player: an enemy on top of the player hid its hit flash.
    this.setDepth(1);
    this.anims.play(enemyWalkAnim(kind));
  }

  get kind(): EnemyKind {
    return this.def.kind;
  }

  get radius(): number {
    return this.def.radius;
  }

  get contactDamage(): number {
    return this.def.contactDamage;
  }

  get coinReward(): number {
    return this.def.coinReward;
  }

  get health(): number {
    return this.hp;
  }

  get isDead(): boolean {
    return this.dead;
  }

  /** One frame of behaviour: by default, follow the flow field toward the player. */
  act(now: number, ctx: EnemyContext): void {
    if (this.dead) return;
    if (now < this.knockUntil) {
      // Drift to a stop along the shove, then pursue again. Walls still stop the body.
      const left = (this.knockUntil - now) / IMPACT.knockbackMs;
      this.setVelocity(this.knock.x * left, this.knock.y * left);
      return;
    }
    this.pursue(ctx.nav.waypoint(this, ctx.player, this.radius));
  }

  /**
   * Shove along *angle* at *speed* px/s, divided by this type's weight. Shoves landing during
   * one already under way (shotgun pellets) add up, to `IMPACT.maxKnockback`.
   */
  knockback(angle: number, speed: number, now: number): void {
    const weight = ENEMY_WEIGHT[this.def.kind];
    if (this.dead || !Number.isFinite(weight)) return;
    if (now >= this.knockUntil) {
      this.knock.set(0, 0);
      this.knockStartedAt = now;
      this.knockUntil = now + IMPACT.knockbackMs;
    }
    this.knock.x += (Math.cos(angle) * speed) / weight;
    this.knock.y += (Math.sin(angle) * speed) / weight;
    if (this.knock.length() > IMPACT.maxKnockback) this.knock.setLength(IMPACT.maxKnockback);
  }

  /** A hit-stop held the fight for *ms*: push this enemy's timers back by it. */
  shiftTimers(ms: number): void {
    this.knockStartedAt += ms;
    this.knockUntil += ms;
  }

  /**
   * Head straight for *target* at this type's speed. Pathfinding is the caller's: it passes
   * the next waypoint around the walls, and the physics separation lets the enemy slide along
   * any it grazes.
   */
  pursue(target: { x: number; y: number }): void {
    if (this.dead) return;
    const angle = Phaser.Math.Angle.Between(this.x, this.y, target.x, target.y);
    this.setRotation(angle);
    this.setVelocity(Math.cos(angle) * this.def.speed, Math.sin(angle) * this.def.speed);
  }

  halt(): void {
    if (!this.dead) this.setVelocity(0, 0);
  }

  /** Apply *amount* damage. Returns whether it landed; a dead enemy takes none. */
  takeDamage(amount: number): boolean {
    if (this.dead) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp === 0) {
      this.die();
      return true;
    }
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(HIT_FLASH_MS, () => {
      if (this.scene && !this.dead) this.clearTint();
    });
    return true;
  }

  /**
   * The body is disabled at once, so nothing can hit or be hurt by a dying enemy; the sprite
   * fades out and is destroyed, which also removes it from every group it is in and drops its
   * listeners. Only reachable once: `takeDamage` ignores a dead enemy, so however many pellets
   * land in the same step, the death and its reward happen one time.
   */
  protected die(): void {
    this.dead = true;
    this.anims.stop();
    this.setVelocity(0, 0);
    this.disableBody(false, false);
    this.setTint(0x3a1d18);
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scale: 0.6,
      duration: DEATH_FADE_MS,
      onComplete: () => this.destroy(),
    });
    this.emit(ENEMY_DIED, this);
  }
}
