const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));

function loadOutput(nodes) {
  let nextId = 0;
  const sandbox = {
    window: { SmartCanvasModules: { canvasMutation: {
      createBatch({ drafts = [] }) { nodes.push(...drafts); return drafts; },
    } } },
    nodes, canvas: { nodes, connections: [] },
    selectedId: '', selectedImage: { nodeId: '', index: -1 },
    activeComposerSubject: null, lastComposerNodeId: '',
    MEDIA_NODE_DEFAULT_SCALE: 1, MEDIA_GROUP_DEFAULT_SCALE: 0.9,
    MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE: 0.8,
    uid: prefix => `${prefix}-${++nextId}`, nowMs: () => 2000,
    isSmartImageNode: node => node?.type === 'smart-image',
    attachRunMeta: () => null, stripImageGenerationMeta: item => item,
    copyMediaSizeFields: (_source, target) => ({ ...target }),
    liveSmartNode: node => node, mediaNodeDefaultScale: () => 1,
    resultMediaUrls: value => Array.isArray(value) ? value : [value],
    markSmartNodeComplete: node => { node.pending = 0; node.running = false; return node; },
    clearSourceBusyStateIfDownstreamDone: () => false,
    tr: key => key,
  };
  vm.createContext(sandbox);
  for (const name of ['generation-pending.js', 'generation-output.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'static/js/smart-canvas', name), 'utf8'), sandbox);
  }
  return sandbox.window.SmartCanvasModules.generationOutput;
}

function taskNode(strategy, kind) {
  return {
    id: `task-${strategy}-${kind}`, type: 'smart-image', x: 10, y: 20,
    generationOutputNode: true, referenceGenerationKind: kind, outputKind: kind,
    images: [], pending: strategy === 'queued' ? 0 : 1,
    ...(strategy === 'queued' ? { jimengPending: { submitId: 'queue-1', kind } } : {}),
    ...(strategy === 'task' ? { pendingTasks: [{ taskId: 'run-1', kind }] } : {}),
    runSettings: { engine: 'api', apiKind: kind, videoProvider: 'jimeng', videoModel: 'seedance2.5', videoDuration: 22 },
    generationInputSnapshot: { settings: { apiKind: kind, videoModel: 'seedance2.5', videoDuration: 22 } },
    promptDraftText: 'Keep this prompt', manualInputRefs: [{ nodeId: 'reference', url: 'reference.png' }],
    runStartedAt: 1000,
  };
}

for (const strategy of ['pending', 'queued', 'task']) {
  for (const kind of ['video', 'image']) {
    for (const count of [1, 2]) {
      const node = taskNode(strategy, kind);
      const nodes = [node];
      const output = loadOutput(nodes);
      const ext = kind === 'video' ? 'mp4' : 'png';
      const outputs = Array.from({ length: count }, (_, index) => ({ url: `result-${index}.${ext}`, kind }));
      output.apply({ node, strategy, taskId: 'run-1', outputs, kind });

      assert.equal(node.referenceGenerationKind, kind, `${strategy}: ${kind} completion must retain the task kind`);
      assert.equal(node.outputKind, kind);
      assert.equal(Number(node.pending || 0), 0);
      assert.equal((node.pendingTasks || []).length, 0);
      assert.equal(nodes.length, kind === 'image' ? count : 1, `${strategy}: only image results split into separate nodes`);
      assert.equal(node.images.length, kind === 'video' ? count : 1);
      assert.ok(nodes.every(item => item.referenceGenerationKind === kind && item.outputKind === kind));
      assert.equal(node.runSettings.videoModel, 'seedance2.5');
      assert.equal(node.runSettings.videoDuration, 22);
      assert.equal(node.promptDraftText, 'Keep this prompt');
      assert.deepEqual(node.manualInputRefs, [{ nodeId: 'reference', url: 'reference.png' }]);

      // Exercise the saved JSON boundary and the same public normalization used
      // when a Canvas is loaded, rather than checking only the rendered label.
      const reloaded = clone(nodes);
      const reloadOutput = loadOutput(reloaded);
      for (const item of reloaded) {
        assert.equal(reloadOutput.repairReferenceKind({ node: item }), kind);
        assert.equal(item.referenceGenerationKind, kind);
        assert.equal(item.runSettings.videoDuration, 22);
      }
    }
  }
}

const legacy = taskNode('pending', 'video');
legacy.referenceGenerationKind = 'image';
legacy.images = [{ url: 'existing-result.mp4', kind: 'video', generatedResult: true }];
legacy.pending = 0;
const preserved = clone(legacy);
const repair = loadOutput([legacy]);
assert.equal(repair.repairReferenceKind({ node: legacy }), 'video', 'actual video output must override the old erroneous image identity');
assert.deepEqual(legacy, { ...preserved, referenceGenerationKind: 'video' }, 'repair changes only the contradicted identity');

const upload = {
  id: 'ordinary-upload', type: 'smart-image', images: [{ url: 'upload.mp4', kind: 'video' }],
  runSettings: { apiKind: 'video' },
};
assert.equal(repair.repairReferenceKind({ node: upload }), '', 'ordinary media does not become a Generation Output from old settings');
assert.equal(upload.referenceGenerationKind, undefined);

console.log('PASS: pending, queued and task completion preserve video identity across save/reload; image splitting and legacy repair remain safe');
