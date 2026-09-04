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
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=smart-group-toolbar-regression`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.viewportSelection?.selection
            && window.SmartCanvasModules?.smartContainer
            && window.SmartCanvasModules?.imageStudio
            && document.getElementById('smartNodeFloatingPortal')?.dataset.menuHtml !== undefined
        ));

        await page.evaluate(({imageUrl}) => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                window.__installSmartGroupToolbarFixture = mode => {
                    const imageCount = mode === 'empty' ? 0 : mode === 'single' ? 1 : 2;
                    const images = Array.from({length:imageCount}, (_, index) => ({
                        url:${JSON.stringify(imageUrl)},
                        name:'group-' + (index + 1) + '.png',
                        kind:'image'
                    }));
                    const members = mode === 'full'
                        ? [
                            {id:'group-member-a', type:'smart-prompt', title:'提示词 A', text:'A', x:920, y:420, w:180, h:140, images:[]},
                            {id:'group-member-b', type:'smart-prompt', title:'提示词 B', text:'B', x:1120, y:560, w:180, h:140, images:[]}
                        ]
                        : [];
                    const group = {
                        id:'smart-group-a',
                        type:'smart-group',
                        title:'测试编组',
                        x:220,
                        y:190,
                        w:520,
                        h:340,
                        items:members.map(member => member.id),
                        images
                    };
                    nodes.splice(0, nodes.length, group, ...members);
                    canvas = {id:'smart-group-toolbar-regression', nodes, connections:[], logs:[]};
                    selectedId = group.id;
                    selectedIds = [];
                    selectedImage = {nodeId:'', index:-1};
                    viewport.x = 0;
                    viewport.y = 0;
                    viewport.scale = 1;
                    render();
                    syncSmartNodeFloatingPortal();
                };
                window.__installSmartGroupToolbarFixture('empty');
            })();`;
            document.body.appendChild(script);
            script.remove();
        }, {imageUrl:tinyPng});

        const waitForToolbar = () => page.waitForFunction(() => (
            document.querySelector('#smartNodeFloatingPortal ic-smart-node-toolbar[data-smart-group-menu]')?.dataset.icContractStatus === 'ready'
            && [...document.querySelectorAll('#smartNodeFloatingPortal [data-smart-group-action]')]
                .every(button => button.dataset.icContractStatus === 'ready')
        ));
        const readDisabled = () => page.locator('#smartNodeFloatingPortal').evaluate(portal => (
            [...portal.querySelectorAll('[data-smart-group-action]')].map(button => button.disabled)
        ));

        await waitForToolbar();
        const emptyDisabled = await readDisabled();
        assert.deepEqual(emptyDisabled, [true, true, true, true, false]);

        await page.evaluate(() => window.__installSmartGroupToolbarFixture('single'));
        await waitForToolbar();
        const singleDisabled = await readDisabled();
        assert.deepEqual(singleDisabled, [false, false, true, false, false]);

        await page.evaluate(() => window.__installSmartGroupToolbarFixture('full'));
        await waitForToolbar();
        const state = await page.locator('#smartNodeFloatingPortal').evaluate(portal => ({
            open:portal.classList.contains('open'),
            above:!portal.classList.contains('place-below'),
            tag:portal.querySelector('[data-smart-group-menu]')?.localName,
            contract:portal.querySelector('[data-smart-group-menu]')?.dataset.icContractStatus,
            label:portal.querySelector('[data-smart-group-menu]')?.getAttribute('label'),
            nativeButtonCount:portal.querySelectorAll('button').length,
            actions:[...portal.querySelectorAll('[data-smart-group-action]')].map(button => button.dataset.smartGroupAction),
            labels:[...portal.querySelectorAll('[data-smart-group-action]')].map(button => button.textContent.trim()),
            icons:[...portal.querySelectorAll('[data-smart-group-action] ic-icon')].map(icon => icon.getAttribute('name')),
            disabled:[...portal.querySelectorAll('[data-smart-group-action]')].map(button => button.disabled),
        }));
        assert.deepEqual(state, {
            open:true,
            above:true,
            tag:'ic-smart-node-toolbar',
            contract:'ready',
            label:'编组操作',
            nativeButtonCount:0,
            actions:['arrange', 'preview', 'grid', 'download', 'ungroup'],
            labels:['整理选中', '预览', '宫格拼接', '批量下载', '解散编组'],
            icons:['arrange', 'preview', 'join-grid', 'archive', 'ungroup'],
            disabled:[false, false, false, false, false],
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

        await page.locator('#smartNodeFloatingPortal [data-smart-group-action="preview"]').click();
        await page.waitForFunction(() => (
            document.querySelector('#imageEditModal')?.open
            && document.querySelector('#imageEditModal')?.dataset.motionState === 'open'
            && document.querySelector('#imageEditModal')?.classList.contains('open')
        ));
        const previewState = await page.locator('#imageEditModal').evaluate(modal => ({
            activeMode:modal.querySelector('#imageEditModeTabs')?.getAttribute('value'),
            metaHintExists:Boolean(modal.querySelector('#previewMetaHint')),
            groupHintHidden:modal.querySelector('#previewGroupNavHint')?.hidden,
            groupCount:modal.querySelector('#previewGroupNavCount')?.textContent.trim(),
        }));
        assert.deepEqual(previewState, {
            activeMode:'preview',
            metaHintExists:false,
            groupHintHidden:false,
            groupCount:'1 / 2',
        });
        await page.locator('#previewGroupNextBtn').click();
        await page.waitForFunction(() => document.querySelector('#previewGroupNavCount')?.textContent.trim() === '2 / 2');
        await page.locator('#previewGroupNextBtn').click();
        await page.waitForFunction(() => document.querySelector('#previewGroupNavCount')?.textContent.trim() === '1 / 2');
        await page.evaluate(() => window.SmartCanvasModules.imageStudio.close());
        await page.waitForFunction(() => !document.querySelector('#imageEditModal')?.hasAttribute('open'));

        await page.locator('#smartNodeFloatingPortal [data-smart-group-action="grid"]').click();
        await page.waitForFunction(() => (
            document.querySelector('#imageEditModal')?.open
            && document.querySelector('#imageEditModal')?.dataset.motionState === 'open'
            && document.querySelector('#imageEditModal')?.classList.contains('open')
            && document.querySelector('#imageEditModeTabs')?.getAttribute('value') === 'grid'
            && document.getElementById('gridOperationControl')?.getAttribute('value') === 'join'
        ));
        const gridState = await page.evaluate(() => ({
            activeMode:document.querySelector('#imageEditModeTabs')?.getAttribute('value'),
            joinActive:document.getElementById('gridOperationControl')?.getAttribute('value') === 'join',
            joinDisabled:document.getElementById('gridJoinModeBtn')?.disabled,
        }));
        assert.deepEqual(gridState, {activeMode:'grid', joinActive:true, joinDisabled:false});
        await page.evaluate(() => window.SmartCanvasModules.imageStudio.close());
        await page.waitForFunction(() => !document.querySelector('#imageEditModal')?.hasAttribute('open'));

        const beforeArrange = await page.evaluate(() => (
            nodes.filter(node => node.id.startsWith('group-member-'))
                .map(node => [node.id, node.x, node.y, node.w, node.h])
        ));
        await page.locator('#smartNodeFloatingPortal [data-smart-group-action="arrange"]').click();
        await page.waitForTimeout(100);
        const arranged = await page.evaluate(() => {
            const group = nodes.find(node => node.id === 'smart-group-a');
            return {
                items:group?.items?.slice(),
                imageCount:group?.images?.length,
                members:nodes.filter(node => node.id.startsWith('group-member-')).map(node => node.id),
                memberGeometry:nodes.filter(node => node.id.startsWith('group-member-'))
                    .map(node => [node.id, node.x, node.y, node.w, node.h]),
                memberOrder:group?.memberOrder?.map(entry => entry.kind),
            };
        });
        assert.deepEqual(arranged, {
            items:['group-member-a', 'group-member-b'],
            imageCount:2,
            members:['group-member-a', 'group-member-b'],
            memberGeometry:beforeArrange,
            memberOrder:['media', 'media', 'node', 'node'],
        });

        await page.locator('#smartNodeFloatingPortal [data-smart-group-action="ungroup"]').click();
        await page.waitForFunction(() => (
            !nodes.some(node => node.id === 'smart-group-a')
            && nodes.some(node => node.id === 'group-member-a')
            && nodes.some(node => node.id === 'group-member-b')
            && nodes.length === 4
        ));
        const ungroup = await page.evaluate(() => ({
            groupExists:nodes.some(node => node.id === 'smart-group-a'),
            originalMembers:nodes.filter(node => node.id.startsWith('group-member-')).map(node => node.id),
            originalMemberGeometry:nodes.filter(node => node.id.startsWith('group-member-'))
                .map(node => [node.id, node.x, node.y, node.w, node.h]),
            imageNodeCount:nodes.filter(node => node.type === 'smart-image').length,
            selectedCount:selectedIds.length,
        }));
        assert.deepEqual(ungroup, {
            groupExists:false,
            originalMembers:['group-member-a', 'group-member-b'],
            originalMemberGeometry:beforeArrange,
            imageNodeCount:2,
            selectedCount:4,
        });

        const imageAfterUngroup = await page.evaluate(() => {
            const node = nodes.find(candidate => candidate.type === 'smart-image');
            return {id:node.id,x:node.x,y:node.y};
        });
        const imageElement = page.locator(
            `.image-node[data-id="${imageAfterUngroup.id}"]`
        );
        const imageBox = await imageElement.boundingBox();
        assert.ok(imageBox);
        await page.mouse.move(imageBox.x + 12,imageBox.y + 12);
        await page.mouse.down();
        await page.mouse.move(imageBox.x + 92,imageBox.y + 72,{steps:4});
        await page.mouse.up();
        await page.waitForTimeout(350);
        const imageAfterDrag = await page.evaluate(id => {
            const node = nodes.find(candidate => candidate.id === id);
            return {id:node.id,x:node.x,y:node.y};
        },imageAfterUngroup.id);
        assert.deepEqual(imageAfterDrag,{
            id:imageAfterUngroup.id,
            x:imageAfterUngroup.x + 80,
            y:imageAfterUngroup.y + 60,
        });

        const libraryPage = await context.newPage();
        await libraryPage.goto(`${baseUrl}/static/design-system/infinite-canvas-ui/smart-node-toolbar.html`, {
            waitUntil:'domcontentloaded',
        });
        await libraryPage.waitForFunction(() => document.querySelector('[data-smart-node-toolbar-variant="smart-group"] ic-smart-node-toolbar')?.dataset.icContractStatus === 'ready');
        const libraryToolbar = libraryPage.locator('[data-smart-node-toolbar-variant="smart-group"] ic-smart-node-toolbar');
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
            buttonCount:5,
            icons:['arrange', 'preview', 'join-grid', 'archive', 'ungroup'],
            labels:['整理选中', '预览', '宫格拼接', '批量下载', '解散编组'],
        });
        const libraryStage = libraryPage.locator('[data-smart-node-toolbar-variant="smart-group"]');
        await libraryStage.screenshot({path:'/tmp/infinite-canvas-smart-group-toolbar-library.png'});
        await libraryPage.evaluate(async () => {
            document.documentElement.dataset.uiTheme = 'dark';
            document.documentElement.classList.add('theme-dark');
            document.documentElement.style.colorScheme = 'dark';
            await new Promise(resolve => setTimeout(resolve, 250));
        });
        await libraryStage.screenshot({path:'/tmp/infinite-canvas-smart-group-toolbar-library-dark.png'});

        console.log(JSON.stringify({
            passed:true,
            emptyDisabled,
            singleDisabled,
            state,
            themeStyles,
            previewState,
            gridState,
            arranged,
            ungroup,
            imageAfterUngroup,
            imageAfterDrag,
            libraryState,
        }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
