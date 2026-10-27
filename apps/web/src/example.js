let slides = [];
let index = 0;
const slide = document.getElementById('slide');
const counter = document.getElementById('slide-counter');
const note = document.getElementById('note');
const title = document.getElementById('note-title');
const make = (tag, value, className) => { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; };
function render() {
  const item = slides[index];
  slide.className = `slide slide-${item.type}`; slide.replaceChildren();
  slide.append(make('div', item.eyebrow, 'eyebrow'), make('h1', item.title));
  if (item.body) slide.append(make('p', item.body, 'lead'));
  if (item.bullets) { const ul = document.createElement('ul'); item.bullets.forEach((line) => ul.append(make('li', line))); slide.append(ul); }
  if (item.options) { const ul = document.createElement('ol'); item.options.forEach((line) => ul.append(make('li', line))); slide.append(ul); }
  if (item.examples) { const cloud = make('div', '', 'word-cloud'); item.examples.forEach((word, position) => { const el = make('span', word); el.style.fontSize = `${[31,26,23,20,18][position]}px`; cloud.append(el); }); slide.append(cloud); }
  if (item.type === 'quiz') slide.append(make('small', `${item.points} баллов · до ${item.speedBonusPercent}% бонуса за скорость`, 'quiz-meta'));
  counter.textContent = `${String(index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
  title.textContent = `${index + 1}. ${item.title}`; note.textContent = 'Это открытый образец слайдов. Ответы и заметки ведущего доступны только в рабочем кабинете.';
  document.getElementById('previous').disabled = index === 0;
  document.getElementById('next').disabled = index === slides.length - 1;
}
function move(step) { const next = index + step; if (next >= 0 && next < slides.length) { index = next; render(); } }
document.getElementById('previous').addEventListener('click', () => move(-1));
document.getElementById('next').addEventListener('click', () => move(1));
document.addEventListener('keydown', (event) => { if (event.key === 'ArrowRight') move(1); if (event.key === 'ArrowLeft') move(-1); });
fetch('./public/materials/hospitality-standards.json').then((response) => response.json()).then((data) => { slides = data.slides; render(); }).catch(() => { note.textContent = 'Не удалось загрузить материал.'; });
