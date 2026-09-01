const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.CANVAS_MANAGEMENT_PREVIEW_PORT || 8798);

let projects = [
  { id: 'default', name: '默认项目', order: 0 },
  { id: 'campaign', name: 'Campaign', order: 1 },
];
let canvases = [
  { id: 'owned-smart', title: 'Owned Smart Canvas', kind: 'smart', project: 'default', owner_id: 'admin-1', visibility: 'shared', node_count: 4, board_x: 40, board_y: 40, updated_at: 1786586400 },
  { id: 'team-smart', title: 'Team Smart Canvas', kind: 'smart', project: 'default', owner_id: 'admin-2', visibility: 'shared', node_count: 2, board_x: 352, board_y: 40, updated_at: 1786586300 },
];
let trash = [];
let nextCanvas = 1;
let nextProject = 1;
const shares = new Map();
const metrics = {
  created: 0,
  renamed: 0,
  trashed: 0,
  restored: 0,
  purged: 0,
  visibility: 0,
  shareCreated: 0,
  shareRegenerated: 0,
  shareRevoked: 0,
};

function actor(request) {
  const role = /(?:^|;\s*)canvas_role=designer(?:;|$)/.test(request.headers.cookie || '') ? 'designer' : 'admin';
  return { id: role === 'admin' ? 'admin-1' : 'designer-1', username: role, role, status: 'active' };
}

function json(response, status, value, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise(resolve => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (_error) { resolve({}); }
    });
  });
}

function canvasRecord(canvas) {
  return { ...canvas, cover_url: '', created_at: canvas.created_at || 1786586200 };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  const user = actor(request);
  if (url.pathname === '/favicon.ico') return response.writeHead(204).end();
  if (url.pathname === '/api/test-state') {
    return json(response, 200, { metrics, projects, canvases, trash, shares: Object.fromEntries(shares) });
  }
  if (url.pathname === '/api/auth/me') return json(response, 200, { user });
  if (url.pathname === '/api/projects' && request.method === 'GET') {
    return json(response, 200, { projects: projects.map(project => ({ ...project, canvas_count: canvases.filter(canvas => canvas.project === project.id).length })) });
  }
  if (url.pathname === '/api/projects' && request.method === 'POST') {
    if (user.role !== 'admin') return json(response, 403, { detail: 'admin only' });
    const payload = await readJson(request);
    const project = { id: `project-${nextProject++}`, name: payload.name || 'New project', order: projects.length, canvas_count: 0 };
    projects.push(project);
    return json(response, 200, { project });
  }
  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && request.method === 'POST') {
    if (user.role !== 'admin') return json(response, 403, { detail: 'admin only' });
    const payload = await readJson(request);
    const project = projects.find(item => item.id === decodeURIComponent(projectMatch[1]));
    if (!project) return json(response, 404, { detail: 'missing' });
    project.name = payload.name || project.name;
    return json(response, 200, { project });
  }
  if (projectMatch && request.method === 'DELETE') {
    if (user.role !== 'admin') return json(response, 403, { detail: 'admin only' });
    const projectId = decodeURIComponent(projectMatch[1]);
    projects = projects.filter(item => item.id !== projectId);
    canvases.forEach(canvas => { if (canvas.project === projectId) canvas.project = 'default'; });
    return json(response, 200, { ok: true });
  }
  if (url.pathname === '/api/canvases/trash') return json(response, 200, { canvases: trash.map(canvasRecord), retention_days: 30 });
  if (url.pathname === '/api/canvases' && request.method === 'GET') {
    const project = url.searchParams.get('project') || 'default';
    const items = canvases.filter(canvas => canvas.project === project).map(canvasRecord);
    return json(response, 200, { canvases: items, next_cursor: '', total: items.length, rebuilding: false, index_read_ms: 1 });
  }
  if (url.pathname === '/api/canvases' && request.method === 'POST') {
    const payload = await readJson(request);
    const canvas = canvasRecord({
      id: `created-${nextCanvas++}`,
      title: payload.title,
      kind: payload.kind,
      project: payload.project || 'default',
      owner_id: user.id,
      visibility: 'shared',
      node_count: 0,
      board_x: payload.board_x,
      board_y: payload.board_y,
      updated_at: Date.now(),
    });
    canvases.push(canvas);
    metrics.created += 1;
    return json(response, 200, { canvas });
  }

  const metaMatch = url.pathname.match(/^\/api\/canvases\/([^/]+)\/meta$/);
  if (metaMatch && request.method === 'POST') {
    const id = decodeURIComponent(metaMatch[1]);
    const payload = await readJson(request);
    const canvas = canvases.find(item => item.id === id);
    if (!canvas) return json(response, 404, { detail: 'missing' });
    if (payload.title && payload.title !== canvas.title) metrics.renamed += 1;
    Object.assign(canvas, payload);
    return json(response, 200, { canvas: canvasRecord(canvas) });
  }
  if (url.pathname === '/api/canvases/meta/batch' && request.method === 'POST') return json(response, 200, { canvases: [] });

  const visibilityMatch = url.pathname.match(/^\/api\/canvases\/([^/]+)\/visibility$/);
  if (visibilityMatch && request.method === 'PUT') {
    if (user.role !== 'admin') return json(response, 403, { detail: 'admin only' });
    const id = decodeURIComponent(visibilityMatch[1]);
    const payload = await readJson(request);
    const canvas = canvases.find(item => item.id === id);
    if (!canvas || canvas.owner_id !== user.id) return json(response, 403, { detail: 'owner only' });
    canvas.visibility = payload.visibility;
    if (payload.visibility === 'private') shares.delete(id);
    metrics.visibility += 1;
    return json(response, 200, { canvas: canvasRecord(canvas) });
  }

  const shareMatch = url.pathname.match(/^\/api\/canvases\/([^/]+)\/share(?:\/(regenerate))?$/);
  if (shareMatch) {
    const id = decodeURIComponent(shareMatch[1]);
    const canvas = canvases.find(item => item.id === id);
    if (!canvas) return json(response, 404, { detail: 'missing' });
    if (request.method === 'GET') return json(response, 200, { canvas_id: id, active: shares.has(id) });
    if (request.method === 'POST') {
      if (canvas.visibility === 'private') return json(response, 400, { detail: 'private canvas' });
      const token = `${shareMatch[2] ? 'regenerated' : 'created'}-${id}-${Date.now()}`;
      shares.set(id, token);
      if (shareMatch[2]) metrics.shareRegenerated += 1;
      else metrics.shareCreated += 1;
      return json(response, 200, { canvas_id: id, active: true, url: `/share/${token}` });
    }
    if (request.method === 'DELETE') {
      shares.delete(id);
      metrics.shareRevoked += 1;
      return json(response, 200, { ok: true, active: false });
    }
  }

  const restoreMatch = url.pathname.match(/^\/api\/canvases\/([^/]+)\/restore$/);
  if (restoreMatch && request.method === 'POST') {
    const id = decodeURIComponent(restoreMatch[1]);
    const index = trash.findIndex(item => item.id === id);
    if (index < 0) return json(response, 404, { detail: 'missing' });
    const [canvas] = trash.splice(index, 1);
    delete canvas.deleted_at;
    canvases.push(canvas);
    metrics.restored += 1;
    return json(response, 200, { canvas: canvasRecord(canvas) });
  }
  const purgeMatch = url.pathname.match(/^\/api\/canvases\/([^/]+)\/purge$/);
  if (purgeMatch && request.method === 'DELETE') {
    if (user.role !== 'admin') return json(response, 403, { detail: 'admin only' });
    const id = decodeURIComponent(purgeMatch[1]);
    trash = trash.filter(item => item.id !== id);
    metrics.purged += 1;
    return json(response, 200, { ok: true });
  }
  const canvasMatch = url.pathname.match(/^\/api\/canvases\/([^/]+)$/);
  if (canvasMatch && request.method === 'DELETE') {
    const id = decodeURIComponent(canvasMatch[1]);
    const index = canvases.findIndex(item => item.id === id);
    if (index < 0) return json(response, 404, { detail: 'missing' });
    const [canvas] = canvases.splice(index, 1);
    canvas.deleted_at = Date.now();
    trash.push(canvas);
    shares.delete(id);
    metrics.trashed += 1;
    return json(response, 200, { ok: true });
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
    const headers = { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' };
    if (url.pathname === '/canvas-list') headers['Set-Cookie'] = `canvas_role=${url.searchParams.get('as') === 'designer' ? 'designer' : 'admin'}; Path=/; SameSite=Lax`;
    response.writeHead(200, headers);
    response.end(body);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`Canvas management preview: http://127.0.0.1:${PORT}/canvas-list\n`);
});
