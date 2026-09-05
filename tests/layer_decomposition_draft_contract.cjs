const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const state=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(root,'static/js/infinite-canvas-ui/ai-processor-dialog/layer-state.js'),'utf8')).toString('base64'));
 assert.deepEqual(state.normalizedBBox({x:200,y:200,width:1400,height:200},2000,1000),[100,200,800,400]);
 assert.deepEqual(state.normalizedBBox({x:0,y:0,width:2000,height:1000},2000,1000),[0,0,1000,1000]);
 for(const region of [{x:0,y:0,width:0,height:20},{x:-1,y:0,width:20,height:20},{x:1900,y:0,width:200,height:20},{x:0,y:0,width:.01,height:.01},{x:NaN,y:0,width:20,height:20}])assert.equal(state.normalizedBBox(region,2000,1000),null);
 assert.equal(state.normalizedBBox({x:0,y:0,width:20,height:20},0,0),null);
 const original={version:1,mode:'regions',preset:'custom',prompts:{custom:'中文 <bbox> raw'},regions:[{id:'r',x:20,y:10,width:100,height:100}],sourceWidth:2000,sourceHeight:1000,supplement:'keep text'};
 const draft=state.layerDraft(original);draft.regions[0].x=30;assert.equal(original.regions[0].x,20);assert.equal(draft.prompts.custom,original.prompts.custom);
 assert.equal(draft.preset,'auto');assert.equal(draft.prompts.auto,original.prompts.custom);assert.equal(state.LAYER_PRESETS.includes('custom'),false);
 assert.equal(state.layerDraft({version:999}).mode,'intelligent');
 const context={window:{},URL};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'static/js/smart-canvas/layer-decomposition-draft.js'),'utf8'),context);
 const {mediaKey,merge}=context.window.SmartCanvasModules.layerDecompositionDraft;
 assert.equal(mediaKey({url:'/a',media_id:'one'}),mediaKey({url:'/b',media_id:'one'}));
 assert.notEqual(mediaKey({url:'/a'}),mediaKey({url:'/b'}));
 assert.equal(mediaKey({url:'https://image.test/a?token=old&size=original'}),mediaKey({url:'https://image.test/a?token=new&size=original'}));
 const base={version:1,mode:'intelligent',prompts:{auto:'one',custom:'old'},regions:[]};
 const remote=JSON.parse(JSON.stringify(base));remote.prompts.auto='remote';
 const next=JSON.parse(JSON.stringify(base));next.prompts.custom='local';
 const merged=merge(remote,base,next);assert.equal(merged.prompts.auto,'remote');assert.equal(merged.prompts.custom,'local');
 const conflict=JSON.parse(JSON.stringify(remote));conflict.prompts.auto='local';assert.throws(()=>merge(remote,base,conflict),/layer-draft-conflict/);
 const later=JSON.parse(JSON.stringify(next));later.mode='regions';assert.equal(merge(merged,next,later).prompts.auto,'remote');
 assert.equal(merge(undefined,undefined,next).prompts.custom,'local');
 vm.runInContext(fs.readFileSync(path.join(root,'static/js/smart-canvas/layer-decomposition.js'),'utf8'),context);
 const controller=context.window.SmartCanvasModules.layerDecomposition.create({capability:{load:async()=>({support_state:'supported',parameters:{resolution_tier:{values:['2K']}}})}});
 const entries=await controller.supportedModels([
  {id:'official',provider_id:'apimart',model:'seedream-5-0-pro'},
  {id:'custom',provider_id:'custom',base_url:'https://api.apimart.ai/v1',model:'seedream-5-0-pro'},
  {id:'unknown',provider_id:'other',model:'seedream-5-0-pro'},
  {id:'other-model',provider_id:'apimart',model:'other-model'},
 ]);
 assert.equal(entries[0].supportsLayerRegions,true);assert.equal(entries[1].supportsLayerRegions,true);
 assert.equal(entries[2].supportsLayerRegions,false);assert.equal(entries[3].supportsLayerRegions,false);
 console.log('PASS: layer draft identity, field reconciliation, serialization and bbox geometry');
})().catch(error=>{console.error(error);process.exitCode=1;});
