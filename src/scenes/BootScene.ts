import Phaser from 'phaser';
import { createCharacterArt } from '../art/characters';
import { createCityArt } from '../art/cityArt';
import { createPropArt } from '../art/props';
import { createSfx } from '../audio/sfx';

/**
 * Entry scene: draws every texture and animation and synthesises every sound the game uses
 * (all generated in code, see src/art and src/audio), then hands off to the arena. Runs once;
 * restarts reuse what it made.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    createCharacterArt(this);
    createPropArt(this);
    createCityArt(this);
    createSfx(this);
    this.scene.start('ArenaScene');
  }
}
