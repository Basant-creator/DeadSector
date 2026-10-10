import type { GunDef } from '../combat/weapons';

/**
 * The mech: bought once per run at its bay in the Industrial Facility, then piloted until its
 * energy runs out or it is destroyed. Plain data, not frozen: tuning (and tests) may change it.
 *
 * Its own hull points stand between the enemies and the pilot: the player's health is untouched
 * while they are inside, and they climb out with what they had.
 *
 * Energy is the clock. Idle, a full charge lasts 80 s; firing adds 0.6 a shot, so the cannon
 * held down empties it in about 21 s (1.25 + 6 x 0.6 = 4.85 a second). A stomp costs 15.
 *
 * Dodging the Giant at mech speed (140 px/s, reached in 0.15 s): the slam needs at most
 * 140 - (26 + 22) = 92 px, about 0.73 s of the 0.9 s wind-up; leaving a charge lane takes a
 * 48 px sidestep, about 0.42 s of 0.8 s; leaving the 70 px debris circle takes about 0.58 s of
 * the 0.9 s flight.
 */
export const MECH = {
  /** Coins to bring the mech online; once per run. */
  cost: 200,
  /** How close, in px from the mech's centre, the player must stand to board it. */
  reach: 90,
  maxHp: 300,
  /** px/s; the player runs at 230. */
  speed: 140,
  /** From standing to full speed, and from full speed to a stop: heavy, not sluggish. */
  accelMs: 150,
  decelMs: 120,
  /** Body radius in px: through every two-tile gap in the city (64 px), wider than a Brute. */
  radius: 22,
  /** After a hit, no further hit for this long: a crowd lands at most 2.5 touches a second. */
  invulnerableMs: 400,
  energy: { max: 100, drainPerSecond: 1.25, perShot: 0.6 },
  cannon: {
    id: 'mech', fireRate: 6, bulletSpeed: 820, damage: 20, range: 620, pellets: 1, spread: 0, jitter: 0.05,
    tracer: 'bullet-heavy',
  } satisfies GunDef,
  /** Twin barrels: tips this far ahead of the centre and either side of it; shots alternate. */
  muzzle: { forward: 36, side: 9 },
  /** Space: a shockwave round the mech that hurts and throws back everything in reach. */
  stomp: { radius: 150, damage: 50, energy: 15, cooldownMs: 5000, knockback: 420 },
  /** Climbing out, by choice or not: the pilot is untouchable a moment and nearby enemies are shoved off. */
  eject: { invulnerableMs: 1500, pushRadius: 130, push: 360 },
  /** No climbing out this soon after boarding: a double-tapped E must not undo the boarding. */
  boardLockMs: 400,
};
