const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const flush = () => new Promise(resolve => setImmediate(resolve));
const response = (status, user = { role: 'admin', username: 'fixture' }) => ({
  ok: status === 200, status, json: async () => ({ user }),
});

function harness(fetchSession, { login = false, initialize, componentsReady } = {}) {
  const redirects = [], timers = [], elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      hidden: id === 'account-session-content', attrs: {}, handlers: {},
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
      addEventListener(k, fn) { this.handlers[k] = fn; }, focus() {},
    });
    return elements.get(id);
  }
  const window = {
    StudioI18n: { t: key => key }, addEventListener() {}, dispatchEvent() {},
    location: { replace: url => redirects.push(url) }, initializeStudioForUser: initialize,
  };
  const context = vm.createContext({
    window, document: { getElementById: element, querySelector: element,
      querySelectorAll: () => [], documentElement: element('root') },
    fetch: (url, options) => url === '/api/auth/me' ? fetchSession(options)
      : Promise.resolve({ ok: true, json: async () => ({ enabled: true, remaining: 3 }) }),
    customElements: { whenDefined: () => componentsReady || Promise.resolve() },
    console: { warn() {} },
    localStorage: { getItem: () => null }, requestAnimationFrame: fn => fn(),
    CustomEvent: class {}, AbortController,
    setTimeout: (fn, ms) => (timers.push({ fn, ms, active: true }), timers.length),
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].active = false; },
  });
  const helper = path.join(__dirname, '../static/js/account-session.js');
  if (fs.existsSync(helper)) vm.runInContext(fs.readFileSync(helper, 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,
    `../static/js/account-${login ? 'login' : 'ui'}.js`), 'utf8'), context);
  async function advance(ms) {
    const timer = timers.find(t => t.active && t.ms === ms);
    assert.ok(timer, `Expected pending ${ms}ms timer`);
    timer.active = false; timer.fn(); await flush();
  }
  async function exhaust() {
    for (let i = 0; i < 10; i++) {
      const timer = timers.find(t => t.active);
      if (!timer) return;
      await advance(timer.ms);
    }
    assert.fail('Unbounded automatic retry');
  }
  return { redirects, element, timers, advance, exhaust };
}

for (const login of [false, true]) {
  const page = login ? 'login' : 'studio';
  test(`${page}: pending session remains in loading state`, async () => {
    const h = harness(() => new Promise(() => {}), { login });
    await flush();
    assert.equal(h.element('root').attrs['data-account-session'], 'checking');
    assert.equal(h.element('account-session-content').hidden, true);
    assert.equal(h.element('account-session-loading').hidden, false);
    assert.deepEqual(h.redirects, []);
  });
  test(`${page}: valid session enters the studio without showing login`, async () => {
    const h = harness(async () => response(200), { login });
    await flush();
    assert.deepEqual(h.redirects, login ? ['/'] : []);
    assert.equal(h.element('account-session-content').hidden, login);
  });
  for (const [name, fetchSession] of [
    ['network failure', async () => { throw Error('offline'); }],
    ['server error', async () => response(503)],
    ['unknown forbidden response', async () => response(403)],
    ['invalid identity', async () => response(200, null)],
    ['invalid JSON', async () => ({ ok: true, json: async () => { throw Error('invalid JSON'); } })],
  ]) test(`${page}: ${name} offers retry without showing login`, async () => {
    let fail = true;
    const h = harness(options => fail ? fetchSession(options) : Promise.resolve(response(200)), { login });
    await flush();
    await h.exhaust();
    assert.deepEqual(h.redirects, []);
    assert.equal(h.element('account-session-error').hidden, false);
    assert.equal(h.element('account-session-content').hidden, true);
    assert.equal(h.element('root').attrs['data-account-session'], 'error');
    fail = false;
    await h.element('account-session-retry').handlers.click();
    await flush();
    assert.deepEqual(h.redirects, login ? ['/'] : []);
    assert.equal(h.element('account-session-content').hidden, login);
  });
  for (const [name, result] of [['expired', response(401)], ['guest', response(200, { role: 'guest' })]]) {
    test(`${page}: ${name} session allows only the login flow`, async () => {
      const h = harness(async () => result, { login });
      await flush();
      assert.deepEqual(h.redirects, login ? [] : ['/login']);
      assert.equal(h.element('account-session-content').hidden, !login);
    });
  }
  test(`${page}: timeout offers retry`, async () => {
    const h = harness(({ signal } = {}) => new Promise((_, reject) =>
      signal?.addEventListener('abort', () => reject(Error('aborted')))), { login });
    assert.equal(h.timers.length, 1);
    await h.exhaust();
    assert.equal(h.element('root').attrs['data-account-session'], 'error');
    assert.deepEqual(h.redirects, []);
  });
}

test('studio initialization failure is recoverable without an auth redirect', async () => {
  const h = harness(async () => response(200), { initialize: () => { throw Error('UI failed'); } });
  await flush();
  await h.exhaust();
  assert.deepEqual(h.redirects, []);
  assert.equal(h.element('account-session-error').hidden, false);
  assert.equal(h.element('account-session-message').attrs['data-i18n'], 'auth.studioLoadFailed');
});

for (const login of [false, true]) {
  test(`${login ? 'login' : 'studio'}: a transient 503 recovers automatically without displaying an error`, async () => {
    let requests = 0;
    const h = harness(async () => response(++requests === 1 ? 503 : 200), { login });
    await flush();
    assert.equal(h.element('root').attrs['data-account-session'], 'checking');
    assert.equal(h.element('account-session-error').hidden, true);
    await h.element('account-session-retry').handlers.click();
    assert.equal(requests, 1, 'No duplicate request while automatic recovery is pending');
    await h.advance(500);
    assert.equal(requests, 2);
    assert.equal(h.element('account-session-content').hidden, login);
    assert.deepEqual(h.redirects, login ? ['/'] : []);
  });
}

test('initialization retries stop after three attempts and manual retry starts a new batch', async () => {
  let calls = 0;
  const h = harness(async () => response(200), { initialize: () => { if (++calls <= 3) throw Error('UI failed'); } });
  await flush();
  await h.advance(500);
  assert.equal(h.element('root').attrs['data-account-session'], 'checking');
  await h.advance(1500);
  assert.equal(calls, 3);
  assert.equal(h.element('root').attrs['data-account-session'], 'error');
  assert.equal(h.timers.some(t => t.active), false);
  await h.element('account-session-retry').handlers.click();
  assert.equal(calls, 4);
  assert.equal(h.element('root').attrs['data-account-session'], 'ready');
});

for (const status of [401,403]) test(`HTTP ${status} does not retry automatically`, async () => {
  let requests = 0;
  const h = harness(async () => { requests++; return response(status); });
  await flush(); await h.exhaust();
  assert.equal(requests, 1);
});

test('UI initialization waits for required custom elements', async () => {
  let ready, calls = 0;
  const componentsReady = new Promise(resolve => { ready = resolve; });
  const h = harness(async () => response(200), { componentsReady, initialize: () => calls++ });
  await flush();
  assert.equal(calls, 0);
  assert.equal(h.element('root').attrs['data-account-session'], 'checking');
  ready(); await flush();
  assert.equal(calls, 1);
  assert.equal(h.element('root').attrs['data-account-session'], 'ready');
});

test('missing UI module times out without a late initialization after failure', async () => {
  let ready, calls = 0;
  const componentsReady = new Promise(resolve => { ready = resolve; });
  const h = harness(async () => response(200), { componentsReady, initialize: () => calls++ });
  await flush(); await h.exhaust();
  assert.equal(h.element('root').attrs['data-account-session'], 'error');
  ready(); await flush();
  assert.equal(calls, 0);
  await h.element('account-session-retry').handlers.click();
  assert.equal(calls, 1);
});
