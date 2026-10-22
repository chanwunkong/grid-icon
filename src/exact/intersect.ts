import { Q } from './rational';
import { Quad } from './quad';
import { ptCmp, type XPt, xint, xrat } from './point';
import type { Curve, Pt } from '../model/types';

/** Curves in integer form for exact work: lines through two grid points, circles with integer r². */
export type XLine = { kind: 'line'; id: string; a: Pt; b: Pt };
export type XCircle = { kind: 'circle'; id: string; c: Pt; r2: bigint; p: Pt };
export type XCurve = XLine | XCircle;

export function toXCurve(c: Curve): XCurve {
  if (c.kind === 'line') return { kind: 'line', id: c.id, a: c.a, b: c.b };
  const r2 = BigInt((c.p.x - c.c.x) ** 2 + (c.p.y - c.c.y) ** 2);
  return { kind: 'circle', id: c.id, c: c.c, r2, p: c.p };
}

const B = (n: number) => BigInt(n);
const inUnit = (t: Quad) => t.sign() >= 0 && t.cmp(Quad.ONE) <= 0;

/** Remove exact duplicates (e.g. a tangent point found twice). */
export function uniquePts(pts: XPt[]): XPt[] {
  const s = [...pts].sort(ptCmp);
  return s.filter((p, i) => i === 0 || ptCmp(p, s[i - 1]) !== 0);
}

/**
 * Intersections of two segments. Collinear overlapping segments return the end points of each
 * that lie on the other, so both get split there and the shared part becomes identical pieces.
 */
export function lineLine(l1: XLine, l2: XLine): XPt[] {
  const v1 = { x: B(l1.b.x - l1.a.x), y: B(l1.b.y - l1.a.y) };
  const v2 = { x: B(l2.b.x - l2.a.x), y: B(l2.b.y - l2.a.y) };
  const w = { x: B(l2.a.x - l1.a.x), y: B(l2.a.y - l1.a.y) };
  const den = v1.x * v2.y - v1.y * v2.x;
  if (den === 0n) {
    if (w.x * v1.y - w.y * v1.x !== 0n) return []; // parallel, apart
    const out: XPt[] = [];
    const onSeg = (p: Pt, l: XLine) => {
      const v = { x: B(l.b.x - l.a.x), y: B(l.b.y - l.a.y) };
      const t = B(p.x - l.a.x) * v.x + B(p.y - l.a.y) * v.y;
      return t >= 0n && t <= v.x * v.x + v.y * v.y;
    };
    for (const p of [l2.a, l2.b]) if (onSeg(p, l1)) out.push(xint(p.x, p.y));
    for (const p of [l1.a, l1.b]) if (onSeg(p, l2)) out.push(xint(p.x, p.y));
    return uniquePts(out);
  }
  const t1 = new Q(w.x * v2.y - w.y * v2.x, den);
  const t2 = new Q(w.x * v1.y - w.y * v1.x, den);
  if (t1.sign() < 0 || t1.cmp(Q.ONE) > 0 || t2.sign() < 0 || t2.cmp(Q.ONE) > 0) return [];
  return [xrat(Q.of(l1.a.x).add(t1.mul(new Q(v1.x))), Q.of(l1.a.y).add(t1.mul(new Q(v1.y))))];
}

/**
 * Roots t of A t² + B t + C = 0 as exact numbers (A ≠ 0). A zero discriminant gives one
 * (tangent) root; the ± roots share one radicand so they live in the same field.
 */
function quadraticRoots(A: Q, Bq: Q, C: Q): Quad[] {
  const disc = Bq.mul(Bq).sub(new Q(4n).mul(A).mul(C));
  const s = disc.sign();
  if (s < 0) return [];
  const twoA = new Q(2n).mul(A);
  const p = Bq.neg().div(twoA);
  if (s === 0) return [Quad.rat(p)];
  const q = Q.ONE.div(twoA);
  return [Quad.withSqrt(p, q.neg(), disc), Quad.withSqrt(p, q, disc)];
}

/** Point o + t·u for a rational base point o, integer direction u and exact t. */
function along(ox: Q, oy: Q, ux: bigint, uy: bigint, t: Quad): XPt {
  return { x: Quad.rat(ox).add(t.scale(new Q(ux))), y: Quad.rat(oy).add(t.scale(new Q(uy))) };
}

export function lineCircle(l: XLine, c: XCircle): XPt[] {
  const v = { x: B(l.b.x - l.a.x), y: B(l.b.y - l.a.y) };
  const f = { x: B(l.a.x - c.c.x), y: B(l.a.y - c.c.y) };
  const A = new Q(v.x * v.x + v.y * v.y);
  const Bq = new Q(2n * (f.x * v.x + f.y * v.y));
  const C = new Q(f.x * f.x + f.y * f.y - c.r2);
  return quadraticRoots(A, Bq, C).filter(inUnit).map((t) => along(Q.of(l.a.x), Q.of(l.a.y), v.x, v.y, t));
}

/**
 * Two circles. Subtracting their equations gives the radical line n·P = k; intersecting that line
 * with the first circle gives 0, 1 (tangent) or 2 points. Concentric circles never meet, except a
 * circle drawn twice: then each one's defining grid point is shared so both split the same way.
 */
export function circleCircle(c1: XCircle, c2: XCircle): XPt[] {
  const n = { x: B(c2.c.x - c1.c.x), y: B(c2.c.y - c1.c.y) };
  if (n.x === 0n && n.y === 0n) {
    if (c1.r2 !== c2.r2) return [];
    return uniquePts([xint(c1.p.x, c1.p.y), xint(c2.p.x, c2.p.y)]);
  }
  const sq = (p: Pt) => B(p.x) * B(p.x) + B(p.y) * B(p.y);
  const k = new Q(sq(c2.c) - sq(c1.c) + c1.r2 - c2.r2, 2n);
  const nn = new Q(n.x * n.x + n.y * n.y);
  // a point on the radical line, and the line's direction
  const ox = k.mul(new Q(n.x)).div(nn), oy = k.mul(new Q(n.y)).div(nn);
  const u = { x: -n.y, y: n.x };
  const fx = ox.sub(Q.of(c1.c.x)), fy = oy.sub(Q.of(c1.c.y));
  const A = new Q(u.x * u.x + u.y * u.y);
  const Bq = new Q(2n).mul(fx.mul(new Q(u.x)).add(fy.mul(new Q(u.y))));
  const C = fx.mul(fx).add(fy.mul(fy)).sub(new Q(c1.r2));
  return quadraticRoots(A, Bq, C).map((t) => along(ox, oy, u.x, u.y, t));
}

export function intersect(a: XCurve, b: XCurve): XPt[] {
  if (a.kind === 'line' && b.kind === 'line') return lineLine(a, b);
  if (a.kind === 'line' && b.kind === 'circle') return lineCircle(a, b);
  if (a.kind === 'circle' && b.kind === 'line') return lineCircle(b, a);
  return circleCircle(a as XCircle, b as XCircle);
}
