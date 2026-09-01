export const SELECT_SIZES = new Set(['s', 'm', 'l', 'small', 'medium', 'large']);
export const SELECT_HIERARCHIES = new Set(['default', 'quiet']);
export const CHECKBOX_APPEARANCES = new Set(['default', 'checkmark-end']);
export const RADIO_GROUP_APPEARANCES = new Set(['default', 'tabs']);
export const EXCLUSIVE_OVERLAY_REQUEST_EVENT = 'ic-exclusive-overlay-request';


export function translatedEvent(event, publicType) {
  const options = {
    bubbles: event.bubbles,
    cancelable: event.cancelable,
    composed: event.composed,
  };
  return 'detail' in event
    ? new CustomEvent(publicType, { ...options, detail: event.detail })
    : new Event(publicType, options);
}


export function withProjectEvents(Base, eventNames) {
  return class extends Base {
    dispatchEvent(event) {
      const publicType = eventNames[event.type];
      if (!publicType) return super.dispatchEvent(event);
      const publicEvent = translatedEvent(event, publicType);
      const accepted = super.dispatchEvent(publicEvent);
      if (!accepted && event.cancelable) event.preventDefault();
      return accepted;
    }
  };
}


export function applyContractState(host, reason, detail = {}) {
  host.dataset.icContractStatus = reason ? 'invalid' : 'ready';
  if (!reason) {
    delete host.dataset.icContractReason;
    if (!host.disabled) host.removeAttribute('aria-disabled');
    host.lastContractError = '';
    return;
  }

  host.dataset.icContractReason = reason;
  host.setAttribute('aria-disabled', 'true');
  const signature = JSON.stringify({ reason, ...detail });
  if (signature === host.lastContractError) return;
  host.lastContractError = signature;
  host.dispatchEvent(new CustomEvent('ic-contract-error', {
    bubbles: true,
    composed: true,
    detail: { component: host.localName, reason, ...detail },
  }));
}
