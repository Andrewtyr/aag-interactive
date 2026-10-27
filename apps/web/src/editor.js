const $ = (id) => document.getElementById(id);
let csrf = null;
let materialId = Number(new URLSearchParams(location.search).get('material')) || null;
let selected = 0;
let selectedElement = -1;
let activeTab = 'presentation';
let lastPresentationSlide = 0;
let material = { title: 'Новый материал', audience: '', description: '', slides: [{ type: 'cover', eyebrow: 'ПРЕЗЕНТАЦИЯ', title: 'Заголовок', body: 'Подзаголовок' }] };
let templateImports = [];
let dirtyRevision = 0;
let savedRevision = 0;
let saveTimer = null;
let savingPromise = null;
let saveBlocked = false;
let undoStack = [];
let redoStack = [];
let lastSnapshot = null;
const message = (value) => { $('message').textContent = value; };
async function api(path, method = 'GET', data) {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...(csrf && method !== 'GET' ? { 'x-csrf-token': csrf } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Не удалось сохранить материал.'); return result;
}
const node = (tag, value) => { const element = document.createElement(tag); element.textContent = value; return element; };
const current = () => material.slides[selected];
function changed() {
  const snapshot = JSON.stringify(material);
  if (lastSnapshot && snapshot !== lastSnapshot) { undoStack.push(lastSnapshot); if (undoStack.length > 40) undoStack.shift(); redoStack = []; }
  lastSnapshot = snapshot;
  dirtyRevision++;
  $('save-status').textContent = 'Несохранённые изменения';
  $('page-heading').textContent = material.title || 'Новый материал';
  clearTimeout(saveTimer);
  if (!saveBlocked) saveTimer = setTimeout(() => save().catch((issue) => message(issue.message)), 1200);
  $('undo-button').disabled = !undoStack.length;
  $('redo-button').disabled = !redoStack.length;
}
function renderList() {
  const box = $('slide-list'); box.replaceChildren();
  const labels = { quiz: 'ТЕСТ', 'multi-quiz': 'НЕСКОЛЬКО', poll: 'ОПРОС', scale: 'ШКАЛА', text: 'ОТВЕТ', 'word-cloud': 'ОБЛАКО', imported: 'ИМПОРТ' };
  const questions = $('question-list'); questions.replaceChildren();
  material.slides.forEach((slide, index) => { const button = document.createElement('button'); button.className = `slide-thumb${index === selected ? ' selected' : ''}`; const number = node('small', `${String(index + 1).padStart(2, '0')} · ${labels[slide.type] ?? 'СЛАЙД'}`); button.append(number, node('span', slide.title || 'Без названия')); button.addEventListener('click', () => { selected = index; if (!isQuestion(slide)) lastPresentationSlide = index; selectedElement = -1; render(); }); box.append(button);
    if (isQuestion(slide)) { const questionButton = button.cloneNode(true); questionButton.addEventListener('click', () => { selected = index; selectedElement = -1; render(); }); questions.append(questionButton); }
  });
}
const isQuestion = (slide) => ['quiz', 'multi-quiz', 'poll', 'scale', 'text', 'word-cloud'].includes(slide?.type);
function setTab(tab) {
  if (activeTab === 'presentation' && tab === 'interactive' && !isQuestion(current())) lastPresentationSlide = selected;
  activeTab = tab;
  $('presentation-pane').hidden = tab !== 'presentation'; $('interactive-pane').hidden = tab !== 'interactive';
  $('presentation-tab').setAttribute('aria-selected', String(tab === 'presentation'));
  $('interactive-tab').setAttribute('aria-selected', String(tab === 'interactive'));
  if (tab === 'interactive' && !isQuestion(current())) selected = material.slides.findIndex(isQuestion) >= 0 ? material.slides.findIndex(isQuestion) : selected;
  (tab === 'interactive' ? $('interactive-canvas-slot') : document.querySelector('#presentation-pane .editor-center')).prepend($('canvas').closest('.canvas-panel'));
  selectedElement = -1; render();
}
function editableCanvasText(element, slide, key, index = -1) {
  if (!isQuestion(slide)) return element;
  const label = index >= 0 ? `Вариант ${index + 1}` : key === 'title' ? 'Вопрос' : key === 'eyebrow' ? 'Метка' : 'Текст слайда';
  element.title = 'Дважды нажмите, чтобы изменить текст';
  element.setAttribute('aria-label', `${label}: дважды нажмите для редактирования`);
  element.addEventListener('dblclick', () => { element.contentEditable = 'true'; element.focus(); });
  element.addEventListener('keydown', (event) => {
    if (element.contentEditable !== 'true') return;
    if (event.key === 'Escape') { element.textContent = index >= 0 ? slide.options[index] : slide[key] || ''; element.blur(); }
    else if (event.key === 'Enter' && (key !== 'body' || !event.shiftKey)) { event.preventDefault(); element.blur(); }
  });
  element.addEventListener('blur', () => {
    if (element.contentEditable !== 'true') return;
    element.contentEditable = 'false';
    const oldValue = index >= 0 ? slide.options[index] : slide[key] || '';
    const value = element.textContent.trim();
    const limit = index >= 0 ? 300 : key === 'title' ? 200 : key === 'eyebrow' ? 100 : 1500;
    if ((!value && (index >= 0 || key === 'title')) || value.length > limit) { element.textContent = oldValue; return message(`Проверьте ${label.toLowerCase()}: не более ${limit} символов.`); }
    if (value === oldValue) return;
    if (index >= 0) slide.options[index] = value; else slide[key] = value;
    changed(); renderList(); renderCanvas(); renderFields();
  });
  return element;
}
function renderCanvas() {
  const slide = current(); const box = $('canvas');
  const chart = ['quiz', 'multi-quiz', 'poll', 'scale', 'text'].includes(slide.type);
  box.classList.toggle('canvas-question-layout', isQuestion(slide) && (chart || !!slide.elements?.length));
  box.classList.toggle('canvas-question-centered', chart && slide.statisticsPlacement === 'center');
  box.style.removeProperty('background');
  box.style.backgroundImage = ''; box.style.backgroundSize = ''; box.style.backgroundPosition = '';
  box.style.aspectRatio = material.aspectRatio === '4:3' ? '4 / 3' : '16 / 9';
  window.applySlideTextPosition(box, slide);
  if (slide.type === 'imported' || (slide.elements && !isQuestion(slide))) {
    box.replaceChildren(window.renderSlideElements(slide, { editable: true, aspectRatio: material.aspectRatio, selectedIndex: selectedElement,
      onSelect: (index) => { selectedElement = index; box.querySelectorAll('.slide-object').forEach((item, itemIndex) => item.classList.toggle('selected', itemIndex === index)); renderFields(); },
      onChange: () => { changed(); renderFields(); },
    }));
    return;
  }
  box.replaceChildren(editableCanvasText(node('small', slide.eyebrow || 'ААГ ИНТЕРАКТИВ'), slide, 'eyebrow'), editableCanvasText(node('h2', slide.title || 'Заголовок'), slide, 'title'));
  box.style.aspectRatio = material.aspectRatio === '4:3' ? '4 / 3' : '16 / 9';
  if (slide.background) box.style.background = slide.background; else box.style.removeProperty('background');
  box.style.backgroundImage = slide.template ? `linear-gradient(#002a20b8,#002a20c9),url("/aag/api/imports/${slide.template.importId}/pages/${slide.template.page}")` : '';
  box.style.backgroundSize = slide.template ? 'cover' : '';
  box.style.backgroundPosition = slide.template ? 'center' : '';
  if (slide.body) box.append(editableCanvasText(node('p', slide.body), slide, 'body'));
  const values = slide.options ?? slide.bullets;
  if (values?.length) { const list = document.createElement(slide.options ? 'ol' : 'ul'); values.forEach((value, index) => list.append(slide.options ? editableCanvasText(node('li', value), slide, 'options', index) : node('li', value))); box.append(list); }
  if (slide.type === 'scale') box.append(node('p', `Оценка от 1 до ${slide.maxValue}`));
  const side = document.createElement('div'); side.className = 'canvas-question-side';
  const mediaIndexes = (slide.elements ?? []).map((element, index) => ['image', 'video'].includes(element.type) ? index : -1).filter((index) => index >= 0);
  if (isQuestion(slide) && mediaIndexes.length) {
    const media = document.createElement('div'); media.className = 'question-media-preview';
    media.append(window.renderSlideElements({ elements: mediaIndexes.map((index) => slide.elements[index]) }, { editable: true, aspectRatio: material.aspectRatio, selectedIndex: mediaIndexes.indexOf(selectedElement), onSelect: (index) => { selectedElement = mediaIndexes[index]; box.querySelectorAll('.slide-object').forEach((item) => item.classList.remove('selected')); media.querySelectorAll('.slide-object')[index]?.classList.add('selected'); renderFields(); }, onChange: () => { changed(); renderFields(); } })); side.append(media);
  }
  if (chart) {
    const preview = document.createElement('aside'); preview.className = 'canvas-statistics-preview';
    preview.append(node('strong', 'Результаты ответов'), node('small', 'Ответили: 0'));
    const labels = slide.options ?? (slide.type === 'scale' ? Array.from({ length: slide.maxValue }, (_, index) => String(index + 1)) : []);
    labels.slice(0, 6).forEach((label) => { const row = document.createElement('div'); row.append(node('span', label), node('b', '0')); preview.append(row); });
    side.append(preview);
  }
  if (side.childElementCount) box.append(side);
  if (isQuestion(slide) && slide.elements?.some((element) => ['text', 'shape'].includes(element.type))) {
    box.append(window.renderQuestionOverlay(slide, { editable: true, aspectRatio: material.aspectRatio, selectedIndex: selectedElement, onSelect: (index) => { selectedElement = index; box.querySelectorAll('.slide-object').forEach((item) => item.classList.remove('selected')); const overlayIndex = slide.elements.slice(0, index + 1).filter((element) => ['text', 'shape'].includes(element.type)).length - 1; box.querySelectorAll('.question-slide-overlay .slide-object')[overlayIndex]?.classList.add('selected'); renderFields(); }, onChange: () => { changed(); renderFields(); } }));
  }
  window.applyTextStyles(box, slide);
}
function field(label, key, kind = 'input', help = '') {
  const wrapper = document.createElement('label'); wrapper.textContent = label;
  const input = document.createElement(kind === 'textarea' ? 'textarea' : 'input'); input.name = key;
  input.value = Array.isArray(current()[key]) ? current()[key].join(key === 'correctIndices' ? ', ' : '\n') : String(current()[key] ?? '');
  if (kind === 'number') { input.type = 'number'; input.min = ['correctIndex', 'speedBonusPercent', 'points'].includes(key) ? '0' : '5'; input.max = key === 'speedBonusPercent' ? '50' : key === 'points' ? '1000' : key === 'timeSeconds' ? '300' : key === 'maxValue' ? '10' : '5'; if (key === 'maxValue') input.step = '5'; }
  input.addEventListener('input', () => { current()[key] = ['correctIndex', 'points', 'speedBonusPercent', 'timeSeconds', 'maxValue'].includes(key) ? Number(input.value) : key === 'correctIndices' ? input.value.split(/[\s,;]+/).filter(Boolean).map(Number) : ['options', 'bullets'].includes(key) ? input.value.split('\n').map((value) => value.trim()).filter(Boolean) : input.value; changed(); renderList(); renderCanvas(); });
  wrapper.append(input); if (help) wrapper.append(node('small', help)); return wrapper;
}
function elementField(label, key, kind = 'input') {
  const element = current().elements[selectedElement];
  const wrapper = document.createElement('label'); wrapper.textContent = label;
  const input = document.createElement(kind === 'textarea' ? 'textarea' : 'input');
  input.value = String(element[key] ?? (['focalX', 'focalY'].includes(key) ? 50 : ['rotation', 'startTime'].includes(key) ? 0 : ''));
  if (key === 'color') input.type = 'color';
  if (key === 'fontSize') { input.type = 'number'; input.min = '12'; input.max = '72'; }
  const numeric = ['x', 'y', 'w', 'h', 'rotation', 'focalX', 'focalY', 'startTime'].includes(key);
  if (numeric) { input.type = 'number'; input.dataset.mediaKey = key; input.min = key === 'rotation' ? '-180' : ['w', 'h'].includes(key) ? '5' : '0'; input.max = key === 'rotation' ? '180' : key === 'startTime' ? '36000' : '100'; input.step = ['x', 'y', 'w', 'h'].includes(key) ? 'any' : '1'; }
  input.addEventListener('input', () => {
    if (numeric && !input.checkValidity()) return;
    if (['w', 'h'].includes(key)) { const delta = Number(input.value) - element[key]; Object.assign(element, window.editorSlideTools.resizeElement(element, key === 'w' ? delta : 0, key === 'h' ? delta : 0, 'se', ['image', 'video'].includes(element.type) && element.lockAspect !== false)); }
    else { element[key] = key === 'fontSize' || numeric ? Number(input.value) : input.value; if (key === 'x') element.x = Math.min(100 - element.w, element.x); if (key === 'y') element.y = Math.min(100 - element.h, element.y); }
    wrapper.closest('.form')?.querySelectorAll('[data-media-key]').forEach((field) => { if (field !== input && Number.isFinite(element[field.dataset.mediaKey])) field.value = String(Math.round(element[field.dataset.mediaKey] * 100) / 100); });
    changed(); renderCanvas();
  });
  wrapper.append(input); return wrapper;
}
function appendElementFields(box, slide) {
    if (selectedElement >= 0 && slide.elements[selectedElement]) {
      const element = slide.elements[selectedElement];
      box.append(node('h3', 'Выбранный элемент'));
      const geometry = document.createElement('div'); geometry.className = 'media-geometry';
      geometry.append(elementField('Слева, %', 'x'), elementField('Сверху, %', 'y'), elementField('Ширина, %', 'w'), elementField('Высота, %', 'h')); box.append(geometry);
      if (element.type === 'text') box.append(elementField('Текст', 'text', 'textarea'), elementField('Размер шрифта', 'fontSize'));
      if (!['image', 'video'].includes(element.type)) box.append(elementField('Цвет', 'color'));
      if (['image', 'video'].includes(element.type)) {
        const check = (label, key, fallback) => { const field = document.createElement('label'); field.className = 'media-checkbox'; const input = document.createElement('input'); input.type = 'checkbox'; input.checked = element[key] ?? fallback; input.addEventListener('change', () => { element[key] = input.checked; changed(); renderCanvas(); }); field.append(input, document.createTextNode(label)); return field; };
        box.append(check('Сохранять пропорции', 'lockAspect', true), elementField('Поворот, °', 'rotation'));
        const fit = document.createElement('label'); fit.textContent = 'Изображение в рамке'; const select = document.createElement('select'); select.append(new Option('Вписать целиком', 'contain'), new Option('Заполнить с обрезкой', 'cover')); select.value = element.fit || 'contain'; select.addEventListener('change', () => { element.fit = select.value; changed(); renderCanvas(); renderFields(); }); fit.append(select); box.append(fit);
        if (element.fit === 'cover') box.append(elementField('Центр обрезки X, %', 'focalX'), elementField('Центр обрезки Y, %', 'focalY'));
        const center = document.createElement('button'); center.type = 'button'; center.textContent = 'По центру слайда'; center.addEventListener('click', () => { element.x = (100 - element.w) / 2; element.y = (100 - element.h) / 2; changed(); render(); }); box.append(center);
        const fill = document.createElement('button'); fill.type = 'button'; fill.textContent = 'На весь слайд'; fill.addEventListener('click', () => { Object.assign(element, { x: 0, y: 0, w: 100, h: 100, fit: 'cover', rotation: 0 }); changed(); render(); }); box.append(fill);
        const replace = document.createElement('label'); replace.textContent = 'Заменить файл'; const file = document.createElement('input'); file.type = 'file'; file.accept = element.type === 'video' ? 'video/mp4,video/webm' : 'image/png,image/jpeg'; file.addEventListener('change', () => { if (file.files[0]) uploadMedia(file.files[0], element).catch((issue) => message(issue.message)); }); replace.append(file); box.append(replace);
        if (element.type === 'video') {
          box.append(check('Автоматически запускать', 'autoplay', false), check('Без звука', 'muted', true), check('Повторять ролик', 'loop', false), elementField('Начать с секунды', 'startTime'));
          box.append(node('small', 'Автозапуск со звуком может блокироваться браузером. Настройки повтора и звука для ссылок зависят от видеосервиса.'));
          const preview = document.createElement('button'); preview.type = 'button'; preview.textContent = 'Посмотреть видео'; preview.addEventListener('click', () => window.open(element.url || `/aag/api/assets/${element.assetId}`, '_blank', 'noopener')); box.append(preview);
          const link = document.createElement('button'); link.type = 'button'; link.textContent = 'Заменить ссылку'; link.addEventListener('click', () => addVideoLink(element)); box.append(link);
        }
        box.append(node('small', 'Перетаскивайте элемент и угловые маркеры. Shift при изменении размера — свободные пропорции. Стрелки — точное перемещение.'));
      }
      if (element.type === 'shape') { const label = document.createElement('label'); label.textContent = 'Фигура'; const select = document.createElement('select'); for (const [value, name] of [['rectangle', 'Прямоугольник'], ['ellipse', 'Эллипс']]) { const option = new Option(name, value); select.append(option); } select.value = element.shape || 'rectangle'; select.addEventListener('change', () => { element.shape = select.value; changed(); renderCanvas(); }); label.append(select); box.append(label); }
      if (element.type === 'text') {
        box.append(fontPicker(element.fontFamily, (value) => { element.fontFamily = value; changed(); renderCanvas(); }));
        const bold = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!element.bold; bold.append(input, document.createTextNode(' Жирный текст')); input.addEventListener('change', () => { element.bold = input.checked; changed(); renderCanvas(); }); box.append(bold);
        const italic = document.createElement('label'); const italicInput = document.createElement('input'); italicInput.type = 'checkbox'; italicInput.checked = !!element.italic; italic.append(italicInput, document.createTextNode(' Курсив')); italicInput.addEventListener('change', () => { element.italic = italicInput.checked; changed(); renderCanvas(); }); box.append(italic);
        const alignment = document.createElement('label'); alignment.textContent = 'Выравнивание'; const select = document.createElement('select'); for (const [value, name] of [['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа']]) { const option = document.createElement('option'); option.value = value; option.textContent = name; select.append(option); } select.value = element.align; select.addEventListener('change', () => { element.align = select.value; changed(); renderCanvas(); }); alignment.append(select); box.append(alignment);
      }
      const duplicate = document.createElement('button'); duplicate.type = 'button'; duplicate.textContent = 'Дублировать элемент'; duplicate.addEventListener('click', () => { if (slide.elements.length >= 40) return message('На слайде может быть не более 40 элементов.'); const copy = structuredClone(element); copy.id = crypto.randomUUID(); copy.x = Math.min(100 - copy.w, copy.x + 4); copy.y = Math.min(100 - copy.h, copy.y + 4); slide.elements.splice(selectedElement + 1, 0, copy); selectedElement++; changed(); render(); }); box.append(duplicate);
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Удалить элемент'; remove.addEventListener('click', () => { slide.elements.splice(selectedElement, 1); selectedElement = -1; changed(); render(); }); box.append(remove);
    } else box.append(node('p', 'Выберите элемент на слайде или добавьте надпись/фигуру.'));
}
function fontPicker(value, update) {
  const label = document.createElement('label'); label.textContent = 'Шрифт';
  const select = document.createElement('select');
  window.aagFonts.forEach((font) => select.append(new Option(font, font)));
  select.value = value || 'Manrope';
  select.addEventListener('change', () => update(select.value)); label.append(select); return label;
}
function textFormatting(box, slide) {
  const section = document.createElement('fieldset'); section.className = 'text-formatting';
  section.append(node('legend', 'Оформление текста'));
  for (const [key, name, size, bold] of [['title', 'Заголовок / вопрос', 64, true], ['body', 'Основной текст', 32, false], ['options', 'Пункты / варианты ответа', 35, false]]) {
    const row = document.createElement('div'); row.className = 'text-format-row'; row.append(node('strong', name));
    const currentStyle = () => slide.textStyles?.[key] || { fontFamily: 'Manrope', fontSize: size, bold };
    const update = (name, value) => { slide.textStyles ||= {}; slide.textStyles[key] = { ...currentStyle(), [name]: value }; changed(); renderCanvas(); };
    row.append(fontPicker(currentStyle().fontFamily, (value) => update('fontFamily', value)));
    const label = document.createElement('label'); label.textContent = 'Размер';
    const input = document.createElement('input'); input.type = 'number'; input.min = '12'; input.max = '96'; input.value = currentStyle().fontSize;
    input.addEventListener('change', () => { if (input.checkValidity() && input.value) update('fontSize', Number(input.value)); }); label.append(input); row.append(label);
    const weight = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = currentStyle().bold;
    check.addEventListener('change', () => update('bold', check.checked)); weight.append(check, document.createTextNode(' Жирный')); row.append(weight);
    section.append(row);
  }
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'button-secondary'; reset.textContent = 'Вернуть стандартное оформление';
  reset.addEventListener('click', () => { delete slide.textStyles; changed(); renderCanvas(); renderFields(); }); section.append(reset);
  box.append(section);
}
function questionTemplatePicker(slide) {
  const section = document.createElement('fieldset'); section.className = 'question-template-picker';
  section.append(node('legend', 'Шаблон интерактивного слайда'));
  const label = document.createElement('label'); label.textContent = 'Презентация';
  const select = document.createElement('select'); select.append(new Option('Стандартный зелёный фон', ''));
  for (const imported of templateImports) select.append(new Option(imported.name, imported.id));
  if (slide.template && !templateImports.some((entry) => entry.id === slide.template.importId)) select.append(new Option('Ранее загруженный шаблон', slide.template.importId));
  select.value = slide.template?.importId || '';
  select.addEventListener('change', () => {
    if (select.value) slide.template = { importId: select.value, page: 1 };
    else delete slide.template;
    changed(); renderCanvas(); renderFields();
  });
  label.append(select); section.append(label);
  if (slide.template) {
    const pageLabel = document.createElement('label'); pageLabel.textContent = 'Страница для фона';
    const pageSelect = document.createElement('select');
    const count = templateImports.find((entry) => entry.id === slide.template.importId)?.slideCount ?? slide.template.page;
    for (let page = 1; page <= count; page++) pageSelect.append(new Option(`Страница ${page}`, String(page)));
    pageSelect.value = String(slide.template.page);
    pageSelect.addEventListener('change', () => { slide.template.page = Number(pageSelect.value); changed(); renderCanvas(); renderFields(); });
    pageLabel.append(pageSelect); section.append(pageLabel);
    const image = document.createElement('img'); image.className = 'question-template-preview'; image.alt = 'Предпросмотр шаблона'; image.src = `/aag/api/imports/${slide.template.importId}/pages/${slide.template.page}`; section.append(image);
  }
  const upload = document.createElement('label'); upload.textContent = 'Загрузить новый PPTX или PDF';
  const file = document.createElement('input'); file.type = 'file'; file.accept = '.pptx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation';
  file.addEventListener('change', async () => { try { if (file.files?.[0]) await uploadQuestionTemplate(file.files[0], slide); } catch (issue) { message(issue.message); } finally { file.value = ''; } });
  upload.append(file); section.append(upload, node('small', 'До 50 МБ. Выберите страницу после загрузки. Она будет фоном под вопросом и диаграммой; текст исходного файла останется частью картинки.'));
  return section;
}
async function uploadQuestionTemplate(file, targetSlide) {
  const extension = file.name.toLowerCase().split('.').pop();
  if (!['pdf', 'pptx'].includes(extension) || file.size > 50 * 1024 * 1024) throw new Error('Выберите PPTX или PDF до 50 МБ.');
  message('Преобразуем страницы шаблона…');
  const type = extension === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const response = await fetch('/aag/api/imports', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': type, 'x-file-name': encodeURIComponent(file.name), 'x-csrf-token': csrf }, body: file });
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Не удалось загрузить шаблон.');
  if (targetSlide !== current()) throw new Error('Слайд изменился. Выберите страницу загруженного шаблона снова.');
  templateImports.unshift({ id: result.imported.id, name: result.imported.name, slideCount: result.imported.slideCount });
  targetSlide.template = { importId: result.imported.id, page: 1 };
  changed(); render(); message(`Шаблон загружен: ${result.imported.slideCount} страниц. Сейчас выбрана первая.`);
}
function renderFields() {
  const slide = current(); const box = $(activeTab === 'interactive' ? 'question-fields' : 'fields'); box.replaceChildren();
  if (activeTab === 'presentation' && isQuestion(slide)) { box.append(node('p', 'Текст и ответы меняются во вкладке «Интерактив». Здесь можно добавить и настроить изображение или видео рядом с вопросом.')); if (slide.elements?.length) appendElementFields(box, slide); return; }
  if (activeTab === 'interactive' && !isQuestion(slide)) { box.append(node('p', 'Добавьте вопрос, чтобы настроить интерактив.')); return; }
  if (slide.type === 'imported') {
    box.append(node('p', 'Исходный слайд сохранён как изображение. Поверх можно добавить текст, фигуры, изображения и видео и изменить их положение и размер.'));
    box.append(field('Название для списка слайдов', 'title'), field('Заметки ведущего', 'note', 'textarea'));
    appendElementFields(box, slide);
    return;
  }
  if (slide.elements && !isQuestion(slide)) {
    box.append(field('Название слайда', 'title'), field('Заметки ведущего', 'note', 'textarea'));
    const background = document.createElement('label'); background.textContent = 'Фон слайда'; const color = document.createElement('input'); color.type = 'color'; color.value = slide.background || '#006f37'; color.addEventListener('input', () => { slide.background = color.value; changed(); renderCanvas(); }); background.append(color); box.append(background);
    appendElementFields(box, slide);
    return;
  }
  box.append(field('Заголовок', 'title'), field('Метка над заголовком', 'eyebrow'), field('Текст', 'body', 'textarea'));
  textFormatting(box, slide);
  if (isQuestion(slide)) {
    const label = document.createElement('label');
    const value = node('span', `${slide.textOffsetY ?? 0}%`);
    label.append(document.createTextNode('Сдвиг текста вверх / вниз '), value);
    const input = document.createElement('input'); input.type = 'range'; input.min = '-12'; input.max = '12'; input.step = '1'; input.value = String(slide.textOffsetY ?? 0);
    input.addEventListener('input', () => { slide.textOffsetY = Number(input.value); value.textContent = `${slide.textOffsetY}%`; changed(); renderCanvas(); });
    label.append(input); box.append(label);
  }
  if (isQuestion(slide)) box.append(questionTemplatePicker(slide));
  if (isQuestion(slide)) { const background = document.createElement('label'); background.textContent = 'Фон слайда'; const color = document.createElement('input'); color.type = 'color'; color.value = slide.background || '#006f37'; color.addEventListener('input', () => { slide.background = color.value; changed(); renderCanvas(); }); background.append(color); box.append(background); }
  if (!isQuestion(slide)) { const background = document.createElement('label'); background.textContent = 'Фон слайда'; const color = document.createElement('input'); color.type = 'color'; color.value = slide.background || '#006f37'; color.addEventListener('input', () => { slide.background = color.value; changed(); renderCanvas(); }); background.append(color); box.append(background); }
  if (['content', 'closing'].includes(slide.type)) box.append(field('Пункты — по одному на строку', 'bullets', 'textarea'));
  if (['quiz', 'multi-quiz', 'poll'].includes(slide.type)) box.append(field('Варианты — по одному на строку', 'options', 'textarea'));
  if (slide.type === 'quiz') box.append(field('Номер правильного ответа, начиная с 0', 'correctIndex', 'number'));
  if (slide.type === 'multi-quiz') box.append(field('Номера правильных вариантов через запятую, начиная с 0', 'correctIndices'));
  if (slide.type === 'scale') box.append(field('Верхняя граница шкалы: 5 или 10', 'maxValue', 'number'));
  if (['quiz', 'multi-quiz', 'poll', 'scale', 'text', 'word-cloud'].includes(slide.type)) box.append(field('Время, секунд', 'timeSeconds', 'number'));
  if (['quiz', 'multi-quiz', 'text'].includes(slide.type)) box.append(field(slide.type === 'text' ? 'Баллы при ручной проверке (0 — без оценки)' : 'Баллы', 'points', 'number'));
  if (['quiz', 'multi-quiz'].includes(slide.type)) box.append(field('Бонус за скорость, %', 'speedBonusPercent', 'number'));
  if (['quiz', 'multi-quiz', 'poll', 'scale'].includes(slide.type)) {
    const setting = document.createElement('label'); setting.textContent = 'Диаграмма результатов';
    const select = document.createElement('select');
    const chartOptions = [['column', 'Вертикальные столбцы'], ['horizontal', 'Горизонтальные полосы'], ...(slide.type === 'multi-quiz' ? [] : [['pie', 'Круговая']])];
    for (const [value, label] of chartOptions) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); }
    select.value = ['column', 'horizontal'].includes(slide.statisticsChart) ? slide.statisticsChart : slide.type === 'multi-quiz' ? 'column' : slide.statisticsChart === 'pie' ? 'pie' : 'horizontal';
    select.addEventListener('change', () => { slide.statisticsChart = select.value; changed(); });
    setting.append(select); box.append(setting);
  }
  if (['quiz', 'multi-quiz', 'poll', 'scale', 'text'].includes(slide.type)) {
    const setting = document.createElement('label'); setting.textContent = 'Расположение статистики на экране показа';
    const select = document.createElement('select');
    select.append(new Option('Справа от вопроса', 'side'), new Option('По центру под вопросом', 'center'));
    select.value = slide.statisticsPlacement || 'side';
    select.addEventListener('change', () => { slide.statisticsPlacement = select.value; changed(); renderCanvas(); });
    setting.append(select); box.append(setting);
  }
  if (isQuestion(slide)) { const hint = document.createElement('p'); hint.textContent = 'Статистика видна на слайде сразу и обновляется по мере ответов. Изменения редактора попадут в новый показ; в уже запущенном показе положение меняется кнопкой в пульте ведущего.'; box.append(hint); }
  if (isQuestion(slide)) { const setting = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = slide.showPoints ?? ['quiz', 'multi-quiz', 'text'].includes(slide.type); input.addEventListener('change', () => { slide.showPoints = input.checked; changed(); }); setting.append(input, document.createTextNode(' Показывать баллы участнику на этом слайде')); box.append(setting); }
  if (isQuestion(slide) && slide.elements?.length) appendElementFields(box, slide);
  box.append(field('Заметки ведущего', 'note', 'textarea'));
}
function render() {
  renderList(); renderCanvas(); renderFields(); const question = isQuestion(current());
  $('slide-layout').disabled = !['cover', 'content', 'closing'].includes(current().type); if (!$('slide-layout').disabled) $('slide-layout').value = current().type;
  $('move-up').disabled = selected === 0; $('move-down').disabled = selected === material.slides.length - 1;
  $('delete-slide').disabled = material.slides.length === 1; $('duplicate-slide').disabled = material.slides.length >= 150;
  for (const id of ['add-text', 'add-shape']) $(id).disabled = isQuestion(current());
  for (const id of ['add-image', 'add-video', 'add-video-link']) $(id).disabled = false;
  $('layer-back').disabled = $('layer-front').disabled = selectedElement < 0 || !current().elements;
  $('undo-button').disabled = !undoStack.length; $('redo-button').disabled = !redoStack.length;
  $('question-up').disabled = !question || selected === 0; $('question-down').disabled = !question || selected === material.slides.length - 1;
  $('question-overview').replaceChildren(question ? node('h2', current().title) : node('p', 'В этом материале пока нет вопросов.'));
  for (const id of ['question-add-text', 'question-add-shape', 'question-add-image', 'question-add-video', 'question-add-video-link']) $(id).disabled = !question;
}
function startEditing() { $('login-panel').hidden = true; $('editor-panel').hidden = false; $('material-title').value = material.title; $('material-audience').value = material.audience || ''; $('material-description').value = material.description || ''; $('aspect-ratio').value = material.aspectRatio || '16:9'; $('page-heading').textContent = material.title; $('save-status').textContent = materialId ? `Сохранено · версия ${material.version}` : 'Новый материал'; lastSnapshot = JSON.stringify(material); render(); }
async function load() { if (materialId) material = (await api(`/aag/api/materials/${materialId}`)).material; templateImports = (await api('/aag/api/imports')).imports; startEditing(); }
async function save() {
  clearTimeout(saveTimer);
  if (saveBlocked) throw new Error('Правки не сохранены. Обновите страницу, чтобы загрузить новую версию материала.');
  if (savingPromise) return savingPromise;
  if (materialId && dirtyRevision === savedRevision) return material;
  savingPromise = (async () => {
    while (!materialId || dirtyRevision !== savedRevision) {
      const revision = dirtyRevision;
      const snapshot = structuredClone(material);
      $('save-status').textContent = 'Сохраняется…';
      try {
        const result = await api(materialId ? `/aag/api/materials/${materialId}` : '/aag/api/materials', materialId ? 'PUT' : 'POST', snapshot);
        materialId = result.material.id;
        material.version = result.material.version;
        lastSnapshot = JSON.stringify(material);
        history.replaceState({}, '', `?material=${materialId}`);
        savedRevision = revision;
        message('');
      } catch (issue) {
        if (/другой вкладке/.test(issue.message)) saveBlocked = true;
        $('save-status').textContent = 'Ошибка сохранения';
        throw issue;
      }
    }
    $('save-status').textContent = `Сохранено · версия ${material.version}`;
    return material;
  })();
  try { return await savingPromise; } finally { savingPromise = null; }
}
function applyHistory(source, destination) {
  if (!source.length) return;
  destination.push(JSON.stringify(material));
  const version = material.version;
  material = JSON.parse(source.pop());
  material.version = version;
  lastSnapshot = JSON.stringify(material);
  selected = Math.min(selected, material.slides.length - 1); selectedElement = -1;
  dirtyRevision++;
  $('material-title').value = material.title; $('material-audience').value = material.audience || ''; $('material-description').value = material.description || '';
  $('aspect-ratio').value = material.aspectRatio || '16:9';
  $('page-heading').textContent = material.title;
  $('save-status').textContent = 'Несохранённые изменения';
  clearTimeout(saveTimer);
  if (!saveBlocked) saveTimer = setTimeout(() => save().catch((issue) => message(issue.message)), 1200);
  render();
}
$('undo-button').addEventListener('click', () => applyHistory(undoStack, redoStack));
$('redo-button').addEventListener('click', () => applyHistory(redoStack, undoStack));
for (const id of ['material-title', 'material-audience', 'material-description']) $(id).addEventListener('input', (event) => { material[{ 'material-title': 'title', 'material-audience': 'audience', 'material-description': 'description' }[id]] = event.target.value; changed(); });
$('aspect-ratio').addEventListener('change', (event) => { material.aspectRatio = event.target.value; changed(); render(); });
$('slide-layout').addEventListener('change', (event) => { try { material.slides[selected] = window.editorSlideTools.setSlideLayout(current(), event.target.value); changed(); render(); } catch (issue) { message(issue.message); } });
$('presentation-tab').addEventListener('click', () => setTab('presentation'));
$('interactive-tab').addEventListener('click', () => setTab('interactive'));
document.querySelector('[data-add="content"]').addEventListener('click', () => { if (material.slides.length >= 150) return; material.slides.splice(selected + 1, 0, { type: 'content', title: 'Новый слайд', bullets: [] }); selected++; selectedElement = -1; changed(); render(); });
function makeQuestion(type) {
  const common = { type, title: 'Новый вопрос', timeSeconds: 30, showStatistics: ['poll', 'multi-quiz'].includes(type), showPoints: ['quiz', 'multi-quiz', 'text'].includes(type) };
  return type === 'quiz' ? { ...common, options: ['Вариант 1', 'Вариант 2'], correctIndex: 0, points: 100, speedBonusPercent: 0 } : type === 'multi-quiz' ? { ...common, options: ['Вариант 1', 'Вариант 2', 'Вариант 3'], correctIndices: [0, 2], points: 100, speedBonusPercent: 0 } : type === 'poll' ? { ...common, options: ['Да', 'Нет'] } : type === 'scale' ? { ...common, maxValue: 5 } : type === 'word-cloud' ? { ...common, title: 'Какие слова приходят вам на ум?', timeSeconds: 45 } : { ...common, points: 0 };
}
$('add-question').addEventListener('click', () => { if (material.slides.length >= 150) return message('В материале может быть не более 150 слайдов.'); const result = window.editorSlideTools.insertQuestion(material.slides, selected, lastPresentationSlide, makeQuestion($('question-type').value)); material.slides = result.slides; selected = result.index; selectedElement = -1; changed(); render(); });
function ensureElements() {
  const slide = current();
  if (slide.elements) return slide.elements;
  if (isQuestion(slide)) return (slide.elements = []);
  if (slide.type === 'imported') return (slide.elements = []);
  slide.elements = [{ id: crypto.randomUUID(), type: 'text', x: 8, y: 18, w: 84, h: 20, text: slide.title, color: '#ffffff', fontSize: 52, bold: true, align: 'left' }];
  if (slide.body) slide.elements.push({ id: crypto.randomUUID(), type: 'text', x: 8, y: 48, w: 84, h: 30, text: slide.body, color: '#ffffff', fontSize: 28, bold: false, align: 'left' });
  if (slide.bullets?.length) slide.elements.push({ id: crypto.randomUUID(), type: 'text', x: 8, y: 52, w: 84, h: 35, text: slide.bullets.map((value) => `• ${value}`).join('\n'), color: '#ffffff', fontSize: 28, bold: false, align: 'left' });
  const styles = [slide.textStyles?.title, ...(slide.body ? [slide.textStyles?.body] : []), ...(slide.bullets?.length ? [slide.textStyles?.options] : [])];
  slide.elements.forEach((element, index) => { if (styles[index]) Object.assign(element, styles[index], { fontSize: Math.min(72, styles[index].fontSize) }); });
  return slide.elements;
}
$('add-text').addEventListener('click', () => { const elements = ensureElements(); const element = window.editorSlideTools.createElement('text'); if (current().type === 'imported') element.color = '#17251c'; elements.push(element); selectedElement = elements.length - 1; changed(); render(); });
$('add-shape').addEventListener('click', () => { const elements = ensureElements(); elements.push(window.editorSlideTools.createElement('shape')); selectedElement = elements.length - 1; changed(); render(); });
$('question-add-text').addEventListener('click', () => { const elements = ensureElements(); if (elements.length >= 40) return message('На слайде может быть не более 40 элементов.'); elements.push(window.editorSlideTools.createElement('text')); selectedElement = elements.length - 1; changed(); render(); });
$('question-add-shape').addEventListener('click', () => { const elements = ensureElements(); if (elements.length >= 40) return message('На слайде может быть не более 40 элементов.'); elements.push(window.editorSlideTools.createElement('shape')); selectedElement = elements.length - 1; changed(); render(); });
async function uploadMedia(file, replacement = null) {
  const contentType = file.type || ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', mp4: 'video/mp4', webm: 'video/webm' }[file.name.split('.').pop().toLowerCase()]);
  const video = ['video/mp4', 'video/webm'].includes(contentType);
  if (!['image/png', 'image/jpeg', 'video/mp4', 'video/webm'].includes(contentType) || file.size > (video ? 100 : 10) * 1024 * 1024) throw new Error('Выберите PNG/JPEG до 10 МБ или MP4/WebM до 100 МБ.');
  if (replacement && replacement.type !== (video ? 'video' : 'image')) throw new Error('Выберите файл того же типа.');
  const targetSlide = current();
  if ((targetSlide.elements?.length || 0) >= 40 && !replacement) throw new Error('На слайде может быть не более 40 элементов.');
  message('Загружаем медиафайл…');
    const response = await fetch('/aag/api/assets', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': contentType, 'x-csrf-token': csrf }, body: file });
    const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Не удалось загрузить медиафайл.');
    if (targetSlide !== current()) throw new Error('Слайд изменился. Выберите файл ещё раз.');
    if (replacement) { replacement.assetId = result.asset.id; delete replacement.url; delete replacement.provider; }
    else {
    const elements = ensureElements();
    const element = window.editorSlideTools.createElement(video ? 'video' : 'image', result.asset.id);
    if (!video) {
      const localUrl = URL.createObjectURL(file);
      try { const image = new Image(); image.src = localUrl; await image.decode(); const ratio = image.naturalWidth / image.naturalHeight; const slideRatio = material.aspectRatio === '4:3' ? 4 / 3 : 16 / 9; element.h = element.w * slideRatio / ratio; if (element.h > 70) { element.h = 70; element.w = element.h * ratio / slideRatio; } element.w = Math.max(5, element.w); element.h = Math.max(5, element.h); element.x = (100 - element.w) / 2; element.y = (100 - element.h) / 2; } finally { URL.revokeObjectURL(localUrl); }
    }
    elements.push(element); selectedElement = elements.length - 1;
    }
    changed(); render(); message('Медиа добавлено. Выберите его на слайде, чтобы изменить размер, обрезку и положение.');
}
for (const id of ['add-image', 'add-video']) $(id).addEventListener('change', async (event) => { const input = event.currentTarget; try { if (input.files[0]) await uploadMedia(input.files[0]); } catch (issue) { message(issue.message); } finally { input.value = ''; } });
for (const id of ['question-add-image', 'question-add-video']) $(id).addEventListener('change', async (event) => { const input = event.currentTarget; try { if (input.files[0]) await uploadMedia(input.files[0]); } catch (issue) { message(issue.message); } finally { input.value = ''; } });
let videoLinkContext = null;
function addVideoLink(replacement = null) {
  videoLinkContext = { replacement, targetSlide: current() };
  $('video-link-url').value = replacement?.url || ''; $('video-link-error').textContent = '';
  $('video-link-dialog').showModal(); $('video-link-url').focus();
}
$('video-link-cancel').addEventListener('click', () => $('video-link-dialog').close());
$('video-link-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const { replacement, targetSlide } = videoLinkContext;
  const button = event.currentTarget.querySelector('[type=submit]'); button.disabled = true;
  try {
    const result = await api('/aag/api/assets/video-link', 'POST', { url: $('video-link-url').value });
    if (targetSlide !== current()) throw new Error('Слайд изменился. Повторите добавление видео.');
    if (replacement) { Object.assign(replacement, result.video); delete replacement.assetId; }
    else { const elements = ensureElements(); if (elements.length >= 40) throw new Error('На слайде может быть не более 40 элементов.'); const element = window.editorSlideTools.createElement('video'); delete element.assetId; Object.assign(element, result.video); elements.push(element); selectedElement = elements.length - 1; }
    changed(); render(); $('video-link-dialog').close(); message('Видео по ссылке добавлено.');
  } catch (issue) { $('video-link-error').textContent = issue.message; }
  finally { button.disabled = false; }
});
$('add-video-link').addEventListener('click', () => addVideoLink());
$('question-add-video-link').addEventListener('click', () => addVideoLink());
$('duplicate-slide').addEventListener('click', () => { if (material.slides.length >= 150) return; material.slides.splice(selected + 1, 0, window.editorSlideTools.duplicateSlide(current())); selected++; selectedElement = -1; changed(); render(); });
$('import-file').addEventListener('change', async (event) => {
  const input = event.currentTarget; const file = input.files?.[0]; if (!file) return;
  if (file.size > 50 * 1024 * 1024) { message('Файл больше 50 МБ.'); input.value = ''; return; }
  $('save-status').textContent = 'Обработка презентации…'; message('Преобразуем слайды. Это может занять некоторое время.');
  try {
    const type = file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    const response = await fetch('/aag/api/imports', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': type, 'x-file-name': encodeURIComponent(file.name), 'x-csrf-token': csrf }, body: file });
    const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Не удалось загрузить презентацию.');
    if (material.slides.length + result.imported.slideCount > 150) throw new Error('В материале может быть не более 150 слайдов.');
    selected = material.slides.length; selectedElement = -1; material.slides.push(...result.imported.slides); changed(); render();
    message(`Загружено ${result.imported.slideCount} слайдов. Проверьте внешний вид и сохраните материал.`);
  } catch (issue) { changed(); message(issue.message); } finally { input.value = ''; }
});
$('move-up').addEventListener('click', () => { if (selected > 0) { [material.slides[selected - 1], material.slides[selected]] = [material.slides[selected], material.slides[selected - 1]]; selected--; changed(); render(); } });
$('move-down').addEventListener('click', () => { if (selected < material.slides.length - 1) { [material.slides[selected + 1], material.slides[selected]] = [material.slides[selected], material.slides[selected + 1]]; selected++; changed(); render(); } });
for (const [id, direction] of [['layer-back', 'backward'], ['layer-front', 'forward']]) $(id).addEventListener('click', () => { const elements = current().elements; if (!elements || selectedElement < 0) return; const target = selectedElement + (direction === 'forward' ? 1 : -1); if (target < 0 || target >= elements.length) return; current().elements = window.editorSlideTools.moveElement(elements, selectedElement, direction); selectedElement = target; changed(); render(); });
$('question-up').addEventListener('click', () => { if (selected > 0) { [material.slides[selected - 1], material.slides[selected]] = [material.slides[selected], material.slides[selected - 1]]; selected--; changed(); render(); } });
$('question-down').addEventListener('click', () => { if (selected < material.slides.length - 1) { [material.slides[selected + 1], material.slides[selected]] = [material.slides[selected], material.slides[selected + 1]]; selected++; changed(); render(); } });
$('delete-slide').addEventListener('click', () => { if (material.slides.length > 1) { material.slides.splice(selected, 1); selected = Math.min(selected, material.slides.length - 1); selectedElement = -1; changed(); render(); } });
$('save-button').addEventListener('click', async () => { try { await save(); } catch (issue) { message(issue.message); } });
$('conduct-button').addEventListener('click', async () => { try { await save(); location.href = `./host.html?material=${materialId}`; } catch (issue) { message(issue.message); } });
$('login-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { const result = await api('/aag/api/auth/login', 'POST', Object.fromEntries(new FormData(form))); csrf = result.csrfToken; form.reset(); await load(); } catch (issue) { message(issue.message); } });
api('/aag/api/auth/me').then(async (result) => { csrf = result.csrfToken; await load(); }).catch(() => { $('login-panel').hidden = false; });
