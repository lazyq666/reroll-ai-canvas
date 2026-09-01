const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const svg = (width, height, color) => (
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`)}`
);
const verticalUrl = svg(200, 300, '#4c8bf5');
const landscapeUrl = svg(300, 200, '#f05b78');

function near(actual, expected, tolerance=0.06) {
    return Math.abs(actual - expected) <= tolerance;
}

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const page = await browser.newPage({viewport:{width:1440,height:900}});
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=t37-multi-media-resize&manual=1`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.canvasMutation
            && typeof canvas !== 'undefined'
            && canvas
            && Array.isArray(nodes)
            && typeof render === 'function'
        ));

        await page.evaluate(({verticalUrl, landscapeUrl}) => {
            nodes.splice(0, nodes.length, {
                id:'resize-group',
                type:'smart-image',
                x:280,
                y:100,
                w:440,
                h:520,
                title:'Resize group',
                images:[
                    {url:verticalUrl,name:'vertical.png',kind:'image',natural_w:200,natural_h:300},
                    {url:landscapeUrl,name:'landscape.png',kind:'image',natural_w:300,natural_h:200},
                ],
            });
            canvas.connections = [];
            selectedId = 'resize-group';
            selectedIds = [];
            selectedImage = {nodeId:'',index:-1};
            render();
        }, {verticalUrl, landscapeUrl});
        await page.waitForSelector('.image-node[data-id="resize-group"] .node-resize-handle');

        const snapshot = label => page.evaluate(label => {
            const node = document.querySelector('.image-node[data-id="resize-group"]');
            const grid = node.querySelector('.thumb-grid');
            const gridRect = grid.getBoundingClientRect();
            const media = [...node.querySelectorAll('.thumb-media-frame')].map(frame => {
                const rect = frame.getBoundingClientRect();
                const visibleWidth = Math.max(
                    0,
                    Math.min(rect.right, gridRect.right) - Math.max(rect.left, gridRect.left),
                );
                const visibleHeight = Math.max(
                    0,
                    Math.min(rect.bottom, gridRect.bottom) - Math.max(rect.top, gridRect.top),
                );
                return {
                    frameRatio:Number((rect.width / rect.height).toFixed(3)),
                    visibleRatio:Number((visibleWidth / Math.max(0.01, visibleHeight)).toFixed(3)),
                };
            });
            return {
                label,
                gridHeight:Number(gridRect.height.toFixed(2)),
                gridMaxHeight:grid.style.getPropertyValue('--thumb-max-height'),
                media,
            };
        }, label);

        const resize = async ({dx, dy, label}) => {
            const handle = page.locator('.image-node[data-id="resize-group"] .node-resize-handle');
            const rect = await handle.boundingBox();
            const start = {x:rect.x + rect.width / 2, y:rect.y + rect.height / 2};
            await page.mouse.move(start.x, start.y);
            await page.mouse.down();
            await page.mouse.move(start.x + dx, start.y + dy);
            await page.waitForTimeout(50);
            const during = await snapshot(`${label}-during`);
            await page.mouse.up();
            await page.evaluate(() => new Promise(resolve => (
                requestAnimationFrame(() => requestAnimationFrame(resolve))
            )));
            return {during, after:await snapshot(`${label}-after`)};
        };

        const baseline = await snapshot('baseline');
        const wide = await resize({dx:330, dy:-20, label:'wide'});
        await page.evaluate(() => {
            Object.assign(nodes[0], {w:360,h:600});
            nodes[0].images[0].grid = {type:'grid-split',cols:1,rows:2};
            render();
        });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        const tallBaseline = await snapshot('tall-baseline');
        const tall = await resize({dx:-70, dy:170, label:'tall'});

        const regressions = [];
        if (!near(wide.during.media[0].frameRatio, 2 / 3)) {
            regressions.push(`wide resize stretched the 2:3 media frame: ${wide.during.media[0].frameRatio}`);
        }
        if (!near(wide.during.media[0].visibleRatio, 2 / 3)) {
            regressions.push(`wide resize visibly clipped 2:3 media: ${wide.during.media[0].visibleRatio}`);
        }
        if (!near(wide.after.media[0].visibleRatio, 2 / 3)) {
            regressions.push(`wide resize did not settle to 2:3: ${wide.after.media[0].visibleRatio}`);
        }
        if (!near(tall.during.media[1].frameRatio, 3 / 2)) {
            regressions.push(`tall resize stretched the 3:2 media frame: ${tall.during.media[1].frameRatio}`);
        }
        if (!near(tall.during.media[1].visibleRatio, 3 / 2)) {
            regressions.push(`tall resize visibly clipped 3:2 media: ${tall.during.media[1].visibleRatio}`);
        }
        if (!near(tall.after.media[1].visibleRatio, 3 / 2)) {
            regressions.push(`tall resize did not settle to 3:2: ${tall.after.media[1].visibleRatio}`);
        }
        assert.deepEqual(pageErrors, []);
        console.log(JSON.stringify({baseline, wide, tallBaseline, tall}, null, 2));
        assert.deepEqual(regressions, [], regressions.join('\n'));
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
