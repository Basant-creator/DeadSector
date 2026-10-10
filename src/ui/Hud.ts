import Phaser from 'phaser';
import { weaponIconKey } from '../art/props';
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
  /** The boss in play, for its health bar; null hides the bar. */
  boss: { name: string; health: number; maxHealth: number } | null;
  /** Boss warning; empty hides it. */
  warning: string;
  /** Pulses the warning between full and dim; it never disappears. */
  warningBright: boolean;
  /** The mech while the player pilots it; null hides its panel. */
  mech: MechHud | null;
}

export interface MechHud {
  health: number;
  maxHealth: number;
  energy: number;
  maxEnergy: number;
  /** Seconds until the stomp is ready again; 0 when ready. */
  stompCooldownS: number;
  /** Whether there is energy enough for a stomp. */
  stompAffordable: boolean;
}

export type NoticeTone = 'info' | 'warn';

export const UI_COLORS = {
  text: '#e8e6dc',
  label: '#7a808c',
  outline: '#08090c',
  info: '#7fb069',
  warn: '#e0a040',
  danger: '#e0553d',
  coin: '#f0b030',
} as const;

/** Bold monospace everywhere, with a hard outline: readable over any part of the city. */
export const UI_FONT = '"Courier New", Courier, monospace';

const PAD = 10;
/** Translucent enough that an enemy passing under a panel stays visible. */
const PANEL = { fill: 0x0a0c10, alpha: 0.5 };
const ACCENT = { health: 0xd8443a, wave: 0x3ad8e8, coin: 0xf0b030, weapon: 0xf0b030, boss: 0xe0553d, mech: 0x3ad8e8 } as const;
const BAR_WIDTH = 160;
const BAR_HEIGHT = 12;
const BAR_SEGMENTS = 10;
const HEALTH_COLORS = { high: 0xd8443a, mid: 0xf0882a, low: 0xff3030 } as const;
const DEPTH = 10;
const BOSS_BAR_WIDTH = 420;
const BOSS_BAR_HEIGHT = 10;
const SLOT_GAP = 14;
const BANNER_DEPTH = 20;
const MECH_BAR_WIDTH = 140;
const MECH_BAR_HEIGHT = 9;
const ENERGY_COLORS = { normal: 0x3ad8e8, low: 0xe0a040 } as const;
/** Below this share of a full charge, the energy bar turns amber. */
const LOW_ENERGY = 0.2;
const CONTROLS = {
  onFoot: 'WASD move  LMB fire  E buy  1-3/Q weapons  K shake  -/+ volume  M mute',
  mech: 'WASD walk  LMB cannon  SPACE stomp  E climb out  K shake  -/+ volume  M mute',
} as const;

const SLOT_STYLE = {
  held: { color: '#08090c', backing: 0xf0b030 },
  owned: { color: '#e8e6dc' },
  locked: { color: '#4e545e' },
} as const;
type SlotState = keyof typeof SLOT_STYLE;

/**
 * Screen-space HUD in small translucent panels at the screen edges, each with one accent
 * colour: health (red) and district top left, wave (cyan) top centre, coins (amber) and run time
 * top right, weapon and ammunition bottom left; prompts and notices lower centre. Every element
 * ignores the camera scroll. `update` can run every frame: Phaser's `setText` skips re-rendering
 * a text that has not changed, and colours are only set when they change.
 */
export class Hud {
  private readonly healthFill: Phaser.GameObjects.Rectangle;
  private readonly healthText: Phaser.GameObjects.Text;
  private readonly waveText: Phaser.GameObjects.Text;
  private readonly waveStatusText: Phaser.GameObjects.Text;
  private readonly coinsText: Phaser.GameObjects.Text;
  private readonly timeText: Phaser.GameObjects.Text;
  private readonly weaponText: Phaser.GameObjects.Text;
  private readonly weaponIcon: Phaser.GameObjects.Image;
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
  private readonly bossParts: Phaser.GameObjects.Components.Visible[];
  private readonly bossLabel: Phaser.GameObjects.Text;
  private readonly bossFill: Phaser.GameObjects.Rectangle;
  private readonly warningText: Phaser.GameObjects.Text;
  private readonly controlsText: Phaser.GameObjects.Text;
  private readonly mechParts: Phaser.GameObjects.Components.Visible[];
  private readonly mechHullFill: Phaser.GameObjects.Rectangle;
  private readonly mechHullText: Phaser.GameObjects.Text;
  private readonly mechEnergyFill: Phaser.GameObjects.Rectangle;
  private readonly mechEnergyText: Phaser.GameObjects.Text;
  private readonly mechStompText: Phaser.GameObjects.Text;
  private mechShown = true;

  constructor(scene: Phaser.Scene) {
    const fixed = <T extends Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth>(
      object: T,
      depth = DEPTH,
    ): T => {
      object.setScrollFactor(0);
      object.setDepth(depth);
      return object;
    };
    const text = (x: number, y: number, size: number, color: string = UI_COLORS.text, bold = true) =>
      fixed(scene.add.text(x, y, '', {
        fontFamily: UI_FONT, fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal',
        stroke: UI_COLORS.outline, strokeThickness: 3,
      }));
    /** A dark translucent panel with a coloured edge on the side facing the screen centre. */
    const panel = (x: number, y: number, w: number, h: number, accent: number, edge: 'left' | 'top' | 'right') => {
      const back = fixed(scene.add.rectangle(x, y, w, h, PANEL.fill, PANEL.alpha).setOrigin(0), DEPTH - 0.5);
      const bar = edge === 'top' ? [x, y, w, 2] : edge === 'left' ? [x, y, 3, h] : [x + w - 3, y, 3, h];
      return [back, fixed(scene.add.rectangle(bar[0], bar[1], bar[2], bar[3], accent).setOrigin(0), DEPTH - 0.4)];
    };
    const icon = (x: number, y: number, key: string) => fixed(scene.add.image(x, y, key).setOrigin(0, 0.5));

    // Health, top left: heart, segmented bar, value; district underneath.
    panel(PAD, PAD, 262, 54, ACCENT.health, 'left');
    icon(PAD + 12, PAD + 18, 'hud-heart');
    const barX = PAD + 40;
    const barY = PAD + 12;
    fixed(scene.add.rectangle(barX, barY, BAR_WIDTH, BAR_HEIGHT, 0x2a1416).setOrigin(0));
    this.healthFill = fixed(scene.add.rectangle(barX, barY, BAR_WIDTH, BAR_HEIGHT, HEALTH_COLORS.high).setOrigin(0));
    for (let i = 1; i < BAR_SEGMENTS; i++) {
      fixed(scene.add.rectangle(barX + (BAR_WIDTH / BAR_SEGMENTS) * i, barY, 2, BAR_HEIGHT, PANEL.fill).setOrigin(0.5, 0));
    }
    this.healthText = text(barX + BAR_WIDTH + 10, barY - 3, 15);
    this.districtText = text(PAD + 12, PAD + 34, 12, UI_COLORS.label);

    // Wave, top centre.
    panel(GAME_WIDTH / 2 - 120, PAD, 240, 54, ACCENT.wave, 'top');
    icon(GAME_WIDTH / 2 - 108, PAD + 19, 'hud-wave');
    this.waveText = text(GAME_WIDTH / 2, PAD + 6, 22).setOrigin(0.5, 0);
    this.waveStatusText = text(GAME_WIDTH / 2, PAD + 33, 12, UI_COLORS.label).setOrigin(0.5, 0);

    // Coins and run time, top right.
    panel(GAME_WIDTH - PAD - 160, PAD, 160, 54, ACCENT.coin, 'right');
    icon(GAME_WIDTH - PAD - 148, PAD + 18, 'hud-coin');
    this.coinsText = text(GAME_WIDTH - PAD - 14, PAD + 5, 24, UI_COLORS.coin).setOrigin(1, 0);
    this.timeText = text(GAME_WIDTH - PAD - 14, PAD + 34, 12, UI_COLORS.label).setOrigin(1, 0);

    // Weapon, bottom left: icon, name and ammunition, then a row of every weapon's slot.
    const wy = GAME_HEIGHT - PAD - 70;
    panel(PAD, wy, 360, 70, ACCENT.weapon, 'left');
    this.weaponIcon = icon(PAD + 14, wy + 20, weaponIconKey('pistol'));
    this.weaponText = text(PAD + 76, wy + 30, 18).setOrigin(0, 1);
    // No weapon uses ammunition yet; the readout is ready for when one does.
    icon(PAD + 246, wy + 21, 'hud-ammo');
    text(PAD + 262, wy + 28, 11, UI_COLORS.label).setOrigin(0, 1).setText('AMMO');
    text(PAD + 300, wy + 31, 18).setOrigin(0, 1).setText('\u221e');
    this.heldBacking = fixed(scene.add.rectangle(0, 0, 10, 20, SLOT_STYLE.held.backing).setOrigin(0, 1));
    this.slotTexts = {} as Record<WeaponId, Phaser.GameObjects.Text>;
    for (const id of WEAPON_IDS) {
      // Positioned in update, as labels change width when prices drop off.
      this.slotTexts[id] = text(PAD + 14, GAME_HEIGHT - PAD - 10, 13).setOrigin(0, 1).setStroke(UI_COLORS.outline, 0);
    }

    // Controls, bottom centre; the mech's own while piloting it.
    this.controlsText = text(GAME_WIDTH / 2, GAME_HEIGHT - PAD, 12, UI_COLORS.label, false)
      .setOrigin(0.5, 1)
      .setText(CONTROLS.onFoot);

    // The mech, bottom right, only while piloting it: hull, energy, and the stomp.
    const mx = GAME_WIDTH - PAD - 280;
    const my = GAME_HEIGHT - PAD - 70;
    const mechBar = (y: number, color: number) => {
      const back = fixed(scene.add.rectangle(mx + 70, y, MECH_BAR_WIDTH, MECH_BAR_HEIGHT, 0x14181c).setOrigin(0));
      return [back, fixed(scene.add.rectangle(mx + 70, y, MECH_BAR_WIDTH, MECH_BAR_HEIGHT, color).setOrigin(0))] as const;
    };
    const [hullBack, hullFill] = mechBar(my + 12, HEALTH_COLORS.high);
    const [energyBack, energyFill] = mechBar(my + 30, ENERGY_COLORS.normal);
    this.mechHullFill = hullFill;
    this.mechEnergyFill = energyFill;
    this.mechHullText = text(mx + 70 + MECH_BAR_WIDTH + 8, my + 9, 12);
    this.mechEnergyText = text(mx + 70 + MECH_BAR_WIDTH + 8, my + 27, 12);
    this.mechStompText = text(mx + 12, my + 48, 12, UI_COLORS.label);
    this.mechParts = [
      ...panel(mx, my, 280, 70, ACCENT.mech, 'right'),
      text(mx + 12, my + 9, 12, UI_COLORS.label).setText('HULL'),
      text(mx + 12, my + 27, 12, UI_COLORS.label).setText('ENERGY'),
      hullBack, hullFill, energyBack, energyFill, this.mechHullText, this.mechEnergyText, this.mechStompText,
    ];

    // Boss health under the wave panel, and the warning that comes before the boss.
    const bossY = PAD + 62;
    this.bossLabel = text(GAME_WIDTH / 2, bossY, 13, UI_COLORS.danger).setOrigin(0.5, 0);
    const bossBack = fixed(scene.add.rectangle(GAME_WIDTH / 2 - BOSS_BAR_WIDTH / 2, bossY + 20, BOSS_BAR_WIDTH, BOSS_BAR_HEIGHT, 0x2a1416)
      .setOrigin(0).setStrokeStyle(1, ACCENT.boss));
    this.bossFill = fixed(scene.add.rectangle(GAME_WIDTH / 2 - BOSS_BAR_WIDTH / 2, bossY + 20, BOSS_BAR_WIDTH, BOSS_BAR_HEIGHT, ACCENT.boss)
      .setOrigin(0));
    this.bossParts = [this.bossLabel, bossBack, this.bossFill];
    this.warningText = fixed(
      scene.add.text(GAME_WIDTH / 2, 275, '', {
        fontFamily: UI_FONT, fontSize: '28px', fontStyle: 'bold', color: UI_COLORS.danger, align: 'center',
        stroke: UI_COLORS.outline, strokeThickness: 6,
      }).setOrigin(0.5),
      BANNER_DEPTH,
    );

    // Interaction prompt and feedback, lower centre: clear of the player and the wave banner.
    this.promptText = text(GAME_WIDTH / 2, GAME_HEIGHT - 70, 17).setOrigin(0.5, 1);
    this.noticeText = text(GAME_WIDTH / 2, GAME_HEIGHT - 108, 19, UI_COLORS.info).setOrigin(0.5, 1);

    this.bannerText = fixed(
      scene.add.text(GAME_WIDTH / 2, 185, '', {
        fontFamily: UI_FONT, fontSize: '32px', fontStyle: 'bold', color: UI_COLORS.text, align: 'center',
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
    if (this.weaponIcon.texture.key !== weaponIconKey(state.weapon)) this.weaponIcon.setTexture(weaponIconKey(state.weapon));
    let slotX = PAD + 14;
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
    const { boss } = state;
    for (const part of this.bossParts) part.setVisible(boss !== null);
    if (boss) {
      this.bossLabel.setText(`${boss.name.toUpperCase()}  ${boss.health}/${boss.maxHealth}`);
      this.bossFill.setScale(Phaser.Math.Clamp(boss.health / boss.maxHealth, 0, 1), 1);
    }
    this.warningText.setText(state.warning).setAlpha(state.warningBright ? 1 : 0.45);
    this.updateMech(state.mech);
    this.promptText.setText(state.prompt);
    this.noticeText.setText(state.notice);
    // Unlike setText, setColor re-renders the text even when the colour is unchanged.
    if (state.noticeTone !== this.noticeTone) {
      this.noticeTone = state.noticeTone;
      this.noticeText.setColor(UI_COLORS[state.noticeTone]);
    }
  }

  private updateMech(mech: MechHud | null): void {
    const shown = mech !== null;
    if (shown !== this.mechShown) {
      this.mechShown = shown;
      for (const part of this.mechParts) part.setVisible(shown);
      this.controlsText.setText(shown ? CONTROLS.mech : CONTROLS.onFoot);
    }
    if (!mech) return;
    const hull = Phaser.Math.Clamp(mech.health / mech.maxHealth, 0, 1);
    this.mechHullFill.setScale(hull, 1).setFillStyle(hull > 0.5 ? HEALTH_COLORS.high : hull > 0.25 ? HEALTH_COLORS.mid : HEALTH_COLORS.low);
    this.mechHullText.setText(`${Math.ceil(mech.health)}/${mech.maxHealth}`);
    const energy = Phaser.Math.Clamp(mech.energy / mech.maxEnergy, 0, 1);
    this.mechEnergyFill.setScale(energy, 1).setFillStyle(energy > LOW_ENERGY ? ENERGY_COLORS.normal : ENERGY_COLORS.low);
    this.mechEnergyText.setText(`${Math.ceil(energy * 100)}%`);
    this.mechStompText.setText(
      !mech.stompAffordable ? 'SPACE STOMP: NO ENERGY'
        : mech.stompCooldownS > 0 ? `SPACE STOMP: ${mech.stompCooldownS}s` : 'SPACE STOMP: READY',
    );
  }
}

function slotLabel(id: WeaponId, showPrice: boolean): string {
  const { slot, name, cost } = WEAPONS[id];
  return `${slot} ${name.toUpperCase()}${showPrice && cost > 0 ? ` ${cost}c` : ''}`;
}
