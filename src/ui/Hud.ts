import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { formatDuration } from '../run/Run';

export interface HudState {
  health: number;
  maxHealth: number;
  wave: number;
  waveCount: number;
  /** Line under the wave counter, e.g. "6 walkers left". */
  waveStatus: string;
  coins: number;
  weapon: string;
  elapsedMs: number;
  /** Large centre-top message; empty hides it. */
  banner: string;
  /** Name of the district the player is in. */
  district: string;
  /** Action available where the player stands, e.g. buying the gate; empty hides it. */
  prompt: string;
  /** Short-lived feedback, e.g. not enough coins; empty hides it. */
  notice: string;
  noticeTone: NoticeTone;
}

export type NoticeTone = 'info' | 'warn';

export const UI_COLORS = {
  text: '#c8d6c0',
  label: '#6b7560',
  outline: '#0b0d0b',
  info: '#7fb069',
  warn: '#e0a040',
} as const;

const PAD = 20;
const BAR_WIDTH = 220;
const BAR_HEIGHT = 12;
const HEALTH_COLORS = { high: 0x7fb069, mid: 0xd9a441, low: 0xc8553d } as const;
const DEPTH = 10;
const BANNER_DEPTH = 20;

/**
 * Screen-space HUD: health and district top left, wave top centre, coins and run time top
 * right, weapon bottom left, prompts and notices lower centre. Every element ignores the camera scroll. `update` can run every frame: Phaser's
 * `setText` skips re-rendering a text that has not changed.
 */
export class Hud {
  private readonly healthFill: Phaser.GameObjects.Rectangle;
  private readonly healthText: Phaser.GameObjects.Text;
  private readonly waveText: Phaser.GameObjects.Text;
  private readonly waveStatusText: Phaser.GameObjects.Text;
  private readonly coinsText: Phaser.GameObjects.Text;
  private readonly timeText: Phaser.GameObjects.Text;
  private readonly weaponText: Phaser.GameObjects.Text;
  private readonly bannerText: Phaser.GameObjects.Text;
  private readonly districtText: Phaser.GameObjects.Text;
  private readonly promptText: Phaser.GameObjects.Text;
  private readonly noticeText: Phaser.GameObjects.Text;
  private noticeTone: NoticeTone = 'info';

  constructor(scene: Phaser.Scene) {
    const fixed = <T extends Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth>(
      object: T,
      depth = DEPTH,
    ): T => {
      object.setScrollFactor(0);
      object.setDepth(depth);
      return object;
    };
    const text = (x: number, y: number, size: number, color: string = UI_COLORS.text) =>
      fixed(scene.add.text(x, y, '', {
        fontFamily: 'monospace', fontSize: `${size}px`, color,
        stroke: UI_COLORS.outline, strokeThickness: 4,
      }));

    // Health, top left.
    text(PAD, PAD, 12, UI_COLORS.label).setText('HEALTH');
    fixed(scene.add.rectangle(PAD, PAD + 20, BAR_WIDTH, BAR_HEIGHT, 0x1a1f19).setOrigin(0).setStrokeStyle(1, 0x3a4038));
    this.healthFill = fixed(scene.add.rectangle(PAD, PAD + 20, BAR_WIDTH, BAR_HEIGHT, HEALTH_COLORS.high).setOrigin(0));
    this.healthText = text(PAD + BAR_WIDTH + 10, PAD + 16, 16);
    this.districtText = text(PAD, PAD + 40, 14, UI_COLORS.label);

    // Wave, top centre.
    this.waveText = text(GAME_WIDTH / 2, PAD - 4, 24).setOrigin(0.5, 0);
    this.waveStatusText = text(GAME_WIDTH / 2, PAD + 26, 14, UI_COLORS.label).setOrigin(0.5, 0);

    // Coins and run time, top right.
    text(GAME_WIDTH - PAD, PAD, 12, UI_COLORS.label).setOrigin(1, 0).setText('COINS');
    this.coinsText = text(GAME_WIDTH - PAD, PAD + 14, 24).setOrigin(1, 0);
    this.timeText = text(GAME_WIDTH - PAD, PAD + 44, 14, UI_COLORS.label).setOrigin(1, 0);

    // Weapon, bottom left.
    text(PAD, GAME_HEIGHT - PAD - 38, 12, UI_COLORS.label).setText('WEAPON');
    this.weaponText = text(PAD, GAME_HEIGHT - PAD, 20).setOrigin(0, 1);

    // Controls, bottom centre.
    text(GAME_WIDTH / 2, GAME_HEIGHT - PAD, 12, UI_COLORS.label)
      .setOrigin(0.5, 1)
      .setText('WASD move   mouse aim   LMB fire');

    // Interaction prompt and feedback, lower centre: clear of the player and the wave banner.
    this.promptText = text(GAME_WIDTH / 2, GAME_HEIGHT - 70, 18).setOrigin(0.5, 1);
    this.noticeText = text(GAME_WIDTH / 2, GAME_HEIGHT - 110, 20, UI_COLORS.info).setOrigin(0.5, 1);

    this.bannerText = fixed(
      scene.add.text(GAME_WIDTH / 2, 150, '', {
        fontFamily: 'monospace', fontSize: '32px', color: UI_COLORS.text, align: 'center',
        stroke: UI_COLORS.outline, strokeThickness: 6,
      }).setOrigin(0.5),
      BANNER_DEPTH,
    );
  }

  update(state: HudState): void {
    const ratio = Phaser.Math.Clamp(state.health / state.maxHealth, 0, 1);
    this.healthFill.setScale(ratio, 1);
    this.healthFill.setFillStyle(
      ratio > 0.5 ? HEALTH_COLORS.high : ratio > 0.25 ? HEALTH_COLORS.mid : HEALTH_COLORS.low,
    );
    this.healthText.setText(`${state.health}/${state.maxHealth}`);
    this.waveText.setText(`WAVE ${state.wave}/${state.waveCount}`);
    this.waveStatusText.setText(state.waveStatus);
    this.coinsText.setText(String(state.coins));
    this.timeText.setText(formatDuration(state.elapsedMs));
    this.weaponText.setText(state.weapon.toUpperCase());
    this.bannerText.setText(state.banner);
    this.districtText.setText(state.district.toUpperCase());
    this.promptText.setText(state.prompt);
    this.noticeText.setText(state.notice);
    // Unlike setText, setColor re-renders the text even when the colour is unchanged.
    if (state.noticeTone !== this.noticeTone) {
      this.noticeTone = state.noticeTone;
      this.noticeText.setColor(UI_COLORS[state.noticeTone]);
    }
  }
}
