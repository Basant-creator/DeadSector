import Phaser from 'phaser';
import type { Point } from '../waves/WaveDirector';
import type { TileRect } from './cityMap';

const ORTHOGONAL_COST = 10;
const DIAGONAL_COST = 14;
const UNREACHABLE = Number.POSITIVE_INFINITY;
/** Steps along the flow a Walker looks ahead for a waypoint it can walk to in a straight line. */
const LOOKAHEAD = 4;
/** Spacing of the samples along a straight-line check, in px. */
const SAMPLE_STEP = 8;

const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [1, 0, ORTHOGONAL_COST], [-1, 0, ORTHOGONAL_COST], [0, 1, ORTHOGONAL_COST], [0, -1, ORTHOGONAL_COST],
  [1, 1, DIAGONAL_COST], [1, -1, DIAGONAL_COST], [-1, 1, DIAGONAL_COST], [-1, -1, DIAGONAL_COST],
];

/**
 * Tile grid of the walkable city, and a flow field over it toward one target (the player).
 *
 * The field is a Dijkstra distance from the target's tile to every tile, rebuilt only when
 * the target moves to another tile or the grid changes. Every Walker reads the same field, so
 * the cost does not grow with their number. Diagonal steps are allowed only when both
 * orthogonal tiles are open, so a path never cuts a wall corner.
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly tile: number;
  private readonly blocked: Uint8Array;
  private readonly distance: Float64Array;
  private targetCell = -1;
  private dirty = true;
  private readonly waypointOut = new Phaser.Math.Vector2();

  constructor(cols: number, rows: number, tile: number) {
    this.cols = cols;
    this.rows = rows;
    this.tile = tile;
    this.blocked = new Uint8Array(cols * rows);
    this.distance = new Float64Array(cols * rows).fill(UNREACHABLE);
  }

  setBlocked([col, row, cols, rows]: TileRect, blocked: boolean): void {
    for (let r = row; r < row + rows; r++) {
      for (let c = col; c < col + cols; c++) this.blocked[r * this.cols + c] = blocked ? 1 : 0;
    }
    this.dirty = true;
  }

  isBlockedAt(x: number, y: number): boolean {
    const cell = this.cellAt(x, y);
    return cell < 0 || this.blocked[cell] === 1;
  }

  /** Point the flow field at *target*. Cheap when the target stays on the same tile. */
  setTarget(target: Point): void {
    const cell = this.cellAt(target.x, target.y);
    if (cell === this.targetCell && !this.dirty) return;
    this.targetCell = cell;
    this.dirty = false;
    this.rebuild();
  }

  /** Whether a Walker standing at *p* can walk to the current target. */
  isReachable(p: Point): boolean {
    const cell = this.cellAt(p.x, p.y);
    return cell >= 0 && this.distance[cell] !== UNREACHABLE;
  }

  /**
   * Where a body of *radius* at *from* should head next to reach *target*: the target itself
   * when nothing is in the way, otherwise the farthest of the next few tiles along the flow
   * it can walk to in a straight line. The returned vector is reused between calls.
   */
  waypoint(from: Point, target: Point, radius: number): Phaser.Math.Vector2 {
    const out = this.waypointOut;
    if (this.isClear(from, target, radius)) return out.set(target.x, target.y);

    let cell = this.cellAt(from.x, from.y);
    if (cell < 0 || this.distance[cell] === UNREACHABLE) return out.set(target.x, target.y);
    let best = -1;
    for (let step = 0; step < LOOKAHEAD; step++) {
      const next = this.downhill(cell);
      if (next < 0) break;
      // The first step is always adjacent and open; later ones must be in plain line.
      if (step > 0 && !this.isClear(from, this.cellCentre(next, out), radius)) break;
      best = next;
      cell = next;
    }
    return best < 0 ? out.set(target.x, target.y) : this.cellCentre(best, out);
  }

  /** Whether a body of *radius* can move from *a* to *b* in a straight line without touching a blocked tile. */
  isClear(a: Point, b: Point, radius: number): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const samples = Math.max(1, Math.ceil(length / SAMPLE_STEP));
    // Unit normal, to test both edges of the body's path as well as its centre.
    const nx = length > 0 ? (-dy / length) * radius : 0;
    const ny = length > 0 ? (dx / length) * radius : 0;
    for (let i = 0; i <= samples; i++) {
      const x = a.x + (dx * i) / samples;
      const y = a.y + (dy * i) / samples;
      if (this.isBlockedAt(x, y) || this.isBlockedAt(x + nx, y + ny) || this.isBlockedAt(x - nx, y - ny)) {
        return false;
      }
    }
    return true;
  }

  private cellAt(x: number, y: number): number {
    const c = Math.floor(x / this.tile);
    const r = Math.floor(y / this.tile);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  private cellCentre(cell: number, out: Phaser.Math.Vector2): Phaser.Math.Vector2 {
    const c = cell % this.cols;
    const r = (cell - c) / this.cols;
    return out.set((c + 0.5) * this.tile, (r + 0.5) * this.tile);
  }

  /** The open neighbour of *cell* closest to the target, or -1 at the target or a dead end. */
  private downhill(cell: number): number {
    let best = -1;
    let bestDistance = this.distance[cell];
    this.forEachNeighbour(cell, (next) => {
      if (this.distance[next] < bestDistance) {
        bestDistance = this.distance[next];
        best = next;
      }
    });
    return best;
  }

  private forEachNeighbour(cell: number, visit: (next: number, cost: number) => void): void {
    const c = cell % this.cols;
    const r = (cell - c) / this.cols;
    for (const [dc, dr, cost] of NEIGHBOURS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
      const next = nr * this.cols + nc;
      if (this.blocked[next]) continue;
      // No corner cutting: a diagonal needs both orthogonal tiles open.
      if (dc !== 0 && dr !== 0 && (this.blocked[r * this.cols + nc] || this.blocked[nr * this.cols + c])) continue;
      visit(next, cost);
    }
  }

  private rebuild(): void {
    const distance = this.distance;
    distance.fill(UNREACHABLE);
    if (this.targetCell < 0 || this.blocked[this.targetCell]) return;

    // Dijkstra with a binary heap of cells keyed by distance.
    const heap: number[] = [this.targetCell];
    distance[this.targetCell] = 0;
    const less = (i: number, j: number) => distance[heap[i]] < distance[heap[j]];
    const swap = (i: number, j: number) => { const t = heap[i]; heap[i] = heap[j]; heap[j] = t; };
    const push = (cell: number) => {
      heap.push(cell);
      for (let i = heap.length - 1; i > 0;) {
        const parent = (i - 1) >> 1;
        if (!less(i, parent)) break;
        swap(i, parent);
        i = parent;
      }
    };
    const pop = (): number => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        for (let i = 0; ;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && less(l, m)) m = l;
          if (r < heap.length && less(r, m)) m = r;
          if (m === i) break;
          swap(i, m);
          i = m;
        }
      }
      return top;
    };

    // A cell may sit in the heap more than once; a stale entry has a larger key than the
    // cell's settled distance and is skipped.
    const settled = new Uint8Array(distance.length);
    while (heap.length > 0) {
      const cell = pop();
      if (settled[cell]) continue;
      settled[cell] = 1;
      const base = distance[cell];
      this.forEachNeighbour(cell, (next, cost) => {
        if (base + cost < distance[next]) {
          distance[next] = base + cost;
          push(next);
        }
      });
    }
  }
}
