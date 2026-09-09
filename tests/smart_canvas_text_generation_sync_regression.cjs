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
    for(const slow of [false,true]){
        // Normal prompt focus holds receipts; the persistent text Composer
        // permits receipts but cloud delivery can exceed five seconds.
        ownsEditor=slow;receiptDelay=slow ? 5500 : 0;
        const node={id:'text-'+slow,type:'smart-prompt',x:0,y:400,llmEnabled:true,
            llmInstruction:'Summarize this visual style',llmProvider:'apimart',llmModel:'gemini-3.7-flash'};
        sandbox.nodes.push(node);
        sandbox.testNodeId=node.id;
        const output=await vm.runInContext('runPromptLLMNode(testNodeId)',sandbox);
        assert.ok(output,'Text generation should consume its save receipt and submit: '+JSON.stringify(logs));
        assert.equal(output.text,'Generated style');
        assert.equal(submissions,slow ? 2 : 1);
        assert.equal(sandbox.document.activeElement,editor);
        assert.equal(editor.textContent,'Two cups');
        assert.equal(logs.length,0);
        receiptDelay=0;
        await persistence.save();
        assert.equal(await persistence.synced({forGeneration:true}),true);
    }
    // A lost receipt must still prevent submission and retain retryable input.
    dropReceipts=true;
    sandbox.canvasPersistence={...persistence,synced:options=>persistence.synced({...options,timeout:250})};
    const stalled={id:'stalled',type:'smart-prompt',x:0,y:800,llmEnabled:true,
        llmInstruction:'Keep this input',llmProvider:'apimart',llmModel:'gemini-3.7-flash'};
    sandbox.nodes.push(stalled);
    assert.equal(await vm.runInContext("runPromptLLMNode('stalled')",sandbox),null);
    assert.equal(submissions,2);
    assert.equal(stalled.llmInstruction,'Keep this input');
    assert.equal(stalled.running,false);
    assert.equal(stalled.generationFailed,true);
    assert.equal(logs.at(-1).tasks[0].errorCode,'canvas_sync_incomplete');
    console.log('PASS: text generation submits once with focused editor and delayed sync receipt; input and focus survive');
})().catch(error=>{console.error(error);process.exitCode=1;});
