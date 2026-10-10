/**
 * Every enemy type, by key. Stats live here only; `Enemy` reads them. The Giant's encounter
 * rules and attacks are in `giantRules.ts`.
 */
export type EnemyKind = 'walker' | 'runner' | 'brute' | 'elite' | 'giant';

export interface EnemyDef {
  readonly kind: EnemyKind;
  /** Shown in wave announcements. */
  readonly name: string;
  readonly maxHp: number;
  /** px/s. */
  readonly speed: number;
  /** Damage per touch; the player's invulnerability window spaces touches out. */
  readonly contactDamage: number;
  /** Coins the run earns when one dies. */
  readonly coinReward: number;
  /**
   * Radius of the circular body, in px. Under 32: the narrowest gaps in the city are two tiles
   * (64 px), and the navigation grid has no clearance model beyond that. Each size in use has
   * been walked from every spawn point.
   */
  readonly radius: number;
}

export const ENEMIES: Readonly<Record<EnemyKind, EnemyDef>> = {
  // The basic enemy: slow, and dangerous only in numbers.
  walker: {
    kind: 'walker', name: 'Walker', maxHp: 30, speed: 45, contactDamage: 10, coinReward: 4, radius: 15,
  },
  // Fast and fragile: twice a Walker's speed (half the player's), dies to two pistol shots.
  runner: {
    kind: 'runner', name: 'Runner', maxHp: 20, speed: 90, contactDamage: 12, coinReward: 6, radius: 12,
  },
  // Slow and heavy: soaks fire and hits hard.
  brute: {
    kind: 'brute', name: 'Brute', maxHp: 120, speed: 32, contactDamage: 25, coinReward: 12, radius: 20,
  },
  // Quick, tough and well rewarded.
  elite: {
    kind: 'elite', name: 'Elite', maxHp: 75, speed: 65, contactDamage: 15, coinReward: 18, radius: 16,
  },
  // A rare boss, never part of a wave's roster: see `giantRules.ts`.
  giant: {
    kind: 'giant', name: 'Giant', maxHp: 1200, speed: 30, contactDamage: 30, coinReward: 60, radius: 26,
  },
};

export const ENEMY_KINDS = Object.keys(ENEMIES) as EnemyKind[];
