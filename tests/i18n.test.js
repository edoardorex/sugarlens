import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, setLanguage, t, formatDate } from '../src/i18n.js';
import { formatGrams } from '../src/domain.js';

afterEach(() => setLanguage('en'));

test('device-region default falls back to supported browser languages without a location request', () => {
  assert.equal(detectLanguage(['en-US'], 'Europe/Rome'), 'it');
  assert.equal(detectLanguage(['en-US'], 'Europe/Paris'), 'fr');
  assert.equal(detectLanguage(['it-IT'], 'America/Mexico_City'), 'es');
  assert.equal(detectLanguage(['de-DE', 'fr-CA'], 'Europe/Zurich'), 'fr');
  assert.equal(detectLanguage(['ja-JP'], 'Asia/Tokyo'), 'en');
});

test('localized messages keep product names literal and translate nested validation errors', () => {
  setLanguage('it');
  assert.equal(t('Open saved label for Food'), 'Apri etichetta di Food');
  assert.match(t('Online lookup failed: This barcode is not in Open Food Facts.'), /^Ricerca online fallita: Questo codice/);
  assert.match(t('Enter your amount as a number, using a dot or comma for decimals.'), /^Inserisci la quantità/);
  assert.match(t('Saved label entered 2026-11-16. Recipes and labels can change; recheck this package.'), new RegExp(formatDate('2026-11-16')));
  assert.equal(formatGrams(2.5, 'it'), '2,5 g');
  assert.equal(formatGrams(.004, 'it'), '<0,01 g');
  assert.equal(t('Device error with unknown details'), 'Device error with unknown details');
  setLanguage('fr');
  assert.match(t('per 25.5 g serving, converted to per 100 g'), /^par portion de 25,5 g/);
});
