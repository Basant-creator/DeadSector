/**
 * The city: Downtown along the north, open to the Residential Block below it; the Narrow Alleys
 * east of the Residential Block behind one gate in the brick wall between them, and the
 * Industrial Facility in the south behind another. Downtown and the Residential Block are open
 * from the start; the gates keep the other two shut until bought.
 *
 * Authored on a 32 px tile grid. Every solid covers whole tiles, so the navigation grid
 * matches the collision geometry exactly. Every solid is at least one tile (32 px) thick:
 * a bullet moves under 12 px per physics step, so it cannot pass through any of them.
 *
 * Two solids either touch or stand at least two tiles (64 px) apart, diagonals included. The
 * navigation grid treats any open tile as passable, so a one-tile gap would be a path a Brute
 * (40 px) is routed into and cannot fit through.
 */

import type { Point } from '../waves/WaveDirector';
import type { LockerPlacement } from './WeaponLocker';

export const TILE = 32;
export const MAP_COLS = 90;
export const MAP_ROWS = 121;
export const WORLD_WIDTH = MAP_COLS * TILE;
export const WORLD_HEIGHT = MAP_ROWS * TILE;

/** [col, row, cols, rows] in tiles. */
export type TileRect = readonly [number, number, number, number];

export type SolidKind = 'wall' | 'building' | 'car' | 'bus' | 'barrier' | 'dumpster' | 'container' | 'tank' | 'monument';

export interface Solid {
  readonly kind: SolidKind;
  readonly rect: TileRect;
}

export interface District {
  readonly name: string;
  readonly area: TileRect;
}

export const DOWNTOWN: District = { name: 'Downtown', area: [1, 1, 88, 35] };
export const RESIDENTIAL: District = { name: 'Residential Block', area: [1, 36, 63, 59] };
export const ALLEYS: District = { name: 'Narrow Alleys', area: [65, 37, 24, 58] };
export const INDUSTRIAL: District = { name: 'Industrial Facility', area: [1, 96, 88, 24] };

/** Downtown's square: open paving round a monument, between the cinema and the boulevard. */
export const PLAZA: TileRect = [27, 6, 16, 24];

/** The one way into the Narrow Alleys, set into the district wall at column 64. */
export const GATE_RECT: TileRect = [64, 64, 1, 3];
/**
 * The one way into the Industrial Facility, set into the wall along row 95 at the foot of the
 * avenue south of the spawn.
 */
export const FACILITY_GATE_RECT: TileRect = [45, 95, 3, 1];

/** Where the mech stands in its bay, in the middle of the facility yard. */
export const MECH_BAY: Point = { x: 1488, y: 3520 };

export const PLAYER_SPAWN: Point = { x: 46 * TILE, y: 66 * TILE };

/**
 * Weapon lockers on building walls. The Shotgun hangs on a house facing the main street near
 * the spawn; the Assault Rifle is in the Narrow Alleys, just past the gate.
 */
export const WEAPON_LOCKERS: readonly LockerPlacement[] = [
  { weapon: 'shotgun', wall: { x: 39 * TILE, y: 60 * TILE }, facing: 'down' },
  { weapon: 'rifle', wall: { x: 79 * TILE, y: 64 * TILE }, facing: 'down' },
];

const solids = (kind: SolidKind, rects: readonly TileRect[]): Solid[] => rects.map((rect) => ({ kind, rect }));

export const SOLIDS: readonly Solid[] = [
  ...solids('wall', [
    // Map edge.
    [0, 0, MAP_COLS, 1],
    [0, MAP_ROWS - 1, MAP_COLS, 1],
    [0, 1, 1, MAP_ROWS - 2],
    [MAP_COLS - 1, 1, 1, MAP_ROWS - 2],
    // The Narrow Alleys' north wall, shutting them off from Downtown.
    [64, 36, 25, 1],
    // District wall, open only where the gate is (rows 64-66).
    [64, 37, 1, 27],
    [64, 67, 1, 28],
    // The facility's wall along row 95, open only where its gate is (columns 45-47).
    [1, 95, 44, 1],
    [48, 95, 41, 1],
  ]),

  // Downtown: a broad boulevard (rows 13-22) crossing the whole district, the plaza opening off
  // it, and blocks of shops cut by two-tile alleys. North of the boulevard the blocks run
  // unbroken along the city's edge; south of it they leave the three avenues and the alleys
  // open onto the cross street above the Residential Block.
  ...solids('building', [
    // North-west: an L-shaped corner block, then two shops split by an alley.
    [1, 1, 11, 5], [1, 6, 9, 7], [12, 1, 9, 5], [12, 8, 9, 5],
    // The cinema, over the plaza; the department store; the depot offices; the bus depot.
    [21, 1, 22, 5], [43, 1, 16, 6], [49, 9, 10, 4], [59, 1, 15, 6], [74, 1, 15, 9],
    // South of the boulevard: shops either side of an alley, the plaza's south frontage either
    // side of a passage, and a block split by an east-west alley.
    [5, 23, 7, 11], [14, 23, 7, 11], [27, 30, 7, 4], [36, 30, 7, 4], [49, 23, 10, 5], [49, 30, 10, 4],
    // The transit yard's sheds, a loop of alleys round them.
    [66, 24, 8, 6], [76, 24, 11, 6], [64, 32, 25, 4],
  ]),
  ...solids('bus', [
    // A burned-out bus across the boulevard; two left in the transit yard.
    [13, 16, 7, 2], [66, 11, 6, 2], [79, 13, 2, 7],
  ]),
  ...solids('car', [
    [23, 9, 2, 4], [45, 26, 2, 4], [50, 17, 4, 2], [8, 37, 4, 2],
  ]),
  ...solids('monument', [[33, 16, 4, 4]]),
  ...solids('barrier', [
    // Cover in the plaza.
    [29, 11, 3, 1], [39, 24, 1, 3], [29, 23, 3, 1],
    // A police checkpoint across the east end of the boulevard, three gaps left through it.
    [63, 15, 1, 2], [63, 19, 1, 2],
  ]),
  ...solids('dumpster', [
    [5, 22, 2, 1], [59, 24, 1, 2], [42, 6, 1, 2],
  ]),

  // Residential Block: six lots of houses between a wide main street (rows 60-71), a north
  // and a south street, and four avenues.
  ...solids('building', [
    [6, 42, 7, 6], [15, 42, 5, 8], [6, 51, 6, 9], [14, 53, 6, 7],
    [28, 42, 14, 6], [28, 51, 6, 9], [36, 51, 6, 9],
    [50, 42, 8, 8], [50, 53, 8, 7],
    [6, 72, 6, 8], [14, 72, 6, 6], [6, 83, 14, 6],
    [28, 72, 6, 7], [37, 72, 5, 7], [28, 82, 14, 7],
    [50, 72, 8, 7], [50, 82, 8, 7],
  ]),
  ...solids('car', [
    [10, 63, 4, 2], [30, 67, 4, 2], [22, 49, 2, 4], [45, 76, 2, 4], [32, 37, 4, 2], [12, 91, 4, 2],
  ]),
  ...solids('barrier', [
    [55, 60, 1, 3], [17, 66, 3, 1],
    // Framing the approach to the gate, flush with the district wall.
    [60, 61, 4, 1], [60, 69, 4, 1],
  ]),
  ...solids('dumpster', [
    // Against a house wall, so they narrow a yard without splitting it into one-tile lanes.
    [6, 48, 2, 1], [34, 48, 2, 1], [52, 50, 2, 1], [17, 80, 2, 1], [44, 86, 1, 2], [61, 54, 1, 2],
  ]),

  // Narrow Alleys: three columns of buildings packed against the east edge. Alleys run
  // north-south at columns 65-66, 73-75 and 82-83, and east-west between the buildings.
  ...solids('building', [
    [67, 39, 6, 8], [67, 49, 6, 8], [67, 59, 6, 5], [67, 67, 6, 6], [67, 75, 6, 8], [67, 85, 6, 8],
    [76, 39, 6, 8], [76, 49, 6, 15], [76, 67, 6, 6], [76, 75, 6, 18],
    [84, 39, 5, 18], [84, 59, 5, 5], [84, 67, 5, 16], [84, 85, 5, 8],
  ]),
  // Each leaves at least two tiles of the alley it sits in.
  ...solids('dumpster', [
    [75, 41, 1, 2], [73, 60, 1, 2], [73, 78, 1, 2], [78, 66, 2, 1],
  ]),

  // Industrial Facility: warehouses west and east, a hangar behind the mech bay, fuel tanks, and
  // shipping containers stacked round an open yard where the mech has room to fight.
  ...solids('building', [
    [3, 99, 12, 7], [3, 109, 12, 8],
    [38, 114, 17, 6],
    [60, 106, 12, 7], [76, 99, 10, 9],
  ]),
  ...solids('container', [
    [18, 99, 2, 5], [22, 99, 2, 4], [18, 107, 6, 2], [18, 113, 2, 5],
    [28, 100, 6, 2], [28, 105, 2, 6], [32, 110, 4, 2], [32, 115, 4, 2],
    [76, 111, 6, 2], [84, 111, 2, 6], [62, 116, 6, 2],
  ]),
  ...solids('tank', [
    [60, 99, 4, 4], [66, 99, 4, 4],
  ]),
];

/** Walkable ground drawn under the residential houses. */
export const LOTS: readonly TileRect[] = [
  [5, 41, 16, 20], [27, 41, 16, 20], [49, 41, 10, 20],
  [5, 71, 16, 19], [27, 71, 16, 19], [49, 71, 10, 19],
];

/**
 * Where enemies enter, on open ground at least a tile from any solid. A point is only used
 * while an enemy could walk from it to the player, so those in the Narrow Alleys stay idle
 * until the gate is open.
 */
export const SPAWN_POINTS: readonly Point[] = [
  // Downtown.
  { x: 80, y: 960 }, { x: 352, y: 224 }, { x: 896, y: 224 }, { x: 1312, y: 864 },
  { x: 1472, y: 1024 }, { x: 2240, y: 992 }, { x: 2752, y: 544 }, { x: 2816, y: 864 },
  // Residential Block.
  { x: 96, y: 1472 }, { x: 96, y: 2592 },
  { x: 512, y: 1248 }, { x: 1280, y: 1248 },
  { x: 960, y: 2944 }, { x: 1664, y: 2944 },
  { x: 1952, y: 1472 }, { x: 1952, y: 2688 },
  // Narrow Alleys.
  { x: 2112, y: 1632 }, { x: 2112, y: 2592 },
  { x: 2384, y: 1712 }, { x: 2384, y: 2752 },
  { x: 2656, y: 2432 },
  { x: 2752, y: 1216 }, { x: 2752, y: 3008 },
  // Industrial Facility.
  { x: 64, y: 3440 }, { x: 768, y: 3712 },
  { x: 2240, y: 3136 }, { x: 2800, y: 3616 },
];

export function tileRectToWorld([col, row, cols, rows]: TileRect): { x: number; y: number; width: number; height: number } {
  return { x: col * TILE, y: row * TILE, width: cols * TILE, height: rows * TILE };
}

export function inTileRect([c, r, w, h]: TileRect, col: number, row: number): boolean {
  return col >= c && col < c + w && row >= r && row < r + h;
}

/** The district a tile belongs to. Row 36 above the Residential Block is the street they share. */
export function districtOfTile(col: number, row: number): District {
  if (row >= INDUSTRIAL.area[1]) return INDUSTRIAL;
  if (row < RESIDENTIAL.area[1]) return DOWNTOWN;
  return col >= ALLEYS.area[0] ? ALLEYS : RESIDENTIAL;
}

export function districtAt(p: Point): District {
  return districtOfTile(Math.floor(p.x / TILE), Math.floor(p.y / TILE));
}
