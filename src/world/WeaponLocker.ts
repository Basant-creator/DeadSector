import Phaser from 'phaser';
import { LAYER } from '../art/layers';
import { lockerKey } from '../art/props';
import { type WeaponId, WEAPONS } from '../combat/weapons';
import type { Point } from '../waves/WaveDirector';

/** How close, in px from the spot in front of a locker, the player must stand to buy from it. */
export const LOCKER_REACH = 90;

export interface LockerPlacement {
  readonly weapon: WeaponId;
  /** Middle of the stretch of building wall the locker hangs on. */
  readonly wall: Point;
  /** Which way the wall faces, i.e. where the player stands to use it. */
  readonly facing: 'up' | 'down';
}

/**
 * A weapon rack on a building wall, selling one weapon. Only a sign: it is not solid, and the
 * purchase itself goes through the scene like every other.
 */
export class WeaponLocker {
  readonly weapon: WeaponId;
  /** The spot in front of the locker. */
  readonly standAt: Point;
  private readonly sign: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, placement: LockerPlacement) {
    this.weapon = placement.weapon;
    const { wall, facing } = placement;
    const out = facing === 'down' ? 1 : -1;
    this.standAt = { x: wall.x, y: wall.y + out * 28 };

    // The cabinet sits inside the wall's edge, so it never pokes into the walkable street.
    scene.add.image(wall.x, wall.y - out * 10, lockerKey(placement.weapon)).setDepth(LAYER.props);
    this.sign = scene.add
      .text(wall.x, wall.y - out * 26, '', {
        fontFamily: '"Courier New", Courier, monospace', fontSize: '13px', fontStyle: 'bold', color: '#d9c46a', stroke: '#08090c', strokeThickness: 4,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(4);
    this.showForSale(true);
  }

  /** Price while for sale, OWNED once bought. */
  showForSale(forSale: boolean): void {
    const def = WEAPONS[this.weapon];
    this.sign
      .setText(forSale ? `${def.name.toUpperCase()} ${def.cost}c` : `${def.name.toUpperCase()} OWNED`)
      .setColor(forSale ? '#d9c46a' : '#7fb069');
  }
}
