const $ = (id) => document.getElementById(id);
let csrf = null;
const message = (value) => { $('message').textContent = value; };
async function api(path, method = 'GET', data) { const response = await fetch(path, { method, credentials: 'same-origin', headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...(csrf && method !== 'GET' ? { 'x-csrf-token': csrf } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Не удалось загрузить данные.'); return result; }
const node = (tag, value) => { const element = document.createElement(tag); element.textContent = value; return element; };
const date = (value) => new Date(value).toLocaleString('ru-RU', { timeZone: 'Asia/Novosibirsk' });
function table(headers, rows) { const wrap = document.createElement('div'); wrap.className = 'table-wrap'; const table = document.createElement('table'); const head = document.createElement('tr'); headers.forEach((value) => head.append(node('th', value))); table.append(head); rows.forEach((values) => { const row = document.createElement('tr'); values.forEach((value) => row.append(node('td', value))); table.append(row); }); wrap.append(table); return wrap; }
async function detail(id) {
  const report = (await api(`/aag/api/reports/${id}`)).report;
  const box = $('report-detail'); box.replaceChildren(); box.hidden = false;
  const heading = document.createElement('div'); heading.className = 'detail-head';
  const title = node('h2', report.event.title);
  const exportLink = document.createElement('a'); exportLink.className = 'button'; exportLink.href = `/aag/api/reports/${id}.csv`; exportLink.textContent = 'Скачать CSV';
  heading.append(title, exportLink); box.append(heading, node('p', `${report.event.format === 'event' ? 'Мероприятие' : 'Занятие'}${report.event.category ? ` · ${report.event.category}` : ''} · ${date(report.event.createdAt)} · ${report.event.status === 'ended' ? 'Завершено' : 'Идёт'} · ${report.participants.length} участников`));
  if (report.pendingManual) box.append(node('p', `Ожидают ручной оценки: ${report.pendingManual}. Итоговые баллы пока предварительные.`));
  box.append(node('h3', 'Участники'));
  const participantColumns = report.event.ratingEnabled ? ['Место', 'Имя', 'Баллы'] : report.hasScoredQuestions ? ['Имя', 'Баллы'] : ['Имя'];
  const participantRows = report.participants.map((person) => report.event.ratingEnabled ? [person.place, person.name, person.totalPoints] : report.hasScoredQuestions ? [person.name, person.totalPoints] : [person.name]);
  box.append(report.participants.length ? table(participantColumns, participantRows) : node('p', 'Участников пока нет.'));
  if (report.summaries?.length) { box.append(node('h3', 'Итоги опросов')); for (const summary of report.summaries) { box.append(node('h4', summary.title)); if (summary.average !== null) box.append(node('p', `Среднее значение: ${summary.average.toFixed(2)}`)); box.append(summary.counts.length ? table(['Ответ', 'Количество'], summary.counts.map((item) => [item.answer, item.count])) : node('p', 'Ответов пока нет.')); } }
  box.append(node('h3', 'Ответы'));
  box.append(report.responses.length ? table(report.hasScoredQuestions ? ['Участник', 'Слайд', 'Ответ', 'Баллы', 'Время'] : ['Участник', 'Слайд', 'Ответ', 'Время'], report.responses.map((answer) => report.hasScoredQuestions ? [answer.participantName, answer.slideTitle, answer.answer, answer.needsManual && !answer.gradedAt ? 'Ожидает оценки' : answer.points, date(answer.submittedAt)] : [answer.participantName, answer.slideTitle, answer.answer, date(answer.submittedAt)])) : node('p', 'Ответов пока нет.'));
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function load() {
  const { reports } = await api('/aag/api/reports'); const box = $('report-list'); box.replaceChildren();
  if (!reports.length) box.append(node('p', 'После первого запуска здесь появится отчёт.'));
  for (const report of reports) { const card = document.createElement('article'); card.className = 'panel material-card'; card.append(node('small', `${report.status === 'ended' ? 'ЗАВЕРШЕНО' : 'ИДЁТ'} · ${report.format === 'event' ? 'МЕРОПРИЯТИЕ' : 'ЗАНЯТИЕ'}`), node('h2', report.title), node('p', `${date(report.createdAt)} · ${report.participantCount} участников`)); const button = document.createElement('button'); button.className = 'button button-secondary'; button.textContent = 'Открыть отчёт'; button.addEventListener('click', () => detail(report.id).catch((issue) => message(issue.message))); card.append(button); box.append(card); }
  $('login-panel').hidden = true; $('reports-panel').hidden = false;
}
$('login-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { const result = await api('/aag/api/auth/login', 'POST', Object.fromEntries(new FormData(form))); csrf = result.csrfToken; form.reset(); await load(); message(''); } catch (issue) { message(issue.message); } });
api('/aag/api/auth/me').then(async (result) => { csrf = result.csrfToken; await load(); }).catch(() => { $('login-panel').hidden = false; });
