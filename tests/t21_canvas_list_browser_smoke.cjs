const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const baseUrl = process.env.T21_PREVIEW_URL || 'http://127.0.0.1:8796';
const browserExecutable = process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotDir = process.env.T21_SCREENSHOT_DIR || '';

const combinations = [
  { theme: 'light', viewport: { width: 1440, height: 900 }, name: 'desktop-light' },
  { theme: 'dark', viewport: { width: 1440, height: 900 }, name: 'desktop-dark' },
  { theme: 'light', viewport: { width: 390, height: 844 }, name: 'narrow-light' },
  { theme: 'dark', viewport: { width: 390, height: 844 }, name: 'narrow-dark' },
];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  const evidence = [];
  try {
    for (const combination of combinations) {
      const page = await browser.newPage({ viewport: combination.viewport });
      const consoleErrors = [];
      const pageErrors = [];
      page.on('console', message => {
        if (message.type() === 'error' || message.type() === 'warning') consoleErrors.push(message.text());
      });
      page.on('pageerror', error => pageErrors.push(String(error)));
      await page.addInitScript(theme => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('studio_theme', theme);
      }, combination.theme);
      await page.goto(`${baseUrl}/canvas-list`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.ws-card');
      await page.waitForFunction(() => (
        customElements.get('ic-card')
        && [...document.querySelectorAll('ic-card,ic-nav-item,ic-badge,ic-tabs')].every(element => element.dataset.icContractStatus === 'ready')
      ));

      const initial = await page.evaluate(() => {
        const current = document.querySelector('.ws-project-row[aria-selected="true"]');
        const card = document.querySelector('.ws-card');
        const workspace = document.querySelector('.workspace');
        const sidebar = document.querySelector('.ws-sidebar');
        const cardRect = card.getBoundingClientRect();
        const sidebarRect = sidebar.getBoundingClientRect();
        const currentRect = current.getBoundingClientRect();
        const currentStyle = getComputedStyle(current);
        const sidebarStyle = getComputedStyle(sidebar);
        const countRect = current?.querySelector('.ws-project-count')?.getBoundingClientRect();
        const projectContent = [...document.querySelectorAll('.ws-project-row')].map(row => {
          const rowRect = row.getBoundingClientRect();
          const iconRect = row.querySelector('.ws-project-icon').getBoundingClientRect();
          const nameRect = row.querySelector('.ws-project-name').getBoundingClientRect();
          const projectCountRect = row.querySelector('.ws-project-count').getBoundingClientRect();
          return {
            rowLeft: Math.round(rowRect.left),
            rowRight: Math.round(rowRect.right),
            iconLeft: Math.round(iconRect.left),
            nameLeft: Math.round(nameRect.left),
            nameRight: Math.round(nameRect.right),
            countLeft: Math.round(projectCountRect.left),
            countRight: Math.round(projectCountRect.right),
          };
        });
        return {
          cards: document.querySelectorAll('.ws-card').length,
          projects: document.querySelectorAll('.ws-project-row[role="tab"]').length,
          currentProject: current?.querySelector('.ws-project-name')?.textContent?.trim() || '',
          ariaSelected: current?.getAttribute('aria-selected') || '',
          projectIconSize: current?.querySelector('.ws-project-icon')?.getAttribute('size') || '',
          newProjectButtonSize: document.getElementById('newProjectBtn')?.getAttribute('size') || '',
          projectCountVisible: current?.querySelector('.ws-project-count')?.getBoundingClientRect().width > 0,
          projectRowPadding: {
            start: Number.parseFloat(currentStyle.paddingInlineStart),
            end: Number.parseFloat(currentStyle.paddingInlineEnd),
          },
          projectRowGutter: {
            start: Math.round(currentRect.left - sidebarRect.left - Number.parseFloat(sidebarStyle.borderInlineStartWidth)),
            end: Math.round(sidebarRect.right - currentRect.right - Number.parseFloat(sidebarStyle.borderInlineEndWidth)),
          },
          projectCountRight: Math.round(countRect?.right || 0),
          projectContent,
          publicCard: Boolean(card.querySelector('ic-card.ws-card-surface')),
          publicMedia: Boolean(card.querySelector('ic-media-container.ws-card-thumb')),
          hasSeparateEntry: Boolean(card.querySelector('.ws-card-enter')),
          moreButtonSize: card.querySelector('.ws-card-menu')?.getAttribute('size') || '',
          badgeCount: card.querySelectorAll('ic-badge').length,
          loadingHidden: document.getElementById('boardLoading').hidden,
          boardBusy: document.getElementById('board').getAttribute('aria-busy'),
          invalidContracts: document.querySelectorAll('[data-ic-contract-status="invalid"]').length,
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          workspaceDirection: getComputedStyle(workspace).flexDirection,
          sidebarSize: { width: Math.round(sidebarRect.width), height: Math.round(sidebarRect.height) },
          cardSize: { width: Math.round(cardRect.width), height: Math.round(cardRect.height) },
          theme: document.documentElement.dataset.uiTheme || (document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light'),
        };
      });
      if (screenshotDir) {
        fs.mkdirSync(screenshotDir, { recursive: true });
        await page.screenshot({ path: path.join(screenshotDir, `${combination.name}.png`) });
      }

      let projectHover = null;
      if (combination.name === 'desktop-light') {
        await page.locator('.ws-project-row[aria-selected="true"]').hover();
        await page.waitForTimeout(200);
        projectHover = await page.evaluate(() => {
          const row = document.querySelector('.ws-project-row[aria-selected="true"]');
          const count = row.querySelector('.ws-project-count').getBoundingClientRect();
          const actions = row.querySelector('.ws-project-actions');
          return {
            countRight: Math.round(count.right),
            countHidden: getComputedStyle(row.querySelector('.ws-project-count')).visibility === 'hidden',
            actionsVisible: getComputedStyle(actions).visibility === 'visible' && getComputedStyle(actions).opacity === '1',
          };
        });
      }

      await page.locator('.ws-project-row[data-project-id="motion"] .ws-project-name').click();
      await page.waitForFunction(() => document.querySelector('.ws-card')?.dataset.canvasId?.startsWith('motion-'));
      const switchedProject = await page.locator('.ws-project-row[aria-selected="true"] .ws-project-name').textContent();

      let cardsAfterLoadMore = null;
      let dropdownMenu = null;
      let directCardUrl = null;
      if (combination.name === 'desktop-light') {
        await page.locator('#boardLoadMore').click();
        await page.waitForFunction(() => document.querySelectorAll('.ws-card').length === 5);
        cardsAfterLoadMore = await page.locator('.ws-card').count();
        await page.locator('.ws-card-menu').first().click();
        await page.waitForSelector('ic-menu.ws-card-pop[open]');
        dropdownMenu = await page.evaluate(() => {
          const menu = document.querySelector('ic-menu.ws-card-pop');
          const trigger = document.querySelector('.ws-card-menu');
          const surface = menu.shadowRoot.querySelector('[part="surface"]');
          const item = menu.querySelector('ic-menu-item');
          const idItem = menu.querySelector('.ws-card-id-item');
          const menuRect = surface.getBoundingClientRect();
          const triggerRect = trigger.getBoundingClientRect();
          return {
            tag: menu.localName,
            contract: menu.dataset.icContractStatus,
            itemCount: menu.querySelectorAll('ic-menu-item').length,
            itemTextAlign: getComputedStyle(item.shadowRoot.querySelector('button')).textAlign,
            placement: menu.getAttribute('placement'),
            alignment: menu.getAttribute('alignment'),
            fixedPosition: getComputedStyle(surface).position,
            alignedToTriggerEnd: Math.abs(menuRect.right - triggerRect.right) <= 2,
            insideViewport: menuRect.left >= 0 && menuRect.top >= 0 && menuRect.right <= innerWidth && menuRect.bottom <= innerHeight,
            idItemText: idItem?.getAttribute('label') || '',
            idItemFontSize: getComputedStyle(idItem?.shadowRoot.querySelector('button')).fontSize,
            idItemColor: getComputedStyle(idItem).color,
            regularItemColor: getComputedStyle(item).color,
            idItemCopyIcon: idItem?.querySelector('ic-icon')?.getAttribute('name') || '',
          };
        });
        if (screenshotDir) {
          await page.screenshot({ path: path.join(screenshotDir, 'desktop-light-dropdown-menu.png') });
        }
        await page.keyboard.press('Escape');
        await page.route('**/static/smart-canvas.html*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Canvas destination</title>' }));
        await Promise.all([
          page.waitForURL(url => url.pathname === '/static/smart-canvas.html'),
          page.locator('.ws-card').first().click({ position: { x: 120, y: 210 } }),
        ]);
        directCardUrl = page.url();
      }

      evidence.push({
        name: combination.name,
        viewport: combination.viewport,
        ...initial,
        projectHover,
        switchedProject,
        cardsAfterLoadMore,
        dropdownMenu,
        directCardUrl,
        consoleErrors,
        pageErrors,
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  const invalid = evidence.filter(item => (
    item.cards !== 3
    || item.projects !== 2
    || item.currentProject !== '品牌视觉'
    || item.ariaSelected !== 'true'
    || item.projectIconSize !== 'small'
    || item.newProjectButtonSize !== 's'
    || item.projectRowPadding.start !== 12
    || item.projectRowPadding.end !== 12
    || item.projectRowGutter.start !== 12
    || item.projectRowGutter.end !== 12
    || !item.projectCountVisible
    || item.projectContent.some(project => project.iconLeft !== project.rowLeft + 12)
    || item.projectContent.some(project => project.countRight !== project.rowRight - 12)
    || item.projectContent.some(project => project.iconLeft !== item.projectContent[0].iconLeft)
    || item.projectContent.some(project => project.nameLeft !== item.projectContent[0].nameLeft)
    || item.projectContent.some(project => project.nameRight !== project.countLeft - 8)
    || !item.publicCard
    || !item.publicMedia
    || item.hasSeparateEntry
    || item.moreButtonSize !== 's'
    || item.badgeCount < 1
    || !item.loadingHidden
    || item.boardBusy !== 'false'
    || item.invalidContracts !== 0
    || item.horizontalOverflow > 0
    || (item.name.startsWith('narrow-') ? item.workspaceDirection !== 'column' : item.workspaceDirection !== 'row')
    || (!item.name.startsWith('narrow-') && item.sidebarSize.width !== 208)
    || (item.name.startsWith('narrow-') && item.sidebarSize.width !== item.viewport.width)
    || item.switchedProject !== '动态'
    || item.consoleErrors.length
    || item.pageErrors.length
  ));
  const desktop = evidence[0];
  const projectHoverInvalid = !desktop.projectHover
    || !desktop.projectHover.actionsVisible
    || !desktop.projectHover.countHidden;
  const dropdownInvalid = !desktop.dropdownMenu
    || desktop.dropdownMenu.tag !== 'ic-menu'
    || desktop.dropdownMenu.contract !== 'ready'
    || desktop.dropdownMenu.itemCount !== 7
    || !['start', 'left'].includes(desktop.dropdownMenu.itemTextAlign)
    || desktop.dropdownMenu.placement !== 'block-end'
    || desktop.dropdownMenu.alignment !== 'end'
    || desktop.dropdownMenu.fixedPosition !== 'fixed'
    || !desktop.dropdownMenu.alignedToTriggerEnd
    || !desktop.dropdownMenu.insideViewport
    || !desktop.dropdownMenu.idItemText.startsWith('画布 ID · motion-0')
    || desktop.dropdownMenu.idItemFontSize !== '10px'
    || desktop.dropdownMenu.idItemColor === desktop.dropdownMenu.regularItemColor
    || desktop.dropdownMenu.idItemCopyIcon !== 'copy';
  const directCardInvalid = !desktop.directCardUrl?.startsWith(`${baseUrl}/static/smart-canvas.html?id=motion-0&project=motion&v=`);
  if (desktop.cardsAfterLoadMore !== 5 || projectHoverInvalid || dropdownInvalid || directCardInvalid || invalid.length) {
    throw new Error(`Unexpected T21 Canvas List browser result: ${JSON.stringify({ evidence, invalid }, null, 2)}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, evidence }, null, 2)}\n`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
