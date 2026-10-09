/**
 * The only data kept between runs and page loads: the personal high score and settings.
 * Stored as one JSON entry in localStorage; anything about a single run stays in `Run`.
 */
export interface Settings {
  /** Shake the camera when the player is hit. */
  screenShake: boolean;
}

export interface Profile {
  /** Most coins collected in a single run. */
  highScore: number;
  settings: Settings;
}

const STORAGE_KEY = 'dead-sector.profile';
const VERSION = 1;

function defaultProfile(): Profile {
  return { highScore: 0, settings: { screenShake: true } };
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
 * by field, so one bad value never costs the rest.
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
    const { screenShake } = settings as Partial<Record<keyof Settings, unknown>>;
    if (typeof screenShake === 'boolean') profile.settings.screenShake = screenShake;
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
