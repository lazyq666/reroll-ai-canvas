(() => {
  function firstGrapheme(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
      const segment = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        .segment(text)[Symbol.iterator]().next().value;
      return String(segment?.segment || '');
    } catch (_) {
      return Array.from(text)[0] || '';
    }
  }

  function initial(user = {}) {
    const grapheme = firstGrapheme(user.display_name) || firstGrapheme(user.username);
    return /^[a-z]$/i.test(grapheme) ? grapheme.toLocaleUpperCase() : grapheme;
  }

  function normalizeSlot(value) {
    const slot = Number(value);
    return Number.isInteger(slot) && slot >= 1 && slot <= 10 ? slot : 1;
  }

  function apply(element, user = {}) {
    if (!element) return element;
    element.classList.add('ic-account-avatar');
    element.setAttribute('aria-hidden', 'true');
    element.dataset.avatarColorSlot = String(normalizeSlot(user.avatar_color_slot));
    const mark = initial(user);
    if (mark) {
      element.textContent = mark;
    } else {
      const icon = document.createElement('ic-icon');
      icon.setAttribute('name', 'account');
      icon.setAttribute('size', 'small');
      icon.setAttribute('aria-hidden', 'true');
      element.replaceChildren(icon);
    }
    return element;
  }

  function create(user = {}, { tag = 'span' } = {}) {
    return apply(document.createElement(tag), user);
  }

  window.InfiniteCanvasAccountAvatar = Object.freeze({ apply, create, initial, normalizeSlot });
})();
