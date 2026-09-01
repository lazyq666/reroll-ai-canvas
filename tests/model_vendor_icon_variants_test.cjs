const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('static/js/model-vendor-icons.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);
const icons = context.window.ModelVendorIcons;

const genericAuto = icons.markup('unknown-model');
const genericFilled = icons.markup('unknown-model', '', '', 'filled');
const openAiFilled = icons.markup('gpt-image-2', '', '', 'filled');
const openAiOutline = icons.markup('gpt-image-2', '', '', 'outline');
const runningHubOutline = icons.markup('', 'runninghub', 'RunningHub', 'outline');

assert.match(genericAuto, /data-icon-style="outline"/);
assert.match(genericAuto, /fill="none"/);
assert.match(genericFilled, /data-icon-style="filled"/);
assert.match(genericFilled, /fill="currentColor"/);
assert.match(openAiFilled, /data-icon-style="filled"/);
assert.match(openAiFilled, /<img src="\/static\/images\/chatgpt\.svg"/);
assert.match(openAiOutline, /data-icon-style="outline"/);
assert.match(openAiOutline, /<feMorphology/);
assert.match(openAiOutline, /<image href="\/static\/images\/chatgpt\.svg"/);
assert.match(runningHubOutline, /preserveAspectRatio="xMinYMid slice"/);
