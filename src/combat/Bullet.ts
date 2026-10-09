import Phaser from 'phaser';

const TEXTURE_KEY = 'bullet';
const TEXTURE_SIZE = 8;
const BODY_RADIUS = 3;

/**
 * A pooled projectile. `kill` returns it to its pool instead of destroying it: the same few
 * dozen bullets are reused for the whole session.
 */
export class Bullet extends Phaser.Physics.Arcade.Sprite {
  private expiresAt = 0;

  static createTexture(scene: Phaser.Scene): void {
    const g = scene.make.graphics({}, false);
    g.fillStyle(0xf2e3a0);
    g.fillCircle(TEXTURE_SIZE / 2, TEXTURE_SIZE / 2, BODY_RADIUS);
    g.generateTexture(TEXTURE_KEY, TEXTURE_SIZE, TEXTURE_SIZE);
    g.destroy();
  }

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, TEXTURE_KEY);
    this.setDepth(2);
  }

  /** Launch from (x, y) along *angle*; the bullet removes itself after *lifetimeMs*. */
  fire(x: number, y: number, angle: number, speed: number, lifetimeMs: number): void {
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

  /** Called by the pool's group each frame while the bullet is active. */
  update(): void {
    if (this.active && this.scene.time.now >= this.expiresAt) this.kill();
  }
}
