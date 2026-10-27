// Navigation only: the screens use sample content and have no backend actions.
const links = Array.from(document.querySelectorAll('[data-view]'));
const views = Array.from(document.querySelectorAll('.view'));
const title = document.getElementById('current-title');

function showView() {
  const requested = window.location.hash.slice(1);
  const view = views.find((item) => item.id === requested) || views[0];
  views.forEach((item) => item.classList.toggle('active', item === view));
  links.forEach((item) => item.classList.toggle('active', item.dataset.view === view.id));
  title.textContent = view.dataset.title;
  window.scrollTo(0, 0);
}

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    history.pushState({}, '', link.getAttribute('href'));
    showView();
  });
});
window.addEventListener('popstate', showView);
window.addEventListener('hashchange', showView);
showView();
window.addEventListener('load', () => window.scrollTo(0, 0));
