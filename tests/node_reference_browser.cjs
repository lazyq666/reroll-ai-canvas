/* Real HTTP/SQLite/clipboard regression; native macOS acceptance also uses CUA Chrome. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const child=spawn(path.join(root,'.venv/bin/python'),['tests/node_reference_fixture.py'],{cwd:root,stdio:['ignore','pipe','pipe']});
 let logs='';child.stderr.on('data',d=>logs+=d);
 const config=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error(logs)),15000);child.stdout.on('data',d=>{out+=d;const line=out.split('\n').find(x=>x.startsWith('{"port"'));if(line){clearTimeout(timer);resolve(JSON.parse(line));}});child.on('exit',()=>reject(Error(logs)));});
 const base=`http://127.0.0.1:${config.port}`;
 const browser=await chromium.launch({headless:true,executablePath:process.env.SMART_CANVAS_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
  await context.addCookies([{name:'ic_session',value:config.cookie,url:base}]);
  const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  const open=async(query='')=>{await p.goto(base+'/fixture/canvas?id=canvas-test'+query);await p.waitForFunction(()=>window.SmartCanvasModules?.canvasPersistence?.online());await p.getByRole('button',{name:'重置视图',exact:true}).click();};
  const node=id=>p.locator(`.image-node[data-id="${id}"]`);
  const readClipboard=()=>p.evaluate(()=>navigator.clipboard.readText());
  const ready=()=>p.waitForFunction(()=>!canvasPersistence.status().pending && canvasPersistence.status().state==='ready');
  const copied=async(ids)=>{const expected=`Reroll workspace=reference-workspace canvas=canvas-test nodes=${ids.join(',')}`;let actual;for(let i=0;i<100;i++){actual=await readClipboard();if(actual===expected)return actual;await p.waitForTimeout(100);}console.log(await p.evaluate(()=>({selected:window.SmartCanvasModules.viewportSelection.selection.ids(),sync:canvasPersistence.status(),feedback:smartReferenceFeedback?.key,platform:shortcutPlatform(),key:document.querySelector('#fixture-key').textContent})));assert.equal(actual,expected);};
  const menuCopy=async id=>{await node(id).click({button:'right'});await p.getByRole('button',{name:/^(复制节点引用|Copy node reference)$/}).click();};
  await open();await ready();
  await menuCopy('text');await copied(['text']);
  await node('source-0').click();await node('text').click({modifiers:['Shift']});await menuCopy('source-0');await copied(['source-0','text']);
  for(const [id,target] of [['group',node('group')],['frame',node('frame').locator('.node-title')]]){
   await target.click(id==='group'?{position:{x:8,y:8}}:{});await p.keyboard.press('Meta+l');await copied([id]);
  }
  await node('source-1').locator('[data-image-index="1"]').click();await p.keyboard.press('Meta+l');await copied(['source-1']);
  // New node + delayed persistence + selection change, without a mocked clipboard.
  await p.getByRole('button',{name:'Delay save 3s',exact:true}).click();await node('text').click();await p.keyboard.press('Meta+d');
  const initial=await p.evaluate(()=>window.SmartCanvasModules.viewportSelection.selection.ids());
  await p.keyboard.press('Meta+l');await node('source-0').click();
  await p.waitForFunction(()=>smartReferenceFeedback?.key==='referenceSaving');
  await p.getByRole('button',{name:'EN',exact:true}).click();
  assert.ok(await p.getByText('Saving before copying…',{exact:true}).isVisible());
  await copied(initial);
  await p.locator('#fixture-paste').click();await p.keyboard.press('Meta+v');assert.equal(await p.locator('#fixture-paste').inputValue(),await readClipboard());
  await p.getByRole('button',{name:'Normal save',exact:true}).click();
  // Clipboard denial is enforced by Chrome's Permissions Policy, not a JS stub.
  await p.goto(base+'/fixture/canvas?id=canvas-test&deny_clipboard=1');await p.waitForFunction(()=>window.SmartCanvasModules?.canvasPersistence?.online());
  await node('text').click();await p.keyboard.press('Meta+l');
  await p.waitForFunction(()=>smartReferenceFeedback?.key==='referenceClipboardFailed');
  assert.ok(await p.getByText('Could not write to the clipboard. Try copying again.',{exact:true}).isVisible());
  await p.getByRole('button',{name:'ZH',exact:true}).click();assert.ok(await p.getByText('无法写入剪贴板，请重试复制',{exact:true}).isVisible());
  await open();await menuCopy('text');await copied(['text']);
  // A real delayed mutation exceeds the save timeout; retry after it is acknowledged.
  await fetch(base+'/fixture/control',{method:'POST',headers:{Cookie:'ic_session='+config.cookie,'Content-Type':'application/json'},body:JSON.stringify({delay:7})});
  await node('text').click();await p.keyboard.press('Meta+d');await p.keyboard.press('Meta+l');
  await p.waitForFunction(()=>smartReferenceFeedback?.key==='referenceSaveFailed',{timeout:10000});
  await p.getByRole('button',{name:'EN',exact:true}).click();assert.ok(await p.getByText('Canvas not saved. Check your connection and try copying again.',{exact:true}).isVisible());
  await ready();await menuCopy('text');await copied(['text']);
  // No-selection/input/modal/extra-modifier branches stay unhandled by the feature.
  const attempt=async()=>{await p.keyboard.press('Meta+l');await p.waitForTimeout(50);return p.locator('#fixture-key').innerText();};
  await p.locator('#fixture-paste').click();assert.match(await attempt(),/prevented=false/);
  await p.getByRole('button',{name:'Open dialog',exact:true}).click();await p.getByRole('dialog',{name:'Fixture dialog'}).waitFor({state:'visible'});assert.match(await attempt(),/prevented=false/);await p.keyboard.press('Escape');
  await node('text').click();await p.keyboard.press('Meta+Shift+l');await p.waitForTimeout(50);assert.match(await p.locator('#fixture-key').innerText(),/prevented=false/);
  // Native content copy/paste remains available after the identity-only action.
  await fetch(base+'/fixture/control',{method:'POST',headers:{Cookie:'ic_session='+config.cookie,'Content-Type':'application/json'},body:JSON.stringify({delay:0})});
  const beforePaste=await p.evaluate(()=>nodes.length);await node('text').click();await p.keyboard.press('Meta+c');await p.keyboard.press('Meta+v');
  await p.waitForFunction(count=>nodes.length===count+1,beforePaste);
  for(const lang of ['zh','en'])for(const theme of ['Light','Dark']){
   await p.getByRole('button',{name:lang==='zh'?'ZH':'EN',exact:true}).click();await p.getByRole('button',{name:theme,exact:true}).click();
   await node('source-0').click({button:'right'});
   assert.ok(await p.getByRole('button',{name:lang==='zh'?'复制节点引用':'Copy node reference',exact:true}).isVisible());
   await p.screenshot({path:`/private/tmp/laz90-menu-${lang}-${theme.toLowerCase()}.png`});await p.keyboard.press('Escape');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: full-page real clipboard, multi-selection, containers, output focus, delayed capture, save timeout/retry, policy denial/retry, bilingual feedback/menus, themes, copy/paste');
 }finally{await browser.close();child.kill('SIGINT');}
})().catch(e=>{console.error(e);process.exit(1)});
