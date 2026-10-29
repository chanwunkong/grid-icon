// Built-in examples (all original drawings) for the new-project dialog. Each is described by its
// curves, points near the pieces to delete, and which regions to fill (a plain inside test, applied
// to one point inside every closed region of the exact graph).
import type { Curve, ErasedPiece, Fill, Project, Pt, Style } from './model/types';
import { DEFAULT_STYLE } from './model/types';
import { Graph, ptToJSON } from './exact/graph';
import { distanceToPiece } from './view/paint';
import { newId } from './model/project';
import { t } from './i18n';

type XY = { x: number; y: number };
type CurveSpec = ({ kind: 'line'; a: Pt; b: Pt } | { kind: 'circle'; c: Pt; p: Pt }) & { guide?: boolean; style?: Partial<Style> };

interface ExampleSpec {
  name: () => string;
  size: number;
  curves: CurveSpec[];
  erase?: XY[];
  fills?: { color: string; inside: (p: XY) => boolean }[];
}

const P = (x: number, y: number): Pt => ({ x, y });
const line = (a: Pt, b: Pt, extra: Partial<CurveSpec> = {}): CurveSpec => ({ kind: 'line', a, b, ...extra }) as CurveSpec;
const circle = (c: Pt, p: Pt, extra: Partial<CurveSpec> = {}): CurveSpec => ({ kind: 'circle', c, p, ...extra }) as CurveSpec;
const guide = { guide: true };
const inCircle = (cx: number, cy: number, r: number) => (p: XY) => (p.x - cx) ** 2 + (p.y - cy) ** 2 < r * r;
/** Inside a convex polygon given counter-clockwise on screen (y down). */
const inPoly = (pts: XY[]) => (p: XY) =>
  pts.every((a, i) => {
    const b = pts[(i + 1) % pts.length];
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) <= 0;
  });

const SPECS: ExampleSpec[] = [
  {
    name: () => t('圓環'),
    size: 24,
    curves: [circle(P(12, 12), P(12, 4), guide), circle(P(12, 12), P(12, 7), guide)],
    fills: [{ color: '#2f6bff', inside: (p) => inCircle(12, 12, 8)(p) && !inCircle(12, 12, 5)(p) }],
  },
  {
    name: () => t('愛心'),
    size: 24,
    // two circles of r² = 32, and lines leaving them along the tangent at 45°
    curves: [circle(P(8, 10), P(4, 14), guide), circle(P(16, 10), P(20, 14), guide), line(P(4, 14), P(12, 22), guide), line(P(20, 14), P(12, 22), guide)],
    fills: [{
      color: '#e5484d',
      inside: (p) => inCircle(8, 10, Math.sqrt(32))(p) || inCircle(16, 10, Math.sqrt(32))(p)
        || inPoly([{ x: 4, y: 14 }, { x: 12, y: 22 }, { x: 20, y: 14 }, { x: 16, y: 10 }, { x: 8, y: 10 }])(p),
    }],
  },
  {
    name: () => t('定位點'),
    size: 24,
    curves: [circle(P(12, 10), P(12, 3), guide), line(P(5, 10), P(12, 22), guide), line(P(19, 10), P(12, 22), guide), circle(P(12, 10), P(12, 7), guide)],
    fills: [{
      color: '#12a150',
      inside: (p) => (inCircle(12, 10, 7)(p) || inPoly([{ x: 5, y: 10 }, { x: 12, y: 22 }, { x: 19, y: 10 }])(p)) && !inCircle(12, 10, 3)(p),
    }],
  },
  {
    name: () => t('雲'),
    size: 24,
    curves: [circle(P(8, 14), P(8, 10), guide), circle(P(14, 11), P(14, 6), guide), circle(P(18, 15), P(18, 12), guide), line(P(8, 18), P(18, 18), guide)],
    fills: [{
      color: '#56b4f5',
      inside: (p) => inCircle(8, 14, 4)(p) || inCircle(14, 11, 5)(p) || inCircle(18, 15, 3)(p) || (p.x > 8 && p.x < 18 && p.y > 12 && p.y < 18),
    }],
  },
  {
    name: () => t('葉子'),
    size: 24,
    // the overlap of two circles through the same two corners, with a vein on top
    curves: [circle(P(6, 6), P(6, 18), guide), circle(P(18, 18), P(18, 6), guide), line(P(8, 16), P(16, 8), { style: { width: 1, color: '#ffffff' } })],
    fills: [{ color: '#2e9e5b', inside: (p) => inCircle(6, 6, 12)(p) && inCircle(18, 18, 12)(p) }],
  },
  {
    name: () => t('笑臉（用輔助線切圓做出圓弧）'),
    size: 24,
    curves: [
      circle(P(12, 12), P(12, 3)),
      circle(P(9, 9), P(9, 8)),
      circle(P(15, 9), P(15, 8)),
      circle(P(12, 12), P(12, 17)), // the mouth: the part above the guide is deleted
      line(P(4, 14), P(20, 14), guide),
    ],
    erase: [{ x: 12, y: 7 }],
  },
  {
    name: () => t('房子（線條）'),
    size: 24,
    curves: [
      line(P(4, 12), P(12, 4)), line(P(12, 4), P(20, 12)),
      line(P(6, 10), P(6, 20)), line(P(18, 10), P(18, 20)), line(P(6, 20), P(18, 20)),
      line(P(10, 20), P(10, 14)), line(P(10, 14), P(14, 14)), line(P(14, 14), P(14, 20)),
    ],
  },
];

function build(spec: ExampleSpec): Project {
  const curves: Curve[] = spec.curves.map((c) => {
    const style: Style = { ...DEFAULT_STYLE, ...c.style };
    const base = { id: newId(), guide: !!c.guide, style };
    return c.kind === 'line' ? { ...base, kind: 'line', a: c.a, b: c.b } : { ...base, kind: 'circle', c: c.c, p: c.p };
  });
  let g = new Graph(curves);
  const erased: ErasedPiece[] = [];
  for (const q of spec.erase ?? []) {
    let best = g.pieces[0], bd = Infinity;
    for (const pc of g.pieces) {
      const d = distanceToPiece(g, pc, q);
      if (d < bd) [best, bd] = [pc, d];
    }
    erased.push({ curve: best.curve, a: ptToJSON(g.vertices[best.from].p), b: ptToJSON(g.vertices[best.to].p) });
  }
  if (erased.length) g = new Graph(curves, erased);
  const fills: Fill[] = [];
  for (const face of g.faces) {
    const q = g.interiorPoint(face);
    if (!q) continue;
    const f = { x: q.x.toNumber(), y: q.y.toNumber() };
    const hit = spec.fills?.find((fl) => fl.inside(f));
    if (hit) fills.push({ id: newId(), point: { x: q.x.toString(), y: q.y.toString() }, color: hit.color });
  }
  return { version: 1, grid: { w: spec.size, h: spec.size }, curves, erased, fills };
}

/** The examples' names (translated) and a builder for each. */
export const EXAMPLES = SPECS.map((s) => ({ name: s.name, build: () => build(s) }));

/** For tests: the specs' inside tests. */
export const EXAMPLE_FILLS = SPECS.map((s) => s.fills ?? []);
