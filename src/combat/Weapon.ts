import Phaser from 'phaser';
import type { Bullet } from './Bullet';
import type { WeaponDef } from './weapons';

/**
 * Any weapon: its `def` sets the fire rate, the bullets per shot and how they spread. Every
 * weapon fires from the same bullet pool, so this is the only firing code there is.
 */
export class Weapon {
  readonly def: WeaponDef;
  private nextShotAt = 0;

  constructor(def: WeaponDef) {
    this.def = def;
  }

  /**
   * Fire from (x, y) along *angle* if the fire rate allows. Returns whether a shot left the
   * barrel. Called every frame the trigger is held; the cooldown, not the caller, sets the pace.
   */
  tryFire(now: number, pool: Phaser.Physics.Arcade.Group, x: number, y: number, angle: number): boolean {
    if (now < this.nextShotAt) return false;
    const { pellets, spread, jitter, bulletSpeed, range, damage, fireRate } = this.def;
    const lifetimeMs = (range / bulletSpeed) * 1000;
    let fired = 0;
    for (let i = 0; i < pellets; i++) {
      const bullet = pool.get() as Bullet | null;
      // An exhausted pool drops pellets rather than the whole shot.
      if (!bullet) break;
      const fan = pellets > 1 ? (i / (pellets - 1) - 0.5) * spread : 0;
      const deviation = jitter > 0 ? Phaser.Math.FloatBetween(-jitter, jitter) : 0;
      bullet.fire(x, y, angle + fan + deviation, bulletSpeed, lifetimeMs, damage);
      fired++;
    }
    if (fired === 0) return false;
    this.nextShotAt = now + 1000 / fireRate;
    return true;
  }
}
