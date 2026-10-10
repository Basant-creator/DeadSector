import Phaser from 'phaser';
import { WEAPON_IDS, WEAPONS, type WeaponDef } from '../combat/weapons';
import { ENEMY_KINDS, type EnemyKind } from '../entities/enemies';
import { PALETTE, ZOMBIE_COLORS } from './palette';
import { addSheet, PixelArt, seeded } from './pixels';

/**
 * Top-down character sprite sheets, drawn facing +x (the game rotates them to aim and walk).
 * Every art pixel is 2 world pixels. Each sheet is a 4-frame walk cycle; frame 0 doubles as
 * the standing pose. A soft shadow is drawn centred under each figure, so it reads the same
 * at any rotation.
 */
export const CHARACTER_SCALE = 2;
const WALK_PHASES = [0, 1, 0, -1];

/** Frame rates of the walk cycles; faster movers step faster. */
const ENEMY_WALK_FPS: Record<EnemyKind, number> = { walker: 5, runner: 12, brute: 4, elite: 8, giant: 3 };

export const playerTextureKey = (weapon: WeaponDef) => `player-${weapon.id}`;
/** Frame of each player sheet showing the gun kicked back, held briefly after a shot. */
export const PLAYER_RECOIL_FRAME = 4;
/** How far the gun and hands kick back in the recoil frame, in art px. */
const RECOIL_PULL: Record<WeaponDef['id'], number> = { pistol: 1, shotgun: 2, rifle: 1 };
export const playerWalkAnim = (weapon: WeaponDef) => `player-${weapon.id}-walk`;
export const enemyTextureKey = (kind: EnemyKind) => `enemy-${kind}`;
export const enemyWalkAnim = (kind: EnemyKind) => `enemy-${kind}-walk`;

/** Art size of each enemy's frame, in art pixels; the body radius is set in `ENEMIES`. */
const ENEMY_FRAME: Record<EnemyKind, number> = { walker: 24, runner: 20, brute: 32, elite: 26, giant: 44 };
/** Art size of the player's frame: 32 art px = the player's 64 px texture. */
const PLAYER_FRAME = 32;

export function createCharacterArt(scene: Phaser.Scene): void {
  for (const id of WEAPON_IDS) {
    const def = WEAPONS[id];
    const frames = [...WALK_PHASES.map((phase) => playerFrame(def, phase, 0)), playerFrame(def, 0, RECOIL_PULL[id])];
    addSheet(scene, playerTextureKey(def), frames, CHARACTER_SCALE);
    scene.anims.create({
      key: playerWalkAnim(def),
      frames: scene.anims.generateFrameNumbers(playerTextureKey(def), { start: 0, end: 3 }),
      frameRate: 10,
      repeat: -1,
    });
  }
  for (const kind of ENEMY_KINDS) {
    addSheet(scene, enemyTextureKey(kind), WALK_PHASES.map((phase) => zombieFrame(kind, phase)), CHARACTER_SCALE);
    scene.anims.create({
      key: enemyWalkAnim(kind),
      frames: scene.anims.generateFrameNumbers(enemyTextureKey(kind), { start: 0, end: 3 }),
      frameRate: ENEMY_WALK_FPS[kind],
      repeat: -1,
    });
  }
}

/** A frame with a soft round shadow, the outlined *figure* on top. */
function withShadow(figure: PixelArt, shadowRadius: number): PixelArt {
  const frame = new PixelArt(figure.width, figure.height);
  const c = figure.width / 2;
  frame.disc(c, c, shadowRadius + 1, PALETTE.shadow, 40);
  frame.disc(c, c, shadowRadius, PALETTE.shadow, 60);
  figure.outline(PALETTE.outline);
  frame.over(figure);
  return frame;
}

function playerFrame(weapon: WeaponDef, phase: number, recoil: number): PixelArt {
  const S = PLAYER_FRAME;
  const c = S / 2;
  // In the recoil frame the gun, hands and arms come back toward the body.
  const g = c - recoil;
  const f = new PixelArt(S, S);
  const p = PALETTE;
  // Feet, stepping.
  f.rect(c - 2 + phase * 2, c - 5, 3, 2, 0x1a1a20);
  f.rect(c - 2 - phase * 2, c + 3, 3, 2, 0x1a1a20);
  // Shoulders: a light jacket, lit from the top.
  f.ellipse(c - 1, c, 4.5, 7, p.playerJacketShade);
  f.ellipse(c - 1, c - 0.8, 4, 6.2, p.playerJacket);
  // Arms reaching to the grip.
  f.line(c, c - 5, g + 5, c - 1, p.playerJacketShade);
  f.line(c, c - 6, g + 5, c - 2, p.playerJacket);
  f.line(c, c + 5, g + 5, c + 1, p.playerJacketShade);
  f.line(c, c + 6, g + 5, c + 2, p.playerJacket);
  drawGun(f, weapon, g, c);
  f.rect(g + 5, c - 1, 2, 2, p.playerSkin);
  f.rect(g + 5, c + 1, 1, 1, p.playerSkin);
  // Head: dark hair seen from above, a face edge forward, cyan headphones.
  f.disc(c, c, 3.6, p.playerHair);
  f.rect(c + 2, c - 1, 2, 2, p.playerSkin);
  f.px(c - 1, c - 4, p.playerAccent);
  f.px(c, c - 4, p.playerAccent);
  f.px(c - 1, c + 3, p.playerAccent);
  f.px(c, c + 3, p.playerAccent);
  return withShadow(f, 7);
}

/**
 * The weapon in the player's hands, its tip at the muzzle offset the game fires from. *x* is
 * where the hands are (pulled back in the recoil frame), *c* the frame centre.
 */
function drawGun(f: PixelArt, weapon: WeaponDef, x: number, c: number): void {
  const p = PALETTE;
  const tip = x + Math.round((6 + weapon.barrel.length) / CHARACTER_SCALE) - 1;
  if (weapon.id === 'pistol') {
    f.rect(x + 5, c - 1, tip - x - 4, 2, p.gunMetal);
    f.rect(x + 5, c - 1, tip - x - 4, 1, 0x50565e);
  } else if (weapon.id === 'shotgun') {
    f.rect(x + 1, c - 1, 4, 3, p.gunWood);
    f.rect(x + 5, c - 1, tip - x - 4, 2, p.gunDark);
    f.rect(x + 8, c - 1, 3, 3, p.gunWood);
  } else {
    f.rect(x + 1, c - 1, 3, 2, p.gunDark);
    f.rect(x + 4, c - 1, 6, 3, p.gunMetal);
    f.rect(x + 7, c + 2, 2, 2, p.gunDark);
    f.rect(x + 10, c - 1, tip - x - 9, 2, p.gunDark);
  }
}

interface ZombieShape {
  /** Body radius in art px (half the world radius). */
  r: number;
  torso: [rx: number, ry: number];
  arm: { width: number; reach: number; spread: number };
  head: { r: number; forward: number };
}

const SHAPES: Record<EnemyKind, ZombieShape> = {
  walker: { r: 7.5, torso: [4, 7], arm: { width: 2, reach: 8.5, spread: 5 }, head: { r: 3.2, forward: 2 } },
  runner: { r: 6, torso: [3, 5.5], arm: { width: 2, reach: -2, spread: 6 }, head: { r: 2.8, forward: 2.5 } },
  brute: { r: 10, torso: [6.2, 9.5], arm: { width: 4, reach: 9, spread: 7.5 }, head: { r: 3.6, forward: 2.5 } },
  elite: { r: 8, torso: [4.4, 7.4], arm: { width: 2, reach: 9.5, spread: 5.5 }, head: { r: 3.3, forward: 2.5 } },
  giant: { r: 13, torso: [10, 13.5], arm: { width: 4, reach: 11, spread: 10 }, head: { r: 3.8, forward: 7 } },
};

function zombieFrame(kind: EnemyKind, phase: number): PixelArt {
  const S = ENEMY_FRAME[kind];
  const c = S / 2;
  const shape = SHAPES[kind];
  const col = ZOMBIE_COLORS[kind];
  const rand = seeded(kind.length * 97 + S);
  const f = new PixelArt(S, S);
  const [rx, ry] = shape.torso;

  // Feet shuffling under the body.
  const stride = kind === 'runner' ? 3 : 2;
  f.rect(c - 2 + phase * stride, c - ry * 0.5 - 1, 3, 2, 0x1c1c18);
  f.rect(c - 2 - phase * stride, c + ry * 0.5 - 1, 3, 2, 0x1c1c18);

  if (kind === 'giant') {
    // A hunched mass: the hump behind, bone spurs along the spine.
    f.ellipse(c - 1, c, rx, ry, col.clothesShade);
    f.ellipse(c - 1, c - 0.5, rx - 1, ry - 1.2, col.clothes);
    f.ellipse(c - 3, c, rx * 0.7, ry * 0.68, col.skinShade);
    f.ellipse(c - 3.5, c - 0.6, rx * 0.6, ry * 0.58, col.skin);
    for (const [x, y, w, h] of [[c - 6, c - 6, 4, 4], [c - 1, c + 3, 3, 4], [c - 8, c + 2, 3, 3]] as const) {
      f.rect(x, y, w, h, PALETTE.flesh);
    }
    for (let i = -2; i <= 2; i++) f.line(c - 9, c + i * 3, c - 12, c + i * 3 - 1, PALETTE.bone);
  } else {
    f.ellipse(c - 1, c, rx, ry, col.clothesShade);
    f.ellipse(c - 1, c - 0.6, rx - 0.6, ry - 0.8, col.clothes);
    // Torn, bloodied clothes.
    for (let i = 0; i < 4 + shape.r; i++) {
      const x = c - 1 + (rand() - 0.5) * rx * 1.6;
      const y = c + (rand() - 0.5) * ry * 1.6;
      f.px(x, y, rand() < 0.6 ? PALETTE.bloodDark : col.clothesShade);
    }
    if (kind === 'elite') {
      // Armour plates across the shoulders.
      f.rect(c - 3, c - ry + 2, 3, 3, PALETTE.metal);
      f.rect(c - 3, c + ry - 5, 3, 3, PALETTE.metal);
      f.rect(c - 4, c - 1, 2, 2, PALETTE.metalDark);
    }
  }

  // Arms: reaching forward, or swinging behind for the Runner.
  const { width, reach, spread } = shape.arm;
  for (const side of [-1, 1]) {
    const swing = side * phase;
    const sx = c;
    const sy = c + side * spread * 0.8;
    const ex = reach >= 0 ? c + reach + swing : c + reach + swing * 2;
    const ey = c + side * (reach >= 0 ? spread * 0.65 : spread * 1.05);
    const thick = kind === 'giant' && side === 1 ? width + 2 : width;
    for (let t = 0; t < thick; t++) {
      const o = t - (thick - 1) / 2;
      f.line(sx, sy + o, ex, ey + o, t === 0 ? col.skinShade : col.skin);
    }
    if (kind === 'giant' && side === 1) {
      // The club arm ends in an oversized fist.
      f.disc(ex + 1, ey, 3.4, col.skinShade);
      f.disc(ex + 0.5, ey - 0.5, 2.6, col.skin);
      f.px(ex + 3, ey - 1, PALETTE.bone);
    } else {
      f.px(ex + 1, ey, kind === 'elite' ? PALETTE.bone : col.skinShade);
    }
  }

  // Head forward on the shoulders; scalp blotches; eyes for the glowing types.
  const hx = c + shape.head.forward;
  f.disc(hx, c, shape.head.r + 0.5, col.skinShade);
  f.disc(hx - 0.4, c - 0.4, shape.head.r, col.skin);
  for (let i = 0; i < 3; i++) f.px(hx - 1 + rand() * 2, c - 1.5 + rand() * 3, col.skinShade);
  f.px(hx + shape.head.r - 0.5, c - 1, 0x1a1410);
  f.px(hx + shape.head.r - 0.5, c + 1, 0x1a1410);
  if ('glow' in col) {
    f.px(hx + shape.head.r - 0.5, c - 1, col.glow);
    f.px(hx + shape.head.r - 0.5, c + 1, col.glow);
  }
  return withShadow(f, shape.r);
}
