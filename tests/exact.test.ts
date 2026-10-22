import { describe, expect, it } from 'vitest';
import { Q, isqrt } from '../src/exact/rational';
import { Quad, sign2 } from '../src/exact/quad';
import { angleCmp, crossSign, ptEq, strictlyBetween, xint, type XPt } from '../src/exact/point';
import { circleCircle, intersect, lineCircle, lineLine, type XCircle, type XLine } from '../src/exact/intersect';

const L = (ax: number, ay: number, bx: number, by: number, id = 'l'): XLine => ({ kind: 'line', id, a: { x: ax, y: ay }, b: { x: bx, y: by } });
const C = (cx: number, cy: number, r2: number, px: number, py: number, id = 'c'): XCircle =>
  ({ kind: 'circle', id, c: { x: cx, y: cy }, r2: BigInt(r2), p: { x: px, y: py } });
const sqrt = (n: number) => new Quad(Q.ZERO, Q.ONE, BigInt(n));
const f = (p: XPt) => [p.x.toNumber(), p.y.toNumber()];

describe('rationals', () => {
  it('normalises sign and common factors', () => {
    expect(Q.of(6, -4).toString()).toBe('-3/2');
    expect(Q.of(1, 3).add(Q.of(1, 6)).eq(Q.of(1, 2))).toBe(true);
  });
  it('integer square root is exact for huge numbers', () => {
    const big = 123456789012345678901234567890n;
    const r = isqrt(big * big + 5n);
    expect(r).toBe(big);
    expect(isqrt(99n)).toBe(9n);
  });
});

describe('p + q√d numbers', () => {
  it('reduces perfect squares and square factors', () => {
    expect(sqrt(16).isRational).toBe(true);
    expect(sqrt(16).eq(Quad.int(4))).toBe(true);
    expect(sqrt(12).eq(new Quad(Q.ZERO, Q.of(2), 3n))).toBe(true); // √12 = 2√3
  });
  it('decides signs exactly when terms disagree', () => {
    // 1.4142 < √2 < 1.4143
    expect(new Quad(Q.of(-14142, 10000), Q.ONE, 2n).sign()).toBe(1);
    expect(new Quad(Q.of(-14143, 10000), Q.ONE, 2n).sign()).toBe(-1);
    // 3 − 2√2 > 0 (≈ 0.17), 3 − √9 = 0
    expect(new Quad(Q.of(3), Q.of(-2), 2n).sign()).toBe(1);
    expect(new Quad(Q.of(3), Q.of(-1), 9n).sign()).toBe(0);
  });
  it('compares numbers with different radicals', () => {
    expect(sqrt(2).cmp(sqrt(3))).toBe(-1);
    // 1 + √2 ≈ 2.414 vs 1/2 + √3 ≈ 2.232
    expect(new Quad(Q.ONE, Q.ONE, 2n).cmp(new Quad(Q.of(1, 2), Q.ONE, 3n))).toBe(1);
    // √8 and 2√2 are the same number written differently
    expect(new Quad(Q.ZERO, Q.ONE, 8n).cmp(new Quad(Q.ZERO, Q.of(2), 2n))).toBe(0);
    // 5 − √24 ≈ 0.10102 is just above 1/10 and just below 0.10103
    expect(new Quad(Q.of(5), Q.of(-1), 24n).cmp(Quad.rat(Q.of(1, 10)))).toBe(1);
    expect(new Quad(Q.of(5), Q.of(-1), 24n).cmp(Quad.rat(Q.of(10103, 100000)))).toBe(-1);
  });
  it('signs of sums with two different radicals', () => {
    // √2 + √3 − 3.146... : X = √2 − 3.1462, Y = 1, d2 = 3  →  √2 + √3 ≈ 3.14626
    expect(sign2(new Quad(Q.of(-31462, 10000), Q.ONE, 2n), Quad.ONE, 3n)).toBe(1);
    expect(sign2(new Quad(Q.of(-31463, 10000), Q.ONE, 2n), Quad.ONE, 3n)).toBe(-1);
    // √2 − √3 < 0
    expect(sign2(sqrt(2), Quad.int(-1), 3n)).toBe(-1);
    // 5√2 − √50 = 0
    expect(sign2(new Quad(Q.ZERO, Q.of(5), 2n), Quad.int(-1), 50n)).toBe(0);
  });
  it('round-trips through JSON text', () => {
    const v = new Quad(Q.of(-7, 3), Q.of(5, 2), 11n);
    expect(Quad.parse(v.toJSON()).eq(v)).toBe(true);
  });
});

describe('line × line', () => {
  it('crossing segments meet at a rational point', () => {
    const [p] = lineLine(L(0, 0, 4, 2), L(0, 2, 4, 0));
    expect(f(p)).toEqual([2, 1]);
    expect(p.x.isRational && p.y.isRational).toBe(true);
  });
  it('misses outside the segments and handles parallel lines', () => {
    expect(lineLine(L(0, 0, 1, 1), L(3, 0, 2, 1))).toEqual([]);
    expect(lineLine(L(0, 0, 4, 0), L(0, 1, 4, 1))).toEqual([]);
  });
  it('touching at an end point counts', () => {
    expect(lineLine(L(0, 0, 2, 2), L(2, 2, 4, 0)).map(f)).toEqual([[2, 2]]);
  });
  it('collinear overlap splits at the inner end points', () => {
    const pts = lineLine(L(0, 0, 10, 0), L(4, 0, 14, 0)).map(f);
    expect(pts).toEqual([[4, 0], [10, 0]]);
    expect(lineLine(L(0, 0, 10, 0), L(2, 0, 5, 0)).map(f)).toEqual([[2, 0], [5, 0]]);
    expect(lineLine(L(0, 0, 3, 0), L(5, 0, 9, 0))).toEqual([]); // collinear but apart
  });
});

describe('line × circle', () => {
  it('secant gives two irrational points in one field', () => {
    const pts = lineCircle(L(-5, 0, 5, 0), C(0, 0, 3, 0, 0));
    expect(pts).toHaveLength(2);
    expect(pts[0].x.d).toBe(3n);
    expect(pts[0].x.add(pts[1].x).isZero()).toBe(true);
  });
  it('tangent line gives exactly one point (zero discriminant)', () => {
    const pts = lineCircle(L(0, 5, 10, 5), C(5, 0, 25, 10, 0));
    expect(pts.map(f)).toEqual([[5, 5]]);
  });
  it('keeps only points on the segment', () => {
    expect(lineCircle(L(0, 0, 1, 0), C(0, 0, 25, 5, 0))).toEqual([]);
    expect(lineCircle(L(0, 0, 5, 0), C(0, 0, 25, 5, 0)).map(f)).toEqual([[5, 0]]);
  });
});

describe('circle × circle', () => {
  it('external and internal tangency', () => {
    expect(circleCircle(C(0, 0, 4, 2, 0), C(4, 0, 4, 6, 0)).map(f)).toEqual([[2, 0]]);
    expect(circleCircle(C(0, 0, 16, 4, 0), C(2, 0, 4, 4, 0)).map(f)).toEqual([[4, 0]]);
  });
  it('concentric circles never meet; a repeated circle shares its split points', () => {
    expect(circleCircle(C(5, 5, 4, 7, 5), C(5, 5, 9, 8, 5))).toEqual([]);
    expect(circleCircle(C(5, 5, 25, 10, 5), C(5, 5, 25, 5, 0)).map(f)).toEqual([[5, 0], [10, 5]]);
  });
  it('separate circles do not meet', () => {
    expect(circleCircle(C(0, 0, 1, 1, 0), C(10, 0, 1, 11, 0))).toEqual([]);
  });
});

describe('several curves through one point', () => {
  // x² − 2hx + y² = 3 for h = 0, 1, 2 all pass through (0, ±√3), and so does the line x = 0
  const c0 = C(0, 0, 3, 0, 0), c1 = C(1, 0, 4, 3, 0), c2 = C(2, 0, 7, 0, 0), line = L(0, -5, 0, 5);
  it('every pair finds the same exact points, computed different ways', () => {
    const top = (pts: XPt[]) => pts.find((p) => p.y.sign() > 0)!;
    const ps = [intersect(c0, c1), intersect(c1, c2), intersect(c0, c2), intersect(line, c2), intersect(c1, line)].map(top);
    for (const p of ps) {
      expect(ptEq(p, ps[0])).toBe(true);
      expect(p.x.isZero()).toBe(true);
    }
    expect(ps[0].y.eq(sqrt(3))).toBe(true);
  });
});

describe('directions', () => {
  it('sorts directions by angle exactly, including irrational ones', () => {
    const dirs: XPt[] = [xint(0, -1), xint(1, 0), { x: sqrt(3), y: Quad.ONE }, xint(-1, 0), xint(1, 1), xint(0, 1)];
    const order = [...dirs].sort(angleCmp).map(f);
    expect(order).toEqual([[1, 0], [Math.sqrt(3), 1], [1, 1], [0, 1], [-1, 0], [0, -1]]);
  });
  it('cross products across different fields', () => {
    const u = { x: sqrt(2), y: Quad.ONE }, v = { x: sqrt(3), y: Quad.ONE };
    expect(crossSign(u, v)).toBe(-1); // u has the larger angle (√2 < √3)
    expect(crossSign(u, { x: new Quad(Q.ZERO, Q.of(2), 2n), y: Quad.int(2) })).toBe(0); // parallel
  });
  it('angular ranges', () => {
    expect(strictlyBetween(xint(1, 0), xint(1, 1), xint(0, 1))).toBe(true);
    expect(strictlyBetween(xint(1, 0), xint(1, -1), xint(0, 1))).toBe(false);
    expect(strictlyBetween(xint(1, 0), xint(1, -1), xint(1, 0))).toBe(true); // full turn
    expect(strictlyBetween(xint(1, 0), xint(2, 0), xint(1, 0))).toBe(false); // the start itself
  });
});
