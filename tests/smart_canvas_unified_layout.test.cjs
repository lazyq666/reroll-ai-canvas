const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const clone = value => JSON.parse(JSON.stringify(value));
const source = (id,x=0,y=0) => ({id,type:'smart-image',x,y,w:100,h:100,images:[{url:`${id}.png`} ]});
function load(context,name){
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/js/smart-canvas',name+'.js'),'utf8'),context);
}
function context(nodes){
    const events = [];
    const sandbox = {
        nodes:clone(nodes),canvas:{title:'Canvas',connections:[],settings:{}},
        selectedId:'',selectedIds:nodes.map(node=>node.id),selectedImage:{nodeId:'',index:-1},
        activeComposerSubject:null,lastComposerNodeId:'',canvasDefaultSmartSettings:{},initialSmartSettings:{},
        SmartCanvasModules:{canvasPersistence:{schedule:()=>events.push('schedule'),save:()=>events.push('save')}},
        document:{activeElement:null,addEventListener:()=>{},getElementById:()=>null},
        addEventListener:()=>{},localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},
        setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,clearInterval:()=>{},
        canvasId:'test',smartClientId:'test-client',selectionState:null,
        render:()=>events.push('render'),toast:()=>{},tr:key=>key,
        nodeRect:node=>({x:node.x||0,y:node.y||0,width:node.w||100,height:node.h||100}),
        isSmartImageNode:node=>node.type==='smart-image',isEditableTarget:()=>false,
        savePromptDraftForCurrent:()=>{},stripImageGenerationMeta:clone,mediaItemForStorage:clone,
        settingsForStorage:value=>clone(value||{}),normalizeLegacySmartNode:clone,cloneSmartSettings:clone,
        events
    };
    sandbox.canvas.nodes=sandbox.nodes;
    sandbox.window=sandbox;
    vm.createContext(sandbox);
    return sandbox;
}
function mutation(nodes){
    const sandbox=context(nodes);
    for(const name of ['node-geometry','node-placement','canvas-mutation']) load(sandbox,name);
    return sandbox;
}
const geometry=require('../static/js/smart-canvas/node-geometry.js');
const placement=require('../static/js/smart-canvas/node-placement.js');
const arrange=require('../static/js/smart-canvas/selection-arrangement.js');
function plan(nodes,drafts,intent){return placement.plan({snapshot:{nodes},drafts,intent});}
const downstream={anchor:{kind:'source',sourceNodeIds:['p']},relation:'downstream',arrangement:'single'};
function projection(s){
    s.SmartCanvasModules.smartContainer={reconcileFrames:()=>{
        for(const frame of geometry.frameMembership(s.nodes)) s.nodes.find(n=>n.id===frame.id).items=frame.items;
    }};
}
test('G is 4rem at the 16px canvas baseline with one shared code authority',()=>{
    assert.equal(geometry.nodeGap,require('../static/js/smart-canvas/layout-constants.json').nodeGap);
    assert.equal(geometry.nodeGap,4 * 16);
    require('node:child_process').execFileSync('python3',['scripts/sync_smart_canvas_layout_constants.py','--check']);
});
test('explicit center and both port attachments preserve fractional occupied points, even upstream',()=>{
    const obstacle=source('obstacle',-400,-100), before=clone(obstacle);
    for(const [attachment,expected] of [['center',[-450.25,-125.5]],['left-middle',[-400.25,-125.5]],['right-middle',[-500.25,-125.5]]]){
        const result=plan([obstacle],[{...source('new'),h:50}],{...downstream,
            anchor:{kind:'point',x:-400.25,y:-100.5,attachment}});
        assert.equal(result.ok,true);
        assert.deepEqual([result.placements[0].x,result.placements[0].y],expected);
    }
    assert.deepEqual(obstacle,before);
});
test('viewport improves visibility within exactly one G; direction and source snapshot remain fixed',()=>{
    const p=source('p',0,450), draft=source('new');
    const intent={...downstream,viewport:{x:0,y:0,width:600,height:500}};
    let result=plan([p],[draft],intent);
    assert.deepEqual([result.placements[0].x,result.placements[0].y],[164,400]);
    p.y=550;
    result=plan([p],[draft],intent);
    assert.deepEqual([result.placements[0].x,result.placements[0].y],[164,486]);
    assert.equal(Math.hypot(result.placements[0].x-164,result.placements[0].y-550),64);
    // A viewport to the left cannot override downstream direction.
    result=plan([p],[draft],{...intent,viewport:{x:-1000,y:0,width:800,height:500}});
    assert.ok(result.placements[0].x>=164);
});
test('input order does not alter multi-parent bounds or deterministic placement',()=>{
    const nodes=[source('p',0),source('q',300,50)];
    const intent={...downstream,anchor:{kind:'source',sourceNodeIds:['p','q']}};
    const first=plan(nodes,[source('new')],intent);
    assert.deepEqual(first.placements,[{id:'new',x:464,y:0}]);
    assert.deepEqual(plan(nodes.toReversed(),[source('new')],intent).placements,first.placements);
});
test('previous batches far away do not pull new results away from the parent',()=>{
    for(const layout of ['horizontal','vertical']){
        const old={...source('old',5000,2000),generationBatchId:'old-batch',generationBatchLayout:layout,generationBatchSourceNodeId:'p'};
        const drafts=[source('a'),source('b')].map(n=>({...n,generationBatchId:'new-batch',generationBatchSourceNodeId:'p'}));
        const result=plan([source('p'),old],drafts,{...downstream,arrangement:layout+'-batch'});
        assert.deepEqual(result.placements[0],{id:'a',x:164,y:0});
        assert.equal(layout==='horizontal' ? result.placements[1].x-164-100 : result.placements[1].y-100,64);
        assert.deepEqual([old.x,old.y],[5000,2000]);
    }
});
test('only the direct Frame expands; spatial projection absorbs outsiders without moving or cascading',()=>{
    const parent={id:'parent',type:'smart-frame',x:-100,y:-100,w:700,h:500,items:['frame']};
    const frame={id:'frame',type:'smart-frame',x:0,y:0,w:300,h:250,items:['p']};
    const p=source('p',150,100), outsider=source('outside',450,100);
    const s=mutation([parent,frame,p,outsider]); projection(s);
    const before=clone(s.nodes);
    s.SmartCanvasModules.canvasMutation.createBatch({drafts:[source('new')],intent:downstream,options:{render:false,save:false}});
    assert.deepEqual([s.nodes[0].x,s.nodes[0].y,s.nodes[0].w,s.nodes[0].h],[-100,-100,700,500]);
    const enlarged=s.nodes.find(n=>n.id==='frame');
    assert.ok(enlarged.w>300 || enlarged.h>250);
    assert.deepEqual(s.nodes.find(n=>n.id==='outside'),outsider);
    assert.equal(s.SmartCanvasModules.canvasMutation.history({action:'undo'}),true);
    assert.deepEqual(clone(s.nodes),before);
});
test('equal Frame areas use stable IDs; cross-direct-frame sources do not inherit their ancestor',()=>{
    const frames=['z','a'].map(id=>({id,type:'smart-frame',x:0,y:0,w:400,h:400,items:[]}));
    assert.deepEqual(geometry.frameMembership([...frames,source('p',100,100)]).find(f=>f.id==='a').items,['p']);
    assert.deepEqual(geometry.frameMembership([...frames.toReversed(),source('p',100,100)]).find(f=>f.id==='a').items,['p']);
    const nodes=[{id:'outer',type:'smart-frame',x:-100,y:-100,w:1000,h:1000,items:['a','b']},
        {...frames[1],items:['p']},{...frames[0],id:'b',x:500,items:['q']},source('p'),source('q',500)];
    const result=plan(nodes,[source('new')],{...downstream,anchor:{kind:'source',sourceNodeIds:['p','q']}});
    assert.deepEqual(result.frameUpdates,[]);
});
test('group children are projected to owners for sources and do not enlarge rigid copy bounds',()=>{
    const group={...source('group',100,100),type:'smart-group',items:['child']};
    const child=source('child',-2000,-2000);
    const result=plan([group,child],[source('new')],{...downstream,anchor:{kind:'source',sourceNodeIds:['child']}});
    assert.deepEqual(result.placements,[{id:'new',x:264,y:100}]);
    const copied=plan([],[group,child],{anchor:{kind:'point',x:300,y:300},arrangement:'rigid'});
    assert.deepEqual(copied.bounds,{x:250,y:250,width:100,height:100});
    const byId=new Map(copied.placements.map(n=>[n.id,n]));
    assert.equal(byId.get('child').x-byId.get('group').x,-2100);
});
test('arranging preserves its anchor and allows an outsider to occupy a new slot',()=>{
    const nodes=[source('a',20,30),source('b',1000,30),source('outside',184,30)];
    const result=arrange.plan({nodes,selectedIds:['a','b'],mode:'horizontal'});
    assert.deepEqual(result.placements.map(n=>[n.id,n.x,n.y]),[['a',20,30],['b',184,30]]);
    assert.equal(nodes[2].x,184);
});
test('serialized exact intent survives rebuilding pending changes after reload',()=>{
    const s=context([]); load(s,'node-geometry');load(s,'node-placement');load(s,'canvas-persistence');
    s.before={nodes:[source('occupied',50,50)],connections:[]};
    s.pending={node_creates:[{node:source('new',50,50),placement:{mode:'exact',gap:64,collectionId:'new'}}]};
    const result=vm.runInContext(`(()=>{
        const after=canvasPersistenceApplyChanges(before,pending);
        const changes=canvasPersistenceDiff(before,after);
        canvasPersistenceReplanCreatedNodes(changes,before);
        return changes;
    })()`,s);
    assert.equal(result.node_creates[0].placement.mode,'exact');
    assert.deepEqual([result.node_creates[0].node.x,result.node_creates[0].node.y],[50,50]);
});
test('concurrent retry keeps exact coordinates, unions Frame expansions and recomputes membership once',()=>{
    const s=context([]); load(s,'node-geometry');load(s,'node-placement');load(s,'canvas-persistence');
    s.before={nodes:[{id:'frame',type:'smart-frame',x:-200,y:0,w:500,h:500,items:[]},source('outside',200,100)],connections:[]};
    s.pending={node_creates:[{node:source('new',300,100),placement:{mode:'exact',gap:64,intent:{frameId:'frame'}}}],
        node_updates:[{id:'frame',path:['x'],value:0},{id:'frame',path:['w'],value:450}]};
    const result=vm.runInContext(`(()=>{
        canvasPersistenceReplanCreatedNodes(pending,before);
        return canvasPersistenceApplyChanges(before,pending);
    })()`,s);
    const frame=result.nodes[0];
    assert.deepEqual([frame.x,frame.w],[-200,650]);
    assert.deepEqual(clone(frame.items),['outside','new']);
    assert.deepEqual([result.nodes.at(-1).x,result.nodes.at(-1).y],[300,100]);
});
test('automatic retry uses frozen viewport and keeps a reused seed fixed',()=>{
    const s=context([]); load(s,'node-geometry');load(s,'node-placement');load(s,'canvas-persistence');
    s.before={nodes:[source('p',0,450),source('seed',800,800),source('winner',164,400)],connections:[]};
    s.pending={node_creates:[{node:source('new',164,400),placement:{mode:'auto',gap:64,collectionId:'new',
        intent:{...downstream,viewport:{x:0,y:0,width:600,height:500},frameId:''}}}],connection_adds:[{from:'p',to:'new',kind:'input'}]};
    s.SmartCanvasModules.viewportSelection={viewport:{bounds:()=>({x:2000,y:2000,width:600,height:500})}};
    const result=vm.runInContext(`(()=>{
        canvasPersistenceReplanCreatedNodes(pending,before);
        return canvasPersistenceApplyChanges(before,pending);
    })()`,s);
    const seed=result.nodes.find(n=>n.id==='seed'),n=result.nodes.find(n=>n.id==='new');
    assert.deepEqual([seed.x,seed.y],[800,800]);
    assert.ok(n.x>=164 && n.y<550);
    assert.equal(s.pending.node_creates[0].placement.intent.viewport.x,0);
});
test('generation resolves all actual parents and reuses the first node without moving it',()=>{
    const s=mutation([source('p'),source('q',300),{...source('seed',900,700),images:[],referenceGenerationKind:'image'}]);
    s.canvas.connections=[{from:'p',to:'seed',kind:'input'},{from:'q',to:'seed',kind:'input'}];
    Object.assign(s,{pendingBoxSize:()=>({w:100,h:100}),MEDIA_NODE_DEFAULT_SCALE:2,nowMs:()=>100,
        attachRunMeta:()=>{},uid:(()=>{let i=0;return p=>p+'-'+(++i);})()});
    s.SmartCanvasModules.generationPending={};
    load(s,'generation-output');
    const seed=s.nodes.find(n=>n.id==='seed');
    const outputs=s.SmartCanvasModules.generationOutput.createPendingBatch({sourceNode:seed,expectedCount:3,reuseSource:true});
    assert.equal(outputs[0],seed);
    assert.deepEqual([seed.x,seed.y],[900,700]);
    assert.deepEqual([outputs[1].x,outputs[1].y],[464,0]);
    assert.equal(outputs[2].x-outputs[1].x-outputs[1].w,64);
    assert.deepEqual(clone(s.SmartCanvasModules.canvasMutation.placementIntent({nodeId:outputs[1].id}).intent.anchor.sourceNodeIds),['p','q']);
});
test('invalid batch endpoints and invalid explicit anchors leave the canvas and Undo untouched',()=>{
    const s=mutation([source('p')]), api=s.SmartCanvasModules.canvasMutation;
    const before=clone(s.nodes);
    assert.throws(()=>api.createBatch({drafts:[source('a')],intent:downstream,connections:[{fromId:'missing',toId:'a'}]}));
    assert.deepEqual(clone(s.nodes),before);
    assert.equal(api.history({action:'undo'}),false);
    const invalid=plan([],[source('new')],{anchor:{kind:'point',x:Infinity,y:1}});
    assert.equal(invalid.ok,false);
});
test('a failed initial multi-result placement restores a reused seed completely',()=>{
    const s=mutation([{...source('seed'),images:[],referenceGenerationKind:'image'}]);
    Object.assign(s,{pendingBoxSize:()=>({w:100,h:100}),MEDIA_NODE_DEFAULT_SCALE:2,nowMs:()=>100,attachRunMeta:()=>{},uid:p=>p+'-id'});
    s.SmartCanvasModules.generationPending={};load(s,'generation-output');
    const seed=s.nodes[0],before=clone(seed);
    s.SmartCanvasModules.nodePlacement={plan:()=>({ok:false})};
    assert.throws(()=>s.SmartCanvasModules.generationOutput.createPendingBatch({sourceNode:seed,expectedCount:2,reuseSource:true}));
    assert.deepEqual(clone(seed),before);
    assert.equal(s.nodes.length,1);
});
test('duplicate uses its original as an automatic source, retaining center alignment as a preference',()=>{
    const s=mutation([source('far',4000,4000)]);
    s.uid=()=> 'copy';s.clearSmartNodeTransientRunState=()=>{};s.clearDetachedRunInputRefs=()=>{};s.demoteHistoryGroupNode=()=>{};s.isHistoryGroupNode=()=>false;
    s.SmartCanvasModules.viewportSelection={viewport:{center:()=>({x:500,y:500})}};
    const result=s.SmartCanvasModules.canvasMutation.duplicate({nodeIds:['far'],mode:'offset'});
    assert.deepEqual([result.nodes[0].x,result.nodes[0].y],[4164,4000]);
    assert.equal(s.SmartCanvasModules.canvasMutation.placementIntent({nodeId:'copy'}).mode,'auto');
});
test('losing the source during a placement retry cancels the pending graph and finishes resync',()=>{
    const s=context([source('p'),source('new',164)]);
    s.canvas.connections=[{from:'p',to:'new',kind:'input'}];
    for(const name of ['node-geometry','node-placement','canvas-persistence'])load(s,name);
    s.SmartCanvasModules.canvasMutation={placementIntent:()=>({mode:'auto',gap:64,intent:downstream}),history:()=>{}};
    vm.runInContext(`
        canvasPersistenceConfirmedDocument={nodes:[nodes[0]],connections:[]};
        canvasPersistencePlacementRetryPending=true;
        canvasPersistencePendingSave=true;
        canvasPersistenceSetStatus=()=>{};
        canvasPersistenceGenerationRun=()=>({resume:()=>{}});
        canvasPersistenceSmartMatting=()=>({resume:()=>{}});
        canvasPersistenceReconcileTerminalGenerationState=()=>{};
        canvasPersistenceAssignDocument=value=>{canvas=value;nodes=value.nodes;};
        canvasPersistenceApplySnapshot({revision:2,canvas:{nodes:[],connections:[]}});
    `,s);
    assert.equal(s.nodes.length,0);
    assert.equal(vm.runInContext('canvasPersistencePlacementRetryPending',s),false);
    assert.equal(vm.runInContext('canvasPersistencePendingSave',s),false);
});

test('duplicate and generated results share avoidance, viewport scoring and source identity',()=>{
    for(const scenario of [
        {nodes:[source('p',10,20)],viewport:null},
        {nodes:[source('p',10,20),source('occupied',174,20)],viewport:null},
        {nodes:[source('p',10,450)],viewport:{x:0,y:0,width:800,height:500}},
        {nodes:[source('p',10,450),source('occupied',174,400)],viewport:{x:0,y:0,width:800,height:500}}
    ]){
        const s=mutation(scenario.nodes);
        s.uid=()=> 'copy';s.clearSmartNodeTransientRunState=()=>{};s.clearDetachedRunInputRefs=()=>{};s.demoteHistoryGroupNode=()=>{};s.isHistoryGroupNode=()=>false;
        s.SmartCanvasModules.viewportSelection={viewport:{bounds:()=>scenario.viewport}};
        const copy=s.SmartCanvasModules.canvasMutation.duplicate({nodeIds:['p']}).nodes[0];
        const metadata=clone(s.SmartCanvasModules.canvasMutation.placementIntent({nodeId:'copy'}));
        assert.equal(metadata.mode,'auto');
        assert.deepEqual(metadata.intent.anchor,{kind:'source',sourceNodeIds:['p']});
        // A same-sized generated result uses the existing single-result intent.
        const generated=plan(scenario.nodes,[source('result')],{...downstream,viewport:scenario.viewport});
        assert.deepEqual([copy.x,copy.y],[generated.placements[0].x,generated.placements[0].y]);
        if(scenario.nodes[1])assert.ok(copy.x!==scenario.nodes[1].x || copy.y!==scenario.nodes[1].y);
    }
});
test('relative source center alignment is an initial preference for unequal heights',()=>{
    const result=plan([source('p',10,20)],[{...source('copy'),h:40}],{
        ...downstream,alignment:'center',arrangement:'rigid'});
    assert.deepEqual(result.placements,[{id:'copy',x:174,y:50}]);
});
test('multi-selection duplication moves the rigid collection beside the whole original bounds',()=>{
    const result=plan([source('a',10,20),source('b',50,60)],
        [source('a-copy',10,20),source('b-copy',50,60)],{
            alignment:'center',anchor:{kind:'source',sourceNodeIds:['a','b']},arrangement:'rigid'});
    assert.deepEqual(result.placements,[{id:'a-copy',x:214,y:20},{id:'b-copy',x:254,y:60}]);
});
test('duplicate expands the original direct Frame even when its destination starts outside it',()=>{
    const result=plan([source('p',100,100),{id:'f',type:'smart-frame',x:50,y:50,w:200,h:200,items:['p']}],
        [source('copy')],{alignment:'center',anchor:{kind:'source',sourceNodeIds:['p']},arrangement:'rigid'});
    assert.deepEqual(result.placements,[{id:'copy',x:264,y:100}]);
    assert.equal(result.frameId,'f');
    assert.equal(result.frameUpdates[0].w,338);
});

test('duplicate retries around a concurrent result using the original source, not inherited inputs',()=>{
    const s=mutation([source('q',-300,0),source('p',0,0)]);
    s.canvas.connections=[{from:'q',to:'p',kind:'input'}];s.nodes[1].inputNodeIds=['q'];
    s.uid=()=> 'copy';s.clearSmartNodeTransientRunState=()=>{};s.clearDetachedRunInputRefs=()=>{};s.demoteHistoryGroupNode=()=>{};s.isHistoryGroupNode=()=>false;
    const copy=s.SmartCanvasModules.canvasMutation.duplicate({nodeIds:['p'],preserveConnections:true}).nodes[0];
    const metadata=clone(s.SmartCanvasModules.canvasMutation.placementIntent({nodeId:'copy'}));
    assert.deepEqual(metadata.intent.anchor.sourceNodeIds,['p']);
    assert.deepEqual(clone(copy.inputNodeIds),['q']);
    load(s,'canvas-persistence');
    s.before={nodes:[source('q',-300,0),source('p',0,0),source('winner',copy.x,copy.y)],connections:[]};
    s.pending={node_creates:[{node:clone(copy),placement:metadata}]};
    const result=vm.runInContext(`(()=>{
        canvasPersistenceReplanCreatedNodes(pending,before);
        return canvasPersistenceApplyChanges(before,pending);
    })()`,s);
    const moved=result.nodes.find(n=>n.id==='copy'),winner=result.nodes.find(n=>n.id==='winner');
    assert.ok(moved.x>=164);
    assert.ok(Math.abs(moved.x-winner.x)>=164 || Math.abs(moved.y-winner.y)>=164);
    assert.deepEqual([winner.x,winner.y],[copy.x,copy.y]);
});
