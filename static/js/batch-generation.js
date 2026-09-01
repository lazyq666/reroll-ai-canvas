(() => {
    const $ = id => document.getElementById(id);
    if (!$('batchGenerationMode')) return;
    const tr = key => window.StudioI18n?.t?.(key) || key;
    const tf = (key, values) => window.StudioI18n?.format?.(key, values) || tr(key);
    const notify = (message, tone = 'danger') => customElements.get('ic-toast')?.notify(String(message || ''), {tone});
    async function confirmAction(message) {
        let dialog = document.getElementById('batchActionConfirmation');
        if (!dialog) {
            dialog = document.createElement('ic-confirmation-dialog');
            dialog.id = 'batchActionConfirmation';
            dialog.label = tr('batch.confirmation');
            dialog.cancelLabel = tr('common.cancel');
            dialog.confirmLabel = tr('common.confirm');
            dialog.consequence = 'destructive';
            document.body.appendChild(dialog);
        }
        dialog.description = String(message || '');
        await customElements.whenDefined('ic-confirmation-dialog');
        return new Promise(resolve => {
            const cleanup = () => {
                dialog.removeEventListener('ic-confirm', approve);
                dialog.removeEventListener('ic-cancel', reject);
            };
            const approve = () => { cleanup(); dialog.hide('confirm'); resolve(true); };
            const reject = () => { cleanup(); resolve(false); };
            dialog.addEventListener('ic-confirm', approve, {once:true});
            dialog.addEventListener('ic-cancel', reject, {once:true});
            dialog.show();
        });
    }
    async function filesFromDirectory() {
        if (!window.showDirectoryPicker) {
            notify(tr('batch.directoryPickerUnavailable'), 'warning');
            return [];
        }
        const root = await window.showDirectoryPicker();
        const files = [];
        async function visit(handle, prefix = '') {
            for await (const [name, entry] of handle.entries()) {
                if (name.startsWith('.')) continue;
                if (entry.kind === 'file') {
                    const file = await entry.getFile();
                    Object.defineProperty(file, 'webkitRelativePath', {value:`${prefix}${name}`});
                    files.push(file);
                } else await visit(entry, `${prefix}${name}/`);
            }
        }
        await visit(root);
        return files;
    }

    const supportedImages = /\.(png|jpe?g|webp)$/i;
    const maxImageVariables = 20;
    const batchConfigStorageKey = 'studio_batch_generation_config_v1';
    const ratioPresetValues = Object.freeze({
        square:'1:1', portrait:'2:3', landscape:'3:2', portrait43:'3:4',
        landscape43:'4:3', story:'9:16', wide:'16:9',
    });
    const ratioPresetByValue = Object.freeze(Object.fromEntries(
        Object.entries(ratioPresetValues).map(([preset, value]) => [value, preset])
    ));
    let excluded = new Set();
    let modelCatalog = [];
    let batchCapabilityResolution = '';
    let batchCapabilitySequence = 0;
    let estimateTimer = null;
    let batchPollTimer = null;
    let currentBatchId = '';
    let batchDetailOutputs = [];
    let batchImagePreviewItems = [];
    let currentBatchOutputIndex = -1;
    let batchImagePreview = null;
    let batchImageBodyOverflow = '';
    let batchPromptCopyResetTimer = null;
    let batchImageCopyResetTimer = null;
    let previewTasks = [];
    let currentBatch = null;
    let viewBeforeHistory = 'setup';
    let configSaveTimer = null;
    let configPersistenceReady = false;
    let applyingConfiguration = false;
    let batchConfigurationPromise = null;
    const batchSubmitBars = {
        preview:document.querySelector('#batchPreviewStep .batch-submit-bar'),
    };
    const batchSubmitLayer = document.createElement('div');
    batchSubmitLayer.id = 'batchSubmitLayer';
    batchSubmitLayer.className = 'batch-submit-layer';
    document.documentElement.appendChild(batchSubmitLayer);
    Object.values(batchSubmitBars).forEach(bar => {
        bar.hidden = true;
        batchSubmitLayer.appendChild(bar);
    });
    document.documentElement.appendChild($('batchImageEditModal'));

    const batchUniformSidebar = document.querySelector('.batch-uniform-sidebar');
    const batchSidebarPlaceholder = document.createElement('div');
    batchSidebarPlaceholder.className = 'batch-uniform-placeholder';
    batchUniformSidebar.before(batchSidebarPlaceholder);
    let batchSidebarFrame = 0;

    function syncBatchUniformSidebar() {
        batchSidebarFrame = 0;
        const scale = Number(getComputedStyle(document.documentElement).getPropertyValue('--studio-ui-scale')) || 1;
        const desktop = window.innerWidth > 700 && window.innerWidth / scale > 1100;
        document.documentElement.classList.toggle('batch-wide-layout', desktop);
        const visible = !$('batchGenerationMode').hidden && !$('batchSetupStep').hidden;
        if (!desktop) {
            if (batchUniformSidebar.parentElement === document.documentElement) {
                batchSidebarPlaceholder.parentElement.insertBefore(batchUniformSidebar, batchSidebarPlaceholder);
            }
            batchSidebarPlaceholder.hidden = true;
            batchSidebarPlaceholder.style.height = '';
            batchUniformSidebar.classList.remove('is-portaled');
            batchUniformSidebar.removeAttribute('style');
            batchUniformSidebar.hidden = !visible;
            return;
        }
        batchSidebarPlaceholder.hidden = false;
        if (batchUniformSidebar.parentElement !== document.documentElement) {
            document.documentElement.appendChild(batchUniformSidebar);
        }
        batchUniformSidebar.classList.add('is-portaled');
        batchUniformSidebar.hidden = !visible;
        if (!visible) return;
        const placeholderRect = batchSidebarPlaceholder.getBoundingClientRect();
        const topPadding = 12 * scale;
        batchUniformSidebar.style.width = `${placeholderRect.width / scale}px`;
        batchSidebarPlaceholder.style.height = `${batchUniformSidebar.offsetHeight}px`;
        const top = Math.max(placeholderRect.top, topPadding);
        const availableHeight = Math.max(240 * scale, window.innerHeight - top - topPadding);
        batchUniformSidebar.style.maxHeight = `${availableHeight / scale}px`;
        batchUniformSidebar.style.left = `${placeholderRect.left}px`;
        batchUniformSidebar.style.top = `${top}px`;
    }

    function scheduleBatchSidebarSync() {
        if (batchSidebarFrame) return;
        batchSidebarFrame = window.requestAnimationFrame(syncBatchUniformSidebar);
    }

    window.addEventListener('scroll', scheduleBatchSidebarSync, {passive:true});
    window.addEventListener('resize', scheduleBatchSidebarSync);
    window.addEventListener('studio-ui-scale-change', scheduleBatchSidebarSync);
    new MutationObserver(scheduleBatchSidebarSync).observe($('batchGenerationMode'), {
        attributes:true, subtree:true, attributeFilter:['hidden'],
    });
    scheduleBatchSidebarSync();

    const escape = value => String(value || '').replace(/[&<>"']/g, char => ({
        '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    }[char]));
    const natural = (left, right) => left.localeCompare(right, undefined, {numeric:true, sensitivity:'base'});
    const promptOptionText = value => String(
        value && typeof value === 'object'
            ? value.value ?? value.content ?? value.text ?? ''
            : value ?? ''
    );
    const modelDisplayName = entry => String(entry?.name || entry?.model || '')
        .split('/').filter(Boolean).pop() || String(entry?.model || '');
    function modelVendorIconMarkup(entry) {
        if (typeof entry === 'string') return window.ModelVendorIcons?.markup(entry) || '';
        return window.ModelVendorIcons?.markup(entry?.model, entry?.provider_id, entry?.provider_name) || '';
    }
    function renderTaskModel(task) {
        const name = String(task?.model_name || task?.model || '');
        return `<span class="batch-model-display" title="${escape(name)}">${modelVendorIconMarkup(task)}<span>${escape(name)}</span></span>`;
    }
    function renderSnapshotModel(model) {
        const entry = typeof model === 'string' ? {model, name:model} : model;
        return `<span class="batch-model-display">${modelVendorIconMarkup(entry)}<span>${escape(entry?.name || entry?.model)}</span></span>`;
    }

    function parseText(module) {
        if (Array.isArray(module._presetOptions)) {
            return module._presetOptions.map(value => promptOptionText(value).trim()).filter(Boolean);
        }
        const text = String(module.querySelector('.batch-module-options').value || '').trim();
        if (!text) return [];
        const mode = module.querySelector('.batch-parse-mode').value;
        if (mode === 'raw') return [text];
        if (mode === 'paragraphs') return text.split(/\n\s*\n/).map(value => value.trim()).filter(Boolean);
        if (mode === 'delimiter') {
            const delimiter = module.querySelector('.batch-custom-delimiter').value || ',';
            return text.split(delimiter).map(value => value.trim()).filter(Boolean);
        }
        return text.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    }

    function updateModule(module) {
        const count = parseText(module).length;
        module.querySelector('.batch-option-count').textContent = count;
        const fileCount = module._fileOptions?.length || 0;
        const fileCountLabel = module.querySelector('.batch-file-count');
        fileCountLabel.hidden = !fileCount;
        fileCountLabel.textContent = fileCount ? tf('batch.filesSorted', {count:fileCount}) : '';
        scheduleEstimate();
    }

    function renumberDimensionRows() {
        const promptCount = document.querySelectorAll('.batch-module').length;
        document.querySelectorAll('.batch-image-variable').forEach((card, index) => {
            card.querySelector('.batch-row-number').textContent = String(promptCount + index + 1).padStart(2, '0');
        });
        const imageCount = document.querySelectorAll('.batch-image-variable').length;
        $('batchModelRowNumber').textContent = String(promptCount + imageCount + 1).padStart(2, '0');
        $('batchRatioRowNumber').textContent = String(promptCount + imageCount + 2).padStart(2, '0');
    }

    function renumberPromptModules() {
        document.querySelectorAll('.batch-module').forEach((module, index) => {
            const number = String(index + 1).padStart(2, '0');
            module.dataset.moduleIndex = number;
            module.querySelector('.batch-module-index').textContent = number;
            module.querySelector('.batch-variable-name').textContent = tf('batch.promptNumber', {number});
            module.querySelector('.batch-remove-module').setAttribute('label', tf('batch.deletePromptModule', {name:tf('batch.promptNumber', {number})}));
        });
        renumberDimensionRows();
    }

    function importButtonVariant({menuClass = '', filesClass = '', folderClass = '', filesLabel = '', folderLabel = ''} = {}) {
        return `<ic-menu class="batch-import-menu ${menuClass}" size="small" label="${escape(tr('batch.import'))}" trigger="dropdown" selection="command"><ic-button class="batch-import-trigger" data-button-variant="import-menu" slot="trigger" size="small" hierarchy="secondary" data-legal-combination="secondary-action" type="button"><ic-icon slot="start" name="upload"></ic-icon><span class="batch-button-label">${tr('batch.import')}</span><ic-icon slot="end" name="expand"></ic-icon></ic-button><ic-menu-item class="batch-import-files ${filesClass}" kind="command" value="files" icon="upload" label="${escape(filesLabel)}"></ic-menu-item><ic-menu-item class="batch-import-folder ${folderClass}" kind="command" value="folder" icon="project-default" label="${escape(folderLabel)}"></ic-menu-item></ic-menu>`;
    }

    function bindImportButtonVariant(menu, handlers = {}) {
        const trigger = menu.querySelector('.batch-import-trigger');
        trigger.setAttribute('aria-haspopup', 'menu');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.addEventListener('click', () => {
            if (menu.hasAttribute('open')) menu.hide('trigger');
            else menu.show(trigger);
        });
        menu.addEventListener('ic-select', async event => {
            await handlers[event.detail?.value]?.();
        });
    }

    function addModule(options = '', initialParseMode = 'lines') {
        if (document.querySelectorAll('.batch-module').length >= 10) return;
        const presetOptions = Array.isArray(options) ? options.map(value => (
            value && typeof value === 'object' ? {...value} : String(value)
        )) : null;
        const initialText = presetOptions ? presetOptions.map(promptOptionText).join('\n') : String(options || '');
        const parseMode = ['lines', 'raw', 'paragraphs', 'delimiter'].includes(initialParseMode)
            ? initialParseMode : 'lines';
        const module = document.createElement('tr');
        module.className = 'batch-module batch-prompt-row';
        module._fileOptions = [];
        module._presetOptions = presetOptions;
        if (presetOptions?.length && presetOptions.every(option => (
            option && typeof option === 'object' && (option.relative_path || option.name)
        ))) {
            module._fileOptions = presetOptions.map(option => ({
                name:option.name || String(option.relative_path || '').split('/').pop(),
                relativePath:option.relative_path || option.name,
                content:promptOptionText(option),
            }));
        }
        module.innerHTML = `
            <td><span class="batch-row-number batch-module-index">00</span></td>
            <td><div class="batch-variable-cell"><span class="batch-kind batch-kind-text">TXT</span><strong class="batch-variable-name">${tf('batch.promptNumber', {number:'00'})}</strong></div></td>
            <td><ic-form-field class="batch-prompt-field" aria-label="${escape(tr('batch.prompt'))}" data-component-name="ic-form-field-textarea-s">
                <ic-textarea slot="control" class="batch-module-options" name="batch_prompt_options" size="small" resize="vertical" rows="5" placeholder="${tr('batch.onePerLinePlaceholder')}" value="${escape(initialText)}">
                <div slot="hint" class="batch-parse-row">
                    <ic-select class="batch-parse-mode" name="batch_parse_mode" label="${escape(tr('batch.parseMode'))}" value="${parseMode}" size="small"><option value="lines" ${parseMode === 'lines' ? 'selected' : ''}>${escape(tr('batch.onePerLine'))}</option><option value="raw" ${parseMode === 'raw' ? 'selected' : ''}>${escape(tr('batch.rawText'))}</option><option value="paragraphs" ${parseMode === 'paragraphs' ? 'selected' : ''}>${escape(tr('batch.paragraphs'))}</option><option value="delimiter" ${parseMode === 'delimiter' ? 'selected' : ''}>${escape(tr('batch.customDelimiter'))}</option></ic-select>
                    <ic-input class="batch-custom-delimiter" name="batch_custom_delimiter" value="," aria-label="${tr('batch.customDelimiter')}" ${parseMode === 'delimiter' ? '' : 'hidden'}></ic-input>
                    <div class="batch-file-actions"><span class="batch-file-count" hidden></span>${importButtonVariant({menuClass:'batch-prompt-import-menu', filesLabel:tr('batch.chooseFiles'), folderLabel:tr('batch.chooseFolder')})}</div>
                    <ic-file-input class="batch-text-files" name="batch_text_files" label="${escape(tr('batch.importFile'))}" accept=".txt,.md,.markdown,text/plain,text/markdown" multiple hidden></ic-file-input>
                </div>
                </ic-textarea>
            </ic-form-field></td>
            <td class="batch-count-cell"><strong class="batch-option-count">0</strong></td>
            <td><ic-icon-button class="batch-remove-module" hierarchy="quiet" tone="danger" type="button" icon="delete" label="${tr('batch.deletePromptModule')}"></ic-icon-button></td>`;
        $('batchPromptModules').appendChild(module);
        const readFiles = async fileList => {
            const files = [...fileList]
                .filter(file => /\.(txt|md|markdown)$/i.test(file.name) && !String(file.webkitRelativePath || file.name).split('/').some(part => part.startsWith('.')))
                .sort((a, b) => natural(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name));
            module._fileOptions = await Promise.all(files.map(async file => ({
                name:file.name, relativePath:file.webkitRelativePath || file.name, content:await file.text(),
            })));
            module._presetOptions = module._fileOptions.map(item => ({
                value:item.content.trim(),
                name:item.name,
                relative_path:item.relativePath || item.name,
            })).filter(item => item.value);
            module.querySelector('.batch-module-options').value = module._presetOptions
                .map(item => item.value).join('\n');
            updateModule(module);
            if (!files.length) {
                module.querySelector('.batch-file-count').hidden = false;
                module.querySelector('.batch-file-count').textContent = tr('batch.noSupportedFiles');
            }
        };
        module.querySelector('.batch-remove-module').onclick = () => { module.remove(); renumberPromptModules(); scheduleEstimate(); };
        bindImportButtonVariant(module.querySelector('.batch-prompt-import-menu'), {
            files:() => module.querySelector('.batch-text-files').open(),
            folder:async () => {
                try { await readFiles(await filesFromDirectory()); } catch (error) { if (error.name !== 'AbortError') notify(error.message); }
            },
        });
        module.querySelector('.batch-text-files').addEventListener('ic-change', async event => {
            await readFiles(event.detail.acceptedFiles); event.target.clear({silent:true});
        });
        module.querySelector('.batch-parse-mode').onchange = event => {
            module._presetOptions = null;
            module._fileOptions = [];
            module.querySelector('.batch-custom-delimiter').hidden = event.target.value !== 'delimiter'; updateModule(module);
        };
        module.querySelector('.batch-module-options').addEventListener('input', () => {
            module._presetOptions = null;
            module._fileOptions = [];
            updateModule(module);
        });
        module.querySelector('.batch-custom-delimiter').addEventListener('input', () => {
            module._presetOptions = null;
            module._fileOptions = [];
            updateModule(module);
        });
        renumberPromptModules();
        updateModule(module);
    }

    function imageOption(file, index, variableIndex = 0) {
        return {
            client_id:`local-${variableIndex}-${index}-${file.name}-${file.size}`,
            name:file.name,
            relative_path:file.webkitRelativePath || file.name,
            url:'',
        };
    }

    function renderImageVariable(card) {
        const existingOptions = card._existingOptions || [];
        const files = card._files || [];
        const count = existingOptions.length + files.length;
        card.querySelector('.batch-image-count').textContent = count;
        card.querySelector('.batch-image-options').innerHTML = existingOptions.map((option, index) => `
            <figure class="batch-image-option"><ic-image-frame state="normal" size="small" src="${escape(option.url)}" alt="${escape(option.name || tr('batch.referenceImage'))}" label="${escape(option.name || tr('batch.referenceImage'))}" data-remove-existing-image="${index}" remove-label="${escape(tf('batch.removeItem', {name:option.name || option.relative_path || tr('batch.referenceImage')}))}"></ic-image-frame></figure>
        `).join('') + files.map((file, index) => `
            <figure class="batch-image-option"><ic-image-frame state="normal" size="small" src="${card._objectUrls[index]}" alt="${escape(file.name)}" label="${escape(file.name)}" data-remove-image="${index}" remove-label="${escape(tf('batch.removeItem', {name:file.name}))}"></ic-image-frame></figure>
        `).join('');
        card.querySelectorAll('[data-remove-existing-image]').forEach(frame => frame.addEventListener('ic-remove', event => {
            event.preventDefault();
            card._existingOptions.splice(Number(frame.dataset.removeExistingImage), 1);
            renderImageVariable(card); scheduleEstimate();
        }));
        card.querySelectorAll('[data-remove-image]').forEach(frame => frame.addEventListener('ic-remove', event => {
            event.preventDefault();
            const index = Number(frame.dataset.removeImage);
            URL.revokeObjectURL(card._objectUrls[index]);
            card._files.splice(index, 1); card._objectUrls.splice(index, 1); renderImageVariable(card); scheduleEstimate();
        }));
        card.querySelectorAll('ic-image-frame').forEach(frame => frame.addEventListener('ic-preview', event => {
            const src = String(event.detail?.src || frame.getAttribute('src') || '');
            if (!src) return;
            const name = String(event.detail?.alt || frame.getAttribute('label') || tr('batch.referenceImage'));
            openBatchImagePreview(0, [{url:src, name, prompt:'', task:null}]);
        }));
    }

    function renumberImageVariables() {
        document.querySelectorAll('.batch-image-variable').forEach((card, index) => {
            const number = String(index + 1).padStart(2, '0');
            card.dataset.variableIndex = number;
            card.querySelector('.batch-image-variable-name').textContent = tf('batch.referenceImagesNumber', {number});
            card.querySelector('.batch-remove-image-variable').setAttribute('label', tf('batch.deleteImageVariable', {name:tf('batch.referenceImagesNumber', {number})}));
        });
        renumberDimensionRows();
    }

    function addImageVariable(existingOptions = []) {
        if (document.querySelectorAll('.batch-image-variable').length >= maxImageVariables) return;
        const card = document.createElement('tr');
        card.className = 'batch-image-variable batch-image-row';
        card._files = []; card._objectUrls = [];
        card._existingOptions = (existingOptions || []).map(option => (
            typeof option === 'string'
                ? {url:option, name:option.split('/').pop() || tr('batch.referenceImage')}
                : {...option}
        )).filter(option => option.url);
        card.innerHTML = `
            <td><span class="batch-row-number">00</span></td>
            <td><div class="batch-variable-cell"><span class="batch-kind batch-kind-image">IMG</span><strong class="batch-image-variable-name">${tf('batch.referenceImagesNumber', {number:'00'})}</strong></div></td>
            <td><div class="batch-image-cell"><div class="batch-image-options"></div><div class="batch-image-actions">${importButtonVariant({menuClass:'batch-image-import-menu', filesClass:'batch-import-images', folderClass:'batch-import-image-folder', filesLabel:tr('batch.addImages'), folderLabel:tr('batch.chooseFolder')})}<ic-file-input class="batch-image-files" name="batch_image_files" label="${escape(tr('batch.addImages'))}" accept="image/png,image/jpeg,image/webp" multiple hidden></ic-file-input></div></div></td>
            <td class="batch-count-cell"><strong class="batch-image-count">0</strong></td>
            <td><ic-icon-button class="batch-remove-image-variable" hierarchy="quiet" tone="danger" type="button" icon="delete" label="${tr('batch.deleteImageVariable')}"></ic-icon-button></td>`;
        $('batchImageVariables').appendChild(card); $('batchImageEmpty').hidden = true;
        renumberImageVariables();
        const acceptFiles = fileList => {
            card._objectUrls.forEach(url => URL.revokeObjectURL(url));
            const existingAndAdded = [...card._files, ...fileList]
                .filter(file => supportedImages.test(file.name) && !String(file.webkitRelativePath || file.name).split('/').some(part => part.startsWith('.')));
            card._files = [...new Map(existingAndAdded.map(file => [
                `${file.webkitRelativePath || file.name}:${file.size}:${file.lastModified}`, file,
            ])).values()].sort((a, b) => natural(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name));
            card._objectUrls = card._files.map(file => URL.createObjectURL(file)); renderImageVariable(card); scheduleEstimate();
        };
        card._acceptFiles = acceptFiles;
        bindImportButtonVariant(card.querySelector('.batch-image-import-menu'), {
            files:() => card.querySelector('.batch-image-files').open(),
            folder:async () => {
                try { acceptFiles(await filesFromDirectory()); } catch (error) { if (error.name !== 'AbortError') notify(error.message); }
            },
        });
        card.querySelector('.batch-image-files').addEventListener('ic-change', event => {
            acceptFiles(event.detail.acceptedFiles); event.target.clear({silent:true});
        });
        card.querySelector('.batch-remove-image-variable').onclick = () => {
            card._objectUrls.forEach(url => URL.revokeObjectURL(url)); card.remove();
            renumberImageVariables();
            $('batchImageEmpty').hidden = document.querySelectorAll('.batch-image-variable').length > 0; scheduleEstimate();
        };
        renderImageVariable(card);
    }

    async function loadModelCatalog() {
        try {
            const config = await fetch('/api/config').then(response => response.json());
            const available = Array.isArray(config.available_models?.image)
                ? config.available_models.image : [];
            modelCatalog = available.length ? available : (config.api_providers || [])
                .filter(item => item.enabled !== false)
                .flatMap(item => (item.image_models || []).map(model => ({
                    id:`${item.id}|${encodeURIComponent(model)}`,
                    provider_id:item.id, provider_name:item.name || item.id,
                    model, name:item.model_names?.[model] || model,
                })));
        } catch (_) {
            try { modelCatalog = imageModelCatalog(); } catch (_) { modelCatalog = []; }
        }
    }

    async function initializeBatchConfiguration() {
        if (!batchConfigurationPromise) {
            batchConfigurationPromise = (async () => {
                await loadModelCatalog();
                renderGenerationChoices();
                const cached = readCachedConfiguration();
                if (cached) applyBatchConfiguration(cached);
                await updateBatchCapabilityIntersection();
                configPersistenceReady = true;
                scheduleEstimate();
            })();
        }
        return batchConfigurationPromise;
    }

    function renderGenerationChoices() {
        const selected = new Set(
            [...document.querySelectorAll('[data-batch-model-id]')].filter(input => input.checked)
                .map(input => input.dataset.batchModelId)
        );
        $('batchModelChoices').innerHTML = modelCatalog.map((entry, index) => `
            <ic-checkbox class="batch-choice-card" name="batch_model_${index}" label="${escape(modelDisplayName(entry))}" appearance="checkmark-end" data-legal-combination="checkmark-end-label" data-component-variant="list" data-component-name="ic-checkbox-list" data-batch-model-id="${escape(entry.id)}" ${selected.has(entry.id) ? 'checked' : ''}>${modelVendorIconMarkup(entry)}</ic-checkbox>
        `).join('') || `<p class="batch-choice-empty">${tr('batch.enableModelsFirst')}</p>`;
        $('batchModelChoices').onchange = () => {
            updateBatchCapabilityIntersection().finally(scheduleEstimate);
        };
        $('batchRatioChoices').onchange = scheduleEstimate;
        updateDimensionMetrics();
    }

    async function updateBatchCapabilityIntersection() {
        const sequence = ++batchCapabilitySequence;
        const models = selectedModels().map(item => ({
            provider_id:item.provider_id,
            model_id:item.model,
        }));
        if (!models.length) return null;
        const response = await fetch('/api/image-model-capabilities/intersection', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({models}),
        }).catch(() => null);
        const capability = response?.ok
            ? await response.json()
            : {aspect_ratios:Object.values(ratioPresetValues), resolution_tiers:['1K','2K','4K'], default_resolution_tier:'1K', blocked:false};
        if (sequence !== batchCapabilitySequence) return capability;
        const presetValues = (capability.aspect_ratios || [])
            .map(value => ratioPresetByValue[value]).filter(Boolean);
        const ratioPicker = $('batchRatioChoices');
        const selected = ratioPicker.values.filter(value => presetValues.includes(value));
        ratioPicker.setAttribute('presets', presetValues.join(',') || '__none__');
        ratioPicker.values = selected;
        const tiers = (capability.resolution_tiers || []).map(value => String(value).toLowerCase());
        const resolution = $('batchResolution');
        [...resolution.querySelectorAll('ic-radio')].forEach(radio => {
            radio.hidden = !tiers.includes(radio.value);
        });
        resolution.hidden = tiers.length <= 1;
        if (tiers.length === 1) batchCapabilityResolution = tiers[0];
        else if (tiers.includes(resolution.value)) batchCapabilityResolution = resolution.value;
        else batchCapabilityResolution = '';
        if (capability.blocked) {
            $('batchError').hidden = false;
            $('batchError').dataset.errorCode = 'no-shared-model-options';
            $('batchError').textContent = tr('batch.noSharedModelOptions');
        } else if ($('batchError').dataset.errorCode === 'no-shared-model-options') {
            $('batchError').hidden = true;
            delete $('batchError').dataset.errorCode;
        }
        updateDimensionMetrics();
        return capability;
    }

    function selectedModels() {
        return [...document.querySelectorAll('[data-batch-model-id]')].filter(input => input.checked).map(input => {
            const entry = modelCatalog.find(item => item.id === input.dataset.batchModelId);
            if (!entry) return null;
            return {provider_id:entry.provider_id, provider_name:entry.provider_name, model:entry.model, name:modelDisplayName(entry)};
        }).filter(Boolean);
    }

    const settingValue = id => $(id).value || '';

    function updateDimensionMetrics() {
        const modelCount = [...document.querySelectorAll('[data-batch-model-id]')].filter(input => input.checked).length;
        $('batchModelCount').textContent = modelCount;
        $('batchRatioCount').textContent = $('batchRatioChoices').values.length;
    }

    function buildPayload() {
        const prefix = String($('batchName').value || '').trim().replace(/_+$/, '');
        return {
            name:'',
            name_prefix:prefix,
            prompt_modules:[...document.querySelectorAll('.batch-module')].map((module, index) => ({
                name:`TXT ${String(index + 1).padStart(2, '0')}`,
                parse_mode:module.querySelector('.batch-parse-mode').value,
                options:Array.isArray(module._presetOptions)
                    ? module._presetOptions.map(option => (
                        option && typeof option === 'object' ? {...option} : option
                    ))
                    : parseText(module),
            })),
            image_variables:[...document.querySelectorAll('.batch-image-variable')].map((card, variableIndex) => ({
                name:`IMG ${String(variableIndex + 1).padStart(2, '0')}`,
                options:[
                    ...(card._existingOptions || []).map(option => ({...option})),
                    ...card._files.map((file, index) => imageOption(file, index, variableIndex)),
                ],
            })),
            models:selectedModels(),
            ratios:$('batchRatioChoices').values.map(value => ratioPresetValues[value]).filter(Boolean),
            settings:{
                quality:settingValue('batchQuality'), resolution:batchCapabilityResolution,
                outputs_per_submission:Number(settingValue('batchOutputsPerRun')),
                submissions_per_task:Number(settingValue('batchSubmissionsPerTask')),
                desired_concurrency:Number(settingValue('batchConcurrency')),
            },
            excluded:[...excluded],
        };
    }

    function cachedConfiguration(body = buildPayload()) {
        return {
            version:1,
            name_prefix:String(body.name_prefix || ''),
            prompt_modules:(body.prompt_modules || []).map(module => ({
                name:module.name,
                parse_mode:module.parse_mode,
                options:(module.options || []).map(option => (
                    option && typeof option === 'object' ? {...option} : option
                )),
            })),
            image_variables:(body.image_variables || []).map(variable => ({
                name:variable.name,
                options:(variable.options || []).filter(option => option?.url).map(option => ({...option})),
            })).filter(variable => variable.options.length),
            models:(body.models || []).map(model => ({...model})),
            ratios:[...(body.ratios || [])],
            settings:{...(body.settings || {})},
        };
    }

    function saveCachedConfiguration(body) {
        if (!configPersistenceReady) return;
        try {
            localStorage.setItem(batchConfigStorageKey, JSON.stringify(cachedConfiguration(body)));
        } catch (error) {
            console.warn('Could not cache batch generation configuration', error);
        }
    }

    function scheduleConfigSave() {
        if (!configPersistenceReady || applyingConfiguration) return;
        clearTimeout(configSaveTimer);
        configSaveTimer = setTimeout(() => saveCachedConfiguration(), 120);
    }

    function readCachedConfiguration() {
        try {
            const value = JSON.parse(localStorage.getItem(batchConfigStorageKey) || 'null');
            return value && typeof value === 'object' ? value : null;
        } catch (_) {
            return null;
        }
    }

    async function fetchJson(path, options = {}) {
        const response = await fetch(path, options);
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || tr('batch.requestFailed'));
        return data;
    }
    const request = (path, body) => fetchJson(path, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
    });

    async function updateEstimate() {
        if ($('batchGenerationMode').hidden || $('batchSetupStep').hidden) return;
        const body = buildPayload();
        if (!body.prompt_modules.length || body.prompt_modules.some(module => !module.options.length) || !body.models.length || !body.ratios.length) {
            $('batchOutputCount').textContent = '0'; return;
        }
        try {
            const data = await request('/api/batch-generation/preview', body);
            $('batchOutputCount').textContent = data.estimated_output_count; $('batchError').hidden = true;
        } catch (error) { $('batchError').textContent = error.message; $('batchError').hidden = false; }
    }

    function updateLocalEstimate() {
        updateDimensionMetrics();
        const body = buildPayload();
        const promptCounts = body.prompt_modules.map(module => module.options.length);
        if (!promptCounts.length || promptCounts.some(count => !count) || !body.models.length || !body.ratios.length) {
            $('batchOutputCount').textContent = '0';
            return;
        }
        const imageCounts = body.image_variables
            .map(variable => variable.options.length)
            .filter(Boolean);
        const combinations = [...promptCounts, ...imageCounts, body.models.length, body.ratios.length]
            .reduce((total, count) => total * count, 1);
        $('batchOutputCount').textContent = combinations
            * body.settings.outputs_per_submission
            * body.settings.submissions_per_task;
    }

    function scheduleEstimate() {
        clearTimeout(estimateTimer);
        updateLocalEstimate();
        estimateTimer = setTimeout(updateEstimate, 180);
        scheduleConfigSave();
    }

    async function uploadImages(body) {
        const cards = [...document.querySelectorAll('.batch-image-variable')];
        for (let variableIndex = 0; variableIndex < cards.length; variableIndex += 1) {
            const card = cards[variableIndex]; const uploaded = [];
            for (let start = 0; start < card._files.length; start += 50) {
                const chunk = card._files.slice(start, start + 50); const form = new FormData(); chunk.forEach(file => form.append('files', file, file.name));
                const response = await fetch('/api/ai/upload', {method:'POST', body:form}); const data = await response.json();
                if (!response.ok) throw new Error(data.detail || tr('batch.importFailed')); uploaded.push(...data.files);
            }
            body.image_variables[variableIndex].options = [
                ...(card._existingOptions || []).map(option => ({...option})),
                ...uploaded.map((item, index) => ({
                    ...item, relative_path:card._files[index]?.webkitRelativePath || card._files[index]?.name || item.name,
                })),
            ];
        }
        return body;
    }

    function setStep(step) {
        $('batchSteps').setAttribute('current', String(step));
    }
    function showBatchSubmitBar(view = '') {
        Object.entries(batchSubmitBars).forEach(([name, bar]) => {
            bar.hidden = name !== view || $('batchGenerationMode').hidden;
        });
    }
    const statusLabel = status => tr(({
        queued:'batch.queued', running:'batch.running', paused:'batch.paused', completed:'batch.completed',
        partially_failed:'batch.partiallyFailed', failed:'batch.failed', cancelled:'batch.cancelled', deleted:'batch.deleted',
        succeeded:'batch.succeeded',
    }[status] || status));
    const renderBatchStatusTag = status => `<span class="batch-status batch-status-${escape(status)}">${escape(statusLabel(status))}</span>`;
    const hideBatchViews = () => {
        ['batchSetupStep','batchPreviewStep','batchHistoryStep','batchDetailStep']
            .forEach(id => $(id).hidden = true);
        showBatchSubmitBar();
    };
    function activeBatchFlowView() {
        if (!$('batchPreviewStep').hidden) return 'preview';
        if (!$('batchDetailStep').hidden) return 'detail';
        return 'setup';
    }
    function showBatchSetup() {
        clearTimeout(batchPollTimer);
        hideBatchViews(); $('batchSteps').hidden = false; $('batchSetupStep').hidden = false; setStep(1); showBatchSubmitBar('setup');
    }

    function applyBatchConfiguration(snapshot = null, {restoreNamePrefix = true} = {}) {
        const frozen = snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
        applyingConfiguration = true;
        document.querySelectorAll('.batch-image-variable').forEach(card => {
            (card._objectUrls || []).forEach(url => URL.revokeObjectURL(url));
        });
        $('batchPromptModules').innerHTML = '';
        $('batchImageVariables').innerHTML = '';
        const promptModules = frozen?.prompt_modules || [];
        if (promptModules.length) {
            promptModules.forEach(module => addModule(module.options || [], module.parse_mode || 'lines'));
        } else {
            addModule();
        }
        const imageVariables = (frozen?.image_variables || [])
            .filter(variable => (variable?.options || []).length);
        imageVariables.forEach(variable => {
            addImageVariable(variable.options || []);
        });
        if (!imageVariables.length) addImageVariable();
        $('batchImageEmpty').hidden = true;

        const selectedModels = new Set((frozen?.models || []).map(model => {
            if (typeof model === 'string') return `|${model}`;
            return `${model.provider_id || ''}|${model.model || ''}`;
        }));
        const modelInputs = [...document.querySelectorAll('[data-batch-model-id]')];
        modelInputs.forEach(input => {
            const entry = modelCatalog.find(item => item.id === input.dataset.batchModelId);
            const key = `${entry?.provider_id || ''}|${entry?.model || ''}`;
            input.checked = frozen ? selectedModels.has(key) || selectedModels.has(`|${entry?.model || ''}`) : false;
        });
        const restoredRatios = (frozen?.ratios || ['1:1'])
            .map(value => ratioPresetByValue[value]).filter(Boolean);
        $('batchRatioChoices').values = restoredRatios.length ? restoredRatios : ['square'];
        const settings = frozen?.settings || {};
        const setChoice = (id, value, fallback) => {
            const group = $(id);
            const desired = String(value ?? fallback);
            const choice = [...group.querySelectorAll('ic-radio')]
                .find(input => input.value === desired)
                || [...group.querySelectorAll('ic-radio')].find(input => input.value === String(fallback));
            if (choice) group.value = choice.value;
        };
        setChoice('batchResolution', settings.resolution, '1k');
        setChoice('batchQuality', settings.quality, 'auto');
        setChoice('batchOutputsPerRun', settings.outputs_per_submission ?? settings.outputs_per_run, '1');
        setChoice('batchSubmissionsPerTask', settings.submissions_per_task, '1');
        setChoice('batchConcurrency', settings.desired_concurrency, '2');
        $('batchName').value = restoreNamePrefix ? String(frozen?.name_prefix || '') : '';
        applyingConfiguration = false;
    }

    function startNewBatchFromSnapshot(snapshot = null) {
        applyBatchConfiguration(snapshot, {restoreNamePrefix:false});
        updateBatchCapabilityIntersection().catch(error => notify(error.message));
        $('batchError').hidden = true;
        excluded = new Set();
        previewTasks = [];
        currentBatch = null;
        currentBatchId = '';
        showBatchSetup();
        scheduleEstimate();
        window.scrollTo({top:0, behavior:'smooth'});
    }
    function restoreBatchFlowView() {
        hideBatchViews();
        $('batchSteps').hidden = false;
        if (viewBeforeHistory === 'detail' && currentBatch) {
            $('batchDetailStep').hidden = false; setStep(3);
        } else if (viewBeforeHistory === 'preview' && previewTasks.length) {
            $('batchPreviewStep').hidden = false; setStep(2); showBatchSubmitBar('preview');
        } else {
            $('batchSetupStep').hidden = false; setStep(1); showBatchSubmitBar('setup');
        }
    }

    function batchOutputName(output, url, index) {
        if (output && typeof output === 'object' && output.name) return String(output.name);
        const encoded = String(url || '').split(/[?#]/, 1)[0].split('/').pop();
        try { return decodeURIComponent(encoded) || `batch-output-${index + 1}.png`; }
        catch (_) { return encoded || `batch-output-${index + 1}.png`; }
    }

    function batchDownloadHref(item) {
        if (!item?.url || /^(data:|blob:)/i.test(item.url) || item.url.startsWith('/api/download-output')) return item?.url || '#';
        return `/api/download-output?url=${encodeURIComponent(item.url)}&name=${encodeURIComponent(item.name)}`;
    }

    function previewReferenceImageUrls() {
        const urls = new Map();
        document.querySelectorAll('.batch-image-variable').forEach((card, variableIndex) => {
            (card._files || []).forEach((file, index) => {
                urls.set(imageOption(file, index, variableIndex).client_id, card._objectUrls[index]);
            });
        });
        return urls;
    }

    function taskReferenceImages(task, localUrls = new Map()) {
        return (task.reference_images || []).map(reference => ({
            url:String(typeof reference === 'string'
                ? reference
                : reference?.url || localUrls.get(reference?.client_id) || ''),
            name:String(typeof reference === 'string' ? tr('batch.referenceImage') : reference?.name || reference?.relative_path || tr('batch.referenceImage')),
        })).filter(reference => reference.url);
    }

    function renderTaskReferenceImages(task, localUrls) {
        const references = taskReferenceImages(task, localUrls);
        if (!references.length) return '<span class="batch-task-no-images">—</span>';
        return `<div class="batch-task-reference-images">${references.map(reference => `
            <img src="${escape(reference.url)}" alt="${escape(reference.name)}" title="${escape(reference.name)}" loading="lazy">
        `).join('')}</div>`;
    }

    function batchTaskReferenceFiles(task) {
        const files = [];
        (task.prompt_references || []).forEach(reference => {
            if (!reference) return;
            const value = typeof reference === 'string' ? reference
                : reference.relative_path || reference.name || '';
            if (value) files.push({kind:'TXT', icon:'file', value});
        });
        (task.reference_images || []).forEach(reference => {
            const value = typeof reference === 'string'
                ? reference.split('/').pop() || reference
                : reference?.relative_path || reference?.name
                    || String(reference?.url || '').split('/').pop();
            if (value) files.push({kind:'IMG', icon:'image', value});
        });
        const seen = new Set();
        return files.filter(file => {
            const key = `${file.kind}:${file.value}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function renderBatchImageReferenceFiles(task) {
        const references = batchTaskReferenceFiles(task || {});
        const container = $('batchImageReferenceFiles');
        container.hidden = references.length === 0;
        $('batchImageReferenceList').innerHTML = references.map(reference => `
            <li title="${escape(reference.value)}">
                <ic-icon name="${reference.icon}"></ic-icon>
                <span class="batch-image-reference-kind">${reference.kind}</span>
                <span>${escape(reference.value)}</span>
            </li>
        `).join('');
    }

    function ensureBatchImagePreview() {
        if (!batchImagePreview && window.StudioImagePreview) {
            batchImagePreview = window.StudioImagePreview.attach(
                $('batchImageEditStage'), {img:$('batchImageEditImage')}
            );
        }
        return batchImagePreview;
    }

    function syncBatchImageVisualViewport() {
        const modal = $('batchImageEditModal');
        const viewport = window.visualViewport;
        const metrics = viewport || {
            offsetTop:0,
            offsetLeft:0,
            width:window.innerWidth,
            height:window.innerHeight,
        };
        modal.style.setProperty('--batch-visual-viewport-top', `${metrics.offsetTop}px`);
        modal.style.setProperty('--batch-visual-viewport-left', `${metrics.offsetLeft}px`);
        modal.style.setProperty('--batch-visual-viewport-width', `${metrics.width}px`);
        modal.style.setProperty('--batch-visual-viewport-height', `${metrics.height}px`);
    }

    function startBatchImageViewportSync() {
        syncBatchImageVisualViewport();
        window.addEventListener('resize', syncBatchImageVisualViewport);
        window.visualViewport?.addEventListener('resize', syncBatchImageVisualViewport);
        window.visualViewport?.addEventListener('scroll', syncBatchImageVisualViewport);
    }

    function stopBatchImageViewportSync() {
        window.removeEventListener('resize', syncBatchImageVisualViewport);
        window.visualViewport?.removeEventListener('resize', syncBatchImageVisualViewport);
        window.visualViewport?.removeEventListener('scroll', syncBatchImageVisualViewport);
    }

    function resetBatchPromptCopyButton(item = batchImagePreviewItems[currentBatchOutputIndex]) {
        clearTimeout(batchPromptCopyResetTimer);
        const button = $('batchImageCopyPrompt');
        button.classList.remove('copied');
        button.disabled = !String(item?.prompt || '').trim();
        button.querySelector('span').textContent = tr('batch.copyPrompt');
    }

    async function writeBatchPromptToClipboard(text) {
        try {
            if (navigator.clipboard?.writeText && window.isSecureContext !== false) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (error) {
            // Fall back to a temporary selection for browsers without clipboard permission.
        }
        const textarea = document.createElement('ic-textarea');
        textarea.name = 'batch_clipboard_fallback';
        textarea.label = tr('batch.copyPrompt');
        textarea.value = text;
        textarea.className = 'batch-clipboard-fallback';
        document.body.appendChild(textarea);
        await customElements.whenDefined('ic-textarea');
        await textarea.updateComplete;
        textarea.textarea?.select();
        textarea.textarea?.setSelectionRange(0, textarea.value.length);
        let copied = false;
        try { copied = document.execCommand('copy'); } catch (error) { copied = false; }
        textarea.remove();
        return copied;
    }

    async function copyBatchImagePrompt() {
        const item = batchImagePreviewItems[currentBatchOutputIndex];
        const prompt = String(item?.prompt || '').trim();
        if (!prompt) return;
        const copied = await writeBatchPromptToClipboard(prompt);
        const button = $('batchImageCopyPrompt');
        button.classList.toggle('copied', copied);
        button.querySelector('span').textContent = tr(copied ? 'batch.promptCopied' : 'batch.copyFailed');
        clearTimeout(batchPromptCopyResetTimer);
        batchPromptCopyResetTimer = setTimeout(() => resetBatchPromptCopyButton(item), 1600);
    }

    async function batchClipboardPngBlob(item) {
        const sourceUrl = String(item?.url || '');
        if (!sourceUrl) throw new Error('Missing image URL');
        const requestUrl = /^(data:|blob:)/i.test(sourceUrl) || sourceUrl.startsWith('/api/download-output')
            ? sourceUrl
            : `/api/download-output?url=${encodeURIComponent(sourceUrl)}`;
        const response = await fetch(requestUrl);
        if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
        const blob = await response.blob();
        if (String(blob.type).toLowerCase() === 'image/png') return blob;

        const canvas = document.createElement('canvas');
        let bitmap = null;
        let source = null;
        let objectUrl = '';
        try {
            if (typeof createImageBitmap === 'function') {
                bitmap = await createImageBitmap(blob);
                source = bitmap;
            } else {
                objectUrl = URL.createObjectURL(blob);
                source = await new Promise((resolve, reject) => {
                    const image = new Image();
                    image.onload = () => resolve(image);
                    image.onerror = () => reject(new Error('Image decode failed'));
                    image.src = objectUrl;
                });
            }
            canvas.width = source.naturalWidth || source.width;
            canvas.height = source.naturalHeight || source.height;
            if (!canvas.width || !canvas.height) throw new Error('Image has no dimensions');
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Canvas is unavailable');
            context.drawImage(source, 0, 0);
            return await new Promise((resolve, reject) => canvas.toBlob(
                result => result ? resolve(result) : reject(new Error('PNG conversion failed')),
                'image/png'
            ));
        } finally {
            bitmap?.close?.();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        }
    }

    function resetBatchImageCopyButton() {
        clearTimeout(batchImageCopyResetTimer);
        const button = $('batchImageCopyImage');
        button.disabled = false;
        button.classList.remove('copied', 'failed');
        button.querySelector('span').textContent = tr('batch.copyImage');
    }

    function hideBatchImageContextMenu() {
        resetBatchImageCopyButton();
        $('batchImageContextMenu').hide('programmatic');
    }

    function openBatchImageContextMenu(event) {
        if (!batchImagePreviewItems[currentBatchOutputIndex]
            || !navigator.clipboard?.write || !window.ClipboardItem) return;
        if (event.target.closest('[data-no-pan]')) return;
        event.preventDefault();
        event.stopPropagation();
        hideBatchImageContextMenu();
        const menu = $('batchImageContextMenu');
        menu.show($('batchImageEditStage'));
        $('batchImageCopyImage').focus({preventScroll:true});
    }

    async function copyBatchImageToClipboard() {
        const item = batchImagePreviewItems[currentBatchOutputIndex];
        const button = $('batchImageCopyImage');
        const ClipboardItemType = window.ClipboardItem;
        if (!item?.url || !navigator.clipboard?.write || !ClipboardItemType) return;
        button.disabled = true;
        button.querySelector('span').textContent = tr('batch.copyingImage');
        try {
            const pngBlob = batchClipboardPngBlob(item);
            await navigator.clipboard.write([new ClipboardItemType({'image/png':pngBlob})]);
            button.classList.add('copied');
            button.querySelector('span').textContent = tr('batch.imageCopied');
            batchImageCopyResetTimer = setTimeout(hideBatchImageContextMenu, 1100);
        } catch (error) {
            console.error(error);
            button.classList.add('failed');
            button.querySelector('span').textContent = tr('batch.copyImageFailed');
            batchImageCopyResetTimer = setTimeout(hideBatchImageContextMenu, 2200);
        }
    }

    function renderBatchImagePreview() {
        const item = batchImagePreviewItems[currentBatchOutputIndex];
        if (!item) return;
        hideBatchImageContextMenu();
        ensureBatchImagePreview()?.reset();
        const image = $('batchImageEditImage');
        $('batchImageResolution').textContent = '--';
        image.onload = () => {
            $('batchImageResolution').textContent = image.naturalWidth && image.naturalHeight
                ? `${image.naturalWidth} × ${image.naturalHeight}` : '--';
        };
        image.src = item.url;
        image.alt = item.prompt || item.name;
        $('batchImageEditTitle').textContent = item.name;
        $('batchImageEditPrompt').textContent = item.prompt || tr('batch.generatedResult');
        renderBatchImageReferenceFiles(item.task);
        $('batchImageCounter').textContent = `${currentBatchOutputIndex + 1} / ${batchImagePreviewItems.length}`;
        $('batchImageDownload').href = batchDownloadHref(item);
        $('batchImageDownload').download = item.name;
        resetBatchPromptCopyButton(item);
        const hasMultiple = batchImagePreviewItems.length > 1;
        $('batchImagePrevious').hidden = !hasMultiple;
        $('batchImageNext').hidden = !hasMultiple;
    }

    function openBatchImagePreview(index, items = batchDetailOutputs) {
        if (!items[index]) return;
        batchImagePreviewItems = items;
        currentBatchOutputIndex = index;
        const modal = $('batchImageEditModal');
        if (!modal.open) batchImageBodyOverflow = document.body.style.overflow;
        startBatchImageViewportSync();
        modal.show();
        renderBatchImagePreview();
    }

    function closeBatchImagePreview() {
        const modal = $('batchImageEditModal');
        modal.hide('close');
        stopBatchImageViewportSync();
        clearTimeout(batchPromptCopyResetTimer);
        hideBatchImageContextMenu();
        ensureBatchImagePreview()?.reset();
        document.body.style.overflow = batchImageBodyOverflow;
    }

    function navigateBatchImagePreview(direction) {
        if (batchImagePreviewItems.length < 2) return;
        currentBatchOutputIndex = (
            currentBatchOutputIndex + direction + batchImagePreviewItems.length
        ) % batchImagePreviewItems.length;
        renderBatchImagePreview();
    }

    function renderBatchDetail(batch) {
        currentBatch = batch;
        currentBatchId = batch.id;
        hideBatchViews(); $('batchSteps').hidden = false; $('batchDetailStep').hidden = false; setStep(3);
        $('batchDetailName').textContent = batch.name;
        $('batchDetailStatus').innerHTML = renderBatchStatusTag(batch.status);
        const startedAt = new Date(batch.created_at * 1000);
        const startedAtText = startedAt.toLocaleString(window.StudioI18n?.lang?.() === 'en' ? 'en-US' : 'zh-CN');
        $('batchDetailStartedAt').dateTime = startedAt.toISOString();
        $('batchDetailStartedAt').textContent = startedAtText;
        $('batchDetailStartedAt').setAttribute('aria-label', tf('batch.startedAt', {time:startedAtText}));
        const progress = batch.progress || {}; const total = progress.total || 0;
        const finished = (progress.succeeded || 0) + (progress.failed || 0) + (progress.cancelled || 0);
        const progressComponent = $('batchProgress');
        progressComponent.setAttribute('max', String(Math.max(total, 1)));
        progressComponent.setAttribute('value', String(Math.min(finished, Math.max(total, 1))));
        progressComponent.setAttribute('value-text', `${finished} / ${total}`);
        $('batchProgressCounts').textContent = tf('batch.progressCounts', {
            succeeded:progress.succeeded || 0, failed:progress.failed || 0,
            running:progress.running || 0, queued:progress.queued || 0, total,
        });
        $('pauseBatch').hidden = batch.status !== 'running';
        $('resumeBatch').hidden = batch.status !== 'paused';
        $('cancelBatch').hidden = !['running','paused','queued'].includes(batch.status);
        $('retryFailedBatch').hidden = !(progress.failed > 0);
        $('rerunBatch').hidden = !['completed','partially_failed','failed','cancelled'].includes(batch.status);
        batchDetailOutputs = (batch.tasks || []).flatMap(task => (task.outputs || []).map(output => ({output, task})))
            .map(({output, task}, index) => {
                const url = String(typeof output === 'string' ? output : output?.url || '');
                return {url, name:batchOutputName(output, url, index), prompt:task.prompt || '', task};
            }).filter(item => item.url);
        $('batchResultGallery').innerHTML = batchDetailOutputs.map((item, index) => {
            return `<figure data-batch-output-index="${index}" tabindex="0" aria-label="${escape(item.prompt || item.name)}"><ic-media-container kind="image" label="${escape(item.prompt || item.name)}" aspect="square" fit="cover"><img src="${escape(item.url)}" loading="lazy" alt="${escape(item.prompt || tr('batch.outputs'))}"></ic-media-container><figcaption><span class="batch-result-model">${renderTaskModel(item.task)}</span><span class="batch-result-prompt" title="${escape(item.prompt)}">${escape(item.prompt)}</span></figcaption><ic-button size="small" hierarchy="secondary" tone="neutral" data-legal-comination="secondary-action" href="${escape(batchDownloadHref(item))}" download="${escape(item.name)}"><ic-icon slot="start" name="download"></ic-icon>${tr('batch.download')}</ic-button></figure>`;
        }).join('');
        document.querySelectorAll('[data-batch-output-index]').forEach(figure => {
            const open = event => {
                if (event.target.closest('ic-button')) return;
                openBatchImagePreview(Number(figure.dataset.batchOutputIndex));
            };
            figure.ondblclick = open;
            figure.onkeydown = event => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault(); open(event);
            };
        });
        $('batchGalleryEmpty').hidden = batchDetailOutputs.length > 0;
        const batchSettings = batch.snapshot?.settings || {};
        $('batchDetailTaskRows').innerHTML = (batch.tasks || []).map(task => {
            const settings = task.settings || batchSettings;
            const resolution = settings.resolution || batchSettings.resolution || '—';
            const quality = settings.quality || batchSettings.quality || '';
            const submissions = Number(task.submissions || settings.submissions_per_task || 1);
            const outputCount = Array.isArray(task.outputs) ? task.outputs.length : 0;
            return `<tr>
                <th scope="row"><div class="batch-history-identity"><strong>${escape(`#${Number(task.index) + 1}`)}</strong></div></th>
                <td><div class="batch-history-prompt" title="${escape(task.prompt)}"><span>${escape(task.prompt)}</span></div></td>
                <td><div class="batch-task-resolution"><span class="batch-history-resolution">${escape(String(resolution).toUpperCase())}</span>${quality ? `<small>${escape(quality)}</small>` : ''}</div></td>
                <td>${renderTaskModel(task)}</td>
                <td><div class="batch-history-ratios"><span>${escape(task.ratio)}</span></div></td>
                <td>${renderTaskReferenceImages(task)}</td>
                <td><strong class="batch-task-count">${submissions}</strong></td>
                <td><strong class="batch-history-output-count">${outputCount}</strong></td>
                <td>${renderBatchStatusTag(task.status)}</td>
                <td><span class="batch-task-error" title="${escape(task.error)}">${escape(task.error) || '—'}</span></td>
            </tr>`;
        }).join('');
        clearTimeout(batchPollTimer);
        if (['running','queued','paused'].includes(batch.status)) {
            batchPollTimer = setTimeout(() => openBatch(batch.id), 1800);
        }
    }

    async function openBatch(batchId) {
        try {
            renderBatchDetail(await fetchJson(`/api/batch-generation/batches/${encodeURIComponent(batchId)}`));
        } catch (error) { console.error(error); }
    }

    function historyPromptSummary(batch) {
        const prompts = [...new Set((batch.tasks || [])
            .map(task => String(task?.prompt || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean))];
        if (!prompts.length) return '<span class="batch-history-empty-value">—</span>';
        const more = prompts.length - 1;
        return `<div class="batch-history-prompt" title="${escape(prompts[0])}"><span>${escape(prompts[0])}</span>${more > 0 ? `<small>${escape(tf('batch.morePrompts', {count:more}))}</small>` : ''}</div>`;
    }

    function historyModels(batch) {
        const source = batch.snapshot?.models?.length
            ? batch.snapshot.models
            : (batch.tasks || []).map(task => ({
                model:task.model, name:task.model_name || task.model,
                provider_id:task.provider_id,
            }));
        const models = [...new Map(source.filter(Boolean).map(model => {
            const entry = typeof model === 'string' ? {model, name:model} : model;
            return [`${entry.provider_id || ''}:${entry.model || entry.name || ''}`, entry];
        })).values()];
        if (!models.length) return '<span class="batch-history-empty-value">—</span>';
        return `<div class="batch-history-models">${renderSnapshotModel(models[0])}${models.length > 1 ? `<small>+${models.length - 1}</small>` : ''}</div>`;
    }

    function historyRatios(batch) {
        const ratios = [...new Set((batch.snapshot?.ratios?.length
            ? batch.snapshot.ratios
            : (batch.tasks || []).map(task => task.ratio)).filter(Boolean).map(String))];
        if (!ratios.length) return '<span class="batch-history-empty-value">—</span>';
        const visible = ratios.slice(0, 2);
        return `<div class="batch-history-ratios">${visible.map(ratio => `<span>${escape(ratio)}</span>`).join('')}${ratios.length > visible.length ? `<small>+${ratios.length - visible.length}</small>` : ''}</div>`;
    }

    function historyReferenceImages(batch) {
        const source = (batch.snapshot?.image_variables || [])
            .flatMap(variable => variable?.options || []);
        const images = [...new Map(source.map(reference => {
            const url = String(typeof reference === 'string' ? reference : reference?.url || '');
            const name = String(typeof reference === 'string'
                ? reference.split('/').pop() || tr('batch.referenceImage')
                : reference?.name || reference?.relative_path || tr('batch.referenceImage'));
            return [url, {url, name}];
        }).filter(([url]) => url)).values()];
        if (!images.length) return '<span class="batch-history-empty-value">—</span>';
        const visible = images.slice(0, 3);
        return `<div class="batch-history-images" aria-label="${escape(tf('batch.imageCount', {count:images.length}))}">${visible.map(image => `<img src="${escape(image.url)}" alt="${escape(image.name)}" title="${escape(image.name)}" loading="lazy">`).join('')}${images.length > visible.length ? `<small>+${images.length - visible.length}</small>` : ''}</div>`;
    }

    function historyOutputCount(batch) {
        const actual = (batch.tasks || []).reduce((total, task) => (
            total + (Array.isArray(task?.outputs) ? task.outputs.length : 0)
        ), 0);
        return `<strong class="batch-history-output-count">${actual}</strong>`;
    }

    function renderBatchHistoryRow(batch) {
        const progress = batch.progress || {};
        const progressTotal = Number(progress.total || 0);
        const progressFinished = Number(progress.succeeded || 0) + Number(progress.failed || 0) + Number(progress.cancelled || 0);
        const created = new Date(batch.created_at * 1000).toLocaleString(window.StudioI18n?.lang?.() === 'en' ? 'en-US' : 'zh-CN');
        const resolution = batch.snapshot?.settings?.resolution || '—';
        return `<tr>
            <th scope="row"><div class="batch-history-identity"><strong title="${escape(batch.name)}">${escape(batch.name)}</strong></div></th>
            <td><time class="batch-history-time" datetime="${escape(new Date(batch.created_at * 1000).toISOString())}">${escape(created)}</time></td>
            <td>${historyPromptSummary(batch)}</td>
            <td><span class="batch-history-resolution">${escape(String(resolution).toUpperCase())}</span></td>
            <td>${historyModels(batch)}</td>
            <td>${historyRatios(batch)}</td>
            <td>${historyReferenceImages(batch)}</td>
            <td>${historyOutputCount(batch)}</td>
            <td><div class="batch-history-status">${renderBatchStatusTag(batch.status)}<small>${progressFinished} / ${progressTotal}</small></div></td>
            <td><ic-icon-button hierarchy="quiet" type="button" icon="forward" data-open-batch="${escape(batch.id)}" label="${escape(tf('batch.openBatch', {name:batch.name}))}"></ic-icon-button></td>
        </tr>`;
    }

    async function showBatchHistory(background = false) {
        const data = await fetchJson('/api/batch-generation/history'); const batches = data.batches || [];
        if (!background && $('batchHistoryStep').hidden) viewBeforeHistory = activeBatchFlowView();
        clearTimeout(batchPollTimer);
        hideBatchViews(); $('batchSteps').hidden = true; $('batchHistoryStep').hidden = false;
        $('batchHistoryEmpty').hidden = batches.length > 0;
        $('batchHistoryTableWrap').hidden = batches.length === 0;
        $('batchHistoryList').innerHTML = batches.map(renderBatchHistoryRow).join('');
        document.querySelectorAll('[data-open-batch]').forEach(button => button.onclick = () => openBatch(button.dataset.openBatch));
        if (batches.some(batch => ['running','queued'].includes(batch.status))) {
            batchPollTimer = setTimeout(() => showBatchHistory(true).catch(error => {
                console.error(error);
                if (!$('batchHistoryStep').hidden) batchPollTimer = setTimeout(() => showBatchHistory(true).catch(console.error), 1800);
            }), 1800);
        }
    }

    async function batchAction(action, confirmation = '') {
        if (!currentBatchId) return;
        if (confirmation && !await confirmAction(confirmation)) return;
        try {
            renderBatchDetail(await fetchJson(`/api/batch-generation/batches/${encodeURIComponent(currentBatchId)}/${action}`, {method:'POST'}));
        } catch (error) { notify(error.message); }
    }

    $('addPromptModule').onclick = () => addModule();
    $('addImageVariable').onclick = () => { addImageVariable(); scheduleEstimate(); };
    $('batchHistoryButton').onclick = () => showBatchHistory().catch(error => notify(error.message));
    $('closeBatchHistory').onclick = restoreBatchFlowView;
    $('backToBatchHistoryFromDetail').onclick = () => showBatchHistory().catch(error => notify(error.message));
    $('createBatchFromCurrent').onclick = () => {
        if (!currentBatch) return;
        startNewBatchFromSnapshot(currentBatch.snapshot);
    };
    $('pauseBatch').onclick = () => batchAction('pause');
    $('resumeBatch').onclick = () => batchAction('resume');
    $('cancelBatch').onclick = () => batchAction('cancel', tf('batch.cancelConfirm', {name:currentBatch?.name || tr('batch.current')}));
    $('retryFailedBatch').onclick = () => batchAction('retry-failed');
    $('rerunBatch').onclick = () => {
        const total = currentBatch?.progress?.total || currentBatch?.tasks?.length || 0;
        const settings = currentBatch?.snapshot?.settings || {};
        const submissions = total * Number(settings.submissions_per_task || 1);
        const outputs = submissions * Number(settings.outputs_per_submission || settings.outputs_per_run || 1);
        batchAction('rerun', tf('batch.rerunConfirm', {runs:total, submissions, outputs}));
    };
    $('closeBatchImageEdit').onclick = closeBatchImagePreview;
    $('batchImageCopyPrompt').onclick = copyBatchImagePrompt;
    $('batchImageCopyImage').onclick = copyBatchImageToClipboard;
    $('batchImageEditStage').oncontextmenu = openBatchImageContextMenu;
    $('batchImagePrevious').onclick = () => navigateBatchImagePreview(-1);
    $('batchImageNext').onclick = () => navigateBatchImagePreview(1);
    $('batchImageEditModal').onclick = event => {
        if (event.target === $('batchImageEditModal')) closeBatchImagePreview();
    };
    document.addEventListener('pointerdown', event => {
        const menu = $('batchImageContextMenu');
        if (menu.hasAttribute('open') && !menu.contains(event.target)) hideBatchImageContextMenu();
    });
    document.addEventListener('keydown', event => {
        if (!$('batchImageEditModal').open) return;
        if (event.key === 'Escape' && $('batchImageContextMenu').hasAttribute('open')) {
            hideBatchImageContextMenu();
            event.preventDefault();
            return;
        }
        if (event.key === 'Escape') closeBatchImagePreview();
        if (event.key === 'ArrowLeft') navigateBatchImagePreview(-1);
        if (event.key === 'ArrowRight') navigateBatchImagePreview(1);
        if (['Escape','ArrowLeft','ArrowRight'].includes(event.key)) event.preventDefault();
    });
    document.querySelectorAll('[data-detail-tab]').forEach(button => button.onclick = () => {
        document.querySelectorAll('[data-detail-tab]').forEach(item => {
            item.classList.toggle('is-active', item === button);
            item.setAttribute('aria-selected', String(item === button));
        });
        $('batchGalleryPanel').hidden = button.dataset.detailTab !== 'gallery';
        $('batchTasksPanel').hidden = button.dataset.detailTab !== 'tasks';
    });
    document.querySelectorAll('[data-detail-tab]').forEach((button, index) => {
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(index === 0));
    });
    ['batchResolution','batchQuality','batchOutputsPerRun','batchSubmissionsPerTask','batchConcurrency']
        .forEach(id => $(id).addEventListener('change', () => {
            if (id === 'batchResolution') batchCapabilityResolution = settingValue(id);
            scheduleEstimate();
        }));
    $('batchName').addEventListener('input', scheduleConfigSave);

    function updatePreviewSelection() {
        const checkboxes = [...document.querySelectorAll('[data-task-index]')];
        const taskByIndex = new Map(previewTasks.map(task => [Number(task.index), task]));
        excluded = new Set(checkboxes.filter(input => !input.checked).map(input => Number(input.dataset.taskIndex)));
        const selected = checkboxes.filter(input => input.checked);
        const selectedSubmissions = selected.reduce((sum, input) => {
            const task = taskByIndex.get(Number(input.dataset.taskIndex));
            return sum + Number(task?.submissions || 1);
        }, 0);
        const selectedOutputs = selected.reduce((sum, input) => {
            const task = taskByIndex.get(Number(input.dataset.taskIndex));
            return sum + Number(task?.outputs || 0);
        }, 0);
        $('batchSelectedRunCount').textContent = selected.length;
        $('batchSelectedSubmissionCount').textContent = selectedSubmissions;
        $('batchExcludedCount').textContent = excluded.size;
        $('batchSelectedOutputCount').textContent = selectedOutputs;
        $('startBatch').disabled = selected.length === 0;
        $('batchConfirmation').textContent = selected.length
            ? tr('batch.confirmation')
            : tr('batch.keepOneTask');
    }

    function setBatchSubmitting(submitting) {
        const button = $('startBatch');
        button.setAttribute('aria-busy', String(submitting));
        button.classList.toggle('is-submitting', submitting);
        button.textContent = tr(submitting ? 'batch.submitting' : 'batch.submit');
        if (submitting) button.disabled = true;
    }

    $('previewBatch').onclick = async () => {
        try {
            clearTimeout(estimateTimer);
            excluded = new Set(); const preview = await request('/api/batch-generation/preview', buildPayload());
            previewTasks = preview.tasks || [];
            const localImageUrls = previewReferenceImageUrls();
            $('batchTaskRows').innerHTML = previewTasks.map(task => `<tr><td><ic-checkbox data-task-index="${task.index}" label="${tf('batch.includeTask', {number:task.index + 1})}" checked></ic-checkbox></td><td>${task.index + 1}</td><td>${renderTaskReferenceImages(task, localImageUrls)}</td><td>${escape(task.prompt)}</td><td>${renderTaskModel(task)}</td><td>${escape(task.ratio)}</td><td>${task.submissions || 1}</td><td>${task.outputs}</td></tr>`).join('');
            $('batchTaskRows').onchange = event => {
                if (!event.target.matches('[data-task-index]')) return;
                updatePreviewSelection();
            };
            $('batchSetupStep').hidden = true; $('batchPreviewStep').hidden = false; $('batchSteps').hidden = false; setStep(2); showBatchSubmitBar('preview'); updatePreviewSelection(); window.scrollTo({top:0,behavior:'smooth'});
        } catch (error) { $('batchError').textContent = error.message; $('batchError').hidden = false; }
    };
    $('backToBatchSetup').onclick = () => { $('batchPreviewStep').hidden = true; $('batchSetupStep').hidden = false; setStep(1); showBatchSubmitBar('setup'); };
    $('startBatch').onclick = async () => {
        if ($('startBatch').getAttribute('aria-busy') === 'true') return;
        setBatchSubmitting(true);
        try {
            const body = await uploadImages(buildPayload());
            saveCachedConfiguration(body);
            const batch = await request('/api/batch-generation/batches', body);
            renderBatchDetail(batch);
        } catch (error) {
            notify(error.message);
        } finally {
            setBatchSubmitting(false);
            if (!$('batchPreviewStep').hidden) updatePreviewSelection();
        }
    };

    function refreshBatchLanguage() {
        document.querySelectorAll('.batch-module').forEach(module => {
            module.querySelector('.batch-module-options').placeholder = tr('batch.onePerLinePlaceholder');
            const parseSelect = module.querySelector('.batch-parse-mode');
            const parseKeys = {lines:'batch.onePerLine', raw:'batch.rawText', paragraphs:'batch.paragraphs', delimiter:'batch.customDelimiter'};
            [...parseSelect.querySelectorAll(':scope > option')].forEach(option => {
                const label = tr(parseKeys[option.value]);
                option.textContent = label;
                option.label = label;
            });
            parseSelect.syncOptions?.();
            parseSelect.setAttribute('label', tr('batch.parseMode'));
            parseSelect.displayLabel = tr(parseKeys[parseSelect.value]);
            module.querySelector('.batch-custom-delimiter').setAttribute('aria-label', tr('batch.customDelimiter'));
            module.querySelector('.batch-import-menu').setAttribute('label', tr('batch.import'));
            module.querySelector('.batch-import-trigger .batch-button-label').textContent = tr('batch.import');
            module.querySelector('.batch-import-files').setAttribute('label', tr('batch.chooseFiles'));
            module.querySelector('.batch-import-folder').setAttribute('label', tr('batch.chooseFolder'));
            updateModule(module);
        });
        renumberPromptModules();
        document.querySelectorAll('.batch-image-variable').forEach(card => {
            card.querySelector('.batch-image-import-menu').setAttribute('label', tr('batch.import'));
            card.querySelector('.batch-image-import-menu .batch-button-label').textContent = tr('batch.import');
            card.querySelector('.batch-import-images').setAttribute('label', tr('batch.addImages'));
            card.querySelector('.batch-import-image-folder').setAttribute('label', tr('batch.chooseFolder'));
            renderImageVariable(card);
        });
        renumberImageVariables();
        renderGenerationChoices();
        $('batchRatioChoices').setAttribute('label', tr('batch.aspectRatios'));
        if ($('batchError').dataset.errorCode === 'no-shared-model-options') {
            $('batchError').textContent = tr('batch.noSharedModelOptions');
        }
        setBatchSubmitting($('startBatch').getAttribute('aria-busy') === 'true');
        if (currentBatch && !$('batchDetailStep').hidden) renderBatchDetail(currentBatch);
    }
    window.addEventListener('studio-lang-change', refreshBatchLanguage);

    Promise.all([
        customElements.whenDefined('ic-button'),
        customElements.whenDefined('ic-checkbox'),
        customElements.whenDefined('ic-radio-group'),
        customElements.whenDefined('ic-select'),
        customElements.whenDefined('ic-menu'),
        customElements.whenDefined('ic-file-input'),
        customElements.whenDefined('ic-image-frame'),
        customElements.whenDefined('ic-aspect-ratio-picker'),
    ]).then(async () => {
        addModule();
        addImageVariable();
        showBatchSetup();
        await initializeBatchConfiguration();
    });
})();
