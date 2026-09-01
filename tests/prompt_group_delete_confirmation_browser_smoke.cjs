const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1180, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('http://prompt-library.local/**', async route => {
    const requestPath = decodeURIComponent(new URL(route.request().url()).pathname);
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if (!filePath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(filePath)) {
      await route.fulfill({ status: 404, body: 'Not found' });
      return;
    }
    await route.fulfill({ path: filePath });
  });

  try {
    await page.goto('http://prompt-library.local/tests/infinite_canvas_ui_confirm_popover_browser_harness.html');
    await page.waitForFunction(() => ['passed', 'failed'].includes(document.documentElement.dataset.icConfirmPopoverTestStatus), null, { timeout: 5000 })
      .catch(() => { throw new Error(`Confirm Popover harness did not finish: ${JSON.stringify(errors)}`); });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.icConfirmPopoverTestStatus), 'passed', await page.locator('#results').innerText());

    await page.goto('http://prompt-library.local/tests/infinite_canvas_ui_prompt_template_library_browser_harness.html');
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    const library = page.locator('#library');
    await library.evaluate(element => {
      element.activeLibrary = 'common';
      element.activeCategory = 'all';
    });
    await library.locator('[data-template-edit="wide"]').click();
    await library.locator('[data-editor-delete]').click();
    const templateConfirmation = library.locator('[data-template-delete-confirmation]');
    assert.equal(await templateConfirmation.getAttribute('open'), '');
    assert.equal(await templateConfirmation.getAttribute('label'), '删除“广角建立镜头”模板？');
    assert.equal(await templateConfirmation.getAttribute('description'), '删除后无法恢复。');
    assert.equal(await library.locator('[part="editor"]').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await templateConfirmation.getAttribute('open'), null);
    assert.equal(await library.locator('[part="editor"]').count(), 1);
    assert.equal(await page.locator('#libraryDialog').evaluate(dialog => dialog.open), true);
    assert.equal(await page.evaluate(() => window.events.filter(item => item.type === 'ic-template-delete').length), 0);
    await library.locator('[data-editor-delete]').click();
    await templateConfirmation.evaluate(popover => popover.shadowRoot.querySelector('[data-confirm]').click());
    assert.equal(await library.evaluate(element => element.templates.some(item => item.id === 'wide')), false);

    await library.locator('[data-category-item="light"]').hover();
    await library.locator('[data-category-delete="light"]').click();
    const confirmation = library.locator('[data-category-delete-confirmation]');
    assert.equal(await confirmation.getAttribute('open'), '');
    assert.equal(await confirmation.getAttribute('label'), '删除“光影”分组？');
    assert.equal(await confirmation.getAttribute('description'), '组内 1 个提示词会移至“未分类”，模板本身不会删除。');
    assert.deepEqual(await confirmation.evaluate(popover => ({
      contract: popover.dataset.icContractStatus,
      role: popover.shadowRoot.querySelector('[part="surface"]').getAttribute('role'),
      initialFocus: popover.shadowRoot.activeElement?.hasAttribute('data-cancel'),
      neutralBorderTokenUsed: popover.shadowRoot.querySelector('style').textContent.includes('solid var(--ui-color-border-secondary)'),
      dangerBorderTokenUsed: popover.shadowRoot.querySelector('style').textContent.includes('danger-border'),
      actions: [...popover.shadowRoot.querySelectorAll('[part="actions"] ic-button')].map(button => button.tone),
    })), {
      contract: 'ready', role: 'alertdialog', initialFocus: true,
      neutralBorderTokenUsed: true, dangerBorderTokenUsed: false,
      actions: ['neutral', 'danger'],
    });
    await page.keyboard.press('Escape');
    assert.equal(await confirmation.getAttribute('open'), null);
    assert.equal(await page.locator('#libraryDialog').evaluate(dialog => dialog.open), true);
    assert.equal(await page.evaluate(() => window.events.filter(item => item.type === 'ic-close').length), 0);
    assert.equal(await page.evaluate(() => window.events.filter(item => item.type === 'ic-category-delete').length), 0);

    await library.locator('[data-category-delete="light"]').click();
    await library.locator('[data-search]').focus();
    await page.keyboard.press('Escape');
    assert.equal(await confirmation.getAttribute('open'), null);
    assert.equal(await page.locator('#libraryDialog').evaluate(dialog => dialog.open), true);
    assert.equal(await page.evaluate(() => window.events.filter(item => item.type === 'ic-close').length), 0);

    await library.locator('[data-category-delete="light"]').click();
    await confirmation.evaluate(popover => popover.shadowRoot.querySelector('[data-confirm]').click());
    assert.deepEqual(await page.evaluate(() => window.events.findLast(item => item.type === 'ic-category-delete').detail), {
      libraryId: 'common', categoryId: 'light',
    });
    assert.equal(await library.locator('[data-category-item="light"]').count(), 0);
    assert.equal(await library.locator('[data-category-item="uncategorized"] [part="category-label"]').innerText(), '未分类');
    assert.equal(await library.locator('[data-category-item="uncategorized"] [part="category-actions"]').count(), 0);
    assert.equal(await library.evaluate(element => element.templates.find(item => item.id === 'soft').category), 'uncategorized');
    assert.deepEqual(errors, []);
    console.log('Prompt template/group deletion confirm-popover browser smoke passed.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
