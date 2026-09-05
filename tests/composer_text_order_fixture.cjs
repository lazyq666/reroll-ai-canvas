// Isolated real-page fixture: in-memory Canvas API, no credentials or model calls.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {apiPayload} = require('./issue_31_layer_decomposition_browser_smoke.cjs');
const root = path.resolve(__dirname, '..');
const id = 'composer-text-order';
const media = n => ({url:`/fixture/source.svg?${n}`,name:`Image ${n}`,kind:'image',inputInstanceId:`image-${n}`});
const target = {id:'generation',type:'smart-image',title:'Generation',referenceGenerationKind:'image',x:500,y:150,w:280,h:220,images:[],promptDraftHtml:'Composer',promptDraftText:'Composer',manualInputRefs:[media(1),media(2)],localTextRefs:[{url:'/fixture/a.txt',inputInstanceId:'txt',name:'a.txt',textSnapshot:'TXT',textBytes:3}],settings:{engine:'api',apiKind:'image',provider_id:'apimart',model:'seedream-5-0-pro',ratio:'1:1',resolution:'1K',batch:1}};
let canvas = {id,title:'Composer text ordering',project:'default',revision:1,nodes:[
 {id:'a',type:'smart-prompt',title:'Prompt A',text:'A',x:100,y:100,w:240,h:140},
 {id:'b',type:'smart-prompt',title:'Prompt B',text:'B',x:100,y:280,w:240,h:140},target
],connections:[{from:'a',to:target.id,kind:'input'},{from:'b',to:target.id,kind:'input'}],settings:target.settings,logs:[]};
const mutations = [], submissions = [], inverses = new Map(), acknowledgments = new Map();
function invert(changes) {
 const inverse={node_updates:[],node_unsets:[],canvas_updates:[]};
 for(const update of [...(changes.node_updates || []),...(changes.node_unsets || [])]){
  let value=canvas.nodes.find(n=>n.id===update.id);
  for(const key of update.path)value=value?.[key];
  if(value===undefined)inverse.node_unsets.push({id:update.id,path:update.path});
  else inverse.node_updates.push({id:update.id,path:update.path,value:structuredClone(value)});
 }
 for(const update of changes.canvas_updates || []){let value=canvas;for(const key of update.path)value=value?.[key];inverse.canvas_updates.push({path:update.path,value:structuredClone(value)});}
 return inverse;
}
function apply(changes) {
  for (const item of changes.canvas_updates || []) {
    let target=canvas;
    for(const key of item.path.slice(0,-1))target=target[key] ||= {};
    target[item.path.at(-1)]=item.value;
  }
  for (const item of changes.node_creates || []) canvas.nodes.push(item.node || item);
  canvas.connections.push(...(changes.connection_adds || []));
  for(const item of changes.connection_removes || []) canvas.connections=canvas.connections.filter(c=>!(c.from===item.from&&c.to===item.to&&(c.kind||'flow')===(item.kind||'flow')));
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

`;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(url.pathname==='/fixture/state')return send({canvas,mutations,submissions});
 if(url.pathname==='/fixture/mutation') {
  let raw='';for await(const part of req)raw+=part;
  const operation=JSON.parse(raw).operation;
  if(acknowledgments.has(operation.operation_id))return send({...acknowledgments.get(operation.operation_id),duplicate:true});
  const changes=structuredClone(operation.reverts_operation_id ? inverses.get(operation.reverts_operation_id) : operation.changes);
  if(changes?.node_creates)changes.node_creates=changes.node_creates.map(item=>item.node || item);
  if(!changes)return send({error:'Unknown operation'},400);
  inverses.set(operation.operation_id,invert(changes));
  mutations.push(operation);apply(changes);canvas.revision++;
  const ack={type:'canvas_mutation',canvas_id:id,operation_id:operation.operation_id,reverts_operation_id:operation.reverts_operation_id,revision:canvas.revision,changes,duplicate:false,undoable:true};
  acknowledgments.set(operation.operation_id,ack);return send(ack);
 }
 if(url.pathname==='/fixture/init.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(init);}
 if(url.pathname==='/fixture/source.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml'});return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"><rect width="2000" height="1000" fill="#e9dfc7"/><rect x="200" y="200" width="1400" height="200" fill="#775437"/><text x="270" y="340" font-size="120" fill="white">LAYER STUDY</text><circle cx="1000" cy="720" r="210" fill="#314e55"/><rect x="150" y="600" width="300" height="250" rx="12" fill="#f8f1dc"/><text x="180" y="745" font-size="60">NOTE</text></svg>');}
 if(url.pathname.startsWith('/api/')){
  if(url.pathname===`/api/canvases/${id}`)return send({canvas});
  if(url.pathname==='/api/model-capabilities')return send({provider_id:'apimart',model_id:'seedream-5-0-pro',operation:url.searchParams.get('operation') || 'image.generate',catalog_revision:'fixture',support_state:'supported',inputs:{text:{minimum:0,maximum:1},image:{minimum:0,maximum:20},video:{minimum:0,maximum:0},audio:{minimum:0,maximum:0},file:{minimum:0,maximum:0}},parameters:{quality:{type:'enum',values:['auto'],default:'auto'},resolution_tier:{type:'enum',values:['1K'],default:'1K'},aspect_ratio:{type:'enum',values:['1:1'],default:'1:1'},count:{type:'integer',minimum:1,maximum:1,default:1}},output:{kind:'image',count:{minimum:1,maximum:1,default:1}}});
  if(url.pathname==='/api/canvas-image-tasks'&&req.method==='POST'){let raw='';for await(const p of req)raw+=p;submissions.push(JSON.parse(raw));return send({error:'Fixture: request captured, no model call'},503);}
  return send(apiPayload(url.href));
 }
 const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
 if(!file.startsWith(root+path.sep))return send({},403);
 fs.readFile(file,(error,body)=>{
  if(error)return send({error:'not found'},404);
  if(url.pathname==='/static/smart-canvas.html')body=Buffer.from(body.toString().replace('<head>','<head><script src="/fixture/init.js"></script><script src="/tests/composer_text_order_checks.js" defer></script>'));
  res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream'});res.end(body);
 });
});
if(require.main===module)server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}/static/smart-canvas.html?id=${id}&manual=1`));
module.exports={server};
