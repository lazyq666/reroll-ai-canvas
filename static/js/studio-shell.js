(() => {
  const ACTIVE_PAGE_KEY = 'studio_active_page';
  const CANVAS_ROUTE_KEY = 'studio_canvas_route';
  const LOCAL_NAV_COLLAPSED_KEY = 'studio_local_nav_collapsed';
  const SIDEBAR_PINNED_KEY = 'studio_sidebar_pinned';
  const DEFAULT_PAGE_ID = 'canvas';
  const PAGE_IDS = ['zimage', 'enhance', 'klein', 'angle', 'online', 'canvas', 'account-management', 'api-settings', 'available-model-management', 'comfyui-settings'];
  const LOCAL_PAGE_IDS = ['zimage', 'enhance', 'klein', 'angle'];
  const SETTINGS_PAGE_IDS = ['account-management', 'api-settings', 'available-model-management', 'comfyui-settings'];
  const CANVAS_EDITOR_PATHS = new Set(['/static/canvas.html', '/static/smart-canvas.html']);

  const tr = key => window.StudioI18n?.t?.(key) || key;
  const byId = id => document.getElementById(id);

  function normalizeCanvasFrameRoute(value) {
    try {
      const url = new URL(String(value || ''), window.location.origin);
      if (url.origin !== window.location.origin) return '';
      if (!CANVAS_EDITOR_PATHS.has(url.pathname) || !url.searchParams.get('id')) return '';
      return `${url.pathname}${url.search}${url.hash}`;
    } catch (_) {
      return '';
    }
  }

  function rememberCanvasFrameRoute(frame) {
    try {
      const href = frame?.contentWindow?.location?.href || '';
      if (!href || href === 'about:blank') return;
      const route = normalizeCanvasFrameRoute(href);
      if (route) {
        sessionStorage.setItem(CANVAS_ROUTE_KEY, route);
        return;
      }
      const url = new URL(href, window.location.origin);
      if (url.origin === window.location.origin && url.pathname === '/static/canvas-list.html') {
        sessionStorage.removeItem(CANVAS_ROUTE_KEY);
      }
    } catch (_) {}
  }

  function restoreCanvasFrameRoute() {
    const frame = byId('frame-canvas');
    if (!frame) return;
    try {
      const route = normalizeCanvasFrameRoute(sessionStorage.getItem(CANVAS_ROUTE_KEY));
      if (route) frame.dataset.src = route;
      else sessionStorage.removeItem(CANVAS_ROUTE_KEY);
    } catch (_) {}
  }

  function syncCanvasEditorShellState() {
    const frame = byId('frame-canvas');
    const appShell = document.querySelector('.app-shell');
    if (!frame || !appShell) return;
    let route = '';
    let hasLiveLocation = false;
    try {
      const href = frame.contentWindow?.location?.href;
      if (href && href !== 'about:blank') {
        hasLiveLocation = true;
        route = normalizeCanvasFrameRoute(href);
      }
    } catch (_) {}
    if (!hasLiveLocation) route = normalizeCanvasFrameRoute(frame.getAttribute('src') || frame.dataset.src);
    const editorActive = frame.classList.contains('active') && Boolean(route);
    appShell.classList.toggle('is-canvas-editor', editorActive);
    appShell.toggleAttribute('data-canvas-editor-active', editorActive);
    if (editorActive) {
      hideSidebarTooltip('canvas-editor');
      closeShellMenus();
    }
  }

  function syncThemeToFrame(frame) {
    const theme = window.StudioTheme?.get?.() || 'light';
    try { frame?.contentWindow?.postMessage({ type: 'studio-theme', theme }, '*'); } catch (_) {}
  }

  function syncLanguageToFrame(frame) {
    if (!window.StudioI18n) return;
    try { frame?.contentWindow?.postMessage({ type: 'studio-lang', lang: window.StudioI18n.lang() }, '*'); } catch (_) {}
  }

  function syncScaleToFrame(frame) {
    const mode = window.StudioScale?.getMode?.() || 'auto';
    const cssScale = Number(getComputedStyle(document.documentElement).getPropertyValue('--studio-ui-scale'));
    const scale = Number.isFinite(cssScale) && cssScale > 0 ? cssScale : (window.StudioScale?.getScale?.() || 1);
    try { frame?.contentWindow?.postMessage({ type: 'studio-ui-scale', mode, scale }, '*'); } catch (_) {}
  }

  function pauseScaleInFrames(duration = 650) {
    document.querySelectorAll('.stage iframe').forEach(frame => {
      try { frame.contentWindow?.postMessage({ type: 'studio-ui-scale-pause', duration }, '*'); } catch (_) {}
    });
  }

  function closeShellMenus() {
    for (const id of ['settings-menu', 'account-menu']) {
      const menu = byId(id);
      if (menu?.hasAttribute('open')) menu.hide('navigation');
    }
  }

  function updateCollapsedNavigationTooltips(pinned) {
    if (pinned) byId('sidebar-tooltip')?.hide('sidebar-expanded');
  }

  function sidebarTooltipLabel(item) {
    const sidebar = byId('studioSidebar');
    if (item?.hasAttribute('data-sidebar-tooltip')) {
      return tr(sidebar?.classList.contains('is-pinned') ? 'common.collapseNavigation' : 'common.expandNavigation');
    }
    if (item?.dataset.collapsedTooltipKey && !sidebar?.classList.contains('is-pinned')) {
      return tr(item.dataset.collapsedTooltipKey);
    }
    return '';
  }

  function sidebarTooltipAnchor(item) {
    return item?.shadowRoot?.querySelector('[part~="base"], a, button') || item;
  }

  function showSidebarTooltip(item) {
    const tooltip = byId('sidebar-tooltip');
    const label = sidebarTooltipLabel(item);
    if (!tooltip || !label) return;
    tooltip.setAttribute('content', label);
    tooltip.show(sidebarTooltipAnchor(item));
  }

  function hideSidebarTooltip(reason = 'pointerleave') {
    byId('sidebar-tooltip')?.hide(reason);
  }

  function setSidebarPinned(pinned, options = {}) {
    const sidebar = byId('studioSidebar');
    const trigger = byId('sidebarLogoToggle');
    if (!sidebar) return;
    pauseScaleInFrames();
    sidebar.classList.toggle('is-pinned', pinned);
    document.querySelectorAll('.global-navigation > ic-nav-item').forEach(item => {
      item.toggleAttribute('compact', !pinned);
    });
    byId('local-nav-disclosure')?.toggleAttribute('compact', !pinned);
    trigger?.setAttribute('aria-pressed', String(pinned));
    if (trigger) {
      const label = tr(pinned ? 'common.collapseNavigation' : 'common.expandNavigation');
      trigger.setAttribute('aria-label', label);
    }
    updateCollapsedNavigationTooltips(pinned);
    if (!options.skipRemember) localStorage.setItem(SIDEBAR_PINNED_KEY, pinned ? '1' : '0');
    closeShellMenus();
  }

  function setLocalNavCollapsed(collapsed, options = {}) {
    byId('local-nav-disclosure')?.toggleAttribute('open', !collapsed);
    if (!options.skipRemember) localStorage.setItem(LOCAL_NAV_COLLAPSED_KEY, collapsed ? '1' : '0');
  }

  function updateCurrentNavigation(id) {
    document.querySelectorAll('ic-nav-item[data-page]').forEach(item => {
      if (item.dataset.page === id) item.setAttribute('current', 'page');
      else item.removeAttribute('current');
    });
  }

  function switchUI(_trigger, requestedId, options = {}) {
    const role = window.__IC_USER?.role || '';
    let id = PAGE_IDS.includes(requestedId) ? requestedId : DEFAULT_PAGE_ID;
    if (SETTINGS_PAGE_IDS.includes(id) && role !== 'admin') id = 'canvas';

    const target = byId(`frame-${id}`);
    if (!target) return;
    document.querySelectorAll('.stage iframe').forEach(frame => frame.classList.toggle('active', frame === target));
    if (!target.src) target.src = target.dataset.src;
    syncCanvasEditorShellState();
    updateCurrentNavigation(id);
    if (!options.skipRemember) localStorage.setItem(ACTIVE_PAGE_KEY, id);

    if (LOCAL_PAGE_IDS.includes(id)) setLocalNavCollapsed(false, { skipRemember: true });
    else setLocalNavCollapsed(localStorage.getItem(LOCAL_NAV_COLLAPSED_KEY) !== '0', { skipRemember: true });

    closeShellMenus();
    syncThemeToFrame(target);
    syncLanguageToFrame(target);
    syncScaleToFrame(target);
    if (id === 'canvas' && target.src) {
      try { target.contentWindow?.postMessage({ type: 'canvas-focus' }, '*'); } catch (_) {}
    }
  }

  function restoreActivePage(user) {
    restoreCanvasFrameRoute();
    setSidebarPinned(localStorage.getItem(SIDEBAR_PINNED_KEY) === '1', { skipRemember: true });
    const saved = localStorage.getItem(ACTIVE_PAGE_KEY);
    const permitted = user?.role === 'admin' || !SETTINGS_PAGE_IDS.includes(saved);
    const id = PAGE_IDS.includes(saved) && permitted ? saved : (permitted ? DEFAULT_PAGE_ID : 'canvas');
    setLocalNavCollapsed(localStorage.getItem(LOCAL_NAV_COLLAPSED_KEY) !== '0', { skipRemember: true });
    switchUI(null, id, { skipRemember: true });
    document.documentElement.classList.remove('studio-route-booting');
  }

  function toggleMenu(menu, trigger) {
    if (!menu || !trigger) return;
    if (menu.hasAttribute('open')) menu.hide('trigger');
    else {
      closeShellMenus();
      menu.show(trigger);
    }
  }

  function updateThemeControl(theme) {
    const dark = theme === 'dark';
    const button = byId('theme-toggle-btn');
    if (!button) return;
    button.setAttribute('icon', dark ? 'light' : 'theme');
    button.setAttribute('label', tr(dark ? 'common.lightMode' : 'common.darkMode'));
  }

  function toggleTheme() {
    const current = window.StudioTheme?.get?.() || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    window.StudioTheme?.set?.(next);
    document.querySelectorAll('.stage iframe').forEach(syncThemeToFrame);
    updateThemeControl(next);
  }

  function updateLanguageControl() {
    const isEnglish = window.StudioI18n?.lang?.() === 'en';
    const button = byId('lang-toggle-btn');
    if (button) button.setAttribute('label', tr(isEnglish ? 'common.switchToChinese' : 'common.switchToEnglish'));
    const settings = byId('settings-menu');
    if (settings) settings.setAttribute('label', tr('common.settingsMenu'));
    const account = byId('account-menu');
    if (account) account.setAttribute('label', tr('common.account'));
    const logo = byId('sidebarLogoToggle');
    if (logo) {
      const pinned = byId('studioSidebar')?.classList.contains('is-pinned');
      const label = tr(pinned ? 'common.collapseNavigation' : 'common.expandNavigation');
      logo.setAttribute('aria-label', label);
    }
    updateCollapsedNavigationTooltips(byId('studioSidebar')?.classList.contains('is-pinned'));
  }

  function toggleLanguage() {
    window.StudioI18n?.toggle?.();
    document.querySelectorAll('.stage iframe').forEach(syncLanguageToFrame);
    updateLanguageControl();
  }

  function forwardStudioApiChange(data) {
    if (!data || !['providers-changed', 'models-changed', 'workflows-changed', 'comfy-instances-changed'].includes(data.type)) return;
    document.querySelectorAll('.stage iframe').forEach(frame => {
      try { frame.contentWindow?.postMessage(data, '*'); } catch (_) {}
    });
  }

  function bindFrame(frame) {
    frame.addEventListener('load', () => {
      if (frame.id === 'frame-canvas') rememberCanvasFrameRoute(frame);
      syncCanvasEditorShellState();
      syncThemeToFrame(frame);
      syncLanguageToFrame(frame);
      syncScaleToFrame(frame);
      try { frame.contentDocument?.addEventListener('pointerdown', closeShellMenus, true); } catch (_) {}
    });
  }

  function bindShell() {
    window.addEventListener('studio-entry-motion-dock', () => {
      setSidebarPinned(true, { skipRemember: true });
    });
    byId('sidebarLogoToggle')?.addEventListener('click', () => {
      setSidebarPinned(!byId('studioSidebar')?.classList.contains('is-pinned'));
    });
    document.querySelectorAll('[data-sidebar-tooltip], [data-collapsed-tooltip-key]').forEach(item => {
      item.addEventListener('pointerenter', () => showSidebarTooltip(item));
      item.addEventListener('pointerleave', () => hideSidebarTooltip('pointerleave'));
      item.addEventListener('focusin', () => showSidebarTooltip(item));
      item.addEventListener('focusout', () => hideSidebarTooltip('focusout'));
    });
    byId('local-nav-disclosure')?.addEventListener('ic-toggle', event => {
      const sidebar = byId('studioSidebar');
      if (!sidebar?.classList.contains('is-pinned')) {
        setSidebarPinned(true);
        setLocalNavCollapsed(false);
        return;
      }
      setLocalNavCollapsed(!event.detail.open);
    });
    document.querySelectorAll('ic-nav-item[data-page]').forEach(item => {
      item.addEventListener('click', event => {
        event.preventDefault();
        switchUI(item, item.dataset.page);
      });
    });
    const settingsMenu = byId('settings-menu');
    const settingsTrigger = byId('settings-fold-toggle');
    settingsTrigger?.addEventListener('click', () => toggleMenu(settingsMenu, settingsTrigger));
    const accountMenu = byId('account-menu');
    const accountTrigger = byId('account-menu-trigger');
    accountTrigger?.addEventListener('click', () => toggleMenu(accountMenu, accountTrigger));
    byId('lang-toggle-btn')?.addEventListener('click', toggleLanguage);
    byId('theme-toggle-btn')?.addEventListener('click', toggleTheme);
    byId('studioSidebar')?.addEventListener('pointerenter', () => pauseScaleInFrames());
    document.querySelectorAll('.stage iframe').forEach(bindFrame);
    window.addEventListener('message', event => {
      if (event.origin && event.origin !== location.origin) return;
      forwardStudioApiChange(event.data);
    });
    window.addEventListener('studio-theme-change', event => updateThemeControl(event.detail.theme));
    window.addEventListener('studio-lang-change', updateLanguageControl);
    window.addEventListener('studio-ui-scale-change', () => document.querySelectorAll('.stage iframe').forEach(syncScaleToFrame));
    try {
      const channel = new BroadcastChannel('studio-api');
      channel.onmessage = event => forwardStudioApiChange(event.data);
    } catch (_) {}
    updateThemeControl(window.StudioTheme?.get?.() || 'light');
    updateLanguageControl();
  }

  window.switchUI = switchUI;
  window.initializeStudioForUser = restoreActivePage;
  window.closeShellMenus = closeShellMenus;

  document.addEventListener('DOMContentLoaded', bindShell, { once: true });
})();
