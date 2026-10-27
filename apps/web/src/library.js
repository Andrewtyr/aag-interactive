const $ = (id) => document.getElementById(id);
let csrf = null;
let allMaterials = [];
const message = (value) => { $('message').textContent = value; };
async function api(path, method = 'GET', data) {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...(csrf && method !== 'GET' ? { 'x-csrf-token': csrf } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Не удалось выполнить действие.'); return result;
}
const cardButton = (text, href) => { const link = document.createElement('a'); link.className = 'button button-secondary'; link.textContent = text; link.href = href; return link; };
const slideWord = (count) => count % 10 === 1 && count % 100 !== 11 ? 'слайд' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'слайда' : 'слайдов';
async function load() {
  const { materials } = await api($('show-archive').checked ? '/aag/api/materials?archived=1' : '/aag/api/materials');
  allMaterials = materials;
  renderMaterials();
  $('login-panel').hidden = true; $('library-panel').hidden = false;
}
function renderMaterials() {
  const box = $('materials'); box.replaceChildren();
  const query = $('material-search').value.trim().toLocaleLowerCase('ru-RU');
  const materials = allMaterials.filter((item) => item.title.toLocaleLowerCase('ru-RU').includes(query));
  if (!materials.length) { const empty = document.createElement('p'); empty.textContent = $('show-archive').checked ? 'В архиве ничего не найдено.' : 'Материалы не найдены.'; box.append(empty); }
  for (const material of materials) {
    const card = document.createElement('article'); card.className = 'panel material-card';
    const kind = document.createElement('small'); kind.textContent = material.deletedAt ? 'В АРХИВЕ' : material.isTemplate ? 'ГОТОВЫЙ ОБРАЗЕЦ' : 'ВАШ МАТЕРИАЛ';
    const title = document.createElement('h2'); title.textContent = material.title;
    const count = document.createElement('p'); count.textContent = `${material.slideCount} ${slideWord(material.slideCount)} · версия ${material.version}`;
    const actions = document.createElement('div'); actions.className = 'card-actions';
    if (material.deletedAt) {
      const restore = document.createElement('button'); restore.className = 'button button-secondary'; restore.textContent = 'Восстановить';
      restore.addEventListener('click', async () => { try { await api(`/aag/api/materials/${material.id}/restore`, 'POST'); await load(); message('Материал восстановлен.'); } catch (issue) { message(issue.message); } });
      actions.append(restore);
    } else if (material.isTemplate) {
      actions.append(cardButton('Провести', `./host.html?material=${material.id}`));
      const copy = document.createElement('button'); copy.className = 'button button-secondary'; copy.textContent = 'Сделать копию';
      copy.addEventListener('click', async () => { try { const full = (await api(`/aag/api/materials/${material.id}`)).material; const created = await api('/aag/api/materials', 'POST', { title: `${full.title} — копия`, audience: full.audience, description: full.description, slides: full.slides }); location.href = `./editor.html?material=${created.material.id}`; } catch (issue) { message(issue.message); } });
      actions.append(copy);
    } else {
      actions.append(cardButton('Провести', `./host.html?material=${material.id}`));
      actions.append(cardButton('Редактировать', `./editor.html?material=${material.id}`));
      const copy = document.createElement('button'); copy.className = 'button button-secondary'; copy.textContent = 'Копировать';
      copy.addEventListener('click', async () => { try { const full = (await api(`/aag/api/materials/${material.id}`)).material; const created = await api('/aag/api/materials', 'POST', { ...full, title: `${full.title} — копия` }); location.href = `./editor.html?material=${created.material.id}`; } catch (issue) { message(issue.message); } });
      actions.append(copy);
      const remove = document.createElement('button'); remove.className = 'button button-quiet'; remove.textContent = 'Удалить';
      remove.addEventListener('click', async () => { if (!confirm(`Удалить материал «${material.title}»? Прошлые сессии останутся в истории.`)) return; try { await api(`/aag/api/materials/${material.id}`, 'DELETE'); await load(); message('Материал удалён.'); } catch (issue) { message(issue.message); } });
      actions.append(remove);
    }
    card.append(kind, title, count, actions); box.append(card);
  }
}
$('material-search').addEventListener('input', renderMaterials);
$('show-archive').addEventListener('change', () => load().catch((issue) => message(issue.message)));
$('login-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { const result = await api('/aag/api/auth/login', 'POST', Object.fromEntries(new FormData(form))); csrf = result.csrfToken; form.reset(); await load(); message(''); } catch (issue) { message(issue.message); } });
api('/aag/api/auth/me').then(async (result) => { csrf = result.csrfToken; await load(); }).catch(() => { $('login-panel').hidden = false; });
