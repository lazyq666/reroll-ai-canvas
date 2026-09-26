// Isolated real-page fixture: in-memory Canvas API, no credentials or model calls.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {apiPayload} = require('./issue_31_layer_decomposition_browser_smoke.cjs');
const root = path.resolve(__dirname, '..');
const id = 'image-repair-browser';
const source = {id:'layer-source',type:'smart-image',generationOutputNode:true,x:180,y:120,w:500,h:250,images:[{url:'/assets/source.png',media_id:'layer-source-media',name:'Layer fixture',kind:'image',natural_w:1000,natural_h:800}]};
let canvas = {id,title:'Layer Dialog Test',project:'default',revision:1,nodes:[source],connections:[],settings:{},logs:[]};
const mutationReceiptDelayMs = 350;
const mutations = [], submissions = [], psdExports = [];
let repairSettings={version:2,image:{provider:'',model:'',instructions:{}},video:{provider:'',model:'',instructions:{}},repair:{}};
let rejectNext=false,taskPolls=0,submissionReplies=0;
let holdUpload=false,releaseUpload=null;
const mutationReceipts = new Map();
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
  for (const item of changes.connection_adds || []) {
    if(!canvas.connections.some(c=>c.from===item.from&&c.to===item.to&&c.kind===item.kind))canvas.connections.push(item);
  }
  for (const item of changes.connection_removes || []) {
    canvas.connections=canvas.connections.filter(c=>!(c.from===item.from&&c.to===item.to&&c.kind===item.kind));
  }
}
const init = `
class FixtureSocket {
  static CONNECTING=0; static OPEN=1; static CLOSING=2; static CLOSED=3;
  constructor(){this.readyState=0; setTimeout(async()=>{const data=await fetch('/fixture/state').then(r=>r.json());this.readyState=1;this.onopen?.({});this.onmessage?.({data:JSON.stringify({type:'canvas_snapshot',canvas_id:'${id}',revision:data.canvas.revision,canvas:data.canvas})});},0);}
  send(raw){const message=JSON.parse(raw);if(message.type==='ping'){fetch('/fixture/state').then(r=>r.json()).then(data=>{if(this.readyState===1)this.onmessage?.({data:JSON.stringify({type:'pong',revision:data.canvas.revision})});});return;}if(message.type!=='canvas_mutation')return;fetch('/fixture/mutation',{method:'POST',body:raw}).then(r=>r.json()).then(data=>{if(this.readyState===1)this.onmessage?.({data:JSON.stringify(data)});});}
  close(code=1000){this.readyState=3;this.onclose?.({code});}
}
window.WebSocket=FixtureSocket;
window.addEventListener('load',()=>{const timer=setInterval(()=>{if(!window.SmartCanvasModules?.canvasMutation||typeof nodes==='undefined'||!nodes.find(n=>n.id==='layer-source'))return;clearInterval(timer);const bar=document.createElement('div');bar.id='fixture-controls';bar.style='position:fixed;top:0;left:0;z-index:9999;background:white;color:black;padding:4px;display:flex;gap:8px';bar.innerHTML='<button id="fixture-open">Open local repair</button><button id="fixture-language">中文 / English</button><button id="fixture-theme">Light / Dark</button><button id="fixture-tests">Run contract checks</button><output id="fixture-result"></output>';document.body.append(bar);bar.querySelector('#fixture-open').onclick=()=>window.SmartCanvasModules.imageStudio.open({nodeId:'layer-source',mode:'local-repair'});bar.querySelector('#fixture-language').onclick=()=>window.StudioI18n.set(window.StudioI18n.lang()==='en'?'zh':'en');bar.querySelector('#fixture-theme').onclick=()=>{document.documentElement.dataset.uiTheme=document.documentElement.dataset.uiTheme==='dark'?'light':'dark';};bar.querySelector('#fixture-tests').onclick=()=>window.runImageRepairChecks();},50);});
`;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(url.pathname==='/fixture/reject-next'){rejectNext=true;return send({ok:true});}
 if(url.pathname==='/fixture/hold-upload'){holdUpload=true;return send({ok:true});}
 if(url.pathname==='/fixture/release-upload'){releaseUpload?.();return send({ok:true});}
 if(url.pathname==='/fixture/state')return send({canvas,mutations,submissions,psdExports,submissionReplies,uploadWaiting:Boolean(releaseUpload)});
 if(url.pathname==='/fixture/mutation') {
  let raw='';for await(const part of req)raw+=part;
  const operation=JSON.parse(raw).operation;
  const previous=mutationReceipts.get(operation.operation_id);
  if(previous)return send({...previous,duplicate:true});
  mutations.push(operation);apply(operation.changes||{});canvas.revision++;
  const receipt={type:'canvas_mutation',canvas_id:id,operation_id:operation.operation_id,revision:canvas.revision,changes:operation.changes,duplicate:false,undoable:true};
  mutationReceipts.set(operation.operation_id,receipt);
  if(mutationReceiptDelayMs)await new Promise(resolve=>setTimeout(resolve,mutationReceiptDelayMs));
  return send(receipt);
 }
 if(url.pathname==='/fixture/init.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(init);}
 if(url.pathname.startsWith('/assets/')) {
  const sharp=require('sharp');
  const base=url.pathname==='/assets/source.png';
  const svg=base?'<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><rect width="1000" height="800" fill="#e4d7c5"/><rect x="100" y="100" width="800" height="160" fill="#425b68"/><text x="170" y="205" font-size="70" fill="white">REPAIR STUDY</text><circle cx="460" cy="510" r="160" fill="#bc6246"/><circle cx="470" cy="490" r="40" fill="#453831"/></svg>':'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#bc6246"/><circle cx="128" cy="128" r="50" fill="#eee5d4"/></svg>';
  const buffer=await sharp(Buffer.from(svg)).png().toBuffer();res.writeHead(200,{'Content-Type':'image/png'});return res.end(buffer);
 }
 if(url.pathname.startsWith('/api/')){
  if(url.pathname==='/api/prompt-optimization-settings'){
   if(req.method==='PUT'){let raw='';for await(const part of req)raw+=part;repairSettings=JSON.parse(raw);}
   return send(repairSettings);
  }
  if(url.pathname==='/api/available-models')return send({models:{text:[]}});
  if(url.pathname===`/api/canvases/${id}`)return send({canvas});
  if(url.pathname==='/api/ai/upload') {
   if(holdUpload){holdUpload=false;await new Promise(resolve=>{releaseUpload=resolve;});releaseUpload=null;}
   return send({files:[{url:'/assets/upload.png',name:'repair-input.png',kind:'image'}]});
  }
  if(url.pathname==='/api/canvas-image-tasks'&&req.method==='POST') {
   let raw='';for await(const p of req)raw+=p;const request=JSON.parse(raw);await new Promise(resolve=>setTimeout(resolve,600));submissionReplies++;if(rejectNext){rejectNext=false;return send({detail:{code:'repair_invalid'}},422);}submissions.push(request);taskPolls=0;
   return send({task_id:'repair-task',status:'queued'});
  }
  if(url.pathname==='/api/canvas-image-tasks/repair-task') {
   if(taskPolls++===0)return send({task_id:'repair-task',status:'running'});
   const request=submissions.at(-1);
   const items=Array.from({length:request.n||1},(_,index)=>({url:`/assets/composite-${index}.png`,kind:'image',natural_w:1000,natural_h:800,local_repair:{...request.local_repair,patch:{url:`/assets/patch-${index}.png`}}}));
   return send({task_id:'repair-task',status:'succeeded',result:{images:items.map(item=>item.url),image_items:items}});
  }
  if(url.pathname.endsWith('/render')) {
   let raw='';for await(const p of req)raw+=p;const request=JSON.parse(raw);const node=canvas.nodes.find(n=>url.pathname.includes('/'+n.id+'/'));
   const media=node.images[request.image_index];
   return send({image:{...media,url:'/assets/adjusted.png',local_repair:{...media.local_repair,version:request.recipe_version||media.local_repair.version,transform:request.transform,feather:request.feather}}});
  }
  if(url.pathname.endsWith('/psd')) {
   psdExports.push(url.pathname);const bytes=Buffer.alloc(44);bytes.write('8BPS');bytes.writeUInt16BE(1,4);bytes.writeUInt16BE(4,12);bytes.writeUInt32BE(1,14);bytes.writeUInt32BE(1,18);bytes.writeUInt16BE(8,22);bytes.writeUInt16BE(3,24);
   res.writeHead(200,{'Content-Type':'image/vnd.adobe.photoshop'});return res.end(bytes);
  }
  if(url.pathname==='/api/config')return send({api_providers:[{id:'apimart',enabled:true,image_models:['gpt-image-2','gpt-image-2.5-suburst']}],available_models:{image:[{id:'gpt2',provider_id:'apimart',model:'gpt-image-2',name:'GPT Image 2'},{id:'flagship',provider_id:'apimart',model:'gpt-image-2.5-suburst',name:'gpt-image-2.5-suburst(旗舰)'}]},comfy_instances:[]});
  if(url.pathname==='/api/model-capabilities')return send({provider_id:'apimart',model_id:url.searchParams.get('model'),operation:url.searchParams.get('operation')||'image.edit',capability_schema_version:1,catalog_revision:'repair-fixture-v1',support_state:'supported',inputs:{text:{minimum:0,maximum:1},image:{minimum:0,maximum:1},video:{minimum:0,maximum:0},audio:{minimum:0,maximum:0},file:{minimum:0,maximum:0}},parameters:{transparent_png:{type:'boolean'},count:{type:'integer',minimum:1,maximum:url.searchParams.get('model')==='gpt-image-2'?1:4},aspect_ratio:{type:'enum',values:['1:1','4:3','3:4','16:9']},resolution_tier:{type:'enum',values:['1K','2K','4K']},quality:{type:'enum',values:['auto']}},output:{kind:'image',count:{minimum:1,maximum:url.searchParams.get('model')==='gpt-image-2'?1:4}},media_contract:{aspect_ratios:['1:1','4:3','3:4','16:9'],resolution_tiers:['1K','2K','4K'],default_resolution_tier:'1K',known:true,supports_transparent_png:url.searchParams.get('model')==='gpt-image-2.5-suburst'}});
  return send(apiPayload(url.href));
 }
 const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
 if(!file.startsWith(root+path.sep))return send({},403);
 fs.readFile(file,(error,body)=>{
  if(error)return send({error:'not found'},404);
  if(url.pathname==='/static/smart-canvas.html')body=Buffer.from(body.toString().replace('<head>','<head><script src="/fixture/init.js"></script><script src="/tests/image_repair_browser_checks.js" defer></script>'));
  res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream'});res.end(body);
 });
});
if(require.main===module)server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}/static/smart-canvas.html?id=${id}&manual=1`));
module.exports={server};
