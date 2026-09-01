const { chromium } = require('playwright');

const baseUrl = process.env.BATCH_GENERATION_BASE_URL || 'http://127.0.0.1:3101';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    let previewPayload = null;
    let historyRequests = 0;
    let batchSubmitAttempts = 0;
    const copiedImageUrls = [];
    let releaseBatchSubmit;
    const batchSubmitGate = new Promise(resolve => { releaseBatchSubmit = resolve; });
    const dismissedDialogs = [];
    const runningBatch = {
        id:'batch-running-1',owner:'designer-1',name:'正在生成的角色探索',status:'running',
        created_at:1700000000,progress:{succeeded:1,running:1,queued:2,total:4},
        tasks:[
            {index:0,status:'succeeded',prompt:'红狐，森林',prompt_references:[{module:'TXT 01',name:'fox.txt',relative_path:'prompts/fox.txt'}],model:'gpt-image-2',ratio:'1:1',reference_images:[{url:'/assets/output/fox.png',name:'fox-reference.png'}],outputs:['/assets/output/fox.png']},
            {index:1,status:'succeeded',prompt:'雪豹，雪山',prompt_references:[{module:'TXT 01',name:'snow.txt',relative_path:'prompts/snow.txt'}],model:'gpt-image-2',ratio:'1:1',reference_images:[{url:'/assets/output/snow.png',name:'snow-reference.png'}],outputs:[{url:'/assets/output/snow.png',name:'snow.png'}]},
            {index:2,status:'running',prompt:'白鹭，湖面',model:'gpt-image-2',ratio:'1:1',outputs:[]},
        ],snapshot:{
            name_prefix:'旧系列',
            prompt_modules:[{name:'TXT 01',options:[
                {value:'红狐，森林',name:'fox.txt',relative_path:'prompts/fox.txt'},
                {value:'雪豹，雪山',name:'snow.txt',relative_path:'prompts/snow.txt'},
            ]}],
            image_variables:[{name:'IMG 01',options:[{url:'/assets/output/fox.png',name:'fox-reference.png',relative_path:'refs/fox-reference.png'}]}],
            models:[{provider_id:'openai',model:'gpt-image-2',name:'GPT Image 2'}],
            ratios:['1:1'],
            settings:{resolution:'2k',quality:'high',outputs_per_submission:2,submissions_per_task:3,desired_concurrency:2},
        },
    };
    page.on('dialog', dialog => {
        dismissedDialogs.push(dialog.message());
        dialog.dismiss();
    });
    await page.route('**/api/config', route => route.fulfill({
        status:200, contentType:'application/json', body:JSON.stringify({
            image_models:['gpt-image-2','nano-banana-pro'],
            api_providers:[
                {id:'openai',name:'OpenAI',enabled:true,image_models:['gpt-image-2']},
                {id:'gemini',name:'Gemini',enabled:true,image_models:['nano-banana-pro']},
            ],
            available_models:{image:[
                {id:'openai-gpt',provider_id:'openai',provider_name:'OpenAI',model:'gpt-image-2',name:'GPT Image 2'},
                {id:'gemini-nano',provider_id:'gemini',provider_name:'Gemini',model:'nano-banana-pro',name:'Nano Banana Pro'},
            ]},
        }),
    }));
    await page.route('**/api/history?*', route => route.fulfill({status:200,contentType:'application/json',body:'[]'}));
    await page.route('**/api/batch-generation/preview', async route => {
        previewPayload = route.request().postDataJSON();
        const promptOptions = previewPayload.prompt_modules[0].options.map(option => (
            typeof option === 'string' ? {value:option} : option
        ));
        const models = previewPayload.models;
        const ratios = previewPayload.ratios;
        const referenceImages = previewPayload.image_variables.map(variable => variable.options[0]).filter(Boolean);
        const outputsPerSubmission = previewPayload.settings.outputs_per_submission;
        const submissionsPerTask = previewPayload.settings.submissions_per_task;
        const tasks = [];
        let index = 0;
        for (const promptOption of promptOptions) for (const model of models) for (const ratio of ratios) {
            tasks.push({
                index:index++, prompt:promptOption.value, model:model.model,
                provider_id:model.provider_id, ratio,
                prompt_references:promptOption.name ? [{
                    module:'TXT 01', name:promptOption.name,
                    relative_path:promptOption.relative_path || promptOption.name,
                }] : [],
                submissions:submissionsPerTask,
                outputs_per_submission:outputsPerSubmission,
                outputs:submissionsPerTask * outputsPerSubmission,
                reference_images:referenceImages,
            });
        }
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
            generation_run_count:tasks.length,
            estimated_submission_count:tasks.length * submissionsPerTask,
            estimated_output_count:tasks.length * submissionsPerTask * outputsPerSubmission,
            tasks,
        })});
    });
    await page.route('**/api/batch-generation/batches', async route => {
        if (route.request().method() === 'POST') {
            batchSubmitAttempts += 1;
            if (batchSubmitAttempts === 1) {
                await batchSubmitGate;
                return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'批次提交暂时失败'})});
            }
            return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(runningBatch)});
        }
        return route.fulfill({status:405,contentType:'application/json',body:JSON.stringify({detail:'Method Not Allowed'})});
    });
    await page.route('**/api/ai/upload', route => route.fulfill({
        status:200, contentType:'application/json', body:JSON.stringify({
            files:[{url:'/assets/input/reference.png',name:'reference.png'}],
        }),
    }));
    await page.route('**/api/download-output?*', route => {
        copiedImageUrls.push(new URL(route.request().url()).searchParams.get('url'));
        return route.fulfill({
            status:200,
            contentType:'image/png',
            body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
        });
    });
    await page.route('**/api/batch-generation/batches/batch-running-1', route => route.fulfill({
        status:200, contentType:'application/json', body:JSON.stringify(runningBatch),
    }));
    await page.route('**/api/batch-generation/history', route => {
        historyRequests += 1;
        if (route.request().method() !== 'GET') {
            return route.fulfill({status:405,contentType:'application/json',body:JSON.stringify({detail:'Method Not Allowed'})});
        }
        if (historyRequests === 1) {
            return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'暂时无法读取批次历史'})});
        }
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({batches:[runningBatch]})});
    });

    if (process.env.BATCH_GENERATION_SKIP_LOGIN !== '1') {
        const login = await page.request.post(`${baseUrl}/api/auth/login`, {data:{
            username:'batch-browser-designer', password:'batch-browser-password',
        }});
        if (!login.ok()) throw new Error(`Batch browser login failed: ${login.status()}`);
    }
    await page.goto(`${baseUrl}/static/online.html`, {waitUntil:'networkidle'});
    await page.evaluate(() => {
        window.__batchCopiedPrompt = '';
        window.__batchCopiedImageItems = [];
        window.ClipboardItem = class ClipboardItem {
            constructor(data) { this.data = data; }
        };
        Object.defineProperty(navigator, 'clipboard', {
            configurable:true,
            value:{
                writeText:async text => { window.__batchCopiedPrompt = text; },
                write:async items => {
                    window.__batchCopiedImageItems = await Promise.all(items.map(async item => {
                        const blob = await item.data['image/png'];
                        return {type:blob.type, size:blob.size};
                    }));
                },
            },
        });
    });
    await page.waitForSelector('#batchGenerationMode:not([hidden])');
    await page.waitForSelector('.batch-image-variable');
    const visibility = await page.evaluate(() => ({
        singleSurfaces:document.querySelectorAll('#singleGenerationMode, #singleGenerationHistory, #singleModeTab, #batchModeTab').length,
        batch:getComputedStyle(document.querySelector('#batchGenerationMode')).display,
    }));
    if (visibility.singleSurfaces || visibility.batch === 'none') {
        throw new Error(`Batch-only page structure is incorrect: ${JSON.stringify(visibility)}`);
    }
    if (await page.locator('#batchModels, #batchRatios').count()) {
        throw new Error('Model and ratio must not be free-text inputs');
    }
    const setupStructure = await page.evaluate(() => ({
        redundantTitle:[...document.querySelectorAll('#batchGenerationMode h2')]
            .some(item => item.textContent.trim() === '批量生成图片'),
        historyInPageHeader:document.querySelector('.batch-page-header > #batchHistoryButton') !== null,
        promptIdentity:document.querySelector('.batch-module-identity')?.textContent.replace(/\s+/g, ''),
        legacyPromptControls:document.querySelectorAll('.batch-grip, .batch-module-name').length,
        sourceTabs:document.querySelectorAll('.batch-source-tabs').length,
        fileActionsInEditor:document.querySelector('.batch-text-editor > .batch-parse-row .batch-file-actions') !== null,
        fileActionLabels:[...document.querySelectorAll('.batch-file-actions button')]
            .map(button => button.textContent.trim()),
        parseInsideInput:document.querySelector('.batch-text-editor > .batch-parse-row') !== null,
        rawParseLabel:document.querySelector('.batch-parse-mode option[value="raw"]')?.textContent.trim(),
        settingsBlocks:document.querySelectorAll('.batch-settings-block').length,
        uniformSelects:document.querySelectorAll('.batch-uniform-grid select').length,
        uniformChoices:document.querySelectorAll('.batch-uniform-grid input[type="radio"]').length,
        concurrencyValue:document.querySelector('#batchConcurrency input:checked')?.value,
        concurrencyOptions:[...document.querySelectorAll('#batchConcurrency input')]
            .map(option => option.value),
        variableActions:[...document.querySelectorAll('#addPromptModule, #addImageVariable')]
            .map(button => ({text:button.textContent.replace(/\s+/g, ' ').trim(), primary:button.classList.contains('batch-add-module')})),
        stickyCounts:document.querySelector('.batch-submit-bar #batchRunCount') !== null,
        submitPortal:document.querySelector('html > #batchSubmitLayer > .batch-submit-bar') !== null,
        submitPosition:getComputedStyle(document.querySelector('.batch-submit-bar')).position,
        submitViewportGap:Math.round(innerHeight-document.querySelector('.batch-submit-bar').getBoundingClientRect().bottom),
        submitRect:(() => {
            const rect=document.querySelector('.batch-submit-bar').getBoundingClientRect();
            return {top:Math.round(rect.top),bottom:Math.round(rect.bottom),height:Math.round(rect.height),scrollY:Math.round(scrollY)};
        })(),
        fixedContainingAncestors:(() => {
            const matches=[];
            for(let node=document.querySelector('.batch-submit-bar').parentElement;node;node=node.parentElement){
                const style=getComputedStyle(node);
                if(style.transform !== 'none' || style.filter !== 'none' || style.perspective !== 'none'
                    || style.contain !== 'none' || style.willChange !== 'auto') {
                    matches.push({tag:node.tagName,id:node.id,className:node.className,transform:style.transform,
                        filter:style.filter,perspective:style.perspective,contain:style.contain,willChange:style.willChange});
                }
            }
            return matches;
        })(),
        inlineBatchName:document.querySelector('.batch-name-field > span') === null
            && document.querySelector('#batchName')?.placeholder === '任务名称（可选）',
        headingDivider:getComputedStyle(document.querySelector('.batch-section-heading')).borderBottomWidth,
    }));
    if (setupStructure.redundantTitle || !setupStructure.historyInPageHeader
        || setupStructure.promptIdentity !== 'TXT01' || setupStructure.legacyPromptControls
        || setupStructure.sourceTabs || !setupStructure.fileActionsInEditor
        || JSON.stringify(setupStructure.fileActionLabels) !== JSON.stringify(['选择文件','选择文件夹'])
        || !setupStructure.parseInsideInput
        || setupStructure.rawParseLabel !== '不做处理（整段使用）'
        || setupStructure.settingsBlocks !== 2 || setupStructure.uniformSelects
        || setupStructure.uniformChoices !== 22
        || setupStructure.concurrencyValue !== '16'
        || !setupStructure.concurrencyOptions.includes('32')
        || JSON.stringify(setupStructure.variableActions) !== JSON.stringify([
            {text:'＋ 提示词变量', primary:true},
            {text:'＋ 图片变量', primary:true},
        ]) || !setupStructure.stickyCounts || !setupStructure.submitPortal
        || setupStructure.submitPosition !== 'fixed' || setupStructure.submitViewportGap < 0
        || setupStructure.submitViewportGap > 24 || !setupStructure.inlineBatchName
        || setupStructure.headingDivider !== '0px') {
        throw new Error(`Batch setup hierarchy is incorrect: ${JSON.stringify(setupStructure)}`);
    }
    await page.click('#addPromptModule');
    const moduleNumbers = await page.locator('.batch-module-index').allTextContents();
    if (moduleNumbers.join(',') !== '01,02') throw new Error(`Unexpected module numbers: ${moduleNumbers}`);
    await page.locator('.batch-remove-module').nth(1).click();
    if (await page.locator('.batch-module-index').textContent() !== '01') {
        throw new Error('Prompt modules must renumber after deletion');
    }
    await page.selectOption('.batch-parse-mode', 'raw');
    await page.fill('.batch-module-options', '完整主体提示词\n保留内部换行');
    if (await page.locator('.batch-option-count').textContent() !== '1 个选项') {
        throw new Error('Raw prompt recognition must keep the whole text as one option');
    }
    await page.selectOption('.batch-parse-mode', 'lines');
    const imageVariableStructure = await page.evaluate(() => ({
        identity:document.querySelector('.batch-image-variable .batch-module-identity')
            ?.textContent.replace(/\s+/g, ''),
        legacyName:document.querySelectorAll('.batch-image-variable-name').length,
        singlePicker:document.querySelectorAll('.batch-pick-single-image').length,
        pickerAllowsMultiple:document.querySelector('.batch-image-files')?.multiple,
        importMenu:document.querySelectorAll('.batch-image-import-menu').length,
        importVariant:document.querySelector('.batch-image-import-menu .batch-import-trigger')
            ?.dataset.buttonVariant,
        importIsRightAction:document.querySelector('.batch-image-cell > .batch-image-actions:last-child') !== null,
    }));
    if (imageVariableStructure.identity !== 'IMG01' || imageVariableStructure.legacyName
        || imageVariableStructure.singlePicker !== 0 || !imageVariableStructure.pickerAllowsMultiple
        || imageVariableStructure.importMenu !== 1
        || imageVariableStructure.importVariant !== 'import-menu'
        || !imageVariableStructure.importIsRightAction) {
        throw new Error(`Image variable hierarchy is incorrect: ${JSON.stringify(imageVariableStructure)}`);
    }
    const emptyImagePreviewRequest = page.waitForRequest(request => (
        request.url().endsWith('/api/batch-generation/preview')
        && request.method() === 'POST'
    ));
    await page.locator('.batch-module-options').dispatchEvent('input');
    const emptyImagePayload = (await emptyImagePreviewRequest).postDataJSON();
    if (emptyImagePayload.image_variables?.length !== 1
        || emptyImagePayload.image_variables[0].options?.length !== 0) {
        throw new Error(`Empty default image variable must count as zero: ${JSON.stringify(emptyImagePayload)}`);
    }
    await page.locator('.batch-image-files input[type="file"]').setInputFiles({
        name:'reference.png',
        mimeType:'image/png',
        buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    });
    await page.locator('.batch-image-option ic-image-frame').evaluate(frame => {
        frame.shadowRoot.querySelector('[data-preview]').click();
    });
    await page.waitForFunction(() => document.querySelector('#batchImageEditModal')?.open === true);
    const referencePreview = {
        src:await page.locator('#batchImageEditImage').getAttribute('src'),
        counter:await page.locator('#batchImageCounter').textContent(),
        previousHidden:await page.locator('#batchImagePrevious').isHidden(),
        nextHidden:await page.locator('#batchImageNext').isHidden(),
    };
    if (!referencePreview.src.startsWith('blob:') || referencePreview.counter !== '1 / 1'
        || !referencePreview.previousHidden || !referencePreview.nextHidden) {
        throw new Error(`Image-variable preview did not open correctly: ${JSON.stringify(referencePreview)}`);
    }
    await page.click('#closeBatchImageEdit');
    await page.waitForFunction(() => document.querySelector('#batchImageEditModal')?.open === false);
    await page.waitForSelector('[data-batch-model-id="openai-gpt"]');
    await page.check('[data-batch-model-id="gemini-nano"]');
    await page.check('[data-batch-ratio="16:9"]');
    await page.check('#batchOutputsPerRun input[value="2"]');
    await page.check('#batchSubmissionsPerTask input[value="3"]');
    await page.locator('.batch-text-files').setInputFiles([
        {name:'fox.txt',mimeType:'text/plain',buffer:Buffer.from('红狐，森林')},
        {name:'snow.txt',mimeType:'text/plain',buffer:Buffer.from('雪豹，雪山')},
    ]);
    await page.fill('#batchName', '角色系列_');
    await page.waitForTimeout(180);
    const cachedSetup = await page.evaluate(() => JSON.parse(
        localStorage.getItem('studio_batch_generation_config_v1') || 'null'
    ));
    if (cachedSetup?.name_prefix !== '角色系列'
        || cachedSetup.prompt_modules?.[0]?.options?.[0]?.name !== 'fox.txt'
        || cachedSetup.prompt_modules?.[0]?.options?.[1]?.name !== 'snow.txt'
        || cachedSetup.settings?.outputs_per_submission !== 2
        || cachedSetup.settings?.submissions_per_task !== 3
        || cachedSetup.models?.length !== 2 || cachedSetup.ratios?.length !== 2) {
        throw new Error(`Batch setup was not cached: ${JSON.stringify(cachedSetup)}`);
    }
    await page.click('#previewBatch');
    await page.waitForSelector('#batchPreviewStep:not([hidden])');

    if (!previewPayload
        || previewPayload.models.length !== 2
        || !previewPayload.models.every(model => model.provider_id && model.model)
        || previewPayload.ratios.length !== 2
        || previewPayload.prompt_modules[0].options.length !== 2
        || previewPayload.prompt_modules[0].options[0].name !== 'fox.txt'
        || previewPayload.prompt_modules[0].options[1].name !== 'snow.txt'
        || previewPayload.name !== ''
        || previewPayload.name_prefix !== '角色系列'
        || previewPayload.settings.outputs_per_submission !== 2
        || previewPayload.settings.submissions_per_task !== 3
        || previewPayload.settings.desired_concurrency !== 2) {
        throw new Error(`Unexpected selection payload: ${JSON.stringify(previewPayload)}`);
    }
    const previewCounts = {
        runs:await page.locator('#batchSelectedRunCount').textContent(),
        submissions:await page.locator('#batchSelectedSubmissionCount').textContent(),
        outputs:await page.locator('#batchSelectedOutputCount').textContent(),
    };
    if (previewCounts.runs !== '8'
        || previewCounts.submissions !== '24'
        || previewCounts.outputs !== '48') {
        throw new Error(`Unexpected preview counts: ${JSON.stringify(previewCounts)}`);
    }
    if (await page.locator('#batchSteps[current="2"]').count() !== 1
        || await page.locator('#batchSteps [data-step="3"]').count() !== 1
        || await page.locator('.batch-image-section').count() !== 1) {
        throw new Error('Wireframe hierarchy is incomplete');
    }
    const previewTable = {
        headers:await page.locator('#batchPreviewStep .batch-task-table th').allTextContents(),
        firstNumber:await page.locator('#batchTaskRows tr').first().locator('td').nth(1).textContent(),
        referenceImages:await page.locator('#batchTaskRows .batch-task-reference-images img').count(),
    };
    if (previewTable.headers[1] !== '#' || previewTable.headers[2] !== '上传图片'
        || previewTable.firstNumber.trim() !== '1' || previewTable.referenceImages !== 8) {
        throw new Error(`Batch preview must show task numbers and uploaded images: ${JSON.stringify(previewTable)}`);
    }
    const taskCheckboxes = page.locator('[data-task-index]');
    const taskCount = await taskCheckboxes.count();
    for (let index = 0; index < taskCount; index += 1) await taskCheckboxes.nth(index).uncheck();
    const emptySelection = {
        selected:await page.locator('#batchSelectedRunCount').textContent(),
        excluded:await page.locator('#batchExcludedCount').textContent(),
        outputs:await page.locator('#batchSelectedOutputCount').textContent(),
        disabled:await page.locator('#startBatch').isDisabled(),
    };
    if (emptySelection.selected !== '0' || emptySelection.excluded !== String(taskCount)
        || emptySelection.outputs !== '0' || !emptySelection.disabled) {
        throw new Error(`Empty preview selection is unsafe: ${JSON.stringify(emptySelection)}`);
    }
    for (let index = 0; index < taskCount; index += 1) await taskCheckboxes.nth(index).check();
    await page.click('#startBatch');
    await page.waitForFunction(
        () => document.querySelector('#startBatch')?.getAttribute('aria-busy') === 'true',
        null, {timeout:2000},
    );
    const submittingState = {
        text:(await page.locator('#startBatch').textContent()).trim(),
        disabled:await page.locator('#startBatch').isDisabled(),
    };
    if (submittingState.text !== '正在提交中' || !submittingState.disabled) {
        throw new Error(`Batch submit button does not expose progress: ${JSON.stringify(submittingState)}`);
    }
    if (process.env.BATCH_GENERATION_SUBMIT_SCREENSHOT) {
        await page.screenshot({path:process.env.BATCH_GENERATION_SUBMIT_SCREENSHOT});
    }
    releaseBatchSubmit();
    await page.waitForFunction(() => document.querySelector('#startBatch')?.getAttribute('aria-busy') === 'false');
    const recoveredSubmitState = {
        text:(await page.locator('#startBatch').textContent()).trim(),
        disabled:await page.locator('#startBatch').isDisabled(),
        errorSeen:dismissedDialogs.includes('批次提交暂时失败'),
    };
    if (recoveredSubmitState.text !== '确认提交任务'
        || recoveredSubmitState.disabled || !recoveredSubmitState.errorSeen) {
        throw new Error(`Batch submit button did not recover after failure: ${JSON.stringify(recoveredSubmitState)}`);
    }
    await page.click('#startBatch');
    await page.waitForSelector('#batchDetailStep:not([hidden])');
    if (await page.locator('#batchSteps[current="3"]').count() !== 1) {
        throw new Error('Batch detail must be represented as the third flow step');
    }
    await page.click('#cancelBatch');
    if (!dismissedDialogs.some(message => message.includes('尚未开始的任务将不再生成'))) {
        throw new Error(`Cancel action must require confirmation: ${JSON.stringify(dismissedDialogs)}`);
    }
    await page.waitForSelector('#batchDetailStep:not([hidden])');
    if (await page.locator('#batchSetupStep:not([hidden])').count()) {
        throw new Error('Batch cancellation must preserve the active batch detail UI');
    }
    const detailHeader = await page.evaluate(() => ({
        kicker:document.querySelectorAll('#batchDetailStep .batch-kicker').length,
        backText:document.querySelector('#backToBatchHistoryFromDetail')?.textContent.trim(),
        reuseText:document.querySelector('#createBatchFromCurrent')?.textContent.trim(),
        reuseHierarchy:document.querySelector('#createBatchFromCurrent')?.getAttribute('hierarchy'),
        rerunHierarchy:document.querySelector('#rerunBatch')?.getAttribute('hierarchy'),
        status:document.querySelector('#batchDetailStatus .batch-status')?.textContent.trim(),
        startedAt:document.querySelector('#batchDetailStartedAt')?.textContent.trim(),
        settingsTab:document.querySelectorAll('[data-detail-tab="settings"]').length,
    }));
    if (detailHeader.kicker !== 0 || detailHeader.backText !== '返回批次历史'
        || detailHeader.reuseText !== '复用配置'
        || detailHeader.reuseHierarchy !== 'quiet' || detailHeader.rerunHierarchy !== 'quiet'
        || detailHeader.status !== '运行中' || !detailHeader.startedAt
        || detailHeader.settingsTab !== 0) {
        throw new Error(`Batch detail header and merged navigation are incorrect: ${JSON.stringify(detailHeader)}`);
    }
    if (await page.locator('.batch-output-location').count()) {
        throw new Error('Batch detail must not show the output storage message');
    }
    const batchOutputImages = page.locator('[data-batch-output-index] img');
    if (await batchOutputImages.count() !== 2) {
        throw new Error('Completed batch outputs must render as previewable gallery images');
    }
    const galleryDownload = page.locator('[data-batch-output-index] ic-button[download]').first();
    const galleryDownloadPresentation = await galleryDownload.evaluate(button => ({
        size:button.getAttribute('size'),
        hierarchy:button.getAttribute('hierarchy'),
        combination:button.getAttribute('data-legal-combination'),
    }));
    if (galleryDownloadPresentation.size !== 'small'
        || galleryDownloadPresentation.hierarchy !== 'secondary'
        || galleryDownloadPresentation.combination !== 'secondary-action') {
        throw new Error(`Batch output download action has the wrong presentation: ${JSON.stringify(galleryDownloadPresentation)}`);
    }
    await page.click('[data-detail-tab="tasks"]');
    if (await page.locator('#batchDetailTaskRows .batch-task-reference-images img').count() !== 2) {
        throw new Error('Batch task rows must show uploaded reference thumbnails');
    }
    const mergedTaskSettings = await page.evaluate(() => ({
        historyTable:document.querySelector('#batchTasksPanel .batch-history-table') !== null,
        columns:[...document.querySelectorAll('#batchTasksPanel thead th')].map(item => item.textContent.trim()),
        resolution:document.querySelector('#batchDetailTaskRows .batch-history-resolution')?.textContent.trim(),
        model:document.querySelector('#batchDetailTaskRows .batch-model-display')?.textContent.trim(),
        ratio:document.querySelector('#batchDetailTaskRows .batch-history-ratios')?.textContent.trim(),
        status:document.querySelector('#batchDetailTaskRows .batch-status')?.textContent.trim(),
        legacySettingsPanel:document.querySelectorAll('#batchSettingsPanel').length,
    }));
    if (!mergedTaskSettings.historyTable
        || mergedTaskSettings.columns.join(',') !== '任务,提示词缩略,分辨率,模型,比例,上传图片,提交,生成结果,状态,错误'
        || mergedTaskSettings.resolution !== '2K' || !mergedTaskSettings.model.includes('GPT Image 2')
        || mergedTaskSettings.ratio !== '1:1' || mergedTaskSettings.status !== '成功'
        || mergedTaskSettings.legacySettingsPanel !== 0) {
        throw new Error(`Task list and settings were not merged: ${JSON.stringify(mergedTaskSettings)}`);
    }
    await page.click('[data-detail-tab="gallery"]');
    await batchOutputImages.nth(0).dblclick();
    await page.waitForSelector('#batchImageEditModal.open .image-edit-panel');
    const initialBatchPreview = {
        counter:await page.locator('#batchImageCounter').textContent(),
        src:await page.locator('#batchImageEditImage').getAttribute('src'),
        download:await page.locator('#batchImageDownload').getAttribute('href'),
        copyButton:await page.locator('#batchImageCopyPrompt').count(),
        references:await page.locator('#batchImageReferenceList li').allTextContents(),
    };
    if (initialBatchPreview.counter !== '1 / 2'
        || initialBatchPreview.src !== '/assets/output/fox.png'
        || !initialBatchPreview.download.includes('/api/download-output?')
        || initialBatchPreview.copyButton !== 1
        || !initialBatchPreview.references.some(value => value.includes('prompts/fox.txt'))
        || !initialBatchPreview.references.some(value => value.includes('fox-reference.png'))) {
        throw new Error(`Unexpected initial batch preview: ${JSON.stringify(initialBatchPreview)}`);
    }
    await page.click('#batchImageCopyPrompt');
    const copiedPrompt = await page.evaluate(() => window.__batchCopiedPrompt);
    if (copiedPrompt !== '红狐，森林') {
        throw new Error(`Batch image prompt copy used the wrong text: ${JSON.stringify(copiedPrompt)}`);
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setPageScaleFactor', {pageScaleFactor:2});
    await page.waitForTimeout(50);
    const modalViewport = await page.evaluate(() => {
        const modal = document.querySelector('#batchImageEditModal');
        const panel = modal.querySelector('.batch-image-edit-panel');
        const viewport = window.visualViewport;
        const modalRect = modal.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        return {
            visualTop:Math.round(viewport.offsetTop),
            visualHeight:Math.round(viewport.height),
            modalTop:Math.round(modalRect.top),
            modalHeight:Math.round(modalRect.height),
            panelBottom:Math.round(panelRect.bottom),
            overflowY:getComputedStyle(modal).overflowY,
        };
    });
    if (modalViewport.modalTop !== modalViewport.visualTop
        || modalViewport.modalHeight > modalViewport.visualHeight + 1
        || modalViewport.panelBottom > modalViewport.visualTop + modalViewport.visualHeight + 1
        || modalViewport.overflowY !== 'hidden') {
        throw new Error(`Batch image modal must fit the visual viewport: ${JSON.stringify(modalViewport)}`);
    }
    await cdp.send('Emulation.setPageScaleFactor', {pageScaleFactor:1});
    if (process.env.BATCH_GENERATION_MODAL_SCREENSHOT) {
        await page.screenshot({path:process.env.BATCH_GENERATION_MODAL_SCREENSHOT});
    }
    await page.click('#batchImageNext');
    if (await page.locator('#batchImageEditImage').getAttribute('src') !== '/assets/output/snow.png'
        || await page.locator('#batchImageCounter').textContent() !== '2 / 2'
        || !(await page.locator('#batchImageReferenceList').textContent()).includes('prompts/snow.txt')
        || !(await page.locator('#batchImageReferenceList').textContent()).includes('snow-reference.png')) {
        throw new Error('Batch image panel must navigate to the next output');
    }
    await page.click('#batchImageEditStage', {button:'right'});
    await page.waitForSelector('#batchImageContextMenu:not([hidden])');
    const contextMenuState = await page.evaluate(() => {
        const modal = document.querySelector('#batchImageEditModal').getBoundingClientRect();
        const menu = document.querySelector('#batchImageContextMenu').getBoundingClientRect();
        return {
            label:document.querySelector('#batchImageCopyImage').textContent.trim(),
            inside:menu.left >= modal.left && menu.top >= modal.top
                && menu.right <= modal.right && menu.bottom <= modal.bottom,
        };
    });
    if (contextMenuState.label !== '复制图片' || !contextMenuState.inside) {
        throw new Error('Batch image context menu must expose a copy-image action');
    }
    await page.click('#batchImageCopyImage');
    await page.waitForFunction(() => window.__batchCopiedImageItems.length === 1);
    const copiedImageItems = await page.evaluate(() => window.__batchCopiedImageItems);
    if (copiedImageUrls.at(-1) !== '/assets/output/snow.png'
        || copiedImageItems[0]?.type !== 'image/png'
        || copiedImageItems[0]?.size < 1) {
        throw new Error(`Batch image copy used the wrong output: ${JSON.stringify({copiedImageUrls, copiedImageItems})}`);
    }
    await page.click('#batchImagePrevious');
    if (await page.locator('#batchImageEditImage').getAttribute('src') !== '/assets/output/fox.png') {
        throw new Error('Batch image panel must navigate to the previous output');
    }
    await page.click('#closeBatchImageEdit');
    await page.waitForFunction(() => !document.querySelector('#batchImageEditModal').classList.contains('open'));
    await page.click('#batchHistoryButton');
    await page.waitForTimeout(50);
    if (await page.locator('#batchDetailStep:not([hidden])').count() !== 1) {
        throw new Error('A failed history request must not hide the active batch detail');
    }
    await page.click('#batchHistoryButton');
    await page.waitForSelector('#batchHistoryStep:not([hidden])');
    await page.waitForSelector('[data-open-batch="batch-running-1"]');
    const historyState = {
        rows:await page.locator('[data-open-batch="batch-running-1"]').count(),
        setupVisible:await page.locator('#batchSetupStep:not([hidden])').count(),
        columns:await page.locator('.batch-history-table thead th').allTextContents(),
        ownerVisible:await page.locator('#batchHistoryList').getByText('designer-1', {exact:true}).count(),
        generatedAt:await page.locator('#batchHistoryList .batch-history-time').textContent(),
        prompt:await page.locator('#batchHistoryList .batch-history-prompt > span').textContent(),
        resolution:await page.locator('#batchHistoryList .batch-history-resolution').textContent(),
        model:await page.locator('#batchHistoryList .batch-history-models').textContent(),
        ratio:await page.locator('#batchHistoryList .batch-history-ratios').textContent(),
        inputImages:await page.locator('#batchHistoryList .batch-history-images img').count(),
        outputs:await page.locator('#batchHistoryList .batch-history-output-count').textContent(),
        status:await page.locator('#batchHistoryList .batch-history-status .batch-status').textContent(),
        historyRequests,
    };
    if (historyState.rows !== 1 || historyState.setupVisible !== 0
        || historyState.columns.map(value => value.trim()).join(',') !== '批次,生成时间,提示词缩略,分辨率,模型,比例,上传图片,生成结果,状态,操作'
        || historyState.ownerVisible !== 0 || !historyState.generatedAt
        || historyState.prompt !== '红狐，森林' || historyState.resolution !== '2K'
        || !historyState.model.includes('GPT Image 2') || !historyState.ratio.includes('1:1')
        || historyState.inputImages !== 1 || historyState.outputs.trim() !== '2'
        || historyState.status !== '运行中' || historyState.historyRequests !== 2) {
        throw new Error(`Batch history is not an independent view: ${JSON.stringify(historyState)}`);
    }
    await page.click('#closeBatchHistory');
    await page.waitForSelector('#batchDetailStep:not([hidden])');
    if (await page.locator('#batchSteps[current="3"]').count() !== 1) {
        throw new Error('Closing history must restore the previous flow position');
    }
    await page.click('#batchHistoryButton');
    await page.waitForSelector('#batchHistoryStep:not([hidden])');
    await page.click('[data-open-batch="batch-running-1"]');
    await page.waitForSelector('#batchDetailStep:not([hidden])');
    await page.click('#createBatchFromCurrent');
    await page.waitForSelector('#batchSetupStep:not([hidden])');
    const clonedSetup = {
        prefix:await page.locator('#batchName').inputValue(),
        prompts:await page.locator('.batch-module-options').inputValue(),
        existingImages:await page.locator('.batch-image-option').count(),
        modelChecked:await page.locator('[data-batch-model-id="openai-gpt"]').isChecked(),
        ratioChecked:await page.locator('[data-batch-ratio="1:1"]').isChecked(),
        resolution:await page.locator('#batchResolution input:checked').inputValue(),
        quality:await page.locator('#batchQuality input:checked').inputValue(),
    };
    if (clonedSetup.prefix !== ''
        || !clonedSetup.prompts.includes('红狐，森林') || clonedSetup.existingImages !== 1
        || !clonedSetup.modelChecked || !clonedSetup.ratioChecked
        || clonedSetup.resolution !== '2k' || clonedSetup.quality !== 'high') {
        throw new Error(`Reused batch setup is incomplete: ${JSON.stringify(clonedSetup)}`);
    }
    await page.fill('#batchName', '新系列');
    await page.click('#previewBatch');
    await page.waitForSelector('#batchPreviewStep:not([hidden])');
    if (previewPayload.name !== '' || previewPayload.name_prefix !== '新系列') {
        throw new Error(`Reused setup must derive a fresh name from its current configuration: ${JSON.stringify(previewPayload)}`);
    }
    runningBatch.name = '正在生成的角色探索 · 副本';
    await page.click('#batchHistoryButton');
    await page.waitForSelector('#batchHistoryStep:not([hidden])');
    await page.click('[data-open-batch="batch-running-1"]');
    await page.waitForSelector('#batchDetailStep:not([hidden])');
    await page.click('#createBatchFromCurrent');
    await page.waitForSelector('#batchSetupStep:not([hidden])');
    if (await page.locator('#batchName').inputValue() !== '') {
        throw new Error('Copy setup must keep the batch-name input available for an optional prefix');
    }
    await page.click('#previewBatch');
    await page.waitForSelector('#batchPreviewStep:not([hidden])');
    if (previewPayload.name !== '' || previewPayload.name_prefix !== '') {
        throw new Error('Reused setup must not carry over or increment the previous batch name');
    }
    await page.click('#batchHistoryButton');
    await page.waitForSelector('#batchHistoryStep:not([hidden])');
    await page.click('[data-open-batch="batch-running-1"]');
    await page.waitForSelector('#batchDetailStep:not([hidden])');
    await page.click('#backToBatchHistoryFromDetail');
    await page.waitForSelector('#batchHistoryStep:not([hidden])');
    if (await page.locator('#batchDetailStep:not([hidden])').count()) {
        throw new Error('Return to batch history must leave the detail view');
    }
    if (process.env.BATCH_GENERATION_SCREENSHOT) {
        await page.screenshot({path:process.env.BATCH_GENERATION_SCREENSHOT, fullPage:true});
    }
    await browser.close();
    process.stdout.write(JSON.stringify({ok:true,visibility,previewPayload}, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
