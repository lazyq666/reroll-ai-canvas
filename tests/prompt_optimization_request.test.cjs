const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');

function harness(){
    const source = fs.readFileSync('static/js/smart-canvas.js','utf8');
    const request = source.slice(source.indexOf('async function requestPromptOptimization(context)'),source.indexOf('\nvar composerPromptOptimizer'));
    const state = {catalogAvailable:true,revision:'first',catalogGets:0,posts:[],status:200,body:{text:'Optimized'}};
    const messages={};state.language='en';
    const tr=key=>messages[key]?.[state.language] || key;
    const context = {AbortSignal,URLSearchParams,Map,window:{SmartCanvasModules:{},StudioI18n:{register:values=>Object.assign(messages,values)}},tr,
        trf:(key,values)=>tr(key).replace(/\{(\w+)\}/g,(_,name)=>String(values[name])),
        smartCatalogEntry:()=>({}),
        fetch:async (url,options={})=>{
            if(url==='/api/prompt-optimization-settings') return {ok:true,json:async()=>({image:{provider:'test',model:'text'}})};
            if(url.startsWith('/api/model-capabilities?')){
                state.catalogGets++;
                state.catalogSignal=options.signal;
                if(!state.catalogAvailable) throw new TypeError('Failed to fetch');
                return {ok:true,json:async()=>({catalog_revision:state.revision,parameters:{history:{type:'array'}}})};
            }
            assert.equal(url,'/api/canvas-llm');
            state.posts.push(JSON.parse(options.body));
            return {ok:state.status===200,status:state.status,json:async()=>{
                if(state.bodyError) throw state.bodyError;
                return state.body;
            }};
        }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('static/js/i18n/smart-canvas.js','utf8'),context);
    for(const file of ['model-capabilities','prompt-optimize','generation-failure-feedback']){
        vm.runInContext(fs.readFileSync(`static/js/smart-canvas/${file}.js`,'utf8'),context);
    }
    context.generationFailureFeedback=context.window.SmartCanvasModules.generationFailureFeedback;
    vm.runInContext(request,context);
    return {state,message:context.promptOptimizationErrorMessage,request:()=>context.requestPromptOptimization({source:'sunset',media:'image'})};
}

test('retry reloads capabilities after a temporary lookup failure',async()=>{
    const {state,request}=harness();
    state.catalogAvailable=false;
    await assert.rejects(request(),error=>error.optimizationCode==='capability');
    assert.equal(state.posts.length,0);
    state.catalogAvailable=true;
    assert.equal(await request(),'Optimized');
    assert.equal(state.catalogGets,2);
    assert.ok(state.catalogSignal,'The capability request must have a deadline');
});

test('each manual optimization uses the current catalog revision',async()=>{
    const {state,request}=harness();
    await request();state.revision='updated';await request();
    assert.deepEqual(state.posts.map(body=>body.catalog_revision),['first','updated']);
});

test('provider errors retain status and structured detail without automatic retry',async()=>{
    const {state,request}=harness();
    state.status=429;state.body={detail:{message:'Rate limit exceeded',code:'rate_limit'}};
    await assert.rejects(request(),error=>{
        assert.equal(error.httpStatus,429);
        assert.deepEqual(error.optimizationDetail,state.body.detail);
        return true;
    });
    assert.equal(state.posts.length,1);
});

test('malformed success bodies cannot replace the prompt',async()=>{
    const {state,request}=harness();state.body={text:{unexpected:true}};
    await assert.rejects(request(),error=>error.optimizationCode==='invalidResponse');
});

test('a timeout while reading the result is reported as a timeout',async()=>{
    const {state,request}=harness();
    state.bodyError=new DOMException('The operation timed out','TimeoutError');
    await assert.rejects(request(),error=>error.name==='TimeoutError');
});

test('unknown provider details are readable and redacted in both languages',async()=>{
    const {state,request,message}=harness();
    state.status=418;state.body={detail:{error:{message:'Provider rejected this model. api_key=private-example-secret'}}};
    await assert.rejects(request(),error=>{
        for(const language of ['zh','en']){
            state.language=language;
            const text=message(error);
            assert.ok(text.includes('Provider rejected this model.'));
            assert.ok(text.includes('418'));
            assert.ok(text.includes('[REDACTED]'));
            assert.ok(!text.includes('private-example-secret'));
            assert.ok(!text.includes('[object Object]'));
        }
        return true;
    });
});

test('catalog errors keep localized reasons and do not retry automatically',async()=>{
    const {state,request,message}=harness();
    state.status=409;state.body={detail:{code:'catalog_changed'}};
    await assert.rejects(request(),error=>{
        const english=message(error);state.language='zh';const chinese=message(error);
        assert.notEqual(english,chinese);
        assert.ok(!english.includes('replaced'),'A catalog update is not a cancelled generation');
        assert.ok(!english.includes('smart.capability'));
        return true;
    });
    assert.equal(state.posts.length,1);
});

test('a generic HTTP failure still shows the specific provider explanation',async()=>{
    const {state,request,message}=harness();
    state.status=502;state.body={detail:'Text worker exited with code 7'};
    await assert.rejects(request(),error=>{
        assert.ok(message(error).includes('Text worker exited with code 7'));
        return true;
    });
});
