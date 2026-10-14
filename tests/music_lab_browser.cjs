// Real Lab and App Shell pages with deterministic API fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const records = []; const submissions = []; let configured = true, failHistory = false, paidExports = 0;
const audioBytes = Buffer.alloc(44 + 16000); audioBytes.write('RIFF'); audioBytes.writeUInt32LE(audioBytes.length-8,4); audioBytes.write('WAVEfmt ',8); audioBytes.writeUInt32LE(16,16); audioBytes.writeUInt16LE(1,20); audioBytes.writeUInt16LE(1,22); audioBytes.writeUInt32LE(8000,24); audioBytes.writeUInt32LE(16000,28); audioBytes.writeUInt16LE(2,32); audioBytes.writeUInt16LE(16,34); audioBytes.write('data',36); audioBytes.writeUInt32LE(16000,40);
function json(res,code,value){res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}
function completed(record) { record.status='succeeded'; record.result={credits_cost:.5,items:[{kind:'audio',audio_id:'a1',audio_index:1,title:'Rain <script>alert(1)</script>',lyrics:'雨落在窗边\nA quiet night',duration:10.3,url:'/assets/output/a.wav',format:'wav'},{kind:'audio',audio_id:'a2',audio_index:2,title:'Second take',url:'/assets/output/b.wav',format:'wav'}]}; }
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost'), pathname=url.pathname;
 if(pathname==='/api/auth/me') return json(res,200,{user:{id:'designer',username:'designer',display_name:'Test designer',role:'designer',status:'active'}});
 if(pathname==='/api/app-info') return json(res,200,{version:'test'});
 if(pathname==='/api/admin/cli-updates') return json(res,200,{items:[],notification_items:[],checking:false});
 if(pathname==='/api/workspace-storage-settings') return json(res,200,{active:{workspace_directory:'/test'},configured:{}});
 if(pathname==='/api/music/config') return json(res,200,{providers:configured?[{id:'apimart',name:'APIMart'}]:[],versions:['v6','v6-wild','v6-mini'],formats:['mp3','m4a','wav']});
 if(pathname==='/api/music/history') return json(res,failHistory?503:200,failHistory?{}:{items:records,next_cursor:''});
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
  if(pathname.endsWith('/downloads')){
   let output=records.find(item=>item.source_run_id===rid);
   if(!output){paidExports++;output={id:'export-'+paidExports,status:'succeeded',operation:'download',created_at:Date.now()/1000,params:{formats:data.formats,audio_index:data.audio_index},source_run_id:rid,result:{items:data.formats.map((format,i)=>({kind:'audio',format,audio_index:i+1,url:'/assets/output/export.wav'}))}};records.unshift(output);}
   return json(res,202,output);
  }
  if((pathname.includes('/audio/')||pathname.includes('/references/'))){res.writeHead(200,{'Content-Type':'audio/wav','Content-Disposition':url.searchParams.has('download')?'attachment; filename="Suno.wav"':'inline'});return res.end(audioBytes);}
  if(record)return json(res,200,record);return json(res,404,{});
 }
 if(pathname==='/static/canvas-list.html') {res.writeHead(200,{'Content-Type':'text/html'});return res.end('<p>Canvas fixture</p>');}
 const file=path.resolve(root,'.'+(pathname==='/'||pathname==='/studio'?'/static/index.html':decodeURIComponent(pathname)));
 if(!file.startsWith(root+path.sep)) return res.writeHead(403).end();
 try{res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'}[path.extname(file)]||'application/octet-stream'});res.end(fs.readFileSync(file));}catch(_){res.writeHead(404).end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 if(process.argv.includes('--serve')) {console.log(base+'/studio#lab');return;}
 const browser=await chromium.launch({headless:true,executablePath:process.env.SMART_CANVAS_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1050},acceptDownloads:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('studio_brand_entry_seen','1'));
  await page.goto(base+'/studio');
  await page.locator('ic-nav-item[data-page="lab"]').click();
  await page.locator('ic-nav-item[data-page="lab"] ic-icon[data-icon-status="ready"]').waitFor();
  await page.waitForFunction(()=>document.querySelector('#frame-lab')?.classList.contains('active'));
  assert.equal(await page.locator('ic-nav-item[data-page="lab"]').getAttribute('label'),'实验室');
  const frame=page.frameLocator('#frame-lab');
  await frame.locator('#enterSuno').click();
  await frame.locator('#submitMusic:not([disabled])').waitFor();

  assert.equal(await frame.locator('#musicView').inputValue().catch(()=>frame.locator('#musicView').evaluate(el=>el.value)),'create');
  assert.match(await frame.locator('[data-i18n="music.liveService"]').innerText(),/按次计费/);
  assert.equal(await frame.locator('#musicForm details').count(),0,'All creation parameters stay exposed');
  for(const id of ['songTitle','version','style','negativeTags','styleWeight','weirdness','duration','persona','audioWeight']) assert.equal(await frame.locator('#'+id).isVisible(),true,id);
  await frame.locator('#submitMusic').click();assert.equal(submissions.length,0);
  assert.equal(await frame.locator('#musicMessage').innerText(),'请描述歌曲主题');
  await page.locator('#lang-toggle-btn').click();
  await frame.locator('#musicMessage').getByText('Describe what the song is about.',{exact:true}).waitFor();
  await page.locator('#lang-toggle-btn').click();
  await frame.locator('#musicMessage').getByText('请描述歌曲主题',{exact:true}).waitFor();
  await frame.locator('#lyricsMode ic-radio[value="manual"]').click();
  assert.equal(await frame.locator('#prompt').getAttribute('label'),'歌词');
  await frame.locator('#submitMusic').click();assert.equal(await frame.locator('#musicMessage').innerText(),'请填写歌词');
  await frame.locator('#musicType ic-radio[value="instrumental"]').click();
  assert.equal(await frame.locator('#lyricsMode').isVisible(),false);
  await frame.locator('#prompt textarea').fill('词'.repeat(5001));await frame.locator('#submitMusic').click();
  assert.equal(await frame.locator('#musicMessage').innerText(),'最多填写 5000 字');
  await frame.locator('#prompt textarea').fill('舒缓钢琴');
  await frame.locator('#songTitle input').fill('歌'.repeat(81));await frame.locator('#submitMusic').click();
  assert.equal(await frame.locator('#musicMessage').innerText(),'歌名最多 80 字');
  await frame.locator('#songTitle input').fill('🎵'.repeat(80));
  await frame.locator('#style textarea').fill('风格'.repeat(501));await frame.locator('#submitMusic').click();
  assert.equal(await frame.locator('#musicMessage').innerText(),'风格描述最多 1000 字');
  await frame.locator('#style textarea').fill('ambient piano');
  await frame.locator('#overrideWeights').click();await frame.locator('#styleWeight').evaluate(el=>el.value=0);
  await frame.locator('#setDuration').click();await frame.locator('#duration input').fill('');await frame.locator('#submitMusic').click();
  assert.equal(await frame.locator('#musicMessage').innerText(),'请输入 10–360 的整数秒数');assert.equal(submissions.length,0);
  await frame.locator('#duration input').fill('10');
  await frame.locator('#submitMusic').focus();await page.keyboard.press('Enter');
  await frame.locator('.history-item').waitFor();assert.equal(submissions.length,1);
  const first=submissions[0].data.settings;assert.equal(first.custom,true);assert.equal(first.instrumental,true);assert.equal(first.style_weight,0);assert.equal(first.duration,10);assert.equal([...first.title].length,80);assert.ok(!('audio_weight' in first));
  assert.equal(await frame.locator('#libraryView').isVisible(),true);assert.equal(await frame.locator('#createView').isVisible(),false);
  assert.match(await frame.locator('#libraryView').innerText(),/离开页面后仍会继续处理/);
  completed(records[0]);await frame.locator('#refreshMusic').click();await frame.locator('#historyList audio').first().waitFor();
  assert.equal(await frame.locator('#historyList audio').count(),2);assert.equal(await frame.locator('#historyList script').count(),0);
  await frame.locator('#historyList audio').first().evaluate(async audio=>{audio.dataset.identity='kept';audio.loop=true;await audio.play();});await frame.locator('#refreshMusic').click();await page.waitForTimeout(200);
  assert.equal(await frame.locator('#historyList audio').first().getAttribute('data-identity'),'kept');
  assert.equal(await frame.locator('#historyList audio').first().evaluate(audio=>audio.paused),false,'Polling must preserve playback');
  await frame.locator('#historyList audio').first().evaluate(audio=>audio.pause());
  const savedPromise=page.waitForEvent('download',{timeout:10000});await frame.locator('#historyList').getByText('下载 WAV',{exact:true}).first().click();assert.match((await savedPromise).suggestedFilename(),/\.wav$/);
  await frame.locator('#searchMusic input').fill('不存在');assert.equal(await frame.locator('.music-record').count(),0);await frame.locator('#searchMusic input').fill('');await frame.locator('.music-record').waitFor();
  await frame.locator('.history-item').first().click();await frame.locator('#recordDetail .detail-header').waitFor();
  await frame.locator('#recordDetail .export-options summary').first().click();
  await frame.locator('#recordDetail').getByText('导出音频',{exact:true}).first().click();
  await frame.locator('#recordDetail').getByText('查看来源',{exact:true}).waitFor();
  assert.equal(paidExports,1);assert.equal(await frame.locator('.music-record').count(),1,'Exports are grouped under their source');
  await frame.locator('#recordDetail').getByText('查看来源',{exact:true}).click();await frame.locator('#recordDetail .export-options summary').first().click();
  await frame.locator('#recordDetail').getByText('导出音频',{exact:true}).first().click();assert.equal(paidExports,1);
  await frame.locator('#recordDetail').getByText('查看来源',{exact:true}).click();await frame.locator('#recordDetail').getByText('沿用设置',{exact:true}).click();
  await frame.locator('#createView').waitFor();assert.equal(await frame.locator('#styleWeight').evaluate(el=>el.value),0);
  const refFile={name:'reference.wav',mimeType:'audio/wav',buffer:audioBytes};
  await frame.locator('#referenceFiles').setInputFiles([refFile]);
  assert.equal(await frame.locator('#referenceList .reference-card').count(),1);assert.equal(await frame.locator('#musicType').isVisible(),true);
  assert.equal(await frame.locator('#duration').evaluate(el=>el.disabled),false);assert.equal(await frame.locator('#persona').evaluate(el=>el.disabled),false);
  assert.equal(await frame.locator('#coverHint').isVisible(),true);assert.equal(await frame.locator('#lyricsMode').isVisible(),false);
  await frame.locator('#musicType ic-radio[value="song"]').click();
  assert.equal(await frame.locator('#coverHint').isVisible(),true,'Cover intent must survive switching between vocals and instrumental');
  await frame.locator('#musicType ic-radio[value="instrumental"]').click();
  assert.equal(submissions.length,1,'Choosing local files must not submit');
  await frame.locator('#referenceList').getByText('试听',{exact:true}).click();await frame.locator('#referenceList audio').waitFor();
  await frame.locator('#referenceList audio').evaluate(async audio=>{await audio.play();audio.pause();});
  // Drop more files through the real drop handler.
  await frame.locator('#referenceDrop').evaluate((el,bytes)=>{const dt=new DataTransfer();for(let i=0;i<3;i++)dt.items.add(new File([new Uint8Array(bytes)],'drop-'+i+'.wav',{type:'audio/wav'}));el.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));},[...audioBytes]);
  assert.equal(await frame.locator('#referenceList .reference-card').count(),4);
  assert.equal(await frame.locator('#coverWarning').isVisible(),true);assert.equal(await frame.locator('#submitMusic button').isEnabled(),false);
  await page.locator('#lang-toggle-btn').click();await frame.getByText('Cover adaptation needs one reference. Remove the extra files to continue.',{exact:true}).waitFor();
  await page.locator('#lang-toggle-btn').click();
  await frame.locator('#musicType ic-radio[value="song"]').click();
  await frame.locator('#referenceMode ic-radio[value="inspo"]').click();
  assert.equal(await frame.locator('#referenceList .reference-card').count(),4);assert.equal(await frame.locator('#submitMusic button').isEnabled(),true);
  assert.equal(await frame.locator('#duration').evaluate(el=>el.disabled),true);
  await frame.locator('#referenceFiles').setInputFiles([refFile]);assert.equal(await frame.locator('#referenceList .reference-card').count(),4);
  await frame.locator('#referenceList').getByText('移除音频',{exact:true}).last().click();assert.equal(await frame.locator('#referenceList .reference-card').count(),3);
  await frame.locator('#referenceFiles').setInputFiles([{name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from('x')}]);assert.equal(await frame.locator('#referenceList .reference-card').count(),3);
  await frame.locator('#referenceDrop').evaluate(el=>{const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(50*1024*1024+1)],'large.wav',{type:'audio/wav'}));el.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));});assert.equal(await frame.locator('#referenceList .reference-card').count(),3);
  await frame.locator('#referenceFiles').setInputFiles([refFile]);
  await frame.locator('#setAudioWeight').click();await frame.locator('#audioWeight').evaluate(el=>el.value=0);
  await frame.locator('#examplePrompt').click();await frame.locator('#submitMusic').click();await frame.locator('.music-record').nth(1).waitFor();
  assert.equal(submissions.length,2);const inspired=submissions[1];assert.equal(inspired.pathname,'/api/music/inspirations');assert.equal(inspired.data.references.length,4);
  for(const key of ['custom','instrumental','duration','persona_id','style','weirdness_constraint']) assert.ok(!(key in inspired.data.settings),key);
  assert.equal(inspired.data.settings.audio_weight,0);assert.equal(inspired.data.settings.auto_lyrics,true);assert.equal(inspired.data.settings.tags,'ambient piano');
  assert.match(await frame.locator('.music-record').first().innerText(),/灵感创作 Inspire/);
  const inspiration=records[0];completed(inspiration);await frame.locator('#refreshMusic').click();
  await frame.locator('.music-record').first().getByText('沿用设置',{exact:true}).click();
  assert.equal(await frame.locator('#referenceList .reference-card').count(),4);
  await frame.locator('#submitMusic').click();await frame.locator('.music-record').nth(2).waitFor();assert.equal(submissions.length,3);
  assert.deepEqual(submissions[2].data.references,Array.from({length:4},(_,index)=>({run_id:inspiration.id,index})));
  records[0].status='failed';records[0].error_code='music.hostingFailed';await frame.locator('#refreshMusic').click();
  await frame.locator('.music-record').first().getByText('音频托管失败，尚未提交生成',{exact:true}).waitFor();
  await frame.locator('.music-record').first().getByText('沿用设置',{exact:true}).click();
  while(await frame.locator('#referenceList .reference-card').count()>1) await frame.locator('#referenceList').getByText('移除音频',{exact:true}).last().click();
  await frame.locator('#musicType ic-radio[value="instrumental"]').click();
  assert.equal(await frame.locator('#submitMusic button').isEnabled(),false,'Inspire must not silently claim instrumental output');
  await frame.locator('#referenceMode ic-radio[value="cover"]').click();
  await frame.locator('#prompt textarea').fill('🎹'.repeat(1000));await frame.locator('#submitMusic').click();
  await frame.locator('#musicMessage').getByText('音乐描述与曲风补充合计最多 1000 字（含分隔符）',{exact:true}).waitFor();assert.equal(submissions.length,3);
  await frame.locator('#prompt textarea').fill('温柔钢琴');
  if(!await frame.locator('#setDuration').evaluate(el=>el.checked)) await frame.locator('#setDuration').click();
  await frame.locator('#duration input').fill('30');
  await frame.locator('#submitMusic').click();await frame.locator('.music-record').nth(3).waitFor();
  assert.match(await frame.locator('.music-record').first().innerText(),/参考改编 Cover/);
  assert.equal(submissions.length,4);const cover=submissions[3];assert.equal(cover.pathname,'/api/music/covers');
  assert.equal(cover.data.references.length,1);assert.equal(cover.data.settings.instrumental,true);assert.equal(cover.data.settings.auto_lyrics,false);
  assert.equal(cover.data.settings.duration,30);assert.equal(cover.data.settings.audio_weight,0);assert.equal(cover.data.settings.prompt,'温柔钢琴');
  assert.ok(!('vocal_gender' in cover.data.settings));
  completed(records[0]);await frame.locator('#refreshMusic').click();await frame.locator('.music-record').first().getByText('沿用设置',{exact:true}).click();
  assert.equal(await frame.locator('#musicType').evaluate(el=>el.value),'instrumental');assert.equal(await frame.locator('#referenceList .reference-card').count(),1);
  assert.equal(await frame.locator('#prompt').evaluate(el=>el.value),'温柔钢琴');assert.equal(await frame.locator('#duration').evaluate(el=>Number(el.value)),30);
  assert.equal(await frame.locator('#style').evaluate(el=>el.value),'ambient piano');
  // Cover is an explicit intent, including vocal covers and history reuse.
  await frame.locator('#musicType ic-radio[value="song"]').click();
  assert.equal(await frame.locator('#referenceMode').evaluate(el=>el.value),'cover');
  await frame.locator('#lyricsMode ic-radio[value="manual"]').click();
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
  await frame.locator('.music-record').first().getByText('沿用设置',{exact:true}).click();
  assert.equal(await frame.locator('#referenceMode').evaluate(el=>el.value),'cover');
  assert.equal(await frame.locator('#musicType').evaluate(el=>el.value),'song');
  await page.locator('#lang-toggle-btn').click();
  await frame.getByText('Rework the melody with Cover. One reference under 8 minutes; results may vary.',{exact:true}).waitFor();
  assert.equal(await frame.locator('#referenceMode').getAttribute('label'),'Reference mode');
  await page.locator('#lang-toggle-btn').click();
  await page.reload();await frame.locator('#enterSuno').click();await frame.locator('#submitMusic:not([disabled])').waitFor();
  await frame.locator('#musicView ic-radio[value="library"]').click();await frame.locator('.music-record').nth(2).waitFor();assert.equal(submissions.length,5,'Reload only reads history');
  failHistory=true;await frame.locator('#refreshMusic').click();await frame.locator('#historyStatus').getByText('加载失败，请刷新重试',{exact:true}).waitFor();failHistory=false;configured=false;
  await frame.locator('#refreshMusic').click();await frame.locator('#musicView ic-radio[value="create"]').click();
  await frame.locator('#submitMusic[disabled]').waitFor();configured=true;
  await frame.locator('#musicView ic-radio[value="library"]').click();await frame.locator('#refreshMusic').click();await frame.locator('#musicView ic-radio[value="create"]').click();await frame.locator('#submitMusic:not([disabled])').waitFor();
  await page.locator('#lang-toggle-btn').click();await frame.getByText('Live service · Pay per generation',{exact:true}).waitFor();
  assert.equal(await frame.locator('#songTitle').getAttribute('label'),'Song title');
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>window.setTheme?.(theme),theme);
   if(await page.locator('html').getAttribute('data-ui-theme')!==theme) await page.locator('#theme-toggle-btn').click();
   await frame.locator('html[data-ui-theme="'+theme+'"]').waitFor();
   await page.screenshot({path:'/private/tmp/suno-live-b-'+theme+'.png',fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
  assert.equal(await frame.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'Narrow layout must fit');
  await page.screenshot({path:'/private/tmp/suno-live-b-narrow.png',fullPage:true});
  assert.equal(await frame.locator('[ic-contract-error], [data-ic-contract-status="invalid"]').count(),0);
  assert.deepEqual(errors,[]);console.log('music lab B browser: PASS');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
