import { describe, expect, it } from 'vitest';
import { Graph, ptToJSON, type Erased, type RPt } from '../src/exact/graph';
import { Q } from '../src/exact/rational';
import { DEFAULT_STYLE, type Curve } from '../src/model/types';

let n = 0;
const line = (ax: number, ay: number, bx: number, by: number, guide = false): Curve =>
  ({ id: `l${n++}`, kind: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by }, guide, style: DEFAULT_STYLE });
const circle = (cx: number, cy: number, px: number, py: number, guide = false): Curve =>
  ({ id: `c${n++}`, kind: 'circle', c: { x: cx, y: cy }, p: { x: px, y: py }, guide, style: DEFAULT_STYLE });
const at = (x: number, y: number): RPt => ({ x: Q.of(Math.round(x * 1000), 1000), y: Q.of(Math.round(y * 1000), 1000) });

// Euler's formula for a plane graph: V − E + F = 1 + C, with F counting the outside once
const eulerOk = (g: Graph) => g.faces.length === g.edges.length - g.vertices.filter((v) => v.out.length).length + g.components.length;

describe('planar graph and faces', () => {
  it('a lone circle is one face', () => {
    const g = new Graph([circle(5, 5, 8, 9)]);
    expect(g.vertices).toHaveLength(1);
    expect(g.edges).toHaveLength(1);
    expect(g.faces).toHaveLength(1);
    expect(g.locate(at(5, 5))).toBe(g.faces[0]);
    expect(g.locate(at(20, 20))).toBeNull();
  });

  it('a diameter splits a circle into two half discs', () => {
    const g = new Graph([circle(5, 5, 10, 5), line(0, 5, 10, 5)]);
    expect(g.faces).toHaveLength(2);
    const top = g.locate(at(5, 3)), bottom = g.locate(at(5, 7));
    expect(top).not.toBeNull();
    expect(bottom).not.toBeNull();
    expect(top).not.toBe(bottom);
    expect(g.locate(at(5, 5))).toBeNull(); // on the line
  });

  it('a secant through irrational points cuts off a small cap', () => {
    // y = 1 meets (x−5)² + (y−5)² = 18 at x = 5 ± √2
    const g = new Graph([circle(5, 5, 8, 8), line(0, 1, 10, 1)]);
    expect(g.vertices.filter((v) => !Number.isInteger(v.f.x))).toHaveLength(2);
    expect(g.faces).toHaveLength(2);
    const cap = g.locate(at(5, 0.9)), body = g.locate(at(5, 5));
    expect(cap).not.toBeNull();
    expect(body).not.toBeNull();
    expect(cap).not.toBe(body);
    expect(g.locate(at(0.5, 0.5))).toBeNull(); // outside the circle, above the line
  });

  it('a tangent line touches but does not split the disc', () => {
    const g = new Graph([circle(5, 5, 10, 5), line(0, 0, 10, 0)]);
    expect(g.faces).toHaveLength(1);
    expect(g.vertices.some((v) => v.f.x === 5 && v.f.y === 0 && v.out.length === 4)).toBe(true);
  });

  it('externally tangent circles: two faces meeting at a cusp', () => {
    const g = new Graph([circle(0, 0, 2, 0), circle(4, 0, 6, 0)]);
    expect(g.faces).toHaveLength(2);
    expect(g.locate(at(0, 0))).not.toBe(g.locate(at(4, 0)));
  });

  it('internally tangent circles: a disc and a crescent (tangent tie broken by curvature)', () => {
    const g = new Graph([circle(0, 0, 4, 0), circle(2, 0, 4, 0)]);
    expect(g.faces).toHaveLength(2);
    const small = g.locate(at(2, 0)), crescent = g.locate(at(-2, 0));
    expect(small).not.toBeNull();
    expect(crescent).not.toBeNull();
    expect(small).not.toBe(crescent);
    expect(g.locate(at(3.9, 0.1))).toBe(small);
  });

  it('concentric circles: a ring with a hole', () => {
    const g = new Graph([circle(10, 10, 15, 10), circle(10, 10, 12, 10)]);
    expect(g.components).toHaveLength(2);
    const ring = g.locate(at(13.5, 10)), inner = g.locate(at(10, 10));
    expect(ring).not.toBe(inner);
    expect(g.holes(ring!)).toHaveLength(1);
    expect(g.holes(inner!)).toHaveLength(0);
  });

  it('erasing a piece opens the face', () => {
    const base = [circle(5, 5, 10, 5), line(0, 5, 10, 5)];
    const g = new Graph(base);
    // the circle piece above the line: counter-clockwise from (10,5) round to (0,5) goes through y > 5 … find it
    const arcs = g.pieces.filter((p) => p.curve === base[0].id);
    const upper = arcs.find((p) => {
      const a = g.vertices[p.from].f, b = g.vertices[p.to].f;
      return a.x === 0 && b.x === 10; // from (0,5) counter-clockwise (towards −y) to (10,5): the y < 5 half
    })!;
    const erased: Erased[] = [{ curve: base[0].id, a: ptToJSON(g.vertices[upper.from].p), b: ptToJSON(g.vertices[upper.to].p) }];
    const g2 = new Graph(base, erased);
    expect(g2.faces).toHaveLength(1);
    expect(g2.locate(at(5, 3))).toBeNull();
    expect(g2.locate(at(5, 7))).not.toBeNull();
  });

  it('overlapping collinear lines and a repeated circle are merged', () => {
    const sq = [line(0, 0, 6, 0), line(6, 0, 6, 6), line(6, 6, 0, 6), line(0, 6, 0, 0), line(2, 0, 9, 0)];
    const g = new Graph(sq);
    expect(g.faces).toHaveLength(1);
    expect(g.edges.filter((e) => e.pieces.length === 2)).toHaveLength(1); // (2,0)–(6,0) drawn twice
    const g2 = new Graph([circle(5, 5, 8, 9), circle(5, 5, 8, 9)]);
    expect(g2.faces).toHaveLength(1);
  });

  it('guides cut faces too', () => {
    const g = new Graph([circle(5, 5, 10, 5), line(5, 0, 5, 10, true), line(0, 5, 10, 5, true)]);
    expect(g.faces).toHaveLength(4);
  });

  it('a triangle with its corners cut by a circle', () => {
    const g = new Graph([line(0, 0, 12, 0), line(12, 0, 6, 10), line(6, 10, 0, 0), circle(6, 4, 6, 9)]);
    // the circle (r² = 25) crosses all three sides: regions inside both, inside one only
    expect(g.faces.length).toBeGreaterThanOrEqual(4);
    expect(g.locate(at(6, 4))).not.toBeNull();
  });
});

describe('structure', () => {
  it("every test layout satisfies Euler's formula", () => {
    const layouts: Curve[][] = [
      [circle(5, 5, 8, 9)],
      [circle(5, 5, 10, 5), line(0, 5, 10, 5)],
      [circle(5, 5, 8, 8), line(0, 1, 10, 1)],
      [circle(0, 0, 2, 0), circle(4, 0, 6, 0)],
      [circle(0, 0, 4, 0), circle(2, 0, 4, 0)],
      [circle(10, 10, 15, 10), circle(10, 10, 12, 10)],
      [circle(0, 0, 1, 1), circle(4, 0, 7, 3), circle(-4, 0, -1, 3), line(0, -5, 0, 5)],
      [line(0, 0, 12, 0), line(12, 0, 6, 10), line(6, 10, 0, 0), circle(6, 4, 6, 9)],
      [line(0, 0, 6, 0), line(6, 0, 6, 6), line(6, 6, 0, 6), line(0, 6, 0, 0), line(2, 0, 9, 0), line(3, 3, 9, 9)],
    ];
    for (const cs of layouts) expect(eulerOk(new Graph(cs))).toBe(true);
  });
});

describe('several curves through one irrational point', () => {
  // x² − 2hx + y² = 2 for h = 0, 4, −4 all pass through (0, ±√2); so does the line x = 0.
  // Each pair finds the point with a different formula; they must become one vertex.
  const curves = () => [circle(0, 0, 1, 1), circle(4, 0, 7, 3), circle(-4, 0, -1, 3), line(0, -5, 0, 5)];

  it('merge into one vertex of degree 8 at each of (0, ±√2)', () => {
    const g = new Graph(curves());
    const hubs = g.vertices.filter((v) => v.p.x.isZero() && !v.p.y.isRational);
    expect(hubs).toHaveLength(2);
    for (const v of hubs) {
      expect(v.out).toHaveLength(8);
      expect(Math.abs(v.f.y)).toBeCloseTo(Math.SQRT2, 12);
    }
  });

  it('the faces around the hub are found exactly', () => {
    const g = new Graph(curves());
    const right = g.locate(at(2, 0)), left = g.locate(at(-2, 0)), mid = g.locate(at(0.5, 0));
    expect([right, left, mid].every((f) => f !== null)).toBe(true);
    expect(new Set([right, left, mid]).size).toBe(3);
    expect(g.locate(at(5, 0))).toBe(right); // same region further out
    expect(g.locate(at(-5, 0))).toBe(left);
  });
});
