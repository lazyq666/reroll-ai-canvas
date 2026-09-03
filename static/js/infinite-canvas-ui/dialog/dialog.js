import WaDialog from '../../../vendor/webawesome/3.10.0/package/dist-cdn/components/dialog/dialog.js';
import { i as css } from '../../../vendor/webawesome/3.10.0/package/dist-cdn/chunks/chunk.TLFIX76K.js';
import { activateOverlayScope } from '../overlay-layer.js?v=ic-ui-ef410096e2b4';
import { DIALOG_SIZES, DISMISS_POLICIES, withProjectEvents } from './shared.js';


export class IcDialog extends withProjectEvents(WaDialog, {
  'wa-show': 'ic-show',
  'wa-after-show': 'ic-after-show',
  'wa-hide': 'ic-hide',
  'wa-after-hide': 'ic-after-hide',
}) {
  static get styles() {
    return [...super.styles, css`
      :host {
        --wa-color-overlay-modal: var(--ic-dialog-backdrop-color, var(--ui-color-backdrop));
        --backdrop-filter: var(--ic-dialog-backdrop-filter, blur(2px));
        --show-duration: var(--ui-motion-duration-release);
        --hide-duration: var(--ui-motion-duration-fast);
        --ic-dialog-motion-y: var(--ui-space-2);
        --ic-dialog-motion-scale: .96;
      }

      .dialog.show {
        animation: ic-dialog-surface-enter var(--show-duration) var(--ui-motion-ease-fluid);
      }

      .dialog.show::backdrop {
        animation: ic-dialog-backdrop-enter var(--ui-motion-duration-normal) var(--ui-motion-ease-standard);
      }

      .dialog.hide {
        animation: ic-dialog-surface-enter var(--hide-duration) var(--ui-motion-ease-press) reverse;
      }

      .dialog.hide::backdrop {
        animation: ic-dialog-backdrop-enter var(--hide-duration) var(--ui-motion-ease-press) reverse;
      }

      :host([immersive]) {
        --ic-dialog-motion-y: 0;
        --ic-dialog-motion-scale: 1;
      }

      :host([immersive]) .dialog {
        inset: 0;
        inline-size: 100dvw;
        block-size: 100dvh;
        max-inline-size: none;
        max-block-size: none;
        margin: 0;
      }

      :host-context(html[data-ui-motion='reduced']) {
        --ic-dialog-motion-y: 0;
        --ic-dialog-motion-scale: 1;
      }

      @keyframes ic-dialog-surface-enter {
        from {
          opacity: 0;
          transform: translate3d(0, var(--ic-dialog-motion-y), 0) scale(var(--ic-dialog-motion-scale));
        }
        to {
          opacity: 1;
          transform: none;
        }
      }

      @keyframes ic-dialog-backdrop-enter {
        from {
          opacity: 0;
          backdrop-filter: blur(0);
        }
        to {
          opacity: 1;
          backdrop-filter: var(--backdrop-filter);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        :host {
          --ic-dialog-motion-y: 0;
          --ic-dialog-motion-scale: 1;
        }
      }
    `];
  }

  static properties = {
    size: { reflect: true },
    variant: { reflect: true },
    dismissPolicy: { attribute: 'dismiss-policy', reflect: true },
    withoutVisibleHeader: { attribute: 'without-visible-header', type: Boolean, reflect: true },
    immersive: { type: Boolean, reflect: true },
  };

  constructor() {
    super();
    this.size = 'medium';
    this.variant = 'standard';
    this.dismissPolicy = 'explicit';
    this.withoutVisibleHeader = false;
    this.immersive = false;
    this.lastContractError = '';
    this.pendingHideReason = '';
    this.motionGeneration = 0;
    this.openingPromise = null;
    this.closingPromise = null;
    this.handleDocumentKeyDown = event => {
      if (event.key !== 'Escape' || !this.open) return;
      event.preventDefault();
      event.stopPropagation();
      this.pendingHideReason = 'escape';
      this.requestClose(this.dialog);
    };
  }

  get contractCombination() {
    return {
      size: this.size,
      variant: this.variant,
      dismissPolicy: this.dismissPolicy,
      header: this.withoutVisibleHeader ? 'visually-hidden' : 'visible',
      presentation: this.immersive ? 'immersive' : 'standard',
    };
  }

  connectedCallback() {
    // Preserve the early tracer spellings as an internal compatibility bridge;
    // current callers use the formal dismiss-policy/without-visible-header interface.
    if (this.hasAttribute('light-dismiss') && !this.hasAttribute('dismiss-policy')) this.dismissPolicy = 'light';
    if (this.hasAttribute('without-header') && !this.hasAttribute('without-visible-header')) this.withoutVisibleHeader = true;
    if (!this.dataset.motionState) this.dataset.motionState = this.open ? 'open' : 'closed';
    super.connectedCallback();
  }

  validateContract() {
    if (!this.label.trim() && !this.querySelector('[slot="label"]')?.textContent?.trim()) return 'label is required for every ic-dialog';
    if (!DIALOG_SIZES.has(this.size)) return `Unknown Dialog size: ${this.size || '(empty)'}`;
    if (!['standard', 'compact'].includes(this.variant)) return `Unknown Dialog variant: ${this.variant || '(empty)'}`;
    if (!DISMISS_POLICIES.has(this.dismissPolicy)) return `Unknown dismiss policy: ${this.dismissPolicy || '(empty)'}`;
    if (this.variant === 'compact' && this.size !== 'small') return 'compact Dialogs require size=small';
    if (this.immersive && (this.size !== 'x-large' || this.dismissPolicy !== 'explicit')) {
      return 'immersive Dialogs require x-large size and explicit dismissal';
    }
    const footerActions = [...this.querySelectorAll(':scope > [slot="footer"]')];
    const primaryCount = footerActions.filter(action => action.getAttribute('hierarchy') === 'primary').length;
    if (primaryCount > 1) return 'Dialog footer allows at most one primary action';
    if (this.dismissPolicy === 'light' && primaryCount) return 'light dismissal is limited to lossless inspection without a primary action';
    return '';
  }

  reportContractError(reason) {
    if (reason === this.lastContractError) return;
    this.lastContractError = reason;
    this.dispatchEvent(new CustomEvent('ic-contract-error', {
      bubbles: true,
      composed: true,
      detail: { component: this.localName, reason, combination: this.contractCombination },
    }));
  }

  applyContractState() {
    const reason = this.validateContract();
    this.dataset.icContractStatus = reason ? 'invalid' : 'ready';
    if (reason) {
      this.dataset.icContractReason = reason;
      this.reportContractError(reason);
    } else {
      delete this.dataset.icContractReason;
      this.lastContractError = '';
    }
    this.lightDismiss = this.dismissPolicy === 'light';
    this.withoutHeader = this.withoutVisibleHeader;
    this.withFooter = Boolean(this.querySelector(':scope > [slot="footer"]'));
  }

  firstInvalidOrTaskControl() {
    return this.querySelector('[autofocus], [aria-invalid="true"], ic-input:invalid, ic-textarea:invalid, input:invalid, textarea:invalid, select:invalid, button, ic-button, ic-icon-button');
  }

  show() {
    if (this.openingPromise) return this.openingPromise;
    const openingPromise = this.performShow();
    this.openingPromise = openingPromise;
    openingPromise.finally(() => {
      if (this.openingPromise === openingPromise) this.openingPromise = null;
    });
    return openingPromise;
  }

  async performShow() {
    const reason = this.validateContract();
    const otherOpenDialog = [...document.querySelectorAll('ic-dialog[open], ic-confirmation-dialog[open]')].find(dialog => dialog !== this);
    if (reason || otherOpenDialog) {
      this.reportContractError(reason || 'nested Dialogs are prohibited');
      this.dataset.icContractStatus = 'invalid';
      this.dataset.icContractReason = reason || 'nested Dialogs are prohibited';
      return;
    }
    if (this.dataset.motionState === 'open' || this.dataset.motionState === 'entering') return this.openingPromise;
    const generation = ++this.motionGeneration;
    if (this.closingPromise) {
      this.dialog?.classList.remove('hide');
      await this.closingPromise;
      if (generation !== this.motionGeneration) return;
    }
    activateOverlayScope(this);
    this.dataset.motionState = 'entering';
    await super.show();
    if (generation !== this.motionGeneration || !this.open) return;
    // Web Awesome resolves on the first surface/backdrop event. Let the paired
    // event drain before another operation can attach its animation listeners.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (generation !== this.motionGeneration || !this.open) return;
    this.dataset.motionState = 'open';
    const target = this.firstInvalidOrTaskControl();
    if (target && typeof target.focus === 'function') {
      if (target.updateComplete) await target.updateComplete;
      target.focus();
      target.input?.focus?.();
      target.button?.focus?.();
    } else this.dialog.focus();
  }

  async hide(reason = 'programmatic') {
    this.pendingHideReason = reason;
    await this.requestClose(this);
  }

  requestClose(source) {
    if (this.closingPromise) return this.closingPromise;
    const closingPromise = this.performRequestClose(source);
    this.closingPromise = closingPromise;
    closingPromise.finally(() => {
      if (this.closingPromise === closingPromise) this.closingPromise = null;
    });
    return closingPromise;
  }

  async performRequestClose(source) {
    const reason = this.pendingHideReason || (source === this.dialog ? 'backdrop' : 'close');
    this.pendingHideReason = '';
    const normalizedSource = source === this.dialog || source?.localName?.startsWith('wa-') || source?.getRootNode?.() === this.shadowRoot ? this : source;
    const detail = { source: normalizedSource, reason };
    const before = new CustomEvent('ic-hide', { bubbles: true, composed: true, cancelable: true, detail });
    if (!super.dispatchEvent(before)) return;
    const generation = ++this.motionGeneration;
    if (this.openingPromise) {
      this.dialog?.classList.remove('show');
      await this.openingPromise;
      if (generation !== this.motionGeneration) return;
    }
    this.dataset.motionState = 'exiting';
    const translate = this.dispatchEvent;
    this.dispatchEvent = event => {
      if (event.type === 'wa-hide') return true;
      if (event.type === 'wa-after-hide' && generation !== this.motionGeneration) return true;
      return translate.call(this, event);
    };
    try {
      await super.requestClose(source);
    } finally {
      this.dispatchEvent = translate;
    }
    if (generation === this.motionGeneration && !this.open) this.dataset.motionState = 'closed';
  }

  async handleDialogPointerDown(event) {
    if (event.target !== this.dialog) return;
    if (this.dismissPolicy === 'light') {
      this.pendingHideReason = 'backdrop';
      await this.requestClose(this.dialog);
    } else {
      await super.handleDialogPointerDown(event);
    }
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    this.applyContractState();
    const accessibleLabel = this.querySelector('[slot="label"]')?.textContent?.trim() || this.label.trim();
    this.dialog.removeAttribute('aria-labelledby');
    if (accessibleLabel) this.dialog.setAttribute('aria-label', accessibleLabel);
    else this.dialog.removeAttribute('aria-label');
  }
}
