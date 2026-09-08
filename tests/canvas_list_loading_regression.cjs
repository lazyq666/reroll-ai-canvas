const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.CANVAS_LIST_SOURCE || 'static/js/canvas-list.js', 'utf8');
const loading = source.slice(source.indexOf('async function loadAll(){'), source.indexOf('function handleCanvasListSessionError'));
function deferred(){ let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; }
async function check(){
  const projectResponse = deferred();
  const cards = [{id:'far-away',project:'default',board_x:5000,board_y:4000}];
  const state = {fits:0, renders:0, requests:[], errors:[]};
  const context = vm.createContext({
    Blob, Map, setTimeout, clearTimeout, window:{}, console:{error:error=>state.errors.push(error)},
    performance:{now:()=>0,mark(){}}, currentProjectId:'default', projects:[],canvases:[],currentUser:null,
    canvasPageState:new Map(),canvasListPerformance:{batches:[]},canvasListPageLeaving:false,
    canvasListLoadError:null,canvasListLoadRetryTimer:null,renderBoardEmptyState(){},tr:key=>key,
    newCanvasBtn:{},emptyCreateCanvasBtn:{},newProjectBtn:{},boardLoadMoreBtn:null,
    cachedProjectCanvases:()=>[], cacheProjectCanvases(){},setBoardLoading(){},rememberProjectId(){},
    renderBoard(){state.renders++;},resetView(){state.fits++;}, renderCanvasAdditions(){},renderProjects(){},
    closeNewProject(){}, L:zh=>zh,setStatus(){},refreshTrashCount(){},
    fetch:async url=>{
      state.requests.push(url);
      if(url==='/api/auth/me') return {ok:true,json:async()=>({user:{role:'admin'}})};
      if(url==='/api/projects') return projectResponse.promise;
      return {ok:true,json:async()=>({canvases:cards,total:1})};
    },
  });
  vm.runInContext(loading,context);
  const first = vm.runInContext('refreshCanvasListSession()',context);
  const second = vm.runInContext('refreshCanvasListSession()',context);
  await new Promise(setImmediate);
  assert.equal(state.fits,1,'First cards must be positioned while project statistics are pending');
  assert.equal(state.requests.filter(x=>x.startsWith('/api/canvases?')).length,1,'Focus and boot must share the in-flight load');
  projectResponse.resolve({ok:false});
  await Promise.all([first,second]);
  assert.equal(vm.runInContext('canvases.length',context),1,'A failed statistics request must preserve loaded cards');
  assert.equal(state.fits,1,'Late project response must not reposition the viewport');
  console.log('PASS: immediate positioning, coalesced refresh, cards survive project failure');
}
check().catch(error=>{console.error(error);process.exitCode=1;});
