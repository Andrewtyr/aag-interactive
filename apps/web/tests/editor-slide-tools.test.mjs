import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function tools() {
  const source = await readFile(new URL('../src/editor-slide-tools.js', import.meta.url), 'utf8');
  const window = {};
  runInNewContext(source, { window, crypto: { randomUUID: () => '12345678-1234-4123-8123-123456789abc' }, structuredClone });
  return window.editorSlideTools;
}

test('duplicated slides do not reuse element identities', async () => {
  const { duplicateSlide } = await tools();
  const original = { type: 'cover', title: 'Привет', elements: [{ id: 'a', type: 'text', text: 'Привет' }] };
  const copy = duplicateSlide(original);
  assert.equal(copy.title, 'Привет');
  assert.notEqual(copy.elements[0].id, original.elements[0].id);
  copy.elements[0].text = 'Другое';
  assert.equal(original.elements[0].text, 'Привет');
});

test('element layer order changes by one position', async () => {
  const { moveElement } = await tools();
  assert.equal(Array.from(moveElement(['a', 'b', 'c'], 1, 'forward')).join(','), 'a,c,b');
  assert.equal(Array.from(moveElement(['a', 'b', 'c'], 0, 'backward')).join(','), 'a,b,c');
});

test('new editor elements stay inside the slide', async () => {
  const { createElement } = await tools();
  for (const type of ['text', 'shape', 'image']) {
    const element = createElement(type, 'asset-id');
    assert.equal(element.type, type);
    assert.ok(element.x >= 0 && element.y >= 0 && element.x + element.w <= 100 && element.y + element.h <= 100);
    assert.ok(element.id);
  }
});

test('changing a simple slide layout keeps its content', async () => {
  const { setSlideLayout } = await tools();
  const cover = { type: 'cover', title: 'Добро пожаловать', body: 'Начало' };
  const content = setSlideLayout(cover, 'content');
  assert.equal(content.type, 'content');
  assert.equal(content.title, 'Добро пожаловать');
  assert.equal(content.body, 'Начало');
  assert.deepEqual(Array.from(content.bullets), []);
});

test('adding different question types keeps their creation order', async () => {
  const { insertQuestion } = await tools();
  const slides = [{ type: 'cover', title: 'Начало' }, { type: 'quiz', title: 'Вопрос 1' }];
  const result = insertQuestion(slides, 1, 0, { type: 'poll', title: 'Вопрос 2' });
  assert.equal(result.index, 2);
  assert.equal(Array.from(result.slides, (slide) => slide.title).join(','), 'Начало,Вопрос 1,Вопрос 2');
  assert.equal(slides.length, 2);
});

test('media resizing preserves proportions and stays inside the slide', async () => {
  const { resizeElement } = await tools();
  const start = { x: 20, y: 20, w: 40, h: 30 };
  const resized = resizeElement(start, 100, 100, 'se', true);
  assert.ok(Math.abs(resized.w / resized.h - 4 / 3) < .001);
  assert.ok(resized.x + resized.w <= 100 && resized.y + resized.h <= 100);
  const northwest = resizeElement(start, -100, -100, 'nw', true);
  assert.ok(northwest.x >= 0 && northwest.y >= 0);
  assert.equal(northwest.x + northwest.w, 60);
});
