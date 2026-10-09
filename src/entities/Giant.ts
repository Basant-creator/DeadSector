import Phaser from 'phaser';
import { Enemy, type EnemyContext } from './Enemy';
import { type AttackPhase, GIANT, type GiantAttackKind } from './giantRules';

const DANGER = 0xc8553d;
/** Height of a thrown rock's arc at mid-flight, in px. */
const THROW_ARC = 90;

interface Attack {
  readonly kind: GiantAttackKind;
  phase: AttackPhase;
  phaseStartedAt: number;
  phaseEndsAt: number;
  /** Whether this attack has already hurt (or missed) the player. */
  resolved: boolean;
  /** Where the attack started from: the Giant at wind-up (slam, charge) or at the throw. */
  from: { x: number; y: number };
  /** Charge: unit direction and lane length, both locked when the wind-up starts. */
  dir: { x: number; y: number };
  length: number;
  /** Debris: where it lands. Follows the player through the wind-up, locked at the throw. */
  target: { x: number; y: number };
}

/**
 * The boss. Pursues like any enemy between attacks; when one is ready and the player is in
 * range, it stops and runs the attack's wind-up (drawn on the ground), active and recovery
 * phases. Everything is timed from `now` in `act`, with no Phaser timers, and every effect it
 * draws is its own: dying, halting or being destroyed with the scene removes them all.
 */
export class Giant extends Enemy {
  /** Picks between attacks that are all in range; replaceable for tests. */
  random: () => number = Math.random;
  private attack: Attack | null = null;
  private nextAttackAt: number;
  private readonly telegraph: Phaser.GameObjects.Graphics;
  private rock: Phaser.GameObjects.Arc | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'giant');
    // Above the ground and buildings, below every body.
    this.telegraph = scene.add.graphics().setDepth(0.5);
    this.nextAttackAt = scene.time.now + GIANT.attackCooldownMs;
  }

  /** Charging hits harder than a plain touch. */
  override get contactDamage(): number {
    const a = this.attack;
    return a?.kind === 'charge' && a.phase === 'active' ? GIANT.charge.damage : super.contactDamage;
  }

  /** The attack in progress and its phase, or null while pursuing. */
  get currentAttack(): { kind: GiantAttackKind; phase: AttackPhase } | null {
    return this.attack ? { kind: this.attack.kind, phase: this.attack.phase } : null;
  }

  override act(now: number, ctx: EnemyContext): void {
    if (this.isDead) return;
    if (!this.attack && now >= this.nextAttackAt && !ctx.player.isDead) {
      const kind = this.chooseAttack(ctx);
      if (kind) this.beginAttack(kind, now, ctx);
    }
    if (!this.attack) {
      super.act(now, ctx);
      return;
    }
    this.advance(now, ctx);
    this.draw(now);
  }

  /** Start *kind* now, whatever the range. Public so tests can trigger each attack. */
  beginAttack(kind: GiantAttackKind, now: number, ctx: EnemyContext): void {
    this.setVelocity(0, 0);
    const { player } = ctx;
    const angle = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    this.setRotation(angle);
    this.attack = {
      kind,
      phase: 'windUp',
      phaseStartedAt: now,
      phaseEndsAt: now + GIANT[kind].windUpMs,
      resolved: false,
      from: { x: this.x, y: this.y },
      dir,
      length: kind === 'charge' ? this.laneLength(dir, ctx) : 0,
      target: { x: player.x, y: player.y },
    };
  }

  override halt(): void {
    this.clearAttack();
    super.halt();
  }

  override destroy(fromScene?: boolean): void {
    this.clearAttack();
    this.telegraph.destroy();
    super.destroy(fromScene);
  }

  protected override die(): void {
    this.clearAttack();
    this.telegraph.destroy();
    super.die();
  }

  private chooseAttack(ctx: EnemyContext): GiantAttackKind | null {
    const { player, nav } = ctx;
    const distance = Phaser.Math.Distance.BetweenPoints(this, player);
    if (distance <= GIANT.slam.triggerRange) return 'slam';
    const options: GiantAttackKind[] = [];
    const { charge, debris } = GIANT;
    if (distance >= charge.minRange && distance <= charge.maxRange && nav.isClear(this, player, this.radius)) {
      options.push('charge');
    }
    if (distance >= debris.minRange && distance <= debris.maxRange) options.push('debris');
    return options.length > 0 ? options[Math.floor(this.random() * options.length)] : null;
  }

  /** How far a charge along *dir* can go before the body would meet a wall. */
  private laneLength(dir: { x: number; y: number }, ctx: EnemyContext): number {
    const step = 8;
    for (let length = step; length <= GIANT.charge.maxDistance; length += step) {
      const end = { x: this.x + dir.x * length, y: this.y + dir.y * length };
      if (!ctx.nav.isClear(this, end, this.radius)) return length - step;
    }
    return GIANT.charge.maxDistance;
  }

  private advance(now: number, ctx: EnemyContext): void {
    const a = this.attack!;
    if (a.phase === 'windUp') {
      if (a.kind !== 'charge') this.setRotation(Phaser.Math.Angle.Between(this.x, this.y, ctx.player.x, ctx.player.y));
      if (a.kind === 'debris') a.target = { x: ctx.player.x, y: ctx.player.y };
      // Pulse while winding up, so the Giant itself reads as about to act.
      this.setScale(1 + 0.06 * Math.sin(((now - a.phaseStartedAt) / 1000) * Math.PI * 8));
      if (now >= a.phaseEndsAt) this.enterActive(now, ctx);
      return;
    }
    if (a.phase === 'active') {
      if (a.kind === 'slam') this.slamActive(a, ctx);
      else if (a.kind === 'charge') this.chargeActive(a, now);
      else this.debrisActive(a, now, ctx);
      if (this.attack === a && a.phase === 'active' && now >= a.phaseEndsAt) this.enterRecovery(now, ctx);
      return;
    }
    this.setVelocity(0, 0);
    if (now >= a.phaseEndsAt) {
      this.clearAttack();
      this.nextAttackAt = now + GIANT.attackCooldownMs;
    }
  }

  private enterActive(now: number, ctx: EnemyContext): void {
    const a = this.attack!;
    this.setScale(1);
    a.phase = 'active';
    a.phaseStartedAt = now;
    if (a.kind === 'slam') {
      a.phaseEndsAt = now + GIANT.slam.activeMs;
      ctx.shake(220, 0.012);
    } else if (a.kind === 'charge') {
      a.phaseEndsAt = now + (a.length / GIANT.charge.speed) * 1000;
      a.from = { x: this.x, y: this.y };
    } else {
      a.phaseEndsAt = now + GIANT.debris.flightMs;
      a.from = { x: this.x, y: this.y };
      a.target = { x: ctx.player.x, y: ctx.player.y };
      this.rock = this.scene.add.circle(this.x, this.y, 9, 0x8a7a6a).setStrokeStyle(2, 0x5a4e44).setDepth(4);
    }
  }

  private enterRecovery(now: number, ctx: EnemyContext): void {
    const a = this.attack!;
    if (a.kind === 'debris') this.landRock(a, ctx);
    this.setVelocity(0, 0);
    a.phase = 'recovery';
    a.phaseStartedAt = now;
    a.phaseEndsAt = now + GIANT[a.kind].recoveryMs;
  }

  /** Hits once, if the player is inside the ring while the slam is active. */
  private slamActive(a: Attack, ctx: EnemyContext): void {
    if (a.resolved) return;
    if (Phaser.Math.Distance.BetweenPoints(this, ctx.player) <= GIANT.slam.radius) {
      a.resolved = true;
      ctx.hurtPlayer(GIANT.slam.damage);
    }
  }

  /** Runs down the locked lane; its damage is the contact damage while charging. */
  private chargeActive(a: Attack, now: number): void {
    const travelled = Phaser.Math.Distance.BetweenPoints(a.from, this);
    const body = this.body as Phaser.Physics.Arcade.Body;
    // Ignore contacts from the first frames: the Giant may start the charge against a wall.
    const blocked = now - a.phaseStartedAt > 100 && !body.blocked.none;
    if (travelled >= a.length || blocked) {
      a.phaseEndsAt = now;
      return;
    }
    this.setVelocity(a.dir.x * GIANT.charge.speed, a.dir.y * GIANT.charge.speed);
  }

  private debrisActive(a: Attack, now: number, ctx: EnemyContext): void {
    if (!this.rock) return;
    const t = Phaser.Math.Clamp((now - a.phaseStartedAt) / GIANT.debris.flightMs, 0, 1);
    this.rock.setPosition(
      Phaser.Math.Linear(a.from.x, a.target.x, t),
      Phaser.Math.Linear(a.from.y, a.target.y, t) - Math.sin(t * Math.PI) * THROW_ARC,
    );
    if (t >= 1) this.landRock(a, ctx);
  }

  private landRock(a: Attack, ctx: EnemyContext): void {
    if (a.resolved) return;
    a.resolved = true;
    this.rock?.destroy();
    this.rock = null;
    ctx.shake(120, 0.006);
    if (Phaser.Math.Distance.BetweenPoints(a.target, ctx.player) <= GIANT.debris.impactRadius) {
      ctx.hurtPlayer(GIANT.debris.damage);
    }
  }

  /** Drop the attack in progress and everything it drew. */
  private clearAttack(): void {
    this.attack = null;
    this.rock?.destroy();
    this.rock = null;
    if (this.telegraph.scene) this.telegraph.clear();
    if (this.scene) this.setScale(1);
  }

  private draw(now: number): void {
    const g = this.telegraph;
    g.clear();
    const a = this.attack;
    if (!a) return;
    const p = Phaser.Math.Clamp((now - a.phaseStartedAt) / Math.max(1, a.phaseEndsAt - a.phaseStartedAt), 0, 1);

    if (a.kind === 'slam') {
      const r = GIANT.slam.radius;
      if (a.phase === 'windUp') {
        g.lineStyle(3, DANGER, 0.9).strokeCircle(this.x, this.y, r);
        g.fillStyle(DANGER, 0.12 + 0.25 * p).fillCircle(this.x, this.y, r * p);
      } else if (a.phase === 'active') {
        g.fillStyle(DANGER, 0.55).fillCircle(this.x, this.y, r);
      } else {
        g.lineStyle(2, DANGER, 0.5 * (1 - p)).strokeCircle(this.x, this.y, r);
      }
    } else if (a.kind === 'charge') {
      if (a.phase === 'recovery') return;
      const half = this.radius;
      const { from, dir, length } = a;
      const nx = -dir.y * half;
      const ny = dir.x * half;
      const lane = [
        { x: from.x + nx, y: from.y + ny },
        { x: from.x + dir.x * length + nx, y: from.y + dir.y * length + ny },
        { x: from.x + dir.x * length - nx, y: from.y + dir.y * length - ny },
        { x: from.x - nx, y: from.y - ny },
      ];
      const flash = a.phase === 'windUp' ? 0.12 + 0.25 * p + 0.1 * Math.sin(p * Math.PI * 8) : 0.3;
      g.fillStyle(DANGER, flash).fillPoints(lane, true);
      g.lineStyle(2, DANGER, 0.9).strokePoints(lane, true);
    } else {
      const r = GIANT.debris.impactRadius;
      if (a.phase === 'windUp') {
        // Aiming: a reticle on the player and a sight line, until the throw locks the spot.
        g.lineStyle(2, DANGER, 0.35 + 0.45 * p).strokeCircle(a.target.x, a.target.y, r);
        g.lineStyle(1, DANGER, 0.25 + 0.35 * p).lineBetween(this.x, this.y, a.target.x, a.target.y);
      } else if (a.phase === 'active') {
        g.lineStyle(3, DANGER, 0.9).strokeCircle(a.target.x, a.target.y, r);
        g.fillStyle(DANGER, 0.15 + 0.3 * p).fillCircle(a.target.x, a.target.y, r * p);
      } else if (a.phase === 'recovery') {
        g.lineStyle(2, DANGER, 0.5 * (1 - p)).strokeCircle(a.target.x, a.target.y, r);
      }
    }
  }
}
