const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {performance} = require('node:perf_hooks');
const persistenceSource = fs.readFileSync(process.env.PERSISTENCE_SOURCE || 'static/js/smart-canvas/canvas-persistence.js','utf8');
const generationSource = fs.readFileSync('static/js/smart-canvas/generation-run.js','utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function functionSource(source,start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
async function opening(){
  const events=[];
  const started=performance.now();
  const record=event=>events.push({event,ms:Math.round(performance.now()-started)});
  const doc={id:'probe',title:'Probe',revision:2,nodes:[{id:'node',type:'smart-image',pending:1,images:[]}],connections:[]};
  let activeRequestStarted=false;
  let documentDelivered=false;
  let appliedAfterDocument=false;
  let requests=0;
  const context=vm.createContext({
    canvasId:'probe',canvas:null,nodes:[],settings:{},
    window:{SmartCanvasModules:{canvasOpening:{
      async open(){record('document request');await delay(100);documentDelivered=true;record('document received');return clone(doc);},
      hydrating(){},ready(){record('ready');},fail(error){throw error;}
    },viewportSelection:{viewport:{restore(){},apply(){}}}}},
    document:{getElementById:()=>null},
    fetch:async()=>{requests++;activeRequestStarted=true;record('task request');await delay(100);return {ok:true,json:async()=>({runs:[{id:'run'}]})};},
    activeGenerationRecoveryModule:()=>({restoreActive({runs}){appliedAfterDocument=documentDelivered;assert.equal(runs.length,1);record('apply tasks');return true;}}),
    canvasPersistenceRestoreOpeningOutline:value=>value,
    canvasPersistenceCompactDocument:clone,canvasPersistenceClone:clone,canvasPersistenceRestoreLocal:clone,
    canvasPersistenceReadLocal:()=>null,canvasPersistenceEmptyChanges:()=>({}),rememberCanvasListProject(){},
    normalizeLegacySmartNode:node=>node,
    canvasPersistenceSmartMatting:()=>({isActive:()=>false,resume(){}}),
    smartNodeHasDisplayResult:()=>false,markSmartNodeComplete(){},clearSmartNodeBusyState(){},
    clearCompletedNodeBusyStates:()=>false,recoverStuckLoopOutputsFromLogs:()=>false,
    hideCompletedRunTimers:()=>false,cleanupDetachedRunInputRefs:()=>false,
    normalizeSmartVideoModeSettings(){},cloneSmartSettings:clone,loadRecentSmartSettings(){},updateProviderModels(){},
    render(){record('render');},canvasPersistenceSharedDocument:()=>clone(doc),
    canvasPersistenceApplyChanges:clone,canvasPersistenceDiff:()=>({}),canvasPersistenceConnect(){record('connect');},
    canvasPersistenceSetStatus(){},toast(){},canvasPersistenceText:key=>key,
  });
  const start=generationSource.includes('async function generationRunReadActive')?'async function generationRunReadActive':'async function generationRunRestoreActive';
  vm.runInContext(functionSource(generationSource,start,'function generationRunFailureDetail'),context);
  context.canvasPersistenceGenerationRun=()=>({
    readActive:context.generationRunReadActive,restoreActive:context.generationRunRestoreActive,
    pendingTasks:()=>[{id:'run'}],resume(){},
  });
  vm.runInContext(functionSource(persistenceSource,'async function canvasPersistenceLoad(){','function canvasPersistenceReceive('),context);
  const loaded=context.canvasPersistenceLoad();
  await delay(5);
  const startedInParallel=activeRequestStarted&&!documentDelivered;
  await loaded;
  const result={startedInParallel,appliedAfterDocument,requests,events};
  console.log(JSON.stringify(result));
  assert.ok(startedInParallel,'Task discovery must start alongside the document request');
  assert.ok(appliedAfterDocument,'Task state must apply after document/draft hydration');
  assert.equal(requests,1,'Task discovery must not be fetched twice');
  assert.equal(events.filter(item=>item.event==='render').length,1);
}
opening().catch(error=>{console.error(error);process.exitCode=1;});

async function supportingData(){
  const host=fs.readFileSync(process.env.HOST_SOURCE || 'static/js/smart-canvas.js','utf8');
  let release;
  let nodeRenders=0, configSyncs=0;
  const pending=new Promise(resolve=>{release=resolve;});
  const context=vm.createContext({
    window:{SmartCanvasModules:{canvasOpening:{prepare(){}}},InfiniteCanvasUiNodeComponents:{render(){}},StudioI18n:{apply(){}},StudioTheme:{get:()=> 'light'}},
    customElements:{get:()=>true},smartCanvasNodeReviewMode:false,
    configureSmartCanvasVirtualization(){},applyTheme(){},loadPromptPresets(){},loadPromptTemplateGroups(){},loadPromptTemplateOverrides(){},
    loadPromptTemplates:()=>pending,loadConfig:()=>pending,
    canvasPersistence:{async load(){nodeRenders++;return {id:'ready'};}},
    smartLayerDecomposition:{resume(){}},syncApiKindToggleVisibility(){configSyncs++;},render(){nodeRenders++;},
  });
  vm.runInContext(host.slice(host.lastIndexOf('window.onload = async () => {')),context);
  const boot=context.window.onload();
  await new Promise(setImmediate);
  assert.equal(nodeRenders,1);
  release();await boot;
  assert.equal(configSyncs,1,'Supporting controls must still synchronize');
  assert.equal(nodeRenders,1,'Supporting data must not trigger an unrelated full Node render');
  console.log('PASS: supporting controls synchronize without another full Node render');
}
supportingData().catch(error=>{console.error(error);process.exitCode=1;});
