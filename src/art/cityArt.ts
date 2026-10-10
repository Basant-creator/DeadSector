import Phaser from 'phaser';
import {
  ALLEYS, GATE_RECT, LOTS, MAP_COLS, MAP_ROWS, type Solid, SOLIDS, TILE, type TileRect, WEAPON_LOCKERS,
} from '../world/cityMap';
import { LAYER, WORLD_ART_SCALE } from './layers';
import { PALETTE } from './palette';
import { addImage, PixelArt, seeded, shade } from './pixels';

/**
 * The city's look, generated once at boot from the same map data the collision and navigation
 * use, so what is drawn solid is solid. Three layers at half resolution:
 * - ground: asphalt, sidewalks, dead lots, alley brick, markings, cracks, debris, shadows;
 * - obstacles: roofs, walls, cars, dumpsters, barriers, each inside its collision rectangle;
 * - foreground: cables and lamp heads, drawn over the characters.
 * Plus a handful of coloured light pools. Nothing here is redrawn per frame.
 */
const T = TILE / WORLD_ART_SCALE; // art pixels per tile
const W = MAP_COLS * T;
const H = MAP_ROWS * T;

export interface CityLight {
  readonly x: number;
  readonly y: number;
  readonly color: number;
  readonly radius: number;
  readonly alpha: number;
}

const LAMP_COLS = [9, 17, 31, 39, 53];

/** Street lamps along the main street (amber), neon in the alleys (cyan, magenta), work lights. */
export const CITY_LIGHTS: readonly CityLight[] = [
  ...LAMP_COLS.map((c) => ({ x: c * TILE + 16, y: 25 * TILE + 16, color: PALETTE.amber, radius: 150, alpha: 0.3 })),
  ...LAMP_COLS.map((c) => ({ x: (c + 4) * TILE + 16, y: 34 * TILE + 16, color: PALETTE.amber, radius: 150, alpha: 0.3 })),
  { x: 2112, y: 352, color: PALETTE.cyan, radius: 130, alpha: 0.35 },
  { x: 2384, y: 1040, color: PALETTE.magenta, radius: 140, alpha: 0.35 },
  { x: 2656, y: 640, color: PALETTE.cyan, radius: 120, alpha: 0.35 },
  { x: 2240, y: 1536, color: PALETTE.magenta, radius: 130, alpha: 0.35 },
  { x: 2752, y: 1830, color: PALETTE.amber, radius: 110, alpha: 0.3 },
  { x: 2020, y: 880, color: PALETTE.amber, radius: 100, alpha: 0.35 },
  ...WEAPON_LOCKERS.map((l) => ({ x: l.wall.x, y: l.wall.y + 20, color: PALETTE.amber, radius: 80, alpha: 0.35 })),
];

/** Build the city textures. Call once (BootScene); every run reuses them. */
export function createCityArt(scene: Phaser.Scene): void {
  addImage(scene, 'city-ground', ground(), 1);
  addImage(scene, 'city-obstacles', obstacles(), 1);
  addImage(scene, 'city-foreground', foreground(), 1);
}

/** Put the city's layers into a scene. Called on every scene start. */
export function renderCity(scene: Phaser.Scene): void {
  const layer = (key: string, depth: number) =>
    scene.add.image(0, 0, key).setOrigin(0).setScale(WORLD_ART_SCALE).setDepth(depth);
  layer('city-ground', LAYER.ground);
  layer('city-obstacles', LAYER.obstacles);
  for (const light of CITY_LIGHTS) {
    scene.add.image(light.x, light.y, 'fx-light')
      .setTint(light.color)
      .setAlpha(light.alpha)
      .setScale((light.radius * 2) / 128)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(LAYER.lights);
  }
  layer('city-foreground', LAYER.foreground);
}

type Material = 'asphalt' | 'sidewalk' | 'lot' | 'alley';

function inRect([c, r, w, h]: TileRect, col: number, row: number): boolean {
  return col >= c && col < c + w && row >= r && row < r + h;
}

function materials(): Material[] {
  const out: Material[] = new Array(MAP_COLS * MAP_ROWS).fill('asphalt');
  const isLot = (col: number, row: number) => LOTS.some((lot) => inRect(lot, col, row));
  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLS; col++) {
      const i = row * MAP_COLS + col;
      if (col >= ALLEYS.area[0]) out[i] = 'alley';
      else if (isLot(col, row)) out[i] = 'lot';
      else {
        let ring = false;
        for (let dr = -1; dr <= 1 && !ring; dr++) for (let dc = -1; dc <= 1; dc++) if (isLot(col + dc, row + dr)) ring = true;
        if (ring) out[i] = 'sidewalk';
      }
    }
  }
  return out;
}

function ground(): PixelArt {
  const a = new PixelArt(W, H);
  const rand = seeded(2026);
  const mat = materials();
  const p = PALETTE;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const m = mat[Math.floor(y / T) * MAP_COLS + Math.floor(x / T)];
      const n = rand();
      let color: number;
      if (m === 'asphalt') color = n < 0.1 ? p.asphaltLight : n < 0.17 ? p.asphaltDark : p.asphalt;
      else if (m === 'sidewalk') color = x % T === 0 || y % T === 0 ? p.concreteSeam : n < 0.12 ? p.concreteLight : p.concrete;
      else if (m === 'lot') color = n < 0.14 ? p.dirtLight : n < 0.24 ? p.dirtDark : p.dirt;
      else {
        // Staggered brick paving, 8 x 4.
        const row = Math.floor(y / 4);
        const joint = y % 4 === 0 || (x + (row % 2) * 4) % 8 === 0;
        color = joint ? p.alleyMortar : n < 0.12 ? p.alleyBrick : p.alleyFloor;
      }
      a.px(x, y, color);
    }
  }

  const onMaterial = (x: number, y: number, m: Material) =>
    x >= 0 && y >= 0 && x < W && y < H && mat[Math.floor(y / T) * MAP_COLS + Math.floor(x / T)] === m;

  // Lots: tufts of dead grass and a few bare patches.
  for (let i = 0; i < 1400; i++) {
    const x = rand() * W;
    const y = rand() * H;
    if (!onMaterial(x, y, 'lot')) continue;
    if (rand() < 0.15) a.ellipse(x, y, 3 + rand() * 4, 2 + rand() * 3, p.dirtDark, 120);
    else { a.px(x, y, 0x3a4228); a.px(x + 1, y - 1, 0x343b24); }
  }

  // Asphalt: cracks, oil stains, litter.
  for (let i = 0; i < 160; i++) {
    let x = rand() * W;
    let y = rand() * H;
    if (!onMaterial(x, y, 'asphalt')) continue;
    let dir = rand() * Math.PI * 2;
    for (let s = 0; s < 10 + rand() * 30; s++) {
      if (!onMaterial(x, y, 'asphalt')) break;
      a.px(x, y, p.crack);
      dir += (rand() - 0.5) * 0.9;
      x += Math.cos(dir);
      y += Math.sin(dir);
    }
  }
  for (let i = 0; i < 60; i++) {
    const x = rand() * W;
    const y = rand() * H;
    if (onMaterial(x, y, 'asphalt')) a.ellipse(x, y, 3 + rand() * 6, 2 + rand() * 4, 0x101215, 90);
  }
  for (let i = 0; i < 500; i++) {
    const x = rand() * W;
    const y = rand() * H;
    if (!onMaterial(x, y, 'asphalt') && !onMaterial(x, y, 'alley')) continue;
    const kind = rand();
    if (kind < 0.4) a.px(x, y, 0x6a6a62); // paper
    else if (kind < 0.7) a.rect(x, y, 2, 1, 0x5a3428); // brick chip
    else if (kind < 0.85) a.px(x, y, 0x3a5a6a); // glass
    else a.rect(x, y, 2, 2, 0x2e3036); // rubble
  }

  // Alleys: puddles with a cold glint.
  for (let i = 0; i < 40; i++) {
    const x = rand() * W;
    const y = rand() * H;
    if (!onMaterial(x, y, 'alley')) continue;
    a.ellipse(x, y, 4 + rand() * 6, 2 + rand() * 3, 0x14181e, 220);
    a.px(x - 1, y - 1, 0x4a6a78);
  }

  // Main street markings: a faded centre line and two zebra crossings.
  for (let x = 2 * T; x < 59 * T; x += 48) {
    for (let dx = 0; dx < 20; dx++) for (let dy = -1; dy <= 0; dy++) if (rand() > 0.15) a.px(x + dx, 30 * T + dy, p.paintYellow, 200);
  }
  // Zebra crossings: bars running with the traffic, stacked across the road.
  for (const col of [21, 43]) {
    for (let y = 26 * T + 2; y < 34 * T - 4; y += 8) {
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 24; dx++) a.px(col * T + dx, y + dy, rand() < 0.1 ? p.concreteSeam : p.paintWhite, 120);
    }
  }
  // Manholes.
  for (const [mx, my] of [[14, 31], [36, 27], [52, 31], [24, 2], [46, 56]]) {
    a.disc(mx * T, my * T, 5, 0x18191d);
    a.disc(mx * T, my * T, 4, 0x2c2e33);
    for (let k = -3; k <= 3; k += 2) a.rect(mx * T - 3, my * T + k, 7, 1, 0x1e2024);
  }

  // Shadows cast down-right by every solid.
  for (const solid of SOLIDS) {
    const [c, r, w, h] = solid.rect;
    const drop = solid.kind === 'building' || solid.kind === 'wall' ? 4 : 2;
    a.rect(c * T + drop, r * T + drop, w * T, h * T, PALETTE.shadow, 110);
  }
  return a;
}

function obstacles(): PixelArt {
  const a = new PixelArt(W, H);
  SOLIDS.forEach((solid, i) => drawSolid(a, solid, seeded(500 + i)));
  // Gate frame: amber posts either side of the opening.
  const [gc, gr, , gh] = GATE_RECT;
  a.rect(gc * T, gr * T - 3, T, 3, PALETTE.hazardAmber);
  a.rect(gc * T, (gr + gh) * T, T, 3, PALETTE.hazardAmber);
  return a;
}

function drawSolid(a: PixelArt, { kind, rect }: Solid, rand: () => number): void {
  const [c, r, w, h] = rect;
  const x = c * T;
  const y = r * T;
  const pw = w * T;
  const ph = h * T;
  const p = PALETTE;
  if (kind === 'building') {
    const roof = p.roofs[Math.floor(rand() * p.roofs.length)];
    a.rect(x, y, pw, ph, roof);
    for (let i = 0; i < pw * ph * 0.05; i++) a.px(x + rand() * pw, y + rand() * ph, rand() < 0.5 ? shade(roof, 0.08) : shade(roof, -0.15));
    // Parapet, lit along the top and left.
    a.rect(x, y, pw, 2, p.parapet);
    a.rect(x, y, 2, ph, p.parapet);
    a.rect(x, y + ph - 2, pw, 2, shade(p.parapet, -0.35));
    a.rect(x + pw - 2, y, 2, ph, shade(p.parapet, -0.35));
    a.rect(x + 2, y + 2, pw - 4, 1, shade(roof, -0.3));
    // Rooftop clutter: AC units, vents, skylights.
    const props = 1 + Math.floor((pw * ph) / 2400);
    for (let i = 0; i < props; i++) {
      // Mostly AC units and vents; a skylight now and then.
      const kindRoll = rand() * 0.82;
      const bw = kindRoll < 0.4 ? 8 : kindRoll < 0.7 ? 4 : 10;
      const bh = kindRoll < 0.4 ? 7 : kindRoll < 0.7 ? 4 : 6;
      if (pw < bw + 8 || ph < bh + 8) continue;
      const px = x + 4 + Math.floor(rand() * (pw - bw - 8));
      const py = y + 4 + Math.floor(rand() * (ph - bh - 8));
      a.rect(px + 1, py + 1, bw, bh, PALETTE.shadow, 120);
      if (kindRoll < 0.4) {
        a.rect(px, py, bw, bh, p.metal);
        a.rect(px, py, bw, 1, shade(p.metal, 0.25));
        a.disc(px + bw / 2, py + bh / 2, 2.5, p.metalDark);
        a.px(px + bw / 2, py + bh / 2, 0x7a8088);
      } else if (kindRoll < 0.7) {
        a.rect(px, py, bw, bh, p.metalDark);
        a.rect(px + 1, py + 1, bw - 2, bh - 2, 0x15171b);
      } else {
        a.rect(px, py, bw, bh, p.metalDark);
        a.rect(px + 1, py + 1, bw - 2, bh - 2, p.glass);
        a.px(px + 2, py + 2, shade(p.glass, 0.35));
      }
    }
  } else if (kind === 'wall') {
    a.rect(x, y, pw, ph, p.brick);
    for (let yy = y; yy < y + ph; yy++) {
      const course = Math.floor((yy - y) / 4);
      for (let xx = x; xx < x + pw; xx++) {
        if ((yy - y) % 4 === 0 || (xx - x + (course % 2) * 4) % 8 === 0) a.px(xx, yy, p.mortar);
        else if (rand() < 0.08) a.px(xx, yy, p.brickLight);
      }
    }
    a.rect(x, y, pw, 1, p.brickLight);
  } else if (kind === 'car') {
    drawCar(a, x, y, pw, ph, rand);
  } else if (kind === 'dumpster') {
    a.rect(x, y, pw, ph, p.dumpster);
    a.rect(x + 1, y + 1, pw - 2, ph - 2, p.dumpsterLid);
    if (pw >= ph) a.rect(x + pw / 2, y + 1, 1, ph - 2, p.dumpster);
    else a.rect(x + 1, y + ph / 2, pw - 2, 1, p.dumpster);
    a.rect(x, y, pw, 1, shade(p.dumpster, 0.3));
    for (let i = 0; i < 6; i++) a.px(x + rand() * pw, y + rand() * ph, p.rust);
  } else {
    // Concrete barrier with hazard stripes.
    a.rect(x, y, pw, ph, p.barrierDark);
    a.rect(x + 1, y + 1, pw - 2, ph - 2, p.barrier);
    const along = pw >= ph;
    for (let i = 0; i < (along ? pw : ph); i++) {
      const stripe = Math.floor(i / 4) % 2 === 0 ? p.hazardAmber : p.hazardBlack;
      if (along) a.rect(x + i, y + ph / 2 - 2, 1, 4, stripe);
      else a.rect(x + pw / 2 - 2, y + i, 4, 1, stripe);
    }
  }
  // Every obstacle gets a hard dark edge inside its rectangle.
  a.rect(x, y, pw, 1, PALETTE.outline);
  a.rect(x, y + ph - 1, pw, 1, PALETTE.outline);
  a.rect(x, y, 1, ph, PALETTE.outline);
  a.rect(x + pw - 1, y, 1, ph, PALETTE.outline);
}

/** A wrecked sedan seen from above, nose toward +x or +y at random. */
function drawCar(a: PixelArt, x: number, y: number, pw: number, ph: number, rand: () => number): void {
  const p = PALETTE;
  const body = p.carBodies[Math.floor(rand() * p.carBodies.length)];
  const horizontal = pw >= ph;
  const flip = rand() < 0.5;
  // Work in car space: length along the long side, front at the far end unless flipped.
  const len = horizontal ? pw : ph;
  const wid = horizontal ? ph : pw;
  const at = (u: number, v: number, du: number, dv: number, color: number) => {
    const uu = flip ? len - u - du : u;
    if (horizontal) a.rect(x + uu, y + v, du, dv, color);
    else a.rect(x + v, y + uu, dv, du, color);
  };
  at(2, 2, len - 4, wid - 4, shade(body, -0.3));
  at(3, 3, len - 6, wid - 6, body);
  at(Math.round(len * 0.58), 4, Math.round(len * 0.14), wid - 8, p.glass); // windscreen
  at(Math.round(len * 0.6), 5, 2, 2, p.glassGlint);
  at(Math.round(len * 0.24), 4, Math.round(len * 0.1), wid - 8, p.glass); // rear window
  at(Math.round(len * 0.34), 4, Math.round(len * 0.24), wid - 8, shade(body, 0.12)); // roof
  at(len - 4, 4, 1, 3, 0xd8d0a0); // headlights, one smashed
  at(len - 4, wid - 7, 1, 3, 0x3a3a34);
  at(3, 4, 1, 2, 0x8a2020); // tail lights
  at(3, wid - 6, 1, 2, 0x8a2020);
  for (let i = 0; i < 10; i++) at(3 + rand() * (len - 6), 3 + rand() * (wid - 6), 1, 1, p.rust);
}

function foreground(): PixelArt {
  const a = new PixelArt(W, H);
  const rand = seeded(77);
  // Cables slung across the alleys between rooftops, sagging a little.
  const spans: [number, number, number][] = [
    [64 * T + 8, 67 * T, 6 * T], [64 * T + 8, 67 * T, 19 * T], [64 * T + 8, 67 * T, 44 * T],
    [73 * T, 76 * T, 9 * T], [73 * T, 76 * T, 35 * T], [82 * T, 84 * T, 16 * T], [82 * T, 84 * T, 52 * T],
  ];
  for (const [x0, x1, y] of spans) {
    const sag = 3 + rand() * 3;
    for (let x = x0; x <= x1; x++) {
      const t = (x - x0) / (x1 - x0);
      a.px(x, y + Math.sin(t * Math.PI) * sag, 0x0e1014, 230);
    }
  }
  // Lamp heads over the main street sidewalks.
  for (const light of CITY_LIGHTS.filter((l) => l.color === PALETTE.amber && l.radius === 150)) {
    const lx = light.x / WORLD_ART_SCALE;
    const ly = light.y / WORLD_ART_SCALE;
    a.rect(lx - 3, ly - 1, 6, 3, 0x2a2c30);
    a.rect(lx - 1, ly, 2, 1, 0xffe0a0);
  }
  return a;
}
