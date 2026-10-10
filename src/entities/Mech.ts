import Phaser from 'phaser';
import { MECH_HULL, MECH_TURRET, MECH_TURRET_FRAME, MECH_WALK } from '../art/mechArt';
import { Weapon } from '../combat/Weapon';
import { MECH } from '../mech/mechRules';
import { approach, type MoveKeys, moveKeys, pointerInWorld, steer } from './Player';

/**
 * - dormant: in its bay, not yet paid for.
 * - piloted: the player is inside; energy drains.
 * - parked: the player climbed out by choice; it keeps its hull and energy for later.
 * - depleted: out of energy, for good.
 * - destroyed: hull at zero, for good.
 */
export type MechState = 'dormant' | 'piloted' | 'parked' | 'depleted' | 'destroyed';

/** Why a stomp did or did not go off. */
export type StompResult = 'ok' | 'cooldown' | 'energy' | 'inactive';

/** How fast the hull turns to face where it walks, in rad/ms. */
const HULL_TURN = 0.008;
const HIT_FLASH_MS = 80;
const RECOIL_MS = 90;
/**
 * Piloted, the mech stands with the player's layer (enemies 1, bullets 2, player 3). Powered
 * down it is scenery: under the player, so the pilot climbing out is never hidden by it.
 */
const DEPTH = { piloted: 3, idle: 2.8 } as const;
/** Art frame size of both sheets (src/art/mechArt.ts): 40 art px = 80 px. */
const TEXTURE_SIZE = 80;

/**
 * The mech: a walking hull with its own physics body, and a turret that aims at the cursor. Its
 * state is all its own; the scene decides what the player does when it changes (climb in, climb
 * out, be thrown clear). Timed from `now` passed in, with no Phaser timers, so a restart leaves
 * nothing behind.
 *
 * Its body only exists while piloted: in its bay, parked or wrecked it is scenery that nothing
 * collides with, and enemies keep chasing the player.
 */
export class Mech extends Phaser.Physics.Arcade.Sprite {
  readonly turret: Phaser.GameObjects.Sprite;
  readonly cannon = new Weapon(MECH.cannon);
  private mode: MechState = 'dormant';
  private hp = MECH.maxHp;
  private charge = MECH.energy.max;
  private invulnerableUntil = 0;
  private stompReadyAt = 0;
  private boardedAt = -Infinity;
  private lastUpdateAt = 0;
  private recoilUntil = 0;
  /** Which barrel fires next: -1 left, 1 right. */
  private barrel = 1;
  private readonly keys: MoveKeys;
  private readonly moveDir = new Phaser.Math.Vector2();
  private readonly velocity = new Phaser.Math.Vector2();
  private readonly aimPoint = new Phaser.Math.Vector2();

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, MECH_HULL);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const offset = TEXTURE_SIZE / 2 - MECH.radius;
    this.setCircle(MECH.radius, offset, offset);
    this.setCollideWorldBounds(true);
    const body = this.body as Phaser.Physics.Arcade.Body;
    // Enemies that walk into it are pushed aside; it is never pushed back.
    body.pushable = false;
    this.disableBody(false, false);
    this.setDepth(DEPTH.idle);
    // Facing north, toward the facility gate.
    this.setRotation(-Math.PI / 2);
    this.turret = scene.add.sprite(x, y, MECH_TURRET, MECH_TURRET_FRAME.dark).setDepth(DEPTH.idle + 0.05).setRotation(-Math.PI / 2);
    this.keys = moveKeys(scene);
  }

  get status(): MechState {
    return this.mode;
  }

  get isPiloted(): boolean {
    return this.mode === 'piloted';
  }

  /** Parked by choice: the player can climb back in, for free. */
  get canBoard(): boolean {
    return this.mode === 'parked';
  }

  get health(): number {
    return this.hp;
  }

  get energy(): number {
    return this.charge;
  }

  /** Direction the cannons point, in radians. */
  get aimAngle(): number {
    return this.turret.rotation;
  }

  stompCooldownLeft(now: number): number {
    return Math.max(0, this.stompReadyAt - now);
  }

  /** Bring a dormant mech online with the player inside. Only once: returns false otherwise. */
  activate(now: number): boolean {
    if (this.mode !== 'dormant') return false;
    this.powerUp(now);
    return true;
  }

  /** Climb back into a parked mech. */
  board(now: number): boolean {
    if (this.mode !== 'parked') return false;
    this.powerUp(now);
    return true;
  }

  /** Climb out by choice, keeping hull and energy. Not in the first moment after boarding. */
  climbOut(now: number): boolean {
    if (this.mode !== 'piloted' || now - this.boardedAt < MECH.boardLockMs) return false;
    this.powerDown('parked');
    return true;
  }

  /** One frame of piloting: walk, aim, and burn energy for the time that passed. */
  update(now: number): void {
    if (this.mode !== 'piloted') return;
    const dt = Phaser.Math.Clamp(now - this.lastUpdateAt, 0, 50);
    this.lastUpdateAt = now;

    steer(this.keys, MECH.speed, this.moveDir);
    const body = this.body as Phaser.Physics.Arcade.Body;
    this.velocity.copy(body.velocity);
    approach(this.velocity, this.moveDir, MECH.speed, MECH.accelMs, MECH.decelMs, dt);
    this.setVelocity(this.velocity.x, this.velocity.y);
    // The legs turn toward where they walk; the cabin aims on its own.
    if (this.moveDir.lengthSq() > 0) {
      this.setRotation(Phaser.Math.Angle.RotateTo(this.rotation, this.moveDir.angle(), HULL_TURN * dt));
      this.anims.play(MECH_WALK, true);
    } else if (this.anims.isPlaying) {
      this.anims.stop();
      this.setFrame(0);
    }
    pointerInWorld(this.scene, this.aimPoint);
    this.turret.setRotation(Phaser.Math.Angle.Between(this.x, this.y, this.aimPoint.x, this.aimPoint.y));
    this.turret.setFrame(now < this.recoilUntil ? MECH_TURRET_FRAME.recoil : MECH_TURRET_FRAME.lit);

    this.drain((MECH.energy.drainPerSecond * dt) / 1000);
  }

  /**
   * Fire the next barrel into *pool* if the cannon is ready. Returns where the shot left (the
   * barrel tip, for the flash) or null. The round itself starts beside the centre, level with
   * its barrel, so an enemy pressed against the hull is still hit.
   */
  fire(now: number, pool: Phaser.Physics.Arcade.Group): { x: number; y: number; angle: number } | null {
    if (this.mode !== 'piloted') return null;
    const angle = this.aimAngle;
    const { forward, side } = MECH.muzzle;
    const sx = -Math.sin(angle) * side * this.barrel;
    const sy = Math.cos(angle) * side * this.barrel;
    if (!this.cannon.tryFire(now, pool, this.x + sx, this.y + sy, angle, forward)) return null;
    this.barrel = -this.barrel;
    this.recoilUntil = now + RECOIL_MS;
    this.drain(MECH.energy.perShot);
    return { x: this.x + sx + Math.cos(angle) * forward, y: this.y + sy + Math.sin(angle) * forward, angle };
  }

  /** Space: start a stomp if it is ready and there is the energy for it. The scene deals the blow. */
  stomp(now: number): StompResult {
    if (this.mode !== 'piloted') return 'inactive';
    if (now < this.stompReadyAt) return 'cooldown';
    if (this.charge < MECH.stomp.energy) return 'energy';
    this.stompReadyAt = now + MECH.stomp.cooldownMs;
    this.drain(MECH.stomp.energy);
    return 'ok';
  }

  /**
   * Take *amount* on the hull unless it was hit a moment ago. Returns whether it landed; at zero
   * the mech is destroyed.
   */
  takeDamage(amount: number, now: number): boolean {
    if (this.mode !== 'piloted' || now < this.invulnerableUntil) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.invulnerableUntil = now + MECH.invulnerableMs;
    if (this.hp === 0) {
      this.powerDown('destroyed');
      return true;
    }
    this.setTintFill(0xff5544);
    this.turret.setTintFill(0xff5544);
    this.scene.time.delayedCall(HIT_FLASH_MS, () => {
      // Powering down sets its own look.
      if (!this.scene || this.mode !== 'piloted') return;
      this.clearTint();
      this.turret.clearTint();
    });
    return true;
  }

  /** A hit-stop held the fight for *ms*: no timer of the mech's loses that time. */
  shiftTimers(ms: number): void {
    this.invulnerableUntil += ms;
    this.stompReadyAt += ms;
    this.boardedAt += ms;
    this.lastUpdateAt += ms;
    this.recoilUntil += ms;
    this.cannon.shiftTimers(ms);
  }

  halt(): void {
    if (this.body?.enable) this.setVelocity(0, 0);
    this.anims.stop();
  }

  override preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    // The turret rides on the hull wherever physics put it last.
    this.turret.setPosition(this.x, this.y);
  }

  override destroy(fromScene?: boolean): void {
    this.turret.destroy();
    super.destroy(fromScene);
  }

  private drain(amount: number): void {
    if (this.mode !== 'piloted') return;
    this.charge = Math.max(0, this.charge - amount);
    if (this.charge === 0) this.powerDown('depleted');
  }

  private powerUp(now: number): void {
    this.mode = 'piloted';
    this.boardedAt = now;
    this.lastUpdateAt = now;
    this.enableBody(true, this.x, this.y, true, true);
    this.velocity.set(0, 0);
    this.clearTint().setDepth(DEPTH.piloted);
    this.turret.clearTint().setFrame(MECH_TURRET_FRAME.lit).setDepth(DEPTH.piloted + 0.05);
  }

  private powerDown(next: 'parked' | 'depleted' | 'destroyed'): void {
    this.mode = next;
    this.anims.stop();
    this.setFrame(0);
    this.setVelocity(0, 0);
    this.disableBody(false, false);
    this.clearTint().setDepth(DEPTH.idle);
    this.turret.clearTint().setFrame(MECH_TURRET_FRAME.dark).setDepth(DEPTH.idle + 0.05);
    if (next === 'destroyed') {
      // A burned-out wreck.
      this.setTint(0x3a3430);
      this.turret.setTint(0x3a3430);
    } else if (next === 'depleted') {
      this.setTint(0x8a8a8a);
      this.turret.setTint(0x8a8a8a);
    }
  }
}
