const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const sharp = require('sharp');
const baseUrl = process.env.SMART_CANVAS_BASE_URL || 'http://127.0.0.1:8799';
(async () => {
  const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  try {
    for (const dpr of [1,2]) {
      const page = await browser.newPage({viewport:{width:1100,height:800},deviceScaleFactor:dpr});
      await page.addInitScript(() => {
        window.metalCopies = [];
        const original = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function(...args) {
          if (this.canvas.closest('.ic-metal-effect')) window.metalCopies.push(performance.now());
          return original.apply(this,args);
        };
      });
      await page.goto(`${baseUrl}/static/design-system/infinite-canvas-ui/composer.html`);
      await page.waitForFunction(() => document.querySelector('[data-metal-state="running"]'));
      await page.waitForTimeout(800);
      await page.evaluate(() => {window.metalCopies=[]});
      await page.waitForTimeout(1500);
      const result=await page.evaluate(() => { const host=document.querySelector('[effect="metal"]'),c=host.shadowRoot.querySelector('canvas');return {dpr:devicePixelRatio,width:host.clientWidth,backingWidth:c.width,frames:metalCopies.length,fps:(metalCopies.length-1)*1000/(metalCopies.at(-1)-metalCopies[0])}; });
      console.log(JSON.stringify(result));
      // Compare the composited effect against the ordinary button. Decoration
      // must not paint pixels beyond the circular button frame (including glow).
      await page.evaluate(() => {Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
      for(const state of ['normal','pressed']) {
        await page.locator('[effect="metal"]').evaluate((h,state)=>{h.setAttribute('data-preview-state',state);h.shadowRoot.querySelector('.ic-metal-effect').style.visibility='visible';},state);
        await page.waitForTimeout(250);
      const rect=await page.locator('[effect="metal"]').evaluate(h=>h.shadowRoot.querySelector('[part~="base"]').getBoundingClientRect().toJSON());
      const clip={x:Math.floor(rect.x)-12,y:Math.floor(rect.y)-12,width:Math.ceil(rect.width)+25,height:Math.ceil(rect.height)+25};
      const before=await sharp(await page.screenshot({clip})).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      await page.locator('[effect="metal"]').evaluate(h=>h.shadowRoot.querySelector('.ic-metal-effect').style.visibility='hidden');
      const after=await sharp(await page.screenshot({clip})).ensureAlpha().raw().toBuffer();
      let outside=0;
      for(let y=0;y<before.info.height;y++)for(let x=0;x<before.info.width;x++){
        const dx=(x+.5)/dpr-(rect.x+rect.width/2-clip.x),dy=(y+.5)/dpr-(rect.y+rect.height/2-clip.y);
        if(Math.hypot(dx,dy)<=rect.width/2+1)continue;
        const i=(y*before.info.width+x)*4;
        if([0,1,2].some(c=>Math.abs(before.data[i+c]-after[i+c])>3))outside++;
      }
      assert.equal(outside,0,'Metal decoration leaks outside the circular button frame');
      }
      assert(result.fps>=12 && result.fps<=17, 'Metal respects the requested 15 FPS cadence');
      assert(result.backingWidth >= result.width*Math.min(4,result.dpr*2), 'Metal ring needs supersampling for thin curved edges');
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
