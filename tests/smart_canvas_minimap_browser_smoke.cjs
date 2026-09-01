const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8794';
const browserExecutable = process.env.SMART_CANVAS_BROWSER
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotDir = process.env.SMART_MINIMAP_SCREENSHOT_DIR || '/tmp';

async function inspectMinimap(page) {
  return page.locator('ic-smart-minimap').evaluate(minimap => {
    const root = minimap.shadowRoot;
    const pathKinds = [...root.querySelectorAll('path[data-minimap-kind]')]
      .filter(path => path.getAttribute('d'))
      .map(path => `${path.dataset.minimapKind}:${path.dataset.frameColor || ''}`);
    const hole = root.querySelector('.smart-minimap-mask-hole');
    const outsideMask = root.querySelector('.smart-minimap-outside-mask');
    const content = root.querySelector('.smart-minimap-content');
    const viewBox = root.querySelector('svg').viewBox.baseVal;
    const styleOf = selector => {
      const element = root.querySelector(selector);
      const style = getComputedStyle(element);
      return { fill:style.fill, fillOpacity:style.fillOpacity };
    };
    const bounds = minimap.getBoundingClientRect();
    return {
      contract:minimap.dataset.icContractStatus,
      width:Math.round(bounds.width),
      height:Math.round(bounds.height),
      svgCount:root.querySelectorAll('svg').length,
      lightChildCount:minimap.children.length,
      pathKinds,
      hole:{
        x:Number(hole.getAttribute('x')),
        y:Number(hole.getAttribute('y')),
        width:Number(hole.getAttribute('width')),
        height:Number(hole.getAttribute('height')),
      },
      maskOpacity:getComputedStyle(outsideMask).opacity,
      backgroundColor:getComputedStyle(content).backgroundColor,
      viewportBorderCount:root.querySelectorAll('.smart-minimap-viewport').length,
      viewBox:{ width:viewBox.width, height:viewBox.height },
      colors:{
        group:styleOf('path[data-minimap-kind="group"]'),
        text:styleOf('path[data-minimap-kind="text"]'),
        media:styleOf('path[data-minimap-kind="media"]'),
        frame:styleOf('path[data-minimap-kind="frame"][data-frame-color="blue"]'),
        frameMember:styleOf('path[data-minimap-kind="frame-member"][data-frame-color="blue"]'),
      },
    };
  });
}

(async () => {
  const browser = await chromium.launch({ headless:true, executablePath:browserExecutable });
  const context = await browser.newContext({ viewport:{ width:1100, height:760 } });
  const page = await context.newPage();
  try {
    await page.goto(
      `${baseUrl}/static/design-system/infinite-canvas-ui/smart-minimap.html`,
      { waitUntil:'networkidle' },
    );
    await page.locator('ic-smart-minimap').waitFor();
    await page.waitForFunction(() => (
      document.querySelector('ic-smart-minimap')?.dataset.icContractStatus === 'ready'
    ));
    const previewBefore = await inspectMinimap(page);
    assert.equal(previewBefore.contract, 'ready');
    assert.equal(previewBefore.svgCount, 1);
    assert.equal(previewBefore.lightChildCount, 0);
    assert.equal(previewBefore.maskOpacity, '0.12');
    assert.equal(previewBefore.viewportBorderCount, 0);
    assert.ok(
      previewBefore.hole.width * previewBefore.hole.height
        / (previewBefore.viewBox.width * previewBefore.viewBox.height) >= .099,
    );
    assert.equal(previewBefore.backgroundColor, 'rgb(255, 255, 255)');
    assert.equal(previewBefore.colors.group.fill, 'rgb(212, 212, 212)');
    assert.equal(previewBefore.colors.text.fill, 'rgb(139, 236, 197)');
    assert.equal(previewBefore.colors.media.fill, 'rgb(169, 209, 253)');
    assert.equal(previewBefore.colors.frame.fill, 'rgb(33, 33, 33)');
    assert.equal(previewBefore.colors.frame.fillOpacity, '0.2');
    assert.equal(previewBefore.colors.frameMember.fill, previewBefore.colors.frame.fill);
    assert.equal(previewBefore.colors.frameMember.fillOpacity, '0.3');
    assert.ok(previewBefore.pathKinds.includes('frame:blue'));
    assert.ok(previewBefore.pathKinds.includes('frame:green'));
    assert.ok(previewBefore.pathKinds.includes('frame-member:blue'));
    assert.ok(previewBefore.pathKinds.includes('frame-member:green'));
    assert.ok(previewBefore.pathKinds.includes('group:'));
    assert.ok(previewBefore.pathKinds.includes('text:'));
    assert.ok(previewBefore.pathKinds.includes('media:'));

    const previewBox = await page.locator('ic-smart-minimap').boundingBox();
    await page.mouse.move(
      previewBox.x + previewBox.width * .78,
      previewBox.y + previewBox.height * .64,
    );
    await page.mouse.down();
    await page.mouse.move(
      previewBox.x + previewBox.width * .68,
      previewBox.y + previewBox.height * .55,
      { steps:4 },
    );
    await page.mouse.up();
    const previewAfterPointer = await inspectMinimap(page);
    assert.notDeepEqual(previewAfterPointer.hole, previewBefore.hole);
    await page.locator('ic-smart-minimap').press('ArrowRight');
    const previewAfterKeyboard = await inspectMinimap(page);
    assert.notDeepEqual(previewAfterKeyboard.hole, previewAfterPointer.hole);
    await page.screenshot({
      path:`${screenshotDir}/smart-minimap-component-preview.png`,
      fullPage:true,
    });

    await page.goto(
      `${baseUrl}/static/ui-component-library.html#smart-minimap`,
      { waitUntil:'domcontentloaded' },
    );
    const catalogFrame = page.frameLocator('iframe[data-smart-minimap-matrix]');
    await catalogFrame.locator('ic-smart-minimap').waitFor();
    assert.equal(
      await page.locator('iframe[data-smart-minimap-matrix]').isVisible(),
      true,
    );
    assert.equal(
      await page.locator('ic-nav-item[data-target-review="smart-minimap"]').getAttribute('current'),
      'page',
    );

    await page.setViewportSize({ width:520, height:760 });
    await page.goto(
      `${baseUrl}/static/smart-canvas.html?manual=1&fixture=issue-148-complex&id=minimap-browser-smoke`,
      { waitUntil:'domcontentloaded' },
    );
    await page.waitForFunction(() => (
      document.querySelectorAll('.image-node').length > 10
      && document.querySelector('ic-smart-minimap')?.dataset.icContractStatus === 'ready'
    ));
    await page.waitForTimeout(240);
    const productionBefore = await inspectMinimap(page);
    assert.equal(productionBefore.width, 148);
    assert.equal(productionBefore.height, 98);
    assert.ok(
      productionBefore.hole.width * productionBefore.hole.height
        / (productionBefore.viewBox.width * productionBefore.viewBox.height) >= .099,
    );
    assert.ok(productionBefore.pathKinds.some(kind => kind.startsWith('frame:')));
    assert.ok(productionBefore.pathKinds.some(kind => kind.startsWith('frame-member:')));
    assert.ok(productionBefore.pathKinds.includes('text:'));
    assert.ok(productionBefore.pathKinds.includes('media:'));

    const productionCenterBefore = await page.evaluate(() => (
      window.SmartCanvasModules.viewportSelection.viewport.center()
    ));
    const productionBox = await page.locator('ic-smart-minimap').boundingBox();
    await page.mouse.click(
      productionBox.x + productionBox.width * .22,
      productionBox.y + productionBox.height * .35,
    );
    await page.waitForTimeout(160);
    const productionCenterAfter = await page.evaluate(() => (
      window.SmartCanvasModules.viewportSelection.viewport.center()
    ));
    assert.ok(Math.hypot(
      productionCenterAfter.x - productionCenterBefore.x,
      productionCenterAfter.y - productionCenterBefore.y,
    ) > 10);
    await page.screenshot({
      path:`${screenshotDir}/smart-minimap-production-narrow.png`,
      fullPage:true,
    });

    console.log(JSON.stringify({
      preview:previewAfterKeyboard,
      production:productionBefore,
      screenshots:[
        `${screenshotDir}/smart-minimap-component-preview.png`,
        `${screenshotDir}/smart-minimap-production-narrow.png`,
      ],
    }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
