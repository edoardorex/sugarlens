import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateProduct, formatGrams, normalizeBarcode, parseNumber, scannedBarcode,
  sugarBand, upsertProduct, validateBackup, validateProduct,
} from '../src/domain.js';
import { loadProducts, saveProducts } from '../src/storage.js';

const product = {
  id: 'p1', name: 'Example crackers', barcode: '04006381333931', type: 'food',
  basis: 'hundred', quantity: 100, sugars: 2, carbs: 68, portion: 30, enteredAt: '2026-11-16',
};

test('food and drink sugar bands use inclusive low and medium boundaries', () => {
  for (const [type, low, high] of [['food', 5, 22.5], ['drink', 2.5, 11.25]]) {
    assert.equal(sugarBand(type, 0).level, 1);
    assert.equal(sugarBand(type, low).level, 1);
    assert.equal(sugarBand(type, low + 0.001).level, 2);
    assert.equal(sugarBand(type, high).level, 2);
    assert.equal(sugarBand(type, high + 0.001).level, 3);
  }
  for (const value of [undefined, null, NaN, Infinity, -1, 101]) assert.throws(() => sugarBand('food', value), /valid/);
});

test('portion labels convert density before scoring and total carbs remain distinct from sugars', () => {
  const result = evaluateProduct({ ...product, basis: 'serving', quantity: 30, sugars: 6, carbs: 20, portion: 60 });
  assert.equal(result.level, 2);
  assert.equal(result.sugarPer100, 20);
  assert.equal(result.sugarPerPortion, 12);
  assert.equal(result.carbsPerPortion, 40);
  const lowSugar = evaluateProduct(product);
  assert.equal(lowSugar.level, 1);
  assert.ok(Math.abs(lowSugar.carbsPerPortion - 20.4) < 1e-10);
  assert.equal(evaluateProduct({ ...product, carbs: null }).carbsPerPortion, null);
  assert.equal(evaluateProduct({ ...product, portion: null }).sugarPerPortion, null);
});

test('unrounded density sets the band even if displayed density rounds to a boundary', () => {
  const result = evaluateProduct({ ...product, basis: 'serving', quantity: 30, sugars: 1.501, carbs: 20 });
  assert.equal(result.level, 2);
  assert.equal(formatGrams(result.sugarPer100), '5 g');
  assert.equal(formatGrams(0.0001), '<0.01 g');
  assert.equal(formatGrams(null), 'Not entered');
});

test('fractional serving boundaries are classified without floating-point division error', () => {
  const cases = [
    { type: 'food', quantity: 24.6, sugars: 1.23, level: 1 },
    { type: 'food', quantity: 24.6, sugars: 5.535, level: 2 },
    { type: 'drink', quantity: 49.2, sugars: 1.23, level: 1 },
    { type: 'drink', quantity: 49.2, sugars: 5.535, level: 2 },
  ];
  for (const value of cases) {
    const label = { ...product, ...value, basis: 'serving', carbs: null };
    assert.equal(evaluateProduct(label).level, value.level);
    assert.equal(evaluateProduct({ ...label, sugars: Number((value.sugars + 0.001).toFixed(3)) }).level, value.level + 1);
  }
});

test('numeric input accepts decimal comma and never treats missing, malformed or negative numbers as zero', () => {
  assert.equal(parseNumber('8,5', 'sugars'), 8.5);
  assert.equal(parseNumber('0', 'sugars'), 0);
  assert.equal(parseNumber('', 'carbs', { optional: true }), null);
  for (const value of ['', ' ', '-1', '8g', '1e2', '3.2.1', 'Infinity']) assert.throws(() => parseNumber(value, 'sugars'));
  assert.throws(() => parseNumber('0', 'portion', { positive: true }), /greater than 0/);
});

test('retail barcode validation and GS1 extraction canonicalise equivalent UPC and EAN forms', () => {
  assert.equal(normalizeBarcode('4006381333931'), '04006381333931');
  assert.equal(normalizeBarcode('036000291452'), normalizeBarcode('0036000291452'));
  assert.equal(scannedBarcode(']d2010400638133393117261231'), product.barcode);
  assert.equal(scannedBarcode('(01)04006381333931(17)261231'), product.barcode);
  assert.throws(() => normalizeBarcode('4006381333932'), /check digit/);
  assert.throws(() => scannedBarcode('https://example.org/product'), /product code/);
});

test('invalid label relationships, missing required values and bad backups are rejected', () => {
  assert.throws(() => validateProduct({ ...product, sugars: 10, carbs: 5 }), /part of total/);
  assert.throws(() => validateProduct({ ...product, sugars: null }), /total sugars/);
  assert.throws(() => validateProduct({ ...product, quantity: 0 }), /label quantity/);
  assert.throws(() => validateProduct({ ...product, sugars: 101, carbs: null }), /exceed/);
  assert.throws(() => validateProduct({ ...product, enteredAt: '2026-02-30' }), /entry date/);
  assert.throws(() => validateBackup({ version: 1, products: [product, { ...product, id: 'p2' }] }), /barcodes/);
  assert.throws(() => validateBackup({ version: 2, products: [] }), /v1 backup/);
});

test('saving a previously scanned barcode replaces its local record instead of duplicating it', () => {
  const next = upsertProduct([product], { ...product, id: 'new-id', sugars: 4 });
  assert.equal(next.length, 1);
  assert.equal(next[0].id, 'p1');
  assert.equal(next[0].sugars, 4);
});

test('storage round-trips labels and exposes corrupt data and failed writes', () => {
  let raw = null;
  const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
  assert.deepEqual(loadProducts(storage), []);
  saveProducts([product], storage);
  assert.deepEqual(loadProducts(storage), [product]);
  raw = '{bad';
  assert.throws(() => loadProducts(storage), SyntaxError);
  assert.throws(() => saveProducts([product], { setItem: () => { throw new Error('Quota exceeded'); } }), /Quota/);
});
