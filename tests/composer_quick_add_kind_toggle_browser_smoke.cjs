const assert = require('node:assert/strict');
const {chromium} = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sourceImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="96" height="64"%3E%3Cpath fill="%236b7cff" d="M0 0h96v64H0z"/%3E%3C/svg%3E';

async function resetSource(page) {
    await page.evaluate(image => {
        nodes.splice(0, nodes.length, {
            id:'quick-add-source',
            type:'smart-image',
            x:260,
            y:220,
            w:240,
            h:160,
            images:[{url:image,name:'source.svg',kind:'image'}],
            uploadedAttachment:true,
        });
        canvas.nodes = nodes;
        canvas.connections = [];
        selectedId = '';
        selectedIds = [];
        selectedImage = {nodeId:'',index:-1};
        render();
    }, sourceImage);
    await page.waitForSelector('.image-node[data-id="quick-add-source"]');
}

async function createFromQuickAdd(page, kind) {
    const source = page.locator('.image-node[data-id="quick-add-source"]');
    await source.hover();
    await source.locator('[data-node-quick-add][data-port="out"]').click({force:true});
    await page.waitForFunction(() => document.getElementById('referenceGenerateMenu')?.hasAttribute('open'));
    await page.locator(`#referenceGenerateMenu > ic-menu-item[value="${kind}"]`).click();
    await page.waitForFunction(expectedKind => {
        const created = nodes.find(node => node.id !== 'quick-add-source');
        return nodes.length === 2
            && created?.referenceGenerationKind === expectedKind
            && selectedId === created.id
            && document.getElementById('composer')?.classList.contains('open');
    }, kind);
}

async function generationKindColors(page) {
    const toggle = page.locator('#apiKindToggle');
    const read = () => toggle.evaluate(element => ({
        base:getComputedStyle(element.shadowRoot.querySelector('[part~="base"]')).color,
        label:getComputedStyle(element.querySelector('#apiKindLabel')).color,
        semanticColor:getComputedStyle(element).getPropertyValue('--ic-generation-kind-color').trim(),
        hostHover:element.matches(':hover'),
        baseHover:element.shadowRoot.querySelector('[part~="base"]').matches(':hover'),
    }));
    const normal = await read();
    await toggle.hover();
    await page.waitForTimeout(250);
    return {normal,hover:await read()};
}

(async () => {
    const browser = await chromium.launch({headless:true,executablePath:browserExecutable});
    try {
        const page = await browser.newPage({viewport:{width:1440,height:900}});
        page.setDefaultTimeout(20000);
        const runtimeErrors = [];
        page.on('pageerror', error => runtimeErrors.push(error.message));
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=composer-quick-add-kind-toggle&manual=1`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            canvas?.id
            && Array.isArray(nodes)
            && document.querySelector('#runBtn')?.dataset.icContractStatus === 'ready'
            && customElements.get('ic-menu')
        ));

        await resetSource(page);
        await createFromQuickAdd(page, 'image');
        const colors = await generationKindColors(page);

        await resetSource(page);
        await createFromQuickAdd(page, 'video');
        const videoState = await page.evaluate(() => {
            const created = nodes.find(node => node.id !== 'quick-add-source');
            const toggle = document.getElementById('apiKindToggle');
            return {
                referenceGenerationKind:created?.referenceGenerationKind || '',
                settingsKind:created?.runSettings?.apiKind || '',
                toggleKind:toggle?.value || '',
                toggleDisabled:Boolean(toggle?.disabled),
                eligibility:{...smartNodeGenerationEligibility(created)},
                constrainedImageKind:constrainSmartNodeGenerationSettings(
                    created,
                    {...created.runSettings,apiKind:'image'}
                ).apiKind,
            };
        });

        const failures = [];
        if(
            colors.hover.base !== colors.normal.base
            || colors.hover.label !== colors.normal.label
            || colors.hover.semanticColor !== colors.normal.semanticColor
        ){
            failures.push(`hover color changed from ${JSON.stringify(colors.normal)} to ${JSON.stringify(colors.hover)}`);
        }
        const expectedVideoState = {
            referenceGenerationKind:'video',
            settingsKind:'video',
            toggleKind:'video',
            toggleDisabled:false,
            eligibility:{
                runnable:true,
                imageAllowed:true,
                videoAllowed:true,
                forcedApiKind:'',
            },
            constrainedImageKind:'image',
        };
        if(JSON.stringify(videoState) !== JSON.stringify(expectedVideoState)){
            failures.push(`Quick Add video Composer stayed constrained: ${JSON.stringify(videoState)}`);
        }

        let switched = null;
        if(!videoState.toggleDisabled){
            await page.locator('#apiKindToggle').click();
            await page.waitForFunction(() => document.getElementById('apiKindToggle')?.value === 'image');
            await page.waitForFunction(() => (
                document.querySelector('#dynamicParams ic-select[data-component-variant="model-picker"]')
                    ?.getAttribute('name') === 'image-model'
            ));
            switched = await page.evaluate(() => {
                const created = nodes.find(node => node.id !== 'quick-add-source');
                return {
                    toggleKind:document.getElementById('apiKindToggle')?.value || '',
                    settingsKind:created?.runSettings?.apiKind || '',
                    referenceGenerationKind:created?.referenceGenerationKind || '',
                    modelPickerName:document.querySelector(
                        '#dynamicParams ic-select[data-component-variant="model-picker"]'
                    )?.getAttribute('name') || '',
                };
            });
            if(JSON.stringify(switched) !== JSON.stringify({
                toggleKind:'image',
                settingsKind:'image',
                referenceGenerationKind:'image',
                modelPickerName:'image-model',
            })){
                failures.push(`Quick Add video Composer did not persist image mode: ${JSON.stringify(switched)}`);
            }
        }

        await page.evaluate(() => {
            const created = nodes.find(node => node.id !== 'quick-add-source');
            created.images = [{
                url:'data:video/mp4;base64,AAAA',
                name:'completed.mp4',
                kind:'video',
            }];
            created.referenceGenerationKind = 'video';
            created.runSettings = {...created.runSettings,engine:'api',apiKind:'video'};
            render();
        });
        await page.waitForFunction(() => document.getElementById('apiKindToggle')?.disabled === true);
        const completedVideoState = await page.evaluate(() => {
            const created = nodes.find(node => node.id !== 'quick-add-source');
            return {
                toggleKind:document.getElementById('apiKindToggle')?.value || '',
                toggleDisabled:Boolean(document.getElementById('apiKindToggle')?.disabled),
                eligibility:{...smartNodeGenerationEligibility(created)},
                constrainedImageKind:constrainSmartNodeGenerationSettings(
                    created,
                    {...created.runSettings,apiKind:'image'}
                ).apiKind,
            };
        });
        assert.deepEqual(completedVideoState, {
            toggleKind:'video',
            toggleDisabled:true,
            eligibility:{
                runnable:true,
                imageAllowed:false,
                videoAllowed:true,
                forcedApiKind:'video',
            },
            constrainedImageKind:'video',
        });
        assert.deepEqual(failures, []);
        assert.deepEqual(runtimeErrors, []);
        console.log(JSON.stringify({passed:true,colors,videoState,switched,completedVideoState}, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
