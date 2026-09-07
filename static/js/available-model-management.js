(() => {
  const tr = (key) => window.StudioI18n?.t?.(key) || key;
  const tf = (key, values) => window.StudioI18n?.format?.(key, values) || tr(key);
  const stateTools = window.AvailableModelManagementState;
  const labels = { image: 'models.image', video: 'models.video', text: 'models.text' };
  const capabilityTagLabels = {
    layer_decomposition: 'models.tagLayerDecomposition',
    transparent_png: 'models.tagTransparentPng',
  };
  const state = {
    active: 'image',
    models: { image: [], video: [], text: [] },
    dragging: '',
    dirtyNames: new Map(),
    orderDirty: false,
    visibilityDirty: false,
    capabilityTags: new Map(),
    revision: 0,
    queued: false,
    inFlight: null,
    refreshQueued: false,
    refreshInFlight: null,
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
  const capabilityTags = (modelId) => {
    const container = element('div', 'model-capability-tags');
    (state.capabilityTags.get(modelId) || []).forEach((tag) => {
      const labelKey = capabilityTagLabels[tag];
      if (!labelKey) return;
      const badge = element('ic-badge', '', tr(labelKey));
      badge.setAttribute('kind', 'label');
      badge.setAttribute('tone', 'neutral');
      container.appendChild(badge);
    });
    return container;
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
  const modelDetailsButton = (model) => {
    const button = element('ic-button', 'model-capability-edit', tr('models.edit'));
    button.setAttribute('type', 'button');
    button.setAttribute('hierarchy', 'secondary');
    button.setAttribute('size', 'small');
    button.setAttribute('aria-label', tf('models.editModelDetails', { name: model.name || model.model }));
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!await commitChanges()) return;
      if (!window.ModelCapabilityEditor?.open) {
        setMessage(tr('models.detailsUnavailable'), true);
        return;
      }
      await window.ModelCapabilityEditor.open(model.model);
    });
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
    if (stateTools.applySavedModelsInPlace(state.models, savedModels)) render();
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
        if (!Object.keys(labels).every((kind) => Array.isArray(payload.models?.[kind]))) {
          throw new Error(tr('models.saveNotApplied'));
        }
        const namesApplied = [...submittedNames].every(([modelId, name]) => (
          returnedName(payload.models, modelId) === undefined
          || String(returnedName(payload.models, modelId) || '').trim() === String(name || '').trim()
        ));
        if (!namesApplied) throw new Error(tr('models.saveNotApplied'));
        const visibilityApplied = [...submittedVisibility].every(([key, expected]) => {
          const [kind, modelId] = key.split('\0');
          const returned = (payload.models?.[kind] || []).find((model) => model.id === modelId);
          return !returned || (returned.visible !== false) === expected;
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
    }).finally(() => {
      state.inFlight = null;
      if (state.refreshQueued) refreshModels();
    });
    return state.inFlight;
  };
  const setBackupMessage = (text, tone = 'neutral') => {
    const alert = document.getElementById('backup-message');
    alert.textContent = text;
    alert.setAttribute('tone', tone);
    alert.hidden = !text;
  };
  const showBackupError = (text) => {
    const alert = document.getElementById('api-transfer-error');
    alert.textContent = text;
    alert.hidden = !text;
  };
  let backupBusy = false;
  const runBackup = async (action) => {
    if (backupBusy) return;
    backupBusy = true;
    const buttons = ['export-model-settings', 'import-model-settings'].map(id => document.getElementById(id));
    buttons.forEach(button => { if (button) button.disabled = true; });
    try {
      if (state.inFlight && !await state.inFlight) return;
      if (!await commitChanges()) return;
      setBackupMessage('');
      await action();
    } finally {
      backupBusy = false;
      buttons.forEach(button => { if (button) button.disabled = false; });
    }
  };
  function apiSettingsImportInput(){
      return document.getElementById('apiSettingsImportInput');
  }
  let apiTransferPasswordResolve = null;
  let apiTransferCopy = null;
  let apiImportSummary = null;
  function backupPreviewDescription(summary){
      return tf('api.backupPreview', {
          added:summary.added, updated:summary.updated, models:summary.models,
          names:summary.providers.join(', ')
      }) + '\n\n' + tr(summary.version === 1 ? 'api.confirmLegacyPackageImport' : 'api.confirmPackageImport');
  }
  function refreshApiTransferCopy(){
      if(apiTransferCopy){
          const titleKey = apiTransferCopy.confirmPassword ? 'api.exportPackageTitle' : 'api.importPackageTitle';
          const dialog = document.getElementById('apiTransferDialog');
          dialog.setAttribute('data-i18n-label', titleKey);
          dialog.label = tr(titleKey);
          const title = document.getElementById('apiTransferTitle');
          title.setAttribute('data-i18n', titleKey);
          title.textContent = tr(titleKey);
          document.getElementById('apiTransferDescription').textContent = apiTransferCopy.confirmPassword
              ? tr('api.exportPackageDesc') : tf('api.importPackageDesc', {file:apiTransferCopy.fileName});
      }
      if(apiImportSummary){
          const dialog = document.getElementById('apiImportConfirmation');
          dialog.description = backupPreviewDescription(apiImportSummary);
          dialog.querySelector('[data-confirmation-copy]').textContent = dialog.description;
      }
  }
  async function closeApiTransferPassword(value=null){
      const dialog = document.getElementById('apiTransferDialog');
      const password = document.getElementById('apiTransferPassword');
      const confirmation = document.getElementById('apiTransferPasswordConfirm');
      if(password) password.value = '';
      if(confirmation) confirmation.value = '';
      const resolve = apiTransferPasswordResolve;
      apiTransferPasswordResolve = null;
      apiTransferCopy = null;
      // The next step may open a confirmation dialog; finish closing this one first.
      if(dialog?.open) await dialog.hide(value === null ? 'cancel' : 'submit');
      if(resolve) resolve(value);
  }
  function submitApiTransferPassword(event){
      event?.preventDefault?.();
      const password = document.getElementById('apiTransferPassword')?.value || '';
      const confirmation = document.getElementById('apiTransferPasswordConfirm')?.value || '';
      if(password.length < 8){
          showBackupError(tr('api.passwordMin'));
          return;
      }
      if(password.length > 256){
          showBackupError(tr('api.passwordMax'));
          return;
      }
      if(apiTransferCopy?.confirmPassword && password !== confirmation){
          showBackupError(tr('api.passwordMismatch'));
          return;
      }
      closeApiTransferPassword(password);
  }
  function requestApiTransferPassword({confirmPassword=false, fileName=''}={}){
      if(apiTransferPasswordResolve) closeApiTransferPassword(null);
      const dialog = document.getElementById('apiTransferDialog');
      const password = document.getElementById('apiTransferPassword');
      const confirmation = document.getElementById('apiTransferPasswordConfirm');
      const confirmationField = document.getElementById('apiTransferConfirmField');
      if(!dialog || !password || !confirmation) return Promise.resolve(null);
      showBackupError('');
      apiTransferCopy = {confirmPassword, fileName};
      refreshApiTransferCopy();
      confirmationField.hidden = !confirmPassword;
      password.value = '';
      confirmation.value = '';
      dialog.show();
      return new Promise(resolve => {
          apiTransferPasswordResolve = resolve;
      });
  }
  async function encryptedApiError(res, fallback){
      const data = await res.json().catch(() => ({}));
      const message = data.detail || data.message || fallback;
      return typeof message === 'string' && message.startsWith('api.') ? tr(message) : message;
  }
  async function exportEncryptedApiSettings(){
      const password = await requestApiTransferPassword({
          confirmPassword:true
      });
      if(password === null) return;
      setBackupMessage(tr('api.generatingPackage'));
      try {
          const res = await fetch('/api/providers/export-encrypted', {
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({password})
          });
          if(!res.ok) throw new Error(await encryptedApiError(res, tr('api.exportFailed')));
          const blob = await res.blob();
          const disposition = res.headers.get('Content-Disposition') || '';
          const match = disposition.match(/filename="?([^";]+)"?/i);
          const filename = match?.[1] || `infinite-canvas-api-settings-${Date.now()}.icapi`;
          const href = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = href;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(href), 1000);
          setBackupMessage(tr('api.packageExported'), 'success');
      } catch(err){
          setBackupMessage(err.message || tr('api.packageExportFailed'), 'danger');
      }
  }
  function chooseEncryptedApiSettings(){
      const input = apiSettingsImportInput();
      if(!input) return;
      input.clear({silent:true});
      input.open();
  }
  function requestApiImportConfirmation(summary){
      const dialog = document.getElementById('apiImportConfirmation');
      apiImportSummary = summary;
      refreshApiTransferCopy();
      return new Promise(resolve => {
          let settled = false;
          const finish = async accepted => {
              if(settled) return;
              settled = true;
              dialog.removeEventListener('ic-confirm', onConfirm);
              dialog.removeEventListener('ic-cancel', onCancel);
              if(accepted) await dialog.hide('confirm');
              apiImportSummary = null;
              resolve(accepted);
          };
          const onConfirm = () => { void finish(true); };
          const onCancel = () => { void finish(false); };
          dialog.addEventListener('ic-confirm', onConfirm);
          dialog.addEventListener('ic-cancel', onCancel);
          dialog.show();
      });
  }
  async function importEncryptedApiSettings(file){
      if(!file) return;
      const password = await requestApiTransferPassword({
          fileName:file.name,
          confirmPassword:false
      });
      if(password === null) return;
      const form = new FormData();
      form.append('file', file, file.name);
      form.append('password', password);
      setBackupMessage(tr('api.importingPackage'));
      try {
          form.append('preview', 'true');
          const previewResponse = await fetch('/api/providers/import-encrypted', {method:'POST', body:form});
          if(!previewResponse.ok) throw new Error(await encryptedApiError(previewResponse, tr('api.importFailed')));
          const summary = await previewResponse.json();
          if(!await requestApiImportConfirmation(summary)){ setBackupMessage(''); return; }
          form.set('preview', 'false');
          const res = await fetch('/api/providers/import-encrypted', {
              method:'POST',
              body:form
          });
          const data = await res.json().catch(() => ({}));
          if(!res.ok){
              const message = data.detail || data.message || tr('api.importFailed');
              throw new Error(typeof message === 'string' && message.startsWith('api.') ? tr(message) : message);
          }
          const addedNames = (data.added || []).map(item => item.name || item.id).filter(Boolean);
          const updatedNames = (data.updated || []).map(item => item.name || item.id).filter(Boolean);
          refreshModels();
          try { parent.postMessage({type:'providers-changed'}, location.origin); } catch (_) {}
          try {
              const channel = new BroadcastChannel('studio-api');
              channel.postMessage({type:'providers-changed'});
              channel.close();
          } catch (_) {}
          await window.ModelCapabilityEditor?.refresh();
          const addedText = addedNames.length
              ? tf('api.addedProviders', {count: addedNames.length, names: addedNames.join(', ')})
              : tr('api.noProvidersAdded');
          const updatedText = updatedNames.length
              ? tf('api.updatedProviders', {count: updatedNames.length, names: updatedNames.join(', ')})
              : '';
          setBackupMessage([addedText, updatedText].filter(Boolean).join(tr('api.messageSeparator')), 'success');
      } catch(err){
          setBackupMessage(err.message || tr('api.packageImportFailed'), 'danger');
      }
  }
  document.getElementById('export-model-settings')?.addEventListener('click', () => runBackup(exportEncryptedApiSettings));
  document.getElementById('import-model-settings')?.addEventListener('click', chooseEncryptedApiSettings);
  apiSettingsImportInput()?.addEventListener('ic-change', event => {
    const file = event.detail?.acceptedFiles?.[0];
    if(file) void runBackup(() => importEncryptedApiSettings(file));
  });
  document.getElementById('api-transfer-form')?.addEventListener('submit', submitApiTransferPassword);
  document.getElementById('api-transfer-submit')?.addEventListener('click', submitApiTransferPassword);
  document.getElementById('api-transfer-cancel')?.addEventListener('click', () => closeApiTransferPassword());
  document.getElementById('apiTransferDialog')?.addEventListener('ic-after-hide', () => {
    if(apiTransferPasswordResolve) void closeApiTransferPassword(null);
  });
  window.addEventListener('studio-lang-change', refreshApiTransferCopy);

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

      const nameCell = element('td', 'model-name-cell');
      const identity = element('div', 'model-identity');
      identity.append(modelVendorIcon(model), modelNameInput(model));
      nameCell.append(identity, capabilityTags(model.model));

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
        modelDetailsButton(model),
      );
      actionCell.appendChild(actions);
      row.append(nameCell, modelIdCell, providerIdCell, visibilityCell, actionCell);
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
  window.addEventListener('model-capability-matrix-change', (event) => {
    state.capabilityTags = new Map((event.detail?.matrix?.models || []).map((model) => [
      model.model_id,
      Array.isArray(model.capability_tags) ? model.capability_tags : [],
    ]));
    render();
  });
  const hasPendingEdits = () => state.inFlight || state.dirtyNames.size || state.orderDirty || state.visibilityDirty;
  let refreshTimer = null;
  const refreshModels = () => {
    state.refreshQueued = true;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (state.refreshInFlight || hasPendingEdits()) return;
      state.refreshInFlight = (async () => {
        while (state.refreshQueued && !hasPendingEdits()) {
          state.refreshQueued = false;
          const revision = state.revision;
          const payload = await request('/api/admin/available-models');
          if (state.refreshQueued || revision !== state.revision || hasPendingEdits()) {
            state.refreshQueued = true;
            continue;
          }
          state.models = payload.models || state.models;
          render();
          setMessage('');
        }
      })().catch((reason) => {
        state.refreshQueued = false;
        setMessage(reason.message || tr('models.loadFailed'), true);
      }).finally(() => { state.refreshInFlight = null; });
    }, 0);
  };
  const receiveModelChange = (event) => {
    if (['providers-changed', 'models-changed'].includes(event.data?.type)) refreshModels();
  };
  window.addEventListener('message', (event) => {
    if (event.origin === window.location.origin) receiveModelChange(event);
  });
  try {
    const channel = new BroadcastChannel('studio-api');
    channel.onmessage = receiveModelChange;
  } catch (_) {}
  window.addEventListener('focus', refreshModels);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshModels();
  });
  refreshModels();
  window.addEventListener('studio-lang-change', () => {
    syncVisibleModelNames();
    render();
    if (!message.hidden) {
      refreshModels();
    }
  });
})();
