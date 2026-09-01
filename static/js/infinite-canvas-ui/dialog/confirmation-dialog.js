import { IcDialog } from './dialog.js';
import { CONSEQUENCES } from './shared.js';


export class IcConfirmationDialog extends IcDialog {
  static properties = {
    description: { reflect: true },
    confirmLabel: { attribute: 'confirm-label', reflect: true },
    cancelLabel: { attribute: 'cancel-label', reflect: true },
    consequence: { reflect: true },
    confirmLoading: { attribute: 'confirm-loading', type: Boolean, reflect: true },
  };

  constructor() {
    super();
    this.size = 'small';
    this.dismissPolicy = 'explicit';
    this.description = '';
    this.confirmLabel = '';
    this.cancelLabel = '';
    this.consequence = 'neutral';
    this.confirmLoading = false;
    this.cancelAction = null;
    this.confirmAction = null;
  }

  connectedCallback() {
    this.ensureActions();
    super.connectedCallback();
  }

  ensureActions() {
    if (!this.cancelAction) {
      this.cancelAction = document.createElement('ic-button');
      this.cancelAction.slot = 'footer';
      this.cancelAction.dataset.icConfirmationOwned = 'cancel';
      this.cancelAction.hierarchy = 'secondary';
      this.cancelAction.addEventListener('click', () => this.cancel());
      this.append(this.cancelAction);
    }
    if (!this.confirmAction) {
      this.confirmAction = document.createElement('ic-button');
      this.confirmAction.slot = 'footer';
      this.confirmAction.dataset.icConfirmationOwned = 'confirm';
      this.confirmAction.hierarchy = 'primary';
      this.confirmAction.addEventListener('click', () => this.confirm());
      this.append(this.confirmAction);
    }
    this.cancelAction.textContent = this.cancelLabel;
    this.confirmAction.textContent = this.confirmLabel;
    this.confirmAction.tone = this.consequence === 'destructive' ? 'danger' : 'neutral';
    this.confirmAction.loading = this.confirmLoading;
  }

  validateContract() {
    if (!this.label.trim()) return 'label is required for every ic-confirmation-dialog';
    if (!this.confirmLabel.trim() || !this.cancelLabel.trim()) return 'Confirmation Dialog requires visible Cancel and Confirm labels';
    if (!CONSEQUENCES.has(this.consequence)) return `Unknown Confirmation consequence: ${this.consequence || '(empty)'}`;
    if (this.size !== 'small') return 'Confirmation Dialog only supports small size';
    if (this.dismissPolicy !== 'explicit') return 'Confirmation Dialog only supports explicit dismissal';
    if (this.immersive) return 'Confirmation Dialog does not support immersive presentation';
    const authoredFooter = [...this.querySelectorAll(':scope > [slot="footer"]')].find(node => !node.hasAttribute('data-ic-confirmation-owned'));
    if (authoredFooter) return 'Confirmation Dialog owns exactly the Cancel and Confirm footer actions';
    return '';
  }

  async cancel() {
    if (this.confirmLoading) return;
    const event = new CustomEvent('ic-cancel', { bubbles: true, composed: true, cancelable: true });
    if (!this.dispatchEvent(event)) return;
    this.pendingHideReason = 'cancel';
    await this.requestClose(this.cancelAction);
  }

  confirm() {
    if (this.confirmLoading) return;
    this.dispatchEvent(new CustomEvent('ic-confirm', { bubbles: true, composed: true }));
  }

  async requestClose(source) {
    if (this.confirmLoading) return;
    await super.requestClose(source);
  }

  firstInvalidOrTaskControl() {
    return this.cancelAction;
  }

  updated(changedProperties) {
    this.ensureActions();
    super.updated(changedProperties);
  }
}

