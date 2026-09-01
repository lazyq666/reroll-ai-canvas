const STYLE_MARKER = 'ic-scrollbar-foundation-v1';

export const INFINITE_CANVAS_UI_SCROLLBAR = Object.freeze({
  size: '4px',
  track: 'transparent',
  thumb: 'var(--ui-color-border-primary)',
  thumbHover: 'var(--ui-color-text-tertiary)',
  edgeInset: '0px',
});

const SCROLLBAR_STYLES = `
  * {
    scrollbar-width: thin;
    scrollbar-color: var(--ui-color-border-primary) transparent;
  }

  *::-webkit-scrollbar {
    width: 4px;
    height: 4px;
    background: transparent;
  }

  *::-webkit-scrollbar-track {
    background: transparent;
  }

  *::-webkit-scrollbar-thumb {
    min-height: 36px;
    border: 0;
    border-radius: 0;
    background: var(--ui-color-border-primary);
    background-clip: border-box;
  }

  *::-webkit-scrollbar-thumb:hover {
    background: var(--ui-color-text-tertiary);
  }

  *::-webkit-scrollbar-corner {
    background: transparent;
  }
`;

let shadowSheet = null;
let observer = null;
const observedRoots = new WeakSet();

function getShadowSheet() {
  if (shadowSheet || typeof CSSStyleSheet !== 'function') return shadowSheet;
  try {
    shadowSheet = new CSSStyleSheet();
    shadowSheet.replaceSync(SCROLLBAR_STYLES);
  } catch (_error) {
    shadowSheet = null;
  }
  return shadowSheet;
}

function observeRoot(root) {
  if (!observer || observedRoots.has(root)) return;
  observer.observe(root, { childList: true, subtree: true });
  observedRoots.add(root);
}

function adoptIntoShadowRoot(root) {
  const sheet = getShadowSheet();
  if (sheet && 'adoptedStyleSheets' in root) {
    if (!root.adoptedStyleSheets.includes(sheet)) {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    }
  } else if (!root.querySelector(`style[data-ic-scrollbar-foundation="${STYLE_MARKER}"]`)) {
    const style = document.createElement('style');
    style.dataset.icScrollbarFoundation = STYLE_MARKER;
    style.textContent = SCROLLBAR_STYLES;
    root.prepend(style);
  }
  observeRoot(root);
}

function visitOpenShadowRoots(scope) {
  const candidates = [];
  if (scope instanceof Element) candidates.push(scope);
  if (typeof scope.querySelectorAll === 'function') {
    candidates.push(...scope.querySelectorAll('*'));
  }
  candidates.forEach((candidate) => {
    if (!candidate.shadowRoot) return;
    adoptIntoShadowRoot(candidate.shadowRoot);
    visitOpenShadowRoots(candidate.shadowRoot);
  });
}

export function refreshScrollbarStyles(scope = document) {
  visitOpenShadowRoots(scope);
}

export function ensureScrollbarStyles() {
  if (!document.querySelector(`style[data-ic-scrollbar-foundation="${STYLE_MARKER}"]`)) {
    const style = document.createElement('style');
    style.dataset.icScrollbarFoundation = STYLE_MARKER;
    style.textContent = SCROLLBAR_STYLES;
    document.head.append(style);
  }

  if (!observer) {
    observer = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element || node instanceof ShadowRoot) {
            visitOpenShadowRoots(node);
          }
        });
      });
    });
  }
  observeRoot(document.documentElement);
  refreshScrollbarStyles();
}
