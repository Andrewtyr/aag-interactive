window.statisticsChartMode = (slide) => {
  if (slide.statisticsChart === 'horizontal') return 'bar';
  if (slide.statisticsChart === 'column') return 'column';
  return slide.type === 'multi-quiz' ? 'column' : slide.statisticsChart === 'pie' ? 'pie' : 'bar';
};
window.renderStatisticsBars = (rows) => {
  const chart = document.createElement('div'); chart.className = 'statistics-bars';
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', rows.map((row) => `${row.label}: ${row.count}, ${row.percent}%`).join('; '));
  for (const row of rows) {
    const item = document.createElement('div'); item.className = 'statistics-bar';
    const label = document.createElement('span'); label.textContent = row.label;
    const value = document.createElement('strong'); value.textContent = `${row.count} · ${row.percent}%`;
    const track = document.createElement('div'); track.className = 'statistics-bar-track';
    const fill = document.createElement('span'); fill.style.width = `${row.percent}%`; fill.style.backgroundColor = row.color;
    track.append(fill); item.append(label, value, track); chart.append(item);
  }
  return chart;
};
window.statisticsChartData = (labels, counts, respondents, palette = ['#087c44', '#d2a64a', '#4077bd', '#a76bc1', '#df7f5a', '#4fada9', '#7b8b52', '#c36b89', '#6964b5', '#a37751']) => {
  const total = counts.reduce((sum, count) => sum + Math.max(0, count), 0);
  const denominator = respondents ?? total;
  let cursor = 0;
  const sectors = counts.map((count, index) => {
    const start = cursor;
    cursor += total ? count / total * 100 : 0;
    return `${palette[index % palette.length]} ${Number(start.toFixed(2))}% ${Number(cursor.toFixed(2))}%`;
  });
  return {
    rows: counts.map((count, index) => ({ label: labels[index] ?? String(index + 1), count, percent: denominator ? Math.min(100, Math.round(count / denominator * 100)) : 0, color: palette[index % palette.length] })),
    gradient: total ? `conic-gradient(${sectors.join(', ')})` : 'conic-gradient(#e3eee6 0% 100%)',
  };
};

window.renderStatisticsColumns = (rows) => {
  const chart = document.createElement('div');
  chart.className = 'statistics-columns';
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', rows.map((row) => `${row.label}: ${row.count}, ${row.percent}%`).join('; '));
  for (const row of rows) {
    const column = document.createElement('div'); column.className = 'statistics-column';
    const value = document.createElement('strong'); value.textContent = `${row.count} · ${row.percent}%`;
    const track = document.createElement('div'); track.className = 'statistics-column-track';
    const fill = document.createElement('span'); fill.className = 'statistics-column-fill'; fill.style.height = `${row.percent}%`; fill.style.backgroundColor = row.color;
    track.append(fill);
    const label = document.createElement('span'); label.className = 'statistics-column-label'; label.textContent = row.label; label.title = row.label;
    column.append(value, track, label); chart.append(column);
  }
  return chart;
};
