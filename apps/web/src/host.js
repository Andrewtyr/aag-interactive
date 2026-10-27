const $ = (id) => document.getElementById(id);
let csrf = null;
let eventId = Number(new URLSearchParams(location.search).get('event')) || null;
let materialId = Number(new URLSearchParams(location.search).get('material')) || null;
let displayMode = eventId ? localStorage.getItem(`aag-display-${eventId}`) || 'window' : 'window';
let state = null;
let currentJoinUrl = '';
const message = (value) => { $('message').textContent = value; };
async function api(path, method = 'GET', data) {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...(csrf && method !== 'GET' ? { 'x-csrf-token': csrf } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Не удалось выполнить действие.');
  return result;
}
const setPanels = (panel) => { for (const id of ['login-panel', 'start-panel', 'host-panel']) $(id).hidden = id !== panel; };
function appendSlide(parent, slide, aspectRatio = '16:9') {
  parent.replaceChildren();
  const questionSlide = ['quiz', 'multi-quiz', 'poll', 'scale', 'text', 'word-cloud'].includes(slide.type);
  parent.classList.toggle('question-media-stage', questionSlide && !!slide.elements?.length);
  window.applySlideAppearance(parent, slide, aspectRatio);
  if (slide.type === 'imported') { parent.append(window.renderSlideElements(slide, { aspectRatio })); return; }
  if (slide.elements && !questionSlide) { parent.append(window.renderSlideElements(slide, { aspectRatio })); return; }
  const small = document.createElement('small'); small.textContent = slide.eyebrow;
  const title = document.createElement('h2'); title.textContent = slide.title;
  parent.append(small, title);
  if (slide.welcomeScreen) { const qr = document.createElement('img'); qr.src = `/aag/api/live/${eventId}/qr`; qr.alt = 'QR-код подключения'; qr.style.cssText = 'width:120px;height:120px;background:white;padding:6px;align-self:center'; parent.append(qr); }
  if (slide.body) { const p = document.createElement('p'); p.textContent = slide.body; parent.append(p); }
  const values = slide.options ?? slide.bullets;
  if (values) { const list = document.createElement(slide.options ? 'ol' : 'ul'); for (const value of values) { const item = document.createElement('li'); item.textContent = value; list.append(item); } parent.append(list); }
  if (questionSlide && slide.elements?.some((element) => ['image', 'video'].includes(element.type))) { const media = document.createElement('div'); media.className = 'question-media-preview'; media.append(window.renderSlideElements({ elements: slide.elements.filter((element) => ['image', 'video'].includes(element.type)) }, { aspectRatio })); parent.append(media); }
  if (questionSlide && slide.elements?.some((element) => ['text', 'shape'].includes(element.type))) parent.append(window.renderQuestionOverlay(slide, { aspectRatio }));
}
function render(data) {
  state = data; setPanels('host-panel');
  const { event, slide, question } = data;
  document.querySelector('#host-panel h1').textContent = event.title;
  $('projector-link').href = `./projector.html?event=${event.id}&mode=${displayMode}`;
  $('session-status').textContent = event.status === 'ended' ? 'Сессия завершена' : `${event.format === 'event' ? 'Мероприятие' : 'Занятие'} · код ${event.code} · участников: ${data.participantCount}${event.status === 'paused' ? ' · пауза' : ''}${event.joinsOpen ? '' : ' · вход закрыт'}`;
  $('slide-number').textContent = `Слайд ${event.slideIndex + 1} / ${data.slideCount}`;
  $('join-code').textContent = event.code;
  if ($('join-qr').dataset.event !== String(event.id)) { $('join-qr').src = `/aag/api/live/${event.id}/qr`; $('join-qr').dataset.event = String(event.id); }
  if (data.joinUrl) currentJoinUrl = data.joinUrl;
  if (currentJoinUrl) { $('join-link').href = currentJoinUrl; $('join-link').textContent = currentJoinUrl; }
  $('participant-count').textContent = `Подключено: ${data.participantCount}`;
  $('answer-progress').textContent = question ? `${data.answers.length} из ${data.participantCount}` : '';
  appendSlide($('stage'), slide, data.aspectRatio);
  window.applyTextStyles($('stage'), slide);
  const next = data.nextSlide;
  if (next) { appendSlide($('next-stage'), next, data.aspectRatio); window.applyTextStyles($('next-stage'), next); $('next-slide-label').textContent = next.title; }
  else { $('next-stage').replaceChildren(); $('next-stage').style.backgroundColor = ''; $('next-slide-label').textContent = 'Конец презентации'; }
  $('presenter-notes').textContent = slide.note || 'Для этого слайда заметок нет.';
  if (slide.type === 'word-cloud' && data.wordCloud.length) $('stage').append(window.renderWordCloud(data.wordCloud));
  $('previous').disabled = event.status !== 'active' || event.slideIndex === 0;
  $('next').disabled = event.status !== 'active' || event.slideIndex >= data.slideCount - 1;
  const interactive = ['quiz', 'multi-quiz', 'poll', 'scale', 'text', 'word-cloud'].includes(slide.type);
  $('open-question').hidden = !interactive || !!question || event.status !== 'active';
  $('close-question').hidden = !question || question.closed || event.status !== 'active';
  $('toggle-statistics').hidden = !['quiz', 'multi-quiz', 'poll', 'scale', 'text'].includes(slide.type) || event.status === 'ended';
  $('toggle-statistics').textContent = data.statisticsVisible ? 'Скрыть статистику' : 'Показать статистику';
  $('statistics-placement').hidden = !['quiz', 'multi-quiz', 'poll', 'scale'].includes(slide.type) || event.status === 'ended';
  $('statistics-placement').textContent = data.statisticsPlacement === 'center' ? 'Вернуть варианты · статистику справа' : 'Статистику по центру · скрыть варианты';
  $('publish-cloud').hidden = slide.type !== 'word-cloud' || !question?.closed || question.published || event.status !== 'active';
  $('pause-button').hidden = event.status === 'ended';
  $('pause-button').textContent = event.status === 'paused' ? 'Продолжить' : 'Пауза';
  $('joins-button').hidden = event.status === 'ended';
  $('joins-button').textContent = event.joinsOpen ? 'Закрыть вход' : 'Открыть вход';
  $('rank-button').hidden = !event.ratingEnabled || event.leaderboardPublished;
  $('end-button').hidden = event.status === 'ended';
  const answers = $('answers'); answers.replaceChildren();
  const summary = $('statistics-summary'); summary.replaceChildren();
  if (question) {
    summary.append(makeSummary('Ответили', data.answers.length));
    const counts = slide.type === 'scale' ? Array(slide.maxValue).fill(0) : slide.options ? Array(slide.options.length).fill(0) : [];
    for (const answer of data.answers) {
      if (slide.type === 'multi-quiz') for (const index of JSON.parse(answer.answer)) counts[index]++;
      else if (['quiz', 'poll'].includes(slide.type)) counts[Number(answer.answer)]++;
      else if (slide.type === 'scale') counts[Number(answer.answer) - 1]++;
    }
    if (counts.length) {
      if (slide.type === 'multi-quiz') summary.append(makeSummary('Доля ответивших по каждому варианту', ''));
      const chart = window.statisticsChartData(slide.options ?? counts.map((_, index) => String(index + 1)), counts, data.answers.length);
      const mode = window.statisticsChartMode(slide);
      if (mode === 'column') summary.append(window.renderStatisticsColumns(chart.rows));
      else if (mode === 'bar') summary.append(window.renderStatisticsBars(chart.rows));
      else {
        const pie = document.createElement('div'); pie.className = 'host-statistics-pie'; pie.style.background = chart.gradient; pie.setAttribute('role', 'img'); pie.setAttribute('aria-label', chart.rows.map((row) => `${row.label}: ${row.count}`).join('; ')); summary.append(pie);
        chart.rows.forEach((row) => summary.append(makeSummary(row.label, `${row.count} · ${row.percent}%`)));
      }
    }
  }
  if (!data.answers.length) answers.textContent = 'Пока нет ответов.';
  for (const answer of data.answers) {
    const row = document.createElement('div'); row.className = 'answer-row';
    const label = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = answer.name;
    const detail = document.createElement('small');
    const selectedAnswer = ['quiz', 'poll'].includes(slide.type) ? slide.options[Number(answer.answer)] : slide.type === 'multi-quiz' ? JSON.parse(answer.answer).map((index) => slide.options[index]).join(', ') : answer.answer;
    detail.textContent = `${selectedAnswer}${answer.points ? ` · ${answer.points} баллов` : ''}${answer.hidden ? ' · скрыто' : ''}`;
    label.append(name, detail); row.append(label);
    if (slide.type === 'word-cloud' && !answer.hidden && !question?.published) {
      const hide = document.createElement('button'); hide.textContent = 'Скрыть';
      hide.addEventListener('click', () => act(`/aag/api/live/${eventId}/answers/${answer.id}/hide`)); row.append(hide);
    }
    if (slide.type === 'text' && slide.points > 0) {
      const grade = document.createElement('button'); grade.textContent = answer.graded_at ? 'Изменить баллы' : 'Оценить';
      grade.addEventListener('click', () => {
        const raw = window.prompt(`Баллы для «${answer.name}» от 0 до ${slide.points}:`, answer.graded_at ? String(answer.points) : '');
        if (raw === null) return;
        const points = Number(raw);
        if (!Number.isInteger(points) || points < 0 || points > slide.points) return message(`Укажите целое число от 0 до ${slide.points}.`);
        act(`/aag/api/live/${eventId}/answers/${answer.id}/grade`, { points });
      });
      row.append(grade);
    }
    answers.append(row);
  }
  const board = $('leaderboard'); board.replaceChildren();
  if (!event.ratingEnabled) board.textContent = 'Рейтинг выключен для этого запуска.';
  else if (!data.leaderboard.length) board.textContent = 'Пока нет участников.';
  data.leaderboard.forEach((person) => { const row = document.createElement('div'); row.className = 'leader-row'; row.textContent = `${person.place}. ${person.name} — ${person.points}`; board.append(row); });
  tick();
}
function makeSummary(label, count) { const row = document.createElement('p'); row.className = 'statistics-summary-row'; row.textContent = `${label}: ${count}`; return row; }
function tick() {
  if (state?.sessionStartedAt) {
    const elapsed = Math.max(0, Math.floor((Date.now() - state.sessionStartedAt) / 1000));
    const hours = Math.floor(elapsed / 3600);
    const minutes = Math.floor((elapsed % 3600) / 60);
    const secondsElapsed = elapsed % 60;
    $('session-elapsed').textContent = `Показ ${[hours, minutes, secondsElapsed].map((part) => String(part).padStart(2, '0')).join(':')}`;
  }
  const q = state?.question;
  if (!q) return $('timer').textContent = '';
  const seconds = Math.max(0, Math.ceil((q.deadline - (state.event.pausedAt ?? Date.now())) / 1000));
  $('timer').textContent = q.closed || seconds === 0 ? 'Приём ответов закрыт' : `${state.event.status === 'paused' ? 'Пауза · осталось' : 'Осталось'} ${seconds} сек.`;
}
async function refresh() { if (!eventId || !csrf) return; try { render(await api(`/aag/api/live/${eventId}/host`)); message(''); } catch (issue) { message(issue.message); } }
async function act(path, data) { try { render(await api(path, 'POST', data)); message(''); } catch (issue) { message(issue.message); } }
async function showStart() {
  if (materialId) {
    const selected = await api(`/aag/api/materials/${materialId}`);
    document.querySelector('#start-panel h1').textContent = selected.material.title;
    document.querySelector('#start-panel p').textContent = `${selected.material.slides.length} слайдов · ${selected.material.audience || 'Для занятий и мероприятий'}`;
  }
  setPanels('start-panel');
}
$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const result = await api('/aag/api/auth/login', 'POST', Object.fromEntries(new FormData(form)));
    csrf = result.csrfToken; form.reset(); message('');
    if (eventId) await refresh(); else await showStart();
  } catch (issue) { message(issue.message); }
});
$('start-button').addEventListener('click', async () => {
  const projectorWindow = window.open('about:blank', '_blank');
  try {
    const result = await api('/aag/api/live', 'POST', { ...(materialId ? { materialId } : {}), format: $('session-format').value, title: $('session-title').value || undefined, category: $('session-category').value, ratingEnabled: $('rating-enabled').checked });
    eventId = result.event.id;
    displayMode = document.querySelector('input[name="display-mode"]:checked').value;
    localStorage.setItem(`aag-display-${eventId}`, displayMode);
    history.replaceState({}, '', `?event=${eventId}`);
    if (projectorWindow) projectorWindow.location.href = `./projector.html?event=${eventId}&mode=${displayMode}`;
    await refresh();
    message(projectorWindow ? 'Сессия запущена. Экран аудитории открыт отдельно.' : 'Сессия запущена. Браузер заблокировал новое окно; откройте экран аудитории по ссылке.');
  } catch (issue) { projectorWindow?.close(); message(issue.message); }
});
$('previous').addEventListener('click', () => act(`/aag/api/live/${eventId}/slide`, { index: state.event.slideIndex - 1 }));
$('next').addEventListener('click', () => act(`/aag/api/live/${eventId}/slide`, { index: state.event.slideIndex + 1 }));
$('open-question').addEventListener('click', () => act(`/aag/api/live/${eventId}/open`));
$('close-question').addEventListener('click', () => act(`/aag/api/live/${eventId}/close`));
$('toggle-statistics').addEventListener('click', () => act(`/aag/api/live/${eventId}/statistics`, { show: !state.statisticsVisible }));
$('statistics-placement').addEventListener('click', async () => {
  try {
    if (!state.statisticsVisible) await api(`/aag/api/live/${eventId}/statistics`, 'POST', { show: true });
    await act(`/aag/api/live/${eventId}/statistics-placement`, { placement: state.statisticsPlacement === 'center' ? 'side' : 'center' });
  } catch (issue) { message(issue.message); }
});
$('publish-cloud').addEventListener('click', () => act(`/aag/api/live/${eventId}/publish`));
$('pause-button').addEventListener('click', () => act(`/aag/api/live/${eventId}/${state.event.status === 'paused' ? 'resume' : 'pause'}`));
$('joins-button').addEventListener('click', () => act(`/aag/api/live/${eventId}/joins`, { open: !state.event.joinsOpen }));
$('rank-button').addEventListener('click', () => act(`/aag/api/live/${eventId}/publish-rank`));
$('copy-join').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('join-link').href); message('Ссылка для участников скопирована.'); }
  catch { message('Не удалось скопировать. Выделите ссылку выше и скопируйте её вручную.'); }
});
$('end-button').addEventListener('click', () => { if (confirm('Завершить сессию? Новые участники больше не смогут войти.')) act(`/aag/api/live/${eventId}/end`); });
api('/aag/api/auth/me').then(async (result) => { csrf = result.csrfToken; if (eventId) refresh(); else await showStart(); }).catch((issue) => { if (csrf) message(issue.message); else setPanels('login-panel'); });
setInterval(() => { if (eventId && csrf && !document.hidden) refresh(); else tick(); }, 1500);
