export const ORIENTATIONS = new Set(['horizontal', 'vertical']);
export const COMPONENT_SIZES = new Set(['small', 'medium', 'large']);
export const NAVIGATION_SIZE_STYLES = `
  :host {
    --ic-navigation-control-height: var(--ui-density-control-height);
    --ic-navigation-font-size: var(--ui-density-font-size);
    --ic-navigation-inline-padding: var(--ui-density-inline-padding);
  }
  :host([size="small"]) {
    --ic-navigation-control-height: var(--ui-control-height-s);
    --ic-navigation-font-size: var(--ui-font-size-2);
    --ic-navigation-inline-padding: var(--ui-space-2);
  }
  :host([size="medium"]) {
    --ic-navigation-control-height: var(--ui-control-height-m);
    --ic-navigation-font-size: var(--ui-font-size-3);
    --ic-navigation-inline-padding: var(--ui-space-3);
  }
  :host([size="large"]) {
    --ic-navigation-control-height: var(--ui-control-height-l);
    --ic-navigation-font-size: var(--ui-font-size-4);
    --ic-navigation-inline-padding: var(--ui-space-4);
  }
`;
export const NAVIGATION_COMMAND_TAGS = Object.freeze(['ic-tabs', 'ic-segmented-control', 'ic-toolbar', 'ic-floating-toolbar', 'ic-nav-item', 'ic-nav-disclosure', 'ic-breadcrumb', 'ic-pagination', 'ic-steps']);

export function contractState(host, reason = '') {
  host.dataset.icContractStatus = reason ? 'invalid' : 'ready';
  if (!reason) { delete host.dataset.icContractReason; host._lastContractError = ''; return true; }
  host.dataset.icContractReason = reason;
  if (host._lastContractError !== reason) {
    host._lastContractError = reason;
    host.dispatchEvent(new CustomEvent('ic-contract-error', {bubbles: true, composed: true, detail: {component: host.localName, reason}}));
  }
  return false;
}

const keyForOrientation = (orientation, key) => orientation === 'vertical'
  ? ({ArrowDown: 1, ArrowUp: -1}[key] || 0)
  : ({ArrowRight: 1, ArrowLeft: -1}[key] || 0);

export function moveComposite(items, current, event, orientation) {
  if (!items.length) return null;
  let index = items.indexOf(current);
  const delta = keyForOrientation(orientation, event.key);
  if (delta) index = (Math.max(index, 0) + delta + items.length) % items.length;
  else if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = items.length - 1;
  else return null;
  event.preventDefault();
  items[index].focus();
  return items[index];
}

