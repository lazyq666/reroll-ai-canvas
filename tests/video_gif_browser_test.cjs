const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
(async () => {
 const server=http.createServer((req,res)=>{
  if(req.url==='/invalid-video.mp4'){res.writeHead(200,{'Content-Type':'video/mp4'}).end('not a video');return;}
  if(req.url==='/login-video.mp4'){res.writeHead(200,{'Content-Type':'text/html'}).end('<html>Login</html>');return;}
  const name=path.join(process.cwd(),decodeURIComponent(req.url.split('?')[0]));
  if(!fs.existsSync(name)||!fs.statSync(name).isFile()){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.html')?'text/html':'application/octet-stream');
  fs.createReadStream(name).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try {
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/grid_gif_encoder_harness.html`);
  const result=await page.evaluate(async()=>{
   window.StudioI18n={t:key=>key};
   const {createVideoGif,videoGifPlan}=await import('/static/js/smart-canvas/video-gif.js');
   for(const duration of [0,31,Infinity,NaN]) {let rejected=false;try{videoGifPlan(duration,100,100);}catch{rejected=true;}if(!rejected)throw Error('invalid duration accepted');}
   const canvas=document.createElement('canvas');canvas.width=1112;canvas.height=834;
   const ctx=canvas.getContext('2d');const stream=canvas.captureStream(10);const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});const chunks=[];
   recorder.ondataavailable=e=>chunks.push(e.data);
   const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
   for(let i=0;i<10;i++){ctx.fillStyle=i<5?'red':'blue';ctx.fillRect(0,0,canvas.width,canvas.height);await new Promise(resolve=>setTimeout(resolve,100));}
   recorder.stop();await stopped;stream.getTracks().forEach(track=>track.stop());
   // Recorded WebM has no duration metadata; seeking to the end lets Chrome determine it.
   const url=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));
   try {
    const result=await createVideoGif({sourceUrl:url});const bytes=Array.from(new Uint8Array(await result.blob.arrayBuffer()));
    return {width:result.width,height:result.height,header:String.fromCharCode(...bytes.slice(0,6)),bytes,plan:videoGifPlan(30,1920,1080)};
   }finally{URL.revokeObjectURL(url);}
  });
  assert.equal(result.header,'GIF89a');assert.equal(result.width,640);assert.equal(result.height,480);assert.equal(result.plan.width,640);assert.equal(result.plan.frames,300);
  fs.writeFileSync('/tmp/reroll-video-gif-test.gif',Buffer.from(result.bytes));
  const decoded=await require('sharp')(Buffer.from(result.bytes),{animated:true}).metadata();
  assert.ok(decoded.pages>=9); assert.equal(decoded.loop,0);
  const failures=await page.evaluate(async()=>{
   const {createVideoGif}=await import('/static/js/smart-canvas/video-gif.js');
   const failures=[];
   for(const url of ['/missing-video.mp4','/invalid-video.mp4','/login-video.mp4']) {
    try {await createVideoGif({sourceUrl:url});failures.push({url,code:'unexpected-success'});}
    catch(error) {failures.push({url,code:error.code,message:error.message});}
   }
   return failures;
  });
  assert.deepEqual(failures.map(f=>f.code),['videoMissing','videoDecodeFailed','videoLoadFailed']);
  assert.ok(failures.every(f=>!f.message.includes('smart.gif.failed')));

  await page.goto(`http://127.0.0.1:${server.address().port}/static/smart-canvas.html?componentReview=nodes`);
  await page.waitForFunction(()=>document.documentElement.dataset.nodesStatus==='ready');
  const labels=await page.evaluate(()=>{
    const node={id:'video-gif-test',type:'smart-image',images:[{url:'/test.mp4',kind:'video'}]};
    StudioI18n.set('zh');const zh=smartNodeToolbarHtml(node);
    StudioI18n.set('en');const en=smartNodeToolbarHtml(node);
    videoGifPending.add(node.id);const pending=smartNodeToolbarHtml(node);videoGifPending.delete(node.id);
    const english=StudioI18n.t('smart.gif.videoMissing');
    StudioI18n.set('zh');const chinese=StudioI18n.t('smart.gif.videoMissing');
    return {zh,en,pending,english,chinese};
  });
  assert.match(labels.english,/source video is missing/);assert.match(labels.chinese,/找不到原视频文件/);
  assert.match(labels.zh,/转 GIF/);assert.match(labels.en,/Convert to GIF/);
  assert.match(labels.pending,/data-smart-node-action="video-gif"[^>]*disabled|disabled[^>]*data-smart-node-action="video-gif"/);

  console.log('PASS: 1112×834 video → 640×480 GIF, Worker encoding, frame count, loops, missing-file/decode/login errors, bilingual toolbar and errors');
 } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
