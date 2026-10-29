import { expect, test } from '@playwright/test';
import { click, drag, newBlank, openApp, project } from './helpers';

test('first visit: the tutorial, then the new-project dialog with the examples', async ({ page }) => {
  await openApp(page, { tutorialSeen: false });
  const tour = page.locator('dialog.tutorial');
  await expect(tour).toBeVisible();
  await expect(tour).toContainText('1 / 7');
  for (let i = 0; i < 6; i++) await tour.getByRole('button', { name: '下一步' }).click();
  await expect(tour).toContainText('匯出與範例');
  await tour.getByRole('button', { name: '開始' }).click();
  await expect(tour).toBeHidden();
  const dlg = page.locator('dialog.new-dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.example')).toHaveCount(7);
  // the tutorial is not shown again
  await page.reload();
  await expect(page.locator('dialog.tutorial')).toBeHidden();
});

test('opening an example', async ({ page }) => {
  await openApp(page);
  await page.locator('dialog.new-dialog .example', { hasText: '愛心' }).click();
  const p = await project(page);
  expect(p.curves).toHaveLength(4);
  expect(p.fills.length).toBeGreaterThan(0);
});

test('draw a line and a circle, undo and redo', async ({ page }) => {
  await openApp(page);
  await newBlank(page);
  await drag(page, [4, 4], [20, 4]);
  await page.getByRole('button', { name: /^圓/ }).first().click();
  await drag(page, [12, 12], [12, 6]);
  let p = await project(page);
  expect(p.curves.map((c: any) => c.kind)).toEqual(['line', 'circle']);
  expect(p.curves[0]).toMatchObject({ a: { x: 4, y: 4 }, b: { x: 20, y: 4 } });
  await page.getByRole('button', { name: '復原' }).click();
  expect((await project(page)).curves).toHaveLength(1);
  await page.getByRole('button', { name: '重做' }).click();
  p = await project(page);
  expect(p.curves).toHaveLength(2);
});

test('magnet pulls a drag onto a nearby end point', async ({ page }) => {
  await openApp(page);
  await newBlank(page);
  await drag(page, [5, 5], [17, 9]);
  const snapAt = (x: number, y: number) => page.evaluate(([gx, gy]) => {
    const ed = (window as any).__editor;
    const s = ed.vp.toScreen(gx, gy);
    return ed.snap(s.x, s.y, false);
  }, [x, y]);
  // zoomed out so that 0.6 grid is a few pixels: rounding alone would land on (17, 8)
  await page.evaluate(() => { const ed = (window as any).__editor; ed.vp.scale = 10; ed.redraw(); });
  expect(await snapAt(17.2, 8.4)).toEqual({ x: 17, y: 9 });
  await page.evaluate(() => { (window as any).__editor.magnet = false; });
  expect(await snapAt(17.2, 8.4)).toEqual({ x: 17, y: 8 });
});

test('a filled region keeps its colour in every piece after it is cut', async ({ page }) => {
  await openApp(page);
  await newBlank(page);
  await page.getByRole('button', { name: /^圓/ }).first().click();
  await drag(page, [12, 12], [12, 4]);
  await page.getByRole('button', { name: /^填色/ }).first().click();
  await click(page, 12.3, 12.3);
  expect((await project(page)).fills).toHaveLength(1);
  await page.getByRole('button', { name: /^直線/ }).first().click();
  await drag(page, [2, 12], [22, 12]);
  const p = await project(page);
  expect(p.fills).toHaveLength(2);
  expect(new Set(p.fills.map((f: any) => f.color)).size).toBe(1);
});

test('each curve has its own colour', async ({ page }) => {
  await openApp(page);
  await newBlank(page);
  await page.locator('.props input[type=color]').first().evaluate((el: HTMLInputElement) => {
    el.value = '#ff0000';
    el.dispatchEvent(new Event('change'));
  });
  await drag(page, [4, 4], [20, 4]);
  await page.locator('.props input[type=color]').first().evaluate((el: HTMLInputElement) => {
    el.value = '#0000ff';
    el.dispatchEvent(new Event('change'));
  });
  await drag(page, [4, 8], [20, 8]);
  const p = await project(page);
  expect(p.curves.map((c: any) => c.style.color)).toEqual(['#ff0000', '#0000ff']);
});

test('tapping overlapping curves again selects the next one', async ({ page }) => {
  await openApp(page);
  await newBlank(page);
  await drag(page, [4, 4], [20, 4]);
  await drag(page, [8, 4], [16, 4]);
  await page.getByRole('button', { name: /^選取/ }).first().click();
  const selected = () => page.evaluate(() => (window as any).__editor.selectedId);
  await click(page, 12, 4);
  const first = await selected();
  await expect(page.locator('.status')).toContainText('再點一次換下一段');
  await click(page, 12, 4);
  const second = await selected();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(second).not.toBe(first);
});

test('export downloads a PNG and an SVG', async ({ page }) => {
  await openApp(page);
  await newBlank(page);
  await drag(page, [4, 4], [20, 20]);
  // just one size: a single PNG instead of a zip
  for (const cb of await page.locator('.size-list input').all()) await cb.uncheck();
  await page.locator('.size-list label', { hasText: /^48$/ }).locator('input').check();
  const png = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載 PNG' }).click();
  expect((await png).suggestedFilename()).toBe('icon-48.png');
  const svg = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載 SVG' }).click();
  const d = await svg;
  expect(d.suggestedFilename()).toBe('icon.svg');
  const text = await (await import('node:fs/promises')).readFile((await d.path())!, 'utf8');
  expect(text).toContain('<svg');
  expect(text).toContain('#000000');
});

test('switching the interface language', async ({ page }) => {
  await openApp(page);
  await newBlank(page);
  await page.locator('.topbar .lang-btn').click();
  await expect(page).toHaveTitle('Grid Geometry Icon');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await page.locator('.topbar .lang-btn').click();
  await expect(page).toHaveTitle('格點幾何 Icon');
});

test('importing an SVG made of strokes only', async ({ page }) => {
  await openApp(page);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#333333" stroke-width="2" stroke-linecap="round">
    <circle cx="12" cy="12" r="8"/><path d="M8 12h8"/></svg>`;
  let message = '';
  page.on('dialog', (d) => { message = d.message(); d.accept(); });
  const chooser = page.waitForEvent('filechooser');
  await page.locator('dialog.new-dialog').getByRole('button', { name: '從 SVG 匯入…' }).click();
  await (await chooser).setFiles({ name: 'ring.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  await expect(page.locator('dialog.new-dialog')).toBeHidden({ timeout: 20_000 });
  await expect.poll(() => message).toContain('已匯入');
  const p = await project(page);
  expect(p.curves.length).toBeGreaterThan(2);
  expect(p.fills.length).toBeGreaterThan(0);
  expect(p.fills.every((f: any) => f.color === '#333333')).toBe(true);
});

test('offline support files are served', async ({ request }) => {
  const manifest = await request.get('manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).icons).toHaveLength(2);
  expect((await request.get('sw.js')).ok()).toBe(true);
  expect((await request.get('icon-512.png')).ok()).toBe(true);
});
