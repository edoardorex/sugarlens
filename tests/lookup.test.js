import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogueCode, catalogueProduct, lookupNutrition } from '../src/lookup.js';
import { evaluateProduct, validateBackup } from '../src/domain.js';

const barcode = '4006381333931';
const entry = (product = {}) => ({
  status: 'success', result: { id: 'product_found' },
  product: { code: barcode, product_name: 'Example cereal', nutriments: { sugars_100g: 5.0001, carbohydrates_100g: 64.56789 }, ...product },
});

test('catalogue values retain precision, missing carbs stay unknown and attribution survives backup', () => {
  const product = catalogueProduct(entry(), barcode);
  assert.equal(evaluateProduct(product).level, 2);
  assert.equal(product.sugars, 5.0001);
  assert.equal(product.portion, null);
  assert.equal(validateBackup({ version: 1, products: [product] })[0].source.provider, 'openfoodfacts');
  const drink = catalogueProduct(entry({ categories_tags: ['en:beverages'], nutriments: { sugars_100g: 2.5001 } }), barcode);
  assert.equal(drink.type, 'drink');
  assert.equal(drink.carbs, null);
  assert.equal(evaluateProduct(drink).level, 2);
  assert.equal(catalogueCode('04006381333931'), barcode);
  assert.equal(catalogueCode('96385074'), '96385074');
  assert.equal(catalogueCode('036000291452'), '0036000291452');
});

test('mismatched, missing, estimated-only and impossible catalogue nutrition never produces a score', () => {
  assert.throws(() => catalogueProduct(entry({ code: '3017620422003' }), barcode), /different barcode/);
  assert.throws(() => catalogueProduct({ result: { id: 'product_not_found' } }, barcode), { name: 'ProductNotFoundError' });
  for (const nutrients of [
    { 'added-sugars_100g': 5 }, { sugars_100g: null }, { sugars_100g: '5' },
    { sugars_100g: -1 }, { sugars_100g: 101 }, { sugars_100g: 20, carbohydrates_100g: 5 },
  ]) assert.throws(() => catalogueProduct(entry({ nutriments: nutrients }), barcode));
  assert.throws(() => catalogueProduct(entry({ nutriments: {}, nutriments_estimated: { sugars_100g: 5 } }), barcode), /no usable/);
});

test('lookup sends only a validated code and requested fields, without cookies or referrer', async () => {
  const product = await lookupNutrition(barcode, { fetcher: async (url, options) => {
    assert.equal(new URL(url).hostname, 'world.openfoodfacts.org');
    assert.ok(url.includes(`/api/v3/product/${barcode}.json`));
    assert.equal(new URL(url).searchParams.get('app_name'), 'SugarLens');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.body, undefined);
    return Response.json(entry());
  } });
  assert.equal(product.barcode, '04006381333931');
  await assert.rejects(lookupNutrition('4006381333932', { fetcher: () => { throw new Error('must not fetch'); } }), /check digit/);
});

test('HTTP failures, malformed responses, timeout and cancellation remain explicit', async () => {
  for (const [status, message] of [[404, /not in/], [429, /rate-limiting/], [503, /unavailable/]]) {
    await assert.rejects(lookupNutrition(barcode, { fetcher: async () => new Response('', { status }) }), message);
  }
  await assert.rejects(lookupNutrition(barcode, { fetcher: async () => new Response('', { status: 503 }) }), { name: 'Error' });
  await assert.rejects(lookupNutrition(barcode, { fetcher: async () => new Response('{broken') }), SyntaxError);
  const waiting = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  await assert.rejects(lookupNutrition(barcode, { fetcher: waiting, timeout: 5 }), { name: 'TimeoutError' });
  const controller = new AbortController();
  const pending = lookupNutrition(barcode, { fetcher: waiting, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
