import { Editor, type Tool } from '../editor/editor';
import { MAX_GRID, MIN_GRID, newProject, parseProject, serialize } from '../model/project';
import type { Cap, Curve, Join } from '../model/types';
import type { Keyline } from '../view/render';
import { r2 } from '../model/geometry';
import { importSvg } from '../import/svgImport';
import { DEFAULT_SIZES, download, overflow, pngBlob, renderPNG, renderSVG, zip, type ExportOptions } from '../export/export';
import { lang, setLang, t } from '../i18n';

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'line', label: t('直線'), key: 'L' },
  { id: 'circle', label: t('圓'), key: 'C' },
  { id: 'select', label: t('選取'), key: 'V' },
  { id: 'fill', label: t('填色'), key: 'B' },
];
const KEYLINES: { id: Keyline; label: string }[] = [
  { id: 'circle', label: t('圓') },
  { id: 'square', label: t('正方形') },
  { id: 'portrait', label: t('直式矩形') },
  { id: 'landscape', label: t('橫式矩形') },
];
const PRESETS = [16, 24, 32, 48, 64, 128];
// one choice styles both the free ends and the corners of a line
type Corner = 'round' | 'sharp' | 'bevel';
const CORNERS: { v: Corner; t: string; cap: Cap; join: Join; tip: string }[] = [
  { v: 'round', t: t('圓角'), cap: 'round', join: 'round', tip: t('線端半圓、轉角圓滑') },
  { v: 'sharp', t: t('尖角'), cap: 'square', join: 'miter', tip: t('線端方形（延伸半個線寬）、轉角尖角（超過 miter limit 改斜切）') },
  { v: 'bevel', t: t('斜切'), cap: 'butt', join: 'bevel', tip: t('線端平切（剛好停在格點）、轉角切掉尖角') },
];
const cornerOf = (j: Join): Corner => (j === 'round' ? 'round' : j === 'miter' ? 'sharp' : 'bevel');

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids);
  return el;
};

const fmtPt = (p: { x: number; y: number }) => `(${p.x}, ${p.y})`;

function describe(c: Curve): string {
  const kind = c.kind === 'line' ? (c.guide ? t('輔助線') : t('直線')) : (c.guide ? t('輔助圓') : t('圓'));
  if (c.kind === 'line') return `${kind} ${fmtPt(c.a)} → ${fmtPt(c.b)}`;
  return t('{kind} 圓心 {c}，經過 {p}，r² = {r2}', { kind, c: fmtPt(c.c), p: fmtPt(c.p), r2: r2(c.c, c.p) });
}

/** Read an image file as a data URL, scaled down so it fits in browser storage (long side ≤ 1600 px). */
async function imageForStorage(file: File): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
  if (file.type === 'image/svg+xml') return url; // vector: keep as is
  const img = new Image();
  img.src = url;
  await img.decode();
  const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  if (k === 1 && file.size < 1_500_000) return url;
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.naturalWidth * k);
  cv.height = Math.round(img.naturalHeight * k);
  cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/png');
}

export function mountApp(root: HTMLElement) {
  root.innerHTML = '';
  document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
  document.title = t('格點幾何 Icon');
  const canvas = h('canvas');
  const status = h('span'), zoomLabel = h('span'), cursorInfo = h('span');

  // ---- layout
  const topbar = h('header', { class: 'topbar' }, h('h1', {}, t('格點幾何 Icon')));
  const btnNew = h('button', {}, t('新專案')), btnOpen = h('button', {}, t('開啟')), btnSave = h('button', {}, t('儲存'));
  const btnUndo = h('button', { title: 'Ctrl+Z' }, t('復原')), btnRedo = h('button', { title: 'Ctrl+Shift+Z / Ctrl+Y' }, t('重做'));
  const btnSheet = h('button', { class: 'mobile-only' }, t('設定'));
  // language switch: shows the other language's name
  // desktop: in the top bar; phones: at the top of the settings sheet (the top bar has no room)
  const langButton = (cls: string) => {
    const b = h('button', { class: `lang-btn ${cls}`, title: lang === 'zh' ? 'English interface' : '中文介面' }, lang === 'zh' ? 'English' : '中文'); // i18n-ignore: each language's own name
    b.onclick = () => setLang(lang === 'zh' ? 'en' : 'zh');
    return b;
  };
  const btnLang = langButton('desktop-only');
  const gridInfo = h('span', { class: 'info' });
  topbar.append(btnNew, btnOpen, btnSave, h('span', { class: 'spacer' }), gridInfo, btnUndo, btnRedo, btnSheet, btnLang);

  // left column on desktop; on phones a bottom panel of rows that wrap (never scrolls sideways):
  // the main tools are always there, actions appear when they apply, the rest opens with 「更多」
  const tools = h('aside', { class: 'tools' }, h('div', { class: 'section-title' }, t('工具')));
  const extra = h('div', { class: 'extra' });
  const toolRow = h('div', { class: 'tool-row' });
  const toolButtons = new Map<Tool, HTMLButtonElement>();
  for (const t of TOOLS) {
    const b = h('button', { class: 'tool' }, h('span', {}, t.label), h('kbd', {}, t.key));
    toolButtons.set(t.id, b);
    toolRow.append(b);
  }
  const moreBtn = h('button', { class: 'mobile-only more-btn' }, t('更多'));
  toolRow.append(moreBtn);
  // shown when a piece is selected (phones have no Delete key)
  const mErase = h('button', {}, t('刪這段')), mDelete = h('button', {}, t('刪整條'));
  const selRow = h('div', { class: 'ctx-row mobile-only-flex' }, mErase, mDelete);
  // fill options: colour and "remove fill" mode (shown while the fill tool is active)
  const fillColor = h('input', { type: 'color', value: '#2f6bff', title: t('填色顏色') }) as HTMLInputElement;
  const fillErase = h('button', { title: t('改成移除填色') }, t('移除填色'));
  const fillBox = h('div', { class: 'fill-box ctx-row' }, fillColor, fillErase);
  // advanced: guide toggle, width, corner style, cancel
  const guideBtn = h('button', { class: 'tool', title: t('輔助線只用來切割、產生交點；虛線顯示，不會匯出（G）') }, h('span', {}, t('輔助線')), h('kbd', {}, 'G'));
  const wDec = h('button', { title: t('線寬 −1') }, '−'), wInc = h('button', { title: t('線寬 +1') }, '+');
  const wVal = h('span', { class: 'wval' });
  const widthStep = h('div', { class: 'width-step' }, h('span', { class: 'wlabel' }, t('線寬')), wDec, wVal, wInc);
  const cornerBtns = new Map<Corner, HTMLButtonElement>();
  const cornerSeg = h('div', { class: 'seg corner-seg' });
  for (const c of CORNERS) {
    const b = h('button', { title: c.tip }, c.t);
    cornerBtns.set(c.v, b);
    cornerSeg.append(b);
  }
  const mCancel = h('button', { class: 'mobile-only' }, t('取消'));
  const mRefAdjust = h('button', { class: 'mobile-only' }, t('調整底圖'));
  const more = h('div', { class: 'more' }, guideBtn, widthStep, h('div', { class: 'wlabel corner-label' }, t('線端與轉角')), cornerSeg, mRefAdjust, mCancel);
  tools.append(toolRow, selRow, fillBox, more, extra);
  const gridCheck = h('input', { type: 'checkbox' }) as HTMLInputElement;
  gridCheck.checked = true;
  extra.append(h('div', { class: 'section-title' }, t('顯示')), h('label', { class: 'check' }, gridCheck, t('格線')));
  extra.append(h('div', { class: 'section-title' }, t('Keyline 參考形狀')));
  const keylineChecks = new Map<Keyline, HTMLInputElement>();
  for (const k of KEYLINES) {
    const cb = h('input', { type: 'checkbox' }) as HTMLInputElement;
    keylineChecks.set(k.id, cb);
    extra.append(h('label', { class: 'check' }, cb, k.label));
  }
  const zIn = h('button', { title: t('放大') }, '+'), zOut = h('button', { title: t('縮小') }, '−'), zFit = h('button', { title: t('符合視窗（F）') }, t('符合'));
  extra.append(h('div', { class: 'section-title' }, t('縮放')), h('div', { class: 'zoom' }, zOut, zoomLabel, zIn, zFit));
  extra.append(h('p', { class: 'note desktop-only' }, t('滾輪縮放；按住空白鍵拖曳、或用滑鼠中鍵／右鍵拖曳來平移。')));
  extra.append(h('p', { class: 'note mobile-only' }, t('單指按住可以移動調整，放開才放下格點；雙指捏合縮放、拖曳平移。')));

  const recenter = h('button', { class: 'recenter', title: t('置中並調整到適合的大小（F）') }, t('⌖ 置中'));
  const stage = h('main', { class: 'stage' },
    h('div', { class: 'canvas-box' }, canvas, recenter),
    h('div', { class: 'status' }, status, cursorInfo));

  const props = h('aside', { class: 'props' });
  const sheetClose = h('button', { class: 'mobile-only sheet-close' }, t('完成'));
  const propsBody = h('div');
  props.append(sheetClose, langButton('mobile-only'), propsBody);
  const styleTitle = h('div', { class: 'section-title' });
  const widthIn = h('input', { type: 'number', min: '1', step: '1' }) as HTMLInputElement;
  const cornerSel = h('select') as HTMLSelectElement;
  for (const c of CORNERS) cornerSel.append(new Option(`${c.t}（${c.tip}）`, c.v));
  const miterIn = h('input', { type: 'number', min: '1', step: '0.5' }) as HTMLInputElement;
  // ---- export
  const exportBox = h('div');
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
    const after = items.indexOf(n) + 1 < items.length ? [...sizeList.children].find((el) => Number(el.textContent) === items[items.indexOf(n) + 1]) : null;
    if (after) sizeList.insertBefore(label, after); else sizeList.append(label);
  };
  for (const n of DEFAULT_SIZES) addSize(n, n === 24 || n === 48);
  const customIn = h('input', { type: 'number', min: '1', max: '4096', step: '1', placeholder: t('其他尺寸') }) as HTMLInputElement;
  const customAdd = h('button', {}, t('加入'));
  const transparentCb = h('input', { type: 'checkbox' }) as HTMLInputElement;
  transparentCb.checked = true;
  const bgIn = h('input', { type: 'color', value: '#ffffff' }) as HTMLInputElement;
  const marginIn = h('input', { type: 'number', min: '0', max: '64', step: '1', value: '0' }) as HTMLInputElement;
  const inkIn = h('input', { type: 'color', value: '#000000' }) as HTMLInputElement;
  const outlineCb = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const cropCb = h('input', { type: 'checkbox' }) as HTMLInputElement;
  cropCb.checked = true;
  const overflowNote = h('p', { class: 'warn' });
  const btnPng = h('button', { class: 'primary' }, t('下載 PNG')), btnSvg = h('button', {}, t('下載 SVG'));
  const preview = h('div', { class: 'preview-list' });
  exportBox.append(
    h('div', { class: 'section-title' }, t('匯出')),
    h('div', { class: 'note' }, t('PNG 尺寸（像素，長邊；可複選）')), sizeList,
    h('div', { class: 'tools-row' }, customIn, customAdd),
    h('label', { class: 'check' }, transparentCb, t('透明背景')),
    h('div', { class: 'field' }, h('label', {}, t('背景色')), bgIn),
    h('div', { class: 'field' }, h('label', {}, t('邊距（格）')), marginIn),
    h('div', { class: 'field' }, h('label', {}, t('線條顏色')), inkIn),
    h('label', { class: 'check' }, outlineCb, t('線條轉成輪廓並聯集（交會處無接縫，SVG 為純填色）')),
    h('label', { class: 'check' }, cropCb, t('裁切到畫布（取消時保留落在邊距裡的部分）')),
    overflowNote,
    h('div', { class: 'tools-row' }, btnPng, btnSvg),
    h('p', { class: 'note' }, t('選多個尺寸時打包成一個 zip。')),
    h('div', { class: 'section-title' }, t('匯出預覽（實際像素）')), preview,
  );

  // ---- reference image (tracing)
  const refBox = h('div');
  const btnRefLoad = h('button', {}, t('匯入底圖')), btnRefFit = h('button', {}, t('符合畫布')), btnRefRemove = h('button', {}, t('移除'));
  const btnRefAdjust = h('button', { title: t('開啟時，拖曳會移動底圖而不是畫線') }, t('調整底圖'));
  const refShow = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const refOpacity = h('input', { type: 'range', min: '0.05', max: '1', step: '0.05' }) as HTMLInputElement;
  const refW = h('input', { type: 'number', step: '0.1', min: '0.1' }) as HTMLInputElement;
  const refX = h('input', { type: 'number', step: '0.1' }) as HTMLInputElement;
  const refY = h('input', { type: 'number', step: '0.1' }) as HTMLInputElement;
  const refControls = h('div', {},
    h('label', { class: 'check' }, refShow, t('顯示底圖')),
    h('div', { class: 'field' }, h('label', {}, t('透明度')), refOpacity),
    h('div', { class: 'field' }, h('label', {}, t('寬度（格）')), refW),
    h('div', { class: 'field' }, h('label', {}, t('X（格）')), refX),
    h('div', { class: 'field' }, h('label', {}, t('Y（格）')), refY),
    h('div', { class: 'tools-row' }, btnRefAdjust, btnRefFit, btnRefRemove));
  refBox.append(h('div', { class: 'section-title' }, t('底圖（描圖用）')),
    h('div', { class: 'tools-row' }, btnRefLoad), refControls,
    h('p', { class: 'note' }, t('把參考圖片疊在畫布下面描圖。底圖不會匯出，也不會存進專案檔，只留在這個瀏覽器。')));

  const selBox = h('div');
  const selInfo = h('div', { class: 'coords' });
  const btnErase = h('button', { title: 'Delete' }, t('只刪這一段')), btnDelete = h('button', { title: 'Shift+Delete' }, t('刪除整條線'));
  const btnRestore = h('button', {}, t('恢復被刪的片段'));
  selBox.append(h('div', { class: 'section-title' }, t('選取的線段')), selInfo,
    h('div', { class: 'tools-row' }, btnErase, btnDelete), h('div', { class: 'tools-row' }, btnRestore),
    h('p', { class: 'note' }, t('「一段」是交點之間的部分。圓弧就是用線切開圓之後，刪掉不要的段做出來的。')));
  propsBody.append(
    styleTitle,
    h('div', { class: 'field' }, h('label', {}, t('線寬（格）')), widthIn),
    h('div', { class: 'field' }, h('label', {}, t('線端與轉角')), cornerSel),
    h('div', { class: 'field', id: 'miter-field' }, h('label', {}, 'Miter limit'), miterIn),
    h('p', { class: 'note' }, t('線的兩端和轉角用同一種樣式：圓角、尖角或斜切。')),
    selBox,
    refBox,
    h('div', { class: 'section-title' }, t('怎麼做出圓弧')),
    h('p', { class: 'note' }, t('先畫圓，再用直線或輔助線穿過它切開，然後用「選取」點不要的那一段，按「只刪這一段」。')),
    exportBox,
  );

  const layout = h('div', { class: 'layout' }, topbar, tools, stage, props);
  root.append(layout);

  // phones: the left column's settings live at the top of the slide-up sheet
  const phone = window.matchMedia('(max-width: 760px), (max-height: 500px)');
  const place = () => {
    if (phone.matches) propsBody.before(extra);
    else tools.append(extra);
    if (!phone.matches) layout.classList.remove('sheet-open');
  };
  phone.addEventListener('change', place);
  place();
  btnSheet.onclick = () => layout.classList.toggle('sheet-open');
  sheetClose.onclick = () => layout.classList.remove('sheet-open');

  // ---- new project dialog
  const dlg = h('dialog') as HTMLDialogElement;
  const wIn = h('input', { type: 'number', min: String(MIN_GRID), max: String(MAX_GRID), step: '1', value: '24' }) as HTMLInputElement;
  const hIn = h('input', { type: 'number', min: String(MIN_GRID), max: String(MAX_GRID), step: '1', value: '24' }) as HTMLInputElement;
  const presets = h('div', { class: 'presets' });
  for (const n of PRESETS) {
    const b = h('button', { type: 'button' }, `${n}×${n}`);
    b.onclick = () => { wIn.value = hIn.value = String(n); };
    presets.append(b);
  }
  const btnSvg2 = h('button', { type: 'button' }, t('從 SVG 匯入…'));
  const dlgErr = h('div', { class: 'error' });
  const dlgCancel = h('button', { type: 'button' }, t('取消')), dlgOk = h('button', { type: 'button', class: 'primary' }, t('建立'));
  dlg.append(
    h('h2', {}, t('新專案')),
    h('p', { class: 'note' }, t('設定畫布的格數。建立後就不能再改；需要更精細的定位，請選較高的格數。')),
    presets,
    h('div', { class: 'field' }, h('label', {}, t('寬（格）')), wIn),
    h('div', { class: 'field' }, h('label', {}, t('高（格）')), hIn),
    h('div', { class: 'section-title', style: 'margin-top:14px' }, t('或從 SVG 匯入')),
    h('p', { class: 'note' }, t('把填色的 SVG 自動轉成格點上的圓和直線（全部是輔助線），各區域用原本的顏色填色，原圖會設成底圖方便比對。格數用上面的設定；換個格數重新匯入就能比較。')),
    h('div', { class: 'presets' }, btnSvg2),
    dlgErr,
    h('div', { class: 'dialog-actions' }, dlgCancel, dlgOk),
  );
  document.body.append(dlg);

  // ---- editor
  let editor: Editor;
  const saved = Editor.loadAutosave();
  let initial = null;
  if (saved) {
    try {
      initial = parseProject(saved);
    } catch {
      initial = null;
    }
  }
  editor = new Editor(canvas, initial ?? newProject(24, 24));
  if (!initial) openNewDialog(false);

  function openNewDialog(cancellable: boolean) {
    dlgErr.textContent = '';
    dlgCancel.hidden = !cancellable;
    dlg.showModal();
  }
  dlg.addEventListener('cancel', (e) => { if (dlgCancel.hidden) e.preventDefault(); });
  dlgCancel.onclick = () => dlg.close();
  dlgOk.onclick = () => {
    const w = Number(wIn.value), hh = Number(hIn.value);
    const ok = (n: number) => Number.isInteger(n) && n >= MIN_GRID && n <= MAX_GRID;
    if (!ok(w) || !ok(hh)) {
      dlgErr.textContent = t('寬和高都要是 {min}–{max} 的整數', { min: MIN_GRID, max: MAX_GRID });
      return;
    }
    dlg.close();
    editor.setProject(newProject(w, hh));
  };

  btnSvg2.onclick = () => {
    const w = Number(wIn.value), hh = Number(hIn.value);
    const ok = (n: number) => Number.isInteger(n) && n >= MIN_GRID && n <= MAX_GRID;
    if (!ok(w) || !ok(hh)) { dlgErr.textContent = t('寬和高都要是 {min}–{max} 的整數', { min: MIN_GRID, max: MAX_GRID }); return; }
    const input = h('input', { type: 'file', accept: '.svg,image/svg+xml' }) as HTMLInputElement;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (editor.project.curves.length && !confirm(t('匯入會取代目前的畫布（請先儲存），確定嗎？'))) return;
      dlgErr.textContent = t('轉換中…（大的圖形或高格數可能要幾秒）');
      btnSvg2.disabled = true;
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
      } catch (err) {
        dlgErr.textContent = t('匯入失敗：{msg}', { msg: (err as Error).message });
      } finally {
        btnSvg2.disabled = false;
      }
    };
    input.click();
  };

  btnNew.onclick = () => {
    if (editor.project.curves.length && !confirm(t('開新專案會清掉目前的畫布（請先儲存），確定嗎？'))) return;
    openNewDialog(true);
  };
  btnSave.onclick = () => {
    const blob = new Blob([serialize(editor.project)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `icon-${editor.project.grid.w}x${editor.project.grid.h}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  btnOpen.onclick = () => {
    const input = h('input', { type: 'file', accept: '.json,application/json' }) as HTMLInputElement;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        editor.setProject(parseProject(await file.text()));
      } catch (err) {
        alert(t('無法開啟：{msg}', { msg: (err as Error).message }));
      }
    };
    input.click();
  };
  btnUndo.onclick = () => editor.undo();
  btnRedo.onclick = () => editor.redo();

  for (const [id, b] of toolButtons) b.onclick = () => editor.setTool(id);
  gridCheck.onchange = () => { editor.showGrid = gridCheck.checked; editor.redraw(); };
  for (const [id, cb] of keylineChecks)
    cb.onchange = () => { if (cb.checked) editor.keylines.add(id); else editor.keylines.delete(id); editor.redraw(); };
  zIn.onclick = () => editor.zoom(1.25);
  zOut.onclick = () => editor.zoom(0.8);
  zFit.onclick = () => { editor.fit(); refresh(); };
  recenter.onclick = () => { editor.fit(); refresh(); };
  // turning the phone changes the whole view: fit the drawing again once the layout has settled
  screen.orientation?.addEventListener('change', () => setTimeout(() => { editor.fit(); refresh(); }, 250));

  widthIn.onchange = () => {
    const v = Math.round(Number(widthIn.value));
    if (v >= 1) editor.setStyle({ width: v });
    else refresh();
  };
  const setCorner = (v: Corner) => {
    const c = CORNERS.find((x) => x.v === v)!;
    editor.setStyle({ cap: c.cap, join: c.join });
  };
  cornerSel.onchange = () => setCorner(cornerSel.value as Corner);
  for (const [v, b] of cornerBtns) b.onclick = () => setCorner(v);
  moreBtn.onclick = () => { more.classList.toggle('open'); moreBtn.classList.toggle('on', more.classList.contains('open')); };
  miterIn.onchange = () => {
    const v = Number(miterIn.value);
    if (v >= 1) editor.setStyle({ miterLimit: v });
    else refresh();
  };
  guideBtn.onclick = () => editor.toggleGuide();
  const exportOpts = (): ExportOptions => ({
    transparent: transparentCb.checked, background: bgIn.value,
    margin: Math.max(0, Math.round(Number(marginIn.value) || 0)), ink: inkIn.value,
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
  for (const el of [transparentCb, bgIn, marginIn, inkIn, outlineCb, cropCb]) el.addEventListener('input', schedulePreview);
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

  btnRefLoad.onclick = () => {
    const input = h('input', { type: 'file', accept: 'image/*' }) as HTMLInputElement;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await editor.setReferenceImage(await imageForStorage(file));
      } catch {
        alert(t('無法讀取這張圖片'));
      }
    };
    input.click();
  };
  btnRefFit.onclick = () => editor.fitReference();
  btnRefRemove.onclick = () => { if (confirm(t('移除底圖？'))) editor.removeReference(); };
  const toggleAdjust = () => { editor.adjustingReference = !editor.adjustingReference; refresh(); };
  btnRefAdjust.onclick = toggleAdjust;
  mRefAdjust.onclick = toggleAdjust;
  refShow.onchange = () => editor.updateReference({ visible: refShow.checked });
  refOpacity.oninput = () => editor.updateReference({ opacity: Number(refOpacity.value) });
  const num = (el: HTMLInputElement, key: 'w' | 'x' | 'y') => {
    el.onchange = () => {
      const v = Number(el.value);
      if (Number.isFinite(v) && (key !== 'w' || v > 0)) editor.updateReference({ [key]: v });
      else refresh();
    };
  };
  num(refW, 'w');
  num(refX, 'x');
  num(refY, 'y');

  btnDelete.onclick = () => editor.deleteSelected();
  btnErase.onclick = () => editor.erasePiece();
  btnRestore.onclick = () => editor.restorePieces();
  mErase.onclick = () => editor.erasePiece();
  fillColor.oninput = () => { editor.fillColor = fillColor.value; editor.fillErase = false; refresh(); };
  fillErase.onclick = () => { editor.fillErase = !editor.fillErase; refresh(); };
  const curWidth = () => (editor.selected?.style ?? editor.style).width;
  wDec.onclick = () => { if (curWidth() > 1) editor.setStyle({ width: curWidth() - 1 }); };
  wInc.onclick = () => editor.setStyle({ width: curWidth() + 1 });
  mCancel.onclick = () => editor.cancel();
  mDelete.onclick = () => editor.deleteSelected();

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const g = editor.vp.toGrid(e.clientX - r.left, e.clientY - r.top);
    const { w, h: gh } = editor.project.grid;
    cursorInfo.textContent = t('格點 ({x}, {y})', { x: Math.min(w, Math.max(0, Math.round(g.x))), y: Math.min(gh, Math.max(0, Math.round(g.y))) });
  });

  let lastExported: unknown = null;
  function refresh() {
    const sel = editor.selected;
    for (const [id, b] of toolButtons) b.classList.toggle('on', editor.tool === id);
    const st = sel?.style ?? editor.style;
    styleTitle.textContent = sel ? t('選取線段的樣式') : t('新線條的樣式');
    widthIn.value = String(st.width);
    wVal.textContent = t('{n} 格', { n: st.width });
    wDec.disabled = st.width <= 1;
    widthStep.title = sel ? t('調整選取線段的線寬') : t('調整接下來要畫的線寬');
    cornerSel.value = cornerOf(st.join);
    for (const [v, b] of cornerBtns) b.classList.toggle('on', v === cornerOf(st.join));
    miterIn.value = String(st.miterLimit);
    miterIn.closest('.field')!.toggleAttribute('hidden', st.join !== 'miter');
    guideBtn.classList.toggle('on', sel ? sel.guide : editor.guideMode);
    guideBtn.firstElementChild!.textContent = sel ? (sel.guide ? t('改回一般線') : t('改成輔助線')) : t('輔助線');
    selBox.hidden = !sel;
    selRow.hidden = !sel;
    const ref = editor.reference;
    refControls.hidden = !ref;
    btnRefLoad.textContent = ref ? t('換一張底圖') : t('匯入底圖');
    mRefAdjust.hidden = !ref;
    for (const b of [btnRefAdjust, mRefAdjust]) b.classList.toggle('on', editor.adjustingReference);
    if (ref) {
      refShow.checked = ref.visible;
      refOpacity.value = String(ref.opacity);
      const r1 = (v: number) => String(Math.round(v * 10) / 10);
      if (document.activeElement !== refW) refW.value = r1(ref.w);
      if (document.activeElement !== refX) refX.value = r1(ref.x);
      if (document.activeElement !== refY) refY.value = r1(ref.y);
    }
    mErase.disabled = editor.selectedPiece === null;
    btnErase.disabled = editor.selectedPiece === null;
    btnRestore.hidden = !editor.selectedHasErased;
    fillBox.hidden = editor.tool !== 'fill';
    fillErase.classList.toggle('on', editor.fillErase);
    selInfo.textContent = sel ? describe(sel) : '';
    btnUndo.disabled = !editor.history.canUndo;
    btnRedo.disabled = !editor.history.canRedo;
    gridInfo.textContent = t('畫布 {w}×{h} 格（已鎖定）・{n} 條線', { w: editor.project.grid.w, h: editor.project.grid.h, n: editor.project.curves.length });
    status.textContent = editor.hint;
    zoomLabel.textContent = `${Math.round(editor.vp.scale * 100 / 20)}%`;
    if (editor.project !== lastExported) {
      lastExported = editor.project;
      schedulePreview();
    }
    status.textContent = editor.hint + (editor.overflowing ? t('（有內容超出畫布，見匯出）') : '');
  }
  editor.onChange = refresh;
  editor.restoreReference();
  // development builds expose the editor for automated browser tests
  if (import.meta.env.DEV) (window as unknown as { __editor: Editor }).__editor = editor;
  refresh();
}
