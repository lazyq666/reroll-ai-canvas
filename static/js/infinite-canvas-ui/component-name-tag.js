const selector = '[data-copy-value], [data-component-name], [data-legal-combination]';
const CONTENT_SIZED_COMPONENTS = new Set(['ic-tabs', 'ic-segmented-control', 'ic-toolbar', 'ic-floating-toolbar', 'ic-smart-canvas-dock', 'ic-smart-minimap']);

function componentName(node) {
  if (node.dataset.copyValue) return node.dataset.copyValue;
  if (node.dataset.componentName) return node.dataset.componentName;
  if (node.dataset.legalCombination && node.localName?.startsWith('ic-')) {
    return `${node.localName}-${node.dataset.legalCombination}`;
  }
  return node.dataset.legalCombination
    || (node.localName?.startsWith('ic-') ? node.localName : '');
}

function copyKind(node) {
  return node.dataset.copyKind || '内部组件名';
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (_) {
      // Fall through for non-secure preview URLs and restricted iframe contexts.
    }
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('Copy failed');
}

function makeTag(name, kind) {
  const tag = document.createElement('button');
  tag.type = 'button';
  tag.className = 'ic-component-name-tag';
  tag.dataset.copyComponentName = name;
  tag.setAttribute('aria-label', `复制${kind} ${name}`);
  tag.title = `点击复制 ${name}`;
  const code = document.createElement('code');
  const copyIcon = document.createElement('ic-icon');
  code.textContent = name;
  copyIcon.setAttribute('name', 'duplicate');
  copyIcon.setAttribute('size', 'small');
  copyIcon.setAttribute('aria-hidden', 'true');
  tag.append(code, copyIcon);
  tag.addEventListener('click', async () => {
    try {
      await copyText(name);
      tag.dataset.copyState = 'copied';
      copyIcon.setAttribute('name', 'check');
      tag.setAttribute('aria-label', `已复制${kind} ${name}`);
    } catch (_) {
      tag.dataset.copyState = 'failed';
      copyIcon.setAttribute('name', 'warning');
      tag.setAttribute('aria-label', `复制失败，${kind} ${name}`);
    }
    window.setTimeout(() => {
      delete tag.dataset.copyState;
      copyIcon.setAttribute('name', 'duplicate');
      tag.setAttribute('aria-label', `复制${kind} ${name}`);
    }, 1600);
  });
  return tag;
}

function makeDetail(value) {
  const detail = document.createElement('span');
  detail.className = 'ic-component-name-detail';
  detail.textContent = value;
  return detail;
}

function enhance(node) {
  if (
    !(node instanceof HTMLElement)
    || node.dataset.componentNameTagReady === 'true'
    || node.dataset.componentNameTag === 'hidden'
  ) return;
  const namedCompositeAncestor = node.parentElement?.closest('[data-copy-value], [data-component-name]');
  if (!node.dataset.copyValue && !node.dataset.componentName && node.dataset.legalCombination && namedCompositeAncestor) return;
  const name = componentName(node);
  if (!name) return;
  node.dataset.componentNameTagReady = 'true';
  const tag = makeTag(name, copyKind(node));
  if (!node.localName.startsWith('ic-')) {
    node.append(tag);
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'ic-component-name-example';
  if (!CONTENT_SIZED_COMPONENTS.has(node.localName) && !getComputedStyle(node).display.startsWith('inline')) wrapper.classList.add('is-block');
  node.before(wrapper);
  wrapper.append(node, tag);
  if (node.dataset.componentNameDetail) wrapper.append(makeDetail(node.dataset.componentNameDetail));
}

const style = document.createElement('style');
style.textContent = `
  .ic-component-name-example { min-width: 0; display: inline-flex; flex-direction: column; align-items: flex-start; gap: var(--ui-space-2); }
  .ic-component-name-example.is-block { width: 100%; }
  .ic-component-name-example.is-block > [data-legal-combination] { max-width: 100%; }
  .ic-component-name-example:not(.is-block) > [data-legal-combination] { max-width: none; }
  .ic-component-name-example:not(.is-block) > :is(ic-tabs:not([orientation="vertical"]), ic-segmented-control, ic-toolbar, ic-floating-toolbar) { width: max-content; max-width: none; }
  .ic-component-name-example:not(.is-block) > ic-tabs[orientation="vertical"] { width: 16rem; max-width: 100%; }
  .ic-component-name-tag { --ic-component-name-color: var(--ui-color-text-primary); min-height: 0; max-width: 100%; display: inline-flex; align-items: center; gap: var(--ui-space-1); padding: 0; border: 0; border-radius: 0; color: var(--ic-component-name-color); background: var(--ui-color-action-tertiary); box-shadow: none; cursor: copy; font: inherit; line-height: var(--ui-line-height-tight); }
  .ic-component-name-tag:hover { color: var(--ic-component-name-color); background: var(--ui-color-action-tertiary); }
  .ic-component-name-tag:focus-visible { outline: var(--ui-focus-ring); outline-offset: var(--ui-focus-ring-offset); }
  .ic-component-name-tag code { overflow: hidden; color: inherit; font-family: var(--ui-font-mono); font-size: var(--ui-font-size-2); text-overflow: ellipsis; white-space: nowrap; }
  .ic-component-name-tag ic-icon { color: var(--ic-component-name-color); }
  .ic-component-name-tag[data-copy-state="copied"], .ic-component-name-tag[data-copy-state="failed"] { color: var(--ic-component-name-color); }
  .ic-component-name-detail { color: var(--ui-color-text-tertiary); font: var(--ui-text-caption); line-height: var(--ui-line-height-tight); }
`;
document.head.append(style);

function enhanceAll(root = document) {
  if (root instanceof Element && root.matches(selector)) enhance(root);
  root.querySelectorAll?.(selector).forEach(enhance);
}

enhanceAll();
new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) enhanceAll(node);
  }
}).observe(document.documentElement, { childList: true, subtree: true });
