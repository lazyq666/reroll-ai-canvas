/*
 * Smart Canvas Generation Provider Module
 *
 * Routes resolved Prompt Authoring input and a Generation Settings snapshot to
 * one provider. The Interface always resolves to exactly one of:
 * completed {outputs}, pending {tasks}, or queued {signal}.
 */
let transientSmartCloudLinks = [];

function generationProviderCompleted(outputs, kind='image'){
    return {
        state:'completed',
        kind:kind || mediaKindForUrls(outputs || [], 'image'),
        outputs:resultMediaUrls(outputs || [])
    };
}
function generationProviderPending(tasks, kind='image'){
    return {
        state:'pending',
        kind,
        tasks:(tasks || []).filter(task => task?.taskId).map(task => ({...task, kind:task.kind || kind}))
    };
}
function generationProviderQueued(signal, kind='image'){
    return {
        state:'queued',
        kind:signal?.kind || kind,
        signal:{
            jimengPending:true,
            submitId:signal?.submitId || signal?.submit_id || '',
            kind:signal?.kind || kind,
            actorId:signal?.actorId || signal?.actor_id || '',
            queueInfo:signal?.queueInfo || signal?.queue_info || {},
            message:signal?.message || tr('smart.cloudQueued')
        }
    };
}
function generationProviderFieldKind(field){
    if(['image','video','audio'].includes(field?.type)) return field.type;
    const key = `${field?.input || ''} ${field?.name || ''}`.toLowerCase();
    if(field?.type === 'textarea' || /prompt|text|提示词|正向|负向/.test(key)) return 'prompt';
    return 'setting';
}
function generationProviderWorkflowValues(config, values={}){
    const params = {};
    (config?.fields || []).forEach(field => {
        if(!field?.node || !field?.input) return;
        let value = values[field.id];
        if(value === undefined) value = field.default;
        if(field.type === 'number' || field.type === 'slider'){
            const number = Number(value);
            if(Number.isFinite(number)) value = field.step && Number(field.step) < 1 ? number : Math.round(number);
        } else if(field.type === 'boolean'){
            value = Boolean(value);
        } else if(field.type === 'dropdown' && typeof value === 'string'){
            const stringValue = value.trim();
            if(stringValue && /^-?\d+(?:\.\d+)?(?:e-?\d+)?$/i.test(stringValue)){
                value = stringValue.includes('.') || /e/i.test(stringValue) ? Number(stringValue) : parseInt(stringValue, 10);
            }
        }
        params[field.node] = params[field.node] || {};
        params[field.node][field.input] = value;
    });
    return params;
}
function generationProviderSleep(ms){
    return new Promise(resolve => setTimeout(resolve, ms));
}
function generationProviderRunIdentity(context={},index=0){
    const operationId = String(context.operationId || '');
    const nodeIds = Array.isArray(context.nodeIds) ? context.nodeIds : [];
    const nodeId = String(nodeIds[index] || context.nodeId || '');
    return operationId ? {
        canvas_id:String(context.canvasId || canvasId || ''),
        node_id:nodeId,
        generation_operation_id:operationId,
        generation_request_index:index
    } : {};
}
async function generationProviderCreateComfyTask(payload){
    const response = await fetch('/api/canvas-comfy-tasks', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
    });
    if(!response.ok) throw new Error(await smartResponseErrorMessage(response, tr('smart.errRunFailed')));
    return response.json();
}
async function generationProviderWaitComfyTask(taskId){
    if(!taskId) throw new Error(tr('smart.errRunFailed'));
    while(true){
        const response = await fetch(`/api/canvas-comfy-tasks/${encodeURIComponent(taskId)}`);
        if(!response.ok) throw new Error(await smartResponseErrorMessage(response, tr('smart.errRunFailed')));
        const data = await response.json();
        const readyResult = data?.result || data?.outputs || data?.images || data?.videos || data?.audios || data?.texts;
        if(readyResult && resultMediaUrls(readyResult).length) return data.result || data;
        if(data.status === 'succeeded') return data.result || {};
        if(data.status === 'discarded'){
            const error = new Error(data.message || tr('smart.targetDeleted'));
            error.generationDiscarded = true;
            throw error;
        }
        if(data.status === 'failed') throw new Error(data.error || tr('smart.errRunFailed'));
        await generationProviderSleep(1600);
    }
}
async function generationProviderRunComfyTask(payload){
    const task = await generationProviderCreateComfyTask(payload);
    return generationProviderWaitComfyTask(task.task_id);
}
async function generationProviderComfyName(ref){
    if(ref.comfy_name) return ref.comfy_name;
    const response = await fetch(ref.url);
    if(!response.ok) return ref.name || ref.url;
    const blob = await response.blob();
    const form = new FormData();
    form.append('files', blob, ref.name || 'smart-ref.png');
    const data = await fetch('/api/upload', {method:'POST', body:form}).then(async result => {
        if(!result.ok) throw new Error(await result.text());
        return result.json();
    });
    const name = data.files?.[0]?.comfy_name || ref.name || ref.url;
    const node = ref.nodeId ? nodes.find(item => item.id === ref.nodeId) : null;
    const image = node?.images?.find(item => item.url === ref.url)
        || (nodes || []).flatMap(item => item.images || []).find(item => item?.url === ref.url);
    if(image) image.comfy_name = name;
    ref.comfy_name = name;
    return name;
}
async function generationProviderSubmitComfy(prompt, refs, runSettings, context={}){
    const allRefs = refs || [];
    const imageRefs = imageRefsOnly(allRefs);
    const mode = runSettings.comfyMode || 'text';
    if(mode === 'text'){
        const data = await generationProviderRunComfyTask({
            prompt,
            width:Number(runSettings.width || 1024),
            height:Number(runSettings.height || 1024),
            workflow_json:'Z-Image.json',
            type:'zimage',
            client_id:smartClientId,
            ...generationProviderRunIdentity(context)
        });
        return generationProviderCompleted(data, mediaKindForUrls(resultMediaUrls(data), 'image'));
    }
    if(mode === 'enhance'){
        if(!imageRefs.length) throw new Error(tr('smart.errEnhanceNeedRefs'));
        const inputName = await generationProviderComfyName(imageRefs[0]);
        const data = await generationProviderRunComfyTask({
            workflow_json:'Z-Image-Enhance.json',
            type:'enhance',
            params:{"15":{image:inputName},"204":{value:Number(runSettings.enhanceStrength ?? 0.5)}},
            client_id:smartClientId,
            ...generationProviderRunIdentity(context)
        });
        return generationProviderCompleted(data, mediaKindForUrls(resultMediaUrls(data), 'image'));
    }
    if(mode === 'edit'){
        if(!imageRefs.length) throw new Error(tr('smart.errEditNeedRefs'));
        const names = [];
        for(const ref of imageRefs.slice(0, 3)) names.push(await generationProviderComfyName(ref));
        const data = await generationProviderRunComfyTask({
            prompt,
            workflow_json:'Flux2-Klein.json',
            type:'klein',
            params:{"168":{text:prompt},"158":{noise_seed:Math.floor(Math.random()*1000000)},"278":{image:names[0] || ""},"270":{image:names[1] || ""},"292":{image:names[2] || ""},"313":{value:Boolean(names[1])},"314":{value:Boolean(names[2])}},
            client_id:smartClientId,
            ...generationProviderRunIdentity(context)
        });
        return generationProviderCompleted(data, mediaKindForUrls(resultMediaUrls(data), 'image'));
    }
    const workflowName = String(runSettings.comfyWorkflow || '').trim();
    if(!workflowName) throw new Error(tr('smart.errNeedWorkflow'));
    if(!comfyWorkflows.some(workflow => workflow.name === workflowName)){
        throw new Error(tr('smart.errWorkflowUnavailable'));
    }
    const workflow = await fetch(`/api/workflows/${encodeURIComponent(workflowName)}`).then(async response => {
        if(!response.ok) throw new Error(await response.text());
        return response.json();
    });
    const fields = workflow.config?.fields || [];
    const values = {};
    fields.filter(field => generationProviderFieldKind(field) === 'prompt').forEach((field, index) => {
        values[field.id] = index === 0 ? prompt : (field.default ?? '');
    });
    const assignMediaFields = async (mediaFields, mediaRefs) => {
        for(let index = 0; index < mediaFields.length && index < mediaRefs.length; index++){
            values[mediaFields[index].id] = await generationProviderComfyName(mediaRefs[index]);
        }
    };
    await assignMediaFields(fields.filter(field => generationProviderFieldKind(field) === 'image'), imageRefs);
    await assignMediaFields(fields.filter(field => generationProviderFieldKind(field) === 'video'), videoRefsOnly(allRefs));
    await assignMediaFields(fields.filter(field => generationProviderFieldKind(field) === 'audio'), audioRefsOnly(allRefs));
    fields.filter(field => generationProviderFieldKind(field) === 'setting').forEach(field => {
        values[field.id] = comfyRandomEnabledField(field) && smartComfyRandomActiveFor(runSettings, field.id)
            ? smartComfyRandomValue(field)
            : runSettings.comfyParams?.[field.id] ?? field.default;
    });
    const result = await generationProviderRunComfyTask({
        prompt,
        workflow_json:workflowName,
        params:generationProviderWorkflowValues(workflow.config || {fields:[]}, values),
        type:'workflow-custom',
        client_id:smartClientId,
        ...generationProviderRunIdentity(context)
    });
    const outputs = resultMediaUrls(result);
    const fallbackKind = result.videos?.length ? 'video' : result.audios?.length ? 'audio' : result.texts?.length ? 'text' : 'image';
    return generationProviderCompleted(outputs, mediaKindForUrls(outputs, fallbackKind));
}
async function generationProviderSubmitApiImage(prompt, refs, runSettings, context={}){
    if(!runSettings.provider_id || !runSettings.model) throw new Error(tr('smart.errNoApiModel'));
    if(
        typeof smartCatalogHasSelection === 'function'
        && !smartCatalogHasSelection('image', runSettings.provider_id, runSettings.model)
    ){
        throw new Error(tr('smart.errNoApiModel'));
    }
    const capabilityModule = window.SmartCanvasModules.imageCapabilities;
    const capability = capabilityModule?.current?.(runSettings.provider_id, runSettings.model);
    const resolvedOutput = capabilityModule?.resolveForSubmission?.(
        runSettings,
        imageRefsOnly(refs),
        capability
    );
    const sizeValidation = resolvedOutput ||
        window.SmartCanvasModules.generationSettings?.validateImageSize?.(
            runSettings,
            {
                references:imageRefsOnly(refs),
                capability,
                allowAuto:
                    typeof isGptImageAutoSizeModel === 'function'
                    && isGptImageAutoSizeModel(runSettings.model)
            }
        );
    if(sizeValidation && !sizeValidation.valid){
        throw new Error(tr('smart.errInvalidSize'));
    }
    const count = Math.max(1, Math.min(8, Number(runSettings.count || 1)));
    const referenceAspectRatio = resolvedOutput?.automatic
        ? capabilityModule?.referenceAspectRatio?.(imageRefsOnly(refs)) || ''
        : '';
    const [referenceWidth,referenceHeight] = referenceAspectRatio.split(':').map(Number);
    const referenceImages = imageRefsOnly(refs).slice(0, SMART_REFERENCE_IMAGE_MAX).map((reference,index) => (
        index === 0 && referenceAspectRatio
            ? {...reference,natural_w:referenceWidth,natural_h:referenceHeight}
            : reference
    ));
    const payload = {
        prompt,
        provider_id:runSettings.provider_id,
        model:runSettings.model,
        size:sizeForRun(runSettings, resolvedOutput?.target_aspect_ratio),
        target_aspect_ratio:resolvedOutput?.target_aspect_ratio || '',
        reference_aspect_ratio:referenceAspectRatio,
        resolution_tier:String(runSettings.resolution || '').toUpperCase(),
        quality:runSettings.quality || 'auto',
        transparent_png:capability?.supports_transparent_png === true && runSettings.transparentPng === true,
        n:1,
        reference_images:referenceImages
    };
    const submitted = await Promise.all(Array.from({length:count}, (_,index) => fetch('/api/canvas-image-tasks', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
            ...payload,
            ...generationProviderRunIdentity(context,index)
        })
    }).then(async response => {
        if(!response.ok) throw new Error(await response.text());
        return response.json();
    })));
    const tasks = submitted.map((item,index) => ({
        taskId:item.task_id,
        actorId:item.actor_id || '',
        kind:'image',
        providerId:payload.provider_id,
        model:payload.model,
        nodeId:Array.isArray(context.nodeIds)
            ? String(context.nodeIds[index] || '')
            : String(context.nodeId || ''),
        generationBatchId:String(context.generationBatchId || ''),
        generationSlotIndex:index,
        generationSlotCount:Array.isArray(context.nodeIds)
            ? context.nodeIds.length
            : 1,
        generationRequestIndex:index
    })).filter(task => task.taskId);
    if(!tasks.length) throw new Error(tr('smart.errRunFailed'));
    return generationProviderPending(tasks, 'image');
}
async function generationProviderSubmitRunningHub(prompt, refs, runSettings, context={}){
    const ref = selectedRunningHubRef(runSettings);
    if(!ref){
        throw new Error(
            runSettings.rhConfigKey
                ? tr('smart.errRhConfigUnavailable')
                : tr('smart.rhNeedConfig')
        );
    }
    const fields = rhActiveFields(runSettings);
    if(!fields.length) throw new Error(tr('smart.rhNeedFields'));
    const media = rhMediaForRun(prompt, refs);
    const nodeInfoList = await rhBuildNodeInfoList(media, runSettings, {});
    const extras = ref.kind === 'workflow' ? await rhBuildWorkflowRequestExtras(media, nodeInfoList, runSettings) : {};
    const endpoint = ref.kind === 'workflow' ? '/api/runninghub/workflow-submit' : '/api/runninghub/submit';
    const body = ref.kind === 'workflow'
        ? {workflowId:ref.id, nodeInfoList, useWallet:runSettings.rhPayment === 'wallet', ...extras, ...generationProviderRunIdentity(context)}
        : {webappId:ref.id, nodeInfoList, instanceType:runSettings.rhInstanceType || '', useWallet:runSettings.rhPayment === 'wallet', ...generationProviderRunIdentity(context)};
    const submit = await fetch(endpoint, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body)
    }).then(async response => {
        const data = await response.json();
        if(!response.ok || data.success === false) throw new Error(data.detail || data.error || tr('smart.rhFailed'));
        return data.data || data;
    });
    if(!submit.taskId) throw new Error(tr('smart.rhNoTaskId'));
    const useWallet = runSettings.rhPayment === 'wallet';
    for(let index = 0; index < 720; index++){
        await generationProviderSleep(2500);
        const data = await fetch(`/api/runninghub/query?taskId=${encodeURIComponent(submit.taskId)}&useWallet=${useWallet ? '1' : '0'}`).then(async response => {
            const json = await response.json();
            if(!response.ok || json.success === false) throw new Error(json.detail || json.error || tr('smart.rhFailed'));
            return json.data || json;
        });
        if(data.status === 'SUCCESS'){
            const outputs = resultMediaUrls(data.image_items?.length ? data.image_items : (data.urls || []));
            if(!outputs.length) throw new Error(tr('smart.rhOutputsEmpty'));
            return generationProviderCompleted(outputs, mediaKindForUrls(outputs, 'image'));
        }
        if(data.status === 'FAILED') throw new Error(data.failReason || tr('smart.rhFailed'));
    }
    throw new Error(tr('smart.rhTimeout'));
}
async function generationProviderPostVideoTask(payload){
    const body = JSON.stringify(payload);
    const post = endpoint => fetch(endpoint, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body
    });
    let response = await post('/api/canvas-video-tasks');
    if(!response.ok && response.status === 404){
        response = await post('/api/canvas-video');
    }
    if(!response.ok){
        throw new Error(await smartResponseErrorMessage(response, tr('smart.errRunFailed')));
    }
    return response.json();
}
async function generationProviderSubmitVideo(prompt, refs, runSettings, context={}){
    if(!runSettings.videoProvider || !runSettings.videoModel){
        throw new Error(tr('smart.errNoVideoModel'));
    }
    if(
        typeof smartCatalogHasSelection === 'function'
        && !smartCatalogHasSelection(
            'video',
            runSettings.videoProvider,
            runSettings.videoModel
        )
    ){
        throw new Error(tr('smart.errNoVideoModel'));
    }
    try {
        const uploadedRefs = applyUploadedUrlsToSmartRefs(refs, runSettings);
        const manualLinks = manualSmartMediaLinks(runSettings).map(item => ({...item,kind:item.kind || 'video'}));
        const videoCapabilities = window.SmartCanvasModules.videoCapabilities;
        const videoCapabilityContext = typeof smartVideoCapabilityProviderContext === 'function'
            ? smartVideoCapabilityProviderContext(runSettings)
            : {};
        const videoCapability = await videoCapabilities?.load(
            runSettings.videoProvider,
            runSettings.videoModel,
            videoCapabilityContext
        );
        const optionSettings = videoCapabilities?.applyComposerOptions(runSettings, videoCapability) || runSettings;
        const jimengCapability = runSettings.videoProvider === 'jimeng' ? videoCapability : null;
        const resolvedState = videoCapabilities.resolve(
            optionSettings,
            [...uploadedRefs,...manualLinks],
            videoCapability
        );
        const jimengResolved = jimengCapability
            ? videoCapabilities.reconcile(optionSettings, [...uploadedRefs,...manualLinks], jimengCapability)
            : null;
        const effectiveSettings = jimengResolved?.settings || optionSettings;
        const referenceState = jimengResolved?.state || resolvedState;
        const referenceValidation = videoCapabilities.validateReferences(referenceState);
        if(!referenceValidation.valid){
            throw new Error(trf('smart.videoReferenceInvalid', {
                reason:referenceValidation.reason || '',
                count:referenceValidation.count ?? referenceState.counts.total,
                minimum:referenceValidation.minimum ?? '—',
                maximum:referenceValidation.maximum ?? '—'
            }));
        }
        const trustedSource = runSettings.videoTrustedAsset
            ? (['library','cloud','manual'].includes(runSettings.videoTrustedSource) ? runSettings.videoTrustedSource : 'library')
            : 'none';
        const useAssetUris = trustedSource === 'library';
        const targetPlatform = videoProviderPlatform(runSettings.videoProvider);
        let mismatchedAsset = false;
        const effectiveUrl = ref => {
            const uris = ref?.asset_uris && typeof ref.asset_uris === 'object' ? ref.asset_uris : null;
            if(useAssetUris && uris && Object.keys(uris).length){
                if(targetPlatform && uris[targetPlatform]) return uris[targetPlatform];
                mismatchedAsset = true;
            }
            return ref?.url;
        };
        const images = imageRefsOnly(uploadedRefs, null).map((ref, index) => {
            const item = {
                url:effectiveUrl(ref),
                name:ref.name || trf('canvas.imageNumber', {number: index + 1}),
                instance_id:ref.inputInstanceId || ref.outputId || inputRefKey(ref)
            };
            if(effectiveSettings.videoUseFrameRoles){
                if(index === 0) item.role = 'first_frame';
                else if(index === 1) item.role = 'last_frame';
            }
            return item;
        });
        const manualVideo = manualSmartVideoLink(runSettings)?.url || '';
        const videos = manualVideo
            ? manualSmartMediaLinks(runSettings).map(item => item.url).filter(Boolean)
            : videoRefsOnly(uploadedRefs).map(effectiveUrl).filter(Boolean);
        const audios = audioRefsOnly(uploadedRefs).map(effectiveUrl).filter(Boolean);
        if(mismatchedAsset) toast(tr('smart.assetPlatformMismatch'));
        const result = await generationProviderPostVideoTask({
            prompt,
            provider_id:runSettings.videoProvider,
            model:runSettings.videoModel,
            duration:Number(effectiveSettings.videoDuration) || 5,
            aspect_ratio:effectiveSettings.videoAspect || '16:9',
            resolution:effectiveSettings.videoResolution || '',
            images,
            videos,
            audios,
            enhance_prompt:Boolean(effectiveSettings.videoEnhancePrompt),
            enable_upsample:Boolean(effectiveSettings.videoEnableUpsample),
            watermark:Boolean(effectiveSettings.videoWatermark),
            camerafixed:Boolean(effectiveSettings.videoCameraFixed),
            generate_audio:Boolean(effectiveSettings.videoGenerateAudio),
            multimodal:jimengResolved
                ? jimengResolved.state.command === 'multimodal2video'
                : Boolean(runSettings.videoMultimodal),
            trusted_asset:useAssetUris,
            ...generationProviderRunIdentity(context)
        });
        if(result?.task_id){
            return generationProviderPending([{
                taskId:result.task_id,
                actorId:result.actor_id || '',
                kind:'video',
                providerId:runSettings.videoProvider,
                model:runSettings.videoModel,
                nodeId:String(context.nodeId || ''),
                generationRequestIndex:0
            }], 'video');
        }
        if(result?.jimeng_pending) return generationProviderQueued({
            submitId:result.submit_id,
            kind:result.kind || 'video',
            actorId:result.actor_id || '',
            queueInfo:result.queue_info,
            message:result.message
        }, 'video');
        return generationProviderCompleted(result, 'video');
    } finally {
        transientSmartCloudLinks = [];
    }
}
async function generationProviderUrlToBase64(url){
    const response = await fetch(url);
    if(!response.ok) throw new Error(tr('smart.errImageRead'));
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
async function generationProviderSubmitModelscope(prompt, refs, runSettings, context={}){
    const imageRefs = imageRefsOnly(refs);
    const modelKey = runSettings.msgenModel || 'zimage';
    const model = MS_GEN_MODELS[modelKey];
    if(!model) throw new Error(tr('smart.errMsModelUnavailable'));
    const customModel = String(runSettings.msCustomModel || '').trim();
    if(
        modelKey === 'custom'
        && !modelscopeImageModels().includes(customModel)
    ){
        throw new Error(tr('smart.errMsModelUnavailable'));
    }
    const sizeValidation =
        window.SmartCanvasModules.generationSettings?.validateImageSize?.(
            runSettings,
            {prefix:'ms', allowAuto:false}
        );
    if(sizeValidation && !sizeValidation.valid){
        throw new Error(tr('smart.errInvalidSize'));
    }
    if(model.supportsImage && !imageRefs.length) throw new Error(tr('smart.errMsNeedRefs'));
    const parsed = parseSizeValue(apiImageSize(
        runSettings.msRatio || 'square',
        runSettings.msResolution || '1k',
        runSettings.msCustomRatio || '',
        runSettings.msCustomSize || ''
    ));
    const width = Number(parsed?.width) || 1024;
    const height = Number(parsed?.height) || 1024;
    const imageUrls = [];
    if(model.supportsImage || model.acceptsImage){
        for(const ref of imageRefs.slice(0, SMART_REFERENCE_IMAGE_MAX)){
            if(ref.url) imageUrls.push(await generationProviderUrlToBase64(ref.url).catch(() => ref.url));
        }
    }
    const count = Math.max(1, Math.min(8, Number(runSettings.count || 1)));
    const submit = async (_, index) => {
        let body;
        if(modelKey === 'zimage') body = {prompt, resolution:`${width}x${height}`};
        else if(modelKey === 'qwen_edit') body = {prompt, image_urls:imageUrls, resolution:`${width}x${height}`};
        else body = {
            prompt,
            model:modelKey === 'custom' ? customModel : model.modelId,
            image_urls:imageUrls,
            width,
            height,
            size:`${width}x${height}`
        };
        Object.assign(body, generationProviderRunIdentity(context,index));
        const data = await fetch(model.endpoint, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(body)
        }).then(async response => {
            if(!response.ok) throw new Error(await response.text());
            return response.json();
        });
        return data.url || data.images?.[0] || '';
    };
    return generationProviderCompleted((await Promise.all(Array.from({length:count}, submit))).filter(Boolean), 'image');
}
async function submitGenerationProvider({prompt='', refs=[], settings:runSettings={}, context={}}={}){
    if(runSettings.engine === 'comfy') return generationProviderSubmitComfy(prompt, refs, runSettings, context);
    if(runSettings.engine === 'runninghub' && runningHubSelectedModel(runSettings)){
        return generationProviderSubmitApiImage(prompt, refs, runningHubModelApiSettings(runSettings), context);
    }
    if(isApiLikeEngine(runSettings.engine) && runSettings.apiKind === 'video'){
        return generationProviderSubmitVideo(prompt, refs, runSettings, context);
    }
    if(isApiLikeEngine(runSettings.engine)) return generationProviderSubmitApiImage(prompt, refs, runSettings, context);
    if(runSettings.engine === 'runninghub') return generationProviderSubmitRunningHub(prompt, refs, runSettings, context);
    if(runSettings.engine === 'modelscope') return generationProviderSubmitModelscope(prompt, refs, runSettings, context);
    throw new Error(`Unsupported generation provider: ${runSettings.engine || 'unknown'}`);
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.generationProvider = Object.freeze({
    submit(options={}){
        return submitGenerationProvider(options);
    },
    fieldKind(field){
        return generationProviderFieldKind(field);
    },
});
