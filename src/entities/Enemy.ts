import Phaser from 'phaser';
import { ENEMIES, ENEMY_KINDS, type EnemyDef, type EnemyKind } from './enemies';

/** Emitted on the enemy, with the enemy as its argument, the one time it dies. */
export const ENEMY_DIED = 'enemy-died';

const HIT_FLASH_MS = 70;
const DEATH_FADE_MS = 180;

const textureKey = (kind: EnemyKind) => `enemy-${kind}`;
/** Square texture big enough for the body and the arms reaching past it. */
const textureSize = (def: EnemyDef) => 2 * Math.ceil(def.radius * 1.5 + 4);

/**
 * One enemy of any type; its `def` from `ENEMIES` sets every stat. Faces where it walks, with
 * arms reaching along +x (rotation 0).
 */
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  readonly def: EnemyDef;
  private hp: number;
  private dead = false;

  /** Draws one placeholder texture per enemy type: a body circle with two arms. */
  static createTextures(scene: Phaser.Scene): void {
    for (const kind of ENEMY_KINDS) {
      const def = ENEMIES[kind];
      const size = textureSize(def);
      const c = size / 2;
      const r = def.radius;
      const armWidth = Math.max(4, Math.round(r / 3));
      const armReach = Math.round(r * 0.4);
      const armSpread = Math.round(r * 0.67);
      const g = scene.make.graphics({}, false);
      g.fillStyle(def.look.arms);
      g.fillRect(c + armReach, c - armSpread, r + 1, armWidth);
      g.fillRect(c + armReach, c + armSpread - armWidth, r + 1, armWidth);
      g.fillStyle(def.look.body);
      g.fillCircle(c, c, r);
      if (def.look.ring !== undefined) {
        g.lineStyle(2, def.look.ring);
        g.strokeCircle(c, c, r - 1);
      }
      g.generateTexture(textureKey(kind), size, size);
      g.destroy();
    }
  }

  constructor(scene: Phaser.Scene, x: number, y: number, kind: EnemyKind) {
    super(scene, x, y, textureKey(kind));
    this.def = ENEMIES[kind];
    this.hp = this.def.maxHp;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const offset = textureSize(this.def) / 2 - this.def.radius;
    this.setCircle(this.def.radius, offset, offset);
    this.setCollideWorldBounds(true);
    // Below bullets and the player: an enemy on top of the player hid its hit flash.
    this.setDepth(1);
  }

  get kind(): EnemyKind {
    return this.def.kind;
  }

  get radius(): number {
    return this.def.radius;
  }

  get contactDamage(): number {
    return this.def.contactDamage;
  }

  get coinReward(): number {
    return this.def.coinReward;
  }

  get health(): number {
    return this.hp;
  }

  get isDead(): boolean {
    return this.dead;
  }

  /**
   * Head straight for *target* at this type's speed. Pathfinding is the caller's: it passes
   * the next waypoint around the walls, and the physics separation lets the enemy slide along
   * any it grazes.
   */
  pursue(target: { x: number; y: number }): void {
    if (this.dead) return;
    const angle = Phaser.Math.Angle.Between(this.x, this.y, target.x, target.y);
    this.setRotation(angle);
    this.setVelocity(Math.cos(angle) * this.def.speed, Math.sin(angle) * this.def.speed);
  }

  halt(): void {
    if (!this.dead) this.setVelocity(0, 0);
  }

  /** Apply *amount* damage. Returns whether it landed; a dead enemy takes none. */
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
   * The body is disabled at once, so nothing can hit or be hurt by a dying enemy; the sprite
   * fades out and is destroyed, which also removes it from every group it is in and drops its
   * listeners. Only reachable once: `takeDamage` ignores a dead enemy, so however many pellets
   * land in the same step, the death and its reward happen one time.
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
    this.emit(ENEMY_DIED, this);
  }
}
