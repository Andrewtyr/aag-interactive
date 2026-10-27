import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

const roles = new Set(['admin', 'host', 'participant']);
const publicUser = (row) => row && ({ id: row.id, login: row.login, displayName: row.display_name, role: row.role, createdAt: row.created_at, deletedAt: row.deleted_at });
const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };

export function createStore(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL, password_hash BLOB NOT NULL, salt BLOB NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, actor_id INTEGER, action TEXT NOT NULL, target_id INTEGER, created_at TEXT NOT NULL);`);
  if (!db.prepare('PRAGMA table_info(audit)').all().some((column) => column.name === 'detail')) db.exec('ALTER TABLE audit ADD COLUMN detail TEXT');
  const getUser = (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const writeAudit = (actor, action, target, detail = null) => db.prepare('INSERT INTO audit(actor_id,action,target_id,created_at,detail) VALUES(?,?,?,?,?)').run(actor, action, target, new Date().toISOString(), detail);
  return {
    close: () => db.close(),
    hasAdmin: () => !!db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get(),
    listUsers: (includeDeleted = false) => db.prepare(includeDeleted ? 'SELECT * FROM users ORDER BY id' : 'SELECT * FROM users WHERE deleted_at IS NULL ORDER BY id').all().map(publicUser),
    getUser: (id) => publicUser(getUser(id)),
    listAudit: () => db.prepare('SELECT a.id,a.actor_id,a.action,a.target_id,a.created_at,a.detail,u.display_name AS actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100').all(),
    audit: (actor, action, target, detail) => writeAudit(actor, action, target, detail),
    createUser({ login, displayName, role, password }, actorId = null) {
      login = String(login ?? '').trim().toLowerCase();
      displayName = String(displayName ?? '').trim();
      if (!/^[a-z0-9._-]{3,40}$/.test(login)) fail(400, 'Логин: 3–40 латинских букв, цифр, точек, дефисов или подчёркиваний.');
      if (!displayName || displayName.length > 100) fail(400, 'Укажите имя длиной до 100 символов.');
      if (!roles.has(role)) fail(400, 'Недопустимая роль.');
      if (typeof password !== 'string' || password.length < 12 || password.length > 200) fail(400, 'Пароль должен содержать от 12 до 200 символов.');
      if (db.prepare('SELECT id FROM users WHERE login=?').get(login)) fail(409, 'Такой логин уже существует.');
      const salt = randomBytes(32);
      const passwordHash = scryptSync(password, salt, 64);
      const id = Number(db.prepare('INSERT INTO users(login,display_name,role,password_hash,salt,created_at) VALUES(?,?,?,?,?,?)').run(login, displayName, role, passwordHash, salt, new Date().toISOString()).lastInsertRowid);
      writeAudit(actorId, 'user.create', id);
      return publicUser(getUser(id));
    },
    authenticate(login, password) {
      const row = db.prepare('SELECT * FROM users WHERE login=? AND deleted_at IS NULL').get(String(login ?? '').trim().toLowerCase());
      // Do comparable work for unknown users, without leaking whether the login exists.
      const computed = scryptSync(String(password ?? ''), row?.salt ?? Buffer.alloc(32), 64);
      if (!row || !timingSafeEqual(computed, row.password_hash)) return null;
      return publicUser(row);
    },
    createSession(userId) {
      const token = randomBytes(32).toString('hex');
      const csrf = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)').run(hashToken(token), userId, csrf, Date.now() + 12 * 60 * 60 * 1000);
      return { token, csrf };
    },
    getSession(token) {
      if (!token) return null;
      const row = db.prepare('SELECT s.csrf,s.expires_at,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND u.deleted_at IS NULL').get(hashToken(token));
      return row && row.expires_at > Date.now() ? { user: publicUser(row), csrf: row.csrf } : null;
    },
    revokeSession(token) { if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token)); },
    deleteUser(id, actorId) {
      const row = getUser(id);
      if (!row || row.deleted_at) fail(404, 'Пользователь не найден.');
      if (row.id === actorId) fail(409, 'Нельзя удалить собственную учётную запись.');
      if (row.role === 'admin' && db.prepare("SELECT count(*) AS n FROM users WHERE role='admin' AND deleted_at IS NULL").get().n <= 1) fail(409, 'Нельзя удалить последнего администратора.');
      db.exec('BEGIN');
      try {
        db.prepare('UPDATE users SET deleted_at=? WHERE id=?').run(new Date().toISOString(), id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
        if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='live_participants'").get()) db.prepare('UPDATE live_participants SET revoked_at=? WHERE user_id=?').run(Date.now(), id);
        writeAudit(actorId, 'user.delete', id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return publicUser(getUser(id));
    },
    restoreUser(id, actorId) {
      const row = getUser(id);
      if (!row || !row.deleted_at) fail(404, 'Удалённый пользователь не найден.');
      db.prepare('UPDATE users SET deleted_at=NULL WHERE id=?').run(id);
      writeAudit(actorId, 'user.restore', id);
      return publicUser(getUser(id));
    },
  };
}

export function bootstrapAdmin(store, account) {
  if (store.hasAdmin()) fail(409, 'Администратор уже создан.');
  return store.createUser({ ...account, role: 'admin' });
}
