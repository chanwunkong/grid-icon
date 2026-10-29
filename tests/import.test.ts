import { describe, expect, it } from 'vitest';
import { parsePath, primitives } from '../src/import/svgImport';

const at = (seg: (t: number) => { x: number; y: number }, t: number) => {
  const p = seg(t);
  return [Math.round(p.x * 1000) / 1000 + 0, Math.round(p.y * 1000) / 1000 + 0]; // + 0 turns -0 into 0
};

describe('SVG path parsing', () => {
  it('reads absolute and relative lines, H/V and Z', () => {
    const [sp] = parsePath('M10 10 h20 v20 H10 z');
    expect(sp).toHaveLength(4);
    expect(at(sp[0], 1)).toEqual([30, 10]);
    expect(at(sp[1], 1)).toEqual([30, 30]);
    expect(at(sp[3], 1)).toEqual([10, 10]);
  });
  it('repeats the last command for extra coordinates (M then implicit L)', () => {
    const [sp] = parsePath('M0,0 10,0 10,10');
    expect(sp).toHaveLength(2);
    expect(at(sp[1], 1)).toEqual([10, 10]);
  });
  it('handles smooth cubic and quadratic curves', () => {
    const [sp] = parsePath('M0 0 C0 10 10 10 10 0 S20 -10 20 0 Q25 5 30 0 T40 0');
    expect(sp).toHaveLength(4);
    expect(at(sp[1], 1)).toEqual([20, 0]);
    expect(at(sp[3], 1)).toEqual([40, 0]);
  });
  it('reads packed arc flags ("a5 5 0 016 6")', () => {
    const [sp] = parsePath('M0 0a5 5 0 0110 0');
    expect(at(sp[0], 1)).toEqual([10, 0]);
    expect(at(sp[0], 0.5)).toEqual([5, -5]); // sweep flag 1: the upper half in y-down coordinates
  });
  it('keeps several subpaths apart', () => {
    expect(parsePath('M0 0 L1 0 L1 1 Z M5 5 L6 5 L6 6 Z')).toHaveLength(2);
  });
});

describe('splitting outlines into arcs and lines', () => {
  it('a circle drawn as two arcs is one arc', () => {
    const [sp] = parsePath('M1 0.5 A0.5 0.5 0 1 1 0 0.5 A0.5 0.5 0 1 1 1 0.5 Z');
    const prims = primitives(sp);
    expect(prims).toHaveLength(1);
    expect(prims[0].kind).toBe('arc');
    if (prims[0].kind === 'arc') expect(prims[0].r).toBeCloseTo(0.5, 4);
  });
  it('a square is four lines', () => {
    const [sp] = parsePath('M0 0 H1 V1 H0 Z');
    expect(primitives(sp).map((p) => p.kind)).toEqual(['line', 'line', 'line', 'line']);
  });
  it('a D shape is a line and an arc', () => {
    const [sp] = parsePath('M0.5 0 A0.5 0.5 0 0 1 0.5 1 Z');
    expect(primitives(sp).map((p) => p.kind).sort()).toEqual(['arc', 'line']);
  });
});

describe('primitivesFromPoints', () => {
  it('fits a dense circle with arcs and a square with four lines', async () => {
    const { primitivesFromPoints } = await import('../src/import/svgImport');
    const circle = Array.from({ length: 200 }, (_, i) => ({ x: 0.5 + 0.3 * Math.cos((i / 200) * 2 * Math.PI), y: 0.5 + 0.3 * Math.sin((i / 200) * 2 * Math.PI) }));
    const cp = primitivesFromPoints(circle);
    expect(cp.every((p) => p.kind === 'arc')).toBe(true);
    expect(cp.length).toBeLessThanOrEqual(2);
    const sq = primitivesFromPoints([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
    expect(sq.map((p) => p.kind)).toEqual(['line', 'line', 'line', 'line']);
  });
  it('splits a stadium (rounded stroke of a segment) into two lines and two half circles', async () => {
    const { primitivesFromPoints } = await import('../src/import/svgImport');
    const pts: { x: number; y: number }[] = [];
    // segment from (0.3,0.5) to (0.7,0.5), half width 0.1, round caps
    for (let i = 0; i <= 40; i++) { const a = -Math.PI / 2 + (i / 40) * Math.PI; pts.push({ x: 0.7 + 0.1 * Math.cos(a), y: 0.5 + 0.1 * Math.sin(a) }); }
    for (let i = 0; i <= 40; i++) { const a = Math.PI / 2 + (i / 40) * Math.PI; pts.push({ x: 0.3 + 0.1 * Math.cos(a), y: 0.5 + 0.1 * Math.sin(a) }); }
    const kinds = primitivesFromPoints(pts).map((p) => p.kind);
    expect(kinds.filter((k) => k === 'line').length).toBe(2);
    expect(kinds.filter((k) => k === 'arc').length).toBe(2);
  });
});
