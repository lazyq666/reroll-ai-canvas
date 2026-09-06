const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dictionary = {};
const events = {};
let language = 'zh';
let dialog;
let calls = [];
let resolveScan;
let nextResponse;
let focused = false;
class Target {
  constructor(selector) { this.selector = selector; }
  closest(selector) { return selector === this.selector ? this : null; }
}
const context = {
  Element: Target,
  Intl, Date, console,
  customElements: {whenDefined:async () => {}},
  document: {
    getElementById:() => dialog,
    createElement:() => ({
      innerHTML:'', open:false, setAttribute(){}, addEventListener(){},
      show(){this.open = true;}, hide(){this.open = false; return Promise.resolve();},
      remove(){dialog = null;},
    }),
    body:{appendChild(element){dialog = element;}},
    querySelector(selector) {
      if (!dialog?.innerHTML.includes(selector.slice(1, -1))) return null;
      let ready = false;
      return {
        isConnected:true,
        updateComplete:Promise.resolve().then(() => {ready = true;}),
        focus(){assert.ok(ready, 'wait for custom button rendering before focus'); focused = true;},
      };
    },
    addEventListener(name, handler){events[name] = handler;},
  },
  fetch:async (url, options) => {
    calls.push({url, options});
    if (!url.includes('/cleanup/')) return {ok:true, json:async () => ({active:{workspace_directory:'/temporary-workspace'}})};
    if (nextResponse) {
      const result = nextResponse;
      nextResponse = null;
      return result;
    }
    return new Promise(resolve => {resolveScan = resolve;});
  },
  StudioI18n: {
    register(values){Object.assign(dictionary, values);},
    t:key => dictionary[key]?.[language] || key,
    format:(key, values) => (dictionary[key]?.[language] || key).replace(/\{(\w+)\}/g, (_, name) => values[name]),
  },
  addEventListener(name, handler){events[name] = handler;},
};
context.window = context;
vm.createContext(context);
for (const file of ['static/js/i18n/preferences.js', 'static/js/preferences.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const click = selector => events.click({target:new Target(selector)});
const response = (data, ok = true) => ({ok, json:async () => data});

(async () => {
  await context.openPreferencesModal();
  click('[data-cleanup-scan]');
  assert.match(dialog.innerHTML, /正在检查文件引用/);
  click('[data-cleanup-scan]');
  assert.equal(calls.filter(call => call.url.includes('/cleanup/')).length, 1);
  language = 'en';
  events['studio-lang-change']();
  assert.match(dialog.innerHTML, /Checking file references/);
  resolveScan(response({scan_id:'a'.repeat(32), file_count:2, total_bytes:2048}));
  await flush();
  assert.match(dialog.innerHTML, /Unused files: 2. Space to free up: 2.0 KB/);
  assert.ok(focused);
  language = 'zh';
  events['studio-lang-change']();
  assert.match(dialog.innerHTML, /可清理 2 个文件/);
  nextResponse = response({detail:{code:'media_cleanup_expired'}}, false);
  click('[data-cleanup-confirm]');
  await flush();
  assert.equal(JSON.parse(calls.at(-1).options.body).scan_id, 'a'.repeat(32));
  assert.match(dialog.innerHTML, /扫描结果已失效/);
  assert.ok(!dialog.innerHTML.includes('data-cleanup-confirm'));
  language = 'en';
  events['studio-lang-change']();
  assert.match(dialog.innerHTML, /This scan has expired/);
  nextResponse = response({scan_id:'b'.repeat(32), file_count:1, total_bytes:1024});
  click('[data-cleanup-scan]');
  await flush();
  nextResponse = response({file_count:0, total_bytes:0, skipped_count:1, failed_count:0});
  click('[data-cleanup-confirm]');
  await flush();
  assert.match(dialog.innerHTML, /Files removed: 0. Space freed: 0 B/);
  assert.match(dialog.innerHTML, /Files kept: 1/);
  language = 'zh';
  events['studio-lang-change']();
  assert.match(dialog.innerHTML, /有 1 个文件已被使用/);
  nextResponse = response({scan_id:'c'.repeat(32), file_count:0, total_bytes:0});
  click('[data-cleanup-scan]');
  await flush();
  assert.match(dialog.innerHTML, /没有可清理的未使用文件/);
  console.log('preferences media cleanup: language changes, loading, confirmation, retry, partial result and focus passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
