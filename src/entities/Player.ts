import Phaser from 'phaser';
import { STARTING_WEAPON, type WeaponDef, WEAPON_IDS, WEAPONS } from '../combat/weapons';

/** Movement speed in px/s. Diagonals are normalized, so this holds in all eight directions. */
export const PLAYER_SPEED = 180;
export const PLAYER_MAX_HP = 100;
/**
 * After taking damage the player cannot be damaged again for this long. Contact damage is
 * checked every physics step while bodies overlap; without this window a touch would land
 * 60 hits a second.
 */
export const PLAYER_INVULNERABLE_MS = 800;
/** Where the drawn barrel starts, in px from the player's centre. */
const BARREL_START = 6;

/** Distance from the player's centre to the tip of *weapon*'s barrel, where its shots start. */
export function muzzleOffset(weapon: WeaponDef): number {
  return BARREL_START + weapon.barrel.length;
}

const textureKey = (weapon: WeaponDef) => `player-${weapon.id}`;
/** Wide enough for the longest barrel. */
const TEXTURE_SIZE = 64;
const BODY_RADIUS = 14;
const HIT_FLASH_MS = 90;
const BLINK_PERIOD_MS = 80;

type MoveKeys = Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;

/** Placeholder player: WASD movement, faces the mouse cursor independently of movement direction. */
export class Player extends Phaser.Physics.Arcade.Sprite {
  private readonly keys: MoveKeys;
  private readonly moveDir = new Phaser.Math.Vector2();
  private readonly aimPoint = new Phaser.Math.Vector2();
  private hp = PLAYER_MAX_HP;
  private invulnerableUntil = 0;
  private dead = false;

  /**
   * Draws one placeholder texture per weapon: a circle with that weapon's barrel pointing
   * along +x (rotation 0), so the weapon in hand shows on the player.
   */
  static createTextures(scene: Phaser.Scene): void {
    const c = TEXTURE_SIZE / 2;
    for (const id of WEAPON_IDS) {
      const { barrel } = WEAPONS[id];
      const g = scene.make.graphics({}, false);
      g.fillStyle(0xc8d6c0);
      g.fillCircle(c, c, BODY_RADIUS);
      g.fillStyle(barrel.color);
      g.fillRect(c + BARREL_START, c - barrel.width / 2, barrel.length, barrel.width);
      g.generateTexture(textureKey(WEAPONS[id]), TEXTURE_SIZE, TEXTURE_SIZE);
      g.destroy();
    }
  }

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, textureKey(WEAPONS[STARTING_WEAPON]));
    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Circular body centred in the texture, so rotating the sprite to aim never shifts the hitbox.
    const offset = TEXTURE_SIZE / 2 - BODY_RADIUS;
    this.setCircle(BODY_RADIUS, offset, offset);
    this.setCollideWorldBounds(true);
    // Above enemies and bullets, so its hit flash and blink stay visible in contact.
    this.setDepth(3);

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

  /** Show *weapon* in hand. Every texture is the same size, so the body does not move. */
  holdWeapon(weapon: WeaponDef): void {
    this.setTexture(textureKey(weapon));
  }

  /** Current speed in px/s, for the debug readout. */
  get speed(): number {
    return this.body?.velocity.length() ?? 0;
  }

  get health(): number {
    return this.hp;
  }

  get isDead(): boolean {
    return this.dead;
  }

  /** Direction the player is aiming, in radians: the sprite always faces the cursor. */
  get aimAngle(): number {
    return this.rotation;
  }

  /**
   * Apply *amount* damage unless the player is dead or still invulnerable from the last hit.
   * Returns whether it landed, so the caller can add feedback for real hits only.
   */
  takeDamage(amount: number, now: number): boolean {
    if (this.dead || now < this.invulnerableUntil) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.invulnerableUntil = now + PLAYER_INVULNERABLE_MS;
    if (this.hp === 0) {
      this.die();
      return true;
    }
    this.setTintFill(0xff5544);
    this.scene.time.delayedCall(HIT_FLASH_MS, () => {
      if (this.scene && !this.dead) this.clearTint();
    });
    return true;
  }

  update(now: number): void {
    if (this.dead) return;
    this.updateMovement();
    this.updateAim();
    // Blink while invulnerable, so the window after a hit is visible.
    const blinking = now < this.invulnerableUntil && Math.floor(now / BLINK_PERIOD_MS) % 2 === 0;
    this.setAlpha(blinking ? 0.35 : 1);
  }

  private die(): void {
    this.dead = true;
    this.setVelocity(0, 0);
    this.setAlpha(1);
    this.setTint(0x4a4a4a);
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
