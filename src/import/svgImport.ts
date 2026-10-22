// SVG import: turn a filled SVG drawing into grid curves.
// 1. Outlines are split into circular arcs and straight lines (within TOL of the drawing's size).
// 2. Each one is replaced by a grid curve (circle: centre on a grid point, a grid point on it; line:
//    through two grid points), chosen jointly along every outline so neighbours still cross near the
//    original corner and no corner bends much more than it did.
// 3. All curves become guides; the regions they enclose are filled with the original colours.
// Floating point is fine here: this only proposes curves. Everything after that is exact.
import { Graph, type RPt } from '../exact/graph';
import { Q } from '../exact/rational';
import { newId, newProject } from '../model/project';
import type { Curve, Project } from '../model/types';
import type { Piece } from '../exact/graph';

type P = { x: number; y: number };
const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: P, k: number): P => ({ x: a.x * k, y: a.y * k });
const len = (a: P) => Math.hypot(a.x, a.y);
const cross = (a: P, b: P) => a.x * b.y - a.y * b.x;
const dot = (a: P, b: P) => a.x * b.x + a.y * b.y;

const TOL = 0.001; // arc / line fit tolerance, fraction of the drawing size
const MAX_BEND = 15; // degrees a corner may bend more than in the original

// ------------------------------------------------------------------ SVG reading

type Seg = (t: number) => P;

interface Shape {
  subpaths: Seg[][];
  color: string;
  evenodd: boolean;
}

/** Parse SVG path data into subpaths of parametric segments (in the path's own coordinates). */
export function parsePath(d: string): Seg[][] {
  let i = 0;
  const ws = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  const num = (): number => {
    ws();
    const m = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(d.slice(i));
    if (!m) throw new SyntaxError(`路徑數字格式錯誤（位置 ${i}）`);
    i += m[0].length;
    return Number(m[0]);
  };
  const flag = (): number => { ws(); const c = d[i++]; if (c !== '0' && c !== '1') throw new SyntaxError('圓弧旗標錯誤'); return Number(c); };
  const more = () => { ws(); return i < d.length && /[-+.\d]/.test(d[i]); };
  const out: Seg[][] = [];
  let cur: Seg[] = [], p: P = { x: 0, y: 0 }, start: P = p, lastCtrl: P | null = null, lastCmd = '';
  const line = (a: P, b: P): Seg => (t) => add(a, mul(sub(b, a), t));
  const cubic = (a: P, b: P, c: P, e: P): Seg => (t) => {
    const u = 1 - t;
    return { x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * e.x, y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * e.y };
  };
  const quad = (a: P, b: P, e: P): Seg => (t) => {
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * b.x + t * t * e.x, y: u * u * a.y + 2 * u * t * b.y + t * t * e.y };
  };
  const arc = (a: P, rx: number, ry: number, phiDeg: number, large: number, sweep: number, b: P): Seg | null => {
    // SVG implementation notes F.6.5: endpoint to centre parameterisation
    if (rx === 0 || ry === 0) return line(a, b);
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = (phiDeg * Math.PI) / 180, cs = Math.cos(phi), sn = Math.sin(phi);
    const dx = (a.x - b.x) / 2, dy = (a.y - b.y) / 2;
    const x1 = cs * dx + sn * dy, y1 = -sn * dx + cs * dy;
    const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const num2 = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num2 / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
    const cx1 = (k * rx * y1) / ry, cy1 = (-k * ry * x1) / rx;
    const c = { x: cs * cx1 - sn * cy1 + (a.x + b.x) / 2, y: sn * cx1 + cs * cy1 + (a.y + b.y) / 2 };
    const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
    let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    return (t) => {
      const th = t1 + dt * t, ex = rx * Math.cos(th), ey = ry * Math.sin(th);
      return { x: cs * ex - sn * ey + c.x, y: sn * ex + cs * ey + c.y };
    };
  };
  while (true) {
    ws();
    if (i >= d.length) break;
    let cmd = d[i];
    if (/[a-zA-Z]/.test(cmd)) i++;
    else if (lastCmd) cmd = lastCmd === 'M' ? 'L' : lastCmd === 'm' ? 'l' : lastCmd; // implicit repeat
    else throw new SyntaxError('路徑必須以 M 開頭');
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z' && cmd !== 'Z';
    const pt = (): P => { const x = num(), y = num(); return rel ? { x: p.x + x, y: p.y + y } : { x, y }; };
    switch (cmd.toUpperCase()) {
      case 'M':
        if (cur.length) out.push(cur);
        cur = [];
        p = start = pt();
        lastCtrl = null;
        break;
      case 'L': { const e = pt(); cur.push(line(p, e)); p = e; lastCtrl = null; break; }
      case 'H': { const x = num(); const e = { x: rel ? p.x + x : x, y: p.y }; cur.push(line(p, e)); p = e; lastCtrl = null; break; }
      case 'V': { const y = num(); const e = { x: p.x, y: rel ? p.y + y : y }; cur.push(line(p, e)); p = e; lastCtrl = null; break; }
      case 'C': { const b = pt(), c = pt(), e = pt(); cur.push(cubic(p, b, c, e)); lastCtrl = c; p = e; break; }
      case 'S': {
        const b: P = lastCtrl && /[CS]/i.test(lastCmd) ? sub(mul(p, 2), lastCtrl) : p, c = pt(), e = pt();
        cur.push(cubic(p, b, c, e)); lastCtrl = c; p = e; break;
      }
      case 'Q': { const b = pt(), e = pt(); cur.push(quad(p, b, e)); lastCtrl = b; p = e; break; }
      case 'T': {
        const b: P = lastCtrl && /[QT]/i.test(lastCmd) ? sub(mul(p, 2), lastCtrl) : p, e = pt();
        cur.push(quad(p, b, e)); lastCtrl = b; p = e; break;
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag(), e = pt();
        const s = arc(p, rx, ry, rot, large, sweep, e);
        if (s) cur.push(s);
        p = e; lastCtrl = null; break;
      }
      case 'Z':
        if (len(sub(p, start)) > 1e-9) cur.push(line(p, start));
        p = start;
        if (cur.length) out.push(cur);
        cur = [];
        lastCtrl = null;
        break;
      default:
        throw new SyntaxError(`不支援的路徑指令 ${cmd}`);
    }
    lastCmd = cmd;
    if (!/[zZ]/.test(cmd) && more()) continue;
  }
  if (cur.length) out.push(cur);
  return out;
}

const HEX = (rgb: string) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  return m ? '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('') : rgb;
};

/** Read the filled shapes of an SVG (in document order), with transforms applied. */
export function readSvg(text: string): { shapes: Shape[]; svg: SVGSVGElement; host: HTMLElement; width: number; height: number } {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement as unknown as SVGSVGElement;
  if (svg.nodeName !== 'svg' || doc.querySelector('parsererror')) throw new Error('不是有效的 SVG 檔案');
  const vb = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  const width = parseFloat(svg.getAttribute('width') ?? '') || vb?.[2] || 300;
  const height = parseFloat(svg.getAttribute('height') ?? '') || vb?.[3] || 150;
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  // attached (invisibly) so the browser resolves transforms and styles
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;opacity:0;pointer-events:none';
  host.append(document.importNode(svg, true));
  document.body.append(host);
  const live = host.firstElementChild as SVGSVGElement;
  const shapes: Shape[] = [];
  try {
    for (const el of live.querySelectorAll<SVGGraphicsElement>('path, circle, ellipse, rect, polygon, polyline')) {
      if (el.closest('defs, clipPath, mask, symbol, pattern')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.fill === 'none' || cs.fill.startsWith('url(')) continue;
      let d = '';
      const n = (a: string) => parseFloat(el.getAttribute(a) ?? '0') || 0;
      switch (el.tagName) {
        case 'path': d = el.getAttribute('d') ?? ''; break;
        case 'circle': { const cx = n('cx'), cy = n('cy'), r = n('r'); d = `M${cx + r} ${cy}A${r} ${r} 0 1 1 ${cx - r} ${cy}A${r} ${r} 0 1 1 ${cx + r} ${cy}Z`; break; }
        case 'ellipse': { const cx = n('cx'), cy = n('cy'), rx = n('rx'), ry = n('ry'); d = `M${cx + rx} ${cy}A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}A${rx} ${ry} 0 1 1 ${cx + rx} ${cy}Z`; break; }
        case 'rect': { const x = n('x'), y = n('y'), w = n('width'), h = n('height'); d = `M${x} ${y}H${x + w}V${y + h}H${x}Z`; break; }
        default: { const pts = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number); d = 'M' + pts.join(' ') + (el.tagName === 'polygon' ? 'Z' : ''); }
      }
      const m = el.getCTM() ?? live.createSVGMatrix();
      const tf = (q: P): P => ({ x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f });
      const subpaths = parsePath(d).map((sp) => sp.map((s) => (t: number) => tf(s(t))));
      if (subpaths.length) shapes.push({ subpaths, color: HEX(cs.fill), evenodd: cs.fillRule === 'evenodd' });
    }
  } finally {
    host.remove();
  }
  return { shapes, svg, host, width, height };
}

// ------------------------------------------------------------------ arcs and lines

type Prim = { kind: 'line'; a: P; b: P; z: P[] } | { kind: 'arc'; c: P; r: number; z: P[] };

function fitCircle(z: P[]): { c: P; r: number; err: number } {
  // least squares on x² + y² = 2ax + 2by + k
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, n = z.length, bx = 0, by = 0, b1 = 0;
  for (const p of z) {
    const w = p.x * p.x + p.y * p.y;
    sxx += 4 * p.x * p.x; sxy += 4 * p.x * p.y; syy += 4 * p.y * p.y; sx += 2 * p.x; sy += 2 * p.y;
    bx += 2 * p.x * w; by += 2 * p.y * w; b1 += w;
  }
  const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], B = [bx, by, b1];
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  if (Math.abs(D) < 1e-18) return { c: { x: 0, y: 0 }, r: 0, err: Infinity };
  const col = (k: number) => det(M.map((row, i) => row.map((v, j) => (j === k ? B[i] : v))));
  const a = col(0) / D, b = col(1) / D, k = col(2) / D;
  const c = { x: a, y: b }, r = Math.sqrt(Math.max(0, k + a * a + b * b));
  let err = 0;
  for (const p of z) err = Math.max(err, Math.abs(len(sub(p, c)) - r));
  return { c, r, err };
}

function straightErr(z: P[]): number {
  const ch = sub(z[z.length - 1], z[0]), l = len(ch);
  if (l < 1e-12) return Infinity;
  let e = 0;
  for (const p of z) e = Math.max(e, Math.abs(cross(sub(p, z[0]), ch)) / l);
  return e;
}

/** Split one outline into arcs and lines (coordinates already normalised to size 1). */
export function primitives(segs: Seg[]): Prim[] {
  const out: Prim[] = [];
  const sample = (s: Seg, t0: number, t1: number) => Array.from({ length: 24 }, (_, k) => s(t0 + ((t1 - t0) * k) / 23));
  const fit = (s: Seg, t0: number, t1: number, depth: number) => {
    const z = sample(s, t0, t1);
    if (len(sub(z[23], z[0])) < 1e-9 && straightErr(z) === Infinity) {
      const spread = Math.max(...z.map((p) => len(sub(p, z[0]))));
      if (spread < 1e-6) return; // a point-sized segment
    }
    if (straightErr(z) < TOL) { push({ kind: 'line', a: z[0], b: z[23], z }); return; }
    const f = fitCircle(z);
    if (f.err < TOL || depth > 8) { push({ kind: 'arc', c: f.c, r: f.r, z }); return; }
    const m = (t0 + t1) / 2;
    fit(s, t0, m, depth + 1);
    fit(s, m, t1, depth + 1);
  };
  const push = (p: Prim) => {
    const last = out[out.length - 1];
    if (last && last.kind === p.kind) {
      const z = [...last.z, ...p.z.slice(1)];
      if (p.kind === 'arc') {
        const f = fitCircle(z);
        if (f.err < TOL) { out[out.length - 1] = { kind: 'arc', c: f.c, r: f.r, z }; return; }
      } else if (straightErr(z) < TOL) { out[out.length - 1] = { kind: 'line', a: z[0], b: z[z.length - 1], z }; return; }
    }
    out.push(p);
  };
  for (const s of segs) fit(s, 0, 1, 0);
  // the outline is closed: the last piece may continue the first
  if (out.length > 1 && out[0].kind === out[out.length - 1].kind) {
    const z = [...out[out.length - 1].z, ...out[0].z.slice(1)];
    if (out[0].kind === 'arc') {
      const f = fitCircle(z);
      if (f.err < TOL) { out[0] = { kind: 'arc', c: f.c, r: f.r, z }; out.pop(); }
    } else if (straightErr(z) < TOL) { out[0] = { kind: 'line', a: z[0], b: z[z.length - 1], z }; out.pop(); }
  }
  return out;
}

// ------------------------------------------------------------------ grid curves

type Geom = { kind: 'arc'; c: P; k: number } | { kind: 'line'; a: P; b: P };
type Cand = { err: number; g: Geom };

const SQ = new Map<number, [number, number] | null>();
/** A grid offset (a, b) with a² + b² = k, if there is one. */
function twoSquares(k: number): [number, number] | null {
  if (SQ.has(k)) return SQ.get(k)!;
  let res: [number, number] | null = null;
  for (let a = Math.floor(Math.sqrt(k)); a >= 0 && !res; a--) {
    const b = Math.round(Math.sqrt(k - a * a));
    if (b * b === k - a * a) res = [a, b];
  }
  SQ.set(k, res);
  return res;
}

export function candidates(p: Prim, s: number, off: P, N: number, K: number): Cand[] {
  const T = (q: P) => add(mul(q, s), off);
  const zs = p.z.map(T);
  const out: Cand[] = [];
  const inReach = (q: P) => q.x >= -N && q.y >= -N && q.x <= 2 * N && q.y <= 2 * N;
  if (p.kind === 'arc') {
    const c = T(p.c);
    for (let gx = Math.floor(c.x) - 1; gx <= Math.floor(c.x) + 2; gx++)
      for (let gy = Math.floor(c.y) - 1; gy <= Math.floor(c.y) + 2; gy++) {
        const g = { x: gx, y: gy };
        if (!inReach(g)) continue;
        const ds = zs.map((q) => len(sub(q, g)));
        const target = (Math.min(...ds) + Math.max(...ds)) / 2;
        const k0 = Math.max(1, Math.round(target * target)), span = 3 + Math.floor(2 * target);
        for (let k = Math.max(1, k0 - span); k <= k0 + span; k++) {
          const ab = twoSquares(k);
          if (!ab) continue;
          // the circle's grid point must be reachable too
          if (!inReach({ x: gx + ab[0], y: gy + ab[1] }) && !inReach({ x: gx - ab[0], y: gy - ab[1] }) && !inReach({ x: gx + ab[1], y: gy - ab[0] })) continue;
          const r = Math.sqrt(k);
          let err = 0;
          for (const d of ds) err = Math.max(err, Math.abs(d - r));
          out.push({ err, g: { kind: 'arc', c: g, k } });
        }
      }
    // a very flat arc whose centre lies beyond reach: stand in with straight lines through grid points
    // (the error against the arc samples still counts, so this only wins when the arc is nearly straight)
    if (!out.length) return candidates({ kind: 'line', a: p.z[0], b: p.z[p.z.length - 1], z: p.z }, s, off, N, K);
  } else {
    const a = T(p.a), b = T(p.b), dir = mul(sub(b, a), 1 / len(sub(b, a)));
    const seen = new Set<string>();
    const nudges = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
    for (const ext of [0, N / 4, N / 2, N]) {
      const A0 = sub(a, mul(dir, ext)), B0 = add(b, mul(dir, ext));
      for (const da of nudges)
        for (const db of nudges) {
          const A = { x: Math.round(A0.x) + da.x, y: Math.round(A0.y) + da.y }, B = { x: Math.round(B0.x) + db.x, y: Math.round(B0.y) + db.y };
          const key = `${A.x},${A.y},${B.x},${B.y}`;
          if ((A.x === B.x && A.y === B.y) || seen.has(key) || !inReach(A) || !inReach(B)) continue;
          seen.add(key);
          const u = mul(sub(B, A), 1 / len(sub(B, A)));
          let err = 0;
          for (const q of zs) err = Math.max(err, Math.abs(cross(sub(q, A), u)));
          out.push({ err, g: { kind: 'line', a: A, b: B } });
        }
    }
  }
  out.sort((x, y) => x.err - y.err);
  return out.slice(0, K);
}

/** Where two grid curves cross, nearest to `near` (null if they do not). */
function meet(g1: Geom, g2: Geom, near: P): P | null {
  let pts: P[] = [];
  if (g1.kind === 'arc' && g2.kind === 'arc') {
    const d = len(sub(g2.c, g1.c)), r1 = Math.sqrt(g1.k), r2 = Math.sqrt(g2.k);
    if (d === 0 || d > r1 + r2 || d < Math.abs(r1 - r2)) return null;
    const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
    const u = mul(sub(g2.c, g1.c), 1 / d), m = add(g1.c, mul(u, a)), n = { x: -u.y, y: u.x };
    pts = [add(m, mul(n, h)), sub(m, mul(n, h))];
  } else if (g1.kind === 'line' && g2.kind === 'line') {
    const u = sub(g1.b, g1.a), v = sub(g2.b, g2.a), den = cross(u, v);
    if (Math.abs(den) < 1e-12) return null;
    pts = [add(g1.a, mul(u, cross(sub(g2.a, g1.a), v) / den))];
  } else {
    const ln = (g1.kind === 'line' ? g1 : g2) as Extract<Geom, { kind: 'line' }>, ar = (g1.kind === 'arc' ? g1 : g2) as Extract<Geom, { kind: 'arc' }>;
    const u = mul(sub(ln.b, ln.a), 1 / len(sub(ln.b, ln.a)));
    const foot = add(ln.a, mul(u, dot(sub(ar.c, ln.a), u)));
    const h2 = ar.k - len(sub(ar.c, foot)) ** 2;
    if (h2 < 0) return null;
    pts = [add(foot, mul(u, Math.sqrt(h2))), sub(foot, mul(u, Math.sqrt(h2)))];
  }
  return pts.reduce((b, p) => (len(sub(p, near)) < len(sub(b, near)) ? p : b));
}

function tangentAt(g: Geom | { kind: 'arc'; c: P; k: number }, p: P, want: P): P {
  let t: P = g.kind === 'line' ? sub(g.b, g.a) : { x: -(p.y - g.c.y), y: p.x - g.c.x };
  t = mul(t, 1 / (len(t) || 1));
  return dot(t, want) >= 0 ? t : mul(t, -1);
}

const angleBetween = (u: P, v: P) => Math.abs((Math.atan2(cross(u, v), dot(u, v)) * 180) / Math.PI);

interface Fit {
  err: number; // worst deviation in grid units (curves and corners), over the outlines that close
  bend: number; // worst extra corner bend, degrees
  scale: number;
  off: P;
  geoms: (Geom[] | null)[]; // null: this outline could not be closed at this grid size (skipped)
  failed: number;
}

/** Grid curves for one closed outline, by dynamic programming around it; null if it cannot close. */
export function chainFor(prims: Prim[], s: number, off: P, N: number, K: number, maxBend: number): { cost: number; bend: number; geoms: Geom[] } | null {
  const T = (q: P) => add(mul(q, s), off);
  const cands = prims.map((p) => candidates(p, s, off, N, K));
  if (cands.some((c) => !c.length)) return null;
  const n = prims.length;
  if (n === 1) return { cost: cands[0][0].err, bend: 0, geoms: [cands[0][0].g] };
  const J = prims.map((p) => T(p.z[p.z.length - 1]));
  const orig = prims.map((p): Geom =>
    p.kind === 'arc' ? { kind: 'arc', c: T(p.c), k: (p.r * s) ** 2 } : { kind: 'line', a: T(p.a), b: T(p.b) });
  const outDir = prims.map((p) => sub(p.z[p.z.length - 1], p.z[p.z.length - 4]));
  const inDir = prims.map((p) => sub(p.z[3], p.z[0]));
  const jointCost = (j: number, ga: Geom, gb: Geom): [number, number] | null => {
    const nj = (j + 1) % n, X = meet(ga, gb, J[j]);
    if (!X || len(sub(X, J[j])) > 1.5) return null;
    const t1 = tangentAt(ga, X, outDir[j]), t2 = tangentAt(gb, X, inDir[nj]);
    const T1 = tangentAt(orig[j], J[j], outDir[j]), T2 = tangentAt(orig[nj], J[j], inDir[nj]);
    const extra = Math.abs(angleBetween(t1, t2) - angleBetween(T1, T2));
    return extra > maxBend ? null : [len(sub(X, J[j])), extra];
  };
  let bestChain: { cost: number; pick: number[]; bend: number } | null = null;
  for (let c0 = 0; c0 < cands[0].length; c0++) {
    let dp = new Map<number, { cost: number; pick: number[]; bend: number }>([[c0, { cost: cands[0][c0].err, pick: [c0], bend: 0 }]]);
    for (let j = 1; j < n && dp.size; j++) {
      const nd = new Map<number, { cost: number; pick: number[]; bend: number }>();
      cands[j].forEach((cb, k) => {
        for (const [pk, st] of dp) {
          const jc = jointCost(j - 1, cands[j - 1][pk].g, cb.g);
          if (!jc) continue;
          const cost = Math.max(st.cost, cb.err, jc[0]);
          const old = nd.get(k);
          if (!old || cost < old.cost) nd.set(k, { cost, pick: [...st.pick, k], bend: Math.max(st.bend, jc[1]) });
        }
      });
      dp = nd;
    }
    for (const [k, st] of dp) {
      const jc = jointCost(n - 1, cands[n - 1][k].g, cands[0][c0].g);
      if (!jc) continue;
      const cost = Math.max(st.cost, jc[0]);
      if (!bestChain || cost < bestChain.cost) bestChain = { cost, pick: st.pick, bend: Math.max(st.bend, jc[1]) };
    }
  }
  return bestChain && { cost: bestChain.cost, bend: bestChain.bend, geoms: bestChain.pick.map((k, j) => cands[j][k].g) };
}

/** Choose grid curves for every outline (dynamic programming around each closed outline). */
export function fitGrid(outlines: Prim[][], N: number, w: number, h: number, K: number, maxBend: number): Fit | null {
  let best: Fit | null = null;
  // leave a little room around the drawing so snapping never pushes fills past the canvas edge
  for (const sf of [0.88, 0.92, 0.95]) {
    const s = sf * N;
    for (const ox of [0, 1 / 3, 2 / 3])
      for (const oy of [0, 1 / 3, 2 / 3]) {
        const off = { x: ox + (N - w * s) / 2, y: oy + (N - h * s) / 2 };
        let worst = 0, bend = 0, failed = 0;
        const geoms: (Geom[] | null)[] = [];
        for (const prims of outlines) {
          const r = chainFor(prims, s, off, N, K, maxBend);
          if (!r) { failed++; geoms.push(null); continue; }
          worst = Math.max(worst, r.cost);
          bend = Math.max(bend, r.bend);
          geoms.push(r.geoms);
        }
        // prefer closing more outlines, then the smaller deviation
        if (!best || failed < best.failed || (failed === best.failed && worst < best.err)) best = { err: worst, bend, scale: s, off, geoms, failed };
      }
  }
  return best;
}

// ------------------------------------------------------------------ project

/** The rebuilt outline of each subpath, as a polygon (for deciding which regions get which colour). */
export function rebuildPolygon(prims: Prim[], geoms: Geom[], s: number, off: P): P[] {
  const n = geoms.length;
  if (n === 1 && geoms[0].kind === 'arc') {
    const g = geoms[0], r = Math.sqrt(g.k);
    const m = Math.max(96, Math.ceil((2 * Math.PI) / (2 * Math.acos(Math.max(-1, 1 - 0.002 / r)))));
    return Array.from({ length: m }, (_, i) => add(g.c, { x: r * Math.cos((i / m) * 2 * Math.PI), y: r * Math.sin((i / m) * 2 * Math.PI) }));
  }
  const T = (q: P) => add(mul(q, s), off);
  const X = prims.map((p, j) => meet(geoms[j], geoms[(j + 1) % n], T(p.z[p.z.length - 1]))!);
  const pts: P[] = [];
  for (let j = 0; j < n; j++) {
    const a = X[(j - 1 + n) % n], b = X[j], g = geoms[j];
    if (g.kind === 'line') { pts.push(a, b); continue; }
    const want = sub(prims[j].z[3], prims[j].z[0]);
    const ccw = cross(sub(a, g.c), want) > 0;
    const a0 = Math.atan2(a.y - g.c.y, a.x - g.c.x), a1 = Math.atan2(b.y - g.c.y, b.x - g.c.x);
    const TAU = 2 * Math.PI;
    let span = ccw ? (((a1 - a0) % TAU) + TAU) % TAU : -((((a0 - a1) % TAU) + TAU) % TAU);
    if (Math.abs(span) < 1e-9) span = ccw ? TAU : -TAU;
    // fine enough that the polygon stays within 0.002 grid of the true arc (colour tests near edges)
    const r = Math.sqrt(g.k), step = 2 * Math.acos(Math.max(-1, 1 - 0.002 / r)), steps = Math.max(4, Math.ceil(Math.abs(span) / step));
    for (let i = 0; i <= steps; i++) pts.push(add(g.c, { x: r * Math.cos(a0 + (span * i) / steps), y: r * Math.sin(a0 + (span * i) / steps) }));
  }
  return pts;
}

function winding(poly: P[], q: P): number {
  let w = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (a.y <= q.y) { if (b.y > q.y && cross(sub(b, a), sub(q, a)) > 0) w++; }
    else if (b.y <= q.y && cross(sub(b, a), sub(q, a)) < 0) w--;
  }
  return w;
}

function* facePoints(g: Graph, face: number): Generator<P> {
  for (const hid of g.cycles[face].halves) {
    const h = g.halves[hid], e = g.edges[h.edge], pc: Piece = g.pieces[e.pieces[0]];
    const A = g.vertices[h.origin].f, B = g.vertices[h.target].f;
    let mid: P, dir: P;
    if (pc.geom.kind === 'line') {
      mid = mul(add(A, B), 0.5);
      dir = sub(B, A);
    } else {
      const c = pc.geom.c, r = Math.sqrt(Number(pc.geom.r2));
      const a0 = Math.atan2(A.y - c.y, A.x - c.x);
      let a1 = Math.atan2(B.y - c.y, B.x - c.x);
      if (h.forward) { if (a1 <= a0) a1 += 2 * Math.PI; } else if (a1 >= a0) a1 -= 2 * Math.PI;
      if (h.origin === h.target) a1 = a0 + (h.forward ? 2 * Math.PI : -2 * Math.PI);
      const am = (a0 + a1) / 2;
      mid = { x: c.x + r * Math.cos(am), y: c.y + r * Math.sin(am) };
      dir = h.forward ? { x: -Math.sin(am), y: Math.cos(am) } : { x: Math.sin(am), y: -Math.cos(am) };
    }
    const l = len(dir);
    if (l < 1e-12) continue;
    // deepest first: the fill's point (and the colour test) should sit well inside the face
    for (const eps of [0.5, 0.25, 0.1, 0.04, 0.02, 0.005]) yield { x: mid.x + (-dir.y / l) * eps, y: mid.y + (dir.x / l) * eps };
  }
}

/** A point just inside a face (left of one of its half-edges), checked exactly with the graph. */
function pointInFace(g: Graph, face: number): RPt | null {
  const dy = (v: number) => new Q(BigInt(Math.round(v * 4096)), 4096n);
  for (const p of facePoints(g, face)) {
    const q = { x: dy(p.x), y: dy(p.y) };
    if (g.locate(q) === face) return q;
  }
  return null;
}

export interface ImportResult {
  project: Project;
  deviationPct: number; // worst deviation, % of the drawing size
  bend: number; // worst extra corner bend, degrees
  curves: number;
  skipped: number; // outlines too small or thin to close at this grid size
  reference: { src: string; x: number; y: number; w: number };
}

/** Convert SVG text into a project of grid guides and fills, w × h grid. */
export function importSvg(text: string, w: number, h: number): ImportResult {
  const { shapes, svg, width } = readSvg(text);
  if (!shapes.length) throw new Error('SVG 裡沒有填色的圖形（只支援填色，不支援只有描邊的線條）');
  // normalise: the drawing's bounding box, longest side = 1
  const all = shapes.flatMap((sh) => sh.subpaths.flatMap((sp) => sp.flatMap((s) => [0, 0.25, 0.5, 0.75, 1].map(s))));
  const x0 = Math.min(...all.map((p) => p.x)), y0 = Math.min(...all.map((p) => p.y));
  const size = Math.max(Math.max(...all.map((p) => p.x)) - x0, Math.max(...all.map((p) => p.y)) - y0);
  if (!(size > 0)) throw new Error('SVG 的圖形大小是 0');
  const norm = (s: Seg): Seg => (t) => { const p = s(t); return { x: (p.x - x0) / size, y: (p.y - y0) / size }; };
  const outlines: { prims: Prim[]; shape: number }[] = [];
  shapes.forEach((sh, si) => sh.subpaths.forEach((sp) => {
    const prims = primitives(sp.map(norm));
    if (prims.length) outlines.push({ prims, shape: si });
  }));
  const bw = (Math.max(...all.map((p) => p.x)) - x0) / size, bh = (Math.max(...all.map((p) => p.y)) - y0) / size;
  const N = Math.min(w, h);
  // try strict first, then allow more candidates and a little more bend
  const fit = fitGrid(outlines.map((o) => o.prims), N, bw, bh, 16, MAX_BEND);
  // outlines that did not close: retry just those, at the same placement, with more choices and more bend
  if (fit && fit.failed) {
    for (const [K, bend] of [[30, MAX_BEND], [30, 25]] as const) {
      fit.geoms.forEach((g, i) => {
        if (g) return;
        const r = chainFor(outlines[i].prims, fit.scale, fit.off, N, K, bend);
        if (r) {
          fit.geoms[i] = r.geoms;
          fit.failed--;
          fit.err = Math.max(fit.err, r.cost);
          fit.bend = Math.max(fit.bend, r.bend);
        }
      });
      if (!fit.failed) break;
    }
  }
  if (!fit || fit.failed === outlines.length) throw new Error('在這個格數下沒有任何外框能轉換，請試更高的格數');
  const { scale, off, geoms } = fit;
  const centre = { x: (w - N) / 2, y: (h - N) / 2 };
  const shift = (p: P) => add(p, centre);

  // curves: every grid curve once, all as guides
  const style = { width: 1, cap: 'round' as const, join: 'round' as const, miterLimit: 4 };
  const curves: Curve[] = [];
  const seen = new Set<string>();
  // a line in the project is a segment between its two grid points: stretch it along itself (by whole
  // multiples of its grid step, so the ends stay on grid points) until it reaches both corners it forms
  const stretched = new Map<Geom, Geom>();
  outlines.forEach((o, i) => {
    const gs = geoms[i];
    if (!gs || gs.length < 2) return;
    const n = gs.length, T = (q: P) => add(mul(q, scale), off);
    const X = gs.map((g, j) => meet(g, gs[(j + 1) % n], T(o.prims[j].z[o.prims[j].z.length - 1])));
    gs.forEach((g, j) => {
      if (g.kind !== 'line') return;
      const ends = [X[(j - 1 + n) % n], X[j]].filter((x): x is P => !!x);
      const v = sub(g.b, g.a), vv = dot(v, v);
      const ts = ends.map((x) => dot(sub(x, g.a), v) / vv);
      const k1 = Math.min(0, Math.floor(Math.min(...ts) - 0.01)), k2 = Math.max(1, Math.ceil(Math.max(...ts) + 0.01));
      stretched.set(g, { kind: 'line', a: add(g.a, mul(v, k1)), b: add(g.a, mul(v, k2)) });
    });
  });
  for (const g0 of geoms.flatMap((x) => x ?? [])) {
    const g = stretched.get(g0) ?? g0;
    if (g.kind === 'arc') {
      const c = shift(g.c), ab = twoSquares(g.k)!;
      const key = `c${c.x},${c.y},${g.k}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // pick the representation of the circle's grid point that stays in reach
      const opts = [[ab[0], ab[1]], [-ab[0], ab[1]], [ab[0], -ab[1]], [-ab[0], -ab[1]], [ab[1], ab[0]], [-ab[1], ab[0]], [ab[1], -ab[0]], [-ab[1], -ab[0]]];
      const pick = opts.map(([a, b]) => ({ x: c.x + a, y: c.y + b })).find((q) => q.x >= -w && q.y >= -h && q.x <= 2 * w && q.y <= 2 * h)!;
      curves.push({ id: newId(), kind: 'circle', c, p: pick, guide: true, style });
    } else {
      const a = shift(g.a), b = shift(g.b);
      const key = `l${a.x},${a.y},${b.x},${b.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      curves.push({ id: newId(), kind: 'line', a, b, guide: true, style });
    }
  }
  const project = newProject(w, h);
  project.curves = curves;

  // fills: each face of the exact graph takes the colour of the top-most rebuilt shape around it
  const polys = outlines.flatMap((o, i) => (geoms[i] ? [{ shape: o.shape, poly: rebuildPolygon(o.prims, geoms[i]!, scale, off).map(shift) }] : []));
  const g = new Graph(curves);
  const colorAt = (fq: P): string | null => {
    let color: string | null = null;
    shapes.forEach((sh, si) => {
      let wsum = 0;
      for (const p of polys) if (p.shape === si) wsum += winding(p.poly, fq);
      if (sh.evenodd ? wsum % 2 !== 0 : wsum !== 0) color = sh.color;
    });
    return color;
  };
  for (const face of g.faces) {
    // cheap float check first: most faces lie outside the drawing and get no fill. Several probe
    // points, because one of them may slip into a neighbour when the face is a thin sliver.
    let maybe = false, k = 0;
    for (const p of facePoints(g, face)) {
      if (colorAt(p)) { maybe = true; break; }
      if (++k >= 12) break;
    }
    if (!maybe) continue;
    const q = pointInFace(g, face);
    if (!q) continue;
    const fq = { x: q.x.toNumber(), y: q.y.toNumber() };
    let color: string | null = null;
    shapes.forEach((sh, si) => {
      let wsum = 0;
      for (const p of polys) if (p.shape === si) wsum += winding(p.poly, fq);
      if (sh.evenodd ? wsum % 2 !== 0 : wsum !== 0) color = sh.color;
    });
    if (color) project.fills.push({ id: newId(), point: { x: q.x.toString(), y: q.y.toString() }, color });
  }

  // the original drawing as a tracing reference, lined up with the result
  const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  const reference = { src, x: centre.x + off.x - (x0 / size) * scale, y: centre.y + off.y - (y0 / size) * scale, w: (width / size) * scale };
  return { project, deviationPct: (100 * fit.err) / N, bend: fit.bend, curves: curves.length, skipped: fit.failed, reference };
}
