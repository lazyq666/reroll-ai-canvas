/* Read-only Frame raster export. No Canvas mutations or live viewport DOM. */
(function(root){
    'use strict';
    const LIMITS = Object.freeze({edge:8192, pixels:32000000, resourceMs:30000, taskMs:120000});
    const fail = code => Object.assign(new Error(code), {code});
    function dimensions(rect, scale=1){
        const width = Math.round(Number(rect?.width) * scale);
        const height = Math.round(Number(rect?.height) * scale);
        return {width, height, ok:[1,2].includes(scale) && Number.isFinite(width) && Number.isFinite(height)
            && width > 0 && height > 0 && width <= LIMITS.edge && height <= LIMITS.edge && width * height <= LIMITS.pixels};
    }
    function members(nodes, frameId){
        const byId = new Map(nodes.map(node => [node.id,node]));
        const seen = new Set();
        function visit(id){
            const node = byId.get(id);
            if(!node || seen.has(id)) return;
            seen.add(id);
            if(['smart-frame','smart-group'].includes(node.type)) (node.items || []).forEach(visit);
        }
        if(byId.get(frameId)?.type === 'smart-frame') visit(frameId);
        return nodes.filter(node => seen.has(node.id));
    }
    function check(signal){ if(signal?.aborted) throw signal.reason || fail('cancelled'); }
    function bounded(promise, signal, timeout=LIMITS.resourceMs){
        return new Promise((resolve,reject) => {
            let timer;
            const finish = (fn,value) => { clearTimeout(timer); signal?.removeEventListener('abort',abort); fn(value); };
            const abort = () => finish(reject,signal.reason || fail('cancelled'));
            if(signal?.aborted){ abort(); return; }
            signal?.addEventListener('abort',abort,{once:true});
            timer = setTimeout(() => finish(reject,fail('timeout')),timeout);
            Promise.resolve(promise).then(value => finish(resolve,value),error => finish(reject,error));
        });
    }
    const pause = signal => bounded(new Promise(resolve => setTimeout(resolve,0)),signal);
    function rectOf(element, origin){
        const r = element.getBoundingClientRect();
        return {x:r.left-origin.left, y:r.top-origin.top, width:r.width, height:r.height};
    }
    function clipRect(ctx, rect, radius=0){
        ctx.beginPath();
        if(radius && ctx.roundRect) ctx.roundRect(rect.x,rect.y,rect.width,rect.height,radius);
        else ctx.rect(rect.x,rect.y,rect.width,rect.height);
        ctx.clip();
    }
    function clipsFor(element, node, origin){
        const clips = [];
        for(let parent=element.parentElement; parent; parent=parent.parentElement){
            const style = getComputedStyle(parent);
            if(['hidden','auto','scroll','clip'].includes(style.overflowX) || ['hidden','auto','scroll','clip'].includes(style.overflowY)){
                clips.push({rect:rectOf(parent,origin),radius:parseFloat(style.borderTopLeftRadius) || 0});
            }
            if(parent === node) break;
        }
        return clips;
    }
    // Range measures grapheme positions with the production font and browser line breaking.
    function textPlan(element, origin){
        const style = getComputedStyle(element);
        const text = element.firstChild;
        const glyphs = [];
        if(text?.nodeType !== 3) return {glyphs};
        const range = document.createRange();
        const segments = new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text.textContent);
        for(const {segment,index} of segments){
            if(segment === '\n' || segment === '\r') continue;
            range.setStart(text,index); range.setEnd(text,index+segment.length);
            const rect = range.getBoundingClientRect();
            glyphs.push({text:segment,x:rect.left-origin.left,y:rect.top-origin.top,height:rect.height});
        }
        return {glyphs,font:style.font, color:style.color, direction:style.direction};
    }
    async function measure(snapshot,signal){
        const host = document.createElement('div');
        host.className = 'world smart-frame-export-measure';
        host.setAttribute('aria-hidden','true');
        host.inert = true;
        document.body.append(host);
        const plans = [];
        const texts = [];
        try {
            for(const entry of snapshot.entries){
                check(signal);
                const template = document.createElement('template');
                template.innerHTML = entry.html;
                // Templates are inert. Remove every media source before mounting for measurement.
                template.content.querySelectorAll('[src],[srcset],[poster]').forEach(el => {
                    el.removeAttribute('src'); el.removeAttribute('srcset'); el.removeAttribute('poster');
                });
                template.content.querySelectorAll('img').forEach(img => {
                    img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E';
                    img.style.visibility = 'hidden';
                });
                template.content.querySelectorAll('.selected,.image-selected,.dragging').forEach(el => el.classList.remove('selected','image-selected','dragging'));
                host.replaceChildren(template.content);
                const node = host.firstElementChild;
                node.style.left = '0px'; node.style.top = '0px';
                const origin = node.getBoundingClientRect();
                const style = getComputedStyle(node);
                const plan = {x:entry.x, y:entry.y, z:Number(style.zIndex) || 0, order:entry.order, commands:[]};
                if(entry.type === 'smart-frame'){
                    plan.commands.push({kind:'background',rect:{x:0,y:0,width:entry.width,height:entry.height},radius:parseFloat(style.borderTopLeftRadius)||0,color:style.backgroundColor});
                } else if(entry.type === 'smart-text'){
                    const element = node.querySelector('.smart-canvas-text');
                    if(element?.textContent){
                        const textStyle=getComputedStyle(element);
                        for(const key of ['font','color','letterSpacing','lineHeight','whiteSpace','overflowWrap','maxWidth','direction']) element.style[key]=textStyle[key];
                        texts.push({node,element,plan,font:textStyle.font});
                    }
                } else if(entry.type === 'smart-brush'){
                    const path = node.querySelector('.smart-brush-stroke');
                    const svg = path?.closest('svg');
                    if(path && svg){
                        const ps = getComputedStyle(path);
                        plan.commands.push({kind:'brush',path:path.getAttribute('d'),rect:rectOf(svg,origin),view:svg.viewBox.baseVal.width ? {width:svg.viewBox.baseVal.width,height:svg.viewBox.baseVal.height} : {width:entry.width,height:entry.height},color:ps.stroke,width:parseFloat(ps.strokeWidth),opacity:Number(ps.strokeOpacity)*Number(ps.opacity)});
                    }
                } else {
                    node.querySelectorAll('[data-image-index]').forEach(slot => {
                        const key = `${slot.dataset.refNodeId || entry.id}:${slot.dataset.refImageIndex ?? slot.dataset.imageIndex}`;
                        const url = entry.images[key];
                        const img = slot.querySelector('img');
                        if(!url || !img) return;
                        const is = getComputedStyle(img);
                        const r = rectOf(img,origin);
                        const left = parseFloat(is.borderLeftWidth)||0, top = parseFloat(is.borderTopWidth)||0;
                        r.x += left; r.y += top;
                        r.width -= left+(parseFloat(is.borderRightWidth)||0);
                        r.height -= top+(parseFloat(is.borderBottomWidth)||0);
                        plan.commands.push({kind:'image',url,rect:r,fit:is.objectFit,position:is.objectPosition,radius:parseFloat(is.borderTopLeftRadius)||0,clips:clipsFor(img,node,origin)});
                    });
                }
                plans.push(plan);
            }
            // Geometry and theme styles above are frozen before the first asynchronous wait.
            for(const item of texts){
                try { await bounded(document.fonts.load(item.font,item.element.textContent),signal); }
                catch(error){ if(error.code) throw error; throw fail('font'); }
                check(signal);
                host.replaceChildren(item.node);
                item.plan.commands.push({kind:'text',...textPlan(item.element,item.node.getBoundingClientRect())});
            }
        } finally { host.remove(); }
        return plans.sort((a,b) => a.z-b.z || a.order-b.order);
    }
    async function loadImage(url,signal){
        const request = new AbortController();
        const abort = () => request.abort(signal.reason);
        signal.addEventListener('abort',abort,{once:true});
        const timer = setTimeout(() => request.abort(fail('timeout')),LIMITS.resourceMs);
        let objectUrl;
        let img;
        try {
            check(signal);
            const response = await fetch(url,{signal:request.signal});
            if([401,403].includes(response.status)) throw fail('forbidden');
            if(!response.ok) throw fail('image');
            objectUrl = URL.createObjectURL(await response.blob());
            img = new Image();
            const loaded = new Promise((resolve,reject) => { img.onload=resolve; img.onerror=() => reject(fail('image')); });
            img.src = objectUrl;
            await bounded(loaded,request.signal);
            check(signal);
            if(!img.naturalWidth || !img.naturalHeight) throw fail('image');
            return {image:img,release(){img.src=''; URL.revokeObjectURL(objectUrl);}};
        } catch(error){
            if(img) img.src='';
            if(objectUrl) URL.revokeObjectURL(objectUrl);
            throw signal.aborted ? signal.reason : request.signal.aborted ? request.signal.reason : error.code ? error : fail('image');
        } finally { clearTimeout(timer); signal.removeEventListener('abort',abort); }
    }
    function drawImage(ctx,img,command){
        const r=command.rect;
        if(r.width<=0 || r.height<=0) return;
        let width=r.width,height=r.height;
        if(['contain','cover','none','scale-down'].includes(command.fit)){
            const ratio=command.fit==='cover' ? Math.max(r.width/img.naturalWidth,r.height/img.naturalHeight)
                : command.fit==='none' ? 1 : Math.min(r.width/img.naturalWidth,r.height/img.naturalHeight,command.fit==='scale-down'?1:Infinity);
            width=img.naturalWidth*ratio; height=img.naturalHeight*ratio;
        }
        const position=String(command.position || '50% 50%').split(' ');
        const offset=(value,space) => value.endsWith('%') ? parseFloat(value)/100*space : parseFloat(value)||0;
        (command.clips||[]).forEach(clip => clipRect(ctx,clip.rect,clip.radius));
        clipRect(ctx,r,command.radius);
        ctx.drawImage(img,r.x+offset(position[0],r.width-width),r.y+offset(position[1]||position[0],r.height-height),width,height);
    }
    async function render(snapshot,scale,{signal,onPhase=()=>{}}){
        const size=dimensions(snapshot.rect,scale);
        if(!size.ok) throw fail('oversized');
        check(signal);
        onPhase('preparing');
        const plans=await measure(snapshot,signal);
        check(signal);
        const output=document.createElement('canvas');
        output.width=size.width; output.height=size.height;
        try {
            const ctx=output.getContext('2d');
            if(!ctx) throw fail('render');
            ctx.fillStyle=snapshot.background; ctx.fillRect(0,0,size.width,size.height);
            ctx.scale(scale,scale);
            onPhase('rendering');
            for(const plan of plans){
                check(signal);
                ctx.save(); ctx.translate(plan.x-snapshot.rect.x,plan.y-snapshot.rect.y);
                try {
                    for(const command of plan.commands){
                        check(signal);
                        ctx.save();
                        try {
                            if(command.kind==='background'){
                                clipRect(ctx,command.rect,command.radius); ctx.fillStyle=command.color;
                                ctx.fillRect(0,0,command.rect.width,command.rect.height);
                            } else if(command.kind==='image'){
                                const media=await loadImage(command.url,signal);
                                try { check(signal); drawImage(ctx,media.image,command); } finally { media.release(); }
                            } else if(command.kind==='brush'){
                                ctx.translate(command.rect.x,command.rect.y);
                                ctx.scale(command.rect.width/command.view.width,command.rect.height/command.view.height);
                                ctx.strokeStyle=command.color; ctx.lineWidth=command.width; ctx.globalAlpha=command.opacity;
                                ctx.lineCap='round'; ctx.lineJoin='round'; ctx.stroke(new Path2D(command.path));
                            } else if(command.kind==='text'){
                                ctx.font=command.font; ctx.fillStyle=command.color; ctx.direction=command.direction;
                                ctx.textAlign='left'; ctx.textBaseline='alphabetic';
                                const metrics=ctx.measureText('Mg');
                                const ascent=metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
                                const descent=metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
                                for(const glyph of command.glyphs) ctx.fillText(glyph.text,glyph.x,glyph.y+(glyph.height-ascent-descent)/2+ascent);
                            }
                        } finally {ctx.restore();}
                    }
                } finally {ctx.restore();}
                await pause(signal);
            }
            const blob=await bounded(new Promise(resolve => output.toBlob(resolve,'image/png')),signal,LIMITS.taskMs);
            check(signal);
            if(!blob?.size) throw fail('render');
            return blob;
        } finally { output.width=0; output.height=0; }
    }
    const api={LIMITS,dimensions,members,render};
    if(typeof module==='object' && module.exports) module.exports=api;
    root.SmartCanvasModules ||= {};
    root.SmartCanvasModules.frameImageExportEngine=Object.freeze(api);
})(typeof window==='undefined'?globalThis:window);
