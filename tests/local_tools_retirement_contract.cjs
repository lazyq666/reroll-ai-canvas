const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'static/js/smart-canvas/generation-provider.js'), 'utf8');
const host = fs.readFileSync(path.join(root, 'static/js/smart-canvas.js'), 'utf8');
const payloads = [];
const sandbox = {
  window: {SmartCanvasModules: {}}, tr: key => key,
  imageRefsOnly: refs => refs, videoRefsOnly: () => [], audioRefsOnly: () => [],
  smartClientId: 'test', isApiLikeEngine: () => false,
  resultMediaUrls: result => Array.isArray(result) ? result : result.images || [],
  mediaKindForUrls: () => 'image',
  comfyWorkflows: [{name: 'custom/test.json'}],
  comfyRandomEnabledField: () => false,
  fetch: async (url, options) => {
    if (url.startsWith('/api/workflows/')) return {ok: true, json: async () => ({config: {fields: []}})};
    assert.equal(url, '/api/canvas-comfy-tasks');
    payloads.push(JSON.parse(options.body));
    return {ok: true, json: async () => ({task_id: 'retained-task', status: 'queued'})};
  },
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
// Exercise the real submission builder; replace only the external task query.
vm.runInContext("generationProviderWaitComfyTask = async () => ({images:['output.png']})", sandbox);
const models = host.match(/const MS_GEN_MODELS = (\{[\s\S]*?\n\});/);
assert.ok(models);
vm.runInContext(`const MS_GEN_MODELS = ${models[1]};`, sandbox);
const submit = sandbox.window.SmartCanvasModules.generationProvider.submit;

(async () => {
  for (const mode of ['edit', 'enhance', 'unknown']) {
    await assert.rejects(submit({settings: {engine: 'comfy', comfyMode: mode, comfyWorkflow:'custom/test.json'}}), /smart.errWorkflowUnavailable/);
  }
  await assert.rejects(submit({settings: {engine: 'modelscope', msgenModel: 'klein_edit'}}), /smart.errMsModelUnavailable/);
  assert.equal(payloads.length, 0, 'Unavailable modes must not submit or fall through to a custom workflow');
  const text = await submit({prompt:'test', settings:{engine:'comfy',comfyMode:'text',width:768,height:1024}});
  const custom = await submit({prompt:'test', settings:{engine:'comfy',comfyMode:'custom',comfyWorkflow:'custom/test.json'}});
  assert.equal(text.state, 'completed');
  assert.equal(custom.state, 'completed');
  assert.deepEqual(payloads.map(p => p.workflow_json), ['Z-Image.json','custom/test.json']);
  assert.equal(payloads[0].width, 768);
  assert.equal(payloads[0].height, 1024);
  console.log('Local tool retirement: removed modes reject; text and custom workflow submissions pass.');
})().catch(error => {console.error(error); process.exitCode = 1;});
