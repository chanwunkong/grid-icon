import { expect, test, type Page } from '@playwright/test';
import { gridToPage, newBlank, openApp, project } from './helpers';

/** A one-finger drag with real touch events (Chrome DevTools protocol). */
async function touchDrag(page: Page, a: [number, number], b: [number, number]) {
  const cdp = await page.context().newCDPSession(page);
  const p = await gridToPage(page, ...a), q = await gridToPage(page, ...b);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  for (let i = 1; i <= 6; i++)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x + ((q.x - p.x) * i) / 6, y: p.y + ((q.y - p.y) * i) / 6 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('phone layout: drawing with a finger, toolbar and settings sheet', async ({ page }) => {
  await openApp(page);
  await newBlank(page);
  await touchDrag(page, [4, 12], [20, 12]);
  const p = await project(page);
  expect(p.curves).toHaveLength(1);
  expect(p.curves[0]).toMatchObject({ a: { x: 4, y: 12 }, b: { x: 20, y: 12 } });
  // nothing scrolls sideways
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // the settings sheet holds the language switch and the export
  await page.getByRole('button', { name: '設定' }).click();
  await expect(page.locator('.props .lang-btn')).toBeVisible();
  await expect(page.getByRole('button', { name: '下載 PNG' })).toBeAttached();
  await page.getByRole('button', { name: '完成' }).click();
  // the colour picker is in the 「更多」 row
  await page.getByRole('button', { name: '更多' }).click();
  await expect(page.locator('.more .color-step input')).toBeVisible();
});
