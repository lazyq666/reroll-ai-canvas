const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

// Reuse the audited Chrome/CDP runner while substituting only the public harness seam.
const DATASET_CONTRACT = 'data-ic-text-entry-test-status';
const sourcePath = path.join(__dirname, 'ic_core_browser_smoke.cjs');
const source = fs.readFileSync(sourcePath, 'utf8')
  .replace('/tests/ic_core_browser_harness.html', '/tests/infinite_canvas_ui_text_entry_browser_harness.html')
  .replace('dataset.icTestStatus', 'dataset.icTextEntryTestStatus');
const runner = new Module(sourcePath, module);
runner.filename = sourcePath;
runner.paths = module.paths;
runner._compile(source, sourcePath);
