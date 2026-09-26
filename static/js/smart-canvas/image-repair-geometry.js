/* Pure original-pixel geometry shared by repair authoring and adjustment. */
(function(root){
    'use strict';
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    function relativeBounds(selection, box){
        if(!selection || !box || !(box.width>0 && box.height>0)) return null;
        const percent=(value,start,size)=>Math.round(clamp((value-start)/size*100,0,100)*100)/100;
        return {
            left:percent(selection.x,box.x,box.width),
            top:percent(selection.y,box.y,box.height),
            right:percent(selection.x+selection.width,box.x,box.width),
            bottom:percent(selection.y+selection.height,box.y,box.height)
        };
    }
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
        const margin = Math.max(32, Math.min(w,h)*.35);
        const desiredW = Math.min(width, w+margin*2), desiredH = Math.min(height,h+margin*2);
        const choices = (preferred ? ratios.filter(r=>r===preferred) : ratios).map(ratio=>{
            const [a,b] = ratio.split(':').map(Number);
            if(!(a>0 && b>0)) return null;
            const step = Math.ceil(Math.max(desiredW/a,desiredH/b));
            const cw = a*step, ch = b*step;
            const cx = Math.round(x+w/2-cw/2), cy = Math.round(y+h/2-ch/2);
            return {ratio, x:cw<=width?clamp(cx,0,width-cw):cx, y:ch<=height?clamp(cy,0,height-ch):cy, width:cw,height:ch};
        }).filter(Boolean).filter(box=>box.width*box.height<=40000000 && Math.max(box.width,box.height)<=30000);
        choices.sort((a,b)=>(a.width*a.height-b.width*b.height));
        return choices[0] || null;
    }
    // Resize around the center, preserving the model ratio and all selected pixels.
    function resize(box, factor, minimum=box){
        const [a,b]=box.ratio.split(':').map(Number);
        const cx=box.x+box.width/2,cy=box.y+box.height/2;
        const minW=2*Math.max(cx-minimum.x,minimum.x+minimum.width-cx);
        const minH=2*Math.max(cy-minimum.y,minimum.y+minimum.height-cy);
        const lower=Math.ceil(Math.max(minW/a,minH/b,1));
        const upper=Math.floor(Math.min(Math.sqrt(40000000/(a*b)),30000/Math.max(a,b)));
        if(lower>upper)return box;
        const step=clamp(Math.round(box.width*factor/a),lower,upper);
        return {...box,x:Math.round(cx-a*step/2),y:Math.round(cy-b*step/2),width:a*step,height:b*step};
    }
    function edge(box, point, tolerance){
        if(!box)return '';
        const left=Math.abs(point.x-box.x)<=tolerance,right=Math.abs(point.x-box.x-box.width)<=tolerance;
        const top=Math.abs(point.y-box.y)<=tolerance,bottom=Math.abs(point.y-box.y-box.height)<=tolerance;
        if(point.x<box.x-tolerance||point.x>box.x+box.width+tolerance||point.y<box.y-tolerance||point.y>box.y+box.height+tolerance)return '';
        return (top?'n':bottom?'s':'')+(left?'w':right?'e':'');
    }
    function nearestResolution(box, tiers){
        const target = Math.max(box?.width||1,box?.height||1);
        return tiers.map((tier,index)=>({tier,index,size:parseFloat(tier)*1024})).filter(t=>t.size>0)
            .sort((a,b)=>Math.abs(a.size-target)-Math.abs(b.size-target)||a.index-b.index)[0]?.tier || tiers[0] || '';
    }
    function featherAlpha(width,height,feather){
        const alpha = new Uint8ClampedArray(width*height);
        // Zero-hardness eraser centered on each edge; feather is its diameter.
        // Only the inner half of the stroke intersects the patch. The two
        // edge passes multiply at corners; the untouched center stays opaque.
        const ramp=length=>Array.from({length},(_,i)=>{
            const t=feather>0?clamp(2*Math.min(i+.5,length-i-.5)/feather,0,1):1;
            return Math.floor(t*t*(3-2*t)*255+.5);
        });
        const horizontal=ramp(width),vertical=ramp(height);
        for(let y=0;y<height;y++) for(let x=0;x<width;x++){
            alpha[y*width+x] = Math.floor(horizontal[x]*vertical[y]/255);
        }
        return alpha;
    }
    function scaled(crop, scale, current=crop){
        const width=Math.max(1,Math.round(crop.width*scale)),height=Math.max(1,Math.round(crop.height*scale));
        return {x:Math.round(current.x+(current.width-width)/2),y:Math.round(current.y+(current.height-height)/2),width,height};
    }
    root.SmartCanvasModules = root.SmartCanvasModules || {};
    root.SmartCanvasModules.imageRepairGeometry = Object.freeze({relativeBounds,crop,resize,edge,nearestResolution,preferredModel,featherAlpha,scaled});
})(typeof window==='undefined'?globalThis:window);
