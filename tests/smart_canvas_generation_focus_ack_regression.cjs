const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sent = [];
const failures = [];
const editor = {textContent:'Two cups', matches:()=>true, contains:element=>element===editor};
const initial = {title:'Test', icon:'', nodes:[{id:'source',type:'smart-image',x:0,y:0,images:[]}], connections:[], settings:{}};
const socket = {readyState:1,send:value=>sent.push(JSON.parse(value))};
const sandbox = {
    window:{WebSocket:{OPEN:1},addEventListener(){},
        localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
        SmartCanvasModules:{canvasMutation:{history(){}},
            nodeGeometry:require('../static/js/smart-canvas/node-geometry.js')}},
    document:{activeElement:editor,addEventListener(){},getElementById:()=>null},
    canvasId:'test',smartClientId:'focus-test',canvas:structuredClone(initial),nodes:[],
    settings:{},initialSmartSettings:{},canvasDefaultSmartSettings:{},selectionState:null,
    lastComposerNodeId:'source:node',promptInput:editor,composerFocusRevision:1,
    runBtn:{disabled:false},socket,
    normalizeLegacySmartNode:node=>({...node}),cloneSmartSettings:structuredClone,
    savePromptDraftForCurrent(){},stripImageGenerationMeta:item=>({...item}),
    mediaItemForStorage:item=>({...item}),settingsForStorage:value=>({...value}),
    render(){},scheduleConnectionLayerRefresh(){},tr:key=>key,toast:message=>failures.push(message),
    setPromptAuthoringFocused(){},syncRunButtonState(){},
    setTimeout,clearTimeout,setInterval,clearInterval,Date,JSON,Promise,
};
sandbox.nodes=sandbox.canvas.nodes;
sandbox.activeComposerNode=()=>sandbox.nodes.find(node=>node.id==='source');
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('static/js/smart-canvas/canvas-persistence.js','utf8'),sandbox);
const host=fs.readFileSync('static/js/smart-canvas.js','utf8');
vm.runInContext('let composerSubmission=null;\n'+host.slice(
    host.indexOf('async function submitComposerGeneration('),
    host.indexOf('\nfunction syncRunButtonState(',host.indexOf('async function submitComposerGeneration('))),sandbox);
vm.runInContext(`canvasPersistenceConfirmedDocument=canvasPersistenceCompactDocument(canvas);
    canvasPersistenceRevision=0;canvasPersistenceStatusValue='ready';canvasPersistenceSocket=socket;`,sandbox);
const persistence=sandbox.window.SmartCanvasModules.canvasPersistence;
const applier=sandbox.window.SmartCanvasModules.canvasRealtimeApplier;
let providerSubmissions=0;
sandbox.generationRunPersistenceModule=persistence;
sandbox.generationSettingsModule={snapshot:value=>value || {}};
sandbox.generationRunClone=structuredClone;
sandbox.generationRunReferenceSnapshot=value=>value;
sandbox.generationSubmissionAcceptance=()=>async()=>{};
sandbox.resultMediaUrls=values=>values;
sandbox.generationProviderModule={submit:async()=>{
    providerSubmissions++;
    return {state:'completed',outputs:['one.png','two.png']};
}};
const runSource=fs.readFileSync('static/js/smart-canvas/generation-run.js','utf8');
const batchStart=runSource.indexOf('async function submitAndSettleGenerationProviderBatch(');
const batchEnd=runSource.indexOf('\nasync function ',batchStart+1);
vm.runInContext(runSource.slice(batchStart,batchEnd),sandbox);
let receiptDelay=0;
let revision=0;
socket.send=value=>{
    const request=JSON.parse(value);sent.push(request);
    setTimeout(()=>applier.apply({type:'canvas_mutation',operation_id:request.operation.operation_id,
        revision:++revision,changes:request.operation.changes,undoable:true}),receiptDelay);
};
sandbox.generationRun={run:async options=>{
    const slots=[0,1].map(index=>({id:'slot-'+providerSubmissions+'-'+index,type:'smart-image',x:300+index*220,y:0,images:[],pending:1}));
    sandbox.nodes.push(...slots);
    sandbox.testSlots=slots;
    await vm.runInContext('submitAndSettleGenerationProviderBatch(testSlots,"Two cups",[])',sandbox);
    await options.onAccepted?.({node:sandbox.activeComposerNode(),submission:{state:'pending'}});
    return true;
}};
(async()=>{
    assert.equal(await vm.runInContext('submitComposerGeneration()',sandbox),true,failures.join('\n'));
    assert.equal(providerSubmissions,1);
    assert.equal(sandbox.document.activeElement,editor);
    assert.equal(editor.textContent,'Two cups');
    assert.equal(sandbox.nodes.length,3);
    assert.equal(persistence.status().pending,false);
    // Automatic queue resume has no host composerSubmission flag. A delayed
    // cloud acknowledgement beyond the former five-second deadline still admits once.
    receiptDelay=5500;
    assert.equal(await sandbox.generationRun.run({}),true);
    assert.equal(providerSubmissions,2);
    assert.equal(persistence.status().pending,false);
    assert.equal(sandbox.document.activeElement,editor);
    assert.equal(editor.textContent,'Two cups');
    // Already-buffered receipts drain as soon as generation starts waiting.
    sandbox.nodes[0].x=100;
    receiptDelay=0;
    await persistence.save();
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(persistence.status().pending,true);
    assert.equal(await persistence.synced({timeout:250,forGeneration:true}),true);
    // Outside the explicit submission, normal edits still defer remote merges.
    assert.equal(vm.runInContext('canvasPersistenceLocalInteractionActive()',sandbox),true);
    // A title/parameter editor and pointer interactions remain protected.
    vm.runInContext('canvasPersistenceGenerationWaiters=1',sandbox);
    sandbox.document.activeElement={matches:()=>true};
    assert.equal(vm.runInContext('canvasPersistenceLocalInteractionActive()',sandbox),true);
    sandbox.document.activeElement=editor;
    sandbox.selectionState={dragging:true};
    assert.equal(vm.runInContext('canvasPersistenceLocalInteractionActive()',sandbox),true);
    console.log('PASS: focused two-image submission consumes its save receipt once and preserves draft/focus; other editing holds remain');
})().catch(error=>{console.error(error);process.exitCode=1;});
