import WaInput from '../../../vendor/webawesome/3.10.0/package/dist-cdn/components/input/input.js';
import {
  observeHiddenAccessibleName,
  setContractStatus,
  syncHiddenAccessibleName,
  withProjectEvents,
} from './shared.js';


const INPUT_TYPES = new Set(['text', 'search', 'email', 'password', 'url', 'tel']);
const INPUT_APPEARANCES = new Set(['outlined', 'subtle']);
const INPUT_END_ACTION_TAGS = new Set(['ic-button', 'ic-icon-button']);


export class IcInput extends withProjectEvents(WaInput, {
  'wa-clear': 'ic-clear',
  'wa-invalid': 'ic-invalid',
}) {
  static formAssociated = true;

  static properties = {
    endAction: { attribute: 'end-action', type: Boolean, reflect: true },
  };

  constructor() {
    super();
    this.endAction = false;
    this._icHandleInlineOverflowChange = () => {
      this._icSyncInlineOverflowFade();
      cancelAnimationFrame(this._icInlineOverflowFrame);
      this._icInlineOverflowFrame = requestAnimationFrame(() => this._icSyncInlineOverflowFade());
    };
  }

  connectedCallback() {
    super.connectedCallback();
    observeHiddenAccessibleName(this, () => syncHiddenAccessibleName(this, 'input'));
  }

  disconnectedCallback() {
    this._icAccessibleNameObserver?.disconnect();
    this._icInlineOverflowInput?.removeEventListener('input', this._icHandleInlineOverflowChange);
    this._icInlineOverflowInput?.removeEventListener('scroll', this._icHandleInlineOverflowChange);
    this._icInlineOverflowResizeObserver?.disconnect();
    cancelAnimationFrame(this._icInlineOverflowFrame);
    this._icInlineOverflowInput = null;
    super.disconnectedCallback();
  }

  _icBindInlineOverflowFade() {
    const input = this.shadowRoot?.querySelector('[part~="input"]');
    if (!input) return;
    if (input !== this._icInlineOverflowInput) {
      this._icInlineOverflowInput?.removeEventListener('input', this._icHandleInlineOverflowChange);
      this._icInlineOverflowInput?.removeEventListener('scroll', this._icHandleInlineOverflowChange);
      this._icInlineOverflowResizeObserver?.disconnect();
      this._icInlineOverflowInput = input;
      input.addEventListener('input', this._icHandleInlineOverflowChange);
      input.addEventListener('scroll', this._icHandleInlineOverflowChange);
      this._icInlineOverflowResizeObserver = new ResizeObserver(this._icHandleInlineOverflowChange);
      this._icInlineOverflowResizeObserver.observe(input);
    }
    this._icSyncInlineOverflowFade();
  }

  _icSyncInlineOverflowFade() {
    const input = this._icInlineOverflowInput;
    if (!input) return;
    const maximumScroll = Math.max(0, input.scrollWidth - input.clientWidth);
    const currentScroll = Math.min(maximumScroll, Math.abs(input.scrollLeft));
    const threshold = 1;
    this.toggleAttribute('data-inline-fade-start', maximumScroll > threshold && currentScroll > threshold);
    this.toggleAttribute('data-inline-fade-end', maximumScroll > threshold && currentScroll < maximumScroll - threshold);
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    syncHiddenAccessibleName(this, 'input');
    queueMicrotask(() => this._icBindInlineOverflowFade());
    const type = this.type || 'text';
    const endChildren = [...this.children].filter(child => child.getAttribute('slot') === 'end');
    const endTags = endChildren.map(child => child.localName);
    const validSingleAction = endChildren.length === 1 && INPUT_END_ACTION_TAGS.has(endTags[0]);
    const validDualActions = endChildren.length === 2
      && endTags.includes('ic-button')
      && endTags.includes('ic-icon-button');
    const endActionError = this.endAction
      ? (!validSingleAction && !validDualActions
        ? 'end-action requires one ic-button or ic-icon-button, or one of each, in slot=end'
        : '')
      : (endChildren.length ? 'slot=end requires the end-action variant' : '');
    const typeError = INPUT_TYPES.has(type) ? '' : `Unsupported ic-input type: ${type}`;
    const appearance = this.appearance || 'outlined';
    const appearanceError = INPUT_APPEARANCES.has(appearance)
      ? ''
      : `Unsupported ic-input appearance: ${appearance}`;
    setContractStatus(this, typeError || appearanceError || endActionError);
  }
}
