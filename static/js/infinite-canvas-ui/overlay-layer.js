export const OVERLAY_SCOPE_ACTIVATE_EVENT = 'ic-overlay-scope-activate';

const TRANSIENT_OVERLAY_SELECTOR = [
  'ic-menu[open]',
  'ic-popover[open]',
  'ic-confirm-popover[open]',
  'ic-tooltip[open]',
  'ic-mention-picker[open]',
  'ic-generation-settings-picker[open]',
].join(',');
const TOP_LAYER_ORDER = Object.freeze(['popover', 'toast', 'tooltip']);
const openTopLayers = new Map();

function isElement(value) {
  return typeof Element !== 'undefined' && value instanceof Element;
}

export function isTopLayerOpen(element) {
  if (!isElement(element)) return false;
  try {
    return element.matches(':popover-open');
  } catch {
    return false;
  }
}

function reopenHigherSemanticLayers(layer) {
  const currentIndex = TOP_LAYER_ORDER.indexOf(layer);
  const higherLayers = [...openTopLayers]
    .filter(([element, semanticLayer]) => {
      if (!element.isConnected || !isTopLayerOpen(element)) {
        openTopLayers.delete(element);
        return false;
      }
      return TOP_LAYER_ORDER.indexOf(semanticLayer) > currentIndex;
    })
    .sort((left, right) => (
      TOP_LAYER_ORDER.indexOf(left[1]) - TOP_LAYER_ORDER.indexOf(right[1])
    ));
  higherLayers.forEach(([element]) => element.hidePopover());
  higherLayers.forEach(([element]) => element.showPopover());
}

export function openTopLayer(element, layer = 'popover') {
  if (!isElement(element) || typeof element.showPopover !== 'function') return false;
  const semanticLayer = TOP_LAYER_ORDER.includes(layer) ? layer : 'popover';
  if (!element.hasAttribute('popover')) element.setAttribute('popover', 'manual');
  if (isTopLayerOpen(element)) {
    openTopLayers.set(element, semanticLayer);
    return true;
  }
  try {
    element.showPopover();
  } catch {
    return false;
  }
  openTopLayers.set(element, semanticLayer);
  reopenHigherSemanticLayers(semanticLayer);
  return isTopLayerOpen(element);
}

export function closeTopLayer(element) {
  openTopLayers.delete(element);
  if (!isElement(element) || typeof element.hidePopover !== 'function' || !isTopLayerOpen(element)) return;
  try {
    element.hidePopover();
  } catch {
    // Removing or re-rendering a surface can close it before component cleanup runs.
  }
}

function isRenderedOverlayScope(scope) {
  if (!isElement(scope) || !scope.isConnected || scope.hidden) return false;
  if (scope.closest('[hidden], [inert]')) return false;
  return scope.getClientRects().length > 0;
}

function closestComposedOverlayScope(source, selector) {
  let current = source;
  while (isElement(current)) {
    const scope = current.closest?.(selector);
    if (scope) return scope;
    const root = current.getRootNode?.();
    current = typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

export function activeOverlayScope(source = document.activeElement) {
  const selector = 'ic-dialog[open], ic-confirmation-dialog[open], dialog[open], [role="dialog"][aria-modal="true"]';
  const sourceScope = closestComposedOverlayScope(source, selector);
  if (isRenderedOverlayScope(sourceScope)) return sourceScope;
  const openScopes = [...document.querySelectorAll(selector)].filter(isRenderedOverlayScope);
  return openScopes.at(-1) || document.body;
}

function closeTransientOverlay(overlay) {
  if (typeof overlay.hide === 'function') overlay.hide('scope-change');
  else if ('open' in overlay) overlay.open = false;
  else overlay.removeAttribute('open');
}

export function activateOverlayScope(scope) {
  const nextScope = isElement(scope) ? scope : document.body;
  document.querySelectorAll(TRANSIENT_OVERLAY_SELECTOR).forEach(overlay => {
    if (overlay === nextScope || nextScope.contains(overlay)) return;
    closeTransientOverlay(overlay);
  });
  document.querySelectorAll('ic-toast[data-ic-overlay]').forEach(toast => {
    if (!nextScope.contains(toast)) toast.dismiss?.();
  });
}

let policyInstalled = false;

export function installOverlayScopePolicy() {
  if (policyInstalled) return;
  policyInstalled = true;
  document.addEventListener(OVERLAY_SCOPE_ACTIVATE_EVENT, event => {
    activateOverlayScope(event.detail?.scope);
  });
}
