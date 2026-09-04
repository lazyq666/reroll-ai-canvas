(() => {
  const byId = id => document.getElementById(id);
  const tr = key => window.StudioI18n?.t?.(key) || key;
  const trf = (key, values) => window.StudioI18n?.format?.(key, values) || tr(key);
  const iconSources = {
    codex: '/static/images/providers/chatgpt.svg',
    jimeng: '/static/images/providers/jimeng.svg',
    'gemini-cli': '/static/images/providers/gemini.svg',
  };
  const secondaryStates = new Set(['uncomparable', 'check_failed']);
  let snapshot = null;
  let administrator = false;
  let automaticOpened = false;
  let pollTimer = 0;

  async function request(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      headers: options.body ? {'Content-Type': 'application/json', ...(options.headers || {})} : options.headers,
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
      const code = typeof payload.detail === 'object' ? payload.detail?.code : '';
      const message = code ? tr(`cliUpdates.error.${code}`) : (typeof payload.detail === 'string' ? payload.detail : tr('cliUpdates.error.action_failed'));
      const error = new Error(message);
      error.code = code;
      throw error;
    }
    return payload;
  }

  function notify(message, tone = 'neutral') {
    const text = String(message || '').trim();
    if (!text) return;
    customElements.whenDefined('ic-toast').then(() => customElements.get('ic-toast')?.notify(text, {tone}));
  }

  function hasAvailableUpdate(value = snapshot) {
    return (value?.items || []).some(item => item.update_available);
  }

  function displayItems(value = snapshot) {
    if (!hasAvailableUpdate(value)) return [];
    return (value?.items || []).filter(item => item.update_available || secondaryStates.has(item.state));
  }

  function renderItem(item) {
    const secondary = !item.update_available;
    const card = document.createElement('article');
    card.className = `cli-update-item ${secondary ? 'is-secondary' : 'is-update'}`;
    card.dataset.cliId = item.id;

    const icon = document.createElement('span');
    icon.className = 'cli-update-icon';
    const iconSource = iconSources[item.id];
    if (iconSource) {
      const image = document.createElement('img');
      image.src = iconSource;
      image.alt = '';
      icon.append(image);
    }
    card.append(icon);

    const head = document.createElement('div');
    head.className = 'cli-update-item-head';
    const title = document.createElement('h3');
    title.className = 'cli-update-item-title';
    title.textContent = item.display_name || item.id;
    const state = document.createElement('span');
    state.className = `cli-update-state ${secondary ? 'is-secondary' : 'is-update'}`;
    state.textContent = tr(item.update_available
      ? 'cliUpdates.available'
      : (item.state === 'check_failed' ? 'cliUpdates.checkFailed' : 'cliUpdates.uncomparable'));
    head.append(title, state);
    card.append(head);

    if (item.local_version || item.local_display_version || item.raw_version || item.available_version) {
      const local = item.local_display_version || item.local_version || item.raw_version || '—';
      const available = item.available_version || '—';
      const incomparable = item.state === 'uncomparable';
      const failed = item.state === 'check_failed';
      const labels = [
        [incomparable ? 'cliUpdates.localBuild' : 'cliUpdates.local', local],
        [incomparable ? 'cliUpdates.officialRelease' : (failed ? 'cliUpdates.official' : 'cliUpdates.latest'), available],
      ];
      const pair = document.createElement('div');
      pair.className = 'cli-update-version-pair';
      pair.setAttribute('aria-label', trf(incomparable ? 'cliUpdates.versionUncomparable' : 'cliUpdates.versionPair', {local, available}));
      labels.forEach(([labelKey, value], index) => {
        if (index) {
          const separator = document.createElement('span');
          separator.className = 'cli-update-version-separator';
          separator.setAttribute('aria-hidden', 'true');
          separator.textContent = incomparable || failed ? '/' : '→';
          pair.append(separator);
        }
        const side = document.createElement('span');
        side.className = 'cli-update-version-side';
        const caption = document.createElement('span');
        caption.className = 'cli-update-version-caption';
        caption.textContent = tr(labelKey);
        const version = document.createElement('strong');
        version.className = 'cli-update-version-value';
        version.textContent = value;
        side.append(caption, version);
        pair.append(side);
      });
      card.append(pair);
    }

    const detailText = item.update_available
      ? (item.release_notes || tr('cliUpdates.notesMissing'))
      : tr(item.state === 'check_failed'
        ? 'cliUpdates.checkFailedDetail'
        : (item.detail_key || 'cliUpdates.uncomparableDetail'));
    if (detailText) {
      const detail = document.createElement('p');
      detail.className = 'cli-update-item-detail';
      detail.textContent = detailText;
      card.append(detail);
    }

    const bottom = document.createElement('div');
    bottom.className = 'cli-update-item-bottom';
    const dates = [];
    if (item.local_build_time) {
      const buildTime = String(item.local_build_time).replace('T', ' ').replace(/Z$/, ' UTC');
      dates.push(trf('cliUpdates.localBuildDate', {date: buildTime}));
    }
    if (item.release_date) {
      dates.push(trf('cliUpdates.releaseDate', {date: item.release_date}));
    }
    if (dates.length) {
      const date = document.createElement('span');
      date.className = 'cli-update-item-date';
      date.textContent = dates.join(' · ');
      bottom.append(date);
    }
    if (item.source_url) {
      const source = document.createElement('a');
      source.href = item.source_url;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      source.textContent = tr('cliUpdates.source');
      source.setAttribute('aria-label', trf('cliUpdates.sourceAria', {name: item.display_name || item.id}));
      bottom.append(source);
    }
    if (bottom.childElementCount) card.append(bottom);
    return card;
  }

  function render() {
    const list = byId('cliUpdateList');
    const status = byId('cliUpdateStatus');
    if (!list || !status || !snapshot) return;
    list.replaceChildren(...displayItems().map(renderItem));
    status.textContent = snapshot.checking ? tr('cliUpdates.checking') : (hasAvailableUpdate() ? '' : tr('cliUpdates.noUpdates'));
  }

  async function acknowledgeNotifications() {
    const ids = (snapshot?.notification_items || []).map(item => item.id);
    if (!ids.length) return;
    try {
      snapshot = await request('/api/admin/cli-updates/dismiss', {
        method: 'POST', body: JSON.stringify({cli_ids: ids}),
      });
      render();
    } catch (_) {
      // The local automatic-open guard still prevents a duplicate prompt in this shell.
    }
  }

  async function openDialog(manual = false) {
    if (!administrator) return;
    await customElements.whenDefined('ic-dialog');
    if (!snapshot) snapshot = await request('/api/admin/cli-updates');
    render();
    const shouldOpen = manual ? hasAvailableUpdate() : Boolean((snapshot.notification_items || []).length);
    if (!shouldOpen) {
      if (manual && !snapshot.checking) notify(tr('cliUpdates.noUpdates'));
      return;
    }
    automaticOpened = automaticOpened || !manual;
    await byId('cliUpdateDialog')?.show?.();
  }

  async function checkNow() {
    const status = byId('cliUpdateStatus');
    if (status) status.textContent = tr('cliUpdates.checking');
    try {
      snapshot = await request('/api/admin/cli-updates/check', {method: 'POST'});
      render();
      await openDialog(true);
    } catch (error) {
      const message = error.message || tr('cliUpdates.checkFailed');
      if (status) status.textContent = message;
      notify(message, 'danger');
    }
  }

  async function initialize(user) {
    administrator = user?.role === 'admin';
    if (!administrator) return;
    try {
      snapshot = await request('/api/admin/cli-updates');
      render();
      if (snapshot.checking) {
        clearTimeout(pollTimer);
        pollTimer = setTimeout(() => initialize(user), 900);
      } else if (!automaticOpened && (snapshot.notification_items || []).length) {
        await openDialog();
      }
    } catch (_) {}
  }

  byId('cliUpdateDialog')?.addEventListener('ic-after-hide', () => void acknowledgeNotifications());
  window.CliUpdates = {checkNow};
  window.addEventListener('studio-user-ready', event => initialize(event.detail?.user));
  window.addEventListener('studio-lang-change', render);
  window.addEventListener('message', event => {
    if (event.origin && event.origin !== window.location.origin) return;
    if (event.data?.type === 'cli-update-check') void checkNow();
  });
  if (window.__IC_USER) void initialize(window.__IC_USER);
})();
