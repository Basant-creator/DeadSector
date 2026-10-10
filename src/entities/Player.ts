import Phaser from 'phaser';
import { PLAYER_RECOIL_FRAME, playerTextureKey, playerWalkAnim } from '../art/characters';
import { STARTING_WEAPON, type WeaponDef, WEAPONS } from '../combat/weapons';

/** Movement speed in px/s. Diagonals are normalized, so this holds in all eight directions. */
export const PLAYER_SPEED = 230;
/**
 * From standing to full speed, and from full speed to a stop, in ms. Short enough to feel
 * immediate (a full reversal takes about 85 ms), long enough to read as weight, not a teleport.
 */
const ACCEL_MS = 50;
const DECEL_MS = 35;
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

/** Frame size of the player's sprite sheets (src/art/characters.ts), wide enough for the longest barrel. */
const TEXTURE_SIZE = 64;
export const PLAYER_BODY_RADIUS = 14;
const HIT_FLASH_MS = 90;
const BLINK_PERIOD_MS = 80;

export type MoveKeys = Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;

/** WASD, shared by everything the player steers: Phaser hands back the same keys every time. */
export function moveKeys(scene: Phaser.Scene): MoveKeys {
  const keyboard = scene.input.keyboard;
  if (!keyboard) {
    throw new Error('Steering requires keyboard input');
  }
  const { W, A, S, D } = Phaser.Input.Keyboard.KeyCodes;
  return { up: keyboard.addKey(W), left: keyboard.addKey(A), down: keyboard.addKey(S), right: keyboard.addKey(D) };
}

/**
 * The mouse cursor in world coordinates, written into *out*. Re-projected every call:
 * pointer.worldX/Y only refresh on mouse events, so they go stale while the camera scrolls under a
 * stationary cursor. Projected through the camera's view, not its render matrix: screen shake
 * offsets the matrix, and the aim must not shake with it.
 */
export function pointerInWorld(scene: Phaser.Scene, out: Phaser.Math.Vector2): Phaser.Math.Vector2 {
  const pointer = scene.input.activePointer;
  const camera = scene.cameras.main;
  const view = camera.worldView;
  return out.set(view.x + (pointer.x - camera.x) / camera.zoom, view.y + (pointer.y - camera.y) / camera.zoom);
}

/** Unit-length input from *keys*, scaled to *speed*. */
export function steer(keys: MoveKeys, speed: number, out: Phaser.Math.Vector2): Phaser.Math.Vector2 {
  const { up, down, left, right } = keys;
  return out.set(Number(right.isDown) - Number(left.isDown), Number(down.isDown) - Number(up.isDown)).normalize().scale(speed);
}

/**
 * Steer *velocity* toward *target* at a fixed rate: full speed in *accelMs* while there is input,
 * a stop in *decelMs* without. *dt* in ms.
 */
export function approach(
  velocity: Phaser.Math.Vector2, target: Phaser.Math.Vector2, speed: number, accelMs: number, decelMs: number, dt: number,
): Phaser.Math.Vector2 {
  const rate = speed / (target.lengthSq() > 0 ? accelMs : decelMs);
  const dx = target.x - velocity.x;
  const dy = target.y - velocity.y;
  const gap = Math.hypot(dx, dy);
  const step = rate * dt;
  if (gap <= step) return velocity.copy(target);
  return velocity.set(velocity.x + (dx / gap) * step, velocity.y + (dy / gap) * step);
}

/** The player: WASD movement, faces the mouse cursor independently of movement direction. */
export class Player extends Phaser.Physics.Arcade.Sprite {
  private readonly keys: MoveKeys;
  private readonly moveDir = new Phaser.Math.Vector2();
  private readonly aimPoint = new Phaser.Math.Vector2();
  private hp = PLAYER_MAX_HP;
  private invulnerableUntil = 0;
  private dead = false;
  private weapon: WeaponDef = WEAPONS[STARTING_WEAPON];
  private readonly velocity = new Phaser.Math.Vector2();
  private lastUpdateAt = 0;
  private recoilUntil = 0;
  private inVehicle = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, playerTextureKey(WEAPONS[STARTING_WEAPON]));
    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Circular body centred in the texture, so rotating the sprite to aim never shifts the hitbox.
    const offset = TEXTURE_SIZE / 2 - PLAYER_BODY_RADIUS;
    this.setCircle(PLAYER_BODY_RADIUS, offset, offset);
    this.setCollideWorldBounds(true);
    // Above enemies and bullets, so its hit flash and blink stay visible in contact.
    this.setDepth(3);

    this.keys = moveKeys(scene);
  }

  /** Show *weapon* in hand. Every sheet has the same frame size, so the body does not move. */
  holdWeapon(weapon: WeaponDef): void {
    this.weapon = weapon;
    this.setTexture(playerTextureKey(weapon), 0);
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
    // Inside the mech, its hull takes the hits; nothing reaches the pilot.
    if (this.dead || this.inVehicle || now < this.invulnerableUntil) return false;
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

  /** Show the recoil pose for *ms*. Presentation only: the aim and the shot are untouched. */
  recoil(now: number, ms: number): void {
    this.recoilUntil = Math.max(this.recoilUntil, now + ms);
  }

  /** Whether the player is inside the mech: hidden, with no body, carried along by it. */
  get isInVehicle(): boolean {
    return this.inVehicle;
  }

  /** Climb into a vehicle: the sprite hides and the body leaves the physics world. */
  enterVehicle(): void {
    if (this.inVehicle || this.dead) return;
    this.inVehicle = true;
    this.anims.stop();
    this.velocity.set(0, 0);
    this.disableBody(false, true);
  }

  /** Ride along at (x, y), so everything that follows the player follows the vehicle. */
  followVehicle(x: number, y: number): void {
    if (this.inVehicle) this.setPosition(x, y);
  }

  /**
   * Climb out at (x, y), untouchable for *protectMs*: the moment of getting out is never the
   * moment of getting hit. Health is what it was on the way in.
   */
  exitVehicle(x: number, y: number, now: number, protectMs: number): void {
    if (!this.inVehicle) return;
    this.inVehicle = false;
    this.enableBody(true, x, y, true, true);
    this.setVelocity(0, 0);
    this.setFrame(0);
    this.lastUpdateAt = now;
    this.invulnerableUntil = Math.max(this.invulnerableUntil, now + protectMs);
  }

  /** A hit-stop held the game for *ms*: the invulnerability window must not run out during it. */
  shiftTimers(ms: number): void {
    this.invulnerableUntil += ms;
    this.lastUpdateAt += ms;
  }

  update(now: number): void {
    if (this.dead || this.inVehicle) return;
    const dt = this.lastUpdateAt > 0 ? Phaser.Math.Clamp(now - this.lastUpdateAt, 0, 50) : 16;
    this.lastUpdateAt = now;
    this.updateMovement(dt);
    this.updateAim();
    this.animate(now);
    // Blink while invulnerable, so the window after a hit is visible.
    const blinking = now < this.invulnerableUntil && Math.floor(now / BLINK_PERIOD_MS) % 2 === 0;
    this.setAlpha(blinking ? 0.35 : 1);
  }

  /** Recoil pose after a shot, else the walk cycle while moving, else standing. Presentation only. */
  private animate(now: number): void {
    if (now < this.recoilUntil) {
      if (this.anims.isPlaying) this.anims.stop();
      this.setFrame(PLAYER_RECOIL_FRAME);
      return;
    }
    if (this.moveDir.lengthSq() > 0) {
      this.anims.play(playerWalkAnim(this.weapon), true);
    } else if (this.anims.isPlaying || Number(this.frame.name) === PLAYER_RECOIL_FRAME) {
      this.anims.stop();
      this.setFrame(0);
    }
  }

  private die(): void {
    this.dead = true;
    this.anims.stop();
    this.setVelocity(0, 0);
    this.setAlpha(1);
    this.setTint(0x4a4a4a);
  }

  /**
   * Steer the velocity toward the input at a fixed rate: full speed in ACCEL_MS, a stop in
   * DECEL_MS. The target is normalized first, so diagonals stay at PLAYER_SPEED.
   */
  private updateMovement(dt: number): void {
    steer(this.keys, PLAYER_SPEED, this.moveDir);
    const body = this.body as Phaser.Physics.Arcade.Body;
    this.velocity.copy(body.velocity);
    approach(this.velocity, this.moveDir, PLAYER_SPEED, ACCEL_MS, DECEL_MS, dt);
    this.setVelocity(this.velocity.x, this.velocity.y);
  }

  private updateAim(): void {
    pointerInWorld(this.scene, this.aimPoint);
    this.setRotation(Phaser.Math.Angle.Between(this.x, this.y, this.aimPoint.x, this.aimPoint.y));
  }
}
