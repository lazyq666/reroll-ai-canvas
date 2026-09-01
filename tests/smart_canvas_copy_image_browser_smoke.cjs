const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function copyImageFromContextMenu(page, { rejectPending, rejectResolvedWriteOnce = false }) {
  await page.evaluate(({ reject, rejectResolvedOnce }) => {
    document.querySelectorAll('ic-toast[data-ic-overlay]').forEach(toast => toast.dismiss());
    window.__copyImageClipboardRepresentations = [];
    window.__rejectPendingClipboardRepresentation = reject;
    window.__rejectResolvedClipboardWriteOnce = rejectResolvedOnce;
  }, { reject: rejectPending, rejectResolvedOnce: rejectResolvedWriteOnce });
  await page.waitForFunction(() => !document.querySelector('ic-toast[data-ic-overlay]'));

  const image = page.locator('.image-node[data-id="copy-image-node"] img');
  await image.click({ button: 'right' });
  await page.waitForFunction(() => (
    document.querySelector('#smartNodeContextMenu > ic-menu-item[value="copy-image"]')
    && document.getElementById('smartNodeContextMenu')?.hasAttribute('open')
  ));
  await page.locator('#smartNodeContextMenu > ic-menu-item[value="copy-image"]').click();
  await page.waitForFunction(() => document.querySelector('ic-toast[data-ic-overlay]'));

  return page.evaluate(async () => {
    const toast = document.querySelector('ic-toast[data-ic-overlay]');
    const clipboardItems = await navigator.clipboard.read();
    const png = clipboardItems[0]?.types.includes('image/png')
      ? await clipboardItems[0].getType('image/png')
      : null;
    return {
      secureContext: window.isSecureContext,
      clipboardWrite: typeof navigator.clipboard?.write,
      clipboardItem: typeof window.ClipboardItem,
      toast: toast?.textContent?.trim() || '',
      toastTone: toast?.getAttribute('tone') || '',
      clipboardTypes: clipboardItems[0]?.types || [],
      pngSize: png?.size || 0,
      representations: window.__copyImageClipboardRepresentations,
    };
  });
}

function assertSuccessfulCopy(result, expectedRepresentations) {
  assert.equal(result.secureContext, true);
  assert.equal(result.clipboardWrite, 'function');
  assert.equal(result.clipboardItem, 'function');
  assert.match(result.toast, /图片已复制|Image copied/);
  assert.equal(result.toastTone, 'success');
  assert.ok(result.clipboardTypes.includes('image/png'), JSON.stringify(result));
  assert.ok(result.pngSize > 0, JSON.stringify(result));
  assert.deepEqual(result.representations, expectedRepresentations);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  await page.addInitScript(() => {
    const NativeClipboardItem = window.ClipboardItem;
    const nativeClipboardWrite = navigator.clipboard.write.bind(navigator.clipboard);
    const resolvedClipboardItems = new WeakSet();
    window.__copyImageClipboardRepresentations = [];
    window.__rejectPendingClipboardRepresentation = false;
    window.__rejectResolvedClipboardWriteOnce = false;
    Object.defineProperty(navigator.clipboard, 'write', {
      configurable: true,
      value: async items => {
        if (
          window.__rejectResolvedClipboardWriteOnce
          && items.some(item => resolvedClipboardItems.has(item))
        ) {
          window.__rejectResolvedClipboardWriteOnce = false;
          throw new DOMException('The Windows clipboard is temporarily busy', 'NotAllowedError');
        }
        return nativeClipboardWrite(items);
      },
    });
    window.ClipboardItem = class WindowsClipboardItemCompatibilityProbe {
      static supports(type) {
        return NativeClipboardItem.supports?.(type) ?? type === 'image/png';
      }

      constructor(data, options) {
        const pending = Object.values(data || {}).some(value => typeof value?.then === 'function');
        window.__copyImageClipboardRepresentations.push(pending ? 'pending' : 'resolved');
        if (pending && window.__rejectPendingClipboardRepresentation) {
          throw new TypeError('Pending image representations are rejected by this compatibility probe');
        }
        const item = new NativeClipboardItem(data, options);
        if (!pending) resolvedClipboardItems.add(item);
        return item;
      }
    };
  });

  try {
    await page.goto(`${baseUrl}/static/smart-canvas.html?id=copy-image-smoke&manual=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await page.waitForFunction(() => Boolean(
      customElements.get('ic-smart-node-context-menu')
      && customElements.get('ic-toast')
      && canvas
      && Array.isArray(nodes)
    ));
    await page.evaluate(imageUrl => {
      nodes.splice(0, nodes.length, {
        id: 'copy-image-node',
        type: 'smart-image',
        x: 240,
        y: 180,
        w: 316,
        h: 240,
        title: 'Copy image smoke',
        images: [{ url: imageUrl, name: 'copy-image.png', kind: 'image' }],
      });
      canvas.connections = [];
      selectedId = 'copy-image-node';
      selectedIds = [];
      selectedImage = { nodeId: 'copy-image-node', index: 0 };
      render();
    }, pngDataUrl);
    await page.waitForFunction(() => {
      const image = document.querySelector('.image-node[data-id="copy-image-node"] img');
      return Boolean(image?.complete && image.naturalWidth > 0);
    });

    const normal = await copyImageFromContextMenu(page, { rejectPending: false });
    assertSuccessfulCopy(normal, ['pending']);
    const fallback = await copyImageFromContextMenu(page, { rejectPending: true });
    assertSuccessfulCopy(fallback, ['pending', 'resolved']);
    const busyFallback = await copyImageFromContextMenu(page, {
      rejectPending: true,
      rejectResolvedWriteOnce: true,
    });
    assertSuccessfulCopy(busyFallback, ['pending', 'resolved', 'resolved']);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ normal, fallback, busyFallback }));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
