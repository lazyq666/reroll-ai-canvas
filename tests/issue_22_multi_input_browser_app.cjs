// Isolated production-page fixture: no real workspace or Provider is used.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const port = Number(process.env.ISSUE_22_PORT || 8822);
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'};
http.createServer((request,response)=>{
    const url = new URL(request.url,`http://127.0.0.1:${port}`);
    response.setHeader('Cache-Control','no-store');
    if(url.pathname === '/favicon.ico') return response.writeHead(204).end();
    if(url.pathname === '/test-image.svg'){
        response.setHeader('Content-Type','image/svg+xml');
        return response.end('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#749aca"/><circle cx="170" cy="50" r="30" fill="#f5cb85"/></svg>');
    }
    if(url.pathname.startsWith('/api/')){
        response.setHeader('Content-Type','application/json');
        return response.end('{}');
    }
    const file = path.resolve(root,url.pathname === '/fixture.html' ? 'static/smart-canvas.html' : decodeURIComponent(url.pathname).slice(1));
    if(!(file.startsWith(path.join(root,'static')+path.sep) || file===path.join(root,'tests/issue_22_multi_input_browser_harness.js')) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end();
    response.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');
    if(url.pathname === '/fixture.html') return response.end(fs.readFileSync(file,'utf8').replace('</body>','<script src="/tests/issue_22_multi_input_browser_harness.js"></script></body>'));
    fs.createReadStream(file).pipe(response);
}).listen(port,'127.0.0.1',()=>console.log(`Issue #22: http://127.0.0.1:${port}/fixture.html?componentReview=nodes`));
