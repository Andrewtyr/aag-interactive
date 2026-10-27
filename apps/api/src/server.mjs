import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import QRCode from 'qrcode';
import { sendAsset } from './asset-response.mjs';
import { normalizeVideoUrl } from './video-sources.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const error = (status, message) => { const issue = new Error(message); issue.status = status; throw issue; };
const cookieValue = (req) => /(?:^|;\s*)aag_session=([^;]*)/.exec(req.headers.cookie ?? '')?.[1];
const csvCell = (value) => { let cell = String(value ?? ''); if (/^[\s]*[=+\-@]/.test(cell)) cell = `'${cell}`; return `"${cell.replaceAll('"', '""')}"`; };
async function body(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 1_048_576) error(413, 'Запрос слишком большой.'); }
  try { return JSON.parse(raw); } catch { error(400, 'Некорректный JSON.'); }
}

export function createApiServer({ store, materialStore, liveStore, importStore, webRoot, publicBaseUrl = process.env.PUBLIC_BASE_URL, maxJoinsPerClient = 300 }) {
  const root = resolve(webRoot);
  const publicUrl = publicBaseUrl ? new URL(publicBaseUrl) : null;
  const cookiePath = publicUrl?.pathname.replace(/\/$/, '') || '/';
  let importing = false;
  const joinUrlFor = (req, event) => {
    const base = new URL(publicBaseUrl ?? `http://${req.headers.host}`);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) error(500, 'Неверный публичный адрес сервиса.');
    return new URL(`participant.html?code=${encodeURIComponent(event.code)}`, base).toString();
  };
  const failures = new Map();
  const joins = new Map();
  const clientAddress = (req) => process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress).split(',')[0].trim() : req.socket.remoteAddress;
  const blocked = (key, limit) => { const entry = failures.get(key); if (!entry) return false; if (entry.until < Date.now()) { failures.delete(key); return false; } return entry.count >= limit; };
  const failed = (key) => { const entry = failures.get(key); failures.set(key, { count: (entry?.until > Date.now() ? entry.count : 0) + 1, until: Date.now() + 10 * 60_000 }); if (failures.size > 10_000) failures.delete(failures.keys().next().value); };
  return createServer(async (req, res) => {
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob: data:; media-src 'self' blob:; frame-src https://www.youtube-nocookie.com https://rutube.ru https://vk.com; connect-src 'self'; form-action 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    if (process.env.NODE_ENV === 'production' && (req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https')) res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      const method = req.method;
      if (path.startsWith('/api/')) {
        if (path === '/api/health' && method === 'GET') return json(res, 200, { ok: true });
        const origin = req.headers.origin;
        if (origin && origin !== publicUrl?.origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) error(403, 'Недопустимый источник запроса.');
        const token = cookieValue(req);
        const session = store.getSession(token);
        const imageRoute = importStore && /^\/api\/imports\/([a-f0-9-]{36})\/pages\/(\d+)$/.exec(path);
        if (imageRoute && method === 'GET') {
          const importId = imageRoute[1]; const page = Number(imageRoute[2]);
          let allowed = session && ['admin', 'host'].includes(session.user.role) && importStore.owns(importId, session.user.id);
          if (!allowed && liveStore && url.searchParams.has('event')) {
            const eventId = Number(url.searchParams.get('event'));
            const participantState = liveStore.getParticipant(eventId, req.headers['x-participant-token']);
            allowed = (participantState.slide.type === 'imported' && participantState.slide.importId === importId && participantState.slide.page === page) || (participantState.slide.template?.importId === importId && participantState.slide.template.page === page);
          }
          if (!allowed) error(403, 'Слайд недоступен.');
          const file = importStore.pagePath(importId, page);
          const metadata = await stat(file);
          res.writeHead(200, { 'content-type': 'image/png', 'content-length': metadata.size, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' });
          return createReadStream(file).pipe(res);
        }
        const assetRoute = importStore && /^\/api\/assets\/([a-f0-9-]{36})$/.exec(path);
        if (assetRoute && ['GET', 'HEAD'].includes(method)) {
          const assetId = assetRoute[1];
          let allowed = session && ['admin', 'host'].includes(session.user.role) && importStore.ownsAsset(assetId, session.user.id);
          if (!allowed && liveStore && url.searchParams.has('event')) {
            const state = liveStore.getParticipant(Number(url.searchParams.get('event')), req.headers['x-participant-token']);
            allowed = state.slide.elements?.some((element) => ['image', 'video'].includes(element.type) && element.assetId === assetId);
          }
          if (!allowed) error(403, 'Изображение недоступно.');
          const file = importStore.assetPath(assetId);
          return await sendAsset(req, res, file);
        }
        if (liveStore && path === '/api/live/join' && method === 'POST') {
          const data = await body(req);
          const limitKey = `join:${clientAddress(req)}`;
          const joinKey = `${limitKey}:${String(data.code ?? '').replace(/\s/g, '')}`;
          if (blocked(limitKey, 30)) error(429, 'Слишком много неверных кодов. Повторите позже.');
          const usage = joins.get(joinKey);
          if (usage?.until > Date.now() && usage.count >= maxJoinsPerClient) error(429, 'Слишком много подключений с одного адреса. Повторите позже.');
          try {
            const joined = liveStore.join(data.code, data.name, session?.user);
            joins.set(joinKey, { count: (usage?.until > Date.now() ? usage.count : 0) + 1, until: usage?.until > Date.now() ? usage.until : Date.now() + 60_000 });
            if (joins.size > 10_000) joins.delete(joins.keys().next().value);
            return json(res, 200, joined);
          }
          catch (issue) { if (issue.status === 404) failed(limitKey); throw issue; }
        }
        const liveRoute = liveStore && /^\/api\/live\/(\d+)(?:\/(host|participant|projector|slide|open|pause|resume|close|publish|respond|end|qr|joins|publish-rank|statistics|statistics-placement))?$/.exec(path);
        if (liveRoute && (liveRoute[2] === 'participant' || liveRoute[2] === 'respond')) {
          const eventId = Number(liveRoute[1]);
          const participantToken = req.headers['x-participant-token'];
          if (liveRoute[2] === 'participant' && method === 'GET') return json(res, 200, liveStore.getParticipant(eventId, participantToken));
          if (liveRoute[2] === 'respond' && method === 'POST') { const data = await body(req); return json(res, 200, liveStore.respond(eventId, participantToken, data.answer, data.slideIndex)); }
        }
        if (path === '/api/auth/login' && method === 'POST') {
          const data = await body(req);
          const limitKey = `login:${clientAddress(req)}:${String(data.login ?? '').trim().toLowerCase()}`;
          if (blocked(limitKey, 10)) error(429, 'Слишком много неудачных попыток входа. Повторите позже.');
          const user = store.authenticate(data.login, data.password);
          if (!user) { failed(limitKey); error(401, 'Неверный логин или пароль.'); }
          failures.delete(limitKey);
          const loginSession = store.createSession(user.id);
          const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
          res.setHeader('set-cookie', `aag_session=${loginSession.token}; HttpOnly; SameSite=Strict; Path=${cookiePath}; Max-Age=43200${secure}`);
          return json(res, 200, { user, csrfToken: loginSession.csrf });
        }
        if (!session) error(401, 'Войдите в систему.');
        if (path === '/api/auth/me' && method === 'GET') return json(res, 200, { user: session.user, csrfToken: session.csrf });
        if (method !== 'GET' && req.headers['x-csrf-token'] !== session.csrf) error(403, 'Недействительный защитный токен.');
        if (importStore && path === '/api/imports' && method === 'POST') {
          if (!['admin', 'host'].includes(session.user.role)) error(403, 'Требуются права ведущего.');
          if (importing) error(503, 'Другая презентация уже обрабатывается. Повторите позже.');
          importing = true;
          try { return json(res, 201, { imported: await importStore.importDocument(req, session.user.id, req.headers['x-file-name'], req.headers['content-type']) }); }
          finally { importing = false; }
        }
        if (importStore && path === '/api/imports' && method === 'GET') {
          if (!['admin', 'host'].includes(session.user.role)) error(403, 'Требуются права ведущего.');
          return json(res, 200, { imports: importStore.list(session.user.id) });
        }
        if (importStore && path === '/api/assets' && method === 'POST') {
          if (!['admin', 'host'].includes(session.user.role)) error(403, 'Требуются права ведущего.');
          return json(res, 201, { asset: await importStore.uploadAsset(req, session.user.id) });
        }
        if (path === '/api/assets/video-link' && method === 'POST') {
          if (!['admin', 'host'].includes(session.user.role)) error(403, 'Требуются права ведущего.');
          const data = await body(req);
          return json(res, 200, { video: normalizeVideoUrl(data.url) });
        }
        if (path === '/api/auth/logout' && method === 'POST') {
          store.revokeSession(token);
          res.setHeader('set-cookie', `aag_session=; HttpOnly; SameSite=Strict; Path=${cookiePath}; Max-Age=0`);
          return json(res, 200, { ok: true });
        }
        if (materialStore && path.startsWith('/api/materials')) {
          if (!['admin', 'host'].includes(session.user.role)) error(403, 'Требуются права ведущего.');
          if (path === '/api/materials' && method === 'GET') return json(res, 200, { materials: materialStore.list(session.user.id, url.searchParams.get('archived') === '1') });
          if (path === '/api/materials' && method === 'POST') { const data = await body(req); if (data.slides?.some((slide) => slide.type === 'imported' || slide.template || slide.elements?.some((element) => ['image', 'video'].includes(element.type))) && !importStore) error(400, 'Загрузка файлов недоступна.'); importStore?.verifySlides(data.slides, session.user.id); importStore?.verifyAssets(data.slides, session.user.id); return json(res, 201, { material: materialStore.create(data, session.user.id) }); }
          const match = /^\/api\/materials\/(\d+)$/.exec(path);
          if (match) {
            const id = Number(match[1]);
            if (method === 'GET') return json(res, 200, { material: materialStore.get(id, session.user.id) });
            if (method === 'PUT') { const data = await body(req); if (data.slides?.some((slide) => slide.type === 'imported' || slide.template || slide.elements?.some((element) => ['image', 'video'].includes(element.type))) && !importStore) error(400, 'Загрузка файлов недоступна.'); importStore?.verifySlides(data.slides, session.user.id); importStore?.verifyAssets(data.slides, session.user.id); return json(res, 200, { material: materialStore.update(id, data, session.user.id) }); }
            if (method === 'DELETE') return json(res, 200, materialStore.remove(id, session.user.id));
          }
          const restore = /^\/api\/materials\/(\d+)\/restore$/.exec(path);
          if (restore && method === 'POST') return json(res, 200, { material: materialStore.restore(Number(restore[1]), session.user.id) });
          error(404, 'Материал не найден.');
        }
        if (liveStore && path.startsWith('/api/reports')) {
          if (!['admin', 'host'].includes(session.user.role)) error(403, 'Требуются права ведущего.');
          if (path === '/api/reports' && method === 'GET') return json(res, 200, { reports: liveStore.listReports(session.user.id) });
          const match = /^\/api\/reports\/(\d+)(\.csv)?$/.exec(path);
          if (match && method === 'GET') {
            const report = liveStore.getReport(Number(match[1]), session.user.id);
            if (!match[2]) return json(res, 200, { report });
            const rows = [['Сессия', 'Название', 'Формат', 'Категория', 'Материал', 'Участник', 'Слайд', 'Тип', 'Ответ', 'Баллы', 'Время']];
            for (const answer of report.responses) rows.push([report.event.id, report.event.title, report.event.format === 'event' ? 'Мероприятие' : 'Занятие', report.event.category, report.event.materialTitle, answer.participantName, answer.slideTitle, answer.type, answer.answer, answer.points, new Date(answer.submittedAt).toISOString()]);
            const csv = '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
            res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="aag-report-${report.event.id}.csv"`, 'cache-control': 'no-store' });
            return res.end(csv);
          }
          error(404, 'Отчёт не найден.');
        }
        if (liveStore && path === '/api/live' && method === 'POST') {
          if (!['admin', 'host'].includes(session.user.role)) error(403, 'Требуются права ведущего.');
          const data = req.headers['content-type']?.includes('application/json') ? await body(req) : {};
          const selectedMaterial = data.materialId && materialStore ? materialStore.get(Number(data.materialId), session.user.id) : undefined;
          return json(res, 201, { event: liveStore.start(session.user.id, selectedMaterial, { ...data, welcomeScreen: true }) });
        }
        const hideRoute = liveStore && /^\/api\/live\/(\d+)\/answers\/(\d+)\/hide$/.exec(path);
        if (hideRoute && method === 'POST') {
          if (!['admin', 'host'].includes(session.user.role)) error(403, 'Требуются права ведущего.');
          return json(res, 200, liveStore.hideAnswer(Number(hideRoute[1]), session.user.id, Number(hideRoute[2])));
        }
        const gradeRoute = liveStore && /^\/api\/live\/(\d+)\/answers\/(\d+)\/grade$/.exec(path);
        if (gradeRoute && method === 'POST') {
          if (!['admin', 'host'].includes(session.user.role)) error(403, 'Требуются права ведущего.');
          return json(res, 200, liveStore.gradeAnswer(Number(gradeRoute[1]), session.user.id, Number(gradeRoute[2]), (await body(req)).points));
        }
        if (liveRoute) {
          if (!['admin', 'host'].includes(session.user.role)) error(403, 'Требуются права ведущего.');
          const eventId = Number(liveRoute[1]);
          const action = liveRoute[2];
          if (action === 'host' && method === 'GET') {
            const data = liveStore.getHost(eventId, session.user.id);
            return json(res, 200, { ...data, joinUrl: joinUrlFor(req, data.event) });
          }
          if (action === 'projector' && method === 'GET') {
            const data = liveStore.getProjector(eventId, session.user.id);
            return json(res, 200, { ...data, joinUrl: joinUrlFor(req, data.event) });
          }
          if (action === 'qr' && method === 'GET') {
            const event = liveStore.getHost(eventId, session.user.id).event;
            const svg = await QRCode.toString(joinUrlFor(req, event), { type: 'svg', width: 220, margin: 2, errorCorrectionLevel: 'M' });
            res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
            return res.end(svg);
          }
          if (action === 'slide' && method === 'POST') return json(res, 200, liveStore.setSlide(eventId, session.user.id, (await body(req)).index));
          if (action === 'open' && method === 'POST') return json(res, 200, liveStore.open(eventId, session.user.id));
          if (action === 'pause' && method === 'POST') return json(res, 200, liveStore.pause(eventId, session.user.id));
          if (action === 'resume' && method === 'POST') return json(res, 200, liveStore.resume(eventId, session.user.id));
          if (action === 'joins' && method === 'POST') return json(res, 200, liveStore.setJoins(eventId, session.user.id, (await body(req)).open));
          if (action === 'publish-rank' && method === 'POST') return json(res, 200, liveStore.publishLeaderboard(eventId, session.user.id));
          if (action === 'statistics' && method === 'POST') return json(res, 200, liveStore.setStatisticsVisibility(eventId, session.user.id, (await body(req)).show));
          if (action === 'statistics-placement' && method === 'POST') return json(res, 200, liveStore.setStatisticsPlacement(eventId, session.user.id, (await body(req)).placement));
          if (action === 'close' && method === 'POST') return json(res, 200, liveStore.closeQuestion(eventId, session.user.id));
          if (action === 'publish' && method === 'POST') return json(res, 200, liveStore.publish(eventId, session.user.id));
          if (action === 'end' && method === 'POST') return json(res, 200, liveStore.end(eventId, session.user.id));
        }
        if (path.startsWith('/api/admin/')) {
          if (session.user.role !== 'admin') error(403, 'Требуются права администратора.');
          const ownerMaterials = materialStore && /^\/api\/admin\/users\/(\d+)\/materials(?:\/(\d+)(\/restore)?)?$/.exec(path);
          if (ownerMaterials) {
            const ownerId = Number(ownerMaterials[1]);
            if (!ownerId || !store.getUser(ownerId)) error(404, 'Пользователь не найден.');
            const materialId = ownerMaterials[2] ? Number(ownerMaterials[2]) : null;
            if (materialId === null && method === 'GET') return json(res, 200, { materials: materialStore.listForOwner(ownerId, url.searchParams.get('archived') === '1') });
            if (materialId && method === 'DELETE' && !ownerMaterials[3]) { const result = materialStore.adminRemove(materialId, ownerId); store.audit(session.user.id, 'material.archive', materialId, `Владелец №${ownerId}`); return json(res, 200, result); }
            if (materialId && method === 'POST' && ownerMaterials[3]) { const result = materialStore.adminRestore(materialId, ownerId); store.audit(session.user.id, 'material.restore', materialId, `Владелец №${ownerId}`); return json(res, 200, result); }
            error(405, 'Метод не поддерживается.');
          }
          if (path === '/api/admin/users' && method === 'GET') return json(res, 200, { users: store.listUsers(url.searchParams.get('deleted') === '1') });
          if (path === '/api/admin/users' && method === 'POST') return json(res, 201, { user: store.createUser(await body(req), session.user.id) });
          if (path === '/api/admin/audit' && method === 'GET') return json(res, 200, { actions: store.listAudit() });
          if (path === '/api/admin/live' && method === 'GET') return json(res, 200, { events: liveStore.activeEvents() });
          const forceEnd = /^\/api\/admin\/live\/(\d+)\/end$/.exec(path);
          if (forceEnd && method === 'POST') {
            const result = liveStore.forceEnd(Number(forceEnd[1]), (await body(req)).reason);
            store.audit(session.user.id, 'live.force_end', result.id, result.reason);
            return json(res, 200, result);
          }
          const match = /^\/api\/admin\/users\/(\d+)(\/restore)?$/.exec(path);
          if (match && method === 'DELETE' && !match[2]) return json(res, 200, { user: store.deleteUser(Number(match[1]), session.user.id) });
          if (match && method === 'POST' && match[2]) return json(res, 200, { user: store.restoreUser(Number(match[1]), session.user.id) });
        }
        error(404, 'Адрес не найден.');
      }
      if (method !== 'GET' && method !== 'HEAD') error(405, 'Метод не поддерживается.');
      const filePath = resolve(root, '.' + decodeURIComponent(path === '/' ? '/index.html' : path));
      if (filePath !== root && !filePath.startsWith(root + sep)) error(403, 'Доступ запрещён.');
      const content = await readFile(filePath);
      res.writeHead(200, { 'content-type': types[extname(filePath)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(method === 'HEAD' ? undefined : content);
    } catch (issue) {
      if (res.headersSent) return res.end();
      json(res, issue.status ?? (issue.code === 'ENOENT' ? 404 : 500), { error: issue.status || issue.code === 'ENOENT' ? issue.message : 'Ошибка сервера.' });
    }
  });
}
