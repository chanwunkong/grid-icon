// Interface language. The Chinese text is the key; `en` holds its English translation.
// t('畫布 {w}×{h} 格', { w: 24, h: 24 }) fills in {placeholders} after translating.
import { en } from './i18n-en';

export type Lang = 'zh' | 'en';

const LANG_KEY = 'grid-icon:lang';

function detect(): Lang {
  if (import.meta.env?.MODE === 'test') return 'zh'; // unit tests check the Chinese messages
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    /* storage unavailable: fall back to the browser language */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export const lang: Lang = detect();

export function t(zh: string, params?: Record<string, string | number>): string {
  let s = lang === 'en' ? en[zh] ?? zh : zh;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Switch language and reload (the drawing and the reference image are kept in this browser). */
export function setLang(next: Lang) {
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    /* without storage the choice only lasts until the reload */
  }
  location.reload();
}
