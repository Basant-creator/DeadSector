import Phaser from 'phaser';
import { WEAPON_IDS, WEAPONS, type WeaponId } from '../combat/weapons';
import { PALETTE } from './palette';
import { addImage, addSheet, PixelArt, seeded } from './pixels';

/** Pixel scale of props and effects: one art pixel is 2 world pixels, like the characters. */
const S = 2;

export const muzzleKey = (id: WeaponId) => `fx-muzzle-${id}`;
export const weaponIconKey = (id: WeaponId) => `hud-weapon-${id}`;
export const lockerKey = (id: WeaponId) => `locker-${id}`;

/** Muzzle flash shape per weapon: length and width of the flame, in art px. */
const MUZZLE: Record<WeaponId, { length: number; width: number }> = {
  pistol: { length: 6, width: 5 },
  shotgun: { length: 8, width: 9 },
  rifle: { length: 9, width: 4 },
};

export function createPropArt(scene: Phaser.Scene): void {
  bullet(scene);
  for (const id of WEAPON_IDS) {
    muzzle(scene, id);
    weaponIcon(scene, id);
    locker(scene, id);
  }
  spark(scene);
  dust(scene);
  paper(scene);
  bloodSpray(scene);
  splats(scene);
  rock(scene);
  gateShutter(scene);
  hudIcons(scene);
  gradient(scene, 'fx-light', 128, 128, [[0, 1], [0.35, 0.45], [1, 0]]);
  // Steam: a soft grey wisp, faint even at full alpha.
  gradient(scene, 'fx-steam', 48, 48, [[0, 0.5], [0.6, 0.18], [1, 0]], '170,176,184');
  vignette(scene);
}

/** A tracer: hot core at the head, cooling to orange at the tail. Drawn at world scale. */
function bullet(scene: Phaser.Scene): void {
  const a = new PixelArt(12, 12);
  a.rect(1, 5, 3, 2, PALETTE.fireEdge, 140);
  a.rect(4, 5, 3, 2, PALETTE.fireMid);
  a.rect(7, 5, 4, 2, PALETTE.fireCore);
  addImage(scene, 'bullet', a, 1);
}

function muzzle(scene: Phaser.Scene, id: WeaponId): void {
  const { length, width } = MUZZLE[id];
  const h = width + 4;
  const frames = [1, 0.6].map((size) => {
    const a = new PixelArt(length + 2, h);
    const cy = h / 2;
    const len = Math.max(2, Math.round(length * size));
    a.ellipse(len / 2, cy, len / 2 + 0.5, (width / 2) * size + 0.5, PALETTE.fireEdge);
    a.ellipse(len / 2 - 0.5, cy, len / 2 - 0.5, (width / 2) * size - 0.5, PALETTE.fireMid);
    a.ellipse(len / 3, cy, len / 3, Math.max(0.8, (width / 4) * size), PALETTE.fireCore);
    if (id === 'shotgun' && size === 1) {
      for (const dy of [-width / 2, width / 2]) a.line(1, cy, len, cy + dy, PALETTE.fireMid);
    }
    return a;
  });
  addSheet(scene, muzzleKey(id), frames, S);
}

function spark(scene: Phaser.Scene): void {
  const frames = [0, 1, 2].map((t) => {
    const a = new PixelArt(9, 9);
    const c = 4;
    if (t === 0) {
      a.rect(c - 1, c - 1, 3, 3, PALETTE.fireCore);
      for (const [dx, dy] of [[-3, 0], [3, 0], [0, -3], [0, 3]]) a.px(c + dx, c + dy, PALETTE.spark);
    } else {
      const spread = t + 2;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1.4], [1.4, 0]]) {
        a.px(c + dx * spread, c + dy * spread, t === 1 ? PALETTE.spark : PALETTE.fireEdge);
      }
    }
    return a;
  });
  addSheet(scene, 'fx-spark', frames, S);
}

/** Concrete dust kicked up where a bullet hits a wall: grey, no glow. */
function dust(scene: Phaser.Scene): void {
  const frames = [0, 1, 2].map((t) => {
    const a = new PixelArt(10, 10);
    const spread = 1 + t * 1.4;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1.3], [1.3, 0], [-1.3, 0.4]]) {
      a.rect(5 + dx * spread, 5 + dy * spread, t === 0 ? 2 : 1, t === 0 ? 2 : 1, t === 2 ? 0x5a5c60 : 0x8a8c90);
    }
    return a;
  });
  addSheet(scene, 'fx-dust', frames, S);
}

/** A scrap of litter that drifts along the streets. */
function paper(scene: Phaser.Scene): void {
  const a = new PixelArt(4, 3);
  a.rect(0, 0, 4, 3, 0x8a8a7e);
  a.px(3, 0, 0x6a6a60);
  a.px(1, 1, 0x5a5a52);
  addImage(scene, 'fx-paper', a, S);
}

/** Blood thrown along +x from a hit. */
function bloodSpray(scene: Phaser.Scene): void {
  const rand = seeded(7);
  const drops = Array.from({ length: 10 }, () => ({ a: (rand() - 0.5) * 1.1, d: 1 + rand() * 3, r: rand() < 0.3 ? 1 : 0 }));
  const frames = [1, 2, 3].map((t) => {
    const a = new PixelArt(14, 12);
    for (const drop of drops) {
      const dist = drop.d * t * 1.4;
      const x = 2 + Math.cos(drop.a) * dist;
      const y = 6 + Math.sin(drop.a) * dist;
      a.rect(x, y, 1 + drop.r, 1 + drop.r, t === 3 ? PALETTE.bloodDark : PALETTE.blood);
    }
    return a;
  });
  addSheet(scene, 'fx-blood', frames, S);
}

/**
 * Splat decals, drawn at art scale (stamped into the decal layer, itself shown at 2x):
 * frames 0-3 small hit splats, 4-5 large death pools.
 */
function splats(scene: Phaser.Scene): void {
  const make = (size: number, seed: number, blobs: number) => {
    const rand = seeded(seed);
    const a = new PixelArt(size, size);
    const c = size / 2;
    a.disc(c, c, size * 0.22, PALETTE.bloodDark, 220);
    for (let i = 0; i < blobs; i++) {
      const ang = rand() * Math.PI * 2;
      const d = rand() * size * 0.3;
      a.disc(c + Math.cos(ang) * d, c + Math.sin(ang) * d, 1 + rand() * size * 0.12, rand() < 0.5 ? PALETTE.bloodDark : PALETTE.blood, 200);
    }
    for (let i = 0; i < blobs; i++) {
      const ang = rand() * Math.PI * 2;
      const d = size * (0.32 + rand() * 0.16);
      a.px(c + Math.cos(ang) * d, c + Math.sin(ang) * d, PALETTE.blood, 200);
    }
    return a;
  };
  const frames = [0, 1, 2, 3].map((i) => make(28, 100 + i, 5));
  frames.push(make(28, 200, 14), make(28, 201, 16));
  // Small splats were drawn on the large canvas for a shared frame size; shrink them.
  for (let i = 0; i < 4; i++) {
    const small = make(14, 100 + i, 5);
    const a = new PixelArt(28, 28);
    a.over(small, 7, 7);
    frames[i] = a;
  }
  addSheet(scene, 'fx-splat', frames, 1);
}

function rock(scene: Phaser.Scene): void {
  const a = new PixelArt(10, 10);
  a.ellipse(5, 5, 4, 3.5, 0x6a645c);
  a.ellipse(4.5, 4.4, 3, 2.4, 0x8a8278);
  a.px(3, 3, 0xa8a094);
  a.px(6, 6, 0x4a4640);
  a.outline(PALETTE.outline);
  addImage(scene, 'fx-rock', a, S);
}

/** A roll-up steel shutter for the alley gate: 1 x 3 tiles. */
function gateShutter(scene: Phaser.Scene): void {
  const a = new PixelArt(16, 48);
  a.rect(0, 0, 16, 48, PALETTE.metalDark);
  for (let y = 1; y < 48; y += 3) a.rect(1, y, 14, 2, PALETTE.metal);
  for (let y = 0; y < 48; y += 6) {
    a.rect(0, y, 2, 3, PALETTE.hazardAmber);
    a.rect(14, y + 3, 2, 3, PALETTE.hazardAmber);
  }
  a.rect(6, 22, 4, 4, PALETTE.hazardAmber);
  a.px(7, 23, PALETTE.hazardBlack);
  addImage(scene, 'gate-shutter', a, S);
}

/** A side view of each weapon for the HUD. */
function weaponIcon(scene: Phaser.Scene, id: WeaponId): void {
  const a = new PixelArt(26, 10);
  const p = PALETTE;
  const light = 0xb8bcc4;
  if (id === 'pistol') {
    a.rect(6, 2, 12, 3, light);
    a.rect(7, 5, 3, 4, 0x8a8e96);
    a.rect(16, 2, 2, 1, 0xdadde2);
  } else if (id === 'shotgun') {
    a.rect(1, 4, 7, 3, p.gunWood);
    a.rect(8, 3, 17, 2, light);
    a.rect(13, 5, 6, 2, p.gunWood);
  } else {
    a.rect(1, 3, 6, 3, 0x8a8e96);
    a.rect(7, 2, 10, 4, light);
    a.rect(11, 6, 3, 3, 0x8a8e96);
    a.rect(17, 3, 8, 2, light);
  }
  a.outline(PALETTE.outline);
  addImage(scene, weaponIconKey(id), a, S);
}

/** A wall-mounted weapon cabinet with the weapon inside and an amber trim. */
function locker(scene: Phaser.Scene, id: WeaponId): void {
  const a = new PixelArt(40, 10);
  a.rect(0, 0, 40, 10, PALETTE.hazardAmber);
  a.rect(1, 1, 38, 8, 0x1a1d22);
  a.rect(2, 2, 36, 6, 0x23282e);
  const color = WEAPONS[id].barrel.color;
  const len = id === 'pistol' ? 12 : id === 'shotgun' ? 22 : 26;
  a.rect(20 - len / 2, 4, len, 2, color);
  a.px(3, 2, PALETTE.amber);
  a.px(36, 2, PALETTE.amber);
  addImage(scene, lockerKey(id), a, S);
}

function hudIcons(scene: Phaser.Scene): void {
  const heart = new PixelArt(9, 8);
  heart.disc(2.5, 2.5, 2.5, 0xe03a3a);
  heart.disc(6.5, 2.5, 2.5, 0xe03a3a);
  for (let y = 3; y < 8; y++) heart.rect(y - 3, y, 9 - (y - 3) * 2, 1, 0xe03a3a);
  heart.px(2, 1, 0xff9a8a);
  heart.outline(PALETTE.outline);
  addImage(scene, 'hud-heart', heart, S);

  const coin = new PixelArt(9, 9);
  coin.disc(4.5, 4.5, 4, 0xc88a20);
  coin.disc(4.5, 4.5, 3, 0xf0b030);
  coin.rect(4, 2, 1, 5, 0xc88a20);
  coin.px(3, 2, 0xffe08a);
  coin.outline(PALETTE.outline);
  addImage(scene, 'hud-coin', coin, S);
}

/** A smooth radial gradient (not pixel art: lights and vignettes stay soft). */
function gradient(scene: Phaser.Scene, key: string, w: number, h: number, stops: [number, number][], color = '255,255,255'): void {
  const texture = scene.textures.createCanvas(key, w, h)!;
  const ctx = texture.getContext();
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2);
  for (const [at, alpha] of stops) g.addColorStop(at, `rgba(${color},${alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  texture.refresh();
}

/** Darkened screen edges: transparent centre, near-black corners. */
function vignette(scene: Phaser.Scene): void {
  const w = 640;
  const h = 360;
  const texture = scene.textures.createCanvas('fx-vignette', w, h)!;
  const ctx = texture.getContext();
  const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, w * 0.62);
  g.addColorStop(0, 'rgba(4,6,10,0)');
  g.addColorStop(1, 'rgba(4,6,10,0.75)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  texture.refresh();
}
