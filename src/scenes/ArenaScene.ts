import Phaser from 'phaser';
import { Bullet } from '../combat/Bullet';
import { Pistol } from '../combat/Pistol';
import { MUZZLE_OFFSET, Player, PLAYER_MAX_HP } from '../entities/Player';
import { Walker } from '../entities/Walker';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';

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

/** Where the one Walker starts: clear of every obstacle, with an open line to the player's spawn. */
const WALKER_SPAWN = { x: 500, y: 1400 } as const;

/** Test arena: static walls and obstacles, a player with a pistol, one Walker, a following camera. */
export class ArenaScene extends Phaser.Scene {
  private player!: Player;
  private pistol!: Pistol;
  private walkers!: Phaser.GameObjects.Group;
  private debugText!: Phaser.GameObjects.Text;
  private lastHud = '';

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

    this.pistol = new Pistol(this);
    // A plain group: colliders read its live members, and a destroyed Walker leaves it by itself.
    this.walkers = this.add.group();
    this.walkers.add(new Walker(this, WALKER_SPAWN.x, WALKER_SPAWN.y));

    this.physics.add.collider(this.walkers, walls);
    this.physics.add.collider(this.pistol.bullets, walls, (bullet) => (bullet as Bullet).kill());
    this.physics.add.overlap(this.pistol.bullets, this.walkers, (a, b) => this.onBulletHitsWalker(a, b));
    this.physics.add.overlap(this.player, this.walkers, (a, b) => this.onWalkerTouchesPlayer(a, b));

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
    const now = this.time.now;
    this.player.update(now);

    if (!this.player.isDead) {
      if (this.input.activePointer.leftButtonDown()) {
        const angle = this.player.aimAngle;
        this.pistol.tryFire(now,
          this.player.x + Math.cos(angle) * MUZZLE_OFFSET,
          this.player.y + Math.sin(angle) * MUZZLE_OFFSET,
          angle);
      }
      for (const walker of this.walkers.getChildren() as Walker[]) walker.pursue(this.player);
    }

    // Only re-render the text when it changes.
    const hud = `WASD move | mouse aim | LMB fire\nHP ${this.player.health}/${PLAYER_MAX_HP}  ` +
      `speed ${Math.round(this.player.speed)} px/s`;
    if (hud !== this.lastHud) {
      this.lastHud = hud;
      this.debugText.setText(hud);
    }
  }

  private onBulletHitsWalker(a: unknown, b: unknown): void {
    const bullet = (a instanceof Bullet ? a : b) as Bullet;
    const walker = (a instanceof Walker ? a : b) as Walker;
    // A bullet is spent by its first hit: disabling it here stops it reaching anything else.
    if (!bullet.active || walker.isDead) return;
    bullet.kill();
    walker.takeDamage(this.pistol.config.damage);
  }

  private onWalkerTouchesPlayer(a: unknown, b: unknown): void {
    const walker = (a instanceof Walker ? a : b) as Walker;
    if (walker.isDead) return;
    // Fires every step the two overlap; the player's invulnerability window turns that into
    // one hit per touch.
    if (!this.player.takeDamage(walker.contactDamage, this.time.now)) return;
    this.cameras.main.shake(120, 0.006);
    if (this.player.isDead) this.onPlayerDeath();
  }

  private onPlayerDeath(): void {
    for (const walker of this.walkers.getChildren() as Walker[]) walker.halt();
    this.add
      // Above centre: the camera keeps the player in the middle of the screen.
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 140, 'YOU DIED\npress R to restart', {
        fontFamily: 'monospace', fontSize: '40px', color: '#c8d6c0', align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(20);
    this.input.keyboard?.once('keydown-R', () => this.scene.restart());
  }

  private addBlock([x, y, width, height]: Block, color: number): Phaser.GameObjects.Rectangle {
    return this.add.rectangle(x + width / 2, y + height / 2, width, height, color);
  }
}
