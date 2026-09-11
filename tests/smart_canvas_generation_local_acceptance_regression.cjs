const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const runSource = fs.readFileSync('static/js/smart-canvas/generation-run.js', 'utf8');
const providerSource = fs.readFileSync('static/js/smart-canvas/generation-provider.js', 'utf8');
const hostSource = fs.readFileSync('static/js/smart-canvas.js', 'utf8');
const functionSource = (source, name, next) => source.slice(source.indexOf(name), source.indexOf(next, source.indexOf(name) + 1));
const staged = [];
let cloudReady = false;
let providerRequests = 0;
let prompt = 'First prompt';
const sourceNode = {id:'source', type:'smart-image', images:[]};
const sandbox = {
    window:{SmartCanvasModules:{}}, nodes:[sourceNode], canvasId:'canvas', smartClientId:'client',
    generationSettingsModule:{snapshot:structuredClone}, generationRunReferenceSnapshot:structuredClone,
    generationRunPersistenceModule:{save:async()=>{throw Error('Cloud composer must stage first');}, synced:()=>{throw Error('Do not wait for global canvas idleness');},
        sealGeneration:()=>[{operation_id:'checkpoint-'+staged.length,base_revision:0,changes:{node_creates:[]}}]},
    settleGenerationProviderResult:async()=>({deferred:true}),
    runBtn:{disabled:false}, composerFocusRevision:0,
    activeComposerNode:()=>sourceNode, setPromptAuthoringFocused(){}, toast(){}, render(){},
    tr:key=>key, Date, Math, Promise, Set, Map,
    setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,15)), clearTimeout,
    fetch:async(url, options={})=>{
        if(url === '/api/local-generation-submissions' && options.method !== 'POST') {
            return {ok:true,json:async()=>({enabled:true,workspace_id:'workspace',actor_id:'alice'})};
        }
        if(options.method === 'POST') {
            const command = JSON.parse(options.body);
            const record = {id:String(staged.length+1),operation_id:command.operation_id,target_ids:command.target_ids,
                status:'queued', command, result:{}};
            staged.push(record);
            return {ok:true,json:async()=>structuredClone(record)};
        }
        const record = staged.find(item=>url.endsWith('/'+item.id));
        assert.ok(record);
        if(cloudReady && record.status !== 'accepted') {
            providerRequests++;
            record.status='accepted';record.result={task_id:'task-'+record.id,status:'queued'};
        }
        return {ok:true,json:async()=>structuredClone(record)};
    },
};
sandbox.window.SmartCanvasModules.canvasPersistence=sandbox.generationRunPersistenceModule;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('static/js/smart-canvas/local-generation-submissions.js','utf8'),sandbox);
vm.runInContext(functionSource(providerSource,'async function generationProviderPostTask(', '\nasync function generationProviderCreateComfyTask('), sandbox);
vm.runInContext(functionSource(runSource,'function generationSubmissionAcceptance(', '\nasync function submitAndSettleGenerationProvider('), sandbox);
vm.runInContext(functionSource(runSource,'async function submitAndSettleGenerationProvider(', '\nasync function submitAndSettleGenerationProviderBatch('), sandbox);
vm.runInContext('let composerSubmission=null;\n'+functionSource(hostSource,'async function submitComposerGeneration(', '\nfunction syncRunButtonState('),sandbox);
sandbox.syncRunButtonState=()=>{sandbox.runBtn.disabled=vm.runInContext('Boolean(composerSubmission)',sandbox);};
sandbox.generationProviderModule={submit:async options=>{
    sandbox.requestPayload={prompt:options.prompt,canvas_id:'canvas',node_id:options.context.nodeId,
        generation_operation_id:options.context.operationId,generation_request_index:0};
    sandbox.requestContext=options.context;
    const receipt=await vm.runInContext('generationProviderPostTask("/api/canvas-image-tasks",requestPayload,requestContext)',sandbox);
    return {state:'pending',tasks:[{taskId:receipt.task_id}]};
}};
let sequence=0;
sandbox.generationRun={run:async options=>{
    const node={id:'output-'+(++sequence),type:'smart-image',images:[],pending:1};
    sandbox.nodes.push(node);
    sandbox.nextNode=node;sandbox.nextPrompt=prompt;sandbox.nextOptions=options;
    return vm.runInContext('submitAndSettleGenerationProvider(nextNode,nextPrompt,[],{engine:"api"},nextOptions)',sandbox);
}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
    const first=vm.runInContext('submitComposerGeneration()',sandbox);
    assert.equal(sandbox.runBtn.disabled,true);
    await tick();
    assert.equal(staged.length,1);
    assert.equal(sandbox.runBtn.disabled,false,'local receipt must unlock the actual composer while the cloud is pending');
    assert.equal(providerRequests,0);
    prompt='Second prompt';
    const second=vm.runInContext('submitComposerGeneration()',sandbox);
    await tick();
    assert.equal(staged.length,2,'the second click must be accepted before the first cloud acknowledgement');
    assert.equal(sandbox.runBtn.disabled,false);
    assert.notEqual(staged[0].operation_id,staged[1].operation_id);
    assert.notDeepEqual(staged[0].target_ids,staged[1].target_ids);
    assert.equal(staged[0].command.payload.prompt,'First prompt');
    assert.equal(staged[1].command.payload.prompt,'Second prompt');
    assert.equal(providerRequests,0,'cloud prerequisites still gate Provider execution');
    cloudReady=true;
    await Promise.all([first,second]);
    assert.equal(providerRequests,2);
    assert.equal(sandbox.runBtn.disabled,false,'a late acceptance must not relock the composer');
    console.log('PASS: two actual composer submissions receive independent local receipts before cloud confirmation');
})().catch(error=>{console.error(error);process.exitCode=1;});
