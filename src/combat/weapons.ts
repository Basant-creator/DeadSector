/** Every weapon, by key, in slot order. Stats live here only; `Weapon` reads them. */
export type WeaponId = 'pistol' | 'shotgun' | 'rifle';

export interface WeaponDef {
  readonly id: WeaponId;
  readonly name: string;
  /** Coins to buy it; 0 for the weapon every run starts with. */
  readonly cost: number;
  /** Number key that selects it. */
  readonly slot: number;
  /** Shots per second while the trigger is held. */
  readonly fireRate: number;
  /**
   * px/s. Keep it below 60 × the thinnest wall (32 px), i.e. 1920: Arcade moves a body in
   * fixed 60 Hz steps, and a bullet that travels further than a wall's thickness in one step
   * can pass through it.
   */
  readonly bulletSpeed: number;
  /** Per bullet. */
  readonly damage: number;
  /** Distance in px a bullet travels before it is removed. */
  readonly range: number;
  /** Bullets per shot, fanned evenly across `spread`. */
  readonly pellets: number;
  /** Total angle of the fan, in radians; 0 for a single bullet. */
  readonly spread: number;
  /** Random deviation added to every bullet, in radians either way. */
  readonly jitter: number;
  /** Barrel drawn on the player while it is held, in px from the body's edge. */
  readonly barrel: { readonly length: number; readonly width: number; readonly color: number };
}

export const WEAPONS: Readonly<Record<WeaponId, WeaponDef>> = {
  pistol: {
    id: 'pistol', name: 'Pistol', cost: 0, slot: 1,
    fireRate: 4, bulletSpeed: 700, damage: 10, range: 650, pellets: 1, spread: 0, jitter: 0,
    barrel: { length: 18, width: 6, color: 0x7d8c74 },
  },
  // Six pellets in a 20° fan: 48 damage up close, and short range.
  shotgun: {
    id: 'shotgun', name: 'Shotgun', cost: 90, slot: 2,
    fireRate: 1.2, bulletSpeed: 650, damage: 8, range: 380, pellets: 6, spread: 0.35, jitter: 0.03,
    barrel: { length: 20, width: 10, color: 0x8a6a4a },
  },
  // Fast fire with a little spread: 90 damage per second against the pistol's 40.
  rifle: {
    id: 'rifle', name: 'Assault Rifle', cost: 160, slot: 3,
    fireRate: 10, bulletSpeed: 900, damage: 9, range: 750, pellets: 1, spread: 0, jitter: 0.04,
    barrel: { length: 26, width: 5, color: 0x5a6a7a },
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

export const STARTING_WEAPON: WeaponId = 'pistol';
