import Phaser from 'phaser';
import { Bullet } from './Bullet';

export interface PistolConfig {
  /** Shots per second while the trigger is held. */
  fireRate: number;
  /**
   * px/s. Keep it below 60 × the thinnest wall (32 px), i.e. 1920: Arcade moves a body in
   * fixed 60 Hz steps, and a bullet that travels further than a wall's thickness in one step
   * can pass through it.
   */
  bulletSpeed: number;
  damage: number;
  /** Distance in px a bullet travels before it is removed. */
  range: number;
}

export const PISTOL_DEFAULTS: PistolConfig = {
  fireRate: 4,
  bulletSpeed: 700,
  damage: 10,
  range: 650,
};

/** Most bullets alive at once. 4 shots/s with a ~0.93 s lifetime keeps about 4 in flight. */
const POOL_SIZE = 32;

/** A semi-automatic pistol: one bullet per shot, limited by `fireRate`. */
export class Pistol {
  /** Shown in the HUD. */
  readonly name = 'Pistol';
  readonly config: PistolConfig;
  readonly bullets: Phaser.Physics.Arcade.Group;
  private nextShotAt = 0;

  constructor(scene: Phaser.Scene, config: Partial<PistolConfig> = {}) {
    this.config = { ...PISTOL_DEFAULTS, ...config };
    this.bullets = scene.physics.add.group({ classType: Bullet, maxSize: POOL_SIZE, runChildUpdate: true });
  }

  /**
   * Fire from (x, y) along *angle* if the fire rate allows. Returns whether a shot left the
   * barrel. Called every frame the trigger is held; the cooldown, not the caller, sets the pace.
   */
  tryFire(now: number, x: number, y: number, angle: number): boolean {
    if (now < this.nextShotAt) return false;
    const bullet = this.bullets.get() as Bullet | null;
    if (!bullet) return false;
    const { bulletSpeed, range, fireRate } = this.config;
    bullet.fire(x, y, angle, bulletSpeed, (range / bulletSpeed) * 1000);
    this.nextShotAt = now + 1000 / fireRate;
    return true;
  }
}
