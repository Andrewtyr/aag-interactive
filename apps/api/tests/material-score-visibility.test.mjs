import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMaterialStore, validateMaterial } from '../src/material-store.mjs';

test('material keeps score visibility on a poll slide', () => {
  const material = validateMaterial({ title: 'Опрос', slides: [{ type: 'poll', title: 'Вопрос', options: ['Да', 'Нет'], showPoints: false }] });
  assert.equal(material.slides[0].showPoints, false);
});

test('question text position is saved and limited to a small vertical adjustment', () => {
  const material = validateMaterial({ title: 'Опрос', slides: [{ type: 'poll', title: 'Вопрос', options: ['Да', 'Нет'], textOffsetY: -8 }] });
  assert.equal(material.slides[0].textOffsetY, -8);
  assert.throws(() => validateMaterial({ title: 'Опрос', slides: [{ type: 'poll', title: 'Вопрос', options: ['Да', 'Нет'], textOffsetY: 30 }] }), /положени/i);
  assert.throws(() => validateMaterial({ title: 'Опрос', slides: [{ type: 'poll', title: 'Вопрос', options: ['Да', 'Нет'], textOffsetY: '8' }] }), /положени/i);
});

test('question statistics placement survives saving and rejects unknown positions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aag-statistics-placement-'));
  const store = createMaterialStore(join(directory, 'materials.sqlite'), { title: 'Образец', slides: [{ type: 'cover', title: 'Начало' }] });
  try {
    const saved = store.create({ title: 'Опрос', slides: [{ type: 'poll', title: 'Вопрос', options: ['Да', 'Нет'], statisticsPlacement: 'center' }] }, 1);
    assert.equal(store.get(saved.id, 1).slides[0].statisticsPlacement, 'center');
    assert.throws(() => validateMaterial({ title: 'Опрос', slides: [{ type: 'poll', title: 'Вопрос', options: ['Да', 'Нет'], statisticsPlacement: 'floating' }] }), /статистик/i);
    assert.throws(() => validateMaterial({ title: 'Опрос', slides: [{ type: 'cover', title: 'Начало', statisticsPlacement: 'center' }] }), /статистик/i);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('an interactive slide preserves its background and editable text and shape', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aag-question-design-'));
  const store = createMaterialStore(join(directory, 'materials.sqlite'), { title: 'Образец', slides: [{ type: 'cover', title: 'Начало' }] });
  try {
    const slide = { type: 'poll', title: 'Вопрос', options: ['Да', 'Нет'], background: '#006f37', statisticsPlacement: 'center', elements: [
      { type: 'text', x: 10, y: 10, w: 30, h: 10, text: 'Подсказка', color: '#ffffff', fontSize: 28 },
      { type: 'shape', x: 50, y: 10, w: 12, h: 12, color: '#f2ca70', shape: 'ellipse' },
    ] };
    const saved = store.create({ title: 'Опрос', slides: [slide] }, 1);
    const loaded = store.get(saved.id, 1).slides[0];
    assert.equal(loaded.background, slide.background);
    assert.equal(loaded.statisticsPlacement, 'center');
    assert.deepEqual(loaded.elements.map((element) => element.type), ['text', 'shape']);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('an interactive slide keeps a selected PDF or PPTX page as its template', () => {
  const template = { importId: '123e4567-e89b-42d3-a456-426614174000', page: 2 };
  const material = validateMaterial({ title: 'Опрос', slides: [{ type: 'poll', title: 'Вопрос', options: ['Да', 'Нет'], template }] });
  assert.deepEqual(material.slides[0].template, template);
  const directory = mkdtempSync(join(tmpdir(), 'aag-saved-template-'));
  const store = createMaterialStore(join(directory, 'materials.sqlite'), { title: 'Образец', slides: [{ type: 'cover', title: 'Начало' }] });
  try {
    const saved = store.create(material, 1);
    assert.deepEqual(store.get(saved.id, 1).slides[0].template, template);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  assert.throws(() => validateMaterial({ title: 'Опрос', slides: [{ type: 'poll', title: 'Вопрос', options: ['Да', 'Нет'], template: { ...template, page: 0 } }] }), /шаблон/i);
  assert.throws(() => validateMaterial({ title: 'Опрос', slides: [{ type: 'cover', title: 'Начало', template }] }), /шаблон/i);
});

test('chart direction survives saving and reopening all choice question types', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aag-chart-direction-'));
  const store = createMaterialStore(join(directory, 'materials.sqlite'), { title: 'Образец', slides: [{ type: 'cover', title: 'Начало' }] });
  try {
    const slides = [
      { type: 'quiz', title: 'Один', options: ['А', 'Б'], correctIndex: 0 },
      { type: 'multi-quiz', title: 'Несколько', options: ['А', 'Б'], correctIndices: [0] },
      { type: 'poll', title: 'Опрос', options: ['Да', 'Нет'] },
      { type: 'scale', title: 'Шкала', maxValue: 5 },
    ];
    const created = store.create({ title: 'Диаграммы', slides: slides.map((slide) => ({ ...slide, statisticsChart: 'column' })) }, 1);
    assert.deepEqual(store.get(created.id, 1).slides.map((slide) => slide.statisticsChart), Array(4).fill('column'));
    store.update(created.id, { ...created, slides: created.slides.map((slide) => ({ ...slide, statisticsChart: 'horizontal' })) }, 1);
    assert.deepEqual(store.get(created.id, 1).slides.map((slide) => slide.statisticsChart), Array(4).fill('horizontal'));
  } finally {
    store.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('one material accepts different question types', () => {
  const slides = [
    { type: 'quiz', title: 'Тест', options: ['А', 'Б'], correctIndex: 0 },
    { type: 'multi-quiz', title: 'Несколько', options: ['А', 'Б', 'В'], correctIndices: [0, 2] },
    { type: 'poll', title: 'Опрос', options: ['Да', 'Нет'] },
    { type: 'scale', title: 'Шкала', maxValue: 5 },
    { type: 'word-cloud', title: 'Облако' },
    { type: 'text', title: 'Текст' },
  ];
  const material = validateMaterial({ title: 'Разные вопросы', slides });
  assert.equal(material.slides.length, slides.length);
});

test('mixed question types survive saving and reopening a material', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aag-material-'));
  const store = createMaterialStore(join(directory, 'materials.sqlite'), { title: 'Образец', slides: [{ type: 'cover', title: 'Начало' }] });
  try {
    const created = store.create({ title: 'Разные вопросы', slides: [{ type: 'quiz', title: 'Первый', options: ['А', 'Б'], correctIndex: 0 }] }, 1);
    const updated = store.update(created.id, {
      ...created,
      slides: [
        ...created.slides,
        { type: 'multi-quiz', title: 'Второй', options: ['А', 'Б'], correctIndices: [0], showStatistics: true },
        { type: 'poll', title: 'Третий', options: ['Да', 'Нет'], showStatistics: true },
      ],
    }, 1);
    assert.equal(updated.version, created.version + 1);
    assert.deepEqual(store.get(created.id, 1).slides.map((slide) => slide.type), ['quiz', 'multi-quiz', 'poll']);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
