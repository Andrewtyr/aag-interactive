import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMaterial } from '../src/material-store.mjs';

test('slide and interactive typography survives validation without losing false bold', () => {
  const textStyles = { title: { fontFamily: 'Georgia', fontSize: 56, bold: false }, options: { fontFamily: 'Arial', fontSize: 32, bold: true } };
  for (const type of ['content', 'poll', 'word-cloud']) {
    const input = { title: 'Тест', slides: [{ type, title: 'Заголовок', bullets: [], options: ['Да', 'Нет'], textStyles }] };
    assert.deepEqual(validateMaterial(input).slides[0].textStyles, textStyles);
    for (const value of [{ ...textStyles.title, fontSize: 999 }, { ...textStyles.title, fontFamily: 'bad-font' }, { ...textStyles.title, bold: 'yes' }]) {
      assert.throws(() => validateMaterial({ ...input, slides: [{ ...input.slides[0], textStyles: { title: value } }] }));
    }
  }
});

test('text objects retain font choice and legacy objects get default font', () => {
  const element = { type: 'text', text: 'Текст', x: 0, y: 0, w: 80, h: 30, fontSize: 32, bold: true };
  const make = (value) => validateMaterial({ title: 'Тест', slides: [{ type: 'content', title: 'Тест', bullets: [], elements: [value] }] }).slides[0].elements[0];
  assert.equal(make(element).fontFamily, 'Manrope');
  assert.equal(make({ ...element, fontFamily: 'Verdana' }).fontFamily, 'Verdana');
});
