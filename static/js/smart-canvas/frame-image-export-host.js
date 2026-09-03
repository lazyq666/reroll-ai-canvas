/* Frame download dialog and page snapshot. No Canvas writes. */
(function(){
    'use strict';
    const engine=window.SmartCanvasModules.frameImageExportEngine;
    const supported=new Set(['smart-frame','smart-group','smart-text','smart-brush','smart-image']);
    function describe(target){
        const frame=nodes.find(node=>node.id===target?.id && smartContainer.isFrame(node));
        if(!frame || !canvas) return null;
        const children=engine.members(nodes,frame.id);
        const contentCount=children.filter(node=>node.type==='smart-brush' && node.points?.length || node.type==='smart-text' && node.text?.trim()
            || (!node.type || ['smart-image','smart-group'].includes(node.type)) && node.images?.some(item=>item.url && mediaKindForItem(item)==='image')).length;
        return {context:String(canvas.id || canvasId),title:frame.title || tr('smart.frameDefault'),rect:nodeRect(frame),contentCount};
    }
    function capture(target){
        const info=describe(target);
        if(!info) throw fail('deleted');
        const children=engine.members(nodes,target.id);
        const absorbed=new Set();
        children.filter(node=>smartContainer.isGroup(node)).forEach(group=>smartContainer.imageRefs(group).forEach(ref=>{
            if(ref.nodeId!==group.id) absorbed.add(ref.nodeId);
        }));
        const entries=[];
        children.filter(node=>(!node.type || supported.has(node.type)) && !absorbed.has(node.id))
            .sort((a,b)=>(a.type==='smart-frame'?0:a.type==='smart-group'?1:2)-(b.type==='smart-frame'?0:b.type==='smart-group'?1:2))
            .forEach(node=>{
                const type=node.type || 'smart-image';
                if(type==='smart-image' && !node.images?.some(item=>item.url && mediaKindForItem(item)==='image')) return;
                const layout=imageLayout(node.images || [],nodeScale(node),node);
                const images={};
                const refs=type==='smart-group'?smartContainer.imageRefs(node):(node.images || []).map((item,index)=>({nodeId:node.id,index,item}));
                refs.forEach(ref=>{
                    if(ref.item?.url && mediaKindForItem(ref.item)==='image') images[`${ref.nodeId}:${ref.index}`]=displayMediaUrl(imageForDisplay(ref.item));
                });
                const body=type==='smart-frame'?'':nodeBodyHtml(node,layout);
                const html=smartCanvasNodeComponentFamily().render({id:`frame-export-${node.id}`,kind:nodeKinds.roleOf(node),
                    title:escapeHtml(info.title),body,layout,position:{x:0,y:0},frameColor:node.frameColor,
                    states:{mediaGroup:type==='smart-image' && (node.images || []).length>1,compact:smartContainer.isCompactMember(node),referenceGeneration:Boolean(referenceGenerationKind(node))},controls:{}});
                entries.push({id:node.id,type,x:Number(node.x)||0,y:Number(node.y)||0,width:layout.width,height:layout.height,html,images,order:entries.length});
            });
        return {...info,entries,background:getComputedStyle(shell).backgroundColor,
            filename:`${safeExportFileName(info.title,'frame').replace(/\.png$/i,'')}.png`};
    }
    const {dimensions,LIMITS}=engine;
    const fail=code=>Object.assign(new Error(code),{code});
    const accessible=()=>Boolean(canvas && canvasPersistence.editable());
    function download(blob,filename){
        const url=URL.createObjectURL(blob);
        const link=document.createElement('a'); link.href=url;link.download=filename;
        document.body.append(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
    function restoreFocus(target){
        const button=target && smartNodeFloatingPortal.querySelector(`[data-smart-frame-action="download"][data-node-id="${CSS.escape(target.id)}"]`);
        (button || shell).focus();
    }
    const dialog=document.getElementById('smartFrameExportDialog');
    const scaleControl=document.getElementById('smartFrameExportScale');
    const name=document.getElementById('smartFrameExportName');
    const size=document.getElementById('smartFrameExportSize');
    const status=document.getElementById('smartFrameExportStatus');
    const primary=document.getElementById('smartFrameExportDownload');
    let target=null, phase='ready', error='', attempt=null, timer=null, opening=null;
    const t=key => tr(`smart.frameExport.${key}`);
    const busy=()=>Boolean(attempt);
    const scale=()=>Number(scaleControl.getAttribute('value'))||1;
    function showCopy(info){
        name.textContent=info?.title || '';
        const dims=dimensions(info?.rect,scale());
        size.textContent=info ? trf('smart.frameExport.dimensions',dims) : '';
        for(const button of scaleControl.querySelectorAll('[data-value]')){
            button.disabled=busy() || !dimensions(info?.rect,Number(button.dataset.value)).ok;
            button.toggleAttribute('data-disabled',button.disabled);
        }
        scaleControl.setAttribute('aria-busy',String(busy()));
        primary.disabled=busy() || !info || !dims.ok || ['deleted','forbidden'].includes(error);
        primary.textContent=error && !['oversized','deleted','forbidden'].includes(error) ? t('retry') : tr('smart.contextDownload');
        const key=busy() ? phase : error || (!dims.ok?'oversized':info?.contentCount ? '' : 'backgroundOnly');
        status.textContent=key ? t(key) : '';
        status.dataset.tone=error || !dims.ok ? 'danger':'neutral';
        dialog.dataset.exportState=busy()?phase:error?'failure':!dims.ok?'oversized':info?.contentCount?'ready':'background-only';
    }
    function cancel(){
        const current=attempt; attempt=null;
        current?.abort(fail('cancelled'));
        clearInterval(timer); timer=null;
    }
    async function close(reason){
        cancel();
        // Let the entrance animation finish before requesting its reverse animation.
        // This also handles Escape while all scale options are disabled.
        if(opening) await opening;
        if(dialog.open) await dialog.hide(reason);
    }
    function sync(){
        if(!target) return;
        const info=describe(target);
        if(!info || info.context!==target.context || !accessible()){
            const reason=!accessible() || (info && info.context!==target.context)?'forbidden':'deleted';
            cancel(); error=reason; showCopy(info); return;
        }
        showCopy(info);
    }
    async function start(){
        if(busy() || !target || primary.disabled) return;
        const info=describe(target);
        if(!info || info.context!==target.context || !accessible()){sync();return;}
        error=''; phase='preparing';
        const current=new AbortController(); attempt=current;
        const deadline=setTimeout(()=>current.abort(fail('timeout')),LIMITS.taskMs);
        try {
            const snapshot=capture(target);
            showCopy(info);
            const blob=await engine.render(snapshot,scale(),{signal:current.signal,onPhase:value=>{phase=value;showCopy(info);}});
            if(current.signal.aborted) throw current.signal.reason;
            if(attempt!==current) return;
            const live=describe(target);
            if(!live || live.context!==target.context || !accessible()) throw fail('deleted');
            download(blob,snapshot.filename);
            toast(t('started'));
            attempt=null;
            await close('download');
        } catch(caught){
            if(attempt!==current) return;
            error=['oversized','timeout','image','font','forbidden','deleted'].includes(caught?.code)?caught.code:'render';
            attempt=null;
            showCopy(describe(target));
        } finally {clearTimeout(deadline);}
    }
    primary.addEventListener('click',start);
    document.getElementById('smartFrameExportCancel').addEventListener('click',()=>close('cancel'));
    scaleControl.addEventListener('ic-change',()=>{if(!busy()){error='';sync();}});
    dialog.addEventListener('ic-hide',event=>{
        cancel();
        if(opening && dialog.dataset.motionState==='entering'){
            event.preventDefault();
            close(event.detail?.reason || 'close');
        }
    });
    dialog.addEventListener('ic-after-hide',()=>{const previous=target;target=null;restoreFocus(previous);});
    window.addEventListener('keydown',event=>{
        if(event.key!=='Escape' || !dialog.open) return;
        event.preventDefault();event.stopImmediatePropagation();
        close('escape');
    },true);
    window.addEventListener('studio-lang-change',sync);
    window.addEventListener('pagehide',cancel);
    window.SmartCanvasModules.frameImageExport=Object.freeze({
        async open(frameId){
            if(dialog.open){primary.focus();return;}
            const info=describe({id:frameId});
            if(!info || !accessible()) return;
            target={id:frameId,context:info.context}; error='';phase='ready';
            scaleControl.setAttribute('value','1'); showCopy(info);
            timer=setInterval(sync,250);
            opening=dialog.show();
            await opening; opening=null;
            (scaleControl.querySelector('[data-value]:not(:disabled)') || document.getElementById('smartFrameExportCancel')).focus();
        }
    });
})();
