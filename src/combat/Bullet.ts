import Phaser from 'phaser';
import type { WeaponId } from './weapons';

/** Tracer texture from src/art/props.ts: 12 x 12, drawn along +x and rotated to the flight path. */
const TEXTURE_KEY = 'bullet';
const TEXTURE_SIZE = 12;
const BODY_RADIUS = 3;

/**
 * A pooled projectile. `kill` returns it to its pool instead of destroying it: the same few
 * dozen bullets are reused for the whole session.
 */
export class Bullet extends Phaser.Physics.Arcade.Sprite {
  private expiresAt = 0;
  /** Damage this shot deals, set by the weapon that fired it. */
  damage = 0;
  /** The weapon that fired it, for how hard its hit feels; null for bullets fired by other means. */
  weapon: WeaponId | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, TEXTURE_KEY);
    this.setDepth(2);
  }

  /** Launch from (x, y) along *angle*; the bullet removes itself after *lifetimeMs*. */
  fire(x: number, y: number, angle: number, speed: number, lifetimeMs: number, damage: number, weapon: WeaponId | null = null): void {
    this.damage = damage;
    this.weapon = weapon;
    this.enableBody(true, x, y, true, true);
    // Set on every launch: the pool's group applies its own body defaults when it creates a
    // bullet, after the constructor has run.
    const offset = TEXTURE_SIZE / 2 - BODY_RADIUS;
    this.setCircle(BODY_RADIUS, offset, offset);
    this.setRotation(angle);
    this.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    this.expiresAt = this.scene.time.now + lifetimeMs;
  }

  kill(): void {
    this.disableBody(true, true);
  }

  /** A hit-stop held the bullet in place for *ms*: it keeps its full range. */
  extendLife(ms: number): void {
    this.expiresAt += ms;
  }

  /** Called by the pool's group each frame while the bullet is active. */
  update(): void {
    // A paused world (hit-stop) holds the bullet still; it must not run out of range meanwhile.
    if (!this.active || this.scene.physics.world.isPaused) return;
    if (this.scene.time.now >= this.expiresAt) this.kill();
  }
}
