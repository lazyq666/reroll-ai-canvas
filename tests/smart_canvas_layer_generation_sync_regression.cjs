const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const host = fs.readFileSync('static/js/smart-canvas.js', 'utf8');
const source = name => fs.readFileSync(`static/js/smart-canvas/${name}.js`, 'utf8');
const translate = key => ({
    'smart.canvasStillSyncing':'画布仍在同步，请稍后重试保存提示词',
    'smart.syncIncompleteGeneration':'实时同步尚未完成，生成任务未提交',
}[key] || key);

function scenario({focused=false, receiptDelay=0, dropReceipts=false}={}){
    const timers = new Set();
    const logs = [];
    const requests = [];
    const editor = {textContent:'Keep this draft', matches:()=>true, contains:el=>el===editor};
    const initial = {
        title:'Test', icon:'', connections:[], settings:{},
        nodes:[{id:'source',type:'smart-image',x:0,y:0,images:[
            {url:'/fixture.png',natural_w:800,natural_h:600,kind:'image'},
        ]}],
    };
    const socket = {readyState:1};
    const sandbox = {
        window:{WebSocket:{OPEN:1},addEventListener(){},
            localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
            SmartCanvasModules:{canvasMutation:{history(){}},
                nodeGeometry:require('../static/js/smart-canvas/node-geometry.js'),
                modelCapabilities:{
                    load:async()=>({support_state:'supported',catalog_revision:'fixture'}),
                    validate:()=>({valid:true}),
                },
            },
        },
        document:{activeElement:focused ? editor : null,addEventListener(){},getElementById:()=>null},
        canvasId:'test',smartClientId:'layer-test',canvas:structuredClone(initial),nodes:[],
        settings:{},initialSmartSettings:{},canvasDefaultSmartSettings:{},selectionState:null,
        promptInput:editor,composerFocusRevision:1,socket,
        normalizeLegacySmartNode:node=>({...node}),cloneSmartSettings:structuredClone,
        savePromptDraftForCurrent(){},stripImageGenerationMeta:item=>({...item}),
        mediaItemForStorage:item=>({...item}),settingsForStorage:value=>({...value}),
        render(){},scheduleConnectionLayerRefresh(){},tr:translate,trf:translate,toast(){},
        addSmartGenerationLog:entry=>{logs.push(entry);return {id:'log-'+logs.length};},
        responseErrorMessage:async()=> 'Fixture response error',
        setTimeout(fn,delay){
            const timer=setTimeout(()=>{timers.delete(timer);fn();},delay);
            timers.add(timer);return timer;
        },
        clearTimeout(timer){clearTimeout(timer);timers.delete(timer);},
        setInterval,clearInterval,Date,JSON,Promise,
    };
    sandbox.nodes=sandbox.canvas.nodes;
    sandbox.createLayerDecompositionPendingNode=()=>{
        const node={id:'pending',type:'smart-image',x:400,y:0,images:[]};
        sandbox.nodes.push(node);return node;
    };
    sandbox.applyLayerDecompositionResult=node=>{node.layerDecompositionJob.status='succeeded';};
    vm.createContext(sandbox);
    vm.runInContext(source('canvas-persistence'),sandbox);
    vm.runInContext(source('layer-decomposition'),sandbox);
    vm.runInContext(source('generation-failure-feedback'),sandbox);
    vm.runInContext(`canvasPersistenceConfirmedDocument=canvasPersistenceCompactDocument(canvas);
        canvasPersistenceRevision=0;canvasPersistenceStatusValue='ready';canvasPersistenceSocket=socket;`,sandbox);
    const persistence=sandbox.window.SmartCanvasModules.canvasPersistence;
    const applier=sandbox.window.SmartCanvasModules.canvasRealtimeApplier;
    let revision=0;
    socket.send=value=>{
        const message=JSON.parse(value);
        if(dropReceipts) return;
        sandbox.setTimeout(()=>applier.apply({type:'canvas_mutation',
            operation_id:message.operation.operation_id,revision:++revision,
            changes:message.operation.changes,undoable:true}),receiptDelay);
    };
    sandbox.fetch=async(url,options={})=>{
        requests.push({url,options});
        if(options.method==='POST'){
            assert.equal(persistence.status().pending,false,'Generation must wait for its save receipt');
            const body=JSON.parse(options.body);
            const confirmed=vm.runInContext('canvasPersistenceConfirmedDocument',sandbox);
            assert.equal(confirmed.nodes.find(node=>node.id===body.node_id)?.generationOperationId,
                body.generation_operation_id,'The saved target must match this generation');
            return {ok:true,json:async()=>({task_id:'fixture-run',status:'queued'})};
        }
        return {ok:true,json:async()=>({id:'fixture-run',status:'succeeded',result:{}})};
    };
    sandbox.canvasPersistence=dropReceipts ? {
        ...persistence,
        checkpoint:options=>persistence.checkpoint({...options,timeout:250}),
        synced:options=>persistence.synced({...options,timeout:250}),
    } : persistence;
    sandbox.generationFailureFeedback=sandbox.window.SmartCanvasModules.generationFailureFeedback;
    const reportStart=host.indexOf('function reportLayerDecompositionFailure(');
    vm.runInContext(host.slice(reportStart,host.indexOf('\nfunction ',reportStart+1)),sandbox);
    sandbox.smartLayerDecompositionFactory=sandbox.window.SmartCanvasModules.layerDecomposition;
    const setupStart=host.indexOf('const smartLayerDecomposition = ');
    vm.runInContext(host.slice(setupStart,host.indexOf('\nconst smartDepthMap',setupStart)),sandbox);
    return {
        logs,requests,sandbox,persistence,
        async run(){
            const pending=await vm.runInContext(`smartLayerDecomposition.run({node:nodes[0],
                providerId:'fixture',modelId:'fixture-layer',resolutionTier:'2K',prompt:'Keep every object'})`,sandbox);
            await vm.runInContext('smartLayerDecomposition.waitForIdle()',sandbox);
            return pending;
        },
        close(){timers.forEach(clearTimeout);timers.clear();},
    };
}

(async()=>{
    const failures=[];
    for(const options of [
        {name:'focused prompt',focused:true},
        {name:'save receipt after 5.5 seconds',receiptDelay:5500},
        {name:'lost receipt',dropReceipts:true},
    ]){
        const test=scenario(options);
        try {
            const pending=await test.run();
            const submissions=test.requests.filter(request=>request.options.method==='POST');
            if(options.dropReceipts){
                assert.equal(submissions.length,0);
                assert.equal(pending.layerDecompositionJob.status,'failed');
                assert.equal(pending.layerDecompositionJob.prompt,'Keep every object');
                const failure=test.logs.at(-1).tasks[0];
                assert.equal(failure.errorCode,'canvas_sync_incomplete');
                assert.equal(test.sandbox.generationFailureFeedback.classify(failure).category,'canvas_sync_incomplete');
                assert.equal(failure.upstreamTaskId,'');
                assert.equal(failure.httpStatus,0);
            } else {
                assert.equal(submissions.length,1,
                    'Layer decomposition must submit after confirmed save: '+JSON.stringify(test.logs.map(log=>log.error)));
                assert.equal(test.logs.length,0);
                if(options.focused){
                    assert.equal(test.sandbox.document.activeElement,test.sandbox.promptInput);
                    assert.equal(test.sandbox.promptInput.textContent,'Keep this draft');
                }
            }
            console.log('PASS:',options.name);
        } catch(error){failures.push(options.name+': '+error.message);}
        finally {test.close();}
    }
    assert.equal(failures.length,0,failures.join('\n'));
})().catch(error=>{console.error(error);process.exitCode=1;});
