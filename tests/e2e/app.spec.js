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

async function installBarcodeCamera(page) {
  const barcodeImage = (await bwipjs.toBuffer({
    bcid: 'ean13', text: '4006381333931', scale: 3, height: 15,
    includetext: false, backgroundcolor: 'FFFFFF', paddingwidth: 8, paddingheight: 8,
  })).toString('base64');
  await page.addInitScript((source) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const image = new Image();
      image.src = `data:image/png;base64,${source}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(10);
      window.testTracks = stream.getTracks();
      const draw = () => {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 640, 480);
        ctx.drawImage(image, (640 - image.width) / 2, (480 - image.height) / 2);
        if (stream.getTracks().some((track) => track.readyState === 'live')) requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
      return stream;
    };
  }, barcodeImage);
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

test('a missing EAN scan shows product not found; explicit manual entry can later be recalled', async ({ page }) => {
  let lookups = 0;
  await page.route('https://world.openfoodfacts.org/api/v3/product/**', async (route) => {
    lookups++;
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await installBarcodeCamera(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Scan a product' }).click();
  await expect(page.locator('#product-dialog')).toBeVisible();
  await expect(page.locator('#product-title')).toHaveText('Product not found');
  await expect(page.locator('#missing-reason')).toContainText('not in Open Food Facts');
  await expect(page.locator('#label-form')).not.toBeVisible();
  await expect(page.locator('#saved-count')).toHaveText('0');
  expect(await page.evaluate(() => window.testTracks.every((track) => track.readyState === 'ended'))).toBe(true);
  await page.locator('#missing-manual').click();
  await expect(page.getByLabel('Product barcode', { exact: true })).toHaveValue('04006381333931');
  await page.getByLabel('Product name', { exact: true }).fill('Example scanned product');
  await page.getByLabel('Total sugars (g)', { exact: true }).fill('8');
  await page.getByRole('button', { name: 'Show sugar score' }).click();
  await page.getByRole('button', { name: 'Save label locally' }).click();
  await page.getByRole('button', { name: 'Close label', exact: true }).click();
  await page.getByRole('button', { name: 'Scan a product' }).click();
  await expect(page.locator('#product-dialog')).toBeVisible();
  await expect(page.locator('#product-title')).toHaveText('Example scanned product');
  await expect(page.locator('#quick-portion')).toBeVisible();
  await page.locator('[data-amount="50"]').click();
  await expect(page.locator('.score-main')).toContainText('Medium sugar');
  await expect(page.locator('#auto-save-status')).toContainText('Saved automatically');
  await expect(page.locator('#saved-count')).toHaveText('1');
  await expect.poll(() => page.evaluate(() => window.testTracks.every((track) => track.readyState === 'ended'))).toBe(true);
  expect(lookups).toBe(1);
});

test('scan then amount immediately scores, autosaves and updates the same saved label offline', async ({ page, context }) => {
  let lookups = 0;
  await page.route('https://world.openfoodfacts.org/api/v3/product/**', async (route) => {
    lookups++;
    expect(new URL(route.request().url()).pathname).toBe('/api/v3/product/4006381333931.json');
    await route.fulfill({ json: {
      status: 'success', result: { id: 'product_found' },
      product: { code: '4006381333931', product_name: 'Example catalogue drink', categories_tags: ['en:beverages'], nutriments: { sugars_100g: 11.2501, carbohydrates_100g: 12.34567 } },
    } });
  });
  await installBarcodeCamera(page);
  await page.goto('/');
  await page.locator('#scan-product').click();
  await expect(page.locator('#product-title')).toHaveText('Example catalogue drink');
  await expect(page.locator('#quick-portion')).toBeVisible();
  await expect(page.locator('[data-quick-type="drink"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#label-form')).not.toBeVisible();
  await expect(page.locator('#result')).not.toBeVisible();
  await expect(page.locator('#saved-count')).toHaveText('0');
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.locator('[data-amount="250"]').click();
  await expect(page.locator('.score-card')).toHaveClass('score-card higher');
  await expect(page.locator('.score-segments .selected')).toHaveClass('higher selected');
  await expect(page.locator('#source-note')).toContainText('Open Food Facts');
  await expect(page.locator('.result-caution')).toContainText('Lower sugar does not mean diabetes-safe');
  await expect(page.locator('.portion-values')).toContainText('30.86 g');
  await expect(page.locator('#auto-save-status')).toContainText('Saved automatically');
  await expect(page.locator('#save-label')).not.toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sugarlens.products.v1')).products[0])).toMatchObject({
    type: 'drink', sugars: 11.2501, carbs: 12.34567, portion: 250, source: { provider: 'openfoodfacts' },
  });
  await page.locator('#close-product').click();
  await expect(page.locator('#offline-status')).toContainText('Ready offline');
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.locator('#scan-product').click();
  await expect(page.locator('#quick-portion')).toBeVisible();
  await page.locator('[data-amount="330"]').click();
  await expect(page.locator('#source-note')).toContainText('Open Food Facts');
  await expect(page.locator('.score-main')).toContainText('Higher sugar');
  await expect(page.locator('#saved-count')).toHaveText('1');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sugarlens.products.v1')).products[0].portion)).toBe(330);
  expect(lookups).toBe(1);
});

for (const [name, status, json, title] of [
  ['incomplete nutrition', 200, { status: 'success', product: { code: '4006381333931', product_name: 'Unknown nutrition', nutriments: {} } }, 'Product not found'],
  ['provider outage', 503, {}, 'Lookup unavailable'],
]) test(`a scan with ${name} never guesses nutrition or opens the manual form`, async ({ page }) => {
  await installBarcodeCamera(page);
  await page.route('https://world.openfoodfacts.org/api/v3/product/**', (route) => route.fulfill({ status, json }));
  await page.goto('/');
  await page.locator('#scan-product').click();
  await expect(page.locator('#product-title')).toHaveText(title);
  await expect(page.locator('#scan-missing')).toBeVisible();
  await expect(page.locator('#label-form')).not.toBeVisible();
  await expect(page.locator('#result')).not.toBeVisible();
  await expect(page.locator('#saved-count')).toHaveText('0');
});

test('custom scan amounts validate, type is correctable, and a failed autosave is visibly unsaved and retryable', async ({ page }) => {
  await installBarcodeCamera(page);
  await page.route('https://world.openfoodfacts.org/api/v3/product/**', (route) => route.fulfill({ json: {
    status: 'success', product: { code: '4006381333931', product_name: 'Example milk', nutriments: { sugars_100g: 5, carbohydrates_100g: 5 } },
  } }));
  await page.goto('/');
  await page.locator('#scan-product').click();
  await expect(page.locator('#quick-portion')).toBeVisible();
  await page.locator('[data-quick-type="drink"]').click();
  await expect(page.locator('#quick-quantity-label')).toHaveText('Custom amount (ml)');
  await page.locator('#quick-quantity').fill('0');
  await page.locator('#quick-form button').click();
  await expect(page.locator('#quick-error')).toContainText('greater than 0');
  await expect(page.locator('#saved-count')).toHaveText('0');
  await page.evaluate(() => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'sugarlens.products.v1') throw new DOMException('Storage full', 'QuotaExceededError');
      return window.originalSetItem.call(this, key, value);
    };
  });
  await page.locator('#quick-quantity').fill('25,5');
  await page.locator('#quick-form button').click();
  await expect(page.locator('.score-main')).toContainText('Medium sugar');
  await expect(page.locator('#auto-save-status')).toContainText('Not saved');
  await expect(page.locator('#toast')).toContainText('Storage full');
  await expect(page.locator('#saved-count')).toHaveText('0');
  await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
  await page.locator('#save-label').click();
  await expect(page.locator('#auto-save-status')).toContainText('Saved automatically');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sugarlens.products.v1')).products[0])).toMatchObject({ type: 'drink', portion: 25.5 });
});

test.describe('device-region localization', () => {
  test.use({ locale: 'en-US', timezoneId: 'Europe/Rome' });
  test('regional default requires no GPS; switching language preserves labels and works offline', async ({ page, context }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.addInitScript(() => {
      window.locationRequests = 0;
      navigator.geolocation.getCurrentPosition = () => { window.locationRequests++; };
      navigator.geolocation.watchPosition = () => { window.locationRequests++; };
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    await expect(page.getByLabel('Lingua', { exact: true })).toHaveValue('it');
    await expect(page.locator('#scan-product')).toContainText('Scansiona un prodotto');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#manual-product').click();
    await page.getByLabel('Nome del prodotto', { exact: true }).fill('Food');
    await page.locator('#label-sugars').fill('20');
    await page.locator('#label-carbs').fill('5');
    await page.locator('#my-portion').fill('25,5');
    await page.locator('#label-form button[type="submit"]').click();
    await expect(page.locator('#form-error')).toContainText('Gli zuccheri fanno parte');
    await page.locator('#label-sugars').fill('2,5');
    await page.locator('#label-form button[type="submit"]').click();
    await expect(page.locator('.score-main')).toContainText('Meno zuccheri');
    await expect(page.locator('.portion-values')).toContainText('0,64 g');
    await page.locator('#save-label').click();
    await page.locator('#close-product').click();
    await page.getByLabel('Lingua', { exact: true }).selectOption('fr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('.band-tag')).toContainText('Peu de sucre');
    await expect(page.locator('.product-card strong')).toHaveText('Food');
    await expect(page.getByLabel('Rechercher les produits enregistrés')).toBeVisible();
    await page.locator('#open-guide').click();
    await expect(page.locator('.guide-content')).toContainText('N’utilisez pas cette app pour doser l’insuline');
    await page.locator('#close-guide').click();
    await page.getByLabel('Langue', { exact: true }).selectOption('es');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('#saved-title')).toContainText('Etiquetas guardadas');
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await page.locator('.product-card').click();
    await expect(page.locator('#product-title')).toHaveText('Food');
    await expect(page.locator('.score-main')).toContainText('Menos azúcar');
    await expect(page.locator('.result-caution')).toContainText('Menos azúcar no significa seguro para la diabetes');
    expect(await page.evaluate(() => window.locationRequests)).toBe(0);
    expect(await page.locator('#product-dialog').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
  });
});

for (const [language, result, amountLabel, saved] of [
  ['it', 'Meno zuccheri', 'Altra quantità (g)', 'Salvato automaticamente'],
  ['es', 'Menos azúcar', 'Otra cantidad (g)', 'Guardado automáticamente'],
  ['fr', 'Peu de sucre', 'Autre quantité (g)', 'Enregistré automatiquement'],
]) test(`the ${language} quick scan stays localized, accessible and within a 320px screen`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await installBarcodeCamera(page);
  await page.route('https://world.openfoodfacts.org/api/v3/product/**', (route) => route.fulfill({ json: {
    status: 'success', product: { code: '4006381333931', product_name: 'Food', nutriments: { sugars_100g: 2.5, carbohydrates_100g: 23.5 } },
  } }));
  await page.goto('/');
  const navigation = await page.evaluate(() => performance.timeOrigin);
  await page.locator('#language').selectOption(language);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(navigation);
  await page.locator('#scan-product').click();
  await expect(page.locator('#quick-quantity-label')).toHaveText(amountLabel);
  await expect(page.locator('#product-title')).toHaveText('Food');
  expect(await page.locator('#product-dialog').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.locator('[data-amount="50"]').click();
  await expect(page.locator('.score-main')).toContainText(result);
  await expect(page.locator('.nutrient-grid')).toContainText('2,5 g');
  await expect(page.locator('#auto-save-status')).toContainText(saved);
  await page.locator('#close-product').click();
  await expect(page.locator('.product-card strong')).toHaveText('Food');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('cancelling automatic scan lookup never opens a manual form or accepts a late result', async ({ page }) => {
  await installBarcodeCamera(page);
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  await page.route('https://world.openfoodfacts.org/api/v3/product/**', async (route) => {
    await wait;
    await route.fulfill({ json: { status: 'success', product: { code: '4006381333931', product_name: 'Late product', nutriments: { sugars_100g: 2 } } } });
  });
  await page.goto('/');
  await page.locator('#scan-product').click();
  await expect(page.locator('#lookup-state')).toBeVisible();
  await page.locator('#cancel-lookup').click();
  release();
  await expect(page.locator('#product-title')).toHaveText('Lookup cancelled');
  await expect(page.locator('#quick-portion')).not.toBeVisible();
  await expect(page.locator('#label-form')).not.toBeVisible();
  await expect(page.locator('#saved-count')).toHaveText('0');
});

test('online lookup can be cancelled without stale results, and local-only mode persists', async ({ page }) => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  await page.route('https://world.openfoodfacts.org/api/v3/product/**', async (route) => {
    await wait;
    await route.fulfill({ json: { status: 'success', product: { code: '4006381333931', product_name: 'Late result', nutriments: { sugars_100g: 2 } } } });
  });
  await page.goto('/');
  await page.locator('#manual-product').click();
  await page.getByText('Product barcode optional', { exact: true }).click();
  await page.getByLabel('Product barcode', { exact: true }).fill('4006381333931');
  const request = page.waitForRequest('https://world.openfoodfacts.org/api/v3/product/**');
  await page.locator('#lookup-online').click();
  await request;
  await expect(page.locator('#lookup-state')).toBeVisible();
  await page.locator('#cancel-lookup').click();
  await page.getByLabel('Product name', { exact: true }).fill('My manual label');
  release();
  await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('My manual label');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#close-product').click();
  await page.locator('#online-lookup').uncheck();
  await page.reload();
  await expect(page.locator('#online-lookup')).not.toBeChecked();
  await expect(page.locator('#lookup-privacy')).toContainText('Local-only mode');
  await page.locator('#manual-product').click();
  await expect(page.locator('#lookup-online')).toBeDisabled();
});

test('sound and vibration are user-controlled and scores pulse once per band number', async ({ page }) => {
  await page.addInitScript(() => {
    window.pulses = [];
    window.tones = 0;
    navigator.vibrate = (pattern) => { if (pattern !== 0) window.pulses.push(pattern); return true; };
    window.AudioContext = class {
      state = 'running';
      currentTime = 0;
      destination = {};
      createOscillator() {
        return { frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start() { window.tones++; }, stop() {} };
      }
      createGain() {
        return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
      }
    };
  });
  await page.goto('/');
  await checkLabel(page, { sugars: '30', carbs: '60' });
  await expect.poll(() => page.evaluate(() => window.tones)).toBe(3);
  expect(await page.evaluate(() => window.pulses)).toEqual([[20, 65, 20, 65, 20]]);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#close-product').click();
  await page.locator('#scan-sound').uncheck();
  await page.locator('#scan-vibration').uncheck();
  await checkLabel(page);
  expect(await page.evaluate(() => window.tones)).toBe(3);
  expect(await page.evaluate(() => window.pulses.length)).toBe(1);
});

test('unsupported sensory APIs are explained without blocking visual scores', async ({ page }) => {
  await page.addInitScript(() => {
    window.AudioContext = undefined;
    window.webkitAudioContext = undefined;
    navigator.vibrate = undefined;
  });
  await page.goto('/');
  await expect(page.locator('#scan-sound')).toBeDisabled();
  await expect(page.locator('#scan-vibration')).toBeDisabled();
  await expect(page.locator('#feedback-note')).toContainText('unavailable');
  await checkLabel(page);
  await expect(page.locator('.score-card')).toHaveClass('score-card lower');
  await expect(page.locator('.score-legend')).toContainText('1 Lower');
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
