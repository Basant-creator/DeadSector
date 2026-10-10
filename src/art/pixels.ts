import Phaser from 'phaser';

/**
 * A small RGBA pixel buffer for drawing pixel art in code, at the art's own resolution. Shapes
 * are pixel-exact (no anti-aliasing); `outline` gives sprites the hard dark edge that keeps their
 * silhouettes readable against any ground.
 */
export class PixelArt {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  /** Paint one pixel; *alpha* below 255 blends over what is there. */
  px(x: number, y: number, color: number, alpha = 255): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    const d = this.data;
    if (alpha >= 255 || d[i + 3] === 0) {
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = Math.max(d[i + 3], alpha);
      return;
    }
    const a = alpha / 255;
    d[i] = d[i] * (1 - a) + r * a;
    d[i + 1] = d[i + 1] * (1 - a) + g * a;
    d[i + 2] = d[i + 2] * (1 - a) + b * a;
    d[i + 3] = Math.min(255, d[i + 3] + alpha * (1 - d[i + 3] / 255));
  }

  rect(x: number, y: number, w: number, h: number, color: number, alpha = 255): void {
    for (let yy = Math.floor(y); yy < Math.floor(y + h); yy++) {
      for (let xx = Math.floor(x); xx < Math.floor(x + w); xx++) this.px(xx, yy, color, alpha);
    }
  }

  /** Filled ellipse centred on (cx, cy), measured from pixel centres. */
  ellipse(cx: number, cy: number, rx: number, ry: number, color: number, alpha = 255): void {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.px(x, y, color, alpha);
      }
    }
  }

  disc(cx: number, cy: number, r: number, color: number, alpha = 255): void {
    this.ellipse(cx, cy, r, r, color, alpha);
  }

  line(x0: number, y0: number, x1: number, y1: number, color: number, alpha = 255): void {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, color, alpha);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  isOpaque(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.data[(y * this.width + x) * 4 + 3] > 0;
  }

  /** Ring every opaque area with a one-pixel *color* edge (4-neighbourhood). */
  outline(color: number): void {
    const edge: number[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.isOpaque(x, y)) continue;
        if (this.isOpaque(x - 1, y) || this.isOpaque(x + 1, y) || this.isOpaque(x, y - 1) || this.isOpaque(x, y + 1)) {
          edge.push(x, y);
        }
      }
    }
    for (let i = 0; i < edge.length; i += 2) this.px(edge[i], edge[i + 1], color);
  }

  /** Draw *other* on top of this at (dx, dy). */
  over(other: PixelArt, dx = 0, dy = 0): void {
    const d = other.data;
    for (let y = 0; y < other.height; y++) {
      for (let x = 0; x < other.width; x++) {
        const i = (y * other.width + x) * 4;
        if (d[i + 3] === 0) continue;
        this.px(x + dx, y + dy, (d[i] << 16) | (d[i + 1] << 8) | d[i + 2], d[i + 3]);
      }
    }
  }

  /** A canvas of this art scaled by *scale* with no smoothing: every art pixel a hard square. */
  toCanvas(scale = 1): HTMLCanvasElement {
    const base = document.createElement('canvas');
    base.width = this.width;
    base.height = this.height;
    base.getContext('2d')!.putImageData(new ImageData(this.data, this.width, this.height), 0, 0);
    if (scale === 1) return base;
    const out = document.createElement('canvas');
    out.width = this.width * scale;
    out.height = this.height * scale;
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, 0, 0, out.width, out.height);
    return out;
  }
}

/**
 * Register *frames* (all the same size) as one sprite sheet texture under *key*, frames named
 * 0..n-1, each art pixel drawn as a *scale* x *scale* block, sampled nearest-neighbour.
 */
export function addSheet(scene: Phaser.Scene, key: string, frames: readonly PixelArt[], scale: number): void {
  const fw = frames[0].width * scale;
  const fh = frames[0].height * scale;
  const texture = scene.textures.createCanvas(key, fw * frames.length, fh)!;
  const ctx = texture.getContext();
  ctx.imageSmoothingEnabled = false;
  frames.forEach((frame, i) => {
    ctx.drawImage(frame.toCanvas(scale), i * fw, 0);
    texture.add(i, 0, i * fw, 0, fw, fh);
  });
  texture.refresh();
  texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

/** A single-frame pixel-art texture. */
export function addImage(scene: Phaser.Scene, key: string, art: PixelArt, scale: number): void {
  addSheet(scene, key, [art], scale);
}

/** Seeded PRNG (mulberry32), so generated art looks the same on every load. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Darken (*amount* < 0) or lighten a colour by a fraction of each channel. */
export function shade(color: number, amount: number): number {
  const ch = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amount < 0 ? c : 255 - c) * amount)));
  return (ch((color >> 16) & 0xff) << 16) | (ch((color >> 8) & 0xff) << 8) | ch(color & 0xff);
}
