import WaTextarea from '../../../vendor/webawesome/3.10.0/package/dist-cdn/components/textarea/textarea.js';
import {
  observeHiddenAccessibleName,
  setContractStatus,
  syncHiddenAccessibleName,
  withProjectEvents,
} from './shared.js';


const TEXTAREA_RESIZE = new Set(['vertical', 'none']);


export class IcTextarea extends withProjectEvents(WaTextarea, {
  'wa-invalid': 'ic-invalid',
}) {
  static formAssociated = true;

  connectedCallback() {
    super.connectedCallback();
    observeHiddenAccessibleName(this, () => syncHiddenAccessibleName(this, 'textarea'));
  }

  disconnectedCallback() {
    this._icAccessibleNameObserver?.disconnect();
    super.disconnectedCallback();
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    syncHiddenAccessibleName(this, 'textarea');
    const resize = this.resize || 'vertical';
    setContractStatus(this, TEXTAREA_RESIZE.has(resize) ? '' : `Unsupported ic-textarea resize: ${resize}`);
  }
}
