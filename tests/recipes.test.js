import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmIngredients, createRecipe, ingredientsFromDetections } from '../src/recipes.js';
import { messages } from '../src/i18n.js';

test('photo candidates discard unrelated and weak detections and deduplicate foods', () => {
  assert.deepEqual(ingredientsFromDetections([
    { class: 'banana', score: 0.8 }, { class: 'banana', score: 0.7 },
    { class: 'person', score: 0.99 }, { class: 'apple', score: 0.3 },
    { class: 'broccoli', score: 0.9 },
  ]), ['banana', 'broccoli']);
  assert.throws(() => ingredientsFromDetections(null), /Invalid recognition/);
});

test('recipes require real confirmed ingredients and reject malformed saved records', () => {
  for (const ids of [null, ['unknown', 'carrot'], ['carrot', 'carrot']])
    assert.throws(() => confirmIngredients(ids), /Invalid saved ingredients/);
  assert.throws(() => createRecipe(['carrot']), /at least two/);
});

test('a vegetable and pulse recipe uses only confirmed foods and retains carbohydrate context', () => {
  const recipe = createRecipe(['broccoli', 'chickpeas', 'rice', 'apple']);
  assert.equal(recipe.title, 'Vegetable and protein skillet');
  assert.deepEqual(recipe.ingredients.map((item) => item.id), ['broccoli', 'chickpeas', 'rice', 'apple']);
  assert.ok(recipe.steps.some((step) => step.includes('already-cooked or canned')));
  assert.ok(recipe.steps.some((step) => step.includes('following its package directions')));
  assert.ok(recipe.steps.some((step) => step.includes('separately from savory')));
  assert.ok(recipe.notes.some((note) => note.includes('Count the actual ingredients')));
  assert.ok(!recipe.steps.some((step) => step.startsWith('Cook chicken') || step.startsWith('Cook fish')));
});

test('raw animal products receive separate cooking guidance; breakfast never invents fruit', () => {
  const animal = createRecipe(['chicken', 'fish', 'eggs']);
  assert.ok(animal.steps.some((step) => step.includes('74 °C') && step.includes('thermometer')));
  assert.ok(animal.steps.some((step) => step.includes('63 °C') && step.includes('thermometer')));
  assert.ok(animal.steps.some((step) => step.includes('white and yolk are firm')));
  const breakfast = createRecipe(['yogurt', 'nuts']);
  assert.equal(breakfast.title, 'Simple breakfast bowl');
  assert.ok(!breakfast.steps.some((step) => step.startsWith('Slice')));
});

test('recipe variants have translated titles, steps and non-medical explanations', () => {
  for (const ids of [['broccoli', 'carrot'], ['chicken', 'fish', 'eggs', 'tofu'], ['apple', 'yogurt', 'oats'], ['apple', 'banana'], ['yogurt', 'nuts']]) {
    const recipe = createRecipe(ids);
    for (const text of [recipe.title, ...recipe.steps, ...recipe.notes])
      assert.ok(Object.hasOwn(messages, text), `Missing translation for ${text}`);
  }
});
