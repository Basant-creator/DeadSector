import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';

/** Placeholder entry scene. Confirms the canvas renders and scales; no gameplay yet. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'DEAD SECTOR', {
        fontFamily: 'monospace',
        fontSize: '64px',
        color: '#c8d6c0',
      })
      .setOrigin(0.5);
  }
}
