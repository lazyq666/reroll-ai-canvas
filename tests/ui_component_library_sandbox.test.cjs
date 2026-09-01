const assert = require('node:assert/strict');
const test = require('node:test');

const protocol = require('../static/js/ui-component-library/sandbox-protocol.js');
const adapters = require('../static/js/ui-component-library/fixture-adapters.js');


function fakeDocument() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, handler, capture) {
      listeners.set(type, { handler, capture });
    },
  };
}


test('candidate iframe only accepts scripts and remains an opaque origin', () => {
  assert.equal(protocol.isSafeSandboxFlags('allow-scripts'), true);
  assert.equal(protocol.isSafeSandboxFlags('allow-scripts allow-same-origin'), false);
  assert.equal(protocol.isSafeSandboxFlags('allow-scripts allow-forms'), false);
  assert.equal(protocol.isSafeSandboxFlags('allow-scripts allow-downloads'), false);
  assert.equal(protocol.isSafeSandboxFlags('allow-scripts allow-top-navigation'), false);
});


test('network primitives are simulated without calling the business boundary', async () => {
  let realFetchCalls = 0;
  const reports = [];
  const document = fakeDocument();
  const env = {
    document,
    fetch: () => { realFetchCalls += 1; },
    XMLHttpRequest: class RealXHR {},
    WebSocket: class RealWebSocket {},
    setTimeout,
    clearTimeout,
  };

  const installed = protocol.installSandboxBoundary(env, (message) => reports.push(message));
  const fetchResponse = await env.fetch('/api/delete-account', { method: 'DELETE' });
  const xhr = new env.XMLHttpRequest();
  xhr.open('POST', '/api/upload');
  xhr.send('business-data');
  const socket = new env.WebSocket('ws://example.test/real-workspace');
  socket.send('business-data');

  assert.equal(realFetchCalls, 0);
  assert.equal(fetchResponse.ok, true);
  assert.deepEqual(await fetchResponse.json(), { demoData: true, sandboxed: true });
  assert.equal(xhr.status, 200);
  assert.equal(JSON.parse(xhr.responseText).demoData, true);
  assert.equal(socket.url, 'ws://example.test/real-workspace');
  assert.deepEqual(
    reports.map((item) => item.effect),
    ['fetch', 'xhr', 'websocket-connect', 'websocket-send'],
  );
  assert.equal(installed.storagePolicy, 'opaque-origin');
});


test('forms, files, downloads and navigation are prevented at the document boundary', () => {
  const reports = [];
  const document = fakeDocument();
  const env = {
    document,
    fetch: () => {},
    XMLHttpRequest: class {},
    WebSocket: class {},
    setTimeout,
    clearTimeout,
  };
  protocol.installSandboxBoundary(env, (message) => reports.push(message));

  let formPrevented = false;
  document.listeners.get('submit').handler({
    preventDefault() { formPrevented = true; },
    target: { tagName: 'FORM' },
  });

  let filePrevented = false;
  document.listeners.get('click').handler({
    preventDefault() { filePrevented = true; },
    target: { closest: (selector) => selector === 'input[type="file"]' ? {} : null },
  });

  let downloadPrevented = false;
  document.listeners.get('click').handler({
    preventDefault() { downloadPrevented = true; },
    target: {
      closest(selector) {
        if (selector === 'input[type="file"]') return null;
        if (selector === 'a[href]') return { hasAttribute: () => true, getAttribute: () => '/export' };
        return null;
      },
    },
  });

  let navigationPrevented = false;
  document.listeners.get('click').handler({
    preventDefault() { navigationPrevented = true; },
    target: {
      closest(selector) {
        if (selector === 'input[type="file"]') return null;
        if (selector === 'a[href]') return { hasAttribute: () => false, getAttribute: () => '/canvas/real' };
        return null;
      },
    },
  });

  assert.equal(formPrevented, true);
  assert.equal(filePrevented, true);
  assert.equal(downloadPrevented, true);
  assert.equal(navigationPrevented, true);
  assert.deepEqual(
    reports.map((item) => item.effect),
    ['form-submit', 'file-selection', 'download', 'navigation'],
  );
  assert.ok(reports.every((item) => item.demoData === true));
});


test('protocol accepts only versioned catalog sandbox messages', () => {
  const message = protocol.message('fixture-ready', { candidateId: 'candidate-1' });
  assert.equal(protocol.isMessage(message), true);
  assert.equal(protocol.isMessage({ type: 'fixture-ready' }), false);
  assert.equal(protocol.isMessage({ channel: message.channel, version: 99, type: 'fixture-ready' }), false);
});


test('fixture profiles expose natural interactions for every retained component family', () => {
  const expectations = {
    Button: ['click', 'focus', 'disabled'],
    Input: ['input', 'focus', 'disabled', 'readonly'],
    Textarea: ['input', 'focus', 'disabled', 'readonly'],
    Select: ['change', 'focus', 'disabled'],
    Checkbox: ['change', 'focus', 'disabled'],
    Switch: ['change', 'focus', 'disabled'],
    Slider: ['input', 'focus', 'disabled'],
    Tabs: ['click', 'focus'],
    Menu: ['open-close', 'focus'],
    Popover: ['open-close', 'focus'],
    Dialog: ['open-close', 'focus'],
    'Confirmation Dialog': ['open-close', 'focus'],
    'Loading / Progress': ['replay'],
    Toast: ['replay'],
    'File Upload': ['drop', 'file-selection-blocked', 'reset'],
    Toolbar: ['click', 'focus'],
    Card: ['click', 'focus'],
  };
  for (const [componentType, required] of Object.entries(expectations)) {
    const profile = adapters.profileFor(componentType, '');
    for (const interaction of required) {
      assert.ok(profile.naturalInteractions.includes(interaction), `${componentType} lacks ${interaction}`);
    }
    assert.ok(profile.forcedStates.includes('default'));
    assert.ok(profile.forcedStates.includes('dark'));
  }
});
