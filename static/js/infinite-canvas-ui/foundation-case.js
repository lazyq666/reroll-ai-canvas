const params = new URLSearchParams(window.location.search);
const densities = ['medium', 'small', 'large'];
const themes = ['light', 'dark'];
const motions = ['standard', 'reduced'];
const density = densities.includes(params.get('density')) ? params.get('density') : 'medium';
const theme = themes.includes(params.get('theme')) ? params.get('theme') : 'light';
const motion = motions.includes(params.get('motion')) ? params.get('motion') : 'standard';
const detail = params.get('detail') === 'compact' ? 'compact' : 'full';
const caseId = params.get('case') || `${density}-${theme}-${motion}`;
const labels = {
  medium: ['Medium', '--ui-control-height-m'],
  small: ['Small', '--ui-control-height-s'],
  large: ['Large', '--ui-control-height-l'],
};

document.documentElement.dataset.uiDensity = density;
document.documentElement.dataset.uiTheme = theme;
document.documentElement.dataset.uiMotion = motion;
document.body.dataset.density = density;
document.body.dataset.theme = theme;
document.body.dataset.motion = motion;
document.body.dataset.detail = detail;
document.querySelector('[data-density-title]').textContent = labels[density][0];
document.querySelector('[data-density-token]').textContent = labels[density][1];

await Promise.all([
  customElements.whenDefined('ic-button'),
  customElements.whenDefined('ic-input'),
  customElements.whenDefined('ic-icon'),
]);
await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
document.querySelector('[data-focus-sample]').focus();
document.documentElement.dataset.foundationCaseStatus = 'ready';
document.querySelector('[data-case-status]').textContent = `${labels[density][0]} · ${theme} · ${motion} ready`;
window.parent.postMessage({
  type: 'ic-foundation-case-ready',
  caseId,
  density,
  theme,
  motion,
  height: document.documentElement.scrollHeight,
}, '*');
