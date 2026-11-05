// Real Smart Canvas interactions in a transient session; never writes a Workspace.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const origin = 'http://image-group.local';

test('Image group selection, deletion and split', async t => {
    const browser = await chromium.launch({headless:true, executablePath:process.env.SMART_CANVAS_BROWSER
        || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    t.after(() => browser.close());
    const page = await browser.newPage({viewport:{width:1600, height:1100}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(`${origin}/**`, async route => {
        const pathname = new URL(route.request().url()).pathname;
        if(pathname.startsWith('/api/') || pathname === '/favicon.ico'){
            return route.fulfill({json:{}});
        }
        const size = pathname.match(/^\/media\/(\d+)x(\d+)\.svg$/);
        if(size) return route.fulfill({contentType:'image/svg+xml', body:
            `<svg xmlns="http://www.w3.org/2000/svg" width="${size[1]}" height="${size[2]}"><rect width="100%" height="100%" fill="#a8b9d2"/></svg>`});
        const file = path.resolve(root, `.${pathname}`);
        if(file.startsWith(path.join(root, 'static') + path.sep) && fs.existsSync(file)){
            return route.fulfill({path:file});
        }
        return route.fulfill({status:404, body:'Not found'});
    });
    await page.goto(`${origin}/static/smart-canvas.html?componentReview=nodes`);
    await page.waitForFunction(() => document.documentElement.dataset.nodesStatus === 'ready');

    const install = (count=3, type='smart-image') => page.evaluate(({count,type}) => {
        clearImageClickTimer();
        const dimensions = [[1024,1536], [1536,1024], [1024,1024], [2048,512]];
        const images = Array.from({length:count}, (_, index) => {
            const [w,h] = dimensions[index % dimensions.length];
            return {url:`/media/${w}x${h}.svg`, name:`sample-${index}.svg`, kind:'image', natural_w:w, natural_h:h};
        });
        nodes = [{id:'image-group', type, title:'Group', x:200, y:150, w:500, h:400, scale:0.8, images}];
        canvas.nodes = nodes;
        canvas.connections = [];
        canvasPersistence.startTransientSession({document:canvas});
        selectedId = '';
        selectedIds = [];
        selectedImage = {nodeId:'', index:-1};
        viewport = {x:0, y:0, scale:1};
        window.SmartCanvasModules.viewportSelection.viewport.apply();
        render();
    }, {count,type});
    const clickImage = async () => {
        await page.locator('[data-id="image-group"] .thumb-media-frame').first().click();
        await page.waitForFunction(() => selectedImage.nodeId === 'image-group' && selectedImage.index === 0);
        // The single-click handler waits to distinguish a double click.
        await page.waitForTimeout(260);
    };
    const state = () => page.evaluate(() => nodes.map(node => ({id:node.id, urls:node.images.map(image => image.url)})));

    await t.test('Delete and Backspace remove only the selected image and preserve siblings', async () => {
        for(const key of ['Delete','Backspace']){
            await install();
            const before = await state();
            await clickImage();
            await page.keyboard.press(key);
            const after = [{id:'image-group', urls:before[0].urls.slice(1)}];
            assert.deepEqual(await state(), after, `${key} must keep the container and other images`);
        }
    });
    await t.test('Selecting a thumbnail shows only its selection ring in both themes and languages', async () => {
        for(const theme of ['light','dark']) for(const language of ['zh','en']){
            await install();
            await page.evaluate(({theme,language}) => {
                applyTheme(theme);
                window.StudioI18n.set(language);
            }, {theme,language});
            await clickImage();
            const styles = await page.evaluate(() => {
                const host = document.querySelector('[data-id="image-group"]');
                const thumb = host.querySelector('.thumb-item.image-selected');
                const selected = getComputedStyle(host).borderColor;
                host.classList.remove('selected');
                const unselected = getComputedStyle(host).borderColor;
                host.classList.add('selected');
                return {selected,unselected, ring:getComputedStyle(thumb.querySelector('.thumb-media-frame')).boxShadow,
                    outerRing:getComputedStyle(host,'::before').content};
            });
            assert.equal(styles.selected, styles.unselected, `${theme}/${language}: container must not look selected`);
            assert.equal(styles.outerRing, 'none');
            assert.notEqual(styles.ring, 'none');
        }
    });
    await t.test('Selecting the container background still deletes the entire group', async () => {
        await install();
        await page.locator('[data-id="image-group"]').click({position:{x:480,y:380}});
        await page.keyboard.press('Delete');
        assert.deepEqual(await state(), []);
    });
    await t.test('Far-view skeletons keep single-image selection and deletion through zoom changes', async () => {
        await install(4);
        const before = await state();
        await page.evaluate(() => {
            viewport = {x:50,y:50,scale:0.18};
            window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
            render();
        });
        const host = page.locator('[data-id="image-group"]');
        await host.locator('.far-node-media').nth(1).click();
        await page.waitForTimeout(300);
        assert.deepEqual(await page.evaluate(() => selectedImage), {nodeId:'image-group',index:1});
        assert.equal(await host.locator('.far-node-media.image-selected').count(), 1);
        assert.equal(await host.evaluate(node => getComputedStyle(node,'::before').content), 'none');
        for(const scale of [1,0.18]){
            await page.evaluate(scale => {
                viewport.scale = scale;
                window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
                render();
            }, scale);
            await page.waitForFunction(() => !smartCanvasDetailRecoveryFrame);
            assert.equal(await host.locator('.image-selected[data-image-index="1"]').count(), 1);
        }
        await page.keyboard.press('Delete');
        assert.deepEqual(await state(), [{id:'image-group',urls:before[0].urls.filter((_,index) => index!==1)}]);
    });
    await t.test('Split uses standalone import dimensions, keeps order and avoids overlapping images', async () => {
        await install(10);
        const before = await state();
        const result = await page.evaluate(() => {
            const group = nodes[0];
            const expected = group.images.map(image => {
                const imported = appendImagesToSmartNode([image], '', {forceNew:true,point:{x:1200,y:1000}});
                const rect = nodeRect(imported);
                nodes = nodes.filter(node => node.id !== imported.id);
                return {width:rect.width, height:rect.height};
            });
            selectedId = group.id;
            selectedIds = [];
            selectedImage = {nodeId:'',index:-1};
            ungroupNode(group.id);
            return {expected, actual:nodes.map(node => ({...nodeRect(node),url:node.images[0].url,title:node.title}))};
        });
        assert.deepEqual(result.actual.map(({width,height}) => ({width,height})), result.expected);
        assert.deepEqual(result.actual.map(node => node.url), before[0].urls);
        for(let a=0; a<result.actual.length; a++) for(let b=a+1; b<result.actual.length; b++){
            const one=result.actual[a], two=result.actual[b];
            assert.ok(one.x+one.width+64<=two.x || two.x+two.width+64<=one.x || one.y+one.height+64<=two.y || two.y+two.height+64<=one.y,
                `Split images ${a} and ${b} must retain the shared 64-unit gap`);
        }
        assert.equal((await state()).length, 10);
        const saved = await page.evaluate(() => JSON.stringify(nodes));
        await page.evaluate(serialized => {nodes=JSON.parse(serialized);canvas.nodes=nodes;render();}, saved);
        assert.deepEqual(await page.evaluate(() => nodes.map(node => {
            const rect=nodeRect(node);return {width:rect.width,height:rect.height};
        })), result.expected);
    });
    await t.test('A standalone image still deletes as one node', async () => {
        await install(1);
        await page.locator('[data-id="image-group"] .image-wrap').click();
        await page.keyboard.press('Delete');
        assert.deepEqual(await state(), []);
    });
    assert.deepEqual(errors, []);
});
