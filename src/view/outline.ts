// "Outline" rendering: every stroke turned into its filled outline, then everything united.
// Seams at junctions disappear and the result is pure filled shapes (best for icon delivery).
// The outline of each stroke is built here exactly as Canvas/SVG would stroke it (segment bands,
// cap shapes, join wedges with miter limit); clipper-lib only does the final union.
// This is render-layer work, so arcs are flattened to fine polylines; the exact layer is untouched.
import ClipperLib, { type Path, type Paths } from 'clipper-lib';
import type { Graph } from '../exact/graph';
import type { Curve, Style } from '../model/types';
import { buildStrokes, traceCycle, tracePiece, type Mapper, type PathSink, type Stroke } from './paint';

/** Clipper works on integers: 1 grid unit = SCALE units. */
const SCALE = 1000;
/** Largest allowed distance between an arc and its polyline, in grid units. */
const FLAT_TOL = 0.002;

type P = { x: number; y: number };

/** Collects path commands as polylines (arcs flattened); remembers which points are real corners. */
class Flattener implements PathSink {
  paths: { pts: P[]; corner: boolean[]; closed: boolean }[] = [];
  private cur: { pts: P[]; corner: boolean[]; closed: boolean } | null = null;

  moveTo(x: number, y: number) {
    this.cur = { pts: [{ x, y }], corner: [true], closed: false };
    this.paths.push(this.cur);
  }

  private push(x: number, y: number, corner: boolean) {
    const c = this.cur!;
    // the point where one piece ends and the next starts is a real corner (gets the join style)
    if (c.pts.length) c.corner[c.pts.length - 1] = true;
    c.pts.push({ x, y });
    c.corner.push(corner);
  }

  lineTo(x: number, y: number) {
    this.push(x, y, true);
  }

  arc(cx: number, cy: number, r: number, a0: number, a1: number, anticlockwise: boolean) {
    const TAU = Math.PI * 2;
    let sweep = anticlockwise ? a0 - a1 : a1 - a0;
    if (Math.abs(sweep) < TAU - 1e-12) sweep = ((sweep % TAU) + TAU) % TAU;
    const step = 2 * Math.acos(Math.max(-1, 1 - FLAT_TOL / Math.max(r, FLAT_TOL)));
    const n = Math.max(1, Math.ceil(sweep / step));
    const dir = anticlockwise ? -1 : 1;
    const c = this.cur!;
    if (c.pts.length) c.corner[c.pts.length - 1] = true;
    for (let i = 1; i <= n; i++) {
      const a = a0 + dir * (sweep * i) / n;
      c.pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      c.corner.push(i === n); // points inside the arc are not corners
    }
  }

  closePath() {
    if (this.cur) this.cur.closed = true;
  }
}

const UNIT: Mapper = { s: 1, ox: 0, oy: 0 };
const ip = (x: number, y: number) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) });

function disk(c: P, r: number): Path {
  const n = Math.max(12, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - FLAT_TOL / Math.max(r, FLAT_TOL)))));
  return Array.from({ length: n }, (_, i) => ip(c.x + r * Math.cos((i / n) * Math.PI * 2), c.y + r * Math.sin((i / n) * Math.PI * 2)));
}

/** The filled shapes making up one stroked polyline. */
function strokePolys(pts: P[], corner: boolean[], closed: boolean, st: Style, out: Paths) {
  // drop repeated points
  const q: P[] = [], qc: boolean[] = [];
  pts.forEach((p, i) => {
    if (!q.length || Math.hypot(p.x - q[q.length - 1].x, p.y - q[q.length - 1].y) > 1e-9) {
      q.push(p);
      qc.push(corner[i]);
    } else qc[qc.length - 1] ||= corner[i];
  });
  if (closed && q.length > 1 && Math.hypot(q[0].x - q[q.length - 1].x, q[0].y - q[q.length - 1].y) < 1e-9) {
    q.pop();
    qc[0] = true;
  }
  const hw = st.width / 2, n = q.length;
  if (n < 2) return;
  const segs = closed ? n : n - 1;
  const dirs: P[] = [];
  for (let i = 0; i < segs; i++) {
    const a = q[i], b = q[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y);
    const d = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
    dirs.push(d);
    const nx = -d.y * hw, ny = d.x * hw;
    out.push([ip(a.x + nx, a.y + ny), ip(b.x + nx, b.y + ny), ip(b.x - nx, b.y - ny), ip(a.x - nx, a.y - ny)]);
  }
  // joins at interior points (all points of a closed path)
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
    const d0 = dirs[(i - 1 + segs) % segs], d1 = dirs[i % segs], v = q[i];
    const cross = d0.x * d1.y - d0.y * d1.x, dot = d0.x * d1.x + d0.y * d1.y;
    if (Math.abs(cross) < 1e-12 && dot > 0) continue; // straight on
    if (st.join === 'round' && qc[i]) {
      out.push(disk(v, hw));
      continue;
    }
    // the outer side is opposite to the turn
    const side = cross > 0 ? -1 : 1;
    const o0 = { x: v.x - d0.y * hw * side, y: v.y + d0.x * hw * side };
    const o1 = { x: v.x - d1.y * hw * side, y: v.y + d1.x * hw * side };
    const theta = Math.acos(Math.max(-1, Math.min(1, dot))); // turning angle
    const ratio = 1 / Math.cos(theta / 2); // miter length / stroke width
    // points inside a flattened arc always meet flush (tiny miter); real corners follow the style
    const miter = !qc[i] || (st.join === 'miter' && ratio <= st.miterLimit);
    if (miter && theta < Math.PI - 1e-9) {
      const m = { x: (d0.x - d1.x), y: (d0.y - d1.y) };
      const ml = Math.hypot(m.x, m.y) || 1, reach = hw * ratio;
      const tip = { x: v.x + (m.x / ml) * reach, y: v.y + (m.y / ml) * reach };
      out.push([ip(v.x, v.y), ip(o0.x, o0.y), ip(tip.x, tip.y), ip(o1.x, o1.y)]);
    } else {
      out.push([ip(v.x, v.y), ip(o0.x, o0.y), ip(o1.x, o1.y)]); // bevel
    }
  }
  if (closed) return;
  // caps at the two free ends
  for (const [p, d] of [[q[0], { x: -dirs[0].x, y: -dirs[0].y }], [q[n - 1], dirs[segs - 1]]] as [P, P][]) {
    if (st.cap === 'round') out.push(disk(p, hw));
    else if (st.cap === 'square') {
      const nx = -d.y * hw, ny = d.x * hw, ex = p.x + d.x * hw, ey = p.y + d.y * hw;
      out.push([ip(p.x + nx, p.y + ny), ip(ex + nx, ey + ny), ip(ex - nx, ey - ny), ip(p.x - nx, p.y - ny)]);
    }
  }
}

function strokeOutline(g: Graph, st: Stroke, out: Paths) {
  const f = new Flattener();
  // the same tracer as the stroked version, so outlines follow exactly the same path
  st.steps.forEach((s, i) => tracePiece(f, g, g.pieces[s.piece], s.reversed, UNIT, i === 0));
  if (st.closed) f.closePath();
  for (const p of f.paths) strokePolys(p.pts, p.corner, p.closed, st.style, out);
}

/** Union of all visible strokes as outlines (integer paths, 1 grid unit = SCALE). */
export function outlineUnion(curves: Curve[], g: Graph): Paths {
  const parts: Paths = [];
  for (const st of buildStrokes(curves, g)) strokeOutline(g, st, parts);
  if (!parts.length) return [];
  // every part is a convex polygon; orient them all the same way so non-zero union is exact
  for (const p of parts) if (ClipperLib.Clipper.Area(p) < 0) p.reverse();
  const c = new ClipperLib.Clipper(), sol: Paths = [];
  c.AddPaths(parts, ClipperLib.PolyType.ptSubject, true);
  c.Execute(ClipperLib.ClipType.ctUnion, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return sol;
}

/** Draw Clipper paths (grid units × SCALE) into a canvas or SVG path, through mapper m. */
export function traceOutline(sink: PathSink, paths: Paths, m: Mapper) {
  for (const path of paths) {
    path.forEach((pt, i) => {
      const x = m.ox + (pt.X / SCALE) * m.s, y = m.oy + (pt.Y / SCALE) * m.s;
      if (i === 0) sink.moveTo(x, y);
      else sink.lineTo(x, y);
    });
    sink.closePath();
  }
}

/** Bounds (grid units) of everything that is drawn: stroke outlines and filled faces. */
export function contentBounds(curves: Curve[], g: Graph, faces: Iterable<number>): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const take = (x: number, y: number) => {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  };
  for (const path of outlineUnion(curves, g)) for (const p of path) take(p.X / SCALE, p.Y / SCALE);
  for (const face of faces) {
    const f = new Flattener();
    traceCycle(f, g, face, UNIT);
    for (const p of f.paths) for (const q of p.pts) take(q.x, q.y);
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}
