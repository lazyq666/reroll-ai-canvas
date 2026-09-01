const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const media = {
    a:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="640" height="480"%3E%3Cpath fill="%234c8bf5" d="M0 0h640v480H0z"/%3E%3C/svg%3E',
    b:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="480" height="640"%3E%3Cpath fill="%23e45858" d="M0 0h480v640H0z"/%3E%3C/svg%3E',
    c:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="512" height="512"%3E%3Cpath fill="%2346a758" d="M0 0h512v512H0z"/%3E%3C/svg%3E',
};

function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x
        && a.y < b.y + b.h && a.y + a.h > b.y;
}

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:browserExecutable});
    try {
        const page = await browser.newPage({viewport:{width:1440,height:900}});
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        const smartCanvasHtml = fs.readFileSync(
            path.join(__dirname, '..', 'static', 'smart-canvas.html'),
            'utf8',
        );
        await page.route('**/static/smart-canvas.html?*', route => route.fulfill({
            status:200,
            contentType:'text/html',
            body:smartCanvasHtml,
        }));
        await page.goto(`${baseUrl}/static/smart-canvas.html?id=t37-legacy-gallery&manual=1`, {
            waitUntil:'domcontentloaded',
        });
        await page.waitForFunction(() => Boolean(
            window.SmartCanvasModules?.generationOutput?.migrateLegacyGalleries
            && window.SmartCanvasModules?.canvasMutation
            && Array.isArray(nodes)
        ));

        const result = await page.evaluate(mediaUrls => {
            const generationInfo = {
                runSettings:{engine:'api',model:'image-model'},
                runModelPrompt:'model prompt',
                runPrompt:'display prompt',
                runInputRefs:[{url:'input.png',nodeId:'input'}],
                runPromptRefs:[{url:'prompt.png',nodeId:'prompt'}],
                generationInputSnapshot:{prompt:'model prompt'},
                runAt:123456,
                outputKind:'image',
            };
            const source = {
                id:'legacy-gallery',type:'smart-image',x:180,y:180,w:240,h:320,scale:1.25,
                generationOutputNode:true,activeOutputId:'out-b',
                images:[
                    {url:mediaUrls.a,outputId:'out-a',natural_w:640,natural_h:480},
                    {url:mediaUrls.b,outputId:'out-b',natural_w:480,natural_h:640},
                    {url:mediaUrls.c,outputId:'out-c',natural_w:512,natural_h:512},
                ],
                hasNewGenerationOutput:true,
                generationBatchId:'legacy-batch',
                ...generationInfo,
            };
            const ordinary = {
                id:'ordinary-multi',type:'smart-image',x:80,y:700,
                images:[{url:mediaUrls.a},{url:mediaUrls.c}],
            };
            const group = {
                id:'smart-group',type:'smart-group',x:1050,y:650,w:320,h:210,
                items:[],images:[{url:mediaUrls.a},{url:mediaUrls.c}],
            };
            canvas = {nodes:[],connections:[],settings:{}};
            nodes.splice(0,nodes.length,source,ordinary,group);
            canvas.nodes = nodes;
            canvas.connections = [
                {from:'legacy-gallery',to:'consumer',kind:'input',sourceOutputId:'out-a'},
            ];
            delete canvas.migrationVersions;
            selectedId = 'ordinary-multi';
            selectedIds = [];
            selectedImage = {nodeId:'ordinary-multi',index:1};
            const connectionBefore = JSON.stringify(canvas.connections);
            const first = window.SmartCanvasModules.generationOutput.migrateLegacyGalleries();
            const countAfterFirst = nodes.length;
            const second = window.SmartCanvasModules.generationOutput.migrateLegacyGalleries();
            render();
            const infoKeys = [
                'runSettings','runModelPrompt','runPrompt','runInputRefs','runPromptRefs',
                'generationInputSnapshot','runAt','outputKind',
            ];
            const split = nodes.filter(node => ![
                'legacy-gallery','ordinary-multi','smart-group',
            ].includes(node.id));
            return {
                first,second,countAfterFirst,countAfterSecond:nodes.length,
                version:canvas.migrationVersions?.generationOutputGallerySplit,
                source:{
                    id:source.id,x:source.x,y:source.y,url:source.images[0]?.url,
                    active:Object.hasOwn(source,'activeOutputId'),scale:source.scale,
                },
                split:split.map(node => ({
                    id:node.id,x:node.x,y:node.y,w:node.w,h:node.h,
                    url:node.images[0]?.url,
                    info:Object.fromEntries(infoKeys.map(key => [key,node[key]])),
                })),
                expectedInfo:generationInfo,
                sourceRect:{x:source.x,y:source.y,w:source.w,h:source.h},
                ordinaryCount:ordinary.images.length,
                groupCount:group.images.length,
                connectionsUnchanged:connectionBefore === JSON.stringify(canvas.connections),
                selection:{selectedId,selectedIds,selectedImage},
            };
        }, media);

        await page.waitForFunction(() => document.querySelectorAll('.image-node').length === 5);
        const dom = await page.evaluate(() => ({
            legacyGallery:Boolean(document.querySelector('.generation-output-view')),
            sourceMedia:document.querySelector('.image-node[data-id="legacy-gallery"] img')?.src || '',
        }));

        assert.equal(result.first, true);
        assert.equal(result.second, false);
        assert.equal(result.version, 1);
        assert.equal(result.countAfterFirst, result.countAfterSecond);
        assert.deepEqual(
            [result.source.id,result.source.x,result.source.y,result.source.url,result.source.active,result.source.scale],
            ['legacy-gallery',180,180,media.b,false,1.25],
        );
        assert.deepEqual(result.split.map(node => node.url), [media.a,media.c]);
        assert.ok(result.split.every(node => node.x > result.sourceRect.x + result.sourceRect.w));
        assert.equal(overlaps(result.split[0], result.split[1]), false);
        assert.ok(result.split.every(node => JSON.stringify(node.info) === JSON.stringify(result.expectedInfo)));
        assert.deepEqual([result.ordinaryCount,result.groupCount], [2,2]);
        assert.equal(result.connectionsUnchanged, true);
        assert.deepEqual(result.selection, {
            selectedId:'ordinary-multi',selectedIds:[],
            selectedImage:{nodeId:'ordinary-multi',index:1},
        });
        assert.equal(dom.legacyGallery, false);
        assert.equal(dom.sourceMedia, media.b);
        assert.deepEqual(pageErrors, []);
        process.stdout.write(`${JSON.stringify({version:result.version,split:result.split.length})}\n`);
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
