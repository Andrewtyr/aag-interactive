const $ = (id) => document.getElementById(id);
const eventId = Number(new URLSearchParams(location.search).get('event'));
const requestedMode = new URLSearchParams(location.search).get('mode') === 'fullscreen' ? 'fullscreen' : 'window';
let fullscreenMessage = '';
let slideRenderKey = '';
let qrPreference = null;
const make = (tag, value, className) => { const element = document.createElement(tag); element.textContent = value; if (className) element.className = className; return element; };
const fullscreenButton = $('fullscreen-button');
const connectionButton = $('connection-button');
connectionButton.addEventListener('click', () => {
  const panel = document.querySelector('.projector-connect');
  panel.hidden = !panel.hidden;
  qrPreference = !panel.hidden;
  connectionButton.textContent = panel.hidden ? 'Показать QR' : 'Скрыть QR';
});
const updateFullscreen = () => { fullscreenButton.textContent = document.fullscreenElement ? 'Выйти из полного экрана' : 'На весь экран'; $('fullscreen-hint').hidden = requestedMode !== 'fullscreen' || !!document.fullscreenElement; };
fullscreenButton.addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); fullscreenMessage = ''; $('message').textContent = ''; }
  catch { fullscreenMessage = 'Браузер не разрешил полный экран. Показ продолжается в окне.'; $('message').textContent = fullscreenMessage; }
  updateFullscreen();
});
document.addEventListener('fullscreenchange', updateFullscreen);
updateFullscreen();
function renderStatistics(slide, statistics) {
  const panel = document.createElement('aside'); panel.className = 'projector-statistics';
  panel.append(make('h2', 'Результаты ответов'), make('p', slide.type === 'multi-quiz' ? `Ответили: ${statistics.total} · можно выбрать несколько вариантов` : `Ответили: ${statistics.total}`));
  if (!statistics.counts.length) return panel;
  const labels = slide.options ?? statistics.counts.map((_, index) => String(index + 1));
  const chart = window.statisticsChartData(labels, statistics.counts, slide.type === 'multi-quiz' ? statistics.total : undefined, ['#f2ca70', '#91d4ff', '#f7a6ce', '#c8b5ff', '#ffad88', '#bde8a4']);
  const chartMode = window.statisticsChartMode(slide);
  if (chartMode === 'column') {
    panel.append(window.renderStatisticsColumns(chart.rows));
    return panel;
  }
  if (chartMode === 'bar') {
    panel.append(window.renderStatisticsBars(chart.rows));
    return panel;
  }
  if (chartMode === 'pie') {
    panel.classList.add('projector-statistics-pie');
    const pie = document.createElement('div'); pie.className = 'statistics-pie'; pie.style.background = chart.gradient;
    pie.setAttribute('role', 'img'); pie.setAttribute('aria-label', chart.rows.map((row) => `${row.label}: ${row.count}`).join(', '));
    panel.append(pie);
  }
  chart.rows.forEach((entry) => {
    const row = document.createElement('div'); row.className = 'statistics-row';
    const label = make('span', entry.label); label.style.color = entry.color;
    row.append(label, make('strong', `${entry.count} · ${entry.percent}%`));
    if (chartMode !== 'pie') {
      const track = document.createElement('div'); track.className = 'statistics-track';
      const fill = document.createElement('span'); fill.style.width = `${entry.percent}%`; fill.style.background = entry.color; track.append(fill); row.append(track);
    }
    panel.append(row);
  });
  return panel;
}
function fitComposition(box, typography) {
  if (!box.classList.contains('projector-with-statistics') && !box.classList.contains('projector-with-media')) return;
  const panel = box.querySelector('.projector-statistics');
  const pie = panel?.querySelector('.statistics-pie');
  if (pie) {
    const otherHeight = [...panel.children].filter((item) => item !== pie).reduce((sum, item) => sum + item.getBoundingClientRect().height, 0);
    const diameter = Math.max(30, Math.min(box.clientWidth * .17, panel.clientHeight - otherHeight - box.clientWidth * .04));
    pie.style.width = `${diameter}px`; pie.style.height = `${diameter}px`;
  }
  const columns = panel?.querySelector('.statistics-columns');
  if (columns) columns.style.setProperty('--chart-height', `${Math.max(25, Math.min(box.clientWidth * .12, panel.clientHeight - box.clientWidth * .11))}px`);
  const list = box.querySelector(':scope > ol, :scope > ul');
  const heading = box.querySelector(':scope > h1');
  if (!list || !heading) return;
  let size = typography.options;
  for (let pass = 0; pass < 22; pass++) {
    const frame = box.getBoundingClientRect(), options = list.getBoundingClientRect(), title = heading.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(box).paddingBottom);
    if (options.top >= title.bottom && options.bottom <= frame.bottom - padding + 1) break;
    size = Math.max(.65, size - .1); box.style.setProperty('--options-size', `${size}cqw`);
  }
}
async function refresh() {
  if (!eventId) return $('message').textContent = 'Откройте экран аудитории из пульта ведущего.';
  try {
    const response = await fetch(`/aag/api/live/${eventId}/projector`, { credentials: 'same-origin' });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    const box = $('slide');
    const welcome = !!data.slide.welcomeScreen;
    const isQuestion = ['quiz', 'multi-quiz', 'poll', 'scale', 'text', 'word-cloud'].includes(data.slide.type);
    const elementSlide = data.slide.type === 'imported' || (!isQuestion && !!data.slide.elements);
    const connection = document.querySelector('.projector-connect');
    box.classList.toggle('projector-welcome', welcome);
    connection.classList.toggle('welcome-connect', welcome);
    connectionButton.hidden = welcome;
    connection.hidden = welcome ? false : qrPreference === null ? isQuestion || !!data.slide.elements?.some((element) => element.type === 'video') : !qrPreference;
    connectionButton.textContent = connection.hidden ? 'Показать QR' : 'Скрыть QR';
    const nextKey = window.projectorRenderKey(data);
    const typography = window.projectorTypography(data.slide);
    box.style.setProperty('--title-size', `${typography.title}cqw`);
    box.style.setProperty('--options-size', `${typography.options}cqw`);
    box.classList.toggle('projector-with-statistics', !!data.statistics);
    box.classList.toggle('projector-statistics-centered', !!data.statistics && data.slide.statisticsPlacement === 'center');
    box.classList.toggle('projector-with-media', isQuestion && !!data.slide.elements?.some((element) => ['image', 'video'].includes(element.type)));
    box.classList.toggle('projector-with-cloud', !!data.wordCloud.length);
    box.classList.toggle('projector-element-slide', elementSlide);
    window.applySlideAppearance(box, data.slide, '16:9');
    window.applySlideTextPosition(box, data.slide);
    if (nextKey !== slideRenderKey) {
    slideRenderKey = nextKey;
    if (welcome) {
      box.replaceChildren(make('h1', data.event.title));
      box.append(connection);
    }
    else if (elementSlide) box.replaceChildren(window.renderSlideElements(data.slide, { aspectRatio: '16:9', playback: true }));
    else {
      box.replaceChildren(make('small', data.slide.eyebrow || 'ЗАНЯТИЕ ИЛИ МЕРОПРИЯТИЕ'), make('h1', data.slide.title));
      if (data.slide.body) box.append(make('p', data.slide.body));
      const values = data.slide.options ?? data.slide.bullets;
      if (values) { const list = document.createElement(data.slide.options ? 'ol' : 'ul'); values.forEach((value) => list.append(make('li', value))); box.append(list); }
      if (isQuestion && data.slide.elements?.some((element) => ['image', 'video'].includes(element.type))) { const media = document.createElement('div'); media.className = 'projector-question-media'; media.append(window.renderSlideElements({ elements: data.slide.elements.filter((element) => ['image', 'video'].includes(element.type)) }, { aspectRatio: '16:9', playback: true })); box.append(media); }
      if (isQuestion && data.slide.elements?.some((element) => ['text', 'shape'].includes(element.type))) box.append(window.renderQuestionOverlay(data.slide, { aspectRatio: '16:9' }));
    }
    }
    if (!welcome && connection.parentElement !== connectionButton.parentElement) connectionButton.before(connection);
    box.querySelectorAll(':scope > .projector-statistics, :scope > .cloud-map, :scope > .cloud, :scope > .question-state').forEach((item) => item.remove());
    if (data.statistics) box.append(renderStatistics(data.slide, data.statistics));
    if (data.wordCloud.length) box.append(window.renderWordCloud(data.wordCloud));
    if (data.leaderboard?.length) { const rank = document.createElement('div'); rank.className = 'cloud'; rank.append(make('h2', 'Рейтинг')); data.leaderboard.forEach((person) => rank.append(make('span', `${person.place}. ${person.name} — ${person.points}`))); box.append(rank); }
    $('code').textContent = data.event.code;
    $('count').textContent = `${data.participantCount} участников`;
    $('qr').src ||= `/aag/api/live/${eventId}/qr`;
    if (data.question && !data.question.closed) box.append(make('div', `${data.event.status === 'paused' ? 'Пауза' : 'Приём ответов открыт'} · ${Math.max(0, Math.ceil((data.question.deadline - (data.event.pausedAt ?? Date.now())) / 1000))} сек. · Ответили: ${data.answerCount} из ${data.participantCount}`, 'question-state'));
    if (data.event.status === 'ended') box.append(make('div', 'Сессия завершена', 'question-state'));
    box.querySelectorAll('video').forEach((video) => {
      if (data.event.status !== 'active' && !video.paused) { video.dataset.resumePlayback = '1'; video.pause(); }
      else if (data.event.status === 'active' && video.dataset.resumePlayback) { delete video.dataset.resumePlayback; video.play().catch(() => {}); }
    });
    window.applyTextStyles(box, data.slide);
    fitComposition(box, typography);
    $('message').textContent = fullscreenMessage;
  } catch (issue) { $('message').textContent = issue.message ?? 'Нет связи с сервером.'; }
}
refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 1500);
