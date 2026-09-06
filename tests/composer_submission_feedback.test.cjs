const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {test} = require('node:test');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => resolve=r); return {promise,resolve}; };

test('late completion cannot clear a newer submission or collapse a reopened editor', async () => {
  const source = read('static/js/smart-canvas.js');
  const calls=[], messages=[];
  const sandbox = {
    runBtn:{disabled:false}, composerFocusRevision:1, focused:true,
    activeComposerNode:() => ({id:'source'}),
    generationRun:{run(options){const done=deferred(); calls.push({options,done}); return done.promise;}},
    syncRunButtonState(){}, tr:key=>key, toast:key=>messages.push(key),
    setPromptAuthoringFocused(value){sandbox.focused=value;},
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(source.indexOf('let composerSubmission ='), source.indexOf('function syncRunButtonState(')), sandbox);
  const first=sandbox.submitComposerGeneration();
  await sandbox.submitComposerGeneration();
  assert.equal(calls.length,1);
  calls[0].options.onAccepted({node:{id:'source'},submission:{state:'pending',tasks:[{status:'queued'}]}});
  assert.equal(sandbox.focused,false);
  const second=sandbox.submitComposerGeneration();
  calls[0].done.resolve(); await first;
  await sandbox.submitComposerGeneration();
  assert.equal(calls.length,2,'old completion must not release the newer submission lock');
  sandbox.focused=true; sandbox.composerFocusRevision++;
  calls[1].options.onAccepted({node:{id:'source'},submission:{state:'pending'}});
  assert.equal(sandbox.focused,true,'late receipt must not close a newly opened editing session');
  calls[1].done.resolve(); await second;
  assert.deepEqual(messages,['smart.generationQueued','smart.generationSubmitted']);
});

test('provider receipts notify once and reject deleted/replaced targets', async () => {
  const source = read('static/js/smart-canvas/generation-run.js');
  const nodes=[{id:'a',generationOperationId:'operation'}];
  const sandbox={nodes,tr:key=>key}; vm.createContext(sandbox);
  vm.runInContext(source.slice(source.indexOf('function generationSubmissionAcceptance('),source.indexOf('async function submitAndSettleGenerationProvider(')),sandbox);
  let count=0;
  const accept=sandbox.generationSubmissionAcceptance(nodes,'operation',{onAccepted:()=>count++});
  await accept({state:'pending'}); await accept({state:'completed'});
  assert.equal(count,1);
  nodes[0].generationOperationId='replacement';
  await assert.rejects(accept({state:'completed'}),error=>error.generationDiscarded===true);
  nodes.splice(0);
  await assert.rejects(accept({state:'pending'}),error=>error.generationDiscarded===true);
});

for(const engine of ['comfy','runninghub']) test(`${engine} notifies at task receipt before waiting for results`, async () => {
  const gate=deferred(), notified=deferred();
  let settled=false, accepted=0;
  const sandbox={
    window:{SmartCanvasModules:{}}, tr:key=>key, smartClientId:'test',
    imageRefsOnly:refs=>refs, isApiLikeEngine:()=>false,
    runningHubSelectedModel:()=>null,
    selectedRunningHubRef:()=>({kind:'app',id:'test'}),
    rhActiveFields:()=>[{id:'prompt'}], rhMediaForRun:()=>[], rhBuildNodeInfoList:async()=>[],
    resultMediaUrls:result=>Array.isArray(result) ? result : result?.images || [],
    mediaKindForUrls:()=> 'image',
    fetch:async url=>({ok:true,json:async()=> {
      if(url.endsWith('/submit')) return {taskId:'task'};
      if(url==='/api/canvas-comfy-tasks') return {task_id:'task',status:'queued'};
      await gate.promise;
      return engine==='comfy' ? {status:'succeeded',result:{images:['/output.png']}} : {status:'SUCCESS',urls:['/output.png']};
    }}),
  };
  vm.createContext(sandbox);
  vm.runInContext(read('static/js/smart-canvas/generation-provider.js'),sandbox);
  sandbox.generationProviderSleep=async()=>{};
  const run=sandbox.window.SmartCanvasModules.generationProvider.submit({
    prompt:'test',settings:{engine},onAccepted:receipt=>{accepted++; notified.resolve(receipt);},
  }).then(result=>{settled=true;return result;});
  const receipt=await notified.promise;
  assert.equal(receipt.state,'pending');
  assert.equal(receipt.tasks[0].taskId,'task');
  assert.equal(settled,false);
  gate.resolve(); await run;
  assert.equal(accepted,1);
});
