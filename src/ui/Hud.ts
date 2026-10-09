import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { type WeaponId, WEAPON_IDS, WEAPONS } from '../combat/weapons';
import { formatDuration } from '../run/Run';

export interface HudState {
  health: number;
  maxHealth: number;
  wave: number;
  waveCount: number;
  /** Line under the wave counter, e.g. "6 enemies left". */
  waveStatus: string;
  coins: number;
  /** The weapon in hand. */
  weapon: WeaponId;
  /** Weapons bought (or started with) this run. */
  ownedWeapons: ReadonlySet<WeaponId>;
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
const SLOT_GAP = 16;
const BANNER_DEPTH = 20;

const SLOT_STYLE = {
  held: { color: '#0b0d0b', backing: 0xc8d6c0 },
  owned: { color: '#c8d6c0' },
  locked: { color: '#4a5244' },
} as const;
type SlotState = keyof typeof SLOT_STYLE;

/**
 * Screen-space HUD: health and district top left, wave top centre, coins and run time top
 * right, weapons bottom left, prompts and notices lower centre. Every element ignores the
 * camera scroll. `update` can run every frame: Phaser's `setText` skips re-rendering a text
 * that has not changed, and colours are only set when they change.
 */
export class Hud {
  private readonly healthFill: Phaser.GameObjects.Rectangle;
  private readonly healthText: Phaser.GameObjects.Text;
  private readonly waveText: Phaser.GameObjects.Text;
  private readonly waveStatusText: Phaser.GameObjects.Text;
  private readonly coinsText: Phaser.GameObjects.Text;
  private readonly timeText: Phaser.GameObjects.Text;
  private readonly weaponText: Phaser.GameObjects.Text;
  /** One per weapon, in slot order: "2 SHOTGUN 90c". */
  private readonly slotTexts: Record<WeaponId, Phaser.GameObjects.Text>;
  private readonly slotStates = {} as Record<WeaponId, SlotState>;
  /** Highlight behind the held weapon's slot. */
  private readonly heldBacking: Phaser.GameObjects.Rectangle;
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

    // Weapon in hand above a row of every weapon's slot, bottom left.
    text(PAD, GAME_HEIGHT - PAD - 64, 12, UI_COLORS.label).setText('WEAPON');
    this.weaponText = text(PAD, GAME_HEIGHT - PAD - 26, 22).setOrigin(0, 1);
    this.heldBacking = fixed(scene.add.rectangle(0, 0, 10, 20, SLOT_STYLE.held.backing).setOrigin(0, 1));
    this.slotTexts = {} as Record<WeaponId, Phaser.GameObjects.Text>;
    for (const id of WEAPON_IDS) {
      // Positioned in update, as labels change width when prices drop off.
      this.slotTexts[id] = text(PAD, GAME_HEIGHT - PAD, 14).setOrigin(0, 1).setStroke(UI_COLORS.outline, 0);
    }

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
    this.weaponText.setText(WEAPONS[state.weapon].name.toUpperCase());
    let slotX = PAD;
    for (const id of WEAPON_IDS) {
      const owned = state.ownedWeapons.has(id);
      const slotState: SlotState = id === state.weapon ? 'held' : owned ? 'owned' : 'locked';
      const slot = this.slotTexts[id];
      slot.setText(slotLabel(id, !owned)).setX(slotX);
      slotX += slot.width + SLOT_GAP;
      if (this.slotStates[id] !== slotState) {
        this.slotStates[id] = slotState;
        slot.setColor(SLOT_STYLE[slotState].color);
      }
      if (slotState === 'held') {
        this.heldBacking.setPosition(slot.x - 4, slot.y + 2).setSize(slot.width + 8, slot.height + 2);
      }
    }
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

function slotLabel(id: WeaponId, showPrice: boolean): string {
  const { slot, name, cost } = WEAPONS[id];
  return `${slot} ${name.toUpperCase()}${showPrice && cost > 0 ? ` ${cost}c` : ''}`;
}
