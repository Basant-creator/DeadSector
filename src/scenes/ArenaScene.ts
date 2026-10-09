import Phaser from 'phaser';
import { Player } from '../entities/Player';

const ARENA_WIDTH = 2400;
const ARENA_HEIGHT = 1600;
const WALL_THICKNESS = 32;
const GRID_SIZE = 64;

/** Axis-aligned block as [x, y, width, height], top-left origin, in world pixels. */
type Block = readonly [number, number, number, number];

const OUTER_WALLS: readonly Block[] = [
  [0, 0, ARENA_WIDTH, WALL_THICKNESS],
  [0, ARENA_HEIGHT - WALL_THICKNESS, ARENA_WIDTH, WALL_THICKNESS],
  [0, WALL_THICKNESS, WALL_THICKNESS, ARENA_HEIGHT - WALL_THICKNESS * 2],
  [ARENA_WIDTH - WALL_THICKNESS, WALL_THICKNESS, WALL_THICKNESS, ARENA_HEIGHT - WALL_THICKNESS * 2],
];

const OBSTACLES: readonly Block[] = [
  // Pillars
  [400, 300, 64, 64],
  [800, 300, 64, 64],
  [1536, 300, 64, 64],
  [1936, 300, 64, 64],
  [400, 1236, 64, 64],
  [800, 1236, 64, 64],
  [1536, 1236, 64, 64],
  [1936, 1236, 64, 64],
  // Barriers framing the spawn
  [960, 520, 480, 32],
  [960, 1048, 480, 32],
  [600, 600, 32, 400],
  [1768, 600, 32, 400],
  // L-shaped corner cover
  [160, 160, 240, 32],
  [160, 192, 32, 208],
  // Narrow corridor (40 px gap; player is 28 px wide)
  [1100, 160, 32, 240],
  [1172, 160, 32, 240],
  // Crate cluster
  [2120, 1320, 48, 48],
  [2168, 1320, 48, 48],
  [2120, 1368, 48, 48],
];

/** Movement test arena: static walls and obstacles, a player, and a following camera. No combat. */
export class ArenaScene extends Phaser.Scene {
  private player!: Player;
  private debugText!: Phaser.GameObjects.Text;
  private lastSpeed = -1;

  constructor() {
    super('ArenaScene');
  }

  create(): void {
    // World bounds default to the canvas size; widen them to the whole arena.
    this.physics.world.setBounds(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

    this.add.grid(0, 0, ARENA_WIDTH, ARENA_HEIGHT, GRID_SIZE, GRID_SIZE, 0x0b0d0b, 1, 0x1a1f19, 1).setOrigin(0);

    const walls = this.physics.add.staticGroup();
    for (const block of OUTER_WALLS) {
      walls.add(this.addBlock(block, 0x3a4038));
    }
    for (const block of OBSTACLES) {
      walls.add(this.addBlock(block, 0x4c5444).setStrokeStyle(2, 0x6b7560));
    }

    this.player = new Player(this, ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
    this.physics.add.collider(this.player, walls);

    const camera = this.cameras.main;
    camera.setBounds(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    // roundPixels must stay off: Phaser floors the scroll after lerping, which swallows the final
    // sub-pixel steps and parks the camera up to 9 px off-centre with lerp 0.1.
    camera.startFollow(this.player, false, 0.1, 0.1);

    this.debugText = this.add
      .text(16, 16, '', { fontFamily: 'monospace', fontSize: '14px', color: '#8a9a80' })
      .setScrollFactor(0)
      .setDepth(10);
  }

  update(): void {
    this.player.update();

    // Only re-render the text when the value changes.
    const speed = Math.round(this.player.speed);
    if (speed !== this.lastSpeed) {
      this.lastSpeed = speed;
      this.debugText.setText(`WASD move | mouse aim\nspeed ${speed} px/s`);
    }
  }

  private addBlock([x, y, width, height]: Block, color: number): Phaser.GameObjects.Rectangle {
    return this.add.rectangle(x + width / 2, y + height / 2, width, height, color);
  }
}
