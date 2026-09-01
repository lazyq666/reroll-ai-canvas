const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const context = await browser.newContext({viewport:{width:1440, height:900}});
        let canvasId = 'node-runtime-status-regression';
        if (process.env.SMART_CANVAS_TEST_USERNAME && process.env.SMART_CANVAS_TEST_PASSWORD) {
            const response = await context.request.post(`${baseUrl}/api/auth/login`, {
                data:{
                    username:process.env.SMART_CANVAS_TEST_USERNAME,
                    password:process.env.SMART_CANVAS_TEST_PASSWORD,
                },
            });
            assert.equal(response.ok(), true, `test login failed: ${response.status()}`);
            const created = await context.request.post(`${baseUrl}/api/canvases`, {
                data:{title:'Node runtime status regression'},
            });
            assert.equal(created.ok(), true, `test canvas creation failed: ${created.status()}`);
            canvasId = (await created.json()).canvas.id;
        }
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=${encodeURIComponent(canvasId)}`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.viewportSelection?.selection
            && customElements.get('ic-badge')
            && document.getElementById('smartNodeFloatingPortal')?.dataset.menuHtml !== undefined
        ));
        await page.waitForFunction(expectedId => typeof canvas !== 'undefined'
            && canvas?.id === expectedId, canvasId);

        await page.evaluate(activeCanvasId => {
            const script = document.createElement('script');
            script.textContent = `(() => {
                window.__installNodeRuntimeFixture = () => {
                    const runtimeNode = {
                        id:'runtime-node-a',
                        type:'smart-image',
                        title:'运行耗时测试',
                        x:360,
                        y:250,
                        w:260,
                        h:180,
                        images:[],
                        outputKind:'video',
                        pending:true,
                        runStartedAt:Date.now() - 2200,
                        runTimerHidden:false
                    };
                    const textPendingNode = {
                        id:'text-pending-node-a',
                        type:'smart-prompt',
                        title:'文字',
                        x:760,
                        y:250,
                        w:360,
                        h:260,
                        images:[],
                        textGenerationOutput:true,
                        textGenerationPending:true,
                        running:true,
                        runStartedAt:Date.now() - 2200,
                        runTimerHidden:false
                    };
                    nodes.splice(0, nodes.length, runtimeNode, textPendingNode);
                    canvas = {id:${JSON.stringify(activeCanvasId)}, nodes, connections:[], logs:[]};
                    selectedId = runtimeNode.id;
                    selectedIds = [];
                    viewport.x = 0;
                    viewport.y = 0;
                    viewport.scale = 1;
                    window.SmartCanvasModules.viewportSelection.viewport.apply({persist:false});
                    render();
                };
                window.__completeNodeRuntimeFixture = () => {
                    const runtimeNode = nodes.find(node => node.id === 'runtime-node-a');
                    runtimeNode.pending = false;
                    runtimeNode.runFinishedAt = Date.now();
                    runtimeNode.runElapsedMs = runtimeNode.runFinishedAt - runtimeNode.runStartedAt;
                    render();
                };
                window.__hideNodeRuntimeFixture = () => {
                    const runtimeNode = nodes.find(node => node.id === 'runtime-node-a');
                    hideRunTimerForNode(runtimeNode);
                    render();
                };
                window.__installNodeRuntimeFixture();
            })();`;
            document.body.appendChild(script);
            script.remove();
        }, canvasId);

        const pendingBadge = page.locator('.image-node[data-id="runtime-node-a"] ic-generation-pending').locator('ic-badge.generation-pending-badge');
        await page.waitForFunction(() => {
            const pending = document.querySelector('.image-node[data-id="runtime-node-a"] ic-generation-pending');
            const badge = pending?.shadowRoot?.querySelector('ic-badge.generation-pending-badge');
            return badge?.dataset.icContractStatus === 'ready'
                && badge?.shadowRoot?.querySelector('.spinner');
        });
        const pendingContinuity = await page.evaluate(() => {
            const runtimeNode = nodes.find(node => node.id === 'runtime-node-a');
            const firstNode = document.querySelector('.image-node[data-id="runtime-node-a"]');
            const firstPending = firstNode.querySelector('ic-generation-pending');
            const firstCanvas = firstPending.shadowRoot.querySelector('.generation-pending-halftone');
            runtimeNode.pending = 0;
            runtimeNode.queued = true;
            render();
            const queuedNode = document.querySelector('.image-node[data-id="runtime-node-a"]');
            const queuedPending = queuedNode.querySelector('ic-generation-pending');
            const queuedCanvas = queuedPending.shadowRoot.querySelector('.generation-pending-halftone');
            runtimeNode.queued = false;
            runtimeNode.pending = 1;
            render();
            const generatingNode = document.querySelector('.image-node[data-id="runtime-node-a"]');
            const generatingPending = generatingNode.querySelector('ic-generation-pending');
            const generatingCanvas = generatingPending.shadowRoot.querySelector('.generation-pending-halftone');
            const firstTimer = generatingPending.shadowRoot.querySelector('ic-badge.generation-pending-badge');
            const firstTimerSpinner = firstTimer?.shadowRoot?.querySelector('.spinner');
            runtimeNode.title = '运行耗时测试 · 刷新一';
            render();
            const refreshedNode = document.querySelector('.image-node[data-id="runtime-node-a"]');
            const refreshedTimer = refreshedNode.querySelector('ic-generation-pending')?.shadowRoot.querySelector('ic-badge.generation-pending-badge');
            const refreshedTimerSpinner = refreshedTimer?.shadowRoot?.querySelector('.spinner');
            runtimeNode.title = '运行耗时测试 · 刷新二';
            render();
            const rerenderedTimer = document.querySelector('.image-node[data-id="runtime-node-a"] ic-generation-pending')?.shadowRoot.querySelector('ic-badge.generation-pending-badge');
            const rerenderedTimerSpinner = rerenderedTimer?.shadowRoot?.querySelector('.spinner');
            return {
                sameNode:firstNode === queuedNode && queuedNode === generatingNode,
                samePending:firstPending === queuedPending && queuedPending === generatingPending,
                sameCanvas:firstCanvas === queuedCanvas && queuedCanvas === generatingCanvas,
                state:generatingPending.getAttribute('state'),
                motionState:generatingCanvas.dataset.motionState,
                labelVisible:firstTimer.getBoundingClientRect().width > 0,
                sameTimer:firstTimer === refreshedTimer && refreshedTimer === rerenderedTimer,
                sameTimerSpinner:firstTimerSpinner === refreshedTimerSpinner && refreshedTimerSpinner === rerenderedTimerSpinner,
            };
        });
        assert.deepEqual(pendingContinuity, {
            sameNode:true,
            samePending:true,
            sameCanvas:true,
            state:'generating',
            motionState:'running',
            labelVisible:true,
            sameTimer:true,
            sameTimerSpinner:true,
        });
        const textPendingPresentation = await page.locator('.image-node[data-id="text-pending-node-a"] ic-generation-pending').evaluate(element => {
            const card = element.closest('.prompt-text-generation-card');
            const pending = element.shadowRoot.querySelector('.pending');
            const canvas = element.shadowRoot.querySelector('.generation-pending-halftone');
            const badge = element.shadowRoot.querySelector('ic-badge.generation-pending-badge');
            const bounds = node => node.getBoundingClientRect();
            const hostBounds = bounds(element);
            const cardBounds = bounds(card);
            return {
                kind:element.getAttribute('kind'),
                host:[hostBounds.width,hostBounds.height],
                hostFillsCard:Math.abs(hostBounds.width-cardBounds.width)<0.5
                    && Math.abs(hostBounds.height-cardBounds.height)<0.5,
                pending:[bounds(pending).width,bounds(pending).height],
                canvas:[bounds(canvas).width,bounds(canvas).height],
                canvasPixels:[canvas.width,canvas.height],
                label:badge.textContent.trim(),
                labelVisible:bounds(badge).width > 0 && bounds(badge).height > 0,
                labelOutside:bounds(badge).bottom <= bounds(pending).top + 1,
                background:getComputedStyle(pending).backgroundColor,
                expectedDot:getComputedStyle(canvas).color,
                halftoneBackground:canvas.dataset.halftoneBackground,
                halftoneDot:canvas.dataset.halftoneDot,
            };
        });
        assert.equal(textPendingPresentation.kind, 'text');
        assert.equal(textPendingPresentation.host[0] > 280, true);
        assert.equal(textPendingPresentation.host[1] > 200, true);
        assert.equal(textPendingPresentation.hostFillsCard, true);
        assert.deepEqual(textPendingPresentation.pending, textPendingPresentation.host);
        assert.deepEqual(textPendingPresentation.canvas, textPendingPresentation.host);
        assert.equal(textPendingPresentation.canvasPixels[0] > 0, true);
        assert.equal(textPendingPresentation.canvasPixels[1] > 0, true);
        assert.equal(textPendingPresentation.label.length > 0, true);
        assert.equal(textPendingPresentation.labelVisible, true);
        assert.equal(textPendingPresentation.labelOutside, true);
        assert.notEqual(textPendingPresentation.background, 'rgba(0, 0, 0, 0)');
        assert.equal(textPendingPresentation.halftoneBackground, textPendingPresentation.background);
        assert.equal(textPendingPresentation.halftoneDot, textPendingPresentation.expectedDot);
        const running = await pendingBadge.evaluate(element => ({
            tag:element.localName,
            kind:element.getAttribute('kind'),
            tone:element.getAttribute('tone'),
            loading:element.hasAttribute('loading'),
            state:element.getRootNode().host.getAttribute('state'),
            role:element.getAttribute('role'),
            contract:element.dataset.icContractStatus,
            text:element.textContent.trim(),
            spinner:Boolean(element.shadowRoot.querySelector('.spinner')),
            spinnerDuration:getComputedStyle(element.shadowRoot.querySelector('.spinner')).animationDuration,
            outside:element.classList.contains('generation-pending-badge'),
        }));
        assert.equal(running.tag, 'ic-badge');
        assert.equal(running.kind, 'status');
        assert.equal(running.tone, 'info');
        assert.equal(running.loading, true);
        assert.equal(running.state, 'generating');
        assert.equal(running.role, 'status');
        assert.equal(running.contract, 'ready');
        assert.equal(running.spinner, true);
        assert.equal(running.spinnerDuration, '1.2s');
        assert.equal(running.outside, true);
        assert.match(running.text, /^\d+s 正在生成视频…$/);

        const firstSeconds = Number.parseInt(running.text, 10);
        await page.waitForFunction(previous => {
            const pending = document.querySelector('.image-node[data-id="runtime-node-a"] ic-generation-pending');
            const text = pending?.shadowRoot?.querySelector('ic-badge.generation-pending-badge')?.textContent || '';
            return Number.parseInt(text, 10) > previous;
        }, firstSeconds);

        const themeStyles = {};
        for (const theme of ['light', 'dark']) {
            themeStyles[theme] = await page.evaluate(async activeTheme => {
                document.documentElement.classList.toggle('theme-dark', activeTheme === 'dark');
                document.documentElement.classList.toggle('studio-theme-dark', activeTheme === 'dark');
                document.documentElement.dataset.uiTheme = activeTheme;
                document.documentElement.style.colorScheme = activeTheme;
                document.body.classList.toggle('theme-dark', activeTheme === 'dark');
                document.body.classList.toggle('studio-theme-dark', activeTheme === 'dark');
                await new Promise(resolve => setTimeout(resolve, 100));
                const pending = document.querySelector('.image-node[data-id="runtime-node-a"] ic-generation-pending');
                const timer = pending.shadowRoot.querySelector('ic-badge.generation-pending-badge');
                const base = timer.shadowRoot.querySelector('[part="base"]');
                const spinner = timer.shadowRoot.querySelector('.spinner');
                const style = getComputedStyle(base);
                const hostStyle = getComputedStyle(timer);
                const probe = document.createElement('span');
                probe.style.cssText = 'position:absolute;color:var(--ui-color-text-secondary)';
                document.body.append(probe);
                const expectedColor = getComputedStyle(probe).color;
                probe.remove();
                return {
                    color:style.color,
                    backgroundColor:style.backgroundColor,
                    spinnerColor:getComputedStyle(spinner).color,
                    expectedColor,
                    left:hostStyle.left,
                    top:hostStyle.top,
                    minHeight:style.minHeight,
                    fontSize:style.fontSize,
                    fontWeight:style.fontWeight,
                    shadow:style.boxShadow,
                };
            }, theme);
            await page.screenshot({
                path:`/tmp/smart-canvas-node-runtime-status-${theme}.png`,
                clip:{x:300, y:180, width:420, height:330},
            });
        }
        for (const theme of ['light', 'dark']) {
            assert.equal(themeStyles[theme].color, themeStyles[theme].expectedColor);
            assert.equal(themeStyles[theme].spinnerColor, themeStyles[theme].expectedColor);
            assert.equal(themeStyles[theme].backgroundColor, 'rgba(0, 0, 0, 0)');
            assert.equal(themeStyles[theme].left, '0px');
            assert.equal(themeStyles[theme].top, '-20px');
            assert.equal(themeStyles[theme].minHeight, '14px');
            assert.equal(themeStyles[theme].fontSize, '12px');
            assert.equal(themeStyles[theme].fontWeight, '400');
            assert.equal(themeStyles[theme].shadow, 'none');
        }

        await page.evaluate(() => window.__completeNodeRuntimeFixture());
        await page.waitForFunction(() => {
            const timer = document.querySelector('[data-run-timer="runtime-node-a"]');
            return timer?.dataset.runTimerState === 'complete'
                && timer.getAttribute('tone') === 'neutral'
                && !timer.hasAttribute('loading')
                && timer.classList.contains('done')
                && !timer.shadowRoot.querySelector('.spinner');
        });
        const badge = page.locator('.image-node[data-id="runtime-node-a"] > ic-badge.run-time-pill');
        const complete = await badge.evaluate(element => ({
            tone:element.getAttribute('tone'),
            loading:element.hasAttribute('loading'),
            state:element.dataset.runTimerState,
            done:element.classList.contains('done'),
            contract:element.dataset.icContractStatus,
            dot:Boolean(element.shadowRoot.querySelector('.dot')),
        }));
        assert.deepEqual(complete, {
            tone:'neutral',
            loading:false,
            state:'complete',
            done:true,
            contract:'ready',
            dot:true,
        });

        await page.evaluate(() => window.__hideNodeRuntimeFixture());
        await page.waitForFunction(() => !document.querySelector('[data-run-timer="runtime-node-a"]'));

        const casePage = await context.newPage();
        await casePage.goto(`${baseUrl}/static/design-system/infinite-canvas-ui/feedback-progress-case.html?theme=light&viewport=desktop&locale=zh-CN`, {
            waitUntil:'domcontentloaded',
        });
        await casePage.waitForFunction(() => document.documentElement.dataset.feedbackProgressCaseStatus === 'ready');
        const libraryPattern = await casePage.locator('[data-component-name="ic-badge-node-runtime-status"]').evaluate(section => ({
            title:section.querySelector('h2')?.textContent.trim(),
            states:[...section.querySelectorAll('ic-badge')].map(item => ({
                tone:item.getAttribute('tone'),
                loading:item.hasAttribute('loading'),
                contract:item.dataset.icContractStatus,
            })),
        }));
        assert.deepEqual(libraryPattern, {
            title:'节点运行耗时状态 · 产品模式',
            states:[
                {tone:'info', loading:true, contract:'ready'},
                {tone:'neutral', loading:false, contract:'ready'},
            ],
        });
        await casePage.screenshot({
            path:'/tmp/smart-canvas-node-runtime-status-library-light.png',
            fullPage:true,
        });

        process.stdout.write(`${JSON.stringify({running, complete, themeStyles, libraryPattern})}\n`);
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
