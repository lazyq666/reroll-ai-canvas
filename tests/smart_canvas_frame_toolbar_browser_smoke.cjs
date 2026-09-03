const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const context = await browser.newContext({viewport:{width:1440, height:900}});
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(`${baseUrl}/static/smart-canvas.html?componentReview=nodes`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            document.documentElement.dataset.nodesStatus === 'ready'
            && window.SmartCanvasModules?.viewportSelection?.selection
            && window.SmartCanvasModules?.smartContainer
            && document.getElementById('smartNodeFloatingPortal')?.dataset.menuHtml !== undefined
        ));

        await page.evaluate(({imageUrl}) => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                nodes.splice(0, nodes.length,
                    {id:'frame-a', type:'smart-frame', title:'旧分区', x:180, y:170, w:620, h:430, items:['frame-member'], frameColor:'blue'},
                    {id:'frame-member', type:'smart-image', x:300, y:280, w:220, h:180, images:[{url:${JSON.stringify(imageUrl)}, name:'member.png', kind:'image'}]}
                );
                canvas = {id:'frame-toolbar-regression', nodes, connections:[], logs:[]};
                selectedId = 'frame-a';
                selectedIds = [];
                selectedImage = {nodeId:'', index:-1};
                viewport.x = 0;
                viewport.y = 0;
                viewport.scale = 1;
                window.SmartCanvasModules.viewportSelection.viewport.apply();
                render();
                syncSmartNodeFloatingPortal();
            })();`;
            document.body.appendChild(script);
            script.remove();
        }, {imageUrl:tinyPng});

        await page.waitForFunction(() => smartCanvasDetailRecoveryReady === null);
        await page.evaluate(() => render());

        await page.waitForFunction(() => (
            document.querySelector('#smartNodeFloatingPortal ic-smart-node-toolbar[data-smart-frame-menu]')?.dataset.icContractStatus === 'ready'
            && [...document.querySelectorAll('#smartNodeFloatingPortal [data-smart-frame-action]')]
                .every(button => button.dataset.icContractStatus === 'ready')
        ));

        const state = await page.locator('#smartNodeFloatingPortal').evaluate(portal => ({
            open:portal.classList.contains('open'),
            above:!portal.classList.contains('place-below'),
            tag:portal.querySelector('[data-smart-frame-menu]')?.localName,
            contract:portal.querySelector('[data-smart-frame-menu]')?.dataset.icContractStatus,
            label:portal.querySelector('[data-smart-frame-menu]')?.getAttribute('label'),
            nativeButtonCount:portal.querySelectorAll('button').length,
            actions:[...portal.querySelectorAll('[data-smart-frame-action]')].map(button => button.dataset.smartFrameAction),
            labels:[...portal.querySelectorAll('[data-smart-frame-action]')].map(button => button.textContent.trim()),
            icons:[...portal.querySelectorAll('[data-smart-frame-action] ic-icon')].map(icon => icon.getAttribute('name')),
        }));
        assert.deepEqual(state, {
            open:true,
            above:true,
            tag:'ic-smart-node-toolbar',
            contract:'ready',
            label:'分区操作',
            nativeButtonCount:0,
            actions:['rename', 'color', 'download', 'ungroup'],
            labels:['重命名分区', '切换颜色', '下载', '取消分区'],
            icons:['edit', 'color', 'download', 'ungroup-frame'],
        });

        const themeStyles = {};
        for (const theme of ['light', 'dark']) {
            themeStyles[theme] = await page.evaluate(async activeTheme => {
                document.documentElement.classList.toggle('theme-dark', activeTheme === 'dark');
                document.documentElement.classList.toggle('studio-theme-dark', activeTheme === 'dark');
                document.documentElement.dataset.uiTheme = activeTheme;
                document.documentElement.style.colorScheme = activeTheme;
                document.body.classList.toggle('theme-dark', activeTheme === 'dark');
                document.body.classList.toggle('studio-theme-dark', activeTheme === 'dark');
                await new Promise(resolve => setTimeout(resolve, 250));
                const button = document.querySelector('#smartNodeFloatingPortal ic-button');
                const base = button.shadowRoot.querySelector('[part="base"]');
                const icon = button.querySelector('ic-icon');
                const svg = icon.shadowRoot.querySelector('svg');
                return {
                    fontSize:getComputedStyle(base).fontSize,
                    color:getComputedStyle(base).color,
                    iconColor:getComputedStyle(icon).color,
                    iconStroke:getComputedStyle(svg).stroke,
                    iconStrokeWidth:getComputedStyle(svg).strokeWidth,
                };
            }, theme);
        }
        assert.deepEqual(themeStyles, {
            light:{
                fontSize:'12px',
                color:'rgb(64, 64, 64)',
                iconColor:'rgb(64, 64, 64)',
                iconStroke:'rgb(64, 64, 64)',
                iconStrokeWidth:'1.5px',
            },
            dark:{
                fontSize:'12px',
                color:'rgb(212, 212, 212)',
                iconColor:'rgb(212, 212, 212)',
                iconStroke:'rgb(212, 212, 212)',
                iconStrokeWidth:'1.5px',
            },
        });

        await page.locator('#smartNodeFloatingPortal [data-smart-frame-action="rename"]').click();
        await page.waitForFunction(() => document.querySelector('.image-node[data-id="frame-a"] .node-title')?.isContentEditable);
        await page.locator('.image-node[data-id="frame-a"] .node-title').evaluate(title => {
            title.textContent = '新分区';
        });
        await page.locator('#smartNodeFloatingPortal [data-smart-frame-action="color"]').click();
        await page.waitForFunction(() => {
            const frame = nodes.find(node => node.id === 'frame-a');
            return frame?.title === '新分区' && frame?.frameColor === 'violet';
        });
        const editAndColor = await page.evaluate(() => {
            const frame = nodes.find(node => node.id === 'frame-a');
            const title = document.querySelector('.image-node[data-id="frame-a"] .node-title');
            return {
                title:frame?.title,
                frameColor:frame?.frameColor,
                contentEditable:title?.getAttribute('contenteditable'),
                visibleTitle:title?.childNodes?.[0]?.textContent,
            };
        });
        assert.deepEqual(editAndColor, {
            title:'新分区',
            frameColor:'violet',
            contentEditable:null,
            visibleTitle:'新分区',
        });

        await page.locator('#smartNodeFloatingPortal [data-smart-frame-action="ungroup"]').click();
        await page.waitForFunction(() => (
            !nodes.some(node => node.id === 'frame-a')
            && nodes.some(node => node.id === 'frame-member')
        ));
        const ungroup = await page.evaluate(() => ({
            frameExists:nodes.some(node => node.id === 'frame-a'),
            memberExists:nodes.some(node => node.id === 'frame-member'),
            memberCount:nodes.length,
        }));
        assert.deepEqual(ungroup, {
            frameExists:false,
            memberExists:true,
            memberCount:1,
        });

        await page.evaluate(({imageUrl}) => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                nodes.splice(0, nodes.length,
                    {id:'wrap-a', type:'smart-image', title:'A', x:120, y:120, w:220, h:170, images:[{url:${JSON.stringify(imageUrl)}, kind:'image'}]},
                    {id:'wrap-b', type:'smart-image', title:'B', x:420, y:200, w:240, h:190, images:[{url:${JSON.stringify(imageUrl)}, kind:'image'}]}
                );
                canvas = {id:'frame-toolbar-regression', nodes, connections:[], logs:[]};
                selectedId = '';
                selectedIds = ['wrap-a', 'wrap-b'];
                selectedImage = {nodeId:'', index:-1};
                render();
                window.SmartCanvasModules.viewportSelection.selection.refresh();
            })();`;
            document.body.appendChild(script);
            script.remove();
        }, {imageUrl:tinyPng});
        await page.locator('.image-node.selected').first().click({button:'right', force:true});
        await page.waitForFunction(() => document.getElementById('smartNodeContextMenu')?.hasAttribute('open'));
        await page.locator('#smartNodeContextMenu > ic-menu-item[value="frame-selection"]').click();
        await page.waitForFunction(() => (
            nodes.some(node => node.type === 'smart-frame')
            || [...document.querySelectorAll('ic-toast')].some(toast => (
                toast.textContent.includes('Canvas Mutation create requires placement or exact mode')
            ))
        ));
        const wrappedSelection = await page.evaluate(() => {
            const frame = nodes.find(node => node.type === 'smart-frame');
            const members = nodes.filter(node => ['wrap-a', 'wrap-b'].includes(node.id));
            return {
                frameCount:nodes.filter(node => node.type === 'smart-frame').length,
                items:frame?.items || [],
                containsSelection:Boolean(frame && members.every(node => (
                    frame.x <= node.x
                    && frame.y <= node.y
                    && frame.x + frame.w >= node.x + node.w
                    && frame.y + frame.h >= node.y + node.h
                ))),
                exactModeError:[...document.querySelectorAll('ic-toast')].some(toast => (
                    toast.textContent.includes('Canvas Mutation create requires placement or exact mode')
                )),
            };
        });
        assert.deepEqual(wrappedSelection, {
            frameCount:1,
            items:['wrap-a', 'wrap-b'],
            containsSelection:true,
            exactModeError:false,
        });
        await page.evaluate(() => {
            nodes.splice(0, nodes.length);
            selectedId = '';
            selectedIds = [];
            selectedImage = {nodeId:'', index:-1};
            render();
            window.SmartCanvasModules.viewportSelection.selection.refresh();
        });

        const defaultFrame = await page.evaluate(() => {
            const created = window.SmartCanvasModules.canvasMutation.create({
                kind:'frame',
                data:{x:720,y:220},
                options:{positionMode:'exact',skipUndo:true,save:false,select:false},
            });
            const element = document.querySelector(`.image-node[data-id="${created.id}"]`);
            return {
                title:created.title,
                frameColor:created.frameColor,
                dataFrameColor:element?.dataset.frameColor,
                frameRgb:getComputedStyle(element).getPropertyValue('--frame-rgb').replace(/\s/g, ''),
            };
        });
        assert.deepEqual(defaultFrame, {
            title:'分区 1',
            frameColor:'slate',
            dataFrameColor:'slate',
            frameRgb:'100,116,139',
        });

        const legacyTitles = await page.evaluate(() => {
            const script = document.createElement('script');
            script.textContent = `window.__legacyContainerTitles = [
                {type:'smart-group', title:'智能分组'},
                {type:'smart-group', title:'Smart Group'},
                {type:'smart-frame', title:'画布 3'},
                {type:'smart-frame', title:'Frame 4'},
                {type:'smart-frame', title:'自定义标题'},
            ].map(node => normalizeLegacySmartNode({...node}).title);`;
            document.body.appendChild(script);
            script.remove();
            return window.__legacyContainerTitles;
        });
        assert.deepEqual(legacyTitles, ['编组', '编组', '分区 3', '分区 4', '自定义标题']);

        const libraryPage = await context.newPage();
        await libraryPage.goto(`${baseUrl}/static/design-system/infinite-canvas-ui/smart-node-toolbar.html`, {
            waitUntil:'domcontentloaded',
        });
        await libraryPage.waitForFunction(() => document.querySelector('[data-smart-node-toolbar-variant="frame"] ic-smart-node-toolbar')?.dataset.icContractStatus === 'ready');
        const libraryToolbar = libraryPage.locator('[data-smart-node-toolbar-variant="frame"] ic-smart-node-toolbar');
        await libraryToolbar.scrollIntoViewIfNeeded();
        const libraryState = await libraryToolbar.evaluate(toolbar => {
            return {
                contract:toolbar.dataset.icContractStatus,
                buttonCount:toolbar.querySelectorAll('ic-button').length,
                icons:[...toolbar.querySelectorAll('ic-icon')].map(icon => icon.getAttribute('name')),
                labels:[...toolbar.querySelectorAll('ic-button')].map(button => button.textContent.trim()),
            };
        });
        assert.deepEqual(libraryState, {
            contract:'ready',
            buttonCount:4,
            icons:['edit', 'color', 'download', 'ungroup-frame'],
            labels:['重命名分区', '切换颜色', '下载', '取消分区'],
        });
        await libraryPage.locator('[data-smart-node-toolbar-variant="frame"]').screenshot({
            path:'/tmp/infinite-canvas-frame-toolbar-library.png',
        });
        await libraryPage.evaluate(async () => {
            document.documentElement.dataset.uiTheme = 'dark';
            document.documentElement.classList.add('theme-dark');
            document.documentElement.style.colorScheme = 'dark';
            await new Promise(resolve => setTimeout(resolve, 250));
        });
        await libraryPage.locator('[data-smart-node-toolbar-variant="frame"]').screenshot({
            path:'/tmp/infinite-canvas-frame-toolbar-library-dark.png',
        });

        console.log(JSON.stringify({passed:true, state, themeStyles, editAndColor, ungroup, defaultFrame, legacyTitles, libraryState}, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
