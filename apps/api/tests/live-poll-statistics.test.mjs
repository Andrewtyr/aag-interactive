import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveStore } from '../src/live-store.mjs';

test('welcome session supports default material, next and back without dropping a question', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aag-welcome-'));
  const material = { title: 'Опрос', slides: [{ type: 'poll', title: 'Вопрос', options: ['Да', 'Нет'] }] };
  const live = createLiveStore(join(directory, 'aag.sqlite'), material, () => 1000, { bannedWordsPath: join(directory, 'words.txt') });
  try {
    const event = live.start(1, undefined, { welcomeScreen: true, title: 'Встреча' });
    assert.equal(live.getProjector(event.id, 1).slide.welcomeScreen, true);
    assert.equal(live.getHost(event.id, 1).slideCount, 2);
    assert.equal(live.getHost(event.id, 1).slide.title, 'Встреча');
    live.setSlide(event.id, 1, 1);
    live.open(event.id, 1);
    const person = live.join(event.code, 'Тест');
    live.respond(event.id, person.participantToken, 0, 1);
    assert.equal(live.getProjector(event.id, 1).statistics.total, 1);
    live.setSlide(event.id, 1, 0);
    assert.equal(live.getProjector(event.id, 1).slide.welcomeScreen, true);
  } finally { live.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('a poll displays its running results on the current projector slide', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aag-poll-'));
  const material = { title: 'Опрос', slides: [{ type: 'poll', title: 'Вопрос', options: ['Да', 'Нет'], timeSeconds: 30, showStatistics: true }] };
  const live = createLiveStore(join(directory, 'aag.sqlite'), material, () => 1_000, { bannedWordsPath: join(directory, 'words.txt') });
  try {
    const event = live.start(1);
    live.open(event.id, 1);
    const participant = live.join(event.code, 'Участник');
    live.respond(event.id, participant.participantToken, 0, 0);
    const display = live.getProjector(event.id, 1);
    assert.equal(display.question.closed, false);
    assert.deepEqual(display.statistics, { total: 1, counts: [1, 0] });
  } finally {
    live.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('host can center live statistics on an already running question without changing other slides', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aag-live-layout-'));
  const path = join(directory, 'aag.sqlite');
  const material = { title: 'Опрос', slides: [
    { type: 'poll', title: 'Первый', options: ['Да', 'Нет'] },
    { type: 'poll', title: 'Второй', options: ['Да', 'Нет'] },
  ] };
  let live = createLiveStore(path, material, () => 1000, { bannedWordsPath: join(directory, 'words.txt') });
  try {
    const event = live.start(1);
    assert.equal(live.getProjector(event.id, 1).slide.statisticsPlacement, undefined);
    live.setStatisticsPlacement(event.id, 1, 'center');
    assert.equal(live.getProjector(event.id, 1).slide.statisticsPlacement, 'center');
    live.setSlide(event.id, 1, 1);
    assert.equal(live.getProjector(event.id, 1).slide.statisticsPlacement, undefined);
    live.close();
    live = createLiveStore(path, material, () => 1000, { bannedWordsPath: join(directory, 'words.txt') });
    live.setSlide(event.id, 1, 0);
    assert.equal(live.getHost(event.id, 1).statisticsPlacement, 'center');
    assert.throws(() => live.setStatisticsPlacement(event.id, 2, 'side'), /доступ/i);
    assert.throws(() => live.setStatisticsPlacement(event.id, 1, 'floating'), /положение/i);
  } finally { live.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('question statistics are visible before opening and can be hidden across opening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aag-preopen-statistics-'));
  const material = { title: 'Опрос', slides: [
    { type: 'poll', title: 'Первый вопрос', options: ['Да', 'Нет'], timeSeconds: 30 },
    { type: 'quiz', title: 'Второй вопрос', options: ['А', 'Б'], correctIndex: 0, points: 1, timeSeconds: 30 },
  ] };
  const live = createLiveStore(join(directory, 'aag.sqlite'), material, () => 1000, { bannedWordsPath: join(directory, 'words.txt') });
  try {
    const event = live.start(1);
    assert.equal(live.getProjector(event.id, 1).question, undefined);
    assert.deepEqual(live.getProjector(event.id, 1).statistics, { total: 0, counts: [0, 0] });
    assert.equal(live.getHost(event.id, 1).statisticsVisible, true);
    live.setStatisticsVisibility(event.id, 1, false);
    assert.equal(live.getProjector(event.id, 1).statistics, null);
    live.open(event.id, 1);
    assert.equal(live.getProjector(event.id, 1).statistics, null);
    live.setStatisticsVisibility(event.id, 1, true);
    assert.deepEqual(live.getProjector(event.id, 1).statistics, { total: 0, counts: [0, 0] });
    live.setSlide(event.id, 1, 1);
    assert.deepEqual(live.getProjector(event.id, 1).statistics, { total: 0, counts: [0, 0] });
  } finally { live.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

for (const type of ['quiz', 'multi-quiz', 'scale']) test(`${type} streams counts before closing, even for legacy hidden settings`, () => {
  const directory = mkdtempSync(join(tmpdir(), 'aag-live-chart-'));
  const material = { title: 'Тест', slides: [{ type, title: 'Вопрос', options: ['А', 'Б'], maxValue: 2, correctIndex: 0, correctIndices: [0, 1], points: 0, timeSeconds: 30, showStatistics: false }] };
  const live = createLiveStore(join(directory, 'aag.sqlite'), material, () => 1000, { bannedWordsPath: join(directory, 'words.txt') });
  try {
    const event = live.start(1);
    live.open(event.id, 1);
    assert.deepEqual(live.getProjector(event.id, 1).statistics, { total: 0, counts: [0, 0] });
    const person = live.join(event.code, 'Тест');
    live.respond(event.id, person.participantToken, type === 'multi-quiz' ? [0, 1] : type === 'scale' ? 1 : 0, 0);
    const result = live.getProjector(event.id, 1);
    assert.equal(result.question.closed, false);
    assert.deepEqual(result.statistics, { total: 1, counts: type === 'multi-quiz' ? [1, 1] : [1, 0] });
    assert.equal('correctIndex' in result.slide, false);
    assert.equal('correctIndices' in result.slide, false);
    live.setStatisticsVisibility(event.id, 1, false);
    assert.equal(live.getProjector(event.id, 1).statistics, null);
    live.setStatisticsVisibility(event.id, 1, true);
    assert.equal(live.getProjector(event.id, 1).statistics.total, 1);
  } finally { live.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
