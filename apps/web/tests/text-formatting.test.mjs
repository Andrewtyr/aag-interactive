import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('slide typography applies to headings and resets when switching to an unformatted slide', () => {
  const window = {};
  vm.runInNewContext(readFileSync(new URL('../src/slide-elements.js', import.meta.url), 'utf8'), { window });
  const heading = { style: {} }, body = { style: {} }, options = { style: {} };
  const root = { style: {}, querySelectorAll: (selector) => selector.includes('h1') ? [heading] : selector.includes('> p') ? [body] : [options] };
  window.applyTextStyles(root, { textStyles: { title: { fontFamily: 'Georgia', fontSize: 64, bold: false }, options: { fontFamily: 'Verdana', fontSize: 32, bold: true } } });
  assert.equal(heading.style.fontFamily, '"Georgia", sans-serif');
  assert.equal(heading.style.fontSize, '4cqw');
  assert.equal(heading.style.fontWeight, '400');
  assert.equal(options.style.fontWeight, '700');
  window.applyTextStyles(root, {});
  assert.equal(heading.style.fontSize, '');
  assert.equal(options.style.fontFamily, '');
});
