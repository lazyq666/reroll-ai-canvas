(() => {
  // Shared by the studio and sign-in page: an unknown session is not a signed-out session.
  function start({ endpoint, ready, onAuthenticated, onUnauthenticated }) {
    const byId = id => document.getElementById(id);
    const status = byId('account-session-status');
    const content = byId('account-session-content');
    const loading = byId('account-session-loading');
    const error = byId('account-session-error');
    const message = byId('account-session-message');
    const retry = byId('account-session-retry');
    let checking = false;

    function showError(key) {
      document.documentElement.setAttribute('data-account-session', 'error');
      loading.hidden = true;
      status.setAttribute('aria-busy', 'false');
      message.setAttribute('data-i18n', key);
      message.textContent = window.StudioI18n.t(key);
      error.hidden = false;
      message.focus();
    }

    const retryDelays = [500, 1500];

    async function readSession() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(endpoint, {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        if (response.status === 401) return null;
        if (!response.ok) {
          throw Object.assign(new Error(`Session check failed: ${response.status}`), {
            retryable: response.status >= 500 || [408, 429].includes(response.status),
          });
        }
        const payload = await response.json();
        if (!payload?.user || !['admin', 'designer', 'guest'].includes(payload.user.role)) {
          throw Object.assign(new Error('Invalid session response'), { retryable: false });
        }
        return payload.user;
      } finally {
        clearTimeout(timeout);
      }
    }

    async function waitForReady() {
      if (!ready) return;
      let timeout;
      try {
        // Keep waiting separate from initialization: timed-out promises must not
        // initialize the studio later if a component finally finishes loading.
        await Promise.race([
          ready(),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Studio components did not become ready')), 10000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    }

    async function check() {
      if (checking) return;
      checking = true;
      document.documentElement.setAttribute('data-account-session', 'checking');
      content.hidden = true;
      status.hidden = false;
      status.setAttribute('aria-busy', 'true');
      loading.hidden = false;
      error.hidden = true;
      try {
        for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
          let failureKey = 'auth.sessionCheckFailed';
          try {
            const user = await readSession();
            failureKey = 'auth.studioLoadFailed';
            const authenticated = user && user.role !== 'guest';
            if (authenticated) await waitForReady();
            const reveal = await (authenticated ? onAuthenticated(user) : onUnauthenticated());
            if (reveal) {
              content.hidden = false;
              status.hidden = true;
              status.setAttribute('aria-busy', 'false');
              document.documentElement.setAttribute('data-account-session', 'ready');
            }
            return;
          } catch (cause) {
            if (cause.retryable === false || attempt === retryDelays.length) {
              console.warn('[account-session] Startup failed', failureKey, cause);
              showError(failureKey);
              return;
            }
            // Only read-only session checks and the idempotent initial render repeat.
            // Keep the same loading surface throughout recovery, without error flashes.
            await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
          }
        }
      } finally {
        checking = false;
      }
    }

    retry.addEventListener('click', check);
    check();
  }

  window.AccountSession = { start };
})();
