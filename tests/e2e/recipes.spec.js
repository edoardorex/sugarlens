import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const photo = { name: 'ingredients.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="white"/><circle cx="90" cy="100" r="55" fill="green"/><path d="M200 50L245 50L220 210Z" fill="orange"/></svg>') };
async function mockVision(page, mode = 'success') {
  await page.addInitScript((mode) => {
    const NativeWorker = window.Worker;
    window.Worker = class {
      constructor(url, options) {
        if (!String(url).includes('vision-worker')) return new NativeWorker(url, options);
      }
      postMessage(data) {
        window.photoPayloadSize = data.pixels.byteLength;
        setTimeout(() => this.onmessage?.({ data: mode === 'error' ?
          { type: 'error', message: 'Model download failed (503).' } :
          { type: 'result', detections: [{ class: 'broccoli', score: 0.9 }, { class: 'carrot', score: 0.85 }], cacheWarning: mode === 'cache-warning' } }), mode === 'late' ? 1000 : 50);
      }
      terminate() {}
    };
  }, mode);
}
async function openRecipes(page) {
  await page.goto('/');
  await page.locator('#open-recipes').click();
}
async function pickManual(page) {
  await page.getByLabel('Broccoli', { exact: true }).check();
  await page.getByLabel('Cooked chickpeas', { exact: true }).check();
  await page.locator('#recipe-picker > summary').click();
  await page.locator('#recipe-confirm').check();
  await page.locator('#recipe-build').click();
}

test('confirmed recipe cooking guidance saves locally and restores in another language on 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await openRecipes(page);
  await page.locator('#recipe-build').click();
  await expect(page.locator('#recipe-error')).toContainText('Confirm the selected ingredients');
  await pickManual(page);
  await expect(page.locator('#recipe-result')).toContainText('Vegetable and protein skillet');
  await expect(page.locator('#recipe-result')).toContainText('Never use raw dried beans');
  await expect(page.locator('#recipe-result')).toContainText('not make the dish carbohydrate-free');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.locator('#recipe-dialog').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.locator('#recipe-save').click();
  await expect(page.locator('#recipe-save-status')).toContainText('Recipe saved');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sugarlens.recipe.v1')))).toMatchObject({ version: 1, ingredients: ['broccoli', 'chickpeas'] });
  await page.locator('#close-recipe').click();
  await page.locator('#language').selectOption('it');
  await page.reload();
  await page.locator('#open-recipes').click();
  await expect(page.locator('#recipe-result')).toContainText('Padellata di verdure e proteine');
  await expect(page.locator('#recipe-save-status')).toContainText('ripristinata');
  await expect(page.locator('#saved-count')).toHaveText('0');
});

test('photo suggestions need confirmation, stay private, and are discarded on close', async ({ page }) => {
  await mockVision(page, 'cache-warning');
  const external = [];
  page.on('request', (request) => { if (request.url().startsWith('https://')) external.push(request.url()); });
  await openRecipes(page);
  await page.locator('#recipe-gallery-file').setInputFiles(photo);
  await expect(page.locator('#recipe-image')).toBeVisible();
  await page.locator('#recipe-identify').click();
  await expect(page.locator('#recipe-selected')).toContainText('Carrots');
  await expect(page.locator('#recipe-confirm')).not.toBeChecked();
  await expect(page.locator('#recipe-cache-warning')).toBeVisible();
  await page.locator('#recipe-build').click();
  await expect(page.locator('#recipe-result')).not.toBeVisible();
  await page.locator('#recipe-confirm').check();
  await page.locator('#recipe-build').click();
  await expect(page.locator('#recipe-result')).toContainText('Simple vegetable pan');
  expect(await page.evaluate(() => window.photoPayloadSize)).toBeGreaterThan(0);
  expect(external).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('sugarlens.recipe.v1'))).toBeNull();
  await page.locator('#close-recipe').click();
  await page.locator('#open-recipes').click();
  await expect(page.locator('#recipe-image')).not.toHaveAttribute('src', /.+/);
});

test('invalid photo and failed model download are explicit, with manual recipes still available', async ({ page }) => {
  await mockVision(page, 'error');
  await openRecipes(page);
  await page.locator('#recipe-photo-file').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.locator('#recipe-error')).toContainText('Try a JPEG or PNG');
  await page.locator('#recipe-photo-file').setInputFiles(photo);
  await page.locator('#recipe-identify').click();
  await expect(page.locator('#recipe-error')).toContainText('Recognition failed');
  await expect(page.locator('#recipe-status')).toBeEmpty();
  await page.locator('#recipe-picker > summary').click();
  await pickManual(page);
  await expect(page.locator('#recipe-result')).toBeVisible();
});

test('cancelled recognition cannot apply a late result or discard manual selections', async ({ page }) => {
  await mockVision(page, 'late');
  await openRecipes(page);
  await page.locator('#recipe-photo-file').setInputFiles(photo);
  await page.locator('#recipe-identify').click();
  await page.locator('#recipe-cancel').click();
  await expect(page.locator('#recipe-status')).toContainText('cancelled');
  await page.waitForTimeout(1100);
  await expect(page.locator('#recipe-selected')).not.toContainText('Carrots');
  await page.locator('#recipe-picker > summary').click();
  await pickManual(page);
  await expect(page.locator('#recipe-result')).toBeVisible();
});

test('corrupt saved recipes are protected and failed writes remain retryable without changing labels', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seededRecipe')) {
      localStorage.setItem('sugarlens.recipe.v1', '{bad');
      sessionStorage.setItem('seededRecipe', '1');
    }
    const original = Storage.prototype.setItem;
    window.recipeQuota = true;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'sugarlens.recipe.v1' && window.recipeQuota) throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await openRecipes(page);
  await expect(page.locator('#recipe-error')).toContainText('Saved recipe could not be read');
  await pickManual(page);
  await page.locator('#recipe-save').click();
  await expect(page.locator('#recipe-error')).toContainText('protected');
  expect(await page.evaluate(() => localStorage.getItem('sugarlens.recipe.v1'))).toBe('{bad');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#recipe-forget').click();
  await pickManual(page);
  await page.locator('#recipe-save').click();
  await expect(page.locator('#recipe-error')).toContainText('Recipe not saved: Full');
  await expect(page.locator('#recipe-save')).toBeEnabled();
  await page.evaluate(() => { window.recipeQuota = false; });
  await page.locator('#recipe-save').click();
  await expect(page.locator('#recipe-save-status')).toContainText('Recipe saved');
  await expect(page.locator('#recipe-error')).not.toBeVisible();
  await expect(page.locator('#saved-count')).toHaveText('0');
});

for (const [language, title] of [['es', 'Salteado de verduras y proteínas'], ['fr', 'Poêlée de légumes et protéines']]) {
  test(`${language} recipe selection and cooking instructions fit 320px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 760 });
    await page.goto('/');
    await page.locator('#language').selectOption(language);
    await page.locator('#open-recipes').click();
    expect(await page.locator('#recipe-dialog').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.locator('#recipe-picker input[value="broccoli"]').check();
    await page.locator('#recipe-picker input[value="chickpeas"]').check();
    await page.locator('#recipe-picker > summary').click();
    await page.locator('#recipe-confirm').check();
    await page.locator('#recipe-build').click();
    await expect(page.locator('#recipe-result')).toContainText(title);
    await expect.poll(() => page.locator('#recipe-dialog').evaluate((element) =>
      element.querySelector('.sheet-heading').getBoundingClientRect().top - element.getBoundingClientRect().top)).toBeLessThanOrEqual(1);
    await expect(page.locator('#recipe-result')).not.toContainText('Choose ingredient amounts');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
