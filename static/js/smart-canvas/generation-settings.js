/*
 * Smart Canvas Generation Settings Module
 *
 * Owns the active Generation Settings state, normalization, recent-mode
 * snapshots and per-Node persistence. The Interface always returns clones.
 */
let settings = {
    engine:'api',
    apiKind:'image',
    provider_id:'',
    model:'',
    ratio:'square',
    resolution:'1k',
    customRatio:'',
    customRatioWidth:'',
    customRatioHeight:'',
    customSize:'',
    customWidth:'',
    customHeight:'',
    quality:'auto',
    transparentPng:false,
    count:1,
    videoProvider:'',
    videoModel:'',
    videoDuration:5,
    videoAspect:'16:9',
    videoResolution:'',
    videoEnhancePrompt:false,
    videoEnableUpsample:false,
    videoWatermark:false,
    videoCameraFixed:false,
    videoGenerateAudio:false,
    videoReferenceMode:'multimodal_all_around',
    videoMultimodal:true,
    _videoMultimodalUserSet:false,
    videoUseFrameRoles:false,
    videoTrustedAsset:false,
    videoTrustedSource:'library',
    videoTempShLinks:[],
    msgenModel:'zimage',
    msCustomModel:'',
    msRatio:'square',
    msResolution:'1k',
    msCustomRatio:'',
    msCustomRatioWidth:'',
    msCustomRatioHeight:'',
    msCustomSize:'',
    msCustomWidth:'',
    msCustomHeight:'',
    comfyMode:'text',
    comfyWorkflow:'',
    comfyParams:{},
    rhConfigKey:'',
    rhPayment:'free',
    rhInstanceType:'',
    rhParams:{},
    rhRandomActive:{},
    width:1024,
    height:1024,
    enhanceStrength:0.5,
    enhanceUpscale:false,
    enhanceUpscaleRes:2048,
    editUpscale:false,
    editUpscaleRes:2048,
    promptH:124
};
function cloneSmartSettings(source=settings){
    try {
        return JSON.parse(JSON.stringify(source || {}));
    } catch(e) {
        return {...(source || {})};
    }
}
function settingsForStorage(source=settings){
    const clean = cloneSmartSettings(source);
    clean.videoTempShLinks = (clean.videoTempShLinks || []).filter(item => item?.manual === true);
    // Canvas layout is shared Canvas state, never a Generation Settings or
    // cross-Canvas recent preference.
    delete clean.generationBatchLayout;
    delete clean._imageCapabilityWarning;
    delete clean._imageCapabilityWarningKey;
    return clean;
}
function normalizeSmartVideoModeSettings(target, preferMultimodal=false){
    if(!target || typeof target !== 'object') return target;
    const validModes = new Set(['image_to_video','multimodal_all_around','first_last_frames']);
    let mode = String(target.videoReferenceMode || '');
    if(!validModes.has(mode)){
        if(target.videoUseFrameRoles) mode = 'first_last_frames';
        else mode = target.videoMultimodal === false ? 'image_to_video' : 'multimodal_all_around';
    }
    if(preferMultimodal && mode !== 'first_last_frames' && target._videoMultimodalUserSet !== true){
        mode = 'multimodal_all_around';
    }
    target.videoReferenceMode = mode;
    target.videoUseFrameRoles = mode === 'first_last_frames';
    target.videoMultimodal = mode === 'multimodal_all_around';
    return target;
}
function isApiLikeEngine(engine){
    return ['api', 'volcengine'].includes(String(engine || '').toLowerCase());
}
function smartLoopRoundSettings(runSettings, ctx=smartLoopContext){
    const next = {...(runSettings || {})};
    const imageCountEngine = isApiLikeEngine(next.engine)
        ? next.apiKind !== 'video'
        : next.engine === 'modelscope';
    if(ctx?.nodeId && imageCountEngine){
        next.count = 1;
    }
    return next;
}
function isGptImageAutoSizeModel(model){
    const raw = String(model || '').trim().toLowerCase();
    const normalized = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const compact = raw.replace(/[^a-z0-9]+/g, '');
    return normalized === 'gpt-image-2'
        || normalized.startsWith('gpt-image-2-')
        || normalized.endsWith('-gpt-image-2')
        || normalized.includes('-gpt-image-2-')
        || compact === 'gptimage2'
        || compact.startsWith('gptimage2')
        || compact.endsWith('gptimage2');
}
function defaultSmartApiResolution(model){
    return '1k';
}
const SMART_IMAGE_RATIO_KEYS = new Set([
    'square',
    'portrait',
    'landscape',
    'portrait43',
    'landscape43',
    'story',
    'wide',
    'ultrawide',
    'ultratall',
    'source',
    'custom'
]);
function smartPositivePair(value, separatorPattern){
    const parts = String(value || '').trim().split(separatorPattern);
    if(parts.length !== 2) return false;
    return parts.every(part => Number(part) > 0);
}
function validateSmartImageSize(source={}, {
    prefix='',
    allowAuto=false,
    references=[],
    capability=null
}={}){
    const capabilityModule = window.SmartCanvasModules?.imageCapabilities;
    if(capabilityModule?.validate){
        return capabilityModule.validate(source, {
            prefix,
            references,
            capability:capability || capabilityModule.fallback(),
            allowInternalCustom:Boolean(source?.outpaintResolutionLocked)
        });
    }
    const resolutionKey = prefix ? `${prefix}Resolution` : 'resolution';
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    const customSizeKey = prefix ? `${prefix}CustomSize` : 'customSize';
    const customRatioKey = prefix ? `${prefix}CustomRatio` : 'customRatio';
    const resolution = String(source?.[resolutionKey] || '').trim();
    const ratio = String(source?.[ratioKey] || '').trim();
    if(resolution && !['auto','1k','2k','4k','custom'].includes(resolution)){
        return {valid:false, reason:'invalid-resolution', field:resolutionKey};
    }
    if(resolution === 'auto' && !allowAuto){
        return {valid:false, reason:'unsupported-auto', field:resolutionKey};
    }
    if(resolution === 'custom' && !smartPositivePair(source?.[customSizeKey], /[xX*]/)){
        return {valid:false, reason:'invalid-custom-size', field:customSizeKey};
    }
    if(ratio && !SMART_IMAGE_RATIO_KEYS.has(ratio)){
        return {valid:false, reason:'invalid-ratio', field:ratioKey};
    }
    if(
        ['custom','source'].includes(ratio)
        && resolution !== 'custom'
        && !smartPositivePair(source?.[customRatioKey], /[:xX*]/)
    ){
        return {valid:false, reason:'invalid-custom-ratio', field:customRatioKey};
    }
    return {valid:true, reason:'', field:''};
}
const RECENT_SMART_SETTINGS_KEY = 'smart_canvas_recent_run_settings_v1';
const initialSmartSettings = cloneSmartSettings(settings);
let canvasDefaultSmartSettings = cloneSmartSettings(settings);
let recentSmartSettingsByMode = {};
function smartSettingsModeKey(source=settings){
    const engine = ['api','volcengine','modelscope','comfy','runninghub'].includes(source?.engine) ? source.engine : 'api';
    if(engine === 'api') return `api:${source?.apiKind === 'video' ? 'video' : 'image'}`;
    if(engine === 'volcengine') return `volcengine:${source?.apiKind === 'video' ? 'video' : 'image'}`;
    if(engine === 'comfy') return `comfy:${['text','enhance','edit','custom'].includes(source?.comfyMode) ? source.comfyMode : 'text'}`;
    if(engine === 'runninghub') return 'runninghub';
    return 'modelscope';
}
function loadRecentSmartSettings(){
    try {
        const data = JSON.parse(localStorage.getItem(RECENT_SMART_SETTINGS_KEY) || '{}');
        recentSmartSettingsByMode = data && typeof data === 'object' ? data : {};
    } catch(e) {
        recentSmartSettingsByMode = {};
    }
}
function saveRecentSmartSettings(){
    localStorage.setItem(RECENT_SMART_SETTINGS_KEY, JSON.stringify(recentSmartSettingsByMode));
}
function recentSmartSettingsForMode(modeKey=''){
    const key = modeKey || recentSmartSettingsByMode.__lastKey || smartSettingsModeKey(settings);
    const saved = recentSmartSettingsByMode[key];
    const recent = saved && typeof saved === 'object' ? cloneSmartSettings(saved) : {};
    delete recent.generationBatchLayout;
    return recent;
}
function rememberRecentSmartSettings(source=settings, node=null){
    const clean = stripOutpaintDisplaySettings(settingsForStorage(source), node);
    sanitizeSmartApiSelection(clean);
    if(clean.outpaintResolutionLocked === true && clean.resolution === 'custom'){
        clean.resolution = '1k';
        clean.ratio = clean.ratio || 'square';
        clean.customWidth = '';
        clean.customHeight = '';
        clean.customSize = '';
    }
    delete clean.outpaintResolutionLocked;
    const key = smartSettingsModeKey(clean);
    recentSmartSettingsByMode[key] = settingsForStorage(clean);
    recentSmartSettingsByMode.__lastKey = key;
    saveRecentSmartSettings();
}
function applyRecentSmartSettingsForCurrentMode(){
    const requestedEngine = ['api','volcengine','modelscope','comfy','runninghub'].includes(settings.engine) ? settings.engine : 'api';
    const requestedApiKind = settings.apiKind === 'video' ? 'video' : 'image';
    const key = smartSettingsModeKey(settings);
    const saved = recentSmartSettingsForMode(key);
    if(!Object.keys(saved).length){
        settings.engine = requestedEngine;
        if(isApiLikeEngine(requestedEngine)) settings.apiKind = requestedApiKind;
        clearVolcengineSelectionOutsideVolcengine(settings);
        sanitizeSmartApiSelection(settings, {notify:true});
        return;
    }
    settings = {...settings, ...saved, engine:requestedEngine};
    if(isApiLikeEngine(requestedEngine)) settings.apiKind = requestedApiKind;
    clearVolcengineSelectionOutsideVolcengine(settings);
    sanitizeSmartApiSelection(settings, {notify:true});
}
function clearVolcengineSelectionOutsideVolcengine(target=settings){
    if(!target || typeof target !== 'object' || target.engine === 'volcengine') return target;
    if(target.provider_id === 'volcengine') target.provider_id = '';
    if(target.videoProvider === 'volcengine') target.videoProvider = '';
    return target;
}
function smartSettingsForNode(node){
    const nodeSettings = stripOutpaintDisplaySettings(node?.runSettings || {}, node);
    const recentSettings = Object.keys(nodeSettings).length ? {} : recentSmartSettingsForMode();
    let base = {
        ...cloneSmartSettings(canvasDefaultSmartSettings || initialSmartSettings),
        ...recentSettings,
        ...nodeSettings
    };
    if(!Object.prototype.hasOwnProperty.call(nodeSettings, 'transparentPng')){
        base.transparentPng = false;
    }
    normalizeSmartVideoModeSettings(base, true);
    base = constrainSmartNodeGenerationSettings(node, base);
    return withOutpaintDisplaySettings(node, base);
}
function constrainSmartNodeGenerationSettings(node, source={}){
    const target = cloneSmartSettings(source);
    const eligibility = typeof smartNodeGenerationEligibility === 'function'
        ? smartNodeGenerationEligibility(node)
        : {forcedApiKind:''};
    if(eligibility.forcedApiKind !== 'video') return target;
    const requestedEngine = isApiLikeEngine(target.engine) ? target.engine : 'api';
    const modeSettings = {...target, engine:requestedEngine, apiKind:'video'};
    const recent = recentSmartSettingsForMode(smartSettingsModeKey(modeSettings));
    const constrained = {...modeSettings, ...recent, engine:requestedEngine, apiKind:'video'};
    normalizeSmartVideoModeSettings(constrained, true);
    clearVolcengineSelectionOutsideVolcengine(constrained);
    sanitizeSmartApiSelection(constrained);
    return constrained;
}
function reconcileSmartSettingsAfterCanvasSync({
    canvasSettings={},
    activeNodeId=''
}={}){
    canvasDefaultSmartSettings = {
        ...cloneSmartSettings(initialSmartSettings),
        ...cloneSmartSettings(canvasSettings)
    };
    normalizeSmartVideoModeSettings(canvasDefaultSmartSettings, true);
    const activeNode = activeNodeId
        ? nodes.find(node => String(node.id || '') === String(activeNodeId))
        : activeComposerNode();
    settings = activeNode
        ? smartSettingsForNode(activeNode)
        : cloneSmartSettings(canvasDefaultSmartSettings);
    return cloneSmartSettings(settings);
}
function smartGenerationSettingsForRun({
    nodeId='',
    node=null,
    context=null,
    overrides={},
    outpaintSize=null
}={}){
    const target = node || (nodeId ? nodes.find(item => item.id === nodeId) : null);
    const resolved = target ? smartSettingsForNode(target) : cloneSmartSettings(settings);
    let runSettings = smartLoopRoundSettings({
        ...cloneSmartSettings(settings),
        ...cloneSmartSettings(resolved),
        ...cloneSmartSettings(overrides)
    }, context);
    const outpaintWidth = Math.round(Number(outpaintSize?.width) || 0);
    const outpaintHeight = Math.round(Number(outpaintSize?.height) || 0);
    if(outpaintWidth > 0 && outpaintHeight > 0){
        runSettings = {
            ...runSettings,
            resolution:'custom',
            ratio:'',
            customWidth:outpaintWidth,
            customHeight:outpaintHeight,
            customSize:`${outpaintWidth}x${outpaintHeight}`
        };
        if(isApiLikeEngine(runSettings.engine)) runSettings.apiKind = 'image';
        if(runSettings.engine === 'modelscope'){
            runSettings.msResolution = 'custom';
            runSettings.msRatio = '';
            runSettings.msCustomWidth = outpaintWidth;
            runSettings.msCustomHeight = outpaintHeight;
            runSettings.msCustomSize = `${outpaintWidth}x${outpaintHeight}`;
        }
        if(runSettings.engine === 'comfy'){
            runSettings.width = outpaintWidth;
            runSettings.height = outpaintHeight;
        }
    }
    normalizeSmartVideoModeSettings(runSettings, true);
    const outputKind = isApiLikeEngine(runSettings.engine) && runSettings.apiKind === 'video' ? 'video' : 'image';
    const expectedCount = outputKind === 'video' || runSettings.engine === 'runninghub' || runSettings.engine === 'comfy'
        ? 1
        : Math.max(1, Math.min(8, Number(runSettings.count || 1)));
    return {
        settings:cloneSmartSettings(runSettings),
        outputKind,
        expectedCount,
        concurrent:['api','volcengine','runninghub','modelscope','comfy'].includes(runSettings.engine)
    };
}
function activeSettingsSubject(){
    const active = activeComposerSubject?.id
        ? (nodes.find(n => n.id === activeComposerSubject.id) || activeComposerSubject)
        : window.SmartCanvasModules.viewportSelection.selection.node();
    return isSmartRunnableNode(active) ? active : null;
}
function activeComposerNode(){
    if(!lastComposerNodeId) return null;
    const id = String(lastComposerNodeId).split(':')[0] || '';
    const node = nodes.find(n => n.id === id);
    return isSmartRunnableNode(node) ? node : null;
}
function persistActiveSmartSettings(){
    if(!composer?.classList?.contains('open')) return;
    const subject = activeComposerNode();
    if(!subject) return;
    subject.runSettings = settingsForStorage(settings);
    if(
        referenceGenerationKind(subject)
        && !(subject.images || []).some(item => item?.url)
        && !smartNodeInFlight(subject)
    ){
        subject.referenceGenerationKind = settings.apiKind === 'video'
            ? 'video'
            : 'image';
    }
    rememberRecentSmartSettings(settings, subject);
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.generationSettings = Object.freeze({
    snapshot(value=null){
        return cloneSmartSettings(value || settings);
    },
    forNode(nodeId=''){
        const node = nodeId ? nodes.find(item => item.id === nodeId) : activeSettingsSubject();
        return cloneSmartSettings(node ? smartSettingsForNode(node) : settings);
    },
    forRun(options={}){
        return smartGenerationSettingsForRun(options);
    },
    reconcileCanvasSync(options={}){
        return reconcileSmartSettingsAfterCanvasSync(options);
    },
    validateImageSize(value, options={}){
        return validateSmartImageSize(value, options);
    },
    remember(value, {nodeId='', node=null}={}){
        const target = node || (nodeId ? nodes.find(item => item.id === nodeId) : null);
        rememberRecentSmartSettings(value, target);
        return cloneSmartSettings(value);
    },
    saveForNode(nodeId, value, {remember=true}={}){
        const node = nodes.find(item => item.id === nodeId);
        if(!node) return null;
        const stored = settingsForStorage(value);
        node.runSettings = stored;
        if(remember) rememberRecentSmartSettings(stored, node);
        return cloneSmartSettings(stored);
    },
});
