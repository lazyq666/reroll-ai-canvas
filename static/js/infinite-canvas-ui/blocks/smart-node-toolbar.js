import { IcFloatingToolbar } from '../navigation-command/floating-toolbar.js?v=asset-d561c586ed34';

export class IcSmartNodeToolbar extends IcFloatingToolbar {
  connectedCallback() {
    this.classList.add('smart-node-floating-menu');
    this.dataset.smartToolbarMenu = '1';
    if (!this.hasAttribute('overflow')) this.setAttribute('overflow', 'scroll');
    super.connectedCallback();
  }
}
