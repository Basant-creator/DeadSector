import Phaser from 'phaser';

/** The basic enemy: slow, pursues the player in a straight line, hurts on contact. */
export const WALKER_STATS = {
  maxHp: 30,
  /** px/s. */
  speed: 45,
  contactDamage: 10,
  /** Coins the run earns when one dies. */
  coinReward: 4,
} as const;

/** Emitted on the Walker, with the Walker as its argument, the one time it dies. */
export const WALKER_DIED = 'walker-died';

const TEXTURE_KEY = 'walker';
const TEXTURE_SIZE = 48;
const BODY_RADIUS = 15;
const HIT_FLASH_MS = 70;
const DEATH_FADE_MS = 180;

/** Placeholder Walker. Faces where it walks; arms reach along +x (rotation 0). */
export class Walker extends Phaser.Physics.Arcade.Sprite {
  readonly contactDamage = WALKER_STATS.contactDamage;
  readonly coinReward = WALKER_STATS.coinReward;
  private hp: number = WALKER_STATS.maxHp;
  private dead = false;

  static createTexture(scene: Phaser.Scene): void {
    const c = TEXTURE_SIZE / 2;
    const g = scene.make.graphics({}, false);
    g.fillStyle(0x6e3329);
    g.fillRect(c + 6, c - 10, 16, 5);
    g.fillRect(c + 6, c + 5, 16, 5);
    g.fillStyle(0x9c4a3c);
    g.fillCircle(c, c, BODY_RADIUS);
    g.generateTexture(TEXTURE_KEY, TEXTURE_SIZE, TEXTURE_SIZE);
    g.destroy();
  }

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, TEXTURE_KEY);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const offset = TEXTURE_SIZE / 2 - BODY_RADIUS;
    this.setCircle(BODY_RADIUS, offset, offset);
    this.setCollideWorldBounds(true);
    // Below bullets and the player: a Walker on top of the player hid its hit flash.
    this.setDepth(1);
  }

  get health(): number {
    return this.hp;
  }

  get isDead(): boolean {
    return this.dead;
  }

  /**
   * Head straight for *target*. No pathfinding: walls stop it, and the physics separation
   * lets it slide along a wall it meets at an angle.
   */
  pursue(target: { x: number; y: number }): void {
    if (this.dead) return;
    const angle = Phaser.Math.Angle.Between(this.x, this.y, target.x, target.y);
    this.setRotation(angle);
    this.setVelocity(Math.cos(angle) * WALKER_STATS.speed, Math.sin(angle) * WALKER_STATS.speed);
  }

  halt(): void {
    if (!this.dead) this.setVelocity(0, 0);
  }

  /** Apply *amount* damage. Returns whether it landed; a dead Walker takes none. */
  takeDamage(amount: number): boolean {
    if (this.dead) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp === 0) {
      this.die();
      return true;
    }
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(HIT_FLASH_MS, () => {
      if (this.scene && !this.dead) this.clearTint();
    });
    return true;
  }

  /**
   * The body is disabled at once, so nothing can hit or be hurt by a dying Walker; the
   * sprite fades out and is destroyed, which also removes it from every group it is in and
   * drops its listeners. Only reachable once: `takeDamage` ignores a dead Walker.
   */
  private die(): void {
    this.dead = true;
    this.setVelocity(0, 0);
    this.disableBody(false, false);
    this.setTint(0x3a1d18);
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scale: 0.6,
      duration: DEATH_FADE_MS,
      onComplete: () => this.destroy(),
    });
    this.emit(WALKER_DIED, this);
  }
}
