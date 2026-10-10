/**
 * The game's colours. The world stays dark and desaturated; bright colours are kept for what the
 * player must read at a glance: zombies (toxic green, sickly yellow), damage and combat (red,
 * orange), and a few environmental lights (cyan, magenta, amber).
 */
export const PALETTE = {
  outline: 0x0c0c10,
  shadow: 0x000000,

  // Ground.
  asphalt: 0x22252b,
  asphaltLight: 0x2a2e35,
  asphaltDark: 0x1b1d22,
  crack: 0x15171b,
  concrete: 0x3a3d43,
  concreteLight: 0x44474e,
  concreteSeam: 0x2c2e33,
  dirt: 0x24291f,
  dirtLight: 0x2d3326,
  dirtDark: 0x1c2018,
  alleyFloor: 0x1d1c21,
  alleyBrick: 0x24222a,
  alleyMortar: 0x161519,
  paintYellow: 0x9a8a3a,
  paintWhite: 0x7c7e80,

  // Structures.
  roofs: [0x2b2f37, 0x302d2c, 0x29312e, 0x34343b],
  roofGravel: 0x3a3e46,
  parapet: 0x4a4e57,
  brick: 0x4a2c28,
  brickLight: 0x5c3832,
  mortar: 0x2a1a18,
  metal: 0x5a6068,
  metalDark: 0x34393f,
  glass: 0x24414c,
  glassGlint: 0x5aa8b8,
  carBodies: [0x6a2e28, 0x2e4660, 0x56564e, 0x6a5826],
  dumpster: 0x2c5236,
  dumpsterLid: 0x223f2a,
  rust: 0x6a3a22,
  barrier: 0x8a8a80,
  barrierDark: 0x6a6a62,
  hazardAmber: 0xd89a2a,
  hazardBlack: 0x1a1a1a,

  // Characters.
  playerJacket: 0xd8d6cc,
  playerJacketShade: 0xa8a69e,
  playerSkin: 0xd8a888,
  playerHair: 0x2a1e18,
  playerAccent: 0x3ad8e8,
  gunMetal: 0x3a3e44,
  gunDark: 0x202328,
  gunWood: 0x6a4224,
  blood: 0x8a1a1a,
  bloodDark: 0x5a0e10,
  flesh: 0xa8382a,
  bone: 0xd8d0b8,

  // Light and effects.
  amber: 0xffb040,
  cyan: 0x3ad8e8,
  magenta: 0xff3aa0,
  fireCore: 0xfff6d0,
  fireMid: 0xffc640,
  fireEdge: 0xf0602a,
  spark: 0xffd070,
  danger: 0xe0553d,
} as const;

/** Each zombie type's colours: skin, clothes, and an optional glowing accent. */
export const ZOMBIE_COLORS = {
  walker: { skin: 0x8aa040, skinShade: 0x6a7e30, clothes: 0x4a4a40, clothesShade: 0x383830 },
  runner: { skin: 0xc8c050, skinShade: 0x9a9438, clothes: 0x3a4658, clothesShade: 0x2c3646 },
  brute: { skin: 0x6a8a36, skinShade: 0x506a28, clothes: 0x5a2622, clothesShade: 0x401a18 },
  elite: { skin: 0x9ab848, skinShade: 0x789036, clothes: 0x26283a, clothesShade: 0x1a1c2a, glow: 0xff3aa0 },
  giant: { skin: 0xb0b044, skinShade: 0x868632, clothes: 0x4a3a2a, clothesShade: 0x34281c, glow: 0xff4030 },
} as const;
