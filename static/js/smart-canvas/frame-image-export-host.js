/* Page adapter: capture existing layout without writing the Canvas. */
(function(){
    'use strict';
    const engine=window.SmartCanvasModules.frameImageExportEngine;
    const supported=new Set(['smart-frame','smart-group','smart-text','smart-brush','smart-image']);
    function describe(target){
        const frame=nodes.find(node=>node.id===target?.id && smartContainer.isFrame(node));
        if(!frame || !canvas) return null;
        const children=engine.members(nodes,frame.id);
        // Excluded card text/settings never enter the export signature or snapshot.
        const geometry=children.map(node=>({id:node.id,type:node.type,x:node.x,y:node.y,w:node.w,h:node.h,
            items:node.items,frameColor:node.frameColor,
            text:node.type==='smart-text'?node.text:undefined,textSize:node.textSize,
            color:node.color,brushSize:node.brushSize,points:node.type==='smart-brush'?node.points:undefined,
            images:(!node.type || ['smart-image','smart-group'].includes(node.type))?node.images:undefined}));
        const contentCount=children.filter(node=>node.type==='smart-brush' && node.points?.length || node.type==='smart-text' && node.text?.trim()
            || (!node.type || ['smart-image','smart-group'].includes(node.type)) && node.images?.some(item=>item.url && mediaKindForItem(item)==='image')).length;
        return {context:String(canvas.id || canvasId),title:frame.title || tr('smart.frameDefault'),rect:nodeRect(frame),contentCount,
            signature:JSON.stringify([frame.title,geometry])};
    }
    function capture(target){
        const info=describe(target);
        if(!info) throw Object.assign(new Error('deleted'),{code:'deleted'});
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
    window.SmartCanvasModules.frameImageExport=engine.create({describe,capture,
        accessible:()=>Boolean(canvas && canvasPersistence.editable()),translate:tr,format:trf,
        notify:toast,
        download(blob,filename){
            const url=URL.createObjectURL(blob);
            const link=document.createElement('a'); link.href=url;link.download=filename;
            document.body.append(link);link.click();link.remove();
            setTimeout(()=>URL.revokeObjectURL(url),60000);
        },
        restoreFocus(target){
            const button=target && smartNodeFloatingPortal.querySelector(`[data-smart-frame-action="download"][data-node-id="${CSS.escape(target.id)}"]`);
            (button || shell).focus();
        }
    });
})();
