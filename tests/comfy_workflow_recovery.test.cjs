const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const root = path.resolve(__dirname,'..');

function fixture(responses=[]){
    const node={id:'video-node',images:[],pending:1,outputKind:'video',generationOperationId:'operation'};
    const calls=[], frames=[];
    const sandbox={
        window:{__IC_USER:{id:'designer'},SmartCanvasModules:{}},nodes:[node],
        nowMs:()=>2000,tr:key=>key,trf:key=>key,toast(){},
        smartRecoverableImageTask:()=>null,addSmartGenerationLog(){},
        restoreGenerationPresentationSnapshot(){},
        resultMediaUrls:input=>Array.isArray(input)?input:input?.videos||[],
        render(){frames.push(JSON.parse(JSON.stringify(node.pendingTasks||[])));},
        setTimeout:callback=>{callback();return 0;},
        fetch:async(url,options)=>{
            calls.push({url,method:options?.method||'GET'});
            const response=responses.shift();
            if(response?.httpError) return {ok:false,status:503,text:async()=> 'unavailable'};
            return {ok:true,json:async()=>response};
        },
    };
    vm.createContext(sandbox);
    const load=name=>vm.runInContext(fs.readFileSync(path.join(root,'static/js/smart-canvas',name),'utf8'),sandbox);
    load('generation-pending.js');
    const modules=sandbox.window.SmartCanvasModules;
    modules.generationSettings={snapshot:()=>({})};
    modules.canvasPersistence={schedule(){},save:async()=>true};
    modules.generationProvider={workflowErrorMessage:code=>`translated:${code}`};
    modules.generationOutput={apply(options){
        const outputs=sandbox.resultMediaUrls(options.outputs).map(url=>({url,kind:options.kind}));
        const next=modules.generationPending.transition(modules.generationPending.snapshot(node),{
            type:'task-succeeded',taskId:options.taskId,outputs,kind:options.kind,now:2000,
        });
        modules.generationPending.keys.forEach(key=>{if(key in next)node[key]=next[key];else delete node[key];});
        return outputs;
    }};
    load('generation-recovery.js');
    return {sandbox,node,modules,calls,frames};
}

test('refresh resumes original ComfyUI Run and retains video kind, stage and output rules',async()=>{
    const {node,modules,calls,frames}=fixture([
        {httpError:true},
        {id:'original-run',status:'running',stage:'comfy-sampling-first',progress_current:8,progress_total:8,progress_percent:100},
        {id:'original-run',status:'running',stage:'comfy-upscaling'},
        {id:'original-run',status:'succeeded',result:{videos:['final.mp4']},created_at:1,updated_at:2},
    ]);
    modules.generationRecovery.restoreActive({runs:[{
        id:'original-run',kind:'workflow',type:'comfy',provider_id:'comfyui',output_kind:'video',
        status:'running',node_id:node.id,generation_operation_id:'operation',actor_id:'designer',
        stage:'comfy-queued',queue_position:2,
    }]});
    assert.equal(node.pendingTasks[0].transport,'comfy');
    assert.equal(node.pendingTasks[0].kind,'video');
    assert.equal(node.pendingTasks[0].queue_position,2);
    await modules.generationRecovery.resume();
    assert.equal(calls.length,4);
    assert.ok(calls.every(call=>call.method==='GET'&&call.url==='/api/canvas-comfy-tasks/original-run'));
    const sampling=frames.flat().find(item=>item.stage==='comfy-sampling-first');
    const upscale=frames.flat().find(item=>item.stage==='comfy-upscaling');
    assert.equal(sampling.progress_percent,100);
    assert.equal(sampling.queue_position,null);
    assert.equal(upscale.progress_percent,null);
    assert.equal(upscale.progress_current,null);
    assert.equal(upscale.progress_total,null);
    assert.deepEqual(Array.from(node.images,item=>[item.url,item.kind]),[['final.mp4','video']]);
    assert.equal(node.pending,0);
});

test('saving failures stay pending across refresh and poll only the original Run until saved',async()=>{
    for(const refreshDuringSave of [false,true]){
        const saving={
            id:'original-run',status:'running',error:'generation.output_save_failed',
            stage:'comfy-encoding',phase:'provider_completed',recoverable:true,
            progress:100,progress_current:8,progress_total:8,progress_percent:100,queue_position:2,
        };
        const {node,modules,calls,frames}=fixture([
            saving,
            {id:'original-run',status:'succeeded',result:{videos:['/assets/output/final.mp4']},created_at:1,updated_at:2},
        ]);
        modules.generationRecovery.restoreActive({runs:[{
            ...(refreshDuringSave?saving:{id:'original-run',stage:'comfy-encoding',progress_percent:100}),
            kind:'workflow',type:'comfy',provider_id:'comfyui',output_kind:'video',
            node_id:node.id,generation_operation_id:'operation',actor_id:'designer',
        }]});
        if(refreshDuringSave){
            assert.equal(node.pendingTasks[0].stage,'workflow-saving');
            assert.equal(node.pendingTasks[0].progress_percent,null);
        }
        assert.equal(node.images.length,0);
        await modules.generationRecovery.resume();
        const savingFrame=frames.flat().find(item=>item.stage==='workflow-saving');
        assert.ok(savingFrame);
        assert.equal(savingFrame.taskId,'original-run');
        assert.equal(savingFrame.kind,'video');
        assert.equal(savingFrame.phase,'workflow-saving');
        for(const key of ['progress','progress_current','progress_total','progress_percent','queue_position']){
            assert.equal(savingFrame[key],null,key);
        }
        assert.equal(calls.length,2);
        assert.ok(calls.every(call=>call.method==='GET'&&call.url==='/api/canvas-comfy-tasks/original-run'));
        assert.deepEqual(Array.from(node.images,item=>[item.url,item.kind]),[['/assets/output/final.mp4','video']]);
        assert.equal(node.pending,0);
    }
});

test('progress cannot recreate a removed task or overwrite its identity',()=>{
    const {modules}=fixture();
    const transition=modules.generationPending.transition;
    const state={pendingTasks:[{taskId:'original',kind:'video',transport:'comfy'}],pending:1,images:[]};
    const changed=transition(state,{type:'task-progress',taskId:'original',progress:{stage:'comfy-encoding',taskId:'attack',kind:'image'}});
    assert.equal(changed.pendingTasks[0].taskId,'original');
    assert.equal(changed.pendingTasks[0].kind,'video');
    const complete=transition(changed,{type:'task-succeeded',taskId:'original',outputs:[],now:2});
    const late=transition(complete,{type:'task-progress',taskId:'original',progress:{stage:'comfy-queued'}});
    assert.equal(late.pending,0);
    assert.equal(late.pendingTasks.length,0);
});

test('cancelled ComfyUI tasks stop polling and use workflow error translations',async()=>{
    const {sandbox,node,calls}=fixture([{status:'cancelled',error:'comfy.execution_interrupted'}]);
    node.pendingTasks=[{taskId:'original',kind:'video',transport:'comfy'}];
    await assert.rejects(sandbox.generationRecoveryPollTask('original',node.id,'video','comfy'),/translated:comfy.execution_interrupted/);
    assert.equal(calls.length,1);
});


test('H3 input validation and video naming never inherit an API model capability',async()=>{
    const source=fs.readFileSync(path.join(root,'static/js/smart-canvas/generation-run.js'),'utf8');
    const sandbox={
        window:{SmartCanvasModules:{videoCapabilities:{
            current(){throw new Error('API capability must not control workflow');},
            load(){throw new Error('API naming must not control workflow');},
        }}},
        smartComfyCapability:()=>({max_images:6,max_videos:3,max_audios:3}),
        isApiLikeEngine:engine=>engine==='api',
    };
    vm.createContext(sandbox);
    const start=source.indexOf('function generationRunSupportedInputKinds(');
    vm.runInContext(source.slice(start,source.indexOf('function ',start+10)),sandbox);
    const namingStart=source.indexOf('async function generationRunVideoNamingPrefix(');
    vm.runInContext(source.slice(namingStart,source.indexOf('async function submitAndSettleGenerationProvider(',namingStart)),sandbox);
    const settings={engine:'comfy',apiKind:'video',videoModel:'old-api-model'};
    assert.deepEqual(Array.from(sandbox.generationRunSupportedInputKinds({outputKind:'video'},settings)),['image','video','audio']);
    assert.equal(await sandbox.generationRunVideoNamingPrefix(settings,[]),'');
});
