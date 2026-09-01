import WaSelect from '../../../vendor/webawesome/3.10.0/package/dist-cdn/components/select/select.js';
import '../../../vendor/webawesome/3.10.0/package/dist-cdn/components/option/option.js';
import {
  applyContractState,
  EXCLUSIVE_OVERLAY_REQUEST_EVENT,
  SELECT_HIERARCHIES,
  SELECT_SIZES,
  withProjectEvents,
} from './shared.js';


export class IcSelect extends withProjectEvents(WaSelect, {
  'wa-after-hide': 'ic-after-hide',
  'wa-after-show': 'ic-after-show',
  'wa-clear': 'ic-clear',
  'wa-hide': 'ic-hide',
  'wa-invalid': 'ic-invalid',
  'wa-show': 'ic-show',
}) {
  static formAssociated = true;

  static properties = {
    hierarchy: { reflect: true },
  };

  constructor() {
    super();
    this.hierarchy = 'default';
    this.ownedWheelListbox = null;
    this.handleListboxWheel = event => event.stopPropagation();
    this.handleExclusiveOverlayRequest = event => {
      const source = event.detail?.source || event.target;
      if (source === this || !this.open) return;
      this.hide();
    };
    this.addEventListener('ic-show', event => {
      if (event.target !== this) return;
      this.dispatchEvent(new CustomEvent(EXCLUSIVE_OVERLAY_REQUEST_EVENT, {
        bubbles: true,
        composed: true,
        detail: { source: this },
      }));
    });
    const renderEngineTag = this.getTag;
    this.getTag = (option, index) => (
      this.multiple && this.hierarchy === 'quiet'
        ? null
        : renderEngineTag(option, index)
    );
    this.lastContractError = '';
    this.optionAdapters = new Map();
    this.accessibleNameObserver = new MutationObserver(mutations => {
      if (mutations.some(mutation => mutation.attributeName === 'aria-label')) this.syncAccessibleName();
    });
    const blockInvalidInteraction = event => {
      const reason = this.validateContract();
      if (!reason) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      applyContractState(this, reason);
    };
    this.addEventListener('click', blockInvalidInteraction, { capture: true });
    this.addEventListener('keydown', blockInvalidInteraction, { capture: true });
  }

  selectionChanged() {
    super.selectionChanged();
    this.syncQuietMultipleSummary();
  }

  syncQuietMultipleSummary() {
    if (!this.multiple || this.hierarchy !== 'quiet' || !this.selectedOptions.length) return;
    const separator = document.documentElement.lang?.toLowerCase().startsWith('zh') ? '、' : ', ';
    this.displayLabel = this.selectedOptions.map(option => option.label).filter(Boolean).join(separator);
  }

  connectedCallback() {
    this.syncOptions();
    super.connectedCallback();
    this.updateComplete.then(() => this.syncOptionListLayout());
    this.accessibleNameObserver.observe(this, { attributes: true, attributeFilter: ['aria-label'] });
    document.addEventListener(EXCLUSIVE_OVERLAY_REQUEST_EVENT, this.handleExclusiveOverlayRequest);
  }

  disconnectedCallback() {
    this.accessibleNameObserver.disconnect();
    document.removeEventListener(EXCLUSIVE_OVERLAY_REQUEST_EVENT, this.handleExclusiveOverlayRequest);
    this.ownedWheelListbox?.removeEventListener('wheel', this.handleListboxWheel);
    this.ownedWheelListbox = null;
    super.disconnectedCallback();
  }

  syncListboxWheelOwnership() {
    const listbox = this.shadowRoot?.querySelector('[part~="listbox"]') || null;
    if (this.ownedWheelListbox === listbox) return;
    this.ownedWheelListbox?.removeEventListener('wheel', this.handleListboxWheel);
    listbox?.addEventListener('wheel', this.handleListboxWheel, { passive: false });
    this.ownedWheelListbox = listbox;
  }

  syncAccessibleName() {
    const visibleLabel = String(this.label || '').trim();
    const hiddenLabel = this.getAttribute('aria-label')?.trim() || '';
    for (const control of [
      this.shadowRoot?.querySelector('[part~="display-input"]'),
      this.shadowRoot?.querySelector('[part~="listbox"]'),
    ].filter(Boolean)) {
      if (!visibleLabel && hiddenLabel) {
        control.removeAttribute('aria-labelledby');
        control.setAttribute('aria-label', hiddenLabel);
      } else {
        control.removeAttribute('aria-label');
      }
    }
  }

  syncOptionListLayout() {
    let style = this.shadowRoot?.querySelector('style[data-ic-select-option-list-layout]');
    if (this.dataset.componentVariant !== 'generation-count') {
      style?.remove();
      return;
    }
    if (!style) {
      style = document.createElement('style');
      style.setAttribute('data-ic-select-option-list-layout', '');
      this.shadowRoot?.append(style);
    }
    style.textContent = `
      #listbox slot:not([name]) {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        grid-auto-rows: 2rem;
        gap: var(--ui-space-1);
      }
    `;
  }

  get authoredOptions() {
    return [...this.querySelectorAll(':scope > option')];
  }

  getAllOptions() {
    return this.optionAdapters ? [...this.optionAdapters.values()] : [];
  }

  getFirstOption() {
    return this.getAllOptions()[0] || null;
  }

  syncOptions() {
    const sources = this.authoredOptions;
    for (const [source, adapter] of this.optionAdapters) {
      if (sources.includes(source)) continue;
      adapter.remove();
      this.optionAdapters.delete(source);
    }
    for (const source of sources) {
      let adapter = this.optionAdapters.get(source);
      if (!adapter) {
        adapter = document.createElement('wa-option');
        adapter.dataset.icSelectOptionAdapter = '';
        this.optionAdapters.set(source, adapter);
        this.append(adapter);
      }
      source.hidden = true;
      adapter.value = source.value;
      adapter.disabled = source.disabled;
      adapter.defaultSelected = source.selected || source.defaultSelected || source.hasAttribute('selected');
      adapter.toggleAttribute('selected', adapter.defaultSelected);
      const label = source.label || source.textContent?.trim() || '';
      const startIcon = source.dataset.startIcon?.trim() || '';
      const startIconSrc = source.dataset.startIconSrc?.trim() || '';
      const optionSignature = [
        label,
        startIcon,
        startIconSrc,
        source.hasAttribute('data-start-icon-monochrome'),
        source.hasAttribute('data-start-icon-brand-mark'),
      ].join('\u0000');
      if (adapter.dataset.icSelectOptionSignature !== optionSignature) {
        adapter.replaceChildren();
        if (startIcon || startIconSrc) {
          const iconNode = document.createElement('span');
          iconNode.slot = 'start';
          iconNode.dataset.icSelectOptionStartIcon = '';
          iconNode.setAttribute('aria-hidden', 'true');
          iconNode.title = source.dataset.startIconLabel?.trim() || '';
          if (source.hasAttribute('data-start-icon-brand-mark')) iconNode.dataset.brandMark = '';
          if (startIconSrc) {
            const image = document.createElement('img');
            image.src = startIconSrc;
            image.alt = '';
            if (source.hasAttribute('data-start-icon-monochrome')) image.dataset.monochrome = 'true';
            iconNode.append(image);
          } else {
            const icon = document.createElement('ic-icon');
            icon.setAttribute('name', startIcon);
            iconNode.append(icon);
          }
          adapter.append(iconNode);
        }
        adapter.append(document.createTextNode(label));
        adapter.dataset.icSelectOptionSignature = optionSignature;
      }
    }
    this.cachedOptions = null;
  }

  validateContract() {
    if (!String(this.label || '').trim() && !this.getAttribute('aria-label')?.trim()) return 'label or aria-label is required for every ic-select';
    if (!String(this.name || '').trim()) return 'name is required for every ic-select';
    const size = this.getAttribute('size') || 'm';
    if (!SELECT_SIZES.has(size)) return `Unsupported ic-select size: ${size}`;
    if (!SELECT_HIERARCHIES.has(this.hierarchy)) return `Unsupported ic-select hierarchy: ${this.hierarchy}`;
    const invalidChild = [...this.children].find(child => (
      child.localName !== 'option'
      && !child.hasAttribute('data-ic-select-option-adapter')
      && !['start', 'end', 'expand-icon'].includes(child.getAttribute('slot'))
    ));
    if (invalidChild) return `ic-select children must be native option elements or start/end slot content (plus the approved expand-icon slot), received ${invalidChild.localName}`;
    const options = this.authoredOptions;
    if (!options.length) return 'ic-select requires at least one named option';
    if (options.some(option => !option.value.trim() || !(option.label || option.textContent || '').trim())) {
      return 'every ic-select option requires a value and visible label';
    }
    const values = options.map(option => option.value);
    if (new Set(values).size !== values.length) return 'ic-select option values must be unique';
    return '';
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    this.syncListboxWheelOwnership();
    if (changedProperties.has('hierarchy') || changedProperties.has('multiple')) this.syncQuietMultipleSummary();
    this.syncOptionListLayout();
    this.syncAccessibleName();
    applyContractState(this, this.validateContract());
  }
}
