import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const context = { window: {} };
test('statistics chart computes bars and pie sectors without exposing answer keys', () => {
  vm.runInNewContext(readFileSync(resolve('src/statistics-chart.js'), 'utf8'), context);
  const chart = context.window.statisticsChartData(['Первый', 'Второй'], [3, 1]);
  assert.equal(chart.rows[0].percent, 75);
  assert.equal(chart.rows[1].percent, 25);
  assert.match(chart.gradient, /75%/);
  assert.equal(context.window.statisticsChartData(['А'], [0]).rows[0].percent, 0);
});

test('multi-choice columns rise by the share of respondents for each option', () => {
  vm.runInNewContext(readFileSync(resolve('src/statistics-chart.js'), 'utf8'), context);
  const chart = context.window.statisticsChartData(['Первый', 'Второй'], [2, 2], 3);
  assert.equal(chart.rows[0].percent, 67);
  assert.equal(chart.rows[1].percent, 67);
  assert.equal(context.window.statisticsChartMode({ type: 'multi-quiz', statisticsChart: 'pie' }), 'column');
});

test('vertical columns grow upward to the selected percentage', () => {
  const makeElement = () => ({ children: [], style: {}, attributes: {}, append(...items) { this.children.push(...items); }, setAttribute(name, value) { this.attributes[name] = value; } });
  const domContext = { window: {}, document: { createElement: makeElement } };
  vm.runInNewContext(readFileSync(resolve('src/statistics-chart.js'), 'utf8'), domContext);
  const rows = domContext.window.statisticsChartData(['Первый', 'Второй'], [2, 0], 3).rows;
  const columns = domContext.window.renderStatisticsColumns(rows);
  assert.equal(columns.children[0].children[1].children[0].style.height, '67%');
  assert.equal(columns.children[1].children[1].children[0].style.height, '0%');
  assert.match(columns.attributes['aria-label'], /Первый: 2, 67%/);
});

test('each question type supports both chart directions and keeps legacy defaults', () => {
  vm.runInNewContext(readFileSync(resolve('src/statistics-chart.js'), 'utf8'), context);
  for (const type of ['quiz', 'multi-quiz', 'poll', 'scale']) {
    assert.equal(context.window.statisticsChartMode({ type, statisticsChart: 'column' }), 'column');
    assert.equal(context.window.statisticsChartMode({ type, statisticsChart: 'horizontal' }), 'bar');
  }
  assert.equal(context.window.statisticsChartMode({ type: 'multi-quiz', statisticsChart: 'bar' }), 'column');
  assert.equal(context.window.statisticsChartMode({ type: 'poll', statisticsChart: 'bar' }), 'bar');
});

test('horizontal bars use respondent percentages and keep zero responses empty', () => {
  const makeElement = () => ({ children: [], style: {}, attributes: {}, append(...items) { this.children.push(...items); }, setAttribute(name, value) { this.attributes[name] = value; } });
  const domContext = { window: {}, document: { createElement: makeElement } };
  vm.runInNewContext(readFileSync(resolve('src/statistics-chart.js'), 'utf8'), domContext);
  const rows = domContext.window.statisticsChartData(['Первый', 'Второй'], [2, 0], 3).rows;
  const chart = domContext.window.renderStatisticsBars(rows);
  assert.equal(chart.children[0].children[2].children[0].style.width, '67%');
  assert.equal(chart.children[1].children[2].children[0].style.width, '0%');
  assert.match(chart.attributes['aria-label'], /Первый: 2, 67%/);
});
