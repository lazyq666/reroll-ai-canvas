const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function completePsd() {
  const bytes = Buffer.alloc(44);
  bytes.write('8BPS', 0, 'ascii');
  bytes.writeUInt16BE(1, 4);
  bytes.writeUInt16BE(4, 12);
  bytes.writeUInt32BE(1, 14);
  bytes.writeUInt32BE(1, 18);
  bytes.writeUInt16BE(8, 22);
  bytes.writeUInt16BE(3, 24);
  // Empty color mode, image resources, and layer/mask sections.
  bytes.writeUInt32BE(0, 26);
  bytes.writeUInt32BE(0, 30);
  bytes.writeUInt32BE(0, 34);
  // Raw composite data: compression plus one byte for each RGBA channel.
  bytes.writeUInt16BE(0, 38);
  bytes.set([10, 20, 30, 255], 40);
  return bytes;
}

function response({ok=true, body=completePsd(), disposition="attachment; filename*=UTF-8''%E8%A7%92%E8%89%B2.psd"}={}) {
  const blob = new Blob([body], {type:ok ? 'image/vnd.adobe.photoshop' : 'application/json'});
  return {
    ok,
    headers:{
      get(name) {
        if (String(name).toLowerCase() === 'content-type') return blob.type;
        if (String(name).toLowerCase() === 'content-disposition') return disposition;
        return '';
      },
    },
    blob:async () => blob,
  };
}

function loadModule() {
  const clicks = [];
  const revoked = [];
  const button = {
    disabled:false,
    toggleAttribute(name, active) { this[name] = active; },
  };
  const root = {
    Blob,
    SmartCanvasModules:{},
    URL:{
      createObjectURL:() => 'blob:issue-36',
      revokeObjectURL:url => revoked.push(url),
    },
    document:{
      body:{append() {}},
      getElementById() { throw new Error('PSD export must not look up page-specific controls'); },
      createElement() {
        return {
          hidden:false,
          href:'',
          download:'',
          click() { clicks.push({href:this.href, download:this.download}); },
          remove() {},
        };
      },
    },
    setTimeout:callback => callback(),
  };
  root.window = root;
  vm.runInNewContext(
    fs.readFileSync(path.join(ROOT, 'static/js/smart-canvas/layered-psd.js'), 'utf8'),
    root,
    {filename:'layered-psd.js'},
  );
  return {root, button, clicks, revoked, api:root.SmartCanvasModules.layeredPsd};
}

(async () => {
  const success = loadModule();
  const events = [];
  success.root.SmartCanvasModules.canvasPersistence = {
    checkpoint:async () => events.push('checkpoint'),
  };
  success.root.fetch = async (url, options) => {
    events.push('fetch');
    assert.equal(url, '/api/canvases/canvas%20%2F%2036/layer-decompositions/layers%20%2F%2036/psd');
    assert.equal(options.method, 'POST');
    return response();
  };
  success.root.toast = (message, options) => events.push(`toast:${options?.tone || ''}:${message}`);
  success.root.tr = key => ({
    'smart.layerPsdDownloadFailed':'无法生成 PSD，请稍后重试',
  })[key] || key;
  const downloaded = await success.api.download({
    canvasId:'canvas / 36',
    nodeId:'layers / 36',
    button:success.button,
  });
  assert.equal(downloaded, true);
  assert.deepEqual(events, ['checkpoint', 'fetch']);
  assert.deepEqual(success.clicks, [{href:'blob:issue-36', download:'角色.psd'}]);
  assert.deepEqual(success.revoked, ['blob:issue-36']);
  assert.equal(success.button.disabled, false);
  assert.equal(success.button['aria-busy'], false);

  for (const ok of [true, false]) {
    const custom = loadModule();
    const trigger = {disabled:false, toggleAttribute(name, active) { this[name] = active; }};
    let release;
    let checkpointCount = 0;
    custom.root.SmartCanvasModules.canvasPersistence = {checkpoint:() => {
      checkpointCount++;
      return new Promise(resolve => { release = resolve; });
    }};
    custom.root.fetch = async () => response({ok});
    const pending = custom.api.download({canvasId:'toolbar-canvas', nodeId:'toolbar-node', button:trigger});
    assert.equal(trigger.disabled, true, 'Disable the clicked toolbar button');
    assert.equal(trigger['aria-busy'], true);
    assert.equal(custom.button.disabled, false, 'Do not disable a separate editor button');
    const duplicate = custom.api.download({canvasId:'toolbar-canvas', nodeId:'toolbar-node', button:trigger});
    assert.equal(checkpointCount, 1, 'Duplicate export does not start a second checkpoint');
    assert.equal(await duplicate, false, 'Coalesce exports for the same node');
    release();
    assert.equal(await pending, ok);
    assert.equal(trigger.disabled, false, 'Restore toolbar after success or failure');
    assert.equal(trigger['aria-busy'], false);
  }

  for (const failedResponse of [
    response({ok:false, body:Buffer.from('{"detail":"failed"}')}),
    response({body:Buffer.from('8BPS truncated')}),
  ]) {
    const failure = loadModule();
    const notices = [];
    failure.root.SmartCanvasModules.canvasPersistence = {checkpoint:async () => {}};
    failure.root.fetch = async () => failedResponse;
    failure.root.toast = (message, options) => notices.push({message, tone:options?.tone});
    failure.root.tr = key => key === 'smart.layerPsdDownloadFailed' ? '无法生成 PSD，请稍后重试' : key;
    const result = await failure.api.download({
      canvasId:'canvas-36',
      nodeId:'layers-36',
    });
    assert.equal(result, false);
    assert.deepEqual(failure.clicks, []);
    assert.deepEqual(notices.at(-1), {message:'无法生成 PSD，请稍后重试', tone:'danger'});
  }

  console.log('Layered PSD download contract passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
