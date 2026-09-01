import { IcToolbar } from '../navigation-command/toolbar.js';


export class IcSmartCanvasDock extends IcToolbar {
  connectedCallback() {
    this.classList.add('smart-canvas-dock');
    if (!this.hasAttribute('label')) this.setAttribute('label', '智能画布工具栏');
    if (!this.hasAttribute('appearance')) this.setAttribute('appearance', 'plain');
    if (!this.hasAttribute('data-position')) this.setAttribute('data-position', 'left');
    if (!this.hasAttribute('orientation')) {
      this.setAttribute('orientation', this.dataset.position === 'left' ? 'vertical' : 'horizontal');
    }
    super.connectedCallback();
  }
}
