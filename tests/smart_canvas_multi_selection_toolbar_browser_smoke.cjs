const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const context = await browser.newContext({viewport:{width:1440, height:900}});
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=multi-selection-toolbar-regression`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.viewportSelection?.selection
            && document.getElementById('smartNodeFloatingPortal')?.dataset.menuHtml !== undefined
        ));

        await page.evaluate(({imageUrl}) => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                nodes.splice(0, nodes.length,
                    {id:'multi-a', type:'smart-image', x:180, y:220, w:220, h:180, images:[{url:${JSON.stringify(imageUrl)}, name:'multi-a.png', kind:'image'}]},
                    {id:'multi-b', type:'smart-image', x:520, y:360, w:220, h:180, images:[{url:${JSON.stringify(imageUrl)}, name:'multi-b.png', kind:'image'}]}
                );
                canvas = {id:'multi-selection-toolbar-regression', nodes, connections:[], logs:[]};
                selectedId = '';
                selectedIds = ['multi-a', 'multi-b'];
                selectedImage = {nodeId:'', index:-1};
                viewport.x = 0;
                viewport.y = 0;
                viewport.scale = 1;
                render();
                window.SmartCanvasModules.viewportSelection.viewport.apply();
                syncSmartNodeFloatingPortal();
                window.SmartCanvasModules.viewportSelection.selection.refresh();
            })();`;
            document.body.appendChild(script);
            script.remove();
        }, {imageUrl:tinyPng});

        await page.waitForFunction(() => (
            document.querySelector('#smartNodeFloatingPortal ic-smart-node-toolbar[data-smart-multi-menu]')?.dataset.icContractStatus === 'ready'
            && [...document.querySelectorAll('#smartNodeFloatingPortal ic-button')]
                .every(button => button.dataset.icContractStatus === 'ready')
            && [...document.querySelectorAll('#smartNodeFloatingPortal ic-icon')]
                .every(icon => icon.dataset.iconStatus === 'ready')
            && document.getElementById('smartMultiSelectionBox')?.dataset.icContractStatus === 'ready'
        ));

        const state = await page.locator('#smartNodeFloatingPortal').evaluate(portal => ({
            open:portal.classList.contains('open'),
            tag:portal.querySelector('[data-smart-multi-menu]')?.localName,
            contract:portal.querySelector('[data-smart-multi-menu]')?.dataset.icContractStatus,
            label:portal.querySelector('[data-smart-multi-menu]')?.getAttribute('label'),
            nativeButtonCount:portal.querySelectorAll('button').length,
            buttonCount:portal.querySelectorAll('ic-button').length,
            layouts:[...portal.querySelectorAll('[data-smart-multi-layout]')].map(button => button.dataset.smartMultiLayout),
            actions:[...portal.querySelectorAll('[data-smart-multi-action]')].map(button => button.dataset.smartMultiAction),
            labels:[...portal.querySelectorAll('ic-button')].map(button => button.textContent.trim()),
            icons:[...portal.querySelectorAll('ic-button ic-icon')].map(icon => icon.getAttribute('name')),
            disabled:[...portal.querySelectorAll('ic-button')].map(button => button.disabled),
        }));
        assert.deepEqual(state, {
            open:true,
            tag:'ic-smart-node-toolbar',
            contract:'ready',
            label:'多选节点操作',
            nativeButtonCount:0,
            buttonCount:7,
            layouts:['grid', 'horizontal', 'vertical', 'tree-vertical', 'tree-horizontal'],
            actions:['generate', 'download', 'publish-workspace-assets'],
            labels:['生成图片/视频', '宫格', '水平', '垂直', '树状', '下载', '添加到资产库'],
            icons:['online-generate', 'layout-grid', 'layout-horizontal', 'layout-vertical', 'layout-tree', 'expand', 'download', 'collection'],
            disabled:[true, false, false, false, false, false, false],
        });

        const treeTrigger = page.locator('#smartNodeFloatingPortal [data-smart-tree-layout-trigger]');
        await treeTrigger.focus();
        await treeTrigger.press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-smart-tree-layout-menu]')?.hasAttribute('open'));
        const treeMenu = await page.locator('[data-smart-tree-layout-menu]').evaluate(menu => ({
            label:menu.getAttribute('label'),
            values:[...menu.querySelectorAll('ic-menu-item')].map(item => item.getAttribute('value')),
            labels:[...menu.querySelectorAll('ic-menu-item')].map(item => item.getAttribute('label')),
            focused:document.activeElement?.getAttribute('value'),
        }));
        assert.deepEqual(treeMenu, {
            label:'树状整理',
            values:['tree-vertical', 'tree-horizontal'],
            labels:['分支纵排', '分支横排'],
            focused:'tree-vertical',
        });
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[data-smart-tree-layout-menu]')?.hasAttribute('open'));
        assert.deepEqual(await page.evaluate(() => selectedIds.slice()), ['multi-a', 'multi-b']);
        await page.evaluate(() => window.StudioI18n.set('en'));
        await page.waitForFunction(() => (
            document.querySelector('[data-smart-tree-layout-trigger]')?.textContent.trim() === 'tree'
        ));
        assert.deepEqual(await page.locator('[data-smart-tree-layout-menu]').evaluate(menu => ({
            label:menu.getAttribute('label'),
            labels:[...menu.querySelectorAll('ic-menu-item')].map(item => item.getAttribute('label')),
        })), {
            label:'Tree arrangement',
            labels:['Vertical branches', 'Horizontal branches'],
        });
        await page.evaluate(() => window.StudioI18n.set('zh'));
        await page.waitForFunction(() => (
            document.querySelector('[data-smart-tree-layout-trigger]')?.textContent.trim() === '树状'
        ));
        await page.waitForTimeout(250);

        const selectionOverlay = await page.locator('#smartMultiSelectionBox').evaluate(overlay => {
            const style=getComputedStyle(overlay);
            const focusProbe=document.createElement('span');
            focusProbe.style.borderColor='var(--ui-color-border-focus)';
            document.body.appendChild(focusProbe);
            const expectedBorderColor=getComputedStyle(focusProbe).borderColor;
            focusProbe.remove();
            return {
                tag:overlay.localName,
                open:overlay.hasAttribute('open'),
                classOpen:overlay.classList.contains('open'),
                selectedIds:selectedIds.slice(),
                display:style.display,
                contract:overlay.dataset.icContractStatus,
                borderWidth:style.borderWidth,
                borderStyle:style.borderStyle,
                borderColor:style.borderColor,
                expectedBorderColor,
                shadowHandleCount:overlay.shadowRoot.querySelectorAll('[part~="handle"]').length,
                resizeHandleCount:overlay.shadowRoot.querySelectorAll('[part~="resize-handle"]').length,
            };
        });
        assert.deepEqual(selectionOverlay, {
            tag:'ic-canvas-multi-selection',
            open:true,
            classOpen:true,
            selectedIds:['multi-a', 'multi-b'],
            display:'block',
            contract:'ready',
            borderWidth:'2px',
            borderStyle:'solid',
            borderColor:selectionOverlay.expectedBorderColor,
            expectedBorderColor:selectionOverlay.expectedBorderColor,
            shadowHandleCount:4,
            resizeHandleCount:1,
        });

        const beforeResize = await page.evaluate(() => nodes.map(node => ({
            id:node.id,
            x:node.x,
            y:node.y,
            w:node.w,
            h:node.h,
        })));
        const resizeHandle = page.locator(
            '#smartMultiSelectionBox [part~="resize-handle"]'
        );
        const resizeHandleBox = await resizeHandle.boundingBox();
        assert.ok(resizeHandleBox, 'multi-selection resize handle should be visible');
        const selectionOverlayBox = await page.locator('#smartMultiSelectionBox').boundingBox();
        assert.ok(selectionOverlayBox, 'multi-selection overlay should be visible');
        const resizeDeltaX = selectionOverlayBox.width * 0.1;
        const resizeDeltaY = selectionOverlayBox.height * 0.1;
        await page.mouse.move(
            resizeHandleBox.x + resizeHandleBox.width / 2,
            resizeHandleBox.y + resizeHandleBox.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
            resizeHandleBox.x + resizeHandleBox.width / 2 + resizeDeltaX,
            resizeHandleBox.y + resizeHandleBox.height / 2 + resizeDeltaY,
            {steps:4},
        );
        await page.mouse.up();
        await page.waitForFunction(previous => nodes.every((node, index) => (
            node.w > previous[index].w && node.h > previous[index].h
        )), beforeResize);
        const resizeInteraction = await page.evaluate(previous => ({
            nodes:nodes.map((node, index) => ({
                id:node.id,
                grew:node.w > previous[index].w && node.h > previous[index].h,
            })),
            activeInteraction:window.SmartCanvasModules.canvasInteraction.active(),
        }), beforeResize);
        assert.deepEqual(resizeInteraction, {
            nodes:[
                {id:'multi-a', grew:true},
                {id:'multi-b', grew:true},
            ],
            activeInteraction:null,
        });

        await page.evaluate(() => {
            selectedId = '';
            selectedIds = nodes.map(node => node.id);
            syncSmartNodeFloatingPortal();
            window.SmartCanvasModules.viewportSelection.selection.refresh();
        });

        const themeStyles = {};
        for (const theme of ['light', 'dark']) {
            themeStyles[theme] = await page.evaluate(async activeTheme => {
                window.StudioTheme?.apply?.(activeTheme);
                document.documentElement.classList.toggle('theme-dark', activeTheme === 'dark');
                document.documentElement.classList.toggle('studio-theme-dark', activeTheme === 'dark');
                document.documentElement.dataset.uiTheme = activeTheme;
                document.documentElement.style.colorScheme = activeTheme;
                document.documentElement.style.setProperty(
                    '--ui-color-text-secondary',
                    activeTheme === 'dark'
                        ? 'rgb(229, 229, 229)'
                        : 'rgb(33, 33, 33)',
                );
                document.body.classList.toggle('theme-dark', activeTheme === 'dark');
                document.body.classList.toggle('studio-theme-dark', activeTheme === 'dark');
                const button = document.querySelector('#smartNodeFloatingPortal ic-button');
                const group = button.closest('ic-smart-node-toolbar');
                button.style.setProperty(
                    '--ui-color-text-secondary',
                    activeTheme === 'dark'
                        ? 'rgb(229, 229, 229)'
                        : 'rgb(33, 33, 33)',
                );
                await new Promise(resolve => setTimeout(resolve, 250));
                const base = button.shadowRoot.querySelector('[part="base"]');
                const icon = button.querySelector('ic-icon');
                const svg = icon.shadowRoot.querySelector('svg');
                return {
                    colorScheme:getComputedStyle(document.documentElement).colorScheme,
                    groupColor:getComputedStyle(group).color,
                    buttonColor:getComputedStyle(button).color,
                    subtitleToken:getComputedStyle(button).getPropertyValue('--ui-color-text-secondary').trim(),
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
                colorScheme:'light',
                groupColor:'rgb(33, 33, 33)',
                buttonColor:'rgb(33, 33, 33)',
                subtitleToken:'rgb(33, 33, 33)',
                fontSize:'12px',
                color:'rgb(33, 33, 33)',
                iconColor:'rgb(33, 33, 33)',
                iconStroke:'rgb(33, 33, 33)',
                iconStrokeWidth:'1.5px',
            },
            dark:{
                colorScheme:'dark',
                groupColor:'rgb(229, 229, 229)',
                buttonColor:'rgb(229, 229, 229)',
                subtitleToken:'rgb(229, 229, 229)',
                fontSize:'12px',
                color:'rgb(229, 229, 229)',
                iconColor:'rgb(229, 229, 229)',
                iconStroke:'rgb(229, 229, 229)',
                iconStrokeWidth:'1.5px',
            },
        });
        await page.locator('#smartNodeFloatingPortal [data-smart-multi-layout="horizontal"]').click();
        await page.waitForFunction(() => nodes.length === 2 && nodes[0].y === nodes[1].y);
        const horizontalLayout = await page.evaluate(() => ({
            sameRow:nodes[0].y === nodes[1].y,
            ordered:nodes[0].x < nodes[1].x,
            selectedIds:selectedIds.slice(),
        }));
        assert.deepEqual(horizontalLayout, {
            sameRow:true,
            ordered:true,
            selectedIds:['multi-a', 'multi-b'],
        });

        console.log(JSON.stringify({
            passed:true,
            state,
            selectionOverlay,
            resizeInteraction,
            themeStyles,
            horizontalLayout,
        }, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
