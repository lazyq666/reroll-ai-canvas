import WaButtonGroup from '../../../vendor/webawesome/3.10.0/package/dist-cdn/components/button-group/button-group.js';
import { BUTTON_GROUP_STYLES } from './styles.js';


export class IcButtonGroup extends WaButtonGroup {
  static get styles() {
    return [...super.styles, BUTTON_GROUP_STYLES];
  }

  constructor() {
    super();
    // The project host owns the public group role and label. Keep the engine's
    // internal slot presentational so assistive technology announces one group.
    this.disableRole = true;
    this.authoredSemanticRole = '';
    this.lastContractError = '';
    this.handleContractClick = this.handleContractClick.bind(this);
    this.observeContract = this.observeContract.bind(this);
    this.contractObserver = new MutationObserver(this.observeContract);
    this.addEventListener('click', this.handleContractClick, { capture: true });
  }

  connectedCallback() {
    const authoredRole = this.getAttribute('role')?.trim() || '';
    if (authoredRole && authoredRole !== 'group') this.authoredSemanticRole = authoredRole;
    super.connectedCallback();
    this.contractObserver.observe(this, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hierarchy', 'role', 'aria-checked', 'aria-selected'],
    });
  }

  disconnectedCallback() {
    this.contractObserver.disconnect();
    super.disconnectedCallback();
  }

  observeContract(records) {
    const authoredSelection = records.find(record => (
      record.type === 'attributes'
      && record.target === this
      && record.attributeName === 'role'
      && !['', 'group'].includes(this.getAttribute('role') || '')
    ));
    if (authoredSelection) this.authoredSemanticRole = this.getAttribute('role') || '';
    this.applyContractState();
  }

  validateContract() {
    if (!this.label.trim()) return 'label is required for every ic-button-group';
    if (!['horizontal', 'vertical'].includes(this.orientation)) {
      return `Unknown orientation: ${this.orientation || '(empty)'}`;
    }
    if (this.authoredSemanticRole) {
      return `Button Group is association-only and cannot provide selection role ${this.authoredSemanticRole}`;
    }

    const children = [...this.children];
    const invalidChild = children.find(child => !['ic-button', 'ic-icon-button'].includes(child.localName));
    if (invalidChild) {
      return `Button Group children must be ic-button or ic-icon-button, received ${invalidChild.localName}`;
    }
    if (children.length < 2) return 'Button Group requires at least two related action children';
    if (children.some(child => (
      ['radio', 'checkbox', 'tab'].includes(child.getAttribute('role') || '')
      || child.hasAttribute('aria-checked')
      || child.hasAttribute('aria-selected')
    ))) {
      return 'Button Group cannot provide radio, checkbox or tab selection semantics';
    }
    const primaryCount = children.filter(child => child.hierarchy === 'primary').length;
    if (primaryCount > 1) return 'Button Group allows at most one primary action';
    return '';
  }

  reportContractError(reason) {
    if (reason === this.lastContractError) return;
    this.lastContractError = reason;
    this.dispatchEvent(new CustomEvent('ic-contract-error', {
      bubbles: true,
      composed: true,
      detail: {
        component: 'ic-button-group',
        reason,
        orientation: this.orientation,
      },
    }));
  }

  applyContractState() {
    const reason = this.validateContract();
    this.dataset.icContractStatus = reason ? 'invalid' : 'ready';
    if (this.getAttribute('role') !== 'group') this.setAttribute('role', 'group');
    this.setAttribute('aria-label', this.label.trim());
    if (reason) {
      this.dataset.icContractReason = reason;
      this.setAttribute('aria-disabled', 'true');
      this.reportContractError(reason);
    } else {
      delete this.dataset.icContractReason;
      this.removeAttribute('aria-disabled');
      this.lastContractError = '';
    }
  }

  handleContractClick(event) {
    if (!this.validateContract()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.applyContractState();
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    this.applyContractState();
  }
}
