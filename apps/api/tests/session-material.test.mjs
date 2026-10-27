import test from 'node:test';
import assert from 'node:assert/strict';
import { withWelcomeSlide } from '../src/session-material.mjs';

test('each new session starts with its title and retains every original slide', () => {
  const material = { title: 'Материал', slides: [{ type: 'quiz', title: 'Вопрос' }] };
  const first = withWelcomeSlide(material, 'Встреча');
  assert.deepEqual(first.slides[0], { type: 'cover', title: 'Встреча', welcomeScreen: true });
  assert.deepEqual(first.slides.slice(1), material.slides);
  assert.equal(material.slides.length, 1);
  assert.equal(withWelcomeSlide(material).slides.length, 2);
});
