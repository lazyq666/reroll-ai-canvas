const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');


const runner = path.join(__dirname, 'actions_browser_smoke.cjs');
const result = spawnSync(process.execPath, [runner], {
  cwd: path.resolve(__dirname, '..'),
  encoding: 'utf8',
  env: process.env,
});

if (!result.stdout.trim()) {
  throw new Error(result.stderr.trim() || 'Actions browser smoke produced no report');
}

const report = JSON.parse(result.stdout);
assert.equal(
  report.checks?.disabledPalette,
  true,
  JSON.stringify({
    actions: report.visualContract?.disabledActions,
    consumers: report.visualContract?.disabledSemanticConsumers,
  }, null, 2),
);
process.stdout.write(`${JSON.stringify({ disabledPalette: true })}\n`);
