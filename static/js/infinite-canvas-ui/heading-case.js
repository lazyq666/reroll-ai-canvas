const params = new URLSearchParams(window.location.search);
const allowed = {
  theme: ['light', 'dark'],
  viewport: ['desktop', 'narrow'],
  locale: ['zh-CN', 'en'],
  content: ['normal', 'long'],
};
const context = Object.fromEntries(Object.entries(allowed).map(([key, values]) => [
  key,
  values.includes(params.get(key)) ? params.get(key) : values[0],
]));
const caseId = params.get('case') || 'heading-case';

document.documentElement.lang = context.locale;
document.documentElement.dataset.uiTheme = context.theme;
document.documentElement.classList.toggle('theme-dark', context.theme === 'dark');
document.body.dataset.viewport = context.viewport;
document.body.dataset.content = context.content;
document.body.dataset.locale = context.locale;

const [contract] = await Promise.all([
  fetch('/static/design-system/infinite-canvas-ui/ic-heading-v1.json').then(response => {
    if (!response.ok) throw new Error(`Heading contract failed: HTTP ${response.status}`);
    return response.json();
  }),
  import('/static/js/infinite-canvas-ui/core.js?v=ic-ui-c087c3d218de'),
]);
await customElements.whenDefined('ic-heading');

const copy = {
  'zh-CN': {
    normal: {
      titles: ['工作区概览', '生成设置', '输出格式'],
      subtitles: ['查看当前工作区的关键状态', '配置本次任务使用的模型和参数', '选择文件类型与导出质量'],
    },
    long: {
      titles: ['查看当前工作区内全部正在生成与等待处理的任务', '配置本次批量生成使用的模型、画布比例与输出数量', '选择最终导出文件的格式、质量以及命名方式'],
      subtitles: ['这段较长的副标题用于确认窄视口下会自然换行，并与主标题保持清晰的视觉层级。', '更改只会影响本次尚未提交的生成任务，不会覆盖已经完成的历史记录。', '导出前可以继续调整这些选项，系统会保留当前工作区中的原始素材。'],
    },
  },
  en: {
    normal: {
      titles: ['Workspace overview', 'Generation settings', 'Output format'],
      subtitles: ['Review the key status of this workspace', 'Configure the model and parameters for this run', 'Choose the file type and export quality'],
    },
    long: {
      titles: ['Review every active and queued generation task in this workspace', 'Configure models, canvas ratios, and output counts for this batch', 'Choose the final export format, quality, and naming convention'],
      subtitles: ['This deliberately long subtitle verifies natural wrapping in a narrow viewport while preserving a clear relationship with the title.', 'Changes only apply to unsubmitted generation tasks and do not overwrite completed history.', 'You can keep adjusting these options before export while the workspace preserves every original source asset.'],
    },
  },
};

const content = copy[context.locale][context.content];
const host = document.querySelector('[data-heading-combinations]');
const component = contract.components[0];
const headingInstances = [];

for (const combination of component.legalCombinations) {
  const levelIndex = Number(combination.level) - 1;
  const sample = document.createElement('article');
  sample.className = 'heading-combination';
  sample.dataset.legalCombination = combination.id;

  const heading = document.createElement('ic-heading');
  heading.level = combination.level;
  heading.textContent = content.titles[levelIndex];
  if (combination.subtitle) heading.subtitle = content.subtitles[levelIndex];
  headingInstances.push(heading);

  sample.append(heading);
  host.append(sample);
}

await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

const headings = headingInstances;
const contractReady = (
  headings.length === component.legalCombinations.length
  && headings.every(heading => heading.dataset.icContractStatus === 'ready')
);
document.querySelector('[data-heading-legal-count]').textContent = `${headings.length}/6`;
document.querySelector('[data-heading-case-message]').textContent = contractReady
  ? `${caseId} ready`
  : `${caseId} failed`;
document.documentElement.dataset.headingCaseStatus = contractReady ? 'ready' : 'failed';
window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
window.parent.postMessage({
  type: 'ic-heading-case-ready',
  caseId,
  legalCount: headings.length,
  contractStatus: contractReady ? 'ready' : 'failed',
  context,
}, '*');
