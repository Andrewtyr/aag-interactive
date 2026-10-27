import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { withWelcomeSlide } from './session-material.mjs';

const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const fail = (status, message) => { const issue = new Error(message); issue.status = status; throw issue; };
const normalize = (value) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');

export function createLiveStore(path, material, now = () => Date.now(), { maxParticipants = 5000, bannedWordsPath = process.env.AAG_WORD_BLOCKLIST_PATH ?? resolve(dirname(path), 'word-cloud-blocklist.txt') } = {}) {
  mkdirSync(dirname(bannedWordsPath), { recursive: true });
  if (!existsSync(bannedWordsPath)) copyFileSync(resolve(import.meta.dirname, '../config/word-cloud-blocklist.txt'), bannedWordsPath);
  let bannedCache = { mtimeMs: -1, ctimeMs: -1, size: -1, words: new Set() };
  const wordTokens = (value) => (value.normalize('NFKD').replace(/[\p{M}\p{Default_Ignorable_Code_Point}]/gu, '').toLocaleLowerCase('ru-RU').match(/[\p{L}\p{N}]+/gu) ?? []).join(' ');
  const bannedWords = () => {
    const info = statSync(bannedWordsPath);
    if (info.size > 65_536) fail(500, 'Список запрещённых слов слишком большой.');
    if (info.mtimeMs !== bannedCache.mtimeMs || info.ctimeMs !== bannedCache.ctimeMs || info.size !== bannedCache.size) {
      const words = new Set(readFileSync(bannedWordsPath, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map(wordTokens).filter(Boolean));
      bannedCache = { mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, size: info.size, words };
    }
    return bannedCache.words;
  };
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS live_events (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, host_id INTEGER NOT NULL, slide_index INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS live_participants (id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES live_events(id), name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS live_questions (event_id INTEGER NOT NULL REFERENCES live_events(id), slide_index INTEGER NOT NULL, opened_at INTEGER NOT NULL, deadline INTEGER NOT NULL, closed_at INTEGER, published INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(event_id,slide_index));
    CREATE TABLE IF NOT EXISTS live_statistics_visibility (event_id INTEGER NOT NULL REFERENCES live_events(id), slide_index INTEGER NOT NULL, visible INTEGER NOT NULL, PRIMARY KEY(event_id,slide_index));
    CREATE TABLE IF NOT EXISTS live_statistics_placement (event_id INTEGER NOT NULL REFERENCES live_events(id), slide_index INTEGER NOT NULL, placement TEXT NOT NULL, PRIMARY KEY(event_id,slide_index));
    CREATE TABLE IF NOT EXISTS live_responses (id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES live_events(id), slide_index INTEGER NOT NULL, participant_id INTEGER NOT NULL REFERENCES live_participants(id), answer TEXT NOT NULL, normalized TEXT, points INTEGER NOT NULL DEFAULT 0, submitted_at INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, UNIQUE(event_id,slide_index,participant_id));
    CREATE INDEX IF NOT EXISTS live_participants_event_idx ON live_participants(event_id);
    CREATE INDEX IF NOT EXISTS live_responses_participant_idx ON live_responses(participant_id);
    CREATE INDEX IF NOT EXISTS live_events_host_created_idx ON live_events(host_id,created_at);`);
  if (!db.prepare('PRAGMA table_info(live_events)').all().some((column) => column.name === 'material_json')) db.exec('ALTER TABLE live_events ADD COLUMN material_json TEXT');
  if (!db.prepare('PRAGMA table_info(live_events)').all().some((column) => column.name === 'paused_at')) db.exec('ALTER TABLE live_events ADD COLUMN paused_at INTEGER');
  for (const [name, definition] of [['user_id', 'INTEGER'], ['revoked_at', 'INTEGER']]) if (!db.prepare('PRAGMA table_info(live_participants)').all().some((column) => column.name === name)) db.exec(`ALTER TABLE live_participants ADD COLUMN ${name} ${definition}`);
  if (!db.prepare('PRAGMA table_info(live_responses)').all().some((column) => column.name === 'graded_at')) db.exec('ALTER TABLE live_responses ADD COLUMN graded_at INTEGER');
  if (!db.prepare('PRAGMA table_info(live_questions)').all().some((column) => column.name === 'statistics_visible')) db.exec('ALTER TABLE live_questions ADD COLUMN statistics_visible INTEGER NOT NULL DEFAULT 0');
  for (const [name, definition] of [
    ['format', "TEXT NOT NULL DEFAULT 'lesson'"], ['title', 'TEXT'], ['category', 'TEXT'],
    ['rating_enabled', 'INTEGER NOT NULL DEFAULT 0'], ['leaderboard_published', 'INTEGER NOT NULL DEFAULT 0'],
    ['joins_open', 'INTEGER NOT NULL DEFAULT 1'],
  ]) if (!db.prepare('PRAGMA table_info(live_events)').all().some((column) => column.name === name)) db.exec(`ALTER TABLE live_events ADD COLUMN ${name} ${definition}`);
  const materialCache = new Map();
  const materialFor = (row) => {
    if (!row.material_json) return material;
    let parsed = materialCache.get(row.id);
    if (!parsed) {
      parsed = JSON.parse(row.material_json);
      if (materialCache.size >= 200) materialCache.delete(materialCache.keys().next().value);
      materialCache.set(row.id, parsed);
    }
    return parsed;
  };
  const event = (id) => { const row = db.prepare('SELECT * FROM live_events WHERE id=?').get(id); if (!row) fail(404, 'Сессия не найдена.'); return row; };
  const hostEvent = (id, hostId) => { const row = event(id); if (row.host_id !== hostId) fail(403, 'Нет доступа к сессии.'); return row; };
  const participant = (id, token) => {
    if (!token) fail(401, 'Участник не подключён.');
    const row = db.prepare('SELECT * FROM live_participants WHERE event_id=? AND token_hash=?').get(id, tokenHash(token));
    if (!row || row.revoked_at) fail(401, 'Участник не подключён.'); return row;
  };
  const question = (id, index) => db.prepare('SELECT * FROM live_questions WHERE event_id=? AND slide_index=?').get(id, index);
  const statisticsVisible = (id, index, q = question(id, index)) => {
    if (q) return !!q.statistics_visible;
    return !!(db.prepare('SELECT visible FROM live_statistics_visibility WHERE event_id=? AND slide_index=?').get(id, index)?.visible ?? 1);
  };
  const statisticsPlacement = (id, index, slide) => db.prepare('SELECT placement FROM live_statistics_placement WHERE event_id=? AND slide_index=?').get(id, index)?.placement ?? slide.statisticsPlacement;
  const publicEvent = (row) => ({ id: row.id, code: row.code, slideIndex: row.slide_index, status: row.status, pausedAt: row.paused_at, materialTitle: materialFor(row).title, title: row.title || materialFor(row).title, format: row.format, category: row.category || '', ratingEnabled: !!row.rating_enabled, leaderboardPublished: !!row.leaderboard_published, joinsOpen: !!row.joins_open });
  const cloud = (id, index) => db.prepare('SELECT normalized AS text, count(*) AS count FROM live_responses WHERE event_id=? AND slide_index=? AND hidden=0 GROUP BY normalized ORDER BY count DESC, normalized').all(id, index);
  const statisticsFor = (id, index, slide) => {
    const values = db.prepare('SELECT answer FROM live_responses WHERE event_id=? AND slide_index=?').all(id, index);
    const counts = ['quiz', 'multi-quiz', 'poll'].includes(slide.type) ? Array(slide.options.length).fill(0) : slide.type === 'scale' ? Array(slide.maxValue).fill(0) : [];
    for (const { answer } of values) {
      if (slide.type === 'multi-quiz') for (const choice of JSON.parse(answer)) counts[choice]++;
      else if (['quiz', 'poll'].includes(slide.type)) counts[Number(answer)]++;
      else if (slide.type === 'scale') counts[Number(answer) - 1]++;
    }
    return { total: values.length, counts };
  };
  const requireActive = (row) => { if (row.status !== 'active') fail(409, row.status === 'paused' ? 'Сессия приостановлена.' : 'Сессия завершена.'); };
  const leaderboardFor = (id, limit = 10) => {
    const rows = db.prepare('SELECT p.name,coalesce(sum(r.points),0) AS points FROM live_participants p LEFT JOIN live_responses r ON r.participant_id=p.id WHERE p.event_id=? GROUP BY p.id ORDER BY points DESC,p.id LIMIT ?').all(id, limit);
    let previous = null; let place = 0;
    return rows.map((item, index) => { if (item.points !== previous) place = index + 1; previous = item.points; return { ...item, place }; });
  };
  return {
    close: () => db.close(),
    start(hostId, selectedMaterial = material, options = {}) {
      const format = options.format ?? 'lesson';
      if (!['lesson', 'event'].includes(format)) fail(400, 'Выберите формат занятия или мероприятия.');
      const title = String(options.title ?? selectedMaterial.title).trim();
      const category = String(options.category ?? '').trim();
      if (!title || title.length > 150 || category.length > 100) fail(400, 'Проверьте название и категорию мероприятия.');
      if (options.ratingEnabled !== undefined && typeof options.ratingEnabled !== 'boolean') fail(400, 'Некорректная настройка рейтинга.');
      if (options.welcomeScreen) selectedMaterial = withWelcomeSlide(selectedMaterial, title);
      for (let attempt = 0; attempt < 20; attempt++) {
        const code = String(randomInt(100000, 1000000));
        if (db.prepare("SELECT id FROM live_events WHERE code=? AND status='active'").get(code)) continue;
        try {
          const id = Number(db.prepare('INSERT INTO live_events(code,host_id,created_at,material_json,format,title,category,rating_enabled) VALUES(?,?,?,?,?,?,?,?)').run(code, hostId, now(), JSON.stringify(selectedMaterial), format, title, category, options.ratingEnabled ? 1 : 0).lastInsertRowid);
          return publicEvent(event(id));
        } catch (issue) { if (issue.code !== 'ERR_SQLITE_CONSTRAINT_UNIQUE') throw issue; }
      }
      fail(503, 'Не удалось создать код подключения.');
    },
    join(code, name, user = null) {
      name = String(user?.displayName ?? name ?? '').trim().replace(/\s+/g, ' ');
      if (!name || name.length > 40) fail(400, 'Укажите имя до 40 символов.');
      const row = db.prepare("SELECT * FROM live_events WHERE code=? AND status IN ('active','paused') AND joins_open=1").get(String(code ?? '').replace(/\s/g, ''));
      if (!row) fail(404, 'Активная сессия с таким кодом не найдена.');
      if (user?.id && db.prepare('SELECT id FROM live_participants WHERE event_id=? AND user_id=? AND revoked_at IS NULL').get(row.id, user.id)) fail(409, 'Вы уже подключены к этому мероприятию. Вернитесь в прежнюю вкладку.');
      const token = randomBytes(32).toString('hex');
      const added = db.prepare(`INSERT INTO live_participants(event_id,name,token_hash,created_at,user_id)
        SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM live_participants WHERE event_id=?) < ?`).run(row.id, name, tokenHash(token), now(), user?.id ?? null, row.id, maxParticipants);
      if (!added.changes) fail(429, 'В этом мероприятии достигнут лимит участников.');
      const id = Number(added.lastInsertRowid);
      return { event: publicEvent(row), participant: { id, name, guest: !user }, participantToken: token };
    },
    setSlide(id, hostId, index) {
      const row = hostEvent(id, hostId); requireActive(row);
      if (!Number.isInteger(index) || index < 0 || index >= materialFor(row).slides.length) fail(400, 'Неверный номер слайда.');
      db.prepare('UPDATE live_questions SET closed_at=? WHERE event_id=? AND slide_index=? AND closed_at IS NULL').run(now(), id, row.slide_index);
      db.prepare('UPDATE live_events SET slide_index=? WHERE id=?').run(index, id);
      return this.getHost(id, hostId);
    },
    open(id, hostId) {
      const row = hostEvent(id, hostId); requireActive(row);
      const slide = materialFor(row).slides[row.slide_index];
      if (!['quiz', 'multi-quiz', 'poll', 'scale', 'text', 'word-cloud'].includes(slide.type)) fail(409, 'На этом слайде нет вопроса.');
      if (question(id, row.slide_index)) fail(409, 'Вопрос уже открывался в этом запуске.');
      const duration = slide.timeSeconds ?? 30;
      db.prepare('INSERT INTO live_questions(event_id,slide_index,opened_at,deadline,statistics_visible) VALUES(?,?,?,?,?)').run(id, row.slide_index, now(), now() + duration * 1000, statisticsVisible(id, row.slide_index) ? 1 : 0);
      return this.getHost(id, hostId);
    },
    setStatisticsVisibility(id, hostId, show) {
      const row = hostEvent(id, hostId);
      if (row.status === 'ended') fail(409, 'Сессия завершена.');
      if (typeof show !== 'boolean') fail(400, 'Укажите, показывать ли статистику.');
      const slide = materialFor(row).slides[row.slide_index];
      if (!['quiz', 'multi-quiz', 'poll', 'scale', 'text'].includes(slide.type)) fail(409, 'На этом слайде нет статистики ответов.');
      db.prepare('INSERT INTO live_statistics_visibility(event_id,slide_index,visible) VALUES(?,?,?) ON CONFLICT(event_id,slide_index) DO UPDATE SET visible=excluded.visible').run(id, row.slide_index, show ? 1 : 0);
      db.prepare('UPDATE live_questions SET statistics_visible=? WHERE event_id=? AND slide_index=?').run(show ? 1 : 0, id, row.slide_index);
      return this.getHost(id, hostId);
    },
    setStatisticsPlacement(id, hostId, placement) {
      const row = hostEvent(id, hostId);
      if (row.status === 'ended') fail(409, 'Сессия завершена.');
      if (!['side', 'center'].includes(placement)) fail(400, 'Выберите положение статистики.');
      const slide = materialFor(row).slides[row.slide_index];
      if (!['quiz', 'multi-quiz', 'poll', 'scale', 'text'].includes(slide.type)) fail(409, 'На этом слайде нет статистики ответов.');
      db.prepare('INSERT INTO live_statistics_placement(event_id,slide_index,placement) VALUES(?,?,?) ON CONFLICT(event_id,slide_index) DO UPDATE SET placement=excluded.placement').run(id, row.slide_index, placement);
      return this.getHost(id, hostId);
    },
    closeQuestion(id, hostId) {
      const row = hostEvent(id, hostId); requireActive(row);
      const q = question(id, row.slide_index);
      if (!q || q.closed_at) fail(409, 'Нет открытого вопроса.');
      db.prepare('UPDATE live_questions SET closed_at=? WHERE event_id=? AND slide_index=?').run(now(), id, row.slide_index);
      return this.getHost(id, hostId);
    },
    pause(id, hostId) {
      const row = hostEvent(id, hostId); requireActive(row);
      const instant = now();
      db.prepare('UPDATE live_questions SET closed_at=deadline WHERE event_id=? AND slide_index=? AND closed_at IS NULL AND deadline<=?').run(id, row.slide_index, instant);
      db.prepare("UPDATE live_events SET status='paused',paused_at=? WHERE id=?").run(instant, id);
      return this.getHost(id, hostId);
    },
    resume(id, hostId) {
      const row = hostEvent(id, hostId);
      if (row.status !== 'paused') fail(409, 'Сессия не приостановлена.');
      const elapsed = Math.max(0, now() - row.paused_at);
      db.prepare('UPDATE live_questions SET deadline=deadline+? WHERE event_id=? AND slide_index=? AND closed_at IS NULL AND deadline>?').run(elapsed, id, row.slide_index, row.paused_at);
      db.prepare("UPDATE live_events SET status='active',paused_at=NULL WHERE id=?").run(id);
      return this.getHost(id, hostId);
    },
    setJoins(id, hostId, open) {
      const row = hostEvent(id, hostId);
      if (row.status === 'ended') fail(409, 'Сессия завершена.');
      if (typeof open !== 'boolean') fail(400, 'Некорректная настройка входа.');
      db.prepare('UPDATE live_events SET joins_open=? WHERE id=?').run(open ? 1 : 0, id);
      return this.getHost(id, hostId);
    },
    publishLeaderboard(id, hostId) {
      const row = hostEvent(id, hostId);
      if (!row.rating_enabled) fail(409, 'Рейтинг выключен для этой сессии.');
      db.prepare('UPDATE live_events SET leaderboard_published=1 WHERE id=?').run(id);
      return this.getHost(id, hostId);
    },
    publish(id, hostId) {
      const row = hostEvent(id, hostId); requireActive(row);
      const q = question(id, row.slide_index);
      if (materialFor(row).slides[row.slide_index].type !== 'word-cloud' || !q || (!q.closed_at && q.deadline > now())) fail(409, 'Сначала закройте облако слов.');
      db.prepare('UPDATE live_questions SET published=1 WHERE event_id=? AND slide_index=?').run(id, row.slide_index);
      return this.getHost(id, hostId);
    },
    hideAnswer(id, hostId, answerId) {
      const row = hostEvent(id, hostId); requireActive(row);
      const q = question(id, row.slide_index);
      if (materialFor(row).slides[row.slide_index].type !== 'word-cloud' || !q || q.published) fail(409, 'Модерация этого облака недоступна.');
      const changed = db.prepare('UPDATE live_responses SET hidden=1 WHERE id=? AND event_id=? AND slide_index=?').run(answerId, id, row.slide_index);
      if (!changed.changes) fail(404, 'Ответ не найден.');
      return this.getHost(id, hostId);
    },
    gradeAnswer(id, hostId, answerId, points) {
      const row = hostEvent(id, hostId);
      const answer = db.prepare('SELECT * FROM live_responses WHERE id=? AND event_id=?').get(answerId, id);
      if (!answer) fail(404, 'Ответ не найден.');
      const slide = materialFor(row).slides[answer.slide_index];
      if (slide?.type !== 'text' || !slide.points) fail(409, 'Этот ответ не требует ручной оценки.');
      if (!Number.isInteger(points) || points < 0 || points > slide.points) fail(400, `Укажите баллы от 0 до ${slide.points}.`);
      db.prepare('UPDATE live_responses SET points=?,graded_at=? WHERE id=?').run(points, now(), answerId);
      return this.getHost(id, hostId);
    },
    end(id, hostId) {
      const row = hostEvent(id, hostId);
      if (row.status === 'ended') fail(409, 'Сессия завершена.');
      db.prepare('UPDATE live_questions SET closed_at=? WHERE event_id=? AND closed_at IS NULL').run(now(), id);
      db.prepare("UPDATE live_events SET status='ended' WHERE id=?").run(id);
      return this.getHost(id, hostId);
    },
    activeEvents() {
      return db.prepare("SELECT e.id,e.code,e.title,e.format,e.created_at,e.status,u.display_name AS host_name,count(p.id) AS participant_count FROM live_events e JOIN users u ON u.id=e.host_id LEFT JOIN live_participants p ON p.event_id=e.id WHERE e.status IN ('active','paused') GROUP BY e.id ORDER BY e.created_at DESC").all();
    },
    forceEnd(id, reason) {
      if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 300) fail(400, 'Укажите причину от 5 до 300 символов.');
      const row = event(id);
      if (row.status === 'ended') fail(409, 'Сессия уже завершена.');
      db.prepare('UPDATE live_questions SET closed_at=? WHERE event_id=? AND closed_at IS NULL').run(now(), id);
      db.prepare("UPDATE live_events SET status='ended',joins_open=0 WHERE id=?").run(id);
      return { id, ended: true, reason: reason.trim() };
    },
    respond(id, token, answer, expectedIndex) {
      const row = event(id);
      const person = participant(id, token);
      const index = expectedIndex ?? row.slide_index;
      if (!Number.isInteger(index) || index < 0) fail(400, 'Неверный номер слайда.');
      const previous = db.prepare('SELECT points FROM live_responses WHERE event_id=? AND slide_index=? AND participant_id=?').get(id, index, person.id);
      if (previous) return { accepted: true, repeated: true };
      requireActive(row);
      if (index !== row.slide_index) fail(409, 'Ведущий уже переключил слайд.');
      const slide = materialFor(row).slides[index];
      const q = question(id, index);
      if (!q || q.closed_at || q.deadline <= now()) fail(409, 'Время ответа истекло или вопрос закрыт.');
      let storedAnswer, normalized = null, points = 0;
      if (slide.type === 'quiz' || slide.type === 'poll') {
        if (!Number.isInteger(answer) || answer < 0 || answer >= slide.options.length) fail(400, 'Выберите вариант ответа.');
        storedAnswer = String(answer);
        if (slide.type === 'quiz' && answer === slide.correctIndex) points = slide.points + Math.round(slide.points * (slide.speedBonusPercent ?? 0) / 100 * (q.deadline - now()) / ((slide.timeSeconds ?? 30) * 1000));
      } else if (slide.type === 'multi-quiz') {
        if (!Array.isArray(answer) || !answer.length || answer.length > slide.options.length || new Set(answer).size !== answer.length || answer.some((index) => !Number.isInteger(index) || index < 0 || index >= slide.options.length)) fail(400, 'Выберите один или несколько вариантов.');
        const chosen = [...answer].sort((a, b) => a - b);
        storedAnswer = JSON.stringify(chosen);
        if (JSON.stringify(chosen) === JSON.stringify([...slide.correctIndices].sort((a, b) => a - b))) points = slide.points + Math.round(slide.points * (slide.speedBonusPercent ?? 0) / 100 * (q.deadline - now()) / ((slide.timeSeconds ?? 30) * 1000));
      } else if (slide.type === 'scale') {
        if (!Number.isInteger(answer) || answer < 1 || answer > slide.maxValue) fail(400, 'Выберите значение шкалы.');
        storedAnswer = String(answer);
      } else if (slide.type === 'text') {
        if (typeof answer !== 'string' || !answer.trim() || answer.trim().length > 1000) fail(400, 'Введите ответ до 1000 символов.');
        storedAnswer = answer.trim();
      } else if (slide.type === 'word-cloud') {
        if (typeof answer !== 'string') fail(400, 'Введите короткий ответ.');
        normalized = normalize(answer);
        if (!normalized || normalized.length > 50 || normalized.split(' ').length > 3) fail(400, 'Введите от 1 до 3 слов, до 50 символов.');
        const tokens = ` ${wordTokens(normalized)} `;
        if ([...bannedWords()].some((entry) => tokens.includes(` ${entry} `))) fail(400, 'Это слово или выражение запрещено для облака.');
        storedAnswer = answer.trim();
      } else fail(409, 'На этом слайде нет вопроса.');
      db.prepare('INSERT INTO live_responses(event_id,slide_index,participant_id,answer,normalized,points,submitted_at) VALUES(?,?,?,?,?,?,?)').run(id, index, person.id, storedAnswer, normalized, points, now());
      return { accepted: true };
    },
    getHost(id, hostId) {
      const row = hostEvent(id, hostId);
      const eventMaterial = materialFor(row);
      const slide = eventMaterial.slides[row.slide_index];
      const q = question(id, row.slide_index);
      const answers = db.prepare('SELECT r.id,p.name,r.answer,r.normalized,r.points,r.hidden,r.graded_at FROM live_responses r JOIN live_participants p ON p.id=r.participant_id WHERE r.event_id=? AND r.slide_index=? ORDER BY r.id').all(id, row.slide_index);
      const leaderboard = row.rating_enabled ? leaderboardFor(id) : [];
      return { event: publicEvent(row), sessionStartedAt: row.created_at, slide, nextSlide: eventMaterial.slides[row.slide_index + 1] ?? null, aspectRatio: eventMaterial.aspectRatio || '16:9', question: q && { openedAt: q.opened_at, deadline: q.deadline, closed: !!q.closed_at || q.deadline <= (row.paused_at ?? now()), published: !!q.published }, statisticsVisible: statisticsVisible(id, row.slide_index, q), statisticsPlacement: statisticsPlacement(id, row.slide_index, slide), answers, wordCloud: slide.type === 'word-cloud' ? cloud(id, row.slide_index) : [], participantCount: db.prepare('SELECT count(*) AS n FROM live_participants WHERE event_id=?').get(id).n, leaderboard, slideCount: eventMaterial.slides.length };
    },
    getProjector(id, hostId) {
      const row = hostEvent(id, hostId);
      const eventMaterial = materialFor(row);
      const { correctIndex, correctIndices, note, ...slide } = eventMaterial.slides[row.slide_index];
      const q = question(id, row.slide_index);
      return { event: publicEvent(row), slide: { ...slide, statisticsPlacement: statisticsPlacement(id, row.slide_index, slide) }, aspectRatio: eventMaterial.aspectRatio || '16:9', slideCount: eventMaterial.slides.length, participantCount: db.prepare('SELECT count(*) AS n FROM live_participants WHERE event_id=?').get(id).n, answerCount: q ? db.prepare('SELECT count(*) AS n FROM live_responses WHERE event_id=? AND slide_index=?').get(id, row.slide_index).n : 0, question: q && { deadline: q.deadline, closed: !!q.closed_at || q.deadline <= (row.paused_at ?? now()) }, statistics: statisticsVisible(id, row.slide_index, q) && ['quiz', 'multi-quiz', 'poll', 'scale', 'text'].includes(slide.type) ? statisticsFor(id, row.slide_index, slide) : null, wordCloud: slide.type === 'word-cloud' && q ? cloud(id, row.slide_index) : [], leaderboard: row.rating_enabled && row.leaderboard_published ? leaderboardFor(id, 5) : [] };
    },
    getParticipant(id, token) {
      const row = event(id); const person = participant(id, token);
      const eventMaterial = materialFor(row);
      const slide = eventMaterial.slides[row.slide_index];
      const { correctIndex, correctIndices, note, ...publicSlide } = slide;
      const q = question(id, row.slide_index);
      const own = db.prepare('SELECT points FROM live_responses WHERE event_id=? AND slide_index=? AND participant_id=?').get(id, row.slide_index, person.id);
      const total = db.prepare(`SELECT coalesce(sum(CASE WHEN q.closed_at IS NOT NULL OR q.deadline <= ? THEN r.points ELSE 0 END),0) AS points
        FROM live_responses r LEFT JOIN live_questions q ON q.event_id=r.event_id AND q.slide_index=r.slide_index
        WHERE r.participant_id=?`).get(row.paused_at ?? now(), person.id).points;
      return { event: publicEvent(row), slide: publicSlide, aspectRatio: eventMaterial.aspectRatio || '16:9', slideIndex: row.slide_index, slideCount: eventMaterial.slides.length, participant: { id: person.id, name: person.name, guest: !person.user_id }, question: q && { deadline: q.deadline, closed: !!q.closed_at || q.deadline <= (row.paused_at ?? now()), published: !!q.published }, answered: !!own, totalPoints: total, wordCloud: slide.type === 'word-cloud' && q?.published ? cloud(id, row.slide_index) : [] };
    },
    listReports(hostId) {
      return db.prepare('SELECT e.*,count(p.id) AS participant_count FROM live_events e LEFT JOIN live_participants p ON p.event_id=e.id WHERE e.host_id=? GROUP BY e.id ORDER BY e.created_at DESC').all(hostId).map((row) => ({ ...publicEvent(row), createdAt: row.created_at, participantCount: row.participant_count }));
    },
    getReport(id, hostId) {
      const row = hostEvent(id, hostId);
      const eventMaterial = materialFor(row);
      const participants = db.prepare('SELECT p.id,p.name,coalesce(sum(r.points),0) AS totalPoints FROM live_participants p LEFT JOIN live_responses r ON r.participant_id=p.id WHERE p.event_id=? GROUP BY p.id ORDER BY totalPoints DESC,p.id').all(id);
      if (row.rating_enabled) { let previous = null; let place = 0; participants.forEach((person, index) => { if (person.totalPoints !== previous) place = index + 1; previous = person.totalPoints; person.place = place; }); }
      const responses = db.prepare('SELECT r.slide_index,r.answer,r.normalized,r.points,r.submitted_at,r.hidden,r.graded_at,p.id AS participant_id,p.name FROM live_responses r JOIN live_participants p ON p.id=r.participant_id WHERE r.event_id=? ORDER BY r.slide_index,r.id').all(id).map((response) => {
        const slide = eventMaterial.slides[response.slide_index];
        let answer = response.answer;
        if (['quiz', 'poll'].includes(slide?.type)) answer = slide.options[Number(answer)];
        if (slide?.type === 'multi-quiz') answer = JSON.parse(answer).map((index) => slide.options[index]).join(', ');
        return { participantId: response.participant_id, participantName: response.name, slideIndex: response.slide_index, slideTitle: slide?.title ?? '', type: slide?.type ?? '', answer, normalized: response.normalized, points: response.points, needsManual: slide?.type === 'text' && slide.points > 0, gradedAt: response.graded_at, submittedAt: response.submitted_at, hidden: !!response.hidden };
      });
      const summaries = eventMaterial.slides.map((slide, slideIndex) => {
        const subset = responses.filter((response) => response.slideIndex === slideIndex);
        if (!['poll', 'scale', 'word-cloud'].includes(slide.type)) return null;
        const counts = new Map();
        for (const response of subset) {
          if (slide.type === 'word-cloud' && response.hidden) continue;
          const answer = slide.type === 'word-cloud' ? response.normalized : response.answer;
          counts.set(answer, (counts.get(answer) ?? 0) + 1);
        }
        return { slideIndex, title: slide.title, type: slide.type, total: subset.length, average: slide.type === 'scale' && subset.length ? subset.reduce((sum, item) => sum + Number(item.answer), 0) / subset.length : null, counts: [...counts].map(([answer, count]) => ({ answer, count })).sort((a, b) => b.count - a.count || a.answer.localeCompare(b.answer, 'ru')) };
      }).filter(Boolean);
      return { event: { ...publicEvent(row), createdAt: row.created_at }, participants, responses, summaries, pendingManual: responses.filter((answer) => answer.needsManual && !answer.gradedAt).length, hasScoredQuestions: eventMaterial.slides.some((slide) => ['quiz', 'multi-quiz'].includes(slide.type) || (slide.type === 'text' && slide.points > 0)), slideCount: eventMaterial.slides.length };
    },
  };
}
