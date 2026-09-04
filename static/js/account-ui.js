(() => {
  const roleKeys = { admin: 'auth.admin', designer: 'auth.designer', guest: 'auth.guest' };
  let currentUser = null;

  const tr = key => window.StudioI18n?.t?.(key) || key;
  const byId = id => document.getElementById(id);

  function roleLabel(user) {
    return roleKeys[user?.role] ? tr(roleKeys[user.role]) : (user?.role || '');
  }

  function applyRoleGate(user) {
    const admin = user.role === 'admin';
    const settingsMenu = byId('settings-menu');
    if (settingsMenu) settingsMenu.hidden = !admin;
    document.querySelectorAll('.admin-settings-entry, .admin-settings-divider').forEach(element => {
      element.hidden = !admin;
    });
    if (!admin) {
      ['frame-account-management', 'frame-api-settings', 'frame-available-model-management', 'frame-comfyui-settings'].forEach(id => {
        byId(id)?.removeAttribute('data-src');
      });
    }
  }

  function renderAccount(user) {
    currentUser = user;
    window.__IC_USER = user;
    const menu = byId('account-menu');
    const name = byId('account-trigger-name');
    const role = byId('account-trigger-role');
    const trigger = byId('account-menu-trigger');
    window.InfiniteCanvasAccountAvatar?.apply?.(
      byId('account-trigger-avatar'),
      user,
    );
    if (name) name.textContent = user.display_name || user.username;
    if (role) role.textContent = roleLabel(user);
    if (trigger) trigger.setAttribute('aria-label', `${user.display_name || user.username} · ${roleLabel(user)}`);
    if (menu) menu.hidden = false;
    applyRoleGate(user);
    window.initializeStudioForUser?.(user);
    window.dispatchEvent(new CustomEvent('studio-user-ready', {detail: {user}}));
  }

  async function logout() {
    const action = byId('account-logout');
    action?.setAttribute('disabled', '');
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    window.location.replace('/login');
  }

  byId('account-logout')?.addEventListener('ic-select', logout);
  window.addEventListener('studio-lang-change', () => {
    if (!currentUser) return;
    const role = byId('account-trigger-role');
    const trigger = byId('account-menu-trigger');
    if (role) role.textContent = roleLabel(currentUser);
    if (trigger) trigger.setAttribute('aria-label', `${currentUser.display_name || currentUser.username} · ${roleLabel(currentUser)}`);
  });

  fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
    .then(response => {
      if (!response.ok) throw new Error('unauthorized');
      return response.json();
    })
    .then(payload => {
      if (!payload.user || payload.user.role === 'guest') throw new Error('unauthorized');
      renderAccount(payload.user);
    })
    .catch(() => window.location.replace('/login'));
})();
