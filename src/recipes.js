export const RECIPE_KEY = 'sugarlens.recipe.v1';
export const INGREDIENTS = [
  ['broccoli', 'Broccoli', 'vegetable'], ['carrot', 'Carrots', 'vegetable'],
  ['zucchini', 'Courgette', 'vegetable'], ['pepper', 'Peppers', 'vegetable'],
  ['tomato', 'Tomatoes', 'vegetable'], ['spinach', 'Spinach', 'vegetable'],
  ['mushroom', 'Mushrooms', 'vegetable'], ['cucumber', 'Cucumber', 'vegetable'],
  ['onion', 'Onion', 'vegetable'],
  ['chickpeas', 'Cooked chickpeas', 'protein'], ['lentils', 'Cooked lentils', 'protein'],
  ['beans', 'Cooked beans', 'protein'], ['tofu', 'Tofu', 'protein'],
  ['eggs', 'Eggs', 'protein'], ['chicken', 'Chicken', 'protein'], ['fish', 'Fish', 'protein'],
  ['rice', 'Brown rice', 'starch'], ['pasta', 'Wholegrain pasta', 'starch'],
  ['quinoa', 'Quinoa', 'starch'], ['apple', 'Apples', 'fruit'],
  ['banana', 'Bananas', 'fruit'], ['orange', 'Oranges', 'fruit'],
  ['yogurt', 'Plain unsweetened yogurt', 'breakfast'], ['oats', 'Oats', 'breakfast'],
  ['nuts', 'Unsalted nuts', 'breakfast'],
].map(([id, name, group]) => ({ id, name, group }));

export function confirmIngredients(ids) {
  if (!Array.isArray(ids) || ids.length > INGREDIENTS.length ||
      ids.some((id) => !INGREDIENTS.some((ingredient) => ingredient.id === id)) ||
      new Set(ids).size !== ids.length) throw new Error('Invalid saved ingredients. Existing data was not changed.');
  return ids.map((id) => INGREDIENTS.find((ingredient) => ingredient.id === id));
}

export function ingredientsFromDetections(detections) {
  if (!Array.isArray(detections)) throw new Error('Invalid recognition result.');
  const foods = { banana: 'banana', apple: 'apple', orange: 'orange', broccoli: 'broccoli', carrot: 'carrot' };
  return [...new Set(detections.filter((item) =>
    Number.isFinite(item.score) && item.score >= 0.55 && Object.hasOwn(foods, item.class))
    .map((item) => foods[item.class]))];
}

export function createRecipe(ids) {
  const ingredients = confirmIngredients(ids);
  if (ingredients.length < 2) throw new Error('Select at least two ingredients you actually have.');
  const has = (id) => ids.includes(id);
  const vegetables = ingredients.filter((item) => item.group === 'vegetable');
  const proteins = ingredients.filter((item) => item.group === 'protein');
  const starches = ingredients.filter((item) => item.group === 'starch');
  const fruits = ingredients.filter((item) => item.group === 'fruit');
  const breakfast = ingredients.filter((item) => item.group === 'breakfast');
  const savory = vegetables.length || proteins.length || starches.length;
  const title = savory ? (vegetables.length && proteins.length ? 'Vegetable and protein skillet' :
    vegetables.length ? 'Simple vegetable pan' : 'Simple warm bowl') :
    fruits.length ? (has('yogurt') ? 'Whole-fruit and yogurt bowl' : 'Whole-fruit bowl') : 'Simple breakfast bowl';
  const steps = ['Choose ingredient amounts and servings according to your own eating plan. This recipe does not prescribe portions.'];
  if (vegetables.length || fruits.length) steps.push('Wash the fruit and vegetables. Keep raw meat and fish separate; clean hands, utensils and surfaces.');
  if (starches.length) steps.push('Cook the selected rice, pasta or quinoa separately, following its package directions. Do not assume they have the same cooking time.');
  if (vegetables.length) steps.push('Chop the vegetables; keep cucumber fresh on the side. Steam the other vegetables or cook them with a splash of water until tender. Add delicate leaves near the end.');
  if (['chickpeas', 'lentils', 'beans'].some(has)) steps.push('Use only already-cooked or canned pulses. Drain and rinse, then warm them through. Never use raw dried beans directly in this recipe.');
  if (has('tofu')) steps.push('Cut the tofu and heat it in a separate pan until hot throughout, following the package directions.');
  if (has('chicken')) steps.push('Cook chicken separately to at least 74 °C / 165 °F at its thickest point, checked with a food thermometer. Never rely on the photo or cooking time.');
  if (has('fish')) steps.push('Cook fish separately to at least 63 °C / 145 °F, checked with a food thermometer.');
  if (has('eggs')) steps.push('Cook eggs separately until both white and yolk are firm; do not use raw eggs.');
  if (savory) steps.push('Combine the cooked components you selected. Use herbs or a little olive oil only if available; no sugar, honey or sweet sauce is required.');
  if (has('oats')) steps.push('Prepare oats according to their package directions. Keep them as a separate bowl or accompaniment rather than adding raw oats to the pan.');
  if (fruits.length) steps.push('Slice the selected whole fruit. Serve it separately from savory food, with plain unsweetened yogurt or unsalted nuts only if selected. Do not turn it into juice or add sweeteners.');
  else if (has('yogurt') || has('nuts')) steps.push('Serve the selected plain yogurt or nuts as a separate accompaniment. Do not add sugar, honey or sweetened toppings.');
  const notes = ['No added sweeteners are suggested. That does not make the dish carbohydrate-free or safe for every person with diabetes.',
    'Photos cannot establish quantities, carbohydrates, allergens, freshness or food safety. Check labels and your own care plan; no glucose prediction or insulin advice is provided.'];
  if (starches.length || fruits.length || breakfast.length || ['chickpeas', 'lentils', 'beans'].some(has))
    notes.push('Rice, pasta, quinoa, pulses, fruit, oats and yogurt can contribute carbohydrate. Count the actual ingredients and amounts using reliable labels or your established method, not the photo.');
  if (vegetables.length && !proteins.length)
    notes.push('This is a vegetable idea, not a complete meal plan. Add a protein food only if you have it and it fits your personal needs.');
  return { title, ingredients, steps, notes };
}
