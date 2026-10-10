import Phaser from 'phaser';
import { createCharacterArt } from '../art/characters';
import { createCityArt } from '../art/cityArt';
import { createMechArt } from '../art/mechArt';
import { createPropArt } from '../art/props';
import { audioFiles, settleMusic } from '../audio/assets';
import { createSfx } from '../audio/sfx';

/**
 * Entry scene: loads the audio files that ship with the game (src/assets/audio, if any), draws
 * every texture and animation and synthesises every sound no file provides (src/art, src/audio),
 * then hands off to the arena. Runs once; restarts reuse what it made.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload(): void {
    for (const { key, urls } of audioFiles()) this.load.audio(key, urls);
    // A file that fails to load or decode is simply absent: its recipe or placeholder takes over.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.info(`[audio] ${file.key} did not load; using the built-in sound instead.`);
    });
  }

  create(): void {
    createCharacterArt(this);
    createMechArt(this);
    createPropArt(this);
    createCityArt(this);
    createSfx(this);
    this.registry.set('musicSource', settleMusic(this));
    this.scene.start('ArenaScene');
  }
}
