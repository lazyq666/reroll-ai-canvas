const cases = [...document.querySelectorAll('[data-feedback-progress-case]')];
const status = document.querySelector('[data-feedback-progress-status]');

for (const card of cases) {
  const query = new URLSearchParams({
    v: '2026.08.27.13',
    theme: card.dataset.theme,
    viewport: card.dataset.viewport,
    locale: card.dataset.locale,
    content: card.dataset.content,
    motion: card.dataset.motion,
  });
  card.querySelector('iframe').src = `/static/design-system/infinite-canvas-ui/feedback-progress-case.html?${query}`;
}

await Promise.all(cases.map(card => new Promise(resolve => card.querySelector('iframe').addEventListener('load', resolve, { once: true }))));
await Promise.all(cases.map(card => new Promise((resolve, reject) => {
  const frame = card.querySelector('iframe');
  const deadline = performance.now() + 15000;
  const inspect = () => {
    const value = frame.contentDocument?.documentElement.dataset.feedbackProgressCaseStatus;
    if (value === 'ready' || value === 'failed') return resolve();
    if (performance.now() >= deadline) return reject(new Error('Feedback and Progress case timed out'));
    requestAnimationFrame(inspect);
  };
  inspect();
})));
const ready = cases.every(card => card.querySelector('iframe').contentDocument?.documentElement.dataset.feedbackProgressCaseStatus === 'ready');
status.textContent = ready ? '6/6 个实时情境已载入' : '部分情境载入失败';
document.documentElement.dataset.feedbackProgressMatrixStatus = ready ? 'ready' : 'failed';
