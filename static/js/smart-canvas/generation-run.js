/*
 * Smart Canvas Generation Run Module
 *
 * Owns provider submission and Generation Run orchestration. Result
 * application is delegated to the Generation Output Module.
 */
const generationSettingsModule = window.SmartCanvasModules?.generationSettings;
if(!generationSettingsModule) throw new Error('Generation Settings Module failed to load');
const promptAuthoringModule = window.SmartCanvasModules?.promptAuthoring;
if(!promptAuthoringModule) throw new Error('Prompt Authoring Module failed to load');
const generationProviderModule = window.SmartCanvasModules?.generationProvider;
if(!generationProviderModule) throw new Error('Generation Provider Module failed to load');
const generationOutputModule = window.SmartCanvasModules?.generationOutput;
if(!generationOutputModule) throw new Error('Generation Output Module failed to load');
const generationRunPersistenceModule = window.SmartCanvasModules?.canvasPersistence;
if(!generationRunPersistenceModule) throw new Error('Canvas Persistence Module failed to load');
const generationRunMutationModule = window.SmartCanvasModules?.canvasMutation;
if(!generationRunMutationModule) throw new Error('Canvas Mutation Module failed to load');
const generationRunContainerModule = window.SmartCanvasModules?.smartContainer;
if(!generationRunContainerModule) throw new Error('Smart Container Module failed to load');
let runBtnCooldownToken = 0;
let smartRunStateToken = 0;
const smartNodeRunTokens = new Map();
let smartRhRandomValues = {};
const generationRunQueuedResumes = new Set();
const GENERATION_RUN_QUEUE_STORAGE_PREFIX = 'infiniteCanvasGenerationQueue:v1:';
function activeGenerationCascadeModule(){
    return window.SmartCanvasModules?.generationCascade || null;
}
function generationRunOnline(){
    return typeof generationRunPersistenceModule.online === 'function'
        ? generationRunPersistenceModule.online()
        : generationRunPersistenceModule.editable?.();
}
function generationRunClone(value){
    if(value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}
function generationRunHasIncomingSourceConnection(node){
    if(!node?.id) return false;
    if((canvas?.connections || []).some(connection =>
        connection.to === node.id
        && ['input','flow'].includes(connection.kind || 'flow')
    )) return true;
    return (node.inputNodeIds || []).some(fromId =>
        nodes.some(candidate => candidate.id === fromId)
    );
}
function generationRunReferenceSnapshot(ref={}){
    if(typeof inputReferenceSnapshot === 'function') return inputReferenceSnapshot(ref);
    return {
        url:ref?.url || '', name:ref?.name || '',
        media_id:ref?.media_id || ref?.mediaId || '',
        assetLibraryEntryId:ref?.assetLibraryEntryId || ref?.assetEntryId || '',
        sourceNodeTitle:ref?.sourceNodeTitle || '', nodeId:ref?.nodeId || '',
        imageIndex:ref?.imageIndex ?? '', outputId:ref?.outputId || '',
        inputInstanceId:ref?.inputInstanceId || '', kind:ref?.kind || '', role:ref?.role || ''
    };
}
function generationRunQueueStorage(){
    try {
        return window.sessionStorage || null;
    } catch(error){
        return null;
    }
}
function generationRunReadQueuedIntents(){
    const storage = generationRunQueueStorage();
    if(!storage || !canvasId) return {};
    try {
        const value = JSON.parse(
            storage.getItem(`${GENERATION_RUN_QUEUE_STORAGE_PREFIX}${canvasId}`)
            || '{}'
        );
        return value && typeof value === 'object' && !Array.isArray(value)
            ? value
            : {};
    } catch(error){
        return {};
    }
}
function generationRunWriteQueuedIntents(intents={}){
    const storage = generationRunQueueStorage();
    if(!storage || !canvasId) return false;
    const key = `${GENERATION_RUN_QUEUE_STORAGE_PREFIX}${canvasId}`;
    try {
        if(Object.keys(intents).length) storage.setItem(key, JSON.stringify(intents));
        else storage.removeItem(key);
        return true;
    } catch(error){
        return false;
    }
}
function generationRunStoreQueuedIntent(nodeId, intent=null){
    const intents = generationRunReadQueuedIntents();
    if(intent) intents[nodeId] = generationRunClone(intent);
    else delete intents[nodeId];
    return generationRunWriteQueuedIntents(intents);
}
function generationRunRestoreQueuedIntents(){
    const intents = generationRunReadQueuedIntents();
    let changed = false;
    Object.entries(intents).forEach(([nodeId, intent]) => {
        const node = nodes.find(item => item.id === nodeId);
        if(!node){
            delete intents[nodeId];
            changed = true;
            return;
        }
        node.queuedGenerationRun = generationRunClone(intent);
        node.queued = true;
    });
    if(changed) generationRunWriteQueuedIntents(intents);
    if(Object.keys(intents).length) render();
    return intents;
}
function generationRunQueueIntent(node, intent={}){
    if(!node || generationRunPersistenceModule.editable?.() === false){
        return false;
    }
    node.queuedGenerationRun = {
        ...generationRunClone(intent),
        queuedAt:nowMs()
    };
    node.queued = true;
    delete node.generationRunFeedback;
    generationRunStoreQueuedIntent(node.id, node.queuedGenerationRun);
    render();
    return true;
}
function generationRunResumeQueued(){
    generationRunRestoreQueuedIntents();
    if(!generationRunOnline()) return false;
    nodes.filter(node => node?.queuedGenerationRun).forEach(node => {
        if(generationRunQueuedResumes.has(node.id)) return;
        generationRunQueuedResumes.add(node.id);
        let resumedIntent = null;
        Promise.resolve().then(async () => {
            if(
                typeof generationRunPersistenceModule.synced === 'function'
                && !await generationRunPersistenceModule.synced({timeout:15000})
            ){
                setTimeout(generationRunResumeQueued, 1500);
                return;
            }
            const current = nodes.find(item => item.id === node.id);
            if(!current?.queuedGenerationRun || !generationRunOnline()) return;
            const intent = generationRunClone(current.queuedGenerationRun);
            resumedIntent = intent;
            delete current.queuedGenerationRun;
            current.queued = false;
            generationRunStoreQueuedIntent(current.id, null);
            if(intent.action === 'loop'){
                await activeGenerationCascadeModule()?.run({nodeId:current.id, node:current});
            } else if(intent.action === 'regenerate'){
                await regenerateGenerationRun(current.id);
            } else if(intent.action === 'single'){
                await runGeneration({
                    node:current,
                    ...(intent.options || {}),
                    request:intent.request,
                    runSettings:intent.runSettings
                });
            }
        }).catch(error => {
            const current = nodes.find(item => item.id === node.id);
            if(
                current
                && resumedIntent
                && (error?.generationSyncPending || !generationRunOnline())
            ){
                generationRunQueueIntent(current, resumedIntent);
                return;
            }
            if(!error?.generationDiscarded){
                toast((error?.message || tr('smart.errRunFailed')).slice(0, 160));
            }
        }).finally(() => {
            generationRunQueuedResumes.delete(node.id);
        });
    });
    return true;
}
function activeGenerationRecoveryModule(){
    return window.SmartCanvasModules?.generationRecovery || null;
}
async function generationRunRestoreActive(){
    if(!canvasId) return false;
    try {
        const response = await fetch(
            `/api/canvases/${encodeURIComponent(canvasId)}/generation-runs/active`,
            {cache:'no-store'}
        );
        if(!response.ok) return false;
        const payload = await response.json();
        return Boolean(
            activeGenerationRecoveryModule()?.restoreActive?.({
                runs:Array.isArray(payload?.runs) ? payload.runs : []
            })
        );
    } catch(error){
        return false;
    }
}
function generationRunFailureDetail(error=null){
    const diagnostics = error?.generationTask?.diagnostics || null;
    return window.SmartCanvasModules.generationFailureFeedback.classify({
        technicalError:error?.message || String(error || ''),
        httpStatus:error?.status || diagnostics?.http_status || 0,
        providerId:diagnostics?.provider_id || '',
        billingEvidence:diagnostics?.billing_evidence || {},
    });
}
function generationRunNodeFailureFeedback(error=null){
    const detail = generationRunFailureDetail(error);
    return {
        successfulCount:0,
        failedCount:1,
        reasonCategories:detail?.category ? [detail.category] : [],
        finishedAt:nowMs()
    };
}
function generationRunReportFailure({run, runMs=0, error=null}={}){
    if(!error || error.smartGenerationLogged) return null;
    const diagnostics = error.generationTask?.diagnostics || null;
    const detail = generationRunFailureDetail(error);
    const failureFeedback = window.SmartCanvasModules.generationFailureFeedback;
    const operationName = failureFeedback.actionName(run, tr);
    const failureTask = {
        status:'failed',
        technicalError:detail.technicalError,
        httpStatus:detail.httpStatus,
        providerId:detail.providerId,
        billingEvidence:detail.billingEvidence,
    };
    const aggregateFailure = () => failureFeedback.aggregate(
        [failureTask], tr, trf, {actionName:operationName}
    );
    const entry = addSmartGenerationLog({
        run,
        outputs:[],
        runMs,
        error:detail.technicalError,
        status:'failed',
        tasks:[failureTask],
        diagnostics,
    });
    error.smartGenerationLogged = true;
    const aggregate = aggregateFailure();
    toast(aggregate.message, {
        persistent:true,
        detailLogId:entry?.id || '',
        detailRunId:run?.generationRunId || '',
        heading:aggregate.title,
        headingFactory:() => aggregateFailure().title,
        textFactory:() => aggregateFailure().message,
    });
    return entry;
}
function generationRunReportBatchResult({run, runMs=0, result=null}={}){
    if(!result) return null;
    const tasks = (result.slotResults || []).map((slot,index) => {
        const diagnostics = slot.cause?.generationTask?.diagnostics || {};
        return {
            index,
            status:slot.error ? 'failed' : 'succeeded',
            technicalError:slot.error || '',
            httpStatus:slot.cause?.status || diagnostics.http_status || 0,
            providerId:diagnostics.provider_id || '',
            billingEvidence:diagnostics.billing_evidence || {},
        };
    });
    const failedTasks = tasks.filter(task => task.status === 'failed');
    const entry = addSmartGenerationLog({
        run,
        outputs:result.urls || [],
        runMs,
        ...(failedTasks.length ? {
            status:(result.urls || []).length ? 'partial' : 'failed',
            error:failedTasks[0].technicalError,
            tasks,
        } : {})
    });
    if(!failedTasks.length) return entry;
    const failureFeedback = window.SmartCanvasModules.generationFailureFeedback;
    const operationName = failureFeedback.actionName(run, tr);
    const aggregateFailure = () => failureFeedback.aggregate(
        tasks, tr, trf, {actionName:operationName}
    );
    const aggregate = aggregateFailure();
    toast(aggregate.message, {
        persistent:true,
        detailLogId:entry?.id || '',
        detailRunId:run?.generationRunId || '',
        heading:aggregate.title,
        headingFactory:() => aggregateFailure().title,
        textFactory:() => aggregateFailure().message,
    });
    return entry;
}
const GENERATION_PRESENTATION_KEYS = Object.freeze([
    'w','h','runPrompt','runModelPrompt','runPromptRefs','runInputRefs',
    'runSettings','sourceNodeId','runAt','promptDraftHtml','promptDraftText'
]);
function captureGenerationPresentationSnapshot(node){
    return Object.fromEntries(GENERATION_PRESENTATION_KEYS.map(key => [
        key,
        Object.prototype.hasOwnProperty.call(node || {}, key)
            ? {
                present:true,
                value:node[key] === undefined
                    ? undefined
                    : JSON.parse(JSON.stringify(node[key]))
            }
            : {present:false}
    ]));
}
function restoreGenerationPresentationSnapshot(node){
    const snapshot = node?.generationPreviousPresentation;
    if(!node || !snapshot) return false;
    GENERATION_PRESENTATION_KEYS.forEach(key => {
        if(snapshot[key]?.present) node[key] = snapshot[key].value;
        else delete node[key];
    });
    delete node.generationPreviousPresentation;
    return true;
}
function coolRunButton(ms=2000){
    if(!runBtn) return 0;
    const token = ++runBtnCooldownToken;
    syncRunButtonState();
    setTimeout(() => {
        if(token === runBtnCooldownToken) syncRunButtonState();
    }, ms);
    return token;
}
function coolNodeRunningState(node, ms=2000){
    if(!node) return 0;
    const token = ++smartRunStateToken;
    smartNodeRunTokens.set(node.id, token);
    node.running = true;
    setTimeout(() => {
        if(smartNodeRunTokens.get(node.id) !== token) return;
        smartNodeRunTokens.delete(node.id);
        const current = nodes.find(n => n.id === node.id);
        if(current){
            current.running = false;
            render();
        }
    }, ms);
    return token;
}
function clearNodeRunningState(node){
    if(!node) return;
    smartNodeRunTokens.delete(node.id);
    node.running = false;
}
async function settleGenerationProviderResult(node, submission, options={}){
    if(!submission || !['completed','pending','queued'].includes(submission.state)){
        throw new Error('Generation Provider returned an invalid result');
    }
    if(submission.state === 'completed'){
        return {
            state:'completed',
            kind:submission.kind || 'image',
            urls:resultMediaUrls(submission.outputs || []),
            applied:false,
            deferred:false
        };
    }
    const recovery = activeGenerationRecoveryModule();
    if(!recovery) throw new Error('Generation Recovery Module failed to load');
    return recovery.settle({
        node,
        submission,
        archiveExisting:Boolean(options.archiveExisting),
        logContext:options.logContext || {},
        submissionSnapshot:options.submissionSnapshot || null
    });
}
async function submitAndSettleGenerationProvider(node, prompt, refs, runSettings=null, options={}){
    const settingsSnapshot = generationSettingsModule.snapshot(runSettings);
    const generationOperationId = [
        smartClientId || 'smart-client',
        'generation',
        Date.now().toString(36),
        Math.random().toString(36).slice(2,10)
    ].join(':');
    node.generationOperationId = generationOperationId;
    node.generationInputSnapshot = {
        prompt:String(prompt || ''),
        refs:(refs || []).map(generationRunReferenceSnapshot).filter(ref => ref.url),
        settings:settingsSnapshot,
        createdAt:Date.now()
    };
    await generationRunPersistenceModule.save();
    if(
        typeof generationRunPersistenceModule.synced === 'function'
        && !await generationRunPersistenceModule.synced({timeout:5000})
    ){
        const error = new Error(tr('smart.syncIncompleteGeneration'));
        error.generationSyncPending = true;
        throw error;
    }
    const submission = await generationProviderModule.submit({
        prompt,
        refs:refs || [],
        settings:settingsSnapshot,
        context:{
            canvasId,
            nodeId:node.id,
            operationId:generationOperationId
        }
    });
    const currentNode = nodes.find(item => item.id === node.id);
    if(!currentNode
        || currentNode.generationOperationId !== generationOperationId){
        const error = new Error(tr('smart.runReplaced'));
        error.generationDiscarded = true;
        throw error;
    }
    await options.onAccepted?.({node:currentNode,submission});
    return settleGenerationProviderResult(currentNode, submission, options);
}
async function submitAndSettleGenerationProviderBatch(slotNodes, prompt, refs, runSettings=null, options={}){
    const slots = (slotNodes || []).filter(Boolean).slice(0,8);
    if(slots.length < 2){
        throw new Error('Generation Batch requires at least two output slots');
    }
    const settingsSnapshot = generationSettingsModule.snapshot(runSettings);
    const generationOperationId = [
        smartClientId || 'smart-client',
        'generation-batch',
        Date.now().toString(36),
        Math.random().toString(36).slice(2,10)
    ].join(':');
    const inputSnapshot = {
        prompt:String(prompt || ''),
        refs:(refs || []).map(generationRunReferenceSnapshot).filter(ref => ref.url),
        settings:settingsSnapshot,
        createdAt:Date.now()
    };
    slots.forEach(slot => {
        slot.generationOperationId = generationOperationId;
        slot.generationInputSnapshot = generationRunClone(inputSnapshot);
    });
    await generationRunPersistenceModule.save();
    if(
        typeof generationRunPersistenceModule.synced === 'function'
        && !await generationRunPersistenceModule.synced({timeout:5000})
    ){
        const error = new Error(tr('smart.syncIncompleteGeneration'));
        error.generationSyncPending = true;
        throw error;
    }
    const submission = await generationProviderModule.submit({
        prompt,
        refs:refs || [],
        settings:settingsSnapshot,
        context:{
            canvasId,
            nodeId:slots[0].id,
            nodeIds:slots.map(slot => slot.id),
            generationBatchId:slots[0].generationBatchId || '',
            operationId:generationOperationId
        }
    });
    const liveSlots = slots.map(slot => nodes.find(item => item.id === slot.id));
    if(liveSlots.some(slot =>
        !slot || slot.generationOperationId !== generationOperationId
    )){
        const error = new Error(tr('smart.runReplaced'));
        error.generationDiscarded = true;
        throw error;
    }
    if(submission.state === 'completed'){
        const outputs = resultMediaUrls(submission.outputs || []);
        return {
            state:'completed',
            kind:submission.kind || 'image',
            urls:outputs,
            applied:false,
            deferred:false,
            slotResults:liveSlots.map((slot,index) => ({
                nodeId:slot.id,
                outputs:outputs[index] ? [outputs[index]] : [],
                error:outputs[index] ? '' : tr('smart.errNoOutImages')
            }))
        };
    }
    if(submission.state !== 'pending'){
        throw new Error('Generation Batch requires completed or pending image tasks');
    }
    const tasks = (submission.tasks || []).slice().sort((left,right) =>
        Number(left.generationSlotIndex ?? left.generationRequestIndex ?? 0)
        - Number(right.generationSlotIndex ?? right.generationRequestIndex ?? 0)
    );
    const recovery = activeGenerationRecoveryModule();
    if(!recovery) throw new Error('Generation Recovery Module failed to load');
    const settled = await Promise.all(liveSlots.map(async (slot,index) => {
        const task = tasks.find(candidate =>
            String(candidate.nodeId || '') === slot.id
            || Number(candidate.generationSlotIndex) === index
        ) || (tasks.length === 1 && Number(tasks[0].generationSlotCount) > 1
            ? tasks[0]
            : tasks[index]);
        if(!task){
            slot.pending = 0;
            slot.running = false;
            return {
                nodeId:slot.id,
                outputs:[],
                error:tr('smart.errRunFailed')
            };
        }
        try {
            const result = await recovery.settle({
                node:slot,
                submission:{
                    state:'pending',
                    kind:submission.kind || 'image',
                    tasks:[{
                        ...task,
                        generationBatchId:slot.generationBatchId || '',
                        generationSlotIndex:index,
                        generationSlotCount:slots.length
                    }]
                },
                submissionSnapshot:generationOutputModule.submissionSnapshot({node:slot}),
                batchManaged:true
            });
            return {
                nodeId:slot.id,
                outputs:(slot.images || []).filter(item => item?.url),
                error:'',
                deferred:Boolean(result?.deferred)
            };
        } catch(error){
            return {
                nodeId:slot.id,
                outputs:(slot.images || []).filter(item => item?.url),
                error:error?.message || tr('smart.errRunFailed'),
                cause:error
            };
        }
    }));
    return {
        state:'completed',
        kind:submission.kind || 'image',
        urls:settled.flatMap(result => result.outputs || []),
        applied:true,
        deferred:settled.some(result => result.deferred),
        slotResults:settled
    };
}
async function runCascadeStepIntoNode(sourceNode, targetNode, inputRefs, ctx=null){
    const outputNode = targetNode || sourceNode;
    if(!sourceNode || !targetNode || !outputNode) return [];
    const requestNode = sourceNode?.type === 'smart-loop' ? targetNode : sourceNode;
    const outpaintSize = validOutpaintSize(requestNode);
    const runPlan = generationSettingsModule.forRun({node:requestNode, context:ctx, outpaintSize});
    const runSettings = runPlan.settings;
    const selfRefs = sourceNode?.type === 'smart-loop' ? [] : selfReferenceImagesForNode(sourceNode, false, ctx).filter(img => img?.url);
    const sourceRefs = (selfRefs.length ? selfRefs : defaultReferenceImagesFor(requestNode, false, ctx)).filter(img => img?.url);
    const refsForRequest = sourceRefs.length
        ? sourceRefs
        : (inputRefs && inputRefs.length ? inputRefs : null);
    const request = promptAuthoringModule.resolveFromNodeDraft({
        node:requestNode,
        defaultImages:refsForRequest,
        context:ctx,
        settings:runSettings
    });
    const prompt = (request.prompt || '').trim();
    const displayPrompt = (request.displayPrompt || '').trim();
    if((!prompt || !displayPrompt) && smartRunNeedsPrompt(runSettings)) throw new Error(tr('smart.chainMissingPrompt'));
    const meta = {
        prompt,
        displayPrompt:request.displayPrompt || '',
        promptRefs:(request.refs || []).map(generationRunReferenceSnapshot).filter(ref => ref.url),
        inputRefs:(request.refs || []).map(generationRunReferenceSnapshot).filter(ref => ref.url),
        sourceNodeId:sourceNode.id,
        settings:JSON.parse(JSON.stringify(runSettings)),
        createdAt:Date.now()
    };
    if(requestNode.promptDraftHtml != null){
        meta.promptHtml = requestNode.promptDraftHtml;
        // Keep a complete editable snapshot when the resolved prompt came
        // from upstream text Nodes and the local draft itself was empty.
        meta.promptText = requestNode.promptDraftText || request.displayPrompt || '';
    }
    const logKind = runPlan.outputKind;
    const runLog = smartRunSnapshot(requestNode, prompt, request.refs || [], logKind, runSettings);
    const runLogStart = nowMs();
    const targetPromptState = {
        promptDraftHtml:targetNode.promptDraftHtml,
        promptDraftText:targetNode.promptDraftText,
        runPrompt:targetNode.runPrompt,
        runModelPrompt:targetNode.runModelPrompt,
        runPromptRefs:targetNode.runPromptRefs ? targetNode.runPromptRefs.map(ref => ({...ref})) : undefined,
        runInputRefs:targetNode.runInputRefs ? targetNode.runInputRefs.map(ref => ({...ref})) : undefined,
        runSettings:targetNode.runSettings ? generationSettingsModule.snapshot(targetNode.runSettings) : undefined,
        sourceNodeId:targetNode.sourceNodeId,
        runAt:targetNode.runAt
    };
    delete outputNode.generationRunFeedback;
    outputNode.running = true;
    outputNode.runStartedAt = nowMs();
    delete outputNode.runFinishedAt;
    delete outputNode.runElapsedMs;
    outputNode.runTimerHidden = false;
    generationSettingsModule.remember(runSettings, {node:requestNode});
    render();
    try {
        const result = await submitAndSettleGenerationProvider(outputNode, prompt, request.refs || [], runSettings, {
            archiveExisting:true,
            logContext:{run:runLog, runLogStart}
        });
        if(result.deferred || (result.logged && !result.urls?.length)) return [];
        if(!result.urls?.length) throw new Error(result.kind === 'video' ? tr('smart.errNoOutVideos') : tr('smart.errNoOutImages'));
        if(outpaintSize) delete requestNode.outpaintSize;
        if(!result.logged) addSmartGenerationLog({run:{...runLog, kind:result.kind || logKind}, outputs:result.urls, runMs:nowMs() - runLogStart});
        const additions = generationOutputModule.normalize({
            outputs:result.urls,
            kind:result.kind
        });
        if(!result.applied){
            if(ctx?.appendLoopOutputs) {
                generationOutputModule.apply({
                    node:outputNode,
                    outputs:additions,
                    kind:result.kind,
                    strategy:'loop',
                    context:ctx
                });
            } else {
                generationOutputModule.apply({
                    node:outputNode,
                    outputs:additions,
                    kind:result.kind,
                    strategy:'replace',
                    skipShift:Boolean(ctx?.nodeId)
                });
            }
        }
        outputNode.runPrompt = targetPromptState.runPrompt;
        outputNode.runModelPrompt = targetPromptState.runModelPrompt;
        outputNode.runPromptRefs = targetPromptState.runPromptRefs || [];
        outputNode.runInputRefs = targetPromptState.runInputRefs || [];
        outputNode.runSettings = targetPromptState.runSettings;
        outputNode.sourceNodeId = targetPromptState.sourceNodeId;
        outputNode.runAt = targetPromptState.runAt;
        if(targetPromptState.promptDraftHtml === undefined) delete outputNode.promptDraftHtml;
        else outputNode.promptDraftHtml = targetPromptState.promptDraftHtml;
        if(targetPromptState.promptDraftText === undefined) delete outputNode.promptDraftText;
        else outputNode.promptDraftText = targetPromptState.promptDraftText;
        ['runPrompt','runModelPrompt','runSettings','sourceNodeId','runAt'].forEach(key => {
            if(targetPromptState[key] === undefined) delete outputNode[key];
        });
        render();
        return rememberRoundOutputs(ctx, outputNode, additions);
    } catch(e) {
        outputNode.running = false;
        generationRunReportFailure({run:runLog, runMs:nowMs() - runLogStart, error:e});
        render();
        throw e;
    }
}
async function runLoopRoundIntoSlot(loopNode, rootNode, outputSlot, loopIndex, ctx){
    if(!loopNode || !rootNode || !outputSlot) return [];
    outputSlot = liveSmartNode(outputSlot);
    const edgeKey = `${rootNode.id}->${outputSlot.id}`;
    const runPlan = generationSettingsModule.forRun({node:rootNode, context:ctx});
    const runSettings = runPlan.settings;
    try {
        const refsForRequest = outputImagesForNode(loopNode, true, ctx).filter(img => img?.url);
        const request = promptAuthoringModule.resolveFromNodeDraft({
            node:rootNode,
            defaultImages:refsForRequest.length ? refsForRequest : null,
            context:ctx,
            settings:runSettings
        });
        const prompt = (request.prompt || '').trim();
        const displayPrompt = (request.displayPrompt || '').trim();
    if((!prompt || !displayPrompt) && smartRunNeedsPrompt(runSettings)) throw new Error(tr('smart.chainMissingPrompt'));
        const meta = {
            prompt,
            displayPrompt:request.displayPrompt || '',
            promptRefs:(request.refs || []).map(generationRunReferenceSnapshot).filter(ref => ref.url),
            inputRefs:(request.refs || []).map(generationRunReferenceSnapshot).filter(ref => ref.url),
            sourceNodeId:rootNode.id,
            settings:JSON.parse(JSON.stringify(runSettings)),
            createdAt:Date.now()
        };
        const logKind = runPlan.outputKind;
        const runLog = smartRunSnapshot(rootNode, prompt, request.refs || [], logKind, runSettings);
        const runLogStart = nowMs();
        const expectedCount = runPlan.expectedCount;
        delete outputSlot.generationRunFeedback;
        outputSlot.queued = false;
        outputSlot.running = true;
        outputSlot.outputKind = logKind;
        outputSlot.pending = expectedCount;
        outputSlot.runStartedAt = nowMs();
        delete outputSlot.runFinishedAt;
        delete outputSlot.runElapsedMs;
        outputSlot.runTimerHidden = false;
        const runPath = ctx?.runState?.runPath || ctx?.runPath || null;
        if(runPath?.states) {
            runPath.states[edgeKey] = 'active';
            scheduleConnectionLayerRefresh();
        }
        render();
        const result = await submitAndSettleGenerationProvider(outputSlot, prompt, request.refs || [], runSettings, {
            archiveExisting:true,
            logContext:{run:runLog, runLogStart}
        });
        if(result.deferred){
            outputSlot.queued = false;
            return [];
        }
        if(result.logged && !result.urls?.length) return [];
        if(!result.urls?.length) throw new Error(result.kind === 'video' ? tr('smart.errNoOutVideos') : tr('smart.errNoOutImages'));
        let additions;
        if(result.applied){
            additions = generationOutputModule.normalize({
                outputs:result.urls,
                kind:result.kind,
                generatedResult:false,
                defaultName:false
            });
            if(meta) attachRunMeta(outputSlot, meta);
        } else {
            additions = generationOutputModule.normalize({
                outputs:result.urls,
                kind:result.kind
            });
            outputSlot = liveSmartNode(outputSlot);
            generationOutputModule.apply({
                node:outputSlot,
                outputs:additions,
                kind:result.kind,
                strategy:'replace',
                meta,
                skipShift:Boolean(ctx?.nodeId)
            });
        }
        outputSlot = liveSmartNode(outputSlot);
        markSmartNodeComplete(outputSlot, meta);
        clearSourceBusyStateIfDownstreamDone(rootNode);
        if(runPath?.states) {
            runPath.states[edgeKey] = 'done';
            scheduleConnectionLayerRefresh();
        }
        if(!result.logged) addSmartGenerationLog({run:{...runLog, kind:result.kind || logKind}, outputs:result.urls, runMs:nowMs() - runLogStart});
        return rememberRoundOutputs(ctx, outputSlot, additions);
    } catch(e) {
        outputSlot.queued = false;
        outputSlot.pending = 0;
        outputSlot.running = false;
        throw e;
    }
}
function appendGenerationCascadeRefs(node, refs, ctx=null){
    if(!node || !refs?.length) return [];
    const kind = mediaKindForUrls(
        refs,
        refs.some(isVideoMediaItem) ? 'video' : 'image'
    );
    const additions = generationOutputModule.normalize({
        outputs:refs.filter(ref => ref?.url),
        kind,
        generatedResult:false
    });
    if(!additions.length) return [];
    generationOutputModule.apply({
        node,
        outputs:additions,
        kind,
        strategy:'replace',
        generatedResult:false,
        skipShift:Boolean(ctx?.nodeId)
    });
    render();
    return rememberRoundOutputs(ctx, node, additions);
}
function generationRunSupportedInputKinds(runPlan, runSettings={}, refs=[]){
    const capability = runSettings.inputCapabilities || runSettings.input_capabilities || runSettings.capabilities?.inputs || {};
    const explicit = capability.media_types
        || capability.mediaTypes
        || capability.input_modalities
        || capability.inputModalities
        || runSettings.supportedInputTypes
        || runSettings.inputMediaTypes
        || runSettings.input_modalities;
    if(Array.isArray(explicit) && explicit.length){
        return new Set(explicit.map(value => String(value || '').toLowerCase()).filter(value => ['image','video','audio'].includes(value)));
    }
    const booleanKinds = ['image','video','audio'].filter(kind =>
        capability[`supports_${kind}_input`] === true
        || capability[`supports${kind[0].toUpperCase()}${kind.slice(1)}Input`] === true
        || runSettings[`supports_${kind}_input`] === true
    );
    if(booleanKinds.length) return new Set(booleanKinds);
    if(runPlan.outputKind === 'video'){
        const videoCapabilities = window.SmartCanvasModules.videoCapabilities;
        const context = typeof smartVideoCapabilityProviderContext === 'function'
            ? smartVideoCapabilityProviderContext(runSettings)
            : {};
        const current = videoCapabilities?.current?.(
            runSettings.videoProvider,
            runSettings.videoModel,
            context
        );
        const state = videoCapabilities?.resolve?.(runSettings, refs, current);
        if(['image2video','frames2video'].includes(state?.command)) return new Set(['image']);
        if(state?.command === 'multimodal2video'){
            const inputs = state.multimodal_inputs || {};
            return new Set(['image','video','audio'].filter(kind => {
                const maximum = inputs[`${kind}_count`]?.maximum;
                return maximum === undefined || maximum === null || Number(maximum) > 0;
            }));
        }
        return new Set(['image','video','audio']);
    }
    return new Set(['image']);
}
function generationRunUnsupportedReferences(refs, runPlan, runSettings={}){
    const supported = generationRunSupportedInputKinds(runPlan, runSettings, refs);
    return (refs || []).filter(ref => ref?.url && !supported.has(String(ref.kind || mediaKindForItem(ref) || 'image').toLowerCase()));
}
async function runGeneration(options={}){
    const node = options.node || window.SmartCanvasModules.viewportSelection.selection.node();
    if(!node) return;
    const nodeEligibility = !options.allowAttachment
        ? (typeof smartNodeGenerationEligibility === 'function'
            ? smartNodeGenerationEligibility(node)
            : {runnable:isSmartRunnableNode(node),imageAllowed:true})
        : null;
    if(!options.allowAttachment){
        if(!nodeEligibility.runnable) return false;
    }
    const sourceInFlight = smartNodeInFlight(node);
    const runContext = activeGenerationCascadeModule()?.context?.() || null;
    const requestedOutpaintWidth = Math.round(Number(options.outpaintSize?.width) || 0);
    const requestedOutpaintHeight = Math.round(Number(options.outpaintSize?.height) || 0);
    const outpaintSize = requestedOutpaintWidth > 0 && requestedOutpaintHeight > 0
        ? {width:requestedOutpaintWidth, height:requestedOutpaintHeight}
        : node?.outpaintSize && Number(node.outpaintSize.width) > 0 && Number(node.outpaintSize.height) > 0
            ? {width:Math.round(Number(node.outpaintSize.width)), height:Math.round(Number(node.outpaintSize.height))}
            : null;
    const runPlan = generationSettingsModule.forRun({
        node,
        context:runContext,
        outpaintSize,
        overrides:options.runSettings || {}
    });
    if(
        !options.allowAttachment
        && !nodeEligibility.imageAllowed
        && runPlan.outputKind !== 'video'
    ) return false;
    const runSettings = runPlan.settings;
    const request = options.request
        ? {
            prompt:String(options.request.prompt || ''),
            displayPrompt:String(options.request.displayPrompt || options.request.prompt || ''),
            refs:(options.request.refs || []).filter(ref => ref?.url),
            validationErrors:[...(options.request.validationErrors || [])]
        }
        : promptAuthoringModule.resolve({
            node,
            consumeDefault:true,
            context:runContext,
            settings:runSettings
        });
    if(request.validationErrors?.length){
        toast(request.validationErrors.join(tr('smart.listSeparator')), {tone:'danger'});
        return false;
    }
    const unsupportedReferences = generationRunUnsupportedReferences(request.refs, runPlan, runSettings);
    if(unsupportedReferences.length){
        const labels = unsupportedReferences.map(ref => {
            const kind = String(ref.kind || mediaKindForItem(ref) || 'media');
            return trf('smart.referenceWithKind', {name:ref.name || tr('smart.untitledFile'), kind});
        });
        toast(trf('smart.unsupportedReferences', {references:labels.join(tr('smart.listSeparator'))}), {tone:'danger'});
        return false;
    }
    const prompt = request.prompt.trim();
    if(!prompt && smartRunNeedsPrompt(runSettings)){
        toast(tr('smart.toastNeedPrompt'));
        return;
    }
    const refs = request.refs;
    const queuedIntent = {
        action:'single',
        request:{...request, refs:generationRunClone(refs)},
        runSettings,
        options:{
            allowAttachment:Boolean(options.allowAttachment),
            createOutput:Boolean(options.createOutput),
            connectSource:options.connectSource,
            outpaintSize
        }
    };
    const meta = snapshotRunMeta(prompt, node.id, request.displayPrompt, refs, runSettings);
    if(options.request){
        const editablePrompt = request.displayPrompt || prompt;
        meta.promptHtml = escapeHtml(editablePrompt);
        meta.promptText = editablePrompt;
    }
    const logKind = runPlan.outputKind;
    if(!generationRunOnline()){
        if(!sourceInFlight) return generationRunQueueIntent(node, queuedIntent);
        const inheritSourceConnections = generationRunHasIncomingSourceConnection(node);
        const queuedNode = generationOutputModule.createPending({
            sourceNode:node,
            expectedCount:1,
            meta:inheritSourceConnections ? stripRunInputMeta(meta) : meta,
            connectSource:inheritSourceConnections ? options.connectSource : null,
            selectOutput:true,
            outputKind:logKind,
            refs,
            inheritSourceConnections
        });
        if(!queuedNode) return false;
        queuedNode.pending = 0;
        queuedNode.running = false;
        delete queuedNode.runStartedAt;
        return generationRunQueueIntent(queuedNode, queuedIntent);
    }
    const runLog = smartRunSnapshot(node, prompt, refs, logKind, runSettings);
    generationSettingsModule.remember(runSettings, {node});
    const runLogStart = nowMs();
    const expectedCount = runPlan.expectedCount;
    const apiConcurrentRun = runPlan.concurrent;
    const useBatchOutputs = logKind === 'image' && expectedCount > 1;
    const nodeHasImages = generationRunContainerModule.isGroup(node) ? imagesForNode(node).some(img => img?.url) : (node.images || []).some(img => img?.url);
    let branchNode = null;
    let branchNodes = [];
    const groupRun = generationRunContainerModule.isGroup(node);
    const inheritParallelSourceConnections = Boolean(
        generationRunHasIncomingSourceConnection(node)
        && !groupRun
        && options.createOutput !== true
        && (
            sourceInFlight
            || (nodeHasImages && node.generationOutputNode === true)
        )
    );
    const createSiblingOutputFromInputs = Boolean(
        nodeHasImages
        && inheritParallelSourceConnections
    );
    const shouldCreateBranchOutput = sourceInFlight
        || groupRun
        || options.createOutput === true
        || createSiblingOutputFromInputs;
    const parallelConnectSource = sourceInFlight
        && !inheritParallelSourceConnections
        ? null
        : groupRun
        ? false
        : options.connectSource;
    const reuseGenerationNodeForBatch = Boolean(
        useBatchOutputs
        && !nodeHasImages
        && !sourceInFlight
        && !groupRun
        && options.createOutput !== true
        && typeof referenceGenerationKind === 'function'
        && referenceGenerationKind(node) === 'image'
    );
    const generationBatchSeedSnapshot = reuseGenerationNodeForBatch
        ? generationRunClone(node)
        : null;
    delete node.generationRunFeedback;
    if(nodeHasImages && !shouldCreateBranchOutput && !useBatchOutputs){
        node.generationPreviousPresentation = captureGenerationPresentationSnapshot(node);
    }
    const pendingMeta = reuseGenerationNodeForBatch
        ? meta
        : shouldCreateBranchOutput || useBatchOutputs
        ? stripRunInputMeta(meta)
        : meta;
    if(useBatchOutputs){
        branchNodes = generationOutputModule.createPendingBatch({
            sourceNode:node,
            expectedCount,
            meta:pendingMeta,
            connectSource:parallelConnectSource,
            selectOutput:true,
            outputKind:logKind,
            refs,
            reuseSource:reuseGenerationNodeForBatch,
            inheritSourceConnections:inheritParallelSourceConnections
        });
        branchNode = branchNodes[0] || null;
        generationRunContainerModule.reconcileFrames?.();
    } else if(shouldCreateBranchOutput){
        branchNode = generationOutputModule.createPending({
            sourceNode:node,
            expectedCount,
            meta:pendingMeta,
            connectSource:parallelConnectSource,
            selectOutput:true,
            outputKind:logKind,
            refs,
            inheritSourceConnections:inheritParallelSourceConnections
        });
        branchNodes = branchNode ? [branchNode] : [];
    }
    const pendingNode = branchNode || node;
    const pendingNodes = branchNodes.length ? branchNodes : [pendingNode];
    pendingNodes.forEach(target => {
        target.outputKind = logKind;
        delete target.generationRunFeedback;
    });
    const submissionSnapshot = generationOutputModule.submissionSnapshot({node:pendingNode});
    if(!branchNode){
        pendingNode.pending = Math.max(1, Number(expectedCount) || 1);
        pendingNode.runStartedAt = nowMs();
        delete pendingNode.runFinishedAt;
        delete pendingNode.runElapsedMs;
        pendingNode.runTimerHidden = false;
        const pendingBox = pendingBoxSize(pendingNode.pending, {sourceNode:node, refs, settings:runSettings});
        pendingNode.w = pendingBox.w;
        pendingNode.h = pendingBox.h;
        attachRunMeta(pendingNode, pendingMeta);
    }
    if(apiConcurrentRun){
        pendingNodes.forEach(target => coolNodeRunningState(target, 2000));
        syncRunButtonState();
    } else {
        pendingNodes.forEach(target => { target.running = true; });
        syncRunButtonState();
    }
    render();
    let submissionAccepted = false;
    try {
        const result = useBatchOutputs
            ? await submitAndSettleGenerationProviderBatch(
                branchNodes,
                prompt,
                refs,
                runSettings,
                {logContext:{run:runLog,runLogStart}}
            )
            : await submitAndSettleGenerationProvider(pendingNode, prompt, refs, runSettings, {
                logContext:{run:runLog, runLogStart},
                submissionSnapshot,
                onAccepted:async detail => {
                    submissionAccepted = true;
                    await options.onAccepted?.(detail);
                }
            });
        if(result.deferred){
            delete pendingNode._runMetaTargetId;
            clearPromptInput({preserveDraft:true});
            generationRunPersistenceModule.schedule();
            return;
        }
        if(result.logged && !result.urls?.length){
            delete pendingNode._runMetaTargetId;
            generationRunPersistenceModule.schedule();
            return;
        }
        const batchFailures = useBatchOutputs
            ? (result.slotResults || []).filter(slot => slot.error)
            : [];
        if(!result.applied && result.urls?.length && pendingNode.aiProcessorPostprocess){
            result.urls = await window.SmartCanvasModules.aiProcessorGeometry.postprocessOutputs(
                result.urls,
                pendingNode.aiProcessorPostprocess
            );
        }
        if(!result.urls?.length && !batchFailures.length) throw new Error(result.kind === 'video' ? tr('smart.errNoOutVideos') : tr('smart.errNoOutImages'));
        if(outpaintSize) delete node.outpaintSize;
        if(useBatchOutputs && !result.applied){
            (result.slotResults || []).forEach((slotResult,index) => {
                const slot = nodes.find(item => item.id === branchNodes[index]?.id);
                const outputs = slotResult.outputs || [];
                if(outputs.length){
                    generationOutputModule.apply({
                        node:slot,
                        outputs,
                        kind:result.kind || logKind,
                        strategy:'pending',
                        meta:pendingMeta
                    });
                } else if(slot){
                    slot.pending = 0;
                    slot.running = false;
                    slot.generationRunFeedback = {
                        successfulCount:0,
                        failedCount:1,
                        finishedAt:nowMs()
                    };
                }
            });
        } else if(!result.applied){
            generationOutputModule.apply({
                node:pendingNode,
                outputs:result.urls,
                kind:result.kind || logKind,
                strategy:nodeHasImages && !branchNode ? 'append' : 'pending',
                meta:pendingMeta,
                submissionSnapshot
            });
        }
        if(!result.logged){
            const loggedRun = {...runLog,kind:result.kind || logKind};
            if(useBatchOutputs){
                generationRunReportBatchResult({
                    run:loggedRun,
                    runMs:nowMs() - runLogStart,
                    result,
                });
            } else {
                addSmartGenerationLog({
                    run:loggedRun,
                    outputs:result.urls,
                    runMs:nowMs() - runLogStart,
                });
            }
        }
        pendingNodes.forEach(target => {
            delete target.generationPreviousPresentation;
        });
        clearPromptInput({preserveDraft:true});
        generationRunPersistenceModule.schedule();
    } catch(e) {
        pendingNodes.forEach(target => {
            target.pending = 0;
            target.running = false;
        });
        pendingNodes.forEach(target => {
            delete target._runMetaTargetId;
        });
        const shouldQueueRun = Boolean(
            e?.generationSyncPending || !generationRunOnline()
        );
        if(shouldQueueRun){
            if(branchNode && !useBatchOutputs){
                generationRunMutationModule.remove({
                    nodeIds:[branchNode.id],
                    options:{skipUndo:true,render:false,save:false}
                });
                selectedId = node.id;
            } else if(!useBatchOutputs) {
                if((pendingNode.images || []).length){
                    restoreGenerationPresentationSnapshot(pendingNode);
                } else {
                    delete pendingNode.w;
                    delete pendingNode.h;
                }
            }
            if(useBatchOutputs && branchNodes.length){
                const removableNodes = reuseGenerationNodeForBatch
                    ? branchNodes.filter(target => target.id !== node.id)
                    : branchNodes;
                generationRunMutationModule.remove({
                    nodeIds:removableNodes.map(target => target.id),
                    options:{skipUndo:true,render:false,save:false}
                });
                if(reuseGenerationNodeForBatch && generationBatchSeedSnapshot){
                    Object.keys(node).forEach(key => { delete node[key]; });
                    Object.assign(node, generationBatchSeedSnapshot);
                }
                selectedId = node.id;
            }
            generationRunQueueIntent(node, queuedIntent);
            return;
        }
        if(useBatchOutputs){
            pendingNodes.forEach(target => {
                target.generationRunFeedback = generationRunNodeFailureFeedback(e);
            });
        } else if(branchNode && inheritParallelSourceConnections){
            branchNode.generationRunFeedback = generationRunNodeFailureFeedback(e);
        } else if(branchNode){
            generationRunMutationModule.remove({
                nodeIds:[branchNode.id],
                options:{skipUndo:true,render:false,save:false}
            });
            selectedId = node.id;
        } else {
            if((pendingNode.images || []).length){
                restoreGenerationPresentationSnapshot(pendingNode);
            } else {
                delete pendingNode.w;
                delete pendingNode.h;
            }
        }
        generationRunReportFailure({run:runLog, runMs:nowMs() - runLogStart, error:e});
        if(options.throwOnSubmissionFailure && !submissionAccepted) throw e;
    } finally {
        if(!apiConcurrentRun){
            pendingNodes.forEach(target => clearNodeRunningState(target));
            syncRunButtonState();
        }
        render();
    }
}
function generationRunStatus({nodeId='', node=null, connectionKeys=[]}={}){
    const target = node || (nodeId ? nodes.find(item => item.id === nodeId) : null);
    const recoveryStatus = activeGenerationRecoveryModule()?.status?.({
        nodeId,
        node:target
    }) || {
        pendingTasks:[],
        recoverableTask:null,
        queued:false,
        queue:null
    };
    const cascadeStatus = activeGenerationCascadeModule()?.status?.({
        nodeId,
        node:target,
        connectionKeys
    }) || {
        loopId:'',
        loopRunning:false,
        loopStopping:false,
        stopText:tr('smart.stopRunning'),
        anyRunning:false,
        silentSelection:false,
        activeConnectionCount:0,
        cascadeConnectionKeys:[],
        connectionStates:(connectionKeys || []).map(() => '')
    };
    return {
        ...recoveryStatus,
        ...cascadeStatus
    };
}
function generationRunPendingTasks({nodeId='',node=null}={}){
    const target = node || (nodeId
        ? nodes.find(item => item.id === nodeId)
        : null);
    return (
        activeGenerationRecoveryModule()?.status?.({nodeId,node:target})
            ?.pendingTasks
        || []
    ).map(task => ({...task}));
}
function regenerationAnchorNode(outputNode){
    if(!outputNode) return null;
    const candidateIds = [
        outputNode.sourceNodeId,
        ...(outputNode.runInputRefs || []).map(ref => ref?.nodeId),
        ...(outputNode.runPromptRefs || []).map(ref => ref?.nodeId)
    ].filter(id => id && id !== outputNode.id);
    for(const id of candidateIds){
        const candidate = nodes.find(node => node.id === id);
        if(candidate) return candidate;
    }
    const incoming = (canvas?.connections || []).find(connection =>
        connection.to === outputNode.id
        && ['input','flow'].includes(connection.kind || 'flow')
    );
    return nodes.find(node => node.id === incoming?.from) || outputNode;
}
async function regenerateGenerationRun(nodeId){
    const source = nodes.find(node => node.id === nodeId);
    if(!smartNodeHasRegenerationSnapshot(source)){ toast(tr('smart.missingRunSnapshot')); return; }
    const inputSnapshot = source.generationInputSnapshot
        && typeof source.generationInputSnapshot === 'object'
        ? source.generationInputSnapshot
        : null;
    const anchor = regenerationAnchorNode(source) || source;
    const retryFailedBatchSlot = Boolean(
        source.generationBatchId
        && !(source.images || []).some(item => item?.url)
        && Number(source.generationRunFeedback?.failedCount || 0) > 0
    );
    const runPlan = generationSettingsModule.forRun({
        node:source,
        overrides:{
            ...(inputSnapshot?.settings || source.runSettings || {}),
            ...(retryFailedBatchSlot ? {count:1} : {})
        }
    });
    const runSettings = runPlan.settings;
    const prompt = String(
        inputSnapshot?.prompt || source.runModelPrompt || source.runPrompt || ''
    ).trim();
    const refs = (
        inputSnapshot?.refs || source.runInputRefs || source.runPromptRefs || []
    ).map(ref => ({...ref})).filter(ref => ref?.url);
    const kind = isApiLikeEngine(runSettings.engine) && runSettings.apiKind === 'video' ? 'video' : source.outputKind || 'image';
    const meta = {
        prompt,
        displayPrompt:source.runPrompt || prompt,
        promptHtml:escapeHtml(source.runPrompt || prompt),
        promptText:source.runPrompt || prompt,
        promptRefs:(source.runPromptRefs || []).map(ref => ({...ref})),
        inputRefs:refs,
        sourceNodeId:anchor.id,
        settings:runSettings,
        createdAt:Date.now()
    };
    const expectedCount = runPlan.expectedCount;
    const useBatchOutputs = kind === 'image' && expectedCount > 1;
    const batchMeta = stripRunInputMeta(meta);
    const inheritSourceConnections = generationRunHasIncomingSourceConnection(
        source
    );
    const outputParent = inheritSourceConnections ? source : anchor;
    const batchNodes = useBatchOutputs
        ? generationOutputModule.createPendingBatch({
            sourceNode:outputParent,
            expectedCount,
            meta:batchMeta,
            connectSource:true,
            selectOutput:true,
            outputKind:kind,
            refs,
            inheritSourceConnections
        })
        : [];
    if(useBatchOutputs) generationRunContainerModule.reconcileFrames?.();
    const pending = batchNodes[0] || generationOutputModule.createPending({
        sourceNode:outputParent,
        expectedCount,
        meta,
        connectSource:true,
        selectOutput:true,
        outputKind:kind,
        refs,
        inheritSourceConnections
    });
    if(!pending) throw new Error('Regeneration Output Node could not be created');
    pending.outputKind = kind;
    delete pending.generationRunFeedback;
    const submissionSnapshot = generationOutputModule.submissionSnapshot({node:pending});
    const pendingNodes = batchNodes.length ? batchNodes : [pending];
    pendingNodes.forEach(target => {
        target.pending = useBatchOutputs
            ? 1
            : Math.max(1,Number(expectedCount) || 1);
        target.runStartedAt = nowMs();
        target.runTimerHidden = false;
        target.running = true;
    });
    const runLog = smartRunSnapshot(source, prompt, refs, kind, runSettings);
    const startedAt = nowMs();
    render();
    try {
        const result = useBatchOutputs
            ? await submitAndSettleGenerationProviderBatch(
                batchNodes,
                prompt,
                refs,
                runSettings,
                {logContext:{run:runLog,runLogStart:startedAt}}
            )
            : await submitAndSettleGenerationProvider(pending, prompt, refs, runSettings, {
                logContext:{run:runLog, runLogStart:startedAt},
                submissionSnapshot
            });
        if(result.deferred){
            toast(tr('smart.contextRegenerateStarted'));
            return;
        }
        if(result.logged && !result.urls?.length) return;
        const batchFailures = useBatchOutputs
            ? (result.slotResults || []).filter(slot => slot.error)
            : [];
        if(!result.urls?.length && !batchFailures.length) throw new Error(result.kind === 'video' ? tr('smart.errNoOutVideos') : tr('smart.errNoOutImages'));
        if(useBatchOutputs && !result.applied){
            (result.slotResults || []).forEach((slotResult,index) => {
                const slot = nodes.find(item => item.id === batchNodes[index]?.id);
                if(slotResult.outputs?.length){
                    generationOutputModule.apply({
                        node:slot,
                        outputs:slotResult.outputs,
                        kind:result.kind || kind,
                        strategy:'pending',
                        meta:batchMeta
                    });
                } else if(slot){
                    slot.pending = 0;
                    slot.running = false;
                    slot.generationRunFeedback = {
                        successfulCount:0,
                        failedCount:1,
                        finishedAt:nowMs()
                    };
                }
            });
        } else if(!result.applied){
            generationOutputModule.apply({
                node:pending,
                outputs:result.urls,
                kind:result.kind || kind,
                strategy:'pending',
                meta,
                submissionSnapshot
            });
        }
        if(!result.logged){
            const loggedRun = {...runLog,kind:result.kind || kind};
            if(useBatchOutputs){
                generationRunReportBatchResult({
                    run:loggedRun,
                    runMs:nowMs() - startedAt,
                    result,
                });
            } else {
                addSmartGenerationLog({
                    run:loggedRun,
                    outputs:result.urls,
                    runMs:nowMs() - startedAt,
                });
            }
        }
        toast(tr('smart.contextRegenerateStarted'));
    } catch(error){
        pendingNodes.forEach(target => {
            target.pending = 0;
            target.running = false;
        });
        selectedId = source.id;
        if(error?.generationSyncPending || !generationRunOnline()){
            generationRunMutationModule.remove({
                nodeIds:pendingNodes.map(target => target.id),
                options:{skipUndo:true,render:false,save:false}
            });
            generationRunQueueIntent(source, {action:'regenerate'});
            return;
        }
        generationRunReportFailure({run:runLog, runMs:nowMs() - startedAt, error});
    } finally {
        render();
        generationRunPersistenceModule.schedule();
    }
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.generationRun = Object.freeze({
    run({nodeId='', mode='single'}={}){
        const node = nodeId ? nodes.find(item => item.id === nodeId) : window.SmartCanvasModules.viewportSelection.selection.node();
        if(mode === 'loop'){
            if(!generationRunOnline()){
                return Promise.resolve(generationRunQueueIntent(node, {action:'loop'}));
            }
            return activeGenerationCascadeModule()?.run({nodeId, node});
        }
        if(mode !== 'single') return Promise.resolve(false);
        if(node?.id && selectedId !== node.id){
            selectedId = node.id;
            selectedIds = [];
            selectedImage = {nodeId:'', index:-1};
        }
        return runGeneration({node});
    },
    processor({nodeId='',imageIndex=0,input=null,width=0,height=0,prompt='',runSettings={},onAccepted=null,throwOnSubmissionFailure=true}={}){
        const node=nodeId?nodes.find(item=>item.id===nodeId):null;
        const targetWidth=Math.round(Number(width)||0);
        const targetHeight=Math.round(Number(height)||0);
        if(!node||!isSmartImageNode(node)||!input?.url||targetWidth<=0||targetHeight<=0) return Promise.resolve(false);
        const modelPrompt=String(prompt||'').trim();
        return runGeneration({
            node,
            allowAttachment:true,
            createOutput:true,
            runSettings:{...runSettings},
            onAccepted,
            throwOnSubmissionFailure,
            request:{
                prompt:modelPrompt,
                displayPrompt:modelPrompt,
                refs:[{...input,kind:input.kind||'image',nodeId:node.id,imageIndex:Number.isFinite(Number(imageIndex))?Number(imageIndex):0}]
            }
        });
    },
    stop(options={}){
        return activeGenerationCascadeModule()?.stop(options);
    },
    resume(){
        const recovery = activeGenerationRecoveryModule()?.resume();
        generationRunResumeQueued();
        return recovery;
    },
    restoreActive(){
        return generationRunRestoreActive();
    },
    status(options={}){
        return generationRunStatus(options);
    },
    pendingTasks(options={}){
        return generationRunPendingTasks(options);
    },
    recover({nodeId='', taskId='', kind='auto'}={}){
        return activeGenerationRecoveryModule()?.recover({nodeId, taskId, kind});
    },
    regenerate({nodeId=''}={}){
        const node = nodes.find(item => item.id === nodeId);
        if(!generationRunOnline()){
            return Promise.resolve(generationRunQueueIntent(node, {action:'regenerate'}));
        }
        return regenerateGenerationRun(nodeId);
    },
    noteManualSelection(){
        return activeGenerationCascadeModule()?.noteManualSelection();
    },
    cascadeAdapter:Object.freeze({
        executeStep({sourceNode=null, targetNode=null, inputRefs=[], context=null}={}){
            return runCascadeStepIntoNode(sourceNode, targetNode, inputRefs, context);
        },
        executeLoopRound({loopNode=null, rootNode=null, outputSlot=null, loopIndex=0, context=null}={}){
            return runLoopRoundIntoSlot(loopNode, rootNode, outputSlot, loopIndex, context);
        },
        appendRefs({node=null, refs=[], context=null}={}){
            return appendGenerationCascadeRefs(node, refs, context);
        }
    })
});
