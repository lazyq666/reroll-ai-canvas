(() => {
  const tr = (key) => window.StudioI18n?.t?.(key) || key;
  const tf = (key, values) => window.StudioI18n?.format?.(key, values) || tr(key);
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const authMode = document.getElementById('auth-mode');
  const registerTab = document.getElementById('register-tab');
  const loginSubmit = document.getElementById('login-submit');
  const registerSubmit = document.getElementById('register-submit');
  const loginError = document.getElementById('login-error');
  const registerError = document.getElementById('register-error');
  const registerSuccess = document.getElementById('register-success');
  const username = document.getElementById('username');
  const password = document.getElementById('password');
  const registerUsername = document.getElementById('register-username');
  const registerDisplayName = document.getElementById('register-display-name');
  const registerPassword = document.getElementById('register-password');
  const registerPasswordConfirm = document.getElementById('register-password-confirm');
  const rememberPassword = document.getElementById('remember-password');
  const rememberedLoginKey = 'infinite_canvas_remembered_login';

  const clearRememberedLogin = () => {
    try { localStorage.removeItem(rememberedLoginKey); } catch (_) {}
  };

  const loadRememberedLogin = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(rememberedLoginKey) || 'null');
      if (!saved || typeof saved.username !== 'string' || typeof saved.password !== 'string') return;
      username.value = saved.username;
      password.value = saved.password;
      rememberPassword.checked = true;
    } catch (_) {
      clearRememberedLogin();
    }
  };

  const saveRememberedLogin = () => {
    if (!rememberPassword.checked) {
      clearRememberedLogin();
      return;
    }
    try {
      localStorage.setItem(rememberedLoginKey, JSON.stringify({
        username: username.value.trim(),
        password: password.value,
      }));
    } catch (_) {}
  };

  const showMessage = (element, message) => {
    element.textContent = message || element.textContent;
    element.hidden = !message;
  };

  const setBusy = (button, busy) => {
    button.disabled = busy;
    button.loading = busy;
  };

  const applyTranslatedComponentLabels = () => {
    authMode.setAttribute('label', tr('auth.accountActions'));
    document.querySelector('.login-card').setAttribute('label', tr('auth.workspaceAccess'));
    document.getElementById('username-field').setAttribute('label', tr('auth.account'));
    document.getElementById('password-field').setAttribute('label', tr('auth.password'));
    document.getElementById('register-username-field').setAttribute('label', tr('auth.loginAccount'));
    document.getElementById('register-username-field').setAttribute('hint', tr('auth.usernameHelp'));
    document.getElementById('register-display-name-field').setAttribute('label', `${tr('auth.displayName')} · ${tr('auth.optional')}`);
    document.getElementById('register-password-field').setAttribute('label', tr('auth.password'));
    document.getElementById('register-password-confirm-field').setAttribute('label', tr('auth.confirmPassword'));
    rememberPassword.setAttribute('label', tr('auth.rememberPassword'));
    rememberPassword.setAttribute('hint', tr('auth.localOnly'));
  };

  const setMode = (mode) => {
    const registering = mode === 'register' && !registerTab.hidden;
    authMode.setAttribute('value', registering ? 'register' : 'login');
    loginForm.hidden = registering;
    registerForm.hidden = !registering;
    showMessage(loginError, '');
    showMessage(registerError, '');
    showMessage(registerSuccess, '');
    requestAnimationFrame(() => (registering ? registerUsername : username)?.focus());
  };

  authMode.addEventListener('ic-change', (event) => setMode(event.detail.value));
  rememberPassword.addEventListener('change', () => {
    if (!rememberPassword.checked) clearRememberedLogin();
  });
  window.addEventListener('studio-lang-change', applyTranslatedComponentLabels);
  applyTranslatedComponentLabels();

  Promise.all([
    customElements.whenDefined('ic-input'),
    customElements.whenDefined('ic-checkbox'),
    customElements.whenDefined('ic-button'),
  ]).then(loadRememberedLogin);

  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then((response) => response.ok ? response.json() : null)
    .then((data) => {
      if (data?.user && data.user.role !== 'guest') window.location.replace('/');
    })
    .catch(() => {});

  const refreshRegistrationStatus = () => fetch('/api/auth/registration', { credentials: 'omit', cache: 'no-store' })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error()))
    .then((status) => {
      registerTab.hidden = !status.enabled;
      if (!status.enabled) {
        setMode('login');
        return;
      }
      registerSubmit.disabled = status.remaining <= 0;
    })
    .catch(() => {
      registerTab.hidden = true;
      setMode('login');
    });
  refreshRegistrationStatus();

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(loginError, '');
    setBusy(loginSubmit, true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.value.trim(),
          password: password.value,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || tr('auth.loginFailed'));
      if (payload.user?.role === 'guest') {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        throw new Error(tr('auth.guestCannotEnter'));
      }
      saveRememberedLogin();
      window.location.replace('/');
    } catch (reason) {
      showMessage(loginError, reason.message || tr('auth.loginRetry'));
      setBusy(loginSubmit, false);
    }
  });

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(registerError, '');
    showMessage(registerSuccess, '');
    const nextPassword = registerPassword.value;
    if (nextPassword !== registerPasswordConfirm.value) {
      showMessage(registerError, tr('auth.passwordMismatch'));
      return;
    }
    setBusy(registerSubmit, true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: registerUsername.value.trim(),
          display_name: String(registerDisplayName.value || '').trim(),
          password: nextPassword,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || tr('auth.createFailed'));
      registerForm.reset();
      showMessage(registerSuccess, tf('auth.applicationSubmitted', { username: payload.application?.username || '' }));
      setBusy(registerSubmit, false);
      refreshRegistrationStatus();
    } catch (reason) {
      showMessage(registerError, reason.message || tr('auth.createRetry'));
      setBusy(registerSubmit, false);
    }
  });
})();
