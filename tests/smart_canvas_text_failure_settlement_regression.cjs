const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sent = [];
const failures = [];
const localRecords = new Map();
const editor = {textContent:'Two cups', matches:()=>true, contains:element=>element===editor};
const initial = {title:'Test', icon:'', nodes:[{id:'source',type:'smart-image',x:0,y:0,images:[]}], connections:[], settings:{}};
const socket = {readyState:1,send:value=>sent.push(JSON.parse(value))};
const sandbox = {
    window:{WebSocket:{OPEN:1},addEventListener(){},
        localStorage:{getItem:key=>localRecords.get(key)||null,setItem:(key,value)=>localRecords.set(key,value),removeItem:key=>localRecords.delete(key)},
        SmartCanvasModules:{canvasMutation:{history(){}},
            nodeGeometry:require('../static/js/smart-canvas/node-geometry.js')}},
    document:{activeElement:editor,addEventListener(){},getElementById:()=>null},
    canvasId:'test',smartClientId:'focus-test',canvas:structuredClone(initial),nodes:[],
    settings:{},initialSmartSettings:{},canvasDefaultSmartSettings:{},selectionState:null,
    lastComposerNodeId:'source:node',promptInput:editor,composerFocusRevision:1,
    socket,
    normalizeLegacySmartNode:node=>({...node}),cloneSmartSettings:structuredClone,
    savePromptDraftForCurrent(){},stripImageGenerationMeta:item=>({...item}),
    mediaItemForStorage:item=>({...item}),settingsForStorage:value=>({...value}),
    render(){},scheduleConnectionLayerRefresh(){},tr:key=>key,toast:message=>failures.push(message),
    setTimeout,clearTimeout,setInterval,clearInterval,Date,JSON,Promise,
};
sandbox.nodes=sandbox.canvas.nodes;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('static/js/smart-canvas/canvas-persistence.js','utf8'),sandbox);
const host=fs.readFileSync('static/js/smart-canvas.js','utf8');
vm.runInContext(`canvasPersistenceConfirmedDocument=canvasPersistenceCompactDocument(canvas);
    canvasPersistenceRevision=0;canvasPersistenceStatusValue='ready';canvasPersistenceSocket=socket;`,sandbox);
const persistence=sandbox.window.SmartCanvasModules.canvasPersistence;
const applier=sandbox.window.SmartCanvasModules.canvasRealtimeApplier;

let submissions=0;
let revision=0;
let receiptDelay=0;
let ownsEditor=false;
let dropReceipts=false;
sandbox.window.SmartCanvasModules.promptGenerationComposer={owns:()=>ownsEditor};
socket.send=value=>{
    const request=JSON.parse(value);sent.push(request);
    if(dropReceipts) return;
    setTimeout(()=>applier.apply({type:'canvas_mutation',operation_id:request.operation.operation_id,
        revision:++revision,changes:request.operation.changes,undoable:true}),receiptDelay);
};
sandbox.canvasPersistence=persistence;
sandbox.nowMs=()=>Date.now();
sandbox.smartCatalogEntry=()=>true;
sandbox.promptNodeLLMInputText=node=>node.llmInstruction;
sandbox.promptNodeInputMediaForLLM=()=>[{url:'reference.png'}];
sandbox.imageRefsOnly=refs=>refs;
sandbox.videoRefsOnly=()=>[];
sandbox.smartRunSnapshot=()=>({generationRunId:'local-run'});
sandbox.canvasMutation={history(){}};
sandbox.fetch=async()=>{
    assert.equal(persistence.status().pending,false);
    submissions++;
    return {ok:true,json:async()=>({task_id:'accepted-'+submissions})};
};
sandbox.window.SmartCanvasModules.generationRecovery={settle:async({node})=>{
    node.text='Generated style';delete node.textGenerationPending;
}};
const logs=[];
sandbox.addSmartGenerationLog=entry=>{logs.push(entry);return {id:'log'};};
const start=host.indexOf('async function runPromptLLMNode(');
vm.runInContext(host.slice(start,host.indexOf('\nfunction ungroupNode(',start)),sandbox);

(async()=>{
    dropReceipts=true;
    const mode=process.argv[2] || 'ready';
    sandbox.canvasPersistence={...persistence,synced:async()=>{
        if(mode==='error') vm.runInContext("canvasPersistenceStatusValue='error'",sandbox);
        return false;
    }};
    const stalled={id:'stalled',type:'smart-prompt',x:0,y:800,llmEnabled:true,
        llmInstruction:'Keep this input',llmProvider:'apimart',llmModel:'gemini-3.7-flash'};
    sandbox.nodes.push(stalled);
    await vm.runInContext("runPromptLLMNode('stalled')",sandbox);
    // A subsequent rejected edit must not resurrect the completed cleanup.
    persistence.schedule();
    const live=sandbox.nodes.find(node=>node.id==='stalled');
    const output={mode,providerSubmissions:submissions,errorCode:logs.at(-1).tasks[0].errorCode,
      running:live.running,textGenerationPending:live.textGenerationPending,
      generationFailed:live.generationFailed,retainedInput:live.llmInstruction};
    console.log(JSON.stringify(output));
    assert.equal(submissions,0);
    assert.equal(output.running,false);
    assert.equal(Boolean(output.textGenerationPending),false);
    assert.equal(Boolean(output.generationFailed),true);
    const restored=vm.runInContext('canvasPersistenceRestoreLocal(canvasPersistenceDiffBaseline())',sandbox);
    const restoredNode=restored.nodes.find(node=>node.id==='stalled');
    if(mode==='error'){
        assert.equal(restoredNode.running,false);
        assert.equal(Boolean(restoredNode.textGenerationPending),false);
        assert.equal(restoredNode.generationFailed,true);
    }
    vm.runInContext('clearTimeout(canvasPersistenceSaveTimer)',sandbox);
})().catch(error=>{console.error(error);process.exitCode=1;});
