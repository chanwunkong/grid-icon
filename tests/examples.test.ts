import { describe, expect, it } from 'vitest';
import { EXAMPLES, EXAMPLE_FILLS } from '../src/examples';
import { Graph } from '../src/exact/graph';
import { Q } from '../src/exact/rational';
import { parseProject, serialize } from '../src/model/project';
const ratFromJSON = (p: { x: string; y: string }) => ({ x: Q.parse(p.x), y: Q.parse(p.y) });

describe('examples', () => {
  EXAMPLES.forEach((ex, i) => {
    it(`${ex.name()} builds, round-trips and fills exactly its shape`, () => {
      const p = ex.build();
      const back = parseProject(serialize(p));
      expect(back.curves.length).toBe(p.curves.length);
      const g = new Graph(p.curves, p.erased);
      const filled = new Set(p.fills.map((f) => g.locate(ratFromJSON(f.point))));
      const specs = EXAMPLE_FILLS[i];
      if (!specs.length) return expect(p.fills.length).toBe(0);
      expect(p.fills.length).toBeGreaterThan(0);
      // sample off-grid points: filled exactly where the inside test says
      for (let y = 0.29; y < p.grid.h; y += 0.73)
        for (let x = 0.17; x < p.grid.w; x += 0.71) {
          const q = { x: new Q(BigInt(Math.round(x * 1000)), 1000n), y: new Q(BigInt(Math.round(y * 1000)), 1000n) };
          const face = g.locate(q);
          const want = specs.some((s) => s.inside({ x: q.x.toNumber(), y: q.y.toNumber() }));
          expect(face !== null && filled.has(face), `${x.toFixed(1)},${y.toFixed(1)}`).toBe(want);
        }
    });
  });
});
