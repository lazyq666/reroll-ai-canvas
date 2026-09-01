const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.IC_BROWSER_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const NODE_COUNT = 300;
const CONNECTIONS_PER_NODE = 4;
const mimeTypes = {
  '.css':'text/css; charset=utf-8',
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.woff2':'font/woff2',
};

function json(response, value) {
  response.writeHead(200, {
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
  });
  response.end(JSON.stringify(value));
}

function apiPayload(pathname) {
  if(pathname === '/api/auth/me') {
    return {user:{id:'issue-154',username:'reviewer',role:'admin'}};
  }
  if(pathname === '/api/config') {
    return {api_providers:[],available_models:{},comfy_instances:[]};
  }
  if(pathname === '/api/projects') return {projects:[]};
  if(pathname === '/api/workflows') return {workflows:[]};
  if(pathname === '/api/prompt-libraries') return {library:{libraries:[]}};
  if(pathname === '/api/smart-canvas/prompt-templates') return {templates:[]};
  if(pathname.endsWith('/view-state')) return {view_state:null};
  if(pathname === '/api/canvases/issue-154-connection-performance') {
    return {
      canvas:{
        id:'issue-154-connection-performance',
        title:'Issue 154 connection performance',
        project:'default',
        revision:1,
        nodes:[],
        connections:[],
        viewport:{x:0,y:0,scale:1},
        settings:{},
        logs:[],
      },
    };
  }
  return {};
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      if(url.pathname.startsWith('/api/')) {
        json(response, apiPayload(url.pathname));
        return;
      }
      const filePath = path.resolve(ROOT, `.${decodeURIComponent(url.pathname)}`);
      if(filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      fs.readFile(filePath, (error, body) => {
        if(error) {
          response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message);
          return;
        }
        response.writeHead(200, {
          'Content-Type':mimeTypes[path.extname(filePath)] || 'application/octet-stream',
          'Cache-Control':'no-store',
        }).end(body);
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function settleFrames(page, count = 2) {
  await page.evaluate(frameCount => new Promise(resolve => {
    let remaining = frameCount;
    const next = () => {
      remaining -= 1;
      if(remaining <= 0) resolve();
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  }), count);
}

(async () => {
  if(!fs.existsSync(CHROME)) throw new Error(`Chrome not found: ${CHROME}`);
  const server = await startServer();
  const browser = await chromium.launch({headless:true,executablePath:CHROME});
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.stack || error.message));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(
      `${origin}/static/smart-canvas.html?id=issue-154-connection-performance`,
      {waitUntil:'domcontentloaded'},
    );
    await page.waitForFunction(() => (
      typeof render === 'function'
      && typeof refreshConnectionLayer === 'function'
      && window.SmartCanvasModules?.canvasVirtualization
      && canvas?.id === 'issue-154-connection-performance'
      && nodes.length === 0
    ), null, {timeout:30000});

    await page.evaluate(({nodeCount,connectionsPerNode}) => {
      const syntheticNodes = Array.from({length:nodeCount}, (_, index) => ({
        id:`node-${index}`,
        type:'smart-image',
        x:100 + (index % 20) * 300,
        y:100 + Math.floor(index / 20) * 220,
        w:220,
        h:150,
        images:[],
        items:[],
        title:`Node ${index}`,
        created_at:index,
      }));
      const connections = [];
      syntheticNodes.forEach((node, index) => {
        for(let offset = 1; offset <= connectionsPerNode; offset += 1) {
          connections.push({
            from:node.id,
            to:`node-${(index + offset) % nodeCount}`,
            kind:'input',
          });
        }
      });
      canvas = {
        id:'issue-154-connection-performance',
        title:'Issue 154 connection performance',
        nodes:syntheticNodes,
        connections,
        viewport:{x:0,y:0,scale:1},
        settings:{},
        logs:[],
      };
      nodes = canvas.nodes;
      selectedId = '';
      selectedIds = [];
      selectedImage = {nodeId:'',index:-1};
      render();
    }, {nodeCount:NODE_COUNT,connectionsPerNode:CONNECTIONS_PER_NODE});
    await settleFrames(page);

    const report = await page.evaluate(async () => {
      const affectedKey = 'node-0|node-1|input';
      const unrelatedKey = 'node-2|node-3|input';
      const affectedBefore = document.querySelector(
        `[data-connection-key="${affectedKey}"]`,
      );
      const unrelatedBefore = document.querySelector(
        `[data-connection-key="${unrelatedKey}"]`,
      );
      if(!affectedBefore || !unrelatedBefore) {
        throw new Error('Expected visible Connection materializations were not mounted');
      }
      const affectedPathBefore = affectedBefore.querySelector('.conn-line').getAttribute('d');
      const connectionCountBefore = document.querySelectorAll(
        '.connection-materialization',
      ).length;
      let modelLookupVisits = 0;
      let templateCreates = 0;
      let bindingScans = 0;
      const originalFind = Array.prototype.find;
      const originalSome = Array.prototype.some;
      const originalCreateElement = document.createElement.bind(document);
      const originalWorldQuerySelectorAll = world.querySelectorAll.bind(world);
      Array.prototype.find = function(callback, thisArg) {
        if(this !== nodes) return originalFind.call(this, callback, thisArg);
        return originalFind.call(this, (value, index, array) => {
          modelLookupVisits += 1;
          return callback.call(thisArg, value, index, array);
        });
      };
      Array.prototype.some = function(callback, thisArg) {
        if(this !== nodes) return originalSome.call(this, callback, thisArg);
        return originalSome.call(this, (value, index, array) => {
          modelLookupVisits += 1;
          return callback.call(thisArg, value, index, array);
        });
      };
      document.createElement = function(name, options) {
        if(String(name).toLowerCase() === 'template') templateCreates += 1;
        return originalCreateElement(name, options);
      };
      world.querySelectorAll = function(selector) {
        if(selector === '.conn-hit,.conn-cut') bindingScans += 1;
        return originalWorldQuerySelectorAll(selector);
      };
      try {
        nodes[0].x += 64;
        refreshConnectionLayer({nodeIds:['node-0']});
        await new Promise(resolve => requestAnimationFrame(resolve));
        refreshConnectionLayer();
      } finally {
        Array.prototype.find = originalFind;
        Array.prototype.some = originalSome;
        document.createElement = originalCreateElement;
        world.querySelectorAll = originalWorldQuerySelectorAll;
      }
      const affectedAfter = document.querySelector(
        `[data-connection-key="${affectedKey}"]`,
      );
      const unrelatedAfter = document.querySelector(
        `[data-connection-key="${unrelatedKey}"]`,
      );
      return {
        totalNodes:nodes.length,
        totalConnections:canvas.connections.length,
        modelLookupVisits,
        templateCreates,
        bindingScans,
        connectionCountBefore,
        connectionCountAfter:document.querySelectorAll(
          '.connection-materialization',
        ).length,
        affectedIdentityRetained:affectedAfter === affectedBefore,
        unrelatedIdentityRetained:unrelatedAfter === unrelatedBefore,
        affectedPathChanged:affectedAfter?.querySelector('.conn-line')
          ?.getAttribute('d') !== affectedPathBefore,
      };
    });

    assert.equal(report.totalNodes, NODE_COUNT);
    assert.equal(report.totalConnections, NODE_COUNT * CONNECTIONS_PER_NODE);
    assert.equal(report.templateCreates, 0, JSON.stringify(report));
    assert.equal(report.bindingScans, 0, JSON.stringify(report));
    assert.ok(report.modelLookupVisits <= 16, JSON.stringify(report));
    assert.equal(report.affectedIdentityRetained, true, JSON.stringify(report));
    assert.equal(report.unrelatedIdentityRetained, true, JSON.stringify(report));
    assert.equal(report.affectedPathChanged, true, JSON.stringify(report));
    assert.equal(report.connectionCountAfter, report.connectionCountBefore, JSON.stringify(report));
    assert.deepEqual(browserErrors, []);
    console.log(JSON.stringify({passed:true,report}, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
