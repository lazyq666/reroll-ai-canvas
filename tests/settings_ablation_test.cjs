// Run isolated counterfactuals without editing the working tree or stored settings.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const variants = [
  { name: 'simplified model page', test: 'available_model_management_sync_test.cjs' },
  { name: 'simplified backup dialog', test: 'api_settings_backup_state_test.cjs' },
  {
    name: 'remove page-change notification', test: 'available_model_management_sync_test.cjs',
    file: 'available-model-management.js',
    before: "if (event.origin === window.location.origin) receiveModelChange(event);",
    after: '', failure: 'removed API model must disappear',
  },
  {
    name: 'remove unsaved-edit protection', test: 'available_model_management_sync_test.cjs',
    file: 'available-model-management.js',
    before: 'const hasPendingEdits = () => state.inFlight || state.dirtyNames.size || state.orderDirty || state.visibilityDirty;',
    after: 'const hasPendingEdits = () => false;', failure: 'external refresh waits for unsaved edits',
  },
  {
    name: 'remove dialog closing wait', test: 'api_settings_backup_state_test.cjs',
    file: 'available-model-management.js',
    before: "await dialog.hide(value === null ? 'cancel' : 'submit');",
    after: "dialog.hide(value === null ? 'cancel' : 'submit');", failure: 'true !== false',
  },
];

for (const variant of variants) {
  const child = spawnSync(process.execPath, ['-e', `
    const fs = require('node:fs');
    const path = require('node:path');
    const variant = JSON.parse(process.argv[1]);
    const originalRead = fs.readFileSync;
    let changed = false;
    fs.readFileSync = function(file, ...args) {
      const source = originalRead.call(this, file, ...args);
      if (!variant.file || path.resolve(String(file)) !== path.resolve('static/js', variant.file)) return source;
      if (!source.includes(variant.before)) throw new Error('Ablation target no longer exists');
      changed = true;
      return source.replace(variant.before, variant.after);
    };
    process.on('exit', () => {
      if (variant.file && !changed) throw new Error('Ablation was not exercised');
    });
    require(path.resolve('tests', variant.test));
  `, JSON.stringify(variant)], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 15000 });
  assert.ifError(child.error);
  const output = child.stdout + child.stderr;
  if (variant.failure) {
    assert.notEqual(child.status, 0, `${variant.name}: expected regression did not occur`);
    assert.ok(output.includes(variant.failure), `${variant.name}: unexpected failure:\n${output}`);
    console.log(`KEEP: ${variant.name} breaks acceptance as expected`);
  } else {
    assert.equal(child.status, 0, output);
    console.log(`PASS: ${variant.name}`);
  }
}
