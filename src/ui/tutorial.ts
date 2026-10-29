import { t } from '../i18n';
import { h, stored } from './dom';

const DONE_KEY = 'grid-icon:tutorial';

const steps = () => [
  { title: t('歡迎'), text: t('這個工具只用格點上的直線和圓來畫 icon。所有交點都是精確計算的，放大到多大都對得齊。') },
  { title: t('畫直線'), text: t('選「直線」，在起點按下，拖到終點再放開。手機上手指可以按住移動調整，放開才放下格點。') },
  { title: t('畫圓'), text: t('選「圓」，在圓心按下，拖到圓上的一個格點再放開。') },
  { title: t('做出圓弧'), text: t('用直線或輔助線穿過圓把它切開，再用「選取」點不要的那一段，按「刪這段」。線重疊的地方，同一點再點一次會換下一段。') },
  { title: t('填色'), text: t('選「填色」，點一個封閉區域。之後再切開這個區域，切出來的每一塊都保留顏色。') },
  { title: t('縮放與磁吸'), text: t('雙指捏合縮放、拖曳平移（電腦用滾輪）。拖到線的端點、圓心或交點附近會自動對齊過去；不想要的話可以在設定關掉「磁吸」。') },
  { title: t('匯出與範例'), text: t('完成後在設定（電腦在右側）下載 PNG 或 SVG。想先看看能做出什麼，可以在「新專案」打開範例。') },
];

/** A short step-by-step introduction, shown on the first visit and on request. */
export function tutorial() {
  const dlg = h('dialog', { class: 'tutorial' }) as HTMLDialogElement;
  const counter = h('div', { class: 'note' }), title = h('h2'), text = h('p');
  const prev = h('button', { type: 'button' }, t('上一步')), next = h('button', { type: 'button', class: 'primary', autofocus: '' }, t('下一步'));
  const skip = h('button', { type: 'button', class: 'link' }, t('略過'));
  dlg.append(counter, title, text, h('div', { class: 'dialog-actions' }, skip, h('span', { class: 'spacer' }), prev, next));
  document.body.append(dlg);
  let i = 0, onDone: (() => void) | null = null;
  const all = steps();
  const show = () => {
    counter.textContent = `${i + 1} / ${all.length}`;
    title.textContent = all[i].title;
    text.textContent = all[i].text;
    prev.disabled = i === 0;
    next.textContent = i === all.length - 1 ? t('開始') : t('下一步');
  };
  const finish = () => {
    stored.set(DONE_KEY, 'done');
    dlg.close();
  };
  dlg.addEventListener('close', () => {
    const cb = onDone;
    onDone = null;
    cb?.();
  });
  prev.onclick = () => { if (i > 0) { i--; show(); } };
  next.onclick = () => { if (i < all.length - 1) { i++; show(); } else finish(); };
  skip.onclick = finish;
  return {
    /** Whether this browser has not seen the tutorial yet. */
    get firstVisit() {
      return stored.get(DONE_KEY) !== 'done';
    },
    open(then?: () => void) {
      i = 0;
      onDone = then ?? null;
      show();
      dlg.showModal();
    },
  };
}
