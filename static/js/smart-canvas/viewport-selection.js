/*
 * Smart Canvas Viewport & Selection Module
 *
 * Owns client-local Selection, camera projection, the Smart Minimap adapter,
 * Zoom Preview and marquee-selection behaviour. None of these operations is a
 * Canvas Mutation or a reason to schedule Canvas Sync.
 */
let smartViewportSelectionUiNodeIds = new Set();
let smartViewportSelectionUiImage = {nodeId:'', index:-1};
let smartViewportSelectionViewStateReady = false;
let smartViewportSelectionViewStateTimer = null;
let smartViewportSelectionViewStateSaving = false;
let smartViewportSelectionViewStateDirty = false;
let smartViewportSelectionLastSavedViewState = '';
let smartViewportSelectionMinimapTimer = 0;
let smartViewportSelectionMinimapRenderedAt = 0;
const SMART_VIEWPORT_SAVE_DELAY_MS = 900;
const SMART_VIEWPORT_RETRY_DELAY_MS = 5000;
const SMART_VIEWPORT_MIN_SCALE = 0.02;
const SMART_VIEWPORT_MAX_SCALE = 8;

function smartViewportSelectionNow(){
    return globalThis.performance?.now?.() ?? Date.now();
}

function smartViewportSelectionNode(){
    return nodes.find(node => node.id === selectedId) || null;
}
function smartViewportSelectionIds(){
    return selectedIds.length ? selectedIds.slice() : (selectedId ? [selectedId] : []);
}
function smartViewportSelectionHas(nodeId){
    return selectedId === nodeId || selectedIds.includes(nodeId);
}
function smartViewportSelectionBounds(ids=smartViewportSelectionIds()){
    const rects = (ids || [])
        .map(id => nodes.find(node => node.id === id))
        .filter(Boolean)
        .map(nodeRect);
    if(!rects.length) return null;
    const left = Math.min(...rects.map(rect => Number(rect.x) || 0));
    const top = Math.min(...rects.map(rect => Number(rect.y) || 0));
    const right = Math.max(...rects.map(rect =>
        (Number(rect.x) || 0) + (Number(rect.width) || 0)
    ));
    const bottom = Math.max(...rects.map(rect =>
        (Number(rect.y) || 0) + (Number(rect.height) || 0)
    ));
    return {
        x:left,
        y:top,
        width:Math.max(1,right - left),
        height:Math.max(1,bottom - top)
    };
}
function smartViewportSelectionRefreshMultiOverlay(){
    const overlay = typeof smartMultiSelectionBox !== 'undefined'
        ? smartMultiSelectionBox
        : null;
    if(!overlay) return;
    const ids = smartViewportSelectionIds();
    const bounds = ids.length > 1
        ? smartViewportSelectionBounds(ids)
        : null;
    overlay.classList.toggle('open',Boolean(bounds));
    overlay.toggleAttribute('open',Boolean(bounds));
    overlay.setAttribute('aria-hidden',bounds ? 'false' : 'true');
    if(!bounds) return;
    overlay.style.left = `${viewport.x + bounds.x * viewport.scale}px`;
    overlay.style.top = `${viewport.y + bounds.y * viewport.scale}px`;
    overlay.style.width = `${bounds.width * viewport.scale}px`;
    overlay.style.height = `${bounds.height * viewport.scale}px`;
}
function smartViewportSelectionClear(){
    savePromptDraftForCurrent();
    selectedId = '';
    selectedIds = [];
    selectedImage = {nodeId:'', index:-1};
}
function smartViewportSelectionNodeElements(ids){
    return [...(ids || [])]
        .map(id => world.querySelector(`.image-node[data-id="${CSS.escape(id)}"]`))
        .filter(Boolean);
}
function smartViewportSelectionSync(){
    const ids = smartViewportSelectionIds();
    const nextIds = new Set(ids);
    const touchedIds = new Set([...smartViewportSelectionUiNodeIds, ...nextIds]);
    if(smartViewportSelectionUiImage.nodeId) touchedIds.add(smartViewportSelectionUiImage.nodeId);
    if(selectedImage.nodeId) touchedIds.add(selectedImage.nodeId);
    world.classList.toggle('smart-multi-selected', ids.length > 1);
    smartViewportSelectionNodeElements(touchedIds).forEach(el => {
        const id = el.dataset.id || '';
        el.classList.toggle('selected', smartViewportSelectionHas(id));
        el.querySelectorAll('.thumb-item,.image-wrap').forEach(item => {
            const targetNodeId = item.dataset.refNodeId || id;
            const index = Number(item.dataset.refImageIndex ?? item.dataset.imageIndex ?? 0);
            item.classList.toggle(
                'image-selected',
                selectedImage.nodeId === targetNodeId && selectedImage.index === index
            );
        });
    });
    smartViewportSelectionUiNodeIds = nextIds;
    smartViewportSelectionUiImage = {
        nodeId:selectedImage.nodeId || '',
        index:Number(selectedImage.index ?? -1)
    };
    syncRunButtonState();
    syncSmartNodeFloatingPortal();
    smartViewportSelectionRefreshMultiOverlay();
    scheduleConnectionLayerRefresh();
}

function smartViewportSelectionViewStateUrl(){
    if(typeof canvasId === 'undefined' || !canvasId) return '';
    return `/api/smart-canvas/${encodeURIComponent(canvasId)}/view-state`;
}
function smartViewportSelectionSerializableViewState(){
    const center = smartViewportSelectionCenter();
    const scale = Math.max(
        SMART_VIEWPORT_MIN_SCALE,
        Math.min(SMART_VIEWPORT_MAX_SCALE,Number(viewport.scale) || 1)
    );
    if(
        !Number.isFinite(center.x)
        || !Number.isFinite(center.y)
        || Math.abs(center.x) > 1000000000
        || Math.abs(center.y) > 1000000000
    ) return null;
    return {
        center_x:center.x,
        center_y:center.y,
        scale
    };
}
function smartViewportSelectionScheduleViewStateSave(delay=SMART_VIEWPORT_SAVE_DELAY_MS){
    if(
        !smartViewportSelectionViewStateReady
        || !smartViewportSelectionViewStateUrl()
        || (typeof zoomPreviewState !== 'undefined' && zoomPreviewState)
    ) return false;
    smartViewportSelectionViewStateDirty = true;
    clearTimeout(smartViewportSelectionViewStateTimer);
    smartViewportSelectionViewStateTimer = setTimeout(
        () => smartViewportSelectionSaveViewState(),
        Math.max(0,Number(delay) || 0)
    );
    return true;
}
async function smartViewportSelectionSaveViewState({keepalive=false}={}){
    const url = smartViewportSelectionViewStateUrl();
    if(
        !smartViewportSelectionViewStateReady
        || !url
        || (typeof zoomPreviewState !== 'undefined' && zoomPreviewState)
    ) return false;
    const viewState = smartViewportSelectionSerializableViewState();
    if(!viewState) return false;
    const signature = JSON.stringify(viewState);
    if(signature === smartViewportSelectionLastSavedViewState){
        smartViewportSelectionViewStateDirty = false;
        return true;
    }
    if(smartViewportSelectionViewStateSaving && !keepalive){
        smartViewportSelectionViewStateDirty = true;
        return false;
    }
    clearTimeout(smartViewportSelectionViewStateTimer);
    smartViewportSelectionViewStateTimer = null;
    smartViewportSelectionViewStateDirty = false;
    if(!keepalive) smartViewportSelectionViewStateSaving = true;
    try {
        const response = await fetch(url,{
            method:'PUT',
            headers:{'Content-Type':'application/json'},
            body:signature,
            keepalive:Boolean(keepalive)
        });
        if(!response.ok) throw new Error('view-state-save-failed');
        smartViewportSelectionLastSavedViewState = signature;
        return true;
    } catch(error){
        smartViewportSelectionViewStateDirty = true;
        return false;
    } finally {
        if(!keepalive){
            smartViewportSelectionViewStateSaving = false;
            if(smartViewportSelectionViewStateDirty){
                smartViewportSelectionScheduleViewStateSave(
                    SMART_VIEWPORT_RETRY_DELAY_MS
                );
            }
        }
    }
}
async function smartViewportSelectionRestoreViewState(){
    smartViewportSelectionViewStateReady = false;
    clearTimeout(smartViewportSelectionViewStateTimer);
    smartViewportSelectionViewStateTimer = null;
    const url = smartViewportSelectionViewStateUrl();
    let restored = false;
    if(url){
        try {
            const response = await fetch(url,{cache:'no-store'});
            if(response.ok){
                const data = await response.json();
                const saved = data?.view_state;
                const centerX = Number(saved?.center_x);
                const centerY = Number(saved?.center_y);
                const savedScale = Number(saved?.scale);
                if(
                    Number.isFinite(centerX)
                    && Number.isFinite(centerY)
                    && Number.isFinite(savedScale)
                    && savedScale >= SMART_VIEWPORT_MIN_SCALE
                    && savedScale <= SMART_VIEWPORT_MAX_SCALE
                ){
                    viewport.scale = savedScale;
                    viewport.x = shell.clientWidth / 2 - centerX * savedScale;
                    viewport.y = shell.clientHeight / 2 - centerY * savedScale;
                    smartViewportSelectionLastSavedViewState = JSON.stringify({
                        center_x:centerX,
                        center_y:centerY,
                        scale:savedScale
                    });
                    restored = true;
                }
            }
        } catch(error){}
    }
    smartViewportSelectionViewStateReady = true;
    smartViewportSelectionApply({persist:false});
    return restored;
}

function smartViewportSelectionApply({persist=true}={}){
    const scale = Number(viewport.scale);
    viewport.scale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const lodState = window.SmartCanvasModules?.canvasLevelOfDetail?.update?.(viewport.scale)
        || {mode:'detail', changed:false};
    if(shell?.dataset) shell.dataset.canvasLod = lodState.mode;
    world.classList.toggle('canvas-lod-far', lodState.mode === 'far');
    world.classList.toggle('canvas-lod-detail', lodState.mode !== 'far');
    world.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
    world.style.setProperty('--smart-overlay-inverse-scale', String(Math.min(1, 1 / viewport.scale)));
    world.style.setProperty('--smart-selection-handle-inverse-scale', String(1 / viewport.scale));
    // Scaled backdrop filters are rasterized before transform in Blink and
    // become visibly soft. The class keeps cards crisp while zoomed.
    world.classList.toggle('canvas-scaled', Math.abs(viewport.scale - 1) > 0.001);
    shell.style.backgroundSize = '24px 24px';
    shell.style.backgroundPosition = '0 0';
    if(smartAnnotationStroke) renderSmartAnnotationPreview();
    smartViewportSelectionUpdateMinimapViewport();
    smartViewportSelectionScheduleMinimap();
    smartViewportSelectionRefreshMultiOverlay();
    positionCanvasFloatingOverlays();
    scheduleSmartAdaptiveImageResolution();
    window.SmartCanvasModules?.canvasVirtualization?.request?.();
    window.SmartCanvasModules?.realtimePresence?.reproject?.();
    if(lodState.changed && typeof render === 'function'){
        window.beginSmartCanvasDetailRecovery?.(lodState);
        queueMicrotask(() => {
            if(typeof canvas !== 'undefined' && canvas) render();
        });
    }
    if(persist) smartViewportSelectionScheduleViewStateSave();
}
function smartViewportSelectionScreenToWorld(event){
    const rect = shell.getBoundingClientRect();
    return {
        x:(event.clientX - rect.left - viewport.x) / viewport.scale,
        y:(event.clientY - rect.top - viewport.y) / viewport.scale
    };
}
function smartViewportSelectionCenter(){
    return {
        x:(shell.clientWidth / 2 - viewport.x) / viewport.scale,
        y:(shell.clientHeight / 2 - viewport.y) / viewport.scale
    };
}
function smartViewportSelectionState(){
    return {x:viewport.x,y:viewport.y,scale:viewport.scale};
}
function smartViewportSelectionReveal(bounds,{padding=24,smooth=true}={}){
    if(!bounds) return false;
    const scale = Math.max(SMART_VIEWPORT_MIN_SCALE,Number(viewport.scale) || 1);
    const viewWidth = shell.clientWidth / scale;
    const viewHeight = shell.clientHeight / scale;
    const currentLeft = -viewport.x / scale;
    const currentTop = -viewport.y / scale;
    const inset = Math.max(0,Number(padding) || 0);
    const nodeLeft = Number(bounds.x) || 0;
    const nodeTop = Number(bounds.y) || 0;
    const nodeRight = nodeLeft + Math.max(1,Number(bounds.width) || 1);
    const nodeBottom = nodeTop + Math.max(1,Number(bounds.height) || 1);
    let nextLeft = currentLeft;
    let nextTop = currentTop;
    if(nodeRight - nodeLeft + inset * 2 > viewWidth){
        nextLeft = nodeLeft + (nodeRight - nodeLeft - viewWidth) / 2;
    } else if(nodeLeft - inset < currentLeft){
        nextLeft = nodeLeft - inset;
    } else if(nodeRight + inset > currentLeft + viewWidth){
        nextLeft = nodeRight + inset - viewWidth;
    }
    if(nodeBottom - nodeTop + inset * 2 > viewHeight){
        nextTop = nodeTop + (nodeBottom - nodeTop - viewHeight) / 2;
    } else if(nodeTop - inset < currentTop){
        nextTop = nodeTop - inset;
    } else if(nodeBottom + inset > currentTop + viewHeight){
        nextTop = nodeBottom + inset - viewHeight;
    }
    if(nextLeft === currentLeft && nextTop === currentTop) return false;
    if(smooth && world?.style){
        world.style.transition = 'transform 180ms ease-out';
        setTimeout(() => {
            if(world.style.transition === 'transform 180ms ease-out'){
                world.style.transition = '';
            }
        },220);
    }
    viewport.x = -nextLeft * scale;
    viewport.y = -nextTop * scale;
    smartViewportSelectionApply();
    return true;
}
function smartViewportSelectionMinimapViewport(){
    return {
        x:-viewport.x / viewport.scale,
        y:-viewport.y / viewport.scale,
        width:shell.clientWidth / viewport.scale,
        height:shell.clientHeight / viewport.scale
    };
}
function smartViewportSelectionMinimapKind(node){
    const role = window.SmartCanvasModules?.nodeKinds?.roleOf?.(node) || '';
    if(role === 'frame') return 'frame';
    if(role === 'smart-group') return 'group';
    if(['prompt','prompt-generation','text-annotation','brush-stroke'].includes(role)){
        return 'text';
    }
    return 'media';
}
function smartViewportSelectionMinimapFrameColors(){
    const smartContainer = window.SmartCanvasModules?.smartContainer;
    const frames = nodes
        .filter(node => smartViewportSelectionMinimapKind(node) === 'frame')
        .sort((left,right) => {
            const leftRect = nodeRect(left);
            const rightRect = nodeRect(right);
            return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
        });
    const colors = new Map();
    frames.forEach(frame => {
        const color = frame.frameColor || 'slate';
        const memberIds = smartContainer?.descendantIds?.(frame)
            || (Array.isArray(frame.items) ? frame.items : []);
        memberIds.forEach(id => colors.set(id,color));
    });
    return colors;
}
function smartViewportSelectionSyncMinimapScene(){
    smartViewportSelectionRefreshMultiOverlay();
    if(typeof positionCanvasFloatingOverlays === 'function'){
        positionCanvasFloatingOverlays();
    }
    if(typeof minimap === 'undefined' || !minimap) return;
    const frameColors = smartViewportSelectionMinimapFrameColors();
    const items = nodes
        .filter(node => node.id !== SMART_LOG_PREVIEW_NODE_ID)
        .map(node => ({
            id:node.id,
            kind:smartViewportSelectionMinimapKind(node),
            frameColor:smartViewportSelectionMinimapKind(node) === 'frame'
                ? node.frameColor || 'slate'
                : frameColors.get(node.id) || '',
            ...nodeRect(node)
        }));
    minimap.scene = {
        items,
        viewport:smartViewportSelectionMinimapViewport(),
        padding:200
    };
    smartViewportSelectionMinimapRenderedAt = smartViewportSelectionNow();
}
function smartViewportSelectionUpdateMinimapViewport(){
    if(typeof minimap === 'undefined') return;
    minimap?.updateViewport?.(smartViewportSelectionMinimapViewport());
}
function smartViewportSelectionScheduleMinimap(){
    if(smartViewportSelectionMinimapTimer) return;
    if(typeof setTimeout !== 'function'){
        smartViewportSelectionSyncMinimapScene();
        return;
    }
    const elapsed = smartViewportSelectionNow() - smartViewportSelectionMinimapRenderedAt;
    const delay = Math.max(0, 120 - elapsed);
    smartViewportSelectionMinimapTimer = setTimeout(() => {
        smartViewportSelectionMinimapTimer = 0;
        smartViewportSelectionSyncMinimapScene();
    }, delay);
}
function smartViewportSelectionRefresh(){
    smartViewportSelectionScheduleMinimap();
    const focusedId = document.activeElement?.closest?.('.image-node')?.dataset?.id;
    const interactionIds = window.SmartCanvasModules?.canvasInteraction?.active?.()?.nodeIds || [];
    window.SmartCanvasModules?.canvasVirtualization?.request?.({
        nodeIds:[focusedId,...interactionIds].filter(Boolean)
    });
}
function smartViewportSelectionCenterOn(point){
    viewport.x = shell.clientWidth / 2 - point.x * viewport.scale;
    viewport.y = shell.clientHeight / 2 - point.y * viewport.scale;
    smartViewportSelectionApply();
}
function smartViewportSelectionFitAll(){
    if(!nodes.length){
        viewport.scale = 0.45;
        viewport.x = shell.clientWidth / 2;
        viewport.y = shell.clientHeight / 2;
        smartViewportSelectionApply();
        return;
    }
    const rects = nodes.map(nodeRect);
    const minX = Math.min(...rects.map(rect => rect.x));
    const minY = Math.min(...rects.map(rect => rect.y));
    const maxX = Math.max(...rects.map(rect => rect.x + rect.width));
    const maxY = Math.max(...rects.map(rect => rect.y + rect.height));
    const pad = 160;
    const width = Math.max(1, maxX - minX + pad * 2);
    const height = Math.max(1, maxY - minY + pad * 2);
    viewport.scale = Math.max(
        0.06,
        Math.min(
            0.82,
            (shell.clientWidth - 80) / width,
            (shell.clientHeight - 80) / height
        )
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    viewport.x = shell.clientWidth / 2 - centerX * viewport.scale;
    viewport.y = shell.clientHeight / 2 - centerY * viewport.scale;
    smartViewportSelectionApply();
}
function smartViewportSelectionExitZoomPreview(point=null){
    if(!zoomPreviewState) return false;
    const previous = zoomPreviewState;
    zoomPreviewState = null;
    shell.classList.remove('zoom-preview');
    viewport.scale = previous.scale;
    if(point){
        viewport.x = shell.clientWidth / 2 - point.x * viewport.scale;
        viewport.y = shell.clientHeight / 2 - point.y * viewport.scale;
    } else {
        viewport.x = previous.x;
        viewport.y = previous.y;
    }
    smartViewportSelectionApply();
    return true;
}
function smartViewportSelectionExitZoomPreviewToNode(nodeId){
    if(!zoomPreviewState) return false;
    const node = nodes.find(item => item.id === nodeId);
    if(!node) return smartViewportSelectionExitZoomPreview();
    const previous = zoomPreviewState;
    const rect = nodeRect(node);
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const fitWidth = Math.max(1, shell.clientWidth - 160);
    const fitHeight = Math.max(1, shell.clientHeight - 160);
    const fitScale = Math.min(
        ZOOM_PREVIEW_NODE_MAX_SCALE,
        fitWidth / Math.max(1, rect.width),
        fitHeight / Math.max(1, rect.height)
    );
    const readableScale = Math.min(
        ZOOM_PREVIEW_NODE_MAX_SCALE,
        Math.max(ZOOM_PREVIEW_NODE_DEFAULT_SCALE, fitScale)
    );
    zoomPreviewState = null;
    shell.classList.remove('zoom-preview');
    viewport.scale = Math.max(
        Number.isFinite(Number(previous.scale)) && Number(previous.scale) > 0
            ? Number(previous.scale)
            : 1,
        readableScale
    );
    viewport.x = shell.clientWidth / 2 - centerX * viewport.scale;
    viewport.y = shell.clientHeight / 2 - centerY * viewport.scale;
    smartViewportSelectionApply();
    return true;
}
function smartViewportSelectionZoomPreview({
    action='toggle',
    point=null,
    nodeId=''
}={}){
    if(action === 'enter'){
        if(zoomPreviewState) return false;
        zoomPreviewState = {...viewport};
        shell.classList.add('zoom-preview');
        closeCreateMenu();
        smartViewportSelectionFitAll();
        return true;
    }
    if(action === 'exit-to-node'){
        return smartViewportSelectionExitZoomPreviewToNode(nodeId);
    }
    if(action === 'exit'){
        return smartViewportSelectionExitZoomPreview(point);
    }
    return zoomPreviewState
        ? smartViewportSelectionExitZoomPreview()
        : smartViewportSelectionZoomPreview({action:'enter'});
}

function smartViewportSelectionUpdateBox(event){
    if(!selectionState) return;
    const startX = selectionState.startScreen.x;
    const startY = selectionState.startScreen.y;
    const x = Math.min(startX, event.clientX);
    const y = Math.min(startY, event.clientY);
    selectionBox.style.display = 'block';
    selectionBox.style.left = `${x}px`;
    selectionBox.style.top = `${y}px`;
    selectionBox.style.width = `${Math.abs(event.clientX - startX)}px`;
    selectionBox.style.height = `${Math.abs(event.clientY - startY)}px`;
}
function smartViewportSelectionFinishBox(event){
    if(!selectionState) return;
    const start = selectionState.startWorld;
    const end = smartViewportSelectionScreenToWorld(event);
    const minX = Math.min(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxX = Math.max(start.x, end.x);
    const maxY = Math.max(start.y, end.y);
    selectedIds = nodes.filter(node => {
        const rect = nodeRect(node);
        const containerModule = window.SmartCanvasModules?.smartContainer;
        if(containerModule?.isFrame(node)){
            return rect.x >= minX
                && rect.y >= minY
                && rect.x + rect.width <= maxX
                && rect.y + rect.height <= maxY;
        }
        return rect.x < maxX
            && rect.x + rect.width > minX
            && rect.y < maxY
            && rect.y + rect.height > minY;
    }).map(node => node.id);
    selectedId = selectedIds.length === 1 ? selectedIds[0] : '';
    selectedImage = {nodeId:'', index:-1};
    selectionState = null;
    selectionJustFinished = true;
    selectionBox.style.display = 'none';
    render();
    setTimeout(() => { selectionJustFinished = false; }, 0);
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.viewportSelection = Object.freeze({
    selection:Object.freeze({
        node:smartViewportSelectionNode,
        ids:smartViewportSelectionIds,
        has:smartViewportSelectionHas,
        bounds:smartViewportSelectionBounds,
        clear:smartViewportSelectionClear,
        refresh:smartViewportSelectionSync,
        box:Object.freeze({
            update:smartViewportSelectionUpdateBox,
            finish:smartViewportSelectionFinishBox
        })
    }),
    viewport:Object.freeze({
        apply:smartViewportSelectionApply,
        restore:smartViewportSelectionRestoreViewState,
        save:smartViewportSelectionSaveViewState,
        screenToWorld:smartViewportSelectionScreenToWorld,
        state:smartViewportSelectionState,
        center:smartViewportSelectionCenter,
        reveal:smartViewportSelectionReveal,
        centerOn:smartViewportSelectionCenterOn,
        fitAll:smartViewportSelectionFitAll,
        refresh:smartViewportSelectionRefresh,
        zoomPreview:smartViewportSelectionZoomPreview
    })
});

window.addEventListener?.('pagehide',() => {
    if(smartViewportSelectionViewStateDirty){
        smartViewportSelectionSaveViewState({keepalive:true});
    }
});
if(typeof document !== 'undefined'){
    document.addEventListener?.('visibilitychange',() => {
        if(document.visibilityState === 'hidden' && smartViewportSelectionViewStateDirty){
            smartViewportSelectionSaveViewState({keepalive:true});
        }
    });
}
