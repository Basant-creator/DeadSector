import Phaser from 'phaser';
import type { GunId } from '../combat/weapons';
import type { Enemy } from '../entities/Enemy';
import type { EnemyKind } from '../entities/enemies';
import type { AttackPhase, GiantAttackKind } from '../entities/giantRules';
import type { MechState } from '../entities/Mech';
import type { RunOutcome } from '../run/Run';

/**
 * What happened in the fight, announced once per occurrence by the gameplay code. Presentation
 * (audio now; anything later) listens here instead of being called from gameplay classes, so
 * gameplay never knows what a sound or a song is.
 *
 * Events marked "future" have no sender yet: they are the hooks for power-ups, allies, blackouts
 * and an endless wave director. Listeners may subscribe to them today.
 */
export interface GameEventMap {
  /** A gun fired one shot (a shotgun blast is one shot). (x, y) is the muzzle. */
  'shot-fired': { gun: GunId; x: number; y: number; angle: number };
  /** A bullet stopped against a solid: metal pings, masonry thuds. */
  'bullet-impact': { x: number; y: number; material: 'metal' | 'masonry'; solid: string | null };
  /** An enemy took a hit. Once per enemy per 50 ms burst, so a shotgun blast is one event. */
  'enemy-hit': { enemy: Enemy; x: number; y: number; angle: number; source: GunId | 'stomp' };
  /** An enemy died; sent exactly once per enemy, from its single death. */
  'enemy-killed': { enemy: Enemy; kind: EnemyKind };
  /** The player took damage on foot. */
  'player-hurt': { amount: number; heavy: boolean; health: number };
  'player-died': Record<string, never>;
  /** Something was bought: a gate, a weapon, the mech. */
  'purchase': { item: 'gate' | 'weapon' | 'mech'; cost: number };
  /** E pressed at something the player cannot afford. */
  'purchase-refused': { cost: number; balance: number };
  'gate-opened': { gate: 'alley' | 'facility' };
  'weapon-switched': { gun: GunId };
  /** A wave's first enemies are on their way (1-based). */
  'wave-started': { wave: number; waveCount: number };
  'wave-cleared': { wave: number; last: boolean };
  /** A Giant has been announced: it arrives after the warning. */
  'giant-warning': { arrivesInMs: number };
  'giant-arrived': Record<string, never>;
  /** A Giant attack entered a phase. */
  'giant-attack': { kind: GiantAttackKind; phase: AttackPhase };
  /** The Giant's thrown rock hit the ground. */
  'giant-rock-landed': { x: number; y: number };
  'mech-online': Record<string, never>;
  'mech-boarded': Record<string, never>;
  /** The pilot is out: climbed out (parked), out of energy (depleted) or thrown clear (destroyed). */
  'mech-ejected': { why: MechState };
  'mech-hit': { amount: number; heavy: boolean; health: number };
  'mech-stomp': { x: number; y: number; hits: number };
  'run-ended': { outcome: RunOutcome };

  // Future hooks: nothing sends these yet.
  /** A power-up or other pickup was collected. */
  'pickup-collected': { kind: string; x: number; y: number };
  /** The lights went out, and came back. */
  'blackout-started': Record<string, never>;
  'blackout-ended': Record<string, never>;
  /** A temporary ally joined or left the fight. */
  'ally-joined': { kind: string };
  'ally-left': { kind: string };
}

export type GameEventName = keyof GameEventMap;

/**
 * A typed event bus owned by one scene run. The scene makes a new one on every start and
 * `destroy`s it on shutdown, so no listener outlives its run.
 */
export class GameEvents {
  private readonly emitter = new Phaser.Events.EventEmitter();

  on<K extends GameEventName>(event: K, listener: (payload: GameEventMap[K]) => void, context?: unknown): this {
    this.emitter.on(event, listener, context);
    return this;
  }

  off<K extends GameEventName>(event: K, listener: (payload: GameEventMap[K]) => void, context?: unknown): this {
    this.emitter.off(event, listener, context);
    return this;
  }

  emit<K extends GameEventName>(event: K, payload: GameEventMap[K]): void {
    this.emitter.emit(event, payload);
  }

  /** Listeners on every event, for tests and leak checks. */
  get listenerCount(): number {
    return this.emitter.eventNames().reduce((n, e) => n + this.emitter.listenerCount(e), 0);
  }

  destroy(): void {
    this.emitter.removeAllListeners();
  }
}
