(() => {
  const icons = Object.freeze({
    midjourney: { label: 'Midjourney', src: '/static/images/midjourney.svg', monochrome: true },
    openai: { label: 'OpenAI', src: '/static/images/chatgpt.svg', monochrome: true },
    gemini: { label: 'Google Gemini', src: '/static/images/gemini.svg', monochrome: true },
    grok: { label: 'xAI Grok', src: '/static/images/grok.svg', monochrome: true },
    flux: { label: 'Black Forest Labs', src: '/static/images/flux.svg', monochrome: true },
    doubao: { label: '豆包', src: '/static/images/doubao.svg' },
    jimeng: { label: '即梦', src: '/static/images/jimeng.svg', monochrome: true },
    modelscope: { label: 'ModelScope', src: '/static/images/modelscope.gif', brandMark: true },
    volcengine: { label: '火山引擎', src: '/static/images/volcengine-theme-light.svg', brandMark: true },
    runninghub: { label: 'RunningHub', src: '/static/images/RunningHub-B.png', brandMark: true },
  });
  const styles = Object.freeze(['auto', 'outline', 'filled']);
  let outlineFilterSequence = 0;

  const matchVendor = (value) => {
    if (/mid[-_ ]?journey/.test(value)) return 'midjourney';
    if (/(?:^|[\s/._:-])(jimeng|即梦)(?:$|[\s/._:-])/.test(value)) return 'jimeng';
    if (/(?:doubao|seedance|seedream)/.test(value)) return 'doubao';
    if (/(?:gemini|nano[-_ ]?banana|imagen|veo|google[/:])/.test(value)) return 'gemini';
    if (/(?:grok|x[-_ ]?ai)/.test(value)) return 'grok';
    if (/(?:flux|black[-_ ]forest)/.test(value)) return 'flux';
    if (/(?:gpt|chatgpt|dall[-_ ]?e|openai|codex|(?:^|[/._:-])o[134](?:$|[/._:-]))/.test(value)) return 'openai';
    if (/modelscope/.test(value)) return 'modelscope';
    if (/(?:volcengine|火山引擎)/.test(value)) return 'volcengine';
    if (/runninghub/.test(value)) return 'runninghub';
    return '';
  };

  const resolve = (model = '', providerId = '', providerName = '') => {
    const modelKey = String(model || '').trim().toLowerCase();
    const providerKey = `${providerId || ''} ${providerName || ''}`.trim().toLowerCase();
    const vendor = matchVendor(modelKey) || matchVendor(providerKey);
    return vendor ? icons[vendor] : null;
  };

  const normalizeStyle = (style = 'auto') => styles.includes(style) ? style : 'auto';
  const escapeAttribute = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const genericOutlineIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="2"></rect><rect x="14" y="3" width="7" height="7" rx="2"></rect><rect x="8.5" y="14" width="7" height="7" rx="2"></rect></svg>';
  const genericFilledIcon = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="7" height="7" rx="2"></rect><rect x="14" y="3" width="7" height="7" rx="2"></rect><rect x="8.5" y="14" width="7" height="7" rx="2"></rect></svg>';
  const outlineIcon = (icon) => {
    const filterId = `model-icon-outline-${outlineFilterSequence += 1}`;
    return `<svg class="model-vendor-icon__outline-art" viewBox="0 0 24 24" aria-hidden="true"><defs><filter id="${filterId}" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="dilate" radius="1.15" result="dilated"></feMorphology><feMorphology in="SourceAlpha" operator="erode" radius="0.65" result="eroded"></feMorphology><feComposite in="dilated" in2="eroded" operator="out" result="outline"></feComposite><feFlood flood-color="currentColor" result="outlineColor"></feFlood><feComposite in="outlineColor" in2="outline" operator="in"></feComposite></filter></defs><image href="${escapeAttribute(icon.src)}" x="0" y="0" width="24" height="24" preserveAspectRatio="${icon.brandMark ? 'xMinYMid slice' : 'xMidYMid meet'}" filter="url(#${filterId})"></image></svg>`;
  };
  const markup = (model = '', providerId = '', providerName = '', requestedStyle = 'auto') => {
    const icon = resolve(model, providerId, providerName);
    const style = normalizeStyle(requestedStyle);
    const renderedStyle = style === 'auto' ? (icon ? 'filled' : 'outline') : style;
    if (!icon) {
      const genericIcon = renderedStyle === 'filled' ? genericFilledIcon : genericOutlineIcon;
      return `<span class="model-vendor-icon model-vendor-icon--fallback model-vendor-icon--${renderedStyle}" data-icon-style="${renderedStyle}" aria-hidden="true">${genericIcon}</span>`;
    }
    const classes = `model-vendor-icon model-vendor-icon--${renderedStyle}${icon.brandMark ? ' model-vendor-icon--brand-mark' : ''}`;
    const art = renderedStyle === 'outline'
      ? outlineIcon(icon)
      : `<img src="${escapeAttribute(icon.src)}" alt=""${icon.monochrome ? ' data-monochrome="true"' : ''}>`;
    return `<span class="${classes}" data-icon-style="${renderedStyle}" title="${escapeAttribute(icon.label)}" aria-hidden="true">${art}</span>`;
  };

  window.ModelVendorIcons = Object.freeze({ icons, styles, normalizeStyle, resolve, markup });
})();
