const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const baseUrl=process.env.SMART_CANVAS_BASE_URL||'http://127.0.0.1:8799';
const theme=process.env.GOOEY_THEME||'dark';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.SMART_CANVAS_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage({viewport:{width:900,height:800}});
  await page.addInitScript(()=>{
   const raf=requestAnimationFrame;
   window.requestAnimationFrame=callback=>{
    if(callback.name==='draw'){
     window.liquidRequests=(window.liquidRequests||0)+1;
     if(window.liquidFrame?.callback!==callback)window.liquidFrame={callback,start:performance.now()};
     return 0;
    }
    return raf(callback);
   };
   window.stepLiquid=ms=>liquidFrame.callback(liquidFrame.start+ms);
  });
  await page.goto(baseUrl+'/static/design-system/infinite-canvas-ui/menu-popover-case.html?theme='+theme);
  await page.waitForFunction(()=>!!window.liquidFrame);
  const frames=[];
  for(const ms of [0,60,100,120,160,250,400,630]){
   const result=await page.evaluate(async ms=>{
    stepLiquid(ms);
    const menu=document.querySelector('[data-reference-generate-menu]'),svg=menu.shadowRoot.querySelector('.gooey-silhouette');
    if(!svg)return {ms,done:true};
    const circles=[...svg.querySelectorAll('circle')].map(c=>({x:+c.getAttribute('cx'),y:+c.getAttribute('cy'),r:+c.getAttribute('r')}));
    const item=menu.querySelector('ic-menu-item'),style=getComputedStyle(item.shadowRoot.querySelector('button'));
    // Rasterize the actual SVG silhouette without its shadow to inspect the neck.
    const clone=svg.cloneNode(true);clone.style.filter='none';clone.setAttribute('width',svg.viewBox.baseVal.width);clone.setAttribute('height',svg.viewBox.baseVal.height);clone.querySelector('g').setAttribute('fill','#fff');
    const img=new Image();img.src='data:image/svg+xml;base64,'+btoa(new XMLSerializer().serializeToString(clone));await img.decode();
    const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
    const view=svg.viewBox.baseVal;
    const origin=circles.at(-1);let neck=false;
    for(const c of circles.slice(0,-1)){
     const d=Math.hypot(c.x-origin.x,c.y-origin.y);
     if(d<=c.r+origin.r+1)continue;
     const px=Math.round((c.x+origin.x)/2-view.x),py=Math.round((c.y+origin.y)/2-view.y);
     if(ctx.getImageData(px,py,1,1).data[3]>100)neck=true;
    }
    return {ms,circles,neck,rotation:new DOMMatrix(getComputedStyle(menu.surface.querySelector("[part=close] ic-icon")).transform).b,border:style.borderTopColor,background:style.backgroundColor,outline:style.outlineStyle};
   },ms);
   frames.push(result);
   if(process.env.GOOEY_SCREENSHOTS && [60,120,160,250,630].includes(ms)){
    const box=await page.locator('[data-reference-generate-menu] [part="surface"][role="menu"]').boundingBox();
    await page.screenshot({path:`${process.env.GOOEY_SCREENSHOTS}-${ms}.png`,clip:{x:box.x-24,y:box.y-24,width:box.width+48,height:box.height+48}});
   }
  }

  assert(frames.filter(f=>f.circles).every(f=>f.circles.every(c=>c.r===22)),'Liquid pieces must retain their full mass while separating');
  assert(frames.some(f=>f.neck),'A visible liquid neck must bridge geometrically separated circles');
  assert(frames.some(f=>f.circles && Math.hypot(f.circles[0].x-f.circles.at(-1).x,f.circles[0].y-f.circles.at(-1).y)>65),'Opening needs the reference elastic overshoot');
  assert.equal(frames[2].border,'rgba(0, 0, 0, 0)','Individual borders must not slice the merged surface');
  assert.equal(frames[2].background,'rgba(0, 0, 0, 0)','Only the shared silhouette paints the moving surface');
  assert.equal(frames[2].outline,'none','Automatic focus must not cut through the liquid during entry');
  assert.equal(frames.at(-1).outline,'solid','Keyboard focus returns when the buttons settle');
  assert(frames[0].rotation < -.6 && frames.at(-1).rotation === 0,'Button-anchored menu retains its plus-to-X rotation');
  const requests=await page.evaluate(()=>liquidRequests);
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(()=>liquidRequests),requests,'Settled liquid schedules no animation frames');
  await page.locator('[data-reference-generate-menu] [part="close"]').click();
  const closing=[];
  for(const ms of [0,40,100,210,250,400,700]){
   closing.push(await page.evaluate(ms=>{
    stepLiquid(ms);
    const menu=document.querySelector('[data-reference-generate-menu]'),svg=menu.shadowRoot.querySelector('.gooey-silhouette');
    return {ms,open:menu.hasAttribute('open'),inert:menu.surface.inert,svg:!!svg,
     nudge:svg?new DOMMatrix(getComputedStyle(svg).transform).m42:0,
     mainNudge:new DOMMatrix(getComputedStyle(menu.surface.querySelector('[part="close"]')).transform).m42,
     opacity:svg?.style.opacity,centers:svg?[...svg.querySelectorAll('circle')].map(c=>[+c.getAttribute('cx'),+c.getAttribute('cy')]):[]};
   },ms));
  }
  assert(closing.slice(0,-1).every(f=>!f.open&&f.inert),'Closing liquid cannot accept a command');
  assert(closing.slice(0,-1).every(f=>f.nudge===f.mainNudge),'The entire liquid and main button recoil together');
  assert(closing.some(f=>f.nudge>4.9),'Closing retains the reference 5px anticipation');
  assert(closing.slice(0,-1).every(f=>f.opacity===''),'The liquid stays visible while merging');
  assert(closing[4].centers.every(c=>c[0]===closing[4].centers[0][0]&&c[1]===closing[4].centers[0][1]),'All circles have merged at 250ms');
  assert.equal(closing.at(-1).svg,false,'Closing releases the silhouette');
  console.log(JSON.stringify({opening:frames.map(({ms,neck})=>({ms,neck})),closing:closing.map(({ms,nudge,svg})=>({ms,nudge,svg})),idleFrames:0}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
