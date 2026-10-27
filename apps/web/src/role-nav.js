const roleNavigation = document.querySelector('[data-role-navigation]');
if (roleNavigation) {
  fetch('/aag/api/auth/me', { credentials: 'same-origin' })
    .then((response) => response.ok ? response.json() : null)
    .then((result) => {
      if (!result) return;
      const role = result.user.role;
      for (const link of roleNavigation.querySelectorAll('[data-role-link]')) {
        link.hidden = link.dataset.roleLink === 'admin' ? role !== 'admin' : role === 'participant';
      }
      const identity = document.getElementById('nav-identity');
      if (identity) { identity.textContent = `${result.user.displayName} · ${role === 'admin' ? 'Администратор' : role === 'host' ? 'Ведущий' : 'Участник'}`; identity.hidden = false; }
    }).catch(() => {});
}
