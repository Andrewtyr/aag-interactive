const $ = (id) => document.getElementById(id);
let credentials = null;
let state = null;
let renderKey = '';
let imageObjectUrl = null;
let assetObjectUrls = [];
let stageGeneration = 0;
const message = (value) => { $('message').textContent = value; };
const queryCode = new URLSearchParams(location.search).get('code');
if (queryCode) $('join-form').elements.code.value = queryCode;
try { credentials = JSON.parse(sessionStorage.getItem('aag-participant') ?? 'null'); } catch {}
if (queryCode && credentials?.code !== queryCode) {
  credentials = null;
  sessionStorage.removeItem('aag-participant');
}
async function api(path, method = 'GET', data) {
  const response = await fetch(path, { method, headers: { ...(credentials ? { 'x-participant-token': credentials.token } : {}), ...(data ? { 'content-type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Не удалось выполнить действие.');
  return result;
}
function stage(slide) {
  const generation = ++stageGeneration;
  const box = $('stage'); box.replaceChildren();
  box.classList.toggle('question-media-stage', ['quiz', 'multi-quiz', 'poll', 'scale', 'text', 'word-cloud'].includes(slide.type) && !!slide.elements?.length);
  window.applySlideAppearance(box, slide, state.aspectRatio);
  if (imageObjectUrl) { URL.revokeObjectURL(imageObjectUrl); imageObjectUrl = null; }
  for (const url of assetObjectUrls) URL.revokeObjectURL(url);
  assetObjectUrls = [];
  if (slide.template) {
    box.style.backgroundImage = '';
    fetch(`/aag/api/imports/${slide.template.importId}/pages/${slide.template.page}?event=${credentials.eventId}`, { headers: { 'x-participant-token': credentials.token } })
      .then((response) => { if (!response.ok) throw new Error('Не удалось загрузить шаблон слайда.'); return response.blob(); })
      .then((blob) => { if (generation !== stageGeneration) return; imageObjectUrl = URL.createObjectURL(blob); box.style.backgroundImage = `linear-gradient(#002a20b8,#002a20c9),url("${imageObjectUrl}")`; })
      .catch((issue) => message(issue.message));
  }
  if (slide.type === 'imported') {
    box.append(window.renderSlideElements(slide, { backgroundSrc: '', aspectRatio: state.aspectRatio }));
    const image = box.querySelector('.imported-background');
    const expectedIndex = state.slideIndex;
    fetch(`/aag/api/imports/${slide.importId}/pages/${slide.page}?event=${credentials.eventId}`, { headers: { 'x-participant-token': credentials.token } })
      .then((response) => { if (!response.ok) throw new Error('Не удалось загрузить слайд.'); return response.blob(); })
      .then((blob) => { if (generation !== stageGeneration || state?.slideIndex !== expectedIndex) return; imageObjectUrl = URL.createObjectURL(blob); image.src = imageObjectUrl; })
      .catch((issue) => message(issue.message));
    return;
  }
  const questionSlide = ['quiz', 'multi-quiz', 'poll', 'scale', 'text', 'word-cloud'].includes(slide.type);
  if (slide.elements && !questionSlide) {
    box.append(window.renderSlideElements(slide, { aspectRatio: state.aspectRatio }));
    loadImages(box);
    return;
  }
  const eyebrow = document.createElement('small'); eyebrow.textContent = slide.eyebrow;
  const title = document.createElement('h2'); title.textContent = slide.title;
  box.append(eyebrow, title);
  if (slide.body) { const body = document.createElement('p'); body.textContent = slide.body; box.append(body); }
  if (slide.bullets) { const list = document.createElement('ul'); slide.bullets.forEach((value) => { const item = document.createElement('li'); item.textContent = value; list.append(item); }); box.append(list); }
  if (questionSlide && slide.elements?.some((element) => ['image', 'video'].includes(element.type))) { const media = document.createElement('div'); media.className = 'question-media-preview'; media.append(window.renderSlideElements({ elements: slide.elements.filter((element) => ['image', 'video'].includes(element.type)) }, { aspectRatio: state.aspectRatio })); box.append(media); loadImages(media); }
  if (questionSlide && slide.elements?.some((element) => ['text', 'shape'].includes(element.type))) box.append(window.renderQuestionOverlay(slide, { aspectRatio: state.aspectRatio }));
  window.applyTextStyles(box, slide);
}
function loadImages(box) {
  const expectedIndex = state.slideIndex;
  box.querySelectorAll('img[data-asset-id]').forEach((image) => {
    image.removeAttribute('src');
    fetch(`/aag/api/assets/${image.dataset.assetId}?event=${credentials.eventId}`, { headers: { 'x-participant-token': credentials.token } })
      .then((response) => { if (!response.ok) throw new Error('Не удалось загрузить изображение.'); return response.blob(); })
      .then((blob) => { if (state?.slideIndex !== expectedIndex) return; const url = URL.createObjectURL(blob); assetObjectUrls.push(url); image.src = url; })
      .catch((issue) => message(issue.message));
  });
}
function render(data) {
  state = data; $('join-panel').hidden = true; $('participant-panel').hidden = false;
  $('slide-number').textContent = `Слайд ${data.slideIndex + 1} / ${data.slideCount}`;
  $('own-score').hidden = !data.event.ratingEnabled || !window.showPointsOnSlide(data.slide);
  $('own-score').textContent = data.question && !data.question.closed ? `Подтверждённые баллы: ${data.totalPoints} · за текущий вопрос появятся после закрытия` : `Ваши баллы: ${data.totalPoints}`;
  const key = window.participantRenderKey(data);
  if (key !== renderKey) {
    renderKey = key; stage(data.slide);
    const answer = $('answer-panel'); answer.replaceChildren();
    if (data.event.status === 'ended') answer.textContent = 'Сессия завершена. Спасибо за участие!';
    else if (data.event.status === 'paused') answer.textContent = 'Ведущий поставил показ на паузу. Ответить можно после продолжения.';
    else if (data.answered) answer.textContent = 'Ответ принят. Ожидайте следующего слайда.';
    else if (!data.question) answer.textContent = ['quiz', 'multi-quiz', 'poll', 'scale', 'text', 'word-cloud'].includes(data.slide.type) ? 'Ведущий скоро откроет вопрос.' : 'Следите за презентацией ведущего.';
    else if (data.question.closed) answer.textContent = 'Приём ответов закрыт.';
    else if (['quiz', 'poll'].includes(data.slide.type)) {
      data.slide.options.forEach((option, index) => { const button = document.createElement('button'); button.className = 'choice'; button.textContent = `${String.fromCharCode(65 + index)}. ${option}`; button.addEventListener('click', () => respond(index)); answer.append(button); });
    } else if (data.slide.type === 'multi-quiz') {
      const form = document.createElement('form'); form.className = 'multi-form';
      data.slide.options.forEach((option, index) => { const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.value = String(index); label.append(input, document.createTextNode(option)); form.append(label); });
      const button = document.createElement('button'); button.textContent = 'Отправить выбор'; form.append(button);
      form.addEventListener('submit', (event) => { event.preventDefault(); const chosen = [...form.querySelectorAll('input:checked')].map((input) => Number(input.value)); if (chosen.length) respond(chosen); else message('Выберите хотя бы один вариант.'); }); answer.append(form);
    } else if (data.slide.type === 'scale') {
      const scale = document.createElement('div'); scale.className = 'scale-choices';
      for (let value = 1; value <= data.slide.maxValue; value++) { const button = document.createElement('button'); button.textContent = String(value); button.addEventListener('click', () => respond(value)); scale.append(button); } answer.append(scale);
    } else if (data.slide.type === 'text') {
      const form = document.createElement('form'); form.className = 'answer-form'; const input = document.createElement('textarea'); input.maxLength = 1000; input.placeholder = 'Напишите ответ'; input.required = true; const button = document.createElement('button'); button.textContent = 'Отправить'; form.append(input, button); form.addEventListener('submit', (event) => { event.preventDefault(); respond(input.value); }); answer.append(form);
    } else if (data.slide.type === 'word-cloud') {
      const form = document.createElement('form'); form.className = 'answer-form';
      const input = document.createElement('input'); input.maxLength = 50; input.placeholder = 'Одно–три слова'; input.required = true;
      const button = document.createElement('button'); button.textContent = 'Отправить'; form.append(input, button);
      form.addEventListener('submit', (event) => { event.preventDefault(); respond(input.value); }); answer.append(form);
    }
    if (data.wordCloud.length) answer.append(window.renderWordCloud(data.wordCloud));
  }
  tick();
}
function tick() {
  const q = state?.question;
  if (!q) return $('timer').textContent = '';
  const seconds = Math.max(0, Math.ceil((q.deadline - (state.event.pausedAt ?? Date.now())) / 1000));
  $('timer').textContent = q.closed || seconds === 0 ? 'Приём закрыт' : `${state.event.status === 'paused' ? 'Пауза · ' : ''}${seconds} сек.`;
  if (seconds === 0 && !q.closed && state.event.status === 'active') refresh();
}
async function refresh() { if (!credentials) return; try { render(await api(`/aag/api/live/${credentials.eventId}/participant`)); message(''); } catch (issue) { message(issue.message); } }
async function respond(answer) {
  const eventId = credentials.eventId;
  const slideIndex = state.slideIndex;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await api(`/aag/api/live/${eventId}/respond`, 'POST', { answer, slideIndex });
        await refresh();
        return;
      } catch (issue) {
        if (!(issue instanceof TypeError) || attempt === 2) throw issue;
        message('Связь прервалась. Повторяем отправку…');
        await new Promise((done) => setTimeout(done, 150 + Math.random() * 300 * (attempt + 1)));
      }
    }
  } catch (issue) { message(issue.message); }
}
$('join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { const joined = await api('/aag/api/live/join', 'POST', Object.fromEntries(new FormData(event.currentTarget))); credentials = { eventId: joined.event.id, token: joined.participantToken, code: joined.event.code }; sessionStorage.setItem('aag-participant', JSON.stringify(credentials)); await refresh(); }
  catch (issue) { message(issue.message); }
});
function showAccount(user) {
  $('account-status').textContent = `Вход с аккаунтом: ${user.displayName}`;
  $('join-form').elements.name.value = user.displayName;
  $('join-form').elements.name.readOnly = true;
  $('account-login-form').hidden = true;
}
$('account-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('/aag/api/auth/login', 'POST', Object.fromEntries(new FormData(event.currentTarget)));
    showAccount(result.user); event.currentTarget.reset(); message('');
  } catch (issue) { message(issue.message); }
});
api('/aag/api/auth/me').then((result) => showAccount(result.user)).catch(() => {});
if (credentials) refresh();
setInterval(() => { if (credentials && !document.hidden) refresh(); else tick(); }, 1500);
