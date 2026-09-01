(() => {
  const baseUrl = '/static/design-system/infinite-canvas-ui/heading-case.html?v=2026.08.14.1';
  const status = document.querySelector('[data-heading-live-status]');
  const frames = [...document.querySelectorAll('[data-heading-case]')];
  const readyCases = new Set();

  document.querySelectorAll('[data-heading-token-metrics]').forEach(metrics => {
    const sample = metrics.closest('.heading-token-row')?.querySelector('.heading-token-sample');
    if (!sample) return;
    const style = getComputedStyle(sample);
    const weightName = style.fontWeight === '700' ? 'Bold' : style.fontWeight === '500' ? 'Medium' : 'Regular';
    metrics.textContent = `${style.fontSize} · ${weightName} · 行高 ${style.lineHeight}`;
  });

  frames.forEach((frame, index) => {
    const card = frame.closest('[data-theme][data-viewport]');
    const caseId = `heading-${index}-${card.dataset.theme}-${card.dataset.viewport}`;
    const caseUrl = new URL(baseUrl, window.location.origin);
    frame.dataset.caseId = caseId;
    for (const [key, value] of Object.entries({
      case: caseId,
      theme: card.dataset.theme,
      viewport: card.dataset.viewport,
      locale: card.dataset.locale,
      content: card.dataset.content,
    })) caseUrl.searchParams.set(key, value);
    frame.src = caseUrl.href;
  });

  window.addEventListener('message', event => {
    if (event.data?.type !== 'ic-heading-case-ready') return;
    if (!frames.some(frame => frame.dataset.caseId === event.data.caseId)) return;
    if (event.data.legalCount !== 6 || event.data.contractStatus !== 'ready') {
      document.documentElement.dataset.headingMatrixStatus = 'failed';
      status.textContent = `${event.data.caseId} 未通过 Heading 合同`;
      return;
    }
    readyCases.add(event.data.caseId);
    status.textContent = `${readyCases.size}/${frames.length} 个实时情境已就绪`;
    if (readyCases.size === frames.length) {
      document.documentElement.dataset.headingMatrixStatus = 'ready';
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
  });
})();
