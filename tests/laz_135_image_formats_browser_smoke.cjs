const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {server} = require('./image_repair_browser_fixture.cjs');

(async()=>{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({headless:true,executablePath:process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page = await browser.newPage({viewport:{width:1440,height:960}});
    const errors = [], submissions = [];
    page.on('pageerror',error=>errors.push(error.stack || error.message));
    try {
        await page.route('**/api/config',async route=>{
            const value = await (await route.fetch()).json();
            await route.fulfill({json:JSON.parse(JSON.stringify(value).replaceAll('gpt-image-2.5-suburst','gpt-image-2.6-flare'))});
        });
        await page.route('**/api/model-capabilities?**',async route=>{
            const value = await (await route.fetch()).json();
            value.parameters.quality.values = ['auto','low','medium','high','xhigh','max'];
            value.parameters.output_format = {type:'enum',values:['png','jpeg','webp','gif','svg'],default:'png'};
            value.parameters.frame_size = {type:'string',default:'512x512'};
            value.parameters.frame_count = {type:'integer',minimum:2,maximum:16,default:9};
            value.parameters.frame_duration_ms = {type:'integer',minimum:20,default:200};
            value.parameters.svg_model = {type:'string',default:'test-text-model'};
            value.parameters.output_compression = {type:'integer',minimum:0,maximum:100};
            value.inputs.image.maximum = 16;
            value.media_contract.supports_transparent_png = true;
            await route.fulfill({json:value});
        });
        await page.route('**/api/canvas-image-tasks',async route=>{
            submissions.push(route.request().postDataJSON());
            await route.fulfill({json:{task_id:`fixture-${submissions.length}`,status:'running'}});
        });
        await page.route('**/assets/format.gif',route=>route.fulfill({contentType:'image/gif',body:Buffer.from('R0lGODlhIAAgAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAIAAgAAAINQABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJUmRAACH5BAEUAAEALAAAAAAgACAAgQAA/wAAAAAAAAAAAAg1AAEIHEiwoMGDCBMqXMiwocOHECNKnEixosWLGDNq3Mixo8ePIEOKHEmypMmTKFOqXMlSZEAAOw==','base64')}));
        await page.route('**/api/media-preview?**',async route=>{
            await route.fulfill({contentType:'image/png',body:await require('sharp')({create:{width:32,height:32,channels:3,background:'red'}}).png().toBuffer()});
        });
        await page.goto(`${base}/static/smart-canvas.html?id=image-repair-browser&manual=1`);
        await page.waitForSelector('#fixture-open');
        await page.evaluate(async()=>{
            const node = {id:'format-generation',type:'smart-image',x:600,y:160,w:320,h:240,images:[],generationOutputNode:true,referenceGenerationKind:'image',runSettings:{}};
            nodes.push(node);
            selectedId = node.id;
            selectedIds = [];
            render();
            updateComposer();
            Object.assign(settings,{engine:'api',apiKind:'image',provider_id:'apimart',model:'gpt-image-2.6-flare',ratio:'square',resolution:'1k',quality:'auto',count:1});
            await loadSmartImageCapabilityForCurrentSettings({});
            renderDynamicParams();
        });
        const picker = page.locator('#dynamicParams ic-generation-settings-picker');
        await picker.locator('[part="trigger"]').click();
        assert.equal(await picker.locator('[data-quality]').count(),6);
        await picker.locator('[data-quality="max"]').click();
        assert.equal(await page.evaluate(()=>settings.quality),'max');
        await page.evaluate(()=>window.StudioI18n.set('en'));
        await picker.locator('[part="trigger"]').click();
        assert.equal(await picker.locator('[data-quality="xhigh"]').textContent(),'Extra high');
        await page.keyboard.press('Escape');
        const format = page.locator('#dynamicParams ic-select[data-smart-select-param="imageFormat"]');
        assert.equal(await format.getAttribute('placeholder'),'Select format');
        assert.equal(await format.evaluate(element=>element.value || ''),'');
        assert.deepEqual(await format.locator('option').allTextContents(),['Default format','Transparent PNG','GIF','SVG']);
        assert.equal(await page.locator('[data-toggle-param="transparentPng"]').count(),0);
        await format.getByRole('combobox').click();
        await format.getByRole('option',{name:'Transparent PNG',exact:true}).click();
        assert.equal(await page.evaluate(()=>settings.transparentPng),true);
        assert.equal(await page.evaluate(()=>nodes.find(node=>node.id==='format-generation').runSettings.transparentPng),true);
        await page.evaluate(async()=>{
            await window.SmartCanvasModules.generationProvider.submit({prompt:'transparent icon',refs:[],settings:{...settings}});
        });
        assert.equal(submissions.at(-1).transparent_png,true);
        await format.getByRole('combobox').click();
        await format.getByRole('option',{name:'Default format',exact:true}).click();
        assert.deepEqual(await page.evaluate(()=>({format:settings.outputFormat,transparent:settings.transparentPng})),{format:'',transparent:false});
        assert.equal(await format.evaluate(element=>element.value || ''),'');
        await page.evaluate(async()=>{
            await window.SmartCanvasModules.generationProvider.submit({prompt:'default image',refs:[],settings:{...settings}});
        });
        assert.equal(submissions.at(-1).output_format,undefined);
        assert.equal(submissions.at(-1).transparent_png,false);
        await format.getByRole('combobox').click();
        await format.getByRole('option',{name:'Transparent PNG',exact:true}).click();
        await page.evaluate(()=>{settings.outputCompression=80;});
        await format.getByRole('combobox').click();
        await format.getByRole('option',{name:'GIF',exact:true}).click();
        assert.equal(await page.evaluate(()=>settings.transparentPng),false);
        assert.equal(await page.locator('[data-param="frameCount"],[data-param="frameDurationMs"],[data-smart-select-param="frameSize"]').count(),0);
        assert.equal(await picker.getAttribute('hide-ratio'),'');
        await picker.locator('[part="trigger"]').click();
        const frames = picker.locator('[data-frame-control="frameCount"]');
        const fps = picker.locator('[data-frame-control="frameDurationMs"]');
        assert.equal(await frames.inputValue(),'9');
        assert.equal(await fps.getAttribute('aria-valuetext'),'5 fps');
        assert.deepEqual(await picker.locator('[data-frame-size]').allTextContents(),['256 × 256','512 × 512','768 × 768']);
        await frames.press('End');
        assert.equal(await page.evaluate(()=>settings.frameCount),16);
        assert.equal(await picker.locator('[data-frame-size="768x768"]').isEnabled(),false);
        await fps.press('End');
        assert.equal(await fps.getAttribute('aria-valuetext'),'50 fps');
        await fps.press('ArrowLeft');
        assert.equal(await fps.getAttribute('aria-valuetext'),'33.33 fps');
        await fps.press('Home');
        assert.equal(await fps.getAttribute('aria-valuetext'),'1 fps');
        const fpsBounds = await fps.boundingBox();
        await page.mouse.move(fpsBounds.x + 10,fpsBounds.y + fpsBounds.height / 2);
        await page.mouse.down();
        await page.mouse.move(fpsBounds.x + fpsBounds.width / 2,fpsBounds.y + fpsBounds.height / 2,{steps:10});
        assert.equal(await picker.locator('[data-frame-section="frameDurationMs"] output').textContent(),'10 fps');
        await page.mouse.up();
        assert.equal(await page.evaluate(()=>settings.frameDurationMs),100);
        assert.deepEqual(await page.evaluate(()=>{
            const saved = nodes.find(node=>node.id==='format-generation').runSettings;
            return {count:saved.frameCount,duration:saved.frameDurationMs};
        }),{count:16,duration:100});
        await picker.locator('[data-frame-size="256x256"]').click();
        assert.equal(await page.evaluate(()=>settings.frameSize),'256x256');
        await picker.locator('[data-frame-size="512x512"]').click();
        await page.evaluate(async()=>{
            await window.SmartCanvasModules.generationProvider.submit({prompt:'wave',refs:[{url:'/assets/source.png',kind:'image'}],settings:{...settings}});
        });
        assert.equal(submissions.at(-1).output_format,'gif');
        assert.equal(submissions.at(-1).transparent_png,false);
        assert.equal(submissions.at(-1).output_compression,undefined);
        assert.equal(submissions.at(-1).quality,'max');
        assert.equal(submissions.at(-1).size,'512x512');
        assert.equal(submissions.at(-1).frame_count,16);
        assert.equal(submissions.at(-1).frame_duration_ms,100);
        assert.equal(submissions.at(-1).resolution_tier,'');
        assert.equal(submissions.at(-1).reference_aspect_ratio,'');
        await frames.press('Home');
        await picker.locator('[data-frame-size="768x768"]').click();
        await frames.press('End');
        assert.equal(await page.evaluate(()=>settings.frameSize),'768x768');
        assert.equal(await picker.locator('#frame-error').isVisible(),true);
        assert.equal(await page.locator('#runBtn').evaluate(element=>element.disabled),true);
        const invalidSheet = await page.evaluate(async()=>{
            try {
                await window.SmartCanvasModules.generationProvider.submit({prompt:'wave',refs:[],settings:{...settings}});
                return '';
            } catch(error) { return error.message; }
        });
        assert.ok(invalidSheet);
        assert.equal(submissions.length,3);
        await picker.locator('[data-frame-size="512x512"]').click();
        assert.equal(await page.locator('#runBtn').evaluate(element=>element.disabled),false);
        await page.keyboard.press('Escape');
        await page.evaluate(()=>{
            setDynamicSetting('frameSize','640x480');
            setDynamicSetting('frameDurationMs',70);
            renderDynamicParams({force:true});
        });
        await picker.locator('[part="trigger"]').click();
        assert.equal(await fps.getAttribute('aria-valuetext'),'14.29 fps');
        assert.equal(await picker.locator('[data-frame-size="640x480"]').getAttribute('aria-checked'),'true');
        await picker.locator('[data-quality="high"]').click();
        assert.equal(await fps.getAttribute('aria-valuetext'),'14.29 fps');
        assert.equal(await page.evaluate(()=>settings.frameDurationMs),70);
        await picker.locator('[data-quality="max"]').click();
        await picker.locator('[data-frame-size="512x512"]').click();
        await page.keyboard.press('Escape');
        await page.waitForFunction(async()=>{
            const saved = (await fetch('/fixture/state').then(response=>response.json())).canvas.nodes.find(node=>node.id==='format-generation')?.runSettings;
            return saved?.frameDurationMs === 70 && saved?.frameCount === 16 && saved?.frameSize === '512x512';
        });
        await page.reload();
        await page.waitForFunction(()=>typeof nodes !== 'undefined' && nodes.some(node=>node.id==='format-generation'));
        await page.evaluate(()=>{
            selectedId = 'format-generation'; selectedIds = [];
            render(); updateComposer();
        });
        await picker.locator('[part="trigger"]').click();
        assert.equal(await fps.getAttribute('aria-valuetext'),'14.29 fps');
        assert.equal(await frames.inputValue(),'16');
        await page.keyboard.press('Escape');
        const durationRule = await page.evaluate(()=>{
            const rule = smartCurrentImageCapability('').model_capability.parameters.frame_duration_ms;
            const original = {...rule};
            rule.values = [70,90];
            setDynamicSetting('frameDurationMs',200);
            renderDynamicParams({force:true});
            return original;
        });
        await picker.locator('[part="trigger"]').click();
        assert.equal(await picker.locator('#frame-error').isVisible(),true);
        assert.doesNotMatch(await picker.locator('#frame-error').textContent(),/smart\./);
        assert.equal(await page.locator('#runBtn').evaluate(element=>element.disabled),true);
        assert.equal(await fps.getAttribute('max'),'1');
        await fps.press('End');
        assert.equal(await page.evaluate(()=>settings.frameDurationMs),70);
        await fps.press('Home');
        assert.equal(await page.evaluate(()=>settings.frameDurationMs),90);
        assert.equal(await fps.getAttribute('aria-valuetext'),'11.11 fps');
        await page.keyboard.press('Escape');
        await page.evaluate(()=>{
            smartCurrentImageCapability('').model_capability.parameters.frame_duration_ms.values = [75];
            renderDynamicParams({force:true});
        });
        await picker.locator('[part="trigger"]').click();
        assert.equal(await fps.isDisabled(),true);
        assert.equal(await page.locator('#runBtn').evaluate(element=>element.disabled),true);
        await page.keyboard.press('Escape');
        await page.evaluate(rule=>{
            smartCurrentImageCapability('').model_capability.parameters.frame_duration_ms = rule;
            setDynamicSetting('frameDurationMs',70);
            renderDynamicParams({force:true});
        },durationRule);
        const formatRule = await page.evaluate(()=>{
            const parameters = smartCurrentImageCapability('').model_capability.parameters;
            const original = parameters.output_format;
            delete parameters.output_format;
            renderDynamicParams({force:true});
            return original;
        });
        await picker.locator('[part="trigger"]').click();
        assert.match(await picker.locator('#frame-error').textContent(),/output format/);
        assert.equal(await page.locator('#runBtn').evaluate(element=>element.disabled),true);
        await page.keyboard.press('Escape');
        await page.evaluate(rule=>{
            smartCurrentImageCapability('').model_capability.parameters.output_format = rule;
            renderDynamicParams({force:true});
        },formatRule);
        await page.evaluate(()=>{settings.count=4;});
        await format.getByRole('combobox').click();
        await format.getByRole('option',{name:'SVG',exact:true}).click();
        assert.equal(await page.evaluate(()=>settings.count),1);
        const conflict = await page.evaluate(async()=>{
            try {
                await window.SmartCanvasModules.generationProvider.submit({prompt:'vector',refs:[{url:'/assets/source.png',kind:'image'}],settings:{...settings}});
                return '';
            } catch(error) { return error.message; }
        });
        assert.ok(conflict);
        assert.equal(submissions.length,3);
        await page.evaluate(async()=>{
            await window.SmartCanvasModules.generationProvider.submit({prompt:'vector',refs:[],settings:{...settings,ratio:'square'}});
        });
        assert.equal(submissions.at(-1).output_format,'svg');
        assert.deepEqual(submissions.at(-1).svg,{model:'test-text-model'});
        assert.equal(submissions.at(-1).frame_count,undefined);
        assert.equal(await picker.locator('[data-frame-control]').count(),0);
        for(const transparent of [false,true]){
            for(const formats of [[],['png','jpeg','webp'],['png','gif'],['png','svg'],['png','gif','svg']]){
                const visibleOptions = await page.evaluate(({transparent,formats})=>{
                    const capability = smartCurrentImageCapability('');
                    capability.supports_transparent_png = transparent;
                    capability.model_capability.parameters.output_format.values = formats;
                    setDynamicSetting('imageFormat','__default__');
                    return Array.from(document.querySelectorAll('[data-smart-select-param="imageFormat"] option'),option=>option.value);
                },{transparent,formats});
                const expected = [...(transparent ? ['transparent_png'] : []),...formats.filter(value=>['gif','svg'].includes(value))];
                assert.deepEqual(visibleOptions,expected.length ? ['__default__',...expected] : []);
            }
        }
        await page.evaluate(()=>{
            const capability = smartCurrentImageCapability('');
            capability.supports_transparent_png = true;
            capability.model_capability.parameters.output_format.values = ['png','jpeg','webp','gif','svg'];
            setDynamicSetting('imageFormat','__default__');
        });
        await format.getByRole('combobox').focus();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(()=>settings.outputFormat),'svg');
        for(const width of [1440,768,390]){
            await page.setViewportSize({width,height:960});
            await page.evaluate(()=>{
                const node = nodes.find(item=>item.id === 'format-generation');
                node.x = 100; node.y = 80;
                viewport.x = 0; viewport.y = 0; viewport.scale = 0.6;
                render(); updateComposer(); positionCanvasFloatingOverlays();
            });
            for(const language of ['zh','en']){
                await page.evaluate(language=>{window.StudioI18n.set(language);setDynamicSetting('imageFormat','__default__');},language);
                assert.equal(await format.getAttribute('placeholder'),language === 'zh' ? '选择格式' : 'Select format');
                await format.getByRole('combobox').click();
                assert.equal(await format.getByRole('option',{name:language === 'zh' ? '默认格式' : 'Default format',exact:true}).isVisible(),true);
                if(width === 1440 && language === 'zh') await page.screenshot({path:'/tmp/laz135-format-menu.png',animations:'disabled',clip:{x:65,y:160,width:810,height:390}});
                await format.getByRole('option',{name:'GIF',exact:true}).click();
                await picker.locator('[part="trigger"]').click();
                for(const theme of ['light','dark']){
                    await page.evaluate(theme=>document.documentElement.dataset.uiTheme=theme,theme);
                    await page.evaluate(()=>positionCanvasFloatingOverlays());
                    await fps.waitFor({state:'visible'});
                    await picker.locator('[part="panel"]').evaluate(panel=>Promise.all(panel.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
                    const bounds = await page.locator('#composer').boundingBox();
                    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1,JSON.stringify({width,bounds}));
                    const frameBounds = await picker.locator('[part="panel"]').boundingBox();
                    assert.ok(frameBounds && frameBounds.x >= 11 && frameBounds.x + frameBounds.width <= width - 11 && frameBounds.y >= 11 && frameBounds.y + frameBounds.height <= 949,JSON.stringify({width,frameBounds}));
                    assert.equal(await fps.getAttribute('aria-label'),language === 'zh' ? '帧率' : 'Frame rate');
                    assert.equal(await frames.getAttribute('aria-label'),language === 'zh' ? '帧数' : 'Frames');
                    assert.equal(await fps.getAttribute('aria-valuetext'),'14.29 fps');
                    await page.screenshot({path:`/tmp/laz135-${width}-${language}-${theme}.png`,animations:'disabled'});
                }
                await page.keyboard.press('Escape');
            }
        }
        await page.setViewportSize({width:1440,height:960});
        await page.evaluate(()=>{
            const videoPicker = document.createElement('ic-generation-settings-picker');
            videoPicker.id = 'video-regression-picker';
            Object.entries({
                label:'Video settings',ratio:'16:9','ratio-presets':'16:9,9:16,1:1',
                resolution:'720p',resolutions:'720p,1080p','hide-quality':'',
                duration:'4','duration-min':'4','duration-max':'15','duration-label':'Duration',
            }).forEach(([name,value])=>videoPicker.setAttribute(name,value));
            videoPicker.style.cssText = 'position:fixed;top:80px;right:20px';
            videoPicker.addEventListener('ic-change',event=>videoPicker.lastChange=event.detail);
            document.body.append(videoPicker);
        });
        const videoPicker = page.locator('#video-regression-picker');
        await videoPicker.locator('[part="trigger"]').click();
        await videoPicker.locator('.duration-slider').press('End');
        assert.deepEqual(await videoPicker.evaluate(element=>element.lastChange),{field:'duration',value:15});
        assert.equal(await videoPicker.locator('[data-frame-control]').count(),0);
        assert.equal(await videoPicker.locator('.duration-value').textContent(),'15s');
        await page.keyboard.press('Escape');
        await videoPicker.evaluate(element=>element.remove());
        await page.evaluate(()=>{
            nodes.push({id:'gif-original',type:'smart-image',x:600,y:100,w:320,h:320,images:[{url:'/assets/format.gif',kind:'image',name:'format.gif',natural_w:32,natural_h:32}]});
            selectedId = ''; selectedIds = [];
            viewport.x = 0; viewport.y = 0; viewport.scale = 1;
            render(); window.SmartCanvasModules.viewportSelection.viewport.apply();
        });
        const gif = page.locator('[data-id="gif-original"] img[data-original-src="/assets/format.gif"]').first();
        await page.waitForFunction(()=>document.querySelector('[data-id="gif-original"] img[data-original-src]')?.getAttribute('src')?.startsWith('/api/media-preview'));
        await page.evaluate(()=>{selectedId='gif-original';window.SmartCanvasModules.viewportSelection.selection.refresh();});
        await page.waitForFunction(()=>document.querySelector('[data-id="gif-original"] img[data-original-src]')?.getAttribute('src')==='/assets/format.gif');
        await page.evaluate(()=>{selectedId='';window.SmartCanvasModules.viewportSelection.selection.refresh();});
        await page.waitForFunction(()=>document.querySelector('[data-id="gif-original"] img[data-original-src]')?.getAttribute('src')?.startsWith('/api/media-preview'));
        await page.evaluate(()=>{void imageStudio.open({nodeId:'gif-original',mode:'crop'});});
        const confirmation = page.locator('ic-confirmation-dialog[open]').last();
        await confirmation.locator('[data-ic-confirmation-owned="cancel"]').waitFor({state:'visible'});
        assert.match(await confirmation.getAttribute('description'),/PNG/);
        await confirmation.locator('[data-ic-confirmation-owned="cancel"]').click();
        await page.waitForFunction(()=>!staticImageCopyPending);
        assert.equal(await page.evaluate(()=>nodes.find(item=>item.id==='gif-original').images[0].url),'/assets/format.gif');
        await page.evaluate(()=>{void imageStudio.open({nodeId:'gif-original',mode:'crop'});});
        await confirmation.locator('[data-ic-confirmation-owned="confirm"]').waitFor({state:'visible'});
        await confirmation.locator('[data-ic-confirmation-owned="confirm"]').click();
        await page.waitForFunction(()=>imageStudio.current()?.nodeId && imageStudio.current()?.nodeId !== 'gif-original' && imageEditMode === 'crop');
        assert.equal(await page.evaluate(()=>nodes.find(item=>item.id==='gif-original').images[0].url),'/assets/format.gif');
        assert.equal(await page.evaluate(()=>nodes.find(item=>item.id===imageStudio.current().nodeId).images[0].url),'/assets/upload.png');
        let batchPayload;
        await page.route('**/api/image-model-capabilities/intersection',route=>route.fulfill({json:{
            catalog_revision:'format-fixture',qualities:['auto','low','medium','high','xhigh','max'],
            formats:['png','jpeg','webp','gif','svg'],aspect_ratios:['1:1'],resolution_tiers:['1K'],default_resolution_tier:'1K',blocked:false
        }}));
        await page.route('**/api/batch-generation/preview',route=>{
            batchPayload = route.request().postDataJSON();
            return route.fulfill({json:{generation_run_count:1,estimated_submission_count:1,estimated_output_count:1,tasks:[]}});
        });
        await page.goto(`${base}/static/online.html`);
        await page.locator('[data-batch-model-id]').first().waitFor();
        await page.locator('[data-batch-model-id]').first().evaluate(element=>{element.checked=true;element.dispatchEvent(new Event('change',{bubbles:true}));});
        await page.waitForFunction(()=>document.querySelector('#batchQuality ic-radio[value="max"]'));
        await page.locator('#batchQuality').evaluate(element=>{element.value='max';element.dispatchEvent(new Event('change',{bubbles:true}));});
        await page.locator('[data-format-setting="outputFormat"]').evaluate(element=>{element.value='gif';element.dispatchEvent(new Event('change',{bubbles:true}));});
        await page.locator('[data-format-setting="frameCount"]').fill('12');
        await page.locator('[data-format-setting="frameCount"]').press('Tab');
        await page.waitForFunction(()=>{
            const value = JSON.parse(localStorage.getItem('studio_batch_generation_config_v1') || '{}');
            return value.settings?.frameCount === 12 && value.settings?.quality === 'max';
        });
        await page.reload();
        await page.locator('[data-format-setting="frameCount"]').waitFor({state:'visible'});
        assert.equal(await page.locator('[data-format-setting="frameCount"]').inputValue(),'12');
        assert.equal(await page.locator('#batchQuality').evaluate(element=>element.value),'max');
        await page.locator('#previewBatch').click();
        assert.equal(batchPayload.settings.catalog_revision,'format-fixture');
        assert.equal(batchPayload.settings.outputFormat,'gif');
        assert.deepEqual(batchPayload.ratios,[]);
        assert.deepEqual(errors,[]);
        console.log(JSON.stringify({ok:true,submissions:submissions.length,viewports:[1440,768,390],languages:['zh','en'],themes:['light','dark']}));
    } catch(error) {
        await page.screenshot({path:'/tmp/laz135-failure.png'});
        console.error(await page.locator('ic-confirmation-dialog').evaluateAll(elements=>elements.map(element=>({state:element.dataset.motionState,contract:element.dataset.icContractReason,open:element.open,dialog:element.shadowRoot?.querySelector('dialog')?.outerHTML.slice(0,600)}))));
        throw error;
    } finally {
        await browser.close();
        server.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
