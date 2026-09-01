(() => {
  const baseUrl = '/static/design-system/infinite-canvas-ui/foundation-case.html?v=2026.08.14.theme-refactor.1';
  const motionSelect = document.querySelector('[data-motion-mode]');
  const status = document.querySelector('[data-foundations-status]');
  const frames = [...document.querySelectorAll('[data-foundation-case]')];
  const readyCases = new Set();

  function loadCases() {
    readyCases.clear();
    frames.forEach((frame, index) => {
      const card = frame.closest('[data-density][data-theme]');
      const caseId = `${card.dataset.density}-${card.dataset.theme}-${motionSelect.value}-${index}`;
      const caseUrl = new URL(baseUrl, window.location.origin);
      frame.dataset.caseId = caseId;
      for (const [key, value] of new URLSearchParams({
        density: card.dataset.density,
        theme: card.dataset.theme,
        motion: motionSelect.value,
        detail: card.dataset.detail || 'compact',
        case: caseId,
      })) caseUrl.searchParams.set(key, value);
      frame.src = caseUrl.href;
    });
    status.textContent = `正在启动 ${frames.length} 个实时情境…`;
    document.documentElement.dataset.foundationsMatrixStatus = 'loading';
  }

  function refreshStatus() {
    status.textContent = `${readyCases.size}/${frames.length} 个实时情境已就绪`;
    if (readyCases.size === frames.length) {
      document.documentElement.dataset.foundationsMatrixStatus = 'ready';
    }
  }

  motionSelect.addEventListener('change', loadCases);
  window.addEventListener('message', event => {
    if (event.data?.type !== 'ic-foundation-case-ready') return;
    const frame = frames.find(item => item.dataset.caseId === event.data.caseId);
    if (!frame) return;
    if (Number.isFinite(event.data.height)) frame.style.height = `${Math.ceil(event.data.height)}px`;
    readyCases.add(event.data.caseId);
    refreshStatus();
  });
  loadCases();
})();
