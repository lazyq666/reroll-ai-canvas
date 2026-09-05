/*
 * Smart Canvas Image Studio Module
 *
 * Owns editor session state and the preview/crop/draw/resize/grid/
 * panorama Implementation. New consumers should use SmartCanvasModules.imageStudio.
 * Legacy global functions remain temporarily available for inline HTML handlers.
 */
const imageStudioPersistenceModule = window.SmartCanvasModules?.canvasPersistence;
if(!imageStudioPersistenceModule) throw new Error('Canvas Persistence Module failed to load');
const imageStudioMutationModule = window.SmartCanvasModules?.canvasMutation;
if(!imageStudioMutationModule) throw new Error('Canvas Mutation Module failed to load');
const imageStudioContainerModule = window.SmartCanvasModules?.smartContainer;
if(!imageStudioContainerModule) throw new Error('Smart Container Module failed to load');
const imageStudioLayeredPsdModule = window.SmartCanvasModules?.layeredPsd;
if(!imageStudioLayeredPsdModule) throw new Error('Layered PSD Module failed to load');
const imageEditModal = document.getElementById('imageEditModal');
let imageStudioReopenAfterHide = false;
let imageStudioSourceState = 'idle';
const imageStudioGeometry = window.SmartCanvasModules?.imageStudioGeometry;
if(!imageStudioGeometry) throw new Error('Image Studio geometry Module failed to load');
function imageStudioDialogOpen(){
    return Boolean(
        imageEditModal?.classList.contains('open')
        && (imageEditModal.open || imageEditModal.hasAttribute('open'))
    );
}
function imageStudioDialogPresented(){
    return Boolean(imageEditModal?.open || imageEditModal?.hasAttribute('open'));
}
function setImageStudioControlValue(controlOrId, value){
    const control = typeof controlOrId === 'string' ? document.getElementById(controlOrId) : controlOrId;
    if(!control) return;
    const normalized = String(value ?? '');
    control.value = normalized;
    control.setAttribute('value', normalized);
}
function setImageStudioToggleState(controlOrId, pressed){
    const control = typeof controlOrId === 'string' ? document.getElementById(controlOrId) : controlOrId;
    if(!control) return;
    control.pressed = Boolean(pressed);
    control.toggleAttribute('pressed', Boolean(pressed));
}
function syncPreviewVideoLoopControl(enabled=false){
    const button = document.getElementById('previewVideoLoopBtn');
    if(!button) return;
    const active = Boolean(enabled);
    setImageStudioToggleState(button, active);
    button.setAttribute('hierarchy', 'secondary');
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    const syncSelectedSurface = () => {
        const base = button.shadowRoot?.querySelector('[part~="base"]');
        if(!base) return;
        const selected = Boolean(button.pressed && button.hasAttribute('pressed'));
        base.style.backgroundColor = selected ? '#141414' : '';
        base.style.color = selected ? '#ffffff' : '';
        base.style.borderColor = selected ? 'transparent' : '';
    };
    syncSelectedSurface();
    button.updateComplete?.then(syncSelectedSurface);
    const icon = button.querySelector('ic-icon');
    if(icon) icon.setAttribute('name', active ? 'check' : 'loop');
    const label = button.querySelector('[data-video-loop-label]');
    if(label){
        const key = active ? 'smart.action.autoLoopOn' : 'smart.action.autoLoop';
        label.setAttribute('data-i18n', key);
        label.textContent = tr(active ? 'smart.action.autoLoopOn' : 'smart.action.autoLoop');
    }
}
function setImageStudioApplyButton(label, icon='edit'){
    const button = document.getElementById('imageEditApplyBtn');
    if(!button) return;
    button.replaceChildren();
    const copy = document.createElement('span');
    copy.textContent = label;
    if(icon){
        const iconElement = document.createElement('ic-icon');
        iconElement.setAttribute('name', icon);
        iconElement.setAttribute('size', 'small');
        iconElement.setAttribute('slot', 'start');
        iconElement.setAttribute('aria-hidden', 'true');
        button.append(iconElement);
    }
    button.append(copy);
}
function syncImageStudioSourceState(){
    const notice = document.getElementById('imageStudioResolutionNotice');
    const applyButton = document.getElementById('imageEditApplyBtn');
    const ready = imageStudioSourceState === 'original-ready';
    const failed = imageStudioSourceState === 'failed';
    if(notice){
        notice.hidden = imageStudioSourceState === 'idle' || ready;
        notice.classList.toggle('is-failed', failed);
        notice.textContent = failed ? tr('smart.originalLoadFailed') : tr('smart.originalLoading');
    }
    if(applyButton) applyButton.disabled = imageEditMode !== 'preview' && !ready;
}
function setImageStudioSourceState(state){
    imageStudioSourceState = ['idle','loading','original-ready','failed'].includes(state)
        ? state
        : 'idle';
    syncImageStudioSourceState();
}
let cropState = null;
let cropDrag = null;
let cropAspectPreset = 'free';
let cropAspectRatio = null;
let imageEditMode = 'crop';
let imageEditModeTouched = false;
let layerDecompositionEditNodeId = '';
let imageResizeScale = 0.5;
let editDrawState = null;
let editTextItems = [];
let editTextSelectedId = '';
let editTextDrag = null;
let editTextDirty = false;
let editTextInlineEditor = null;
let editDrawUndoStack = [];
let editDrawRedoStack = [];
const EDIT_DRAW_HISTORY_MAX = 40;
const EDIT_DRAW_HISTORY_BYTE_BUDGET = 64 * 1024 * 1024;
let brushTool = 'free';
let brushLabelCounter = 1;
let gridCustomMode = false;
let gridCustomLines = [];
let gridCustomOrientation = 'h';
let gridCustomHistory = [];
let gridCustomDrag = null;
let gridOperationMode = 'split';
let gridJoinLayout = null;
let gridJoinDrag = null;
let gridJoinImageCache = new Map();
let gridJoinUserMoved = false;
let gridJoinOutputSize = 2048;
// 非空时表示当前宫格拼接的数据源是整个分组（聚合组内所有图片成员），而不是单个节点。
let gridJoinGroupId = '';
let imageEditZoom = 1.0;
let imageEditBaseW = 0;
let imageEditBaseH = 0;
let previewZoom = 1.0;
let previewPan = {x:0, y:0};
let previewPanDrag = null;
let previewCompareDrag = false;
let previewComparePos = 50;
let imageEditPanDrag = null;
let previewNavState = {nodeId:'', index:0, count:0};
let imageStudioSharedTransition = null;
let imageStudioTransitionRequest = 0;
const PANORAMA_RATIO_PRESETS = {
    square:{w:1, h:1},
    portrait:{w:2, h:3},
    landscape:{w:3, h:2},
    portrait43:{w:3, h:4},
    landscape43:{w:4, h:3},
    story:{w:9, h:16},
    wide:{w:16, h:9},
    ultrawide:{w:21, h:9},
    ultratall:{w:9, h:21}
};
let panoramaState = {
    enabled:false,
    ratio:'wide',
    customW:16,
    customH:9,
    fov:75,
    yaw:0,
    pitch:0,
    drag:null,
    three:null,
    renderer:null,
    scene:null,
    camera:null,
    sphere:null,
    texture:null,
    threeLoadPromise:null,
    image:null,
    ctx:null,
    animationId:0,
    loadedSrc:'',
    loadToken:0
};
window.__smartCanvasPanoramaState = panoramaState;
function imageStudioMotionReduced(){
    return document.documentElement.dataset.uiMotion === 'reduced'
        || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
function imageStudioVisibleMedia(mode=imageEditMode){
    if(mode === 'preview'){
        const video = document.getElementById('previewCurrentVideo');
        if(video && getComputedStyle(video).display !== 'none') return video;
        return document.getElementById('previewCurrentImage');
    }
    return document.getElementById('cropImage');
}
function captureImageStudioTransition(mode=imageEditMode){
    if(imageStudioMotionReduced() || !imageStudioDialogOpen()) return null;
    const media = imageStudioVisibleMedia(mode);
    if(!media || media.tagName !== 'IMG' || getComputedStyle(media).display === 'none') return null;
    const activeClone = imageStudioSharedTransition?.clone;
    const rect = activeClone?.isConnected ? activeClone.getBoundingClientRect() : media.getBoundingClientRect();
    const src = activeClone?.currentSrc || activeClone?.getAttribute('src') || media.currentSrc || media.getAttribute('src') || '';
    if(!src || rect.width < 2 || rect.height < 2) return null;
    return {src, media, rect:{left:rect.left, top:rect.top, width:rect.width, height:rect.height}};
}
function prepareImageStudioTransition(snapshot, targetMode){
    const request = ++imageStudioTransitionRequest;
    imageStudioSharedTransition?.animation?.cancel();
    imageStudioSharedTransition?.cleanup?.();
    if(!snapshot || imageStudioMotionReduced()) return null;
    const source = snapshot.media;
    const target = imageStudioVisibleMedia(targetMode);
    if(!source || !target || target.tagName !== 'IMG') return null;
    const clone = document.createElement('img');
    clone.className = 'image-studio-shared-image';
    clone.alt = '';
    clone.src = snapshot.src;
    Object.assign(clone.style, {
        position:'fixed', zIndex:'3', left:`${snapshot.rect.left}px`, top:`${snapshot.rect.top}px`,
        width:`${snapshot.rect.width}px`, height:`${snapshot.rect.height}px`, objectFit:'fill', display:'block',
        maxWidth:'none', maxHeight:'none', borderRadius:'0', pointerEvents:'none',
        transformOrigin:'top left', willChange:'transform'
    });
    const sourceVisibility = source.style.visibility;
    const targetVisibility = target.style.visibility;
    source.style.visibility = 'hidden';
    target.style.visibility = 'hidden';
    const transitionHost = document.getElementById('imageEditStage')
        || imageEditModal?.shadowRoot?.querySelector('dialog')
        || imageEditModal?.shadowRoot
        || imageEditModal
        || document.body;
    transitionHost.appendChild(clone);
    imageEditModal?.classList.add('image-studio-transitioning');
    let cleaned = false;
    const transition = {request, snapshot, source, target, clone, animation:null, cleanup:null};
    const cleanup = () => {
        if(cleaned) return;
        cleaned = true;
        source.style.visibility = sourceVisibility;
        if(target !== source) target.style.visibility = targetVisibility;
        clone.remove();
        imageEditModal?.classList.remove('image-studio-transitioning');
        if(imageStudioSharedTransition?.cleanup === cleanup) imageStudioSharedTransition = null;
    };
    transition.cleanup = cleanup;
    imageStudioSharedTransition = transition;
    return transition;
}
function animateImageStudioTransition(transition){
    if(!transition) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const {request, snapshot, target, clone, cleanup} = transition;
        if(request !== imageStudioTransitionRequest || imageStudioSharedTransition !== transition) return cleanup();
        if(!target?.isConnected || getComputedStyle(target).display === 'none') return cleanup();
        const targetRect = target.getBoundingClientRect();
        if(targetRect.width < 2 || targetRect.height < 2) return cleanup();
        const scaleX = snapshot.rect.width / targetRect.width;
        const scaleY = snapshot.rect.height / targetRect.height;
        const translateX = snapshot.rect.left - targetRect.left;
        const translateY = snapshot.rect.top - targetRect.top;
        Object.assign(clone.style, {
            left:`${targetRect.left}px`, top:`${targetRect.top}px`,
            width:`${targetRect.width}px`, height:`${targetRect.height}px`,
            transform:`translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`
        });
        const animation = clone.animate([
            {transform:`translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`},
            {transform:'translate(0, 0) scale(1, 1)'}
        ], {duration:480, easing:'cubic-bezier(.22,1,.36,1)', fill:'both'});
        transition.animation = animation;
        animation.finished.then(cleanup, cleanup);
    }));
}
function currentEditImage(){
    const node = nodes.find(n => n.id === cropState?.nodeId);
    const index = Number(cropState?.imageIndex || 0);
    return {node, index, image:imageForDisplay(node?.images?.[index])};
}
function discardImageEditDraft(){
    removeEditTextInlineEditor(true);
    clearEditDrawing(true);
    resetEditDrawingHistory();
    cropDrag = null;
    editDrawState = null;
    editTextItems = [];
    editTextSelectedId = '';
    editTextDrag = null;
    editTextDirty = false;
    imageResizeScale = 0.5;
    gridCustomMode = false;
    gridCustomLines = [];
    gridCustomHistory = [];
    gridCustomDrag = null;
    gridOperationMode = 'split';
    gridJoinLayout = null;
    gridJoinDrag = null;
    gridJoinImageCache = new Map();
    gridJoinUserMoved = false;
    setImageStudioToggleState('gridCustomToggle', false);
}
function cropImageDisplaySize(){
    const img = document.getElementById('cropImage');
    const clientW = Number(img?.clientWidth || 0);
    const clientH = Number(img?.clientHeight || 0);
    if(clientW > 2 && clientH > 2) return {w:clientW, h:clientH};
    ensureImageEditBaseSize();
    const fallbackW = Math.round((imageEditBaseW || Number(img?.naturalWidth || 0) || 1) * imageEditZoom);
    const fallbackH = Math.round((imageEditBaseH || Number(img?.naturalHeight || 0) || 1) * imageEditZoom);
    return {w:Math.max(1, fallbackW), h:Math.max(1, fallbackH)};
}
function cropBounds(){
    return cropImageDisplaySize();
}
function editDrawCanvas(){ return document.getElementById('editDrawCanvas'); }
function editTextCanvas(){ return document.getElementById('editTextCanvas'); }
function editTextContext(){ return editTextCanvas()?.getContext('2d') || null; }
function selectedEditTextItem(){ return editTextItems.find(item => item.id === editTextSelectedId) || null; }
function defaultEditTextText(){ return tr('smart.editTextDefault'); }
function editTextSizeFromBrush(){ return Math.max(14, Math.min(120, Math.round(editBrushSize() * 2))); }
function createEditTextItem(text, point, preset={}){
    const size = Math.max(10, Math.min(120, Number(preset.size) || editTextSizeFromBrush()));
    return {id:uid('txt'), text:String(text || defaultEditTextText()).trim(), x:Number(point?.x || 0), y:Number(point?.y || 0), color:preset.color || brushColor(), size};
}
function textItemFont(item){
    const size = Math.max(10, Math.min(120, Number(item?.size) || 28));
    return `900 ${size}px Arial, sans-serif`;
}
function measureEditTextItem(item, ctx=editTextContext()){
    if(!item || !ctx) return {x:0, y:0, w:0, h:0};
    const size = Math.max(10, Math.min(120, Number(item.size) || 28));
    ctx.save();
    ctx.font = textItemFont(item);
    const metrics = ctx.measureText(String(item.text || ''));
    ctx.restore();
    const width = Math.max(1, metrics.width || 1);
    const ascent = Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : size * 0.8;
    const descent = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : size * 0.25;
    const pad = Math.max(4, Math.round(size * 0.18));
    return {x:item.x - width / 2 - pad, y:item.y - (ascent + descent) / 2 - pad, w:width + pad * 2, h:ascent + descent + pad * 2, textW:width, textH:ascent + descent, pad};
}
function hitEditTextItem(point){
    const ctx = editTextContext();
    if(!ctx) return null;
    for(let i = editTextItems.length - 1; i >= 0; i--){
        const item = editTextItems[i];
        const box = measureEditTextItem(item, ctx);
        if(point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) return item;
    }
    return null;
}
function renderEditTextCanvas(){
    const canvasEl = editTextCanvas();
    const ctx = editTextContext();
    if(!canvasEl || !ctx) return;
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    editTextItems.forEach(item => {
        if(!item?.text) return;
        const selected = item.id === editTextSelectedId;
        const box = measureEditTextItem(item, ctx);
        ctx.save();
        ctx.font = textItemFont(item);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = item.color || brushColor();
        ctx.strokeStyle = 'rgba(255,255,255,.92)';
        ctx.lineWidth = Math.max(2, (Number(item.size) || 28) / 8);
        ctx.strokeText(String(item.text || ''), item.x, item.y);
        ctx.fillText(String(item.text || ''), item.x, item.y);
        if(selected){
            ctx.setLineDash([7, 5]);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(15,23,42,.72)';
            ctx.strokeRect(box.x, box.y, box.w, box.h);
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(15,23,42,.92)';
            ctx.beginPath();
            ctx.arc(item.x + box.w / 2 - box.pad, item.y - box.h / 2 + box.pad, 3.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    });
    positionEditTextInlineEditor();
}
function syncTextToolState(force=false){
    const cropCanvasEl = document.getElementById('cropCanvas');
    cropCanvasEl?.classList.toggle('text-mode', imageEditMode === 'brush' && brushTool === 'text');
}
function syncSelectedEditTextStyleFromBrush(){
    if(imageEditMode !== 'brush' || brushTool !== 'text' || editTextInlineEditor) return;
    const item = selectedEditTextItem();
    if(!item) return;
    const nextSize = editTextSizeFromBrush();
    const nextColor = brushColor();
    if(item.size === nextSize && item.color === nextColor) return;
    beginTextEditChange();
    item.size = nextSize;
    item.color = nextColor;
    renderEditTextCanvas();
    syncTextToolState(true);
}
function beginTextEditChange(){
    if(editTextDirty) return;
    pushEditDrawHistory();
    editTextDirty = true;
}
function setSelectedEditTextItem(id){
    editTextSelectedId = id || '';
    renderEditTextCanvas();
    syncTextToolState(true);
}
function confirmSelectedEditTextItem(){
    const selected = selectedEditTextItem();
    if(!selected) return false;
    if(!String(selected.text || '').trim()) editTextItems = editTextItems.filter(item => item.id !== selected.id);
    editTextSelectedId = '';
    editTextDrag = null;
    editTextDirty = false;
    renderEditTextCanvas();
    syncTextToolState(true);
    return true;
}
function editTextCanvasScale(){
    const canvasEl = editTextCanvas();
    const rect = canvasEl?.getBoundingClientRect?.();
    return {x:(rect?.width || canvasEl?.width || 1) / Math.max(1, canvasEl?.width || 1), y:(rect?.height || canvasEl?.height || 1) / Math.max(1, canvasEl?.height || 1), rect};
}
function selectInlineEditorText(el){
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}
function inlineEditorText(){
    return String(editTextInlineEditor?.el?.innerText || editTextInlineEditor?.el?.textContent || '').replace(/\u00a0/g, ' ');
}
function autosizeEditTextInlineEditor(){
    const editor = editTextInlineEditor;
    if(!editor?.el) return;
    const el = editor.el;
    el.style.width = 'auto';
    el.style.height = 'auto';
    el.style.width = `${Math.max(Number(editor.minW || 48), el.scrollWidth + 10)}px`;
    el.style.height = `${Math.max(Number(editor.minH || 28), el.scrollHeight + 4)}px`;
}
function positionEditTextInlineEditor(){
    const editor = editTextInlineEditor;
    if(!editor?.el) return;
    const item = editTextItems.find(x => x.id === editor.itemId);
    const canvasEl = editTextCanvas();
    const cropCanvasEl = document.getElementById('cropCanvas');
    if(!item || !canvasEl || !cropCanvasEl) return;
    const box = measureEditTextItem(item, editTextContext());
    const scale = editTextCanvasScale();
    const hostRect = cropCanvasEl.getBoundingClientRect();
    const canvasRect = scale.rect || canvasEl.getBoundingClientRect();
    const left = canvasRect.left - hostRect.left + box.x * scale.x;
    const top = canvasRect.top - hostRect.top + box.y * scale.y;
    const w = Math.max(48, box.w * scale.x);
    const h = Math.max(28, box.h * scale.y);
    editor.minW = w;
    editor.minH = h;
    editor.el.style.left = `${left}px`;
    editor.el.style.top = `${top}px`;
    editor.el.style.minWidth = `${w}px`;
    editor.el.style.minHeight = `${h}px`;
    editor.el.style.font = `900 ${Math.max(10, (Number(item.size) || 28) * scale.y)}px Arial, sans-serif`;
    editor.el.style.color = item.color || brushColor();
    autosizeEditTextInlineEditor();
}
function removeEditTextInlineEditor(commit=true){
    const editor = editTextInlineEditor;
    if(!editor) return;
    const item = editTextItems.find(x => x.id === editor.itemId);
    const next = inlineEditorText().trim();
    editTextInlineEditor = null;
    editor.el.remove();
    if(!item) return;
    if(commit){
        if(next !== String(editor.before || '')){
            beginTextEditChange();
            if(next) item.text = next;
            else {
                editTextItems = editTextItems.filter(x => x.id !== item.id);
                editTextSelectedId = '';
            }
        }
    } else {
        item.text = editor.before || item.text || defaultEditTextText();
    }
    editTextDirty = false;
    renderEditTextCanvas();
    syncTextToolState(true);
}
function beginEditTextInline(item){
    if(!item) return;
    removeEditTextInlineEditor(true);
    editTextSelectedId = item.id;
    const host = document.getElementById('cropCanvas');
    if(!host) return;
    const el = document.createElement('div');
    el.className = 'edit-text-inline';
    el.contentEditable = 'true';
    el.spellcheck = false;
    el.textContent = item.text || defaultEditTextText();
    host.appendChild(el);
    editTextInlineEditor = {el, itemId:item.id, before:item.text || ''};
    positionEditTextInlineEditor();
    el.addEventListener('input', autosizeEditTextInlineEditor);
    el.addEventListener('keydown', event => {
        if(event.key === 'Enter' && !event.shiftKey){ event.preventDefault(); removeEditTextInlineEditor(true); }
        else if(event.key === 'Escape'){ event.preventDefault(); removeEditTextInlineEditor(false); }
    });
    el.addEventListener('blur', () => removeEditTextInlineEditor(true));
    requestAnimationFrame(() => { el.focus(); selectInlineEditorText(el); });
    renderEditTextCanvas();
    syncTextToolState(true);
}
function editTextPoint(event){ return editDrawPoint(event); }
function beginEditText(event){
    if(imageEditMode !== 'brush' || brushTool !== 'text') return;
    event.preventDefault(); event.stopPropagation();
    removeEditTextInlineEditor(true);
    const canvasEl = editTextCanvas();
    const point = editTextPoint(event);
    const hit = hitEditTextItem(point);
    if(hit){
        editTextSelectedId = hit.id;
        editTextDrag = {id:hit.id, pointerId:event.pointerId, startX:hit.x, startY:hit.y, sx:event.clientX, sy:event.clientY, moved:false, hasHistory:false};
        canvasEl.setPointerCapture?.(event.pointerId);
        canvasEl.style.cursor = 'grabbing';
        syncTextToolState(true);
        renderEditTextCanvas();
        return;
    }
    if(selectedEditTextItem()){
        confirmSelectedEditTextItem();
        return;
    }
    beginTextEditChange();
    const item = createEditTextItem(defaultEditTextText(), point, {color:brushColor(), size:editTextSizeFromBrush()});
    editTextItems.push(item);
    editTextSelectedId = item.id;
    canvasEl.style.cursor = 'text';
    renderEditTextCanvas();
    syncTextToolState(true);
}
function updateEditTextCursor(event){
    const canvasEl = editTextCanvas();
    if(!canvasEl || imageEditMode !== 'brush' || brushTool !== 'text') return;
    const hit = hitEditTextItem(editTextPoint(event));
    canvasEl.style.cursor = hit ? 'move' : 'text';
}
function moveEditText(event){
    if(!editTextDrag){
        updateEditTextCursor(event);
        return;
    }
    event.preventDefault(); event.stopPropagation();
    const item = editTextItems.find(x => x.id === editTextDrag.id);
    if(!item) return;
    const dx = event.clientX - editTextDrag.sx;
    const dy = event.clientY - editTextDrag.sy;
    if(!editTextDrag.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    editTextDrag.moved = true;
    if(!editTextDrag.hasHistory){
        beginTextEditChange();
        editTextDrag.hasHistory = true;
    }
    const canvasEl = editTextCanvas();
    const rect = canvasEl?.getBoundingClientRect?.();
    const scaleX = canvasEl ? canvasEl.width / Math.max(1, rect?.width || canvasEl.width) : 1;
    const scaleY = canvasEl ? canvasEl.height / Math.max(1, rect?.height || canvasEl.height) : 1;
    item.x = editTextDrag.startX + dx * scaleX;
    item.y = editTextDrag.startY + dy * scaleY;
    renderEditTextCanvas();
}
function endEditText(event){
    if(editTextDrag && event?.pointerId != null) editTextCanvas()?.releasePointerCapture?.(event.pointerId);
    editTextDrag = null;
    editTextDirty = false;
    renderEditTextCanvas();
    syncTextToolState(true);
    if(event) updateEditTextCursor(event);
}
function editTextHasContent(){ return editTextItems.some(item => String(item?.text || '').trim().length > 0); }
function resizeEditTextCanvas(){
    const img = document.getElementById('cropImage');
    const canvasEl = editTextCanvas();
    if(!img || !canvasEl) return;
    const display = cropImageDisplaySize();
    const w = Math.max(1, img.naturalWidth || img.clientWidth || 1);
    const h = Math.max(1, img.naturalHeight || img.clientHeight || 1);
    if(canvasEl.width !== w) canvasEl.width = w;
    if(canvasEl.height !== h) canvasEl.height = h;
    canvasEl.style.width = `${display.w}px`;
    canvasEl.style.height = `${display.h}px`;
    renderEditTextCanvas();
}
function resizeEditDrawCanvas(){
    const img = document.getElementById('cropImage');
    const canvasEl = editDrawCanvas();
    const display = cropImageDisplaySize();
    const w = Math.max(1, img.naturalWidth || img.clientWidth || 1);
    const h = Math.max(1, img.naturalHeight || img.clientHeight || 1);
    if(canvasEl.width !== w || canvasEl.height !== h){ canvasEl.width = w; canvasEl.height = h; }
    canvasEl.style.width = `${display.w}px`;
    canvasEl.style.height = `${display.h}px`;
    resizeEditTextCanvas();
    if(imageEditMode === 'grid') refreshGridSplitPreview();
}
function setImageEditMode(mode, userTouched=false){
    const editKind = mediaKindForItem(currentEditImage().image || {});
    const isVideoPreview = editKind === 'video';
    if(isVideoPreview && mode !== 'preview') mode = 'preview';
    const prev = imageEditMode;
    const nextMode = ['preview','crop','mask','brush','resize','grid'].includes(mode) ? mode : 'preview';
    const transitionSnapshot = prev !== nextMode ? captureImageStudioTransition(prev) : null;
    const sharedTransition = prepareImageStudioTransition(transitionSnapshot, nextMode);
    if(userTouched && prev !== 'preview' && nextMode !== prev) discardImageEditDraft();
    if(userTouched) imageEditModeTouched = true;
    if(mode !== 'brush') removeEditTextInlineEditor(true);
    imageEditMode = nextMode;
    const cropCanvasEl = document.getElementById('cropCanvas');
    const previewStageEl = document.getElementById('previewStage');
    const editStageEl = document.getElementById('imageEditStage');
    const editPanelEl = imageEditModal;
    const previewDownloadBtn = document.getElementById('previewDownloadBtn');
    const previewDownloadAllBtn = document.getElementById('previewDownloadAllBtn');
    const modeBar = document.getElementById('imageEditModeToolbar');
    const videoFrameTools = document.getElementById('videoFrameTools');
    const zoomLabel = document.getElementById('imageEditZoomLabel');
    const previewTools = document.getElementById('imagePreviewTools');
    const previewZoomControls = previewTools?.querySelector('.image-preview-zoom-controls');
    const previewActions = document.getElementById('imagePreviewActions');
    const commitActions = document.getElementById('imageEditCommitActions');
    const isPreview = imageEditMode === 'preview';
    if(!isPreview && panoramaState.enabled) disposePanoramaPreview();
    cropCanvasEl.style.display = isPreview ? 'none' : '';
    previewStageEl.style.display = isPreview ? 'inline-flex' : 'none';
    editStageEl?.classList.toggle('preview-mode', isPreview);
    editPanelEl?.classList.toggle('image-preview-mode', isPreview);
    editPanelEl?.classList.toggle('image-panorama-mode', isPreview && panoramaState.enabled);
    editPanelEl?.classList.toggle('video-preview-mode', isVideoPreview);
    if(previewDownloadBtn) previewDownloadBtn.style.display = isPreview ? 'inline-flex' : 'none';
    if(previewDownloadAllBtn) previewDownloadAllBtn.style.display = isPreview && !isVideoPreview && previewDownloadGroupItems().length > 1 ? 'inline-flex' : 'none';
    if(modeBar) modeBar.style.display = isVideoPreview ? 'none' : '';
    if(videoFrameTools) videoFrameTools.style.display = isVideoPreview && isPreview ? 'flex' : 'none';
    if(isVideoPreview) syncPreviewVideoLoopControl(Boolean(document.getElementById('previewCurrentVideo')?.loop));
    if(zoomLabel) zoomLabel.style.display = isVideoPreview ? 'none' : '';
    previewTools?.toggleAttribute('hidden', !isPreview || panoramaState.enabled);
    if(previewZoomControls) previewZoomControls.style.display = isVideoPreview ? 'none' : 'flex';
    previewActions?.toggleAttribute('hidden', !isPreview);
    commitActions?.toggleAttribute('hidden', isPreview);
    cropCanvasEl.classList.toggle('mask-mode', imageEditMode === 'mask');
    cropCanvasEl.classList.toggle('brush-mode', imageEditMode === 'brush');
    cropCanvasEl.classList.toggle('resize-mode', imageEditMode === 'resize');
    cropCanvasEl.classList.toggle('grid-mode', imageEditMode === 'grid');
    syncGridCustomCursor();
    setImageStudioControlValue('imageEditModeTabs', imageEditMode);
    document.getElementById('imageCropTools')?.toggleAttribute('hidden', imageEditMode !== 'crop');
    document.getElementById('imageMaskTools')?.toggleAttribute('hidden', imageEditMode !== 'mask');
    document.getElementById('imageBrushTools')?.toggleAttribute('hidden', imageEditMode !== 'brush');
    document.getElementById('imageResizeTools')?.toggleAttribute('hidden', imageEditMode !== 'resize');
    document.getElementById('imageGridTools')?.toggleAttribute('hidden', imageEditMode !== 'grid');
    document.getElementById('imagePanoramaTools')?.toggleAttribute('hidden', !isPreview || !panoramaState.enabled);
    if(imageEditMode === 'grid' && gridOperationMode === 'join' && !canGridJoinCurrentNode()) gridOperationMode = 'split';
    syncGridOperationControls();
    syncGridGapValue();
    syncImageResizeControls();
    const applyBtn = document.getElementById('imageEditApplyBtn');
    document.getElementById('compareToggleBtn').style.display = isPreview && !isVideoPreview && previewCompareSources().length ? 'inline-flex' : 'none';
    document.getElementById('panoramaToggleBtn').style.display = !isVideoPreview ? 'inline-flex' : 'none';
    document.getElementById('panoramaExportBtn').style.display = isPreview && !isVideoPreview && panoramaState.enabled ? 'inline-flex' : 'none';
    document.getElementById('panoramaResetBtn').style.display = isPreview && !isVideoPreview && panoramaState.enabled ? 'inline-flex' : 'none';
    document.getElementById('compareThumbs').style.display = 'none';
    if(isPreview){
        applyBtn.style.display = 'none';
        refreshComparePanel();
    } else {
        ensureImageEditBaseSize(true);
        applyImageEditZoom();
        applyBtn.style.display = '';
        setImageStudioApplyButton(tr('smart.confirmChanges'), '');
        if(imageEditMode === 'crop'){
            resetCropBox();
            requestAnimationFrame(() => {
                syncImageEditOverflow();
            });
        }
    }
    resizeEditDrawCanvas();
    if(imageEditMode === 'grid') refreshGridSplitPreview();
    else if(imageEditMode === 'crop' || imageEditMode === 'resize' || prev === 'grid') clearEditDrawing(true);
    syncEditDrawingHistoryButtons();
    syncBrushToolButtons();
    syncTextToolState(true);
    updatePreviewNavButtons();
    refreshIcons();
    syncImageStudioSourceState();
    animateImageStudioTransition(sharedTransition);
}
let previewCompareOn = false;
let previewCompareIndex = -1;
function clearPreviewCompareChoices(thumbsEl=document.getElementById('compareThumbs')){
    if(!thumbsEl) return;
    thumbsEl.querySelectorAll(':scope > [data-compare-idx]').forEach(choice => choice.remove());
    thumbsEl.setAttribute('value', 'none');
}
function applyPreviewTransform(){
    const frame = document.getElementById('previewFrame');
    if(frame){
        frame.style.transform = panoramaState.enabled ? '' : `translate(${previewPan.x}px, ${previewPan.y}px) scale(${previewZoom})`;
    }
    updateZoomLabel();
}
function resetPreviewTransform(){
    previewZoom = 1.0;
    previewPan = {x:0, y:0};
    previewComparePos = 50;
    document.getElementById('previewStage')?.style.setProperty('--compare-pos', `${previewComparePos}%`);
    applyPreviewTransform();
}
function panoramaRatioValue(){
    const preset = PANORAMA_RATIO_PRESETS[panoramaState.ratio];
    if(preset) return preset;
    return {
        w:Math.max(1, Number(panoramaState.customW) || 16),
        h:Math.max(1, Number(panoramaState.customH) || 9)
    };
}
function panoramaResolutionValue(){
    const longSide = 1536;
    const ratio = panoramaRatioValue();
    const aspect = ratio.w / Math.max(1, ratio.h);
    if(aspect >= 1){
        return {w:longSide, h:Math.max(1, Math.round(longSide / aspect))};
    }
    return {w:Math.max(1, Math.round(longSide * aspect)), h:longSide};
}
function panoramaSource(){
    const editing = currentEditImage();
    const image = editing.image || {};
    if(mediaKindForItem(image) !== 'image') return '';
    return displayMediaUrl(image.url ? image : (image.url || ''));
}
function panoramaFallbackSource(){
    const image = currentEditImage().image || {};
    return image?.url ? proxiedMediaUrl(image) : '';
}
function isLikelyPanoramaImage(node, image, naturalW=0, naturalH=0){
    if(mediaKindForItem(image || {}) !== 'image') return false;
    const text = [
        image?.name,
        image?.title,
        node?.title,
        node?.runPrompt,
        node?.runModelPrompt,
        node?.promptDraftText,
        node?.runSettings?.ratio,
        node?.runSettings?.msRatio,
        node?.runSettings?.size,
        node?.runSettings?.customSize
    ].filter(Boolean).join(' ');
    if(/(?:360|全景|环景|panorama|equirect|spherical|vr\b)/i.test(text)) return true;
    const w = Number(naturalW || image?.natural_w || image?.width || image?.w || 0);
    const h = Number(naturalH || image?.natural_h || image?.height || image?.h || 0);
    if(!(w > 0 && h > 0)) return false;
    const aspect = w / h;
    return aspect >= 1.9 && aspect <= 2.1;
}
async function ensurePanoramaRenderer(){
    const canvas = document.getElementById('panoramaCanvas');
    if(!canvas) return false;
    if(!panoramaState.three){
        panoramaState.threeLoadPromise = panoramaState.threeLoadPromise || import('/static/vendor/js/three-0.160.0.module.js?v=2026.05.30');
        panoramaState.three = await panoramaState.threeLoadPromise;
    }
    const THREE = panoramaState.three;
    if(!panoramaState.renderer){
        panoramaState.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias:true,
            alpha:false,
            preserveDrawingBuffer:true
        });
        panoramaState.renderer.setPixelRatio(1);
        panoramaState.renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    if(!panoramaState.scene){
        panoramaState.scene = new THREE.Scene();
        panoramaState.camera = new THREE.PerspectiveCamera(panoramaState.fov, 16 / 9, 1, 1200);
        const geometry = new THREE.SphereGeometry(500, 96, 64);
        geometry.scale(-1, 1, 1);
        const material = new THREE.MeshBasicMaterial({color:0xffffff});
        panoramaState.sphere = new THREE.Mesh(geometry, material);
        panoramaState.scene.add(panoramaState.sphere);
    }
    return Boolean(panoramaState.renderer && panoramaState.scene && panoramaState.camera && panoramaState.sphere);
}
function applyPanoramaTexture(img){
    const THREE = panoramaState.three;
    if(!THREE || !panoramaState.sphere || !img?.naturalWidth || !img?.naturalHeight) return false;
    if(panoramaState.texture){
        panoramaState.texture.dispose?.();
        panoramaState.texture = null;
    }
    const texture = new THREE.Texture(img);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    panoramaState.texture = texture;
    panoramaState.sphere.material.map = texture;
    panoramaState.sphere.material.needsUpdate = true;
    return true;
}
function drawPanoramaFrame(){
    const canvas = document.getElementById('panoramaCanvas');
    const img = panoramaState.image;
    const {renderer, scene, camera, sphere, three:THREE} = panoramaState;
    if(!panoramaState.enabled || !canvas || !renderer || !scene || !camera || !sphere || !THREE || !img?.naturalWidth || !img?.naturalHeight) return false;
    const width = Math.max(1, canvas.width);
    const height = Math.max(1, canvas.height);
    renderer.setSize(width, height, false);
    camera.fov = Math.max(35, Math.min(100, panoramaState.fov));
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    const pitch = Math.max(-85, Math.min(85, panoramaState.pitch));
    const phi = THREE.MathUtils.degToRad(90 - pitch);
    const theta = THREE.MathUtils.degToRad(panoramaState.yaw);
    const target = new THREE.Vector3(
        500 * Math.sin(phi) * Math.cos(theta),
        500 * Math.cos(phi),
        500 * Math.sin(phi) * Math.sin(theta)
    );
    camera.position.set(0, 0, 0);
    camera.lookAt(target);
    renderer.render(scene, camera);
    return true;
}
function renderPanoramaFrame(){
    if(!drawPanoramaFrame()) return;
    panoramaState.animationId = requestAnimationFrame(renderPanoramaFrame);
}
function startPanoramaLoop(){
    if(panoramaState.animationId) cancelAnimationFrame(panoramaState.animationId);
    panoramaState.animationId = requestAnimationFrame(renderPanoramaFrame);
}
function revealPanoramaFrame(){
    if(!panoramaState.enabled || !drawPanoramaFrame()) return false;
    const stage = document.getElementById('panoramaStage');
    const currentImg = document.getElementById('previewCurrentImage');
    stage?.classList.add('ready');
    if(stage) stage.style.display = 'block';
    if(currentImg) currentImg.style.display = 'none';
    return true;
}
function stopPanoramaLoop(){
    if(panoramaState.animationId) cancelAnimationFrame(panoramaState.animationId);
    panoramaState.animationId = 0;
}
function resizePanoramaViewer(){
    const stage = document.getElementById('panoramaStage');
    const frame = document.getElementById('previewFrame');
    const canvas = document.getElementById('panoramaCanvas');
    if(!stage) return;
    const ratio = panoramaRatioValue();
    const aspect = Math.max(0.08, Math.min(12, ratio.w / ratio.h));
    const maxW = Math.max(260, Math.min(1180, window.innerWidth - 116));
    const maxH = Math.max(220, Math.min(780, window.innerHeight - 220));
    let w = maxW;
    let h = w / aspect;
    if(h > maxH){
        h = maxH;
        w = h * aspect;
    }
    w = Math.max(160, Math.round(w));
    h = Math.max(160, Math.round(h));
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
    stage.style.aspectRatio = `${ratio.w} / ${ratio.h}`;
    if(frame){
        frame.style.width = `${w}px`;
        frame.style.height = `${h}px`;
    }
    if(canvas){
        const render = panoramaResolutionValue();
        const nextW = Math.max(1, Math.round(render.w));
        const nextH = Math.max(1, Math.round(render.h));
        if(canvas.width !== nextW) canvas.width = nextW;
        if(canvas.height !== nextH) canvas.height = nextH;
    }
}
function disposePanoramaTexture(){
    if(panoramaState.texture){
        panoramaState.texture.dispose?.();
        panoramaState.texture = null;
    }
    if(panoramaState.sphere?.material){
        panoramaState.sphere.material.map = null;
        panoramaState.sphere.material.needsUpdate = true;
    }
    panoramaState.image = null;
}
async function loadPanoramaTexture(src, allowFallback=true){
    if(!src) return;
    const token = ++panoramaState.loadToken;
    const stage = document.getElementById('panoramaStage');
    stage?.classList.remove('ready');
    let ready = false;
    try {
        ready = await ensurePanoramaRenderer();
    } catch(e) {
        console.warn('panorama renderer init failed', e);
        ready = false;
    }
    if(!ready){
        stage?.classList.add('ready');
        toast(tr('smart.panoramaLoadFailed'));
        return;
    }
    if(token !== panoramaState.loadToken) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const fallback = allowFallback ? panoramaFallbackSource() : '';
    const done = () => {
        if(token !== panoramaState.loadToken){
            return;
        }
        disposePanoramaTexture();
        if(!applyPanoramaTexture(img)){
            stage?.classList.add('ready');
            toast(tr('smart.panoramaLoadFailed'));
            return;
        }
        panoramaState.image = img;
        panoramaState.loadedSrc = src;
        resizePanoramaViewer();
        if(!revealPanoramaFrame()){
            stage?.classList.add('ready');
            toast(tr('smart.panoramaLoadFailed'));
            return;
        }
        startPanoramaLoop();
    };
    const fail = () => {
        if(token !== panoramaState.loadToken) return;
        if(fallback && fallback !== src){
            loadPanoramaTexture(fallback, false);
            return;
        }
        stage?.classList.add('ready');
        toast(tr('smart.panoramaLoadFailed'));
    };
    img.onload = done;
    img.onerror = fail;
    img.src = src;
    if(img.complete && img.naturalWidth) done();
}
function refreshPanoramaControls(){
    const controls = document.getElementById('panoramaControls');
    const tools = document.getElementById('imagePanoramaTools');
    const custom = document.getElementById('panoramaCustomRatio');
    const visible = panoramaState.enabled && imageEditMode === 'preview';
    if(controls) controls.style.display = visible ? 'inline-flex' : 'none';
    tools?.toggleAttribute('hidden', !visible);
    imageEditModal?.classList.toggle('image-panorama-mode', visible);
    const modeTabs = document.getElementById('imageEditModeTabs');
    const previewTab = modeTabs?.querySelector('[data-image-edit-mode="preview"]');
    if(visible){
        previewTab?.setAttribute('aria-selected', 'false');
    } else if(imageEditMode === 'preview' && previewTab?.getAttribute('aria-selected') !== 'true'){
        setImageStudioControlValue(modeTabs, 'preview');
    }
    document.getElementById('imagePreviewTools')?.toggleAttribute('hidden', visible || imageEditMode !== 'preview');
    if(custom) custom.style.display = visible && panoramaState.ratio === 'custom' ? 'inline-flex' : 'none';
    setImageStudioControlValue('panoramaRatioTabs', panoramaState.ratio);
    const w = document.getElementById('panoramaRatioW');
    const h = document.getElementById('panoramaRatioH');
    if(w && document.activeElement !== w) w.value = panoramaState.customW;
    if(h && document.activeElement !== h) h.value = panoramaState.customH;
}
function setPanoramaEnabled(enabled){
    const next = Boolean(enabled);
    if(panoramaState.enabled === next) return;
    panoramaState.enabled = next;
    const stage = document.getElementById('previewStage');
    const pano = document.getElementById('panoramaStage');
    const currentImg = document.getElementById('previewCurrentImage');
    const compareLayer = document.getElementById('previewCompareLayer');
    const compareHandle = document.getElementById('previewCompareHandle');
    const toggle = document.getElementById('panoramaToggleBtn');
    const exportBtn = document.getElementById('panoramaExportBtn');
    const resetBtn = document.getElementById('panoramaResetBtn');
    const compareToggle = document.getElementById('compareToggleBtn');
    const compareThumbs = document.getElementById('compareThumbs');
    stage?.classList.toggle('panorama-on', next);
    if(pano) pano.style.display = 'none';
    if(currentImg) currentImg.style.display = 'block';
    if(compareLayer && next) compareLayer.style.display = 'none';
    if(compareHandle && next) compareHandle.style.display = 'none';
    setImageStudioToggleState(toggle, next);
    if(exportBtn) exportBtn.style.display = next ? 'inline-flex' : 'none';
    if(resetBtn) resetBtn.style.display = next ? 'inline-flex' : 'none';
    if(compareToggle) compareToggle.style.display = next ? 'none' : 'inline-flex';
    if(compareThumbs && next){ compareThumbs.style.display = 'none'; clearPreviewCompareChoices(compareThumbs); }
    previewCompareOn = next ? false : previewCompareOn;
    if(next){
        previewPan = {x:0, y:0};
        previewZoom = 1.0;
        applyPreviewTransform();
        resizePanoramaViewer();
        loadPanoramaTexture(panoramaSource());
    } else {
        stopPanoramaLoop();
        const frame = document.getElementById('previewFrame');
        if(frame){ frame.style.width = ''; frame.style.height = ''; }
        refreshComparePanel();
    }
    refreshPanoramaControls();
    updateZoomLabel();
}
function togglePanoramaPreview(){
    const image = currentEditImage().image || {};
    if(mediaKindForItem(image) !== 'image') return;
    if(imageEditMode !== 'preview') setImageEditMode('preview', true);
    setPanoramaEnabled(!panoramaState.enabled);
}
async function exportPanoramaFrame(){
    if(!panoramaState.enabled) return;
    const canvasEl = document.getElementById('panoramaCanvas');
    if(!canvasEl){ toast(tr('smart.panoramaExportFailed')); return; }
    try {
        if(!drawPanoramaFrame()) throw new Error(tr('smart.panoramaExportFailed'));
        const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
        if(!blob) throw new Error(tr('smart.panoramaExportFailed'));
        const editing = currentEditImage();
        const rawName = editing.image?.name || fileNameFromUrl(editing.image?.url || '') || 'panorama';
        const base = String(rawName).replace(/\.[a-z0-9]{2,8}$/i, '') || 'panorama';
        const filename = safeExportFileName(`${base}-panorama.png`, 'panorama.png');
        const uploaded = await uploadFiles([new File([blob], filename, {type:'image/png'})]);
        const frame = uploaded[0];
        if(!frame?.url) throw new Error(tr('smart.panoramaExportFailed'));
        frame.kind = 'image';
        frame.natural_w = canvasEl.width;
        frame.natural_h = canvasEl.height;
        const rect = editing.node ? nodeRect(editing.node) : null;
        const point = rect
            ? {x:rect.x + rect.width + 240, y:rect.y + rect.height / 2}
            : window.SmartCanvasModules.viewportSelection.viewport.center();
        imageStudioMutationModule.history({action:'push'});
        const newNode = createImageNodeAt(point, [frame], {select:true, skipUndo:true});
        selectedIds = [];
        selectedImage = {nodeId:newNode.id, index:0};
        render();
        imageStudioPersistenceModule.schedule();
        toast(tr('smart.panoramaExportDone'));
    } catch(e) {
        toast((e.message || tr('smart.panoramaExportFailed')).slice(0, 120));
    }
}
function resetPanoramaView(){
    panoramaState.fov = 75;
    panoramaState.yaw = 0;
    panoramaState.pitch = 0;
    resizePanoramaViewer();
    updateZoomLabel();
}
function disposePanoramaPreview(){
    stopPanoramaLoop();
    disposePanoramaTexture();
    panoramaState.enabled = false;
    panoramaState.drag = null;
    panoramaState.loadedSrc = '';
    panoramaState.loadToken++;
    const stage = document.getElementById('panoramaStage');
    stage?.classList.remove('ready');
    if(stage) stage.style.display = 'none';
    document.getElementById('previewStage')?.classList.remove('panorama-on', 'panning');
    imageEditModal?.classList.remove('image-panorama-mode');
    document.getElementById('imagePanoramaTools')?.toggleAttribute('hidden', true);
    document.getElementById('panoramaControls')?.style.setProperty('display', 'none');
    document.getElementById('imagePreviewTools')?.toggleAttribute('hidden', imageEditMode !== 'preview');
    setImageStudioToggleState('panoramaToggleBtn', false);
    document.getElementById('panoramaResetBtn')?.style.setProperty('display', 'none');
    document.getElementById('panoramaExportBtn')?.style.setProperty('display', 'none');
}
function applyPanoramaRatio(value){
    panoramaState.ratio = PANORAMA_RATIO_PRESETS[value] ? value : 'custom';
    refreshPanoramaControls();
    resizePanoramaViewer();
}
function setPreviewComparePos(clientX){
    const frame = document.getElementById('previewFrame');
    const stage = document.getElementById('previewStage');
    if(!frame || !stage) return;
    const rect = frame.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / Math.max(1, rect.width)) * 100));
    previewComparePos = pct;
    stage.style.setProperty('--compare-pos', `${pct}%`);
}
function syncPreviewFrameSize(){
    const frame = document.getElementById('previewFrame');
    if(panoramaState.enabled){
        resizePanoramaViewer();
        return;
    }
    const currentImg = document.getElementById('previewCurrentImage');
    const currentVideo = document.getElementById('previewCurrentVideo');
    const compareImg = document.getElementById('previewCompareImage');
    const currentMedia = currentVideo && currentVideo.style.display !== 'none' ? currentVideo : currentImg;
    if(!frame || !currentMedia) return;
    const w = currentMedia.clientWidth || currentMedia.videoWidth || currentMedia.naturalWidth || 1;
    const h = currentMedia.clientHeight || currentMedia.videoHeight || currentMedia.naturalHeight || 1;
    frame.style.width = `${w}px`;
    frame.style.height = `${h}px`;
    if(compareImg){
        compareImg.style.width = `${w}px`;
        compareImg.style.height = `${h}px`;
    }
}
function rememberPreviewImageResolution(){
    const editing = currentEditImage();
    const image = editing.image;
    if(!image) return;
    const currentImg = document.getElementById('previewCurrentImage');
    const currentVideo = document.getElementById('previewCurrentVideo');
    const cropImg = document.getElementById('cropImage');
    const w = Number(currentVideo?.videoWidth || 0) || Number(currentImg?.naturalWidth || 0) || Number(cropImg?.naturalWidth || 0);
    const h = Number(currentVideo?.videoHeight || 0) || Number(currentImg?.naturalHeight || 0) || Number(cropImg?.naturalHeight || 0);
    if(w > 0 && h > 0 && (!image.natural_w || !image.natural_h)){
        image.natural_w = w;
        image.natural_h = h;
        imageStudioPersistenceModule.schedule();
    }
}
function previewCompareSources(){
    const editing = currentEditImage();
    const node = editing.node;
    if(!node) return [];
    const parentConnections = typeof upstreamConnectionsForKinds === 'function'
        ? upstreamConnectionsForKinds(node, ['input', 'flow'])
        : (canvas?.connections || []).filter(connection => (
            connection?.to === node.id
            && ['input', 'flow'].includes(connection.kind || 'flow')
        ));
    const parentImages = parentConnections.flatMap(connection => {
        if(typeof outputImagesForConnection === 'function'){
            return outputImagesForConnection(connection).filter(image => image?.url);
        }
        const parent = nodes.find(candidate => candidate.id === connection?.from);
        return (parent?.images || []).map((image, imageIndex) => ({
            ...imageForDisplay(image),
            nodeId:parent.id,
            imageIndex
        })).filter(image => image?.url);
    });
    const connectedParentIds = new Set(parentConnections.map(connection => connection?.from).filter(Boolean));
    const sourceNode = node.sourceNodeId && node.sourceNodeId !== node.id && !connectedParentIds.has(node.sourceNodeId)
        ? nodes.find(candidate => candidate.id === node.sourceNodeId)
        : null;
    if(sourceNode){
        const sourceImages = typeof outputImagesForNode === 'function'
            ? outputImagesForNode(sourceNode)
            : (sourceNode.images || []).map((image, imageIndex) => ({...imageForDisplay(image),nodeId:sourceNode.id,imageIndex}));
        parentImages.push(...sourceImages.filter(image => image?.url));
    }
    const seen = new Set();
    return parentImages.filter(source => {
        if(!source?.url || mediaKindForItem(source) !== 'image') return false;
        const key = String(source.url);
        if(seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
function previewCompareAspectRatio(image){
    const width = Number(image?.natural_w || image?.naturalWidth || image?.width || 0);
    const height = Number(image?.natural_h || image?.naturalHeight || image?.height || 0);
    return width > 0 && height > 0 ? width / height : 0;
}
function preferredPreviewCompareIndex(sources=previewCompareSources()){
    const editing = currentEditImage();
    const currentImage = document.getElementById('previewCurrentImage');
    const targetRatio = previewCompareAspectRatio(editing.image)
        || previewCompareAspectRatio(currentImage);
    if(!targetRatio) return -1;
    let bestIndex = -1;
    let bestDelta = Infinity;
    sources.forEach((source,index) => {
        const sourceRatio = previewCompareAspectRatio(source);
        if(!sourceRatio) return;
        const delta = Math.abs(sourceRatio - targetRatio) / targetRatio;
        if(delta <= 0.02 && delta < bestDelta){
            bestIndex = index;
            bestDelta = delta;
        }
    });
    return bestIndex;
}
function refreshComparePanel(){
    const stage = document.getElementById('previewStage');
    const compareImg = document.getElementById('previewCompareImage');
    const currentImg = document.getElementById('previewCurrentImage');
    const currentVideo = document.getElementById('previewCurrentVideo');
    const compareLayer = document.getElementById('previewCompareLayer');
    const compareHandle = document.getElementById('previewCompareHandle');
    const thumbsEl = document.getElementById('compareThumbs');
    const toggle = document.getElementById('compareToggleBtn');
    const panoramaToggle = document.getElementById('panoramaToggleBtn');
    const panoramaStage = document.getElementById('panoramaStage');
    const editing = currentEditImage();
    const curUrl = editing.image?.url || '';
    const isVideoPreview = mediaKindForItem(editing.image || {}) === 'video';
    const isPreviewMode = imageEditMode === 'preview';
    if(panoramaToggle){
        panoramaToggle.style.display = !isVideoPreview ? 'inline-flex' : 'none';
        setImageStudioToggleState(panoramaToggle, panoramaState.enabled);
    }
    document.getElementById('previewMediaContainer')?.setAttribute('kind', isVideoPreview ? 'video' : 'image');
    if(!isPreviewMode && panoramaState.enabled) disposePanoramaPreview();
    if(!isPreviewMode){
        currentImg.onload = null;
        currentImg.onerror = null;
        currentImg.removeAttribute('src');
        currentImg.style.display = 'none';
        return;
    }
    if(panoramaState.enabled && isPreviewMode && !isVideoPreview){
        currentImg.onload = null;
        currentImg.onerror = null;
        const panoramaReady = Boolean(panoramaState.image && panoramaStage?.classList.contains('ready'));
        currentImg.style.display = panoramaReady ? 'none' : 'block';
        if(panoramaStage) panoramaStage.style.display = panoramaReady ? 'block' : 'none';
        stage?.classList.remove('compare-on');
        if(compareLayer) compareLayer.style.display = 'none';
        if(compareHandle) compareHandle.style.display = 'none';
        if(thumbsEl){ thumbsEl.style.display = 'none'; clearPreviewCompareChoices(thumbsEl); }
        if(toggle) toggle.style.display = 'none';
        setImageStudioToggleState(toggle, false);
        return;
    }
    const onCurrentLoaded = () => {
        if(currentImg.dataset.previewQuick !== '1') rememberPreviewImageResolution();
        syncPreviewFrameSize();
    };
    if(isVideoPreview){
        currentImg.onload = null;
        currentImg.onerror = null;
        currentImg.removeAttribute('src');
        currentImg.style.display = 'none';
        if(currentVideo){
            const previewSrc = displayMediaUrl(editing.image || curUrl);
            currentVideo.style.display = 'block';
            currentVideo.onloadedmetadata = onCurrentLoaded;
            currentVideo.onloadeddata = onCurrentLoaded;
            if(currentVideo.getAttribute('src') !== previewSrc){
                currentVideo.src = previewSrc;
                currentVideo.load?.();
            }
            if(currentVideo.readyState >= 1) requestAnimationFrame(onCurrentLoaded);
        }
        previewCompareOn = false;
        previewCompareIndex = -1;
        stage.classList.remove('compare-on');
        if(compareLayer) compareLayer.style.display = 'none';
        if(compareHandle) compareHandle.style.display = 'none';
        if(thumbsEl){ thumbsEl.style.display = 'none'; clearPreviewCompareChoices(thumbsEl); }
        if(toggle){
            toggle.disabled = true;
            toggle.style.display = 'none';
            setImageStudioToggleState(toggle, false);
            toggle.title = tr('smart.compareEmpty');
        }
        if(panoramaToggle) panoramaToggle.style.display = 'none';
        return;
    }
    if(currentVideo){
        currentVideo.pause?.();
        currentVideo.onloadedmetadata = null;
        currentVideo.onloadeddata = null;
        currentVideo.removeAttribute('src');
        currentVideo.load?.();
        currentVideo.style.display = 'none';
    }
    currentImg.style.display = 'block';
    currentImg.onload = onCurrentLoaded;
    currentImg.onerror = null;
    const previewSrc = displayMediaUrl(editing.image || curUrl);
    const previewToken = `${editing.node?.id || ''}:${editing.index ?? 0}:${Date.now()}`;
    currentImg.dataset.previewSrcToken = previewToken;
    if(currentImg.getAttribute('src') !== previewSrc) {
        currentImg.dataset.proxyFallbackTried = '';
        currentImg.dataset.previewQuick = '';
        currentImg.src = previewSrc;
    } else {
        currentImg.dataset.previewQuick = '';
    }
    if(currentImg.complete && currentImg.naturalWidth) requestAnimationFrame(onCurrentLoaded);
    const sources = previewCompareSources();
    const hasSource = sources.length > 0;
    if(toggle){
        toggle.disabled = !hasSource;
        toggle.style.display = isPreviewMode && hasSource ? 'inline-flex' : 'none';
        toggle.title = hasSource ? tr('smart.compareHover') : tr('smart.compareEmpty');
        setImageStudioToggleState(toggle, hasSource && previewCompareOn);
    }
    if(!hasSource){
        previewCompareOn = false;
        previewCompareIndex = -1;
        stage.classList.remove('compare-on');
        if(compareLayer) compareLayer.style.display = 'none';
        if(compareHandle) compareHandle.style.display = 'none';
        if(thumbsEl){ thumbsEl.style.display = 'none'; clearPreviewCompareChoices(thumbsEl); }
        return;
    }
    const sliderActive = previewCompareOn && previewCompareIndex >= 0 && previewCompareIndex < sources.length;
    if(sliderActive){
        const src = sources[previewCompareIndex];
        compareImg.src = displayMediaUrl(src || '');
        compareImg.onload = syncPreviewFrameSize;
        syncPreviewFrameSize();
        stage.classList.add('compare-on');
        if(compareLayer) compareLayer.style.display = '';
        if(compareHandle) compareHandle.style.display = '';
    } else {
        stage.classList.remove('compare-on');
        if(compareLayer) compareLayer.style.display = 'none';
        if(compareHandle) compareHandle.style.display = 'none';
    }
    if(previewCompareOn){
        thumbsEl.style.display = 'inline-flex';
        clearPreviewCompareChoices(thumbsEl);
        thumbsEl.setAttribute('value', previewCompareIndex >= 0 ? String(previewCompareIndex) : 'none');
        const choiceTemplate = thumbsEl.querySelector('#compareThumbTemplate');
        sources.forEach((source, index) => {
            const choice = choiceTemplate?.content?.firstElementChild?.cloneNode(true);
            if(!choice) return;
            const actionLabel = index === previewCompareIndex ? tr('smart.compareCancelTip') : tr('smart.compareUseTip');
            choice.dataset.value = String(index);
            choice.dataset.compareIdx = String(index);
            choice.setAttribute('aria-label', actionLabel);
            choice.title = actionLabel;
            choice.innerHTML = smartPreviewImgHtml(source.url, 256);
            thumbsEl.append(choice);
        });
        bindSmartPreviewImageFallbacks(thumbsEl);
        if(thumbsEl.dataset.comparePickerBound !== '1'){
            thumbsEl.dataset.comparePickerBound = '1';
            thumbsEl.addEventListener('click', e => {
                const btn = e.target.closest?.('[data-compare-idx]');
                if(!btn || !thumbsEl.contains(btn)) return;
                e.preventDefault();
                e.stopImmediatePropagation();
                const idx = Number(btn.dataset.compareIdx);
                previewCompareIndex = (previewCompareIndex === idx) ? -1 : idx;
                refreshComparePanel();
            }, {capture:true});
        }
    } else {
        thumbsEl.style.display = 'none';
        clearPreviewCompareChoices(thumbsEl);
    }
}
function togglePreviewCompare(){
    const sources = previewCompareSources();
    if(!sources.length){ toast(tr('smart.compareNoSource')); return; }
    previewCompareOn = !previewCompareOn;
    if(previewCompareOn && (previewCompareIndex < 0 || previewCompareIndex >= sources.length)){
        previewCompareIndex = preferredPreviewCompareIndex(sources);
    }
    if(!previewCompareOn) previewCompareIndex = -1;
    setImageStudioToggleState('compareToggleBtn', previewCompareOn);
    refreshComparePanel();
}
function currentPreviewVideo(){
    if(!imageStudioDialogOpen()) return null;
    if(mediaKindForItem(currentEditImage().image || {}) !== 'video') return null;
    return document.getElementById('previewCurrentVideo');
}
function togglePreviewVideoLoop(){
    const video = currentPreviewVideo();
    if(!video) return false;
    const enabled = typeof window.smartPlaybackTogglePreviewLoop === 'function'
        ? window.smartPlaybackTogglePreviewLoop(video)
        : (video.loop = !video.loop);
    syncPreviewVideoLoopControl(enabled);
    return enabled;
}
function videoFrameStep(){
    const image = currentEditImage().image || {};
    const fps = Number(image.fps || image.frameRate || image.frame_rate || image.framespersecond || image.frames_per_second || 0);
    return 1 / Math.max(1, Math.min(120, Number.isFinite(fps) && fps > 0 ? fps : 30));
}
function seekPreviewVideoFrames(direction){
    const video = currentPreviewVideo();
    if(!video || video.readyState < 1) return false;
    video.pause?.();
    const step = videoFrameStep();
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const maxTime = duration ? Math.max(0, duration - step / 2) : Number.MAX_SAFE_INTEGER;
    video.currentTime = Math.max(0, Math.min(maxTime, Number(video.currentTime || 0) + direction * step));
    return true;
}
function waitForVideoEvent(video, eventName, timeout=1500){
    return new Promise(resolve => {
        let done = false;
        const finish = () => {
            if(done) return;
            done = true;
            clearTimeout(timer);
            video.removeEventListener(eventName, finish);
            resolve();
        };
        const timer = setTimeout(finish, timeout);
        video.addEventListener(eventName, finish, {once:true});
    });
}
async function seekVideoForFrame(video, time){
    if(Math.abs(Number(video.currentTime || 0) - time) <= 0.002) return;
    video.currentTime = time;
    await waitForVideoEvent(video, 'seeked', 2200);
}
async function exportVideoFrame(which='current'){
    const video = currentPreviewVideo();
    if(!video){ toast(tr('smart.noVideoFrame')); return; }
    if(video.readyState < 2) await waitForVideoEvent(video, 'loadeddata', 2200);
    if(!video.videoWidth || !video.videoHeight){ toast(tr('smart.videoNotLoaded')); return; }
    const originalTime = Number(video.currentTime || 0);
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const step = videoFrameStep();
    const target = which === 'first'
        ? 0
        : which === 'last'
            ? Math.max(0, duration - step / 2)
            : originalTime;
    const suffix = which === 'first' ? 'first-frame' : which === 'last' ? 'last-frame' : 'current-frame';
    try {
        video.pause?.();
        await seekVideoForFrame(video, target);
        const canvasEl = document.createElement('canvas');
        canvasEl.width = video.videoWidth;
        canvasEl.height = video.videoHeight;
        const ctx = canvasEl.getContext('2d');
        ctx.drawImage(video, 0, 0, canvasEl.width, canvasEl.height);
        const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
        if(!blob) throw new Error(tr('smart.exportFrameFailed'));
        const editing = currentEditImage();
        const rawName = editing.image?.name || fileNameFromUrl(editing.image?.url || '') || 'video';
        const base = String(rawName).replace(/\.[a-z0-9]{2,8}$/i, '') || 'video';
        const filename = safeExportFileName(`${base}-${suffix}.png`, `${suffix}.png`);
        const uploaded = await uploadFiles([new File([blob], filename, {type:'image/png'})]);
        const frame = uploaded[0];
        if(!frame?.url) throw new Error(tr('smart.exportToCanvasFailed'));
        frame.kind = 'image';
        frame.natural_w = video.videoWidth;
        frame.natural_h = video.videoHeight;
        const rect = editing.node ? nodeRect(editing.node) : null;
        const point = rect
            ? {x:rect.x + rect.width + 240, y:rect.y + rect.height / 2}
            : window.SmartCanvasModules.viewportSelection.viewport.center();
        imageStudioMutationModule.history({action:'push'});
        const newNode = createImageNodeAt(point, [frame], {select:true, skipUndo:true});
        selectedIds = [];
        selectedImage = {nodeId:newNode.id, index:0};
        render();
        imageStudioPersistenceModule.schedule();
        toast(tr('smart.exportedToCanvas'));
        if(which !== 'current') await seekVideoForFrame(video, originalTime);
    } catch(e) {
        toast((e.message || tr('smart.exportFrameFailed')).slice(0, 120));
    }
}
function editDrawSnapshot(){
    const canvasEl = editDrawCanvas();
    return {
        imageData:canvasEl.getContext('2d').getImageData(0, 0, canvasEl.width, canvasEl.height),
        labelCounter:brushLabelCounter,
        textItems:editTextItems.map(item => ({...item})),
        textSelectedId:editTextSelectedId || ''
    };
}
function editDrawSnapshotBytes(snapshot){
    return Number(snapshot?.imageData?.data?.byteLength || 0)
        + JSON.stringify(snapshot?.textItems || []).length * 2
        + 64;
}
function trimEditDrawHistory(stack){
    while(stack.length > EDIT_DRAW_HISTORY_MAX) stack.shift();
    let bytes = stack.reduce((total,snapshot) => total + editDrawSnapshotBytes(snapshot), 0);
    while(stack.length > 1 && bytes > EDIT_DRAW_HISTORY_BYTE_BUDGET){
        bytes -= editDrawSnapshotBytes(stack.shift());
    }
}
function restoreEditDrawSnapshot(snapshot){
    if(!snapshot) return;
    removeEditTextInlineEditor(false);
    editDrawCanvas().getContext('2d').putImageData(snapshot.imageData || snapshot, 0, 0);
    if(snapshot.labelCounter) brushLabelCounter = snapshot.labelCounter;
    editTextItems = (snapshot.textItems || []).map(item => ({...item}));
    editTextSelectedId = snapshot.textSelectedId || '';
    renderEditTextCanvas();
    syncTextToolState(true);
}
function pushEditDrawHistory(){
    editDrawUndoStack.push(editDrawSnapshot());
    trimEditDrawHistory(editDrawUndoStack);
    editDrawRedoStack = [];
    syncEditDrawingHistoryButtons();
}
function syncEditDrawingHistoryButtons(){
    ['maskUndoBtn','brushUndoBtn'].forEach(id => { const btn = document.getElementById(id); if(btn){ btn.disabled = !editDrawUndoStack.length; btn.style.opacity = editDrawUndoStack.length ? '1' : '.42'; } });
    ['maskRedoBtn','brushRedoBtn'].forEach(id => { const btn = document.getElementById(id); if(btn){ btn.disabled = !editDrawRedoStack.length; btn.style.opacity = editDrawRedoStack.length ? '1' : '.42'; } });
}
function undoEditDrawing(){
    if(!editDrawUndoStack.length) return;
    const previous = editDrawUndoStack.pop();
    editDrawRedoStack.push(editDrawSnapshot());
    trimEditDrawHistory(editDrawRedoStack);
    restoreEditDrawSnapshot(previous);
    syncEditDrawingHistoryButtons();
}
function redoEditDrawing(){
    if(!editDrawRedoStack.length) return;
    const next = editDrawRedoStack.pop();
    editDrawUndoStack.push(editDrawSnapshot());
    trimEditDrawHistory(editDrawUndoStack);
    restoreEditDrawSnapshot(next);
    syncEditDrawingHistoryButtons();
}
imageEditModal?.addEventListener('keydown', event => {
    if(
        !imageStudioDialogOpen()
        || imageEditMode !== 'brush'
        || !(event.ctrlKey || event.metaKey)
        || String(event.key || '').toLowerCase() !== 'z'
        || event.target?.closest?.('input,textarea,[contenteditable="true"],ic-slider,ic-color-field')
    ) return;
    event.preventDefault();
    if(event.shiftKey) redoEditDrawing();
    else undoEditDrawing();
});
function editCanvasHasPixels(){
    if(editTextHasContent()) return true;
    const canvasEl = editDrawCanvas();
    const data = canvasEl.getContext('2d').getImageData(0, 0, canvasEl.width, canvasEl.height).data;
    for(let i = 3; i < data.length; i += 4) if(data[i] > 0) return true;
    return false;
}
function clearEditDrawing(silent=false){
    removeEditTextInlineEditor(false);
    const canvasEl = editDrawCanvas();
    if(!silent && editCanvasHasPixels()) pushEditDrawHistory();
    canvasEl.getContext('2d').clearRect(0, 0, canvasEl.width, canvasEl.height);
    const textCanvasEl = editTextCanvas();
    textCanvasEl?.getContext('2d')?.clearRect(0, 0, textCanvasEl.width, textCanvasEl.height);
    editTextItems = [];
    editTextSelectedId = '';
    editTextDrag = null;
    editTextDirty = false;
    brushLabelCounter = 1;
    syncTextToolState(true);
    syncEditDrawingHistoryButtons();
}
function resetEditDrawingHistory(){
    removeEditTextInlineEditor(false);
    editDrawUndoStack = [];
    editDrawRedoStack = [];
    brushLabelCounter = 1;
    editTextItems = [];
    editTextSelectedId = '';
    editTextDrag = null;
    editTextDirty = false;
    renderEditTextCanvas();
    syncTextToolState(true);
    syncEditDrawingHistoryButtons();
}
function setBrushTool(tool){
    if(tool !== 'text') removeEditTextInlineEditor(true);
    brushTool = ['free','rect','ellipse','label','text'].includes(tool) ? tool : 'free';
    syncBrushToolButtons();
    syncTextToolState(true);
}
function syncBrushToolButtons(){
    document.querySelectorAll('[data-brush-tool]').forEach(btn => {
        const active = btn.dataset.brushTool === brushTool;
        setImageStudioToggleState(btn, active);
    });
    document.getElementById('cropCanvas')?.classList.toggle('text-mode', imageEditMode === 'brush' && brushTool === 'text');
}
function editDrawPoint(event){
    const canvasEl = editDrawCanvas();
    const rect = canvasEl.getBoundingClientRect();
    return {x:(event.clientX - rect.left) * canvasEl.width / Math.max(1, rect.width), y:(event.clientY - rect.top) * canvasEl.height / Math.max(1, rect.height)};
}
function gridCustomLineHit(point){
    const canvasEl = editDrawCanvas();
    const threshold = Math.max(8, Math.min(canvasEl.width, canvasEl.height) / 80);
    let best = -1, bestDist = Infinity;
    gridCustomLines.forEach((line, index) => {
        const dist = line.type === 'h' ? Math.abs(point.y - line.pos * canvasEl.height) : Math.abs(point.x - line.pos * canvasEl.width);
        if(dist < bestDist && dist <= threshold){ best = index; bestDist = dist; }
    });
    return best;
}
function setGridCustomLinePos(index, point){
    const canvasEl = editDrawCanvas();
    const line = gridCustomLines[index];
    if(!line) return;
    line.pos = line.type === 'h'
        ? Math.max(0.001, Math.min(0.999, point.y / Math.max(1, canvasEl.height)))
        : Math.max(0.001, Math.min(0.999, point.x / Math.max(1, canvasEl.width)));
}
const MASK_BRUSH_ALPHA = 115;
const MASK_BRUSH_COLOR = `rgba(255,255,255,${MASK_BRUSH_ALPHA / 255})`;
function editBrushSize(){ return Number(document.getElementById(imageEditMode === 'mask' ? 'maskBrushSize' : 'paintBrushSize')?.value || 20); }
function brushColor(){ return document.getElementById('paintBrushColor')?.value || '#ff2d55'; }
function setupDrawStyle(ctx){
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = editBrushSize();
    ctx.strokeStyle = imageEditMode === 'mask' ? MASK_BRUSH_COLOR : brushColor();
    ctx.fillStyle = imageEditMode === 'mask' ? MASK_BRUSH_COLOR : brushColor();
    ctx.globalCompositeOperation = imageEditMode === 'mask' ? 'copy' : 'source-over';
}
function normalizeMaskPreviewCanvas(canvasEl=editDrawCanvas()){
    if(imageEditMode !== 'mask' || !canvasEl?.width || !canvasEl?.height) return;
    const ctx = canvasEl.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
    const data = imageData.data;
    let changed = false;
    for(let i = 0; i < data.length; i += 4){
        if(data[i + 3] <= 0) continue;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        if(data[i + 3] > MASK_BRUSH_ALPHA) data[i + 3] = MASK_BRUSH_ALPHA;
        changed = true;
    }
    if(changed) ctx.putImageData(imageData, 0, 0);
}
function strokeFreeDrawPoint(point){
    if(!editDrawState) return;
    const ctx = editDrawCanvas().getContext('2d');
    setupDrawStyle(ctx);
    const dx = point.x - editDrawState.x;
    const dy = point.y - editDrawState.y;
    const dist = Math.hypot(dx, dy);
    const radius = Math.max(1, editBrushSize() / 2);
    if(dist > radius){
        const steps = Math.ceil(dist / Math.max(1, radius * 0.35));
        for(let i = 1; i <= steps; i++){
            const t = i / steps;
            const x = editDrawState.x + dx * t;
            const y = editDrawState.y + dy * t;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.beginPath();
    ctx.moveTo(editDrawState.x, editDrawState.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    editDrawState.x = point.x;
    editDrawState.y = point.y;
}
function circledNumber(n){ return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n); }
function drawBrushShape(ctx, start, end){
    setupDrawStyle(ctx);
    const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y), w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
    if(brushTool === 'rect') ctx.strokeRect(x, y, w, h);
    else if(brushTool === 'ellipse'){ ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2); ctx.stroke(); }
}
function drawNumberLabel(point){
    const ctx = editDrawCanvas().getContext('2d');
    const size = Math.max(18, editBrushSize() * 2.2);
    const text = circledNumber(brushLabelCounter++);
    setupDrawStyle(ctx);
    ctx.save(); ctx.font = `900 ${size}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = Math.max(3, size / 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.strokeText(text, point.x, point.y); ctx.fillStyle = brushColor(); ctx.fillText(text, point.x, point.y); ctx.restore();
}
function beginEditDraw(event){
    if(imageEditMode === 'crop') return;
    event.preventDefault(); event.stopPropagation();
    const canvasEl = editDrawCanvas();
    canvasEl.setPointerCapture?.(event.pointerId);
    const p = editDrawPoint(event);
    if(imageEditMode === 'grid'){
        if(gridOperationMode === 'join') return;
        if(!gridCustomMode) return;
        const hit = gridCustomLineHit(p);
        gridCustomHistory.push([...gridCustomLines.map(line => ({...line}))]);
        if(hit >= 0){ gridCustomDrag = {index:hit, pointerId:event.pointerId}; setGridCustomLinePos(hit, p); }
        else { gridCustomLines.push({type:gridCustomOrientation, pos:gridCustomOrientation === 'h' ? p.y / canvasEl.height : p.x / canvasEl.width}); gridCustomDrag = {index:gridCustomLines.length - 1, pointerId:event.pointerId}; }
        syncGridCustomUndoBtn(); refreshGridSplitPreview(); return;
    }
    const ctx = canvasEl.getContext('2d');
    pushEditDrawHistory();
    if(imageEditMode === 'brush' && brushTool === 'label'){ drawNumberLabel(p); editDrawState = null; canvasEl.releasePointerCapture?.(event.pointerId); return; }
    editDrawState = {x:p.x, y:p.y, sx:p.x, sy:p.y, pointerId:event.pointerId, snapshot:(imageEditMode === 'brush' && brushTool !== 'free') ? editDrawUndoStack.at(-1) : null};
    setupDrawStyle(ctx);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + .01, p.y + .01);
    if(imageEditMode === 'mask' || brushTool === 'free') ctx.stroke();
}
function moveEditDraw(event){
    if(imageEditMode === 'grid' && gridOperationMode === 'join') return;
    if(imageEditMode === 'grid' && gridCustomMode && gridCustomDrag){ event.preventDefault(); event.stopPropagation(); setGridCustomLinePos(gridCustomDrag.index, editDrawPoint(event)); refreshGridSplitPreview(); return; }
    if(!editDrawState || imageEditMode === 'crop' || imageEditMode === 'grid') return;
    event.preventDefault(); event.stopPropagation();
    const ctx = editDrawCanvas().getContext('2d');
    const p = editDrawPoint(event);
    if(imageEditMode === 'brush' && brushTool !== 'free'){ restoreEditDrawSnapshot(editDrawState.snapshot); drawBrushShape(ctx, {x:editDrawState.sx, y:editDrawState.sy}, p); return; }
    const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    if(events.length){
        events.forEach(ev => strokeFreeDrawPoint(editDrawPoint(ev)));
    } else {
        strokeFreeDrawPoint(p);
    }
}
function endEditDraw(event){
    if(editDrawState && event?.pointerId != null) editDrawCanvas().releasePointerCapture?.(event.pointerId);
    if(gridCustomDrag && event?.pointerId != null) editDrawCanvas().releasePointerCapture?.(event.pointerId);
    editDrawState = null; gridCustomDrag = null; syncEditDrawingHistoryButtons();
}
function beginGridJoinDrag(event){
    if(imageEditMode !== 'grid' || gridOperationMode !== 'join') return;
    const itemEl = event.target?.closest?.('.grid-join-item');
    if(!itemEl) return;
    event.preventDefault();
    event.stopPropagation();
    const index = Number(itemEl.dataset.gridJoinIndex);
    const item = gridJoinLayout?.items?.find(entry => Number(entry.index) === index);
    const host = document.getElementById('gridJoinCanvas');
    if(!item || !host) return;
    itemEl.setPointerCapture?.(event.pointerId);
    gridJoinDrag = {index, pointerId:event.pointerId, sx:event.clientX, sy:event.clientY, x:item.x, y:item.y};
    itemEl.classList.add('dragging');
}
function moveGridJoinDrag(event){
    if(!gridJoinDrag || imageEditMode !== 'grid' || gridOperationMode !== 'join') return;
    event.preventDefault();
    event.stopPropagation();
    const item = gridJoinLayout?.items?.find(entry => Number(entry.index) === Number(gridJoinDrag.index));
    if(!item) return;
    const host = document.getElementById('gridJoinCanvas');
    const rect = host?.getBoundingClientRect();
    const logical = gridJoinCanvasSize();
    const scale = rect ? Math.max(0.001, rect.width / Math.max(1, logical.w)) : Math.max(0.001, imageEditZoom || 1);
    const dx = (event.clientX - gridJoinDrag.sx) / scale;
    const dy = (event.clientY - gridJoinDrag.sy) / scale;
    gridJoinDrag.dx = dx;
    gridJoinDrag.dy = dy;
    const el = host?.querySelector(`[data-grid-join-index="${CSS.escape(String(gridJoinDrag.index))}"]`);
    if(el){
        el.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
    }
}
function gridJoinDragTarget(){
    if(!gridJoinDrag || !gridJoinLayout) return null;
    const dragged = gridJoinLayout.items.find(entry => Number(entry.index) === Number(gridJoinDrag.index));
    if(!dragged) return null;
    const dx = gridJoinDrag.dx || 0;
    const dy = gridJoinDrag.dy || 0;
    const cx = dragged.x + dx + dragged.w / 2;
    const cy = dragged.y + dy + dragged.h / 2;
    return (gridJoinLayout.items || [])
        .filter(entry => Number(entry.index) !== Number(gridJoinDrag.index))
        .map(entry => {
            const inside = cx >= entry.x && cx <= entry.x + entry.w && cy >= entry.y && cy <= entry.y + entry.h;
            const score = Math.hypot(cx - (entry.x + entry.w / 2), cy - (entry.y + entry.h / 2));
            return {entry, inside, score};
        })
        .filter(item => item.inside || item.score < Math.max(dragged.w, dragged.h, item.entry.w, item.entry.h) * 0.55)
        .sort((a, b) => (b.inside - a.inside) || a.score - b.score)[0]?.entry || null;
}
function endGridJoinDrag(event){
    if(!gridJoinDrag) return;
    const host = document.getElementById('gridJoinCanvas');
    const draggedEl = host?.querySelector(`[data-grid-join-index="${CSS.escape(String(gridJoinDrag.index))}"]`);
    draggedEl?.classList.remove('dragging');
    if(draggedEl) draggedEl.style.transform = '';
    const dragged = gridJoinLayout?.items?.find(entry => Number(entry.index) === Number(gridJoinDrag.index));
    const target = gridJoinDragTarget();
    if(dragged && target){
        const order = gridJoinVisualOrder();
        const a = order.indexOf(Number(dragged.index));
        const b = order.indexOf(Number(target.index));
        if(a >= 0 && b >= 0) [order[a], order[b]] = [order[b], order[a]];
        setGridJoinLayoutOrder(order, gridJoinLayout.rows, gridJoinLayout.cols, gridJoinLayout.gap);
        gridJoinUserMoved = true;
        renderGridJoinPreview();
    }
    if(event?.pointerId != null) event.target?.releasePointerCapture?.(event.pointerId);
    gridJoinDrag = null;
}
function syncGridGapValue(){
    const input = document.getElementById('gridGapSize');
    const value = Math.max(0, Math.min(240, Number(input?.value || 0)));
    if(input){
        setImageStudioControlValue(input, value);
        input.setAttribute('value-text', `${value}px`);
    }
    const label = document.getElementById('gridGapValue');
    if(label) label.textContent = String(value);
    if(gridJoinLayout && gridOperationMode === 'join'){
        const rows = gridJoinLayout.rows;
        const cols = gridJoinLayout.cols;
        const order = gridJoinVisualOrder();
        setGridJoinLayoutOrder(order, rows, cols, value);
    }
    return value;
}
function gridGapInputValue(){
    return Math.max(0, Math.min(240, Number(document.getElementById('gridGapSize')?.value || 0)));
}
function gridSplitSettings(){
    const hLines = Math.max(0, Math.min(20, Number(document.getElementById('gridHorizontalLines')?.value || 0)));
    const vLines = Math.max(0, Math.min(20, Number(document.getElementById('gridVerticalLines')?.value || 0)));
    return {rows:hLines + 1, cols:vLines + 1, gap:syncGridGapValue()};
}
function currentGridJoinItems(){
    // 分组拼接：聚合组内所有图片成员的图片，按阅读顺序给出连续索引（source 指向真实图片对象以写回自然尺寸）。
    if(gridJoinGroupId){
        const group = nodes.find(n => n.id === gridJoinGroupId && imageStudioContainerModule.isGroup(n));
        if(group){
            return imageStudioContainerModule.imageRefs(group)
                .filter(r => mediaKindForItem(r.item) === 'image' && r.item?.url)
                .map((r, index) => ({item:r.item, source:r.source, index}));
        }
    }
    const node = currentEditImage().node;
    return (node?.images || [])
        .map((item, index) => ({item:imageForDisplay(item), source:item, index}))
        .filter(entry => mediaKindForItem(entry.item) === 'image' && entry.item?.url);
}
// 从分组小菜单打开“宫格拼接”：锚定在分组第一张图片（保证编辑器有真实底图，不出现破图/尺寸异常），
// 但把拼接数据源切换到整个分组（gridJoinGroupId）。
function openGroupGridJoin(group){
    if(!imageStudioContainerModule.isGroup(group)) return;
    const refs = imageStudioContainerModule.imageRefs(group)
        .filter(r => mediaKindForItem(r.item) === 'image');
    if(refs.length <= 1){ toast(tr('smart.groupNeedsTwoImages')); return; }
    const first = refs[0];
    openImageEditor(first.nodeId, first.index);
    if(!imageStudioDialogOpen()) return;
    gridJoinGroupId = group.id;
    setImageEditMode('grid', true);
    setGridOperationMode('join');
}
function canGridJoinCurrentNode(){
    return currentGridJoinItems().length > 1;
}
function gridJoinAutoDims(count){
    const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))));
    return {rows:Math.max(1, Math.ceil(count / cols)), cols};
}
function gridJoinNaturalSize(entry){
    const item = entry?.item || {};
    const cached = gridJoinImageCache.get(entry?.index);
    const w = Number(item.natural_w || item.width || cached?.naturalWidth || 0);
    const h = Number(item.natural_h || item.height || cached?.naturalHeight || 0);
    return {w:Math.max(1, w || 512), h:Math.max(1, h || 512)};
}
function ensureGridJoinLayout(rows=null, cols=null){
    const items = currentGridJoinItems();
    if(!items.length){ gridJoinLayout = null; return null; }
    const auto = gridJoinAutoDims(items.length);
    const nextRows = Math.max(1, Number(rows || gridJoinLayout?.rows || auto.rows) || auto.rows);
    const nextCols = Math.max(1, Number(cols || gridJoinLayout?.cols || auto.cols) || auto.cols);
    const layoutItems = items.map(entry => ({...gridJoinNaturalSize(entry), index:entry.index}));
    const byIndex = new Map(layoutItems.map(entry => [entry.index, entry]));
    const previousOrder = gridJoinVisualOrder()
        .map(index => byIndex.get(Number(index)))
        .filter(Boolean);
    const ordered = [
        ...previousOrder,
        ...layoutItems.filter(entry => !previousOrder.some(prev => Number(prev.index) === Number(entry.index)))
    ];
    gridJoinLayout = imageStudioGeometry.layoutGrid({
        items:layoutItems,
        order:ordered.map(entry => entry.index),
        rows:nextRows,
        cols:nextCols,
        gap:gridGapInputValue()
    });
    return gridJoinLayout;
}
function gridJoinVisualOrder(layout=gridJoinLayout){
    return (layout?.items || [])
        .slice()
        .sort((a, b) => (Number(a.y || 0) - Number(b.y || 0)) || (Number(a.x || 0) - Number(b.x || 0)))
        .map(item => Number(item.index));
}
function setGridJoinLayoutOrder(order, rows=null, cols=null, gapOverride=null){
    const entries = currentGridJoinItems();
    if(!entries.length){ gridJoinLayout = null; return null; }
    const layoutItems = entries.map(entry => ({...gridJoinNaturalSize(entry), index:entry.index}));
    const auto = gridJoinAutoDims(layoutItems.length);
    const nextRows = Math.max(1, Number(rows || gridJoinLayout?.rows || auto.rows) || auto.rows);
    const nextCols = Math.max(1, Number(cols || gridJoinLayout?.cols || auto.cols) || auto.cols);
    gridJoinLayout = imageStudioGeometry.layoutGrid({
        items:layoutItems,
        order,
        rows:nextRows,
        cols:nextCols,
        gap:gapOverride ?? document.getElementById('gridGapSize')?.value ?? 0
    });
    return gridJoinLayout;
}
function resetGridJoinLayout(){
    gridJoinUserMoved = false;
    gridJoinLayout = null;
    ensureGridJoinLayout();
    renderGridJoinPreview();
}
function applyGridJoinPreset(rows, cols){
    gridJoinUserMoved = false;
    const order = gridJoinVisualOrder();
    if(order.length) setGridJoinLayoutOrder(order, rows, cols);
    else {
        gridJoinLayout = null;
        ensureGridJoinLayout(rows, cols);
    }
    renderGridJoinPreview();
}
function setGridJoinOutputSize(size){
    gridJoinOutputSize = Math.max(256, Math.min(8192, Number(size) || 2048));
    syncGridJoinSizeControls();
    refreshGridSplitPreview();
}
function syncGridJoinSizeControls(){
    setImageStudioControlValue('gridJoinSizeControl', gridJoinOutputSize);
}
function setGridOperationMode(mode){
    gridOperationMode = mode === 'join' && canGridJoinCurrentNode() ? 'join' : 'split';
    if(mode === 'join' && gridOperationMode !== 'join') toast(tr('smart.openJoinFromGroup'));
    syncGridOperationControls();
    refreshGridSplitPreview();
}
function syncGridOperationControls(){
    const join = gridOperationMode === 'join';
    setImageStudioControlValue('gridOperationControl', join ? 'join' : 'split');
    const joinBtn = document.getElementById('gridJoinModeBtn');
    if(joinBtn){
        joinBtn.disabled = !canGridJoinCurrentNode();
    }
    document.querySelectorAll('.grid-split-control').forEach(el => { el.style.display = join ? 'none' : (el.id === 'gridRegularControls' ? 'contents' : ''); });
    document.querySelectorAll('.grid-join-control').forEach(el => { el.style.display = join ? 'grid' : 'none'; });
    syncGridJoinSizeControls();
    if(!join) syncGridCustomControls();
    document.getElementById('cropCanvas')?.classList.toggle('grid-join-mode', join);
    document.getElementById('cropImage')?.classList.toggle('grid-join-hidden', join);
    if(join) ensureGridJoinLayout();
    else gridJoinDrag = null;
}
function gridSplitRects(width, height){
    const {rows, cols, gap} = gridSplitSettings();
    return imageStudioGeometry.splitGrid({
        width,
        height,
        rows,
        cols,
        gap,
        lines:gridCustomMode ? gridCustomLines : null
    });
}
function gridLayoutFromRects(rects){
    return imageStudioGeometry.describeGrid(rects, uid('grid'));
}
function applyGridPreset(rows, cols){
    gridCustomMode = false; gridCustomLines = []; gridCustomHistory = []; gridCustomDrag = null;
    const h = document.getElementById('gridHorizontalLines'), v = document.getElementById('gridVerticalLines');
    if(h){ h.disabled = false; h.value = String(Math.max(0, Number(rows || 1) - 1)); }
    if(v){ v.disabled = false; v.value = String(Math.max(0, Number(cols || 1) - 1)); }
    setImageStudioToggleState('gridCustomToggle', false);
    syncGridCustomControls();
    syncGridCustomCursor(); syncGridCustomUndoBtn(); refreshGridSplitPreview();
}
function syncGridCustomControls(){
    const join = gridOperationMode === 'join';
    const custom = document.getElementById('gridCustomControls');
    if(custom) custom.style.display = !join && gridCustomMode ? 'grid' : 'none';
    document.querySelectorAll('.grid-split-control.grid-preset-row').forEach(row => {
        row.style.display = !join && !gridCustomMode ? 'grid' : 'none';
    });
    const regular = document.getElementById('gridRegularControls');
    if(regular) regular.style.display = !join && !gridCustomMode ? 'contents' : 'none';
}
function toggleGridCustomMode(){
    gridCustomMode = !gridCustomMode;
    if(gridCustomMode){ gridCustomLines = []; gridCustomHistory = []; }
    gridCustomDrag = null;
    const toggle = document.getElementById('gridCustomToggle');
    setImageStudioToggleState(toggle, gridCustomMode);
    ['gridHorizontalLines','gridVerticalLines'].forEach(id => { const el = document.getElementById(id); if(el) el.disabled = gridCustomMode; });
    syncGridCustomControls();
    syncGridCustomCursor(); syncGridCustomUndoBtn(); refreshGridSplitPreview();
}
function setGridCustomOrientation(orient){
    gridCustomOrientation = orient;
    setImageStudioControlValue('gridOrientationControl', orient === 'v' ? 'v' : 'h');
    syncGridCustomCursor();
}
function clearGridCustomLines(){ gridCustomHistory = []; gridCustomLines = []; gridCustomDrag = null; syncGridCustomUndoBtn(); refreshGridSplitPreview(); }
function undoGridCustomLine(){ if(!gridCustomHistory.length) return; gridCustomLines = gridCustomHistory.pop(); gridCustomDrag = null; syncGridCustomUndoBtn(); refreshGridSplitPreview(); }
function syncGridCustomUndoBtn(){
    const btn = document.getElementById('gridUndoBtn');
    if(!btn) return;
    btn.disabled = gridCustomHistory.length === 0;
    btn.style.opacity = gridCustomHistory.length === 0 ? '0.4' : '1';
}
function clampImageResizeScale(value){
    return imageStudioGeometry.scaleImage({width:1, height:1, scale:value}).scale;
}
function imageResizeDimensions(){
    const img = document.getElementById('cropImage');
    return imageStudioGeometry.scaleImage({
        width:img?.naturalWidth || 0,
        height:img?.naturalHeight || 0,
        scale:imageResizeScale
    });
}
function syncImageResizeControls(){
    imageResizeScale = clampImageResizeScale(imageResizeScale);
    const range = document.getElementById('imageResizeScaleRange');
    const input = document.getElementById('imageResizeScaleInput');
    const label = document.getElementById('imageResizeResolution');
    const overlay = document.getElementById('resizeResolutionOverlay');
    const dims = imageResizeDimensions();
    const text = `${dims.targetW}×${dims.targetH}`;
    if(range){
        setImageStudioControlValue(range, dims.scale);
        range.setAttribute('value-text', `${dims.scale}×`);
    }
    if(input) setImageStudioControlValue(input, dims.scale);
    if(label) label.textContent = text;
    if(overlay) overlay.textContent = text;
}
function setImageResizeScale(value){
    imageResizeScale = clampImageResizeScale(value);
    syncImageResizeControls();
}
async function resizedImageBlobFromEditor(){
    const img = document.getElementById('cropImage');
    if(!img?.naturalWidth || !img?.naturalHeight) return null;
    const dims = imageResizeDimensions();
    const canvasEl = document.createElement('canvas');
    canvasEl.width = dims.targetW;
    canvasEl.height = dims.targetH;
    const ctx = canvasEl.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, dims.targetW, dims.targetH);
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    return blob ? {blob, ...dims} : null;
}
function applyImageEditZoom(scaleOverride=null){
    ensureImageEditBaseSize();
    if(!imageEditBaseW) return;
    const img = document.getElementById('cropImage');
    const oldW = cropImageDisplaySize().w;
    img.style.maxWidth = 'none'; img.style.maxHeight = 'none';
    img.style.width = Math.round(imageEditBaseW * imageEditZoom) + 'px';
    img.style.height = Math.round(imageEditBaseH * imageEditZoom) + 'px';
    resizeEditDrawCanvas();
    if(cropState){
        const scale = Number(scaleOverride) || (oldW > 0 ? cropImageDisplaySize().w / oldW : 1);
        cropState.x = Math.round(cropState.x * scale); cropState.y = Math.round(cropState.y * scale);
        cropState.w = Math.round(cropState.w * scale); cropState.h = Math.round(cropState.h * scale);
        clampCrop(); renderCropBox();
    }
    if(imageEditMode === 'grid') refreshGridSplitPreview();
    syncImageResizeControls();
    syncImageEditOverflow(); updateZoomLabel();
}
function ensureImageEditBaseSize(force=false){
    if(imageEditBaseW && imageEditBaseH && !force) return;
    const img = document.getElementById('cropImage');
    const naturalW = img.naturalWidth || img.clientWidth || 0;
    const naturalH = img.naturalHeight || img.clientHeight || 0;
    if(!naturalW || !naturalH) return;
    const maxW = Math.max(1, Math.min(1300, window.innerWidth - 100));
    const maxH = Math.max(1, Math.min(840, window.innerHeight - 200));
    const fit = Math.min(1, maxW / naturalW, maxH / naturalH);
    imageEditBaseW = Math.max(1, Math.round(naturalW * fit));
    imageEditBaseH = Math.max(1, Math.round(naturalH * fit));
}
function syncImageEditOverflow(){
    const stage = document.getElementById('imageEditStage');
    const crop = document.getElementById('cropCanvas');
    if(!stage || !crop) return;
    const rect = crop.getBoundingClientRect(), pad = 36;
    stage.classList.toggle('overflow-x', rect.width + pad > stage.clientWidth);
    stage.classList.toggle('overflow-y', rect.height + pad > stage.clientHeight);
}
function resetImageEditZoom(){
    if(imageEditMode === 'preview'){
        if(panoramaState.enabled){
            resetPanoramaView();
            return;
        }
        resetPreviewTransform();
        return;
    }
    const stage = document.getElementById('imageEditStage');
    imageEditZoom = 1.0; applyImageEditZoom();
    if(stage){ stage.scrollLeft = 0; stage.scrollTop = 0; }
}
function stepImageStudioPreviewZoom(delta){
    if(imageEditMode !== 'preview') return;
    const direction = Math.sign(Number(delta) || 0);
    if(!direction) return;
    if(panoramaState.enabled){
        panoramaState.fov = Math.max(35, Math.min(100, panoramaState.fov - direction * 6));
        updateZoomLabel();
        return;
    }
    previewZoom = Math.max(0.05, Math.min(8, previewZoom + direction * 0.1));
    applyPreviewTransform();
}
function updateZoomLabel(){
    const el = document.getElementById('imageEditZoomLabel');
    if(!el) return;
    if(imageEditMode === 'preview' && panoramaState.enabled){
        el.textContent = Math.round((75 / Math.max(1, panoramaState.fov)) * 100) + '%';
        return;
    }
    el.textContent = Math.round((imageEditMode === 'preview' ? previewZoom : imageEditZoom) * 100) + '%';
}
function syncGridCustomCursor(){
    const el = document.getElementById('cropCanvas');
    el.classList.toggle('grid-custom-h', imageEditMode === 'grid' && gridOperationMode !== 'join' && gridCustomMode && gridCustomOrientation === 'h');
    el.classList.toggle('grid-custom-v', imageEditMode === 'grid' && gridOperationMode !== 'join' && gridCustomMode && gridCustomOrientation === 'v');
}
function gridJoinCanvasSize(layout=gridJoinLayout){
    if(!layout) return {w:1, h:1};
    const gap = Math.max(0, Number(layout.gap || 0));
    const byGrid = {
        w:Math.max(1, Number(layout.cols || 1) * Number(layout.cellW || 1) + Math.max(0, Number(layout.cols || 1) - 1) * gap),
        h:Math.max(1, Number(layout.rows || 1) * Number(layout.cellH || 1) + Math.max(0, Number(layout.rows || 1) - 1) * gap)
    };
    const byItems = (layout.items || []).reduce((acc, item) => ({
        w:Math.max(acc.w, Number(item.x || 0) + Number(item.w || 0)),
        h:Math.max(acc.h, Number(item.y || 0) + Number(item.h || 0))
    }), byGrid);
    return {w:Math.ceil(byItems.w), h:Math.ceil(byItems.h)};
}
function renderGridJoinPreview(){
    const host = document.getElementById('gridJoinCanvas');
    const countEl = document.getElementById('gridSplitCount');
    const cropCanvasEl = document.getElementById('cropCanvas');
    if(!host) return;
    host.innerHTML = '';
    if(imageEditMode !== 'grid' || gridOperationMode !== 'join'){
        host.style.display = 'none';
        if(cropCanvasEl){ cropCanvasEl.style.width = ''; cropCanvasEl.style.height = ''; }
        return;
    }
    const items = currentGridJoinItems();
    if(items.length <= 1){
        host.style.display = 'none';
        if(cropCanvasEl){ cropCanvasEl.style.width = ''; cropCanvasEl.style.height = ''; }
        if(countEl) countEl.textContent = tr('smart.joinNeedsTwo');
        return;
    }
    const layout = ensureGridJoinLayout();
    const size = gridJoinCanvasSize(layout);
    const zoom = Math.max(0.05, Number(imageEditZoom || 1));
    const displayW = Math.max(1, Math.round(size.w * zoom));
    const displayH = Math.max(1, Math.round(size.h * zoom));
    host.style.display = 'block';
    host.style.width = `${Math.max(1, Math.round(size.w))}px`;
    host.style.height = `${Math.max(1, Math.round(size.h))}px`;
    host.style.transform = `scale(${zoom})`;
    host.style.transformOrigin = '0 0';
    if(cropCanvasEl){
        cropCanvasEl.style.width = `${displayW}px`;
        cropCanvasEl.style.height = `${displayH}px`;
    }
    const byIndex = new Map(items.map(entry => [entry.index, entry]));
    (layout.items || []).forEach(item => {
        const entry = byIndex.get(item.index);
        if(!entry) return;
        const img = document.createElement('img');
        img.className = 'grid-join-item';
        img.draggable = false;
        img.dataset.gridJoinIndex = String(item.index);
        img.style.left = `${Math.round(item.x)}px`;
        img.style.top = `${Math.round(item.y)}px`;
        img.style.width = `${Math.round(item.w)}px`;
        img.style.height = `${Math.round(item.h)}px`;
        img.alt = entry.item.name || `image-${item.index + 1}`;
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const hadNaturalSize = Boolean(entry.source.natural_w && entry.source.natural_h);
            gridJoinImageCache.set(item.index, img);
            if(!entry.source.natural_w && img.naturalWidth) entry.source.natural_w = img.naturalWidth;
            if(!entry.source.natural_h && img.naturalHeight) entry.source.natural_h = img.naturalHeight;
            if(!hadNaturalSize && img.naturalWidth && img.naturalHeight && imageEditMode === 'grid' && gridOperationMode === 'join'){
                ensureGridJoinLayout();
                renderGridJoinPreview();
            }
        };
        img.onerror = () => {
            if(img.dataset.proxyFallbackTried === '1') return;
            const fallback = proxiedMediaUrl(entry.item);
            if(!fallback || fallback === img.getAttribute('src')) return;
            img.dataset.proxyFallbackTried = '1';
            img.src = fallback;
        };
        img.src = displayMediaUrl(entry.item);
        host.appendChild(img);
    });
    if(countEl) countEl.textContent = trf('smart.joinSummary', {count: items.length, size: Math.round(gridJoinOutputSize / 1024)});
}
function refreshGridSplitPreview(){
    const canvasEl = editDrawCanvas();
    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    renderGridJoinPreview();
    if(imageEditMode !== 'grid') return;
    if(gridOperationMode === 'join') return;
    const countEl = document.getElementById('gridSplitCount');
    const lineWidth = Math.max(2, Math.round(Math.min(canvasEl.width, canvasEl.height) / 320));
    const drawLine = (x1, y1, x2, y2) => {
        ctx.save(); ctx.lineWidth = lineWidth + 2; ctx.strokeStyle = 'rgba(2,6,23,0.72)'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.lineWidth = lineWidth; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
    };
    if(gridCustomMode){
        const gap = Math.max(0, Math.min(240, Number(document.getElementById('gridGapSize')?.value || 0)));
        const hLines = gridCustomLines.filter(l => l.type === 'h'), vLines = gridCustomLines.filter(l => l.type === 'v');
        if(countEl) countEl.textContent = tr('canvas.gridWillOutput').replace('{n}', (hLines.length + 1) * (vLines.length + 1));
        hLines.forEach(l => { const y = l.pos * canvasEl.height; gap > 0 ? (drawLine(0, y - gap / 2, canvasEl.width, y - gap / 2), drawLine(0, y + gap / 2, canvasEl.width, y + gap / 2)) : drawLine(0, y, canvasEl.width, y); });
        vLines.forEach(l => { const x = l.pos * canvasEl.width; gap > 0 ? (drawLine(x - gap / 2, 0, x - gap / 2, canvasEl.height), drawLine(x + gap / 2, 0, x + gap / 2, canvasEl.height)) : drawLine(x, 0, x, canvasEl.height); });
        return;
    }
    const {rows, cols, gap} = gridSplitSettings();
    if(countEl) countEl.textContent = tr('canvas.gridWillOutput').replace('{n}', rows * cols);
    for(let i = 1; i < cols; i++){ const x = i * canvasEl.width / cols; gap > 0 ? (drawLine(x - gap / 2, 0, x - gap / 2, canvasEl.height), drawLine(x + gap / 2, 0, x + gap / 2, canvasEl.height)) : drawLine(x, 0, x, canvasEl.height); }
    for(let i = 1; i < rows; i++){ const y = i * canvasEl.height / rows; gap > 0 ? (drawLine(0, y - gap / 2, canvasEl.width, y - gap / 2), drawLine(0, y + gap / 2, canvasEl.width, y + gap / 2)) : drawLine(0, y, canvasEl.width, y); }
}
function renderCropBox(){
    if(!cropState) return;
    const cropCanvasEl = document.getElementById('cropCanvas');
    const img = document.getElementById('cropImage');
    const draw = editDrawCanvas();
    const textCanvas = editTextCanvas();
    let boxX = cropState.x;
    let boxY = cropState.y;
    if(cropCanvasEl && img){
        cropCanvasEl.style.width = '';
        cropCanvasEl.style.height = '';
        img.style.position = '';
        img.style.left = '';
        img.style.top = '';
        if(draw){
            draw.style.left = '';
            draw.style.top = '';
        }
        if(textCanvas){
            textCanvas.style.left = '';
            textCanvas.style.top = '';
        }
    }
    const box = document.getElementById('cropBox');
    if(box){
        box.style.left = `${boxX}px`; box.style.top = `${boxY}px`; box.style.width = `${cropState.w}px`; box.style.height = `${cropState.h}px`;
    }
    const shadeBounds = cropBounds();
    const shadeX = Math.max(0, Math.min(shadeBounds.w, boxX));
    const shadeY = Math.max(0, Math.min(shadeBounds.h, boxY));
    const shadeRight = Math.max(shadeX, Math.min(shadeBounds.w, boxX + cropState.w));
    const shadeBottom = Math.max(shadeY, Math.min(shadeBounds.h, boxY + cropState.h));
    const shadeStyles = {
        top:{left:0, top:0, width:shadeBounds.w, height:shadeY},
        right:{left:shadeRight, top:shadeY, width:Math.max(0, shadeBounds.w - shadeRight), height:Math.max(0, shadeBottom - shadeY)},
        bottom:{left:0, top:shadeBottom, width:shadeBounds.w, height:Math.max(0, shadeBounds.h - shadeBottom)},
        left:{left:0, top:shadeY, width:shadeX, height:Math.max(0, shadeBottom - shadeY)},
    };
    document.querySelectorAll('[data-crop-shade]').forEach(shade => {
        const style = shadeStyles[shade.dataset.cropShade];
        if(!style) return;
        shade.style.left = `${style.left}px`;
        shade.style.top = `${style.top}px`;
        shade.style.width = `${style.width}px`;
        shade.style.height = `${style.height}px`;
    });
}
function cropRatioFromPreset(preset){
    if(!preset || preset === 'free') return null;
    if(preset === 'source'){
        const {w, h} = cropBounds();
        return w > 0 && h > 0 ? w / h : null;
    }
    const parts = String(preset).split(':').map(v => Math.max(0, Number(v)));
    return parts.length === 2 && parts[0] > 0 && parts[1] > 0 ? parts[0] / parts[1] : null;
}
function syncCropRatioButtons(){
    const pickerValue = cropAspectPreset === 'free'
        ? 'adaptive'
        : cropAspectPreset === 'source' ? 'keep_ratio' : cropAspectPreset;
    setImageStudioControlValue('cropRatioTabs', pickerValue);
}
function fitCropRectToAspect(ratio, sourceRect=null){
    const next = imageStudioGeometry.fitCrop({
        bounds:cropBounds(),
        rect:sourceRect || cropState,
        ratio
    });
    Object.assign(cropState, next);
}
function setCropAspectPreset(preset='free'){
    if(preset === 'adaptive') preset = 'free';
    else if(preset === 'keep_ratio') preset = 'source';
    cropAspectPreset = preset || 'free';
    cropAspectRatio = cropRatioFromPreset(cropAspectPreset);
    syncCropRatioButtons();
    if(cropState && imageEditMode === 'crop' && cropAspectRatio){
        const {w, h} = cropBounds();
        fitCropRectToAspect(cropAspectRatio, {x:0, y:0, w, h});
        renderCropBox();
    }
}
function resetCropBox(){
    if(!cropState) return;
    const {w, h} = cropBounds();
    const rect = {x:0, y:0, w:Math.round(w), h:Math.round(h)};
    cropState.x = rect.x; cropState.y = rect.y; cropState.w = rect.w; cropState.h = rect.h;
    if(cropAspectRatio) fitCropRectToAspect(cropAspectRatio, rect);
    renderCropBox();
}
function updatePreviewNavButtons(){
    const groupSequence = previewNavState.groupId && Array.isArray(previewNavState.seq)
        ? previewNavState.seq
        : null;
    let count;
    let position = 0;
    if(groupSequence){
        count = groupSequence.length;
        position = (Number(previewNavState.seqPos || 0) + count) % count;
    } else {
        const node = nodes.find(n => n.id === previewNavState.nodeId);
        const images = (node?.images || []).filter(img => img?.url);
        count = images.length;
        const currentImage = node?.images?.[Number(previewNavState.index || 0)];
        const resolvedPosition = images.indexOf(currentImage);
        position = resolvedPosition >= 0 ? resolvedPosition : 0;
    }
    previewNavState.count = count;
    const show = imageStudioDialogOpen() && imageEditMode === 'preview';
    const disabled = count <= 1;
    const showGroupNavigation = show && count > 1;
    const previewTools = document.getElementById('imagePreviewTools');
    const positionHint = document.getElementById('previewGroupNavHint');
    const positionCount = document.getElementById('previewGroupNavCount');
    previewTools?.toggleAttribute('hidden', !show || panoramaState.enabled);
    if(positionHint) positionHint.hidden = !showGroupNavigation;
    if(positionCount) positionCount.textContent = `${count ? position + 1 : 0} / ${count}`;
    const previous = document.getElementById('previewGroupPrevBtn');
    const next = document.getElementById('previewGroupNextBtn');
    if(previous) previous.disabled = disabled;
    if(next) next.disabled = disabled;
}
function navigatePreviewImage(delta){
    if(!imageStudioDialogOpen()) return;
    const requestedMode = imageEditMode;
    // 分组预览：跨成员节点按整组序列左右切换，但保持已打开的 Studio 与当前视图变换不动。
    if(previewNavState.groupId && Array.isArray(previewNavState.seq) && previewNavState.seq.length > 1){
        const groupId = previewNavState.groupId;
        const seq = previewNavState.seq;
        const pos = (Number(previewNavState.seqPos || 0) + Number(delta || 0) + seq.length) % seq.length;
        const ref = seq[pos];
        openImageEditor(ref.nodeId, ref.index, {
            previewSwitch:requestedMode === 'preview',
            navContext:{groupId, seq, seqPos:pos}
        });
        if(imageStudioDialogOpen() && requestedMode !== 'preview') setImageEditMode(requestedMode, true);
        return;
    }
    const node = nodes.find(n => n.id === previewNavState.nodeId);
    const available = (node?.images || []).map((image, index) => ({image, index})).filter(entry => entry.image?.url);
    if(!node || available.length <= 1) return;
    const current = Math.max(0, available.findIndex(entry => entry.index === Number(previewNavState.index || 0)));
    const next = (current + Number(delta || 0) + available.length) % available.length;
    openImageEditor(node.id, available[next].index, {previewSwitch:requestedMode === 'preview'});
    if(imageStudioDialogOpen() && requestedMode !== 'preview') setImageEditMode(requestedMode, true);
}
function openImagePreview(nodeId, imageIndex=0){
    openImageEditor(nodeId, imageIndex);
    setImageEditMode('preview');
}
// 双击组内图片时按整组预览；非分组成员退回单节点预览。
function openImagePreviewSmart(nodeId, imageIndex=0){
    const node = nodes.find(item => item.id === nodeId);
    const group = imageStudioContainerModule.isGroup(node)
        ? node
        : imageStudioContainerModule.groupFor(nodeId);
    if(group){
        openGroupImagePreview(group, nodeId, imageIndex);
        return;
    }
    openImagePreview(nodeId, imageIndex);
}
// 打开整个编组的图片预览：以被双击图片为起点，左右切换遍历编组内所有图片。
function openGroupImagePreview(group, startNodeId, startIndex=0){
    if(!imageStudioContainerModule.isGroup(group)){ openImagePreview(startNodeId, startIndex); return; }
    const refs = imageStudioContainerModule.imageRefs(group);
    if(refs.length <= 1){ openImagePreview(startNodeId, startIndex); return; }
    const seq = refs.map(r => ({nodeId:r.nodeId, index:r.index}));
    let pos = seq.findIndex(s => s.nodeId === startNodeId && Number(s.index) === Number(startIndex));
    if(pos < 0) pos = 0;
    openImagePreview(seq[pos].nodeId, seq[pos].index);
    if(!imageStudioDialogOpen()) return;
    previewNavState.groupId = group.id;
    previewNavState.seq = seq;
    previewNavState.seqPos = pos;
    // 恢复分组上下文后重算导航/下载全部按钮（openImageEditor 已把 previewNavState 重置成单节点态）。
    setImageEditMode('preview');
}
function layerDecompositionEditorNode(){
    return nodes.find(node => node.id === layerDecompositionEditNodeId && node.type === 'smart-layer-decomposition') || null;
}
function layerDecompositionEditorItemStyle(item, canvasWidth, canvasHeight){
    const bbox = Array.isArray(item?.absolute_bbox) ? item.absolute_bbox : [];
    if(item?.role === 'base') return 'left:0;top:0;width:100%;height:100%;z-index:0';
    const left = Math.max(0, Number(bbox[0]) || 0) / canvasWidth * 100;
    const top = Math.max(0, Number(bbox[1]) || 0) / canvasHeight * 100;
    const width = Math.max(0, (Number(bbox[2]) || 0) - (Number(bbox[0]) || 0)) / canvasWidth * 100;
    const height = Math.max(0, (Number(bbox[3]) || 0) - (Number(bbox[1]) || 0)) / canvasHeight * 100;
    return `left:${left}%;top:${top}%;width:${width}%;height:${height}%;z-index:${Number(item.z_index)||0}`;
}
function renderLayerDecompositionEditor(){
    const node = layerDecompositionEditorNode();
    const composite = document.getElementById('layerDecompositionEditorComposite');
    const list = document.getElementById('layerDecompositionEditorList');
    const count = document.getElementById('layerDecompositionEditorCount');
    if(!node || !composite || !list) return false;
    const manifest = node.layerDecompositionManifest || {};
    const canvasWidth = Math.max(1, Number(manifest.canvas_width) || 1);
    const canvasHeight = Math.max(1, Number(manifest.canvas_height) || 1);
    const items = (Array.isArray(node.layerDecompositionItems) ? node.layerDecompositionItems : [])
        .filter(item => item?.media?.url)
        .slice()
        .sort((left,right) => Number(left.z_index) - Number(right.z_index));
    composite.style.aspectRatio = `${canvasWidth} / ${canvasHeight}`;
    composite.style.height = `min(100%, ${canvasHeight}px)`;
    composite.innerHTML = items.map(item => {
        const media = imageForDisplay(item.media);
        return `<div class="layer-decomposition-item${item.hidden ? ' is-hidden' : ''}" style="${layerDecompositionEditorItemStyle(item, canvasWidth, canvasHeight)}" aria-hidden="true"><img src="${escapeAttr(displayMediaUrl(media))}" alt="" draggable="false"></div>`;
    }).join('');
    list.innerHTML = items.slice().reverse().map(item => {
        const media = imageForDisplay(item.media);
        const name = item.role === 'base' ? tr('smart.layerDecompositionBase') : media.name || tr('smart.layerDecomposition');
        const nameBinding = item.role === 'base' ? ' data-i18n="smart.layerDecompositionBase"' : '';
        const visibilityKey = item.hidden ? 'smart.layerShow' : 'smart.layerHide';
        return `<div class="layer-decomposition-editor-layer${item.hidden ? ' is-hidden' : ''}" role="listitem">
            <span class="layer-decomposition-editor-layer-thumb"><img src="${escapeAttr(displayMediaUrl(media))}" alt="" draggable="false"></span>
            <span class="layer-decomposition-editor-layer-name" title="${escapeAttr(name)}"${nameBinding}>${escapeHtml(name)}</span>
            <span class="layer-decomposition-editor-layer-actions">
                <ic-icon-button type="button" size="s" hierarchy="quiet" icon="preview" label="${escapeAttr(tr(visibilityKey))}" data-i18n-label="${visibilityKey}" data-layer-visibility="${escapeAttr(item.id)}"></ic-icon-button>
                <ic-icon-button type="button" size="s" hierarchy="quiet" tone="danger" icon="delete" label="${escapeAttr(tr('smart.deleteLayer'))}" data-i18n-label="smart.deleteLayer" data-layer-delete="${escapeAttr(item.id)}"></ic-icon-button>
            </span>
        </div>`;
    }).join('');
    if(count) count.textContent = String(items.length);
    refreshIcons();
    return true;
}
function applyLayerDecompositionEditorAction(itemId, action){
    const node = layerDecompositionEditorNode();
    const index = (node?.layerDecompositionItems || []).findIndex(item => item?.id === itemId);
    if(!node || index < 0 || !['visibility','delete'].includes(action)) return;
    imageStudioMutationModule.history({action:'push'});
    if(action === 'visibility') node.layerDecompositionItems[index].hidden = !node.layerDecompositionItems[index].hidden;
    else node.layerDecompositionItems.splice(index,1);
    renderLayerDecompositionEditor();
    if(typeof render === 'function') render({syncVirtualization:false,nodeIds:[node.id]});
    imageStudioPersistenceModule.schedule();
}
document.getElementById('layerDecompositionEditorList')?.addEventListener('click', event => {
    const button = event.target.closest?.('[data-layer-visibility],[data-layer-delete]');
    if(!button) return;
    const visibilityId = button.dataset.layerVisibility || '';
    const itemId = visibilityId || button.dataset.layerDelete || '';
    event.preventDefault();
    event.stopPropagation();
    applyLayerDecompositionEditorAction(itemId, visibilityId ? 'visibility' : 'delete');
});
document.getElementById('layerDecompositionPsdDownload')?.addEventListener('click', () => {
    const node = layerDecompositionEditorNode();
    if(!node) return;
    void imageStudioLayeredPsdModule.download({
        canvasId,
        nodeId:node.id,
    });
});
function resetLayerDecompositionEditorPresentation(){
    imageEditModal?.classList.remove('layer-decomposition-edit-mode');
    document.getElementById('layerDecompositionEditor')?.setAttribute('hidden','');
    layerDecompositionEditNodeId = '';
}
function openLayerDecompositionEditor({nodeId}={}){
    const node = nodes.find(candidate => candidate.id === nodeId && candidate.type === 'smart-layer-decomposition');
    if(!node) return false;
    layerDecompositionEditNodeId = node.id;
    imageEditMode = 'layer-decomposition';
    cropState = null;
    selectedId = node.id;
    selectedIds = [];
    selectedImage = {nodeId:'',index:-1};
    const dialogWasOpen = imageStudioDialogPresented();
    imageEditModal.classList.remove('image-preview-mode', 'video-preview-mode');
    imageEditModal.classList.add('open', 'layer-decomposition-edit-mode');
    document.getElementById('layerDecompositionEditor')?.removeAttribute('hidden');
    document.getElementById('imageEditCommitActions')?.setAttribute('hidden','');
    renderLayerDecompositionEditor();
    if(!dialogWasOpen){
        if(typeof imageEditModal.show === 'function') void imageEditModal.show();
        else imageEditModal.setAttribute('open', '');
    }
    return true;
}
function openImageEditor(nodeId, imageIndex=0, options={}){
    const node = nodes.find(n => n.id === nodeId);
    const image = imageForDisplay(node?.images?.[imageIndex]);
    if(!image?.url) return;
    const kind = mediaKindForItem(image);
    if(kind !== 'image' && kind !== 'video'){
        downloadPreviewFile(image);
        return;
    }
    resetLayerDecompositionEditorPresentation();
    const dialogWasOpen = imageStudioDialogPresented();
    const previousPreviewVideo = document.getElementById('previewCurrentVideo');
    if(dialogWasOpen && typeof window.smartPlaybackBeforePreviewSwitch === 'function'){
        window.smartPlaybackBeforePreviewSwitch(previousPreviewVideo);
    }
    const dialogHidePending = !imageEditModal.classList.contains('open')
        && dialogWasOpen;
    imageStudioReopenAfterHide = dialogHidePending;
    const previewSwitch = options.previewSwitch === true && dialogWasOpen && imageEditMode === 'preview';
    selectedId = nodeId;
    selectedImage = {nodeId, index:imageIndex};
    previewNavState = {
        nodeId,
        index:imageIndex,
        count:(node.images || []).filter(img => img?.url).length,
        ...(options.navContext || {})
    };
    cropState = {nodeId, imageIndex, x:0, y:0, w:0, h:0};
    setImageStudioSourceState(kind === 'image' ? 'loading' : 'original-ready');
    gridCustomMode = false; gridCustomLines = []; gridCustomHistory = []; gridCustomDrag = null; gridCustomOrientation = 'h';
    gridOperationMode = 'split'; gridJoinLayout = null; gridJoinDrag = null; gridJoinImageCache = new Map(); gridJoinUserMoved = false; gridJoinGroupId = '';
    imageEditZoom = 1.0; imageEditBaseW = 0; imageEditBaseH = 0; imageResizeScale = 0.5; imageEditModeTouched = false;
    cropAspectPreset = 'free'; cropAspectRatio = null; syncCropRatioButtons();
    editTextItems = []; editTextSelectedId = ''; editTextDrag = null; editTextDirty = false;
    setImageStudioToggleState('gridCustomToggle', false);
    syncGridCustomControls();
    syncGridOperationControls();
    ['gridHorizontalLines','gridVerticalLines'].forEach(id => { const el = document.getElementById(id); if(el) el.disabled = false; });
    setImageStudioControlValue('gridOrientationControl', 'h');
    syncGridCustomUndoBtn(); updateZoomLabel();
    const img = document.getElementById('cropImage');
    img.style.width = ''; img.style.height = ''; img.style.maxWidth = ''; img.style.maxHeight = '';
    imageEditModal.classList.add('open');
    if(!dialogWasOpen && !dialogHidePending){
        if(typeof imageEditModal.show === 'function') void imageEditModal.show();
        else imageEditModal.setAttribute('open', '');
    }
    previewCompareOn = false;
    previewCompareIndex = -1;
    disposePanoramaPreview();
    if(!previewSwitch) resetPreviewTransform();
    if(kind === 'video'){
        const previewVideo = document.getElementById('previewCurrentVideo');
        img.onload = null;
        img.onerror = null;
        img.removeAttribute('src');
        delete img.dataset.proxyFallbackTried;
        if(previewSwitch){
            refreshComparePanel();
            updatePreviewNavButtons();
        } else {
            setImageEditMode('preview');
            updatePreviewNavButtons();
            refreshIcons();
        }
        const loopEnabled = typeof window.smartPlaybackPreparePreviewVideo === 'function'
            ? window.smartPlaybackPreparePreviewVideo(previewVideo, nodeId, imageIndex, {previewSwitch})
            : true;
        if(previewVideo && typeof window.smartPlaybackPreparePreviewVideo !== 'function') previewVideo.loop = true;
        syncPreviewVideoLoopControl(loopEnabled);
        return;
    }
    const primaryEditorSrc = displayMediaUrl(image);
    const editorSrcToken = `${nodeId}:${imageIndex}:${Date.now()}`;
    img.dataset.editorSrcToken = editorSrcToken;
    img.dataset.editorQuick = '';
    const editorRequestIsCurrent = () => (
        cropState?.nodeId === nodeId
        && cropState?.imageIndex === imageIndex
        && imageStudioDialogOpen()
        && img.dataset.editorSrcToken === editorSrcToken
    );
    img.onload = () => {
        if(!editorRequestIsCurrent()) return;
        const targetImage = node.images?.[imageIndex];
        setImageStudioSourceState('original-ready');
        if(targetImage && img.naturalWidth && img.naturalHeight && (!targetImage.natural_w || !targetImage.natural_h)){
            targetImage.natural_w = img.naturalWidth;
            targetImage.natural_h = img.naturalHeight;
            imageStudioPersistenceModule.schedule();
        }
        imageEditBaseW = img.clientWidth; imageEditBaseH = img.clientHeight;
        updateZoomLabel(); syncImageResizeControls(); resizeEditDrawCanvas(); resetEditDrawingHistory(); clearEditDrawing(true); resetCropBox();
        if(previewSwitch) refreshComparePanel();
        else if(!imageEditModeTouched) setImageEditMode('preview');
        else refreshComparePanel();
        syncImageEditOverflow();
        if(!previewSwitch) refreshIcons();
    };
    img.onerror = () => {
        if(!editorRequestIsCurrent()) return;
        setImageStudioSourceState('failed');
    };
    // 不设 crossOrigin：displayMediaUrl 已把所有地址收敛为同源（http 走本地代理），同源图片不会污染画布，
    // 裁剪/涂抹等导出操作照常可用。而带 crossOrigin 会让浏览器对“缩略图已无 CORS 缓存的同源图”重新发起
    // CORS 请求并失败——表现就是预览先闪一下（命中缓存）随即变成破损图。
    img.removeAttribute('crossorigin');
    img.src = primaryEditorSrc;
    if(previewSwitch){
        refreshComparePanel();
        updatePreviewNavButtons();
    } else {
        setImageEditMode('preview');
        updatePreviewNavButtons();
        refreshIcons();
    }
}
function closeImageEditor(options={}){
    imageStudioReopenAfterHide = false;
    cleanupSmartLogPreviewNode();
    imageStudioTransitionRequest += 1;
    imageStudioSharedTransition?.animation?.cancel();
    imageStudioSharedTransition?.cleanup?.();
    imageStudioSharedTransition = null;
    imageEditModal.classList.remove('open');
    imageEditModal.classList.remove('video-preview-mode', 'image-preview-mode');
    resetLayerDecompositionEditorPresentation();
    if(!options.dialogAlreadyHidden){
        if(typeof imageEditModal.hide === 'function' && imageEditModal.open) void imageEditModal.hide(options.reason || 'cancel');
        else imageEditModal.removeAttribute('open');
    }
    const img = document.getElementById('cropImage');
    const previewImage = document.getElementById('previewCurrentImage');
    const compareImage = document.getElementById('previewCompareImage');
    const previewVideo = document.getElementById('previewCurrentVideo');
    if(
        previewVideo
        && previewVideo.style.display !== 'none'
        && typeof window.smartPlaybackClosePreviewVideo === 'function'
    ){
        window.smartPlaybackClosePreviewVideo(
            previewVideo,
            cropState?.nodeId || previewNavState.nodeId,
            Number(cropState?.imageIndex ?? previewNavState.index ?? 0)
        );
    }
    img.onload = null; img.onerror = null; img.removeAttribute('src'); delete img.dataset.proxyFallbackTried; delete img.dataset.editorSrcToken; delete img.dataset.editorQuick; img.style.width = ''; img.style.height = ''; img.style.maxWidth = ''; img.style.maxHeight = '';
    [previewImage, compareImage].forEach(image => {
        if(!image) return;
        image.onload = null;
        image.onerror = null;
        image.removeAttribute('src');
        image.removeAttribute('data-preview-src-token');
    });
    setImageStudioSourceState('idle');
    img.style.position = ''; img.style.left = ''; img.style.top = '';
    if(previewVideo){
        previewVideo.pause?.();
        previewVideo.loop = false;
        syncPreviewVideoLoopControl(false);
        previewVideo.onloadedmetadata = null;
        previewVideo.onloadeddata = null;
        previewVideo.removeAttribute('src');
        previewVideo.load?.();
        previewVideo.style.display = 'none';
    }
    clearEditDrawing(true);
    cropState = null; cropDrag = null; editDrawState = null; resetEditDrawingHistory(); gridCustomDrag = null; gridJoinDrag = null; gridJoinLayout = null; gridJoinImageCache = new Map(); gridJoinUserMoved = false; gridOperationMode = 'split'; gridJoinGroupId = '';
    previewNavState = {nodeId:'', index:0, count:0};
    imageEditZoom = 1.0; imageEditBaseW = 0; imageEditBaseH = 0; imageResizeScale = 0.5; imageEditModeTouched = false;
    cropAspectPreset = 'free'; cropAspectRatio = null; syncCropRatioButtons();
    disposePanoramaPreview();
    previewPanDrag = null; previewCompareDrag = false; imageEditPanDrag = null; resetPreviewTransform();
    document.getElementById('imageEditStage')?.classList.remove('overflow-x', 'overflow-y', 'preview-mode');
    const cropCanvasEl = document.getElementById('cropCanvas');
    cropCanvasEl?.classList.remove('grid-custom-h', 'grid-custom-v', 'dragging-image', 'text-mode', 'resize-mode');
    cropCanvasEl?.classList.remove('grid-join-mode');
    document.getElementById('cropImage')?.classList.remove('grid-join-hidden');
    const joinCanvas = document.getElementById('gridJoinCanvas');
    if(joinCanvas){ joinCanvas.innerHTML = ''; joinCanvas.style.display = 'none'; joinCanvas.style.width = ''; joinCanvas.style.height = ''; }
    if(cropCanvasEl){ cropCanvasEl.style.width = ''; cropCanvasEl.style.height = ''; }
    const textCanvas = editTextCanvas();
    if(textCanvas){ textCanvas.style.left = ''; textCanvas.style.top = ''; }
    updatePreviewNavButtons();
}
function cancelImageEdit(){
    if(imageEditMode === 'preview') return;
    setImageEditMode('preview', true);
}
imageEditModal?.addEventListener('ic-after-hide', () => {
    if(imageStudioReopenAfterHide && imageEditModal.classList.contains('open')){
        imageStudioReopenAfterHide = false;
        if(typeof imageEditModal.show === 'function') void imageEditModal.show();
        else imageEditModal.setAttribute('open', '');
        return;
    }
    if(!imageEditModal.open && !imageEditModal.hasAttribute('open') && imageEditModal.classList.contains('open')){
        closeImageEditor({dialogAlreadyHidden:true, reason:'dialog'});
    }
});
function clampCrop(){
    if(!cropState) return;
    const {w, h} = cropBounds();
    cropState.w = Math.max(24, Math.min(cropState.w, w)); cropState.h = Math.max(24, Math.min(cropState.h, h));
    cropState.x = Math.max(0, Math.min(cropState.x, w - cropState.w)); cropState.y = Math.max(0, Math.min(cropState.y, h - cropState.h));
}
function beginCropDrag(event, mode){
    if(!cropState) return;
    event.preventDefault(); event.stopPropagation();
    cropDrag = {mode, sx:event.clientX, sy:event.clientY, start:{...cropState}};
}
function resizeCropFromDrag(dx, dy){
    const start = cropDrag?.start;
    if(!start) return;
    const handle = String(cropDrag.mode || 'resize').replace(/^crop-/, '') || 'se';
    const next = imageStudioGeometry.resizeCrop({
        bounds:cropBounds(),
        start,
        dx,
        dy,
        ratio:cropAspectRatio,
        handle
    });
    Object.assign(cropState, next);
}
async function uploadCroppedBlob(blob, name){
    const form = new FormData();
    form.append('files', blob, name);
    try {
        const response = await fetch('/api/ai/upload', {method:'POST', body:form});
        const data = await response.json().catch(() => ({}));
        const file = data.files?.[0];
        if(!response.ok || !file?.url){
            throw new Error(data.detail || tr('smart.toastUploadFail'));
        }
        return file;
    } catch(error) {
        toast((error?.message || tr('smart.toastUploadFail')).slice(0, 120), {tone:'danger'});
        return null;
    }
}
async function uploadImageBlobs(blobs){
    const form = new FormData();
    blobs.forEach(item => form.append('files', item.blob, item.name));
    try {
        const response = await fetch('/api/ai/upload', {method:'POST', body:form});
        const data = await response.json().catch(() => ({}));
        const files = Array.isArray(data.files) ? data.files : [];
        if(!response.ok || files.length !== blobs.length || files.some(file => !file?.url)){
            throw new Error(data.detail || tr('smart.toastUploadFail'));
        }
        return files;
    } catch(error) {
        toast((error?.message || tr('smart.toastUploadFail')).slice(0, 120), {tone:'danger'});
        return [];
    }
}
function replaceEditedImage(file, extra={}){
    const {node, index} = currentEditImage();
    if(!node || !file) return false;
    return Boolean(imageStudioMutationModule.update({
        nodeId:node.id,
        mutate(target){
            target.images[index] = {...(target.images[index] || {}), url:file.url, name:file.name, kind:file.kind || mediaKindForItem(file), natural_w:0, natural_h:0, ...extra};
            if((target.images || []).length === 1){
                delete target.w;
                delete target.h;
                delete target.generationMediaW;
                delete target.generationMediaH;
            }
        },
        options:{imageIndex:index,reveal:true}
    }));
}
function finishImageStudioCommit(nodeId, imageIndex=0){
    const node = nodes.find(candidate => candidate.id === nodeId);
    if(!node) return false;
    selectedId = node.id;
    selectedIds = [];
    selectedImage = {nodeId:node.id,index:Number(imageIndex) || 0};
    closeImageEditor({reason:'accepted'});
    return true;
}
async function applyImageCrop(){
    if(!cropState) return;
    const {node, image} = currentEditImage();
    const img = document.getElementById('cropImage');
    if(!node || !image || !img.naturalWidth || !img.naturalHeight) return;
    const scaleX = img.naturalWidth / (img.clientWidth || 1), scaleY = img.naturalHeight / (img.clientHeight || 1);
    const sx = Math.max(0, Math.round(cropState.x * scaleX)), sy = Math.max(0, Math.round(cropState.y * scaleY));
    const sw = Math.max(1, Math.round(cropState.w * scaleX)), sh = Math.max(1, Math.round(cropState.h * scaleY));
    const canvasEl = document.createElement('canvas');
    canvasEl.width = sw; canvasEl.height = sh;
    canvasEl.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    const base = (image.name || 'image').replace(/\.[^.]+$/, '');
    const file = blob ? await uploadCroppedBlob(blob, `${base}_crop.png`) : null;
    if(file && replaceEditedImage(file)) finishImageStudioCommit(node.id, Number(cropState.imageIndex || 0));
}
async function applyImageMask(){
    if(!cropState || !editCanvasHasPixels()) return;
    const {node, image} = currentEditImage();
    if(!node || !image) return;
    const mask = maskCanvasFromDrawCanvas(editDrawCanvas());
    const blob = await new Promise(resolve => mask.toBlob(resolve, 'image/png'));
    const base = (image.name || 'image').replace(/\.[^.]+$/, '');
    const file = blob ? await uploadCroppedBlob(blob, `${base}_mask.png`) : null;
    if(file){
        const outputNode = imageStudioMutationModule.create({
            kind:'image',
            data:{images:[{url:file.url,name:file.name,kind:'image',role:'mask'}]},
            options:{
                placement:{
                    anchor:{kind:'source',sourceNodeId:node.id},
                    relation:'downstream',
                    arrangement:'single'
                },
                reveal:true
            }
        });
        if(outputNode) finishImageStudioCommit(outputNode.id, 0);
    }
}
function maskCanvasFromDrawCanvas(src){
    const mask = document.createElement('canvas');
    mask.width = src.width;
    mask.height = src.height;
    const srcCtx = src.getContext('2d');
    const srcData = srcCtx.getImageData(0, 0, src.width, src.height);
    const ctx = mask.getContext('2d');
    const out = ctx.createImageData(mask.width, mask.height);
    for(let i = 0; i < srcData.data.length; i += 4){
        const painted = srcData.data[i + 3] > 8;
        const v = painted ? 255 : 0;
        out.data[i] = v;
        out.data[i + 1] = v;
        out.data[i + 2] = v;
        out.data[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    return mask;
}
async function applyImageBrush(){
    if(!cropState) return;
    removeEditTextInlineEditor(true);
    if(!editCanvasHasPixels()) return;
    const {node, image} = currentEditImage();
    const img = document.getElementById('cropImage');
    if(!node || !image || !img.naturalWidth || !img.naturalHeight) return;
    const canvasEl = document.createElement('canvas');
    canvasEl.width = img.naturalWidth; canvasEl.height = img.naturalHeight;
    const ctx = canvasEl.getContext('2d');
    ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height); ctx.drawImage(editDrawCanvas(), 0, 0); ctx.drawImage(editTextCanvas(), 0, 0);
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    const base = (image.name || 'image').replace(/\.[^.]+$/, '');
    const file = blob ? await uploadCroppedBlob(blob, `${base}_paint.png`) : null;
    if(file && replaceEditedImage(file)) finishImageStudioCommit(node.id, Number(cropState.imageIndex || 0));
}
async function applyImageGridSplit(){
    if(!cropState) return;
    if(gridOperationMode === 'join') return applyImageGridJoin();
    const {node, image} = currentEditImage();
    const img = document.getElementById('cropImage');
    if(!node || !image || !img.naturalWidth || !img.naturalHeight) return;
    const rects = gridSplitRects(img.naturalWidth, img.naturalHeight).sort((a, b) => (Number(a.row || 0) - Number(b.row || 0)) || (Number(a.col || 0) - Number(b.col || 0)));
    if(!rects.length) return;
    const base = safeExportFileName((downloadNameForMediaItem(image, 'image') || 'image').replace(/\.[^.]+$/, ''), 'image');
    const digits = String(rects.length).length;
    const blobs = [];
    for(let i = 0; i < rects.length; i++){
        const rect = rects[i];
        const canvasEl = document.createElement('canvas');
        canvasEl.width = rect.w; canvasEl.height = rect.h;
        canvasEl.getContext('2d').drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
        const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
        const order = String(i + 1).padStart(digits, '0');
        if(blob) blobs.push({blob, name:`${base}_${order}_r${rect.row + 1}_c${rect.col + 1}.png`});
    }
    const files = await uploadImageBlobs(blobs);
    if(files.length){
        const layout = gridLayoutFromRects(rects);
        const outputNode = imageStudioMutationModule.create({
            kind:'image',
            data:{
                images:files.map((file, i) => ({
                    url:file.url,
                    name:file.name,
                    grid:{
                        ...layout,
                        row:rects[i]?.row || 0,
                        col:rects[i]?.col || 0,
                        w:rects[i]?.w || 1,
                        h:rects[i]?.h || 1
                    }
                }))
            },
            options:{
                placement:{anchor:{kind:'source',sourceNodeId:node.id},relation:'downstream',arrangement:'single'},
                reveal:true
            }
        });
        outputNode.title = tr('smart.gridSplit');
        finishImageStudioCommit(outputNode.id, 0);
    }
}
function loadGridJoinImage(entry){
    const cached = gridJoinImageCache.get(entry.index);
    if(cached?.complete && cached.naturalWidth) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            gridJoinImageCache.set(entry.index, img);
            resolve(img);
        };
        img.onerror = () => {
            if(img.dataset.proxyFallbackTried === '1'){
                reject(new Error(tr('smart.imageLoadFailed')));
                return;
            }
            const fallback = proxiedMediaUrl(entry.item);
            if(!fallback || fallback === img.src){
                reject(new Error(tr('smart.imageLoadFailed')));
                return;
            }
            img.dataset.proxyFallbackTried = '1';
            img.src = fallback;
        };
        img.src = displayMediaUrl(entry.item);
    });
}
function drawImageCover(ctx, img, dx, dy, dw, dh){
    const sw = Math.max(1, Number(img?.naturalWidth || img?.videoWidth || img?.width || 1));
    const sh = Math.max(1, Number(img?.naturalHeight || img?.videoHeight || img?.height || 1));
    const targetW = Math.max(1, Number(dw || 1));
    const targetH = Math.max(1, Number(dh || 1));
    const scale = Math.max(targetW / sw, targetH / sh);
    const cropW = Math.max(1, targetW / scale);
    const cropH = Math.max(1, targetH / scale);
    const sx = Math.max(0, (sw - cropW) / 2);
    const sy = Math.max(0, (sh - cropH) / 2);
    ctx.drawImage(img, sx, sy, cropW, cropH, dx, dy, targetW, targetH);
}
async function applyImageGridJoin(){
    const {node, image} = currentEditImage();
    const items = currentGridJoinItems();
    if(!node || items.length <= 1){ toast(tr('smart.openJoinFromGroup')); return; }
    const layout = ensureGridJoinLayout();
    if(!layout?.items?.length) return;
    const size = gridJoinCanvasSize(layout);
    const targetLong = Math.max(256, Number(gridJoinOutputSize) || 2048);
    const outputScale = Math.max(1, targetLong / Math.max(1, Math.max(size.w, size.h)));
    const canvasEl = document.createElement('canvas');
    canvasEl.width = Math.max(1, Math.round(size.w * outputScale));
    canvasEl.height = Math.max(1, Math.round(size.h * outputScale));
    const ctx = canvasEl.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
    const byIndex = new Map(items.map(entry => [entry.index, entry]));
    for(const item of layout.items || []){
        const entry = byIndex.get(item.index);
        if(!entry) continue;
        const img = await loadGridJoinImage(entry);
        drawImageCover(ctx, img, Math.round(item.x * outputScale), Math.round(item.y * outputScale), Math.round(item.w * outputScale), Math.round(item.h * outputScale));
    }
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    const base = safeExportFileName((downloadNameForMediaItem(image || items[0]?.item, 'image') || 'image').replace(/\.[^.]+$/, ''), 'image');
    const file = blob ? await uploadCroppedBlob(blob, `${base}_join.png`) : null;
    if(file){
        const outputNode = imageStudioMutationModule.create({
            kind:'image',
            data:{images:[{
                url:file.url,
                name:file.name,
                kind:'image',
                natural_w:canvasEl.width,
                natural_h:canvasEl.height
            }]},
            options:{
                placement:{anchor:{kind:'source',sourceNodeId:node.id},relation:'downstream',arrangement:'single'},
                reveal:true
            }
        });
        outputNode.title = tr('smart.gridJoin');
        finishImageStudioCommit(outputNode.id, 0);
        toast(tr('smart.joinOutputDone'));
    }
}
async function applyImageResize(){
    if(!cropState) return;
    const {node, image} = currentEditImage();
    if(!node || !image) return;
    let resized = null;
    try {
        resized = await resizedImageBlobFromEditor();
    } catch(err) {
        toast(tr('smart.resizeWriteFailed'));
        return;
    }
    if(!resized?.blob) return;
    const base = safeExportFileName((downloadNameForMediaItem(image, 'image') || image.name || 'image').replace(/\.[^.]+$/, ''), 'image');
    const suffix = `${Math.round(resized.scale * 100)}pct`;
    const file = await uploadCroppedBlob(resized.blob, `${base}_resize_${suffix}.png`);
    if(!file) return;
    if(!replaceEditedImage(file, {kind:'image', role:image.role || '', natural_w:resized.targetW, natural_h:resized.targetH})){
        return;
    }
    finishImageStudioCommit(node.id, Number(cropState.imageIndex || 0));
}
function applyImageEdit(){
    if(imageEditMode === 'preview') return;
    if(imageStudioSourceState !== 'original-ready'){
        toast(tr('smart.originalRequired'));
        return;
    }
    if(imageEditMode === 'mask') return applyImageMask();
    if(imageEditMode === 'brush') return applyImageBrush();
    if(imageEditMode === 'resize') return applyImageResize();
    if(imageEditMode === 'grid') return applyImageGridSplit();
    return applyImageCrop();
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.imageStudio = Object.freeze({
    isOpen(){
        return imageStudioDialogOpen();
    },
    current(){
        const {node, index, image} = currentEditImage();
        if(!node || !image) return null;
        return {
            nodeId:String(node.id || ''),
            imageIndex:Math.max(0, Number(index || 0)),
            kind:String(mediaKindForItem(image) || ''),
            sourceReady:Boolean(
                image?.url
                && imageStudioSourceState === 'original-ready'
            ),
        };
    },
    open({nodeId, imageIndex=0, mode='preview', groupAware=true}={}){
        if(mode === 'layer-decomposition') return openLayerDecompositionEditor({nodeId});
        if(mode === 'preview'){
            return groupAware
                ? openImagePreviewSmart(nodeId, imageIndex)
                : openImagePreview(nodeId, imageIndex);
        }
        openImageEditor(nodeId, imageIndex);
        if(imageStudioDialogOpen()) setImageEditMode(mode, true);
    },
    openGroup({group, startNodeId='', startIndex=0, mode='preview'}={}){
        if(mode === 'grid-join') return openGroupGridJoin(group);
        return openGroupImagePreview(group, startNodeId, startIndex);
    },
    close(){
        return closeImageEditor();
    },
});
