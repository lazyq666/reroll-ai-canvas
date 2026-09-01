(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UiComponentFixtureAdapters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const INTERACTIONS = {
    Button: ['click', 'focus', 'disabled'],
    Input: ['input', 'focus', 'disabled', 'readonly'],
    Textarea: ['input', 'focus', 'disabled', 'readonly'],
    Select: ['change', 'focus', 'disabled'],
    Checkbox: ['change', 'focus', 'disabled'],
    Radio: ['change', 'focus', 'disabled'],
    Switch: ['change', 'focus', 'disabled'],
    Slider: ['input', 'focus', 'disabled'],
    'File Upload': ['drop', 'file-selection-blocked', 'reset'],
    Tabs: ['click', 'focus'],
    Pagination: ['click', 'focus'],
    Menu: ['open-close', 'focus'],
    Popover: ['open-close', 'focus'],
    Tooltip: ['open-close', 'focus'],
    Dialog: ['open-close', 'focus'],
    'Confirmation Dialog': ['open-close', 'focus'],
    'Loading / Progress': ['replay'],
    Toast: ['replay'],
    Alert: ['replay'],
    Badge: ['replay'],
    Toolbar: ['click', 'focus'],
    Card: ['click', 'focus'],
    Divider: ['reset'],
    'Graphic Asset': ['theme', 'reset', 'replay'],
    'Lucide Icon': ['theme', 'reset', 'replay'],
    'Inline SVG': ['theme', 'reset', 'replay'],
  };

  const COMMON_STATES = ['default', 'dark'];

  function profileFor(componentType, inventoryKind = '') {
    const graphic = ['graphic-asset', 'lucide-icon', 'inline-svg'].includes(inventoryKind);
    return {
      naturalInteractions: graphic
        ? ['theme', 'reset', 'replay']
        : [...(INTERACTIONS[componentType] || ['reset'])],
      forcedStates: graphic ? [...COMMON_STATES, 'replay'] : [...COMMON_STATES, 'focus-visible'],
    };
  }

  function setTheme(host, theme) {
    const dark = theme === 'dark';
    host.documentElement?.classList.toggle('theme-dark', dark);
    host.documentElement?.classList.toggle('studio-theme-dark', dark);
    host.body?.classList.toggle('theme-dark', dark);
    host.body?.classList.toggle('studio-theme-dark', dark);
    host.documentElement?.setAttribute('data-ui-theme', dark ? 'dark' : 'light');
  }

  function captureRoot(root) {
    return {
      attributes: [...root.attributes].map((attribute) => [attribute.name, attribute.value]),
      innerHTML: root.innerHTML,
      value: 'value' in root ? root.value : undefined,
      checked: 'checked' in root ? root.checked : undefined,
      selectedIndex: 'selectedIndex' in root ? root.selectedIndex : undefined,
    };
  }

  function restoreRoot(root, initial) {
    for (const attribute of [...root.attributes]) root.removeAttribute(attribute.name);
    for (const [name, value] of initial.attributes) root.setAttribute(name, value);
    root.innerHTML = initial.innerHTML;
    if (initial.value !== undefined) root.value = initial.value;
    if (initial.checked !== undefined) root.checked = initial.checked;
    if (initial.selectedIndex !== undefined) root.selectedIndex = initial.selectedIndex;
  }

  function revealFixturePath(root) {
    const path = [];
    let element = root;
    while (element && element.id !== 'fixture-root') {
      path.push(element);
      element = element.parentElement;
    }
    for (const node of path.reverse()) {
      node.hidden = false;
      node.removeAttribute('hidden');
      node.classList.remove('hidden', 'is-hidden');
      if (node.getAttribute('aria-hidden') === 'true') node.setAttribute('aria-hidden', 'false');
      const bounds = node.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) {
        node.style?.setProperty('display', 'revert', 'important');
        node.style?.setProperty('visibility', 'visible', 'important');
      }
    }
  }

  function applyPresentation(host, root, presentation = {}) {
    for (const [name, value] of Object.entries(presentation.rootStyles || {})) {
      root.style?.setProperty(name, value);
    }
    for (const item of presentation.ancestors || []) {
      const element = host.querySelector(item.selector);
      if (!element) continue;
      for (const className of item.classes || []) element.classList.add(className);
      for (const [name, value] of Object.entries(item.attributes || {})) element.setAttribute(name, value);
      for (const [name, value] of Object.entries(item.styles || {})) element.style?.setProperty(name, value);
    }
  }

  function sourceComponent(host, emit, timers = globalThis, candidate = {}) {
    const fixture = candidate.fixture || {};
    let root = host.querySelector(fixture.rootSelector || '[data-live-fixture-root] > :first-child');
    if (!root) throw new Error(`source fixture is missing ${fixture.rootSelector || 'its root'}`);
    const initial = captureRoot(root);
    const stateBindings = fixture.stateBindings || {};
    let state = { theme: 'light', interaction: 'default' };

    function publish(type = 'state-changed') {
      emit({ type, state: { ...state }, demoData: true });
    }

    function clearBindings() {
      for (const binding of Object.values(stateBindings)) {
        for (const className of binding.classes || []) root.classList.remove(className);
        for (const name of Object.keys(binding.attributes || {})) root.removeAttribute(name);
      }
      root.removeAttribute('aria-busy');
      root.removeAttribute('aria-invalid');
    }

    function replay() {
      const replacement = root.cloneNode(true);
      root.replaceWith(replacement);
      root = replacement;
    }

    function apply(next = {}) {
      state = { ...state, ...next };
      setTheme(host, state.theme);
      clearBindings();
      const interaction = state.interaction || 'default';
      const binding = stateBindings[interaction] || {};
      for (const className of binding.classes || []) root.classList.add(className);
      for (const [name, value] of Object.entries(binding.attributes || {})) root.setAttribute(name, value);

      if (interaction === 'open') {
        root.hidden = false;
        root.removeAttribute('hidden');
        root.classList.remove('hidden');
        root.style?.removeProperty('display');
        root.style?.removeProperty('visibility');
        if (root.tagName === 'DIALOG' && !root.open) root.showModal?.();
      }
      if (interaction === 'closed') {
        if (root.tagName === 'DIALOG' && root.open) root.close?.();
        root.setAttribute('aria-hidden', 'true');
      }
      if (interaction === 'disabled') root.setAttribute('disabled', '');
      if (interaction === 'readonly') root.setAttribute('readonly', '');
      if (interaction === 'loading') root.setAttribute('aria-busy', 'true');
      if (interaction === 'error') root.setAttribute('aria-invalid', 'true');
      if (interaction === 'filled' && 'value' in root) root.value = root.value || '演示内容';
      if (interaction === 'selected') {
        if ('checked' in root) root.checked = true;
        root.setAttribute('aria-selected', 'true');
        root.setAttribute('aria-checked', 'true');
        root.setAttribute('aria-pressed', 'true');
      }
      if (interaction === 'partial') root.indeterminate = true;
      if (interaction === 'replay' || interaction === 'enter') replay();
      if (interaction === 'focus-visible') root.focus?.({ preventScroll: true });
      if (interaction !== 'closed') revealFixturePath(root);
      applyPresentation(host, root, fixture.presentation);
      publish();
    }

    function reset() {
      restoreRoot(root, initial);
      state = { theme: 'light', interaction: 'default' };
      setTheme(host, 'light');
      const resetState = fixture.resetState || state;
      if (resetState.theme !== 'light' || resetState.interaction !== 'default') apply(resetState);
      else {
        revealFixturePath(root);
        applyPresentation(host, root, fixture.presentation);
      }
      publish('reset-complete');
    }

    host.addEventListener('click', (event) => {
      if (!root.contains(event.target) && event.target !== root) return;
      if (root.matches('[aria-pressed], [role="switch"]')) {
        const pressed = root.getAttribute('aria-pressed') === 'true' || root.getAttribute('aria-checked') === 'true';
        root.setAttribute(root.matches('[role="switch"]') ? 'aria-checked' : 'aria-pressed', pressed ? 'false' : 'true');
      }
      publish('natural-interaction');
    });
    host.addEventListener('input', (event) => {
      if (root.contains(event.target) || event.target === root) publish('natural-interaction');
    });
    host.addEventListener('change', (event) => {
      if (root.contains(event.target) || event.target === root) publish('natural-interaction');
    });
    host.addEventListener('dragover', (event) => {
      if (!root.contains(event.target) && event.target !== root) return;
      event.preventDefault();
      root.classList.add('drag-over');
    });
    host.addEventListener('dragleave', () => root.classList.remove('drag-over'));
    host.addEventListener('drop', (event) => {
      if (!root.contains(event.target) && event.target !== root) return;
      event.preventDefault();
      root.classList.remove('drag-over');
      root.dataset.demoFiles = String(event.dataTransfer?.files?.length || 0);
      publish('natural-interaction');
    });

    reset();
    return { setState: apply, reset, getState: () => ({ ...state }) };
  }

  function primaryButton(host, emit, timers = globalThis) {
    const button = host.querySelector('#runBtn');
    if (!button) throw new Error('primary button fixture is missing #runBtn');
    let loadingTimer = null;
    let state = { theme: 'light', interaction: 'default' };
    const supportedInteractions = new Set(['default', 'hover', 'disabled']);

    function publish(type = 'state-changed') {
      emit({ type, state: { ...state }, demoData: true });
    }
    function apply(next) {
      if (next.interaction && !supportedInteractions.has(next.interaction)) {
        throw new Error(`primary button fixture does not implement ${next.interaction}`);
      }
      state = { ...state, ...next };
      setTheme(host, state.theme);
      button.disabled = state.interaction === 'disabled';
      button.setAttribute('aria-busy', 'false');
      button.querySelector('span').textContent = '运行';
      publish();
    }
    function reset() {
      if (loadingTimer !== null) timers.clearTimeout(loadingTimer);
      loadingTimer = null;
      state = { theme: 'light', interaction: 'default' };
      apply(state);
      publish('reset-complete');
    }
    button.addEventListener('click', () => {
      if (button.disabled) return;
      apply({ interaction: 'disabled' });
      loadingTimer = timers.setTimeout(() => {
        loadingTimer = null;
        apply({ interaction: 'default' });
      }, 700);
    });
    reset();
    return { setState: apply, reset, getState: () => ({ ...state }) };
  }

  return {
    profileFor,
    sourceComponent,
    primaryButton,
    create(name, host, emit, timers, candidate) {
      if (name === 'primary-button') return primaryButton(host, emit, timers);
      if (name === 'source-component' || name === 'graphic-resource') {
        return sourceComponent(host, emit, timers, candidate);
      }
      throw new Error(`Unknown fixture adapter: ${name}`);
    },
  };
});
