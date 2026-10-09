import Phaser from 'phaser';
import { Arsenal } from '../combat/Arsenal';
import { Bullet } from '../combat/Bullet';
import { type WeaponId, WEAPON_IDS, WEAPONS } from '../combat/weapons';
import { Enemy } from '../entities/Enemy';
import { ENEMIES } from '../entities/enemies';
import { muzzleOffset, Player, PLAYER_MAX_HP } from '../entities/Player';
import { loadProfile, type Profile, saveProfile } from '../run/Profile';
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
      onEnemyKilled: (enemy) => this.run.recordKill(enemy.coinReward),
      onWaveCleared: (_wave, last) => {
        this.run.recordWaveCleared();
        if (last) this.endRun('cleared');
      },
    });
    this.purchasables = this.createPurchasables();

    this.physics.add.collider(this.enemies, walls);
    this.physics.add.collider(this.arsenal.bullets, walls, (bullet) => (bullet as Bullet).kill());
    this.physics.add.overlap(this.arsenal.bullets, this.enemies, (a, b) => this.onBulletHitsEnemy(a, b));
    this.physics.add.overlap(this.player, this.enemies, (a, b) => this.onEnemyTouchesPlayer(a, b));

    const camera = this.cameras.main;
    // Clamped to the city: the camera never shows past its edge.
    camera.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    // roundPixels must stay off: Phaser floors the scroll after lerping, which swallows the final
    // sub-pixel steps and parks the camera up to 9 px off-centre with lerp 0.1.
    camera.startFollow(this.player, false, 0.1, 0.1);

    this.hud = new Hud(this);
    // The scene's keyboard plugin drops these listeners on shutdown, so restarts never stack them.
    const keyboard = this.input.keyboard;
    keyboard?.on('keydown-E', () => this.tryPurchase());
    keyboard?.on('keydown-Q', () => this.switchWeapon(() => this.arsenal.cycle()));
    for (const id of WEAPON_IDS) {
      keyboard?.on(`keydown-${SLOT_KEYS[WEAPONS[id].slot - 1]}`, () => this.selectWeapon(id));
    }
  }

  update(): void {
    const now = this.time.now;

    if (!this.run.isOver) {
      this.player.update(now);
      if (this.input.activePointer.leftButtonDown()) {
        const angle = this.player.aimAngle;
        const muzzle = muzzleOffset(this.arsenal.current.def);
        this.arsenal.tryFire(now,
          this.player.x + Math.cos(angle) * muzzle,
          this.player.y + Math.sin(angle) * muzzle,
          angle);
      }
      const nav = this.city.nav;
      nav.setTarget(this.player);
      for (const enemy of this.enemies.getChildren() as Enemy[]) {
        if (!enemy.isDead) enemy.pursue(nav.waypoint(enemy, this.player, enemy.radius));
      }
      this.director.update(now);
    }

    this.hud.update(this.hudState(now));
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
    return {
      health: this.player.health,
      maxHealth: PLAYER_MAX_HP,
      wave: director.waveNumber,
      waveCount: director.waveCount,
      waveStatus: {
        intermission: `next wave in ${seconds}`,
        active: `${left} ${left === 1 ? 'enemy' : 'enemies'} left`,
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
    };
  }

  private onBulletHitsEnemy(a: unknown, b: unknown): void {
    const bullet = (a instanceof Bullet ? a : b) as Bullet;
    const enemy = (a instanceof Enemy ? a : b) as Enemy;
    // A bullet is spent by its first hit: disabling it here stops it reaching anything else.
    // A dead enemy takes no hits, so pellets landing after the killing one pass on.
    if (!bullet.active || enemy.isDead) return;
    bullet.kill();
    enemy.takeDamage(bullet.damage);
  }

  private onEnemyTouchesPlayer(a: unknown, b: unknown): void {
    const enemy = (a instanceof Enemy ? a : b) as Enemy;
    if (enemy.isDead || this.run.isOver) return;
    // Fires every step the two overlap; the player's invulnerability window turns that into
    // one hit per touch.
    if (!this.player.takeDamage(enemy.contactDamage, this.time.now)) return;
    if (this.profile.settings.screenShake) this.cameras.main.shake(120, 0.006);
    if (this.player.isDead) this.endRun('died');
  }

  /** Freeze the city, bank the high score, and show the summary. Runs once per run. */
  private endRun(outcome: RunOutcome): void {
    if (this.run.isOver) return;
    const now = this.time.now;
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
      screenShake: this.profile.settings.screenShake,
    });

    // The scene's keyboard plugin drops these listeners on shutdown, so a restart starts clean.
    // [1] selects the pistol in play; the weapon handlers ignore it once the run is over.
    const keyboard = this.input.keyboard;
    keyboard?.once('keydown-R', () => this.scene.restart());
    keyboard?.on('keydown-ONE', () => this.toggleScreenShake());
  }

  private toggleScreenShake(): void {
    const settings = this.profile.settings;
    settings.screenShake = !settings.screenShake;
    saveProfile(this.profile);
    this.gameOver?.setScreenShake(settings.screenShake);
  }
}
