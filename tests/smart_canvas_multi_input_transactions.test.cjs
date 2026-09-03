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
test('one ordered mutation creates one target with exact output binding and a single Undo',()=>{
    const a={...source('a'),generationOutputNode:true,activeOutputId:'output-a'};
    const s=mutation([a,source('b',200)]), api=s.SmartCanvasModules.canvasMutation;
    api.connectSources({sourceIds:['a','b'],draft:source('target'),point:{x:700,y:500}});
    const target=s.nodes.at(-1);
    assert.deepEqual([target.x,target.y],[700,450]);
    assert.deepEqual(clone(target.inputNodeIds),['a','b']);
    assert.deepEqual(clone(s.canvas.connections),[
        {from:'a',to:'target',kind:'input',sourceOutputId:'output-a'},
        {from:'b',to:'target',kind:'input'}
    ]);
    assert.equal(api.placementMode({nodeId:'target'}),'exact');
    assert.equal(s.events.filter(event=>event==='save').length,1);
    assert.equal(api.history({action:'undo'}),true);
    assert.deepEqual(clone(s.nodes.map(node=>node.id)),['a','b']);
    assert.equal(s.canvas.connections.length,0);
    assert.equal(api.history({action:'undo'}),false);
});
test('append keeps prior inputs and settings, deduplicates, and no-op adds no history',()=>{
    const s=mutation([source('a'),source('b'),{...source('target'),inputNodeIds:['b'],text:'keep',runSettings:{model:'keep'}}]);
    s.canvas.connections=[{from:'b',to:'target',kind:'input'}];
    const api=s.SmartCanvasModules.canvasMutation;
    api.connectSources({sourceIds:['a','b'],targetId:'target'});
    assert.deepEqual(clone(s.nodes.at(-1).inputNodeIds),['b','a']);
    assert.equal(s.nodes.at(-1).text,'keep');
    assert.equal(s.nodes.at(-1).runSettings.model,'keep');
    const eventCount=s.events.length;
    assert.equal(api.connectSources({sourceIds:['a','b'],targetId:'target'}).changed,false);
    assert.equal(s.events.length,eventCount);
    api.history({action:'undo'});
    assert.deepEqual(clone(s.canvas.connections),[{from:'b',to:'target',kind:'input'}]);
    assert.equal(api.history({action:'undo'}),false);
});
test('missing source and failed placement leave all live nodes, connections and history untouched',()=>{
    const s=mutation([source('a'),source('b')]), api=s.SmartCanvasModules.canvasMutation;
    const before=clone(s.nodes);
    assert.equal(api.connectSources({sourceIds:['a','missing'],draft:source('target')}),null);
    s.SmartCanvasModules.nodePlacement={plan:()=>({ok:false})};
    assert.throws(()=>api.connectSources({sourceIds:['a','b'],draft:source('target')}));
    assert.deepEqual(clone(s.nodes),before);
    assert.deepEqual(s.canvas.connections,[]);
    assert.equal(api.history({action:'undo'}),false);
});
test('automatic placement uses the union of sources; a common Frame is a search boundary, not a resized container',()=>{
    const a=source('a',100,100), b=source('b',450,120);
    const frame={id:'frame',type:'smart-frame',x:0,y:0,w:1400,h:900,items:['a','b']};
    const s=mutation([a,b,frame]), api=s.SmartCanvasModules.canvasMutation;
    api.connectSources({sourceIds:['a','b'],draft:source('target')});
    assert.equal(s.nodes.at(-1).x,750);
    assert.equal(s.nodes.at(-1).y,100);
    assert.deepEqual(clone(s.nodes.slice(0,3)),[a,b,frame]);
});
test('local rebase rejects a whole create/connect batch if any source disappeared',()=>{
    const s=context([source('a')]); load(s,'canvas-persistence');
    s.batch={node_creates:[source('target')],connection_adds:[{from:'a',to:'target',kind:'input'},{from:'missing',to:'target',kind:'input'}]};
    const result=vm.runInContext('canvasPersistenceApplyChanges(canvas,batch)',s);
    assert.deepEqual(clone(result.nodes),[source('a')]);
    assert.equal(result.connections.length,0);
});
test('rejected batch rolls back its graph while preserving independent edits made after submission',()=>{
    const s=context([source('a'),source('b')]); load(s,'canvas-persistence');
    vm.runInContext(`
        canvasPersistenceConfirmedDocument=canvasPersistenceSharedDocument();
        const batch={...canvasPersistenceEmptyChanges(),node_creates:[{id:'target',type:'smart-image',images:[]}],connection_adds:[{from:'a',to:'target',kind:'input'},{from:'b',to:'target',kind:'input'}]};
        canvasPersistenceAssignDocument(canvasPersistenceApplyChanges(canvasPersistenceConfirmedDocument,batch));
        canvasPersistenceInFlight={operation:{operation_id:'batch'},changes:batch,optimistic:true};
        nodes[0].x=25;
        canvasPersistenceRequestResync=()=>true;
        canvasPersistenceHandleRejected({operation_id:'batch',code:'invalid_connection'});
    `,s);
    assert.deepEqual(clone(s.nodes.map(node=>node.id)),['a','b']);
    assert.equal(s.nodes[0].x,25);
    assert.equal(s.canvas.connections.length,0);
    assert.equal(vm.runInContext('canvasPersistenceInFlight',s),null);
});
test('placement retry retains the union anchor and ordered input block',()=>{
    const s=context([source('a',100,100),source('b',450,100)]);
    for(const name of ['node-geometry','node-placement','canvas-persistence']) load(s,name);
    s.batch={node_creates:[source('target')],connection_adds:[{from:'a',to:'target',kind:'input'},{from:'b',to:'target',kind:'input'}]};
    vm.runInContext('canvasPersistenceReplanCreatedNodes(batch,canvas)',s);
    assert.equal(s.batch.node_creates[0].x,750);
    assert.deepEqual(s.batch.connection_adds.map(item=>item.from),['a','b']);
});
test('production persistence saves one complete batch and reuses server operation IDs for Undo/Redo',()=>{
    const s=context([source('a'),source('b')]);
    s.sent=[];
    s.WebSocket={OPEN:1};
    for(const name of ['node-geometry','node-placement','canvas-persistence','canvas-mutation']) load(s,name);
    vm.runInContext(`
        canvasPersistenceConfirmedDocument=canvasPersistenceSharedDocument();
        canvasPersistenceStatusValue='ready';
        canvasPersistenceSocket={readyState:1,send:raw=>sent.push(JSON.parse(raw))};
    `,s);
    s.SmartCanvasModules.canvasMutation.connectSources({sourceIds:['a','b'],draft:source('target'),point:{x:700,y:500}});
    assert.equal(s.sent.length,1);
    const changes=s.sent[0].operation.changes;
    assert.equal(changes.node_creates.length,1);
    assert.deepEqual(clone(changes.connection_adds.map(item=>item.from)),['a','b']);
    assert.deepEqual(clone(changes.node_creates[0].inputNodeIds),['a','b']);
    const api=s.SmartCanvasModules.canvasMutation, applier=s.SmartCanvasModules.canvasRealtimeApplier;
    const created=s.sent[0].operation;
    assert.equal(applier.apply({type:'canvas_mutation',canvas_id:'test',operation_id:created.operation_id,revision:1,changes}),true);
    assert.equal(api.history({action:'undo'}),true);
    const undo=s.sent.at(-1).operation;
    assert.equal(undo.reverts_operation_id,created.operation_id);
    assert.equal(s.nodes.length,3); // Wait for the server; do not restore a local snapshot.
    assert.equal(applier.apply({type:'canvas_mutation',canvas_id:'test',operation_id:undo.operation_id,revision:2,reverts_operation_id:created.operation_id,changes:{
        node_deletes:['target'],connection_removes:changes.connection_adds
    }}),true);
    assert.equal(s.nodes.length,2);
    assert.equal(s.canvas.connections.length,0);
    assert.equal(api.history({action:'redo'}),true);
    const redo=s.sent.at(-1).operation;
    assert.equal(redo.reverts_operation_id,undo.operation_id);
    assert.equal(applier.apply({type:'canvas_mutation',canvas_id:'test',operation_id:redo.operation_id,revision:3,reverts_operation_id:undo.operation_id,changes}),true);
    assert.deepEqual(clone(s.nodes.at(-1).inputNodeIds),['a','b']);
    assert.deepEqual(clone(s.canvas.connections),clone(changes.connection_adds));
});
