const assert = require('node:assert/strict');
const test = require('node:test');

const decisions = require('../static/js/ui-component-library/decision-store.js');


const REQUIRED_STATES = [
  'light', 'dark', 'default', 'hover', 'pressed', 'focus-visible', 'disabled', 'loading',
];


function manifest() {
  const contract = {
    componentType: 'button',
    semanticTarget: 'primary',
    sizes: ['large', 'normal', 'small'],
    componentStates: ['light', 'dark'],
    interactionStates: ['default', 'hover', 'pressed', 'focus-visible', 'disabled', 'loading'],
    contentForms: ['icon-stacked', 'icon-inline', 'text-only', 'icon-only'],
  };
  return {
    schemaVersion: 7,
    sourceRevision: 'revision-1',
    targets: {
      'button.primary': { id: 'button.primary', label: '主要按钮', contract },
    },
    candidates: [
      {
        id: 'run-button',
        targetId: 'button.primary',
        size: 'normal',
        contentForm: 'icon-inline',
        trust: 'verified-live',
        sourceHash: 'sha256:run',
        coverage: {
          componentStates: ['light', 'dark'],
          interactionStates: ['default', 'hover', 'disabled', 'loading'],
        },
      },
      {
        id: 'state-reference',
        targetId: 'button.primary',
        size: 'normal',
        contentForm: 'icon-inline',
        trust: 'verified-live',
        sourceHash: 'sha256:reference',
        coverage: {
          componentStates: ['light', 'dark'],
          interactionStates: ['default', 'pressed', 'focus-visible'],
        },
      },
      {
        id: 'inventory-only',
        targetId: 'button.primary',
        size: 'normal',
        contentForm: 'icon-inline',
        trust: 'inventory-only',
        sourceHash: 'sha256:inventory',
        coverage: {
          componentStates: ['light', 'dark'],
          interactionStates: ['default'],
        },
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
    removeItem(key) { values.delete(key); },
  };
}


function completeRequirement(contentForm, size) {
  return {
    kind: 'derived-requirement',
    requirementStatus: 'confirmed',
    componentType: 'button',
    semanticTarget: 'primary',
    dimension: { contentForm, size },
    basedOnCandidateId: 'run-button',
    preserveFeatures: '保留字重、圆角和反馈节奏',
    requiredStates: [...REQUIRED_STATES],
    requirements: `派生 ${size} 尺寸，并逐项截图和键盘核验。`,
  };
}


test('new draft exposes the four button layouts in L, M and S', () => {
  const draft = decisions.createDraft(manifest(), () => '2026-08-04T00:00:00.000Z');
  const target = draft.targets['button.primary'];

  assert.deepEqual(Object.keys(target.slots), [
    'icon-stacked.large', 'icon-stacked.normal', 'icon-stacked.small',
    'icon-inline.large', 'icon-inline.normal', 'icon-inline.small',
    'text-only.large', 'text-only.normal', 'text-only.small',
    'icon-only.large', 'icon-only.normal', 'icon-only.small',
  ]);
  assert.ok(Object.values(target.slots).every((slot) => slot.kind === 'empty'));
  assert.equal(draft.schemaVersion, 7);
  assert.equal(draft.status, 'draft');
});


test('source baseline rejects unverified candidates and reports state gaps', () => {
  const model = manifest();
  assert.throws(
    () => decisions.sourceBaseline(model, 'inventory-only'),
    /verified-live/,
  );

  const slot = decisions.sourceBaseline(model, 'run-button');
  const result = decisions.validateSlot(
    model,
    model.targets['button.primary'],
    'icon-inline.normal',
    slot,
  );

  assert.equal(slot.sourceHash, 'sha256:run');
  assert.deepEqual(result.missingStates, ['pressed', 'focus-visible']);
  assert.equal(result.valid, false);
});


test('state supplementation covers gaps without replacing the main baseline', () => {
  const model = manifest();
  const slot = decisions.sourceBaseline(model, 'run-button');
  const supplemented = decisions.setStateReference(
    model,
    slot,
    ['pressed', 'focus-visible'],
    'state-reference',
  );
  const result = decisions.validateSlot(
    model,
    model.targets['button.primary'],
    'icon-inline.normal',
    supplemented,
  );

  assert.equal(supplemented.candidateId, 'run-button');
  assert.equal(supplemented.stateReferences.pressed.candidateId, 'state-reference');
  assert.equal(supplemented.stateReferences['focus-visible'].sourceHash, 'sha256:reference');
  assert.deepEqual(result.missingStates, []);
  assert.equal(result.valid, true);
});


test('a Normal baseline cannot satisfy a Small or Large slot', () => {
  const model = manifest();
  const slot = decisions.sourceBaseline(model, 'run-button');
  const result = decisions.validateSlot(
    model,
    model.targets['button.primary'],
    'icon-inline.small',
    slot,
  );

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('尺寸')));
});


test('derived requirement cannot complete until all auditable fields are present', () => {
  const model = manifest();
  const incomplete = {
    ...completeRequirement('icon-inline', 'small'),
    preserveFeatures: '',
  };
  const incompleteResult = decisions.validateSlot(
    model,
    model.targets['button.primary'],
    'icon-inline.small',
    incomplete,
  );
  const completeResult = decisions.validateSlot(
    model,
    model.targets['button.primary'],
    'icon-inline.small',
    completeRequirement('icon-inline', 'small'),
  );

  assert.equal(incompleteResult.valid, false);
  assert.ok(incompleteResult.errors.some((error) => error.includes('保留')));
  assert.equal(completeResult.valid, true);
});


test('store persists only schema seven and invalid import is atomic', () => {
  const storage = memoryStorage();
  const clock = () => '2026-08-04T00:00:00.000Z';
  const store = decisions.createStore({ manifest: manifest(), storage, clock });
  const before = store.snapshot();
  store.setSlot('button.primary', 'icon-inline.small', completeRequirement('icon-inline', 'small'));
  store.save();

  assert.ok(storage.values.has(decisions.STORAGE_KEY));
  assert.equal(storage.values.has('componentWorkbenchDraftV5'), false);
  const saved = store.snapshot();

  assert.throws(
    () => store.importJson(JSON.stringify({ schemaVersion: 6, targets: {} })),
    /Schema 7/,
  );
  assert.deepEqual(store.snapshot(), saved);
  assert.notDeepEqual(store.snapshot(), before);
});


test('draft JSON round-trips losslessly and keeps incomplete work explicit', () => {
  const clock = () => '2026-08-04T00:00:00.000Z';
  const first = decisions.createStore({ manifest: manifest(), storage: memoryStorage(), clock });
  first.setSlot('button.primary', 'icon-inline.small', {
    ...completeRequirement('icon-inline', 'small'),
    requirementStatus: 'draft',
  });
  const exported = first.exportDraft();

  const second = decisions.createStore({ manifest: manifest(), storage: memoryStorage(), clock });
  second.importJson(exported);

  assert.equal(JSON.parse(exported).status, 'draft');
  assert.equal(second.exportDraft(), exported);
});


test('formal export rejects empty slots and lists confirmed derived work', () => {
  const clock = () => '2026-08-04T00:00:00.000Z';
  const store = decisions.createStore({ manifest: manifest(), storage: memoryStorage(), clock });
  assert.throws(() => store.exportFormal(), /large.*normal.*small/i);

  for (const contentForm of ['icon-stacked', 'icon-inline', 'text-only', 'icon-only']) {
    for (const size of ['large', 'normal', 'small']) {
      store.setSlot(
        'button.primary',
        `${contentForm}.${size}`,
        completeRequirement(contentForm, size),
      );
    }
  }
  const formal = JSON.parse(store.exportFormal());

  assert.equal(formal.status, 'formal');
  assert.equal(formal.implementationItems.length, 12);
  assert.deepEqual(
    formal.implementationItems.map((item) => item.dimensionId),
    [
      'icon-stacked.large', 'icon-stacked.normal', 'icon-stacked.small',
      'icon-inline.large', 'icon-inline.normal', 'icon-inline.small',
      'text-only.large', 'text-only.normal', 'text-only.small',
      'icon-only.large', 'icon-only.normal', 'icon-only.small',
    ],
  );
});
