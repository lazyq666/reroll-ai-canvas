// Disposable API fixtures around the real canvas-list page for visual/interaction QA.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const names = ['林晓', 'Alex Chen', 'Maya', 'Jordan Lee', 'A Very Long Collaborator Display Name'];
const members = names.map((name, index) => ({
  participant_id: `member-${index}`, display_name: name, username: `user-${index}`,
  avatar_color_slot: index + 1, is_self: index === 4,
}));
const cards = [0, 1, 3, 5].map((count, index) => ({
  id: `canvas-${count}`, title: ['无人在线', '一个协作者', '三位协作者', '多人协作：一个用于验证省略显示的很长的画布标题'][index],
  kind: 'smart', project: 'default', owner_id: 'viewer', visibility: 'shared',
  node_count: 8, updated_at: 1788402600, board_x: (index % 3) * 312 + 40,
  board_y: Math.floor(index / 3) * 260 + 40, cover_url: '',
}));
cards.push({ ...cards[0], id: 'classic', kind: 'classic', title: '普通画布', board_x: 352, board_y: 300 });

function startServer(port = 8804) {
  const state = { mode: 'ready', requests: 0, writes: 0, sockets: 0, lastIds: [] };
  function json(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(payload));
  }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/favicon.ico') return res.writeHead(204).end();
    if (url.pathname === '/_test/state') {
      if (req.method === 'POST') state.mode = url.searchParams.get('mode') || 'ready';
      return json(res, 200, state);
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><html><head><title>Issue 20 presence QA</title></head><body style="margin:0">
        <nav style="height:40px;display:flex;gap:12px;align-items:center;padding:0 12px;background:#eee">
        <button onclick="frames[0].postMessage({type:'studio-lang',lang:'zh'},location.origin)">中文</button>
        <button onclick="frames[0].postMessage({type:'studio-lang',lang:'en'},location.origin)">English</button>
        <button onclick="frames[0].document.documentElement.classList.toggle('theme-dark');frames[0].document.documentElement.classList.toggle('studio-theme-dark')">Light / Dark</button>
        <button onclick="fetch('/_test/state?mode=failed',{method:'POST'})">Disconnect fixture</button>
        <button onclick="fetch('/_test/state?mode=ready',{method:'POST'})">Recover fixture</button>
        <button onclick="fetch('/_test/state?mode=empty',{method:'POST'})">Everyone leaves</button>
        </nav><iframe title="Canvas list preview" src="/static/canvas-list.html" style="display:block;width:100%;height:calc(100vh - 40px);border:0"></iframe></body></html>`);
    }
    if (url.pathname === '/api/auth/me') return json(res, 200, { user: { id: 'viewer', username: 'viewer', role: 'admin', status: 'active' } });
    if (url.pathname === '/api/projects') return json(res, 200, { projects: [{ id: 'default', name: '协作项目', order: 0, canvas_count: cards.length }] });
    if (url.pathname === '/api/canvases/trash') return json(res, 200, { canvases: [] });
    if (url.pathname === '/api/canvases' && req.method === 'GET') return json(res, 200, { canvases: cards, next_cursor: '', total: cards.length });
    if (url.pathname === '/api/canvases/presence') {
      state.requests += 1;
      let body = '';
      for await (const chunk of req) body += chunk;
      const ids = JSON.parse(body).canvas_ids;
      state.lastIds = ids;
      if (state.mode === 'failed') return json(res, 503, {});
      const result = {};
      for (const id of ids) {
        const count = Number(id.split('-')[1]);
        if (Number.isFinite(count)) result[id] = state.mode === 'empty' ? [] : members.slice(0, count);
      }
      return json(res, 200, { canvases: result });
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') state.writes += 1;
      return json(res, 200, {});
    }
    const file = path.resolve(ROOT, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(`${ROOT}${path.sep}`)) return res.writeHead(403).end();
    fs.readFile(file, (error, body) => {
      if (error) return res.writeHead(404).end();
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    });
  });
  server.on('upgrade', (_req, socket) => { state.sockets += 1; socket.destroy(); });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, state })));
}
module.exports = { startServer };
if (require.main === module) startServer(Number(process.env.PRESENCE_CARD_PREVIEW_PORT || 8804)).then(() => console.log('Presence card preview ready'));
