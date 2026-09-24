/* Pure original-pixel geometry shared by repair authoring and adjustment. */
(function(root){
    'use strict';
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    function preferredModel(entries){
        const score = entry => {
            const name = `${entry.name || ''} ${entry.model || ''}`.toLowerCase();
            return name.includes('gpt-image-2.5-suburst') ? 0 : name.includes('gpt-image-2') ? 1 : 2;
        };
        return entries.map((entry, index) => ({entry,index})).sort((a,b) => score(a.entry)-score(b.entry) || a.index-b.index)[0]?.entry || null;
    }
    function crop(bounds, width, height, ratios, preferred=''){
        if(!bounds || !(width > 0 && height > 0)) return null;
        const x = clamp(bounds.x, 0, width), y = clamp(bounds.y, 0, height);
        const w = clamp(bounds.width, 1, width-x || 1), h = clamp(bounds.height, 1, height-y || 1);
        const margin = Math.max(8, Math.min(w,h)*.15);
        const desiredW = Math.min(width, w+margin*2), desiredH = Math.min(height,h+margin*2);
        const choices = (preferred ? ratios.filter(r=>r===preferred) : ratios).map(ratio=>{
            const [a,b] = ratio.split(':').map(Number);
            if(!(a>0 && b>0)) return null;
            const step = Math.ceil(Math.max(desiredW/a,desiredH/b));
            const cw = a*step, ch = b*step;
            const cx = Math.round(x+w/2-cw/2), cy = Math.round(y+h/2-ch/2);
            return {ratio, x:cw<=width?clamp(cx,0,width-cw):cx, y:ch<=height?clamp(cy,0,height-ch):cy, width:cw,height:ch};
        }).filter(Boolean).filter(box=>box.width*box.height<=40000000);
        choices.sort((a,b)=>(a.width*a.height-b.width*b.height));
        return choices[0] || null;
    }
    function nearestResolution(box, tiers){
        const target = Math.max(box?.width||1,box?.height||1);
        return tiers.map((tier,index)=>({tier,index,size:parseFloat(tier)*1024})).filter(t=>t.size>0)
            .sort((a,b)=>Math.abs(a.size-target)-Math.abs(b.size-target)||a.index-b.index)[0]?.tier || tiers[0] || '';
    }
    function featherAlpha(width,height,feather){
        const alpha = new Uint8ClampedArray(width*height);
        for(let y=0;y<height;y++) for(let x=0;x<width;x++){
            alpha[y*width+x] = feather>0 ? Math.floor(clamp(Math.min(x+.5,y+.5,width-x-.5,height-y-.5)/feather,0,1)*255+.5) : 255;
        }
        return alpha;
    }
    function scaled(crop, scale, current=crop){
        const width=Math.max(1,Math.round(crop.width*scale)),height=Math.max(1,Math.round(crop.height*scale));
        return {x:Math.round(current.x+(current.width-width)/2),y:Math.round(current.y+(current.height-height)/2),width,height};
    }
    root.SmartCanvasModules = root.SmartCanvasModules || {};
    root.SmartCanvasModules.imageRepairGeometry = Object.freeze({crop,nearestResolution,preferredModel,featherAlpha,scaled});
})(typeof window==='undefined'?globalThis:window);
