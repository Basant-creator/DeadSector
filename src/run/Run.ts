/**
 * - playing: the run is live.
 * - over: it ended; its stats are final.
 */
export type RunStatus = 'playing' | 'over';

/** How a run ended: the player died, or every wave was cleared. */
export type RunOutcome = 'died' | 'cleared';

export interface RunStats {
  readonly kills: number;
  /** Coins collected over the run; spending them does not lower it. */
  readonly coins: number;
  readonly wavesSurvived: number;
  readonly survivalMs: number;
}

/**
 * Everything one run accumulates. The scene makes a new Run on every start, so nothing in
 * here can outlive its run; only the high score is carried over, through the profile.
 *
 * Once the run is over its stats are frozen: a Walker killed afterwards by a bullet still in
 * flight earns nothing.
 */
export class Run {
  private currentStatus: RunStatus = 'playing';
  private endedWith: RunOutcome | null = null;
  private kills = 0;
  private collected = 0;
  private balance = 0;
  private wavesSurvived = 0;
  private readonly startedAt: number;
  private endedAt = 0;

  constructor(now: number) {
    this.startedAt = now;
  }

  get status(): RunStatus {
    return this.currentStatus;
  }

  get isOver(): boolean {
    return this.currentStatus === 'over';
  }

  /** How the run ended, or null while it is still being played. */
  get outcome(): RunOutcome | null {
    return this.endedWith;
  }

  /** Coins available to spend. */
  get coinBalance(): number {
    return this.balance;
  }

  recordKill(coinReward: number): void {
    if (this.isOver) return;
    this.kills++;
    this.collected += coinReward;
    this.balance += coinReward;
  }

  /** Pay *amount* from the balance. Returns false, and takes nothing, if it is short or the run is over. */
  spend(amount: number): boolean {
    if (this.isOver || amount > this.balance) return false;
    this.balance -= amount;
    return true;
  }

  recordWaveCleared(): void {
    if (!this.isOver) this.wavesSurvived++;
  }

  /** End the run. Only the first call counts. */
  end(outcome: RunOutcome, now: number): void {
    if (this.isOver) return;
    this.currentStatus = 'over';
    this.endedWith = outcome;
    this.endedAt = now;
  }

  /** Time since the run started, stopped at the moment it ended. */
  survivalMs(now: number): number {
    return (this.isOver ? this.endedAt : now) - this.startedAt;
  }

  stats(now: number): RunStats {
    return {
      kills: this.kills,
      coins: this.collected,
      wavesSurvived: this.wavesSurvived,
      survivalMs: this.survivalMs(now),
    };
  }
}

/** 83500 ms -> "01:23". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
