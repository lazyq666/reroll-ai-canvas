const { chromium } = require('playwright');

const baseUrl = process.env.T27_PREVIEW_URL || 'http://127.0.0.1:3101';
const executablePath = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    const contractErrors = [];
    let batchPayload = null;
    page.on('pageerror', error => errors.push(error.stack || error.message));
    page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
    });
    await page.addInitScript(() => {
        document.addEventListener('ic-contract-error', event => {
            window.__t27ContractErrors ||= [];
            window.__t27ContractErrors.push(event.detail);
        });
    });
    const login = await page.request.post(`${baseUrl}/api/auth/login`, { data: {
        username: 'batch-browser-designer', password: 'batch-browser-password',
    }});
    if (!login.ok()) throw new Error(`T27 login failed: ${login.status()}`);
    await page.route('**/api/config', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({
            api_providers: [{ id: 'openai', name: 'OpenAI', enabled: true, image_models: ['gpt-image-2'] }],
            available_models: { image: Array.from({ length: 12 }, (_, index) => ({
                id: `openai-gpt-${index + 1}`, provider_id: 'openai', provider_name: 'OpenAI',
                model: `gpt-image-${index + 1}`, name: `GPT Image ${index + 1}`,
            })) },
        }),
    }));
    await page.route('**/api/batch-generation/preview', route => {
        batchPayload = route.request().postDataJSON();
        const prompt = batchPayload.prompt_modules[0]?.options[0] || '测试提示词';
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            estimated_output_count: 1,
            tasks: [{ index: 0, prompt, model: batchPayload.models[0]?.model, provider_id: batchPayload.models[0]?.provider_id, ratio: batchPayload.ratios[0], submissions: 1, outputs: 1, reference_images: [] }],
        }) });
    });
    await page.route('**/api/batch-generation/history', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ batches: [{
            id: 'batch-t27', name: '红狐角色探索', owner: 'batch-browser-designer', status: 'running',
            created_at: 1700000000, progress: { succeeded: 1, running: 1, total: 2 },
            snapshot: {
                models: [{ provider_id: 'openai', model: 'gpt-image-2', name: 'GPT Image 2' }],
                ratios: ['1:1', '3:4'],
                image_variables: [{ name: 'IMG 01', options: [{
                    name: 'red-fox-reference.png',
                    url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                }] }],
                settings: { resolution: '2k', outputs_per_submission: 2, submissions_per_task: 1 },
            },
            tasks: [
                { prompt: '红狐站在薄雾森林中，电影光线', outputs: ['result-1.png', 'result-2.png'] },
                { prompt: '红狐在雪地回望，浅景深', outputs: [] },
            ],
        }] }),
    }));
    await page.goto(`${baseUrl}/static/online.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => customElements.get('ic-file-input'));
    await page.waitForTimeout(250);
    await page.waitForSelector('#batchGenerationMode:not([hidden])');
    contractErrors.push(...await page.evaluate(() => window.__t27ContractErrors || []));
    const pageStructure = await page.evaluate(() => ({
        title:document.title,
        heading:document.querySelector('.batch-page-header ic-heading')?.textContent.trim(),
        historyButton:document.querySelector('.batch-page-header > #batchHistoryButton') !== null,
        modeSwitches:document.querySelectorAll('#generationModeTabs, #singleModeTab, #batchModeTab').length,
        singleSurfaces:document.querySelectorAll('#singleGenerationMode, #singleGenerationHistory, #genBtn, #modelSelect').length,
        batchVisible:!document.querySelector('#batchGenerationMode').hidden,
        overflow:document.documentElement.scrollWidth > document.documentElement.clientWidth,
        invalid:[...document.querySelectorAll('[data-ic-contract-status="invalid"]')].map(node => ({ tag: node.localName, id: node.id, reason: node.dataset.icContractReason })),
    }));
    await page.waitForSelector('.batch-module');
    await page.waitForSelector('.batch-uniform-sidebar.is-portaled');
    await page.click('#addPromptModule');
    const promptEditors = page.locator('.batch-module-options textarea');
    for (let index = 0; index < await promptEditors.count(); index += 1) {
        await promptEditors.nth(index).fill(`红狐，森林 ${index + 1}`);
    }
    await page.locator('.batch-import-trigger').first().click();
    const importInteraction = await page.evaluate(() => {
        const menu = document.querySelector('.batch-import-menu');
        return {
            open:menu.hasAttribute('open'),
            display:getComputedStyle(menu.shadowRoot.querySelector('[part~="surface"]')).display,
        };
    });
    await page.locator('.batch-import-trigger').first().click();
    await page.locator('[data-batch-model-id]').first().click();
    await page.waitForTimeout(100);
    const fixedRows = await page.evaluate(() => {
        const modelRow = document.querySelector('.batch-model-row');
        const table = document.querySelector('.batch-dimension-table');
        const nativeTable = table.querySelector('table');
        const modelGrid = document.querySelector('#batchModelChoices');
        const modelItems = [...modelGrid.children];
        const checkedModel = modelItems.find(item => item.checked);
        const uncheckedModel = modelItems.find(item => !item.checked);
        const modelBackground = item => getComputedStyle(item.shadowRoot.querySelector('[part~="base"]')).backgroundColor;
        const modelColor = item => getComputedStyle(item.shadowRoot.querySelector('[part~="base"]')).color;
        const modelPadding = item => getComputedStyle(item.shadowRoot.querySelector('[part~="base"]')).paddingInline;
        const modelBorder = item => getComputedStyle(item.shadowRoot.querySelector('[part~="base"]')).border;
        const steps = document.querySelector('#batchSteps');
        const indicator = steps.shadowRoot.querySelector('[aria-current="step"] .indicator');
        const widths = [...modelGrid.children].map(item => item.getBoundingClientRect().width);
        const optionHeaderRect = nativeTable.querySelector('thead th:nth-child(3)').getBoundingClientRect();
        const dimensionHeaderWidths = [...nativeTable.querySelectorAll('thead th')].map(item => Math.round(item.getBoundingClientRect().width));
        const ratioPicker = document.querySelector('#batchRatioChoices');
        const ratioLegend = ratioPicker.shadowRoot.querySelector('legend');
        const ratioButtons = [...ratioPicker.shadowRoot.querySelectorAll('.ratio-options button')];
        const ratioButtonsPerRow = Object.values(ratioButtons.reduce((rows, button) => {
            const top = Math.round(button.getBoundingClientRect().top);
            rows[top] = (rows[top] || 0) + 1;
            return rows;
        }, {}));
        const parseLayouts = [...document.querySelectorAll('.batch-parse-mode')].map(select => {
            const formControl = select.shadowRoot.querySelector('[part~="form-control"]');
            const label = select.shadowRoot.querySelector('[part~="form-control-label"]');
            const input = select.shadowRoot.querySelector('[part~="form-control-input"]');
            const labelRect = label.getBoundingClientRect();
            const inputRect = input.getBoundingClientRect();
            return {
                tag:select.localName,
                options:select.querySelectorAll(':scope > option').length,
                verticalAlign:getComputedStyle(formControl).alignItems,
                textAlign:getComputedStyle(label).textAlign,
                leftRight:labelRect.right <= inputRect.left,
                centerDelta:Math.abs((labelRect.top + labelRect.height / 2) - (inputRect.top + inputRect.height / 2)),
            };
        });
        const countStyles = [...document.querySelectorAll('.batch-option-count, .batch-image-count')].map(item => {
            const style = getComputedStyle(item);
            return {background:style.backgroundColor,padding:style.padding,border:style.borderStyle};
        });
        const uniformRows = [...document.querySelectorAll('.batch-uniform-grid ic-radio-group')].map(group => {
            const label = group.shadowRoot.querySelector('[part~="form-control-label"]');
            const input = group.shadowRoot.querySelector('[part~="form-control-input"]');
            const formControl = group.shadowRoot.querySelector('[part~="form-control"]');
            const labelRect = label.getBoundingClientRect();
            const inputRect = input.getBoundingClientRect();
            const itemRect = group.querySelector('ic-radio').getBoundingClientRect();
            return {
                label:group.label,
                labelWidth:Math.round(labelRect.width),
                labelHeight:Math.round(labelRect.height),
                itemHeight:Math.round(itemRect.height),
                gap:Math.round(inputRect.left - labelRect.right),
                textAlign:getComputedStyle(label).textAlign,
                inputJustify:getComputedStyle(input).justifyContent,
                verticalAlign:getComputedStyle(formControl).alignItems,
                leftRight:labelRect.right <= inputRect.left,
            };
        });
        const promptFooters = [...document.querySelectorAll('.batch-module-options')].map(textarea => {
            const hint = textarea.shadowRoot.querySelector('[part~="hint"]');
            const textareaRect = textarea.getBoundingClientRect();
            const hintRect = hint.getBoundingClientRect();
            return {
                fills:Math.abs(textareaRect.width - hintRect.width) <= 2,
                paddingLeft:getComputedStyle(hint).paddingLeft,
                background:getComputedStyle(hint).backgroundColor,
                columns:getComputedStyle(textarea.querySelector('.batch-parse-row')).gridTemplateColumns.split(' ').length,
            };
        });
        const firstModelChoice = document.querySelector('[data-batch-model-id]');
        const firstModelIcon = firstModelChoice.querySelector('.model-vendor-icon').getBoundingClientRect();
        return {
            numbers: [document.querySelector('#batchModelRowNumber').textContent, document.querySelector('#batchRatioRowNumber').textContent],
            tableWidthBounded: table.scrollWidth <= table.clientWidth + 4,
            optionColumnFillsRemainder:Math.abs(optionHeaderRect.width - (
                table.clientWidth - [...nativeTable.querySelectorAll('thead th:not(:nth-child(3))')]
                    .reduce((sum, item) => sum + item.getBoundingClientRect().width, 0)
            )) <= 2,
            dimensionHeaderWidths,
            modelChoicesBounded: Math.max(...widths) < modelGrid.clientWidth,
            modelColumns:getComputedStyle(modelGrid).gridTemplateColumns.split(' ').length,
            modelRowHeight: modelRow.getBoundingClientRect().height,
            uncheckedModelBackground:modelBackground(uncheckedModel),
            checkedModelBackground:modelBackground(checkedModel),
            uncheckedModelColor:modelColor(uncheckedModel),
            checkedModelColor:modelColor(checkedModel),
            checkedModelBorder:modelBorder(checkedModel),
            uncheckedModelPadding:modelPadding(uncheckedModel),
            tableCellInlinePadding:[...document.querySelectorAll('#batchGenerationMode ic-table th, #batchGenerationMode ic-table td')]
                .map(cell => [getComputedStyle(cell).paddingLeft, getComputedStyle(cell).paddingRight]),
            ratioModules:document.querySelectorAll('.batch-ratio-row, #batchRatioChoices').length,
            ratioLegendDisplay:getComputedStyle(ratioLegend).display,
            ratioMaxButtonsPerRow:Math.max(0, ...ratioButtonsPerRow),
            ratioCount:document.querySelector('#batchRatioCount').textContent,
            pageHeadCount:document.querySelectorAll('.online-page-head').length,
            variableActions:[...document.querySelectorAll('#addPromptModule, #addImageVariable')].map(item => item.textContent.trim()),
            promptFields:document.querySelectorAll('[data-component-name="ic-form-field-textarea-s"]').length,
            legacyPromptContainers:document.querySelectorAll('.batch-prompt-source-editor, .batch-prompt-option-list').length,
            parseRowsInsideTextarea:[...document.querySelectorAll('.batch-parse-row')]
                .filter(item => item.closest('ic-textarea.batch-module-options')).length,
            parseLayouts,
            importMenus:document.querySelectorAll('.batch-import-menu').length,
            importTriggers:document.querySelectorAll('.batch-import-trigger').length,
            importChoices:[...document.querySelectorAll('.batch-import-menu ic-menu-item')].map(item => item.getAttribute('label')),
            importVariants:[...document.querySelectorAll('.batch-import-trigger')].map(item => item.dataset.buttonVariant),
            importPopupRoles:[...document.querySelectorAll('.batch-import-trigger')].map(item => item.getAttribute('aria-haspopup')),
            imageImportRight:document.querySelector('.batch-image-cell > .batch-image-actions:last-child') !== null,
            textFileInputs:[...document.querySelectorAll('.batch-text-files')].map(item => item.hasAttribute('multiple')),
            visibleEmptyFileCounts:[...document.querySelectorAll('.batch-file-count')].filter(item => !item.hidden && item.textContent.trim()).length,
            imageFileNames:document.querySelectorAll('.batch-image-option figcaption').length,
            countStyles,
            countTexts:[...document.querySelectorAll('.batch-dimension-table .batch-count-cell')].map(item => item.textContent.trim()),
            redundantImagePicker:document.querySelectorAll('.batch-pick-single-image').length,
            promptFooters,
            modelChoice:{fontSize:getComputedStyle(firstModelChoice.shadowRoot.querySelector('[part~="label"]')).fontSize,width:Math.round(firstModelIcon.width),height:Math.round(firstModelIcon.height)},
            uniformRows,
            steps: {
                current: steps.getAttribute('current'),
                indicatorWidth: indicator.getBoundingClientRect().width,
                indicatorHeight: indicator.getBoundingClientRect().height,
                paddingTop:getComputedStyle(steps).paddingTop,
                paddingBottom:getComputedStyle(steps).paddingBottom,
                marginTop:getComputedStyle(steps).marginTop,
                marginBottom:getComputedStyle(steps).marginBottom,
            },
            tableCaptionCount: nativeTable.querySelectorAll('caption').length,
            nativeTableLabel: nativeTable.getAttribute('aria-label'),
            sectionTitles:[document.querySelector('#batchCombinationSettingsTitle'), document.querySelector('#batchUniformSettingsTitle')].map(title => ({
                text:title.textContent.trim(),
                fontSize:getComputedStyle(title).fontSize,
                fontWeight:getComputedStyle(title).fontWeight,
            })),
            uniformDescription:document.querySelector('.batch-uniform-sidebar > header p')?.textContent.trim() || '',
            tableHeadersCentered:[...document.querySelectorAll('#batchGenerationMode ic-table th')]
                .every(cell => getComputedStyle(cell).verticalAlign === 'middle'),
            tableCellsTopAligned:[...document.querySelectorAll('#batchGenerationMode ic-table td')]
                .every(cell => getComputedStyle(cell).verticalAlign === 'top'),
        };
    });
    await page.click('#previewBatch');
    await page.waitForSelector('#batchPreviewStep:not([hidden])');
    const batch = await page.evaluate(() => ({
        promptModules: document.querySelectorAll('.batch-module').length,
        imageVariables: document.querySelectorAll('.batch-image-variable').length,
        modelChoices: document.querySelectorAll('[data-batch-model-id]').length,
        radioGroups: document.querySelectorAll('.batch-uniform-grid ic-radio-group').length,
        previewRows: document.querySelectorAll('#batchTaskRows tr').length,
        invalid: [...document.querySelectorAll('[data-ic-contract-status="invalid"]')].map(node => ({ tag: node.localName, id: node.id, reason: node.dataset.icContractReason })),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        currentStep: document.querySelector('#batchSteps').getAttribute('current'),
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const narrow = await page.evaluate(() => ({
        theme: document.documentElement.dataset.uiTheme,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        width: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
    }));
    await page.click('#batchHistoryButton');
    await page.waitForSelector('[data-open-batch="batch-t27"]');
    const batchHistory = await page.evaluate(() => ({
        rows: document.querySelectorAll('[data-open-batch]').length,
        table: document.querySelectorAll('#batchHistoryStep ic-table.batch-history-table').length,
        columns: [...document.querySelectorAll('.batch-history-table thead th')].map(node => node.textContent.trim()),
        viewportOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        tableScrollable: document.querySelector('.batch-history-table-wrap').scrollWidth
            >= document.querySelector('.batch-history-table-wrap').clientWidth,
        values: {
            prompt: document.querySelector('.batch-history-prompt > span')?.textContent,
            ownerVisible: document.querySelector('#batchHistoryList')?.textContent.includes('batch-browser-designer'),
            generatedAt: document.querySelector('.batch-history-time')?.textContent,
            resolution: document.querySelector('.batch-history-resolution')?.textContent,
            model: document.querySelector('.batch-history-models')?.textContent.trim(),
            ratios: document.querySelector('.batch-history-ratios')?.textContent.trim(),
            images: document.querySelectorAll('.batch-history-images img').length,
            outputs: document.querySelector('.batch-history-output-count')?.textContent.replace(/\s+/g, ' ').trim(),
            status: document.querySelector('.batch-history-status .batch-status')?.textContent,
        },
        invalid: document.querySelectorAll('#batchHistoryStep [data-ic-contract-status="invalid"]').length,
    }));
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (process.env.T27_BATCH_HISTORY_SCREENSHOT) {
        await page.screenshot({ path: process.env.T27_BATCH_HISTORY_SCREENSHOT, fullPage: true });
    }
    await page.goto(`${baseUrl}/static/online.html?token-review-theme=dark`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => customElements.get('ic-file-input'));
    const darkDesktop = await page.evaluate(() => ({
        theme: document.documentElement.dataset.uiTheme,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        invalid: document.querySelectorAll('[data-ic-contract-status="invalid"]').length,
        heading: document.querySelector('.batch-page-header ic-heading')?.textContent.trim(),
        singleSurfaces: document.querySelectorAll('#singleGenerationMode, #singleGenerationHistory, #genBtn, #modelSelect').length,
    }));
    contractErrors.push(...await page.evaluate(() => window.__t27ContractErrors || []));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const darkNarrow = await page.evaluate(() => ({
        theme: document.documentElement.dataset.uiTheme,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        width: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
        invalid: document.querySelectorAll('[data-ic-contract-status="invalid"]').length,
    }));
    await page.evaluate(() => window.StudioI18n.set('en'));
    await page.waitForTimeout(100);
    const englishNarrow = await page.evaluate(() => ({
        language: document.documentElement.lang,
        title: document.title,
        heading: document.querySelector('.batch-page-header ic-heading')?.textContent.trim(),
        concurrencyLabel: document.getElementById('batchConcurrency')?.getAttribute('label'),
        historyTableLabel: document.querySelector('.batch-history-table')?.getAttribute('label'),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        invalid: document.querySelectorAll('[data-ic-contract-status="invalid"]').length,
    }));
    await browser.close();
    if (errors.length || contractErrors.length || pageStructure.invalid.length || batch.invalid.length
        || pageStructure.overflow || batch.overflow || narrow.overflow
        || narrow.theme !== 'light' || darkDesktop.theme !== 'dark' || darkNarrow.theme !== 'dark'
        || darkDesktop.overflow || darkNarrow.overflow || darkDesktop.invalid || darkNarrow.invalid
        || englishNarrow.language !== 'en' || englishNarrow.title !== 'Batch generation'
        || englishNarrow.heading !== 'Batch generation' || englishNarrow.concurrencyLabel !== 'Concurrent tasks'
        || englishNarrow.historyTableLabel !== 'Batch history' || englishNarrow.overflow || englishNarrow.invalid
        || pageStructure.title !== '批量生成' || pageStructure.heading !== '批量生成'
        || !pageStructure.historyButton || !pageStructure.batchVisible
        || pageStructure.modeSwitches || pageStructure.singleSurfaces
        || darkDesktop.heading !== '批量生成' || darkDesktop.singleSurfaces
        || batchHistory.rows !== 1 || batchHistory.table !== 1 || batchHistory.invalid
        || batchHistory.viewportOverflow || !batchHistory.tableScrollable
        || batchHistory.columns.join(',') !== '批次,生成时间,提示词缩略,分辨率,模型,比例,上传图片,生成结果,状态,操作'
        || batchHistory.values.ownerVisible || !batchHistory.values.generatedAt
        || batchHistory.values.prompt !== '红狐站在薄雾森林中，电影光线'
        || batchHistory.values.resolution !== '2K' || !batchHistory.values.model.includes('GPT Image 2')
        || !batchHistory.values.ratios.includes('1:1') || !batchHistory.values.ratios.includes('3:4')
        || batchHistory.values.images !== 1 || batchHistory.values.outputs !== '2'
        || batchHistory.values.status !== '运行中'
        || !batchPayload || !batch.promptModules || !batch.imageVariables || !batch.modelChoices
        || batch.radioGroups !== 5 || batch.previewRows !== 1 || batch.currentStep !== '2'
        || batchPayload.ratios.join(',') !== '1:1'
        || fixedRows.numbers.join(',') !== '04,05' || !fixedRows.tableWidthBounded || !fixedRows.optionColumnFillsRemainder
        || fixedRows.dimensionHeaderWidths[1] !== 128 || fixedRows.dimensionHeaderWidths[3] !== 48 || fixedRows.dimensionHeaderWidths[4] !== 48
        || !fixedRows.modelChoicesBounded || fixedRows.modelColumns !== 3 || fixedRows.modelRowHeight >= 400
        || fixedRows.uncheckedModelBackground !== 'rgba(0, 0, 0, 0)'
        || fixedRows.uncheckedModelColor !== 'rgb(115, 115, 115)' || fixedRows.checkedModelColor !== 'rgb(0, 0, 0)'
        || fixedRows.checkedModelBorder !== '1px solid rgb(231, 231, 231)'
        || fixedRows.uncheckedModelPadding !== '8px'
        || fixedRows.tableCellInlinePadding.some(([left, right]) => left !== '8px' || right !== '8px')
        || fixedRows.checkedModelBackground === 'rgba(0, 0, 0, 0)' || fixedRows.ratioModules !== 2
        || fixedRows.ratioLegendDisplay !== 'none' || fixedRows.ratioMaxButtonsPerRow < 2 || fixedRows.ratioCount !== '1'
        || fixedRows.pageHeadCount !== 0
        || fixedRows.variableActions.join(',') !== '新增提示词变量,新增参考图变量'
        || fixedRows.promptFields !== 2 || fixedRows.legacyPromptContainers
        || fixedRows.parseRowsInsideTextarea !== 2
        || fixedRows.parseLayouts.some(row => row.tag !== 'ic-select' || row.options !== 4
            || row.verticalAlign !== 'center' || row.textAlign !== 'right' || !row.leftRight || row.centerDelta > 2)
        || fixedRows.importMenus !== 3 || fixedRows.importTriggers !== 3
        || fixedRows.importChoices.join(',') !== '选择文件,选择文件夹,选择文件,选择文件夹,添加图片,选择文件夹'
        || fixedRows.importVariants.some(variant => variant !== 'import-menu') || !fixedRows.imageImportRight
        || fixedRows.importPopupRoles.some(role => role !== 'menu')
        || !importInteraction.open || importInteraction.display === 'none'
        || fixedRows.textFileInputs.some(multiple => !multiple) || fixedRows.visibleEmptyFileCounts
        || fixedRows.imageFileNames
        || !fixedRows.countTexts.every(value => /^\d+$/.test(value))
        || fixedRows.countStyles.some(style => style.background !== 'rgba(0, 0, 0, 0)'
            || style.padding !== '0px' || style.border !== 'none')
        || fixedRows.redundantImagePicker !== 0
        || fixedRows.promptFooters.some(footer => !footer.fills || footer.paddingLeft !== '16px'
            || footer.background === 'rgba(0, 0, 0, 0)' || footer.columns !== 2)
        || fixedRows.modelChoice.fontSize !== '12px' || fixedRows.modelChoice.width !== 16 || fixedRows.modelChoice.height !== 16
        || fixedRows.uniformRows.some(row => row.labelWidth !== 56 || row.textAlign !== 'right'
            || row.inputJustify !== 'flex-start' || row.verticalAlign !== 'start' || !row.leftRight
            || row.labelHeight !== row.itemHeight || row.gap !== 12)
        || fixedRows.uniformRows.find(row => row.label === '单次出图') == null
        || fixedRows.uniformRows.find(row => row.label === '重复次数') == null
        || fixedRows.steps.current !== '1' || fixedRows.steps.indicatorWidth !== 28 || fixedRows.steps.indicatorHeight !== 28
        || fixedRows.steps.paddingTop !== '8px' || fixedRows.steps.paddingBottom !== '8px'
        || fixedRows.steps.marginTop !== '0px' || fixedRows.steps.marginBottom !== '0px'
        || fixedRows.tableCaptionCount !== 0 || fixedRows.nativeTableLabel !== '批量生成变量（多选）'
        || fixedRows.sectionTitles.map(title => title.text).join(',') !== '变量（多选）,其他设置（单选）'
        || fixedRows.sectionTitles.some(title => title.fontSize !== '14px' || title.fontWeight !== '400')
        || fixedRows.uniformDescription || !fixedRows.tableHeadersCentered || !fixedRows.tableCellsTopAligned) {
        throw new Error(`Unexpected T27 result: ${JSON.stringify({ errors, contractErrors, batchPayload, pageStructure, batch, importInteraction, fixedRows, narrow, batchHistory, darkDesktop, darkNarrow, englishNarrow }, null, 2)}`);
    }
    process.stdout.write(`${JSON.stringify({ pageStructure, batch, fixedRows, narrow, batchHistory, darkDesktop, darkNarrow, englishNarrow }, null, 2)}\n`);
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
