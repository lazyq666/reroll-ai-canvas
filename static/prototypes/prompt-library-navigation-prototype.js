const refinedNavigationStyles = `
  [part="workspace"] { gap:var(--ui-space-4); padding:var(--ui-space-6); }
  [part="header"] { position:relative; align-items:center; min-height:var(--ui-control-height-l); padding:0 calc(3 * (var(--ui-control-height-s) + var(--ui-space-2))) var(--ui-space-4) 0; border-bottom:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); }
  [part="scope-heading"] { min-width:0; width:100%; padding:0; }
  [part="library-switch"] { min-width:0; }
  [part="library-switch"] > [role="radio"] { position:relative; min-width:0; height:auto !important; min-height:var(--ui-control-height-l) !important; line-height:var(--ui-line-height-tight); }
  [part="scope-title"] { font-weight:var(--ui-font-weight-bold); }
  [part="scope-description"] { display:none; }
  [part="header-actions"] { width:auto; }
  [part="close"] { position:absolute; inset:0 0 auto auto; }
  [part="prototype-theme-toggle"] { position:absolute; inset:0 calc(var(--ui-control-height-s) + var(--ui-space-2)) auto auto; }
  [part="prototype-search-trigger"] { position:absolute; inset:0 calc(2 * (var(--ui-control-height-s) + var(--ui-space-2))) auto auto; transition:opacity var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),transform var(--ui-motion-duration-fast) var(--ui-motion-ease-standard); }
  [part="header-actions"] [part="search"] { position:absolute; inset:0 calc(2 * (var(--ui-control-height-s) + var(--ui-space-2))) auto auto; width:0; min-width:0; overflow:hidden; opacity:0; visibility:hidden; pointer-events:none; transform:translateX(var(--ui-space-2)); transition:width var(--ui-motion-duration-normal) var(--ui-motion-ease-standard),opacity var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),transform var(--ui-motion-duration-normal) var(--ui-motion-ease-standard),visibility 0s linear var(--ui-motion-duration-normal); }
  :host([data-prototype-search-open]) [part="header"] { padding-inline-end:calc(min(20rem,34vw) + 2 * (var(--ui-control-height-s) + var(--ui-space-2))); }
  :host([data-prototype-search-open]) [part="prototype-search-trigger"] { opacity:0; visibility:hidden; pointer-events:none; transform:translateX(var(--ui-space-2)); }
  :host([data-prototype-search-open]) [part="header-actions"] [part="search"] { width:min(20rem,34vw); overflow:visible; opacity:1; visibility:visible; pointer-events:auto; transform:translateX(0); transition-delay:0s; }
  [part="header-actions"] [part="search-clear"][hidden] { display:inline-flex !important; }

  [part="library-layout"] { grid-template-columns:minmax(14rem,16rem) minmax(0,1fr); gap:var(--ui-space-5); }
  [part="sidebar"] { gap:var(--ui-space-3); padding-inline-end:var(--ui-space-5); }
  [part="category-tabs"] { --ic-tabs-item-inline-padding:var(--ui-space-3); }
  [part="category-tabs"] > [data-value] { grid-template-columns:minmax(0,1fr) auto; }
  [data-category-item] { cursor:grab; touch-action:none; user-select:none; transition:background var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),box-shadow var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),opacity var(--ui-motion-duration-fast) var(--ui-motion-ease-standard); }
  [data-category-item]:active { cursor:grabbing; }
  [data-category-item] [part="category-actions"],[data-category-item] [part="category-actions"] * { cursor:pointer; touch-action:auto; }
  [data-category-item][data-dragging] { opacity:.38; }
  [data-category-item][data-drag-target] { outline:0; background:var(--ui-color-action-secondary-selected); box-shadow:inset 0 var(--ui-border-width-strong) var(--ui-color-border-selected); }
  [part="category-drag"] { display:none !important; }
  [part="category-drag-preview"] [part="category-actions"] { display:none; }
  [part="category-tabs"] > [data-value] small { color:var(--ui-color-text-tertiary); }
  [part="category-add"] { margin-top:var(--ui-space-2); }
  [part="prototype-switcher"] { position:fixed; z-index:var(--ui-z-tooltip); inset:auto 50% var(--ui-space-3) auto; display:flex; align-items:center; gap:var(--ui-space-2); padding:var(--ui-space-1); border:var(--ui-border-width-thin) solid var(--ui-color-border-primary); border-radius:var(--ui-radius-pill); color:var(--ui-color-text-primary); background:var(--ui-color-action-secondary-selected); box-shadow:var(--ui-shadow-overlay); transform:translateX(50%); }
  [part="prototype-switcher"] button { width:var(--ui-control-height-s); height:var(--ui-control-height-s); display:grid; place-items:center; padding:0; border:0; border-radius:var(--ui-radius-pill); color:inherit; background:transparent; cursor:pointer; }
  [part="prototype-switcher"] button:hover { background:color-mix(in srgb,var(--ui-color-text-primary) 12%,transparent); }
  [part="prototype-switcher"] button:focus-visible { outline:var(--ui-focus-ring); outline-offset:var(--ui-focus-ring-offset); }
  [part="prototype-variant-label"] { min-width:10rem; text-align:center; font:var(--ui-text-label); }
  @media (max-width:720px) {
    [part="workspace"] { padding:var(--ui-space-3); }
    [part="header"] { display:grid; grid-template-columns:minmax(0,1fr); align-items:stretch; gap:var(--ui-space-3); }
    [part="scope-heading"] { display:grid !important; grid-template-columns:minmax(0,1fr); gap:var(--ui-space-2); }
    [part="library-switch"] { grid-row:auto; }
    [part="library-switch"] > [role="radio"] { min-width:0; flex:1; }
    [part="header-actions"] { width:100%; }
    [part="library-layout"] { grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr); gap:var(--ui-space-3); }
    [part="sidebar"] { max-height:11rem; padding:var(--ui-space-3); border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius:var(--ui-radius-m); }
    [part="grid"] { min-height:0; }
  }

  [part="scope-heading"]:empty,[part="sidebar"][data-prototype-unused] { display:none !important; }
  [part="prototype-page-title"] { margin:0; color:var(--ui-color-text-primary); font:var(--ui-text-title-3); font-weight:var(--ui-font-weight-bold); }
  [part="prototype-accordion-sidebar"] { min-width:0; min-height:0; }

  :host([data-prototype-variant^="H"]) [part="scope-heading"] [part="library-switch"] { display:none !important; }
  :host([data-prototype-variant^="H"]) [part="library-layout"] { grid-template-columns:minmax(12.5rem,14rem) minmax(0,1fr); gap:var(--ui-space-4); }
  :host([data-prototype-variant^="H"]) [part="prototype-accordion-sidebar"] { display:flex; flex-direction:column; align-self:stretch; gap:var(--ui-space-1); padding-inline-end:var(--ui-space-3); border-inline-end:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); overflow:auto; }
  :host([data-prototype-variant^="H"]) [part="prototype-menu-row"] { width:100%; min-height:var(--ui-control-height-m); display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:var(--ui-space-2); padding:var(--ui-space-2); border:0; border-radius:var(--ui-radius-m); color:var(--ui-color-text-tertiary); background:transparent; font:inherit; font-weight:var(--ui-font-weight-bold); text-align:start; cursor:pointer; transition:color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),background var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),box-shadow var(--ui-motion-duration-fast) var(--ui-motion-ease-standard); }
  :host([data-prototype-variant^="H"]) [part="prototype-menu-row"]:hover { color:var(--ui-color-text-primary); background:var(--ui-color-surface-subtle); }
  :host([data-prototype-variant^="H"]) [part="prototype-menu-row"]:focus-visible { outline:var(--ui-focus-ring); outline-offset:var(--ui-focus-ring-offset); }
  :host([data-prototype-variant^="H"]) [part="prototype-menu-row"][aria-current="page"] { color:var(--ui-color-text-primary); }
  :host([data-prototype-variant^="H"]) [part="prototype-menu-icon"] { width:var(--ui-control-height-s); height:var(--ui-control-height-s); display:grid; place-items:center; color:currentColor; }
  :host([data-prototype-variant^="H"]) [part="prototype-menu-chevron"] { display:grid; place-items:center; color:var(--ui-color-text-tertiary); transition:transform var(--ui-motion-duration-fast) var(--ui-motion-ease-standard); }
  :host([data-prototype-variant^="H"]) [part="prototype-menu-row"][aria-expanded="true"] [part="prototype-menu-chevron"] { transform:rotate(180deg); }
  :host([data-prototype-variant^="H"]) [part="prototype-menu-children"] { display:grid; gap:var(--ui-space-1); }
  :host([data-prototype-variant^="H"]) [part="prototype-menu-children"][hidden] { display:none; }
  :host([data-prototype-variant^="H"]) [part="prototype-menu-children"] [part="category-tabs"] { width:100%; gap:var(--ui-space-1) !important; }
  :host([data-prototype-variant^="H"]) [part="prototype-menu-children"] [part="category-tabs"] > [data-value] { min-height:var(--ui-control-height-m); border-radius:var(--ui-radius-m) !important; }
  :host([data-prototype-variant^="H"]) [part="prototype-menu-children"] [part="category-tabs"] > [aria-selected="true"] { color:var(--ui-color-text-primary) !important; background:var(--ui-color-action-secondary-selected) !important; }

  :host([data-prototype-variant="H1"]) [part="library-layout"] { grid-template-columns:minmax(12.5rem,13rem) minmax(0,1fr); }
  :host([data-prototype-variant="H1"]) [part="prototype-menu-children"] { padding:var(--ui-space-1) 0 var(--ui-space-3) var(--ui-space-4); }
  :host([data-prototype-variant="H1"]) [part="prototype-menu-children"] [part="category-tabs"] > [data-value] { padding-inline:var(--ui-space-3) !important; border-radius:var(--ui-radius-l) !important; }
  :host([data-prototype-variant="H1"]) [part="prototype-menu-row"][aria-current="page"]:not([aria-expanded]) { background:var(--ui-color-action-secondary-selected); }

  :host([data-prototype-variant="H2"]) [part="prototype-menu-children"] { position:relative; margin:0 0 var(--ui-space-3) calc(var(--ui-control-height-s) / 2); padding:var(--ui-space-1) 0 0 calc(var(--ui-control-height-s) / 2 + var(--ui-space-2)); }
  :host([data-prototype-variant="H2"]) [part="prototype-menu-children"]::before { content:""; position:absolute; inset:0 auto 0 0; width:var(--ui-border-width-thin); background:var(--ui-color-border-secondary); }
  :host([data-prototype-variant="H2"]) [part="prototype-menu-children"] [part="category-tabs"] > [data-value] { position:relative; padding-inline:var(--ui-space-2) !important; background:transparent !important; }
  :host([data-prototype-variant="H2"]) [part="prototype-menu-children"] [part="category-tabs"] > [aria-selected="true"] { box-shadow:inset var(--ui-border-width-strong) 0 var(--ui-color-border-selected) !important; }
  :host([data-prototype-variant="H2"]) [part="prototype-menu-row"][aria-current="page"]:not([aria-expanded]) { background:var(--ui-color-action-secondary-selected); box-shadow:inset var(--ui-border-width-strong) 0 var(--ui-color-border-selected); }

  :host([data-prototype-variant="H3"]) [part="prototype-accordion-sidebar"] { gap:var(--ui-space-2); }
  :host([data-prototype-variant="H3"]) [part="prototype-common-group"] { display:grid; gap:var(--ui-space-1); padding:var(--ui-space-1); border:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); border-radius:var(--ui-radius-l); background:var(--ui-color-surface-subtle); }
  :host([data-prototype-variant="H3"]) [part="prototype-common-group"][data-current] { border-color:var(--ui-color-border-primary); background:var(--ui-color-surface); box-shadow:var(--ui-shadow-raised); }
  :host([data-prototype-variant="H3"]) [part="prototype-menu-children"] { padding:0 0 var(--ui-space-1); }
  :host([data-prototype-variant="H3"]) [part="prototype-menu-children"] [part="category-tabs"] > [data-value] { padding-inline:var(--ui-space-3) !important; }
  :host([data-prototype-variant="H3"]) [part="prototype-menu-row"][aria-current="page"]:not([aria-expanded]) { border:var(--ui-border-width-thin) solid var(--ui-color-border-primary); background:var(--ui-color-action-secondary-selected); box-shadow:var(--ui-shadow-raised); }

  @media (max-width:720px) {
    :host([data-prototype-variant^="H"]) [part="library-layout"] { grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr); gap:var(--ui-space-3); }
    :host([data-prototype-variant^="H"]) [part="prototype-accordion-sidebar"] { grid-column:1; grid-row:auto; max-height:16rem; padding:0 0 var(--ui-space-3); border-inline-end:0; border-bottom:var(--ui-border-width-thin) solid var(--ui-color-border-secondary); }
  }
`;

const library = document.querySelector('#library');
const dialog = document.querySelector('#libraryDialog');
const toast = document.querySelector('.prototype-toast');
const variantNames = Object.freeze({ H1:'紧凑树形', H2:'层级轨道', H3:'分组容器' });
const cleanUrl = new URL(location.href);
let activeVariant = variantNames[cleanUrl.searchParams.get('variant')] ? cleanUrl.searchParams.get('variant') : 'H1';
cleanUrl.searchParams.set('variant', activeVariant);
history.replaceState({}, '', cleanUrl);
library.dataset.prototypeVariant = activeVariant;

function setTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.uiTheme = dark ? 'dark' : 'light';
  document.documentElement.classList.toggle('theme-dark', dark);
  const toggle = library.shadowRoot?.querySelector('[data-prototype-theme-toggle]');
  toggle?.toggleAttribute('pressed', dark);
  toggle?.setAttribute('aria-pressed', String(dark));
  toggle?.setAttribute('label', dark ? '切换到浅色模式' : '切换到深色模式');
  const url = new URL(location.href);
  url.searchParams.set('theme', dark ? 'dark' : 'light');
  history.replaceState({}, '', url);
}

setTheme(new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light');
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

function sync() {
  library.libraries = libraries;
  library.templates = templates;
}

function arrangeRefinedNavigation() {
  const root = library.shadowRoot;
  const search = root?.querySelector('[part="search"]');
  if (!search) return;
  const headerActions = root.querySelector('[part="header-actions"]');
  if (headerActions && search.parentElement !== headerActions) headerActions.prepend(search);
}

function refineSearchComponent() {
  const root = library.shadowRoot;
  const field = root?.querySelector('[part="search"]');
  const input = field?.querySelector('[data-search]');
  if (!field || !input) return;
  field.removeAttribute('hint');
  field.dataset.componentName = 'ic-form-field-search-subtle';
  input.setAttribute('appearance', 'subtle');
}

function setSearchOpen(open) {
  library.toggleAttribute('data-prototype-search-open', Boolean(open));
  if (open) requestAnimationFrame(() => library.shadowRoot?.querySelector('[data-search]')?.focus({ preventScroll:true }));
  else requestAnimationFrame(() => library.shadowRoot?.querySelector('[data-prototype-search-trigger]')?.focus({ preventScroll:true }));
}

function refineSearchDisclosure() {
  const root = library.shadowRoot;
  const header = root?.querySelector('[part="header"]');
  const input = root?.querySelector('[data-search]');
  const clear = root?.querySelector('[data-search-clear]');
  if (!header || !input || !clear) return;
  if (!root.querySelector('[data-prototype-search-trigger]')) {
    const trigger = document.createElement('ic-icon-button');
    trigger.setAttribute('part', 'prototype-search-trigger');
    trigger.setAttribute('data-prototype-search-trigger', '');
    trigger.setAttribute('type', 'button');
    trigger.setAttribute('size', 's');
    trigger.setAttribute('hierarchy', 'quiet');
    trigger.setAttribute('icon', 'search');
    trigger.setAttribute('label', '搜索提示词模板');
    trigger.addEventListener('click', () => setSearchOpen(true));
    header.append(trigger);
  }
  clear.removeAttribute('hidden');
  clear.style.setProperty('display', 'inline-flex', 'important');
  clear.setAttribute('label', '清除或关闭搜索');
  if (!clear.dataset.prototypeSearchBound) {
    clear.dataset.prototypeSearchBound = 'true';
    clear.addEventListener('click', () => {
      if (!library.query.trim()) requestAnimationFrame(() => setSearchOpen(false));
    });
  }
  if (!input.dataset.prototypeSearchBound) {
    input.dataset.prototypeSearchBound = 'true';
    input.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setSearchOpen(false);
    });
  }
}

function removeExplanatoryCopy() {
  library.shadowRoot?.querySelector('[part="scope-description"]')?.remove();
}

function refinePageTitle() {
  const root = library.shadowRoot;
  const header = root?.querySelector('[part="header"]');
  if (!header || root.querySelector('[part="prototype-page-title"]')) return;
  const title = document.createElement('h1');
  title.setAttribute('part', 'prototype-page-title');
  title.textContent = '提示词模板库';
  header.prepend(title);
}

function createNavigationRegion(part, label) {
  const region = document.createElement('nav');
  region.setAttribute('part', part);
  region.setAttribute('aria-label', label);
  return region;
}

function emitLibraryChange(libraryId) {
  library.dispatchEvent(new CustomEvent('ic-library-change', {
    bubbles:true,
    composed:true,
    detail:{ libraryId },
  }));
}

function createAccordionSidebar(categoryTabs) {
  const activeLibrary = library.activeLibrary === 'canvas' ? 'canvas' : 'common';
  const expanded = activeLibrary === 'common' && library.dataset.prototypeCommonExpanded !== 'false';
  const region = createNavigationRegion('prototype-accordion-sidebar', '提示词范围与分组');
  const commonButton = document.createElement('button');
  commonButton.type = 'button';
  commonButton.setAttribute('part', 'prototype-menu-row');
  commonButton.setAttribute('aria-expanded', String(expanded));
  commonButton.toggleAttribute('aria-current', activeLibrary === 'common');
  if (activeLibrary === 'common') commonButton.setAttribute('aria-current', 'page');
  commonButton.innerHTML = `<span part="prototype-menu-icon"><ic-icon name="prompt-library" aria-hidden="true"></ic-icon></span><span>通用提示词</span><span part="prototype-menu-chevron"><ic-icon name="expand" size="small" aria-hidden="true"></ic-icon></span>`;

  const children = document.createElement('div');
  children.setAttribute('part', 'prototype-menu-children');
  children.hidden = !expanded;
  if (categoryTabs) children.append(categoryTabs);

  const canvasButton = document.createElement('button');
  canvasButton.type = 'button';
  canvasButton.setAttribute('part', 'prototype-menu-row');
  canvasButton.toggleAttribute('aria-current', activeLibrary === 'canvas');
  if (activeLibrary === 'canvas') canvasButton.setAttribute('aria-current', 'page');
  canvasButton.innerHTML = `<span part="prototype-menu-icon"><ic-icon name="canvas" aria-hidden="true"></ic-icon></span><span>当前画布提示词</span>`;

  commonButton.addEventListener('click', () => {
    if (library.activeLibrary !== 'common') {
      library.dataset.prototypeCommonExpanded = 'true';
      emitLibraryChange('common');
      return;
    }
    const nextExpanded = commonButton.getAttribute('aria-expanded') !== 'true';
    library.dataset.prototypeCommonExpanded = String(nextExpanded);
    commonButton.setAttribute('aria-expanded', String(nextExpanded));
    children.hidden = !nextExpanded;
  });
  canvasButton.addEventListener('click', () => {
    library.dataset.prototypeCommonExpanded = 'false';
    if (library.activeLibrary !== 'canvas') emitLibraryChange('canvas');
  });

  if (activeVariant === 'H3') {
    const commonGroup = document.createElement('section');
    commonGroup.setAttribute('part', 'prototype-common-group');
    commonGroup.toggleAttribute('data-current', activeLibrary === 'common');
    commonGroup.append(commonButton, children);
    region.append(commonGroup, canvasButton);
  } else {
    region.append(commonButton, children, canvasButton);
  }
  return region;
}

function arrangeNavigationHierarchy() {
  const root = library.shadowRoot;
  const layout = root?.querySelector('[part="library-layout"]');
  const scopeHeading = root?.querySelector('[part="scope-heading"]');
  const sidebar = root?.querySelector('[part="sidebar"]');
  const grid = root?.querySelector('[part="grid"]');
  const librarySwitch = root?.querySelector('[data-library-switch]');
  const categoryTabs = root?.querySelector('[data-category-tabs]');
  if (!layout || !scopeHeading || !grid || !librarySwitch) return;

  scopeHeading.prepend(librarySwitch);
  if (sidebar && categoryTabs) sidebar.prepend(categoryTabs);
  sidebar?.removeAttribute('data-prototype-unused');
  root.querySelectorAll('[part="prototype-hierarchy-panel"],[part="prototype-primary-rail"],[part="prototype-category-strip"],[part="prototype-accordion-sidebar"]').forEach(region => region.remove());

  sidebar?.setAttribute('data-prototype-unused', '');
  layout.insertBefore(createAccordionSidebar(categoryTabs), grid);
}

function refineCategoryDragSurface() {
  const root = library.shadowRoot;
  root?.querySelectorAll('[part="category-drag"]').forEach(handle => handle.remove());
}

function refineLibrarySwitch() {
  const control = library.shadowRoot?.querySelector('[data-library-switch]');
  if (!control) return;
  const content = {
    common:{ title:'通用提示词', icon:'prompt-library', index:'01' },
    canvas:{ title:'当前画布提示词', icon:'canvas', index:'02' },
  };
  [...control.children].forEach(button => {
    const item = content[button.dataset.value];
    if (!item) return;
    button.innerHTML = `<span part="scope-mark"><ic-icon name="${item.icon}" aria-hidden="true"></ic-icon></span><span part="scope-title">${item.title}</span>`;
  });
}

function setVariant(nextVariant) {
  if (!variantNames[nextVariant]) return;
  activeVariant = nextVariant;
  library.dataset.prototypeVariant = activeVariant;
  const url = new URL(location.href);
  url.searchParams.set('variant', activeVariant);
  history.replaceState({}, '', url);
  arrangeNavigationHierarchy();
  refineLibrarySwitch();
  const label = library.shadowRoot?.querySelector('[part="prototype-variant-label"]');
  if (label) label.textContent = `${activeVariant} · ${variantNames[activeVariant]}`;
}

function cycleVariant(direction) {
  const variants = Object.keys(variantNames);
  const nextIndex = (variants.indexOf(activeVariant) + direction + variants.length) % variants.length;
  setVariant(variants[nextIndex]);
}

function refinePrototypeSwitcher() {
  const root = library.shadowRoot;
  const workspace = root?.querySelector('[part="workspace"]');
  if (!workspace || root.querySelector('[part="prototype-switcher"]')) return;
  const switcher = document.createElement('div');
  switcher.setAttribute('part', 'prototype-switcher');
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', '原型方案切换');
  switcher.innerHTML = `<button type="button" aria-label="上一个方案" data-prototype-previous>←</button><span part="prototype-variant-label" aria-live="polite">${activeVariant} · ${variantNames[activeVariant]}</span><button type="button" aria-label="下一个方案" data-prototype-next>→</button>`;
  switcher.querySelector('[data-prototype-previous]').addEventListener('click', () => cycleVariant(-1));
  switcher.querySelector('[data-prototype-next]').addEventListener('click', () => cycleVariant(1));
  workspace.append(switcher);
}

function refineThemeToggle() {
  const root = library.shadowRoot;
  const header = root?.querySelector('[part="header"]');
  if (!header || root.querySelector('[data-prototype-theme-toggle]')) return;
  const toggle = document.createElement('ic-icon-button');
  toggle.setAttribute('part', 'prototype-theme-toggle');
  toggle.setAttribute('data-prototype-theme-toggle', '');
  toggle.setAttribute('type', 'button');
  toggle.setAttribute('size', 's');
  toggle.setAttribute('hierarchy', 'quiet');
  toggle.setAttribute('toggle', '');
  toggle.setAttribute('icon', 'theme');
  toggle.addEventListener('click', () => setTheme(document.documentElement.dataset.uiTheme === 'dark' ? 'light' : 'dark'));
  header.append(toggle);
  setTheme(document.documentElement.dataset.uiTheme);
}

function applyRefinedNavigation() {
  if (!library.shadowRoot) return;
  let style = library.shadowRoot.querySelector('#prototype-refined-navigation');
  if (!style) {
    style = document.createElement('style');
    style.id = 'prototype-refined-navigation';
    library.shadowRoot.append(style);
  }
  style.textContent = refinedNavigationStyles;
  arrangeRefinedNavigation();
  removeExplanatoryCopy();
  refinePageTitle();
  refineSearchComponent();
  refineSearchDisclosure();
  refineCategoryDragSurface();
  arrangeNavigationHierarchy();
  refineLibrarySwitch();
  refineThemeToggle();
  refinePrototypeSwitcher();
}

function showToast(message) {
  clearTimeout(showToast.timer);
  toast.textContent = message;
  toast.hidden = false;
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2200);
}

await customElements.whenDefined('ic-prompt-template-library');
await customElements.whenDefined('ic-dialog');

// PROTOTYPE compatibility only: the shared component is currently mid-refactor
// in this worktree and references these methods before that refactor defines them.
const libraryPrototype = customElements.get('ic-prompt-template-library').prototype;
if (!libraryPrototype.requestRender) libraryPrototype.requestRender = function requestRender(options = {}) { this.render(options); };
if (!libraryPrototype.refreshBrowseTemplates) libraryPrototype.refreshBrowseTemplates = function refreshBrowseTemplates() { return false; };
if (!libraryPrototype.handleCompositionStart) libraryPrototype.handleCompositionStart = function handleCompositionStart(event) { this._composingControl = event.target; };
if (!libraryPrototype.handleCompositionEnd) libraryPrototype.handleCompositionEnd = function handleCompositionEnd() { this._composingControl = null; };

// PROTOTYPE: the entire category row is the drag surface. Interactive row
// actions remain excluded so rename/delete behavior is unchanged.
library.handleCategoryPointerDown = function handleCategoryPointerDown(event) {
  const item = event.target.closest('[data-category-item]');
  const interactive = event.target.closest('button,a,input,select,textarea,ic-button,ic-icon-button,ic-input,ic-select,ic-textarea');
  if (!item || interactive || (event.button !== undefined && event.button !== 0)) return;
  event.preventDefault();
  item.setPointerCapture?.(event.pointerId);
  this._pointerCategoryDrag = {
    pointerId:event.pointerId,
    sourceId:item.dataset.categoryItem,
    targetId:'',
    startX:event.clientX,
    startY:event.clientY,
    offsetX:event.clientX - item.getBoundingClientRect().left,
    offsetY:event.clientY - item.getBoundingClientRect().top,
    handle:item,
    item,
    preview:null,
  };
};

window.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const origin = event.composedPath()[0];
  if (origin?.matches?.('button,a,input,textarea,select,[contenteditable="true"],[role="tab"],[role="radio"],ic-button,ic-icon-button,ic-input,ic-textarea,ic-select,ic-tabs,ic-segmented-control')) return;
  event.preventDefault();
  cycleVariant(event.key === 'ArrowRight' ? 1 : -1);
});

sync();

const shadowObserver = new MutationObserver(() => {
  if (!library.shadowRoot.querySelector('#prototype-refined-navigation')) applyRefinedNavigation();
});
shadowObserver.observe(library.shadowRoot, {childList:true});

library.addEventListener('ic-library-change', event => {
  library.activeLibrary = event.detail.libraryId;
  library.activeCategory = 'all';
  library.selectedTemplate = '';
});
library.addEventListener('ic-category-change', event => {
  library.activeCategory = event.detail.categoryId;
  library.selectedTemplate = '';
});
library.addEventListener('ic-template-select', event => {
  library.selectedTemplate = event.detail.templateId;
  showToast(`原型：已选择「${templates.find(item => item.id === event.detail.templateId)?.name || '提示词'}」`);
});
library.addEventListener('ic-template-copy', event => {
  const source = templates.find(item => item.id === event.detail.templateId);
  if (!source) return;
  templates = [...templates, {...source, id:`copy-${Date.now()}`, libraryId:'canvas', category:'', name:`${source.name}副本`}];
  sync();
  showToast('已模拟复制到当前画布');
});
library.addEventListener('ic-template-create', event => {
  templates = [...templates, {id:`template-${Date.now()}`, libraryId:event.detail.libraryId, ...event.detail.draft}];
  sync();
  library.closeEditor();
  showToast('已在原型内创建提示词');
});
library.addEventListener('ic-template-edit', event => {
  templates = templates.map(item => item.id === event.detail.templateId ? {...item, ...event.detail.draft} : item);
  sync();
  library.closeEditor();
  showToast('已在原型内更新提示词');
});
library.addEventListener('ic-template-delete', event => {
  templates = templates.filter(item => item.id !== event.detail.templateId);
  sync();
  library.closeEditor();
  showToast('已在原型内删除提示词');
});
library.addEventListener('ic-template-move', event => {
  templates = templates.map(item => item.id === event.detail.templateId ? {...item, category:event.detail.categoryId} : item);
  sync();
  library.activeCategory = event.detail.categoryId;
  showToast('已在原型内移动分类');
});
library.addEventListener('ic-template-reorder', event => {
  if (event.detail.scope !== 'categories') return;
  libraries = libraries.map(item => item.id === library.activeLibrary ? {...item, categories:event.detail.categoryIds.map(id => item.categories.find(category => category.id === id)).filter(Boolean)} : item);
  sync();
});
library.addEventListener('ic-category-create', event => {
  libraries = libraries.map(item => item.id === event.detail.libraryId ? {...item, categories:[...item.categories, {id:`group-${Date.now()}`, name:event.detail.name}]} : item);
  sync();
  library.closeCategoryEditor();
  showToast('已在原型内新建分组');
});
library.addEventListener('ic-category-edit', event => {
  libraries = libraries.map(item => item.id === event.detail.libraryId ? {...item, categories:item.categories.map(category => category.id === event.detail.categoryId ? {...category, name:event.detail.name} : category)} : item);
  sync();
  library.closeCategoryEditor();
  showToast('已在原型内重命名分组');
});
library.addEventListener('ic-category-delete', event => {
  libraries = libraries.map(item => item.id === event.detail.libraryId ? {...item, categories:item.categories.filter(category => category.id !== event.detail.categoryId)} : item);
  templates = templates.filter(item => item.category !== event.detail.categoryId);
  sync();
  showToast('已在原型内删除分组');
});
library.addEventListener('ic-close', () => showToast('原型保持弹窗开启'));

applyRefinedNavigation();
await dialog.show();
document.documentElement.dataset.ready = 'true';
