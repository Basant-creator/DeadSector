import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { formatDuration, type RunOutcome, type RunStats } from '../run/Run';
import { UI_COLORS } from './Hud';

export interface GameOverView {
  outcome: RunOutcome;
  stats: RunStats;
  waveCount: number;
  highScore: number;
  newHighScore: boolean;
  screenShake: boolean;
}

const DEPTH = 30;
const PANEL_WIDTH = 460;
const ROW_HEIGHT = 30;

/**
 * End-of-run summary over a dimmed arena. Built once when the run ends and destroyed with the
 * scene; the scene owns the keys that restart or change settings.
 */
export class GameOverScreen {
  private readonly footerText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, view: GameOverView) {
    const add = <T extends Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.ScrollFactor &
      Phaser.GameObjects.Components.Depth>(object: T): T => {
      object.setScrollFactor(0);
      object.setDepth(DEPTH);
      return object;
    };
    const text = (x: number, y: number, content: string, size: number, color: string = UI_COLORS.text) =>
      add(scene.add.text(x, y, content, { fontFamily: 'monospace', fontSize: `${size}px`, color }));

    const cx = GAME_WIDTH / 2;
    const left = cx - PANEL_WIDTH / 2 + 32;
    const right = cx + PANEL_WIDTH / 2 - 32;
    let y = GAME_HEIGHT / 2 - 170;

    add(scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6).setOrigin(0));
    add(scene.add.rectangle(cx, GAME_HEIGHT / 2 - 20, PANEL_WIDTH, 330, 0x0b0d0b, 0.92).setStrokeStyle(2, 0x3a4038));

    text(cx, y, view.outcome === 'died' ? 'YOU DIED' : 'SECTOR CLEARED', 40).setOrigin(0.5, 0);
    y += 76;

    const { stats } = view;
    const rows: [string, string][] = [
      ['Waves survived', `${stats.wavesSurvived}/${view.waveCount}`],
      ['Kills', String(stats.kills)],
      ['Coins collected', String(stats.coins)],
      ['Survival time', formatDuration(stats.survivalMs)],
      ['High score', `${view.highScore} coins`],
    ];
    for (const [label, value] of rows) {
      text(left, y, label, 18, UI_COLORS.label);
      text(right, y, value, 18).setOrigin(1, 0);
      y += ROW_HEIGHT;
    }
    if (view.newHighScore) text(cx, y + 4, 'NEW HIGH SCORE', 18, '#d9a441').setOrigin(0.5, 0);
    y += 48;

    this.footerText = text(cx, y, '', 16, UI_COLORS.label).setOrigin(0.5, 0);
    this.setScreenShake(view.screenShake);
  }

  setScreenShake(on: boolean): void {
    this.footerText.setText(`[R] restart     [1] screen shake: ${on ? 'on' : 'off'}`);
  }
}
