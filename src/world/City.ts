import Phaser from 'phaser';
import { type LightSprite, renderCity } from '../art/cityArt';
import type { Point } from '../waves/WaveDirector';
import {
  FACILITY_GATE_RECT, GATE_RECT, MAP_COLS, MAP_ROWS, MECH_BAY, PLAYER_SPAWN, type SolidKind, SOLIDS, TILE, type TileRect, tileRectToWorld,
  WEAPON_LOCKERS,
} from './cityMap';
import { FACILITY_GATE_COST, Gate, GATE_COST } from './Gate';
import { MechBay } from './MechBay';
import { NavGrid } from './NavGrid';
import { WeaponLocker } from './WeaponLocker';

/** Marks each gate's tiles in the solid lookup. */
const GATE_TILE = -2;
const FACILITY_GATE_TILE = -3;

/**
 * Builds the city from `cityMap` into a scene: solid geometry in one static group, the alley
 * and facility gates, the weapon lockers, and a navigation grid that mirrors the solids. Built
 * afresh on every scene start, so both gates are closed again on every new run.
 *
 * The solids are invisible rectangles: collision only. What the player sees is drawn by
 * src/art/cityArt.ts from the same map data, so the two always agree.
 */
export class City {
  /** Every solid, the closed gate included: one collider per mover covers all of them. */
  readonly walls: Phaser.Physics.Arcade.StaticGroup;
  /** The alley gate, into the Narrow Alleys. */
  readonly gate: Gate;
  /** The gate into the Industrial Facility. */
  readonly facilityGate: Gate;
  readonly nav: NavGrid;
  readonly lockers: readonly WeaponLocker[];
  readonly mechBay: MechBay;
  /** The light pools in the scene, for `Ambience` to animate. */
  readonly lights: readonly LightSprite[];
  /** Per tile: the index into SOLIDS of the solid covering it, GATE_TILE, or -1 for open ground. */
  private readonly solidTiles = new Int16Array(MAP_COLS * MAP_ROWS).fill(-1);

  constructor(scene: Phaser.Scene) {
    this.lights = renderCity(scene);

    this.walls = scene.physics.add.staticGroup();
    this.nav = new NavGrid(MAP_COLS, MAP_ROWS, TILE);
    SOLIDS.forEach(({ rect }, index) => {
      this.walls.add(this.addRect(scene, rect).setVisible(false));
      this.nav.setBlocked(rect, true);
      this.markTiles(rect, index);
    });
    this.markTiles(GATE_RECT, GATE_TILE);
    this.markTiles(FACILITY_GATE_RECT, FACILITY_GATE_TILE);

    this.gate = new Gate(scene, GATE_RECT, GATE_COST);
    this.facilityGate = new Gate(scene, FACILITY_GATE_RECT, FACILITY_GATE_COST);
    for (const gate of [this.gate, this.facilityGate]) {
      this.walls.add(gate.bars);
      this.nav.setBlocked(gate.rect, true);
    }

    this.lockers = WEAPON_LOCKERS.map((placement) => new WeaponLocker(scene, placement));
    this.mechBay = new MechBay(scene, MECH_BAY);
  }

  get spawn(): Point {
    return PLAYER_SPAWN;
  }

  /**
   * What solid covers the point (x, y), if any: its kind ('gate' for the gate) and, for map
   * solids, its index into SOLIDS. Lets presentation tell a car from a wall where a bullet hit.
   */
  solidAt(x: number, y: number): { kind: SolidKind | 'gate'; index: number } | null {
    const c = Math.floor(x / TILE);
    const r = Math.floor(y / TILE);
    if (c < 0 || r < 0 || c >= MAP_COLS || r >= MAP_ROWS) return null;
    const index = this.solidTiles[r * MAP_COLS + c];
    if (index === GATE_TILE || index === FACILITY_GATE_TILE) {
      const gate = index === GATE_TILE ? this.gate : this.facilityGate;
      return gate.isOpen ? null : { kind: 'gate', index };
    }
    return index < 0 ? null : { kind: SOLIDS[index].kind, index };
  }

  private markTiles([c, r, w, h]: TileRect, value: number): void {
    for (let row = r; row < r + h; row++) for (let col = c; col < c + w; col++) this.solidTiles[row * MAP_COLS + col] = value;
  }

  /** Open *gate* (the alley gate by default): out of the physics world and out of the navigation grid. */
  openGate(gate: Gate = this.gate): void {
    if (gate.isOpen) return;
    gate.open();
    this.nav.setBlocked(gate.rect, false);
  }

  private addRect(scene: Phaser.Scene, rect: TileRect): Phaser.GameObjects.Rectangle {
    const { x, y, width, height } = tileRectToWorld(rect);
    return scene.add.rectangle(x + width / 2, y + height / 2, width, height, 0x000000);
  }
}
