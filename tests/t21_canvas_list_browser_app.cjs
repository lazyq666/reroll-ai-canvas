const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.T21_PREVIEW_PORT || 8796);
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=', 'base64');

const projects = [
  { id: 'default', name: '品牌视觉', order: 0, canvas_count: 5 },
  { id: 'motion', name: '动态', order: 1, canvas_count: 5 },
];

function canvas(project, index) {
  return {
    id: `${project}-${index}`,
    title: project === 'motion' ? `动态分镜 ${index + 1}` : `品牌画布 ${index + 1}`,
    kind: index % 2 ? 'classic' : 'smart',
    project,
    visibility: index === 2 ? 'private' : 'shared',
    node_count: 8 + index * 3,
    updated_at: 1786586400 - index * 7200,
    board_x: 40 + (index % 3) * 312,
    board_y: 40 + Math.floor(index / 3) * 316,
    cover_url: index === 1 ? '' : `/assets/input/t21/${project}-${index}.png`,
  };
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/favicon.ico') return response.writeHead(204).end();
  if (url.pathname === '/api/auth/me') return json(response, 200, { user: { id: 't21-admin', username: 'admin', role: 'admin', status: 'active' } });
  if (url.pathname === '/api/projects') return json(response, 200, { projects });
  if (url.pathname === '/api/canvases/trash') return json(response, 200, { canvases: [] });
  if (url.pathname === '/api/canvases' && request.method === 'GET') {
    const project = url.searchParams.get('project') || 'default';
    const cursor = Number(url.searchParams.get('cursor') || 0);
    const count = cursor ? 2 : 3;
    const items = Array.from({ length: count }, (_, offset) => canvas(project, cursor + offset));
    return json(response, 200, {
      canvases: items,
      next_cursor: cursor + count < 5 ? String(cursor + count) : '',
      total: 5,
      rebuilding: false,
      index_read_ms: 1.8,
    });
  }
  if (url.pathname === '/api/media-preview' || url.pathname.startsWith('/assets/input/t21/')) {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    return response.end(tinyPng);
  }
  if (/^\/api\/canvases\/[^/]+\/meta$/.test(url.pathname) && request.method === 'POST') {
    return json(response, 200, { success: true });
  }

  const requestPath = url.pathname === '/canvas-list' ? '/static/canvas-list.html' : decodeURIComponent(url.pathname);
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
  process.stdout.write(`T21 preview: http://127.0.0.1:${PORT}/canvas-list\n`);
});
