import Phaser from 'phaser';
import { LAYER } from '../art/layers';
import type { Point } from '../waves/WaveDirector';
import { type TileRect, tileRectToWorld } from './cityMap';

/** Coins the alley gate costs to open. */
export const GATE_COST = 60;
/** How close, in px from the gate's centre, the player must stand to buy it. */
export const GATE_REACH = 120;
const OPEN_MS = 350;

/**
 * A locked gate set into a wall. Closed, its bars are a static body like any wall: they
 * stop the player, enemies and bullets. `open` takes the body out of the physics world and
 * rolls the bars up. A gate belongs to its scene's run: a restart builds a new, closed one.
 */
export class Gate {
  readonly rect: TileRect;
  readonly centre: Point;
  /** The collision body: invisible, like every solid. */
  readonly bars: Phaser.GameObjects.Rectangle;
  /** What the player sees: a roll-up shutter (src/art/props.ts). */
  readonly shutter: Phaser.GameObjects.Image;
  private readonly sign: Phaser.GameObjects.Text;
  private opened = false;

  constructor(scene: Phaser.Scene, rect: TileRect) {
    this.rect = rect;
    const { x, y, width, height } = tileRectToWorld(rect);
    this.centre = { x: x + width / 2, y: y + height / 2 };

    this.bars = scene.add.rectangle(x, y, width, height, 0x000000).setOrigin(0).setVisible(false);
    scene.physics.add.existing(this.bars, true);
    // Top-left origin, so scaling the height rolls the shutter up toward the lintel.
    this.shutter = scene.add.image(x, y, 'gate-shutter').setOrigin(0).setDepth(LAYER.props);
    this.sign = scene.add
      .text(x - 10, y - 12, `GATE ${GATE_COST}c`, {
        fontFamily: '"Courier New", Courier, monospace', fontSize: '14px', fontStyle: 'bold', color: '#d9c46a', stroke: '#08090c', strokeThickness: 4,
      })
      .setOrigin(1, 1);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  isWithinReach(p: Point): boolean {
    return Phaser.Math.Distance.BetweenPoints(p, this.centre) <= GATE_REACH;
  }

  /** Open for good. Only the first call does anything. */
  open(): void {
    if (this.opened) return;
    this.opened = true;
    const scene = this.bars.scene;
    scene.physics.world.disable(this.bars);
    this.sign.setText('OPEN').setColor('#7fb069');
    scene.tweens.add({ targets: this.shutter, scaleY: 0.08, duration: OPEN_MS, ease: 'Quad.easeOut' });
  }
}
