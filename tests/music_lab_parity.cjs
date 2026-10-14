// Compare the approved Create Demo and the production page inside the same app shell.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const fixture = spawn(process.execPath, ['tests/music_lab_browser.cjs', '--serve'], {cwd:root, stdio:['ignore','pipe','inherit']});
const basePromise = new Promise((resolve,reject)=>{
 fixture.stdout.on('data', bytes=>{const url=bytes.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url)resolve(url);});
 fixture.on('error',reject);fixture.on('exit',code=>reject(new Error('Fixture exited '+code)));
});
const screenshotDir = '/private/tmp/suno-parity';fs.mkdirSync(screenshotDir,{recursive:true});
const mappings = {
 mode:['.segmented','#composerMode'],
 addTools:['.add-tools','.add-tools'],
 promptCard:['.form-card:has(#prompt)','.prompt-card'],
 prompt:['#prompt','#prompt'],
 styleCard:['.form-card:has(#style)','#styleSection'],
 style:['#style','#style'],
 styleChip:['.style-chip','#styleSuggestion1'],
 advanced:['#advancedOptions','#advancedOptions'],
 create:['#generate','#submitMusic'],
 search:['.search-box','#searchMusic'],
 sort:['#sort','#librarySort'],
 views:['.view-toggle','#libraryLayout'],
 filter:['.library-filters .pill','#libraryFilter [data-value="all"]'],
 list:['.library-scroll','#libraryScroll'],
 track:['.track','.library-track'],
 player:['.player','#musicPlayer'],
};
async function geometry(frame,index){
 const result={};
 for(const [name,selectors] of Object.entries(mappings)) result[name]=await frame.locator(selectors[index]).first().evaluate(el=>{
  const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {top:r.top,height:r.height,width:r.width,radius:parseFloat(s.borderTopLeftRadius),font:s.fontSize,color:s.color,background:s.backgroundColor,inner:(()=>{const n=el.shadowRoot?.querySelector('[part~=base], [part~=combobox]')||el.querySelector('button')||el,c=getComputedStyle(n);return {height:n.getBoundingClientRect().height,radius:c.borderRadius,corner:c.cornerShape,font:c.fontSize,color:c.color,background:c.backgroundColor,padding:c.padding}})()};
 });
 return result;
}
(async()=>{
 const base=await basePromise;
 const browser=await chromium.launch({headless:true,executablePath:process.env.SMART_CANVAS_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const context=await browser.newContext({viewport:{width:1500,height:1050}});
  await context.addInitScript(()=>localStorage.setItem('studio_brand_entry_seen','1'));
  const demo=await context.newPage();
  const liveContext=await browser.newContext({viewport:{width:1500,height:1050}});
  await liveContext.addInitScript(()=>localStorage.setItem('studio_brand_entry_seen','1'));
  const live=await liveContext.newPage();
  await demo.goto(base+'/?prototype=music&variant=B');await live.goto(base+'/?page=music');
  const d=demo.frameLocator('#frame-lab'),l=live.frameLocator('#frame-lab');
  await d.locator('.track').first().waitFor();await l.locator('.library-track').first().waitFor();
  const observed={demo:await geometry(d,0),live:await geometry(l,1)};
  fs.writeFileSync(path.join(screenshotDir,'geometry.json'),JSON.stringify(observed,null,2));
  await demo.screenshot({path:path.join(screenshotDir,'demo-desktop.png'),animations:'disabled'});
  await live.screenshot({path:path.join(screenshotDir,'live-desktop.png'),animations:'disabled'});
  await d.locator('#advancedOptions summary').click();await l.locator('#advancedOptions summary').click();
  await d.locator('#advancedOptions').scrollIntoViewIfNeeded();await l.locator('#advancedOptions').scrollIntoViewIfNeeded();
  await demo.screenshot({path:path.join(screenshotDir,'demo-advanced.png'),animations:'disabled'});
  await live.screenshot({path:path.join(screenshotDir,'live-advanced.png'),animations:'disabled'});
  await d.locator('[data-action="mode:simple"]').click();await l.locator('#composerMode [data-value="simple"]').click();
  const simple={demo:await d.locator('#advancedOptions').count(),live:await l.locator('#advancedOptions').isVisible()};
  const differences=[];
  for(const [key,fields] of Object.entries({mode:['height'],promptCard:['top','height','radius'],styleCard:['top','height','radius'],create:['height'],search:['height'],sort:['height'],views:['height'],filter:['height'],player:['height']})){
   for(const field of fields) if(Math.abs(observed.demo[key][field]-observed.live[key][field])>4) differences.push(`${key}.${field}: Demo ${observed.demo[key][field]}, page ${observed.live[key][field]}`);
  }
  if(simple.live)differences.push('Simple mode still shows More options, unlike the Demo');
  assert.deepEqual(differences,[],'The whole page must match the approved Demo layout and mode behavior');
  // Compare the rendered controls, not just custom-element host rectangles.
  for(const key of ['mode','create','search','filter','styleChip']) {
   const inner=observed.live[key].inner;
   assert.ok(parseFloat(inner.radius)>=inner.height/2,`${key} uses the approved pill silhouette`);
   assert.equal(inner.corner,'superellipse(1)',`${key} keeps round ends`);
  }
  await l.locator('#composerMode [data-value="detailed"]').click();
  await d.locator('[data-action="mode:advanced"]').click();
  await l.locator('#resetDraft').click();
  await l.locator('#styleSuggestion1').click();await l.locator('#styleSuggestion1').click();
  const chip=await l.locator('#styleSuggestion1 > span').innerText();
  assert.equal(await l.locator('#style').evaluate(el=>el.value),chip,'Repeated style shortcuts do not duplicate a tag');
  await l.locator('#lyricsMode').getByRole('combobox').press('ArrowDown');
  await l.locator('#lyricsMode').getByRole('option',{name:'自填歌词',exact:true}).click();
  await l.locator('#examplePrompt').click();const example=await l.locator('#prompt').evaluate(el=>el.value);
  await l.locator('#examplePrompt').click();
  assert.notEqual(await l.locator('#prompt').evaluate(el=>el.value),example,'Examples cycle');
  assert.equal(await l.locator('#musicType').evaluate(el=>el.checked),false,'Examples preserve vocal intent');
  assert.equal(await l.locator('#lyricsMode').evaluate(el=>el.value),'manual','Examples preserve lyrics mode');
  await l.locator('#chooseReferences').click();await l.locator('#referenceDialog dialog').waitFor({state:'visible'});await l.locator('#browseReferences').focus();
  await live.keyboard.press('Escape');await l.locator('#referenceDialog dialog').waitFor({state:'hidden'});
  await l.locator('#advancedOptions summary').click();
  await l.locator('#overrideWeights').getByRole('checkbox').press('Space');
  await l.locator('#weirdness').getByRole('slider').press('End');
  assert.equal(await l.locator('#weirdnessValue').innerText(),'100%');
  await l.locator('#inlinePersona input').fill('my-persona');await l.locator('#openPersona').click();
  assert.equal(await l.locator('#persona').evaluate(el=>el.value),'my-persona','Both Persona entry points share one draft');
  await live.keyboard.press('Escape');await l.locator('#personaDialog dialog').waitFor({state:'hidden'});
  await l.locator('#resetDraft').click();
  await l.locator('#togglePlayback').click();
  assert.match(await l.locator('#playerAudio').getAttribute('src'),/preview-0\/audio\/0$/,'Idle Play starts the first available song');
  await l.locator('#playerAudio').evaluate(a=>{a.loop=true;a.pause();});
  await l.locator('#previousTrack').click();
  await live.waitForFunction(()=>document.querySelector('#frame-lab').contentDocument.getElementById('playerAudio').getAttribute('src').endsWith('/preview-3/audio/1'));
  await l.locator('#playerAudio').evaluate(a=>a.pause());
  await l.locator('#searchMusic input').fill('夜航 II');
  assert.equal(await l.locator('.library-track').count(),1,'Search filters individual songs while preserving their source indices');
  await l.locator('#searchMusic input').fill('no matching result');
  await l.locator('#clearMusicFilters').click();assert.equal(await l.locator('.library-track').count(),8);
  await l.locator('.library-track .track-more').nth(1).click();
  assert.equal(await l.locator('.song-detail h2').innerText(),'夜航 II');
  await d.locator('[data-action="detail:sample-1"]').first().click();
  await l.locator('#recordDialog[data-motion-state="open"]').waitFor({state:'attached'});
  const modalWidths=await Promise.all([d.locator('#demoDialog').evaluate(el=>el.getBoundingClientRect().width),l.locator('#recordDialog dialog').evaluate(el=>el.getBoundingClientRect().width)]);
  assert.ok(Math.abs(modalWidths[0]-modalWidths[1])<5,'Song details retain the Demo compact dialog width: '+modalWidths.join('/'));
  await demo.keyboard.press('Escape');
  await live.screenshot({path:path.join(screenshotDir,'live-song-detail.png'),animations:'disabled'});
  await live.keyboard.press('Escape');await l.locator('#recordDialog dialog').waitFor({state:'hidden'});
  await l.locator('.library-track').first().getByRole('button',{name:'下载',exact:true}).click();
  assert.equal(await l.locator('.download-row').count(),3);
  assert.equal(await l.locator('.download-row[data-format="wav"]').getByRole('button',{name:'下载',exact:true}).isEnabled(),true);
  await live.screenshot({path:path.join(screenshotDir,'live-download.png'),animations:'disabled'});
  await live.keyboard.press('Escape');await l.locator('#downloadDialog dialog').waitFor({state:'hidden'});
  // Responsive geometry, both themes/languages, list/grid and hidden composer fields.
  for(const [width,lang,theme] of [[1800,'zh-CN','light'],[1200,'en','dark'],[390,'en','dark'],[1500,'zh-CN','light']]) {
   for(const page of [demo,live]) {
    await page.setViewportSize({width,height:width===390?844:1050});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    if(await page.frameLocator('#frame-lab').locator('html').getAttribute('lang')!==lang) await page.locator('#lang-toggle-btn').click();
    if(await page.frameLocator('#frame-lab').locator('html').getAttribute('data-ui-theme')!==theme) await page.locator('#theme-toggle-btn').click();
   }
   await l.locator(`html[lang="${lang}"][data-ui-theme="${theme}"]`).waitFor();
   await d.locator(`html[lang="${lang}"][data-ui-theme="${theme}"]`).waitFor();
   assert.equal(await l.locator('#sunoWorkbench').evaluate(el=>getComputedStyle(el).backgroundColor),await d.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'Workbench surface matches the Demo in each theme');
   await live.mouse.move(900,30);await live.screenshot({path:path.join(screenshotDir,`live-${width}-${theme}.png`),animations:'disabled'});
   await demo.screenshot({path:path.join(screenshotDir,`demo-${width}-${theme}.png`),animations:'disabled'});
   const layout=await l.locator('#sunoWorkbench').evaluate(el=>({overflow:el.scrollWidth>el.clientWidth,invalid:[...el.querySelectorAll('[data-ic-contract-status="invalid"]')].map(x=>[x.id,x.dataset.icContractReason])}));
   assert.equal(layout.overflow,false,`${width}px has no horizontal overflow`);assert.deepEqual(layout.invalid,[],'All composed public controls satisfy their contracts');
   if(width===390) {
    await l.locator('#musicView ic-radio[value="library"]').click();await d.locator('[data-action="nav:library"]').click();
    await l.locator('#libraryLayout [data-value="grid"]').click();await d.locator('[data-action="view:grid"]').click();
    await live.mouse.move(380,80);await live.screenshot({path:path.join(screenshotDir,'live-narrow-grid.png'),animations:'disabled'});
    await demo.screenshot({path:path.join(screenshotDir,'demo-narrow-grid.png'),animations:'disabled'});
    assert.equal(await l.locator('#libraryView').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await l.locator('#libraryLayout [data-value="list"]').click();await d.locator('[data-action="view:list"]').click();
    await l.locator('#musicView ic-radio[value="create"]').click();await d.locator('[data-action="nav:create"]').click();
   }
  }
  // A generation accepted by the fixture must immediately be visible despite old filters.
  await l.locator('#libraryFilter [data-value="session"]').click();await l.locator('#searchMusic input').fill('hidden by old query');
  await l.locator('#prompt textarea').fill('Visible new music');await l.locator('#submitMusic').click();
  await l.locator('.music-record[data-state="running"]').waitFor();
  assert.equal(await l.locator('#searchMusic').evaluate(el=>el.value),'');
  assert.equal(await l.locator('#libraryFilter [data-value="all"]').evaluate(el=>el.pressed),true);
  assert.equal(await l.locator('#libraryScroll').evaluate(el=>el.scrollTop),0);
  console.log(JSON.stringify({differences,observed,parity:'PASS'},null,2));
 }finally{await browser.close();fixture.kill();}
})().catch(error=>{console.error(error);fixture.kill();process.exitCode=1;});
