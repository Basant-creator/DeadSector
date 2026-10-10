import { INDUSTRIAL, SOLIDS, TILE, type TileRect } from '../world/cityMap';
import { WORLD_ART_SCALE } from './layers';
import { PALETTE } from './palette';
import { type PixelArt, shade } from './pixels';

/**
 * Detail drawn into the city layers: storefronts and façades, damaged ground, and landmarks.
 * Every detail on a solid stays inside that solid's rectangle, and every detail on the ground is
 * flat (no outline, no height), so nothing that looks solid is walkable or the other way round.
 */
const T = TILE / WORLD_ART_SCALE;

/** Manholes and alley vents, in tiles: drawn on the ground, and steam rises from them. */
export const VENTS: readonly (readonly [number, number])[] = [
  [14, 31], [36, 27], [52, 31], [24, 2], [46, 56], [74, 20], [83, 34], [66, 52],
  // Industrial Facility.
  [56, 62], [26, 69], [74, 80],
];

/** Landmarks: things to steer by, each tied to the solid it sits on or the ground it marks. */
export const LANDMARKS = {
  /** A cyan clinic cross on the roof of the Shotgun locker's building, by the spawn. */
  clinic: { rect: [36, 15, 6, 9] as TileRect },
  /** A water tower on the long row house, north of the main street. */
  waterTower: { rect: [28, 6, 14, 6] as TileRect },
  /** A crashed helicopter on the long building south of the main street. */
  helicopter: { rect: [28, 46, 14, 7] as TileRect },
  /** A magenta MOTEL sign on the alley block above the Rifle locker. */
  motel: { rect: [76, 13, 6, 15] as TileRect },
  /** A police cruiser left on the avenue south of the spawn, lights still going. */
  policeCar: { rect: [45, 40, 2, 4] as TileRect },
  /** A burned-out car next to a blast crater on the main street. */
  burnedCar: { rect: [10, 27, 4, 2] as TileRect },
  /** Where something blew a hole in the main street: flat, walkable ground. */
  crater: { tile: [15, 29] as const },
};

const sameRect = (a: TileRect, b: TileRect) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
/** Index into SOLIDS of the solid with rectangle *rect*. */
export const solidIndexOf = (rect: TileRect) => SOLIDS.findIndex((s) => sameRect(s.rect, rect));

/** Buildings whose bottom edge faces the main street (row 24): they get storefronts. */
const STOREFRONT_ROW = 24;

/** A building's visible front: its bottom band, inside its rectangle, seen in 3/4 view. */
export function drawFacade(a: PixelArt, rect: TileRect, rand: () => number): void {
  const [c, r, w, h] = rect;
  const x = c * T;
  const y = r * T;
  const pw = w * T;
  const bottom = y + h * T;
  const yard = r >= INDUSTRIAL.area[1];
  const alley = !yard && c >= 65;
  const store = !alley && !yard && r + h === STOREFRONT_ROW;
  const depth = store || yard ? 8 : 6;
  const top = bottom - depth;
  if (yard) {
    // Corrugated cladding with roller doors and a lamp over each.
    a.rect(x + 1, top, pw - 2, depth - 1, 0x34383c);
    for (let i = x + 2; i < x + pw - 2; i += 2) a.rect(i, top + 1, 1, depth - 2, 0x2c3034);
    a.rect(x + 1, top, pw - 2, 1, 0x1c1e22);
    for (let i = x + 6; i < x + pw - 14; i += 22) {
      a.rect(i, top + 2, 10, depth - 3, 0x4a4e54);
      for (let k = top + 3; k < bottom - 1; k += 2) a.rect(i, k, 10, 1, 0x3e4248);
      a.px(i + 5, top + 1, PALETTE.amber);
    }
    return;
  }
  const wall = alley ? 0x2a2428 : store ? 0x3a3236 : 0x34333a;
  a.rect(x + 1, top, pw - 2, depth - 1, wall);
  a.rect(x + 1, top, pw - 2, 1, shade(wall, -0.4)); // the roof's edge casts a line
  if (store) {
    // Awning in faded stripes over a lit shop window, a door at one end.
    const awning = [0x6a2a2a, 0x2a5a5a, 0x5a4a2a][Math.floor(rand() * 3)];
    for (let i = x + 2; i < x + pw - 2; i++) a.rect(i, top + 1, 1, 2, Math.floor((i - x) / 3) % 2 ? awning : shade(awning, 0.35));
    for (let i = x + 4; i < x + pw - 10; i += 7) {
      const lit = rand() < 0.5;
      a.rect(i, top + 4, 5, 2, lit ? 0x8a6a3a : 0x1a2028);
      if (!lit && rand() < 0.5) a.px(i + 1, top + 4, 0x4a6a78); // cracked glass
    }
    a.rect(x + pw - 8, top + 3, 3, 4, 0x1a1414);
    return;
  }
  // Rows of small windows: mostly dark, some boarded, a rare one lit.
  for (let i = x + 3; i < x + pw - 4; i += 5) {
    const roll = rand();
    const color = roll < 0.12 ? 0x7a5a2e : roll < 0.35 ? 0x4a3422 : 0x161a20;
    a.rect(i, top + 2, 2, 2, color);
  }
  if (alley) {
    a.rect(x + 3 + Math.floor(rand() * Math.max(1, pw - 10)), top + 1, 3, depth - 2, 0x1c1618); // back door
    if (rand() < 0.6) {
      // Graffiti tag in muted paint.
      const tag = [0x7a2a5a, 0x2a6a6a, 0x7a5a2a][Math.floor(rand() * 3)];
      const gx = x + 4 + Math.floor(rand() * Math.max(1, pw - 16));
      for (let i = 0; i < 8; i++) a.px(gx + i, top + 2 + Math.round(Math.sin(i * 1.3) * 1.2), tag);
    }
  }
}

/** Flat ground damage on one tile-aligned area: potholes, broken slabs, rubble, skids. */
export function damageGround(
  a: PixelArt,
  rand: () => number,
  isAsphalt: (x: number, y: number) => boolean,
  isSidewalk: (x: number, y: number) => boolean,
  width: number,
  height: number,
): void {
  // Potholes: dark, a lighter broken rim, sometimes rainwater.
  for (let i = 0; i < 70; i++) {
    const x = rand() * width;
    const y = rand() * height;
    if (!isAsphalt(x, y) || !isAsphalt(x + 6, y + 4) || !isAsphalt(x - 6, y - 4)) continue;
    const rx = 2 + rand() * 4;
    const ry = 1.5 + rand() * 2.5;
    a.ellipse(x, y, rx + 1, ry + 1, PALETTE.asphaltLight, 160);
    a.ellipse(x, y, rx, ry, 0x121417);
    if (rand() < 0.4) { a.ellipse(x, y, rx - 1, ry - 0.8, 0x18222a); a.px(x - 1, y - 1, 0x4a6a78); }
  }
  // Broken sidewalk: whole slabs gone to dirt and chips.
  for (let i = 0; i < 90; i++) {
    const sx = Math.floor((rand() * width) / T) * T;
    const sy = Math.floor((rand() * height) / T) * T;
    if (!isSidewalk(sx + 1, sy + 1)) continue;
    if (rand() < 0.45) {
      a.rect(sx + 1, sy + 1, T - 1, T - 1, PALETTE.dirtDark);
      for (let k = 0; k < 10; k++) a.px(sx + 1 + rand() * (T - 2), sy + 1 + rand() * (T - 2), PALETTE.concreteSeam);
    } else {
      let cx = sx + rand() * T;
      let cy = sy + rand() * T;
      for (let k = 0; k < 12; k++) { a.px(cx, cy, PALETTE.concreteSeam); cx += rand() - 0.3; cy += rand() - 0.5; }
    }
  }
  // Skid marks: two dark parallel arcs.
  for (let i = 0; i < 14; i++) {
    const x0 = rand() * width;
    const y0 = rand() * height;
    if (!isAsphalt(x0, y0)) continue;
    const len = 30 + rand() * 40;
    const ang = rand() * Math.PI * 2;
    const bend = (rand() - 0.5) * 0.02;
    for (let s = 0; s < len; s++) {
      const dir = ang + bend * s;
      const px = x0 + Math.cos(dir) * s;
      const py = y0 + Math.sin(dir) * s;
      if (!isAsphalt(px, py)) break;
      a.px(px, py, 0x15171b, 150);
      a.px(px - Math.sin(dir) * 5, py + Math.cos(dir) * 5, 0x15171b, 150);
    }
  }
}

/** Rubble: low, flat, unoutlined scatter, so it never reads as a wall. */
export function scatterRubble(a: PixelArt, cx: number, cy: number, radius: number, rand: () => number): void {
  for (let i = 0; i < radius * 3; i++) {
    const ang = rand() * Math.PI * 2;
    const d = rand() * radius;
    const x = cx + Math.cos(ang) * d;
    const y = cy + Math.sin(ang) * d;
    a.rect(x, y, rand() < 0.3 ? 2 : 1, 1, [0x34363c, 0x2c2e33, 0x4a3430][Math.floor(rand() * 3)]);
  }
}

/** The crater on the main street: scorched, cracked, rubble round the rim. */
export function drawCrater(a: PixelArt, rand: () => number): void {
  const [tc, tr] = LANDMARKS.crater.tile;
  const cx = tc * T;
  const cy = tr * T;
  a.ellipse(cx, cy, 22, 15, 0x0e0f11, 170);
  a.ellipse(cx, cy, 14, 9, 0x101113);
  a.ellipse(cx, cy, 9, 6, 0x15161a);
  for (let k = 0; k < 9; k++) {
    let x = cx;
    let y = cy;
    let dir = (k / 9) * Math.PI * 2 + rand() * 0.4;
    for (let s = 0; s < 18 + rand() * 14; s++) { a.px(x, y, PALETTE.crack); dir += (rand() - 0.5) * 0.6; x += Math.cos(dir); y += Math.sin(dir); }
  }
  scatterRubble(a, cx, cy, 26, rand);
}

/** A 3 x 5 pixel font for the few words drawn into the world. */
const GLYPHS: Record<string, string> = {
  M: '101111101101101', O: '111101101101111', T: '111010010010010', E: '111100110100111', L: '100100100100111',
};

export function drawWord(a: PixelArt, word: string, x: number, y: number, color: number): void {
  [...word].forEach((ch, i) => {
    const g = GLYPHS[ch];
    for (let k = 0; k < 15; k++) if (g[k] === '1') a.px(x + i * 4 + (k % 3), y + Math.floor(k / 3), color);
  });
}

/** Roof landmarks, each inside its building's rectangle. */
export function drawLandmarks(a: PixelArt, rand: () => number): void {
  const at = (rect: TileRect) => ({ x: rect[0] * T, y: rect[1] * T, w: rect[2] * T, h: rect[3] * T });

  // Clinic: a cyan cross sign on a lighter roof panel.
  {
    const r = at(LANDMARKS.clinic.rect);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2 - 6;
    a.rect(cx - 9, cy - 9, 18, 18, 0x2a3a40);
    a.rect(cx - 2, cy - 7, 4, 14, PALETTE.cyan);
    a.rect(cx - 7, cy - 2, 14, 4, PALETTE.cyan);
  }
  // Water tower: a round plank tank on legs, with its shadow.
  {
    const r = at(LANDMARKS.waterTower.rect);
    const cx = r.x + r.w * 0.72;
    const cy = r.y + r.h / 2;
    a.ellipse(cx + 4, cy + 4, 12, 12, PALETTE.shadow, 110);
    for (const [dx, dy] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) a.rect(cx + dx - 1, cy + dy - 1, 2, 2, PALETTE.metalDark);
    a.disc(cx, cy, 11, 0x4a3a2c);
    a.disc(cx, cy, 10, 0x5a4634);
    for (let k = -9; k <= 9; k += 3) a.rect(cx + k, cy - 9, 1, 18, 0x4a3a2c);
    a.disc(cx - 2, cy - 2, 3, 0x6a5440);
  }
  // Crashed helicopter: a dark fuselage across the roof, a bent rotor, scorch and debris.
  {
    const r = at(LANDMARKS.helicopter.rect);
    const cx = r.x + r.w * 0.42;
    const cy = r.y + r.h / 2;
    a.ellipse(cx + 6, cy + 2, 30, 13, 0x0e0f11, 150);
    a.ellipse(cx, cy, 18, 8, 0x2c3a2c);
    a.ellipse(cx - 2, cy - 1, 15, 6, 0x3a4a38);
    a.rect(cx + 14, cy - 2, 26, 3, 0x2c3a2c); // tail boom
    a.rect(cx + 37, cy - 6, 3, 11, 0x2c3a2c);
    a.ellipse(cx - 12, cy, 5, 5, PALETTE.glass);
    a.line(cx - 26, cy - 14, cx + 10, cy + 9, PALETTE.metalDark);
    a.line(cx - 20, cy + 12, cx + 6, cy - 12, PALETTE.metalDark);
    scatterRubble(a, cx + 10, cy + 4, 14, rand);
  }
  // Motel sign: a dark board with MOTEL in magenta tubes.
  {
    const r = at(LANDMARKS.motel.rect);
    const bx = r.x + r.w / 2 - 12;
    const by = r.y + 10;
    a.rect(bx, by, 24, 11, 0x1a141c);
    a.rect(bx, by, 24, 1, PALETTE.magenta);
    a.rect(bx, by + 10, 24, 1, PALETTE.magenta);
    drawWord(a, 'MOTEL', bx + 3, by + 3, PALETTE.magenta);
  }
}
