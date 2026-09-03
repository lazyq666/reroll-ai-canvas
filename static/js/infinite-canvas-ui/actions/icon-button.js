import { IC_ICON_NAMES } from '../icon.js?v=ic-ui-ef410096e2b4';
import { activeOverlayScope } from '../overlay-layer.js?v=ic-ui-ef410096e2b4';
import { IcButton } from './button.js';
import { ICON_BUTTON_STYLES } from './styles.js';


const ICON_BUTTON_BACKGROUNDS = new Set(['auto', 'ghost']);
const ICON_SIZE_BY_BUTTON_SIZE = Object.freeze({
  xs: 'x-small',
  'x-small': 'x-small',
  s: 'small',
  small: 'small',
  m: 'medium',
  medium: 'medium',
  l: 'large',
  large: 'large',
});


export class IcIconButton extends IcButton {
  static get styles() {
    return [...super.styles, ICON_BUTTON_STYLES];
  }

  static properties = {
    icon: { reflect: true },
    label: { reflect: true },
    background: { reflect: true },
    shortcut: { reflect: true },
    tooltipDisabled: { type: Boolean, attribute: 'tooltip-disabled', reflect: true },
    tooltipPlacement: { attribute: 'tooltip-placement', reflect: true },
  };

  constructor() {
    super();
    this.icon = '';
    this.label = '';
    this.background = this.getAttribute('background') || 'auto';
    this.shortcut = '';
    this.tooltipDisabled = false;
    this.tooltipPlacement = 'block-start';
    this.authoredContent = false;
    this.actionIcon = null;
    this.tooltip = null;
    this.showTooltip = this.showTooltip.bind(this);
    this.hideTooltip = this.hideTooltip.bind(this);
    this.addEventListener('pointerenter', this.showTooltip);
    this.addEventListener('pointerleave', this.hideTooltip);
    this.addEventListener('focusin', this.showTooltip);
    this.addEventListener('focusout', this.hideTooltip);
    this.addEventListener('keydown', event => { if (event.key === 'Escape') this.hideTooltip(); });
  }

  get requiresVisibleLabel() {
    return false;
  }

  get contractCombination() {
    return { ...super.contractCombination, background: this.background };
  }

  connectedCallback() {
    this.authoredContent = [...this.childNodes].some(node => (
      (node.nodeType === Node.ELEMENT_NODE
        && !node.hasAttribute('data-ic-icon-button-owned'))
      || (node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()))
    ));
    this.ensureActionIcon();
    super.connectedCallback();
  }

  disconnectedCallback() {
    this.hideTooltip();
    super.disconnectedCallback();
  }

  showTooltip() {
    const text = this.label.trim();
    if (!text || this.disabled || this.loading || this.tooltipDisabled || this.tooltip) return;
    const tooltip = document.createElement('ic-tooltip');
    tooltip.setAttribute('content', text);
    tooltip.setAttribute('placement', this.tooltipPlacement || 'block-start');
    if (this.shortcut.trim()) tooltip.setAttribute('shortcut', this.shortcut.trim());
    const tooltipContainer = activeOverlayScope(this);
    tooltip.addEventListener('ic-after-hide', () => {
      tooltip.remove();
      if (this.tooltip === tooltip) this.tooltip = null;
    }, { once: true });
    tooltipContainer.append(tooltip);
    this.tooltip = tooltip;
    tooltip.show(this.button || this);
  }

  hideTooltip() {
    this.tooltip?.hide('icon-button');
    this.tooltip?.remove();
    this.tooltip = null;
  }

  ensureActionIcon() {
    if (!this.actionIcon) {
      this.actionIcon = document.createElement('ic-icon');
      this.actionIcon.dataset.icIconButtonOwned = '';
      this.actionIcon.setAttribute('aria-hidden', 'true');
      this.prepend(this.actionIcon);
    }
    this.actionIcon.removeAttribute('slot');
    this.actionIcon.name = this.icon;
    const buttonSize = this.getAttribute('size') || 'm';
    this.actionIcon.size = ICON_SIZE_BY_BUTTON_SIZE[buttonSize] || 'small';
  }

  handleLabelSlotChange() {
    this.isIconButton = true;
    this.customStates.set('icon-button', true);
  }

  validateContract() {
    const baseReason = super.validateContract();
    if (baseReason) return baseReason;
    if (this.ghost) {
      return 'ghost presentation requires ic-button with a visible label';
    }
    if (!this.label.trim()) return 'label is required for every ic-icon-button';
    if (!ICON_BUTTON_BACKGROUNDS.has(this.background)) {
      return 'background must be auto or ghost for ic-icon-button';
    }
    if (!Object.hasOwn(IC_ICON_NAMES, this.icon.trim())) {
      return `icon must be a supported ic-icon semantic name: ${this.icon || '(empty)'}`;
    }
    if (!['block-start', 'block-end', 'inline-start', 'inline-end'].includes(this.tooltipPlacement)) {
      return 'tooltip-placement must be block-start, block-end, inline-start, or inline-end';
    }
    if (this.tone === 'danger' && this.hierarchy !== 'quiet') {
      return 'danger ic-icon-button actions require quiet hierarchy';
    }
    if (this.authoredContent) return 'ic-icon-button content is supplied by icon and label attributes';
    return '';
  }

  syncEnginePresentation() {
    super.syncEnginePresentation();
    if (this.background === 'ghost') this.appearance = 'plain';
    else if (this.hierarchy === 'secondary' && this.tone === 'neutral') this.appearance = 'filled';
    this.isIconButton = true;
    this.pill = this.hierarchy === 'primary' && this.background !== 'ghost';
    this.removeAttribute('title');
    this.withStart = false;
  }

  updated(changedProperties) {
    this.ensureActionIcon();
    super.updated(changedProperties);
    this.button.style.removeProperty('border-width');
    const accessibleLabel = this.label.trim();
    if (accessibleLabel) this.button.setAttribute('aria-label', accessibleLabel);
    else this.button.removeAttribute('aria-label');
    if (this.tooltipDisabled) this.hideTooltip();
    if (this.tooltip) {
      this.tooltip.setAttribute('content', accessibleLabel);
      this.tooltip.setAttribute('placement', this.tooltipPlacement || 'block-start');
      if (this.shortcut.trim()) this.tooltip.setAttribute('shortcut', this.shortcut.trim());
      else this.tooltip.removeAttribute('shortcut');
    }
  }
}
