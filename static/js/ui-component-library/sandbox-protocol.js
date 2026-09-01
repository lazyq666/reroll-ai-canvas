(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UiComponentSandboxProtocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CHANNEL = 'infinite-canvas.ui-component-library.sandbox';
  const VERSION = 1;

  function message(type, payload = {}) {
    return { channel: CHANNEL, version: VERSION, type, ...payload };
  }

  function isMessage(value) {
    return Boolean(
      value
      && value.channel === CHANNEL
      && value.version === VERSION
      && typeof value.type === 'string'
      && value.type
    );
  }

  function isSafeSandboxFlags(value) {
    const flags = String(value || '').trim().split(/\s+/).filter(Boolean);
    return flags.length === 1 && flags[0] === 'allow-scripts';
  }

  function demoResponse() {
    const payload = { demoData: true, sandboxed: true };
    return {
      ok: true,
      status: 200,
      statusText: 'Sandboxed demo response',
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ ...payload }),
      text: async () => JSON.stringify(payload),
      clone: demoResponse,
    };
  }

  function installSandboxBoundary(env, report = () => {}) {
    const publish = (effect, detail = {}) => report({
      type: 'sandbox-effect-blocked',
      effect,
      demoData: true,
      ...detail,
    });

    env.fetch = async function sandboxFetch(input, init = {}) {
      publish('fetch', {
        method: String(init.method || 'GET').toUpperCase(),
        target: String(input || ''),
      });
      return demoResponse();
    };

    env.XMLHttpRequest = class SandboxXMLHttpRequest {
      constructor() {
        this.readyState = 0;
        this.status = 0;
        this.statusText = '';
        this.responseText = '';
        this.response = '';
        this.onreadystatechange = null;
        this.onload = null;
        this.onerror = null;
        this._method = 'GET';
        this._url = '';
        this._listeners = new Map();
      }
      open(method, url) {
        this._method = String(method || 'GET').toUpperCase();
        this._url = String(url || '');
        this.readyState = 1;
      }
      setRequestHeader() {}
      getAllResponseHeaders() { return 'content-type: application/json\r\n'; }
      getResponseHeader(name) {
        return String(name).toLowerCase() === 'content-type' ? 'application/json' : null;
      }
      addEventListener(type, listener) { this._listeners.set(type, listener); }
      removeEventListener(type) { this._listeners.delete(type); }
      abort() { this.readyState = 0; }
      send() {
        publish('xhr', { method: this._method, target: this._url });
        this.status = 200;
        this.statusText = 'Sandboxed demo response';
        this.responseText = JSON.stringify({ demoData: true, sandboxed: true });
        this.response = this.responseText;
        this.readyState = 4;
        if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
        if (typeof this.onload === 'function') this.onload();
        this._listeners.get('readystatechange')?.call(this);
        this._listeners.get('load')?.call(this);
      }
    };

    env.WebSocket = class SandboxWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      constructor(url, protocols) {
        this.url = String(url || '');
        this.protocol = Array.isArray(protocols) ? String(protocols[0] || '') : String(protocols || '');
        this.readyState = 1;
        this.bufferedAmount = 0;
        this.extensions = '';
        this.binaryType = 'blob';
        this._listeners = new Map();
        publish('websocket-connect', { target: this.url });
      }
      addEventListener(type, listener) { this._listeners.set(type, listener); }
      removeEventListener(type) { this._listeners.delete(type); }
      send() { publish('websocket-send', { target: this.url }); }
      close() {
        this.readyState = 3;
        this._listeners.get('close')?.call(this, { code: 1000, reason: 'sandbox reset' });
      }
    };

    if (typeof env.open === 'function') {
      env.open = function sandboxWindowOpen(target) {
        publish('navigation', { target: String(target || '') });
        return null;
      };
    }

    env.document?.addEventListener('submit', (event) => {
      event.preventDefault();
      publish('form-submit');
    }, true);

    env.document?.addEventListener('click', (event) => {
      const fileInput = event.target?.closest?.('input[type="file"]');
      if (fileInput) {
        event.preventDefault();
        publish('file-selection');
        return;
      }
      const anchor = event.target?.closest?.('a[href]');
      if (!anchor) return;
      event.preventDefault();
      const target = String(anchor.getAttribute?.('href') || '');
      publish(anchor.hasAttribute?.('download') ? 'download' : 'navigation', { target });
    }, true);

    return {
      storagePolicy: 'opaque-origin',
      parentPolicy: 'opaque-origin',
      restore() {
        // A fixture document is disposable; reset replaces the document state.
      },
    };
  }

  return {
    CHANNEL,
    VERSION,
    message,
    isMessage,
    isSafeSandboxFlags,
    installSandboxBoundary,
  };
});
