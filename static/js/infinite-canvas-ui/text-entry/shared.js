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


export function setContractStatus(host, error = '') {
  host.dataset.icContractStatus = error ? 'invalid' : 'valid';
  if (error) host.setAttribute('ic-contract-error', error);
  else host.removeAttribute('ic-contract-error');
}


export function syncHiddenAccessibleName(host, selector) {
  const control = host.shadowRoot?.querySelector(selector);
  if (!control) return;
  const visibleLabel = String(host.label || '').trim();
  const hiddenLabel = host.getAttribute('aria-label')?.trim() || '';
  if (!visibleLabel && hiddenLabel) {
    control.removeAttribute('aria-labelledby');
    control.setAttribute('aria-label', hiddenLabel);
  } else {
    control.removeAttribute('aria-label');
  }
}


export function observeHiddenAccessibleName(host, sync) {
  host._icAccessibleNameObserver = new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.attributeName === 'aria-label')) sync();
  });
  host._icAccessibleNameObserver.observe(host, {
    attributes: true,
    attributeFilter: ['aria-label'],
  });
}
