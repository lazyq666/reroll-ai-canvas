// LAZ-71: exercise production image-resolution code with controlled load/decode timing.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/js/smart-canvas.js'), 'utf8');
const resolution = require('../static/js/smart-image-resolution.js');
function harness() {
    const loads = [];
    class Image {
        constructor() { loads.push(this); this.naturalWidth = 512; }
        decode() { return Promise.resolve(); }
    }
    let state = {mode:'detail', resourceGeneration:0};
    const ctx = {
        Image, URL, setTimeout, clearTimeout, window:{devicePixelRatio:1,location:{origin:'http://localhost'}},
        shell:{getBoundingClientRect:()=>({left:0,top:0,right:1440,bottom:900,width:1440,height:900})},
        viewport:{scale:1}, SmartImageResolution:resolution, smartImagePerformanceOptimization:true,
        canvasLevelOfDetail:{diagnostics:()=>state},
        smartOriginalMediaUrl:url=>url,
        smartMediaPreviewUrl:(url,size)=>`/api/media-preview?w=${size}&url=${encodeURIComponent(url)}`,
        displayMediaUrl:({url})=>url,
    };
    vm.createContext(ctx);
    vm.runInContext(source.slice(source.indexOf('const SMART_ADAPTIVE_IMAGE_DELAY'), source.indexOf('function refreshSmartCanvasSettings()')), ctx);
    function img(size=512) {
        const url='/assets/fixture.png';
        let src=ctx.smartMediaPreviewUrl(url,size);
        return {dataset:{originalSrc:url,previewSrc:src,previewSize:String(size),mediaState:'ready'},
            isConnected:true,offsetWidth:900,offsetHeight:600,
            matches:()=>true, getBoundingClientRect:()=>({left:0,top:0,right:900,bottom:600}),
            getAttribute:name=>name==='src'?src:null,
            get src(){return src;},set src(value){src=value;}};
    }
    const tick = () => new Promise(resolve=>setImmediate(resolve));
    const load = async (index=loads.length-1) => { await loads[index].onload(); await tick(); };
    function mode(value) { state={mode:value,resourceGeneration:state.resourceGeneration+1}; ctx.viewport.scale=value==='far'?.2:1; }
    return {ctx,loads,img,tick,load,mode};
}
test('slow upgrade retains the current bitmap, ready state, and actual resolution until decoded', async()=>{
    const h=harness(), img=h.img(); const original=img.src;
    h.ctx.refreshSmartAdaptiveImageResolution(img);
    assert.equal(img.src,original);
    assert.equal(img.dataset.mediaState,'ready');
    assert.equal(img.dataset.previewSize,'512');
    let decoded; h.loads[0].decode=()=>new Promise(resolve=>{decoded=resolve;});
    const loading=h.load(0); await h.tick();
    assert.equal(img.src,original);
    decoded(); await loading;
    assert.equal(img.dataset.previewSize,'1024');
    assert.match(img.src,/w=1024/);
});
for(const failure of ['network','decode']) test(`${failure} failure keeps visible image and permits retry`,async()=>{
    const h=harness(),img=h.img(),before=img.src;
    h.ctx.refreshSmartAdaptiveImageResolution(img);
    if(failure==='network') { h.loads[0].onerror(); await h.tick(); }
    else { h.loads[0].decode=()=>Promise.reject(new Error('decode failed')); await h.load(0); }
    assert.equal(img.src,before);
    assert.equal(img.dataset.previewSize,'512');
    assert.equal(img.dataset.mediaState,'ready');
    h.ctx.refreshSmartAdaptiveImageResolution(img);
    assert.equal(h.loads.length,2);
    await h.load(1); assert.match(img.src,/w=1024/);
});
test('a pending downgrade cannot overwrite detail after a rapid reversal',async()=>{
    const h=harness(),img=h.img(1024),before=img.src;
    h.mode('far'); h.ctx.refreshSmartAdaptiveImageResolution(img);
    assert.equal(img.src,before);
    h.mode('detail'); // Before the next scheduled adaptive refresh.
    await h.load(0); assert.equal(img.src,before);
    h.ctx.refreshSmartAdaptiveImageResolution(img);
    assert.equal(img.dataset.previewSize,'1024');
});
test('a detached image ignores a late upgrade',async()=>{
    const h=harness(),img=h.img(),before=img.src;
    h.ctx.refreshSmartAdaptiveImageResolution(img); img.isConnected=false;
    await h.load(); assert.equal(img.src,before);
});
test('far downgrade swaps only after decoding and releases the old source reference',async()=>{
    const h=harness(),img=h.img(2048),before=img.src;
    h.mode('far'); h.ctx.refreshSmartAdaptiveImageResolution(img);
    assert.equal(img.src,before);
    await h.load(); assert.match(img.src,/w=512/); assert.equal(img.dataset.previewSize,'512');
});
test('concurrent consumers share one pending decode; later uses validate decode again',async()=>{
    const h=harness();
    const first=h.ctx.preloadSmartAdaptivePreview('/same.png');
    const second=h.ctx.preloadSmartAdaptivePreview('/same.png');
    assert.equal(h.loads.length,1); await h.load(); assert.equal(await first,true); assert.equal(await second,true);
    const later=h.ctx.preloadSmartAdaptivePreview('/same.png');
    assert.equal(h.loads.length,2,'a previously loaded URL does not guarantee a decoded image remains cached');
    await h.load(); assert.equal(await later,true);
});
