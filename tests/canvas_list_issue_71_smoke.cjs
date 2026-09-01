const { chromium } = require('playwright');
const { submitLogin } = require('./ic_login_helper.cjs');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:3100';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const smokeUsername = process.env.SMART_CANVAS_USERNAME || 'admin';
const smokePassword = process.env.SMART_CANVAS_PASSWORD || 'admin';
const fakeAuth = process.env.SMART_CANVAS_FAKE_AUTH === '1';
const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';
const projectCount = 10;
const canvasesPerProject = 1000;

function batch(project, start = 0, count = 40) {
    return Array.from({ length: count }, (_, offset) => ({
        id: `${project}-${start + offset}`,
        title: `${project} canvas ${start + offset}`,
        kind: 'smart',
        project,
        visibility: 'shared',
        node_count: 200,
        updated_at: 1000 - start - offset,
        board_x: 40 + (offset % 4) * 312,
        board_y: 40 + Math.floor(offset / 4) * 286,
        cover_url: `/assets/input/issue-71-cover/${project}-${start + offset}.png`,
    }));
}

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    if(fakeAuth){
        await page.route('**/api/auth/me', async route => route.fulfill({
            status:200,
            contentType:'application/json',
            body:'{"user":{"id":"admin","username":"admin","role":"admin","status":"active"}}',
        }));
    } else {
        await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
        await submitLogin(page, baseUrl, smokeUsername, smokePassword);
    }

    let projectsRequestedAt = 0;
    let projectsFulfilledAt = 0;
    let trashRequests = 0;
    let canvasBatchRequests = 0;
    let previewRequests = 0;
    let originalCoverRequests = 0;
    await page.route('**/api/canvases?*', async route => {
        canvasBatchRequests += 1;
        const url = new URL(route.request().url());
        const project = url.searchParams.get('project') || 'default';
        const cursor = Number(url.searchParams.get('cursor') || 0);
        const records = batch(project, cursor, 40);
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                canvases: records,
                next_cursor: cursor + records.length < canvasesPerProject
                    ? String(cursor + records.length)
                    : '',
                total: canvasesPerProject,
                rebuilding: false,
                index_read_ms: 4.2,
            }),
        });
    });
    await page.route('**/api/projects', async route => {
        projectsRequestedAt = Date.now();
        await new Promise(resolve => setTimeout(resolve, 350));
        projectsFulfilledAt = Date.now();
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({projects:Array.from(
                {length:projectCount},
                (_, index) => ({
                    id:index ? `project-${index}` : 'default',
                    name:index ? `Project ${index}` : 'Default',
                    order:index,
                    canvas_count:canvasesPerProject,
                })
            )}),
        });
    });
    await page.route('**/api/canvases/trash', async route => {
        trashRequests += 1;
        await route.fulfill({status:200,contentType:'application/json',body:'{"canvases":[]}'});
    });
    await page.route('**/api/media-preview?*', async route => {
        previewRequests += 1;
        await route.fulfill({status:200,contentType:'image/png',body:Buffer.from(tinyPng,'base64')});
    });
    await page.route('**/assets/input/issue-71-cover/*.png', async route => {
        originalCoverRequests += 1;
        await route.fulfill({status:200,contentType:'image/png',body:Buffer.from(tinyPng,'base64')});
    });

    await page.goto(`${baseUrl}/static/canvas-list.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ws-card');
    const firstCardAt = Date.now();
    await page.waitForSelector('.ws-project-row[data-project-id="project-9"]');
    await new Promise(resolve => setTimeout(resolve, 500));
    const initial = await page.evaluate(() => ({
        cards:document.querySelectorAll('.ws-card').length,
        metrics:window.canvasListPerformance,
        lazy:[...document.querySelectorAll('.ws-card-cover')].every(image => image.loading === 'lazy'),
        previews:[...document.querySelectorAll('.ws-card-cover')].every(image => image.getAttribute('src')?.startsWith('/api/media-preview?')),
        loadMoreVisible:getComputedStyle(document.getElementById('boardLoadMore')).display !== 'none',
    }));
    const batchRequestsAfterIdle = canvasBatchRequests;
    await page.click('#boardLoadMore');
    await page.waitForFunction(() => document.querySelectorAll('.ws-card').length === 80);
    const cardsAfterLoadMore = await page.locator('.ws-card').count();
    await page.click('.ws-project-row[data-project-id="project-9"]');
    await page.waitForFunction(() => (
        document.querySelector('.ws-card')?.dataset.canvasId?.startsWith('project-9-')
    ));
    const switchedAt = Date.now();
    await page.waitForFunction(() => window.canvasListPerformance.batches.length >= 2);
    await new Promise(resolve => setTimeout(resolve, 500));

    const result = {
        initialCards:initial.cards,
        firstCardBeforeProjects:firstCardAt < projectsFulfilledAt,
        projectDelay:projectsFulfilledAt - projectsRequestedAt,
        switchMs:switchedAt - projectsFulfilledAt,
        measuredSwitchMs:(await page.evaluate(() => window.canvasListPerformance.projectSwitchMs.at(-1))) || 0,
        lazy:initial.lazy,
        previews:initial.previews,
        loadMoreVisible:initial.loadMoreVisible,
        batchRequestsAfterIdle,
        cardsAfterLoadMore,
        trashRequests,
        previewRequests,
        originalCoverRequests,
        metrics:initial.metrics,
    };
    await browser.close();
    if(result.initialCards < 16
        || !result.firstCardBeforeProjects
        || result.measuredSwitchMs >= 500
        || !result.lazy
        || !result.previews
        || !result.loadMoreVisible
        || result.batchRequestsAfterIdle !== 1
        || result.cardsAfterLoadMore !== 80
        || result.previewRequests < 1
        || result.originalCoverRequests !== 0
        || result.trashRequests < 1
        || !result.metrics?.firstCardPaintAt
        || !result.metrics?.batches?.some(item => item.indexReadMs === 4.2)) {
        throw new Error(`Unexpected Issue #71 canvas-list flow: ${JSON.stringify(result)}`);
    }
    process.stdout.write(`${JSON.stringify({ok:true,...result}, null, 2)}\n`);
})().catch(error => {
    console.error(error);
    process.exit(1);
});
