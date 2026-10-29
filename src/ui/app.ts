import { Editor, type Tool } from '../editor/editor';
import { newProject, parseProject, serialize } from '../model/project';
import type { Cap, Curve, Join } from '../model/types';
import type { Keyline } from '../view/render';
import { r2 } from '../model/geometry';
import { lang, setLang, t } from '../i18n';
import { h, pickFile, stored } from './dom';
import { exportPanel } from './exportPanel';
import { newDialog } from './newDialog';
import { referencePanel } from './referencePanel';
import { tutorial } from './tutorial';

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
// one choice styles both the free ends and the corners of a line
type Corner = 'round' | 'sharp' | 'bevel';
const CORNERS: { v: Corner; t: string; cap: Cap; join: Join; tip: string }[] = [
  { v: 'round', t: t('圓角'), cap: 'round', join: 'round', tip: t('線端半圓、轉角圓滑') },
  { v: 'sharp', t: t('尖角'), cap: 'square', join: 'miter', tip: t('線端方形（延伸半個線寬）、轉角尖角（超過 miter limit 改斜切）') },
  { v: 'bevel', t: t('斜切'), cap: 'butt', join: 'bevel', tip: t('線端平切（剛好停在格點）、轉角切掉尖角') },
];
const cornerOf = (j: Join): Corner => (j === 'round' ? 'round' : j === 'miter' ? 'sharp' : 'bevel');

const fmtPt = (p: { x: number; y: number }) => `(${p.x}, ${p.y})`;

function describe(c: Curve): string {
  const kind = c.kind === 'line' ? (c.guide ? t('輔助線') : t('直線')) : (c.guide ? t('輔助圓') : t('圓'));
  if (c.kind === 'line') return `${kind} ${fmtPt(c.a)} → ${fmtPt(c.b)}`;
  return t('{kind} 圓心 {c}，經過 {p}，r² = {r2}', { kind, c: fmtPt(c.c), p: fmtPt(c.p), r2: r2(c.c, c.p) });
}

export function mountApp(root: HTMLElement) {
  root.innerHTML = '';
  document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
  document.title = t('格點幾何 Icon');
  const canvas = h('canvas');
  const canvasBox = h('div', { class: 'canvas-box' }, canvas); // the editor sizes the canvas to this box
  const saved = Editor.loadAutosave();
  let initial = null;
  if (saved) {
    try {
      initial = parseProject(saved);
    } catch {
      initial = null;
    }
  }
  const editor = new Editor(canvas, initial ?? newProject(24, 24));
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
  const mColorIn = h('input', { type: 'color', value: '#000000', title: t('線條顏色') }) as HTMLInputElement;
  const more = h('div', { class: 'more' }, guideBtn, widthStep, h('label', { class: 'color-step' }, h('span', { class: 'wlabel' }, t('顏色')), mColorIn), h('div', { class: 'wlabel corner-label' }, t('線端與轉角')), cornerSeg, mRefAdjust, mCancel);
  tools.append(toolRow, selRow, fillBox, more, extra);
  const gridCheck = h('input', { type: 'checkbox' }) as HTMLInputElement;
  gridCheck.checked = true;
  const magnetCheck = h('input', { type: 'checkbox', title: t('拖曳到線的端點、圓心或交點附近時自動對齊過去') }) as HTMLInputElement;
  magnetCheck.checked = editor.magnet = stored.get('grid-icon:magnet') !== 'off';
  magnetCheck.onchange = () => {
    editor.magnet = magnetCheck.checked;
    stored.set('grid-icon:magnet', magnetCheck.checked ? 'on' : 'off');
  };
  extra.append(h('div', { class: 'section-title' }, t('顯示')), h('label', { class: 'check' }, gridCheck, t('格線')),
    h('label', { class: 'check' }, magnetCheck, t('磁吸（靠近端點、圓心、交點時自動對齊）')));
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
  const btnTutorial = h('button', {}, t('再看一次教學'));
  extra.append(h('div', { class: 'tools-row' }, btnTutorial));

  const recenter = h('button', { class: 'recenter', title: t('置中並調整到適合的大小（F）') }, t('⌖ 置中'));
  canvasBox.append(recenter);
  const stage = h('main', { class: 'stage' },
    canvasBox,
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
  const colorIn = h('input', { type: 'color', value: '#000000' }) as HTMLInputElement;
  const exporter = exportPanel(editor);
  const toggleAdjust = () => { editor.adjustingReference = !editor.adjustingReference; refresh(); };
  const reference = referencePanel(editor, toggleAdjust);

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
    h('div', { class: 'field' }, h('label', {}, t('線條顏色')), colorIn),
    h('div', { class: 'field' }, h('label', {}, t('線端與轉角')), cornerSel),
    h('div', { class: 'field', id: 'miter-field' }, h('label', {}, 'Miter limit'), miterIn),
    h('p', { class: 'note' }, t('線的兩端和轉角用同一種樣式：圓角、尖角或斜切。')),
    selBox,
    reference.el,
    h('div', { class: 'section-title' }, t('怎麼做出圓弧')),
    h('p', { class: 'note' }, t('先畫圓，再用直線或輔助線穿過它切開，然後用「選取」點不要的那一段，按「只刪這一段」。')),
    exporter.el,
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

  const newDlg = newDialog(editor);
  const tour = tutorial();
  // first visit: the tutorial, then the new-project dialog (examples are there)
  if (tour.firstVisit) tour.open(initial ? undefined : () => newDlg.open(false));
  else if (!initial) newDlg.open(false);
  btnTutorial.onclick = () => tour.open();

  btnNew.onclick = () => {
    if (editor.project.curves.length && !confirm(t('開新專案會清掉目前的畫布（請先儲存），確定嗎？'))) return;
    newDlg.open(true);
  };
  btnSave.onclick = () => {
    const blob = new Blob([serialize(editor.project)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `icon-${editor.project.grid.w}x${editor.project.grid.h}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  btnOpen.onclick = () => pickFile('.json,application/json', async (file) => {
    try {
      editor.setProject(parseProject(await file.text()));
    } catch (err) {
      alert(t('無法開啟：{msg}', { msg: (err as Error).message }));
    }
  });
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
  // colour: preview while dragging the picker, record one undo step when it is closed
  for (const el of [colorIn, mColorIn]) el.onchange = () => editor.setStyle({ color: el.value });
  for (const [v, b] of cornerBtns) b.onclick = () => setCorner(v);
  moreBtn.onclick = () => { more.classList.toggle('open'); moreBtn.classList.toggle('on', more.classList.contains('open')); };
  miterIn.onchange = () => {
    const v = Number(miterIn.value);
    if (v >= 1) editor.setStyle({ miterLimit: v });
    else refresh();
  };
  guideBtn.onclick = () => editor.toggleGuide();
  mRefAdjust.onclick = toggleAdjust;
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
    if (document.activeElement !== colorIn) colorIn.value = st.color;
    if (document.activeElement !== mColorIn) mColorIn.value = st.color;
    for (const [v, b] of cornerBtns) b.classList.toggle('on', v === cornerOf(st.join));
    miterIn.value = String(st.miterLimit);
    miterIn.closest('.field')!.toggleAttribute('hidden', st.join !== 'miter');
    guideBtn.classList.toggle('on', sel ? sel.guide : editor.guideMode);
    guideBtn.firstElementChild!.textContent = sel ? (sel.guide ? t('改回一般線') : t('改成輔助線')) : t('輔助線');
    selBox.hidden = !sel;
    selRow.hidden = !sel;
    reference.refresh();
    mRefAdjust.hidden = !editor.reference;
    mRefAdjust.classList.toggle('on', editor.adjustingReference);
    mErase.disabled = editor.selectedPiece === null;
    btnErase.disabled = editor.selectedPiece === null;
    btnRestore.hidden = !editor.selectedHasErased;
    fillBox.hidden = editor.tool !== 'fill';
    fillErase.classList.toggle('on', editor.fillErase);
    selInfo.textContent = sel ? describe(sel) : '';
    btnUndo.disabled = !editor.history.canUndo;
    btnRedo.disabled = !editor.history.canRedo;
    gridInfo.textContent = t('畫布 {w}×{h} 格（已鎖定）・{n} 條線', { w: editor.project.grid.w, h: editor.project.grid.h, n: editor.project.curves.length });
    zoomLabel.textContent = `${Math.round(editor.vp.scale * 100 / 20)}%`;
    exporter.refresh();
    status.textContent = editor.hint + (editor.overflowing ? t('（有內容超出畫布，見匯出）') : '');
  }
  editor.onChange = refresh;
  editor.restoreReference();
  // development builds expose the editor for automated browser tests
  if (import.meta.env.DEV) (window as unknown as { __editor: Editor }).__editor = editor;
  refresh();
}
