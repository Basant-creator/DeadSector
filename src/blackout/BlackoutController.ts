import Phaser from 'phaser';
import type { LightSprite } from '../art/cityArt';
import { LAYER } from '../art/layers';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import type { Enemy } from '../entities/Enemy';
import type { GameEvents } from '../events/GameEvents';
import { type District, districtAt, inTileRect, TILE, type TileRect } from '../world/cityMap';
import { BLACKOUT, type BlackoutScope, tierFor } from './blackoutRules';

export type BlackoutPhase = 'idle' | 'warning' | 'out' | 'restoring';

/** What the controller needs to see of the fight each frame. It never changes any of it. */
export interface BlackoutView {
  /** The wave being fought or coming next (1-based), and whether it is under way. */
  wave: number;
  waveActive: boolean;
  runOver: boolean;
  /** Where the player (or the mech they pilot) stands, and where they aim. */
  viewer: { x: number; y: number; aimAngle: number };
  enemies: readonly Enemy[];
}

/** The darkness is drawn at a quarter of the screen's resolution and scaled up smoothly. */
const MASK_SCALE = 4;
/** The mask overhangs the screen this far on every side, so a camera shake never shows its edge. */
const MASK_MARGIN = 32;
/** Brush textures' sizes (src/art/props.ts): a pool is 128 across, the cone 256 long. */
const HOLE_SIZE = 128;
const CONE_LENGTH = 256;
const EDGE_SIZE = 32;
/** How far a district's darkness fades out past its edge, in px. */
const EDGE_FADE = 96;
/** Light below this much is too dim to cut into the darkness. */
const MIN_LIGHT = 0.05;

/**
 * Temporary blackouts: a failing grid flickers, goes out for a few seconds, then stutters back.
 *
 * Presentation and timing only. It reads the wave number and the player's position and never
 * touches spawning, damage or anything else in the fight; enemies are only shaded. The whole
 * sequence is driven by `update(now)` from the scene, with no timers or tweens, and everything
 * it draws belongs to the scene, so a restart (death, new run) leaves none of it behind: the next
 * run starts in full light with a fresh controller.
 *
 * The darkness is a screen-sized mask between the ground and the actors. It dims the city (and
 * the light pools of every lamp that failed), and light is cut back into it where the player
 * stands and aims, where each shot is fired, and round every light still burning (fires,
 * batteries, the facility's generator). Enemies stand above it, so it cannot hide them; instead
 * they are shaded by the light where they are, down to a silhouette, never to nothing. Giant
 * attack markers, bullets, effects and the HUD are all above it, untouched.
 *
 * A district blackout darkens only the district the player is in, and only its lights fail; a
 * citywide one takes every light on the grid.
 */
export class BlackoutController {
  private readonly scene: Phaser.Scene;
  private readonly events: GameEvents;
  private readonly lights: readonly LightSprite[];
  /** Scenery drawn above the darkness (the city's cables and lamp heads): dimmed with it instead. */
  private readonly overhead: Phaser.GameObjects.Image;
  private readonly mask: Phaser.GameObjects.RenderTexture;
  private readonly hole: Phaser.GameObjects.Image;
  private readonly cone: Phaser.GameObjects.Image;
  private readonly edge: Phaser.GameObjects.Image;
  private currentPhase: BlackoutPhase = 'idle';
  private phaseStartedAt = 0;
  private phaseEndsAt = Infinity;
  /** When the blackout under way is over, its restore included. */
  private sequenceEndsAt = 0;
  private outMs = 0;
  private currentScope: BlackoutScope = 'district';
  /** The darkened area in tiles; the whole city when citywide. */
  private area: TileRect | null = null;
  private district: District | null = null;
  /** Per light: whether this blackout cuts it. */
  private readonly cut: boolean[];
  private lastStartedAt = -Infinity;
  private nextCheckAt: number;
  /** Recent shots, which light the dark for an instant. */
  private flashes: { x: number; y: number; until: number }[] = [];
  /** Enemies were shaded last frame and need their tint put back when the dark lifts. */
  private shading = false;
  private destroyed = false;
  /** Uniform [0, 1) source for the rolls; replaceable for tests. */
  random: () => number = Math.random;

  constructor(scene: Phaser.Scene, events: GameEvents, lights: readonly LightSprite[], overhead: Phaser.GameObjects.Image) {
    this.scene = scene;
    this.events = events;
    this.lights = lights;
    this.overhead = overhead;
    this.cut = lights.map(() => false);
    this.nextCheckAt = scene.time.now + BLACKOUT.checkEveryMs;
    const w = Math.ceil((GAME_WIDTH + 2 * MASK_MARGIN) / MASK_SCALE);
    const h = Math.ceil((GAME_HEIGHT + 2 * MASK_MARGIN) / MASK_SCALE);
    this.mask = scene.add.renderTexture(-MASK_MARGIN, -MASK_MARGIN, w, h).setOrigin(0).setScale(MASK_SCALE)
      .setScrollFactor(0).setDepth(LAYER.darkness).setVisible(false);
    this.mask.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    // Brushes: never on the display list, only drawn into the mask.
    this.hole = scene.make.image({ key: 'fx-dark-hole' }, false);
    this.cone = scene.make.image({ key: 'fx-dark-cone' }, false).setOrigin(0, 0.5);
    this.edge = scene.make.image({ key: 'fx-dark-edge' }, false).setOrigin(0, 0.5);
    events.on('shot-fired', ({ x, y }) => {
      if (this.currentPhase !== 'idle') this.flashes.push({ x, y, until: this.scene.time.now + BLACKOUT.sight.flashMs });
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  get phase(): BlackoutPhase {
    return this.currentPhase;
  }

  get scope(): BlackoutScope {
    return this.currentScope;
  }

  /** The district a district blackout took, or null. */
  get districtName(): string | null {
    return this.currentPhase === 'idle' ? null : this.district?.name ?? null;
  }

  /** When the blackout under way is over, its restore included; 0 when idle. */
  get endsAt(): number {
    return this.currentPhase === 'idle' ? 0 : this.sequenceEndsAt;
  }

  /** Short HUD label, or empty when the power is on. */
  get label(): string {
    return { idle: '', warning: 'POWER FAILING', out: 'POWER OUT', restoring: 'POWER BACK' }[this.currentPhase];
  }

  /** Whether light *index* is cut by the blackout under way. */
  isCut(index: number): boolean {
    return this.currentPhase !== 'idle' && this.cut[index];
  }

  /**
   * Start a blackout now, if none is under way. *scope* and *outMs* default to a roll on the
   * tier for *wave*. Returns whether one started. Also the entry point for tests.
   */
  trigger(now: number, viewer: { x: number; y: number }, wave: number, scope?: BlackoutScope, outMs?: number): boolean {
    if (this.destroyed || this.currentPhase !== 'idle') return false;
    const tier = tierFor(wave) ?? BLACKOUT.tiers[0];
    this.currentScope = scope ?? (this.random() < tier.citywide ? 'citywide' : 'district');
    this.outMs = outMs ?? Phaser.Math.Linear(tier.outMs[0], tier.outMs[1], this.random());
    this.district = this.currentScope === 'district' ? districtAt(viewer) : null;
    // A district's darkness runs a tile past its area, over the walls round it.
    this.area = this.district ? inflate(this.district.area) : null;
    const area = this.area;
    this.lights.forEach(({ light }, i) => {
      this.cut[i] = !light.backup && (!area || inTileRect(area, Math.floor(light.x / TILE), Math.floor(light.y / TILE)));
    });
    this.lastStartedAt = now;
    this.sequenceEndsAt = now + BLACKOUT.warningMs + this.outMs + BLACKOUT.restoreMs;
    this.flashes = [];
    this.enter('warning', now, BLACKOUT.warningMs);
    this.events.emit('blackout-warning', { scope: this.currentScope, district: this.district?.name ?? null, outMs: this.outMs });
    return true;
  }

  /**
   * Once a frame. Rolls for a blackout while a wave is fought, runs the one under way, and draws
   * the darkness. When the run is over the lights come back and no new blackout starts.
   */
  update(now: number, view: BlackoutView): void {
    if (this.destroyed) return;
    if (this.currentPhase === 'idle') this.maybeStart(now, view);
    else if (view.runOver && (this.currentPhase === 'warning' || this.currentPhase === 'out')) this.restore(now);
    if (now >= this.phaseEndsAt) this.advance(now);
    this.flashes = this.flashes.filter((f) => f.until > now);
    this.draw(now, view);
  }

  /** How lit light *index* is right now, 0 to 1: flickering, out, or stuttering back. */
  power(index: number, now: number): number {
    if (this.currentPhase === 'idle' || !this.cut[index]) return 1;
    const t = this.progress(now);
    // Each light flickers on its own 70 ms slots.
    const noise = hash(Math.floor(now / 70) + index * 31);
    if (this.currentPhase === 'warning') return noise < 0.2 + 0.65 * t ? 0.08 : 1;
    if (this.currentPhase === 'out') return 0;
    return noise < t * 1.15 ? 1 : 0.05;
  }

  /** The darkness right now, 0 (none) to its full depth. */
  darkness(now: number): number {
    const full = BLACKOUT.darkness[this.currentScope];
    const t = this.progress(now);
    switch (this.currentPhase) {
      case 'idle':
        return 0;
      case 'warning':
        // The grid browns out in dips that deepen toward the cut.
        return hash(Math.floor(now / 110) + 7) < 0.15 + 0.45 * t ? full * (0.25 + 0.35 * t) : 0;
      case 'out':
        return full * Math.min(1, (now - this.phaseStartedAt) / BLACKOUT.fadeInMs);
      default:
        return full * (1 - t) * (hash(Math.floor(now / 90) + 3) < t ? 0.6 : 1);
    }
  }

  private maybeStart(now: number, view: BlackoutView): void {
    if (view.runOver || !view.waveActive) {
      // The first roll of a wave comes a full interval into it.
      this.nextCheckAt = now + BLACKOUT.checkEveryMs;
      return;
    }
    if (now < this.nextCheckAt) return;
    this.nextCheckAt = now + BLACKOUT.checkEveryMs;
    const tier = tierFor(view.wave);
    if (!tier || now - this.lastStartedAt < tier.minIntervalMs) return;
    if (this.random() < tier.chance) this.trigger(now, view.viewer, view.wave);
  }

  private advance(now: number): void {
    if (this.currentPhase === 'warning') {
      this.enter('out', now, this.outMs);
      this.events.emit('blackout-started', { scope: this.currentScope, district: this.district?.name ?? null });
    } else if (this.currentPhase === 'out') {
      this.restore(now);
    } else if (this.currentPhase === 'restoring') {
      this.currentPhase = 'idle';
      this.phaseEndsAt = Infinity;
      this.events.emit('blackout-ended', {});
    }
  }

  private restore(now: number): void {
    this.enter('restoring', now, BLACKOUT.restoreMs);
    this.sequenceEndsAt = this.phaseEndsAt;
    this.events.emit('blackout-restoring', {});
  }

  private enter(phase: BlackoutPhase, now: number, ms: number): void {
    this.currentPhase = phase;
    this.phaseStartedAt = now;
    this.phaseEndsAt = now + ms;
  }

  private progress(now: number): number {
    return Phaser.Math.Clamp((now - this.phaseStartedAt) / Math.max(1, this.phaseEndsAt - this.phaseStartedAt), 0, 1);
  }

  /** Draw the darkness for this frame, and shade the enemies by the light they stand in. */
  private draw(now: number, view: BlackoutView): void {
    const dark = this.darkness(now);
    if (dark <= 0.001) {
      if (this.mask.visible) {
        this.mask.setVisible(false);
        this.overhead.clearTint();
      }
      if (this.shading) this.unshade(view.enemies);
      return;
    }
    const lit = Math.round((1 - dark) * 255);
    this.overhead.setTint((lit << 16) | (lit << 8) | lit);
    const camera = this.scene.cameras.main;
    // Screen position of world point (x, y), in mask pixels.
    const mx = (x: number) => (x - camera.scrollX + MASK_MARGIN) / MASK_SCALE;
    const my = (y: number) => (y - camera.scrollY + MASK_MARGIN) / MASK_SCALE;
    const mask = this.mask.setVisible(true);
    mask.clear();
    if (this.area) {
      const [c, r, w, h] = this.area;
      const x0 = mx(c * TILE);
      const y0 = my(r * TILE);
      const x1 = mx((c + w) * TILE);
      const y1 = my((r + h) * TILE);
      mask.fill(0x04060a, dark, x0, y0, x1 - x0, y1 - y0);
      // Fade the darkness out past each side rather than stopping at a hard line.
      const fade = EDGE_FADE / MASK_SCALE / EDGE_SIZE;
      const sides: [number, number, number, number][] = [
        [x1, (y0 + y1) / 2, 0, y1 - y0], [x0, (y0 + y1) / 2, Math.PI, y1 - y0],
        [(x0 + x1) / 2, y1, Math.PI / 2, x1 - x0], [(x0 + x1) / 2, y0, -Math.PI / 2, x1 - x0],
      ];
      for (const [x, y, rotation, length] of sides) {
        this.edge.setPosition(x, y).setRotation(rotation).setScale(fade, length / 4).setAlpha(dark).setTint(0x04060a);
        mask.draw(this.edge);
      }
    } else {
      mask.fill(0x04060a, dark);
    }
    const { sight } = BLACKOUT;
    const { viewer } = view;
    const hole = (x: number, y: number, radius: number, alpha: number) => {
      this.hole.setPosition(mx(x), my(y)).setScale((radius * 2) / MASK_SCALE / HOLE_SIZE).setAlpha(alpha);
      mask.erase(this.hole);
    };
    hole(viewer.x, viewer.y, sight.playerRadius, 1);
    this.cone.setPosition(mx(viewer.x), my(viewer.y)).setRotation(viewer.aimAngle)
      .setScale(sight.coneLength / MASK_SCALE / CONE_LENGTH).setAlpha(0.9);
    mask.erase(this.cone);
    for (const f of this.flashes) hole(f.x, f.y, sight.flashRadius, 0.85 * ((f.until - now) / sight.flashMs));
    const seen = camera.worldView;
    this.lights.forEach(({ light, image }, i) => {
      const lit = this.cut[i] ? this.power(i, now) : 1;
      if (lit < MIN_LIGHT || !image.visible) return;
      const r = light.radius * 1.1;
      if (light.x + r < seen.x || light.x - r > seen.right || light.y + r < seen.y || light.y - r > seen.bottom) return;
      hole(light.x, light.y, r, 0.85 * lit * Math.min(1, image.alpha / light.alpha));
    });
    this.shade(view, dark, now);
  }

  /** Tint each enemy by the light where it stands: full colour in light, a cold silhouette in the dark. */
  private shade(view: BlackoutView, dark: number, now: number): void {
    const full = BLACKOUT.darkness[this.currentScope];
    for (const enemy of view.enemies) {
      // A dying enemy has its own tint, and a hit flash must show: leave both alone.
      if (enemy.isDead || enemy.tintFill) continue;
      const inside = !this.area || inTileRect(this.area, Math.floor(enemy.x / TILE), Math.floor(enemy.y / TILE));
      const depth = inside ? dark / full : 0;
      const floor = enemy.kind === 'giant' ? BLACKOUT.sight.giantFloor : BLACKOUT.sight.enemyFloor;
      const f = 1 - depth * (1 - floor) * (1 - this.lightAt(enemy.x, enemy.y, view.viewer, now));
      if (f > 0.995) enemy.clearTint();
      else enemy.setTint(rgb(f * 0.8, f * 0.88, f));
    }
    this.shading = true;
  }

  private unshade(enemies: readonly Enemy[]): void {
    for (const enemy of enemies) if (!enemy.isDead && !enemy.tintFill) enemy.clearTint();
    this.shading = false;
  }

  /** Light at (x, y), 0 to 1: the player's pool and torch, recent shots, and the lights still on. */
  private lightAt(x: number, y: number, viewer: BlackoutView['viewer'], now: number): number {
    const { sight } = BLACKOUT;
    const d = Math.hypot(x - viewer.x, y - viewer.y);
    let light = 1 - smooth(sight.playerRadius * 0.55, sight.playerRadius, d);
    if (d < sight.coneLength) {
      const off = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(y - viewer.y, x - viewer.x) - viewer.aimAngle));
      if (off < sight.coneHalfAngle) light = Math.max(light, (1 - d / sight.coneLength) * 1.4 * (1 - off / sight.coneHalfAngle));
    }
    for (const f of this.flashes) light = Math.max(light, (1 - Math.hypot(x - f.x, y - f.y) / sight.flashRadius) * ((f.until - now) / sight.flashMs));
    this.lights.forEach(({ light: l }, i) => {
      const lit = this.cut[i] ? this.power(i, now) : 1;
      if (lit < MIN_LIGHT) return;
      light = Math.max(light, lit * (1 - smooth(l.radius * 0.4, l.radius * 1.1, Math.hypot(x - l.x, y - l.y))));
    });
    return Phaser.Math.Clamp(light, 0, 1);
  }

  private destroy(): void {
    this.destroyed = true;
    this.hole.destroy();
    this.cone.destroy();
    this.edge.destroy();
  }
}

/** The tile rectangle *rect* grown by a tile on every side. */
function inflate([c, r, w, h]: TileRect): TileRect {
  return [c - 1, r - 1, w + 2, h + 2];
}

/** 0 below *a*, 1 above *b*, smooth between. */
function smooth(a: number, b: number, x: number): number {
  const t = Phaser.Math.Clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Deterministic noise in [0, 1) for an integer. */
function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function rgb(r: number, g: number, b: number): number {
  const c = (v: number) => Math.round(Phaser.Math.Clamp(v, 0, 1) * 255);
  return (c(r) << 16) | (c(g) << 8) | c(b);
}
