const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';

async function installSelection(page) {
    await page.evaluate(imageUrl => {
        const script = document.createElement('script');
        script.textContent = `(() => {
            nodes.splice(0, nodes.length,
                {id:'a',type:'smart-image',x:160,y:330,w:220,h:180,images:[{url:${JSON.stringify(imageUrl)},kind:'image'}]},
                {id:'b',type:'smart-image',x:500,y:100,w:220,h:180,images:[{url:${JSON.stringify(imageUrl)},kind:'image'}]},
                {id:'c',type:'smart-image',x:790,y:215,w:220,h:180,images:[{url:${JSON.stringify(imageUrl)},kind:'image'}]},
                {id:'d',type:'smart-image',x:1080,y:280,w:220,h:180,images:[{url:${JSON.stringify(imageUrl)},kind:'image'}]}
            );
            canvas.nodes = nodes;
            canvas.connections = [
                {from:'a',to:'c'},
                {from:'b',to:'c'},
                {from:'c',to:'d'}
            ];
            selectedId = '';
            selectedIds = ['a','b','c','d'];
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
    }, tinyPng);
    await page.waitForFunction(() => (
        document.querySelectorAll('#smartNodeFloatingPortal [data-smart-multi-layout]').length === 5
    ));
}

async function installGridSelection(page) {
    await page.evaluate(imageUrl => {
        const script = document.createElement('script');
        script.textContent = `(() => {
            nodes.splice(0, nodes.length, ...Array.from({length:8}, (_, index) => ({
                id:String.fromCharCode(97 + index),
                type:'smart-image',
                x:160 + (index % 4) * 252,
                y:100 + Math.floor(index / 4) * 212,
                w:220,
                h:180,
                images:[{url:${JSON.stringify(imageUrl)},kind:'image'}]
            })));
            canvas.nodes = nodes;
            canvas.connections = [];
            selectedId = '';
            selectedIds = nodes.map(node => node.id);
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
    }, tinyPng);
    await page.waitForFunction(() => (
        document.querySelectorAll('#smartNodeFloatingPortal [data-smart-multi-layout]').length === 5
    ));
}

async function installCrossBatchBranchSelection(page) {
    await page.evaluate(imageUrl => {
        const script = document.createElement('script');
        script.textContent = `(() => {
            nodes.splice(0, nodes.length,
                {id:'smart_bvn91r1u937s',type:'smart-image',x:160,y:330,w:172,h:259,
                    images:[{url:${JSON.stringify(imageUrl)},kind:'image'}]},
                {id:'smart_ylu93qelafr0',type:'smart-image',x:160,y:100,w:172,h:259,
                    images:[{url:${JSON.stringify(imageUrl)},kind:'image'}],
                    sourceNodeId:'smart_ylu93qelafr0',generationBatchSourceNodeId:'smart_e739igp3adty',
                    generationBatchId:'generation-batch_gap5t4gyafr0',inputNodeIds:['smart_bvn91r1u937s']},
                {id:'smart_b5tlimh6d1yb',type:'smart-image',x:500,y:330,w:172,h:259,
                    images:[{url:${JSON.stringify(imageUrl)},kind:'image'}],
                    generationBatchSourceNodeId:'smart_ylu93qelafr0',
                    generationBatchId:'generation-batch_s1bcwi1td1yb',inputNodeIds:['smart_bvn91r1u937s']}
            );
            canvas.nodes = nodes;
            canvas.connections = [
                {from:'smart_bvn91r1u937s',to:'smart_ylu93qelafr0'},
                {from:'smart_bvn91r1u937s',to:'smart_b5tlimh6d1yb'}
            ];
            selectedId = '';
            selectedIds = nodes.map(node => node.id);
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
    }, tinyPng);
    await page.waitForFunction(() => (
        document.querySelectorAll('#smartNodeFloatingPortal [data-smart-multi-layout]').length === 5
    ));
}

async function exactQuickAdd(page, fromPort, kind, point) {
    await page.evaluate(({imageUrl, fromPort, kind, point}) => {
        const script = document.createElement('script');
        script.textContent = `(() => {
            nodes.splice(0, nodes.length, {
                id:'source',type:'smart-image',x:280,y:240,w:220,h:180,
                images:[{url:${JSON.stringify(imageUrl)},kind:'image'}]
            });
            canvas.nodes = nodes;
            canvas.connections = [];
            selectedId = 'source';
            selectedIds = [];
            render();
            canvasMutation.history({action:'capture'});
            const drop = ${JSON.stringify(point)};
            handlePortDrop(
                {fromId:'source',fromPort:${JSON.stringify(fromPort)},moved:true,currentWorld:drop,sourceTrigger:null},
                {clientX:drop.x,clientY:drop.y,target:document.getElementById('shell')}
            );
            createReferencedNodeFromMenu(${JSON.stringify(kind)});
        })();`;
        document.body.appendChild(script);
        script.remove();
    }, {imageUrl:tinyPng, fromPort, kind, point});
    await page.waitForFunction(() => nodes.length === 2);
    return page.evaluate(({fromPort, point}) => {
        const created = nodes.find(node => node.id !== 'source');
        const rect = created.type === 'smart-prompt'
            ? {x:created.x,y:created.y,width:created.w,height:created.h}
            : nodeRect(created);
        return {
            anchorX:fromPort === 'in' ? rect.x + rect.width : rect.x,
            anchorY:rect.y + rect.height / 2,
            point,
            geometry:{type:created.type,x:created.x,y:created.y,w:created.w,h:created.h,rect},
            overlapAllowed:rect.x < 500 && rect.x + rect.width > 280,
        };
    }, {fromPort, point});
}

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const page = await browser.newPage({viewport:{width:1440,height:900}});
        page.setDefaultTimeout(20000);
        const runtimeErrors = [];
        page.on('pageerror', error => runtimeErrors.push(error.message));
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=issue-148-browser&manual=1`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            canvas?.id
            && window.SmartCanvasModules?.selectionArrangement?.plan
            && window.SmartCanvasModules?.canvasMutation?.arrange
            && document.getElementById('smartGenerationBatchLayoutControl')?.dataset.icContractStatus === 'ready'
        ));

        await page.locator('#smartSettingsToggle').click();
        const layoutControl = page.locator('#smartGenerationBatchLayoutControl');
        assert.equal(await layoutControl.getAttribute('value'), 'horizontal');
        assert.equal(await layoutControl.getAttribute('size'), 'small');
        assert.equal(await layoutControl.getAttribute('data-component-name'), 'ic-tabs-small');
        assert.equal(await layoutControl.locator('[data-value="horizontal"]').evaluate(tab => getComputedStyle(tab).fontSize), '12px');

        await layoutControl.locator('[data-value="vertical"]').click();
        await page.waitForFunction(() => smartGenerationBatchLayout === 'vertical');
        assert.equal(await page.evaluate(() => canvas.settings.generationBatchLayout), 'vertical');

        const verticalTab = layoutControl.locator('[data-value="vertical"]');
        await verticalTab.focus();
        await verticalTab.press('ArrowLeft');
        await page.waitForFunction(() => smartGenerationBatchLayout === 'horizontal');
        assert.equal(await page.evaluate(() => canvas.settings.generationBatchLayout), 'horizontal');

        await page.locator('#smartSettingsToggle').click();
        await installSelection(page);
        const entries = await page.locator('#smartNodeFloatingPortal [data-smart-multi-layout]').evaluateAll(buttons => (
            buttons.map(button => ({
                mode:button.dataset.smartMultiLayout,
                disabled:button.hasAttribute('disabled')
            }))
        ));
        assert.deepEqual(entries, [
            {mode:'grid',disabled:false},
            {mode:'horizontal',disabled:false},
            {mode:'vertical',disabled:false},
            {mode:'tree-vertical',disabled:false},
            {mode:'tree-horizontal',disabled:false},
        ]);

        await installGridSelection(page);
        await page.locator('[data-smart-multi-layout="grid"]').click();
        await page.waitForFunction(() => (
            new Set(nodes.map(node => node.x)).size === 4
            && new Set(nodes.map(node => node.y)).size === 2
        ));
        const grid = await page.evaluate(() => nodes.map(node => ({id:node.id,x:node.x,y:node.y})));
        assert.deepEqual(
            grid.slice().sort((left,right) => left.y - right.y || left.x - right.x).map(node => node.id),
            ['a','b','c','d','e','f','g','h']
        );

        await installSelection(page);
        await page.locator('[data-smart-multi-layout="horizontal"]').click();
        await page.waitForFunction(() => nodes.every(node => node.y === nodes[0].y));
        const horizontal = await page.evaluate(() => nodes.map(node => ({id:node.id,x:node.x,y:node.y})));
        assert.equal(new Set(horizontal.map(node => node.y)).size, 1);
        assert.deepEqual(
            horizontal.slice().sort((left,right) => left.x - right.x).map(node => node.id),
            ['a','b','c','d']
        );

        await installSelection(page);
        const treeTrigger = page.locator('[data-smart-tree-layout-trigger]');
        await treeTrigger.focus();
        await treeTrigger.press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-smart-tree-layout-menu]')?.hasAttribute('open'));
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => {
            const byId = Object.fromEntries(nodes.map(node => [node.id,node]));
            return byId.a.x === byId.b.x
                && byId.c.x > byId.a.x
                && byId.d.x > byId.c.x;
        });
        const tree = await page.evaluate(() => Object.fromEntries(nodes.map(node => {
            const rect = nodeRect(node);
            return [node.id,{
                x:node.x,
                centerY:node.y + rect.height / 2
            }];
        })));
        assert.ok(Math.abs(tree.c.centerY - (tree.a.centerY + tree.b.centerY) / 2) <= 1);
        assert.ok(Math.abs(tree.d.centerY - tree.c.centerY) <= 1);

        await installSelection(page);
        await treeTrigger.click();
        await page.locator('[data-smart-multi-layout="tree-horizontal"]').click();
        await page.waitForFunction(() => {
            const byId = Object.fromEntries(nodes.map(node => [node.id,node]));
            return byId.a.x === byId.b.x
                && byId.c.x > byId.b.x
                && byId.d.x > byId.c.x
                && byId.b.y === byId.c.y
                && byId.c.y === byId.d.y
                && byId.a.y > byId.b.y;
        });
        const horizontalTree = await page.evaluate(() => Object.fromEntries(nodes.map(node => {
            const rect = nodeRect(node);
            return [node.id,{
                x:node.x,
                centerY:node.y + rect.height / 2
            }];
        })));
        assert.equal(horizontalTree.a.x, horizontalTree.b.x);
        assert.ok(horizontalTree.c.x > horizontalTree.b.x);
        assert.ok(horizontalTree.d.x > horizontalTree.c.x);
        assert.ok(Math.abs(horizontalTree.b.centerY - horizontalTree.c.centerY) <= 1);
        assert.ok(Math.abs(horizontalTree.c.centerY - horizontalTree.d.centerY) <= 1);
        assert.ok(horizontalTree.a.centerY > horizontalTree.b.centerY);

        await installCrossBatchBranchSelection(page);
        await treeTrigger.click();
        await page.locator('[data-smart-multi-layout="tree-horizontal"]').click();
        await page.waitForFunction(() => {
            const byId = Object.fromEntries(nodes.map(node => [node.id,node]));
            const centers = nodes.map(node => node.y + nodeRect(node).height / 2);
            return Math.max(...centers) - Math.min(...centers) <= 1
                && byId['smart_bvn91r1u937s'].x < byId['smart_ylu93qelafr0'].x
                && byId['smart_ylu93qelafr0'].x < byId['smart_b5tlimh6d1yb'].x;
        });
        const crossBatchTree = await page.evaluate(() => Object.fromEntries(nodes.map(node => {
            const rect = nodeRect(node);
            return [node.id,{x:node.x,centerY:node.y + rect.height / 2}];
        })));
        assert.ok(Math.max(...Object.values(crossBatchTree).map(node => node.centerY))
            - Math.min(...Object.values(crossBatchTree).map(node => node.centerY)) <= 1);
        assert.ok(crossBatchTree['smart_bvn91r1u937s'].x < crossBatchTree['smart_ylu93qelafr0'].x);
        assert.ok(crossBatchTree['smart_ylu93qelafr0'].x < crossBatchTree['smart_b5tlimh6d1yb'].x);

        const theme = {};
        for (const name of ['light','dark']) {
            theme[name] = await page.evaluate(async value => {
                window.StudioTheme.apply(value);
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                const portal = document.getElementById('smartNodeFloatingPortal');
                const button = portal.querySelector('[data-smart-multi-layout]');
                return {
                    colorScheme:getComputedStyle(document.documentElement).colorScheme,
                    portalVisible:getComputedStyle(portal).visibility !== 'hidden',
                    buttonColor:getComputedStyle(button).color,
                };
            }, name);
            await page.screenshot({path:`/tmp/issue-148-${name}.png`,fullPage:false});
        }
        assert.equal(theme.light.colorScheme, 'light');
        assert.equal(theme.dark.colorScheme, 'dark');
        assert.equal(theme.light.portalVisible && theme.dark.portalVisible, true);
        assert.notEqual(theme.light.buttonColor, theme.dark.buttonColor);

        const quickAdd = [];
        for (const fromPort of ['out','in']) {
            for (const kind of ['text','image','video']) {
                const point = {x:fromPort === 'out' ? 500 : 300,y:330};
                const result = await exactQuickAdd(page, fromPort, kind, point);
                assert.ok(Math.abs(result.anchorX - point.x) <= 0.5, JSON.stringify({fromPort,kind,result}));
                assert.ok(Math.abs(result.anchorY - point.y) <= 0.5, JSON.stringify({fromPort,kind,result}));
                quickAdd.push({fromPort,kind,anchorX:result.anchorX,anchorY:result.anchorY});
            }
        }

        assert.deepEqual(runtimeErrors, []);
        console.log(JSON.stringify({passed:true,entries,grid,horizontal,tree,horizontalTree,crossBatchTree,theme,quickAdd,screenshots:['/tmp/issue-148-light.png','/tmp/issue-148-dark.png']}, null, 2));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
