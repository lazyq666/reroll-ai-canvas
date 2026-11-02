// LAZ-71: exercise production image-resolution code with controlled load/decode timing.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/js/smart-canvas.js'), 'utf8');
const resolution = require('../static/js/smart-image-resolution.js');
const farPresentation = require('../static/js/smart-canvas/canvas-far-presentation.js');

function farBody(node, layout) {
    const ctx = {
        selectedImage:{nodeId:'',index:-1},
        nodeKinds:{isLayerDecomposition:()=>false,isPromptFamily:()=>false,isPromptGeneration:()=>false},
        smartContainer:{isFrame:()=>false}, smartMatting:{isActive:()=>false},
        imageForDisplay:image=>image,
        isAudioMediaItem:image=>image.kind === 'audio',
        isVideoMediaItem:image=>image.kind === 'video',
        mediaKindForItem:image=>image.kind || 'image',
        mediaAspectRatio:image=>(image.natural_w || 1)/(image.natural_h || 1),
        smartPreviewImgHtml:image=>`<img data-original-src="${image.url}">`,
        smartVideoPreviewHtml:()=>'<span class="video-poster"></span>',
        tr:key=>key, trf:(key,{count})=>`${key}:${count}`,
        MEDIA_GROUP_MAX_VISIBLE_ROWS:4, canvasFarPresentation:farPresentation,
    };
    vm.createContext(ctx);
    vm.runInContext(source.slice(source.indexOf('function farNodeBodyHtml('), source.indexOf('function jimengPendingBodyHtml(')),ctx);
    return ctx.farNodeBodyHtml(node,layout);
}

for(const count of [2,10]) test(`far mode preserves the grid of a ${count}-image node`,()=>{
    const images=Array.from({length:count},(_,i)=>({url:`/image-${i}.png`,kind:'image'}));
    const html=farBody({id:'image-group',type:'smart-image',images},
        {width:280,height:220,cols:count===2?2:4,rows:Math.ceil(count/4),visibleRows:3,thumb:50,gridHeight:180});
    assert.equal((html.match(/<img /g)||[]).length,count,'Far mode must show each visible group image, not just the first');
    images.forEach((image,i)=>{
        assert.ok(html.includes(`data-image-index="${i}"`),'Keep the original media index');
        assert.ok(html.includes(image.url),'Keep the image source');
    });
});

test('far media grid bounds mounted rows and preserves mixed-media aspect ratios without players',()=>{
    const images=Array.from({length:100},(_,i)=>({url:`/media-${i}`,kind:i===1?'audio':i===2?'video':'image',natural_w:100,natural_h:200}));
    const html=farBody({type:'smart-image',images}, {width:280,height:220,cols:4,thumb:50,gridHeight:180});
    assert.equal((html.match(/data-image-index=/g)||[]).length,8,'Only rows intersecting the visible grid should mount');
    assert.ok(html.includes('aspect-ratio:0.5'));
    assert.ok(html.includes('name="audio"'));
    assert.ok(html.includes('video-poster'));
    assert.doesNotMatch(html,/<video|<audio|<button|tabindex=/);
});

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
