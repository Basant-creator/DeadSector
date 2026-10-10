import Phaser from 'phaser';
import { MECH } from '../mech/mechRules';
import { CHARACTER_SCALE } from './characters';
import { PALETTE } from './palette';
import { addSheet, PixelArt } from './pixels';

/**
 * The mech, top-down and facing +x like the characters, in two sheets so the cabin can aim
 * while the legs walk another way:
 * - hull: hips and two big feet, a 4-frame walk cycle (frame 0 standing);
 * - turret: the cabin and twin cannons, frames lit, recoil (barrels kicked back) and dark
 *   (powered down: in its bay, parked, or out of energy).
 * Same frame size for both, so they share a centre. Every art pixel is 2 world pixels.
 */
export const MECH_HULL = 'mech-hull';
export const MECH_TURRET = 'mech-turret';
export const MECH_WALK = 'mech-walk';
export const MECH_TURRET_FRAME = { lit: 0, recoil: 1, dark: 2 } as const;

const FRAME = 40;
const c = FRAME / 2;
const WALK_PHASES = [0, 1, 0, -1];

const COLORS = {
  plate: 0xb08a2a,
  plateShade: 0x86681e,
  plateLight: 0xd0a83c,
  frame: 0x4a5058,
  frameDark: 0x2e3238,
  foot: 0x3a3e44,
  footTop: 0x50565e,
  gun: 0x2a2d32,
  gunLight: 0x5a6068,
  glassLit: PALETTE.cyan,
  glassDark: 0x1e3038,
} as const;

export function createMechArt(scene: Phaser.Scene): void {
  addSheet(scene, MECH_HULL, WALK_PHASES.map(hullFrame), CHARACTER_SCALE);
  scene.anims.create({
    key: MECH_WALK,
    frames: scene.anims.generateFrameNumbers(MECH_HULL, { start: 0, end: 3 }),
    frameRate: 6,
    repeat: -1,
  });
  addSheet(scene, MECH_TURRET, [turretFrame(true, 0), turretFrame(true, 2), turretFrame(false, 0)], CHARACTER_SCALE);
}

function hullFrame(phase: number): PixelArt {
  const f = new PixelArt(FRAME, FRAME);
  const shadow = new PixelArt(FRAME, FRAME);
  shadow.disc(c, c, 16, PALETTE.shadow, 40);
  shadow.disc(c, c, 15, PALETTE.shadow, 60);
  const step = phase * 3;
  // Legs from the hips to each foot.
  for (const side of [-1, 1]) {
    const fx = c - 1 + side * step;
    const fy = c + side * 11;
    f.line(c, c + side * 4, fx, fy, COLORS.frameDark);
    f.line(c + 1, c + side * 4, fx + 1, fy, COLORS.frame);
    // Foot: a heavy pad with an amber toe plate.
    f.rect(fx - 5, fy - 2, 11, 5, COLORS.foot);
    f.rect(fx - 5, fy - 2, 11, 1, COLORS.footTop);
    f.rect(fx + 4, fy - 2, 2, 5, PALETTE.hazardAmber);
  }
  // Hips.
  f.rect(c - 5, c - 6, 10, 12, COLORS.frame);
  f.rect(c - 5, c - 6, 10, 1, COLORS.footTop);
  f.rect(c - 3, c - 3, 6, 6, COLORS.frameDark);
  f.outline(PALETTE.outline);
  shadow.over(f);
  return shadow;
}

function turretFrame(lit: boolean, recoil: number): PixelArt {
  const f = new PixelArt(FRAME, FRAME);
  // Twin cannons, their tips at the muzzle the game fires from.
  const tip = c + MECH.muzzle.forward / CHARACTER_SCALE - recoil;
  const side = MECH.muzzle.side / CHARACTER_SCALE;
  for (const s of [-1, 1]) {
    const y = Math.round(c + s * side) - 1;
    f.rect(c + 4 - recoil, y, tip - (c + 4), 3, COLORS.gun);
    f.rect(c + 4 - recoil, y, tip - (c + 4), 1, COLORS.gunLight);
    f.rect(tip - 3, y - 1, 3, 5, COLORS.gun);
  }
  // Cabin: an armoured shell, lit from the top; narrow enough that the feet show either side.
  f.ellipse(c - 1, c, 9, 8.5, COLORS.plateShade);
  f.ellipse(c - 1, c - 0.6, 8.2, 7.8, COLORS.plate);
  f.ellipse(c - 2, c - 2, 5, 4, COLORS.plateLight);
  // Hazard chevrons on the back plate.
  for (let i = 0; i < 4; i++) {
    const y = c - 5 + i * 3;
    f.rect(c - 9, y, 2, 2, i % 2 ? PALETTE.hazardBlack : PALETTE.hazardAmber);
  }
  // Cockpit glass forward: cyan while powered, dark otherwise.
  f.rect(c + 3, c - 3, 3, 6, lit ? COLORS.glassLit : COLORS.glassDark);
  f.px(c + 4, c - 2, lit ? 0xd8f8ff : 0x2a4048);
  // Shoulder lamps.
  f.px(c, c - 8, lit ? PALETTE.amber : COLORS.plateShade);
  f.px(c, c + 7, lit ? PALETTE.amber : COLORS.plateShade);
  f.outline(PALETTE.outline);
  return f;
}
