import type { EnemyKind } from '../entities/enemies';
import type { GunId } from './weapons';

/**
 * Combat feel: how hard things look, sound and push, never how much they hurt. Damage, fire
 * rates and health stay in `weapons.ts` and `enemies.ts`; everything here is presentation,
 * except knockback, which nudges enemies a few pixels.
 */
export interface WeaponFeel {
  /** How long the player sprite shows its recoil pose after a shot. */
  readonly recoilMs: number;
  /** Camera kick against the aim per shot, in px; the camera's follow eases it back. */
  readonly kickPx: number;
  /** Screen shake per shot, or null for none. */
  readonly shake: { readonly intensity: number; readonly ms: number } | null;
  /** Shove per bullet that lands, in px/s, before the target's weight. */
  readonly knockback: number;
  readonly sound: string;
}

export const WEAPON_FEEL: Readonly<Record<GunId, WeaponFeel>> = {
  pistol: { recoilMs: 70, kickPx: 3, shake: null, knockback: 90, sound: 'sfx-pistol' },
  // Six pellets that all land add up: a close blast shoves a Walker about 20 px.
  shotgun: { recoilMs: 130, kickPx: 9, shake: { intensity: 0.004, ms: 90 }, knockback: 110, sound: 'sfx-shotgun' },
  // Small per shot; the camera's follow pulls each kick back, so sustained fire settles near 3 px.
  rifle: { recoilMs: 45, kickPx: 1.6, shake: null, knockback: 35, sound: 'sfx-rifle' },
  // Heavy rounds that shove; no per-shot shake: six a second would never let the screen settle.
  mech: { recoilMs: 90, kickPx: 2.5, shake: null, knockback: 150, sound: 'sfx-cannon' },
};

/** Divides knockback: heavier enemies barely move. The Giant does not move at all. */
export const ENEMY_WEIGHT: Readonly<Record<EnemyKind, number>> = {
  walker: 1, runner: 0.8, brute: 2.6, elite: 1.6, giant: Number.POSITIVE_INFINITY,
};

export const IMPACT = {
  /** How long a shove lasts; the enemy drifts to a stop over it, then pursues again. */
  knockbackMs: 110,
  /** Most knockback one enemy takes at once, px/s, however many pellets land together. */
  maxKnockback: 380,
  /**
   * Hit-stop, in ms: physics, enemies and the player hold still for a beat. Input, the HUD and
   * effects keep running.
   */
  hitStop: { kill: 40, heavyKill: 60, playerHurt: 60, giantAttack: 70, giantDeath: 90 },
  /** No new hit-stop within this long of the last, so dense fights never stutter. */
  hitStopGapMs: 160,
  shake: {
    hit: { intensity: 0.0015, ms: 50 },
    kill: { intensity: 0.003, ms: 80 },
    playerHurt: { intensity: 0.006, ms: 120 },
    heavy: { intensity: 0.012, ms: 260 },
    rockLand: { intensity: 0.007, ms: 140 },
  },
} as const;

/** Enemies whose death earns the longer hit-stop. */
export const HEAVY_KINDS: ReadonlySet<EnemyKind> = new Set(['brute', 'elite']);
