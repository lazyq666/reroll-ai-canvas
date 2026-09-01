const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  const browser = await chromium.launch({ headless:true, executablePath:CHROME });
  const page = await browser.newPage({ viewport:{ width:1180, height:800 } });
  await page.route('http://prompt-library.local/**', async route => {
    const requestPath = decodeURIComponent(new URL(route.request().url()).pathname);
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if (!filePath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(filePath)) {
      await route.fulfill({ status:404, body:'Not found' });
      return;
    }
    await route.fulfill({ path:filePath });
  });

  try {
    await page.goto('http://prompt-library.local/tests/infinite_canvas_ui_prompt_template_library_browser_harness.html');
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    const library = page.locator('#library');
    await library.locator('[data-library-switch] > [data-value="common"]').click();

    const result = await library.evaluate(async element => {
      const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const search = element.shadowRoot.querySelector('[data-search]');
      const input = search.shadowRoot.querySelector('input');
      input.focus();
      input.value = '广角';
      input.dispatchEvent(new InputEvent('input', {
        bubbles:true, composed:true, data:'角', inputType:'insertText',
      }));
      input.setSelectionRange(1, 1);
      element.templates = [...element.templates];
      await paint();
      const refreshedSearch = element.shadowRoot.querySelector('[data-search]');
      const refreshedInput = refreshedSearch.shadowRoot.querySelector('input');
      const templateRefresh = {
        searchPreserved:refreshedSearch === search,
        inputPreserved:refreshedInput === input,
        inputFocused:refreshedSearch.shadowRoot.activeElement === refreshedInput,
        value:refreshedInput.value,
        selectionStart:refreshedInput.selectionStart,
        selectionEnd:refreshedInput.selectionEnd,
      };

      refreshedInput.dispatchEvent(new CompositionEvent('compositionstart', {
        bubbles:true, composed:true, data:'',
      }));
      refreshedInput.value = '中';
      refreshedInput.setSelectionRange(1, 1);
      refreshedInput.dispatchEvent(new InputEvent('input', {
        bubbles:true, composed:true, data:'中', inputType:'insertCompositionText', isComposing:true,
      }));
      element.libraries = element.libraries.map(item => ({...item}));
      const beforeEndPreserved = element.shadowRoot.querySelector('[data-search]') === refreshedSearch
        && refreshedSearch.shadowRoot.querySelector('input') === refreshedInput;
      refreshedInput.dispatchEvent(new CompositionEvent('compositionend', {
        bubbles:true, composed:true, data:'中',
      }));
      await paint();
      const composedSearch = element.shadowRoot.querySelector('[data-search]');
      const composedInput = composedSearch.shadowRoot.querySelector('input');
      const structureRefresh = {
        beforeEndPreserved,
        inputFocused:composedSearch.shadowRoot.activeElement === composedInput,
        value:composedInput.value,
        selectionStart:composedInput.selectionStart,
        selectionEnd:composedInput.selectionEnd,
      };

      element.query = '';
      element.openCreate();
      await paint();
      const editor = element.shadowRoot.querySelector('[data-editor-name]');
      const editorInput = editor.shadowRoot.querySelector('input');
      editorInput.focus();
      editorInput.value = '中文模板';
      editorInput.setSelectionRange(2, 2);
      editorInput.dispatchEvent(new InputEvent('input', {
        bubbles:true, composed:true, data:'文', inputType:'insertText',
      }));
      element.templates = [...element.templates];
      await paint();
      const refreshedEditor = element.shadowRoot.querySelector('[data-editor-name]');
      const refreshedEditorInput = refreshedEditor.shadowRoot.querySelector('input');
      return {
        templateRefresh,
        structureRefresh,
        editorRefresh:{
          editorPreserved:refreshedEditor === editor,
          inputPreserved:refreshedEditorInput === editorInput,
          inputFocused:refreshedEditor.shadowRoot.activeElement === refreshedEditorInput,
          value:refreshedEditorInput.value,
          selectionStart:refreshedEditorInput.selectionStart,
          selectionEnd:refreshedEditorInput.selectionEnd,
        },
      };
    });

    assert.deepEqual(result, {
      templateRefresh:{
        searchPreserved:true, inputPreserved:true, inputFocused:true,
        value:'广角', selectionStart:1, selectionEnd:1,
      },
      structureRefresh:{
        beforeEndPreserved:true, inputFocused:true,
        value:'中', selectionStart:1, selectionEnd:1,
      },
      editorRefresh:{
        editorPreserved:true, inputPreserved:true, inputFocused:true,
        value:'中文模板', selectionStart:2, selectionEnd:2,
      },
    });
    process.stdout.write('Prompt template library input stability smoke passed.\n');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
