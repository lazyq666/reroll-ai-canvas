const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const host = fs.readFileSync(path.join(root, 'static/js/smart-canvas.js'), 'utf8');
const resource = JSON.parse(fs.readFileSync(path.join(root, 'resources/video-model-capabilities.json'), 'utf8'));
function sourceFunction(name){
    const start = host.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, name);
    const end = host.indexOf('\nfunction ', start + 1);
    return host.slice(start, end < 0 ? undefined : end).replace(/\n(?:let|const) [^\n]*$/g, '');
}
function harness({catalog, provider, loaded=true, input='Seedance2.5', providerId='jimeng'}={}){
    const sandbox = {window:{SmartCanvasModules:{}}, URLSearchParams, console};
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(root, 'static/js/smart-canvas/video-capabilities.js'), 'utf8'), sandbox);
    sandbox.catalog = catalog;
    sandbox.provider = provider;
    sandbox.resource = resource;
    sandbox.input = input;
    sandbox.providerId = providerId;
    vm.runInContext(`let availableModels={video:catalog},apiProviders=[{id:providerId,enabled:true,video_models:provider}],settings={};
        const composer={classList:{contains:()=>true}};
        function smartApiSelectionSnapshot(t){return {...t}} function notifySmartApiSelectionFallback(){}
        function clearVolcengineSelectionOutsideVolcengine(t){return t}
        ${['smartModelCatalog','smartCatalogEntry','smartCatalogHasSelection','videoApiProviders','providerVideoModels','smartComposerSelectionValidationActive','sanitizeSmartApiSelection'].map(sourceFunction).join('\n')}
        const DEFAULT_VIDEO_MODELS=[];
        window.SmartCanvasModules.viewportSelection={selection:{node:()=>({id:'draft'})}};
        ${loaded ? "smartVideoCapabilityCatalogs.set('jimeng',resource.models.map(entry=>entry.model_id));" : ''}
        let draft={engine:'api',apiKind:'video',videoProvider:providerId,videoModel:input,videoDuration:22,videoAspect:'3:4',videoResolution:'720p',videoReferenceMode:'multimodal_all_around'};
        sanitizeSmartApiSelection(draft,{notify:true});
    `, sandbox);
    return {sandbox, evaluate: code => vm.runInContext(code, sandbox)};
}
const actualModels=['seedance2.0_vip','seedance2.0fast_vip','Seedance2.5','Seedance2.0','seedance2.0fast','seedance2.0mini','seedance2.5'];
const actualProvider=['seedance2.0fast','seedance2.0_vip','seedance2.0fast_vip','seedance2.0mini','seedance2.5','Seedance2.0','Seedance2.5'];
const entries=(models,provider='jimeng')=>models.map(model=>({provider_id:provider,model,id:`${provider}|${model}`,name:model}));
for(const loaded of [false,true]){
    for(const input of ['Seedance2.5','seedance2.5']){
        const h=harness({catalog:entries(actualModels),provider:actualProvider,loaded,input});
        assert.equal(h.evaluate('draft.videoModel.toLowerCase()'),'seedance2.5');
        assert.equal(h.evaluate('draft.videoDuration'),22);
        assert.equal(h.evaluate("smartCatalogHasSelection('video','jimeng',input)"),true);
    }
}
for(const provider of [['seedance2.0_vip','Seedance2.5'],actualProvider]){
    const h=harness({catalog:entries(['seedance2.0_vip','Seedance2.5']),provider});
    assert.equal(h.evaluate('draft.videoModel'),'seedance2.5');
    assert.equal(h.evaluate('draft.videoDuration'),22);
}
for(const catalog of [entries(['seedance2.0_vip']),[]]){
    const h=harness({catalog,provider:actualProvider});
    assert.equal(h.evaluate('draft.videoModel'),'Seedance2.5');
    assert.equal(h.evaluate('draft.videoDuration'),22);
    assert.equal(h.evaluate("smartCatalogHasSelection('video','jimeng',input)"),false);
    if(!catalog.length) assert.equal(h.evaluate("smartModelCatalog('video').length"),0);
}
{
    const h=harness({catalog:[],provider:actualProvider,input:''});
    assert.equal(h.evaluate('draft.videoModel'),'');
}
{
    const custom={provider_id:'jimeng',model:'Seedance2.5',id:'legacy-id',name:'My custom model'};
    const h=harness({catalog:[custom,...entries(['seedance2.5'])],provider:actualProvider});
    assert.deepEqual(JSON.parse(h.evaluate("JSON.stringify(smartModelCatalog('video'))")),[{...custom,model:'seedance2.5'}]);
    assert.equal(h.evaluate("smartCatalogEntry('video','other','seedance2.5')"),null);
}
{
    const h=harness({catalog:entries(['ABC','abc'],'other'),provider:['ABC','abc'],providerId:'other',input:'Abc'});
    assert.equal(h.evaluate('draft.videoModel'),'Abc');
    assert.equal(h.evaluate("smartCatalogHasSelection('video','other','Abc')"),false);
}
{
    const h=harness({catalog:[{...entries(['seedance2.5'])[0],aliases:['seedance2.5','Seedance2.5']}],provider:['seedance2.5'],loaded:false});
    assert.equal(h.evaluate("smartCatalogHasSelection('video','jimeng','Seedance2.5')"),true);
    assert.equal(h.evaluate('draft.videoDuration'),22);
}
{
    const h=harness({catalog:entries(['seedance2.0_vip']),provider:actualProvider});
    vm.runInContext(`settings=draft;
        function smartVideoCapabilityReferences(){return [{url:'a.png',kind:'image'}]}
        function smartCurrentVideoCapability(){return {provider_id:'jimeng',known:true,commands:{multimodal2video:{duration_seconds:{minimum:4,maximum:15},video_resolutions:['480p'],aspect_ratios:['16:9']}}}}
        ${sourceFunction('smartVideoComposerState')}
        smartVideoComposerState();
    `,h.sandbox);
    assert.equal(h.evaluate('settings.videoModel'),'Seedance2.5');
    assert.equal(h.evaluate('settings.videoDuration'),22);
    assert.equal(h.evaluate('settings.videoAspect'),'3:4');
    assert.equal(h.evaluate('settings.videoResolution'),'720p');
}
(async()=>{
    const h=harness({catalog:entries(['seedance2.0_vip']),provider:actualProvider});
    const messages={};
    Object.assign(h.sandbox,{isApiLikeEngine:engine=>engine==='api',tr:key=>messages[key]?.[h.sandbox.language]||key,fetch:()=>{throw new Error('Provider submission must not run')}});
    h.sandbox.window.StudioI18n={register:values=>Object.assign(messages,values)};
    vm.runInContext(fs.readFileSync(path.join(root,'static/js/i18n/smart-canvas.js'),'utf8'),h.sandbox);
    vm.runInContext(fs.readFileSync(path.join(root,'static/js/smart-canvas/generation-provider.js'),'utf8'),h.sandbox);
    for(const language of ['zh','en']){
        h.sandbox.language=language;
        await assert.rejects(h.evaluate("window.SmartCanvasModules.generationProvider.submit({prompt:'test',settings:draft})"),error=>error.message===messages['smart.modelUnavailable'][language]);
        assert.equal(h.evaluate('draft.videoDuration'),22);
    }
    for(const loaded of [false,true]){
        // A run can start from a persisted node without opening the Composer.
        const h=harness({catalog:entries(actualModels),provider:actualProvider,loaded});
        const payloads=[];
        Object.assign(h.sandbox,{
            isApiLikeEngine:engine=>engine==='api', tr:key=>key,
            applyUploadedUrlsToSmartRefs:refs=>refs, manualSmartMediaLinks:()=>[], manualSmartVideoLink:()=>null,
            imageRefsOnly:()=>[],videoRefsOnly:()=>[],audioRefsOnly:()=>[],videoProviderPlatform:()=>'',
            fetch:async (url,options)=>{
                assert.equal(url,'/api/canvas-video-tasks');
                payloads.push(JSON.parse(options.body));
                return {ok:true,json:async()=>({task_id:'intercepted-unpaid-task'})};
            }
        });
        h.sandbox.window.SmartCanvasModules.videoCapabilities={
            ...h.sandbox.window.SmartCanvasModules.videoCapabilities,
            load:async()=>({provider_id:'jimeng',model_id:'seedance2.5',supported_model_ids:resource.models.map(entry=>entry.model_id),known:true,...resource.capability_profiles['seedance2.5-vip']})
        };
        vm.runInContext(fs.readFileSync(path.join(root,'static/js/smart-canvas/generation-provider.js'),'utf8'),h.sandbox);
        h.evaluate("draft.videoModel='Seedance2.5'");
        const before=h.evaluate('JSON.stringify(draft)');
        const result=await h.evaluate("window.SmartCanvasModules.generationProvider.submit({prompt:'test',settings:draft})");
        assert.equal(result.state,'pending');
        assert.equal(payloads.length,1);
        assert.equal(payloads[0].model,'seedance2.5');
        assert.equal(payloads[0].duration,22);
        assert.equal(h.evaluate('JSON.stringify(draft)'),before);
    }
    console.log('PASS: saved model identity, duration, visibility, metadata, unchanged invalid settings, and localized pre-submit rejection.');
})().catch(error=>{console.error(error);process.exitCode=1});
