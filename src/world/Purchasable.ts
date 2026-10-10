import type { Point } from '../waves/WaveDirector';

/**
 * Anything bought by standing near it and pressing E: the alley gate, a weapon locker. The
 * scene owns the one purchase path (reach check, payment, feedback); an item only says where
 * it is, what it costs, whether it is still for sale, and what buying it does.
 */
export interface Purchasable {
  /** What buying it is, for feedback: boarding a parked mech is free and not a purchase. */
  readonly kind: 'gate' | 'weapon' | 'mech' | 'board';
  /** Where the player must stand within `reach` of. */
  readonly position: Point;
  readonly reach: number;
  readonly cost: number;
  /** "the gate", "the Shotgun": names it in the not-enough-coins message. */
  readonly noun: string;
  /** "open the alley gate": the prompt's verb phrase. */
  readonly action: string;
  /** Whether it can still be bought; false once bought, for the rest of the run. */
  isAvailable(): boolean;
  /** Deliver the item. Called once, after the cost is paid. Returns the notice to show. */
  deliver(): string;
}
