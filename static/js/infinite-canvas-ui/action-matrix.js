(() => {
  const baseUrl = '/static/design-system/infinite-canvas-ui/action-case.html?v=2026.08.15.14';
  const status = document.querySelector('[data-actions-live-status]');
  const frames = [...document.querySelectorAll('[data-action-case]')];
  const readyCases = new Set();

  frames.forEach((frame, index) => {
    const card = frame.closest('[data-theme][data-viewport]');
    const caseId = `actions-${index}-${card.dataset.theme}-${card.dataset.viewport}`;
    const caseUrl = new URL(baseUrl, window.location.origin);
    frame.dataset.caseId = caseId;
    for (const [key, value] of new URLSearchParams({
      case: caseId,
      theme: card.dataset.theme,
      viewport: card.dataset.viewport,
      locale: card.dataset.locale,
      content: card.dataset.content,
      density: card.dataset.density,
      motion: card.dataset.motion,
    })) caseUrl.searchParams.set(key, value);
    frame.src = caseUrl.href;
  });

  window.addEventListener('message', event => {
    if (event.data?.type !== 'ic-action-case-ready') return;
    if (!frames.some(frame => frame.dataset.caseId === event.data.caseId)) return;
    if (event.data.legalCount !== 15 || event.data.contractStatus !== 'ready') {
      document.documentElement.dataset.actionMatrixStatus = 'failed';
      status.textContent = `${event.data.caseId} 未通过 Actions 合同`;
      return;
    }
    readyCases.add(event.data.caseId);
    status.textContent = `${readyCases.size}/${frames.length} 个实时情境已就绪`;
    if (readyCases.size === frames.length) {
      document.documentElement.dataset.actionMatrixStatus = 'ready';
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
  });
})();
