import { describe, expect, it } from 'vitest';
import { Graph } from '../src/exact/graph';
import { buildStrokes, junctionDots } from '../src/view/paint';
import { layout, overflow, pixelAligned, renderSVG, zip } from '../src/export/export';
import { newProject } from '../src/model/project';
import type { Cap, Curve, Style } from '../src/model/types';

let n = 0;
const st = (cap: Cap, width = 2): Style => ({ width, cap, join: 'miter', miterLimit: 4 });
const line = (ax: number, ay: number, bx: number, by: number, style = st('butt'), guide = false): Curve =>
  ({ id: `l${n++}`, kind: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by }, guide, style });
const circle = (cx: number, cy: number, px: number, py: number, style = st('butt')): Curve =>
  ({ id: `c${n++}`, kind: 'circle', c: { x: cx, y: cy }, p: { x: px, y: py }, guide: false, style });

describe('stroke chaining', () => {
  it('a square of four butt-capped lines becomes one closed path, so the corners get joins', () => {
    const cs = [line(2, 2, 10, 2), line(10, 2, 10, 10), line(10, 10, 2, 10), line(2, 10, 2, 2)];
    const strokes = buildStrokes(cs, new Graph(cs));
    expect(strokes).toHaveLength(1);
    expect(strokes[0].closed).toBe(true);
    expect(strokes[0].steps).toHaveLength(4);
  });

  it('round caps are chained too, so a corner gets the join style', () => {
    const cs = [line(2, 2, 10, 2, st('round')), line(10, 2, 10, 10, st('round'))];
    const strokes = buildStrokes(cs, new Graph(cs));
    expect(strokes).toHaveLength(1);
    expect(strokes[0].steps).toHaveLength(2);
  });
  it('different styles are not chained', () => {
    const cs = [line(2, 2, 10, 2, st('butt', 2)), line(10, 2, 10, 10, st('butt', 3))];
    expect(buildStrokes(cs, new Graph(cs))).toHaveLength(2);
  });

  it('a crossing pairs the straight continuations', () => {
    const cs = [line(0, 5, 10, 5), line(5, 0, 5, 10)];
    const g = new Graph(cs);
    const strokes = buildStrokes(cs, g);
    expect(strokes).toHaveLength(2);
    for (const s of strokes) {
      const ends = s.steps.map((x) => g.pieces[x.piece]);
      expect(new Set(ends.map((p) => p.curve)).size).toBe(1); // each path stays on one straight line
    }
    expect(junctionDots(cs, g)).toHaveLength(1); // four ends meet in the middle
  });

  it('a line split by a circle stays one path through the intersection', () => {
    const cs = [line(0, 5, 20, 5), circle(10, 5, 14, 5)];
    const g = new Graph(cs);
    const lineStroke = buildStrokes(cs, g).find((s) => g.pieces[s.steps[0].piece].curve === cs[0].id)!;
    expect(lineStroke.steps).toHaveLength(3);
    expect(lineStroke.closed).toBe(false);
  });

  it('guides and deleted pieces are not drawn', () => {
    const cs = [circle(10, 10, 15, 10), line(0, 10, 20, 10, st('butt'), true)];
    const strokes = buildStrokes(cs, new Graph(cs));
    expect(strokes).toHaveLength(1); // the circle, closed
    expect(strokes[0].closed).toBe(true);
  });

  it('a T junction gets a dot as wide as the widest line', () => {
    const cs = [line(0, 5, 10, 5, st('butt', 2)), line(5, 5, 5, 10, st('butt', 4))];
    const dots = junctionDots(cs, new Graph(cs));
    expect(dots).toEqual([{ x: 5, y: 5, r: 2 }]);
  });
});

describe('export', () => {
  it('maps sizes onto the grid with margins', () => {
    const p = newProject(24, 24);
    expect(layout(p, 48, 0)).toMatchObject({ width: 48, height: 48, m: { s: 2, ox: 0, oy: 0 } });
    expect(layout(p, 32, 4)).toMatchObject({ width: 32, height: 32, m: { s: 1, ox: 4, oy: 4 } });
    expect(layout(newProject(32, 16), 64, 0)).toMatchObject({ width: 64, height: 32 });
    expect(pixelAligned(2)).toBe(true);
    expect(pixelAligned(16 / 24)).toBe(false);
  });

  it('writes real SVG arcs, clipped to the canvas', () => {
    const p = newProject(24, 24);
    p.curves.push(circle(12, 12, 20, 12, st('round')));
    const svg = renderSVG(p, new Graph(p.curves), new Map(), { transparent: true, background: '#fff', margin: 2, ink: '#000', outline: false, crop: true });
    expect(svg).toContain('viewBox="0 0 28 28"');
    expect(svg).toContain('clip-path="url(#canvas)"');
    expect(svg.match(/A8 8 0 0 1/g)).toHaveLength(2); // a full circle as two half arcs
    expect(svg).toContain('stroke-linecap="round"');
  });

  it('outline mode writes one filled path and no strokes', () => {
    const p = newProject(24, 24);
    p.curves.push(line(4, 12, 20, 12, st('butt')), line(12, 4, 12, 20, st('butt')), circle(12, 12, 18, 12, st('round')));
    const svg = renderSVG(p, new Graph(p.curves), new Map(), { transparent: true, background: '#fff', margin: 0, ink: '#000', outline: true, crop: true });
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg).not.toContain('stroke=');
    expect(svg).not.toContain('<circle');
  });

  it('measures how far caps and lines reach past the canvas', () => {
    const p = newProject(24, 24);
    p.curves.push(line(0, 12, 24, 12, st('butt', 2)));
    expect(overflow(p, new Graph(p.curves), new Map())).toBeNull(); // butt ends stop at the edge
    p.curves[0] = line(0, 12, 24, 12, st('square', 2));
    const o = overflow(p, new Graph(p.curves), new Map())!;
    expect(o.left).toBeCloseTo(1, 3); // half the width beyond each end
    expect(o.right).toBeCloseTo(1, 3);
    expect(o.margin).toBe(1);
    p.curves[0] = line(12, 0, 12, 24, st('round', 4));
    expect(overflow(p, new Graph(p.curves), new Map())!.margin).toBe(2);
  });

  it('builds a valid stored zip', async () => {
    const data = new TextEncoder().encode('hello');
    const blob = zip([{ name: 'a.txt', data }, { name: 'b.txt', data }]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(14, true)).toBe(0x3610a686); // CRC-32 of "hello"
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(bytes.length - 22 + 10, true)).toBe(2);
  });
});
