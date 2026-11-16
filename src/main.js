import './style.css';
import {
  STORAGE_KEY, THRESHOLDS, escapeHTML as h, evaluateProduct, formatGrams as rawGrams,
  normalizeBarcode, parseNumber, scannedBarcode, todayISO, upsertProduct,
  validateBackup, validateProduct,
} from './domain.js';
import { loadProducts, saveProducts } from './storage.js';
import { cameraError, createScanner, stopVideo } from './scanner.js';
import { registerOffline } from './offline.js';
import { catalogueCode, lookupNutrition } from './lookup.js';
import { createFeedback } from './feedback.js';
import { initRecipes } from './recipe-ui.js';
import { LANGUAGE_KEY, LANGUAGES, detectLanguage, getLanguage, setLanguage, t, setText, translateStatic, translatedMarkup, refreshTranslations, formatNumber } from './i18n.js';

setLanguage(detectLanguage(navigator.languages, Intl.DateTimeFormat().resolvedOptions().timeZone));
let languageReadError;
try {
  const saved = localStorage.getItem(LANGUAGE_KEY);
  if (saved !== null) setLanguage(saved);
} catch (error) { languageReadError = error; }
function formatGrams(value) { return t(rawGrams(value, getLanguage())); }

const scanIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1 1v4M3 16v4a1 1 0 0 0 1 1h4m8 0h4a1 1 0 0 0 1-1v-4M8 8v8m4-8v8m4-8v8"/></svg>';
const arrowIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m8 5 7 7-7 7"/></svg>';
let products = [];
let storageBlocked = false;
let current;
let currentSaved = false;
let controls;
let session = 0;
let toastTimer;
let activateUpdate;
let deferredInstall;
let lookupController;
let quickScan = false;
let preferences = { online: true, sound: true, vibration: true };
const PREFERENCES_KEY = 'sugarlens.preferences.v1';

document.querySelector('#app').innerHTML = `
  <a class="skip-link" href="#saved-title">Skip to saved labels</a>
  <header class="topbar">
    <a class="brand" href="./" aria-label="SugarLens home"><span>${scanIcon}</span>SugarLens<span class="brand-dot">.</span></a>
    <div class="topbar-actions"><div class="language-selector"><label class="sr-only" for="language">Language</label><select id="language" aria-describedby="language-help">${Object.entries(LANGUAGES).map(([key, name]) => `<option value="${key}">${name}</option>`).join('')}</select></div><button class="icon-button" id="open-guide" type="button" aria-label="About, privacy and medical limitations">?</button></div>
  </header>
  <main>
    <section class="hero" aria-labelledby="hero-title">
      <div class="eyebrow"><span class="local-dot"></span> PRIVATE LABEL HELP. NOT MEDICAL ADVICE.</div>
      <h1 id="hero-title">A little clarity<br />in your <span>basket.</span></h1>
      <p>Scan. Choose your amount.<br />See the sugar. Saved automatically.</p>
      <button class="button primary scan-cta" id="scan-product" type="button">${scanIcon} Scan a product</button>
      <button class="text-button" id="manual-product" type="button">Enter a label manually ${arrowIcon}</button>
      <div class="scan-settings" aria-label="Scan preferences">
        <label><input type="checkbox" id="online-lookup" checked />Online lookup</label>
        <label><input type="checkbox" id="scan-sound" aria-describedby="feedback-note" checked />Sound</label>
        <label><input type="checkbox" id="scan-vibration" aria-describedby="feedback-note" checked />Vibration</label>
      </div>
      <p class="lookup-privacy" id="lookup-privacy">Online lookup sends the barcode to Open Food Facts. Camera images and your library stay on this device.</p>
      <p class="field-help feedback-note" id="feedback-note" role="status" hidden></p>
      <div class="offline-line"><span class="status-dot" aria-hidden="true"></span><span id="offline-status" role="status">Preparing offline mode...</span></div>
      <div class="install-actions"><button class="text-button" id="install" type="button" hidden>Add to home screen</button><button class="text-button" id="install-help" type="button">How to install</button><button class="text-button" id="update" type="button" hidden>Update available</button></div>
      <div class="hero-orbit" aria-hidden="true"><div class="sugar-cube cube-one"></div><div class="sugar-cube cube-two"></div><div class="orbit-dot"></div></div>
    </section>
    <aside class="safety-note" aria-label="Medical limitation"><span class="note-icon" aria-hidden="true">i</span><p><strong>A label helper. Not a diabetes safety rating.</strong> Lower sugar does not mean diabetes-safe. Total carbohydrate, portions and your individual care plan matter. Educational use only.</p></aside>
    <section class="recipe-launch" aria-labelledby="recipe-launch-title"><div><p class="eyebrow">A LITTLE KITCHEN INSPIRATION</p><h2 id="recipe-launch-title">What could you cook?</h2><p>Photo. Confirm ingredients. Get a cooking idea, not a medical meal plan.</p></div><button class="button secondary" id="open-recipes" type="button">Photo &amp; recipe</button></section>
    <section class="storage-error" id="storage-error" role="alert" hidden><p id="storage-message"></p><div><button class="button secondary" id="export-raw" type="button">Export original data</button><button class="text-button" id="reset-storage" type="button">Reset local labels</button></div></section>
    <section class="collection" aria-labelledby="saved-title">
      <div class="section-heading"><div><p class="eyebrow">YOUR PRIVATE LITTLE LIBRARY</p><h2 id="saved-title" tabindex="-1">Saved labels <span id="saved-count">0</span></h2></div><div class="backup-actions"><button class="text-button" id="export" type="button">Export</button><button class="text-button" id="import" type="button">Import</button></div></div>
      <label class="search"><span aria-hidden="true">&#8981;</span><input type="search" id="search" aria-label="Search saved products" placeholder="Find a saved product..." maxlength="80" /></label>
      <div class="product-list" id="product-list"></div>
      <p class="library-note">Scan to recall a saved label or find nutrition on Open Food Facts. Missing entry? Copy the package. Always recheck its current label.</p>
    </section>
    <footer><span>No photo uploads. No accounts. Optional online barcode lookup.</span><button class="text-button" id="footer-guide" type="button">How the score works</button></footer>
  </main>
  <nav class="mobile-dock" aria-label="Mobile product actions">
    <button class="button primary" id="dock-scan" type="button">${scanIcon} Scan product</button>
    <button class="button secondary" id="dock-label" type="button">+ New label</button>
  </nav>
  <dialog id="product-dialog" aria-labelledby="product-title">
    <div class="sheet-heading"><div><p class="eyebrow" id="product-kicker">LET THE LABEL DO THE TALKING</p><h2 id="product-title" tabindex="-1">Read a label</h2></div><button class="icon-button" id="close-product" type="button" aria-label="Close label">&times;</button></div>
    <p class="entry-note" id="entry-note">Nutrition stays on this device. Copy the current package, not a guessed value.</p>
    <div class="lookup-state" id="lookup-state" role="status" hidden><span class="lookup-spinner" aria-hidden="true"></span><p>Finding nutrition on Open Food Facts...</p><button class="text-button" id="cancel-lookup" type="button">Cancel and enter manually</button></div>
    <p class="source-note" id="source-note" hidden></p>
    <section id="scan-missing" class="scan-missing" hidden aria-label="Scan lookup status">
      <p id="missing-reason"></p>
      <button class="button primary full-width" id="missing-scan" type="button">Scan again ${scanIcon}</button>
      <button class="text-button full-width" id="missing-manual" type="button">Enter a label manually</button>
    </section>
    <section id="quick-portion" hidden aria-label="Choose your amount">
      <div class="quick-types" role="group" aria-label="Food or drink"><button class="button secondary" type="button" data-quick-type="food">Food · g</button><button class="button secondary" type="button" data-quick-type="drink">Drink · ml</button></div>
      <p class="field-help" id="quick-type-note">Type from the catalogue or saved label. Check the package; change it here if needed.</p>
      <h3>How much?</h3>
      <div class="quick-amounts" id="quick-amounts"></div>
      <form id="quick-form"><label for="quick-quantity" id="quick-quantity-label">Custom amount (g)</label><div class="quick-custom"><input id="quick-quantity" inputmode="decimal" required placeholder="Your amount" /><button class="button primary" type="submit">See score ${arrowIcon}</button></div></form>
      <p class="field-help">Amounts are examples, not recommended servings. Choosing an amount shows the score and saves this label on your device.</p>
      <p class="form-error" id="quick-error" role="alert" hidden></p>
    </section>
    <form id="label-form">
      <details class="barcode-details"><summary>Product barcode <span id="barcode-caption">optional</span></summary><label class="sr-only" for="product-barcode">Product barcode</label><input id="product-barcode" name="barcode" inputmode="numeric" maxlength="14" placeholder="Printed EAN / UPC digits" /><div class="barcode-actions"><button class="text-button" id="lookup-online" type="button">Find nutrition online</button><button class="text-button" id="recall" type="button">Look up in my saved labels</button></div></details>
      <label for="product-name">Product name</label><input id="product-name" name="name" required maxlength="80" placeholder="e.g. Breakfast cereal" autocomplete="off" />
      <div class="form-row"><div><label for="product-type">Product type</label><select id="product-type" name="type" required><option value="food">Food (grams)</option><option value="drink">Drink (millilitres)</option><option value="" disabled hidden>Confirm food or drink</option></select></div><div><label for="label-basis">Label values are</label><select id="label-basis" name="basis"><option value="hundred">Per 100 g</option><option value="serving">Per labelled serving</option></select></div></div>
      <div id="label-quantity-row" hidden><label for="label-quantity" id="quantity-label">Labelled serving size (g)</label><input id="label-quantity" name="quantity" inputmode="decimal" placeholder="e.g. 30" aria-describedby="quantity-help" /><p class="field-help" id="quantity-help">Use grams or millilitres, not pieces, cups or ounces. Convert using the package's stated weight or volume.</p></div>
      <div class="nutrition-inputs"><div><label for="label-sugars">Total sugars (g)</label><input id="label-sugars" name="sugars" required inputmode="decimal" placeholder="e.g. 8.5" aria-describedby="sugars-help" /><p id="sugars-help" class="field-help">Use total sugars / "of which sugars", not added sugars.</p></div><div><label for="label-carbs">Total carbohydrate (g) <span>optional</span></label><input id="label-carbs" name="carbs" inputmode="decimal" placeholder="e.g. 62" aria-describedby="carbs-help" /><p id="carbs-help" class="field-help">Same label basis. Include total carbs, not "net carbs".</p></div></div>
      <label for="my-portion" id="portion-label">Your portion (g) <span>optional</span></label><input id="my-portion" name="portion" inputmode="decimal" placeholder="Amount you are considering, not a recommended serving" />
      <p class="form-error" id="form-error" role="alert" hidden></p>
      <button class="button primary full-width" type="submit">Show sugar score ${arrowIcon}</button>
    </form>
    <p id="auto-save-status" class="auto-save-status" role="status" hidden></p>
    <section id="result" hidden aria-label="Sugar label result"></section>
    <div id="result-actions" hidden><button class="button primary full-width" id="save-label" type="button">Save label locally</button><button class="button primary full-width" id="scan-next" type="button" hidden>${scanIcon} Scan next product</button><div class="result-secondary"><button class="text-button" id="change-amount" type="button" hidden>Change amount</button><button class="text-button" id="edit-label" type="button">Edit numbers</button><button class="text-button danger" id="delete-label" type="button" hidden>Delete saved label</button></div></div>
    <p class="sheet-disclaimer">No diagnosis, treatment advice, blood-glucose prediction or insulin dosing. Never change medication or your care plan based on this app.</p>
  </dialog>
  <dialog id="camera-dialog" aria-labelledby="camera-title">
    <div class="sheet-heading"><div><p class="eyebrow">ON-DEVICE CAMERA. OPTIONAL ONLINE LOOKUP.</p><h2 id="camera-title">Find the barcode</h2></div><button class="icon-button" id="close-camera" type="button" aria-label="Close camera">&times;</button></div>
    <p class="entry-note">Hold the entire barcode in view, with good light. A rear camera is preferred when available.</p>
    <div class="video-frame"><video id="camera" autoplay muted playsinline></video><div class="scan-guide" aria-hidden="true"></div></div>
    <p id="camera-status" role="status">Starting the camera...</p>
    <p class="field-help">A barcode identifies the product. With online lookup enabled, new codes are sent to Open Food Facts for nutrition. Saved labels work offline. Camera frames are never saved or uploaded.</p>
    <button class="button secondary full-width" id="camera-manual" type="button">Use manual entry</button>
  </dialog>
  <dialog id="guide-dialog" aria-labelledby="guide-title">
    <div class="sheet-heading"><div><p class="eyebrow">CLARITY, WITH LIMITS</p><h2 id="guide-title">A little context</h2></div><button class="icon-button" id="close-guide" type="button" aria-label="Close information">&times;</button></div>
    <div class="guide-content">
      <p id="language-help">Language follows your device region/time zone, then browser language. No GPS or location request. Change it anytime.</p>
      <h3>The score is sugar density. Nothing more.</h3><p>1/3 = lower, 2/3 = medium, 3/3 = higher total sugar per 100 g of food or 100 ml of drink. It is a simple UK label-guidance band, not a percentage, a Nutri-Score, a health rating or a clinical risk score.</p>
      <table><caption>Total sugar thresholds</caption><thead><tr><th>Band</th><th>Food / 100 g</th><th>Drink / 100 ml</th></tr></thead><tbody><tr><th>1 · Lower</th><td>&le; 5 g</td><td>&le; 2.5 g</td></tr><tr><th>2 · Medium</th><td>&gt; 5 to 22.5 g</td><td>&gt; 2.5 to 11.25 g</td></tr><tr><th>3 · Higher</th><td>&gt; 22.5 g</td><td>&gt; 11.25 g</td></tr></tbody></table>
      <p>Only the per-100 sugar thresholds are used. The full UK front-of-pack scheme also has portion criteria and other nutrients; this app does not reproduce that scheme.</p>
      <h3>Diabetes cannot be reduced to a sugar score.</h3><p>Starch and other carbohydrates matter too. A low-sugar food can still contain substantial carbohydrate. Portion size, fibre, food preparation, activity, medication and individual response all matter. This app does not assess glycaemic index, predict glucose changes or determine whether food is safe for you.</p>
      <p><strong>Do not use this app for insulin dosing, treating a hypo, emergencies, diagnosis, or medication changes.</strong> Follow your existing care plan and ask your clinician or registered dietitian for personalised guidance. High-sugar products can have a role in a prescribed hypo plan; this app must not override it.</p>
      <h3>Read the actual package.</h3><p>Manually entered and community-supplied catalogue values may be mistaken, incomplete, rounded or out of date. Confirm the product, food/drink type and per-100 units before scoring. Online values use the as-sold, unprepared label when available, never estimated or added-sugar values. Use total sugars and total carbohydrate on the same basis. US-style per-serving labels can be converted only when the serving's weight or volume is known. Fibre and sugar-alcohol labelling conventions vary by country. The optional portion calculation is arithmetic, not a recommended serving.</p>
      <h3>Local library. Optional online lookup.</h3><p>Online lookup is on by default. Scanning a new barcode or tapping "Find nutrition online" sends that code to Open Food Facts, which also receives ordinary request metadata such as your IP address and browser information. No photos, saved library, portions or health information are sent. No accounts, analytics or external fonts. Turn off Online lookup for local-only scans and manual entry. Saved labels are recalled without network requests.</p>
      <p>Data is not encrypted; someone using this browser profile can read it. Backups contain product names, nutrition values and catalogue attribution: keep them private. Clearing site data or private browsing may erase your library.</p>
      <h3>Colors, sound and a little tap.</h3><p>Green = lower, amber = medium, red = higher sugar density. The number and text always accompany color; green does not mean diabetes-safe. A scan gives a gentle confirmation; a score gives one, two or three short pulses. Sound and vibration can be switched off separately. Browser support, silent settings and user-interaction restrictions may prevent feedback; iPhone Safari does not support web vibration.</p><button class="text-button" id="try-feedback" type="button">Try scan feedback</button>
      <h3>Open data, with attribution.</h3><p>Catalogue data comes from <a href="https://world.openfoodfacts.org/" target="_blank" rel="noopener noreferrer">Open Food Facts</a>, under the <a href="https://opendatacommons.org/licenses/odbl/1.0/" target="_blank" rel="noopener noreferrer">Open Database License</a> and <a href="https://opendatacommons.org/licenses/dbcl/1.0/" target="_blank" rel="noopener noreferrer">Database Contents License</a>. Imported labels retain their source and retrieval date. No product photos are fetched. Open Food Facts does not endorse this app.</p>
      <h3>Offline means prepared first.</h3><p>Open the app online once and wait for "Ready offline". App assets, including the scanner, are cached on your device. Your browser may evict cached files or stored data; exporting a backup is recommended. Safari: Share &rarr; Add to Home Screen. Android Chrome: browser menu &rarr; Install app / Add to Home screen. Installation is optional.</p>
      <h3>Sources, not endorsements.</h3><p>The explanations are bundled offline. The links below open external pages only if chosen and require internet access.</p>
      <a href="https://www.nhs.uk/live-well/eat-well/food-guidelines-and-food-labels/how-to-read-food-labels/" target="_blank" rel="noopener noreferrer">NHS: reading food labels &#8599;</a>
      <a href="https://www.gov.uk/government/publications/front-of-pack-nutrition-labelling-guidance" target="_blank" rel="noopener noreferrer">UK front-of-pack guidance (food and drink criteria) &#8599;</a>
      <a href="https://www.diabetes.org.uk/living-with-diabetes/eating/i-have-type-1-diabetes" target="_blank" rel="noopener noreferrer">Diabetes UK: carbohydrates and individual care &#8599;</a>
    </div>
  </dialog>
  <input type="file" id="import-file" accept=".json,application/json" hidden />
  <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
`;
translateStatic(document.querySelector('#app'));
document.documentElement.lang = getLanguage();
document.title = `SugarLens — ${t('A little clarity')}`;
document.querySelector('#language').value = getLanguage();

const form = document.querySelector('#label-form');
const productDialog = document.querySelector('#product-dialog');
const cameraDialog = document.querySelector('#camera-dialog');
const guideDialog = document.querySelector('#guide-dialog');
const recipes = initRecipes();
let video = document.querySelector('#camera');
let cleanForm = formSnapshot();

function syncViewport() {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  if (!viewport || viewport.scale !== 1) {
    root.style.removeProperty('--visible-height');
    root.style.removeProperty('--keyboard-inset');
    return;
  }
  root.style.setProperty('--visible-height', `${viewport.height}px`);
  root.style.setProperty('--keyboard-inset', `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
}
window.visualViewport?.addEventListener('resize', syncViewport);
window.visualViewport?.addEventListener('scroll', syncViewport);
window.addEventListener('resize', syncViewport);
syncViewport();

function formSnapshot() {
  return JSON.stringify([...new FormData(form)]);
}

function closeProduct() {
  if (formSnapshot() !== cleanForm && !confirm(t('Discard this label\'s unsaved changes? Save it locally first if you want to keep it.'))) return;
  productDialog.close();
}

function cancelLookup() {
  lookupController?.abort();
  lookupController = undefined;
  document.querySelector('#lookup-state').hidden = true;
}
productDialog.addEventListener('close', cancelLookup);

function notify(message, error = false) {
  clearTimeout(toastTimer);
  const toast = document.querySelector('#toast');
  (guideDialog.open ? guideDialog : cameraDialog.open ? cameraDialog : productDialog.open ? productDialog : document.body).append(toast);
  setText(toast, message);
  toast.classList.toggle('error', error);
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 12_000 : 6000);
}
if (languageReadError) notify(`Language preference could not be read: ${languageReadError.message}. Using the device default.`, true);
document.querySelector('#language').addEventListener('change', (event) => {
  setLanguage(event.target.value);
  document.documentElement.lang = getLanguage();
  document.title = `SugarLens — ${t('A little clarity')}`;
  refreshTranslations();
  recipes.refresh();
  updateBasis();
  renderPreferences();
  renderLibrary();
  if (productDialog.open && current) {
    if (!document.querySelector('#result').hidden) showResult();
    else if (!document.querySelector('#quick-portion').hidden) {
      const amount = document.querySelector('#quick-quantity').value;
      showQuickPortion();
      document.querySelector('#quick-quantity').value = amount;
    } else showSource();
  }
  try { localStorage.setItem(LANGUAGE_KEY, getLanguage()); }
  catch (error) { notify(`Language not saved: ${error.message}. Your choice applies for this visit only.`, true); }
});

const feedback = createFeedback(() => preferences, (message) => {
  setText(document.querySelector('#feedback-note'), message);
  document.querySelector('#feedback-note').hidden = false;
  notify(message, true);
});
try {
  const raw = localStorage.getItem(PREFERENCES_KEY);
  if (raw !== null) {
    const value = JSON.parse(raw);
    if (!value || ['online', 'sound', 'vibration'].some((key) => typeof value[key] !== 'boolean')) throw new Error('Invalid scan preferences.');
    preferences = { online: value.online, sound: value.sound, vibration: value.vibration };
  }
} catch (error) {
  notify(`Preferences could not be read: ${error.message}. Default switches are active; changing one replaces the stored preferences.`, true);
}
function renderPreferences() {
  setText(document.querySelector('#lookup-privacy'), preferences.online
    ? 'Online lookup sends the barcode to Open Food Facts. Camera images and your library stay on this device.'
    : 'Local-only mode. Scans recall saved labels; new products need manual entry. No catalogue requests.');
  document.querySelector('#lookup-online').disabled = !preferences.online;
  for (const [key, id] of [['online', 'online-lookup'], ['sound', 'scan-sound'], ['vibration', 'scan-vibration']]) {
    document.querySelector(`#${id}`).checked = preferences[key];
    if (key !== 'online') document.querySelector(`#${id}`).disabled = !feedback.support[key];
  }
}
for (const [key, id] of [['online', 'online-lookup'], ['sound', 'scan-sound'], ['vibration', 'scan-vibration']]) {
  document.querySelector(`#${id}`).addEventListener('change', (event) => {
    preferences[key] = event.target.checked;
    if (key === 'sound' && preferences.sound) void feedback.unlock();
    if (key !== 'online' && !preferences[key]) feedback.stop();
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); }
    catch (error) { notify(`Preferences not saved: ${error.message}. The switches apply for this visit only.`, true); }
    renderPreferences();
  });
}
renderPreferences();
if (!feedback.support.sound || !feedback.support.vibration) {
  const unavailable = [!feedback.support.sound && 'Sound', !feedback.support.vibration && 'Vibration'].filter(Boolean);
  setText(document.querySelector('#feedback-note'), `${unavailable.join(' and ')} ${unavailable.length === 1 ? 'is' : 'are'} unavailable in this browser. Colors and text always work.`);
  document.querySelector('#feedback-note').hidden = false;
}
document.querySelector('#try-feedback').addEventListener('click', async () => { await feedback.unlock(); feedback.play(); });

document.querySelector('#dock-scan').addEventListener('click', () => document.querySelector('#scan-product').click());
document.querySelector('#dock-label').addEventListener('click', () => openProduct());

function showStorageError(error) {
  storageBlocked = true;
  setText(document.querySelector('#storage-message'), `Local labels could not be read: ${error.message}. Saving is blocked to protect the original data. Export it, restore a valid backup, or explicitly reset it. Label checking still works.`);
  document.querySelector('#storage-error').hidden = false;
}

try { products = loadProducts(); } catch (error) { showStorageError(error); }

function persist(next) {
  if (storageBlocked) return false;
  try {
    saveProducts(next);
    products = next;
    renderLibrary();
    return true;
  } catch (error) {
    notify(`Not saved: ${error.message}. Check browser storage permissions or available space.`, true);
    return false;
  }
}

function renderLibrary() {
  document.body.classList.toggle('has-products', products.length > 0);
  document.querySelector('#saved-count').textContent = products.length;
  document.querySelector('#export').disabled = products.length === 0 || storageBlocked;
  const query = document.querySelector('#search').value.trim().toLocaleLowerCase(getLanguage());
  const visible = products.filter((item) => `${item.name} ${item.barcode}`.toLocaleLowerCase(getLanguage()).includes(query)).sort((a, b) => a.name.localeCompare(b.name, getLanguage()));
  document.querySelector('#product-list').innerHTML = translatedMarkup(visible.length ? visible.map((item) => {
    const score = evaluateProduct(item);
    return `<button class="product-card" type="button" data-product="${h(item.id)}" aria-label="Open saved label for ${h(item.name)}"><span class="product-symbol ${score.key}" aria-hidden="true">${item.type === 'drink' ? '&#9707;' : '&#9633;'}</span><span class="product-card-copy"><strong data-no-translate>${h(item.name)}</strong><span>${h(formatGrams(score.sugarPer100))} sugar / 100 ${score.unit}</span></span><span class="band-tag ${score.key}">${score.level}/3<span>${score.label}</span></span>${arrowIcon}</button>`;
  }).join('') : `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">${scanIcon}</span><h3>${products.length ? 'Nothing matches yet.' : 'Your labels live here.'}</h3><p>${products.length ? 'Try another name or barcode.' : 'Scan. Choose an amount.<br />The result saves automatically.'}</p></div>`);
}

function updateBasis() {
  const unit = THRESHOLDS[form.elements.type.value]?.unit || 'g/ml';
  setText(form.elements.basis.options[0], `Per 100 ${unit}`);
  document.querySelector('#label-quantity-row').hidden = form.elements.basis.value !== 'serving';
  form.elements.quantity.required = form.elements.basis.value === 'serving';
  setText(document.querySelector('#quantity-label'), `Labelled serving size (${unit})`);
  document.querySelector('#portion-label').innerHTML = translatedMarkup(`Your portion (${unit}) <span>optional</span>`);
}

function showForm() {
  document.querySelector('#auto-save-status').hidden = true;
  document.querySelector('#quick-portion').hidden = true;
  document.querySelector('#scan-missing').hidden = true;
  form.hidden = false;
  document.querySelector('#result').hidden = true;
  document.querySelector('#result-actions').hidden = true;
  setText(document.querySelector('#product-title'), 'Read a label');
  document.querySelector('#form-error').hidden = true;
}

function fillForm(product) {
  form.elements.name.value = product.name;
  form.elements.barcode.value = product.barcode;
  form.elements.type.value = product.type;
  form.elements.basis.value = product.basis;
  form.elements.quantity.value = product.basis === 'serving' ? product.quantity : '';
  form.elements.sugars.value = product.sugars;
  form.elements.carbs.value = product.carbs ?? '';
  form.elements.portion.value = product.portion ?? '';
  setText(document.querySelector('#barcode-caption'), product.barcode ? 'captured' : 'optional');
  updateBasis();
}

function openProduct(product, barcode = '', { focus = true } = {}) {
  cancelLookup();
  quickScan = false;
  current = product;
  currentSaved = Boolean(product);
  form.reset();
  showForm();
  updateBasis();
  form.elements.barcode.value = barcode;
  setText(document.querySelector('#barcode-caption'), barcode ? 'captured' : 'optional');
  form.querySelector('.barcode-details').open = Boolean(barcode);
  document.querySelector('#source-note').hidden = true;
  setText(document.querySelector('#entry-note'), barcode ? 'New barcode. Check the current package label before scoring.' : 'Nutrition stays on this device. Copy the current package, not a guessed value.');
  productDialog.showModal();
  if (product) {
    fillForm(product);
    showResult();
  } else if (focus) {
    form.elements.name.focus();
  }
  cleanForm = formSnapshot();
}

function showSource() {
  const note = document.querySelector('#source-note');
  note.hidden = !current?.source;
  if (current?.source) {
    note.innerHTML = `<a href="https://world.openfoodfacts.org/product/${catalogueCode(current.barcode)}" target="_blank" rel="noopener noreferrer">Open Food Facts &#8599;</a> ${h(t('· retrieved {date}. {detail}', { date: current.source.retrievedAt, detail: quickScan ? 'Check the current package.' : 'Community data, possibly edited locally. Check this package, food/drink type and units.' }))}`;
  }
}

function showMissing(reason, title = 'Product not found') {
  document.querySelector('#auto-save-status').hidden = true;
  form.hidden = true;
  document.querySelector('#result').hidden = true;
  document.querySelector('#result-actions').hidden = true;
  document.querySelector('#quick-portion').hidden = true;
  document.querySelector('#source-note').hidden = true;
  document.querySelector('#scan-missing').hidden = false;
  setText(document.querySelector('#product-title'), title);
  setText(document.querySelector('#entry-note'), 'No usable nutrition to score. Nothing was added to your library.');
  setText(document.querySelector('#missing-reason'), reason);
  productDialog.scrollTop = 0;
  document.querySelector('#product-title').focus({ preventScroll: true });
}

function showQuickPortion() {
  document.querySelector('#auto-save-status').hidden = true;
  form.hidden = true;
  document.querySelector('#result').hidden = true;
  document.querySelector('#result-actions').hidden = true;
  document.querySelector('#scan-missing').hidden = true;
  document.querySelector('#quick-portion').hidden = false;
  document.querySelector('#quick-error').hidden = true;
  document.querySelector('#product-title').textContent = current.name;
  setText(document.querySelector('#entry-note'), 'Choose your amount. The score and local save happen automatically.');
  const unit = THRESHOLDS[current.type].unit;
  for (const button of document.querySelectorAll('[data-quick-type]')) button.setAttribute('aria-pressed', String(button.dataset.quickType === current.type));
  setText(document.querySelector('#quick-quantity-label'), `Custom amount (${unit})`);
  document.querySelector('#quick-amounts').innerHTML = (current.type === 'drink' ? [100, 250, 330] : [25, 50, 100])
    .map((amount) => `<button class="button secondary" type="button" data-amount="${amount}">${amount} ${unit}</button>`).join('');
  document.querySelector('#quick-quantity').value = '';
  showSource();
  productDialog.scrollTop = 0;
  document.querySelector('#product-title').setAttribute('tabindex', '-1');
  document.querySelector('#product-title').focus({ preventScroll: true });
}

function openScannedProduct(barcode) {
  openProduct(undefined, barcode, { focus: false });
  quickScan = true;
  const saved = products.find((item) => item.barcode === barcode);
  if (saved) {
    current = saved;
    currentSaved = true;
    fillForm(saved);
    cleanForm = formSnapshot();
    showQuickPortion();
  } else {
    void findNutrition(barcode);
  }
}

async function findNutrition(barcode) {
  cancelLookup();
  if (!preferences.online || !navigator.onLine) {
    const message = !preferences.online
      ? 'Local-only mode. Enter the nutrition from this package.'
      : 'You are offline. This barcode has no saved label; enter the package nutrition or look it up when online.';
    if (quickScan) showMissing(message, 'Lookup unavailable');
    else setText(document.querySelector('#entry-note'), message);
    return;
  }
  const controller = new AbortController();
  lookupController = controller;
  document.querySelector('#lookup-state').hidden = false;
  setText(document.querySelector('#cancel-lookup'), quickScan ? 'Cancel lookup' : 'Cancel and enter manually');
  document.querySelector('#source-note').hidden = true;
  form.hidden = true;
  try {
    const product = await lookupNutrition(barcode, { signal: controller.signal });
    if (controller.signal.aborted || lookupController !== controller || !productDialog.open) return;
    current = product;
    currentSaved = false;
    fillForm(product);
    if (quickScan) {
      cleanForm = formSnapshot();
      showQuickPortion();
    } else {
      form.elements.type.value = '';
      updateBasis();
      showSource();
      setText(document.querySelector('#entry-note'), `Nutrition found. The catalogue suggests ${product.type === 'drink' ? 'a drink' : 'food'}, but categories can be wrong. Choose food or drink and check the per-100 values against this package before scoring. Your portion is never guessed.`);
    }
  } catch (error) {
    if (controller.signal.aborted || lookupController !== controller) return;
    const message = error.name === 'TimeoutError' ? 'Online lookup timed out.' : `Online lookup failed: ${error.message}`;
    if (quickScan) showMissing(message, error.name === 'ProductNotFoundError' ? 'Product not found' : 'Lookup unavailable');
    else {
      setText(document.querySelector('#entry-note'), `${message} Enter the package label manually; no score was guessed.`);
      notify(`${message} Manual entry is still available.`, true);
    }
  } finally {
    if (lookupController === controller) {
      lookupController = undefined;
      document.querySelector('#lookup-state').hidden = true;
      if (!quickScan) {
        form.hidden = false;
        if (current?.source) form.elements.type.focus();
      }
    }
  }
}
document.querySelector('#cancel-lookup').addEventListener('click', () => {
  cancelLookup();
  if (quickScan) { showMissing('Online lookup cancelled. Scan again when ready.', 'Lookup cancelled'); return; }
  form.hidden = false;
  setText(document.querySelector('#entry-note'), 'Online lookup cancelled. Copy the nutrition from this package.');
  form.elements.name.focus();
});
document.querySelector('#lookup-online').addEventListener('click', async () => {
  try {
    const barcode = normalizeBarcode(form.elements.barcode.value);
    if (formSnapshot() !== cleanForm && (form.elements.name.value || form.elements.sugars.value) && !confirm(t('Replace these unsaved values with online nutrition? Check the package after lookup.'))) return;
    await feedback.unlock();
    current = undefined;
    currentSaved = false;
    form.reset();
    form.elements.barcode.value = barcode;
    updateBasis();
    showForm();
    cleanForm = formSnapshot();
    await findNutrition(barcode);
  } catch (error) { notify(error.message, true); }
});

function showResult() {
  document.querySelector('#quick-portion').hidden = true;
  document.querySelector('#scan-missing').hidden = true;
  const score = evaluateProduct(current);
  const thresholds = THRESHOLDS[current.type];
  const result = document.querySelector('#result');
  const hasPortion = current.portion !== null;
  document.querySelector('#product-title').textContent = current.name;
  setText(document.querySelector('#entry-note'), currentSaved ? `Saved label entered ${current.enteredAt}. Recipes and labels can change; recheck this package.` : 'Based only on the label values you entered. Check the package before relying on the numbers.');
  if (current.source && !currentSaved) setText(document.querySelector('#entry-note'), 'Based on imported catalogue values and your edits. This is not verified nutrition or medical advice.');
  showSource();
  result.innerHTML = translatedMarkup(`
    <div class="score-card ${score.key}"><span class="eyebrow">SUGAR LEVEL, NOT DIABETES RISK</span><div class="score-main"><div><strong>${score.label}</strong><p>Total sugar per 100 ${score.unit}</p></div><span class="score-number">${score.level}<small>/ 3</small></span></div><div class="score-segments" aria-hidden="true">${['lower', 'medium', 'higher'].map((key, index) => `<span class="${key} ${index + 1 === score.level ? 'selected' : ''}"></span>`).join('')}</div><div class="score-legend"><span>1 Lower</span><span>2 Medium</span><span>3 Higher</span></div><p class="score-explanation">Green / amber / red = sugar density only. Green does not mean diabetes-safe.</p></div>
    <div class="nutrient-grid"><div><span>Sugars / 100 ${score.unit}</span><strong>${h(formatGrams(score.sugarPer100))}</strong></div><div><span>Total carbs / 100 ${score.unit}</span><strong>${h(formatGrams(score.carbsPer100))}</strong></div></div>
    <div class="portion-card"><div class="section-heading"><h3>Your portion</h3><span>${hasPortion ? `${h(formatNumber(current.portion))} ${score.unit}` : 'Not entered'}</span></div>${hasPortion ? `<div class="portion-values"><span>Sugars <strong>${h(formatGrams(score.sugarPerPortion))}</strong></span><span>Total carbs <strong>${h(formatGrams(score.carbsPerPortion))}</strong></span></div>` : '<p>No portion was entered, so per-portion amounts are unknown. Edit the numbers to add one.</p>'}<p class="field-help">Arithmetic only. This is not a recommended portion or an insulin-dosing calculation.</p></div>
    <div class="result-caution"><strong>Lower sugar does not mean diabetes-safe.</strong><p>${current.carbs === null ? 'Total carbohydrate was not entered. Sugar alone is not enough to understand carbohydrate amounts. Add total carbs from the label for more context.' : 'Total carbohydrate includes more than sugar. Even a lower-sugar product can contain substantial carbohydrate. These figures do not predict your blood-glucose response.'}</p></div>
    <details class="score-details"><summary>Why this band?</summary><p>${current.type === 'food' ? 'Food' : 'Drink'} thresholds per 100 ${score.unit}: lower &le; ${thresholds.low} g, medium &gt; ${thresholds.low} to ${thresholds.high} g, higher &gt; ${thresholds.high} g.</p><p>Entered label: ${h(formatGrams(current.sugars))} total sugars ${current.basis === 'hundred' ? `per 100 ${score.unit}` : `per ${h(current.quantity)} ${score.unit} serving, converted to per 100 ${score.unit}`}. Rounded display values do not change the band.</p><p>This uses UK sugar-density criteria, not the full front-of-pack scheme or a personalised diabetes assessment.</p><button class="text-button" type="button" id="result-guide">Read the sources and limitations</button></details>
  `);
  form.hidden = true;
  result.hidden = false;
  document.querySelector('#result-actions').hidden = false;
  document.querySelector('#save-label').disabled = storageBlocked || currentSaved;
  document.querySelector('#save-label').hidden = quickScan && currentSaved;
  setText(document.querySelector('#save-label'), storageBlocked ? 'Storage unavailable - checking only' : currentSaved ? 'Saved on this device' : quickScan ? 'Retry local save' : 'Save label locally');
  document.querySelector('#scan-next').hidden = !quickScan;
  document.querySelector('#change-amount').hidden = !quickScan;
  const savedStatus = document.querySelector('#auto-save-status');
  savedStatus.hidden = !quickScan;
  setText(savedStatus, currentSaved ? 'Saved automatically on this device.' : 'Not saved. Local storage is unavailable; your result is still shown.');
  savedStatus.classList.toggle('save-failed', !currentSaved);
  document.querySelector('#delete-label').hidden = !currentSaved;
  document.querySelector('#result-guide').addEventListener('click', () => guideDialog.showModal());
  productDialog.scrollTop = 0;
  document.querySelector('#product-title').setAttribute('tabindex', '-1');
  document.querySelector('#product-title').focus({ preventScroll: true });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const feedbackReady = feedback.unlock();
  try {
    const barcode = form.elements.barcode.value.trim() ? normalizeBarcode(form.elements.barcode.value) : '';
    const readNutrient = (key, label, optional = false) => current?.source && form.elements[key].value === String(current[key])
      ? current[key] : parseNumber(form.elements[key].value, label, { optional, max: 2000 });
    const source = current?.source && barcode === current.barcode ? current.source : undefined;
    const quantity = form.elements.basis.value === 'hundred' ? 100 : parseNumber(form.elements.quantity.value, 'labelled serving size', { positive: true, max: 2000 });
    current = validateProduct({
      id: current?.id || crypto.randomUUID(),
      name: form.elements.name.value,
      barcode,
      type: form.elements.type.value,
      basis: form.elements.basis.value,
      quantity,
      sugars: readNutrient('sugars', 'total sugars'),
      carbs: readNutrient('carbs', 'total carbohydrate', true),
      portion: parseNumber(form.elements.portion.value, 'your portion', { optional: true, positive: true, max: 5000 }),
      enteredAt: todayISO(),
      ...(source ? { source } : {}),
    });
    currentSaved = false;
    showResult();
    const scored = current;
    await feedbackReady;
    if (current === scored && productDialog.open) feedback.play(evaluateProduct(scored).level);
  } catch (error) {
    const message = document.querySelector('#form-error');
    setText(message, error.message);
    message.hidden = false;
    message.scrollIntoView({ block: 'nearest' });
  }
});

form.elements.type.addEventListener('change', updateBasis);
form.elements.basis.addEventListener('change', updateBasis);
document.querySelector('#manual-product').addEventListener('click', () => openProduct());
document.querySelector('#close-product').addEventListener('click', closeProduct);
productDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeProduct();
});
document.querySelector('#edit-label').addEventListener('click', () => {
  quickScan = false;
  fillForm(current);
  if (currentSaved) cleanForm = formSnapshot();
  showForm();
  setText(document.querySelector('#entry-note'), 'Check the current package and keep both nutrient values on the same label basis.');
  form.elements.sugars.focus();
});
function saveCurrentLabel() {
  if (!current || storageBlocked) return false;
  try {
    const next = upsertProduct(products, current);
    if (persist(next)) {
      current = products.find((item) => item.id === current.id || (current.barcode && item.barcode === current.barcode));
      currentSaved = true;
      cleanForm = formSnapshot();
      document.querySelector('#search').value = '';
      renderLibrary();
      return true;
    }
  } catch (error) { notify(error.message, true); }
  return false;
}
document.querySelector('#save-label').addEventListener('click', () => {
  if (saveCurrentLabel()) {
    showResult();
    notify('Saved on this device. Recheck the package next time: recipes can change.');
  }
});
async function scoreQuickAmount(value) {
  const ready = feedback.unlock();
  try {
    current = validateProduct({ ...current, portion: parseNumber(value, 'your amount', { positive: true, max: 5000 }) });
    currentSaved = false;
    fillForm(current);
    saveCurrentLabel();
    showResult();
    const scored = current;
    await ready;
    if (current === scored && productDialog.open) feedback.play(evaluateProduct(scored).level);
  } catch (error) {
    setText(document.querySelector('#quick-error'), error.message);
    document.querySelector('#quick-error').hidden = false;
  }
}
document.querySelector('#quick-amounts').addEventListener('click', (event) => {
  const button = event.target.closest('[data-amount]');
  if (button) void scoreQuickAmount(button.dataset.amount);
});
document.querySelector('#quick-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void scoreQuickAmount(document.querySelector('#quick-quantity').value);
});
document.querySelector('.quick-types').addEventListener('click', (event) => {
  const button = event.target.closest('[data-quick-type]');
  if (!button) return;
  current = { ...current, type: button.dataset.quickType };
  fillForm(current);
  showQuickPortion();
});
document.querySelector('#change-amount').addEventListener('click', showQuickPortion);
function scanNext() {
  closeProduct();
  if (!productDialog.open) document.querySelector('#scan-product').click();
}
document.querySelector('#scan-next').addEventListener('click', scanNext);
document.querySelector('#missing-scan').addEventListener('click', scanNext);
document.querySelector('#missing-manual').addEventListener('click', () => openProduct(undefined, form.elements.barcode.value));
document.querySelector('#delete-label').addEventListener('click', () => {
  if (!current || storageBlocked) return;
  if (confirm(t(`Delete the saved label for "${current.name}" from this browser?`)) && persist(products.filter((item) => item.id !== current.id))) {
    currentSaved = false;
    quickScan = false;
    showResult();
    notify('Local label deleted.');
  }
});
document.querySelector('#product-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-product]');
  if (button) openProduct(products.find((item) => item.id === button.dataset.product));
});
document.querySelector('#search').addEventListener('input', renderLibrary);
document.querySelector('#recall').addEventListener('click', () => {
  try {
    const barcode = normalizeBarcode(form.elements.barcode.value);
    const product = products.find((item) => item.barcode === barcode);
    if (!product) {
      notify('No local label for this code. Enter the nutrition from the package.');
      return;
    }
    if ((form.elements.sugars.value || form.elements.name.value) && !confirm(t('Replace the current form with this saved label? Recheck the package before using its values.'))) return;
    current = product;
    currentSaved = true;
    fillForm(product);
    cleanForm = formSnapshot();
    showResult();
  } catch (error) { notify(error.message, true); }
});

function downloadJSON(value, filename) {
  const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.querySelector('#export').addEventListener('click', () => {
  downloadJSON({ version: 1, products }, `sugarlens-backup-${todayISO()}.json`);
  notify('Backup downloaded. Product names and entered nutrition values are included; keep it private.');
});
document.querySelector('#export-raw').addEventListener('click', () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) throw new Error('No original data is available.');
    downloadJSON(raw, `sugarlens-original-${todayISO()}.json`);
  } catch (error) { notify(`Export failed: ${error.message}`, true); }
});
document.querySelector('#import').addEventListener('click', () => document.querySelector('#import-file').click());
document.querySelector('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('Backup must be smaller than 2 MB.');
    const next = validateBackup(JSON.parse(await file.text()));
    if (!confirm(t(`Replace your local library with ${next.length} labels from this backup? Imported values must be checked against current packages.`))) return;
    saveProducts(next);
    products = next;
    storageBlocked = false;
    document.querySelector('#storage-error').hidden = true;
    productDialog.close();
    renderLibrary();
    notify('Backup restored. Recheck imported labels before use.');
  } catch (error) { notify(`Import failed: ${error.message}. Existing data is unchanged.`, true); }
});
document.querySelector('#reset-storage').addEventListener('click', () => {
  if (!confirm(t('Permanently replace the unreadable SugarLens data with an empty library? Export the original first if you need it.'))) return;
  try {
    saveProducts([]);
    products = [];
    storageBlocked = false;
    document.querySelector('#storage-error').hidden = true;
    renderLibrary();
    notify('SugarLens local labels reset.');
  } catch (error) { notify(`Reset failed: ${error.message}`, true); }
});

function stopCamera() {
  session++;
  controls?.stop();
  controls = undefined;
  stopVideo(video);
}
function closeCamera() { stopCamera(); cameraDialog.close(); }
document.querySelector('#scan-product').addEventListener('click', async () => {
  void feedback.unlock();
  cameraDialog.showModal();
  const status = document.querySelector('#camera-status');
  setText(status, 'Starting the camera...');
  const token = ++session;
  const sessionVideo = video.cloneNode();
  video.replaceWith(sessionVideo);
  video = sessionVideo;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    setText(status, 'Camera scanning needs HTTPS or localhost and browser support. Use manual entry instead.');
    return;
  }
  try {
    const reader = await createScanner();
    if (token !== session) return;
    let found = false;
    const started = await reader.decodeFromConstraints({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    }, sessionVideo, (result, error, scanControls) => {
      if (token !== session || found) return;
      if (result) {
        try {
          const barcode = scannedBarcode(result.getText());
          found = true;
          scanControls.stop();
          closeCamera();
          feedback.play();
          openScannedProduct(barcode);
        } catch (parseError) {
          setText(status, parseError.message);
        }
      } else if (error && !['NotFoundException', 'ChecksumException', 'FormatException'].includes(error.name)) {
        setText(status, `Scan failed: ${error.message}. Try a clearer angle or manual entry.`);
      }
    });
    if (token !== session) {
      started.stop();
      stopVideo(sessionVideo);
      return;
    }
    controls = started;
    setText(status, 'Camera ready. Hold the barcode steady.');
  } catch (error) {
    if (token === session) {
      stopCamera();
      setText(status, cameraError(error));
    }
  }
});
document.querySelector('#close-camera').addEventListener('click', closeCamera);
document.querySelector('#camera-manual').addEventListener('click', () => { closeCamera(); openProduct(); });
cameraDialog.addEventListener('cancel', stopCamera);
cameraDialog.addEventListener('close', stopCamera);
window.addEventListener('pagehide', () => { stopCamera(); cancelLookup(); feedback.stop(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  feedback.stop();
  if (cameraDialog.open) closeCamera();
  if (lookupController) {
    cancelLookup();
    const message = 'Lookup paused while the app was in the background. Look up this barcode again or enter the package label.';
    if (quickScan) showMissing(message, 'Lookup paused');
    else { form.hidden = false; setText(document.querySelector('#entry-note'), message); }
  }
});

for (const id of ['open-guide', 'footer-guide', 'install-help']) document.querySelector(`#${id}`).addEventListener('click', () => guideDialog.showModal());
document.querySelector('#close-guide').addEventListener('click', () => guideDialog.close());
document.querySelector('#update').addEventListener('click', () => {
  if (productDialog.open && !confirm(t('Reload to update the app? Unsaved label changes will be lost.'))) return;
  if (document.querySelector('#recipe-dialog').open && !confirm(t('Reload to update the app? Unsaved recipe changes will be lost.'))) return;
  activateUpdate?.();
});
let updating = false;
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (updating) window.location.reload();
});
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstall = event;
  document.querySelector('#install').hidden = false;
});
document.querySelector('#install').addEventListener('click', async () => {
  if (!deferredInstall) return;
  try {
    await deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = undefined;
    document.querySelector('#install').hidden = true;
  } catch (error) { notify(`Installation could not start: ${error.message}. Use your browser's install menu.`, true); }
});
registerOffline({
  onReady: () => {
    setText(document.querySelector('#offline-status'), 'Ready offline. Labels stay on this device.');
    document.querySelector('.status-dot').classList.add('ready');
  },
  onError: (message) => { setText(document.querySelector('#offline-status'), message); },
  onUpdate: (activate) => {
    activateUpdate = () => { updating = true; closeCamera(); recipes.close(); activate(); };
    document.querySelector('#update').hidden = false;
  },
});
renderLibrary();
