const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.T25_PREVIEW_PORT || 8798);

const state = {
  history: Array.from({ length: 17 }, (_, index) => ({
    timestamp: 1700000000000 + index,
    prompt: `电影感测试画面 ${index + 1}`,
    images: ['/static/images/brand/logo.png'],
    type: index === 0 ? 'cloud' : 'zimage',
  })),
  localRequests: [],
  cloudRequests: [],
  deleted: [],
};

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/favicon.ico') return response.writeHead(204).end();
  if (url.pathname === '/api/history' && request.method === 'GET') return json(response, 200, state.history);
  if (url.pathname === '/api/queue_status' && request.method === 'GET') return json(response, 200, { total: 0, position: 0 });
  if (url.pathname === '/api/config' && request.method === 'GET') return json(response, 200, { has_ms_key: true });
  if (url.pathname === '/api/generate' && request.method === 'POST') {
    const payload = await readJson(request).catch(() => ({}));
    state.localRequests.push(payload);
    const item = { timestamp: Date.now(), prompt: payload.prompt, images: ['/static/images/brand/logo.png'], type: 'zimage' };
    state.history.unshift(item);
    return json(response, 200, item);
  }
  if (url.pathname === '/generate' && request.method === 'POST') {
    const payload = await readJson(request).catch(() => ({}));
    state.cloudRequests.push(payload);
    return json(response, 200, { url: '/static/images/brand/logo.png' });
  }
  if (url.pathname === '/api/history/delete' && request.method === 'POST') {
    const payload = await readJson(request).catch(() => ({}));
    const timestamp = String(payload.timestamp || '');
    state.deleted.push(timestamp);
    state.history = state.history.filter(item => String(item.timestamp) !== timestamp);
    return json(response, 200, { success: true });
  }
  if (url.pathname === '/api/test/state') return json(response, 200, state);

  const requestPath = url.pathname === '/zimage' ? '/static/zimage.html' : decodeURIComponent(url.pathname);
  const file = path.resolve(ROOT, `.${requestPath}`);
  if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
  fs.readFile(file, (error, body) => {
    if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
    const type = {
      '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
      '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
    }[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(body);
  });
});

server.on('upgrade', (request, socket) => {
  if (!request.url.startsWith('/ws/stats')) return socket.destroy();
  const accept = crypto
    .createHash('sha1')
    .update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    '',
  ].join('\r\n'));
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`T25 preview: http://127.0.0.1:${PORT}/zimage\n`);
});
