// Isolated real-page fixture: in-memory Canvas API, no credentials or model calls.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {apiPayload} = require('./issue_31_layer_decomposition_browser_smoke.cjs');
const root = path.resolve(__dirname, '..');
const id = 'issue-31-layer-decomposition-browser';
const source = {id:'layer-source',type:'smart-image',x:180,y:120,w:500,h:250,images:[{url:'/fixture/source.svg',media_id:'layer-source-media',name:'Layer fixture',kind:'image',natural_w:2000,natural_h:1000}]};
let canvas = {id,title:'Layer Dialog Test',project:'default',revision:1,nodes:[source],connections:[],settings:{},logs:[]};
const editorMode = process.argv.includes('--editor');
if(editorMode) {
 const base = {url:'/fixture/source.svg',name:'Base',kind:'image',natural_w:2000,natural_h:1000};
 const layer = {url:'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="250"><rect width="300" height="250" rx="12" fill="#c06745"/><text x="30" y="145" font-size="60" fill="white">EDIT</text></svg>'),name:'Note',kind:'image'};
 canvas.nodes.push({id:'layer-result',type:'smart-layer-decomposition',x:760,y:120,w:500,h:250,images:[base],layerDecompositionSourceNodeId:source.id,layerDecompositionSourceImageIndex:0,layerDecompositionManifest:{canvas_width:2000,canvas_height:1000,source_media_id:'layer-source-media'},layerDecompositionItems:[{id:'base',role:'base',z_index:0,media:base},{id:'note',role:'layer',z_index:1,absolute_bbox:[150,600,450,850],media:layer}]});
}
const mutations = [], submissions = [], psdExports = [];
function apply(changes) {
  for (const item of changes.canvas_updates || []) {
    let target=canvas;
    for(const key of item.path.slice(0,-1))target=target[key] ||= {};
    target[item.path.at(-1)]=item.value;
  }
  for (const item of changes.node_creates || []) canvas.nodes.push(item.node || item);
  for (const item of changes.node_updates || []) {
    const node = canvas.nodes.find(n=>n.id===item.id); if (!node) continue;
    let target = node;
    for (const key of item.path.slice(0,-1)) target = target[key] ||= {};
    target[item.path.at(-1)] = item.value;
  }
  for (const item of changes.node_unsets || []) {
    let target = canvas.nodes.find(n=>n.id===item.id);
    for (const key of item.path.slice(0,-1)) target = target?.[key];
    if(target) delete target[item.path.at(-1)];
  }
  for (const item of changes.node_deletes || []) canvas.nodes = canvas.nodes.filter(n=>n.id!==(item.id || item));
}
const init = `
class FixtureSocket {
  static CONNECTING=0; static OPEN=1; static CLOSING=2; static CLOSED=3;
  constructor(){this.readyState=0; setTimeout(async()=>{const data=await fetch('/fixture/state').then(r=>r.json());this.readyState=1;this.onopen?.({});this.onmessage?.({data:JSON.stringify({type:'canvas_snapshot',canvas_id:'${id}',revision:data.canvas.revision,canvas:data.canvas})});},0);}
  send(raw){const message=JSON.parse(raw);if(message.type==='ping'){this.onmessage?.({data:JSON.stringify({type:'pong'})});return;}if(message.type!=='canvas_mutation')return;fetch('/fixture/mutation',{method:'POST',body:raw}).then(r=>r.json()).then(data=>this.onmessage?.({data:JSON.stringify(data)}));}
  close(code=1000){this.readyState=3;this.onclose?.({code});}
}
window.WebSocket=FixtureSocket;
window.addEventListener('load',()=>{const timer=setInterval(()=>{if(!window.SmartCanvasModules?.canvasMutation||typeof nodes==='undefined'||!nodes.find(n=>n.id==='layer-source'))return;clearInterval(timer);const bar=document.createElement('div');bar.id='fixture-controls';bar.style='position:fixed;top:0;left:0;z-index:9999;background:white;color:black;padding:4px;display:flex;gap:8px';bar.innerHTML='<button id="fixture-open">Open layer dialog</button><button id="fixture-language">中文 / English</button><button id="fixture-theme">Light / Dark</button><button id="fixture-tests">Run contract checks</button><output id="fixture-result"></output>';document.body.append(bar);bar.querySelector('#fixture-open').onclick=()=>${editorMode ? "openLayerDecompositionEditor({nodeId:'layer-result'})" : "openAiProcessorForSmartImage('layer-decomposition','layer-source',0)"};bar.querySelector('#fixture-language').onclick=()=>window.StudioI18n.set(window.StudioI18n.lang()==='en'?'zh':'en');bar.querySelector('#fixture-theme').onclick=()=>{document.documentElement.dataset.uiTheme=document.documentElement.dataset.uiTheme==='dark'?'light':'dark';};bar.querySelector('#fixture-tests').onclick=()=>${editorMode ? 'window.runLayerEditorChecks()' : 'window.runLayerDialogChecks()'};},50);});
`;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(url.pathname==='/fixture/state')return send({canvas,mutations,submissions,psdExports});
 if(url.pathname==='/fixture/mutation') {let raw='';for await(const part of req)raw+=part;const message=JSON.parse(raw);const operation=message.operation;mutations.push(operation);apply(operation.changes||{});canvas.revision++;return send({type:'canvas_mutation',canvas_id:id,operation_id:operation.operation_id,revision:canvas.revision,changes:operation.changes,duplicate:false,undoable:true});}
 if(url.pathname==='/fixture/init.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(init);}
 if(url.pathname==='/fixture/source.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml'});return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"><rect width="2000" height="1000" fill="#e9dfc7"/><rect x="200" y="200" width="1400" height="200" fill="#775437"/><text x="270" y="340" font-size="120" fill="white">LAYER STUDY</text><circle cx="1000" cy="720" r="210" fill="#314e55"/><rect x="150" y="600" width="300" height="250" rx="12" fill="#f8f1dc"/><text x="180" y="745" font-size="60">NOTE</text></svg>');}
 if(url.pathname.startsWith('/api/')){
  if(url.pathname===`/api/canvases/${id}`)return send({canvas});
  if(editorMode && url.pathname===`/api/canvases/${id}/layer-decompositions/layer-result/psd` && req.method==='POST') {
   psdExports.push({nodeId:'layer-result'});
   const bytes=Buffer.alloc(44);bytes.write('8BPS');bytes.writeUInt16BE(1,4);bytes.writeUInt16BE(4,12);bytes.writeUInt32BE(1,14);bytes.writeUInt32BE(1,18);bytes.writeUInt16BE(8,22);bytes.writeUInt16BE(3,24);bytes.set([10,20,30,255],40);
   res.writeHead(200,{'Content-Type':'image/vnd.adobe.photoshop','Content-Disposition':'attachment; filename="toolbar-fixture.psd"'});return res.end(bytes);
  }
  if(url.pathname==='/api/canvas-layer-decomposition-tasks'&&req.method==='POST'){let raw='';for await(const p of req)raw+=p;submissions.push(JSON.parse(raw));return send({task_id:'fixture-task',status:'queued'});}
  if(url.pathname==='/api/canvas-layer-decomposition-tasks/fixture-task')return send({status:'failed',error:'Fixture: no model call'});
  return send(apiPayload(url.href));
 }
 const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
 if(!file.startsWith(root+path.sep))return send({},403);
 fs.readFile(file,(error,body)=>{
  if(error)return send({error:'not found'},404);
  if(url.pathname==='/static/smart-canvas.html')body=Buffer.from(body.toString().replace('<head>','<head><script src="/fixture/init.js"></script><script src="/tests/issue_38_layer_dialog_checks.js" defer></script><script src="/tests/layer_decomposition_editor_checks.js" defer></script>'));
  res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream'});res.end(body);
 });
});
if(require.main===module)server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}/static/smart-canvas.html?id=${id}&manual=1`));
module.exports={server};
