const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {server} = require('./image_repair_browser_fixture.cjs');

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({headless:true, executablePath:process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
        const page = await browser.newPage({viewport:{width:1440,height:960}});
        const errors = [];
        const submissions = [];
        let qualityEditable = true;
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/api/model-capabilities?**', async route => {
            const capability = await (await route.fetch()).json();
            capability.parameters.quality = {
                type:'enum',values:capability.model_id === 'gpt-image-2' ? ['auto','high'] : ['auto','high','xhigh','max'],
                default:'auto',visible:qualityEditable,editable:qualityEditable
            };
            capability.parameters.aspect_ratio.values.push('4:5','3:4');
            capability.media_contract.aspect_ratios.push('4:5','3:4');
            await route.fulfill({json:capability});
        });
        await page.route('**/api/canvas-image-tasks', async route => {
            submissions.push(route.request().postDataJSON());
            await route.fulfill({json:{task_id:'laz135-fixture',status:'queued'}});
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/static/smart-canvas.html?id=image-repair-browser&manual=1`);
        await page.waitForSelector('#fixture-open');
        await page.evaluate(async () => {
            const source = {
                id:'laz135-source',type:'smart-image',x:100,y:100,images:[{url:'/assets/source.png',width:1000,height:800}],
                generationInputSnapshot:{prompt:'test',refs:[],settings:{
                    engine:'api',apiKind:'image',provider_id:'apimart',model:'gpt-image-2.5-suburst',
                    quality:'xhigh',ratio:'square',resolution:'1k',count:1
                }}
            };
            nodes.push(source);
            continueEditingSmartNode(source);
            await loadSmartImageCapabilityForCurrentSettings({});
            setDynamicSetting('modelChoice', smartModelCatalog('image').find(item => item.model === 'gpt-image-2').id);
            await loadSmartImageCapabilityForCurrentSettings({});
            renderDynamicParams();
        });
        const picker = page.locator('#dynamicParams ic-generation-settings-picker');
        assert.equal(await picker.getAttribute('quality'), 'xhigh');
        await picker.locator('[part="trigger"]').click();
        assert.equal(await picker.evaluate(element => element.open), true);
        const rejected = await page.evaluate(async () => {
            const before = nodes.length;
            try {
                await generationRun.run({nodeId:activeComposerNode().id});
                return {rejected:false};
            } catch (error) {
                return {rejected:true,message:error.message,before,after:nodes.length};
            }
        });
        assert.equal(rejected.rejected, true);
        assert.equal(rejected.before, rejected.after);
        assert.equal(submissions.length, 0);
        assert.ok(!rejected.message.includes('smart.capabilityField.quality'));
        await picker.locator('[data-quality="auto"]').click();
        assert.equal(await page.evaluate(() => settings.quality), 'auto');
        assert.equal(await page.evaluate(() => activeComposerNode().runSettings.quality), 'auto');
        if(await picker.evaluate(element => element.open)) await picker.locator('[part="trigger"]').click();
        await page.waitForFunction(() => document.querySelector('#dynamicParams ic-generation-settings-picker')?.dataset.motionState !== 'exiting');
        qualityEditable = false;
        await page.evaluate(async () => {
            window.SmartCanvasModules.modelCapabilities.invalidate();
            window.SmartCanvasModules.imageCapabilities.invalidate();
            await loadSmartImageCapabilityForCurrentSettings({});
            settings.quality = 'xhigh';
            renderDynamicParams();
        });
        await page.waitForFunction(() => document.querySelector('#dynamicParams ic-generation-settings-picker')?.getAttribute('qualities') === 'auto');
        await picker.locator('[part="trigger"]').click();
        assert.equal(await picker.locator('[data-quality]').count(), 1, JSON.stringify(await page.evaluate(() => ({
            contract:smartCurrentImageCapability('').model_capability?.parameters?.quality,
            picker:document.querySelector('#dynamicParams ic-generation-settings-picker')?.outerHTML
        }))));
        await picker.locator('[data-quality="auto"]').click();
        if(await picker.evaluate(element => element.open)) await picker.locator('[part="trigger"]').click();
        await page.waitForFunction(() => document.querySelector('#dynamicParams ic-generation-settings-picker')?.hasAttribute('hide-quality'));
        assert.equal(await picker.getAttribute('hide-quality'), '');
        for (const language of ['en', 'zh']) {
            const message = await page.evaluate(language => {
                window.StudioI18n.set(language);
                return window.SmartCanvasModules.modelCapabilities.validationMessage({
                    valid:false,errors:[{code:'parameter_value',field:'quality'}]
                });
            }, language);
            assert.ok(message.includes(language === 'en' ? 'quality' : '质量'), message);
        }
        const processor = await page.evaluate(async () => {
            Object.assign(settings,{quality:'xhigh',outputFormat:'gif',pixelWidth:800,pixelHeight:600});
            const model = {provider_id:'apimart',model:'gpt-image-2'};
            const plan = await aiProcessorImagePlan(model,{width:2000,height:2500});
            const overrides = aiProcessorRunSettings(model,plan);
            const run = window.SmartCanvasModules.generationSettings.forRun({node:{id:'padded'},overrides});
            const payload = await window.SmartCanvasModules.generationProvider.prepareApiImage(
                'test',[{url:'/assets/source.png',kind:'image',natural_w:plan.inputWidth,natural_h:plan.inputHeight}],run.settings
            );
            const [width,height] = payload.size.split('x').map(Number);
            if(Math.abs(width / height - 4 / 5) > 0.02) throw new Error(`Incorrect 4:5 size: ${payload.size}`);
            return {operation:plan.capability.model_capability.operation,ratio:payload.target_aspect_ratio,quality:payload.quality,format:payload.output_format,sizeMode:payload.size_mode};
        });
        assert.deepEqual(processor,{operation:'image.edit',ratio:'4:5',quality:'auto',format:undefined,sizeMode:'standard'});
        assert.deepEqual(errors,[]);
        console.log('PASS: continued draft, model switch, preflight, persisted correction, translations and processor isolation');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
