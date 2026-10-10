import Phaser from 'phaser';
import { AudioManager } from '../audio/AudioManager';
import { MUSIC } from '../audio/music';
import { Arsenal } from '../combat/Arsenal';
import { Bullet } from '../combat/Bullet';
import { HEAVY_KINDS, IMPACT, WEAPON_FEEL } from '../combat/feel';
import { type WeaponDef, type WeaponId, WEAPON_IDS, WEAPONS } from '../combat/weapons';
import { Enemy, type EnemyContext } from '../entities/Enemy';
import { ENEMIES } from '../entities/enemies';
import { Giant } from '../entities/Giant';
import { Mech, type MechState } from '../entities/Mech';
import { muzzleOffset, Player, PLAYER_BODY_RADIUS, PLAYER_MAX_HP } from '../entities/Player';
import { Ambience } from '../fx/Ambience';
import { CameraFx } from '../fx/CameraFx';
import { Fx } from '../fx/Fx';
import { GameEvents } from '../events/GameEvents';
import { HitStop } from '../fx/HitStop';
import { MECH } from '../mech/mechRules';
import { loadProfile, nextShakeLevel, type Profile, saveProfile } from '../run/Profile';
import { Run, type RunOutcome } from '../run/Run';
import { GameOverScreen } from '../ui/GameOverScreen';
import { Hud, type HudState, type MechHud, type NoticeTone } from '../ui/Hud';
import { WaveDirector } from '../waves/WaveDirector';
import { City } from '../world/City';
import { districtAt, MECH_BAY, SPAWN_POINTS, WORLD_HEIGHT, WORLD_WIDTH } from '../world/cityMap';
import { FACILITY_GATE_COST, GATE_COST, GATE_REACH } from '../world/Gate';
import type { Purchasable } from '../world/Purchasable';
import { LOCKER_REACH } from '../world/WeaponLocker';

/** How long a notice such as "not enough coins" stays up. */
const NOTICE_MS = 2200;
const SLOT_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
const VOLUME_STEP = 0.1;
/** Volume keys, by the character typed: - and + master, [ and ] music, , and . effects. */
const VOLUME_KEYS: Readonly<Record<string, readonly ['volume' | 'music' | 'sfx', number]>> = {
  '-': ['volume', -1], '_': ['volume', -1], '=': ['volume', 1], '+': ['volume', 1],
  '[': ['music', -1], ']': ['music', 1], ',': ['sfx', -1], '.': ['sfx', 1],
};
const VOLUME_NAMES = { volume: 'VOLUME', music: 'MUSIC', sfx: 'EFFECTS' } as const;
/** Hits on one enemy within this window share one blood spray and one 'enemy-hit' event. */
const HIT_FEEDBACK_MS = 50;

/** The camera's follow: smooth enough that the shot kick eases back by itself. */
const FOLLOW_LERP = 0.1;
/** Enemies within this many px of the mech decide which side its pilot climbs out on. */
const HATCH_DANGER_RANGE = 300;

/**
 * The city: a player and their weapons, waves of enemies, things to buy, the mech, a following
 * camera.
 */
export class ArenaScene extends Phaser.Scene {
  // The scene object survives a restart, so create() reassigns every field: nothing of a run
  // may outlive it. Enemies, bullets, timers, tweens and listeners go with the scene's shutdown.
  private city!: City;
  private player!: Player;
  /**
   * One per run, waiting in its bay. While the player pilots it, the player is hidden inside and
   * carried along, so everything that chases or targets the player chases the mech.
   */
  private mech!: Mech;
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
  /** What happened this run, announced once; audio (and future systems) listen. */
  private bus!: GameEvents;
  /** Every sound and the music: answers `events`, never called by gameplay. */
  private audio!: AudioManager;
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
    this.bus = new GameEvents();
    // Its listeners go with the run.
    this.sys.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.bus.destroy());
    this.audio = new AudioManager(this, this.bus, this.profile.settings);
    this.hitStop = new HitStop(() => this.physics.world.pause(), (ms) => this.afterHitStop(ms));

    // World bounds default to the canvas size; widen them to the whole city.
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.city = new City(this);
    const walls = this.city.walls;

    this.player = new Player(this, this.city.spawn.x, this.city.spawn.y);
    this.physics.add.collider(this.player, walls);
    this.mech = new Mech(this, MECH_BAY.x, MECH_BAY.y);
    this.physics.add.collider(this.mech, walls);

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
      onWaveCleared: (wave, last) => {
        this.run.recordWaveCleared();
        this.bus.emit('wave-cleared', { wave, last });
        if (last) this.endRun('cleared');
      },
      onWaveStarted: (wave) => this.bus.emit('wave-started', { wave, waveCount: this.director.waveCount }),
      onGiantAnnounced: (arrivesInMs) => this.bus.emit('giant-warning', { arrivesInMs }),
      onGiantArrived: () => this.bus.emit('giant-arrived', {}),
    });
    this.purchasables = this.createPurchasables();

    this.physics.add.collider(this.enemies, walls);
    this.physics.add.collider(this.arsenal.bullets, walls, (b) => this.bulletHitsSolid(b as Bullet));
    this.physics.add.overlap(this.arsenal.bullets, this.enemies, (a, b) => this.onBulletHitsEnemy(a, b));
    this.physics.add.overlap(this.player, this.enemies, (a, b) => this.onEnemyTouchesPlayer(a, b));
    // Only while piloted does the mech have a body: it shoulders enemies aside and they claw at it.
    this.physics.add.collider(this.mech, this.enemies, (a, b) => this.onEnemyTouchesMech(a, b));

    const camera = this.cameras.main;
    // Clamped to the city: the camera never shows past its edge.
    camera.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    // roundPixels must stay off: Phaser floors the scroll after lerping, which swallows the final
    // sub-pixel steps and parks the camera up to 9 px off-centre with lerp 0.1.
    camera.startFollow(this.player, false, FOLLOW_LERP, FOLLOW_LERP);
    this.cameraFx = new CameraFx(camera, this.profile.settings.shake);

    this.fx = new Fx(this);
    this.ambience = new Ambience(this, this.city.lights, this.audio);
    this.hud = new Hud(this);
    this.enemyContext = {
      player: this.player,
      nav: this.city.nav,
      hurtPlayer: (amount) => this.damagePlayer(amount),
      shake: (intensity, durationMs) => this.cameraFx.shake(intensity, durationMs, this.time.now),
      events: this.bus,
      hitStop: (ms) => this.hitStop.trigger(ms, this.time.now),
    };
    // The scene's keyboard plugin drops these listeners on shutdown, so restarts never stack them.
    this.onKey('keydown-E', (event) => this.interact(event));
    this.onKey('keydown-SPACE', () => this.stomp());
    this.onKey('keydown-Q', () => this.switchWeapon(() => this.arsenal.cycle()));
    for (const id of WEAPON_IDS) {
      this.onKey(`keydown-${SLOT_KEYS[WEAPONS[id].slot - 1]}`, () => this.selectWeapon(id));
    }
    // Settings work in play and on the end screen alike, and are saved at once.
    this.onKey('keydown-K', () => this.cycleShake());
    this.onKey('keydown-M', () => this.toggleMute());
    // By the character typed, not the key code: Firefox codes - and = differently.
    this.onKey('keydown', (event) => {
      const step = VOLUME_KEYS[event.key];
      if (step) this.changeVolume(step[0], step[1] * VOLUME_STEP);
    });
  }

  update(): void {
    const now = this.time.now;
    // During a hit-stop the fight holds still: no movement, firing, enemies or spawns. Effects,
    // the HUD and input carry on.
    const held = this.hitStop.update(now);

    if (!this.run.isOver && !held) {
      if (this.player.isInVehicle) this.updateMech(now);
      else this.player.update(now);
      if (!this.player.isInVehicle && this.input.activePointer.leftButtonDown()) {
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
    this.audio.update(this.musicSignals(now));
    this.hud.update(this.hudState(now));
  }

  /** What the fight looks like to the music: how threatening the living enemies are, and what is under way. */
  private musicSignals(now: number) {
    let threat = 0;
    for (const enemy of this.enemies.getChildren() as Enemy[]) if (!enemy.isDead) threat += MUSIC.threatWeight[enemy.kind];
    const director = this.director;
    return {
      threat,
      waveActive: director.phase === 'active',
      giant: (director.boss !== null && !director.boss.isDead) || director.giantWarningLeftMs(now) > 0,
      runOver: this.run.isOver,
    };
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
    this.bus.emit('shot-fired', { gun: weapon.id, x, y, angle });
    this.player.recoil(now, feel.recoilMs);
    this.cameraFx.kick(angle + Math.PI, feel.kickPx);
    if (feel.shake) this.cameraFx.shake(feel.shake.intensity, feel.shake.ms, now);
  }

  /** One frame in the mech: walk, aim, fire, carry the player along, and let them out if it is spent. */
  private updateMech(now: number): void {
    const mech = this.mech;
    mech.update(now);
    if (this.input.activePointer.leftButtonDown()) {
      const shot = mech.fire(now, this.arsenal.bullets);
      if (shot) {
        const feel = WEAPON_FEEL.mech;
        this.fx.muzzle(shot.x, shot.y, shot.angle, 'mech');
        this.bus.emit('shot-fired', { gun: 'mech', x: shot.x, y: shot.y, angle: shot.angle });
        this.cameraFx.kick(shot.angle + Math.PI, feel.kickPx);
      }
    }
    this.player.followVehicle(mech.x, mech.y);
    this.syncPilot(now);
  }

  /** The player climbs into the mech: hidden inside it, and the camera follows the mech. */
  private enterMech(firstTime: boolean): void {
    this.player.enterVehicle();
    this.player.followVehicle(this.mech.x, this.mech.y);
    this.cameras.main.startFollow(this.mech, false, FOLLOW_LERP, FOLLOW_LERP);
    this.bus.emit(firstTime ? 'mech-online' : 'mech-boarded', {});
  }

  /**
   * If the player is inside a mech that is no longer piloted (climbed out, out of energy,
   * destroyed), put them back on their feet. Called after everything that can change the mech.
   */
  private syncPilot(now: number): void {
    if (!this.player.isInVehicle || this.mech.isPiloted) return;
    this.ejectPilot(now, this.mech.status);
  }

  /**
   * Out of the mech, alive, with the health they went in with: untouchable for a moment, and
   * anything crowding the hatch is shoved clear. The one way out, whatever the reason.
   */
  private ejectPilot(now: number, why: MechState): void {
    const { x, y } = this.mech;
    const spot = this.hatchSpot();
    this.player.exitVehicle(spot.x, spot.y, now, MECH.eject.invulnerableMs);
    this.cameras.main.startFollow(this.player, false, FOLLOW_LERP, FOLLOW_LERP);
    for (const enemy of this.enemies.getChildren() as Enemy[]) {
      if (enemy.isDead) continue;
      if (Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y) > MECH.eject.pushRadius + enemy.radius) continue;
      enemy.knockback(Phaser.Math.Angle.Between(x, y, enemy.x, enemy.y), MECH.eject.push, now);
    }
    this.bus.emit('mech-ejected', { why });
    if (why === 'destroyed') {
      this.fx.explosion(x, y);
      this.cameraFx.shake(IMPACT.shake.heavy.intensity, IMPACT.shake.heavy.ms, now);
      if (!this.run.isOver) this.hitStop.trigger(IMPACT.hitStop.giantDeath, now);
      this.showNotice('MECH DESTROYED. You were thrown clear: move!', 'warn');
    } else if (why === 'depleted') {
      this.showNotice('MECH OUT OF ENERGY. You are on foot again.', 'warn');
    } else {
      this.showNotice('Out of the mech. Press E beside it to climb back in.', 'info');
    }
  }

  /**
   * Where the pilot lands: beside the mech on open ground, on the side away from the danger
   * around it (enemies weighted by how hard they hit and how close they are); where the mech
   * stands if every side is blocked. Its centre is always open: the mech's body was there.
   */
  private hatchSpot(): { x: number; y: number } {
    const { x, y } = this.mech;
    let ax = 0;
    let ay = 0;
    for (const enemy of this.enemies.getChildren() as Enemy[]) {
      const d = Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y);
      if (enemy.isDead || d > HATCH_DANGER_RANGE || d === 0) continue;
      ax += ((x - enemy.x) / d) * (enemy.contactDamage / d);
      ay += ((y - enemy.y) / d) * (enemy.contactDamage / d);
    }
    const away = ax === 0 && ay === 0 ? this.mech.rotation + Math.PI : Math.atan2(ay, ax);
    const reach = MECH.radius + PLAYER_BODY_RADIUS + 2;
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, Math.PI]) {
      const spot = { x: x + Math.cos(away + turn) * reach, y: y + Math.sin(away + turn) * reach };
      if (this.city.nav.isClear(this.mech, spot, PLAYER_BODY_RADIUS)) return spot;
    }
    return { x, y };
  }

  /**
   * Space, in the mech: a shockwave round its feet. Hurts and throws back every enemy within
   * reach that the mech could see, then lets the pilot out if that was the last of the energy.
   */
  private stomp(): void {
    if (this.run.isOver || !this.player.isInVehicle) return;
    const now = this.time.now;
    const result = this.mech.stomp(now);
    if (result === 'energy') this.showNotice(`NOT ENOUGH ENERGY: a stomp needs ${MECH.stomp.energy}`, 'warn');
    if (result !== 'ok') return;
    const { x, y } = this.mech;
    const { radius, damage, knockback } = MECH.stomp;
    this.fx.shockwave(x, y, radius);
    this.cameraFx.shake(IMPACT.shake.rockLand.intensity, IMPACT.shake.rockLand.ms, now);
    let hits = 0;
    // A copy: an enemy dying mid-loop leaves the group.
    for (const enemy of this.enemies.getChildren().slice() as Enemy[]) {
      if (enemy.isDead || Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y) > radius + enemy.radius) continue;
      if (!this.city.nav.isClear(this.mech, enemy, 0)) continue;
      const angle = Phaser.Math.Angle.Between(x, y, enemy.x, enemy.y);
      enemy.takeDamage(damage);
      enemy.knockback(angle, knockback, now);
      this.fx.blood(enemy.x, enemy.y, angle, enemy.kind === 'giant');
      this.bus.emit('enemy-hit', { enemy, x: enemy.x, y: enemy.y, angle, source: 'stomp' });
      hits++;
    }
    this.bus.emit('mech-stomp', { x, y, hits });
    this.syncPilot(now);
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
      this.bus.emit('bullet-impact', { x: bullet.x, y: bullet.y, material: 'metal', solid: hit.kind });
      if (hit.kind === 'car') this.ambience.carHit(hit.index, this.time.now);
    } else {
      this.fx.dust(bullet.x, bullet.y);
      this.bus.emit('bullet-impact', { x: bullet.x, y: bullet.y, material: 'masonry', solid: hit?.kind ?? null });
    }
  }

  /** An enemy died: once per enemy, from its single death event. */
  private killFeedback(enemy: Enemy): void {
    const now = this.time.now;
    const giant = enemy.kind === 'giant';
    this.fx.death(enemy.x, enemy.y, enemy.radius);
    this.bus.emit('enemy-killed', { enemy, kind: enemy.kind });
    const shake = giant ? IMPACT.shake.heavy : IMPACT.shake.kill;
    this.cameraFx.shake(shake.intensity, shake.ms, now);
    const hold = giant ? IMPACT.hitStop.giantDeath : HEAVY_KINDS.has(enemy.kind) ? IMPACT.hitStop.heavyKill : IMPACT.hitStop.kill;
    if (!this.run.isOver) this.hitStop.trigger(hold, now);
  }

  /** A hit-stop just ended after *ms*: physics resumes, and no timer loses the frozen time. */
  private afterHitStop(ms: number): void {
    this.physics.world.resume();
    this.player.shiftTimers(ms);
    this.mech.shiftTimers(ms);
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

  /** Step one of the three volumes; any change unmutes. */
  private changeVolume(which: 'volume' | 'music' | 'sfx', delta: number): void {
    const settings = this.profile.settings;
    settings[which] = Math.round(Phaser.Math.Clamp(settings[which] + delta, 0, 1) * 10) / 10;
    settings.muted = false;
    // The controls line only has room for -/+; the notice shows the rest.
    this.settingsChanged(`${VOLUME_NAMES[which]} ${Math.round(settings[which] * 100)}%   -/+ all  [ ] music  , . effects`);
  }

  private settingsChanged(notice: string): void {
    const { settings } = this.profile;
    this.audio.configure(settings);
    saveProfile(this.profile);
    this.gameOver?.showSettings(settings);
    this.showNotice(notice, 'info');
  }

  /**
   * Both gates, one item per weapon locker, and the mech (brought online once, boarded again for
   * free after climbing out), all bought through `tryPurchase`.
   */
  private createPurchasables(): Purchasable[] {
    const gate = this.city.gate;
    const facilityGate = this.city.facilityGate;
    const mech = this.mech;
    const gateItem: Purchasable = {
      kind: 'gate',
      position: gate.centre,
      reach: GATE_REACH,
      cost: GATE_COST,
      noun: 'the gate',
      action: 'open the alley gate',
      isAvailable: () => !gate.isOpen,
      deliver: () => {
        this.city.openGate();
        this.bus.emit('gate-opened', { gate: 'alley' });
        return `GATE OPEN: -${GATE_COST} coins. The Narrow Alleys are open.`;
      },
    };
    const facilityGateItem: Purchasable = {
      kind: 'gate',
      position: facilityGate.centre,
      reach: GATE_REACH,
      cost: FACILITY_GATE_COST,
      noun: 'the facility gate',
      action: 'open the facility gate',
      isAvailable: () => !facilityGate.isOpen,
      deliver: () => {
        this.city.openGate(facilityGate);
        this.bus.emit('gate-opened', { gate: 'facility' });
        return `GATE OPEN: -${FACILITY_GATE_COST} coins. The Industrial Facility is open.`;
      },
    };
    const mechItem: Purchasable = {
      kind: 'mech',
      position: mech,
      reach: MECH.reach,
      cost: MECH.cost,
      noun: 'the mech',
      action: 'bring the mech online',
      isAvailable: () => mech.status === 'dormant',
      deliver: () => {
        mech.activate(this.time.now);
        this.city.mechBay.showForSale(false);
        this.enterMech(true);
        return `MECH ONLINE: -${MECH.cost} coins. Its energy drains, faster while firing. SPACE stomps.`;
      },
    };
    const boardItem: Purchasable = {
      kind: 'board',
      position: mech,
      reach: MECH.reach,
      cost: 0,
      noun: 'the mech',
      get action() {
        return `climb into the mech (energy ${Math.ceil(mech.energy)}%)`;
      },
      isAvailable: () => mech.canBoard,
      deliver: () => {
        mech.board(this.time.now);
        this.enterMech(false);
        return 'BACK IN THE MECH.';
      },
    };
    const lockerItems = this.city.lockers.map((locker): Purchasable => {
      const def = WEAPONS[locker.weapon];
      return {
        kind: 'weapon',
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
    return [gateItem, facilityGateItem, mechItem, boardItem, ...lockerItems];
  }

  /** The nearest item still for sale within reach of the player, if any. Nothing from inside the mech. */
  private purchasableInReach(): Purchasable | undefined {
    if (this.player.isInVehicle) return undefined;
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
   * E: in the mech, climb out; on foot, buy (or board) what is in reach. A held key's repeats do
   * nothing, so holding E can never board and climb straight back out.
   */
  private interact(event: KeyboardEvent): void {
    if (this.run.isOver || event.repeat) return;
    if (!this.player.isInVehicle) {
      this.tryPurchase();
      return;
    }
    const now = this.time.now;
    if (this.mech.climbOut(now)) this.syncPilot(now);
  }

  /**
   * Buy what is in reach, or say why not. The one place coins are spent: the item stops being
   * available as it is delivered, so a second press buys nothing more.
   */
  private tryPurchase(): void {
    if (this.run.isOver) return;
    const item = this.purchasableInReach();
    if (!item) return;
    if (!this.run.spend(item.cost)) {
      this.bus.emit('purchase-refused', { cost: item.cost, balance: this.run.coinBalance });
      this.showNotice(`NOT ENOUGH COINS: ${item.noun} costs ${item.cost}, you have ${this.run.coinBalance}`, 'warn');
      return;
    }
    if (item.kind !== 'board') this.bus.emit('purchase', { item: item.kind, cost: item.cost });
    this.showNotice(item.deliver(), 'info');
  }

  private selectWeapon(id: WeaponId): void {
    // In the mech, its cannon is the only gun.
    if (this.run.isOver || this.player.isInVehicle) return;
    const def = WEAPONS[id];
    if (!this.arsenal.owns(id)) {
      this.showNotice(`NOT OWNED: the ${def.name} is sold at a weapon locker for ${def.cost} coins`, 'warn');
      return;
    }
    this.switchWeapon(() => this.arsenal.equip(id));
  }

  private switchWeapon(change: () => boolean): void {
    if (this.run.isOver || this.player.isInVehicle || !change()) return;
    this.player.holdWeapon(this.arsenal.current.def);
    this.bus.emit('weapon-switched', { gun: this.arsenal.current.def.id });
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
      prompt: item ? `[E] ${item.action}${item.cost > 0 ? `: ${item.cost} coins` : ''}` : '',
      notice: showNotice ? this.notice.text : '',
      noticeTone: this.notice.tone,
      boss: boss && !boss.isDead ? { name: boss.def.name, health: boss.health, maxHealth: boss.def.maxHp } : null,
      // Pulses twice a second until the Giant arrives.
      warning: warningLeft > 0 ? `WARNING: A GIANT IS COMING (${Math.ceil(warningLeft / 1000)})` : '',
      warningBright: Math.floor(now / 250) % 2 === 0,
      mech: this.player.isInVehicle ? this.mechHud(now) : null,
    };
  }

  private mechHud(now: number): MechHud {
    const mech = this.mech;
    return {
      health: mech.health,
      maxHealth: MECH.maxHp,
      energy: mech.energy,
      maxEnergy: MECH.energy.max,
      stompCooldownS: Math.ceil(mech.stompCooldownLeft(now) / 1000),
      stompAffordable: mech.energy >= MECH.stomp.energy,
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
    this.bus.emit('enemy-hit', { enemy, x: bullet.x, y: bullet.y, angle: bullet.rotation, source: bullet.weapon ?? 'pistol' });
    if (bullet.weapon === 'pistol' || giant) this.cameraFx.shake(IMPACT.shake.hit.intensity, IMPACT.shake.hit.ms, now);
  }

  /** Enemies claw at the mech's hull; its own short invulnerability spaces the hits. */
  private onEnemyTouchesMech(a: unknown, b: unknown): void {
    const enemy = (a instanceof Enemy ? a : b) as Enemy;
    if (enemy.isDead) return;
    this.damageMech(enemy.contactDamage, enemy instanceof Giant);
  }

  /**
   * A hit on the mech's hull: the pilot is untouched. Small hits only clank (a hit-stop every
   * time a crowd landed one would stutter the whole fight); the Giant's land with a hit-stop. If
   * the hull gives out, the pilot is thrown clear.
   */
  private damageMech(amount: number, heavy: boolean): boolean {
    const now = this.time.now;
    if (this.run.isOver || !this.mech.takeDamage(amount, now)) return false;
    const shake = heavy ? IMPACT.shake.heavy : IMPACT.shake.playerHurt;
    this.cameraFx.shake(shake.intensity, shake.ms, now);
    this.fx.impact(this.mech.x, this.mech.y);
    this.bus.emit('mech-hit', { amount, heavy, health: this.mech.health });
    if (!this.mech.isPiloted) {
      this.syncPilot(now);
      return true;
    }
    if (heavy) this.hitStop.trigger(IMPACT.hitStop.giantAttack, now);
    return true;
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
    // In the mech, the hull takes it: the Giant's slam, charge and debris included.
    if (this.player.isInVehicle) return this.damageMech(amount, heavy);
    const now = this.time.now;
    if (this.run.isOver || !this.player.takeDamage(amount, now)) return false;
    const shake = heavy ? IMPACT.shake.heavy : IMPACT.shake.playerHurt;
    this.cameraFx.shake(shake.intensity, shake.ms, now);
    this.fx.playerHurt();
    this.bus.emit('player-hurt', { amount, heavy, health: this.player.health });
    if (this.player.isDead) {
      this.bus.emit('player-died', {});
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
    this.bus.emit('run-ended', { outcome });
    // A cleared run leaves the player standing; stop it where it is.
    this.player.setVelocity(0, 0).setAlpha(1);
    this.mech.halt();
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
