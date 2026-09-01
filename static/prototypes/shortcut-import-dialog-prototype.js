const VARIANTS = {
  A: {
    name:'Shadcn 忠实还原',
    description:'保留 512px 紧凑窗口、纵向分组和居中 Dropzone。',
  },
  B: {
    name:'分类导航',
    description:'快捷键改为分类侧栏；导入流程增加横向步骤和上下文说明。',
  },
  C: {
    name:'高密度工作台',
    description:'利用更宽的 Dialog，以分组卡片和流程侧栏容纳更多信息。',
  },
};

const SHORTCUT_GROUPS = [
  {id:'general',label:'通用',hint:'高频编辑和画布级操作',items:[
    ['撤销上一步操作',['primary','Z']],
    ['恢复上一步操作',['primary','Shift','Z']],
    ['复制选中的节点',['primary','C']],
    ['粘贴节点或剪贴板图片',['primary','V']],
    ['删除选中节点',['Delete']],
  ]},
  {id:'navigation',label:'画布导航',hint:'移动视口和切换操作工具',items:[
    ['切换到指针模式',['V']],
    ['切换到抓手模式',['H']],
    ['按住临时抓手',['Space']],
    ['缩小画布视图',['Z']],
    ['缩放画布或预览图片',['滚轮']],
  ]},
  {id:'nodes',label:'节点与编组',hint:'组织、复制和调整画布内容',items:[
    ['按住并拖拽框选节点',['primary']],
    ['将选中节点创建为编组',['primary','G']],
    ['释放选中的编组',['primary','Shift','G']],
    ['按住并拖动复制节点',['alternate']],
    ['绘制分区并包裹选区',['Shift','S']],
  ]},
  {id:'creation',label:'创建工具',hint:'快速创建画布上的内容',items:[
    ['切换到画笔模式',['P']],
    ['切换到文本模式',['T']],
    ['双击打开快捷菜单',['双击']],
    ['框选节点',['指针','空白拖动']],
  ]},
];

const params = new URLSearchParams(location.search);
let activeVariant = VARIANTS[params.get('variant')] ? params.get('variant') : 'A';
let activeShortcutGroup = 'general';
let importStep = 'choose';
let selectedPackage = null;
let toastTimer = 0;

const shortcutDialog = document.querySelector('#shortcutDialog');
const importDialog = document.querySelector('#importDialog');
const shortcutContent = document.querySelector('#shortcutDialogContent');
const importContent = document.querySelector('#importDialogContent');
const importCancelButton = document.querySelector('#importCancelButton');
const importPrimaryButton = document.querySelector('#importPrimaryButton');
const packageInput = document.querySelector('#nodePackageFileInput');
const switcherLabel = document.querySelector('#switcherLabel');
const toast = document.querySelector('#prototypeToast');

function shortcutKeyLabel(key) {
  const apple = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  if (key === 'primary') return apple ? '⌘' : 'Ctrl';
  if (key === 'alternate') return apple ? '⌥' : 'Alt';
  if (key === 'Delete') return apple ? '⌫' : 'Del';
  if (key === 'Shift') return apple ? '⇧' : 'Shift';
  return key;
}

function keysMarkup(keys) {
  return `<span class="shortcut-keys">${keys.map(key => `<kbd>${shortcutKeyLabel(key)}</kbd>`).join('')}</span>`;
}

function rowsMarkup(group) {
  return group.items.map(([label,keys]) => `
    <div class="shortcut-row" data-shortcut-row data-search-text="${label.toLowerCase()}">
      <span>${label}</span>${keysMarkup(keys)}
    </div>`).join('');
}

function searchMarkup() {
  return `<ic-form-field class="shortcut-search-field" data-component-name="ic-form-field-search">
    <ic-input class="shortcut-search" slot="control" type="search" aria-label="搜索快捷键" placeholder="搜索快捷键…" autocomplete="off" end-action data-shortcut-search>
      <ic-icon slot="start" name="search"></ic-icon>
      <ic-icon-button slot="end" background="ghost" icon="close" label="清除搜索" data-shortcut-clear hidden></ic-icon-button>
    </ic-input>
  </ic-form-field>`;
}

function renderShortcutA() {
  return `${searchMarkup()}<div class="shortcut-scroll" data-shortcut-scroll>
    ${SHORTCUT_GROUPS.map(group => `<section class="shortcut-group" data-shortcut-group><h3>${group.label}</h3>${rowsMarkup(group)}</section>`).join('')}
    <div class="shortcut-empty" data-shortcut-empty hidden>没有匹配的快捷键</div>
  </div>`;
}

function renderShortcutB() {
  const group = SHORTCUT_GROUPS.find(item => item.id === activeShortcutGroup) || SHORTCUT_GROUPS[0];
  return `${searchMarkup()}<div class="shortcut-b-layout">
    <nav class="shortcut-category-nav" aria-label="快捷键分类">
      ${SHORTCUT_GROUPS.map(item => `<button type="button" data-shortcut-category="${item.id}" aria-selected="${item.id === group.id}">${item.label}</button>`).join('')}
    </nav>
    <div class="shortcut-b-panel">
      <section class="shortcut-group" data-shortcut-group><h3>${group.label}</h3><p class="shortcut-b-hint">${group.hint}</p>${rowsMarkup(group)}</section>
      <div class="shortcut-empty" data-shortcut-empty hidden>当前分类没有匹配的快捷键</div>
    </div>
  </div>`;
}

function renderShortcutC() {
  return `${searchMarkup()}<div class="shortcut-c-grid">
    ${SHORTCUT_GROUPS.map(group => `<section class="shortcut-group" data-shortcut-group><h3>${group.label}</h3>${rowsMarkup(group)}</section>`).join('')}
    <div class="shortcut-empty" data-shortcut-empty hidden>没有匹配的快捷键</div>
  </div>`;
}

function bindShortcutControls() {
  const input = shortcutContent.querySelector('[data-shortcut-search]');
  const clear = shortcutContent.querySelector('[data-shortcut-clear]');
  const filterRows = event => {
    const query = String(event?.target?.value ?? input?.value ?? '').trim().toLowerCase();
    if (clear) clear.hidden = !query;
    let visibleRows = 0;
    shortcutContent.querySelectorAll('[data-shortcut-group]').forEach(group => {
      let groupRows = 0;
      group.querySelectorAll('[data-shortcut-row]').forEach(row => {
        const visible = !query || row.dataset.searchText.includes(query) || row.textContent.toLowerCase().includes(query);
        row.hidden = !visible;
        if (visible) groupRows += 1;
      });
      group.hidden = groupRows === 0;
      visibleRows += groupRows;
    });
    const empty = shortcutContent.querySelector('[data-shortcut-empty]');
    if (empty) empty.hidden = visibleRows > 0;
  };
  input?.addEventListener('input',filterRows);
  input?.updateComplete?.then(() => input.input?.addEventListener('input',filterRows));
  clear?.addEventListener('click',() => {
    input.value = '';
    if (input.input) input.input.value = '';
    filterRows({target:{value:''}});
    input.focus();
    input.input?.focus?.();
  });
  shortcutContent.querySelectorAll('[data-shortcut-category]').forEach(button => {
    button.addEventListener('click', () => {
      activeShortcutGroup = button.dataset.shortcutCategory;
      renderShortcutDialog();
    });
  });
}

function renderShortcutDialog() {
  shortcutContent.innerHTML = activeVariant === 'A' ? renderShortcutA() : activeVariant === 'B' ? renderShortcutB() : renderShortcutC();
  bindShortcutControls();
}

function packageFileMarkup() {
  if (!selectedPackage) return '';
  return `<div class="selected-package">
    <span class="file-icon"><ic-icon name="file"></ic-icon></span>
    <span class="selected-package-copy"><strong>${selectedPackage.name}</strong><small>${selectedPackage.size} · ${selectedPackage.type}</small></span>
    <span class="package-ready">可读取</span>
  </div>`;
}

function dropzoneMarkup() {
  if (selectedPackage) return `${packageFileMarkup()}<div class="sample-package-action"><ic-button hierarchy="quiet" data-clear-package>重新选择文件</ic-button></div>`;
  return `<div class="dropzone" role="button" tabindex="0" aria-label="选择或拖入节点包" data-dropzone>
    <div class="dropzone-copy">
      <span class="dropzone-icon"><ic-icon name="upload"></ic-icon></span>
      <strong>将节点包拖到这里</strong>
      <span>或点击浏览文件</span>
      <ic-button hierarchy="secondary" data-browse-package>选择文件</ic-button>
      <small>支持 JSON、ZIP，最大 500 MB</small>
    </div>
  </div>
  <div class="sample-package-action"><ic-button hierarchy="quiet" data-sample-package>使用示例节点包</ic-button></div>`;
}

function stepHeaderMarkup(title,description,stepLabel) {
  return `<div class="import-step-heading"><div><h3>${title}</h3><p>${description}</p></div><span class="step-badge">${stepLabel}</span></div>`;
}

function reviewMarkup() {
  return `${stepHeaderMarkup('检查节点包内容','确认节点、连接和资源后再追加到当前画布。','第 2 步，共 3 步')}
    ${packageFileMarkup()}
    <div class="package-summary">
      <span class="summary-stat"><strong>8</strong><span>节点</span></span>
      <span class="summary-stat"><strong>6</strong><span>连接</span></span>
      <span class="summary-stat"><strong>12.4 MB</strong><span>4 个资源</span></span>
    </div>
    <div class="import-alert"><ic-icon name="warning"></ic-icon><span>2 个模型在当前工作区不可用；相关节点会保留设置，但不会自动运行。</span></div>`;
}

function successMarkup() {
  return `<div class="success-state"><div><span class="success-mark"><ic-icon name="check"></ic-icon></span><h3>节点包已导入</h3><p>已在当前视口右侧添加 8 个节点、6 条连接和 4 个资源。</p></div></div>`;
}

function renderImportA() {
  if (importStep === 'review') return reviewMarkup();
  if (importStep === 'done') return successMarkup();
  return dropzoneMarkup();
}

function stepStripMarkup() {
  const index = importStep === 'choose' ? 0 : importStep === 'review' ? 1 : 2;
  return `<div class="import-b-steps">
    ${['选择文件','检查内容','完成'].map((label,itemIndex) => `<span class="import-b-step ${itemIndex <= index ? 'is-active' : ''}" data-step="${itemIndex + 1}">${label}</span>`).join('')}
  </div>`;
}

function renderImportB() {
  if (importStep === 'done') return `${stepStripMarkup()}${successMarkup()}`;
  if (importStep === 'review') return `${stepStripMarkup()}${reviewMarkup()}`;
  return `${stepStripMarkup()}<div class="import-b-layout">
    <div>${dropzoneMarkup()}</div>
    <aside class="package-notes"><h3>节点包说明</h3><p>导入前会先解析内容，不会立即修改画布。</p><ul><li>自动重新分配节点 ID</li><li>保留内部连接关系</li><li>资源放入工作区媒体目录</li></ul></aside>
  </div>`;
}

function railMarkup() {
  const index = importStep === 'choose' ? 0 : importStep === 'review' ? 1 : 2;
  return `<aside class="import-c-rail">${['1  选择节点包','2  检查内容','3  导入完成'].map((label,itemIndex) => `<span class="${itemIndex === index ? 'is-active' : ''}">${label}</span>`).join('')}</aside>`;
}

function renderImportC() {
  const main = importStep === 'review' ? reviewMarkup() : importStep === 'done' ? successMarkup() : `${stepHeaderMarkup('选择节点包','文件只会在本地解析，确认后才追加到画布。','JSON / ZIP')}${dropzoneMarkup()}`;
  return `<div class="import-c-layout">${railMarkup()}<div class="import-c-main">${main}</div></div>`;
}

function syncImportActions() {
  importCancelButton.textContent = importStep === 'done' ? '关闭' : importStep === 'review' ? '返回' : '取消';
  importPrimaryButton.disabled = importStep === 'choose' && !selectedPackage;
  importPrimaryButton.loading = false;
  if (importStep === 'choose') importPrimaryButton.textContent = '继续';
  if (importStep === 'review') importPrimaryButton.textContent = '导入 8 个节点';
  if (importStep === 'done') importPrimaryButton.textContent = '定位到新节点';
}

function packageFromFile(file) {
  const bytes = Number(file?.size || 0);
  return {
    name:file?.name || 'cinematic-product-nodes.zip',
    size:bytes ? `${Math.max(.1,bytes / 1024 / 1024).toFixed(1)} MB` : '12.4 MB',
    type:String(file?.name || '').toLowerCase().endsWith('.json') ? 'JSON 节点包' : 'ZIP 节点包',
  };
}

function bindImportControls() {
  const choose = () => packageInput.click();
  importContent.querySelector('[data-dropzone]')?.addEventListener('click',choose);
  importContent.querySelector('[data-dropzone]')?.addEventListener('keydown',event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); }
  });
  importContent.querySelector('[data-browse-package]')?.addEventListener('click',event => { event.stopPropagation(); choose(); });
  importContent.querySelector('[data-sample-package]')?.addEventListener('click',() => {
    selectedPackage = packageFromFile(null);
    renderImportDialog();
  });
  importContent.querySelector('[data-clear-package]')?.addEventListener('click',() => {
    selectedPackage = null;
    packageInput.value = '';
    renderImportDialog();
  });
}

function renderImportDialog() {
  importContent.innerHTML = activeVariant === 'A' ? renderImportA() : activeVariant === 'B' ? renderImportB() : renderImportC();
  syncImportActions();
  bindImportControls();
}

function updateVariantUrl() {
  const next = new URL(location.href);
  next.searchParams.set('variant',activeVariant);
  history.replaceState({},'',next);
}

function applyVariant() {
  const meta = VARIANTS[activeVariant];
  document.body.dataset.variant = activeVariant;
  document.querySelector('#variantTitle').textContent = `${activeVariant} · ${meta.name}`;
  document.querySelector('#variantDescription').textContent = meta.description;
  switcherLabel.textContent = `${activeVariant} · ${meta.name}`;
  renderShortcutDialog();
  renderImportDialog();
  updateVariantUrl();
}

function cycleVariant(direction) {
  const keys = Object.keys(VARIANTS);
  const index = keys.indexOf(activeVariant);
  activeVariant = keys[(index + direction + keys.length) % keys.length];
  applyVariant();
}

async function openOnly(dialog) {
  const other = dialog === shortcutDialog ? importDialog : shortcutDialog;
  if (other.open) await other.hide('switch-dialog');
  if (!dialog.open) await dialog.show();
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; },2200);
}

document.querySelector('#openShortcutDialog').addEventListener('click',() => openOnly(shortcutDialog));
document.querySelector('#openImportDialog').addEventListener('click',() => {
  importStep = 'choose';
  selectedPackage = null;
  renderImportDialog();
  openOnly(importDialog);
});
document.querySelector('[data-previous]').addEventListener('click',() => cycleVariant(-1));
document.querySelector('[data-next]').addEventListener('click',() => cycleVariant(1));
document.addEventListener('keydown',event => {
  if (event.target?.matches?.('input,textarea,[contenteditable="true"]')) return;
  if (event.key === 'ArrowLeft') cycleVariant(-1);
  if (event.key === 'ArrowRight') cycleVariant(1);
});

packageInput.addEventListener('change',() => {
  const file = packageInput.files?.[0];
  if (!file) return;
  selectedPackage = packageFromFile(file);
  renderImportDialog();
});

importCancelButton.addEventListener('click',async () => {
  if (importStep === 'review') {
    importStep = 'choose';
    renderImportDialog();
    return;
  }
  await importDialog.hide(importStep === 'done' ? 'complete' : 'cancel');
});

importPrimaryButton.addEventListener('click',async () => {
  if (importStep === 'choose' && selectedPackage) {
    importStep = 'review';
    renderImportDialog();
    return;
  }
  if (importStep === 'review') {
    importPrimaryButton.loading = true;
    await new Promise(resolve => setTimeout(resolve,650));
    importStep = 'done';
    renderImportDialog();
    return;
  }
  if (importStep === 'done') {
    await importDialog.hide('locate');
    showToast('已定位到刚导入的 8 个节点');
  }
});

await Promise.all([
  'ic-dialog',
  'ic-button',
  'ic-form-field',
  'ic-icon',
  'ic-icon-button',
  'ic-input',
].map(tag => customElements.whenDefined(tag)));
applyVariant();
renderShortcutDialog();
renderImportDialog();
await openOnly(params.get('demo') === 'import' ? importDialog : shortcutDialog);
