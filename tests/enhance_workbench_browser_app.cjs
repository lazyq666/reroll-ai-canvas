const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.ENHANCE_PREVIEW_PORT || 8798);
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=', 'base64');
const state = { uploads: 0, generations: [], deletes: [], failNextUpload: false };
const history = [
  { images: ['/api/mock-image/archive-a.png'], timestamp: 1786586400000, params: { '15': { image: 'archive-a-input.png' } } },
  { images: ['/api/mock-image/archive-b.png'], timestamp: 1786582800000, params: { '15': { image: 'archive-b-input.png' } } },
];

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise(resolve => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (_) { resolve({}); }
    });
  });
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
  if (url.pathname.startsWith('/api/mock-image/') || url.pathname === '/api/view') {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    return response.end(tinyPng);
  }
  if (url.pathname === '/api/history' && request.method === 'GET') return json(response, 200, history);
  if (url.pathname === '/api/upload' && request.method === 'POST') {
    await drain(request);
    state.uploads += 1;
    if (state.failNextUpload) {
      state.failNextUpload = false;
      return json(response, 200, { error: 'mock upload failure', files: [] });
    }
    return json(response, 200, { files: [{ filename: 'enhance-input.png', comfy_name: `enhance-input-${state.uploads}.png` }] });
  }
  if (url.pathname === '/api/generate' && request.method === 'POST') {
    const payload = await readJson(request);
    state.generations.push(payload);
    const upscale = payload.workflow_json === 'upscale.json';
    return json(response, 200, {
      images: [`/api/mock-image/${upscale ? 'upscaled' : 'enhanced'}.png`],
      timestamp: 1786590000000 + state.generations.length,
      params: payload.params,
    });
  }
  if (url.pathname === '/api/history/delete' && request.method === 'POST') {
    const payload = await readJson(request);
    state.deletes.push(payload.timestamp);
    return json(response, 200, { success: true });
  }
  if (url.pathname === '/api/test/state') return json(response, 200, state);
  if (url.pathname === '/api/test/reset' && request.method === 'POST') {
    state.uploads = 0;
    state.generations = [];
    state.deletes = [];
    state.failNextUpload = false;
    return json(response, 200, { success: true });
  }
  if (url.pathname === '/api/test/fail-upload' && request.method === 'POST') {
    state.failNextUpload = true;
    return json(response, 200, { success: true });
  }

  const requestPath = url.pathname === '/enhance' ? '/static/enhance.html' : decodeURIComponent(url.pathname);
  const file = path.resolve(ROOT, `.${requestPath}`);
  if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
  fs.readFile(file, (error, body) => {
    if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
    const type = {
      '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
      '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
    }[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    response.end(body);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`Enhance preview: http://127.0.0.1:${PORT}/enhance\n`);
});
