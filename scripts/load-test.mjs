import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { cpus, totalmem, tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { bootstrapAdmin, createStore } from '../apps/api/src/store.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const participants = Number(process.argv[2] ?? 500);
const sessions = Number(process.argv[3] ?? 10);
const pollRounds = Number(process.argv[4] ?? 5);
if (!Number.isInteger(participants) || participants < 1 || participants > 10000 || !Number.isInteger(sessions) || sessions < 1 || sessions > 100 || !Number.isInteger(pollRounds) || pollRounds < 1 || pollRounds > 100) {
  console.error('Использование: node scripts/load-test.mjs [участники 1–10000] [сессии 1–100] [циклы опроса 1–100]');
  process.exit(1);
}
const percentile = (values, p) => values.length ? Math.round([...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]) : null;
const summarize = (records, elapsedMs) => ({ requests: records.length, successful: records.filter((item) => item.ok).length, failed: records.filter((item) => !item.ok).length, p50Ms: percentile(records.map((item) => item.ms), .5), p95Ms: percentile(records.map((item) => item.ms), .95), p99Ms: percentile(records.map((item) => item.ms), .99), elapsedMs: Math.round(elapsedMs), requestsPerSecond: Math.round(records.length * 1000 / elapsedMs) });
const freePort = () => new Promise((done, reject) => { const socket = createServer(); socket.once('error', reject); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => done(port)); }); });
const mapLimit = async (items, limit, fn) => { let next = 0; const output = Array(items.length); await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { for (;;) { const index = next++; if (index >= items.length) break; output[index] = await fn(items[index], index); } })); return output; };

const dir = await mkdtemp(join(tmpdir(), 'aag-load-'));
const dbPath = join(dir, 'load.sqlite');
const store = createStore(dbPath);
bootstrapAdmin(store, { login: 'load-admin', displayName: 'Нагрузочный тест', password: 'TemporaryLoadTestPassword123!' });
store.close();
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['src/main.mjs'], { cwd: join(projectRoot, 'apps/api'), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), AAG_DB_PATH: dbPath, PUBLIC_BASE_URL: base }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk; });
server.stderr.on('data', (chunk) => { serverOutput += chunk; });
const request = async (path, { method = 'GET', data, cookie, csrf, token } = {}) => {
  const started = performance.now();
  try {
    const response = await fetch(base + path, { method, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...(token ? { 'x-participant-token': token } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(30000) });
    const body = await response.json();
    return { ok: response.ok, status: response.status, body, ms: performance.now() - started, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  } catch (error) { return { ok: false, status: 0, error: `${error.message}${error.cause?.code ? ` (${error.cause.code})` : ''}`, ms: performance.now() - started }; }
};
const requireSuccess = (result, label) => { if (!result.ok) throw new Error(`${label}: ${result.status} ${JSON.stringify(result.body ?? result.error)}`); return result; };

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Сервер завершился: ${serverOutput}`);
    if ((await request('/api/health')).ok) { ready = true; break; }
    await new Promise((done) => setTimeout(done, 100));
  }
  if (!ready) throw new Error(`Сервер не запустился: ${serverOutput}`);
  const login = requireSuccess(await request('/api/auth/login', { method: 'POST', data: { login: 'load-admin', password: 'TemporaryLoadTestPassword123!' } }), 'Вход');
  const auth = { cookie: login.cookie, csrf: login.body.csrfToken };
  const events = [];
  for (let i = 0; i < sessions; i++) events.push(requireSuccess(await request('/api/live', { method: 'POST', data: {}, ...auth }), 'Создание сессии').body.event);
  const desired = Array.from({ length: participants }, (_, i) => ({ event: events[i % events.length], name: `Участник ${i + 1}` }));
  const joinStarted = performance.now();
  const joins = await mapLimit(desired, 100, (item) => request('/api/live/join', { method: 'POST', data: { code: item.event.code, name: item.name } }));
  const joinSummary = summarize(joins, performance.now() - joinStarted);
  const members = joins.map((result, index) => result.ok ? { event: desired[index].event, token: result.body.participantToken } : null).filter(Boolean);
  const pollStarted = performance.now();
  const polls = [];
  for (let round = 0; round < pollRounds; round++) {
    polls.push(...await mapLimit(members, 200, (item) => request(`/api/live/${item.event.id}/participant`, { token: item.token })));
    if (round + 1 < pollRounds) await new Promise((done) => setTimeout(done, 1500));
  }
  const pollSummary = summarize(polls, performance.now() - pollStarted);
  const questionIndices = new Map();
  for (const event of events) {
    let host = requireSuccess(await request(`/api/live/${event.id}/host`, auth), 'Просмотр слайда').body;
    while (!['quiz', 'multi-quiz', 'poll'].includes(host.slide.type) && host.event.slideIndex + 1 < host.slideCount) {
      host = requireSuccess(await request(`/api/live/${event.id}/slide`, { method: 'POST', data: { index: host.event.slideIndex + 1 }, ...auth }), 'Выбор вопроса').body;
    }
    if (!['quiz', 'multi-quiz', 'poll'].includes(host.slide.type)) throw new Error('В тестовом материале нет вопроса с вариантами.');
    questionIndices.set(event.id, host.event.slideIndex);
    requireSuccess(await request(`/api/live/${event.id}/open`, { method: 'POST', data: {}, ...auth }), 'Открытие вопроса');
  }
  const answerStarted = performance.now();
  const answers = await Promise.all(members.map(async (item) => {
    const started = performance.now();
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await request(`/api/live/${item.event.id}/respond`, { method: 'POST', data: { answer: 1, slideIndex: questionIndices.get(item.event.id) }, token: item.token });
      if (result.ok || result.status !== 0 || attempt === 2) return { ...result, ms: performance.now() - started, attempts: attempt + 1 };
      await new Promise((done) => setTimeout(done, 150 + Math.random() * 300 * (attempt + 1)));
    }
  }));
  const answerSummary = summarize(answers, performance.now() - answerStarted);
  const hostStarted = performance.now();
  const hostPolls = await Promise.all(events.map((event) => request(`/api/live/${event.id}/host`, auth)));
  const hostSummary = summarize(hostPolls, performance.now() - hostStarted);
  const result = { timestamp: new Date().toISOString(), environment: { platform: process.platform, node: process.version, cpu: cpus()[0]?.model, logicalCores: cpus().length, ramGiB: Math.round(totalmem() / 2 ** 30 * 10) / 10, database: 'SQLite WAL, отдельный временный файл', network: 'loopback, клиент и сервер на одной машине' }, workload: { participants, sessions, participantsPerSession: Math.ceil(participants / sessions), pollRounds, phases: 'подключение, опрос состояния каждые 1,5 с, одновременные ответы на тест, опрос ведущих; ответ автоматически повторяется до 2 раз при сетевом сбое' }, results: { join: joinSummary, participantPoll: pollSummary, answerBurst: { ...answerSummary, retried: answers.filter((item) => item.attempts > 1).length }, hostPoll: hostSummary }, errors: [...joins, ...polls, ...answers, ...hostPolls].filter((item) => !item.ok).slice(0, 5).map((item) => ({ status: item.status, error: item.body?.error ?? item.error })) };
  console.log(JSON.stringify(result, null, 2));
  if (Object.values(result.results).some((phase) => phase.failed)) process.exitCode = 1;
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  server.kill();
  await new Promise((done) => { if (server.exitCode !== null) done(); else server.once('exit', done); });
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
