import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeVideoUrl } from './video-sources.mjs';

const fail = (status, message) => { const issue = new Error(message); issue.status = status; throw issue; };
const fonts = ['Manrope', 'Arial', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New'];
const font = (value) => { if (!fonts.includes(value)) fail(400, 'Выберите шрифт из списка.'); return value; };
const cleanText = (value, limit, required = false) => {
  if (typeof value !== 'string') { if (required) fail(400, 'Заполните обязательные поля материала.'); return ''; }
  const text = value.trim();
  if ((required && !text) || text.length > limit) fail(400, `Текст должен содержать не более ${limit} символов.`);
  return text;
};
const boundedInt = (value, min, max, fallback) => {
  const number = value ?? fallback;
  if (!Number.isInteger(number) || number < min || number > max) fail(400, `Укажите целое число от ${min} до ${max}.`);
  return number;
};

export function validateMaterial(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Некорректный материал.');
  const title = cleanText(input.title, 150, true);
  const audience = cleanText(input.audience, 150);
  const description = cleanText(input.description, 1000);
  const aspectRatio = input.aspectRatio ?? '16:9';
  if (!['16:9', '4:3'].includes(aspectRatio)) fail(400, 'Некорректный формат слайдов.');
  if (!Array.isArray(input.slides) || input.slides.length < 1 || input.slides.length > 150) fail(400, 'Материал должен содержать от 1 до 150 слайдов.');
  const slides = input.slides.map((item) => {
    if (!item || typeof item !== 'object') fail(400, 'Некорректный слайд.');
    const type = item.type;
    if (!['cover', 'content', 'closing', 'quiz', 'multi-quiz', 'poll', 'scale', 'text', 'word-cloud', 'imported'].includes(type)) fail(400, 'Неизвестный тип слайда.');
    const slide = { type, eyebrow: cleanText(item.eyebrow, 100), title: cleanText(item.title, 200, true), body: cleanText(item.body, 1500), note: cleanText(item.note, 1500) };
    if (item.textStyles !== undefined) {
      if (!item.textStyles || typeof item.textStyles !== 'object' || Array.isArray(item.textStyles)) fail(400, 'Некорректное оформление текста.');
      slide.textStyles = {};
      for (const key of ['title', 'body', 'options']) {
        const style = item.textStyles[key];
        if (style === undefined) continue;
        if (!style || typeof style !== 'object' || Array.isArray(style)) fail(400, 'Некорректное оформление текста.');
        if (typeof style.bold !== 'boolean') fail(400, 'Некорректное начертание текста.');
        slide.textStyles[key] = { fontFamily: font(style.fontFamily), fontSize: boundedInt(style.fontSize, 12, 96, 32), bold: style.bold };
      }
    }
    const questionType = ['quiz', 'multi-quiz', 'poll', 'scale', 'text', 'word-cloud'].includes(type);
    if (item.textOffsetY !== undefined) {
      if (!questionType || !Number.isInteger(item.textOffsetY) || item.textOffsetY < -12 || item.textOffsetY > 12) fail(400, 'Некорректное положение текста на слайде.');
      slide.textOffsetY = item.textOffsetY;
    }
    if (item.template !== undefined) {
      const template = item.template;
      if (!questionType || !template || typeof template.importId !== 'string' || !/^[a-f0-9-]{36}$/.test(template.importId) || !Number.isInteger(template.page) || template.page < 1 || template.page > 100) fail(400, 'Некорректный шаблон интерактивного слайда.');
      slide.template = { importId: template.importId, page: template.page };
    }
    if (item.statisticsChart !== undefined) {
      if (!['quiz', 'multi-quiz', 'poll', 'scale'].includes(type) || !['bar', 'pie', 'column', 'horizontal'].includes(item.statisticsChart)) fail(400, 'Некорректный вид диаграммы.');
      slide.statisticsChart = item.statisticsChart;
    }
    if (item.statisticsPlacement !== undefined) {
      if (!['quiz', 'multi-quiz', 'poll', 'scale', 'text'].includes(type) || !['side', 'center'].includes(item.statisticsPlacement)) fail(400, 'Некорректное расположение статистики.');
      slide.statisticsPlacement = item.statisticsPlacement;
    }
    if (item.showStatistics !== undefined) {
      if (!questionType || typeof item.showStatistics !== 'boolean') fail(400, 'Некорректная настройка статистики.');
      slide.showStatistics = item.showStatistics;
    }
    if (item.showPoints !== undefined) {
      if (!questionType || typeof item.showPoints !== 'boolean') fail(400, 'Некорректная настройка баллов.');
      slide.showPoints = item.showPoints;
    }
    if ((['cover', 'content', 'closing'].includes(type) || questionType) && item.background !== undefined) {
      if (typeof item.background !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.background)) fail(400, 'Некорректный фон слайда.');
      slide.background = item.background;
    }
    if (type === 'imported') {
      if (typeof item.importId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.importId) || !Number.isInteger(item.page) || item.page < 1 || item.page > 100) fail(400, 'Некорректная ссылка на импортированный слайд.');
      slide.importId = item.importId;
      slide.page = item.page;
    }
    if (item.elements !== undefined) {
      if (!Array.isArray(item.elements) || item.elements.length > 40) fail(400, 'На слайде может быть не более 40 элементов.');
      slide.elements = item.elements.map((element) => {
        if (!element || !['text', 'shape', 'image', 'video'].includes(element.type)) fail(400, 'Недопустимый элемент слайда.');
        let id = {};
        if (element.id !== undefined) {
          if (typeof element.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(element.id)) fail(400, 'Некорректный идентификатор элемента.');
          id = { id: element.id };
        }
        const position = {};
        for (const key of ['x', 'y', 'w', 'h']) {
          const value = element[key];
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) fail(400, 'Элемент выходит за пределы слайда.');
          position[key] = value;
        }
        if (position.w < 5 || position.h < 5 || position.x + position.w > 100 || position.y + position.h > 100) fail(400, 'Проверьте размер и положение элемента.');
        if (['image', 'video'].includes(element.type)) {
          const media = { type: element.type, ...id, ...position, rotation: boundedInt(element.rotation, -180, 180, 0), fit: element.fit ?? 'contain', focalX: boundedInt(element.focalX, 0, 100, 50), focalY: boundedInt(element.focalY, 0, 100, 50), lockAspect: element.lockAspect ?? true };
          if (!['contain', 'cover'].includes(media.fit) || typeof media.lockAspect !== 'boolean') fail(400, 'Некорректные параметры медиа.');
          if (element.type === 'video' && element.url) Object.assign(media, normalizeVideoUrl(element.url));
          else { if (typeof element.assetId !== 'string' || !/^[a-f0-9-]{36}$/.test(element.assetId)) fail(400, 'Некорректная ссылка на медиафайл.'); media.assetId = element.assetId; }
          if (element.type === 'video') {
            for (const option of ['autoplay', 'muted', 'loop']) { if (element[option] !== undefined && typeof element[option] !== 'boolean') fail(400, 'Некорректные параметры видео.'); media[option] = element[option] ?? (option === 'muted'); }
            media.startTime = boundedInt(element.startTime, 0, 36000, 0);
          }
          return media;
        }
        const color = element.color ?? '#17251c';
        if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) fail(400, 'Некорректный цвет элемента.');
        if (element.type === 'shape') {
          const shape = element.shape ?? 'rectangle';
          if (!['rectangle', 'ellipse'].includes(shape)) fail(400, 'Некорректная фигура.');
          return { type: 'shape', ...id, ...position, color, ...(element.shape !== undefined ? { shape } : {}) };
        }
        const text = cleanText(element.text, 1000, true);
        if (element.italic !== undefined && typeof element.italic !== 'boolean') fail(400, 'Некорректный стиль текста.');
        if (element.bold !== undefined && typeof element.bold !== 'boolean') fail(400, 'Некорректный стиль текста.');
        if (element.align !== undefined && !['left', 'center', 'right'].includes(element.align)) fail(400, 'Некорректное выравнивание текста.');
        return { type: 'text', ...id, ...position, color, text, fontFamily: font(element.fontFamily ?? 'Manrope'), fontSize: boundedInt(element.fontSize, 12, 72, 28), bold: element.bold ?? false, ...(element.italic !== undefined ? { italic: element.italic } : {}), align: element.align ?? 'left' };
      });
    }
    if (['content', 'closing'].includes(type)) {
      if (!Array.isArray(item.bullets) || item.bullets.length > 10) fail(400, 'Укажите не более 10 пунктов.');
      slide.bullets = item.bullets.map((value) => cleanText(value, 300, true));
    }
    if (['quiz', 'multi-quiz', 'poll'].includes(type)) {
      if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 6) fail(400, 'В вопросе должно быть от 2 до 6 вариантов.');
      slide.options = item.options.map((value) => cleanText(value, 300, true));
      slide.timeSeconds = boundedInt(item.timeSeconds, 5, 300, 30);
    }
    if (type === 'quiz') slide.correctIndex = boundedInt(item.correctIndex, 0, slide.options.length - 1);
    if (type === 'multi-quiz') {
      if (!Array.isArray(item.correctIndices) || !item.correctIndices.length || item.correctIndices.length > slide.options.length || new Set(item.correctIndices).size !== item.correctIndices.length || item.correctIndices.some((index) => !Number.isInteger(index) || index < 0 || index >= slide.options.length)) fail(400, 'Укажите уникальные номера правильных вариантов.');
      slide.correctIndices = [...item.correctIndices].sort((a, b) => a - b);
    }
    if (['quiz', 'multi-quiz'].includes(type)) {
      slide.points = boundedInt(item.points, 0, 1000, 100);
      slide.speedBonusPercent = boundedInt(item.speedBonusPercent, 0, 50, 0);
    }
    if (type === 'scale') {
      if (![5, 10].includes(item.maxValue)) fail(400, 'Шкала должна быть от 1 до 5 или от 1 до 10.');
      slide.maxValue = item.maxValue;
    }
    if (['word-cloud', 'scale', 'text'].includes(type)) slide.timeSeconds = boundedInt(item.timeSeconds, 5, 300, type === 'word-cloud' ? 45 : 30);
    if (type === 'text') slide.points = boundedInt(item.points, 0, 1000, 0);
    return slide;
  });
  return { title, audience, description, aspectRatio, slides };
}

export function createMaterialStore(path, sample) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS materials (id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL, title TEXT NOT NULL, content_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);`);
  const template = db.prepare('SELECT id FROM materials WHERE owner_id=0 AND deleted_at IS NULL LIMIT 1').get();
  if (!template) {
    const validated = validateMaterial(sample);
    const time = new Date().toISOString();
    db.prepare('INSERT INTO materials(owner_id,title,content_json,created_at,updated_at) VALUES(0,?,?,?,?)').run(validated.title, JSON.stringify(validated), time, time);
  }
  const rowToMaterial = (row) => ({ id: row.id, ownerId: row.owner_id, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, ...JSON.parse(row.content_json) });
  const getRow = (id, actorId) => {
    const row = db.prepare('SELECT * FROM materials WHERE id=? AND deleted_at IS NULL').get(id);
    if (!row || (row.owner_id !== 0 && row.owner_id !== actorId)) fail(404, 'Материал не найден.');
    return row;
  };
  return {
    close: () => db.close(),
    listForOwner(ownerId, archived = false) {
      if (!Number.isInteger(ownerId) || ownerId < 1) fail(400, 'Некорректный владелец материала.');
      const rows = db.prepare(`SELECT * FROM materials WHERE owner_id=? AND deleted_at IS ${archived ? 'NOT ' : ''}NULL ORDER BY updated_at DESC,id DESC`).all(ownerId);
      return rows.map((row) => { const parsed = JSON.parse(row.content_json); return { id: row.id, ownerId, title: row.title, slideCount: parsed.slides.length, version: row.version, updatedAt: row.updated_at, deletedAt: row.deleted_at }; });
    },
    adminRemove(id, ownerId) {
      const row = db.prepare('SELECT id FROM materials WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(id, ownerId);
      if (!row || ownerId < 1) fail(404, 'Материал пользователя не найден.');
      db.prepare('UPDATE materials SET deleted_at=? WHERE id=?').run(new Date().toISOString(), id);
      return { id, deleted: true };
    },
    adminRestore(id, ownerId) {
      const row = db.prepare('SELECT id FROM materials WHERE id=? AND owner_id=? AND deleted_at IS NOT NULL').get(id, ownerId);
      if (!row || ownerId < 1) fail(404, 'Архивный материал пользователя не найден.');
      db.prepare('UPDATE materials SET deleted_at=NULL WHERE id=?').run(id);
      return { id, restored: true };
    },
    list(actorId, archived = false) {
      const rows = archived
        ? db.prepare('SELECT * FROM materials WHERE deleted_at IS NOT NULL AND owner_id=? ORDER BY deleted_at DESC').all(actorId)
        : db.prepare('SELECT * FROM materials WHERE deleted_at IS NULL AND (owner_id=0 OR owner_id=?) ORDER BY owner_id ASC, updated_at DESC, id DESC').all(actorId);
      return rows.map((row) => {
        const parsed = JSON.parse(row.content_json);
        return { id: row.id, ownerId: row.owner_id, title: row.title, slideCount: parsed.slides.length, version: row.version, updatedAt: row.updated_at, deletedAt: row.deleted_at, isTemplate: row.owner_id === 0 };
      });
    },
    get(id, actorId) { return rowToMaterial(getRow(id, actorId)); },
    create(input, actorId) {
      const content = validateMaterial(input);
      const time = new Date().toISOString();
      const id = Number(db.prepare('INSERT INTO materials(owner_id,title,content_json,created_at,updated_at) VALUES(?,?,?,?,?)').run(actorId, content.title, JSON.stringify(content), time, time).lastInsertRowid);
      return this.get(id, actorId);
    },
    update(id, input, actorId) {
      const row = getRow(id, actorId);
      if (row.owner_id === 0) fail(403, 'Образец нельзя изменять. Создайте свою копию.');
      if (input.version !== undefined && input.version !== row.version) fail(409, 'Материал изменён в другой вкладке. Обновите страницу перед сохранением.');
      const content = validateMaterial(input);
      db.prepare('UPDATE materials SET title=?,content_json=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(content.title, JSON.stringify(content), new Date().toISOString(), id, row.version);
      return this.get(id, actorId);
    },
    remove(id, actorId) {
      const row = getRow(id, actorId);
      if (row.owner_id === 0) fail(403, 'Образец нельзя удалить.');
      db.prepare('UPDATE materials SET deleted_at=? WHERE id=?').run(new Date().toISOString(), id);
      return { id, deleted: true };
    },
    restore(id, actorId) {
      const row = db.prepare('SELECT * FROM materials WHERE id=? AND owner_id=? AND deleted_at IS NOT NULL').get(id, actorId);
      if (!row) fail(404, 'Удалённый материал не найден.');
      db.prepare('UPDATE materials SET deleted_at=NULL WHERE id=?').run(id);
      return this.get(id, actorId);
    },
  };
}
