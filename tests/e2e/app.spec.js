import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import bwipjs from 'bwip-js';

async function checkLabel(page, { name = 'Example crackers', sugars = '2', carbs = '68', portion = '30', barcode = '' } = {}) {
  await page.getByRole('button', { name: 'Enter a label manually' }).click();
  await page.getByLabel('Product name', { exact: true }).fill(name);
  await page.getByLabel('Total sugars (g)', { exact: true }).fill(sugars);
  await page.getByLabel('Total carbohydrate (g)', { exact: false }).fill(carbs);
  await page.getByLabel('Your portion', { exact: false }).fill(portion);
  if (barcode) {
    await page.getByText('Product barcode optional', { exact: true }).click();
    await page.getByLabel('Product barcode', { exact: true }).fill(barcode);
  }
  await page.getByRole('button', { name: 'Show sugar score' }).click();
}

test('a low-sugar label retains carbohydrate context, saves locally, recalls and edits', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await checkLabel(page, { barcode: '4006381333931' });
  await expect(page.locator('.score-main')).toContainText('Lower sugar');
  await expect(page.locator('.portion-values')).toContainText('20.4 g');
  await expect(page.locator('.result-caution')).toContainText('Lower sugar does not mean diabetes-safe');
  await page.getByRole('button', { name: 'Save label locally' }).click();
  await expect(page.getByRole('button', { name: 'Saved on this device' })).toBeDisabled();
  await page.getByRole('button', { name: 'Close label', exact: true }).click();
  await page.reload();
  await expect(page.locator('#saved-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Open saved label for Example crackers' }).click();
  await expect(page.locator('#entry-note')).toContainText('Recipes and labels can change');
  await page.getByRole('button', { name: 'Edit numbers' }).click();
  await page.getByLabel('Total sugars (g)', { exact: true }).fill('23');
  await page.getByRole('button', { name: 'Show sugar score' }).click();
  await expect(page.locator('.score-main')).toContainText('Higher sugar');
  await page.getByRole('button', { name: 'Save label locally' }).click();
  await page.getByRole('button', { name: 'Close label', exact: true }).click();
  await expect(page.locator('#saved-count')).toHaveText('1');
  expect(errors).toEqual([]);
});

test('per-serving drink labels convert to per-100ml and missing carbs are never silently zero', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter a label manually' }).click();
  await page.getByLabel('Product name', { exact: true }).fill('Example drink');
  await page.getByLabel('Product type', { exact: true }).selectOption('drink');
  await page.getByLabel('Label values are').selectOption('serving');
  await page.getByLabel('Labelled serving size (ml)', { exact: true }).fill('250');
  await page.getByLabel('Total sugars (g)', { exact: true }).fill('30');
  await page.getByRole('button', { name: 'Show sugar score' }).click();
  await expect(page.locator('.score-main')).toContainText('Higher sugar');
  await expect(page.locator('.nutrient-grid')).toContainText('12 g');
  await expect(page.locator('.nutrient-grid')).toContainText('Not entered');
  await expect(page.locator('.result-caution')).toContainText('Total carbohydrate was not entered');
});

test('impossible nutrient relationships show an error, not a plausible score', async ({ page }) => {
  await page.goto('/');
  await checkLabel(page, { sugars: '20', carbs: '5' });
  await expect(page.locator('#form-error')).toContainText('Sugars are part of total carbohydrate');
  await expect(page.locator('#result')).not.toBeVisible();
});

test('offline reload and the lazy camera decoder work with no external network calls', async ({ page, context }) => {
  const external = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:51848') && !request.url().startsWith('blob:')) external.push(request.url());
  });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  await page.goto('/');
  await expect(page.locator('#offline-status')).toContainText('Ready offline');
  await expect(page.locator('#update')).not.toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await checkLabel(page);
  await page.getByRole('button', { name: 'Save label locally' }).click();
  await page.getByRole('button', { name: 'Close label', exact: true }).click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#saved-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Scan a product' }).click();
  await expect(page.locator('#camera-status')).toContainText('Camera permission was denied');
  await page.getByRole('button', { name: 'Use manual entry' }).click();
  await expect(page.getByLabel('Product name', { exact: true })).toBeFocused();
  expect(external).toEqual([]);
});

test('a real EAN scan opens a blank new label and later recalls its saved nutrition', async ({ page }) => {
  const barcodeImage = (await bwipjs.toBuffer({
    bcid: 'ean13', text: '4006381333931', scale: 3, height: 15,
    includetext: false, backgroundcolor: 'FFFFFF', paddingwidth: 8, paddingheight: 8,
  })).toString('base64');
  await page.addInitScript((barcodeImage) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const image = new Image();
      image.src = `data:image/png;base64,${barcodeImage}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext('2d');
      const stream = canvas.captureStream(10);
      window.testTracks = stream.getTracks();
      const draw = () => {
        context.fillStyle = 'white';
        context.fillRect(0, 0, 640, 480);
        context.drawImage(image, (640 - image.width) / 2, (480 - image.height) / 2);
        if (stream.getTracks().some((track) => track.readyState === 'live')) requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
      return stream;
    };
  }, barcodeImage);
  await page.goto('/');
  await page.getByRole('button', { name: 'Scan a product' }).click();
  await expect(page.locator('#product-dialog')).toBeVisible();
  await expect(page.locator('#entry-note')).toContainText('New barcode');
  await expect(page.getByLabel('Total sugars (g)', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Product barcode', { exact: true })).toHaveValue('04006381333931');
  expect(await page.evaluate(() => window.testTracks.every((track) => track.readyState === 'ended'))).toBe(true);
  await page.getByLabel('Product name', { exact: true }).fill('Example scanned product');
  await page.getByLabel('Total sugars (g)', { exact: true }).fill('8');
  await page.getByRole('button', { name: 'Show sugar score' }).click();
  await page.getByRole('button', { name: 'Save label locally' }).click();
  await page.getByRole('button', { name: 'Close label', exact: true }).click();
  await page.getByRole('button', { name: 'Scan a product' }).click();
  await expect(page.locator('#product-dialog')).toBeVisible();
  await expect(page.locator('#product-title')).toHaveText('Example scanned product');
  await expect(page.locator('.score-main')).toContainText('Medium sugar');
  await expect(page.locator('#entry-note')).toContainText('recheck');
  await expect.poll(() => page.evaluate(() => window.testTracks.every((track) => track.readyState === 'ended'))).toBe(true);
});

test('corrupt local data is protected, but checking a label is still possible', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sugarlens.products.v1', '{broken'));
  await page.goto('/');
  await expect(page.locator('#storage-error')).toBeVisible();
  await checkLabel(page);
  await expect(page.locator('.score-main')).toContainText('Lower sugar');
  await expect(page.getByRole('button', { name: 'Storage unavailable - checking only' })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('sugarlens.products.v1'))).toBe('{broken');
});

test('invalid backup imports leave existing labels untouched and saved names render literally', async ({ page }) => {
  await page.goto('/');
  await checkLabel(page, { name: '<img src=x onerror=alert(1)>' });
  await page.getByRole('button', { name: 'Save label locally' }).click();
  await page.getByRole('button', { name: 'Close label', exact: true }).click();
  await expect(page.locator('#product-list img')).toHaveCount(0);
  await page.locator('#import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":2,"products":[]}') });
  await expect(page.locator('#toast')).toContainText('Existing data is unchanged');
  await expect(page.locator('#saved-count')).toHaveText('1');
});

test('home, form and result meet automated accessibility checks', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#offline-status')).toContainText('Ready offline');
  const audit = async () => expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await audit();
  await page.getByRole('button', { name: 'Enter a label manually' }).click();
  await audit();
  await page.getByLabel('Product name', { exact: true }).fill('Example crackers');
  await page.getByLabel('Total sugars (g)', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Show sugar score' }).click();
  await audit();
});

test('a failed save is visible inside the sheet and leaves the label unsaved', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
  });
  await page.goto('/');
  await checkLabel(page);
  await page.getByRole('button', { name: 'Save label locally' }).click();
  await expect(page.locator('#product-dialog #toast')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Not saved');
  await expect(page.getByRole('button', { name: 'Save label locally' })).toBeEnabled();
  await expect(page.locator('#saved-count')).toHaveText('0');
});

test('a downloaded backup restores the label library', async ({ page }) => {
  await page.goto('/');
  await checkLabel(page);
  await page.getByRole('button', { name: 'Save label locally' }).click();
  await page.getByRole('button', { name: 'Close label', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const backup = Buffer.concat(chunks);
  expect(JSON.parse(backup).products[0].name).toBe('Example crackers');
  await page.getByRole('button', { name: 'Open saved label for Example crackers' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete saved label' }).click();
  await expect(page.locator('#saved-count')).toHaveText('0');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#import-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
  await expect(page.locator('#saved-count')).toHaveText('1');
  await expect(page.getByRole('button', { name: 'Open saved label for Example crackers' })).toBeVisible();
});

test('unsaved label results are protected on close and Escape', async ({ page }) => {
  await page.goto('/');
  await checkLabel(page);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#close-product').click();
  await expect(page.locator('#product-dialog')).toBeVisible();
  await expect(page.locator('.score-main')).toContainText('Lower sugar');
  page.once('dialog', (dialog) => dialog.accept());
  await page.keyboard.press('Escape');
  await expect(page.locator('#product-dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Enter a label manually' }).click();
  await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Total sugars (g)', { exact: true })).toHaveValue('');
});

test('a newly saved label is not hidden by an earlier library search', async ({ page }) => {
  await page.goto('/');
  await checkLabel(page);
  await page.locator('#save-label').click();
  await page.locator('#close-product').click();
  await page.getByRole('searchbox').fill('not a matching product');
  await checkLabel(page, { name: 'Example cereal' });
  await page.locator('#save-label').click();
  await page.locator('#close-product').click();
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Open saved label for Example cereal' })).toBeVisible();
});
