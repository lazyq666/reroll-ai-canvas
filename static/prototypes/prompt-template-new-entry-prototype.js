const library = document.querySelector('#library');
const dialog = document.querySelector('#libraryDialog');
const toast = document.querySelector('.prototype-toast');

const variants = Object.freeze({
  B1:{ name:'柔和引导条', note:'信息完整 · 入口亲和' },
  B2:{ name:'内容区标题栏', note:'最克制 · 高度最小' },
  B3:{ name:'轻量插入条', note:'动作直观 · 视觉呼吸强' },
  B4:{ name:'双区行动条', note:'层次鲜明 · 设计感最强' },
});

const url = new URL(location.href);
let activeVariant = variants[url.searchParams.get('variant')] ? url.searchParams.get('variant') : 'B1';
url.searchParams.set('variant', activeVariant);
history.replaceState({}, '', url);

let libraries = [
  { id:'common', name:'通用', scope:'common', readonly:false, description:'当前工作区内的所有画布均可使用', categories:[
    {id:'view', name:'视角'}, {id:'light', name:'光影'}, {id:'character', name:'角色'}, {id:'product', name:'产品'}, {id:'composition', name:'构图'},
  ]},
  { id:'canvas', name:'当前画布', scope:'canvas', readonly:false, categories:[] },
];

let templates = [
  {id:'wide', libraryId:'common', category:'view', name:'广角建立镜头', positive:'远景，广角，清晰的空间层次与环境关系。'},
  {id:'closeup', libraryId:'common', category:'view', name:'电影感特写', positive:'近距离特写，焦点锁定主体，背景保持柔和空间层次。'},
  {id:'portrait', libraryId:'common', category:'light', name:'柔光人像', positive:'柔和侧光，浅景深，自然肤色与安静背景。'},
  {id:'rim', libraryId:'common', category:'light', name:'冷色轮廓光', positive:'冷色轮廓光勾勒边缘，低照度环境，克制的空气颗粒。'},
  {id:'hero', libraryId:'common', category:'character', name:'角色主视觉', positive:'稳定的角色轮廓，服装层次明确，具有记忆点的姿态。'},
  {id:'product', libraryId:'common', category:'product', name:'极简产品图', positive:'纯净背景，克制反光，精准轮廓，商业产品摄影。'},
  {id:'negative', libraryId:'common', category:'composition', name:'留白构图', positive:'主体偏离中心，保留大面积呼吸空间，视觉重心稳定。'},
  {id:'canvas-role', libraryId:'canvas', category:'', name:'当前画布角色约束', positive:'角色始终佩戴红色围巾，发型和面部特征保持一致。'},
  {id:'canvas-world', libraryId:'canvas', category:'', name:'世界观材质规则', positive:'所有机械装置使用哑光陶瓷与氧化黄铜组合。'},
];

const prototypeStyles = `
  [part="workspace"] { isolation:isolate; }
  [part="new-card"] { display:none !important; }
  [data-prototype-entry] { font:inherit; }
  [data-prototype-entry]:focus-visible { outline:var(--ui-focus-ring); outline-offset:var(--ui-focus-ring-offset); }

  :is([part="prototype-b1"],[part="prototype-b2"],[part="prototype-b3"],[part="prototype-b4"]) { grid-column:1/-1; }
  [part="prototype-entry-mark"] { width:var(--ui-control-height-s); height:var(--ui-control-height-s); flex:none; display:grid; place-items:center; border-radius:var(--ui-radius-m); color:var(--ui-color-text-primary); background:var(--ui-color-surface); box-shadow:var(--ui-shadow-raised); }
  [part="prototype-entry-copy"] { min-width:0; display:grid; gap:calc(var(--ui-space-1) / 2); }
  [part="prototype-entry-copy"] strong { color:var(--ui-color-text-primary); font-size:var(--ui-font-size-3); }
  [part="prototype-entry-copy"] small { color:var(--ui-color-text-tertiary); font:var(--ui-text-caption); }

  /* B1 — a warm, full-row invitation with enough context for first-time use. */
  [part="prototype-b1"] { min-height:3rem; display:flex; align-items:center; gap:var(--ui-space-3); padding:var(--ui-space-2) var(--ui-space-3); border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius:var(--ui-radius-m); color:var(--ui-color-text-primary); background:linear-gradient(100deg,var(--ui-color-action-secondary-selected),var(--ui-color-surface) 48%); cursor:pointer; text-align:start; }
  [part="prototype-b1"]:hover { border-color:var(--ui-color-action-primary); box-shadow:var(--ui-shadow-raised); }
  [part="prototype-b1-tail"] { margin-inline-start:auto; display:flex; align-items:center; gap:var(--ui-space-1); color:var(--ui-color-text-primary); font:var(--ui-text-label); font-weight:var(--ui-font-weight-bold); }

  /* B2 — a true content header: nearly no standalone-entry footprint. */
  [part="prototype-b2"] { min-height:var(--ui-control-height-m); display:flex; align-items:center; gap:var(--ui-space-3); padding:0 var(--ui-space-1) var(--ui-space-1); border-block-end:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); }
  [part="prototype-b2-heading"] { min-width:0; display:flex; align-items:baseline; gap:var(--ui-space-2); }
  [part="prototype-b2-heading"] strong { color:var(--ui-color-text-primary); font-size:var(--ui-font-size-3); }
  [part="prototype-b2-heading"] small { color:var(--ui-color-text-tertiary); font:var(--ui-text-caption); }
  [part="prototype-b2-action"] { min-height:var(--ui-control-height-s); display:inline-flex; align-items:center; gap:var(--ui-space-2); margin-inline-start:auto; padding:0 var(--ui-space-3); border:0; border-radius:var(--ui-radius-m); color:var(--ui-color-text-on-action-primary); background:var(--ui-color-action-primary); cursor:pointer; font-weight:var(--ui-font-weight-bold); }
  [part="prototype-b2-action"]:hover { filter:brightness(.94); transform:translateY(-1px); }

  /* B3 — a quiet insertion affordance that reads as an action, not a card. */
  [part="prototype-b3"] { min-height:2.75rem; display:flex; align-items:center; justify-content:center; gap:var(--ui-space-2); padding:0 var(--ui-space-3); border:var(--ui-border-width-thin) dashed var(--ui-color-border-primary); border-radius:var(--ui-radius-m); color:var(--ui-color-text-tertiary); background:transparent; cursor:pointer; font-weight:var(--ui-font-weight-bold); }
  [part="prototype-b3"]:hover { border-color:var(--ui-color-action-primary); color:var(--ui-color-text-primary); background:var(--ui-color-action-secondary-selected); }
  [part="prototype-b3"] ic-icon { transition:transform var(--ui-motion-duration-fast) var(--ui-motion-ease-standard); }
  [part="prototype-b3"]:hover ic-icon { transform:rotate(90deg); }

  /* B4 — explanatory copy and the action are separate, making the hierarchy explicit. */
  [part="prototype-b4"] { min-height:3.5rem; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:stretch; overflow:hidden; border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius:var(--ui-radius-l); background:var(--ui-color-surface-subtle); box-shadow:var(--ui-shadow-raised); }
  [part="prototype-b4-copy"] { min-width:0; display:flex; align-items:center; gap:var(--ui-space-3); padding:var(--ui-space-2) var(--ui-space-4); }
  [part="prototype-b4-index"] { color:var(--ui-color-text-primary); font-family:var(--ui-font-display); font-size:var(--ui-font-size-5); font-weight:var(--ui-font-weight-bold); }
  [part="prototype-b4-action"] { min-width:9.5rem; display:flex; align-items:center; justify-content:center; gap:var(--ui-space-2); padding:0 var(--ui-space-4); border:0; border-inline-start:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); color:var(--ui-color-text-primary); background:var(--ui-color-surface); cursor:pointer; font-weight:var(--ui-font-weight-bold); }
  [part="prototype-b4-action"]:hover { color:var(--ui-color-text-on-action-primary); background:var(--ui-color-action-primary); }

  [part="prototype-switcher"] { position:fixed; z-index:var(--ui-z-tooltip); inset:auto 50% var(--ui-space-3) auto; display:flex; align-items:center; gap:var(--ui-space-2); padding:var(--ui-space-1); border:var(--ui-border-width-thin) solid var(--ui-color-border-primary); border-radius:var(--ui-radius-pill); color:var(--ui-color-text-primary); background:var(--ui-color-action-secondary-selected); box-shadow:var(--ui-shadow-overlay); transform:translateX(50%); }
  [part="prototype-switcher"] button { width:var(--ui-control-height-s); height:var(--ui-control-height-s); display:grid; place-items:center; padding:0; border:0; border-radius:var(--ui-radius-pill); color:inherit; background:transparent; cursor:pointer; }
  [part="prototype-switcher"] button:hover { background:color-mix(in srgb,var(--ui-color-text-primary) 12%,transparent); }
  [part="prototype-switcher"] button:focus-visible { outline:var(--ui-focus-ring); outline-offset:var(--ui-focus-ring-offset); }
  [part="prototype-variant-copy"] { min-width:15rem; display:grid; gap:1px; text-align:center; }
  [part="prototype-variant-copy"] strong { font:var(--ui-text-label); }
  [part="prototype-variant-copy"] small { opacity:.72; font:var(--ui-text-caption); }

  @media (max-width:720px) {
    [part="prototype-entry-copy"] small,[part="prototype-b1-tail"],[part="prototype-b2-heading"] small,[part="prototype-b4-copy"] small { display:none; }
    [part="prototype-b4-action"] { min-width:var(--ui-control-height-l); padding:0 var(--ui-space-3); }
    [part="prototype-b4-action"] span { display:none; }
    [part="prototype-variant-copy"] { min-width:10rem; }
  }
`;

function sync() {
  library.libraries = libraries;
  library.templates = templates;
}

function createEntry(part, innerHTML, label='新建提示词') {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('part', part);
  button.setAttribute('data-template-new', '');
  button.setAttribute('aria-label', label);
  button.innerHTML = innerHTML;
  return button;
}

function buildEntry(root) {
  root.querySelectorAll('[data-prototype-entry]').forEach(node => node.remove());
  let entry;
  if (activeVariant === 'B1') {
    entry = createEntry('prototype-b1', '<span part="prototype-entry-mark"><ic-icon name="add"></ic-icon></span><span part="prototype-entry-copy"><strong>创建新提示词模板</strong></span>');
  } else if (activeVariant === 'B2') {
    entry = document.createElement('header');
    entry.setAttribute('part', 'prototype-b2');
    entry.innerHTML = '<span part="prototype-b2-heading"><strong>全部提示词</strong><small>7 个模板</small></span>';
    const action = createEntry('prototype-b2-action', '<ic-icon name="add"></ic-icon><span>新建提示词</span>');
    entry.append(action);
  } else if (activeVariant === 'B3') {
    entry = createEntry('prototype-b3', '<ic-icon name="add"></ic-icon><span>新建提示词</span>');
  } else {
    entry = document.createElement('section');
    entry.setAttribute('part', 'prototype-b4');
    entry.innerHTML = '<span part="prototype-b4-copy"><span part="prototype-b4-index">＋</span><span part="prototype-entry-copy"><strong>把常用描述保存成模板</strong><small>创建后可在所有智能画布中快速调用</small></span></span>';
    const action = createEntry('prototype-b4-action', '<span>新建提示词</span><ic-icon name="add"></ic-icon>');
    entry.append(action);
  }
  entry.dataset.prototypeEntry = '';
  root.querySelector('[part="grid"]')?.prepend(entry);
}

function cycleVariant(direction) {
  const keys = Object.keys(variants);
  setVariant(keys[(keys.indexOf(activeVariant) + direction + keys.length) % keys.length]);
}

function setVariant(next) {
  if (!variants[next]) return;
  activeVariant = next;
  library.dataset.prototypeVariant = next;
  const nextUrl = new URL(location.href);
  nextUrl.searchParams.set('variant', next);
  history.replaceState({}, '', nextUrl);
  const root = library.shadowRoot;
  if (!root) return;
  buildEntry(root);
  const label = root.querySelector('[part="prototype-variant-label"]');
  const note = root.querySelector('[part="prototype-variant-note"]');
  if (label) label.textContent = `${next} · ${variants[next].name}`;
  if (note) note.textContent = variants[next].note;
}

function buildSwitcher(root) {
  if (root.querySelector('[part="prototype-switcher"]')) return;
  const switcher = document.createElement('nav');
  switcher.setAttribute('part', 'prototype-switcher');
  switcher.setAttribute('aria-label', '新建入口方案切换');
  switcher.innerHTML = '<button type="button" data-prototype-previous aria-label="上一个方案">←</button><span part="prototype-variant-copy"><strong part="prototype-variant-label"></strong><small part="prototype-variant-note"></small></span><button type="button" data-prototype-next aria-label="下一个方案">→</button>';
  switcher.querySelector('[data-prototype-previous]').addEventListener('click', () => cycleVariant(-1));
  switcher.querySelector('[data-prototype-next]').addEventListener('click', () => cycleVariant(1));
  root.querySelector('[part="workspace"]')?.append(switcher);
}

function applyPrototype() {
  const root = library.shadowRoot;
  if (!root) return;
  let style = root.querySelector('#prototype-new-entry-styles');
  if (!style) {
    style = document.createElement('style');
    style.id = 'prototype-new-entry-styles';
    style.textContent = prototypeStyles;
    root.append(style);
  }
  buildSwitcher(root);
  setVariant(activeVariant);
}

function showToast(message) {
  clearTimeout(showToast.timer);
  toast.textContent = message;
  toast.hidden = false;
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2200);
}

await customElements.whenDefined('ic-prompt-template-library');
await customElements.whenDefined('ic-dialog');

sync();
const shadowObserver = new MutationObserver(() => {
  if (!library.shadowRoot.querySelector('#prototype-new-entry-styles')) applyPrototype();
});
shadowObserver.observe(library.shadowRoot, {childList:true});

library.addEventListener('ic-library-change', event => {
  library.activeLibrary = event.detail.libraryId;
  library.activeCategory = 'all';
});
library.addEventListener('ic-category-change', event => { library.activeCategory = event.detail.categoryId; });
library.addEventListener('ic-template-select', event => showToast(`原型：已选择「${templates.find(item => item.id === event.detail.templateId)?.name || '提示词'}」`));
library.addEventListener('ic-template-create', event => {
  templates = [...templates, {id:`template-${Date.now()}`, libraryId:event.detail.libraryId, ...event.detail.draft}];
  sync();
  library.closeEditor();
  showToast('已在原型中创建提示词');
});
library.addEventListener('ic-close', () => showToast('原型保持弹窗开启'));

window.addEventListener('keydown', event => {
  const origin = event.composedPath()[0];
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || origin?.matches?.('input,textarea,select,[contenteditable="true"],ic-input,ic-textarea,ic-select')) return;
  event.preventDefault();
  cycleVariant(event.key === 'ArrowRight' ? 1 : -1);
});

applyPrototype();
await dialog.show();
document.documentElement.dataset.ready = 'true';
