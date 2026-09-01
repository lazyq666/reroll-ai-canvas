const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 18000 + Math.floor(Math.random() * 1000);

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function waitForPreview(server) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Preview did not start: ${stderr}`)), 10000);
    server.stdout.on('data', chunk => {
      if (!chunk.toString().includes('API Settings preview:')) return;
      clearTimeout(timer);
      resolve();
    });
    server.stderr.on('data', chunk => { stderr += chunk.toString(); });
    server.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Preview exited before startup (${code}): ${stderr}`));
    });
  });
}

function debuggerUrl(browser) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Chrome debugger did not start: ${stderr}`)), 10000);
    browser.stderr.on('data', chunk => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
    browser.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited before debugger startup (${code}): ${stderr}`));
    });
  });
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener('message', message => {
    const payload = JSON.parse(message.data);
    const operation = pending.get(payload.id);
    if (operation) {
      pending.delete(payload.id);
      if (payload.error) operation.reject(new Error(JSON.stringify(payload.error)));
      else operation.resolve(payload.result);
    } else if (payload.method) events.push(payload);
  });
  return {
    events,
    send(method, params = {}, sessionId) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
  };
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed');
  return result.result.value;
}

async function waitFor(cdp, sessionId, expression, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function waitForExit(child, timeout = 5000) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeout);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function snapshot(cdp, sessionId, providerId) {
  await evaluate(cdp, sessionId, `selectProvider(${JSON.stringify(providerId)})`);
  await waitFor(
    cdp,
    sessionId,
    `(() => {
      const region = document.querySelector('#providerOnboardingHost');
      return region && !region.hidden && region.children.length > 0;
    })()`,
    `${providerId} onboarding content`,
  );
  return evaluate(cdp, sessionId, `(() => {
    const region = document.querySelector('#providerOnboardingHost');
    const card = region.querySelector(':scope > ic-card');
    const style = getComputedStyle(region);
    const controls = [...region.querySelectorAll('ic-button,ic-input,ic-badge,ic-heading,ic-icon')];
    return {
      provider: ${JSON.stringify(providerId)},
      regionTag: region.tagName,
      regionBorder: style.borderTopWidth,
      regionBackground: style.backgroundColor,
      directCards: region.querySelectorAll(':scope > ic-card').length,
      nestedCards: card ? card.querySelectorAll('ic-card').length : -1,
      nestedChromePanels: region.querySelectorAll('.onboarding-step-panel').length,
      legacyNativeControls: region.querySelectorAll('a,button,input,label').length,
      legacyActionClasses: region.querySelectorAll('.onboarding-key-btn,.onboarding-save-btn').length,
      badges: region.querySelectorAll('ic-badge').length,
      publicControls: controls.length,
      invalidPublicControls: controls.filter(control => control.dataset.icContractStatus === 'invalid').length,
    };
  })()`);
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome executable not found: ${CHROME}`);
  const preview = spawn('node', ['tests/api_settings_browser_app.cjs'], {
    cwd: ROOT,
    env: { ...process.env, API_SETTINGS_PREVIEW_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ic-provider-onboarding-'));
  let browser;
  let cdp;
  try {
    await waitForPreview(preview);
    browser = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-allow-origins=*', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    cdp = await connect(await debuggerUrl(browser));
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const sessionId = attached.sessionId;
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Log.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/api-settings` }, sessionId);
    await waitFor(
      cdp,
      sessionId,
      `customElements.get('ic-card') && document.querySelector('[data-value="runninghub"]')`,
      'API Settings provider navigation',
    );
    const providers = [
      await snapshot(cdp, sessionId, 'modelscope'),
      await snapshot(cdp, sessionId, 'runninghub'),
    ];
    await evaluate(cdp, sessionId, `selectProvider('modelscope')`);
    const defaultKeyActions = await evaluate(cdp, sessionId, `(() => ({
      clearHidden: document.querySelector('#clearSavedKeyBtn')?.hidden,
      detectHidden: document.querySelector('#testUrlBtn')?.hidden,
      detectText: document.querySelector('#testUrlBtn')?.textContent?.trim() || '',
    }))()`);
    await evaluate(cdp, sessionId, `selectProvider('volcengine')`);
    await waitFor(
      cdp,
      sessionId,
      `(() => {
        const input = document.querySelector('#keyInput');
        const action = document.querySelector('#testUrlBtn');
        return document.body.classList.contains('show-volcengine')
          && input?.dataset.icContractStatus === 'valid'
          && action?.dataset.icContractStatus === 'ready';
      })()`,
      'Volcengine API key input action',
    );
    const volcengineKeyInput = await evaluate(cdp, sessionId, `(() => {
      const input = document.querySelector('#keyInput');
      const action = document.querySelector('#testUrlBtn');
      const clear = document.querySelector('#clearSavedKeyBtn');
      return {
        inputTag: input?.tagName || '',
        inputContract: input?.dataset.icContractStatus || '',
        actionTag: action?.tagName || '',
        actionContract: action?.dataset.icContractStatus || '',
        actionSlot: action?.getAttribute('slot') || '',
        actionText: action?.textContent?.trim() || '',
        clearTag: clear?.tagName || '',
        clearContract: clear?.dataset.icContractStatus || '',
        clearSlot: clear?.getAttribute('slot') || '',
        clearHidden: clear?.hidden,
        clearBeforeDetect: clear?.nextElementSibling === action,
      };
    })()`);
    const headingSemantics = await evaluate(cdp, sessionId, `(() => {
      const pageHeading = document.querySelector('.page-heading');
      const providerNavigation = document.querySelector('#providerNavigation');
      const navigationHeadings = [...document.querySelectorAll('#providerNavigation .provider-navigation-content > .side-section-title, #providerNavigation .cli-quick-group > .side-section-title, #providerNavigation .api-transfer-group > .side-section-title')];
      const cardHeadings = [...document.querySelectorAll('.card-heading')];
      const subtitlelessCardHeadings = cardHeadings.filter(heading => heading.shadowRoot?.querySelector('[part="subtitle"]')?.hidden);
      return {
        pageH1: pageHeading?.shadowRoot?.querySelectorAll('h1').length || 0,
        providerNavigationTag: providerNavigation?.tagName,
        providerNavigationSize: providerNavigation?.getAttribute('size'),
        providerNavigationBackground: providerNavigation ? getComputedStyle(providerNavigation).backgroundColor : '',
        providerNavigationCardBackground: providerNavigation?.shadowRoot ? getComputedStyle(providerNavigation.shadowRoot.querySelector('.card')).backgroundColor : '',
        providerNavigationCardRadius: providerNavigation?.shadowRoot ? getComputedStyle(providerNavigation.shadowRoot.querySelector('.card')).borderRadius : '',
        providerNavigationPadding: providerNavigation?.shadowRoot ? getComputedStyle(providerNavigation.shadowRoot.querySelector('.body')).padding : '',
        providerNavigationContract: providerNavigation?.dataset.icContractStatus,
        navigationH3: navigationHeadings.filter(heading => heading.shadowRoot?.querySelector('h3')).length,
        navigationCount: navigationHeadings.length,
        navigationColors: [...new Set(navigationHeadings.map(heading => getComputedStyle(heading).color))],
        bodyColor: getComputedStyle(document.body).color,
        cardH3: cardHeadings.filter(heading => heading.shadowRoot?.querySelector('h3')).length,
        cardCount: cardHeadings.length,
        cardSubtitles: cardHeadings.filter(heading => !heading.shadowRoot?.querySelector('[part="subtitle"]')?.hidden).length,
        subtitlelessCardHeadings: subtitlelessCardHeadings.map(heading => ({
          id: heading.id,
          combination: heading.dataset.legalCombination,
        })),
        invalid: [pageHeading, ...navigationHeadings, ...cardHeadings].filter(heading => heading?.dataset.icContractStatus === 'invalid').length,
      };
    })()`);
    const hintFieldVariants = await evaluate(cdp, sessionId, `(() => {
      const inspect = id => {
        const field = document.querySelector(id);
        const input = field?.querySelector(':scope > ic-input');
        const hint = input?.shadowRoot?.querySelector('[part="hint"]');
        const style = hint ? getComputedStyle(hint) : null;
        return {
          fieldTag: field?.tagName || '',
          fieldContract: field?.dataset.icContractStatus || '',
          hint: field?.getAttribute('hint') || '',
          inputSlot: input?.getAttribute('slot') || '',
          inputContract: input?.dataset.icContractStatus || '',
          hintStyle: style ? [style.color, style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight, style.letterSpacing].join('|') : '',
        };
      };
      const keyInput = document.querySelector('#keyFormField > #keyInput');
      const action = keyInput?.querySelector(':scope > #testUrlBtn[slot="end"]');
      return {
        name: inspect('#nameFormField'),
        baseUrl: inspect('#baseUrlFormField'),
        key: inspect('#keyFormField'),
        keyActionTag: action?.tagName || '',
        keyActionText: action?.textContent?.trim() || '',
        keyEndAction: keyInput?.hasAttribute('end-action') || false,
      };
    })()`);
    const externalHintStyles = await evaluate(cdp, sessionId, `(() => {
      const signature = element => {
        if (!element) return '';
        const style = getComputedStyle(element);
        return [style.color, style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight, style.letterSpacing].join('|');
      };
      const volcengine = ['#volcArkKeyHint', '#volcAssetKeyHint'].map(selector => signature(document.querySelector(selector)));
      selectProvider('runninghub');
      const runninghub = ['#rhFreeKeyHint', '#rhWalletKeyHint'].map(selector => signature(document.querySelector(selector)));
      selectProvider('modelscope');
      const modelScope = [signature(document.querySelector('.api-key-reference-hint'))];
      selectProvider('volcengine');
      return { volcengine, runninghub, modelScope };
    })()`);
    await evaluate(cdp, sessionId, `selectProvider('long-provider-name')`);
    const savesBefore = await evaluate(cdp, sessionId, `fetch('/api/test/state').then(response => response.json()).then(state => state.saves.length)`);
    await evaluate(cdp, sessionId, `(() => {
      const input = document.querySelector('#baseInput');
      input.value = 'not-a-valid-url';
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
    })()`);
    await waitFor(cdp, sessionId, `autoSaveState.phase === 'invalid'`, 'invalid URL autosave guard');
    const savesAfterInvalid = await evaluate(cdp, sessionId, `fetch('/api/test/state').then(response => response.json()).then(state => state.saves.length)`);
    await evaluate(cdp, sessionId, `(() => {
      const input = document.querySelector('#baseInput');
      input.value = 'https://autosave.example.test/v1';
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
    })()`);
    await waitFor(cdp, sessionId, `autoSaveState.phase === 'saved' && providerVerificationStates.get(selectedId) !== 'verified'`, 'successful URL autosave');
    const savedState = await evaluate(cdp, sessionId, `fetch('/api/test/state').then(response => response.json()).then(state => ({
      saves: state.saves.length,
      baseUrl: state.providers.find(provider => provider.id === 'long-provider-name')?.base_url || ''
    }))`);
    await evaluate(cdp, sessionId, `testConnection()`);
    await waitFor(cdp, sessionId, `autoSaveState.phase === 'saved' && providerVerificationStates.get(selectedId) === 'verified'`, 'verified autosave state');
    await waitFor(cdp, sessionId, `Boolean(document.querySelector('ic-toast[data-ic-overlay]'))`, 'verification toast');
    const autoSaveFlow = {
      savesBefore,
      savesAfterInvalid,
      savesAfterValid: savedState.saves,
      savedBaseUrl: savedState.baseUrl,
      finalState: await evaluate(cdp, sessionId, `providerVerificationStates.get(selectedId) || 'unverified'`),
      hasManualSave: await evaluate(cdp, sessionId, `Boolean(document.querySelector('#saveProvidersBtn'))`),
      hasAutoSaveStatus: await evaluate(cdp, sessionId, `Boolean(document.querySelector('#autoSaveStatus'))`),
      hasRedundantVerifyRow: await evaluate(cdp, sessionId, `Boolean(document.querySelector('.verify-action-row,#verifyResult,#apiTransferPasswordError'))`),
      toastText: await evaluate(cdp, sessionId, `document.querySelector('ic-toast[data-ic-overlay]')?.textContent?.trim() || ''`),
    };
    await evaluate(cdp, sessionId, `(() => {
      requestApiTransferPassword({ title: 'Toast validation', confirmPassword: true });
      document.querySelector('#apiTransferPassword').value = 'short';
      submitApiTransferPassword();
      return true;
    })()`);
    await waitFor(cdp, sessionId, `document.querySelector('ic-toast[data-ic-overlay]')?.textContent?.includes('8')`, 'password validation toast');
    const passwordToastAudit = {
      toastText: await evaluate(cdp, sessionId, `document.querySelector('ic-toast[data-ic-overlay]')?.textContent?.trim() || ''`),
      inlineNotifications: await evaluate(cdp, sessionId, `document.querySelectorAll('ic-alert,#verifyResult,#apiTransferPasswordError').length`),
    };
    await evaluate(cdp, sessionId, `closeApiTransferPassword()`);
    await waitFor(cdp, sessionId, `!document.querySelector('#apiTransferDialog')?.open`, 'API transfer dialog close');
    await evaluate(cdp, sessionId, `fetchModels()`);
    await waitFor(cdp, sessionId, `lastFetchedAll.length > 0`, 'fetched model fixture');
    await evaluate(cdp, sessionId, `openModelPicker()`);
    await waitFor(cdp, sessionId, `document.querySelectorAll('#pickerList ic-checkbox').length === lastFetchedAll.length`, 'semantic model selection table');
    await waitFor(cdp, sessionId, `!document.querySelector('#modelPickerOverlay')?.shadowRoot?.querySelector('[part="dialog"]')?.classList.contains('show')`, 'model picker entrance animation');
    const modelPicker = await evaluate(cdp, sessionId, `(() => {
      const dialog = document.querySelector('#modelPickerOverlay');
      const filters = dialog.querySelector('.model-selection-filters');
      const table = dialog.querySelector('#pickerList');
      const summary = dialog.querySelector('#pickerSummary');
      const search = dialog.querySelector('#pickerFilter');
      const tabs = dialog.querySelector('#pickerCategoryTabs');
      const lastTab = tabs?.querySelector('[role="tab"]:last-child');
      const subtitle = dialog.querySelector('#pickerCount');
      const checkboxes = [...table.querySelectorAll('ic-checkbox')];
      const nativeTable = table.querySelector(':scope > table');
      const dialogSurface = dialog.shadowRoot?.querySelector('[part="dialog"]');
      const dialogHeader = dialog.shadowRoot?.querySelector('[part="header"]');
      const dialogBody = dialog.shadowRoot?.querySelector('[part="body"]');
      const dialogFooter = dialog.shadowRoot?.querySelector('[part="footer"]');
      const dialogStyle = dialogSurface ? getComputedStyle(dialogSurface) : null;
      const headerStyle = dialogHeader ? getComputedStyle(dialogHeader) : null;
      const bodyStyle = dialogBody ? getComputedStyle(dialogBody) : null;
      const footerStyle = dialogFooter ? getComputedStyle(dialogFooter) : null;
      const tabsRect = tabs?.getBoundingClientRect();
      const lastTabRect = lastTab?.getBoundingClientRect();
      const focusRingWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-border-width-strong')) || 0;
      return {
        label: dialog.label,
        titleTag: dialog.shadowRoot?.querySelector('[part="title"]')?.tagName || '',
        legalCombination: dialog.dataset.legalCombination || '',
        subtitleText: subtitle?.textContent?.trim() || '',
        subtitleInLabelSlot: subtitle?.closest('[slot="label"]')?.classList.contains('model-selection-heading') || false,
        searchLabel: search?.label || '',
        searchAriaLabel: search?.getAttribute('aria-label') || '',
        tabsBeforeSearch: Boolean(tabs && search && (tabs.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING)),
        tabsCombination: tabs?.dataset.legalCombination || '',
        tabsFocusInsets: tabsRect && lastTabRect ? {
          top: lastTabRect.top - tabsRect.top,
          right: tabsRect.right - lastTabRect.right,
          bottom: tabsRect.bottom - lastTabRect.bottom,
          left: lastTabRect.left - tabsRect.left,
          required: focusRingWidth,
        } : null,
        tabsFocusRingContained: Boolean(tabsRect && lastTabRect
          && lastTabRect.right + focusRingWidth <= tabsRect.right
          && lastTabRect.top - focusRingWidth >= tabsRect.top
          && lastTabRect.bottom + focusRingWidth <= tabsRect.bottom),
        dialogContract: dialog.dataset.icContractStatus,
        filtersContract: filters.dataset.icContractStatus,
        tableContract: table.dataset.icContractStatus,
        summaryContract: summary.dataset.icContractStatus,
        directTables: table.querySelectorAll(':scope > table').length,
        columns: nativeTable?.querySelectorAll('thead th').length || 0,
        rows: nativeTable?.querySelectorAll('tbody tr').length || 0,
        checkboxContracts: checkboxes.map(item => item.dataset.icContractStatus),
        legacyClasses: dialog.querySelectorAll('.picker-toolbar,.picker-body,.picker-row,.picker-checkbox,.picker-cat-tab,.picker-summary').length,
        nativeCheckboxes: dialog.querySelectorAll('input[type="checkbox"]').length,
        dialogHeight: dialogStyle?.height || '',
        dialogHeightPx: dialogSurface?.getBoundingClientRect().height || 0,
        viewportHeight: innerHeight,
        headerPaddingBlockStart: headerStyle?.paddingBlockStart || '',
        bodyPaddingBlock: bodyStyle ? [bodyStyle.paddingTop, bodyStyle.paddingBottom] : [],
        footerPaddingBlockEnd: footerStyle?.paddingBlockEnd || '',
        bodyOverflow: bodyStyle?.overflow || '',
        tableOverflow: getComputedStyle(table).overflow,
      };
    })()`);
    const selectedBefore = await evaluate(cdp, sessionId, `Object.values(pickerState.selected).filter(Boolean).length`);
    await evaluate(cdp, sessionId, `document.querySelector('#pickerList ic-checkbox').click()`);
    await waitFor(cdp, sessionId, `Object.values(pickerState.selected).filter(Boolean).length !== ${selectedBefore}`, 'model checkbox selection');
    const selectedAfter = await evaluate(cdp, sessionId, `Object.values(pickerState.selected).filter(Boolean).length`);
    await evaluate(cdp, sessionId, `closeModelPicker(); selectProvider('long-provider-name')`);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await evaluate(cdp, sessionId, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const narrowLayout = await evaluate(cdp, sessionId, `(() => {
      const page = document.querySelector('.api-settings-page');
      const layout = document.querySelector('.api-settings-page .layout');
      const navigation = document.querySelector('#providerNavigation');
      const content = document.querySelector('#settingsContent');
      const transferActions = document.querySelector('.api-transfer-actions');
      const modelHeader = document.querySelector('.models-card-header');
      const navigationRect = navigation.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      return {
        viewportWidth: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        pageWidth: page.getBoundingClientRect().width,
        layoutColumns: getComputedStyle(layout).gridTemplateColumns,
        formColumns: getComputedStyle(document.querySelector('.api-settings-page .form')).gridTemplateColumns,
        transferColumns: getComputedStyle(transferActions).gridTemplateColumns,
        modelHeaderDirection: getComputedStyle(modelHeader).flexDirection,
        contentBelowNavigation: contentRect.top >= navigationRect.bottom,
      };
    })()`);
    const darkCliIcons = await evaluate(cdp, sessionId, `(() => {
      document.documentElement.classList.add('studio-theme-dark', 'theme-dark');
      document.body.classList.add('studio-theme-dark');
      return [...document.querySelectorAll('.sidebar-cli-action .provider-platform-icon')].map(icon => ({
        asset: new URL(icon.src).pathname.split('/').pop(),
        monochrome: icon.classList.contains('provider-platform-icon-monochrome'),
        filter: getComputedStyle(icon).filter,
      }));
    })()`);
    const consoleErrors = cdp.events.flatMap(event => {
      if (event.method === 'Runtime.exceptionThrown') return [event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text || 'Runtime exception'];
      if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') return [event.params.args?.map(arg => arg.value || arg.description || '').join(' ') || 'console.error'];
      if (event.method === 'Log.entryAdded' && event.params.entry?.level === 'error') return [event.params.entry.text];
      return [];
    });
    const checks = {
      neutralRegion: providers.every(item => item.regionTag === 'DIV' && item.regionBorder === '0px' && item.regionBackground === 'rgba(0, 0, 0, 0)'),
      oneCard: providers.every(item => item.directCards === 1 && item.nestedCards === 0 && item.nestedChromePanels === 0),
      noOnboardingBadges: providers.every(item => item.badges === 0),
      publicControlsOnly: providers.every(item => item.legacyNativeControls === 0 && item.legacyActionClasses === 0 && item.publicControls > 0 && item.invalidPublicControls === 0),
      volcengineKeyInput: volcengineKeyInput.inputTag === 'IC-INPUT'
        && volcengineKeyInput.inputContract === 'valid'
        && volcengineKeyInput.actionTag === 'IC-BUTTON'
        && volcengineKeyInput.actionContract === 'ready'
        && volcengineKeyInput.actionSlot === 'end'
        && volcengineKeyInput.actionText === '检测地址'
        && volcengineKeyInput.clearTag === 'IC-ICON-BUTTON'
        && volcengineKeyInput.clearContract === 'ready'
        && volcengineKeyInput.clearSlot === 'end'
        && volcengineKeyInput.clearHidden === false
        && volcengineKeyInput.clearBeforeDetect
        && defaultKeyActions.clearHidden === true
        && defaultKeyActions.detectHidden === false
        && defaultKeyActions.detectText === '检测地址',
      headingSemantics: headingSemantics.pageH1 === 1
        && headingSemantics.providerNavigationTag === 'IC-CARD'
        && headingSemantics.providerNavigationSize === 'small'
        && headingSemantics.providerNavigationPadding === '16px'
        && headingSemantics.providerNavigationContract === 'ready'
        && headingSemantics.navigationH3 === 3
        && headingSemantics.navigationCount === 3
        && headingSemantics.navigationColors.length === 1
        && headingSemantics.navigationColors[0] === headingSemantics.bodyColor
        && headingSemantics.cardH3 === headingSemantics.cardCount
        && headingSemantics.cardSubtitles === headingSemantics.cardCount - 1
        && headingSemantics.subtitlelessCardHeadings.length === 1
        && headingSemantics.subtitlelessCardHeadings[0].id === 'modelsTitle'
        && headingSemantics.subtitlelessCardHeadings[0].combination === 'h3-title'
        && headingSemantics.invalid === 0,
      singleNavigationSurface: headingSemantics.providerNavigationBackground === 'rgba(0, 0, 0, 0)'
        && headingSemantics.providerNavigationCardBackground !== 'rgba(0, 0, 0, 0)'
        && headingSemantics.providerNavigationCardRadius !== '0px',
      nativeHintFieldVariants: [hintFieldVariants.name, hintFieldVariants.baseUrl, hintFieldVariants.key].every(field =>
        field.fieldTag === 'IC-FORM-FIELD'
          && field.fieldContract === 'valid'
          && Boolean(field.hint)
          && field.inputSlot === 'control'
          && field.inputContract === 'valid'
      )
        && new Set([hintFieldVariants.name.hintStyle, hintFieldVariants.baseUrl.hintStyle, hintFieldVariants.key.hintStyle]).size === 1
        && hintFieldVariants.keyActionTag === 'IC-BUTTON'
        && Boolean(hintFieldVariants.keyActionText)
        && hintFieldVariants.keyEndAction,
      externalHintStyles: [...externalHintStyles.volcengine, ...externalHintStyles.runninghub, ...externalHintStyles.modelScope]
        .every(signature => signature === hintFieldVariants.key.hintStyle),
      autoSaveFlow: autoSaveFlow.savesAfterInvalid === autoSaveFlow.savesBefore
        && autoSaveFlow.savesAfterValid > autoSaveFlow.savesAfterInvalid
        && autoSaveFlow.savedBaseUrl === 'https://autosave.example.test/v1'
        && autoSaveFlow.finalState === 'verified'
        && autoSaveFlow.hasManualSave === false
        && autoSaveFlow.hasAutoSaveStatus === false
        && autoSaveFlow.hasRedundantVerifyRow === false
        && Boolean(autoSaveFlow.toastText),
      passwordToast: passwordToastAudit.inlineNotifications === 0 && Boolean(passwordToastAudit.toastText),
      modelPickerComponents: modelPicker.dialogContract === 'ready'
        && modelPicker.label === '选择模型'
        && modelPicker.titleTag === 'H2'
        && modelPicker.legalCombination === 'h2-with-subtitle'
        && modelPicker.subtitleText.includes('模型')
        && modelPicker.subtitleText.includes('当前显示')
        && modelPicker.subtitleInLabelSlot
        && modelPicker.searchLabel === ''
        && modelPicker.searchAriaLabel === '按名称搜索模型…'
        && modelPicker.tabsBeforeSearch
        && modelPicker.tabsCombination === 'horizontal-automatic-label'
        && modelPicker.tabsFocusRingContained
        && modelPicker.filtersContract === 'ready'
        && modelPicker.tableContract === 'ready'
        && modelPicker.summaryContract === 'ready'
        && modelPicker.directTables === 1
        && modelPicker.columns === 4
        && modelPicker.rows === modelPicker.checkboxContracts.length
        && modelPicker.checkboxContracts.every(status => status === 'ready')
        && modelPicker.legacyClasses === 0
        && modelPicker.nativeCheckboxes === 0,
      modelPickerBounds: modelPicker.dialogHeightPx > 0
        && modelPicker.dialogHeightPx <= modelPicker.viewportHeight
        && modelPicker.headerPaddingBlockStart === '32px'
        && modelPicker.bodyPaddingBlock.length === 2
        && modelPicker.bodyPaddingBlock[0] === '16px'
        && modelPicker.bodyPaddingBlock[1] === '16px'
        && modelPicker.footerPaddingBlockEnd === '32px'
        && modelPicker.bodyOverflow === 'hidden'
        && modelPicker.tableOverflow === 'auto',
      modelPickerSelection: selectedAfter !== selectedBefore,
      narrowLayout: narrowLayout.viewportWidth === 390
        && narrowLayout.documentWidth <= narrowLayout.viewportWidth
        && narrowLayout.pageWidth <= narrowLayout.viewportWidth
        && narrowLayout.contentBelowNavigation
        && narrowLayout.layoutColumns.split(' ').length === 1
        && narrowLayout.formColumns.split(' ').length === 1
        && narrowLayout.transferColumns.split(' ').length === 1
        && narrowLayout.modelHeaderDirection === 'column',
      darkCliIcons: darkCliIcons.length === 3
        && darkCliIcons.every(icon => icon.monochrome && icon.filter === 'invert(1)'),
      console: consoleErrors.length === 0,
    };
    const report = { providers, defaultKeyActions, volcengineKeyInput, headingSemantics, hintFieldVariants, externalHintStyles, autoSaveFlow, passwordToastAudit, modelPicker, selectedBefore, selectedAfter, narrowLayout, darkCliIcons, consoleErrors, checks };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
  } finally {
    try { if (cdp) await cdp.send('Browser.close'); } catch {}
    if (browser) {
      await waitForExit(browser);
      if (browser.exitCode === null) browser.kill('SIGTERM');
    }
    if (preview.exitCode === null) preview.kill('SIGTERM');
    await waitForExit(preview);
    if (profile.startsWith(`${os.tmpdir()}${path.sep}ic-provider-onboarding-`)) {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
