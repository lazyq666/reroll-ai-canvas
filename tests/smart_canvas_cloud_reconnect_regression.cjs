const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let language='zh';const dictionary={},listeners={},sockets=[];
const status={hidden:true,textContent:''};
class Socket {static OPEN=1;static CONNECTING=0;static CLOSING=2;constructor(){this.readyState=1;sockets.push(this)}}
const context=vm.createContext({
  window:{WebSocket:Socket,SmartCanvasModules:{nodeGeometry:{nodeGap:64}},
    addEventListener:(name,fn)=>listeners[name]=fn,
    StudioI18n:{register:entries=>Object.assign(dictionary,entries),t:key=>dictionary[key]?.[language]||key}},
  document:{getElementById:()=>status,addEventListener(){}},location:{protocol:'http:',host:'fixture'},
  canvasId:'canvas-1',smartClientId:'cloud-client',setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
});
vm.runInContext(fs.readFileSync('static/js/i18n/cloud-storage.js','utf8'),context);
vm.runInContext(fs.readFileSync('static/js/smart-canvas/canvas-persistence.js','utf8'),context);
vm.runInContext("canvasPersistenceConnect();canvasPersistenceInFlight={operation:{operation_id:'paste:original-0001'}};canvasPersistencePendingSave=true",context);
sockets[0].onclose({code:1013,reason:'cloud_storage_reconnecting'});
assert.equal(vm.runInContext('canvasPersistenceStatusValue',context),'reconnecting');
assert.match(status.textContent,/正在重新连接云端/);
language='en';listeners['studio-lang-change']();
assert.match(status.textContent,/Reconnecting to cloud storage/);
assert.equal(vm.runInContext('canvasPersistenceInFlight.operation.operation_id',context),'paste:original-0001');
assert.equal(vm.runInContext('canvasPersistencePendingSave',context),true);
vm.runInContext("canvasPersistenceSetStatus('ready')",context);
assert.equal(vm.runInContext('canvasPersistenceStorageErrorCode',context),'');
console.log('PASS: cloud reconnect keeps the pending operation and translates the failure state on language switch');
