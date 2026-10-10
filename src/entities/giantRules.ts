/**
 * The Giant's encounter rules and attacks. Its body stats (HP, speed, contact damage, reward)
 * are in `ENEMIES.giant` with every other enemy's.
 *
 * Every attack runs wind-up, active, recovery. The wind-up is the telegraph and is always
 * long enough for the player on foot (230 px/s, reached in 50 ms) to leave the danger zone it
 * shows, and for the mech (140 px/s, src/mech/mechRules.ts) too:
 * - slam: hits within `radius` (140 px) of the Giant's centre. The player is never closer than
 *   26 + 14 = 40 px, so at most 100 px gets them clear: 0.46 s of the 900 ms wind-up (the mech:
 *   92 px, about 0.73 s).
 * - charge: the lane is locked when the wind-up starts. Leaving it takes a sidestep of
 *   26 + 14 = 40 px (0.20 s) in the 800 ms wind-up (the mech: 48 px, about 0.42 s).
 * - debris: a reticle follows the player through the wind-up; the throw locks it as the landing
 *   spot, marked for the whole 900 ms flight. Leaving the 70 px impact circle takes 0.33 s (the
 *   mech: about 0.58 s).
 */
export type GiantAttackKind = 'slam' | 'charge' | 'debris';
export type AttackPhase = 'windUp' | 'active' | 'recovery';

/** Plain data, not frozen: tuning (and tests) may change it at runtime. */
export const GIANT = {
  encounter: {
    /** First wave (1-based) a Giant can appear in. */
    firstWave: 8,
    /** Chance of a Giant, rolled once as each eligible wave starts. */
    chancePerWave: 0.08,
    /** From the warning to the Giant's arrival. */
    warningMs: 3000,
    /** Closest to the player a Giant may arrive; also off screen, like every spawn. */
    minSpawnDistance: 600,
  },
  /** Pause after arriving and after each attack before the next one. */
  attackCooldownMs: 1600,
  slam: { triggerRange: 170, radius: 140, damage: 35, windUpMs: 900, activeMs: 150, recoveryMs: 900 },
  charge: {
    minRange: 200, maxRange: 450, maxDistance: 420, speed: 320, damage: 40,
    windUpMs: 800, recoveryMs: 1000,
  },
  debris: {
    minRange: 220, maxRange: 650, impactRadius: 70, damage: 25,
    windUpMs: 700, flightMs: 900, recoveryMs: 700,
  },
};

/** Whether wave *waveNumber* (1-based) brings a Giant, for a uniform *roll* in [0, 1). */
export function rollsGiant(waveNumber: number, roll: number): boolean {
  return waveNumber >= GIANT.encounter.firstWave && roll < GIANT.encounter.chancePerWave;
}
