const assert = require('node:assert/strict');
const stateTools = require('../static/js/available-model-management-state.js');

const rowObjects = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']
  .map(id => ({ id, visible: true }));
const models = { image: [...rowObjects], video: [], text: [] };

for (const modelId of ['first', 'second', 'third', 'fourth', 'fifth']) {
  stateTools.setModelVisibility(models, 'image', modelId, false);
  stateTools.applySavedModelsInPlace(models, {
    image: models.image.map(model => ({ ...model })),
    video: [],
    text: [],
  });
}

rowObjects.forEach((row, index) => {
  assert.equal(models.image[index], row, 'server responses must not replace live row objects');
});

assert.deepEqual(
  models.image.filter(model => model.visible !== false).map(model => model.id),
  ['sixth'],
  'five sequential checkbox edits must all reach current state',
);
