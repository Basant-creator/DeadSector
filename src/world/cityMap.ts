/**
 * The city: a Residential Block in the west, joined to the Narrow Alleys in the east by one
 * gate in the brick wall between them.
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
export const MAP_ROWS = 60;
export const WORLD_WIDTH = MAP_COLS * TILE;
export const WORLD_HEIGHT = MAP_ROWS * TILE;

/** [col, row, cols, rows] in tiles. */
export type TileRect = readonly [number, number, number, number];

export type SolidKind = 'wall' | 'building' | 'car' | 'barrier' | 'dumpster';

export interface Solid {
  readonly kind: SolidKind;
  readonly rect: TileRect;
}

export interface District {
  readonly name: string;
  readonly area: TileRect;
}

export const RESIDENTIAL: District = { name: 'Residential Block', area: [1, 1, 63, 58] };
export const ALLEYS: District = { name: 'Narrow Alleys', area: [65, 1, 24, 58] };

/** The one way into the Narrow Alleys, set into the district wall at column 64. */
export const GATE_RECT: TileRect = [64, 28, 1, 3];

export const PLAYER_SPAWN: Point = { x: 46 * TILE, y: 30 * TILE };

/**
 * Weapon lockers on building walls. The Shotgun hangs on a house facing the main street near
 * the spawn; the Assault Rifle is in the Narrow Alleys, just past the gate.
 */
export const WEAPON_LOCKERS: readonly LockerPlacement[] = [
  { weapon: 'shotgun', wall: { x: 39 * TILE, y: 24 * TILE }, facing: 'down' },
  { weapon: 'rifle', wall: { x: 79 * TILE, y: 28 * TILE }, facing: 'down' },
];

const solids = (kind: SolidKind, rects: readonly TileRect[]): Solid[] => rects.map((rect) => ({ kind, rect }));

export const SOLIDS: readonly Solid[] = [
  ...solids('wall', [
    // Map edge.
    [0, 0, MAP_COLS, 1],
    [0, MAP_ROWS - 1, MAP_COLS, 1],
    [0, 1, 1, MAP_ROWS - 2],
    [MAP_COLS - 1, 1, 1, MAP_ROWS - 2],
    // District wall, open only where the gate is (rows 28-30).
    [64, 1, 1, 27],
    [64, 31, 1, 28],
  ]),

  // Residential Block: six lots of houses between a wide main street (rows 24-35), a north
  // and a south street, and four avenues.
  ...solids('building', [
    [6, 6, 7, 6], [15, 6, 5, 8], [6, 15, 6, 9], [14, 17, 6, 7],
    [28, 6, 14, 6], [28, 15, 6, 9], [36, 15, 6, 9],
    [50, 6, 8, 8], [50, 17, 8, 7],
    [6, 36, 6, 8], [14, 36, 6, 6], [6, 47, 14, 6],
    [28, 36, 6, 7], [37, 36, 5, 7], [28, 46, 14, 7],
    [50, 36, 8, 7], [50, 46, 8, 7],
  ]),
  ...solids('car', [
    [10, 27, 4, 2], [30, 31, 4, 2], [22, 13, 2, 4], [45, 40, 2, 4], [32, 1, 4, 2], [12, 55, 4, 2],
  ]),
  ...solids('barrier', [
    [55, 24, 1, 3], [17, 30, 3, 1],
    // Framing the approach to the gate, flush with the district wall.
    [60, 25, 4, 1], [60, 33, 4, 1],
  ]),
  ...solids('dumpster', [
    // Against a house wall, so they narrow a yard without splitting it into one-tile lanes.
    [6, 12, 2, 1], [34, 12, 2, 1], [52, 14, 2, 1], [17, 44, 2, 1], [44, 50, 1, 2], [61, 18, 1, 2],
  ]),

  // Narrow Alleys: three columns of buildings packed against the east edge. Alleys run
  // north-south at columns 65-66, 73-75 and 82-83, and east-west between the buildings.
  ...solids('building', [
    [67, 3, 6, 8], [67, 13, 6, 8], [67, 23, 6, 5], [67, 31, 6, 6], [67, 39, 6, 8], [67, 49, 6, 8],
    [76, 3, 6, 8], [76, 13, 6, 15], [76, 31, 6, 6], [76, 39, 6, 18],
    [84, 3, 5, 18], [84, 23, 5, 5], [84, 31, 5, 16], [84, 49, 5, 8],
  ]),
  // Each leaves at least two tiles of the alley it sits in.
  ...solids('dumpster', [
    [75, 5, 1, 2], [73, 24, 1, 2], [73, 42, 1, 2], [78, 30, 2, 1],
  ]),
];

/** Walkable ground drawn under the residential houses. */
export const LOTS: readonly TileRect[] = [
  [5, 5, 16, 20], [27, 5, 16, 20], [49, 5, 10, 20],
  [5, 35, 16, 19], [27, 35, 16, 19], [49, 35, 10, 19],
];

/**
 * Where enemies enter, on open ground at least a tile from any solid. A point is only used
 * while an enemy could walk from it to the player, so those in the Narrow Alleys stay idle
 * until the gate is open.
 */
export const SPAWN_POINTS: readonly Point[] = [
  // Residential Block.
  { x: 96, y: 320 }, { x: 96, y: 1440 },
  { x: 512, y: 96 }, { x: 1280, y: 96 },
  { x: 960, y: 1792 }, { x: 1664, y: 1792 },
  { x: 1952, y: 320 }, { x: 1952, y: 1536 },
  // Narrow Alleys.
  { x: 2112, y: 480 }, { x: 2112, y: 1440 },
  { x: 2384, y: 560 }, { x: 2384, y: 1600 },
  { x: 2656, y: 1280 },
  { x: 2752, y: 64 }, { x: 2752, y: 1856 },
];

export function tileRectToWorld([col, row, cols, rows]: TileRect): { x: number; y: number; width: number; height: number } {
  return { x: col * TILE, y: row * TILE, width: cols * TILE, height: rows * TILE };
}

export function districtAt(p: Point): District {
  return p.x >= ALLEYS.area[0] * TILE ? ALLEYS : RESIDENTIAL;
}
