import type { Curve, Pt } from './types';

export const r2 = (c: Pt, p: Pt): number => (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
export const samePt = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y;

// ---- floating point helpers, used only for UI (hit testing) and rendering ----

/** Distance (in grid units) from a point to the centre line of a curve. */
export function distanceToCurve(curve: Curve, q: { x: number; y: number }): number {
  if (curve.kind === 'line') {
    const { a, b } = curve;
    const vx = b.x - a.x, vy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / (vx * vx + vy * vy)));
    return Math.hypot(a.x + t * vx - q.x, a.y + t * vy - q.y);
  }
  const r = Math.sqrt(r2(curve.c, curve.p));
  return Math.abs(Math.hypot(q.x - curve.c.x, q.y - curve.c.y) - r);
}
