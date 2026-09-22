const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness(response) {
  const redirects = [];
  const source = fs.readFileSync(path.join(__dirname, '../static/js/account-setup.js'), 'utf8');
  const context = {
    window: { StudioI18n: { t: key => key, format: key => key }, addEventListener() {},
      location: { replace: url => redirects.push(url) } },
    document: { getElementById: () => ({ addEventListener() {} }) },
    fetch: async () => response, AbortController, TextDecoder, clearTimeout, setTimeout,
  };
  vm.createContext(context);
  vm.runInContext(source.replace(/  Promise\.all\(\['ic-input'[\s\S]*?\.then\(boot\);/, `
    render = () => {};
    state.queue = ['apimart']; state.drafts.apimart = {key:'fixture-key'};
    window.testSetup = {connectService, request, fail, state};
  `), context);
  return { ...context.window.testSetup, redirects };
}

test('expired session during service connection redirects to login, not a provider failure', async () => {
  const h = harness({ok:false,status:401,json:async()=>({detail:'Not authenticated'})});
  await h.connectService();
  assert.deepEqual(h.redirects, ['/login']);
  assert.equal(h.state.error, '');
});

test('provider failure inside a successful stream does not log the user out', async () => {
  let read = false;
  const h = harness({ok:true,status:200,body:{getReader:()=>({read:async()=>read
    ? {done:true} : (read=true,{done:false,value:new TextEncoder().encode('{"stage":"error","code":"connection_failed"}\n')})})}});
  await h.connectService();
  assert.deepEqual(h.redirects, []);
  assert.equal(h.state.error, 'onboarding.connection_failed');
});

test('other protected setup requests retain HTTP status for login recovery', async () => {
  const h = harness({ok:false,status:401,json:async()=>({detail:'Not authenticated'})});
  try { await h.request('/api/admin/onboarding'); } catch(error) { h.fail(error); }
  assert.deepEqual(h.redirects, ['/login']);
});
