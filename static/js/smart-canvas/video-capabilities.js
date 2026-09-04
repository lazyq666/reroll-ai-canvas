/* Smart Canvas Video Model Capability Module */
const smartVideoCapabilityFallbackRatios = Object.freeze([
    '16:9','9:16','1:1','4:3','3:4','21:9'
]);
const smartVideoCapabilityFallbackResolutions = Object.freeze([
    '480p','720p','1080p','4k'
]);
const smartVideoCapabilityCache = new Map();
const smartVideoCapabilityCatalogs = new Map();

function smartVideoCapabilityContext(context={}){
    return {
        protocol:String(context?.protocol || '').trim().toLowerCase(),
        base_url:String(context?.base_url || context?.baseUrl || '').trim()
    };
}
function smartVideoCapabilityKey(providerId='', modelId='', context={}){
    const route = smartVideoCapabilityContext(context);
    return [
        String(providerId || '').trim(),
        String(modelId || '').trim(),
        route.protocol,
        route.base_url
    ].join('\u001f');
}
function smartVideoCapabilityFallback(providerId='', modelId=''){
    const common = {
        duration_seconds:{minimum:1,maximum:60},
        video_resolutions:[...smartVideoCapabilityFallbackResolutions]
    };
    return {
        provider_id:String(providerId || '').trim(),
        model_id:String(modelId || '').trim(),
        known:false,
        source:'fallback',
        confirmed_at:null,
        supported_model_ids:[],
        backend_path:{},
        composer_options:{},
        composer_option_definitions:{},
        composer_policy:{},
        commands:{
            text2video:{...common,aspect_ratios:[...smartVideoCapabilityFallbackRatios]},
            image2video:{...common},
            frames2video:{...common},
            multimodal2video:{...common,aspect_ratios:[...smartVideoCapabilityFallbackRatios]}
        }
    };
}
function smartVideoCapabilityUnique(values=[]){
    return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}
function smartVideoCapabilityProfiledCommands(value={},commands={}){
    const profile = value.video_profile && typeof value.video_profile === 'object'
        ? value.video_profile
        : null;
    if(!profile) return commands;
    const modelCapability = value.model_capability && typeof value.model_capability === 'object'
        ? value.model_capability
        : {};
    const output = modelCapability.output && typeof modelCapability.output === 'object'
        ? modelCapability.output
        : {};
    const inputs = modelCapability.inputs && typeof modelCapability.inputs === 'object'
        ? modelCapability.inputs
        : {};
    const duration = output.duration_seconds && typeof output.duration_seconds === 'object'
        ? output.duration_seconds
        : {minimum:1,maximum:60};
    const resolutions = smartVideoCapabilityUnique(output.resolutions || output.resolution_tiers);
    const ratios = smartVideoCapabilityUnique(output.aspect_ratios);
    const next = Object.fromEntries(Object.entries(commands || {}).map(([key,command]) => [
        key,
        {
            ...(command && typeof command === 'object' ? command : {}),
            duration_seconds:{...duration},
            ...(resolutions.length ? {video_resolutions:[...resolutions]} : {}),
            ...(ratios.length && ['text2video','multimodal2video'].includes(key) ? {aspect_ratios:[...ratios]} : {})
        }
    ]));
    const modes = profile.modes && typeof profile.modes === 'object' ? profile.modes : {};
    if(modes.first_last_frames === true){
        next.frames2video = {
            ...(next.frames2video || {}),
            duration_seconds:{...duration},
            ...(resolutions.length ? {video_resolutions:[...resolutions]} : {}),
            image_count:{minimum:1,maximum:2}
        };
    } else {
        delete next.frames2video;
    }
    if(modes.multimodal_all_around === true){
        const referenceDuration = profile.reference_media_duration_seconds && typeof profile.reference_media_duration_seconds === 'object'
            ? profile.reference_media_duration_seconds
            : {};
        next.multimodal2video = {
            ...(next.multimodal2video || {}),
            duration_seconds:{...duration},
            ...(resolutions.length ? {video_resolutions:[...resolutions]} : {}),
            ...(ratios.length ? {aspect_ratios:[...ratios]} : {}),
            inputs:{
                image_count:{minimum:0,maximum:Number(inputs.image?.maximum) || 0},
                video_count:{minimum:0,maximum:Number(inputs.video?.maximum) || 0},
                audio_count:{minimum:0,maximum:Number(inputs.audio?.maximum) || 0},
                total_count:{minimum:1,maximum:Number(profile.input_total_maximum) || 0},
                reference_media_duration_seconds:{
                    each:{...(referenceDuration.each || {})},
                    combined_total:{...(referenceDuration.combined_total || {})}
                },
                audio_only_supported:profile.audio_only_supported === true
            }
        };
    } else {
        delete next.multimodal2video;
    }
    return next;
}
function smartVideoCapabilityClean(value, providerId='', modelId=''){
    const fallback = smartVideoCapabilityFallback(providerId, modelId);
    if(!value || typeof value !== 'object') return fallback;
    const rawCommands = value.commands && typeof value.commands === 'object' ? value.commands : {};
    const commands = smartVideoCapabilityProfiledCommands(value, rawCommands);
    const hasVideoProfile = value.video_profile && typeof value.video_profile === 'object';
    return {
        ...fallback,
        ...value,
        provider_id:String(value.provider_id || providerId || '').trim(),
        model_id:String(value.model_id || modelId || '').trim(),
        known:Boolean(value.known),
        supported_model_ids:smartVideoCapabilityUnique(value.supported_model_ids),
        backend_path:value.backend_path && typeof value.backend_path === 'object' ? value.backend_path : {},
        composer_options:value.composer_options && typeof value.composer_options === 'object' ? value.composer_options : {},
        composer_option_definitions:value.composer_option_definitions && typeof value.composer_option_definitions === 'object' ? value.composer_option_definitions : {},
        composer_policy:value.composer_policy && typeof value.composer_policy === 'object' ? value.composer_policy : {},
        commands:Object.keys(commands).length || hasVideoProfile ? commands : fallback.commands
    };
}
async function smartVideoCapabilityLoad(providerId='', modelId='', context={}){
    const route = smartVideoCapabilityContext(context);
    const key = smartVideoCapabilityKey(providerId, modelId, route);
    const existing = smartVideoCapabilityCache.get(key);
    if(existing) return existing;
    const unifiedModule = window.SmartCanvasModules.modelCapabilities;
    const unified = unifiedModule
        ? await unifiedModule.load(providerId, modelId, 'video.generate', route)
        : null;
    const query = new URLSearchParams({
        provider_id:String(providerId || ''),
        model:String(modelId || ''),
        protocol:route.protocol,
        base_url:route.base_url
    });
    const value = unified
        ? {
            ...(unified.media_contract || {}),
            capability_schema_version:unified.capability_schema_version,
            catalog_revision:unified.catalog_revision,
            operation:unified.operation,
            model_capability:unified
        }
        : await fetch(`/api/video-model-capabilities?${query}`).then(async response => {
            if(!response.ok) throw new Error(await response.text());
            return response.json();
        }).catch(() => smartVideoCapabilityFallback(providerId, modelId));
    const capability = smartVideoCapabilityClean(value, providerId, modelId);
    smartVideoCapabilityCache.set(key, capability);
    if(capability.supported_model_ids.length){
        smartVideoCapabilityCatalogs.set(capability.provider_id, capability.supported_model_ids);
    }
    return capability;
}
function smartVideoCapabilityCurrent(providerId='', modelId='', context={}){
    return smartVideoCapabilityCache.get(smartVideoCapabilityKey(providerId, modelId, context))
        || smartVideoCapabilityFallback(providerId, modelId);
}
function smartVideoCapabilitySupportedModels(providerId=''){
    return [...(smartVideoCapabilityCatalogs.get(String(providerId || '').trim()) || [])];
}
function smartVideoCapabilityCanonicalModel(providerId='', modelId='', supportedModelIds=null){
    const requested = String(modelId || '').trim().toLowerCase();
    const supported = Array.isArray(supportedModelIds)
        ? supportedModelIds
        : smartVideoCapabilitySupportedModels(providerId);
    return supported.find(value => String(value || '').trim().toLowerCase() === requested) || '';
}
function smartVideoCapabilityMediaKind(reference={}){
    const explicit = String(reference?.kind || reference?.type || '').toLowerCase();
    if(['image','video','audio'].includes(explicit)) return explicit;
    const url = String(reference?.url || reference || '').split(/[?#]/)[0].toLowerCase();
    if(/\.(mp4|mov|webm|mkv|avi|m4v)$/.test(url)) return 'video';
    if(/\.(mp3|wav|aac|m4a|flac|ogg)$/.test(url)) return 'audio';
    return 'image';
}
function smartVideoCapabilityReferenceCounts(references=[]){
    const counts = {image:0,video:0,audio:0,total:0};
    (references || []).filter(reference => reference?.url || typeof reference === 'string').forEach(reference => {
        const kind = smartVideoCapabilityMediaKind(reference);
        counts[kind] += 1;
        counts.total += 1;
    });
    return counts;
}
function smartVideoCapabilityRequestedMode(settings={}, capability={}){
    const explicit = String(settings.videoReferenceMode || '');
    const supportsAllAround = Boolean(capability?.commands?.multimodal2video);
    const supportsFirstLast = Boolean(capability?.commands?.frames2video);
    if(explicit === 'multimodal_all_around' && supportsAllAround) return explicit;
    if(explicit === 'first_last_frames' && supportsFirstLast) return explicit;
    if(explicit === 'image_to_video' && capability?.provider_id !== 'jimeng') return explicit;
    if(settings.videoUseFrameRoles && supportsFirstLast) return 'first_last_frames';
    if(supportsAllAround) return 'multimodal_all_around';
    if(supportsFirstLast) return 'first_last_frames';
    if(capability?.provider_id === 'jimeng') return '';
    return settings.videoMultimodal === false && capability?.provider_id !== 'jimeng'
        ? 'image_to_video'
        : 'multimodal_all_around';
}
function smartVideoCapabilityResolve(settings={}, references=[], capability=null){
    capability = capability || smartVideoCapabilityFallback();
    const counts = smartVideoCapabilityReferenceCounts(references);
    const requestedMode = smartVideoCapabilityRequestedMode(settings, capability);
    let referenceMode = null;
    let command = 'text2video';
    if(counts.total){
        if(capability.provider_id === 'jimeng'){
            if(['first_last_frames','multimodal_all_around'].includes(requestedMode)){
                referenceMode = requestedMode;
            }
        } else if(requestedMode === 'first_last_frames'){
            referenceMode = 'first_last_frames';
        } else if(requestedMode === 'image_to_video'){
            referenceMode = 'image_to_video';
        } else {
            referenceMode = 'multimodal_all_around';
        }
        if(referenceMode){
            command = {
                image_to_video:'image2video',
                first_last_frames:'frames2video',
                multimodal_all_around:'multimodal2video'
            }[referenceMode];
        }
    }
    const commandCapability = capability.commands?.[command] || {};
    const ratioCapability = referenceMode === 'image_to_video'
        ? (capability.commands?.multimodal2video || commandCapability)
        : commandCapability;
    const aspectLocked = referenceMode === 'first_last_frames';
    const aspectRatios = aspectLocked
        ? ['adaptive']
        : smartVideoCapabilityUnique(ratioCapability.aspect_ratios || smartVideoCapabilityFallbackRatios);
    const videoResolutions = smartVideoCapabilityUnique(commandCapability.video_resolutions || smartVideoCapabilityFallbackResolutions);
    const duration = commandCapability.duration_seconds || {minimum:1,maximum:60};
    const multimodalInputs = capability.commands?.multimodal2video?.inputs || {};
    const referenceLimit = referenceMode === 'image_to_video'
        ? (commandCapability.image_count || {minimum:null,maximum:null})
        : referenceMode === 'first_last_frames'
            ? (commandCapability.image_count || {minimum:null,maximum:null})
            : referenceMode === 'multimodal_all_around'
                ? (multimodalInputs.total_count || {minimum:1,maximum:null})
                : {minimum:0,maximum:0};
    return {
        command,
        reference_mode:referenceMode,
        requested_reference_mode:requestedMode,
        counts,
        reference_limit:referenceLimit,
        aspect_ratio_locked:aspectLocked,
        aspect_ratios:aspectRatios,
        video_resolutions:videoResolutions,
        duration_seconds:{
            minimum:Number(duration.minimum) || 1,
            maximum:Number(duration.maximum) || 60
        },
        command_capability:commandCapability,
        multimodal_inputs:multimodalInputs,
        supported_reference_modes:[
            ...(capability.commands?.multimodal2video ? ['multimodal_all_around'] : []),
            ...(capability.commands?.frames2video ? ['first_last_frames'] : [])
        ]
    };
}
function smartVideoCapabilityReconcile(settings={}, references=[], capability=null){
    const next = {...(settings || {})};
    const state = smartVideoCapabilityResolve(next, references, capability);
    const invalidated = [];
    next.videoReferenceMode = state.reference_mode || next.videoReferenceMode || 'multimodal_all_around';
    next.videoUseFrameRoles = state.command === 'frames2video';
    next.videoMultimodal = state.command === 'multimodal2video';
    if(state.aspect_ratio_locked){
        if(next.videoAspect !== 'adaptive') invalidated.push('aspect_ratio');
        next.videoAspect = 'adaptive';
    } else if(!state.aspect_ratios.includes(String(next.videoAspect || ''))){
        if(next.videoAspect) invalidated.push('aspect_ratio');
        next.videoAspect = state.aspect_ratios.includes('16:9') ? '16:9' : (state.aspect_ratios[0] || '');
    }
    if(!state.video_resolutions.includes(String(next.videoResolution || '').toLowerCase())){
        if(next.videoResolution) invalidated.push('video_resolution');
        next.videoResolution = state.video_resolutions.includes('720p') ? '720p' : (state.video_resolutions[0] || '');
    }
    const currentDuration = Number(next.videoDuration) || 5;
    const duration = Math.max(state.duration_seconds.minimum, Math.min(state.duration_seconds.maximum, currentDuration));
    if(duration !== currentDuration) invalidated.push('duration');
    next.videoDuration = duration;
    return {settings:next,state,invalidated};
}
function smartVideoCapabilityValidateCount(count, limit={}, reason='reference-count'){
    const minimum = limit.minimum === null || limit.minimum === undefined || limit.minimum === ''
        ? null
        : Number(limit.minimum);
    const maximum = limit.maximum === null || limit.maximum === undefined || limit.maximum === ''
        ? null
        : Number(limit.maximum);
    if(Number.isFinite(minimum) && count < minimum){
        return {valid:false,reason,count,minimum,maximum:Number.isFinite(maximum) ? maximum : null};
    }
    if(Number.isFinite(maximum) && count > maximum){
        return {valid:false,reason,count,minimum:Number.isFinite(minimum) ? minimum : null,maximum};
    }
    return {valid:true,reason:'',count,minimum:Number.isFinite(minimum) ? minimum : null,maximum:Number.isFinite(maximum) ? maximum : null};
}
function smartVideoCapabilityValidateReferences(state={}){
    const counts = state.counts || {};
    const inputs = state.multimodal_inputs || {};
    if(Number(counts.total || 0) > 0 && !state.reference_mode){
        return {valid:false,reason:'reference-mode-unsupported',count:Number(counts.total || 0)};
    }
    if(state.command === 'image2video'){
        if(Number(counts.total || 0) !== Number(counts.image || 0)) return {valid:false,reason:'image-media-type',count:Number(counts.total || 0)};
        return smartVideoCapabilityValidateCount(Number(counts.image || 0), state.command_capability?.image_count || state.reference_limit, 'image-count');
    }
    if(state.command === 'frames2video'){
        if(Number(counts.total || 0) !== Number(counts.image || 0)) return {valid:false,reason:'frame-media-type',count:Number(counts.total || 0)};
        return smartVideoCapabilityValidateCount(Number(counts.image || 0), state.command_capability?.image_count || state.reference_limit, 'frame-count');
    }
    if(state.command !== 'multimodal2video') return {valid:true,reason:''};
    if(inputs.audio_only_supported === false && !counts.image && !counts.video) return {valid:false,reason:'visual-reference-required'};
    for(const kind of ['image','video','audio']){
        const result = smartVideoCapabilityValidateCount(Number(counts[kind] || 0), inputs[`${kind}_count`] || {}, `${kind}-count`);
        if(!result.valid) return result;
    }
    return smartVideoCapabilityValidateCount(Number(counts.total || 0), inputs.total_count || {}, 'total-count');
}
function smartVideoCapabilityOptionMode(capability={}, option=''){
    return String(capability?.composer_options?.[option] || 'unsupported');
}
function smartVideoCapabilityApplyComposerOptions(settings={}, capability={}){
    const next = {...(settings || {})};
    if(!capability?.backend_path?.id) return next;
    const definitions = capability?.composer_option_definitions || {};
    Object.entries(definitions).forEach(([option, definition]) => {
        const settingKey = String(definition?.setting_key || '');
        if(settingKey && smartVideoCapabilityOptionMode(capability, option) !== 'user_toggle'){
            next[settingKey] = false;
        }
    });
    return next;
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.videoCapabilities = Object.freeze({
    load:smartVideoCapabilityLoad,
    current:smartVideoCapabilityCurrent,
    fallback:smartVideoCapabilityFallback,
    clean:smartVideoCapabilityClean,
    supportedModels:smartVideoCapabilitySupportedModels,
    canonicalModel:smartVideoCapabilityCanonicalModel,
    referenceCounts:smartVideoCapabilityReferenceCounts,
    resolve:smartVideoCapabilityResolve,
    reconcile:smartVideoCapabilityReconcile,
    validateReferences:smartVideoCapabilityValidateReferences,
    optionMode:smartVideoCapabilityOptionMode,
    applyComposerOptions:smartVideoCapabilityApplyComposerOptions
});
