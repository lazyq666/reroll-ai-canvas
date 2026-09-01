const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME_TYPES = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function startServer() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(ROOT, `.${pathname}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(filePath, (error, body) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
        return;
      }
      response.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' }).end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);
  const server = await startServer();
  const browser = await chromium.launch({ headless:true, executablePath:CHROME });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport:{ width:1440, height:1000 } });
    page.on('console', message => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text());
    });
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/static/ui-component-library.html#file-media-input`, { waitUntil:'networkidle' });
    await page.waitForFunction(() => document.body.dataset.activeReview === 'file-media-input');

    const frame = page.frames().find(item => item.url().includes('file-media-input-case.html'));
    if (!frame) throw new Error('File & Media Input review frame did not load');
    await frame.waitForSelector('ic-reference-thumbnail[data-component-name="ic-reference-thumbnail-image"]');
    await frame.waitForFunction(() => customElements.get('ic-reference-thumbnail') && customElements.get('ic-thumb-hovercard'));
    await frame.waitForFunction(() => ['audio', 'text'].every(kind => {
      const icon = document.querySelector(`[data-component-name="ic-reference-thumbnail-${kind}"] ic-icon`);
      return icon?.dataset.iconStatus === 'ready';
    }));

    await page.locator('[data-target-review-search-trigger]').click();
    await page.locator('[data-target-review-search]').fill('Reference Thumbnail');
    await page.locator('[data-target-component="ic-reference-thumbnail"]').click();
    await page.waitForFunction(() => document.querySelector('[data-target-review-search-status]')?.textContent.includes('ic-reference-thumbnail'));

    const imageGeometry = await frame.locator('[data-component-name="ic-reference-thumbnail-image"]').evaluate(host => {
      const image = host.querySelector('img');
      const hostRect = host.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      const hostStyle = getComputedStyle(host);
      const imageStyle = getComputedStyle(image);
      return {
        borderWidth:parseFloat(hostStyle.borderTopWidth),
        hostRadius:parseFloat(hostStyle.borderTopLeftRadius),
        imageRadius:parseFloat(imageStyle.borderTopLeftRadius),
        inset:{
          top:imageRect.top - hostRect.top,
          right:hostRect.right - imageRect.right,
          bottom:hostRect.bottom - imageRect.bottom,
          left:imageRect.left - hostRect.left,
        },
      };
    });
    const nonVisualMedia = await frame.locator('[data-component-name="ic-reference-thumbnail-audio"], [data-component-name="ic-reference-thumbnail-text"]').evaluateAll(hosts => hosts.map(host => {
      const stage = host.querySelector('.ic-reference-thumbnail__kind');
      const label = host.querySelector('.input-thumb-label');
      const icon = stage.querySelector('ic-icon');
      const stageRect = stage.getBoundingClientRect();
      const labelRect = label.getBoundingClientRect();
      const iconRect = icon.getBoundingClientRect();
      return {
        kind:host.dataset.kind,
        iconName:icon.getAttribute('name'),
        iconStatus:icon.dataset.iconStatus,
        stageEndsAtLabel:Math.abs(stageRect.bottom - labelRect.top),
        centerDelta:{
          x:Math.abs((iconRect.left + iconRect.width / 2) - (stageRect.left + stageRect.width / 2)),
          y:Math.abs((iconRect.top + iconRect.height / 2) - (stageRect.top + stageRect.height / 2)),
        },
      };
    }));
    const textBackgroundMatchesSurface = await frame.locator('[data-component-name="ic-reference-thumbnail-text"]').evaluate(host => {
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;background:var(--ui-color-surface)';
      document.body.append(probe);
      const matches = getComputedStyle(host).backgroundColor === getComputedStyle(probe).backgroundColor;
      probe.remove();
      return matches;
    });
    await frame.evaluate(() => {
      window.__thumbHovercardMedia = { play:0, pause:0, load:0 };
      HTMLMediaElement.prototype.play = function play() {
        window.__thumbHovercardMedia.play += 1;
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function pause() { window.__thumbHovercardMedia.pause += 1; };
      HTMLMediaElement.prototype.load = function load() { window.__thumbHovercardMedia.load += 1; };
    });
    const neutralTarget = frame.locator('h2').first();
    const imageThumb = frame.locator('[data-component-name="ic-reference-thumbnail-image"]');
    await imageThumb.hover();
    const hovercardLocator = frame.locator('ic-thumb-hovercard:not([hidden])');
    await hovercardLocator.waitFor();
    const imageHovercard = await hovercardLocator.evaluate(card => {
      const rect = card.getBoundingClientRect();
      const mediaRect = card.shadowRoot.querySelector('img').getBoundingClientRect();
      const anchorRect = card._anchor.getBoundingClientRect();
      return {
        tag:card.localName,
        width:rect.width,
        height:rect.height,
        mediaWidth:mediaRect.width,
        mediaHeight:mediaRect.height,
        horizontalCenterDelta:Math.abs((rect.left + rect.width / 2) - (anchorRect.left + anchorRect.width / 2)),
        aboveAnchor:rect.bottom <= anchorRect.top,
        anchorGap:anchorRect.top - rect.bottom,
        expectedGap:card.shadowRoot.querySelector('[data-gap-probe]').getBoundingClientRect().width,
        buttonCount:card.shadowRoot.querySelectorAll('button, ic-button').length,
      };
    });
    await neutralTarget.hover();

    const videoThumb = frame.locator('[data-component-name="ic-reference-thumbnail-video"]');
    await videoThumb.evaluate(host => {
      host.setAttribute('src', 'hover-preview.mp4');
      host.setAttribute('original-src', 'hover-preview.mp4');
      host.removeAttribute('data-url');
    });
    await videoThumb.hover();
    await hovercardLocator.waitFor();
    const videoHovercard = await hovercardLocator.evaluate(card => ({
      hasVideo:Boolean(card.shadowRoot.querySelector('video[autoplay][muted][loop][playsinline]')),
      buttonCount:card.shadowRoot.querySelectorAll('button, ic-button').length,
      playCount:window.__thumbHovercardMedia.play,
    }));
    await neutralTarget.hover();
    await frame.waitForTimeout(20);
    const videoDestroyed = await frame.locator('ic-thumb-hovercard[data-kind="video"]').evaluate(card => ({
      hidden:card.hidden,
      mediaCount:card.shadowRoot.querySelectorAll('video, audio').length,
      pauseCount:window.__thumbHovercardMedia.pause,
    }));

    const audioThumb = frame.locator('[data-component-name="ic-reference-thumbnail-audio"]');
    await audioThumb.evaluate(host => host.setAttribute('src', 'hover-preview.mp3'));
    await audioThumb.hover();
    await hovercardLocator.waitFor();
    const audioHovercard = await hovercardLocator.evaluate(card => {
      const rect = card.getBoundingClientRect();
      const wave = card.shadowRoot.querySelector('.audio-wave');
      const waveRect = wave.getBoundingClientRect();
      const bars = [...wave.querySelectorAll('span')];
      const barStyles = bars.map(bar => getComputedStyle(bar));
      return {
        width:rect.width,
        height:rect.height,
        waveCenterDelta:{
          x:Math.abs((waveRect.left + waveRect.width / 2) - (rect.left + rect.width / 2)),
          y:Math.abs((waveRect.top + waveRect.height / 2) - (rect.top + rect.height / 2)),
        },
        barCount:bars.length,
        iconCount:card.shadowRoot.querySelectorAll('ic-icon').length,
        waveColor:getComputedStyle(card.shadowRoot.querySelector('.audio-preview')).color,
        waveAnimationNames:[...new Set(barStyles.map(style => style.animationName))],
        waveAnimationTimings:[...new Set(barStyles.map(style => style.animationTimingFunction))],
        waveAnimationDelays:[...new Set(barStyles.map(style => style.animationDelay))],
        hasAudio:Boolean(card.shadowRoot.querySelector('audio')),
        hasTextPreview:Boolean(card.shadowRoot.querySelector('.text-preview')),
        playCount:window.__thumbHovercardMedia.play,
      };
    });
    if (process.env.IC_AUDIO_SCREENSHOT) await page.screenshot({ path:process.env.IC_AUDIO_SCREENSHOT, fullPage:true });
    await neutralTarget.hover();
    await frame.waitForTimeout(20);
    const audioDestroyed = await frame.locator('ic-thumb-hovercard[data-kind="audio"]').evaluate(card => ({
      hidden:card.hidden,
      mediaCount:card.shadowRoot.querySelectorAll('video, audio').length,
      pauseCount:window.__thumbHovercardMedia.pause,
    }));

    const textThumb = frame.locator('[data-component-name="ic-reference-thumbnail-text"]');
    await textThumb.hover();
    await hovercardLocator.waitFor();
    const textHovercard = await hovercardLocator.evaluate(card => {
      const rect = card.getBoundingClientRect();
      const text = card.shadowRoot.querySelector('.text-preview');
      return {
        width:rect.width,
        height:rect.height,
        text:text?.textContent.trim() || '',
        overflow:getComputedStyle(text).overflow,
        buttonCount:card.shadowRoot.querySelectorAll('button, ic-button').length,
      };
    });
    if (process.env.IC_BROWSER_SCREENSHOT) await page.screenshot({ path:process.env.IC_BROWSER_SCREENSHOT, fullPage:true });
    const composerPage = await browser.newPage({ viewport:{ width:1440, height:1000 } });
    await composerPage.goto(`${origin}/static/ui-component-library.html#composer`, { waitUntil:'networkidle' });
    await composerPage.waitForFunction(() => document.body.dataset.activeReview === 'composer');
    const composerFrame = composerPage.frames().find(item => item.url().includes('/infinite-canvas-ui/composer.html'));
    if (!composerFrame) throw new Error('Composer review frame did not load');
    await composerFrame.locator('[data-composer-reference-toggle]').click();
    const composerImageThumb = composerFrame.locator('[data-component-name="ic-reference-thumbnail-image"]');
    await composerImageThumb.waitFor();
    await composerImageThumb.hover();
    const composerImageHovercard = composerFrame.locator('ic-thumb-hovercard:not([hidden])');
    await composerImageHovercard.waitFor();
    const composerImageHoverPreview = await composerImageHovercard.evaluate(card => ({
      tag:card.localName,
      kind:card.dataset.kind,
      imageCount:card.shadowRoot.querySelectorAll('img').length,
    }));
    const composerTextThumb = composerFrame.locator('ic-reference-thumbnail[kind="text"]');
    await composerTextThumb.waitFor();
    await composerTextThumb.hover();
    const composerTextHovercard = composerFrame.locator('ic-thumb-hovercard:not([hidden])');
    await composerTextHovercard.waitFor();
    const composerTextHoverPreview = await composerTextHovercard.evaluate(card => ({
      text:card.shadowRoot.querySelector('.text-preview')?.textContent.trim() || '',
      buttonCount:card.shadowRoot.querySelectorAll('button, ic-button').length,
    }));
    await composerPage.close();
    const fileReviewState = {
      activeReview:await page.locator('body').getAttribute('data-active-review'),
      title:(await page.locator('[data-target-review-title]').textContent()).trim(),
      searchStatus:(await page.locator('[data-target-review-search-status]').textContent()).trim(),
      count:await frame.locator('ic-reference-thumbnail[data-component-name]').count(),
      groupVisible:await frame.locator('[data-component-group="ic-reference-thumbnail"]').isVisible(),
      imageVisible:await frame.locator('[data-component-name="ic-reference-thumbnail-image"]').isVisible(),
    };

    await page.goto(`${origin}/static/ui-component-library.html#menu-popover`, { waitUntil:'networkidle' });
    await page.waitForFunction(() => document.body.dataset.activeReview === 'menu-popover');
    const menuPopoverFrame = page.frames().find(item => item.url().includes('/infinite-canvas-ui/menu-popover-case.html'));
    if (!menuPopoverFrame) throw new Error('Menu / Popover review frame did not load');
    await menuPopoverFrame.waitForFunction(() => document.documentElement.dataset.menuPopoverCaseStatus === 'ready');
    await menuPopoverFrame.evaluate(() => {
      window.__menuThumbHovercardMedia = { play:0, pause:0 };
      HTMLMediaElement.prototype.play = function play() {
        window.__menuThumbHovercardMedia.play += 1;
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function pause() { window.__menuThumbHovercardMedia.pause += 1; };
      HTMLMediaElement.prototype.load = function load() {};
    });
    const hovercardMenuGroups = menuPopoverFrame.locator('[data-component-group="ic-thumb-hovercard"]');
    const hovercardMenuGroupCount = await hovercardMenuGroups.count();
    const hovercardMenuGroupVisible = await hovercardMenuGroups.evaluateAll(groups => groups.every(group => getComputedStyle(group).display !== 'none'));
    const hovercardMenuKinds = await menuPopoverFrame.locator('[data-thumb-hovercard-kind]').count();
    const menuVideoTrigger = menuPopoverFrame.locator('[data-thumb-hovercard-kind="video"] .thumb-hovercard-trigger');
    await menuVideoTrigger.hover();
    const menuVideoHovercard = menuPopoverFrame.locator('ic-thumb-hovercard:not([hidden])');
    await menuVideoHovercard.waitFor();
    const menuVideoPreview = await menuVideoHovercard.evaluate(card => ({
      src:card.shadowRoot.querySelector('video')?.getAttribute('src') || '',
      playCount:window.__menuThumbHovercardMedia.play,
    }));
    await menuPopoverFrame.locator('[data-thumb-hovercard-kind="image"] h2').hover();
    await menuPopoverFrame.waitForTimeout(20);
    const menuVideoDestroyed = await menuPopoverFrame.locator('ic-thumb-hovercard[data-kind="video"]').evaluate(card => ({
      hidden:card.hidden,
      mediaCount:card.shadowRoot.querySelectorAll('video, audio').length,
      pauseCount:window.__menuThumbHovercardMedia.pause,
    }));
    if (process.env.IC_MENU_SCREENSHOT) await page.screenshot({ path:process.env.IC_MENU_SCREENSHOT, fullPage:true });

    const report = {
      ...fileReviewState,
      hoverRemove:await frame.locator('[data-component-name="ic-reference-thumbnail-hover"] .input-thumb-remove').evaluate(element => ({
        opacity:getComputedStyle(element).opacity,
        pointerEvents:getComputedStyle(element).pointerEvents,
      })),
      imageGeometry,
      nonVisualMedia,
      textBackgroundMatchesSurface,
      imageHovercard,
      videoHovercard,
      videoDestroyed,
      audioHovercard,
      audioDestroyed,
      textHovercard,
      composerImageHoverPreview,
      composerTextHoverPreview,
      hovercardMenuGroupVisible,
      hovercardMenuGroupCount,
      hovercardMenuKinds,
      menuVideoPreview,
      menuVideoDestroyed,
      errors,
    };
    if (report.activeReview !== 'file-media-input' || report.title !== '文件与媒体输入') throw new Error(JSON.stringify(report));
    if (report.count < 8 || !report.groupVisible || !report.imageVisible) throw new Error(JSON.stringify(report));
    if (report.hoverRemove.opacity !== '1' || report.hoverRemove.pointerEvents !== 'auto') throw new Error(JSON.stringify(report));
    const radiusFits = Math.abs(report.imageGeometry.imageRadius + report.imageGeometry.borderWidth - report.imageGeometry.hostRadius) < .1;
    const borderFits = Object.values(report.imageGeometry.inset).every(value => Math.abs(value - report.imageGeometry.borderWidth) < .1);
    if (!radiusFits || !borderFits) throw new Error(JSON.stringify(report));
    const requestedIcons = { audio:'audio-lines', text:'square-text' };
    const nonVisualMediaFits = report.nonVisualMedia.every(item => item.iconName === requestedIcons[item.kind]
      && item.iconStatus === 'ready'
      && item.stageEndsAtLabel < .1
      && item.centerDelta.x < .1
      && item.centerDelta.y < .1);
    if (!nonVisualMediaFits) throw new Error(JSON.stringify(report));
    if (!report.textBackgroundMatchesSurface) throw new Error(JSON.stringify(report));
    if (report.imageHovercard.tag !== 'ic-thumb-hovercard' || report.imageHovercard.width > 192.1
      || report.imageHovercard.height > 192.1 || report.imageHovercard.buttonCount !== 0
      || report.imageHovercard.horizontalCenterDelta > .1 || !report.imageHovercard.aboveAnchor
      || Math.abs(report.imageHovercard.anchorGap - report.imageHovercard.expectedGap) > .1
      || Math.max(report.imageHovercard.mediaWidth, report.imageHovercard.mediaHeight) < 188) throw new Error(JSON.stringify(report));
    if (!report.videoHovercard.hasVideo || report.videoHovercard.buttonCount !== 0 || report.videoHovercard.playCount < 1
      || !report.videoDestroyed.hidden || report.videoDestroyed.mediaCount !== 0 || report.videoDestroyed.pauseCount < 1) throw new Error(JSON.stringify(report));
    if (Math.abs(report.audioHovercard.width - 192) > .1 || Math.abs(report.audioHovercard.height - 128) > .1
      || report.audioHovercard.barCount !== 9 || report.audioHovercard.iconCount !== 0
      || report.audioHovercard.waveColor !== 'rgb(255, 255, 255)'
      || report.audioHovercard.waveAnimationNames.join() !== 'ic-thumb-hovercard-audio-wave-pulse'
      || report.audioHovercard.waveAnimationTimings.join() !== 'ease-in-out'
      || !report.audioHovercard.waveAnimationDelays.includes('-0.6s')
      || !report.audioHovercard.hasAudio || report.audioHovercard.hasTextPreview
      || report.audioHovercard.waveCenterDelta.x > .1 || report.audioHovercard.waveCenterDelta.y > .1
      || report.audioHovercard.playCount < 2 || !report.audioDestroyed.hidden || report.audioDestroyed.mediaCount !== 0
      || report.audioDestroyed.pauseCount < 2) throw new Error(JSON.stringify(report));
    if (Math.abs(report.textHovercard.width - 192) > .1 || Math.abs(report.textHovercard.height - 128) > .1
      || !report.textHovercard.text.includes('文本引用') || report.textHovercard.overflow !== 'hidden'
      || report.textHovercard.buttonCount !== 0) throw new Error(JSON.stringify(report));
    if (!report.composerTextHoverPreview.text.includes('纸艺鲸鱼的材质与光线参考')
      || report.composerTextHoverPreview.buttonCount !== 0) throw new Error(JSON.stringify(report));
    if (report.composerImageHoverPreview.tag !== 'ic-thumb-hovercard'
      || report.composerImageHoverPreview.kind !== 'image'
      || report.composerImageHoverPreview.imageCount !== 1) throw new Error(JSON.stringify(report));
    if (!report.hovercardMenuGroupVisible || report.hovercardMenuGroupCount !== 2 || report.hovercardMenuKinds !== 4) throw new Error(JSON.stringify(report));
    if (report.menuVideoPreview.src !== '/static/images/test/fixture.mp4' || report.menuVideoPreview.playCount < 1
      || !report.menuVideoDestroyed.hidden || report.menuVideoDestroyed.mediaCount !== 0
      || report.menuVideoDestroyed.pauseCount < 1) throw new Error(JSON.stringify(report));
    if (!report.searchStatus.includes('ic-reference-thumbnail') || report.errors.length) throw new Error(JSON.stringify(report));
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
