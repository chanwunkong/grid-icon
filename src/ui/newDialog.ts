import type { Editor } from '../editor/editor';
import { Graph } from '../exact/graph';
import { Q } from '../exact/rational';
import { EXAMPLES } from '../examples';
import { renderPNG } from '../export/export';
import { importSvg } from '../import/svgImport';
import { MAX_GRID, MIN_GRID, newProject } from '../model/project';
import type { Project } from '../model/types';
import { t } from '../i18n';
import { h, pickFile } from './dom';

const PRESETS = [16, 24, 32, 48, 64, 128];

function thumbnail(p: Project): HTMLCanvasElement {
  const g = new Graph(p.curves, p.erased);
  const faceColors = new Map<number, string>();
  for (const f of p.fills) {
    const face = g.locate({ x: Q.parse(f.point.x), y: Q.parse(f.point.y) });
    if (face !== null) faceColors.set(face, f.color);
  }
  return renderPNG(p, g, faceColors, { transparent: true, background: '#ffffff', margin: 0, outline: false, crop: true }, 96);
}

/** The new-project dialog: canvas size, built-in examples, or an SVG to convert. */
export function newDialog(editor: Editor) {
  const dlg = h('dialog', { class: 'new-dialog' }) as HTMLDialogElement;
  const wIn = h('input', { type: 'number', min: String(MIN_GRID), max: String(MAX_GRID), step: '1', value: '24' }) as HTMLInputElement;
  const hIn = h('input', { type: 'number', min: String(MIN_GRID), max: String(MAX_GRID), step: '1', value: '24' }) as HTMLInputElement;
  const presets = h('div', { class: 'presets' });
  for (const n of PRESETS) {
    const b = h('button', { type: 'button' }, `${n}×${n}`);
    b.onclick = () => { wIn.value = hIn.value = String(n); };
    presets.append(b);
  }
  const btnSvg = h('button', { type: 'button' }, t('從 SVG 匯入…'));
  const examples = h('div', { class: 'examples' });
  const err = h('div', { class: 'error' });
  const btnCancel = h('button', { type: 'button' }, t('取消')), btnOk = h('button', { type: 'button', class: 'primary' }, t('建立'));
  dlg.append(
    h('h2', {}, t('新專案')),
    h('p', { class: 'note' }, t('設定畫布的格數。建立後就不能再改；需要更精細的定位，請選較高的格數。')),
    presets,
    h('div', { class: 'field' }, h('label', {}, t('寬（格）')), wIn),
    h('div', { class: 'field' }, h('label', {}, t('高（格）')), hIn),
    h('div', { class: 'section-title', style: 'margin-top:14px' }, t('或打開範例')),
    examples,
    h('div', { class: 'section-title', style: 'margin-top:14px' }, t('或從 SVG 匯入')),
    h('p', { class: 'note' }, t('把 SVG 的填色和描邊自動轉成格點上的圓和直線（全部是輔助線），各區域用原本的顏色填色，原圖會設成底圖方便比對。格數用上面的設定；換個格數重新匯入就能比較。')),
    h('div', { class: 'presets' }, btnSvg),
    err,
    h('div', { class: 'dialog-actions' }, btnCancel, btnOk),
  );
  document.body.append(dlg);

  const replaceOk = (msg: string) => !editor.project.curves.length || confirm(msg);
  // examples are drawn the first time the dialog opens
  let examplesDrawn = false;
  const drawExamples = () => {
    if (examplesDrawn) return;
    examplesDrawn = true;
    for (const ex of EXAMPLES) {
      const b = h('button', { type: 'button', class: 'example' }, thumbnail(ex.build()), h('span', {}, ex.name()));
      b.onclick = () => {
        if (!replaceOk(t('開新專案會清掉目前的畫布（請先儲存），確定嗎？'))) return;
        dlg.close();
        editor.setProject(ex.build());
      };
      examples.append(b);
    }
  };

  const size = (): [number, number] | null => {
    const w = Number(wIn.value), hh = Number(hIn.value);
    const ok = (n: number) => Number.isInteger(n) && n >= MIN_GRID && n <= MAX_GRID;
    if (ok(w) && ok(hh)) return [w, hh];
    err.textContent = t('寬和高都要是 {min}–{max} 的整數', { min: MIN_GRID, max: MAX_GRID });
    return null;
  };
  dlg.addEventListener('cancel', (e) => { if (btnCancel.hidden) e.preventDefault(); });
  btnCancel.onclick = () => dlg.close();
  btnOk.onclick = () => {
    const s = size();
    if (!s) return;
    dlg.close();
    editor.setProject(newProject(...s));
  };
  btnSvg.onclick = () => {
    const s = size();
    if (!s) return;
    const [w, hh] = s;
    pickFile('.svg,image/svg+xml', async (file) => {
      if (!replaceOk(t('匯入會取代目前的畫布（請先儲存），確定嗎？'))) return;
      err.textContent = t('轉換中…（大的圖形或高格數可能要幾秒）');
      btnSvg.disabled = true;
      await new Promise((r) => setTimeout(r, 30)); // let the message paint first
      try {
        const res = importSvg(await file.text(), w, hh);
        dlg.close();
        editor.setProject(res.project);
        await editor.setReferenceImage(res.reference.src);
        editor.updateReference({ x: res.reference.x, y: res.reference.y, w: res.reference.w, opacity: 0.35 });
        alert(t('已匯入 {w}×{h} 格：{curves} 條輔助線、{fills} 個填色區域。', { w, h: hh, curves: res.curves, fills: res.project.fills.length }) + '\n' +
          t('和原圖的最大偏差：{dev}%（圖形大小的百分比）；轉角最多多彎 {bend}°。', { dev: res.deviationPct.toFixed(2), bend: res.bend.toFixed(1) }) + '\n' +
          (res.skipped ? t('有 {n} 個外框太小或太細，在這個格數下無法封閉，已略過（試更高的格數）。', { n: res.skipped }) + '\n' : '') +
          t('原圖已設成底圖（設定 → 底圖可以調透明度或隱藏）。'));
      } catch (e) {
        err.textContent = t('匯入失敗：{msg}', { msg: (e as Error).message });
      } finally {
        btnSvg.disabled = false;
      }
    });
  };

  return {
    open(cancellable: boolean) {
      err.textContent = '';
      btnCancel.hidden = !cancellable;
      drawExamples();
      dlg.showModal();
    },
  };
}
