export const DIALOG_SIZES = new Set(['small', 'medium', 'large', 'x-large']);
export const DISMISS_POLICIES = new Set(['explicit', 'light']);
export const CONSEQUENCES = new Set(['neutral', 'destructive']);


export function translatedEvent(host, event, publicType) {
  const options = { bubbles: event.bubbles, cancelable: event.cancelable, composed: event.composed };
  if (!('detail' in event)) return new Event(publicType, options);
  let detail = event.detail;
  if (detail && typeof detail === 'object' && 'source' in detail) {
    const source = detail.source;
    detail = { ...detail, source: source?.localName?.startsWith('wa-') || source?.getRootNode?.() === host.shadowRoot ? host : source };
  }
  return new CustomEvent(publicType, { ...options, detail });
}


export function withProjectEvents(Base, eventNames) {
  return class extends Base {
    dispatchEvent(event) {
      const publicType = eventNames[event.type];
      if (!publicType) return super.dispatchEvent(event);
      const publicEvent = translatedEvent(this, event, publicType);
      const accepted = super.dispatchEvent(publicEvent);
      if (!accepted && event.cancelable) event.preventDefault();
      return accepted;
    }
  };
}

