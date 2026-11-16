import { test, expect } from '@playwright/test';

test('the label library is readable on desktop and phones', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'desktop') await page.setViewportSize({ width: 1180, height: 1080 });
  await page.addInitScript(() => {
    localStorage.setItem('sugarlens.products.v1', JSON.stringify({
      version: 1,
      products: [
        { id: 'example-1', name: 'Example crackers', barcode: '', type: 'food', basis: 'hundred', quantity: 100, sugars: 2, carbs: 68, portion: 30, enteredAt: '2026-11-16' },
        { id: 'example-2', name: 'Example breakfast cereal', barcode: '', type: 'food', basis: 'hundred', quantity: 100, sugars: 15, carbs: 65, portion: 40, enteredAt: '2026-11-16' },
        { id: 'example-3', name: 'Example fruit drink', barcode: '', type: 'drink', basis: 'hundred', quantity: 100, sugars: 12, carbs: 12, portion: 250, enteredAt: '2026-11-16' },
      ],
    }));
  });
  await page.goto('/');
  await expect(page.locator('#saved-count')).toHaveText('3');
  await expect(page.locator('#offline-status')).toContainText('Ready offline');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('library.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open saved label for Example crackers' }).click();
  await expect(page.locator('.result-caution')).toContainText('Lower sugar does not mean diabetes-safe');
  expect(await page.locator('#product-dialog').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('result.png') });
});

test('the mobile dock, form and result work at 320px and in a short viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Mobile product actions' })).toBeVisible();
  await page.locator('#dock-label').click();
  await expect(page.locator('#product-dialog')).toBeVisible();
  expect((await page.locator('#product-dialog').boundingBox()).width).toBe(320);
  expect(await page.getByLabel('Product name', { exact: true }).evaluate((input) => getComputedStyle(input).fontSize)).toBe('16px');
  await page.getByLabel('Product name', { exact: true }).fill('Example cereal with a deliberately long product name');
  await page.getByLabel('Total sugars (g)', { exact: true }).fill('5');
  await page.getByLabel('Total carbohydrate (g)', { exact: false }).fill('60');
  await page.locator('#product-dialog').evaluate((dialog) => { dialog.scrollTop = dialog.scrollHeight; });
  await expect(page.getByRole('button', { name: 'Close label', exact: true })).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Show sugar score' }).click();
  await expect(page.locator('.score-main')).toContainText('Lower sugar');
  expect(await page.locator('#product-dialog').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 393, height: 430 });
  await page.getByRole('button', { name: 'Save label locally' }).click();
  await page.getByRole('button', { name: 'Close label', exact: true }).click();
  await expect(page.locator('#saved-count')).toHaveText('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'About, privacy and medical limitations' }).click();
  await page.locator('#guide-dialog').evaluate((dialog) => { dialog.scrollTop = dialog.scrollHeight; });
  await expect(page.getByRole('button', { name: 'Close information' })).toBeInViewport({ ratio: 1 });
});

test('phone label and camera sheets fit a reduced visual viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await page.locator('#dock-label').click();
  await page.evaluate(() => {
    Object.defineProperties(visualViewport, {
      height: { configurable: true, get: () => 300 },
      offsetTop: { configurable: true, get: () => 40 },
    });
    visualViewport.dispatchEvent(new Event('resize'));
  });
  const sheet = await page.locator('#product-dialog').boundingBox();
  expect(sheet.y).toBeGreaterThanOrEqual(40);
  expect(sheet.y + sheet.height).toBeLessThanOrEqual(341);
  await page.locator('#product-dialog').evaluate((dialog) => { dialog.scrollTop = dialog.scrollHeight; });
  const close = await page.locator('#close-product').boundingBox();
  expect(close.y).toBeGreaterThanOrEqual(40);
  expect(close.y + close.height).toBeLessThanOrEqual(340);
  const backgroundY = await page.evaluate(() => scrollY);
  await page.mouse.move(2, 2);
  await page.mouse.wheel(0, 300);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => scrollY)).toBe(backgroundY);
  await page.locator('#close-product').click();
  await page.locator('#dock-scan').click();
  const scanner = await page.locator('#camera-dialog').boundingBox();
  expect(scanner.y).toBeGreaterThanOrEqual(40);
  expect(scanner.y + scanner.height).toBeLessThanOrEqual(341);
});
