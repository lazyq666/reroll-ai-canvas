const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    const context = await browser.newContext({viewport:{width:1440, height:900}});
    const page = await context.newPage();

    await page.goto(`${baseUrl}/static/smart-canvas.html?id=floating-menu-regression`, {
        waitUntil:'domcontentloaded',
    });
    await page.waitForFunction(() => Boolean(
        window.SmartCanvasModules?.viewportSelection?.selection
        && document.getElementById('smartNodeFloatingPortal')?.dataset.menuHtml !== undefined
    ));
    await page.waitForLoadState('networkidle');

    await page.evaluate(({imageUrl}) => {
        const script = document.createElement('script');
        script.textContent = `(() => {
            const id = 'browser-smart-image';
            nodes.splice(0, nodes.length, {
                id,
                type:'smart-image',
                x:240,
                y:220,
                w:320,
                h:240,
                images:[{
                    url:${JSON.stringify(imageUrl)},
                    name:'browser-probe.png',
                    kind:'image',
                    natural_w:1,
                    natural_h:1
                }]
            });
            selectedId = id;
            selectedIds = [];
            selectedImage = {nodeId:id, index:0};
            viewport.x = 0;
            viewport.y = 0;
            viewport.scale = 1;
            smartNodeFloatingPortal.style.visibility = 'hidden';
            syncSmartNodeFloatingPortal();
        })();`;
        document.body.appendChild(script);
        script.remove();
    }, {imageUrl:tinyPng});

    await page.waitForFunction(() => {
        const group = document.querySelector('#smartNodeFloatingPortal ic-smart-node-toolbar');
        const buttons = [...document.querySelectorAll('#smartNodeFloatingPortal ic-button')];
        return group?.dataset.icContractStatus === 'ready'
            && buttons.length === 7
            && buttons.every(button => button.dataset.icContractStatus === 'ready');
    });

    const state = await page.locator('#smartNodeFloatingPortal').evaluate(portal => ({
        open:portal.classList.contains('open'),
        viewportHidden:portal.classList.contains('viewport-hidden'),
        ariaHidden:portal.getAttribute('aria-hidden'),
        inlineVisibility:portal.style.visibility,
        computedVisibility:getComputedStyle(portal).visibility,
        hasMenu:Boolean(portal.querySelector('[data-smart-node-menu="1"]')),
        groupTag:portal.querySelector('[data-smart-node-menu="1"]')?.localName,
        groupContract:portal.querySelector('[data-smart-node-menu="1"]')?.dataset.icContractStatus,
        nativeButtonCount:portal.querySelectorAll('button').length,
        buttonCount:portal.querySelectorAll('ic-button').length,
        buttonContracts:[...portal.querySelectorAll('ic-button')].map(button => button.dataset.icContractStatus),
        dividerCount:portal.querySelectorAll('ic-divider[data-smart-node-divider]').length,
        actions:[...portal.querySelectorAll('[data-smart-node-action]')].map(button => button.dataset.smartNodeAction),
        labels:[...portal.querySelectorAll('[data-smart-node-action]')].map(button => button.textContent.trim()),
        icons:[...portal.querySelectorAll('[data-smart-node-action] ic-icon')].map(icon => icon.getAttribute('name')),
    }));

    assert.deepEqual(state, {
        open:true,
        viewportHidden:false,
        ariaHidden:'false',
        inlineVisibility:'',
        computedVisibility:'visible',
        hasMenu:true,
        groupTag:'ic-smart-node-toolbar',
        groupContract:'ready',
        nativeButtonCount:0,
        buttonCount:7,
        buttonContracts:['ready', 'ready', 'ready', 'ready', 'ready', 'ready', 'ready'],
        dividerCount:1,
        actions:['reverse-prompt', 'generate-image', 'matting', 'outpaint', 'angle-control', 'edit', 'download'],
        labels:['反推提示词', '生成图片/视频', '抠图', '扩图', '角度控制', '编辑', '下载'],
        icons:['reverse-prompt', 'online-generate', 'cut', 'fit', 'angle-control', 'edit', 'download'],
    });

    const tightTopPosition = await page.evaluate(() => {
        nodes[0].y = 30;
        syncSmartNodeFloatingPortal();
        return {
            placeBelow:smartNodeFloatingPortal.classList.contains('place-below'),
            top:smartNodeFloatingPortal.style.top,
        };
    });
    assert.deepEqual(tightTopPosition, {placeBelow:false, top:'22px'});
    await page.evaluate(() => {
        nodes[0].y = 220;
        syncSmartNodeFloatingPortal();
    });

    const themeStyles = {};
    for (const theme of ['light', 'dark']) {
        themeStyles[theme] = await page.evaluate(async activeTheme => {
            applyTheme(activeTheme);
            await new Promise(resolve => setTimeout(resolve, 250));
            const button = document.querySelector('#smartNodeFloatingPortal ic-button');
            const base = button.shadowRoot.querySelector('[part="base"]');
            const icon = button.querySelector('ic-icon');
            const svg = icon.shadowRoot.querySelector('svg');
            const styles = getComputedStyle(base);
            return {
                fontSize:styles.fontSize,
                color:styles.color,
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

    await page.locator('#smartNodeFloatingPortal [data-smart-node-action="edit"]').click();
    await page.waitForFunction(() => document.querySelector('#imageEditModal')?.classList.contains('open'));
    const editorState = await page.locator('#imageEditModal').evaluate(modal => ({
        open:modal.classList.contains('open'),
        activeMode:modal.querySelector('#imageEditModeTabs')?.getAttribute('value'),
        availableModes:[...modal.querySelectorAll('[data-image-edit-mode]')].map(button => button.dataset.imageEditMode),
    }));
    assert.equal(editorState.open, true);
    assert.equal(editorState.activeMode, 'preview');
    assert.deepEqual(editorState.availableModes, ['preview', 'crop', 'mask', 'brush', 'resize', 'grid']);
    await page.evaluate(() => window.SmartCanvasModules.imageStudio.close());

    await page.evaluate(() => {
        const script = document.createElement('script');
        script.textContent = `(() => {
            const id = 'browser-pending-generation';
            nodes.splice(0, nodes.length, {
                id,
                type:'smart-image',
                x:240,
                y:220,
                w:320,
                h:240,
                images:[],
                pending:1,
                running:true,
                runPrompt:'frozen prompt',
                runModelPrompt:'frozen prompt',
                runSettings:{engine:'api',apiKind:'image',count:1},
                generationInputSnapshot:{
                    prompt:'frozen prompt',
                    refs:[],
                    settings:{engine:'api',apiKind:'image',count:1}
                }
            });
            selectedId = id;
            selectedIds = [];
            selectedImage = {nodeId:'', index:-1};
            syncSmartNodeFloatingPortal();
        })();`;
        document.body.appendChild(script);
        script.remove();
    });
    await page.waitForFunction(() => (
        document.querySelector('#smartNodeFloatingPortal ic-smart-node-toolbar')?.dataset.icContractStatus === 'ready'
        && document.querySelectorAll('#smartNodeFloatingPortal ic-button').length === 2
    ));
    const pendingState = await page.locator('#smartNodeFloatingPortal').evaluate(portal => ({
        tag:portal.querySelector('[data-smart-node-menu="1"]')?.localName,
        actions:[...portal.querySelectorAll('[data-smart-node-action]')].map(button => button.dataset.smartNodeAction),
        labels:[...portal.querySelectorAll('[data-smart-node-action]')].map(button => button.textContent.trim()),
        icons:[...portal.querySelectorAll('[data-smart-node-action] ic-icon')].map(icon => icon.getAttribute('name')),
        disabled:[...portal.querySelectorAll('[data-smart-node-action]')].map(button => button.disabled),
    }));
    assert.deepEqual(pendingState, {
        tag:'ic-smart-node-toolbar',
        actions:['duplicate', 'regenerate'],
        labels:['创建副本', '再次生成'],
        icons:['create-copy', 'refresh'],
        disabled:[false, false],
    });

    await page.evaluate(({videoUrl}) => {
        const script = document.createElement('script');
        script.textContent = `(() => {
            const id = 'browser-smart-video';
            nodes.splice(0, nodes.length, {
                id,
                type:'smart-image',
                x:240,
                y:220,
                w:320,
                h:240,
                images:[{url:${JSON.stringify(videoUrl)}, name:'browser-probe.mp4', kind:'video'}]
            });
            selectedId = id;
            selectedIds = [];
            selectedImage = {nodeId:id, index:0};
            syncSmartNodeFloatingPortal();
        })();`;
        document.body.appendChild(script);
        script.remove();
    }, {videoUrl:tinyPng});
    await page.waitForFunction(() => (
        document.querySelector('#smartNodeFloatingPortal ic-smart-node-toolbar')?.dataset.icContractStatus === 'ready'
        && document.querySelectorAll('#smartNodeFloatingPortal ic-button').length === 3
    ));
    const videoState = await page.locator('#smartNodeFloatingPortal').evaluate(portal => ({
        tag:portal.querySelector('[data-smart-node-menu="1"]')?.localName,
        actions:[...portal.querySelectorAll('[data-smart-node-action]')].map(button => button.dataset.smartNodeAction),
        labels:[...portal.querySelectorAll('[data-smart-node-action]')].map(button => button.textContent.trim()),
        icons:[...portal.querySelectorAll('[data-smart-node-action] ic-icon')].map(icon => icon.getAttribute('name')),
    }));
    assert.deepEqual(videoState, {
        tag:'ic-smart-node-toolbar',
        actions:['video-play', 'extract-frame', 'download'],
        labels:['全屏播放', '截帧', '下载'],
        icons:['play', 'extract-frame', 'download'],
    });
    await page.locator('#smartNodeFloatingPortal [data-smart-node-action="video-play"]').click();
    await page.waitForFunction(() => document.querySelector('#imageEditModal')?.classList.contains('open'));
    const videoModalState = await page.locator('#imageEditModal').evaluate(modal => ({
        hasVisibleTitle:Boolean(modal.querySelector('#imageEditTitle, #imageEditSubtitle')),
        frameTools:getComputedStyle(modal.querySelector('#videoFrameTools')).display,
        modeBar:getComputedStyle(modal.querySelector('#imageEditModeToolbar')).display,
    }));
    assert.deepEqual(videoModalState, {hasVisibleTitle:false, frameTools:'flex', modeBar:'none'});
    await page.evaluate(() => window.SmartCanvasModules.imageStudio.close());

    await page.evaluate(() => {
        const script = document.createElement('script');
        script.textContent = `(() => {
            const id = 'browser-smart-text';
            nodes.splice(0, nodes.length, {id, type:'smart-prompt', x:240, y:220, text:'browser copied text', images:[]});
            selectedId = id;
            selectedIds = [];
            selectedImage = {nodeId:'', index:-1};
            syncSmartNodeFloatingPortal();
        })();`;
        document.body.appendChild(script);
        script.remove();
    });
    await page.waitForFunction(() => (
        document.querySelector('#smartNodeFloatingPortal > ic-smart-node-toolbar')?.dataset.icContractStatus === 'ready'
    ));
    const textState = await page.locator('#smartNodeFloatingPortal').evaluate(portal => ({
        tag:portal.querySelector('[data-smart-node-menu="1"]')?.localName,
        contract:portal.querySelector('[data-smart-node-menu="1"]')?.dataset.icContractStatus,
        actions:[...portal.querySelectorAll('[data-smart-node-action]')].map(button => button.dataset.smartNodeAction),
        labels:[...portal.querySelectorAll('[data-smart-node-action]')].map(button => button.textContent.trim()),
        icons:[...portal.querySelectorAll('[data-smart-node-action] ic-icon')].map(icon => icon.getAttribute('name')),
    }));
    assert.deepEqual(textState, {
        tag:'ic-smart-node-toolbar',
        contract:'ready',
        actions:['focus-editor', 'copy-text'],
        labels:['展开', '复制提示词'],
        icons:['focus-editor', 'copy'],
    });

    await page.evaluate(({imageUrl}) => {
        const script = document.createElement('script');
        script.textContent = `(() => {
            const id = 'browser-smart-group';
            nodes.splice(0, nodes.length, {
                id,
                type:'smart-group',
                title:'浏览器编组',
                x:240,
                y:220,
                w:360,
                h:260,
                items:[],
                images:[
                    {url:${JSON.stringify(imageUrl)}, name:'group-a.png', kind:'image'},
                    {url:${JSON.stringify(imageUrl)}, name:'group-b.png', kind:'image'}
                ]
            });
            selectedId = id;
            selectedIds = [];
            selectedImage = {nodeId:'', index:-1};
            syncSmartNodeFloatingPortal();
        })();`;
        document.body.appendChild(script);
        script.remove();
    }, {imageUrl:tinyPng});
    await page.waitForFunction(() => (
        document.querySelector('#smartNodeFloatingPortal ic-smart-node-toolbar[data-smart-group-menu]')?.dataset.icContractStatus === 'ready'
        && document.querySelectorAll('#smartNodeFloatingPortal [data-smart-group-action]').length === 5
    ));
    const groupState = await page.locator('#smartNodeFloatingPortal').evaluate(portal => ({
        tag:portal.querySelector('[data-smart-group-menu]')?.localName,
        contract:portal.querySelector('[data-smart-group-menu]')?.dataset.icContractStatus,
        label:portal.querySelector('[data-smart-group-menu]')?.getAttribute('label'),
        nativeButtonCount:portal.querySelectorAll('button').length,
        actions:[...portal.querySelectorAll('[data-smart-group-action]')].map(button => button.dataset.smartGroupAction),
        labels:[...portal.querySelectorAll('[data-smart-group-action]')].map(button => button.textContent.trim()),
        icons:[...portal.querySelectorAll('[data-smart-group-action] ic-icon')].map(icon => icon.getAttribute('name')),
        disabled:[...portal.querySelectorAll('[data-smart-group-action]')].map(button => button.disabled),
    }));
    assert.deepEqual(groupState, {
        tag:'ic-smart-node-toolbar',
        contract:'ready',
        label:'编组操作',
        nativeButtonCount:0,
        actions:['arrange', 'preview', 'grid', 'download', 'ungroup'],
        labels:['整理选中', '预览', '宫格拼接', '批量下载', '解散编组'],
        icons:['arrange', 'preview', 'join-grid', 'archive', 'ungroup'],
        disabled:[false, false, false, false, false],
    });
    await page.locator('#smartNodeFloatingPortal [data-smart-group-action="preview"]').click();
    await page.waitForFunction(() => document.querySelector('#imageEditModal')?.classList.contains('open'));
    const groupPreviewState = await page.locator('#imageEditModal').evaluate(modal => ({
        open:modal.classList.contains('open'),
        activeMode:modal.querySelector('#imageEditModeTabs')?.getAttribute('value'),
    }));
    assert.deepEqual(groupPreviewState, {open:true, activeMode:'preview'});
    await page.evaluate(() => window.SmartCanvasModules.imageStudio.close());

    await page.evaluate(({imageUrl}) => {
        const script = document.createElement('script');
        script.textContent = `(() => {
            nodes.splice(0, nodes.length,
                {id:'multi-a', type:'smart-image', x:180, y:220, w:220, h:180, images:[{url:${JSON.stringify(imageUrl)}, name:'multi-a.png', kind:'image'}]},
                {id:'multi-b', type:'smart-image', x:520, y:360, w:220, h:180, images:[{url:${JSON.stringify(imageUrl)}, name:'multi-b.png', kind:'image'}]}
            );
            selectedId = '';
            selectedIds = ['multi-a', 'multi-b'];
            selectedImage = {nodeId:'', index:-1};
            syncSmartNodeFloatingPortal();
        })();`;
        document.body.appendChild(script);
        script.remove();
    }, {imageUrl:tinyPng});
    await page.waitForFunction(() => (
        document.querySelector('#smartNodeFloatingPortal ic-smart-node-toolbar[data-smart-multi-menu]')?.dataset.icContractStatus === 'ready'
        && document.querySelectorAll('#smartNodeFloatingPortal [data-smart-multi-layout]').length === 4
    ));
    const multiState = await page.locator('#smartNodeFloatingPortal').evaluate(portal => ({
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
    assert.deepEqual(multiState, {
        tag:'ic-smart-node-toolbar',
        contract:'ready',
        label:'多选节点操作',
        nativeButtonCount:0,
        buttonCount:5,
        layouts:['grid', 'horizontal', 'vertical', 'tree'],
        actions:['download'],
        labels:['宫格', '水平', '垂直', '树状', '下载'],
        icons:['layout-grid', 'layout-horizontal', 'layout-vertical', 'layout-tree', 'download'],
        disabled:[false, false, false, false, false],
    });
    await page.locator('#smartNodeFloatingPortal [data-smart-multi-layout="horizontal"]').click();
    await page.waitForFunction(() => nodes.length === 2 && nodes[0].y === nodes[1].y);
    const horizontalLayout = await page.evaluate(() => ({
        sameRow:nodes[0].y === nodes[1].y,
        ordered:nodes[0].x < nodes[1].x,
        selectedIds:selectedIds.slice(),
    }));
    assert.deepEqual(horizontalLayout, {sameRow:true, ordered:true, selectedIds:['multi-a', 'multi-b']});

    await browser.close();
    console.log('Smart Canvas floating menu browser smoke passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
