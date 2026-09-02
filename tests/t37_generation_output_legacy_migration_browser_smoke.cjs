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
    d:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="768" height="512"%3E%3Cpath fill="%238a5cf5" d="M0 0h768v512H0z"/%3E%3C/svg%3E',
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
            const input = {
                id:'input',type:'smart-prompt',x:-200,y:180,w:220,h:160,
                text:'upstream prompt',
            };
            const consumer = {
                id:'consumer',type:'smart-image',x:1200,y:180,w:220,h:160,
                images:[],
            };
            canvas = {nodes:[],connections:[],settings:{}};
            nodes.splice(0,nodes.length,input,source,ordinary,group,consumer);
            canvas.nodes = nodes;
            canvas.connections = [
                {from:'input',to:'legacy-gallery',kind:'input'},
                {from:'legacy-gallery',to:'consumer',kind:'input',sourceOutputId:'out-a'},
            ];
            delete canvas.migrationVersions;
            selectedId = 'ordinary-multi';
            selectedIds = [];
            selectedImage = {nodeId:'ordinary-multi',index:1};
            const first = window.SmartCanvasModules.generationOutput.migrateLegacyGalleries();
            const countAfterFirst = nodes.length;
            const second = window.SmartCanvasModules.generationOutput.migrateLegacyGalleries();
            const countAfterSecond = nodes.length;
            render();
            const infoKeys = [
                'runSettings','runModelPrompt','runPrompt','runInputRefs','runPromptRefs',
                'generationInputSnapshot','runAt','outputKind',
            ];
            const split = nodes.filter(node => ![
                'input','legacy-gallery','ordinary-multi','smart-group','consumer',
            ].includes(node.id));
            const legacyOwners = Object.fromEntries(
                [source,...split].map(node => [node.images[0]?.outputId,node.id])
            );
            const legacyBatch = [source,...split];

            const runtime = {
                id:'runtime-gallery',type:'smart-image',x:180,y:1100,w:240,h:320,
                generationOutputNode:true,images:[],pending:1,running:true,
                pendingTasks:[{taskId:'midjourney-task',kind:'image'}],
                runStartedAt:1000,
                ...generationInfo,
            };
            nodes.push(runtime);
            canvas.connections.push({from:'input',to:runtime.id,kind:'input'});
            const runtimeOutputs = window.SmartCanvasModules.generationOutput.apply({
                node:runtime,
                taskId:'midjourney-task',
                outputs:[
                    {url:mediaUrls.a,outputId:'runtime-a'},
                    {url:mediaUrls.b,outputId:'runtime-b'},
                    {url:mediaUrls.c,outputId:'runtime-c'},
                    {url:mediaUrls.d,outputId:'runtime-d'},
                ],
                kind:'image',
                strategy:'task',
            });
            const runtimeBatch = nodes.filter(node =>
                node.id === runtime.id
                || (
                    node.generationBatchId
                    && node.generationBatchId === runtime.generationBatchId
                )
            );

            const corruptRunInfo = {
                ...generationInfo,
                runAt:654321,
                runModelPrompt:'legacy repaired model prompt',
                generationInputSnapshot:{prompt:'legacy repaired model prompt'},
            };
            const corrupt = [mediaUrls.a,mediaUrls.b,mediaUrls.c,mediaUrls.d].map(
                (url,index) => ({
                    id:`corrupt-${index}`,
                    type:'smart-image',
                    x:180 + (index ? 500 : 0),
                    y:1700 + index * 360,
                    created_at:3000 + index,
                    generationOutputNode:true,
                    outputKind:'image',
                    images:[{url,outputId:`corrupt-output-${index}`}],
                    ...corruptRunInfo,
                })
            );
            nodes.push(...corrupt);
            canvas.connections.push(
                {from:'input',to:corrupt[0].id,kind:'input'},
                {
                    from:corrupt[0].id,to:'consumer',kind:'input',
                    sourceOutputId:'corrupt-output-2',
                },
            );
            canvas.migrationVersions.generationOutputGallerySplit = 1;
            const repairFirst = window.SmartCanvasModules.generationOutput.migrateLegacyGalleries();
            const repairSecond = window.SmartCanvasModules.generationOutput.migrateLegacyGalleries();
            const corruptOwner = corrupt.find(node =>
                node.images[0]?.outputId === 'corrupt-output-2'
            );
            return {
                first,second,countAfterFirst,countAfterSecond,
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
                legacyTopology:{
                    batchIds:[...new Set(legacyBatch.map(node => node.generationBatchId))],
                    slots:legacyBatch.map(node => node.generationSlotIndex).sort(),
                    connected:legacyBatch.filter(node => canvas.connections.some(connection =>
                        connection.from === input.id
                        && connection.to === node.id
                        && connection.kind === 'input'
                    )).length,
                    outgoingOwner:canvas.connections.find(connection =>
                        connection.to === consumer.id
                        && connection.sourceOutputId === 'out-a'
                    )?.from || '',
                    expectedOutgoingOwner:legacyOwners['out-a'],
                },
                runtime:{
                    returned:runtimeOutputs.map(item => item.url),
                    count:runtimeBatch.length,
                    imageCounts:runtimeBatch.map(node => node.images.length),
                    batchIds:[...new Set(runtimeBatch.map(node => node.generationBatchId))],
                    slots:runtimeBatch.map(node => node.generationSlotIndex).sort(),
                    connected:runtimeBatch.filter(node => canvas.connections.some(connection =>
                        connection.from === input.id
                        && connection.to === node.id
                        && connection.kind === 'input'
                    )).length,
                },
                repaired:{
                    first:repairFirst,
                    second:repairSecond,
                    version:canvas.migrationVersions.generationOutputGallerySplit,
                    batchIds:[...new Set(corrupt.map(node => node.generationBatchId))],
                    slots:corrupt.map(node => node.generationSlotIndex).sort(),
                    connected:corrupt.filter(node => canvas.connections.some(connection =>
                        connection.from === input.id
                        && connection.to === node.id
                        && connection.kind === 'input'
                    )).length,
                    outgoingOwner:canvas.connections.find(connection =>
                        connection.to === consumer.id
                        && connection.sourceOutputId === 'corrupt-output-2'
                    )?.from || '',
                    expectedOutgoingOwner:corruptOwner?.id || '',
                },
                selection:{selectedId,selectedIds,selectedImage},
            };
        }, media);

        await page.waitForFunction(() => document.querySelectorAll('.image-node').length >= 6);
        const dom = await page.evaluate(() => ({
            legacyGallery:Boolean(document.querySelector('.generation-output-view')),
            sourceMedia:document.querySelector('.image-node[data-id="legacy-gallery"] img')?.src || '',
        }));

        assert.equal(result.first, true);
        assert.equal(result.second, false);
        assert.equal(result.version, 2);
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
        assert.deepEqual(result.legacyTopology, {
            batchIds:['legacy-batch'],
            slots:[0,1,2],
            connected:3,
            outgoingOwner:result.legacyTopology.expectedOutgoingOwner,
            expectedOutgoingOwner:result.legacyTopology.expectedOutgoingOwner,
        });
        assert.deepEqual(result.runtime, {
            returned:[media.a,media.b,media.c,media.d],
            count:4,
            imageCounts:[1,1,1,1],
            batchIds:[result.runtime.batchIds[0]],
            slots:[0,1,2,3],
            connected:4,
        });
        assert.ok(result.runtime.batchIds[0]);
        assert.deepEqual(result.repaired, {
            first:true,
            second:false,
            version:2,
            batchIds:[result.repaired.batchIds[0]],
            slots:[0,1,2,3],
            connected:4,
            outgoingOwner:result.repaired.expectedOutgoingOwner,
            expectedOutgoingOwner:result.repaired.expectedOutgoingOwner,
        });
        assert.ok(result.repaired.batchIds[0]);
        assert.deepEqual(result.selection, {
            selectedId:'ordinary-multi',selectedIds:[],
            selectedImage:{nodeId:'ordinary-multi',index:1},
        });
        assert.equal(dom.legacyGallery, false);
        assert.equal(dom.sourceMedia, media.b);
        assert.deepEqual(pageErrors, []);
        process.stdout.write(`${JSON.stringify({
            version:result.version,
            split:result.split.length,
            repaired:result.repaired.connected,
        })}\n`);
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
