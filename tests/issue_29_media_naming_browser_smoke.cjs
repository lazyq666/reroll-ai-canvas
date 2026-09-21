const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';

(async () => {
    const browser = await chromium.launch({headless:true,executablePath:browserExecutable});
    try {
        const page = await browser.newPage({viewport:{width:1280,height:800}});
        const pageErrors = [];
        const consoleErrors = [];
        const failedResponses = [];
        page.on('pageerror',error => pageErrors.push(error.message));
        page.on('console',message => {
            if(message.type()==='error') consoleErrors.push(message.text());
        });
        page.on('response',response => {
            if(response.status() >= 400) failedResponses.push({status:response.status(),url:response.url()});
        });
        await page.goto(`${baseUrl}/static/smart-canvas.html?componentReview=nodes`,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.canvasMutation
            && customElements.get('ic-dialog')
            && customElements.get('ic-input')
            && typeof canvas !== 'undefined'
            && canvas
            && typeof nodes !== 'undefined'
            && Array.isArray(nodes)
            && document.documentElement.dataset.nodesStatus === 'ready'
        )).catch(async error => {
            throw new Error(`${error.message}\n${JSON.stringify({url:page.url(),pageErrors,consoleErrors,failedResponses,body:(await page.locator('body').innerText()).slice(0,500)},null,2)}`);
        });
        await page.evaluate(({png}) => {
            nodes.splice(0,nodes.length,{
                id:'rename-target', type:'smart-image', x:320, y:180, w:420, h:260,
                generationOutputNode:true, activeOutputId:'output-2',
                images:[
                    {url:png,kind:'image',name:'first.png',outputId:'output-1'},
                    {url:'/assets/output/opaque-provider-name.png',kind:'image',name:'second.png',outputId:'output-2'},
                ],
            });
            canvas.connections=[];
            selectedId='rename-target'; selectedIds=[]; selectedImage={nodeId:'rename-target',index:1};
            canvasVirtualization.reset();
            configureSmartCanvasVirtualization();
            render();
            window.SmartCanvasModules.viewportSelection.viewport.fitAll();
            render();
        },{png});
        const target = page.locator('.image-node[data-id="rename-target"] [data-image-index="1"]');
        await target.click({button:'right'});
        const renameItem = page.locator('#smartNodeContextMenu ic-menu-item[value="rename-media"]');
        await renameItem.waitFor({state:'visible'});
        assert.equal(await renameItem.getAttribute('label'),'重命名');
        await renameItem.click();
        const dialog = page.locator('#smartAssetNameDialog');
        const input = page.locator('#smartAssetNameInput');
        const nativeInput = input.locator('input');
        await page.waitForFunction(() => {
            const host=document.querySelector('#smartAssetNameDialog');
            const rect=host?.shadowRoot?.querySelector('[part="dialog"]')?.getBoundingClientRect();
            return host?.open && host.dataset.motionState==='open' && rect?.width>0 && rect?.height>0;
        });
        const initial = await input.evaluate(control => ({
            value:control.value,
            selected:control.input?.selectionStart === 0 && control.input?.selectionEnd === control.value.length,
            title:control.closest('ic-dialog')?.label || '',
            label:control.closest('ic-form-field')?.getAttribute('label') || '',
        }));
        assert.deepEqual(initial,{value:'second',selected:true,title:'重命名素材',label:'素材名称'});

        await nativeInput.fill('伪装.mp3');
        await dialog.locator('ic-button[hierarchy="primary"]').click();
        assert.equal(await dialog.getAttribute('open') !== null,true,'invalid extension closed the dialog');
        assert.match(
            await dialog.locator('ic-form-field').getAttribute('validation'),
            /\.png/,
        );

        await nativeInput.fill('角色.v2');
        await page.evaluate(() => {
            const node=nodes.find(item=>item.id==='rename-target');
            node.images=[node.images[1],node.images[0]];
        });
        await nativeInput.press('Enter');
        await dialog.waitFor({state:'detached'});
        const renamed = await page.evaluate(() => {
            const node=nodes.find(item=>item.id==='rename-target');
            return {
                names:Object.fromEntries(node.images.map(item=>[item.outputId,item.name])),
                selectedImage:{...selectedImage},
                download:downloadNameForMediaItem(node.images.find(item=>item.outputId==='output-2'),'image'),
            };
        });
        assert.deepEqual(renamed.names,{'output-2':'角色.v2.png','output-1':'first.png'});
        assert.deepEqual(renamed.selectedImage,{nodeId:'rename-target',index:0});
        assert.equal(renamed.download,'角色.v2.png');

        await page.evaluate(() => window.StudioI18n.set('en'));
        await page.locator('.image-node[data-id="rename-target"] [data-image-index="0"]').click({button:'right'});
        await renameItem.waitFor({state:'visible'});
        assert.equal(await renameItem.getAttribute('label'),'Rename');
        await renameItem.click();
        await page.waitForFunction(() => {
            const host=document.querySelector('#smartAssetNameDialog');
            const rect=host?.shadowRoot?.querySelector('[part="dialog"]')?.getBoundingClientRect();
            return host?.open && host.dataset.motionState==='open' && rect?.width>0 && rect?.height>0;
        });
        assert.deepEqual(await input.evaluate(control => ({
            title:control.closest('ic-dialog')?.label || '',
            label:control.closest('ic-form-field')?.getAttribute('label') || '',
        })),{title:'Rename media',label:'Media name'});
        await dialog.locator('ic-button[hierarchy="secondary"]').click();
        await dialog.waitFor({state:'detached'});

        assert.deepEqual(pageErrors,[]);
        console.log(JSON.stringify({initial,renamed,languageSwitch:true,pageErrors},null,2));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode=1;
});
