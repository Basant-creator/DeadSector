import Phaser from 'phaser';
import { LAYER, WORLD_ART_SCALE } from '../art/layers';
import { PALETTE } from '../art/palette';
import { muzzleKey } from '../art/props';
import type { WeaponId } from '../combat/weapons';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { MAP_COLS, MAP_ROWS, TILE } from '../world/cityMap';

interface Live {
  sprite: Phaser.GameObjects.Sprite;
  startedAt: number;
  durationMs: number;
  frames: number;
  /** Fades out over its life when true, from `alpha`. */
  fade: boolean;
  alpha: number;
}

/** Most short-lived effect sprites alive at once; beyond it the oldest is reused. */
const POOL_SIZE = 64;
/** How far the muzzle light reaches, as a scale of the 128 px light texture. */
const MUZZLE_LIGHT: Readonly<Record<WeaponId, number>> = { pistol: 1, shotgun: 1.7, rifle: 0.8 };
const HURT_FLASH_MS = 220;

/**
 * Combat presentation only: muzzle flashes, sparks, blood, splat decals and the hurt flash. The
 * scene calls it after the gameplay has decided what happened; nothing here feeds back into
 * gameplay. Sprites are pooled and animated from `update(now)`, with no timers or tweens, and
 * splats are stamped into one decal texture, so a long fight costs nothing extra to draw.
 */
export class Fx {
  private readonly scene: Phaser.Scene;
  private readonly pool: Live[] = [];
  private next = 0;
  private readonly decals: Phaser.GameObjects.RenderTexture;
  private readonly hurt: Phaser.GameObjects.Rectangle;
  private hurtAt = -Infinity;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const w = (MAP_COLS * TILE) / WORLD_ART_SCALE;
    const h = (MAP_ROWS * TILE) / WORLD_ART_SCALE;
    this.decals = scene.add.renderTexture(0, 0, w, h).setOrigin(0).setScale(WORLD_ART_SCALE).setDepth(LAYER.decals);
    this.decals.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    scene.add.image(0, 0, 'fx-vignette').setOrigin(0).setScale(GAME_WIDTH / 640, GAME_HEIGHT / 360)
      .setScrollFactor(0).setDepth(LAYER.vignette);
    this.hurt = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0xc81e1e).setOrigin(0)
      .setScrollFactor(0).setDepth(LAYER.hurtFlash).setAlpha(0).setVisible(false);
  }

  muzzle(x: number, y: number, angle: number, weapon: WeaponId): void {
    const s = this.spawn(muzzleKey(weapon), x, y, weapon === 'rifle' ? 50 : 70, 2, false);
    s.sprite.setOrigin(0, 0.5).setRotation(angle).setBlendMode(Phaser.BlendModes.ADD);
    // A brief warm light on the ground and walls around the shot.
    const light = this.spawn('fx-light', x, y, 60, 1, true);
    light.sprite.setBlendMode(Phaser.BlendModes.ADD).setTint(PALETTE.amber).setScale(MUZZLE_LIGHT[weapon]).setAlpha(0.5);
    light.alpha = 0.5;
  }

  /** A bullet stopped by a wall. */
  impact(x: number, y: number): void {
    this.spawn('fx-spark', x, y, 140, 3, true).sprite.setBlendMode(Phaser.BlendModes.ADD);
  }

  /** A bullet travelling at *angle* hit an enemy: a white pop where it struck, blood behind. */
  blood(x: number, y: number, angle: number, heavy = false): void {
    const pop = this.spawn('fx-spark', x, y, 90, 3, true);
    pop.sprite.setTint(0xffffff).setScale(heavy ? 1.6 : 1);
    const s = this.spawn('fx-blood', x, y, 200, 3, true);
    s.sprite.setOrigin(0.15, 0.5).setRotation(angle).setScale(heavy ? 1.5 : 1);
    this.stamp(x + Math.cos(angle) * 10, y + Math.sin(angle) * 10, Math.floor(Math.random() * 4), 0.8);
  }

  /** An enemy of body *radius* died at (x, y): blood thrown all round, a pool left behind. */
  death(x: number, y: number, radius: number): void {
    const size = radius / 15;
    const sprays = radius >= 20 ? 6 : 4;
    const turn = Math.random() * Math.PI * 2;
    for (let i = 0; i < sprays; i++) {
      const s = this.spawn('fx-blood', x, y, 260, 3, true);
      s.sprite.setOrigin(0.1, 0.5).setRotation(turn + (i / sprays) * Math.PI * 2).setScale(size);
    }
    this.stamp(x, y, 4 + Math.floor(Math.random() * 2), 0.9, size);
  }

  /** The player took a hit. */
  playerHurt(): void {
    this.hurtAt = this.scene.time.now;
  }

  update(now: number): void {
    for (const live of this.pool) {
      if (!live.sprite.visible) continue;
      const t = (now - live.startedAt) / live.durationMs;
      if (t >= 1) {
        live.sprite.setVisible(false);
        continue;
      }
      live.sprite.setFrame(Math.min(live.frames - 1, Math.floor(t * live.frames)));
      if (live.fade) live.sprite.setAlpha(live.alpha * (1 - t * t));
    }
    const h = (now - this.hurtAt) / HURT_FLASH_MS;
    const showHurt = h >= 0 && h < 1;
    this.hurt.setVisible(showHurt);
    if (showHurt) this.hurt.setAlpha(0.28 * (1 - h));
  }

  private spawn(key: string, x: number, y: number, durationMs: number, frames: number, fade: boolean): Live {
    let live = this.pool.find((l) => !l.sprite.visible);
    if (!live) {
      if (this.pool.length < POOL_SIZE) {
        live = { sprite: this.scene.add.sprite(0, 0, key).setDepth(LAYER.effects), startedAt: 0, durationMs: 0, frames: 1, fade: false, alpha: 1 };
        this.pool.push(live);
      } else {
        live = this.pool[this.next];
        this.next = (this.next + 1) % POOL_SIZE;
      }
    }
    live.sprite.setTexture(key, 0).setPosition(x, y).setVisible(true).setAlpha(1).setRotation(0).setOrigin(0.5)
      .setScale(1).clearTint().setBlendMode(Phaser.BlendModes.NORMAL);
    Object.assign(live, { startedAt: this.scene.time.now, durationMs, frames, fade, alpha: 1 });
    return live;
  }

  private stamp(x: number, y: number, frame: number, alpha: number, scale = 1): void {
    this.decals.stamp('fx-splat', frame, x / WORLD_ART_SCALE, y / WORLD_ART_SCALE, {
      alpha, scale, rotation: Math.random() * Math.PI * 2,
    });
  }
}
