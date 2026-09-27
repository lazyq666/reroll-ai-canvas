const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const source=fs.readFileSync('static/js/smart-canvas.js','utf8');
const start=source.indexOf("document.getElementById('imageEditStage').addEventListener('wheel'");
const end=source.indexOf('\nwindow.addEventListener',start);
let handler, zooms=0;
const sandbox={document:{getElementById:()=>({addEventListener:(_type,fn)=>{handler=fn;}})},
    cropState:{},imageEditMode:'local-repair',imageEditZoom:1,
    applyImageEditZoom:()=>zooms++};
vm.createContext(sandbox);vm.runInContext(source.slice(start,end),sandbox);
const event={deltaY:120,clientX:0,clientY:0,defaultPrevented:false,
    preventDefault(){this.defaultPrevented=true;},stopPropagation(){},
    currentTarget:{scrollLeft:0,scrollTop:0,getBoundingClientRect:()=>({left:0,top:0})}};
handler(event);
assert.equal(event.defaultPrevented,false,'local repair panel and prompt must retain native wheel scrolling');
assert.equal(zooms,0,'repair wheel must not zoom the hidden image editor');
console.log('PASS: local repair wheel preserves native scrolling without hidden editor zoom');

const repair=fs.readFileSync('static/js/smart-canvas/image-repair.js','utf8');
const wheelStart=repair.indexOf("$('Frame').parentElement.addEventListener('wheel'");
const wheelEnd=repair.indexOf("    $('Canvas').addEventListener('pointerdown'",wheelStart);
const s={source:{},zoom:1,panX:0,panY:0};
const rect=()=>({left:100+s.panX+400*(1-s.zoom),top:60+s.panY+300*(1-s.zoom),width:800*s.zoom,height:600*s.zoom});
const preview={style:{},getBoundingClientRect:rect,parentElement:{addEventListener(type,fn,options){assert.equal(type,'wheel');assert.equal(options.passive,false);handler=fn;}}};
const repairSandbox={session:s,gesture:null,comparePointer:null,$:()=>preview,redraw(){}};
vm.createContext(repairSandbox);vm.runInContext(repair.slice(wheelStart,wheelEnd),repairSandbox);
function wheel(deltaY){const e={...event,deltaY,clientX:340,clientY:240,defaultPrevented:false};handler(e);assert.equal(e.defaultPrevented,true);}
function anchor(){const r=rect();return [(340-r.left)/r.width,(240-r.top)/r.height];}
const originalAnchor=anchor();
for(let i=0;i<10;i++)wheel(-120);
assert.ok(s.zoom>1,'wheel enlarges repair image');
anchor().forEach((v,i)=>assert.ok(Math.abs(v-originalAnchor[i])<1e-10,'rapid wheel events preserve pointer anchor'));
for(let i=0;i<100;i++)wheel(-120);
assert.equal(s.zoom,6,'maximum matches image editing');
const atMax=JSON.stringify(s);wheel(-120);assert.equal(JSON.stringify(s),atMax,'limit does not drift');
wheel(120);assert.ok(s.zoom<6,'can reverse at maximum');
for(let i=0;i<100;i++)wheel(120);
assert.equal(s.zoom,.15,'minimum matches image editing');
const atMin=JSON.stringify(s);wheel(120);assert.equal(JSON.stringify(s),atMin,'minimum does not drift');
wheel(-120);assert.ok(s.zoom>.15,'can reverse at minimum');
for(const [key,value] of [['gesture',{}],['comparePointer',1]]){
    repairSandbox[key]=value;const zoom=s.zoom;wheel(-120);assert.equal(s.zoom,zoom,'active gesture keeps projection fixed');repairSandbox[key]=null;
}
s.busy=true;const zoom=s.zoom;wheel(-120);assert.equal(s.zoom,zoom,'busy preview stays fixed');s.busy=false;
wheel(0);assert.equal(s.zoom,zoom,'horizontal-only scrolling does not zoom');
assert.equal(zooms,0,'repair never calls hidden image zoom');
console.log('PASS: repair zoom anchoring, limits, reversal and gesture isolation');

// Large patches must not allocate an unbounded bitmap when the view is enlarged.
let featherScale;
const patchSandbox={document:{createElement:()=>({getContext:()=>({getImageData:()=>({data:[]}),putImageData(){}})})},
    paintCover(){},geometry:{featherAlpha(w,h,feather){featherScale=feather;return [];}}};
vm.createContext(patchSandbox);
vm.runInContext(repair.slice(repair.indexOf('    function patchPreview('),repair.indexOf('    function draw(')),patchSandbox);
const patchSession={recipe:{transform:{width:12000,height:6000},feather:120},patch:{}};
const bitmap=patchSandbox.patchPreview(patchSession,.6);
assert.equal(bitmap.width,4096);assert.equal(bitmap.height,2048);
assert.equal(featherScale,120*4096/12000,'feather remains in original-pixel proportion');
console.log('PASS: enlarged patch preview has bounded resolution and proportional feather');
