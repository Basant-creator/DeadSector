import Phaser from 'phaser';
import { Sfx } from '../audio/sfx';
import { Arsenal } from '../combat/Arsenal';
import { Bullet } from '../combat/Bullet';
import { HEAVY_KINDS, IMPACT, WEAPON_FEEL } from '../combat/feel';
import { type WeaponDef, type WeaponId, WEAPON_IDS, WEAPONS } from '../combat/weapons';
import { Enemy, type EnemyContext } from '../entities/Enemy';
import { ENEMIES, type EnemyKind } from '../entities/enemies';
import { Giant } from '../entities/Giant';
import { muzzleOffset, Player, PLAYER_MAX_HP } from '../entities/Player';
import { Ambience } from '../fx/Ambience';
import { CameraFx } from '../fx/CameraFx';
import { Fx } from '../fx/Fx';
import { HitStop } from '../fx/HitStop';
import { loadProfile, nextShakeLevel, type Profile, saveProfile } from '../run/Profile';
import { Run, type RunOutcome } from '../run/Run';
import { GameOverScreen } from '../ui/GameOverScreen';
import { Hud, type HudState, type NoticeTone } from '../ui/Hud';
import { WaveDirector } from '../waves/WaveDirector';
import { City } from '../world/City';
import { districtAt, SPAWN_POINTS, WORLD_HEIGHT, WORLD_WIDTH } from '../world/cityMap';
import { GATE_COST, GATE_REACH } from '../world/Gate';
import type { Purchasable } from '../world/Purchasable';
import { LOCKER_REACH } from '../world/WeaponLocker';

/** How long a notice such as "not enough coins" stays up. */
const NOTICE_MS = 2200;
const SLOT_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
const VOLUME_STEP = 0.1;
/** Hits on one enemy within this window share one blood spray and one sound. */
const HIT_FEEDBACK_MS = 50;
/** Death sounds pitched by size: small bodies higher, big ones lower, in cents. */
const DEATH_DETUNE: Readonly<Record<EnemyKind, number>> = { walker: 0, runner: 350, brute: -450, elite: -150, giant: -1000 };

/** The city: a player and their weapons, waves of enemies, things to buy, a following camera. */
export class ArenaScene extends Phaser.Scene {
  // The scene object survives a restart, so create() reassigns every field: nothing of a run
  // may outlive it. Enemies, bullets, timers, tweens and listeners go with the scene's shutdown.
  private city!: City;
  private player!: Player;
  private arsenal!: Arsenal;
  private enemies!: Phaser.GameObjects.Group;
  private director!: WaveDirector;
  private purchasables!: Purchasable[];
  private run!: Run;
  private profile!: Profile;
  private hud!: Hud;
  private enemyContext!: EnemyContext;
  /** Presentation only: told what happened, never asked. */
  private fx!: Fx;
  private sfx!: Sfx;
  private cameraFx!: CameraFx;
  private hitStop!: HitStop;
  private ambience!: Ambience;
  /** When each enemy last showed hit feedback; hits closer together than this share it. */
  private hitFeedbackAt = new WeakMap<Enemy, number>();
  private gameOver: GameOverScreen | null = null;
  private notice = { text: '', tone: 'info' as NoticeTone, until: 0 };

  constructor() {
    super('ArenaScene');
  }

  create(): void {
    this.run = new Run(this.time.now);
    this.profile = loadProfile();
    this.gameOver = null;
    this.notice = { text: '', tone: 'info', until: 0 };
    this.hitFeedbackAt = new WeakMap();
    // The physics world outlives the scene: never start a run inside a previous run's hit-stop.
    this.physics.world.resume();
    this.sfx = new Sfx(this);
    this.sfx.configure(this.profile.settings.volume, this.profile.settings.muted);
    this.hitStop = new HitStop(() => this.physics.world.pause(), (ms) => this.afterHitStop(ms));

    // World bounds default to the canvas size; widen them to the whole city.
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.city = new City(this);
    const walls = this.city.walls;

    this.player = new Player(this, this.city.spawn.x, this.city.spawn.y);
    this.physics.add.collider(this.player, walls);

    this.arsenal = new Arsenal(this);
    this.player.holdWeapon(this.arsenal.current.def);
    // A plain group: colliders read its live members, and a destroyed enemy leaves it by itself.
    this.enemies = this.add.group();
    this.director = new WaveDirector(this, {
      spawnPoints: SPAWN_POINTS,
      // The flow field already points at the player, so this is a lookup.
      canSpawnAt: (point) => this.city.nav.isReachable(point),
      enemies: this.enemies,
      player: this.player,
      onEnemyKilled: (enemy) => {
        this.run.recordKill(enemy.coinReward);
        this.killFeedback(enemy);
      },
      onWaveCleared: (_wave, last) => {
        this.run.recordWaveCleared();
        if (last) this.endRun('cleared');
      },
    });
    this.purchasables = this.createPurchasables();

    this.physics.add.collider(this.enemies, walls);
    this.physics.add.collider(this.arsenal.bullets, walls, (b) => this.bulletHitsSolid(b as Bullet));
    this.physics.add.overlap(this.arsenal.bullets, this.enemies, (a, b) => this.onBulletHitsEnemy(a, b));
    this.physics.add.overlap(this.player, this.enemies, (a, b) => this.onEnemyTouchesPlayer(a, b));

    const camera = this.cameras.main;
    // Clamped to the city: the camera never shows past its edge.
    camera.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    // roundPixels must stay off: Phaser floors the scroll after lerping, which swallows the final
    // sub-pixel steps and parks the camera up to 9 px off-centre with lerp 0.1.
    camera.startFollow(this.player, false, 0.1, 0.1);
    this.cameraFx = new CameraFx(camera, this.profile.settings.shake);

    this.fx = new Fx(this);
    this.ambience = new Ambience(this, this.city.lights, this.sfx);
    this.hud = new Hud(this);
    this.enemyContext = {
      player: this.player,
      nav: this.city.nav,
      hurtPlayer: (amount) => this.damagePlayer(amount),
      shake: (intensity, durationMs) => this.cameraFx.shake(intensity, durationMs, this.time.now),
      sound: (key, options) => this.sfx.play(key, options),
      hitStop: (ms) => this.hitStop.trigger(ms, this.time.now),
    };
    // The scene's keyboard plugin drops these listeners on shutdown, so restarts never stack them.
    this.onKey('keydown-E', () => this.tryPurchase());
    this.onKey('keydown-Q', () => this.switchWeapon(() => this.arsenal.cycle()));
    for (const id of WEAPON_IDS) {
      this.onKey(`keydown-${SLOT_KEYS[WEAPONS[id].slot - 1]}`, () => this.selectWeapon(id));
    }
    // Settings work in play and on the end screen alike, and are saved at once.
    this.onKey('keydown-K', () => this.cycleShake());
    this.onKey('keydown-M', () => this.toggleMute());
    // By the character typed, not the key code: Firefox codes - and = differently.
    this.onKey('keydown', (event) => {
      if (event.key === '-' || event.key === '_') this.changeVolume(-VOLUME_STEP);
      else if (event.key === '=' || event.key === '+') this.changeVolume(VOLUME_STEP);
    });
  }

  update(): void {
    const now = this.time.now;
    // During a hit-stop the fight holds still: no movement, firing, enemies or spawns. Effects,
    // the HUD and input carry on.
    const held = this.hitStop.update(now);

    if (!this.run.isOver && !held) {
      this.player.update(now);
      if (this.input.activePointer.leftButtonDown()) {
        const angle = this.player.aimAngle;
        const weapon = this.arsenal.current.def;
        const muzzle = muzzleOffset(weapon);
        const mx = this.player.x + Math.cos(angle) * muzzle;
        const my = this.player.y + Math.sin(angle) * muzzle;
        // Bullets leave from the player's centre, not the muzzle: an enemy pressed against the
        // player stands between the two and would otherwise be skipped. Hidden under the player
        // sprite, the tracer seems to leave the barrel; the flash is drawn at the muzzle.
        if (this.arsenal.tryFire(now, this.player.x, this.player.y, angle, muzzle)) this.shotFeedback(weapon, angle, mx, my, now);
      }
      this.city.nav.setTarget(this.player);
      // A copy: an enemy dying mid-loop leaves the group.
      for (const enemy of this.enemies.getChildren().slice() as Enemy[]) enemy.act(now, this.enemyContext);
      this.director.update(now);
    }

    this.fx.update(now);
    this.ambience.update(now);
    this.hud.update(this.hudState(now));
  }

  /**
   * Listen for a key event, acting on each DOM event once. Phaser re-runs a step's whole key
   * queue every time another key event arrives in that step, so with three or more key events in
   * one frame an earlier keydown is emitted again: a toggle would flip back, a weapon key fire
   * twice. Each handler remembers the events it has handled.
   */
  private onKey(event: string, handler: (event: KeyboardEvent) => void): void {
    const handled = new WeakSet<KeyboardEvent>();
    this.input.keyboard?.on(event, (e: KeyboardEvent) => {
      if (handled.has(e)) return;
      handled.add(e);
      handler(e);
    });
  }

  /**
   * A shot left the barrel: flash, sound, recoil pose and camera kick. All presentation: the
   * bullet's direction was fixed before this ran, and the kick moves the camera along the aim
   * line, which leaves the aim angle unchanged.
   */
  private shotFeedback(weapon: WeaponDef, angle: number, x: number, y: number, now: number): void {
    const feel = WEAPON_FEEL[weapon.id];
    this.fx.muzzle(x, y, angle, weapon.id);
    this.sfx.play(feel.sound, { volume: weapon.id === 'rifle' ? 0.7 : 1 });
    this.player.recoil(now, feel.recoilMs);
    this.cameraFx.kick(angle + Math.PI, feel.kickPx);
    if (feel.shake) this.cameraFx.shake(feel.shake.intensity, feel.shake.ms, now);
  }

  /**
   * A bullet hit a solid. The bullet stops as before; what it hit decides the answer: metal
   * sparks and pings (a car's alarm may go off), brick and concrete puff dust.
   */
  private bulletHitsSolid(bullet: Bullet): void {
    bullet.kill();
    // The bullet's centre stops short of the surface: step ahead along its path into what it hit.
    let hit = null;
    for (let d = 4; d <= 16 && !hit; d += 4) {
      hit = this.city.solidAt(bullet.x + Math.cos(bullet.rotation) * d, bullet.y + Math.sin(bullet.rotation) * d);
    }
    if (hit && (hit.kind === 'car' || hit.kind === 'dumpster' || hit.kind === 'gate')) {
      this.fx.impact(bullet.x, bullet.y);
      this.sfx.play('sfx-ping', { volume: 0.45, detune: hit.kind === 'car' ? 0 : -600 });
      if (hit.kind === 'car') this.ambience.carHit(hit.index, this.time.now);
    } else {
      this.fx.dust(bullet.x, bullet.y);
      this.sfx.play('sfx-impact', { volume: 0.35 });
    }
  }

  /** An enemy died: once per enemy, from its single death event. */
  private killFeedback(enemy: Enemy): void {
    const now = this.time.now;
    const giant = enemy.kind === 'giant';
    this.fx.death(enemy.x, enemy.y, enemy.radius);
    this.sfx.play('sfx-death', { detune: DEATH_DETUNE[enemy.kind] });
    const shake = giant ? IMPACT.shake.heavy : IMPACT.shake.kill;
    this.cameraFx.shake(shake.intensity, shake.ms, now);
    const hold = giant ? IMPACT.hitStop.giantDeath : HEAVY_KINDS.has(enemy.kind) ? IMPACT.hitStop.heavyKill : IMPACT.hitStop.kill;
    if (!this.run.isOver) this.hitStop.trigger(hold, now);
  }

  /** A hit-stop just ended after *ms*: physics resumes, and no timer loses the frozen time. */
  private afterHitStop(ms: number): void {
    this.physics.world.resume();
    this.player.shiftTimers(ms);
    this.arsenal.shiftTimers(ms);
    for (const enemy of this.enemies.getChildren() as Enemy[]) enemy.shiftTimers(ms);
  }

  private cycleShake(): void {
    const settings = this.profile.settings;
    settings.shake = nextShakeLevel(settings.shake);
    this.cameraFx.setLevel(settings.shake);
    this.settingsChanged(`SCREEN SHAKE: ${settings.shake.toUpperCase()}`);
  }

  private toggleMute(): void {
    const settings = this.profile.settings;
    settings.muted = !settings.muted;
    this.settingsChanged(settings.muted ? 'SOUND: MUTED' : `SOUND: ON, VOLUME ${Math.round(settings.volume * 100)}%`);
  }

  private changeVolume(delta: number): void {
    const settings = this.profile.settings;
    settings.volume = Math.round(Phaser.Math.Clamp(settings.volume + delta, 0, 1) * 10) / 10;
    settings.muted = false;
    this.settingsChanged(`VOLUME ${Math.round(settings.volume * 100)}%`);
  }

  private settingsChanged(notice: string): void {
    const { settings } = this.profile;
    this.sfx.configure(settings.volume, settings.muted);
    saveProfile(this.profile);
    this.gameOver?.showSettings(settings);
    this.showNotice(notice, 'info');
  }

  /** The gate and one item per weapon locker, all bought through `tryPurchase`. */
  private createPurchasables(): Purchasable[] {
    const gate = this.city.gate;
    const gateItem: Purchasable = {
      position: gate.centre,
      reach: GATE_REACH,
      cost: GATE_COST,
      noun: 'the gate',
      action: 'open the alley gate',
      isAvailable: () => !gate.isOpen,
      deliver: () => {
        this.city.openGate();
        return `GATE OPEN: -${GATE_COST} coins. The Narrow Alleys are open.`;
      },
    };
    const lockerItems = this.city.lockers.map((locker): Purchasable => {
      const def = WEAPONS[locker.weapon];
      return {
        position: locker.standAt,
        reach: LOCKER_REACH,
        cost: def.cost,
        noun: `the ${def.name}`,
        action: `buy the ${def.name}`,
        isAvailable: () => !this.arsenal.owns(def.id),
        deliver: () => {
          this.arsenal.grant(def.id);
          this.player.holdWeapon(def);
          locker.showForSale(false);
          return `${def.name.toUpperCase()} BOUGHT: -${def.cost} coins. In hand; key ${def.slot} selects it.`;
        },
      };
    });
    return [gateItem, ...lockerItems];
  }

  /** The nearest item still for sale within reach of the player, if any. */
  private purchasableInReach(): Purchasable | undefined {
    let best: Purchasable | undefined;
    let bestDistance = Infinity;
    for (const item of this.purchasables) {
      if (!item.isAvailable()) continue;
      const distance = Phaser.Math.Distance.BetweenPoints(this.player, item.position);
      if (distance <= item.reach && distance < bestDistance) {
        best = item;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * E: buy what is in reach, or say why not. The one place coins are spent: the item stops
   * being available as it is delivered, so a second press, or a held key, buys nothing more.
   */
  private tryPurchase(): void {
    if (this.run.isOver) return;
    const item = this.purchasableInReach();
    if (!item) return;
    if (!this.run.spend(item.cost)) {
      this.showNotice(`NOT ENOUGH COINS: ${item.noun} costs ${item.cost}, you have ${this.run.coinBalance}`, 'warn');
      return;
    }
    this.showNotice(item.deliver(), 'info');
  }

  private selectWeapon(id: WeaponId): void {
    if (this.run.isOver) return;
    const def = WEAPONS[id];
    if (!this.arsenal.owns(id)) {
      this.showNotice(`NOT OWNED: the ${def.name} is sold at a weapon locker for ${def.cost} coins`, 'warn');
      return;
    }
    this.switchWeapon(() => this.arsenal.equip(id));
  }

  private switchWeapon(change: () => boolean): void {
    if (this.run.isOver || !change()) return;
    this.player.holdWeapon(this.arsenal.current.def);
  }

  private showNotice(text: string, tone: NoticeTone): void {
    this.notice = { text, tone, until: this.time.now + NOTICE_MS };
  }

  private hudState(now: number): HudState {
    const director = this.director;
    const seconds = Math.ceil(director.intermissionLeftMs(now) / 1000);
    const left = director.remaining;
    const item = this.run.isOver ? undefined : this.purchasableInReach();
    const showNotice = !this.run.isOver && now < this.notice.until;
    const fresh = director.newKinds.map((kind) => ENEMIES[kind].name.toUpperCase());
    const boss = director.boss;
    const warningLeft = this.run.isOver ? 0 : director.giantWarningLeftMs(now);
    return {
      health: this.player.health,
      maxHealth: PLAYER_MAX_HP,
      wave: director.waveNumber,
      waveCount: director.waveCount,
      waveStatus: {
        intermission: `next wave in ${seconds}`,
        active: director.waitingOnGiant ? 'the Giant remains' : `${left} ${left === 1 ? 'enemy' : 'enemies'} left`,
        complete: 'all waves cleared',
        stopped: 'run over',
      }[director.phase],
      coins: this.run.coinBalance,
      weapon: this.arsenal.current.def.id,
      ownedWeapons: new Set(WEAPON_IDS.filter((id) => this.arsenal.owns(id))),
      elapsedMs: this.run.survivalMs(now),
      banner: director.phase === 'intermission'
        ? [`WAVE ${director.waveNumber}`, ...(fresh.length > 0 ? [`NEW: ${fresh.join(', ')}`] : []), `${seconds}`].join('\n')
        : '',
      district: districtAt(this.player).name,
      prompt: item ? `[E] ${item.action}: ${item.cost} coins` : '',
      notice: showNotice ? this.notice.text : '',
      noticeTone: this.notice.tone,
      boss: boss && !boss.isDead ? { name: boss.def.name, health: boss.health, maxHealth: boss.def.maxHp } : null,
      // Pulses twice a second until the Giant arrives.
      warning: warningLeft > 0 ? `WARNING: A GIANT IS COMING (${Math.ceil(warningLeft / 1000)})` : '',
      warningBright: Math.floor(now / 250) % 2 === 0,
    };
  }

  private onBulletHitsEnemy(a: unknown, b: unknown): void {
    const bullet = (a instanceof Bullet ? a : b) as Bullet;
    const enemy = (a instanceof Enemy ? a : b) as Enemy;
    // A bullet is spent by its first hit: disabling it here stops it reaching anything else.
    // A dead enemy takes no hits, so pellets landing after the killing one pass on.
    if (!bullet.active || enemy.isDead) return;
    bullet.kill();
    const now = this.time.now;
    enemy.takeDamage(bullet.damage);
    const feel = bullet.weapon ? WEAPON_FEEL[bullet.weapon] : null;
    if (feel) enemy.knockback(bullet.rotation, feel.knockback, now);
    // One spray and one sound per enemy per burst: a blast's six pellets can land a frame or two
    // apart, yet should read as one hit. Rifle shots, 100 ms apart, each still get their own.
    if (now - (this.hitFeedbackAt.get(enemy) ?? -Infinity) < HIT_FEEDBACK_MS) return;
    this.hitFeedbackAt.set(enemy, now);
    const giant = enemy.kind === 'giant';
    this.fx.blood(bullet.x, bullet.y, bullet.rotation, giant);
    this.sfx.play('sfx-hit', { detune: giant ? -800 : 0, volume: giant ? 1 : 0.75 });
    if (bullet.weapon === 'pistol' || giant) this.cameraFx.shake(IMPACT.shake.hit.intensity, IMPACT.shake.hit.ms, now);
  }

  private onEnemyTouchesPlayer(a: unknown, b: unknown): void {
    const enemy = (a instanceof Enemy ? a : b) as Enemy;
    if (enemy.isDead) return;
    // Fires every step the two overlap; the player's invulnerability window turns that into
    // one hit per touch. A Giant's touch (and its charge) lands like a heavy attack.
    this.damagePlayer(enemy.contactDamage, enemy instanceof Giant);
  }

  /**
   * Every hit on the player goes through here: touches and the Giant's attacks alike. Returns
   * whether it landed; the invulnerability window after a hit absorbs the rest.
   */
  private damagePlayer(amount: number, heavy = false): boolean {
    const now = this.time.now;
    if (this.run.isOver || !this.player.takeDamage(amount, now)) return false;
    const shake = heavy ? IMPACT.shake.heavy : IMPACT.shake.playerHurt;
    this.cameraFx.shake(shake.intensity, shake.ms, now);
    this.fx.playerHurt();
    this.sfx.play('sfx-hurt');
    if (this.player.isDead) {
      this.endRun('died');
      return true;
    }
    this.hitStop.trigger(heavy ? IMPACT.hitStop.giantAttack : IMPACT.hitStop.playerHurt, now);
    return true;
  }

  /** Freeze the city, bank the high score, and show the summary. Runs once per run. */
  private endRun(outcome: RunOutcome): void {
    if (this.run.isOver) return;
    const now = this.time.now;
    // Nothing waits on a hit-stop: the end screen and restart come at once.
    this.hitStop.release(now);
    this.run.end(outcome, now);
    this.director.stop();
    // A cleared run leaves the player standing; stop it where it is.
    this.player.setVelocity(0, 0).setAlpha(1);
    for (const enemy of this.enemies.getChildren() as Enemy[]) enemy.halt();

    const stats = this.run.stats(now);
    const newHighScore = stats.coins > this.profile.highScore;
    if (newHighScore) {
      this.profile.highScore = stats.coins;
      saveProfile(this.profile);
    }
    this.gameOver = new GameOverScreen(this, {
      outcome,
      stats,
      waveCount: this.director.waveCount,
      highScore: this.profile.highScore,
      newHighScore,
      settings: this.profile.settings,
    });

    // The scene's keyboard plugin drops this listener on shutdown, so a restart starts clean.
    this.input.keyboard?.once('keydown-R', () => this.scene.restart());
  }
}
