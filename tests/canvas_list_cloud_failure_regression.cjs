const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.CANVAS_LIST_SOURCE || 'static/js/canvas-list.js','utf8');
const loading = source.slice(source.indexOf('async function loadAll(){'),source.indexOf('function handleCanvasListSessionError'));
const rendering = source.slice(source.indexOf('function renderBoard(){'),source.indexOf('function renderCanvasBatch('));
const values = {};
const dictionary = {};
const timers = [];
let failing = true;
let language = 'zh';
const context = vm.createContext({
  Blob, Map, clearTimeout(){},setTimeout(fn){timers.push(fn);return timers.length;},console:{error(){}},
  window:{StudioI18n:{register:entries=>Object.assign(dictionary,entries)}},
  tr:key=>dictionary[key]?.[language] || key,L:(zh,en)=>language==='zh'?zh:en,
  performance:{now:()=>0,mark(){}},currentProjectId:'default',projects:[],canvases:[],currentUser:{role:'admin'},
  canvasPageState:new Map(),canvasListPerformance:{batches:[]},canvasListPageLeaving:false,
  canvasListLoadError:null,canvasListLoadRetryTimer:null,renderBatchToken:0,
  newCanvasBtn:{},emptyCreateCanvasBtn:{hidden:false},newProjectBtn:{},boardLoadMoreBtn:null,
  boardWorld:{},boardEmptyHint:{setAttribute:(key,value)=>values[key]=value,
    querySelector:()=>({setAttribute:(key,value)=>values['description:'+key]=value,set textContent(value){values.description=value;}}),classList:{toggle:(_key,value)=>values.hidden=value}},
  canvasesInProject(){return context.canvases;},cachedProjectCanvases:()=>[],cacheProjectCanvases(){},
  setBoardLoading(){},rememberProjectId(){},updateBoardHeader(){},autoLayoutNulls(){},renderCanvasBatch(){},
  resetView(){},renderProjects(){},updatePasteBtn(){},refreshIcons(){},closeNewProject(){},setStatus(){},refreshTrashCount(){},
  fetch:async url=>url==='/api/projects'
    ? {ok:true,json:async()=>({projects:[{id:'default'}]})}
    : {ok:!failing,status:failing?503:200,json:async()=>failing
      ? {code:'cloud_storage_reconnecting'}
      : {canvases:[{id:'existing',project:'default'}],total:1}},
});
for(const name of ['workspace','cloud-storage']) vm.runInContext(fs.readFileSync(`static/js/i18n/${name}.js`,'utf8'),context);
vm.runInContext(loading+'\n'+rendering,context);
(async()=>{
  await vm.runInContext('loadAll()',context);
  vm.runInContext('renderBoard()',context);
  assert.equal(values.title,'画布暂时无法加载','A 503 must not claim the account has no projects');
  assert.match(values.description,/重新连接/);
  assert.equal(values['description:data-i18n'],'cloudStorage.cloud_storage_reconnecting','Late i18n application must retain the error description');
  assert.equal(context.emptyCreateCanvasBtn.hidden,true,'Do not suggest creating a replacement for unreadable canvases');
  language='en';vm.runInContext('renderBoard()',context);
  assert.equal(values.title,'Canvases could not be loaded');
  assert.match(values.description,/Reconnecting/);
  assert.equal(timers.length,1,'Schedule one retry for a transient storage failure');
  failing=false;
  await vm.runInContext('loadAll()',context);
  assert.equal(context.canvases.length,1);
  assert.equal(context.canvasListLoadError,null);
  assert.equal(values.hidden,true);
  console.log('PASS: storage failure is distinct from empty access; bilingual feedback and retry recovery preserve the canvas');
})().catch(e=>{console.error(e);process.exitCode=1;});
