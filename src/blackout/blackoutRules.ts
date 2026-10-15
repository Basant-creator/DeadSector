/**
 * Blackouts: the city's grid fails for a few seconds, more often as the waves go on. Plain data,
 * not frozen: tuning (and tests) may change it at runtime.
 *
 * While a wave is being fought the controller rolls `chance` once every `checkEveryMs`; a hit
 * starts a blackout unless the last one started under `minIntervalMs` ago. One blackout at a
 * time, always: warning flicker, then the outage, then the lights stutter back.
 *
 * Expected rate while fighting, before the interval caps it: 1 - (1 - chance)^(60000 / 8000)
 * per minute, so about 37% (waves 6-10), 55%, 70% and 81% (waves 21 on).
 *
 * Only the 10 authored waves exist today, so only the waves 6-10 tier is reached in play; the
 * later tiers are there for an endless director.
 */
export interface BlackoutTier {
  /** First wave (1-based) this tier applies to; it holds until the next tier's. */
  readonly fromWave: number;
  /** Chance per check that the power fails. */
  readonly chance: number;
  /** How long the lights stay out, picked uniformly in [min, max] ms. */
  readonly outMs: readonly [number, number];
  /** Share of blackouts that take the whole city; the rest take the player's district. */
  readonly citywide: number;
  /** Shortest time from one blackout's start to the next one's. */
  readonly minIntervalMs: number;
}

export type BlackoutScope = 'district' | 'citywide';

export const BLACKOUT = {
  /** Waves 1-5 have none: the first tier starts at wave 6. */
  tiers: [
    { fromWave: 6, chance: 0.06, outMs: [6000, 7000], citywide: 0, minIntervalMs: 45000 },
    { fromWave: 11, chance: 0.1, outMs: [6500, 8500], citywide: 0.35, minIntervalMs: 45000 },
    { fromWave: 16, chance: 0.15, outMs: [7000, 9500], citywide: 0.6, minIntervalMs: 45000 },
    { fromWave: 21, chance: 0.2, outMs: [8000, 10000], citywide: 0.8, minIntervalMs: 60000 },
  ] as BlackoutTier[],
  checkEveryMs: 8000,
  /** The failing lights flicker this long before they go. */
  warningMs: 1600,
  /** Darkness settles over this much of the outage's start. */
  fadeInMs: 500,
  /** The lights stutter back on over this long, and the dark lifts with them. */
  restoreMs: 1400,
  /** Darkness at its deepest: how much of the ground's light it takes away. */
  darkness: { district: 0.7, citywide: 0.8 } satisfies Record<BlackoutScope, number>,
  /** What stays visible in the dark. Radii in px. */
  sight: {
    /** The player's own pool of light, all round. */
    playerRadius: 210,
    /** A torch along the aim, so the way the player faces is never blind. */
    coneLength: 520,
    coneHalfAngle: 0.42,
    /** Each shot lights its surroundings for an instant. */
    flashRadius: 300,
    flashMs: 110,
    /** An enemy in full darkness keeps this much of its brightness: a silhouette, never nothing. */
    enemyFloor: 0.32,
    /** The Giant stays easier to make out: its attacks need reading. */
    giantFloor: 0.5,
  },
};

/** The tier for *wave*, or null before the first. */
export function tierFor(wave: number): BlackoutTier | null {
  let found: BlackoutTier | null = null;
  for (const tier of BLACKOUT.tiers) if (wave >= tier.fromWave) found = tier;
  return found;
}
