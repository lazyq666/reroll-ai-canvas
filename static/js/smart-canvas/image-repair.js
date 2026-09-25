/* Image Studio local repair. Drafts and recipes use original-image pixels. */
(function(){
    'use strict';
    const geometry = window.SmartCanvasModules.imageRepairGeometry;
    const $ = id => document.getElementById(`imageRepair${id}`);
    const clone = value => JSON.parse(JSON.stringify(value));
    const text = key => tr(`smart.repair.${key}`);
    let session = null, gesture = null, frame = 0;
    function currentMedia(s=session){ return nodes.find(node=>node.id===s?.nodeId)?.images?.[s?.imageIndex]; }
    function message(key){ if(session){session.message=key; $('Status').textContent=text(key);} }
    function control(id,value){ setImageStudioControlValue($(id),value); }
    function redraw(){ if(!frame) frame=requestAnimationFrame(()=>{frame=0;draw();}); }
    function busy(value){
        if(!session) return;
        session.busy=value;
        $('CompareHandle').setAttribute('aria-disabled',String(value));
        $('Editor').querySelectorAll('ic-select,ic-slider,ic-number-input,ic-textarea,ic-button,ic-icon-button,ic-switch,ic-generation-settings-picker').forEach(el=>{
            el.disabled=value;el.toggleAttribute('disabled',value);
        });
        if(!value) sync();
    }
    function validSource(s){ return currentMedia(s)?.url===s.expectedUrl; }
    function draftKey(s){ return String(s.media.media_id||s.media.output_media_id||s.media.url); }
    function saveDraft(){
        const s=session;
        if(!s || s.busy || !s.source || !validSource(s)) return;
        const node=nodes.find(n=>n.id===s.nodeId);
        const draft=s.recipe
            ? {version:1,expectedUrl:s.expectedUrl,transform:s.recipe.transform,feather:s.recipe.feather,recipeVersion:s.recipe.version}
            : {version:1,width:s.width,height:s.height,strokes:s.strokes,box:s.box,prompt:String($('Prompt').value||''),model:s.model?.id||'',ratio:s.ratio||'',resolution:s.resolution||'',count:s.count||1,transparentPng:s.transparentPng===true};
        const field=s.recipe?'localRepairAdjustmentDrafts':'localRepairDrafts';
        window.SmartCanvasModules.canvasMutation.update({nodeId:node.id,mutate:target=>{
            target[field]={...(target[field]||{}),[draftKey(s)]:clone(draft)};
        },options:{render:false,select:false}});
        window.SmartCanvasModules.canvasPersistence.schedule();
    }
    async function loadImage(media){
        const raw=smartOriginalMediaUrl(media);
        const urls=[displayMediaUrl({url:raw}),proxiedMediaUrl({url:raw})].filter(Boolean);
        for(const url of [...new Set(urls)]){
            try { return await new Promise((resolve,reject)=>{
                const img=new Image(); img.crossOrigin='anonymous';
                img.onload=()=>img.naturalWidth?resolve(img):reject(new Error(text('loadFailed')));
                img.onerror=()=>reject(new Error(text('loadFailed'))); img.src=url;
            }); } catch(error){ if(url===urls.at(-1)) throw error; }
        }
        throw new Error(text('loadFailed'));
    }
    function bounds(){
        const points=(session?.strokes||[]).flatMap(stroke=>stroke.points.map(p=>({x:p.x,y:p.y,r:stroke.tool==='brush'?stroke.size/2:0})));
        if(!points.length) return null;
        const left=Math.min(...points.map(p=>p.x-p.r)),top=Math.min(...points.map(p=>p.y-p.r));
        const right=Math.max(...points.map(p=>p.x+p.r)),bottom=Math.max(...points.map(p=>p.y+p.r));
        return {x:Math.max(0,left),y:Math.max(0,top),width:Math.min(session.width,right)-Math.max(0,left),height:Math.min(session.height,bottom)-Math.max(0,top)};
    }
    function updateCrop(resetResolution=true, preserve=false){
        const s=session;
        if(!s || s.recipe) return;
        const automatic=geometry.crop(bounds(),s.width,s.height,s.ratios||[],s.ratio);
        s.box=preserve && s.box && bounds() && s.ratios.includes(s.box.ratio) && (!s.ratio||s.ratio===s.box.ratio) ? geometry.resize(s.box,1,bounds()) : automatic;
        if(s.box && resetResolution) s.resolution=geometry.nearestResolution(s.box,s.tiers||[]);
        $('Settings').resolution=s.resolution||'';
        sync(); redraw();
    }
    async function chooseModel(id){
        const s=session;
        s.model=s.models.find(model=>model.id===id)||null;
        if(!s.model){message('noModels');sync();return;}
        const capability=s.model.capability;
        s.maximumCount=Math.min(8,window.SmartCanvasModules.modelCapabilities.outputCountMaximum(capability,1));
        s.count=Math.max(1,Math.min(s.maximumCount,Math.round(Number(s.count)||1)));
        s.ratios=capability.media_contract?.aspect_ratios || capability.parameters?.aspect_ratio?.values || [];
        s.tiers=capability.media_contract?.resolution_tiers || capability.parameters?.resolution_tier?.values || [];
        if(!s.ratios.includes(s.ratio)) s.ratio='';
        $('Settings').setAttribute('ratio-presets',['adaptive',...s.ratios].join(','));
        $('Settings').ratio=s.ratio||'adaptive';
        if(!s.tiers.includes(s.resolution)) s.resolution=s.tiers[0]||'';
        $('Settings').setAttribute('resolutions',s.tiers.join(','));
        $('Settings').toggleAttribute('hide-resolution',!s.tiers.length);
        $('Model').querySelector('[slot="start"]').innerHTML=smartModelVendorIconMarkup(s.model.model,s.model.provider_id,s.model.provider_name);
        if(!s.model.imageCapability.supports_transparent_png)s.transparentPng=false;
        updateCrop(true,true); saveDraft();
    }
    function syncSelect(id,options,value){
        const select=$(id),markup=options.map(option=>`<option value="${escapeAttr(option.value)}">${escapeHtml(option.label)}</option>`).join('')+'<ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>';
        if(select.dataset.options!==markup){select.innerHTML=markup;select.dataset.options=markup;select.syncOptions?.();}
        control(id,String(value));
    }
    function sync(){
        const s=session; if(!s) return;
        $('Authoring').hidden=Boolean(s.recipe);
        $('Adjustment').hidden=!s.recipe;
        $('CompareHandle').hidden=!s.recipe||!s.compare;
        $('CompareHandle').setAttribute('aria-disabled',String(s.busy));
        $('Heading').textContent=text(s.recipe?'adjust':'title');
        $('Heading').setAttribute('data-i18n',`smart.repair.${s.recipe?'adjust':'title'}`);
        $('Generate').disabled=Boolean(s.busy||!s.source||!s.box||!s.model||!String($('Prompt').value||'').trim());
        $('Undo').disabled=Boolean(s.busy||!s.strokes.length);
        if(!s.recipe){
            syncSelect('Count',Array.from({length:s.maximumCount||1},(_,index)=>({value:index+1,label:`${index+1} ${tr('smart.countUnit')}`})),s.count||1);
            $('Transparent').hidden=s.model?.imageCapability?.supports_transparent_png!==true;
            $('Transparent').checked=s.transparentPng===true;
            $('Settings').ratio=s.ratio||'adaptive';$('Settings').resolution=s.resolution||'';
            $('CropSize').textContent=s.box?trf('smart.repair.cropSize',{width:s.box.width,height:s.box.height,ratio:s.box.ratio}):text('selectRegion');
            $('CropPreview').hidden=!s.box;
            const scope=geometry.relativeBounds(bounds(),s.box);
            $('Scope').hidden=!scope;
            $('Scope').textContent=scope?trf('smart.repair.scope',scope):'';
        } else {
            const box=s.recipe.transform;
            $('Scale').setAttribute('max',String(Math.floor(Math.min(2,Math.sqrt(40000000/(s.recipe.crop.width*s.recipe.crop.height)),30000/Math.max(s.recipe.crop.width,s.recipe.crop.height))*100)));
            control('X',box.x); control('Y',box.y);
            control('Scale',Math.round(box.width/s.recipe.crop.width*100));
            $('Scale').setAttribute('value-text',`${Math.round(box.width/s.recipe.crop.width*100)}%`);
            const maxFeather=Math.floor(Math.min(box.width,box.height));
            $('Feather').setAttribute('max',String(Math.max(1,maxFeather)));
            $('Feather').disabled=Boolean(s.busy||!maxFeather);
            control('Feather',s.recipe.feather);
            $('Feather').setAttribute('value-text',`${Math.round(s.recipe.feather)} px`);
            $('Save').disabled=Boolean(s.busy||!s.patch||(!s.dirty&&!s.unsynced));
            $('Psd').disabled=Boolean(s.busy||!s.patch);
            $('New').disabled=Boolean(s.busy||!s.patch);
            setImageStudioToggleState($('Compare'),s.compare);
        }
    }
    function paintCover(ctx,img,x,y,w,h){
        const scale=Math.max(w/img.naturalWidth,h/img.naturalHeight);
        const sw=w/scale,sh=h/scale;
        ctx.drawImage(img,(img.naturalWidth-sw)/2,(img.naturalHeight-sh)/2,sw,sh,x,y,w,h);
    }
    function patchPreview(s,scale){
        const box=s.recipe.transform, w=Math.max(1,Math.round(box.width*scale)),h=Math.max(1,Math.round(box.height*scale));
        const key=[w,h,s.recipe.feather].join(':');
        if(s.patchCache?.key===key) return s.patchCache.canvas;
        const canvas=document.createElement('canvas'); canvas.width=w;canvas.height=h;
        const ctx=canvas.getContext('2d');paintCover(ctx,s.patch,0,0,w,h);
        const data=ctx.getImageData(0,0,w,h),alpha=geometry.featherAlpha(w,h,s.recipe.feather*scale);
        for(let i=0;i<alpha.length;i++) data.data[i*4+3]=Math.floor(data.data[i*4+3]*alpha[i]/255);
        ctx.putImageData(data,0,0);s.patchCache={key,canvas};return canvas;
    }
    function draw(){
        const s=session;if(!s?.source) return;
        const viewport=$('Frame').parentElement;
        const box=!s.recipe&&s.box;
        const x=box?Math.min(0,box.x-8):0,y=box?Math.min(0,box.y-8):0;
        s.view=gesture?.view||{x,y,width:(box?Math.max(s.width,box.x+box.width+8):s.width)-x,height:(box?Math.max(s.height,box.y+box.height+8):s.height)-y};
        const view=s.view,fit=Math.min(viewport.clientWidth/view.width,viewport.clientHeight/view.height,1);
        const scale=Math.min(1,1600/Math.max(view.width,view.height));
        const canvas=$('Canvas'); canvas.width=Math.max(1,Math.round(view.width*scale));canvas.height=Math.max(1,Math.round(view.height*scale));
        canvas.style.width=`${Math.max(1,view.width*fit)}px`;canvas.style.height=`${Math.max(1,view.height*fit)}px`;
        const ctx=canvas.getContext('2d');ctx.translate(-view.x*scale,-view.y*scale);ctx.drawImage(s.source,0,0,s.width*scale,s.height*scale);
        if(s.recipe){
            if(s.patch){
                ctx.save();
                if(s.compare){ctx.beginPath();ctx.rect(s.width*scale*s.comparePos/100,0,s.width*scale,s.height*scale);ctx.clip();}
                const box=s.recipe.transform;
                ctx.drawImage(patchPreview(s,scale),box.x*scale,box.y*scale,box.width*scale,box.height*scale);
                if(!s.compare){ctx.strokeStyle='#a5a5a5';ctx.lineWidth=1;ctx.setLineDash([6,4]);ctx.strokeRect(box.x*scale,box.y*scale,box.width*scale,box.height*scale);}
                ctx.restore();
            }
        } else {
            ctx.save();ctx.scale(scale,scale);ctx.lineCap='round';ctx.lineJoin='round';
            s.strokes.forEach(stroke=>{
                const first=stroke.points[0],last=stroke.points.at(-1);if(!first)return;
                ctx.strokeStyle='rgba(255,80,64,.65)';ctx.lineWidth=stroke.tool==='brush'?stroke.size:2/scale;
                if(stroke.tool==='rectangle')ctx.strokeRect(first.x,first.y,last.x-first.x,last.y-first.y);
                else {ctx.beginPath();ctx.moveTo(first.x,first.y);stroke.points.forEach(p=>ctx.lineTo(p.x,p.y));if(stroke.points.length===1)ctx.lineTo(first.x+.01,first.y);ctx.stroke();}
            });
            if(s.box){
                ctx.strokeStyle='#36c9a2';ctx.fillStyle='#36c9a2';ctx.lineWidth=2/scale;ctx.setLineDash([6/scale,4/scale]);ctx.strokeRect(s.box.x,s.box.y,s.box.width,s.box.height);
                ctx.setLineDash([]);
                for(const x of [s.box.x,s.box.x+s.box.width/2,s.box.x+s.box.width])for(const y of [s.box.y,s.box.y+s.box.height/2,s.box.y+s.box.height]){
                    if(x===s.box.x+s.box.width/2&&y===s.box.y+s.box.height/2)continue;
                    ctx.fillRect(x-3/scale,y-3/scale,6/scale,6/scale);
                }
            }
            ctx.restore();
            if(s.box){
                const preview=$('CropPreview'),box=s.box; const pscale=Math.min(1,320/Math.max(box.width,box.height));
                preview.width=Math.round(box.width*pscale);preview.height=Math.round(box.height*pscale);
                preview.getContext('2d').drawImage(s.source,-box.x*pscale,-box.y*pscale,s.width*pscale,s.height*pscale);
            }
        }
    }
    async function open({nodeId,imageIndex=0,fresh=false}={}){
        const media=nodes.find(n=>n.id===nodeId)?.images?.[imageIndex];
        if(!media?.url || mediaKindForItem(media)!=='image') return;
        if(session) saveDraft();
        gesture=null;
        $('Frame').style.setProperty('--compare-pos','50%');
        $('CompareHandle').setAttribute('aria-valuenow','50');
        openImageEditor(nodeId,imageIndex);
        setImageEditMode('preview');
        const s=session={nodeId,imageIndex,media:clone(media),expectedUrl:media.url,strokes:[],redo:[],tool:'brush',busy:false,recipe:!fresh&&media.local_repair?clone(media.local_repair):null,compare:false,comparePos:50,dirty:false,models:[],count:1};
        setImageStudioToggleState($('Brush'),true);setImageStudioToggleState($('Rectangle'),false);
        imageEditMode='local-repair';imageEditModeTouched=true;
        imageEditModal.classList.add('local-repair-mode');$('Editor').hidden=false;
        message('loading');busy(true);
        try {
            s.source=await loadImage(s.recipe?.source||media);
            if(session!==s) return;
            s.width=s.source.naturalWidth;s.height=s.source.naturalHeight;
            if(s.width*s.height>40000000 || Math.max(s.width,s.height)>30000)throw new Error(text('tooLarge'));
            if(s.recipe){
                if(s.recipe.width!==s.width||s.recipe.height!==s.height)throw new Error(text('sourceChanged'));
                s.patch=await loadImage(s.recipe.patch);
                if(session!==s)return;
                const draft=nodes.find(n=>n.id===nodeId)?.localRepairAdjustmentDrafts?.[draftKey(s)];
                if(draft?.version===1&&draft.expectedUrl===s.expectedUrl){
                    s.dirty=JSON.stringify(s.recipe.transform)!==JSON.stringify(draft.transform)||s.recipe.feather!==draft.feather||s.recipe.version!==(draft.recipeVersion||1);
                    s.recipe.version=draft.recipeVersion||1;
                    s.recipe.transform=clone(draft.transform);s.recipe.feather=draft.feather;
                }
                if(s.recipe.version===1){s.recipe.version=2;s.recipe.feather*=2;s.dirty=true;}
                message('adjustHint');
            } else {
                const draft=nodes.find(n=>n.id===nodeId)?.localRepairDrafts?.[draftKey(s)];
                if(draft?.version===1&&draft.width===s.width&&draft.height===s.height){s.strokes=clone(draft.strokes||[]);s.ratio=draft.ratio;s.resolution=draft.resolution;s.box=draft.box;s.count=draft.count||1;s.transparentPng=draft.transparentPng===true;}
                control('Prompt',draft?.prompt||'');
                let presetsFailed=false;
                try {
                    const response=await fetch('/api/prompt-optimization-settings',{signal:AbortSignal.timeout(15000)});
                    if(!response.ok)throw new Error('settings');
                    s.presets=(await response.json()).repair||{};
                } catch(_error){s.presets={};presetsFailed=true;}
                if(session!==s)return;
                renderPresets();
                const entries=aiProcessorModelEntries('image');
                s.models=(await Promise.all(entries.map(async entry=>{
                    try {
                        const capability=await window.SmartCanvasModules.modelCapabilities.load(entry.provider_id,entry.model,'image.edit');
                        if(Number(capability.inputs?.image?.maximum||0)<1)return null;
                        const imageCapability=await window.SmartCanvasModules.imageCapabilities.load(entry.provider_id,entry.model);
                        return {...entry,capability,imageCapability};
                    } catch(_error){return null;}
                }))).filter(Boolean);
                if(session!==s)return;
                const model=s.models.find(entry=>entry.id===draft?.model)||geometry.preferredModel(s.models);
                $('Model').innerHTML=s.models.map(entry=>`<option value="${escapeAttr(entry.id)}" ${smartModelVendorOptionAttributes(entry.model,entry.provider_id,entry.provider_name)}>${escapeHtml(entry.name||entry.model)}</option>`).join('')+'<span slot="start" aria-hidden="true"></span><ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>';
                $('Model').syncOptions?.();control('Model',model?.id||'');
                await chooseModel(model?.id||'');
                if(draft?.resolution&&s.tiers?.includes(draft.resolution)){s.resolution=draft.resolution;sync();}
                message(s.models.length?(presetsFailed?'presetsFailed':'selectHint'):'noModels');
            }
        } catch(error){if(session===s)message(error.message===text('tooLarge')?'tooLarge':error.message===text('sourceChanged')?'sourceChanged':'loadFailed');}
        finally {if(session===s){busy(false);sync();redraw();}}
    }
    function renderPresets(){
        $('Presets').replaceChildren(...window.SmartCanvasModules.imageRepairPresets.keys.map(key=>{
            const tag=document.createElement('ic-button');tag.setAttribute('size','s');tag.setAttribute('hierarchy','secondary');
            tag.setAttribute('data-i18n',`smart.repair.preset.${key}`);tag.textContent=text(`preset.${key}`);tag.dataset.preset=key;
            tag.addEventListener('click',()=>{
                if(!session||session.busy)return;
                control('Prompt',window.SmartCanvasModules.imageRepairPresets.prompt(session.presets,key));sync();saveDraft();
            });return tag;
        }));
    }
    function reset(){
        if(!session)return;
        saveDraft();session=null;gesture=null;comparePointer=null;
        $('Editor').hidden=true;imageEditModal.classList.remove('local-repair-mode');
    }
    function point(event,clipped=true){
        const rect=$('Canvas').getBoundingClientRect();
        const view=gesture?.view||session.view||{x:0,y:0,width:session.width,height:session.height};
        const x=view.x+(event.clientX-rect.left)*view.width/rect.width,y=view.y+(event.clientY-rect.top)*view.height/rect.height;
        return clipped?{x:Math.max(0,Math.min(session.width,x)),y:Math.max(0,Math.min(session.height,y))}:{x,y};
    }
    function adjusted(){
        const s=session; const box=s.recipe.transform;
        box.x=Math.max(1-box.width,Math.min(s.width-1,Math.round(box.x)));
        box.y=Math.max(1-box.height,Math.min(s.height-1,Math.round(box.y)));
        s.recipe.feather=Math.min(Math.floor(Math.min(box.width,box.height)),Math.max(0,Math.round(s.recipe.feather)));
        s.dirty=true;sync();redraw();
    }
    $('Canvas').addEventListener('pointerdown',event=>{
        const s=session;if(!s?.source||s.busy||event.button!==0)return;
        event.preventDefault();$('Canvas').focus();$('Canvas').setPointerCapture(event.pointerId);
        const p=point(event,false);
        if(s.recipe){gesture={id:event.pointerId,start:p,box:clone(s.recipe.transform)};}
        else {
            const edge=geometry.edge(s.box,p,10*(s.view?.width||s.width)/$('Canvas').getBoundingClientRect().width);
            if(edge){gesture={id:event.pointerId,start:p,box:clone(s.box),edge,view:clone(s.view)};return;}
            if(s.strokes.length>=64){message('selectionLimit');return;}
            s.redo=[];const stroke={tool:s.tool,size:Number($('BrushSize').value)||42,points:[point(event)]};s.strokes.push(stroke);
            gesture={id:event.pointerId,stroke,view:clone(s.view)}; updateCrop();
        }
    });
    $('Canvas').addEventListener('pointermove',event=>{
        if(!session||session.busy)return;
        if(!gesture){const edge=!session.recipe&&geometry.edge(session.box,point(event,false),10*(session.view?.width||session.width)/$('Canvas').getBoundingClientRect().width);$('Canvas').style.cursor=edge?`${edge}-resize`:'crosshair';return;}
        if(gesture.id!==event.pointerId)return;
        const p=point(event,!gesture.edge);
        if(gesture.edge){
            const dx=(p.x-gesture.start.x)*(gesture.edge.includes('w')?-1:1),dy=(p.y-gesture.start.y)*(gesture.edge.includes('n')?-1:1);
            const factors=[];if(/[ew]/.test(gesture.edge))factors.push(1+2*dx/gesture.box.width);if(/[ns]/.test(gesture.edge))factors.push(1+2*dy/gesture.box.height);
            session.box=geometry.resize(gesture.box,Math.max(...factors),bounds());
            session.resolution=geometry.nearestResolution(session.box,session.tiers);sync();redraw();return;
        }
        if(session.recipe){session.recipe.transform={...gesture.box,x:gesture.box.x+p.x-gesture.start.x,y:gesture.box.y+p.y-gesture.start.y};adjusted();}
        else {
            if(gesture.stroke.tool==='rectangle')gesture.stroke.points[1]=p;
            else if(gesture.stroke.points.length<512)gesture.stroke.points.push(p);
            updateCrop();
        }
    });
    const end=event=>{if(!gesture)return;gesture=null;if($('Canvas').hasPointerCapture(event.pointerId))$('Canvas').releasePointerCapture(event.pointerId);saveDraft();redraw();};
    $('Canvas').addEventListener('pointerup',end);$('Canvas').addEventListener('pointercancel',end);
    $('Canvas').addEventListener('keydown',event=>{
        if(!session||session.busy)return;
        if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&!session.recipe){event.preventDefault();event.stopPropagation();undo(event.shiftKey);return;}
        if(!session.recipe){
            if(session.box&&['+','=','-','_'].includes(event.key)){
                event.preventDefault();event.stopPropagation();session.box=geometry.resize(session.box,['+','='].includes(event.key)?1.1:.9,bounds());
                session.resolution=geometry.nearestResolution(session.box,session.tiers);sync();redraw();saveDraft();
            }return;
        }
        const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
        if(delta){event.preventDefault();event.stopPropagation();session.recipe.transform.x+=delta[0]*(event.shiftKey?10:1);session.recipe.transform.y+=delta[1]*(event.shiftKey?10:1);adjusted();saveDraft();}
    });
    function undo(redo=false){
        if(!session||session.recipe||session.busy)return;
        const from=redo?session.redo:session.strokes,to=redo?session.strokes:session.redo;
        if(from.length)to.push(from.pop());updateCrop();saveDraft();
    }
    $('Undo').addEventListener('click',()=>undo());
    $('Clear').addEventListener('click',()=>{session.strokes=[];session.redo=[];updateCrop();saveDraft();});
    ['Brush','Rectangle'].forEach(id=>$(id).addEventListener('click',()=>{session.tool=id.toLowerCase();setImageStudioToggleState($('Brush'),id==='Brush');setImageStudioToggleState($('Rectangle'),id==='Rectangle');}));
    $('Model').addEventListener('change',()=>void chooseModel($('Model').value));
    $('Count').addEventListener('change',()=>{
        if(!session||session.busy)return;
        session.count=Math.max(1,Math.min(session.maximumCount||1,Math.round(Number($('Count').value)||1)));sync();saveDraft();
    });
    $('Settings').addEventListener('ic-change',event=>{
        if(!session||session.busy)return;
        if(event.detail.field==='ratio'){session.ratio=event.detail.value==='adaptive'?'':event.detail.value;updateCrop();}
        if(event.detail.field==='resolution')session.resolution=event.detail.value;
        saveDraft();
    });
    $('Transparent').addEventListener('change',()=>{if(session&&!session.busy){session.transparentPng=$('Transparent').checked;saveDraft();}});
    $('Prompt').addEventListener('input',()=>{sync();});
    $('Prompt').addEventListener('change',saveDraft);
    ['X','Y'].forEach(id=>$(id).addEventListener('change',()=>{if(session?.recipe){const value=Number($(id).value);if(Number.isFinite(value)){session.recipe.transform[id.toLowerCase()]=value;adjusted();saveDraft();}}}));
    $('Scale').addEventListener('input',()=>{if(session?.recipe){session.recipe.transform=geometry.scaled(session.recipe.crop,Number($('Scale').value)/100,session.recipe.transform);adjusted();}});
    $('Feather').addEventListener('input',()=>{if(session?.recipe){session.recipe.feather=Number($('Feather').value);adjusted();}});
    ['Scale','Feather'].forEach(id=>$(id).addEventListener('change',saveDraft));
    $('Reset').addEventListener('click',()=>{session.recipe.transform=clone(session.recipe.crop);session.recipe.feather=Math.round(Math.min(session.recipe.crop.width,session.recipe.crop.height)*.06);adjusted();saveDraft();});
    $('Compare').addEventListener('click',()=>{session.compare=!session.compare;sync();redraw();});
    $('New').addEventListener('click',async()=>{const s=session;if(await save())void open({nodeId:s.nodeId,imageIndex:s.imageIndex,fresh:true});});
    function setComparePosition(value){
        if(!session?.compare||session.busy)return;
        session.comparePos=Math.max(0,Math.min(100,value));
        $('Frame').style.setProperty('--compare-pos',`${session.comparePos}%`);
        $('CompareHandle').setAttribute('aria-valuenow',String(Math.round(session.comparePos)));
        redraw();
    }
    let comparePointer=null;
    function moveCompare(event){
        const rect=$('Canvas').getBoundingClientRect();
        setComparePosition((event.clientX-rect.left)/Math.max(1,rect.width)*100);
    }
    $('CompareHandle').addEventListener('pointerdown',event=>{
        if(!session?.compare||session.busy||event.button!==0)return;
        event.preventDefault();event.stopPropagation();
        comparePointer=event.pointerId;$('CompareHandle').focus();
        $('CompareHandle').setPointerCapture(event.pointerId);moveCompare(event);
    });
    $('CompareHandle').addEventListener('pointermove',event=>{
        if(comparePointer!==event.pointerId)return;
        event.preventDefault();event.stopPropagation();moveCompare(event);
    });
    for(const type of ['pointerup','pointercancel','lostpointercapture'])$('CompareHandle').addEventListener(type,event=>{
        if(comparePointer!==event.pointerId)return;
        event.stopPropagation();comparePointer=null;
        if($('CompareHandle').hasPointerCapture(event.pointerId))$('CompareHandle').releasePointerCapture(event.pointerId);
    });
    $('CompareHandle').addEventListener('keydown',event=>{
        if(!session?.compare||session.busy)return;
        const value={ArrowLeft:session.comparePos-(event.shiftKey?10:1),ArrowRight:session.comparePos+(event.shiftKey?10:1),Home:0,End:100}[event.key];
        if(value===undefined)return;
        event.preventDefault();event.stopPropagation();setComparePosition(value);
    });
    function blob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(result=>result?resolve(result):reject(new Error(text('loadFailed'))),'image/png'));}
    async function generate(){
        const s=session;if(!s?.box||!s.model||s.busy)return;
        if(!validSource(s)){message('sourceChanged');return;}
        const prompt=String($('Prompt').value||'').trim();
        if(!prompt)return;
        saveDraft();busy(true);message('submitting');
        try {
            const box=clone(s.box),crop=document.createElement('canvas');crop.width=box.width;crop.height=box.height;
            crop.getContext('2d').drawImage(s.source,-box.x,-box.y);
            const input=await uploadCroppedBlob(await blob(crop),'repair-input.png');
            if(!input?.url)throw new Error(text('failed'));
            let source={url:smartOriginalMediaUrl(s.media),name:s.media.name||'',natural_w:s.width,natural_h:s.height};
            if(!/^\/(assets|api\/storage-files)\//.test(source.url)){
                const original=document.createElement('canvas');original.width=s.width;original.height=s.height;original.getContext('2d').drawImage(s.source,0,0);
                const uploaded=await uploadCroppedBlob(await blob(original),'repair-source.png');if(!uploaded?.url)throw new Error(text('failed'));source={...source,url:uploaded.url};
            }
            if(!validSource(s))throw new Error(text('sourceChanged'));
            const recipe={version:2,source,width:s.width,height:s.height,crop:box,transform:box,feather:Math.round(Math.min(box.width,box.height)*.06)};
            const settings={engine:'api',apiKind:'image',provider_id:s.model.provider_id,model:s.model.model,ratio:window.SmartCanvasModules.imageCapabilities.standardToRatioKey(box.ratio)||box.ratio,resolution:String(s.resolution).toLowerCase(),count:s.count||1,quality:'auto',transparentPng:s.transparentPng===true&&s.model.imageCapability.supports_transparent_png===true};
            await window.SmartCanvasModules.generationRun.processor({
                nodeId:s.nodeId,imageIndex:s.imageIndex,input:{...input,natural_w:box.width,natural_h:box.height},width:box.width,height:box.height,
                prompt:[prompt,trf('smart.repair.scopeInstruction',geometry.relativeBounds(bounds(),box))].join('\n\n'),runSettings:settings,localRepair:recipe,
                onPrepared:()=>{if(session===s)window.SmartCanvasModules.imageStudio.close();}
            });
            if(session===s)message('failed');
        } catch(error){if(session===s)message(error.message===text('sourceChanged')?'sourceChanged':'failed');}
        finally {if(session===s)busy(false);}
    }
    async function save(){
        const s=session;if(!s?.recipe||s.busy)return false;
        if(!validSource(s)){message('conflict');return false;}
        busy(true);message('saving');
        try {
            const persistence=window.SmartCanvasModules.canvasPersistence;
            await persistence.save();if(!await persistence.synced({timeout:30000}))throw new Error('sync');
            if(!s.dirty){s.unsynced=false;if(session===s)message('saved');return true;}
            const response=await fetch(`/api/canvases/${encodeURIComponent(canvasId)}/image-repairs/${encodeURIComponent(s.nodeId)}/render`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image_index:s.imageIndex,expected_url:s.expectedUrl,transform:s.recipe.transform,feather:s.recipe.feather,recipe_version:s.recipe.version})});
            if(!response.ok)throw new Error(response.status===409?'conflict':'save');
            const data=await response.json();if(!validSource(s))throw new Error('conflict');
            window.SmartCanvasModules.canvasMutation.update({nodeId:s.nodeId,mutate:node=>{
                const old=node.images[s.imageIndex];
                node.images[s.imageIndex]={...data.image,outputId:old.outputId,generatedResult:old.generatedResult};
                if(node.localRepairAdjustmentDrafts)delete node.localRepairAdjustmentDrafts[draftKey(s)];
            },options:{select:false}});
            s.expectedUrl=data.image.url;s.media=clone(data.image);s.recipe=clone(data.image.local_repair);s.dirty=false;s.unsynced=true;
            await persistence.save();if(!await persistence.synced({timeout:30000}))throw new Error('sync');
            s.unsynced=false;if(session===s)message('saved');return true;
        } catch(error){if(session===s)message(error.message==='conflict'?'conflict':'saveFailed');return false;}
        finally {if(session===s)busy(false);}
    }
    async function downloadPsd(){
        const s=session;if(!s?.recipe||s.busy||!await save()||session!==s)return;
        busy(true);message('exporting');
        try {
            const response=await fetch(`/api/canvases/${encodeURIComponent(canvasId)}/image-repairs/${encodeURIComponent(s.nodeId)}/psd`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image_index:s.imageIndex,source_name:text('originalLayer'),patch_name:text('patchLayer')})});
            if(!response.ok||!response.headers.get('content-type')?.startsWith('image/vnd.adobe.photoshop'))throw new Error('export');
            const file=await response.blob(),url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download='repair.psd';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
            if(session===s)message('adjustHint');
        } catch(_error){if(session===s)message('exportFailed');}
        finally {if(session===s)busy(false);}
    }
    $('Generate').addEventListener('click',()=>void generate());$('Save').addEventListener('click',()=>void save());$('Psd').addEventListener('click',()=>void downloadPsd());
    new ResizeObserver(redraw).observe($('Frame').parentElement);
    function translate(){if(session){$('Status').textContent=text(session.message||'selectHint');sync();redraw();}}
    window.addEventListener('studio-lang-change',translate);
    window.SmartCanvasModules.imageRepair=Object.freeze({open,reset,translate});
})();
