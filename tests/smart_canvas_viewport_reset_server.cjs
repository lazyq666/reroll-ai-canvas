// Isolated real-page acceptance fixture. Run with node, then open the printed URL.
// All API responses are synthetic; no production canvas or provider is contacted.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const fixture = {
  id:'viewport-reset-fixture', title:'Viewport recovery test', revision:0,
  nodes:[{id:'text-a',type:'smart-text',text:'Viewport recovery',x:1000,y:1000,w:320,h:100,textSize:'large'},
    {id:'text-b',type:'smart-text',text:'Canvas content',x:1500,y:1200,w:320,h:100,textSize:'large'}],
  connections:[], settings:{}, logs:[],
};
const bootstrap = `<script>
window.WebSocket = class {
  static OPEN=1; static CLOSED=3;
  constructor(){this.readyState=0;this.listeners=new Map();setTimeout(()=>{this.readyState=1;this.emit('open',{});},0);}
  addEventListener(t,f){if(!this.listeners.has(t))this.listeners.set(t,new Set());this.listeners.get(t).add(f);}
  removeEventListener(t,f){this.listeners.get(t)?.delete(f);}
  emit(t,e){for(const f of this.listeners.get(t)||[])f(e);}
  send(){} close(){this.readyState=3;this.emit('close',{code:1000});}
};
</script>`;
const harness = `<!doctype html><meta charset="utf-8"><title>Viewport reset acceptance</title>
<style>body{margin:0;font:14px sans-serif}nav{padding:8px;display:flex;gap:8px}iframe{width:100%;height:calc(100vh - 50px);border:0}</style>
<nav><button onclick="scenario('tiny')">Tiny view</button><button onclick="scenario('huge')">Huge view</button><button onclick="scenario('overview')">Overview</button><button onclick="scenario('empty')">Empty canvas</button><button onclick="frame.contentWindow.StudioI18n.set('en')">English</button><button onclick="frame.contentWindow.StudioI18n.set('zh')">中文</button><button onclick="frame.contentWindow.applyTheme('dark')">Dark</button><button onclick="frame.contentWindow.applyTheme('light')">Light</button><button onclick="frame.style.width='700px'">Narrow</button></nav>
<iframe id="frame" src="/static/smart-canvas.html?id=viewport-reset-fixture"></iframe>
<script>
function scenario(kind){
  const w=frame.contentWindow;
  if(kind==='overview'){w.SmartCanvasModules.viewportSelection.viewport.zoomPreview({action:'enter'});return;}
  if(kind==='empty'){w.eval('nodes=[]; selectedId=""; selectedIds=[]; render();');}
  const scale=kind==='huge'?1e148:1e-148;
  w.eval('viewport.scale='+scale+';viewport.x=1e148;viewport.y=1e148;');
  w.SmartCanvasModules.viewportSelection.viewport.apply();
}
</script>`;
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server = http.createServer((req,res)=>{
  const url = new URL(req.url,'http://localhost');
  res.setHeader('Cache-Control','no-store');
  let data;
  if(url.pathname==='/') {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(harness);return;}
  if(url.pathname==='/api/config') data={api_providers:[],available_models:{image:[],video:[],text:[]},comfy_instances:[]};
  else if(url.pathname==='/api/workflows') data={workflows:[]};
  else if(url.pathname==='/api/prompt-libraries') data={library:{libraries:[]}};
  else if(url.pathname==='/api/smart-canvas/prompt-templates') data={templates:[]};
  else if(url.pathname.startsWith('/api/canvases/')) data={canvas:fixture};
  else if(url.pathname.startsWith('/api/')) data={};
  if(data){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return;}
  const file = path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
  if(url.pathname==='/static/smart-canvas.html') res.end(fs.readFileSync(file,'utf8').replace('<head>','<head>'+bootstrap));
  else fs.createReadStream(file).pipe(res);
});
server.listen(0,'127.0.0.1',()=>console.log('Viewport acceptance: http://127.0.0.1:'+server.address().port+'/'));
