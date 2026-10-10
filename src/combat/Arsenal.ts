import Phaser from 'phaser';
import { Bullet } from './Bullet';
import { Weapon } from './Weapon';
import { STARTING_WEAPON, type WeaponId, WEAPON_IDS, WEAPONS } from './weapons';

/**
 * Most bullets alive at once, across every weapon. The rifle keeps about 9 in flight
 * (10 shots/s, 0.83 s each), a shotgun blast adds 6.
 */
const POOL_SIZE = 64;

/**
 * The weapons one run has: which are owned, which is in hand, and the bullet pool they share.
 * Created with the run, so every run starts with the pistol alone.
 */
export class Arsenal {
  readonly bullets: Phaser.Physics.Arcade.Group;
  private readonly weapons: Record<WeaponId, Weapon>;
  private readonly owned = new Set<WeaponId>([STARTING_WEAPON]);
  private held: WeaponId = STARTING_WEAPON;

  constructor(scene: Phaser.Scene) {
    this.bullets = scene.physics.add.group({ classType: Bullet, maxSize: POOL_SIZE, runChildUpdate: true });
    this.weapons = Object.fromEntries(WEAPON_IDS.map((id) => [id, new Weapon(WEAPONS[id])])) as Record<WeaponId, Weapon>;
  }

  get current(): Weapon {
    return this.weapons[this.held];
  }

  owns(id: WeaponId): boolean {
    return this.owned.has(id);
  }

  /** Add *id* to the owned weapons and put it in hand. */
  grant(id: WeaponId): void {
    this.owned.add(id);
    this.held = id;
  }

  /** Put *id* in hand if it is owned. Returns whether the weapon in hand changed. */
  equip(id: WeaponId): boolean {
    if (!this.owned.has(id) || id === this.held) return false;
    this.held = id;
    return true;
  }

  /** Switch to the next owned weapon in slot order. */
  cycle(): boolean {
    const owned = WEAPON_IDS.filter((id) => this.owned.has(id));
    return this.equip(owned[(owned.indexOf(this.held) + 1) % owned.length]);
  }

  /** A hit-stop held every bullet for *ms*: none loses range to it. */
  shiftTimers(ms: number): void {
    for (const bullet of this.bullets.getChildren() as Bullet[]) if (bullet.active) bullet.extendLife(ms);
  }

  tryFire(now: number, x: number, y: number, angle: number, lead = 0): boolean {
    return this.current.tryFire(now, this.bullets, x, y, angle, lead);
  }
}
