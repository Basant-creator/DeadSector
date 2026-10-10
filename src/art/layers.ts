/**
 * Draw order, back to front. Gameplay objects keep the depths they always had (enemies 1,
 * bullets 2, player 3, thrown rock 4); the rendered layers fit around them.
 */
export const LAYER = {
  ground: -3,
  decals: -2,
  obstacles: -1,
  props: -0.9,
  lights: 0.2,
  telegraph: 0.5,
  effects: 2.5,
  foreground: 5,
  vignette: 9,
  hurtFlash: 9.5,
} as const;

/** Every world layer is drawn at half resolution: one art pixel is 2 world pixels. */
export const WORLD_ART_SCALE = 2;
