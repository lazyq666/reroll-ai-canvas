/*
 * Smart Canvas Interaction Module
 *
 * Owns pointer-driven Canvas Interaction lifecycles. Callers only arbitrate
 * events; gesture state, previews, drop priority, Undo and Canvas Sync timing
 * stay behind this Interface.
 */
const canvasInteractionViewportModule =
    window.SmartCanvasModules?.viewportSelection;
const canvasInteractionPersistenceModule =
    window.SmartCanvasModules?.canvasPersistence;
const canvasInteractionMutationModule =
    window.SmartCanvasModules?.canvasMutation;
const canvasInteractionContainerModule =
    window.SmartCanvasModules?.smartContainer;
const canvasInteractionVirtualizationModule =
    window.SmartCanvasModules?.canvasVirtualization;
const SMART_CANVAS_CHROME_SELECTOR = [
    '.smart-canvas-dock',
    '.composer',
    '.composer-focus-backdrop',
    'ic-mention-picker',
    '.mention-preview',
    '.smart-node-floating-portal',
    '.smart-text-options',
    '.smart-multi-selection-box',
    '.smart-node-context-menu',
    '.conn-hit',
    '.conn-cut',
    '.smart-back',
    '.asset-panel',
    '.smart-log-toggle',
    '.smart-shortcut-toggle',
    '.smart-workflow-toggle',
    '.create-menu',
    '.reference-generate-menu',
    '.smart-minimap',
    '[data-generation-failure-queue]'
].join(',');

function canvasInteractionText(key, fallback=''){
    const translated = typeof tr === 'function' ? tr(key) : window.StudioI18n?.t?.(key);
    return translated && translated !== key ? translated : fallback;
}

if(!canvasInteractionViewportModule){
    throw new Error('Viewport Selection Module failed to load');
}
if(!canvasInteractionPersistenceModule){
    throw new Error('Canvas Persistence Module failed to load');
}
if(!canvasInteractionMutationModule){
    throw new Error('Canvas Mutation Module failed to load');
}
if(!canvasInteractionContainerModule){
    throw new Error('Smart Container Module failed to load');
}

let smartCanvasInteractionState = null;
let smartCanvasInteractionLayerRaf = 0;
let smartCanvasInteractionLoopInsertPreview = null;
const SMART_CANVAS_INTERACTION_COMMIT_DISTANCE_PX = 4;

function smartCanvasInteractionOwnsTarget(target){
    return Boolean(target?.closest?.(SMART_CANVAS_CHROME_SELECTOR));
}

function smartCanvasInteractionNormalizeKind(kind=''){
    if(kind === 'frame') return 'draw-frame';
    if(kind === 'node-drag') return 'move-nodes';
    if(kind === 'resize') return 'resize-node';
    if(kind === 'multi-resize') return 'resize-selection';
    if(kind === 'thumb-drag') return 'detach-media';
    return kind;
}
function smartCanvasInteractionSummary(){
    const state = smartCanvasInteractionState;
    if(!state) return null;
    const nodeIds = state.kind === 'move-nodes'
        ? (state.group || []).map(item => item.id)
        : state.kind === 'resize-selection'
            ? (state.items || []).map(item => item.id)
        : state.id
            ? [state.id]
            : state.nodeId
                ? [state.nodeId]
                : [];
    return Object.freeze({
        kind:state.kind,
        nodeIds:Object.freeze(nodeIds),
        connectionIndex:
            smartCanvasInteractionLoopInsertPreview?.index ?? -1
    });
}
function smartCanvasInteractionNodeIds(state=smartCanvasInteractionState){
    if(!state) return [];
    if(state.kind === 'move-nodes') return (state.group || []).map(item => item.id);
    if(state.kind === 'resize-selection') return (state.items || []).map(item => item.id);
    if(state.id) return [state.id];
    if(state.nodeId) return [state.nodeId];
    return [];
}
function smartCanvasInteractionActive(kind=''){
    const summary = smartCanvasInteractionSummary();
    if(!kind) return summary;
    return summary?.kind === smartCanvasInteractionNormalizeKind(kind)
        ? summary
        : null;
}
function smartCanvasInteractionSnapshot(){
    return canvasInteractionMutationModule.history({action:'snapshot'});
}
function smartCanvasInteractionRestoreSnapshot(snapshot){
    if(!snapshot) return false;
    nodes = JSON.parse(JSON.stringify(snapshot.nodes || []));
    if(canvas){
        canvas.connections = JSON.parse(
            JSON.stringify(snapshot.connections || [])
        );
    }
    selectedId = snapshot.selectedId || '';
    selectedIds = Array.isArray(snapshot.selectedIds)
        ? snapshot.selectedIds.slice()
        : [];
    selectedImage = snapshot.selectedImage
        ? {...snapshot.selectedImage}
        : {nodeId:'',index:-1};
    return true;
}
function smartCanvasInteractionScheduleLayers(){
    if(smartCanvasInteractionLayerRaf) return;
    smartCanvasInteractionLayerRaf = requestAnimationFrame(() => {
        smartCanvasInteractionLayerRaf = 0;
        refreshConnectionLayer({
            nodeIds:smartCanvasInteractionNodeIds()
        });
        canvasInteractionViewportModule.viewport.refresh();
    });
}
function smartCanvasInteractionClearDropHighlight(){
    world.querySelectorAll('.image-node.drop-target').forEach(
        element => element.classList.remove('drop-target')
    );
}
function smartCanvasInteractionSetDropHighlight(targetId=''){
    smartCanvasInteractionClearDropHighlight();
    if(!targetId) return;
    const element = world.querySelector(
        `.image-node[data-id="${CSS.escape(targetId)}"]`
    );
    if(element) element.classList.add('drop-target');
}
function smartCanvasInteractionProjectMovedNodes(state){
    if(!state) return;
    (state.group || [{id:state.id}]).forEach(item => {
        const node = nodes.find(candidate => candidate.id === item.id);
        const element = world.querySelector(
            `.image-node[data-id="${CSS.escape(item.id)}"]`
        );
        if(node && element){
            element.style.left = `${node.x || 0}px`;
            element.style.top = `${node.y || 0}px`;
        }
    });
    const activeNode =
        canvasInteractionViewportModule.selection.node();
    if(
        activeNode
        && (state.group || [{id:state.id}])
            .some(item => item.id === activeNode.id)
    ){
        positionComposerForNode(activeNode);
        positionSmartNodeFloatingPortal(activeNode);
    }
    smartCanvasInteractionScheduleLayers();
}
function smartCanvasInteractionRectTarget(
    draggedId,
    x,
    y,
    width,
    height,
    excludeIds=[]
){
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const excluded = new Set([draggedId,...(excludeIds || [])]);
    for(const node of nodes){
        if(
            excluded.has(node.id)
            || canvasInteractionContainerModule.isFrame(node)
        ){
            continue;
        }
        const rect = nodeRect(node);
        if(
            centerX >= rect.x
            && centerX <= rect.x + rect.width
            && centerY >= rect.y
            && centerY <= rect.y + rect.height
        ){
            return node;
        }
    }
    return null;
}
function smartCanvasInteractionConnectTarget(
    sourceNode,
    point=lastMouseWorld
){
    const state = smartCanvasInteractionState;
    if(
        !sourceNode
        || state?.kind !== 'move-nodes'
        || (state.group || []).length > 1
    ){
        return null;
    }
    if(['smart-prompt','smart-splitter','smart-loop'].includes(sourceNode.type) && point){
        return smartCanvasInteractionRectTarget(
            sourceNode.id,
            point.x - 1,
            point.y - 1,
            2,
            2,
            state.groupIds || []
        );
    }
    const rect = nodeRect(sourceNode);
    return smartCanvasInteractionRectTarget(
        sourceNode.id,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        state.groupIds || []
    );
}
function smartCanvasInteractionCanConnect(sourceNode, targetNode){
    if(
        !sourceNode
        || !targetNode
        || sourceNode.id === targetNode.id
    ){
        return false;
    }
    if(
        canvasInteractionContainerModule.isFrame(sourceNode)
        || canvasInteractionContainerModule.isFrame(targetNode)
        || isHistoryGroupNode(sourceNode)
        || isHistoryGroupNode(targetNode)
        || canvasInteractionContainerModule.isGroup(targetNode)
    ){
        return false;
    }
    if(isSmartImageNode(sourceNode)){
        return isSmartImageNode(targetNode)
            || targetNode.type === 'smart-loop'
            || targetNode.type === 'smart-prompt';
    }
    if(sourceNode.type === 'smart-prompt'){
        return isSmartImageNode(targetNode)
            || targetNode.type === 'smart-loop'
            || targetNode.type === 'smart-prompt'
            || targetNode.type === 'smart-splitter';
    }
    if(sourceNode.type === 'smart-splitter'){
        return isSmartImageNode(targetNode)
            || targetNode.type === 'smart-loop'
            || targetNode.type === 'smart-prompt'
            || targetNode.type === 'smart-splitter';
    }
    if(sourceNode.type === 'smart-loop'){
        return isSmartImageNode(targetNode);
    }
    if(sourceNode.type === 'smart-group'){
        return isSmartImageNode(targetNode)
            || targetNode.type === 'smart-loop'
            || targetNode.type === 'smart-splitter';
    }
    return false;
}
function smartCanvasInteractionRestoreMovedNodes(state){
    if(!state) return;
    (state.group || [{
        id:state.id,
        ox:state.ox,
        oy:state.oy
    }]).forEach(item => {
        const node = nodes.find(candidate => candidate.id === item.id);
        if(node){
            node.x = item.ox;
            node.y = item.oy;
        }
    });
}
function smartCanvasInteractionNodesMoved(state){
    if(!state) return false;
    return (state.group || []).some(item => {
        const node = nodes.find(candidate => candidate.id === item.id);
        return node && (
            Math.abs((Number(node.x) || 0) - item.ox) > 0.01
            || Math.abs((Number(node.y) || 0) - item.oy) > 0.01
        );
    }) || Boolean(
        state.id
        && !(state.group || []).length
        && nodes.some(node =>
            node.id === state.id
            && (
                Math.abs((Number(node.x) || 0) - state.ox) > 0.01
                || Math.abs((Number(node.y) || 0) - state.oy) > 0.01
            )
        )
    );
}
function smartCanvasInteractionPointerDistance(state,event={}){
    const currentX = Number.isFinite(event.clientX)
        ? event.clientX
        : (state.lastClientX ?? state.startX);
    const currentY = Number.isFinite(event.clientY)
        ? event.clientY
        : (state.lastClientY ?? state.startY);
    return Math.hypot(
        currentX - state.startX,
        currentY - state.startY
    );
}
function smartCanvasInteractionConnectionMidpoint(connection){
    const fromNode = nodes.find(node => node.id === connection?.from);
    const toNode = nodes.find(node => node.id === connection?.to);
    if(!fromNode || !toNode) return null;
    const fromRect = nodeRect(fromNode);
    const toRect = nodeRect(toNode);
    if((connection.kind || 'flow') === 'history'){
        return {
            x:(
                fromRect.x + fromRect.width / 2
                + toRect.x + toRect.width / 2
            ) / 2,
            y:(fromRect.y + fromRect.height + toRect.y) / 2
        };
    }
    return {
        x:(fromRect.x + fromRect.width + toRect.x) / 2,
        y:(
            fromRect.y + fromRect.height / 2
            + toRect.y + toRect.height / 2
        ) / 2
    };
}
function smartCanvasInteractionInsertionConnection(node){
    if(
        !node
        || node.type !== 'smart-loop'
        || !canvas?.connections?.length
    ){
        return null;
    }
    const rect = nodeRect(node);
    const centerX =
        (Number(rect.x) || 0) + (Number(rect.width) || 0) / 2;
    const centerY =
        (Number(rect.y) || 0) + (Number(rect.height) || 0) / 2;
    let best = null;
    (canvas.connections || []).forEach((connection,index) => {
        const kind = connection.kind || 'flow';
        if(!['input','flow'].includes(kind)) return;
        if(connection.from === node.id || connection.to === node.id) return;
        const fromNode = nodes.find(
            candidate => candidate.id === connection.from
        );
        const toNode = nodes.find(
            candidate => candidate.id === connection.to
        );
        if(
            !fromNode
            || !toNode
            || isHistoryGroupNode(fromNode)
            || isHistoryGroupNode(toNode)
        ){
            return;
        }
        const midpoint =
            smartCanvasInteractionConnectionMidpoint(connection);
        if(!midpoint) return;
        const score = Math.hypot(
            centerX - midpoint.x,
            centerY - midpoint.y
        );
        if(score > 96) return;
        if(!best || score < best.score){
            best = {conn:connection,index,score};
        }
    });
    return best;
}
function smartCanvasInteractionInsertLoop(node, hit){
    if(!node || node.type !== 'smart-loop' || !hit?.conn) return false;
    const connection = hit.conn;
    const kind = connection.kind || 'flow';
    canvasInteractionMutationModule.disconnect({
        indexes:[hit.index],
        skipUndo:true,
        render:false,
        save:false
    });
    canvasInteractionMutationModule.connect({
        fromId:connection.from,
        toId:node.id,
        kind:kind === 'flow' ? 'flow' : 'input'
    });
    canvasInteractionMutationModule.connect({
        fromId:node.id,
        toId:connection.to,
        input:true
    });
    return true;
}
function smartCanvasInteractionUpdateLoopPreview(state){
    const node = state
        ? nodes.find(candidate => candidate.id === state.id)
        : null;
    const next = node?.type === 'smart-loop'
        && state.ctrlGroup
        && (state.group || []).length <= 1
        ? smartCanvasInteractionInsertionConnection(node)
        : null;
    const nextPreview = next ? {index:next.index} : null;
    const changed =
        (smartCanvasInteractionLoopInsertPreview?.index ?? -1)
        !== (nextPreview?.index ?? -1);
    smartCanvasInteractionLoopInsertPreview = nextPreview;
    if(changed) scheduleConnectionLayerRefresh();
    return next;
}
function smartCanvasInteractionRelease(state){
    if(!state) return;
    canvasInteractionVirtualizationModule?.unpin?.(
        smartCanvasInteractionNodeIds(state),
        'canvas-interaction'
    );
    if(state.kind === 'draw-frame'){
        canvasInteractionPersistenceModule.release({scope:'draw-frame'});
    } else if(state.kind === 'resize-node'){
        canvasInteractionPersistenceModule.release({scope:'resize-node'});
    } else if(state.kind === 'resize-selection'){
        canvasInteractionPersistenceModule.release({
            scope:'resize-selection'
        });
    } else if(state.kind === 'detach-media' || state.kind === 'detach-member'){
        canvasInteractionPersistenceModule.release({scope:'thumb-drag'});
    } else if(state.kind === 'move-nodes'){
        canvasInteractionPersistenceModule.release({scope:'move-nodes'});
        if(state.fromThumb){
            canvasInteractionPersistenceModule.release({scope:'thumb-drag'});
        }
    }
}
function smartCanvasInteractionClearMediaReorderPreview(){
    world?.querySelectorAll?.(
        '.media-reorder-source,.media-reorder-target,'
        + '.media-reorder-shift'
    ).forEach(element => {
        element.classList.remove(
            'media-reorder-source',
            'media-reorder-target',
            'media-reorder-shift'
        );
        element.style.removeProperty('transform');
        element.removeAttribute('aria-grabbed');
    });
}
function smartCanvasInteractionRemoveMediaGhost(state=null){
    state?.mediaGhost?.remove?.();
    if(state) state.mediaGhost = null;
    document.querySelectorAll?.('.media-reorder-ghost')
        .forEach(element => element.remove());
}
function smartCanvasInteractionResetVisuals({preserveMediaGhost=false}={}){
    document.body.classList.remove(
        'smart-node-drag',
        'smart-node-resize',
        'smart-media-reorder-drag'
    );
    smartCanvasInteractionClearDropHighlight();
    smartCanvasInteractionClearMediaReorderPreview();
    if(!preserveMediaGhost) smartCanvasInteractionRemoveMediaGhost();
    smartCanvasInteractionLoopInsertPreview = null;
    if(typeof scheduleConnectionLayerRefresh === 'function'){
        scheduleConnectionLayerRefresh();
    }
}

function smartCanvasInteractionMediaReorderItems(nodeElement,state){
    return [...(nodeElement?.querySelectorAll?.(
        '.thumb-item[data-image-index]'
    ) || [])].filter(item => (
        (
            !item.dataset.refNodeId
            || item.dataset.refNodeId === state.nodeId
        )
    ));
}
function smartCanvasInteractionMediaReorderTarget(event,state){
    const nodeElement = world?.querySelector?.(
        `.image-node[data-id="${CSS.escape(state.nodeId)}"]`
    );
    const rect = nodeElement?.getBoundingClientRect?.();
    if(
        !rect
        || event.clientX < rect.left
        || event.clientX > rect.right
        || event.clientY < rect.top
        || event.clientY > rect.bottom
    ){
        return {inside:false,index:-1};
    }
    const hit = document.elementFromPoint?.(
        event.clientX,
        event.clientY
    );
    let item = hit?.closest?.('.thumb-item[data-image-index]');
    if(
        !item
        || item.closest?.('.image-node') !== nodeElement
        || (
            item.dataset.refNodeId
            && item.dataset.refNodeId !== state.nodeId
        )
    ){
        item = null;
    }
    let magnetized = false;
    if(!item){
        let nearest = null;
        smartCanvasInteractionMediaReorderItems(nodeElement,state)
            .filter(candidate => (
                Number(candidate.dataset.imageIndex) !== state.mediaIndex
            ))
            .forEach(candidate => {
                const candidateRect = candidate.getBoundingClientRect();
                const dx = event.clientX < candidateRect.left
                    ? candidateRect.left - event.clientX
                    : event.clientX > candidateRect.right
                        ? event.clientX - candidateRect.right
                        : 0;
                const dy = event.clientY < candidateRect.top
                    ? candidateRect.top - event.clientY
                    : event.clientY > candidateRect.bottom
                        ? event.clientY - candidateRect.bottom
                        : 0;
                const distance = Math.hypot(dx,dy);
                if(distance <= 28 && (!nearest || distance < nearest.distance)){
                    nearest = {item:candidate,distance};
                }
            });
        item = nearest?.item || null;
        magnetized = Boolean(item);
    }
    if(!item){
        return {inside:true,index:-1,item:null,magnetized:false};
    }
    const index = Number(item.dataset.imageIndex);
    return {
        inside:true,
        index:Number.isInteger(index) ? index : -1,
        item,
        magnetized
    };
}
function smartCanvasInteractionEnsureMediaGhost(state){
    if(state.mediaGhost?.isConnected) return state.mediaGhost;
    const nodeElement = world?.querySelector?.(
        `.image-node[data-id="${CSS.escape(state.nodeId)}"]`
    );
    const source = nodeElement?.querySelector?.(
        `.thumb-item[data-image-index="${state.mediaIndex}"]`
    );
    const rect = source?.getBoundingClientRect?.();
    if(!source || !rect) return null;
    const ghost = source.cloneNode(true);
    ghost.classList.remove(
        'media-reorder-source',
        'media-reorder-target',
        'media-reorder-shift'
    );
    ghost.classList.add('media-reorder-ghost');
    ghost.removeAttribute('aria-grabbed');
    Object.assign(ghost.style,{
        left:`${rect.left}px`,
        top:`${rect.top}px`,
        width:`${rect.width}px`,
        height:`${rect.height}px`
    });
    ghost.style.setProperty('--thumb-size',`${rect.width}px`);
    document.body.appendChild(ghost);
    state.mediaGhost = ghost;
    state.mediaGhostOffsetX = state.startX - rect.left;
    state.mediaGhostOffsetY = state.startY - rect.top;
    document.body.classList.add('smart-media-reorder-drag');
    return ghost;
}
function smartCanvasInteractionMoveMediaGhost(event,state,target){
    const ghost = smartCanvasInteractionEnsureMediaGhost(state);
    if(!ghost) return;
    let left = event.clientX - Number(state.mediaGhostOffsetX || 0);
    let top = event.clientY - Number(state.mediaGhostOffsetY || 0);
    if(target?.item && target.index !== state.mediaIndex){
        const targetRect = target.item.getBoundingClientRect();
        const ghostRect = ghost.getBoundingClientRect();
        const dx = targetRect.left + targetRect.width / 2
            - (left + ghostRect.width / 2);
        const dy = targetRect.top + targetRect.height / 2
            - (top + ghostRect.height / 2);
        const distance = Math.max(1,Math.hypot(dx,dy));
        const pull = Math.min(12,distance * .12);
        left += dx / distance * pull;
        top += dy / distance * pull;
        ghost.classList.add('is-magnetized');
    } else {
        ghost.classList.remove('is-magnetized');
    }
    ghost.style.left = `${left}px`;
    ghost.style.top = `${top}px`;
}
function smartCanvasInteractionShiftMediaItems(state,nodeElement,targetIndex){
    if(targetIndex < 0 || targetIndex === state.mediaIndex) return;
    const byIndex = new Map(
        smartCanvasInteractionMediaReorderItems(nodeElement,state)
            .map(item => [Number(item.dataset.imageIndex),item])
    );
    const from = Number(state.mediaIndex);
    const start = Math.min(from,targetIndex);
    const end = Math.max(from,targetIndex);
    for(let index = start; index <= end; index += 1){
        if(index === from) continue;
        const item = byIndex.get(index);
        const destination = byIndex.get(
            from < targetIndex ? index - 1 : index + 1
        );
        if(!item || !destination) continue;
        const rect = item.getBoundingClientRect();
        const destinationRect = destination.getBoundingClientRect();
        item.classList.add('media-reorder-shift');
        item.style.transform = `translate(${destinationRect.left - rect.left}px, ${destinationRect.top - rect.top}px)`;
    }
}
function smartCanvasInteractionPreviewMediaReorder(state,target,event){
    smartCanvasInteractionClearMediaReorderPreview();
    state.reorderIndex = target.index;
    const nodeElement = world?.querySelector?.(
        `.image-node[data-id="${CSS.escape(state.nodeId)}"]`
    );
    const source = nodeElement?.querySelector?.(
        `.thumb-item[data-image-index="${state.mediaIndex}"]`
    );
    if(target.index >= 0 && target.index !== state.mediaIndex){
        target.item?.classList.add('media-reorder-target');
        smartCanvasInteractionShiftMediaItems(
            state,
            nodeElement,
            target.index
        );
    }
    source?.classList.add('media-reorder-source');
    source?.setAttribute('aria-grabbed','true');
    smartCanvasInteractionMoveMediaGhost(event,state,target);
}
function smartCanvasInteractionReleaseMediaGhost(state,targetElement){
    const ghost = state?.mediaGhost;
    if(!ghost?.isConnected){
        smartCanvasInteractionRemoveMediaGhost(state);
        return;
    }
    const targetRect = targetElement?.getBoundingClientRect?.();
    if(!targetRect){
        smartCanvasInteractionRemoveMediaGhost(state);
        return;
    }
    ghost.classList.add('is-releasing');
    requestAnimationFrame(() => {
        ghost.style.left = `${targetRect.left}px`;
        ghost.style.top = `${targetRect.top}px`;
        ghost.style.width = `${targetRect.width}px`;
        ghost.style.height = `${targetRect.height}px`;
    });
    setTimeout(() => smartCanvasInteractionRemoveMediaGhost(state),260);
}

function smartCanvasInteractionBeginFrame(event){
    if(
        !canvas
        || !smartFrameToolActive
        || !event
        || event.button !== 0
        || smartCanvasInteractionState
    ){
        return false;
    }
    if(smartCanvasInteractionOwnsTarget(event.target)){
        return false;
    }
    const hitNode = event.target.closest('.image-node');
    if(hitNode && !hitNode.classList.contains('smart-frame-node')){
        return false;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    didPan = false;
    const point =
        canvasInteractionViewportModule.viewport.screenToWorld(event);
    canvasInteractionPersistenceModule.hold({scope:'draw-frame'});
    canvasInteractionMutationModule.history({action:'capture'});
    const node = canvasInteractionMutationModule.create({
        kind:'frame',
        data:{
            x:point.x,
            y:point.y,
            w:SMART_FRAME_MIN_WIDTH,
            h:SMART_FRAME_MIN_HEIGHT
        },
        options:{
            skipUndo:true,
            render:false,
            save:false,
            positionMode:'exact'
        }
    });
    if(!node){
        canvasInteractionMutationModule.history({action:'discard'});
        canvasInteractionPersistenceModule.release({scope:'draw-frame'});
        return false;
    }
    smartCanvasInteractionState = {
        kind:'draw-frame',
        id:node.id,
        startWorld:point,
        startClient:{x:event.clientX,y:event.clientY},
        moved:false
    };
    render();
    return true;
}
function smartCanvasInteractionBeginResize(event,nodeId){
    if(
        !canvas
        || smartCanvasInteractionState
        || !event
        || event.button !== 0
    ){
        return false;
    }
    const node = nodes.find(candidate => candidate.id === nodeId);
    if(!node) return false;
    event.preventDefault();
    event.stopPropagation();
    const rect = nodeRect(node);
    const state = {
        kind:'resize-node',
        id:node.id,
        startX:event.clientX,
        startY:event.clientY,
        startW:rect.width,
        startH:rect.height,
        snapshot:smartCanvasInteractionSnapshot()
    };
    if(isSmartImageNode(node) && (node.images || []).length === 1){
        const image = node.images[0] || {};
        const kind = typeof mediaKindForItem === 'function'
            ? mediaKindForItem(image)
            : String(image.kind || 'image').toLowerCase();
        const naturalWidth = Number(image.natural_w || image.width || image.w || image.layout_w || 0);
        const naturalHeight = Number(image.natural_h || image.height || image.h || image.layout_h || 0);
        if(kind === 'image'){
            state.aspectRatio = naturalWidth > 0 && naturalHeight > 0
                ? naturalWidth / naturalHeight
                : rect.width / Math.max(1,rect.height);
        }
    }
    smartCanvasInteractionState = state;
    document.body.classList.add('smart-node-resize');
    canvasInteractionPersistenceModule.hold({scope:'resize-node'});
    canvasInteractionMutationModule.history({action:'capture'});
    return true;
}
function smartCanvasInteractionNodeMinimumSize(node){
    if(node?.type === 'smart-prompt') return {width:260,height:170};
    if(node?.type === 'smart-splitter') return {width:260,height:150};
    if(node?.type === 'smart-loop') return {width:252,height:132};
    if(node?.type === 'smart-group'){
        return {
            width:SMART_GROUP_MIN_WIDTH,
            height:SMART_GROUP_MIN_HEIGHT
        };
    }
    if(node?.type === 'smart-frame'){
        return {
            width:SMART_FRAME_MIN_WIDTH,
            height:SMART_FRAME_MIN_HEIGHT
        };
    }
    return {width:48,height:48};
}
function smartCanvasInteractionBeginSelectionResize(event){
    if(
        !canvas
        || smartCanvasInteractionState
        || !event
        || event.button !== 0
    ){
        return false;
    }
    const ids = [...new Set(
        canvasInteractionViewportModule.selection.ids()
            .map(id => canvasInteractionContainerModule.groupFor?.(id)?.id || id)
            .filter(id => nodes.some(node => node.id === id))
    )];
    const bounds =
        canvasInteractionViewportModule.selection.bounds?.(ids);
    if(ids.length < 2 || !bounds) return false;
    event.preventDefault();
    event.stopPropagation();
    const items = ids.map(id => {
        const node = nodes.find(candidate => candidate.id === id);
        const rect = nodeRect(node);
        const minimum = smartCanvasInteractionNodeMinimumSize(node);
        return {
            id,
            x:Number(rect.x) || 0,
            y:Number(rect.y) || 0,
            width:Math.max(1,Number(rect.width) || 1),
            height:Math.max(1,Number(rect.height) || 1),
            minWidth:minimum.width,
            minHeight:minimum.height
        };
    });
    const minFactor = Math.max(
        0.08,
        ...items.flatMap(item => [
            item.minWidth / item.width,
            item.minHeight / item.height
        ])
    );
    smartCanvasInteractionState = {
        kind:'resize-selection',
        startX:event.clientX,
        startY:event.clientY,
        bounds:{...bounds},
        items,
        minFactor,
        factor:1,
        snapshot:smartCanvasInteractionSnapshot()
    };
    document.body.classList.add('smart-node-resize');
    canvasInteractionPersistenceModule.hold({
        scope:'resize-selection'
    });
    canvasInteractionMutationModule.history({action:'capture'});
    return true;
}
function smartCanvasInteractionBeginMove(event,nodeId){
    if(
        !canvas
        || smartCanvasInteractionState
        || !event
        || event.button !== 0
        || event.target.closest(
            '.smart-node-floating-menu,.node-resize-handle,.thumb-item,.input-thumb,'
            + '.smart-group-single-thumb,.node-port,'
            + '.prompt-node-control:not(.prompt-node-text):not(.prompt-llm-instruction):not(.prompt-node-input-thumbs),'
            + '[contenteditable="true"],select,input,'
            + 'textarea:not(.prompt-node-text),button,ic-button,ic-icon-button'
        )
        || event.target.closest(
            '.prompt-node-pill,textarea:not(.prompt-node-text)'
        )
    ){
        return false;
    }
    let node = nodes.find(candidate => candidate.id === nodeId);
    if(!node) return false;
    const ownerGroup = canvasInteractionContainerModule.groupFor?.(node.id);
    if(ownerGroup && !event.altKey){
        return smartCanvasInteractionBeginMemberDetach(
            event,
            ownerGroup.id,
            node.id
        );
    }
    if(
        canvasInteractionContainerModule.isFrame(node)
        && !canvasInteractionViewportModule.selection.has(node.id)
    ){
        return false;
    }
    event.preventDefault();
    event.stopPropagation();
    window.getSelection?.()?.removeAllRanges?.();
    if(document.activeElement?.blur) document.activeElement.blur();
    const snapshot = smartCanvasInteractionSnapshot();
    canvasInteractionMutationModule.history({action:'capture'});
    if(event.altKey){
        const duplicate = canvasInteractionMutationModule.duplicate({
            mode:'alt',
            nodeIds:canvasInteractionContainerModule.expand(
                canvasInteractionViewportModule.selection.has(node.id)
                    ? canvasInteractionViewportModule.selection.ids()
                    : [node.id]
            ),
            anchorNodeId:node.id,
            skipUndo:true,
            render:false,
            save:false
        });
        node = duplicate.anchor || node;
        if(!duplicate.anchor){
            canvasInteractionMutationModule.history({action:'discard'});
            return false;
        }
        render();
    }
    let dragIds = selectedIds.includes(node.id)
        ? selectedIds.slice()
        : [node.id];
    dragIds = canvasInteractionContainerModule.expand(dragIds);
    const group = dragIds.map(id => {
        const member = nodes.find(candidate => candidate.id === id);
        return member
            ? {
                id:member.id,
                ox:Number(member.x) || 0,
                oy:Number(member.y) || 0
            }
            : null;
    }).filter(Boolean);
    smartCanvasInteractionState = {
        kind:'move-nodes',
        id:node.id,
        startX:event.clientX,
        startY:event.clientY,
        ox:Number(node.x) || 0,
        oy:Number(node.y) || 0,
        group,
        groupIds:group.map(item => item.id),
        ctrlGroup:Boolean(event.ctrlKey),
        snapshot,
        duplicated:Boolean(event.altKey)
    };
    document.body.classList.add('smart-node-drag');
    canvasInteractionPersistenceModule.hold({scope:'move-nodes'});
    return true;
}
function smartCanvasInteractionBeginDetach(event,nodeId,mediaIndex){
    if(
        !canvas
        || smartCanvasInteractionState
        || !event
        || event.button !== 0
        || event.detail >= 2
        || event.target.closest('video,audio')
    ){
        return false;
    }
    const node = nodes.find(candidate => candidate.id === nodeId);
    const index = Number(mediaIndex) || 0;
    const canDetach = node && (
        canvasInteractionContainerModule.isGroup(node)
            ? Boolean(node.images?.[index])
            : (node.images || []).length > 1
    );
    if(!canDetach) return false;
    event.preventDefault();
    event.stopPropagation();
    const snapshot = smartCanvasInteractionSnapshot();
    selectedId = node.id;
    selectedIds = [];
    selectedImage = {nodeId:node.id,index};
    const nodeElement = world?.querySelector?.(
        `.image-node[data-id="${CSS.escape(node.id)}"]`
    );
    nodeElement?.classList.add('selected');
    nodeElement?.querySelectorAll?.('.thumb-item.image-selected')
        .forEach(item => item.classList.remove('image-selected'));
    nodeElement?.querySelector?.(
        `.thumb-item[data-image-index="${index}"]`
    )?.classList.add('image-selected');
    canvasInteractionViewportModule.selection.refresh?.();
    smartCanvasInteractionState = {
        kind:'detach-media',
        nodeId:node.id,
        mediaIndex:index,
        startX:event.clientX,
        startY:event.clientY,
        snapshot
    };
    canvasInteractionPersistenceModule.hold({scope:'thumb-drag'});
    canvasInteractionMutationModule.history({action:'capture'});
    return true;
}
function smartCanvasInteractionBeginMemberDetach(event,groupId,nodeId){
    if(
        !canvas
        || smartCanvasInteractionState
        || !event
        || event.button !== 0
        || event.detail >= 2
        || event.target.closest('video,audio')
    ) return false;
    const group = nodes.find(candidate => candidate.id === groupId);
    const node = nodes.find(candidate => candidate.id === nodeId);
    if(
        !canvasInteractionContainerModule.isGroup(group)
        || !node
        || canvasInteractionContainerModule.groupFor(node.id)?.id !== group.id
    ) return false;
    event.preventDefault();
    event.stopPropagation();
    const sourceElement = event.target.closest(
        '.thumb-item,.smart-group-single-thumb,.image-node'
    );
    const sourceRect = sourceElement?.getBoundingClientRect?.();
    const width = Math.max(1,Number(sourceRect?.width) || 1);
    const height = Math.max(1,Number(sourceRect?.height) || 1);
    selectedId = node.id;
    selectedIds = [];
    selectedImage = {nodeId:node.id,index:0};
    canvasInteractionViewportModule.selection.refresh?.();
    smartCanvasInteractionState = {
        kind:'detach-member',
        nodeId:node.id,
        groupId:group.id,
        startX:event.clientX,
        startY:event.clientY,
        grabX:Math.max(0,Math.min(1,(event.clientX - (sourceRect?.left || 0)) / width)),
        grabY:Math.max(0,Math.min(1,(event.clientY - (sourceRect?.top || 0)) / height)),
        snapshot:smartCanvasInteractionSnapshot()
    };
    canvasInteractionPersistenceModule.hold({scope:'thumb-drag'});
    canvasInteractionMutationModule.history({action:'capture'});
    return true;
}

function smartCanvasInteractionMoveFrame(event,state){
    const node = nodes.find(candidate => candidate.id === state.id);
    if(!node || !event) return false;
    const point =
        canvasInteractionViewportModule.viewport.screenToWorld(event);
    const rawWidth = Math.abs(point.x - state.startWorld.x);
    const rawHeight = Math.abs(point.y - state.startWorld.y);
    if(
        Math.abs(event.clientX - state.startClient.x)
        + Math.abs(event.clientY - state.startClient.y)
        > 5
    ){
        state.moved = true;
    }
    node.x = point.x < state.startWorld.x
        ? state.startWorld.x - Math.max(SMART_FRAME_MIN_WIDTH,rawWidth)
        : state.startWorld.x;
    node.y = point.y < state.startWorld.y
        ? state.startWorld.y - Math.max(SMART_FRAME_MIN_HEIGHT,rawHeight)
        : state.startWorld.y;
    node.w = Math.max(SMART_FRAME_MIN_WIDTH,Math.round(rawWidth));
    node.h = Math.max(SMART_FRAME_MIN_HEIGHT,Math.round(rawHeight));
    const element = world.querySelector(
        `.image-node[data-id="${CSS.escape(node.id)}"]`
    );
    if(element){
        element.style.left = `${node.x}px`;
        element.style.top = `${node.y}px`;
    }
    syncNodeElementLayout(node);
    canvasInteractionViewportModule.viewport.refresh();
    return true;
}
function smartCanvasInteractionMoveResize(event,state){
    const node = nodes.find(candidate => candidate.id === state.id);
    if(!node || !event) return false;
    if(node.generationOutputNode){
        delete node.generationMediaW;
        delete node.generationMediaH;
    }
    const deltaX = (event.clientX - state.startX) / viewport.scale;
    const deltaY = (event.clientY - state.startY) / viewport.scale;
    const minWidth = node.type === 'smart-prompt'
        ? 260
        : node.type === 'smart-splitter'
            ? 260
        : node.type === 'smart-loop'
            ? 252
            : node.type === 'smart-group'
                ? SMART_GROUP_MIN_WIDTH
                : node.type === 'smart-frame'
                    ? SMART_FRAME_MIN_WIDTH
                    : 48;
    const minHeight = node.type === 'smart-prompt'
        ? 170
        : node.type === 'smart-splitter'
            ? 150
        : node.type === 'smart-loop'
            ? 132
            : node.type === 'smart-group'
                ? SMART_GROUP_MIN_HEIGHT
                : node.type === 'smart-frame'
                    ? SMART_FRAME_MIN_HEIGHT
                    : 48;
    if(node.type === 'smart-group'){
        node.w = Math.max(
            minWidth,
            Math.round(state.startW + deltaX)
        );
        node.h = Math.max(
            minHeight,
            Math.round(state.startH + deltaY)
        );
        canvasInteractionContainerModule.arrange(node,{
            skipUndo:true,
            syncDom:true
        });
        syncNodeElementLayout(node);
        return true;
    }
    if(Number.isFinite(state.aspectRatio) && state.aspectRatio > 0){
        const targetWidth = state.startW + deltaX;
        const targetHeight = state.startH + deltaY;
        const useWidth = Math.abs(deltaX / Math.max(1,state.startW))
            >= Math.abs(deltaY / Math.max(1,state.startH));
        let width = useWidth ? targetWidth : targetHeight * state.aspectRatio;
        let height = useWidth ? targetWidth / state.aspectRatio : targetHeight;
        if(width < minWidth){
            width = minWidth;
            height = width / state.aspectRatio;
        }
        if(height < minHeight){
            height = minHeight;
            width = height * state.aspectRatio;
        }
        node.w = Math.round(width);
        node.h = Math.round(height);
        node.scale = 1;
        syncNodeElementLayout(node);
        return true;
    }
    node.w = Math.max(minWidth,Math.round(state.startW + deltaX));
    node.h = Math.max(minHeight,Math.round(state.startH + deltaY));
    node.scale = 1;
    syncNodeElementLayout(node);
    return true;
}
function smartCanvasInteractionMoveSelectionResize(event,state){
    if(!event || !state?.items?.length) return false;
    const deltaX = (event.clientX - state.startX) / viewport.scale;
    const deltaY = (event.clientY - state.startY) / viewport.scale;
    const ratioX =
        (state.bounds.width + deltaX) / Math.max(1,state.bounds.width);
    const ratioY =
        (state.bounds.height + deltaY) / Math.max(1,state.bounds.height);
    const useX =
        Math.abs(deltaX / Math.max(1,state.bounds.width))
        >= Math.abs(deltaY / Math.max(1,state.bounds.height));
    const factor = Math.max(
        state.minFactor || 0.08,
        Math.min(8,useX ? ratioX : ratioY)
    );
    state.factor = factor;
    state.items.forEach(item => {
        const node = nodes.find(candidate => candidate.id === item.id);
        if(!node) return;
        node.x = Math.round(
            state.bounds.x + (item.x - state.bounds.x) * factor
        );
        node.y = Math.round(
            state.bounds.y + (item.y - state.bounds.y) * factor
        );
        node.w = Math.max(
            item.minWidth,
            Math.round(item.width * factor)
        );
        node.h = Math.max(
            item.minHeight,
            Math.round(item.height * factor)
        );
        node.scale = 1;
        const element = world.querySelector(
            `.image-node[data-id="${CSS.escape(node.id)}"]`
        );
        if(element){
            element.style.left = `${node.x}px`;
            element.style.top = `${node.y}px`;
        }
        syncNodeElementLayout(node);
    });
    canvasInteractionViewportModule.viewport.refresh();
    scheduleConnectionLayerRefresh();
    return true;
}
function smartCanvasInteractionMoveDetach(event,state){
    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    if(Math.abs(deltaX) + Math.abs(deltaY) <= 6) return true;
    state.moved = true;
    const source = nodes.find(
        candidate => candidate.id === state.nodeId
    );
    const canDetach = source && (
        canvasInteractionContainerModule.isGroup(source)
            ? (source.images || []).length >= 1
            : (source.images || []).length > 1
    );
    const image = canDetach
        ? source.images?.[state.mediaIndex]
        : null;
    if(!image) return true;
    const reorderTarget = smartCanvasInteractionMediaReorderTarget(
        event,
        state
    );
    if(reorderTarget.inside){
        smartCanvasInteractionPreviewMediaReorder(
            state,
            reorderTarget,
            event
        );
        return true;
    }
    smartCanvasInteractionClearMediaReorderPreview();
    smartCanvasInteractionRemoveMediaGhost(state);
    document.body.classList.remove('smart-media-reorder-drag');
    state.reorderIndex = -1;
    applyNodeMetaToImage(image,source);
    if(canvasInteractionContainerModule.isGroup(source)){
        canvasInteractionContainerModule.takeMedia(
            source,
            state.mediaIndex
        );
        delete image.groupMemberId;
    } else {
        source.images.splice(state.mediaIndex,1);
    }
    if(canvasInteractionContainerModule.isGroup(source)){
        canvasInteractionContainerModule.arrange(source,{
            skipUndo:true,
            syncDom:true
        });
    } else if(source.images.length <= 1){
        source.title = canvasInteractionText('smart.kindImage', 'Image');
        delete source.w;
        delete source.h;
        inheritNodeMetaFromImage(source);
    }
    const point =
        canvasInteractionViewportModule.viewport.screenToWorld(event);
    selectedId = '';
    selectedIds = [];
    selectedImage = {nodeId:'',index:-1};
    const newNode = createImageNodeAt(point,[image],{
        select:false,
        skipUndo:true,
        positionMode:'exact',
        reveal:false
    });
    if(!newNode) return true;
    canvasInteractionPersistenceModule.release({scope:'thumb-drag'});
    canvasInteractionPersistenceModule.hold({scope:'move-nodes'});
    smartCanvasInteractionState = {
        kind:'move-nodes',
        id:newNode.id,
        startX:event.clientX,
        startY:event.clientY,
        ox:newNode.x,
        oy:newNode.y,
        group:[{
            id:newNode.id,
            ox:Number(newNode.x) || 0,
            oy:Number(newNode.y) || 0
        }],
        groupIds:[newNode.id],
        ctrlGroup:Boolean(event.ctrlKey),
        snapshot:state.snapshot,
        thumbDetached:true,
        fromThumb:true
    };
    document.body.classList.add('smart-node-drag');
    render();
    return smartCanvasInteractionMoveNodes(
        event,
        smartCanvasInteractionState
    );
}
function smartCanvasInteractionMoveMemberDetach(event,state){
    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    if(Math.abs(deltaX) + Math.abs(deltaY) <= 6) return true;
    const node = nodes.find(candidate => candidate.id === state.nodeId);
    if(!node) return true;
    if(!canvasInteractionContainerModule.release(
        [node.id],
        state.groupId,
        {
            skipUndo:true,
            select:false,
            render:false,
            save:false,
            message:false
        }
    )) return true;
    const point = canvasInteractionViewportModule.viewport.screenToWorld(event);
    const rect = nodeRect(node);
    node.x = point.x - rect.width * state.grabX;
    node.y = point.y - rect.height * state.grabY;
    selectedId = node.id;
    selectedIds = [];
    selectedImage = {
        nodeId:node.id,
        index:isSmartImageNode(node) ? 0 : -1
    };
    canvasInteractionPersistenceModule.release({scope:'thumb-drag'});
    canvasInteractionPersistenceModule.hold({scope:'move-nodes'});
    smartCanvasInteractionState = {
        kind:'move-nodes',
        id:node.id,
        startX:event.clientX,
        startY:event.clientY,
        ox:node.x,
        oy:node.y,
        group:[{id:node.id,ox:node.x,oy:node.y}],
        groupIds:[node.id],
        ctrlGroup:Boolean(event.ctrlKey),
        snapshot:state.snapshot,
        sourceGroupId:state.groupId,
        thumbDetached:true,
        fromThumb:true
    };
    document.body.classList.add('smart-node-drag');
    render();
    return smartCanvasInteractionMoveNodes(event,smartCanvasInteractionState);
}
function smartCanvasInteractionMoveNodes(event,state){
    const node = nodes.find(candidate => candidate.id === state.id);
    if(!node || !event) return false;
    state.lastClientX = event.clientX;
    state.lastClientY = event.clientY;
    const deltaX = (event.clientX - state.startX) / viewport.scale;
    const deltaY = (event.clientY - state.startY) / viewport.scale;
    (state.group || [{
        id:state.id,
        ox:state.ox,
        oy:state.oy
    }]).forEach(item => {
        const member = nodes.find(candidate => candidate.id === item.id);
        if(!member) return;
        member.x = item.ox + deltaX;
        member.y = item.oy + deltaY;
    });
    const draggedRect = nodeRect(node);
    // Smart Group is a container, so entering it is the default drag result.
    // Ctrl/Command is reserved for connection and loop-insertion gestures.
    const smartGroupTarget = canvasInteractionContainerModule.dragTarget(
        node,
        state.groupIds || []
    );
    const rawTarget = state.ctrlGroup
        ? (
            ['smart-prompt','smart-splitter','smart-loop'].includes(node.type)
                ? smartCanvasInteractionConnectTarget(
                    node,
                    canvasInteractionViewportModule
                        .viewport.screenToWorld(event)
                )
                : smartCanvasInteractionRectTarget(
                    node.id,
                    draggedRect.x,
                    draggedRect.y,
                    draggedRect.width,
                    draggedRect.height,
                    state.groupIds
                )
        )
        : null;
    const target = smartGroupTarget || (
        canvasInteractionContainerModule.isGroup(rawTarget)
            ? null
            : rawTarget
    );
    smartCanvasInteractionSetDropHighlight(target?.id || '');
    smartCanvasInteractionProjectMovedNodes(state);
    smartCanvasInteractionUpdateLoopPreview(state);
    return true;
}
function smartCanvasInteractionMove(event){
    const state = smartCanvasInteractionState;
    if(!state || !event) return false;
    event.preventDefault?.();
    if(state.kind === 'draw-frame'){
        return smartCanvasInteractionMoveFrame(event,state);
    }
    if(state.kind === 'resize-node'){
        return smartCanvasInteractionMoveResize(event,state);
    }
    if(state.kind === 'resize-selection'){
        return smartCanvasInteractionMoveSelectionResize(event,state);
    }
    if(state.kind === 'detach-media'){
        return smartCanvasInteractionMoveDetach(event,state);
    }
    if(state.kind === 'detach-member'){
        return smartCanvasInteractionMoveMemberDetach(event,state);
    }
    if(state.kind === 'move-nodes'){
        return smartCanvasInteractionMoveNodes(event,state);
    }
    return false;
}

function smartCanvasInteractionEndFrame(state){
    const node = nodes.find(candidate => candidate.id === state.id);
    if(!node) return false;
    if(!state.moved){
        node.x = state.startWorld.x - SMART_FRAME_DEFAULT_WIDTH / 2;
        node.y = state.startWorld.y - SMART_FRAME_DEFAULT_HEIGHT / 2;
        node.w = SMART_FRAME_DEFAULT_WIDTH;
        node.h = SMART_FRAME_DEFAULT_HEIGHT;
    }
    smartCanvasInteractionState = null;
    canvasInteractionContainerModule.reconcileFrames();
    canvasInteractionMutationModule.history({action:'commit'});
    smartCanvasInteractionRelease(state);
    suppressSmartAnnotationClickUntil = Date.now() + 320;
    smartBaseTool = 'pointer';
    smartFrameToolActive = false;
    refreshSmartAnnotationToolbar();
    render();
    canvasInteractionPersistenceModule.schedule();
    beginCreatedSmartFrameTitleEdit(node);
    return true;
}
function smartCanvasInteractionEndResize(state){
    const node = nodes.find(candidate => candidate.id === state.id);
    const rect = node ? nodeRect(node) : null;
    const changed = Boolean(
        rect
        && (
            Math.abs(rect.width - state.startW) > 1
            || Math.abs(rect.height - state.startH) > 1
        )
    );
    if(changed){
        if(canvasInteractionContainerModule.isFrame(node)){
            canvasInteractionContainerModule.reconcileFrames();
        }
        canvasInteractionMutationModule.history({action:'commit'});
    } else {
        canvasInteractionMutationModule.history({action:'discard'});
    }
    smartCanvasInteractionState = null;
    smartCanvasInteractionRelease(state);
    if(changed){
        render();
        canvasInteractionPersistenceModule.schedule();
    }
    return true;
}
function smartCanvasInteractionEndSelectionResize(state){
    const changed = Math.abs(Number(state.factor || 1) - 1) > 0.001;
    if(changed){
        canvasInteractionContainerModule.reconcileFrames();
        canvasInteractionMutationModule.history({action:'commit'});
    } else {
        canvasInteractionMutationModule.history({action:'discard'});
    }
    smartCanvasInteractionState = null;
    smartCanvasInteractionRelease(state);
    smartCanvasInteractionResetVisuals();
    render();
    if(changed) canvasInteractionPersistenceModule.schedule();
    return true;
}
function smartCanvasInteractionEndDetach(state){
    const source = nodes.find(candidate => candidate.id === state.nodeId);
    const fromIndex = Number(state.mediaIndex);
    const toIndex = Number(state.reorderIndex);
    const changed = Boolean(
        source
        && Number.isInteger(fromIndex)
        && Number.isInteger(toIndex)
        && fromIndex >= 0
        && toIndex >= 0
        && fromIndex < (source.images || []).length
        && toIndex < (source.images || []).length
        && fromIndex !== toIndex
    );
    if(changed){
        if(canvasInteractionContainerModule.isGroup(source)){
            canvasInteractionContainerModule.reorderMedia(
                source,
                fromIndex,
                toIndex
            );
        } else {
            const [image] = source.images.splice(fromIndex,1);
            source.images.splice(toIndex,0,image);
        }
        if(selectedImage.nodeId === source.id){
            const selectedIndex = Number(selectedImage.index);
            if(selectedIndex === fromIndex){
                selectedImage = {nodeId:source.id,index:toIndex};
            } else if(
                fromIndex < toIndex
                && selectedIndex > fromIndex
                && selectedIndex <= toIndex
            ){
                selectedImage = {
                    nodeId:source.id,
                    index:selectedIndex - 1
                };
            } else if(
                toIndex < fromIndex
                && selectedIndex >= toIndex
                && selectedIndex < fromIndex
            ){
                selectedImage = {
                    nodeId:source.id,
                    index:selectedIndex + 1
                };
            }
        }
        canvasInteractionMutationModule.history({action:'commit'});
    } else {
        canvasInteractionMutationModule.history({action:'discard'});
    }
    if(state.moved){
        suppressNodeClickUntil = Date.now() + 180;
        suppressImageClickUntil = Date.now() + 260;
    }
    smartCanvasInteractionState = null;
    smartCanvasInteractionRelease(state);
    smartCanvasInteractionResetVisuals({preserveMediaGhost:changed});
    if(changed){
        render();
        const targetElement = world?.querySelector?.(
            `.image-node[data-id="${CSS.escape(source.id)}"] `
            + `.thumb-item[data-image-index="${toIndex}"]`
        );
        targetElement?.classList.add('media-reorder-drop-feedback');
        if(targetElement){
            setTimeout(() => targetElement.classList.remove(
                'media-reorder-drop-feedback'
            ),320);
        }
        smartCanvasInteractionReleaseMediaGhost(state,targetElement);
        canvasInteractionPersistenceModule.schedule();
    } else {
        smartCanvasInteractionRemoveMediaGhost(state);
    }
    return true;
}
function smartCanvasInteractionEndMove(event,state){
    if(
        !state.thumbDetached
        && !state.duplicated
        && smartCanvasInteractionPointerDistance(state,event)
            < SMART_CANVAS_INTERACTION_COMMIT_DISTANCE_PX
    ){
        smartCanvasInteractionRestoreMovedNodes(state);
        smartCanvasInteractionProjectMovedNodes(state);
        canvasInteractionMutationModule.history({action:'discard'});
        smartCanvasInteractionState = null;
        smartCanvasInteractionRelease(state);
        smartCanvasInteractionResetVisuals();
        return true;
    }
    const draggedNode = nodes.find(candidate => candidate.id === state.id);
    let stateChanged = false;
    const autoTarget = draggedNode && state.ctrlGroup
        ? smartCanvasInteractionConnectTarget(
            draggedNode,
            canvasInteractionViewportModule.viewport.screenToWorld(event)
        )
        : null;
    const insertHit = draggedNode?.type === 'smart-loop'
        && state.ctrlGroup
        && (state.group || []).length <= 1
        ? smartCanvasInteractionInsertionConnection(draggedNode)
        : null;
    const draggedNodes = (state.group || [])
        .map(item => nodes.find(candidate => candidate.id === item.id))
        .filter(Boolean);
    const smartGroupTarget = draggedNode
        ? canvasInteractionContainerModule.dragTarget(
            draggedNode,
            state.groupIds || []
        )
        : null;
    if(
        state.sourceGroupId
        && smartGroupTarget?.id === state.sourceGroupId
        && draggedNode
    ){
        const original = (state.snapshot?.nodes || []).find(
            candidate => candidate.id === draggedNode.id
        );
        if(original){
            ['x','y','w','h','scale'].forEach(key => {
                if(original[key] === undefined) delete draggedNode[key];
                else draggedNode[key] = original[key];
            });
        }
    }
    if(
        insertHit
        && smartCanvasInteractionInsertLoop(draggedNode,insertHit)
    ){
        stateChanged = true;
        render();
    } else if(
        smartGroupTarget
        && canvasInteractionContainerModule.add(
            smartGroupTarget.id,
            (draggedNodes.length ? draggedNodes : [draggedNode])
                .filter(Boolean)
                .map(node => node.id),
            {
                skipUndo:true,
                arrange:true,
                select:true
            }
        )
    ){
        stateChanged = true;
        render();
    } else if(
        smartGroupTarget
        && canvasInteractionContainerModule.groupFor(draggedNode?.id)?.id
            === smartGroupTarget.id
        && smartCanvasInteractionNodesMoved(state)
        && canvasInteractionContainerModule.arrange(
            smartGroupTarget,
            {skipUndo:true,syncDom:true}
        )
    ){
        stateChanged = true;
        render();
    } else if(
        draggedNode
        && autoTarget
        && state.ctrlGroup
        && (state.group || []).length <= 1
        && smartCanvasInteractionCanConnect(draggedNode,autoTarget)
        && canvasInteractionMutationModule.connect({
            fromId:draggedNode.id,
            toId:autoTarget.id,
            input:true
        })
    ){
        stateChanged = true;
        smartCanvasInteractionRestoreMovedNodes(state);
        if(selectedId === draggedNode.id) selectedId = '';
        render();
    } else if(
        draggedNode
        && (draggedNode.images || []).length
        && (state.group || []).length <= 1
    ){
        const rect = nodeRect(draggedNode);
        const target = smartCanvasInteractionRectTarget(
            draggedNode.id,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            state.groupIds
        );
        if(target && canvasInteractionContainerModule.isGroup(target)){
            if(smartCanvasInteractionNodesMoved(state)){
                stateChanged = true;
            }
        } else if(
            target
            && state.ctrlGroup
            && !canvasInteractionContainerModule.isGroup(target)
            && smartCanvasInteractionCanConnect(draggedNode,target)
        ){
            stateChanged = true;
            canvasInteractionMutationModule.connect({
                fromId:draggedNode.id,
                toId:target.id,
                input:true
            });
            if(!state.thumbDetached){
                smartCanvasInteractionRestoreMovedNodes(state);
            }
            if(selectedId === draggedNode.id) selectedId = '';
            render();
        } else if(smartCanvasInteractionNodesMoved(state)){
            stateChanged = true;
        }
    } else if(smartCanvasInteractionNodesMoved(state)){
        stateChanged = true;
    }
    if(state.thumbDetached || state.duplicated) stateChanged = true;
    if(
        draggedNode
        && !smartGroupTarget
        && canvasInteractionContainerModule.prune(draggedNode.id)
    ){
        stateChanged = true;
        render();
    }
    if(canvasInteractionContainerModule.reconcileFrames()){
        stateChanged = true;
        render();
    }
    if(stateChanged){
        canvasInteractionMutationModule.history({action:'commit'});
    } else {
        smartCanvasInteractionRestoreMovedNodes(state);
        smartCanvasInteractionProjectMovedNodes(state);
        canvasInteractionMutationModule.history({action:'discard'});
    }
    if(stateChanged || state.thumbDetached){
        suppressNodeClickUntil = Date.now() + 180;
    }
    smartCanvasInteractionState = null;
    smartCanvasInteractionRelease(state);
    smartCanvasInteractionResetVisuals();
    if(stateChanged){
        canvasInteractionPersistenceModule.schedule();
    }
    return true;
}
function smartCanvasInteractionEnd(event){
    const state = smartCanvasInteractionState;
    if(!state) return false;
    if(state.kind === 'draw-frame'){
        return smartCanvasInteractionEndFrame(state);
    }
    if(state.kind === 'resize-node'){
        return smartCanvasInteractionEndResize(state);
    }
    if(state.kind === 'resize-selection'){
        return smartCanvasInteractionEndSelectionResize(state);
    }
    if(state.kind === 'detach-media'){
        return smartCanvasInteractionEndDetach(state);
    }
    if(state.kind === 'detach-member'){
        canvasInteractionMutationModule.history({action:'discard'});
        smartCanvasInteractionState = null;
        smartCanvasInteractionRelease(state);
        smartCanvasInteractionResetVisuals();
        return true;
    }
    if(state.kind === 'move-nodes'){
        return smartCanvasInteractionEndMove(event || {},state);
    }
    return false;
}
function smartCanvasInteractionCancel({reason='',event=null}={}){
    const state = smartCanvasInteractionState;
    if(!state) return false;
    event?.preventDefault?.();
    if(state.kind === 'draw-frame'){
        canvasInteractionMutationModule.remove({
            nodeIds:[state.id],
            options:{
                skipUndo:true,
                render:false,
                save:false
            }
        });
    } else {
        smartCanvasInteractionRestoreSnapshot(state.snapshot);
    }
    canvasInteractionMutationModule.history({action:'discard'});
    smartCanvasInteractionState = null;
    smartCanvasInteractionRelease(state);
    smartCanvasInteractionResetVisuals();
    render();
    if(reason === 'remote-delete'){
        toast(tr('smart.nodeDeletedByCollaborator'));
    }
    return true;
}
function smartCanvasInteractionBegin({
    kind='',
    event=null,
    nodeId='',
    mediaIndex=-1,
    groupId=''
}={}){
    if(
        typeof canvasInteractionPersistenceModule.editable === 'function'
        && !canvasInteractionPersistenceModule.editable()
    ){
        toast(tr('smart.syncRetryTop'));
        return false;
    }
    const normalizedKind = smartCanvasInteractionNormalizeKind(kind);
    let started = false;
    if(normalizedKind === 'draw-frame'){
        started = smartCanvasInteractionBeginFrame(event);
    } else if(normalizedKind === 'resize-node'){
        started = smartCanvasInteractionBeginResize(event,nodeId);
    } else if(normalizedKind === 'resize-selection'){
        started = smartCanvasInteractionBeginSelectionResize(event);
    } else if(normalizedKind === 'move-nodes'){
        started = smartCanvasInteractionBeginMove(event,nodeId);
    } else if(normalizedKind === 'detach-media'){
        started = smartCanvasInteractionBeginDetach(
            event,
            nodeId,
            mediaIndex
        );
    } else if(normalizedKind === 'detach-member'){
        started = smartCanvasInteractionBeginMemberDetach(
            event,
            groupId,
            nodeId
        );
    }
    if(started){
        canvasInteractionVirtualizationModule?.pin?.(
            smartCanvasInteractionNodeIds(),
            'canvas-interaction'
        );
    }
    return started;
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.canvasInteraction = Object.freeze({
    active:smartCanvasInteractionActive,
    ownsTarget:smartCanvasInteractionOwnsTarget,
    begin:smartCanvasInteractionBegin,
    move:smartCanvasInteractionMove,
    end:smartCanvasInteractionEnd,
    cancel:smartCanvasInteractionCancel
});
