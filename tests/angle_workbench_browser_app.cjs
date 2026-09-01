const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.ANGLE_PREVIEW_PORT || 8797);
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=', 'base64');
const state = { uploads: 0, generations: 0, deletes: [] };

const history = [
  { images: ['/api/mock-image/archive-local.png'], prompt: '建筑正面，轻微仰视', timestamp: 1786586400000, is_cloud: false },
  { images: ['/api/mock-image/archive-cloud.png'], prompt: '产品右转 30 度', timestamp: 1786582800000, is_cloud: true },
];

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function drain(request) {
  return new Promise(resolve => {
    request.on('data', () => {});
    request.on('end', resolve);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/favicon.ico') return response.writeHead(204).end();
  if (url.pathname.startsWith('/api/mock-image/')) {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    return response.end(tinyPng);
  }
  if (url.pathname === '/api/config') return json(response, 200, { has_ms_key: true });
  if (url.pathname === '/api/history' && request.method === 'GET') return json(response, 200, history);
  if (url.pathname === '/api/upload' && request.method === 'POST') {
    await drain(request);
    state.uploads += 1;
    return json(response, 200, { files: [{ filename: 'angle-input.png', comfy_name: 'angle-input.png' }] });
  }
  if (url.pathname === '/api/generate' && request.method === 'POST') {
    await drain(request);
    state.generations += 1;
    return json(response, 200, { images: ['/api/mock-image/generated-local.png'] });
  }
  if (url.pathname === '/api/angle/generate' && request.method === 'POST') {
    await drain(request);
    state.generations += 1;
    return json(response, 200, { url: '/api/mock-image/generated-cloud.png' });
  }
  if (url.pathname === '/api/history/delete' && request.method === 'POST') {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      try { state.deletes.push(JSON.parse(Buffer.concat(chunks).toString('utf8')).timestamp); } catch (_) {}
      json(response, 200, { success: true });
    });
    return;
  }
  if (url.pathname === '/api/test/state') return json(response, 200, state);

  const requestPath = url.pathname === '/angle' ? '/static/angle.html' : decodeURIComponent(url.pathname);
  const file = path.resolve(ROOT, `.${requestPath}`);
  if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
  fs.readFile(file, (error, body) => {
    if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
    const type = {
      '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
      '.png': 'image/png', '.gif': 'image/gif', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
    }[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(body);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`Angle preview: http://127.0.0.1:${PORT}/angle\n`);
});
