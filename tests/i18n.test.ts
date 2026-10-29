import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n-en';

// every source file as text (Vite feature, works in the test runner without Node typings)
const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.entries(sources).filter(([p]) => !p.endsWith('/i18n.ts') && !p.endsWith('/i18n-en.ts'));

/** Every t('…') key used in the source. */
const used = [...new Set(files.flatMap(([, text]) => [...text.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1])))];

describe('English interface', () => {
  it('has a translation for every interface string', () => {
    expect(used.filter((k) => !(k in en))).toEqual([]);
  });

  it('keeps the same {placeholders} in each translation', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    expect(used.filter((k) => k in en && ph(k) !== ph(en[k]))).toEqual([]);
  });

  it('has no Chinese text left outside t(…)', () => {
    const left: string[] = [];
    for (const [path, text] of files)
      text.split('\n').forEach((line, i) => {
        if (/^\s*\*/.test(line) || line.includes('i18n-ignore')) return;
        const code = line.replace(/\/\/.*$/, '').replace(/\bt\('(?:[^'\\]|\\.)*'/g, '');
        if (/[一-鿿]/.test(code)) left.push(`${path}:${i + 1}`);
      });
    expect(left).toEqual([]);
  });
});
