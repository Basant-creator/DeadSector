import { IMPACT } from '../combat/feel';

/**
 * Hit-stop: a beat of stillness on a significant impact. While it holds, the scene stops the
 * physics world, the player's movement and firing, and every enemy; input, the HUD and effects
 * keep running, so nothing can get stuck. When it ends, `onResume` gets the frozen duration so
 * the few timers that must not lose time (bullet range, the Giant's attack phases, the player's
 * invulnerability) can be pushed back by it.
 */
export class HitStop {
  private until = 0;
  private startedAt = 0;
  private lastEndedAt = -Infinity;
  private active = false;
  private readonly onFreeze: () => void;
  private readonly onResume: (frozenMs: number) => void;

  constructor(onFreeze: () => void, onResume: (frozenMs: number) => void) {
    this.onFreeze = onFreeze;
    this.onResume = onResume;
  }

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Hold for *ms* from *now*. Ignored too soon after the last one, and never stacked: a longer
   * request during a hit-stop extends it only up to its own length.
   */
  trigger(ms: number, now: number): void {
    if (!this.active && now - this.lastEndedAt < IMPACT.hitStopGapMs) return;
    if (!this.active) {
      this.active = true;
      this.startedAt = now;
      this.until = now + ms;
      this.onFreeze();
      return;
    }
    this.until = Math.max(this.until, this.startedAt + ms);
  }

  /** Ends the hit-stop once its time is up. Returns whether it still holds. */
  update(now: number): boolean {
    if (this.active && now >= this.until) this.end(now);
    return this.active;
  }

  /** End at once (death, run end): nothing waits on a hit-stop. */
  release(now: number): void {
    if (this.active) this.end(now);
  }

  private end(now: number): void {
    this.active = false;
    this.lastEndedAt = now;
    this.onResume(now - this.startedAt);
  }
}
