const assert = require('node:assert/strict');
const {format, shortcut, createCopyAction} = require('../static/js/smart-canvas/node-reference.js');
const target={workspace_id:'w',canvas_id:'c',node_ids:['a','b']};
const key={key:'l',metaKey:true,ctrlKey:false,altKey:false,shiftKey:false};
assert.equal(shortcut(key,'apple'),true);
assert.equal(shortcut({...key,metaKey:false,ctrlKey:true},'windows'),true);
for(const platform of ['apple','windows']){
 const matching=platform==='apple'?key:{...key,metaKey:false,ctrlKey:true};
 for(const extra of ['altKey','shiftKey','repeat','defaultPrevented'])assert.equal(shortcut({...matching,[extra]:true},platform),false);
 assert.equal(shortcut({...matching,ctrlKey:true,metaKey:true},platform),false);
}
assert.equal(shortcut(key,'windows'),false);
assert.equal(shortcut({...key,metaKey:false,ctrlKey:true},'apple'),false);
(async()=>{
 let selected=structuredClone(target),persist,clipboard='',notifications=[],written=false;
 const action=createCopyAction({capture:()=>structuredClone(selected),
  save:()=>new Promise(resolve=>persist=resolve),validate:async captured=>assert.deepEqual(captured,target),
  write:async promise=>{written=true;clipboard=await promise;},notify:(...args)=>notifications.push(args)});
 const copying=action();assert.equal(written,true,'clipboard write starts before asynchronous saving');
 selected.node_ids=['later'];persist();assert.equal(await copying,true);
 assert.equal(clipboard,format(target));assert.deepEqual(notifications,[['referenceCopiedMany',2]]);
 for(const code of ['referenceChanged','referenceTooLarge','save_failed']){
  notifications=[];clipboard='prior';
  const failing=createCopyAction({capture:()=>target,save:async()=>{throw Object.assign(new Error(code),{code});},validate:()=>assert.fail(),
   write:async promise=>{clipboard=await promise;},notify:(...args)=>notifications.push(args)});
  assert.equal(await failing(),false);assert.equal(clipboard,'prior');assert.equal(notifications.length,1);assert.ok(!notifications[0][0].startsWith('referenceCopied'));
 }
 notifications=[];
 const saveRejected=createCopyAction({capture:()=>target,save:async()=>{throw new Error('offline');},validate:()=>assert.fail(),
  write:promise=>{promise.catch(()=>{});return new Promise(()=>{});},notify:(...args)=>notifications.push(args)});
 assert.equal(await Promise.race([saveRejected(),new Promise(resolve=>setTimeout(()=>resolve('hung'),100))]),false,'save rejection must finish even if clipboard waits for its data promise');
 assert.deepEqual(notifications,[['referenceSaveFailed']]);
 notifications=[];
 const rejected=createCopyAction({capture:()=>target,save:async()=>{},validate:async()=>{},
  write:()=>Promise.reject(Object.assign(new Error(),{name:'NotAllowedError'})),notify:(...args)=>notifications.push(args)});
 assert.equal(await rejected(),false);assert.deepEqual(notifications,[['referenceClipboardFailed']]);
 console.log('PASS: exact platform modifiers, captured set, deferred clipboard, failures, no false success');
})().catch(e=>{console.error(e);process.exitCode=1});
