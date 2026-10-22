import { Q } from './rational';
import { Mix, Quad } from './quad';

/** An exact point; both coordinates belong to the same field Q(√d) (they come from one intersection). */
export interface XPt {
  x: Quad;
  y: Quad;
}

export const xpt = (x: Quad, y: Quad): XPt => ({ x, y });
export const xint = (x: number, y: number): XPt => ({ x: Quad.int(x), y: Quad.int(y) });
export const xrat = (x: Q, y: Q): XPt => ({ x: Quad.rat(x), y: Quad.rat(y) });

export function ptCmp(p: XPt, q: XPt): -1 | 0 | 1 {
  return p.x.cmp(q.x) || p.y.cmp(q.y);
}

export const ptEq = (p: XPt, q: XPt) => ptCmp(p, q) === 0;

/** p − q; used with q a grid point (or anything in p's field). */
export const vsub = (p: XPt, q: XPt): XPt => ({ x: p.x.sub(q.x), y: p.y.sub(q.y) });

export const toFloat = (p: XPt) => ({ x: p.x.toNumber(), y: p.y.toNumber() });

/** Signs of cross(u, v) and dot(u, v); u and v may come from different fields. */
export function crossSign(u: XPt, v: XPt): -1 | 0 | 1 {
  return Mix.mul(u.x, v.y).add(Mix.mul(u.y, v.x).neg()).sign();
}

export function dotSign(u: XPt, v: XPt): -1 | 0 | 1 {
  return Mix.mul(u.x, v.x).add(Mix.mul(u.y, v.y)).sign();
}

export const sameDirection = (u: XPt, v: XPt) => crossSign(u, v) === 0 && dotSign(u, v) > 0;

/** 0 for directions with angle in [0, π), 1 for [π, 2π), measured from +x towards +y. */
function half(v: XPt): 0 | 1 {
  const sy = v.y.sign();
  return sy > 0 || (sy === 0 && v.x.sign() > 0) ? 0 : 1;
}

/**
 * Compare the directions of two non-zero vectors by angle, starting at +x and turning towards +y
 * (counter-clockwise in the usual maths orientation; on screen with y down this looks clockwise).
 */
export function angleCmp(u: XPt, v: XPt): -1 | 0 | 1 {
  const hu = half(u), hv = half(v);
  if (hu !== hv) return hu < hv ? -1 : 1;
  return (-crossSign(u, v) || 0) as -1 | 0 | 1;
}

/** Compare the angles of u and v measured from direction s (both in [0, 2π)). */
export function angleCmpFrom(s: XPt, u: XPt, v: XPt): -1 | 0 | 1 {
  const rel = (w: XPt) => {
    const c = crossSign(s, w);
    return c > 0 || (c === 0 && dotSign(s, w) > 0) ? 0 : 1;
  };
  const ru = rel(u), rv = rel(v);
  if (ru !== rv) return ru < rv ? -1 : 1;
  return (-crossSign(u, v) || 0) as -1 | 0 | 1;
}

/**
 * Is direction w strictly inside the angular range swept from s to e (turning from +x towards +y)?
 * When e has the same direction as s the range is the whole turn minus s itself.
 */
export function strictlyBetween(s: XPt, w: XPt, e: XPt): boolean {
  if (sameDirection(s, w)) return false;
  if (sameDirection(s, e)) return true;
  return angleCmpFrom(s, w, e) < 0;
}
