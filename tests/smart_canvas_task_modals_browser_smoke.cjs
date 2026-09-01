const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROJECT_PYTHON = path.join(ROOT, '.venv', 'bin', 'python');
const PYTHON = process.env.SMART_CANVAS_PYTHON || (fs.existsSync(PROJECT_PYTHON) ? PROJECT_PYTHON : 'python3');

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      listener.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('manual server did not start')), 10000);
    child.once('exit', code => reject(new Error(`manual server exited with ${code}`)));
    child.stdout.on('data', chunk => {
      if (!String(chunk).includes('Smart Canvas manual server:')) return;
      clearTimeout(timer);
      resolve();
    });
  });
}

(async () => {
  const port = await freePort();
  const server = spawn(PYTHON, ['tests/smart_canvas_manual_server.py'], {
    cwd:ROOT,
    env:{...process.env, SMART_CANVAS_PORT:String(port)},
    stdio:['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(server);
  const browser = await chromium.launch({headless:true, executablePath:CHROME});
  const report = {checks:{}};
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    await page.goto(`http://127.0.0.1:${port}/static/smart-canvas.html?id=modal-browser-smoke&manual=1`, {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => customElements.get('ic-dialog') && typeof openSmartCanvasShortcuts === 'function');
    const nodePackageLimits = await page.evaluate(() => loadNodePackageLimits());

    await page.locator('#smartSettingsToggle').click();
    await page.waitForFunction(() => document.querySelector('#smartSettingsPanel')?.classList.contains('open'));
    const settingsNavigation = await page.locator('#smartSettingsPanel').evaluate(panel => ({
      shortcutLabel:panel.querySelector('#smartShortcutSettingsAction')?.textContent.trim(),
      shortcutKey:panel.querySelector('#smartShortcutSettingsShortcut')?.textContent.trim(),
      forwardIcons:[...panel.querySelectorAll('.smart-canvas-settings-link > ic-icon')].map(icon => icon.getAttribute('name')),
    }));
    await page.locator('#smartShortcutSettingsAction').click();
    await page.waitForFunction(() => document.querySelector('#smartShortcutDialog')?.hasAttribute('open'));
    const shortcutDialog = page.locator('#smartShortcutDialog');
    const shortcutShell = await shortcutDialog.evaluate(dialog => {
      const rect = dialog.shadowRoot.querySelector('[part="dialog"]').getBoundingClientRect();
      return {
        width:rect.width,
        cssWidth:getComputedStyle(dialog.shadowRoot.querySelector('[part="dialog"]')).inlineSize,
        groups:dialog.querySelectorAll('[data-shortcut-group]').length,
        rows:dialog.querySelectorAll('[data-shortcut-row]').length,
        status:dialog.dataset.icContractStatus,
      };
    });
    const shortcutSearch = page.locator('#smartShortcutSearch input');
    await shortcutSearch.pressSequentially('编组');
    await page.waitForFunction(() => [...document.querySelectorAll('#smartShortcutDialog [data-shortcut-row]')].filter(row => !row.hidden).length === 2);
    await page.locator('#smartShortcutSearchClear').click();
    const shortcutCleared = await shortcutDialog.evaluate(dialog => ({
      rows:[...dialog.querySelectorAll('[data-shortcut-row]')].filter(row => !row.hidden).length,
      groups:[...dialog.querySelectorAll('[data-shortcut-group]')].filter(group => !group.hidden).length,
    }));
    await shortcutSearch.pressSequentially('不存在');
    await page.waitForFunction(() => !document.querySelector('#smartShortcutEmpty')?.hidden);
    await page.locator('#smartShortcutSearchClear').click();
    assert.equal(await shortcutSearch.evaluate(input => input === input.getRootNode().activeElement), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#smartShortcutDialog')?.hasAttribute('open'));
    const shortcutFocusReturn = await page.locator('#smartShortcutSettingsAction').evaluate(element => document.activeElement === element);
    report.shortcut = {settingsNavigation, shortcutShell, shortcutCleared, shortcutFocusReturn};
    report.checks.shortcuts = shortcutShell.cssWidth === '512px'
      && settingsNavigation.shortcutLabel.includes('快捷键')
      && /⌘ \/|Ctrl \+ \//.test(settingsNavigation.shortcutKey)
      && settingsNavigation.forwardIcons.join(',') === 'keyboard,forward'
      && shortcutShell.groups === 4
      && shortcutShell.rows === 21
      && shortcutShell.status === 'ready'
      && shortcutCleared.rows === 21
      && shortcutCleared.groups === 4
      && shortcutFocusReturn;

    await page.mouse.click(700, 300, {button:'right'});
    await page.waitForFunction(() => document.querySelector('#createMenu')?.hasAttribute('open'));
    const contextNavigation = await page.locator('#createMenu').evaluate(menu => ({
      visibleValues:[...menu.querySelectorAll(':scope > ic-menu-item:not([hidden])')].map(item => item.getAttribute('value')),
      batchLabel:menu.querySelector('ic-menu-item[value="batch-import"]')?.getAttribute('label'),
    }));
    const launcher = page.locator('#createMenu > ic-menu-item[value="batch-import"]');
    await launcher.click();
    await page.waitForFunction(() => document.querySelector('#smartNodePackageImportDialog')?.hasAttribute('open'));
    const importDialog = page.locator('#smartNodePackageImportDialog');
    const importShell = await importDialog.evaluate(dialog => {
      const rect = dialog.shadowRoot.querySelector('[part="dialog"]').getBoundingClientRect();
      return {
        width:rect.width,
        cssWidth:getComputedStyle(dialog.shadowRoot.querySelector('[part="dialog"]')).inlineSize,
        status:dialog.dataset.icContractStatus,
        nativeTitle:dialog.shadowRoot.querySelector('h2')?.textContent.replace(/\s+/g, ' ').trim(),
        nestedTitles:dialog.querySelectorAll('h2').length,
      };
    });
    await page.waitForFunction(() => document.querySelector('#smartNodePackageLimits')?.textContent.includes('384 MB'));
    const importLimitCopy = await page.locator('#smartNodePackageLimits').innerText();
    await page.evaluate(() => window.StudioI18n.set('en'));
    await page.waitForFunction(() => document.querySelector('#smartNodePackageLimits')?.textContent === 'JSON or ZIP, up to 384 MB');
    const importLimitCopyEnglish = await page.locator('#smartNodePackageLimits').innerText();
    await page.evaluate(() => window.StudioI18n.set('zh'));
    await page.waitForFunction(() => document.querySelector('#smartNodePackageLimits')?.textContent === '支持 JSON、ZIP，最大 384 MB');
    const acceptsPackageOverOldLimit = await page.evaluate(async () => {
      const file = {
        name:'large-node-package.zip',
        size:101 * 1024 * 1024,
        slice:() => new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]),
      };
      try {
        await window.SmartCanvasModules.taskModals.validateNodePackageFile(file, 384 * 1024 * 1024);
        return true;
      } catch (_) {
        return false;
      }
    });
    const configuredLimitError = await page.evaluate(async () => {
      const file = {
        name:'too-large-node-package.zip',
        size:385 * 1024 * 1024,
        slice:() => new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]),
      };
      try {
        await window.SmartCanvasModules.taskModals.validateNodePackageFile(file, 384 * 1024 * 1024);
        return '';
      } catch (error) {
        return error.message;
      }
    });
    assert.equal(await page.locator('#smartNodePackagePrimary').getAttribute('disabled'), '');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('#smartNodePackageDropzone').press('Enter'),
    ]);
    assert.equal(chooser.isMultiple(), false);
    assert.equal(await page.locator('#smartNodePackageSample').count(), 0);
    const packagePayload = {
      format:'infinite-smart-canvas-workflow',
      version:1,
      canvas_type:'smart',
      nodes:Array.from({length:8},(_, index) => ({
        id:`browser-${index + 1}`,
        type:index < 3 ? 'smart-prompt' : 'smart-image',
        title:`浏览器测试节点 ${index + 1}`,
        text:index < 3 ? `浏览器测试提示词 ${index + 1}` : '',
        x:(index % 4) * 320,
        y:Math.floor(index / 4) * 260,
        w:260,
        h:180,
      })),
      connections:Array.from({length:6},(_, index) => ({
        from:`browser-${index + 1}`,
        to:`browser-${index + 2}`,
        kind:'input',
      })),
      resources:Array.from({length:4},(_, index) => ({name:`browser-resource-${index + 1}.png`,size:1024})),
    };
    await chooser.setFiles({
      name:'browser-node-package.json',
      mimeType:'application/json',
      buffer:Buffer.from(JSON.stringify(packagePayload)),
    });
    await page.waitForFunction(() => !document.querySelector('#smartNodePackageSelected')?.hidden);
    assert.match(await page.locator('#smartNodePackageFileMeta').innerText(), /JSON 节点包$/);
    await page.locator('#smartNodePackagePrimary').click();
    await page.waitForFunction(() => !document.querySelector('[data-node-package-step="review"]')?.hidden);
    const review = {
      nodes:await page.locator('#smartNodePackageNodeCount').innerText(),
      connections:await page.locator('#smartNodePackageConnectionCount').innerText(),
      resources:await page.locator('#smartNodePackageResourceCount').innerText(),
      secondary:await page.locator('#smartNodePackageCancel').innerText(),
      primary:await page.locator('#smartNodePackagePrimary').innerText(),
    };
    await page.locator('#smartNodePackageCancel').click();
    assert.equal(await page.locator('#smartNodePackageSelected').isVisible(), true);
    await page.locator('#smartNodePackagePrimary').click();
    await page.waitForFunction(() => !document.querySelector('[data-node-package-step="review"]')?.hidden);
    await page.locator('#smartNodePackagePrimary').click();
    await page.waitForFunction(() => !document.querySelector('[data-node-package-step="done"]')?.hidden);
    const done = {
      nodes:await page.locator('.image-node').count(),
      secondary:await page.locator('#smartNodePackageCancel').innerText(),
      primary:await page.locator('#smartNodePackagePrimary').innerText(),
      summary:await page.locator('#smartNodePackageSuccessCopy').innerText(),
    };
    report.import = {nodePackageLimits, importShell, importLimitCopy, importLimitCopyEnglish, acceptsPackageOverOldLimit, configuredLimitError, review, done};
    report.checks.import = importShell.cssWidth === '512px'
      && importShell.status === 'ready'
      && importShell.nativeTitle === '导入节点包'
      && importShell.nestedTitles === 0
      && nodePackageLimits.max_archive_bytes === 384 * 1024 * 1024
      && importLimitCopy === '支持 JSON、ZIP，最大 384 MB'
      && importLimitCopyEnglish === 'JSON or ZIP, up to 384 MB'
      && acceptsPackageOverOldLimit
      && configuredLimitError === '节点包超过 384 MB，无法上传'
      && review.nodes === '8'
      && review.connections === '6'
      && review.resources === '4 个资源'
      && review.secondary === '返回'
      && review.primary === '导入 8 个节点'
      && done.nodes === 8
      && done.secondary === '关闭'
      && done.primary === '定位到新节点'
      && done.summary.includes('8 个节点、6 条连接和 4 个资源');

    await page.locator('#smartNodePackageCancel').click();
    await page.waitForFunction(() => !document.querySelector('#smartNodePackageImportDialog')?.hasAttribute('open'));
    report.contextNavigation = contextNavigation;
    report.checks.contextNavigation = contextNavigation.batchLabel === '批量导入节点'
      && contextNavigation.visibleValues.at(-2) === 'paste'
      && contextNavigation.visibleValues.at(-1) === 'batch-import';
    report.checks.focusReturn = await page.locator('#shell').evaluate(element => document.activeElement === element);

    let exportedPayload = null;
    await page.route('**/api/canvas-workflows/export', async route => {
      exportedPayload = route.request().postDataJSON();
      await route.fulfill({status:200, contentType:'application/zip', body:Buffer.from('PK\u0003\u0004mock')});
    });
    await page.evaluate(() => {
      const script = document.createElement('script');
      script.textContent = `(() => {
        selectedId = '';
        const selected = nodes.slice(0, 2);
        selected.forEach((node, index) => {
          node.images = [{url:'data:image/png;base64,iVBORw0KGgo=',kind:'image',name:'右键发布测试-' + (index + 1) + '.png'}];
        });
        selectedIds = selected.map(node => node.id);
        render();
        window.SmartCanvasModules.viewportSelection.selection.refresh();
      })();`;
      document.body.appendChild(script);
      script.remove();
    });
    const firstSelectedNode = page.locator('.image-node.selected').first();
    await firstSelectedNode.click({button:'right', force:true});
    await page.waitForFunction(() => document.querySelector('#smartNodeContextMenu')?.hasAttribute('open'));
    const multiMenu = await page.locator('#smartNodeContextMenu').evaluate(menu => ({
      values:[...menu.querySelectorAll(':scope > ic-menu-item')].map(item => item.getAttribute('value')),
      labels:[...menu.querySelectorAll(':scope > ic-menu-item')].map(item => item.getAttribute('label')),
      sequence:[...menu.children].map(item => item.getAttribute('role') === 'separator' ? 'separator' : item.getAttribute('value')),
      separatorCount:menu.querySelectorAll(':scope > [role="separator"]').length,
    }));
    await page.locator('#smartNodeContextMenu > ic-menu-item[value="export-resource-package"]').click();
    await page.waitForFunction(() => !document.querySelector('#smartNodeContextMenu')?.hasAttribute('open'));
    await page.waitForTimeout(100);
    const exportIndex = multiMenu.values.indexOf('export-resource-package');
    const publishIndex = multiMenu.values.indexOf('publish-workspace-assets');
    const exportSequenceIndex = multiMenu.sequence.indexOf('export-resource-package');
    report.export = {multiMenu, exportedPayload};
    report.checks.export = exportIndex > multiMenu.values.indexOf('frame-selection')
      && exportIndex < multiMenu.values.indexOf('copy')
      && publishIndex === exportIndex + 1
      && multiMenu.sequence[exportSequenceIndex + 1] === 'publish-workspace-assets'
      && multiMenu.labels[exportIndex] === '导出节点为资源包'
      && multiMenu.labels[publishIndex] === '添加到资产库'
      && exportedPayload?.include_resources === true
      && exportedPayload?.nodes?.length === 2;
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!Object.values(report.checks).every(Boolean)) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
