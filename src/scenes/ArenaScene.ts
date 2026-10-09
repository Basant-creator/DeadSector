import Phaser from 'phaser';
import { Bullet } from '../combat/Bullet';
import { Pistol } from '../combat/Pistol';
import { MUZZLE_OFFSET, Player, PLAYER_MAX_HP } from '../entities/Player';
import { Walker, WALKER_RADIUS } from '../entities/Walker';
import { loadProfile, type Profile, saveProfile } from '../run/Profile';
import { Run, type RunOutcome } from '../run/Run';
import { GameOverScreen } from '../ui/GameOverScreen';
import { Hud, type HudState, type NoticeTone } from '../ui/Hud';
import { WaveDirector } from '../waves/WaveDirector';
import { City } from '../world/City';
import { districtAt, SPAWN_POINTS, WORLD_HEIGHT, WORLD_WIDTH } from '../world/cityMap';
import { GATE_COST } from '../world/Gate';

/** How long a notice such as "not enough coins" stays up. */
const NOTICE_MS = 2200;

/** The city: a player with a pistol, waves of Walkers, the alley gate, a following camera. */
export class ArenaScene extends Phaser.Scene {
  // The scene object survives a restart, so create() reassigns every field: nothing of a run
  // may outlive it. Walkers, bullets, timers, tweens and listeners go with the scene's shutdown.
  private city!: City;
  private player!: Player;
  private pistol!: Pistol;
  private walkers!: Phaser.GameObjects.Group;
  private director!: WaveDirector;
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

    this.pistol = new Pistol(this);
    // A plain group: colliders read its live members, and a destroyed Walker leaves it by itself.
    this.walkers = this.add.group();
    this.director = new WaveDirector(this, {
      spawnPoints: SPAWN_POINTS,
      // The flow field already points at the player, so this is a lookup.
      canSpawnAt: (point) => this.city.nav.isReachable(point),
      walkers: this.walkers,
      player: this.player,
      onWalkerKilled: (walker) => this.run.recordKill(walker.coinReward),
      onWaveCleared: (_wave, last) => {
        this.run.recordWaveCleared();
        if (last) this.endRun('cleared');
      },
    });

    this.physics.add.collider(this.walkers, walls);
    this.physics.add.collider(this.pistol.bullets, walls, (bullet) => (bullet as Bullet).kill());
    this.physics.add.overlap(this.pistol.bullets, this.walkers, (a, b) => this.onBulletHitsWalker(a, b));
    this.physics.add.overlap(this.player, this.walkers, (a, b) => this.onWalkerTouchesPlayer(a, b));

    const camera = this.cameras.main;
    // Clamped to the city: the camera never shows past its edge.
    camera.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    // roundPixels must stay off: Phaser floors the scroll after lerping, which swallows the final
    // sub-pixel steps and parks the camera up to 9 px off-centre with lerp 0.1.
    camera.startFollow(this.player, false, 0.1, 0.1);

    this.hud = new Hud(this);
    // The scene's keyboard plugin drops this listener on shutdown, so restarts never stack it.
    this.input.keyboard?.on('keydown-E', () => this.tryOpenGate());
  }

  update(): void {
    const now = this.time.now;

    if (!this.run.isOver) {
      this.player.update(now);
      if (this.input.activePointer.leftButtonDown()) {
        const angle = this.player.aimAngle;
        this.pistol.tryFire(now,
          this.player.x + Math.cos(angle) * MUZZLE_OFFSET,
          this.player.y + Math.sin(angle) * MUZZLE_OFFSET,
          angle);
      }
      const nav = this.city.nav;
      nav.setTarget(this.player);
      for (const walker of this.walkers.getChildren() as Walker[]) {
        if (!walker.isDead) walker.pursue(nav.waypoint(walker, this.player, WALKER_RADIUS));
      }
      this.director.update(now);
    }

    this.hud.update(this.hudState(now));
  }

  /** E near the closed gate: pay for it once, or say why not. */
  private tryOpenGate(): void {
    const gate = this.city.gate;
    if (this.run.isOver || gate.isOpen || !gate.isWithinReach(this.player)) return;
    if (!this.run.spend(GATE_COST)) {
      this.showNotice(`NOT ENOUGH COINS: the gate costs ${GATE_COST}, you have ${this.run.coinBalance}`, 'warn');
      return;
    }
    this.city.openGate();
    this.showNotice(`GATE OPEN: -${GATE_COST} coins. The Narrow Alleys are open.`, 'info');
  }

  private showNotice(text: string, tone: NoticeTone): void {
    this.notice = { text, tone, until: this.time.now + NOTICE_MS };
  }

  private hudState(now: number): HudState {
    const director = this.director;
    const seconds = Math.ceil(director.intermissionLeftMs(now) / 1000);
    const left = director.remaining;
    const gate = this.city.gate;
    const canBuyGate = !this.run.isOver && !gate.isOpen && gate.isWithinReach(this.player);
    const showNotice = !this.run.isOver && now < this.notice.until;
    return {
      health: this.player.health,
      maxHealth: PLAYER_MAX_HP,
      wave: director.waveNumber,
      waveCount: director.waveCount,
      waveStatus: {
        intermission: `next wave in ${seconds}`,
        active: `${left} walker${left === 1 ? '' : 's'} left`,
        complete: 'all waves cleared',
        stopped: 'run over',
      }[director.phase],
      coins: this.run.coinBalance,
      weapon: this.pistol.name,
      elapsedMs: this.run.survivalMs(now),
      banner: director.phase === 'intermission' ? `WAVE ${director.waveNumber}\n${seconds}` : '',
      district: districtAt(this.player).name,
      prompt: canBuyGate ? `[E] open the alley gate: ${GATE_COST} coins` : '',
      notice: showNotice ? this.notice.text : '',
      noticeTone: this.notice.tone,
    };
  }

  private onBulletHitsWalker(a: unknown, b: unknown): void {
    const bullet = (a instanceof Bullet ? a : b) as Bullet;
    const walker = (a instanceof Walker ? a : b) as Walker;
    // A bullet is spent by its first hit: disabling it here stops it reaching anything else.
    if (!bullet.active || walker.isDead) return;
    bullet.kill();
    walker.takeDamage(this.pistol.config.damage);
  }

  private onWalkerTouchesPlayer(a: unknown, b: unknown): void {
    const walker = (a instanceof Walker ? a : b) as Walker;
    if (walker.isDead || this.run.isOver) return;
    // Fires every step the two overlap; the player's invulnerability window turns that into
    // one hit per touch.
    if (!this.player.takeDamage(walker.contactDamage, this.time.now)) return;
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
    for (const walker of this.walkers.getChildren() as Walker[]) walker.halt();

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
