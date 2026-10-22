import type { Cap, Curve, ErasedPiece, ExactPtJSON, Fill, Join, Project, Pt, Style } from './types';
import { Quad } from '../exact/quad';
import { samePt } from './geometry';

export const MIN_GRID = 2;
export const MAX_GRID = 512;

/** Anchor points may lie up to one canvas size outside the canvas on every side (export crops to the canvas). */
export const reach = (w: number, h: number) => ({ x0: -w, y0: -h, x1: 2 * w, y1: 2 * h });

export function newProject(w: number, h: number): Project {
  return { version: 1, grid: { w, h }, curves: [], erased: [], fills: [] };
}

let counter = 0;
export const newId = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function serialize(p: Project): string {
  return JSON.stringify(p, null, 2);
}

class LoadError extends Error {}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Parse and validate a project file; throws with a Chinese message when the file is not usable. */
export function parseProject(text: string): Project {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LoadError('不是有效的 JSON 檔案');
  }
  if (raw?.version !== 1) throw new LoadError('不支援的專案版本');
  const { w, h } = raw.grid ?? {};
  if (!isInt(w) || !isInt(h) || w < MIN_GRID || h < MIN_GRID || w > MAX_GRID || h > MAX_GRID)
    throw new LoadError('格數設定不正確');
  const pt = (v: any, what: string): Pt => {
    if (!v || !isInt(v.x) || !isInt(v.y) || v.x < -w || v.y < -h || v.x > 2 * w || v.y > 2 * h)
      throw new LoadError(`${what} 不是可用範圍內的格點`);
    return { x: v.x, y: v.y };
  };
  const style = (s: any): Style => {
    const caps: Cap[] = ['butt', 'round', 'square'];
    const joins: Join[] = ['miter', 'round', 'bevel'];
    if (!s || !isInt(s.width) || s.width < 1 || !caps.includes(s.cap) || !joins.includes(s.join)
      || typeof s.miterLimit !== 'number' || !(s.miterLimit >= 1))
      throw new LoadError('線條樣式不正確');
    return { width: s.width, cap: s.cap, join: s.join, miterLimit: s.miterLimit };
  };
  const curves: Curve[] = (raw.curves ?? []).map((c: any, i: number): Curve => {
    const id = typeof c?.id === 'string' ? c.id : newId();
    const where = `第 ${i + 1} 條線`;
    const guide = c?.guide === true;
    if (c?.kind === 'line') {
      const a = pt(c.a, where), b = pt(c.b, where);
      if (samePt(a, b)) throw new LoadError(`${where} 的兩端相同`);
      return { id, kind: 'line', a, b, guide, style: style(c.style) };
    }
    if (c?.kind === 'circle') {
      const cc = pt(c.c, where), p = pt(c.p, where);
      if (samePt(cc, p)) throw new LoadError(`${where} 的半徑是 0`);
      return { id, kind: 'circle', c: cc, p, guide, style: style(c.style) };
    }
    throw new LoadError(`${where} 的類型不支援`);
  });
  const exactPt = (v: any, what: string): ExactPtJSON => {
    try {
      Quad.parse(String(v?.x));
      Quad.parse(String(v?.y));
    } catch {
      throw new LoadError(`${what} 的座標格式不正確`);
    }
    return { x: String(v.x), y: String(v.y) };
  };
  const ids = new Set(curves.map((c) => c.id));
  const erased: ErasedPiece[] = (Array.isArray(raw.erased) ? raw.erased : [])
    .filter((e: any) => ids.has(e?.curve))
    .map((e: any, i: number) => ({ curve: e.curve, a: exactPt(e.a, `第 ${i + 1} 個刪除片段`), b: exactPt(e.b, `第 ${i + 1} 個刪除片段`) }));
  const fills: Fill[] = (Array.isArray(raw.fills) ? raw.fills : [])
    .filter((f: any) => f && typeof f.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(f.color))
    .map((f: any, i: number) => ({ id: typeof f.id === 'string' ? f.id : newId(), point: exactPt(f.point, `第 ${i + 1} 個填色`), color: f.color }));
  return { version: 1, grid: { w, h }, curves, erased, fills };
}
