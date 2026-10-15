// Throwaway, loopback-only music UI demo. Static assets + inert shell fixtures; no Provider or persistence.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const createLayout=process.argv.includes('--create');
const entry='/?prototype=music&variant=B';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.json':'application/json'};
const json=(res,value)=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
http.createServer((req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1');
 if(!['GET','HEAD'].includes(req.method))return res.writeHead(405).end();
 if(u.pathname==='/api/auth/me')return json(res,{user:{id:'music-prototype',username:'Demo',display_name:'Demo',role:'designer',status:'active'}});
 if(u.pathname==='/api/app-info')return json(res,{version:'prototype'});
 if(u.pathname==='/api/admin/cli-updates')return json(res,{items:[],notification_items:[],checking:false});
 if(u.pathname==='/api/workspace-storage-settings')return json(res,{active:{workspace_directory:''},configured:{}});
 if(u.pathname==='/api/music/history')return json(res,{items:[],next_cursor:''});
 if(u.pathname.startsWith('/api/'))return res.writeHead(404).end();
 if((u.pathname==='/'||u.pathname==='/studio')&&u.searchParams.get('prototype')!=='music'){res.writeHead(302,{Location:'/?prototype=music&variant=B'});return res.end();}
 // Reuse the real shell and its existing sidebar. Only the lab iframe response
 // is swapped in --create preview mode; no production shell asset is changed.
 const rel=createLayout&&u.pathname==='/static/lab.html'&&u.searchParams.get('prototype')==='music'
  ?'/static/music-create-prototype.html'
  :u.pathname==='/'||u.pathname==='/studio'?'/static/index.html':decodeURIComponent(u.pathname);
 if(!rel.startsWith('/static/'))return res.writeHead(404).end();
 const file=path.resolve(root,'.'+rel);
 if(!file.startsWith(path.join(root,'static')+path.sep))return res.writeHead(403).end();
 fs.readFile(file,(err,data)=>{if(err)return res.writeHead(404).end();res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:data);});
}).listen(18886,'127.0.0.1',()=>console.log('Music UI prototype: http://127.0.0.1:18886'+entry));
