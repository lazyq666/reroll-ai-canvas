/* Source media identity and field-level draft reconciliation; no DOM ownership. */
(function () {
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  function mediaKey(media) {
    if (!media?.url) return '';
    for (const field of ['media_id', 'output_media_id', 'asset_id']) {
      if (media[field]) return `${field}:${media[field]}`;
    }
    // Local managed references stay stable across display URLs and signed URL refreshes.
    const reference = media.originalLocalUrl || media.local_url || media.url;
    try {
      const url = new URL(reference, 'http://canvas.local');
      for (const key of [...url.searchParams.keys()]) {
        if (/^(token|signature|expires|x-amz-.+|x-goog-.+)$/i.test(key)) url.searchParams.delete(key);
      }
      return `url:${url.origin === 'http://canvas.local' ? '' : url.origin}${url.pathname}${url.search}`;
    } catch (_) { return `url:${reference}`; }
  }
  function merge(current, baseline, next) {
    if (equal(baseline, next)) return copy(current);
    if (object(next) && (baseline === undefined || object(baseline)) && (current === undefined || object(current))) {
      const merged = copy(current || {});
      for (const key of new Set([...Object.keys(baseline || {}), ...Object.keys(next)])) {
        const value = merge(current?.[key], baseline?.[key], next[key]);
        if (value === undefined) delete merged[key]; else merged[key] = value;
      }
      return merged;
    }
    if (!equal(current, baseline) && !equal(current, next)) throw new Error('layer-draft-conflict');
    return copy(next);
  }
  window.SmartCanvasModules = window.SmartCanvasModules || {};
  window.SmartCanvasModules.layerDecompositionDraft = Object.freeze({mediaKey, merge, equal, copy});
})();
