import type { Curve, Project, Pt } from '../model/types';
import { r2 } from '../model/geometry';
import { reach } from '../model/project';
import type { Graph } from '../exact/graph';
import { paintIcon, tracePiece, type Mapper } from './paint';
import type { Viewport } from './viewport';

export type Keyline = 'circle' | 'square' | 'portrait' | 'landscape';

export interface Scene {
  project: Project;
  vp: Viewport;
  width: number; // CSS pixels
  height: number;
  showGrid: boolean;
  keylines: Set<Keyline>;
  selectedId: string | null;
  selectedPiece: number | null;
  graph: Graph;
  faceColors: Map<number, string>;
  hover: Pt | null; // snapped grid point under the mouse
  marks: Pt[]; // points already clicked for the shape being drawn
  preview: Curve | null;
  guide: Pt | null; // point being dragged: draw crosshair lines and its coordinates
  guideTouch: boolean; // put the label well above a finger so it is not hidden
}

const COLORS = {
  outside: '#dedee6',
  reach: '#f0f0f4',
  board: '#ffffff',
  gridMinor: '#ececf2',
  gridMajor: '#d3d3de',
  border: '#9a9aa8',
  keyline: 'rgba(230, 70, 160, 0.55)',
  guide: 'rgba(124, 77, 255, 0.85)',
  line: '#1d1d24',
  selected: '#2f6bff',
  preview: 'rgba(47, 107, 255, 0.55)',
  mark: '#2f6bff',
};

/** Add the centre line of a curve to the current canvas path (screen coordinates). */
export function pathCurve(ctx: CanvasRenderingContext2D, c: Curve, vp: Viewport, move = true) {
  if (c.kind === 'line') {
    const a = vp.toScreen(c.a.x, c.a.y), b = vp.toScreen(c.b.x, c.b.y);
    if (move) ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    return;
  }
  const ctr = vp.toScreen(c.c.x, c.c.y);
  const r = Math.sqrt(r2(c.c, c.p)) * vp.scale;
  if (move) ctx.moveTo(ctr.x + r, ctr.y);
  ctx.arc(ctr.x, ctr.y, r, 0, Math.PI * 2);
}

function strokeCurve(ctx: CanvasRenderingContext2D, c: Curve, vp: Viewport, color: string, widthPx?: number) {
  if (c.guide) {
    // guides only cut other curves: a thin dashed centre line, whatever their width
    ctx.save();
    ctx.beginPath();
    pathCurve(ctx, c, vp);
    ctx.strokeStyle = color === COLORS.line ? COLORS.guide : color;
    ctx.lineWidth = widthPx ?? 1.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.beginPath();
  pathCurve(ctx, c, vp);
  ctx.strokeStyle = color;
  ctx.lineWidth = widthPx ?? c.style.width * vp.scale;
  ctx.lineCap = c.style.cap;
  ctx.lineJoin = c.style.join;
  ctx.miterLimit = c.style.miterLimit;
  ctx.stroke();
}

function drawGrid(ctx: CanvasRenderingContext2D, s: Scene) {
  const { vp } = s, { w, h } = s.project.grid;
  const r = reach(w, h);
  // hide lines that would be closer than 8px; show them again when zoomed in
  let step = 1;
  while (step * vp.scale < 8) step *= 2;
  const major = step * 4;
  const tl = vp.toGrid(0, 0), br = vp.toGrid(s.width, s.height);
  const x0 = Math.max(r.x0, Math.floor(tl.x / step) * step), x1 = Math.min(r.x1, Math.ceil(br.x));
  const y0 = Math.max(r.y0, Math.floor(tl.y / step) * step), y1 = Math.min(r.y1, Math.ceil(br.y));
  const top = vp.toScreen(0, r.y0).y, bottom = vp.toScreen(0, r.y1).y, left = vp.toScreen(r.x0, 0).x, right = vp.toScreen(r.x1, 0).x;
  ctx.lineWidth = 1;
  for (const pass of ['minor', 'major'] as const) {
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) {
      if ((((x % major) + major) % major === 0) !== (pass === 'major')) continue;
      const sx = Math.round(vp.toScreen(x, 0).x) + 0.5;
      ctx.moveTo(sx, top);
      ctx.lineTo(sx, bottom);
    }
    for (let y = y0; y <= y1; y += step) {
      if ((((y % major) + major) % major === 0) !== (pass === 'major')) continue;
      const sy = Math.round(vp.toScreen(0, y).y) + 0.5;
      ctx.moveTo(left, sy);
      ctx.lineTo(right, sy);
    }
    ctx.strokeStyle = pass === 'major' ? COLORS.gridMajor : COLORS.gridMinor;
    ctx.stroke();
  }
}

function drawKeylines(ctx: CanvasRenderingContext2D, s: Scene) {
  const { vp } = s, { w, h } = s.project.grid;
  const m = Math.min(w, h), cx = w / 2, cy = h / 2;
  // proportions of the common 24-unit icon keyline grid, scaled to this canvas
  const u = m / 24;
  ctx.save();
  ctx.strokeStyle = COLORS.keyline;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  const rect = (rw: number, rh: number) => {
    const a = vp.toScreen(cx - rw / 2, cy - rh / 2);
    ctx.strokeRect(a.x, a.y, rw * vp.scale, rh * vp.scale);
  };
  if (s.keylines.has('circle')) {
    const c = vp.toScreen(cx, cy);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 10 * u * vp.scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (s.keylines.has('square')) rect(18 * u, 18 * u);
  if (s.keylines.has('portrait')) rect(16 * u, 20 * u);
  if (s.keylines.has('landscape')) rect(20 * u, 16 * u);
  ctx.restore();
}

function dot(ctx: CanvasRenderingContext2D, vp: Viewport, p: Pt, r: number, fill: string, ring = false) {
  const q = vp.toScreen(p.x, p.y);
  ctx.beginPath();
  ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
  if (ring) {
    ctx.strokeStyle = fill;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

export function render(ctx: CanvasRenderingContext2D, s: Scene) {
  const { vp, project } = s, { w, h } = project.grid;
  ctx.fillStyle = COLORS.outside;
  ctx.fillRect(0, 0, s.width, s.height);
  // the reachable area outside the canvas (anchor points allowed, cropped on export)
  const area = reach(w, h), ro = vp.toScreen(area.x0, area.y0);
  ctx.fillStyle = COLORS.reach;
  ctx.fillRect(ro.x, ro.y, (area.x1 - area.x0) * vp.scale, (area.y1 - area.y0) * vp.scale);
  const o = vp.toScreen(0, 0);
  ctx.fillStyle = COLORS.board;
  ctx.fillRect(o.x, o.y, w * vp.scale, h * vp.scale);
  if (s.showGrid) drawGrid(ctx, s);
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(o.x) + 0.5, Math.round(o.y) + 0.5, Math.round(w * vp.scale), Math.round(h * vp.scale));
  if (s.keylines.size) drawKeylines(ctx, s);

  const m: Mapper = { s: vp.scale, ox: vp.ox, oy: vp.oy };
  const g = s.graph;
  paintIcon(ctx, project.curves, g, s.faceColors, m, COLORS.line);
  // guides: thin dashed centre lines, only their remaining pieces
  const guides = new Set(project.curves.filter((c) => c.guide).map((c) => c.id));
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = COLORS.guide;
  for (const pc of g.pieces) {
    if (pc.erased || !guides.has(pc.curve)) continue;
    ctx.beginPath();
    tracePiece(ctx, g, pc, false, m, true);
    ctx.stroke();
  }
  ctx.restore();
  // selection: the whole curve faintly, the tapped piece strongly
  const sel = project.curves.find((c) => c.id === s.selectedId);
  if (sel) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const pc of g.pieces) {
      if (pc.erased || pc.curve !== sel.id) continue;
      const strong = pc.index === s.selectedPiece;
      ctx.beginPath();
      tracePiece(ctx, g, pc, false, m, true);
      ctx.strokeStyle = strong ? 'rgba(47,107,255,0.45)' : 'rgba(47,107,255,0.18)';
      ctx.lineWidth = sel.guide ? 8 : Math.max(sel.style.width * vp.scale, 6);
      ctx.stroke();
      ctx.strokeStyle = COLORS.selected;
      ctx.lineWidth = strong ? 2.5 : 1;
      ctx.stroke();
    }
    ctx.restore();
  }
  if (s.preview) strokeCurve(ctx, s.preview, vp, COLORS.preview);

  const r = Math.max(3, Math.min(6, vp.scale / 4));
  for (const p of s.marks) dot(ctx, vp, p, r, COLORS.mark);
  if (s.guide) drawGuide(ctx, s, s.guide);
  if (s.hover) dot(ctx, vp, s.hover, r + 3, COLORS.mark, true);
}

function drawGuide(ctx: CanvasRenderingContext2D, s: Scene, p: Pt) {
  const { vp } = s, { w, h } = s.project.grid;
  const q = vp.toScreen(p.x, p.y), o = vp.toScreen(0, 0), e = vp.toScreen(w, h);
  ctx.save();
  ctx.strokeStyle = 'rgba(47, 107, 255, 0.45)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(o.x, Math.round(q.y) + 0.5);
  ctx.lineTo(e.x, Math.round(q.y) + 0.5);
  ctx.moveTo(Math.round(q.x) + 0.5, o.y);
  ctx.lineTo(Math.round(q.x) + 0.5, e.y);
  ctx.stroke();
  ctx.setLineDash([]);
  const text = `${p.x}, ${p.y}`;
  ctx.font = '600 13px system-ui, sans-serif';
  const tw = ctx.measureText(text).width + 12, th = 22;
  // keep the label on screen; above the point (far above a finger)
  let lx = q.x - tw / 2, ly = q.y - (s.guideTouch ? 72 : 34);
  lx = Math.max(4, Math.min(s.width - tw - 4, lx));
  if (ly < 4) ly = q.y + (s.guideTouch ? 40 : 14);
  ctx.fillStyle = COLORS.mark;
  ctx.beginPath();
  ctx.roundRect(lx, ly, tw, th, 6);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, lx + 6, ly + th / 2);
  ctx.restore();
}
