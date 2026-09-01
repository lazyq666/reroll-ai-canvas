(() => {
  const protocol = window.UiComponentSandboxProtocol;
  const adapters = window.UiComponentFixtureAdapters;
  const fixtureRoot = document.getElementById('fixture-root');
  let activeCandidateId = '';
  let activeAdapter = null;
  let activeRoot = null;

  function post(type, payload = {}) {
    window.parent.postMessage(protocol.message(type, {
      candidateId: activeCandidateId,
      ...payload,
    }), '*');
  }

  protocol.installSandboxBoundary(window, (effect) => post('sandbox-effect', { effect }));

  function clearContext() {
    document.querySelectorAll('[data-fixture-context]').forEach((node) => node.remove());
    for (const attribute of [...document.documentElement.attributes]) {
      if (attribute.name.startsWith('data-ui-') || attribute.name === 'class') {
        document.documentElement.removeAttribute(attribute.name);
      }
    }
    for (const attribute of [...document.body.attributes]) {
      if (attribute.name.startsWith('data-ui-') || attribute.name === 'class') {
        document.body.removeAttribute(attribute.name);
      }
    }
  }

  function applyAttributes(element, attributes = {}) {
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  }

  function loadStylesheets(stylesheets) {
    return Promise.all((stylesheets || []).map((href) => new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.fixtureContext = 'true';
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', () => reject(new Error(`样式加载失败：${href}`)), { once: true });
      document.head.appendChild(link);
    })));
  }

  function loadInlineStyles(styles) {
    for (const css of styles || []) {
      const style = document.createElement('style');
      style.dataset.fixtureContext = 'true';
      style.textContent = css;
      document.head.appendChild(style);
    }
  }

  function flattenVisualContext(root) {
    let element = root.parentElement;
    while (element && element !== fixtureRoot) {
      if (!element.classList.contains('live-fixture-stage')) {
        element.dataset.liveFixtureContextWrapper = '';
        element.style.setProperty('display', 'contents', 'important');
      }
      element = element.parentElement;
    }
    const bounds = root.getBoundingClientRect();
    if (bounds.width === 0 && bounds.height > 0) {
      root.dataset.liveFixtureWidthFallback = '';
      root.style.setProperty('width', 'min(240px, calc(100vw - 16px))');
    }
  }

  async function initialise(candidate, context = {}) {
    if (!candidate?.fixture) throw new Error('候选没有注册 Live Fixture');
    activeCandidateId = candidate.id;
    activeAdapter = null;
    activeRoot = null;
    clearContext();
    applyAttributes(document.documentElement, context.htmlAttributes);
    applyAttributes(document.body, context.bodyAttributes);
    await loadStylesheets([
      ...(context.stylesheets || []),
      ...(candidate.fixture.stylesheets || []),
    ].filter((value, index, all) => all.indexOf(value) === index));
    loadInlineStyles(context.inlineStyles);
    fixtureRoot.innerHTML = candidate.fixture.markup;
    window.lucide?.createIcons?.({ attrs: { 'aria-hidden': 'true' } });
    const root = document.querySelector(candidate.fixture.rootSelector);
    if (!root) throw new Error(`Fixture 根节点不存在：${candidate.fixture.rootSelector}`);
    activeAdapter = adapters.create(candidate.fixture.adapter, document, (event) => {
      post(event.type || 'state-changed', {
        state: event.state || null,
        demoData: event.demoData === true,
      });
    }, window, candidate);
    activeRoot = root;
    flattenVisualContext(root);
    const reportReady = (afterTransition = false) => {
      const bounds = root.getBoundingClientRect();
      if (!afterTransition && (bounds.width === 0 || bounds.height === 0)) {
        window.setTimeout(() => requestAnimationFrame(() => reportReady(true)), 420);
        return;
      }
      const path = [];
      let element = root;
      while (element && element.id !== 'fixture-root' && path.length < 5) {
        const rect = element.getBoundingClientRect();
        path.push({
          tag: element.tagName.toLowerCase(),
          id: element.id || '',
          classes: element.className || '',
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          style: element.getAttribute('style') || '',
          offsetWidth: element.offsetWidth,
          offsetHeight: element.offsetHeight,
        });
        element = element.parentElement;
      }
      post('fixture-ready', {
        trust: candidate.trust,
        state: activeAdapter.getState(),
        rendered: bounds.width > 0 && bounds.height > 0,
        diagnostics: path,
      });
    };
    requestAnimationFrame(() => reportReady(false));
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window.parent || !protocol.isMessage(event.data)) return;
    try {
      if (event.data.type === 'initialise') {
        await initialise(event.data.candidate, event.data.context);
        return;
      }
      if (!activeAdapter) throw new Error('Live Fixture 尚未初始化');
      if (event.data.type === 'set-state') activeAdapter.setState(event.data.state || {});
      else if (event.data.type === 'reset') activeAdapter.reset();
      if (activeRoot) flattenVisualContext(activeRoot);
    } catch (error) {
      post('fixture-error', { message: String(error?.message || error), recoverable: true });
    }
  });

  window.addEventListener('error', (event) => {
    post('fixture-error', { message: String(event.error?.message || event.message || '未知脚本错误'), recoverable: true });
  });
  window.addEventListener('unhandledrejection', (event) => {
    post('fixture-error', { message: String(event.reason?.message || event.reason || '未处理的异步错误'), recoverable: true });
  });

  post('sandbox-ready');
})();
