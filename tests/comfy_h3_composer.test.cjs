const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');
const read = path => fs.readFileSync(path, 'utf8');
const capability = {
  adapter:'h3', output_kind:'video', min_images:0,max_images:6,max_videos:3,max_audios:3,min_references:1,max_references:12,
  durations:Array.from({length:12},(_,index)=>index+4),resolutions:['512p','768p'],aspect_ratios:['16:9','9:16','1:1'],
  defaults:{duration:4,resolution:'512p',aspect_ratio:'16:9'},
  reference_duration_min:2,reference_duration_max:15,reference_video_total_duration_max:15,reference_audio_total_duration_max:15,
  resolution_sizes:{
    '512p':{'16:9':{width:896,height:512},'9:16':{width:512,height:896},'1:1':{width:512,height:512}},
    '768p':{'16:9':{width:1344,height:768},'9:16':{width:768,height:1344},'1:1':{width:768,height:768}}
  }
};
const workflow = {name:'custom/H3.json',title:'H3 · Reference video',capability,config:{fields:[]}};
const key = ref => `instance|${ref.inputInstanceId}`;
const settings = {engine:'comfy',comfyMode:'custom',comfyWorkflow:workflow.name,comfyDuration:6,comfyResolution:'768p',comfyAspect:'9:16'};
function loadSettings(sandbox){
  vm.createContext(sandbox);
  vm.runInContext(read('static/js/smart-canvas/generation-settings.js'),sandbox);
}
function providerSandbox(){
  const requests=[];
  let uploadNumber=0;
  const sandbox = {
    window:{SmartCanvasModules:{}}, comfyWorkflows:[workflow],comfyWorkflowCache:{},
    tr:key=>key,trf:(key,values)=>`${key}:${JSON.stringify(values)}`,smartClientId:'test-client',
    imageRefsOnly:refs=>refs.filter(ref=>ref.kind==='image'), videoRefsOnly:refs=>refs.filter(ref=>ref.kind==='video'),audioRefsOnly:refs=>refs.filter(ref=>ref.kind==='audio'),
    mediaKindForItem:ref=>ref.kind,inputRefKey:key,
    FormData:class {append(){}}, Blob, Response,
    smartResponseErrorMessage:async response=>response.text(),
    sizeForRun:()=> '1024x1024',
    fetch:async (url,options={})=>{
      requests.push({url,options});
      if(url.startsWith('/api/workflows/')) return {ok:true,json:async()=>workflow};
      if(url.startsWith('/api/upload?')) return {ok:true,json:async()=>({files:[{comfy_upload:{name:`reference-${++uploadNumber}.png`,subfolder:'reroll',type:'input',backend:'http://computer:8188'}}]})};
      if(url==='/api/canvas-comfy-tasks' || url==='/api/canvas-image-tasks' || url==='/api/canvas-video-tasks') return {ok:true,json:async()=>({task_id:'run-1',status:'queued'})};
      if(url.startsWith('/media/')) return {ok:true,blob:async()=>new Blob(['test'])};
      throw new Error(`Unexpected request ${url}`);
    }
  };
  loadSettings(sandbox);
  vm.runInContext(read('static/js/smart-canvas/generation-provider.js'),sandbox);
  sandbox.generationProviderReferenceDuration=async()=>4;
  return {sandbox,requests};
}

test('H3 uses the ordinary model picker and capability-defined video controls',()=>{
  const sandbox={window:{SmartCanvasModules:{viewportSelection:{selection:{node:()=>null}}}},comfyWorkflows:[workflow],comfyWorkflowCache:{},
    tr:key=>key,trf:key=>key,escapeAttr:String,escapeHtml:String,
    smartModelCatalog:()=>[{id:'api:model',model:'API video',provider_id:'api'}],smartCatalogEntry:()=>null,
    smartModelVendorOptionAttributes:()=>'',smartModelVendorIconMarkup:()=>'',
    activeComposerNode:()=>null,videoRefsOnly:refs=>refs,inputRefKey:key,promptAuthoring:{resolve:()=>({refs:[]})},
    dynamicParams:{innerHTML:''},lastComposerNodeId:''};
  loadSettings(sandbox);
  vm.runInContext(`settings=${JSON.stringify(settings)}`,sandbox);
  const source=read('static/js/smart-canvas.js');
  for(const [start,end] of [['function renderCatalogModelControl(', '// 即梦图生图'],['function renderVideoGenerationSettingsControl(', 'function renderJimengReferenceModeControl('],['function renderComfyVideoParams(', 'function renderComfyParams(']]){
    vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))),sandbox);
  }
  const picker=sandbox.renderCatalogModelControl('video');
  assert.match(picker,/value="workflow:custom\/H3.json"[^>]*selected/);
  assert.match(picker,/H3 · Reference video/);
  assert.doesNotMatch(picker,/<optgroup/,'ic-select accepts only direct native options');
  assert.match(picker,/value="__workflow_heading__" disabled/);
  sandbox.renderComfyVideoParams(capability);
  assert.match(sandbox.dynamicParams.innerHTML,/duration="6"/);
  assert.match(sandbox.dynamicParams.innerHTML,/duration-step="1"/);
  assert.match(sandbox.dynamicParams.innerHTML,/duration-min="4"/);
  assert.match(sandbox.dynamicParams.innerHTML,/duration-max="15"/);
  assert.match(sandbox.dynamicParams.innerHTML,/resolutions="512p,768p"/);
  assert.match(sandbox.dynamicParams.innerHTML,/ratio="9:16"/);
  assert.match(sandbox.dynamicParams.innerHTML,/data-smart-generation-mode="workflow"/);
});

test('H3 upload and pending receipt preserve duplicate reference identity, machine, controls and source input',async()=>{
  const {sandbox,requests}=providerSandbox();
  const refs=[{url:'/media/shared.png',name:'shared.png',kind:'image',inputInstanceId:'a',comfy_name:'stale-on-another-computer.png'},
    {url:'/media/shared.png',name:'shared.png',kind:'image',inputInstanceId:'b'},
    {url:'/media/clip.mp4',name:'clip.mp4',kind:'video',inputInstanceId:'v',include_audio:true},
    {url:'/media/voice.wav',name:'voice.wav',kind:'audio',inputInstanceId:'a1'}];
  const before=JSON.stringify(refs);let accepted=0;
  const result=await sandbox.window.SmartCanvasModules.generationProvider.submit({prompt:'<Picture 2> follows <Picture 1>',refs,settings,
    context:{canvasId:'canvas',nodeId:'node',operationId:'operation'},onAccepted:()=>accepted++});
  assert.equal(result.state,'pending');assert.equal(result.kind,'video');assert.equal(result.tasks[0].transport,'comfy');assert.equal(accepted,1);
  const uploads=requests.filter(request=>request.url.startsWith('/api/upload?'));
  assert.equal(uploads.length,4);assert.ok(uploads.every(request=>request.url.endsWith('custom%2FH3.json')));
  const payload=JSON.parse(requests.find(request=>request.url==='/api/canvas-comfy-tasks').options.body);
  assert.deepEqual({...payload.workflow_inputs,references:undefined},{adapter:'h3',duration:6,resolution:'768p',aspect_ratio:'9:16',references:undefined});
  assert.deepEqual(payload.workflow_inputs.references.map(ref=>ref.instance_id),['a','b','v','a1']);
  assert.equal(payload.workflow_inputs.references[2].duration,4);assert.equal(payload.workflow_inputs.references[2].include_audio,true);
  assert.ok(payload.workflow_inputs.references.every(ref=>ref.backend==='http://computer:8188'));
  assert.notEqual(payload.workflow_inputs.references[0].name,payload.workflow_inputs.references[1].name);
  assert.equal(JSON.stringify(refs),before);
  assert.equal(payload.generation_operation_id,'operation');
});

test('H3 rejects missing/oversized input before any upload or task creation',async()=>{
  for(const refs of [[],Array.from({length:7},(_,index)=>({url:`/media/${index}.png`,kind:'image'}))]){
    const {sandbox,requests}=providerSandbox();
    await assert.rejects(sandbox.window.SmartCanvasModules.generationProvider.submit({prompt:'test',refs,settings}),/workflowReference/);
    assert.equal(requests.filter(item=>item.url.startsWith('/api/upload') || item.url==='/api/canvas-comfy-tasks').length,0);
  }
});

test('API request ignores saved H3 controls and remains byte-identical',async()=>{
  const first=providerSandbox(); const second=providerSandbox();
  const api={engine:'api',apiKind:'image',provider_id:'api',model:'image-model',resolution:'1k',quality:'auto',count:1};
  const refs=[{url:'/media/reference.png',kind:'image',inputInstanceId:'a'}];
  await first.sandbox.window.SmartCanvasModules.generationProvider.submit({prompt:'图1 turns',refs,settings:api});
  await second.sandbox.window.SmartCanvasModules.generationProvider.submit({prompt:'图1 turns',refs,settings:{...settings,...api}});
  assert.equal(first.requests[0].url,'/api/canvas-image-tasks');
  assert.equal(first.requests[0].options.body,second.requests[0].options.body);
  assert.ok(!second.requests[0].options.body.includes('workflow_inputs'));
});

test('stage progress resets when encoding and translates at render time',()=>{
  const sandbox={tr:key=>key,trf:(key,values)=>`${key}:${Object.values(values).join('/')}`};vm.createContext(sandbox);
  const source=read('static/js/smart-canvas.js');const start=source.indexOf('function generationPendingWorkflowProgress(');
  vm.runInContext(source.slice(start,source.indexOf('function generationPendingNodeElapsed(',start)),sandbox);
  const task={transport:'comfy',kind:'video',stage:'comfy-sampling-first',progress_current:4,progress_total:8};
  assert.equal(sandbox.generationPendingWorkflowProgress({pendingTasks:[task]}).description,'smart.workflowProgressSteps:4/8');
  task.stage='comfy-encoding';task.progress_current=null;task.progress_total=null;
  assert.equal(sandbox.generationPendingWorkflowProgress({pendingTasks:[task]}).description,'');
  sandbox.tr=key=>`en:${key}`;
  assert.equal(sandbox.generationPendingWorkflowProgress({pendingTasks:[task]}).label,'en:smart.workflowProgressEncoding');
});


test('video audio settings survive storage and retry snapshots without mutating API settings',async()=>{
  const {sandbox,requests}=providerSandbox();
  const saved=sandbox.settingsForStorage({...settings,comfyVideoAudio:{'instance|v':true},videoDuration:9,videoResolution:'1080p'});
  assert.equal(saved.comfyVideoAudio['instance|v'],true);
  assert.equal(saved.videoDuration,9);
  const refs=[{url:'/media/clip.mp4',name:'clip.mp4',kind:'video',inputInstanceId:'v'}];
  await sandbox.window.SmartCanvasModules.generationProvider.submit({prompt:'<Video 1> and <Audio 1>',refs,settings:saved});
  const payload=JSON.parse(requests.find(request=>request.url==='/api/canvas-comfy-tasks').options.body);
  assert.equal(payload.workflow_inputs.references[0].include_audio,true);
  assert.equal(payload.workflow_inputs.duration,6);
});


test('saving retries remain visible with localized progress and error text',()=>{
  const {sandbox}=providerSandbox();
  const translations={};let language='zh';
  sandbox.window.StudioI18n={register:entries=>Object.assign(translations,entries)};
  vm.runInContext(read('static/js/i18n/smart-canvas.js'),sandbox);
  sandbox.tr=key=>translations[key]?.[language] || key;
  const source=read('static/js/smart-canvas.js');const start=source.indexOf('function generationPendingWorkflowProgress(');
  vm.runInContext(source.slice(start,source.indexOf('function generationPendingNodeElapsed(',start)),sandbox);
  const task={transport:'comfy',kind:'video',stage:'workflow-saving',progress_current:null,progress_total:null,progress_percent:null};
  for(const [locale,expected] of [['zh','生成已完成，正在重试保存文件…'],['en','Generation is complete. Retrying file save…']]){
    language=locale;
    const view=sandbox.generationPendingWorkflowProgress({pendingTasks:[task]});
    assert.equal(view.label,expected);
    assert.equal(view.description,'');
    assert.equal(view.state,'generating');
    assert.equal(sandbox.window.SmartCanvasModules.generationProvider.workflowErrorMessage('generation.output_save_failed'),expected);
  }
});

test('open H3 settings update the actual dimensions without rebuilding the popover',()=>{
  const liveCapability={...capability,resolution_sizes:{
    '512p':{'16:9':{width:896,height:512},'9:16':{width:512,height:896}},
    '768p':{'9:16':{width:768,height:1344}}
  }};
  const attributes={'resolution-label':'smart.videoResolution · 896 × 512'};
  const listeners={};let scheduled=0;
  const picker={dataset:{smartGenerationMode:'workflow'},open:true,
    getAttribute:name=>attributes[name],setAttribute:(name,value)=>attributes[name]=value,
    addEventListener:(name,listener)=>listeners[name]=listener};
  const sandbox={window:{SmartCanvasModules:{}},comfyWorkflows:[{...workflow,capability:liveCapability}],comfyWorkflowCache:{},
    tr:key=>key,escapeAttr:String,escapeHtml:String,
    smartComposerSelectionValidationActive:()=>true,smartComposerOwnedOverlayOpen:()=>true,
    scheduleDynamicParamsRefresh:()=>scheduled++,canvasPersistence:{schedule(){}},
    dynamicParams:{querySelector:()=>picker,querySelectorAll:selector=>selector==='ic-generation-settings-picker[data-smart-generation-settings]' ? [picker] : [],
      set innerHTML(value){throw new Error('The open popover must not be replaced');}}};
  loadSettings(sandbox);
  sandbox.persistActiveSmartSettings=()=>{};sandbox.rememberRecentSmartSettings=()=>{};sandbox.activeSettingsSubject=()=>null;
  vm.runInContext(`settings=${JSON.stringify({...settings,comfyAspect:'16:9',comfyResolution:'512p',comfyDuration:4})}`,sandbox);
  const source=read('static/js/smart-canvas.js');
  for(const [start,end] of [['function renderDynamicParams(', 'function renderApiParams('],['function renderComfyVideoParams(', 'function renderComfyParams('],['function setDynamicSetting(', 'async function loadConfig(']]){
    vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))),sandbox);
  }
  sandbox.bindDynamicParams();
  const change=(field,value)=>listeners['ic-change']({stopPropagation(){},detail:{field,value}});
  change('ratio','9:16');
  assert.equal(attributes['resolution-label'],'smart.videoResolution · 512 × 896');
  change('resolution','768p');
  assert.equal(attributes['resolution-label'],'smart.videoResolution · 768 × 1344');
  change('duration',6);
  assert.equal(attributes['resolution-label'],'smart.videoResolution · 768 × 1344');
  assert.ok(scheduled>0,'whole-composer rendering remains deferred while the popover is open');
  assert.equal(picker.open,true);
});


test('generation engine can return from API to H3 on a video result node',()=>{
  const node={type:'smart-image',images:[{url:'/output/result.mp4',kind:'video'}]};
  const sandbox={window:{SmartCanvasModules:{}},comfyWorkflows:[workflow],comfyWorkflowCache:{},
    nodeKinds:{isGeneration:()=>true},smartContainer:{isGroup:()=>false},mediaKindForItem:item=>item.kind,
    activeComposerNode:()=>node,engineSelect:{value:'comfy'},
    sanitizeSmartApiSelection:()=>{},syncApiKindToggleVisibility:()=>{},
    loadSmartVideoCapabilityForCurrentSettings:()=>Promise.resolve(),
    canvasPersistence:{schedule(){}},
    renderDynamicParams:()=>{sandbox.engineSelect.value=vm.runInContext('settings.engine',sandbox);}};
  loadSettings(sandbox);
  sandbox.persistActiveSmartSettings=()=>{};
  sandbox.activeComposerNode=()=>node;
  vm.runInContext(`settings=${JSON.stringify({...settings,apiKind:'video'})};
    recentSmartSettingsByMode=${JSON.stringify({
      'comfy:custom':{...settings,apiKind:'video'},
      'api:video':{engine:'api',apiKind:'video',comfyMode:'text',comfyWorkflow:'',videoProvider:'api',videoModel:'api-video'}
    })};`,sandbox);
  const source=read('static/js/smart-canvas.js');
  for(const [start,end] of [
    ['function smartNodeGenerationEligibility(', 'function isHistoryGroupNode('],
    ['engineSelect.onchange = () => {', 'function syncApiKindToggleVisibility(']
  ]) vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))),sandbox);
  sandbox.engineSelect.value='api';
  sandbox.engineSelect.onchange();
  assert.equal(vm.runInContext('settings.engine',sandbox),'api');
  sandbox.engineSelect.value='comfy';
  sandbox.engineSelect.onchange();
  assert.equal(sandbox.engineSelect.value,'comfy','ComfyUI must remain selected instead of bouncing back to API');
  assert.equal(vm.runInContext('settings.comfyWorkflow',sandbox),workflow.name);
  assert.equal(vm.runInContext('smartComfyOutputKind(settings)',sandbox),'video');
  assert.equal(vm.runInContext('settings.comfyDuration',sandbox),6);
  assert.equal(vm.runInContext('settings.comfyResolution',sandbox),'768p');
  assert.equal(vm.runInContext('settings.comfyAspect',sandbox),'9:16');
  sandbox.engineSelect.value='api';
  sandbox.engineSelect.onchange();
  assert.equal(vm.runInContext('settings.videoModel',sandbox),'api-video');
});


test('video node resolves an available workflow when old recent Comfy settings are missing or stale',()=>{
  const sandbox={window:{SmartCanvasModules:{}},comfyWorkflows:[workflow],comfyWorkflowCache:{},
    smartNodeGenerationEligibility:()=>({forcedApiKind:'video'}),sanitizeSmartApiSelection:()=>{}};
  loadSettings(sandbox);
  for(const recent of [{},{engine:'comfy',comfyMode:'custom',comfyWorkflow:'removed.json'}]){
    vm.runInContext(`recentSmartSettingsByMode={'comfy:custom':${JSON.stringify(recent)}}`,sandbox);
    const source={engine:'comfy',comfyMode:'text',comfyWorkflow:'',apiKind:'video'};
    const resolved=sandbox.constrainSmartNodeGenerationSettings({},source);
    assert.equal(resolved.engine,'comfy');
    assert.equal(resolved.comfyWorkflow,workflow.name);
    assert.equal(resolved.comfyMode,'custom');
    assert.equal(source.comfyWorkflow,'','normalization must not mutate stored snapshots');
  }
  sandbox.comfyWorkflows=[];
  assert.equal(sandbox.constrainSmartNodeGenerationSettings({}, {engine:'comfy',comfyMode:'text'}).engine,'api',
    'video results still reject image-only Comfy configurations when no compatible workflow exists');
  sandbox.smartNodeGenerationEligibility=()=>({forcedApiKind:''});
  assert.equal(sandbox.constrainSmartNodeGenerationSettings({}, {engine:'comfy',comfyMode:'text'}).comfyMode,'text',
    'empty or image nodes retain ordinary Comfy mode selection');
});


test('all 72 H3 output choices survive storage and reach the workflow task unchanged',async()=>{
  const source=read('static/js/smart-canvas.js');
  const start=source.indexOf('function smartComfyVideoResolutionLabel(');
  const end=source.indexOf('function syncComfyVideoPickerResolutionLabel(',start);
  let checked=0;
  for(const duration of Array.from({length:12},(_,index)=>index+4)) for(const resolution of ['512p','768p']) for(const ratio of ['16:9','9:16','1:1']){
    const {sandbox,requests}=providerSandbox();
    vm.runInContext(source.slice(start,end),sandbox);
    const snapshot=JSON.parse(JSON.stringify(sandbox.settingsForStorage({...settings,comfyDuration:duration,comfyResolution:resolution,comfyAspect:ratio})));
    assert.equal(snapshot.comfyDuration,duration);
    const expected=capability.resolution_sizes[resolution][ratio];
    assert.equal(sandbox.smartComfyVideoResolutionLabel(snapshot,capability),`smart.videoResolution · ${expected.width} × ${expected.height}`);
    await sandbox.window.SmartCanvasModules.generationProvider.submit({
      prompt:'<Picture 1>',refs:[{url:'/media/one.png',kind:'image',inputInstanceId:'one'}],settings:snapshot
    });
    const task=JSON.parse(requests.find(item=>item.url==='/api/canvas-comfy-tasks').options.body);
    assert.deepEqual({...task.workflow_inputs,references:undefined},{adapter:'h3',duration,resolution,aspect_ratio:ratio,references:undefined});
    assert.equal(task.workflow_inputs.references.length,1);
    checked++;
  }
  assert.equal(checked,72);
});

test('H3 accepts 1–6 images, independent video/audio input and the full 12-reference boundary',async()=>{
  const makeRefs=(kind,count)=>Array.from({length:count},(_,index)=>({url:`/media/${kind}-${index}`,kind,inputInstanceId:`${kind}-${index}`}));
  const accepted=[
    ...Array.from({length:6},(_,index)=>makeRefs('image',index+1)),
    makeRefs('video',1),makeRefs('audio',1),
    [...makeRefs('image',6),...makeRefs('video',3),...makeRefs('audio',3)]
  ];
  for(const refs of accepted){
    const {sandbox,requests}=providerSandbox();
    await sandbox.window.SmartCanvasModules.generationProvider.submit({prompt:'reference boundary',refs,settings});
    const payload=JSON.parse(requests.find(item=>item.url==='/api/canvas-comfy-tasks').options.body);
    assert.equal(payload.workflow_inputs.references.length,refs.length);
    assert.deepEqual(payload.workflow_inputs.references.map(ref=>ref.instance_id),refs.map(ref=>ref.inputInstanceId));
  }
  for(const refs of [[],makeRefs('image',7),makeRefs('video',4),makeRefs('audio',4),
    [...makeRefs('image',7),...makeRefs('video',3),...makeRefs('audio',3)],makeRefs('text',1)]){
    const {sandbox,requests}=providerSandbox();
    await assert.rejects(sandbox.window.SmartCanvasModules.generationProvider.submit({prompt:'invalid boundary',refs,settings}),/workflowReference|workflowUnsupportedReference/);
    assert.equal(requests.filter(item=>item.url.startsWith('/api/upload') || item.url==='/api/canvas-comfy-tasks').length,0);
  }
});

test('API video payload is byte-identical after switching away from H3 with all H3 settings saved',async()=>{
  const api={engine:'api',apiKind:'video',videoProvider:'api',videoModel:'api-video',videoDuration:9,
    videoResolution:'1080p',videoAspect:'4:3',videoUseFrameRoles:true,videoMultimodal:false,
    videoEnhancePrompt:true,videoGenerateAudio:true};
  const refs=[{url:'/media/image.png',name:'image.png',kind:'image',inputInstanceId:'i'},
    {url:'/media/video.mp4',kind:'video',inputInstanceId:'v'},{url:'/media/audio.wav',kind:'audio',inputInstanceId:'a'}];
  const bodies=[];
  for(const source of [api,{...settings,comfyVideoAudio:{'instance|v':true},...api}]){
    const {sandbox,requests}=providerSandbox();
    Object.assign(sandbox,{applyUploadedUrlsToSmartRefs:items=>items,manualSmartMediaLinks:()=>[],
      manualSmartVideoLink:()=>null,videoProviderPlatform:()=>''});
    sandbox.window.SmartCanvasModules.videoCapabilities={
      load:async()=>({}),applyComposerOptions:source=>source,
      resolve:()=>({counts:{image:1,video:1,audio:1,total:3}}),validateReferences:()=>({valid:true})
    };
    const result=await sandbox.window.SmartCanvasModules.generationProvider.submit({prompt:'图1 and 视频1',refs,settings:source});
    assert.equal(result.kind,'video');
    assert.equal(requests.length,1);
    assert.equal(requests[0].url,'/api/canvas-video-tasks');
    bodies.push(requests[0].options.body);
  }
  assert.equal(bodies[0],bodies[1]);
  const payload=JSON.parse(bodies[1]);
  assert.equal(payload.duration,9);assert.equal(payload.resolution,'1080p');assert.equal(payload.aspect_ratio,'4:3');
  assert.equal(payload.images[0].role,'first_frame');assert.deepEqual(payload.videos,['/media/video.mp4']);
  assert.ok(!bodies[1].includes('comfy'));assert.ok(!bodies[1].includes('include_audio'));
});

test('H3 original audio follows duplicate video instances across reorder and deletion',async()=>{
  const first={url:'/media/shared.mp4',name:'shared.mp4',kind:'video',inputInstanceId:'v-first',include_audio:true};
  const second={...first,inputInstanceId:'v-second',include_audio:false};
  const stored={...settings,comfyVideoAudio:{'instance|v-first':false,'instance|v-second':true}};
  for(const refs of [[first,second],[second,first],[first],[second]]){
    const {sandbox,requests}=providerSandbox();
    await sandbox.window.SmartCanvasModules.generationProvider.submit({prompt:'<Video 1>',refs,settings:sandbox.settingsForStorage(stored)});
    const payload=JSON.parse(requests.find(item=>item.url==='/api/canvas-comfy-tasks').options.body);
    assert.deepEqual(payload.workflow_inputs.references.map(ref=>[ref.instance_id,ref.include_audio]),
      refs.map(ref=>[ref.inputInstanceId,ref.inputInstanceId==='v-second']));
  }
});

test('unreadable reference metadata stops H3 before upload and does not accept a task',async()=>{
  const {sandbox,requests}=providerSandbox();
  let accepted=false;
  sandbox.generationProviderReferenceDuration=async()=>{throw new Error('smart.workflowErrorDurationUnknown');};
  await assert.rejects(sandbox.window.SmartCanvasModules.generationProvider.submit({
    prompt:'<Video 1>',refs:[{url:'/media/broken.mp4',kind:'video',inputInstanceId:'v'}],settings,
    onAccepted:()=>{accepted=true;}
  }),/workflowErrorDurationUnknown/);
  assert.equal(accepted,false);
  assert.equal(requests.filter(item=>item.url.startsWith('/api/upload') || item.url==='/api/canvas-comfy-tasks').length,0);
});


test('empty generation target title follows the H3 workflow output instead of saved API kind',()=>{
  const renders=[];
  let subject={id:'empty-generation',type:'smart-image',referenceGenerationKind:'image',images:[]};
  const sandbox={window:{SmartCanvasModules:{}},comfyWorkflows:[workflow],comfyWorkflowCache:{},
    composer:{classList:{contains:()=>true}},smartNodeInFlight:node=>node.inFlight===true,
    render:options=>renders.push(options),tr:key=>key};
  loadSettings(sandbox);
  sandbox.activeComposerNode=()=>subject;
  sandbox.rememberRecentSmartSettings=()=>{};
  const source=read('static/js/smart-canvas.js');
  const start=source.indexOf('function referenceGenerationKind(');
  vm.runInContext(source.slice(start,source.indexOf('function referenceGenerationTargetHtml(',start)),sandbox);
  const save=source=>{
    vm.runInContext(`settings=${JSON.stringify(source)}`,sandbox);
    sandbox.persistActiveSmartSettings();
  };
  save({...settings,apiKind:'image'});
  assert.equal(subject.referenceGenerationKind,'video');
  assert.equal(sandbox.referenceGenerationTitle(subject),'smart.referenceVideoNode');
  assert.deepEqual(JSON.parse(JSON.stringify(renders)),[{syncVirtualization:false,nodeIds:['empty-generation'],skipDynamicParamsRefresh:true}],
    'the visible node must update immediately without replacing the open Composer controls');
  save({...settings,apiKind:'image',comfyAspect:'1:1',comfyResolution:'512p'});
  assert.equal(subject.referenceGenerationKind,'video','changing H3 parameters must retain the video placeholder');
  assert.equal(renders.length,1,'parameter edits that keep the output kind must not redraw the node');
  for(const apiKind of ['image','video']){
    save({engine:'api',apiKind});
    assert.equal(subject.referenceGenerationKind,apiKind,'API image/video switching keeps its existing behavior');
  }
  save({engine:'comfy',comfyMode:'text',apiKind:'video'});
  assert.equal(subject.referenceGenerationKind,'image','ordinary Comfy image mode ignores a stale API video selection');
  for(const protectedNode of [
    {id:'existing',referenceGenerationKind:'image',images:[{url:'/media/existing.png'}]},
    {id:'running',referenceGenerationKind:'image',images:[],inFlight:true},
    {id:'upload',images:[]}
  ]){
    subject=protectedNode;
    const before=subject.referenceGenerationKind;
    save({...settings,apiKind:'image'});
    assert.equal(subject.referenceGenerationKind,before,'populated, running, and upload nodes keep their existing identity');
    assert.equal(subject.runSettings.comfyWorkflow,workflow.name);
  }
});


test('new generation nodes inherit H3 output kind while keeping the API image default',()=>{
  let inherited;
  let newNode;
  const drawn=[];
  const sandbox={window:{SmartCanvasModules:{}},comfyWorkflows:[workflow],comfyWorkflowCache:{},
    createMenuPoint:{x:0,y:0},createMenuGroupId:'',closeCreateMenu:()=>{},
    createImageNodeAt:()=>newNode={id:'new',type:'smart-image',images:[]},
    addCreatedNodeToMenuGroup:()=>{},smartContainer:{reconcileFrames:()=>false},
    render:()=>drawn.push(newNode.referenceGenerationKind),canvasPersistence:{schedule(){}},tr:key=>key};
  loadSettings(sandbox);
  sandbox.smartSettingsForNode=()=>inherited;
  const source=read('static/js/smart-canvas.js');
  const start=source.indexOf('function createNodeFromMenu(');
  vm.runInContext(source.slice(start,source.indexOf('function smartCanvasChromeTarget(',start)),sandbox);
  for(const [sourceSettings,expected] of [
    [{...settings,apiKind:'image'},'video'],
    [{engine:'api',apiKind:'video'},'image'],
    [{engine:'api',apiKind:'image'},'image'],
    [{engine:'comfy',comfyMode:'text',apiKind:'video'},'image']
  ]){
    inherited=sourceSettings;
    const created=sandbox.createNodeFromMenu('generate');
    assert.equal(created.referenceGenerationKind,expected);
    assert.equal(drawn.at(-1),expected,'the first generated placeholder render uses the correct output kind');
    assert.equal(created.runSettings.apiKind,'image','creating a generic blank node preserves the existing API image default');
    assert.equal(created.runSettings.engine,sourceSettings.engine);
    assert.equal(created.runSettings.comfyWorkflow,sourceSettings.comfyWorkflow);
    assert.equal(created.runSettings.comfyDuration,sourceSettings.comfyDuration);
  }
});


test('rendered video node title and accessible name follow actual media in both languages',async()=>{
  const translations={};
  let language='zh';
  const sandbox={window:{StudioI18n:{register:entries=>Object.assign(translations,entries)}},
    smartContainer:{isFrame:node=>node.type==='smart-frame',frameMembers:()=>[]},
    nodeKinds:{isLayerDecomposition:()=>false,isPromptFamily:()=>false,isTextAnnotation:()=>false},
    escapeHtml:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    tr:key=>translations[key]?.[language] || key,
    smartOriginalMediaUrl:item=>typeof item==='string' ? item : item?.url || ''};
  vm.createContext(sandbox);
  const source=read('static/js/smart-canvas.js');
  vm.runInContext(read('static/js/i18n/smart-canvas.js'),sandbox);
  for(const [start,end] of [
    ['function isVideoMediaItem(', 'function localDisplayUrlForMediaItem('],
    ['function referenceGenerationKind(', 'function referenceGenerationTargetHtml(']
  ]) vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))),sandbox);
  const renderStart=source.indexOf('const nodeHtmlEntries = nodes');
  const titleStart=source.indexOf('const imgs = node.images || [];',renderStart);
  const titleEnd=source.indexOf('const scale = nodeScale(node);',titleStart);
  vm.runInContext(`function renderedTitle(node){${source.slice(titleStart,titleEnd)}return title;}`,sandbox);
  const {renderCanvasNodeMarkup}=await import(require('node:url').pathToFileURL(`${process.cwd()}/static/js/infinite-canvas-ui/nodes/shared.js`).href);
  const examples=[
    [{type:'smart-image',title:'Image',generationOutputNode:true,runSettings:{engine:'comfy'},images:[{url:'/output/workflow-video-01.mp4',kind:'video',alias:'My fight scene'}]},'smart.kindVideo'],
    [{type:'smart-image',runSettings:{engine:'api'},images:[{url:'/output/api-video.mp4'}]},'smart.kindVideo'],
    [{type:'smart-image',images:[{url:'/output/image.png',kind:'image'}]},'smart.kindImage'],
    [{type:'smart-image',images:[{url:'/output/voice.wav'}]},'smart.kindAudio'],
    [{type:'smart-image',images:[{url:'/output/video.mp4'},{url:'/output/other.mp4'}]},'smart.kindVideo'],
    [{type:'smart-image',images:[{url:'/output/image.png'},{url:'/output/video.mp4'}]},'smart.media'],
    [{type:'smart-image',images:[],referenceGenerationKind:'video',pending:1},'smart.referenceVideoNode'],
    [{type:'smart-image',images:[],referenceGenerationKind:'image'},'smart.referenceImageNode'],
    [{type:'smart-image',images:[]},'smart.createImportNode']
  ];
  for(const locale of ['zh','en']){
    language=locale;
    for(const [node,key] of examples){
      const before=JSON.stringify(node);
      const title=sandbox.renderedTitle(node);
      const expected=sandbox.tr(key);
      assert.equal(title,expected);
      const markup=renderCanvasNodeMarkup({id:'media-result',kind:'image',title});
      assert.ok(markup.includes(`aria-label="${expected}"`));
      assert.ok(markup.includes(`<div class="node-title">${expected}</div>`));
      assert.equal(JSON.stringify(node),before,'deriving a title does not overwrite custom names or saved API settings');
    }
    for(const node of [
      {type:'smart-frame',title:'My frame'},
      {type:'smart-group',title:'My group'},
      {type:'smart-image',outputKind:'depth-map',title:'My depth'},
      {type:'smart-image',mattingResult:true,title:'My cutout'}
    ]) assert.ok(sandbox.renderedTitle(node).startsWith(node.title),'existing custom node titles retain precedence');
  }
});
