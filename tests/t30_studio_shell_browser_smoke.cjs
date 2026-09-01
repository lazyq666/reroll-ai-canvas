const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const baseUrl = process.env.T30_PREVIEW_URL || 'http://127.0.0.1:8798';
const browserExecutable = process.env.SMART_CANVAS_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const screenshotDir = process.env.T30_SCREENSHOT_DIR || '';
const combinations = [
  { name: 'desktop-light', theme: 'light', viewport: { width: 1440, height: 900 } },
  { name: 'desktop-dark', theme: 'dark', viewport: { width: 1440, height: 900 } },
  { name: 'narrow-light', theme: 'light', viewport: { width: 390, height: 844 } },
  { name: 'narrow-dark', theme: 'dark', viewport: { width: 390, height: 844 } },
];

async function openShell(browser, combination, role = 'admin', activePage = 'zimage') {
  const context = await browser.newContext({ viewport: combination.viewport });
  await context.addCookies([{ name: 't30-role', value: role, url: baseUrl }]);
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.addInitScript(({ theme, activePage }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('studio_theme', theme);
    localStorage.setItem('studio_active_page', activePage);
  }, { theme: combination.theme, activePage });
  await page.goto(`${baseUrl}/studio`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(() => !document.documentElement.classList.contains('studio-route-booting'), null, { timeout: 15000 });
  await page.waitForFunction(() => customElements.get('ic-menu') && document.querySelector('.stage iframe.active'), null, { timeout: 15000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.sidebar-logo-image')]
    .some(image => image.getBoundingClientRect().width > 0), null, { timeout: 15000 });
  return { context, page, consoleErrors, pageErrors };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserExecutable });
  const evidence = [];
  try {
    for (const combination of combinations) {
      const session = await openShell(browser, combination);
      const { page, context, consoleErrors, pageErrors } = session;
      const collapsedShell = await page.evaluate(() => {
        const control = (selector, shadowIcon = false) => {
          const host = document.querySelector(selector);
          const rect = host.getBoundingClientRect();
          const iconElement = shadowIcon
            ? host.shadowRoot?.querySelector('ic-icon')
            : host.querySelector('ic-icon');
          const icon = iconElement?.getBoundingClientRect();
          return {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            iconCentered: !icon || (
              Math.abs((icon.left + icon.width / 2) - (rect.left + rect.width / 2)) < 1
              && Math.abs((icon.top + icon.height / 2) - (rect.top + rect.height / 2)) < 1
            ),
            color: iconElement ? getComputedStyle(iconElement).color : '',
          };
        };
        const logoAreaStyle = getComputedStyle(document.querySelector('.sidebar-logo-area'));
        const logoAreaRect = document.querySelector('.sidebar-logo-area').getBoundingClientRect();
        const logo = document.getElementById('sidebarLogoToggle');
        const logoRect = logo.getBoundingClientRect();
        const sidebarRect = document.getElementById('studioSidebar').getBoundingClientRect();
        const sidebarStyle = getComputedStyle(document.getElementById('studioSidebar'));
        const logoBaseStyle = getComputedStyle(logo.shadowRoot.querySelector('[part="base"]'));
        const logoImages = [...logo.querySelectorAll('.sidebar-logo-image')];
        const logoImage = logoImages.find(image => image.getBoundingClientRect().width > 0);
        const logoImageRect = logoImage.getBoundingClientRect();
        const logoImageStyle = getComputedStyle(logoImage);
        return {
          settings: control('#settings-fold-toggle'),
          language: control('#lang-toggle-btn'),
          account: control('#account-menu-trigger'),
          primaryNavigation: [
            control('ic-nav-item[data-page="canvas"]', true),
            control('ic-nav-item[data-page="online"]', true),
            control('#local-nav-disclosure', true),
          ],
          navigationOrder: [...document.querySelector('.global-navigation').children].map(node => node.dataset?.page || node.id || node.localName),
          tooltipComponent: document.getElementById('sidebar-tooltip')?.localName,
          nativeTooltipCount: document.querySelectorAll('[data-collapsed-tooltip-key][title], [data-sidebar-tooltip][title]').length,
          logoPaddingBlock: [logoAreaStyle.paddingTop, logoAreaStyle.paddingBottom],
          logoAreaWidth: logoAreaStyle.width,
          logoAreaFillsWidth: Math.abs(logoAreaRect.width - (
            sidebarRect.width
            - Number.parseFloat(sidebarStyle.paddingLeft)
            - Number.parseFloat(sidebarStyle.paddingRight)
            - Number.parseFloat(sidebarStyle.borderLeftWidth)
            - Number.parseFloat(sidebarStyle.borderRightWidth)
          )) < 1,
          logoAsset: logoImage?.getAttribute('src'),
          logoCenterX: logoRect.left + logoRect.width / 2,
          logoImageHeight: logoImageRect.height,
          logoCentered: Math.abs((logoRect.left + logoRect.width / 2) - (sidebarRect.left + sidebarRect.width / 2)) < 1,
          logoAnimationFree: sidebarStyle.transitionProperty === 'none'
            && logoBaseStyle.transitionProperty === 'none'
            && logoBaseStyle.transform === 'none'
            && logoImageStyle.transitionProperty === 'none'
            && logoImageStyle.transform === 'none',
        };
      });
      let logoHover = { baseBackground: 'hidden-on-narrow', baseShadow: 'hidden-on-narrow', imageTransform: 'hidden-on-narrow', tooltip: 'hidden-on-narrow' };
      let canvasTooltip = { component: 'hidden-on-narrow', content: '' };
      let settingsTooltip = { component: 'hidden-on-narrow', content: '', position: '' };
      if (!combination.name.startsWith('narrow-')) {
        await page.locator('#sidebarLogoToggle').hover();
        await page.waitForTimeout(400);
        await page.waitForFunction(() => document.getElementById('sidebar-tooltip').hasAttribute('open'));
        logoHover = await page.locator('#sidebarLogoToggle').evaluate(logo => ({
          baseBackground: getComputedStyle(logo.shadowRoot.querySelector('[part="base"]')).backgroundColor,
          baseShadow: getComputedStyle(logo.shadowRoot.querySelector('[part="base"]')).boxShadow,
          imageTransform: getComputedStyle([...logo.querySelectorAll('.sidebar-logo-image')].find(image => image.getBoundingClientRect().width > 0)).transform,
          tooltip: document.getElementById('sidebar-tooltip').getAttribute('content'),
        }));
        await page.locator('.stage').hover();
        await page.locator('ic-nav-item[data-page="canvas"]').hover();
        await page.waitForFunction(() => document.getElementById('sidebar-tooltip').hasAttribute('open'));
        canvasTooltip = await page.locator('#sidebar-tooltip').evaluate(tooltip => ({
          component: tooltip.localName,
          content: tooltip.getAttribute('content'),
        }));
        await page.locator('.stage').hover();
        await page.locator('#settings-fold-toggle').hover();
        await page.waitForFunction(() => document.querySelector('body > ic-tooltip[open]:not(#sidebar-tooltip)'));
        settingsTooltip = await page.locator('body > ic-tooltip[open]:not(#sidebar-tooltip)').evaluate(tooltip => ({
          component: tooltip.localName,
          content: tooltip.getAttribute('content'),
          position: getComputedStyle(tooltip.shadowRoot.querySelector('[role="tooltip"]')).position,
        }));
      }
      await page.locator('#settings-fold-toggle').click();
      await page.waitForFunction(() => document.getElementById('settings-menu').hasAttribute('open'));
      const settingsSurface = await page.locator('#settings-menu').evaluate(menu => {
        const rect = menu.shadowRoot.querySelector('[part="surface"]').getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      });
      await page.locator('#preferences-entry').click();
      await page.waitForFunction(() => document.getElementById('preferencesDialog')?.open);
      const preferenceDialog = await page.locator('#preferencesDialog').evaluate(dialog => {
        const shell = dialog.shadowRoot.querySelector('[part="dialog"]');
        const header = dialog.shadowRoot.querySelector('[part="header"]');
        const body = dialog.shadowRoot.querySelector('[part="body"]');
        const bodyStyle = getComputedStyle(body);
        const headerStyle = getComputedStyle(header);
        const shellRect = shell.getBoundingClientRect();
        const bodyRect = body.getBoundingClientRect();
        const contentRect = dialog.querySelector('.preferences-body').getBoundingClientRect();
        const padding = {
          top: Number.parseFloat(bodyStyle.paddingTop),
          right: Number.parseFloat(bodyStyle.paddingRight),
          bottom: Number.parseFloat(bodyStyle.paddingBottom),
          left: Number.parseFloat(bodyStyle.paddingLeft),
        };
        const contentInset = {
          left: contentRect.left - bodyRect.left,
          right: bodyRect.right - contentRect.right,
        };
        return {
          contract: dialog.dataset.icContractStatus,
          size: dialog.getAttribute('size'),
          label: dialog.getAttribute('label'),
          width: Math.round(shellRect.width),
          padding,
          headerPadding: {
            top: Number.parseFloat(headerStyle.paddingTop),
            right: Number.parseFloat(headerStyle.paddingRight),
            left: Number.parseFloat(headerStyle.paddingLeft),
          },
          contentInset,
        };
      });
      await page.locator('#preferencesDialog [data-preferences-close]').click();
      await page.waitForFunction(() => !document.getElementById('preferencesDialog'));

      await page.locator('ic-nav-item[data-page="canvas"]').click();
      await page.waitForFunction(() => document.getElementById('frame-canvas').classList.contains('active'));
      await page.locator('#account-menu-trigger').click();
      await page.waitForFunction(() => document.getElementById('account-menu').hasAttribute('open'));
      await page.locator('#account-menu-trigger').click();
      const themeToggled = !combination.name.startsWith('narrow-');
      if (themeToggled) await page.locator('#theme-toggle-btn').click();
      if (themeToggled) {
        await page.locator('#local-nav-disclosure').click();
        await page.waitForFunction(() => (
          document.getElementById('studioSidebar').classList.contains('is-pinned')
          && document.getElementById('local-nav-disclosure').hasAttribute('open')
        ));
        await page.waitForTimeout(500);
      }

      await page.locator('#frame-canvas').evaluate(frame => {
        frame.contentWindow.location.href = '/static/smart-canvas.html?id=t30-fullscreen';
      });
      await page.waitForFunction(() => document.querySelector('.app-shell')?.classList.contains('is-canvas-editor'));
      const editorFullscreen = await page.evaluate(() => {
        const shell = document.querySelector('.app-shell').getBoundingClientRect();
        const stage = document.querySelector('.stage').getBoundingClientRect();
        return {
          sidebarDisplay: getComputedStyle(document.getElementById('studioSidebar')).display,
          stageFillsShell: Math.abs(stage.left - shell.left) < 1
            && Math.abs(stage.top - shell.top) < 1
            && Math.abs(stage.width - shell.width) < 1
            && Math.abs(stage.height - shell.height) < 1,
        };
      });
      await page.locator('#frame-canvas').evaluate(frame => {
        frame.contentWindow.location.href = '/static/canvas-list.html';
      });
      await page.waitForFunction(() => !document.querySelector('.app-shell')?.classList.contains('is-canvas-editor'));
      const canvasListSidebarRestored = await page.locator('#studioSidebar').evaluate(sidebar => (
        getComputedStyle(sidebar).display !== 'none'
      ));

      const result = await page.evaluate(async () => {
        const sidebar = document.getElementById('studioSidebar').getBoundingClientRect();
        const stage = document.querySelector('.stage').getBoundingClientRect();
        const logo = document.getElementById('sidebarLogoToggle');
        const logoImages = [...logo.querySelectorAll('.sidebar-logo-image')];
        const logoImage = logoImages.find(image => image.getBoundingClientRect().width > 0);
        const logoImageRect = logoImage.getBoundingClientRect();
        const logoRect = logo.getBoundingClientRect();
        const language = document.getElementById('lang-toggle-btn').getBoundingClientRect();
        const theme = document.getElementById('theme-toggle-btn').getBoundingClientRect();
        const localDisclosure = document.getElementById('local-nav-disclosure');
        const localItems = [...localDisclosure.querySelectorAll('ic-nav-item')];
        const strokeProbe = document.createElement('span');
        strokeProbe.hidden = true;
        const strokeSizes = ['x-small', 'small', 'medium', 'large', 'x-large'];
        strokeProbe.innerHTML = strokeSizes.map(size => `<ic-icon name="settings" size="${size}"></ic-icon>`).join('');
        document.getElementById('studioSidebar').append(strokeProbe);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const sidebarIconStrokeWidths = [...strokeProbe.querySelectorAll('ic-icon')].map(icon => (
          Number.parseFloat(getComputedStyle(icon.shadowRoot?.querySelector('svg')).strokeWidth)
        ));
        strokeProbe.remove();
        return {
          invalidContracts: document.querySelectorAll('[data-ic-contract-status="invalid"]').length,
          directWebAwesome: [...document.querySelectorAll('*')].filter(node => node.localName.startsWith('wa-')).length,
          activeFrame: document.querySelector('.stage iframe.active')?.id,
          currentNavigation: document.querySelector('ic-nav-item[current]')?.dataset.page,
          accountName: document.getElementById('account-trigger-name').textContent,
          accountRole: document.getElementById('account-trigger-role').textContent,
          settingsVisible: !document.getElementById('settings-menu').hidden,
          narrowOrder: stage.top < sidebar.top,
          sidebarHeight: Math.round(sidebar.height),
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          effectiveTheme: window.StudioTheme.get(),
          logoRestored: logo.localName === 'ic-button'
            && logoImage.getAttribute('src') === '/static/images/wordmark.svg'
            && logoImages.some(image => image.getAttribute('src') === '/static/images/logo.svg'),
          logoVisible: logoImageRect.width > 0 && logoImageRect.height > 0,
          logoCenterX: logoRect.left + logoRect.width / 2,
          logoCentered: Math.abs((logoRect.left + logoRect.width / 2) - (sidebar.left + sidebar.width / 2)) < 1,
          utilityOrientation: document.querySelector('.shell-utilities').getAttribute('orientation'),
          utilitiesVertical: language.height === 0 || theme.top >= language.bottom,
          localGroupExpanded: localDisclosure.hasAttribute('open'),
          localToggleIcon: localDisclosure.shadowRoot.querySelector('ic-icon')?.getAttribute('name'),
          localChildrenIconless: localItems.every(item => !item.hasAttribute('icon')),
          sidebarIconStrokeWidths,
        };
      });
      if (screenshotDir) {
        fs.mkdirSync(screenshotDir, { recursive: true });
        await page.screenshot({ path: path.join(screenshotDir, `${combination.name}.png`) });
      }
      evidence.push({ ...combination, ...result, collapsedShell, logoHover, canvasTooltip, settingsTooltip, themeToggled, preferenceDialog, settingsSurface, editorFullscreen, canvasListSidebarRestored, consoleErrors, pageErrors });
      await context.close();
    }

    const designerSession = await openShell(browser, combinations[0], 'designer', 'api-settings');
    const designer = await designerSession.page.evaluate(() => ({
      activeFrame: document.querySelector('.stage iframe.active')?.id,
      currentNavigation: document.querySelector('ic-nav-item[current]')?.dataset.page,
      settingsHidden: document.getElementById('settings-menu').hidden,
      adminSourcesRemoved: ['frame-account-management', 'frame-api-settings', 'frame-available-model-management', 'frame-comfyui-settings']
        .every(id => !document.getElementById(id).hasAttribute('data-src')),
      invalidContracts: document.querySelectorAll('[data-ic-contract-status="invalid"]').length,
    }));
    const designerErrors = [...designerSession.consoleErrors, ...designerSession.pageErrors];
    await designerSession.context.close();

    const invalid = evidence.filter(item => (
      item.invalidContracts !== 0
      || item.directWebAwesome !== 0
      || item.activeFrame !== 'frame-canvas'
      || item.currentNavigation !== 'canvas'
      || item.accountName !== 'Shell Admin'
      || !item.accountRole
      || !item.settingsVisible
      || item.preferenceDialog.contract !== 'ready'
      || item.preferenceDialog.size !== 'medium'
      || item.preferenceDialog.label !== '数据存储位置'
      || item.preferenceDialog.width > 720
      || Math.abs(item.preferenceDialog.contentInset.left - item.preferenceDialog.contentInset.right) >= 1
      || Object.values(item.preferenceDialog.padding).some(value => value !== 24)
      || Object.values(item.preferenceDialog.headerPadding).some(value => value !== 24)
      || item.settingsSurface.left < 0
      || item.settingsSurface.top < 0
      || item.settingsSurface.right > item.viewport.width
      || item.settingsSurface.bottom > item.viewport.height
      || item.horizontalOverflow > 0
      || !item.logoRestored
      || (item.themeToggled && !item.logoVisible)
      || item.utilityOrientation !== 'vertical'
      || !item.utilitiesVertical
      || !item.localChildrenIconless
      || item.editorFullscreen.sidebarDisplay !== 'none'
      || !item.editorFullscreen.stageFillsShell
      || !item.canvasListSidebarRestored
      || (item.name.startsWith('narrow-')
        ? (item.collapsedShell.settings.width !== 40 || item.collapsedShell.settings.height !== 40 || !item.collapsedShell.settings.iconCentered)
        : (item.collapsedShell.settings.width !== item.collapsedShell.language.width
          || item.collapsedShell.settings.height !== item.collapsedShell.language.height
          || item.collapsedShell.settings.iconCentered !== item.collapsedShell.language.iconCentered))
      || item.collapsedShell.account.width !== item.collapsedShell.account.height
      || !item.collapsedShell.account.iconCentered
      || item.collapsedShell.primaryNavigation.slice(0, item.name.startsWith('narrow-') ? 2 : 3).some(control => control.width !== 40 || control.height !== 40 || !control.iconCentered)
      || item.collapsedShell.primaryNavigation.slice(0, item.name.startsWith('narrow-') ? 2 : 3).some(control => control.color !== (item.theme === 'dark' ? 'rgb(255, 255, 255)' : 'rgb(15, 15, 15)'))
      || item.collapsedShell.navigationOrder.join(',') !== 'canvas,online,ic-divider,local-nav-disclosure'
      || item.collapsedShell.tooltipComponent !== 'ic-tooltip'
      || item.collapsedShell.nativeTooltipCount !== 0
      || item.collapsedShell.logoPaddingBlock.some(value => value !== '0px')
      || (!item.name.startsWith('narrow-') && !item.collapsedShell.logoAreaFillsWidth)
      || item.collapsedShell.logoAsset !== '/static/images/logo.svg'
      || (!item.name.startsWith('narrow-') && !item.collapsedShell.logoCentered)
      || !item.collapsedShell.logoAnimationFree
      || (item.themeToggled && item.logoHover.baseBackground !== 'rgba(0, 0, 0, 0)')
      || (item.themeToggled && item.logoHover.baseShadow !== 'none')
      || (item.themeToggled && item.logoHover.imageTransform !== 'none')
      || (item.themeToggled && item.logoHover.tooltip !== '展开导航栏')
      || (item.themeToggled && !item.logoCentered)
      || (item.themeToggled && (item.canvasTooltip.component !== 'ic-tooltip' || item.canvasTooltip.content !== '画布'))
      || (item.themeToggled && (item.settingsTooltip.component !== 'ic-tooltip' || item.settingsTooltip.content !== '设置' || item.settingsTooltip.position !== 'fixed'))
      || (item.themeToggled && (!item.localGroupExpanded || item.localToggleIcon !== 'project'))
      || item.sidebarIconStrokeWidths.some(width => width !== 1.5)
      || (item.themeToggled ? item.effectiveTheme === item.theme : item.effectiveTheme !== item.theme)
      || (item.name.startsWith('narrow-') && (!item.narrowOrder || item.sidebarHeight !== 72))
      || item.consoleErrors.length
      || item.pageErrors.length
    ));
    if (
      invalid.length
      || designer.activeFrame !== 'frame-canvas'
      || designer.currentNavigation !== 'canvas'
      || !designer.settingsHidden
      || !designer.adminSourcesRemoved
      || designer.invalidContracts !== 0
      || designerErrors.length
    ) {
      throw new Error(`Unexpected T30 shell result: ${JSON.stringify({ evidence, invalid, designer, designerErrors }, null, 2)}`);
    }
    process.stdout.write(`${JSON.stringify({ ok: true, evidence, designer }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
