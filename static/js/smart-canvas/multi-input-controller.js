/* Smart Canvas adapter for the pure ordered-input plan and shared Node controls. */
let smartMultiInputCommitting = false;

function smartMultiInputRunning(node){
    return Boolean(node?.running || node?.textGenerationPending || smartNodeInFlight(node));
}
function smartMultiInputOptions(ids){
    return {nodes,ids,measure:nodeRect,mediaFor:outputImagesForNode,textFor:textForNode,running:smartMultiInputRunning};
}
function smartMultiInputReason(reason){
    return tr(`smart.multiInput.${reason || 'failed'}`);
}
function smartMultiInputOwnsSpace(event){
    return smartMultiSelectionBox?.isQuickAddEvent?.(event)
        || Boolean(referenceGenerateMenuState?.drag?.multiInput)
        || event.composedPath().some(element=>element.matches?.('[data-smart-multi-action="generate"],[data-smart-node-action="generate-image"]'));
}
function smartMultiInputAvailability(ids=window.SmartCanvasModules.viewportSelection.selection.ids()){
    const status = canvasPersistence.status();
    if(!canvasPersistence.editable() || status.state !== 'ready') return {ok:false,reason:'offline'};
    if(smartMultiInputCommitting) return {ok:false,reason:'busy'};
    return window.SmartCanvasModules.multiInput.capture(smartMultiInputOptions(ids));
}
function smartMultiInputTarget(snapshot,targetId){
    return window.SmartCanvasModules.multiInput.target({
        snapshot,nodes,connections:canvas?.connections || [],targetId,
        isGeneration:node => nodeKinds.isGeneration(node),running:smartMultiInputRunning
    });
}
async function smartMultiInputCommit(snapshot,{kind='image',point=null,targetId=''}={}){
    if(smartMultiInputCommitting) return null;
    if(!snapshot?.ok || !['image','video'].includes(kind)) return null;
    smartMultiInputCommitting = true;
    try {
        // Drain earlier edits so this gesture owns one operation and one Undo.
        const ready = await canvasPersistence.checkpoint();
        if(!ready || !canvasPersistence.editable() || canvasPersistence.status().state !== 'ready'){
            toast(smartMultiInputReason('offline'));
            return null;
        }
        const selected = window.SmartCanvasModules.viewportSelection.selection.ids();
        if(selected.length !== snapshot.rawIds.length || selected.some(id=>!snapshot.rawIds.includes(id))) return null;
        const current = window.SmartCanvasModules.multiInput.validate(snapshot,smartMultiInputOptions(snapshot.rawIds));
        if(!current.ok){ toast(smartMultiInputReason(current.reason)); return null; }
        if(targetId){
            const plan = smartMultiInputTarget(snapshot,targetId);
            if(!plan.ok){ toast(smartMultiInputReason(plan.reason)); return null; }
            if(!plan.ids.length){ toast(smartMultiInputReason('alreadyConnected')); return null; }
            return canvasMutation.connectSources({sourceIds:plan.ids,targetId});
        }
        const source = nodes.find(node => node.id === snapshot.ids[0]);
        const draft = {
            id:uid('smart'),type:'smart-image',images:[],x:0,y:0,
            scale:MEDIA_NODE_DEFAULT_SCALE,created_at:Date.now(),
            referenceGenerationKind:kind,
            title:tr(kind === 'video' ? 'smart.referenceVideoNode' : 'smart.referenceImageNode'),
            runSettings:referenceGenerationSettings(source,kind)
        };
        return canvasMutation.connectSources({sourceIds:snapshot.ids,draft,point});
    } catch(error){
        toast(smartMultiInputReason('failed'));
        return null;
    } finally {
        smartMultiInputCommitting = false;
        syncSmartNodeFloatingPortal();
        smartMultiInputSync();
    }
}
function smartMultiInputFromToolbar(ids){
    const snapshot = smartMultiInputAvailability(ids);
    if(!snapshot.ok){ toast(smartMultiInputReason(snapshot.reason)); return; }
    void smartMultiInputCommit(snapshot);
}
function smartMultiInputOpen(event,snapshot=null,point=null){
    const plan = snapshot || smartMultiInputAvailability();
    if(!plan.ok){ toast(smartMultiInputReason(plan.reason)); return false; }
    const trigger = smartMultiSelectionBox?.quickAddTrigger;
    if(!trigger) return false;
    const rect = trigger.getBoundingClientRect();
    closeCreateMenu();
    closeSmartNodeContextMenu();
    return openReferenceGenerateMenu(
        {fromId:plan.ids[0],fromPort:'out',multiInput:plan},event,
        {
            trigger,point,
            clientX:point ? event.clientX : rect.right,
            clientY:point ? event.clientY : rect.top+rect.height/2
        }
    );
}
function smartMultiInputBegin(event){
    if(event.button !== 0 || smartBaseTool !== 'pointer' || smartSpacePan || smartMiddlePan) return;
    event.preventDefault();
    event.stopPropagation();
    const snapshot = smartMultiInputAvailability();
    if(!snapshot.ok) return;
    const trigger = smartMultiSelectionBox.quickAddTrigger;
    beginSmartNodePortDrag(snapshot.ids[0],'out',event,{trigger});
    if(portDragState) portDragState.multiInput = snapshot;
}
function smartMultiInputDropTarget(event,snapshot){
    const hit = document.elementFromPoint(event.clientX,event.clientY);
    const direct = hit?.closest?.('.image-node') || (hit?.closest?.('.smart-multi-selection-box')
        ? document.elementsFromPoint(event.clientX,event.clientY).map(element=>element.closest?.('.image-node')).find(Boolean)
        : null);
    if(direct){
        const plan = smartMultiInputTarget(snapshot,direct.dataset.id);
        return {targetId:plan.ok ? direct.dataset.id : '',targetPort:plan.ok ? 'in' : '',blocked:!plan.ok,reason:plan.reason,hit};
    }
    // The selection overlay is transparent for target inspection, not a blank create surface.
    if(hit?.closest?.('.smart-multi-selection-box')) return {blocked:true,reason:'target',targetId:'',hit};
    const result = smartPortDropTarget(event,snapshot.ids[0],'out');
    if(result.targetId){
        const plan = smartMultiInputTarget(snapshot,result.targetId);
        if(!plan.ok) return {...result,targetId:'',blocked:true,reason:plan.reason};
    }
    return result;
}
function smartMultiInputDrop(drag,event){
    canvasMutation.history({action:'discard'});
    if(!drag.moved) return false;
    // Browsers synthesize a click on the shared ancestor after a drag. It is
    // not a blank-canvas selection gesture, and must not cancel the open menu.
    const swallowDropClick = click => {
        if(Math.abs(click.clientX-event.clientX)>4 || Math.abs(click.clientY-event.clientY)>4) return;
        if(!shell.contains(click.target) || click.target.closest?.('ic-menu')) return;
        click.preventDefault();
        click.stopImmediatePropagation();
        document.removeEventListener('click',swallowDropClick,true);
    };
    document.addEventListener('click',swallowDropClick,true);
    setTimeout(()=>document.removeEventListener('click',swallowDropClick,true),300);
    const result = smartMultiInputDropTarget(event,drag.multiInput);
    if(result.blocked){ toast(smartMultiInputReason(result.reason || 'target')); return false; }
    if(result.targetId){
        void smartMultiInputCommit(drag.multiInput,{targetId:result.targetId});
        return false;
    }
    if(result.hit?.closest?.('.smart-canvas-dock,.composer,.smart-node-floating-portal,ic-menu,ic-dialog,.smart-back,.asset-panel,.smart-minimap')) return false;
    return smartMultiInputOpen(event,drag.multiInput,drag.currentWorld);
}
function smartMultiInputCancel({restoreFocus=false}={}){
    if(referenceGenerateMenuState?.drag?.multiInput) closeReferenceGenerateMenu({restoreFocus});
    if(portDragState?.multiInput){
        portDragState = null;
        shell.classList.remove('port-dragging');
        clearPortDragVisual();
        setSmartNodeQuickAddPortDragging(false);
        canvasMutation.history({action:'discard'});
    }
}
function smartMultiInputSync(){
    const overlay = smartMultiSelectionBox;
    if(!overlay) return;
    const ids = window.SmartCanvasModules.viewportSelection.selection.ids();
    const pending = referenceGenerateMenuState?.drag?.multiInput || portDragState?.multiInput;
    if(pending){
        const same = ids.length === pending.rawIds.length && ids.every(id=>pending.rawIds.includes(id));
        const valid = same && window.SmartCanvasModules.multiInput.validate(pending,smartMultiInputOptions(ids)).ok;
        if(!valid || smartBaseTool !== 'pointer' || !canvasPersistence.editable() || canvasPersistence.status().state !== 'ready'){
            smartMultiInputCancel();
            if(same && !valid) toast(smartMultiInputReason('changed'));
        }
    }
    const snapshot = ids.length > 1 ? smartMultiInputAvailability(ids) : null;
    const bounds = ids.length > 1 ? window.SmartCanvasModules.viewportSelection.selection.bounds(ids) : null;
    const x = bounds ? viewport.x+(bounds.x+bounds.width)*viewport.scale : -1;
    const y = bounds ? viewport.y+(bounds.y+bounds.height/2)*viewport.scale : -1;
    overlay.toggleAttribute('quick-add-visible',Boolean(bounds && x>=0 && x<shell.clientWidth-44 && y>=20 && y<shell.clientHeight-20));
    overlay.setAttribute('quick-add-label',trf('smart.multiInput.connect',{count:snapshot?.ids?.length || ids.length}));
    overlay.setAttribute('quick-add-reason',snapshot && !snapshot.ok ? smartMultiInputReason(snapshot.reason) : '');
}
document.addEventListener('DOMContentLoaded',()=>{
    smartMultiSelectionBox?.addEventListener('click',event=>{
        if(!smartMultiSelectionBox.isQuickAddEvent?.(event)) return;
        event.preventDefault();
        event.stopPropagation();
        if(smartMultiSelectionBox.quickAddTrigger._smartSuppressNextClick){
            delete smartMultiSelectionBox.quickAddTrigger._smartSuppressNextClick;
            return;
        }
        smartMultiInputOpen(event);
    });
    document.addEventListener('keydown',event=>{
        if(event.key === 'Escape') smartMultiInputCancel({restoreFocus:true});
    },true);
});
