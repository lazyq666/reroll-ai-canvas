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
