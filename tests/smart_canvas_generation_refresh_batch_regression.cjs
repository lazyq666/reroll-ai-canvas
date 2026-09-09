const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

async function refreshBatch({ savedTask }) {
  let nextId = 0;
  const fetches = [];
  const slots = [0, 1].map(index => ({
    id: `slot-${index}`, type: 'smart-image', generationOutputNode: true,
    generationOperationId: 'batch-operation', images: [], pending: 1,
    generationInputSnapshot: { settings: { count: 2 } },
    generationBatchId: 'batch-1', generationSlotIndex: index, generationSlotCount: 2,
    x: index * 300, y: 100,
    pendingTasks: index || savedTask ? [{
      taskId: 'batch-run', actorId: 'actor', kind: 'image',
      generationBatchId: 'batch-1', generationSlotIndex: index, generationSlotCount: 2,
      submissionSnapshot: { outputCount: 0, outputIds: [], geometry: { x: index * 300, y: 100 } },
    }] : [],
  }));
  const sandbox = {
    window: { __IC_USER: { id: 'actor' }, SmartCanvasModules: { canvasMutation: {
      create: () => null, connect: () => true,
      createBatch: ({ drafts = [] } = {}) => { sandbox.nodes.push(...drafts); return drafts; },
    } } },
    nodes: slots, canvas: { connections: [] },
    selectedId: '', selectedImage: { nodeId: '', index: -1 },
    activeComposerSubject: null, lastComposerNodeId: '',
    MEDIA_NODE_DEFAULT_SCALE: 1, MEDIA_GROUP_DEFAULT_SCALE: 0.9,
    MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE: 0.8,
    uid: prefix => `${prefix}-${++nextId}`, nowMs: () => 2000,
    nodeRect: node => ({ x: node.x || 0, y: node.y || 0, width: 200, height: 120 }),
    pendingBoxSize: () => ({ w: 260, h: 180 }),
    isSmartImageNode: node => node?.type === 'smart-image', isHistoryGroupNode: () => false,
    attachRunMeta: () => null, stripRunInputMeta: meta => meta,
    stripImageGenerationMeta: item => item,
    resultMediaUrls: value => Array.isArray(value) ? value : [value],
    copyMediaSizeFields: (_source, target) => ({ ...target }), liveSmartNode: node => node,
    markSmartNodeComplete: node => { node.pending = 0; node.running = false; return node; },
    downstreamNodesForId: () => [], mediaNodeDefaultScale: () => 1,
    clearSourceBusyStateIfDownstreamDone: () => false,
    smartRecoverableImageTask: () => null, mediaKindForUrls: () => 'image',
    smartNodeHasDisplayResult: node => node.images.some(item => item.url),
    restoreGenerationPresentationSnapshot: () => false, addSmartGenerationLog: () => null,
    render: () => null, toast: () => null, tr: key => key, trf: key => key,
    setTimeout: callback => { callback(); return 0; },
    fetch: async (url, options) => {
      fetches.push({ url, method: options?.method || 'GET' });
      return { ok: true, json: async () => ({
        status: 'succeeded', created_at: 1, updated_at: 2,
        result: { image_items: [{ url: 'one.png', kind: 'image' }, { url: 'two.png', kind: 'image' }] },
      }) };
    },
  };
  vm.createContext(sandbox);
  const load = name => vm.runInContext(fs.readFileSync(path.join(root, 'static/js/smart-canvas', name), 'utf8'), sandbox);
  load('generation-pending.js');
  load('generation-output.js');
  sandbox.window.SmartCanvasModules.generationSettings = { snapshot: () => ({}) };
  sandbox.window.SmartCanvasModules.canvasPersistence = { schedule: () => null, save: async () => true };
  load('generation-recovery.js');
  const recovery = sandbox.window.SmartCanvasModules.generationRecovery;
  // The page restores the primary Run anchor before resuming persisted per-slot tasks.
  recovery.restoreActive({ runs: [{
    id: 'batch-run', kind: 'image', status: 'running', actor_id: 'actor',
    node_id: 'slot-0', generation_operation_id: 'batch-operation',
    provider_id: 'apimart', generation_request_index: 0, created_at: 1,
  }] });
  const restoredSnapshot = slots[0].pendingTasks[0].submissionSnapshot;
  await recovery.resume();
  assert.equal(slots.length, 2, 'refresh must not split the second output into a duplicate third node');
  assert.deepEqual(slots.map(node => Array.from(node.images, image => image.url)), [['one.png'], ['two.png']]);
  assert.deepEqual(slots.map(node => [node.x, node.y]), [[0, 100], [300, 100]]);
  assert.ok(slots.every(node => !node.pending && !(node.pendingTasks || []).length));
  assert.ok(fetches.length && fetches.every(call => call.method === 'GET' && call.url === '/api/canvas-image-tasks/batch-run'));
  if (savedTask) assert.equal(restoredSnapshot?.outputCount, 0, 'retain the accepted submission snapshot');
}

(async () => {
  await refreshBatch({ savedTask: true });
  await refreshBatch({ savedTask: false });
  console.log('PASS: refresh restores batch output slots without duplicate nodes or provider resubmission');
})().catch(error => { console.error(error); process.exitCode = 1; });
