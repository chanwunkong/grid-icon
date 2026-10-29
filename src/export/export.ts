import type { Graph } from '../exact/graph';
import type { Project } from '../model/types';
import { t } from '../i18n';
import { buildStrokes, facesByColor, junctionDots, paintFills, paintIcon, strokePath, SvgPath, traceCycle, type Mapper } from '../view/paint';
import { contentBounds, outlinesByColor, traceOutline } from '../view/outline';

export interface ExportOptions {
  transparent: boolean;
  background: string;
  margin: number; // grid units around the canvas
  outline: boolean; // strokes as one united filled outline (no seams, pure-fill SVG)
  crop: boolean; // cut everything outside the canvas; off = keep what falls in the margin
}

export interface Overflow {
  left: number;
  top: number;
  right: number;
  bottom: number;
  margin: number; // smallest whole-grid margin that keeps everything
}

/** How far the drawn content (stroke outlines incl. caps and joins, fills) reaches past the canvas. */
export function overflow(project: Project, g: Graph, faceColors: Map<number, string>): Overflow | null {
  const b = contentBounds(project.curves, g, faceColors.keys());
  if (!b) return null;
  const { w, h } = project.grid, eps = 1e-6;
  const o = { left: Math.max(0, -b.x0), top: Math.max(0, -b.y0), right: Math.max(0, b.x1 - w), bottom: Math.max(0, b.y1 - h) };
  const most = Math.max(o.left, o.top, o.right, o.bottom);
  return most > eps ? { ...o, margin: Math.ceil(most - eps) } : null;
}

export const DEFAULT_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

/** Output pixel size for a requested size N (the longer side), and the grid → pixel mapping. */
export function layout(project: Project, size: number, margin: number) {
  const { w, h } = project.grid;
  const W = w + 2 * margin, H = h + 2 * margin;
  const s = size / Math.max(W, H);
  return { width: Math.round(W * s), height: Math.round(H * s), m: { s, ox: margin * s, oy: margin * s } as Mapper };
}

/** Pixel snapping applies when every grid unit is a whole number of pixels. */
export const pixelAligned = (s: number) => Math.abs(s - Math.round(s)) < 1e-9 && Math.round(s) >= 1;

export function renderPNG(project: Project, g: Graph, faceColors: Map<number, string>, opts: ExportOptions, size: number): HTMLCanvasElement {
  const { width, height, m } = layout(project, size, opts.margin);
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d')!;
  if (!opts.transparent) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.save();
  if (opts.crop) {
    // only the canvas itself is exported; anything drawn outside it is cut off
    ctx.beginPath();
    ctx.rect(m.ox, m.oy, project.grid.w * m.s, project.grid.h * m.s);
    ctx.clip();
  }
  if (opts.outline) {
    paintFills(ctx, g, faceColors, m);
    for (const [color, paths] of outlinesByColor(project.curves, g)) {
      ctx.beginPath();
      traceOutline(ctx, paths, m);
      ctx.fillStyle = color;
      ctx.fill('nonzero');
    }
  } else {
    // odd pixel widths sit on pixel centres when shifted half a pixel, so they stay sharp
    const nudge = pixelAligned(m.s) ? (wpx: number) => (Math.round(wpx) % 2 === 1 ? 0.5 : 0) : undefined;
    paintIcon(ctx, project.curves, g, faceColors, m, nudge);
  }
  ctx.restore();
  return cv;
}

export function pngBlob(cv: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error(t('PNG 產生失敗')))), 'image/png'));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** SVG in grid units (viewBox), with real arcs; sized `pixelSize` on its longer side. */
export function renderSVG(project: Project, g: Graph, faceColors: Map<number, string>, opts: ExportOptions, pixelSize = 512): string {
  const { w, h } = project.grid, mg = opts.margin;
  const W = w + 2 * mg, H = h + 2 * mg;
  const k = pixelSize / Math.max(W, H);
  const m: Mapper = { s: 1, ox: mg, oy: mg };
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W * k)}" height="${Math.round(H * k)}" viewBox="0 0 ${W} ${H}">`);
  if (opts.crop) out.push(`<defs><clipPath id="canvas"><rect x="${mg}" y="${mg}" width="${w}" height="${h}"/></clipPath></defs>`);
  if (!opts.transparent) out.push(`<rect width="${W}" height="${H}" fill="${esc(opts.background)}"/>`);
  out.push(opts.crop ? '<g clip-path="url(#canvas)">' : '<g>');
  for (const [color, faces] of facesByColor(faceColors)) {
    const p = new SvgPath();
    for (const face of faces) {
      traceCycle(p, g, face, m);
      for (const hole of g.holes(face)) traceCycle(p, g, hole, m);
    }
    out.push(`<path d="${p}" fill="${esc(color)}" fill-rule="nonzero"/>`);
  }
  if (opts.outline) {
    // pure fills: the united outline of the strokes, one path per colour
    for (const [color, paths] of outlinesByColor(project.curves, g)) {
      const p = new SvgPath();
      traceOutline(p, paths, m);
      if (p.d.length) out.push(`<path d="${p}" fill="${esc(color)}" fill-rule="nonzero"/>`);
    }
    out.push('</g></svg>');
    return out.join('\n');
  }
  for (const st of buildStrokes(project.curves, g)) {
    const p = new SvgPath();
    strokePath(p, g, st, m);
    const miter = st.style.join === 'miter' ? ` stroke-miterlimit="${st.style.miterLimit}"` : '';
    out.push(`<path d="${p}" fill="none" stroke="${esc(st.style.color)}" stroke-width="${st.style.width}" stroke-linecap="${st.style.cap}" stroke-linejoin="${st.style.join}"${miter}/>`);
  }
  for (const d of junctionDots(project.curves, g))
    out.push(`<circle cx="${d.x + mg}" cy="${d.y + mg}" r="${d.r}" fill="${esc(d.color)}"/>`);
  out.push('</g></svg>');
  return out.join('\n');
}

// ------------------------------------------------------------------ zip (stored, no compression)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A minimal zip archive so several PNG sizes download as one file (also works on phones). */
export function zip(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 0, true); // stored
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, size, true);
    cen.setUint32(24, size, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + size;
  }
  const cenSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/zip' });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

