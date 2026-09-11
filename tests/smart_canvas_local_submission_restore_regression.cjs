const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sent = []; let saved = null;
const failures = [];
const editor = {textContent:'Two cups', matches:()=>true, contains:element=>element===editor};
const initial = {title:'Test', icon:'', nodes:[{id:'source',type:'smart-image',x:0,y:0,images:[]}], connections:[], settings:{}};
const socket = {readyState:1,send:value=>sent.push(JSON.parse(value))};
const sandbox = {
    window:{WebSocket:{OPEN:1},addEventListener(){},
        localStorage:{getItem:()=>saved,setItem:(key,value)=>{saved=value;},removeItem:()=>{saved=null;}},
        SmartCanvasModules:{canvasMutation:{history(){}},localGenerationSubmissions:{identity:()=>({workspace_id:'workspace',actor_id:'alice'})},
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

const source=fs.readFileSync('static/js/smart-canvas/canvas-persistence.js','utf8');
vm.runInContext(`canvasPersistenceConfirmedDocument=canvasPersistenceCompactDocument(canvas);
 canvasPersistenceRevision=0;canvasPersistenceStatusValue='ready';canvasPersistenceSocket=socket;`,sandbox);
sandbox.nodes.push({id:'first',type:'smart-image',x:300,y:0,images:[],generationOperationId:'run-first'});
const first=sandbox.window.SmartCanvasModules.canvasPersistence.sealGeneration();
sandbox.nodes.push({id:'second',type:'smart-image',x:600,y:0,images:[],generationOperationId:'run-second'});
const second=sandbox.window.SmartCanvasModules.canvasPersistence.sealGeneration();
assert.equal(second.length,2);
const originalIds=second.map(operation=>operation.operation_id);
assert.equal(new Set(originalIds).size,2);
// Run the real opening hydration sequence against an older cloud snapshot.
sandbox.canvas=structuredClone(initial);sandbox.nodes=sandbox.canvas.nodes;
vm.runInContext('canvasPersistenceInFlight=null;canvasPersistenceSealedOperations.length=0;',sandbox);
const start=source.indexOf('        canvasPersistenceConfirmedDocument = canvasPersistenceCompactDocument(',source.indexOf('async function canvasPersistenceLoad('));
const end=source.indexOf('        document.title =',start);
vm.runInContext('{'+source.slice(start,end)+'}',sandbox);
assert.deepEqual(JSON.parse(saved).operations.map(operation=>operation.operation_id),Array.from(originalIds),'refresh must preserve original Canvas operation IDs');
assert.deepEqual(Array.from(sandbox.canvas.nodes,node=>node.id),['source','first','second']);
// The actual node render cache must notice receipt-only state changes.
const host=fs.readFileSync('static/js/smart-canvas.js','utf8');
const a=host.indexOf('function smartCanvasNodeRenderSignature('),b=host.indexOf('function smartCanvasActiveEditorWithin(',a);
sandbox.smartCanvasNodeUsesFarPresentation=()=>false;
let receipt=null;
sandbox.window.SmartCanvasModules.localGenerationSubmissions.forNode=()=>receipt;
vm.runInContext(host.slice(a,b),sandbox);
const before=vm.runInContext('smartCanvasNodeRenderSignature(canvas.nodes[1])',sandbox);
receipt={status:'syncing',id:'receipt'};
assert.notEqual(vm.runInContext('smartCanvasNodeRenderSignature(canvas.nodes[1])',sandbox),before);
console.log('PASS: refresh preserves sealed operation identities and receipt-only changes invalidate node rendering');
