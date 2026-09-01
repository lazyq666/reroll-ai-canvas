const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = {
  '.css':'text/css; charset=utf-8',
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.svg':'image/svg+xml',
};

function startServer(){
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestPath = decodeURIComponent(
        new URL(request.url, 'http://127.0.0.1').pathname,
      );
      const filePath = path.resolve(ROOT, `.${requestPath}`);
      if(filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)){
        response.writeHead(403).end('Forbidden');
        return;
      }
      fs.readFile(filePath, (error, body) => {
        if(error){
          response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
          return;
        }
        response.writeHead(200, {
          'Content-Type':MIME[path.extname(filePath)] || 'application/octet-stream',
        }).end(body);
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  if(!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  const server = await startServer();
  const browser = await chromium.launch({headless:true, executablePath:CHROME});
  const context = await browser.newContext({viewport:{width:1180,height:760}});
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.stack || error.message));
  page.on('console', message => {
    if(message.type() === 'error') browserErrors.push(message.text());
  });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(
      `${origin}/static/smart-canvas.html?id=transparent-png-composer-browser`,
      {waitUntil:'domcontentloaded'},
    );
    await page.waitForFunction(() => typeof renderDynamicParams === 'function');
    await page.evaluate(() => {
      const node = {
        id:'transparent-settings-node',
        type:'smart-image',
        x:360,
        y:220,
        w:320,
        h:220,
        images:[],
        generationOutputNode:true,
        title:'Transparent PNG settings',
      };
      canvas = {
        id:'transparent-png-composer-browser',
        title:'Transparent PNG',
        nodes:[node],
        connections:[],
        viewport:{x:0,y:0,scale:1},
        settings:{},
        logs:[],
      };
      nodes = canvas.nodes;
      selectedId = node.id;
      selectedIds = [];
      selectedImage = {nodeId:'',index:-1};
      render();
      renderDynamicParams();
    });
    await page.waitForFunction(
      () => document.querySelector(
        '#dynamicParams ic-generation-settings-picker[data-smart-generation-settings]',
      )?.dataset.icContractStatus === 'ready',
      null,
      {timeout:30000},
    ).catch(async error => {
      const state = await page.evaluate(() => ({
        location:location.href,
        readyState:document.readyState,
        params:document.querySelector('#dynamicParams')?.innerHTML,
        composerClass:document.querySelector('#composer')?.className,
        renderType:typeof renderDynamicParams,
      }));
      throw new Error(
        `${error.message}\nstate=${JSON.stringify(state)}\nbrowserErrors=${JSON.stringify(browserErrors)}`,
      );
    });

    await page.evaluate(() => {
      const selection = smartImageCapabilitySelection('');
      const current = smartCurrentImageCapability('');
      smartImageCapabilityCache.set(
        smartImageCapabilityKey(selection.providerId, selection.modelId),
        smartImageCapabilityClean({
          ...current,
          provider_id:selection.providerId,
          model_id:selection.modelId,
          known:true,
          supports_transparent_png:true,
        }, selection.providerId, selection.modelId),
      );
      renderDynamicParams();
    });

    const visible = await page.locator(
      '#dynamicParams ic-switch[name="transparent-png"]',
    ).evaluate(control => {
      const token = document.createElement('span');
      token.style.fontSize = 'var(--ui-font-size-2)';
      document.body.append(token);
      const result = {
        label:control.getAttribute('label'),
        size:control.getAttribute('size'),
        fontSize:getComputedStyle(control).fontSize,
        tokenFontSize:getComputedStyle(token).fontSize,
      };
      token.remove();
      return result;
    });
    assert.deepEqual(visible, {
      label:'透明 PNG',
      size:'s',
      fontSize:'12px',
      tokenFontSize:'12px',
    });

    const stored = await page.locator(
      '#dynamicParams ic-switch[name="transparent-png"]',
    ).evaluate(control => {
      control.checked = true;
      control.dispatchEvent(new Event('change', {bubbles:true}));
      return settings.transparentPng;
    });
    assert.equal(stored, true);

    const defaultsAndLogIdentity = await page.evaluate(() => {
      const freshNode = {
        id:'fresh-transparent-default-node',
        type:'smart-image',
        images:[],
      };
      const freshSettings = smartSettingsForNode(freshNode);
      const revisitedSettings = smartSettingsForNode({
        ...freshNode,
        id:'revisited-transparent-node',
        runSettings:{transparentPng:true},
      });
      availableModels.image = [{
        id:'codex:gpt-image-2',
        provider_id:'codex',
        provider_name:'Codex CLI',
        model:'gpt-image-2',
        name:'gpt-image-2-cli',
      }];
      canvas.logs = [];
      const entry = addSmartGenerationLog({
        run:{
          generationRunId:'gpt-image-2-cli-log-run',
          nodeId:freshNode.id,
          nodeType:freshNode.type,
          kind:'image',
          settings:{
            ...freshSettings,
            engine:'api',
            apiKind:'image',
            provider_id:'codex',
            model:'gpt-image-2',
          },
          prompt:'transparent icon',
        },
        outputs:['/assets/output/gpt-image-2-cli.png'],
      });
      return {
        freshTransparentPng:freshSettings.transparentPng,
        revisitedTransparentPng:revisitedSettings.transparentPng,
        displayedModel:entry.model,
        requestedModel:entry.request.model,
      };
    });
    assert.deepEqual(defaultsAndLogIdentity, {
      freshTransparentPng:false,
      revisitedTransparentPng:true,
      displayedModel:'gpt-image-2-cli',
      requestedModel:'gpt-image-2',
    });

    const hiddenForUnsupportedModel = await page.evaluate(() => {
      const selection = smartImageCapabilitySelection('');
      const current = smartCurrentImageCapability('');
      smartImageCapabilityCache.set(
        smartImageCapabilityKey(selection.providerId, selection.modelId),
        {...current, supports_transparent_png:false},
      );
      renderDynamicParams();
      return !document.querySelector(
        '#dynamicParams ic-switch[name="transparent-png"]',
      );
    });
    assert.equal(hiddenForUnsupportedModel, true);

    await page.evaluate(() => {
      canvas.logs = [{
        id:'reconciled-log-id',
        generationRunId:'stable-transparent-run',
        status:'failed',
        platform:'gpt-image-2-cli',
        model:'gpt-image-2',
        error:'GPT Image 2 Skill 调用失败：codex/生成纯色底图: HTTP 400；Unsupported image_generation option: tools[0].background',
        errorDetail:{
          technicalError:'GPT Image 2 Skill 调用失败：codex/生成纯色底图: HTTP 400；Unsupported image_generation option: tools[0].background',
          httpStatus:502,
          providerId:'gpt-image-2-cli',
        },
        tasks:[],
        outputs:[],
      }];
      toast('HTTP 400', {
        persistent:true,
        heading:'图片生成失败',
        detailLogId:'stale-pre-reconciliation-log-id',
        detailRunId:'stable-transparent-run',
      });
    });
    await page.locator('[data-generation-failure-queue] ic-alert[data-ic-stack-index="0"]').evaluate(control => {
      control.shadowRoot.querySelector('.action').click();
    });
    await page.waitForFunction(() => document.querySelector(
      '#smartLogList [data-generation-run-id="stable-transparent-run"]',
    )?.classList.contains('is-focused-target'));
    const failureDetail = await page.locator(
      '#smartLogList [data-generation-log-selected-detail][data-generation-run-id="stable-transparent-run"]',
    ).evaluate(item => ({
      modalOpen:document.querySelector('#smartLogModal').hasAttribute('open'),
      focused:document.querySelector('#smartLogList [data-generation-run-id="stable-transparent-run"]')?.classList.contains('is-focused-target') || false,
      technicalError:item.querySelector('.generation-log-technical pre')?.textContent || '',
    }));
    assert.equal(failureDetail.modalOpen, true);
    assert.equal(failureDetail.focused, true);
    assert.match(failureDetail.technicalError, /Unsupported image_generation option/);
    process.stdout.write('Transparent PNG Composer browser smoke passed.\n');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
