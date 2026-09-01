const EDITABLE_VALUES = new Set(['true', 'false']);
const STYLE_MARKER = 'ic-prompt-composer-v2';
let focusModalityReady = false;
let keyboardFocusPending = false;


function ensurePromptComposerStyles() {
  if (document.querySelector(`style[data-ic-prompt-composer="${STYLE_MARKER}"]`)) return;

  const stylesheet = document.createElement('style');
  stylesheet.dataset.icPromptComposer = STYLE_MARKER;
  stylesheet.textContent = `
    ic-prompt-composer {
      box-sizing: border-box;
      display: block;
      inline-size: 100%;
      min-inline-size: 0;
      max-inline-size: 100%;
      min-block-size: 7.5rem;
      padding: var(--ui-space-2) var(--ui-space-3);
      overflow: auto;
      color: var(--ui-color-text-primary);
      background: transparent;
      border: var(--ui-border-width-none);
      border-radius: var(--ui-radius-none);
      outline: none;
      box-shadow: none;
      font-family: var(--ui-font-sans);
      font-size: var(--ui-font-size-3);
      font-weight: var(--ui-font-weight-regular);
      line-height: var(--ui-line-height-body);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      transition: color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard);
    }

    ic-prompt-composer,
    ic-prompt-composer * { cursor: text; }

    ic-prompt-composer:empty::before {
      color: var(--ui-color-text-placeholder);
      content: attr(data-placeholder);
      pointer-events: none;
    }

    ic-prompt-composer[data-keyboard-focus]:focus {
      outline: var(--ui-focus-ring);
      outline-offset: var(--ui-focus-ring-offset);
      box-shadow: none;
    }

    ic-prompt-composer[contenteditable="false"] {
      color: var(--ui-color-text-tertiary);
      background: transparent;
    }

    ic-prompt-composer[contenteditable="false"],
    ic-prompt-composer[contenteditable="false"] * { cursor: default; }

    ic-prompt-composer .mention-image-token {
      block-size: 1.5rem;
      max-inline-size: 8.25rem;
      margin-inline: var(--ui-space-0);
      padding: var(--ui-space-0) var(--ui-space-2) var(--ui-space-0) var(--ui-space-1);
      border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
      border-radius: var(--ui-radius-pill);
      display: inline-flex;
      align-items: center;
      gap: var(--ui-space-1);
      vertical-align: middle;
      color: var(--ui-color-text-primary);
      background: var(--ui-color-surface-subtle);
      font-size: var(--ui-font-size-1);
      font-weight: var(--ui-font-weight-medium);
      white-space: nowrap;
      cursor: default;
    }

    ic-prompt-composer .mention-image-token > span:last-child {
      min-inline-size: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    ic-prompt-composer .mention-audio-thumb {
      inline-size: 1.125rem;
      block-size: 1.125rem;
      flex: 0 0 auto;
      border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
      border-radius: var(--ui-radius-pill);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--ui-color-text-tertiary);
      background: var(--ui-color-surface);
      font-size: var(--ui-font-size-1);
    }
  `;
  document.head.append(stylesheet);
}


function ensureFocusModalityTracking() {
  if (focusModalityReady) return;
  focusModalityReady = true;
  document.addEventListener('keydown', event => {
    keyboardFocusPending = event.key === 'Tab';
  }, true);
  document.addEventListener('pointerdown', () => {
    keyboardFocusPending = false;
  }, true);
}


function accessibleName(host) {
  return host.getAttribute('aria-label')?.trim()
    || host.getAttribute('aria-labelledby')?.trim()
    || '';
}


function contractError(host) {
  if (!accessibleName(host)) return 'aria-label or aria-labelledby is required for every ic-prompt-composer';
  const editable = host.getAttribute('contenteditable') || '';
  if (!EDITABLE_VALUES.has(editable)) return 'contenteditable must be true or false for every ic-prompt-composer';
  return '';
}


/**
 * Structured prompt editor surface.
 *
 * This component intentionally keeps authored text and reference tokens in the
 * light DOM. Smart Canvas relies on the browser Selection API to place and
 * restore carets around those tokens; the component owns editor semantics and
 * presentation, while Prompt Authoring continues to own recipe state.
 */
export class IcPromptComposer extends HTMLElement {
  static observedAttributes = ['aria-label', 'aria-labelledby', 'contenteditable'];

  constructor() {
    super();
    this.addEventListener('focus', () => {
      this.toggleAttribute('data-keyboard-focus', keyboardFocusPending);
      keyboardFocusPending = false;
    });
    this.addEventListener('blur', () => this.removeAttribute('data-keyboard-focus'));
  }

  connectedCallback() {
    ensurePromptComposerStyles();
    ensureFocusModalityTracking();
    if (!this.hasAttribute('contenteditable')) this.setAttribute('contenteditable', 'true');
    this.setAttribute('role', 'textbox');
    this.setAttribute('aria-multiline', 'true');
    this.syncContract();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.syncContract();
  }

  get value() {
    return this.textContent || '';
  }

  set value(value) {
    this.textContent = String(value ?? '');
  }

  get htmlValue() {
    return this.innerHTML;
  }

  set htmlValue(value) {
    this.innerHTML = String(value ?? '');
  }

  get readOnly() {
    return this.getAttribute('contenteditable') === 'false';
  }

  set readOnly(value) {
    this.setAttribute('contenteditable', value ? 'false' : 'true');
  }

  syncContract() {
    this.setAttribute('role', 'textbox');
    this.setAttribute('aria-multiline', 'true');
    const reason = contractError(this);
    const previous = this.getAttribute('ic-contract-error') || '';
    this.dataset.icContractStatus = reason ? 'invalid' : 'ready';
    if (reason) this.setAttribute('ic-contract-error', reason);
    else this.removeAttribute('ic-contract-error');
    if (reason && reason !== previous) {
      this.dispatchEvent(new CustomEvent('ic-contract-error', {
        bubbles: true,
        composed: true,
        detail: { component: this.localName, reason },
      }));
    }
  }
}
