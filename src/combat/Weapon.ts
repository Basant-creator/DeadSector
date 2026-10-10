import Phaser from 'phaser';
import type { Bullet } from './Bullet';
import type { GunDef, WeaponDef } from './weapons';

/**
 * Any gun, the mech's cannon included: its `def` sets the fire rate, the bullets per shot and how
 * they spread. Every gun fires from the same bullet pool, so this is the only firing code there is.
 */
export class Weapon<D extends GunDef = WeaponDef> {
  readonly def: D;
  private nextShotAt = 0;

  constructor(def: D) {
    this.def = def;
  }

  /**
   * Fire from (x, y) along *angle* if the fire rate allows. Returns whether a shot left the
   * barrel. Called every frame the trigger is held; the cooldown, not the caller, sets the pace.
   * *lead* is how far (x, y) sits behind the muzzle along *angle*. Each bullet starts that far
   * back along its own path, so every path still runs through the muzzle (a shotgun's fan opens
   * at the barrel, not at the player's centre), and flies that much further, so its reach past
   * the muzzle is still `range`.
   */
  tryFire(now: number, pool: Phaser.Physics.Arcade.Group, x: number, y: number, angle: number, lead = 0): boolean {
    if (now < this.nextShotAt) return false;
    const { pellets, spread, jitter, bulletSpeed, range, damage, fireRate } = this.def;
    const lifetimeMs = ((range + lead) / bulletSpeed) * 1000;
    const muzzleX = x + Math.cos(angle) * lead;
    const muzzleY = y + Math.sin(angle) * lead;
    let fired = 0;
    for (let i = 0; i < pellets; i++) {
      const bullet = pool.get() as Bullet | null;
      // An exhausted pool drops pellets rather than the whole shot.
      if (!bullet) break;
      const fan = pellets > 1 ? (i / (pellets - 1) - 0.5) * spread : 0;
      const deviation = jitter > 0 ? Phaser.Math.FloatBetween(-jitter, jitter) : 0;
      const a = angle + fan + deviation;
      bullet.fire(muzzleX - Math.cos(a) * lead, muzzleY - Math.sin(a) * lead, a, bulletSpeed, lifetimeMs, damage, this.def.id, this.def.tracer);
      fired++;
    }
    if (fired === 0) return false;
    this.nextShotAt = now + 1000 / fireRate;
    return true;
  }

  /** A hit-stop held the fight for *ms*: the next shot waits for it too. */
  shiftTimers(ms: number): void {
    this.nextShotAt += ms;
  }
}
