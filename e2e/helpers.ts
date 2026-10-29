import { expect, type Page } from '@playwright/test';

type Opts = { lang?: 'zh' | 'en'; tutorialSeen?: boolean };

/** Open the app with a clean browser: no saved drawing, chosen language, tutorial seen or not. */
export async function openApp(page: Page, { lang = 'zh', tutorialSeen = true }: Opts = {}) {
  await page.addInitScript(([l, seen]) => {
    if (sessionStorage.getItem('e2e-init')) return; // keep what the test changed across reloads
    sessionStorage.setItem('e2e-init', '1');
    localStorage.clear();
    localStorage.setItem('grid-icon:lang', l as string);
    if (seen) localStorage.setItem('grid-icon:tutorial', 'done');
  }, [lang, tutorialSeen] as const);
  await page.goto('./');
  await expect(page.locator('canvas').first()).toBeVisible();
}

/** Create an empty 24×24 project from the new-project dialog. */
export async function newBlank(page: Page) {
  const dlg = page.locator('dialog.new-dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: '建立' }).click();
  await expect(dlg).toBeHidden();
}

/** Page coordinates of a grid point on the editor canvas. */
export async function gridToPage(page: Page, x: number, y: number) {
  const box = (await page.locator('.canvas-box canvas').boundingBox())!;
  const q = await page.evaluate(([gx, gy]) => (window as any).__editor.vp.toScreen(gx, gy), [x, y]);
  return { x: box.x + q.x, y: box.y + q.y };
}

/** Mouse drag from one grid point to another (drawing tools). */
export async function drag(page: Page, a: [number, number], b: [number, number]) {
  const p = await gridToPage(page, ...a), q = await gridToPage(page, ...b);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
  await page.mouse.move(q.x, q.y, { steps: 4 });
  await page.mouse.up();
}

export async function click(page: Page, x: number, y: number) {
  const p = await gridToPage(page, x, y);
  await page.mouse.click(p.x, p.y);
}

export const project = (page: Page) => page.evaluate(() => (window as any).__editor.project);
