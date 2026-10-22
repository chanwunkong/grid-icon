import { Q, isqrt } from './rational';
import { Quad } from './quad';
import { angleCmp, dotSign, ptCmp, ptEq, sameDirection, strictlyBetween, toFloat, vsub, xint, xrat, type XPt } from './point';
import { intersect, toXCurve, type XCircle, type XCurve } from './intersect';
import type { Curve, Pt } from '../model/types';

// ------------------------------------------------------------------ serialised exact values

export interface XPtJSON {
  x: string;
  y: string;
}

export const ptToJSON = (p: XPt): XPtJSON => ({ x: p.x.toJSON(), y: p.y.toJSON() });
export const ptFromJSON = (j: XPtJSON): XPt => ({ x: Quad.parse(j.x), y: Quad.parse(j.y) });

/** A deleted piece: the part of a curve between two exact points (lines in a→b order, circles counter-clockwise). */
export interface Erased {
  curve: string;
  a: XPtJSON;
  b: XPtJSON;
}

/** A rational point (fill representative points). */
export interface RPt {
  x: Q;
  y: Q;
}

// ------------------------------------------------------------------ structure

export interface Vertex {
  id: number;
  p: XPt;
  f: { x: number; y: number };
  out: number[]; // outgoing half-edges sorted by angle, then curvature
}

interface LineGeom {
  kind: 'line';
  a: Pt;
  dir: { x: bigint; y: bigint }; // integer direction from edge.from to edge.to
}
interface CircleGeom {
  kind: 'circle';
  c: Pt;
  r2: bigint;
}

/** A piece of one curve between two consecutive vertices on it. */
export interface Piece {
  index: number;
  curve: string;
  guide: boolean;
  geom: LineGeom | CircleGeom; // circles: from → to counter-clockwise
  from: number;
  to: number;
  erased: boolean;
  edge: number; // −1 when erased
  forward: boolean; // piece runs along its edge (from → to) rather than against it
}

export interface Edge {
  id: number;
  geom: LineGeom | CircleGeom;
  from: number;
  to: number;
  pieces: number[]; // overlapping pieces of different curves share one edge
}

export interface Half {
  id: number;
  edge: number;
  origin: number;
  target: number;
  forward: boolean;
  twin: number;
  next: number;
  cycle: number;
  tangent: XPt;
  turn: -1 | 0 | 1; // +1 turns towards +y (counter-clockwise), −1 the other way, 0 straight
  r2: bigint;
}

export interface Cycle {
  id: number;
  halves: number[];
  // float bounding box of the cycle, padded: points outside it have winding number 0 (a safe prefilter)
  box: { x0: number; y0: number; x1: number; y1: number };
  outer: boolean; // the outside boundary of a connected component (not a face)
  component: number;
}

export interface Component {
  id: number;
  cycles: number[];
  outer: number;
  parent: number | null; // the bounded cycle (face) this component sits inside
  sample: RPt;
}

const big = (n: number) => BigInt(n);
const ZERO_Q = Q.ZERO;

// ------------------------------------------------------------------ rational helpers

/** A rational approximation of q within 2^-k (exact arithmetic, no floats). */
function approx(q: Quad, k: number): Q {
  if (q.isRational) return q.a;
  const scale = 1n << big(k);
  const root = new Q(isqrt(q.d * scale * scale), scale);
  return q.a.add(q.b.mul(root));
}

/** A rational strictly between lo and hi (lo < hi). */
export function ratBetween(lo: Quad, hi: Quad): Q {
  for (let k = 8; ; k += 8) {
    const m = approx(lo, k).add(approx(hi, k)).mul(new Q(1n, 2n));
    const qm = Quad.rat(m);
    if (lo.cmp(qm) < 0 && qm.cmp(hi) < 0) return m;
    if (k > 4000) throw new Error('ratBetween did not converge');
  }
}

/** A dyadic rational close to a float. */
const dyadic = (v: number, bits = 20) => new Q(BigInt(Math.round(v * 2 ** bits)), 1n << big(bits));

// ------------------------------------------------------------------ build

export class Graph {
  vertices: Vertex[] = [];
  pieces: Piece[] = [];
  edges: Edge[] = [];
  halves: Half[] = [];
  cycles: Cycle[] = [];
  components: Component[] = [];
  private xcurves: XCurve[];

  constructor(curves: Curve[], erased: Erased[] = []) {
    this.xcurves = curves.map(toXCurve);
    this.buildVertices();
    this.buildPieces(curves, erased.map((e) => ({ curve: e.curve, a: ptFromJSON(e.a), b: ptFromJSON(e.b) })));
    this.buildEdges();
    this.buildHalves();
    this.buildCycles();
    this.buildComponents();
  }

  private curvePoints: number[][] = []; // vertex ids on each curve, in order along it

  private buildVertices() {
    const xs = this.xcurves;
    const perCurve: XPt[][] = xs.map((c) => (c.kind === 'line' ? [xint(c.a.x, c.a.y), xint(c.b.x, c.b.y)] : [xint(c.p.x, c.p.y)]));
    for (let i = 0; i < xs.length; i++)
      for (let j = i + 1; j < xs.length; j++)
        for (const p of intersect(xs[i], xs[j])) {
          perCurve[i].push(p);
          perCurve[j].push(p);
        }
    // merge exactly equal points into vertices: sort everything, equal points become neighbours
    const all: { p: XPt; curve: number; slot: number }[] = [];
    perCurve.forEach((pts, curve) => pts.forEach((p, slot) => all.push({ p, curve, slot })));
    all.sort((a, b) => ptCmp(a.p, b.p));
    const ids: number[][] = perCurve.map((pts) => pts.map(() => -1));
    for (let i = 0; i < all.length; i++) {
      if (i === 0 || ptCmp(all[i].p, all[i - 1].p) !== 0)
        this.vertices.push({ id: this.vertices.length, p: all[i].p, f: toFloat(all[i].p), out: [] });
      ids[all[i].curve][all[i].slot] = this.vertices.length - 1;
    }
    // order the vertices along each curve
    this.curvePoints = xs.map((c, i) => {
      const uniq = [...new Set(ids[i])];
      if (c.kind === 'line') {
        const v = xint(c.b.x - c.a.x, c.b.y - c.a.y), a = xint(c.a.x, c.a.y);
        const key = (id: number) => {
          const d = vsub(this.vertices[id].p, a);
          return d.x.mul(v.x).add(d.y.mul(v.y));
        };
        return uniq.sort((m, n) => key(m).cmp(key(n)));
      }
      const ctr = xint(c.c.x, c.c.y);
      return uniq.sort((m, n) => angleCmp(vsub(this.vertices[m].p, ctr), vsub(this.vertices[n].p, ctr)));
    });
  }

  private buildPieces(curves: Curve[], erased: { curve: string; a: XPt; b: XPt }[]) {
    this.xcurves.forEach((c, i) => {
      const ids = this.curvePoints[i];
      const pairs: [number, number][] = c.kind === 'line'
        ? ids.slice(1).map((id, k) => [ids[k], id])
        : ids.map((id, k) => [id, ids[(k + 1) % ids.length]]);
      for (const [from, to] of pairs) {
        const geom: LineGeom | CircleGeom = c.kind === 'line'
          ? { kind: 'line', a: c.a, dir: { x: big(c.b.x - c.a.x), y: big(c.b.y - c.a.y) } }
          : { kind: 'circle', c: c.c, r2: c.r2 };
        const gone = erased.some((e) => e.curve === c.id && ptEq(e.a, this.vertices[from].p) && ptEq(e.b, this.vertices[to].p));
        this.pieces.push({ index: this.pieces.length, curve: c.id, guide: curves[i].guide, geom, from, to, erased: gone, edge: -1, forward: true });
      }
    });
  }

  private buildEdges() {
    const byKey = new Map<string, number>();
    for (const pc of this.pieces) {
      if (pc.erased) continue;
      let key: string, from = pc.from, to = pc.to, geom = pc.geom;
      if (geom.kind === 'line') {
        // the same straight segment may come from lines drawn in opposite directions
        if (from > to) {
          [from, to] = [to, from];
          geom = { ...geom, dir: { x: -geom.dir.x, y: -geom.dir.y } };
        }
        key = `L${from}:${to}`;
      } else {
        key = `C${geom.c.x},${geom.c.y},${geom.r2}:${from}:${to}`;
      }
      let id = byKey.get(key);
      if (id === undefined) {
        id = this.edges.length;
        byKey.set(key, id);
        this.edges.push({ id, geom, from, to, pieces: [] });
      }
      this.edges[id].pieces.push(pc.index);
      pc.edge = id;
      pc.forward = this.edges[id].from === pc.from;
    }
  }

  private buildHalves() {
    for (const e of this.edges) {
      for (const forward of [true, false]) {
        const origin = forward ? e.from : e.to, target = forward ? e.to : e.from;
        let tangent: XPt, turn: -1 | 0 | 1 = 0, r2 = 0n;
        if (e.geom.kind === 'line') {
          const s = forward ? 1n : -1n;
          tangent = xint(Number(e.geom.dir.x * s), Number(e.geom.dir.y * s));
        } else {
          const w = vsub(this.vertices[origin].p, xint(e.geom.c.x, e.geom.c.y));
          // counter-clockwise along the circle: the radius turned a quarter towards +y
          tangent = forward ? { x: w.y.neg(), y: w.x } : { x: w.y, y: w.x.neg() };
          turn = forward ? 1 : -1;
          r2 = e.geom.r2;
        }
        const id = this.halves.length;
        this.halves.push({ id, edge: e.id, origin, target, forward, twin: forward ? id + 1 : id - 1, next: -1, cycle: -1, tangent, turn, r2 });
        this.vertices[origin].out.push(id);
      }
    }
    // around each vertex: by direction, and for equal directions by curvature (right turn first)
    const curv = (a: Half, b: Half): number => {
      if (a.turn !== b.turn) return a.turn - b.turn;
      if (a.turn === 0 || a.r2 === b.r2) return 0;
      const tighter = a.r2 < b.r2 ? -1 : 1; // smaller radius bends more
      return a.turn > 0 ? -tighter : tighter;
    };
    for (const v of this.vertices)
      v.out.sort((i, j) => angleCmp(this.halves[i].tangent, this.halves[j].tangent) || curv(this.halves[i], this.halves[j]));
    // the next half-edge around a face: at the target, the one just before the twin (clockwise neighbour)
    for (const h of this.halves) {
      const out = this.vertices[h.target].out;
      const k = out.indexOf(h.twin);
      h.next = out[(k - 1 + out.length) % out.length];
    }
  }

  private buildCycles() {
    for (const h of this.halves) {
      if (h.cycle !== -1) continue;
      const c: Cycle = { id: this.cycles.length, halves: [], outer: false, component: -1, box: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity } };
      let cur = h.id;
      while (this.halves[cur].cycle === -1) {
        this.halves[cur].cycle = c.id;
        c.halves.push(cur);
        cur = this.halves[cur].next;
      }
      for (const hid of c.halves) {
        const hh = this.halves[hid], e = this.edges[hh.edge];
        const grow = (x0: number, y0: number, x1: number, y1: number) => {
          c.box.x0 = Math.min(c.box.x0, x0); c.box.y0 = Math.min(c.box.y0, y0);
          c.box.x1 = Math.max(c.box.x1, x1); c.box.y1 = Math.max(c.box.y1, y1);
        };
        const v = this.vertices[hh.origin].f, t = this.vertices[hh.target].f;
        grow(v.x, v.y, v.x, v.y);
        grow(t.x, t.y, t.x, t.y);
        if (e.geom.kind === 'circle') {
          // the arc's own box: its ends plus the circle's extreme points that the arc passes
          const { c } = e.geom, r = Math.sqrt(Number(e.geom.r2));
          const from = this.vertices[e.from].f, to = this.vertices[e.to].f;
          const a0 = Math.atan2(from.y - c.y, from.x - c.x);
          let span = Math.atan2(to.y - c.y, to.x - c.x) - a0;
          if (e.from === e.to) span = Math.PI * 2;
          else span = ((span % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          for (let k = 0; k < 4; k++) {
            const ang = (k * Math.PI) / 2;
            const off = (((ang - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            // a small angular margin keeps the box safe against rounding near an extreme point
            if (off <= span + 1e-6 || off >= 2 * Math.PI - 1e-6) grow(c.x + r * Math.cos(ang), c.y + r * Math.sin(ang), c.x + r * Math.cos(ang), c.y + r * Math.sin(ang));
          }
        }
      }
      const pad = 1e-4 * (1 + Math.max(Math.abs(c.box.x0), Math.abs(c.box.x1), Math.abs(c.box.y0), Math.abs(c.box.y1)));
      c.box = { x0: c.box.x0 - pad, y0: c.box.y0 - pad, x1: c.box.x1 + pad, y1: c.box.y1 + pad };
      this.cycles.push(c);
    }
  }

  private buildComponents() {
    // union-find over vertices joined by edges
    const parent = this.vertices.map((v) => v.id);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    for (const e of this.edges) parent[find(e.from)] = find(e.to);
    const compOf = new Map<number, number>();
    for (const c of this.cycles) {
      const root = find(this.halves[c.halves[0]].origin);
      if (!compOf.has(root)) {
        compOf.set(root, this.components.length);
        this.components.push({ id: this.components.length, cycles: [], outer: -1, parent: null, sample: { x: ZERO_Q, y: ZERO_Q } });
      }
      c.component = compOf.get(root)!;
      this.components[c.component].cycles.push(c.id);
    }
    for (const comp of this.components) {
      comp.outer = this.findOuter(comp);
      this.cycles[comp.outer].outer = true;
      comp.sample = this.samplePoint(comp);
    }
    for (const comp of this.components) {
      const around = this.cycles.filter((c) => !c.outer && c.component !== comp.id && this.windingAny(comp.sample, c.id) === 1);
      comp.parent = this.innermost(around.map((c) => c.id));
    }
  }

  /**
   * The outer boundary of a component passes its leftmost point. That point is either a vertex,
   * or the leftmost point of a circle arc. Left of it lies the outside, which tells which
   * half-edge (and so which cycle) faces outwards.
   */
  private findOuter(comp: Component): number {
    const edgeIds = new Set<number>();
    for (const cid of comp.cycles) for (const h of this.cycles[cid].halves) edgeIds.add(this.halves[h].edge);
    const left = xint(-1, 0);
    let bestX: Quad | null = null, pick: (() => number) | null = null;
    const consider = (x: Quad, how: () => number) => {
      if (bestX === null || x.cmp(bestX) < 0) {
        bestX = x;
        pick = how;
      }
    };
    for (const eid of edgeIds) {
      const e = this.edges[eid];
      for (const vid of [e.from, e.to]) {
        const v = this.vertices[vid];
        consider(v.p.x, () => {
          const out = v.out;
          if (out.length === 1) return this.halves[out[0]].cycle;
          for (let i = 0; i < out.length; i++) {
            const a = this.halves[out[i]].tangent, b = this.halves[out[(i + 1) % out.length]].tangent;
            if (sameDirection(a, b)) continue; // an empty sector between curves leaving the same way
            if (strictlyBetween(a, left, b)) return this.halves[out[i]].cycle; // the face left of out[i]
          }
          return this.halves[out[0]].cycle;
        });
      }
      if (e.geom.kind === 'circle') {
        const ctr = xint(e.geom.c.x, e.geom.c.y);
        const s = vsub(this.vertices[e.from].p, ctr), t = vsub(this.vertices[e.to].p, ctr);
        if (strictlyBetween(s, left, t)) {
          // the arc's leftmost point; going clockwise (the backward half) the outside is on the left
          const x = new Quad(Q.of(e.geom.c.x), Q.of(-1), e.geom.r2);
          consider(x, () => this.halves[this.edgeHalf(eid, false)].cycle);
        }
      }
    }
    return (pick as unknown as () => number)();
  }

  private edgeHalf(edge: number, forward: boolean) {
    return forward ? edge * 2 : edge * 2 + 1;
  }

  /** A rational point on one of the component's edges (not a vertex). */
  private samplePoint(comp: Component): RPt {
    const eid = this.halves[this.cycles[comp.cycles[0]].halves[0]].edge;
    return this.pointOnEdge(eid);
  }

  private pointOnEdge(eid: number): RPt {
    const e = this.edges[eid], P = this.vertices[e.from].p, R = this.vertices[e.to].p;
    if (e.geom.kind === 'line') {
      const { a, dir } = e.geom, A = xint(a.x, a.y), v = xint(Number(dir.x), Number(dir.y));
      const proj = (p: XPt) => { const d = vsub(p, A); return d.x.mul(v.x).add(d.y.mul(v.y)); };
      const s = ratBetween(proj(P), proj(R)), n2 = new Q(dir.x * dir.x + dir.y * dir.y);
      return { x: Q.of(a.x).add(s.mul(new Q(dir.x)).div(n2)), y: Q.of(a.y).add(s.mul(new Q(dir.y)).div(n2)) };
    }
    // rational points on the circle: from a known rational point on it, every rational slope
    // gives a second rational intersection. Aim at the middle of the arc, then check exactly.
    const { c, r2 } = e.geom, ctr = xint(c.x, c.y);
    const owner = this.xcurves.find((x): x is XCircle => x.kind === 'circle' && x.c.x === c.x && x.c.y === c.y && x.r2 === r2)!;
    const p0 = owner.p, r = Math.sqrt(Number(r2));
    const a0 = Math.atan2(this.vertices[e.from].f.y - c.y, this.vertices[e.from].f.x - c.x);
    let a1 = Math.atan2(this.vertices[e.to].f.y - c.y, this.vertices[e.to].f.x - c.x);
    if (a1 <= a0) a1 += Math.PI * 2;
    const s = vsub(P, ctr), t = vsub(R, ctr);
    for (let bits = 12; bits < 200; bits += 8)
      for (const frac of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const ang = a0 + (a1 - a0) * frac, tx = c.x + r * Math.cos(ang), ty = c.y + r * Math.sin(ang);
        const q = this.circlePointToward(c, p0, tx, ty, bits);
        if (q && strictlyBetween(s, xrat(q.x.sub(Q.of(c.x)), q.y.sub(Q.of(c.y))), t)) return q;
      }
    throw new Error('no rational point found on arc');
  }

  /** The second intersection of the circle with the line from grid point p0 towards (tx, ty) (rational slope). */
  private circlePointToward(c: Pt, p0: Pt, tx: number, ty: number, bits: number): RPt | null {
    const dx = tx - p0.x, dy = ty - p0.y;
    if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return null;
    // direction (1, m) or (m, 1), whichever is better conditioned
    const ux = Math.abs(dx) >= Math.abs(dy) ? Q.ONE : dyadic(dx / dy, bits);
    const uy = Math.abs(dx) >= Math.abs(dy) ? dyadic(dy / dx, bits) : Q.ONE;
    const fx = Q.of(p0.x - c.x), fy = Q.of(p0.y - c.y);
    const uu = ux.mul(ux).add(uy.mul(uy));
    const t = new Q(-2n).mul(fx.mul(ux).add(fy.mul(uy))).div(uu);
    if (t.isZero()) return null;
    return { x: Q.of(p0.x).add(t.mul(ux)), y: Q.of(p0.y).add(t.mul(uy)) };
  }

  // ------------------------------------------------------------------ point location

  /**
   * Winding number of a cycle around rational point q, counting signed crossings of the ray
   * q + t·dir (t > 0). Returns null when the ray is degenerate for this cycle (through a vertex,
   * tangent to an arc, along a segment) or q lies on the cycle.
   */
  winding(q: RPt, cycleId: number, dir: { x: bigint; y: bigint }): number | null {
    const Qd = { x: new Q(dir.x), y: new Q(dir.y) }, qq = xrat(q.x, q.y), D = xint(Number(dir.x), Number(dir.y));
    let w = 0;
    for (const hid of this.cycles[cycleId].halves) {
      const h = this.halves[hid], e = this.edges[h.edge];
      const P = this.vertices[h.origin].p, R = this.vertices[h.target].p;
      if (e.geom.kind === 'line') {
        const { a, dir: v } = e.geom, V = xint(Number(v.x), Number(v.y));
        const den = dir.x * v.y - dir.y * v.x; // cross(dir, v)
        const wq = { x: Q.of(a.x).sub(q.x), y: Q.of(a.y).sub(q.y) }; // a − q
        const proj = (p: XPt) => { const d = vsub(p, xint(a.x, a.y)); return d.x.mul(V.x).add(d.y.mul(V.y)); };
        const lo = proj(P), hi = proj(R), [mn, mx] = lo.cmp(hi) < 0 ? [lo, hi] : [hi, lo];
        if (den === 0n) {
          // ray parallel to the segment: degenerate only if it runs along the segment
          if (!wq.x.mul(Qd.y).sub(wq.y.mul(Qd.x)).isZero()) continue;
          const tq = Quad.rat(q.x.sub(Q.of(a.x)).mul(new Q(v.x)).add(q.y.sub(Q.of(a.y)).mul(new Q(v.y))));
          const forwardRay = dir.x * v.x + dir.y * v.y > 0n;
          if (forwardRay ? mx.cmp(tq) >= 0 : mn.cmp(tq) <= 0) return null;
          continue;
        }
        // q + t·dir = a + s·v  →  t = cross(a − q, v) / cross(dir, v),  s = cross(a − q, dir) / cross(dir, v)
        const t = wq.x.mul(new Q(v.y)).sub(wq.y.mul(new Q(v.x))).div(new Q(den));
        if (t.sign() < 0) continue;
        const sv = wq.x.mul(Qd.y).sub(wq.y.mul(Qd.x)).div(new Q(den));
        const pr = Quad.rat(sv.mul(new Q(v.x * v.x + v.y * v.y))); // projection of the crossing onto v
        const inLo = pr.cmp(mn), inHi = pr.cmp(mx);
        if (inLo < 0 || inHi > 0) continue;
        if (t.isZero() || inLo === 0 || inHi === 0) return null; // q on the segment, or the ray hits a vertex
        // the crossing counts +1 when the edge passes the ray turning towards +y: sign of cross(dir, travel)
        const sgn = h.forward ? 1n : -1n, T = { x: v.x * sgn, y: v.y * sgn };
        w += dir.x * T.y - dir.y * T.x > 0n ? 1 : -1;
        continue;
      }
      const { c, r2 } = e.geom, ctr = xint(c.x, c.y);
      const fx = q.x.sub(Q.of(c.x)), fy = q.y.sub(Q.of(c.y));
      const A = Qd.x.mul(Qd.x).add(Qd.y.mul(Qd.y));
      const Bq = new Q(2n).mul(Qd.x.mul(fx).add(Qd.y.mul(fy)));
      const Cq = fx.mul(fx).add(fy.mul(fy)).sub(new Q(r2));
      const disc = Bq.mul(Bq).sub(new Q(4n).mul(A).mul(Cq));
      if (disc.sign() < 0) continue;
      const p = Bq.neg().div(new Q(2n).mul(A)), qq2 = Q.ONE.div(new Q(2n).mul(A));
      const roots = disc.isZero() ? [Quad.rat(p)] : [Quad.withSqrt(p, qq2.neg(), disc), Quad.withSqrt(p, qq2, disc)];
      // the arc of this half-edge, counter-clockwise from s to t
      const s0 = vsub(h.forward ? P : R, ctr), t0 = vsub(h.forward ? R : P, ctr);
      for (const t of roots) {
        const ts = t.sign();
        if (ts < 0) continue;
        const X = { x: qq.x.add(t.mul(D.x)), y: qq.y.add(t.mul(D.y)) };
        const wv = vsub(X, ctr);
        const atEnd = ptEq(X, P) || ptEq(X, R);
        const inside = atEnd || strictlyBetween(s0, wv, t0);
        if (!inside) continue;
        if (ts === 0 || atEnd || disc.isZero()) return null; // q on the arc, through a vertex, or tangent
        // tangent of the counter-clockwise arc at X is (−w.y, w.x); cross(dir, it) = dot(dir, w)
        const sgn = dotSign(D, wv);
        w += h.forward ? sgn : -sgn;
      }
    }
    return w;
  }

  private static readonly DIRS: { x: bigint; y: bigint }[] =
    [[1, 0], [0, 1], [1, 1], [1, -1], [2, 1], [1, 2], [2, -1], [1, -2], [3, 1], [1, 3], [3, -2], [-2, 3], [5, 2], [2, 5]]
      .map(([x, y]) => ({ x: big(x), y: big(y) }));

  /** Winding number with the first non-degenerate ray; null if q is on the cycle. */
  windingAny(q: RPt, cycleId: number): number | null {
    // outside the (padded) bounding box the winding number is 0: skip the exact work
    const b = this.cycles[cycleId].box, fx = q.x.toNumber(), fy = q.y.toNumber();
    if (fx < b.x0 || fx > b.x1 || fy < b.y0 || fy > b.y1) return 0;
    for (const d of Graph.DIRS) {
      const w = this.winding(q, cycleId, d);
      if (w !== null) return w;
    }
    return null;
  }

  /** Of several faces that all contain some point, the one nested deepest. */
  private innermost(cands: number[]): number | null {
    if (!cands.length) return null;
    let best = cands[0];
    for (const c of cands.slice(1)) {
      const cc = this.cycles[c], cb = this.cycles[best];
      if (cc.component === cb.component) continue;
      // c is inside best if c's component sits inside best's region
      if (this.windingAny(this.components[cc.component].sample, best) === 1) best = c;
    }
    return best;
  }

  /** The face (bounded cycle) containing rational point q, or null (outside, or on a line). */
  locate(q: RPt): number | null {
    const inside: number[] = [];
    for (const c of this.cycles) {
      if (c.outer) continue;
      const w = this.windingAny(q, c.id);
      if (w === null) return null;
      if (w === 1) inside.push(c.id);
    }
    return this.innermost(inside);
  }

  /** Holes of a face: outer boundaries of components sitting directly inside it. */
  holes(face: number): number[] {
    return this.components.filter((c) => c.parent === face).map((c) => c.outer);
  }

  get faces(): number[] {
    return this.cycles.filter((c) => !c.outer).map((c) => c.id);
  }
}

