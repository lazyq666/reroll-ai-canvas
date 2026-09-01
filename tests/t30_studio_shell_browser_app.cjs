const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.T30_PREVIEW_PORT || 8798);
const framePages = new Set([
  '/static/zimage.html',
  '/static/enhance.html',
  '/static/klein.html',
  '/static/angle.html',
  '/static/online.html',
  '/static/account-management.html',
  '/static/api-settings.html',
  '/static/available-model-management.html',
  '/static/comfyui-settings.html',
  '/static/canvas-list.html',
  '/static/canvas.html',
  '/static/smart-canvas.html',
]);

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function stubFrame(pathname) {
  const title = pathname.split('/').pop().replace('.html', '');
  return Buffer.from(`<!doctype html><html><body data-frame="${title}"><main>${title}</main><script>addEventListener('message',event=>{if(event.data?.type==='studio-theme')document.documentElement.dataset.theme=event.data.theme})<\/script></body></html>`);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/favicon.ico') return response.writeHead(204).end();
  if (url.pathname === '/api/auth/me') {
    const role = /(?:^|;\s*)t30-role=designer(?:;|$)/.test(request.headers.cookie || '') ? 'designer' : 'admin';
    return json(response, 200, { user: { id: role === 'admin' ? '1' : '2', username: role, display_name: role === 'admin' ? 'Shell Admin' : 'Shell Designer', role, status: 'active' } });
  }
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') return json(response, 200, { ok: true });
  if (url.pathname === '/api/workspace-storage-settings') {
    return json(response, 200, { active: { workspace_directory: '/tmp/infinite-canvas' }, configured: {} });
  }
  if (framePages.has(url.pathname)) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return response.end(stubFrame(url.pathname));
  }

  const requestPath = url.pathname === '/' || url.pathname === '/studio' ? '/static/index.html' : decodeURIComponent(url.pathname);
  const file = path.resolve(ROOT, `.${requestPath}`);
  if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
  fs.readFile(file, (error, body) => {
    if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
    const type = {
      '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
      '.png': 'image/png', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
      '.webm': 'video/webm',
    }[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(body);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`T30 preview: http://127.0.0.1:${PORT}/studio\n`);
});
