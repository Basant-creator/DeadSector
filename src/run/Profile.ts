import type { ShakeLevel } from '../fx/CameraFx';

/**
 * The only data kept between runs and page loads: the personal high score and settings.
 * Stored as one JSON entry in localStorage; anything about a single run stays in `Run`.
 */
export interface Settings {
  /** Screen shake and camera kick: full, reduced, or off. */
  shake: ShakeLevel;
  /** Master volume, 0 to 1. */
  volume: number;
  muted: boolean;
}

export interface Profile {
  /** Most coins collected in a single run. */
  highScore: number;
  settings: Settings;
}

const STORAGE_KEY = 'dead-sector.profile';
const VERSION = 2;
const SHAKE_LEVELS: readonly ShakeLevel[] = ['full', 'reduced', 'off'];

function defaultProfile(): Profile {
  return { highScore: 0, settings: { shake: 'full', volume: 0.7, muted: false } };
}

/** localStorage, or null where it is missing or blocked (some privacy modes throw on access). */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Read the saved profile. A missing, corrupt or older entry falls back to the defaults field
 * by field, so one bad value never costs the rest. Version 1 stored shake as a boolean
 * `screenShake`; it maps to 'full' or 'off'.
 */
export function loadProfile(): Profile {
  const profile = defaultProfile();
  let saved: unknown;
  try {
    saved = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return profile;
  }
  if (typeof saved !== 'object' || saved === null) return profile;
  const { highScore, settings } = saved as Partial<Record<keyof Profile, unknown>>;
  if (typeof highScore === 'number' && Number.isInteger(highScore) && highScore >= 0) {
    profile.highScore = highScore;
  }
  if (typeof settings === 'object' && settings !== null) {
    const { shake, volume, muted, screenShake } = settings as Partial<Record<keyof Settings | 'screenShake', unknown>>;
    if (SHAKE_LEVELS.includes(shake as ShakeLevel)) profile.settings.shake = shake as ShakeLevel;
    else if (typeof screenShake === 'boolean') profile.settings.shake = screenShake ? 'full' : 'off';
    if (typeof volume === 'number' && volume >= 0 && volume <= 1) profile.settings.volume = volume;
    if (typeof muted === 'boolean') profile.settings.muted = muted;
  }
  return profile;
}

/** Write the profile. Failing to save (quota, blocked storage) is not worth stopping the game for. */
export function saveProfile(profile: Profile): void {
  try {
    storage()?.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: VERSION, highScore: profile.highScore, settings: profile.settings }),
    );
  } catch {
    // Keep playing; the profile simply isn't remembered.
  }
}

/** The next shake level in the cycle full, reduced, off. */
export function nextShakeLevel(level: ShakeLevel): ShakeLevel {
  return SHAKE_LEVELS[(SHAKE_LEVELS.indexOf(level) + 1) % SHAKE_LEVELS.length];
}
