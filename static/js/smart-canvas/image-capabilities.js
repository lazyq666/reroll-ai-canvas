/* Smart Canvas Image Model Capability Module */
const smartImageCapabilityFallbackRatios = Object.freeze([
    '1:1','2:3','3:2','3:4','4:3','9:16','16:9'
]);
const smartImageCapabilityFallbackResolutions = Object.freeze(['1K','2K','4K']);
const smartImageCapabilityRatioKeys = Object.freeze({
    square:'1:1', portrait:'2:3', landscape:'3:2', portrait43:'3:4',
    landscape43:'4:3', story:'9:16', wide:'16:9', ultrawide:'21:9',
    ultratall:'9:21'
});
const smartImageCapabilityStandardKeys = Object.freeze(
    Object.fromEntries(Object.entries(smartImageCapabilityRatioKeys).map(([key,value]) => [value,key]))
);
const smartImageCapabilityCache = new Map();

function smartImageCapabilityKey(providerId='', modelId=''){
    return `${String(providerId || '').trim()}\u001f${String(modelId || '').trim()}`;
}
function smartImageCapabilityFallback(providerId='', modelId=''){
    return {
        provider_id:String(providerId || '').trim(),
        model_id:String(modelId || '').trim(),
        aspect_ratios:[...smartImageCapabilityFallbackRatios],
        resolution_tiers:[...smartImageCapabilityFallbackResolutions],
        default_resolution_tier:'1K',
        source:'fallback',
        confirmed_at:null,
        known:false,
        show_resolution_control:true,
        supports_transparent_png:false
    };
}
function smartImageCapabilityClean(value, providerId='', modelId=''){
    const fallback = smartImageCapabilityFallback(providerId, modelId);
    if(!value || typeof value !== 'object') return fallback;
    const ratios = [...new Set((value.aspect_ratios || []).map(item => String(item || '').trim()).filter(Boolean))];
    const tiers = [...new Set((value.resolution_tiers || []).map(item => String(item || '').trim().toUpperCase()).filter(Boolean))];
    return {
        ...fallback,
        ...value,
        provider_id:String(value.provider_id || providerId || '').trim(),
        model_id:String(value.model_id || modelId || '').trim(),
        aspect_ratios:ratios.length ? ratios : fallback.aspect_ratios,
        resolution_tiers:tiers,
        default_resolution_tier:value.default_resolution_tier ? String(value.default_resolution_tier).toUpperCase() : null,
        known:Boolean(value.known),
        show_resolution_control:tiers.length > 1,
        supports_transparent_png:value.supports_transparent_png === true
    };
}
function smartImageCapabilityCurrent(providerId='', modelId=''){
    return smartImageCapabilityCache.get(smartImageCapabilityKey(providerId, modelId))
        || smartImageCapabilityFallback(providerId, modelId);
}
async function smartImageCapabilityLoad(providerId='', modelId=''){
    const key = smartImageCapabilityKey(providerId, modelId);
    const existing = smartImageCapabilityCache.get(key);
    if(existing) return existing;
    const unifiedModule = window.SmartCanvasModules.modelCapabilities;
    const unified = unifiedModule
        ? await unifiedModule.load(providerId, modelId, 'image.generate')
        : null;
    const query = new URLSearchParams({provider_id:String(providerId || ''), model:String(modelId || '')});
    const value = unified
        ? {
            ...(unified.media_contract || {}),
            capability_schema_version:unified.capability_schema_version,
            catalog_revision:unified.catalog_revision,
            operation:unified.operation,
            model_capability:unified
        }
        : await fetch(`/api/image-model-capabilities?${query}`).then(async response => {
            if(!response.ok) throw new Error(await response.text());
            return response.json();
        }).catch(() => smartImageCapabilityFallback(providerId, modelId));
    const capability = smartImageCapabilityClean(value, providerId, modelId);
    smartImageCapabilityCache.set(key, capability);
    return capability;
}
function smartImageCapabilityRatioValue(value){
    const parts = String(value || '').split(':').map(Number);
    return parts.length === 2 && parts[0] > 0 && parts[1] > 0 ? parts[0] / parts[1] : 0;
}
function smartImageCapabilityNormalize(width, height, supported=[], tolerance=0.07){
    const actual = Number(width) / Number(height);
    if(!Number.isFinite(actual) || actual <= 0) return {ratio:null,error:null};
    const matches = (supported || []).map(ratio => {
        const target = smartImageCapabilityRatioValue(ratio);
        return target > 0 ? {ratio,error:Math.abs(actual - target) / target} : null;
    }).filter(Boolean).sort((a,b) => a.error - b.error || a.ratio.localeCompare(b.ratio));
    if(!matches.length) return {ratio:null,error:null};
    return matches[0].error <= Number(tolerance) + 1e-12
        ? matches[0]
        : {ratio:null,error:matches[0].error};
}
function smartImageCapabilityReferenceSize(reference){
    const width = Number(reference?.natural_w || reference?.naturalWidth || reference?.width || reference?.w || 0);
    const height = Number(reference?.natural_h || reference?.naturalHeight || reference?.height || reference?.h || 0);
    return width > 0 && height > 0 ? {width,height} : null;
}
function smartImageCapabilityReferenceAspectRatio(references=[]){
    const images = (references || []).filter(item => item?.url && !['video','audio'].includes(String(item.kind || '').toLowerCase()));
    if(images.length !== 1) return '';
    const size = smartImageCapabilityReferenceSize(images[0]);
    if(!size) return '';
    return `${Math.round(size.width)}:${Math.round(size.height)}`;
}
function smartImageCapabilityAutomatic(references=[], capability={}){
    const images = (references || []).filter(item => item?.url && !['video','audio'].includes(String(item.kind || '').toLowerCase()));
    if(images.length !== 1) return {available:false,ratio:null,reason:images.length > 1 ? 'multiple-references' : 'reference-required'};
    const size = smartImageCapabilityReferenceSize(images[0]);
    if(!size) return {available:false,ratio:null,reason:'dimensions-unknown'};
    const normalized = smartImageCapabilityNormalize(size.width, size.height, capability.aspect_ratios || []);
    return normalized.ratio
        ? {available:true,ratio:normalized.ratio,error:normalized.error,reason:''}
        : {available:false,ratio:null,error:normalized.error,reason:'unsupported-reference-ratio'};
}
function smartImageCapabilityRatioForSettings(settings={}, prefix=''){
    const key = prefix ? `${prefix}Ratio` : 'ratio';
    const value = String(settings?.[key] || '');
    return smartImageCapabilityRatioKeys[value] || (value.includes(':') ? value : null);
}
function smartImageCapabilityPreferredResolution(capability={}){
    const tiers = [...new Set((capability?.resolution_tiers || [])
        .map(value => String(value || '').trim().toUpperCase())
        .filter(Boolean))];
    if(tiers.includes('1K')) return '1K';
    if(tiers.includes('2K')) return '2K';
    const declaredDefault = String(capability?.default_resolution_tier || '').trim().toUpperCase();
    return (declaredDefault && tiers.includes(declaredDefault) ? declaredDefault : '')
        || tiers[0]
        || declaredDefault;
}
function smartImageCapabilityValidate(settings={}, {prefix='', references=[], capability=null, allowInternalCustom=false}={}){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    const resolutionKey = prefix ? `${prefix}Resolution` : 'resolution';
    capability = capability || smartImageCapabilityFallback();
    const ratioValue = String(settings?.[ratioKey] || '');
    const resolutionValue = String(settings?.[resolutionKey] || '').toUpperCase();
    if(['custom'].includes(ratioValue) && !allowInternalCustom) return {valid:false,reason:'custom-ratio-removed',field:ratioKey};
    if(['custom'].includes(resolutionValue.toLowerCase()) && !allowInternalCustom) return {valid:false,reason:'custom-size-removed',field:resolutionKey};
    if(ratioValue === 'source'){
        const automatic = smartImageCapabilityAutomatic(references, capability);
        if(!automatic.available) return {valid:false,reason:automatic.reason,field:ratioKey};
    } else {
        const ratio = smartImageCapabilityRatioForSettings(settings, prefix);
        if(!ratio || !(capability.aspect_ratios || []).includes(ratio)) return {valid:false,reason:'unsupported-ratio',field:ratioKey};
    }
    if(capability.resolution_tiers?.length && !capability.resolution_tiers.includes(resolutionValue)){
        return {valid:false,reason:'unsupported-resolution',field:resolutionKey};
    }
    return {valid:true,reason:'',field:''};
}
function smartImageCapabilityReconcile(settings={}, capability={}, references=[], {prefix=''}={}){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    const resolutionKey = prefix ? `${prefix}Resolution` : 'resolution';
    const customRatioKey = prefix ? `${prefix}CustomRatio` : 'customRatio';
    const customRatioWidthKey = prefix ? `${prefix}CustomRatioWidth` : 'customRatioWidth';
    const customRatioHeightKey = prefix ? `${prefix}CustomRatioHeight` : 'customRatioHeight';
    const next = {...settings};
    const invalidated = [];
    const automatic = smartImageCapabilityAutomatic(references, capability);
    if(next[ratioKey] === 'source'){
        if(automatic.available){
            const [width,height] = automatic.ratio.split(':').map(Number);
            next[customRatioKey] = automatic.ratio;
            next[customRatioWidthKey] = width;
            next[customRatioHeightKey] = height;
        } else {
            next[ratioKey] = '';
            delete next[customRatioKey];
            delete next[customRatioWidthKey];
            delete next[customRatioHeightKey];
            invalidated.push('aspect_ratio');
        }
    } else {
        const ratio = smartImageCapabilityRatioForSettings(next, prefix);
        if(!ratio || !(capability.aspect_ratios || []).includes(ratio)){
            next[ratioKey] = '';
            invalidated.push('aspect_ratio');
        }
    }
    const tiers = capability.resolution_tiers || [];
    const currentTier = String(next[resolutionKey] || '').toUpperCase();
    const preferredTier = smartImageCapabilityPreferredResolution(capability);
    if(tiers.length === 1){
        if(currentTier && currentTier !== tiers[0]) invalidated.push('resolution_tier');
        next[resolutionKey] = tiers[0].toLowerCase();
    } else if(tiers.length){
        if(!tiers.includes(currentTier)){
            next[resolutionKey] = preferredTier.toLowerCase();
            if(currentTier) invalidated.push('resolution_tier');
        }
    } else {
        next[resolutionKey] = preferredTier.toLowerCase();
    }
    return {settings:next,invalidated,automatic};
}
function smartImageCapabilityResolveForSubmission(settings={}, references=[], capability=null, {prefix=''}={}){
    capability = capability || smartImageCapabilityFallback();
    const validation = smartImageCapabilityValidate(settings, {prefix,references,capability,allowInternalCustom:Boolean(settings.outpaintResolutionLocked)});
    if(!validation.valid) return {...validation,target_aspect_ratio:null};
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    const automatic = settings[ratioKey] === 'source'
        ? smartImageCapabilityAutomatic(references, capability)
        : null;
    return {
        ...validation,
        target_aspect_ratio:automatic?.ratio || smartImageCapabilityRatioForSettings(settings, prefix),
        automatic:Boolean(automatic?.available)
    };
}
function smartImageCapabilityIntersect(capabilities=[]){
    if(!capabilities.length) return {aspect_ratios:[],resolution_tiers:[],blocked:true,supports_transparent_png:false};
    const first = capabilities[0];
    const ratios = (first.aspect_ratios || []).filter(value => capabilities.slice(1).every(item => (item.aspect_ratios || []).includes(value)));
    const allTiersPresent = capabilities.every(item => (item.resolution_tiers || []).length);
    const allTiersConfirmed = capabilities.every(item => item.known && (item.resolution_tiers || []).length);
    const tiers = allTiersPresent
        ? (first.resolution_tiers || []).filter(value => capabilities.slice(1).every(item => (item.resolution_tiers || []).includes(value)))
        : [];
    return {
        aspect_ratios:ratios,
        resolution_tiers:tiers,
        blocked:!ratios.length || (allTiersConfirmed && !tiers.length),
        supports_transparent_png:capabilities.every(item => item.supports_transparent_png === true)
    };
}
function smartImageCapabilityShouldWarnForTransition(transition, {prefix='',currentKey='',capability=null,invalidated=[]}={}){
    return Boolean(
        transition
        && transition.previousSettingsSupported === true
        && transition.prefix === prefix
        && transition.fromKey
        && transition.fromKey !== currentKey
        && transition.toKey === currentKey
        && capability?.known === true
        && invalidated.length
    );
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.imageCapabilities = Object.freeze({
    load:smartImageCapabilityLoad,
    current:smartImageCapabilityCurrent,
    fallback:smartImageCapabilityFallback,
    clean:smartImageCapabilityClean,
    normalize:smartImageCapabilityNormalize,
    automatic:smartImageCapabilityAutomatic,
    referenceAspectRatio:smartImageCapabilityReferenceAspectRatio,
    preferredResolution:smartImageCapabilityPreferredResolution,
    validate:smartImageCapabilityValidate,
    reconcile:smartImageCapabilityReconcile,
    resolveForSubmission:smartImageCapabilityResolveForSubmission,
    intersect:smartImageCapabilityIntersect,
    shouldWarnForTransition:smartImageCapabilityShouldWarnForTransition,
    ratioKeyToStandard:key => smartImageCapabilityRatioKeys[key] || null,
    standardToRatioKey:value => smartImageCapabilityStandardKeys[value] || null
});
