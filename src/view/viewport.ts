/** Maps grid coordinates to screen (CSS) pixels: screen = origin + grid * scale. */
export class Viewport {
  scale = 20; // CSS pixels per grid unit
  ox = 0;
  oy = 0;

  static readonly MIN_SCALE = 1;
  static readonly MAX_SCALE = 400;

  toScreen(x: number, y: number) {
    return { x: this.ox + x * this.scale, y: this.oy + y * this.scale };
  }

  toGrid(sx: number, sy: number) {
    return { x: (sx - this.ox) / this.scale, y: (sy - this.oy) / this.scale };
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const next = Math.min(Viewport.MAX_SCALE, Math.max(Viewport.MIN_SCALE, this.scale * factor));
    const g = this.toGrid(sx, sy);
    this.scale = next;
    this.ox = sx - g.x * next;
    this.oy = sy - g.y * next;
  }

  fit(w: number, h: number, viewW: number, viewH: number, pad = 32) {
    this.scale = Math.min(Viewport.MAX_SCALE, Math.max(Viewport.MIN_SCALE,
      Math.min((viewW - pad * 2) / w, (viewH - pad * 2) / h)));
    this.ox = (viewW - w * this.scale) / 2;
    this.oy = (viewH - h * this.scale) / 2;
  }
}
