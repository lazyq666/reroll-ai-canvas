const params = new URLSearchParams(location.search);
const canvasId = params.get('id') || '';
const smartCanvasNodeReviewMode = params.get('componentReview') === 'nodes';
const sourceProjectId = params.get('project') || '';
const CANVAS_LIST_PROJECT_KEY = 'canvasListCurrentProjectId';
const SMART_IMAGE_PERFORMANCE_STORAGE_KEY = 'smartCanvasImagePerformanceOptimization';
const SMART_CANVAS_ZOOM_SPEED_STORAGE_KEY = 'smartCanvasZoomSpeed';
const SMART_CANVAS_PAN_SPEED_STORAGE_KEY = 'smartCanvasPanSpeed';
const SMART_CANVAS_DOCK_POSITION_STORAGE_KEY = 'smartCanvasDockPosition';
const SMART_CANVAS_KEYBOARD_ZOOM_FACTOR = 1.2;
function storedSmartCanvasSpeed(key){
    try {
        const value = Number(localStorage.getItem(key));
        return Number.isFinite(value) && value >= .5 && value <= 2 ? value : 1;
    } catch(e) {
        return 1;
    }
}
let smartImagePerformanceOptimization = (() => {
    try { return localStorage.getItem(SMART_IMAGE_PERFORMANCE_STORAGE_KEY) !== 'off'; }
    catch(e) { return true; }
})();
let smartCanvasZoomSpeed = storedSmartCanvasSpeed(SMART_CANVAS_ZOOM_SPEED_STORAGE_KEY);
let smartCanvasPanSpeed = storedSmartCanvasSpeed(SMART_CANVAS_PAN_SPEED_STORAGE_KEY);
let smartCanvasDockPosition = (() => {
    try { return localStorage.getItem(SMART_CANVAS_DOCK_POSITION_STORAGE_KEY) === 'bottom' ? 'bottom' : 'left'; }
    catch(e) { return 'left'; }
})();
const shell = document.getElementById('shell');
const world = document.getElementById('world');
const composer = document.getElementById('composer');
const composerFocusBackdrop = document.getElementById('composerFocusBackdrop');
const composerFocusToggle = document.getElementById('composerFocusToggle');
const promptNodeFocusSurface = document.getElementById('promptNodeFocusSurface');
const smartNodeFloatingPortal = document.getElementById('smartNodeFloatingPortal');
const smartMultiSelectionBox = document.getElementById('smartMultiSelectionBox');
const createMenu = document.getElementById('createMenu');
const referenceGenerateMenu = document.getElementById('referenceGenerateMenu');
const multiReferenceGenerateMenu = document.getElementById('multiReferenceGenerateMenu');
const upstreamInputMenu = document.getElementById('upstreamInputMenu');
const promptInput = document.getElementById('promptInput');
const mentionPicker = document.getElementById('mentionPicker');
const mentionPreview = document.getElementById('mentionPreview');
const referenceViewerBackdrop = document.getElementById('referenceViewerBackdrop');
const referenceViewerTitle = document.getElementById('referenceViewerTitle');
const referenceViewerContent = document.getElementById('referenceViewerContent');
const referenceViewerClose = document.getElementById('referenceViewerClose');
const engineSelect = document.getElementById('engineSelect');
const dynamicParams = document.getElementById('dynamicParams');
const runBtn = document.getElementById('runBtn');
const fileInput = document.getElementById('fileInput');
const referenceFileInput = document.getElementById('referenceFileInput');
const apiKindToggle = document.getElementById('apiKindToggle');
const apiKindIcon = document.getElementById('apiKindIcon');
const apiKindLabel = document.getElementById('apiKindLabel');
const inputThumbsRow = document.getElementById('inputThumbsRow');
const inputTextPreviewTooltip = document.getElementById('inputTextPreviewTooltip');
const SMART_UPLOAD_MAX = 20;
const SMART_UPLOAD_MAX_BYTES = 500 * 1024 * 1024;
const SMART_REFERENCE_IMAGE_MAX = 20;
const minimap = document.getElementById('minimap');
const nodeKinds = window.SmartCanvasModules?.nodeKinds;
if(!nodeKinds) throw new Error('Node Kinds Module failed to load');
function smartCanvasNodeComponentFamily(){
    const family = window.InfiniteCanvasUiNodeComponents;
    if(!family?.render) throw new Error('Canvas Node Component Family failed to load');
    return family;
}
const nodeGeometry = window.SmartCanvasModules?.nodeGeometry;
if(!nodeGeometry) throw new Error('Node Geometry Module failed to load');
const canvasLevelOfDetail = window.SmartCanvasModules?.canvasLevelOfDetail;
if(!canvasLevelOfDetail) throw new Error('Canvas Level of Detail Module failed to load');
const canvasFarPresentation = window.SmartCanvasModules?.canvasFarPresentation;
if(!canvasFarPresentation) throw new Error('Canvas Far Presentation Module failed to load');
const canvasVirtualization = window.SmartCanvasModules?.canvasVirtualization;
if(!canvasVirtualization) throw new Error('Canvas Virtualization Module failed to load');
const canvasPersistence = window.SmartCanvasModules?.canvasPersistence;
if(!canvasPersistence) throw new Error('Canvas Persistence Module failed to load');
const canvasMutation = window.SmartCanvasModules?.canvasMutation;
if(!canvasMutation) throw new Error('Canvas Mutation Module failed to load');
const smartContainer = window.SmartCanvasModules?.smartContainer;
if(!smartContainer) throw new Error('Smart Container Module failed to load');
const canvasInteraction = window.SmartCanvasModules?.canvasInteraction;
const clickSparkFeedback = window.SmartCanvasModules?.clickSparkFeedback;
if(!canvasInteraction) throw new Error('Canvas Interaction Module failed to load');
const imageStudio = window.SmartCanvasModules?.imageStudio;
if(!imageStudio) throw new Error('Image Studio Module failed to load');
const promptAuthoring = window.SmartCanvasModules?.promptAuthoring;
if(!promptAuthoring) throw new Error('Prompt Authoring Module failed to load');
const smartMatting = window.SmartCanvasModules?.smartMatting;
if(!smartMatting) throw new Error('Smart Matting Module failed to load');
const smartDepthMap = window.SmartCanvasModules?.smartDepthMap;
if(!smartDepthMap) throw new Error('Smart Depth Map Module failed to load');
const generationRun = window.SmartCanvasModules?.generationRun;
if(!generationRun) throw new Error('Generation Run Module failed to load');
const aiProcessorGeometry = window.SmartCanvasModules?.aiProcessorGeometry;
if(!aiProcessorGeometry) throw new Error('AI Processor Geometry Module failed to load');
const generationFailureFeedback = window.SmartCanvasModules?.generationFailureFeedback;
if(!generationFailureFeedback) throw new Error('Generation Failure Feedback Module failed to load');
const generationLogModal = window.SmartCanvasModules?.generationLogModal;
if(!generationLogModal) throw new Error('Generation Log Modal Module failed to load');
const generationFailureAlertQueue = document.getElementById('generationFailureAlertQueue');
const generationFailureAlertStates = new Map();
const pendingGenerationFailureAlerts = [];
let generationFailureAlertStack = null;
const generationFailureAlertStackReady = import('/static/js/infinite-canvas-ui/feedback-progress/stacked-feedback-queue.js?v=ic-ui-ef410096e2b4')
    .then(({createStackedFeedbackQueue}) => {
        generationFailureAlertStack = createStackedFeedbackQueue({
            edge:'start',
            visibleCount:3,
            stackStepPx:19,
            scaleStep:.045,
            exitDuration:200,
            setPresented(alert, visible){
                alert.toggleAttribute('data-ic-stack-hidden', !visible);
            },
            onChange({items, visible}){
                if(!generationFailureAlertQueue) return;
                generationFailureAlertQueue.dataset.queueLength = String(items.length);
                generationFailureAlertQueue.dataset.visibleCount = String(visible.length);
            }
        });
        pendingGenerationFailureAlerts.splice(0).forEach(alert => {
            if(alert.isConnected && generationFailureAlertStates.has(alert)) {
                generationFailureAlertStack.enqueue(alert);
            }
        });
        return generationFailureAlertStack;
    });
const generationRecovery = window.SmartCanvasModules?.generationRecovery;
if(!generationRecovery) throw new Error('Generation Recovery Module failed to load');
const smartLogModal = document.getElementById('smartLogModal');
const smartLogList = document.getElementById('smartLogList');
const smartShortcutDialog = document.getElementById('smartShortcutDialog');
const smartShortcutSettingsAction = document.getElementById('smartShortcutSettingsAction');
const smartCanvasDock = document.getElementById('smartCanvasDock');
const smartCanvasDockDivider = smartCanvasDock?.querySelector('.smart-canvas-dock-divider');
const smartCanvasDockPositionControl = document.getElementById('smartCanvasDockPositionControl');
const smartGenerationBatchLayoutControl = document.getElementById('smartGenerationBatchLayoutControl');
const smartPointerTool = document.getElementById('smartPointerTool');
const smartHandTool = document.getElementById('smartHandTool');
const smartBrushTool = document.getElementById('smartBrushTool');
const smartTextTool = document.getElementById('smartTextTool');
const smartFrameTool = document.getElementById('smartFrameTool');
const smartBrushOptions = document.getElementById('smartBrushOptions');
const smartTextOptions = document.getElementById('smartTextOptions');
const smartSettingsToggle = document.getElementById('smartSettingsToggle');
const smartSettingsPanel = document.getElementById('smartSettingsPanel');
const smartCanvasThemeToggle = document.getElementById('smartCanvasThemeToggle');
const smartShortcutSettingsShortcut = document.getElementById('smartShortcutSettingsShortcut');
const smartImagePerformanceToggle = document.getElementById('smartImagePerformanceToggle');
const smartCanvasZoomSpeedInput = document.getElementById('smartCanvasZoomSpeed');
const smartCanvasPanSpeedInput = document.getElementById('smartCanvasPanSpeed');
const smartAnnotationPreview = document.getElementById('smartAnnotationPreview');
const smartAnnotationCursor = document.getElementById('smartAnnotationCursor');
const smartAnnotationCursorSymbol = smartAnnotationCursor?.querySelector('.smart-annotation-cursor-symbol');
const smartAnnotationCursorLabel = smartAnnotationCursor?.querySelector('.smart-annotation-cursor-label');
const smartNodeContextMenu = document.getElementById('smartNodeContextMenu');
const smartContextResultBackdrop = document.getElementById('smartContextResultBackdrop');
const smartContextResultTitle = document.getElementById('smartContextResultTitle');
const smartContextResultStatus = document.getElementById('smartContextResultStatus');
const smartContextResultInputs = document.getElementById('smartContextResultInputs');
const smartContextResultInputList = document.getElementById('smartContextResultInputList');
const smartContextResultText = document.getElementById('smartContextResultText');
const smartContextResultClose = document.getElementById('smartContextResultClose');
const smartContextResultCopy = document.getElementById('smartContextResultCopy');
const smartContextResultCreate = document.getElementById('smartContextResultCreate');
const smartContextResultApply = document.getElementById('smartContextResultApply');

function shortcutPlatform(){
    const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
    return /mac|iphone|ipad|ipod/i.test(platform) ? 'apple' : 'standard';
}
const smartNodeImportInput = document.getElementById('smartNodeImportInput');
const smartNodePackageImportDialog = document.getElementById('smartNodePackageImportDialog');
const selectionBox = document.getElementById('selectionBox');
const promptTemplateDialog = document.getElementById('promptTemplateDialog');
const promptTemplatePanel = document.getElementById('promptTemplatePanel');
const composerTemplateBtn = document.getElementById('composerTemplateBtn');
const promptTemplateDockToggle = document.getElementById('promptTemplateDockToggle');
const workspaceAssetDockToggle = document.getElementById('workspaceAssetDockToggle');
const workspaceAssetDialog = document.getElementById('workspaceAssetDialog');
const workspaceAssetPanel = document.getElementById('workspaceAssetPanel');
let canvas = null;
let canvasUsesConnections = true;
let nodes = [];
let selectedId = '';
let selectedIds = [];
let selectedImage = {nodeId:'', index:-1};
const smartPlaybackSession = {
    canvasId:'',
    entries:new Map(),
    activeMedia:null,
    activeKey:'',
    previewKey:'',
    previewTransfer:null,
    videoPreferences:{volume:1, muted:false, playbackRate:1},
    audioPreferences:{volume:1, muted:false, playbackRate:1}
};
let selectedConnectionKey = '';
let selectedConnectionPoint = null;
let smartBaseTool = 'pointer';
let smartSpacePan = false;
let smartMiddlePan = false;
let smartContextMenuState = null;
let smartContextResultState = null;
let smartAnnotationTool = '';
let smartFrameToolActive = false;
let smartAnnotationOptionsOpen = false;
let smartSettingsOpen = false;
let smartGenerationBatchLayout = 'horizontal';
let smartBrushSize = 6;
let smartBrushColor = '#111827';
let smartTextSize = 'medium';
let smartAnnotationStroke = null;
let suppressSmartAnnotationClickUntil = 0;
let pendingSmartTextEditNodeId = '';
let selectionState = null;
let isRKeyDown = false;
let selectionJustFinished = false;
let llmInstructionResizeState = null;
let promptSplitResizeState = null;
let uploadTargetId = '';
let referenceUploadTargetId = '';
let referenceUploadLimits = null;
let pendingGroupUploadPoint = null;
let mentionRange = null;
let mentionInsertMode = 'token';
let promptQuickTargetEl = null;
let promptQuickTargetNodeId = '';
let promptQuickPickerMode = '';
let promptQuickPickerItems = [];
let promptQuickTrigger = '';
let promptQuickQuery = '';
let promptQuickQueryRaw = '';
let promptQuickComposing = false;
let mentionSourceTab = 'canvas';
let mentionCanvasOffset = 0;
let mentionAssetItems = [];
let mentionAssetCursor = '';
let mentionAssetLoading = false;
let mentionAssetLoaded = false;
let mentionAssetError = '';
let mentionAssetRequest = 0;
let mentionFrozenTargetPoint = null;
let mentionLastQuery = '';
let panState = null;
let didPan = false;
let portDragState = null;
const SMART_PORT_DROP_TARGET_EXPANSION_PX = 24;
let referenceGenerateMenuState = null;
let connectionEraseState = null;
let apiProviders = [];
let availableModels = {image:[], video:[], text:[]};
let comfyWorkflows = [];
let comfyInstanceCount = 1;
const PROMPT_PRESETS_KEY = 'smart_canvas_prompt_presets_v1';
const PROMPT_TEMPLATE_GROUPS_KEY = 'smart_canvas_prompt_template_groups_v1';
const PROMPT_TEMPLATE_OVERRIDES_KEY = 'smart_canvas_prompt_template_overrides_v1';
const SMART_NODE_CLIPBOARD_KEY = 'smart_canvas_node_clipboard_v1';
const smartClipboardOwnership = window.SmartCanvasModules.clipboardOwnership;
// Node copies may cross canvases in the current app session, but must not
// survive an application restart. Remove the former persistent clipboard.
try { localStorage.removeItem(SMART_NODE_CLIPBOARD_KEY); } catch(error) {}
let promptPresets = [];
let builtinPromptTemplates = [];
let promptLibraries = [];
let canvasPromptTemplates = [];
let promptCanvasCommitLane = null;
let promptTemplateSaving = false;
let activePromptLibraryId = 'common';
let aiProcessorDialog = null;
let aiProcessorDialogContext = null;
let promptTemplateGroups = [];
let promptTemplateOverrides = {hiddenBuiltinIds:[], editedBuiltins:{}};
let promptTemplateCategory = 'all';
let promptTemplateSelectedId = '';
let createMenuPoint = {x:0, y:0};
let createMenuGroupId = '';
let nodeClipboard = null;
let nodeClipboardCopyRequested = false;
let imageClickTimer = null;
let suppressImageClickUntil = 0;
let lastMouseWorld = null;
let lastConfigRefreshAt = 0;
let zoomPreviewState = null;
let runTimerInterval = null;
let suppressNodeClickUntil = 0;
let textSelectionGuard = null;
let focusedPromptNodeId = '';
let runningHubWorkflowCache = {};
let comfyWorkflowCache = {};
let viewport = {x:0, y:0, scale:1};
canvasLevelOfDetail.configure({
    enabled:true,
    scale:viewport.scale
});
const MS_GEN_MODELS = {
    zimage: { label:'ZImage', modelId:'Tongyi-MAI/Z-Image-Turbo', supportsImage:false, endpoint:'/generate' },
    qwen_edit: { label:'Qwen Edit', modelId:'Qwen/Qwen-Image-Edit-2511', supportsImage:true, endpoint:'/api/angle/generate' },
    klein_edit: { label:'Klein', modelId:'black-forest-labs/FLUX.2-klein-9B', supportsImage:true, endpoint:'/api/ms/generate' },
    custom: { label:tr('smart.custom'), modelId:'', acceptsImage:true, endpoint:'/api/ms/generate' }
};
const SIZE_MAP = {
    square: {'1k':'1024x1024','2k':'2048x2048','4k':'4096x4096'},
    portrait: {'1k':'1024x1536','2k':'1360x2048','4k':'2352x3520'},
    portrait43: {'1k':'1008x1344','2k':'1536x2048','4k':'2448x3264'},
    landscape43: {'1k':'1344x1008','2k':'2048x1536','4k':'3264x2448'},
    landscape: {'1k':'1536x1024','2k':'2048x1360','4k':'3520x2352'},
    story: {'1k':'720x1280','2k':'1152x2048','4k':'2160x3840'},
    wide: {'1k':'1280x720','2k':'2048x1152','4k':'3840x2160'},
    ultrawide: {'1k':'1280x544','2k':'2048x880','4k':'3840x1648'},
    ultratall: {'1k':'544x1280','2k':'880x2048','4k':'1648x3840'}
};
const RES_LONG_SIDE = { '1k':1536, '2k':2048, '4k':3840 };
const RES_PIXEL_LIMIT = { '1k':1572864, '2k':4194304, '4k':8294400 };
function tr(key){ return window.StudioI18n?.t ? window.StudioI18n.t(key) : key; }
function applySmartCanvasDockPosition(position=smartCanvasDockPosition, {persist=false}={}){
    smartCanvasDockPosition = position === 'left' ? 'left' : 'bottom';
    const vertical = smartCanvasDockPosition === 'left';
    if(vertical){
        document.documentElement.style.removeProperty('--ic-toast-block-end-offset');
    } else {
        document.documentElement.style.setProperty(
            '--ic-toast-block-end-offset',
            'calc(max(var(--ui-space-6), env(safe-area-inset-bottom)) + var(--ui-control-height-l) + var(--ui-space-3))'
        );
    }
    smartCanvasDock?.setAttribute('data-position', smartCanvasDockPosition);
    smartCanvasDock?.setAttribute('orientation', vertical ? 'vertical' : 'horizontal');
    smartCanvasDockDivider?.setAttribute('orientation', vertical ? 'horizontal' : 'vertical');
    smartCanvasDock?.querySelectorAll('.smart-canvas-dock-btn').forEach(button => {
        button.setAttribute('tooltip-placement', vertical ? 'inline-end' : 'block-start');
    });
    smartCanvasDockPositionControl?.setAttribute('value', smartCanvasDockPosition);
    if(persist){
        try { localStorage.setItem(SMART_CANVAS_DOCK_POSITION_STORAGE_KEY, smartCanvasDockPosition); }
        catch(e) {}
    }
    return smartCanvasDockPosition;
}
function trf(key, values={}){
    return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), tr(key));
}
function copyTextWithCopyEvent(value){
    let handled = false;
    const onCopy = event => {
        event.preventDefault();
        event.clipboardData?.setData('text/plain', value);
        handled = true;
    };
    document.addEventListener('copy', onCopy);
    try {
        return document.execCommand('copy') && handled;
    } catch(_) {
        return false;
    } finally {
        document.removeEventListener('copy', onCopy);
    }
}
function copyTextWithTextarea(value){
    let ta = null;
    try {
        ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus({preventScroll:true});
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        return document.execCommand('copy');
    } catch(_) {
        return false;
    } finally {
        ta?.remove();
    }
}
async function clipboardMatchesText(value){
    try {
        if(navigator.clipboard?.readText && window.isSecureContext){
            return (await navigator.clipboard.readText()) === value;
        }
    } catch(_) {}
    return null;
}
async function copyTextToClipboard(text){
    const value = String(text || '');
    if(!value) return false;
    invalidateNodeClipboard();
    if(copyTextWithCopyEvent(value) || copyTextWithTextarea(value)){
        const verified = await clipboardMatchesText(value);
        return verified !== false;
    }
    try {
        if(navigator.clipboard?.writeText && window.isSecureContext !== false){
            await navigator.clipboard.writeText(value);
            const verified = await clipboardMatchesText(value);
            return verified !== false;
        }
    } catch(_) {}
    return false;
}
function refreshIcons(){ if(window.lucide) lucide.createIcons(); }
const smartGenerationLogModal = generationLogModal.create({
    root:smartLogModal,
    getLogs:() => canvas?.logs || [],
    getNodes:() => nodes || [],
    translate:tr,
    format:trf,
    language:() => window.StudioI18n?.lang?.() || '',
    failureFeedback:generationFailureFeedback,
    displayMediaUrl,
    previewMediaUrl:smartMediaPreviewUrl,
    bindImageFallbacks:bindSmartPreviewImageFallbacks,
    copyText:copyTextToClipboard,
    toast,
    refreshIcons,
    version:() => window.__IC_VERSION || document.documentElement.dataset.version || '',
    loadVersion:async () => {
        try {
            const response = await fetch('/api/app-info', {cache:'no-store'});
            if(!response.ok) return '';
            const info = await response.json();
            return info.version || '';
        } catch(error){
            return '';
        }
    },
    onClose:() => closeSmartCanvasLog(),
});
smartLogModal?.addEventListener('ic-after-hide', () => smartGenerationLogModal.onClosed());
function uid(prefix){ return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`; }
function escapeHtml(str){ return String(str == null ? '' : str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
const escapeAttr = escapeHtml;
function smartOriginalMediaUrl(itemOrUrl){
    const raw = typeof itemOrUrl === 'string' ? itemOrUrl : (itemOrUrl?.url || '');
    const text = String(raw || '');
    if(!text) return '';
    try {
        const parsed = new URL(text, window.location.origin);
        if(parsed.pathname === '/api/media-preview'){
            const original = parsed.searchParams.get('url') || '';
            return original || text;
        }
    } catch(e) {}
    return text;
}
function smartMediaPreviewUrl(itemOrUrl, size=512){
    const raw = smartOriginalMediaUrl(itemOrUrl);
    const displayItem = typeof itemOrUrl === 'object' && itemOrUrl ? {...itemOrUrl, url:raw} : raw;
    const displayUrl = displayMediaUrl(displayItem);
    if(!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return displayUrl;
    if(!raw.startsWith('/assets/')) return displayUrl;
    if(!/\.(png|jpe?g|webp|gif|bmp|avif|tiff?|mp4|webm|mov|m4v|avi|mkv)(\?|#|$)/i.test(raw)) return displayUrl;
    const width = Math.max(64, Math.min(2048, Math.round(Number(size) || 512)));
    return `/api/media-preview?w=${width}&url=${encodeURIComponent(raw)}`;
}
function smartPreviewImgHtml(itemOrUrl, size=512, attrs=''){
    const original = smartOriginalMediaUrl(itemOrUrl);
    const preview = smartMediaPreviewUrl(itemOrUrl, size);
    const originalItem = typeof itemOrUrl === 'object' && itemOrUrl ? {...itemOrUrl, url:original} : {url:original};
    const originalDisplay = displayMediaUrl(originalItem);
    const src = smartImagePerformanceOptimization ? preview : originalDisplay;
    return `<img src="${escapeHtml(src)}" data-preview-src="${escapeAttr(preview)}" data-preview-size="${Math.round(Number(size) || 512)}" data-original-src="${escapeAttr(original)}" data-media-state="loading" decoding="async"${attrs ? ` ${attrs}` : ''}>`;
}
function loadSmartOriginalImageDimensions(url){
    const src = displayMediaUrl({url:smartOriginalMediaUrl(url)});
    if(!src || /^data:/i.test(src) || /^blob:/i.test(src)) return Promise.resolve(null);
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? {w:img.naturalWidth, h:img.naturalHeight} : null);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}
function smartVideoPreviewHtml(itemOrUrl, size=512, attrs=''){
    const original = smartOriginalMediaUrl(itemOrUrl);
    const preview = smartMediaPreviewUrl(itemOrUrl, size);
    return `<img src="${escapeHtml(preview)}" data-preview-src="${escapeAttr(preview)}" data-original-src="${escapeAttr(original)}" data-url="${escapeAttr(original)}" data-preview-kind="video" data-media-state="loading" decoding="async"${attrs ? ` ${attrs}` : ''}>`;
}
function smartVideoFallbackHtml(url, attrs=''){
    const original = smartOriginalMediaUrl(url);
    const src = displayMediaUrl({url:original});
    return `<video src="${escapeHtml(src)}" data-url="${escapeAttr(original)}" muted preload="metadata" playsinline disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback nofullscreen"${attrs ? ` ${attrs}` : ''}></video>`;
}
function smartVideoPlayerHtml(url, attrs=''){
    const original = smartOriginalMediaUrl(url);
    const safe = escapeHtml(displayMediaUrl({url:original}));
    return `<video src="${safe}" data-url="${escapeAttr(original)}" data-inline-video-active="1" controls autoplay loop playsinline preload="metadata" disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback nofullscreen"${attrs ? ` ${attrs}` : ''}></video>`;
}
function smartVideoPlayButtonHtml(options={}){
    const thumbnail = Boolean(options.thumbnail);
    return `<ic-video-play-button class="smart-video-play${thumbnail ? ' thumb-video-play' : ''}"${thumbnail ? ' size="s"' : ''} label="${escapeAttr(tr('canvas.play'))}" data-component-name="ic-video-play-button"></ic-video-play-button>`;
}
function bindSmartVideoFullscreenDoubleClick(video){
    if(!video || video.dataset.smartVideoFullscreenDblclickBound === '1') return;
    video.dataset.smartVideoFullscreenDblclickBound = '1';
    video.addEventListener('mousedown', event => {
        if(event.detail >= 2) return;
        event.stopPropagation();
        const state = captureMediaPlaybackState(video);
        video._smartFullscreenPlaybackState = state;
        setTimeout(() => {
            if(video._smartFullscreenPlaybackState === state) delete video._smartFullscreenPlaybackState;
        }, 400);
    }, true);
    video.addEventListener('click', event => {
        event.stopPropagation();
        if(event.detail >= 2) return;
        if(video.dataset.inlineVideoActive === '1'){
            const rect = video.getBoundingClientRect();
            const nativeControlsHeight = Math.min(64, rect.height * 0.3);
            if(event.clientY >= rect.bottom - nativeControlsHeight) return;
            clearTimeout(video._smartPlaybackClickTimer);
            const initialPaused = Boolean(video.paused);
            video._smartPlaybackClickTimer = setTimeout(() => {
                video._smartPlaybackClickTimer = null;
                if(Boolean(video.paused) !== initialPaused) return;
                if(initialPaused){
                    const target = smartPlaybackTargetFromElement(video);
                    if(target){
                        smartPlaybackRestoreEntry(
                            video,
                            smartPlaybackEntry(target.nodeId, target.imageIndex),
                            {play:true}
                        );
                    }
                } else {
                    smartPlaybackPauseMedia(video);
                }
            }, 220);
            return;
        }
        event.preventDefault();
        const item = video.closest('[data-image-index]');
        const nodeElement = video.closest('.image-node');
        const nodeId = item?.dataset?.refNodeId || nodeElement?.dataset?.id || '';
        const imageIndex = Number(item?.dataset?.refImageIndex ?? item?.dataset?.imageIndex ?? 0);
        clearImageClickTimer();
        imageClickTimer = setTimeout(() => {
            imageClickTimer = null;
            smartPlaybackSelectAndPlayVideo(nodeId, imageIndex);
        }, 220);
    }, true);
    video.addEventListener('dblclick', event => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        clearTimeout(video._smartPlaybackClickTimer);
        video._smartPlaybackClickTimer = null;
        const item = video.closest('[data-image-index]');
        const nodeEl = video.closest('.image-node');
        const nodeId = item?.dataset?.refNodeId || nodeEl?.dataset?.id || '';
        const imageIndex = Number(item?.dataset?.refImageIndex ?? item?.dataset?.imageIndex ?? 0);
        openSmartVideoFullscreen(nodeId, imageIndex);
    }, true);
    video.addEventListener('keydown', event => {
        if(event.code !== 'Space' || video.dataset.inlineVideoActive !== '1') return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        smartPlaybackToggleSelectedVideo();
    }, true);
}
function smartActivateVideoPreview(target, options={}){
    const root = target?.closest?.('.media-video-card,.video-thumb,.image-wrap,.thumb-item') || target?.parentElement || null;
    const img = target?.matches?.('img[data-preview-kind="video"]') ? target : root?.querySelector?.('img[data-preview-kind="video"]');
    const fallback = !img
        ? (target?.matches?.('video[data-url]') ? target : root?.querySelector?.('video[data-url]'))
        : null;
    const preview = img || fallback;
    if(!preview) return false;
    const original = smartOriginalMediaUrl(preview.dataset.originalSrc || preview.dataset.url || preview.getAttribute('src') || '');
    if(!original) return false;
    const itemEl = target?.closest?.('[data-image-index]') || root?.closest?.('[data-image-index]') || root;
    const nodeEl = target?.closest?.('.image-node') || root?.closest?.('.image-node');
    const nodeId = String(options.nodeId || itemEl?.dataset?.refNodeId || nodeEl?.dataset.id || '');
    const node = nodes.find(n => n.id === nodeId);
    const imageIndex = Math.max(0, Number(options.imageIndex ?? itemEl?.dataset?.refImageIndex ?? itemEl?.dataset?.imageIndex ?? 0) || 0);
    const image = node?.images?.[imageIndex];
    if(image) image._inlineVideoActive = true;
    const tpl = document.createElement('template');
    tpl.innerHTML = smartVideoPlayerHtml(original);
    const video = tpl.content.firstElementChild;
    if(!video) return false;
    preview.replaceWith(video);
    video.parentElement?.querySelector?.('.smart-video-play')?.remove();
    video.addEventListener('ended', () => {
        if(image) image._inlineVideoActive = true;
        video.dataset.inlineVideoActive = '1';
    });
    bindSmartVideoFullscreenDoubleClick(video);
    smartPlaybackBindMedia(video, nodeId, imageIndex);
    smartPlaybackRestoreEntry(video, smartPlaybackEntry(nodeId, imageIndex), {play:options.autoplay !== false});
    return video;
}
function isSmartPreviewImage(img){
    return img?.tagName?.toLowerCase?.() === 'img'
        && img.dataset?.previewSrc
        && img.dataset?.originalSrc
        && img.dataset.previewSrc !== img.dataset.originalSrc
        && img.getAttribute('src') !== img.dataset.originalSrc;
}
function bindSmartPreviewImageFallbacks(root=document){
    root.querySelectorAll?.('img[data-preview-src][data-original-src]:not([data-preview-fallback-bound])').forEach(img => {
        img.dataset.previewFallbackBound = '1';
        const markReady = async () => {
            try {
                if(typeof img.decode === 'function') await img.decode();
            } catch(error) {}
            if(img.isConnected && img.naturalWidth > 0){
                img.dataset.mediaState = 'ready';
            }
        };
        img.addEventListener('load',() => { void markReady(); });
        img.addEventListener('error', () => {
            const original = img.dataset.originalSrc || '';
            if(img.dataset.previewKind === 'video'){
                const tpl = document.createElement('template');
                if(img.closest('.canvas-lod-node-far')){
                    tpl.innerHTML = '<div class="far-node-video-placeholder"><ic-icon name="video" size="large" aria-hidden="true"></ic-icon></div>';
                    img.replaceWith(tpl.content.firstElementChild);
                    return;
                }
                tpl.innerHTML = smartVideoFallbackHtml(original, img.dataset.videoFallbackAttrs || '');
                const video = tpl.content.firstElementChild;
                img.replaceWith(video);
                bindSmartVideoFullscreenDoubleClick(video);
                return;
            }
            if(original && img.getAttribute('src') !== original){
                img.dataset.mediaState = 'loading';
                img.src = original;
                return;
            }
            img.dataset.mediaState = 'error';
        });
        if(img.complete && img.naturalWidth > 0) void markReady();
        else img.dataset.mediaState = 'loading';
    });
}
const SMART_ADAPTIVE_IMAGE_DELAY = 180;
const SMART_ADAPTIVE_VIEWPORT_MARGIN = 256;
let smartAdaptiveImageTimer = 0;
const smartAdaptivePreviewLoaded = new Set();
const smartAdaptivePreviewLoading = new Map();
function smartPreviewSizeFromUrl(url){
    try {
        const parsed = new URL(String(url || ''), window.location.origin);
        if(parsed.pathname !== '/api/media-preview') return 0;
        return Number(parsed.searchParams.get('w')) || 0;
    } catch(e) {
        return 0;
    }
}
function smartImageNearViewport(img){
    const imageRect = img?.getBoundingClientRect?.();
    const shellRect = shell?.getBoundingClientRect?.();
    if(!imageRect || !shellRect || !shellRect.width || !shellRect.height) return true;
    const margin = SMART_ADAPTIVE_VIEWPORT_MARGIN;
    return imageRect.right >= shellRect.left - margin
        && imageRect.left <= shellRect.right + margin
        && imageRect.bottom >= shellRect.top - margin
        && imageRect.top <= shellRect.bottom + margin;
}
function preloadSmartAdaptivePreview(src){
    if(!src || smartAdaptivePreviewLoaded.has(src)) return Promise.resolve(true);
    if(smartAdaptivePreviewLoading.has(src)) return smartAdaptivePreviewLoading.get(src);
    const task = new Promise(resolve => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = async () => {
            try { if(img.decode) await img.decode(); } catch(e) {}
            smartAdaptivePreviewLoaded.add(src);
            resolve(true);
        };
        img.onerror = () => resolve(false);
        img.src = src;
    }).finally(() => smartAdaptivePreviewLoading.delete(src));
    smartAdaptivePreviewLoading.set(src, task);
    return task;
}
function smartAdaptiveImageElements(root=world){
    const selector = 'img[data-preview-src][data-original-src]:not([data-preview-kind="video"])';
    if(root?.matches?.(selector)) return [root];
    return [...(root || world).querySelectorAll?.(selector) || []];
}
function showSmartOriginalImages(root=world){
    smartAdaptiveImageElements(root).forEach(img => {
        delete img.dataset.adaptivePreviewTarget;
        const target = displayMediaUrl({url:smartOriginalMediaUrl(img.dataset.originalSrc || '')});
        if(target && img.getAttribute('src') !== target) img.src = target;
    });
}
function refreshSmartAdaptiveImageResolution(root=world){
    if(!smartImagePerformanceOptimization){
        showSmartOriginalImages(root);
        return;
    }
    smartAdaptiveImageElements(root).forEach(img => {
        const original = smartOriginalMediaUrl(img.dataset.originalSrc || '');
        if(!original) return;
        const lodState = canvasLevelOfDetail.diagnostics();
        const currentSize = Number(img.dataset.previewSize) || smartPreviewSizeFromUrl(img.dataset.previewSrc);
        const targetSize = lodState.mode === 'far'
            ? 512
            : smartImageNearViewport(img)
            ? SmartImageResolution.choosePreviewSize({
                width:img.offsetWidth || img.clientWidth,
                height:img.offsetHeight || img.clientHeight,
                canvasScale:viewport.scale,
                devicePixelRatio:window.devicePixelRatio || 1,
                currentSize
            })
            : 512;
        const target = smartMediaPreviewUrl(original, targetSize);
        if(!target) return;
        img.dataset.previewSrc = target;
        img.dataset.previewSize = String(targetSize);
        img.dataset.adaptivePreviewTarget = target;
        img.dataset.adaptivePreviewGeneration = String(lodState.resourceGeneration);
        if(img.getAttribute('src') === target) return;
        if(!target.startsWith('/api/media-preview')){
            img.src = target;
            return;
        }
        preloadSmartAdaptivePreview(target).then(loaded => {
            if(!loaded || !img.isConnected || img.dataset.adaptivePreviewTarget !== target) return;
            if(
                img.dataset.adaptivePreviewGeneration
                !== String(canvasLevelOfDetail.diagnostics().resourceGeneration)
            ) return;
            if(img.getAttribute('src') !== target) img.src = target;
        });
    });
}
function scheduleSmartAdaptiveImageResolution(delay=SMART_ADAPTIVE_IMAGE_DELAY){
    if(smartAdaptiveImageTimer) clearTimeout(smartAdaptiveImageTimer);
    smartAdaptiveImageTimer = setTimeout(() => {
        smartAdaptiveImageTimer = 0;
        refreshSmartAdaptiveImageResolution(world);
    }, Math.max(0, Number(delay) || 0));
}
function refreshSmartCanvasSettings(){
    smartSettingsPanel?.classList.toggle('open', smartSettingsOpen);
    smartSettingsToggle?.setAttribute('aria-expanded', smartSettingsOpen ? 'true' : 'false');
    if(smartCanvasThemeToggle){
        const dark = document.documentElement.dataset.uiTheme === 'dark'
            || document.documentElement.classList.contains('theme-dark');
        const labelKey = dark ? 'smart.switchToLightTheme' : 'smart.switchToDarkTheme';
        smartCanvasThemeToggle.setAttribute('icon', dark ? 'light' : 'theme');
        smartCanvasThemeToggle.dataset.i18nLabel = labelKey;
        smartCanvasThemeToggle.setAttribute('label', tr(labelKey));
    }
    if(smartShortcutSettingsShortcut) smartShortcutSettingsShortcut.textContent = smartShortcutLabel('shortcuts');
    smartCanvasDockPositionControl?.setAttribute('value', smartCanvasDockPosition);
    smartGenerationBatchLayoutControl?.setAttribute('value', smartGenerationBatchLayout);
    if(smartImagePerformanceToggle) smartImagePerformanceToggle.checked = smartImagePerformanceOptimization;
    syncSmartCanvasSpeedControl(smartCanvasZoomSpeedInput, smartCanvasZoomSpeed);
    syncSmartCanvasSpeedControl(smartCanvasPanSpeedInput, smartCanvasPanSpeed);
}
function syncSmartCanvasSpeedControl(input, speed){
    const percent = Math.round(Math.max(.5, Math.min(2, Number(speed) || 1)) * 100);
    if(input){
        const multiplier = Number((percent / 100).toFixed(1));
        input.setAttribute('value', String(percent));
        input.setAttribute('value-text', trf('smart.speedMultiplier', {value:multiplier}));
        const output = document.getElementById(`${input.id}Value`);
        if(output) output.textContent = `${multiplier}×`;
    }
}
function closeSmartCanvasSettings(){
    if(!smartSettingsOpen) return;
    smartSettingsOpen = false;
    refreshSmartCanvasSettings();
}
function smartCanvasTaskDialogOpen(){
    return Boolean(smartShortcutDialog?.hasAttribute('open') || smartNodePackageImportDialog?.hasAttribute('open') || document.getElementById('smartFrameExportDialog')?.hasAttribute('open'));
}
function setSmartImagePerformanceOptimization(value){
    const enabled = Boolean(value);
    smartImagePerformanceOptimization = enabled;
    try { localStorage.setItem(SMART_IMAGE_PERFORMANCE_STORAGE_KEY, enabled ? 'on' : 'off'); } catch(e) {}
    if(enabled) refreshSmartAdaptiveImageResolution(world);
    else showSmartOriginalImages(world);
    refreshSmartCanvasSettings();
}
function setSmartCanvasInteractionSpeed(kind, percent){
    const speed = Math.max(.5, Math.min(2, (Number(percent) || 100) / 100));
    const zoom = kind === 'zoom';
    if(zoom) smartCanvasZoomSpeed = speed;
    else smartCanvasPanSpeed = speed;
    try {
        localStorage.setItem(
            zoom ? SMART_CANVAS_ZOOM_SPEED_STORAGE_KEY : SMART_CANVAS_PAN_SPEED_STORAGE_KEY,
            String(speed)
        );
    } catch(e) {}
    refreshSmartCanvasSettings();
}
function mediaItemForStorage(item){
    if(!item || typeof item !== 'object') return item;
    const clean = {...item};
    delete clean.cloudUrl;
    delete clean.uploadedUrl;
    delete clean.originalRemoteUrl;
    delete clean.tempCloudUrl;
    delete clean._inlineVideoActive;
    return clean;
}
function canvasForStorage(){
    const clean = JSON.parse(JSON.stringify(canvas || {}));
    clean.settings = settingsForStorage(canvasDefaultSmartSettings || initialSmartSettings);
    clean.settings.generationBatchLayout = smartGenerationBatchLayout;
    // 日志预览的临时节点（编辑器打开期间临时塞进 nodes）绝不能被持久化，否则刷新后会留下幽灵节点。
    if(Array.isArray(clean.nodes)) clean.nodes = clean.nodes.filter(node => node.id !== SMART_LOG_PREVIEW_NODE_ID);
    (clean.nodes || []).forEach(node => {
        if(Array.isArray(node.images)) node.images = node.images.map(mediaItemForStorage);
        if(node.runSettings) node.runSettings = settingsForStorage(node.runSettings);
    });
    return clean;
}
function apiErrorMessage(data, fallback=tr('canvas.requestFailed')){
    if(!data) return fallback;
    if(typeof data === 'string') return data || fallback;
    const detail = data.detail ?? data.error ?? data.message;
    if(typeof detail === 'string') return detail || fallback;
    if(Array.isArray(detail)){
        const messages = detail.map(item => {
            if(typeof item === 'string') return item;
            const loc = Array.isArray(item?.loc) ? item.loc.filter(x => x !== 'body').join('.') : '';
            const msg = item?.msg || item?.message || JSON.stringify(item);
            return loc ? `${loc}: ${msg}` : msg;
        }).filter(Boolean);
        return messages.join('\n') || fallback;
    }
    if(detail && typeof detail === 'object') return detail.message || detail.msg || JSON.stringify(detail);
    try {
        return JSON.stringify(data);
    } catch(e) {
        return fallback;
    }
}
async function responseErrorMessage(response, fallback=tr('canvas.requestFailed')){
    try {
        const data = await response.clone().json();
        return apiErrorMessage(data, fallback);
    } catch(e) {
        try {
            const text = await response.text();
            return text || fallback;
        } catch(_) {
            return fallback;
        }
    }
}
function downloadBlob(blob, filename){
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'smart-canvas-node-package.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 800);
}
function smartNodePackageFilename(ext='json'){
    const title = (canvas?.title || document.getElementById('smartTitle')?.textContent || 'smart-canvas').trim();
    const safe = title.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '-').slice(0, 48) || 'smart-canvas';
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    return `${safe}-node-package-${stamp}.${ext}`;
}
function clearSmartNodeTransientRunState(node, options={}){
    if(!node) return node;
    node.running = false;
    node.pending = 0;
    node.queued = false;
    if(node.textGenerationPending){
        delete node.textGenerationPending;
        delete node.textGenerationOutput;
    }
    delete node.jimengPending;
    delete node.pendingTasks;
    delete node._runMetaTargetId;
    delete node.generationPreviousPresentation;
    delete node.generationBatchAutoSelectedOutputId;
    if(options.clearRunHistory){
        delete node.runStartedAt;
        delete node.runFinishedAt;
        delete node.runElapsedMs;
        delete node.runTimerHidden;
    }
    return node;
}
function serializableSmartNode(node){
    const base = JSON.parse(JSON.stringify(node || {}));
    const copy = normalizeLegacySmartNode(base) || {};
    if(Array.isArray(copy.images)) copy.images = copy.images.map(img => mediaItemForStorage(stripImageGenerationMeta(img))).filter(Boolean);
    if(copy.runSettings) copy.runSettings = settingsForStorage(copy.runSettings);
    clearSmartNodeTransientRunState(copy);
    delete copy._dom;
    return copy;
}
function selectedSmartNodePackagePayload(){
    const ids = smartContainer.expand(window.SmartCanvasModules.viewportSelection.selection.ids());
    const idSet = new Set(ids);
    const selectedNodes = nodes.filter(node => idSet.has(node.id)).map(serializableSmartNode);
    const selectedSet = new Set(selectedNodes.map(node => node.id));
    const selectedConnections = (canvas?.connections || [])
        .filter(conn => selectedSet.has(conn.from) && selectedSet.has(conn.to))
        .map(conn => JSON.parse(JSON.stringify(conn)));
    return {
        // Keep accepting/exporting the legacy format identifier so existing
        // files remain importable; the product-level artifact is a Node Package.
        format:'infinite-smart-canvas-workflow',
        version:1,
        canvas_type:'smart',
        exported_at:Date.now(),
        nodes:selectedNodes,
        connections:selectedConnections
    };
}
function normalizeImportedSmartNodePackage(data){
    if(Array.isArray(data)) return {nodes:data, connections:[]};
    if(Array.isArray(data?.nodes)) return {nodes:data.nodes, connections:Array.isArray(data.connections) ? data.connections : []};
    if(Array.isArray(data?.workflow?.nodes)) return {nodes:data.workflow.nodes, connections:Array.isArray(data.workflow.connections) ? data.workflow.connections : []};
    return {nodes:[], connections:[]};
}
async function exportSelectedSmartNodesAsResourcePackage(){
    if(!canvas) return;
    const payload = selectedSmartNodePackagePayload();
    if(!payload.nodes.length){
        toast(tr('canvas.selectNodesToExport'));
        return;
    }
    try {
        toast(tr('smart.nodePackagePackaging'));
        const filename = smartNodePackageFilename('zip');
        const res = await fetch('/api/canvas-workflows/export', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({...payload, include_resources:true, filename})
        });
        if(!res.ok) throw new Error(await responseErrorMessage(res, tr('smart.exportNodePackageFailed')));
        downloadBlob(await res.blob(), filename);
        toast(tr('smart.exportedNodePackage'));
    } catch(err) {
        toast(err.message || tr('smart.exportNodePackageFailed'));
    }
}
let nodePackageLimitsPromise = null;
async function loadNodePackageLimits(){
    if(!nodePackageLimitsPromise){
        nodePackageLimitsPromise = fetch('/api/canvas-workflows/limits')
            .then(async response => {
                if(!response.ok) throw new Error('limits unavailable');
                const limits = await response.json();
                const maxArchiveBytes = Number(limits?.max_archive_bytes);
                return {
                    ...limits,
                    max_archive_bytes:Number.isFinite(maxArchiveBytes) && maxArchiveBytes > 0
                        ? Math.floor(maxArchiveBytes)
                        : 0,
                };
            })
            .catch(() => ({max_archive_bytes:0}));
    }
    return nodePackageLimitsPromise;
}
function insertSmartNodePackageIntoCanvas(imported){
    const srcNodes = (imported.nodes || []).filter(Boolean);
    const srcConnections = (imported.connections || []).filter(Boolean);
    if(!canvas || !srcNodes.length) throw new Error(tr('canvas.noImportableNodes'));
    canvasMutation.history({action:'push'});
    const minX = Math.min(...srcNodes.map(n => Number(n.x || 0)));
    const minY = Math.min(...srcNodes.map(n => Number(n.y || 0)));
    const target = window.SmartCanvasModules.viewportSelection.viewport.center();
    const dx = target.x - minX;
    const dy = target.y - minY;
    const idMap = new Map();
    const newNodes = srcNodes.map(source => {
        const copy = serializableSmartNode(source);
        const oldId = copy.id || uid(copy.type || 'smart');
        copy.id = uid(copy.type || 'smart');
        copy.x = Number(copy.x || 0) + dx;
        copy.y = Number(copy.y || 0) + dy;
        copy.created_at = copy.created_at || Date.now();
        idMap.set(oldId, copy.id);
        return normalizeLegacySmartNode(copy);
    }).filter(Boolean);
    newNodes.forEach(copy => {
        if(Array.isArray(copy.items)) copy.items = copy.items.map(id => idMap.get(id)).filter(Boolean);
        if(Array.isArray(copy.inputNodeIds)) copy.inputNodeIds = copy.inputNodeIds.map(id => idMap.get(id)).filter(Boolean);
        if(copy.sourceNodeId) copy.sourceNodeId = idMap.get(copy.sourceNodeId) || '';
    });
    const newConnections = srcConnections
        .map(conn => ({...JSON.parse(JSON.stringify(conn)), from:idMap.get(conn.from), to:idMap.get(conn.to)}))
        .filter(conn => conn.from && conn.to);
    nodes.push(...newNodes);
    canvas.connections = [...(canvas.connections || []), ...newConnections];
    selectedIds = newNodes.length > 1 ? newNodes.map(node => node.id) : [];
    selectedId = newNodes.length === 1 ? newNodes[0].id : '';
    selectedImage = {nodeId:'', index:-1};
    activeComposerSubject = null;
    render();
    canvasPersistence.schedule();
    return {nodes:newNodes, connections:newConnections};
}
async function inspectSmartNodePackageFile(file){
    if(!canvas || !file) throw new Error(tr('smart.openCanvasFirst'));
    const form = new FormData();
    form.append('file',file);
    const response = await fetch('/api/canvas-workflows/inspect',{method:'POST',body:form});
    if(!response.ok) throw new Error(await responseErrorMessage(response,tr('smart.importNodePackageFailed')));
    return response.json();
}
async function commitSmartNodePackageFile(file){
    if(!canvas || !file) throw new Error(tr('smart.openCanvasFirst'));
    const form = new FormData();
    form.append('file',file);
    const response = await fetch('/api/canvas-workflows/import',{method:'POST',body:form});
    if(!response.ok) throw new Error(await responseErrorMessage(response,tr('smart.importNodePackageFailed')));
    const data = await response.json();
    const inserted = insertSmartNodePackageIntoCanvas(normalizeImportedSmartNodePackage(data));
    return {
        nodeIds:inserted.nodes.map(node => node.id),
        nodeCount:inserted.nodes.length,
        connectionCount:inserted.connections.length,
    };
}
function isSmartImageNode(node){
    return Boolean(node && (node.type === 'smart-image' || !node.type));
}
function isUploadedAttachmentImageNode(node){
    if(!isSmartImageNode(node) || !(node.images || []).some(item => item?.url)) return false;
    if(node.uploadedAttachment === true) return true;
    // 兼容旧画布：有媒体但没有任何生成来源信息的图片节点，就是上传/导入附件。
    return !node.generationOutputNode && !node.runSettings && !node.runAt;
}
function isUpstreamUploadMediaNode(node){
    return Boolean(isSmartImageNode(node) && ['image','video'].includes(node?.uploadMediaKind));
}
function isSmartUploadMediaNode(node){
    if(!isSmartImageNode(node)) return false;
    if(isUploadedAttachmentImageNode(node)) return true;
    if(isUpstreamUploadMediaNode(node)) return true;
    const hasMedia = (node.images || []).some(item => item?.url);
    return !hasMedia && !referenceGenerationKind(node)
        && !node.pending
        && !node.queued
        && !node.generationOutputNode
        && !node.runSettings
        && !node.runAt;
}
function isSmartRunnableNode(node){
    return smartNodeGenerationEligibility(node).runnable;
}
function smartNodeGenerationEligibility(node){
    const runnable = Boolean(nodeKinds.isGeneration(node) || smartContainer.isGroup(node));
    if(!runnable || smartContainer.isGroup(node)){
        return Object.freeze({
            runnable,
            imageAllowed:runnable,
            videoAllowed:runnable,
            forcedApiKind:''
        });
    }
    const mediaKinds = new Set(
        (node.images || [])
            .filter(item => item?.url)
            .map(mediaKindForItem)
    );
    const hasImage = mediaKinds.has('image');
    const hasVideoOrAudio = mediaKinds.has('video') || mediaKinds.has('audio');
    const videoOnly = hasVideoOrAudio && !hasImage;
    return Object.freeze({
        runnable:true,
        imageAllowed:!videoOnly,
        videoAllowed:true,
        forcedApiKind:videoOnly ? 'video' : ''
    });
}
function isHistoryGroupNode(node){
    return Boolean(isSmartImageNode(node) && (node.isHistoryGroup || node.historyFor));
}
function smartImageUsesWorkflowInput(node, ctx=smartLoopContext){
    return Boolean(isSmartImageNode(node) && ctx?.forceWorkflow);
}
function normalizeLegacySmartNode(node){
    if(!node || typeof node !== 'object') return node;
    if(node.type === 'smart-group' && ['万能分组', '智能分组', 'Smart Group'].includes(String(node.title || ''))){
        node.title = tr('smart.smartGroup');
    }
    if(node.type === 'smart-section'){
        node.type = 'smart-frame';
        node.frameColor = SMART_FRAME_COLORS.includes(node.frameColor)
            ? node.frameColor
            : (SMART_FRAME_COLORS.includes(node.sectionColor)
                ? node.sectionColor
                : SMART_FRAME_DEFAULT_COLOR);
        delete node.sectionColor;
        if(!node.title || /^区块(?:\s+\d+)?$/.test(String(node.title))){
            node.title = String(node.title || '').replace(/^区块/, tr('smart.frameDefault')) || tr('smart.frameDefault');
        }
    }
    if(node.type === 'smart-frame' && !SMART_FRAME_COLORS.includes(node.frameColor)){
        node.frameColor = SMART_FRAME_DEFAULT_COLOR;
    }
    if(node.type === 'smart-frame'){
        const defaultTitle = String(node.title || '').match(/^(?:画布|Frame)(?:\s+(\d+))?$/i);
        if(defaultTitle){
            node.title = `${tr('smart.frameDefault')}${defaultTitle[1] ? ` ${defaultTitle[1]}` : ''}`;
        }
    }
    if(node.type === 'smart-container'){
        const fallbackImage = node.inputImage?.url ? stripImageGenerationMeta({
            url:node.inputImage.url,
            name:node.inputImage.name || 'image',
            kind:node.inputImage.kind || mediaKindForItem(node.inputImage),
            natural_w:Number(node.inputImage.natural_w || 0),
            natural_h:Number(node.inputImage.natural_h || 0)
        }) : null;
        const images = Array.isArray(node.images) && node.images.length
            ? node.images
            : (fallbackImage ? [fallbackImage] : []);
        const normalized = {
            ...node,
            type:'smart-image',
            title:images.length > 1 ? 'Group' : (images.length ? 'Image' : tr('smart.createImportNode')),
            images
        };
        delete normalized.imageMode;
        delete normalized.inputImage;
        delete normalized.steps;
        delete normalized.resultGrouping;
        return normalized;
    }
    if(!node.type) node.type = 'smart-image';
    if(node.type === 'smart-image'){
        delete node.imageMode;
        const looksLikeGenerationOutput = Boolean(
            node.generationOutputNode
            || node.activeOutputId
            || ((node.images || []).length && (
                node.runPrompt
                || node.runModelPrompt
                || node.runSettings
                || (node.runInputRefs || []).length
                || (node.runPromptRefs || []).length
            ))
        );
        if(looksLikeGenerationOutput){
            node.generationOutputNode = true;
            const generationOutput = window.SmartCanvasModules?.generationOutput;
            generationOutput?.repairReferenceKind?.({node});
            if((node.images || []).length > 1 || node.activeOutputId){
                generationOutput?.ensureNodeState?.({node});
            }
        }
    }
    if(node.type === 'smart-image' && node.historyFor) node.isHistoryGroup = true;
    return node;
}
function migrateLegacyPromptSplitNodes(){
    if(!canvas) return false;
    const legacyNodes = nodes.filter(node =>
        node?.type === 'smart-prompt'
        && node.promptSplitEnabled === true
    );
    if(!legacyNodes.length) return false;
    canvas.connections = Array.isArray(canvas.connections)
        ? canvas.connections
        : [];
    legacyNodes.forEach((source, index) => {
        const splitter = {
            id:uid('splitter'),
            type:'smart-splitter',
            x:Number(source.x || 0) + Math.max(316, Number(source.w) || 316) + 72,
            y:Number(source.y || 0) + index * 16,
            w:316,
            h:240,
            title:tr('smart.separator'),
            separator:promptNodeSeparator(source),
            inputNodeIds:[source.id],
            created_at:Date.now()
        };
        const outgoing = canvas.connections.filter(connection =>
            connection.from === source.id
            && ['input','flow'].includes(connection.kind || 'flow')
        );
        outgoing.forEach(connection => {
            connection.from = splitter.id;
            const target = nodes.find(node => node.id === connection.to);
            if(target && Array.isArray(target.inputNodeIds)){
                target.inputNodeIds = target.inputNodeIds.map(id =>
                    id === source.id ? splitter.id : id
                );
            }
        });
        if(!canvasUsesConnections){
            nodes.forEach(target => {
                if(target.id === source.id || !Array.isArray(target.inputNodeIds)) return;
                target.inputNodeIds = target.inputNodeIds.map(id =>
                    id === source.id ? splitter.id : id
                );
            });
        }
        canvas.connections.push({
            from:source.id,
            to:splitter.id,
            kind:'input'
        });
        source.promptSplitEnabled = false;
        delete source.promptSeparator;
        delete source.promptSplitPreviewHeight;
        nodes.push(splitter);
    });
    canvas.nodes = nodes;
    return true;
}
function validOutpaintSize(node){
    const w = Math.round(Number(node?.outpaintSize?.width || 0));
    const h = Math.round(Number(node?.outpaintSize?.height || 0));
    return w > 0 && h > 0 ? {width:w, height:h} : null;
}
function parseSizePair(value){
    const match = String(value || '').match(/(\d+)\s*x\s*(\d+)/i);
    return match ? {width:Number(match[1]), height:Number(match[2])} : null;
}
function nearestFourKSizeFor(width, height){
    const w = Math.max(1, Number(width) || 1);
    const h = Math.max(1, Number(height) || 1);
    const ratio = w / h;
    let best = null;
    Object.entries(SIZE_MAP).forEach(([key, values]) => {
        const size = parseSizePair(values?.['4k']);
        if(!size) return;
        const score = Math.abs(Math.log(ratio / (size.width / size.height)));
        if(!best || score < best.score) best = {...size, key, score};
    });
    return best;
}
function exceedsFourKStandard(width, height){
    const standard = nearestFourKSizeFor(width, height);
    if(!standard) return false;
    return Number(width) > standard.width || Number(height) > standard.height;
}
function withOutpaintDisplaySettings(node, baseSettings){
    const size = validOutpaintSize(node);
    if(!size) return baseSettings;
    const engine = ['api','volcengine','modelscope','comfy','runninghub'].includes(baseSettings?.engine) ? baseSettings.engine : 'api';
    const next = {
        ...baseSettings,
        resolution:'custom',
        ratio:'',
        customWidth:size.width,
        customHeight:size.height,
        customSize:`${size.width}x${size.height}`,
        outpaintResolutionLocked:true
    };
    if(isApiLikeEngine(engine)) next.apiKind = 'image';
    if(engine === 'modelscope'){
        next.msResolution = 'custom';
        next.msRatio = '';
        next.msCustomWidth = size.width;
        next.msCustomHeight = size.height;
        next.msCustomSize = `${size.width}x${size.height}`;
    }
    if(engine === 'comfy'){
        next.width = size.width;
        next.height = size.height;
    }
    return next;
}
function stripOutpaintDisplaySettings(settingsObj, node=null){
    const clean = cloneSmartSettings(settingsObj);
    const size = validOutpaintSize(node);
    const matchesOutpaintSize = size && clean.resolution === 'custom' && String(clean.customSize || '') === `${size.width}x${size.height}`;
    if(matchesOutpaintSize){
        clean.resolution = '1k';
        clean.ratio = clean.ratio || 'square';
        clean.customWidth = '';
        clean.customHeight = '';
        clean.customSize = '';
    }
    const matchesMsOutpaintSize = size && clean.msResolution === 'custom' && String(clean.msCustomSize || '') === `${size.width}x${size.height}`;
    if(matchesMsOutpaintSize){
        clean.msResolution = '1k';
        clean.msRatio = clean.msRatio || 'square';
        clean.msCustomWidth = '';
        clean.msCustomHeight = '';
        clean.msCustomSize = '';
    }
    if(size && Number(clean.width) === size.width && Number(clean.height) === size.height){
        clean.width = 1024;
        clean.height = 1024;
    }
    delete clean.outpaintResolutionLocked;
    return clean;
}
function rememberCanvasListProject(projectId){
    const pid = projectId || 'default';
    try { localStorage.setItem(CANVAS_LIST_PROJECT_KEY, pid); } catch(e){}
    return pid;
}
function canvasListUrlForProject(projectId){
    const pid = rememberCanvasListProject(projectId);
    return `/static/canvas-list.html?project=${encodeURIComponent(pid)}&v=${Date.now()}`;
}
function backToCanvasList(){
    savePromptDraftForCurrent();
    window.location.href = canvasListUrlForProject(canvas?.project || sourceProjectId || 'default');
}
function promptPlainText(){
    return promptAuthoring.plainText();
}
function setPromptInputLocked(locked){
    promptInput.dataset.promptLocked = locked ? '1' : '0';
    promptInput.setAttribute('contenteditable', locked ? 'false' : 'true');
    if(locked) closeMentionPicker();
}
function setPromptText(text){
    promptInput.textContent = text || '';
}
function clearPromptInput(options={}){
    if(options.preserveDraft){
        promptInput.dataset.preserveDraftOnce = '1';
        closeMentionPicker();
        return;
    }
    delete promptInput.dataset.restoredGenerationSnapshotFor;
    promptInput.textContent = '';
    closeMentionPicker();
    if(activeComposerSubject){
        activeComposerSubject.promptDraftHtml = '';
        activeComposerSubject.promptDraftText = '';
    }
}
function applyTheme(theme){
    const dark = theme === 'dark';
    document.documentElement.dataset.uiTheme = dark ? 'dark' : 'light';
    document.documentElement.classList.toggle('theme-dark', dark);
    document.documentElement.classList.toggle('studio-theme-dark', dark);
    document.body?.classList.toggle('theme-dark', dark);
    document.body?.classList.toggle('studio-theme-dark', dark);
    refreshSmartCanvasSettings();
}
function toast(text, options={}){
    if(generationFailureAlertStates.size && !options.persistent) return;
    if(options.persistent){
        if(!generationFailureAlertQueue) return;
        const detailLogId = String(options.detailLogId || '');
        const detailRunId = String(options.detailRunId || '');
        const alert = document.createElement('ic-alert');
        const state = {
            detailLogId,
            detailRunId,
            headingFactory:typeof options.headingFactory === 'function'
                ? options.headingFactory
                : () => String(options.heading || tr('smart.error.unknown.title')),
            textFactory:typeof options.textFactory === 'function' ? options.textFactory : () => text,
        };
        alert.className = 'generation-failure-alert';
        alert.dataset.componentName = 'ic-alert';
        alert.setAttribute('tone', options.tone || 'danger');
        alert.setAttribute('heading', state.headingFactory());
        alert.setAttribute('action-label', tr('smart.viewDetails'));
        alert.setAttribute('dismissible', '');
        alert.textContent = String(state.textFactory() || '');
        generationFailureAlertStates.set(alert, state);
        generationFailureAlertQueue.append(alert);
        generationFailureAlertQueue.dataset.queueLength = String(generationFailureAlertStates.size);
        alert.addEventListener('ic-action', () => {
            if(state.detailLogId || state.detailRunId) openSmartCanvasLog(state.detailLogId, state.detailRunId);
        });
        alert.addEventListener('ic-dismiss', () => {
            alert.hidden = false;
            generationFailureAlertStates.delete(alert);
            generationFailureAlertQueue.dataset.queueLength = String(generationFailureAlertStates.size);
            generationFailureAlertStackReady.then(stack => stack.dismiss(alert));
        }, {once:true});
        if(generationFailureAlertStack) generationFailureAlertStack.enqueue(alert);
        else pendingGenerationFailureAlerts.push(alert);
        return alert;
    }
    const notify = () => {
        const Toast = customElements.get('ic-toast');
        if(typeof Toast?.notify !== 'function') return false;
        Toast.notify(String(text || ''), {
            tone:options.tone || 'neutral',
            duration:options.duration ?? ((options.tone || 'neutral') === 'danger' ? 0 : 1800),
            actionLabel:options.actionLabel || '',
            onAction:options.onAction
        });
        return true;
    };
    if(!notify()) customElements.whenDefined('ic-toast').then(notify);
}
function refreshPersistentToastLanguage(){
    generationFailureAlertStates.forEach((state, alert) => {
        alert.setAttribute('heading', state.headingFactory());
        alert.setAttribute('action-label', tr('smart.viewDetails'));
        alert.textContent = String(state.textFactory() || '');
    });
}
let generationCompleteSoundAt = 0;
function playGenerationCompleteSound(){
    const now = Date.now();
    if(now - generationCompleteSoundAt < 1200) return;
    generationCompleteSoundAt = now;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if(!AudioCtx) return;
        const ctx = playGenerationCompleteSound._ctx || (playGenerationCompleteSound._ctx = new AudioCtx());
        const play = () => {
            const start = ctx.currentTime + 0.015;
            [
                {freq:660, at:0, duration:0.12},
                {freq:880, at:0.12, duration:0.16}
            ].forEach(tone => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(tone.freq, start + tone.at);
                gain.gain.setValueAtTime(0.0001, start + tone.at);
                gain.gain.exponentialRampToValueAtTime(0.075, start + tone.at + 0.018);
                gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.at + tone.duration);
                osc.connect(gain).connect(ctx.destination);
                osc.start(start + tone.at);
                osc.stop(start + tone.at + tone.duration + 0.02);
            });
        };
        if(ctx.state === 'suspended') ctx.resume().then(play).catch(() => {});
        else play();
    } catch(e) {}
}
function clearImageClickTimer(){
    if(imageClickTimer){
        clearTimeout(imageClickTimer);
        imageClickTimer = null;
    }
}
let contextMenuEditorState = null;
function promptNodeEditorSurface(target){
    return target?.closest?.('.prompt-node-text, .prompt-llm-instruction') || null;
}
function isEditableTarget(target, options={}){
    const el = target || document.activeElement;
    const inactivePromptSurface = el?.closest?.(
        '.prompt-node-text[contenteditable="false"],'
        + '.prompt-llm-instruction[readonly]'
    );
    if(inactivePromptSurface) return false;
    const promptEditor = promptNodeEditorSurface(el);
    if(options.contextMenu && promptEditor){
        const wasActive = contextMenuEditorState?.editor === promptEditor
            ? contextMenuEditorState.wasActive
            : document.activeElement === promptEditor;
        return Boolean(wasActive);
    }
    return !!el?.closest?.('input, textarea, select, option, [contenteditable="true"], [role="slider"], ic-input, ic-number-input, ic-select, ic-slider, ic-color-field, ic-textarea, ic-switch, ic-generation-settings-picker, .prompt-node-control, ic-prompt-composer');
}
function safeScale(value){
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 1;
}
function nodeScale(node){
    const v = Number(node?.scale);
    if((node?.images || []).length > 1 && v === MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE) return MEDIA_GROUP_DEFAULT_SCALE;
    return Number.isFinite(v) && v > 0 ? v : 1;
}
const MEDIA_NODE_DEFAULT_SCALE = 2;
const MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE = 1.6;
const MEDIA_GROUP_DEFAULT_SCALE = 0.8;
const ZOOM_PREVIEW_NODE_DEFAULT_SCALE = 1;
const ZOOM_PREVIEW_NODE_MAX_SCALE = 1.15;
const MEDIA_GROUP_THUMB_BASE = 224;
const MEDIA_GROUP_THUMB_WIDTH_REM = 8;
const MEDIA_GROUP_MAX_VISIBLE_ROWS = 3;
// 编组卡片内的图片网格：超过这么多排就出现纵向滚动（区别于多图节点的 3 排）。
const SMART_GROUP_MAX_VISIBLE_ROWS = 4;
const EMPTY_UPLOAD_NODE_WIDTH = 316;
const EMPTY_UPLOAD_NODE_HEIGHT = 194;
const SMART_GROUP_DEFAULT_WIDTH = 340;
const SMART_GROUP_DEFAULT_HEIGHT = 286;
const SMART_GROUP_LEGACY_HEIGHT = 220;
// 分组可缩小到的最小尺寸（缩小分组时组内图片随之等比缩小，靠这个区间产生缩放系数）。
const SMART_GROUP_MIN_WIDTH = 150;
const SMART_GROUP_MIN_HEIGHT = 130;
const SMART_FRAME_DEFAULT_WIDTH = 680;
const SMART_FRAME_DEFAULT_HEIGHT = 420;
const SMART_FRAME_MIN_WIDTH = 240;
const SMART_FRAME_MIN_HEIGHT = 160;
const SMART_FRAME_COLORS = ['blue', 'violet', 'amber', 'green', 'slate'];
const SMART_FRAME_DEFAULT_COLOR = 'slate';
let smartCanvasNodeGeometrySession = null;
// 组内成员（提示词/循环）的最大缩放。已移除“放大不超过原始”的限制：向外拉分组时成员随之放大。
const SMART_GROUP_MAX_MEMBER_ZOOM = 4;
function mediaGroupThumbWidthPx(){
    const rootSize = typeof window !== 'undefined'
        && typeof window.getComputedStyle === 'function'
        && typeof document !== 'undefined'
        ? Number.parseFloat(
            window.getComputedStyle(document.documentElement).fontSize
        )
        : 16;
    return Math.max(
        28,
        Math.round(
            (Number.isFinite(rootSize) && rootSize > 0 ? rootSize : 16)
            * MEDIA_GROUP_THUMB_WIDTH_REM
        )
    );
}
function mediaNodeDefaultScale(node){
    if((node?.images || []).length > 1 && !Number.isFinite(Number(node?.scale))) return MEDIA_GROUP_DEFAULT_SCALE;
    return Number.isFinite(Number(node?.scale)) && Number(node.scale) > 0 ? Number(node.scale) : MEDIA_NODE_DEFAULT_SCALE;
}
function createImageNodeAt(point, images=[], options={}){
    const layout = imageLayout(images || [], mediaNodeDefaultScale({type:'smart-image', images:images || []}), {type:'smart-image', images:images || []});
    const mutationOptions = {...options};
    if(mutationOptions.reveal === undefined) mutationOptions.reveal = true;
    const sourceNodeId = String(mutationOptions.sourceNodeId || '');
    const relation = mutationOptions.relation === 'upstream' ? 'upstream' : 'downstream';
    delete mutationOptions.sourceNodeId;
    delete mutationOptions.relation;
    const exact = mutationOptions.positionMode === 'exact';
    if(!exact && !mutationOptions.placement){
        const anchorPoint = point || window.SmartCanvasModules.viewportSelection.viewport.center();
        mutationOptions.placement = sourceNodeId
            ? {anchor:{kind:'source',sourceNodeId},relation,arrangement:'single'}
            : {
                anchor:{kind:point ? 'point' : 'viewport',x:anchorPoint.x,y:anchorPoint.y},
                relation:'free',
                arrangement:'single'
            };
    }
    return canvasMutation.create({
        kind:'image',
        data:{
            x:(point?.x || 0) - Math.round(layout.width / 2),
            y:(point?.y || 0) - Math.round(layout.height / 2),
            images
        },
        options:mutationOptions
    });
}
function mediaLayoutSize(img){
    const width = Number(img?.natural_w || img?.width || img?.w || img?.layout_w || img?.preview_w || 0);
    const height = Number(img?.natural_h || img?.height || img?.h || img?.layout_h || img?.preview_h || 0);
    return width > 0 && height > 0 ? {width, height} : {width:0, height:0};
}
function copyMediaSizeFields(source, target={}){
    if(!source || typeof source !== 'object') return target;
    ['natural_w','natural_h','width','height','w','h','layout_w','layout_h'].forEach(key => {
        const n = Number(source[key]);
        if(Number.isFinite(n) && n > 0) target[key] = n;
    });
    return target;
}
function singleImageLayout(image, node, scale){
    const explicitW = Number(node?.w);
    const explicitH = Number(node?.h);
    if(Number.isFinite(explicitW) && explicitW > 24 && Number.isFinite(explicitH) && explicitH > 24){
        const explicitSize = mediaLayoutSize(image);
        const isStillImage = !isAudioMediaItem(image) && !isVideoMediaItem(image);
        if(isStillImage && explicitSize.width > 0 && explicitSize.height > 0){
            const ratio = explicitSize.width / explicitSize.height;
            const width = Math.round(explicitW);
            const height = Math.max(1, Math.round(width / ratio));
            node.w = width;
            node.h = height;
            return {cols:1, rows:1, width, height, thumb:Math.round(96 * scale), single:true};
        }
        return {cols:1, rows:1, width:Math.round(explicitW), height:Math.round(explicitH), thumb:Math.round(96 * scale), single:true};
    }
    // 音频没有自然宽高，否则会套用图片的 260x180 默认框，导致卡片四周大片空白。给一个贴合内容的紧凑尺寸。
    if(isAudioMediaItem(image)){
        return {cols:1, rows:1, width:Math.round(288 * scale), height:Math.round(150 * scale), thumb:Math.round(96 * scale), single:true};
    }
    const layoutSize = mediaLayoutSize(image);
    const naturalW = layoutSize.width;
    const naturalH = layoutSize.height;
    if(naturalW > 0 && naturalH > 0){
        const maxW = 260 * scale;
        const maxH = 220 * scale;
        const fit = Math.min(maxW / naturalW, maxH / naturalH);
        return {
            cols:1,
            rows:1,
            width:Math.max(1, Math.round(naturalW * fit)),
            height:Math.max(1, Math.round(naturalH * fit)),
            thumb:Math.round(96 * scale),
            single:true
        };
    }
    return {cols:1, rows:1, width:Math.round(260*scale), height:Math.round(180*scale), thumb:Math.round(96*scale), single:true};
}
function groupImageGridLayout(count, explicitW, explicitH, maxThumb, pad=32, gap=8, maxVisibleRows=MEDIA_GROUP_MAX_VISIBLE_ROWS){
    let best = null;
    for(let cols = 1; cols <= count; cols++){
        const rows = Math.ceil(count / cols);
        const visibleRows = Math.min(Math.max(1, maxVisibleRows), rows);
        const availableW = explicitW - pad - (cols - 1) * gap;
        const availableH = explicitH - pad - (visibleRows - 1) * gap;
        if(availableW <= 0 || availableH <= 0) continue;
        const rawThumb = Math.floor(Math.min(availableW / cols, availableH / visibleRows));
        const fittedThumb = Math.max(28, Math.min(maxThumb, rawThumb));
        const fits = rawThumb >= 28;
        const usedW = cols * fittedThumb + (cols - 1) * gap + pad;
        const usedH = visibleRows * fittedThumb + (visibleRows - 1) * gap + pad;
        const spareW = Math.max(0, explicitW - usedW);
        const spareH = Math.max(0, explicitH - usedH);
        const atMax = fittedThumb >= maxThumb;
        const score = [
            fits ? 1 : 0,
            fittedThumb,
            atMax ? cols : 0,
            -(spareW + spareH * 0.35),
            -rows
        ];
        let better = !best;
        if(best){
            for(let i = 0; i < score.length; i++){
                if(score[i] === best.score[i]) continue;
                better = score[i] > best.score[i];
                break;
            }
        }
        if(better){
            best = {cols, rows, visibleRows, thumb:fittedThumb, score};
        }
    }
    const fallbackCols = Math.min(count, 2);
    const fallbackRows = Math.ceil(count / fallbackCols);
    return best || {cols:fallbackCols, rows:fallbackRows, visibleRows:Math.min(MEDIA_GROUP_MAX_VISIBLE_ROWS, fallbackRows), thumb:28};
}
function smartNodeInputThumbRows(count){
    return count ? Math.ceil(Math.min(10, count) / 5) : 0;
}
function smartNodeInputThumbsHeight(images){
    const rows = smartNodeInputThumbRows((images || []).length);
    return rows ? rows * 44 + (rows - 1) * 6 + 8 : 0;
}
function promptNodeInputThumbsHeight(images){
    return (images || []).some(img => img?.url) ? 53 : 0;
}
function promptNodeInputImages(node){
    return promptNodeInputMediaForLLM(node).filter(img => img?.url);
}
function promptNodeInputMediaForLLM(node){
    const pinned = Array.isArray(node?.llmInputMedia) ? node.llmInputMedia.filter(ref => ref?.url) : [];
    const manual = manualReferenceImagesFor(node);
    const connected = inputImagesFor(node)
        .filter(ref => ref?.url);
    const seen = new Set();
    const refs = [...pinned, ...connected, ...manual].filter(ref => {
        const key = `${mediaKindForItem(ref)}:${ref.url}`;
        if(seen.has(key) || isInputRefBlocked(node, ref)) return false;
        seen.add(key);
        return true;
    });
    return orderReferenceImagesForNode(node, refs);
}
function composerInputMediaLabel(img, mediaCounters={}){
    const kind = mediaKindForItem(img);
    const count = (mediaCounters[kind] = (mediaCounters[kind] || 0) + 1);
    const frameRoleLabel = isApiLikeEngine(settings.engine)
        && settings.apiKind === 'video'
        && settings.videoUseFrameRoles
        && kind === 'image'
        ? (count === 1 ? tr('smart.videoFirstFrame') : count === 2 ? tr('smart.videoLastFrame') : '')
        : '';
    return frameRoleLabel || trf('smart.mediaNumber', {
        kind:kind === 'audio'
            ? tr('smart.kindAudio')
            : kind === 'video'
            ? tr('smart.kindVideo')
            : tr('smart.kindImage'),
        count
    });
}
function composerInputMediaThumbHtml(node, img, index, manualRefKeys=new Set(), mediaCounters={}){
    const kind = mediaKindForItem(img);
    const isSelf = node ? isSelfReferenceForNode(node, img) : false;
    const title = isSelf ? tr('smart.inputSelf') : tr('smart.inputUpstream');
    const label = composerInputMediaLabel(img, mediaCounters);
    const sourceUrl = img.originalLocalUrl || img.url || '';
    const key = inputRefKey(img);
    const isManual = manualRefKeys.has(key);
    const original = smartOriginalMediaUrl(img);
    const preview = kind === 'audio' ? '' : smartMediaPreviewUrl(img, 512);
    const src = kind === 'image' && !smartImagePerformanceOptimization
        ? displayMediaUrl({...img, url:original})
        : preview;
    return `<ic-reference-thumbnail class="${isSelf ? 'input-self' : ''} ${isManual ? 'input-manual-ref' : ''}" kind="${escapeAttr(kind)}" label="${escapeAttr(label)}" src="${escapeAttr(src)}" preview-src="${escapeAttr(preview)}" original-src="${escapeAttr(original)}" alt="" removable remove-label="${escapeAttr(tr('smart.removeReference'))}" draggable="false" data-input-remove-reference="${escapeAttr(key)}" data-thumb-index="${index}" data-node-id="${escapeAttr(img.nodeId || '')}" data-image-index="${img.imageIndex ?? ''}" data-output-id="${escapeAttr(img.outputId || '')}" data-input-instance-id="${escapeAttr(img.inputInstanceId || '')}" data-url="${escapeAttr(img.url || '')}" data-source-url="${escapeAttr(sourceUrl)}" data-name="${escapeAttr(img.name || label)}" title="${escapeAttr(`${img.name || tr('smart.inputNum').replace('{n}', String(index + 1))} · ${title}`)}"></ic-reference-thumbnail>`;
}
function promptNodeInputThumbsHtml(node){
    const refs = promptNodeInputImages(node);
    if(!refs.length) return '';
    const manualRefKeys = new Set(manualReferenceImagesFor(node).map(img => inputRefKey(img)));
    const mediaCounters = {image:0, video:0, audio:0, text:0, file:0};
    const thumbs = refs.map((img, index) => composerInputMediaThumbHtml(node, img, index, manualRefKeys, mediaCounters)).join('');
    return `<div class="input-thumbs-row prompt-node-input-thumbs prompt-node-control has-items"><div class="input-thumb-list ${refs.length > 1 ? 'is-scrollable' : 'is-single'}">${thumbs}</div></div>`;
}
function smartNodeInputThumbsHtml(images, opts={}){
    const refs = (images || []).filter(img => img?.url);
    if(!refs.length) return '';
    const limit = Math.min(10, refs.length);
    const items = refs.slice(0, limit).map((img, index) => {
        const label = opts.labelPrefix ? `${opts.labelPrefix}${index + 1}` : trf('canvas.imageNumber', {number: index + 1});
        const media = isAudioMediaItem(img)
            ? `<div class="media-thumb audio-thumb"><i data-lucide="file-audio"></i><span>${escapeHtml(img.name || 'Audio')}</span></div>`
            : isVideoMediaItem(img)
            ? smartVideoPreviewHtml(img, 512, 'alt=""')
            : smartPreviewImgHtml(img, 512, 'alt=""');
        return `<div class="smart-node-input-thumb" title="${escapeHtml(label)}">${media}<span class="smart-node-input-badge">${escapeHtml(label)}</span></div>`;
    }).join('');
    const more = refs.length > limit ? `<div class="smart-node-input-thumb smart-node-input-more">+${refs.length - limit}</div>` : '';
    return `<div class="smart-node-input-thumbs">${items}${more}</div>`;
}
const PROMPT_LLM_INSTRUCTION_DEFAULT_H = 58;
const PROMPT_LLM_INSTRUCTION_MIN_H = 40;
const PROMPT_LLM_INSTRUCTION_MAX_H = 400;
const PROMPT_SPLIT_PREVIEW_DEFAULT_H = 70;
const PROMPT_SPLIT_PREVIEW_MIN_H = 40;
const PROMPT_SPLIT_PREVIEW_MAX_H = 220;
const PROMPT_SPLIT_RESIZE_BAR_H = 9;
function promptLlmInstructionHeight(node){
    const h = Number(node?.llmInstructionHeight);
    if(!Number.isFinite(h)) return PROMPT_LLM_INSTRUCTION_DEFAULT_H;
    return Math.max(PROMPT_LLM_INSTRUCTION_MIN_H, Math.min(PROMPT_LLM_INSTRUCTION_MAX_H, Math.round(h)));
}
function promptNodeSeparator(node){
    const raw = String(node?.promptSeparator ?? ';');
    return raw === '' ? ';' : raw;
}
function promptNodePromptItems(node){
    const text = String(node?.text || '').trim();
    return text ? [text] : [];
}
function promptNodeSplitExtraHeight(node){
    if(node?.promptSplitEnabled !== true) return 0;
    return 25 + promptNodeSplitPreviewHeight(node) + PROMPT_SPLIT_RESIZE_BAR_H;
}
function promptNodeSplitPreviewHeight(node){
    const h = Number(node?.promptSplitPreviewHeight);
    if(!Number.isFinite(h)) return PROMPT_SPLIT_PREVIEW_DEFAULT_H;
    return Math.max(PROMPT_SPLIT_PREVIEW_MIN_H, Math.min(PROMPT_SPLIT_PREVIEW_MAX_H, Math.round(h)));
}
function syncPromptNodeHeightForSplit(node, prevExtra=0){
    if(!node) return;
    const nextExtra = promptNodeSplitExtraHeight(node);
    const explicitH = Number(node.h);
    const currentH = Number.isFinite(explicitH) ? explicitH : 0;
    const fallbackH = promptNodeMinHeight(node);
    node.h = Math.max(fallbackH, currentH ? currentH - Math.max(0, prevExtra) + nextExtra : fallbackH);
    node.w = Math.max(Number(node.w) || 0, 316);
}
function promptNodeMinHeight(node){
    return node?.llmEnabled ? promptNodeExpandedHeight(node) : 180;
}
function promptTextItemsForNode(node, ctx=smartLoopContext){
    if(!node) return [];
    if(node.type === 'smart-prompt') return promptNodePromptItems(node);
    if(node.type === 'smart-splitter') return splitterNodePromptItems(node, ctx);
    if(node.type === 'smart-loop'){
        const text = smartLoopPrompt(node, ctx);
        return text ? [text] : [];
    }
    if(node.type === 'smart-group') return smartContainer.groupMembers(node).flatMap(member => promptTextItemsForNode(member, ctx));
    return [];
}
function promptNodeUpstreamPromptItems(node, ctx=smartLoopContext){
    const seen = new Set();
    return inputNodesFor(node).flatMap(input => promptTextItemsForNode(input, ctx)).map(text => String(text || '').trim()).filter(text => {
        if(!text || seen.has(text)) return false;
        seen.add(text);
        return true;
    });
}
function promptNodeUpstreamPromptText(node, ctx=smartLoopContext){
    return promptNodeUpstreamPromptItems(node, ctx).join('\n\n');
}
function promptNodeLLMInputText(node, ctx=smartLoopContext){
    const upstream = promptNodeUpstreamPromptText(node, ctx).trim();
    const instruction = String(node?.llmInstruction || '').trim() || promptNodePromptItems(node).join('\n\n').trim();
    return [upstream, instruction].filter(Boolean).join('\n\n');
}
function promptNodeExpandedHeight(node){
    const geometryNode = {
        ...node,
        id:String(node?.id || '__prompt_geometry__'),
        promptHasInputMedia:promptNodeInputImages(node).length > 0,
        promptHasUpstreamText:Boolean(
            node?.llmEnabled && promptNodeUpstreamPromptItems(node).length
        )
    };
    delete geometryNode.w;
    delete geometryNode.h;
    const measurement = nodeGeometry.createSession({
        nodes:[geometryNode],
        connections:[]
    }).measure(geometryNode.id);
    if(!measurement.supported){
        throw new Error('Node Geometry could not measure Prompt Node');
    }
    return measurement.footprint.height;
}
function promptNodeLayoutSize(node){
    const oldCollapsedH = 230;
    const oldExpandedH = node?.llmSystemEnabled ? 400 : 340;
    const explicitW = Number(node?.w);
    const explicitH = Number(node?.h);
    if(smartContainer.isCompactMember(node) && Number.isFinite(explicitW) && explicitW > 24 && Number.isFinite(explicitH) && explicitH > 24){
        return {width:Math.round(explicitW), height:Math.round(explicitH)};
    }
    const width = !Number.isFinite(explicitW) || explicitW === 360 ? 316 : explicitW;
    const fallbackH = promptNodeMinHeight(node);
    const legacyExpandedH = node?.llmSystemEnabled ? 344 : 292;
    const height = !Number.isFinite(explicitH) || explicitH === 194 || explicitH === oldCollapsedH || explicitH === oldExpandedH || explicitH === legacyExpandedH
        ? fallbackH
        : Math.max(explicitH, fallbackH);
    return {width:Math.round(width), height:Math.round(height)};
}
const splitterPromptVisiting = new Set();
function splitterNodeSeparator(node){
    const raw = String(node?.separator ?? ';');
    return raw === '' ? ';' : raw;
}
function splitterNodeInputItems(node, ctx=smartLoopContext){
    if(!node?.id || splitterPromptVisiting.has(node.id)) return [];
    splitterPromptVisiting.add(node.id);
    try {
        return inputNodesFor(node)
            .flatMap(input => promptTextItemsForNode(input, ctx))
            .map(text => String(text || '').trim())
            .filter(Boolean);
    } finally {
        splitterPromptVisiting.delete(node.id);
    }
}
function splitterNodePromptItems(node, ctx=smartLoopContext){
    const separator = splitterNodeSeparator(node);
    return splitterNodeInputItems(node, ctx).flatMap(text => {
        if(!separator) return [text];
        const items = text.split(separator)
            .map(item => item.trim())
            .filter(Boolean);
        return items.length ? items : [text];
    });
}
function splitterNodeLayoutSize(node){
    const width = Math.max(260, Number(node?.w) || 316);
    const height = Math.max(150, Number(node?.h) || 240);
    return {width:Math.round(width), height:Math.round(height)};
}
// 编组的图片网格布局：跟多图节点一致，但可见排数上限为 4（超过出现滚动），且缩略图无放大上限
//（用户拉大分组时图片随之变大，不再封顶在原始尺寸）。
function smartGroupImageGridLayout(node){
    const images = (node?.images || []).filter(img => img?.url);
    const count = images.length;
    const s = mediaNodeDefaultScale(node);
    if(count === 1){
        const single = singleImageLayout(images[0], node, s);
        const explicitW = Number(node?.w), explicitH = Number(node?.h);
        const hasExplicit = Number.isFinite(explicitW) && explicitW > 24 && Number.isFinite(explicitH) && explicitH > 24;
        // 容器有 16px 内边距（PAD=32）；无显式尺寸时把外框放大 PAD，以包住图片，避免“分组比图片还小”。
        return hasExplicit ? single : {...single, width:single.width + 32, height:single.height + 32};
    }
    const baseThumb = Math.round(MEDIA_GROUP_THUMB_BASE * s);
    const cell = baseThumb + 8;
    const PAD = 32;
    const explicitW = Number(node?.w);
    const explicitH = Number(node?.h);
    const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))));
    const rows = Math.ceil(count / cols);
    const visibleRows = Math.min(SMART_GROUP_MAX_VISIBLE_ROWS, rows);
    if(Number.isFinite(explicitW) && explicitW > 40 && Number.isFinite(explicitH) && explicitH > 40){
        // 用户拉伸过分组：按显式尺寸拟合，maxThumb 给一个极大值以解除“放大不超过原始”的限制。
        const fitted = groupImageGridLayout(count, explicitW, explicitH, 100000, PAD, 8, SMART_GROUP_MAX_VISIBLE_ROWS);
        return {cols:fitted.cols, rows:fitted.rows, visibleRows:fitted.visibleRows, width:Math.round(explicitW), height:fitted.visibleRows * (fitted.thumb + 8) - 8 + PAD, thumb:fitted.thumb};
    }
    const width = Math.max(Math.round(226 * s), cols * cell + PAD);
    const height = visibleRows * cell - 8 + PAD;
    return {cols, rows, visibleRows, width, height, thumb:baseThumb};
}
function nodeGeometrySingleImageLayout(images,node){
    if(
        !node
        || !Array.isArray(images)
        || images.length !== 1
        || !['smart-image',''].includes(String(node.type || ''))
    ){
        return null;
    }
    const liveNode = node.id
        ? nodes.find(candidate => candidate.id === node.id)
        : null;
    const useRenderSession =
        smartCanvasNodeGeometrySession
        && liveNode === node
        && images === node.images;
    const geometryNode = useRenderSession
        ? node
        : {
            ...node,
            id:String(node.id || '__single_image_geometry__'),
            images
        };
    const session = useRenderSession
        ? smartCanvasNodeGeometrySession
        : nodeGeometry.createSession({
            nodes:[geometryNode],
            connections:[]
        });
    const measured = session.measure(geometryNode.id);
    return measured.supported ? measured.layout : null;
}
function generationOutputMediaDisplaySize(node){
    if(!node?.generationOutputNode || !(node.images || []).length) return null;
    const layout = imageLayout(node.images || [],nodeScale(node),node);
    const width = Number(layout.generationOutput ? layout.mainWidth : layout.width);
    const height = Number(layout.generationOutput ? layout.mainHeight : layout.height);
    return Number.isFinite(width) && width > 24 && Number.isFinite(height) && height > 24
        ? {width:Math.round(width),height:Math.round(height)}
        : null;
}
function preserveGenerationOutputMediaDisplaySize(node,size){
    const width = Number(size?.width);
    const height = Number(size?.height);
    if(!node?.generationOutputNode
        || !Number.isFinite(width)
        || width <= 24
        || !Number.isFinite(height)
        || height <= 24){
        return false;
    }
    node.generationMediaW = Math.round(width);
    node.generationMediaH = Math.round(height);
    return true;
}
function mediaAspectRatio(item){
    const size = mediaLayoutSize(item);
    if(size.width > 0 && size.height > 0) return size.width / size.height;
    return 1;
}
function multiMediaGridHeight(images, cols, thumb, visibleRows){
    const rows = [];
    const rowCount = Math.min(
        Math.ceil((images || []).length / Math.max(1, cols)),
        Math.max(1, visibleRows)
    );
    for(let row = 0; row < rowCount; row += 1){
        const items = (images || []).slice(row * cols, row * cols + cols);
        const mediaHeight = Math.max(...items.map(item => (
            Math.round(thumb / Math.max(.05, mediaAspectRatio(item)))
        )), 1);
        rows.push(mediaHeight + 20);
    }
    return rows.reduce((sum, height) => sum + height, 0) + Math.max(0, rows.length - 1) * 8;
}
function boundedMultiMediaGridLayout(
    images,
    explicitW,
    explicitH,
    {
        pad=32,
        summarySpace=0,
        gap=8,
        fixedCols=0
    }={}
){
    const count = Math.max(1,(images || []).length);
    const maxThumb = mediaGroupThumbWidthPx();
    const innerWidth = Math.max(28,Number(explicitW) - pad);
    const capacity = Math.max(
        1,
        Math.floor((innerWidth + gap) / (maxThumb + gap))
    );
    const cols = Math.max(
        1,
        Math.min(
            count,
            Number(fixedCols) > 0 ? Math.round(fixedCols) : capacity
        )
    );
    const thumb = Math.max(
        28,
        Math.min(
            maxThumb,
            Math.floor((innerWidth - Math.max(0,cols - 1) * gap) / cols)
        )
    );
    const rows = Math.ceil(count / cols);
    const fullGridHeight = multiMediaGridHeight(
        images,
        cols,
        thumb,
        rows
    );
    const availableHeight = Math.max(
        1,
        Math.floor(Number(explicitH) - pad - summarySpace)
    );
    return {
        cols,
        rows,
        visibleRows:rows,
        thumb,
        gridHeight:Math.min(fullGridHeight,availableHeight),
        fullGridHeight
    };
}
function imageLayout(images, scale=1, node=null){
    if(node?.type === 'smart-brush') return {cols:1, rows:1, width:Math.max(1, Number(node.w) || 1), height:Math.max(1, Number(node.h) || 1), thumb:1, single:true};
    if(node?.type === 'smart-text') return {cols:1, rows:1, ...smartTextAnnotationLayout(node), thumb:1, single:true};
    if(node?.type === 'smart-frame') return {cols:1, rows:1, ...smartContainer.layout(node), thumb:1, single:true};
    if(node?.type === 'smart-group'){
        const groupThumbLayout = smartContainer.thumbLayout(node);
        if(groupThumbLayout) return groupThumbLayout;
        return {cols:1, rows:1, ...smartContainer.layout(node), thumb:96, single:true};
    }
    if(node?.type === 'smart-prompt') return {cols:1, rows:1, ...promptNodeLayoutSize(node), thumb:96, single:true};
    if(node?.type === 'smart-splitter') return {cols:1, rows:1, ...splitterNodeLayoutSize(node), thumb:96, single:true};
    if(node?.type === 'smart-loop'){
        const explicitW = Number(node.w);
        const explicitH = Number(node.h);
        if(smartContainer.isCompactMember(node) && Number.isFinite(explicitW) && explicitW > 24 && Number.isFinite(explicitH) && explicitH > 24){
            return {cols:1, rows:1, width:Math.round(explicitW), height:Math.round(explicitH), thumb:96, single:true};
        }
        return {cols:1, rows:1, width:Math.round(Number(node.w) || smartLoopWidth(node)), height:Math.round(Math.max(Number(node.h) || 0, smartLoopHeight(node))), thumb:96, single:true};
    }
    const geometryLayout = nodeGeometrySingleImageLayout(images,node);
    if(geometryLayout) return geometryLayout;
    const count = (images || []).length;
    const s = node?.type === 'smart-image' || !node?.type ? mediaNodeDefaultScale(node) : (Number.isFinite(scale) && scale > 0 ? scale : 1);
    if(count === 0){
        const explicitW = Number(node?.w);
        const explicitH = Number(node?.h);
        const pending = Number(node?.pending) > 0 || Boolean(node?.queued);
        const fallbackW = pending ? 260 * s : EMPTY_UPLOAD_NODE_WIDTH;
        const fallbackH = pending ? 180 * s : EMPTY_UPLOAD_NODE_HEIGHT;
        return {
            cols:1,
            rows:1,
            width:Math.round(Number.isFinite(explicitW) && explicitW > 24 ? explicitW : fallbackW),
            height:Math.round(pending
                ? (Number.isFinite(explicitH) && explicitH > 24 ? explicitH : fallbackH)
                : Math.max(Number.isFinite(explicitH) && explicitH > 24 ? explicitH : 0, fallbackH)),
            thumb:Math.round(96*s),
            single:true
        };
    }
    if(count === 1) return singleImageLayout(images[0], node, s);
    const thumb = Math.min(
        mediaGroupThumbWidthPx(),
        Math.round(MEDIA_GROUP_THUMB_BASE * s)
    );
    const cell = thumb + 8;
    const PAD = 32; // group-node has 16px padding on each side
    const grid = images.find(img => img?.grid?.type === 'grid-split')?.grid;
    const explicitW = Number(node?.w);
    const explicitH = Number(node?.h);
    if(grid){
        const cols = Math.max(1, Number(grid.cols || 1));
        const rows = Math.max(1, Number(grid.rows || 1));
        const visibleRows = Math.min(MEDIA_GROUP_MAX_VISIBLE_ROWS, rows);
        if(Number.isFinite(explicitW) && explicitW > 40 && Number.isFinite(explicitH) && explicitH > 40){
            const fitted = boundedMultiMediaGridLayout(
                images,
                explicitW,
                explicitH,
                {pad:PAD,gap:8,fixedCols:cols}
            );
            return {
                ...fitted,
                width:Math.round(explicitW),
                height:Math.round(explicitH)
            };
        }
        const gridHeight = multiMediaGridHeight(images, cols, thumb, visibleRows);
        return {cols, rows, visibleRows, width:Math.max(Math.round(226*s), cols * cell + PAD), height:gridHeight + PAD, thumb, gridHeight};
    }
    const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))));
    const rows = Math.ceil(count / cols);
    const visibleRows = Math.min(MEDIA_GROUP_MAX_VISIBLE_ROWS, rows);
    if(Number.isFinite(explicitW) && explicitW > 40 && Number.isFinite(explicitH) && explicitH > 40){
        const fitted = boundedMultiMediaGridLayout(
            images,
            explicitW,
            explicitH,
            {pad:PAD,gap:8}
        );
        return {
            ...fitted,
            width:Math.round(explicitW),
            height:Math.round(explicitH)
        };
    }
    const width = Math.max(Math.round(226*s), cols * cell + PAD);
    const gridHeight = multiMediaGridHeight(images, cols, thumb, visibleRows);
    const height = gridHeight + PAD;
    return {cols, rows, visibleRows, width, height, thumb, gridHeight};
}
function smartLoopCount(node){
    return Math.max(1, Math.min(100, Number(node?.count || 1) || 1));
}
function smartLoopWidth(node){
    return 360;
}
function smartLoopHeight(node){
    let h = 406;
    if(node?.imageInput){
        const previewHeight = smartNodeInputThumbsHeight(smartLoopPreviewImages(node));
        h += previewHeight ? previewHeight + 10 : 42;
    }
    if(node?.showPrompt) {
        const promptCount = Math.max(1, smartLoopPromptFieldValues(node).length);
        h += 60 + promptCount * 58 + smartLoopUpstreamPromptPreviewHeight(node);
    }
    return h;
}
function fitSmartLoopNode(node){
    if(!node || node.type !== 'smart-loop') return;
    node.w = smartLoopWidth(node);
    node.h = smartLoopHeight(node);
}
function nodeRect(node){
    const layout = imageLayout(node.images || [], nodeScale(node), node);
    return {x:node.x || 0, y:node.y || 0, width:layout.width, height:layout.height};
}
function smartArrangeAtomicIds(ids){
    const out = new Set((ids || []).filter(id => nodes.some(n => n.id === id)));
    let changed = true;
    while(changed){
        changed = false;
        nodes.filter(node => smartContainer.isGroup(node)).forEach(container => {
            (container.items || []).forEach(itemId => {
                if(!out.has(itemId)) return;
                out.delete(itemId);
                out.add(container.id);
                changed = true;
            });
        });
    }
    return [...out];
}
function arrangeSelectedSmartNodes(mode='grid'){
    if(!canvas) return;
    const explicit = window.SmartCanvasModules.viewportSelection.selection.ids().filter(id => nodes.some(n => n.id === id));
    if(explicit.length < 2) return;
    const ids = smartArrangeAtomicIds(explicit);
    if(ids.length < 2) return;
    const arrangement = window.SmartCanvasModules.selectionArrangement;
    if(!arrangement?.plan) throw new Error('Selection Arrangement Module failed to load');
    const measuredNodes = nodes.map(node => {
        const rect = nodeRect(node);
        return {...node,width:rect.width,height:rect.height};
    });
    const plan = arrangement.plan({
        nodes:measuredNodes,
        connections:canvas.connections || [],
        selectedIds:ids,
        mode
    });
    if(!plan.ok) return;
    const selectedNodes = ids.map(id => nodes.find(node => node.id === id)).filter(Boolean);
    const ownerFrames = selectedNodes.map(node => smartContainer.frameFor(node.id));
    const sharedFrame = ownerFrames.length
        && ownerFrames.every(frame => frame?.id === ownerFrames[0]?.id)
        ? ownerFrames[0]
        : null;
    const frameUpdates = [];
    if(sharedFrame){
        const frameRect = nodeRect(sharedFrame);
        const sizesById = new Map(measuredNodes.map(node => [node.id,node]));
        const arrangedRects = plan.placements.map(position => {
            const size = sizesById.get(position.id);
            return {
                x:position.x,
                y:position.y,
                width:size?.width || 1,
                height:size?.height || 1
            };
        });
        const left = Math.min(frameRect.x,...arrangedRects.map(rect => rect.x - 24));
        const top = Math.min(frameRect.y,...arrangedRects.map(rect => rect.y - 54));
        const right = Math.max(
            frameRect.x + frameRect.width,
            ...arrangedRects.map(rect => rect.x + rect.width + 24)
        );
        const bottom = Math.max(
            frameRect.y + frameRect.height,
            ...arrangedRects.map(rect => rect.y + rect.height + 24)
        );
        frameUpdates.push({
            id:sharedFrame.id,
            x:left,
            y:top,
            w:right-left,
            h:bottom-top
        });
    }
    if(!canvasMutation.arrange({placements:plan.placements,frameUpdates})) return;
    const label = mode === 'horizontal'
        ? tr('smart.layoutHorizontal')
        : mode === 'vertical'
            ? tr('smart.layoutVertical')
            : mode === 'tree'
                ? tr('smart.layoutTree')
                : tr('smart.layoutGrid');
    toast(trf('smart.layoutDone', {layout: label}));
}
function isSmartAnnotationNode(node){
    return node?.type === 'smart-brush' || nodeKinds.isTextAnnotation(node);
}
function smartPromptNodeTitle(node){
    const title = String(node?.title || '').trim();
    if(nodeKinds.isPromptGeneration(node)){
        if(!title || ['文本', 'Text', '文本生成', 'Text Generation', tr('smart.kindText')].includes(title)){
            return tr('smart.promptGenerationNode');
        }
        return title;
    }
    if(!title || ['文本', 'Text', tr('smart.kindText')].includes(title)){
        return tr('smart.promptNode');
    }
    return title;
}
function smartTextFontSize(size=smartTextSize){
    return ({small:18, medium:28, large:42})[size] || 28;
}
function smartAnnotationPathData(points=[]){
    if(!points.length) return '';
    if(points.length === 1) return `M ${Number(points[0]?.[0] || 0).toFixed(1)} ${Number(points[0]?.[1] || 0).toFixed(1)}`;
    let path = `M ${Number(points[0]?.[0] || 0).toFixed(1)} ${Number(points[0]?.[1] || 0).toFixed(1)}`;
    for(let index = 1; index < points.length - 1; index += 1){
        const current = points[index];
        const next = points[index + 1];
        const midX = (Number(current?.[0] || 0) + Number(next?.[0] || 0)) / 2;
        const midY = (Number(current?.[1] || 0) + Number(next?.[1] || 0)) / 2;
        path += ` Q ${Number(current?.[0] || 0).toFixed(1)} ${Number(current?.[1] || 0).toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
    }
    const last = points[points.length - 1];
    path += ` L ${Number(last?.[0] || 0).toFixed(1)} ${Number(last?.[1] || 0).toFixed(1)}`;
    return path;
}
function smartTextAnnotationLayout(node){
    const fontSize = smartTextFontSize(node?.textSize);
    const lines = String(node?.text || tr('smart.annotationDefault')).split('\n');
    const estimatedWidth = Math.max(...lines.map(line => Math.max(1, [...line].length))) * fontSize * .62;
    return {
        width:Math.max(24, Math.round(Number(node?.w) || Math.min(480, estimatedWidth))),
        height:Math.max(Math.ceil(fontSize * 1.24), Math.round(Number(node?.h) || lines.length * fontSize * 1.24))
    };
}
function refreshSmartAnnotationToolbar(){
    const brushActive = smartBaseTool === 'brush';
    const textActive = smartBaseTool === 'text';
    const frameActive = smartBaseTool === 'frame';
    const pointerActive = smartBaseTool === 'pointer';
    const handActive = smartBaseTool === 'hand';
    const temporaryPan = smartSpacePan || smartMiddlePan;
    smartAnnotationTool = brushActive ? 'brush' : textActive ? 'text' : '';
    smartFrameToolActive = frameActive;
    smartPointerTool?.classList.toggle('active', pointerActive);
    smartHandTool?.classList.toggle('active', handActive || temporaryPan);
    smartHandTool?.classList.toggle('temporary-active', !handActive && temporaryPan);
    smartBrushTool?.classList.toggle('active', brushActive);
    smartTextTool?.classList.toggle('active', textActive);
    smartFrameTool?.classList.toggle('active', frameActive);
    smartPointerTool?.toggleAttribute('pressed', pointerActive);
    smartHandTool?.toggleAttribute('pressed', handActive);
    smartBrushTool?.toggleAttribute('pressed', brushActive);
    smartTextTool?.toggleAttribute('pressed', textActive);
    smartFrameTool?.toggleAttribute('pressed', frameActive);
    smartPointerTool?.setAttribute('aria-pressed', pointerActive ? 'true' : 'false');
    smartHandTool?.setAttribute('aria-pressed', handActive ? 'true' : 'false');
    if(smartHandTool) smartHandTool.dataset.temporaryActive = temporaryPan ? 'true' : 'false';
    smartBrushTool?.setAttribute('aria-pressed', brushActive ? 'true' : 'false');
    smartTextTool?.setAttribute('aria-pressed', textActive ? 'true' : 'false');
    smartFrameTool?.setAttribute('aria-pressed', frameActive ? 'true' : 'false');
    smartBrushOptions?.classList.toggle('open', brushActive && smartAnnotationOptionsOpen);
    syncSmartTextOptions();
    document.body.classList.toggle('smart-annotation-brush', brushActive);
    document.body.classList.toggle('smart-annotation-text', textActive);
    document.body.classList.toggle('smart-frame-tool', frameActive);
    document.body.classList.toggle('smart-temporary-pan', temporaryPan);
    shell?.classList.toggle('tool-pointer', pointerActive);
    shell?.classList.toggle('tool-hand', handActive);
    shell?.classList.toggle('temporary-pan', temporaryPan);
    smartAnnotationCursor?.classList.toggle('is-brush', brushActive);
    smartAnnotationCursor?.classList.toggle('is-text', textActive);
    if(smartAnnotationCursorSymbol) smartAnnotationCursorSymbol.textContent = textActive ? '+' : '';
    if(smartAnnotationCursorLabel) smartAnnotationCursorLabel.textContent = textActive ? tr('smart.annotationAdd') : '';
    if((pointerActive || handActive || temporaryPan || frameActive) && smartAnnotationCursor) smartAnnotationCursor.hidden = true;
    document.querySelectorAll('[data-smart-brush-size]').forEach(button => button.classList.toggle('active', Number(button.dataset.smartBrushSize) === smartBrushSize));
    document.querySelectorAll('[data-smart-brush-color]').forEach(button => button.classList.toggle('active', String(button.dataset.smartBrushColor || '').toLowerCase() === smartBrushColor.toLowerCase()));
    document.querySelectorAll('[data-smart-text-size]').forEach(button => button.classList.toggle('active', button.dataset.smartTextSize === smartTextSize));
}
function smartEffectiveTool(){
    return smartSpacePan || smartMiddlePan ? 'hand' : smartBaseTool;
}
function clearSmartCanvasDockShortcutHover(){
    smartCanvasDock?.classList.remove('suppress-shortcut-hover');
    smartCanvasDock?.querySelectorAll('.smart-canvas-dock-btn').forEach(button => {
        button.removeAttribute('tooltip-disabled');
    });
}
function focusSmartCanvasAfterToolShortcut(){
    smartCanvasDock?.classList.add('suppress-shortcut-hover');
    smartCanvasDock?.querySelectorAll('.smart-canvas-dock-btn').forEach(button => {
        button.setAttribute('tooltip-disabled', '');
        button.hideTooltip?.();
    });
    window.removeEventListener('pointermove', clearSmartCanvasDockShortcutHover, true);
    window.addEventListener('pointermove', clearSmartCanvasDockShortcutHover, {
        capture:true,
        once:true
    });
    shell?.focus({preventScroll:true});
}
function setSmartBaseTool(tool='pointer', options={}){
    const next = ['pointer','hand','brush','text','frame'].includes(tool) ? tool : 'pointer';
    if(next !== smartBaseTool) smartMultiInputCancel();
    if(smartAnnotationStroke && next !== smartBaseTool) cancelSmartAnnotationStroke();
    smartBaseTool = next;
    smartAnnotationTool = next === 'brush' || next === 'text' ? next : '';
    smartFrameToolActive = next === 'frame';
    if(!options.keepOptions) smartAnnotationOptionsOpen = false;
    closeCreateMenu();
    closeSmartNodeContextMenu();
    refreshSmartAnnotationToolbar();
}
function setSmartAnnotationTool(tool=''){
    const next = tool === 'brush' || tool === 'text' ? tool : '';
    if(smartBaseTool === next){
        smartAnnotationOptionsOpen = !smartAnnotationOptionsOpen;
    } else {
        smartMultiInputCancel();
        smartBaseTool = next || 'pointer';
        smartAnnotationTool = next;
        smartFrameToolActive = false;
        smartAnnotationOptionsOpen = Boolean(next);
    }
    closeCreateMenu();
    closeSmartNodeContextMenu();
    refreshSmartAnnotationToolbar();
}
function activateSmartAnnotationTool(tool=''){
    const next = tool === 'brush' || tool === 'text' ? tool : '';
    if(!next){
        deactivateSmartAnnotationTool();
        return;
    }
    if(smartAnnotationStroke) cancelSmartAnnotationStroke();
    smartAnnotationOptionsOpen = true;
    setSmartBaseTool(next, {keepOptions:true});
}
function deactivateSmartAnnotationTool(){
    if(smartAnnotationStroke) cancelSmartAnnotationStroke();
    smartAnnotationTool = '';
    smartAnnotationOptionsOpen = false;
    if(smartBaseTool === 'brush' || smartBaseTool === 'text') setSmartBaseTool('pointer');
    else refreshSmartAnnotationToolbar();
}
function deactivateSmartFrameTool(){
    smartFrameToolActive = false;
    if(smartBaseTool === 'frame') setSmartBaseTool('pointer');
    else refreshSmartAnnotationToolbar();
}
function activateSmartFrameTool(){
    if(!canvas) return;
    const ids = window.SmartCanvasModules.viewportSelection.selection.ids();
    if(ids.length){
        createFrameFromSelection(ids);
        return;
    }
    if(smartAnnotationStroke) cancelSmartAnnotationStroke();
    setSmartBaseTool('frame');
}
function hideSmartAnnotationCursor(){
    if(smartAnnotationCursor) smartAnnotationCursor.hidden = true;
}
function updateSmartAnnotationCursor(event){
    if(!smartAnnotationCursor || !smartAnnotationTool || smartEffectiveTool() === 'hand' || smartAnnotationIgnoredTarget(event.target)){
        hideSmartAnnotationCursor();
        return;
    }
    smartAnnotationCursor.style.left = `${event.clientX}px`;
    smartAnnotationCursor.style.top = `${event.clientY}px`;
    smartAnnotationCursor.hidden = false;
}
function renderSmartAnnotationPreview(){
    if(!smartAnnotationPreview) return;
    const stroke = smartAnnotationStroke;
    if(!stroke?.points?.length){
        smartAnnotationPreview.innerHTML = '';
        return;
    }
    const screenPoints = stroke.points.map(point => [
        viewport.x + point.x * viewport.scale,
        viewport.y + point.y * viewport.scale
    ]);
    if(screenPoints.length === 1) screenPoints.push([screenPoints[0][0] + .5, screenPoints[0][1]]);
    smartAnnotationPreview.setAttribute('viewBox', `0 0 ${Math.max(1, shell.clientWidth)} ${Math.max(1, shell.clientHeight)}`);
    smartAnnotationPreview.innerHTML = `<path d="${smartAnnotationPathData(screenPoints)}" stroke="${escapeAttr(stroke.color)}" stroke-width="${Math.max(1, stroke.size * viewport.scale)}"></path>`;
}
function cancelSmartAnnotationStroke(){
    smartAnnotationStroke = null;
    if(smartAnnotationPreview) smartAnnotationPreview.innerHTML = '';
    window.removeEventListener('mousemove', continueSmartAnnotationStroke);
    window.removeEventListener('mouseup', finishSmartAnnotationStroke);
}
function continueSmartAnnotationStroke(event){
    if(!smartAnnotationStroke) return;
    const point = window.SmartCanvasModules.viewportSelection.viewport.screenToWorld(event);
    const previous = smartAnnotationStroke.points[smartAnnotationStroke.points.length - 1];
    const minDistance = Math.max(.8, 1.5 / Math.max(.12, viewport.scale));
    if(previous && Math.hypot(point.x - previous.x, point.y - previous.y) < minDistance) return;
    smartAnnotationStroke.points.push(point);
    renderSmartAnnotationPreview();
}
function finishSmartAnnotationStroke(event){
    const stroke = smartAnnotationStroke;
    if(!stroke) return;
    if(event) continueSmartAnnotationStroke(event);
    const points = stroke.points.slice();
    cancelSmartAnnotationStroke();
    if(!canvas || !points.length) return;
    if(points.length === 1) points.push({x:points[0].x + .5, y:points[0].y});
    const pad = Math.max(6, stroke.size * 1.5);
    const minX = Math.min(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxX = Math.max(...points.map(point => point.x));
    const maxY = Math.max(...points.map(point => point.y));
    const node = {
        id:uid('brush'),
        type:'smart-brush',
        x:minX - pad,
        y:minY - pad,
        w:Math.max(1, maxX - minX + pad * 2),
        h:Math.max(1, maxY - minY + pad * 2),
        color:stroke.color,
        brushSize:stroke.size,
        points:points.map(point => [
            Math.round((point.x - minX + pad) * 10) / 10,
            Math.round((point.y - minY + pad) * 10) / 10
        ]),
        created_at:Date.now()
    };
    canvasMutation.history({action:'push'});
    nodes.push(node);
    selectedId = node.id;
    selectedIds = [];
    selectedImage = {nodeId:'', index:-1};
    smartContainer.reconcileFrames();
    render();
    canvasPersistence.schedule();
}
function placeCaretFromPointer(editable, pointer){
    if(!editable || !pointer) return false;
    let node = null;
    let offset = 0;
    if(typeof document.caretPositionFromPoint === 'function'){
        const position = document.caretPositionFromPoint(pointer.clientX, pointer.clientY);
        node = position?.offsetNode || null;
        offset = Number(position?.offset || 0);
    } else if(typeof document.caretRangeFromPoint === 'function'){
        const pointRange = document.caretRangeFromPoint(pointer.clientX, pointer.clientY);
        node = pointRange?.startContainer || null;
        offset = Number(pointRange?.startOffset || 0);
    }
    if(!node || !(node === editable || editable.contains(node))) return false;
    const range = document.createRange();
    range.setStart(node, Math.max(0, Math.min(offset, node.length ?? node.childNodes?.length ?? 0)));
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
}
function beginSmartTextAnnotationEdit(nodeId, options={}){
    const node = nodes.find(item => item.id === nodeId && item.type === 'smart-text');
    const text = world.querySelector(`.image-node[data-id="${CSS.escape(nodeId)}"] .smart-canvas-text`);
    if(!node || !text) return;
    canvasVirtualization.pin(node.id,'inline-editor');
    const nodeEl = text.closest('.image-node');
    nodeEl?.classList.add('is-text-editing');
    text.setAttribute('contenteditable', 'true');
    text.focus({preventScroll:true});
    if(!placeCaretFromPointer(text, options.pointer)){
        const range = document.createRange();
        range.selectNodeContents(text);
        if(options.selectAll === false) range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    }
}
function createSmartTextAnnotation(point){
    if(!canvas) return;
    const node = {
        id:uid('text'),
        type:nodeKinds.TEXT_ANNOTATION,
        x:point.x,
        y:point.y,
        text:'',
        textSize:smartTextSize,
        created_at:Date.now()
    };
    const layout = smartTextAnnotationLayout(node);
    node.w = layout.width;
    node.h = layout.height;
    canvasMutation.history({action:'push'});
    nodes.push(node);
    selectedId = node.id;
    selectedIds = [];
    selectedImage = {nodeId:'', index:-1};
    smartAnnotationOptionsOpen = false;
    setSmartBaseTool('pointer');
    smartContainer.reconcileFrames();
    render();
    canvasPersistence.schedule();
    pendingSmartTextEditNodeId = node.id;
}
function smartAnnotationIgnoredTarget(target){
    if(target?.closest?.('[contenteditable="true"]')) return true;
    return smartCanvasChromeTarget(target);
}
function beginSmartAnnotationPointer(event){
    if(!canvas || !smartAnnotationTool || event.button !== 0) return;
    if(event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || smartAnnotationIgnoredTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    suppressSmartAnnotationClickUntil = Date.now() + 320;
    smartAnnotationOptionsOpen = false;
    refreshSmartAnnotationToolbar();
    const point = window.SmartCanvasModules.viewportSelection.viewport.screenToWorld(event);
    if(smartAnnotationTool === 'text'){
        createSmartTextAnnotation(point);
        return;
    }
    smartAnnotationStroke = {color:smartBrushColor, size:smartBrushSize, points:[point]};
    renderSmartAnnotationPreview();
    window.addEventListener('mousemove', continueSmartAnnotationStroke);
    window.addEventListener('mouseup', finishSmartAnnotationStroke);
}
function canvasWheelZoomFactor(event, pageSize){
    const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? pageSize : 1;
    const isMac = /^Mac/.test(navigator.platform || '');
    const sensitivity = 0.0016;
    const macMultiplier = isMac ? 1.15 : 1;
    return Math.exp(-event.deltaY * unit * sensitivity * macMultiplier * smartCanvasZoomSpeed);
}
function imageProviders(){
    return (apiProviders || []).filter(p => p.enabled !== false && p.id !== 'modelscope' && p.id !== 'volcengine' && (p.image_models || []).length);
}
function volcengineProvider(){
    return (apiProviders || []).find(p => p.id === 'volcengine' && p.enabled !== false) || {
        id:'volcengine',
        name:tr('smart.engineVolcengine'),
        image_models:[],
        video_models:DEFAULT_VIDEO_MODELS,
        enabled:true
    };
}
function runningHubProvider(){
    return (apiProviders || []).find(p => p.id === 'runninghub' && p.enabled !== false) || null;
}
function runningHubEntries(kind){
    const provider = runningHubProvider();
    if(kind === 'model'){
        return (provider?.image_models || []).map(model => ({
            id:String(model || '').trim(),
            title:String(model || '').trim(),
            enabled:true
        })).filter(item => item.id);
    }
    const key = kind === 'workflow' ? 'rh_workflows' : 'rh_apps';
    return Array.isArray(provider?.[key]) ? provider[key].filter(item => item?.enabled !== false && item?.hidden !== true) : [];
}
function runningHubEntryId(entry, kind){
    if(kind === 'model') return String(entry?.id || entry?.model || entry?.title || '').trim();
    return String(kind === 'workflow' ? (entry?.workflowId || entry?.id || '') : (entry?.appId || entry?.webappId || entry?.id || '')).trim();
}
function runningHubEntryLabel(entry, kind){
    const id = runningHubEntryId(entry, kind);
    if(kind === 'model') return entry?.title || entry?.name || id;
    return entry?.title || entry?.name || (kind === 'workflow' ? `Workflow ${id}` : `AI App ${id}`);
}
function runningHubEntryKey(kind, id){
    return `${kind}:${String(id || '').trim()}`;
}
function parseRunningHubEntryKey(value){
    const text = String(value || '').trim();
    const match = text.match(/^(app|workflow|model):(.+)$/);
    return match ? {kind:match[1], id:match[2].trim()} : null;
}
function runningHubAllEntries(){
    return [
        ...runningHubEntries('model').map(entry => ({kind:'model', id:runningHubEntryId(entry, 'model'), entry})).filter(x => x.id),
        ...runningHubEntries('app').map(entry => ({kind:'app', id:runningHubEntryId(entry, 'app'), entry})).filter(x => x.id),
        ...runningHubEntries('workflow').map(entry => ({kind:'workflow', id:runningHubEntryId(entry, 'workflow'), entry})).filter(x => x.id)
    ];
}
function selectedRunningHubRef(sourceSettings=settings){
    const all = runningHubAllEntries();
    sourceSettings = sourceSettings || settings;
    const selectedKey = String(sourceSettings.rhConfigKey || '').trim();
    const parsed = parseRunningHubEntryKey(selectedKey);
    let ref = parsed ? all.find(item => item.kind === parsed.kind && item.id === parsed.id) : null;
    if(selectedKey){
        if(!ref && sourceSettings === settings){
            notifySmartSettingUnavailable(tr('smart.rhConfig'), selectedKey);
        }
        return ref || null;
    }
    // A blank UI gets a convenient initial selection. Immutable run snapshots
    // must carry an explicit key so refreshes cannot redirect a generation.
    if(sourceSettings !== settings) return null;
    if(all.length) ref = all[0];
    if(ref) settings.rhConfigKey = runningHubEntryKey(ref.kind, ref.id);
    return ref || null;
}
function rhEntryFields(entry){
    return Array.isArray(entry?.fields) ? entry.fields : [];
}
function rhWorkflowJsonFromSources(...sources){
    for(const source of sources){
        if(source && typeof source === 'object' && Object.keys(source).length) return source;
    }
    return {};
}
function rhCurrentKind(sourceSettings=settings){
    return selectedRunningHubRef(sourceSettings)?.kind || 'app';
}
function runningHubSelectedModel(sourceSettings=settings){
    const ref = selectedRunningHubRef(sourceSettings);
    return ref?.kind === 'model' ? ref.id : '';
}
function runningHubModelApiSettings(sourceSettings=settings){
    const model = runningHubSelectedModel(sourceSettings);
    return {...(sourceSettings || settings), engine:'api', apiKind:'image', provider_id:'runninghub', model};
}
function rhUsableFields(fields){
    const list = Array.isArray(fields) ? fields : [];
    if(!list.length) return [];
    const enabled = list.filter(f => f.enabled === true);
    return enabled.length ? enabled : list;
}
function rhActiveFields(sourceSettings=settings){
    const ref = selectedRunningHubRef(sourceSettings);
    let fields = rhEntryFields(ref?.entry);
    if(ref?.kind === 'workflow'){
        const cached = runningHubWorkflowCache[ref.id];
        if(Array.isArray(cached?.fields) && cached.fields.length) fields = cached.fields;
    }
    fields = rhUsableFields(fields);
    return sortRunningHubFields(fields);
}
function runningHubRunNeedsPrompt(sourceSettings=settings){
    if((sourceSettings || settings).engine !== 'runninghub') return true;
    if(runningHubSelectedModel(sourceSettings)) return true;
    const fields = rhActiveFields(sourceSettings);
    const promptFields = fields.filter(field => rhFieldRole(field) === 'prompt');
    if(!promptFields.length) return false;
    return promptFields.some(field => field.required === true && !rhDefaultValue(field).trim());
}
function smartRunNeedsPrompt(sourceSettings=settings){
    sourceSettings = sourceSettings || settings;
    if(sourceSettings.engine === 'runninghub') return runningHubRunNeedsPrompt(sourceSettings);
    if(sourceSettings.engine === 'comfy' && sourceSettings.comfyMode === 'enhance') return false;
    return true;
}
function sortRunningHubFields(fields){
    return [...(fields || [])].sort((a, b) => {
        const ak = rhFieldKind(a), bk = rhFieldKind(b);
        if(ak === 'image' && bk === 'image'){
            const ao = Number(a.imageOrder) || 9999;
            const bo = Number(b.imageOrder) || 9999;
            if(ao !== bo) return ao - bo;
        }
        if(ak === 'image' && bk !== 'image') return -1;
        if(ak !== 'image' && bk === 'image') return 1;
        return String(a.nodeId || '').localeCompare(String(b.nodeId || ''), undefined, {numeric:true}) || String(a.fieldName || '').localeCompare(String(b.fieldName || ''));
    });
}
function chatApiProviders(){
    return (apiProviders || []).filter(p => p.enabled !== false && (p.chat_models || []).length);
}
function resolveChatProviderId(providerId=''){
    const providers = chatApiProviders();
    if(providers.some(p => p.id === providerId)) return providerId;
    return providers[0]?.id || 'comfly';
}
function providerChatModels(providerId){
    const provider = chatApiProviders().find(p => p.id === providerId);
    return [...new Set(provider?.chat_models || [])];
}
function resolveChatModel(model='', providerId=''){
    const models = providerChatModels(resolveChatProviderId(providerId));
    return models.includes(model) ? model : (models[0] || model || 'gpt-4o-mini');
}
function chatProviderOptions(selectedId=''){
    const selected = resolveChatProviderId(selectedId);
    return chatApiProviders().map(provider => `<option value="${escapeHtml(provider.id)}" ${provider.id === selected ? 'selected' : ''}>${escapeHtml(provider.name || provider.id)}</option>`).join('');
}
function apiProviderById(providerId){
    if(providerId === 'volcengine') return volcengineProvider();
    return (apiProviders || []).find(p => p.id === providerId) || imageProviders()[0] || null;
}
// 认证素材 asset:// 是平台绑定的：返回某 provider 所属的认证平台键（与后端一致）
function videoProviderPlatform(providerId){
    const p = (apiProviders || []).find(x => x.id === providerId);
    const proto = String(p?.protocol || '').toLowerCase();
    const base = String(p?.base_url || '').toLowerCase();
    if(proto === 'apimart' || base.includes('apimart.ai')) return 'apimart';
    if(proto === 'volcengine' || providerId === 'volcengine') return 'volcengine';
    return '';
}
function providerImageModels(providerId){
    if(providerId === 'volcengine') return volcengineProvider().image_models || [];
    return (apiProviders || []).find(p => p.id === providerId)?.image_models || [];
}
function smartModelCatalog(kind){
    const managed = Array.isArray(availableModels?.[kind]) ? availableModels[kind] : [];
    const videoCapabilities = window.SmartCanvasModules.videoCapabilities;
    const supportedJimengVideoModels = kind === 'video'
        ? (videoCapabilities?.supportedModels?.('jimeng') || [])
        : [];
    const normalizeJimengVideoEntries = entries => {
        if(kind !== 'video' || !supportedJimengVideoModels.length) return entries;
        const seen = new Set();
        return (entries || []).flatMap(entry => {
            if(entry.provider_id !== 'jimeng') return [entry];
            const canonicalModel = videoCapabilities.canonicalModel(
                'jimeng',
                entry.model,
                supportedJimengVideoModels
            );
            if(!canonicalModel || seen.has(canonicalModel)) return [];
            seen.add(canonicalModel);
            return [{
                ...entry,
                model:canonicalModel,
                name:String(entry.name || '') === String(entry.model || '')
                    ? canonicalModel
                    : entry.name
            }];
        });
    };
    if(managed.length){
        return normalizeJimengVideoEntries(managed);
    }
    const field = kind === 'image' ? 'image_models' : kind === 'video' ? 'video_models' : 'chat_models';
    const entries = (apiProviders || []).filter(provider => provider.enabled !== false).flatMap(provider => [...new Set(provider[field] || [])].map(model => ({
        id:`${provider.id}|${encodeURIComponent(model)}`,
        provider_id:provider.id,
        provider_name:provider.name || provider.id,
        model,
        name:provider.model_names?.[model] || model,
    })));
    return normalizeJimengVideoEntries(entries);
}
function smartCatalogEntry(kind, providerId='', model=''){
    const entries = smartModelCatalog(kind);
    const requestedProvider = String(providerId || '').trim();
    const requestedModel = String(model || '').trim();
    const exact = entries.find(
        entry =>
            entry.provider_id === requestedProvider
            && entry.model === requestedModel
    );
    if(exact) return exact;
    // An explicit provider is a billing/credential boundary. Never cross it
    // just because another provider exposes a model with the same name.
    if(requestedProvider){
        return entries.find(entry => entry.provider_id === requestedProvider)
            || null;
    }
    if(requestedModel){
        return entries.find(entry => entry.model === requestedModel)
            || null;
    }
    return entries[0] || null;
}
function smartCatalogHasSelection(kind, providerId='', model=''){
    return smartModelCatalog(kind).some(
        entry =>
            entry.provider_id === providerId
            && entry.model === model
    );
}
let smartSettingsFallbackNotice = {message:'', at:0};
function notifySmartSettingFallback(setting, previous, next=''){
    const before = String(previous || '').trim();
    const after = String(next || '').trim();
    if(!before || before === after) return false;
    const message = after
        ? trf('smart.fallbackChanged', {setting, previous:before, next:after})
        : trf('smart.fallbackCleared', {setting, previous:before});
    const now = Date.now();
    if(
        smartSettingsFallbackNotice.message === message
        && now - smartSettingsFallbackNotice.at < 2500
    ){
        return false;
    }
    smartSettingsFallbackNotice = {message, at:now};
    toast(message);
    return true;
}
function notifySmartSettingUnavailable(setting, previous){
    const before = String(previous || '').trim();
    if(!before) return false;
    const message = trf('smart.selectionUnavailable', {
        setting,
        previous:before
    });
    const now = Date.now();
    if(
        smartSettingsFallbackNotice.message === message
        && now - smartSettingsFallbackNotice.at < 2500
    ){
        return false;
    }
    smartSettingsFallbackNotice = {message, at:now};
    toast(message);
    return true;
}
function smartModelSelectionLabel(providerId='', model=''){
    const modelName = String(model || '').trim();
    const providerName = String(providerId || '').trim();
    return providerName && modelName
        ? `${modelName} · ${providerName}`
        : modelName;
}
function smartModelVendorIcon(model='', providerId='', providerName=''){
    return window.ModelVendorIcons?.resolve(model, providerId, providerName) || null;
}
function smartModelVendorIconMarkup(model='', providerId='', providerName=''){
    return window.ModelVendorIcons?.markup(model, providerId, providerName) || '';
}
function smartModelVendorOptionAttributes(model='', providerId='', providerName=''){
    const icon = smartModelVendorIcon(model, providerId, providerName);
    if(!icon) return 'data-start-icon="image"';
    return [
        `data-start-icon-src="${escapeAttr(icon.src)}"`,
        `data-start-icon-label="${escapeAttr(icon.label || providerName || providerId)}"`,
        icon.monochrome ? 'data-start-icon-monochrome' : '',
        icon.brandMark ? 'data-start-icon-brand-mark' : '',
    ].filter(Boolean).join(' ');
}
function smartApiSelectionSnapshot(target=settings){
    return {
        provider_id:String(target?.provider_id || ''),
        model:String(target?.model || ''),
        resolution:String(target?.resolution || ''),
        videoProvider:String(target?.videoProvider || ''),
        videoModel:String(target?.videoModel || '')
    };
}
function notifySmartApiSelectionFallback(before, target=settings, {notify=false}={}){
    if(!notify || !before) return false;
    const after = smartApiSelectionSnapshot(target);
    const video = (target?.apiKind || 'image') === 'video';
    const previousModel = video
        ? smartModelSelectionLabel(before.videoProvider, before.videoModel)
        : smartModelSelectionLabel(before.provider_id, before.model);
    const nextModel = video
        ? smartModelSelectionLabel(after.videoProvider, after.videoModel)
        : smartModelSelectionLabel(after.provider_id, after.model);
    const modelChanged = video
        ? before.videoProvider !== after.videoProvider
            || before.videoModel !== after.videoModel
        : before.provider_id !== after.provider_id
            || before.model !== after.model;
    if(previousModel && modelChanged){
        notifySmartSettingFallback(
            video ? tr('smart.videoModel') : tr('smart.imageModel'),
            previousModel,
            nextModel
        );
    } else if(
        previousModel
        && smartModelCatalog(video ? 'video' : 'image').length
        && !smartCatalogHasSelection(
            video ? 'video' : 'image',
            video ? after.videoProvider : after.provider_id,
            video ? after.videoModel : after.model
        )
    ){
        notifySmartSettingUnavailable(
            video ? tr('smart.videoModel') : tr('smart.imageModel'),
            previousModel
        );
    }
    if(before.resolution === 'auto' && after.resolution !== 'auto'){
        notifySmartSettingFallback(
            tr('smart.resolution'),
            'Auto',
            after.resolution.toUpperCase()
        );
    }
    return modelChanged || before.resolution !== after.resolution;
}
function renderCatalogModelControl(kind){
    const video = kind === 'video';
    const providerId = video ? settings.videoProvider : settings.provider_id;
    const model = video ? settings.videoModel : settings.model;
    const current = smartCatalogEntry(kind, providerId, model);
    const entries = smartModelCatalog(kind);
    const param = video ? 'videoModelChoice' : 'modelChoice';
    const title = video ? tr('smart.videoModel') : tr('smart.imageModel');
    const noModelLabel = video ? tr('smart.noVideoModel') : tr('smart.noImageModel');
    const options = entries.length
        ? entries.map(entry => `<option value="${escapeAttr(entry.id)}" ${smartModelVendorOptionAttributes(entry.model, entry.provider_id, entry.provider_name)} ${entry.id === current?.id ? 'selected' : ''}>${escapeHtml(entry.name || entry.model)}</option>`).join('')
        : `<option value="__no_model__" selected disabled>${escapeHtml(noModelLabel)}</option>`;
    return `<ic-select class="catalog-model-select" name="${video ? 'video-model' : 'image-model'}" aria-label="${escapeAttr(title)}" hierarchy="quiet" placement="top" data-smart-select-param="${param}" data-component-variant="model-picker" data-legal-combination="model-picker-vertical-manual-label" ${entries.length ? '' : 'disabled'}>
        ${options}
        <span slot="start" aria-hidden="true">${smartModelVendorIconMarkup(current?.model || model, current?.provider_id || providerId, current?.provider_name)}</span>
        <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
    </ic-select>`;
}
// 即梦图生图（挂了参考图）不支持 3.0/3.1，此时从模型下拉里隐藏它们。
const JIMENG_IMAGE2IMAGE_UNSUPPORTED = ['3.0', '3.1'];
function jimengImageEditMode(){
    if(settings.provider_id !== 'jimeng') return false;
    const node = activeComposerNode() || window.SmartCanvasModules.viewportSelection.selection.node();
    const refs = node ? visibleReferenceImagesFor(node) : [];
    return refs.length > 0;
}
function filterJimengImageModels(models){
    if(settings.provider_id !== 'jimeng' || !jimengImageEditMode()) return models;
    return (models || []).filter(m => !JIMENG_IMAGE2IMAGE_UNSUPPORTED.includes(String(m)));
}
let _jimengLastEditMode = null;
let _jimengModelRefreshing = false;
// 参考图增删导致即梦文生图/图生图切换时，重新渲染参数面板以更新模型下拉。
function syncJimengModelPillForRefs(){
    if(_jimengModelRefreshing) return;
    if(settings.provider_id !== 'jimeng' || settings.engine !== 'api' || settings.apiKind === 'video'){
        _jimengLastEditMode = null;
        return;
    }
    const mode = jimengImageEditMode();
    if(mode === _jimengLastEditMode) return;
    _jimengLastEditMode = mode;
    _jimengModelRefreshing = true;
    try { scheduleDynamicParamsRefresh(80); } finally { _jimengModelRefreshing = false; }
}
function smartVideoCapabilityReferences(){
    const node = activeComposerNode() || window.SmartCanvasModules.viewportSelection.selection.node();
    const refs = node ? visibleReferenceImagesFor(node) : [];
    const manual = manualSmartMediaLinks(settings)
        .filter(item => item?.url)
        .map(item => ({...item,kind:item.kind || 'video'}));
    return window.SmartCanvasModules.referenceInstances.unique([...(refs || []),...manual]);
}
function smartVideoCapabilityProviderContext(sourceSettings=settings){
    const providerId = String(sourceSettings?.videoProvider || '');
    const provider = providerId === 'volcengine'
        ? ((apiProviders || []).find(item => item.id === 'volcengine') || volcengineProvider())
        : (apiProviders || []).find(item => item.id === providerId);
    return {
        protocol:String(provider?.protocol || '').trim().toLowerCase(),
        base_url:String(provider?.base_url || '').trim()
    };
}
function smartCurrentVideoCapability(sourceSettings=settings){
    return window.SmartCanvasModules.videoCapabilities.current(
        sourceSettings.videoProvider,
        sourceSettings.videoModel,
        smartVideoCapabilityProviderContext(sourceSettings)
    );
}
function smartVideoComposerState({reconcile=true}={}){
    const module = window.SmartCanvasModules.videoCapabilities;
    const refs = smartVideoCapabilityReferences();
    const capability = smartCurrentVideoCapability();
    const optionSettings = module.applyComposerOptions(settings, capability);
    if(reconcile) settings = optionSettings;
    if(settings.videoProvider !== 'jimeng'){
        return {
            capability,
            refs,
            settings:optionSettings,
            state:module.resolve(optionSettings, refs, capability)
        };
    }
    const resolved = reconcile
        ? module.reconcile(optionSettings, refs, capability)
        : {settings:optionSettings,state:module.resolve(optionSettings, refs, capability),invalidated:[]};
    if(reconcile) settings = {...settings,...resolved.settings};
    return {capability,refs,...resolved};
}
function jimengVideoCommand(){
    if(settings.videoProvider !== 'jimeng') return '';
    return smartVideoComposerState({reconcile:false}).state.command;
}
let _jimengLastVideoCommand = null;
function syncJimengVideoModelPillForRefs(){
    if(_jimengModelRefreshing) return;
    if(settings.videoProvider !== 'jimeng' || settings.engine !== 'api' || settings.apiKind !== 'video'){
        _jimengLastVideoCommand = null;
        return;
    }
    const resolved = smartVideoComposerState({reconcile:false}).state;
    const signature = [
        resolved.command,
        resolved.reference_mode || '',
        resolved.counts?.image || 0,
        resolved.counts?.video || 0,
        resolved.counts?.audio || 0
    ].join('|');
    if(signature === _jimengLastVideoCommand) return;
    _jimengLastVideoCommand = signature;
    _jimengModelRefreshing = true;
    try { scheduleDynamicParamsRefresh(80); } finally { _jimengModelRefreshing = false; }
}
function smartComposerSelectionValidationActive(){
    return Boolean(
        composer?.classList.contains('open')
        && window.SmartCanvasModules?.viewportSelection?.selection?.node?.()
    );
}
function sanitizeSmartApiSelection(target=settings, options={}){
    if(!target || typeof target !== 'object') return target;
    if(options.notify && !smartComposerSelectionValidationActive()) return target;
    const before = smartApiSelectionSnapshot(target);
    const finish = () => {
        notifySmartApiSelectionFallback(before, target, options);
        return target;
    };
    if((target.engine || 'api') === 'api'){
        const video = (target.apiKind || 'image') === 'video';
        const entry = smartCatalogEntry(video ? 'video' : 'image', video ? target.videoProvider : target.provider_id, video ? target.videoModel : target.model);
        if(entry){
            if(video){ target.videoProvider = entry.provider_id; target.videoModel = entry.model; }
            else { target.provider_id = entry.provider_id; target.model = entry.model; }
        }
    }
    if(target.engine === 'volcengine'){
        if(target.apiKind === 'video'){
            target.videoProvider = 'volcengine';
            const models = volcengineVideoModels();
            if(models.length && !models.includes(target.videoModel)) target.videoModel = models[0];
        } else {
            target.provider_id = 'volcengine';
            const models = providerImageModels('volcengine');
            if(models.length && !models.includes(target.model)) target.model = models[0];
        }
        return finish();
    }
    clearVolcengineSelectionOutsideVolcengine(target);
    if(target.provider_id){
        const models = providerImageModels(target.provider_id);
        if(models.length && !models.includes(target.model)) target.model = models[0] || '';
    }
    if((target.engine || 'api') === 'api' && (target.apiKind || 'image') !== 'video'){
        const allowAuto = isGptImageAutoSizeModel(target.model);
        if(!target.resolution) target.resolution = allowAuto ? defaultSmartApiResolution(target.model) : '1k';
        if(!allowAuto && target.resolution === 'auto') target.resolution = '1k';
    }
    if(target.videoProvider){
        const models = providerVideoModels(target.videoProvider);
        if(models.length && !models.includes(target.videoModel)) target.videoModel = models[0] || '';
    }
    return finish();
}
function modelscopeProvider(){
    return (apiProviders || []).find(p => p.id === 'modelscope' && p.enabled !== false) || null;
}
function modelscopeImageModels(){
    return modelscopeProvider()?.image_models || ['Tongyi-MAI/Z-Image-Turbo'];
}
const DEFAULT_VIDEO_MODELS = ['veo3-fast','veo3','sora','runway','kling','pika','minimax-video','wan-v2','seedance-1.0-pro','jimeng-vide-3.0','jimeng-video-3.0-pro'];
function videoApiProviders(){
    const fromConfig = (apiProviders || []).filter(p => p.enabled !== false && p.id !== 'volcengine' && (p.video_models || []).length);
    if(fromConfig.length) return fromConfig;
    return [{id:'comfly', name:'Comfly', video_models:DEFAULT_VIDEO_MODELS, enabled:true}];
}
function videoProviderById(providerId){
    if(providerId === 'volcengine') return volcengineProvider();
    return videoApiProviders().find(p => p.id === providerId) || videoApiProviders()[0] || null;
}
function providerVideoModels(providerId){
    if(providerId === 'volcengine') return volcengineVideoModels();
    const provider = videoApiProviders().find(p => p.id === providerId);
    const models = provider?.video_models || DEFAULT_VIDEO_MODELS;
    return [...new Set(models)];
}
function volcengineVideoModels(){
    const provider = (apiProviders || []).find(p => p.id === 'volcengine');
    return [...new Set(provider?.video_models || DEFAULT_VIDEO_MODELS)];
}
function renderVideoProviderControl(providers){
    const current = (providers || []).find(p => p.id === settings.videoProvider) || videoProviderById(settings.videoProvider);
    return `<ic-select class="provider-select" name="video-provider" aria-label="${escapeAttr(tr('smart.videoPlatform'))}" hierarchy="quiet" placement="top" data-smart-select-param="videoProvider" data-component-variant="model-picker" data-legal-combination="model-picker-vertical-manual-label" ${providers.length ? '' : 'disabled'}>
        ${providers.map(provider => `<option value="${escapeAttr(provider.id)}" ${smartModelVendorOptionAttributes('', provider.id, provider.name)} ${provider.id === settings.videoProvider ? 'selected' : ''}>${escapeHtml(provider.name || provider.id)}</option>`).join('') || `<option value="__no_provider__" selected disabled>${escapeHtml(tr('smart.noVideoPlatform'))}</option>`}
        <span slot="start" aria-hidden="true">${smartModelVendorIconMarkup('', current?.id || settings.videoProvider, current?.name)}</span>
        <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
    </ic-select>`;
}
function renderVideoModelControl(models){
    const provider = videoProviderById(settings.videoProvider);
    return `<ic-select class="catalog-model-select" name="video-model" aria-label="${escapeAttr(tr('smart.videoModel'))}" hierarchy="quiet" placement="top" data-smart-select-param="videoModel" data-component-variant="model-picker" data-legal-combination="model-picker-vertical-manual-label" ${models.length ? '' : 'disabled'}>
        ${models.map(model => `<option value="${escapeAttr(model)}" ${smartModelVendorOptionAttributes(model, settings.videoProvider, provider?.name)} ${model === settings.videoModel ? 'selected' : ''}>${escapeHtml(model)}</option>`).join('') || `<option value="__no_model__" selected disabled>${escapeHtml(tr('smart.noVideoModel'))}</option>`}
        <span slot="start" aria-hidden="true">${smartModelVendorIconMarkup(settings.videoModel, settings.videoProvider, provider?.name)}</span>
        <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
    </ic-select>`;
}
function renderVideoGenerationSettingsControl(videoState=null){
    const ratios = videoState?.aspect_ratios?.length
        ? videoState.aspect_ratios
        : ['16:9','9:16','1:1','4:3','3:4','21:9','9:21','keep_ratio','adaptive'];
    const resolutions = videoState?.video_resolutions?.length
        ? videoState.video_resolutions
        : ['auto','480p','720p','1080p'];
    const currentRatio = ratios.includes(settings.videoAspect) ? settings.videoAspect : (ratios[0] || '16:9');
    const currentResolution = settings.videoResolution || (resolutions.includes('auto') ? 'auto' : (resolutions[0] || ''));
    const minimumDuration = Math.max(1, Number(videoState?.duration_seconds?.minimum) || 1);
    const maximumDuration = Math.max(minimumDuration, Number(videoState?.duration_seconds?.maximum) || 60);
    const currentDuration = Math.max(minimumDuration, Math.min(maximumDuration, Number(settings.videoDuration) || 5));
    return `<ic-generation-settings-picker
        class="generation-settings-picker video-generation-settings-picker"
        label="${escapeAttr(tr('smart.sizeSelection'))}"
        ratio="${escapeAttr(currentRatio)}"
        ratio-presets="${escapeAttr(ratios.join(','))}"
        resolution="${escapeAttr(currentResolution)}"
        resolutions="${escapeAttr(resolutions.join(','))}"
        ratio-label="${escapeAttr(tr('smart.videoAspect'))}"
        resolution-label="${escapeAttr(tr('smart.videoResolution'))}"
        keep-ratio-label="${escapeAttr(tr('smart.videoAspectKeep'))}"
        adaptive-label="${escapeAttr(tr('smart.videoAspectAdaptive'))}"
        resolution-auto-label="${escapeAttr(tr('smart.videoResAuto'))}"
        duration="${escapeAttr(currentDuration)}"
        duration-min="${escapeAttr(minimumDuration)}"
        duration-max="${escapeAttr(maximumDuration)}"
        duration-step="1"
        duration-label="${escapeAttr(tr('smart.videoDuration'))}"
        data-smart-generation-settings
        data-smart-generation-mode="video"
        ${videoState?.aspect_ratio_locked ? 'lock-ratio' : ''}
        hide-quality
    ></ic-generation-settings-picker>`;
}
function renderJimengReferenceModeControl(videoState){
    if(!videoState?.counts?.total) return '';
    const counts = videoState.counts;
    const total = Number(counts.total) || 0;
    const minimum = Number(videoState.reference_limit?.minimum);
    const maximum = Number(videoState.reference_limit?.maximum);
    const countLabel = Number.isFinite(maximum) && maximum > 0 ? `${total}/${maximum}` : String(total);
    const referenceCountInvalid = window.SmartCanvasModules.videoCapabilities
        .validateReferences(videoState).valid === false;
    const modes = [
        {
            value:'multimodal_all_around',
            label:tr('smart.videoMultimodal'),
            icon:'omni-reference'
        },
        {
            value:'first_last_frames',
            label:tr('smart.videoUseFrameRoles'),
            icon:'first-last-frames'
        }
    ];
    const current = modes.find(mode => mode.value === videoState.reference_mode) || modes[1];
    const countDescription = trf('smart.videoReferenceCount', {
        count:total,
        minimum:Number.isFinite(minimum) ? minimum : '—',
        maximum:Number.isFinite(maximum) ? maximum : '—'
    });
    return `<ic-select
        class="reference-mode-select"
        name="video-reference-mode"
        aria-label="${escapeAttr(tr('smart.videoReferenceMode'))}"
        hierarchy="quiet"
        placement="top"
        data-smart-select-param="videoReferenceMode"
        data-component-variant="model-picker"
        data-legal-combination="model-picker-vertical-manual-label"
        title="${escapeAttr(countDescription)}"
    >
        ${modes.map(mode => `<option value="${escapeAttr(mode.value)}" data-start-icon="${escapeAttr(mode.icon)}" ${mode.value === current.value ? 'selected' : ''}>${escapeHtml(mode.label)}</option>`).join('')}
        <ic-icon name="${escapeAttr(current.icon)}" size="small" slot="start" aria-hidden="true"></ic-icon>
        <span class="reference-mode-count ${referenceCountInvalid ? 'is-invalid' : ''}" slot="end" title="${escapeAttr(countDescription)}">${escapeHtml(countLabel)}</span>
        <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
    </ic-select>`;
}
function renderVideoToggleControl(key, label){
    const on = !!settings[key];
    return `<ic-switch class="generation-setting-switch" name="${escapeAttr(key)}" label="${escapeAttr(label)}" size="s" data-toggle-param="${escapeAttr(key)}" ${on ? 'checked' : ''}></ic-switch>`;
}
function renderTransparentPngControl(capability=smartCurrentImageCapability('')){
    if(capability?.supports_transparent_png !== true) return '';
    return `<ic-switch class="generation-setting-switch" name="transparent-png" label="${escapeAttr(tr('smart.transparentPng'))}" size="s" data-toggle-param="transparentPng" ${settings.transparentPng ? 'checked' : ''}></ic-switch>`;
}
function renderVideoCapabilityToggle(capability, option, label){
    const module = window.SmartCanvasModules.videoCapabilities;
    const definition = capability?.composer_option_definitions?.[option] || {};
    if(module.optionMode(capability, option) !== 'user_toggle') return '';
    const settingKey = String(definition.setting_key || '');
    return settingKey ? renderVideoToggleControl(settingKey, label || definition.label || option) : '';
}
function renderTempShUploadControl(){
    return `<ic-button type="button" class="cloud-upload-pill" hierarchy="quiet" size="small" data-temp-sh-upload-video title="${escapeAttr(tr('smart.cloudUploadTitle'))}"><ic-icon name="upload" size="small" slot="start" aria-hidden="true"></ic-icon>${escapeHtml(tr('smart.cloudUpload'))}</ic-button>`;
}
function renderManualVideoUrlControl(){
    return `<ic-button type="button" class="manual-video-url-pill" hierarchy="quiet" size="small" data-manual-video-url title="${escapeAttr(tr('smart.mediaUrlTitle'))}"><ic-icon name="link" size="small" slot="start" aria-hidden="true"></ic-icon>${escapeHtml(tr('smart.enterUrl'))}</ic-button>`;
}
// 可信素材模式：打开后可选择供应商认证链接、自行上传云端或手动输入网址。
function renderVideoTrustedAssetControl(){
    const on = !!settings.videoTrustedAsset;
    let html = renderVideoToggleControl('videoTrustedAsset', tr('smart.videoTrustedAsset'));
    if(!on) return html;
    const src = ['library','cloud','manual'].includes(settings.videoTrustedSource) ? settings.videoTrustedSource : 'library';
    html += `<div class="trusted-source-row">
        <ic-button type="button" class="trusted-src-pill" hierarchy="quiet" size="small" toggle ${src === 'library' ? 'pressed' : ''} data-trusted-source="library" title="${escapeAttr(tr('smart.trustedLibraryTitle'))}"><ic-icon name="success" size="small" slot="start" aria-hidden="true"></ic-icon>${escapeHtml(tr('smart.trustedLibrary'))}</ic-button>
        <ic-button type="button" class="trusted-src-pill" hierarchy="quiet" size="small" toggle ${src === 'cloud' ? 'pressed' : ''} data-trusted-source="cloud" title="${escapeAttr(tr('smart.trustedCloudTitle'))}"><ic-icon name="upload" size="small" slot="start" aria-hidden="true"></ic-icon>${escapeHtml(tr('smart.cloudUpload'))}</ic-button>
        <ic-button type="button" class="trusted-src-pill" hierarchy="quiet" size="small" toggle ${src === 'manual' ? 'pressed' : ''} data-trusted-source="manual" title="${escapeAttr(tr('smart.trustedManualTitle'))}"><ic-icon name="link" size="small" slot="start" aria-hidden="true"></ic-icon>${escapeHtml(tr('smart.enterUrl'))}</ic-button>
    </div>`;
    return html;
}
function optionHtml(value, label, selected){
    return `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(label ?? value)}</option>`;
}
function parseSizeValue(value){
    const match = String(value || '').trim().match(/^(\d+)\s*[xX*]\s*(\d+)$/);
    return match ? {width:match[1], height:match[2]} : null;
}
function parseRatioValue(value){
    const raw = String(value || '').trim();
    const parts = raw.includes(':') ? raw.split(':') : raw.split(/[xX*]/);
    if(parts.length !== 2) return 0;
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    return w > 0 && h > 0 ? w / h : 0;
}
function apiImageSize(ratioValue, resolutionValue, customRatioValue='', customSizeValue=''){
    if(resolutionValue === 'auto') return 'auto';
    if(resolutionValue === 'custom') return String(customSizeValue || '').trim();
    const resolutionKey = resolutionValue || '1k';
    if(ratioValue === 'custom' || ratioValue === 'source'){
        const parsed = parseRatioValue(customRatioValue);
        const longSide = RES_LONG_SIDE[resolutionKey] || 1024;
        if(parsed){
            const pixelLimit = RES_PIXEL_LIMIT[resolutionKey] || (longSide * longSide);
            const rawWidth = parsed >= 1 ? longSide : Math.min(longSide * parsed, Math.sqrt(pixelLimit * parsed));
            const rawHeight = parsed >= 1 ? Math.min(longSide / parsed, Math.sqrt(pixelLimit / parsed)) : longSide;
            const width = Math.floor(rawWidth / 16) * 16;
            const height = Math.floor(rawHeight / 16) * 16;
            return `${Math.max(64, width)}x${Math.max(64, height)}`;
        }
    }
    const ratioKey = ratioValue && SIZE_MAP[ratioValue] ? ratioValue : 'square';
    return SIZE_MAP[ratioKey]?.[resolutionKey] || SIZE_MAP.square[resolutionKey] || SIZE_MAP.square['1k'];
}
function normalizeApiSizeSettings(prefix=''){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    const resKey = prefix ? `${prefix}Resolution` : 'resolution';
    const allowAuto = !prefix && settings.engine === 'api' && settings.apiKind !== 'video' && isGptImageAutoSizeModel(settings.model);
    if(!settings[resKey]) settings[resKey] = allowAuto ? defaultSmartApiResolution(settings.model) : '1k';
    if(!allowAuto && settings[resKey] === 'auto') settings[resKey] = '1k';
    if(settings[resKey] === 'auto' && !settings[ratioKey]) settings[ratioKey] = 'square';
}
async function ensureComfyWorkflow(name){
    if(!name) return null;
    if(comfyWorkflowCache[name]) return comfyWorkflowCache[name];
    const data = await fetch(`/api/workflows/${encodeURIComponent(name)}`).then(r => r.ok ? r.json() : null).catch(() => null);
    if(data) comfyWorkflowCache[name] = data;
    return data;
}
function currentComfyFields(){
    return comfyWorkflowCache[settings.comfyWorkflow]?.config?.fields || [];
}
function comfyParamValue(field){
    settings.comfyParams = settings.comfyParams || {};
    if(settings.comfyParams[field.id] !== undefined) return settings.comfyParams[field.id];
    return field.default ?? (field.type === 'boolean' ? false : (field.type === 'number' || field.type === 'slider' ? 0 : ''));
}
function updateProviderModels(){ renderDynamicParams(); }
let dynamicParamsRefreshTimer = 0;
let dynamicParamsRefreshIdle = 0;
let dynamicParamsRefreshSeq = 0;
function scheduleDynamicParamsRefresh(delay=120){
    if(dynamicParamsRefreshTimer){
        clearTimeout(dynamicParamsRefreshTimer);
        dynamicParamsRefreshTimer = 0;
    }
    if(dynamicParamsRefreshIdle && window.cancelIdleCallback){
        window.cancelIdleCallback(dynamicParamsRefreshIdle);
        dynamicParamsRefreshIdle = 0;
    }
    const seq = ++dynamicParamsRefreshSeq;
    const run = () => {
        dynamicParamsRefreshTimer = 0;
        dynamicParamsRefreshIdle = 0;
        if(seq !== dynamicParamsRefreshSeq) return;
        renderDynamicParams();
    };
    if(window.requestIdleCallback){
        dynamicParamsRefreshIdle = window.requestIdleCallback(run, {timeout:Math.max(180, Number(delay) + 260)});
    } else {
        dynamicParamsRefreshTimer = setTimeout(run, Math.max(0, Number(delay) || 0));
    }
}
function openControlState(){
    const generationSettings = dynamicParams?.querySelector('ic-generation-settings-picker[open]');
    if(generationSettings){
        return {
            generationSettings:true,
            video:generationSettings.dataset.smartGenerationMode === 'video',
            prefix:generationSettings.dataset.smartGenerationPrefix || ''
        };
    }
    return null;
}
function restoreOpenControl(state){
    if(!state) return;
    if(state.generationSettings){
        const match = dynamicParams?.querySelector(state.video
            ? 'ic-generation-settings-picker[data-smart-generation-mode="video"]'
            : `ic-generation-settings-picker[data-smart-generation-prefix="${CSS.escape(state.prefix || '')}"]`);
        if(match) match.open = true;
    }
}
function dynamicParamsScrollSnapshot(){
    if(!dynamicParams) return null;
    return {
        top:dynamicParams.scrollTop || 0,
        left:dynamicParams.scrollLeft || 0
    };
}
function restoreDynamicParamsScroll(snapshot){
    if(!snapshot || !dynamicParams) return;
    const apply = () => {
        dynamicParams.scrollTop = snapshot.top || 0;
        dynamicParams.scrollLeft = snapshot.left || 0;
    };
    apply();
    requestAnimationFrame(apply);
}
function renderDynamicParams(){
    if(!dynamicParams) return;
    if(!smartComposerSelectionValidationActive()) return;
    if(
        typeof smartComposerOwnedOverlayOpen === 'function'
        && smartComposerOwnedOverlayOpen()
    ){
        scheduleDynamicParamsRefresh(120);
        return;
    }
    const keepOpen = openControlState();
    const scrollState = dynamicParamsScrollSnapshot();
    settings.engine = ['api','volcengine','modelscope','comfy','runninghub'].includes(settings.engine) ? settings.engine : 'api';
    settings.apiKind = settings.apiKind === 'video' ? 'video' : 'image';
    dynamicParams.classList.toggle('video-flow', isApiLikeEngine(settings.engine) && settings.apiKind === 'video');
    clearVolcengineSelectionOutsideVolcengine(settings);
    engineSelect.value = settings.engine;
    syncApiKindToggleVisibility();
    if(settings.engine === 'api'){
        if(settings.apiKind === 'video') renderApiVideoParams();
        else renderApiParams();
    }
    else if(settings.engine === 'volcengine'){
        if(settings.apiKind === 'video') renderVolcengineVideoParams();
        else renderVolcengineParams();
    }
    else if(settings.engine === 'modelscope') renderMsParams();
    else if(settings.engine === 'runninghub') renderRunningHubParams();
    else renderComfyParams();
    bindDynamicParams();
    restoreOpenControl(keepOpen);
    restoreDynamicParamsScroll(scrollState);
    updatePromptPlaceholder();
    persistActiveSmartSettings();
    if(window.lucide) lucide.createIcons();
}
function renderApiParams(){
    sanitizeSmartApiSelection(settings, {notify:true});
    // 切换平台/模型时保留用户已选的分辨率（记忆），normalizeApiSizeSettings 只会修正非法的 auto。
    normalizeApiSizeSettings('');
    const outpaintLocked = settings.outpaintResolutionLocked === true;
    dynamicParams.innerHTML = `
        ${renderCatalogModelControl('image')}
        ${renderSizePickerControl('', true)}
        ${renderCountVisualControl()}
        ${renderTransparentPngControl()}
    `;
}
function renderApiVideoParams(){
    sanitizeSmartApiSelection(settings, {notify:true});
    const jimeng = settings.videoProvider === 'jimeng';
    const composer = smartVideoComposerState();
    const capability = composer?.capability || null;
    const videoState = composer?.state || null;
    dynamicParams.innerHTML = `
        ${renderCatalogModelControl('video')}
        ${renderVideoGenerationSettingsControl(videoState)}
        ${jimeng ? renderJimengReferenceModeControl(videoState) : ''}
        ${renderVideoCapabilityToggle(capability, 'enhance_prompt', tr('smart.videoEnhancePrompt'))}
        ${renderVideoCapabilityToggle(capability, 'enable_upsample', tr('smart.videoUpsample'))}
        ${renderVideoCapabilityToggle(capability, 'generate_audio', tr('smart.videoGenerateAudio'))}
        ${renderVideoCapabilityToggle(capability, 'camera_fixed', tr('smart.videoCameraFixed'))}
        ${renderVideoCapabilityToggle(capability, 'watermark', tr('smart.videoWatermark'))}
        ${jimeng ? '' : renderVideoToggleControl('videoMultimodal', tr('smart.videoMultimodal'))}
        ${jimeng ? '' : renderVideoToggleControl('videoUseFrameRoles', tr('smart.videoUseFrameRoles'))}
        ${jimeng ? '' : renderVideoTrustedAssetControl()}
    `;
}
function renderVolcengineParams(){
    const provider = volcengineProvider();
    const providers = [provider];
    const models = providerImageModels('volcengine');
    sanitizeSmartApiSelection(settings, {notify:true});
    const outpaintLocked = settings.outpaintResolutionLocked === true;
    dynamicParams.innerHTML = `
        ${renderProviderControl(providers)}
        ${renderModelControl(models)}
        ${renderSizePickerControl('', true)}
        ${renderCountVisualControl()}
    `;
}
function renderVolcengineVideoParams(){
    const provider = volcengineProvider();
    const providers = [provider];
    const models = volcengineVideoModels();
    sanitizeSmartApiSelection(settings, {notify:true});
    const composer = smartVideoComposerState();
    const capability = composer?.capability || null;
    dynamicParams.innerHTML = `
        ${renderVideoProviderControl(providers)}
        ${renderVideoModelControl(models)}
        ${renderVideoGenerationSettingsControl()}
        ${renderVideoCapabilityToggle(capability, 'enhance_prompt', tr('smart.videoEnhancePrompt'))}
        ${renderVideoCapabilityToggle(capability, 'enable_upsample', tr('smart.videoUpsample'))}
        ${renderVideoCapabilityToggle(capability, 'generate_audio', tr('smart.videoGenerateAudio'))}
        ${renderVideoCapabilityToggle(capability, 'camera_fixed', tr('smart.videoCameraFixed'))}
        ${renderVideoCapabilityToggle(capability, 'watermark', tr('smart.videoWatermark'))}
        ${renderVideoToggleControl('videoMultimodal', tr('smart.videoMultimodal'))}
        ${renderVideoToggleControl('videoUseFrameRoles', tr('smart.videoUseFrameRoles'))}
        ${renderVideoTrustedAssetControl()}
    `;
}
function renderRunningHubParams(){
    const ref = selectedRunningHubRef();
    const fields = rhActiveFields();
    settings.rhPayment = settings.rhPayment === 'wallet' ? 'wallet' : 'free';
    settings.rhParams = settings.rhParams || {};
    settings.rhRandomActive = settings.rhRandomActive || {};
    if(!ref){
        dynamicParams.innerHTML = `
            ${renderRhConfigControl(null)}
            <div class="muted-note">${escapeHtml(tr('smart.rhNeedConfig'))}</div>
        `;
        return;
    }
    if(ref.kind === 'model'){
        settings.provider_id = 'runninghub';
        settings.model = ref.id;
        normalizeApiSizeSettings('');
        dynamicParams.innerHTML = `
            ${renderRhConfigControl(ref)}
            ${renderSizePickerControl('', true)}
            ${renderCountVisualControl()}
        `;
        return;
    }
    const mediaFields = fields.filter(f => ['image','video','audio'].includes(rhFieldRole(f))).length;
    const promptFields = fields.filter(f => rhFieldRole(f) === 'prompt').length;
    dynamicParams.innerHTML = `
        ${renderRhConfigControl(ref)}
        ${renderRhPaymentControl()}
        ${renderRhMachineControl()}
        <div class="rh-mini-summary">${escapeHtml(trf('smart.rhSummary', {media: mediaFields, prompts: promptFields}))}</div>
        ${fields.length ? fields.filter(f => !['image','video','audio','prompt'].includes(rhFieldRole(f))).map(renderRhSettingField).join('') : `<div class="muted-note">${escapeHtml(tr('smart.rhNeedFields'))}</div>`}
    `;
}
function renderRhConfigControl(ref){
    const models = runningHubEntries('model');
    const apps = runningHubEntries('app');
    const workflows = runningHubEntries('workflow');
    const selected = ref ? runningHubEntryKey(ref.kind, ref.id) : '';
    const optionHtml = (kind, entries, label) => entries.map(entry => {
            const id = runningHubEntryId(entry, kind);
            const key = runningHubEntryKey(kind, id);
            const icon = kind === 'workflow' ? 'workflow' : kind === 'model' ? 'box' : 'sparkles';
            const iconAttributes = kind === 'model'
                ? smartModelVendorOptionAttributes(id, 'runninghub', 'RunningHub')
                : `data-start-icon="${icon}"`;
            return `<option value="${escapeAttr(key)}" ${iconAttributes} ${key === selected ? 'selected' : ''}>${escapeHtml(label)} · ${escapeHtml(runningHubEntryLabel(entry, kind))}</option>`;
        }).join('');
    const options = optionHtml('model', models, tr('smart.rhModelApi'))
        + optionHtml('app', apps, tr('smart.rhAiApp'))
        + optionHtml('workflow', workflows, tr('smart.workflow'));
    return `<ic-select class="rh-config-select" name="runninghub-config" aria-label="${escapeAttr(tr('smart.rhConfig'))}" hierarchy="quiet" placement="top" data-smart-select-param="rhConfigKey" ${options ? '' : 'disabled'}>
        ${options || `<option value="__no_config__" selected disabled>${escapeHtml(tr('smart.rhNeedConfig'))}</option>`}
        <ic-icon name="workflow" size="small" slot="start" aria-hidden="true"></ic-icon>
        <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
    </ic-select>`;
}
function renderRhPaymentControl(){
    const value = settings.rhPayment === 'wallet' ? 'wallet' : 'free';
    const labels = {free:tr('smart.rhFreeKey'), wallet:tr('smart.rhWalletKey')};
    return `<ic-select class="rh-payment-select" name="runninghub-payment" aria-label="${escapeAttr(tr('smart.rhKey'))}" hierarchy="quiet" placement="top" data-smart-select-param="rhPayment">
        ${Object.entries(labels).map(([key, label]) => `<option value="${escapeAttr(key)}" ${key === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
        <ic-icon name="credits" size="small" slot="start" aria-hidden="true"></ic-icon>
        <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
    </ic-select>`;
}
function renderRhMachineControl(){
    const value = settings.rhInstanceType === 'plus' ? 'plus' : '';
    const labels = {'':'24G', plus:'48G'};
    return `<ic-select class="rh-machine-select" name="runninghub-machine" aria-label="${escapeAttr(tr('smart.rhMachine'))}" hierarchy="quiet" placement="top" data-smart-select-param="rhInstanceType">
        ${Object.entries(labels).map(([key, label]) => `<option value="${escapeAttr(key || '__default__')}" ${key === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
        <ic-icon name="settings" size="small" slot="start" aria-hidden="true"></ic-icon>
        <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
    </ic-select>`;
}
function renderMsParams(){
    const requestedMode = String(settings.msgenModel || '').trim();
    if(!requestedMode){
        settings.msgenModel = 'zimage';
    } else if(!MS_GEN_MODELS[requestedMode]){
        notifySmartSettingUnavailable(tr('smart.imageModel'), requestedMode);
    }
    if(settings.msgenModel === 'custom'){
        const customModels = modelscopeImageModels();
        if(!settings.msCustomModel){
            settings.msCustomModel = customModels[0] || '';
        } else if(!customModels.includes(settings.msCustomModel)){
            notifySmartSettingUnavailable(
                tr('smart.imageModel'),
                settings.msCustomModel
            );
        }
    }
    normalizeApiSizeSettings('ms');
    dynamicParams.innerHTML = `
        ${renderMsFunctionControl()}
        ${renderMsCustomModelPill()}
        ${renderSizePickerControl('ms', false, false)}
        ${renderCountVisualControl()}
    `;
}
function renderComfyParams(){
    settings.comfyMode = ['text','enhance','edit','custom'].includes(settings.comfyMode) ? settings.comfyMode : 'text';
    const modeOptions = [
        ['text', tr('canvas.comfyModeText')],
        ['enhance', tr('canvas.comfyModeEnhance')],
        ['edit', tr('canvas.comfyModeEdit')],
        ['custom', tr('canvas.comfyModeCustom')]
    ];
    if(settings.comfyMode === 'custom'){
        const workflowAvailable = comfyWorkflows.some(
            workflow => workflow.name === settings.comfyWorkflow
        );
        if(settings.comfyWorkflow && !workflowAvailable){
            notifySmartSettingUnavailable(
                tr('smart.workflow'),
                settings.comfyWorkflow
            );
        }
        if(workflowAvailable && !comfyWorkflowCache[settings.comfyWorkflow]){
            ensureComfyWorkflow(settings.comfyWorkflow).then(renderDynamicParams);
        }
    }
    let html = '';
    if(settings.comfyMode === 'text'){
        html += `<ic-number-input class="generation-number-input" name="comfy-width" label="${escapeAttr(tr('smart.width'))}" size="small" min="1" step="1" data-param="width" value="${Number(settings.width || 1024)}"></ic-number-input>
            <ic-number-input class="generation-number-input" name="comfy-height" label="${escapeAttr(tr('smart.height'))}" size="small" min="1" step="1" data-param="height" value="${Number(settings.height || 1024)}"></ic-number-input>`;
    } else if(settings.comfyMode === 'enhance'){
        html += `<ic-number-input class="generation-number-input" name="comfy-enhance-strength" label="${escapeAttr(tr('smart.strength'))}" size="small" min="0.1" max="1" step="0.05" data-param="enhanceStrength" value="${Number(settings.enhanceStrength ?? 0.5)}"></ic-number-input>
            ${renderVideoToggleControl('enhanceUpscale', tr('smart.superResolution'))}
            ${settings.enhanceUpscale ? renderUpscalePill('enhanceUpscaleRes', Number(settings.enhanceUpscaleRes || 2048)) : ''}`;
    } else if(settings.comfyMode === 'edit'){
        html += `${renderVideoToggleControl('editUpscale', tr('smart.superResolution'))}
            ${settings.editUpscale ? renderUpscalePill('editUpscaleRes', Number(settings.editUpscaleRes || 2048)) : ''}`;
    } else {
        const wf = comfyWorkflowCache[settings.comfyWorkflow];
        const fields = (wf?.config?.fields || []).filter(f => window.SmartCanvasModules.generationProvider.fieldKind(f) === 'setting');
        html += renderComfyWorkflowControl();
        html += fields.length ? fields.map(renderComfySettingField).join('') : (settings.comfyWorkflow ? '' : `<div class="muted-note">${escapeHtml(tr('smart.noWorkflow'))}</div>`);
    }
    dynamicParams.innerHTML = `
        <ic-select class="comfy-mode-select" name="comfy-mode" aria-label="${escapeAttr(tr('smart.comfyMode'))}" hierarchy="quiet" placement="top" data-smart-select-param="comfyMode">
            ${modeOptions.map(([value, label]) => `<option value="${escapeAttr(value)}" ${value === settings.comfyMode ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
            <ic-icon name="workflow" size="small" slot="start" aria-hidden="true"></ic-icon>
            <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
        </ic-select>
        ${html}
    `;
}
function renderUpscalePill(paramKey, current){
    const opts = [2048, 4096];
    const labels = {2048:'2X / 2048', 4096:'4X / 4096'};
    return `<ic-select class="upscale-select" name="${escapeAttr(paramKey)}" aria-label="${escapeAttr(tr('smart.upscaleTarget'))}" hierarchy="quiet" placement="top" data-smart-select-param="${escapeAttr(paramKey)}">
        ${opts.map(value => `<option value="${value}" ${value === current ? 'selected' : ''}>${escapeHtml(labels[value])}</option>`).join('')}
        <ic-icon name="fit" size="small" slot="start" aria-hidden="true"></ic-icon>
        <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
    </ic-select>`;
}
function renderComfyWorkflowControl(){
    if(!comfyWorkflows.length) return `<div class="muted-note">${escapeHtml(tr('smart.noWorkflow'))}</div>`;
    return `<ic-select class="comfy-workflow-select" name="comfy-workflow" aria-label="${escapeAttr(tr('smart.workflow'))}" hierarchy="quiet" placement="top" data-smart-select-param="comfyWorkflow">
        ${comfyWorkflows.map(workflow => `<option value="${escapeAttr(workflow.name)}" ${workflow.name === settings.comfyWorkflow ? 'selected' : ''}>${escapeHtml(workflow.title || workflow.name.replace('.json',''))}</option>`).join('')}
        <ic-icon name="workflow" size="small" slot="start" aria-hidden="true"></ic-icon>
        <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
    </ic-select>`;
}
function applySourceRatioToSettings(prefix=''){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    if(settings[ratioKey] !== 'source') return;
    const automatic = smartImageAutomaticAspect(prefix);
    if(!automatic.available) return;
    const parts = automatic.ratio.split(':').map(Number);
    const customKey = prefix ? `${prefix}CustomRatio` : 'customRatio';
    const wKey = prefix ? `${prefix}CustomRatioWidth` : 'customRatioWidth';
    const hKey = prefix ? `${prefix}CustomRatioHeight` : 'customRatioHeight';
    settings[wKey] = parts[0];
    settings[hKey] = parts[1];
    settings[customKey] = automatic.ratio;
}
function renderProviderControl(providers){
    const current = (providers || []).find(p => p.id === settings.provider_id) || apiProviderById(settings.provider_id);
    return `<ic-select class="provider-select" name="image-provider" aria-label="${escapeAttr(tr('smart.apiPlatform'))}" hierarchy="quiet" placement="top" data-smart-select-param="provider_id" data-component-variant="model-picker" data-legal-combination="model-picker-vertical-manual-label" ${providers.length ? '' : 'disabled'}>
        ${providers.map(provider => `<option value="${escapeAttr(provider.id)}" ${smartModelVendorOptionAttributes('', provider.id, provider.name)} ${provider.id === settings.provider_id ? 'selected' : ''}>${escapeHtml(provider.name || provider.id)}</option>`).join('') || `<option value="__no_provider__" selected disabled>${escapeHtml(tr('smart.noApiPlatform'))}</option>`}
        <span slot="start" aria-hidden="true">${smartModelVendorIconMarkup('', current?.id || settings.provider_id, current?.name)}</span>
        <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
    </ic-select>`;
}
function renderModelControl(models){
    const provider = apiProviderById(settings.provider_id);
    return `<ic-select class="catalog-model-select" name="image-model" aria-label="${escapeAttr(tr('smart.imageModel'))}" hierarchy="quiet" placement="top" data-smart-select-param="model" data-component-variant="model-picker" data-legal-combination="model-picker-vertical-manual-label" ${models.length ? '' : 'disabled'}>
        ${models.map(model => `<option value="${escapeAttr(model)}" ${smartModelVendorOptionAttributes(model, settings.provider_id, provider?.name)} ${model === settings.model ? 'selected' : ''}>${escapeHtml(model)}</option>`).join('') || `<option value="__no_model__" selected disabled>${escapeHtml(tr('smart.noImageModel'))}</option>`}
        <span slot="start" aria-hidden="true">${smartModelVendorIconMarkup(settings.model, settings.provider_id, provider?.name)}</span>
        <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
    </ic-select>`;
}
function msModelLabel(key){
    if(key === 'custom') return tr('smart.custom');
    return MS_GEN_MODELS[key]?.label || key;
}
function renderMsFunctionControl(){
    return `<ic-select class="catalog-model-select" name="modelscope-function" aria-label="${escapeAttr(tr('smart.msFunction'))}" hierarchy="quiet" placement="top" data-smart-select-param="msgenModel" data-component-variant="model-picker" data-legal-combination="model-picker-vertical-manual-label">
        ${Object.keys(MS_GEN_MODELS).map(key => `<option value="${escapeAttr(key)}" ${smartModelVendorOptionAttributes('', 'modelscope', 'ModelScope')} ${key === settings.msgenModel ? 'selected' : ''}>${escapeHtml(msModelLabel(key))}</option>`).join('')}
        <span slot="start" aria-hidden="true">${smartModelVendorIconMarkup('', 'modelscope', 'ModelScope')}</span>
        <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
    </ic-select>`;
}
function renderMsCustomModelPill(){
    if(settings.msgenModel !== 'custom') return '';
    const models = modelscopeImageModels();
    return `<ic-select class="catalog-model-select" name="modelscope-custom-model" aria-label="${escapeAttr(tr('smart.msCustomModel'))}" hierarchy="quiet" placement="top" data-smart-select-param="msCustomModel" data-component-variant="model-picker" data-legal-combination="model-picker-vertical-manual-label" ${models.length ? '' : 'disabled'}>
        ${models.map(model => `<option value="${escapeAttr(model)}" ${smartModelVendorOptionAttributes(model, 'modelscope', 'ModelScope')} ${model === settings.msCustomModel ? 'selected' : ''}>${escapeHtml(model)}</option>`).join('') || `<option value="__no_model__" selected disabled>${escapeHtml(tr('smart.noMsModel'))}</option>`}
        <span slot="start" aria-hidden="true">${smartModelVendorIconMarkup(settings.msCustomModel, 'modelscope', 'ModelScope')}</span>
        <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
    </ic-select>`;
}
function smartImageCapabilitySelection(prefix=''){
    if(prefix === 'ms'){
        const model = settings.msgenModel === 'custom'
            ? settings.msCustomModel
            : (MS_GEN_MODELS[settings.msgenModel || 'zimage']?.modelId || settings.msgenModel || 'zimage');
        return {providerId:'modelscope',modelId:String(model || '')};
    }
    if(settings.engine === 'runninghub'){
        const ref = selectedRunningHubRef(settings);
        return {providerId:'runninghub',modelId:String(ref?.id || settings.model || '')};
    }
    if(settings.engine === 'comfy'){
        return {providerId:'comfyui',modelId:String(settings.comfyWorkflow || settings.comfyMode || '')};
    }
    return {providerId:String(settings.provider_id || ''),modelId:String(settings.model || '')};
}
function smartImageCapabilityReferences(){
    const node = activeComposerNode() || window.SmartCanvasModules.viewportSelection.selection.node();
    if(!node) return [];
    try {
        return imageRefsOnly(defaultReferenceImagesFor(node, false, smartLoopContext));
    } catch(_error) {
        return (node.images || []).filter(item => item?.url && !isAudioMediaItem(item));
    }
}
function smartCurrentImageCapability(prefix=''){
    const selection = smartImageCapabilitySelection(prefix);
    return window.SmartCanvasModules.imageCapabilities.current(selection.providerId, selection.modelId);
}
function smartImageCapabilityWarningKey(prefix=''){
    const selection = smartImageCapabilitySelection(prefix);
    return [prefix, selection.providerId, selection.modelId]
        .map(value => String(value || '').trim())
        .join('\u001f');
}
let pendingSmartImageCapabilityTransition = null;
function smartImageCapabilityTransitionStart(prefix=''){
    const capability = smartCurrentImageCapability(prefix);
    const validation = window.SmartCanvasModules.imageCapabilities.validate(settings, {
        prefix,
        references:smartImageCapabilityReferences(),
        capability
    });
    return {
        prefix,
        fromKey:smartImageCapabilityWarningKey(prefix),
        previousSettingsSupported:capability?.known === true && validation.valid === true
    };
}
function smartImageCapabilityTransitionFinish(start){
    if(!start) return null;
    const toKey = smartImageCapabilityWarningKey(start.prefix);
    return start.previousSettingsSupported && start.fromKey !== toKey
        ? {...start,toKey}
        : null;
}
function smartImageAutomaticAspect(prefix=''){
    return window.SmartCanvasModules.imageCapabilities.automatic(
        smartImageCapabilityReferences(),
        smartCurrentImageCapability(prefix)
    );
}
function smartImageRatioOptions(prefix=''){
    const capability = smartCurrentImageCapability(prefix);
    return (capability.aspect_ratios || []).map(ratio => ({
        ratio,
        key:window.SmartCanvasModules.imageCapabilities.standardToRatioKey(ratio) || ratio
    }));
}
function renderSizePickerControl(prefix='', includeSource=false, includeQuality=true){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    const resKey = prefix ? `${prefix}Resolution` : 'resolution';
    const capability = smartCurrentImageCapability(prefix);
    const references = smartImageCapabilityReferences();
    const warningKey = smartImageCapabilityWarningKey(prefix);
    const reconciled = window.SmartCanvasModules.imageCapabilities.reconcile(settings, capability, references, {prefix});
    const transitionMatches = pendingSmartImageCapabilityTransition?.prefix === prefix
        && pendingSmartImageCapabilityTransition?.toKey === warningKey;
    const shouldWarn = window.SmartCanvasModules.imageCapabilities.shouldWarnForTransition(
        pendingSmartImageCapabilityTransition,
        {prefix,currentKey:warningKey,capability,invalidated:reconciled.invalidated}
    );
    if(capability.known === true){
        settings[ratioKey] = reconciled.settings[ratioKey];
        settings[resKey] = reconciled.settings[resKey];
    }
    if(capability.known === true && reconciled.invalidated.length && shouldWarn){
        settings._imageCapabilityWarning = true;
        settings._imageCapabilityWarningKey = warningKey;
    }
    if(capability.known === true && transitionMatches){
        pendingSmartImageCapabilityTransition = null;
    }
    if(settings._imageCapabilityWarningKey !== warningKey){
        delete settings._imageCapabilityWarning;
        delete settings._imageCapabilityWarningKey;
    }
    const automatic = reconciled.automatic;
    if(includeSource && automatic.available && settings._imageRatioExplicit !== true && settings[ratioKey] !== 'source'){
        settings[ratioKey] = 'source';
    }
    if(includeSource && settings[ratioKey] === 'source') applySourceRatioToSettings(prefix);
    const ratios = smartImageRatioOptions(prefix);
    const tiers = capability.resolution_tiers || [];
    const currentRatio = settings[ratioKey] || '';
    const currentRes = String(
        settings[resKey]
        || reconciled.settings[resKey]
        || window.SmartCanvasModules.imageCapabilities.preferredResolution(capability)
        || ''
    ).toLowerCase();
    const presets = [
        ...(includeSource && automatic.available ? ['source'] : []),
        ...ratios.map(item => item.key)
    ];
    const warning = settings._imageCapabilityWarning === true
        && settings._imageCapabilityWarningKey === warningKey
        ? tr('smart.modelSettingsUnsupported')
        : '';
    return `<ic-generation-settings-picker
        class="generation-settings-picker"
        label="${escapeAttr(tr('smart.sizeSelection'))}"
        ratio="${escapeAttr(currentRatio)}"
        ratio-presets="${escapeAttr(presets.join(','))}"
        resolution="${escapeAttr(currentRes)}"
        resolutions="${escapeAttr(tiers.map(value => value.toLowerCase()).join(','))}"
        quality="${escapeAttr(settings.quality || 'auto')}"
        ratio-label="${escapeAttr(tr('smart.ratio'))}"
        resolution-label="${escapeAttr(tr('smart.resolution'))}"
        quality-label="${escapeAttr(tr('smart.quality'))}"
        source-label="${escapeAttr(tr('smart.sourceOriginal'))}"
        source-ratio="${escapeAttr(automatic.ratio || '')}"
        quality-auto-label="${escapeAttr(tr('smart.qualityAuto'))}"
        quality-low-label="${escapeAttr(tr('smart.qualityLow'))}"
        quality-medium-label="${escapeAttr(tr('smart.qualityMid'))}"
        quality-high-label="${escapeAttr(tr('smart.qualityHigh'))}"
        data-smart-generation-settings
        data-smart-generation-prefix="${escapeAttr(prefix)}"
        ${capability.show_resolution_control ? '' : 'hide-resolution'}
        ${includeQuality ? '' : 'hide-quality'}
        ${warning ? `warning="${escapeAttr(warning)}"` : ''}
    ></ic-generation-settings-picker>`;
}
function renderCountVisualControl(){
    const value = Number(settings.count || 1);
    const unit = tr('smart.countUnit');
    return `<ic-select class="generation-count-select" name="generation-count" aria-label="${escapeAttr(tr('smart.count'))}" hierarchy="quiet" size="small" placement="top" data-component-variant="generation-count" data-smart-select-param="count">
        ${[1,2,3,4,5,6,7,8].map(n => `<option value="${n}" ${n === value ? 'selected' : ''}>${n}${unit ? ` ${escapeHtml(unit)}` : ''}</option>`).join('')}
        <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
    </ic-select>`;
}
function renderComfySettingField(field){
    const value = comfyParamValue(field);
    const label = field.name || field.input || field.id;
    if(field.type === 'boolean') return `<ic-switch class="generation-setting-switch" name="comfy-${escapeAttr(field.id)}" label="${escapeAttr(label)}" size="s" data-comfy-bool="${escapeAttr(field.id)}" ${value ? 'checked' : ''}></ic-switch>`;
    if(field.type === 'dropdown'){
        const opts = field.options || [];
        return `<ic-select class="comfy-setting-select" name="comfy-${escapeAttr(field.id)}" aria-label="${escapeAttr(label)}" hierarchy="quiet" placement="top" data-comfy-pick="${escapeAttr(field.id)}" ${opts.length ? '' : 'disabled'}>
            ${opts.map(option => `<option value="${escapeAttr(option)}" ${String(option) === String(value) ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('') || `<option value="__no_option__" selected disabled>${escapeHtml(tr('smart.noOption'))}</option>`}
            <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
        </ic-select>`;
    }
    if(field.type === 'textarea') return `<ic-textarea class="generation-textarea" name="comfy-${escapeAttr(field.id)}" aria-label="${escapeAttr(label)}" placeholder="${escapeAttr(label)}" resize="vertical" rows="2" data-comfy-param="${escapeAttr(field.id)}" value="${escapeAttr(value)}"></ic-textarea>`;
    const type = (field.type === 'number' || field.type === 'slider') ? 'number' : 'text';
    const min = field.min !== undefined ? ` min="${escapeHtml(field.min)}"` : '';
    const max = field.max !== undefined ? ` max="${escapeHtml(field.max)}"` : '';
    const step = field.step !== undefined ? ` step="${escapeHtml(field.step)}"` : '';
    const isNumeric = type === 'number';
    const inputHtml = isNumeric
        ? `<ic-number-input class="generation-number-input" name="comfy-${escapeAttr(field.id)}" label="${escapeAttr(label)}" size="small" data-comfy-param="${escapeAttr(field.id)}" value="${escapeAttr(value)}"${min}${max}${step}></ic-number-input>`
        : `<ic-input class="generation-text-input" name="comfy-${escapeAttr(field.id)}" aria-label="${escapeAttr(label)}" size="small" data-comfy-param="${escapeAttr(field.id)}" value="${escapeAttr(value)}"></ic-input>`;
    if(isNumeric && comfyRandomEnabledField(field)){
        const active = smartComfyRandomActive(field.id);
        return `<div class="generation-field-with-action" title="${escapeAttr(label)}">
            ${inputHtml}
            <ic-icon-button type="button" class="generation-random-toggle" size="xs" hierarchy="quiet" icon="random" label="${escapeAttr(active ? tr('smart.diceOn') : tr('smart.diceOff'))}" toggle ${active ? 'pressed' : ''} data-comfy-random="${escapeAttr(field.id)}"></ic-icon-button>
        </div>`;
    }
    return inputHtml;
}
const RH_KNOWN_FIELD_OPTIONS = {
    aspectRatio:['1:1','16:9','9:16','4:3','3:4','4:5','5:4','3:2','2:3','21:9','9:21'],
    aspect_ratio:['1:1','16:9','9:16','4:3','3:4','4:5','5:4','3:2','2:3','21:9','9:21'],
    ratio:['1:1','16:9','9:16','21:9','9:21','4:3','3:4','4:5','5:4','3:2','2:3'],
    resolution:['1k','2k','4k','8k'],
    size:['512','768','1024','1280','1536','2048'],
    quality:['low','medium','high','best'],
    scheduler:['normal','karras','exponential','sgm_uniform','simple','ddim_uniform'],
    sampler:['euler','euler_ancestral','heun','dpm_2','dpm_2_ancestral','lms','dpmpp_2m','dpmpp_sde','ddim','uni_pc']
};
function rhParamKey(nodeId, fieldName){
    return `${nodeId ?? ''}::${fieldName ?? ''}`;
}
function rhFieldKind(field){
    const type = String(field?.fieldType || '').trim().toUpperCase();
    if(type === 'IMAGE') return 'image';
    if(type === 'VIDEO') return 'video';
    if(type === 'AUDIO') return 'audio';
    if(type === 'SLIDER') return 'slider';
    if(['NUMBER','FLOAT','INTEGER','INT'].includes(type)) return 'number';
    if(['BOOLEAN','BOOL'].includes(type)) return 'boolean';
    const key = `${field?.fieldName || ''} ${field?.fieldValue || ''}`.toLowerCase();
    if(/\b(image|img|mask|photo|picture)\b/.test(key) || /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(key)) return 'image';
    if(/\b(video|movie|mp4)\b/.test(key) || /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(key)) return 'video';
    if(/\b(audio|sound|music|voice)\b/.test(key) || /\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i.test(key)) return 'audio';
    return 'text';
}
function rhFieldRole(field){
    const kind = rhFieldKind(field);
    if(['image','video','audio','number','slider','boolean'].includes(kind)) return kind;
    const text = `${field?.fieldName || ''} ${field?.label || ''} ${field?.group || ''}`.toLowerCase();
    if(/prompt|positive|negative|text|caption|description|关键词|提示词|正向|负向/.test(text)) return 'prompt';
    return 'text';
}
function rhExtractFieldOptions(field){
    const candidates = [field?.fieldData, field?.options, field?.list, field?.values, field?.enum, field?.choices, field?.items, field?.selectOptions, field?.dropdown];
    for(const candidate of candidates){
        if(!Array.isArray(candidate) || !candidate.length) continue;
        if(candidate.every(x => ['string','number'].includes(typeof x))) return candidate.map(String);
        if(candidate.every(x => x && typeof x === 'object' && ('value' in x || 'label' in x || 'name' in x))){
            return candidate.map(x => x.value ?? x.label ?? x.name).filter(v => v !== undefined && v !== null).map(String);
        }
    }
    const name = String(field?.fieldName || '').trim();
    if(name){
        if(RH_KNOWN_FIELD_OPTIONS[name]) return RH_KNOWN_FIELD_OPTIONS[name].map(String);
        const hit = Object.keys(RH_KNOWN_FIELD_OPTIONS).find(k => k.toLowerCase() === name.toLowerCase());
        if(hit) return RH_KNOWN_FIELD_OPTIONS[hit].map(String);
    }
    return null;
}
function rhDefaultValue(field){
    let value = field?.fieldValue;
    if(Array.isArray(value)) value = value[0];
    if(value === undefined || value === null || typeof value === 'object') return '';
    return String(value);
}
function rhIsWorkflowLinkValue(value){
    return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && Number.isInteger(value[1]);
}
function rhRandomEnabled(field){
    return rhFieldKind(field) === 'number' && field?.random_enabled === true;
}
function smartRhRandomActive(key){
    return smartRhRandomActiveFor(settings, key);
}
function smartRhRandomActiveFor(sourceSettings=settings, key){
    sourceSettings = sourceSettings || settings;
    sourceSettings.rhRandomActive = sourceSettings.rhRandomActive || {};
    return sourceSettings.rhRandomActive[key] !== false;
}
function toggleSmartRhRandom(key){
    const field = rhActiveFields().find(f => rhParamKey(f.nodeId, f.fieldName) === key);
    if(!rhRandomEnabled(field)) return;
    settings.rhRandomActive = settings.rhRandomActive || {};
    settings.rhRandomActive[key] = !smartRhRandomActive(key);
    persistActiveSmartSettings();
    renderDynamicParams();
    canvasPersistence.schedule();
}
function smartRhRandomValue(field){
    return smartComfyRandomValue({
        input:field.fieldName,
        name:field.label || field.fieldName,
        min:field.min,
        max:field.max,
        step:field.step,
        type:'number'
    });
}
function rhParamValue(field, media=null, sourceSettings=settings, fields=null, randomValues=smartRhRandomValues){
    sourceSettings = sourceSettings || settings;
    sourceSettings.rhParams = sourceSettings.rhParams || {};
    const key = rhParamKey(field.nodeId, field.fieldName);
    const param = sourceSettings.rhParams[key];
    const kind = rhFieldKind(field);
    if(['image','video','audio'].includes(kind)){
        const idx = rhFieldIndexes(fields || rhActiveFields(sourceSettings))[key] || 0;
        const up = media?.[kind]?.[idx]?.url || '';
        if(rhCurrentKind(sourceSettings) === 'workflow' && kind === 'image' && field.required !== true && !up) return '';
        return up || param?.value || rhDefaultValue(field);
    }
    if(rhRandomEnabled(field) && smartRhRandomActiveFor(sourceSettings, key)){
        if(randomValues[key] === undefined) randomValues[key] = smartRhRandomValue(field);
        return randomValues[key];
    }
    if(rhFieldRole(field) === 'prompt') return param?.value ?? (media?.prompt || rhDefaultValue(field));
    return param?.value ?? rhDefaultValue(field);
}
function rhUserParamValue(field){
    settings.rhParams = settings.rhParams || {};
    const key = rhParamKey(field.nodeId, field.fieldName);
    return settings.rhParams[key]?.value ?? '';
}
function rhPromptPlaceholder(field){
    return rhDefaultValue(field) || field?.label || field?.fieldName || tr('smart.promptPlaceholder');
}
function rhDefaultPromptSuggestion(){
    if(settings.engine !== 'runninghub') return '';
    const fields = rhActiveFields().filter(field => rhFieldRole(field) === 'prompt');
    for(const field of fields){
        const value = rhDefaultValue(field).trim();
        if(value) return value;
    }
    return '';
}
function updatePromptPlaceholder(){
    if(!promptInput) return;
    const suggestion = rhDefaultPromptSuggestion();
    promptInput.dataset.placeholder = suggestion || tr('smart.promptPlaceholder');
}
function rhFieldIndexes(fields){
    const counters = {image:0, video:0, audio:0};
    const map = {};
    sortRunningHubFields(fields).forEach(field => {
        const kind = rhFieldKind(field);
        if(['image','video','audio'].includes(kind)){
            map[rhParamKey(field.nodeId, field.fieldName)] = counters[kind]++;
        }
    });
    return map;
}
async function ensureRunningHubWorkflow(workflowId){
    workflowId = String(workflowId || '').trim();
    if(!workflowId) return null;
    if(runningHubWorkflowCache[workflowId]) return runningHubWorkflowCache[workflowId];
    const res = await fetch(`/api/runninghub/workflows/${encodeURIComponent(workflowId)}`);
    if(!res.ok){
        delete runningHubWorkflowCache[workflowId];
        return null;
    }
    const data = await res.json();
    runningHubWorkflowCache[workflowId] = data.workflow || null;
    return runningHubWorkflowCache[workflowId];
}
async function currentRunningHubWorkflowConfig(sourceSettings=settings){
    const ref = selectedRunningHubRef(sourceSettings);
    if(ref?.kind !== 'workflow') return null;
    const cached = await ensureRunningHubWorkflow(ref.id).catch(() => null);
    return {
        ...(ref.entry || {}),
        ...(cached || {}),
        workflowId:ref.id,
        fields:Array.isArray(cached?.fields) && cached.fields.length ? cached.fields : rhEntryFields(ref.entry),
        optionalImageMode:ref.entry?.optionalImageMode || cached?.optionalImageMode || 'prune-workflow',
        workflowJson:rhWorkflowJsonFromSources(cached?.workflowJson, ref.entry?.workflowJson, ref.entry?.raw?.workflowJson, ref.entry?.raw?.prompt)
    };
}
function rhMediaForRun(prompt, refs){
    const cleanRefs = (refs || []).filter(ref => ref?.url);
    return {
        refs:cleanRefs,
        image:imageRefsOnly(cleanRefs),
        video:videoRefsOnly(cleanRefs),
        audio:audioRefsOnly(cleanRefs),
        prompt:String(prompt || '').trim()
    };
}
function tempShUploadedUrlFor(url, sourceSettings=settings, reference=null){
    const source = String(url || '');
    const manualLinks = ((sourceSettings || settings).videoTempShLinks || []).filter(item => item?.manual === true);
    const links = [...(transientSmartCloudLinks || []), ...manualLinks];
    const instanceId = String(reference?.inputInstanceId || '');
    const sourceMatches = item => item?.url
        && (item?.source === source || item?.originalLocalUrl === source || item?.url === source);
    const match = (instanceId
        ? links.find(item => item?.url && item?.inputInstanceId === instanceId)
        : null
    ) || links.find(item => !item?.inputInstanceId && sourceMatches(item));
    return match?.url || url;
}
function mediaRefSourceUrl(ref){
    return localDisplayUrlForMediaItem(ref) || ref?.sourceUrl || ref?.originalLocalUrl || ref?.url || '';
}
function applyUploadedUrlsToSmartRefs(refs, sourceSettings=settings){
    return (refs || []).map(ref => {
        if(!ref?.url) return ref;
        const sourceUrl = mediaRefSourceUrl(ref);
        const url = tempShUploadedUrlFor(sourceUrl, sourceSettings, ref);
        return url && url !== ref.url ? {...ref, url, originalLocalUrl:ref.originalLocalUrl || ref.url} : ref;
    });
}
function manualSmartVideoLink(sourceSettings=settings){
    return ((sourceSettings || settings).videoTempShLinks || []).find(item => item?.manual === true && item?.url) || null;
}
function manualSmartMediaLinks(sourceSettings=settings){
    return ((sourceSettings || settings).videoTempShLinks || []).filter(item => item?.manual === true && item?.url);
}
function renderedInputMediaRefs(){
    if(!inputThumbsRow) return [];
    return [...inputThumbsRow.querySelectorAll('.input-thumb')].map((el, index) => ({
        url:el.dataset.url || '',
        sourceUrl:el.dataset.sourceUrl || el.dataset.url || '',
        nodeId:el.dataset.nodeId || '',
        imageIndex:Number.isFinite(Number(el.dataset.imageIndex)) ? Number(el.dataset.imageIndex) : index,
        outputId:el.dataset.outputId || '',
        inputInstanceId:el.dataset.inputInstanceId || '',
        name:tr('smart.inputNum').replace('{n}', String(index + 1)),
        role:`image_${index + 1}`
    })).filter(ref => ref.url);
}
function currentSmartMediaRefs(node){
    if(!node) return [];
    const request = promptAuthoring.resolve({node, consumeDefault:true});
    return (request.refs || []).filter(ref => ref?.url && ['image','video'].includes(mediaKindForItem(ref)));
}
function currentUploadMediaRefs(node){
    const rendered = renderedInputMediaRefs();
    if(rendered.length) return rendered;
    return currentSmartMediaRefs(node);
}
function currentSmartMediaLinks(node=null){
    return currentUploadMediaRefs(node || activeSettingsSubject()).map(ref => {
        const sourceUrl = mediaRefSourceUrl(ref);
        const uploaded = tempShUploadedUrlFor(sourceUrl, settings, ref);
        return uploaded && uploaded !== sourceUrl ? uploaded : '';
    }).filter(Boolean);
}
function clearManualSmartVideoUrl(){
    settings.videoTempShLinks = (settings.videoTempShLinks || []).filter(item => item?.manual !== true);
}
function splitManualMediaUrls(text){
    return String(text || '')
        .split(/[\s,，]+/)
        .map(url => url.trim())
        .filter(Boolean);
}
async function uploadMediaRefToCloud(ref){
    const kind = mediaKindForItem(ref);
    const sourceUrl = mediaRefSourceUrl(ref);
    if(!sourceUrl) throw new Error(tr('smart.noUploadableMedia'));
    const existing = tempShUploadedUrlFor(sourceUrl, settings, ref);
    if(existing && existing !== sourceUrl) return existing;
    if(/^https?:\/\//i.test(sourceUrl)) return sourceUrl;
    const response = await fetch('/api/cloud-video/upload', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({url:sourceUrl, service:'auto'})
    });
    if(!response.ok) throw new Error(await smartResponseErrorMessage(response, tr('smart.cloudUploadFailed')));
    const data = await response.json();
    const uploadedUrl = data.url || '';
    if(!uploadedUrl) throw new Error(tr('smart.cloudNoLink'));
    transientSmartCloudLinks = [
        ...(transientSmartCloudLinks || []).filter(item => ref?.inputInstanceId
            ? item?.inputInstanceId !== ref.inputInstanceId
            : item?.source !== sourceUrl),
        {
            source:sourceUrl,
            url:uploadedUrl,
            expires:data.expires || '3 days',
            kind,
            inputInstanceId:ref?.inputInstanceId || ''
        }
    ];
    return uploadedUrl;
}
function applyManualVideoUrlToSmartRef(ref, manualUrl){
    if(!manualUrl) return;
    const sourceUrl = mediaRefSourceUrl(ref) || manualUrl;
    settings.videoTempShLinks = [
        ...(settings.videoTempShLinks || []).filter(item => ref?.inputInstanceId
            ? item?.inputInstanceId !== ref.inputInstanceId
            : item?.source !== sourceUrl),
        {
            source:sourceUrl,
            url:manualUrl,
            manual:true,
            inputInstanceId:ref?.inputInstanceId || ''
        }
    ];
}
async function setCurrentSmartManualVideoUrl(){
    const node = activeSettingsSubject();
    if(!node) return '';
    savePromptDraftForCurrent();
    const refs = currentUploadMediaRefs(node);
    const firstLocal = refs.find(ref => ref?.url && !isRemoteVideoReferenceUrl(ref.url));
    const firstAny = firstLocal || refs[0] || null;
    const linkedUrls = currentSmartMediaLinks(node);
    const currentLinks = linkedUrls.length ? linkedUrls : (firstAny ? [tempShUploadedUrlFor(mediaRefSourceUrl(firstAny), settings, firstAny)] : []);
    const value = await openAssetNameDialog({
        title:refs.length > 1 ? trf('smart.mediaUrlsTitle', {count: refs.length}) : tr('smart.mediaUrlSingleTitle'),
        value:currentLinks.filter(isRemoteVideoReferenceUrl).join('\n'),
        placeholder:refs.length > 1 ? tr('smart.mediaUrlsPlaceholder') : tr('smart.mediaUrlPlaceholder'),
        cancelValue:null,
        multiline:refs.length > 1
    });
    if(value === null) return '';
    const urls = splitManualMediaUrls(value);
    if(!urls.length){
        clearManualSmartVideoUrl();
        persistActiveSmartSettings();
        canvasPersistence.schedule();
        render();
        toast(tr('smart.manualUrlCleared'));
        return '';
    }
    const invalid = urls.find(url => !isRemoteVideoReferenceUrl(url));
    if(invalid){
        toast(tr('smart.invalidMediaUrl'));
        return '';
    }
    clearManualSmartVideoUrl();
    const targets = refs.length ? refs : [firstAny].filter(Boolean);
    urls.forEach((url, index) => {
        const target = targets[index] || targets[targets.length - 1] || {url};
        applyManualVideoUrlToSmartRef(target, url);
    });
    persistActiveSmartSettings();
    canvasPersistence.schedule();
    render();
    toast(trf('smart.mediaUrlsSet', {count: urls.length}));
    return urls[0] || '';
}
async function uploadCurrentSmartVideosToCloud(){
    const node = activeSettingsSubject();
    if(!node) return [];
    savePromptDraftForCurrent();
    const refs = currentUploadMediaRefs(node);
    const localRefs = refs.filter(ref => {
        const sourceUrl = ref?.sourceUrl || ref?.originalLocalUrl || ref?.url || '';
        if(!sourceUrl) return false;
        const uploaded = tempShUploadedUrlFor(sourceUrl, settings, ref);
        return uploaded !== sourceUrl || !isRemoteVideoReferenceUrl(sourceUrl);
    });
    if(!localRefs.length){
        toast(tr('smart.alreadyCloudMedia'));
        return [];
    }
    const btn = dynamicParams?.querySelector('[data-trusted-source="cloud"]') || inputThumbsRow?.querySelector('[data-temp-sh-upload-video]');
    if(btn) btn.disabled = true;
    toast(trf('smart.cloudUploadingFiles', {count: localRefs.length}));
    try {
        const urls = [];
        for(const ref of localRefs){
            urls.push(await uploadMediaRefToCloud(ref));
        }
        toast(trf('smart.cloudUploadedFiles', {count: urls.length}));
        return urls;
    } finally {
        if(btn) btn.disabled = false;
    }
}
function rhRequiredLabel(field){
    return field?.label || field?.fieldName || `#${field?.nodeId || ''}`;
}
function rhPruneWorkflowForMissingFields(workflowJson, missingFields){
    if(!workflowJson || typeof workflowJson !== 'object' || !missingFields?.length) return null;
    const workflow = JSON.parse(JSON.stringify(workflowJson));
    const removeIds = new Set();
    missingFields.forEach(field => {
        const node = workflow[String(field.nodeId)];
        if(node?.inputs && Object.prototype.hasOwnProperty.call(node.inputs, field.fieldName)){
            delete node.inputs[field.fieldName];
        }
        if(node && (!node.inputs || !Object.keys(node.inputs).length)){
            removeIds.add(String(field.nodeId));
        }
    });
    removeIds.forEach(id => delete workflow[id]);
    Object.values(workflow).forEach(node => {
        if(!node?.inputs || typeof node.inputs !== 'object') return;
        Object.entries(node.inputs).forEach(([name, value]) => {
            if(rhIsWorkflowLinkValue(value) && removeIds.has(String(value[0]))) delete node.inputs[name];
        });
    });
    return workflow;
}
async function rhBuildWorkflowRequestExtras(media, nodeInfoList, sourceSettings=settings){
    const config = await currentRunningHubWorkflowConfig(sourceSettings);
    if(!config || (config.optionalImageMode || 'prune-workflow') !== 'prune-workflow') return {};
    const fields = rhActiveFields(sourceSettings);
    const indexes = rhFieldIndexes(fields);
    const missingOptional = [];
    for(const field of fields){
        if(rhFieldKind(field) !== 'image') continue;
        const key = rhParamKey(field.nodeId, field.fieldName);
        const idx = indexes[key] || 0;
        const hasInput = Boolean(media.image?.[idx]?.url);
        if(field.required === true && !hasInput) throw new Error(trf('canvas.rhRequiredImageMissing', {name: rhRequiredLabel(field)}));
        if(field.required !== true && !hasInput) missingOptional.push(field);
    }
    if(!missingOptional.length) return {};
    missingOptional.forEach(field => {
        const key = rhParamKey(field.nodeId, field.fieldName);
        const idx = nodeInfoList.findIndex(item => rhParamKey(item.nodeId, item.fieldName) === key);
        if(idx >= 0) nodeInfoList.splice(idx, 1);
    });
    const workflow = rhPruneWorkflowForMissingFields(config.workflowJson || {}, missingOptional);
    return workflow ? {workflow} : {};
}
async function rhUploadValueIfNeeded(value, sourceSettings=settings){
    const text = String(value || '').trim();
    if(!text) return '';
    if(!/^https?:\/\//i.test(text) && !text.startsWith('/assets/')) return text;
    const res = await fetch('/api/runninghub/upload-asset', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({url:text, useWallet:(sourceSettings || settings).rhPayment === 'wallet'})
    });
    const data = await res.json();
    if(!res.ok || data.success === false) throw new Error(data.detail || data.error || tr('smart.rhUploadFailed'));
    return data.data?.fileName || text;
}
async function rhBuildNodeInfoList(media, sourceSettings=settings, randomValues=smartRhRandomValues){
    const fields = rhActiveFields(sourceSettings);
    const result = [];
    const indexes = rhFieldIndexes(fields);
    const mode = rhCurrentKind(sourceSettings);
    for(const field of fields){
        const kind = rhFieldKind(field);
        const key = rhParamKey(field.nodeId, field.fieldName);
        if(mode === 'workflow' && field.sourceFromUpstream === false && !['image','video','audio'].includes(kind)) continue;
        if(mode === 'workflow' && kind === 'image'){
            const idx = indexes[key] || 0;
            if(field.required !== true && !media.image?.[idx]?.url) continue;
        }
        let value = rhParamValue(field, media, sourceSettings, fields, randomValues);
        if(rhFieldRole(field) === 'prompt' && !String(value || '').trim()) value = rhDefaultValue(field);
        if(['image','video','audio'].includes(kind)) value = await rhUploadValueIfNeeded(value, sourceSettings);
        if(['number','slider'].includes(kind) && String(value ?? '').trim() !== '' && !Number.isNaN(Number(value))) value = Number(value);
        result.push({nodeId:field.nodeId, fieldName:field.fieldName, fieldValue:value});
    }
    return result;
}
function renderRhSettingField(field){
    const key = rhParamKey(field.nodeId, field.fieldName);
    const kind = rhFieldRole(field);
    const label = field.label || field.fieldName || 'Field';
    const value = rhParamValue(field, null);
    const options = rhExtractFieldOptions(field);
    if(kind === 'boolean'){
        const active = String(value).toLowerCase() === 'true';
        return `<ic-switch class="generation-setting-switch" name="runninghub-${escapeAttr(key)}" label="${escapeAttr(label)}" size="s" data-rh-bool="${escapeAttr(key)}" ${active ? 'checked' : ''}></ic-switch>`;
    }
    if(kind === 'slider'){
        const min = Number.isFinite(Number(field.min)) ? Number(field.min) : 0;
        const max = Number.isFinite(Number(field.max)) && Number(field.max) > min ? Number(field.max) : 1;
        const step = Number.isFinite(Number(field.step)) && Number(field.step) > 0 ? Number(field.step) : 0.01;
        const numericValue = Number.isFinite(Number(value)) ? Number(value) : min;
        return `<ic-slider class="rh-slider-input" name="runninghub-${escapeAttr(key)}" label="${escapeAttr(label)}" data-rh-param="${escapeAttr(key)}" data-rh-type="slider" min="${escapeAttr(min)}" max="${escapeAttr(max)}" step="${escapeAttr(step)}" value="${escapeAttr(numericValue)}" value-text="${escapeAttr(numericValue)}"></ic-slider>`;
    }
    if(options?.length){
        return `<ic-select class="rh-setting-select" name="runninghub-${escapeAttr(key)}" aria-label="${escapeAttr(label)}" hierarchy="quiet" placement="top" data-rh-pick="${escapeAttr(key)}">
            ${options.map(option => `<option value="${escapeAttr(option)}" ${String(option) === String(value) ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
            <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
        </ic-select>`;
    }
    const type = kind === 'number' ? 'number' : 'text';
    const inputHtml = type === 'number'
        ? `<ic-number-input class="generation-number-input" name="runninghub-${escapeAttr(key)}" label="${escapeAttr(label)}" size="small" data-rh-param="${escapeAttr(key)}" value="${escapeAttr(value)}"></ic-number-input>`
        : `<ic-input class="generation-text-input" name="runninghub-${escapeAttr(key)}" aria-label="${escapeAttr(label)}" size="small" data-rh-param="${escapeAttr(key)}" value="${escapeAttr(value)}"></ic-input>`;
    if(kind === 'number' && rhRandomEnabled(field)){
        const active = smartRhRandomActive(key);
        return `<div class="generation-field-with-action" title="${escapeAttr(label)}">
            ${inputHtml}
            <ic-icon-button type="button" class="generation-random-toggle" size="xs" hierarchy="quiet" icon="random" label="${escapeAttr(active ? tr('smart.diceOn') : tr('smart.diceOff'))}" toggle ${active ? 'pressed' : ''} data-rh-random="${escapeAttr(key)}"></ic-icon-button>
        </div>`;
    }
    return inputHtml;
}
function comfyRandomEnabledField(field){ return field?.type === 'number' && field.random_enabled === true; }
function smartComfyRandomActive(fieldId){
    return smartComfyRandomActiveFor(settings, fieldId);
}
function smartComfyRandomActiveFor(source, fieldId){
    const active = source?.comfyRandomActive || {};
    return active[fieldId] !== false;
}
function toggleSmartComfyRandom(fieldId){
    settings.comfyRandomActive = settings.comfyRandomActive || {};
    settings.comfyRandomActive[fieldId] = !smartComfyRandomActive(fieldId);
    persistActiveSmartSettings();
    renderDynamicParams();
    canvasPersistence.schedule();
}
function smartComfyRandomValue(field){
    const isFloat = Number(field.step) > 0 && Number(field.step) < 1;
    let min = Number.isFinite(Number(field.min)) ? Number(field.min) : null;
    let max = Number.isFinite(Number(field.max)) ? Number(field.max) : null;
    const name = `${field.input || ''} ${field.name || ''}`.toLowerCase();
    const looksSeed = name.includes('seed') || name.includes('noise') || name.includes('随机') || name.includes('噪');
    if(min === null) min = looksSeed ? 1 : 0;
    if(max === null || max <= min) max = looksSeed ? 4294967295 : 999999;
    if(looksSeed) max = Math.min(max, 4294967295);
    const value = min + Math.random() * (max - min);
    if(isFloat){
        const precision = Math.min(8, Math.max(1, String(field.step).split('.')[1]?.length || 2));
        return Number(value.toFixed(precision));
    }
    return Math.floor(value);
}
function setDynamicSetting(key, value){
    const requestedKey = key;
    if(key === 'rhInstanceType' && value === '__default__') value = '';
    const capabilityModelKeys = new Set(['modelChoice','model','msgenModel','msCustomModel','comfyWorkflow','rhConfigKey']);
    const changesImageModel = capabilityModelKeys.has(requestedKey);
    const capabilityPrefix = settings.engine === 'modelscope' ? 'ms' : '';
    const capabilityTransitionStart = changesImageModel
        ? smartImageCapabilityTransitionStart(capabilityPrefix)
        : null;
    if(key === 'modelChoice' || key === 'videoModelChoice'){
        const video = key === 'videoModelChoice';
        const entry = smartModelCatalog(video ? 'video' : 'image').find(item => item.id === value);
        if(!entry) return;
        if(video){ settings.videoProvider = entry.provider_id; settings.videoModel = entry.model; key = 'videoModel'; value = entry.model; }
        else { settings.provider_id = entry.provider_id; settings.model = entry.model; key = 'model'; value = entry.model; }
    }
    const numericKeys = new Set(['count','width','height','videoDuration','enhanceStrength','enhanceUpscaleRes','editUpscaleRes','customRatioWidth','customRatioHeight','customWidth','customHeight','msCustomRatioWidth','msCustomRatioHeight','msCustomWidth','msCustomHeight']);
    const layoutKeys = new Set(['provider_id','model','resolution','ratio','msgenModel','msCustomModel','msResolution','msRatio','videoProvider','videoModel','videoAspect','videoResolution','videoReferenceMode','comfyMode','comfyWorkflow','quality','count','enhanceUpscaleRes','editUpscaleRes','rhConfigKey','rhPayment','rhInstanceType']);
    settings[key] = numericKeys.has(key) && value !== '' ? Number(value) : value;
    if(changesImageModel){
        pendingSmartImageCapabilityTransition = smartImageCapabilityTransitionFinish(capabilityTransitionStart);
        delete settings._imageCapabilityWarning;
        delete settings._imageCapabilityWarningKey;
    }
    if(['ratio','resolution','msRatio','msResolution'].includes(key)){
        delete settings._imageCapabilityWarning;
        delete settings._imageCapabilityWarningKey;
    }
    if(key === 'provider_id') settings.model = '';
    if(key === 'videoProvider') settings.videoModel = '';
    if(key === 'videoReferenceMode'){
        settings._videoMultimodalUserSet = true;
        settings.videoMultimodal = value === 'multimodal_all_around';
        settings.videoUseFrameRoles = value === 'first_last_frames';
    }
    if(key === 'videoMultimodal'){
        settings._videoMultimodalUserSet = true;
        settings.videoReferenceMode = settings.videoMultimodal ? 'multimodal_all_around' : 'image_to_video';
    }
    if(key === 'videoUseFrameRoles'){
        settings.videoReferenceMode = settings.videoUseFrameRoles ? 'first_last_frames' : 'image_to_video';
    }
    normalizeSmartVideoModeSettings(settings, key === 'videoUseFrameRoles');
    if(key === 'comfyMode') applyRecentSmartSettingsForCurrentMode();
    if(key === 'resolution'){
        if(settings.resolution === 'custom') settings.ratio = '';
        else if(!settings.ratio) settings.ratio = 'square';
    }
    if(key === 'ratio') applySourceRatioToSettings('');
    if(key === 'ratio') settings._imageRatioExplicit = value !== 'source';
    if(key === 'msResolution'){
        if(settings.msResolution === 'custom') settings.msRatio = '';
        else if(!settings.msRatio) settings.msRatio = 'square';
    }
    if(key === 'msRatio') applySourceRatioToSettings('ms');
    if(key === 'msRatio') settings._imageRatioExplicit = value !== 'source';
    if(key === 'customRatioWidth' || key === 'customRatioHeight'){
        settings.customRatio = settings.customRatioWidth && settings.customRatioHeight ? `${settings.customRatioWidth}:${settings.customRatioHeight}` : '';
        settings.ratio = 'custom';
    }
    if(key === 'msCustomRatioWidth' || key === 'msCustomRatioHeight'){
        settings.msCustomRatio = settings.msCustomRatioWidth && settings.msCustomRatioHeight ? `${settings.msCustomRatioWidth}:${settings.msCustomRatioHeight}` : '';
        settings.msRatio = 'custom';
    }
    if(key === 'customWidth' || key === 'customHeight'){
        settings.customSize = settings.customWidth && settings.customHeight ? `${settings.customWidth}x${settings.customHeight}` : '';
        settings.resolution = 'custom';
    }
    if(key === 'msCustomWidth' || key === 'msCustomHeight'){
        settings.msCustomSize = settings.msCustomWidth && settings.msCustomHeight ? `${settings.msCustomWidth}x${settings.msCustomHeight}` : '';
        settings.msResolution = 'custom';
    }
    const sizeKeys = new Set(['resolution','ratio','customRatio','customRatioWidth','customRatioHeight','customWidth','customHeight','customSize']);
    const unlockOutpaintSize = settings.outpaintResolutionLocked && sizeKeys.has(key);
    if(unlockOutpaintSize){
        delete settings.outpaintResolutionLocked;
        const subject = activeSettingsSubject();
        if(subject) delete subject.outpaintSize;
    }
    if(key === 'comfyWorkflow') {
        settings.comfyParams = {};
        ensureComfyWorkflow(settings.comfyWorkflow).then(renderDynamicParams);
    }
    if(key === 'rhConfigKey'){
        settings.rhParams = {};
        settings.rhRandomActive = {};
    }
    persistActiveSmartSettings();
    rememberRecentSmartSettings(settings, activeSettingsSubject());
    if(layoutKeys.has(key)) renderDynamicParams();
    if(['provider_id','model','modelChoice','msgenModel','msCustomModel','rhConfigKey'].includes(key)){
        loadSmartImageCapabilityForCurrentSettings({notify:true}).then(() => renderDynamicParams()).catch(() => {});
    }
    if(['videoProvider','videoModel','videoModelChoice','videoReferenceMode'].includes(requestedKey)){
        loadSmartVideoCapabilityForCurrentSettings().then(() => renderDynamicParams()).catch(() => {});
    }
    canvasPersistence.schedule();
}
function bindDynamicParams(){
    dynamicParams.querySelectorAll('ic-generation-settings-picker[data-smart-generation-settings]').forEach(picker => {
        picker.addEventListener('ic-change', event => {
            event.stopPropagation();
            const field = event.detail?.field;
            const prefix = picker.dataset.smartGenerationPrefix || '';
            const video = picker.dataset.smartGenerationMode === 'video';
            const key = video
                ? (field === 'ratio' ? 'videoAspect' : field === 'resolution' ? 'videoResolution' : field === 'duration' ? 'videoDuration' : '')
                : field === 'ratio'
                    ? (prefix ? `${prefix}Ratio` : 'ratio')
                    : field === 'resolution'
                        ? (prefix ? `${prefix}Resolution` : 'resolution')
                        : field === 'quality' ? 'quality' : '';
            if(!key) return;
            const value = video && field === 'resolution' && event.detail.value === 'auto'
                ? ''
                : event.detail.value;
            setDynamicSetting(key, value);
        });
    });
    dynamicParams.querySelectorAll('ic-select[data-smart-select-param]').forEach(select => {
        const closeAfterSelection = ['model-picker', 'generation-count'].includes(select.dataset.componentVariant);
        select.onclick = event => event.stopPropagation();
        select.onchange = event => {
            event.stopPropagation();
            if(closeAfterSelection) void select.hide();
            setDynamicSetting(select.dataset.smartSelectParam, select.value);
        };
    });
    dynamicParams.querySelectorAll('[data-param]').forEach(input => {
        input.onclick = event => event.stopPropagation();
        input.oninput = input.onchange = event => {
            event?.stopPropagation?.();
            setDynamicSetting(input.dataset.param, input.value);
            if(input.dataset.param === 'videoDuration' && event?.type === 'change') renderDynamicParams();
        };
    });
    dynamicParams.querySelectorAll('ic-switch[data-toggle-param]').forEach(switchControl => {
        switchControl.onchange = event => {
            event.stopPropagation();
            settings[switchControl.dataset.toggleParam] = switchControl.checked;
            if(switchControl.dataset.toggleParam === 'videoMultimodal') settings._videoMultimodalUserSet = true;
            if(switchControl.dataset.toggleParam === 'videoMultimodal'){
                settings.videoReferenceMode = settings.videoMultimodal ? 'multimodal_all_around' : 'image_to_video';
            }
            if(switchControl.dataset.toggleParam === 'videoUseFrameRoles'){
                settings.videoReferenceMode = settings.videoUseFrameRoles ? 'first_last_frames' : 'image_to_video';
            }
            normalizeSmartVideoModeSettings(settings, switchControl.dataset.toggleParam === 'videoUseFrameRoles');
            persistActiveSmartSettings();
            renderDynamicParams();
            canvasPersistence.schedule();
        };
    });
    dynamicParams.querySelectorAll('[data-trusted-source]').forEach(btn => {
        btn.onclick = async event => {
            event.preventDefault();
            event.stopPropagation();
            const src = btn.dataset.trustedSource;
            settings.videoTrustedSource = ['library','cloud','manual'].includes(src) ? src : 'library';
            persistActiveSmartSettings();
            renderDynamicParams();
            canvasPersistence.schedule();
            try {
                if(src === 'cloud') await uploadCurrentSmartVideosToCloud();
                else if(src === 'manual') await setCurrentSmartManualVideoUrl();
            } catch(e) {
                toast((e.message || tr('smart.operationFailed')).slice(0, 180));
            }
        };
    });
    dynamicParams.querySelectorAll('ic-switch[data-comfy-bool]').forEach(switchControl => {
        switchControl.onchange = event => {
            event.stopPropagation();
            settings.comfyParams = settings.comfyParams || {};
            const id = switchControl.dataset.comfyBool;
            settings.comfyParams[id] = switchControl.checked;
            persistActiveSmartSettings();
            renderDynamicParams();
            canvasPersistence.schedule();
        };
    });
    dynamicParams.querySelectorAll('[data-comfy-param]').forEach(input => {
        input.onclick = event => event.stopPropagation();
        input.oninput = input.onchange = event => {
            event?.stopPropagation?.();
            settings.comfyParams = settings.comfyParams || {};
            const field = currentComfyFields().find(f => f.id === input.dataset.comfyParam);
            if(field?.type === 'number' || field?.type === 'slider') settings.comfyParams[input.dataset.comfyParam] = Number(input.value) || 0;
            else settings.comfyParams[input.dataset.comfyParam] = input.value;
            persistActiveSmartSettings();
            canvasPersistence.schedule();
        };
    });
    dynamicParams.querySelectorAll('ic-select[data-comfy-pick]').forEach(select => {
        select.onchange = event => {
            event.stopPropagation();
            settings.comfyParams = settings.comfyParams || {};
            settings.comfyParams[select.dataset.comfyPick] = select.value;
            void select.hide();
            persistActiveSmartSettings();
            canvasPersistence.schedule();
        };
    });
    dynamicParams.querySelectorAll('[data-comfy-random]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            toggleSmartComfyRandom(btn.dataset.comfyRandom);
        };
    });
    dynamicParams.querySelectorAll('ic-switch[data-rh-bool]').forEach(switchControl => {
        switchControl.onchange = event => {
            event.stopPropagation();
            settings.rhParams = settings.rhParams || {};
            const key = switchControl.dataset.rhBool;
            const cur = settings.rhParams[key] || {};
            settings.rhParams[key] = {...cur, value:String(switchControl.checked)};
            persistActiveSmartSettings();
            renderDynamicParams();
            canvasPersistence.schedule();
        };
    });
    dynamicParams.querySelectorAll('[data-rh-param]').forEach(input => {
        input.onclick = event => event.stopPropagation();
        input.oninput = input.onchange = event => {
            event?.stopPropagation?.();
            const key = input.dataset.rhParam;
            settings.rhParams = settings.rhParams || {};
            const cur = settings.rhParams[key] || {};
            settings.rhParams[key] = {...cur, value:input.value};
            if(input.localName === 'ic-slider') input.valueText = String(input.value);
            persistActiveSmartSettings();
            canvasPersistence.schedule();
        };
    });
    dynamicParams.querySelectorAll('ic-select[data-rh-pick]').forEach(select => {
        select.onchange = event => {
            event.stopPropagation();
            const key = select.dataset.rhPick;
            settings.rhParams = settings.rhParams || {};
            const cur = settings.rhParams[key] || {};
            settings.rhParams[key] = {...cur, value:select.value};
            void select.hide();
            persistActiveSmartSettings();
            canvasPersistence.schedule();
        };
    });
    dynamicParams.querySelectorAll('[data-rh-random]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            toggleSmartRhRandom(btn.dataset.rhRandom);
        };
    });
}
async function loadConfig(){
    try {
        const cfg = await fetch('/api/config').then(r => r.json());
        apiProviders = Array.isArray(cfg.api_providers) ? cfg.api_providers : [];
        availableModels = cfg.available_models && typeof cfg.available_models === 'object' ? cfg.available_models : availableModels;
        comfyInstanceCount = Math.max(1, (Array.isArray(cfg.comfy_instances) ? cfg.comfy_instances : []).filter(Boolean).length || 1);
        // 提供商配置已就绪即先渲染参数面板，避免等工作流/RunningHub 预取完成后参数才「突然刷新出来」。
        sanitizeSmartApiSelection(settings, {notify:true});
        await Promise.all([
            loadSmartImageCapabilityForCurrentSettings(),
            window.SmartCanvasModules.videoCapabilities.load('jimeng', '')
        ]);
        sanitizeSmartApiSelection(settings, {notify:true});
        await loadSmartVideoCapabilityForCurrentSettings();
        updateProviderModels();
        const wf = await fetch('/api/workflows').then(r => r.json()).catch(() => ({workflows:[]}));
        comfyWorkflows = Array.isArray(wf.workflows) ? wf.workflows : [];
        runningHubWorkflowCache = {};
        const rhProvider = apiProviders.find(p => p.id === 'runninghub');
        const rhWorkflowIds = (rhProvider?.rh_workflows || []).map(item => String(item.workflowId || item.id || '').trim()).filter(Boolean);
        await Promise.all(rhWorkflowIds.map(async workflowId => {
            try { await ensureRunningHubWorkflow(workflowId); } catch(_) {}
        }));
        lastConfigRefreshAt = Date.now();
        sanitizeSmartApiSelection(settings, {notify:true});
        updateProviderModels();
    } catch(e) {
        toast(tr('smart.toastApiSettingsFail'));
    }
}
let smartImageCapabilityLoadSequence = 0;
async function loadSmartImageCapabilityForCurrentSettings({notify=false}={}){
    if(settings.apiKind === 'video') return null;
    const sequence = ++smartImageCapabilityLoadSequence;
    const selection = smartImageCapabilitySelection(settings.engine === 'modelscope' ? 'ms' : '');
    const capability = await window.SmartCanvasModules.imageCapabilities.load(selection.providerId, selection.modelId);
    if(sequence !== smartImageCapabilityLoadSequence) return capability;
    const prefix = settings.engine === 'modelscope' ? 'ms' : '';
    const reconciled = window.SmartCanvasModules.imageCapabilities.reconcile(
        settings,
        capability,
        smartImageCapabilityReferences(),
        {prefix}
    );
    const warningKey = smartImageCapabilityWarningKey(prefix);
    const transitionMatches = pendingSmartImageCapabilityTransition?.prefix === prefix
        && pendingSmartImageCapabilityTransition?.toKey === warningKey;
    const shouldWarn = window.SmartCanvasModules.imageCapabilities.shouldWarnForTransition(
        pendingSmartImageCapabilityTransition,
        {prefix,currentKey:warningKey,capability,invalidated:reconciled.invalidated}
    );
    if(capability.known === true){
        settings = {...settings,...reconciled.settings};
        if(shouldWarn){
            settings._imageCapabilityWarning = true;
            settings._imageCapabilityWarningKey = warningKey;
            if(notify) toast(tr('smart.modelSettingsUnsupported'));
        }
    }
    if(transitionMatches){
        pendingSmartImageCapabilityTransition = null;
    }
    return capability;
}
let smartVideoCapabilityLoadSequence = 0;
async function loadSmartVideoCapabilityForCurrentSettings(){
    if(settings.apiKind !== 'video' || !settings.videoProvider) return null;
    const sequence = ++smartVideoCapabilityLoadSequence;
    const capability = await window.SmartCanvasModules.videoCapabilities.load(
        settings.videoProvider,
        settings.videoModel,
        smartVideoCapabilityProviderContext(settings)
    );
    if(sequence !== smartVideoCapabilityLoadSequence) return capability;
    settings = window.SmartCanvasModules.videoCapabilities.applyComposerOptions(settings, capability);
    if(settings.videoProvider === 'jimeng'){
        const reconciled = window.SmartCanvasModules.videoCapabilities.reconcile(
            settings,
            smartVideoCapabilityReferences(),
            capability
        );
        if(capability.known === true) settings = {...settings,...reconciled.settings};
    }
    return capability;
}
async function refreshSmartConfigFromSettings(){
    if(smartCanvasNodeReviewMode) return false;
    await loadConfig();
    renderDynamicParams();
    const node = window.SmartCanvasModules.viewportSelection.selection.node();
    if(node?.type === 'smart-prompt') {
        window.SmartCanvasModules.generationSettings.saveForNode(
            node.id,
            settings
        );
        canvasPersistence.schedule();
        render();
    }
}
function loadPromptPresets(){
    try {
        const list = JSON.parse(localStorage.getItem(PROMPT_PRESETS_KEY) || '[]');
        promptPresets = Array.isArray(list) ? list.filter(p => p?.id && typeof p.text === 'string') : [];
    } catch(e) {
        promptPresets = [];
    }
}
function savePromptPresets(){
    localStorage.setItem(PROMPT_PRESETS_KEY, JSON.stringify(promptPresets));
}
function defaultPromptTemplateGroups(){
    return [
        {id:'view', name:tr('smart.tplCatView')},
        {id:'storyboard', name:tr('smart.tplCatStoryboard')},
        {id:'character', name:tr('smart.tplCatCharacter')},
        {id:'product', name:tr('smart.tplCatProduct')},
        {id:'lighting', name:tr('smart.tplCatLighting')},
        {id:'mine', name:tr('smart.tplCatMine')}
    ];
}
function loadPromptTemplateGroups(){
    try {
        const list = JSON.parse(localStorage.getItem(PROMPT_TEMPLATE_GROUPS_KEY) || '[]');
        const valid = Array.isArray(list) ? list.filter(g => g?.id && g?.name) : [];
        const defaults = defaultPromptTemplateGroups();
        promptTemplateGroups = defaults.map(group => valid.find(g => g.id === group.id) || group);
        valid.filter(g => !promptTemplateGroups.some(x => x.id === g.id)).forEach(g => promptTemplateGroups.push(g));
    } catch(e) {
        promptTemplateGroups = defaultPromptTemplateGroups();
    }
}
function savePromptTemplateGroups(){
    localStorage.setItem(PROMPT_TEMPLATE_GROUPS_KEY, JSON.stringify(promptTemplateGroups));
}
function loadPromptTemplateOverrides(){
    try {
        const data = JSON.parse(localStorage.getItem(PROMPT_TEMPLATE_OVERRIDES_KEY) || '{}');
        promptTemplateOverrides = {
            hiddenBuiltinIds:Array.isArray(data.hiddenBuiltinIds) ? data.hiddenBuiltinIds : [],
            editedBuiltins:data.editedBuiltins && typeof data.editedBuiltins === 'object' ? data.editedBuiltins : {}
        };
    } catch(e) {
        promptTemplateOverrides = {hiddenBuiltinIds:[], editedBuiltins:{}};
    }
}
function savePromptTemplateOverrides(){
    localStorage.setItem(PROMPT_TEMPLATE_OVERRIDES_KEY, JSON.stringify(promptTemplateOverrides));
}
async function loadPromptTemplates(){
    try {
        const [commonResponse,canvasResponse] = await Promise.all([
            fetch('/api/prompt-libraries'),
            fetch(`/api/canvases/${encodeURIComponent(canvasId)}/prompt-templates`)
        ]);
        const commonData = await commonResponse.json().catch(() => ({}));
        const canvasData = await canvasResponse.json().catch(() => ({}));
        if(!commonResponse.ok) throw new Error(commonData.detail || tr('canvas.loadFailed'));
        if(!canvasResponse.ok) throw new Error(canvasData.detail || tr('canvas.loadFailed'));
        const common = commonData.library?.common || {id:'common', name:tr('smart.commonLibrary'), scope:'common', categories:[], items:[]};
        canvasPromptTemplates = Array.isArray(canvasData.templates) ? canvasData.templates : [];
        promptLibraries = [
            {
                ...common,
                id:'common',
                scope:'common',
                readonly:false,
                items:(common.items || []).map(item => ({...item, libraryId:'common', remote:true, builtin:false}))
            },
            {
                id:'canvas',
                name:tr('smart.currentCanvas'),
                scope:'canvas',
                readonly:false,
                categories:[],
                items:canvasPromptTemplates.map(item => ({...item, libraryId:'canvas', remote:true, builtin:false}))
            }
        ];
        if(!promptLibraries.some(lib => lib.id === activePromptLibraryId)) activePromptLibraryId = 'canvas';
        renderPromptLibrarySelect();
    } catch(e) {
        throw e;
    }
}
function activePromptLibrary(){
    return promptLibraries.find(lib => lib.id === activePromptLibraryId) || promptLibraries.find(lib => lib.id === 'canvas') || {id:'canvas', name:tr('smart.currentCanvas'), scope:'canvas', readonly:false, categories:[], items:[]};
}
function renderPromptLibrarySelect(){
    syncPromptTemplateLibraryComponent();
}
function promptTemplateItems(){
    const activeLibrary = activePromptLibrary();
    return (activeLibrary.items || [])
        .filter(template => template?.id && template?.positive)
        .map(template => ({...template, libraryId:activeLibrary.id, remote:true, builtin:false}));
}
function promptQuickTemplateItems(){
    return promptLibraries.flatMap(library => (library.items || [])
        .filter(template => template?.id && template?.positive)
        .map(template => ({...template, libraryId:library.id, remote:true, builtin:false}))
    );
}
function promptQuickTemplateCategoryLabel(template){
    const category = String(template?.category || '');
    const library = promptLibraries.find(item => item.id === template?.libraryId);
    if(library?.scope === 'canvas' || library?.id === 'canvas') return tr('smart.currentCanvas');
    return library?.categories?.find(item => item.id === category)?.name
        || promptTemplateCategoryLabel(category);
}
function promptTemplateText(template, mode='positive'){
    const positive = String(template?.positive || '').trim();
    if(mode === 'positive' || !template?.builtin) return positive;
    const negative = String(template?.negative || '').trim();
    const params = Object.entries(template?.params || {})
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
    return [positive, negative ? `Negative prompt:\n${negative}` : '', params ? `Params:\n${params}` : ''].filter(Boolean).join('\n\n');
}
function promptTemplateName(template){
    if(window.StudioI18n?.lang?.() === 'en' && template?.name_en) return template.name_en;
    return template?.name || '';
}
function promptTemplateSearchText(template){
    return [
        template?.name,
        template?.name_en,
        template?.positive,
        template?.negative
    ].join(' ').toLowerCase();
}
function activePromptTemplateGroups(){
    const lib = activePromptLibrary();
    if(lib?.scope === 'canvas' || lib?.id === 'canvas') return [];
    const fromLib = Array.isArray(lib?.categories) ? lib.categories.filter(c => c?.id && c?.name) : [];
    return fromLib;
}
function promptTemplateCategoryLabel(category){
    if(category === 'all') return tr('smart.tplAll');
    // 分组名优先以后端 categories 为准（含内置分组重命名），保证两端显示一致。
    const fromGroups = activePromptTemplateGroups().find(g => g.id === category)?.name;
    if(fromGroups) return fromGroups;
    const builtin = {
        view:tr('smart.tplCatView'),
        storyboard:tr('smart.tplCatStoryboard'),
        character:tr('smart.tplCatCharacter'),
        product:tr('smart.tplCatProduct'),
        lighting:tr('smart.tplCatLighting'),
        custom:tr('smart.tplCatMine'),
        mine:tr('smart.tplCatMine')
    };
    return builtin[category] || promptTemplateGroups.find(g => g.id === category)?.name || category;
}
function promptTemplateSelectedItem(){
    return promptTemplateItems().find(item => item.id === promptTemplateSelectedId) || promptTemplateItems()[0] || null;
}
function defaultPromptPresetName(text){
    return (String(text || '').trim().split(/\r?\n/)[0] || tr('smart.promptPresetDefault')).slice(0, 28);
}
function applyCanvasPromptTemplateResponse(data={}){
    canvasPromptTemplates = Array.isArray(data.templates) ? data.templates : canvasPromptTemplates;
    const canvasLibrary = promptLibraries.find(library => library.id === 'canvas');
    if(canvasLibrary) canvasLibrary.items = canvasPromptTemplates.map(item => ({...item, libraryId:'canvas', remote:true, builtin:false}));
}
function smartPromptCommitLane(){
    if(promptCanvasCommitLane) return promptCanvasCommitLane;
    const module = window.InfiniteCanvasModules?.CanvasCommitLane;
    if(!module) throw new Error('Canvas Commit Lane failed to load');
    promptCanvasCommitLane = module.create({
        canvasId:() => canvasId,
        clientId:() => smartClientId,
        checkpoint:() => canvasPersistence.checkpoint({timeout:5000}),
        resync:() => canvasPersistence.resync(),
        observeExternalCommit:commit => canvasPersistence.observeExternalCommit(commit),
        onPromptState:applyCanvasPromptTemplateResponse,
    });
    return promptCanvasCommitLane;
}
function applyCommonPromptTemplateResponse(data={}){
    const common = data.library?.common;
    if(!common) return;
    const index = promptLibraries.findIndex(library => library.id === 'common');
    const record = {...common, id:'common', scope:'common', readonly:false, items:(common.items || []).map(item => ({...item, libraryId:'common', remote:true, builtin:false}))};
    if(index >= 0) promptLibraries[index] = record;
    else promptLibraries.unshift(record);
}
async function createPromptPresetFromNode(node, {openTemplatePanel=false}={}){
    const text = String(node?.text || '').trim();
    if(!text){ toast(tr('smart.promptPresetEmpty')); return null; }
    if(promptTemplateSaving) return null;
    promptTemplateSaving = true;
    if(promptTemplatePanel) promptTemplatePanel.busy = true;
    try {
        const outcome = await smartPromptCommitLane().commitPrompt({
            action:'create',
            name:String(node?.title || '').trim() || defaultPromptPresetName(text),
            positive:text
        });
        const data = outcome.data;
        promptTemplateSelectedId = data.item?.id || '';
        const edit = () => openPromptTemplatePanel(node?.id || '', promptTemplateSelectedId).then(() => promptTemplatePanel?.openEdit?.(promptTemplateSelectedId));
        toast(tr('smart.savedToCurrentCanvas'), {tone:'success', duration:5000, actionLabel:tr('common.edit'), onAction:edit});
        if(openTemplatePanel) edit();
        return data.item || null;
    } catch(error) {
        toast(error.message || tr('canvas.saveFailed'), {tone:'danger'});
        return null;
    } finally {
        promptTemplateSaving = false;
        if(promptTemplatePanel) promptTemplatePanel.busy = false;
    }
}
function savePromptNodeAsPreset(node){
    createPromptPresetFromNode(node);
}
function syncPromptTemplateLibraryComponent(){
    if(!promptTemplatePanel) return;
    const activeGroups = activePromptTemplateGroups();
    if(promptTemplateCategory !== 'all' && !activeGroups.some(group => group.id === promptTemplateCategory)) promptTemplateCategory = 'all';
    const items = promptTemplateItems();
    if(promptTemplateSelectedId && !items.some(item => item.id === promptTemplateSelectedId)) promptTemplateSelectedId = '';
    promptTemplatePanel.libraries = promptLibraries;
    promptTemplatePanel.templates = promptQuickTemplateItems();
    promptTemplatePanel.activeLibrary = activePromptLibraryId;
    promptTemplatePanel.activeCategory = promptTemplateCategory;
    promptTemplatePanel.selectedTemplate = promptTemplateSelectedId;
    promptTemplatePanel.canManage = true;
    promptTemplatePanel.busy = promptTemplateSaving;
}
function renderPromptTemplatePanel(){
    syncPromptTemplateLibraryComponent();
}
function isPromptTemplatePanelOpen(){
    return Boolean(promptTemplateDialog?.open);
}
function activePromptTemplateNodeId(){
    return isPromptTemplatePanelOpen() && promptTemplatePanel.dataset.target !== 'composer' ? (promptTemplatePanel.dataset.nodeId || '') : '';
}
function syncComposerTemplateButton(){
    if(!composerTemplateBtn || !promptTemplatePanel) return;
    const composerActive = isPromptTemplatePanelOpen() && promptTemplatePanel.dataset.target === 'composer';
    const libraryActive = isPromptTemplatePanelOpen() && promptTemplatePanel.dataset.target === 'library';
    composerTemplateBtn.classList.toggle('active', composerActive);
    composerTemplateBtn.pressed = composerActive;
    composerTemplateBtn.setAttribute('aria-expanded', composerActive ? 'true' : 'false');
    promptTemplateDockToggle?.setAttribute('aria-expanded', libraryActive ? 'true' : 'false');
}
async function openPromptTemplatePanel(nodeId='', templateId='', options={}){
    if(!promptTemplatePanel) return;
    const target = options.target === 'composer' ? 'composer' : options.target === 'library' ? 'library' : 'node';
    promptTemplatePanel.dataset.target = target;
    promptTemplatePanel.dataset.nodeId = nodeId || '';
    if(!options.preserveScope){
        activePromptLibraryId = 'common';
        promptTemplateCategory = 'all';
        promptTemplatePanel.query = '';
    }
    if(templateId) promptTemplateSelectedId = templateId;
    renderPromptTemplatePanel();
    await promptTemplateDialog.show();
    // 每次打开都从后端拉取最新提示词库。
    try { await loadPromptTemplates(); } catch(e){}
    if(!promptTemplateSelectedId || !promptTemplateItems().some(it => it.id === promptTemplateSelectedId)){
        promptTemplateSelectedId = promptTemplateItems()[0]?.id || '';
    }
    renderPromptTemplatePanel();
    if(target === 'node' && nodeId){
        selectedId = nodeId;
        selectedIds = [];
        selectedImage = {nodeId:'', index:-1};
    }
    render();
    syncComposerTemplateButton();
}
async function closePromptTemplatePanel(event=null){
    if(event?.type !== 'ic-hide'){
        if(!promptTemplateDialog?.open) return;
        await promptTemplateDialog.hide(event?.detail?.reason || 'programmatic');
        return;
    }
    const target = promptTemplatePanel?.dataset.target || 'composer';
    promptTemplatePanel?.closeEditor?.();
    promptTemplatePanel?.closeCategoryEditor?.();
    promptTemplatePanel?.closePromotion?.();
    syncComposerTemplateButton();
    render();
    requestAnimationFrame(() => (target === 'composer' ? composerTemplateBtn : promptTemplateDockToggle)?.focus?.({preventScroll:true}));
}
let workspaceAssetOpening = false;
async function openWorkspaceAssetLibrary(){
    if(!workspaceAssetDialog || !workspaceAssetPanel || workspaceAssetOpening) return;
    workspaceAssetOpening = true;
    try {
        await workspaceAssetPanel.refresh({preserveQuery:true});
        workspaceAssetDockToggle?.setAttribute('aria-expanded', 'true');
        await workspaceAssetDialog.show();
    } finally {
        workspaceAssetOpening = false;
    }
}
async function closeWorkspaceAssetLibrary(event=null){
    if(event?.type !== 'ic-hide'){
        if(workspaceAssetDialog?.open) await workspaceAssetDialog.hide(event?.detail?.reason || 'programmatic');
        return;
    }
    workspaceAssetDockToggle?.setAttribute('aria-expanded', 'false');
    if(event?.detail?.reason !== 'asset-insert'){
        requestAnimationFrame(() => workspaceAssetDockToggle?.focus?.({preventScroll:true}));
    }
}
let workspaceAssetInsertPending = false;
function workspaceAssetImageFromItem(item={}){
    const url = String(item.url || '');
    if(!url) return null;
    return {
        url,
        name:String(item.name || tr('smart.asset')),
        kind:'image',
        media_id:String(item.media_id || item.mediaId || ''),
        assetLibraryEntryId:String(item.id || '')
    };
}
async function insertWorkspaceAssetIntoCanvas(item={}){
    if(workspaceAssetInsertPending) return null;
    const image = workspaceAssetImageFromItem(item);
    if(!image){
        toast(tr('smart.assetUnavailable'), {tone:'danger'});
        return null;
    }
    workspaceAssetInsertPending = true;
    try {
        const node = createImageNodeAt(null, [image]);
        if(!node) throw new Error(tr('smart.assetInsertFailed'));
        if(workspaceAssetDialog?.open) await workspaceAssetDialog.hide('asset-insert');
        shell?.focus?.({preventScroll:true});
        toast(trf('smart.assetInserted', {name:image.name}), {tone:'success'});
        return node;
    } catch(error) {
        toast(error?.message || tr('smart.assetInsertRetry'), {tone:'danger'});
        return null;
    } finally {
        workspaceAssetInsertPending = false;
    }
}
async function copyPromptTemplateText(templateId=''){
    const template = promptTemplateItems().find(item => item.id === (templateId || promptTemplateSelectedId));
    const text = promptTemplateText(template, 'positive');
    if(!template || !text){
        toast(tr('smart.noPromptToCopy'));
        return false;
    }
    const copied = await copyTextToClipboard(text);
    toast(
        copied ? tr('smart.promptCopied') : tr('smart.copyRetry'),
        {tone:copied ? 'success' : 'danger'},
    );
    return copied;
}
async function activatePromptTemplateFromPanel(templateId=''){
    const template = promptTemplateItems().find(item => item.id === templateId);
    const text = promptTemplateText(template, 'positive');
    if(!template || !text) return false;
    const target = promptTemplatePanel?.dataset.target || 'library';
    if(target === 'composer' && promptInput){
        setPromptQuickTarget(promptInput, activeComposerNode() || window.SmartCanvasModules.viewportSelection.selection.node());
        setPromptCaretToEnd(promptInput);
        insertPromptTemplateText(template);
        await closePromptTemplatePanel();
        return true;
    }
    if(target === 'node'){
        const nodeId = promptTemplatePanel?.dataset.nodeId || '';
        const node = nodes.find(item => item.id === nodeId && item.type === 'smart-prompt');
        if(node){
            if(node.llmEnabled){
                node.llmInstruction = [String(node.llmInstruction || node.text || '').trim(), text].filter(Boolean).join('\n\n');
                node.llmInstructionHtml = escapeHtml(node.llmInstruction);
                node.text = node.llmInstruction;
            } else {
                node.text = [String(node.text || '').trim(), text].filter(Boolean).join('\n\n');
                node.textHtml = escapeHtml(node.text);
            }
            render();
            canvasPersistence.schedule();
            await closePromptTemplatePanel();
            return true;
        }
    }
    if(target === 'library' && activePromptLibraryId === 'common'){
        await copyPromptTemplateToCanvas(templateId);
        return true;
    }
    return copyPromptTemplateText(templateId);
}
async function createBlankPromptTemplate(){
    const library = activePromptLibrary();
    if(library.readonly){ toast(tr('smart.editableLibraryRequired')); return; }
    promptTemplatePanel?.openCreate?.();
}
async function uploadPromptTemplateCover(file){
    const form = new FormData();
    form.append('file', file, file.name || 'prompt-cover');
    const response = await fetch('/api/prompt-libraries/covers', {method:'POST', body:form});
    if(!response.ok) throw new Error(tr('smart.coverUploadFailed'));
    const data = await response.json().catch(() => ({}));
    if(!data.cover?.url) throw new Error(tr('smart.coverUploadFailed'));
    return data.cover;
}
async function savePromptTemplateEdit(detail={}){
    const wasCreating = Boolean(detail.creating);
    const item = wasCreating ? null : promptTemplateItems().find(template => template.id === detail.templateId);
    if(!wasCreating && !item) return;
    const name = detail.draft?.name?.trim() || '';
    const text = detail.draft?.positive?.trim() || '';
    const library = activePromptLibrary();
    const category = detail.draft?.category || activePromptTemplateGroups()[0]?.id || '';
    let cover = String(detail.draft?.cover || '');
    if(library.readonly || promptTemplateSaving){ return; }
    if(!name || !text){ toast(tr('smart.tplRequired')); return; }
    promptTemplateSaving = true;
    if(promptTemplatePanel) promptTemplatePanel.busy = true;
    if(detail.draft?.coverFile){
        try {
            const uploaded = await uploadPromptTemplateCover(detail.draft.coverFile);
            cover = uploaded.url || '';
            promptTemplatePanel?.setEditorCover?.(cover);
        } catch(error) {
            toast((error.message || tr('smart.coverUploadFailed')).slice(0, 160));
            promptTemplateSaving = false;
            if(promptTemplatePanel) promptTemplatePanel.busy = false;
            return;
        }
    }
    try {
        let data;
        if(library.id === 'canvas'){
            const outcome = await smartPromptCommitLane().commitPrompt({
                action:wasCreating ? 'create' : 'update',
                itemId:item?.id || '',
                expectedItemVersion:item?.item_version || '',
                name,
                positive:text,
                cover,
            });
            data = outcome.data;
        } else {
            const categoryRecord = activePromptTemplateGroups().find(group => group.id === category);
            if(!categoryRecord) throw new Error(tr('smart.createGroupFirst'));
            const sourceId = item?.source_id || item?.sourceId || item?.id || '';
            const response = await fetch(wasCreating ? '/api/prompt-libraries/items' : `/api/prompt-libraries/items/${encodeURIComponent(sourceId)}`, {
                method:wasCreating ? 'POST' : 'PATCH',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({
                    library_id:item?.library_id || categoryRecord.library_id || '',
                    name,
                    category:categoryRecord.category_id || category,
                    positive:text,
                    negative:item?.negative || '',
                    cover
                })
            });
            data = await response.json().catch(() => ({}));
            if(!response.ok) throw new Error(data.detail?.message || data.detail || tr('canvas.saveFailed'));
        }
        if(library.id === 'canvas'){
            promptTemplateSelectedId = data.item?.id || item?.id || '';
            promptTemplateCategory = 'all';
        } else {
            applyCommonPromptTemplateResponse(data);
            const commonItem = promptLibraries.find(record => record.id === 'common')?.items?.find(record => record.source_id === data.item?.id && record.library_id === (item?.library_id || activePromptTemplateGroups().find(group => group.id === category)?.library_id));
            promptTemplateSelectedId = commonItem?.id || item?.id || '';
            promptTemplateCategory = category;
        }
        promptTemplatePanel?.closeEditor?.();
        renderPromptTemplatePanel();
        toast(wasCreating ? tr('smart.created') : tr('smart.saved'), {tone:'success'});
    } catch(error) {
        toast(error.message || tr('canvas.saveFailed'), {tone:'danger'});
    } finally {
        promptTemplateSaving = false;
        if(promptTemplatePanel) promptTemplatePanel.busy = false;
    }
}
async function movePromptTemplateToCategory(detail={}){
    const library = activePromptLibrary();
    const item = promptTemplateItems().find(template => template.id === detail.templateId);
    const category = activePromptTemplateGroups().find(group => group.id === detail.categoryId);
    if(!library || library.id !== 'common' || library.readonly || !item || !category || promptTemplateSaving) return;
    if(item.category === category.id) return;
    promptTemplateSaving = true;
    if(promptTemplatePanel) promptTemplatePanel.busy = true;
    try {
        const sourceId = item.source_id || item.sourceId || item.id || '';
        const response = await fetch(`/api/prompt-libraries/items/${encodeURIComponent(sourceId)}`, {
            method:'PATCH',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                library_id:item.library_id || category.library_id || '',
                name:item.name || '',
                category:category.category_id || category.id,
                positive:item.positive || '',
                negative:item.negative || '',
                cover:item.cover || ''
            })
        });
        const data = await response.json().catch(() => ({}));
        if(!response.ok) throw new Error(data.detail?.message || data.detail || tr('canvas.saveFailed'));
        applyCommonPromptTemplateResponse(data);
        promptTemplateSelectedId = item.id;
        promptTemplateCategory = category.id;
        renderPromptTemplatePanel();
        toast(trf('smart.movedToCategory', {name:category.name}), {tone:'success'});
    } catch(error) {
        toast(error.message || tr('canvas.saveFailed'), {tone:'danger'});
    } finally {
        promptTemplateSaving = false;
        if(promptTemplatePanel) promptTemplatePanel.busy = false;
    }
}
async function deletePromptTemplate(templateId=''){
    const item = promptTemplateItems().find(template => template.id === (templateId || promptTemplateSelectedId));
    if(!item) return;
    if(promptTemplateSaving) return;
    promptTemplateSaving = true;
    if(promptTemplatePanel) promptTemplatePanel.busy = true;
    try {
        let data;
        if(activePromptLibraryId === 'canvas'){
            const outcome = await smartPromptCommitLane().commitPrompt({
                action:'delete',
                itemId:item.id,
                expectedItemVersion:item.item_version || '',
            });
            data = outcome.data;
        } else {
            const sourceId = item.source_id || item.sourceId || item.id;
            const query = new URLSearchParams({library_id:item.library_id || ''});
            const response = await fetch(`/api/prompt-libraries/items/${encodeURIComponent(sourceId)}?${query}`, {method:'DELETE'});
            data = await response.json().catch(() => ({}));
            if(!response.ok) throw new Error(data.detail?.message || data.detail || tr('canvas.deleteFailed'));
        }
        if(activePromptLibraryId !== 'canvas') applyCommonPromptTemplateResponse(data);
        promptTemplateSelectedId = '';
        promptTemplatePanel?.closeEditor?.();
        renderPromptTemplatePanel();
        toast(tr('smart.templateDeleted'), {tone:'success'});
    } catch(error) {
        toast(error.message || tr('canvas.deleteFailed'), {tone:'danger'});
    } finally {
        promptTemplateSaving = false;
        if(promptTemplatePanel) promptTemplatePanel.busy = false;
    }
}
async function copyPromptTemplateToCanvas(templateId=''){
    const item = promptTemplateItems().find(template => template.id === templateId);
    if(!item || activePromptLibraryId !== 'common' || promptTemplateSaving) return;
    promptTemplateSaving = true;
    if(promptTemplatePanel) promptTemplatePanel.busy = true;
    try {
        await smartPromptCommitLane().commitPrompt({
            action:'copy',
            sourceItemId:item.source_id || item.sourceId || item.id,
            libraryId:item.library_id || '',
        });
        toast(tr('smart.copiedToCurrentCanvas'), {tone:'success'});
    } catch(error) {
        toast(error.message || tr('canvas.copyPromptFailed'), {tone:'danger'});
    } finally {
        promptTemplateSaving = false;
        if(promptTemplatePanel) promptTemplatePanel.busy = false;
    }
}
async function promotePromptTemplateToCommon(detail={}){
    const item = promptTemplateItems().find(template => template.id === detail.templateId);
    if(!item || activePromptLibraryId !== 'canvas' || promptTemplateSaving) return;
    promptTemplateSaving = true;
    if(promptTemplatePanel) promptTemplatePanel.busy = true;
    try {
        const outcome = await smartPromptCommitLane().commitPrompt({
            action:'promote',
            itemId:item.id,
            expectedItemVersion:item.item_version || '',
            libraryId:detail.libraryId || '',
            categoryId:detail.categoryId || '',
        });
        const data = outcome.data;
        applyCommonPromptTemplateResponse(data);
        promptTemplateSelectedId = '';
        promptTemplatePanel?.closePromotion?.();
        renderPromptTemplatePanel();
        toast(tr('smart.setAsCommon'), {tone:'success'});
    } catch(error) {
        toast(error.message || tr('canvas.saveFailed'), {tone:'danger'});
    } finally {
        promptTemplateSaving = false;
        if(promptTemplatePanel) promptTemplatePanel.busy = false;
    }
}
function commonPromptWriteLibraryId(){
    const common = promptLibraries.find(library => library.id === 'common');
    return common?.categories?.[0]?.library_id || common?.items?.[0]?.library_id || '';
}
async function createPromptTemplateGroup(detail={}){
    const lib = activePromptLibrary();
    if(!lib || lib.id !== 'common' || lib.readonly || promptTemplateSaving){ toast(tr('smart.editableLibraryRequired')); return; }
    const name = String(detail.name || '').trim();
    if(!name) return;
    promptTemplateSaving = true;
    if(promptTemplatePanel) promptTemplatePanel.busy = true;
    try {
        const response = await fetch('/api/prompt-libraries/categories', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({name:name.slice(0, 24), library_id:commonPromptWriteLibraryId()})
        });
        const data = await response.json().catch(() => ({}));
        if(!response.ok) throw new Error(data.detail || tr('canvas.addGroupFailed'));
        applyCommonPromptTemplateResponse(data);
        const created = activePromptTemplateGroups().find(group => group.category_id === data.category?.id && group.library_id === (commonPromptWriteLibraryId() || data.category?.library_id));
        promptTemplateCategory = created?.id || 'all';
        promptTemplatePanel?.closeCategoryEditor?.();
        renderPromptTemplatePanel();
        toast(tr('smart.groupCreated'), {tone:'success'});
    } catch(error){
        toast(error.message || tr('canvas.addGroupFailed'), {tone:'danger'});
    } finally {
        promptTemplateSaving = false;
        if(promptTemplatePanel) promptTemplatePanel.busy = false;
    }
}
async function renamePromptTemplateGroup(detail={}){
    const lib = activePromptLibrary();
    if(!lib || lib.id !== 'common' || lib.readonly || promptTemplateSaving){ toast(tr('smart.editableLibraryRequired')); return; }
    const groupId = detail.categoryId || '';
    const group = activePromptTemplateGroups().find(g => g.id === groupId);
    if(!group) return;
    const name = String(detail.name || '').trim();
    if(!name) return;
    promptTemplateSaving = true;
    if(promptTemplatePanel) promptTemplatePanel.busy = true;
    try {
        const response = await fetch(`/api/prompt-libraries/categories/${encodeURIComponent(group.category_id || groupId)}`, {
            method:'PATCH', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({name:name.slice(0, 24), library_id:group.library_id || ''})
        });
        const data = await response.json().catch(() => ({}));
        if(!response.ok) throw new Error(data.detail || tr('smart.renameFailed'));
        applyCommonPromptTemplateResponse(data);
        promptTemplatePanel?.closeCategoryEditor?.();
        renderPromptTemplatePanel();
        toast(tr('smart.groupNameUpdated'), {tone:'success'});
    } catch(error){
        toast(error.message || tr('smart.renameFailed'), {tone:'danger'});
    } finally {
        promptTemplateSaving = false;
        if(promptTemplatePanel) promptTemplatePanel.busy = false;
    }
}
async function deletePromptTemplateGroup(groupId){
    const lib = activePromptLibrary();
    if(!lib || lib.id !== 'common' || lib.readonly || promptTemplateSaving){ toast(tr('smart.editableLibraryRequired')); return; }
    const group = activePromptTemplateGroups().find(item => item.id === groupId);
    if(!group) return;
    promptTemplateSaving = true;
    if(promptTemplatePanel) promptTemplatePanel.busy = true;
    try {
        const params = new URLSearchParams({library_id:group.library_id || ''});
        const response = await fetch(`/api/prompt-libraries/categories/${encodeURIComponent(group.category_id || groupId)}?${params}`, {method:'DELETE'});
        const data = await response.json().catch(() => ({}));
        if(!response.ok) throw new Error(data.detail || tr('canvas.deleteFailed'));
        applyCommonPromptTemplateResponse(data);
        if(promptTemplateCategory === groupId) promptTemplateCategory = 'all';
        renderPromptTemplatePanel({preserveScroll:false});
        toast(tr('smart.groupDeleted'), {tone:'success'});
    } catch(error){
        toast(error.message || tr('canvas.deleteFailed'), {tone:'danger'});
    } finally {
        promptTemplateSaving = false;
        if(promptTemplatePanel) promptTemplatePanel.busy = false;
    }
}
async function persistPromptTemplateGroupOrder(groupIds=[]){
    const groups = activePromptTemplateGroups();
    const ids = [...new Set(groupIds)].filter(id => groups.some(group => group.id === id));
    groups.forEach(group => { if(!ids.includes(group.id)) ids.push(group.id); });
    if(ids.length !== groups.length) return;
    const lib = activePromptLibrary();
    if(!lib || lib.id !== 'common' || lib.readonly || promptTemplateSaving){ toast(tr('smart.editableLibraryRequired')); return; }
    const ordered = ids.map(id => groups.find(group => group.id === id)).filter(Boolean);
    const byLibrary = new Map();
    ordered.forEach(group => {
        const libraryId = group.library_id || '';
        if(!byLibrary.has(libraryId)) byLibrary.set(libraryId, []);
        byLibrary.get(libraryId).push(group.category_id || group.id);
    });
    promptTemplateSaving = true;
    if(promptTemplatePanel) promptTemplatePanel.busy = true;
    try {
        for(const [libraryId, categoryIds] of byLibrary){
            const response = await fetch(`/api/prompt-libraries/${encodeURIComponent(libraryId)}/categories/order`, {
                method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({category_ids:categoryIds})
            });
            const data = await response.json().catch(() => ({}));
            if(!response.ok) throw new Error(data.detail || tr('smart.groupReorderFailed'));
            applyCommonPromptTemplateResponse(data);
        }
        renderPromptTemplatePanel();
    } catch(error){
        await loadPromptTemplates().catch(() => {});
        renderPromptTemplatePanel();
        toast(error.message || tr('smart.groupReorderFailed'), {tone:'danger'});
    } finally {
        promptTemplateSaving = false;
        if(promptTemplatePanel) promptTemplatePanel.busy = false;
    }
}
function editPromptPresetForNode(node){
    openPromptTemplatePanel(node?.id || '');
}
// 多人协作同步：一个稳定的客户端 id，既用于 WS 连接，也随 Canvas Persistence 上报，
// 服务器广播 canvas_updated 时带回 client_id，自己发的就忽略，避免自我刷新。
const smartClientId = `canvas_smart_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
let connectionLayerRaf = 0;
let connectionLayerRefreshAll = false;
let smartConnectionLayerController = null;
const pendingConnectionLayerNodeIds = new Set();
function smartNodePendingTasks(node){
    if(!node) return [];
    return typeof generationRun.pendingTasks === 'function'
        ? generationRun.pendingTasks({node})
        : generationRun.status({node}).pendingTasks;
}
function smartNodeInFlight(node){
    if(node?.queuedGenerationRun) return true;
    if(smartNodeHasCompletedResult(node)) return false;
    return Boolean(node && (
        node.running
        || node.pending
        || node.queued
        || node.jimengPending
        || smartNodePendingTasks(node).length
    ));
}
function smartNodeHasDisplayResult(node){
    return Boolean((node?.images || []).some(img => img?.url && !img.loopInputPreview));
}
function smartNodeHasCompletedResult(node){
    if(!smartNodeHasDisplayResult(node)) return false;
    if(node?.runFinishedAt) return true;
    return !node?.jimengPending
        && !smartNodePendingTasks(node).length
        && !Number(node?.pending || 0)
        && !node?.queued;
}
function liveSmartNode(node){
    if(!node?.id) return node;
    return nodes.find(n => n.id === node.id) || node;
}
function clearSmartNodeBusyState(node){
    if(!node) return node;
    smartNodeRunTokens.delete(node.id);
    node.running = false;
    node.pending = 0;
    node.queued = false;
    delete node.jimengPending;
    delete node.pendingTasks;
    return node;
}
function markSmartNodeComplete(node, meta=null){
    if(!node) return node;
    const keepHidden = node.runTimerHidden === true;
    clearSmartNodeBusyState(node);
    node.runFinishedAt = Number(node.runFinishedAt || 0) || nowMs();
    if(!node.runStartedAt) node.runStartedAt = meta?.createdAt || node.runFinishedAt;
    node.runElapsedMs = Math.max(0, Number(node.runFinishedAt || nowMs()) - Number(node.runStartedAt || node.runFinishedAt || nowMs()));
    node.runTimerHidden = meta?.showTimer === true ? keepHidden : true;
    if(node.textGenerationOutput && String(node.text || '').trim()){
        delete node.textGenerationPending;
    }
    return node;
}
function completedDownstreamOutputForNode(sourceNode){
    if(!sourceNode?.id) return null;
    const startedAt = Number(sourceNode.runStartedAt || 0);
    return downstreamImageTargetsFor(sourceNode).find(target => {
        if(!smartNodeHasCompletedResult(target)) return false;
        if(target.sourceNodeId && target.sourceNodeId !== sourceNode.id) return false;
        const finishedAt = Number(target.runFinishedAt || 0);
        return !startedAt || !finishedAt || finishedAt >= startedAt;
    }) || null;
}
function clearSourceBusyStateIfDownstreamDone(sourceNode, options={}){
    if(!sourceNode || !smartNodeInFlight(sourceNode)) return false;
    if(sourceNode.jimengPending || smartNodePendingTasks(sourceNode).length) return false;
    if(!completedDownstreamOutputForNode(sourceNode)) return false;
    clearSmartNodeBusyState(sourceNode);
    if(!sourceNode.runFinishedAt){
        sourceNode.runFinishedAt = nowMs();
        if(!sourceNode.runStartedAt) sourceNode.runStartedAt = sourceNode.runFinishedAt;
        sourceNode.runElapsedMs = Math.max(0, sourceNode.runFinishedAt - Number(sourceNode.runStartedAt || sourceNode.runFinishedAt));
        sourceNode.runTimerHidden = options.hideTimer === true || sourceNode.runTimerHidden === true;
    }
    return true;
}
function clearCompletedSourceBusyStates(){
    let changed = false;
    (nodes || []).forEach(node => {
        if(clearSourceBusyStateIfDownstreamDone(node)) changed = true;
    });
    return changed;
}
function hideCompletedRunTimers(){
    let changed = false;
    (nodes || []).forEach(node => {
        if(!node || (node.type === 'smart-prompt' && !node.textGenerationOutput)) return;
        if(node.pending || node.running || node.jimengPending || !node.runFinishedAt || node.runTimerHidden) return;
        node.runTimerHidden = true;
        changed = true;
    });
    return changed;
}
function clearCompletedNodeBusyStates(){
    let changed = false;
    (nodes || []).forEach(node => {
        if(!node || !smartNodeHasCompletedResult(node) || !smartNodeInFlight(node)) return;
        markSmartNodeComplete(node);
        changed = true;
    });
    if(clearCompletedSourceBusyStates()) changed = true;
    return changed;
}
function usedCanvasOutputUrls(){
    const used = new Set();
    (nodes || []).forEach(node => (node.images || []).forEach(img => {
        if(img?.url && !img.loopInputPreview) used.add(img.url);
    }));
    return used;
}
function successfulRecentComfyLogOutputs(sourceNodeId='', withinMs=30 * 60 * 1000){
    const cutoff = Date.now() - withinMs;
    const logs = (canvas?.logs || [])
        .filter(log => log && log.status === 'success' && Number(log.createdAt || 0) >= cutoff)
        .filter(log => log.request?.workflow_json || String(log.platform || '').toLowerCase().includes('comfy'))
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    const scoped = sourceNodeId ? logs.filter(log => log.nodeId === sourceNodeId) : logs;
    const usable = scoped.length ? scoped : logs.filter(log => !log.nodeId);
    return usable.flatMap(log => (log.outputs || []).map(url => ({url, createdAt:log.createdAt, nodeId:log.nodeId}))).filter(item => item.url);
}
function recoverStuckLoopOutputsFromLogs(){
    const used = usedCanvasOutputUrls();
    let changed = false;
    const slots = (nodes || [])
        .filter(node => node && isSmartImageNode(node) && !isHistoryGroupNode(node))
        .filter(node => (node.loopSourceId || node.loopRootId || Number.isFinite(Number(node.loopSlotIndex))) && !smartNodeHasDisplayResult(node))
        .filter(node => (
            node.pending
            || node.running
            || node.queued
        ) && !smartNodePendingTasks(node).length)
        .sort((a, b) => (Number(a.loopSlotIndex || 0) - Number(b.loopSlotIndex || 0)) || (Number(a.y || 0) - Number(b.y || 0)));
    slots.forEach(slot => {
        const sourceId = slot.loopRootId || slot.sourceNodeId || '';
        const output = successfulRecentComfyLogOutputs(sourceId).find(item => !used.has(item.url));
        if(!output) return;
        const kind = mediaKindForUrls([output.url], 'image');
        const ext = kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : kind === 'text' ? 'txt' : 'png';
        slot.images = [stripImageGenerationMeta({url:output.url, name:`comfy-recovered-${Number(slot.loopSlotIndex || 0) + 1}.${ext}`, kind, generatedResult:true})];
        markSmartNodeComplete(slot);
        if(kind) slot.outputKind = kind;
        slot.title = slot.title || 'Image';
        slot.scale = mediaNodeDefaultScale(slot);
        delete slot.w;
        delete slot.h;
        used.add(output.url);
        changed = true;
        clearSourceBusyStateIfDownstreamDone(nodes.find(n => n.id === sourceId));
    });
    return changed;
}
function syncRunButtonState(node=window.SmartCanvasModules.viewportSelection.selection.node()){
    if(!runBtn) return;
    // 单次生成中的节点仍允许再次提交；新的运行会创建并列输出节点。
    // 循环节点本身仍保持单实例，避免同一循环重复启动。
    const videoState = isApiLikeEngine(settings.engine) && settings.apiKind === 'video'
        ? smartVideoComposerState({reconcile:false}).state
        : null;
    const invalidVideoReferences = videoState
        ? window.SmartCanvasModules.videoCapabilities.validateReferences(videoState).valid === false
        : false;
    runBtn.disabled = !isSmartRunnableNode(node)
        || generationRun.status({node}).loopRunning
        || invalidVideoReferences;
}
function canvasImageDragPayload(node, index=0){
    const img = node?.images?.[index];
    if(!img?.url) return null;
    return {url:img.url, name:img.name || node.title || 'image'};
}
function imageMetaFromNode(node){
    return {};
}
function applyNodeMetaToImage(image, node){
    return stripImageGenerationMeta(image);
}
function inheritNodeMetaFromImage(node){
    if(!node) return;
    node.images = (node.images || []).map(img => stripImageGenerationMeta(img));
}
function createFrameFromSelection(ids=window.SmartCanvasModules.viewportSelection.selection.ids()){
    const out = new Set((ids || []).filter(id => nodes.some(node => node.id === id)));
    nodes.filter(smartContainer.isGroup).forEach(group => {
        if((group.items || []).some(itemId => out.has(itemId))){
            (group.items || []).forEach(itemId => out.delete(itemId));
            out.add(group.id);
        }
    });
    [...out].forEach(id => {
        const node = nodes.find(item => item.id === id);
        if(!smartContainer.isFrame(node)) return;
        smartContainer.descendantIds(node).forEach(memberId => out.delete(memberId));
    });
    const atomicIds = [...out];
    const selectedNodes = atomicIds.map(id => nodes.find(node => node.id === id)).filter(Boolean);
    if(!selectedNodes.length){
        activateSmartFrameTool();
        return null;
    }
    const rects = selectedNodes.map(nodeRect);
    const left = Math.min(...rects.map(rect => rect.x));
    const top = Math.min(...rects.map(rect => rect.y));
    const right = Math.max(...rects.map(rect => rect.x + rect.width));
    const bottom = Math.max(...rects.map(rect => rect.y + rect.height));
    canvasMutation.history({action:'push'});
    const frame = canvasMutation.create({
        kind:'frame',
        data:{
            x:left - 36,
            y:top - 58,
            w:right - left + 72,
            h:bottom - top + 94,
            items:atomicIds
        },
        options:{
            skipUndo:true,
            render:false,
            save:false,
            positionMode:'exact'
        }
    });
    smartContainer.reconcileFrames();
    smartBaseTool = 'pointer';
    smartFrameToolActive = false;
    refreshSmartAnnotationToolbar();
    render();
    canvasPersistence.schedule();
    beginCreatedSmartFrameTitleEdit(frame);
    return frame;
}
function smartRectsOverlap(a, b, gap=0){
    return a.x < b.x + b.width + gap
        && a.x + a.width + gap > b.x
        && a.y < b.y + b.height + gap
        && a.y + a.height + gap > b.y;
}
function readSessionNodeClipboard(){
    try {
        const record = JSON.parse(
            sessionStorage.getItem(SMART_NODE_CLIPBOARD_KEY) || 'null'
        );
        if(
            Number(record?.version) !== smartClipboardOwnership.VERSION
            || !String(record?.copyId || '')
            || !Array.isArray(record?.nodes)
            || !record.nodes.length
        ){
            sessionStorage.removeItem(SMART_NODE_CLIPBOARD_KEY);
            return null;
        }
        return {
            version:smartClipboardOwnership.VERSION,
            copyId:String(record.copyId),
            nodes:record.nodes,
            connections:Array.isArray(record.connections)
                ? record.connections
                : [],
            copiedAt:Number(record.copiedAt) || 0,
            sourceCanvasId:String(record.sourceCanvasId || '')
        };
    } catch(error){
        return null;
    }
}
function availableNodeClipboard(){
    const stored = readSessionNodeClipboard();
    if(
        stored
        && (!nodeClipboard
            || Number(stored.copiedAt) >= Number(nodeClipboard.copiedAt || 0))
    ){
        nodeClipboard = stored;
    }
    return nodeClipboard;
}
function invalidateNodeClipboard(){
    nodeClipboard = null;
    try { sessionStorage.removeItem(SMART_NODE_CLIPBOARD_KEY); }
    catch(error) {}
}
function storeSessionNodeClipboard(clipboard){
    try {
        sessionStorage.setItem(
            SMART_NODE_CLIPBOARD_KEY,
            JSON.stringify({
                version:smartClipboardOwnership.VERSION,
                copyId:clipboard.copyId,
                sourceCanvasId:canvasId,
                copiedAt:clipboard.copiedAt,
                nodes:clipboard.nodes,
                connections:clipboard.connections
            })
        );
        return true;
    } catch(error){
        return false;
    }
}
function copySelectedNodes(event=null){
    if(!canvas || isEditableTarget(document.activeElement)) return;
    if(!event){
        const previousCopyId = availableNodeClipboard()?.copyId || '';
        nodeClipboardCopyRequested = true;
        let copied = false;
        try {
            copied = document.execCommand('copy')
                && Boolean(nodeClipboard?.copyId)
                && nodeClipboard.copyId !== previousCopyId;
        } catch(error) {
            copied = false;
        } finally {
            nodeClipboardCopyRequested = false;
        }
        if(!copied){
            invalidateNodeClipboard();
            toast(tr('smart.copyRetry'));
        }
        return copied;
    }
    const ids = smartContainer.expand(window.SmartCanvasModules.viewportSelection.selection.ids());
    const copiedNodes = ids
        .map(id => nodes.find(n => n.id === id))
        .filter(Boolean)
        .map(serializableSmartNode);
    if(!copiedNodes.length) return;
    const idSet = new Set(copiedNodes.map(n => n.id));
    const copiedConnections = (canvas.connections || []).filter(c => idSet.has(c.from) && idSet.has(c.to));
    const copyId = smartClipboardOwnership.newCopyId();
    event.preventDefault();
    if(!smartClipboardOwnership.writeMarker(event.clipboardData, copyId)){
        invalidateNodeClipboard();
        return false;
    }
    const nextClipboard = {
        version:smartClipboardOwnership.VERSION,
        copyId,
        nodes:JSON.parse(JSON.stringify(copiedNodes)),
        connections:JSON.parse(JSON.stringify(copiedConnections)),
        copiedAt:Date.now(),
        sourceCanvasId:canvasId
    };
    nodeClipboard = nextClipboard;
    const portable = storeSessionNodeClipboard(nextClipboard);
    toast(
        portable
            ? trf('smart.nodesCopiedCrossCanvas', {count: copiedNodes.length})
            : trf('smart.nodesCopied', {count: copiedNodes.length})
    );
    return true;
}
function pasteNodes(point=null, options={}){
    const clipboard = options.clipboard || availableNodeClipboard();
    if(!canvas || !clipboard?.nodes?.length || isEditableTarget(document.activeElement)) return;
    return canvasMutation.duplicate({
        mode:'point',
        sourceNodes:clipboard.nodes,
        connections:clipboard.connections || [],
        point:point || lastMouseWorld || window.SmartCanvasModules.viewportSelection.viewport.center()
    });
}
function shellPoint(event){
    const rect = shell.getBoundingClientRect();
    return {x:event.clientX - rect.left, y:event.clientY - rect.top};
}
function connectionLayerController(){
    if(smartConnectionLayerController) return smartConnectionLayerController;
    const connectionLayerModule = window.SmartCanvasModules?.connectionLayer;
    if(!connectionLayerModule){
        throw new Error('Connection Layer Module failed to load');
    }
    smartConnectionLayerController = connectionLayerModule.create({
        world,
        snapshot:() => ({
            nodes,
            connections:canvas?.connections || [],
            selectedConnectionKey,
            selectedConnectionPoint,
            pinnedNodeIds:smartCanvasPinnedNodeIds(),
            interaction:canvasInteraction.active()
        }),
        nodeRect,
        isGroup:node => smartContainer.isGroup(node),
        connectionVisible:input => canvasVirtualization.connectionVisible(input),
        noteConnections:count => canvasVirtualization.noteConnections(count),
        runStatus:input => generationRun.status(input),
        translate:key => tr(key),
        screenToWorld:event => (
            window.SmartCanvasModules.viewportSelection.viewport.screenToWorld(event)
        ),
        onSelect:({key,x,y}) => {
            selectedConnectionKey = key;
            selectedConnectionPoint = {key,x,y};
            window.SmartCanvasModules.viewportSelection.selection.clear();
            window.SmartCanvasModules.viewportSelection.selection.refresh();
            updateComposer();
        },
        onDisconnect:({indexes}) => {
            selectedConnectionKey = '';
            selectedConnectionPoint = null;
            canvasMutation.disconnect({indexes});
        }
    });
    return smartConnectionLayerController;
}
function reconcileConnectionLayer(){
    return connectionLayerController().sync();
}
function refreshConnectionLayer(options={}){
    const nodeIds = Array.isArray(options.nodeIds)
        ? [...new Set(options.nodeIds.filter(Boolean))]
        : [];
    return nodeIds.length
        ? connectionLayerController().refreshNodes(nodeIds)
        : reconcileConnectionLayer();
}
function flushScheduledConnectionLayerRefresh(){
    connectionLayerRaf = 0;
    const options = connectionLayerRefreshAll
        ? {}
        : {nodeIds:[...pendingConnectionLayerNodeIds]};
    connectionLayerRefreshAll = false;
    pendingConnectionLayerNodeIds.clear();
    refreshConnectionLayer(options);
}
function scheduleConnectionLayerRefresh(options={}){
    const nodeIds = Array.isArray(options.nodeIds)
        ? options.nodeIds.filter(Boolean)
        : [];
    if(nodeIds.length){
        nodeIds.forEach(nodeId => pendingConnectionLayerNodeIds.add(nodeId));
    } else {
        connectionLayerRefreshAll = true;
    }
    if(connectionLayerRaf) return;
    connectionLayerRaf = requestAnimationFrame(
        flushScheduledConnectionLayerRefresh
    );
}
function syncNodeElementLayout(node){
    if(!node) return;
    const el = world.querySelector(`.image-node[data-id="${CSS.escape(node.id)}"]`);
    if(!el){
        render();
        return;
    }
    const imgs = smartContainer.isGroup(node) ? smartContainer.imageRefs(node).map(ref => ref.item) : (node.images || []);
    const layout = imageLayout(imgs, nodeScale(node), node);
    el.style.width = `${layout.width}px`;
    el.style.height = `${layout.height}px`;
    const body = el.querySelector('.node-body');
    if(body){
        const pendingComponent = body.querySelector('ic-generation-pending[data-generation-pending-node]');
        if(pendingComponent){
            pendingComponent.style.removeProperty('width');
            pendingComponent.style.removeProperty('height');
        }
        const recoveryComponent = body.querySelector('ic-generation-recovery[data-generation-recovery-node]');
        if(recoveryComponent){
            recoveryComponent.style.width = `${layout.width}px`;
            recoveryComponent.style.height = `${layout.height}px`;
        }
        const maxVisibleRows = smartContainer.isGroup(node)
            ? (smartContainer.compactMembers(node).length ? Number(layout.rows || 1) : SMART_GROUP_MAX_VISIBLE_ROWS)
            : MEDIA_GROUP_MAX_VISIBLE_ROWS;
        const grid = body.querySelector('.thumb-grid');
        if(grid){
            grid.style.setProperty('--thumb-cols', layout.cols);
            grid.style.setProperty('--thumb-size', `${layout.thumb}px`);
            const visibleRows = Math.max(1, Math.min(maxVisibleRows, Number(layout.visibleRows || layout.rows || 1)));
            const maxHeight = Number(layout.gridHeight || (visibleRows * Number(layout.thumb || 96) + Math.max(0, visibleRows - 1) * 8));
            grid.style.setProperty('--thumb-max-height', `${maxHeight}px`);
            grid.querySelectorAll('.thumb-item').forEach((itemEl, index) => {
                applyThumbDisplaySizeToElement(itemEl, imgs[index], layout.thumb);
            });
        }
        const wrap = body.querySelector('.image-wrap');
        if(wrap){
            // 分组单图卡片含 16px 内边距（PAD=32），图片按内边距内的尺寸显示，避免溢出边框。
            const wrapW = layout.generationOutput
                ? layout.mainWidth
                : smartContainer.isGroup(node) ? Math.max(24, Number(layout.innerW || 0) || (Number(layout.width) - 32)) : layout.width;
            const wrapH = layout.generationOutput
                ? layout.mainHeight
                : smartContainer.isGroup(node) ? Math.max(24, Number(layout.innerH || 0) || (Number(layout.height) - 60)) : layout.height;
            wrap.style.setProperty('--node-img-w', `${wrapW}px`);
            wrap.style.setProperty('--node-img-h', `${wrapH}px`);
        }
        const media = body.querySelector('.node-img');
        if(media){
            const mediaW = layout.generationOutput
                ? layout.mainWidth
                : smartContainer.isGroup(node) ? Math.max(24, Number(layout.innerW || 0) || (Number(layout.width) - 32)) : layout.width;
            const mediaH = layout.generationOutput
                ? layout.mainHeight
                : smartContainer.isGroup(node) ? Math.max(24, Number(layout.innerH || 0) || (Number(layout.height) - 60)) : layout.height;
            media.style.width = `${mediaW}px`;
            media.style.height = `${mediaH}px`;
        }
    }
    const active = window.SmartCanvasModules.viewportSelection.selection.node();
    if(active?.id === node.id){
        positionComposerForNode(active);
        positionSmartNodeFloatingPortal(active);
    }
    scheduleConnectionLayerRefresh({nodeIds:[node.id]});
    window.SmartCanvasModules.viewportSelection.viewport.refresh();
}
function syncSmartGroupMemberElements(group){
    if(!smartContainer.isGroup(group)) return;
    smartContainer.compactMembers(group).forEach(member => {
        const el = world.querySelector(`.image-node[data-id="${CSS.escape(member.id)}"]`);
        if(el){
            el.style.left = `${member.x || 0}px`;
            el.style.top = `${member.y || 0}px`;
        }
        syncNodeElementLayout(member);
    });
}
function isVideoMediaItem(img){
    if(!img) return false;
    if(img.kind === 'video') return true;
    const url = smartOriginalMediaUrl(img).toLowerCase();
    return /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/.test(url);
}
function isInlineVideoActive(img){
    return Boolean(img && img._inlineVideoActive);
}
function isAudioMediaItem(img){
    if(!img) return false;
    if(img.kind === 'audio') return true;
    const url = smartOriginalMediaUrl(img).toLowerCase();
    return /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(url);
}
function isTextMediaItem(img){
    if(!img) return false;
    if(img.kind === 'text') return true;
    const url = smartOriginalMediaUrl(img).toLowerCase();
    return /\.(txt|json|csv|srt|vtt|md)(\?|$)/.test(url);
}
function isFileMediaItem(img){
    if(!img) return false;
    return img.kind === 'file';
}
function mediaKindForFile(file){
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    if(type.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/.test(name)) return 'video';
    if(type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(name)) return 'audio';
    if(type.startsWith('text/') || /\.(txt|json|csv|srt|vtt|md)(\?|$)/.test(name)) return 'text';
    return 'image';
}
function mediaKindForItem(img){
    if(isFileMediaItem(img)) return 'file';
    if(isTextMediaItem(img)) return 'text';
    if(isAudioMediaItem(img)) return 'audio';
    if(isVideoMediaItem(img)) return 'video';
    return 'image';
}
function localDisplayUrlForMediaItem(img){
    if(!img) return '';
    const candidates = [
        img.originalLocalUrl,
        img.localUrl,
        img.sourceUrl,
        img.local_url,
        img.source_url,
        img.url
    ];
    const local = candidates.find(url => url && !/^https?:\/\//i.test(String(url)));
    return local || img.url || '';
}
function imageForDisplay(img){
    if(!img || typeof img !== 'object') return img;
    const localUrl = localDisplayUrlForMediaItem(img);
    if(!localUrl || localUrl === img.url) return img;
    return {
        ...img,
        url:localUrl,
        originalLocalUrl:img.originalLocalUrl || localUrl
    };
}
function resultMediaUrls(result){
    const urls = [];
    const add = value => {
        if(!value) return;
        if(typeof value === 'string'){
            urls.push(value);
            return;
        }
        if(Array.isArray(value)){
            value.forEach(add);
            return;
        }
        if(typeof value === 'object'){
            if(value.url || value.path || value.src || value.uri){
                const url = value.url || value.path || value.src || value.uri;
                if(url){
                    const item = {url, kind:value.kind || value.type || value.mediaKind || '', name:value.name || value.filename || ''};
                    ['natural_w','natural_h','width','height','w','h','layout_w','layout_h'].forEach(key => {
                        const n = Number(value[key]);
                        if(Number.isFinite(n) && n > 0) item[key] = n;
                    });
                    urls.push(item);
                }
            }
            ['image_items','media_items','items','outputs','videos','images','urls','data','result'].forEach(key => add(value[key]));
            ['url','path','src','uri','output','output_url','outputUrl','video','video_url','videoUrl','mp4_url','mp4Url','download_url','downloadUrl','preview_url','previewUrl'].forEach(key => add(value[key]));
        }
    };
    add(result);
    ['image_items','media_items','items','outputs','videos','audios','texts','files','images','urls','data','result','output','url'].forEach(key => add(result?.[key]));
    const seen = new Set();
    return urls.map(item => {
        const url = typeof item === 'string' ? item : item?.url || item?.path || '';
        if(!url) return null;
        return typeof item === 'object' ? {...item, url} : url;
    }).filter(item => {
        const url = typeof item === 'string' ? item : item?.url || '';
        return url && !seen.has(url) && seen.add(url);
    });
}
function mediaKindForUrls(urls, fallback='image'){
    const items = (urls || []).map(item => typeof item === 'string' ? {url:item} : (item || {}));
    if(fallback && fallback !== 'image') return fallback;
    if(items.some(isVideoMediaItem)) return 'video';
    if(items.some(isAudioMediaItem)) return 'audio';
    if(items.some(isTextMediaItem)) return 'text';
    return fallback;
}
function imageRefsOnly(refs, maximum=SMART_REFERENCE_IMAGE_MAX){
    const images = (refs || []).filter(ref => ref?.url && mediaKindForItem(ref) === 'image');
    return maximum == null ? images : images.slice(0, Math.max(0, Number(maximum) || 0));
}
function looksLikeImageMediaUrl(url){
    const text = String(url || '').trim().toLowerCase();
    if(!text) return false;
    if(text.startsWith('data:image/')) return true;
    if(text.startsWith('asset://')) return false;
    const path = text.split('?', 1)[0].split('#', 1)[0];
    return /\.(png|jpe?g|webp|gif|bmp|tiff)$/i.test(path);
}
function videoRefsOnly(refs){
    return (refs || []).filter(ref => ref?.url && mediaKindForItem(ref) === 'video' && !looksLikeImageMediaUrl(ref.url));
}
function isRemoteVideoReferenceUrl(url){
    return /^https?:\/\//i.test(String(url || '')) || /^asset:\/\//i.test(String(url || ''));
}
function audioRefsOnly(refs){
    return (refs || []).filter(ref => ref?.url && mediaKindForItem(ref) === 'audio');
}
function thumbMediaHtml(img){
    if(isFileMediaItem(img) || isTextMediaItem(img)) return `<div class="media-thumb file-thumb" data-media-url="${escapeAttr(img.url || '')}" data-media-kind="${escapeAttr(mediaKindForItem(img))}"><i data-lucide="${isTextMediaItem(img) ? 'file-text' : 'file'}"></i><span>${escapeHtml(img.name || (isTextMediaItem(img) ? 'Text' : 'File'))}</span></div>`;
    if(isAudioMediaItem(img)) return `<div class="media-thumb audio-thumb" data-media-url="${escapeAttr(img.url || '')}" data-media-kind="audio"><i data-lucide="file-audio"></i><span>${escapeHtml(img.name || 'Audio')}</span></div>`;
    if(isVideoMediaItem(img)) return `<div class="media-thumb video-thumb">${isInlineVideoActive(img) ? smartVideoPlayerHtml(img.url || '') : `${smartVideoPreviewHtml(img, 512, 'alt=""')}${smartVideoPlayButtonHtml({thumbnail:true})}`}</div>`;
    return smartPreviewImgHtml(img, 512, 'draggable="false"');
}
function imageResolutionLabel(img){
    const w = Number(img?.natural_w || img?.width || img?.w || 0);
    const h = Number(img?.natural_h || img?.height || img?.h || 0);
    return w > 0 && h > 0 ? `${Math.round(w)} x ${Math.round(h)}` : '';
}
function imageResolutionBadgeHtml(img){
    const metadata = window.SmartCanvasModules.imageMetadata;
    const size = metadata.dimensions(img);
    if(!size) return '';
    const resolution = trf('smart.imageResolutionBadge', size);
    const resolutionDescription = trf('smart.imageResolutionDescription', size);
    const ratio = mediaKindForItem(img) === 'image' ? metadata.aspectRatio(size.width, size.height) : null;
    const ratioLabel = ratio ? trf(ratio.approximate ? 'smart.imageApproximateRatioBadge' : 'smart.imageRatioBadge', ratio) : '';
    const ratioDescription = ratio ? trf(ratio.approximate ? 'smart.imageApproximateRatioDescription' : 'smart.imageRatioDescription', ratio) : '';
    return `<span class="image-metadata-badges"><span class="image-resolution-badge" role="img" aria-label="${escapeAttr(resolutionDescription)}">${escapeHtml(resolution)}</span>${ratio ? `<span class="image-aspect-ratio-badge" role="img" aria-label="${escapeAttr(ratioDescription)}"><ic-icon name="aspect-ratio" size="x-small" aria-hidden="true"></ic-icon>${escapeHtml(ratioLabel)}</span>` : ''}</span>`;
}
function imageNameLabel(img, fallback='image'){
    const raw = String(img?.name || fileNameFromUrl(img?.url || '') || fallback || 'image').trim();
    return raw || 'image';
}
function imageNameBadgeHtml(img, options={}){
    if(!img?.url) return '';
    const name = imageNameLabel(img);
    const outsideClass = options.outside ? ' image-name-badge-outside' : '';
    const icon = {image:'image',video:'video',audio:'audio-lines'}[mediaKindForItem(img)];
    if(!icon) return `<span class="image-name-badge${outsideClass}" data-image-name="1" title="${escapeAttr(name)}">${escapeHtml(name)}</span>`;
    const node = options.node;
    const generated = img.generatedResult === true || (
        img.generatedResult !== false
        && node?.uploadedAttachment !== true
        && (node?.generationOutputNode === true || node?.generationOperationId || node?.generationBatchId)
    );
    const label = `${tr(generated ? 'smart.mediaAiGenerated' : 'smart.mediaImported')} · ${name}`;
    return `<span class="image-name-badge${outsideClass}" data-image-name="1" title="${escapeAttr(label)}"><ic-icon name="${icon}" size="x-small" aria-hidden="true"></ic-icon><span class="image-name-badge-copy">${escapeHtml(label)}</span></span>`;
}
function thumbDisplaySize(img, maxSize){
    const limit = Math.max(28, Math.round(Number(maxSize) || 96));
    const size = mediaLayoutSize(img);
    const w = size.width;
    const h = size.height;
    if(!(w > 0 && h > 0)) return {width:limit, height:limit};
    const fit = Math.min(limit / w, limit / h);
    return {
        width:Math.max(28, Math.round(w * fit)),
        height:Math.max(28, Math.round(h * fit))
    };
}
function thumbItemStyle(img, maxSize){
    const size = thumbDisplaySize(img, maxSize);
    return `--thumb-w:${size.width}px;--thumb-h:${size.height}px`;
}
function applyThumbDisplaySizeToElement(itemEl, img, maxSize=0){
    if(!itemEl?.classList?.contains('thumb-item')) return;
    const limit = Math.max(
        28,
        Math.round(
            Number(maxSize || 0)
            || Number(itemEl.style.getPropertyValue('--thumb-size').replace('px', ''))
            || Math.max(itemEl.clientWidth || 0, itemEl.clientHeight || 0)
            || 96
        )
    );
    const size = thumbDisplaySize(img, limit);
    itemEl.style.setProperty('--thumb-w', `${size.width}px`);
    itemEl.style.setProperty('--thumb-h', `${size.height}px`);
}
function updateImageResolutionBadgeElement(itemEl, img){
    if(!itemEl) return;
    const html = imageResolutionBadgeHtml(img);
    const badges = itemEl.querySelector('.image-metadata-badges');
    if(badges) badges.outerHTML = html;
    else if(html) (itemEl.querySelector('.thumb-media-frame') || itemEl).insertAdjacentHTML('beforeend', html);
}
function refreshImageResolutionBadgesForMedia(nodeId, imageIndex, img){
    const id = CSS.escape(String(nodeId));
    const index = CSS.escape(String(imageIndex));
    // A language switch or redraw may have replaced the element that started loading.
    // Update the currently mounted image and any Smart Group references to it.
    world.querySelectorAll(`.image-node[data-id="${id}"] [data-image-index="${index}"]:not([data-ref-node-id]), .image-node [data-ref-node-id="${id}"][data-ref-image-index="${index}"]`)
        .forEach(itemEl => updateImageResolutionBadgeElement(itemEl, img));
}
function singleMediaHtml(img, w, h){
    if(isFileMediaItem(img) || isTextMediaItem(img)) return `<div class="node-img media-card media-file-card" style="width:${w}px;height:${h}px"><div class="media-card-icon"><i data-lucide="${isTextMediaItem(img) ? 'file-text' : 'file'}"></i></div><div class="media-card-title">${escapeHtml(img.name || (isTextMediaItem(img) ? 'Text' : 'File'))}</div><div class="media-card-sub">${isTextMediaItem(img) ? 'TEXT' : 'FILE'}</div></div>`;
    if(isAudioMediaItem(img)) return `<div class="node-img media-card media-audio-card" style="width:${w}px;height:${h}px"><div class="media-card-icon"><i data-lucide="file-audio"></i></div><div class="media-card-title">${escapeHtml(img.name || 'Audio')}</div><div class="media-card-sub">AUDIO</div><audio src="${escapeAttr(img.url || '')}" data-url="${escapeAttr(img.url || '')}" controls preload="metadata"></audio></div>`;
    if(isVideoMediaItem(img)) return `<div class="node-img media-card media-video-card" style="width:${w}px;height:${h}px">${isInlineVideoActive(img) ? smartVideoPlayerHtml(img.url || '') : `${smartVideoPreviewHtml(img, 768, 'alt=""')}${smartVideoPlayButtonHtml()}`}</div>`;
    return smartPreviewImgHtml(img, 512, `class="node-img" draggable="false" style="width:${w}px;height:${h}px"`);
}
function smartPlaybackKey(nodeId, imageIndex=0){
    return `${String(nodeId || '')}:${Math.max(0, Number(imageIndex) || 0)}`;
}
function smartPlaybackEntry(nodeId, imageIndex=0){
    const key = smartPlaybackKey(nodeId, imageIndex);
    if(!smartPlaybackSession.entries.has(key)){
        smartPlaybackSession.entries.set(key, {
            key,
            nodeId:String(nodeId || ''),
            imageIndex:Math.max(0, Number(imageIndex) || 0),
            currentTime:0,
            paused:true,
            ended:false,
            loop:true
        });
    }
    return smartPlaybackSession.entries.get(key);
}
function smartPlaybackTargetFromElement(media){
    if(!media) return null;
    const item = media.closest?.('[data-image-index]');
    const nodeElement = media.closest?.('.image-node');
    const nodeId = media.dataset?.mediaNodeId
        || item?.dataset?.refNodeId
        || nodeElement?.dataset?.id
        || '';
    const imageIndex = Number(
        media.dataset?.mediaImageIndex
        ?? item?.dataset?.refImageIndex
        ?? item?.dataset?.imageIndex
        ?? 0
    );
    return nodeId ? {
        nodeId:String(nodeId),
        imageIndex:Math.max(0, imageIndex || 0),
        key:smartPlaybackKey(nodeId, imageIndex)
    } : null;
}
function smartPlaybackPreferencesFor(media){
    return media?.tagName?.toLowerCase?.() === 'audio'
        ? smartPlaybackSession.audioPreferences
        : smartPlaybackSession.videoPreferences;
}
function smartPlaybackRemember(media, explicitTarget=null){
    const target = explicitTarget || smartPlaybackTargetFromElement(media);
    if(!media || !target) return null;
    const entry = smartPlaybackEntry(target.nodeId, target.imageIndex);
    const state = captureMediaPlaybackState(media);
    entry.currentTime = state.currentTime;
    entry.paused = state.paused;
    entry.ended = state.ended;
    if(media.tagName?.toLowerCase?.() === 'video') entry.loop = state.loop;
    const preferences = smartPlaybackPreferencesFor(media);
    preferences.volume = state.volume;
    preferences.muted = state.muted;
    preferences.playbackRate = state.playbackRate;
    return entry;
}
function smartPlaybackSetInlineActive(nodeId, imageIndex, active){
    const node = nodes.find(candidate => candidate.id === String(nodeId));
    const image = node?.images?.[Math.max(0, Number(imageIndex) || 0)];
    if(image && mediaKindForItem(image) === 'video') image._inlineVideoActive = Boolean(active);
}
function smartPlaybackPauseMedia(media, options={}){
    if(!media) return null;
    clearTimeout(media._smartPlaybackClickTimer);
    media._smartPlaybackClickTimer = null;
    const entry = smartPlaybackRemember(media);
    media.pause?.();
    if(options.restoreCover){
        const target = smartPlaybackTargetFromElement(media);
        if(target){
            smartPlaybackSetInlineActive(target.nodeId, target.imageIndex, false);
            const nodeElement = media.closest?.('.image-node');
            if(nodeElement) nodeElement._smartCanvasRenderSignature = '';
        }
    }
    if(smartPlaybackSession.activeMedia === media){
        smartPlaybackSession.activeMedia = null;
        smartPlaybackSession.activeKey = '';
    }
    return entry;
}
function smartPlaybackClaim(media){
    const candidates = [
        ...world.querySelectorAll('video[data-url],audio[data-url]'),
        document.getElementById('previewCurrentVideo')
    ].filter(Boolean);
    candidates.forEach(candidate => {
        if(candidate === media || candidate.paused) return;
        smartPlaybackPauseMedia(candidate);
    });
    smartPlaybackSession.activeMedia = media;
    smartPlaybackSession.activeKey = smartPlaybackTargetFromElement(media)?.key || '';
}
function smartPlaybackRestoreEntry(media, entry, options={}){
    if(!media || !entry) return false;
    clearTimeout(media._smartPlaybackClickTimer);
    media._smartPlaybackClickTimer = null;
    const preferences = smartPlaybackPreferencesFor(media);
    const shouldPlay = options.play === true;
    try { media.volume = Math.max(0, Math.min(1, Number(preferences.volume ?? 1))); } catch(e) {}
    try { media.muted = Boolean(preferences.muted); } catch(e) {}
    try { media.playbackRate = Number(preferences.playbackRate) || 1; } catch(e) {}
    if(media.tagName?.toLowerCase?.() === 'video') media.loop = entry.loop !== false;
    const apply = () => {
        const desiredTime = shouldPlay && entry.ended ? 0 : Math.max(0, Number(entry.currentTime) || 0);
        if(Math.abs(Number(media.currentTime || 0) - desiredTime) > 0.12){
            try { media.currentTime = desiredTime; } catch(e) {}
        }
        if(shouldPlay){
            entry.ended = false;
            entry.paused = false;
            smartPlaybackClaim(media);
            const promise = media.play?.();
            promise?.catch?.(() => { entry.paused = true; });
        } else {
            media.pause?.();
        }
    };
    if(media.readyState >= 1) apply();
    else media.addEventListener('loadedmetadata', apply, {once:true});
    return true;
}
function smartPlaybackBindMedia(media, nodeId='', imageIndex=0, options={}){
    if(!media) return null;
    const target = nodeId
        ? {nodeId:String(nodeId), imageIndex:Math.max(0, Number(imageIndex) || 0)}
        : smartPlaybackTargetFromElement(media);
    if(!target) return media;
    media.dataset.mediaNodeId = target.nodeId;
    media.dataset.mediaImageIndex = String(target.imageIndex);
    if(options.preview) media.dataset.smartPlaybackPreview = '1';
    const preferences = smartPlaybackPreferencesFor(media);
    try { media.volume = Math.max(0, Math.min(1, Number(preferences.volume ?? 1))); } catch(e) {}
    try { media.muted = Boolean(preferences.muted); } catch(e) {}
    try { media.playbackRate = Number(preferences.playbackRate) || 1; } catch(e) {}
    if(media.dataset.smartPlaybackBound === '1') return media;
    media.dataset.smartPlaybackBound = '1';
    media.addEventListener('play', () => {
        const current = smartPlaybackRemember(media);
        if(current){ current.paused = false; current.ended = false; }
        smartPlaybackClaim(media);
    });
    media.addEventListener('pause', () => smartPlaybackRemember(media));
    media.addEventListener('timeupdate', () => smartPlaybackRemember(media));
    media.addEventListener('volumechange', () => smartPlaybackRemember(media));
    media.addEventListener('ratechange', () => smartPlaybackRemember(media));
    media.addEventListener('ended', () => {
        const current = smartPlaybackRemember(media);
        if(current && !media.loop){ current.ended = true; current.paused = true; }
    });
    media.addEventListener('error', () => {
        const current = smartPlaybackRemember(media);
        if(current) current.paused = true;
        const target = smartPlaybackTargetFromElement(media);
        if(
            target
            && media.tagName?.toLowerCase?.() === 'video'
            && media.dataset.inlineVideoActive === '1'
        ){
            smartPlaybackSetInlineActive(target.nodeId, target.imageIndex, false);
            const nodeElement = media.closest?.('.image-node');
            if(nodeElement) nodeElement._smartCanvasRenderSignature = '';
            if(smartPlaybackSession.activeMedia === media){
                smartPlaybackSession.activeMedia = null;
                smartPlaybackSession.activeKey = '';
            }
            requestAnimationFrame(() => render({
                syncVirtualization:false,
                nodeIds:[target.nodeId]
            }));
        }
        if(media.dataset.smartPlaybackErrorShown !== '1'){
            media.dataset.smartPlaybackErrorShown = '1';
            toast(tr('smart.operationFailed'), {tone:'danger'});
        }
    });
    return media;
}
function smartPlaybackItemElement(nodeId, imageIndex=0){
    return [...world.querySelectorAll('[data-image-index]')].find(item => {
        const ownerNodeId = item.dataset.refNodeId || item.closest('.image-node')?.dataset.id || '';
        const ownerImageIndex = Number(item.dataset.refImageIndex ?? item.dataset.imageIndex ?? 0);
        return ownerNodeId === String(nodeId) && ownerImageIndex === Math.max(0, Number(imageIndex) || 0);
    }) || world.querySelector(`.image-node[data-id="${CSS.escape(String(nodeId))}"] .media-video-card`);
}
function smartPlaybackActivateVideo(nodeId, imageIndex=0, options={}){
    const index = Math.max(0, Number(imageIndex) || 0);
    const node = nodes.find(candidate => candidate.id === String(nodeId));
    if(mediaKindForItem(node?.images?.[index] || {}) !== 'video') return null;
    smartPlaybackSetInlineActive(nodeId, index, true);
    const item = smartPlaybackItemElement(nodeId, index);
    let video = item?.querySelector?.('video[data-inline-video-active="1"]') || null;
    if(!video){
        const trigger = item?.querySelector?.('.smart-video-play,img[data-preview-kind="video"],video[data-url]') || item;
        video = smartActivateVideoPreview(trigger, {nodeId, imageIndex:index, autoplay:false});
    }
    if(!video) return null;
    smartPlaybackBindMedia(video, nodeId, index);
    smartPlaybackRestoreEntry(video, smartPlaybackEntry(nodeId, index), {play:options.play !== false});
    return video;
}
function smartPlaybackPauseForSelection(nextNodeId='', nextImageIndex=-1){
    const keepKey = nextNodeId && nextImageIndex >= 0
        ? smartPlaybackKey(nextNodeId, nextImageIndex)
        : '';
    world.querySelectorAll('video[data-inline-video-active="1"],audio[data-url]').forEach(media => {
        const target = smartPlaybackTargetFromElement(media);
        if(target?.key === keepKey) return;
        smartPlaybackPauseMedia(media, {restoreCover:media.tagName.toLowerCase() === 'video'});
    });
}
function smartPlaybackSelectAndPlayVideo(nodeId, imageIndex=0){
    const index = Math.max(0, Number(imageIndex) || 0);
    smartPlaybackPauseForSelection(nodeId, index);
    selectedId = String(nodeId || '');
    selectedIds = [];
    selectedImage = {nodeId:selectedId, index};
    generationRun.noteManualSelection();
    render();
    return smartPlaybackActivateVideo(selectedId, index, {play:true});
}
function smartPlaybackSelectedVideoTarget(){
    if(!selectedId || selectedIds.length) return null;
    const node = nodes.find(candidate => candidate.id === selectedId);
    if(!node) return null;
    const selectedIndex = selectedImage.nodeId === node.id
        ? Math.max(0, Number(selectedImage.index) || 0)
        : -1;
    const imageIndex = mediaKindForItem(node.images?.[selectedIndex] || {}) === 'video'
        ? selectedIndex
        : (node.images || []).findIndex(image => mediaKindForItem(image) === 'video');
    return imageIndex >= 0 ? {nodeId:node.id, imageIndex} : null;
}
function smartPlaybackToggleSelectedVideo(){
    const target = smartPlaybackSelectedVideoTarget();
    if(!target) return false;
    const item = smartPlaybackItemElement(target.nodeId, target.imageIndex);
    const video = item?.querySelector?.('video[data-inline-video-active="1"]');
    if(!video){
        smartPlaybackActivateVideo(target.nodeId, target.imageIndex, {play:true});
        return true;
    }
    if(video.paused){
        smartPlaybackRestoreEntry(video, smartPlaybackEntry(target.nodeId, target.imageIndex), {play:true});
    } else {
        smartPlaybackPauseMedia(video);
    }
    return true;
}
function smartPlaybackReconcileSelection(){
    const soleNodeId = selectedIds.length === 0 ? selectedId : '';
    world.querySelectorAll('video[data-inline-video-active="1"],audio[data-url]').forEach(media => {
        const target = smartPlaybackTargetFromElement(media);
        if(target?.nodeId && target.nodeId === soleNodeId) return;
        smartPlaybackPauseMedia(media, {restoreCover:media.tagName.toLowerCase() === 'video'});
    });
}
function smartPlaybackPauseForInterruption(reason='interruption'){
    const candidates = [
        ...world.querySelectorAll('video[data-url],audio[data-url]'),
        document.getElementById('previewCurrentVideo')
    ].filter(Boolean);
    candidates.forEach(media => {
        if(media.paused) return;
        smartPlaybackPauseMedia(media);
        media.dataset.smartPlaybackInterrupted = reason;
    });
}
function syncSmartNodeVideoLoopControl(button, enabled){
    if(!button) return;
    const active = Boolean(enabled);
    button.pressed = active;
    button.toggleAttribute('pressed', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    const icon = button.querySelector('ic-icon');
    if(icon) icon.setAttribute('name', active ? 'check' : 'loop');
    const label = active ? tr('smart.action.autoLoopOn') : tr('smart.action.autoLoop');
    const labelElement = button.querySelector('[data-smart-playback-label]');
    if(labelElement) labelElement.textContent = label;
    const syncSurface = () => {
        const base = button.shadowRoot?.querySelector('[part~="base"]');
        if(!base) return;
        base.style.backgroundColor = active ? '#141414' : '';
        base.style.color = active ? '#ffffff' : '';
        base.style.borderColor = active ? 'transparent' : '';
    };
    syncSurface();
    button.updateComplete?.then(syncSurface);
}
function toggleSmartVideoLoop(nodeId, imageIndex=0){
    const entry = smartPlaybackEntry(nodeId, imageIndex);
    entry.loop = !entry.loop;
    const key = entry.key;
    [...world.querySelectorAll('video[data-url]'), document.getElementById('previewCurrentVideo')]
        .filter(Boolean)
        .forEach(video => {
            if(smartPlaybackTargetFromElement(video)?.key === key) video.loop = entry.loop;
        });
    document.querySelectorAll(`[data-smart-node-action="video-loop"][data-node-id="${CSS.escape(String(nodeId))}"]`)
        .forEach(button => syncSmartNodeVideoLoopControl(button, entry.loop));
    if(smartPlaybackSession.previewKey === key && typeof syncPreviewVideoLoopControl === 'function'){
        syncPreviewVideoLoopControl(entry.loop);
    }
    return entry.loop;
}
function smartPlaybackPreparePreviewVideo(video, nodeId, imageIndex=0, options={}){
    if(!video) return false;
    const entry = smartPlaybackEntry(nodeId, imageIndex);
    const key = entry.key;
    const transfer = smartPlaybackSession.previewTransfer;
    const shouldPlay = transfer?.key === key ? !transfer.paused : options.previewSwitch === true;
    smartPlaybackSession.previewTransfer = null;
    smartPlaybackSession.previewKey = key;
    smartPlaybackBindMedia(video, nodeId, imageIndex, {preview:true});
    smartPlaybackRestoreEntry(video, entry, {play:shouldPlay});
    return entry.loop;
}
function smartPlaybackBeforePreviewSwitch(video){
    if(!video || video.style.display === 'none' || !video.getAttribute('src')) return null;
    const entry = smartPlaybackRemember(video);
    video.pause?.();
    return entry;
}
function smartPlaybackClosePreviewVideo(video, nodeId, imageIndex=0){
    if(!video || !nodeId) return false;
    const entry = smartPlaybackRemember(video, {
        nodeId:String(nodeId),
        imageIndex:Math.max(0, Number(imageIndex) || 0),
        key:smartPlaybackKey(nodeId, imageIndex)
    });
    if(!entry) return false;
    const shouldResume = !entry.paused && !entry.ended;
    video.pause?.();
    entry.paused = !shouldResume;
    smartPlaybackSession.previewKey = '';
    if(selectedIds.length || selectedId !== String(nodeId)) return true;
    smartPlaybackSetInlineActive(nodeId, imageIndex, true);
    smartPlaybackActivateVideo(nodeId, imageIndex, {play:shouldResume});
    return true;
}
function smartPlaybackResetForCanvas(){
    const nextCanvasId = String(canvas?.id || canvasId || '');
    if(smartPlaybackSession.canvasId === nextCanvasId) return;
    smartPlaybackSession.canvasId = nextCanvasId;
    smartPlaybackSession.entries.clear();
    smartPlaybackSession.activeMedia = null;
    smartPlaybackSession.activeKey = '';
    smartPlaybackSession.previewKey = '';
    smartPlaybackSession.previewTransfer = null;
}
function smartPlaybackPruneEntries(){
    const valid = new Set();
    nodes.forEach(node => (node.images || []).forEach((image, index) => {
        if(mediaKindForItem(image) === 'video' || mediaKindForItem(image) === 'audio'){
            valid.add(smartPlaybackKey(node.id, index));
        }
    }));
    [...smartPlaybackSession.entries.keys()].forEach(key => {
        if(!valid.has(key)) smartPlaybackSession.entries.delete(key);
    });
    if(smartPlaybackSession.activeKey && !valid.has(smartPlaybackSession.activeKey)){
        smartPlaybackSession.activeMedia?.pause?.();
        smartPlaybackSession.activeMedia = null;
        smartPlaybackSession.activeKey = '';
    }
    if(smartPlaybackSession.previewKey && !valid.has(smartPlaybackSession.previewKey)){
        imageStudio.isOpen() && imageStudio.close();
        toast(tr('smart.operationFailed'), {tone:'warning'});
    }
}
window.smartPlaybackPreparePreviewVideo = smartPlaybackPreparePreviewVideo;
window.smartPlaybackBeforePreviewSwitch = smartPlaybackBeforePreviewSwitch;
window.smartPlaybackClosePreviewVideo = smartPlaybackClosePreviewVideo;
window.smartPlaybackTogglePreviewLoop = video => {
    const target = smartPlaybackTargetFromElement(video);
    return target ? toggleSmartVideoLoop(target.nodeId, target.imageIndex) : false;
};
function smartNodeHasLiveMedia(node){
    return Boolean(!node?.pending && (node?.images || []).some(img => img?.url));
}
function mediaSignaturePartFromElement(itemEl){
    if(itemEl?.dataset?.mediaSignature) return itemEl.dataset.mediaSignature;
    const media = itemEl?.querySelector?.('video,audio,img');
    if(media){
        const tag = media.tagName.toLowerCase();
        const kind = tag === 'video' ? 'video' : tag === 'audio' ? 'audio' : 'image';
        const url = media.dataset?.url || media.dataset?.originalSrc || media.getAttribute('src') || '';
        return `${kind}:${url}`;
    }
    const audioThumb = itemEl?.querySelector?.('.audio-thumb[data-media-url]');
    if(audioThumb) return `audio:${audioThumb.dataset.mediaUrl || ''}`;
    return '';
}
function captureMediaPlaybackState(media){
    if(!media) return null;
    return {
        currentTime:Number.isFinite(media.currentTime) ? media.currentTime : 0,
        paused:Boolean(media.paused),
        ended:Boolean(media.ended),
        loop:Boolean(media.loop),
        playbackRate:Number.isFinite(media.playbackRate) ? media.playbackRate : 1,
        muted:Boolean(media.muted),
        volume:Number.isFinite(media.volume) ? media.volume : 1
    };
}
function restoreMediaPlaybackState(media, state){
    if(!media || !state) return;
    try { media.playbackRate = state.playbackRate || 1; } catch(e) {}
    try { media.muted = state.muted; } catch(e) {}
    try { media.volume = state.volume; } catch(e) {}
    if(typeof state.loop === 'boolean' && media.tagName?.toLowerCase?.() === 'video') media.loop = state.loop;
    const applyTime = () => {
        if(Number.isFinite(state.currentTime) && state.currentTime >= 0 && Math.abs((media.currentTime || 0) - state.currentTime) > 0.2){
            try { media.currentTime = state.currentTime; } catch(e) {}
        }
        if(!state.paused && typeof media.play === 'function'){
            const playPromise = media.play();
            if(playPromise?.catch) playPromise.catch(() => {});
        }
    };
    if(media.readyState >= 1) applyTime();
    else media.addEventListener('loadedmetadata', applyTime, {once:true});
}
function transplantSmartMediaElements(oldNodeEl, newNodeEl){
    const oldItems = [...(oldNodeEl?.querySelectorAll?.('.thumb-item,.image-wrap') || [])];
    const newItems = [...(newNodeEl?.querySelectorAll?.('.thumb-item,.image-wrap') || [])];
    oldItems.forEach((oldItem, index) => {
        const oldMedia = oldItem.querySelector('video,audio,img.node-img,.thumb-item > img,.media-thumb img');
        if(!oldMedia) return;
        const selector = oldMedia.tagName.toLowerCase();
        const oldUrl = oldMedia.dataset?.url || oldMedia.dataset?.originalSrc || oldMedia.getAttribute('src') || '';
        const oldSignature = oldItem.dataset?.mediaSignature || `${selector}:${oldUrl}`;
        const newItem = newItems.find(item => item.dataset?.mediaSignature === oldSignature)
            || newItems.find(item => item.querySelector?.(selector)?.dataset?.url === oldUrl)
            || newItems.find(item => item.querySelector?.(selector)?.dataset?.originalSrc === oldUrl)
            || newItems.find(item => item.querySelector?.(selector)?.getAttribute?.('src') === oldMedia.getAttribute('src'))
            || newItems[index];
        const newMedia = newItem?.querySelector?.(selector);
        const newUrl = newMedia?.dataset?.url || newMedia?.dataset?.originalSrc || newMedia?.getAttribute?.('src') || '';
        if(!newMedia || oldUrl !== newUrl) return;
        if(selector === 'img'){
            oldMedia.className = newMedia.className;
            oldMedia.draggable = false;
            oldMedia.alt = newMedia.getAttribute('alt') || oldMedia.getAttribute('alt') || '';
            oldMedia.style.cssText = newMedia.style.cssText;
            oldMedia.dataset.originalSrc = newMedia.dataset?.originalSrc || oldMedia.dataset?.originalSrc || '';
            newMedia.replaceWith(oldMedia);
            return;
        }
        const state = captureMediaPlaybackState(oldMedia);
        newMedia.replaceWith(oldMedia);
        restoreMediaPlaybackState(oldMedia, state);
        requestAnimationFrame(() => restoreMediaPlaybackState(oldMedia, state));
    });
}
function reconcileRunTimePill(oldNodeEl, newNodeEl){
    const oldTimer = oldNodeEl?.querySelector?.(':scope > [data-run-timer]');
    const newTimer = newNodeEl?.querySelector?.(':scope > [data-run-timer]');
    if(!oldTimer || !newTimer || oldTimer.tagName !== newTimer.tagName) return null;
    const authoredAttributes = [
        'class', 'kind', 'tone', 'size', 'loading',
        'data-component-name', 'data-run-timer', 'data-run-timer-state',
    ];
    authoredAttributes.forEach(name => {
        if(!newTimer.hasAttribute(name)){
            if(oldTimer.hasAttribute(name)) oldTimer.removeAttribute(name);
            return;
        }
        const value = newTimer.getAttribute(name);
        if(oldTimer.getAttribute(name) !== value) oldTimer.setAttribute(name, value);
    });
    if(oldTimer.textContent !== newTimer.textContent) oldTimer.textContent = newTimer.textContent;
    return {oldTimer, newTimer};
}
function reconcileGenerationPendingNode(oldNodeEl, newNodeEl){
    const oldPending = oldNodeEl?.querySelector?.('ic-generation-pending[data-generation-pending-node]');
    const newPending = newNodeEl?.querySelector?.('ic-generation-pending[data-generation-pending-node]');
    if(!oldPending || !newPending) return false;
    const oldBody = oldPending.closest('.node-body');
    const newBody = newPending.closest('.node-body');
    if(!oldBody || !newBody || oldBody.parentElement !== oldNodeEl || newBody.parentElement !== newNodeEl){
        return false;
    }
    const runTimePill = reconcileRunTimePill(oldNodeEl, newNodeEl);
    [...oldNodeEl.attributes].forEach(attribute => {
        if(!newNodeEl.hasAttribute(attribute.name)) oldNodeEl.removeAttribute(attribute.name);
    });
    [...newNodeEl.attributes].forEach(attribute => oldNodeEl.setAttribute(attribute.name, attribute.value));
    [...oldBody.attributes].forEach(attribute => {
        if(!newBody.hasAttribute(attribute.name)) oldBody.removeAttribute(attribute.name);
    });
    [...newBody.attributes].forEach(attribute => oldBody.setAttribute(attribute.name, attribute.value));
    [...oldPending.attributes].forEach(attribute => {
        if(!newPending.hasAttribute(attribute.name)) oldPending.removeAttribute(attribute.name);
    });
    [...newPending.attributes].forEach(attribute => oldPending.setAttribute(attribute.name, attribute.value));
    [...oldNodeEl.children].forEach(child => {
        if(child !== oldBody && child !== runTimePill?.oldTimer) child.remove();
    });
    let passedBody = false;
    [...newNodeEl.children].forEach(child => {
        if(child === newBody){
            passedBody = true;
            return;
        }
        if(child === runTimePill?.newTimer) return;
        if(passedBody) oldNodeEl.append(child);
        else oldNodeEl.insertBefore(child, oldBody);
    });
    oldNodeEl._smartCanvasRenderSignature = newNodeEl._smartCanvasRenderSignature;
    return true;
}
function captureMediaPlaybackStates(){
    const states = new Map();
    world.querySelectorAll('video[data-url], audio[data-url]').forEach(media => {
        const target = smartPlaybackTargetFromElement(media);
        if(target) states.set(target.key, captureMediaPlaybackState(media));
    });
    return states;
}
function restoreMediaPlaybackStates(states){
    if(!states?.size) return;
    world.querySelectorAll('video[data-url], audio[data-url]').forEach(media => {
        const target = smartPlaybackTargetFromElement(media);
        restoreMediaPlaybackState(media, target ? states.get(target.key) : null);
    });
}
function smartRunTaskLabel(run){
    const s = run?.settings || {};
    if(run?.kind === 'video') return s.videoModel || 'Video';
    if(s.engine === 'comfy'){
        if(s.comfyMode === 'custom') return s.comfyWorkflow || 'ComfyUI';
        const labels = {text:tr('canvas.comfyModeText'), enhance:tr('canvas.comfyModeEnhance'), edit:tr('canvas.comfyModeEdit')};
        return labels[s.comfyMode || 'text'] || 'ComfyUI';
    }
    if(s.engine === 'modelscope'){
        return s.msgenModel === 'custom' ? (s.msCustomModel || 'Modelscope') : (MS_GEN_MODELS[s.msgenModel]?.label || s.msgenModel || 'Modelscope');
    }
    const catalogEntry = smartModelCatalog('image').find(entry =>
        entry.provider_id === s.provider_id && entry.model === s.model
    );
    if(catalogEntry?.name) return catalogEntry.name;
    return s.model || 'API Image';
}
function outputUrlLooksVideo(url){
    return /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/.test(smartOriginalMediaUrl(url).toLowerCase());
}
function proxiedMediaUrl(itemOrUrl, name=''){
    const url = smartOriginalMediaUrl(itemOrUrl);
    if(!url || String(url).startsWith('/assets/') || String(url).startsWith('data:') || String(url).startsWith('blob:')) return url;
    const filename = name || (typeof itemOrUrl === 'object' ? (itemOrUrl.name || '') : '') || fileNameFromUrl(url) || 'preview';
    return `/api/download-output?inline=1&url=${encodeURIComponent(url)}&name=${encodeURIComponent(filename)}`;
}
function displayMediaUrl(itemOrUrl, name=''){
    const url = smartOriginalMediaUrl(itemOrUrl);
    if(/^https?:\/\//i.test(String(url || ''))) return proxiedMediaUrl(itemOrUrl, name);
    return url;
}
function bindImageProxyFallback(imgEl, itemOrUrl){
    if(!imgEl || imgEl.dataset.proxyFallbackBound === '1') return;
    imgEl.dataset.proxyFallbackBound = '1';
    imgEl.addEventListener('error', () => {
        if(imgEl.dataset.proxyFallbackTried === '1') return;
        const fallback = proxiedMediaUrl(itemOrUrl);
        if(!fallback || fallback === imgEl.getAttribute('src')) return;
        imgEl.dataset.proxyFallbackTried = '1';
        imgEl.src = fallback;
    });
}
function safeExportFileName(name, fallback='download.zip'){
    const cleaned = String(name || fallback).replace(/[\\/:*?"<>|]+/g, '_').trim();
    return cleaned || fallback;
}
function fileNameFromUrl(url=''){
    try {
        const parsed = new URL(String(url || ''), window.location.href);
        return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    } catch(e) {
        return decodeURIComponent(String(url || '').split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || '');
    }
}
function extensionForMediaItem(item, fallback='.png'){
    const source = [item?.name, item?.url].map(value => String(value || '').split('?')[0].split('#')[0]).find(value => /\.[a-z0-9]{2,8}$/i.test(value));
    if(source) return source.match(/(\.[a-z0-9]{2,8})$/i)?.[1] || fallback;
    const kind = mediaKindForItem(item);
    if(kind === 'video') return '.mp4';
    if(kind === 'audio') return '.mp3';
    if(kind === 'text') return '.txt';
    return fallback;
}
function downloadNameForMediaItem(item, fallbackPrefix='canvas-output'){
    const localName = fileNameFromUrl(item?.url || '');
    const preferred = localName || item?.name || '';
    const ext = extensionForMediaItem(item);
    const randomName = `${fallbackPrefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}${ext}`;
    let name = safeExportFileName(preferred || randomName, randomName);
    if(!/\.[a-z0-9]{2,8}$/i.test(name)) name += ext;
    return name;
}
function downloadPreviewImage(){
    const node = nodes.find(n => n.id === previewNavState.nodeId);
    const image = node?.images?.[previewNavState.index];
    if(!image?.url) return;
    const name = downloadNameForMediaItem(image, 'image');
    const link = document.createElement('a');
    link.href = `/api/download-output?url=${encodeURIComponent(image.url)}&name=${encodeURIComponent(name)}`;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
}
function downloadPreviewFile(item){
    if(!item?.url) return;
    const name = downloadNameForMediaItem(item, 'output');
    const link = document.createElement('a');
    link.href = `/api/download-output?url=${encodeURIComponent(item.url)}&name=${encodeURIComponent(name)}`;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
}
function previewDownloadGroupItems(){
    // 分组预览：整组所有成员图片按阅读顺序打包。
    if(previewNavState.groupId){
        const group = nodes.find(n => n.id === previewNavState.groupId && smartContainer.isGroup(n));
        if(group) return smartContainer.imageRefs(group).map((r, index) => ({...r.item, __index:index}));
    }
    const node = nodes.find(n => n.id === previewNavState.nodeId);
    return (node?.images || [])
        .filter(item => item?.url)
        .map((item, index) => ({...item, __index:index}))
        .sort((a, b) => {
            const ga = a.grid || {};
            const gb = b.grid || {};
            const rowDiff = Number(ga.row ?? a.__index) - Number(gb.row ?? b.__index);
            if(rowDiff) return rowDiff;
            const colDiff = Number(ga.col ?? a.__index) - Number(gb.col ?? b.__index);
            return colDiff || a.__index - b.__index;
        });
}
// 把一组图片打包成 zip 下载（预览“下载全部”和分组小菜单“批量下载”共用）。
async function zipDownloadImageItems(title, items){
    const list = (items || []).filter(item => item?.url);
    if(!list.length) return;
    try {
        const filename = safeExportFileName(`${title || 'image-group'}.zip`, 'image-group.zip');
        const response = await fetch('/api/canvas-assets/download', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                filename,
                urls:list.map(item => item.url).filter(Boolean),
                items:list.map((item, index) => ({url:item.url, name:downloadNameForMediaItem(item, `image-${String(index + 1).padStart(2, '0')}`)}))
            })
        });
        if(!response.ok) throw new Error((await response.text()) || tr('smart.batchDownloadFailed'));
        const blob = await response.blob();
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1200);
    } catch(e) {
        toast((e.message || tr('smart.batchDownloadFailed')).slice(0, 160));
    }
}
async function downloadPreviewGroup(){
    const group = previewNavState.groupId ? nodes.find(n => n.id === previewNavState.groupId) : null;
    const owner = group || nodes.find(n => n.id === previewNavState.nodeId);
    return zipDownloadImageItems(owner?.title, previewDownloadGroupItems());
}
function downloadSmartGroupImages(group){
    if(!smartContainer.isGroup(group)) return;
    return zipDownloadImageItems(group?.title, smartContainer.imageRefs(group).map(r => r.item));
}
function smartRunPlatformLabel(run){
    const s = run?.settings || {};
    if(s.engine === 'comfy') return 'ComfyUI';
    if(s.engine === 'modelscope') return 'Modelscope';
    if(run?.kind === 'video') return videoProviderById(s.videoProvider || '')?.name || s.videoProvider || 'Video';
    return apiProviderById(s.provider_id || '')?.name || s.provider_id || 'API';
}
function smartRunRequestMeta(run){
    const s = run?.settings || {};
    if(s.engine === 'comfy') return {workflow_json:s.comfyWorkflow || '', mode:s.comfyMode || 'text'};
    if(s.engine === 'modelscope') return {backend:'Modelscope', model:s.msgenModel || '', custom_model:s.msCustomModel || ''};
    if(run?.kind === 'video') return {provider_id:s.videoProvider || '', model:s.videoModel || '', duration:s.videoDuration || '', aspect_ratio:s.videoAspect || '', resolution:s.videoResolution || ''};
    return {provider_id:s.provider_id || '', model:s.model || '', size:run?.size || '', quality:s.quality || '', n:s.count || 1};
}
function smartRunSnapshot(node, prompt, refs=[], kind='image', sourceSettings=settings){
    const settingsSnapshot = cloneSmartSettings(sourceSettings || settings);
    return {
        generationRunId:uid('generation-run'),
        nodeId:node?.id || '',
        nodeType:node?.type || 'smart-image',
        kind,
        settings:settingsSnapshot,
        prompt:prompt || '',
        refs:(refs || []).map(inputReferenceSnapshot).filter(ref => ref.url),
        size: kind === 'image' && isApiLikeEngine(settingsSnapshot.engine) ? sizeForRun(settingsSnapshot) : ''
    };
}
let smartCanvasLogsHydrated = false;
function normalizePersistedSmartCanvasLog(log={}){
    const normalized = {...log};
    normalized.generationRunId = normalized.generationRunId || normalized.runId || '';
    normalized.runMs = Number(normalized.runMs ?? normalized.durationMs ?? 0);
    normalized.createdAt = Number(normalized.createdAt ?? normalized.created_at ?? 0);
    normalized.error = normalized.error || normalized.errorSummary || '';
    normalized.outputs = Array.isArray(normalized.outputs) ? normalized.outputs : [];
    normalized.refs = Array.isArray(normalized.refs) ? normalized.refs : [];
    normalized.tasks = Array.isArray(normalized.tasks) ? normalized.tasks : [];
    return normalized;
}
function persistSmartCanvasLog(log={}){
    if(!canvasId || !log?.id) return Promise.resolve(null);
    const payload = {
        ...log,
        runId:log.generationRunId || log.runId || '',
        durationMs:Number(log.runMs ?? log.durationMs ?? 0),
    };
    return fetch(`/api/canvases/${encodeURIComponent(canvasId)}/logs`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload),
        keepalive:true,
    }).then(async response => {
        if(!response.ok) throw new Error(`Generation history ${response.status}`);
        return response.json();
    }).catch(error => {
        console.warn('Unable to persist Smart Canvas generation history', error);
        return null;
    });
}
async function loadSmartCanvasLogs({force=false}={}){
    if(!canvasId || !canvas) return [];
    if(smartCanvasLogsHydrated && !force) return canvas.logs || [];
    try {
        const response = await fetch(
            `/api/canvases/${encodeURIComponent(canvasId)}/logs?limit=50`
        );
        if(!response.ok) throw new Error(`Generation history ${response.status}`);
        const data = await response.json();
        const localLogs = Array.isArray(canvas.logs) ? canvas.logs : [];
        const persistedLogs = (Array.isArray(data.logs) ? data.logs : [])
            .map(normalizePersistedSmartCanvasLog);
        const seen = new Set();
        canvas.logs = [...localLogs, ...persistedLogs]
            .sort((left, right) => Number(right?.createdAt || 0) - Number(left?.createdAt || 0))
            .filter(log => {
                const key = String(log?.generationRunId || log?.runId || log?.id || '');
                if(key && seen.has(key)) return false;
                if(key) seen.add(key);
                return true;
            })
            .slice(0, 500);
        smartCanvasLogsHydrated = true;
    } catch(error){
        console.warn('Unable to load persisted Smart Canvas generation history', error);
        canvas.logs = Array.isArray(canvas.logs) ? canvas.logs : [];
    }
    return canvas.logs;
}
function addSmartGenerationLog({run, outputs=[], runMs=0, error='', status='', tasks=[], diagnostics=null}) {
    if(!canvas) return;
    canvas.logs = canvas.logs || [];
    const outputItems = resultMediaUrls(outputs).map(item => {
        if(typeof item === 'string') return {url:item};
        if(!item || typeof item !== 'object') return null;
        const url = item.url || item.path || item.src || item.uri || '';
        if(!url) return null;
        return copyMediaSizeFields(item, {
            url,
            kind:item.kind || item.type || item.mediaKind || '',
            name:item.name || item.filename || ''
        });
    }).filter(item => item?.url);
    if(!error && outputItems.length) playGenerationCompleteSound();
    const normalizedTasks = (tasks || []).length
        ? tasks.map((task, index) => ({...task, index:Number(task?.index ?? index)}))
        : [{
            index:0,
            localTaskId:'',
            upstreamTaskId:'',
            status:error ? 'failed' : 'succeeded',
            runMs:Number(runMs || 0),
            ...(error ? {technicalError:String(error)} : {})
        }];
    const aggregate = generationFailureFeedback.aggregate(normalizedTasks, tr, trf);
    const entryStatus = status || aggregate.status || (error ? 'failed' : 'success');
    const primaryError = normalizedTasks.find(task => task.status === 'failed') || null;
    const errorDetail = primaryError
        ? generationFailureFeedback.classify(primaryError.errorDetail || primaryError)
        : null;
    const safeDiagnostics = diagnostics && typeof diagnostics === 'object'
        ? generationFailureFeedback.safeObject(diagnostics)
        : null;
    const entry = {
        id:uid('log'),
        generationRunId:run?.generationRunId || safeDiagnostics?.generation_run_id || '',
        version:safeDiagnostics?.application_version || '',
        createdAt:Date.now(),
        status:entryStatus,
        platform:smartRunPlatformLabel(run),
        nodeId:run?.nodeId || '',
        nodeType:run?.nodeType || 'smart-image',
        model:smartRunTaskLabel(run),
        request:smartRunRequestMeta(run),
        prompt:run?.prompt || '',
        outputs:outputItems,
        refs:run?.refs || [],
        runMs:Number(runMs || 0),
        successfulCount:aggregate.successfulCount,
        failedCount:aggregate.failedCount,
        totalCount:aggregate.totalCount,
        tasks:aggregate.tasks,
        error:error ? String(error) : (errorDetail?.technicalError || ''),
        errorDetail,
        requestHash:safeDiagnostics?.request_fingerprint || '',
        recoverable:Boolean(safeDiagnostics?.recoverable),
        diagnostics:safeDiagnostics,
    };
    canvas.logs = [entry, ...canvas.logs].slice(0, 500);
    void persistSmartCanvasLog(entry);
    if(!error && recoverStuckLoopOutputsFromLogs()) render();
    return entry;
}
const SMART_LOG_PREVIEW_NODE_ID = '__smart_log_preview__';
let smartLogPreviewRestore = null;
function smartLogOutputItem(output){
    if(typeof output === 'string') return {url:output};
    if(!output || typeof output !== 'object') return null;
    const url = output.url || output.path || output.src || output.uri || '';
    if(!url) return null;
    return copyMediaSizeFields(output, {
        url,
        kind:output.kind || output.type || output.mediaKind || '',
        name:output.name || output.filename || ''
    });
}
function normalizedSizeLabel(value){
    const parsed = parseSizeValue(value);
    const w = Number(parsed?.width || 0);
    const h = Number(parsed?.height || 0);
    return w > 0 && h > 0 ? `${Math.round(w)} x ${Math.round(h)}` : '';
}
function smartLogSizeSummary(log, outputs=[]){
    const req = log?.request || {};
    const requestLabel = normalizedSizeLabel(req.size || req.resolution || '');
    const actualLabels = [...new Set(outputs.map(imageResolutionLabel).filter(Boolean))];
    if(!actualLabels.length) return '';
    const actualText = actualLabels.slice(0, 3).join(', ');
    const more = actualLabels.length > 3 ? ` +${actualLabels.length - 3}` : '';
    const actualLabel = `${actualText}${more}`;
    if(requestLabel && actualLabels.some(label => label !== requestLabel)){
        return trf('smart.requestActual', {requested: requestLabel, actual: actualLabel});
    }
    return trf('smart.actual', {actual: actualLabel});
}
// 移除临时预览节点并还原选中态。供 closeImageEditor 调用。
function cleanupSmartLogPreviewNode(){
    if(nodes.some(n => n.id === SMART_LOG_PREVIEW_NODE_ID)) nodes = nodes.filter(n => n.id !== SMART_LOG_PREVIEW_NODE_ID);
    if(smartLogPreviewRestore){
        selectedId = smartLogPreviewRestore.selectedId;
        selectedImage = smartLogPreviewRestore.selectedImage;
        smartLogPreviewRestore = null;
    }
}
function closeSmartLogLightbox(){
    const box = document.getElementById('smartLogLightbox');
    if(!box) return;
    box.classList.remove('open');
    const img = box.querySelector('img');
    if(img){ img.onerror = null; img.removeAttribute('src'); }
}
// 日志缩略图的轻量预览：只弹一张大图（不进编辑器那套裁剪/涂抹的重组件），点背景或关闭按钮即关。
function openSmartLogLightbox(url, kind='image'){
    if(!url) return;
    if(kind === 'video' || outputUrlLooksVideo(url)){ window.open(displayMediaUrl({url}), '_blank'); return; }
    let box = document.getElementById('smartLogLightbox');
    if(!box){
        box = document.createElement('div');
        box.id = 'smartLogLightbox';
        box.className = 'smart-log-lightbox';
        box.innerHTML = `<img alt="preview" draggable="false"><button class="smart-log-lightbox-close" type="button" aria-label="${escapeAttr(tr('common.close'))}"><i data-lucide="x"></i></button>`;
        document.body.appendChild(box);
        box.addEventListener('click', e => {
            if(e.target === box || e.target.closest('.smart-log-lightbox-close')) closeSmartLogLightbox();
        });
    }
    const img = box.querySelector('img');
    img.onerror = null;
    img.src = displayMediaUrl({url});
    box.classList.add('open');
    refreshIcons();
}
function smartLogPreviewNode(url, kind='image'){
    openSmartLogLightbox(url, kind);
}
function renderSmartCanvasLog(){
    if(smartGenerationLogModal){
        smartGenerationLogModal.render();
        return;
    }
    const logs = canvas?.logs || [];
    smartLogList.innerHTML = logs.length ? logs.map(log => {
        const outputs = (log.outputs || []).map(smartLogOutputItem).filter(item => item?.url);
        const thumbs = outputs.slice(0, 8).map(item => {
            const safe = escapeAttr(item.url);
            const kind = item.kind || (outputUrlLooksVideo(item.url) ? 'video' : 'image');
            const label = imageResolutionLabel(item);
            const attrs = `data-url="${safe}" data-kind="${escapeAttr(kind)}" title="${escapeAttr(label || 'output')}" alt="output"`;
            return kind === 'video' ? smartVideoPreviewHtml(item, 256, attrs) : smartPreviewImgHtml(item, 256, attrs);
        }).join('');
        const date = new Date(log.createdAt || Date.now()).toLocaleString(window.StudioI18n?.lang() === 'en' ? 'en-US' : 'zh-CN');
        const req = log.request || {};
        const taskId = req.task_id || req.taskId || req.prompt_id || req.promptId || '';
        const backend = req.workflow_json || req.workflow || req.provider_id || req.providerId || req.backend || '';
        const sizeSummary = smartLogSizeSummary(log, outputs);
        const legacyTasks = (log.tasks || []).length ? log.tasks : [{
            status:log.status === 'failed' ? 'failed' : 'succeeded',
            technicalError:log.error || '',
            runMs:Number(log.runMs || 0),
        }];
        const aggregate = generationFailureFeedback.aggregate(legacyTasks, tr, trf);
        const runStatus = log.status === 'partial' ? 'partial'
            : log.status === 'failed' ? 'failed'
            : aggregate.status;
        const errorDetail = log.errorDetail
            ? generationFailureFeedback.localize(log.errorDetail, tr)
            : log.error
                ? generationFailureFeedback.localize({
                    ...generationFailureFeedback.classify(log.error),
                }, tr)
                : null;
        const statusLabel = tr(`smart.runStatus.${runStatus}`);
        const countLabel = trf('smart.runCounts', {
            success:Number(log.successfulCount ?? aggregate.successfulCount),
            failed:Number(log.failedCount ?? aggregate.failedCount),
            total:Number(log.totalCount ?? aggregate.totalCount),
        });
        const taskDetails = legacyTasks.length ? `<details class="log-task-details">
            <summary>${escapeHtml(trf('smart.subtaskDetails', {count:legacyTasks.length}))}</summary>
            <div class="log-task-list">${legacyTasks.map((task, index) => {
                const failed = task.status === 'failed';
                const detail = failed ? generationFailureFeedback.localize(task.error || generationFailureFeedback.classify(task), tr) : null;
                const upstreamTaskId = task.upstreamTaskId || task.upstream_task_id || '';
                return `<div class="log-task-row ${failed ? 'failed' : ''}">
                    <div><strong>#${index + 1} · ${escapeHtml(tr(`smart.taskStatus.${failed ? 'failed' : 'succeeded'}`))}</strong><span>${escapeHtml(formatRunDuration(task.runMs || 0))}</span></div>
                    ${upstreamTaskId ? `<code>${escapeHtml(upstreamTaskId)}</code>` : ''}
                    ${detail ? `<p>${escapeHtml(detail.title)} · ${escapeHtml(detail.description)}</p>` : ''}
                </div>`;
            }).join('')}</div>
        </details>` : '';
        const technicalDetails = errorDetail ? `<details class="log-technical-details">
            <summary>${escapeHtml(tr('smart.technicalDetails'))}</summary>
            <pre>${escapeHtml(generationFailureFeedback.safeText(errorDetail.technicalError || log.error || ''))}</pre>
        </details>` : '';
        const subParts = [
            date,
            countLabel,
            sizeSummary,
            taskId ? `ID ${taskId}` : '',
            backend
        ].filter(Boolean);
        return `<div class="log-item ${runStatus === 'failed' ? 'failed' : runStatus === 'partial' ? 'partial' : ''}" data-log-id="${escapeAttr(log.id || '')}" data-generation-run-id="${escapeAttr(log.generationRunId || log.runId || '')}">
            <div class="log-main">
                <div class="log-meta">
                    <span class="log-chip ${runStatus === 'success' ? 'status-ok' : 'status-failed'}">${escapeHtml(statusLabel)}</span>
                    <span class="log-chip">${escapeHtml(log.platform || '-')}</span>
                    ${log.model ? `<span class="log-chip">${escapeHtml(log.model)}</span>` : ''}
                    <span class="log-chip">${escapeHtml(formatRunDuration(log.runMs || 0))}</span>
                </div>
                <div class="log-subline">${subParts.map(part => `<span title="${escapeAttr(part)}">${escapeHtml(part)}</span>`).join('')}</div>
                ${errorDetail ? `<div class="log-error-message"><strong>${escapeHtml(errorDetail.title)}</strong><span>${escapeHtml(errorDetail.description)}</span><em>${escapeHtml(errorDetail.action)}</em></div>` : ''}
                <div class="log-prompt" title="${escapeAttr(log.prompt || tr('canvas.noPromptMeta'))}" data-prompt="${escapeAttr(log.prompt || '')}">${escapeHtml(log.prompt || tr('canvas.noPromptMeta'))}</div>
                <div class="log-request-meta"><span>${escapeHtml(tr('smart.diagnosticParameters'))}</span><code>${escapeHtml(JSON.stringify(generationFailureFeedback.safeObject(log.request || {})))}</code></div>
                ${taskDetails}
                ${technicalDetails}
                <button class="log-copy-diagnostic" type="button" data-diagnostic-log="${escapeAttr(log.id || '')}"><i data-lucide="copy"></i><span>${escapeHtml(tr('smart.copyDiagnostics'))}</span></button>
            </div>
            <div class="log-thumbs">${thumbs}</div>
        </div>`;
    }).join('') : `<div class="log-empty">${escapeHtml(tr('canvas.noLogs'))}</div>`;
    bindSmartPreviewImageFallbacks(smartLogList);
    smartLogList.querySelectorAll('[data-url]').forEach(el => {
        el.onclick = e => {
            e.stopPropagation();
            smartLogPreviewNode(el.dataset.url, el.dataset.kind || 'image');
        };
    });
    const bindLogCopy = (selector, key) => {
        smartLogList.querySelectorAll(selector).forEach(el => {
            el.onclick = async e => {
                e.stopPropagation();
                const text = el.dataset[key] || '';
                const copied = await copyTextToClipboard(text);
                const oldText = el.textContent;
                el.textContent = copied ? tr('canvas.copied') : tr('canvas.copyFailed');
                if(copied) el.classList.add('copied');
                setTimeout(() => {
                    el.textContent = oldText;
                    el.classList.remove('copied');
                }, 900);
            };
        });
    };
    bindLogCopy('[data-prompt]', 'prompt');
    smartLogList.querySelectorAll('[data-diagnostic-log]').forEach(button => {
        button.onclick = async event => {
            event.stopPropagation();
            const log = logs.find(item => item.id === button.dataset.diagnosticLog);
            if(!log) return;
            let appVersion = String(log.version || window.__IC_VERSION || document.documentElement.dataset.version || '');
            if(!appVersion){
                try {
                    const info = await fetch('/api/app-info', {cache:'no-store'}).then(response => response.ok ? response.json() : {});
                    appVersion = String(info.version || '');
                } catch(error){}
            }
            const copied = await copyTextToClipboard(generationFailureFeedback.diagnosticReport(log, {
                translate:tr,
                format:trf,
                version:appVersion,
                language:window.StudioI18n?.lang?.() || '',
            }));
            toast(
                copied ? tr('smart.diagnosticsCopied') : tr('canvas.copyFailed'),
                {tone:copied ? 'success' : 'danger'},
            );
        };
    });
    refreshIcons();
}
async function openSmartCanvasLog(logId='', generationRunId=''){
    if(!canvas) return;
    await loadSmartCanvasLogs();
    deactivateSmartAnnotationTool();
    smartGenerationLogModal.select(logId, generationRunId);
    smartGenerationLogModal.beforeOpen();
    await smartLogModal.show();
    if(smartLogModal.hasAttribute('open')) smartGenerationLogModal.afterOpen();
}
function closeSmartCanvasLog(){
    if(!smartLogModal?.hasAttribute('open')) return;
    void smartLogModal.hide('programmatic');
}
let smartCanvasTaskDialogController = null;
function importedNodeBounds(ids){
    const rects = (ids || []).map(id => nodes.find(node => node.id === id)).filter(Boolean).map(nodeRect);
    if(!rects.length) return null;
    const left = Math.min(...rects.map(rect => rect.x));
    const top = Math.min(...rects.map(rect => rect.y));
    const right = Math.max(...rects.map(rect => rect.x + rect.width));
    const bottom = Math.max(...rects.map(rect => rect.y + rect.height));
    return {x:left,y:top,width:Math.max(1,right-left),height:Math.max(1,bottom-top)};
}
function smartCanvasTaskDialogs(){
    if(smartCanvasTaskDialogController) return smartCanvasTaskDialogController;
    const taskModals = window.SmartCanvasModules?.taskModals;
    if(!taskModals) throw new Error('Smart Canvas task modal module failed to load');
    smartCanvasTaskDialogController = taskModals.create({
        shortcutDialog:smartShortcutDialog,
        shortcutTrigger:smartShortcutSettingsAction,
        importDialog:smartNodePackageImportDialog,
        importLauncher:null,
        fileInput:smartNodeImportInput,
        translate:tr,
        format:trf,
        platform:shortcutPlatform,
        loadNodePackageLimits,
        beforeShortcutOpen(){
            deactivateSmartAnnotationTool();
        },
        beforeImportOpen(){
            deactivateSmartAnnotationTool();
            deactivateSmartFrameTool();
        },
        inspectFile:inspectSmartNodePackageFile,
        importFile:commitSmartNodePackageFile,
        locateImported(ids){
            window.SmartCanvasModules.viewportSelection.viewport.reveal(importedNodeBounds(ids),{padding:80});
            shell.focus({preventScroll:true});
        },
    });
    return smartCanvasTaskDialogController;
}
function openSmartCanvasShortcuts(){
    return smartCanvasTaskDialogs().openShortcuts();
}
function closeSmartCanvasShortcuts(){
    return smartCanvasTaskDialogs().closeShortcuts('programmatic');
}
function openSmartNodePackageImportDialog(file=null){
    if(!canvas){ toast(tr('smart.openCanvasFirst')); return; }
    return smartCanvasTaskDialogs().openImport(file);
}
function structuredPromptEditorHtml(storedHtml='', fallbackText=''){
    const stored = String(storedHtml || '');
    if(!stored) return escapeHtml(fallbackText || '');
    const source = document.createElement('template');
    source.innerHTML = stored;
    const serialize = item => {
        if(item.nodeType === Node.TEXT_NODE) return escapeHtml(item.textContent || '');
        if(item.nodeType !== Node.ELEMENT_NODE) return '';
        // Historical canvases stored Prompt Templates as non-editable tokens.
        // Expand their frozen text snapshot while sanitizing the saved HTML.
        if(item.classList.contains('prompt-template-token')){
            return escapeHtml(item.dataset.promptText || '');
        }
        if(item.tagName === 'BR') return '<br>';
        const children = [...item.childNodes].map(serialize).join('');
        return ['DIV','P'].includes(item.tagName) ? `<div>${children}</div>` : children;
    };
    return [...source.content.childNodes].map(serialize).join('');
}
function promptNodeEditorHtml(node){
    return structuredPromptEditorHtml(node?.textHtml, node?.text);
}
function promptLlmInstructionEditorHtml(node){
    return structuredPromptEditorHtml(
        node?.llmInstructionHtml,
        node?.llmInstruction || node?.text || ''
    );
}
function syncPromptNodeEditor(node, editor){
    if(!node || !editor) return;
    const rawHtml = String(editor.innerHTML || '');
    node.textHtml = /^(?:<br>|<div><br><\/div>)$/i.test(rawHtml.trim()) ? '' : rawHtml;
    node.text = promptAuthoring.plainText(editor);
    refreshAllSplitterNodePreviews();
    canvasPersistence.schedule();
}
function syncPromptLlmInstructionEditor(node, editor){
    if(!node || !editor) return;
    const rawHtml = String(editor.innerHTML || '');
    node.llmInstructionHtml = /^(?:<br>|<div><br><\/div>)$/i.test(rawHtml.trim())
        ? ''
        : rawHtml;
    node.llmInstruction = promptAuthoring.plainText(editor);
    canvasPersistence.schedule();
}
let promptCharacterCountId = 0;
function syncPromptCharacterCount(editor){
    const counter = editor?.closest?.('.prompt-editor-shell')
        ?.querySelector?.('[data-prompt-character-count]');
    if(!editor || !counter) return 0;
    const count = promptAuthoring.characterCount(promptAuthoring.characterText(editor));
    counter.dataset.characterCount = String(count);
    counter.textContent = trf('smart.characterCount', {count});
    return count;
}
function bindPromptCharacterCount(editor){
    if(!editor) return;
    const counter = editor.closest?.('.prompt-editor-shell')
        ?.querySelector?.('[data-prompt-character-count]');
    if(!counter) return;
    if(!counter.id) counter.id = `prompt-character-count-${++promptCharacterCountId}`;
    const describedBy = new Set(
        String(editor.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
    );
    describedBy.add(counter.id);
    editor.setAttribute('aria-describedby', [...describedBy].join(' '));
    if(!editor._promptCharacterCountBound){
        editor._promptCharacterCountBound = true;
        editor.addEventListener('input', () => syncPromptCharacterCount(editor));
        const observer = new MutationObserver(() => syncPromptCharacterCount(editor));
        observer.observe(editor, {childList:true, subtree:true, characterData:true});
        editor._promptCharacterCountObserver = observer;
    }
    syncPromptCharacterCount(editor);
}
function generationPendingNodeKind(node){
    if(node?.textGenerationPending || node?.textGenerationOutput) return 'text';
    const kind = String(
        node?.outputKind
        || node?.jimengPending?.kind
        || node?.runSettings?.outputKind
        || node?.runSettings?.apiKind
        || ''
    ).toLowerCase();
    return ['video','text'].includes(kind) ? kind : 'image';
}
function generationPendingNodeLabel(kind, state, count=1){
    if(state === 'queued'){
        if(kind === 'video') return tr('smart.videoWaitingGeneration');
        if(kind === 'text') return tr('smart.textWaitingGeneration');
        return tr('smart.imageWaitingGeneration');
    }
    if(kind === 'video') return tr('smart.videoGenerating');
    if(kind === 'text') return tr('smart.textGenerating');
    return count > 1
        ? trf('smart.generatingCount', {count})
        : tr('smart.imageGenerating');
}
function generationPendingNodeElapsed(node){
    return node?.runStartedAt ? formatRunDuration(nodeRunElapsedMs(node)) : '';
}
function generationPendingNodeHtml({kind='image',state='generating',count=1,label='',description='',elapsed=''}={}){
    const safeKind = ['image','video','text'].includes(kind) ? kind : 'image';
    const safeState = state === 'queued' ? 'queued' : 'generating';
    const safeCount = Math.max(1, Number(count) || 1);
    const accessibleLabel = label || generationPendingNodeLabel(safeKind, safeState, safeCount);
    const descriptionAttribute = description
        ? ` description="${escapeAttr(description)}"`
        : '';
    const elapsedAttribute = String(elapsed || '').trim()
        ? ` elapsed="${escapeAttr(elapsed)}"`
        : '';
    return `<ic-generation-pending data-generation-pending-node kind="${escapeAttr(safeKind)}" state="${escapeAttr(safeState)}" count="${safeCount}" label="${escapeAttr(accessibleLabel)}"${descriptionAttribute}${elapsedAttribute}></ic-generation-pending>`;
}
function generationRecoveryNodeHtml({nodeId='',taskId='',targetKind='jimeng',kind='image',state='recoverable',title='',description='',actionLabel='',width=null,height=null}={}){
    const targetAttributes = targetKind === 'image'
        ? `data-image-task-query="${escapeAttr(nodeId)}" data-task-id="${escapeAttr(taskId)}"`
        : `data-jimeng-query="${escapeAttr(nodeId)}"`;
    const safeKind = ['image','video','text'].includes(kind) ? kind : 'image';
    const safeState = ['queued','recoverable','querying'].includes(state) ? state : 'recoverable';
    const dimensions = width !== null && width !== undefined && width !== ''
        && height !== null && height !== undefined && height !== ''
        && Number.isFinite(Number(width)) && Number.isFinite(Number(height))
        ? ` style="width:${Math.max(1, Number(width))}px;height:${Math.max(1, Number(height))}px"`
        : '';
    return `<ic-generation-recovery data-generation-recovery-node ${targetAttributes} kind="${escapeAttr(safeKind)}" state="${escapeAttr(safeState)}" title="${escapeAttr(title)}" description="${escapeAttr(description)}" action-label="${escapeAttr(actionLabel)}"${dimensions}></ic-generation-recovery>`;
}
function composerRunButtonHtml({className='',disabled=false}={}){
    const classes = `${className} run-btn`.trim();
    return `<ic-icon-button class="${escapeAttr(classes)}" type="button" size="large" hierarchy="primary" icon="submit" label="${escapeAttr(tr('smart.run'))}" tooltip-placement="block-start" data-action-combination="primary-icon-action"${disabled ? ' disabled' : ''}></ic-icon-button>`;
}
function promptNodeModelSelectHtml(node){
    const entries = smartModelCatalog('text');
    const current = smartCatalogEntry('text', node?.llmProvider || '', node?.llmModel || '');
    const options = entries.length
        ? entries.map(entry => `<option value="${escapeAttr(entry.id)}" ${smartModelVendorOptionAttributes(entry.model, entry.provider_id, entry.provider_name)} ${entry.id === current?.id ? 'selected' : ''}>${escapeHtml(entry.name || entry.model || tr('smart.model'))}</option>`).join('')
        : `<option value="__no_model__" selected disabled>${escapeHtml(tr('smart.model'))}</option>`;
    return `<ic-select class="prompt-node-control prompt-llm-model catalog-model-select" name="prompt-llm-model-${escapeAttr(node?.id || 'node')}" aria-label="${escapeAttr(tr('smart.model'))}" hierarchy="quiet" placement="top" data-component-variant="model-picker" data-legal-combination="model-picker-vertical-manual-label"${entries.length ? '' : ' disabled'}>
        ${options}
        <span slot="start" aria-hidden="true">${smartModelVendorIconMarkup(current?.model || '', current?.provider_id || '', current?.provider_name || '')}</span>
        <ic-icon name="expand" size="small" slot="expand-icon" aria-hidden="true"></ic-icon>
    </ic-select>`;
}
function promptEditorShellHtml(editorHtml=''){
    return `<div class="prompt-editor-shell">
        ${editorHtml}
        <span class="prompt-character-count" data-prompt-character-count>${escapeHtml(trf('smart.characterCount', {count:0}))}</span>
    </div>`;
}
function promptNodeBodyHtml(node){
    if(generationNodeHasFailedRun(node)) return generationFailureTargetHtml(node);
    const textEntry = smartCatalogEntry('text', node.llmProvider || '', node.llmModel || '');
    node.llmProvider = textEntry?.provider_id || resolveChatProviderId(node.llmProvider || '');
    node.llmModel = textEntry?.model || resolveChatModel(node.llmModel || '', node.llmProvider);
    if(node.textGenerationPending){
        return `<div class="prompt-node-card prompt-text-generation-card">
            ${generationPendingNodeHtml({kind:'text',state:'generating',count:1,label:tr('smart.textGenerating'),elapsed:generationPendingNodeElapsed(node)})}
        </div>`;
    }
    if(node.llmEnabled){
        const inputThumbs = promptNodeInputThumbsHtml(node);
        const upstreamPromptItems = promptNodeUpstreamPromptItems(node);
        const upstreamPromptHtml = upstreamPromptItems.length ? `<div class="prompt-node-upstream">
            <div class="prompt-node-section-title">${escapeHtml(tr('smart.referencedText'))}</div>
            <div class="prompt-node-upstream-list">${upstreamPromptItems.map((item, index) => `<div class="prompt-node-segment"><span>${index + 1}</span><p>${escapeHtml(item)}</p></div>`).join('')}</div>
        </div>` : '';
        return `<div class="prompt-node-card prompt-node-composer">
            ${inputThumbs}
            ${upstreamPromptHtml}
            ${promptEditorShellHtml(`<ic-prompt-composer class="prompt-node-control prompt-llm-instruction" contenteditable="false" spellcheck="false" data-node-id="${escapeAttr(node.id)}" data-placeholder="${escapeAttr(tr('smart.promptLlmInstructionPlaceholder'))}" aria-label="${escapeAttr(tr('smart.promptLlmInstructionPlaceholder'))}">${promptLlmInstructionEditorHtml(node)}</ic-prompt-composer>`)}
            <div class="prompt-composer-footer">
                ${promptNodeModelSelectHtml(node)}
                ${composerRunButtonHtml({className:'prompt-node-run prompt-node-control'})}
            </div>
        </div>`;
    }
    const inputThumbs = promptNodeInputThumbsHtml(node);
    return `<div class="prompt-node-card">
        ${inputThumbs}
        ${promptEditorShellHtml(`<ic-prompt-composer class="prompt-node-text prompt-node-control" contenteditable="false" spellcheck="false" data-node-id="${escapeAttr(node.id)}" data-placeholder="${escapeAttr(tr('smart.promptPlaceholderNode'))}" aria-label="${escapeAttr(tr('smart.editTextAria'))}">${promptNodeEditorHtml(node)}</ic-prompt-composer>`)}
    </div>`;
}
function splitterNodeBodyHtml(node){
    const items = splitterNodePromptItems(node);
    const preview = items.length
        ? `<div class="prompt-node-segments">${items.map((item, index) => `<div class="prompt-node-segment"><span>${index + 1}</span><p>${escapeHtml(item)}</p></div>`).join('')}</div>`
        : `<div class="splitter-node-empty">${escapeHtml(tr('smart.splitterEmpty'))}</div>`;
    return `<div class="splitter-node-card">
        <div class="splitter-node-head">
            <span class="splitter-node-label">${escapeHtml(tr('smart.separator'))}</span>
            <ic-input class="splitter-node-separator" name="splitter-separator-${escapeAttr(node.id)}" type="text" size="small" aria-label="${escapeAttr(tr('smart.separator'))}" maxlength="8" value="${escapeAttr(splitterNodeSeparator(node))}" placeholder=";"></ic-input>
            <ic-badge class="splitter-node-count" kind="count" tone="neutral">${escapeHtml(trf('smart.segmentCount', {count: items.length}))}</ic-badge>
        </div>
        <div class="splitter-node-preview">${preview}</div>
    </div>`;
}
function refreshSplitterNodePreview(node){
    const el = world.querySelector(`.image-node[data-id="${CSS.escape(node.id)}"]`);
    if(!el) return;
    const items = splitterNodePromptItems(node);
    const count = el.querySelector('.splitter-node-count');
    if(count) count.textContent = trf('smart.segmentCount', {count: items.length});
    const preview = el.querySelector('.splitter-node-preview');
    if(preview){
        preview.innerHTML = items.length
            ? `<div class="prompt-node-segments">${items.map((item, index) => `<div class="prompt-node-segment"><span>${index + 1}</span><p>${escapeHtml(item)}</p></div>`).join('')}</div>`
            : `<div class="splitter-node-empty">${escapeHtml(tr('smart.splitterEmpty'))}</div>`;
    }
}
function refreshAllSplitterNodePreviews(){
    nodes.filter(node => node.type === 'smart-splitter')
        .forEach(refreshSplitterNodePreview);
}
function loopNumberControlHtml({label, value, key, nodeId, min=1, max=100, quick=[1,2,3,4,5,6,8,10]}){
    const v = Math.max(min, Math.min(max, Number(value) || min));
    return `<div class="loop-number-control">
        <ic-popover class="loop-number-popover" label="${escapeAttr(label)}" content="interactive" dismiss-policy="light" placement="block-start" alignment="center">
            <ic-button slot="trigger" class="loop-smart-control loop-number-trigger" type="button" size="small" hierarchy="secondary" aria-haspopup="dialog" aria-expanded="false"><span>${escapeHtml(label)}</span><strong>${v}</strong></ic-button>
            <div class="loop-number-grid">
                ${quick.map(n => `<ic-button type="button" size="xs" hierarchy="quiet" class="loop-smart-control loop-number-cell ${n === v ? 'active' : ''}" data-loop-number="${escapeAttr(key)}" data-loop-value="${n}">${n}</ic-button>`).join('')}
            </div>
            <ic-number-input class="loop-smart-control loop-number-input" label="${escapeAttr(tr('common.custom'))}" name="loop-${escapeAttr(key)}-${escapeAttr(nodeId)}" min="${min}" max="${max}" step="1" size="small" data-loop-number-input="${escapeAttr(key)}" value="${v}"></ic-number-input>
        </ic-popover>
    </div>`;
}
function smartLoopTokenLabel(token){
    if(token === '《计数》' || token === '[计数]') return tr('smart.batchTaskIndex');
    return token;
}
function smartLoopTokenChipHtml(token){
    return `<span class="loop-smart-token-chip" contenteditable="false" data-token="${escapeHtml(token)}"><span>${escapeHtml(smartLoopTokenLabel(token))}</span><ic-icon-button type="button" size="xs" hierarchy="quiet" icon="close" label="${escapeAttr(tr('common.delete'))}" tooltip-disabled data-loop-token-remove></ic-icon-button></span>`;
}
function smartLoopVariableHtml(text){
    return String(text || '').split(/(《计数》|\[计数\])/g).map(part => {
        if(part === '《计数》' || part === '[计数]') return smartLoopTokenChipHtml('《计数》');
        return escapeHtml(part);
    }).join('');
}
function smartLoopEditorText(editor){
    const walk = node => {
        if(node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
        if(node.nodeType !== Node.ELEMENT_NODE) return '';
        if(node.classList?.contains('loop-smart-token-chip')) return node.dataset.token || '';
        if(node.tagName === 'BR') return '\n';
        return [...node.childNodes].map(walk).join('');
    };
    return [...(editor?.childNodes || [])].map(walk).join('').replace(/\u00a0/g, ' ');
}
function insertSmartLoopToken(editor, token){
    if(!editor) return;
    editor.focus();
    const chipWrap = document.createElement('span');
    chipWrap.innerHTML = smartLoopTokenChipHtml(token);
    const chip = chipWrap.firstElementChild;
    const spacer = document.createTextNode(' ');
    const sel = window.getSelection();
    if(sel && sel.rangeCount && editor.contains(sel.anchorNode)){
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(spacer);
        range.insertNode(chip);
        range.setStartAfter(spacer);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    } else {
        editor.appendChild(chip);
        editor.appendChild(spacer);
    }
}
function smartLoopBodyHtml(node){
    node.count = smartLoopCount(node);
    node.mode = node.mode === 'parallel' ? 'parallel' : 'serial';
    node.loopStart = Math.max(1, Number(node.loopStart) || 1);
    node.imageBatchSize = Math.max(1, Math.min(100, Number(node.imageBatchSize) || 1));
    node.showPrompt = Boolean(node.showPrompt);
    node.imageInput = Boolean(node.imageInput);
    const previewImages = smartLoopPreviewImages(node);
    const imageCount = previewImages.length;
    const loopThumbs = smartNodeInputThumbsHtml(previewImages);
    const promptItems = smartLoopInputPromptItems(node);
    const promptFields = smartLoopPromptFieldValues(node);
    const promptCount = Math.max(promptItems.length, smartLoopActivePromptFieldValues(node).length);
    const visiblePromptFields = promptFields.length ? promptFields : [''];
    const promptHint = promptItems.length
        ? trf('smart.loopPromptHintFound', {n:promptItems.length})
        : tr('smart.loopPromptHintVariable');
    const currentUpstreamPrompt = smartLoopSelectedInputPrompt(node, {index:node.loopStart});
    const defaultPrompt = smartLoopDefaultPromptText();
    const loopRunState = generationRun.status({node});
    const loopRunning = loopRunState.loopRunning;
    const loopStopping = loopRunState.loopStopping;
    return `<div class="loop-smart-card ${node.imageInput ? 'has-image' : ''} ${node.showPrompt ? 'has-prompt' : ''}" data-compact-label="${escapeAttr(tr('smart.loop'))}">
        <div class="loop-smart-header">
            <span class="loop-smart-header-icon" aria-hidden="true"><ic-icon name="loop" size="medium"></ic-icon></span>
            <div class="loop-smart-heading">
                <div class="loop-smart-title">${escapeHtml(tr('smart.loop'))}</div>
                <div class="loop-smart-subtitle">${escapeHtml(tr('smart.batchRunDescription'))}</div>
            </div>
        </div>
        <div class="loop-smart-section loop-smart-variables">
            <div class="loop-smart-section-label">${escapeHtml(tr('smart.batchVariables'))}</div>
            <div class="loop-smart-variable-row">
                <ic-button class="loop-smart-control loop-smart-toggle" type="button" hierarchy="secondary" size="small" toggle ${node.imageInput ? 'pressed' : ''} data-loop-toggle="image"><ic-icon slot="start" name="image" size="small" aria-hidden="true"></ic-icon>${escapeHtml(tr('smart.batchImageVariable'))}</ic-button>
                <span class="loop-smart-option-count" data-loop-option-count="image">${escapeHtml(trf('smart.batchOptionCount', {n:imageCount}))}</span>
            </div>
        ${node.imageInput ? `<div class="loop-smart-panel">
            ${loopThumbs}
            ${imageCount ? '' : `<div class="loop-smart-note">${escapeHtml(tr('canvas.loopImageEmpty'))}</div>`}
        </div>` : ''}
            <div class="loop-smart-variable-row">
                <ic-button class="loop-smart-control loop-smart-toggle" type="button" hierarchy="secondary" size="small" toggle ${node.showPrompt ? 'pressed' : ''} data-loop-toggle="prompt"><ic-icon slot="start" name="edit-text" size="small" aria-hidden="true"></ic-icon>${escapeHtml(tr('smart.batchPromptVariable'))}</ic-button>
                <span class="loop-smart-option-count" data-loop-option-count="prompt">${escapeHtml(trf('smart.batchOptionCount', {n:promptCount}))}</span>
            </div>
        ${node.showPrompt ? `<div class="loop-smart-panel prompt-panel">
            ${currentUpstreamPrompt ? `<div class="loop-smart-upstream">
                <div class="loop-smart-upstream-label">${escapeHtml(promptHint)}</div>
                <div class="loop-smart-upstream-text">${escapeHtml(currentUpstreamPrompt)}</div>
            </div>` : ''}
            <div class="loop-smart-prompt-list">
                ${visiblePromptFields.map((value, index) => {
                    const displayValue = promptItems.length && isSmartLoopDefaultPrompt(value) ? '' : value;
                    return `<div class="loop-smart-prompt-item">
                    <div class="loop-smart-prompt-index">${index + 1}</div>
                    <ic-prompt-composer class="loop-smart-control loop-smart-text" contenteditable="true" aria-label="${escapeAttr(tr('smart.batchPromptPlaceholder'))}" data-loop-prompt-index="${index}" data-placeholder="${escapeAttr(tr('smart.batchPromptPlaceholder'))}">${smartLoopVariableHtml(displayValue || (index === 0 && !promptFields.length && !promptItems.length ? defaultPrompt : ''))}</ic-prompt-composer>
                    <ic-icon-button class="loop-smart-control loop-smart-icon-btn" type="button" size="xs" hierarchy="quiet" icon="delete" label="${escapeAttr(tr('common.delete'))}" data-loop-prompt-delete="${index}" ${visiblePromptFields.length <= 1 ? 'disabled' : ''}></ic-icon-button>
                </div>`;
                }).join('')}
            </div>
            <div class="loop-smart-row loop-smart-prompt-actions">
                <ic-button class="loop-smart-control loop-smart-token loop-smart-counter-token" type="button" size="small" hierarchy="secondary" data-loop-token="《计数》">${escapeHtml(tr('smart.batchTaskIndex'))}</ic-button>
                <span class="loop-smart-note">${escapeHtml(promptHint)}</span>
                <ic-icon-button class="loop-smart-control loop-smart-add-prompt" type="button" size="xs" hierarchy="quiet" icon="add" label="${escapeAttr(tr('smart.addNew'))}" data-loop-prompt-add="1"></ic-icon-button>
            </div>
        </div>` : ''}
            <div class="loop-smart-combination-note"><ic-icon name="link" size="small" aria-hidden="true"></ic-icon><span>${escapeHtml(tr('smart.batchPairing'))}</span></div>
        </div>
        <div class="loop-smart-section loop-smart-execution">
            <div class="loop-smart-section-label">${escapeHtml(tr('smart.batchExecution'))}</div>
            <div class="loop-smart-setting-row">
                <span class="loop-smart-setting-label">${escapeHtml(tr('smart.batchExecutionMode'))}</span>
                <ic-segmented-control class="loop-smart-control loop-smart-seg" label="${escapeAttr(`${tr('smart.batchSequential')} / ${tr('smart.batchConcurrent')}`)}" value="${escapeAttr(node.mode)}" data-legal-combination="single-label">
                    <button type="button" data-value="serial">${escapeHtml(tr('smart.batchSequential'))}</button>
                    <button type="button" data-value="parallel" title="${escapeAttr(tr('smart.loopParallelTip'))}">${escapeHtml(tr('smart.batchConcurrent'))}</button>
                </ic-segmented-control>
            </div>
            <div class="loop-smart-setting-grid">
                ${loopNumberControlHtml({label:tr('smart.batchImagesPerTask'), value:node.imageBatchSize, key:'imageBatchSize', nodeId:node.id, max:100, quick:[1,2,3,4,5,6,8,10]})}
                ${loopNumberControlHtml({label:tr('smart.batchTaskIndex'), value:node.loopStart, key:'loopStart', nodeId:node.id, max:9999, quick:[1,2,3,4,5,6,8,10]})}
                ${loopNumberControlHtml({label:tr('smart.batchTaskCount'), value:node.count, key:'count', nodeId:node.id, max:100, quick:[1,2,3,4,5,6,8,10]})}
            </div>
        </div>
        <div class="loop-smart-footer">
            <div class="loop-smart-run-summary">${escapeHtml(trf('smart.batchWillRun', {n:node.count}))}</div>
            <ic-button class="loop-smart-control loop-smart-run ${loopRunning ? 'is-stop' : ''}" type="button" size="small" hierarchy="${loopRunning ? 'secondary' : 'primary'}" data-loop-run="${escapeHtml(node.id)}" ${loopStopping ? 'disabled' : ''}><ic-icon slot="start" name="${loopRunning ? 'stop' : 'workflow'}" size="small" aria-hidden="true"></ic-icon><span data-loop-run-label>${escapeHtml(loopRunning ? tr(loopStopping ? 'smart.batchStopping' : 'smart.batchStop') : trf('smart.loopRunAll', {n:node.count}))}</span></ic-button>
        </div>
    </div>`;
}
function smartGroupBodyHtml(node){
    const groupThumbLayout = smartContainer.thumbLayout(node);
    const refThumbs = groupThumbLayout?.refs || [];
    const members = smartContainer.groupMembers(node);
    const counts = members.reduce((acc, member) => {
        if(member.type === 'smart-prompt') acc.prompt += 1;
        else if(member.type === 'smart-splitter') acc.splitter += 1;
        else if(member.type === 'smart-loop') acc.loop += 1;
        return acc;
    }, {prompt:0, splitter:0, media:refThumbs.length, loop:0});
    const summary = [
        counts.prompt ? trf('smart.summaryText', {count: counts.prompt}) : '',
        counts.splitter ? trf('smart.summarySeparators', {count: counts.splitter}) : '',
        counts.media ? trf(counts.media === 1 ? 'smart.summaryImageSingle' : 'smart.summaryImages', {count: counts.media}) : '',
        counts.loop ? trf('smart.summaryLoops', {count: counts.loop}) : ''
    ].filter(Boolean).join(' · ') || tr('smart.groupEmptyDrop');
    if(refThumbs.length){
        const totalThumbs = Math.max(1, Number(groupThumbLayout?.rows || 1) * Number(groupThumbLayout?.cols || 1));
        if(totalThumbs === 1 && refThumbs.length === 1){
            const ref = refThumbs[0];
            const innerW = Math.max(24, Number(groupThumbLayout.innerW || groupThumbLayout.width || SMART_GROUP_DEFAULT_WIDTH));
            const innerH = Math.max(24, Number(groupThumbLayout.innerH || groupThumbLayout.height || SMART_GROUP_DEFAULT_HEIGHT));
            return `<div class="smart-group-card has-thumbs">
                <div class="smart-group-summary"><i data-lucide="group"></i><span>${escapeHtml(summary)}</span></div>
                <div class="image-wrap smart-group-single-thumb ${selectedImage.nodeId === ref.nodeId && Number(selectedImage.index) === Number(ref.index) ? 'image-selected' : ''}" data-ref-node-id="${escapeAttr(ref.nodeId)}" data-ref-image-index="${ref.index}" tabindex="0" data-image-index="${ref.index}" data-media-signature="${escapeAttr(`${mediaKindForItem(ref.item)}:${ref.item?.url || ''}`)}" style="--node-img-w:${innerW}px;--node-img-h:${innerH}px">${singleMediaHtml(ref.item, innerW, innerH)}${imageNameBadgeHtml(ref.item, {node:nodes.find(candidate => candidate.id === ref.nodeId) || null})}${imageResolutionBadgeHtml(ref.item)}</div>
            </div>`;
        }
        const groupMaxVisibleRows = (groupThumbLayout.compactMembers || []).length ? Number(groupThumbLayout.rows || 1) : SMART_GROUP_MAX_VISIBLE_ROWS;
        const visibleRows = Math.max(1, Math.min(groupMaxVisibleRows, Number(groupThumbLayout.visibleRows || groupThumbLayout.rows || 1)));
        const maxHeight = Math.max(
            44,
            Number(groupThumbLayout.gridHeight)
            || (
                visibleRows * Number(groupThumbLayout.thumb || 96)
                + Math.max(0,visibleRows - 1) * 8
            )
        );
        return `<div class="smart-group-card has-thumbs">
            <div class="smart-group-summary"><i data-lucide="group"></i><span>${escapeHtml(summary)}</span></div>
            <div class="thumb-grid smart-group-thumb-grid" data-thumb-scroll="1" style="--thumb-cols:${groupThumbLayout.cols}; --thumb-size:${groupThumbLayout.thumb}px; --thumb-max-height:${maxHeight}px">${refThumbs.map(ref => {
                return `<div class="thumb-item ${selectedImage.nodeId === ref.nodeId && Number(selectedImage.index) === Number(ref.index) ? 'image-selected' : ''}" data-ref-node-id="${escapeAttr(ref.nodeId)}" data-ref-image-index="${ref.index}" tabindex="0" data-image-index="${ref.index}" data-media-signature="${escapeAttr(`${mediaKindForItem(ref.item)}:${ref.item?.url || ''}`)}" style="--thumb-media-aspect:${mediaAspectRatio(ref.item)}"><div class="thumb-media-frame">${thumbMediaHtml(ref.item)}${imageResolutionBadgeHtml(ref.item)}</div>${imageNameBadgeHtml(ref.item, {node:nodes.find(candidate => candidate.id === ref.nodeId) || null})}</div>`;
            }).join('')}</div>
        </div>`;
    }
    return `<div class="smart-group-card">
        <div class="smart-group-summary"><i data-lucide="group"></i><span>${escapeHtml(summary)}</span></div>
        ${members.length ? '' : `<div class="smart-group-empty"><i data-lucide="plus"></i><span>${escapeHtml(tr('smart.groupDropImage'))}</span></div>`}
    </div>`;
}
function smartAnnotationBodyHtml(node, layout){
    if(node.type === 'smart-brush'){
        const brushSize = Math.max(1, Number(node.brushSize || 6));
        const points = Array.isArray(node.points) ? node.points : [];
        const safePoints = points.length === 1
            ? [points[0], [Number(points[0]?.[0] || 0) + .5, Number(points[0]?.[1] || 0)]]
            : points;
        const path = smartAnnotationPathData(safePoints);
        return `<svg class="smart-brush-mark" viewBox="0 0 ${Math.max(1, Number(layout.width || 1))} ${Math.max(1, Number(layout.height || 1))}" preserveAspectRatio="none" aria-label="${escapeAttr(tr('smart.brushMark'))}"><path class="smart-brush-hit" d="${path}" stroke-width="${Math.max(14, brushSize + 10)}"></path><path class="smart-brush-stroke" d="${path}" stroke="${escapeAttr(node.color || '#111827')}" stroke-width="${brushSize}"></path></svg>`;
    }
    return `<div class="smart-canvas-text" contenteditable="false" spellcheck="false" data-placeholder="${escapeAttr(tr('smart.annotationDefault'))}" style="--smart-text-size:${smartTextFontSize(node.textSize)}px">${escapeHtml(node.text || '')}</div>`;
}
function referenceGenerationKind(node){
    return ['image','video'].includes(node?.referenceGenerationKind) ? node.referenceGenerationKind : '';
}
function referenceGenerationTitle(node){
    return referenceGenerationKind(node) === 'video' ? tr('smart.referenceVideoNode') : tr('smart.referenceImageNode');
}
function referenceGenerationTargetHtml(node){
    const kind = referenceGenerationKind(node);
    if(!kind) return '';
    return `<div class="reference-generation-target" data-reference-generation-target="${escapeAttr(kind)}">
        <span class="upload-node-main"><i data-lucide="zap" aria-hidden="true"></i></span>
        <span class="upload-node-title">${escapeHtml(tr('smart.generationNode'))}</span>
        <span class="upload-node-sub">${escapeHtml(tr('smart.generationNodeSub'))}</span>
    </div>`;
}
function generationNodeHasFailedRun(node){
    if(node?.generationFailed) return true;
    const feedback = node?.generationRunFeedback;
    return Number(feedback?.failedCount || 0) > 0
        && Number(feedback?.successfulCount || 0) === 0;
}
function generationNodeFailureReason(node){
    const category = node?.generationRunFeedback?.reasonCategories?.[0] || '';
    return category
        ? tr(`smart.error.${category}.title`)
        : node?.generationRunFeedback?.reasons?.[0]
        || node?.generationFailureReason
        || tr('smart.generationFailureReason');
}
function generationFailureTargetHtml(node){
    return `<div class="reference-generation-target generation-failure-target" data-node-generation-failure="1">
        <span class="upload-node-main"><ic-icon name="error" size="medium" aria-hidden="true"></ic-icon></span>
        <span class="upload-node-title">${escapeHtml(tr('smart.errRunFailed'))}</span>
        <span class="upload-node-sub">${escapeHtml(generationNodeFailureReason(node))}</span>
        <ic-button type="button" size="small" hierarchy="secondary" data-view-generation-log="1">${escapeHtml(tr('smart.viewLogs'))}</ic-button>
    </div>`;
}
function nodeBodyHtml(node, layout){
    if(isSmartAnnotationNode(node)) return smartAnnotationBodyHtml(node, layout);
    if(smartContainer.isFrame(node)) return smartContainer.frameMembers(node).length ? '' : `<div class="smart-frame-empty">${escapeHtml(tr('smart.frameEmpty'))}</div>`;
    if(node.type === 'smart-group') return smartGroupBodyHtml(node);
    if(node.type === 'smart-prompt') return promptNodeBodyHtml(node);
    if(node.type === 'smart-splitter') return splitterNodeBodyHtml(node);
    if(node.type === 'smart-loop') return smartLoopBodyHtml(node);
    const imgs = (node.images || []).map(imageForDisplay);
    if(generationNodeHasFailedRun(node) && imgs.length === 0) return generationFailureTargetHtml(node);
    if(node.mattingJob && imgs.length === 0){
        return smartMatting.pendingHtml({node, layout, elapsed:generationPendingNodeElapsed(node)});
    }
    if(node.imageProcessorJob?.active && imgs.length === 0){
        return generationPendingNodeHtml({
            kind:'image',
            state:node.imageProcessorJob.phase === 'queued' ? 'queued' : 'generating',
            count:1,
            label:tr('smart.processing'),
            description:node.imageProcessorJob.message || tr('smart.waitingForProcessing'),
            elapsed:generationPendingNodeElapsed(node)
        });
    }
    if(node.jimengPending && node.jimengPending.submitId && imgs.length === 0){
        return jimengPendingBodyHtml(node, layout);
    }
    const recoverTask = smartRecoverableImageTask(node);
    if(recoverTask && imgs.length === 0){
        return imageTaskRecoverBodyHtml(node, recoverTask, layout);
    }
    if(node.queued && imgs.length === 0 && !node.pending){
        const kind = generationPendingNodeKind(node);
        return generationPendingNodeHtml({
            kind,
            state:'queued',
            count:1,
            label:generationPendingNodeLabel(kind, 'queued', 1),
            elapsed:generationPendingNodeElapsed(node)
        });
    }
    if(node.pending && imgs.length === 0){
        const count = Math.max(1, Number(node.pending) || 1);
        const kind = generationPendingNodeKind(node);
        return generationPendingNodeHtml({
            kind,
            state:'generating',
            count,
            label:generationPendingNodeLabel(kind, 'generating', count),
            elapsed:generationPendingNodeElapsed(node)
        });
    }
    if(imgs.length > 1){
        const visibleRows = Math.max(1, Math.min(MEDIA_GROUP_MAX_VISIBLE_ROWS, Number(layout.visibleRows || layout.rows || 1)));
        const maxHeight = Number(layout.gridHeight || (visibleRows * Number(layout.thumb || 96) + Math.max(0, visibleRows - 1) * 8));
        return `<div class="thumb-grid" data-thumb-scroll="1" style="--thumb-cols:${layout.cols}; --thumb-size:${layout.thumb}px; --thumb-max-height:${maxHeight}px">${imgs.map((img, i) => `<div class="thumb-item ${selectedImage.nodeId === node.id && selectedImage.index === i ? 'image-selected' : ''}" tabindex="0" data-image-index="${i}" data-media-signature="${escapeAttr(`${mediaKindForItem(img)}:${img?.url || ''}`)}" style="--thumb-media-aspect:${mediaAspectRatio(img)}"><div class="thumb-media-frame">${thumbMediaHtml(img)}${imageResolutionBadgeHtml(img)}</div>${imageNameBadgeHtml(img, {node})}</div>`).join('')}</div>`;
    }
    if(imgs[0]) return `<div class="image-wrap has-outside-image-name ${selectedImage.nodeId === node.id && selectedImage.index === 0 ? 'image-selected' : ''}" tabindex="0" data-image-index="0" data-media-signature="${escapeAttr(`${mediaKindForItem(imgs[0])}:${imgs[0]?.url || ''}`)}" style="--node-img-w:${layout.width}px;--node-img-h:${layout.height}px">${singleMediaHtml(imgs[0], layout.width, layout.height)}${imageNameBadgeHtml(imgs[0], {outside:true,node})}${imageResolutionBadgeHtml(imgs[0])}</div>`;
    const generationTarget = referenceGenerationTargetHtml(node);
    if(generationTarget) return generationTarget;
    const uploadAccept = node.uploadMediaKind === 'video'
        ? 'video/*,.mp4,.webm,.mov,.m4v'
        : node.uploadMediaKind === 'image'
            ? 'image/*,.png,.jpg,.jpeg,.webp,.gif'
            : 'image/*,video/*,audio/*,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov,.m4v,.mp3,.wav,.m4a,.aac,.ogg,.flac';
    return `<ic-upload-surface class="node-drop" data-upload-action="files" shape="node" label="${escapeAttr(tr('smart.createImportNode'))}" title="${escapeAttr(tr('smart.uploadNodeTitle'))}" hint="${escapeAttr(tr('smart.uploadNodeHint'))}" accept="${escapeAttr(uploadAccept)}" max-files="${SMART_UPLOAD_MAX}" max-size="${SMART_UPLOAD_MAX_BYTES}" multiple></ic-upload-surface>`;
}
function farNodeBodyHtml(node, layout){
    const frame = smartContainer.isFrame(node);
    const groupLayout = node.type === 'smart-group'
        ? smartContainer.thumbLayout(node)
        : null;
    const groupRefs = groupLayout?.refs || [];
    const generating = Boolean(
        node.pending
        || node.queued
        || node.running
        || node.textGenerationPending
        || node.jimengPending?.submitId
        || smartMatting.isActive({job:node.mattingJob})
    );
    const images = (node.images || []).map(imageForDisplay).filter(image => image?.url);
    const image = images[0];
    const prompt = nodeKinds.isPromptFamily(node);
    const role = frame
        ? 'frame'
        : node.type === 'smart-group'
            ? 'group'
            : prompt
                ? (nodeKinds.isPromptGeneration(node) ? 'prompt-generation' : 'prompt')
                : node.type === 'smart-splitter'
                    ? 'splitter'
                    : node.type === 'smart-loop'
                        ? 'loop'
                        : 'image';
    const marker = node.type === 'smart-prompt'
        ? tr('smart.promptNode')
        : node.type === 'smart-splitter'
            ? tr('smart.separator')
            : node.type === 'smart-loop'
                ? tr('smart.loop')
                : tr('smart.createImportNode');
    const mediaKind = image
        ? (isAudioMediaItem(image) ? 'audio' : isVideoMediaItem(image) ? 'video' : 'image')
        : '';
    const mediaMarkup = image && mediaKind !== 'audio'
        ? mediaKind === 'video'
            ? smartVideoPreviewHtml(image, 512, 'class="node-img" alt=""')
            : smartPreviewImgHtml(image, 512, 'class="node-img" draggable="false"')
        : '';
    return canvasFarPresentation.render({
        kind:role,
        layout,
        pending:generating,
        group:{count:groupRefs.length,columns:groupLayout?.cols},
        media:{
            kind:mediaKind,
            markup:mediaMarkup,
            signature:image ? `${mediaKindForItem(image)}:${image.url || ''}` : ''
        },
        labels:{
            group:trf(groupRefs.length === 1 ? 'smart.summaryImageSingle' : 'smart.summaryImages', {count:groupRefs.length}),
            pending:tr('smart.generatingShort'),
            prompt:nodeKinds.isPromptGeneration(node)
                ? tr('smart.promptGenerationNode')
                : tr('smart.promptNode'),
            marker
        }
    });
}
function jimengPendingBodyHtml(node, layout){
    const jp = node.jimengPending || {};
    const querying = Boolean(jp.querying);
    const queueText = jp.queueInfo?.queue_number
        ? trf('smart.queueAhead', {count: jp.queueInfo.queue_number})
        : tr('smart.taskProcessing');
    return generationRecoveryNodeHtml({
        nodeId:node.id,
        targetKind:'jimeng',
        kind:jp.kind || 'image',
        state:querying ? 'querying' : 'queued',
        title:queueText,
        description:tr('smart.taskRecoverable'),
        actionLabel:querying ? tr('canvas.queryingEllipsis') : tr('canvas.queryResult'),
        width:layout.width,
        height:layout.height
    });
}
function beginSmartFrameTitleEdit(nodeId){
    const node = nodes.find(item => item.id === nodeId && smartContainer.isFrame(item));
    const title = world.querySelector(`.image-node[data-id="${CSS.escape(nodeId)}"] .node-title`);
    if(!node || !title) return;
    const original = String(node.title || tr('smart.frameDefault'));
    delete title.dataset.frameTitleEditFinished;
    delete title.dataset.cancelEdit;
    title.textContent = original;
    title.dataset.originalText = original;
    title.setAttribute('contenteditable', 'true');
    title.focus({preventScroll:true});
    const range = document.createRange();
    range.selectNodeContents(title);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const finish = (cancelled, options={}) => {
        if(title.dataset.frameTitleEditFinished === '1') return false;
        title.dataset.frameTitleEditFinished = '1';
        const value = cancelled ? original : String(title.textContent || '').trim();
        title.onkeydown = null;
        title.onblur = null;
        title.removeAttribute('contenteditable');
        if(document.activeElement === title) title.blur();
        if(!cancelled && value && value !== original){
            canvasMutation.history({action:'push'});
            node.title = value.slice(0, 80);
            canvasPersistence.schedule();
        }
        if(options.render !== false) render();
        return true;
    };
    title.finishSmartFrameTitleEdit = finish;
    title.onkeydown = event => {
        event.stopPropagation();
        if(event.key === 'Enter'){
            event.preventDefault();
            title.blur();
        } else if(event.key === 'Escape'){
            event.preventDefault();
            title.dataset.cancelEdit = '1';
            title.blur();
        }
    };
    title.onblur = () => finish(title.dataset.cancelEdit === '1');
}
function finishActiveSmartFrameTitleEdit(nodeId, options={}){
    const title = world.querySelector(
        `.image-node[data-id="${CSS.escape(nodeId)}"] .node-title[contenteditable="true"]`
    );
    if(typeof title?.finishSmartFrameTitleEdit !== 'function') return false;
    return title.finishSmartFrameTitleEdit(
        title.dataset.cancelEdit === '1',
        options
    );
}
function beginCreatedSmartFrameTitleEdit(node){
    if(!smartContainer.isFrame(node)) return;
    requestAnimationFrame(() => beginSmartFrameTitleEdit(node.id));
}
function cycleSmartFrameColor(nodeId){
    const node = nodes.find(item => item.id === nodeId && smartContainer.isFrame(item));
    if(!node) return;
    canvasMutation.history({action:'push'});
    const currentColor = SMART_FRAME_COLORS.includes(node.frameColor)
        ? node.frameColor
        : SMART_FRAME_DEFAULT_COLOR;
    const current = SMART_FRAME_COLORS.indexOf(currentColor);
    node.frameColor = SMART_FRAME_COLORS[(current + 1 + SMART_FRAME_COLORS.length) % SMART_FRAME_COLORS.length];
    render();
    canvasPersistence.schedule();
}
function runSmartFrameToolbarAction(nodeId, action){
    const node = nodes.find(item => item.id === nodeId && smartContainer.isFrame(item));
    if(!node) return;
    if(action === 'download'){
        window.SmartCanvasModules.frameImageExport.open(node.id);
        return;
    }
    if(action === 'rename'){
        beginSmartFrameTitleEdit(node.id);
        return;
    }
    if(action === 'color'){
        cycleSmartFrameColor(node.id);
        return;
    }
    if(action === 'ungroup' && smartContainer.remove(
        [node.id],
        {preserveFrameContents:true}
    )) toast(tr('smart.ungroupedKept'));
}
function smartRecoverableImageTask(node){
    return generationRun.status({node}).recoverableTask;
}
function imageTaskRecoverBodyHtml(node, task, layout){
    const querying = Boolean(task.querying);
    const failedCount = generationRun.status({node}).pendingTasks.filter(item => item.failed && item.recoverTaskId).length;
    const title = querying ? tr('canvas.querying') : tr('canvas.taskRecoverable');
    const sub = failedCount > 1 ? trf('smart.tasksRecoverableCount', {count: failedCount}) : trf('smart.taskId', {id: task.recoverTaskId || ''});
    return generationRecoveryNodeHtml({
        nodeId:node.id,
        taskId:task.taskId,
        targetKind:'image',
        kind:'image',
        state:querying ? 'querying' : 'recoverable',
        title,
        description:sub,
        actionLabel:querying ? tr('canvas.queryingEllipsis') : tr('canvas.queryResult'),
        width:layout.width,
        height:layout.height
    });
}
function smartNodeToolbarImageIndex(node){
    const images = node?.images || [];
    if(selectedImage.nodeId === node?.id){
        const index = Number(selectedImage.index);
        if(Number.isFinite(index) && index >= 0 && index < images.length) return index;
    }
    return 0;
}
function smartNodeToolbarText(node){
    if(nodeKinds.isTextAnnotation(node)) return String(node?.text || '');
    if(nodeKinds.isPromptFamily(node)){
        return String(node?.llmEnabled ? (node.llmInstruction || node.text || '') : (node.text || ''));
    }
    return '';
}
function smartNodeToolbarActionHtml(node, action){
    if(action.key === 'divider') return '<ic-divider orientation="vertical" data-smart-node-divider></ic-divider>';
    const toggle = action.toggle === true;
    const hierarchy = toggle ? 'secondary' : 'quiet';
    const toggleAttrs = toggle
        ? ` toggle aria-pressed="${action.pressed ? 'true' : 'false'}"${action.pressed ? ' pressed' : ''}`
        : '';
    const mediaIndex = Number.isInteger(action.imageIndex)
        ? ` data-media-index="${action.imageIndex}"`
        : '';
    const reason = action.reason ? ` title="${escapeAttr(action.reason)}" aria-label="${escapeAttr(`${action.label}: ${action.reason}`)}"` : '';
    return `<ic-button type="button" size="xs" hierarchy="${hierarchy}" data-smart-node-action="${escapeAttr(action.key)}" data-node-id="${escapeAttr(node.id)}"${mediaIndex}${toggleAttrs}${reason} ${action.enabled ? '' : 'disabled'}>
        <ic-icon slot="start" name="${escapeAttr(action.icon)}" size="x-small"></ic-icon><span${toggle ? ' data-smart-playback-label' : ''}>${escapeHtml(action.label)}</span>
    </ic-button>`;
}
function smartNodeToolbarActionsHtml(node, actions=[]){
    if(!actions.length) return '';
    if(actions.length === 1){
        const action = actions[0];
        return `<ic-smart-node-toolbar label="${escapeAttr(tr('smart.nodeActions'))}" data-smart-node-menu="1">
            ${smartNodeToolbarActionHtml(node, action)}
        </ic-smart-node-toolbar>`;
    }
    return `<ic-smart-node-toolbar label="${escapeAttr(tr('smart.nodeActions'))}" data-smart-node-menu="1">${actions.map(action => smartNodeToolbarActionHtml(node, action)).join('')}</ic-smart-node-toolbar>`;
}
function smartNodeToolbarHtml(node){
    if(smartNodeInFlight(node) && isSmartRunnableNode(node)){
        return smartNodeToolbarActionsHtml(node, [
            ...(nodeKinds.isPromptFamily(node) ? [{key:'generate-image',icon:'online-generate',label:tr('smart.action.generateMedia'),enabled:false,reason:smartMultiInputReason('running')}] : []),
            {key:'duplicate', icon:'create-copy', label:tr('smart.contextDuplicate'), enabled:true},
            {key:'regenerate', icon:'refresh', label:tr('smart.contextRegenerate'), enabled:smartNodeHasRegenerationSnapshot(node)}
        ]);
    }
    const isTextNode = nodeKinds.isPromptFamily(node) || nodeKinds.isTextAnnotation(node);
    if(isTextNode){
        const text = smartNodeToolbarText(node);
        const generate = nodeKinds.isPromptFamily(node) ? smartMultiInputAvailability([node.id]) : null;
        const actions = nodeKinds.isPromptFamily(node)
            ? [
                {key:'generate-image', icon:'online-generate', label:tr('smart.action.generateMedia'), enabled:generate.ok, reason:generate.ok ? '' : smartMultiInputReason(generate.reason)},
                {key:'focus-editor', icon:'focus-editor', label:tr('smart.focusEdit'), enabled:true},
                {key:'copy-text', icon:'copy', label:tr('smart.copyPrompt'), enabled:Boolean(text.trim())}
            ]
            : [{key:'copy-text', icon:'copy', label:tr('smart.copyPrompt'), enabled:Boolean(text.trim())}];
        return smartNodeToolbarActionsHtml(node, actions);
    }
    const isImageNode = node?.type === 'smart-image' || !node?.type;
    const images = node?.images || [];
    if(!isImageNode || !images.some(img => img?.url)) return '';
    const toolbarImageIndex = smartNodeToolbarImageIndex(node);
    const item = imageForDisplay(images[toolbarImageIndex] || images.find(img => img?.url));
    if(!item?.url) return '';
    const kind = mediaKindForItem(item);
    const downloadAction = {key:'download', icon:'download', label:tr('smart.contextDownload'), enabled:true};
    const actions = kind === 'video'
        ? [
            {key:'video-play', icon:'play', label:tr('smart.action.fullscreenPlay'), enabled:true},
            {
                key:'video-loop',
                icon:smartPlaybackEntry(node.id, toolbarImageIndex).loop ? 'check' : 'loop',
                label:tr(smartPlaybackEntry(node.id, toolbarImageIndex).loop ? 'smart.action.autoLoopOn' : 'smart.action.autoLoop'),
                enabled:true,
                toggle:true,
                pressed:smartPlaybackEntry(node.id, toolbarImageIndex).loop,
                imageIndex:toolbarImageIndex
            },
            {key:'extract-frame', icon:'extract-frame', label:tr('smart.action.extractFrame'), enabled:true},
            downloadAction
        ]
        : kind === 'image'
            ? [
                {key:'reverse-prompt', icon:'reverse-prompt', label:tr('smart.contextReversePrompt'), enabled:true},
                {key:'generate-image', icon:'online-generate', label:tr('smart.action.generateMedia'), enabled:true},
                {key:'matting', icon:'cut', label:tr('smart.matting'), enabled:true},
                {key:'outpaint', icon:'fit', label:tr('canvas.modeOutpaint'), enabled:true},
                {key:'angle-control', icon:'angle-control', label:tr('nav.angle'), enabled:true},
                {key:'lighting-reference', icon:'lighting-reference', label:tr('smart.contextLightingReference'), enabled:true},
                {key:'divider'},
                {key:'edit', icon:'edit', label:tr('smart.imageModeEdit'), enabled:true},
                downloadAction
            ]
            : [downloadAction];
    return smartNodeToolbarActionsHtml(node, actions);
}
function duplicateSmartNodeMediaToCanvas(node, imageIndex){
    const source = node?.images?.[imageIndex];
    const item = imageForDisplay(source);
    if(!node || !item?.url){ toast(tr('smart.noCanvasAsset')); return; }
    canvasMutation.history({action:'push'});
    const rect = nodeRect(node);
    const point = {x:rect.x + rect.width + 220, y:rect.y + rect.height / 2};
    const copy = {...item};
    const newNode = createImageNodeAt(point, [copy], {select:true, skipUndo:true});
    selectedIds = [];
    selectedImage = {nodeId:newNode.id, index:0};
    render();
    canvasPersistence.schedule();
    toast(tr('smart.addedToCanvas'));
}
function openSmartVideoFullscreen(nodeId, imageIndex=0){
    const node = nodes.find(candidate => candidate.id === nodeId);
    const index = Math.max(0, Number(imageIndex) || 0);
    if(mediaKindForItem(node?.images?.[index] || {}) !== 'video') return false;
    const inlineVideo = [...world.querySelectorAll('[data-image-index]')]
        .find(item => {
            const ownerNodeId = item.dataset.refNodeId || item.closest('.image-node')?.dataset.id || '';
            const ownerImageIndex = Number(item.dataset.refImageIndex ?? item.dataset.imageIndex ?? 0);
            return ownerNodeId === String(nodeId) && ownerImageIndex === index;
        })
        ?.querySelector('video[data-inline-video-active="1"]') || null;
    const playbackState = inlineVideo?._smartFullscreenPlaybackState || captureMediaPlaybackState(inlineVideo);
    if(inlineVideo) delete inlineVideo._smartFullscreenPlaybackState;
    const entry = inlineVideo
        ? smartPlaybackRemember(inlineVideo, {nodeId:String(nodeId), imageIndex:index, key:smartPlaybackKey(nodeId, index)})
        : smartPlaybackEntry(nodeId, index);
    if(playbackState && entry){
        entry.currentTime = playbackState.currentTime;
        entry.paused = playbackState.paused;
        entry.ended = playbackState.ended;
        entry.loop = playbackState.loop;
    }
    if(inlineVideo) inlineVideo.pause();
    if(entry && playbackState) entry.paused = playbackState.paused;
    smartPlaybackSession.previewTransfer = {
        key:smartPlaybackKey(nodeId, index),
        paused:Boolean(entry?.paused)
    };
    selectedId = nodeId;
    selectedIds = [];
    selectedImage = {nodeId, index};
    imageStudio.open({nodeId, imageIndex:index, mode:'preview', groupAware:false});
    return true;
}
function runSmartNodeToolbarAction(nodeId, action, requestedImageIndex=null){
    const node = nodes.find(n => n.id === nodeId);
    if(!node) return;
    if(action === 'duplicate'){
        canvasMutation.duplicate({
            nodeIds:[node.id],
            mode:'offset',
            preserveConnections:true,
            message:tr('smart.nodesCreated')
        });
        return;
    }
    if(action === 'regenerate'){
        generationRun.regenerate({nodeId:node.id}).catch(error => {
            toast((error?.message || tr('smart.errRunFailed')).slice(0, 160));
        });
        return;
    }
    if(action === 'copy-text'){
        copySmartText(smartNodeToolbarText(node), tr('smart.promptCopied'));
        return;
    }
    if(action === 'focus-editor' && nodeKinds.isPromptFamily(node)){
        setPromptNodeFocused(node.id, true);
        return;
    }
    if(action === 'generate-image' && nodeKinds.isPromptFamily(node)){
        smartMultiInputFromToolbar([node.id]);
        return;
    }
    const index = Number.isInteger(Number(requestedImageIndex)) && requestedImageIndex !== null
        ? Math.max(0, Number(requestedImageIndex))
        : smartNodeToolbarImageIndex(node);
    const item = imageForDisplay(node.images?.[index]);
    if(!item?.url) return;
    const kind = mediaKindForItem(item);
    selectedId = nodeId;
    selectedIds = [];
    selectedImage = {nodeId, index};
    if(action === 'download'){
        downloadPreviewFile(node.images?.[index] || item);
        return;
    }
    if(action === 'video-play' && kind === 'video'){
        openSmartVideoFullscreen(nodeId, index);
        return;
    }
    if(action === 'video-loop' && kind === 'video'){
        toggleSmartVideoLoop(nodeId, index);
        return;
    }
    if(action === 'extract-frame' && kind === 'video'){
        imageStudio.open({nodeId, imageIndex:index, mode:'preview', groupAware:false});
        toast(tr('smart.frameExportHint'));
        return;
    }
    if(action === 'reverse-prompt'){
        openAiProcessorForSmartImage('reverse-prompt', nodeId, index).catch(error => {
            toast((error.message || tr('smart.operationFailed')).slice(0, 160));
        });
        return;
    }
    if(action === 'generate-image'){
        createReferencedNodeFromToolbar(node, 'image');
        return;
    }
    if(action === 'outpaint' || action === 'angle-control' || action === 'lighting-reference'){
        openAiProcessorForSmartImage(action, nodeId, index).catch(error => {
            toast((error.message || tr('smart.operationFailed')).slice(0, 160));
        });
        return;
    }
    if(action === 'canvas'){
        duplicateSmartNodeMediaToCanvas(node, index);
        return;
    }
    if(kind !== 'image'){
        toast(tr('smart.unsupportedAction'));
        return;
    }
    if(action === 'edit'){
        imageStudio.open({nodeId, imageIndex:index, mode:'preview', groupAware:false});
        return;
    }
    if(action === 'matting'){
        smartMatting.run({node, imageIndex:index});
        return;
    }
}
// 编组顶部小菜单：整理排列 / 预览（整组左右切换）/ 宫格拼接 / 批量下载 / 解散编组。
// 与多图节点的 smart-node-floating-menu 同款样式与定位（选中编组时浮在卡片上方）。
function smartGroupToolbarHtml(node){
    if(!smartContainer.isGroup(node)) return '';
    const hasContent = (node.images || []).some(img => img?.url) || smartContainer.groupMembers(node).length > 0;
    const imageCount = (node.images || []).filter(img => img?.url).length;
    const actions = [
        {key:'arrange', icon:'arrange', label:tr('smart.contextArrange'), enabled:hasContent},
        {key:'preview', icon:'preview', label:tr('smart.contextPreview'), enabled:imageCount > 0},
        {key:'grid', icon:'join-grid', label:tr('smart.contextGridJoin'), enabled:imageCount > 1},
        {key:'download', icon:'archive', label:tr('smart.contextBatchDownload'), enabled:imageCount > 0},
        {key:'ungroup', icon:'ungroup', label:tr('smart.contextUngroup'), enabled:true}
    ];
    return `<ic-smart-node-toolbar label="${escapeAttr(tr('smart.groupActions'))}" data-smart-group-menu="1">${actions.map(action => `
        <ic-button type="button" size="xs" hierarchy="quiet" data-smart-group-action="${escapeAttr(action.key)}" data-node-id="${escapeAttr(node.id)}" ${action.enabled ? '' : 'disabled'} title="${escapeAttr(action.label)}">
            <ic-icon slot="start" name="${escapeAttr(action.icon)}" size="x-small"></ic-icon>${escapeHtml(action.label)}
        </ic-button>`).join('')}</ic-smart-node-toolbar>`;
}
function smartFrameToolbarHtml(node){
    if(!smartContainer.isFrame(node)) return '';
    const actions = [
        {key:'rename', icon:'edit', label:tr('smart.contextRenameFrame')},
        {key:'color', icon:'color', label:tr('smart.contextFrameColor')},
        {key:'download', icon:'download', label:tr('smart.contextDownload')},
        {key:'ungroup', icon:'ungroup-frame', label:trf('smart.contextUngroupFrame', {n:smartContainer.frameMembers(node).length})}
    ];
    return `<ic-smart-node-toolbar label="${escapeAttr(tr('smart.frameActions'))}" data-smart-frame-menu="1">${actions.map(action => `
        <ic-button type="button" size="xs" hierarchy="quiet" data-smart-frame-action="${escapeAttr(action.key)}" data-node-id="${escapeAttr(node.id)}" title="${escapeAttr(action.label)}">
            <ic-icon slot="start" name="${escapeAttr(action.icon)}" size="x-small"></ic-icon>${escapeHtml(action.label)}
        </ic-button>`).join('')}</ic-smart-node-toolbar>`;
}
function smartMultiSelectionToolbarHtml(ids=[]){
    if((ids || []).length < 2) return '';
    const generate = smartMultiInputAvailability(ids);
    const generateReason = generate.ok ? tr('smart.action.generateMedia') : smartMultiInputReason(generate.reason);
    const mediaCount = smartMultiSelectionMediaItems(ids).length;
    const imageCount = (ids || []).map(id => nodes.find(node => node.id === id)).filter(Boolean)
        .flatMap(workspacePublishableImageRefs).length;
    return `<ic-smart-node-toolbar label="${escapeAttr(tr('smart.multiSelectionActions'))}" data-smart-multi-menu="1">
        <ic-button type="button" size="xs" hierarchy="quiet" data-smart-multi-action="generate" title="${escapeAttr(generateReason)}" aria-label="${escapeAttr(generateReason)}" ${generate.ok ? '' : 'disabled'}>
            <ic-icon slot="start" name="online-generate" size="x-small"></ic-icon>${escapeHtml(tr('smart.action.generateMedia'))}
        </ic-button>
        <ic-divider orientation="vertical"></ic-divider>
        <ic-button type="button" size="xs" hierarchy="quiet" data-smart-multi-layout="grid" title="${escapeAttr(tr('smart.layoutGrid'))}">
            <ic-icon slot="start" name="layout-grid" size="x-small"></ic-icon>${escapeHtml(tr('smart.layoutGrid'))}
        </ic-button>
        <ic-button type="button" size="xs" hierarchy="quiet" data-smart-multi-layout="horizontal" title="${escapeAttr(tr('smart.layoutHorizontal'))}">
            <ic-icon slot="start" name="layout-horizontal" size="x-small"></ic-icon>${escapeHtml(tr('smart.layoutHorizontal'))}
        </ic-button>
        <ic-button type="button" size="xs" hierarchy="quiet" data-smart-multi-layout="vertical" title="${escapeAttr(tr('smart.layoutVertical'))}">
            <ic-icon slot="start" name="layout-vertical" size="x-small"></ic-icon>${escapeHtml(tr('smart.layoutVertical'))}
        </ic-button>
        <ic-button type="button" size="xs" hierarchy="quiet" data-smart-multi-layout="tree" title="${escapeAttr(tr('smart.layoutTree'))}">
            <ic-icon slot="start" name="layout-tree" size="x-small"></ic-icon>${escapeHtml(tr('smart.layoutTree'))}
        </ic-button>
        <ic-button type="button" size="xs" hierarchy="quiet" data-smart-multi-action="download" title="${escapeAttr(tr('smart.downloadSelection'))}" ${mediaCount ? '' : 'disabled'}>
            <ic-icon slot="start" name="download" size="x-small"></ic-icon>${escapeHtml(tr('smart.contextDownload'))}
        </ic-button>
        ${imageCount ? `<ic-button type="button" size="xs" hierarchy="quiet" data-smart-multi-action="publish-workspace-assets" title="${escapeAttr(tr('smart.addToAssetLibrary'))}">
            <ic-icon slot="start" name="collection" size="x-small"></ic-icon>${escapeHtml(tr('smart.addToAssetLibrary'))}
        </ic-button>` : ''}
    </ic-smart-node-toolbar>`;
}
function positionSmartNodeFloatingPortal(
    node=window.SmartCanvasModules.viewportSelection.selection.node(),
    selectionBounds=null
){
    if(!smartNodeFloatingPortal?.classList.contains('open')) return;
    const rect = selectionBounds || (node ? nodeRect(node) : null);
    if(!rect) return;
    const nodeLeft = viewport.x + rect.x * viewport.scale;
    const nodeTop = viewport.y + rect.y * viewport.scale;
    const nodeRight = nodeLeft + rect.width * viewport.scale;
    const nodeBottom = nodeTop + rect.height * viewport.scale;
    const isVisible = nodeRight > 0 && nodeLeft < shell.clientWidth && nodeBottom > 0 && nodeTop < shell.clientHeight;
    smartNodeFloatingPortal.classList.toggle('viewport-hidden', !isVisible);
    if(!isVisible) return;
    const anchorX = viewport.x + (rect.x + rect.width / 2) * viewport.scale;
    const menuWidth = smartNodeFloatingPortal.offsetWidth || 0;
    const anchorY = nodeTop - 8;
    const minX = 14 + menuWidth / 2;
    const maxX = Math.max(minX, shell.clientWidth - 14 - menuWidth / 2);
    smartNodeFloatingPortal.classList.remove('place-below');
    smartNodeFloatingPortal.style.left = `${Math.max(minX, Math.min(maxX, anchorX))}px`;
    smartNodeFloatingPortal.style.top = `${anchorY}px`;
}
function selectedSmartTextAnnotationNode(){
    const selection = window.SmartCanvasModules?.viewportSelection?.selection;
    const ids = selection?.ids?.() || [];
    if(ids.length !== 1) return null;
    const node = nodes.find(item => item.id === ids[0]);
    return node?.type === 'smart-text' ? node : null;
}
function clearSelectedSmartTextAnnotation(){
    if(!selectedSmartTextAnnotationNode()) return false;
    window.SmartCanvasModules.viewportSelection.selection.clear();
    render();
    return true;
}
function positionSmartTextOptionsForNode(node=selectedSmartTextAnnotationNode()){
    if(!smartTextOptions?.classList.contains('node-floating') || !node) return;
    const rect = nodeRect(node);
    const nodeLeft = viewport.x + rect.x * viewport.scale;
    const nodeTop = viewport.y + rect.y * viewport.scale;
    const nodeRight = nodeLeft + rect.width * viewport.scale;
    const nodeBottom = nodeTop + rect.height * viewport.scale;
    const visible = nodeRight > 0
        && nodeLeft < shell.clientWidth
        && nodeBottom > 0
        && nodeTop < shell.clientHeight;
    smartTextOptions.style.visibility = visible ? 'visible' : 'hidden';
    if(!visible) return;
    const width = smartTextOptions.offsetWidth || 0;
    const height = smartTextOptions.offsetHeight || 44;
    const placeBelow = nodeTop < height + 22;
    const anchorX = viewport.x + (rect.x + rect.width / 2) * viewport.scale;
    const minX = 14 + width / 2;
    const maxX = Math.max(minX, shell.clientWidth - 14 - width / 2);
    smartTextOptions.classList.toggle('place-below', placeBelow);
    smartTextOptions.style.left = `${Math.max(minX, Math.min(maxX, anchorX))}px`;
    smartTextOptions.style.top = `${placeBelow ? nodeBottom + 8 : nodeTop - 8}px`;
}
function syncSmartTextOptions(){
    if(!smartTextOptions) return;
    const textToolOpen = smartBaseTool === 'text' && smartAnnotationOptionsOpen;
    const selectedText = smartBaseTool === 'pointer' && !smartSpacePan && !smartMiddlePan
        ? selectedSmartTextAnnotationNode()
        : null;
    const floating = Boolean(selectedText);
    const open = textToolOpen || floating;
    const activeSize = selectedText?.textSize || smartTextSize;
    smartTextOptions.classList.toggle('node-floating', floating);
    smartTextOptions.classList.toggle('open', open);
    smartTextOptions.setAttribute('aria-hidden', open ? 'false' : 'true');
    smartTextOptions.querySelectorAll('[data-smart-text-size]').forEach(button => {
        button.classList.toggle(
            'active',
            button.dataset.smartTextSize === activeSize
        );
    });
    if(floating){
        positionSmartTextOptionsForNode(selectedText);
    } else {
        smartTextOptions.classList.remove('place-below');
        smartTextOptions.style.left = '';
        smartTextOptions.style.top = '';
        smartTextOptions.style.visibility = '';
    }
}
function bindSmartNodeFloatingPortal(){
    if(!smartNodeFloatingPortal) return;
    smartNodeFloatingPortal.onpointerdown = event => {
        const frameAction = event.target.closest('[data-smart-frame-action]');
        if(frameAction){
            finishActiveSmartFrameTitleEdit(
                frameAction.dataset.nodeId || '',
                {render:false}
            );
        }
    };
    smartNodeFloatingPortal.onmousedown = event => {
        event.preventDefault();
        event.stopPropagation();
    };
    smartNodeFloatingPortal.onclick = event => {
        const nodeAction = event.target.closest('[data-smart-node-action]');
        const groupAction = event.target.closest('[data-smart-group-action]');
        const frameAction = event.target.closest('[data-smart-frame-action]');
        const multiAction = event.target.closest('[data-smart-multi-action]');
        const multiLayout = event.target.closest('[data-smart-multi-layout]');
        const button = nodeAction || groupAction || frameAction || multiAction || multiLayout;
        event.preventDefault();
        event.stopPropagation();
        if(!button || button.disabled) return;
        if(nodeAction) runSmartNodeToolbarAction(
            button.dataset.nodeId || '',
            button.dataset.smartNodeAction,
            button.hasAttribute('data-media-index') ? Number(button.dataset.mediaIndex) : null
        );
        else if(groupAction) runSmartGroupToolbarAction(button.dataset.nodeId || '', button.dataset.smartGroupAction);
        else if(frameAction) runSmartFrameToolbarAction(button.dataset.nodeId || '', button.dataset.smartFrameAction);
        else if(multiLayout){
            arrangeSelectedSmartNodes(multiLayout.dataset.smartMultiLayout || 'grid');
        } else if(multiAction?.dataset.smartMultiAction === 'generate'){
            smartMultiInputFromToolbar(window.SmartCanvasModules.viewportSelection.selection.ids());
        } else if(multiAction?.dataset.smartMultiAction === 'download'){
            downloadSmartMultiSelection();
        } else if(multiAction?.dataset.smartMultiAction === 'publish-workspace-assets'){
            publishSelectedWorkspaceAssets(window.SmartCanvasModules.viewportSelection.selection.ids()).catch(error => toast(error.message || tr('smart.addFailed'), {tone:'danger'}));
        }
    };
}
function syncSmartNodeFloatingPortal(){
    if(!smartNodeFloatingPortal) return;
    const ids = window.SmartCanvasModules.viewportSelection.selection.ids();
    const node = window.SmartCanvasModules.viewportSelection.selection.node();
    const bounds = ids.length > 1
        ? window.SmartCanvasModules.viewportSelection.selection.bounds(ids)
        : null;
    const html = ids.length > 1
        ? smartMultiSelectionToolbarHtml(ids)
        : node
            ? (smartFrameToolbarHtml(node) || smartGroupToolbarHtml(node) || smartNodeToolbarHtml(node))
            : '';
    if(smartNodeFloatingPortal.dataset.menuHtml !== html){
        smartNodeFloatingPortal.dataset.menuHtml = html;
        smartNodeFloatingPortal.innerHTML = html;
        bindSmartNodeFloatingPortal();
        if(html) refreshIcons();
    }
    smartNodeFloatingPortal.querySelectorAll('[data-smart-node-action="video-loop"]').forEach(button => {
        const imageIndex = Number(button.dataset.mediaIndex || 0);
        syncSmartNodeVideoLoopControl(
            button,
            smartPlaybackEntry(button.dataset.nodeId || '', imageIndex).loop
        );
    });
    smartNodeFloatingPortal.classList.toggle('open', Boolean(html));
    smartNodeFloatingPortal.setAttribute('aria-hidden', html ? 'false' : 'true');
    if(!html) smartNodeFloatingPortal.classList.add('viewport-hidden');
    if(html) smartNodeFloatingPortal.style.removeProperty('visibility');
    if(html) positionSmartNodeFloatingPortal(node,bounds);
    syncSmartTextOptions();
}
function smartMultiSelectionMediaItems(ids=window.SmartCanvasModules.viewportSelection.selection.ids()){
    const visited = new Set();
    const items = [];
    const collect = node => {
        if(!node || visited.has(node.id)) return;
        visited.add(node.id);
        if(smartContainer.isFrame(node)){
            smartContainer.frameMembers(node).forEach(collect);
            return;
        }
        if(smartContainer.isGroup(node)){
            smartContainer.imageRefs(node).forEach(ref => {
                if(ref.item?.url) items.push(ref.item);
            });
            return;
        }
        (node.images || []).forEach(item => {
            if(item?.url) items.push(item);
        });
    };
    (ids || []).forEach(id => collect(nodes.find(node => node.id === id)));
    const seen = new Set();
    return items.filter(item => {
        const key = `${mediaKindForItem(item)}:${item.url}`;
        if(seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
function downloadSmartMultiSelection(){
    const items = smartMultiSelectionMediaItems();
    if(!items.length){ toast(tr('smart.noSelectedMedia')); return; }
    if(items.length === 1){
        downloadPreviewFile(items[0]);
        return;
    }
    return zipDownloadImageItems('selected-nodes',items);
}
smartMultiSelectionBox?.addEventListener('mousedown',event => {
    if(smartMultiSelectionBox.isQuickAddEvent?.(event)){
        smartMultiInputBegin(event);
        return;
    }
    if(smartMultiSelectionBox.isResizeEvent?.(event)){
        canvasInteraction.begin({
            kind:'resize-selection',
            event
        });
        return;
    }
    const nodeId = window.SmartCanvasModules.viewportSelection.selection.ids()[0];
    if(!nodeId) return;
    canvasInteraction.begin({
        kind:'move-nodes',
        event,
        nodeId
    });
});
smartMultiSelectionBox?.addEventListener('contextmenu',event => {
    const nodeId = window.SmartCanvasModules.viewportSelection.selection.ids()[0];
    if(!nodeId) return;
    event.preventDefault();
    event.stopPropagation();
    openSmartNodeContextMenu(event,{
        nodeId,
        mediaNodeId:nodeId,
        mediaIndex:-1
    });
});
function runSmartGroupToolbarAction(nodeId, action){
    const group = nodes.find(n => n.id === nodeId);
    if(!smartContainer.isGroup(group)) return;
    selectedId = nodeId;
    selectedIds = [];
    selectedImage = {nodeId:'', index:-1};
    if(action === 'arrange'){
        if(smartContainer.arrange(group)){ render(); canvasPersistence.schedule(); toast(tr('smart.groupArranged')); }
        else toast(tr('smart.groupNothingToArrange'));
        return;
    }
    if(action === 'ungroup'){
        smartContainer.ungroup(nodeId);
        return;
    }
    // 图片已加入编组（group.images），预览/下载/拼接直接复用单节点机器（编组就是一个多图容器）。
    const imageCount = (group.images || []).filter(img => img?.url).length;
    if(!imageCount){ toast(tr('smart.groupNoImages')); return; }
    if(action === 'preview'){
        const first = (group.images || []).findIndex(img => img?.url);
        imageStudio.openGroup({
            group,
            startNodeId:group.id,
            startIndex:Math.max(0, first),
            mode:'preview'
        });
        return;
    }
    if(action === 'download'){ zipDownloadImageItems(group.title, (group.images || []).map(imageForDisplay)); return; }
    if(action === 'grid'){
        if(imageCount <= 1){ toast(tr('smart.groupNeedsTwoImages')); return; }
        const first = (group.images || []).findIndex(img => img?.url);
        imageStudio.open({nodeId, imageIndex:Math.max(0, first), mode:'grid', groupAware:false});
        if(imageStudio.isOpen()){
            setGridOperationMode('join');
        }
        return;
    }
}
function nowMs(){ return Date.now(); }
function formatRunDuration(ms){
    const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return min ? `${min}:${String(sec).padStart(2, '0')}` : `${sec}s`;
}
function nodeRunElapsedMs(node){
    if(!node) return 0;
    if(node.runFinishedAt && node.runStartedAt) return Number(node.runElapsedMs) || (Number(node.runFinishedAt) - Number(node.runStartedAt));
    if(node.runStartedAt) return nowMs() - Number(node.runStartedAt);
    return 0;
}
function runTimePillText(node){
    const duration = formatRunDuration(nodeRunElapsedMs(node));
    const running = Boolean(node?.pending || node?.running || node?.jimengPending || node?.textGenerationPending);
    if(!running) return duration;
    const count = Math.max(1, Number(node?.pending) || 1);
    return `${duration} ${generationPendingNodeLabel(generationPendingNodeKind(node), 'generating', count)}`;
}
function runTimePillHtml(node){
    if(!node || node.runTimerHidden || (node.type === 'smart-prompt' && !node.textGenerationOutput)) return '';
    const running = Boolean(node.pending || node.running || node.jimengPending || node.textGenerationPending);
    if(!running && !node.runFinishedAt) return '';
    const cls = running ? '' : ' done';
    return `<ic-badge class="run-time-pill image-name-badge image-name-badge-outside${cls}" kind="status" tone="${running ? 'info' : 'neutral'}"${running ? ' loading' : ''} data-component-name="ic-badge-node-runtime-status" data-run-timer="${escapeHtml(node.id)}" data-run-timer-state="${running ? 'running' : 'complete'}">${escapeHtml(runTimePillText(node))}</ic-badge>`;
}
function hideRunTimerForNode(node){
    if(!node || node.runTimerHidden || node.pending || node.running || node.jimengPending || !node.runFinishedAt) return false;
    node.runTimerHidden = true;
    canvasPersistence.schedule();
    return true;
}
function refreshRunTimerPills(){
    const active = nodes.some(n => (n.type !== 'smart-prompt' || n.textGenerationOutput) && !n.runTimerHidden && (n.pending || n.running || n.jimengPending || n.textGenerationPending || n.runFinishedAt));
    document.querySelectorAll('ic-generation-pending[data-generation-pending-node]').forEach(el => {
        const nodeId = el.closest('.image-node')?.dataset.id || '';
        const node = nodes.find(item => item.id === nodeId);
        if(!node || node.runTimerHidden || !node.runStartedAt){
            el.removeAttribute('elapsed');
            return;
        }
        const elapsed = formatRunDuration(nodeRunElapsedMs(node));
        if(el.getAttribute('elapsed') !== elapsed) el.setAttribute('elapsed', elapsed);
    });
    document.querySelectorAll('[data-run-timer]').forEach(el => {
        const node = nodes.find(n => n.id === el.dataset.runTimer);
        if(!node || node.runTimerHidden || (node.type === 'smart-prompt' && !node.textGenerationOutput)) {
            el.remove();
            return;
        }
        const running = Boolean(node.pending || node.running || node.jimengPending || node.textGenerationPending);
        el.textContent = runTimePillText(node);
        const complete = Boolean(!running && node.runFinishedAt);
        const tone = running ? 'info' : 'neutral';
        if(el.getAttribute('tone') !== tone) el.setAttribute('tone', tone);
        if(el.hasAttribute('loading') !== running) el.toggleAttribute('loading', running);
        const timerState = running ? 'running' : 'complete';
        if(el.dataset.runTimerState !== timerState) el.dataset.runTimerState = timerState;
        el.classList.toggle('done', complete);
    });
    if(active && !runTimerInterval) runTimerInterval = setInterval(refreshRunTimerPills, 1000);
    if(!active && runTimerInterval){ clearInterval(runTimerInterval); runTimerInterval = null; }
}
function rememberInlineVideoActivations(){
    world.querySelectorAll('.image-node [data-image-index] video[data-inline-video-active="1"]').forEach(video => {
        const nodeEl = video.closest('.image-node');
        const itemEl = video.closest('[data-image-index]');
        const node = nodes.find(n => n.id === nodeEl?.dataset.id);
        const index = Number(itemEl?.dataset.imageIndex ?? 0);
        const image = node?.images?.[index];
        if(image && mediaKindForItem(image) === 'video') image._inlineVideoActive = true;
    });
}
function smartCanvasPinnedNodeIds(){
    const ids = new Set(canvasInteraction.active()?.nodeIds || []);
    const focusedNode = document.activeElement?.closest?.('.image-node');
    if(focusedNode?.dataset?.id) ids.add(focusedNode.dataset.id);
    if(pendingSmartTextEditNodeId) ids.add(pendingSmartTextEditNodeId);
    if(
        typeof smartComposerEditingSessionActive === 'function'
        && smartComposerEditingSessionActive()
        && activeComposerSubject?.id
    ){
        ids.add(activeComposerSubject.id);
    }
    if(smartContextMenuState?.nodeId) ids.add(smartContextMenuState.nodeId);
    return [...ids];
}
let smartCanvasDetailRecoveryReady = null;
let smartCanvasDetailRecoveryFrame = 0;
function smartCanvasNodeUsesFarPresentation(nodeId){
    if(canvasLevelOfDetail.diagnostics().mode === 'far') return true;
    return smartCanvasDetailRecoveryReady instanceof Set
        && !smartCanvasDetailRecoveryReady.has(String(nodeId || ''));
}
function smartContainerNavigationBadgeHtml(node, title=''){
    const frame = smartContainer.isFrame(node);
    if(!frame && node?.type !== 'smart-group') return '';
    const text = String(title || (frame ? tr('smart.frameDefault') : tr('smart.smartGroup'))).trim();
    return `<div class="smart-container-navigation-badge" data-navigation-kind="${frame ? 'frame' : 'group'}" title="${escapeAttr(text)}">${escapeHtml(text)}</div>`;
}
function beginSmartCanvasDetailRecovery(lodState){
    if(smartCanvasDetailRecoveryFrame){
        cancelAnimationFrame(smartCanvasDetailRecoveryFrame);
        smartCanvasDetailRecoveryFrame = 0;
    }
    if(lodState?.mode !== 'detail' || lodState?.previousMode !== 'far'){
        smartCanvasDetailRecoveryReady = null;
        return;
    }
    smartCanvasDetailRecoveryReady = new Set();
    const centerX = shell.clientWidth / 2;
    const centerY = shell.clientHeight / 2;
    const pending = [...world.querySelectorAll(':scope > .image-node[data-id]')]
        .map(element => {
            const rect = element.getBoundingClientRect();
            const dx = rect.left + rect.width / 2 - centerX;
            const dy = rect.top + rect.height / 2 - centerY;
            return {id:element.dataset.id || '', distance:dx * dx + dy * dy};
        })
        .filter(item => item.id)
        .sort((left,right) => left.distance - right.distance);
    const recoverBatch = () => {
        smartCanvasDetailRecoveryFrame = 0;
        const batch = pending.splice(0, 6).map(item => item.id);
        batch.forEach(nodeId => smartCanvasDetailRecoveryReady?.add(nodeId));
        if(!pending.length) smartCanvasDetailRecoveryReady = null;
        if(batch.length) render({syncVirtualization:false,nodeIds:batch});
        if(pending.length) smartCanvasDetailRecoveryFrame = requestAnimationFrame(recoverBatch);
    };
    if(pending.length) smartCanvasDetailRecoveryFrame = requestAnimationFrame(recoverBatch);
    else smartCanvasDetailRecoveryReady = null;
}
window.beginSmartCanvasDetailRecovery = beginSmartCanvasDetailRecovery;
function smartCanvasNodeRenderSignature(node){
    const copy = JSON.parse(JSON.stringify(node || {}, (key, value) => (
        key === '_dom' ? undefined : value
    )));
    delete copy.x;
    delete copy.y;
    return JSON.stringify([
        copy,
        smartCanvasNodeUsesFarPresentation(node.id) ? 'far' : 'detail',
        window.StudioI18n?.lang?.() || 'zh'
    ]);
}
function smartCanvasActiveEditorWithin(nodeElement){
    const activeElement = document.activeElement;
    if(!nodeElement || !activeElement || !nodeElement.contains(activeElement)) return null;
    if(activeElement.isContentEditable) return activeElement;
    if(activeElement.matches?.('input,textarea')) return activeElement;
    return null;
}
function smartCanvasDeferRenderUntilEditorBlur(editor){
    if(!editor || editor._smartCanvasRenderDeferred) return;
    editor._smartCanvasRenderDeferred = true;
    editor.addEventListener('blur', () => {
        delete editor._smartCanvasRenderDeferred;
        requestAnimationFrame(() => render());
    }, {once:true});
}
const SMART_CANVAS_WARM_NODE_LIMIT = 8;
const SMART_CANVAS_WARM_MEDIA_LIMIT = 12;
const smartCanvasWarmNodeCache = new Map();
function smartCanvasWarmMediaElements(element){
    if(!element || element.querySelector('video,audio')) return [];
    const images = [...element.querySelectorAll('img:not([data-preview-kind="video"])')];
    return images.length && images.every(image => image.complete && image.naturalWidth > 0)
        ? images
        : [];
}
function smartCanvasWarmNodeMediaCount(){
    return [...smartCanvasWarmNodeCache.values()].reduce(
        (count, entry) => count + entry.mediaCount,
        0
    );
}
function smartCanvasTrimWarmNodeCache(){
    while(
        smartCanvasWarmNodeCache.size > SMART_CANVAS_WARM_NODE_LIMIT
        || smartCanvasWarmNodeMediaCount() > SMART_CANVAS_WARM_MEDIA_LIMIT
    ){
        const oldestId = smartCanvasWarmNodeCache.keys().next().value;
        if(!oldestId) break;
        const oldest = smartCanvasWarmNodeCache.get(oldestId);
        smartCanvasWarmNodeCache.delete(oldestId);
        oldest?.element?.remove?.();
    }
}
function smartCanvasRememberWarmNode(nodeId, element){
    const id = String(nodeId || '');
    const media = smartCanvasWarmMediaElements(element);
    if(!id || !media.length || media.length > SMART_CANVAS_WARM_MEDIA_LIMIT){
        element?.remove?.();
        return false;
    }
    const previous = smartCanvasWarmNodeCache.get(id);
    if(previous?.element !== element) previous?.element?.remove?.();
    smartCanvasWarmNodeCache.delete(id);
    element.remove();
    smartCanvasWarmNodeCache.set(id,{
        element,
        mediaCount:media.length
    });
    smartCanvasTrimWarmNodeCache();
    return smartCanvasWarmNodeCache.get(id)?.element === element;
}
function smartCanvasTakeWarmNode(nodeId){
    const id = String(nodeId || '');
    const entry = smartCanvasWarmNodeCache.get(id);
    if(!entry) return null;
    smartCanvasWarmNodeCache.delete(id);
    return entry.element || null;
}
function smartCanvasPruneWarmNodes(liveNodeIds){
    smartCanvasWarmNodeCache.forEach((entry,nodeId) => {
        if(liveNodeIds.has(nodeId)) return;
        smartCanvasWarmNodeCache.delete(nodeId);
        entry?.element?.remove?.();
    });
}
let smartCanvasRenderInProgress = false;
let smartCanvasRenderQueued = false;
let smartCanvasRenderQueuedFullSync = false;
let smartCanvasRenderQueuedNodeIds = new Set();
let smartCanvasRenderQueuedSkipDynamicParamsRefresh = false;
let smartCanvasRenderQueuedPreserveMountedNodes = false;
function render(options={}){
    const dirtyVirtualizationNodeIds = [...new Set(
        Array.isArray(options?.nodeIds) ? options.nodeIds.filter(Boolean) : []
    )];
    const fullVirtualizationSync = options?.syncVirtualization !== false;
    const skipDynamicParamsRefresh = options?.skipDynamicParamsRefresh === true;
    const preserveMountedNodes = options?.preserveMountedNodes === true;
    const targetedReconciliation = !fullVirtualizationSync
        && dirtyVirtualizationNodeIds.length > 0;
    if(smartCanvasRenderInProgress){
        smartCanvasRenderQueuedSkipDynamicParamsRefresh = smartCanvasRenderQueued
            ? smartCanvasRenderQueuedSkipDynamicParamsRefresh
                && skipDynamicParamsRefresh
            : skipDynamicParamsRefresh;
        smartCanvasRenderQueuedPreserveMountedNodes = smartCanvasRenderQueued
            ? smartCanvasRenderQueuedPreserveMountedNodes
                && preserveMountedNodes
            : preserveMountedNodes;
        smartCanvasRenderQueued = true;
        smartCanvasRenderQueuedFullSync = smartCanvasRenderQueuedFullSync
            || fullVirtualizationSync;
        dirtyVirtualizationNodeIds.forEach(
            nodeId => smartCanvasRenderQueuedNodeIds.add(nodeId)
        );
        return;
    }
    smartCanvasRenderInProgress = true;
    const renderStartedAt = globalThis.performance?.now?.() ?? Date.now();
    const previousNodeGeometrySession = smartCanvasNodeGeometrySession;
    smartCanvasNodeGeometrySession = nodeGeometry.createSession({
        nodes,
        connections:canvas?.connections || []
    });
    try {
    const virtualizationState = canvasVirtualization.reconcile({
        fullSync:fullVirtualizationSync,
        nodeIds:dirtyVirtualizationNodeIds
    });
    const renderNodeIds = new Set(virtualizationState.ids);
    const materializationNodeIds = targetedReconciliation
        ? new Set(dirtyVirtualizationNodeIds.map(String).filter(id => renderNodeIds.has(id)))
        : renderNodeIds;
    const liveNodeIds = new Set(nodes.map(node => String(node?.id || '')).filter(Boolean));
    smartPlaybackResetForCanvas();
    rememberInlineVideoActivations();
    smartPlaybackReconcileSelection();
    smartPlaybackPruneEntries();
    smartCanvasPruneWarmNodes(liveNodeIds);
    world.classList.toggle('smart-multi-selected', window.SmartCanvasModules.viewportSelection.selection.ids().length > 1);
    world.querySelectorAll(':scope > .image-node').forEach(element => {
        element.classList.toggle(
            'selected',
            window.SmartCanvasModules.viewportSelection.selection.has(element.dataset.id)
        );
    });
    const mediaStates = captureMediaPlaybackStates();
    const reusableNodes = new Map();
    world.querySelectorAll('.image-node').forEach(el => {
        const node = nodes.find(n => n.id === el.dataset.id);
        if(smartNodeHasLiveMedia(node)) reusableNodes.set(node.id, el);
    });
    const canvasFarMode = canvasLevelOfDetail.diagnostics().mode === 'far';
    const nodeHtmlEntries = nodes
        .filter(node => node.id !== SMART_LOG_PREVIEW_NODE_ID && materializationNodeIds.has(node.id))
        // 分组节点先渲染（DOM 靠前→层级在下），作为成员的背板；成员渲染在后、盖在分组之上，
        // 否则缩小分组把成员挪进卡片区域时会被分组卡片背景遮住而“消失”。
        .slice()
        .sort((a, b) => {
            const rank = node => smartContainer.isFrame(node) ? 0 : smartContainer.isGroup(node) ? 1 : 2;
            return rank(a) - rank(b);
        })
        .map(node => {
        const imgs = node.images || [];
        const generationKind = referenceGenerationKind(node);
        const navigationTitle = smartContainer.isFrame(node)
            ? String(node.title || tr('smart.frameDefault'))
            : node.type === 'smart-group'
                ? String(['万能分组', '智能分组', 'Smart Group'].includes(node.title) ? tr('smart.smartGroup') : (node.title || tr('smart.smartGroup')))
                : '';
        const title = smartContainer.isFrame(node)
            ? `${escapeHtml(node.title || tr('smart.frameDefault'))}<span class="smart-frame-count">${smartContainer.frameMembers(node).length}</span>`
            : node.type === 'smart-group' ? escapeHtml(['万能分组', '智能分组', 'Smart Group'].includes(node.title) ? tr('smart.smartGroup') : (node.title || tr('smart.smartGroup'))) : nodeKinds.isPromptFamily(node) ? escapeHtml(smartPromptNodeTitle(node)) : node.type === 'smart-splitter' ? escapeHtml(tr('smart.separator')) : node.type === 'smart-loop' ? escapeHtml(tr('smart.loop')) : node.type === 'smart-brush' ? escapeHtml(tr('smart.brush')) : nodeKinds.isTextAnnotation(node) ? escapeHtml(tr('smart.text')) : (node.outputKind === 'depth-map' ? escapeHtml(node.title || tr('smart.depthMap')) : ((node.mattingJob || node.mattingResult) ? escapeHtml(node.title || tr('smart.mattingResult')) : (imgs.length ? escapeHtml(tr('smart.kindImage')) : generationKind ? escapeHtml(referenceGenerationTitle(node)) : escapeHtml(tr('smart.createImportNode')))));
        const scale = nodeScale(node);
        const layout = imageLayout(imgs, scale, node);
        const isPrompt = nodeKinds.isPromptFamily(node);
        const isSplitter = node.type === 'smart-splitter';
        const isLoop = node.type === 'smart-loop';
        const isSmartGroup = node.type === 'smart-group';
        const isFrame = smartContainer.isFrame(node);
        const isAnnotation = isSmartAnnotationNode(node);
        const isCompactMember = smartContainer.isCompactMember(node);
        const isImageNode = node.type === 'smart-image' || !node.type;
        const isJimengPending = Boolean(node.jimengPending && node.jimengPending.submitId && imgs.length === 0);
        const isMattingJob = Boolean(node.mattingJob && imgs.length === 0);
        const isQueued = Boolean(node.queued && imgs.length === 0 && !node.pending && !isJimengPending);
        const isFailed = generationNodeHasFailedRun(node);
        const isEmpty = isImageNode && imgs.length === 0 && !node.pending && !isQueued && !isJimengPending && !isMattingJob && !isFailed;
        const isHistory = isHistoryGroupNode(node);
        const isGroup = isImageNode && imgs.length > 1;
        const isPending = ((node.pending || isQueued || isJimengPending || smartMatting.isActive({job:node.mattingJob})) && imgs.length === 0);
        const nodeFarMode = smartCanvasNodeUsesFarPresentation(node.id);
        const nodeRole = nodeKinds.roleOf(node);
        const body = nodeFarMode ? farNodeBodyHtml(node, layout) : nodeBodyHtml(node, layout);
        const feedbackReason = node.generationRunFeedback?.reasonCategories?.[0]
            ? tr(`smart.error.${node.generationRunFeedback.reasonCategories[0]}.title`)
            : node.generationRunFeedback?.reasons?.[0] || '';
        const failureFeedback = !isFailed && node.generationRunFeedback?.failedCount
            ? trf('smart.runFeedback', {success: Number(node.generationRunFeedback.successfulCount || 0), failed: Number(node.generationRunFeedback.failedCount || 0), reason: feedbackReason ? ` · ${escapeHtml(feedbackReason)}` : ''})
            : '';
        const hint = nodeFarMode ? '' : failureFeedback || (isFailed || isEmpty || isAnnotation || isFrame ? '' : isSmartGroup ? tr('smart.groupHint') : isMattingJob ? (node.mattingJob.status === 'failed' ? tr('smart.retryOriginalImage') : escapeHtml(tr('smart.hintPending'))) : isPending ? escapeHtml(tr('smart.hintPending')) : (imgs.length > 1 ? escapeHtml(tr('smart.hintMulti')) : imgs.length ? escapeHtml(tr('smart.hintSingle')) : generationKind ? escapeHtml(tr('smart.referenceGenerationHint')) : escapeHtml(tr('smart.hintEmpty'))));
        const showQuickAdd = !nodeFarMode && !isAnnotation && !isFrame && !isCompactMember;
        const html = smartCanvasNodeComponentFamily().render({
            id:node.id,
            kind:nodeRole,
            title,
            body,
            layout,
            position:{x:node.x,y:node.y},
            frameColor:node.frameColor,
            states:{
                far:nodeFarMode,
                empty:isEmpty,
                referenceGeneration:Boolean(generationKind),
                mediaGroup:isGroup,
                history:isHistory,
                compact:isCompactMember,
                selected:window.SmartCanvasModules.viewportSelection.selection.has(node.id),
                dragging:Boolean(canvasInteraction.active('move-nodes')?.nodeIds.includes(node.id)),
                running:Boolean(node.running),
                pending:isPending,
                failed:isFailed
            },
            focusControl:'',
            runtimeStatus:canvasFarMode
                ? smartContainerNavigationBadgeHtml(node, navigationTitle)
                : nodeFarMode || body.includes('data-generation-pending-node') ? '' : runTimePillHtml(node),
            annotationSelection:isAnnotation
                ? '<div class="smart-annotation-selection" aria-hidden="true"><span data-corner="nw"></span><span data-corner="ne"></span><span data-corner="se"></span><span data-corner="sw"></span></div>'
                : '',
            compactGrab:isCompactMember && (isPrompt || isSplitter || isLoop)
                ? `<div class="smart-group-member-grab" title="${escapeAttr(tr('smart.dragOutOfGroup'))}"></div>`
                : '',
            hint,
            controls:{
                resizable:!nodeFarMode && Boolean(imgs.length || generationKind || node.pending || isQueued || isJimengPending || isMattingJob || isPrompt || isSplitter || isLoop || isSmartGroup || isFrame),
                quickAdd:showQuickAdd ? {
                    out:{label:tr('smart.referenceGenerate'),i18nLabel:'smart.referenceGenerate',menuId:'referenceGenerateMenu'},
                    in:{label:tr('smart.addUpstreamInput'),i18nLabel:'smart.addUpstreamInput',menuId:'upstreamInputMenu'}
                } : {}
            }
        });
        return {node, html};
    });
    const tpl = document.createElement('template');
    tpl.innerHTML = nodeHtmlEntries.map(entry => entry.html).join('');
    const renderedNodeEls = new Map();
    [...tpl.content.children].forEach(fresh => {
        const nodeId = fresh.dataset?.id || '';
        if(nodeId) renderedNodeEls.set(nodeId, fresh);
    });
    const mountedNodeEls = new Map();
    world.querySelectorAll(':scope > .image-node').forEach(element => {
        if(element.dataset.id) mountedNodeEls.set(element.dataset.id, element);
    });
    if(targetedReconciliation){
        dirtyVirtualizationNodeIds.forEach(nodeId => {
            if(liveNodeIds.has(String(nodeId))) return;
            mountedNodeEls.get(String(nodeId))?.remove();
        });
    }
    if(!targetedReconciliation) mountedNodeEls.forEach((element, nodeId) => {
        if(!renderNodeIds.has(nodeId)){
            const node = nodes.find(item => item.id === nodeId);
            if(!smartNodeHasLiveMedia(node) || !smartCanvasRememberWarmNode(nodeId,element)){
                element.remove();
            }
        }
    });
    reconcileConnectionLayer();
    const materializedNodeEls = [];
    nodeHtmlEntries.forEach(entry => {
        const fresh = renderedNodeEls.get(entry.node.id);
        if(!fresh) return;
        const signature = smartCanvasNodeRenderSignature(entry.node);
        fresh._smartCanvasRenderSignature = signature;
        const existing = mountedNodeEls.get(entry.node.id)
            || smartCanvasTakeWarmNode(entry.node.id);
        let materialized = fresh;
        const activeInteractionIds = canvasInteraction.active()?.nodeIds || [];
        const activeEditor = smartCanvasActiveEditorWithin(existing);
        const retainsInteractiveDom = Boolean(activeEditor)
            || activeInteractionIds.includes(entry.node.id)
            || preserveMountedNodes;
        if(
            activeEditor
            && existing?._smartCanvasRenderSignature !== signature
        ){
            smartCanvasDeferRenderUntilEditorBlur(activeEditor);
        }
        if(
            existing
            && (
                existing._smartCanvasRenderSignature === signature
                || retainsInteractiveDom
            )
        ){
            materialized = existing;
            materialized.style.left = `${entry.node.x || 0}px`;
            materialized.style.top = `${entry.node.y || 0}px`;
            materialized.style.width = fresh.style.width;
            materialized.style.height = fresh.style.height;
            materialized.classList.toggle(
                'selected',
                window.SmartCanvasModules.viewportSelection.selection.has(
                    entry.node.id
                )
            );
            materialized.classList.toggle(
                'dragging',
                activeInteractionIds.includes(entry.node.id)
            );
        } else if(existing && reconcileGenerationPendingNode(existing, fresh)){
            materialized = existing;
        } else if(existing){
            const sameLodMode = existing.classList.contains('canvas-lod-node-far')
                === fresh.classList.contains('canvas-lod-node-far');
            if(reusableNodes.has(entry.node.id) && sameLodMode){
                transplantSmartMediaElements(existing, fresh);
            }
            existing.replaceWith(fresh);
        }
        materializedNodeEls.push(materialized);
    });
    materializedNodeEls.forEach((element,index) => {
        if(element.isConnected) return;
        const nextConnected = materializedNodeEls
            .slice(index + 1)
            .find(candidate => candidate.isConnected);
        world.insertBefore(element,nextConnected || null);
    });
    restoreMediaPlaybackStates(mediaStates);
    bindNodeEvents();
    if(focusedPromptNodeId){
        const focusedNode = nodes.find(item => item.id === focusedPromptNodeId);
        if(!focusedNode || !nodeKinds.isPromptFamily(focusedNode) || focusedNode.textGenerationPending){
            setPromptNodeFocused('', false);
        }
    }
    updateComposer({skipDynamicParamsRefresh});
    syncSmartNodeFloatingPortal();
    window.SmartCanvasModules.viewportSelection.viewport.refresh();
    if(window.lucide) lucide.createIcons();
    bindSmartPreviewImageFallbacks(world);
    scheduleSmartAdaptiveImageResolution(0);
    measureSmartNodeImages();
    refreshRunTimerPills();
    const materializationDuration = (globalThis.performance?.now?.() ?? Date.now()) - renderStartedAt;
    const mountedNodeCount = world.querySelectorAll(':scope > .image-node').length;
    const warmNodeCount = smartCanvasWarmNodeCache.size;
    const warmMediaCount = smartCanvasWarmNodeMediaCount();
    canvasVirtualization.noteMaterialization({
        duration:materializationDuration,
        mountedNodeCount,
        warmNodeCount:smartCanvasWarmNodeCache.size,
        warmMediaCount
    });
    const imagePreviewCounts = {512:0,1024:0,2048:0,other:0};
    world.querySelectorAll(':scope > .image-node img[data-preview-src]').forEach(image => {
        const size = Number(image.dataset.previewSize)
            || smartPreviewSizeFromUrl(image.dataset.previewSrc || image.getAttribute('src'));
        if([512,1024,2048].includes(size)) imagePreviewCounts[size] += 1;
        else imagePreviewCounts.other += 1;
    });
    canvasLevelOfDetail.noteResources({
        renderSetCount:renderNodeIds.size,
        mountedNodeCount,
        warmNodeCount,
        warmMediaCount,
        imagePreviewCounts,
        videoElementCount:world.querySelectorAll(':scope > .image-node video').length,
        lastMaterializationDuration:materializationDuration
    });
    } finally {
        smartCanvasNodeGeometrySession = previousNodeGeometrySession;
        smartCanvasRenderInProgress = false;
        if(smartCanvasRenderQueued){
            smartCanvasRenderQueued = false;
            const queuedFullSync = smartCanvasRenderQueuedFullSync;
            smartCanvasRenderQueuedFullSync = false;
            const queuedNodeIds = [...smartCanvasRenderQueuedNodeIds];
            const queuedSkipDynamicParamsRefresh =
                smartCanvasRenderQueuedSkipDynamicParamsRefresh;
            const queuedPreserveMountedNodes =
                smartCanvasRenderQueuedPreserveMountedNodes;
            smartCanvasRenderQueuedNodeIds = new Set();
            smartCanvasRenderQueuedSkipDynamicParamsRefresh = false;
            smartCanvasRenderQueuedPreserveMountedNodes = false;
            queueMicrotask(() => render({
                syncVirtualization:queuedFullSync,
                nodeIds:queuedNodeIds,
                skipDynamicParamsRefresh:queuedSkipDynamicParamsRefresh,
                preserveMountedNodes:queuedPreserveMountedNodes
            }));
        }
    }
    return;
    world.innerHTML = '';
    reconcileConnectionLayer();
    const nodesHtml = nodes.map(node => {
        const imgs = node.images || [];
        const title = node.type === 'smart-prompt' ? 'Prompt' : node.type === 'smart-loop' ? escapeHtml(tr('smart.loop')) : (imgs.length > 1 ? 'Group' : 'Image');
        const scale = nodeScale(node);
        const layout = imageLayout(imgs, scale, node);
        const isPrompt = node.type === 'smart-prompt';
        const isLoop = node.type === 'smart-loop';
        const isImageNode = node.type === 'smart-image' || !node.type;
        const isQueued = Boolean(node.queued && imgs.length === 0 && !node.pending);
        const isEmpty = isImageNode && imgs.length === 0 && !node.pending && !isQueued;
        const isGroup = isImageNode && imgs.length > 1;
        const isPending = (node.pending || isQueued) && imgs.length === 0;
        const body = nodeBodyHtml(node, layout);
        return `<div class="image-node ${isEmpty ? 'empty-node' : ''} ${isGroup ? 'group-node' : ''} ${isPrompt ? 'prompt-smart-node' : ''} ${isLoop ? 'loop-smart-node' : ''} ${window.SmartCanvasModules.viewportSelection.selection.has(node.id) ? 'selected' : ''} ${canvasInteraction.active('move-nodes')?.nodeIds.includes(node.id) ? 'dragging' : ''} ${node.running ? 'node-running' : ''} ${isPending ? 'node-pending' : ''}" data-id="${escapeHtml(node.id)}" style="left:${node.x || 0}px;top:${node.y || 0}px;width:${layout.width}px;height:${layout.height}px">
            <div class="node-head"><div class="node-title">${title}</div><div class="node-actions"></div></div>
            ${runTimePillHtml(node)}
            <div class="node-body">${body}</div>
            <div class="node-hint">${isPending ? escapeHtml(tr('smart.hintPending')) : (imgs.length > 1 ? escapeHtml(tr('smart.hintMulti')) : imgs.length ? escapeHtml(tr('smart.hintSingle')) : escapeHtml(tr('smart.hintEmpty')))}</div>
            ${imgs.length || node.pending || isQueued || isPrompt || isLoop ? '<div class="node-resize-handle" data-resize="1"></div>' : ''}
        </div>`;
    }).join('');
    world.insertAdjacentHTML('beforeend', nodesHtml);
    bindNodeEvents();
    updateComposer();
    window.SmartCanvasModules.viewportSelection.viewport.refresh();
    if(window.lucide) lucide.createIcons();
    measureSmartNodeImages();
    refreshRunTimerPills();
}
function measureSmartNodeImages(){
    world.querySelectorAll('.image-node img,.image-node video').forEach(imgEl => {
        const nodeEl = imgEl.closest('.image-node');
        const itemEl = imgEl.closest('[data-image-index]');
        const containerNode = nodes.find(n => n.id === nodeEl?.dataset.id);
        const targetNodeId = itemEl?.dataset.refNodeId || nodeEl?.dataset.id;
        const index = Number(itemEl?.dataset.refImageIndex ?? itemEl?.dataset.imageIndex ?? 0);
        const node = nodes.find(n => n.id === targetNodeId);
        const image = node?.images?.[index];
        if(imgEl.tagName?.toLowerCase() === 'img' && image?.url) bindImageProxyFallback(imgEl, image);
        if(!node || !image) return;
        const hasNaturalSize = () => Boolean(window.SmartCanvasModules.imageMetadata.dimensions({natural_w:image.natural_w,natural_h:image.natural_h}));
        if(hasNaturalSize()) return;
        const sourceUrl = image.url;
        const isCurrentImage = () => nodes.find(candidate => candidate.id === targetNodeId)?.images?.[index] === image && image.url === sourceUrl;
        const isPreview = isSmartPreviewImage(imgEl);
        const originalSrc = imgEl.dataset?.originalSrc || image.url || '';
        if(isPreview && imgEl.dataset?.previewKind !== 'video' && originalSrc && !image._naturalSizeLoading){
            image._naturalSizeLoading = true;
            loadSmartOriginalImageDimensions(originalSrc).then(size => {
                image._naturalSizeLoading = false;
                if(!size || !isCurrentImage() || hasNaturalSize()) return;
                image.natural_w = size.w;
                image.natural_h = size.h;
                delete image.layout_w;
                delete image.layout_h;
                applyThumbDisplaySizeToElement(itemEl, image, Math.max(itemEl?.clientWidth || 0, itemEl?.clientHeight || 0));
                refreshImageResolutionBadgesForMedia(targetNodeId, index, image);
                if(!smartContainer.isGroup(node) && (node.images || []).length === 1 && !node.w && !node.h){
                    const layout = singleImageLayout(image, node, mediaNodeDefaultScale(node));
                    node.w = layout.width;
                    node.h = layout.height;
                }
                syncNodeElementLayout(node);
                if(containerNode && containerNode.id !== node.id) syncNodeElementLayout(containerNode);
                if(window.SmartCanvasModules.viewportSelection.selection.has(node.id)) updateComposer();
                canvasPersistence.schedule();
            });
        }
        if(isPreview && image.layout_w && image.layout_h) return;
        const apply = () => {
            const w = imgEl.naturalWidth || imgEl.videoWidth || 0;
            const h = imgEl.naturalHeight || imgEl.videoHeight || 0;
            if(w <= 0 || h <= 0 || !isCurrentImage() || hasNaturalSize()) return;
            const prevW = Number(image.layout_w || 0);
            const prevH = Number(image.layout_h || 0);
            if(isPreview){
                if(prevW === w && prevH === h) return;
                image.layout_w = w;
                image.layout_h = h;
            } else {
                image.natural_w = w;
                image.natural_h = h;
                delete image.layout_w;
                delete image.layout_h;
            }
            applyThumbDisplaySizeToElement(itemEl, image, Math.max(itemEl?.clientWidth || 0, itemEl?.clientHeight || 0));
            refreshImageResolutionBadgesForMedia(targetNodeId, index, image);
            if(!smartContainer.isGroup(node) && (node.images || []).length === 1 && !node.w && !node.h){
                const layout = singleImageLayout(image, node, mediaNodeDefaultScale(node));
                node.w = layout.width;
                node.h = layout.height;
            }
            syncNodeElementLayout(node);
            if(containerNode && containerNode.id !== node.id) syncNodeElementLayout(containerNode);
            if(window.SmartCanvasModules.viewportSelection.selection.has(node.id)) updateComposer();
            canvasPersistence.schedule();
        };
        const isVideo = imgEl.tagName?.toLowerCase() === 'video';
        if(!isVideo && imgEl.complete) apply();
        else imgEl.addEventListener('load', apply, {once:true});
        imgEl.addEventListener('loadedmetadata', apply, {once:true});
    });
}
function ensurePortDragPathElement(){
    const svg = world.querySelector('svg.connection-layer');
    if(!svg) return null;
    let path = svg.querySelector('path.port-drag-temp');
    if(!path){
        path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'port-drag-temp conn-pending');
        path.setAttribute('stroke', 'rgba(100,116,139,0.92)');
        path.setAttribute('stroke-width', '1.9');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        svg.appendChild(path);
    }
    return path;
}
function clearPortDragVisual(){
    world.querySelectorAll('path.port-drag-temp').forEach(path => path.remove());
    world.querySelectorAll('[data-port].is-active').forEach(el => el.classList.remove('is-active'));
    world.querySelectorAll('.smart-node-quick-add-zone.is-port-target').forEach(zone => zone.classList.remove('is-port-target'));
    world.querySelectorAll('.image-node.port-hover').forEach(el => el.classList.remove('port-hover'));
}
function beginSmartNodePortDrag(nodeId, portType, event, options={}){
    if(event?.button !== 0 || !nodeId || !['in','out'].includes(portType)) return false;
    event.stopPropagation();
    const point = window.SmartCanvasModules.viewportSelection.viewport.screenToWorld(event);
    portDragState = {
        fromId:nodeId,
        fromPort:portType,
        currentWorld:point,
        hoverTargetId:'',
        hoverPort:'',
        moved:false,
        startClientX:event.clientX,
        startClientY:event.clientY,
        sourceTrigger:options.trigger || null
    };
    canvasMutation.history({action:'capture'});
    return true;
}
function beginPromptNodeTextEdit(nodeId, pointer=null){
    const node = nodes.find(item => item.id === nodeId && item.type === 'smart-prompt');
    if(!node || node.textGenerationPending) return false;
    const selector = node.llmEnabled ? '.prompt-llm-instruction' : '.prompt-node-text';
    const text = promptNodeFocusSurface?.querySelector(`.image-node[data-id="${CSS.escape(node.id)}"] ${selector}`)
        || world.querySelector(`.image-node[data-id="${CSS.escape(node.id)}"] ${selector}`);
    if(!text) return false;
    canvasVirtualization.pin(node.id,'inline-editor');
    text._editStartHtml = String(
        node.llmEnabled ? (node.llmInstructionHtml || '') : (node.textHtml || '')
    );
    text._editStartText = String(node.llmEnabled ? (node.llmInstruction || '') : (node.text || ''));
    text.contentEditable = 'true';
    text.classList.add('is-editing');
    text.focus({preventScroll:true});
    if(!placeCaretFromPointer(text, pointer)) setPromptCaretToEnd(text);
    return true;
}
function bindPromptNodeInputThumbs(el, node){
    const root = el.querySelector('.prompt-node-input-thumbs');
    if(!root) return;
    const refs = promptNodeInputImages(node);
    const manualRefKeys = new Set(manualReferenceImagesFor(node).map(img => inputRefKey(img)));
    const onRefresh = () => render();
    bindSmartPreviewImageFallbacks(root);
    bindInputThumbsDrag(node, refs, manualRefKeys, {root,onRefresh});
    bindInputThumbReferenceActions(root, node, {onRefresh});
}
function bindPromptNodeRichEditor(container, node, editor, {instruction=false}={}){
    if(!editor) return;
    bindPromptCharacterCount(editor);
    const sync = () => instruction
        ? syncPromptLlmInstructionEditor(node, editor)
        : syncPromptNodeEditor(node, editor);
    const restore = () => {
        if(instruction){
            node.llmInstructionHtml = editor._editStartHtml || '';
            node.llmInstruction = editor._editStartText || '';
            editor.innerHTML = promptLlmInstructionEditorHtml(node);
        } else {
            node.textHtml = editor._editStartHtml || '';
            node.text = editor._editStartText || '';
            editor.innerHTML = promptNodeEditorHtml(node);
            refreshAllSplitterNodePreviews();
        }
        canvasPersistence.schedule();
    };
    bindScrollableText(editor);
    editor.addEventListener('mousedown', event => {
        if(editor.isContentEditable){
            event.stopPropagation();
            return;
        }
        if(event.button === 0 && event.detail >= 2){
            event.preventDefault();
            event.stopPropagation();
            requestAnimationFrame(() => beginPromptNodeTextEdit(node.id, event));
        }
    });
    editor.addEventListener('click', event => {
        if(!event.target.closest?.('ic-mention-picker')) closeMentionPicker();
        if(editor.isContentEditable || event.detail >= 2) event.stopPropagation();
    });
    editor.addEventListener('dblclick', event => {
        event.preventDefault();
        event.stopPropagation();
        beginPromptNodeTextEdit(node.id, event);
    });
    editor.oninput = event => {
        sync();
        maybeOpenMentionPicker(editor, node, {
            allowOpen:promptAuthoring.quickOpenIntent(event)
        });
    };
    editor.addEventListener('compositionstart', () => {
        promptQuickComposing = true;
    });
    editor.addEventListener('compositionend', event => {
        promptQuickComposing = false;
        sync();
        maybeOpenMentionPicker(editor, node, {
            allowOpen:promptAuthoring.quickOpenIntent({
                data:event.data,
                inputType:'insertText'
            })
        });
    });
    editor.onkeydown = event => {
        if(handlePromptQuickPickerKeydown(event, editor)) return;
        if(event.key === 'Escape'){
            if(focusedPromptNodeId === node.id && container.closest('.prompt-node-focus-surface')) return;
            event.preventDefault();
            event.stopPropagation();
            restore();
            editor.blur();
        } else if((event.ctrlKey || event.metaKey) && event.key === 'Enter'){
            event.preventDefault();
            editor.blur();
        }
    };
    editor.onkeyup = event => {
        if(event.key === 'ArrowDown' || event.key === 'ArrowUp') return;
        if(editor.isContentEditable) maybeOpenMentionPicker(editor, node);
    };
    editor.onmouseup = () => {
        if(editor.isContentEditable) saveMentionRange(editor);
    };
    editor.onfocus = () => {
        if(editor.isContentEditable) saveMentionRange(editor);
    };
    editor.onblur = () => {
        if(promptQuickTargetEl === editor) closeMentionPicker();
        editor.contentEditable = 'false';
        editor.classList.remove('is-editing');
        canvasVirtualization.unpin(node.id,'inline-editor');
    };
}
function bindPromptNodeControls(el, node){
    el.querySelectorAll('.prompt-node-control:not(.prompt-node-text):not(.prompt-llm-instruction):not(.prompt-node-input-thumbs)').forEach(control => {
        control.addEventListener('mousedown', e => e.stopPropagation());
        control.addEventListener('click', e => e.stopPropagation());
        control.addEventListener('dblclick', e => e.stopPropagation());
    });
    bindPromptNodeInputThumbs(el, node);
    const textEl = el.querySelector('.prompt-node-text');
    bindPromptNodeRichEditor(el, node, textEl);
    const modelEl = el.querySelector('.prompt-llm-model');
    if(modelEl) modelEl.onclick = e => e.stopPropagation();
    if(modelEl) modelEl.onchange = e => {
        e.stopPropagation();
        void modelEl.hide();
        const entry = smartModelCatalog('text').find(item => item.id === modelEl.value);
        if(!entry) return;
        node.llmProvider = entry.provider_id;
        node.llmModel = entry.model;
        render();
        canvasPersistence.schedule();
    };
    const instructionEl = el.querySelector('.prompt-llm-instruction');
    bindPromptNodeRichEditor(el, node, instructionEl, {instruction:true});
    const runEl = el.querySelector('.prompt-node-run');
    if(runEl) runEl.onclick = e => { e.preventDefault(); e.stopPropagation(); runPromptLLMNode(node.id); };
}
function bindSplitterNodeControls(el, node){
    const separatorEl = el.querySelector('.splitter-node-separator');
    if(!separatorEl) return;
    bindScrollableText(separatorEl);
    separatorEl.addEventListener('click', e => e.stopPropagation());
    separatorEl.addEventListener('dblclick', e => e.stopPropagation());
    separatorEl.oninput = () => {
        node.separator = separatorEl.value || ';';
        refreshSplitterNodePreview(node);
        canvasPersistence.schedule();
    };
}
function bindLoopNodeControls(el, node){
    el.querySelectorAll('.loop-smart-control').forEach(control => {
        control.addEventListener('mousedown', e => e.stopPropagation());
        control.addEventListener('click', e => e.stopPropagation());
        control.addEventListener('dblclick', e => e.stopPropagation());
    });
    const loopNumberBounds = key => {
        if(key === 'loopStart') return {min:1, max:9999};
        if(key === 'imageBatchSize') return {min:1, max:100};
        return {min:1, max:100};
    };
    const normalizeLoopNumber = (key, rawValue) => {
        const bounds = loopNumberBounds(key);
        return Math.max(bounds.min, Math.min(bounds.max, Number(rawValue) || bounds.min));
    };
    const syncLoopNumberUi = (source, key, value) => {
        const control = source?.closest?.('.loop-number-control');
        if(!control) return;
        const display = control.querySelector('.loop-number-trigger strong');
        if(display) display.textContent = value;
        control.querySelectorAll('[data-loop-value]').forEach(cell => {
            cell.classList.toggle('active', Number(cell.dataset.loopValue) === value);
        });
        if(key === 'count'){
            const summary = el.querySelector('.loop-smart-run-summary');
            if(summary) summary.textContent = trf('smart.batchWillRun', {n:value});
            const runLabel = el.querySelector('[data-loop-run-label]');
            if(runLabel && !generationRun.status({node}).loopRunning){
                runLabel.textContent = trf('smart.loopRunAll', {n:value});
            }
        }
    };
    const setLoopNumber = (key, rawValue, rerender=true, source=null) => {
        const value = normalizeLoopNumber(key, rawValue);
        if(key === 'count') node.count = smartLoopCount({count:value});
        if(key === 'loopStart') node.loopStart = value;
        if(key === 'imageBatchSize') node.imageBatchSize = value;
        canvasPersistence.schedule();
        if(rerender) render();
        else syncLoopNumberUi(source, key, value);
    };
    el.querySelectorAll('.loop-number-trigger').forEach(trigger => {
        const control = trigger.closest('.loop-number-control');
        const popover = control?.querySelector('ic-popover');
        const showPopover = () => {
            if(popover && !popover.hasAttribute('open')) popover.show(trigger);
        };
        const hidePopover = () => {
            if(popover && !control?.contains(document.activeElement)) popover.hide('hover-leave');
        };
        control?.addEventListener('mouseenter', showPopover);
        control?.addEventListener('mouseleave', hidePopover);
        trigger.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            showPopover();
        };
    });
    el.querySelectorAll('[data-loop-number]').forEach(btn => {
        btn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            btn.closest('ic-popover')?.hide('selection');
            setLoopNumber(btn.dataset.loopNumber, btn.dataset.loopValue, true);
        };
    });
    el.querySelectorAll('[data-loop-number-input]').forEach(input => {
        input.oninput = e => {
            e.stopPropagation();
            setLoopNumber(input.dataset.loopNumberInput, input.value, false, input);
        };
        input.onchange = e => {
            e.stopPropagation();
            input.closest('ic-popover')?.hide('selection');
            setLoopNumber(input.dataset.loopNumberInput, input.value, true);
        };
    });
    const modeControl = el.querySelector('.loop-smart-seg');
    modeControl?.addEventListener('ic-change', e => {
        e.stopPropagation();
        node.mode = e.detail?.value === 'parallel' ? 'parallel' : 'serial';
        render();
        canvasPersistence.schedule();
    });
    el.querySelectorAll('[data-loop-toggle]').forEach(btn => {
        btn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            if(btn.dataset.loopToggle === 'image') node.imageInput = btn.pressed;
            if(btn.dataset.loopToggle === 'prompt') {
                node.showPrompt = btn.pressed;
                if(node.showPrompt && !smartLoopInputPromptItems(node).length && !smartLoopActivePromptFieldValues(node).length) setSmartLoopPromptFieldValues(node, [smartLoopDefaultPromptText()]);
            }
            fitSmartLoopNode(node);
            render();
            canvasPersistence.schedule();
        };
    });
    const syncPromptFieldsFromDom = () => {
        const values = [...el.querySelectorAll('[data-loop-prompt-index]')]
            .sort((a, b) => Number(a.dataset.loopPromptIndex) - Number(b.dataset.loopPromptIndex))
            .map(input => smartLoopEditorText(input));
        setSmartLoopPromptFieldValues(node, values);
        const promptOptionCount = el.querySelector('[data-loop-option-count="prompt"]');
        if(promptOptionCount){
            const count = Math.max(smartLoopInputPromptItems(node).length, smartLoopActivePromptFieldValues(node).length);
            promptOptionCount.textContent = trf('smart.batchOptionCount', {n:count});
        }
    };
    let activePromptEditor = null;
    el.querySelectorAll('.loop-smart-text').forEach(text => {
        bindScrollableText(text);
        text.onfocus = () => { activePromptEditor = text; };
        text.oninput = () => { syncPromptFieldsFromDom(); canvasPersistence.schedule(); };
        text.addEventListener('click', e => {
            const remove = e.target.closest?.('[data-loop-token-remove]');
            if(!remove) return;
            e.preventDefault();
            e.stopPropagation();
            remove.closest('.loop-smart-token-chip')?.remove();
            syncPromptFieldsFromDom();
            canvasPersistence.schedule();
        });
    });
    el.querySelectorAll('[data-loop-prompt-add]').forEach(btn => {
        btn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            syncPromptFieldsFromDom();
            const values = smartLoopPromptFieldValues(node);
            setSmartLoopPromptFieldValues(node, [...values, '']);
            fitSmartLoopNode(node);
            render();
            canvasPersistence.schedule();
        };
    });
    el.querySelectorAll('[data-loop-prompt-delete]').forEach(btn => {
        btn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            syncPromptFieldsFromDom();
            const removeIndex = Number(btn.dataset.loopPromptDelete);
            const values = smartLoopPromptFieldValues(node);
            if(values.length <= 1) return;
            values.splice(removeIndex, 1);
            setSmartLoopPromptFieldValues(node, values);
            fitSmartLoopNode(node);
            render();
            canvasPersistence.schedule();
        };
    });
    const firstText = el.querySelector('.loop-smart-text');
    const targetPromptEditor = () => activePromptEditor && el.contains(activePromptEditor) ? activePromptEditor : firstText;
    el.querySelectorAll('[data-loop-token]').forEach(btn => {
        btn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            const text = targetPromptEditor();
            if(!text) return;
            const token = btn.dataset.loopToken || '《计数》';
            insertSmartLoopToken(text, token);
            syncPromptFieldsFromDom();
            canvasPersistence.schedule();
        };
    });
    el.querySelectorAll('[data-loop-run]').forEach(btn => {
        btn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            const loopId = btn.dataset.loopRun || node.id;
            if(generationRun.status({nodeId:loopId}).loopRunning){
                generationRun.stop({loopId});
                return;
            }
            generationRun.run({nodeId:loopId, mode:'loop'});
        };
    });
}
function bindScrollableText(el){
    if(!el || el.dataset.scrollBound === '1') return;
    el.dataset.scrollBound = '1';
    const textSelectionEnabled = () => {
        if(el.classList.contains('prompt-node-text')) return el.isContentEditable;
        if(el.classList.contains('prompt-llm-instruction')) return !el.readOnly;
        return true;
    };
    const canvasMarqueeActive = () => typeof selectionState !== 'undefined' && Boolean(selectionState);
    const canvasPanOwnsPointer = () => Boolean(
        (typeof panState !== 'undefined' && panState)
        || (typeof smartSpacePan !== 'undefined' && smartSpacePan)
        || (typeof smartMiddlePan !== 'undefined' && smartMiddlePan)
        || (typeof smartBaseTool !== 'undefined' && smartBaseTool === 'hand')
    );
    const stop = e => {
        if(textSelectionEnabled()) e.stopPropagation();
    };
    const beginSelection = e => {
        if(!textSelectionEnabled() || canvasPanOwnsPointer()) return;
        e.stopPropagation();
        textSelectionGuard = {
            el,
            scrollTop:el.scrollTop || 0,
            scrollLeft:el.scrollLeft || 0,
            clientY:e.clientY,
            wheelUntil:0,
            active:true
        };
    };
    el.addEventListener('mousedown', beginSelection);
    el.addEventListener('mousemove', e => {
        if(!textSelectionEnabled() || canvasMarqueeActive() || canvasPanOwnsPointer()) return;
        e.stopPropagation();
        if(textSelectionGuard?.el === el) textSelectionGuard.clientY = e.clientY;
    });
    el.addEventListener('mouseup', e => {
        if(!textSelectionEnabled() || canvasMarqueeActive() || canvasPanOwnsPointer()) return;
        e.stopPropagation();
        if(textSelectionGuard?.el === el) textSelectionGuard.active = false;
    });
    el.addEventListener('mouseleave', e => {
        if(!textSelectionEnabled() || canvasMarqueeActive() || canvasPanOwnsPointer()) return;
        e.stopPropagation();
        if(textSelectionGuard?.el === el) {
            el.scrollTop = textSelectionGuard.scrollTop;
            el.scrollLeft = textSelectionGuard.scrollLeft;
        }
    });
    el.addEventListener('scroll', () => {
        const guard = textSelectionGuard;
        if(!guard || guard.el !== el || !guard.active || Date.now() < guard.wheelUntil) {
            if(guard?.el === el) {
                guard.scrollTop = el.scrollTop || 0;
                guard.scrollLeft = el.scrollLeft || 0;
            }
            return;
        }
        const nextTop = el.scrollTop || 0;
        const prevTop = guard.scrollTop || 0;
        const rect = el.getBoundingClientRect();
        const pointerBelow = Number.isFinite(guard.clientY) && guard.clientY > rect.bottom - 10;
        const pointerAbove = Number.isFinite(guard.clientY) && guard.clientY < rect.top + 10;
        const jumpedToTop = prevTop > Math.max(80, el.clientHeight * 0.45) && nextTop < 4 && !pointerAbove;
        const wrongDirectionJump = pointerBelow && nextTop < prevTop - Math.max(40, el.clientHeight * 0.25);
        if(jumpedToTop || wrongDirectionJump) {
            requestAnimationFrame(() => {
                if(textSelectionGuard?.el === el && textSelectionGuard.active) {
                    el.scrollTop = prevTop;
                    el.scrollLeft = guard.scrollLeft || 0;
                }
            });
            return;
        }
        guard.scrollTop = nextTop;
        guard.scrollLeft = el.scrollLeft || 0;
    }, {passive:true});
    el.addEventListener('click', stop);
    el.addEventListener('dblclick', stop);
    el.addEventListener('wheel', e => {
        if(e.metaKey || e.ctrlKey || canvasPanOwnsPointer()) return;
        if(!promptNodeWheelPriorityActive(el)) return;
        if(!localScrollableHasOverflow(el)) return;
        e.stopPropagation();
        if(textSelectionGuard?.el === el) textSelectionGuard.wheelUntil = Date.now() + 180;
    }, {passive:true});
}
function updatePortDragVisual(){
    if(!portDragState) return;
    const fromNode = nodes.find(n => n.id === portDragState.fromId);
    if(!fromNode) return;
    const fr = nodeRect(fromNode);
    const isOut = portDragState.fromPort === 'out';
    let fx = isOut ? fr.x + fr.width : fr.x;
    let fy = fr.y + fr.height / 2;
    if(portDragState.sourceTrigger?.isConnected){
        const sourceRect = portDragState.sourceTrigger.getBoundingClientRect();
        const sourcePoint = window.SmartCanvasModules.viewportSelection.viewport.screenToWorld({
            clientX:sourceRect.left + sourceRect.width / 2,
            clientY:sourceRect.top + sourceRect.height / 2
        });
        fx = sourcePoint.x;
        fy = sourcePoint.y;
    }
    const tx = portDragState.currentWorld.x;
    const ty = portDragState.currentWorld.y;
    const dx = Math.max(50, Math.abs(tx - fx) * 0.45);
    const sign = isOut ? 1 : -1;
    const path = ensurePortDragPathElement();
    if(path) path.setAttribute('d', `M${fx} ${fy} C ${fx + dx * sign} ${fy}, ${tx - dx * sign} ${ty}, ${tx} ${ty}`);
    world.querySelectorAll('[data-port].is-active').forEach(el => el.classList.remove('is-active'));
    world.querySelectorAll('.smart-node-quick-add-zone.is-port-target').forEach(zone => zone.classList.remove('is-port-target'));
    world.querySelectorAll('.image-node.port-hover').forEach(el => el.classList.remove('port-hover'));
    if(portDragState.hoverTargetId){
        const targetNodeEl = world.querySelector(`.image-node[data-id="${portDragState.hoverTargetId}"]`);
        const targetTrigger = targetNodeEl?.querySelector(`[data-port="${portDragState.hoverPort}"]`);
        targetNodeEl?.classList.add('port-hover');
        targetTrigger?.closest('.smart-node-quick-add-zone')?.classList.add('is-port-target');
        targetTrigger?.classList.add('is-active');
    }
}
function smartPortDropTarget(event, fromId='', fromPort=''){
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const portEl = hit?.closest?.('[data-port]');
    const targetPort = fromPort === 'out'
        ? 'in'
        : fromPort === 'in'
            ? 'out'
            : '';
    let nodeEl = portEl?.closest?.('.image-node')
        || hit?.closest?.('.image-node');
    const directTargetNode = nodes.find(node => node.id === nodeEl?.dataset.id);
    if((!nodeEl || smartContainer.isFrame(directTargetNode)) && targetPort){
        const candidates = [...world.querySelectorAll('.image-node[data-id]')]
            .filter(element => element.dataset.id !== fromId)
            .filter(element => element.querySelector(`[data-port="${targetPort}"]`))
            .map(element => {
                const rect = element.getBoundingClientRect();
                const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
                const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
                return {element,rect,distance:Math.hypot(dx,dy)};
            })
            .filter(candidate => (
                event.clientX >= candidate.rect.left - SMART_PORT_DROP_TARGET_EXPANSION_PX
                && event.clientX <= candidate.rect.right + SMART_PORT_DROP_TARGET_EXPANSION_PX
                && event.clientY >= candidate.rect.top - SMART_PORT_DROP_TARGET_EXPANSION_PX
                && event.clientY <= candidate.rect.bottom + SMART_PORT_DROP_TARGET_EXPANSION_PX
            ))
            .sort((left,right) => left.distance - right.distance);
        nodeEl = candidates[0]?.element || nodeEl;
    }
    if(
        !nodeEl
        || !nodeEl.dataset.id
        || nodeEl.dataset.id === fromId
    ){
        return {targetId:'',targetPort:'',hit,blocked:false};
    }
    const targetNode = nodes.find(node => node.id === nodeEl.dataset.id);
    if(smartContainer.isFrame(targetNode)){
        const frameControl = hit?.closest?.(
            '.smart-frame-node .node-head,'
            + '.smart-frame-node .node-resize-handle,'
            + '.smart-frame-node .smart-container-navigation-badge'
        );
        return {targetId:'',targetPort:'',hit,blocked:Boolean(frameControl)};
    }
    if(targetPort && !nodeEl.querySelector(`[data-port="${targetPort}"]`)){
        return {targetId:'',targetPort:'',hit,blocked:false};
    }
    let resolvedTargetPort = targetPort;
    if(!resolvedTargetPort && portEl){
        resolvedTargetPort = portEl.dataset.port;
    } else if(!resolvedTargetPort) {
        const rect = nodeEl.getBoundingClientRect();
        resolvedTargetPort = event.clientX - rect.left < rect.width / 2
            ? 'in'
            : 'out';
    }
    return {
        targetId:nodeEl.dataset.id,
        targetPort:resolvedTargetPort,
        hit,
        blocked:false
    };
}
function closeReferenceGenerateMenu(options={}){
    const state = referenceGenerateMenuState;
    const hadPendingChoice = Boolean(state);
    referenceGenerateMenuState = null;
    if(hadPendingChoice) smartNodeQuickAddSuppressKeyboardFocusUntil = Date.now() + 20;
    state?.menu?.hide?.('programmatic');
    if(hadPendingChoice && !options.restoreFocus){
        const blurTrigger = () => {
            state?.trigger?.shadowRoot?.activeElement?.blur?.();
            state?.trigger?.blur?.();
        };
        blurTrigger();
        setTimeout(blurTrigger, 0);
    }
    state?.trigger?.closest('.image-node')?.classList.remove('reference-menu-source');
    unlockSmartNodeQuickAdd('menu');
    if(hadPendingChoice) clearPortDragVisual();
    if(hadPendingChoice && options.discardUndo !== false) canvasMutation.history({action:'discard'});
    if(options.restoreFocus) state?.trigger?.focus?.({preventScroll:true});
}
function openReferenceGenerateMenu(drag, event, options={}){
    const menu = drag.multiInput ? multiReferenceGenerateMenu : drag.fromPort === 'in' ? upstreamInputMenu : referenceGenerateMenu;
    if(!menu) return false;
    const clientX = Number.isFinite(Number(options.clientX))
        ? Number(options.clientX)
        : event.clientX;
    const clientY = Number.isFinite(Number(options.clientY))
        ? Number(options.clientY)
        : event.clientY;
    referenceGenerateMenuState = {
        drag:{fromId:drag.fromId, fromPort:drag.fromPort,...(drag.multiInput ? {multiInput:drag.multiInput} : {})},
        point:drag.multiInput
            ? options.point
            : options.point || window.SmartCanvasModules.viewportSelection.viewport.screenToWorld(event),
        clientX,
        clientY,
        trigger:options.trigger || null,
        menu
    };
    options.trigger?.closest('.image-node')?.classList.add('reference-menu-source');
    lockSmartNodeQuickAdd(options.trigger, 'menu');
    menu.showAt(clientX, clientY, options.trigger || shell);
    return true;
}
function referenceGeneratePointForNode(node, fromPort='out'){
    const layout = imageLayout(node.images || [], nodeScale(node), node);
    const isInput = fromPort === 'in';
    return {
        x:isInput
            ? Number(node.x || 0) - 72 - EMPTY_UPLOAD_NODE_WIDTH / 2
            : Number(node.x || 0) + layout.width + 72 + EMPTY_UPLOAD_NODE_WIDTH / 2,
        y:Number(node.y || 0) + layout.height / 2
    };
}
function openReferenceGenerateMenuFromNode(node, trigger, event, fromPort='out'){
    if(
        !node
        || !trigger
        || isSmartAnnotationNode(node)
        || smartContainer.isFrame(node)
        || smartContainer.isCompactMember(node)
    ){
        return false;
    }
    const isInput = fromPort === 'in';
    const point = referenceGeneratePointForNode(node, fromPort);
    const triggerRect = trigger.getBoundingClientRect();
    const clientX = Number.isFinite(Number(event.clientX))
        ? Number(event.clientX)
        : isInput ? triggerRect.left : triggerRect.right;
    const clientY = Number.isFinite(Number(event.clientY))
        ? Number(event.clientY)
        : triggerRect.top + triggerRect.height / 2;
    closeCreateMenu();
    closeSmartNodeContextMenu();
    canvasMutation.history({action:'capture'});
    if(openReferenceGenerateMenu(
        {fromId:node.id,fromPort},
        event,
        {point,trigger,clientX,clientY}
    )){
        return true;
    }
    canvasMutation.history({action:'discard'});
    return false;
}
function referenceGenerationSettings(sourceNode, kind){
    const sourceSettings = smartSettingsForNode(sourceNode);
    const requestedEngine = kind === 'video' && !isApiLikeEngine(sourceSettings.engine)
        ? 'api'
        : sourceSettings.engine;
    const modeSettings = {...sourceSettings, engine:requestedEngine, apiKind:kind};
    const recent = recentSmartSettingsForMode(smartSettingsModeKey(modeSettings));
    const next = {...modeSettings, ...recent, engine:requestedEngine, apiKind:kind};
    normalizeSmartVideoModeSettings(next, kind === 'video');
    sanitizeSmartApiSelection(next);
    return settingsForStorage(next);
}
function createReferencedNode({sourceNode, fromPort='out', kind='image', point, explicitPoint=false}={}){
    if(!sourceNode || !point || !['text','image','video'].includes(kind)){
        canvasMutation.history({action:'discard'});
        return null;
    }
    const p = point;
    const isUpstreamInput = fromPort === 'in';
    const placement = {
        anchor:{kind:'source',sourceNodeId:sourceNode.id},
        relation:isUpstreamInput ? 'upstream' : 'downstream',
        arrangement:'single'
    };
    const exactOptions = {skipUndo:true,positionMode:'exact',reveal:true};
    const placementOptions = {skipUndo:true,placement,reveal:true};
    const createOptions = explicitPoint ? exactOptions : placementOptions;
    let created = null;
    if(kind === 'text'){
        const stablePromptHeight = isUpstreamInput ? 180 : 397;
        const exactX = explicitPoint
            ? isUpstreamInput ? p.x - 316 : p.x
            : p.x - 158;
        created = canvasMutation.create({
            kind:'prompt',
            data:{x:exactX,y:p.y - stablePromptHeight / 2,w:316,h:stablePromptHeight},
            options:createOptions
        });
        if(!isUpstreamInput){
            created.llmEnabled = true;
            created.title = tr('smart.promptGenerationNode');
        }
        created.w = Math.max(Number(created.w) || 0, 316);
    } else {
        let imagePoint = p;
        if(explicitPoint){
            const emptyLayout = imageLayout([],MEDIA_NODE_DEFAULT_SCALE,{type:'smart-image',images:[]});
            imagePoint = {
                x:p.x + (isUpstreamInput ? -1 : 1) * emptyLayout.width / 2,
                y:p.y
            };
        }
        created = createImageNodeAt(imagePoint, [], {select:true,...createOptions});
        if(isUpstreamInput){
            created.uploadMediaKind = kind;
        } else {
            created.referenceGenerationKind = kind;
            created.title = kind === 'video' ? tr('smart.referenceVideoNode') : tr('smart.referenceImageNode');
            created.runSettings = referenceGenerationSettings(sourceNode, kind);
        }
    }
    if(!created){ canvasMutation.history({action:'discard'}); return null; }
    const fromId = isUpstreamInput ? created.id : sourceNode.id;
    const toId = isUpstreamInput ? sourceNode.id : created.id;
    if(!canvasMutation.connect({fromId,toId,input:true})){
        canvasMutation.remove({
            nodeIds:[created.id],
            options:{skipUndo:true,render:false,save:false}
        });
        canvasMutation.history({action:'discard'});
        render();
        canvasPersistence.schedule();
        return null;
    }
    if(explicitPoint && kind === 'text'){
        created.y = p.y - Number(created.h || promptNodeLayoutSize(created).height) / 2;
    }
    selectedId = created.id;
    selectedIds = [];
    selectedImage = {nodeId:'', index:-1};
    canvasMutation.history({action:'commit'});
    render();
    canvasPersistence.schedule();
    requestAnimationFrame(() => {
        if(kind === 'text' && !isUpstreamInput) beginPromptNodeTextEdit(created.id);
    });
    return created;
}
function createReferencedNodeFromMenu(kind){
    const state = referenceGenerateMenuState;
    if(state?.drag?.multiInput){
        const snapshot = state.drag.multiInput;
        const point = state.point;
        closeReferenceGenerateMenu();
        void smartMultiInputCommit(snapshot,{kind,point});
        return null;
    }
    const sourceNode = state ? nodes.find(node => node.id === state.drag.fromId) : null;
    if(!state || !sourceNode || !['text','image','video'].includes(kind)){
        closeReferenceGenerateMenu();
        return null;
    }
    const isUpstreamInput = state.drag.fromPort === 'in';
    closeReferenceGenerateMenu({discardUndo:false});
    return createReferencedNode({
        sourceNode,
        fromPort:isUpstreamInput ? 'in' : 'out',
        kind,
        point:state.point,
        explicitPoint:!state.trigger
    });
}
function createReferencedNodeFromToolbar(node, kind='image'){
    if(!node || !['image','video'].includes(kind)) return null;
    canvasMutation.history({action:'capture'});
    return createReferencedNode({
        sourceNode:node,
        fromPort:'out',
        kind,
        point:referenceGeneratePointForNode(node, 'out')
    });
}
function handlePortDrop(drag, e){
    if(drag.multiInput) return smartMultiInputDrop(drag,e);
    const {targetId, targetPort, hit, blocked} = smartPortDropTarget(
        e,
        drag.fromId,
        drag.fromPort
    );
    if(blocked){
        canvasMutation.history({action:'discard'});
        render();
        return false;
    }
    if(targetId){
        const compatible = (drag.fromPort === 'out' && targetPort === 'in') || (drag.fromPort === 'in' && targetPort === 'out');
        if(!compatible){ canvasMutation.history({action:'discard'}); render(); return false; }
        const fromId = drag.fromPort === 'out' ? drag.fromId : targetId;
        const toId = drag.fromPort === 'out' ? targetId : drag.fromId;
        if(canvasMutation.connect({fromId,toId,input:true})){
            canvasMutation.history({action:'commit'});
            render();
            canvasPersistence.schedule();
        } else {
            canvasMutation.history({action:'discard'});
            render();
        }
        return false;
    }
    if(!drag.moved){ canvasMutation.history({action:'discard'}); return false; }
    if(hit?.closest?.('.smart-canvas-dock,.composer,.smart-node-floating-portal,.reference-generate-menu,.smart-back,.asset-panel,.smart-log-toggle,.log-modal,.shortcut-modal,.image-edit-dialog,.smart-minimap')){
        canvasMutation.history({action:'discard'}); render(); return false;
    }
    const menuOpened = openReferenceGenerateMenu(drag, e, {
        point:drag.currentWorld,
        trigger:drag.sourceTrigger,
        clientX:e.clientX,
        clientY:e.clientY
    });
    if(!menuOpened){
        canvasMutation.history({action:'discard'});
        render();
    }
    return menuOpened;
}
function pickMediaForSmartNode(nodeId){
    const uploadKind = nodes.find(node => node.id === nodeId)?.uploadMediaKind || '';
    if(!fileInput?.open) return false;
    fileInput.setAttribute('accept', uploadKind === 'video'
        ? 'video/*,.mp4,.webm,.mov,.m4v'
        : uploadKind === 'image'
            ? 'image/*,.png,.jpg,.jpeg,.webp,.gif'
            : 'image/*,video/*,audio/*,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov,.m4v,.mp3,.wav,.m4a,.aac,.ogg,.flac');
    fileInput.clear({silent:true});
    pendingGroupUploadPoint = null;
    uploadTargetId = nodeId;
    return fileInput.open();
}
function syncSmartTextAnnotationSize(node, text){
    if(!node || !text) return;
    const rect = text.getBoundingClientRect();
    node.w = Math.max(24, Math.ceil(rect.width / Math.max(.01, viewport.scale)));
    node.h = Math.max(Math.ceil(smartTextFontSize(node.textSize) * 1.24), Math.ceil(rect.height / Math.max(.01, viewport.scale)));
    const nodeEl = text.closest('.image-node');
    if(nodeEl){
        nodeEl.style.width = `${node.w}px`;
        nodeEl.style.height = `${node.h}px`;
    }
}
function bindSmartAnnotationNodeControls(el, node){
    if(node?.type !== 'smart-text') return;
    const text = el.querySelector('.smart-canvas-text');
    if(!text) return;
    text.addEventListener('mousedown', event => {
        if(text.getAttribute('contenteditable') === 'true'){
            event.stopPropagation();
            return;
        }
        if(event.button === 0 && event.detail >= 2){
            event.preventDefault();
            event.stopPropagation();
            requestAnimationFrame(() => beginSmartTextAnnotationEdit(node.id, {pointer:event,selectAll:false}));
        }
    });
    text.addEventListener('dblclick', event => {
        event.preventDefault();
        event.stopPropagation();
        beginSmartTextAnnotationEdit(node.id, {pointer:event,selectAll:false});
    });
    text.addEventListener('click', event => {
        if(text.getAttribute('contenteditable') === 'true' || event.detail >= 2) event.stopPropagation();
    });
    text.addEventListener('input', () => {
        node.text = text.innerText.replace(/\r/g, '');
        syncSmartTextAnnotationSize(node, text);
        canvasPersistence.schedule();
        window.SmartCanvasModules.viewportSelection.viewport.refresh();
    });
    text.addEventListener('keydown', event => {
        const clearSelection = event.key === 'Escape';
        const shouldFinish = event.key === 'Escape'
            || (event.key === 'Enter' && !event.shiftKey);
        if(shouldFinish && !event.isComposing){
            event.preventDefault();
            event.stopPropagation();
            text.blur();
            if(clearSelection) clearSelectedSmartTextAnnotation();
        }
    });
    text.addEventListener('blur', () => {
        const next = text.innerText.replace(/\r/g, '').trim();
        node.text = next || tr('smart.annotationDefault');
        text.innerText = node.text;
        text.setAttribute('contenteditable', 'false');
        text.closest('.image-node')?.classList.remove('is-text-editing');
        syncSmartTextAnnotationSize(node, text);
        canvasPersistence.schedule();
        canvasVirtualization.unpin(node.id,'inline-editor');
        window.SmartCanvasModules.viewportSelection.viewport.refresh();
    });
}
const smartNodeQuickAddFollowStates = new WeakMap();
const smartNodeQuickAddPreviewExitTimers = new WeakMap();
function getSmartNodeQuickAddFollowState(trigger){
    let state = smartNodeQuickAddFollowStates.get(trigger);
    if(!state){
        state = {currentX:0,currentY:0,targetX:0,targetY:0,frameId:0};
        smartNodeQuickAddFollowStates.set(trigger, state);
    }
    return state;
}
function stepSmartNodeQuickAddFollow(trigger){
    const state = smartNodeQuickAddFollowStates.get(trigger);
    if(!state) return;
    state.frameId = 0;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const easing = reducedMotion ? 1 : .34;
    state.currentX += (state.targetX - state.currentX) * easing;
    state.currentY += (state.targetY - state.currentY) * easing;
    const settled = Math.abs(state.targetX - state.currentX) < .1
        && Math.abs(state.targetY - state.currentY) < .1;
    if(settled){
        state.currentX = state.targetX;
        state.currentY = state.targetY;
    }
    trigger.style.setProperty('--smart-node-quick-add-follow-x', `${state.currentX}px`);
    trigger.style.setProperty('--smart-node-quick-add-follow-y', `${state.currentY}px`);
    if(settled && state.targetX === 0 && state.targetY === 0){
        trigger.style.removeProperty('--smart-node-quick-add-follow-x');
        trigger.style.removeProperty('--smart-node-quick-add-follow-y');
    }else if(!settled){
        state.frameId = requestAnimationFrame(() => stepSmartNodeQuickAddFollow(trigger));
    }
}
function queueSmartNodeQuickAddFollow(trigger, targetX, targetY){
    if(!trigger) return;
    const state = getSmartNodeQuickAddFollowState(trigger);
    state.targetX = targetX;
    state.targetY = targetY;
    if(!state.frameId){
        state.frameId = requestAnimationFrame(() => stepSmartNodeQuickAddFollow(trigger));
    }
}
function moveSmartNodeQuickAddToPointer(trigger, zone, event){
    if(!trigger || !zone || !event) return;
    const rect = zone.getBoundingClientRect();
    const scaleX = rect.width > 0 && zone.offsetWidth > 0 ? rect.width / zone.offsetWidth : 1;
    const scaleY = rect.height > 0 && zone.offsetHeight > 0 ? rect.height / zone.offsetHeight : 1;
    const localX = (event.clientX - rect.left) / Math.max(.01, scaleX);
    const localY = (event.clientY - rect.top) / Math.max(.01, scaleY);
    const maxX = Math.max(0, (zone.offsetWidth - trigger.offsetWidth) / 2);
    const maxY = Math.max(0, (zone.offsetHeight - trigger.offsetHeight) / 2);
    const followX = Math.max(-maxX, Math.min(maxX, localX - zone.offsetWidth / 2));
    const followY = Math.max(-maxY, Math.min(maxY, localY - zone.offsetHeight / 2));
    queueSmartNodeQuickAddFollow(trigger, followX, followY);
}
function resetSmartNodeQuickAddFollow(trigger){
    queueSmartNodeQuickAddFollow(trigger, 0, 0);
}
const SMART_NODE_QUICK_ADD_EXIT_GRACE_MS = 80;
const SMART_NODE_QUICK_ADD_SWITCH_HYSTERESIS_PX = 8;
const SMART_NODE_QUICK_ADD_ZONE_STATES = [
    'is-preview',
    'is-active',
    'is-exit-grace',
    'is-menu-locked',
    'is-keyboard-locked'
];
let smartNodeQuickAddPointerFrame = 0;
let smartNodeQuickAddPointer = null;
let smartNodeQuickAddSuppressKeyboardFocusUntil = 0;
const smartNodeQuickAddState = {
    activeZone:null,
    visualZone:null,
    lock:'',
    lockZone:null,
    exitTimer:0,
    portDragging:false
};
let smartConnectionPointerHover = null;
function setSmartNodeQuickAddZoneState(zone, state=''){
    if(!zone) return;
    SMART_NODE_QUICK_ADD_ZONE_STATES.forEach(name => zone.classList.remove(name));
    if(state) zone.classList.add(state);
}
function smartNodeQuickAddPreviewWanted(zone){
    const node = zone?.closest('.image-node');
    return Boolean(
        node
        && (
            node.matches(':hover')
            || node.contains(document.activeElement)
            || node.classList.contains('reference-menu-source')
        )
    );
}
function restoreSmartNodeQuickAddPreview(zone){
    if(!zone) return;
    setSmartNodeQuickAddZoneState(
        zone,
        smartNodeQuickAddPreviewWanted(zone) ? 'is-preview' : ''
    );
}
function clearSmartNodeQuickAddExitTimer(){
    if(!smartNodeQuickAddState.exitTimer) return;
    clearTimeout(smartNodeQuickAddState.exitTimer);
    smartNodeQuickAddState.exitTimer = 0;
}
function scheduleSmartNodeQuickAddExitGrace(zone){
    clearSmartNodeQuickAddExitTimer();
    if(!zone) return;
    smartNodeQuickAddState.visualZone = zone;
    setSmartNodeQuickAddZoneState(zone, 'is-exit-grace');
    smartNodeQuickAddState.exitTimer = setTimeout(() => {
        smartNodeQuickAddState.exitTimer = 0;
        if(smartNodeQuickAddState.visualZone !== zone) return;
        smartNodeQuickAddState.visualZone = null;
        zone.style.transition = 'none';
        restoreSmartNodeQuickAddPreview(zone);
        resetSmartNodeQuickAddFollow(
            zone.querySelector('[data-node-quick-add]')
        );
        requestAnimationFrame(() => zone.style.removeProperty('transition'));
    }, SMART_NODE_QUICK_ADD_EXIT_GRACE_MS);
}
function setSmartConnectionPointerHover(control){
    const materialization = control?.closest?.('.connection-materialization') || null;
    if(smartConnectionPointerHover === materialization) return;
    smartConnectionPointerHover?.classList.remove('is-pointer-hover');
    smartConnectionPointerHover = materialization;
    smartConnectionPointerHover?.classList.add('is-pointer-hover');
}
function setSmartNodeQuickAddActiveZone(zone, {grace=true}={}){
    if(smartNodeQuickAddState.activeZone === zone){
        if(zone && !smartNodeQuickAddState.lock){
            setSmartNodeQuickAddZoneState(zone, 'is-active');
        }
        return;
    }
    const previous = smartNodeQuickAddState.activeZone;
    smartNodeQuickAddState.activeZone = zone || null;
    if(previous && previous !== zone){
        const previousNode = previous.closest('.image-node');
        const nextNode = zone?.closest('.image-node');
        resetSmartNodeQuickAddFollow(
            previous.querySelector('[data-node-quick-add]')
        );
        if(zone && previousNode && previousNode !== nextNode){
            const previewExitTimer = smartNodeQuickAddPreviewExitTimers.get(previousNode);
            if(previewExitTimer) clearTimeout(previewExitTimer);
            smartNodeQuickAddPreviewExitTimers.delete(previousNode);
            previousNode.querySelectorAll('.smart-node-quick-add-zone').forEach(previousZone => {
                setSmartNodeQuickAddZoneState(previousZone, '');
                resetSmartNodeQuickAddFollow(
                    previousZone.querySelector('[data-node-quick-add]')
                );
            });
            if(smartNodeQuickAddState.visualZone?.closest('.image-node') === previousNode){
                smartNodeQuickAddState.visualZone = null;
            }
        }else if(grace && !zone) scheduleSmartNodeQuickAddExitGrace(previous);
        else restoreSmartNodeQuickAddPreview(previous);
    }
    if(zone){
        clearSmartNodeQuickAddExitTimer();
        if(smartNodeQuickAddState.visualZone && smartNodeQuickAddState.visualZone !== zone){
            restoreSmartNodeQuickAddPreview(smartNodeQuickAddState.visualZone);
        }
        smartNodeQuickAddState.visualZone = zone;
        setSmartNodeQuickAddZoneState(zone, 'is-active');
    }
    shell.classList.toggle('quick-add-pointer-active', Boolean(zone));
}
function lockSmartNodeQuickAdd(trigger, lock){
    const zone = trigger?.closest?.('.smart-node-quick-add-zone');
    if(!zone || !['menu','keyboard'].includes(lock)) return;
    clearSmartNodeQuickAddExitTimer();
    smartNodeQuickAddState.lock = lock;
    smartNodeQuickAddState.lockZone = zone;
    smartNodeQuickAddState.activeZone = zone;
    smartNodeQuickAddState.visualZone = zone;
    setSmartNodeQuickAddZoneState(
        zone,
        lock === 'menu' ? 'is-menu-locked' : 'is-keyboard-locked'
    );
    shell.classList.remove('quick-add-pointer-active');
    setSmartConnectionPointerHover(null);
}
function unlockSmartNodeQuickAdd(lock){
    if(smartNodeQuickAddState.lock !== lock) return;
    const zone = smartNodeQuickAddState.lockZone;
    smartNodeQuickAddState.lock = '';
    smartNodeQuickAddState.lockZone = null;
    smartNodeQuickAddState.activeZone = null;
    smartNodeQuickAddState.visualZone = null;
    restoreSmartNodeQuickAddPreview(zone);
    shell.classList.remove('quick-add-pointer-active');
    updateSmartNodeQuickAddFromPointer();
}
function setSmartNodeQuickAddPortDragging(active){
    smartNodeQuickAddState.portDragging = Boolean(active);
    if(active){
        if(smartNodeQuickAddState.lock === 'keyboard'){
            smartNodeQuickAddState.lock = '';
            smartNodeQuickAddState.lockZone = null;
        }
        clearSmartNodeQuickAddExitTimer();
        const sourceZone = portDragState?.sourceTrigger?.closest('.smart-node-quick-add-zone');
        world.querySelectorAll('.smart-node-quick-add-zone').forEach(zone => {
            if(zone !== sourceZone) setSmartNodeQuickAddZoneState(zone, '');
        });
        if(sourceZone) setSmartNodeQuickAddZoneState(sourceZone, 'is-active');
        setSmartConnectionPointerHover(null);
        shell.classList.remove(
            'quick-add-pointer-active',
            'connection-cut-target',
            'connection-hit-suppressed',
            'quick-add-button-target'
        );
        return;
    }
    updateSmartNodeQuickAddFromPointer();
}
function smartNodeQuickAddStableKey(zone){
    const nodeId = zone?.closest('.image-node')?.dataset.id || '';
    const port = zone?.querySelector('[data-node-quick-add]')?.dataset.port || '';
    return `${nodeId}:${port}`;
}
function smartNodeQuickAddCandidatesAtPointer(pointer){
    const candidates = [];
    world.querySelectorAll('.smart-node-quick-add-zone').forEach(zone => {
        const rect = zone.getBoundingClientRect();
        if(
            pointer.clientX < rect.left
            || pointer.clientX > rect.right
            || pointer.clientY < rect.top
            || pointer.clientY > rect.bottom
        ) return;
        candidates.push({
            zone,
            distance:Math.hypot(
                pointer.clientX - (rect.left + rect.right) / 2,
                pointer.clientY - (rect.top + rect.bottom) / 2
            ),
            key:smartNodeQuickAddStableKey(zone)
        });
    });
    return candidates.sort((left,right) => (
        left.distance - right.distance || left.key.localeCompare(right.key)
    ));
}
function chooseSmartNodeQuickAddCandidate(candidates){
    const nearest = candidates[0] || null;
    const current = candidates.find(
        candidate => candidate.zone === smartNodeQuickAddState.activeZone
    );
    if(!nearest || !current || nearest.zone === current.zone) return nearest;
    return current.distance - nearest.distance >= SMART_NODE_QUICK_ADD_SWITCH_HYSTERESIS_PX
        ? nearest
        : current;
}
function smartNodeQuickAddVisibleButtonAt(clientX, clientY){
    for(const zone of world.querySelectorAll(
        '.smart-node-quick-add-zone:is(.is-preview,.is-active,.is-menu-locked,.is-keyboard-locked)'
    )){
        const trigger = zone.querySelector('[data-node-quick-add]');
        const rect = trigger?.getBoundingClientRect?.();
        if(
            rect
            && clientX >= rect.left
            && clientX <= rect.right
            && clientY >= rect.top
            && clientY <= rect.bottom
        ) return trigger;
    }
    return null;
}
function smartCanvasPointerPriorityAt(clientX, clientY){
    const elements = document.elementsFromPoint?.(clientX, clientY) || [];
    const closestInStack = selector => {
        for(const element of elements){
            const match = element?.closest?.(selector);
            if(match) return match;
        }
        return null;
    };
    const visibleQuickAdd = smartNodeQuickAddVisibleButtonAt(clientX, clientY);
    return {
        cut:closestInStack('.conn-cut'),
        visibleQuickAdd,
        frameControl:visibleQuickAdd ? null : closestInStack(
            '.smart-frame-node .node-head,.smart-frame-node .node-resize-handle'
        ),
        connectionHit:closestInStack('.conn-hit')
    };
}
function updateSmartNodeQuickAddLockedPointer(pointer){
    if(!pointer){
        setSmartConnectionPointerHover(null);
        return;
    }
    let priority = smartCanvasPointerPriorityAt(pointer.clientX, pointer.clientY);
    shell.classList.toggle('connection-cut-target', Boolean(priority.cut));
    shell.classList.toggle(
        'quick-add-button-target',
        Boolean(priority.visibleQuickAdd && !priority.cut)
    );
    const frameControlOwnsPointer = Boolean(priority.frameControl && !priority.cut);
    const hadSuppressedConnection = shell.classList.contains('connection-hit-suppressed');
    shell.classList.toggle('connection-hit-suppressed', frameControlOwnsPointer);
    if(hadSuppressedConnection && !frameControlOwnsPointer){
        priority = smartCanvasPointerPriorityAt(pointer.clientX, pointer.clientY);
    }
    setSmartConnectionPointerHover(
        priority.cut || frameControlOwnsPointer ? null : priority.connectionHit
    );
}
function updateSmartNodeQuickAddFromPointer(){
    smartNodeQuickAddPointerFrame = 0;
    const pointer = smartNodeQuickAddPointer;
    if(smartNodeQuickAddState.activeZone && !smartNodeQuickAddState.activeZone.isConnected){
        clearSmartNodeQuickAddExitTimer();
        smartNodeQuickAddState.activeZone = null;
        smartNodeQuickAddState.visualZone = null;
        smartNodeQuickAddState.lock = '';
        smartNodeQuickAddState.lockZone = null;
    }
    if(smartNodeQuickAddState.lock === 'menu'){
        updateSmartNodeQuickAddLockedPointer(pointer);
        return;
    }
    if(smartNodeQuickAddState.lock === 'keyboard'){
        updateSmartNodeQuickAddLockedPointer(pointer);
        return;
    }
    if(portDragState?.moved || smartNodeQuickAddState.portDragging){
        setSmartNodeQuickAddPortDragging(true);
        return;
    }
    if(
        !pointer
        || pointer.buttons
        || canvasInteraction.active()
        || shell.classList.contains('panning')
        || document.body.classList.contains('smart-node-resize')
    ){
        setSmartNodeQuickAddActiveZone(null);
        setSmartConnectionPointerHover(null);
        shell.classList.remove(
            'connection-cut-target',
            'connection-hit-suppressed',
            'quick-add-button-target'
        );
        return;
    }
    let priority = smartCanvasPointerPriorityAt(pointer.clientX, pointer.clientY);
    shell.classList.toggle('connection-cut-target', Boolean(priority.cut));
    shell.classList.toggle(
        'quick-add-button-target',
        Boolean(priority.visibleQuickAdd && !priority.cut)
    );
    const frameControlOwnsPointer = Boolean(priority.frameControl && !priority.cut);
    const hadSuppressedConnection = shell.classList.contains('connection-hit-suppressed');
    shell.classList.toggle('connection-hit-suppressed', frameControlOwnsPointer);
    if(hadSuppressedConnection && !frameControlOwnsPointer){
        priority = smartCanvasPointerPriorityAt(pointer.clientX, pointer.clientY);
    }
    const candidates = smartNodeQuickAddCandidatesAtPointer(pointer);
    pointer.connectionHit = priority.connectionHit;
    if(priority.cut || frameControlOwnsPointer){
        setSmartNodeQuickAddActiveZone(null);
        setSmartConnectionPointerHover(null);
        return;
    }
    const candidate = chooseSmartNodeQuickAddCandidate(candidates);
    setSmartNodeQuickAddActiveZone(candidate?.zone || null);
    if(candidate){
        setSmartConnectionPointerHover(null);
        moveSmartNodeQuickAddToPointer(
            candidate.zone.querySelector('[data-node-quick-add]'),
            candidate.zone,
            pointer
        );
        return;
    }
    if(!pointer.connectionHit){
        pointer.connectionHit = smartCanvasPointerPriorityAt(
            pointer.clientX,
            pointer.clientY
        ).connectionHit;
    }
    setSmartConnectionPointerHover(pointer.connectionHit);
}
function queueSmartNodeQuickAddPointer(event){
    smartNodeQuickAddPointer = {
        clientX:event.clientX,
        clientY:event.clientY,
        buttons:event.buttons,
        connectionHit:event.target?.closest?.('.conn-hit') || null
    };
    if(!smartNodeQuickAddPointerFrame){
        smartNodeQuickAddPointerFrame = requestAnimationFrame(
            updateSmartNodeQuickAddFromPointer
        );
    }
}
shell.addEventListener('pointermove', queueSmartNodeQuickAddPointer, {passive:true});
shell.addEventListener('pointerleave', () => {
    smartNodeQuickAddPointer = null;
    if(smartNodeQuickAddPointerFrame){
        cancelAnimationFrame(smartNodeQuickAddPointerFrame);
        smartNodeQuickAddPointerFrame = 0;
    }
    shell.classList.remove(
        'connection-cut-target',
        'connection-hit-suppressed',
        'quick-add-button-target'
    );
    setSmartNodeQuickAddActiveZone(null);
    setSmartConnectionPointerHover(null);
});
function bindNodeEvents(){
    world.querySelectorAll('.image-node').forEach(el => {
        if(el.dataset.smartEventsBound === '1') return;
        el.dataset.smartEventsBound = '1';
        const id = el.dataset.id;
        const nodeForControls = nodes.find(n => n.id === id);
        const nodeVideoIndex = (nodeForControls?.images || []).findIndex(image => mediaKindForItem(image) === 'video');
        if(nodeVideoIndex >= 0){
            el.tabIndex = 0;
            el.addEventListener('keydown', event => {
                if(event.key !== 'Enter' || event.target !== el || event.repeat) return;
                event.preventDefault();
                event.stopPropagation();
                smartPlaybackSelectAndPlayVideo(id, nodeVideoIndex);
            });
        }
        const setQuickAddPreview = preview => {
            el.querySelectorAll('.smart-node-quick-add-zone').forEach(zone => {
                if(
                    zone === smartNodeQuickAddState.activeZone
                    || zone === smartNodeQuickAddState.lockZone
                    || zone.classList.contains('is-exit-grace')
                ) return;
                setSmartNodeQuickAddZoneState(zone, preview ? 'is-preview' : '');
            });
        };
        el.addEventListener('pointerenter', () => {
            const timer = smartNodeQuickAddPreviewExitTimers.get(el);
            if(timer) clearTimeout(timer);
            smartNodeQuickAddPreviewExitTimers.delete(el);
            setQuickAddPreview(true);
        });
        el.addEventListener('pointerleave', event => {
            const enteringQuickAddZone = [...el.querySelectorAll('.smart-node-quick-add-zone')]
                .some(zone => {
                    const rect = zone.getBoundingClientRect();
                    return event.clientX >= rect.left
                        && event.clientX <= rect.right
                        && event.clientY >= rect.top
                        && event.clientY <= rect.bottom;
                });
            if(enteringQuickAddZone) return;
            const previousTimer = smartNodeQuickAddPreviewExitTimers.get(el);
            if(previousTimer) clearTimeout(previousTimer);
            smartNodeQuickAddPreviewExitTimers.set(el, setTimeout(() => {
                smartNodeQuickAddPreviewExitTimers.delete(el);
                setQuickAddPreview(false);
            }, SMART_NODE_QUICK_ADD_EXIT_GRACE_MS));
        });
        el.querySelectorAll('.smart-node-quick-add-zone').forEach(quickAddZone => {
            const quickAddTrigger = quickAddZone.querySelector('[data-node-quick-add]');
            const portType = quickAddTrigger?.dataset.port === 'in' ? 'in' : 'out';
            quickAddZone.addEventListener('mousedown', event => {
                if(event.target?.closest?.('[data-node-quick-add]')) return;
                beginSmartNodePortDrag(id, portType, event, {trigger:quickAddTrigger});
            });
            quickAddZone.addEventListener('click', event => {
                if(event.target?.closest?.('[data-node-quick-add]')) return;
                event.preventDefault();
                event.stopPropagation();
                openReferenceGenerateMenuFromNode(nodeForControls, quickAddTrigger, event, portType);
            });
            quickAddTrigger?.addEventListener('mousedown', event => {
                beginSmartNodePortDrag(id, portType, event, {trigger:quickAddTrigger});
            });
            const lockQuickAddFromKeyboardFocus = () => {
                if(Date.now() < smartNodeQuickAddSuppressKeyboardFocusUntil) return;
                lockSmartNodeQuickAdd(quickAddTrigger, 'keyboard');
            };
            const unlockQuickAddFromKeyboardFocus = () => {
                setTimeout(() => {
                    if(referenceGenerateMenuState?.trigger === quickAddTrigger) return;
                    if(
                        quickAddTrigger.matches?.(':focus')
                        || quickAddTrigger.matches?.(':focus-within')
                    ) return;
                    if(smartNodeQuickAddState.lockZone === quickAddZone){
                        unlockSmartNodeQuickAdd('keyboard');
                    }
                }, 0);
            };
            quickAddTrigger?.addEventListener('focus', lockQuickAddFromKeyboardFocus);
            quickAddTrigger?.addEventListener('focusin', lockQuickAddFromKeyboardFocus);
            quickAddTrigger?.addEventListener('blur', unlockQuickAddFromKeyboardFocus);
            quickAddTrigger?.addEventListener('focusout', unlockQuickAddFromKeyboardFocus);
            quickAddTrigger?.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                if(event.currentTarget._smartSuppressNextClick){
                    delete event.currentTarget._smartSuppressNextClick;
                    return;
                }
                openReferenceGenerateMenuFromNode(nodeForControls, event.currentTarget, event, portType);
            });
            quickAddTrigger?.addEventListener('keydown', event => {
                if(event.key === 'Escape'){
                    event.preventDefault();
                    event.stopPropagation();
                    quickAddTrigger.shadowRoot?.activeElement?.blur?.();
                    quickAddTrigger.blur?.();
                    unlockSmartNodeQuickAdd('keyboard');
                    return;
                }
                if(event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                openReferenceGenerateMenuFromNode(nodeForControls, event.currentTarget, event, portType);
            });
        });
        if(isSmartAnnotationNode(nodeForControls)) bindSmartAnnotationNodeControls(el, nodeForControls);
        if(nodeForControls?.type === 'smart-prompt') bindPromptNodeControls(el, nodeForControls);
        if(nodeForControls?.type === 'smart-splitter') bindSplitterNodeControls(el, nodeForControls);
        if(nodeForControls?.type === 'smart-loop') bindLoopNodeControls(el, nodeForControls);
        if(nodeForControls?.type === 'smart-group') {
            el.ondblclick = e => {
                e.preventDefault();
                e.stopPropagation();
                selectedId = id;
                selectedIds = [];
                selectedImage = {nodeId:'', index:-1};
                openCreateMenu(e, {groupId:id});
            };
        }
        if(smartContainer.isFrame(nodeForControls)){
            const frameHeader = el.querySelector('.node-head');
            const title = el.querySelector('.node-title');
            frameHeader?.addEventListener('pointerenter', () => {
                el.classList.add('frame-title-hover');
            });
            frameHeader?.addEventListener('pointerleave', () => {
                el.classList.remove('frame-title-hover');
            });
            title?.addEventListener('mousedown', e => {
                if(e.button !== 0 || e.detail < 2) return;
                e.preventDefault();
                e.stopPropagation();
                beginSmartFrameTitleEdit(id);
            });
            title?.addEventListener('dblclick', e => {
                e.preventDefault();
                e.stopPropagation();
                beginSmartFrameTitleEdit(id);
            });
        }
        el.onclick = e => {
            e.stopPropagation();
            if(Date.now() < suppressNodeClickUntil) return;
            selectedConnectionKey = '';
            selectedConnectionPoint = null;
            const node = nodes.find(n => n.id === id);
            hideRunTimerForNode(node);
            const alreadySelected = selectedId === id && selectedIds.length === 0;
            const videoIndex = (node?.images || []).findIndex(image => mediaKindForItem(image) === 'video');
            if(!alreadySelected && videoIndex >= 0){
                smartPlaybackSelectAndPlayVideo(id, videoIndex);
                return;
            }
            if(!alreadySelected) smartPlaybackPauseForSelection(id, -1);
            selectedId = id;
            selectedIds = [];
            selectedImage = {nodeId:'', index:-1};
            generationRun.noteManualSelection();
            if(alreadySelected){
                window.SmartCanvasModules.viewportSelection.selection.refresh();
                updateComposer();
                return;
            }
            render();
        };
        if(nodeForControls?.type !== 'smart-group') el.ondblclick = e => e.stopPropagation();
        const beginNodeDrag = e => {
            canvasInteraction.begin({
                kind:'move-nodes',
                event:e,
                nodeId:id
            });
        };
        const navigationBadge = el.querySelector('.smart-container-navigation-badge');
        navigationBadge?.addEventListener('mousedown', e => {
            if(e.button !== 0) return;
            if(!window.SmartCanvasModules.viewportSelection.selection.has(id)){
                selectedId = id;
                selectedIds = [];
                selectedImage = {nodeId:'', index:-1};
                window.SmartCanvasModules.viewportSelection.selection.refresh();
            }
            beginNodeDrag(e);
        });
        const uploadDrop = el.querySelector('.node-drop[data-upload-action="files"]');
        uploadDrop?.addEventListener('mousedown', e => {
            if(e.button !== 0) return;
            const uploadButton = e.composedPath().some(target => target?.localName === 'ic-button');
            if(uploadButton){
                e.stopPropagation();
                return;
            }
            beginNodeDrag(e);
        }, true);
        uploadDrop?.addEventListener('click', e => {
            e.stopPropagation();
            hideRunTimerForNode(nodes.find(n => n.id === id));
            selectedId = id;
            selectedIds = [];
            selectedImage = {nodeId:'', index:-1};
            pendingGroupUploadPoint = null;
            uploadTargetId = id;
            window.SmartCanvasModules.viewportSelection.selection.refresh();
            updateComposer();
        });
        uploadDrop?.addEventListener('dragover', e => {
            if(e.dataTransfer?.files?.length) e.stopPropagation();
        });
        uploadDrop?.addEventListener('drop', e => {
            if(e.dataTransfer?.files?.length) e.stopPropagation();
        });
        uploadDrop?.addEventListener('ic-change', async e => {
            e.stopPropagation();
            const files = [...(e.detail?.acceptedFiles || [])];
            if(!files.length) return;
            hideRunTimerForNode(nodes.find(n => n.id === id));
            selectedId = id;
            selectedIds = [];
            selectedImage = {nodeId:'', index:-1};
            window.SmartCanvasModules.viewportSelection.selection.refresh();
            updateComposer();
            setSmartUploadControlBusy(uploadDrop, true);
            const result = await handleFiles(files, id);
            if(!result && uploadDrop.isConnected){
                setSmartUploadControlBusy(uploadDrop, false);
                uploadDrop.clear({silent:true});
            }
        });
        uploadDrop?.addEventListener('ic-reject', e => {
            e.stopPropagation();
            const first = e.detail?.rejectedFiles?.[0];
            if(first?.message) toast(first.message, {tone:'warning'});
        });
        const generationTarget = el.querySelector('[data-reference-generation-target]');
        generationTarget?.addEventListener('mousedown', e => {
            if(e.button !== 0) return;
            const action = e.composedPath().some(target => ['button','ic-button','ic-icon-button'].includes(target?.localName));
            if(action){
                e.stopPropagation();
                return;
            }
            beginNodeDrag(e);
        }, true);
        generationTarget?.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            hideRunTimerForNode(nodes.find(n => n.id === id));
            selectedId = id;
            selectedIds = [];
            selectedImage = {nodeId:'', index:-1};
            generationRun.noteManualSelection();
            window.SmartCanvasModules.viewportSelection.selection.refresh();
            updateComposer();
            promptInput?.focus?.({preventScroll:true});
        });
        el.querySelector('[data-view-generation-log]')?.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            const currentNode = nodes.find(item => item.id === id) || nodeForControls;
            openSmartCanvasLog(currentNode?.generationLogId || '', currentNode?.generationRunId || '');
        });
        el.querySelectorAll('[data-smart-node-action]').forEach(btn => {
            btn.addEventListener('mousedown', e => {
                e.preventDefault();
                e.stopPropagation();
            }, true);
            btn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                runSmartNodeToolbarAction(
                    btn.dataset.nodeId || id,
                    btn.dataset.smartNodeAction,
                    btn.hasAttribute('data-media-index') ? Number(btn.dataset.mediaIndex) : null
                );
            });
        });
        el.querySelectorAll('[data-smart-node-action="video-loop"]').forEach(button => {
            const imageIndex = Number(button.dataset.mediaIndex || 0);
            syncSmartNodeVideoLoopControl(button, smartPlaybackEntry(id, imageIndex).loop);
        });
        el.querySelectorAll('[data-smart-group-action]').forEach(btn => {
            btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); }, true);
            btn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                runSmartGroupToolbarAction(btn.dataset.nodeId || id, btn.dataset.smartGroupAction);
            });
        });
        el.querySelectorAll('ic-generation-recovery[data-jimeng-query]').forEach(control => {
            control.addEventListener('ic-recover', e => {
                e.preventDefault(); e.stopPropagation();
                generationRun.recover({nodeId:control.dataset.jimengQuery, kind:'jimeng'});
            });
        });
        el.querySelectorAll('ic-generation-recovery[data-image-task-query]').forEach(control => {
            control.addEventListener('ic-recover', e => {
                e.preventDefault(); e.stopPropagation();
                generationRun.recover({nodeId:control.dataset.imageTaskQuery, taskId:control.dataset.taskId, kind:'image'});
            });
        });
        el.querySelectorAll('.image-name-badge').forEach(badge => {
            const item = badge.closest('[data-image-index]');
            const targetNodeId = item?.dataset.refNodeId || id;
            const imageIndex = Number(item?.dataset.refImageIndex ?? item?.dataset.imageIndex ?? 0);
            badge.addEventListener('mousedown', e => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }, true);
            badge.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }, true);
            badge.addEventListener('dblclick', e => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                clearImageClickTimer();
                suppressImageClickUntil = Date.now() + 260;
                renameSmartNodeImage(targetNodeId, imageIndex);
            }, true);
        });
        el.querySelectorAll('.smart-video-play').forEach(btn => {
            btn.addEventListener('mousedown', e => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }, true);
            btn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                const item = btn.closest('[data-image-index]');
                const targetNodeId = item?.dataset.refNodeId || id;
                const imageIndex = Number(item?.dataset.refImageIndex ?? item?.dataset.imageIndex ?? 0);
                const owner = nodes.find(n => n.id === targetNodeId);
                if(mediaKindForItem(owner?.images?.[imageIndex] || {}) !== 'video') return;
                clearImageClickTimer();
                suppressImageClickUntil = Date.now() + 260;
                hideRunTimerForNode(owner);
                smartPlaybackSelectAndPlayVideo(targetNodeId, imageIndex);
            }, true);
        });
        el.querySelectorAll('video[data-url]').forEach(bindSmartVideoFullscreenDoubleClick);
        el.querySelectorAll('video[data-url],audio[data-url]').forEach(media => {
            const target = smartPlaybackTargetFromElement(media);
            if(target) smartPlaybackBindMedia(media, target.nodeId, target.imageIndex);
        });
        el.querySelectorAll('.thumb-item,.image-wrap,.far-node-media').forEach(item => {
            const thumbTarget = () => {
                const targetNodeId = item.dataset.refNodeId || id;
                const imageIndex = Number(item.dataset.refImageIndex ?? item.dataset.imageIndex ?? 0);
                const owner = nodes.find(n => n.id === targetNodeId);
                return {targetNodeId, imageIndex, owner, image:owner?.images?.[imageIndex]};
            };
            item.setAttribute('draggable', 'false');
            item.addEventListener('dragstart', e => {
                e.preventDefault();
            });
            item.addEventListener('mousedown', e => {
                if(e.target.closest('audio')) return;
                if(e.target.closest('video') && e.detail < 2) return;
                if(e.button !== 0 || e.target.closest('.image-name-badge')) return;
                if(e.detail < 2) return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                clearImageClickTimer();
                suppressImageClickUntil = Date.now() + 260;
                const target = thumbTarget();
                if(mediaKindForItem(target.image || {}) === 'video'){
                    openSmartVideoFullscreen(target.targetNodeId, target.imageIndex);
                    return;
                }
                selectedId = id;
                selectedIds = [];
                selectedImage = {nodeId:target.targetNodeId, index:target.imageIndex};
                imageStudio.open({nodeId:target.targetNodeId, imageIndex:target.imageIndex});
            }, true);
            item.addEventListener('click', e => {
                if(e.target.closest('video,audio')) return;
                if(e.target.closest('.image-name-badge')) return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                if(Date.now() < suppressImageClickUntil) return;
                const target = thumbTarget();
                const owner = nodes.find(n => n.id === id);
                if(mediaKindForItem(target.image || {}) === 'video'){
                    clearImageClickTimer();
                    imageClickTimer = setTimeout(() => {
                        imageClickTimer = null;
                        suppressImageClickUntil = Date.now() + 260;
                        hideRunTimerForNode(target.owner || owner);
                        smartPlaybackSelectAndPlayVideo(target.targetNodeId, target.imageIndex);
                    }, 220);
                    return;
                }
                if(e.detail >= 2){
                    clearImageClickTimer();
                    suppressImageClickUntil = Date.now() + 260;
                    selectedId = id;
                    selectedIds = [];
                    selectedImage = {nodeId:target.targetNodeId, index:target.imageIndex};
                    imageStudio.open({nodeId:target.targetNodeId, imageIndex:target.imageIndex});
                    return;
                }
                clearImageClickTimer();
                imageClickTimer = setTimeout(() => {
                    imageClickTimer = null;
                hideRunTimerForNode(owner);
                smartPlaybackPauseForSelection(id, -1);
                selectedId = id;
                selectedIds = [];
                // Composer 绑定节点本身；这里记录图层焦点，用于交叠时置顶和工具栏目标。
                selectedImage = {nodeId:target.targetNodeId, index:target.imageIndex};
                    generationRun.noteManualSelection();
                    window.SmartCanvasModules.viewportSelection.selection.refresh();
                    scheduleComposerUpdate(180);
                }, 220);
            });
        item.addEventListener('dblclick', e => {
            if(e.target.closest('video,audio')) return;
            if(e.target.closest('.image-name-badge')) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            clearImageClickTimer();
            suppressImageClickUntil = Date.now() + 260;
            const target = thumbTarget();
            if(mediaKindForItem(target.image || {}) === 'video'){
                openSmartVideoFullscreen(target.targetNodeId, target.imageIndex);
                return;
            }
            selectedId = id;
            selectedIds = [];
            selectedImage = {nodeId:target.targetNodeId, index:target.imageIndex};
            imageStudio.open({nodeId:target.targetNodeId, imageIndex:target.imageIndex});
        }, true);
        });
        el.querySelectorAll('.thumb-item,.smart-group-single-thumb').forEach(item => {
            item.addEventListener('mousedown', e => {
                if(e.target.closest('video,audio')) return;
                if(e.button !== 0) return;
                if(e.detail >= 2) return;
                const node = nodes.find(n => n.id === id);
                const refNodeId = item.dataset.refNodeId || '';
                if(refNodeId && refNodeId !== id) return;
                if(!node) return;
                const imgIndex = Number(item.dataset.imageIndex || 0);
                if(smartContainer.isGroup(node)){
                    if(!node.images?.[imgIndex]) return;
                } else if((node.images || []).length <= 1) return;
                canvasInteraction.begin({
                    kind:'detach-media',
                    event:e,
                    nodeId:id,
                    mediaIndex:imgIndex
                });
            });
        });
        el.querySelector('.node-resize-handle')?.addEventListener('mousedown', e => {
            canvasInteraction.begin({
                kind:'resize-node',
                event:e,
                nodeId:id
            });
        });
        el.onmousedown = beginNodeDrag;
        el.ondragover = e => setSmartDropCopyEffect(e);
        el.ondrop = async e => {
            e.preventDefault();
            e.stopPropagation();
            notifyUnsupportedSmartUploadDrop(e.dataTransfer);
            const payload = await resolveSmartImageDropPayload(e.dataTransfer);
            if(payload.type === 'none') return;
            if(smartContainer.isFrame(nodes.find(node => node.id === id))){
                await handleSmartImageDropPayload(payload, '', {point:window.SmartCanvasModules.viewportSelection.viewport.screenToWorld(e), forceNew:true});
                smartContainer.reconcileFrames();
                render();
                canvasPersistence.schedule();
                return;
            }
            await handleSmartImageDropPayload(payload, id);
        };
    });
}
function smartDeleteSelectionTarget(nodeList, primaryId, multiIds, imageSelection){
    const ids = (multiIds || []).length ? multiIds.slice() : (primaryId ? [primaryId] : []);
    if(ids.length === 1){
        const node = (nodeList || []).find(item => item.id === ids[0]);
        const imageIndex = Number(imageSelection?.index);
        if(
            node?.type === 'smart-group'
            && imageSelection?.nodeId === node.id
            && Number.isInteger(imageIndex)
            && imageIndex >= 0
            && node.images?.[imageIndex]
        ){
            return {kind:'media', nodeId:node.id, index:imageIndex};
        }
    }
    return {kind:'nodes', ids};
}
function deleteSelectedSmartSelection(options={}){
    const target = smartDeleteSelectionTarget(nodes, selectedId, selectedIds, selectedImage);
    if(target.kind === 'media'){
        deleteImage(target.nodeId, target.index);
        return true;
    }
    return smartContainer.remove(target.ids, options);
}
function smartShortcutLabel(key){
    const apple = shortcutPlatform() === 'apple';
    const primary = apple ? '⌘' : 'Ctrl+';
    if(key === 'copy') return `${primary}C`;
    if(key === 'copy-image') return apple ? '⇧⌘C' : 'Ctrl+Shift+C';
    if(key === 'duplicate') return `${primary}D`;
    if(key === 'paste') return `${primary}V`;
    if(key === 'shortcuts') return apple ? '⌘ /' : 'Ctrl + /';
    if(key === 'delete') return apple ? 'Delete' : 'Del';
    return '';
}
function smartContextMenuItem(action, label, icon, shortcut='', options={}){
    return {action, label, icon, shortcut, disabled:Boolean(options.disabled), danger:Boolean(options.danger), shiftOnly:Boolean(options.shiftOnly)};
}
function smartNodeHasRegenerationSnapshot(node){
    const inputSnapshot = node?.generationInputSnapshot;
    const runSettings = inputSnapshot?.settings || node?.runSettings;
    if(!runSettings) return false;
    const prompt = String(
        inputSnapshot?.prompt || node.runModelPrompt || node.runPrompt || ''
    ).trim();
    return Boolean(prompt || !smartRunNeedsPrompt(runSettings));
}
function smartContextMediaTarget(state=smartContextMenuState){
    if(!state) return {node:null, item:null, index:-1};
    const node = nodes.find(item => item.id === (state.mediaNodeId || state.nodeId));
    if(!node) return {node:null, item:null, index:-1};
    let index = Number(state.mediaIndex);
    if(!Number.isFinite(index) || index < 0){
        index = (node.images || []).length === 1 ? 0 : -1;
    }
    return {node, item:index >= 0 ? node.images?.[index] || null : null, index};
}
function workspacePublishableImageRefs(node){
    if(!node) return [];
    const refs = smartContainer.isGroup(node)
        ? smartContainer.imageRefs(node).map(ref => ({nodeId:ref.nodeId, imageIndex:ref.index, item:ref.item}))
        : (node.images || []).map((item, imageIndex) => ({nodeId:node.id, imageIndex, item}));
    return refs.filter(ref => ref.item?.url && mediaKindForItem(ref.item) === 'image');
}
function smartContextMenuSections(state){
    const liveIds = window.SmartCanvasModules.viewportSelection.selection.ids().filter(id => nodes.some(node => node.id === id));
    const count = liveIds.length;
    const primary = [];
    const content = [];
    const structure = [];
    const common = [];
    if(count > 1){
        const selected = liveIds.map(id => nodes.find(node => node.id === id)).filter(Boolean);
        const publishableImages = selected.flatMap(workspacePublishableImageRefs);
        const groupable = selected.filter(node => !smartContainer.isGroup(node) && !smartContainer.isFrame(node));
        if(groupable.length >= 2) primary.push(smartContextMenuItem('group-selection', tr('smart.contextCreateGroup'), 'group'));
        primary.push(smartContextMenuItem('frame-selection', tr('smart.contextCreateFrame'), 'frame'));
        const transfer = [smartContextMenuItem('export-resource-package', tr('smart.contextExportResourcePackage'), 'package')];
        if(publishableImages.length) transfer.push(smartContextMenuItem('publish-workspace-assets', tr('smart.addToAssetLibrary'), 'collection'));
        const owners = selected.map(node => smartContainer.groupFor(node.id)).filter(Boolean);
        if(owners.length === selected.length && new Set(owners.map(group => group.id)).size === 1){
            structure.push(smartContextMenuItem('remove-selection-from-group', tr('smart.contextRemoveSelectionFromGroup'), 'logout'));
        }
        common.push(smartContextMenuItem('copy', trf('smart.contextCopyCount', {n:count}), 'copy', smartShortcutLabel('copy')));
        common.push(smartContextMenuItem('copy-node-id', tr('smart.contextCopyNodeId'), 'copy', '', {shiftOnly:true}));
        common.push(smartContextMenuItem('duplicate', trf('smart.contextDuplicateCount', {n:count}), 'create-copy', smartShortcutLabel('duplicate')));
        common.push(smartContextMenuItem('clear-selection', tr('smart.contextClearSelection'), 'cursor'));
        common.push(smartContextMenuItem('delete', trf('smart.contextDeleteCount', {n:count}), 'delete', smartShortcutLabel('delete'), {danger:true}));
        return [primary, transfer, content, structure, common].filter(section => section.length);
    }
    const node = nodes.find(item => item.id === state.nodeId);
    if(!node) return [];
    const media = smartContextMediaTarget(state);
    const mediaItems = media.item?.url ? [media.item] : (node.images || []).filter(item => item?.url);
    const mediaKind = media.item ? mediaKindForItem(media.item) : (mediaItems.length === 1 ? mediaKindForItem(mediaItems[0]) : '');
    const busy = smartNodeInFlight(node);
    if(busy){
        primary.push(smartContextMenuItem('noop', node.queued ? tr('smart.contextQueued') : tr('smart.contextGenerating'), 'loading', '', {disabled:true}));
        if(smartRecoverableImageTask(node)) primary.push(smartContextMenuItem('query-result', tr('smart.contextQueryResult'), 'refresh'));
    } else if(smartNodeHasRegenerationSnapshot(node)){
        primary.push(smartContextMenuItem('regenerate', tr('smart.contextRegenerate'), 'refresh'));
        primary.push(smartContextMenuItem('view-run-info', tr('smart.contextRunInfo'), 'info'));
        if(node.runPrompt || node.runModelPrompt) primary.push(smartContextMenuItem('copy-run-prompt', tr('smart.contextCopyRunPrompt'), 'copy'));
    }
    if(smartContainer.isGroup(node) && workspacePublishableImageRefs(node).length){
        content.push(smartContextMenuItem('publish-workspace-assets', tr('smart.addToAssetLibrary'), 'collection'));
    }
    if(isSmartImageNode(node)){
        if(!(node.images || []).length && !busy){
            content.push(smartContextMenuItem('pick-media', tr('smart.contextChooseFile'), 'choose-file'));
        } else if(mediaKind === 'image'){
            content.push(smartContextMenuItem('publish-workspace-assets', tr('smart.addToAssetLibrary'), 'collection'));
            content.push(smartContextMenuItem('replace-media', tr('smart.contextReplaceImage'), 'replace'));
            content.push(smartContextMenuItem('set-canvas-cover', tr('smart.setCanvasCover'), 'set-cover'));
            content.push(smartContextMenuItem('copy-image', tr('smart.contextCopyAsImage'), 'copy-image', smartShortcutLabel('copy-image')));
            content.push(smartContextMenuItem('download-media', tr('smart.contextDownload'), 'download'));
        } else if(mediaKind === 'video'){
            content.push(smartContextMenuItem('replace-media', tr('smart.contextReplaceVideo'), 'replace'));
            content.push(smartContextMenuItem('extract-frame', tr('smart.contextExtractFrame'), 'extract-frame'));
            content.push(smartContextMenuItem('download-media', tr('smart.contextDownload'), 'download'));
        } else if(mediaKind === 'audio'){
            content.push(smartContextMenuItem('replace-media', tr('smart.contextReplaceAudio'), 'replace'));
            content.push(smartContextMenuItem('download-media', tr('smart.contextDownload'), 'download'));
        }
        if(media.item && media.node?.id === node.id && (node.images || []).length > 1) content.push(smartContextMenuItem('remove-media', tr('smart.contextRemoveMedia'), 'remove-media', '', {danger:true}));
        if((node.images || []).length > 1) structure.push(smartContextMenuItem('ungroup', tr('smart.contextSplitMediaGroup'), 'ungroup'));
    } else if(smartContainer.isGroup(node)){
        const groupImages = smartContainer.imageRefs(node).filter(ref => ref.item?.url);
        primary.push(smartContextMenuItem('add-to-group', tr('smart.contextAddNode'), 'add'));
        if(!busy) primary.push(smartContextMenuItem('run-group', node.runAt ? tr('smart.contextRunGroupAgain') : tr('smart.contextRunGroup'), 'play'));
        structure.push(smartContextMenuItem('arrange-group', tr('smart.contextArrange'), 'arrange', '', {disabled:!groupImages.length && !smartContainer.groupMembers(node).length}));
        if(groupImages.length > 1) content.push(smartContextMenuItem('grid-group', tr('smart.contextGridJoin'), 'join-grid'));
        if(groupImages.length) content.push(smartContextMenuItem('download-group', tr('smart.contextBatchDownload'), 'archive'));
        if(mediaKind === 'image') content.push(smartContextMenuItem('copy-image', tr('smart.contextCopyAsImage'), 'copy-image', smartShortcutLabel('copy-image')));
        if(media.item && media.node?.id === node.id) content.push(smartContextMenuItem('remove-media', tr('smart.contextRemoveMedia'), 'remove-media', '', {danger:true}));
        if(media.item && media.node?.id !== node.id && smartContainer.groupFor(media.node?.id)?.id === node.id) structure.push(smartContextMenuItem('remove-media-from-group', tr('smart.contextRemoveMediaFromGroup'), 'logout'));
        structure.push(smartContextMenuItem('ungroup', tr('smart.contextUngroup'), 'ungroup'));
    } else if(nodeKinds.isPromptFamily(node)){
        content.push(smartContextMenuItem('edit-prompt', tr('smart.contextEditPrompt'), 'edit-text'));
        content.push(smartContextMenuItem('copy-prompt', tr('smart.contextCopyPrompt'), 'copy'));
        content.push(smartContextMenuItem('save-prompt-preset', tr('smart.contextSavePromptPreset'), 'save-prompt'));
        if(node.llmEnabled) primary.push(smartContextMenuItem('run-prompt', tr('smart.contextRunPrompt'), 'play'));
    } else if(node.type === 'smart-loop'){
        const loopRunning = generationRun.status({node}).loopRunning;
        primary.push(smartContextMenuItem(loopRunning ? 'stop-loop' : 'run-loop', loopRunning ? tr('smart.contextStopLoop') : (node.runAt ? tr('smart.contextRunLoopAgain') : tr('smart.contextRunLoop')), loopRunning ? 'stop' : 'play'));
    } else if(smartContainer.isFrame(node)){
        structure.push(smartContextMenuItem('rename-frame', tr('smart.contextRenameFrame'), 'edit'));
        structure.push(smartContextMenuItem('color-frame', tr('smart.contextFrameColor'), 'color'));
        structure.push(smartContextMenuItem('ungroup-frame', trf('smart.contextUngroupFrame', {n:smartContainer.frameMembers(node).length}), 'ungroup-frame'));
    } else if(nodeKinds.isTextAnnotation(node)){
        content.push(smartContextMenuItem('edit-text', tr('smart.contextEditText'), 'edit-text'));
    }
    const ownerGroup = smartContainer.groupFor(node.id);
    if(ownerGroup) structure.push(smartContextMenuItem('remove-from-group', tr('smart.contextRemoveFromGroup'), 'logout'));
    const hasConnections = (canvas?.connections || []).some(conn => conn.from === node.id || conn.to === node.id);
    if(hasConnections) structure.push(smartContextMenuItem('disconnect-all', tr('smart.contextDisconnectAll'), 'disconnect'));
    common.push(smartContextMenuItem('copy', tr('smart.contextCopy'), 'copy', smartShortcutLabel('copy')));
    common.push(smartContextMenuItem('copy-node-id', tr('smart.contextCopyNodeId'), 'copy', '', {shiftOnly:true}));
    common.push(smartContextMenuItem('duplicate', tr('smart.contextDuplicate'), 'create-copy', smartShortcutLabel('duplicate')));
    if(smartContainer.isFrame(node)) common.push(smartContextMenuItem('delete-frame-all', trf('smart.contextDeleteFrameAll', {n:smartContainer.frameMembers(node).length}), 'delete', smartShortcutLabel('delete'), {danger:true}));
    else common.push(smartContextMenuItem('delete', tr('smart.contextDelete'), 'delete', smartShortcutLabel('delete'), {danger:true}));
    return [primary, content, structure, common].filter(section => section.length);
}
function renderSmartNodeContextMenu(state){
    if(!smartNodeContextMenu) return;
    const sections = smartContextMenuSections(state);
    smartNodeContextMenu.setSections?.(sections, {shiftKey:Boolean(state?.shiftKey)});
}
function closeSmartNodeContextMenu(options={}){
    if(!smartNodeContextMenu) return;
    smartNodeContextMenu.hide?.('programmatic');
    if(!options.keepState) smartContextMenuState = null;
}
function openSmartNodeContextMenu(event, state){
    if(!smartNodeContextMenu || !state?.nodeId) return;
    closeCreateMenu();
    smartContextMenuState = {...state, point:window.SmartCanvasModules.viewportSelection.viewport.screenToWorld(event), clientX:event.clientX, clientY:event.clientY, shiftKey:Boolean(event.shiftKey)};
    renderSmartNodeContextMenu(smartContextMenuState);
    smartNodeContextMenu.showAt(event.clientX, event.clientY, shell);
}
function smartContextTargetFromEvent(event, nodeId){
    const item = event.target.closest?.('[data-image-index]');
    return {
        nodeId,
        mediaNodeId:item?.dataset?.refNodeId || nodeId,
        mediaIndex:item ? Number(item.dataset.refImageIndex ?? item.dataset.imageIndex ?? 0) : -1
    };
}
async function copySmartText(text, message=tr('smart.copied')){
    const value = String(text || '');
    if(!value) return false;
    const copied = await copyTextToClipboard(value);
    toast(
        copied ? message : tr('smart.copyRetry'),
        {tone:copied ? 'success' : 'danger'},
    );
    return copied;
}
async function smartClipboardPngBlob(item){
    const sourceUrl = smartOriginalMediaUrl(item);
    if(!sourceUrl) throw new Error(tr('smart.contextCopyAsImageFailed'));
    const requestUrl = sourceUrl.startsWith('data:')
        || sourceUrl.startsWith('blob:')
        ? displayMediaUrl(item)
        : `/api/download-output?url=${encodeURIComponent(sourceUrl)}`;
    const response = await fetch(requestUrl);
    if(!response.ok) throw new Error(tr('smart.contextCopyAsImageFailed'));
    const blob = await response.blob();
    if(blob.type === 'image/png') return blob;
    const canvas = document.createElement('canvas');
    let width = 0;
    let height = 0;
    let drawable = null;
    let objectUrl = '';
    if(typeof createImageBitmap === 'function'){
        drawable = await createImageBitmap(blob);
        width = drawable.width;
        height = drawable.height;
    } else {
        objectUrl = URL.createObjectURL(blob);
        drawable = await new Promise((resolve,reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = objectUrl;
        });
        width = drawable.naturalWidth;
        height = drawable.naturalHeight;
    }
    canvas.width = Math.max(1,width);
    canvas.height = Math.max(1,height);
    const context = canvas.getContext('2d');
    if(!context) throw new Error(tr('smart.contextCopyAsImageFailed'));
    context.drawImage(drawable,0,0,canvas.width,canvas.height);
    drawable?.close?.();
    if(objectUrl) URL.revokeObjectURL(objectUrl);
    return new Promise((resolve,reject) => {
        canvas.toBlob(
            output => output
                ? resolve(output)
                : reject(new Error(tr('smart.contextCopyAsImageFailed'))),
            'image/png'
        );
    });
}
async function writeResolvedSmartClipboardPng(ClipboardItemType,png){
    let lastError = null;
    for(let attempt = 0; attempt < 2; attempt += 1){
        if(attempt) await new Promise(resolve => setTimeout(resolve,60));
        try {
            await navigator.clipboard.write([
                new ClipboardItemType({'image/png':png})
            ]);
            return;
        } catch(error){
            lastError = error;
        }
    }
    throw lastError || new Error(tr('smart.contextCopyAsImageFailed'));
}
async function copySmartImageToClipboard(item){
    invalidateNodeClipboard();
    const ClipboardItemType = window.ClipboardItem;
    if(
        !item?.url
        || mediaKindForItem(item) !== 'image'
        || !navigator.clipboard?.write
        || !ClipboardItemType
    ){
        toast(tr('smart.contextCopyAsImageFailed'));
        return false;
    }
    try {
        const png = smartClipboardPngBlob(item);
        try {
            await navigator.clipboard.write([
                new ClipboardItemType({'image/png':png})
            ]);
        } catch{
            const resolvedPng = await png;
            await writeResolvedSmartClipboardPng(ClipboardItemType,resolvedPng);
        }
        toast(tr('smart.contextCopyAsImageDone'), {tone:'success'});
        return true;
    } catch(error){
        toast(tr('smart.contextCopyAsImageFailed'));
        return false;
    }
}
function openSmartContextResult(options={}){
    if(!smartContextResultBackdrop) return;
    smartContextResultState = {...options};
    smartContextResultTitle.textContent = options.title || tr('smart.contextReversePrompt');
    smartContextResultStatus.textContent = options.status || '';
    smartContextResultText.value = options.text || '';
    smartContextResultText.placeholder = options.placeholder || '';
    smartContextResultText.readOnly = Boolean(options.readOnly);
    renderSmartContextResultInputs(options.inputImages);
    smartContextResultCopy.hidden = options.copy === false;
    smartContextResultCreate.hidden = !options.allowCreate;
    smartContextResultApply.hidden = !options.allowApply;
    smartContextResultBackdrop.hidden = false;
    refreshIcons();
    if(options.focus !== false) requestAnimationFrame(() => smartContextResultText.focus({preventScroll:true}));
}
function closeSmartContextResult(){
    if(smartContextResultBackdrop) smartContextResultBackdrop.hidden = true;
    smartContextResultState = null;
}
function smartRunInfoElapsedMs(node){
    const stored = Number(node?.runElapsedMs);
    if(node?.runElapsedMs !== undefined && node?.runElapsedMs !== null && Number.isFinite(stored) && stored >= 0){
        return stored;
    }
    const startedAt = Number(node?.runStartedAt || 0);
    const finishedAt = Number(node?.runFinishedAt || 0);
    if(startedAt > 0 && finishedAt >= startedAt) return finishedAt - startedAt;
    return null;
}
function smartRunInfoInputRefs(node){
    const snapshotRefs = node?.generationInputSnapshot?.refs;
    if(Array.isArray(snapshotRefs) && snapshotRefs.length) return snapshotRefs;
    if(Array.isArray(node?.runInputRefs) && node.runInputRefs.length) return node.runInputRefs;
    if(Array.isArray(node?.runPromptRefs) && node.runPromptRefs.length) return node.runPromptRefs;
    return Array.isArray(snapshotRefs) ? snapshotRefs : [];
}
function smartRunInfoInputImages(node){
    return smartRunInfoInputRefs(node).filter(ref => ref?.url && mediaKindForItem(ref) === 'image');
}
function renderSmartContextResultInputs(inputImages=[]){
    if(!smartContextResultInputs || !smartContextResultInputList) return;
    const images = Array.isArray(inputImages) ? inputImages.filter(ref => ref?.url) : [];
    smartContextResultInputs.hidden = !images.length;
    smartContextResultInputList.innerHTML = images.map((ref, index) => {
        const name = String(ref.name || trf('smart.runInputImage', {value:index + 1}));
        return `<div class="smart-context-result-input" title="${escapeAttr(name)}">${smartPreviewImgHtml(imageForDisplay(ref), 192, `loading="lazy" alt="${escapeAttr(name)}"`)}<span>${escapeHtml(name)}</span></div>`;
    }).join('');
    bindSmartPreviewImageFallbacks(smartContextResultInputList);
}
function smartRunInfoOutputKind(node){
    const stored = String(node?.outputKind || '').trim().toLowerCase();
    if(stored) return stored;
    const output = (node?.images || []).find(item => item?.url);
    return output ? mediaKindForItem(output) : '';
}
function smartRunInfoPrompt(node){
    return String(
        node?.generationInputSnapshot?.prompt
        || node?.runModelPrompt
        || node?.runPrompt
        || ''
    ).trim();
}
function smartRunInfoText(node){
    const runSettings = node?.runSettings || {};
    const elapsedMs = smartRunInfoElapsedMs(node);
    const lines = [
        trf('smart.runTime', {value: node?.runAt ? new Date(node.runAt).toLocaleString() : tr('smart.unknown')}),
        trf('smart.runElapsed', {value: elapsedMs == null ? tr('smart.unknown') : formatRunDuration(elapsedMs)}),
        trf('smart.engineInfo', {value: runSettings.engine || tr('smart.unknown')}),
        trf('smart.modelInfo', {value: runSettings.model || runSettings.videoModel || runSettings.msCustomModel || runSettings.comfyWorkflow || runSettings.rhConfigKey || tr('smart.unknown')}),
        trf('smart.promptInfo', {value: smartRunInfoPrompt(node) || tr('smart.none')})
    ];
    const size = runSettings.customSize || runSettings.videoResolution || runSettings.resolution || runSettings.ratio || '';
    if(size) lines.push(trf('smart.sizeInfo', {value: size}));
    if(runSettings.videoDuration && smartRunInfoOutputKind(node) === 'video'){
        lines.push(trf('smart.durationInfo', {value: runSettings.videoDuration}));
    }
    if(runSettings.count) lines.push(trf('smart.countInfo', {value: runSettings.count}));
    return lines.join('\n');
}
function aiProcessorPromptLibrary(){
    const active = promptLibraries.find(library => library.id === activePromptLibraryId);
    const common = promptLibraries.find(library => library.id === 'common');
    return [active,common,...promptLibraries].find((library,index,list)=>library&&list.findIndex(item=>item?.id===library.id)===index)||null;
}
function aiProcessorPromptGroups(){
    const library=aiProcessorPromptLibrary();
    if(!library) return [];
    return (library.categories||[]).map(category=>({
        id:category.id,
        name:category.name||category.id,
        templates:(library.items||[]).filter(item=>item?.id&&item.category===category.id&&String(item.positive||'').trim()).map(item=>({
            id:item.id,
            name:promptTemplateName(item),
            subtitle:category.name,
            prompt:String(item.positive||'').trim(),
            source:item,
            libraryId:library.id
        }))
    }));
}
function aiProcessorModelEntries(kind){
    return smartModelCatalog(kind).filter(entry=>entry?.id&&entry?.provider_id&&entry?.model);
}
function aiProcessorDialogModels(entries){
    return entries.map(entry => {
        const icon = smartModelVendorIcon(entry.model, entry.provider_id, entry.provider_name);
        return {
            id:entry.id,
            name:entry.name || entry.model || tr('smart.model'),
            iconSrc:icon?.src || '',
            iconMonochrome:Boolean(icon?.monochrome),
            icon:icon ? '' : 'sparkles'
        };
    });
}
async function ensureAiProcessorDialog(){
    await customElements.whenDefined('ic-ai-processor-dialog');
    if(aiProcessorDialog?.isConnected) return aiProcessorDialog;
    aiProcessorDialog=document.createElement('ic-ai-processor-dialog');
    aiProcessorDialog.addEventListener('ic-confirm', event=>{
        const detail=event.detail||{};
        const context=aiProcessorDialogContext;
        submitAiProcessorDialog(detail).catch(async error=>{
            const message=(error?.message||tr('smart.operationFailed')).slice(0,240);
            if(context?.historyCaptured) canvasMutation.history({action:'discard'});
            if(aiProcessorDialog&&!aiProcessorDialog.open&&context?.processor==='reverse-prompt'){
                aiProcessorDialogContext=context;
                aiProcessorDialog.pending=false;
                await aiProcessorDialog.show();
                aiProcessorDialog.selectGroup(detail.groupId);
                aiProcessorDialog.selectTemplate(detail.templateId);
                aiProcessorDialog.selectedModel=detail.modelId;
                const modelControl=aiProcessorDialog.querySelector('ic-select[name="ai-processor-model"]');
                if(modelControl) modelControl.value=detail.modelId;
            }
            if(aiProcessorDialog?.open){
                aiProcessorDialog.pending=false;
                aiProcessorDialog.setError(message);
            }
            if(!error?.aiProcessorToastShown) toast(message,{tone:'danger'});
        });
    });
    aiProcessorDialog.addEventListener('ic-cancel',()=>{
        aiProcessorDialogContext=null;
    });
    aiProcessorDialog.addEventListener('ic-after-hide',event=>{
        if(event.target!==aiProcessorDialog) return;
        if(!aiProcessorDialog.pending) aiProcessorDialogContext=null;
    });
    document.body.append(aiProcessorDialog);
    return aiProcessorDialog;
}
async function createAndRunReversePromptNode(context, template, model){
    const source = nodes.find(item => item.id === context.sourceNodeId);
    const image = source?.images?.[context.imageIndex];
    if(!source || !image?.url || mediaKindForItem(image) !== 'image'){
        toast(tr('smart.reversePromptSourceUnavailable'));
        return;
    }
    const inputMedia = [stripImageGenerationMeta({...image})];
    canvasMutation.history({action:'capture'});
    context.historyCaptured=true;
    const node = canvasMutation.create({
        kind:'prompt',
        data:{
            title:tr('smart.contextReversePrompt'),
            llmEnabled:true,
            llmInstruction:String(template.positive || '').trim(),
            llmInstructionHeight:96,
            llmProvider:model.provider_id,
            llmModel:model.model,
            llmTemplateId:template.id,
            llmTemplateLibraryId:context.libraryId,
            llmInputMedia:inputMedia
        },
        options:{
            select:true,
            reveal:true,
            skipUndo:true,
            placement:{
                anchor:{kind:'source',sourceNodeId:source.id},
                relation:'downstream',
                arrangement:'single'
            }
        }
    });
    canvasMutation.connect({fromId:source.id,toId:node.id,input:true});
    selectedId = node.id;
    selectedIds = [];
    selectedImage = {nodeId:'', index:-1};
    render();
    canvasPersistence.schedule();
    toast(tr('smart.contextReversePromptLoading'));
    try{
        aiProcessorDialog.pending=false;
        aiProcessorDialogContext=null;
        await aiProcessorDialog.hide('submitted');
        await runPromptLLMNode(node.id,{
            skipUndo:true,
            throwOnSubmissionFailure:true,
            onAccepted:async()=>{
                canvasMutation.history({action:'commit'});
                context.historyCaptured=false;
            }
        });
    }catch(error){
        canvasMutation.remove({nodeIds:[node.id],options:{skipUndo:true,render:false,save:false}});
        canvasMutation.history({action:'discard'});
        context.historyCaptured=false;
        selectedId=source.id;
        selectedIds=[];
        selectedImage={nodeId:source.id,index:context.imageIndex};
        render(); canvasPersistence.schedule();
        throw error;
    }
    return node;
}
async function aiProcessorSourceSize(image,url=''){
    const fallback=mediaLayoutSize(image);
    const fallbackSize=fallback.width>0&&fallback.height>0
        ? {width:Math.round(fallback.width),height:Math.round(fallback.height)}
        : {width:1,height:1};
    const sourceUrl=String(url||image?.url||'');
    if(!sourceUrl) return fallbackSize;
    return new Promise(resolve=>{
        const probe=new Image();
        probe.onload=()=>resolve({width:Math.max(1,probe.naturalWidth),height:Math.max(1,probe.naturalHeight)});
        probe.onerror=()=>resolve(fallbackSize);
        probe.src=sourceUrl;
    });
}
const AI_PROCESSOR_STANDARD_RATIO_BY_KEY=Object.freeze({
    square:'1:1',portrait:'2:3',landscape:'3:2',portrait43:'3:4',landscape43:'4:3',story:'9:16',wide:'16:9',ultrawide:'21:9'
});
function aiProcessorResolutionForPlan(capability,plan,requested='auto'){
    return aiProcessorGeometry.resolutionTier({
        inputWidth:plan.inputWidth,
        inputHeight:plan.inputHeight,
        resolutionTiers:capability?.resolution_tiers||[],
        requested
    });
}
async function aiProcessorImagePlan(model,target,{ratio='source',resolution='auto'}={}){
    const capability=await window.SmartCanvasModules.imageCapabilities.load(model.provider_id,model.model);
    const requestedRatio=AI_PROCESSOR_STANDARD_RATIO_BY_KEY[ratio]||'';
    const supportedRatios=requestedRatio&&(capability?.aspect_ratios||[]).includes(requestedRatio)
        ? [requestedRatio]
        : capability?.aspect_ratios||aiProcessorGeometry.fallbackRatios;
    const plan=aiProcessorGeometry.closestContainingCanvas({
        width:target.width,
        height:target.height,
        supportedRatios,
        maxLongEdge:4096
    });
    return {...plan,resolution:aiProcessorResolutionForPlan(capability,plan,resolution)};
}
function aiProcessorRunSettings(model,plan){
    const ratioKey=window.SmartCanvasModules.imageCapabilities.standardToRatioKey(plan.ratio)||'custom';
    return {
        engine:'api',apiKind:'image',provider_id:model.provider_id,model:model.model,count:1,
        resolution:plan.resolution||'1k',ratio:ratioKey,customRatio:plan.ratio
    };
}
async function aiProcessorWorkingFile(sourceUrl,target,model,fillColor='white',selection={}){
    const plan=await aiProcessorImagePlan(model,target,selection);
    const working=await aiProcessorGeometry.workingBlob({
        sourceUrl,targetWidth:target.width,targetHeight:target.height,
        supportedRatios:[plan.ratio],maxLongEdge:4096,fillColor
    });
    const workingPlan={...working.plan,resolution:plan.resolution};
    const file=await aiProcessorGeometry.uploadBlob(working.blob,`ai-processor-working-${workingPlan.inputWidth}x${workingPlan.inputHeight}.png`);
    return {file,plan:workingPlan};
}
async function submitReversePromptProcessor(context,detail,model){
    const group=context.groups.find(item=>item.id===detail.groupId);
    const template=group?.templates.find(item=>item.id===detail.templateId)?.source;
    if(!template) throw new Error(tr('smart.validReversePromptTemplateRequired'));
    await createAndRunReversePromptNode({...context,libraryId:aiProcessorPromptLibrary()?.id||''},template,model);
}
async function submitOutpaintProcessor(context,detail,model){
    const source=nodes.find(item=>item.id===context.sourceNodeId);
    const image=source?.images?.[context.imageIndex];
    if(!source||!image?.url) throw new Error(tr('smart.reversePromptSourceUnavailable'));
    const sourceSize=await aiProcessorSourceSize(image,context.sourceUrl);
    const padded=await aiProcessorGeometry.paddedBlob({
        sourceUrl:context.sourceUrl,sourceWidth:sourceSize.width,sourceHeight:sourceSize.height,
        left:detail.outpaint.left,right:detail.outpaint.right,top:detail.outpaint.top,bottom:detail.outpaint.bottom,
        fillColor:detail.fillColor
    });
    const paddedFile=await aiProcessorGeometry.uploadBlob(padded.blob,`outpaint-padded-${padded.width}x${padded.height}.png`);
    const target={width:padded.width,height:padded.height};
    const working=await aiProcessorWorkingFile(paddedFile.url,target,model,detail.fillColor,{resolution:detail.outpaintResolution});
    canvasMutation.history({action:'capture'}); context.historyCaptured=true;
    const paddedNode=canvasMutation.create({
        kind:'image',
        data:{images:[{...paddedFile,natural_w:target.width,natural_h:target.height,width:target.width,height:target.height}]},
        options:{skipUndo:true,select:false,render:false,save:false,placement:{anchor:{kind:'source',sourceNodeId:source.id},relation:'downstream',arrangement:'single'}}
    });
    canvasMutation.connect({fromId:source.id,toId:paddedNode.id,input:true});
    render(); canvasPersistence.schedule();
    try{
        await generationRun.processor({
            nodeId:paddedNode.id,imageIndex:0,input:{...working.file,natural_w:working.plan.inputWidth,natural_h:working.plan.inputHeight,width:working.plan.inputWidth,height:working.plan.inputHeight},
            width:working.plan.inputWidth,height:working.plan.inputHeight,prompt:detail.prompt,
            runSettings:aiProcessorRunSettings(model,working.plan),
            onAccepted:async({node})=>{
                node.aiProcessorKind='outpaint';
                node.aiProcessorPostprocess={width:target.width,height:target.height};
                canvasMutation.history({action:'commit'}); context.historyCaptured=false;
                aiProcessorDialog.pending=false; await aiProcessorDialog.hide('accepted'); aiProcessorDialogContext=null;
            }
        });
    }catch(error){
        canvasMutation.history({action:'commit'}); context.historyCaptured=false;
        render(); canvasPersistence.schedule(); throw error;
    }
}
async function submitAngleProcessor(context,detail,model){
    const source=nodes.find(item=>item.id===context.sourceNodeId);
    const image=source?.images?.[context.imageIndex];
    if(!source||!image?.url) throw new Error(tr('smart.reversePromptSourceUnavailable'));
    const sourceSize=await aiProcessorSourceSize(image,context.sourceUrl);
    const target=aiProcessorAngleTarget(sourceSize,detail.angleAspectRatio,detail.angleResolution);
    const working=await aiProcessorWorkingFile(context.sourceUrl,target,model,'white',{
        ratio:detail.angleAspectRatio,
        resolution:detail.angleResolution
    });
    canvasMutation.history({action:'capture'}); context.historyCaptured=true;
    try{
        await generationRun.processor({
            nodeId:source.id,imageIndex:context.imageIndex,input:{...working.file,natural_w:working.plan.inputWidth,natural_h:working.plan.inputHeight,width:working.plan.inputWidth,height:working.plan.inputHeight},
            width:working.plan.inputWidth,height:working.plan.inputHeight,prompt:detail.prompt,
            runSettings:aiProcessorRunSettings(model,working.plan),
            onAccepted:async({node})=>{
                node.aiProcessorKind='angle-control';
                node.aiProcessorPostprocess={width:target.width,height:target.height};
                node.aiProcessorPrompt=detail.prompt;
                canvasMutation.history({action:'commit'}); context.historyCaptured=false;
                aiProcessorDialog.pending=false; await aiProcessorDialog.hide('accepted'); aiProcessorDialogContext=null;
            }
        });
    }catch(error){
        canvasMutation.history({action:'discard'}); context.historyCaptured=false; throw error;
    }
}
async function submitLightingReferenceProcessor(context,detail){
    const source=nodes.find(item=>item.id===context.sourceNodeId);
    const sourceImage=source?.images?.[context.imageIndex];
    if(!source||!sourceImage?.url||mediaKindForItem(sourceImage)!=='image') throw new Error(tr('smart.reversePromptSourceUnavailable'));
    const currentSource=nodes.find(item=>item.id===context.sourceNodeId);
    const currentImage=currentSource?.images?.[context.imageIndex];
    if(!currentSource||!currentImage?.url||currentImage.url!==sourceImage.url) throw new Error(tr('smart.reversePromptSourceUnavailable'));
    const intent=JSON.parse(JSON.stringify(detail.lightingIntent));
    const promptText=String(detail.lightingPrompts?.en||'').trim();
    if(!intent?.compiler_version||!promptText) throw new Error(tr('smart.lightingPromptNotReady'));
    const metadata={
        lightingIntent:intent,
        compilerVersion:intent.compiler_version,
        source:{nodeId:source.id,imageIndex:context.imageIndex,url:sourceImage.url}
    };
    const created=[];
    const previousSourceMetadata=source.metadata===undefined
        ? undefined
        : JSON.parse(JSON.stringify(source.metadata));
    canvasMutation.history({action:'capture'});
    context.historyCaptured=true;
    try{
        const generationNode=canvasMutation.create({
            kind:'image',
            data:{images:[]},
            options:{
                skipUndo:true,select:false,render:false,save:false,
                reveal:true,
                placement:{anchor:{kind:'source',sourceNodeId:source.id},relation:'downstream',arrangement:'single'}
            }
        });
        created.push(generationNode.id);
        generationNode.referenceGenerationKind='image';
        generationNode.title=tr('smart.referenceImageNode');
        generationNode.runSettings=referenceGenerationSettings(source,'image');
        generationNode.metadata=JSON.parse(JSON.stringify(metadata));
        generationNode.lightingPrompt={en:promptText};
        setPromptDraftForNode(generationNode,promptText);
        if(!canvasMutation.connect({fromId:source.id,toId:generationNode.id,input:true})) throw new Error(tr('smart.connectSourceGenerationFailed'));
        source.metadata={
            ...(source.metadata||{}),
            lightingIntent:JSON.parse(JSON.stringify(intent)),
            compilerVersion:intent.compiler_version
        };
        selectedId=generationNode.id;
        selectedIds=[];
        selectedImage={nodeId:'',index:-1};
        canvasMutation.history({action:'commit'});
        context.historyCaptured=false;
        render();
        canvasPersistence.schedule();
        aiProcessorDialog.pending=false;
        await aiProcessorDialog.hide('accepted');
        aiProcessorDialogContext=null;
        toast(tr('smart.contextLightingReferenceDone'));
        updateComposer();
        requestAnimationFrame(()=>promptInput?.focus?.({preventScroll:true}));
        return generationNode;
    }catch(error){
        if(created.length) canvasMutation.remove({nodeIds:created,options:{skipUndo:true,render:false,save:false}});
        if(previousSourceMetadata===undefined) delete source.metadata;
        else source.metadata=previousSourceMetadata;
        canvasMutation.history({action:'discard'});
        context.historyCaptured=false;
        render();
        canvasPersistence.schedule();
        throw error;
    }
}
function aiProcessorAngleTarget(source,ratioKey='source',resolution='auto'){
    const width=Math.max(1,Math.round(Number(source?.width)||1));
    const height=Math.max(1,Math.round(Number(source?.height)||1));
    if(resolution==='auto'&&ratioKey==='source') return {width,height};
    const standard=AI_PROCESSOR_STANDARD_RATIO_BY_KEY[ratioKey]||`${width}:${height}`;
    if(resolution==='auto'){
        const [ratioWidth,ratioHeight]=standard.split(':').map(Number);
        const longEdge=Math.max(width,height);
        return ratioWidth>=ratioHeight
            ? {width:longEdge,height:Math.max(1,Math.round(longEdge*ratioHeight/ratioWidth))}
            : {width:Math.max(1,Math.round(longEdge*ratioWidth/ratioHeight)),height:longEdge};
    }
    const mapped=parseSizeValue(apiImageSize(ratioKey==='source'?'custom':ratioKey,resolution,standard,''));
    return {width:Math.max(1,Number(mapped?.width)||width),height:Math.max(1,Number(mapped?.height)||height)};
}
async function submitAiProcessorDialog(detail){
    const context=aiProcessorDialogContext;
    if(aiProcessorDialog.pending) return;
    if(!context) throw new Error(tr('smart.aiProcessorContextUnavailable'));
    aiProcessorDialog.pending=true; aiProcessorDialog.setError('');
    if(detail.processor==='lighting-reference') return submitLightingReferenceProcessor(context,detail);
    const model=context.models.find(item=>item.id===detail.modelId);
    if(!model) throw new Error(tr('smart.availableModelRequired'));
    if(detail.processor==='reverse-prompt') return submitReversePromptProcessor(context,detail,model);
    if(detail.processor==='outpaint') return submitOutpaintProcessor(context,detail,model);
    return submitAngleProcessor(context,detail,model);
}
async function openAiProcessorForSmartImage(processor,nodeId,imageIndex){
    const source = nodes.find(item => item.id === nodeId);
    const image = source?.images?.[imageIndex];
    if(!source || !image?.url || mediaKindForItem(image) !== 'image') return;
    if(!promptLibraries.length && processor!=='angle-control' && processor!=='lighting-reference') await loadPromptTemplates();
    const groups=processor==='angle-control'||processor==='lighting-reference'?[]:aiProcessorPromptGroups();
    const models=processor==='lighting-reference'?[]:aiProcessorModelEntries(processor==='reverse-prompt'?'text':'image');
    const dialog=await ensureAiProcessorDialog();
    const displayImage = imageForDisplay(image);
    const sourceSize=await aiProcessorSourceSize(image,displayImage?.url||image.url);
    dialog.processor=processor;
    dialog.sourceImage = displayImage?.url || image.url;
    dialog.sourceAlt = image.alias || image.name || tr('smart.kindImage');
    dialog.sourceWidth=sourceSize.width; dialog.sourceHeight=sourceSize.height;
    dialog.initialLightingIntent=processor==='lighting-reference'&&source.metadata?.lightingIntent
        ? JSON.parse(JSON.stringify(source.metadata.lightingIntent))
        : null;
    dialog.groups=groups; dialog.models=aiProcessorDialogModels(models);
    aiProcessorDialogContext = {
        sourceNodeId:source.id,
        imageIndex,
        sourceUrl:displayImage?.url||image.url,
        processor,groups,models,historyCaptured:false
    };
    await dialog.updateComplete;
    await dialog.show();
    if(!dialog.open && aiProcessorDialogContext?.sourceNodeId === source.id){
        aiProcessorDialogContext = null;
    }
}
function createPromptNodeFromContextText(text, targetNodeId=''){
    const target = nodes.find(node => node.id === targetNodeId);
    const value = String(text || '').trim();
    const center = window.SmartCanvasModules.viewportSelection.viewport.center();
    const node = canvasMutation.create({
        kind:'prompt',
        data:{text:value},
        options:{
            select:true,
            reveal:true,
            placement:{
                anchor:target
                    ? {kind:'source',sourceNodeId:target.id}
                    : {kind:'viewport',x:center.x,y:center.y},
                relation:target ? 'downstream' : 'free',
                arrangement:'single'
            }
        }
    });
    render();
    canvasPersistence.schedule();
    return node;
}
function replaceSmartMedia(nodeId, imageIndex){
    const node = nodes.find(item => item.id === nodeId);
    const current = node?.images?.[imageIndex];
    if(!node || !current || smartNodeInFlight(node)) return;
    const kind = mediaKindForItem(current);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = kind === 'video' ? 'video/*' : kind === 'audio' ? 'audio/*' : 'image/*';
    input.multiple = false;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.onchange = async () => {
        const file = input.files?.[0];
        input.remove();
        if(!file) return;
        try {
            const uploaded = await uploadFiles([file]);
            const replacement = uploaded[0];
            if(!replacement?.url) throw new Error(tr('smart.toastUploadFail'));
            if(mediaKindForItem(replacement) !== kind) throw new Error(tr('smart.sameMediaTypeRequired'));
            const liveNode = nodes.find(item => item.id === nodeId);
            if(!liveNode?.images?.[imageIndex]) return;
            canvasMutation.history({action:'push'});
            liveNode.images[imageIndex] = stripImageGenerationMeta({...replacement, kind});
            liveNode.uploadedAttachment = true;
            ['runPrompt','runModelPrompt','runPromptRefs','runInputRefs','runSettings','sourceNodeId','runAt','runStartedAt','runFinishedAt','runElapsedMs'].forEach(key => delete liveNode[key]);
            selectedId = nodeId;
            selectedIds = [];
            selectedImage = {nodeId, index:imageIndex};
            render();
            canvasPersistence.schedule();
            toast(kind === 'image' ? tr('smart.imageReplaced') : kind === 'video' ? tr('smart.videoReplaced') : tr('smart.audioReplaced'));
        } catch(error){
            toast((error.message || tr('smart.toastUploadFail')).slice(0, 160));
        }
    };
    document.body.appendChild(input);
    input.click();
}
function smartContextSelectedMediaItems(state){
    const media = smartContextMediaTarget(state);
    if(media.item?.url) return [media.item];
    const node = nodes.find(item => item.id === state?.nodeId);
    if(smartContainer.isGroup(node)) return smartContainer.imageRefs(node).map(ref => ref.item).filter(item => item?.url);
    return (node?.images || []).filter(item => item?.url);
}
function smartSelectedCopyImageItem(){
    const ids = window.SmartCanvasModules.viewportSelection.selection.ids();
    if(ids.length !== 1) return null;
    const node = nodes.find(item => item.id === ids[0]);
    if(!node) return null;
    const state = {
        nodeId:node.id,
        mediaNodeId:selectedImage.nodeId || node.id,
        mediaIndex:selectedImage.nodeId ? selectedImage.index : -1
    };
    const media = smartContextMediaTarget(state);
    const preciseBelongsToSelection = media.node?.id === node.id
        || (smartContainer.isGroup(node) && smartContainer.groupFor(media.node?.id)?.id === node.id);
    if(preciseBelongsToSelection && media.item?.url && mediaKindForItem(media.item) === 'image') return media.item;
    const images = smartContextSelectedMediaItems({nodeId:node.id})
        .filter(item => mediaKindForItem(item) === 'image');
    return images.length === 1 ? images[0] : null;
}
async function publishSelectedWorkspaceAssets(nodeIds=[], state=null){
    const selectedNodes = [...new Set(nodeIds)].map(id => nodes.find(node => node.id === id)).filter(Boolean);
    const preciseMedia = selectedNodes.length === 1 ? smartContextMediaTarget(state) : null;
    const items = [];
    let skipped = 0;
    selectedNodes.forEach(node => {
        const images = preciseMedia?.item && preciseMedia.node?.id === node.id
            ? [{nodeId:node.id, item:preciseMedia.item, imageIndex:preciseMedia.index}].filter(ref => mediaKindForItem(ref.item) === 'image')
            : workspacePublishableImageRefs(node);
        if(!images.length){ skipped += 1; return; }
        images.forEach(({nodeId,item,imageIndex}) => items.push({
            canvas_id:canvasId,
            node_id:nodeId,
            url:item.url,
            name:String(item.name || item.alias || node.title || '').trim() || tr('smart.untitledImage'),
            image_index:imageIndex
        }));
    });
    if(!items.length) return false;
    const response = await fetch('/api/workspace-assets/publish', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({items})
    });
    const data = await response.json().catch(() => ({}));
    if(!response.ok){
        throw new Error(data.message || data.detail || tr('smart.addToAssetLibraryFailed'));
    }
    const summary = [
        trf('smart.assetsAddedCount', {count:Number(data.created || 0)}),
        Number(data.existing || 0) ? trf('smart.assetsExistingCount', {count:Number(data.existing)}) : '',
        skipped ? trf('smart.assetsSkippedCount', {count:skipped}) : ''
    ].filter(Boolean).join(tr('smart.summarySeparator'));
    toast(trf('smart.assetLibrarySummary', {summary}), {tone:'success'});
    return true;
}
async function runSmartContextMenuAction(action, state){
    const ids = window.SmartCanvasModules.viewportSelection.selection.ids().filter(id => nodes.some(node => node.id === id));
    const node = nodes.find(item => item.id === state?.nodeId);
    const media = smartContextMediaTarget(state);
    if(action === 'noop' || !node) return;
    if(action === 'publish-workspace-assets'){
        await publishSelectedWorkspaceAssets(ids.length > 1 ? ids : [node.id], state);
        return;
    }
    if(action === 'export-resource-package'){
        await exportSelectedSmartNodesAsResourcePackage();
        return;
    }
    if(action === 'copy'){ copySelectedNodes(); return; }
    if(action === 'copy-node-id'){ await copySmartText(node.id, tr('smart.nodeIdCopied')); return; }
    if(action === 'duplicate'){
        canvasMutation.duplicate({
            nodeIds:smartContainer.expand(ids),
            mode:'offset',
            preserveConnections:true,
            message:tr('smart.nodesCreated')
        });
        return;
    }
    if(action === 'clear-selection'){ window.SmartCanvasModules.viewportSelection.selection.clear(); render(); return; }
    if(action === 'delete'){
        const count = ids.length;
        if(smartContainer.remove(ids)){
            toast(count > 1 ? trf('smart.nodesDeletedUndo', {count}) : tr('smart.deletedUndo'));
        }
        return;
    }
    if(action === 'group-selection'){
        smartContainer.group(ids);
        return;
    }
    if(action === 'frame-selection'){ createFrameFromSelection(ids); return; }
    if(action === 'remove-selection-from-group'){
        const owner = smartContainer.groupFor(ids[0]);
        smartContainer.release(ids,owner?.id || '');
        return;
    }
    if(action === 'pick-media'){ pickMediaForSmartNode(node.id); return; }
    if(action === 'set-canvas-cover'){
        const targetNode = media.node || node;
        const imageIndex = media.index >= 0 ? media.index : 0;
        const item = targetNode?.images?.[imageIndex];
        if(!canvasId || !item?.url || mediaKindForItem(item) !== 'image') throw new Error(tr('smart.noCoverImage'));
        const response = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}/meta`, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                cover_url:item.url,
                cover_node_id:targetNode.id,
                cover_image_index:imageIndex
            })
        });
        if(!response.ok) throw new Error(await responseErrorMessage(response, tr('smart.setCoverFailed')));
        canvas.cover_image = {url:item.url, node_id:targetNode.id, image_index:imageIndex};
        toast(tr('smart.coverSet'));
        return;
    }
    if(action === 'replace-media'){ replaceSmartMedia(media.node?.id || node.id, media.index); return; }
    if(action === 'edit-media'){
        imageStudio.open({
            nodeId:media.node?.id || node.id,
            imageIndex:Math.max(0, media.index),
            mode:'crop',
            groupAware:false,
        });
        return;
    }
    if(action === 'extract-frame'){
        imageStudio.open({
            nodeId:media.node?.id || node.id,
            imageIndex:Math.max(0, media.index),
            mode:'preview',
            groupAware:false,
        });
        toast(tr('smart.frameExportHint'));
        return;
    }
    if(action === 'download-media'){
        const item = media.item || smartContextSelectedMediaItems(state)[0];
        if(item) downloadPreviewFile(item);
        return;
    }
    if(action === 'copy-image'){
        const item = media.item || smartContextSelectedMediaItems(state)[0];
        if(item) await copySmartImageToClipboard(item);
        return;
    }
    if(action === 'remove-media'){
        if(media.node && media.index >= 0){
            deleteImage(media.node.id, media.index);
            toast(tr('smart.mediaRemovedUndo'));
        }
        return;
    }
    if(action === 'remove-media-from-group'){
        if(media.node){
            smartContainer.release([media.node.id],node.id);
        }
        return;
    }
    if(action === 'regenerate'){ await generationRun.regenerate({nodeId:node.id}); return; }
    if(action === 'view-run-info'){
        openSmartContextResult({title:tr('smart.contextRunInfo'), status:'', text:smartRunInfoText(node), applyText:node.runPrompt || node.runModelPrompt || '', inputImages:smartRunInfoInputImages(node), readOnly:true, allowApply:true, allowCreate:false, copy:true});
        return;
    }
    if(action === 'copy-run-prompt'){ await copySmartText(node.runPrompt || node.runModelPrompt, tr('smart.runPromptCopied')); return; }
    if(action === 'query-result'){
        const task = smartRecoverableImageTask(node);
        if(task) generationRun.recover({nodeId:node.id, taskId:task.taskId, kind:'image'});
        return;
    }
    if(action === 'ungroup'){
        if(smartContainer.isGroup(node)) smartContainer.ungroup(node.id);
        else ungroupNode(node.id);
        return;
    }
    if(action === 'add-to-group'){
        const anchor = {clientX:state.clientX || 0, clientY:state.clientY || 0};
        openCreateMenu(anchor, {groupId:node.id});
        return;
    }
    if(action === 'run-group'){
        selectedId = node.id;
        selectedIds = [];
        updateComposer();
        generationRun.run({nodeId:node.id});
        return;
    }
    if(action === 'arrange-group'){
        if(smartContainer.arrange(node)){ render(); canvasPersistence.schedule(); toast(tr('smart.groupArranged')); }
        return;
    }
    if(action === 'grid-group' || action === 'download-group'){
        runSmartGroupToolbarAction(node.id, action === 'grid-group' ? 'grid' : 'download');
        return;
    }
    if(action === 'edit-prompt'){
        selectedId = node.id;
        selectedIds = [];
        render();
        requestAnimationFrame(() => beginPromptNodeTextEdit(node.id));
        return;
    }
    if(action === 'copy-prompt'){ await copySmartText(node.llmEnabled ? (node.llmInstruction || '') : (node.text || ''), tr('smart.textCopied')); return; }
    if(action === 'save-prompt-preset'){ savePromptNodeAsPreset(node); return; }
    if(action === 'run-prompt'){ runPromptLLMNode(node.id); return; }
    if(action === 'run-loop'){ generationRun.run({nodeId:node.id, mode:'loop'}); return; }
    if(action === 'stop-loop'){ generationRun.stop({loopId:node.id}); return; }
    if(action === 'rename-frame'){ beginSmartFrameTitleEdit(node.id); return; }
    if(action === 'color-frame'){ cycleSmartFrameColor(node.id); return; }
    if(action === 'ungroup-frame'){
        if(smartContainer.remove(
            [node.id],
            {preserveFrameContents:true}
        )) toast(tr('smart.ungroupedKept'));
        return;
    }
    if(action === 'delete-frame-all'){
        if(smartContainer.remove([node.id])) toast(tr('smart.frameDeletedUndo'));
        return;
    }
    if(action === 'edit-text'){
        selectedId = node.id;
        selectedIds = [];
        render();
        requestAnimationFrame(() => beginSmartTextAnnotationEdit(node.id));
        return;
    }
    if(action === 'remove-from-group'){
        const owner = smartContainer.groupFor(node.id);
        smartContainer.release([node.id],owner?.id || '');
        return;
    }
    if(action === 'disconnect-all'){
        if(canvasMutation.disconnect({nodeIds:ids,mode:'all'})){
            toast(tr('smart.disconnected'));
        }
    }
}
function bindSmartNodeContextMenu(){
    if(!smartNodeContextMenu) return;
    smartNodeContextMenu.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
    });
    smartNodeContextMenu.addEventListener('contextmenu', event => {
        event.preventDefault();
        event.stopPropagation();
    });
    smartNodeContextMenu.addEventListener('ic-select', event => {
        const item = event.composedPath().find(node => node?.localName === 'ic-menu-item');
        if(!item || item.hasAttribute('disabled')) return;
        const state = smartContextMenuState ? {...smartContextMenuState} : null;
        const action = item.getAttribute('value') || '';
        smartContextMenuState = null;
        Promise.resolve(runSmartContextMenuAction(action, state)).catch(error => toast((error.message || tr('smart.operationFailed')).slice(0, 160)));
    });
    smartNodeContextMenu.addEventListener('ic-after-hide', () => { smartContextMenuState = null; });
}
bindSmartNodeContextMenu();
smartContextResultClose?.addEventListener('click', closeSmartContextResult);
smartContextResultBackdrop?.addEventListener('mousedown', event => {
    if(event.target === smartContextResultBackdrop) closeSmartContextResult();
    event.stopPropagation();
});
smartContextResultCopy?.addEventListener('click', () => copySmartText(smartContextResultText?.value || '', tr('smart.resultCopied')));
smartContextResultCreate?.addEventListener('click', () => {
    const value = String(smartContextResultText?.value || '').trim();
    if(!value) return;
    createPromptNodeFromContextText(value, smartContextResultState?.targetNodeId || '');
    closeSmartContextResult();
    toast(tr('smart.promptNodeCreated'));
});
function applySmartContextResultToComposer(){
    const value = String(smartContextResultState?.applyText ?? smartContextResultText?.value ?? '').trim();
    const selectedNode = window.SmartCanvasModules.viewportSelection.selection.node();
    const fallbackNode = nodes.find(node => node.id === (smartContextResultState?.targetNodeId || ''));
    const targetNode = isSmartRunnableNode(selectedNode) ? selectedNode : fallbackNode;
    if(!value || !isSmartRunnableNode(targetNode)) return false;
    selectedId = targetNode.id;
    selectedIds = [];
    if(targetNode !== selectedNode){
        selectedImage = {
            nodeId:targetNode.id,
            index:Number(smartContextResultState?.targetImageIndex ?? 0)
        };
    }
    setPromptDraftForNode(targetNode, value);
    render();
    updateComposer();
    canvasPersistence.schedule();
    closeSmartContextResult();
    toast(tr('smart.promptFilled'));
    return true;
}
smartContextResultApply?.addEventListener('click', applySmartContextResultToComposer);
function connectionIndexSpecFromPoint(clientX, clientY){
    const el = document.elementFromPoint(clientX, clientY);
    const connEl = el?.closest?.('[data-conn-index]');
    return connEl?.dataset?.connIndex || '';
}
function eraseConnectionsAtClientPoint(clientX, clientY){
    if(!connectionEraseState || !canvas || !Array.isArray(canvas.connections)) return false;
    const spec = connectionIndexSpecFromPoint(clientX, clientY);
    if(!spec) return false;
    const indices = String(spec).split(',')
        .map(v => Number(v))
        .filter(n => Number.isInteger(n) && n >= 0 && n < canvas.connections.length && !connectionEraseState.indices.has(n));
    if(!indices.length) return false;
    indices.forEach(index => connectionEraseState.indices.add(index));
    connectionEraseState.started = true;
    connectionEraseState.count = connectionEraseState.indices.size;
    world.querySelectorAll('[data-conn-index]').forEach(el => {
        const hasHit = String(el.dataset.connIndex || '').split(',').some(v => connectionEraseState.indices.has(Number(v)));
        if(hasHit) el.classList.add('conn-erasing-mark');
    });
    return true;
}
function finishConnectionErase(){
    if(!connectionEraseState || !canvas || !Array.isArray(canvas.connections)) return false;
    const set = new Set(connectionEraseState.indices || []);
    if(!set.size) return false;
    return canvasMutation.disconnect({
        indexes:[...set],
        save:false
    });
}
function eraseConnectionsAtPoint(event){
    return eraseConnectionsAtClientPoint(event.clientX, event.clientY);
}
function eraseConnectionsAlongPointer(event){
    if(!connectionEraseState) return false;
    const lastX = Number.isFinite(connectionEraseState.lastX) ? connectionEraseState.lastX : event.clientX;
    const lastY = Number.isFinite(connectionEraseState.lastY) ? connectionEraseState.lastY : event.clientY;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    const steps = Math.max(1, Math.min(12, Math.ceil(Math.hypot(dx, dy) / 8)));
    let changed = false;
    for(let i = 1; i <= steps; i++){
        const t = i / steps;
        changed = eraseConnectionsAtClientPoint(lastX + dx * t, lastY + dy * t) || changed;
    }
    connectionEraseState.lastX = event.clientX;
    connectionEraseState.lastY = event.clientY;
    return changed;
}
function ensureConnectionEraseTrail(){
    let svg = shell.querySelector(':scope > svg.connection-erase-trail');
    if(svg) return svg;
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'connection-erase-trail');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<path class="connection-erase-trail-glow" fill="none"></path><path class="connection-erase-trail-line" fill="none"></path>';
    shell.appendChild(svg);
    return svg;
}
function updateConnectionEraseTrail(event){
    if(!connectionEraseState) return;
    const p = shellPoint(event);
    connectionEraseState.trail = [...(connectionEraseState.trail || []), p].slice(-80);
    const points = connectionEraseState.trail;
    const svg = ensureConnectionEraseTrail();
    const rect = shell.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`);
    const d = points.map((pt, index) => `${index ? 'L' : 'M'}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
    svg.querySelectorAll('path').forEach(path => path.setAttribute('d', d));
}
function clearConnectionEraseTrail(){
    const svg = shell.querySelector(':scope > svg.connection-erase-trail');
    if(!svg) return;
    svg.classList.add('fading');
    setTimeout(() => svg.remove(), 180);
}
function deleteImage(id, imageIndex){
    const node = nodes.find(n => n.id === id);
    if(!node || imageIndex < 0) return;
    canvasMutation.history({action:'push'});
    const previousImageCount = (node.images || []).length;
    const mediaDisplaySize = typeof generationOutputMediaDisplaySize === 'function'
        ? generationOutputMediaDisplaySize(node)
        : null;
    node.images = (node.images || []).filter((_, index) => index !== imageIndex);
    if(node.images.length <= 1 && node.type !== 'smart-group'){
        node.title = tr('smart.kindImage');
        const scale = Number(node.scale);
        if(previousImageCount > 1 && node.images.length === 1 && (
            !Number.isFinite(scale)
            || scale === MEDIA_GROUP_DEFAULT_SCALE
            || scale === MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE
        )){
            node.scale = MEDIA_NODE_DEFAULT_SCALE;
        }
    }
    if(node.images.length && mediaDisplaySize){
        preserveGenerationOutputMediaDisplaySize(node,mediaDisplaySize);
    }
    if(selectedImage.nodeId === id) selectedImage = {nodeId:id, index:Math.min(selectedImage.index, node.images.length - 1)};
    if(selectedImage.index < 0) selectedImage = {nodeId:'', index:-1};
    render();
    canvasPersistence.schedule();
}
async function renameSmartNodeImage(nodeId, imageIndex){
    const node = nodes.find(n => n.id === nodeId);
    const index = Math.max(0, Number(imageIndex) || 0);
    const image = node?.images?.[index];
    if(!node || !image) return;
    const current = imageNameLabel(image);
    const name = await openAssetNameDialog({title:tr('smart.renameImage'), value:current, placeholder:tr('smart.imageName'), cancelValue:null});
    if(name === null) return;
    const next = String(name || '').trim();
    if(!next || next === current) return;
    canvasMutation.history({action:'push'});
    image.name = next;
    selectedId = node.id;
    selectedIds = [];
    selectedImage = {nodeId:node.id, index};
    render();
    canvasPersistence.schedule();
}
let lastComposerNodeId = '';
let lastComposerModeConstraint = '';
let activeComposerSubject = null;
let smartPromptAuthoringPinnedNodeId = '';
function setSmartPromptAuthoringPin(nodeId=''){
    const nextId = String(nodeId || '');
    if(smartPromptAuthoringPinnedNodeId === nextId) return;
    if(smartPromptAuthoringPinnedNodeId){
        canvasVirtualization.unpin(
            smartPromptAuthoringPinnedNodeId,
            'prompt-authoring'
        );
    }
    smartPromptAuthoringPinnedNodeId = nextId;
    if(nextId) canvasVirtualization.pin(nextId,'prompt-authoring');
}
function currentComposerSubject(){
    return window.SmartCanvasModules.viewportSelection.selection.node();
}
function savePromptDraftForCurrent(){
    if(promptInput?.dataset?.promptLocked === '1') return;
    const subject = activeComposerNode();
    if(!subject) return;
    if(promptInput?.dataset?.restoredGenerationSnapshotFor === subject.id){
        // A frozen Generation Run prompt is display state until the user edits it.
        // Selection changes must not promote that restored text into an authored draft.
        subject.runSettings = cloneSmartSettings(settings);
        return;
    }
    if(promptInput?.dataset?.preserveDraftOnce === '1' && subject.promptDraftHtml){
        delete promptInput.dataset.preserveDraftOnce;
        return;
    }
    subject.promptDraftHtml = promptInput.innerHTML;
    subject.promptDraftText = promptPlainText();
    subject.runSettings = cloneSmartSettings(settings);
}
function setPromptDraftForNode(node, text){
    if(!isSmartRunnableNode(node)) return;
    const value = String(text || '');
    node.promptDraftHtml = escapeHtml(value);
    node.promptDraftText = value;
    node.promptDraftTouched = true;
    if(activeSettingsSubject()?.id === node.id && promptInput){
        promptInput.textContent = value;
        delete promptInput.dataset.restoredGenerationSnapshotFor;
        delete promptInput.dataset.preserveDraftOnce;
    }
}
function loadPromptDraft(subject){
    const restored = promptAuthoring.restore({node:subject});
    if(restored?.restoredGenerationSnapshot){
        // This marker is local UI state and is cleared by every authored edit path.
        promptInput.dataset.restoredGenerationSnapshotFor = subject.id;
    } else {
        delete promptInput.dataset.restoredGenerationSnapshotFor;
    }
}
function positionComposerForNode(node){
    if(!node) return;
    const rect = nodeRect(node);
    const gap = 14;
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const cardW = Math.max(0, Math.min(48 * rootFontSize, shell.clientWidth - 28));
    const nodeLeft = viewport.x + rect.x * viewport.scale;
    const nodeTop = viewport.y + rect.y * viewport.scale;
    const nodeRight = nodeLeft + rect.width * viewport.scale;
    const nodeBottom = nodeTop + rect.height * viewport.scale;
    const isVisible = nodeRight > 0 && nodeLeft < shell.clientWidth && nodeBottom > 0 && nodeTop < shell.clientHeight;
    if(!isVisible){
        composer.style.visibility = smartComposerEditingSessionActive()
            ? 'visible'
            : 'hidden';
        return;
    }
    composer.style.visibility = 'visible';
    const anchorX = nodeLeft + rect.width * viewport.scale / 2;
    const minLeft = 14;
    const maxLeft = Math.max(minLeft, shell.clientWidth - cardW - 14);
    composer.style.width = `${cardW}px`;
    composer.style.left = `${Math.max(minLeft, Math.min(maxLeft, anchorX - cardW / 2))}px`;
    composer.style.top = `${nodeBottom + gap}px`;
}
function positionCanvasFloatingOverlays(){
    const ids = window.SmartCanvasModules.viewportSelection.selection.ids();
    const node = window.SmartCanvasModules.viewportSelection.selection.node();
    if(node && composer?.classList.contains('open')) positionComposerForNode(node);
    const bounds = ids.length > 1
        ? window.SmartCanvasModules.viewportSelection.selection.bounds(ids)
        : null;
    positionSmartNodeFloatingPortal(node,bounds);
    positionSmartTextOptionsForNode();
}
let composerUpdateTimer = 0;
let composerUpdateSeq = 0;
let smartComposerPointerOwner = '';
function smartComposerOwnedOverlayOpen(){
    const componentPopover = composer?.querySelector?.(
        'ic-generation-settings-picker[open], ic-select[open], ic-popover[open], ic-menu[open]'
    );
    const mentionPopover = mentionPicker?.hasAttribute?.('open')
        && promptQuickEditor() === promptInput;
    const templatePopover = isPromptTemplatePanelOpen()
        && promptTemplatePanel.dataset.target === 'composer';
    return Boolean(componentPopover || mentionPopover || templatePopover);
}
function smartComposerInteractionTarget(target){
    if(composer?.contains?.(target)) return true;
    if(
        mentionPicker?.hasAttribute?.('open')
        && promptQuickEditor() === promptInput
        && mentionPicker.contains?.(target)
    ) return true;
    return Boolean(
        isPromptTemplatePanelOpen()
        && promptTemplatePanel.dataset.target === 'composer'
        && promptTemplatePanel.contains?.(target)
    );
}
function smartComposerEditingSessionActive(){
    if(smartComposerOwnedOverlayOpen()) return true;
    if(smartComposerPointerOwner === 'canvas') return false;
    return smartComposerPointerOwner === 'composer'
        || smartComposerInteractionTarget(document.activeElement);
}
function scheduleComposerUpdate(delay=120){
    if(composerUpdateTimer){
        clearTimeout(composerUpdateTimer);
        composerUpdateTimer = 0;
    }
    const seq = ++composerUpdateSeq;
    composerUpdateTimer = setTimeout(() => {
        composerUpdateTimer = 0;
        if(seq !== composerUpdateSeq) return;
        updateComposer();
    }, Math.max(0, Number(delay) || 0));
}
function syncPromptAuthoringHeight(){
    if(!promptInput || composer?.classList.contains('focused')) return;
    const shell = promptInput.closest('.prompt-editor-shell');
    if(!shell) return;
    const shellStyle = getComputedStyle(shell);
    const maxHeight = parseFloat(shellStyle.maxHeight) || 192;
    const statusHeight = parseFloat(
        shellStyle.getPropertyValue('--prompt-character-count-row-size')
    ) || 20;
    promptInput.style.height = '100%';
    const contentHeight = promptInput.scrollHeight || 0;
    const height = Math.max(120, Math.min(maxHeight, contentHeight + statusHeight));
    shell.style.height = `${height}px`;
    promptInput.style.overflowY = contentHeight > Math.max(0, height - statusHeight)
        ? 'auto'
        : 'hidden';
}
let composerFocusTransitionFrame = 0;
let composerFocusTransitionTimer = 0;
function finishComposerFocusTransition(){
    if(composerFocusTransitionFrame){
        cancelAnimationFrame(composerFocusTransitionFrame);
        composerFocusTransitionFrame = 0;
    }
    if(composerFocusTransitionTimer){
        clearTimeout(composerFocusTransitionTimer);
        composerFocusTransitionTimer = 0;
    }
    composer?.classList.remove('focus-transition-active', 'focus-transitioning');
    for(const property of [
        '--composer-focus-dx',
        '--composer-focus-dy',
        '--composer-focus-scale-x',
        '--composer-focus-scale-y'
    ]) composer?.style.removeProperty(property);
}
function animateComposerFocusTransition(fromRect){
    if(!composer || !fromRect){
        finishComposerFocusTransition();
        return;
    }
    const toRect = composer.getBoundingClientRect();
    if(!fromRect.width || !fromRect.height || !toRect.width || !toRect.height){
        finishComposerFocusTransition();
        return;
    }
    const dx = fromRect.left - toRect.left;
    const dy = fromRect.top - toRect.top;
    const scaleX = fromRect.width / toRect.width;
    const scaleY = fromRect.height / toRect.height;
    composer.style.setProperty('--composer-focus-dx', `${dx}px`);
    composer.style.setProperty('--composer-focus-dy', `${dy}px`);
    composer.style.setProperty('--composer-focus-scale-x', String(scaleX));
    composer.style.setProperty('--composer-focus-scale-y', String(scaleY));
    composer.classList.add('focus-transitioning');
    void composer.getBoundingClientRect();
    composerFocusTransitionFrame = requestAnimationFrame(() => {
        composerFocusTransitionFrame = 0;
        composer.classList.add('focus-transition-active');
        composerFocusTransitionTimer = setTimeout(finishComposerFocusTransition, 240);
    });
}
function syncPromptFocusBackdrop(){
    const active = Boolean(composer?.classList.contains('focused'));
    composerFocusBackdrop?.classList.toggle('open', active);
    composerFocusBackdrop?.setAttribute('aria-hidden', active ? 'false' : 'true');
}
function renderPromptNodeFocusDialog(node){
    if(!promptNodeFocusSurface || !node) return null;
    const generationClass = nodeKinds.isPromptGeneration(node)
        ? ' prompt-generation-smart-node'
        : '';
    promptNodeFocusSurface.innerHTML = `<section class="prompt-node-focus-dialog image-node canvas-lod-node-detail prompt-smart-node${generationClass}" data-id="${escapeAttr(node.id)}">
        <div class="node-body">${promptNodeBodyHtml(node)}</div>
    </section>`;
    const dialog = promptNodeFocusSurface.querySelector('.prompt-node-focus-dialog');
    if(!dialog) return null;
    bindPromptNodeControls(dialog, node);
    bindSmartPreviewImageFallbacks(dialog);
    refreshIcons();
    return dialog;
}
function setPromptNodeFocused(nodeId, focused){
    const previousNodeId = focusedPromptNodeId;
    const node = nodes.find(item => item.id === nodeId && nodeKinds.isPromptFamily(item));
    const active = Boolean(focused && node && !node.textGenerationPending);
    if(!active){
        if(promptQuickTargetEl?.closest?.('.prompt-node-focus-surface')) closeMentionPicker();
        promptNodeFocusSurface?.querySelector('.is-editing')?.blur?.();
        focusedPromptNodeId = '';
        if(promptNodeFocusSurface){
            promptNodeFocusSurface.removeAttribute('open');
            promptNodeFocusSurface.replaceChildren();
        }
        syncPromptFocusBackdrop();
        const restoreNodeId = previousNodeId || nodeId;
        if(restoreNodeId){
            render({nodeIds:[restoreNodeId], syncVirtualization:false});
            requestAnimationFrame(() => {
                const target = smartNodeFloatingPortal?.querySelector(
                    `[data-smart-node-action="focus-editor"][data-node-id="${CSS.escape(restoreNodeId)}"]`
                );
                target?.focus?.({preventScroll:true});
            });
        }
        return false;
    }
    setPromptAuthoringFocused(false);
    document.dispatchEvent(new CustomEvent('ic-overlay-scope-activate', {
        detail:{scope:promptNodeFocusSurface},
    }));
    focusedPromptNodeId = node.id;
    promptNodeFocusSurface.setAttribute('label', tr('smart.promptEditor'));
    promptNodeFocusSurface.setAttribute('open', '');
    const dialog = renderPromptNodeFocusDialog(node);
    if(!dialog){
        setPromptNodeFocused('', false);
        return false;
    }
    syncPromptFocusBackdrop();
    requestAnimationFrame(() => beginPromptNodeTextEdit(node.id));
    return true;
}
function setPromptAuthoringFocused(focused){
    const active = Boolean(focused && composer?.classList.contains('open'));
    const stateChanged = active !== composer?.classList.contains('focused');
    finishComposerFocusTransition();
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const fromRect = stateChanged && !reduceMotion ? composer?.getBoundingClientRect() : null;
    if(active){
        document.dispatchEvent(new CustomEvent('ic-overlay-scope-activate', {
            detail:{scope:composer},
        }));
    }
    composer?.classList.toggle('focused', active);
    if(active){
        composer?.setAttribute('role', 'dialog');
        composer?.setAttribute('aria-modal', 'true');
        composer?.setAttribute('aria-label', tr('smart.promptEditor'));
    } else {
        composer?.removeAttribute('role');
        composer?.removeAttribute('aria-modal');
        composer?.removeAttribute('aria-label');
    }
    syncPromptFocusBackdrop();
    composerFocusToggle?.setAttribute('aria-expanded', active ? 'true' : 'false');
    if(composerFocusToggle){
        composerFocusToggle.dataset.i18nLabel = active ? 'smart.collapseEditor' : 'smart.focusEdit';
        composerFocusToggle.label = active ? tr('smart.collapseEditor') : tr('smart.focusEdit');
        composerFocusToggle.icon = active ? 'collapse-editor' : 'focus-editor';
    }
    if(!active) syncPromptAuthoringHeight();
    if(fromRect) animateComposerFocusTransition(fromRect);
    else finishComposerFocusTransition();
    requestAnimationFrame(() => {
        if(active || (composer?.classList.contains('open') && activeComposerNode())){
            promptInput?.focus?.({preventScroll:true});
        }
        refreshIcons();
    });
}
function updateComposer({skipDynamicParamsRefresh=false}={}){
    if(composerUpdateTimer){
        clearTimeout(composerUpdateTimer);
        composerUpdateTimer = 0;
    }
    composerUpdateSeq++;
    const node = window.SmartCanvasModules.viewportSelection.selection.node();
    syncRunButtonState(node);
    if(generationRun.status().silentSelection && !activeComposerSubject){
        hideInputTextPreviewTooltip();
        composer.classList.remove('open');
        activeComposerSubject = null;
        lastComposerNodeId = '';
        lastComposerModeConstraint = '';
        return;
    }
    composer.classList.toggle('open', !!node);
    if(!node) setPromptAuthoringFocused(false);
    if(!isSmartRunnableNode(node)){
        hideInputTextPreviewTooltip();
        savePromptDraftForCurrent();
        composer.classList.remove('open');
        activeComposerSubject = null;
        lastComposerNodeId = '';
        lastComposerModeConstraint = '';
        setPromptInputLocked(false);
        if(!node) setPromptText('');
        return;
    }
    // composer 只绑定节点本身：图片只是素材/结果，不携带提示词或参数状态。
    const subject = node;
    const composerKey = `${node.id}:node`;
    const modeConstraint = smartNodeGenerationEligibility(node).forcedApiKind;
    const switchedNode = lastComposerNodeId !== composerKey;
    const switchedModeConstraint = lastComposerModeConstraint !== modeConstraint;
    if(switchedNode || switchedModeConstraint) savePromptDraftForCurrent();
    lastComposerNodeId = composerKey;
    lastComposerModeConstraint = modeConstraint;
    activeComposerSubject = subject;
    if(switchedNode || switchedModeConstraint){
        settings = smartSettingsForNode(subject);
        loadPromptDraft(subject);
    }
    syncApiKindToggleVisibility();
    syncRunButtonState(node);
    setPromptInputLocked(false);
    positionComposerForNode(node);
    syncPromptAuthoringHeight();
    renderInputThumbsRow(node);
    if(!skipDynamicParamsRefresh) scheduleDynamicParamsRefresh(140);
}
function composerMentionTokenReference(token){
    return {
        url:String(token?.dataset?.url || ''),
        kind:String(token?.dataset?.kind || 'image'),
        nodeId:String(token?.dataset?.nodeId || ''),
        imageIndex:token?.dataset?.imageIndex === '' ? '' : Number(token?.dataset?.imageIndex || 0),
        outputId:String(token?.dataset?.outputId || ''),
        inputInstanceId:String(token?.dataset?.inputInstanceId || '')
    };
}
function composerMentionTokenLabelElement(token){
    return token?.querySelector?.(':scope > .mention-token-label')
        || token?.querySelector?.(':scope > span:last-child')
        || null;
}
function composerOwnsPromptEditor(node){
    return Boolean(
        node?.id
        && typeof promptInput !== 'undefined'
        && promptInput?.querySelectorAll
        && typeof activeComposerNode === 'function'
        && activeComposerNode()?.id === node.id
    );
}
function syncComposerMentionTokenLabels(node, refs=[]){
    if(!composerOwnsPromptEditor(node)) return false;
    const mediaCounters = {image:0, video:0, audio:0, text:0, file:0};
    const labelsByKey = new Map();
    (refs || []).forEach(ref => {
        const key = inputRefKey(ref);
        const label = composerInputMediaLabel(ref, mediaCounters);
        if(key) labelsByKey.set(key, label);
    });
    let changed = false;
    promptInput.querySelectorAll('.mention-image-token').forEach(token => {
        const label = labelsByKey.get(inputRefKey(composerMentionTokenReference(token)));
        if(!label) return;
        const labelElement = composerMentionTokenLabelElement(token);
        if(token.dataset.name !== label){
            token.dataset.name = label;
            changed = true;
        }
        if(labelElement && labelElement.textContent !== label){
            labelElement.textContent = label;
            changed = true;
        }
        labelElement?.classList?.add('mention-token-label');
    });
    if(changed) savePromptDraftForCurrent();
    return changed;
}
function removeComposerMentionTokensForReference(node, key){
    if(!key || !composerOwnsPromptEditor(node)) return false;
    let changed = false;
    promptInput.querySelectorAll('.mention-image-token').forEach(token => {
        if(inputRefKey(composerMentionTokenReference(token)) !== key) return;
        const next = token.nextSibling;
        token.remove();
        if(next?.nodeType === Node.TEXT_NODE && String(next.textContent || '').startsWith(' ')){
            next.textContent = String(next.textContent || '').slice(1);
        }
        changed = true;
    });
    if(changed){
        delete promptInput.dataset.restoredGenerationSnapshotFor;
        savePromptDraftForCurrent();
    }
    return changed;
}
function renderInputThumbsRow(node){
    if(!inputThumbsRow) return;
    syncJimengModelPillForRefs();
    syncJimengVideoModelPillForRefs();
    const authoring = node ? promptAuthoring.resolve({node}) : {refs:[],textRefs:[]};
    const dedup = authoring.refs || [];
    syncComposerMentionTokenLabels(node, dedup);
    const textReferences = authoring.textRefs || [];
    const localTextReferences = Array.isArray(node?.localTextRefs) ? node.localTextRefs : [];
    const totalInputCount = dedup.length + textReferences.length + localTextReferences.length;
    const manualRefKeys = new Set(manualReferenceImagesFor(node).map(img => inputRefKey(img)));
    // 仅当参考图集合/状态真正变化时才重建缩略图 DOM。否则每敲一个字都重建并重新解码所有图片，
    // 参考图多时会让输入框打字明显卡顿。
    const thumbsSignature = JSON.stringify({
        language:window.StudioI18n?.lang?.() || 'zh',
        node: node?.id || '',
        items: dedup.map(img => `${inputRefKey(img)}@${img.url || ''}`),
        textItems: textReferences.map(ref => `${ref.id}@${ref.title || ''}@${textForNode(ref).trim()}`),
        localTextItems:localTextReferences.map(ref => `${ref.inputInstanceId}@${ref.name || ''}@${ref.textBytes || 0}@${ref.textError || ''}`),
        manual: [...manualRefKeys],
        generationKind:isApiLikeEngine(settings.engine) ? settings.apiKind : settings.engine,
        videoReferenceMode:settings.apiKind === 'video' && settings.videoUseFrameRoles
            ? 'first_last_frames'
            : 'multimodal_all_around'
    });
    if(inputThumbsRow.dataset.thumbsSig === thumbsSignature) return;
    hideInputTextPreviewTooltip();
    inputThumbsRow.dataset.thumbsSig = thumbsSignature;
    inputThumbsRow.classList.toggle('has-items', Boolean(node));
    if(!node){ inputThumbsRow.innerHTML = ''; return; }
    const addButtonLabel = tr('smart.uploadLocalReference');
    const addButton = `<button class="input-thumb-add" type="button" data-input-add-reference title="${escapeAttr(addButtonLabel)}" aria-label="${escapeAttr(addButtonLabel)}"><i data-lucide="upload"></i></button>`;
    if(!totalInputCount){
        inputThumbsRow.innerHTML = `<div class="input-thumb-list empty">${addButton}</div>`;
        bindInputThumbReferenceActions();
        refreshIcons();
        return;
    }
    const mediaCounters = {image:0, video:0, audio:0, text:0, file:0};
    const thumbsHtml = dedup.map((img, index) => composerInputMediaThumbHtml(node, img, index, manualRefKeys, mediaCounters)).join('');
    const directTextIds = new Set(promptInputNodesFor(node).map(ref => ref.id));
    let textThumbsHtml = textReferences.map((ref, index) => {
        const label = trf('smart.textNumber', {number: index + 1});
        const fullText = textForNode(ref).trim();
        const fullPreview = fullText.replace(/\s+/g, ' ');
        const preview = fullPreview.length > 160 ? `${fullPreview.slice(0, 160)}…` : fullPreview;
        const sourceName = String(ref.title || label).trim() || label;
        const removable = directTextIds.has(ref.id);
        return `<ic-reference-thumbnail class="input-text-reference" kind="text" label="${escapeAttr(label)}" preview-text="${escapeAttr(fullText)}" ${removable ? `removable remove-label="${escapeAttr(tr('smart.removeTextReference'))}" data-input-remove-text-reference="${escapeAttr(ref.id)}"` : ''} draggable="false" data-text-node-id="${escapeAttr(ref.id)}" data-text-preview="${escapeAttr(preview)}" data-reference-text="${escapeAttr(fullText)}" data-name="${escapeAttr(sourceName)}" aria-label="${escapeAttr(`${sourceName}：${preview}`)}"></ic-reference-thumbnail>`;
    }).join('');
    const localTextThumbsHtml = localTextReferences.map((ref, index) => {
        const label = `TXT ${index + 1}`;
        const preview = String(ref.textSnapshot || '').replace(/\s+/g, ' ').slice(0, 160);
        const error = String(ref.textError || '');
        return `<div class="input-thumb input-text-reference ${error ? 'is-invalid' : ''}" draggable="${localTextReferences.length > 1}" data-local-text-instance-id="${escapeAttr(ref.inputInstanceId || '')}" data-text-preview="${escapeAttr(preview || error)}" data-reference-text="${escapeAttr(ref.textSnapshot || '')}" data-kind="text" data-name="${escapeAttr(ref.name || label)}" aria-label="${escapeAttr(`${ref.name || label}：${preview || error}`)}"><div class="input-thumb-text-icon"><i data-lucide="file-text"></i></div><span class="input-thumb-label">${escapeHtml(label)}</span><button class="input-thumb-remove" type="button" draggable="false" data-input-remove-local-text-reference="${escapeAttr(ref.inputInstanceId || '')}" title="${escapeAttr(tr('smart.removeTxtReference'))}" aria-label="${escapeAttr(tr('smart.removeTxtReference'))}"><ic-icon name="close" size="x-small" aria-hidden="true"></ic-icon></button></div>`;
    }).join('');
    textThumbsHtml += localTextThumbsHtml;
    inputThumbsRow.innerHTML = `<div class="input-thumb-list ${totalInputCount > 1 ? 'is-scrollable' : 'is-single'}">${thumbsHtml}${textThumbsHtml}${addButton}</div>`;
    bindSmartPreviewImageFallbacks(inputThumbsRow);
    bindInputThumbsDrag(node, dedup, manualRefKeys);
    if(typeof bindLocalTextReferenceDrag === 'function') bindLocalTextReferenceDrag(node);
    bindInputThumbReferenceActions();
    bindInputTextReferencePreviews();
    refreshIcons();
}
function showInputTextPreviewTooltip(anchor){
    if(!inputTextPreviewTooltip || !anchor) return;
    const text = String(anchor.dataset.textPreview || '').trim();
    if(!text) return;
    inputTextPreviewTooltip.setAttribute('content', text);
    inputTextPreviewTooltip.show(anchor);
}
function hideInputTextPreviewTooltip(){
    inputTextPreviewTooltip?.hide?.('programmatic');
}
function referenceDataFromElement(element){
    return {
        url:String(element?.dataset?.url || element?.dataset?.sourceUrl || ''),
        kind:String(element?.dataset?.kind || 'image'),
        name:String(element?.dataset?.name || tr('smart.referencePreview')),
        text:String(element?.dataset?.referenceText || element?.dataset?.textPreview || ''),
        nodeId:String(element?.dataset?.nodeId || ''),
        imageIndex:Number(element?.dataset?.imageIndex || 0),
        outputId:String(element?.dataset?.outputId || ''),
        inputInstanceId:String(element?.dataset?.inputInstanceId || '')
    };
}
function openReferenceViewer(reference={}){
    if(!referenceViewerBackdrop || !referenceViewerContent) return;
    const kind = reference.kind || 'image';
    if(kind === 'image' && reference.nodeId){
        const source = nodes.find(node => node.id === reference.nodeId);
        const outputIndex = reference.outputId
            ? (source?.images || []).findIndex(item => item.outputId === reference.outputId)
            : -1;
        if(source && (source.images || []).length){
            imageStudio.open({
                nodeId:source.id,
                imageIndex:outputIndex >= 0 ? outputIndex : Math.max(0, reference.imageIndex),
                mode:'preview',
                groupAware:false
            });
            return;
        }
    }
    referenceViewerTitle.textContent = reference.name || tr('smart.referencePreview');
    if(kind === 'text'){
        referenceViewerContent.innerHTML = `<pre>${escapeHtml(reference.text || '')}</pre>`;
    } else if(kind === 'video'){
        referenceViewerContent.innerHTML = `<video src="${escapeAttr(reference.url || '')}" controls preload="metadata" playsinline></video>`;
    } else if(kind === 'audio'){
        referenceViewerContent.innerHTML = `<audio src="${escapeAttr(reference.url || '')}" controls preload="metadata"></audio>`;
    } else {
        referenceViewerContent.innerHTML = `
            <div class="reference-image-stage">
                <img src="${escapeAttr(reference.url || '')}" alt="${escapeAttr(reference.name || tr('smart.referencePreview'))}">
            </div>
            <div class="reference-image-toolbar">
                <button type="button" data-reference-zoom-out aria-label="${escapeAttr(tr('smart.zoomOut'))}">−</button>
                <button type="button" data-reference-zoom-reset>100%</button>
                <button type="button" data-reference-zoom-in aria-label="${escapeAttr(tr('smart.zoomIn'))}">＋</button>
                <a href="${escapeAttr(reference.url || '')}" download="${escapeAttr(reference.name || 'image')}">${escapeHtml(tr('smart.contextDownload'))}</a>
            </div>`;
    }
    referenceViewerBackdrop.hidden = false;
    const imageStage = referenceViewerContent.querySelector('.reference-image-stage');
    const image = imageStage?.querySelector('img');
    if(imageStage && image){
        const view = {scale:1,x:0,y:0,drag:null};
        const apply = () => {
            image.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.scale})`;
            const reset = referenceViewerContent.querySelector('[data-reference-zoom-reset]');
            if(reset) reset.textContent = `${Math.round(view.scale * 100)}%`;
        };
        const zoom = delta => {
            view.scale = Math.max(.25, Math.min(8, view.scale * delta));
            apply();
        };
        referenceViewerContent.querySelector('[data-reference-zoom-out]')?.addEventListener('click', () => zoom(1 / 1.25));
        referenceViewerContent.querySelector('[data-reference-zoom-in]')?.addEventListener('click', () => zoom(1.25));
        referenceViewerContent.querySelector('[data-reference-zoom-reset]')?.addEventListener('click', () => {
            Object.assign(view, {scale:1,x:0,y:0});
            apply();
        });
        imageStage.addEventListener('wheel', event => {
            event.preventDefault();
            zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12);
        }, {passive:false});
        imageStage.addEventListener('pointerdown', event => {
            view.drag = {x:event.clientX,y:event.clientY,originX:view.x,originY:view.y};
            imageStage.setPointerCapture?.(event.pointerId);
        });
        imageStage.addEventListener('pointermove', event => {
            if(!view.drag) return;
            view.x = view.drag.originX + event.clientX - view.drag.x;
            view.y = view.drag.originY + event.clientY - view.drag.y;
            apply();
        });
        imageStage.addEventListener('pointerup', () => { view.drag = null; });
        imageStage.addEventListener('pointercancel', () => { view.drag = null; });
        apply();
    }
    referenceViewerTitle?.focus({preventScroll:true});
}
function closeReferenceViewer(){
    if(!referenceViewerBackdrop) return;
    referenceViewerBackdrop.hidden = true;
    referenceViewerContent?.querySelectorAll('audio,video').forEach(media => {
        media.pause();
        media.removeAttribute('src');
        media.load();
    });
    if(referenceViewerContent) referenceViewerContent.innerHTML = '';
}
let referenceHoverHideTimer = 0;
function hideReferenceHoverPreview(){
    clearTimeout(referenceHoverHideTimer);
    referenceHoverHideTimer = setTimeout(() => {
        if(!mentionPreview?.matches(':hover')){
            mentionPreview.style.display = 'none';
            mentionPreview.setAttribute('aria-hidden', 'true');
            mentionPreview.innerHTML = '';
        }
    }, 80);
}
function showReferenceHoverPreview(anchor, reference={}){
    if(!mentionPreview || !anchor || reference.kind === 'audio') return;
    if(reference.kind === 'text' ? !reference.text : !reference.url) return;
    const gap = 8;
    const edge = 8;
    clearTimeout(referenceHoverHideTimer);
    const media = reference.kind === 'text'
        ? `<div class="reference-text-hover">${escapeHtml(reference.text)}</div>`
        : reference.kind === 'video'
        ? `<video src="${escapeAttr(reference.url)}" muted preload="metadata" playsinline></video>`
        : `<img src="${escapeAttr(reference.url)}" alt="${escapeAttr(reference.name || 'preview')}">`;
    const actionLabel = reference.kind === 'text'
        ? tr('smart.viewSourceText')
        : reference.kind === 'video' ? tr('smart.viewSourceVideo') : tr('smart.viewSourceImage');
    mentionPreview.innerHTML = `${media}<button type="button" data-reference-viewer-open>${actionLabel}</button>`;
    mentionPreview.dataset.url = reference.url;
    mentionPreview.dataset.kind = reference.kind || 'image';
    mentionPreview.dataset.name = reference.name || '';
    mentionPreview.dataset.nodeId = reference.nodeId || '';
    mentionPreview.dataset.imageIndex = String(reference.imageIndex || 0);
    mentionPreview.dataset.outputId = reference.outputId || '';
    mentionPreview.dataset.referenceText = reference.text || '';
    const rect = anchor.getBoundingClientRect();
    mentionPreview.style.display = 'block';
    mentionPreview.setAttribute('aria-hidden', 'false');
    const previewRect = mentionPreview.getBoundingClientRect();
    const left = Math.max(edge, Math.min(window.innerWidth - previewRect.width - edge, rect.left));
    const top = anchor.matches('.input-thumb')
        ? rect.top - previewRect.height - gap
        : Math.min(window.innerHeight - previewRect.height - edge, rect.bottom + gap);
    mentionPreview.style.left = `${left}px`;
    mentionPreview.style.top = `${Math.max(edge, top)}px`;
}
function bindInputTextReferencePreviews(){
    if(!inputThumbsRow || !inputTextPreviewTooltip) return;
    inputThumbsRow.querySelectorAll('.input-text-reference[data-text-preview]').forEach(thumb => {
        thumb.addEventListener('focusin', () => showInputTextPreviewTooltip(thumb));
        thumb.addEventListener('focusout', event => {
            if(!thumb.contains(event.relatedTarget)) hideInputTextPreviewTooltip();
        });
    });
}
function bindInputThumbReferenceActions(root=inputThumbsRow, node=window.SmartCanvasModules.viewportSelection.selection.node(), {onRefresh=null}={}){
    root?.querySelectorAll('[data-input-add-reference]').forEach(btn => {
        btn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            openLocalReferenceUpload(node);
        });
    });
    root?.querySelectorAll('ic-reference-thumbnail[data-input-remove-reference]').forEach(thumb => {
        thumb.addEventListener('ic-remove', event => {
            event.preventDefault();
            event.stopPropagation();
            removeInputReferenceFromNode(node, event.detail?.referenceKey || thumb.dataset.inputRemoveReference || '', {onRefresh});
        });
    });
    root?.querySelectorAll('ic-reference-thumbnail[data-input-remove-text-reference]').forEach(thumb => {
        thumb.addEventListener('ic-remove', event => {
            event.preventDefault();
            event.stopPropagation();
            removeTextInputReferenceFromSelectedNode(event.detail?.textReferenceId || thumb.dataset.inputRemoveTextReference || '');
        });
    });
    root?.querySelectorAll('[data-input-remove-local-text-reference]').forEach(btn => {
        btn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            removeLocalTextReference(node, btn.dataset.inputRemoveLocalTextReference || '');
        });
    });
}
function bindInputThumbsDrag(node, items, manualRefKeys=new Set(), {root=inputThumbsRow,onRefresh=null}={}){
    if(!root) return;
    let thumbDragIndex = -1;
    root.querySelectorAll('.input-thumb[data-thumb-index]').forEach(el => {
        const index = Number(el.dataset.thumbIndex || -1);
        const item = items[index];
        const key = inputRefKey(item);
        el.draggable = items.length > 1 && Boolean(key);
        el.addEventListener('ic-activate', e => {
            e.preventDefault();
            e.stopPropagation();
            openReferenceViewer(referenceDataFromElement(el));
        });
        if(!el.draggable) return;
        el.addEventListener('dragstart', e => {
            e.stopPropagation();
            thumbDragIndex = index;
            el.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('application/x-smart-input-thumb', String(index));
            e.dataTransfer.setData('text/plain', key);
        });
        el.addEventListener('dragend', e => {
            e.stopPropagation();
            thumbDragIndex = -1;
            clearInputThumbDropMarkers(root);
            el.classList.remove('dragging');
        });
        el.addEventListener('dragover', e => {
            const rawFrom = e.dataTransfer.getData('application/x-smart-input-thumb');
            const from = rawFrom === '' ? thumbDragIndex : Number(rawFrom);
            if(!Number.isFinite(from) || from < 0 || from === index) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            clearInputThumbDropMarkers(root);
            const placement = inputThumbDropPlacement(el, e);
            el.dataset.dropPlacement = placement;
            el.classList.add(placement === 'before' ? 'drop-before' : 'drop-after');
        });
        el.addEventListener('dragleave', e => {
            if(el.contains(e.relatedTarget)) return;
            delete el.dataset.dropPlacement;
            el.classList.remove('drop-before', 'drop-after');
        });
        el.addEventListener('drop', e => {
            const rawFrom = e.dataTransfer.getData('application/x-smart-input-thumb');
            const from = rawFrom === '' ? thumbDragIndex : Number(rawFrom);
            if(!Number.isFinite(from) || from < 0 || from === index) return;
            e.preventDefault();
            e.stopPropagation();
            const placement = inputThumbDropPlacement(el, e);
            clearInputThumbDropMarkers(root);
            reorderInputThumb(node, items, from, index, placement, {root,onRefresh});
        });
    });
}
function bindLocalTextReferenceDrag(node, {root=inputThumbsRow}={}){
    if(!root || !node) return;
    let draggedId = '';
    const thumbs = [...root.querySelectorAll('[data-local-text-instance-id]')];
    thumbs.forEach(thumb => {
        const id = thumb.dataset.localTextInstanceId || '';
        thumb.draggable = thumbs.length > 1 && Boolean(id);
        thumb.addEventListener('click', event => {
            if(event.target.closest('[data-input-remove-local-text-reference]')) return;
            event.preventDefault();
            event.stopPropagation();
            openReferenceViewer(referenceDataFromElement(thumb));
        });
        if(!thumb.draggable) return;
        thumb.addEventListener('dragstart', event => {
            draggedId = id;
            thumb.classList.add('dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/x-smart-local-text', id);
        });
        thumb.addEventListener('dragend', () => {
            draggedId = '';
            clearInputThumbDropMarkers(root);
        });
        thumb.addEventListener('dragover', event => {
            const fromId = event.dataTransfer.getData('application/x-smart-local-text') || draggedId;
            if(!fromId || fromId === id) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            clearInputThumbDropMarkers(root);
            const placement = inputThumbDropPlacement(thumb, event);
            thumb.dataset.dropPlacement = placement;
            thumb.classList.add(placement === 'before' ? 'drop-before' : 'drop-after');
        });
        thumb.addEventListener('drop', event => {
            const fromId = event.dataTransfer.getData('application/x-smart-local-text') || draggedId;
            if(!fromId || fromId === id) return;
            event.preventDefault();
            event.stopPropagation();
            const refs = Array.isArray(node.localTextRefs) ? node.localTextRefs.slice() : [];
            const fromIndex = refs.findIndex(ref => ref?.inputInstanceId === fromId);
            const targetIndex = refs.findIndex(ref => ref?.inputInstanceId === id);
            if(fromIndex < 0 || targetIndex < 0) return;
            const placement = inputThumbDropPlacement(thumb, event);
            const [moved] = refs.splice(fromIndex, 1);
            let insertAt = refs.findIndex(ref => ref?.inputInstanceId === id);
            if(placement === 'after') insertAt += 1;
            refs.splice(insertAt, 0, moved);
            canvasMutation.history({action:'push'});
            node.localTextRefs = refs;
            renderInputThumbsRow(node);
            canvasPersistence.schedule();
        });
    });
}
function reorderManualInputRefs(currentNode, fromKey, targetKey, placement='before'){
    if(!currentNode || !fromKey || !targetKey || fromKey === targetKey) return false;
    const refs = Array.isArray(currentNode.manualInputRefs) ? currentNode.manualInputRefs.slice() : [];
    const from = refs.findIndex(item => inputRefKey(item) === fromKey);
    const target = refs.findIndex(item => inputRefKey(item) === targetKey);
    if(from < 0 || target < 0 || from === target) return false;
    canvasMutation.history({action:'push'});
    const [moved] = refs.splice(from, 1);
    let insertAt = refs.findIndex(item => inputRefKey(item) === targetKey);
    if(insertAt < 0) return false;
    if(placement === 'after') insertAt += 1;
    refs.splice(insertAt, 0, moved);
    currentNode.manualInputRefs = refs;
    if(inputThumbsRow) delete inputThumbsRow.dataset.thumbsSig;
    renderInputThumbsRow(currentNode);
    canvasPersistence.schedule();
    return true;
}
function inputThumbDropPlacement(el, event){
    const rect = el.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
}
function clearInputThumbDropMarkers(root=inputThumbsRow){
    root?.querySelectorAll('.input-thumb.drop-before,.input-thumb.drop-after,.input-thumb.dragging')
        .forEach(el => {
            delete el.dataset.dropPlacement;
            el.classList.remove('drop-before', 'drop-after', 'dragging');
        });
}
function bindInputThumbVideoActions(){
    inputThumbsRow?.querySelectorAll('[data-manual-video-url]').forEach(btn => {
        btn.onclick = async event => {
            event.preventDefault();
            event.stopPropagation();
            try {
                await setCurrentSmartManualVideoUrl();
            } catch(e) {
                toast((e.message || tr('canvas.setVideoUrlFailed')).slice(0, 180));
            }
        };
    });
    inputThumbsRow?.querySelectorAll('[data-temp-sh-upload-video]').forEach(btn => {
        btn.onclick = async event => {
            event.preventDefault();
            event.stopPropagation();
            try {
                await uploadCurrentSmartVideosToCloud();
            } catch(e) {
                toast((e.message || tr('smart.cloudUploadFailed')).slice(0, 180));
            }
        };
    });
}
function movedBeforeAfterIds(ids, movedId, targetId, placement='before'){
    const list = (ids || []).filter(Boolean);
    const from = list.indexOf(movedId);
    const target = list.indexOf(targetId);
    if(from < 0 || target < 0 || movedId === targetId) return list;
    const [moved] = list.splice(from, 1);
    let insertAt = list.indexOf(targetId);
    if(insertAt < 0) return ids || [];
    if(placement === 'after') insertAt += 1;
    list.splice(insertAt, 0, moved);
    return list;
}
function sameOrderedIds(a, b){
    if((a || []).length !== (b || []).length) return false;
    return (a || []).every((id, index) => id === b[index]);
}
function reorderInputSourceNodes(currentNode, movedId, targetId, placement='before'){
    if(!currentNode || !movedId || !targetId || movedId === targetId) return false;
    const sourceNodes = smartImageUsesWorkflowInput(currentNode, smartLoopContext)
        ? workflowInputNodesFor(currentNode)
        : inputNodesFor(currentNode);
    const sourceIds = sourceNodes.map(n => n.id).filter(Boolean);
    if(!sourceIds.includes(movedId) || !sourceIds.includes(targetId)) return false;
    const nextIds = movedBeforeAfterIds(sourceIds, movedId, targetId, placement);
    if(sameOrderedIds(sourceIds, nextIds)) return false;
    const oldExplicitIds = Array.isArray(currentNode.inputNodeIds) ? currentNode.inputNodeIds.filter(Boolean) : [];
    currentNode.inputNodeIds = [
        ...nextIds.filter(id => oldExplicitIds.includes(id)),
        ...oldExplicitIds.filter(id => !nextIds.includes(id))
    ];
    if(canvas && Array.isArray(canvas.connections)){
        const order = new Map(nextIds.map((id, index) => [id, index]));
        const relevantSlots = new Set();
        const relevant = [];
        canvas.connections.forEach((conn, index) => {
            const kind = conn?.kind || 'flow';
            if(conn?.to === currentNode.id && ['input', 'flow'].includes(kind) && order.has(conn.from)){
                relevantSlots.add(index);
                relevant.push({conn, index});
            }
        });
        if(relevant.length){
            relevant.sort((a, b) => (order.get(a.conn.from) - order.get(b.conn.from)) || (a.index - b.index));
            let cursor = 0;
            canvas.connections = canvas.connections.map((conn, index) => relevantSlots.has(index) ? relevant[cursor++].conn : conn);
        }
    }
    return true;
}
function reorderInputThumb(currentNode, items, from, to, placement='before', {root=inputThumbsRow,onRefresh=null}={}){
    if(!currentNode || from < 0 || to < 0 || from >= items.length || to >= items.length) return false;
    const visibleKeys = items.map(inputRefKey).filter(Boolean);
    const fromKey = inputRefKey(items[from]);
    const targetKey = inputRefKey(items[to]);
    if(!fromKey || !targetKey || fromKey === targetKey) return false;
    const nextVisible = movedBeforeAfterIds(visibleKeys, fromKey, targetKey, placement);
    if(sameOrderedIds(visibleKeys, nextVisible)) return false;
    const previous = Array.isArray(currentNode.inputRefOrder) ? currentNode.inputRefOrder.filter(Boolean) : [];
    const visibleSet = new Set(visibleKeys);
    canvasMutation.history({action:'push'});
    currentNode.inputRefOrder = [...nextVisible, ...previous.filter(key => !visibleSet.has(key))];
    if(root === inputThumbsRow && inputThumbsRow) delete inputThumbsRow.dataset.thumbsSig;
    if(typeof onRefresh === 'function') onRefresh();
    else renderInputThumbsRow(currentNode);
    canvasPersistence.schedule();
    return true;
}
function isSupportedUploadFile(file){
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    return type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')
        || /\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v|mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(name);
}
function dataTransferItemEntry(item){
    try { return item?.webkitGetAsEntry?.() || null; } catch { return null; }
}
async function filesFromEntry(entry){
    if(!entry) return [];
    if(entry.isFile){
        return new Promise(resolve => entry.file(file => resolve(file ? [file] : []), () => resolve([])));
    }
    if(!entry.isDirectory) return [];
    const reader = entry.createReader();
    const children = [];
    while(true){
        const batch = await new Promise(resolve => reader.readEntries(resolve, () => resolve([])));
        if(!batch.length) break;
        children.push(...batch);
    }
    const nested = await Promise.all(children.map(filesFromEntry));
    return nested.flat();
}
async function uploadFilesFromDataTransfer(dataTransfer){
    const items = [...(dataTransfer?.items || [])];
    const entries = items.map(dataTransferItemEntry).filter(Boolean);
    const raw = entries.length
        ? (await Promise.all(entries.map(filesFromEntry))).flat()
        : [...(dataTransfer?.files || [])];
    return raw.filter(isSupportedUploadFile);
}
function uploadTitleForItems(items, fallback='Upload'){
    const list = [...(items || [])];
    if(!list.length) return fallback;
    const kinds = new Set(list.map(item => item instanceof File ? mediaKindForFile(item) : mediaKindForItem(item)));
    if(kinds.size > 1) return list.length > 1 ? 'Media' : fallback;
    if(kinds.has('video')) return list.length > 1 ? 'Videos' : 'Video';
    if(kinds.has('audio')) return 'Audio';
    return list.length > 1 ? 'Group' : 'Image';
}
const SMART_IMAGE_DROP_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;
const SMART_IMAGE_DROP_TEXT_TYPES = [
    'text/uri-list',
    'text/plain',
    'text/html',
    'DownloadURL',
    'text/x-moz-url',
    'text/x-file-url',
    'public.file-url',
    'public.url',
    'UniformResourceLocator',
    'FileName',
    'FileNameW'
];
const SMART_IMAGE_DROP_TYPE_HINT_RE = /^(?:files?|image\/.+|text\/(?:uri-list|html|plain|x-moz-url|x-file-url)|downloadurl|public\.(?:file-url|url)|uniformresourcelocator|filenamew?)$|application\/x-qt-(?:windows-mime|image)|application\/x-moz-file|com\.eagle/i;
function smartImageFilesFromDataTransfer(dataTransfer){
    return [...(dataTransfer?.files || [])].filter(isSupportedUploadFile);
}
function unsupportedSmartUploadFiles(dataTransfer){
    return [...(dataTransfer?.files || [])].filter(file => !isSupportedUploadFile(file));
}
function notifyUnsupportedSmartUploadDrop(dataTransfer){
    if(!unsupportedSmartUploadFiles(dataTransfer).length) return false;
    toast(tr('smart.unsupportedMediaFormat'), {tone:'warning'});
    return true;
}
async function smartResponseErrorMessage(response, fallback=tr('canvas.requestFailed')){
    try {
        const data = await response.clone().json();
        const detail = data.detail ?? data.error ?? data.message;
        if(typeof detail === 'string') return detail || fallback;
        if(Array.isArray(detail)) return detail.map(item => item?.msg || item?.message || String(item)).join('\n') || fallback;
    } catch(_) {}
    try {
        const text = await response.text();
        if(text) return text;
    } catch(_) {}
    return fallback;
}
function smartDropDataTypes(dataTransfer){
    return [...(dataTransfer?.types || [])].map(type => String(type || ''));
}
function readSmartDropData(dataTransfer, type){
    try { return dataTransfer?.getData?.(type) || ''; } catch(_) { return ''; }
}
function decodeSmartDropText(value){
    const text = String(value || '').trim();
    if(!text) return '';
    try { return decodeURIComponent(text); } catch(_) { return text; }
}
function smartDropTextFragments(value){
    const text = String(value || '').trim();
    if(!text) return [];
    const fragments = [];
    if(/<img|<a\s/i.test(text)){
        const doc = new DOMParser().parseFromString(text, 'text/html');
        doc.querySelectorAll('img[src],a[href]').forEach(el => fragments.push(el.getAttribute('src') || el.getAttribute('href') || ''));
    }
    text.split(/\r?\n/).forEach(line => {
        const item = line.trim();
        if(item) fragments.push(item);
    });
    const downloadUrl = text.match(/^image\/[^\s:]+:(.+)$/i);
    if(downloadUrl) fragments.push(downloadUrl[1]);
    return fragments;
}
function uniqueSmartDropValues(values){
    const seen = new Set();
    return values.filter(value => {
        const key = String(value || '').trim();
        if(!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
function smartDropTextCandidates(dataTransfer){
    if(!dataTransfer) return [];
    const types = uniqueSmartDropValues([...SMART_IMAGE_DROP_TEXT_TYPES, ...smartDropDataTypes(dataTransfer)]);
    const values = types.map(type => readSmartDropData(dataTransfer, type)).filter(Boolean);
    return uniqueSmartDropValues(values.flatMap(smartDropTextFragments).map(decodeSmartDropText))
        .filter(s => s && !s.startsWith('#'));
}
function isRemoteSmartImageDropValue(value){
    const text = String(value || '').trim();
    return /^https?:\/\/.+/i.test(text) || /^data:image\//i.test(text) || /^blob:/i.test(text);
}
function isLocalSmartImageDropValue(value){
    const text = String(value || '').trim();
    if(!text) return false;
    let path = text;
    if(/^file:/i.test(path)){
        try {
            const url = new URL(path);
            if(url.protocol !== 'file:') return false;
            path = decodeURIComponent(url.pathname || path);
        } catch(_) {
            return false;
        }
    }
    if(/^\/[a-zA-Z]:[\\/]/.test(path)) path = path.slice(1);
    const clean = path.split(/[?#]/, 1)[0];
    const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(clean);
    const isPosixPath = clean.startsWith('/');
    return (isWindowsPath || isPosixPath) && SMART_IMAGE_DROP_EXT_RE.test(clean);
}
function smartLocalImagePathsFromDataTransfer(dataTransfer){
    return uniqueSmartDropValues(smartDropTextCandidates(dataTransfer).filter(isLocalSmartImageDropValue));
}
function smartImageNameFromUrl(url){
    try {
        const clean = String(url || '').split('?', 1)[0].split('#', 1)[0];
        return decodeURIComponent(clean.split('/').pop() || 'image');
    } catch(_) {
        return 'image';
    }
}
function smartImageDropPayload(dataTransfer){
    const files = smartImageFilesFromDataTransfer(dataTransfer);
    if(files.length) return {type:'files', files};
    const localPaths = smartLocalImagePathsFromDataTransfer(dataTransfer);
    if(localPaths.length) return {type:'localPaths', localPaths};
    const url = smartDropTextCandidates(dataTransfer).find(isRemoteSmartImageDropValue) || '';
    if(url) return {type:'url', url};
    return {type:'none'};
}
async function resolveSmartImageDropPayload(dataTransfer){
    const payload = smartImageDropPayload(dataTransfer);
    if(payload.type !== 'none') return payload;
    const files = await uploadFilesFromDataTransfer(dataTransfer);
    return files.length ? {type:'files', files} : payload;
}
function hasSmartImageDropData(dataTransfer){
    if(!dataTransfer) return false;
    if(smartImageFilesFromDataTransfer(dataTransfer).length) return true;
    const types = smartDropDataTypes(dataTransfer);
    if(types.some(type => SMART_IMAGE_DROP_TYPE_HINT_RE.test(type.toLowerCase()))) return true;
    return smartImageDropPayload(dataTransfer).type !== 'none';
}
function hasSmartAssetDrag(dataTransfer){
    return smartDropDataTypes(dataTransfer).includes('application/x-smart-asset');
}
function hasMediaDrawerDrag(dataTransfer){
    return smartDropDataTypes(dataTransfer).includes('application/x-smart-asset');
}
function hasSmartInputThumbDrag(dataTransfer){
    return smartDropDataTypes(dataTransfer).includes('application/x-smart-input-thumb');
}
function setSmartDropCopyEffect(e, includeAsset=false){
    e.preventDefault();
    if(hasSmartInputThumbDrag(e.dataTransfer)) return;
    if(hasSmartImageDropData(e.dataTransfer) || (includeAsset && hasSmartAssetDrag(e.dataTransfer))){
        e.dataTransfer.dropEffect = 'copy';
    }
}
async function uploadFiles(files){
    const supported = [...(files || [])].filter(isSupportedUploadFile).slice(0, SMART_UPLOAD_MAX);
    if(!supported.length) return [];
    const form = new FormData();
    supported.forEach(file => form.append('files', file, file.name || 'media'));
    const response = await fetch('/api/ai/upload', {method:'POST', body:form});
    if(!response.ok) throw new Error(await smartResponseErrorMessage(response, tr('smart.toastUploadFail')));
    const data = await response.json().catch(() => ({}));
    const uploaded = Array.isArray(data.files) ? data.files : [];
    if(uploaded.length !== supported.length || uploaded.some(file => !file?.url)){
        throw new Error(tr('smart.toastUploadFail'));
    }
    return uploaded.map((file, index) => ({
        ...file,
        kind:file.kind || mediaKindForFile(supported[index])
    }));
}
function setSmartUploadControlBusy(control, busy){
    if(!control) return;
    control.toggleAttribute('disabled', Boolean(busy));
    control.toggleAttribute('busy', Boolean(busy));
    control.setAttribute('busy-label', tr('smart.uploadingMedia'));
    control.setAttribute('aria-busy', busy ? 'true' : 'false');
}
function appendImagesToSmartNode(uploaded, targetId='', opts={}){
    const images = [...(uploaded || [])]
        .filter(file => file?.url)
        .map(file => ({...file, kind:file.kind || mediaKindForItem(file)}));
    if(!images.length) return null;
    const targetGroup = nodes.find(n => n.id === targetId && smartContainer.isGroup(n));
    let node = targetGroup ? null : (nodes.find(n => n.id === targetId) || window.SmartCanvasModules.viewportSelection.selection.node());
    if(node && !isSmartImageNode(node)) node = null;
    if(opts.forceNew) node = null;
    const applyUpload = (target, append=true) => {
        const previousCount = append ? (target.images || []).length : 0;
        const mediaDisplaySize = generationOutputMediaDisplaySize(target);
        target.images = append ? [...(target.images || []), ...images] : images.map(image => ({...image}));
        target.uploadedAttachment = true;
        if(target.images.length > 1){
            target.title = uploadTitleForItems(target.images, 'Group');
            if(previousCount <= 1 && (!Number.isFinite(Number(target.scale)) || Number(target.scale) === MEDIA_NODE_DEFAULT_SCALE || Number(target.scale) === MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE)){
                target.scale = MEDIA_GROUP_DEFAULT_SCALE;
            }
            delete target.w;
            delete target.h;
        }
        if(target.images.length === 1){
            target.title = uploadTitleForItems(target.images, target.title || 'Image');
            delete target.w;
            delete target.h;
        }
        preserveGenerationOutputMediaDisplaySize(target,mediaDisplaySize);
    };
    if(node){
        return canvasMutation.update({
            nodeId:node.id,
            mutate:target => applyUpload(target),
            options:{skipUndo:true,select:true,reveal:true}
        });
    }
    if(!node){
        const groupRect = targetGroup ? nodeRect(targetGroup) : null;
        const center = opts.point || (groupRect ? {x:groupRect.x + groupRect.width / 2, y:groupRect.y + groupRect.height / 2} : window.SmartCanvasModules.viewportSelection.viewport.center());
        node = createImageNodeAt(center, images, {skipUndo:true});
    }
    applyUpload(node, false);
    if(targetGroup){
        smartContainer.add(targetGroup.id,[node.id],{
            skipUndo:true
        });
    }
    selectedId = node.id;
    selectedIds = [];
    selectedImage = {nodeId:'',index:-1};
    render(targetGroup ? {} : {syncVirtualization:false,nodeIds:[node.id]});
    canvasPersistence.schedule();
    return node;
}
async function handleFiles(files, targetId='', opts={}){
    try {
        const fileList = [...(files || [])].filter(isSupportedUploadFile).slice(0, SMART_UPLOAD_MAX);
        if(!fileList.length) return null;
        const uploaded = await uploadFiles(fileList);
        if(!uploaded.length) return null;
        if(!opts.skipUndo) canvasMutation.history({action:'push'});
        return appendImagesToSmartNode(uploaded.map((file, index) => ({...file, kind:file.kind || mediaKindForFile(fileList[index])})), targetId, opts);
    } catch(e) {
        toast(e.message || tr('smart.toastUploadFail'), {tone:'danger'});
        return null;
    }
}
async function importSmartLocalImages(paths){
    if(!paths?.length) return [];
    const response = await fetch('/api/ai/import-local-image', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({paths:(paths || []).slice(0, SMART_UPLOAD_MAX)})
    });
    if(!response.ok) throw new Error(await smartResponseErrorMessage(response, tr('smart.toastUploadFail')));
    const data = await response.json();
    const files = Array.isArray(data.files) ? data.files : [];
    if(files.length !== paths.slice(0, SMART_UPLOAD_MAX).length || files.some(file => !file?.url)){
        throw new Error(tr('smart.toastUploadFail'));
    }
    return files;
}
async function handleSmartImageDropPayload(payload, targetId='', opts={}){
    try {
        if(payload.type === 'files') await handleFiles(payload.files, targetId, opts);
        else if(payload.type === 'localPaths') {
            if(!opts.skipUndo) canvasMutation.history({action:'push'});
            appendImagesToSmartNode(await importSmartLocalImages(payload.localPaths), targetId, opts);
        } else if(payload.type === 'url') {
            if(!opts.skipUndo) canvasMutation.history({action:'push'});
            appendImagesToSmartNode([{url:payload.url, name:smartImageNameFromUrl(payload.url), kind:'image'}], targetId, opts);
        }
    } catch(e) {
        toast(e.message || tr('smart.toastUploadFail'), {tone:'danger'});
    }
}
function sizeForRun(sourceSettings=settings, targetAspectRatio=''){
    const capabilityModule = window.SmartCanvasModules?.imageCapabilities;
    const selection = smartImageCapabilitySelection('');
    const capability = capabilityModule?.current?.(selection.providerId, selection.modelId);
    if(!sourceSettings.resolution && !capability?.default_resolution_tier) return 'auto';
    const fallbackResolution = sourceSettings.engine === 'api' && isGptImageAutoSizeModel(sourceSettings.model)
        ? defaultSmartApiResolution(sourceSettings.model)
        : '1k';
    const resolvedRatio = capabilityModule?.standardToRatioKey?.(targetAspectRatio) || sourceSettings.ratio || 'square';
    return apiImageSize(resolvedRatio, sourceSettings.resolution || fallbackResolution, sourceSettings.customRatio || '', sourceSettings.customSize || '') || '1024x1024';
}
function expectedOutputSize(sourceSettings=settings){
    sourceSettings = sourceSettings || settings;
    if(sourceSettings.engine === 'comfy'){
        if(sourceSettings.comfyMode === 'text'){
            const w = Number(sourceSettings.width) || 1024;
            const h = Number(sourceSettings.height) || 1024;
            return {w, h};
        }
        return {w:1024, h:1024};
    }
    if(sourceSettings.engine === 'runninghub') return {w:1024, h:1024};
    const sizeStr = sourceSettings.engine === 'modelscope'
        ? apiImageSize(sourceSettings.msRatio || 'square', sourceSettings.msResolution || '1k', sourceSettings.msCustomRatio || '', sourceSettings.msCustomSize || '')
        : sizeForRun(sourceSettings);
    const parsed = parseSizeValue(sizeStr);
    if(parsed){
        return {w: Number(parsed.width) || 1024, h: Number(parsed.height) || 1024};
    }
    return {w:1024, h:1024};
}
function explicitRequestOutputSizeForPending(sourceSettings=settings){
    sourceSettings = sourceSettings || settings;
    if(isApiLikeEngine(sourceSettings.engine) && sourceSettings.apiKind !== 'video'){
        const parsed = parseSizeValue(sizeForRun(sourceSettings));
        if(parsed) return {w:Number(parsed.width) || 1024, h:Number(parsed.height) || 1024};
    }
    if(sourceSettings.engine === 'modelscope'){
        const sizeStr = apiImageSize(sourceSettings.msRatio || 'square', sourceSettings.msResolution || '1k', sourceSettings.msCustomRatio || '', sourceSettings.msCustomSize || '');
        const parsed = parseSizeValue(sizeStr);
        if(parsed) return {w:Number(parsed.width) || 1024, h:Number(parsed.height) || 1024};
    }
    if(sourceSettings.engine === 'comfy' && sourceSettings.comfyMode === 'text'){
        const w = Number(sourceSettings.width) || 1024;
        const h = Number(sourceSettings.height) || 1024;
        return {w, h};
    }
    return null;
}
function pendingSizeFromImageRef(img){
    const w = Number(img?.natural_w || img?.width || 0);
    const h = Number(img?.natural_h || img?.height || 0);
    return w > 0 && h > 0 ? {w, h} : null;
}
function pendingSourceBoxSize(options={}){
    const sourceNode = options.sourceNode || null;
    if(sourceNode && (sourceNode.images || []).length){
        const rect = nodeRect(sourceNode);
        if(rect.width > 24 && rect.height > 24) return {w:Math.round(rect.width), h:Math.round(rect.height), display:true};
    }
    const ref = (options.refs || []).find(img => img?.url);
    const refSize = pendingSizeFromImageRef(ref);
    if(refSize) return refSize;
    const refNode = ref?.nodeId ? nodes.find(n => n.id === ref.nodeId) : null;
    if(refNode){
        const rect = nodeRect(refNode);
        if(rect.width > 24 && rect.height > 24) return {w:Math.round(rect.width), h:Math.round(rect.height), display:true};
    }
    return null;
}
function displayBoxFromNaturalSize(size){
    const layout = singleImageLayout(
        {natural_w:size?.w || size?.width || 1024, natural_h:size?.h || size?.height || 1024},
        {type:'smart-image', images:[{}]},
        MEDIA_NODE_DEFAULT_SCALE
    );
    return {w:layout.width, h:layout.height};
}
function pendingBaseBoxSize(options={}){
    const sourceSettings = options.settings || settings;
    const requestSize = explicitRequestOutputSizeForPending(sourceSettings);
    if(requestSize) return displayBoxFromNaturalSize(requestSize);
    const sourceSize = pendingSourceBoxSize(options);
    if(sourceSize?.display) return {w:sourceSize.w, h:sourceSize.h};
    if(sourceSize) return displayBoxFromNaturalSize(sourceSize);
    return displayBoxFromNaturalSize(expectedOutputSize(sourceSettings));
}
function pendingBoxSize(count, options={}){
    const base = pendingBaseBoxSize(options);
    const aspect = base.w / Math.max(1, base.h);
    const c = Math.max(1, Number(count) || 1);
    if(c <= 1){
        return {w:Math.round(base.w), h:Math.round(base.h)};
    }
    const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(c))));
    const rows = Math.ceil(c / cols);
    const cellMax = Math.max(96, Math.min(220, Math.max(base.w, base.h) * 0.42));
    let cellW, cellH;
    if(base.w >= base.h){
        cellW = cellMax;
        cellH = Math.max(40 * MEDIA_NODE_DEFAULT_SCALE, Math.round(cellMax / aspect));
    } else {
        cellH = cellMax;
        cellW = Math.max(40 * MEDIA_NODE_DEFAULT_SCALE, Math.round(cellMax * aspect));
    }
    const w = cols * (cellW + 8) + 16;
    const h = rows * (cellH + 8) + 16;
    return {w, h};
}
function mentionTokenHtml(img){
    if(!img?.url) return '';
    const kind = mediaKindForItem(img);
    const name = img.alias || img.name || (kind === 'audio' ? tr('smart.kindAudio') : kind === 'video' ? tr('smart.kindVideo') : tr('smart.kindImage'));
    const media = mentionTokenMediaHtml(img, kind);
    return `<span class="mention-image-token" contenteditable="false" data-url="${escapeHtml(img.url)}" data-kind="${escapeHtml(kind)}" data-name="${escapeHtml(name)}" data-node-id="${escapeHtml(img.nodeId || '')}" data-image-index="${escapeHtml(img.imageIndex ?? '')}" data-output-id="${escapeHtml(img.outputId || '')}" data-input-instance-id="${escapeHtml(img.inputInstanceId || '')}">${media}<span class="mention-token-label">${escapeHtml(name)}</span></span>`;
}
function mentionTokenMediaHtml(img, kind=mediaKindForItem(img)){
    if(kind === 'audio'){
        return `<div class="mention-audio-thumb"><i data-lucide="file-audio"></i></div>`;
    }
    if(kind === 'video'){
        return smartVideoPreviewHtml(img, 512, 'alt=""');
    }
    return smartPreviewImgHtml(img, 512, 'alt=""');
}
function promptHtmlWithMentionTokens(text, refs=[]){
    const value = String(text || '');
    const items = (refs || []).filter(ref => ref?.url && ref?.name).sort((a, b) => String(b.name || '').length - String(a.name || '').length);
    if(!value || !items.length || !value.includes('@')) return '';
    let html = '';
    let index = 0;
    while(index < value.length){
        if(value[index] === '@'){
            const hit = items.find(ref => value.slice(index + 1, index + 1 + String(ref.name || '').length) === String(ref.name || ''));
            if(hit){
                html += mentionTokenHtml(hit);
                index += 1 + String(hit.name || '').length;
                continue;
            }
        }
        html += escapeHtml(value[index]);
        index += 1;
    }
    return html;
}
function inputReferenceSnapshot(ref={}){
    return {
        url:ref.url || '',
        name:ref.name || '',
        media_id:ref.media_id || ref.mediaId || '',
        assetLibraryEntryId:ref.assetLibraryEntryId || ref.assetEntryId || '',
        sourceNodeTitle:ref.sourceNodeTitle || '',
        nodeId:ref.nodeId || '',
        imageIndex:ref.imageIndex ?? '',
        outputId:ref.outputId || '',
        inputInstanceId:ref.inputInstanceId || '',
        kind:ref.kind || '',
        role:ref.role || ''
    };
}
function snapshotRunMeta(prompt, sourceId, displayPrompt='', refs=[], sourceSettings=settings){
    return {
        prompt,
        displayPrompt:displayPrompt || promptPlainText() || prompt,
        promptHtml: promptInput ? promptInput.innerHTML : '',
        promptText: promptPlainText(),
        promptRefs:(refs || []).map(inputReferenceSnapshot).filter(ref => ref.url),
        inputRefs:(refs || []).map(inputReferenceSnapshot).filter(ref => ref.url),
        sourceNodeId:sourceId,
        settings:JSON.parse(JSON.stringify(sourceSettings || settings)),
        createdAt:Date.now()
    };
}
function attachRunMeta(targetNode, meta){
    if(!targetNode || !meta) return;
    delete targetNode.uploadedAttachment;
    targetNode.runPrompt = meta.displayPrompt || meta.promptText || meta.prompt;
    targetNode.runModelPrompt = meta.prompt;
    targetNode.runPromptRefs = meta.promptRefs || [];
    targetNode.runInputRefs = (meta.inputRefs || meta.promptRefs || []).map(ref => ({
        url:ref.url || '',
        name:ref.name || '',
        media_id:ref.media_id || ref.mediaId || '',
        assetLibraryEntryId:ref.assetLibraryEntryId || ref.assetEntryId || '',
        sourceNodeTitle:ref.sourceNodeTitle || '',
        nodeId:ref.nodeId || '',
        imageIndex:ref.imageIndex ?? '',
        outputId:ref.outputId || '',
        inputInstanceId:ref.inputInstanceId || '',
        kind:ref.kind || '',
        role:ref.role || ''
    })).filter(ref => ref.url);
    targetNode.runSettings = meta.settings;
    if(meta.sourceNodeId) targetNode.sourceNodeId = meta.sourceNodeId;
    else delete targetNode.sourceNodeId;
    targetNode.runAt = meta.createdAt;
    // 保存可编辑的引用 / 模板 tag 到草稿字段，方便点输出节点时还原原始可编辑形式。
    if(meta.promptHtml != null){
        targetNode.promptDraftHtml = meta.promptHtml;
        targetNode.promptDraftText = meta.promptText || '';
    }
    targetNode.images = (targetNode.images || []).map(img => stripImageGenerationMeta(img));
}
function stripRunInputMeta(meta){
    if(!meta) return meta;
    const cleanPrompt = meta.promptText || meta.displayPrompt || meta.prompt || '';
    return {
        ...meta,
        promptHtml:escapeHtml(cleanPrompt),
        promptText:cleanPrompt,
        promptRefs:[],
        inputRefs:meta.inputRefs || meta.promptRefs || [],
        sourceNodeId:''
    };
}
function stripImageGenerationMeta(img){
    if(!img) return img;
    delete img.runPrompt;
    delete img.runModelPrompt;
    delete img.runSettings;
    delete img.sourceNodeId;
    delete img.runAt;
    delete img.promptDraftHtml;
    delete img.promptDraftText;
    return img;
}
function upstreamConnectionsForKinds(node, kinds=['input']){
    if(!node) return [];
    const allowed = new Set(kinds);
    const connections = [];
    const ids = new Set();
    (canvas?.connections || []).forEach(conn => {
        if(conn.to !== node.id || !allowed.has(conn.kind || 'flow') || ids.has(conn.from)) return;
        ids.add(conn.from);
        connections.push(conn);
    });
    if(allowed.has('input')){
        (node.inputNodeIds || []).forEach(id => {
            if(ids.has(id)) return;
            ids.add(id);
            connections.push({from:id,to:node.id,kind:'input'});
        });
    }
    return connections;
}
function upstreamNodesForKinds(node, kinds=['input']){
    return upstreamConnectionsForKinds(node, kinds)
        .map(connection => nodes.find(candidate => candidate.id === connection.from))
        .filter(Boolean);
}
function inputNodesFor(node){
    return upstreamNodesForKinds(node, ['input']);
}
function workflowInputNodesFor(node){
    return upstreamNodesForKinds(node, ['input', 'flow']);
}
function clearDetachedRunInputRefs(node){
    if(!node) return;
    const hasUpstream = Boolean((canvas?.connections || []).some(conn => conn.to === node.id && ['input','flow'].includes(conn.kind || 'flow')));
    if(hasUpstream || (!canvasUsesConnections && Array.isArray(node.inputNodeIds) && node.inputNodeIds.some(id => nodes.some(n => n.id === id)))) return;
    delete node.runInputRefs;
    delete node.runPromptRefs;
    delete node.sourceNodeId;
}
function cleanupDetachedRunInputRefs(){
    if(!canvasUsesConnections) return false;
    let changed = false;
    nodes.forEach(node => {
        const hadRefs = Array.isArray(node?.runInputRefs) && node.runInputRefs.length;
        const hadPromptRefs = Array.isArray(node?.runPromptRefs) && node.runPromptRefs.length;
        const hadSource = Boolean(node?.sourceNodeId);
        clearDetachedRunInputRefs(node);
        if(hadRefs !== (Array.isArray(node?.runInputRefs) && node.runInputRefs.length)
            || hadPromptRefs !== (Array.isArray(node?.runPromptRefs) && node.runPromptRefs.length)
            || hadSource !== Boolean(node?.sourceNodeId)){
            changed = true;
        }
    });
    return changed;
}
function imagesForNode(node){
    if(smartContainer.isGroup(node)){
        return smartContainer.imageRefs(node).map((ref, index) => ({
            ...ref.item,
            nodeId:ref.nodeId,
            imageIndex:ref.index,
            groupNodeId:node.id,
            groupImageIndex:index
        }));
    }
    return (node?.images || []).map((img, index) => ({...imageForDisplay(img), nodeId:node.id, imageIndex:index}));
}
function nodeHasReferenceContent(node){
    return imagesForNode(node).some(img => img?.url);
}
function isSelfReferenceForNode(node, img){
    return Boolean(node?.id && img?.nodeId === node.id);
}
function candidateInputImagesFor(node, consume=false, ctx=smartLoopContext){
    const inputs = (smartImageUsesWorkflowInput(node, ctx) ? workflowInputImagesFor(node, consume, ctx) : inputImagesFor(node, consume, ctx))
        .filter(img => img?.url);
    if(!inputs.length) return [];
    if(smartImageUsesWorkflowInput(node, ctx)) return inputs;
    if(nodeHasReferenceContent(node)) return [];
    return inputs;
}
function defaultInputImagesFor(node, consume=false, ctx=smartLoopContext){
    return candidateInputImagesFor(node, consume, ctx);
}
function splitSmartPromptItems(text){
    const trimmed = String(text || '').trim();
    if(!trimmed) return [];
    const numbered = trimmed.split(/\s*(?:^|\s)\d+\s*[.、)）．]\s+/).map(s => s.trim()).filter(Boolean);
    if(numbered.length >= 2) return numbered;
    const lines = trimmed.split(/\r?\n+/).map(s => s.trim()).filter(Boolean);
    return lines.length >= 2 ? lines : [trimmed];
}
function smartLoopPromptFieldValues(node){
    const fields = Array.isArray(node?.variablePrompts)
        ? node.variablePrompts.map(text => String(text || '').trim())
        : [];
    if(fields.length) return fields;
    return splitSmartPromptItems(node?.variablePrompt || '');
}
function smartLoopActivePromptFieldValues(node){
    return smartLoopPromptFieldValues(node).filter(Boolean);
}
function smartLoopDefaultPromptText(){
    return tr('smart.loopDefaultPrompt');
}
function isSmartLoopDefaultPrompt(text){
    const value = String(text || '').trim();
    if(!value) return false;
    return value === smartLoopDefaultPromptText()
        || value === '现在生成第《计数》张卖点图片'
        || value === 'Generate selling-point image 《计数》';
}
function setSmartLoopPromptFieldValues(node, values){
    if(!node || node.type !== 'smart-loop') return;
    const fields = (values || []).map(text => String(text || '').trim());
    node.variablePrompts = fields.length ? fields : [''];
    node.variablePrompt = fields.filter(Boolean).join('\n');
}
function smartLoopPromptFieldText(node, fieldIndex){
    const values = smartLoopPromptFieldValues(node);
    return values[fieldIndex] || '';
}
function smartLoopSelectedLocalPrompt(node, ctx=smartLoopContext){
    const values = smartLoopActivePromptFieldValues(node);
    if(!values.length) return '';
    const startBase = Math.max(1, Number(node?.loopStart) || 1);
    const index = Math.max(1, Number(ctx?.index || startBase) || startBase);
    return values[(index - 1) % values.length] || '';
}
function smartLoopUpstreamPromptPreviewHeight(node){
    return smartLoopInputPromptItems(node).length ? 78 : 0;
}
const smartLoopPromptVisiting = new Set();
function smartLoopInputPromptItems(node){
    if(!node?.showPrompt || smartLoopPromptVisiting.has(node.id)) return [];
    smartLoopPromptVisiting.add(node.id);
    try {
        return inputNodesFor(node)
            .flatMap(input => promptTextItemsForNode(input))
            .map(text => String(text || '').trim())
            .filter(Boolean);
    } finally {
        smartLoopPromptVisiting.delete(node.id);
    }
}
function smartLoopSelectedInputPrompt(node, ctx=smartLoopContext){
    const items = smartLoopInputPromptItems(node);
    if(!items.length) return '';
    const startBase = Math.max(1, Number(node?.loopStart) || 1);
    const index = Math.max(1, Number(ctx?.index || startBase) || startBase);
    return items[(index - 1) % items.length] || '';
}
function smartLoopPrompt(node, ctx=smartLoopContext){
    if(!node?.showPrompt) return '';
    const count = smartLoopCount(node);
    const startBase = Math.max(1, Number(node.loopStart) || 1);
    const index = Math.max(1, Number(ctx?.index || startBase) || startBase);
    const total = Math.max(1, Number(ctx?.total || count) || count);
    const selected = smartLoopSelectedInputPrompt(node, ctx);
    const localPrompt = smartLoopSelectedLocalPrompt(node, ctx);
    const effectiveLocalPrompt = selected && isSmartLoopDefaultPrompt(localPrompt) ? '' : localPrompt;
    const combined = [selected, effectiveLocalPrompt].map(text => String(text || '').trim()).filter(Boolean).join('\n\n');
    return String(combined || '')
        .replaceAll('《计数》', String(index))
        .replaceAll('[计数]', String(index))
        .replaceAll(`[${tr('canvas.counterToken')}]`, String(index))
        .replaceAll('《总数》', String(total))
        .replaceAll('[总数]', String(total))
        .replaceAll('《进度》', `${index}/${total}`)
        .replaceAll('[进度]', `${index}/${total}`)
        .trim();
}
function smartLoopInputImages(node, ctx=smartLoopContext){
    if(!node?.imageInput) return [];
    const refs = upstreamConnectionsForKinds(node, ['input']).flatMap(connection => {
        const input = nodes.find(candidate => candidate.id === connection.from);
        if(input?.type === 'smart-loop') return smartLoopInputImages(input, ctx);
        return outputImagesForConnection(connection, false, ctx);
    }).filter(img => img?.url);
    if(!refs.length) return [];
    const startBase = Math.max(1, Number(node.loopStart) || 1);
    const batchSize = Math.max(1, Math.min(100, Number(node.imageBatchSize) || 1));
    const currentIndex = Math.max(1, Number(ctx?.index || startBase) || startBase);
    const offset = Math.max(0, currentIndex - 1) % refs.length;
    return Array.from({length:batchSize}, (_, index) => refs[(offset + index) % refs.length])
        .map((img, i) => ({...img, name:img.name || trf('canvas.loopImageLabel', {n:currentIndex + i})}));
}
function smartLoopPreviewImages(node){
    if(!node?.imageInput) return [];
    return upstreamConnectionsForKinds(node, ['input']).flatMap(connection => {
        const input = nodes.find(candidate => candidate.id === connection.from);
        if(input?.type === 'smart-loop') return smartLoopInputImages(input, {index:Number(node.loopStart) || 1});
        return outputImagesForConnection(connection, false, {index:Number(node.loopStart) || 1});
    }).filter(img => img?.url);
}
function outputImagesForNode(node, consume=false, ctx=smartLoopContext){
    if(node?.type === 'smart-group') return imagesForNode(node).filter(img => img?.url);
    if(node?.type === 'smart-loop') return smartLoopInputImages(node, ctx);
    const roundOutputs = ctx?.roundOutputs;
    if(node?.id && roundOutputs && typeof roundOutputs.get === 'function' && roundOutputs.has(node.id)){
        return (roundOutputs.get(node.id) || []).filter(img => img?.url);
    }
    const images = imagesForNode(node).filter(img => img?.url);
    if(!isSmartImageNode(node) || !node.generationOutputNode || images.length <= 1) return images;
    window.SmartCanvasModules?.generationOutput?.ensureNodeState?.({node});
    const activeIndex = Math.max(0, (node.images || []).findIndex(
        item => item.outputId === node.activeOutputId
    ));
    return images.filter(image => Number(image.imageIndex) === activeIndex);
}
function outputImagesForConnection(connection, consume=false, ctx=smartLoopContext){
    const source = nodes.find(candidate => candidate.id === connection?.from);
    if(!source) return [];
    const pinnedOutputId = String(connection?.sourceOutputId || '');
    if(pinnedOutputId && isSmartImageNode(source) && source.generationOutputNode){
        window.SmartCanvasModules?.generationOutput?.ensureNodeState?.({node:source});
        return imagesForNode(source).filter(image => image.outputId === pinnedOutputId && image?.url);
    }
    return outputImagesForNode(source, consume, ctx);
}
function selfReferenceImagesForNode(node, consume=false, ctx=smartLoopContext){
    return outputImagesForNode(node, consume, ctx).filter(img => img?.url);
}
function textForNode(node, ctx=smartLoopContext){
    if(!node) return '';
    if(node.type === 'smart-prompt') return promptNodePromptItems(node).join('\n\n');
    if(node.type === 'smart-splitter') return splitterNodePromptItems(node, ctx).join('\n\n');
    if(node.type === 'smart-loop') return smartLoopPrompt(node, ctx);
    if(node.type === 'smart-group') return smartContainer.groupMembers(node).map(member => textForNode(member, ctx)).filter(Boolean).join('\n\n');
    return '';
}
function promptInputNodesFor(node){
    return inputNodesFor(node).filter(input => input?.type === 'smart-prompt' || input?.type === 'smart-splitter' || input?.type === 'smart-loop' || input?.type === 'smart-group');
}
function composerTextReferenceNodesFor(node, ctx=smartLoopContext){
    if(!node) return [];
    const relayNodes = Array.isArray(ctx?.relayPromptNodeIds)
        ? ctx.relayPromptNodeIds.map(id => nodes.find(candidate => candidate.id === id)).filter(Boolean)
        : [];
    const candidates = [
        ...(smartContainer.isGroup(node) ? [node] : []),
        ...promptInputNodesFor(node),
        ...relayNodes
    ];
    const seen = new Set();
    return candidates.filter(candidate => {
        if(!candidate?.id || seen.has(candidate.id) || !textForNode(candidate, ctx).trim()) return false;
        seen.add(candidate.id);
        return true;
    });
}
function upstreamLoopPromptNodesFor(node){
    return promptInputNodesFor(node).filter(input => input?.type === 'smart-loop' && input.showPrompt);
}
function inputImagesFor(node, consume=false, ctx=smartLoopContext){
    return upstreamConnectionsForKinds(node, ['input'])
        .flatMap(connection => outputImagesForConnection(connection, consume, ctx));
}
function workflowInputImagesFor(node, consume=false, ctx=smartLoopContext){
    return upstreamConnectionsForKinds(node, ['input', 'flow'])
        .flatMap(connection => outputImagesForConnection(connection, consume, ctx));
}
function rememberRoundOutputs(ctx, node, outputs){
    if(!ctx || !node?.id || !Array.isArray(outputs)) return outputs || [];
    if(!ctx.roundOutputs || typeof ctx.roundOutputs.set !== 'function') ctx.roundOutputs = new Map();
    ctx.roundOutputs.set(node.id, outputs.filter(img => img?.url).map(img => ({...img})));
    return outputs;
}
function inputRefKey(img){
    return window.SmartCanvasModules.referenceInstances.key(img);
}
function blockedInputRefKeys(node){
    return new Set(Array.isArray(node?.blockedInputRefs) ? node.blockedInputRefs.filter(Boolean) : []);
}
function orderReferenceImagesForNode(node, images){
    const refs = [...(images || [])];
    const order = Array.isArray(node?.inputRefOrder) ? node.inputRefOrder.filter(Boolean) : [];
    if(!order.length || refs.length < 2) return refs;
    const ranks = new Map(order.map((key, index) => [key, index]));
    return refs
        .map((item, index) => ({item, index, rank:ranks.has(inputRefKey(item)) ? ranks.get(inputRefKey(item)) : Number.MAX_SAFE_INTEGER}))
        .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
        .map(entry => entry.item);
}
function manualReferenceImagesFor(node){
    if(!node || !Array.isArray(node.manualInputRefs)) return [];
    let assignedInstanceId = false;
    node.manualInputRefs.forEach(ref => {
        if(ref?.url && !ref.inputInstanceId){
            ref.inputInstanceId = window.SmartCanvasModules.referenceInstances.newId('manual');
            assignedInstanceId = true;
        }
    });
    if(assignedInstanceId) canvasPersistence.schedule();
    return node.manualInputRefs.filter(img => img?.url).map((img, index) => ({
        ...img,
        kind:img.kind || mediaKindForItem(img),
        name:img.name || trf('canvas.imageNumber', {number: index + 1}),
        imageIndex:Number.isFinite(Number(img.imageIndex)) ? Number(img.imageIndex) : index,
        manualAdded:true
    }));
}
function isInputRefBlocked(node, img){
    if(!node || !img?.url) return false;
    return blockedInputRefKeys(node).has(inputRefKey(img));
}
function activeInputImagesFor(node, consume=false, ctx=smartLoopContext){
    return inputImagesFor(node, consume, ctx).filter(img => img?.url && !isInputRefBlocked(node, img));
}
function toggleInputRefBlocked(node, img){
    if(!node || !img?.url) return;
    const key = inputRefKey(img);
    if(!key) return;
    canvasMutation.history({action:'push'});
    const blocked = blockedInputRefKeys(node);
    if(blocked.has(key)) blocked.delete(key);
    else blocked.add(key);
    node.blockedInputRefs = [...blocked];
    if(!node.blockedInputRefs.length) delete node.blockedInputRefs;
    renderInputThumbsRow(node);
    canvasPersistence.schedule();
}
function defaultReferenceImagesFor(node, consume=false, ctx=smartLoopContext){
    if(!node) return [];
    const recipe = Array.isArray(node.recipeSourceRefs)
        ? node.recipeSourceRefs.filter(ref => ref?.url).map(ref => ({...ref}))
        : [];
    const self = selfReferenceImagesForNode(node, consume, ctx).filter(img => img?.url);
    const upstream = (smartImageUsesWorkflowInput(node, ctx) ? workflowInputImagesFor(node, consume, ctx) : inputImagesFor(node, consume, ctx))
        .filter(img => img?.url);
    const manual = manualReferenceImagesFor(node);
    const refs = recipe.length
        ? uniqueReferenceImages([...recipe, ...manual])
        : smartImageUsesWorkflowInput(node, ctx)
        ? uniqueReferenceImages([...upstream, ...manual])
        : self.length
        ? uniqueReferenceImages([...self, ...manual])
        : uniqueReferenceImages([...upstream, ...manual]);
    const blocked = blockedInputRefKeys(node);
    return orderReferenceImagesForNode(node, refs).filter(img => !blocked.has(inputRefKey(img)));
}
function lineConnectionsFor(node){
    if(!node) return [];
    return (canvas?.connections || []).filter(conn => {
        if(!conn?.from || !conn?.to || conn.from === conn.to) return false;
        return ['input', 'flow'].includes(conn.kind || 'flow');
    });
}
function connectedLineNodeIds(node){
    if(!node) return [];
    const conns = lineConnectionsFor(node);
    const upstream = [];
    const downstream = [];
    const seenUp = new Set([node.id]);
    const seenDown = new Set([node.id]);
    const walkUp = id => {
        conns.filter(conn => conn.to === id).forEach(conn => {
            if(seenUp.has(conn.from)) return;
            seenUp.add(conn.from);
            walkUp(conn.from);
            upstream.push(conn.from);
        });
    };
    const walkDown = id => {
        conns.filter(conn => conn.from === id).forEach(conn => {
            if(seenDown.has(conn.to)) return;
            seenDown.add(conn.to);
            downstream.push(conn.to);
            walkDown(conn.to);
        });
    };
    walkUp(node.id);
    walkDown(node.id);
    return [...upstream, node.id, ...downstream];
}
function upstreamLineNodeIds(node){
    if(!node) return [];
    const conns = lineConnectionsFor(node);
    const upstream = [];
    const seen = new Set([node.id]);
    const walk = id => {
        conns.filter(conn => conn.to === id).forEach(conn => {
            if(seen.has(conn.from)) return;
            seen.add(conn.from);
            walk(conn.from);
            upstream.push(conn.from);
        });
    };
    walk(node.id);
    return [...upstream, node.id];
}
function lineImagesFor(node){
    const ids = upstreamLineNodeIds(node);
    return ids.flatMap(id => {
        const source = nodes.find(n => n.id === id);
        return imagesForNode(source);
    }).filter(img => img?.url);
}
function uniqueReferenceImages(images){
    return window.SmartCanvasModules.referenceInstances.unique(images).map((img, index) => ({
            ...img,
            name:img.name || trf('canvas.imageNumber', {number: index + 1}),
            role:img.role || `image_${index + 1}`,
            imageIndex:Number.isFinite(Number(img.imageIndex)) ? Number(img.imageIndex) : index
        }));
}
function visibleReferenceImagesFor(node){
    return promptAuthoring.resolve({node}).refs;
}
function inputMentionCandidateImages(node){
    const targetPoint = mentionFrozenTargetPoint || (node ? {
        x:Number(node.x || 0) + Number(node.width || 320) / 2,
        y:Number(node.y || 0) + Number(node.height || 240) / 2
    } : null);
    const representatives = new Map();
    let originalIndex = 0;
    nodes.forEach(source => {
        const sourceX = Number(source?.x || 0);
        const sourceY = Number(source?.y || 0);
        const centerX = sourceX + Number(source?.width || 320) / 2;
        const centerY = sourceY + Number(source?.height || 240) / 2;
        const distanceSquared = targetPoint
            ? (centerX - targetPoint.x) ** 2 + (centerY - targetPoint.y) ** 2
            : 0;
        const rawItems = Array.isArray(source?.images) ? source.images : [];
        rawItems.forEach((raw, imageIndex) => {
            const img = {...imageForDisplay(raw), nodeId:source.id, imageIndex};
            const url = String(img.url || '');
            const existsButInvalid = Boolean(img.error || img.failed || img.unavailable);
            if(!url && !existsButInvalid) return;
            const kind = mediaKindForItem(img);
            if(!['image','video','audio'].includes(kind)) return;
            const identity = String(img.media_id || img.mediaId || url || `${source.id}:${imageIndex}`);
            const candidate = {
                ...img,
                kind,
                mentionId:identity,
                alias:String(img.name || source.title || '').trim() || trf('smart.mediaNumber', {
                    kind:kind === 'video' ? tr('smart.kindVideo') : kind === 'audio' ? tr('smart.kindAudio') : tr('smart.kindImage'),
                    count:originalIndex + 1
                }),
                sourceNodeTitle:String(source.title || source.name || '').trim(),
                sourceX,
                sourceY,
                distanceSquared,
                sourceCreatedAt:Number(source.created_at ?? source.createdAt),
                sourceCreatedAtMissing:!Number.isFinite(Number(source.created_at ?? source.createdAt)),
                sourceIndex:originalIndex++,
                disabled:existsButInvalid || !url,
                error:existsButInvalid ? String(img.error || tr('smart.mediaUnavailable')) : ''
            };
            const previous = representatives.get(identity);
            if(!previous || candidate.distanceSquared < previous.distanceSquared) representatives.set(identity, candidate);
        });
    });
    return [...representatives.values()].sort((left, right) =>
        (left.distanceSquared - right.distanceSquared)
        || (left.sourceY - right.sourceY)
        || (left.sourceX - right.sourceX)
        || (Number(left.sourceCreatedAtMissing) - Number(right.sourceCreatedAtMissing))
        || ((left.sourceCreatedAt || 0) - (right.sourceCreatedAt || 0))
        || String(left.nodeId || '').localeCompare(String(right.nodeId || ''))
        || (left.sourceIndex - right.sourceIndex)
    );
}
function referenceImagesFor(node){
    return defaultReferenceImagesFor(node);
}
function promptQuickEditor(){
    return promptQuickTargetEl?.isConnected ? promptQuickTargetEl : promptInput;
}
function promptQuickTargetNode(){
    if(promptQuickTargetNodeId){
        const target = nodes.find(node => node.id === promptQuickTargetNodeId);
        if(target) return target;
    }
    return activeComposerNode() || window.SmartCanvasModules.viewportSelection.selection.node();
}
function setPromptQuickTarget(editor=promptInput, node=null){
    promptQuickTargetEl = editor || promptInput;
    promptQuickTargetNodeId = promptQuickTargetEl === promptInput
        ? ''
        : (node?.id || promptQuickTargetEl?.dataset?.nodeId || '');
}
function resetMentionPickerSession(){
    composer?.classList.remove('prompt-picker-open');
    promptQuickPickerItems = [];
    mentionInsertMode = 'token';
    promptQuickPickerMode = '';
    promptQuickTargetEl = null;
    promptQuickTargetNodeId = '';
    promptQuickTrigger = '';
    promptQuickQuery = '';
    promptQuickQueryRaw = '';
    mentionSourceTab = 'canvas';
    mentionCanvasOffset = 0;
    mentionAssetItems = [];
    mentionAssetCursor = '';
    mentionAssetLoading = false;
    mentionAssetLoaded = false;
    mentionAssetError = '';
    mentionFrozenTargetPoint = null;
    mentionLastQuery = '';
    mentionPicker.tabs = [];
    mentionPicker.loading = false;
    mentionPicker.error = '';
    mentionPicker.hasMore = false;
    if(window.SmartCanvasModules.viewportSelection.selection.node()){
        renderInputThumbsRow(window.SmartCanvasModules.viewportSelection.selection.node());
    }
}
function closeMentionPicker(){
    mentionPicker.hide?.('programmatic');
    mentionPicker.items = [];
    if(promptQuickPickerMode) resetMentionPickerSession();
}
function saveMentionRange(editor=promptQuickEditor()){
    const sel = window.getSelection();
    if(editor && sel && sel.rangeCount && editor.contains(sel.anchorNode)){
        mentionRange = sel.getRangeAt(0).cloneRange();
    }
}
const promptQuickBlockTags = new Set([
    'DIV','P','LI','SECTION','ARTICLE','HEADER','FOOTER','BLOCKQUOTE'
]);
function promptQuickDomText(root){
    let text = '';
    const hasContent = node => {
        if(node?.nodeType === Node.TEXT_NODE) return Boolean(node.textContent);
        if(node?.nodeType !== Node.ELEMENT_NODE) return Boolean(node?.childNodes?.length);
        if(node.tagName === 'BR') return true;
        return [...node.childNodes].some(hasContent);
    };
    const appendBreak = () => {
        if(text && !text.endsWith('\n')) text += '\n';
    };
    const walkChildren = parent => {
        let previousWasBlock = false;
        [...(parent?.childNodes || [])].forEach(node => {
            const isBlock = node.nodeType === Node.ELEMENT_NODE
                && promptQuickBlockTags.has(node.tagName);
            if((previousWasBlock || isBlock) && hasContent(node)) appendBreak();
            walk(node);
            previousWasBlock = isBlock;
        });
    };
    const walk = node => {
        if(node.nodeType === Node.TEXT_NODE){
            text += node.textContent || '';
            return;
        }
        if(node.nodeType !== Node.ELEMENT_NODE) return;
        if(node.tagName === 'BR'){
            text += '\n';
            return;
        }
        walkChildren(node);
    };
    walkChildren(root);
    return text;
}
function promptQuickRangeText(range){
    return range ? promptQuickDomText(range.cloneContents()) : '';
}
function textBeforeCaret(editor=promptQuickEditor()){
    const sel = window.getSelection();
    if(!editor || !sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) return '';
    const range = sel.getRangeAt(0).cloneRange();
    range.selectNodeContents(editor);
    range.setEnd(sel.anchorNode, sel.anchorOffset);
    return promptQuickRangeText(range);
}
function promptQuickNormalize(value){
    return String(value || '')
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}
function promptQuickIsSubsequence(needle, haystack){
    if(!needle) return true;
    let cursor = 0;
    for(const char of haystack){
        if(char === needle[cursor]) cursor += 1;
        if(cursor >= needle.length) return true;
    }
    return false;
}
function promptQuickFuzzyScore(query, values=[]){
    const needle = promptQuickNormalize(query);
    if(!needle) return 1;
    const fields = (values || []).map(promptQuickNormalize).filter(Boolean);
    let score = 0;
    fields.forEach(field => {
        const index = field.indexOf(needle);
        if(index >= 0) score = Math.max(score, 400 - Math.min(200, index) + (index === 0 ? 80 : 0));
    });
    const terms = needle.split(' ').filter(Boolean);
    const joined = fields.join(' ');
    if(terms.length > 1 && terms.every(term => joined.includes(term))) score = Math.max(score, 300);
    const compactNeedle = needle.replace(/\s+/g, '');
    if(!score && compactNeedle.length > 1){
        fields.forEach(field => {
            if(promptQuickIsSubsequence(compactNeedle, field.replace(/\s+/g, ''))) score = Math.max(score, 160);
        });
    }
    return score;
}
function promptQuickRank(items, fieldsForItem){
    return (items || [])
        .map((item, index) => ({
            item,
            index,
            score:promptQuickFuzzyScore(promptQuickQuery, fieldsForItem(item))
        }))
        .filter(entry => entry.score > 0)
        .sort((left, right) => (right.score - left.score) || (left.index - right.index))
        .map(entry => entry.item);
}
function promptQuickTriggerAtCaret(editor=promptQuickEditor()){
    const before = textBeforeCaret(editor);
    const validTrigger = promptAuthoring.quickTrigger({
        text:before,
        caret:before.length
    });
    const match = /(?:^|\s)([@/])([^@/\n]*)$/.exec(before);
    if(!match || !validTrigger || match[1] !== validTrigger) return null;
    return {
        trigger:match[1],
        rawQuery:match[2] || '',
        query:promptQuickNormalize(match[2] || ''),
        start:before.length - String(match[2] || '').length - 1
    };
}
function promptQuickDomPointAtTextOffset(editor, targetOffset){
    if(!editor) return null;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let fallback = {node:editor, offset:editor.childNodes.length};
    while(walker.nextNode()){
        const node = walker.currentNode;
        fallback = {node, offset:(node.textContent || '').length};
        for(let offset = 0; offset <= (node.textContent || '').length; offset += 1){
            const probe = document.createRange();
            probe.selectNodeContents(editor);
            probe.setEnd(node, offset);
            const length = promptQuickRangeText(probe).length;
            if(length >= targetOffset) return {node, offset};
        }
    }
    return fallback;
}
function mentionMediaIdentityKeys(img){
    const keys = [];
    const mediaId = String(img?.media_id || img?.mediaId || '').trim();
    const url = String(img?.url || '').trim();
    if(mediaId) keys.push(`media|${mediaId}`);
    if(url) keys.push(`url|${url}`);
    return keys;
}
function mentionReferenceStateForNode(node){
    const byIdentity = new Map();
    if(!node) return byIdentity;
    const mediaCounters = {image:0, video:0, audio:0, text:0, file:0};
    visibleReferenceImagesFor(node).forEach((ref, index) => {
        const state = {
            ref,
            index,
            label:composerInputMediaLabel(ref, mediaCounters)
        };
        mentionMediaIdentityKeys(ref).forEach(key => {
            if(!byIdentity.has(key)) byIdentity.set(key, state);
        });
    });
    return byIdentity;
}
function mentionReferenceStateForItem(stateByIdentity, item){
    const mediaId = String(item?.media_id || item?.mediaId || '').trim();
    const url = String(item?.url || '').trim();
    if(mediaId){
        const mediaState = stateByIdentity.get(`media|${mediaId}`);
        if(mediaState) return mediaState;
        const urlState = url ? stateByIdentity.get(`url|${url}`) : null;
        const referencedMediaId = String(
            urlState?.ref?.media_id || urlState?.ref?.mediaId || ''
        ).trim();
        return urlState && !referencedMediaId ? urlState : null;
    }
    return url ? stateByIdentity.get(`url|${url}`) || null : null;
}
function mentionPickerCandidatesWithReferenceState(items, node){
    const stateByIdentity = mentionReferenceStateForNode(node);
    return (items || [])
        .map((item, index) => {
            const referenceState = mentionReferenceStateForItem(stateByIdentity, item);
            return {
                item:referenceState ? {
                    ...item,
                    mentionReferenced:true,
                    mentionReferenceIndex:referenceState.index,
                    mentionReferenceLabel:referenceState.label
                } : item,
                index,
                referenceIndex:referenceState?.index ?? Number.MAX_SAFE_INTEGER
            };
        })
        .sort((left, right) => (left.referenceIndex - right.referenceIndex) || (left.index - right.index))
        .map(entry => entry.item);
}
function mentionPickerMediaItem(img, index){
    const kind = img.kind || mediaKindForItem(img);
    const label = img.mentionReferenceLabel || img.alias || img.name || tr('smart.media');
    return {
        value:inputRefKey(img) || img.mentionId || String(index),
        label,
        category:img.categoryName || img.publisher || '',
        badge:img.mentionReferenced ? label : '',
        leading:Boolean(img.mentionReferenced),
        disabled:Boolean(img.disabled),
        error:img.error || '',
        media:{
            kind,
            src:kind === 'audio' ? img.url : smartMediaPreviewUrl(img, 512),
            alt:img.alias || img.name || tr('smart.media'),
            aspectRatio:Number(img.naturalWidth || img.width || 0) / Math.max(1, Number(img.naturalHeight || img.height || 0))
        }
    };
}
function renderMentionPicker(){
    const queryChanged = mentionLastQuery !== promptQuickQuery;
    if(queryChanged){
        mentionLastQuery = promptQuickQuery;
        mentionCanvasOffset = 0;
        mentionAssetItems = [];
        mentionAssetCursor = '';
        mentionAssetLoaded = false;
        mentionAssetError = '';
    }
    const targetNode = promptQuickTargetNode();
    const allCanvasCandidates = mentionPickerCandidatesWithReferenceState(
        inputMentionCandidateImages(targetNode).filter(item =>
            !promptQuickQuery || promptQuickNormalize(item.alias || item.name).includes(promptQuickQuery)
        ),
        targetNode
    );
    const visibleCanvasCandidates = allCanvasCandidates.slice(0, mentionCanvasOffset + 60);
    const candidates = mentionSourceTab === 'assets'
        ? mentionPickerCandidatesWithReferenceState(mentionAssetItems, targetNode)
        : visibleCanvasCandidates;
    promptQuickPickerItems = candidates;
    promptQuickPickerMode = 'input';
    mentionPicker.setAttribute('label', tr('smart.mentionInput'));
    mentionPicker.setAttribute('empty-label', tr('smart.mentionEmpty'));
    mentionPicker.tabs = [
        {value:'canvas', label:tr('smart.currentCanvas')},
        {value:'assets', label:tr('smart.workspaceAssetLibrary')}
    ];
    mentionPicker.activeTab = mentionSourceTab;
    mentionPicker.loading = mentionSourceTab === 'assets' && mentionAssetLoading;
    mentionPicker.error = mentionSourceTab === 'assets' ? mentionAssetError : '';
    mentionPicker.hasMore = mentionSourceTab === 'assets'
        ? Boolean(mentionAssetCursor)
        : visibleCanvasCandidates.length < allCanvasCandidates.length;
    mentionPicker.items = candidates.map(mentionPickerMediaItem);
    if(
        mentionSourceTab === 'assets'
        && !mentionAssetLoaded
        && !mentionAssetLoading
        && !mentionAssetError
        && !mentionAssetItems.length
    ) queueMicrotask(() => loadMentionAssetPage({reset:true}));
    if(mentionInsertMode === 'manual-ref'){
        renderInputThumbsRow(window.SmartCanvasModules.viewportSelection.selection.node());
    }
    if(promptQuickEditor() === promptInput) composer?.classList.add('prompt-picker-open');
    const editor = promptQuickEditor();
    const presentation = promptQuickPickerPresentation(editor);
    if(presentation.anchor) mentionPicker.show(presentation.anchor, {
        invoker:editor,
        placement:presentation.placement
    });
}
async function loadMentionAssetPage({reset=false}={}){
    if(mentionAssetLoading) return;
    const requestId = ++mentionAssetRequest;
    mentionAssetLoading = true;
    mentionAssetError = '';
    if(reset){ mentionAssetItems = []; mentionAssetCursor = ''; mentionAssetLoaded = false; }
    renderMentionPicker();
    try {
        const search = new URLSearchParams({query:promptQuickQuery, limit:'60'});
        if(!reset && mentionAssetCursor) search.set('cursor', mentionAssetCursor);
        const response = await fetch(`/api/workspace-assets?${search}`);
        if(!response.ok) throw new Error(await smartResponseErrorMessage(response, tr('smart.assetLibraryLoadFailed')));
        const data = await response.json();
        if(requestId !== mentionAssetRequest) return;
        const loadedItems = (data.items || []).map(item => ({
            ...item,
            alias:item.name,
            kind:'image',
            assetEntryId:item.id,
            assetLibraryEntryId:item.id,
            categoryName:item.publisher ? trf('smart.addedBy', {name:item.publisher}) : ''
        }));
        if(reset){
            mentionAssetItems = loadedItems;
        } else {
            const existingKeys = new Set(mentionAssetItems.map(item => (
                item.assetEntryId || item.id || item.url
            )));
            mentionAssetItems = mentionAssetItems.concat(loadedItems.filter(item => {
                const key = item.assetEntryId || item.id || item.url;
                return !existingKeys.has(key);
            }));
        }
        mentionAssetCursor = data.next_cursor || '';
        mentionAssetLoaded = true;
    } catch(error) {
        if(requestId === mentionAssetRequest) mentionAssetError = error.message || tr('smart.assetLibraryLoadRetry');
    } finally {
        if(requestId === mentionAssetRequest){
            mentionAssetLoading = false;
            renderMentionPicker();
        }
    }
}
function showMentionPicker(editor=promptInput, node=null){
    const sameSession = promptQuickPickerMode === 'input'
        && mentionInsertMode === 'token'
        && promptQuickEditor() === editor;
    setPromptQuickTarget(editor, node);
    mentionInsertMode = 'token';
    if(!sameSession){
        mentionSourceTab = 'canvas';
        mentionCanvasOffset = 0;
        const target = node || promptQuickTargetNode();
        mentionFrozenTargetPoint = target ? {
            x:Number(target.x || 0) + Number(target.width || 320) / 2,
            y:Number(target.y || 0) + Number(target.height || 240) / 2
        } : null;
    }
    renderMentionPicker();
}
function renderPromptTemplateQuickPicker(){
    if(!promptLibraries.length){ closeMentionPicker(); return; }
    const items = promptQuickRank(
        promptQuickTemplateItems(),
        item => [
            promptTemplateSearchText(item),
            promptQuickTemplateCategoryLabel(item)
        ]
    );
    promptQuickPickerItems = items;
    promptQuickPickerMode = 'template';
    mentionPicker.setAttribute('label', tr('smart.promptTemplates'));
    mentionPicker.setAttribute('empty-label', tr('smart.tplNoMatches'));
    mentionPicker.tabs = [];
    mentionPicker.loading = false;
    mentionPicker.error = '';
    mentionPicker.hasMore = false;
    mentionPicker.items = items.map((template, index) => ({
        value:template.id || String(index),
        label:promptTemplateName(template) || tr('smart.promptTemplateUnnamed'),
        category:promptQuickTemplateCategoryLabel(template),
        icon:'book-text'
    }));
    if(promptQuickEditor() === promptInput) composer?.classList.add('prompt-picker-open');
    const editor = promptQuickEditor();
    const presentation = promptQuickPickerPresentation(editor);
    if(presentation.anchor) mentionPicker.show(presentation.anchor, {
        invoker:editor,
        placement:presentation.placement
    });
}
function showPromptTemplateQuickPicker(editor=promptInput, node=null){
    setPromptQuickTarget(editor, node);
    mentionInsertMode = 'token';
    renderPromptTemplateQuickPicker();
}
function insertPromptTemplateText(template){
    if(!template) return;
    const text = promptTemplateText(template, 'positive');
    if(!text) return;
    const editor = promptQuickEditor();
    const node = promptQuickTargetNode();
    const range = consumePromptTrigger('/');
    const selection = window.getSelection();
    const insertedText = document.createTextNode(`${text} `);
    range.insertNode(insertedText);
    range.setStartAfter(insertedText);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    mentionRange = range.cloneRange();
    closeMentionPicker();
    if(editor === promptInput){
        delete promptInput.dataset.restoredGenerationSnapshotFor;
        delete promptInput.dataset.preserveDraftOnce;
        savePromptDraftForCurrent();
    } else if(node?.llmEnabled && editor.classList.contains('prompt-llm-instruction')){
        syncPromptLlmInstructionEditor(node, editor);
    } else {
        syncPromptNodeEditor(node, editor);
    }
    canvasPersistence.schedule();
    editor.focus();
}
function setPromptCaretToEnd(editor=promptInput){
    if(!editor) return;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    mentionRange = range.cloneRange();
}
function toggleInputMentionPickerFromThumbs(){
    if(!window.SmartCanvasModules.viewportSelection.selection.node()) return;
    if(mentionInsertMode === 'manual-ref' && promptQuickPickerMode === 'input'){
        closeMentionPicker();
        return;
    }
    setPromptQuickTarget(promptInput, window.SmartCanvasModules.viewportSelection.selection.node());
    mentionInsertMode = 'manual-ref';
    renderInputThumbsRow(window.SmartCanvasModules.viewportSelection.selection.node());
    renderMentionPicker();
}
async function loadReferenceUploadLimits(){
    if(referenceUploadLimits) return referenceUploadLimits;
    try {
        const response = await fetch('/api/ai/upload-limits');
        if(!response.ok) throw new Error('limits unavailable');
        referenceUploadLimits = await response.json();
    } catch(error) {
        referenceUploadLimits = {max_files:20,max_file_bytes:500 * 1024 * 1024,txt_max_bytes:1024 * 1024,txt_batch_max_bytes:2 * 1024 * 1024};
    }
    return referenceUploadLimits;
}
function openLocalReferenceUpload(node){
    if(!node?.id || !referenceFileInput) return;
    referenceUploadTargetId = node.id;
    referenceFileInput.value = '';
    referenceFileInput.click();
}
function removeLocalTextReference(node, inputInstanceId){
    if(!node || !inputInstanceId || !Array.isArray(node.localTextRefs)) return false;
    const next = node.localTextRefs.filter(ref => ref?.inputInstanceId !== inputInstanceId);
    if(next.length === node.localTextRefs.length) return false;
    canvasMutation.history({action:'push'});
    if(next.length) node.localTextRefs = next;
    else delete node.localTextRefs;
    renderInputThumbsRow(node);
    canvasPersistence.schedule();
    return true;
}
async function uploadLocalReferences(files=[]){
    const selected = [...files];
    if(!selected.length || !referenceUploadTargetId) return;
    const targetId = referenceUploadTargetId;
    const limits = await loadReferenceUploadLimits();
    const maxFiles = Math.max(1, Number(limits.max_files) || 20);
    const maxBytes = Math.max(1, Number(limits.max_file_bytes) || 500 * 1024 * 1024);
    const accepted = selected.slice(0, maxFiles).filter(file => Number(file.size || 0) <= maxBytes);
    const clientFailures = selected.length - accepted.length;
    if(!accepted.length){
        toast(trf('smart.noUploadableReferences', {maxFiles, maxMb:Math.round(maxBytes / 1024 / 1024)}), {tone:'warning'});
        return;
    }
    const data = new FormData();
    accepted.forEach(file => data.append('files', file, file.name));
    let result;
    try {
        const response = await fetch('/api/ai/upload', {method:'POST', body:data});
        if(!response.ok) throw new Error(await smartResponseErrorMessage(response, tr('smart.localReferenceUploadFailed')));
        result = await response.json();
    } catch(error) {
        toast(error.message || tr('smart.localReferenceUploadFailed'), {tone:'danger'});
        return;
    }
    const target = nodes.find(node => node.id === targetId);
    if(!target){
        toast(tr('smart.referenceTargetMissing'), {tone:'warning'});
        return;
    }
    const uploadedItems = Array.isArray(result.files) ? result.files : [];
    if(uploadedItems.length) canvasMutation.history({action:'push'});
    uploadedItems.forEach(item => {
        if(item.kind === 'text'){
            const ref = {
                url:item.url,
                name:item.name || tr('smart.untitledTextFile'),
                kind:'text',
                mime:item.mime || 'text/plain',
                mediaId:item.media_id || '',
                inputInstanceId:window.SmartCanvasModules.referenceInstances.newId('local-text'),
                textSnapshot:String(item.text_snapshot || ''),
                textBytes:Number(item.text_bytes || 0),
                textError:String(item.text_error || '')
            };
            target.localTextRefs = [...(target.localTextRefs || []), ref];
            return;
        }
        addManualReferenceToNode(target, {
            ...item,
            media_id:item.media_id,
            alias:item.name,
            kind:item.kind || mediaKindForItem(item)
        }, {skipHistory:true});
    });
    renderInputThumbsRow(target);
    canvasPersistence.schedule();
    const failed = clientFailures + Number(result.failed_count || 0);
    const succeeded = Number(result.success_count || 0);
    const reasons = (result.failures || [])
        .map(item => `${item.name}${tr('smart.keyValueSeparator')}${item.reason}`)
        .join(tr('smart.messageSeparator'));
    toast(
        failed
            ? trf('smart.localReferencesAddedWithFailures', {succeeded, failed, reasons:reasons ? trf('smart.failureReasonsSuffix', {reasons}) : ''})
            : trf('smart.localReferencesAdded', {count:succeeded}),
        {tone:failed ? 'warning' : 'success'}
    );
}
function consumePromptTrigger(trigger){
    const editor = promptQuickEditor();
    editor.focus();
    const selection = window.getSelection();
    if(mentionRange && editor.contains(mentionRange.startContainer)){
        selection.removeAllRanges();
        selection.addRange(mentionRange);
    }
    let range = selection.rangeCount ? selection.getRangeAt(0) : document.createRange();
    const activeTrigger = promptQuickTriggerAtCaret(editor);
    if(activeTrigger?.trigger === trigger && range.startContainer){
        const point = promptQuickDomPointAtTextOffset(editor, activeTrigger.start);
        if(point){
            const removal = document.createRange();
            removal.setStart(point.node, point.offset);
            removal.setEnd(range.startContainer, range.startOffset);
            removal.deleteContents();
            removal.collapse(true);
            selection.removeAllRanges();
            selection.addRange(removal);
            mentionRange = removal.cloneRange();
            return removal;
        }
    }
    let removed = false;
    if(range.startContainer?.nodeType === Node.TEXT_NODE && range.startOffset > 0){
        const text = range.startContainer.textContent || '';
        if(text[range.startOffset - 1] === trigger){
            range.setStart(range.startContainer, range.startOffset - 1);
            range.deleteContents();
            removed = true;
        }
    }
    if(!removed){
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        let lastText = null;
        while(walker.nextNode()) lastText = walker.currentNode;
        if(lastText && String(lastText.textContent || '').endsWith(trigger)){
            lastText.textContent = lastText.textContent.slice(0, -trigger.length);
            range.selectNodeContents(editor);
            range.collapse(false);
        }
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    mentionRange = range.cloneRange();
    return range;
}
function selectMentionReference(item){
    if(!item?.url) return;
    const editor = promptQuickEditor();
    const node = promptQuickTargetNode();
    const manualMode = mentionInsertMode === 'manual-ref';
    if(!manualMode) consumePromptTrigger('@');
    if(editor !== promptInput){
        if(node?.llmEnabled && editor.classList.contains('prompt-llm-instruction')){
            syncPromptLlmInstructionEditor(node, editor);
        } else {
            syncPromptNodeEditor(node, editor);
        }
    }
    const result = addManualReferenceToNode(node, item, {
        closePicker:true,
        preventDuplicate:true
    });
    if(!manualMode && result?.ref){
        insertMentionToken(result.ref, editor);
        if(editor !== promptInput){
            if(node?.llmEnabled && editor.classList.contains('prompt-llm-instruction')){
                syncPromptLlmInstructionEditor(node, editor);
            } else {
                syncPromptNodeEditor(node, editor);
            }
        }
    }
    if(editor === promptInput){
        delete promptInput.dataset.restoredGenerationSnapshotFor;
        delete promptInput.dataset.preserveDraftOnce;
        savePromptDraftForCurrent();
        promptInput.focus();
    } else if(result?.added){
        render();
        requestAnimationFrame(() => beginPromptNodeTextEdit(node.id));
    } else {
        editor.focus();
    }
    canvasPersistence.schedule();
}
function addManualReferenceToNode(node, img, {closePicker=false,skipHistory=false,preventDuplicate=false}={}){
    if(!node || !img?.url) return {added:false, duplicate:false};
    if(preventDuplicate){
        const existing = mentionReferenceStateForItem(mentionReferenceStateForNode(node), img);
        if(existing){
            if(closePicker) closeMentionPicker();
            if(window.SmartCanvasModules.viewportSelection.selection.node()?.id === node.id) renderInputThumbsRow(node);
            return {added:false, duplicate:true, node, ref:existing.ref};
        }
    }
    const kind = img.kind || mediaKindForItem(img);
    const ref = window.SmartCanvasModules.referenceInstances.manual({
        url:img.url,
        name:img.alias || img.name || (kind === 'audio' ? tr('smart.kindAudio') : kind === 'video' ? tr('smart.kindVideo') : tr('smart.kindImage')),
        kind,
        nodeId:img.nodeId || '',
        imageIndex:Number.isFinite(Number(img.imageIndex)) ? Number(img.imageIndex) : '',
        outputId:img.outputId || '',
        asset_uris:img.asset_uris || {},
        media_id:img.media_id || img.mediaId || '',
        assetLibraryEntryId:img.assetLibraryEntryId || img.assetEntryId || '',
        sourceNodeTitle:img.sourceNodeTitle || '',
        manualAdded:true
    });
    if(img.originalLocalUrl) ref.originalLocalUrl = img.originalLocalUrl;
    const refs = Array.isArray(node.manualInputRefs) ? node.manualInputRefs.slice() : [];
    const key = inputRefKey(ref);
    if(!skipHistory) canvasMutation.history({action:'push'});
    refs.push(ref);
    node.manualInputRefs = refs;
    const blocked = blockedInputRefKeys(node);
    if(blocked.delete(key)){
        if(blocked.size) node.blockedInputRefs = [...blocked];
        else delete node.blockedInputRefs;
    }
    if(closePicker) closeMentionPicker();
    if(window.SmartCanvasModules.viewportSelection.selection.node()?.id === node.id) renderInputThumbsRow(node);
    canvasPersistence.schedule();
    return {added:true, duplicate:false, node, ref};
}
function addManualReferenceToSelectedNode(img){
    return addManualReferenceToNode(activeComposerNode() || window.SmartCanvasModules.viewportSelection.selection.node(), img, {closePicker:true});
}
function removeManualReferenceFromSelectedNode(key){
    const node = window.SmartCanvasModules.viewportSelection.selection.node();
    if(!node || !key || !Array.isArray(node.manualInputRefs)) return;
    const refs = node.manualInputRefs.slice();
    const index = refs.findIndex(ref => inputRefKey(ref) === key || ref?.url === key.replace(/^url\|/, ''));
    if(index < 0) return;
    canvasMutation.history({action:'push'});
    refs.splice(index, 1);
    node.manualInputRefs = refs;
    if(!refs.length) delete node.manualInputRefs;
    removeComposerMentionTokensForReference(node, key);
    renderInputThumbsRow(node);
    canvasPersistence.schedule();
}
function removeInputReferenceFromNode(node, key, {onRefresh=null}={}){
    if(!node || !key) return;
    const refs = Array.isArray(node.manualInputRefs) ? node.manualInputRefs.slice() : [];
    const manualIndex = refs.findIndex(ref => inputRefKey(ref) === key || ref?.url === key.replace(/^url\|/, ''));
    canvasMutation.history({action:'push'});
    if(manualIndex >= 0){
        refs.splice(manualIndex, 1);
        if(refs.length) node.manualInputRefs = refs;
        else delete node.manualInputRefs;
    } else {
        const blocked = blockedInputRefKeys(node);
        blocked.add(key);
        node.blockedInputRefs = [...blocked];
    }
    if(Array.isArray(node.inputRefOrder)){
        node.inputRefOrder = node.inputRefOrder.filter(itemKey => itemKey !== key);
        if(!node.inputRefOrder.length) delete node.inputRefOrder;
    }
    removeComposerMentionTokensForReference(node, key);
    if(inputThumbsRow) delete inputThumbsRow.dataset.thumbsSig;
    if(typeof onRefresh === 'function') onRefresh();
    else renderInputThumbsRow(node);
    canvasPersistence.schedule();
}
function removeInputReferenceFromSelectedNode(key){
    removeInputReferenceFromNode(window.SmartCanvasModules.viewportSelection.selection.node(), key);
}
function removeTextInputReferenceFromSelectedNode(sourceNodeId){
    const node = window.SmartCanvasModules.viewportSelection.selection.node();
    if(!node || !sourceNodeId || sourceNodeId === node.id) return;
    const connectionIndexes = (canvas?.connections || []).map((connection, index) => (
        connection.from === sourceNodeId
        && connection.to === node.id
        && (connection.kind || 'flow') === 'input'
            ? index
            : -1
    )).filter(index => index >= 0);
    if(connectionIndexes.length){
        canvasMutation.disconnect({indexes:connectionIndexes});
        return;
    }
    if(!Array.isArray(node.inputNodeIds) || !node.inputNodeIds.includes(sourceNodeId)) return;
    canvasMutation.history({action:'push'});
    node.inputNodeIds = node.inputNodeIds.filter(id => id !== sourceNodeId);
    if(!node.inputNodeIds.length) delete node.inputNodeIds;
    if(inputThumbsRow) delete inputThumbsRow.dataset.thumbsSig;
    render();
    canvasPersistence.schedule();
}
function promptQuickPickerContainer(editor=promptQuickEditor()){
    if(editor === promptInput){
        return promptInput?.closest?.('.composer-card') || promptInput?.closest?.('.prompt-row');
    }
    return editor?.closest?.('.image-node') || editor?.closest?.('.prompt-node-card') || editor;
}
function promptQuickPickerPresentation(editor=promptQuickEditor()){
    const fullscreen = editor === promptInput
        ? composer?.classList.contains('focused')
        : Boolean(editor?.closest?.('.prompt-node-focus-surface'));
    if(fullscreen){
        return {anchor:editor, placement:'overlay-block-end'};
    }
    return {anchor:promptQuickPickerContainer(editor), placement:'block-start'};
}
function maybeOpenMentionPicker(editor=promptInput, node=null, {allowOpen=false}={}){
    if(promptQuickComposing) return;
    // Existing sessions may refine their query; closed sessions need a newly typed @ or /.
    const activeSession = mentionPicker.hasAttribute('open')
        && mentionInsertMode === 'token'
        && promptQuickTargetEl === editor;
    if(!activeSession && !allowOpen) return;
    setPromptQuickTarget(editor, node);
    saveMentionRange(editor);
    const trigger = promptQuickTriggerAtCaret(editor);
    if(!trigger){
        closeMentionPicker();
        return;
    }
    promptQuickTrigger = trigger.trigger;
    promptQuickQuery = trigger.query;
    promptQuickQueryRaw = trigger.rawQuery;
    if(trigger.trigger === '@') showMentionPicker(editor, node);
    else showPromptTemplateQuickPicker(editor, node);
}
function handlePromptQuickPickerKeydown(event, editor=promptInput){
    if(!mentionPicker.hasAttribute('open') || promptQuickEditor() !== editor) return false;
    return Boolean(mentionPicker.handleKeydown?.(event));
}
function insertMentionToken(img, editor=promptQuickEditor()){
    if(!img?.url) return;
    editor.focus();
    const sel = window.getSelection();
    if(mentionRange){
        sel.removeAllRanges();
        sel.addRange(mentionRange);
    }
    const range = sel.rangeCount ? sel.getRangeAt(0) : document.createRange();
    let removedAt = false;
    if(range.startContainer?.nodeType === Node.TEXT_NODE && range.startOffset > 0){
        const text = range.startContainer.textContent || '';
        if(text[range.startOffset - 1] === '@'){
            range.setStart(range.startContainer, range.startOffset - 1);
            range.deleteContents();
            removedAt = true;
        }
    }
    if(!removedAt) {
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        let lastText = null;
        while(walker.nextNode()) lastText = walker.currentNode;
        if(lastText && /@$/.test(lastText.textContent || '')) {
            lastText.textContent = lastText.textContent.slice(0, -1);
            range.selectNodeContents(editor);
            range.collapse(false);
        }
    }
    const token = document.createElement('span');
    token.className = 'mention-image-token';
    token.contentEditable = 'false';
    token.dataset.url = img.url;
    token.dataset.kind = mediaKindForItem(img);
    token.dataset.name = img.alias || img.name || (token.dataset.kind === 'audio' ? tr('smart.kindAudio') : token.dataset.kind === 'video' ? tr('smart.kindVideo') : tr('smart.kindImage'));
    token.dataset.nodeId = img.nodeId || '';
    token.dataset.imageIndex = String(img.imageIndex ?? '');
    token.dataset.outputId = img.outputId || '';
    token.dataset.inputInstanceId = img.inputInstanceId || '';
    token.dataset.assetUris = JSON.stringify(img.asset_uris || {});
    token.innerHTML = `${mentionTokenMediaHtml(img, token.dataset.kind)}<span class="mention-token-label">${escapeHtml(token.dataset.name)}</span>`;
    range.insertNode(token);
    bindSmartPreviewImageFallbacks(token);
    const spacer = document.createTextNode(' ');
    token.after(spacer);
    range.setStartAfter(spacer);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    closeMentionPicker();
    editor.focus();
    renderInputThumbsRow(window.SmartCanvasModules.viewportSelection.selection.node());
}
const promptNodeActiveRunCounts = new Map();
function beginPromptNodeRun(node){
    const count = (promptNodeActiveRunCounts.get(node.id) || 0) + 1;
    promptNodeActiveRunCounts.set(node.id, count);
    node.running = true;
}
function finishPromptNodeRun(nodeId){
    const count = Math.max(0, (promptNodeActiveRunCounts.get(nodeId) || 0) - 1);
    if(count) promptNodeActiveRunCounts.set(nodeId, count);
    else promptNodeActiveRunCounts.delete(nodeId);
    const node = nodes.find(item => item.id === nodeId);
    if(node) node.running = count > 0;
}
async function runPromptLLMNode(nodeId, options={}){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'smart-prompt') return;
    const message = promptNodeLLMInputText(node).trim();
    if(!message){ toast(tr('smart.promptLlmNeedText')); return; }
    const systemPrompt = (node.llmSystemPrompt || '').trim();
    const provider = resolveChatProviderId(node.llmProvider || '');
    const model = resolveChatModel(node.llmModel || '', provider);
    const mediaRefs = promptNodeInputMediaForLLM(node);
    const images = imageRefsOnly(mediaRefs).map(img => img.url).filter(Boolean);
    const videos = videoRefsOnly(mediaRefs).map(video => video.url).filter(Boolean);
    const runLog = smartRunSnapshot(node, message, mediaRefs, 'text', {
        engine:'api',
        provider_id:provider,
        model,
        count:1
    });
    const runLogStart = nowMs();
    if(!options.skipUndo) canvasMutation.history({action:'push'});
    let outputNode = canvasMutation.create({
        kind:'prompt',
        data:{
            title:tr('smart.kindText'),
            textGenerationOutput:true,
            textGenerationPending:true
        },
        options:{
            select:true,
            reveal:true,
            skipUndo:true,
            render:false,
            save:false,
            placement:{
                anchor:{kind:'source',sourceNodeId:node.id},
                relation:'downstream',
                arrangement:'single'
            }
        }
    });
    outputNode.running = true;
    outputNode.runStartedAt = nowMs();
    outputNode.generationOperationId = [
        smartClientId || 'smart-client',
        'text-generation',
        Date.now().toString(36),
        Math.random().toString(36).slice(2,10)
    ].join(':');
    delete outputNode.runFinishedAt;
    delete outputNode.runElapsedMs;
    outputNode.runTimerHidden = false;
    canvasMutation.connect({
        fromId:node.id,
        toId:outputNode.id,
        input:true
    });
    node.llmEnabled = true;
    beginPromptNodeRun(node);
    node.llmProvider = provider;
    node.llmModel = model;
    node.lastGeneratedNodeId = outputNode.id;
    selectedId = outputNode.id;
    selectedIds = [];
    selectedImage = {nodeId:'', index:-1};
    render();
    canvasPersistence.schedule();
    let submissionAccepted = false;
    try {
        await canvasPersistence.save();
        if(!await canvasPersistence.synced({timeout:5000})){
            throw new Error(tr('smart.syncIncompleteGeneration'));
        }
        const submission = await fetch('/api/canvas-llm-tasks', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                message,
                messages:[],
                images,
                videos,
                model,
                provider,
                ms_model: provider === 'modelscope' ? model : '',
                system_prompt:node.llmSystemEnabled ? (systemPrompt || 'You are a helpful prompt assistant.') : '',
                canvas_id:canvasId,
                node_id:outputNode.id,
                generation_operation_id:outputNode.generationOperationId,
                generation_request_index:0
            })
        }).then(async r => {
            if(!r.ok) throw new Error(await r.text());
            return r.json();
        });
        submissionAccepted = true;
        runLog.generationRunId = submission.task_id || runLog.generationRunId;
        await options.onAccepted?.({node:outputNode,submission});
        outputNode = nodes.find(item => item.id === outputNode.id) || null;
        if(!outputNode) return null;
        const recovery = window.SmartCanvasModules?.generationRecovery;
        if(!recovery) throw new Error('Generation Recovery Module failed to load');
        await recovery.settle({
            node:outputNode,
            submission:{
                state:'pending',
                kind:'text',
                tasks:[{
                    taskId:submission.task_id,
                    kind:'text',
                    actorId:submission.actor_id || '',
                    sourceNodeId:node.id
                }]
            },
            logContext:{run:runLog,runLogStart}
        });
        outputNode = nodes.find(item => item.id === outputNode.id) || null;
        if(!outputNode || !String(outputNode.text || '').trim()){
            throw new Error(tr('smart.noTextReturned'));
        }
        selectedId = outputNode.id;
        selectedIds = [];
        selectedImage = {nodeId:'', index:-1};
    } catch(e) {
        const failedOutputId = outputNode?.id || '';
        const liveOutput = nodes.find(item => item.id === failedOutputId);
        if(liveOutput){
            canvasMutation.remove({
                nodeIds:[liveOutput.id],
                options:{skipUndo:true,render:false,save:false}
            });
        }
        if(node.lastGeneratedNodeId === failedOutputId) delete node.lastGeneratedNodeId;
        selectedId = node.id;
        selectedIds = [];
        selectedImage = {nodeId:'', index:-1};
        outputNode = null;
        toast((e.message || tr('smart.promptLlmFailed')).slice(0, 160));
        if(e&&typeof e==='object') e.aiProcessorToastShown=true;
        if(options.throwOnSubmissionFailure && !submissionAccepted) throw e;
    } finally {
        finishPromptNodeRun(node.id);
        render();
        canvasPersistence.schedule();
    }
    return outputNode;
}
function ungroupNode(groupId){
    const group = nodes.find(n => n.id === groupId);
    if(!group) return false;
    if(smartContainer.isGroup(group)){
        return smartContainer.ungroup(groupId);
    }
    if(!Array.isArray(group.images) || group.images.length < 2) return false;
    canvasMutation.history({action:'push'});
    const layout = imageLayout(group.images || [], nodeScale(group), group);
    const pad = 16;
    const gap = 8;
    const cell = Math.max(28, Math.round(layout.thumb || 96));
    const created = (group.images || []).map((img, index) => {
        const col = index % Math.max(1, layout.cols || 1);
        const row = Math.floor(index / Math.max(1, layout.cols || 1));
        const size = thumbDisplaySize(img, cell);
        const x = Math.round(Number(group.x || 0) + pad + col * (cell + gap) + Math.max(0, (cell - size.width) / 2));
        const y = Math.round(Number(group.y || 0) + pad + row * (cell + gap) + Math.max(0, (cell - size.height) / 2));
        const node = {
            id:uid('smart'),
            type:'smart-image',
            x,
            y,
            w:size.width,
            h:size.height,
            title:'Image',
            images:[stripImageGenerationMeta({...img})],
            scale:MEDIA_NODE_DEFAULT_SCALE,
            created_at:Date.now()
        };
        inheritNodeMetaFromImage(node);
        clearDetachedRunInputRefs(node);
        return node;
    });
    nodes = nodes.filter(n => n.id !== groupId);
    nodes.push(...created);
    if(canvas) canvas.connections = (canvas.connections || []).filter(c => c.from !== groupId && c.to !== groupId);
    nodes.forEach(node => {
        if(Array.isArray(node.inputNodeIds)){
            node.inputNodeIds = node.inputNodeIds.filter(inputId => inputId !== groupId);
        }
    });
    selectedIds = created.map(node => node.id);
    selectedId = selectedIds.length === 1 ? selectedIds[0] : '';
    selectedImage = {nodeId:'', index:-1};
    smartContainer.reconcileFrames();
    render();
    canvasPersistence.schedule();
    return true;
}
function closeCreateMenu(){
    createMenu?.hide?.('programmatic');
    createMenuGroupId = '';
}
function openCreateMenu(event, options={}){
    if(!createMenu) return;
    closeSmartNodeContextMenu();
    createMenuPoint = window.SmartCanvasModules.viewportSelection.viewport.screenToWorld(event);
    createMenuGroupId = options.groupId || '';
    const pasteItem = createMenu.querySelector('ic-menu-item[value="paste"]');
    const batchImportItem = createMenu.querySelector('ic-menu-item[value="batch-import"]');
    const pasteSeparator = createMenu.querySelector('[data-create-menu-paste-separator]');
    const showPaste = Boolean(options.allowPaste && !createMenuGroupId);
    if(pasteItem){
        pasteItem.hidden = !showPaste;
        pasteItem.toggleAttribute('disabled', !showPaste || !availableNodeClipboard()?.nodes?.length);
        const shortcut = pasteItem.querySelector('kbd');
        if(shortcut) shortcut.textContent = smartShortcutLabel('paste');
    }
    if(batchImportItem) batchImportItem.hidden = !showPaste;
    if(pasteSeparator) pasteSeparator.hidden = !showPaste;
    createMenu.showAt(event.clientX, event.clientY, shell);
}
function addCreatedNodeToMenuGroup(node){
    const group = createMenuGroupId ? nodes.find(n => n.id === createMenuGroupId) : null;
    if(smartContainer.add(group?.id || '',[node?.id || ''],{
        skipUndo:true
    })){
        // 通过分组小菜单新建的节点入组后自动整理（节点创建已压过 undo，这里不再重复）。
        smartContainer.arrange(group, {skipUndo:true});
        render();
        canvasPersistence.schedule();
    }
}
function createNodeFromMenu(type){
    const p = createMenuPoint || window.SmartCanvasModules.viewportSelection.viewport.center();
    const groupId = createMenuGroupId;
    if(type === 'batch-import'){
        createMenuGroupId = '';
        Promise.resolve(createMenu?.hide?.('selection')).then(() => {
            shell?.focus?.({preventScroll:true});
            return openSmartNodePackageImportDialog();
        });
        return true;
    }
    closeCreateMenu();
    if(type === 'paste') return pasteNodes(p);
    if(type === 'upload'){
        if(!fileInput?.open) return false;
        fileInput.setAttribute('accept', 'image/*,video/*,audio/*,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov,.m4v,.mp3,.wav,.m4a,.aac,.ogg,.flac');
        fileInput.clear?.({silent:true});
        pendingGroupUploadPoint = groupId ? null : p;
        uploadTargetId = groupId;
        return fileInput.open();
    }
    let created = null;
    const placement = {
        anchor:{kind:'point',x:p.x,y:p.y},
        relation:'free',
        arrangement:'single'
    };
    if(type === 'group'){
        created = canvasMutation.create({
            kind:'group',
            data:{x:0,y:0},
            options:{placement,reveal:true}
        });
    } else if(type === 'frame'){
        created = canvasMutation.create({
            kind:'frame',
            data:{x:0,y:0},
            options:{placement,reveal:true}
        });
    } else if(type === 'prompt'){
        created = canvasMutation.create({
            kind:'prompt',
            data:{x:0,y:0},
            options:{placement,reveal:true}
        });
    } else if(type === 'splitter'){
        created = canvasMutation.create({
            kind:'splitter',
            data:{x:0,y:0},
            options:{placement,reveal:true}
        });
    } else if(type === 'loop'){
        created = canvasMutation.create({
            kind:'loop',
            data:{x:0,y:0},
            options:{placement,reveal:true}
        });
    } else if(type === 'generate'){
        created = createImageNodeAt(p);
        created.referenceGenerationKind = 'image';
        created.title = tr('smart.generationNode');
        created.runSettings = settingsForStorage({
            ...smartSettingsForNode(created),
            apiKind:'image'
        });
        render({syncVirtualization:false,nodeIds:[created.id]});
        canvasPersistence.schedule();
    } else {
        return null;
    }
    createMenuGroupId = groupId;
    if(type !== 'group' && type !== 'frame') addCreatedNodeToMenuGroup(created);
    createMenuGroupId = '';
    if(smartContainer.reconcileFrames()){
        render();
        canvasPersistence.schedule();
    }
    if(type === 'frame') beginCreatedSmartFrameTitleEdit(created);
    return created;
}
function smartCanvasChromeTarget(target){
    return canvasInteraction.ownsTarget(target);
}
clickSparkFeedback?.install({root:shell});
function beginSmartTemporaryPanPointer(event){
    const middle = event.button === 1;
    const handLeft = event.button === 0 && smartEffectiveTool() === 'hand';
    if(!middle && !handLeft) return;
    if(smartCanvasChromeTarget(event.target)) return;
    if(canvasInteraction.active() || smartAnnotationStroke || portDragState || connectionEraseState) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    closeCreateMenu();
    closeSmartNodeContextMenu();
    if(middle){
        smartMiddlePan = true;
        refreshSmartAnnotationToolbar();
    }
    didPan = false;
    panState = {button:event.button, startX:event.clientX, startY:event.clientY, ox:viewport.x, oy:viewport.y};
    shell.classList.add('panning');
}
shell.addEventListener('click', () => {
    if(!pendingSmartTextEditNodeId) return;
    const nodeId = pendingSmartTextEditNodeId;
    pendingSmartTextEditNodeId = '';
    setTimeout(() => beginSmartTextAnnotationEdit(nodeId, {selectAll:false}), 0);
}, true);
shell.addEventListener('mousedown', event => {
    if(
        event.button !== 0
        || !selectedConnectionKey
        || event.target.closest('.conn-hit,.conn-cut')
    ) return;
    selectedConnectionKey = '';
    selectedConnectionPoint = null;
    refreshConnectionLayer();
}, true);
shell.addEventListener('mousedown', beginSmartTemporaryPanPointer, true);
shell.addEventListener('click', event => {
    if(smartCanvasChromeTarget(event.target)) return;
    if(smartEffectiveTool() !== 'hand' && !didPan) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
}, true);
shell.addEventListener('mousedown', event => {
    canvasInteraction.begin({kind:'draw-frame',event});
}, true);
shell.addEventListener('mousedown', beginSmartAnnotationPointer, true);
shell.addEventListener('mousemove', updateSmartAnnotationCursor, true);
shell.addEventListener('mouseleave', hideSmartAnnotationCursor, true);
shell.addEventListener('mousedown', e => {
    if(!zoomPreviewState) return;
    if(e.button !== 0) return;
    if(smartCanvasChromeTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
}, true);
shell.addEventListener('click', e => {
    if(!zoomPreviewState) return;
    if(e.button !== 0) return;
    if(smartCanvasChromeTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    const nodeEl = e.target.closest('.image-node');
    if(nodeEl?.dataset?.id){
        window.SmartCanvasModules.viewportSelection.viewport.zoomPreview({
            action:'exit-to-node',
            nodeId:nodeEl.dataset.id
        });
    } else {
        window.SmartCanvasModules.viewportSelection.viewport.zoomPreview({
            action:'exit',
            point:window.SmartCanvasModules.viewportSelection.viewport.screenToWorld(e)
        });
    }
}, true);
shell.onmousedown = e => {
    if(zoomPreviewState && e.button === 0 && !smartCanvasChromeTarget(e.target)) return;
    if(smartCanvasChromeTarget(e.target) || e.target.closest('.image-node')) return;
    closeReferenceGenerateMenu();
    closeCreateMenu();
    closeSmartNodeContextMenu();
    if(smartFrameToolActive && e.button === 0){
        canvasInteraction.begin({kind:'draw-frame',event:e});
        return;
    }
    if(e.button === 0 && e.shiftKey){
        e.preventDefault();
        didPan = false;
        connectionEraseState = {started:false, count:0, indices:new Set(), lastX:e.clientX, lastY:e.clientY, trail:[]};
        shell.classList.add('connection-erasing');
        updateConnectionEraseTrail(e);
        eraseConnectionsAtPoint(e);
        return;
    }
    if(e.button === 0 && isRKeyDown){
        e.preventDefault();
        didPan = false;
        selectionState = {startScreen:{x:e.clientX, y:e.clientY}, startWorld:window.SmartCanvasModules.viewportSelection.viewport.screenToWorld(e)};
        window.SmartCanvasModules.viewportSelection.selection.box.update(e);
        return;
    }
    if(e.button === 0 && (e.ctrlKey || e.metaKey)){
        e.preventDefault();
        didPan = false;
        selectionState = {startScreen:{x:e.clientX, y:e.clientY}, startWorld:window.SmartCanvasModules.viewportSelection.viewport.screenToWorld(e)};
        window.SmartCanvasModules.viewportSelection.selection.box.update(e);
        return;
    }
    if(e.button === 0 && smartEffectiveTool() === 'pointer'){
        e.preventDefault();
        didPan = false;
        selectionState = {startScreen:{x:e.clientX, y:e.clientY}, startWorld:window.SmartCanvasModules.viewportSelection.viewport.screenToWorld(e)};
        window.SmartCanvasModules.viewportSelection.selection.box.update(e);
    }
};
shell.addEventListener('mousedown', e => {
    if(e.button !== 2) return;
    const editor = promptNodeEditorSurface(e.target);
    contextMenuEditorState = editor
        ? {editor, wasActive:document.activeElement === editor}
        : null;
}, true);
shell.oncontextmenu = e => {
    if((e.ctrlKey || e.metaKey) || isRKeyDown){
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    const editable = isEditableTarget(e.target, {contextMenu:true});
    contextMenuEditorState = null;
    if(editable) return;
    if(didPan || smartCanvasChromeTarget(e.target)) return;
    if(imageStudio.isOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    const nodeEl = e.target.closest('.image-node');
    if(nodeEl?.dataset?.id){
        const nodeId = nodeEl.dataset.id;
        const currentIds = window.SmartCanvasModules.viewportSelection.selection.ids();
        if(!currentIds.includes(nodeId)){
            smartPlaybackPauseForSelection(nodeId, -1);
            selectedId = nodeId;
            selectedIds = [];
            selectedImage = {nodeId:'', index:-1};
        }
        const target = smartContextTargetFromEvent(e, nodeId);
        if(target.mediaIndex >= 0) selectedImage = {nodeId:target.mediaNodeId, index:target.mediaIndex};
        window.SmartCanvasModules.viewportSelection.selection.refresh();
        updateComposer();
        openSmartNodeContextMenu(e, target);
        return;
    }
    closeSmartNodeContextMenu();
    openCreateMenu(e, {allowPaste:true});
};
shell.ondblclick = e => {
    if(didPan || smartCanvasChromeTarget(e.target) || e.target.closest('.image-node')) return;
    if(imageStudio.isOpen()) return;
    e.preventDefault();
    openCreateMenu(e);
};
shell.onclick = e => {
    if(Date.now() < suppressSmartAnnotationClickUntil) return;
    if(selectionJustFinished) return;
    if(didPan || smartCanvasChromeTarget(e.target) || e.target.closest('.image-node')) return;
    if(imageStudio.isOpen()) return;
    if(smartComposerEditingSessionActive()) return;
    closeCreateMenu();
    closeSmartNodeContextMenu();
    selectedConnectionKey = '';
    selectedConnectionPoint = null;
    window.SmartCanvasModules.viewportSelection.selection.clear();
    render();
};
minimap?.addEventListener('ic-minimap-navigate', e => {
    const point = e.detail?.point;
    if(!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
    window.SmartCanvasModules.viewportSelection.viewport.centerOn(point);
});
customElements.whenDefined('ic-smart-minimap').then(() => {
    window.SmartCanvasModules.viewportSelection.viewport.refresh();
});
window.onmousemove = e => {
    lastMouseWorld = window.SmartCanvasModules.viewportSelection.viewport.screenToWorld(e);
    if(canvasInteraction.active()){
        e.preventDefault();
        canvasInteraction.move(e);
        return;
    }
    if(connectionEraseState){
        e.preventDefault();
        updateConnectionEraseTrail(e);
        eraseConnectionsAlongPointer(e);
        return;
    }
    if(portDragState){
        e.preventDefault();
        const distance = Math.hypot(
            e.clientX - portDragState.startClientX,
            e.clientY - portDragState.startClientY
        );
        if(!portDragState.moved && distance < 4) return;
        if(!portDragState.moved){
            shell.classList.add('port-dragging');
            setSmartNodeQuickAddPortDragging(true);
            ensurePortDragPathElement();
        }
        const p = window.SmartCanvasModules.viewportSelection.viewport.screenToWorld(e);
        portDragState.currentWorld = p;
        portDragState.moved = true;
        let {targetId, targetPort} = portDragState.multiInput
            ? smartMultiInputDropTarget(e,portDragState.multiInput)
            : smartPortDropTarget(
            e,
            portDragState.fromId,
            portDragState.fromPort
        );
        if(targetId){
            const compatible = (portDragState.fromPort === 'out' && targetPort === 'in') || (portDragState.fromPort === 'in' && targetPort === 'out');
            if(!compatible){ targetId = ''; targetPort = ''; }
        }
        portDragState.hoverTargetId = targetId;
        portDragState.hoverPort = targetPort;
        updatePortDragVisual();
        return;
    }
    if(selectionState){
        e.preventDefault();
        window.SmartCanvasModules.viewportSelection.selection.box.update(e);
        return;
    }
    if(previewCompareDrag){
        e.preventDefault();
        setPreviewComparePos(e.clientX);
        return;
    }
    if(panoramaState.drag){
        e.preventDefault();
        const dx = e.clientX - panoramaState.drag.clientX;
        const dy = e.clientY - panoramaState.drag.clientY;
        panoramaState.yaw = panoramaState.drag.yaw - dx * 0.18;
        panoramaState.pitch = Math.max(-85, Math.min(85, panoramaState.drag.pitch + dy * 0.18));
        document.getElementById('previewStage')?.classList.add('panning');
        return;
    }
    if(previewPanDrag){
        const stage = document.getElementById('previewStage');
        previewPan = {
            x:previewPanDrag.startX + (e.clientX - previewPanDrag.clientX),
            y:previewPanDrag.startY + (e.clientY - previewPanDrag.clientY)
        };
        stage?.classList.add('panning');
        applyPreviewTransform();
        return;
    }
    if(imageEditPanDrag){
        const stage = document.getElementById('imageEditStage');
        if(stage){
            stage.scrollLeft = imageEditPanDrag.scrollLeft - (e.clientX - imageEditPanDrag.clientX);
            stage.scrollTop = imageEditPanDrag.scrollTop - (e.clientY - imageEditPanDrag.clientY);
        }
        return;
    }
    if(cropDrag && cropState){
        const dx = e.clientX - cropDrag.sx;
        const dy = e.clientY - cropDrag.sy;
        if(cropDrag.mode === 'move'){
            cropState.x = cropDrag.start.x + dx;
            cropState.y = cropDrag.start.y + dy;
        } else if(cropDrag.mode === 'image'){
            cropState.x = cropDrag.start.x + dx;
            cropState.y = cropDrag.start.y + dy;
        } else {
            resizeCropFromDrag(dx, dy);
        }
        clampCrop();
        renderCropBox();
        return;
    }
    if(llmInstructionResizeState){
        const node = nodes.find(n => n.id === llmInstructionResizeState.id);
        if(!node) return;
        const dy = (e.clientY - llmInstructionResizeState.startY) / viewport.scale;
        const newInstrH = Math.max(PROMPT_LLM_INSTRUCTION_MIN_H, Math.min(PROMPT_LLM_INSTRUCTION_MAX_H, Math.round(llmInstructionResizeState.startH + dy)));
        node.llmInstructionHeight = newInstrH;
        // 只把“指令框的高度变化量”叠加到节点总高度上，保留用户手动拉大的上方区域，避免上方被重置变小。
        node.h = Math.max(promptNodeExpandedHeight(node), Math.round(llmInstructionResizeState.startNodeH + (newInstrH - llmInstructionResizeState.startH)));
        node.w = Math.max(Number(node.w) || 0, 316);
        node.scale = 1;
        syncNodeElementLayout(node);
        const ta = world.querySelector(`.image-node[data-id="${CSS.escape(node.id)}"] .prompt-llm-instruction`);
        if(ta) ta.style.height = `${promptLlmInstructionHeight(node)}px`;
        return;
    }
    if(promptSplitResizeState){
        const node = nodes.find(n => n.id === promptSplitResizeState.id);
        if(!node) return;
        const dy = (e.clientY - promptSplitResizeState.startY) / viewport.scale;
        const newPreviewH = Math.max(PROMPT_SPLIT_PREVIEW_MIN_H, Math.min(PROMPT_SPLIT_PREVIEW_MAX_H, Math.round(promptSplitResizeState.startH + dy)));
        node.promptSplitPreviewHeight = newPreviewH;
        node.h = Math.max(promptNodeMinHeight(node), Math.round(promptSplitResizeState.startNodeH + (newPreviewH - promptSplitResizeState.startH)));
        node.w = Math.max(Number(node.w) || 0, 316);
        node.scale = 1;
        syncNodeElementLayout(node);
        const list = world.querySelector(`.image-node[data-id="${CSS.escape(node.id)}"] .prompt-node-segments`);
        if(list) list.style.height = `${promptNodeSplitPreviewHeight(node)}px`;
        return;
    }
    if(panState){
        const dx = e.clientX - panState.startX;
        const dy = e.clientY - panState.startY;
        if(Math.abs(dx) + Math.abs(dy) > 3) didPan = true;
        viewport.x = panState.ox + dx;
        viewport.y = panState.oy + dy;
        window.SmartCanvasModules.viewportSelection.viewport.apply();
        return;
    }
};
window.onmouseup = e => {
    document.body.classList.remove('smart-node-drag');
    document.body.classList.remove('smart-node-resize');
    if(canvasInteraction.active()){
        canvasInteraction.end(e);
        return;
    }
    if(connectionEraseState){
        const changed = finishConnectionErase();
        connectionEraseState = null;
        shell.classList.remove('connection-erasing');
        clearConnectionEraseTrail();
        if(changed) canvasPersistence.schedule();
        return;
    }
    if(portDragState){
        const drag = portDragState;
        portDragState = null;
        shell.classList.remove('port-dragging');
        if(drag.sourceTrigger && drag.moved){
            drag.sourceTrigger._smartSuppressNextClick = true;
            setTimeout(() => {
                if(drag.sourceTrigger) delete drag.sourceTrigger._smartSuppressNextClick;
            }, 0);
        }
        const keepPortDragVisual = handlePortDrop(drag, e);
        if(!keepPortDragVisual) clearPortDragVisual();
        setSmartNodeQuickAddPortDragging(false);
        return;
    }
    if(selectionState) window.SmartCanvasModules.viewportSelection.selection.box.finish(e);
    if(previewCompareDrag) previewCompareDrag = false;
    if(panoramaState.drag){
        panoramaState.drag = null;
        document.getElementById('previewStage')?.classList.remove('panning');
    }
    if(previewPanDrag){
        previewPanDrag = null;
        document.getElementById('previewStage')?.classList.remove('panning');
    }
    if(imageEditPanDrag) imageEditPanDrag = null;
    if(cropDrag){
        document.getElementById('cropCanvas')?.classList.remove('dragging-image');
        cropDrag = null;
    }
    if(llmInstructionResizeState){
        const node = nodes.find(n => n.id === llmInstructionResizeState.id);
        const changed = node && promptLlmInstructionHeight(node) !== llmInstructionResizeState.startH;
        document.body.classList.remove('smart-node-resize', 'smart-llm-instr-resize');
        if(changed) canvasMutation.history({action:'commit'}); else canvasMutation.history({action:'discard'});
        llmInstructionResizeState = null;
        render();
        canvasPersistence.schedule();
    }
    if(promptSplitResizeState){
        const node = nodes.find(n => n.id === promptSplitResizeState.id);
        const changed = node && promptNodeSplitPreviewHeight(node) !== promptSplitResizeState.startH;
        document.body.classList.remove('smart-node-resize', 'smart-prompt-split-resize');
        if(changed) canvasMutation.history({action:'commit'}); else canvasMutation.history({action:'discard'});
        promptSplitResizeState = null;
        render();
        canvasPersistence.schedule();
    }
    if(panState) {
        const endedMiddlePan = panState.button === 1;
        panState = null;
        shell.classList.remove('panning');
        if(endedMiddlePan){
            smartMiddlePan = false;
            refreshSmartAnnotationToolbar();
        }
        canvasPersistence.schedule();
        setTimeout(() => { didPan = false; }, 0);
    }
};
function smartModalOwnsWheel(){
    return Boolean(
        composer?.classList.contains('focused')
        || imageStudio.isOpen()
        || document.querySelector('ic-dialog[open],ic-confirmation-dialog[open],.log-modal.open,.generation-log-modal.open,.smart-context-result-backdrop:not([hidden]),.reference-viewer-backdrop:not([hidden])')
    );
}
function localScrollableCanConsumeWheel(target, deltaY){
    let element = target instanceof Element ? target : target?.parentElement;
    while(element && element !== shell){
        const style = window.getComputedStyle(element);
        const scrollable = /(auto|scroll)/.test(style.overflowY || '')
            && element.scrollHeight > element.clientHeight + 1;
        if(scrollable){
            if(deltaY < 0 && element.scrollTop > 0) return true;
            if(deltaY > 0 && element.scrollTop + element.clientHeight < element.scrollHeight - 1) return true;
        }
        element = element.parentElement;
    }
    return false;
}
function localScrollableHasOverflow(target){
    let element = target instanceof Element ? target : target?.parentElement;
    while(element && element !== shell){
        const style = window.getComputedStyle(element);
        if(
            /(auto|scroll)/.test(style.overflowY || '')
            && element.scrollHeight > element.clientHeight + 1
        ) return true;
        element = element.parentElement;
    }
    return false;
}
function promptNodeWheelPriorityActive(target){
    const element = target instanceof Element ? target : target?.parentElement;
    const promptNode = element?.closest?.('.image-node.prompt-smart-node');
    if(!promptNode) return true;
    return window.SmartCanvasModules.viewportSelection.selection.has(promptNode.dataset.id || '');
}
function localEditorOwnsWheel(target, localHasOverflow=false){
    const element = target instanceof Element ? target : target?.parentElement;
    if(element?.closest?.('ic-mention-picker,.smart-canvas-text')) return true;
    if(!promptNodeWheelPriorityActive(element)) return false;
    return Boolean(localHasOverflow && element?.closest?.(
        '.image-node.prompt-smart-node,.prompt-node-text,.prompt-llm-instruction,'
        + '.prompt-node-llm textarea,ic-prompt-composer'
    ));
}
function applySmartCanvasViewportZoom(factor, point=null){
    const numericFactor = Number(factor);
    if(!Number.isFinite(numericFactor) || numericFactor <= 0) return false;
    const rect = shell.getBoundingClientRect();
    const pointX = Number(point?.clientX);
    const pointY = Number(point?.clientY);
    const sx = Number.isFinite(pointX) ? pointX - rect.left : shell.clientWidth / 2;
    const sy = Number.isFinite(pointY) ? pointY - rect.top : shell.clientHeight / 2;
    const currentScale = safeScale(viewport.scale);
    const before = {
        x:(sx - viewport.x) / currentScale,
        y:(sy - viewport.y) / currentScale
    };
    const nextScale = safeScale(currentScale * numericFactor);
    if(nextScale === currentScale) return false;
    viewport.scale = nextScale;
    viewport.x = sx - before.x * viewport.scale;
    viewport.y = sy - before.y * viewport.scale;
    window.SmartCanvasModules.viewportSelection.viewport.apply();
    return true;
}
function smartCanvasKeyboardZoomDirection(event){
    if(!(event.ctrlKey || event.metaKey) || event.altKey) return 0;
    if(event.code === 'Equal' || event.code === 'NumpadAdd') return 1;
    if(event.code === 'Minus' || event.code === 'NumpadSubtract') return -1;
    if(event.key === '+' || event.key === '=' || event.key === 'Add') return 1;
    if(event.key === '-' || event.key === '_' || event.key === 'Subtract') return -1;
    return 0;
}
shell.addEventListener('wheel', e => {
    const modifier = Boolean(e.metaKey || e.ctrlKey);
    const modal = smartModalOwnsWheel();
    const wheelTarget = e.target instanceof Element ? e.target : e.target?.parentElement;
    const farPresentation = Boolean(wheelTarget?.closest?.('.canvas-lod-node-far'));
    const localCanScroll = promptNodeWheelPriorityActive(wheelTarget)
        && localScrollableCanConsumeWheel(e.target, e.deltaY);
    const localHasOverflow = localScrollableHasOverflow(e.target);
    const localOwnsWheel = !modifier
        && smartEffectiveTool() !== 'hand'
        && localEditorOwnsWheel(e.target, localHasOverflow);
    const wheelIntent = promptAuthoring.wheelIntent({
        modal,
        modifier,
        farPresentation,
        localCanScroll,
        localOwnsWheel
    });
    if(wheelIntent === 'local'){
        if(!localCanScroll) e.preventDefault();
        e.stopPropagation();
        return;
    }
    if(wheelIntent === 'modal'){
        if(!localCanScroll) e.preventDefault();
        e.stopPropagation();
        return;
    }
    closeSmartNodeContextMenu();
    e.preventDefault();
    if(wheelIntent === 'pan'){
        viewport.x -= Number(e.deltaX || 0) * smartCanvasPanSpeed;
        viewport.y -= Number(e.deltaY || 0) * smartCanvasPanSpeed;
        window.SmartCanvasModules.viewportSelection.viewport.apply();
        return;
    }
    const factor = canvasWheelZoomFactor(e, shell.clientHeight || window.innerHeight || 800);
    applySmartCanvasViewportZoom(factor, e);
}, {passive:false});
window.addEventListener('resize', () => {
    closeSmartNodeContextMenu();
    scheduleSmartAdaptiveImageResolution();
});
shell.ondragover = e => setSmartDropCopyEffect(e, true);
shell.ondrop = async e => {
    e.preventDefault();
    if(e.target.closest('.image-node')) return;
    const p = window.SmartCanvasModules.viewportSelection.viewport.screenToWorld(e);
    const assetRaw = e.dataTransfer.getData('application/x-smart-asset');
    if(assetRaw){
        try {
            const asset = JSON.parse(assetRaw);
            if(asset?.url) {
                canvasMutation.history({action:'push'});
                createImageNodeAt(p, [assetNodeImageFromItem(asset)], {skipUndo:true});
                if(smartContainer.reconcileFrames()) render();
            }
            return;
        } catch {}
    }
    notifyUnsupportedSmartUploadDrop(e.dataTransfer);
    const payload = await resolveSmartImageDropPayload(e.dataTransfer);
    if(payload.type === 'none') return;
    await handleSmartImageDropPayload(payload, '', {point:p, forceNew:true});
    if(smartContainer.reconcileFrames()) render();
    canvasPersistence.schedule();
};
window.addEventListener('copy', e => {
    if(nodeClipboardCopyRequested){
        copySelectedNodes(e);
        return;
    }
    invalidateNodeClipboard();
});
window.addEventListener('cut', invalidateNodeClipboard);
window.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])].filter(isSupportedUploadFile);
    if(files.length){
        e.preventDefault();
        invalidateNodeClipboard();
        handleFiles(files, selectedId);
        return;
    }
    const editable = isEditableTarget(e.target);
    const clipboard = availableNodeClipboard();
    const marker = smartClipboardOwnership.readMarker(e.clipboardData);
    if(smartClipboardOwnership.matches(marker, clipboard)){
        if(editable) return;
        e.preventDefault();
        pasteNodes(null, {clipboard});
        return;
    }
    invalidateNodeClipboard();
    if(!editable) e.preventDefault();
});
window.addEventListener('keydown', e => {
    if(!imageStudio.isOpen() || imageEditMode !== 'preview' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
    if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(!seekPreviewVideoFrames(e.key === 'ArrowLeft' ? -1 : 1)){
        navigatePreviewImage(e.key === 'ArrowLeft' ? -1 : 1);
    }
}, true);
window.addEventListener('keydown', e => {
    const key = String(e.key || '').toLowerCase();
    if(document.querySelector('ic-dialog[open],ic-confirmation-dialog[open]')) return;
    if(isPromptTemplatePanelOpen()) return;
    const keyboardZoomDirection = smartCanvasKeyboardZoomDirection(e);
    if(keyboardZoomDirection && !smartModalOwnsWheel() && !isEditableTarget(e.target)){
        e.preventDefault();
        closeSmartNodeContextMenu();
        const step = Math.pow(SMART_CANVAS_KEYBOARD_ZOOM_FACTOR, smartCanvasZoomSpeed);
        applySmartCanvasViewportZoom(keyboardZoomDirection > 0 ? step : 1 / step);
        return;
    }
    if(e.key === 'Escape' && !smartContextResultBackdrop?.hidden){
        e.preventDefault();
        closeSmartContextResult();
        return;
    }
    if(e.key === 'Escape' && smartNodeContextMenu?.hasAttribute('open')){
        e.preventDefault();
        closeSmartNodeContextMenu();
        return;
    }
    if((e.key === 'ContextMenu' || (e.shiftKey && key === 'f10')) && !isEditableTarget(e.target)){
        const ids = window.SmartCanvasModules.viewportSelection.selection.ids();
        if(ids.length === 1){
            e.preventDefault();
            const node = nodes.find(item => item.id === ids[0]);
            const rect = node ? nodeRect(node) : null;
            if(rect){
                const synthetic = {
                    clientX:viewport.x + (rect.x + Math.min(rect.width, 36)) * viewport.scale,
                    clientY:viewport.y + (rect.y + Math.min(rect.height, 36)) * viewport.scale
                };
                openSmartNodeContextMenu(synthetic, {
                    nodeId:node.id,
                    mediaNodeId:selectedImage.nodeId || node.id,
                    mediaIndex:selectedImage.nodeId ? selectedImage.index : -1
                });
            }
        }
        return;
    }
    if(e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target)){
        if(smartMultiInputOwnsSpace(e)) return;
        if(e.repeat) return;
        if(smartPlaybackToggleSelectedVideo()){
            e.preventDefault();
            return;
        }
        e.preventDefault();
        smartSpacePan = true;
        closeSmartNodeContextMenu();
        hideSmartAnnotationCursor();
        refreshSmartAnnotationToolbar();
        return;
    }
    if(e.key === 'Escape' && canvasInteraction.active()){
        e.preventDefault();
        const interaction = canvasInteraction.active();
        canvasInteraction.cancel({reason:'escape',event:e});
        if(interaction?.kind === 'draw-frame'){
            deactivateSmartFrameTool();
        }
        return;
    }
    if(e.key === 'Escape' && smartFrameToolActive && !isEditableTarget(e.target)){
        e.preventDefault();
        deactivateSmartFrameTool();
        return;
    }
    if(e.key === 'Escape' && smartAnnotationStroke){
        cancelSmartAnnotationStroke();
        return;
    }
    if(e.key === 'Escape' && smartAnnotationTool && !isEditableTarget(e.target)){
        deactivateSmartAnnotationTool();
        return;
    }
    if(e.key === 'Escape' && !isEditableTarget(e.target) && clearSelectedSmartTextAnnotation()){
        e.preventDefault();
        return;
    }
    if(!e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target) && (key === 'v' || key === 'h')){
        if(e.repeat) return;
        e.preventDefault();
        setSmartBaseTool(key === 'h' ? 'hand' : 'pointer');
        focusSmartCanvasAfterToolShortcut();
        return;
    }
    if(!e.ctrlKey && !e.metaKey && !e.altKey && e.shiftKey && key === 's' && !isEditableTarget(e.target)){
        if(e.repeat) return;
        e.preventDefault();
        activateSmartFrameTool();
        return;
    }
    if(!e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target) && (key === 'p' || key === 't')){
        if(e.repeat) return;
        e.preventDefault();
        activateSmartAnnotationTool(key === 'p' ? 'brush' : 'text');
        focusSmartCanvasAfterToolShortcut();
        return;
    }
    if(key === 'r' && !isEditableTarget(e.target)) isRKeyDown = true;
    if(imageStudio.isOpen() && !e.defaultPrevented && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target)){
        if(e.key === 'ArrowLeft' || e.key === 'ArrowRight'){
            e.preventDefault();
            if(imageEditMode !== 'preview' || !seekPreviewVideoFrames(e.key === 'ArrowLeft' ? -1 : 1)){
                navigatePreviewImage(e.key === 'ArrowLeft' ? -1 : 1);
            }
            return;
        }
    }
    if(!e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target)){
        if(key === 'z'){
            if(e.repeat) return;
            e.preventDefault();
            window.SmartCanvasModules.viewportSelection.viewport.zoomPreview();
            return;
        }
    }
    if((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && key === 'c' && !isEditableTarget(e.target)){
        const item = smartSelectedCopyImageItem();
        if(!item) return;
        e.preventDefault();
        closeSmartNodeContextMenu();
        copySmartImageToClipboard(item);
        return;
    }
    if((e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'c' && !isEditableTarget(e.target)){
        const selectionText = window.getSelection?.().toString() || '';
        if(selectionText) return;
        e.preventDefault();
        copySelectedNodes();
        return;
    }
    if((e.ctrlKey || e.metaKey) && key === 'd' && !isEditableTarget(e.target)){
        e.preventDefault();
        canvasMutation.duplicate({
            nodeIds:smartContainer.expand(window.SmartCanvasModules.viewportSelection.selection.ids()),
            mode:'offset',
            preserveConnections:true,
            message:tr('smart.nodesCreated')
        });
        return;
    }
    if(e.key === 'Escape' && imageStudio.isOpen()){
        imageStudio.close();
        return;
    }
    if((e.ctrlKey || e.metaKey) && key === 'z' && !isEditableTarget(e.target)){
        e.preventDefault();
        canvasMutation.history({action:e.shiftKey ? 'redo' : 'undo'});
        return;
    }
    if((e.key === 'Delete' || e.key === 'Backspace') && (selectedId || selectedIds.length) && !isEditableTarget(e.target) && !smartComposerEditingSessionActive()){
        e.preventDefault();
        deleteSelectedSmartSelection({preserveFrameContents:Boolean(e.ctrlKey || e.metaKey)});
        return;
    }
    if((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'g' && !isEditableTarget(e.target)){
        e.preventDefault();
        const ids = selectedIds.length ? selectedIds.slice() : (selectedId ? [selectedId] : []);
        const ok = ids.map(id => {
            const node = nodes.find(item => item.id === id);
            return smartContainer.isGroup(node)
                ? smartContainer.ungroup(id)
                : ungroupNode(id);
        }).some(Boolean);
        if(ok) return;
    }
    if((e.ctrlKey || e.metaKey) && key === 'g' && !e.shiftKey && !isEditableTarget(e.target)){
        e.preventDefault();
        smartContainer.group(window.SmartCanvasModules.viewportSelection.selection.ids());
    }
});
window.addEventListener('keyup', e => {
    if(String(e.key || '').toLowerCase() === 'r') isRKeyDown = false;
    if(e.code === 'Space' && smartSpacePan){
        smartSpacePan = false;
        refreshSmartAnnotationToolbar();
    }
});
window.addEventListener('blur', () => {
    smartPlaybackPauseForInterruption('window-blur');
    isRKeyDown = false;
    smartSpacePan = false;
    smartMiddlePan = false;
    panState = null;
    shell?.classList.remove('panning');
    refreshSmartAnnotationToolbar();
    hideSmartAnnotationCursor();
});
document.addEventListener('visibilitychange', () => {
    if(!document.hidden) return;
    smartPlaybackPauseForInterruption('visibility');
    smartSpacePan = false;
    smartMiddlePan = false;
    panState = null;
    shell?.classList.remove('panning');
    refreshSmartAnnotationToolbar();
});
window.addEventListener('pagehide', () => smartPlaybackPauseForInterruption('pagehide'));
document.addEventListener('ic-show', event => {
    const dialog = event.target?.closest?.('ic-dialog,ic-confirmation-dialog') || event.target;
    if(!dialog?.matches?.('ic-dialog,ic-confirmation-dialog')) return;
    if(dialog === imageEditModal) return;
    smartPlaybackPauseForInterruption('dialog');
}, true);
engineSelect.onchange = () => {
    settings.engine = engineSelect.value;
    applyRecentSmartSettingsForCurrentMode();
    settings = constrainSmartNodeGenerationSettings(activeComposerNode(), settings);
    syncApiKindToggleVisibility();
    renderDynamicParams();
    loadSmartVideoCapabilityForCurrentSettings().then(() => renderDynamicParams()).catch(() => {});
    persistActiveSmartSettings();
    canvasPersistence.schedule();
};
function syncApiKindToggleVisibility(){
    if(!apiKindToggle) return;
    apiKindToggle.style.display = isApiLikeEngine(settings.engine) ? 'inline-block' : 'none';
    const kind = settings.apiKind === 'video' ? 'video' : 'image';
    const forcedKind = smartNodeGenerationEligibility(activeComposerNode()).forcedApiKind;
    const labelKey = kind === 'video' ? 'smart.kindVideoGeneration' : 'smart.kindImageGeneration';
    const actionKey = kind === 'video' ? 'smart.switchToImageGeneration' : 'smart.switchToVideoGeneration';
    apiKindToggle.disabled = Boolean(forcedKind);
    apiKindToggle.value = kind;
    apiKindToggle.dataset.value = kind;
    apiKindToggle.dataset.i18nAriaLabel = forcedKind ? labelKey : actionKey;
    apiKindToggle.setAttribute('aria-label', tr(forcedKind ? labelKey : actionKey));
    if(apiKindIcon) apiKindIcon.name = kind === 'video' ? 'video-generate' : 'image-generate';
    if(apiKindLabel){
        apiKindLabel.dataset.i18n = labelKey;
        apiKindLabel.textContent = tr(labelKey);
    }
}
if(apiKindToggle){
    apiKindToggle.onclick = event => {
        event.stopPropagation();
        if(smartNodeGenerationEligibility(activeComposerNode()).forcedApiKind) return;
        const kind = apiKindToggle.value === 'video' ? 'image' : 'video';
        settings.apiKind = kind;
        applyRecentSmartSettingsForCurrentMode();
        syncApiKindToggleVisibility();
        renderDynamicParams();
        renderInputThumbsRow(activeComposerNode() || window.SmartCanvasModules.viewportSelection.selection.node());
        loadSmartVideoCapabilityForCurrentSettings().then(() => renderDynamicParams()).catch(() => {});
        persistActiveSmartSettings();
        canvasPersistence.schedule();
    };
}
runBtn.onclick = () => generationRun.run();
fileInput?.addEventListener('ic-change', event => {
    const groupPoint = pendingGroupUploadPoint;
    const files = [...(event.detail?.acceptedFiles || [])];
    if(!files.length){
        pendingGroupUploadPoint = null;
        uploadTargetId = '';
        return;
    }
    const targetId = groupPoint ? '' : (uploadTargetId || selectedId);
    void handleFiles(files, targetId, groupPoint ? {point:groupPoint} : {}).finally(() => {
        fileInput.clear({silent:true});
    });
    pendingGroupUploadPoint = null;
    uploadTargetId = '';
});
fileInput?.addEventListener('ic-reject', event => {
    const first = event.detail?.rejectedFiles?.[0];
    if(first?.message) toast(first.message, {tone:'warning'});
});
smartPointerTool?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    setSmartBaseTool('pointer');
});
smartHandTool?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    setSmartBaseTool('hand');
});
smartBrushTool?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    setSmartAnnotationTool('brush');
});
smartTextTool?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    setSmartAnnotationTool('text');
});
smartFrameTool?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    activateSmartFrameTool();
});
smartSettingsToggle?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    smartSettingsOpen = !smartSettingsOpen;
    smartAnnotationOptionsOpen = false;
    refreshSmartAnnotationToolbar();
    refreshSmartCanvasSettings();
});
smartCanvasThemeToggle?.addEventListener('click', event => {
    event.stopPropagation();
    const dark = document.documentElement.dataset.uiTheme === 'dark'
        || document.documentElement.classList.contains('theme-dark');
    const theme = dark ? 'light' : 'dark';
    if(window.StudioTheme?.set){
        window.StudioTheme.set(theme);
        return;
    }
    try {
        localStorage.setItem('studio_theme', theme);
        localStorage.setItem('canvas_theme', theme);
    } catch(error) {}
    applyTheme(theme);
});
smartImagePerformanceToggle?.addEventListener('change', event => {
    event.stopPropagation();
    setSmartImagePerformanceOptimization(event.currentTarget.checked);
});
smartCanvasZoomSpeedInput?.addEventListener('input', event => {
    event.stopPropagation();
    setSmartCanvasInteractionSpeed('zoom', event.currentTarget.value);
});
smartCanvasPanSpeedInput?.addEventListener('input', event => {
    event.stopPropagation();
    setSmartCanvasInteractionSpeed('pan', event.currentTarget.value);
});
smartCanvasDockPositionControl?.addEventListener('ic-change', event => {
    event.stopPropagation();
    applySmartCanvasDockPosition(event.detail?.value || event.currentTarget.getAttribute('value'), {persist:true});
});
smartGenerationBatchLayoutControl?.addEventListener('ic-change', event => {
    event.stopPropagation();
    smartGenerationBatchLayout = (event.detail?.value || event.currentTarget.getAttribute('value')) === 'vertical'
        ? 'vertical'
        : 'horizontal';
    if(canvas){
        canvas.settings = {
            ...(canvas.settings || {}),
            generationBatchLayout:smartGenerationBatchLayout
        };
    }
    refreshSmartCanvasSettings();
    canvasPersistence.schedule();
});
smartCanvasDock?.addEventListener('click', event => {
    if(event.target.closest?.('#smartSettingsToggle, #smartSettingsPanel')) return;
    closeSmartCanvasSettings();
}, true);
smartBrushOptions?.querySelectorAll('[data-smart-brush-size]').forEach(button => {
    button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        smartBrushSize = Math.max(1, Number(button.dataset.smartBrushSize || 6));
        smartAnnotationOptionsOpen = false;
        refreshSmartAnnotationToolbar();
    });
});
smartBrushOptions?.querySelectorAll('[data-smart-brush-color]').forEach(button => {
    button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        smartBrushColor = String(button.dataset.smartBrushColor || '#111827');
        smartAnnotationOptionsOpen = false;
        refreshSmartAnnotationToolbar();
    });
});
smartTextOptions?.querySelectorAll('[data-smart-text-size]').forEach(button => {
    button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const nextSize = button.dataset.smartTextSize || 'medium';
        const selectedText = selectedSmartTextAnnotationNode();
        smartTextSize = nextSize;
        smartAnnotationOptionsOpen = false;
        if(selectedText && selectedText.textSize !== nextSize){
            canvasMutation.history({action:'push'});
            selectedText.textSize = nextSize;
            render();
            requestAnimationFrame(() => {
                const text = world.querySelector(
                    `.image-node[data-id="${CSS.escape(selectedText.id)}"] .smart-canvas-text`
                );
                syncSmartTextAnnotationSize(selectedText, text);
                window.SmartCanvasModules.viewportSelection.viewport.refresh();
            });
            canvasPersistence.schedule();
            return;
        }
        refreshSmartAnnotationToolbar();
    });
});
document.addEventListener('mousedown', event => {
    if(event.target.closest?.('.smart-canvas-dock,.smart-text-options')) return;
    if(smartCanvasTaskDialogOpen()) return;
    closeSmartCanvasSettings();
    if(!smartAnnotationOptionsOpen) return;
    smartAnnotationOptionsOpen = false;
    refreshSmartAnnotationToolbar();
});
applySmartCanvasDockPosition(smartCanvasDockPosition);
refreshSmartAnnotationToolbar();
refreshSmartCanvasSettings();
if(promptTemplateDockToggle) promptTemplateDockToggle.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    if(isPromptTemplatePanelOpen() && promptTemplatePanel.dataset.target === 'library'){
        closePromptTemplatePanel();
        return;
    }
    openPromptTemplatePanel('', promptTemplateSelectedId, {target:'library'});
};
workspaceAssetDockToggle?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if(workspaceAssetDialog?.open) closeWorkspaceAssetLibrary();
    else openWorkspaceAssetLibrary();
});
workspaceAssetDialog?.addEventListener('ic-hide', closeWorkspaceAssetLibrary);
workspaceAssetPanel?.addEventListener('ic-asset-insert', event => {
    const item = event.detail?.item;
    insertWorkspaceAssetIntoCanvas(item);
});
smartCanvasTaskDialogs();
promptTemplatePanel?.addEventListener('ic-library-change', async event => {
    const requestedLibraryId = event.detail?.libraryId === 'common' ? 'common' : 'canvas';
    activePromptLibraryId = requestedLibraryId;
    promptTemplateSelectedId = '';
    promptTemplateCategory = 'all';
    promptTemplatePanel.closeEditor?.();
    promptTemplatePanel.busy = true;
    try { await loadPromptTemplates(); } catch(error){}
    finally { promptTemplatePanel.busy = false; }
    if(promptLibraries.some(library => library.id === requestedLibraryId)) activePromptLibraryId = requestedLibraryId;
    renderPromptTemplatePanel();
    if(event.detail?.action === 'create-category' && requestedLibraryId === 'common') promptTemplatePanel?.openCategoryEditor?.('create');
});
promptTemplatePanel?.addEventListener('ic-category-change', event => {
    promptTemplateCategory = event.detail?.categoryId || 'all';
    promptTemplateSelectedId = '';
    promptTemplatePanel.closeEditor?.();
    renderPromptTemplatePanel();
});
promptTemplatePanel?.addEventListener('ic-template-select', event => {
    promptTemplateSelectedId = event.detail?.templateId || '';
    activatePromptTemplateFromPanel(promptTemplateSelectedId);
});
promptTemplatePanel?.addEventListener('ic-template-copy', event => {
    copyPromptTemplateToCanvas(event.detail?.templateId || '');
});
promptTemplatePanel?.addEventListener('ic-template-promote', event => promotePromptTemplateToCommon(event.detail || {}));
promptTemplatePanel?.addEventListener('ic-template-create', event => {
    savePromptTemplateEdit({...event.detail, creating:true});
});
promptTemplatePanel?.addEventListener('ic-template-edit', event => {
    savePromptTemplateEdit({...event.detail, creating:false});
});
promptTemplatePanel?.addEventListener('ic-template-move', event => {
    movePromptTemplateToCategory(event.detail || {});
});
promptTemplatePanel?.addEventListener('ic-template-delete', event => {
    deletePromptTemplate(event.detail?.templateId || '');
});
promptTemplatePanel?.addEventListener('ic-template-reorder', event => {
    if(event.detail?.scope === 'categories') persistPromptTemplateGroupOrder(event.detail.categoryIds || []);
});
promptTemplatePanel?.addEventListener('ic-category-create', event => createPromptTemplateGroup(event.detail || {}));
promptTemplatePanel?.addEventListener('ic-category-edit', event => renamePromptTemplateGroup(event.detail || {}));
promptTemplatePanel?.addEventListener('ic-category-delete', event => deletePromptTemplateGroup(event.detail?.categoryId || ''));
promptTemplatePanel?.addEventListener('ic-close', closePromptTemplatePanel);
promptTemplateDialog?.addEventListener('ic-hide', closePromptTemplatePanel);
if(composerTemplateBtn) composerTemplateBtn.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    if(isPromptTemplatePanelOpen() && promptTemplatePanel.dataset.target === 'composer'){
        closePromptTemplatePanel();
        return;
    }
    openPromptTemplatePanel(activeComposerNode()?.id || window.SmartCanvasModules.viewportSelection.selection.node()?.id || '', promptTemplateSelectedId, {target:'composer'});
};
referenceGenerateMenu?.addEventListener('ic-select', event => {
    event.stopPropagation();
    createReferencedNodeFromMenu(event.detail?.value || 'image');
});
multiReferenceGenerateMenu?.addEventListener('ic-select', event => {
    createReferencedNodeFromMenu(event.detail?.value);
});
multiReferenceGenerateMenu?.addEventListener('ic-hide', () => {
    if(referenceGenerateMenuState?.drag?.multiInput) closeReferenceGenerateMenu({restoreFocus:true});
});
upstreamInputMenu?.addEventListener('ic-select', event => {
    event.stopPropagation();
    createReferencedNodeFromMenu(event.detail?.value || 'text');
});
referenceGenerateMenu?.addEventListener('ic-hide', () => {
    if(referenceGenerateMenuState) closeReferenceGenerateMenu();
});
upstreamInputMenu?.addEventListener('ic-hide', () => {
    if(referenceGenerateMenuState) closeReferenceGenerateMenu();
});
createMenu?.addEventListener('mousedown', event => event.stopPropagation());
createMenu?.addEventListener('ic-select', event => {
    event.stopPropagation();
    const type = event.detail?.value;
    if(type) createNodeFromMenu(type);
});
function smartCanvasSelectionPointerTarget(target){
    return target === shell
        || target === world
        || Boolean(target?.closest?.('.image-node, .smart-multi-selection-box'));
}
function focusSmartCanvasFromSelectionPointer(event){
    if(event.button !== 0 || !smartCanvasSelectionPointerTarget(event.target)) return false;
    if(isEditableTarget(event.target)) return false;
    shell?.focus?.({preventScroll:true});
    return true;
}
window.addEventListener('mousedown', event => {
    smartComposerPointerOwner = smartComposerInteractionTarget(event.target)
        ? 'composer'
        : 'canvas';
    focusSmartCanvasFromSelectionPointer(event);
}, true);
window.addEventListener('mouseup', () => {
    setTimeout(() => { smartComposerPointerOwner = ''; }, 0);
}, true);
composer.addEventListener('pointerdown', event => event.stopPropagation());
composer.addEventListener('mousedown', event => event.stopPropagation());
// Composer popovers stay inside this DOM subtree, so wheel events stop here
// while native scrolling still works for the prompt and scrollable menus.
composer.addEventListener('wheel', event => event.stopPropagation(), {passive:false});
referenceFileInput?.addEventListener('change', event => {
    uploadLocalReferences(event.currentTarget.files || []);
});
composer.addEventListener('click', event => {
    if(!event.target.closest('ic-mention-picker') && !event.target.closest('[data-input-add-reference]')) closeMentionPicker();
}, true);
composer.addEventListener('click', event => {
    event.stopPropagation();
});
bindPromptCharacterCount(promptInput);
composerFocusToggle?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    setPromptAuthoringFocused(!composer.classList.contains('focused'));
});
composerFocusBackdrop?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
});
promptInput.addEventListener('input', event => maybeOpenMentionPicker(promptInput, activeComposerNode(), {
    allowOpen:promptAuthoring.quickOpenIntent(event)
}));
promptInput.addEventListener('compositionstart', () => {
    promptQuickComposing = true;
});
promptInput.addEventListener('compositionend', event => {
    promptQuickComposing = false;
    maybeOpenMentionPicker(promptInput, activeComposerNode(), {
        allowOpen:promptAuthoring.quickOpenIntent({
            data:event.data,
            inputType:'insertText'
        })
    });
});
promptInput.addEventListener('input', () => {
    delete promptInput.dataset.restoredGenerationSnapshotFor;
    delete promptInput.dataset.preserveDraftOnce;
    savePromptDraftForCurrent();
    renderInputThumbsRow(window.SmartCanvasModules.viewportSelection.selection.node());
    canvasPersistence.schedule();
    syncPromptAuthoringHeight();
});
promptInput.addEventListener('keyup', event => {
    if(event.key === 'Escape' || event.key === 'ArrowDown' || event.key === 'ArrowUp') return;
    maybeOpenMentionPicker(promptInput, activeComposerNode());
});
promptInput.addEventListener('mouseup', () => saveMentionRange(promptInput));
promptInput.addEventListener('focus', () => {
    saveMentionRange(promptInput);
    setSmartPromptAuthoringPin(activeComposerNode()?.id || '');
});
promptInput.addEventListener('blur', () => setSmartPromptAuthoringPin(''));
promptInput.addEventListener('keydown', event => {
    handlePromptQuickPickerKeydown(event, promptInput);
});
promptInput.addEventListener('click', event => {
    const referenceToken = event.target.closest?.('.mention-image-token');
    if(referenceToken){
        event.preventDefault();
        event.stopPropagation();
        openReferenceViewer(referenceDataFromElement(referenceToken));
        return;
    }
});
promptInput.addEventListener('mouseover', event => {
    const token = event.target.closest?.('.mention-image-token');
    if(!token) return;
    showReferenceHoverPreview(token, referenceDataFromElement(token));
});
promptInput.addEventListener('mouseout', event => {
    if(event.target.closest?.('.mention-image-token')) hideReferenceHoverPreview();
});
mentionPreview?.addEventListener('mouseenter', () => clearTimeout(referenceHoverHideTimer));
mentionPreview?.addEventListener('mouseleave', hideReferenceHoverPreview);
mentionPreview?.addEventListener('click', event => {
    if(!event.target.closest('[data-reference-viewer-open]')) return;
    openReferenceViewer(referenceDataFromElement(mentionPreview));
});
referenceViewerClose?.addEventListener('click', closeReferenceViewer);
referenceViewerBackdrop?.addEventListener('click', event => {
    if(event.target === referenceViewerBackdrop) closeReferenceViewer();
});
mentionPicker.addEventListener('mousedown', event => event.stopPropagation());
mentionPicker.addEventListener('ic-tab-change', event => {
    if(promptQuickPickerMode !== 'input') return;
    mentionSourceTab = event.detail?.value === 'assets' ? 'assets' : 'canvas';
    if(mentionSourceTab === 'assets') loadMentionAssetPage({reset:true});
    else renderMentionPicker();
});
mentionPicker.addEventListener('ic-load-more', () => {
    if(promptQuickPickerMode !== 'input') return;
    if(mentionSourceTab === 'assets'){
        loadMentionAssetPage();
        return;
    }
    mentionCanvasOffset += 60;
    renderMentionPicker();
});
mentionPicker.addEventListener('ic-retry', () => {
    if(promptQuickPickerMode === 'input' && mentionSourceTab === 'assets') loadMentionAssetPage({reset:true});
});
mentionPicker.addEventListener('ic-select', event => {
    const item = promptQuickPickerItems[Number(event.detail?.index)];
    if(promptQuickPickerMode === 'input') selectMentionReference(item);
    else if(promptQuickPickerMode === 'template') insertPromptTemplateText(item);
});
mentionPicker.addEventListener('ic-hide', () => {
    if(promptQuickPickerMode) resetMentionPickerSession();
});
document.addEventListener('click', event => {
    if(!event.target.closest('ic-mention-picker') && !event.target.closest('[data-input-add-reference]')) closeMentionPicker();
});
promptNodeFocusSurface?.addEventListener('ic-dismiss', () => {
    setPromptNodeFocused('', false);
});
document.addEventListener('keydown', event => {
    if(event.key === 'Escape') {
        if(smartLogModal?.hasAttribute('open')) return;
        if(smartCanvasTaskDialogOpen()) return;
        if(referenceViewerBackdrop && !referenceViewerBackdrop.hidden){
            event.preventDefault();
            closeReferenceViewer();
            return;
        }
        if(composer.classList.contains('focused')){
            event.preventDefault();
            setPromptAuthoringFocused(false);
            return;
        }
        closeSmartLogLightbox(); closeCreateMenu(); closeReferenceGenerateMenu(); closeSmartCanvasLog(); closeSmartCanvasSettings(); closePromptTemplatePanel();
    }
});
function cropDragModeFromPointer(event){
    const explicit = event.target.closest?.('[data-crop-handle]')?.dataset?.cropHandle;
    if(explicit) return `crop-${explicit}`;
    if(imageEditMode !== 'crop') return 'move';
    const box = document.getElementById('cropBox');
    const rect = box?.getBoundingClientRect?.();
    if(!rect) return 'move';
    const slop = 16;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nearL = x <= slop;
    const nearR = rect.width - x <= slop;
    const nearT = y <= slop;
    const nearB = rect.height - y <= slop;
    if(nearT && nearL) return 'crop-nw';
    if(nearT && nearR) return 'crop-ne';
    if(nearB && nearL) return 'crop-sw';
    if(nearB && nearR) return 'crop-se';
    if(nearT) return 'crop-n';
    if(nearR) return 'crop-e';
    if(nearB) return 'crop-s';
    if(nearL) return 'crop-w';
    return 'move';
}
document.getElementById('cropBox').addEventListener('mousedown', event => beginCropDrag(event, cropDragModeFromPointer(event)));
document.querySelectorAll('[data-crop-handle]').forEach(handle => {
    handle.addEventListener('mousedown', event => beginCropDrag(event, `crop-${handle.dataset.cropHandle || 'se'}`));
});
const cropRatioControl = document.getElementById('cropRatioTabs');
const applyCropRatioControl = event => {
    event.stopPropagation();
    setCropAspectPreset(event.detail?.value || event.currentTarget?.value || event.target?.value || event.currentTarget?.getAttribute?.('value') || 'free');
};
cropRatioControl?.addEventListener('ic-change', applyCropRatioControl);
cropRatioControl?.addEventListener('input', applyCropRatioControl);
cropRatioControl?.addEventListener('change', applyCropRatioControl);
const imageEditModeToolbar = document.getElementById('imageEditModeToolbar');
imageEditModeToolbar?.addEventListener('click', event => {
    const button = event.target.closest?.('[data-image-edit-mode]');
    if(!button) return;
    event.stopPropagation();
    const nextMode = button.dataset.imageEditMode || 'crop';
    if(nextMode === 'preview' && panoramaState.enabled) setPanoramaEnabled(false);
    else setImageEditMode(nextMode, true);
});
imageEditModeToolbar?.addEventListener('ic-panorama-toggle-request', event => {
    event.stopPropagation();
    togglePanoramaPreview();
});
imageEditModeToolbar?.addEventListener('ic-depth-map-request', event => {
    event.stopPropagation();
    smartDepthMap.run();
});
imageEditModeToolbar?.addEventListener('keydown', event => {
    if(!event.key.startsWith('Arrow')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
}, true);
imageEditModeToolbar?.addEventListener('ic-change', event => {
    const nextMode = event.detail?.value || event.target?.value || event.target?.getAttribute?.('value');
    if(nextMode && nextMode !== imageEditMode) setImageEditMode(nextMode, true);
});
imageEditModal.addEventListener('pointerdown', event => {
    event.stopPropagation();
});
imageEditModal.addEventListener('mousedown', event => {
    event.stopPropagation();
});
imageEditModal.addEventListener('mousemove', event => {
    if(previewPanDrag || previewCompareDrag || panoramaState.drag || imageEditPanDrag || cropDrag) return;
    event.stopPropagation();
});
imageEditModal.addEventListener('click', event => {
    event.stopPropagation();
});
imageEditModal.addEventListener('wheel', event => {
    event.stopPropagation();
}, {passive:false});
document.getElementById('previewStage').addEventListener('mousedown', event => {
    if(imageEditMode !== 'preview' || event.button !== 0) return;
    if(event.target.closest('.preview-compare-handle')) return;
    if(event.target.closest('video')) return;
    event.preventDefault();
    event.stopPropagation();
    if(panoramaState.enabled){
        panoramaState.drag = {
            clientX:event.clientX,
            clientY:event.clientY,
            yaw:panoramaState.yaw,
            pitch:panoramaState.pitch
        };
        document.getElementById('previewStage')?.classList.add('panning');
        return;
    }
    previewPanDrag = {clientX:event.clientX, clientY:event.clientY, startX:previewPan.x, startY:previewPan.y};
});
document.getElementById('imageEditStage').addEventListener('mousedown', event => {
    if(imageEditMode === 'preview' || event.button !== 0) return;
    if(event.target.closest('.image-edit-actions, .crop-box, .crop-handle')) return;
    if(event.target.closest('#editDrawCanvas, #editTextCanvas, .edit-text-inline') && imageEditMode !== 'crop') return;
    const stage = event.currentTarget;
    if(stage.scrollWidth <= stage.clientWidth && stage.scrollHeight <= stage.clientHeight) return;
    event.preventDefault();
    event.stopPropagation();
    imageEditPanDrag = {
        clientX:event.clientX,
        clientY:event.clientY,
        scrollLeft:stage.scrollLeft,
        scrollTop:stage.scrollTop
    };
});
document.getElementById('previewCompareHandle').addEventListener('mousedown', event => {
    if(imageEditMode !== 'preview' || !previewCompareOn || previewCompareIndex < 0) return;
    event.preventDefault();
    event.stopPropagation();
    previewPanDrag = null;
    previewCompareDrag = true;
    setPreviewComparePos(event.clientX);
});
document.getElementById('previewCompareHandle').addEventListener('pointerdown', event => {
    if(imageEditMode !== 'preview' || !previewCompareOn || previewCompareIndex < 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    previewPanDrag = null;
    previewCompareDrag = true;
    setPreviewComparePos(event.clientX);
});
document.getElementById('previewCompareHandle').addEventListener('pointermove', event => {
    if(!previewCompareDrag) return;
    event.preventDefault();
    event.stopPropagation();
    setPreviewComparePos(event.clientX);
});
document.getElementById('previewCompareHandle').addEventListener('pointerup', event => {
    if(previewCompareDrag){
        event.preventDefault();
        event.stopPropagation();
    }
    previewCompareDrag = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
});
document.getElementById('previewCompareHandle').addEventListener('pointercancel', event => {
    previewCompareDrag = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
});
document.getElementById('editDrawCanvas').addEventListener('pointerdown', beginEditDraw);
document.getElementById('editDrawCanvas').addEventListener('pointermove', moveEditDraw);
document.getElementById('editDrawCanvas').addEventListener('pointerup', endEditDraw);
document.getElementById('editDrawCanvas').addEventListener('pointercancel', endEditDraw);
document.getElementById('editDrawCanvas').addEventListener('pointerleave', endEditDraw);
document.getElementById('gridJoinCanvas')?.addEventListener('pointerdown', beginGridJoinDrag);
document.getElementById('gridJoinCanvas')?.addEventListener('pointermove', moveGridJoinDrag);
document.getElementById('gridJoinCanvas')?.addEventListener('pointerup', endGridJoinDrag);
document.getElementById('gridJoinCanvas')?.addEventListener('pointercancel', endGridJoinDrag);
document.getElementById('gridJoinCanvas')?.addEventListener('pointerleave', endGridJoinDrag);
document.getElementById('editTextCanvas')?.addEventListener('pointerdown', beginEditText);
document.getElementById('editTextCanvas')?.addEventListener('pointermove', moveEditText);
document.getElementById('editTextCanvas')?.addEventListener('pointerup', endEditText);
document.getElementById('editTextCanvas')?.addEventListener('pointercancel', endEditText);
document.getElementById('editTextCanvas')?.addEventListener('pointerleave', endEditText);
document.getElementById('editTextCanvas')?.addEventListener('dblclick', event => {
    if(imageEditMode !== 'brush' || brushTool !== 'text') return;
    event.preventDefault(); event.stopPropagation();
    const hit = hitEditTextItem(editTextPoint(event));
    if(hit){
        setSelectedEditTextItem(hit.id);
        beginEditTextInline(hit);
    }
});
['paintBrushSize','paintBrushColor'].forEach(id => {
    const control = document.getElementById(id);
    if(!control) return;
    control.addEventListener('input', () => {
        if(control.localName === 'ic-slider'){
            control.setAttribute('value-text', control.value);
            const value = document.getElementById('paintBrushSizeValue');
            if(value) value.textContent = control.value;
        }
        syncSelectedEditTextStyleFromBrush();
    });
    control.addEventListener('change', () => { editTextDirty = false; });
});
document.getElementById('maskBrushSize')?.addEventListener('input', event => {
    event.currentTarget.setAttribute('value-text', event.currentTarget.value);
});
['gridHorizontalLines','gridVerticalLines','gridGapSize'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        syncGridGapValue();
        refreshGridSplitPreview();
    });
});
['imageResizeScaleRange','imageResizeScaleInput'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', event => setImageResizeScale(event.target.value));
});
document.querySelectorAll('[data-panorama-ratio]').forEach(btn => {
    btn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        applyPanoramaRatio(btn.dataset.panoramaRatio || 'wide');
    });
});
['panoramaRatioW','panoramaRatioH'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
        panoramaState.ratio = 'custom';
        panoramaState.customW = Math.max(1, Math.min(999, Number(document.getElementById('panoramaRatioW')?.value || 16)));
        panoramaState.customH = Math.max(1, Math.min(999, Number(document.getElementById('panoramaRatioH')?.value || 9)));
        refreshPanoramaControls();
        resizePanoramaViewer();
    });
});
const IMAGE_PREVIEW_WHEEL_ZOOM_SENSITIVITY = 0.0008;
function imagePreviewWheelZoomFactor(deltaY){
    const normalizedDelta = Math.max(-100, Math.min(100, Number(deltaY) || 0));
    return Math.exp(-normalizedDelta * IMAGE_PREVIEW_WHEEL_ZOOM_SENSITIVITY);
}
document.getElementById('imageEditStage').addEventListener('wheel', event => {
    if(!cropState) return;
    event.preventDefault();
    event.stopPropagation();
    if(imageEditMode === 'preview'){
        if(seekPreviewVideoFrames(event.deltaY > 0 ? 1 : -1)) return;
        if(panoramaState.enabled){
            const factor = event.deltaY < 0 ? 0.92 : 1 / 0.92;
            panoramaState.fov = Math.max(35, Math.min(100, panoramaState.fov * factor));
            updateZoomLabel();
            return;
        }
        const factor = imagePreviewWheelZoomFactor(event.deltaY);
        previewZoom = Math.max(0.05, Math.min(8, previewZoom * factor));
        applyPreviewTransform();
        return;
    }
    if(imageEditMode === 'grid' && gridOperationMode === 'join'){
        const stage = event.currentTarget;
        const oldZoom = imageEditZoom;
        const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        imageEditZoom = Math.max(0.15, Math.min(6.0, imageEditZoom * factor));
        const stageRect = stage.getBoundingClientRect();
        const mx = event.clientX - stageRect.left;
        const my = event.clientY - stageRect.top;
        const contentX = stage.scrollLeft + mx;
        const contentY = stage.scrollTop + my;
        const scale = imageEditZoom / oldZoom;
        refreshGridSplitPreview();
        syncImageEditOverflow();
        updateZoomLabel();
        stage.scrollLeft = contentX * scale - mx;
        stage.scrollTop = contentY * scale - my;
        return;
    }
    const stage = event.currentTarget;
    const oldZoom = imageEditZoom;
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    imageEditZoom = Math.max(0.15, Math.min(6.0, imageEditZoom * factor));
    const stageRect = stage.getBoundingClientRect();
    const mx = event.clientX - stageRect.left;
    const my = event.clientY - stageRect.top;
    const contentX = stage.scrollLeft + mx;
    const scale = imageEditZoom / oldZoom;
    const contentY = stage.scrollTop + my;
    applyImageEditZoom(scale);
    stage.scrollLeft = contentX * scale - mx;
    stage.scrollTop = contentY * scale - my;
}, {passive:false});
window.addEventListener('resize', () => {
    if(cropState) syncImageEditOverflow();
    if(panoramaState.enabled) resizePanoramaViewer();
    positionCanvasFloatingOverlays();
    canvasVirtualization.request();
});
window.addEventListener('studio-theme-change', event => applyTheme(event.detail?.theme || 'light'));
try {
    const apiChannel = new BroadcastChannel('studio-api');
    apiChannel.onmessage = async event => {
        if(event.data?.type === 'providers-changed' || event.data?.type === 'models-changed' || event.data?.type === 'workflows-changed' || event.data?.type === 'comfy-instances-changed'){
            await refreshSmartConfigFromSettings();
        }
        if(event.data?.type === 'canvas_updated') canvasPersistence.receive({message:event.data});
    };
} catch(e) {}
window.addEventListener('focus', () => {
    if(Date.now() - lastConfigRefreshAt > 1200) refreshSmartConfigFromSettings();
});
window.addEventListener('message', event => {
    if(event.origin && event.origin !== location.origin) return;
    if(event.data?.type === 'studio-theme') applyTheme(event.data.theme || 'light');
    if(event.data?.type === 'providers-changed' || event.data?.type === 'models-changed' || event.data?.type === 'workflows-changed' || event.data?.type === 'comfy-instances-changed') refreshSmartConfigFromSettings();
    if(event.data?.type === 'canvas_updated') canvasPersistence.receive({message:event.data});
    if(event.data?.type === 'studio-lang' && window.StudioI18n) {
        window.StudioI18n.set(event.data.lang || 'zh');
    }
});
window.addEventListener('studio-lang-change', () => {
    applySmartCanvasDockPosition(smartCanvasDockPosition);
    refreshSmartCanvasSettings();
    renderDynamicParams();
    renderInputThumbsRow(window.SmartCanvasModules.viewportSelection.selection.node());
    syncPromptCharacterCount(promptInput);
    if(imageStudio.isOpen()){
        setImageEditMode(imageEditMode);
    }
    if(isPromptTemplatePanelOpen()) renderPromptTemplatePanel();
    if(smartLogModal?.hasAttribute('open')) renderSmartCanvasLog();
    refreshPersistentToastLanguage();
    render();
});
function configureSmartCanvasVirtualization(){
    canvasVirtualization.configure({
        getNodes:() => nodes.filter(node => node.id !== SMART_LOG_PREVIEW_NODE_ID),
        measureNode:node => nodeRect(node),
        getViewport:() => viewport,
        getShellSize:() => ({width:shell.clientWidth,height:shell.clientHeight}),
        getPinnedNodeIds:smartCanvasPinnedNodeIds,
        onRefresh:() => render({syncVirtualization:false})
    });
}
function prepareSmartCanvasNodeReviewSurface(){
    document.body.classList.add('smart-canvas-node-review');
    document.documentElement.dataset.nodesStatus = 'loading';
    const visibleShellChildren = new Set([
        'smartCanvasGrid',
        'world',
        'smartNavigationLabels',
        'smartNodeFloatingPortal',
        'smartMultiSelectionBox',
        'selectionBox',
        'smartNodeContextMenu',
        'referenceGenerateMenu',
        'multiReferenceGenerateMenu',
        'upstreamInputMenu',
        'mentionPicker',
        'inputTextPreviewTooltip',
        'generationFailureAlertQueue',
        'mentionPreview'
    ]);
    [...shell.children].forEach(element => {
        if(!visibleShellChildren.has(element.id)){
            element.dataset.nodeReviewHidden = '1';
        }
    });
}
function loadSmartCanvasNodeReview(){
    const reviewFixture = window.SmartCanvasModules?.nodeReviewFixture?.create?.();
    if(!reviewFixture?.canvas) throw new Error('Canvas Node Review Fixture failed to load');
    prepareSmartCanvasNodeReviewSurface();
    apiProviders = reviewFixture.config?.apiProviders || [];
    availableModels = reviewFixture.config?.availableModels || {image:[],video:[],text:[]};
    canvas = reviewFixture.canvas;
    nodes = canvas.nodes;
    canvasUsesConnections = true;
    canvasPersistence.startTransientSession({document:canvas});
    settings = {...settings,...(canvas.settings || {})};
    configureSmartCanvasVirtualization();
    applyTheme(window.StudioTheme?.get?.() || localStorage.getItem('studio_theme') || localStorage.getItem('canvas_theme') || 'light');
    if(window.StudioI18n) window.StudioI18n.apply();
    render();
    window.SmartCanvasModules.viewportSelection.viewport.fitAll();
    document.documentElement.dataset.nodesStatus = 'ready';
    document.body.dataset.componentReviewStatus = 'ready';
}
window.onload = async () => {
    const opening = window.SmartCanvasModules?.canvasOpening;
    const requiredUiReady = Boolean(
        window.InfiniteCanvasUiNodeComponents?.render
        && customElements.get('ic-menu')
        && customElements.get('ic-canvas-node')
        && customElements.get('ic-skeleton')
    );
    if(!opening || !requiredUiReady){
        const error = new Error('Smart Canvas UI modules failed to load');
        if(opening?.fail) opening.fail(error);
        else {
            document.documentElement.classList.remove('smart-canvas-booting');
            document.documentElement.dataset.canvasOpeningPhase = 'error';
        }
        return;
    }
    opening.prepare();
    if(smartCanvasNodeReviewMode){
        loadSmartCanvasNodeReview();
        opening.ready();
        return;
    }
    configureSmartCanvasVirtualization();
    applyTheme(window.StudioTheme?.get?.() || localStorage.getItem('studio_theme') || localStorage.getItem('canvas_theme') || 'light');
    loadPromptPresets();
    loadPromptTemplateGroups();
    loadPromptTemplateOverrides();
    if(window.StudioI18n) window.StudioI18n.apply();
    if(window.lucide) lucide.createIcons();
    const supportingData = Promise.allSettled([
        loadPromptTemplates(),
        loadConfig(),
    ]);
    const openedCanvas = await canvasPersistence.load();
    if(!openedCanvas) return;
    await supportingData;
    syncApiKindToggleVisibility();
    render();
};
