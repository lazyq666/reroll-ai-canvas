function translatedEvent(host, event, publicType) {
  const options = {
    bubbles: event.bubbles,
    cancelable: event.cancelable,
    composed: event.composed,
  };
  if (!('detail' in event)) return new Event(publicType, options);

  let detail = event.detail;
  if (detail && typeof detail === 'object' && 'source' in detail) {
    const source = detail.source;
    const sourceRoot = source?.getRootNode?.();
    detail = {
      ...detail,
      source:
        sourceRoot === host.shadowRoot || source?.localName?.startsWith('wa-')
          ? host
          : source,
    };
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
