import Phaser from 'phaser';
import { Bullet } from '../combat/Bullet';
import { Player } from '../entities/Player';
import { Walker } from '../entities/Walker';

/** Entry scene: generates placeholder textures, then hands off to the arena. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    Player.createTexture(this);
    Walker.createTexture(this);
    Bullet.createTexture(this);
    this.scene.start('ArenaScene');
  }
}
