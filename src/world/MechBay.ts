import Phaser from 'phaser';
import { MECH } from '../mech/mechRules';
import type { Point } from '../waves/WaveDirector';

/**
 * The mech's bay in the Industrial Facility: a painted pad (src/art/cityArt.ts) and a sign with
 * the price. Not solid; buying goes through the scene like every other purchase. Built afresh
 * on every scene start, so every run finds the mech for sale again.
 */
export class MechBay {
  readonly position: Point;
  private readonly sign: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, position: Point) {
    this.position = position;
    this.sign = scene.add
      .text(position.x, position.y - 64, '', {
        fontFamily: '"Courier New", Courier, monospace', fontSize: '13px', fontStyle: 'bold', color: '#d9c46a', stroke: '#08090c', strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setDepth(4);
    this.showForSale(true);
  }

  /** Price while the mech waits in its bay; once it is bought, the bay is just a bay. */
  showForSale(forSale: boolean): void {
    this.sign.setText(forSale ? `MECH ${MECH.cost}c` : 'MECH BAY').setColor(forSale ? '#d9c46a' : '#7a808c');
  }
}
