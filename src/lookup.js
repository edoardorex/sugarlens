import { normalizeBarcode, todayISO, validateProduct } from './domain.js';

const requests = [];

function missingProduct(message) {
  const error = new Error(message);
  error.name = 'ProductNotFoundError';
  return error;
}

export function catalogueCode(barcode) {
  const code = normalizeBarcode(barcode);
  return code.startsWith('000000') ? code.slice(6) : code.startsWith('0') ? code.slice(1) : code;
}

export function catalogueProduct(data, barcode) {
  const code = normalizeBarcode(barcode);
  if (data?.result?.id === 'product_not_found') throw missingProduct('This barcode is not in Open Food Facts.');
  if (data?.status !== 'success' || !data.product) throw new Error('Open Food Facts returned an unreadable product.');
  const product = data.product;
  if (normalizeBarcode(product.code) !== code) throw missingProduct('The catalogue returned a different barcode.');
  const name = product.product_name_en || product.product_name;
  if (typeof name !== 'string' || !name.trim()) throw missingProduct('This catalogue entry has no product name.');
  const nutrients = product.nutriments;
  if (product.no_nutrition_data === 'on' || typeof nutrients?.sugars_100g !== 'number') {
    throw missingProduct('This entry has no usable total sugar values per 100 g/ml. Copy the package label instead.');
  }
  const categories = Array.isArray(product.categories_tags) ? product.categories_tags : [];
  try {
    return validateProduct({
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 80),
    barcode: code,
    type: product.nutrition_data_per === '100ml' || categories.includes('en:beverages') ? 'drink' : 'food',
    basis: 'hundred',
    quantity: 100,
    sugars: nutrients.sugars_100g,
    carbs: nutrients.carbohydrates_100g ?? null,
    portion: null,
    enteredAt: todayISO(),
    source: { provider: 'openfoodfacts', retrievedAt: todayISO() },
    });
  } catch (error) { throw missingProduct(error.message); }
}

export async function lookupNutrition(barcode, { signal, fetcher = fetch, timeout = 10_000 } = {}) {
  const code = catalogueCode(barcode);
  signal?.throwIfAborted();
  const now = Date.now();
  while (requests.length && requests[0] <= now - 60_000) requests.shift();
  if (requests.length >= 15) throw new Error('Too many lookups. Wait a minute or enter the label manually.');
  requests.push(now);
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Nutrition lookup timed out.', 'TimeoutError')), timeout);
  const url = new URL(`https://world.openfoodfacts.org/api/v3/product/${code}.json`);
  url.searchParams.set('fields', 'code,product_name,product_name_en,nutriments,nutrition_data_per,categories_tags,no_nutrition_data');
  url.searchParams.set('app_name', 'SugarLens');
  try {
    const response = await fetcher(url.href, {
      signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
      cache: 'no-store', headers: { Accept: 'application/json' },
    });
    if (response.status === 404) throw missingProduct('This barcode is not in Open Food Facts.');
    if (response.status === 429) throw new Error('Open Food Facts is rate-limiting requests. Try again later.');
    if (!response.ok) throw new Error(`Open Food Facts is unavailable (HTTP ${response.status}).`);
    return catalogueProduct(await response.json(), barcode);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
