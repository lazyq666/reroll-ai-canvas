import { orderAspectRatios, orderResolutions } from './infinite-canvas-ui/generation-option-order.js?v=ic-ui-0e81b6afe7d8';

(() => {
  const tr = (key) => window.StudioI18n?.t?.(key) || key;
  const tf = (key, values) => window.StudioI18n?.format?.(key, values) || tr(key);
  const byId = (id) => document.getElementById(id);
  const editorDialog = byId('capability-editor-dialog');
  if (!editorDialog) return;

  const controls = {
    message: byId('capability-message'),
    editorDialog,
    editorTitle: byId('capability-editor-title'),
    editorModelId: byId('capability-editor-model-id'),
    editorSources: byId('capability-editor-source-summary'),
    operationEditors: byId('capability-operation-editors'),
    close: byId('capability-editor-close'),
    apply: byId('capability-apply'),
  };
  const state = {
    loaded: false,
    matrix: { models: [], summary: {} },
    selectedModelId: '',
  };
  const inputTypes = ['text', 'image', 'video', 'audio', 'file'];
  const operationLabels = {
    'text.generate': 'models.operationTextGenerate',
  };
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
  const candidateValues = (field, operation) => state.matrix.editor_candidates?.[field]?.[operation.split('.')[0]] || [];
  const ratioOptions = (values, defaults) => orderAspectRatios([...values, ...defaults]);

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
  const checkbox = (label, checked, data = {}) => {
    const control = element('ic-checkbox');
    control.setAttribute('label', label);
    control.checked = Boolean(checked);
    Object.entries(data).forEach(([key, value]) => { control.dataset[key] = String(value); });
    return control;
  };
  const switchControl = (label, checked, data = {}) => {
    const control = element('ic-switch');
    control.setAttribute('label', label);
    control.setAttribute('size', 's');
    control.checked = Boolean(checked);
    Object.entries(data).forEach(([key, value]) => { control.dataset[key] = String(value); });
    return control;
  };
  const selectOptions = (control, values, selected, label) => {
    control.setAttribute('aria-label', label);
    values.forEach((value) => {
      const option = element('option', '', tf('models.imageCount', { count: value }));
      option.value = String(value);
      control.appendChild(option);
    });
    control.value = String(selected);
    control.setAttribute('value', String(selected));
    const expand = element('ic-icon');
    expand.setAttribute('name', 'expand');
    expand.setAttribute('size', 'small');
    expand.setAttribute('slot', 'expand-icon');
    expand.setAttribute('aria-hidden', 'true');
    control.appendChild(expand);
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
  const commonValues = (operations, field) => {
    const valueSets = operations.map((operation) => new Set(operation?.[field] || []));
    if (!valueSets.length) return [];
    return [...valueSets[0]].filter((value) => valueSets.every((values) => values.has(value)));
  };
  const relevantImageOperations = (row) => {
    const standard = row.operations.filter((operation) => ['image.generate', 'image.edit'].includes(operation.operation));
    const applicable = standard.filter((operation) => operation.confirmed || Number(operation.inputs?.image || 0) > 0);
    return applicable.length ? applicable : standard;
  };
  const resolutionOptions = (values, selected) => {
    const list = element('div', 'capability-segment-options');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', tr('models.allowedResolutions'));
    values.forEach((value) => {
      const button = element('button', 'capability-segment', String(value).toLowerCase());
      button.type = 'button';
      button.setAttribute('role', 'checkbox');
      button.setAttribute('aria-checked', String(selected.includes(value)));
      button.dataset.choiceKind = 'resolution';
      button.dataset.choiceValue = value;
      button.addEventListener('click', () => {
        button.setAttribute('aria-checked', String(button.getAttribute('aria-checked') !== 'true'));
      });
      list.appendChild(button);
    });
    return list;
  };
  const numberInput = (name, label, value, maximum, data = {}) => {
    const control = element('ic-number-input', 'capability-number-input');
    control.setAttribute('name', name);
    control.setAttribute('label', label);
    control.setAttribute('min', '0');
    control.setAttribute('max', String(maximum));
    control.setAttribute('step', '1');
    control.setAttribute('size', 'small');
    control.value = String(Math.max(0, Number(value || 0)));
    control.setAttribute('value', control.value);
    Object.entries(data).forEach(([key, dataValue]) => { control.dataset[key] = String(dataValue); });
    return control;
  };
  const durationRange = (name, bounds, dataPrefix, minimumAllowed = 0, maximumAllowed = 3600) => {
    const range = element('div', 'capability-duration-range');
    const minimum = numberInput(
      `${name}-minimum`,
      tr('models.minimumSeconds'),
      Math.max(minimumAllowed, Number(bounds?.minimum || minimumAllowed)),
      maximumAllowed,
      { [`${dataPrefix}Minimum`]: 'true' },
    );
    minimum.setAttribute('min', String(minimumAllowed));
    const maximum = numberInput(
      `${name}-maximum`,
      tr('models.maximumSeconds'),
      Math.max(minimumAllowed, Number(bounds?.maximum || minimumAllowed)),
      maximumAllowed,
      { [`${dataPrefix}Maximum`]: 'true' },
    );
    maximum.setAttribute('min', String(minimumAllowed));
    range.append(minimum, element('span', 'capability-range-separator', tr('models.rangeTo')), maximum);
    return range;
  };
  const renderImageProfile = (row) => {
    const operations = relevantImageOperations(row);
    const generate = row.operations.find((operation) => operation.operation === 'image.generate');
    const edit = row.operations.find((operation) => operation.operation === 'image.edit');
    const layer = row.operations.find((operation) => operation.operation === 'image.layer_decomposition');
    const referenceMaximum = Math.max(
      Number(generate?.inputs?.image || 0),
      Number(edit?.inputs?.image || 0),
    );
    const resolutions = commonValues(operations, 'resolutions');
    const ratios = commonValues(operations, 'aspect_ratios');
    const allResolutions = orderResolutions([...resolutions, ...candidateValues('resolutions', 'image.generate')]);
    const allRatios = ratioOptions(ratios, candidateValues('aspect_ratios', 'image.generate'));
    const maximum = operations.length
      ? Math.min(...operations.map((operation) => Number(operation.output_count_maximum || 1)))
      : 1;
    const confirmed = operations.length > 0 && operations.every((operation) => operation.confirmed);
    const optionEnabled = (key) => operations.length > 0
      && operations.every((operation) => operation.options?.[key] === true);

    const card = element('section', 'capability-editor-card capability-image-profile');
    card.dataset.profileType = 'image';
    const header = element('div', 'capability-operation-header');
    header.append(
      element('h4', '', tr('models.imageCapabilities')),
      checkbox(tr('models.settingsConfirmed'), confirmed, { confirmed: 'true' }),
    );
    const grid = element('div', 'capability-choice-grid');

    const referenceControls = element('div', 'capability-reference-controls');
    const referenceToggle = switchControl(
      tr('models.supportsReferenceImages'),
      referenceMaximum > 0,
      { referenceEnabled: 'true' },
    );
    const referenceSelect = selectOptions(
      element('ic-select', 'capability-reference-count'),
      Array.from({ length: state.matrix.editor_limits?.image_reference_maximum || 20 }, (_item, index) => index + 1),
      referenceMaximum || 1,
      tr('models.maximumReferenceImages'),
    );
    referenceSelect.dataset.referenceMaximum = 'true';
    referenceSelect.hidden = referenceMaximum === 0;
    referenceToggle.addEventListener('change', () => { referenceSelect.hidden = !referenceToggle.checked; });
    referenceControls.append(referenceToggle, referenceSelect);
    grid.appendChild(choiceGroup('models.referenceImages', referenceControls));

    const outputSelect = selectOptions(
      element('ic-select', 'generation-count-select capability-output-count'),
      Array.from({ length: 100 }, (_item, index) => index + 1),
      maximum || 1,
      tr('models.maximumOutputCount'),
    );
    outputSelect.dataset.outputMaximum = 'true';
    outputSelect.dataset.componentVariant = 'generation-count';
    outputSelect.setAttribute('hierarchy', 'quiet');
    outputSelect.setAttribute('size', 'small');
    outputSelect.setAttribute('placement', 'top');
    grid.appendChild(choiceGroup('models.outputQuantity', outputSelect));

    const resolutionGroup = choiceGroup('models.allowedResolutions', resolutionOptions(allResolutions, resolutions));
    resolutionGroup.classList.add('capability-choice-group-wide');
    grid.appendChild(resolutionGroup);
    const ratioPicker = element('ic-aspect-ratio-picker', 'capability-ratio-picker');
    ratioPicker.setAttribute('name', 'model-capability-aspect-ratios');
    ratioPicker.setAttribute('label', tr('models.allowedRatios'));
    ratioPicker.setAttribute('presets', allRatios.join(','));
    ratioPicker.setAttribute('value', ratios.join(','));
    ratioPicker.setAttribute('multiple', '');
    ratioPicker.setAttribute('hide-label', '');
    ratioPicker.setAttribute('data-component-variant', 'multiple');
    const ratioGroup = choiceGroup('models.allowedRatios', ratioPicker);
    ratioGroup.classList.add('capability-choice-group-wide');
    grid.appendChild(ratioGroup);

    const features = element('div', 'capability-feature-list');
    features.append(
      switchControl(tr('models.optionTransparentPng'), optionEnabled('transparent_png'), { feature: 'transparent_png' }),
      switchControl(tr('models.optionPromptEnhancement'), optionEnabled('prompt_enhancement'), { feature: 'prompt_enhancement' }),
    );
    if (layer) {
      features.appendChild(switchControl(tr('models.optionLayerDecomposition'), layer.confirmed, { layerDecomposition: 'true' }));
    }
    grid.appendChild(choiceGroup('models.additionalCapabilities', features));
    card.append(header, grid);
    return card;
  };
  const renderVideoProfile = (row) => {
    const operation = row.operations.find((item) => item.operation === 'video.generate');
    if (!operation) return null;
    const profile = operation.video || {};
    const referenceDuration = profile.reference_media_duration_seconds || {};
    const modes = profile.modes || {};
    const resolutions = operation.resolutions || [];
    const ratios = operation.aspect_ratios || [];
    const allResolutions = orderResolutions([...resolutions, ...candidateValues('resolutions', 'video.generate')]);
    const allRatios = ratioOptions(ratios, candidateValues('aspect_ratios', 'video.generate'));

    const card = element('section', 'capability-editor-card capability-video-profile');
    card.dataset.profileType = 'video';
    card.dataset.operation = operation.operation;
    const header = element('div', 'capability-operation-header');
    header.append(
      element('h4', '', tr('models.videoCapabilities')),
      checkbox(tr('models.settingsConfirmed'), operation.confirmed, { confirmed: 'true' }),
    );
    const grid = element('div', 'capability-choice-grid');

    const inputLimits = element('div', 'capability-metric-grid');
    [
      ['image', 'models.maximumImages'],
      ['video', 'models.maximumVideos'],
      ['audio', 'models.maximumAudios'],
    ].forEach(([inputType, labelKey]) => {
      inputLimits.appendChild(numberInput(
        `model-video-${inputType}-maximum`,
        tr(labelKey),
        operation.inputs?.[inputType] || 0,
        100,
        { inputMaximum: inputType },
      ));
    });
    inputLimits.appendChild(numberInput(
      'model-video-input-total-maximum',
      tr('models.maximumReferenceMediaTotal'),
      profile.input_total_maximum || 0,
      100,
      { videoInputTotalMaximum: 'true' },
    ));
    const inputLimitGroup = choiceGroup('models.referenceMediaLimits', inputLimits);
    inputLimitGroup.classList.add('capability-choice-group-wide');
    grid.appendChild(inputLimitGroup);

    grid.append(
      choiceGroup(
        'models.eachReferenceDuration',
        durationRange(
          'model-video-reference-each',
          referenceDuration.each,
          'videoReferenceEach',
        ),
      ),
      choiceGroup(
        'models.combinedReferenceDuration',
        durationRange(
          'model-video-reference-combined',
          referenceDuration.combined_total,
          'videoReferenceCombined',
        ),
      ),
    );

    const inputFeatures = element('div', 'capability-feature-list');
    inputFeatures.appendChild(switchControl(
      tr('models.supportsAudioOnly'),
      profile.audio_only_supported === true,
      { videoAudioOnly: 'true' },
    ));
    grid.appendChild(choiceGroup('models.referenceInputModes', inputFeatures));

    const videoModes = element('div', 'capability-feature-list');
    videoModes.append(
      switchControl(
        tr('models.supportsFirstLastFrames'),
        modes.first_last_frames === true,
        { videoMode: 'first_last_frames' },
      ),
      switchControl(
        tr('models.supportsAllAroundReference'),
        modes.multimodal_all_around === true,
        { videoMode: 'multimodal_all_around' },
      ),
    );
    grid.appendChild(choiceGroup('models.videoModes', videoModes));

    grid.appendChild(choiceGroup(
      'models.outputDuration',
      durationRange(
        'model-video-output',
        profile.output_duration_seconds,
        'videoOutput',
        1,
        600,
      ),
    ));

    const resolutionGroup = choiceGroup('models.allowedResolutions', resolutionOptions(allResolutions, resolutions));
    resolutionGroup.classList.add('capability-choice-group-wide');
    grid.appendChild(resolutionGroup);
    const ratioPicker = element('ic-aspect-ratio-picker', 'capability-ratio-picker');
    ratioPicker.setAttribute('name', 'model-video-capability-aspect-ratios');
    ratioPicker.setAttribute('label', tr('models.allowedRatios'));
    ratioPicker.setAttribute('presets', allRatios.join(','));
    ratioPicker.setAttribute('value', ratios.join(','));
    ratioPicker.setAttribute('multiple', '');
    ratioPicker.setAttribute('hide-label', '');
    ratioPicker.setAttribute('data-component-variant', 'multiple');
    const ratioGroup = choiceGroup('models.allowedRatios', ratioPicker);
    ratioGroup.classList.add('capability-choice-group-wide');
    grid.appendChild(ratioGroup);

    const options = operationOptions(operation);
    if (options.length) {
      const features = element('div', 'capability-feature-list');
      options.forEach((key) => features.appendChild(switchControl(
        tr(optionLabels[key] || 'models.otherCapability'),
        operation.options?.[key] === true,
        { feature: key },
      )));
      const optionGroup = choiceGroup('models.additionalCapabilities', features);
      optionGroup.classList.add('capability-choice-group-wide');
      grid.appendChild(optionGroup);
    }
    card.append(header, grid);
    return card;
  };
  const operationOptions = (operation) => {
    const existing = Object.keys(operation.options || {});
    const defaults = operation.operation === 'video.generate'
      ? ['enhance_prompt', 'generate_audio', 'enable_upsample', 'camera_fixed', 'watermark']
      : [];
    return [...new Set([...existing, ...defaults])];
  };
  const renderOperationEditor = (operation) => {
    const card = element('section', 'capability-editor-card capability-operation-card');
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
      const select = element('ic-select', 'capability-count-select');
      select.dataset.inputMaximum = inputType;
      select.setAttribute('label', tf('models.maximumInputCount', { type: tr(inputLabels[inputType]) }));
      const inputMaximum = operation.operation === 'text.generate' ? (state.matrix.editor_limits?.text_inputs?.[inputType] ?? 100) : 100;
      Array.from({ length: inputMaximum }, (_, index) => index + 1).forEach((value) => {
        const option = element('option', '', String(value));
        option.value = String(value);
        select.appendChild(option);
      });
      select.value = String(maximum || 1);
      select.setAttribute('value', String(maximum || 1));
      select.hidden = maximum === 0;
      toggle.addEventListener('change', () => { select.hidden = !toggle.checked; });
      wrapper.append(toggle, select);
      inputList.appendChild(wrapper);
    });
    grid.appendChild(choiceGroup('models.acceptedInputs', inputList));

    const outputSelect = element('ic-select', 'capability-count-select');
    outputSelect.dataset.outputMaximum = 'true';
    outputSelect.setAttribute('label', tr('models.maximumOutputCount'));
    Array.from({ length: 100 }, (_, index) => index + 1).forEach((value) => {
      const option = element('option', '', String(value));
      option.value = String(value);
      outputSelect.appendChild(option);
    });
    outputSelect.value = String(operation.output_count_maximum || 1);
    outputSelect.setAttribute('value', String(operation.output_count_maximum || 1));
    setDisabled(outputSelect, operation.operation === 'image.layer_decomposition');
    grid.appendChild(choiceGroup('models.outputQuantity', outputSelect));

    const resolutions = [...new Set([...(operation.resolutions || []), ...(candidateValues('resolutions', operation.operation) || [])])];
    if (resolutions.length) grid.appendChild(choiceGroup('models.allowedResolutions', optionList(resolutions, operation.resolutions || [], 'resolution')));
    const ratios = [...new Set([...(operation.aspect_ratios || []), ...(candidateValues('aspect_ratios', operation.operation) || [])])];
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
    if (!row) {
      controls.operationEditors.replaceChildren();
      return;
    }
    controls.editorTitle.textContent = row.name;
    controls.editorModelId.textContent = row.model_id;
    controls.editorSources.textContent = row.evidence_count
      ? tf('models.sourceSummaryAvailable', { count: row.evidence_count })
      : tr('models.sourceSummaryMissing');
    const editors = [];
    if (row.types.includes('image')) editors.push(renderImageProfile(row));
    if (row.types.includes('video')) editors.push(renderVideoProfile(row));
    editors.push(...row.operations
      .filter((operation) => !operation.operation.startsWith('image.') && operation.operation !== 'video.generate')
      .map(renderOperationEditor));
    controls.operationEditors.replaceChildren(...editors.filter(Boolean));
  };
  const render = () => {
    renderEditor();
  };
  const loadMatrix = async () => {
    state.matrix = await request('/api/admin/model-capability-matrix');
    state.loaded = true;
    if (state.selectedModelId && !selectedRow()) state.selectedModelId = '';
    render();
    window.dispatchEvent(new CustomEvent('model-capability-matrix-change', {
      detail: { matrix: state.matrix },
    }));
  };
  const runAction = (action) => async () => {
    showMessage('');
    try { await action(); } catch (error) { showMessage('', 'danger'); controls.message.textContent = error.message || tr('models.operationRetry'); controls.message.hidden = false; }
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
  const readImageProfile = (card, row) => {
    const confirmed = Boolean(card.querySelector('[data-confirmed]')?.checked);
    const referenceEnabled = Boolean(card.querySelector('[data-reference-enabled]')?.checked);
    const referenceMaximum = referenceEnabled
      ? Number(getValue(card.querySelector('[data-reference-maximum]')) || 1)
      : 0;
    const resolutions = [...card.querySelectorAll('[data-choice-kind="resolution"]')]
      .filter((item) => item.getAttribute('aria-checked') === 'true')
      .map((item) => item.dataset.choiceValue);
    const ratioPicker = card.querySelector('ic-aspect-ratio-picker[multiple]');
    const aspectRatios = Array.isArray(ratioPicker?.values) ? ratioPicker.values : [];
    const outputMaximum = Number(getValue(card.querySelector('[data-output-maximum]')) || 1);
    const options = [...card.querySelectorAll('[data-feature]')]
      .filter((item) => item.checked)
      .map((item) => item.dataset.feature);
    const layerEnabled = Boolean(card.querySelector('[data-layer-decomposition]')?.checked);
    return row.operations
      .filter((operation) => operation.operation.startsWith('image.'))
      .map((operation) => {
        if (operation.operation === 'image.layer_decomposition') {
          return {
            ...operation,
            confirmed: layerEnabled,
            options: [],
          };
        }
        const inputs = { ...(operation.inputs || {}) };
        inputs.image = operation.operation === 'image.edit' ? referenceMaximum : 0;
        return {
          operation: operation.operation,
          confirmed: confirmed && (operation.operation !== 'image.edit' || referenceEnabled),
          inputs,
          resolutions,
          aspect_ratios: aspectRatios,
          output_count_maximum: outputMaximum,
          options,
        };
      });
  };
  const readVideoProfile = (card, row) => {
    const operation = row.operations.find((item) => item.operation === 'video.generate');
    if (!operation) return [];
    const number = (selector, fallback = 0) => Number(getValue(card.querySelector(selector)) || fallback);
    const range = (prefix, fallback = 0) => ({
      minimum: number(`[data-${prefix}-minimum]`, fallback),
      maximum: number(`[data-${prefix}-maximum]`, fallback),
    });
    const inputs = { ...(operation.inputs || {}) };
    ['image', 'video', 'audio'].forEach((inputType) => {
      inputs[inputType] = number(`[data-input-maximum="${inputType}"]`);
    });
    const ratioPicker = card.querySelector('ic-aspect-ratio-picker[multiple]');
    const modes = {};
    card.querySelectorAll('[data-video-mode]').forEach((control) => {
      modes[control.dataset.videoMode] = Boolean(control.checked);
    });
    return [{
      operation: operation.operation,
      confirmed: Boolean(card.querySelector('[data-confirmed]')?.checked),
      inputs,
      resolutions: [...card.querySelectorAll('[data-choice-kind="resolution"]')]
        .filter((item) => item.getAttribute('aria-checked') === 'true')
        .map((item) => item.dataset.choiceValue),
      aspect_ratios: Array.isArray(ratioPicker?.values) ? ratioPicker.values : [],
      output_count_maximum: Number(operation.output_count_maximum || 1),
      options: [...card.querySelectorAll('[data-feature]')]
        .filter((item) => item.checked)
        .map((item) => item.dataset.feature),
      video: {
        input_total_maximum: number('[data-video-input-total-maximum]'),
        reference_media_duration_seconds: {
          each: range('video-reference-each'),
          combined_total: range('video-reference-combined'),
        },
        audio_only_supported: Boolean(card.querySelector('[data-video-audio-only]')?.checked),
        modes,
        output_duration_seconds: range('video-output', 1),
      },
    }];
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
          operations: [...controls.operationEditors.querySelectorAll('.capability-editor-card')]
            .flatMap((card) => {
              if (card.dataset.profileType === 'image') return readImageProfile(card, row);
              if (card.dataset.profileType === 'video') return readVideoProfile(card, row);
              return [readOperation(card)];
            }),
        }),
      });
      state.matrix = payload.matrix;
      render();
      await controls.editorDialog.hide('confirm');
      showMessage('models.capabilitiesApplied');
    } finally { setDisabled(controls.apply, false); }
  };
  const openEditor = async (modelId) => {
    state.selectedModelId = String(modelId || '').trim();
    await loadMatrix();
    if (!selectedRow()) throw new Error(tr('models.detailsUnavailable'));
    renderEditor();
    await controls.editorDialog.show();
  };

  controls.apply.addEventListener('click', runAction(apply));
  controls.close.addEventListener('click', () => controls.editorDialog.hide('cancel'));
  window.addEventListener('studio-lang-change', render);
  window.ModelCapabilityEditor = Object.freeze({
    open: (modelId) => runAction(() => openEditor(modelId))(),
  });
  void runAction(loadMatrix)();
})();
