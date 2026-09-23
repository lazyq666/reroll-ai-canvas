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
        const input = target.locator('.image-name-editor');
        await input.waitFor({state:'visible'});
        await page.waitForFunction(() => document.activeElement?.classList.contains('image-name-editor'));
        const initial = await input.evaluate(control => ({
            value:control.value,
            selected:control.selectionStart === 0 && control.selectionEnd === control.value.length,
            focused:document.activeElement === control,
            label:control.getAttribute('aria-label'),
            identity:control.closest('.image-name-badge')?.querySelector('.image-name-badge-identity')?.textContent,
            icon:control.closest('.image-name-badge')?.querySelector('ic-icon')?.getAttribute('name'),
            border:getComputedStyle(control).borderTopWidth,
            width:control.getBoundingClientRect().width,
            badgeWidth:control.closest('.image-name-badge')?.getBoundingClientRect().width,
        }));
        assert.equal(initial.value,'second');
        assert.equal(initial.selected,true);
        assert.equal(initial.focused,true);
        assert.equal(initial.label,'素材名称');
        assert.equal(initial.identity,'AI 生成 · ');
        assert.equal(initial.icon,'image');
        assert.equal(initial.border,'0px');
        assert.ok(initial.width > 0);
        await input.fill('伪装.mp3');
        await input.press('Enter');
        assert.equal(await input.isVisible(),true,'invalid extension ended editing');
        await input.fill('角色.v2');
        await page.evaluate(() => {
            const node=nodes.find(item=>item.id==='rename-target');
            node.images=[node.images[1],node.images[0]];
        });
        await input.press('Enter');
        await input.waitFor({state:'detached'});
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
        const renamedBadge = page.locator('.image-node[data-id="rename-target"] [data-image-index="0"] .image-name-badge');
        await renamedBadge.dblclick();
        const englishInput = renamedBadge.locator('.image-name-editor');
        assert.equal(await englishInput.getAttribute('aria-label'),'Media name');
        await englishInput.fill('Discard me');
        await englishInput.press('Escape');
        assert.equal(await page.evaluate(() => nodes[0].images[0].name),'角色.v2.png');
        await renamedBadge.dblclick();
        await renamedBadge.locator('.image-name-editor').fill('Canvas click');
        await page.locator('#world').click({position:{x:5,y:5},force:true});
        assert.equal(await page.evaluate(() => nodes[0].images[0].name),'Canvas click.png');

        await page.evaluate(({png}) => {
            nodes[0].generationOutputNode = false;
            nodes[0].uploadedAttachment = true;
            nodes[0].images = [{url:png,kind:'image',name:'imported.png'}];
            selectedId = 'rename-target';
            selectedIds = [];
            selectedImage = {nodeId:'rename-target',index:0};
            render();
        },{png});
        const geometry = async () => page.evaluate(() => {
            const node = document.querySelector('.image-node[data-id="rename-target"]');
            const badge = node.querySelector('.image-name-badge-outside');
            const media = node.querySelector('.node-img');
            const editor = badge.querySelector('.image-name-editor');
            const toolbar = document.querySelector('#smartNodeFloatingPortal');
            return {
                badgeTop:badge.getBoundingClientRect().top,
                mediaTop:media.getBoundingClientRect().top,
                editorTop:editor?.getBoundingClientRect().top,
                editorBottom:editor?.getBoundingClientRect().bottom,
                toolbarBottom:toolbar.classList.contains('open') ? toolbar.getBoundingClientRect().bottom : null,
            };
        });
        const beforeEdit = await geometry();
        await page.evaluate(() => renameSmartNodeImage('rename-target',0));
        const afterEdit = await geometry();
        assert.ok(Math.abs(beforeEdit.badgeTop-afterEdit.badgeTop) < 1, JSON.stringify({beforeEdit,afterEdit}));
        assert.ok(afterEdit.editorBottom < afterEdit.mediaTop, JSON.stringify(afterEdit));
        assert.ok(afterEdit.toolbarBottom < afterEdit.editorTop, JSON.stringify(afterEdit));

        assert.deepEqual(pageErrors,[]);
        console.log(JSON.stringify({initial,renamed,geometry:{beforeEdit,afterEdit},languageSwitch:true,pageErrors},null,2));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode=1;
});
