import Phaser from 'phaser';
import type { LightSprite } from '../art/cityArt';
import { VENTS } from '../art/cityDetails';
import { LAYER } from '../art/layers';
import { PALETTE } from '../art/palette';
import type { Sfx } from '../audio/sfx';
import { SOLIDS, TILE } from '../world/cityMap';

/** Ambience sits well under the fight: gameplay sounds play at 0.7 to 1. */
const WIND_VOLUME = 0.2;
const DISTANT = { minGapMs: 7000, maxGapMs: 15000, volume: [0.1, 0.2] as const, keys: ['amb-siren', 'amb-moan', 'amb-clang', 'amb-crow'] };
const STEAM_PUFFS = 3;
const STEAM_CYCLE_MS = 3200;
const LITTER = 4;
/** Wind for the litter, px/s: a slow drift east with a little north. */
const WIND = { x: 14, y: -4 };
const ALARM_MS = 4000;
/** A car that has just stopped alarming stays quiet this long before another hit sets it off. */
const ALARM_REARM_MS = 6000;

interface Puff {
  readonly image: Phaser.GameObjects.Image;
  readonly x: number;
  readonly y: number;
  readonly offset: number;
}

interface Scrap {
  readonly image: Phaser.GameObjects.Image;
  bornAt: number;
  x0: number;
  y0: number;
}

interface Alarm {
  readonly lights: Phaser.GameObjects.Image[];
  until: number;
}

/** Street points litter starts from: open asphalt along the main, north and south streets. */
const LITTER_STARTS: readonly (readonly [number, number])[] = [[200, 900], [700, 1060], [1300, 860], [400, 90], [1500, 1810], [900, 120]];

/**
 * The living city: lights that buzz, breathe or flash, steam from vents, litter in the wind,
 * car alarms set off by stray shots, a wind loop and the odd distant sound. All of it is
 * presentation, quiet and below the fight; none of it blocks a view of an enemy or a bullet.
 * Driven by `update(now)` with no timers or tweens; the wind loop is stopped when the scene shuts
 * down, so a restart never stacks a second one.
 */
export class Ambience {
  private readonly scene: Phaser.Scene;
  private readonly sfx: Sfx;
  private readonly lights: readonly LightSprite[];
  private readonly puffs: Puff[] = [];
  private readonly scraps: Scrap[] = [];
  private readonly alarms = new Map<number, Alarm>();
  private readonly rearmAt = new Map<number, number>();
  private readonly wind: Phaser.Sound.BaseSound | null;
  private nextDistantAt: number;

  constructor(scene: Phaser.Scene, lights: readonly LightSprite[], sfx: Sfx) {
    this.scene = scene;
    this.sfx = sfx;
    this.lights = lights;
    const now = scene.time.now;

    for (const [c, r] of VENTS) {
      for (let i = 0; i < STEAM_PUFFS; i++) {
        const image = scene.add.image(c * TILE, r * TILE, 'fx-steam').setDepth(LAYER.lights + 0.05).setAlpha(0);
        this.puffs.push({ image, x: c * TILE, y: r * TILE, offset: (i / STEAM_PUFFS) * STEAM_CYCLE_MS + c * 97 });
      }
    }
    for (let i = 0; i < LITTER; i++) {
      const [x0, y0] = LITTER_STARTS[i % LITTER_STARTS.length];
      const image = scene.add.image(x0, y0, 'fx-paper').setDepth(LAYER.decals + 0.5).setAlpha(0.8);
      this.scraps.push({ image, bornAt: now - i * 4000, x0, y0 });
    }

    this.wind = scene.cache.audio.exists('amb-wind') ? scene.sound.add('amb-wind', { loop: true, volume: WIND_VOLUME }) : null;
    this.wind?.play();
    this.nextDistantAt = now + 4000;
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.wind?.destroy());
  }

  /** A bullet hit car *index* (into SOLIDS): its alarm goes off, unless it only just stopped. */
  carHit(index: number, now: number): void {
    const alarm = this.alarms.get(index);
    if ((alarm && now < alarm.until) || now < (this.rearmAt.get(index) ?? 0)) return;
    const [c, r, w, h] = SOLIDS[index].rect;
    const lights = alarm?.lights ?? [
      [c * TILE + 6, r * TILE + 6], [(c + w) * TILE - 6, r * TILE + 6], [c * TILE + 6, (r + h) * TILE - 6], [(c + w) * TILE - 6, (r + h) * TILE - 6],
    ].map(([x, y]) => this.scene.add.image(x, y, 'fx-light').setTint(PALETTE.amber).setScale(0.35)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(LAYER.lights).setAlpha(0));
    this.alarms.set(index, { lights, until: now + ALARM_MS });
    this.rearmAt.set(index, now + ALARM_MS + ALARM_REARM_MS);
    this.sfx.play('sfx-alarm', { volume: 0.35 });
  }

  /** Whether car *index*'s alarm is going, for tests and debugging. */
  alarmActive(index: number, now: number): boolean {
    return (this.alarms.get(index)?.until ?? 0) > now;
  }

  update(now: number): void {
    for (const { light, image } of this.lights) {
      if (light.motion === 'steady') continue;
      image.setAlpha(light.alpha * lightLevel(light.motion, light.phase, now));
    }

    for (const puff of this.puffs) {
      // Each puff rises and spreads over a cycle, fading in then out.
      const t = ((now + puff.offset) % STEAM_CYCLE_MS) / STEAM_CYCLE_MS;
      puff.image
        .setPosition(puff.x + Math.sin(t * 5 + puff.offset) * 4, puff.y - t * 26)
        .setScale(0.5 + t * 0.9)
        .setAlpha(0.32 * Math.sin(t * Math.PI));
    }

    for (const scrap of this.scraps) {
      const age = (now - scrap.bornAt) / 1000;
      if (age > 16) {
        const [x0, y0] = LITTER_STARTS[Math.floor(Math.random() * LITTER_STARTS.length)];
        Object.assign(scrap, { bornAt: now, x0, y0 });
        continue;
      }
      // Drift with the wind, tumbling a little; fade in and out at the ends of its trip.
      scrap.image
        .setPosition(scrap.x0 + WIND.x * age + Math.sin(age * 2.3) * 6, scrap.y0 + WIND.y * age + Math.sin(age * 3.1) * 3)
        .setRotation(age * 1.7)
        .setAlpha(0.8 * Math.min(1, age, 16 - age));
    }

    for (const [index, alarm] of this.alarms) {
      const on = now < alarm.until && Math.floor(now / 250) % 2 === 0;
      for (const l of alarm.lights) l.setAlpha(on ? 0.6 : 0);
      if (now >= alarm.until && !on) this.alarms.delete(index);
    }

    if (now >= this.nextDistantAt) {
      const key = DISTANT.keys[Math.floor(Math.random() * DISTANT.keys.length)];
      const [lo, hi] = DISTANT.volume;
      this.sfx.play(key, { volume: lo + Math.random() * (hi - lo), detune: (Math.random() - 0.5) * 300 });
      this.nextDistantAt = now + DISTANT.minGapMs + Math.random() * (DISTANT.maxGapMs - DISTANT.minGapMs);
    }
  }
}

/** Brightness (0-1) of a moving light at *now*. */
export function lightLevel(motion: LightSprite['light']['motion'], phase: number, now: number): number {
  if (motion === 'pulse') return 0.75 + 0.25 * Math.sin((now / 2600) * Math.PI * 2 + phase);
  if (motion === 'police') return Math.floor(now / 350) % 2 === phase ? 1 : 0.12;
  if (motion === 'buzz') {
    // Mostly on; short dark stutters in a few of every 90 ms slots.
    const slot = Math.floor(now / 90);
    const r = Math.abs(Math.sin(slot * 12.9898 + phase * 78.233) * 43758.5453) % 1;
    return r < 0.07 ? 0.15 : 1;
  }
  return 1;
}
