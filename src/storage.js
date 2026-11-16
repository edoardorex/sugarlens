import { STORAGE_KEY, validateBackup } from './domain.js';

export function loadProducts(storage = localStorage) {
  const raw = storage.getItem(STORAGE_KEY);
  return raw === null ? [] : validateBackup(JSON.parse(raw));
}

export function saveProducts(products, storage = localStorage) {
  const backup = { version: 1, products };
  validateBackup(backup);
  storage.setItem(STORAGE_KEY, JSON.stringify(backup));
}
