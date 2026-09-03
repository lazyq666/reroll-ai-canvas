// Serves the real Smart Canvas page in its transient review mode; no workspace is written.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.ISSUE_21_PORT || 8821);
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'};
http.createServer((request,response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    response.setHeader('Cache-Control','no-store');
    if(url.pathname === '/favicon.ico') return response.writeHead(204).end();
    const media = url.pathname.match(/^\/test-media\/(\d+)x(\d+)\.svg$/);
    if(media){
        const send = () => {
            response.setHeader('Content-Type','image/svg+xml');
            response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${media[1]}" height="${media[2]}" viewBox="0 0 400 300"><rect width="400" height="300" fill="#a8b9d2"/><circle cx="290" cy="105" r="80" fill="#f1c39b"/><path d="M0 300V240L140 90L340 300" fill="#526985"/></svg>`);
        };
        return url.searchParams.has('delayed') ? setTimeout(send,700) : send();
    }
    if(url.pathname.startsWith('/api/')){
        response.setHeader('Content-Type','application/json');
        return response.end('{}');
    }
    const relative = url.pathname === '/fixture.html' ? 'static/smart-canvas.html' : decodeURIComponent(url.pathname).slice(1);
    const file = path.resolve(root,relative);
    const publicFile = file.startsWith(path.join(root,'static') + path.sep)
        || file === path.join(root,'tests/issue_21_image_metadata_browser_harness.js');
    if(!publicFile || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end();
    response.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');
    if(url.pathname === '/fixture.html'){
        return response.end(fs.readFileSync(file,'utf8').replace('</body>','<script src="/tests/issue_21_image_metadata_browser_harness.js"></script></body>'));
    }
    fs.createReadStream(file).pipe(response);
}).listen(port,'127.0.0.1',() => console.log(`Issue #21 browser acceptance: http://127.0.0.1:${port}/fixture.html?componentReview=nodes`));
