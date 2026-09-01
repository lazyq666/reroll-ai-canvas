(() => {
  const baseUrl = '/static/design-system/infinite-canvas-ui/tracer-case.html';
  const componentTabs = [...document.querySelectorAll('[data-component-tab]')];
  const modeButtons = [...document.querySelectorAll('[data-preview-mode]')];
  const filters = {
    theme: document.querySelector('[data-filter-theme]'),
    viewport: document.querySelector('[data-filter-viewport]'),
    content: document.querySelector('[data-filter-content]'),
  };
  const singlePreview = document.querySelector('[data-single-preview]');
  const comparePreview = document.querySelector('[data-compare-preview]');
  const previewControls = document.querySelector('[data-preview-controls]');
  const primaryFrame = document.querySelector('[data-primary-frame]');
  const primaryPreview = document.querySelector('[data-primary-preview]');
  const compareFrames = [...document.querySelectorAll('[data-compare-case]')];
  const currentContext = document.querySelector('[data-current-context]');
  const status = document.querySelector('[data-matrix-status]');
  const readyCases = new Set();
  let component = 'button';
  let mode = 'single';

  const labels = {
    button: 'Button', input: 'Input', dialog: 'Dialog',
    light: 'Light', dark: 'Dark', desktop: 'Desktop', narrow: 'Narrow',
    zh: '中文', en: 'English', long: '长内容',
  };

  function caseUrl(configuration, caseId) {
    const query = new URLSearchParams({ ...configuration, component, case: caseId });
    return `${baseUrl}?${query.toString()}`;
  }

  function loadCase(frame, configuration, caseId) {
    const nextUrl = caseUrl(configuration, caseId);
    if (frame.dataset.caseId === caseId && frame.getAttribute('src') === nextUrl) return;
    if (frame.dataset.caseId) readyCases.delete(frame.dataset.caseId);
    frame.dataset.caseId = caseId;
    frame.src = nextUrl;
  }

  function expectedCases() {
    return mode === 'single'
      ? [primaryPreview.dataset.caseId]
      : compareFrames.map((frame) => frame.dataset.caseId).filter(Boolean);
  }

  function refreshStatus() {
    const expected = expectedCases();
    const ready = expected.filter((caseId) => readyCases.has(caseId)).length;
    status.textContent = mode === 'single'
      ? (ready === 1 ? '实时预览已就绪' : '正在启动预览…')
      : `${ready}/${expected.length} 个比较情境已就绪`;
    document.documentElement.dataset.targetTracerStatus = ready === expected.length
      ? 'ready'
      : 'loading';
  }

  function refreshPrimary() {
    const configuration = Object.fromEntries(
      Object.entries(filters).map(([key, select]) => [key, select.value]),
    );
    const caseId = `single-${component}-${configuration.theme}-${configuration.viewport}-${configuration.content}`;
    loadCase(primaryPreview, configuration, caseId);
    primaryFrame.className = `target-case-frame ${configuration.viewport}`;
    primaryPreview.title = [
      labels[component], labels[configuration.theme], labels[configuration.viewport],
      labels[configuration.content], 'Target',
    ].join(' ');
    currentContext.textContent = [
      labels[component], labels[configuration.theme], labels[configuration.viewport],
      labels[configuration.content],
    ].join(' · ');
    refreshStatus();
  }

  function refreshCompare() {
    if (mode !== 'compare') return;
    compareFrames.forEach((frame, index) => {
      const card = frame.closest('.target-matrix-card');
      const configuration = {
        theme: card.dataset.theme,
        viewport: card.dataset.viewport,
        content: card.dataset.content,
      };
      loadCase(
        frame,
        configuration,
        `compare-${component}-${index}-${configuration.theme}-${configuration.viewport}-${configuration.content}`,
      );
    });
    refreshStatus();
  }

  function selectComponent(nextComponent) {
    component = nextComponent;
    componentTabs.forEach((tab) => {
      const selected = tab.dataset.componentTab === component;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    refreshPrimary();
    refreshCompare();
  }

  function selectMode(nextMode) {
    mode = nextMode;
    singlePreview.hidden = mode !== 'single';
    comparePreview.hidden = mode !== 'compare';
    previewControls.hidden = mode !== 'single';
    modeButtons.forEach((button) => {
      const selected = button.dataset.previewMode === mode;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    if (mode === 'compare') refreshCompare();
    else refreshPrimary();
    refreshStatus();
  }

  componentTabs.forEach((tab) => tab.addEventListener('click', () => {
    selectComponent(tab.dataset.componentTab);
  }));
  modeButtons.forEach((button) => button.addEventListener('click', () => {
    selectMode(button.dataset.previewMode);
  }));
  Object.values(filters).forEach((select) => select.addEventListener('change', refreshPrimary));
  window.addEventListener('message', (event) => {
    if (event.data?.type !== 'ic-target-tracer-ready') return;
    readyCases.add(event.data.caseId);
    refreshStatus();
  });
  refreshPrimary();
})();
