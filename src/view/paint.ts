// Floating-point drawing of the exact model. Shared by the editor canvas, PNG export and SVG export.
import type { Graph, Piece } from '../exact/graph';
import type { Curve, Style } from '../model/types';

/** grid → output: X = ox + x·s, Y = oy + y·s */
export interface Mapper {
  s: number;
  ox: number;
  oy: number;
}

const TAU = Math.PI * 2;

/** A piece walked forwards (from → to) or backwards. */
export interface Step {
  piece: number;
  reversed: boolean;
}

export interface Stroke {
  style: Style;
  steps: Step[];
  closed: boolean;
}

export interface Dot {
  x: number;
  y: number;
  r: number; // grid units
}

/** Something that accepts path commands: a canvas context, or the SVG path writer below. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, anticlockwise: boolean): void;
  closePath(): void;
}

function pieceEnds(g: Graph, pc: Piece, reversed: boolean) {
  const a = g.vertices[pc.from].f, b = g.vertices[pc.to].f;
  return reversed ? { start: b, end: a } : { start: a, end: b };
}

/** Add one piece to the current path (assumes the pen is at its start). */
export function tracePiece(sink: PathSink, g: Graph, pc: Piece, reversed: boolean, m: Mapper, move: boolean) {
  const { start, end } = pieceEnds(g, pc, reversed);
  if (move) sink.moveTo(m.ox + start.x * m.s, m.oy + start.y * m.s);
  if (pc.geom.kind === 'line') {
    sink.lineTo(m.ox + end.x * m.s, m.oy + end.y * m.s);
    return;
  }
  const { c, r2 } = pc.geom, r = Math.sqrt(Number(r2));
  const a0 = Math.atan2(start.y - c.y, start.x - c.x);
  let a1 = Math.atan2(end.y - c.y, end.x - c.x);
  // forwards = counter-clockwise in the model = increasing canvas angle (canvas "clockwise")
  if (pc.from === pc.to) a1 = a0 + (reversed ? -TAU : TAU);
  sink.arc(m.ox + c.x * m.s, m.oy + c.y * m.s, r * m.s, a0, a1, reversed);
}

/** Trace a cycle of half-edges (a face boundary or a hole). */
export function traceCycle(sink: PathSink, g: Graph, cycle: number, m: Mapper) {
  const hs = g.cycles[cycle].halves;
  hs.forEach((hid, i) => {
    const h = g.halves[hid], e = g.edges[h.edge];
    const pc = g.pieces[e.pieces[0]];
    // walk the edge's piece from h.origin to h.target (a full-circle loop: by the half-edge's direction)
    const reversed = pc.from === pc.to ? !h.forward : pc.from !== h.origin;
    tracePiece(sink, g, pc, reversed, m, i === 0);
  });
  sink.closePath();
}

/** Fill every coloured face (outer boundary plus holes; holes wind the other way, so nonzero works). */
export function paintFills(ctx: CanvasRenderingContext2D, g: Graph, faceColors: Map<number, string>, m: Mapper) {
  for (const [face, color] of faceColors) {
    ctx.beginPath();
    traceCycle(ctx, g, face, m);
    for (const hole of g.holes(face)) traceCycle(ctx, g, hole, m);
    ctx.fillStyle = color;
    ctx.fill('nonzero');
  }
}

const styleKey = (s: Style) => `${s.width}|${s.cap}|${s.join}|${s.miterLimit}`;

/** Unit direction leaving vertex `at` along a piece. */
function leaving(g: Graph, pc: Piece, atStart: boolean) {
  const v = g.vertices[atStart ? pc.from : pc.to].f;
  if (pc.geom.kind === 'line') {
    const o = g.vertices[atStart ? pc.to : pc.from].f;
    const dx = o.x - v.x, dy = o.y - v.y, n = Math.hypot(dx, dy) || 1;
    return { x: dx / n, y: dy / n };
  }
  const { c } = pc.geom, wx = v.x - c.x, wy = v.y - c.y, n = Math.hypot(wx, wy) || 1;
  // counter-clockwise tangent at the start; at the end we leave going the other way
  return atStart ? { x: -wy / n, y: wx / n } : { x: wy / n, y: -wx / n };
}

/**
 * Join the visible pieces into stroke paths. Pieces whose cap is not round are chained at shared
 * end points so the join style applies; at an end point with several pieces, the two that
 * continue most smoothly are joined first. Pieces that come back to their start become closed paths.
 */
export function buildStrokes(curves: Curve[], g: Graph): Stroke[] {
  const byId = new Map(curves.map((c) => [c.id, c]));
  const visible = g.pieces.filter((p) => !p.erased && !byId.get(p.curve)?.guide);
  const out: Stroke[] = [];
  const groups = new Map<string, Piece[]>();
  for (const p of visible) {
    const st = byId.get(p.curve)!.style;
    if (st.cap === 'round') {
      out.push({ style: st, steps: [{ piece: p.index, reversed: false }], closed: p.from === p.to });
      continue;
    }
    const k = styleKey(st);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }
  for (const pieces of groups.values()) {
    const style = byId.get(pieces[0].curve)!.style;
    // piece ends at each vertex; pair[end] = the end it continues into
    type End = { piece: Piece; atStart: boolean; key: string };
    const endKey = (p: Piece, atStart: boolean) => `${p.index}:${atStart ? 's' : 'e'}`;
    const atVertex = new Map<number, End[]>();
    for (const p of pieces)
      for (const atStart of [true, false]) {
        const v = atStart ? p.from : p.to;
        if (!atVertex.has(v)) atVertex.set(v, []);
        atVertex.get(v)!.push({ piece: p, atStart, key: endKey(p, atStart) });
      }
    const pair = new Map<string, End>();
    for (const ends of atVertex.values()) {
      const free = [...ends];
      while (free.length >= 2) {
        let best = -Infinity, bi = 0, bj = 1;
        for (let i = 0; i < free.length; i++)
          for (let j = i + 1; j < free.length; j++) {
            const a = leaving(g, free[i].piece, free[i].atStart), b = leaving(g, free[j].piece, free[j].atStart);
            const smooth = -(a.x * b.x + a.y * b.y); // 1 = straight through
            if (smooth > best) [best, bi, bj] = [smooth, i, j];
          }
        pair.set(free[bi].key, free[bj]);
        pair.set(free[bj].key, free[bi]);
        free.splice(bj, 1);
        free.splice(bi, 1);
      }
    }
    const used = new Set<number>();
    const walk = (first: Piece, enterAtStart: boolean): Stroke => {
      const steps: Step[] = [];
      let p = first, atStart = enterAtStart;
      for (;;) {
        used.add(p.index);
        steps.push({ piece: p.index, reversed: !atStart });
        const nxt = pair.get(endKey(p, !atStart)); // leave through the other end
        if (!nxt || used.has(nxt.piece.index)) {
          const closed = !!nxt && nxt.piece.index === first.index && nxt.atStart === enterAtStart;
          return { style, steps, closed };
        }
        p = nxt.piece;
        atStart = nxt.atStart;
      }
    };
    // open chains start at an unpaired end; what is left afterwards are closed loops
    for (const p of pieces)
      for (const atStart of [true, false])
        if (!used.has(p.index) && !pair.has(endKey(p, atStart))) out.push(walk(p, atStart));
    for (const p of pieces) if (!used.has(p.index)) out.push(walk(p, true));
  }
  return out;
}

/** Where three or more visible pieces meet: a round dot as wide as the widest of them. */
export function junctionDots(curves: Curve[], g: Graph): Dot[] {
  const byId = new Map(curves.map((c) => [c.id, c]));
  const count = new Map<number, { n: number; w: number }>();
  for (const p of g.pieces) {
    const c = byId.get(p.curve);
    if (p.erased || !c || c.guide) continue;
    for (const v of p.from === p.to ? [p.from, p.from] : [p.from, p.to]) {
      const e = count.get(v) ?? { n: 0, w: 0 };
      count.set(v, { n: e.n + 1, w: Math.max(e.w, c.style.width) });
    }
  }
  const dots: Dot[] = [];
  for (const [v, { n, w }] of count) if (n >= 3) dots.push({ x: g.vertices[v].f.x, y: g.vertices[v].f.y, r: w / 2 });
  return dots;
}

export function strokePath(sink: PathSink, g: Graph, st: Stroke, m: Mapper) {
  st.steps.forEach((s, i) => tracePiece(sink, g, g.pieces[s.piece], s.reversed, m, i === 0));
  if (st.closed) sink.closePath();
}

/** The icon itself: fills, then strokes, then junction dots. */
export function paintIcon(ctx: CanvasRenderingContext2D, curves: Curve[], g: Graph, faceColors: Map<number, string>, m: Mapper, ink: string,
  pixelNudge?: (widthPx: number) => number) {
  paintFills(ctx, g, faceColors, m);
  for (const st of buildStrokes(curves, g)) {
    const wpx = st.style.width * m.s, nudge = pixelNudge ? pixelNudge(wpx) : 0;
    ctx.save();
    if (nudge) ctx.translate(nudge, nudge);
    ctx.beginPath();
    strokePath(ctx, g, st, m);
    ctx.strokeStyle = ink;
    ctx.lineWidth = wpx;
    ctx.lineCap = st.style.cap;
    ctx.lineJoin = st.style.join;
    ctx.miterLimit = st.style.miterLimit;
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = ink;
  for (const d of junctionDots(curves, g)) {
    ctx.beginPath();
    ctx.arc(m.ox + d.x * m.s, m.oy + d.y * m.s, d.r * m.s, 0, TAU);
    ctx.fill();
  }
}

/** Writes path commands as SVG path data. Arcs become A commands (full turns split in two). */
export class SvgPath implements PathSink {
  d: string[] = [];
  private f = (n: number) => `${Math.round(n * 1e4) / 1e4}`;

  moveTo(x: number, y: number) {
    this.d.push(`M${this.f(x)} ${this.f(y)}`);
  }

  lineTo(x: number, y: number) {
    this.d.push(`L${this.f(x)} ${this.f(y)}`);
  }

  arc(cx: number, cy: number, r: number, a0: number, a1: number, anticlockwise: boolean) {
    let sweep = anticlockwise ? a0 - a1 : a1 - a0; // angle swept, positive
    if (Math.abs(sweep) >= TAU - 1e-12) sweep = TAU;
    else sweep = ((sweep % TAU) + TAU) % TAU;
    const dirSign = anticlockwise ? -1 : 1, sweepFlag = anticlockwise ? 0 : 1;
    const parts = sweep > Math.PI ? 2 : 1;
    for (let i = 1; i <= parts; i++) {
      const a = a0 + dirSign * (sweep * i) / parts;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      this.d.push(`A${this.f(r)} ${this.f(r)} 0 0 ${sweepFlag} ${this.f(x)} ${this.f(y)}`);
    }
  }

  closePath() {
    this.d.push('Z');
  }

  toString() {
    return this.d.join(' ');
  }
}

/** Distance (grid units) from a point to a piece's centre line; for hit testing only. */
export function distanceToPiece(g: Graph, pc: Piece, q: { x: number; y: number }): number {
  const a = g.vertices[pc.from].f, b = g.vertices[pc.to].f;
  if (pc.geom.kind === 'line') {
    const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / l2));
    return Math.hypot(a.x + t * vx - q.x, a.y + t * vy - q.y);
  }
  const { c, r2 } = pc.geom, r = Math.sqrt(Number(r2));
  const ang = (p: { x: number; y: number }) => Math.atan2(p.y - c.y, p.x - c.x);
  const mod = (x: number) => ((x % TAU) + TAU) % TAU;
  const span = pc.from === pc.to ? TAU : mod(ang(b) - ang(a));
  if (mod(ang(q) - ang(a)) <= span) return Math.abs(Math.hypot(q.x - c.x, q.y - c.y) - r);
  return Math.min(Math.hypot(q.x - a.x, q.y - a.y), Math.hypot(q.x - b.x, q.y - b.y));
}
