const VARIANTS = {
  A: {
    name:'单列清晰分组',
    description:'设置全部展开，用组标题与留白建立扫描顺序。',
  },
  B: {
    name:'任务分页',
    description:'按画布、生成、操作切换，换取更短、更稳定的浮层高度。',
  },
  C: {
    name:'分栏控制台',
    description:'加宽为双列总览，适合后续继续增加设置项。',
  },
};

const state = {
  theme:'light',
  dock:'left',
  engine:'api',
  layout:'horizontal',
  zoom:100,
  pan:100,
  performance:true,
  activeTab:'canvas',
};

const params = new URLSearchParams(location.search);
let activeVariant = VARIANTS[params.get('variant')] ? params.get('variant') : 'A';
let toastTimer = 0;

const panel = document.querySelector('#settingsPanel');
const variantTitle = document.querySelector('#variantTitle');
const variantDescription = document.querySelector('#variantDescription');
const switcherLabel = document.querySelector('#switcherLabel');
const inspector = document.querySelector('#stateInspector');
const contextMenu = document.querySelector('#canvasContextMenu');
const stage = document.querySelector('.prototype-stage');
const toast = document.querySelector('#prototypeToast');

function themeButtonMarkup() {
  const dark = state.theme === 'dark';
  return `<ic-icon-button class="theme-icon-button" data-theme-toggle type="button" size="s" hierarchy="quiet" icon="${dark ? 'light' : 'theme'}" label="${dark ? '切换浅色模式' : '切换深色模式'}"></ic-icon-button>`;
}

function segmentedMarkup(key, options) {
  return `<span class="segmented" role="group" aria-label="${options.label}">
    ${options.items.map(item => `<button type="button" data-state-key="${key}" data-state-value="${item.value}" aria-pressed="${state[key] === item.value}">${item.label}</button>`).join('')}
  </span>`;
}

function toolbarPositionRow() {
  return `<div class="setting-row"><span class="setting-copy"><strong>工具栏位置</strong></span>${segmentedMarkup('dock',{label:'工具栏位置',items:[{label:'底部',value:'bottom'},{label:'左侧',value:'left'}]})}</div>`;
}

function engineRow() {
  return `<label class="setting-row"><span class="setting-copy"><strong>生成引擎</strong></span><ic-select class="prototype-select" data-component-name="ic-select-small" data-select-key="engine" name="generation-engine" aria-label="生成引擎" size="small" placement="top">
    <option value="api" ${state.engine === 'api' ? 'selected' : ''}>API 生成</option>
    <option value="volcengine" ${state.engine === 'volcengine' ? 'selected' : ''}>火山引擎</option>
    <option value="modelscope" ${state.engine === 'modelscope' ? 'selected' : ''}>ModelScope</option>
    <option value="comfy" ${state.engine === 'comfy' ? 'selected' : ''}>ComfyUI</option>
    <option value="runninghub" ${state.engine === 'runninghub' ? 'selected' : ''}>RunningHub</option>
    <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
  </ic-select></label>`;
}

function generationLayoutRow() {
  return `<div class="setting-row"><span class="setting-copy"><strong>多结果布局</strong></span>${segmentedMarkup('layout',{label:'多结果布局',items:[{label:'横向',value:'horizontal'},{label:'纵向',value:'vertical'}]})}</div>`;
}

function performanceRow() {
  return `<div class="setting-row"><span class="setting-copy"><strong>图片性能优化</strong></span><button class="prototype-switch" type="button" role="switch" data-performance-toggle aria-label="图片性能优化" aria-checked="${state.performance}"></button></div>`;
}

function sliderRow(key, label) {
  return `<label class="setting-row slider-row"><span class="setting-copy"><strong>${label}</strong></span><span class="slider-control"><input type="range" min="50" max="200" step="10" value="${state[key]}" data-range-key="${key}" aria-label="${label}"><output class="slider-value" data-range-output="${key}">${state[key] / 100}×</output></span></label>`;
}

function shortcutMarkup() {
  return `<footer class="settings-footer"><button class="shortcut-action" type="button" data-shortcut-action><ic-icon name="keyboard" aria-hidden="true"></ic-icon><span>快捷键</span><kbd>⌘ /</kbd><ic-icon name="forward" aria-hidden="true"></ic-icon></button></footer>`;
}

function renderVariantA() {
  return `<div class="settings-body">
      <section class="settings-group"><div class="settings-group-heading"><h2 class="settings-group-title">画布</h2>${themeButtonMarkup()}</div>${toolbarPositionRow()}${performanceRow()}</section>
      <section class="settings-group"><h2 class="settings-group-title">生成</h2>${engineRow()}${generationLayoutRow()}</section>
      <section class="settings-group"><h2 class="settings-group-title">操作</h2>${sliderRow('zoom','缩放速度')}${sliderRow('pan','滑动速度')}</section>
    </div>${shortcutMarkup()}`;
}

function tabMarkup() {
  const tabs = [{id:'canvas',label:'画布'},{id:'generation',label:'生成'},{id:'controls',label:'操作'}];
  return `<div class="settings-tabs-row"><div class="settings-tabs" role="tablist" aria-label="设置分类">${tabs.map(tab => `<button type="button" role="tab" data-settings-tab="${tab.id}" aria-selected="${state.activeTab === tab.id}">${tab.label}</button>`).join('')}</div>${themeButtonMarkup()}</div>`;
}

function tabPanelMarkup() {
  if (state.activeTab === 'generation') return `<div class="tab-panel" role="tabpanel">${engineRow()}${generationLayoutRow()}</div>`;
  if (state.activeTab === 'controls') return `<div class="tab-panel" role="tabpanel">${sliderRow('zoom','缩放速度')}${sliderRow('pan','滑动速度')}</div>`;
  return `<div class="tab-panel" role="tabpanel">${toolbarPositionRow()}${performanceRow()}</div>`;
}

function renderVariantB() {
  return `${tabMarkup()}${tabPanelMarkup()}${shortcutMarkup()}`;
}

function renderVariantC() {
  return `<div class="settings-dashboard">
      <section class="settings-card"><div class="settings-card-heading"><h3>画布</h3>${themeButtonMarkup()}</div>${toolbarPositionRow()}${performanceRow()}</section>
      <section class="settings-card"><h3>生成</h3>${engineRow()}${generationLayoutRow()}</section>
      <section class="settings-card settings-card-controls">${sliderRow('zoom','缩放速度')}${sliderRow('pan','滑动速度')}</section>
    </div>${shortcutMarkup()}`;
}

function renderPanel() {
  panel.innerHTML = activeVariant === 'A' ? renderVariantA() : activeVariant === 'B' ? renderVariantB() : renderVariantC();
  bindPanelControls();
  renderInspector();
}

function setTheme(theme) {
  state.theme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.uiTheme = state.theme;
  document.documentElement.classList.toggle('theme-dark',state.theme === 'dark');
  document.body.classList.toggle('theme-dark',state.theme === 'dark');
  renderPanel();
}

function bindPanelControls() {
  panel.querySelector('[data-theme-toggle]')?.addEventListener('click',() => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
  panel.querySelectorAll('[data-state-key]').forEach(button => {
    button.addEventListener('click',() => {
      state[button.dataset.stateKey] = button.dataset.stateValue;
      renderPanel();
    });
  });
  panel.querySelectorAll('[data-select-key]').forEach(select => {
    select.addEventListener('change',() => {
      state[select.dataset.selectKey] = select.value;
      renderInspector();
    });
  });
  panel.querySelector('[data-performance-toggle]')?.addEventListener('click',() => {
    state.performance = !state.performance;
    renderPanel();
  });
  panel.querySelectorAll('[data-range-key]').forEach(range => {
    range.addEventListener('input',() => {
      state[range.dataset.rangeKey] = Number(range.value);
      const output = panel.querySelector(`[data-range-output="${range.dataset.rangeKey}"]`);
      if (output) output.textContent = `${Number(range.value) / 100}×`;
      renderInspector();
    });
  });
  panel.querySelectorAll('[data-settings-tab]').forEach(tab => {
    tab.addEventListener('click',() => {
      state.activeTab = tab.dataset.settingsTab;
      renderPanel();
    });
  });
  panel.querySelector('[data-shortcut-action]')?.addEventListener('click',() => showToast('快捷键设置将打开独立 Dialog'));
}

function renderInspector() {
  const labels = {
    theme:state.theme === 'dark' ? '深色' : '浅色',
    dock:state.dock === 'left' ? '左侧' : '底部',
    engine:{api:'API 生成',volcengine:'火山引擎',modelscope:'ModelScope',comfy:'ComfyUI',runninghub:'RunningHub'}[state.engine],
    layout:state.layout === 'horizontal' ? '横向' : '纵向',
  };
  inspector.innerHTML = `<dt>主题</dt><dd>${labels.theme}</dd><dt>工具栏</dt><dd>${labels.dock}</dd><dt>生成引擎</dt><dd>${labels.engine}</dd><dt>多结果</dt><dd>${labels.layout}</dd><dt>缩放 / 滑动</dt><dd>${state.zoom / 100}× / ${state.pan / 100}×</dd><dt>图片性能</dt><dd>${state.performance ? '开启' : '关闭'}</dd>`;
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => { toast.hidden = true; },1800);
}

function setVariant(nextVariant) {
  activeVariant = VARIANTS[nextVariant] ? nextVariant : 'A';
  document.body.dataset.variant = activeVariant;
  const nextUrl = new URL(location.href);
  nextUrl.searchParams.set('variant',activeVariant);
  history.replaceState({},'',nextUrl);
  variantTitle.textContent = `${activeVariant} · ${VARIANTS[activeVariant].name}`;
  variantDescription.textContent = VARIANTS[activeVariant].description;
  switcherLabel.textContent = `${activeVariant} · ${VARIANTS[activeVariant].name}`;
  renderPanel();
}

function cycleVariant(direction) {
  const keys = Object.keys(VARIANTS);
  const index = keys.indexOf(activeVariant);
  setVariant(keys[(index + direction + keys.length) % keys.length]);
}

function showContextMenuAt(x,y) {
  contextMenu.showAt?.(x,y,stage);
}

stage.addEventListener('contextmenu',event => {
  if (event.target.closest('.settings-panel,.prototype-switcher,.prototype-note,.state-inspector')) return;
  event.preventDefault();
  showContextMenuAt(event.clientX,event.clientY);
});
document.querySelector('#showContextMenu')?.addEventListener('click',event => {
  const rect = event.currentTarget.getBoundingClientRect();
  showContextMenuAt(rect.left,rect.bottom + 8);
});
contextMenu.addEventListener('click',event => {
  const item = event.target.closest('ic-menu-item');
  if (!item) return;
  const messages = {
    copy:'已模拟复制节点',
    paste:'已模拟粘贴节点',
    'batch-import':'“批量导入节点”将打开节点包导入 Dialog',
    prompt:'已模拟新建提示词节点',
    frame:'已模拟新建分区',
  };
  showToast(messages[item.value] || messages[item.getAttribute('value')] || '已选择菜单项');
  contextMenu.hide?.('selection');
});
document.querySelector('[data-previous]')?.addEventListener('click',() => cycleVariant(-1));
document.querySelector('[data-next]')?.addEventListener('click',() => cycleVariant(1));
document.addEventListener('keydown',event => {
  if (event.target.closest('input,select,textarea,[contenteditable]')) return;
  if (event.key === 'ArrowLeft') cycleVariant(-1);
  if (event.key === 'ArrowRight') cycleVariant(1);
});

setVariant(activeVariant);
