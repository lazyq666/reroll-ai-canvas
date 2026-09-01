const { chromium } = require('playwright');

const baseUrl = process.env.T21_PREVIEW_URL || 'http://127.0.0.1:8796';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function near(actual, expected, tolerance = 0.02) {
  return Math.abs(actual - expected) <= tolerance;
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem('smartCanvasPanSpeed', '1.5');
      localStorage.setItem('smartCanvasZoomSpeed', '1');
    });
    await page.goto(`${baseUrl}/canvas-list`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.ws-card');

    const result = await page.evaluate(() => {
      const board = document.getElementById('board');
      const world = document.getElementById('boardWorld');
      const matrix = () => {
        const value = new DOMMatrix(getComputedStyle(world).transform);
        return { x: value.e, y: value.f, scale: value.a };
      };
      const rect = board.getBoundingClientRect();
      const point = {
        x: rect.left + rect.width * 0.63,
        y: rect.top + rect.height * 0.41,
      };
      const emitWheel = options => board.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        ...options,
      }));

      const initial = matrix();
      emitWheel({ deltaX: 36, deltaY: 64 });
      const afterPan = matrix();
      const worldPointBeforeZoom = {
        x: (point.x - rect.left - afterPan.x) / afterPan.scale,
        y: (point.y - rect.top - afterPan.y) / afterPan.scale,
      };
      emitWheel({ deltaY: -120, ctrlKey: true });
      const afterZoom = matrix();
      const worldPointAfterZoom = {
        x: (point.x - rect.left - afterZoom.x) / afterZoom.scale,
        y: (point.y - rect.top - afterZoom.y) / afterZoom.scale,
      };
      return { initial, afterPan, afterZoom, worldPointBeforeZoom, worldPointAfterZoom };
    });

    const panIsWrong = !near(result.afterPan.scale, result.initial.scale)
      || !near(result.afterPan.x, result.initial.x - 54)
      || !near(result.afterPan.y, result.initial.y - 96);
    const zoomIsWrong = result.afterZoom.scale <= result.afterPan.scale
      || !near(result.worldPointAfterZoom.x, result.worldPointBeforeZoom.x, 0.25)
      || !near(result.worldPointAfterZoom.y, result.worldPointBeforeZoom.y, 0.25);
    if (panIsWrong || zoomIsWrong) {
      throw new Error(`Canvas List viewport gesture mismatch: ${JSON.stringify(result)}`);
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
