import { ENEMY_KINDS, type EnemyKind } from '../entities/enemies';

/** How many of each enemy type a wave sends; at most `maxActiveEnemies` are alive at once. */
export type WaveDefinition = Readonly<Partial<Record<EnemyKind, number>>>;

/**
 * The authored run, in order. Clearing the last wave ends it. Waves 1-5 are Walkers only;
 * each new type then arrives in a wave of its own, a few at a time among the familiar ones,
 * before the last waves mix everything.
 */
export const WAVES: readonly WaveDefinition[] = [
  { walker: 6 },
  { walker: 8 },
  { walker: 9 },
  { walker: 9 },
  { walker: 9 },
  { walker: 8, runner: 3 },
  { walker: 7, runner: 4, brute: 1 },
  { walker: 6, runner: 4, brute: 2, elite: 1 },
  { walker: 6, runner: 5, brute: 2, elite: 2 },
  { walker: 6, runner: 6, brute: 3, elite: 3 },
];

export function waveSize(wave: WaveDefinition): number {
  return ENEMY_KINDS.reduce((sum, kind) => sum + (wave[kind] ?? 0), 0);
}

/**
 * Enemy types that appear in wave *index* (0-based) and in no wave before it. None for the
 * first wave: whatever opens the run is the baseline, not a newcomer.
 */
export function newKinds(index: number): EnemyKind[] {
  if (index === 0) return [];
  return ENEMY_KINDS.filter((kind) => (WAVES[index][kind] ?? 0) > 0 && WAVES.slice(0, index).every((w) => !w[kind]));
}

/**
 * The order a wave's enemies spawn in: each type spread evenly through the wave rather than
 * bunched, so a wave's few Brutes do not all arrive at once. Deterministic.
 */
export function spawnOrder(wave: WaveDefinition): EnemyKind[] {
  const total = waveSize(wave);
  const slots: { kind: EnemyKind; at: number }[] = [];
  for (const kind of ENEMY_KINDS) {
    const count = wave[kind] ?? 0;
    for (let i = 0; i < count; i++) slots.push({ kind, at: ((i + 0.5) * total) / count });
  }
  // Ties keep ENEMY_KINDS order (Array.prototype.sort is stable).
  return slots.sort((a, b) => a.at - b.at).map((slot) => slot.kind);
}
