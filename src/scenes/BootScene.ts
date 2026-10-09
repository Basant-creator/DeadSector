import Phaser from 'phaser';
import { Player } from '../entities/Player';

/** Entry scene: generates placeholder textures, then hands off to the arena. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    Player.createTexture(this);
    this.scene.start('ArenaScene');
  }
}
