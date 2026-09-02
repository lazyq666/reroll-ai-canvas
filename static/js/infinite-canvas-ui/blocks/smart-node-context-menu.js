import { IcMenu } from '../menu-popover.js?v=ic-ui-b0dd1bc6845c';

function normalizedSections(sections) {
  if (!Array.isArray(sections)) return [];
  return sections
    .filter(Array.isArray)
    .map(section => section.filter(item => item && item.action && item.label).map(item => ({ ...item })));
}

export class IcSmartNodeContextMenu extends IcMenu {
  constructor() {
    super();
    this._sections = [];
    this._shiftActive = false;
    this._onModifierKeyDown = event => {
      if (event.key === 'Shift' && this.hasAttribute('open')) this._setShiftActive(true);
    };
    this._onModifierKeyUp = event => {
      if (event.key === 'Shift') this._setShiftActive(false);
    };
    this._onWindowBlur = () => this._setShiftActive(false);
  }

  connectedCallback() {
    this.classList.add('smart-node-context-menu');
    if (!this.hasAttribute('appearance')) this.setAttribute('appearance', 'iconless');
    if (!this.hasAttribute('trigger')) this.setAttribute('trigger', 'context');
    if (!this.hasAttribute('selection')) this.setAttribute('selection', 'command');
    if (!this.hasAttribute('size')) this.setAttribute('size', 'small');
    if (!this.hasAttribute('placement')) this.setAttribute('placement', 'block-end');
    if (!this.hasAttribute('alignment')) this.setAttribute('alignment', 'start');
    super.connectedCallback();
    window.addEventListener('keydown', this._onModifierKeyDown);
    window.addEventListener('keyup', this._onModifierKeyUp);
    window.addEventListener('blur', this._onWindowBlur);
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this._onModifierKeyDown);
    window.removeEventListener('keyup', this._onModifierKeyUp);
    window.removeEventListener('blur', this._onWindowBlur);
    super.disconnectedCallback();
  }

  setSections(sections, { shiftKey = false } = {}) {
    this._sections = normalizedSections(sections);
    this._shiftActive = Boolean(shiftKey);
    this._renderSections();
  }

  hide(reason = 'programmatic') {
    super.hide(reason);
    this._setShiftActive(false);
  }

  _setShiftActive(active) {
    const next = Boolean(active);
    if (next === this._shiftActive) return;
    this._shiftActive = next;
    this._renderSections();
  }

  _renderSections() {
    const focusedValue = this.contains(document.activeElement)
      ? document.activeElement?.getAttribute?.('value') || ''
      : '';
    const visibleSections = this._sections
      .map(section => section.filter(item => !item.shiftOnly || this._shiftActive))
      .filter(section => section.length);
    const fragment = document.createDocumentFragment();
    visibleSections.forEach((section, sectionIndex) => {
      if (sectionIndex) {
        const separator = document.createElement('span');
        separator.setAttribute('role', 'separator');
        separator.setAttribute('aria-hidden', 'true');
        fragment.append(separator);
      }
      section.forEach(item => {
        const menuItem = document.createElement('ic-menu-item');
        menuItem.setAttribute('kind', 'command');
        menuItem.setAttribute('value', String(item.action));
        menuItem.setAttribute('label', String(item.label));
        if (item.icon) menuItem.setAttribute('icon', String(item.icon));
        if (item.danger) menuItem.setAttribute('tone', 'danger');
        if (item.disabled) menuItem.setAttribute('disabled', '');
        if (item.shortcut) {
          const shortcut = document.createElement('kbd');
          shortcut.textContent = String(item.shortcut);
          menuItem.append(shortcut);
        }
        fragment.append(menuItem);
      });
    });
    this.replaceChildren(fragment);
    if (!this.hasAttribute('open')) return;
    queueMicrotask(() => {
      const focusTarget = focusedValue
        ? [...this.querySelectorAll('ic-menu-item:not([disabled])')]
          .find(item => item.getAttribute('value') === focusedValue)
        : null;
      focusTarget?.focus();
      this.positionSurface();
    });
  }
}
