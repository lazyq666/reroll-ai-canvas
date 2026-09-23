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

function completionHarness(services, failCompletion = false) {
  const handlers = {}, requests = [], redirects = [], removed = [];
  const source = fs.readFileSync(path.join(__dirname, '../static/js/account-setup.js'), 'utf8');
  const context = {
    window: { StudioI18n: { t: key => key, format: key => key }, addEventListener() {},
      location: { assign: url => redirects.push(url), replace: url => redirects.push(url) } },
    document: { querySelectorAll: () => [], getElementById: id => ['start-creating', 'ready'].includes(id)
      ? {addEventListener: (_, handler) => { handlers[id] = handler; }} : null },
    sessionStorage: {removeItem: key => removed.push(key), getItem: () => null},
    fetch: async (url, options) => {
      requests.push({url, body: options.body && JSON.parse(options.body)});
      if(url.endsWith('/complete')) return {ok:!failCompletion, status:failCompletion?409:200,
        json:async()=>failCompletion?{detail:{code:'no_source'}}:{next_url:'/static/canvas-list.html'}};
      return {ok:true, status:200, json:async()=>url==='/api/setup/status'?{required:false}
        :url==='/api/auth/me'?{user:{id:'admin',role:'admin',username:'designer'}}
        :{pending:true,services:{},workspace:{}}};
    },
    AbortController, TextDecoder, clearTimeout, setTimeout,
  };
  vm.createContext(context);
  vm.runInContext(source.replace(/  Promise\.all\(\['ic-input'[\s\S]*?\.then\(boot\);/, `
    render = () => {}; state.step=4; state.loading=false;
    window.testSetup={state,bind};
  `), context);
  const {state,bind}=context.window.testSetup;
  state.connected=services;bind();
  return {state,handlers,requests,redirects,removed};
}

test('zero-source completion explicitly defers and duplicate clicks do not submit twice', async () => {
  const h=completionHarness({});
  await Promise.all([h.handlers['start-creating'](),h.handlers['start-creating']()]);
  assert.deepEqual(h.requests,[{url:'/api/admin/onboarding/complete',body:{intent:'defer'}}]);
  assert.deepEqual(h.redirects,['/static/canvas-list.html']);
  assert.equal(h.removed.length,1);
});

test('connected completion preserves the normal source verification intent', async () => {
  const h=completionHarness({apimart:{count:1}});
  await h.handlers['start-creating']();
  assert.equal(h.requests[0].body.intent,'connected');
  assert.deepEqual(h.redirects,['/static/canvas-list.html']);
});

test('invalidated connected service refreshes readiness without silently deferring', async () => {
  const h=completionHarness({apimart:{count:1}},true);
  await h.handlers['start-creating']();
  assert.equal(h.requests.filter(item=>item.url.endsWith('/complete')).length,1);
  assert.equal(h.requests[0].body.intent,'connected');
  assert.deepEqual(h.redirects,[]);
  assert.deepEqual(h.removed,[]);
  assert.equal(h.state.step,2);
  assert.equal(Object.keys(h.state.connected).length,0);
  assert.equal(h.state.busy,false);
});
