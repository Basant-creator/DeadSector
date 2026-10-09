import Phaser from 'phaser';
import { Bullet } from '../combat/Bullet';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';

/** Entry scene: generates placeholder textures, then hands off to the arena. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    Player.createTextures(this);
    Enemy.createTextures(this);
    Bullet.createTexture(this);
    this.scene.start('ArenaScene');
  }
}
