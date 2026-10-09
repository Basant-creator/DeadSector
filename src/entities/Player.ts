import Phaser from 'phaser';

/** Movement speed in px/s. Diagonals are normalized, so this holds in all eight directions. */
export const PLAYER_SPEED = 180;

const TEXTURE_KEY = 'player';
const TEXTURE_SIZE = 48;
const BODY_RADIUS = 14;

type MoveKeys = Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;

/** Placeholder player: WASD movement, faces the mouse cursor independently of movement direction. */
export class Player extends Phaser.Physics.Arcade.Sprite {
  private readonly keys: MoveKeys;
  private readonly moveDir = new Phaser.Math.Vector2();
  private readonly aimPoint = new Phaser.Math.Vector2();

  /** Draws the placeholder texture: a circle with a barrel pointing along +x (rotation 0). */
  static createTexture(scene: Phaser.Scene): void {
    const c = TEXTURE_SIZE / 2;
    const g = scene.make.graphics({}, false);
    g.fillStyle(0xc8d6c0);
    g.fillCircle(c, c, BODY_RADIUS);
    g.fillStyle(0x7d8c74);
    g.fillRect(c + 6, c - 3, 18, 6);
    g.generateTexture(TEXTURE_KEY, TEXTURE_SIZE, TEXTURE_SIZE);
    g.destroy();
  }

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, TEXTURE_KEY);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Circular body centred in the texture, so rotating the sprite to aim never shifts the hitbox.
    const offset = TEXTURE_SIZE / 2 - BODY_RADIUS;
    this.setCircle(BODY_RADIUS, offset, offset);
    this.setCollideWorldBounds(true);

    const keyboard = scene.input.keyboard;
    if (!keyboard) {
      throw new Error('Player requires keyboard input');
    }
    const { W, A, S, D } = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      up: keyboard.addKey(W),
      left: keyboard.addKey(A),
      down: keyboard.addKey(S),
      right: keyboard.addKey(D),
    };
  }

  /** Current speed in px/s, for the debug readout. */
  get speed(): number {
    return this.body?.velocity.length() ?? 0;
  }

  update(): void {
    this.updateMovement();
    this.updateAim();
  }

  private updateMovement(): void {
    const { up, down, left, right } = this.keys;
    this.moveDir
      .set(Number(right.isDown) - Number(left.isDown), Number(down.isDown) - Number(up.isDown))
      .normalize()
      .scale(PLAYER_SPEED);
    this.setVelocity(this.moveDir.x, this.moveDir.y);
  }

  private updateAim(): void {
    // Re-project the pointer every frame: pointer.worldX/Y only refresh on mouse events,
    // so they go stale while the camera scrolls under a stationary cursor.
    const pointer = this.scene.input.activePointer;
    this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y, this.aimPoint);
    this.setRotation(Phaser.Math.Angle.Between(this.x, this.y, this.aimPoint.x, this.aimPoint.y));
  }
}
