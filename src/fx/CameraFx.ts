import Phaser from 'phaser';

export type ShakeLevel = 'full' | 'reduced' | 'off';

/** How much of every shake and kick each setting keeps. */
export const SHAKE_SCALE: Readonly<Record<ShakeLevel, number>> = { full: 1, reduced: 0.35, off: 0 };

/** Upper bound on any shake, however many impacts ask for one. */
const MAX_INTENSITY = 0.014;

/**
 * Camera feedback with one owner, so effects never stack into a mess:
 * - shake: a new shake only replaces the running one if it is stronger than what is left of it;
 * - kick: nudges the camera against the aim. The camera's follow eases it back by itself, so
 *   repeated kicks settle instead of piling up, and a kick along the aim line leaves the aim
 *   angle unchanged.
 * Both are scaled by the player's shake setting, and both stop entirely at 'off'.
 */
export class CameraFx {
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private level: ShakeLevel;
  private shakeIntensity = 0;
  private shakeEndsAt = 0;
  private shakeMs = 1;

  constructor(camera: Phaser.Cameras.Scene2D.Camera, level: ShakeLevel) {
    this.camera = camera;
    this.level = level;
  }

  setLevel(level: ShakeLevel): void {
    this.level = level;
  }

  shake(intensity: number, ms: number, now: number): void {
    const scaled = Math.min(MAX_INTENSITY, intensity * SHAKE_SCALE[this.level]);
    if (scaled <= 0) return;
    const left = now < this.shakeEndsAt ? this.shakeIntensity * ((this.shakeEndsAt - now) / this.shakeMs) : 0;
    if (scaled <= left) return;
    this.shakeIntensity = scaled;
    this.shakeMs = ms;
    this.shakeEndsAt = now + ms;
    this.camera.shake(ms, scaled, true);
  }

  /** Push the view *px* along the direction *angle* (pass the aim + PI to kick back). */
  kick(angle: number, px: number): void {
    const scaled = px * SHAKE_SCALE[this.level];
    if (scaled <= 0) return;
    this.camera.scrollX += Math.cos(angle) * scaled;
    this.camera.scrollY += Math.sin(angle) * scaled;
  }
}
