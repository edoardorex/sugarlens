export const STORAGE_KEY = 'sugarlens.products.v1';
export const THRESHOLDS = Object.freeze({
  food: Object.freeze({ low: 5, high: 22.5, unit: 'g' }),
  drink: Object.freeze({ low: 2.5, high: 11.25, unit: 'ml' }),
});

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseNumber(value, label, { optional = false, max = 100, positive = false } = {}) {
  const text = String(value ?? '').trim();
  if (!text && optional) return null;
  if (!/^\d+(?:[.,]\d{1,3})?$/.test(text)) throw new Error(`Enter ${label} as a number, using a dot or comma for decimals.`);
  const number = Number(text.replace(',', '.'));
  if (!Number.isFinite(number) || number > max || (positive && number <= 0)) {
    throw new Error(`${label} must be ${positive ? 'greater than 0' : '0'} to ${max}.`);
  }
  return number;
}

export function normalizeBarcode(value) {
  if (typeof value !== 'string') throw new Error('Enter a retail product barcode.');
  const text = value.trim();
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(text)) {
    throw new Error('Use an EAN-8, UPC-A, EAN-13 or GTIN-14 product code.');
  }
  const body = text.slice(0, -1).split('').reverse();
  const sum = body.reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  if ((10 - sum % 10) % 10 !== Number(text.at(-1))) throw new Error('The barcode check digit is invalid. Check the printed digits.');
  return text.padStart(14, '0');
}

export function scannedBarcode(value) {
  if (typeof value !== 'string' || value.length > 300) throw new Error('Unsupported product code.');
  const text = value.trim().replace(/^\][A-Za-z]\d/, '');
  const human = text.match(/^\(01\)(\d{14})(?:\(|$)/);
  if (human) return normalizeBarcode(human[1]);
  if (/^01\d{14}(?:\d|$)/.test(text)) return normalizeBarcode(text.slice(2, 16));
  return normalizeBarcode(text);
}

function checkedNumber(value, label, options = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${label}.`);
  const { max = 100, positive = false } = options;
  if (value < 0 || value > max || (positive && value <= 0)) {
    throw new Error(`${label} must be ${positive ? 'greater than 0' : '0'} to ${max}.`);
  }
  return value;
}

export function validateProduct(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid product record.');
  if (typeof value.id !== 'string' || !value.id || value.id.length > 100) throw new Error('Invalid product identifier.');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80) throw new Error('Enter a product name (up to 80 characters).');
  if (!Object.hasOwn(THRESHOLDS, value.type)) throw new Error('Choose food or drink.');
  if (!['hundred', 'serving'].includes(value.basis)) throw new Error('Choose the basis printed on the label.');
  if (typeof value.barcode !== 'string') throw new Error('Invalid barcode.');
  const barcode = value.barcode ? normalizeBarcode(value.barcode) : '';
  const quantity = checkedNumber(value.quantity, 'label quantity', { positive: true, max: 2000 });
  if (value.basis === 'hundred' && quantity !== 100) throw new Error('Per-100 labels must use a quantity of 100.');
  const sugars = checkedNumber(value.sugars, 'total sugars', { max: 2000 });
  const carbs = value.carbs === null ? null : checkedNumber(value.carbs, 'total carbohydrate', { max: 2000 });
  if (sugars > quantity || (carbs !== null && carbs > quantity)) {
    throw new Error('The entered nutrients exceed 100 g per 100 g/ml. Check the label basis and quantity.');
  }
  if (carbs !== null && sugars > carbs) throw new Error('Sugars are part of total carbohydrate. Check the values and use the same label basis.');
  const portion = value.portion === null ? null : checkedNumber(value.portion, 'your portion', { positive: true, max: 5000 });
  if (!isDate(value.enteredAt)) throw new Error('Invalid label entry date.');
  const product = { id: value.id, name: value.name.trim(), barcode, type: value.type, basis: value.basis, quantity, sugars, carbs, portion, enteredAt: value.enteredAt };
  if (value.source !== undefined) {
    if (!barcode || value.source?.provider !== 'openfoodfacts' || !isDate(value.source.retrievedAt)) throw new Error('Invalid catalogue source.');
    product.source = { provider: 'openfoodfacts', retrievedAt: value.source.retrievedAt };
  }
  return product;
}

export function sugarBand(type, sugars, quantity = 100) {
  if (!Object.hasOwn(THRESHOLDS, type) || typeof sugars !== 'number' || !Number.isFinite(sugars) || sugars < 0 || sugars > quantity || typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > 2000) {
    throw new Error('A valid sugar amount and food/drink type are required.');
  }
  const { low, high } = THRESHOLDS[type];
  // Catalogue conversions can have more precision than handwritten labels.
  const within = (threshold) => {
    const amount = sugars * 100;
    const boundary = quantity * threshold;
    return amount <= boundary + Number.EPSILON * Math.max(amount, boundary) * 2;
  };
  if (within(low)) return { level: 1, key: 'lower', label: 'Lower sugar' };
  if (within(high)) return { level: 2, key: 'medium', label: 'Medium sugar' };
  return { level: 3, key: 'higher', label: 'Higher sugar' };
}

export function evaluateProduct(value) {
  const product = validateProduct(value);
  const sugarPer100 = product.sugars / product.quantity * 100;
  const carbsPer100 = product.carbs === null ? null : product.carbs / product.quantity * 100;
  return {
    ...sugarBand(product.type, product.sugars, product.quantity),
    sugarPer100,
    carbsPer100,
    sugarPerPortion: product.portion === null ? null : product.sugars / product.quantity * product.portion,
    carbsPerPortion: product.portion === null || product.carbs === null ? null : product.carbs / product.quantity * product.portion,
    unit: THRESHOLDS[product.type].unit,
  };
}

export function validateBackup(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.products) || value.products.length > 1000) throw new Error('Use a SugarLens v1 backup with at most 1,000 products.');
  const products = value.products.map(validateProduct);
  if (new Set(products.map((item) => item.id)).size !== products.length) throw new Error('Duplicate product identifiers in backup.');
  const barcodes = products.filter((item) => item.barcode).map((item) => item.barcode);
  if (new Set(barcodes).size !== barcodes.length) throw new Error('Duplicate product barcodes in backup.');
  return products;
}

export function upsertProduct(products, value) {
  const product = validateProduct(value);
  const existing = products.find((item) => item.id === product.id || (product.barcode && item.barcode === product.barcode));
  const next = existing
    ? products.map((item) => item.id === existing.id ? { ...product, id: existing.id } : item)
    : [...products, product];
  return validateBackup({ version: 1, products: next });
}

export function formatGrams(value) {
  if (value === null) return 'Not entered';
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(rounded);
  return value > 0 && rounded === 0 ? '<0.01 g' : `${formatted} g`;
}

export function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}
