const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'static/js/infinite-canvas-ui/canvas-commit-lane.js');
const CHROME = process.env.IC_BROWSER_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  const browser = await chromium.launch({headless:true, executablePath:CHROME});
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    await page.addScriptTag({path:MODULE});
    const result = await page.evaluate(async () => {
      const CanvasCommitLane = window.InfiniteCanvasModules.CanvasCommitLane;
      const jsonResponse = (status, data) => ({
        ok:status >= 200 && status < 300,
        status,
        async json(){ return data; },
      });

      const staleRequests = [];
      const observed = [];
      const states = [];
      let stalePostCount = 0;
      let checkpointRevision = 4;
      const staleLane = CanvasCommitLane.create({
        canvasId:'canvas-stale',
        clientId:'smart-tab',
        checkpoint:async () => ({revision:checkpointRevision}),
        resync:async () => { checkpointRevision = 5; return true; },
        observeExternalCommit:commit => { observed.push(commit); },
        onPromptState:state => states.push(state),
        fetch:async (url, init={}) => {
          if((init.method || 'GET') === 'GET'){
            return jsonResponse(200, {revision:5, templates:[]});
          }
          const body = JSON.parse(init.body);
          staleRequests.push(body);
          stalePostCount += 1;
          if(stalePostCount === 1){
            return jsonResponse(409, {detail:{
              code:'stale_prompt_templates',
              message:'stale',
              revision:5,
            }});
          }
          return jsonResponse(200, {
            revision:6,
            updated_at:600,
            templates:[{id:'created',item_version:'v-created'}],
            item:{id:'created',item_version:'v-created'},
          });
        },
      });
      const staleOutcome = await staleLane.commitPrompt({
        action:'create', name:'规则', positive:'内容',
      });

      const lostRequests = [];
      let lostOnce = false;
      const lostLane = CanvasCommitLane.create({
        canvasId:'canvas-lost', clientId:'classic-tab',
        checkpoint:async () => ({revision:8}),
        resync:async () => true,
        fetch:async (_url, init={}) => {
          const body = JSON.parse(init.body);
          lostRequests.push(body);
          if(!lostOnce){
            lostOnce = true;
            throw new TypeError('Failed to fetch');
          }
          return jsonResponse(200, {
            revision:9, duplicate:true,
            templates:[{id:'once'}], item:{id:'once'},
          });
        },
      });
      const lostOutcome = await lostLane.commitPrompt({
        action:'create', name:'只创建一次', positive:'内容',
      });

      let active = 0;
      let maxActive = 0;
      let serialRevision = 10;
      const serialLane = CanvasCommitLane.create({
        canvasId:'canvas-serial', clientId:'tab',
        checkpoint:async () => ({revision:serialRevision}),
        observeExternalCommit:({revision}) => { serialRevision = revision; },
        fetch:async (_url, init={}) => {
          active += 1;
          maxActive = Math.max(maxActive,active);
          await new Promise(resolve => setTimeout(resolve,15));
          active -= 1;
          serialRevision += 1;
          return jsonResponse(200, {
            revision:serialRevision,
            templates:[], item:{id:JSON.parse(init.body).name},
          });
        },
      });
      await Promise.all([
        serialLane.commitPrompt({action:'create',name:'A',positive:'A'}),
        serialLane.commitPrompt({action:'create',name:'B',positive:'B'}),
      ]);

      let conflictPosts = 0;
      let conflictCode = '';
      const conflictLane = CanvasCommitLane.create({
        canvasId:'canvas-conflict', clientId:'tab',
        checkpoint:async () => ({revision:12}),
        fetch:async () => {
          conflictPosts += 1;
          return jsonResponse(409, {detail:{
            code:'prompt_template_conflict',
            message:'协作者已修改', revision:12,
          }});
        },
      });
      try {
        await conflictLane.commitPrompt({
          action:'update', itemId:'item-a', expectedItemVersion:'v1',
          name:'草稿', positive:'不覆盖',
        });
      } catch(error){ conflictCode = error.code; }

      let changedTargetPosts = 0;
      let changedTargetCode = '';
      const changedTargetLane = CanvasCommitLane.create({
        canvasId:'canvas-changed-target', clientId:'tab',
        checkpoint:async () => ({revision:20}),
        resync:async () => true,
        fetch:async (_url, init={}) => {
          if((init.method || 'GET') === 'GET'){
            return jsonResponse(200, {
              revision:21,
              templates:[{id:'item-a',item_version:'v2'}],
            });
          }
          changedTargetPosts += 1;
          return jsonResponse(409, {detail:{
            code:'stale_prompt_templates', message:'stale', revision:21,
          }});
        },
      });
      try {
        await changedTargetLane.commitPrompt({
          action:'update', itemId:'item-a', expectedItemVersion:'v1',
          name:'本地草稿', positive:'本地草稿',
        });
      } catch(error){ changedTargetCode = error.code; }

      return {
        staleOutcome, staleRequests, observed, stateCount:states.length,
        lostOutcome, lostRequests, maxActive, serialRevision,
        conflictPosts, conflictCode,
        changedTargetPosts, changedTargetCode,
      };
    });

    assert.equal(result.staleOutcome.revision, 6);
    assert.equal(result.staleRequests.length, 2);
    assert.equal(result.staleRequests[0].operation_id, result.staleRequests[1].operation_id);
    assert.deepEqual(result.staleRequests.map(item => item.base_revision), [4, 5]);
    assert.equal(result.observed.length, 1);
    assert.equal(result.observed[0].revision, 6);
    assert.equal(result.stateCount, 2);
    assert.equal(result.lostRequests.length, 2);
    assert.equal(result.lostRequests[0].operation_id, result.lostRequests[1].operation_id);
    assert.equal(result.lostOutcome.duplicate, true);
    assert.equal(result.maxActive, 1);
    assert.equal(result.serialRevision, 12);
    assert.equal(result.conflictPosts, 1);
    assert.equal(result.conflictCode, 'prompt_template_conflict');
    assert.equal(result.changedTargetPosts, 1);
    assert.equal(result.changedTargetCode, 'prompt_template_conflict');
    process.stdout.write('Canvas Commit Lane browser smoke passed.\n');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
