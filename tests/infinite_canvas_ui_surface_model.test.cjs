const assert = require('node:assert/strict');
const test = require('node:test');

const surfaces = require('../static/js/ui-component-library/surface-model.js');


function surfaceManifest() {
  return {
    schemaVersion: 1,
    sourceRevision: 'sha256:surface-1',
    fingerprints: {
      legacy: 'sha256:legacy-1',
      contract: 'sha256:contract-1',
      implementation: 'sha256:implementation-1',
      semanticBaseline: 'sha256:semantic-1',
    },
    lifecycle: {
      states: [
        'draft',
        'contract_confirmed',
        'implemented',
        'live_confirmed',
        'migration_ready',
      ],
      humanGates: ['contract_confirmed', 'live_confirmed'],
      transitions: [
        ['draft', 'contract_confirmed'],
        ['contract_confirmed', 'implemented'],
        ['implemented', 'live_confirmed'],
        ['live_confirmed', 'migration_ready'],
      ],
    },
    surfaces: {
      migration: {
        outcomes: [
          { id: 'target-component', referenceRequired: true },
          { id: 'page-module', referenceRequired: true },
          { id: 'business-exception', referenceRequired: true },
          { id: 'remove', referenceRequired: false },
        ],
        targetComponentIds: ['ic-button', 'ic-input', 'ic-dialog'],
      },
    },
  };
}


function legacyManifest() {
  return {
    schemaVersion: 7,
    sourceRevision: 'sha256:legacy-1',
    candidates: [
      {
        id: 'legacy.button',
        label: '旧按钮',
        targetId: 'button.primary',
        sources: [
          {
            file: 'static/second.html', line: 20, source: 'html',
            scenario: '提交第二个表单', surface: '第二页', domPath: '#save-two',
          },
          {
            file: 'static/first.html', line: 10, source: 'javascript',
            scenario: '提交第一个表单', surface: '第一页', domPath: '#save-one',
          },
        ],
      },
      {
        id: 'legacy.dialog',
        label: '旧弹窗',
        targetId: 'dialog.modal-surface',
        sources: [
          {
            file: 'static/third.html', line: 30, source: 'html',
            scenario: '删除节点', surface: '第三页', domPath: '#delete-dialog',
          },
          {
            file: 'static/fourth.html', line: 40, source: 'html',
            scenario: '展示一次性提示', surface: '第四页', domPath: '#old-toast',
          },
        ],
      },
    ],
  };
}


function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}


function createStore(overrides = {}) {
  return surfaces.createStore({
    surfaceManifest: overrides.surfaceManifest || surfaceManifest(),
    legacyManifest: overrides.legacyManifest || legacyManifest(),
    semanticBaseline: overrides.semanticBaseline,
    storage: overrides.storage || memoryStorage(),
  });
}


test('legacy instances have stable identities and keep complete evidence', () => {
  const first = createStore();
  const reversed = legacyManifest();
  reversed.candidates.reverse();
  reversed.candidates.forEach((candidate) => candidate.sources.reverse());
  const second = createStore({ legacyManifest: reversed });

  assert.equal(first.instances().length, 4);
  assert.deepEqual(
    first.instances().map((item) => item.id),
    second.instances().map((item) => item.id),
  );
  assert.deepEqual(
    Object.keys(first.instances()[0].evidence).sort(),
    ['domPath', 'file', 'line', 'scenario', 'source', 'surface'],
  );
});


test('legacy identity ignores diagnostic source line changes', () => {
  const original = legacyManifest();
  const moved = legacyManifest();
  moved.candidates[0].sources[0].line = 999;

  const originalStore = createStore({ legacyManifest: original });
  const movedStore = createStore({ legacyManifest: moved });
  const originalInstance = originalStore.instances().find(
    (item) => item.evidence.domPath === '#save-two',
  );
  const movedInstance = movedStore.instances().find(
    (item) => item.evidence.domPath === '#save-two',
  );

  assert.equal(originalInstance.id, movedInstance.id);
  assert.notEqual(originalInstance.evidence.line, movedInstance.evidence.line);
});


test('each legacy instance has zero or one of the four dispositions while draft', () => {
  const store = createStore();
  const [target, pageModule, exception, remove] = store.instances();

  store.setMapping(target.id, { outcome: 'target-component', reference: 'ic-button' });
  store.setMapping(pageModule.id, { outcome: 'page-module', reference: '设置/账号模块' });
  store.setMapping(exception.id, { outcome: 'business-exception', reference: 'Smart Canvas 手势' });
  store.setMapping(remove.id, { outcome: 'remove' });

  assert.deepEqual(store.migrationSummary(), {
    total: 4,
    resolved: 4,
    unresolved: 0,
    outcomes: {
      'target-component': 1,
      'page-module': 1,
      'business-exception': 1,
      remove: 1,
    },
  });
  assert.equal(Object.keys(store.reverseMappings()).length, 4);

  store.setMapping(target.id, { outcome: 'remove' });
  assert.equal(store.snapshot().mappings[target.id].outcome, 'remove');
  assert.throws(
    () => store.setMapping(target.id, { outcome: 'target-component', reference: 'wa-button' }),
    /未知 Target 组件/,
  );
});


test('versioned semantic baseline seeds explainable mappings without faking human approval', () => {
  const legacyOnly = createStore();
  const instances = legacyOnly.instances();
  const semanticBaseline = {
    schemaVersion: 1,
    baselineVersion: 'infinite-canvas-ui-semantic-v1',
    baselineRevision: 'sha256:semantic-1',
    review: { status: 'pending-human-confirmation' },
    decisions: {
      'target.ic-button': {
        outcome: 'target-component',
        reference: 'ic-button',
        layer: 'primitive',
        rationale: '同用途按钮合并；只保留产品意义差异。',
      },
    },
    instances: instances.map((instance) => ({
      ...instance,
      decisionId: 'target.ic-button',
      evidenceFingerprint: `sha256:${instance.id}`,
    })),
    coverage: {
      classifiedInstanceCount: instances.length,
      unclassifiedInstanceCount: 0,
    },
  };
  const store = createStore({ semanticBaseline });

  assert.equal(store.migrationSummary().resolved, 4);
  assert.equal(store.migrationSummary().unresolved, 0);
  assert.equal(store.snapshot().status, 'draft');
  assert.deepEqual(store.snapshot().confirmations, {});
  assert.equal(
    store.snapshot().classificationBaselineRevision,
    'sha256:semantic-1',
  );
  assert.equal(store.instances()[0].classification.layer, 'primitive');
  assert.match(store.instances()[0].classification.rationale, /产品意义/);
});


test('migrated semantic evidence reverses to the actual public component', () => {
  const manifest = surfaceManifest();
  manifest.surfaces.migration.targetComponentIds.push('ic-segmented-control');
  const semanticBaseline = {
    schemaVersion: 1,
    baselineRevision: 'sha256:account-login-migration',
    review: { status: 'pending-human-confirmation' },
    decisions: {
      'target.ic-button': {
        outcome: 'target-component', reference: 'ic-button',
        layer: 'primitive', rationale: '旧模式按钮分类。',
      },
    },
    instances: [{
      id: 'legacy.login-mode', candidateId: 'legacy.button',
      decisionId: 'target.ic-button', label: '创建账号',
      migrationStatus: 'migrated', migrationId: 'account-login-migration',
      migratedTo: 'ic-segmented-control', replacement: '#auth-mode',
      evidence: {
        file: 'static/login.html', line: 25, source: 'html',
        scenario: '切换注册模式', surface: '登录与注册', domPath: '.auth-tab',
      },
    }],
    pageMigrations: [{ id: 'account-login-migration', visualAcceptance: 'confirmed' }],
    coverage: { classifiedInstanceCount: 1, unclassifiedInstanceCount: 0 },
  };
  const store = createStore({ surfaceManifest: manifest, semanticBaseline });

  assert.equal(store.instances()[0].migrationStatus, 'migrated');
  assert.equal(store.instances()[0].replacement, '#auth-mode');
  assert.equal(store.instances()[0].visualAcceptance, 'confirmed');
  assert.deepEqual(store.reverseMappings(), {
    'target-component:ic-segmented-control': ['legacy.login-mode'],
  });
  assert.equal(store.snapshot().status, 'draft');
});


test('the five lifecycle stages cannot skip and human gates require human evidence', () => {
  const store = createStore();
  for (const instance of store.instances()) store.setMapping(instance.id, { outcome: 'remove' });

  assert.equal(store.snapshot().status, 'draft');
  assert.throws(() => store.transition('implemented', {}), /非法状态跳转/);
  assert.throws(
    () => store.transition('contract_confirmed', { human: false }),
    /人工确认/,
  );
  store.transition('contract_confirmed', {
    human: true, reviewer: 'Product reviewer', note: '用途与映射已人工确认',
  });
  assert.throws(() => store.transition('implemented', {}), /实现证据/);
  store.transition('implemented', { evidence: 'ic-core-v1 + tracer fixture' });
  assert.throws(
    () => store.transition('live_confirmed', { human: true, reviewer: '' }),
    /人工确认/,
  );
  store.transition('live_confirmed', {
    human: true, reviewer: 'Product reviewer', note: '真实视觉与交互已人工确认',
  });
  store.transition('migration_ready', {});

  assert.equal(store.snapshot().status, 'migration_ready');
  assert.deepEqual(
    Object.keys(store.snapshot().confirmations),
    ['contract_confirmed', 'live_confirmed'],
  );
});


test('migration readiness rejects unresolved instances', () => {
  const store = createStore();
  store.transition('contract_confirmed', {
    human: true, reviewer: 'Reviewer', note: '合同确认',
  });
  store.transition('implemented', { evidence: 'tracer' });
  store.transition('live_confirmed', {
    human: true, reviewer: 'Reviewer', note: '实时确认',
  });

  assert.throws(() => store.transition('migration_ready', {}), /仍有 4 个 Legacy 实例未映射/);
});


test('import cannot bypass lifecycle evidence or migration completeness', () => {
  const store = createStore();
  const draft = store.snapshot();

  const skippedHumanGate = structuredClone(draft);
  skippedHumanGate.status = 'contract_confirmed';
  assert.throws(
    () => store.importJson(JSON.stringify(skippedHumanGate)),
    /缺少合同人工确认记录/,
  );

  const skippedMigration = structuredClone(draft);
  skippedMigration.status = 'migration_ready';
  skippedMigration.confirmations = {
    contract_confirmed: {
      reviewer: 'Reviewer', note: '合同确认', mappingRevision: 0, fingerprints: {},
    },
    live_confirmed: {
      reviewer: 'Reviewer', note: '真实运行确认', mappingRevision: 0, fingerprints: {},
    },
  };
  skippedMigration.implementation = { evidence: 'tracer', fingerprint: '' };
  assert.throws(
    () => store.importJson(JSON.stringify(skippedMigration)),
    /仍有 4 个 Legacy 实例未映射/,
  );
  assert.deepEqual(store.snapshot(), draft);
});


test('dependency or post-confirmation mapping changes make approvals explicitly stale', () => {
  const store = createStore();
  for (const instance of store.instances()) store.setMapping(instance.id, { outcome: 'remove' });
  store.transition('contract_confirmed', {
    human: true, reviewer: 'Reviewer', note: '合同确认',
  });
  store.setMapping(store.instances()[0].id, { outcome: 'target-component', reference: 'ic-button' });
  assert.equal(store.assessment().stale, true);
  assert.ok(store.assessment().reasons.some((reason) => reason.includes('Migration Map')));

  const exported = store.exportJson();
  const changedManifest = surfaceManifest();
  changedManifest.fingerprints.contract = 'sha256:contract-2';
  const changed = createStore({ surfaceManifest: changedManifest });
  changed.importJson(exported);
  assert.equal(changed.assessment().stale, true);
  assert.ok(changed.assessment().reasons.some((reason) => reason.includes('合同')));
  assert.throws(() => changed.transition('implemented', { evidence: 'tracer' }), /stale/);
});


test('a changed semantic baseline explicitly invalidates prior human confirmation', () => {
  const store = createStore();
  for (const instance of store.instances()) store.setMapping(instance.id, { outcome: 'remove' });
  store.transition('contract_confirmed', {
    human: true, reviewer: 'Reviewer', note: '语义分类与组件边界已确认',
  });

  const changedManifest = surfaceManifest();
  changedManifest.fingerprints.semanticBaseline = 'sha256:semantic-2';
  const changed = createStore({ surfaceManifest: changedManifest });
  changed.importJson(store.exportJson());

  assert.equal(changed.assessment().stale, true);
  assert.ok(changed.assessment().reasons.some((reason) => reason.includes('语义分类')));
});


test('export and import are deterministic, lossless and atomic', () => {
  const first = createStore();
  const mappings = [
    { outcome: 'target-component', reference: 'ic-input' },
    { outcome: 'page-module', reference: '设置/模型模块' },
    { outcome: 'business-exception', reference: 'Canvas 领域手势' },
    { outcome: 'remove' },
  ];
  first.instances().forEach((instance, index) => first.setMapping(instance.id, mappings[index]));
  const exported = first.exportJson();

  const second = createStore();
  second.importJson(exported);
  assert.equal(second.exportJson(), exported);
  assert.equal(first.exportJson(), first.exportJson());

  const before = second.snapshot();
  const invalid = JSON.parse(exported);
  invalid.mappings[second.instances()[0].id] = { outcome: 'unknown' };
  assert.throws(() => second.importJson(JSON.stringify(invalid)), /未知迁移结果/);
  assert.deepEqual(second.snapshot(), before);
});
