const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.API_SETTINGS_PREVIEW_PORT || 8794);
const RUNNINGHUB_READY = process.env.API_SETTINGS_RUNNINGHUB_READY === '1';
const models = {
  all: ['gpt-image-2', 'gpt-image-2-4k-preview', 'gpt-5.5', 'long-context-chat-preview', 'seedance-2.0-fast', 'veo-3.1'],
  image_models: ['gpt-image-2', 'gpt-image-2-4k-preview'],
  chat_models: ['gpt-5.5', 'long-context-chat-preview'],
  video_models: ['seedance-2.0-fast', 'veo-3.1'],
  model_names: {
    'gpt-image-2': 'GPT Image 2',
    'gpt-image-2-4k-preview': 'GPT Image 2 · 4K Preview',
    'gpt-5.5': 'GPT 5.5',
    'long-context-chat-preview': 'Long Context Chat Preview',
    'seedance-2.0-fast': 'Seedance 2.0 Fast',
    'veo-3.1': 'Veo 3.1',
  },
};
const state = {
  saves: [],
  providers: [
    {
      id: 'modelscope', name: 'ModelScope', base_url: 'https://api-inference.modelscope.cn/v1', protocol: 'openai',
      enabled: true, primary: false, has_key: false, key_preview: '', image_request_mode: 'openai', image_edit_route: 'general',
      image_models: ['Tongyi-MAI/Z-Image-Turbo'], chat_models: ['Qwen/Qwen3-32B'], video_models: [], ms_loras: [],
    },
    {
      id: 'runninghub', name: 'RunningHub', base_url: 'https://www.runninghub.cn', protocol: 'runninghub',
      enabled: true, primary: false, has_key: RUNNINGHUB_READY, key_preview: RUNNINGHUB_READY ? 'rh_••••42' : '', has_wallet_key: false,
      image_request_mode: 'openai', image_edit_route: 'general', image_models: [], chat_models: [], video_models: [],
      rh_apps: [{
        id: 'app-001', appId: 'app-001', title: '产品海报生成器', note: '用于测试应用参数编辑与预览。',
        fields: [
          { nodeId: 'app', fieldName: 'prompt', fieldValue: '未来城市产品海报', fieldType: 'TEXT', label: '画面描述', enabled: true, group: '基础参数' },
          { nodeId: 'app', fieldName: 'aspect_ratio', fieldValue: '16:9', fieldType: 'SELECT', label: '画幅', enabled: true, group: '基础参数', options: ['16:9', '1:1', '9:16'] },
          { nodeId: 'app', fieldName: 'seed', fieldValue: 42, fieldType: 'NUMBER', label: '种子', enabled: true, group: '基础参数', sourceFromUpstream: true, random_enabled: true, min: 1, max: 999999, step: 1 },
          { nodeId: 'app', fieldName: 'image', fieldValue: '', fieldType: 'IMAGE', label: '参考图', enabled: true, group: '素材' },
        ],
      }],
      rh_workflows: [{
        id: 'workflow-001', workflowId: 'workflow-001', title: '电影感图像工作流', note: '用于测试节点映射、素材上传和预览。',
      }],
    },
    {
      id: 'volcengine', name: '火山引擎', base_url: 'https://ark.cn-beijing.volces.com/api/v3', protocol: 'volcengine',
      enabled: true, primary: false, has_key: true, key_preview: 'ark_••••18', image_request_mode: 'openai', image_edit_route: 'general',
      image_models: [], chat_models: [], video_models: ['seedance-2.0-fast'], volcengine_project_name: 'default', volcengine_region: 'cn-beijing',
    },
    {
      id: 'long-provider-name', name: 'Creative Gateway With A Very Long Provider Name', base_url: 'https://gateway.example.test/openai-compatible/v1',
      protocol: 'openai', enabled: true, primary: false, has_key: true, key_preview: 'sk_••••42', image_request_mode: 'openai', image_edit_route: 'general',
      image_models: ['gpt-image-2', 'gpt-image-2-4k-preview'], chat_models: ['gpt-5.5', 'long-context-chat-preview'], video_models: ['veo-3.1'],
      model_names: models.model_names,
    },
  ],
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
  if (url.pathname === '/api/providers' && request.method === 'GET') return json(response, 200, { providers: state.providers });
  if (url.pathname === '/api/providers' && request.method === 'PUT') {
    try {
      const payload = await readJson(request);
      state.saves.push(payload);
      state.providers = payload.map(provider => ({ ...provider, has_key: Boolean(provider.api_key) || true, key_preview: 'sk_••••42' }));
      return json(response, 200, { providers: state.providers });
    } catch (_) { return json(response, 400, { detail: '平台数据格式无效' }); }
  }
  if (url.pathname === '/api/providers/fetch-models' && request.method === 'POST') return json(response, 200, { ...models, total: models.all.length, protocol: 'openai', image_request_mode: 'openai' });
  if (url.pathname === '/api/providers/test-connection' && request.method === 'POST') return json(response, 200, { ok: true, ...models, model_count: models.all.length, total: models.all.length, protocol: 'openai', image_request_mode: 'openai' });
  if (url.pathname === '/api/providers/probe-async' && request.method === 'POST') return json(response, 200, { ok: true, protocol: 'openai', image_request_mode: 'openai', status_code: 200, message: 'OpenAI compatible', raw: { object: 'list' } });
  if (url.pathname === '/api/runninghub/workflows/workflow-001' && request.method === 'GET') return json(response, 200, {
    workflow: {
      workflowId: 'workflow-001', title: '电影感图像工作流', description: '用于测试节点映射、素材上传和预览。', optionalImageMode: 'prune-workflow',
      fields: [
        { nodeId: '1', fieldName: 'text', fieldValue: '电影感未来城市', fieldType: 'TEXT', label: '提示词', enabled: true, group: '提示词' },
        { nodeId: '2', fieldName: 'image', fieldValue: '', fieldType: 'IMAGE', label: '参考图', enabled: true, group: '素材', imageOrder: 1, required: true },
        { nodeId: '3', fieldName: 'seed', fieldValue: 42, fieldType: 'NUMBER', label: '随机种子', enabled: true, group: '采样', random_enabled: true, min: 1, max: 99, step: 1 },
      ],
      workflowJson: {
        '1': { class_type: 'CLIPTextEncode', inputs: { text: '电影感未来城市' }, _meta: { title: '提示词' } },
        '2': { class_type: 'LoadImage', inputs: { image: 'input.png' }, _meta: { title: '参考图' } },
        '3': { class_type: 'KSampler', inputs: { seed: 42, positive: ['1', 0], image: ['2', 0] }, _meta: { title: '采样器' } },
      },
    },
  });
  if (url.pathname === '/api/runninghub/workflows/workflow-001' && request.method === 'PUT') {
    const payload = await readJson(request).catch(() => ({}));
    return json(response, 200, { success: true, workflow: payload });
  }
  if (url.pathname === '/api/runninghub/workflows/fetch' && request.method === 'POST') {
    const payload = await readJson(request).catch(() => ({}));
    return json(response, 200, { success: true, data: { workflowId: payload.workflowId || 'workflow-001', title: payload.title || '电影感图像工作流', description: payload.description || '', fields: [], workflowJson: {}, raw: {} } });
  }
  if (url.pathname === '/api/runninghub/app-info' && request.method === 'GET') return json(response, 200, { success: true, data: { fields: [] } });
  if (url.pathname === '/api/jimeng/status') return json(response, 200, { installed: true, logged_in: true, version_ok: true, cli_version: '1.6.0', raw: { credits: 3280 } });
  if (url.pathname === '/api/jimeng/credit') return json(response, 200, { raw: { credits: 3280 } });
  if (url.pathname === '/api/codex/status') return json(response, 200, { installed: true, logged_in: true, version: 'codex 1.2.3', path: '/usr/local/bin/codex', message: 'Ready' });
  if (url.pathname === '/api/gemini-cli/status') return json(response, 200, { installed: true, logged_in: true, version: 'agy 0.9.0', path: '/usr/local/bin/agy', message: 'Ready' });
  if (['/api/jimeng/help', '/api/codex/help', '/api/gemini-cli/help'].includes(url.pathname) && request.method === 'POST') {
    const payload = await readJson(request).catch(() => ({}));
    return json(response, 200, { text: `${url.pathname.split('/')[2]} ${payload.command || '--help'}\nMock command reference` });
  }
  if (url.pathname === '/api/test/state') return json(response, 200, state);

  const requestPath = url.pathname === '/api-settings' ? '/static/api-settings.html' : decodeURIComponent(url.pathname);
  const file = path.resolve(ROOT, `.${requestPath}`);
  if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
  fs.readFile(file, (error, body) => {
    if (error) return response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
    const type = {
      '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
      '.png': 'image/png', '.gif': 'image/gif', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
    }[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(body);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`API Settings preview: http://127.0.0.1:${PORT}/api-settings\n`);
});
