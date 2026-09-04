(() => {
  const tr = (key) => window.StudioI18n?.t?.(key) || key;
  const tf = (key, values) => window.StudioI18n?.format?.(key, values) || tr(key);
  const byId = (id) => document.getElementById(id);
  const viewTabs = byId('management-sections');
  const catalogView = byId('model-catalog-view');
  const capabilityView = byId('capability-workbench-view');
  if (!viewTabs || !catalogView || !capabilityView) return;

  const controls = {
    page: document.querySelector('.model-page'),
    message: byId('capability-message'),
    sync: byId('capability-sync-models'),
    refresh: byId('capability-refresh'),
    importOpen: byId('capability-import-open'),
    sourceStatus: byId('capability-source-refresh-status'),
    modelCount: byId('capability-model-count'),
    confirmedCount: byId('capability-confirmed-count'),
    missingCount: byId('capability-missing-count'),
    search: byId('capability-search'),
    rows: byId('capability-model-rows'),
    empty: byId('capability-empty'),
    editor: byId('capability-editor'),
    editorTitle: byId('capability-editor-title'),
    editorModelId: byId('capability-editor-model-id'),
    editorSources: byId('capability-editor-source-summary'),
    operationEditors: byId('capability-operation-editors'),
    close: byId('capability-editor-close'),
    apply: byId('capability-apply'),
    importDialog: byId('capability-import-dialog'),
    importData: byId('capability-import-data'),
    importStatus: byId('capability-import-status'),
    copyLookup: byId('capability-copy-lookup'),
    importCancel: byId('capability-import-cancel'),
    importPreview: byId('capability-import-preview'),
    importApply: byId('capability-import-apply'),
  };
  const state = {
    loaded: false,
    matrix: { models: [], summary: {} },
    selectedModelId: '',
    query: '',
    validatedImport: '',
  };
  const inputTypes = ['text', 'image', 'video', 'audio', 'file'];
  const operationLabels = {
    'image.generate': 'models.operationImageGenerate',
    'image.edit': 'models.operationImageEdit',
    'image.layer_decomposition': 'models.operationLayerDecomposition',
    'video.generate': 'models.operationVideoGenerate',
    'text.generate': 'models.operationTextGenerate',
  };
  const typeLabels = { image: 'models.image', video: 'models.video', text: 'models.text' };
  const inputLabels = {
    text: 'models.inputText', image: 'models.inputImage', video: 'models.inputVideo',
    audio: 'models.inputAudio', file: 'models.inputFile',
  };
  const optionLabels = {
    transparent_png: 'models.optionTransparentPng',
    prompt_enhancement: 'models.optionPromptEnhancement',
    enhance_prompt: 'models.optionPromptEnhancement',
    generate_audio: 'models.optionGenerateAudio',
    enable_upsample: 'models.optionUpsample',
    camera_fixed: 'models.optionFixedCamera',
    watermark: 'models.optionWatermark',
  };
  const resolutionDefaults = {
    'image.generate': ['auto', '1K', '1.5K', '2K', '4K'],
    'image.edit': ['auto', '1K', '1.5K', '2K', '4K'],
    'image.layer_decomposition': ['auto', '1K', '1.5K', '2K'],
    'video.generate': ['480p', '720p', '1080p', '4K'],
  };
  const ratioDefaults = {
    'image.generate': ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'],
    'image.edit': ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'],
    'video.generate': ['1:1', '3:4', '4:3', '9:16', '16:9', '21:9'],
  };

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const setDisabled = (control, disabled) => control?.toggleAttribute('disabled', Boolean(disabled));
  const getValue = (control) => String(control?.value ?? control?.getAttribute?.('value') ?? '');
  const showMessage = (key, tone = 'success', values = {}) => {
    controls.message.textContent = key ? tf(key, values) : '';
    controls.message.setAttribute('tone', tone);
    controls.message.hidden = !key;
  };
  const errorMessage = (payload) => {
    const detail = payload?.detail;
    const code = typeof detail === 'object' ? detail?.code : '';
    const reason = typeof detail === 'object' ? detail?.reason : '';
    if (code === 'model_capability_import_invalid' && reason) {
      const reasonKey = `models.importError.${reason}`;
      if (tr(reasonKey) !== reasonKey) {
        return tf(reasonKey, {
          model: detail?.model_id || tr('models.unknownModel'),
          operation: detail?.operation || tr('models.unknownOperation'),
        });
      }
    }
    if (code) {
      const key = `models.error.${code}`;
      if (tr(key) !== key) return tr(key);
    }
    return typeof detail === 'string' && detail.trim() ? detail : tr('models.operationRetry');
  };
  const request = async (url, options = {}) => {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorMessage(payload));
    return payload;
  };
  const selectedRow = () => state.matrix.models.find((row) => row.model_id === state.selectedModelId) || null;
  const chipList = (values) => {
    const list = element('div', 'capability-chip-list');
    values.forEach((value) => list.appendChild(element('span', 'capability-chip', value)));
    return list;
  };
  const checkbox = (label, checked, data = {}) => {
    const control = element('ic-checkbox');
    control.setAttribute('label', label);
    control.checked = Boolean(checked);
    Object.entries(data).forEach(([key, value]) => { control.dataset[key] = String(value); });
    return control;
  };
  const optionList = (values, selected, kind) => {
    const list = element('div', 'capability-option-list');
    values.forEach((value) => list.appendChild(checkbox(value, selected.includes(value), { choiceKind: kind, choiceValue: value })));
    return list;
  };
  const choiceGroup = (labelKey, content) => {
    const group = element('div', 'capability-choice-group');
    group.append(element('strong', '', tr(labelKey)), content);
    return group;
  };
  const operationOptions = (operation) => {
    if (operation.operation === 'image.layer_decomposition') return [];
    const existing = Object.keys(operation.options || {});
    const defaults = operation.operation.startsWith('image.')
      ? ['transparent_png', 'prompt_enhancement']
      : operation.operation === 'video.generate'
        ? ['enhance_prompt', 'generate_audio', 'enable_upsample', 'camera_fixed']
        : [];
    return [...new Set([...existing, ...defaults])];
  };
  const renderOperationEditor = (operation) => {
    const card = element('section', 'capability-operation-card');
    card.dataset.operation = operation.operation;
    const header = element('div', 'capability-operation-header');
    header.append(
      element('h4', '', tr(operationLabels[operation.operation] || 'models.capabilityOverview')),
      checkbox(tr('models.settingsConfirmed'), operation.confirmed, { confirmed: 'true' }),
    );
    const grid = element('div', 'capability-choice-grid');

    const inputList = element('div', 'capability-option-list');
    inputTypes.forEach((inputType) => {
      const wrapper = element('div', 'capability-input-choice');
      const maximum = Number(operation.inputs?.[inputType] || 0);
      const toggle = checkbox(tr(inputLabels[inputType]), maximum > 0, { inputType });
      const lockedLayerInput = operation.operation === 'image.layer_decomposition';
      const select = element('ic-select', 'capability-count-select');
      select.dataset.inputMaximum = inputType;
      select.setAttribute('label', tf('models.maximumInputCount', { type: tr(inputLabels[inputType]) }));
      [1, 2, 3, 4, 8, 10, 20].forEach((value) => {
        const option = element('option', '', String(value));
        option.value = String(value);
        select.appendChild(option);
      });
      select.value = String(maximum || 1);
      select.setAttribute('value', String(maximum || 1));
      select.hidden = maximum === 0;
      toggle.addEventListener('change', () => { select.hidden = !toggle.checked; });
      setDisabled(toggle, lockedLayerInput);
      setDisabled(select, lockedLayerInput);
      wrapper.append(toggle, select);
      inputList.appendChild(wrapper);
    });
    grid.appendChild(choiceGroup('models.acceptedInputs', inputList));

    const outputSelect = element('ic-select', 'capability-count-select');
    outputSelect.dataset.outputMaximum = 'true';
    outputSelect.setAttribute('label', tr('models.maximumOutputCount'));
    [1, 2, 3, 4, 8, 10, 20].forEach((value) => {
      const option = element('option', '', String(value));
      option.value = String(value);
      outputSelect.appendChild(option);
    });
    outputSelect.value = String(operation.output_count_maximum || 1);
    outputSelect.setAttribute('value', String(operation.output_count_maximum || 1));
    setDisabled(outputSelect, operation.operation === 'image.layer_decomposition');
    grid.appendChild(choiceGroup('models.outputQuantity', outputSelect));

    const resolutions = [...new Set([...(operation.resolutions || []), ...(resolutionDefaults[operation.operation] || [])])];
    if (resolutions.length) grid.appendChild(choiceGroup('models.allowedResolutions', optionList(resolutions, operation.resolutions || [], 'resolution')));
    const ratios = [...new Set([...(operation.aspect_ratios || []), ...(ratioDefaults[operation.operation] || [])])];
    if (ratios.length) grid.appendChild(choiceGroup('models.allowedRatios', optionList(ratios, operation.aspect_ratios || [], 'ratio')));
    const options = operationOptions(operation);
    if (options.length) {
      const enabled = Object.entries(operation.options || {}).filter(([, value]) => value).map(([key]) => key);
      const list = element('div', 'capability-option-list');
      options.forEach((key) => list.appendChild(checkbox(tr(optionLabels[key] || 'models.otherCapability'), enabled.includes(key), { feature: key })));
      grid.appendChild(choiceGroup('models.additionalCapabilities', list));
    }
    card.append(header, grid);
    return card;
  };

  const renderEditor = () => {
    const row = selectedRow();
    controls.editor.hidden = !row;
    if (!row) return;
    controls.editorTitle.textContent = row.name;
    controls.editorModelId.textContent = row.model_id;
    controls.editorSources.textContent = row.evidence_count
      ? tf('models.sourceSummaryAvailable', { count: row.evidence_count })
      : tr('models.sourceSummaryMissing');
    controls.operationEditors.replaceChildren(...row.operations.map(renderOperationEditor));
    controls.editor.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const sourceStatus = () => {
    const summary = state.matrix.summary || {};
    controls.sourceStatus.textContent = summary.with_sources
      ? tf('models.sourceCoverage', { sourced: summary.with_sources, total: summary.models || 0 })
      : tr('models.noSourcesMatched');
  };
  const renderRows = () => {
    const query = state.query.trim().toLocaleLowerCase();
    const rows = state.matrix.models.filter((row) => !query || [row.name, row.model_id, ...row.names]
      .some((value) => String(value).toLocaleLowerCase().includes(query)));
    controls.rows.replaceChildren();
    rows.forEach((row) => {
      const tableRow = element('tr');
      const model = element('td');
      model.append(element('strong', 'capability-model-name', row.name), element('span', 'capability-model-id', row.model_id));
      const providers = element('td');
      providers.appendChild(chipList(row.providers.map((provider) => provider.name)));
      const types = element('td');
      types.appendChild(chipList(row.types.map((type) => tr(typeLabels[type]))));
      const abilities = element('td');
      const confirmed = row.operations.filter((operation) => operation.confirmed)
        .map((operation) => tr(operationLabels[operation.operation] || 'models.capabilityOverview'));
      abilities.appendChild(confirmed.length ? chipList(confirmed) : element('span', 'capability-status', tr('models.capabilitiesPending')));
      const sources = element('td');
      sources.appendChild(element('span', `capability-status${row.evidence_count ? ' is-ready' : ''}`,
        row.evidence_count ? tf('models.sourceCount', { count: row.evidence_count }) : tr('models.sourcesMissing')));
      const actions = element('td');
      const edit = element('ic-button');
      edit.setAttribute('type', 'button');
      edit.setAttribute('hierarchy', 'secondary');
      edit.setAttribute('size', 'small');
      edit.textContent = tr('models.setCapabilities');
      edit.addEventListener('click', () => { state.selectedModelId = row.model_id; renderEditor(); });
      actions.appendChild(edit);
      tableRow.append(model, providers, types, abilities, sources, actions);
      controls.rows.appendChild(tableRow);
    });
    controls.empty.hidden = rows.length > 0;
  };
  const render = () => {
    const summary = state.matrix.summary || {};
    controls.modelCount.textContent = String(summary.models || 0);
    controls.confirmedCount.textContent = String(summary.confirmed || 0);
    controls.missingCount.textContent = String(summary.needs_sources || 0);
    sourceStatus();
    renderRows();
    renderEditor();
  };
  const loadMatrix = async () => {
    state.matrix = await request('/api/admin/model-capability-matrix');
    state.loaded = true;
    if (state.selectedModelId && !selectedRow()) state.selectedModelId = '';
    render();
  };
  const runAction = (action) => async () => {
    showMessage('');
    try { await action(); } catch (error) { showMessage('', 'danger'); controls.message.textContent = error.message || tr('models.operationRetry'); controls.message.hidden = false; }
  };
  const runImportAction = (action) => async () => {
    controls.importStatus.hidden = true;
    try {
      await action();
    } catch (error) {
      controls.importStatus.textContent = error.message || tr('models.operationRetry');
      controls.importStatus.setAttribute('tone', 'danger');
      controls.importStatus.hidden = false;
    }
  };
  const syncModels = async () => {
    setDisabled(controls.sync, true);
    try { await loadMatrix(); showMessage('models.modelsSynced', 'success', { count: state.matrix.summary.models || 0 }); }
    finally { setDisabled(controls.sync, false); }
  };
  const refreshSources = async () => {
    setDisabled(controls.refresh, true);
    try {
      const result = await request('/api/admin/model-capabilities/refresh', { method: 'POST' });
      await loadMatrix();
      showMessage('models.sourcesChecked', 'success', {
        evidence: Number(result.refresh?.evidence_created || 0),
        drafts: Number(result.refresh?.drafts_created || 0),
        missing: Number(state.matrix.summary.needs_sources || 0),
      });
    } finally { setDisabled(controls.refresh, false); }
  };
  const importExample = () => {
    return {
      schema_version: 1,
      models: [{
        model_id: 'COPY_EXACT_MODEL_ID_FROM_LIST',
        name: 'COPY_EXACT_MODEL_NAME_FROM_LIST',
        operations: [{
          operation: 'COPY_ONE_AVAILABLE_OPERATION',
          confirmed: true,
          inputs: { text: 0, image: 0, video: 0, audio: 0, file: 0 },
          resolutions: [],
          aspect_ratios: [],
          output_count_maximum: 1,
          options: [],
          sources: [{
            type: 'official_docs',
            url: 'https://official.example/model-docs',
            title: 'Official capability documentation',
            excerpt: 'A short passage that directly supports these capability values.',
          }],
        }],
      }],
    };
  };
  const lookupPrompt = () => {
    const models = state.matrix.models.map((row) => ({
      model_id: row.model_id,
      name: row.name,
      operations: row.operations.map((operation) => operation.operation),
    }));
    return [
      tr('models.lookupPromptRole'),
      tr('models.lookupPromptOfficialSources'),
      tr('models.lookupPromptNoGuessing'),
      tr('models.lookupPromptIdentity'),
      tr('models.lookupPromptNoCommercial'),
      tr('models.lookupPromptOptions'),
      tr('models.lookupPromptJsonOnly'),
      '',
      tr('models.lookupPromptCurrentModels'),
      JSON.stringify(models, null, 2),
      '',
      tr('models.lookupPromptFormat'),
      JSON.stringify(importExample(), null, 2),
    ].join('\n');
  };
  const copyLookupPrompt = async () => {
    const value = lookupPrompt();
    try {
      await navigator.clipboard.writeText(value);
    } catch (_error) {
      const fallback = element('textarea');
      fallback.value = value;
      fallback.setAttribute('readonly', '');
      fallback.className = 'visually-hidden';
      document.body.appendChild(fallback);
      fallback.select();
      if (!document.execCommand('copy')) throw new Error(tr('models.copyLookupFailed'));
      fallback.remove();
    }
    controls.importStatus.textContent = tr('models.lookupPromptCopied');
    controls.importStatus.setAttribute('tone', 'success');
    controls.importStatus.hidden = false;
  };
  const resetImportValidation = () => {
    state.validatedImport = '';
    setDisabled(controls.importApply, true);
  };
  const parseImport = () => {
    const raw = getValue(controls.importData).trim();
    if (!raw) throw new Error(tr('models.importDataRequired'));
    try {
      return { raw, bundle: JSON.parse(raw) };
    } catch (_error) {
      throw new Error(tr('models.importJsonInvalid'));
    }
  };
  const submitImport = async (apply) => {
    const parsed = parseImport();
    if (apply && state.validatedImport !== parsed.raw) throw new Error(tr('models.importChangedAfterPreview'));
    const result = await request('/api/admin/model-capability-matrix/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apply, bundle: parsed.bundle }),
    });
    if (!apply) {
      state.validatedImport = parsed.raw;
      setDisabled(controls.importApply, false);
      controls.importStatus.textContent = tf('models.importPreviewReady', result.preview || {});
      controls.importStatus.setAttribute('tone', 'success');
      controls.importStatus.hidden = false;
      return;
    }
    state.matrix = result.matrix || state.matrix;
    render();
    await controls.importDialog.hide();
    showMessage('models.importApplied', 'success', result.preview || {});
  };
  const openImport = async () => {
    resetImportValidation();
    controls.importStatus.hidden = true;
    await controls.importDialog.show();
  };
  const readOperation = (card) => {
    const inputs = {};
    inputTypes.forEach((inputType) => {
      const toggle = card.querySelector(`[data-input-type="${inputType}"]`);
      const maximum = card.querySelector(`[data-input-maximum="${inputType}"]`);
      inputs[inputType] = toggle?.checked ? Number(getValue(maximum) || 1) : 0;
    });
    return {
      operation: card.dataset.operation,
      confirmed: Boolean(card.querySelector('[data-confirmed]')?.checked),
      inputs,
      resolutions: [...card.querySelectorAll('[data-choice-kind="resolution"]')].filter((item) => item.checked).map((item) => item.dataset.choiceValue),
      aspect_ratios: [...card.querySelectorAll('[data-choice-kind="ratio"]')].filter((item) => item.checked).map((item) => item.dataset.choiceValue),
      output_count_maximum: Number(getValue(card.querySelector('[data-output-maximum]')) || 1),
      options: [...card.querySelectorAll('[data-feature]')].filter((item) => item.checked).map((item) => item.dataset.feature),
    };
  };
  const apply = async () => {
    const row = selectedRow();
    if (!row) return;
    setDisabled(controls.apply, true);
    try {
      const payload = await request('/api/admin/model-capability-matrix', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_id: row.model_id,
          name: row.name,
          operations: [...controls.operationEditors.querySelectorAll('.capability-operation-card')].map(readOperation),
        }),
      });
      state.matrix = payload.matrix;
      render();
      showMessage('models.capabilitiesApplied');
    } finally { setDisabled(controls.apply, false); }
  };
  const showSection = async (value) => {
    const capabilities = value === 'capabilities';
    catalogView.hidden = capabilities;
    capabilityView.hidden = !capabilities;
    controls.page?.classList.toggle('workbench-active', capabilities);
    if (capabilities && !state.loaded) await runAction(loadMatrix)();
  };

  viewTabs.addEventListener('ic-change', (event) => showSection(event.detail?.value || 'catalog'));
  controls.sync.addEventListener('click', runAction(syncModels));
  controls.refresh.addEventListener('click', runAction(refreshSources));
  controls.importOpen.addEventListener('click', runAction(openImport));
  controls.apply.addEventListener('click', runAction(apply));
  controls.copyLookup.addEventListener('click', runImportAction(copyLookupPrompt));
  controls.importCancel.addEventListener('click', () => controls.importDialog.hide());
  controls.importPreview.addEventListener('click', runImportAction(() => submitImport(false)));
  controls.importApply.addEventListener('click', runImportAction(() => submitImport(true)));
  controls.importData.addEventListener('input', resetImportValidation);
  controls.close.addEventListener('click', () => { state.selectedModelId = ''; renderEditor(); });
  controls.search.addEventListener('input', () => { state.query = getValue(controls.search); renderRows(); });
  window.addEventListener('studio-lang-change', render);
  showSection(getValue(viewTabs) || 'catalog');
})();
