(() => {
  const tr = (key) => window.StudioI18n?.t?.(key) || key;
  const tf = (key, values) => window.StudioI18n?.format?.(key, values) || tr(key);
  const stateTools = window.AvailableModelManagementState;
  const labels = { image: 'models.image', video: 'models.video', text: 'models.text' };
  const state = {
    active: 'image',
    models: { image: [], video: [], text: [] },
    dragging: '',
    dirtyNames: new Map(),
    orderDirty: false,
    visibilityDirty: false,
    revision: 0,
    queued: false,
    inFlight: null,
  };
  const list = document.getElementById('model-list');
  const title = document.getElementById('catalog-title');
  const catalog = document.getElementById('model-catalog');
  const modelTypes = document.getElementById('model-types');
  const message = document.getElementById('page-message');

  const setMessage = (text, isError = false) => {
    message.textContent = text || '';
    message.setAttribute('tone', isError ? 'danger' : 'success');
    message.hidden = !text;
  };
  const request = async (url, options = {}) => {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || tr('models.operationRetry'));
    return payload;
  };
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const modelVendorIcon = (model) => {
    const template = document.createElement('template');
    template.innerHTML = (window.ModelVendorIcons?.markup(
      model.model,
      model.provider_id,
      model.provider_name,
      'auto',
    ) || '').trim();
    return template.content.firstElementChild || element('span', 'model-vendor-icon model-vendor-icon--fallback');
  };
  const iconButton = (icon, label, className, disabled, action) => {
    const button = element('ic-icon-button', className);
    button.setAttribute('type', 'button');
    button.setAttribute('hierarchy', 'quiet');
    button.setAttribute('icon', icon);
    button.setAttribute('label', label);
    button.toggleAttribute('disabled', disabled);
    button.addEventListener('click', action);
    return button;
  };
  const visibilityCheckbox = (model, kind) => {
    const checkbox = element('ic-checkbox', 'model-visibility-checkbox');
    checkbox.setAttribute('label', tf('models.showModel', { name: model.name || model.model }));
    checkbox.checked = model.visible !== false;
    checkbox.addEventListener('change', () => {
      stateTools.setModelVisibility(state.models, kind, model.id, checkbox.checked);
      state.visibilityDirty = true;
      state.revision += 1;
      setMessage('');
      commitChanges();
    });
    return checkbox;
  };
  const modelNameInput = (model) => {
    const input = element('ic-input', 'model-name-input');
    input.setAttribute('name', `model_name_${model.id}`);
    input.setAttribute('type', 'text');
    input.setAttribute('aria-label', tr('models.modelName'));
    input.setAttribute('value', model.name || model.model);
    input.setAttribute('maxlength', '160');
    const updateName = (event) => {
      const nativeControl = event.composedPath?.().find((node) => node instanceof HTMLInputElement)
        || event.currentTarget;
      const value = nativeControl?.value ?? input.value;
      input.value = value;
      Object.values(state.models).flat().forEach((entry) => {
        if (entry.id === model.id) entry.name = value;
      });
      state.dirtyNames.set(model.id, value);
      state.revision += 1;
      setMessage('');
    };
    input.addEventListener('input', updateName);
    customElements.whenDefined('ic-input').then(() => {
      input.shadowRoot?.querySelector('input')?.addEventListener('input', updateName);
    });
    input.addEventListener('pointerdown', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') commitChanges();
    });
    input.addEventListener('focusout', () => { commitChanges(); });
    return input;
  };
  const syncVisibleModelNames = () => {
    list.querySelectorAll('.model-row').forEach((row) => {
      const input = row.querySelector('ic-input.model-name-input');
      const value = input?.shadowRoot?.querySelector('input')?.value ?? input?.value;
      if (typeof value !== 'string') return;
      Object.values(state.models).flat().forEach((entry) => {
        if (entry.id !== row.dataset.modelId || entry.name === value) return;
        entry.name = value;
        state.dirtyNames.set(row.dataset.modelId, value);
        state.revision += 1;
      });
    });
  };
  const saveBody = () => ({
    ...Object.fromEntries(Object.entries(state.models).map(([kind, models]) => [kind, models.map((model) => model.id)])),
    names: Object.fromEntries(state.dirtyNames),
    visible: Object.fromEntries(Object.entries(state.models).map(([kind, models]) => [
      kind,
      models.filter((model) => model.visible !== false).map((model) => model.id),
    ])),
  });
  const returnedName = (models, modelId) => Object.values(models || {})
    .flat()
    .find((model) => model.id === modelId)?.name;
  const applySavedModelsInPlace = (savedModels) => {
    stateTools.applySavedModelsInPlace(state.models, savedModels);
  };
  const commitChanges = () => {
    syncVisibleModelNames();
    if (!state.orderDirty && !state.visibilityDirty && state.dirtyNames.size === 0) return Promise.resolve(true);
    const emptyName = [...state.dirtyNames.values()].some((name) => !String(name || '').trim());
    if (emptyName) {
      setMessage(tr('models.nameRequired'), true);
      return Promise.resolve(false);
    }
    state.queued = true;
    if (state.inFlight) return state.inFlight;
    state.inFlight = (async () => {
      while (state.queued) {
        state.queued = false;
        const savedRevision = state.revision;
        const submittedNames = new Map(state.dirtyNames);
        const submittedVisibility = new Map(Object.entries(state.models).flatMap(([kind, models]) => (
          models.map((model) => [`${kind}\0${model.id}`, model.visible !== false])
        )));
        const payload = await request('/api/admin/available-models', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(saveBody()),
        });
        const namesApplied = [...submittedNames].every(([modelId, name]) => (
          String(returnedName(payload.models, modelId) || '').trim() === String(name || '').trim()
        ));
        if (!namesApplied) throw new Error(tr('models.saveNotApplied'));
        const visibilityApplied = [...submittedVisibility].every(([key, expected]) => {
          const [kind, modelId] = key.split('\0');
          const returned = (payload.models?.[kind] || []).find((model) => model.id === modelId);
          return returned && (returned.visible !== false) === expected;
        });
        if (!visibilityApplied) throw new Error(tr('models.saveNotApplied'));

        const hasNewerChanges = state.revision !== savedRevision;
        submittedNames.forEach((name, modelId) => {
          if (state.dirtyNames.get(modelId) === name) state.dirtyNames.delete(modelId);
        });
        if (!hasNewerChanges) {
          applySavedModelsInPlace(payload.models);
          state.orderDirty = false;
          state.visibilityDirty = false;
        }
        try { parent.postMessage({ type: 'models-changed' }, '*'); } catch (_) {}
        try { new BroadcastChannel('studio-api').postMessage({ type: 'models-changed' }); } catch (_) {}
        if (hasNewerChanges || state.dirtyNames.size || state.orderDirty || state.visibilityDirty) state.queued = true;
      }
      setMessage('');
      return true;
    })().catch((reason) => {
      setMessage(reason.message || tr('models.saveFailed'), true);
      return false;
    }).finally(() => { state.inFlight = null; });
    return state.inFlight;
  };
  const move = (from, to) => {
    syncVisibleModelNames();
    const models = state.models[state.active];
    if (from < 0 || to < 0 || from >= models.length || to >= models.length || from === to) return;
    const [item] = models.splice(from, 1);
    models.splice(to, 0, item);
    state.orderDirty = true;
    state.revision += 1;
    render();
    commitChanges();
  };
  const render = () => {
    const models = state.models[state.active] || [];
    const activeLabel = tr(labels[state.active]);
    title.textContent = activeLabel;
    catalog.setAttribute('label', activeLabel);
    Object.keys(labels).forEach((kind) => {
      document.getElementById(`${kind}-count`).textContent = String((state.models[kind] || []).length);
    });
    list.replaceChildren();
    if (!models.length) {
      const empty = element('ic-empty-state');
      empty.setAttribute('title', tr('models.empty'));
      empty.setAttribute('label', activeLabel);
      list.appendChild(empty);
      return;
    }
    const tableComponent = element('ic-table', 'model-table');
    tableComponent.setAttribute('label', activeLabel);
    tableComponent.setAttribute('row-selection', 'none');
    const table = element('table');
    const caption = element('caption', 'visually-hidden', activeLabel);
    const head = element('thead');
    const headerRow = element('tr');
    [
      tr('models.icon'),
      tr('models.modelNaming'),
      tr('models.modelId'),
      tr('models.providerId'),
      tr('models.visibility'),
      tr('models.operations'),
    ].forEach((label) => {
      const header = element('th', '', label);
      header.setAttribute('scope', 'col');
      headerRow.appendChild(header);
    });
    head.appendChild(headerRow);
    const body = element('tbody');
    table.append(caption, head, body);
    tableComponent.appendChild(table);
    list.appendChild(tableComponent);
    models.forEach((model, index) => {
      const displayName = model.name || model.model;
      const row = element('tr', 'model-row');
      row.draggable = true;
      row.dataset.modelId = model.id;
      row.setAttribute('aria-label', tf('models.dragModel', { name: displayName }));
      row.title = tr('models.dragToOrder');

      const iconCell = element('td', 'model-icon-cell');
      iconCell.appendChild(modelVendorIcon(model));

      const nameCell = element('td', 'model-name-cell');
      const identity = element('div', 'model-identity');
      identity.appendChild(modelNameInput(model));
      nameCell.appendChild(identity);

      const modelIdCell = element('td', 'model-id', model.model);
      const providerIdCell = element('td', 'provider-id', model.provider_id);
      const visibilityCell = element('td', 'model-visibility-cell');
      visibilityCell.appendChild(visibilityCheckbox(model, state.active));

      const actionCell = element('td', 'model-actions-cell');
      const actions = element('ic-toolbar', 'order-actions');
      actions.setAttribute('appearance', 'plain');
      actions.setAttribute('label', tr('models.operations'));
      actions.append(
        iconButton('back', tr('models.moveUp'), 'move-up', index === 0, () => move(index, index - 1)),
        iconButton('forward', tr('models.moveDown'), 'move-down', index === models.length - 1, () => move(index, index + 1)),
      );
      actionCell.appendChild(actions);
      row.append(iconCell, nameCell, modelIdCell, providerIdCell, visibilityCell, actionCell);
      row.addEventListener('dragstart', (event) => {
        if (event.target.closest?.('ic-input')) {
          event.preventDefault();
          return;
        }
        state.dragging = model.id;
        row.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', model.id);
      });
      row.addEventListener('dragend', () => {
        state.dragging = '';
        list.querySelectorAll('.model-row').forEach((item) => item.classList.remove('dragging', 'drag-target'));
      });
      row.addEventListener('dragover', (event) => {
        event.preventDefault();
        if (state.dragging && state.dragging !== model.id) row.classList.add('drag-target');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-target'));
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const sourceId = state.dragging || event.dataTransfer.getData('text/plain');
        const sourceIndex = models.findIndex((item) => item.id === sourceId);
        move(sourceIndex, index);
      });
      body.appendChild(row);
    });
  };

  modelTypes.addEventListener('ic-change', (event) => {
    if (!labels[event.detail?.value]) return;
    syncVisibleModelNames();
    state.active = event.detail.value;
    render();
    commitChanges();
  });
  request('/api/admin/available-models')
    .then((payload) => { state.models = payload.models || state.models; render(); })
    .catch((reason) => setMessage(reason.message || tr('models.loadFailed'), true));
  window.addEventListener('studio-lang-change', () => {
    syncVisibleModelNames();
    render();
    if (!message.hidden) {
      setMessage('');
      request('/api/admin/available-models')
        .then((payload) => { state.models = payload.models ?? state.models; render(); })
        .catch((reason) => setMessage(reason.message || tr('models.loadFailed'), true));
    }
  });
})();
