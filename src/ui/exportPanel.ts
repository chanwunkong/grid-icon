import type { Editor } from '../editor/editor';
import { DEFAULT_SIZES, download, overflow, pngBlob, renderPNG, renderSVG, zip, type ExportOptions } from '../export/export';
import { t } from '../i18n';
import { h } from './dom';

/** Export settings, preview and download buttons. */
export function exportPanel(editor: Editor) {
  const el = h('div');
  const sizeList = h('div', { class: 'size-list' });
  const sizeChecks = new Map<number, HTMLInputElement>();
  const addSize = (n: number, checked: boolean) => {
    if (sizeChecks.has(n)) { sizeChecks.get(n)!.checked = true; return; }
    const cb = h('input', { type: 'checkbox' }) as HTMLInputElement;
    cb.checked = checked;
    cb.onchange = () => schedulePreview();
    sizeChecks.set(n, cb);
    const items = [...sizeChecks.keys()].sort((a, b) => a - b);
    const label = h('label', { class: 'check' }, cb, `${n}`);
    const after = items.indexOf(n) + 1 < items.length ? [...sizeList.children].find((x) => Number(x.textContent) === items[items.indexOf(n) + 1]) : null;
    if (after) sizeList.insertBefore(label, after); else sizeList.append(label);
  };
  for (const n of DEFAULT_SIZES) addSize(n, n === 24 || n === 48);
  const customIn = h('input', { type: 'number', min: '1', max: '4096', step: '1', placeholder: t('其他尺寸') }) as HTMLInputElement;
  const customAdd = h('button', {}, t('加入'));
  const transparentCb = h('input', { type: 'checkbox' }) as HTMLInputElement;
  transparentCb.checked = true;
  const bgIn = h('input', { type: 'color', value: '#ffffff' }) as HTMLInputElement;
  const marginIn = h('input', { type: 'number', min: '0', max: '64', step: '1', value: '0' }) as HTMLInputElement;
  const outlineCb = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const cropCb = h('input', { type: 'checkbox' }) as HTMLInputElement;
  cropCb.checked = true;
  const overflowNote = h('p', { class: 'warn' });
  const btnPng = h('button', { class: 'primary' }, t('下載 PNG')), btnSvg = h('button', {}, t('下載 SVG'));
  const preview = h('div', { class: 'preview-list' });
  el.append(
    h('div', { class: 'section-title' }, t('匯出')),
    h('div', { class: 'note' }, t('PNG 尺寸（像素，長邊；可複選）')), sizeList,
    h('div', { class: 'tools-row' }, customIn, customAdd),
    h('label', { class: 'check' }, transparentCb, t('透明背景')),
    h('div', { class: 'field' }, h('label', {}, t('背景色')), bgIn),
    h('div', { class: 'field' }, h('label', {}, t('邊距（格）')), marginIn),
    h('label', { class: 'check' }, outlineCb, t('線條轉成輪廓並聯集（交會處無接縫，SVG 為純填色）')),
    h('label', { class: 'check' }, cropCb, t('裁切到畫布（取消時保留落在邊距裡的部分）')),
    overflowNote,
    h('div', { class: 'tools-row' }, btnPng, btnSvg),
    h('p', { class: 'note' }, t('選多個尺寸時打包成一個 zip。')),
    h('div', { class: 'section-title' }, t('匯出預覽（實際像素）')), preview,
  );

  const exportOpts = (): ExportOptions => ({
    transparent: transparentCb.checked, background: bgIn.value,
    margin: Math.max(0, Math.round(Number(marginIn.value) || 0)),
    outline: outlineCb.checked, crop: cropCb.checked,
  });
  function updateOverflow() {
    const o = overflow(editor.project, editor.graph, editor.faceColors);
    editor.overflowing = !!o;
    editor.redraw();
    if (!o) { overflowNote.textContent = ''; overflowNote.hidden = true; return; }
    const f = (n: number) => (Math.round(n * 100) / 100).toString();
    const sides = [[t('左'), o.left], [t('右'), o.right], [t('上'), o.top], [t('下'), o.bottom]].filter(([, v]) => (v as number) > 1e-6)
      .map(([k, v]) => t('{side} {n} 格', { side: k as string, n: f(v as number) })).join(t('、'));
    const opts = exportOpts();
    overflowNote.hidden = false;
    overflowNote.textContent = t('線條（含線端、轉角）或填色超出畫布：{sides}。', { sides }) + (opts.crop
      ? t('匯出時會被裁掉；要保留的話，取消「裁切到畫布」並把邊距設為至少 {n} 格。', { n: o.margin })
      : opts.margin >= o.margin ? t('目前的邊距放得下。') : t('邊距至少要 {n} 格才放得下，現在會被圖片邊緣切掉。', { n: o.margin }));
  }
  const chosenSizes = () => [...sizeChecks].filter(([, cb]) => cb.checked).map(([n]) => n).sort((a, b) => a - b);
  let previewTimer = 0;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      updateOverflow();
      preview.innerHTML = '';
      for (const n of chosenSizes()) {
        const cv = renderPNG(editor.project, editor.graph, editor.faceColors, exportOpts(), n);
        cv.className = 'preview-img';
        const { width, height } = cv;
        cv.style.width = `${Math.min(width, 128)}px`;
        cv.style.height = `${(Math.min(width, 128) * height) / width}px`;
        preview.append(h('figure', {}, cv, h('figcaption', {}, `${width}×${height}`)));
      }
      if (!preview.children.length) preview.append(h('p', { class: 'note' }, t('先勾選尺寸')));
    }, 250);
  }
  for (const x of [transparentCb, bgIn, marginIn, outlineCb, cropCb]) x.addEventListener('input', schedulePreview);
  customAdd.onclick = () => {
    const n = Math.round(Number(customIn.value));
    if (!(n >= 1 && n <= 4096)) return alert(t('請輸入 1–4096 的整數'));
    addSize(n, true);
    customIn.value = '';
    schedulePreview();
  };
  btnPng.onclick = async () => {
    const sizes = chosenSizes();
    if (!sizes.length) return alert(t('請先勾選要匯出的尺寸'));
    const files = await Promise.all(sizes.map(async (n) => {
      const blob = await pngBlob(renderPNG(editor.project, editor.graph, editor.faceColors, exportOpts(), n));
      return { name: `icon-${n}.png`, data: new Uint8Array(await blob.arrayBuffer()), blob };
    }));
    if (files.length === 1) download(files[0].blob, files[0].name);
    else download(zip(files), `icon-${sizes.join('-')}.zip`);
  };
  btnSvg.onclick = () => {
    const svg = renderSVG(editor.project, editor.graph, editor.faceColors, exportOpts());
    download(new Blob([svg], { type: 'image/svg+xml' }), 'icon.svg');
  };

  let lastExported: unknown = null;
  return {
    el,
    /** Re-render the preview when the drawing changed. */
    refresh() {
      if (editor.project === lastExported) return;
      lastExported = editor.project;
      schedulePreview();
    },
  };
}
