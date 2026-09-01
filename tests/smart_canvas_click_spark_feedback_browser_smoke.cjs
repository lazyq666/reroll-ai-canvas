const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const context = await browser.newContext({
            viewport:{width:1440, height:900},
            deviceScaleFactor:2,
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        const errors = [];
        page.on('console', message => {
            const text = message.text();
            const expectedManualServerGap = text.startsWith('Failed to load resource:')
                || text.startsWith('WebSocket connection to ');
            if(message.type() === 'error' && !expectedManualServerGap) errors.push(text);
        });
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=click-spark-feedback-regression`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.clickSparkFeedback?.controller()
            && document.querySelector('.smart-click-spark-feedback')?.width
        ));

        const point = {x:860, y:280};
        await page.mouse.click(point.x, point.y);
        await page.waitForFunction(() => (
            window.SmartCanvasModules.clickSparkFeedback.controller()
                .status().animationState === 'active'
        ));
        await page.waitForFunction(() => (
            window.SmartCanvasModules.clickSparkFeedback.controller()
                .status().animationState === 'idle'
        ));

        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
        await page.mouse.move(point.x + 90, point.y + 55, {steps:4});
        await page.mouse.up();
        await page.waitForFunction(() => {
            const status = window.SmartCanvasModules.clickSparkFeedback
                .controller().status();
            return status.lastGesture === 'drag-release'
                && status.animationState === 'idle';
        });

        const triggerCountAfterCanvasGestures = await page.evaluate(() => (
            window.SmartCanvasModules.clickSparkFeedback.controller()
                .status().triggerCount
        ));
        await page.locator('#smartPointerTool').click();
        const triggerCountAfterToolbarGesture = await page.evaluate(() => (
            window.SmartCanvasModules.clickSparkFeedback.controller()
                .status().triggerCount
        ));
        await page.mouse.click(point.x, point.y, {button:'right'});
        const triggerCountAfterRightClick = await page.evaluate(() => (
            window.SmartCanvasModules.clickSparkFeedback.controller()
                .status().triggerCount
        ));
        await page.keyboard.press('Escape');

        const colors = {};
        for(const theme of ['light', 'dark']){
            colors[theme] = await page.evaluate(activeTheme => {
                document.documentElement.dataset.uiTheme = activeTheme;
                document.documentElement.classList.toggle('theme-dark', activeTheme === 'dark');
                document.documentElement.classList.toggle('studio-theme-dark', activeTheme === 'dark');
                document.body.classList.toggle('theme-dark', activeTheme === 'dark');
                document.body.classList.toggle('studio-theme-dark', activeTheme === 'dark');
                return window.SmartCanvasModules.clickSparkFeedback
                    .controller().resolvedColor();
            }, theme);
        }

        await page.emulateMedia({reducedMotion:'reduce'});
        await page.mouse.click(point.x + 130, point.y + 40);
        const report = await page.evaluate(() => {
            const controller = window.SmartCanvasModules.clickSparkFeedback.controller();
            const canvas = controller.canvas;
            const root = document.getElementById('shell');
            return {
                config:controller.config,
                status:controller.status(),
                pointerEvents:getComputedStyle(canvas).pointerEvents,
                zIndex:getComputedStyle(canvas).zIndex,
                dpr:Number(canvas.dataset.dpr),
                canvasWidth:canvas.width,
                rootWidth:root.getBoundingClientRect().width,
            };
        });
        report.colors = colors;
        report.triggerCountAfterCanvasGestures = triggerCountAfterCanvasGestures;
        report.triggerCountAfterToolbarGesture = triggerCountAfterToolbarGesture;
        report.triggerCountAfterRightClick = triggerCountAfterRightClick;
        report.errors = errors;

        assert.deepEqual(report.config, {
            count:8,
            radius:16,
            length:10,
            duration:360,
            maxBursts:3,
        });
        assert.equal(report.triggerCountAfterCanvasGestures, 2);
        assert.equal(report.triggerCountAfterToolbarGesture, 3);
        assert.equal(report.triggerCountAfterRightClick, 3);
        assert.deepEqual(report.status, {
            animationActive:false,
            animationState:'idle',
            lastGesture:'click',
            lastMotion:'reduced',
            triggerCount:4,
        });
        assert.equal(report.pointerEvents, 'none');
        assert.equal(report.zIndex, '201');
        assert.equal(report.dpr, 1.5);
        assert.ok(report.canvasWidth <= report.rootWidth * 1.5 + 1);
        assert.match(report.colors.light, /^rgb/);
        assert.match(report.colors.dark, /^rgb/);
        assert.notEqual(report.colors.light, report.colors.dark);
        assert.deepEqual(report.errors, []);

        if(process.env.SMART_CANVAS_SCREENSHOT){
            await page.screenshot({path:process.env.SMART_CANVAS_SCREENSHOT, fullPage:true});
        }
        process.stdout.write(`${JSON.stringify(report)}\n`);
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
