import Phaser from 'phaser';
import type { Point } from '../waves/WaveDirector';
import {
  ALLEYS, GATE_RECT, LOTS, MAP_COLS, MAP_ROWS, PLAYER_SPAWN, type SolidKind, SOLIDS, TILE,
  type TileRect, tileRectToWorld, WEAPON_LOCKERS, WORLD_WIDTH, WORLD_HEIGHT,
} from './cityMap';
import { Gate } from './Gate';
import { NavGrid } from './NavGrid';
import { WeaponLocker } from './WeaponLocker';

const SOLID_STYLE: Record<SolidKind, { fill: number; stroke: number }> = {
  wall: { fill: 0x4a3a32, stroke: 0x6a5242 },
  building: { fill: 0x2b302a, stroke: 0x4c5444 },
  car: { fill: 0x5a3b30, stroke: 0x7a5242 },
  barrier: { fill: 0x8a8a7a, stroke: 0xa8a898 },
  dumpster: { fill: 0x2f4a3a, stroke: 0x4a6a54 },
};

/**
 * Builds the city from `cityMap` into a scene: ground, solid geometry in one static group,
 * the alley gate, the weapon lockers, and a navigation grid that mirrors the solids. Built
 * afresh on every scene start, so the gate is closed again on every new run.
 */
export class City {
  /** Every solid, the closed gate included: one collider per mover covers all of them. */
  readonly walls: Phaser.Physics.Arcade.StaticGroup;
  readonly gate: Gate;
  readonly nav: NavGrid;
  readonly lockers: readonly WeaponLocker[];

  constructor(scene: Phaser.Scene) {
    this.drawGround(scene);

    this.walls = scene.physics.add.staticGroup();
    this.nav = new NavGrid(MAP_COLS, MAP_ROWS, TILE);
    for (const { kind, rect } of SOLIDS) {
      const style = SOLID_STYLE[kind];
      this.walls.add(this.addRect(scene, rect, style.fill).setStrokeStyle(2, style.stroke));
      if (kind === 'building') {
        // A roof inset, so houses read as buildings rather than walls.
        const { x, y, width, height } = tileRectToWorld(rect);
        scene.add.rectangle(x + width / 2, y + height / 2, width - 16, height - 16, 0x323830);
      }
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

  private drawGround(scene: Phaser.Scene): void {
    scene.add.rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0x121411).setOrigin(0);
    const alleys = tileRectToWorld(ALLEYS.area);
    scene.add.rectangle(alleys.x, alleys.y, alleys.width, alleys.height, 0x0d0f0d).setOrigin(0);
    for (const lot of LOTS) {
      this.addRect(scene, lot, 0x182017).setStrokeStyle(2, 0x262d24);
    }
    // Centre line of the main street, up to the barriers in front of the gate.
    for (let x = 2 * TILE; x < 59 * TILE; x += 96) {
      scene.add.rectangle(x, 30 * TILE, 40, 4, 0x3a4038).setOrigin(0, 0.5);
    }
  }

  private addRect(scene: Phaser.Scene, rect: TileRect, color: number): Phaser.GameObjects.Rectangle {
    const { x, y, width, height } = tileRectToWorld(rect);
    return scene.add.rectangle(x + width / 2, y + height / 2, width, height, color);
  }
}
