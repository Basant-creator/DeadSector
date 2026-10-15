import Phaser from 'phaser';
import {
  ALLEYS, districtOfTile, DOWNTOWN, FACILITY_GATE_RECT, GATE_RECT, INDUSTRIAL, inTileRect, LOTS, MAP_COLS, MAP_ROWS, MECH_BAY, PLAZA,
  type Solid, SOLIDS, TILE, type TileRect, WEAPON_LOCKERS,
} from '../world/cityMap';
import {
  damageGround, drawCrater, drawFacade, drawLandmarks, LANDMARKS, scatterRubble, solidIndexOf, VENTS,
} from './cityDetails';
import { LAYER, WORLD_ART_SCALE } from './layers';
import { PALETTE } from './palette';
import { addImage, PixelArt, seeded, shade } from './pixels';

/**
 * The city's look, generated once at boot from the same map data the collision and navigation
 * use, so what is drawn solid is solid. Three layers at half resolution:
 * - ground: asphalt, sidewalks, concrete, dead lots, alley brick, the plaza's paving, slab yards;
 *   markings, potholes, broken slabs, cracks, rubble, a blast crater, the mech bay, shadows. All
 *   flat: nothing on it looks walk-blocking;
 * - obstacles: roofs with façades and landmarks, walls, cars, dumpsters, barriers, shipping
 *   containers and fuel tanks, each drawn strictly inside its collision rectangle;
 * - foreground: cables and lamp heads, drawn over the characters.
 * Plus a handful of coloured light pools; `Ambience` animates the few that flicker. Nothing here
 * is redrawn per frame.
 */
const T = TILE / WORLD_ART_SCALE; // art pixels per tile
const W = MAP_COLS * T;
const H = MAP_ROWS * T;

/**
 * How a light moves, if at all: a failing lamp that buzzes off now and then, neon that breathes,
 * a police light bar alternating red and blue, or a fire.
 */
export type LightMotion = 'steady' | 'buzz' | 'pulse' | 'police' | 'fire';

export interface CityLight {
  readonly x: number;
  readonly y: number;
  readonly color: number;
  readonly radius: number;
  readonly alpha: number;
  readonly motion: LightMotion;
  /** Offsets the motion so neighbours never move in step; for police, 0 red, 1 blue. */
  readonly phase: number;
  /**
   * Not on the city's grid: fires, batteries, generators. A blackout leaves these burning, and
   * they are the only light in it besides the player's own.
   */
  readonly backup: boolean;
}

const LAMP_COLS = [9, 17, 31, 39, 53];
/** Downtown's boulevard lamps: north side, then south side. */
const BOULEVARD_LAMPS = { north: [4, 25, 47, 57, 70, 86], south: [10, 25, 47, 61, 75, 86] };
const light = (x: number, y: number, color: number, radius: number, alpha: number, motion: LightMotion = 'steady', phase = 0): CityLight =>
  ({ x, y, color, radius, alpha, motion, phase, backup: false });
/** The same light, on its own power: it stays lit through a blackout. */
const offGrid = (l: CityLight): CityLight => ({ ...l, backup: true });
const centre = (rect: TileRect) => ({ x: (rect[0] + rect[2] / 2) * TILE, y: (rect[1] + rect[3] / 2) * TILE });
/** Street lamps are amber, 150 px, on the grid: their heads are drawn over the street. */
export const isStreetLamp = (l: CityLight) => l.color === PALETTE.amber && l.radius === 150 && !l.backup;

/**
 * Street lamps along the boulevard and the main street (amber, a couple failing), neon on
 * Downtown's shops and in the alleys, landmark lights. A few are off the grid: the fire in the
 * burned bus, a checkpoint's battery floodlight, the lockers' lamps, the police car's light bar,
 * and the facility's bay on its generator.
 */
export const CITY_LIGHTS: readonly CityLight[] = [
  // Downtown.
  ...BOULEVARD_LAMPS.north.map((c, i) => light(c * TILE + 16, 13 * TILE + 16, PALETTE.amber, 150, 0.3, i === 3 ? 'buzz' : 'steady', i)),
  ...BOULEVARD_LAMPS.south.map((c, i) => light(c * TILE + 16, 22 * TILE + 16, PALETTE.amber, 150, 0.3, 'steady', i)),
  light(centre(LANDMARKS.cinema.rect).x, 6 * TILE + 8, PALETTE.magenta, 170, 0.35, 'pulse', 0.6),
  light(28 * TILE, 28 * TILE, PALETTE.cyan, 110, 0.3, 'pulse', 2.4),
  light(42 * TILE, 28 * TILE, PALETTE.magenta, 110, 0.3, 'buzz', 3),
  light(8 * TILE, 23 * TILE + 8, PALETTE.magenta, 100, 0.35, 'pulse', 1.2),
  light(17 * TILE, 23 * TILE + 8, PALETTE.cyan, 100, 0.35, 'buzz', 5),
  light(54 * TILE, 23 * TILE + 8, PALETTE.cyan, 100, 0.35, 'pulse', 3.3),
  light(13 * TILE, 30 * TILE, PALETTE.magenta, 90, 0.35, 'buzz', 7),
  light(70 * TILE, 10 * TILE + 16, PALETTE.amber, 170, 0.25),
  light(87 * TILE, 21 * TILE, PALETTE.amber, 120, 0.3, 'buzz', 2),
  offGrid(light(centre(LANDMARKS.burnedBus.rect).x, centre(LANDMARKS.burnedBus.rect).y, PALETTE.fireEdge, 140, 0.35, 'fire', 0.5)),
  offGrid(light(61 * TILE, 18 * TILE, 0xdce6ff, 150, 0.25)),
  // The main street.
  ...LAMP_COLS.map((c, i) => light(c * TILE + 16, 61 * TILE + 16, PALETTE.amber, 150, 0.3, i === 2 ? 'buzz' : 'steady', i)),
  ...LAMP_COLS.map((c, i) => light((c + 4) * TILE + 16, 70 * TILE + 16, PALETTE.amber, 150, 0.3, 'steady', i)),
  // The Narrow Alleys.
  light(2112, 1504, PALETTE.cyan, 130, 0.35, 'pulse', 0.3),
  light(2384, 2192, PALETTE.magenta, 140, 0.35, 'pulse', 1.7),
  light(2656, 1792, PALETTE.cyan, 120, 0.35, 'buzz', 4),
  light(2240, 2688, PALETTE.magenta, 130, 0.35, 'pulse', 2.9),
  light(2752, 2982, PALETTE.amber, 110, 0.3),
  light(2020, 2032, PALETTE.amber, 100, 0.35),
  ...WEAPON_LOCKERS.map((l) => offGrid(light(l.wall.x, l.wall.y + 20, PALETTE.amber, 80, 0.35))),
  // Landmarks: the clinic cross and the motel sign glow; the police car's bar alternates.
  light(centre(LANDMARKS.clinic.rect).x, centre(LANDMARKS.clinic.rect).y - 12, PALETTE.cyan, 90, 0.3, 'pulse', 0.8),
  light(centre(LANDMARKS.motel.rect).x, LANDMARKS.motel.rect[1] * TILE + 32, PALETTE.magenta, 100, 0.35, 'pulse', 2.2),
  offGrid(light(centre(LANDMARKS.policeCar.rect).x, centre(LANDMARKS.policeCar.rect).y, 0xff3030, 70, 0.3, 'police', 0)),
  offGrid(light(centre(LANDMARKS.policeCar.rect).x, centre(LANDMARKS.policeCar.rect).y, 0x3060ff, 70, 0.3, 'police', 1)),
  // Industrial Facility: floodlights over the yard and the bay, a failing one by the tanks, and
  // a warning beacon breathing over the mech. The bay runs on the facility's generator.
  offGrid(light(MECH_BAY.x, MECH_BAY.y - 20, PALETTE.amber, 170, 0.3)),
  offGrid(light(MECH_BAY.x, MECH_BAY.y - 60, PALETTE.cyan, 70, 0.3, 'pulse', 1.1)),
  light(1488, 3202, PALETTE.amber, 140, 0.25),
  light(9 * TILE, 107 * TILE + 16, PALETTE.amber, 110, 0.3),
  light(65 * TILE, 104 * TILE, PALETTE.amber, 110, 0.3, 'buzz', 6),
  light(81 * TILE, 109 * TILE, PALETTE.amber, 110, 0.3),
];

/** A light pool in the scene, with the light it shows, for `Ambience` to animate. */
export interface LightSprite {
  readonly light: CityLight;
  readonly image: Phaser.GameObjects.Image;
}

/** Build the city textures. Call once (BootScene); every run reuses them. */
export function createCityArt(scene: Phaser.Scene): void {
  addImage(scene, 'city-ground', ground(), 1);
  addImage(scene, 'city-obstacles', obstacles(), 1);
  addImage(scene, 'city-foreground', foreground(), 1);
}

/**
 * Put the city's layers into a scene. Called on every scene start. Returns the light pools, and
 * the foreground layer (cables, lamp heads), which is drawn over everything else.
 */
export function renderCity(scene: Phaser.Scene): { lights: LightSprite[]; foreground: Phaser.GameObjects.Image } {
  const layer = (key: string, depth: number) =>
    scene.add.image(0, 0, key).setOrigin(0).setScale(WORLD_ART_SCALE).setDepth(depth);
  layer('city-ground', LAYER.ground);
  layer('city-obstacles', LAYER.obstacles);
  const lights = CITY_LIGHTS.map((light) => ({
    light,
    image: scene.add.image(light.x, light.y, 'fx-light')
      .setTint(light.color)
      .setAlpha(light.alpha)
      .setScale((light.radius * 2) / 128)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(LAYER.lights),
  }));
  const foreground = layer('city-foreground', LAYER.foreground);
  return { lights, foreground };
}

type Material = 'asphalt' | 'sidewalk' | 'lot' | 'alley' | 'concrete' | 'yard' | 'plaza';

/** The concrete pad in front of the gate, ringed by its barriers. */
const GATE_PAD: TileRect = [56, 62, 8, 7];
/** The mech bay's painted pad, centred on the mech. */
const BAY_PAD: TileRect = [42, 106, 9, 7];
/** Downtown's transit yard: slab concrete round the bus sheds, east of the checkpoint. */
const TRANSIT_YARD: TileRect = [64, 7, 25, 25];
/** Downtown's buildings: the ground round each is sidewalk. */
const DOWNTOWN_BUILDINGS = SOLIDS
  .filter((s) => s.kind === 'building' && districtOfTile(s.rect[0], s.rect[1]) === DOWNTOWN)
  .map((s) => s.rect);

function materials(): Material[] {
  const out: Material[] = new Array(MAP_COLS * MAP_ROWS).fill('asphalt');
  const isLot = (col: number, row: number) => LOTS.some((lot) => inTileRect(lot, col, row));
  const besideDowntownBuilding = (col: number, row: number) =>
    DOWNTOWN_BUILDINGS.some(([c, r, w, h]) => col >= c - 1 && col <= c + w && row >= r - 1 && row <= r + h);
  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLS; col++) {
      const i = row * MAP_COLS + col;
      const district = districtOfTile(col, row);
      if (district === INDUSTRIAL) out[i] = 'yard';
      else if (district === ALLEYS) out[i] = 'alley';
      else if (district === DOWNTOWN) {
        if (inTileRect(PLAZA, col, row)) out[i] = 'plaza';
        else if (besideDowntownBuilding(col, row)) out[i] = 'sidewalk';
        else if (inTileRect(TRANSIT_YARD, col, row)) out[i] = 'yard';
      } else if (inTileRect(GATE_PAD, col, row)) out[i] = 'concrete';
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
      else if (m === 'concrete') color = (x % (2 * T) === 0 || y % (2 * T) === 0) ? p.concreteSeam : n < 0.1 ? p.concrete : 0x3e4147;
      else if (m === 'plaza') {
        // Big square paving stones, a tile and a half a side, in two worn greys.
        const stone = (Math.floor(x / 24) * 5 + Math.floor(y / 24) * 3) % 4;
        color = x % 24 === 0 || y % 24 === 0 ? 0x2a2b30 : n < 0.08 ? 0x4a4b52 : stone === 0 ? 0x3a3b41 : 0x404148;
      } else if (m === 'yard') {
        // Big poured slabs, two tiles a side, weathered unevenly.
        const slab = (Math.floor(x / (2 * T)) * 7 + Math.floor(y / (2 * T)) * 13) % 5;
        color = x % (2 * T) === 0 || y % (2 * T) === 0 ? 0x1e2024 : n < 0.1 ? 0x34373c : slab === 0 ? 0x2a2c30 : 0x2e3135;
      } else {
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

  // The facility yard: oil, rust streaks and tyre marks; lanes painted from the gate to the bay.
  for (let i = 0; i < 70; i++) {
    const x = rand() * W;
    const y = rand() * H;
    if (onMaterial(x, y, 'yard')) a.ellipse(x, y, 3 + rand() * 7, 2 + rand() * 4, rand() < 0.7 ? 0x111215 : 0x3a2418, 100);
  }
  for (let i = 0; i < 90; i++) {
    let x = rand() * W;
    let y = rand() * H;
    if (!onMaterial(x, y, 'yard')) continue;
    let dir = rand() * Math.PI * 2;
    for (let s = 0; s < 8 + rand() * 20; s++) {
      if (!onMaterial(x, y, 'yard')) break;
      a.px(x, y, 0x1a1c1f);
      dir += (rand() - 0.5) * 0.8;
      x += Math.cos(dir);
      y += Math.sin(dir);
    }
  }
  for (const lane of [44, 49]) {
    for (let y = 96 * T + 4; y < BAY_PAD[1] * T - 4; y += 12) a.rect(lane * T, y, 2, 7, p.paintYellow, 170);
  }
  drawBayPad(a, rand);

  // Main street markings: a faded centre line and two zebra crossings.
  for (let x = 2 * T; x < 59 * T; x += 48) {
    for (let dx = 0; dx < 20; dx++) for (let dy = -1; dy <= 0; dy++) if (rand() > 0.15) a.px(x + dx, 66 * T + dy, p.paintYellow, 200);
  }
  // Zebra crossings: bars running with the traffic, stacked across the road.
  const zebra = (col: number, fromRow: number, toRow: number) => {
    for (let y = fromRow * T + 2; y < toRow * T - 4; y += 8) {
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 24; dx++) {
          if (onMaterial(col * T + dx, y + dy, 'asphalt')) a.px(col * T + dx, y + dy, rand() < 0.1 ? p.concreteSeam : p.paintWhite, 120);
        }
      }
    }
  };
  for (const col of [21, 43]) zebra(col, 62, 70);
  // The boulevard: a double centre line broken by the plaza, lane dashes, crossings at the avenues.
  for (let x = T; x < 89 * T; x++) {
    for (const yy of [18 * T - 2, 18 * T + 1]) if (onMaterial(x, yy, 'asphalt') && rand() > 0.12) a.px(x, yy, p.paintYellow, 190);
    for (const yy of [15 * T + 8, 20 * T + 8]) if (x % 40 < 18 && onMaterial(x, yy, 'asphalt') && rand() > 0.15) a.px(x, yy, p.paintWhite, 120);
  }
  for (const col of [23, 44, 60]) zebra(col, 13, 23);
  // Manholes in the streets, square grates in the alleys: steam rises from both.
  for (const [mx, my] of VENTS) {
    if (districtOfTile(mx, my) === ALLEYS) {
      a.rect(mx * T - 4, my * T - 4, 9, 9, 0x141519);
      for (let k = -3; k <= 3; k += 2) a.rect(mx * T - 3, my * T + k, 7, 1, 0x2a2c31);
      continue;
    }
    a.disc(mx * T, my * T, 5, 0x18191d);
    a.disc(mx * T, my * T, 4, 0x2c2e33);
    for (let k = -3; k <= 3; k += 2) a.rect(mx * T - 3, my * T + k, 7, 1, 0x1e2024);
  }

  // Damage: potholes, broken slabs, skids; the crater and the rubble round the wrecks.
  damageGround(a, rand, (x, y) => onMaterial(x, y, 'asphalt'), (x, y) => onMaterial(x, y, 'sidewalk'), W, H);
  drawCrater(a, rand);
  // Rubble where walls have crumbled: alley corners, the street by the crashed helicopter.
  for (const [rc, rr] of [[66, 48], [74, 83], [83, 58], [72, 65], [35, 90], [42, 80], [59, 50]]) scatterRubble(a, rc * T, rr * T, 14, rand);
  // Downtown: debris fallen from the looted shops, round the checkpoint and the burned bus.
  for (const [rc, rr] of [[11, 22], [21, 14], [48, 22], [26, 29], [43, 13], [62, 21], [74, 22], [12, 18], [20, 15]]) {
    scatterRubble(a, rc * T, rr * T, 16, rand);
  }
  drawScorch(a, rand);
  drawPlaza(a, rand);
  // Curbs: a lit edge where sidewalk meets road.
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (onMaterial(x, y, 'sidewalk') && (onMaterial(x, y + 1, 'asphalt') || onMaterial(x, y - 1, 'asphalt') || onMaterial(x + 1, y, 'asphalt') || onMaterial(x - 1, y, 'asphalt'))) {
        a.px(x, y, p.concreteLight);
      }
    }
  }
  // Parking bays along the north and south streets; storm drains at the curbs.
  for (let x = 6 * T; x < 58 * T; x += 2 * T) {
    for (const yy of [40 * T, 89 * T]) if (onMaterial(x, yy, 'asphalt')) a.rect(x, yy - 6, 1, 6, p.paintWhite, 110);
  }
  for (const [dc, dr] of [[12, 61], [33, 61], [47, 70], [22, 70], [56, 70], [9, 23], [30, 30], [55, 23]]) a.rect(dc * T, dr * T - 2, 6, 2, 0x111215);
  // Bus bays painted in the transit yard.
  for (let x = 66 * T; x < 88 * T; x += 3 * T) if (onMaterial(x, 21 * T, 'yard')) a.rect(x, 20 * T, 1, 2 * T, p.paintYellow, 120);
  // The gate pad: hazard chevrons painted toward the gate.
  for (let i = 0; i < 4; i++) {
    const cx = 58 * T + i * 10;
    for (let k = 0; k < 6; k++) { a.px(cx + k, 66 * T - 6 + k, p.hazardAmber, 150); a.px(cx + k, 66 * T + 5 - k, p.hazardAmber, 150); }
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
  drawLandmarks(a, seeded(31));
  // Gate frames: amber posts either side of each opening, inside the wall beside it.
  const [gc, gr, , gh] = GATE_RECT;
  a.rect(gc * T, gr * T - 3, T, 3, PALETTE.hazardAmber);
  a.rect(gc * T, (gr + gh) * T, T, 3, PALETTE.hazardAmber);
  const [fc, fr, fw] = FACILITY_GATE_RECT;
  a.rect(fc * T - 3, fr * T, 3, T, PALETTE.hazardAmber);
  a.rect((fc + fw) * T, fr * T, 3, T, PALETTE.hazardAmber);
  return a;
}

/** The mech bay: hazard stripes round a clean pad, a charging cable and corner bollards painted on. */
function drawBayPad(a: PixelArt, rand: () => number): void {
  const [c, r, w, h] = BAY_PAD;
  const x = c * T;
  const y = r * T;
  const pw = w * T;
  const ph = h * T;
  a.rect(x, y, pw, ph, 0x34373c);
  for (let i = 0; i < 40; i++) a.px(x + rand() * pw, y + rand() * ph, 0x2c2e33);
  // Diagonal hazard border, 4 art px wide.
  for (let yy = y; yy < y + ph; yy++) {
    for (let xx = x; xx < x + pw; xx++) {
      const edge = xx < x + 4 || xx >= x + pw - 4 || yy < y + 4 || yy >= y + ph - 4;
      if (edge) a.px(xx, yy, Math.floor((xx + yy) / 4) % 2 ? PALETTE.hazardAmber : PALETTE.hazardBlack, 210);
    }
  }
  // Where the mech's feet stand, and the cable running back to the hangar.
  const mx = MECH_BAY.x / WORLD_ART_SCALE;
  const my = MECH_BAY.y / WORLD_ART_SCALE;
  for (const dy of [-9, 9]) a.rect(mx - 6, my + dy - 3, 12, 6, 0x2a2c30);
  for (let yy = my + 14; yy < y + ph; yy++) a.px(mx + Math.round(Math.sin(yy / 5) * 2), yy, 0x141519);
}

function drawSolid(a: PixelArt, { kind, rect }: Solid, rand: () => number): void {
  const [c, r, w, h] = rect;
  const x = c * T;
  const y = r * T;
  const pw = w * T;
  const ph = h * T;
  const p = PALETTE;
  if (kind === 'bus') {
    drawBus(a, x, y, pw, ph, rand, solidIndexOf(rect) === solidIndexOf(LANDMARKS.burnedBus.rect));
  } else if (kind === 'monument') {
    drawMonument(a, x, y, pw, ph, rand);
  } else if (kind === 'building' && r >= INDUSTRIAL.area[1]) {
    drawWarehouse(a, rect, rand);
  } else if (kind === 'building') {
    const roof = p.roofs[Math.floor(rand() * p.roofs.length)];
    a.rect(x, y, pw, ph, roof);
    for (let i = 0; i < pw * ph * 0.05; i++) a.px(x + rand() * pw, y + rand() * ph, rand() < 0.5 ? shade(roof, 0.08) : shade(roof, -0.15));
    // Parapet, lit along the top and left.
    a.rect(x, y, pw, 2, p.parapet);
    a.rect(x, y, 2, ph, p.parapet);
    a.rect(x, y + ph - 2, pw, 2, shade(p.parapet, -0.35));
    a.rect(x + pw - 2, y, 2, ph, shade(p.parapet, -0.35));
    a.rect(x + 2, y + 2, pw - 4, 1, shade(roof, -0.3));
    // Rooftop clutter: AC units, vents, skylights. Landmark roofs stay clear for the landmark.
    const isLandmark = Object.values(LANDMARKS).some((l) => 'rect' in l && solidIndexOf(l.rect) === solidIndexOf(rect));
    const props = isLandmark ? 0 : 1 + Math.floor((pw * ph) / 2400);
    for (let i = 0; i < props; i++) {
      // Mostly AC units and vents; a skylight now and then.
      const kindRoll = rand() * 0.82;
      const bw = kindRoll < 0.4 ? 8 : kindRoll < 0.7 ? 4 : 10;
      const bh = kindRoll < 0.4 ? 7 : kindRoll < 0.7 ? 4 : 6;
      // Clear of the parapet and of the façade along the bottom.
      if (pw < bw + 8 || ph < bh + 18) continue;
      const px = x + 4 + Math.floor(rand() * (pw - bw - 8));
      const py = y + 4 + Math.floor(rand() * (ph - bh - 18));
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
    drawFacade(a, rect, rand);
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
    const style = solidIndexOf(rect) === solidIndexOf(LANDMARKS.policeCar.rect) ? 'police'
      : solidIndexOf(rect) === solidIndexOf(LANDMARKS.burnedCar.rect) ? 'burned' : 'wreck';
    drawCar(a, x, y, pw, ph, rand, style);
  } else if (kind === 'container') {
    drawContainer(a, x, y, pw, ph, rand);
  } else if (kind === 'tank') {
    // A round fuel tank on a square concrete plinth, so the whole solid looks solid.
    a.rect(x, y, pw, ph, p.concrete);
    a.rect(x, y, pw, 1, p.concreteLight);
    const r2 = Math.min(pw, ph) / 2 - 2;
    const cx = x + pw / 2;
    const cy = y + ph / 2;
    a.disc(cx + 1, cy + 1, r2, PALETTE.shadow, 120);
    a.disc(cx, cy, r2, 0x4e555c);
    a.disc(cx, cy, r2 - 2, 0x626a72);
    a.disc(cx - r2 / 3, cy - r2 / 3, r2 / 3, 0x7a828a);
    for (let k = -r2 + 3; k < r2 - 2; k += 4) a.rect(cx - 1, cy + k, 2, 2, p.hazardAmber);
    a.rect(cx + r2 - 4, cy - 2, 3, 4, p.metalDark); // valve
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

/** A sedan seen from above, nose toward +x or +y at random: a wreck, a police cruiser, or burned out. */
function drawCar(a: PixelArt, x: number, y: number, pw: number, ph: number, rand: () => number, style: 'wreck' | 'police' | 'burned'): void {
  const p = PALETTE;
  const body = style === 'police' ? 0x1a1c22 : style === 'burned' ? 0x1e1a18 : p.carBodies[Math.floor(rand() * p.carBodies.length)];
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
  // Shadow under the car fills the whole rectangle: no ground shows inside what is solid.
  a.rect(x, y, pw, ph, 0x111215);
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
  if (style === 'police') {
    // White doors, and the light bar across the roof (its glow is an animated light).
    at(Math.round(len * 0.3), 3, Math.round(len * 0.3), 2, 0xd8d8d0);
    at(Math.round(len * 0.3), wid - 5, Math.round(len * 0.3), 2, 0xd8d8d0);
    at(Math.round(len * 0.44), 4, 2, Math.ceil((wid - 8) / 2), 0xc02020);
    at(Math.round(len * 0.44), 4 + Math.ceil((wid - 8) / 2), 2, Math.floor((wid - 8) / 2), 0x2040c0);
  } else if (style === 'burned') {
    // Glass gone, paint scorched to bare metal.
    for (let i = 0; i < 40; i++) at(3 + rand() * (len - 6), 3 + rand() * (wid - 6), 1, 1, rand() < 0.5 ? 0x0c0b0a : 0x3a2a20);
    at(Math.round(len * 0.58), 4, Math.round(len * 0.14), wid - 8, 0x0c0d0f);
    at(Math.round(len * 0.24), 4, Math.round(len * 0.1), wid - 8, 0x0c0d0f);
  }
}

/**
 * A city bus seen from above: a long roof with AC units, windows down both sides, the windscreen
 * at one end. Burned out, it is charred to the frame and still glowing in places.
 */
function drawBus(a: PixelArt, x: number, y: number, pw: number, ph: number, rand: () => number, burned: boolean): void {
  const p = PALETTE;
  const horizontal = pw >= ph;
  const len = horizontal ? pw : ph;
  const wid = horizontal ? ph : pw;
  const flip = rand() < 0.5;
  const at = (u: number, v: number, du: number, dv: number, color: number, alpha = 255) => {
    const uu = flip ? len - u - du : u;
    if (horizontal) a.rect(x + uu, y + v, du, dv, color, alpha);
    else a.rect(x + v, y + uu, dv, du, color, alpha);
  };
  const body = burned ? 0x1c1916 : [0x2a5a64, 0x8a6a22][Math.floor(rand() * 2)];
  a.rect(x, y, pw, ph, 0x111215);
  at(1, 1, len - 2, wid - 2, shade(body, -0.3));
  at(2, 2, len - 4, wid - 4, body);
  // Windows down both sides, the windscreen at the front.
  for (let u = 6; u < len - 10; u += 6) {
    at(u, 2, 4, 2, burned ? 0x0c0d0f : p.glass);
    at(u, wid - 4, 4, 2, burned ? 0x0c0d0f : p.glass);
  }
  at(len - 5, 3, 2, wid - 6, burned ? 0x0c0d0f : p.glass);
  if (!burned) {
    at(len - 4, 4, 1, 2, p.glassGlint);
    at(len * 0.3, wid / 2 - 3, 10, 6, p.metal);
    at(len * 0.3 + 1, wid / 2 - 2, 8, 4, p.metalDark);
    at(len * 0.65, wid / 2 - 2, 6, 4, p.metalDark);
    at(4, wid / 2 - 1, len - 12, 1, shade(body, 0.2)); // a stripe along the roof
    for (let i = 0; i < 16; i++) at(3 + rand() * (len - 6), 3 + rand() * (wid - 6), 1, 1, p.rust);
    return;
  }
  // Burned: the roof caved to its ribs, soot, and embers still glowing.
  for (let u = 4; u < len - 4; u += 5) at(u, 3, 1, wid - 6, 0x2e2a26);
  for (let i = 0; i < 60; i++) at(3 + rand() * (len - 6), 3 + rand() * (wid - 6), 1, 1, rand() < 0.6 ? 0x0a0908 : 0x3a2a20);
  for (let i = 0; i < 14; i++) {
    const roll = rand();
    at(4 + rand() * (len - 8), 4 + rand() * (wid - 8), 1, 1, roll < 0.4 ? p.fireMid : roll < 0.8 ? p.fireEdge : p.fireCore);
  }
}

/** The plaza's statue: a stepped stone plinth, a dark bronze figure, its raised arm broken off. */
function drawMonument(a: PixelArt, x: number, y: number, pw: number, ph: number, rand: () => number): void {
  const p = PALETTE;
  a.rect(x, y, pw, ph, 0x3e3f45);
  a.rect(x + 2, y + 2, pw - 4, ph - 4, 0x4a4b52);
  a.rect(x + 6, y + 6, pw - 12, ph - 12, 0x56575e);
  a.rect(x, y, pw, 1, 0x5e6068);
  a.rect(x + 2, y + 2, pw - 4, 1, 0x62646c);
  for (let i = 0; i < 30; i++) a.px(x + rand() * pw, y + rand() * ph, rand() < 0.5 ? 0x34353a : 0x6a6c72);
  // The figure: shadow, body, head, one arm raised and snapped at the elbow.
  const cx = x + pw / 2;
  const cy = y + ph / 2;
  a.ellipse(cx + 3, cy + 3, 9, 7, p.shadow, 130);
  a.ellipse(cx, cy, 9, 7, 0x2a3a34);
  a.ellipse(cx - 1, cy - 1, 7, 5, 0x3a5046);
  a.disc(cx + 1, cy - 1, 3, 0x4a6a5a);
  a.rect(cx + 6, cy - 9, 3, 6, 0x3a5046);
  a.px(cx + 7, cy - 10, 0x2a3a34);
  // Verdigris streaks, and the arm lying on the plinth.
  for (let i = 0; i < 10; i++) a.px(cx - 6 + rand() * 12, cy - 4 + rand() * 8, 0x5a8a74);
  a.rect(x + 7, y + ph - 10, 6, 2, 0x3a5046);
}

/** Scorch round the burned bus, and soot blown along the boulevard. Flat: walkable. */
function drawScorch(a: PixelArt, rand: () => number): void {
  const [c, r, w, h] = LANDMARKS.burnedBus.rect;
  const cx = (c + w / 2) * T;
  const cy = (r + h / 2) * T;
  a.ellipse(cx, cy, w * T * 0.75, h * T * 1.6, 0x0c0d0f, 120);
  a.ellipse(cx, cy, w * T * 0.6, h * T * 1.1, 0x0a0b0c, 150);
  for (let i = 0; i < 160; i++) {
    const ang = rand() * Math.PI * 2;
    const d = rand() * w * T * 0.8;
    a.px(cx + Math.cos(ang) * d + d * 0.4, cy + Math.sin(ang) * d * 0.4, 0x101113, 160);
  }
}

/** The plaza: a ring of darker paving round the monument, and leaves and paper blown across it. */
function drawPlaza(a: PixelArt, rand: () => number): void {
  const [mc, mr, mw, mh] = LANDMARKS.monument.rect;
  const cx = (mc + mw / 2) * T;
  const cy = (mr + mh / 2) * T;
  for (let k = 0; k < 360; k++) {
    const ang = (k / 360) * Math.PI * 2;
    for (const rr of [52, 53, 58]) a.px(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, 0x2c2d32, 200);
  }
  // Leaves and paper blown into the corners.
  const [pc, pr, pw, ph] = PLAZA;
  for (let i = 0; i < 220; i++) {
    const x = pc * T + rand() * pw * T;
    const y = pr * T + rand() * ph * T;
    a.px(x, y, rand() < 0.5 ? 0x4a3a24 : 0x5a5a52, 160);
  }
}

/** A warehouse seen from above: a corrugated roof with skylight strips, vents, and a loading façade. */
function drawWarehouse(a: PixelArt, rect: TileRect, rand: () => number): void {
  const [c, r, w, h] = rect;
  const x = c * T;
  const y = r * T;
  const pw = w * T;
  const ph = h * T;
  const p = PALETTE;
  const roof = [0x3a3f45, 0x353a32, 0x403a38][Math.floor(rand() * 3)];
  a.rect(x, y, pw, ph, roof);
  // Corrugation running across the short side.
  for (let xx = x + 2; xx < x + pw - 2; xx += 3) a.rect(xx, y + 2, 1, ph - 4, shade(roof, -0.25));
  for (let i = 0; i < pw * ph * 0.03; i++) a.px(x + rand() * pw, y + rand() * ph, rand() < 0.5 ? p.rust : shade(roof, 0.12));
  // Skylight strips along the ridge.
  for (let xx = x + 6; xx < x + pw - 10; xx += 14) a.rect(xx, y + ph / 2 - 6, 8, 3, p.glass);
  // Roof vents.
  for (let xx = x + 10; xx < x + pw - 8; xx += 24) {
    a.disc(xx + 1, y + 7, 3, PALETTE.shadow, 120);
    a.disc(xx, y + 6, 3, p.metal);
    a.px(xx, y + 6, p.metalDark);
  }
  a.rect(x, y, pw, 2, p.parapet);
  a.rect(x, y, 2, ph, p.parapet);
  a.rect(x, y + ph - 2, pw, 2, shade(p.parapet, -0.35));
  a.rect(x + pw - 2, y, 2, ph, shade(p.parapet, -0.35));
  drawFacade(a, rect, rand);
}

/** A shipping container: ribbed steel in a faded livery, doors at one end. */
function drawContainer(a: PixelArt, x: number, y: number, pw: number, ph: number, rand: () => number): void {
  const body = [0x6a2e24, 0x2a4660, 0x2e5236, 0x7a5424][Math.floor(rand() * 4)];
  const along = pw >= ph;
  a.rect(x, y, pw, ph, shade(body, -0.25));
  a.rect(x + 1, y + 1, pw - 2, ph - 2, body);
  // Ribs across the short side.
  const len = along ? pw : ph;
  for (let i = 3; i < len - 3; i += 3) {
    if (along) a.rect(x + i, y + 1, 1, ph - 2, shade(body, -0.18));
    else a.rect(x + 1, y + i, pw - 2, 1, shade(body, -0.18));
  }
  // Doors and their lock bars at the far end.
  if (along) {
    a.rect(x + pw - 5, y + 1, 4, ph - 2, shade(body, -0.35));
    for (let k = 3; k < ph - 2; k += 5) a.rect(x + pw - 4, y + k, 2, 1, PALETTE.metal);
  } else {
    a.rect(x + 1, y + ph - 5, pw - 2, 4, shade(body, -0.35));
    for (let k = 3; k < pw - 2; k += 5) a.rect(x + k, y + ph - 4, 1, 2, PALETTE.metal);
  }
  a.rect(x, y, pw, 1, shade(body, 0.3));
  for (let i = 0; i < 8; i++) a.px(x + rand() * pw, y + rand() * ph, PALETTE.rust);
}

function foreground(): PixelArt {
  const a = new PixelArt(W, H);
  const rand = seeded(77);
  // Cables slung across the alleys between rooftops, sagging a little.
  const spans: [number, number, number][] = [
    [64 * T + 8, 67 * T, 42 * T], [64 * T + 8, 67 * T, 55 * T], [64 * T + 8, 67 * T, 80 * T],
    [73 * T, 76 * T, 45 * T], [73 * T, 76 * T, 71 * T], [82 * T, 84 * T, 52 * T], [82 * T, 84 * T, 88 * T],
    // Downtown's alleys.
    [12 * T, 14 * T, 26 * T], [12 * T, 14 * T, 31 * T], [10 * T, 12 * T, 10 * T], [34 * T, 36 * T, 31 * T], [74 * T, 76 * T, 27 * T],
  ];
  for (const [x0, x1, y] of spans) {
    const sag = 3 + rand() * 3;
    for (let x = x0; x <= x1; x++) {
      const t = (x - x0) / (x1 - x0);
      a.px(x, y + Math.sin(t * Math.PI) * sag, 0x0e1014, 230);
    }
  }
  // Lamp heads over the street sidewalks.
  for (const light of CITY_LIGHTS.filter(isStreetLamp)) {
    const lx = light.x / WORLD_ART_SCALE;
    const ly = light.y / WORLD_ART_SCALE;
    a.rect(lx - 3, ly - 1, 6, 3, 0x2a2c30);
    a.rect(lx - 1, ly, 2, 1, 0xffe0a0);
  }
  return a;
}
