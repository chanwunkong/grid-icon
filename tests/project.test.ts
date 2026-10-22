import { describe, expect, it } from 'vitest';
import { newProject, parseProject, serialize } from '../src/model/project';
import { DEFAULT_STYLE } from '../src/model/types';

describe('project files', () => {
  it('round-trips through JSON', () => {
    const p = newProject(24, 24);
    p.curves.push({ id: 'a', kind: 'circle', c: { x: 12, y: 12 }, p: { x: 15, y: 16 }, guide: false, style: DEFAULT_STYLE });
    p.curves.push({ id: 'b', kind: 'line', a: { x: 0, y: 12 }, b: { x: 24, y: 12 }, guide: true, style: DEFAULT_STYLE });
    expect(parseProject(serialize(p))).toEqual(p);
  });
  it('rejects non-integer coordinates', () => {
    const bad = { version: 1, grid: { w: 24, h: 24 }, curves: [{ kind: 'line', a: { x: 1.5, y: 0 }, b: { x: 3, y: 3 }, style: DEFAULT_STYLE }] };
    expect(() => parseProject(JSON.stringify(bad))).toThrow('格點');
  });
  it('rejects curve kinds other than line and circle', () => {
    const bad = { version: 1, grid: { w: 24, h: 24 }, curves: [{ kind: 'arc', c: { x: 0, y: 0 }, start: { x: 5, y: 0 }, end: { x: 4, y: 3 }, style: DEFAULT_STYLE }] };
    expect(() => parseProject(JSON.stringify(bad))).toThrow('類型不支援');
  });
  it('rejects a circle with zero radius', () => {
    const bad = { version: 1, grid: { w: 24, h: 24 }, curves: [{ kind: 'circle', c: { x: 3, y: 3 }, p: { x: 3, y: 3 }, style: DEFAULT_STYLE }] };
    expect(() => parseProject(JSON.stringify(bad))).toThrow('半徑');
  });
  it('accepts anchor points up to one canvas size outside, rejects farther ones', () => {
    const mk = (x: number) => JSON.stringify({ version: 1, grid: { w: 8, h: 8 }, curves: [{ kind: 'line', a: { x: 0, y: 0 }, b: { x, y: 0 }, style: DEFAULT_STYLE }] });
    expect(parseProject(mk(16)).curves).toHaveLength(1);
    expect(parseProject(mk(-8)).curves).toHaveLength(1);
    expect(() => parseProject(mk(17))).toThrow('範圍');
    expect(() => parseProject(mk(-9))).toThrow('範圍');
  });
  it('keeps deleted pieces and fills with exact coordinates', () => {
    const p = newProject(24, 24);
    p.curves.push({ id: 'c', kind: 'circle', c: { x: 12, y: 12 }, p: { x: 17, y: 12 }, guide: false, style: DEFAULT_STYLE });
    p.erased.push({ curve: 'c', a: { x: '7', y: '12' }, b: { x: '17', y: '12' } });
    p.fills.push({ id: 'f', point: { x: '12', y: '25/2' }, color: '#ff0000' });
    expect(parseProject(serialize(p))).toEqual(p);
    const bad = JSON.parse(serialize(p));
    bad.fills[0].point.x = 'abc';
    expect(() => parseProject(JSON.stringify(bad))).toThrow('座標格式');
  });
});
