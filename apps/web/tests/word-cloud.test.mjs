import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('frequent words grow and the most frequent word occupies the center', async () => {
  const source = await readFile(new URL('../src/word-cloud.js', import.meta.url), 'utf8');
  const context = { window: {} };
  runInNewContext(source, context);
  const result = context.window.layoutWordCloud([
    { text: 'сервис', count: 1 },
    { text: 'забота', count: 8 },
    { text: 'уют', count: 3 },
  ]);
  assert.equal(result[0].text, 'забота');
  assert.equal(result[0].x, 50);
  assert.equal(result[0].y, 50);
  assert.ok(result[0].fontSize > result[1].fontSize);
  assert.ok(result[1].fontSize > result[2].fontSize);
  assert.ok(result[1].x !== 50 || result[1].y !== 50);
});
test('few distinct words are large and shrink as more different words arrive', async () => {
  const source = await readFile(new URL('../src/word-cloud.js', import.meta.url), 'utf8');
  const context = { window: {} };
  runInNewContext(source, context);
  const layout = context.window.layoutWordCloud;
  const makeWords = (n) => Array.from({ length: n }, (_, i) => ({ text: `слово${String(i).padStart(2, '0')}`, count: 1 }));
  const one = layout(makeWords(1));
  const three = layout(makeWords(3));
  const ten = layout(makeWords(10));
  const forty = layout(makeWords(40));
  assert.ok(one[0].fontSize >= 70, 'one tag should be prominent');
  assert.ok(one[0].fontSize > three[0].fontSize);
  assert.ok(three[0].fontSize > ten[0].fontSize);
  assert.ok(ten[0].fontSize > forty[0].fontSize);
  assert.equal(one[0].x, 50);
  assert.equal(one[0].y, 50);
  assert.equal(layout(makeWords(45)).length, 40);
  assert.equal(layout([]).length, 0);
});

test('frequent tags remain larger even as the number of unique tags grows', async () => {
  const source = await readFile(new URL('../src/word-cloud.js', import.meta.url), 'utf8');
  const context = { window: {} };
  runInNewContext(source, context);
  const words = Array.from({ length: 20 }, (_, i) => ({ text: `метка${i}`, count: i === 0 ? 20 : 1 }));
  const result = context.window.layoutWordCloud(words);
  assert.equal(result[0].text, 'метка0');
  assert.ok(result[0].fontSize > result[1].fontSize);
  assert.ok(result.every(({ fontSize }) => fontSize >= 16));
});
