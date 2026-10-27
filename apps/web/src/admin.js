const adminPanel = document.getElementById('admin');
adminPanel.innerHTML = `
  <div class="page-head"><div><span class="eyebrow">ПАНЕЛЬ АДМИНИСТРАТОРА</span><h1>Управление сервисом</h1><p>Пользователи, мероприятия и важные действия в одном месте.</p></div><span class="pill pill-gold">Доступ администратора</span></div>
  <div class="panel admin-auth" id="admin-login-panel"><h3>Вход администратора</h3><p>Введите учётные данные, созданные при первом запуске сервера.</p>
    <form id="admin-login-form" class="admin-form"><label>Логин<input name="login" autocomplete="username" required></label><label>Пароль<input name="password" type="password" autocomplete="current-password" required></label><button class="button button-primary">Войти</button></form>
  </div>
  <div id="admin-workspace" hidden>
    <div class="admin-overview"><div><span class="eyebrow">ОБЗОР</span><h2 id="admin-current-user"></h2><p>Следите за работой сервиса и управляйте доступом.</p></div><button class="button button-outline" id="admin-logout">Выйти</button></div>
    <div class="admin-stats"><div class="panel admin-stat"><span>Активные пользователи</span><strong id="admin-user-count">—</strong><small>Учётные записи с доступом</small></div><div class="panel admin-stat"><span>Идут сейчас</span><strong id="admin-live-count">—</strong><small>Занятия и мероприятия</small></div><div class="panel admin-stat"><span>Последние действия</span><strong id="admin-audit-count">—</strong><small>Записи в журнале</small></div></div>
    <div class="admin-columns"><div class="panel admin-users-panel"><div class="panel-head"><div><h3>Пользователи</h3><p>Создавайте, отключайте и восстанавливайте доступ.</p></div><a class="button button-primary" href="#admin-create-panel">＋ Добавить</a></div>
      <div class="admin-filters"><label>Поиск<input id="admin-search" type="search" placeholder="Имя или логин"></label><label>Роль<select id="admin-role-filter"><option value="all">Все роли</option><option value="admin">Администраторы</option><option value="host">Ведущие</option><option value="participant">Участники</option></select></label><label class="admin-checkbox"><input id="admin-show-deleted" type="checkbox"> Показывать отключённых</label></div>
      <div id="admin-users" class="admin-user-list"></div><section id="admin-materials-panel" class="admin-materials-panel" hidden><div class="panel-head"><div><h3 id="admin-materials-heading"></h3><p>Материалы хранятся на сервере. Архивирование можно отменить.</p></div><button id="admin-materials-close" type="button" class="button button-outline">Закрыть</button></div><label class="admin-checkbox"><input id="admin-materials-archived" type="checkbox"> Показать архив</label><div id="admin-materials-list"></div></section></div>
    <div class="admin-side-panels"><div class="panel"><div class="panel-head"><div><h3>Активные мероприятия</h3><p>Открытые сессии и число участников.</p></div></div><div id="admin-live"></div></div>
    <div class="panel"><div class="panel-head"><div><h3>Журнал действий</h3><p>Последние изменения в системе.</p></div></div><div id="admin-audit"></div></div></div></div>
    <div class="panel admin-create" id="admin-create-panel"><div class="panel-head"><div><h3>Добавить пользователя</h3><p>Выберите роль и задайте пароль не короче 12 символов.</p></div></div><form id="admin-create-form" class="admin-form">
      <label>Логин<input name="login" required minlength="3" maxlength="40" pattern="[A-Za-z0-9._-]+" autocomplete="off"></label>
      <label>Имя<input name="displayName" required maxlength="100" autocomplete="off"></label>
      <label>Роль<select name="role"><option value="host">Ведущий</option><option value="participant">Участник</option><option value="admin">Администратор</option></select></label>
      <label>Пароль<input name="password" type="password" required minlength="12" autocomplete="new-password"></label>
      <button class="button button-primary">Создать учётную запись</button></form></div></div>
  <p id="admin-message" class="admin-message" role="status" aria-live="polite"></p>`;

const loginPanel = document.getElementById('admin-login-panel');
const workspace = document.getElementById('admin-workspace');
const message = document.getElementById('admin-message');
const usersBox = document.getElementById('admin-users');
let csrf = null;
let currentUser = null;
let allUsers = [];
let selectedOwner = null;

async function request(path, { method = 'GET', data } = {}) {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: {
    ...(data ? { 'content-type': 'application/json' } : {}),
    ...(method !== 'GET' && csrf ? { 'x-csrf-token': csrf } : {}),
  }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Не удалось выполнить действие.');
  return result;
}
const showMessage = (value) => { message.textContent = value; };
const roleName = { admin: 'Администратор', host: 'Ведущий', participant: 'Участник' };

async function loadUsers() {
  const { users } = await request('/aag/api/admin/users?deleted=1');
  allUsers = users;
  document.getElementById('admin-user-count').textContent = String(users.filter((user) => !user.deletedAt).length);
  renderUsers();
}
function renderUsers() {
  usersBox.replaceChildren();
  const search = document.getElementById('admin-search').value.trim().toLocaleLowerCase('ru-RU');
  const role = document.getElementById('admin-role-filter').value;
  const showDeleted = document.getElementById('admin-show-deleted').checked;
  const users = allUsers.filter((user) => (showDeleted || !user.deletedAt) && (role === 'all' || user.role === role) && (!search || `${user.displayName} ${user.login}`.toLocaleLowerCase('ru-RU').includes(search)));
  if (!users.length) { const empty = document.createElement('p'); empty.className = 'admin-empty'; empty.textContent = 'Пользователи не найдены.'; usersBox.append(empty); }
  for (const user of users) {
    const row = document.createElement('div'); row.className = 'admin-user-row';
    const identity = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = user.displayName;
    const detail = document.createElement('small'); detail.textContent = `${user.login} · ${roleName[user.role]}`;
    const status = document.createElement('span'); status.className = `admin-status${user.deletedAt ? ' inactive' : ''}`; status.textContent = user.deletedAt ? 'Отключён' : 'Активен';
    identity.append(name, detail); row.append(identity, status);
    const materials = document.createElement('button'); materials.className = 'button button-outline'; materials.textContent = 'Материалы';
    materials.addEventListener('click', () => { selectedOwner = user; document.getElementById('admin-materials-panel').hidden = false; document.getElementById('admin-materials-heading').textContent = `Материалы: ${user.displayName}`; loadUserMaterials().catch((issue) => showMessage(issue.message)); });
    row.append(materials);
    if (user.deletedAt) {
      const restore = document.createElement('button'); restore.className = 'button button-outline'; restore.textContent = 'Восстановить';
      restore.addEventListener('click', async () => { try { await request(`/aag/api/admin/users/${user.id}/restore`, { method: 'POST' }); await loadUsers(); await loadAudit(); showMessage('Пользователь восстановлен.'); } catch (issue) { showMessage(issue.message); } }); row.append(restore);
    } else if (user.id !== currentUser.id) {
      const remove = document.createElement('button'); remove.className = 'button button-outline'; remove.textContent = 'Удалить';
      remove.addEventListener('click', async () => {
        if (!window.confirm(`Удалить пользователя «${user.displayName}»? Доступ будет закрыт сразу.`)) return;
        try { await request(`/aag/api/admin/users/${user.id}`, { method: 'DELETE' }); await loadUsers(); await loadAudit(); showMessage('Пользователь удалён. История его действий сохранена.'); }
        catch (issue) { showMessage(issue.message); }
      }); row.append(remove);
    }
    usersBox.append(row);
  }
}

async function loadUserMaterials() {
  if (!selectedOwner) return;
  const archived = document.getElementById('admin-materials-archived').checked;
  const { materials } = await request(`/aag/api/admin/users/${selectedOwner.id}/materials${archived ? '?archived=1' : ''}`);
  const box = document.getElementById('admin-materials-list'); box.replaceChildren();
  if (!materials.length) { const empty = document.createElement('p'); empty.className = 'admin-empty'; empty.textContent = archived ? 'В архиве нет материалов.' : 'У пользователя пока нет материалов.'; box.append(empty); }
  for (const material of materials) {
    const row = document.createElement('div'); row.className = 'admin-user-row';
    const label = document.createElement('div'); const title = document.createElement('strong'); title.textContent = material.title;
    const detail = document.createElement('small'); detail.textContent = `${material.slideCount} слайдов · обновлено ${new Date(material.updatedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Novosibirsk' })}`;
    label.append(title, detail); row.append(label);
    const action = document.createElement('button'); action.className = 'button button-outline'; action.textContent = archived ? 'Восстановить' : 'Удалить';
    action.addEventListener('click', async () => {
      if (!archived && !window.confirm(`Удалить материал «${material.title}»? Его можно восстановить из архива.`)) return;
      try {
        await request(`/aag/api/admin/users/${selectedOwner.id}/materials/${material.id}${archived ? '/restore' : ''}`, { method: archived ? 'POST' : 'DELETE' });
        await Promise.all([loadUserMaterials(), loadAudit()]);
        showMessage(archived ? 'Материал восстановлен.' : 'Материал отправлен в архив.');
      } catch (issue) { showMessage(issue.message); }
    });
    row.append(action); box.append(row);
  }
}

async function loadLive() {
  const { events } = await request('/aag/api/admin/live');
  document.getElementById('admin-live-count').textContent = String(events.length);
  const box = document.getElementById('admin-live'); box.replaceChildren();
  if (!events.length) box.textContent = 'Активных сессий нет.';
  for (const event of events) {
    const row = document.createElement('div'); row.className = 'admin-user-row';
    const label = document.createElement('div'); const title = document.createElement('strong'); title.textContent = event.title;
    const detail = document.createElement('small'); detail.textContent = `${event.host_name} · ${event.participant_count} участников · код ${event.code}${event.status === 'paused' ? ' · пауза' : ''}`;
    label.append(title, detail); row.append(label);
    const end = document.createElement('button'); end.className = 'button button-outline'; end.textContent = 'Завершить';
    end.addEventListener('click', async () => { const reason = window.prompt('Причина принудительного завершения (не менее 5 символов):'); if (reason === null) return; try { await request(`/aag/api/admin/live/${event.id}/end`, { method: 'POST', data: { reason } }); await loadLive(); await loadAudit(); showMessage('Сессия завершена. Причина записана в журнал.'); } catch (issue) { showMessage(issue.message); } });
    row.append(end); box.append(row);
  }
}
async function loadAudit() {
  const { actions } = await request('/aag/api/admin/audit');
  document.getElementById('admin-audit-count').textContent = String(actions.length);
  const box = document.getElementById('admin-audit'); box.replaceChildren();
  if (!actions.length) box.textContent = 'Записей пока нет.';
  for (const action of actions) {
    const row = document.createElement('div'); row.className = 'admin-user-row';
    row.textContent = `${new Date(action.created_at).toLocaleString('ru-RU', { timeZone: 'Asia/Novosibirsk' })} · ${action.actor_name || 'Система'} · ${action.action} · №${action.target_id ?? '—'}${action.detail ? ` · ${action.detail}` : ''}`;
    box.append(row);
  }
}

function enter(user, csrfToken) {
  currentUser = user; csrf = csrfToken;
  if (user.role !== 'admin') { loginPanel.hidden = false; workspace.hidden = true; showMessage('У этой учётной записи нет прав администратора. Войдите как администратор.'); return; }
  loginPanel.hidden = true; workspace.hidden = false;
  document.getElementById('admin-current-user').textContent = `Здравствуйте, ${user.displayName}`;
  Promise.all([loadUsers(), loadLive(), loadAudit()]).catch((issue) => showMessage(issue.message));
}

document.getElementById('admin-login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); showMessage('');
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  try { const result = await request('/aag/api/auth/login', { method: 'POST', data }); form.reset(); enter(result.user, result.csrfToken); }
  catch (issue) { showMessage(issue.message); }
});
document.getElementById('admin-create-form').addEventListener('submit', async (event) => {
  event.preventDefault(); showMessage('');
  const form = event.currentTarget;
  try { await request('/aag/api/admin/users', { method: 'POST', data: Object.fromEntries(new FormData(form)) }); form.reset(); await loadUsers(); await loadAudit(); showMessage('Пользователь создан.'); }
  catch (issue) { showMessage(issue.message); }
});
document.getElementById('admin-logout').addEventListener('click', async () => {
  try { await request('/aag/api/auth/logout', { method: 'POST' }); } catch {}
  currentUser = null; csrf = null; workspace.hidden = true; loginPanel.hidden = false; usersBox.replaceChildren(); showMessage('Вы вышли из системы.');
});
request('/aag/api/auth/me').then((result) => enter(result.user, result.csrfToken)).catch(() => {});
document.getElementById('admin-show-deleted').addEventListener('change', () => loadUsers().catch((issue) => showMessage(issue.message)));
document.getElementById('admin-search').addEventListener('input', renderUsers);
document.getElementById('admin-role-filter').addEventListener('change', renderUsers);
document.getElementById('admin-materials-archived').addEventListener('change', () => loadUserMaterials().catch((issue) => showMessage(issue.message)));
document.getElementById('admin-materials-close').addEventListener('click', () => { selectedOwner = null; document.getElementById('admin-materials-panel').hidden = true; });
