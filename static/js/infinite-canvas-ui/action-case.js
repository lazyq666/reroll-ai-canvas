const params = new URLSearchParams(window.location.search);
const allowed = {
  theme: ['light', 'dark'],
  viewport: ['desktop', 'narrow'],
  locale: ['zh-CN', 'en'],
  content: ['normal', 'long'],
  density: ['medium', 'small', 'large'],
  motion: ['standard', 'reduced'],
};
const context = Object.fromEntries(Object.entries(allowed).map(([key, values]) => [
  key,
  values.includes(params.get(key)) ? params.get(key) : values[0],
]));
const caseId = params.get('case') || 'actions-case';

document.documentElement.lang = context.locale;
document.documentElement.dataset.uiTheme = context.theme;
document.documentElement.dataset.uiDensity = context.density;
document.documentElement.dataset.uiMotion = context.motion;
document.documentElement.classList.toggle('theme-dark', context.theme === 'dark');
document.body.dataset.viewport = context.viewport;
document.body.dataset.content = context.content;
document.body.dataset.locale = context.locale;

const [contract] = await Promise.all([
  fetch('/static/design-system/infinite-canvas-ui/ic-actions-v1.json').then(response => {
    if (!response.ok) throw new Error(`Actions contract failed: HTTP ${response.status}`);
    return response.json();
  }),
  import('/static/js/infinite-canvas-ui/core.js?v=ic-ui-a7dd55e61123'),
]);
await Promise.all([
  customElements.whenDefined('ic-button'),
  customElements.whenDefined('ic-icon-button'),
  customElements.whenDefined('ic-button-group'),
  customElements.whenDefined('ic-floating-toolbar'),
  customElements.whenDefined('ic-video-play-button'),
]);

const copy = {
  'zh-CN': {
    normal: {
      action: '保存画布', danger: '删除节点', toggle: '吸附网格',
    },
    long: {
      action: '保存当前画布和全部尚未发布的修改',
      danger: '永久删除所选节点及其全部连接',
      toggle: '在当前画布中持续启用网格吸附',
    },
  },
  en: {
    normal: {
      action: 'Save canvas', danger: 'Delete node', toggle: 'Snap to grid',
    },
    long: {
      action: 'Save this canvas and every unpublished workspace change',
      danger: 'Permanently delete the selected node and all of its connections',
      toggle: 'Keep snap to grid enabled throughout the current canvas',
    },
  },
};
const labels = copy[context.locale][context.content];
const compactLabels = copy[context.locale].normal;
const legalHost = document.querySelector('[data-legal-combinations]');

function applyCombination(element, combination) {
  element.hierarchy = combination.hierarchy;
  element.tone = combination.tone;
  element.ghost = Boolean(combination.ghost);
  element.toggle = combination.behavior === 'toggle';
  if (combination.background) element.background = combination.background;
}

function actionLabel(combination) {
  if (combination.behavior === 'toggle') return labels.toggle;
  if (combination.tone === 'danger') return labels.danger;
  return labels.action;
}

const components = contract.components.slice(0, 2);
for (const component of components) {
  for (const combination of component.legalCombinations) {
    const sample = document.createElement('article');
    sample.className = 'action-combination';
    sample.dataset.componentName = combination.id;
    const control = document.createElement(component.tag);
    applyCombination(control, combination);
    if (component.tag === 'ic-icon-button') {
      control.icon = combination.tone === 'danger' ? 'delete' : (
        combination.behavior === 'toggle' ? 'settings' : 'save'
      );
      control.label = actionLabel(combination);
    } else {
      control.append(actionLabel(combination));
    }
    sample.append(control);
    legalHost.append(sample);
  }
}

const stateNames = ['default', 'hover', 'focus-visible', 'pressed', 'loading', 'disabled', 'selected'];
const stateLabels = {
  default: 'Default', hover: 'Hover', 'focus-visible': 'Focus Visible', pressed: 'Pressed',
  loading: 'Loading', disabled: 'Disabled', selected: 'Selected',
};
const stateHost = document.querySelector('[data-action-states]');
const announcement = document.querySelector('[data-action-announcement]');
for (const state of stateNames) {
  const sample = document.createElement('div');
  sample.className = 'action-state-sample';
  sample.dataset.state = state;
  sample.dataset.copyValue = state;
  sample.dataset.copyKind = '状态值';
  const button = document.createElement('ic-button');
  button.textContent = state === 'selected' ? compactLabels.toggle : compactLabels.action;
  if (['hover', 'focus-visible', 'pressed'].includes(state)) button.dataset.previewState = state;
  if (state === 'loading') button.loading = true;
  if (state === 'disabled') button.disabled = true;
  if (state === 'selected') {
    button.toggle = true;
    button.pressed = true;
  }
  button.addEventListener('click', () => {
    announcement.textContent = button.toggle
      ? `${button.textContent}: ${button.pressed ? 'on' : 'off'}`
      : `${button.textContent}: activated`;
  });
  const caption = document.createElement('span');
  caption.textContent = stateLabels[state];
  sample.append(button, caption);
  stateHost.append(sample);
}

const sizeHost = document.querySelector('[data-action-sizes]');
for (const { name, value } of [
  { name: 'xs', value: 'xs' },
  { name: 'small', value: 's' },
  { name: 'medium', value: 'm' },
  { name: 'large', value: 'l' },
]) {
  const sample = document.createElement('div');
  sample.className = 'action-size-sample';
  sample.dataset.size = name;
  sample.dataset.copyValue = name;
  sample.dataset.copyKind = '尺寸值';
  const button = document.createElement('ic-button');
  button.hierarchy = 'primary';
  button.size = value;
  button.textContent = compactLabels.action;
  const caption = document.createElement('span');
  caption.textContent = name[0].toUpperCase() + name.slice(1);
  sample.append(button, caption);
  sizeHost.append(sample);
}

const groupHost = document.querySelector('[data-button-groups]');
for (const orientation of ['horizontal', 'vertical']) {
  const sample = document.createElement('div');
  sample.className = 'action-group-sample';
  sample.dataset.componentName = 'ic-button-group';
  const group = document.createElement('ic-button-group');
  group.label = orientation === 'horizontal' ? 'Canvas actions' : 'Node actions';
  group.orientation = orientation;
  const first = document.createElement('ic-button');
  first.hierarchy = orientation === 'horizontal' ? 'primary' : 'secondary';
  first.textContent = compactLabels.action;
  const second = document.createElement('ic-icon-button');
  second.icon = 'settings';
  second.label = context.locale === 'zh-CN' ? '画布设置' : 'Canvas settings';
  group.append(first, second);
  sample.append(group);
  groupHost.append(sample);
}

const inlineVideoPlayHost = document.querySelector('[data-inline-video-play-pattern]');
const inlineVideoPlayStage = document.createElement('article');
inlineVideoPlayStage.className = 'inline-video-play-library-stage';
const inlineVideoPlayCard = document.createElement('div');
inlineVideoPlayCard.className = 'inline-video-play-library-card';
inlineVideoPlayCard.innerHTML = `<span>${context.locale === 'zh-CN' ? '视频节点' : 'Video node'}</span>`;
const inlineVideoPlayButton = document.createElement('ic-video-play-button');
inlineVideoPlayButton.className = 'inline-video-play-library-button';
inlineVideoPlayButton.label = context.locale === 'zh-CN' ? '播放' : 'Play';
inlineVideoPlayButton.addEventListener('click', () => {
  announcement.textContent = context.locale === 'zh-CN'
    ? '视频节点：开始内联播放'
    : 'Video node: inline playback started';
});
inlineVideoPlayCard.append(inlineVideoPlayButton);
const inlineVideoPlayThumb = document.createElement('div');
inlineVideoPlayThumb.className = 'inline-video-play-library-thumb';
const inlineVideoPlayThumbButton = document.createElement('ic-video-play-button');
inlineVideoPlayThumbButton.size = 's';
inlineVideoPlayThumbButton.label = context.locale === 'zh-CN' ? '播放缩略视频' : 'Play thumbnail video';
inlineVideoPlayThumb.append(inlineVideoPlayThumbButton);
inlineVideoPlayStage.append(inlineVideoPlayCard, inlineVideoPlayThumb);
inlineVideoPlayHost.append(inlineVideoPlayStage);

const generationTaskQueryHost = document.querySelector('[data-generation-task-query-pattern]');
const generationTaskQueryStage = document.createElement('article');
generationTaskQueryStage.className = 'generation-task-query-library-stage';
for (const state of ['default', 'querying']) {
  const sample = document.createElement('div');
  sample.className = 'generation-task-query-library-sample';
  const status = document.createElement('span');
  status.textContent = state === 'querying'
    ? (context.locale === 'zh-CN' ? '正在查询可恢复任务' : 'Querying recoverable task')
    : (context.locale === 'zh-CN' ? '任务可手动查询' : 'Task can be queried manually');
  const button = document.createElement('ic-button');
  button.className = 'generation-task-query-library-button';
  button.size = 's';
  button.hierarchy = 'secondary';
  button.textContent = state === 'querying'
    ? (context.locale === 'zh-CN' ? '查询中...' : 'Querying...')
    : (context.locale === 'zh-CN' ? '查询结果' : 'Query Result');
  if (state === 'querying') {
    button.loading = true;
    button.disabled = true;
  } else {
    const icon = document.createElement('ic-icon');
    icon.slot = 'start';
    icon.name = 'refresh';
    button.prepend(icon);
    button.addEventListener('click', () => {
      icon.remove();
      button.textContent = context.locale === 'zh-CN' ? '查询中...' : 'Querying...';
      button.loading = true;
      button.disabled = true;
      announcement.textContent = context.locale === 'zh-CN'
        ? '正在查询生成任务'
        : 'Querying generation task';
    });
  }
  sample.append(status, button);
  generationTaskQueryStage.append(sample);
}
generationTaskQueryHost.append(generationTaskQueryStage);

await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

const legalControls = [...legalHost.querySelectorAll('ic-button, ic-icon-button')];
const groups = [...document.querySelectorAll('ic-button-group, ic-floating-toolbar')];
const contractReady = (
  contract.review.contract.status === 'confirmed'
  && legalControls.length === 15
  && legalControls.every(control => control.dataset.icContractStatus === 'ready')
  && groups.every(group => group.dataset.icContractStatus === 'ready')
);
document.querySelector('[data-legal-count]').textContent = `${legalControls.length}/15`;
document.querySelector('[data-case-status]').textContent = contractReady
  ? `${caseId} ready`
  : `${caseId} failed`;
document.documentElement.dataset.actionCaseStatus = contractReady ? 'ready' : 'failed';
window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
window.parent.postMessage({
  type: 'ic-action-case-ready',
  caseId,
  legalCount: legalControls.length,
  contractStatus: contractReady ? 'ready' : 'failed',
  context,
}, '*');
