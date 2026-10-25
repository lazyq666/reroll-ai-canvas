// Real Lab and App Shell pages with deterministic API fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const records = []; const submissions = []; let configured = true, failHistory = false, failExport = false, paidExports = 0, startupStatus = process.argv.includes('--missing-service') ? 404 : 200;
const deletions = [], deletedRecords = new Set(); let failDelete = false, holdNextHistory = null, holdNextDeletion = null;
const audioBytes = Buffer.alloc(44 + 16000); audioBytes.write('RIFF'); audioBytes.writeUInt32LE(audioBytes.length-8,4); audioBytes.write('WAVEfmt ',8); audioBytes.writeUInt32LE(16,16); audioBytes.writeUInt16LE(1,20); audioBytes.writeUInt16LE(1,22); audioBytes.writeUInt32LE(8000,24); audioBytes.writeUInt32LE(16000,28); audioBytes.writeUInt16LE(2,32); audioBytes.writeUInt16LE(16,34); audioBytes.write('data',36); audioBytes.writeUInt32LE(16000,40);
function json(res,code,value){res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}
function completed(record) { record.status='succeeded'; record.result={credits_cost:.5,items:[{kind:'audio',audio_id:'a1',audio_index:1,title:'Rain <script>alert(1)</script>',lyrics:'雨落在窗边\nA quiet night',duration:10.3,image_url:'/assets/test-cover-1.svg',image_large_url:'/assets/test-cover-large-1.svg',url:'/assets/output/a.wav',format:'wav'},{kind:'audio',audio_id:'a2',audio_index:2,title:'Second take',image_url:'/assets/test-cover-missing.png',url:'/assets/output/b.wav',format:'wav'}]}; }
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'), pathname=url.pathname;
 if(['/assets/test-cover-1.svg','/assets/test-cover-large-1.svg','/assets/test-cover-2.svg'].includes(pathname)) {
  res.writeHead(200,{'Content-Type':'image/svg+xml'});return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="'+(pathname.includes('2')?'#7f5363':'#536d82')+'"/><circle cx="50" cy="45" r="25" fill="#e0d3b2"/></svg>');
 }
 if(pathname==='/api/auth/me') return json(res,200,{user:{id:'designer',username:'designer',display_name:'Test designer',role:'designer',status:'active'}});
 if(pathname==='/api/app-info') return json(res,200,{version:'test'});
 if(pathname==='/api/admin/cli-updates') return json(res,200,{items:[],notification_items:[],checking:false});
 if(pathname==='/api/workspace-storage-settings') return json(res,200,{active:{workspace_directory:'/test'},configured:{}});
 if(['/api/music/config','/api/music/history'].includes(pathname) && startupStatus !== 200) return json(res,startupStatus,{detail:'Not Found'});
 if(pathname==='/api/music/config') return json(res,200,{providers:configured?[{id:'apimart',name:'APIMart'}]:[],versions:['v6','v6-wild','v6-mini'],formats:['mp3','m4a','wav']});
 if(pathname==='/api/music/history') {
  const result=failHistory?{}:{items:structuredClone(records),next_cursor:''};
  if(holdNextHistory){const hold=holdNextHistory;holdNextHistory=null;await new Promise(resolve=>hold(resolve));}
  return json(res,failHistory?503:200,result);
 }
 if(pathname.startsWith('/api/music/')){
  let body='';for await(const chunk of req)body+=chunk;
  const multipart=req.headers['content-type']?.startsWith('multipart/form-data');
  const encoded=multipart?body.match(/name="payload"\r\n\r\n([^\r]+)/)?.[1]:body;
  const data=encoded?JSON.parse(encoded):{};
  if(pathname.endsWith('/generations')||pathname.endsWith('/inspirations')||pathname.endsWith('/covers')){
   submissions.push({pathname,data});
   const record={id:'run-'+(records.length+1),status:'running',operation:pathname.endsWith('/inspirations')?'inspo':pathname.endsWith('/covers')?'cover':'generate',created_at:Date.now()/1000,provider_id:'apimart',params:data.settings||{audioFilePath:data.audio_url},error_code:'',result:null};if(['inspo','cover'].includes(record.operation)) record.references=data.references.map((ref,index)=>({name:'reference-'+index+'.wav',size:audioBytes.length,url:'/api/music/runs/'+record.id+'/references/'+index}));
   records.unshift(record);return json(res,202,record);
  }
  const rid=pathname.split('/')[4], record=records.find(item=>item.id===rid);
  if(req.method==='DELETE'&&pathname==='/api/music/runs/'+rid){
   deletions.push(rid);
   if(holdNextDeletion){const hold=holdNextDeletion;holdNextDeletion=null;await new Promise(resolve=>hold(resolve));}
   if(failDelete)return json(res,409,{detail:{code:'music.deleteFilesFailed'}});
   if(deletedRecords.has(rid))return json(res,200,{deleted:true,file_count:0,retained_count:0});
   if(!record)return json(res,404,{detail:{code:'music.notFound'}});
   if(record.status!=='failed')return json(res,409,{detail:{code:'music.cannotDelete'}});
   records.splice(records.indexOf(record),1);deletedRecords.add(rid);
   return json(res,200,{deleted:true,file_count:1,retained_count:1});
  }
  if(pathname.endsWith('/downloads')){
   if(failExport) return json(res,403,{detail:{code:'music.credentialsRejected'}});
   let output=records.find(item=>item.source_run_id===rid);
   if(!output){paidExports++;output={id:'export-'+paidExports,status:'succeeded',operation:'download',created_at:Date.now()/1000,params:{formats:data.formats,audio_index:data.audio_index},source_run_id:rid,result:{items:data.formats.map((format,i)=>({kind:'audio',format,audio_index:i+1,url:'/assets/output/export.wav'}))}};records.unshift(output);}
   return json(res,202,output);
  }
  if((pathname.includes('/audio/')||pathname.includes('/references/'))){
   const range=req.headers.range?.match(/bytes=(\d+)-(\d*)/),start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),audioBytes.length-1):audioBytes.length-1;
   res.writeHead(range?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${audioBytes.length}`} : {}),'Content-Disposition':url.searchParams.has('download')?'attachment; filename="Suno.wav"':'inline'});return res.end(audioBytes.subarray(start,end+1));
  }
  if(record)return json(res,200,record);return json(res,404,{});
 }
 if(pathname==='/static/canvas-list.html') {res.writeHead(200,{'Content-Type':'text/html'});return res.end('<p>Canvas fixture</p>');}
 const asset=pathname==='/static/lab.html'&&url.searchParams.get('prototype')==='music'&&url.searchParams.get('variant')==='B'
  ?'/static/music-create-prototype.html':pathname==='/'||pathname==='/studio'?'/static/index.html':decodeURIComponent(pathname);
 const file=path.resolve(root,'.'+asset);
 if(!file.startsWith(root+path.sep)) return res.writeHead(403).end();
 try{const content=fs.readFileSync(file);res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'}[path.extname(file)]||'application/octet-stream'});res.end(content);}catch(_){res.writeHead(404).end();}
});
async function assertComposerLayout(frame) {
 const layout=await frame.locator('#createView').evaluate(root=>{
  const rect=selector=>{const r=root.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  return {width:root.getBoundingClientRect().width,heading:rect('.composer-title'),tools:[...root.querySelectorAll('.add-tools > *')].map(el=>el.getBoundingClientRect().width),lyrics:rect('#lyricsMode'),type:rect('#musicType'),prompt:rect('#prompt'),titleSize:getComputedStyle(root.querySelector('h1')).fontSize};
 });
 console.log('Create composer geometry:',JSON.stringify(layout));
 assert.equal(layout.width,400,'Demo uses a 400px composer at the standard desktop breakpoint');
 assert.equal(layout.heading.height,61,'Composer title aligns with the workspace title');
 assert.ok(Math.abs((layout.lyrics.top+layout.lyrics.bottom)/2-(layout.type.top+layout.type.bottom)/2)<=2,'Lyrics source and instrumental control share one row');
 assert.ok(layout.prompt.top>layout.lyrics.bottom,'Prompt follows its compact control row');
 assert.equal(layout.titleSize,'15px','Composer heading follows the Demo type scale');
 assert.ok(Math.max(...layout.tools)-Math.min(...layout.tools)<2,'Three add tools have equal widths');
 assert.equal(await frame.locator('#lyricsMode').evaluate(el=>el.localName),'ic-select');
 assert.equal(await frame.locator('#musicType').evaluate(el=>el.localName),'ic-checkbox');
 assert.equal(await frame.locator('#prompt').getAttribute('appearance'),'plain','The card supplies the input surface');
 assert.equal(await frame.locator('#promptHeading').count(),1,'A single heading labels the prompt card');
 assert.equal(await frame.locator('#resetDraft').isVisible(),true,'Draft reset sits beside Generate');
}
async function assertMediaControls(frame, page) {
 const playerHeight=await frame.locator('#musicPlayer').evaluate(el=>el.getBoundingClientRect().height);
 console.log('Create player height:',playerHeight);
 assert.equal(playerHeight,82,'The shared player follows the compact 82px Demo bar');
 await frame.locator('#referenceFiles').setInputFiles({name:'reference.wav',mimeType:'audio/wav',buffer:audioBytes});
 const boxHeight=await frame.locator('#referenceFields').evaluate(el=>el.getBoundingClientRect().height);
 console.log('Create reference card height:',boxHeight);
 assert.ok(boxHeight<=220,'One reference stays in a compact card without a redundant upload placeholder');
 assert.equal(await frame.locator('#referenceMode').evaluate(el=>el.localName),'ic-segmented-control');
 assert.equal(await frame.locator('#referenceMode').getAttribute('size'),'large');
 assert.equal(await frame.locator('#referenceList audio[controls]').count(),0,'Reference preview uses the shared player');
 await frame.locator('#referenceList [data-reference-play]').click();
 await frame.locator('#playerProgress:not([disabled])').waitFor();
 await frame.locator('#playerAudio').evaluate(a=>a.pause());
 assert.match(await frame.locator('#nowPlaying').innerText(),/reference.wav/);
 assert.match(await frame.locator('#playerAudio').getAttribute('src'),/^blob:/);
 const seekBox=await frame.locator('#playerProgress').getByRole('slider').boundingBox();
 await page.mouse.move(seekBox.x+8,seekBox.y+seekBox.height/2);
 await page.mouse.down();await page.mouse.move(seekBox.x+seekBox.width*.6,seekBox.y+seekBox.height/2);await page.mouse.up();
 await page.waitForFunction(()=>{const a=document.querySelector('#frame-lab').contentDocument.getElementById('playerAudio');return !a.seeking;});
 const draggedTime=await frame.locator('#playerAudio').evaluate(a=>a.currentTime);
 assert.ok(draggedTime>.5&&draggedTime<.7,`Pointer drag seeks within the reference (actual ${draggedTime})`);
 await frame.locator('#playerProgress').getByRole('slider').press('End');
 assert.ok(await frame.locator('#playerAudio').evaluate(a=>a.currentTime>=.9),'Keyboard seek reaches the reference end');
 await frame.locator('#mutePlayback').click();
 assert.equal(await frame.locator('#playerAudio').evaluate(a=>a.muted),true);
 await frame.locator('#playerVolume').getByRole('slider').press('Home');
 await frame.locator('#playerVolume').getByRole('slider').press('ArrowRight');
 assert.equal(await frame.locator('#playerAudio').evaluate(a=>a.volume),.01);
 assert.equal(await frame.locator('#playerAudio').evaluate(a=>a.muted),false,'Adjusting volume restores audible output');
 await page.locator('#lang-toggle-btn').click();
 await frame.locator('html[lang="en"]').waitFor();
 assert.equal(await frame.locator('#playerAudio').evaluate(a=>a.currentTime>=.9),true,'Language changes preserve reference playback position');
 await page.screenshot({path:'/private/tmp/suno-media-desktop.png',animations:'disabled'});
 await frame.locator('#referenceFiles').setInputFiles({name:'second.wav',mimeType:'audio/wav',buffer:audioBytes});
 await frame.locator('#nextTrack').click();
 await frame.locator('#playerAudio').evaluate(a=>a.pause());
 assert.match(await frame.locator('#nowPlaying').innerText(),/second.wav/);
 await frame.locator('#previousTrack').click();
 await frame.locator('#playerAudio').evaluate(a=>a.pause());
 await frame.locator('#referenceList [data-reference-remove]').last().click();
 assert.match(await frame.locator('#nowPlaying').innerText(),/reference.wav/,'Removing another reference preserves the selected source');
 await page.locator('#theme-toggle-btn').click();
 await frame.locator('html[data-ui-theme="dark"]').waitFor();
 await page.screenshot({path:'/private/tmp/suno-media-dark.png',animations:'disabled'});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await frame.locator('#musicPlayer').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'The compact player fits a narrow viewport');
 await page.screenshot({path:'/private/tmp/suno-media-narrow.png',animations:'disabled'});
 await page.setViewportSize({width:1500,height:1050});
 await page.locator('#theme-toggle-btn').click();
 await frame.locator('html[data-ui-theme="light"]').waitFor();
 await page.locator('#lang-toggle-btn').click();
 await frame.locator('html[lang="zh-CN"]').waitFor();
 await frame.locator('#playerProgress').getByRole('slider').press('Home');
 await page.screenshot({path:'/private/tmp/suno-media-final.png',animations:'disabled'});
 await frame.locator('#referenceList [data-reference-remove]').click();
 assert.equal(await frame.locator('#playerAudio').getAttribute('src'),null,'Removing the active local reference releases the player source');
 assert.equal(await frame.locator('#togglePlayback').evaluate(el=>el.disabled),await frame.locator('#historyList [data-play-key]').count()===0);
 assert.equal(submissions.length,0,'Preview, seek and removal never submit a paid request');
}
async function assertDraftControls(frame, page) {
 await frame.locator('#prompt textarea').fill('A quiet night');
 await frame.locator('#style textarea').fill('Ambient piano');
 await frame.locator('#songTitle input').fill('Night');
 await frame.locator('#lyricsMode').getByRole('combobox').press('ArrowDown');
 await frame.locator('#lyricsMode').getByRole('option',{name:'自填歌词',exact:true}).click();
 await frame.locator('#musicType').getByRole('checkbox').press('Space');
 assert.equal(await frame.locator('#promptHeading').innerText(),'音乐描述');
 assert.equal(await frame.locator('#lyricsMode').isVisible(),true);assert.equal(await frame.locator('#lyricsMode').evaluate(el=>el.disabled),true);
 await frame.locator('#composerMode [data-value="simple"]').click();
 await frame.locator('#composerMode [data-value="detailed"]').click();
 assert.equal(await frame.locator('#style').evaluate(el=>el.value),'Ambient piano');
 await page.locator('#lang-toggle-btn').click();
 await frame.getByRole('heading',{name:'Music description',exact:true}).waitFor();
 assert.equal(await frame.locator('#prompt textarea').getAttribute('aria-label'),'Music description');
 assert.equal(await frame.locator('#musicType').getAttribute('label'),'Instrumental');
 await frame.locator('#resetDraft').click();
 assert.equal(await frame.locator('#prompt').evaluate(el=>el.value),'');
 assert.equal(await frame.locator('#style').evaluate(el=>el.value),'');
 assert.equal(await frame.locator('#songTitle').evaluate(el=>el.value),'');
 assert.equal(await frame.locator('#lyricsMode').evaluate(el=>el.value),'automatic');
 assert.equal(await frame.locator('#musicType').evaluate(el=>el.checked),false);
 assert.equal(await frame.locator('#styleCount').innerText(),'0 / 1000');
 assert.equal(submissions.length,0,'Editing and clearing the draft never submits a paid request');
 await page.locator('#lang-toggle-btn').click();
 await frame.getByRole('heading',{name:'歌曲主题',exact:true}).waitFor();
}
async function assertCreateLibraryLayout(frame) {
 const positions=await frame.locator('#libraryView').evaluate(root=>{
  const rect=selector=>{const r=root.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,width:r.width};};
  return {search:rect('#searchMusic'),sort:rect('#librarySort'),view:rect('#libraryLayout'),filters:rect('.library-filters'),favorite:rect('#favoriteFilter'),list:rect('#libraryScroll'),track:rect('.library-track'),art:rect('.library-track .track-artwork')};
 });
 console.log('Create library geometry:',JSON.stringify(positions));
 const middle=r=>(r.top+r.bottom)/2;
 assert.ok(Math.abs(middle(positions.search)-middle(positions.sort))<=4,'Demo keeps search and sort together on one toolbar row');
 assert.ok(Math.abs(middle(positions.sort)-middle(positions.view))<=4,'List/grid controls share the search toolbar');
 assert.ok(positions.favorite.top>=positions.filters.top&&positions.favorite.bottom<=positions.filters.bottom,'Favorites belongs beside All / This session');
 assert.ok(positions.list.top<=230,'Library controls must not push songs into an extra header row');
 assert.ok(positions.track.height<=120,'Demo uses a compact song row, not a task card');
 assert.equal(positions.art.width,80,'Desktop song artwork follows the approved 80px layout');
 assert.equal(await frame.locator('.library-track').first().locator('.track-artwork [data-play-key]').count(),1,'Play belongs inside the artwork');
 assert.equal(await frame.locator('.library-track').first().getByRole('button',{name:'沿用设置',exact:true}).count(),1,'Each song owns its reuse action');
 assert.equal(await frame.locator('.music-record .record-heading').count(),0,'Successful tracks do not repeat a task title above their song titles');
 await frame.locator('.library-track ic-icon-button[icon="heart"] ic-icon[data-icon-status="ready"]').first().waitFor();
}
function seedLibraryStates() {
 for (const [i,status] of ['running','queued','failed','succeeded'].entries()) {
  const record={id:'state-'+status,status,operation:'cover',created_at:Date.now()/1000-i*1000,provider_id:'apimart',params:{version:'v6',custom:true,title:['夜航','雨后散步','远方的灯','慢一点'][i],prompt:'温柔的钢琴与低音',style:'Ambient piano'},error_code:status==='failed'?'music.contentRejected':'',result:null};
  record.references=[{name:'reference.wav',size:audioBytes.length,url:'/api/music/runs/'+record.id+'/references/0'}];
  if(status==='succeeded'){completed(record);record.result.items[0].title=record.params.title;}
  records.push(record);
 }
 // Missing titles fall back to the prompt; both it and provider titles can be much longer than a row.
 records.find(r=>r.id==='state-running').params.title='';
 records.find(r=>r.id==='state-running').params.prompt='女巫的解药救了头狼，猎人那一枪卡在了膛，守卫守住了漫长夜晚的最后一道门。'.repeat(8);
 records.find(r=>r.id==='state-queued').params.title='A very long English song title for the journey beyond the mountains and across the sea '.repeat(6);
 records.find(r=>r.id==='state-succeeded').result.items[1].title='AnUnbrokenProviderSongTitle'.repeat(16);
}
async function assertTrackTextLayout(frame) {
 await frame.locator('.library-track ic-icon-button[icon="heart"] ic-icon[data-icon-status="ready"]').first().waitFor();
 const rows=await frame.locator('#historyList').evaluate(root=>[...root.querySelectorAll('.library-track')].map(card=>{
  const box=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width};};
  const title=card.querySelector('.track-title strong'),host=card.querySelector('.track-title');
  return {state:card.dataset.state,card:box(card),copy:box(card.querySelector('.track-copy')),title:box(title),host:box(host),description:box(card.querySelector('.track-description')),icon:box(card.querySelector('.track-actions ic-icon-button[icon="heart"] ic-icon')),versions:[...card.querySelectorAll('.track-version')].map(box),truncated:title.scrollWidth>title.clientWidth,ellipsis:getComputedStyle(title).textOverflow,longTitle:title.textContent.length>100,overflow:card.scrollWidth>card.clientWidth+1};
 }));
 for(const row of rows) {
  assert.ok(Math.abs(row.title.left-row.description.left)<=1,`Song title and description share the same left edge: ${JSON.stringify(row)}`);
  assert.ok(Math.abs(row.icon.left-row.description.left)<=1,`The first action icon visually aligns with the text: ${JSON.stringify(row)}`);
  assert.ok(row.title.left>=row.host.left-1&&row.title.right<=row.host.right+1,'Title text stays inside its button');
  assert.ok(row.host.right<=row.copy.right+1&&row.versions.every(v=>v.left>=row.copy.left-1&&v.right<=row.copy.right+1),'Titles and metadata stay in the text column');
  assert.ok(row.versions.every(v=>v.top>=row.title.bottom-1||v.bottom<=row.title.top+1||v.left>=row.title.right),'Title text never covers model or status labels');
  assert.equal(row.overflow,false,'Long text must not overflow a row or grid cell');
  if(row.longTitle){assert.equal(row.truncated,true,'Long titles are constrained to available space');assert.equal(row.ellipsis,'ellipsis');}
 }
}
async function assertLibraryStates(frame,page) {
 const row=status=>frame.locator('[data-run-id="state-'+status+'"]');
 await assertTrackTextLayout(frame);
 await frame.locator('#historyList').screenshot({path:'/private/tmp/suno-library-alignment-final.png'});
 const fullPrompt=records.find(r=>r.id==='state-running').params.prompt;
 assert.equal(await row('running').locator('.track-title').getByRole('button').getAttribute('title'),fullPrompt,'Hover retains the complete title');
 await row('running').locator('.track-title').getByRole('button').press('Enter');
 await frame.locator('#recordDetail .settings-details > summary').click();
 await frame.locator('#recordDetail').getByText(fullPrompt,{exact:true}).waitFor();
 await page.keyboard.press('Escape');await frame.locator('#recordDialog').waitFor({state:'hidden'});
 await row('succeeded').locator('.track-title').first().click();
 await frame.locator('#recordDetail h2').getByText('慢一点',{exact:true}).waitFor();
 await page.keyboard.press('Escape');await frame.locator('#recordDialog').waitFor({state:'hidden'});
 for(const status of ['running','queued','failed']) {
  assert.equal(await row(status).locator('.library-track').count(),1,status+' uses the same song row as completed music');
  assert.equal(await row(status).locator('[data-play-key]').count(),0,'Unfinished audio must not offer playback');
  const shape=await row(status).locator('.library-track').evaluate(el=>{const art=el.querySelector('.track-artwork').getBoundingClientRect();return {height:el.getBoundingClientRect().height,width:art.width,artHeight:art.height};});
  assert.equal(shape.height,109,'State rows preserve the regular song height');assert.equal(shape.width,80);assert.equal(shape.artHeight,80);
 }
 const pending=row('running').locator('ic-generation-pending');
 assert.equal(await pending.getAttribute('kind'),'image');assert.equal(await pending.getAttribute('state'),'generating');
 assert.equal(await row('queued').locator('ic-generation-pending').getAttribute('state'),'queued');
 assert.equal(await pending.evaluate(el=>el.shadowRoot.querySelector('[part="base"]').getBoundingClientRect().height),78,'The animation fits inside the 80px cover and its 1px border without cropping');
 await pending.evaluate(el=>el.dataset.identity='retained');await frame.locator('#refreshMusic').click();
 assert.equal(await pending.getAttribute('data-identity'),'retained','Unchanged polling keeps the animation instance');
 assert.equal(await row('failed').locator('.track-artwork ic-icon[name="error"]').count(),1);
 await row('failed').getByText('平台内容审核未通过，请核对音频与描述',{exact:true}).waitFor();
 await row('failed').locator('.track-more').click();await frame.locator('#musicRecordMenu [value="details"]').click();await frame.locator('#recordDetail').getByText('平台内容审核未通过，请核对音频与描述',{exact:true}).waitFor();await page.keyboard.press('Escape');
 await frame.locator('#referenceFiles').setInputFiles({name:'reference.wav',mimeType:'audio/wav',buffer:audioBytes});
 const mode=frame.locator('#referenceMode');assert.equal(await mode.evaluate(el=>el.localName),'ic-segmented-control');assert.equal(await mode.getAttribute('size'),'large');
 await mode.getByRole('radio',{name:'灵感 Inspire',exact:true}).click();assert.equal(await mode.getAttribute('value'),'inspo');
 assert.equal(await frame.locator('#setDuration').evaluate(el=>el.disabled),true,'Segmented selection updates dependent controls');
 await mode.getByRole('radio',{name:'灵感 Inspire',exact:true}).press('ArrowLeft');assert.equal(await mode.getAttribute('value'),'cover');
 assert.equal(await frame.locator('#setDuration').evaluate(el=>el.disabled),false);
 await page.locator('#lang-toggle-btn').click();await row('failed').getByText('The provider rejected the audio or prompt during content review.',{exact:true}).waitFor();
 assert.equal(await mode.getAttribute('aria-label'),'Reference mode');assert.equal(await pending.getAttribute('label'),'Processing');
 await assertTrackTextLayout(frame);
 await frame.locator('#libraryLayout [data-value="grid"]').click();
 const grid=await frame.locator('#historyList').evaluate(el=>[...el.querySelectorAll('.library-track')].map(card=>{const a=card.querySelector('.track-artwork').getBoundingClientRect();return {width:card.getBoundingClientRect().width,artWidth:a.width,artHeight:a.height};}));
 assert.ok(Math.max(...grid.map(r=>r.width))-Math.min(...grid.map(r=>r.width))<2,'All states occupy one equal grid cell');
 assert.ok(grid.every(r=>Math.abs(r.artWidth-r.artHeight)<1),'Every grid cover is square');
 await assertTrackTextLayout(frame);
 await page.screenshot({path:'/private/tmp/suno-states-grid.png'});
 await frame.locator('#libraryLayout [data-value="list"]').click();
 for(const theme of ['light','dark']){if(await page.locator('html').getAttribute('data-ui-theme')!==theme) await page.locator('#theme-toggle-btn').click();await frame.locator('html[data-ui-theme="'+theme+'"]').waitFor();await page.screenshot({path:'/private/tmp/suno-states-'+theme+'.png'});}
 await page.setViewportSize({width:390,height:844});await frame.locator('#musicView ic-radio[value="library"]').click();
 assert.equal(await frame.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 await assertTrackTextLayout(frame);
 await page.screenshot({path:'/private/tmp/suno-states-narrow.png'});
 await frame.locator('#libraryLayout [data-value="grid"]').click();await assertTrackTextLayout(frame);
 await frame.locator('#libraryLayout [data-value="list"]').click();
 const run=records.find(r=>r.id==='state-running');run.status='failed';run.error_code='music.hostingFailed';await frame.locator('#refreshMusic').click();
 await row('running').getByText('Audio hosting failed. Generation has not been submitted.',{exact:true}).waitFor();
 assert.equal(await row('running').locator('ic-generation-pending').count(),0,'Failure removes the animation');
 completed(run);await frame.locator('#refreshMusic').click();await row('running').locator('[data-play-key]').first().waitFor();
 assert.equal(await row('running').locator('.library-track').count(),2,'Completion replaces one task row with its real songs');
 assert.equal(await row('running').locator('ic-generation-pending').count(),0);
 assert.equal(submissions.length,0,'Viewing and switching modes never submits generation');
}
async function assertLibraryDeletion(frame,page) {
 const failed=frame.locator('[data-run-id="state-failed"]');
 const openDelete=async()=>{
  await failed.locator('.track-more').getByRole('button').press('Enter');
  await frame.locator('#musicRecordMenu [value="delete"]').click();
  await frame.locator('#deleteRecordDialog').getByRole('dialog').waitFor();
  await frame.locator('#deleteRecordDialog').evaluate(el=>el.show());
 };
 await failed.getByRole('button',{name:'沿用设置',exact:true}).click();
 assert.equal(await frame.locator('#referenceList .reference-card').count(),1);
 await frame.locator('[data-run-id="state-succeeded"] [data-play-key]').first().click();
 await frame.locator('#playerAudio').evaluate(el=>{el.pause();el.dataset.identity='preserved';});
 const source=await frame.locator('#playerAudio').getAttribute('src');
 await openDelete();await frame.locator('#cancelDeleteRecord').click();
 await frame.locator('#deleteRecordDialog').getByRole('dialog').waitFor({state:'hidden'});
 assert.equal(deletions.length,0,'Cancel never requests deletion');
 await openDelete();await page.keyboard.press('Escape');await frame.locator('#deleteRecordDialog').getByRole('dialog').waitFor({state:'hidden'});
 assert.equal(deletions.length,0,'Escape never requests deletion');
 await openDelete();
 await page.screenshot({path:'/private/tmp/suno-delete-confirm-zh.png'});
 await page.locator('#lang-toggle-btn').click();await frame.locator('#deleteRecordDialog[label="Delete this failed record?"]').waitFor({state:'attached'});
 assert.equal(await frame.locator('#confirmDeleteRecord').innerText(),'Delete record');
 assert.match(await frame.locator('#deleteRecordDialog').innerText(),/Shared files and files still in use/);
 failDelete=true;await frame.locator('#confirmDeleteRecord').click();
 await frame.locator('#deleteRecordError').getByText('Some local files could not be deleted. The record was kept. Try again.',{exact:true}).waitFor();
 assert.equal(await failed.count(),1,'File deletion failures leave the record and retry available');
 await page.locator('#lang-toggle-btn').click();await frame.locator('#deleteRecordError').getByText('部分本地文件未能删除，记录已保留，请重试',{exact:true}).waitFor();
 await page.locator('#theme-toggle-btn').click();await frame.locator('html[data-ui-theme="dark"]').waitFor();
 await page.screenshot({path:'/private/tmp/suno-delete-error-dark.png'});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await frame.locator('#deleteRecordDialog').getByRole('dialog').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),true,'The confirmation fits a narrow viewport');
 await page.screenshot({path:'/private/tmp/suno-delete-narrow.png'});
 await page.setViewportSize({width:1500,height:1050});
 await frame.locator('#cancelDeleteRecord').click();await frame.locator('#deleteRecordDialog').getByRole('dialog').waitFor({state:'hidden'});
 failDelete=false;
 let releaseHistory;const captured=new Promise(resolve=>{holdNextHistory=release=>{releaseHistory=release;resolve();};});
 await frame.locator('#refreshMusic').click();await captured;
 let releaseDeletion;const deleting=new Promise(resolve=>{holdNextDeletion=release=>{releaseDeletion=release;resolve();};});
 await openDelete();await frame.locator('#confirmDeleteRecord').click();
 await deleting;
 assert.equal(await frame.locator('#cancelDeleteRecord').evaluate(el=>el.disabled),true,'Cancellation is disabled while deletion is committing');
 await page.keyboard.press('Escape');
 await frame.locator('#deleteRecordDialog').getByRole('dialog').waitFor();
 await frame.locator('#confirmDeleteRecord').evaluate(el=>el.click());
 assert.equal(deletions.length,2,'A repeated click cannot send another deletion');
 releaseDeletion();
 await failed.waitFor({state:'detached'});releaseHistory();
 await frame.locator('#refreshMusic:not([loading])').waitFor();
 assert.equal(await failed.count(),0,'An older in-flight history response cannot resurrect a deleted record');
 assert.equal(await frame.locator('#playerAudio').getAttribute('src'),source,'Deleting a failed record preserves another song in the player');
 assert.equal(await frame.locator('#playerAudio').getAttribute('data-identity'),'preserved');
 assert.equal(await frame.locator('#referenceList .reference-card').count(),0,'References reused from the deleted record leave the current draft');
 assert.equal(deletions.length,2,'One failed request and one explicit retry');
 await page.reload();await frame.locator('#submitMusic:not([disabled])').waitFor();
 assert.equal(await failed.count(),0,'Reload reads the persisted deletion');
 assert.equal(submissions.length,0,'Deleting records never submits paid generation');
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 if(process.argv.includes('--states-only')||process.argv.includes('--deletion-only')||process.argv.includes('--serve-states')) seedLibraryStates();
 if(process.argv.includes('--serve-states')){console.log(base+'/studio?page=music');return;}
 if(process.argv.includes('--serve') || process.argv.includes('--layout-only') || process.argv.includes('--media-only')) {
  for(let i=0;i<4;i++){const record={id:'preview-'+i,status:'succeeded',operation:'generate',created_at:Date.now()/1000-i*1000,params:{version:'v6',custom:true,title:['夜航','远方的灯','雨后散步','慢一点'][i],prompt:'温柔的钢琴与低音',style:'Ambient piano'},provider_id:'apimart',error_code:''};completed(record);record.result.items[0].title=record.params.title;record.result.items[1].title=record.params.title+' II';records.push(record);}
  if(process.argv.includes('--serve')) {console.log(base+'/studio?page=music');return;}
 }
 const browser=await chromium.launch({headless:true,executablePath:process.env.SMART_CANVAS_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1050},acceptDownloads:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('studio_brand_entry_seen','1'));
  if(process.argv.includes('--layout-only') || process.argv.includes('--composer-only') || process.argv.includes('--media-only') || process.argv.includes('--states-only') || process.argv.includes('--deletion-only')) {
   await page.goto(base+'/studio?page=music');
   const frame=page.frameLocator('#frame-lab');
   await frame.locator('#submitMusic:not([disabled])').waitFor();
   if(process.argv.includes('--deletion-only')) { await frame.locator('[data-run-id="state-failed"]').waitFor();await assertLibraryDeletion(frame,page); }
   else if(process.argv.includes('--states-only')) { await frame.locator('[data-run-id="state-running"]').waitFor();await assertLibraryStates(frame,page); }
   else if(process.argv.includes('--media-only')) { await assertMediaControls(frame,page); }
   else if(process.argv.includes('--composer-only')) { await assertComposerLayout(frame); await assertDraftControls(frame,page); await page.screenshot({path:'/private/tmp/suno-composer-desktop.png'}); }
   else { await frame.locator('.library-track').first().waitFor(); await assertCreateLibraryLayout(frame); }
   assert.deepEqual(errors,[]);console.log('music Create layout: PASS');return;
  }
  await page.goto(base+'/studio');
  await page.locator('ic-nav-item[data-page="lab"]').click();
  await page.locator('ic-nav-item[data-page="lab"] ic-icon[data-icon-status="ready"]').waitFor();
  await page.waitForFunction(()=>document.querySelector('#frame-lab')?.classList.contains('active'));
  assert.equal(await page.locator('ic-nav-item[data-page="lab"]').getAttribute('label'),'实验室');
  const frame=page.frameLocator('#frame-lab');
  // Opening a new frontend against an older backend must identify the missing API,
  // use floating public feedback, and recover without a paid submission.
  startupStatus=404;
  await frame.locator('#enterSuno').click();
  await frame.locator('#musicFeedback ic-alert[tone="danger"]').first().waitFor();
  assert.match(await frame.locator('#musicFeedback').innerText(),/音乐服务未就绪，请重启 Reroll 后重试/);
  assert.doesNotMatch(await frame.locator('#musicFeedback').innerText(),/网络异常|查看历史/);
  assert.equal(await frame.locator('#musicFeedback').evaluate(el=>getComputedStyle(el).position),'fixed');
  assert.equal(await frame.locator('#sunoWorkbench > ic-alert').count(),0);
  await page.locator('#lang-toggle-btn').click();
  await frame.locator('html[lang="en"]').waitFor();
  assert.equal(await frame.locator('#configMessage').textContent(),'Music is unavailable. Restart Reroll, then try again.');
  await page.locator('#lang-toggle-btn').click();
  await frame.locator('html[lang="zh-CN"]').waitFor();
  assert.equal(await frame.locator('#musicFeedback ic-alert:not([data-ic-stack-state="exiting"])').count(),1,'The same startup failure is presented once');
  for(const theme of ['dark','light']) {
   await page.locator('#theme-toggle-btn').click();
   await frame.locator('html[data-ui-theme="'+theme+'"]').waitFor();
   await page.screenshot({path:'/private/tmp/suno-startup-error-'+theme+'.png',fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  assert.equal(await frame.locator('#configMessage').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),true,'Error feedback must fit the mobile viewport');
  await page.screenshot({path:'/private/tmp/suno-startup-error-narrow.png',fullPage:true});
  await page.setViewportSize({width:1500,height:1050});
  await frame.locator('#configMessage').getByRole('button',{name:'关闭',exact:true}).press('Enter');
  await frame.locator('#musicFeedback ic-alert').waitFor({state:'detached'});
  await page.locator('#lang-toggle-btn').click();await page.locator('#lang-toggle-btn').click();
  assert.equal(await frame.locator('#musicFeedback ic-alert').count(),0,'Changing language must not resurrect dismissed feedback');

  await frame.locator('#refreshMusic').click();
  await frame.locator('#configMessage').waitFor();
  startupStatus=200;
  await frame.locator('#musicFeedback ic-alert[data-ic-stack-index="0"]').getByRole('button',{name:'重试',exact:true}).click();
  await frame.locator('#submitMusic:not([disabled])').waitFor({state:'attached'});
  await frame.locator('#musicFeedback ic-alert').first().waitFor({state:'detached'});
  assert.equal(submissions.length,0,'Startup retry only reloads config and history');
  for (const [status,message] of [[401,'登录已失效，请刷新页面重新登录'],[403,'当前账号没有音乐服务权限'],[503,'加载失败，请刷新重试']]) {
   startupStatus=status;await page.reload();await frame.locator('#enterSuno').click();
   await frame.locator('#configMessage').filter({hasText:message}).waitFor();
   assert.doesNotMatch(await frame.locator('#musicFeedback').innerText(),/先查看历史记录/);
  }
  startupStatus=200;await page.reload();
  if(process.argv.includes('--startup-only')) {console.log('music startup feedback: PASS');return;}
  await frame.locator('#enterSuno').click();
  await frame.locator('#submitMusic:not([disabled])').waitFor();

  assert.equal(await frame.locator('#musicView').inputValue().catch(()=>frame.locator('#musicView').evaluate(el=>el.value)),'create');
  await assertComposerLayout(frame);
  await assertDraftControls(frame,page);
  await assertMediaControls(frame,page);
  assert.match(await frame.locator('[data-i18n="music.paidHint"]').innerText(),/扣费/);
  assert.equal(await frame.locator('#advancedOptions').evaluate(el=>el.open),false,'Fine controls start collapsed');
  await frame.locator('#advancedOptions summary').click();
  await frame.locator('#openPersona').click();await frame.locator('#persona input').fill('existing-persona');
  await frame.locator('#closePersona').click();await frame.locator('#openPersona').click();
  assert.equal(await frame.locator('#persona').evaluate(el=>el.value),'existing-persona');
  await page.keyboard.press('Escape');await frame.locator('#personaDialog dialog').waitFor({state:'hidden'});
  await frame.locator('#expandPrompt').click();await frame.locator('#expandedPrompt textarea').fill('Expanded draft');
  await frame.locator('#applyPrompt').click();
  await frame.locator('#promptDialog').locator('dialog').waitFor({state:'hidden'});
  assert.equal(await frame.locator('#prompt textarea').inputValue(),'Expanded draft');
  await frame.locator('#prompt textarea').fill('');
  await page.waitForFunction(()=>document.querySelector('#frame-lab').contentDocument.getElementById('prompt').value==='');

  for(const id of ['songTitle','version','style','negativeTags','styleWeight','weirdness','duration','audioWeight']) assert.equal(await frame.locator('#'+id).isVisible(),true,id);
  await frame.locator('#submitMusic').click();assert.equal(submissions.length,0);
  assert.equal(await frame.locator('#musicMessage').textContent(),'请描述歌曲主题');
  await page.locator('#lang-toggle-btn').click();
  await frame.locator('#musicMessage').filter({hasText:'Describe what the song is about.'}).waitFor();
  await page.locator('#lang-toggle-btn').click();
  await frame.locator('#musicMessage').filter({hasText:'请描述歌曲主题'}).waitFor();
  await frame.locator('#lyricsMode').getByRole('combobox').press('ArrowDown');await frame.locator('#lyricsMode').getByRole('option',{name:'自填歌词',exact:true}).click();
  assert.equal(await frame.locator('#prompt').getAttribute('aria-label'),'歌词');
  await frame.locator('#submitMusic').click();assert.equal(await frame.locator('#musicMessage').textContent(),'请填写歌词');
  await frame.locator('#musicType').click();
  assert.equal(await frame.locator('#lyricsMode').isVisible(),true);assert.equal(await frame.locator('#lyricsMode').evaluate(el=>el.disabled),true);
  await frame.locator('#prompt textarea').fill('词'.repeat(5001));await frame.locator('#submitMusic').click();
  assert.equal(await frame.locator('#musicMessage').textContent(),'最多填写 5000 字');
  await frame.locator('#prompt textarea').fill('舒缓钢琴');
  await frame.locator('#songTitle input').fill('歌'.repeat(81));await frame.locator('#submitMusic').click();
  assert.equal(await frame.locator('#musicMessage').textContent(),'歌名最多 80 字');
  await frame.locator('#songTitle input').fill('🎵'.repeat(80));
  await frame.locator('#style textarea').fill('风格'.repeat(501));await frame.locator('#submitMusic').click();
  assert.equal(await frame.locator('#musicMessage').textContent(),'风格描述最多 1000 字');
  await frame.locator('#style textarea').fill('ambient piano');
  await frame.locator('#overrideWeights').getByRole('checkbox').press('Space');await frame.locator('#styleWeight').evaluate(el=>el.value=0);
  await frame.locator('#setDuration').getByRole('checkbox').press('Space');await frame.locator('#duration input').fill('');await frame.locator('#submitMusic').click();
  assert.equal(await frame.locator('#musicMessage').textContent(),'请输入 10–360 的整数秒数');assert.equal(submissions.length,0);
  await frame.locator('#duration input').fill('10');
  await frame.locator('#submitMusic').focus();await page.keyboard.press('Enter');
  await frame.locator('.history-item').waitFor();assert.equal(submissions.length,1);
  const first=submissions[0].data.settings;assert.equal(first.custom,true);assert.equal(first.instrumental,true);assert.equal(first.style_weight,0);assert.equal(first.duration,10);assert.equal([...first.title].length,80);assert.ok(!('audio_weight' in first));
  assert.equal(await frame.locator('#libraryView').isVisible(),true);assert.equal(await frame.locator('#createView').isVisible(),true,'Desktop keeps composer visible beside results');
  assert.match(await frame.locator('#libraryView').innerText(),/处理中/);
  assert.equal(await frame.locator('#historyList ic-generation-pending[kind="image"][state="generating"]').count(),1);
  completed(records[0]);await frame.locator('#refreshMusic').click();await frame.locator('#historyList [data-play-key]').first().waitFor();
  await assertCreateLibraryLayout(frame);
  assert.equal(await frame.locator('#historyList .library-track').count(),2);assert.equal(await frame.locator('#historyList script').count(),0);
  await frame.locator('#historyList [data-play-key]').first().click();
  await frame.locator('#playerAudio').evaluate(audio=>{audio.dataset.identity='kept';audio.loop=true;});
  await frame.locator('#refreshMusic').click();await page.waitForTimeout(200);
  assert.equal(await frame.locator('#playerAudio').getAttribute('data-identity'),'kept');
  assert.equal(await frame.locator('#playerAudio').evaluate(audio=>audio.paused),false,'Polling must preserve playback');
  await frame.locator('#playerAudio').evaluate(audio=>audio.pause());
  // Artwork is per song. Failed images disappear; missing covers retain an accessible fallback.
  await frame.locator('.library-track').first().locator('.track-artwork img').evaluate(img=>img.decode());
  assert.equal(await frame.locator('.library-track').first().locator('.track-artwork img').getAttribute('src'),'/assets/test-cover-1.svg');
  await frame.locator('.library-track').nth(1).locator('.track-artwork img').waitFor({state:'detached'});
  assert.match(await frame.locator('.library-track').nth(1).locator('.track-artwork').getAttribute('aria-label'),/暂无可用封面/);
  assert.equal(await frame.locator('#nowPlaying img').getAttribute('src'),'/assets/test-cover-1.svg');
  // Keep one audio node while switching modes, languages, search and grid presentation.
  await frame.locator('#historyList [data-play-key]').first().click();
  await frame.locator('#composerMode [data-value="simple"]').click();
  assert.equal(await frame.locator('#style').isVisible(),false);
  await frame.locator('#composerMode [data-value="detailed"]').click();
  assert.equal(await frame.locator('#style').evaluate(el=>el.value),'ambient piano');
  await frame.locator('#libraryLayout [data-value="grid"]').click();
  assert.equal(await frame.locator('#historyList').getAttribute('data-layout'),'grid');
  await page.locator('#lang-toggle-btn').click();
  assert.equal(await frame.locator('#playerAudio').evaluate(audio=>audio.paused),false);
  assert.equal(await frame.locator('#playerAudio').getAttribute('data-identity'),'kept');
  await page.locator('#lang-toggle-btn').click();
  await frame.locator('#libraryLayout [data-value="list"]').click();
  await frame.locator('#searchMusic input').fill('no matching track');
  assert.equal(await frame.locator('#playerAudio').evaluate(audio=>audio.paused),false,'Filtering must not stop the selected song');
  await frame.locator('#searchMusic input').fill('');
  await frame.locator('#nextTrack').click();assert.match(await frame.locator('#playerAudio').getAttribute('src'),/audio\/1$/);
  await frame.locator('#previousTrack').click();await page.waitForFunction(()=>document.querySelector('#frame-lab').contentDocument.getElementById('playerAudio').getAttribute('src').endsWith('/audio/0'));
  await page.waitForFunction(()=>{const a=document.querySelector('#frame-lab').contentDocument.getElementById('playerAudio');return Number.isFinite(a.duration)&&a.readyState>=1;});
  await frame.locator('#playerAudio').evaluate(a=>a.pause());
  await frame.locator('#playerProgress').evaluate(el=>{el.value=500;el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.ok(await frame.locator('#playerAudio').evaluate(a=>a.currentTime>=.4));
  await frame.locator('#playerVolume').evaluate(el=>{el.value=20;el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await frame.locator('#playerAudio').evaluate(a=>a.volume),.2);
  await frame.locator('#playerAudio').evaluate(audio=>audio.pause());

  await frame.locator('#historyList').getByRole('button',{name:'下载',exact:true}).first().click();
  const savedPromise=page.waitForEvent('download',{timeout:10000});
  await frame.locator('#downloadDetail [data-format="wav"]').getByRole('button',{name:'下载',exact:true}).click();
  assert.match((await savedPromise).suggestedFilename(),/\.wav$/);
  failExport=true;
  await frame.locator('#downloadDetail [data-format="mp3"]').getByRole('button',{name:'准备格式',exact:true}).click();
  await frame.locator('#downloadStatus').filter({hasText:'密钥无效或无权限，请检查设置'}).waitFor();
  assert.equal(await frame.locator('#downloadStatus').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true,'Download failure stays inside the visible dialog');
  assert.equal(paidExports,0);failExport=false;
  await frame.locator('#downloadDetail [data-format="mp3"]').getByRole('button',{name:'准备格式',exact:true}).click();
  await frame.locator('#downloadDetail [data-format="mp3"]').getByRole('button',{name:'下载',exact:true}).waitFor();
  assert.equal(paidExports,1);assert.equal(await frame.locator('.music-record').count(),1,'Exports are grouped under their source');
  const preparedDownload=page.waitForEvent('download');
  await frame.locator('#downloadDetail [data-format="mp3"]').getByRole('button',{name:'下载',exact:true}).click();
  assert.match((await preparedDownload).suggestedFilename(),/\.mp3$/);assert.equal(paidExports,1,'A ready format downloads without paying for preparation again');
  await page.keyboard.press('Escape');await frame.locator('#downloadDialog dialog').waitFor({state:'hidden'});
  await frame.locator('#searchMusic input').fill('不存在');assert.equal(await frame.locator('.music-record').count(),0);
  await frame.locator('#clearMusicFilters').click();await frame.locator('.music-record').waitFor();
  await frame.locator('.library-track .track-title').nth(1).click();await frame.locator('.song-detail').waitFor();
  assert.equal(await frame.locator('.song-detail h2').innerText(),'Second take');
  assert.equal(await frame.locator('#recordDetail [data-track-key]').count(),1,'Details show only the selected song');
  await page.keyboard.press('Escape');await frame.locator('#recordDialog dialog').waitFor({state:'hidden'});
  await frame.locator('.library-track .track-title').first().click();await frame.locator('.song-detail').waitFor();
  assert.equal(await frame.locator('#recordDetail .track-artwork img').first().getAttribute('src'),'/assets/test-cover-large-1.svg');
  await frame.locator('#recordDetail').getByText('沿用设置',{exact:true}).click();
  await frame.locator('#createView').waitFor();assert.equal(await frame.locator('#styleWeight').evaluate(el=>el.value),0);
  const refFile={name:'reference.wav',mimeType:'audio/wav',buffer:audioBytes};
  await frame.locator('#referenceFiles').setInputFiles([refFile]);
  assert.equal(await frame.locator('#referenceList .reference-card').count(),1);assert.equal(await frame.locator('#musicType').isVisible(),true);
  assert.equal(await frame.locator('#duration').evaluate(el=>el.disabled),false);assert.equal(await frame.locator('#persona').evaluate(el=>el.disabled),false);
  assert.equal(await frame.locator('#coverHint').isVisible(),true);assert.equal(await frame.locator('#lyricsMode').isVisible(),true);assert.equal(await frame.locator('#lyricsMode').evaluate(el=>el.disabled),true);
  await frame.locator('#musicType').click();
  assert.equal(await frame.locator('#coverHint').isVisible(),true,'Cover intent must survive switching between vocals and instrumental');
  await frame.locator('#musicType').click();
  assert.equal(submissions.length,1,'Choosing local files must not submit');
  await frame.locator('#referenceList [data-reference-play]').click();
  assert.match(await frame.locator('#playerAudio').getAttribute('src'),/^blob:/);
  await frame.locator('#playerAudio').evaluate(audio=>audio.pause());
  // Drop more files through the real drop handler.
  await frame.locator('#referenceDrop').evaluate((el,bytes)=>{const dt=new DataTransfer();for(let i=0;i<3;i++)dt.items.add(new File([new Uint8Array(bytes)],'drop-'+i+'.wav',{type:'audio/wav'}));el.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));},[...audioBytes]);
  assert.equal(await frame.locator('#referenceList .reference-card').count(),4);
  assert.equal(await frame.locator('#coverWarning').isVisible(),true);assert.equal(await frame.locator('#submitMusic button').isEnabled(),false);
  await page.locator('#lang-toggle-btn').click();await frame.getByText('Cover adaptation needs one reference. Remove the extra files to continue.',{exact:true}).waitFor();
  await page.locator('#lang-toggle-btn').click();
  await frame.locator('#musicType').click();
  await frame.locator('#referenceMode').getByRole('radio',{name:'灵感 Inspire',exact:true}).click();
  assert.equal(await frame.locator('#referenceList .reference-card').count(),4);assert.equal(await frame.locator('#submitMusic button').isEnabled(),true);
  assert.equal(await frame.locator('#duration').evaluate(el=>el.disabled),true);
  await frame.locator('#referenceFiles').setInputFiles([refFile]);assert.equal(await frame.locator('#referenceList .reference-card').count(),4);
  await frame.locator('#referenceList [data-reference-remove]').last().click();assert.equal(await frame.locator('#referenceList .reference-card').count(),3);
  await frame.locator('#referenceFiles').setInputFiles([{name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from('x')}]);assert.equal(await frame.locator('#referenceList .reference-card').count(),3);
  await frame.locator('#referenceDrop').evaluate(el=>{const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(50*1024*1024+1)],'large.wav',{type:'audio/wav'}));el.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));});assert.equal(await frame.locator('#referenceList .reference-card').count(),3);
  await frame.locator('#referenceFiles').setInputFiles([refFile]);
  await frame.locator('#setAudioWeight').click();await frame.locator('#audioWeight').evaluate(el=>el.value=0);
  await frame.locator('#examplePrompt').click();await frame.locator('#submitMusic').click();await frame.locator('.music-record').nth(1).waitFor();
  assert.equal(submissions.length,2);const inspired=submissions[1];assert.equal(inspired.pathname,'/api/music/inspirations');assert.equal(inspired.data.references.length,4);
  for(const key of ['custom','instrumental','duration','persona_id','style','weirdness_constraint']) assert.ok(!(key in inspired.data.settings),key);
  assert.equal(inspired.data.settings.audio_weight,0);assert.equal(inspired.data.settings.auto_lyrics,false,'Examples preserve the manually selected lyrics mode');assert.equal(inspired.data.settings.tags,'ambient piano');
  assert.match(await frame.locator('.music-record').first().innerText(),/灵感创作 Inspire/);
  const inspiration=records[0];completed(inspiration);await frame.locator('#refreshMusic').click();
  await frame.locator('.music-record').first().getByText('沿用设置',{exact:true}).first().click();
  assert.equal(await frame.locator('#referenceList .reference-card').count(),4);
  await frame.locator('#submitMusic').click();await frame.locator('.music-record').nth(2).waitFor();assert.equal(submissions.length,3);
  assert.deepEqual(submissions[2].data.references,Array.from({length:4},(_,index)=>({run_id:inspiration.id,index})));
  records[0].status='failed';records[0].error_code='music.hostingFailed';await frame.locator('#refreshMusic').click();
  await frame.locator('.music-record').first().getByText('音频托管失败，尚未提交生成',{exact:true}).waitFor();
  await frame.locator('.music-record').first().getByText('沿用设置',{exact:true}).first().click();
  while(await frame.locator('#referenceList .reference-card').count()>1) await frame.locator('#referenceList [data-reference-remove]').last().click();
  await frame.locator('#musicType').click();
  assert.equal(await frame.locator('#submitMusic button').isEnabled(),false,'Inspire must not silently claim instrumental output');
  await frame.locator('#referenceMode').getByRole('radio',{name:'改编 Cover',exact:true}).click();
  await frame.locator('#prompt textarea').fill('🎹'.repeat(1000));await frame.locator('#submitMusic').click();
  await frame.locator('#musicMessage').filter({hasText:'音乐描述与曲风补充合计最多 1000 字（含分隔符）'}).waitFor();assert.equal(submissions.length,3);
  await frame.locator('#prompt textarea').fill('温柔钢琴');
  if(!await frame.locator('#setDuration').evaluate(el=>el.checked)) await frame.locator('#setDuration').getByRole('checkbox').press('Space');
  await frame.locator('#duration input').fill('30');
  await frame.locator('#submitMusic').click();await frame.locator('.music-record').nth(3).waitFor();
  assert.match(await frame.locator('.music-record').first().innerText(),/参考改编 Cover/);
  assert.equal(submissions.length,4);const cover=submissions[3];assert.equal(cover.pathname,'/api/music/covers');
  assert.equal(cover.data.references.length,1);assert.equal(cover.data.settings.instrumental,true);assert.equal(cover.data.settings.auto_lyrics,false);
  assert.equal(cover.data.settings.duration,30);assert.equal(cover.data.settings.audio_weight,0);assert.equal(cover.data.settings.prompt,'温柔钢琴');
  assert.ok(!('vocal_gender' in cover.data.settings));
  completed(records[0]);await frame.locator('#refreshMusic').click();await frame.locator('.music-record').first().getByText('沿用设置',{exact:true}).first().click();
  assert.equal(await frame.locator('#musicType').evaluate(el=>el.checked),true);assert.equal(await frame.locator('#referenceList .reference-card').count(),1);
  assert.equal(await frame.locator('#prompt').evaluate(el=>el.value),'温柔钢琴');assert.equal(await frame.locator('#duration').evaluate(el=>Number(el.value)),30);
  assert.equal(await frame.locator('#style').evaluate(el=>el.value),'ambient piano');
  // Cover is an explicit intent, including vocal covers and history reuse.
  await frame.locator('#musicType').click();
  assert.equal(await frame.locator('#referenceMode').getAttribute('value'),'cover');
  await frame.locator('#lyricsMode').getByRole('combobox').press('ArrowDown');await frame.locator('#lyricsMode').getByRole('option',{name:'自填歌词',exact:true}).click();
  await frame.locator('#prompt textarea').fill('Keep this melody with my lyrics');
  await frame.locator('#submitMusic').click();await frame.locator('.music-record').nth(4).waitFor();
  assert.equal(submissions.length,5);assert.equal(submissions[4].pathname,'/api/music/covers');
  assert.equal(submissions[4].data.settings.instrumental,false);
  assert.equal(submissions[4].data.settings.prompt,'Keep this melody with my lyrics');
  records[0].status='failed';records[0].error_code='music.contentRejected';await frame.locator('#refreshMusic').click();
  await frame.locator('#historyList').getByText('平台内容审核未通过，请核对音频与描述',{exact:true}).waitFor();
  await page.locator('#lang-toggle-btn').click();
  await frame.locator('#historyList').getByText('The provider rejected the audio or prompt during content review.',{exact:true}).waitFor();
  await page.locator('#lang-toggle-btn').click();
  records[0].error_code='';

  completed(records[0]);await frame.locator('#refreshMusic').click();
  await frame.locator('.music-record').first().getByText('沿用设置',{exact:true}).first().click();
  assert.equal(await frame.locator('#referenceMode').getAttribute('value'),'cover');
  assert.equal(await frame.locator('#musicType').evaluate(el=>el.checked),false);
  const savedHistoryCount = await frame.locator('.music-record').count();
  await frame.locator('#historyList [data-play-key]').first().click();
  await frame.locator('#playerAudio').evaluate(audio=>{audio.loop=true;});
  const playingSource = await frame.locator('#playerAudio').getAttribute('src');
  await page.locator('#lang-toggle-btn').click();
  await frame.getByText('Rework the melody with Cover. One reference under 8 minutes; results may vary.',{exact:true}).waitFor();
  assert.equal(await frame.locator('#referenceMode').getAttribute('aria-label'),'Reference mode');
  await page.locator('#lang-toggle-btn').click();
  await frame.locator('#resetDraft').click();
  assert.equal(await frame.locator('#referenceList .reference-card').count(),0,'Clear removes references from the draft');
  assert.equal(await frame.locator('.music-record').count(),savedHistoryCount,'Clear keeps saved generation history');
  assert.equal(await frame.locator('#playerAudio').getAttribute('src'),playingSource);
  assert.equal(await frame.locator('#playerAudio').evaluate(audio=>audio.paused),false,'Clear keeps result playback running');
  assert.equal(await frame.locator('#persona').evaluate(el=>el.value),'');
  assert.equal(await frame.locator('#version').evaluate(el=>el.value),'v6');
  assert.equal(await frame.locator('#advancedOptions').evaluate(el=>el.open),false);
  await frame.locator('#playerAudio').evaluate(audio=>audio.pause());
  await page.reload();await frame.locator('#enterSuno').click();await frame.locator('#submitMusic:not([disabled])').waitFor();
  await frame.locator('.music-record').nth(2).waitFor();assert.equal(submissions.length,5,'Reload only reads history');
  failHistory=true;await frame.locator('#refreshMusic').click();await frame.locator('#historyStatus').getByText('加载失败，请刷新重试',{exact:true}).waitFor();failHistory=false;configured=false;
  await frame.locator('#refreshMusic').click();
  await frame.locator('#submitMusic[disabled]').waitFor();configured=true;
  await frame.locator('#refreshMusic').click();await frame.locator('#submitMusic:not([disabled])').waitFor();
  await page.locator('#lang-toggle-btn').click();await frame.getByText('Generating music charges your provider account.',{exact:true}).waitFor();
  assert.equal(await frame.locator('#songTitle').getAttribute('aria-label'),'Song title');
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>window.setTheme?.(theme),theme);
   if(await page.locator('html').getAttribute('data-ui-theme')!==theme) await page.locator('#theme-toggle-btn').click();
   await frame.locator('html[data-ui-theme="'+theme+'"]').waitFor();
   await page.screenshot({path:'/private/tmp/suno-create-live-'+theme+'.png',fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
  assert.equal(await frame.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'Narrow layout must fit');
  await frame.locator('#musicView ic-radio[value="library"]').click();
  assert.equal(await frame.locator('#createView').isVisible(),false);
  assert.equal(await frame.locator('#libraryView').isVisible(),true);
  assert.equal(await frame.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'Mobile library fits without horizontal scrolling');
  await page.screenshot({path:'/private/tmp/suno-create-library-narrow.png',fullPage:true});
  await frame.locator('#libraryFilter [data-value="session"]').click();
  assert.equal(await frame.locator('.music-record').count(),0,'A reload starts a new session filter');
  await frame.locator('#libraryFilter [data-value="all"]').click();
  assert.ok(await frame.locator('.music-record').count()>0);
  await frame.locator('#musicView ic-radio[value="create"]').click();
  // Older persisted records with no artwork are playable and need no migration.
  delete records[0].result.items[0].image_url;delete records[0].result.items[0].image_large_url;
  await frame.locator('#musicView ic-radio[value="library"]').click();await frame.locator('#refreshMusic').click();
  await frame.locator('.library-track').first().locator('.track-artwork img').waitFor({state:'detached'});
  await frame.locator('#musicView ic-radio[value="create"]').click();

  await page.screenshot({path:'/private/tmp/suno-create-live-narrow.png',fullPage:true});
  assert.deepEqual(await frame.locator('[ic-contract-error], [data-ic-contract-status="invalid"]').evaluateAll(els=>els.map(el=>({id:el.id,tag:el.localName,error:el.getAttribute('ic-contract-error')||el.getAttribute('data-ic-contract-error')}))),[]);
  assert.deepEqual(errors,[]);console.log('music lab Create browser: PASS');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
