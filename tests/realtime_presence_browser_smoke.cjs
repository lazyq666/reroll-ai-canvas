const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PRESENCE_PREVIEW_PORT || 8799);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const evidenceDir = process.env.PRESENCE_SCREENSHOT_DIR || '';

const canvas = {
  id: 'presence-browser-smoke', title: 'Presence Browser Smoke', kind: 'smart',
  project: 'default', revision: 0, updated_at: 1,
  nodes: [], connections: [], settings: {}, logs: [],
};

function apiPayload(url) {
  const pathname = new URL(url).pathname;
  if (pathname === '/api/auth/me') {
    return { user: { id: 'account-self', username: 'self', display_name: 'Self User', role: 'admin', avatar_color_slot: 1 } };
  }
  if (pathname === '/api/config') return { api_providers: [], available_models: {}, comfy_instances: [] };
  if (pathname === '/api/workflows') return { workflows: [] };
  if (pathname === '/api/prompt-libraries') return { library: { libraries: [] } };
  if (pathname === '/api/smart-canvas/prompt-templates') return { templates: [] };
  if (pathname.endsWith('/view-state')) return { view_state: null };
  if (pathname === `/api/canvases/${canvas.id}`) return { canvas };
  return {};
}

function member(index, overrides = {}) {
  return {
    participant_id: `participant-${index}`,
    username: `user-${index}`,
    display_name: index === 2 ? 'A Very Long Collaborator Display Name' : `Member ${index}`,
    avatar_color_slot: index,
    pointer_color_slot: index,
    cursor: null,
    cursor_version: 0,
    ...overrides,
  };
}

const members = [
  member(1, { participant_id: 'participant-self', display_name: 'Self User' }),
  ...Array.from({ length: 6 }, (_, index) => member(index + 2)),
];

const server = http.createServer((request, response) => {
  const requestPath = new URL(request.url, ORIGIN).pathname;
  const normalized = requestPath === '/' ? '/static/smart-canvas.html' : requestPath;
  const file = path.resolve(ROOT, `.${decodeURIComponent(normalized)}`);
  if (file !== ROOT && !file.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(file, (error, body) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
      return;
    }
    const contentType = {
      '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
      '.woff2': 'font/woff2', '.ttf': 'font/ttf',
    }[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    response.end(body);
  });
});

async function installPage(context, { reducedMotion = false, theme = 'light' } = {}) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(({ snapshot, selectedTheme }) => {
    localStorage.setItem('studio_theme', selectedTheme);
    window.__presenceSockets = [];
    class PresenceWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor() {
        this.readyState = PresenceWebSocket.CONNECTING;
        this.sent = [];
        window.__presenceSockets.push(this);
        setTimeout(() => {
          this.readyState = PresenceWebSocket.OPEN;
          this.onopen?.({});
          this.serverSend({ type: 'canvas_snapshot', revision: 0, canvas: snapshot.canvas });
          this.serverSend(snapshot.presence);
        }, 25);
      }

      send(raw) { this.sent.push(JSON.parse(raw)); }
      serverSend(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
      close(code = 1000) {
        this.readyState = PresenceWebSocket.CLOSED;
        this.onclose?.({ code });
      }
    }
    window.WebSocket = PresenceWebSocket;
  }, {
    snapshot: {
      canvas,
      presence: {
        type: 'presence_snapshot', protocol_version: 1, membership_version: 7,
        update_interval_ms: 100, self_participant_id: 'participant-self', members,
      },
    },
    selectedTheme: theme,
  });
  await page.route('**/api/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(apiPayload(route.request().url())),
  }));
  await page.goto(`${ORIGIN}/static/smart-canvas.html?id=${canvas.id}`, {
    waitUntil: 'domcontentloaded', timeout: 15000,
  });
  await page.waitForFunction(() => (
    window.SmartCanvasModules?.canvasPersistence?.status().state === 'ready'
    && window.SmartCanvasModules?.realtimePresence?.state().enabled
    && document.querySelectorAll('#presenceMembers .presence-avatar-button').length === 5
  ), null, { timeout: 15000 });
  assert.deepEqual(errors, []);
  return { page, errors };
}

async function sentPresence(page) {
  return page.evaluate(() => window.__presenceSockets[0].sent.filter(message => message.type.startsWith('presence_')));
}

async function collaboratorContrastRatios(page) {
  return page.evaluate(() => {
    const luminance = value => {
      const channels = value.match(/[\d.]+/g).slice(0, 3).map(channel => {
        const normalized = Number(channel) / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const ratio = (foreground, background) => {
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return (light + 0.05) / (dark + 0.05);
    };
    return Array.from({ length: 10 }, (_, index) => {
      const slot = index + 1;
      const avatar = document.createElement('span');
      avatar.className = 'ic-account-avatar';
      avatar.dataset.avatarColorSlot = String(slot);
      avatar.textContent = 'A';
      const pointer = document.createElement('span');
      pointer.className = 'realtime-pointer-label';
      pointer.dataset.pointerColorSlot = String(slot);
      pointer.style.opacity = '1';
      pointer.textContent = 'Member';
      document.body.append(avatar, pointer);
      const avatarStyle = getComputedStyle(avatar);
      const pointerStyle = getComputedStyle(pointer);
      const result = {
        slot,
        avatar: ratio(avatarStyle.color, avatarStyle.backgroundColor),
        pointer: ratio(pointerStyle.color, pointerStyle.backgroundColor),
      };
      avatar.remove();
      pointer.remove();
      return result;
    });
  });
}

(async () => {
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors } = await installPage(context);

    const group = await page.locator('#presenceMembers').evaluate(host => {
      const rect = host.getBoundingClientRect();
      const overlay = document.getElementById('presencePointerOverlay');
      const buttons = [...host.querySelectorAll('.presence-avatar-button')];
      const shadowProbe = document.createElement('span');
      shadowProbe.style.boxShadow = '0 0 0 1px var(--ui-color-border-secondary)';
      host.append(shadowProbe);
      const expectedAvatarShadow = getComputedStyle(shadowProbe).boxShadow;
      shadowProbe.remove();
      return {
        top: Math.round(rect.top), right: Math.round(innerWidth - rect.right),
        avatarSizes: buttons.map(button => Math.round(button.getBoundingClientRect().width)),
        avatarShadows: buttons.map(button => getComputedStyle(button.querySelector('.ic-account-avatar')).boxShadow),
        expectedAvatarShadow,
        directNames: buttons.map(button => button.getAttribute('aria-label')),
        ownIsRightmost: buttons.at(-1)?.getAttribute('aria-label').includes('Self User'),
        overflow: host.querySelector('.presence-overflow-button')?.textContent,
        hostZ: Number(getComputedStyle(host).zIndex),
        overlayZ: Number(getComputedStyle(overlay).zIndex),
        invalidTokens: buttons.filter(button => {
          const avatar = button.querySelector('.ic-account-avatar');
          const style = getComputedStyle(avatar);
          return style.backgroundColor === 'rgba(0, 0, 0, 0)' || !style.color;
        }).length,
      };
    });
    assert.equal(group.top, 22);
    assert.equal(group.right, 22);
    assert.deepEqual(group.avatarSizes, [28, 28, 28, 28, 28]);
    assert.deepEqual(group.avatarShadows, Array(5).fill(group.expectedAvatarShadow));
    assert.equal(group.ownIsRightmost, true);
    assert.equal(group.overflow, '+2');
    assert.ok(group.hostZ > group.overlayZ);
    assert.equal(group.invalidTokens, 0);
    (await collaboratorContrastRatios(page)).forEach(item => {
      assert.ok(item.pointer >= 4.5, `light pointer slot ${item.slot} contrast ${item.pointer}`);
    });

    await page.evaluate(() => {
      viewport.x = 80;
      viewport.y = 40;
      viewport.scale = 2;
      window.SmartCanvasModules.viewportSelection.viewport.apply({ persist: false });
      window.__presenceSockets[0].serverSend({
        type: 'presence_batch', protocol_version: 1,
        updates: [{ participant_id: 'participant-2', cursor_version: 1, cursor: { x: 100, y: 50 } }],
      });
    });
    await page.waitForFunction(() => document.querySelector('.realtime-pointer')?.dataset.projectedX === '280');
    const projected = await page.locator('.realtime-pointer').evaluate(pointer => ({
      x: Number(pointer.dataset.projectedX), y: Number(pointer.dataset.projectedY),
      hidden: pointer.hidden, duration: pointer.style.transitionDuration,
      labelVisible: pointer.classList.contains('is-label-visible'),
    }));
    assert.deepEqual(projected, { x: 280, y: 140, hidden: false, duration: '0ms', labelVisible: true });
    await page.waitForTimeout(1600);
    assert.equal(await page.locator('.realtime-pointer').evaluate(pointer => pointer.classList.contains('is-label-visible')), false);

    await page.evaluate(() => window.__presenceSockets[0].serverSend({
      type: 'presence_batch', protocol_version: 1,
      updates: [{ participant_id: 'participant-2', cursor_version: 2, cursor: { x: 10000, y: 10000 } }],
    }));
    assert.equal(await page.locator('.realtime-pointer').evaluate(pointer => pointer.hidden), true);

    const shell = await page.locator('#shell').boundingBox();
    await page.mouse.move(shell.x + 300, shell.y + 300);
    await page.waitForTimeout(25);
    const afterFirst = await sentPresence(page);
    const firstPointerMessages = afterFirst.filter(message => message.type === 'presence_update');
    assert.equal(firstPointerMessages.length, 1);
    assert.notEqual(firstPointerMessages[0].cursor, null);
    await page.mouse.move(shell.x + 302, shell.y + 302);
    await page.waitForTimeout(125);
    assert.equal((await sentPresence(page)).filter(message => message.type === 'presence_update').length, 1);
    await page.mouse.move(shell.x + 306, shell.y + 306);
    await page.waitForTimeout(125);
    assert.equal((await sentPresence(page)).filter(message => message.type === 'presence_update').length, 2);
    const back = await page.locator('.smart-back').boundingBox();
    await page.mouse.move(back.x + back.width / 2, back.y + back.height / 2);
    await page.waitForTimeout(25);
    const memberGroup = await page.locator('#presenceMembers').boundingBox();
    await page.mouse.move(memberGroup.x + memberGroup.width / 2, memberGroup.y + memberGroup.height / 2);
    const beforePause = (await sentPresence(page)).filter(message => message.type === 'presence_update');
    assert.equal(beforePause.length, 2);
    assert.notEqual(beforePause.at(-1).cursor, null);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      document.getElementById('shell').dispatchEvent(new PointerEvent('pointerleave'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.deepEqual((await sentPresence(page)).filter(message => message.type === 'presence_update'), beforePause);
    await page.evaluate(() => {
      delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.evaluate(() => window.__presenceSockets[0].serverSend({
      type: 'presence_join', protocol_version: 1, membership_version: 9,
      member: { participant_id: 'participant-gap', display_name: 'Gap', username: 'gap', avatar_color_slot: 1, pointer_color_slot: 1, cursor: null, cursor_version: 0 },
    }));
    const afterGap = await sentPresence(page);
    assert.equal(afterGap.at(-1).type, 'presence_resync');
    assert.equal(await page.evaluate(() => window.SmartCanvasModules.realtimePresence.state().memberCount), 7);

    if (evidenceDir) {
      fs.mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({ path: path.join(evidenceDir, 'presence-light.png') });
    }
    assert.deepEqual(errors, []);
    await context.close();

    const reducedContext = await browser.newContext({ viewport: { width: 920, height: 700 } });
    const reduced = await installPage(reducedContext, { reducedMotion: true, theme: 'dark' });
    await reduced.page.evaluate(() => window.__presenceSockets[0].serverSend({
      type: 'presence_batch', protocol_version: 1,
      updates: [{ participant_id: 'participant-2', cursor_version: 1, cursor: { x: 200, y: 200 } }],
    }));
    await reduced.page.waitForFunction(() => document.querySelector('.realtime-pointer'));
    await reduced.page.waitForTimeout(25);
    const reducedPointer = await reduced.page.locator('.realtime-pointer').evaluate(pointer => ({
      duration: pointer.style.transitionDuration,
      labelVisible: pointer.classList.contains('is-label-visible'),
      color: getComputedStyle(pointer).getPropertyValue('--ic-presence-pointer').trim(),
    }));
    assert.equal(reducedPointer.duration, '0ms');
    assert.equal(reducedPointer.labelVisible, false);
    assert.notEqual(reducedPointer.color, '');
    (await collaboratorContrastRatios(reduced.page)).forEach(item => {
      assert.ok(item.avatar >= 4.5, `dark avatar slot ${item.slot} contrast ${item.avatar}`);
      assert.ok(item.pointer >= 4.5, `dark pointer slot ${item.slot} contrast ${item.pointer}`);
    });
    if (evidenceDir) await reduced.page.screenshot({ path: path.join(evidenceDir, 'presence-dark-reduced.png') });
    assert.deepEqual(reduced.errors, []);
    await reducedContext.close();
    process.stdout.write('Realtime Presence browser smoke passed\n');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  server.close(() => process.exit(1));
});
