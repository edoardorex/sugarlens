import { INGREDIENTS, RECIPE_KEY, confirmIngredients, createRecipe, ingredientsFromDetections } from './recipes.js';
import { escapeHTML as h, todayISO } from './domain.js';
import { t, setText, translateStatic } from './i18n.js';

export function initRecipes() {
  const dialog = document.createElement('dialog');
  dialog.id = 'recipe-dialog';
  dialog.setAttribute('aria-labelledby', 'recipe-title');
  dialog.innerHTML = `
    <div class="sheet-heading"><div><p class="eyebrow">YOUR INGREDIENTS. A LITTLE INSPIRATION.</p><h2 id="recipe-title">Cook from what you have</h2></div><button class="icon-button" id="close-recipe" type="button" aria-label="Close recipes">&times;</button></div>
    <p class="entry-note">Cooking inspiration with carbohydrate awareness, not a personalised diabetes diet. Confirm ingredients and check your own care plan.</p>
    <div class="recipe-photo-actions"><button class="button secondary" id="recipe-photo" type="button">Take a photo</button><button class="text-button" id="recipe-gallery" type="button">Choose a photo</button></div>
    <input type="file" id="recipe-photo-file" accept="image/*" capture="environment" hidden />
    <input type="file" id="recipe-gallery-file" accept="image/*" hidden />
    <div id="recipe-photo-view" hidden><img id="recipe-image" alt="Your ingredient photo, kept on this device" /><button class="button primary full-width" id="recipe-identify" type="button">Identify ingredients locally</button></div>
    <p class="field-help">Photos are never uploaded or saved. First recognition downloads about 18 MB of model files and may be slow on phones. Closing discards the photo.</p>
    <details class="recipe-info"><summary>What can the photo recognise?</summary><p class="field-help">This first model suggests bananas, apples, oranges, broccoli and carrots. It can miss or misidentify them. Other ingredients must be selected manually. It cannot inspect allergens, quantities or freshness.</p><p class="field-help">The model files come from a public download server, which receives ordinary request metadata, not your photo. Once downloaded successfully, recognition can work offline if the browser keeps the cache.</p></details>
    <p id="recipe-status" role="status" class="field-help"></p><button class="text-button" id="recipe-cancel" type="button" hidden>Cancel recognition</button>
    <p id="recipe-cache-warning" class="form-error" role="status" hidden>Model cache could not be saved. Recognition may need internet next time.</p>
    <p id="recipe-error" class="form-error" role="alert" hidden></p>
    <h3>Selected ingredients</h3><div id="recipe-selected" class="recipe-selected"></div>
    <details id="recipe-picker" open><summary>Add or change ingredients</summary><div class="ingredient-grid">${INGREDIENTS.map(({ id, name }) => `<label><input type="checkbox" value="${id}" />${h(name)}</label>`).join('')}</div></details>
    <label class="recipe-confirm"><input type="checkbox" id="recipe-confirm" />I have checked the selected ingredients. Photo suggestions are only guesses.</label>
    <button class="button primary full-width" id="recipe-build" type="button">Suggest a recipe</button>
    <section id="recipe-result" class="recipe-result" aria-label="Recipe idea" hidden></section>
    <button class="button secondary full-width" id="recipe-save" type="button" hidden>Save recipe on this device</button>
    <p id="recipe-save-status" role="status" class="field-help"></p>
    <button class="text-button danger" id="recipe-forget" type="button">Forget saved recipe</button>
    <p class="sheet-disclaimer">Not for treating a hypo, emergencies, insulin dosing or medication changes. No recipe is guaranteed suitable for every person with diabetes. Check allergens and food safety; follow your clinician or dietitian's personalised advice.</p>`;
  document.querySelector('#app').append(dialog);
  translateStatic(dialog);
  const el = (id) => dialog.querySelector(`#${id}`);
  let selected = new Set();
  let recipe;
  let photo;
  let worker;
  let timeout;
  let generation = 0;
  let readBlocked = false;
  let hasSaved = false;
  let busy = false;
  function error(message) { setText(el('recipe-error'), message); el('recipe-error').hidden = false; }
  function render() {
    el('recipe-selected').innerHTML = selected.size ? [...selected].map((id) =>
      `<span>${h(t(INGREDIENTS.find((item) => item.id === id).name))}</span>`).join('') : h(t('Choose ingredients below, or try a photo.'));
    for (const input of dialog.querySelectorAll('.ingredient-grid input')) input.checked = selected.has(input.value);
    el('recipe-result').hidden = !recipe;
    el('recipe-save').hidden = !recipe;
    el('recipe-forget').hidden = !hasSaved && !readBlocked;
    if (recipe) {
      el('recipe-result').innerHTML = `<p class="field-help">${h(t('Cooking inspiration, not a diabetes meal plan.'))}</p><h3>${h(t(recipe.title))}</h3><p class="field-help">${h(t('Your confirmed ingredients:'))} ${recipe.ingredients.map((item) => h(t(item.name))).join(', ')}</p><p class="field-help">${h(t('Use only the ingredients you confirmed. Herbs and olive oil are optional pantry extras.'))}</p>
        <ol>${recipe.steps.map((step) => `<li>${h(t(step))}</li>`).join('')}</ol>
        <div class="result-caution"><strong>${h(t('Carbohydrates still matter'))}</strong>${recipe.notes.map((note) => `<p>${h(t(note))}</p>`).join('')}</div>`;
    }
  }
  function invalidate() {
    recipe = undefined;
    el('recipe-confirm').checked = false;
    el('recipe-save').disabled = false;
    setText(el('recipe-save-status'), '');
    render();
  }
  function stopRecognition() {
    generation++;
    clearTimeout(timeout);
    worker?.terminate();
    worker = undefined;
    busy = false;
    el('recipe-identify').disabled = false;
    el('recipe-cancel').hidden = true;
  }
  function discardPhoto() {
    stopRecognition();
    if (photo) URL.revokeObjectURL(photo.url);
    photo = undefined;
    el('recipe-image').removeAttribute('src');
    el('recipe-photo-view').hidden = true;
  }
  dialog.addEventListener('close', () => {
    discardPhoto();
    setText(el('recipe-status'), '');
  });
  el('close-recipe').addEventListener('click', () => dialog.close());
  document.querySelector('#open-recipes').addEventListener('click', () => dialog.showModal());
  el('recipe-photo').addEventListener('click', () => el('recipe-photo-file').click());
  el('recipe-gallery').addEventListener('click', () => el('recipe-gallery-file').click());
  async function choosePhoto(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    discardPhoto();
    const token = generation;
    el('recipe-error').hidden = true;
    setText(el('recipe-status'), 'Opening your photo locally...');
    let source;
    try {
      if (file.size > 20_000_000) throw new Error('Choose a photo smaller than 20 MB.');
      if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
      source = URL.createObjectURL(file);
      const image = new Image();
      image.src = source;
      try { await image.decode(); }
      catch { throw new Error('This photo format could not be opened. Try a JPEG or PNG.'); }
      if (token !== generation || !dialog.open) return;
      const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      if (!blob) throw new Error('This photo could not be prepared. Choose another image.');
      if (token !== generation || !dialog.open) return;
      photo = { url: URL.createObjectURL(blob), pixels, width: canvas.width, height: canvas.height };
      selected = new Set();
      invalidate();
      el('recipe-picker').open = false;
      el('recipe-image').src = photo.url;
      el('recipe-photo-view').hidden = false;
      setText(el('recipe-status'), 'Photo ready. Identify locally, or select ingredients yourself.');
    } catch (cause) {
      if (token === generation && dialog.open) { setText(el('recipe-status'), ''); error(cause.message); }
    } finally {
      if (source) URL.revokeObjectURL(source);
    }
  }
  for (const id of ['recipe-photo-file', 'recipe-gallery-file']) el(id).addEventListener('change', choosePhoto);
  function failed(message) {
    stopRecognition();
    setText(el('recipe-status'), '');
    error(`Recognition failed: ${message}. Select ingredients manually instead.`);
  }
  el('recipe-identify').addEventListener('click', () => {
    if (!photo || busy) return;
    stopRecognition();
    const token = generation;
    busy = true;
    invalidate();
    el('recipe-error').hidden = true;
    el('recipe-cache-warning').hidden = true;
    el('recipe-identify').disabled = true;
    el('recipe-cancel').hidden = false;
    setText(el('recipe-status'), 'Preparing local recognition. The first download may take a moment.');
    try {
      worker = new Worker(new URL('./vision-worker.js', import.meta.url), { type: 'module' });
      worker.onerror = (event) => { if (token === generation) failed(event.message); };
      worker.onmessage = ({ data }) => {
        if (token !== generation || !dialog.open) return;
        if (data.type === 'status') setText(el('recipe-status'), data.message);
        else if (data.type === 'error') failed(data.message);
        else if (data.type === 'result') {
          try {
            const guesses = ingredientsFromDetections(data.detections);
            selected = new Set([...selected, ...guesses]);
            invalidate();
            el('recipe-picker').open = !guesses.length;
            setText(el('recipe-status'), guesses.length ? 'Possible ingredients found. Check every selection and add anything missing.' : 'No supported ingredients recognised. Select what you have below.');
            el('recipe-cache-warning').hidden = !data.cacheWarning;
            stopRecognition();
          } catch (cause) { failed(cause.message); }
        }
      };
      const pixels = photo.pixels.slice().buffer;
      worker.postMessage({ pixels, width: photo.width, height: photo.height }, [pixels]);
      timeout = setTimeout(() => failed('Recognition took too long.'), 90_000);
    } catch (cause) { failed(cause.message); }
  });
  el('recipe-cancel').addEventListener('click', () => {
    stopRecognition();
    setText(el('recipe-status'), 'Recognition cancelled. You can select ingredients manually.');
  });
  el('recipe-picker').addEventListener('change', ({ target }) => {
    if (target.matches('input[type="checkbox"]')) {
      if (target.checked) selected.add(target.value);
      else selected.delete(target.value);
      el('recipe-error').hidden = true;
      invalidate();
    }
  });
  el('recipe-build').addEventListener('click', () => {
    el('recipe-error').hidden = true;
    try {
      if (busy) throw new Error('Wait for recognition to finish or cancel it first.');
      if (!el('recipe-confirm').checked) throw new Error('Confirm the selected ingredients before suggesting a recipe.');
      recipe = createRecipe([...selected]);
      el('recipe-picker').open = false;
      render();
      el('recipe-result').scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (cause) { error(cause.message); }
  });
  el('recipe-save').addEventListener('click', () => {
    el('recipe-error').hidden = true;
    try {
      if (readBlocked) throw new Error('Unreadable saved recipe is protected. Use Forget saved recipe before saving a replacement.');
      localStorage.setItem(RECIPE_KEY, JSON.stringify({ version: 1, ingredients: recipe.ingredients.map((item) => item.id), savedAt: todayISO() }));
      setText(el('recipe-save-status'), 'Recipe saved on this device. Only confirmed ingredient names are stored, never the photo.');
      hasSaved = true;
      el('recipe-forget').hidden = false;
      el('recipe-save').disabled = true;
    } catch (cause) { error(`Recipe not saved: ${cause.message}`); }
  });
  el('recipe-forget').addEventListener('click', () => {
    if (!confirm(t('Forget the last saved recipe on this device? Your product labels will not change.'))) return;
    try {
      localStorage.removeItem(RECIPE_KEY);
      hasSaved = false;
      readBlocked = false;
      selected = new Set();
      discardPhoto();
      invalidate();
      el('recipe-error').hidden = true;
      el('recipe-picker').open = true;
      setText(el('recipe-save-status'), 'Saved recipe forgotten. Product labels are unchanged.');
    } catch (cause) { error(`Recipe not saved: ${cause.message}`); }
  });
  try {
    const raw = localStorage.getItem(RECIPE_KEY);
    if (raw !== null) {
      hasSaved = true;
      const saved = JSON.parse(raw);
      if (saved?.version !== 1) throw new Error('Invalid saved ingredients. Existing data was not changed.');
      confirmIngredients(saved.ingredients);
      recipe = createRecipe(saved.ingredients);
      selected = new Set(saved.ingredients);
      el('recipe-confirm').checked = true;
      el('recipe-picker').open = false;
      setText(el('recipe-save-status'), 'Your last saved recipe was restored. Saving a new one replaces it.');
    }
  } catch (cause) {
    readBlocked = true;
    error(`Saved recipe could not be read: ${cause.message}`);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && busy) {
      stopRecognition();
      setText(el('recipe-status'), 'Recognition paused in the background. Tap identify to try again.');
    }
  });
  window.addEventListener('pagehide', discardPhoto);
  render();
  return { refresh: render, close: () => dialog.close() };
}
