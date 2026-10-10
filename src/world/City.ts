import Phaser from 'phaser';
import { renderCity } from '../art/cityArt';
import type { Point } from '../waves/WaveDirector';
import {
  GATE_RECT, MAP_COLS, MAP_ROWS, PLAYER_SPAWN, SOLIDS, TILE, type TileRect, tileRectToWorld, WEAPON_LOCKERS,
} from './cityMap';
import { Gate } from './Gate';
import { NavGrid } from './NavGrid';
import { WeaponLocker } from './WeaponLocker';

/**
 * Builds the city from `cityMap` into a scene: solid geometry in one static group, the alley
 * gate, the weapon lockers, and a navigation grid that mirrors the solids. Built afresh on every
 * scene start, so the gate is closed again on every new run.
 *
 * The solids are invisible rectangles: collision only. What the player sees is drawn by
 * src/art/cityArt.ts from the same map data, so the two always agree.
 */
export class City {
  /** Every solid, the closed gate included: one collider per mover covers all of them. */
  readonly walls: Phaser.Physics.Arcade.StaticGroup;
  readonly gate: Gate;
  readonly nav: NavGrid;
  readonly lockers: readonly WeaponLocker[];

  constructor(scene: Phaser.Scene) {
    renderCity(scene);

    this.walls = scene.physics.add.staticGroup();
    this.nav = new NavGrid(MAP_COLS, MAP_ROWS, TILE);
    for (const { rect } of SOLIDS) {
      this.walls.add(this.addRect(scene, rect).setVisible(false));
      this.nav.setBlocked(rect, true);
    }

    this.gate = new Gate(scene, GATE_RECT);
    this.walls.add(this.gate.bars);
    this.nav.setBlocked(GATE_RECT, true);

    this.lockers = WEAPON_LOCKERS.map((placement) => new WeaponLocker(scene, placement));
  }

  get spawn(): Point {
    return PLAYER_SPAWN;
  }

  /** Open the alley gate: out of the physics world and out of the navigation grid. */
  openGate(): void {
    if (this.gate.isOpen) return;
    this.gate.open();
    this.nav.setBlocked(GATE_RECT, false);
  }

  private addRect(scene: Phaser.Scene, rect: TileRect): Phaser.GameObjects.Rectangle {
    const { x, y, width, height } = tileRectToWorld(rect);
    return scene.add.rectangle(x + width / 2, y + height / 2, width, height, 0x000000);
  }
}
