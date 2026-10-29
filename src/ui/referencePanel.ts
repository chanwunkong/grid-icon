import type { Editor } from '../editor/editor';
import { t } from '../i18n';
import { h, pickFile } from './dom';

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

/** The reference image (for tracing): load, show, move and size it. */
export function referencePanel(editor: Editor, onToggleAdjust: () => void) {
  const el = h('div');
  const btnLoad = h('button', {}, t('匯入底圖')), btnFit = h('button', {}, t('符合畫布')), btnRemove = h('button', {}, t('移除'));
  const btnAdjust = h('button', { title: t('開啟時，拖曳會移動底圖而不是畫線') }, t('調整底圖'));
  const show = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const opacity = h('input', { type: 'range', min: '0.05', max: '1', step: '0.05' }) as HTMLInputElement;
  const refW = h('input', { type: 'number', step: '0.1', min: '0.1' }) as HTMLInputElement;
  const refX = h('input', { type: 'number', step: '0.1' }) as HTMLInputElement;
  const refY = h('input', { type: 'number', step: '0.1' }) as HTMLInputElement;
  const controls = h('div', {},
    h('label', { class: 'check' }, show, t('顯示底圖')),
    h('div', { class: 'field' }, h('label', {}, t('透明度')), opacity),
    h('div', { class: 'field' }, h('label', {}, t('寬度（格）')), refW),
    h('div', { class: 'field' }, h('label', {}, t('X（格）')), refX),
    h('div', { class: 'field' }, h('label', {}, t('Y（格）')), refY),
    h('div', { class: 'tools-row' }, btnAdjust, btnFit, btnRemove));
  el.append(h('div', { class: 'section-title' }, t('底圖（描圖用）')),
    h('div', { class: 'tools-row' }, btnLoad), controls,
    h('p', { class: 'note' }, t('把參考圖片疊在畫布下面描圖。底圖不會匯出，也不會存進專案檔，只留在這個瀏覽器。')));

  btnLoad.onclick = () => pickFile('image/*', async (file) => {
    try {
      await editor.setReferenceImage(await imageForStorage(file));
    } catch {
      alert(t('無法讀取這張圖片'));
    }
  });
  btnFit.onclick = () => editor.fitReference();
  btnRemove.onclick = () => { if (confirm(t('移除底圖？'))) editor.removeReference(); };
  btnAdjust.onclick = onToggleAdjust;
  show.onchange = () => editor.updateReference({ visible: show.checked });
  opacity.oninput = () => editor.updateReference({ opacity: Number(opacity.value) });
  const num = (input: HTMLInputElement, key: 'w' | 'x' | 'y') => {
    input.onchange = () => {
      const v = Number(input.value);
      if (Number.isFinite(v) && (key !== 'w' || v > 0)) editor.updateReference({ [key]: v });
      else refresh();
    };
  };
  num(refW, 'w');
  num(refX, 'x');
  num(refY, 'y');

  function refresh() {
    const ref = editor.reference;
    controls.hidden = !ref;
    btnLoad.textContent = ref ? t('換一張底圖') : t('匯入底圖');
    btnAdjust.classList.toggle('on', editor.adjustingReference);
    if (!ref) return;
    show.checked = ref.visible;
    opacity.value = String(ref.opacity);
    const r1 = (v: number) => String(Math.round(v * 10) / 10);
    if (document.activeElement !== refW) refW.value = r1(ref.w);
    if (document.activeElement !== refX) refX.value = r1(ref.x);
    if (document.activeElement !== refY) refY.value = r1(ref.y);
  }
  return { el, refresh };
}
