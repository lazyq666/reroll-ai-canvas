/*
 * Smart Canvas Generation Recovery Module
 *
 * Continues submitted Generation Runs after their initial provider request.
 * Owns remote task polling, queued work, manual recovery and page-load resume.
 */
const generationRecoverySettingsModule = window.SmartCanvasModules?.generationSettings;
if(!generationRecoverySettingsModule) throw new Error('Generation Settings Module failed to load');
const generationRecoveryPendingModule = window.SmartCanvasModules?.generationPending;
if(!generationRecoveryPendingModule) throw new Error('Pending Node Module failed to load');
const generationRecoveryOutputModule = window.SmartCanvasModules?.generationOutput;
if(!generationRecoveryOutputModule) throw new Error('Generation Output Module failed to load');
const generationRecoveryFailureModule = window.SmartCanvasModules?.generationFailureFeedback || {
    actionName(){ return ''; },
    aggregate(tasks=[], translate, format, options={}){
        const successfulCount = tasks.filter(task => task.status === 'succeeded').length;
        const failedCount = tasks.filter(task => task.status === 'failed').length;
        return {
            status:successfulCount ? 'partial' : 'failed',
            successfulCount,
            failedCount,
            totalCount:tasks.length,
            title:options.actionName || '',
            message:'',
            summary:tasks.find(task => task.technicalError)?.technicalError || '',
        };
    }
};
const generationRecoveryPersistenceModule = window.SmartCanvasModules?.canvasPersistence;
if(!generationRecoveryPersistenceModule) throw new Error('Canvas Persistence Module failed to load');

const generationRecoveryActiveTaskPolls = new Map();
const generationRecoveryActiveNodeResumes = new Map();
const generationRecoveryActiveQueuePolls = new Set();
let generationRecoveryActorIdPromise = null;
const GENERATION_RECOVERY_QUEUE_POLL_INTERVAL = 60000;
const GENERATION_RECOVERY_QUEUE_POLL_MAX = 1440;

function generationRecoveryActorId(){
    const known = String(window.__IC_USER?.id || '').trim();
    if(known) return Promise.resolve(known);
    if(!generationRecoveryActorIdPromise){
        generationRecoveryActorIdPromise = fetch('/api/auth/me', {
            credentials:'same-origin',
            cache:'no-store'
        }).then(async response => {
            if(!response.ok) return '';
            const payload = await response.json();
            return String(payload?.user?.id || '').trim();
        }).catch(() => '');
    }
    return generationRecoveryActorIdPromise;
}
function generationRecoveryOwnerId(value){
    return String(value?.actorId || value?.actor_id || '').trim();
}
async function generationRecoveryOwnedByCurrentActor(values){
    const items = (values || []).filter(Boolean);
    if(!items.length) return false;
    const ownerIds = items.map(generationRecoveryOwnerId);
    if(ownerIds.some(ownerId => !ownerId)) return false;
    const actorId = await generationRecoveryActorId();
    return Boolean(actorId && ownerIds.every(ownerId => ownerId === actorId));
}

function generationRecoveryTasks(node){
    return generationRecoveryPendingModule.tasks(node);
}
function generationRecoveryApply(node, event){
    if(!node) return null;
    const next = generationRecoveryPendingModule.transition(
        generationRecoveryPendingModule.snapshot(node),
        event
    );
    generationRecoveryPendingModule.keys.forEach(key => {
        if(Object.prototype.hasOwnProperty.call(next, key)) node[key] = next[key];
        else delete node[key];
    });
    return node;
}
function generationRecoveryRestoreActiveRuns(runs=[]){
    const activeRuns = (Array.isArray(runs) ? runs : []).filter(run =>
        run?.id
        && run?.node_id
        && run?.generation_operation_id
    );
    const byNode = new Map();
    activeRuns.forEach(run => {
        const nodeId = String(run.node_id || '');
        if(!byNode.has(nodeId)) byNode.set(nodeId, []);
        byNode.get(nodeId).push(run);
    });
    let changed = false;
    byNode.forEach((nodeRuns,nodeId) => {
        const node = nodes.find(item => String(item?.id || '') === nodeId);
        if(!node || node.jimengPending?.submitId) return;
        const currentOperationId = String(node.generationOperationId || '');
        let selected = nodeRuns.filter(run =>
            String(run.generation_operation_id || '') === currentOperationId
        );
        if(!selected.length){
            const operationIds = new Set(nodeRuns.map(run =>
                String(run.generation_operation_id || '')
            ).filter(Boolean));
            const hasDisplayResult = typeof smartNodeHasDisplayResult === 'function'
                ? smartNodeHasDisplayResult(node)
                : (node.images || []).some(item => item?.url && !item.loopInputPreview);
            if(
                operationIds.size !== 1
                || hasDisplayResult
                || generationRecoveryTasks(node).length
            ) return;
            selected = nodeRuns;
            node.generationOperationId = [...operationIds][0];
        }
        const existingTasks = generationRecoveryTasks(node).filter(task =>
            !selected.some(run => String(run.id) === String(task.taskId))
        );
        const restoredTasks = selected.map(run => ({
            taskId:String(run.id),
            actorId:String(run.actor_id || ''),
            kind:String(run.kind || 'image'),
            providerId:String(run.provider_id || ''),
            nodeId,
            generationRequestIndex:Number(run.generation_request_index || 0)
        }));
        generationRecoveryApply(node, {
            type:'submitted',
            tasks:[...existingTasks, ...restoredTasks],
            expectedCount:existingTasks.length + restoredTasks.length,
            startedAt:Math.min(...selected.map(run =>
                Number(run.created_at || 0) * 1000
            ).filter(Boolean), nowMs())
        });
        changed = true;
    });
    if(changed){
        render();
        generationRecoveryPersistenceModule.schedule();
    }
    return changed;
}
class GenerationRecoveryQueuedSignal extends Error {
    constructor(info){
        const data = info || {};
        super(data.message || tr('smart.jimengQueuedRecoverable'));
        this.jimengPending = true;
        this.submitId = data.submitId || data.submit_id || '';
        this.kind = data.kind || 'image';
        this.actorId = data.actorId || data.actor_id || '';
        this.queueInfo = data.queueInfo || data.queue_info || {};
    }
}
class GenerationRecoveryTaskSignal extends Error {
    constructor(info){
        const data = info || {};
        super(data.message || tr('smart.taskRecoverableLater'));
        this.imageTaskRecover = true;
        this.taskId = data.taskId || data.task_id || '';
        this.recoverTaskId = data.recoverTaskId || data.upstream_task_id || data.task_id || '';
        this.providerId = data.providerId || data.provider_id || '';
        this.kind = data.kind || 'image';
    }
}
function generationRecoveryUpstreamTaskId(text){
    const match = String(text || '').match(/(?:task_id|taskId|task id)\s*[=:：]\s*([A-Za-z0-9_.:-]+)/i);
    return match ? match[1] : '';
}
function generationRecoveryQueueText(queueInfo){
    const info = queueInfo || {};
    if(info.queue_idx != null && info.queue_length != null){
        return trf('smart.jimengQueuePosition', {index: info.queue_idx, total: info.queue_length});
    }
    return tr('smart.jimengGenerating');
}
async function generationRecoverySetQueued(node, signal, {initiatedHere=false}={}){
    if(!node || !signal?.submitId) return false;
    generationRecoveryApply(node, {type:'queued', signal, now:nowMs()});
    render();
    generationRecoveryPersistenceModule.schedule();
    await generationRecoveryPersistenceModule.save();
    if(typeof generationRecoveryPersistenceModule.synced === 'function'){
        await generationRecoveryPersistenceModule.synced({timeout:5000});
    }
    generationRecoveryStartQueuePoll(node, {initiatedHere});
    return true;
}
function generationRecoveryApplyQueueResult(node, data){
    if(!node || !data) return false;
    if(data.status === 'succeeded'){
        const submissionSnapshot = node.jimengPending?.submissionSnapshot || null;
        const additions = generationRecoveryOutputModule.apply({
            node,
            outputs:data.urls || [],
            kind:data.kind || node.jimengPending?.kind || 'image',
            strategy:'queued',
            submissionSnapshot
        });
        if(additions.length){
            delete node.generationPreviousPresentation;
            render();
            generationRecoveryPersistenceModule.schedule();
        }
        return Boolean(additions.length);
    }
    if(data.status === 'failed'){
        generationRecoveryApply(node, {type:'queue-failed', now:nowMs()});
        if(typeof restoreGenerationPresentationSnapshot === 'function'){
            restoreGenerationPresentationSnapshot(node);
        }
        toast((data.error || tr('smart.jimengFailed')).slice(0, 160));
        render();
        generationRecoveryPersistenceModule.schedule();
        return true;
    }
    generationRecoveryApply(node, {
        type:'queue-updated',
        queueInfo:data.queue_info || {},
        message:data.message || '',
        now:nowMs()
    });
    render();
    generationRecoveryPersistenceModule.schedule();
    return false;
}
async function generationRecoveryFetchQueue(submitId, kind){
    return fetch('/api/jimeng/query-media', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({submit_id:submitId, kind:kind || 'image'})
    }).then(async response => {
        if(!response.ok) throw new Error(await response.text());
        return response.json();
    });
}
async function generationRecoveryQueryQueue(nodeId){
    const node = nodes.find(item => item.id === nodeId);
    if(!node?.jimengPending?.submitId || node.jimengPending.querying) return;
    if(!await generationRecoveryOwnedByCurrentActor([node.jimengPending])) return;
    const submitId = node.jimengPending.submitId;
    const kind = node.jimengPending.kind || 'image';
    generationRecoveryApply(node, {type:'queue-querying', querying:true});
    render();
    try {
        generationRecoveryApplyQueueResult(
            node,
            await generationRecoveryFetchQueue(submitId, kind)
        );
    } catch(error){
        toast((error.message || tr('canvas.queryFailed')).slice(0, 160));
    } finally {
        if(node.jimengPending){
            generationRecoveryApply(node, {type:'queue-querying', querying:false});
        }
        render();
    }
}
function generationRecoveryProviderId(node, task){
    return task?.providerId
        || node?.runSettings?.provider_id
        || generationRecoverySettingsModule.snapshot().provider_id
        || 'comfly';
}
async function generationRecoveryFetchImageTask(providerId, taskId){
    return fetch('/api/image-task-query', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({provider_id:providerId || 'comfly', task_id:taskId})
    }).then(async response => {
        if(!response.ok) throw new Error(await response.text());
        return response.json();
    });
}
async function generationRecoveryQueryImageTask(nodeId, localTaskId){
    const node = nodes.find(item => item.id === nodeId);
    if(!node) return;
    const task = generationRecoveryTasks(node).find(item => item.taskId === localTaskId)
        || smartRecoverableImageTask(node);
    if(!task || task.querying) return;
    if(!await generationRecoveryOwnedByCurrentActor([task])) return;
    const recoverTaskId = task.recoverTaskId
        || generationRecoveryUpstreamTaskId(task.error || '');
    if(!recoverTaskId){
        toast(tr('smart.noTaskId'));
        return;
    }
    generationRecoveryApply(node, {
        type:'task-querying',
        taskId:task.taskId,
        querying:true
    });
    render();
    try {
        const providerId = generationRecoveryProviderId(node, task);
        const data = await generationRecoveryFetchImageTask(providerId, recoverTaskId);
        if(data.status === 'succeeded'){
            const additions = generationRecoveryOutputModule.apply({
                node,
                taskId:task.taskId,
                outputs:data.image_items?.length
                    ? data.image_items
                    : (data.images?.length ? data.images : data),
                kind:task.kind || 'image',
                strategy:'task'
            });
            render();
            generationRecoveryPersistenceModule.schedule();
            return;
        }
        const message = data.status === 'failed'
            ? (data.error || tr('smart.errRunFailed'))
            : (data.message || tr('canvas.taskStillRunning'));
        generationRecoveryApply(node, {
            type:'task-recoverable',
            taskId:task.taskId,
            recoverTaskId,
            providerId,
            error:message
        });
        toast(data.status === 'failed' ? message.slice(0, 160) : message);
    } catch(error){
        const message = error.message || tr('canvas.queryFailed');
        generationRecoveryApply(node, {
            type:'task-recoverable',
            taskId:task.taskId,
            recoverTaskId,
            providerId:generationRecoveryProviderId(node, task),
            error:message
        });
        toast(message.slice(0, 160));
    } finally {
        const latest = generationRecoveryTasks(node).find(item => item.taskId === localTaskId);
        if(latest){
            generationRecoveryApply(node, {
                type:'task-querying',
                taskId:latest.taskId,
                querying:false
            });
        }
        render();
        generationRecoveryPersistenceModule.schedule();
    }
}
async function generationRecoveryStartQueuePoll(node, {initiatedHere=false}={}){
    if(!node?.jimengPending?.submitId) return;
    if(
        !initiatedHere
        && !await generationRecoveryOwnedByCurrentActor([node.jimengPending])
    ) return;
    const submitId = node.jimengPending.submitId;
    if(generationRecoveryActiveQueuePolls.has(submitId)) return;
    generationRecoveryActiveQueuePolls.add(submitId);
    const nodeId = node.id;
    (async () => {
        try {
            for(let index = 0; index < GENERATION_RECOVERY_QUEUE_POLL_MAX; index++){
                await new Promise(resolve => setTimeout(
                    resolve,
                    GENERATION_RECOVERY_QUEUE_POLL_INTERVAL
                ));
                const current = nodes.find(item => item.id === nodeId);
                if(!current?.jimengPending
                    || current.jimengPending.submitId !== submitId) return;
                if(current.jimengPending.querying) continue;
                let data;
                try {
                    data = await generationRecoveryFetchQueue(
                        submitId,
                        current.jimengPending.kind || 'image'
                    );
                } catch(error){
                    continue;
                }
                if(generationRecoveryApplyQueueResult(current, data)) return;
                const after = nodes.find(item => item.id === nodeId);
                if(!after?.jimengPending
                    || after.jimengPending.submitId !== submitId) return;
            }
        } finally {
            generationRecoveryActiveQueuePolls.delete(submitId);
        }
    })();
}
function generationRecoveryTaskStillPending(nodeId, taskId){
    if(!nodeId) return true;
    const node = nodes.find(item => item.id === nodeId);
    return Boolean(
        node
        && generationRecoveryTasks(node).some(task => task.taskId === taskId)
    );
}
function generationRecoveryImageProcessorTask(node, task){
    if(!node?.imageProcessorJob) return false;
    const taskId = String(task?.id || task?.task_id || '');
    const expectedTaskId = String(node.imageProcessorJob.taskId || '');
    return String(task?.type || '') === 'image-processor'
        && (!expectedTaskId || !taskId || expectedTaskId === taskId);
}
function generationRecoveryProjectImageProcessor(nodeId, task){
    const node = nodes.find(item => item.id === nodeId);
    if(!generationRecoveryImageProcessorTask(node, task)) return false;
    const progress = Math.max(0, Math.min(100, Number(task.progress || 0)));
    const next = {
        ...(node.imageProcessorJob || {}),
        active:!['succeeded','failed','discarded'].includes(String(task.status || '')),
        taskId:String(task.id || node.imageProcessorJob?.taskId || ''),
        phase:String(task.phase || task.status || node.imageProcessorJob?.phase || 'running').slice(0,80),
        progress:Number.isFinite(progress) ? progress : 0,
        message:String(task.message || node.imageProcessorJob?.message || '').slice(0,160),
        updatedAt:nowMs()
    };
    const before = JSON.stringify([
        node.imageProcessorJob?.active,
        node.imageProcessorJob?.phase,
        node.imageProcessorJob?.progress,
        node.imageProcessorJob?.message
    ]);
    const after = JSON.stringify([next.active,next.phase,next.progress,next.message]);
    node.imageProcessorJob = next;
    if(before !== after){
        render();
        generationRecoveryPersistenceModule.schedule();
    }
    return true;
}
function generationRecoveryFinalizeImageProcessor(node, task, error=null){
    if(!node?.imageProcessorJob) return false;
    const taskId = String(task?.id || task?.task_id || task?.taskId || '');
    const expectedTaskId = String(node.imageProcessorJob.taskId || '');
    if(expectedTaskId && taskId && expectedTaskId !== taskId) return false;
    if(error){
        const message = String(error.message || task?.error || tr('smart.depthMapProcessingFailed')).slice(0,500);
        node.imageProcessorJob = {
            ...(node.imageProcessorJob || {}),
            active:false,
            phase:'failed',
            message,
            error:message,
            updatedAt:nowMs()
        };
    } else {
        delete node.imageProcessorJob;
    }
    node.outputKind = 'depth-map';
    node.title = tr('smart.depthMap');
    return true;
}
async function generationRecoveryPollTask(taskId, nodeId='', kind='image'){
    if(!taskId) throw new Error(tr('smart.errRunFailed'));
    if(generationRecoveryActiveTaskPolls.has(taskId)){
        return generationRecoveryActiveTaskPolls.get(taskId);
    }
    const promise = (async () => {
        for(let index = 0; index < 900; index++){
            await new Promise(resolve => setTimeout(resolve, 2000));
            if(!generationRecoveryTaskStillPending(nodeId, taskId)){
                const error = new Error(tr('smart.runReplaced'));
                error.generationDiscarded = true;
                throw error;
            }
            let task;
            try {
                const taskPath = kind === 'text'
                    ? '/api/canvas-llm-tasks/'
                    : kind === 'video'
                        ? '/api/canvas-video-tasks/'
                        : '/api/canvas-image-tasks/';
                task = await fetch(
                    `${taskPath}${encodeURIComponent(taskId)}`
                ).then(async response => {
                    if(response.ok) return response.json();
                    const error = new Error(await response.text());
                    error.status = response.status;
                    throw error;
                });
            } catch(error){
                const status = Number(error?.status || 0);
                const transient = !status
                    || status === 404
                    || status === 408
                    || status === 429
                    || status >= 500;
                if(transient && index < 45) continue;
                throw error;
            }
            generationRecoveryProjectImageProcessor(nodeId, task);
            if(task.status === 'succeeded') return {payload:task.result || {}, task};
            if(task.status === 'discarded'){
                const error = new Error(
                    task.message || tr('smart.targetDeleted')
                );
                error.generationDiscarded = true;
                throw error;
            }
            if(task.status === 'jimeng_pending'){
                throw new GenerationRecoveryQueuedSignal({
                    submitId:task.submit_id,
                    kind:task.kind,
                    actorId:task.actor_id,
                    queueInfo:task.queue_info,
                    message:task.message
                });
            }
            if(task.status === 'failed'){
                const recoverTaskId = task.upstream_task_id
                    || generationRecoveryUpstreamTaskId(task.error || '');
                if(recoverTaskId){
                    const signal = new GenerationRecoveryTaskSignal({
                        taskId,
                        recoverTaskId,
                        providerId:task.provider_id,
                        kind:'image',
                        message:task.error || tr('smart.errRunFailed')
                    });
                    signal.generationTask = task;
                    throw signal;
                }
                const failure = new Error(task.error || tr('smart.errRunFailed'));
                failure.generationTask = task;
                failure.status = Number(task.status_code || task.diagnostics?.http_status || 0);
                throw failure;
            }
        }
        throw new Error(tr('smart.errRunTimeout'));
    })();
    generationRecoveryActiveTaskPolls.set(taskId, promise);
    try {
        return await promise;
    } finally {
        generationRecoveryActiveTaskPolls.delete(taskId);
    }
}
function generationRecoveryRecordFailure(logContext, message){
    if(!logContext?.run || !message) return;
    const runMs = Math.max(
        0,
        nowMs() - Number(logContext.runLogStart || nowMs())
    );
    addSmartGenerationLog({
        run:logContext.run,
        outputs:[],
        runMs,
        error:message
    });
}
async function generationRecoveryProcessorOutputs(node,outputs){
    const target=node?.aiProcessorPostprocess;
    const geometry=window.SmartCanvasModules?.aiProcessorGeometry;
    if(!target||!geometry?.postprocessOutputs) return outputs;
    return geometry.postprocessOutputs(resultMediaUrls(outputs||[]),target);
}
async function generationRecoveryResumeNodeOnce(
    node,
    tasks,
    logContext={},
    {batchManaged=false}={}
){
    generationRecoveryApply(node, {
        type:'submitted',
        tasks,
        expectedCount:tasks.length,
        startedAt:Number(node.runStartedAt || 0) || nowMs()
    });
    render();
    const failures = [];
    const reportedFailures = [];
    const submittedOutputCount = tasks
        .map(task => Number(task?.submissionSnapshot?.outputCount))
        .find(count => Number.isFinite(count) && count >= 0);
    let successfulCount = Number.isFinite(submittedOutputCount)
        ? Math.max(0, (node.images || []).length - submittedOutputCount)
        : 0;
    const failureReasons = [];
    const taskOutcomes = [];
    const successfulOutputs = [];
    let deferred = false;
    await Promise.all(tasks.map(async (task, taskIndex) => {
        if(task.failed && task.recoverTaskId) return;
        try {
            const polled = await generationRecoveryPollTask(
                task.taskId,
                node.id,
                task.kind || 'image'
            );
            const result = polled?.payload || {};
            const currentNode = nodes.find(item => item.id === node.id);
            if(!currentNode
                || (
                    node.generationOperationId
                    && currentNode.generationOperationId !== node.generationOperationId
                )){
                return;
            }
            if(task.kind === 'text'){
                const generatedText = String(result?.text || '').trim();
                if(!generatedText) throw new Error(tr('smart.noTextReturned'));
                currentNode.text = generatedText;
                delete currentNode.textGenerationPending;
                generationRecoveryApply(currentNode, {
                    type:'task-succeeded',
                    taskId:task.taskId,
                    outputs:[],
                    kind:'text',
                    now:nowMs()
                });
                markSmartNodeComplete(currentNode);
                const sourceNode = nodes.find(item => item.id === task.sourceNodeId);
                if(sourceNode) clearSmartNodeBusyState(sourceNode);
                successfulCount += 1;
                taskOutcomes.push({
                    index:taskIndex,
                    localTaskId:task.taskId || '',
                    upstreamTaskId:'',
                    status:'succeeded',
                    runMs:Math.max(0, Number((polled?.task?.updated_at - polled?.task?.created_at) * 1000) || 0),
                });
                render();
                generationRecoveryPersistenceModule.schedule();
                return;
            }
            const rawOutputs=result?.image_items?.length
                ? result.image_items
                : (result?.images?.length ? result.images : result);
            const processedOutputs=await generationRecoveryProcessorOutputs(currentNode,rawOutputs);
            const additions = generationRecoveryOutputModule.apply({
                node:currentNode,
                taskId:task.taskId,
                outputs:processedOutputs,
                kind:task.kind || 'image',
                strategy:'task'
            });
            generationRecoveryFinalizeImageProcessor(currentNode, polled?.task);
            successfulCount += additions.length;
            successfulOutputs.push(...additions);
            taskOutcomes.push({
                index:taskIndex,
                localTaskId:task.taskId || '',
                upstreamTaskId:polled?.task?.diagnostics?.upstream_task_ids?.[0]
                    || task.recoverTaskId
                    || '',
                status:'succeeded',
                runMs:Math.max(0, Number((polled?.task?.updated_at - polled?.task?.created_at) * 1000) || 0),
            });
            render();
            generationRecoveryPersistenceModule.schedule();
        } catch(error){
            if(error?.generationDiscarded){
                deferred = true;
                return;
            }
            if(error?.jimengPending && error.submitId){
                await generationRecoverySetQueued(node, {
                    ...error,
                    ...(task.submissionSnapshot
                        ? {submissionSnapshot:{...task.submissionSnapshot}}
                        : {})
                }, {initiatedHere:true});
                return;
            }
            if(error?.imageTaskRecover && error.recoverTaskId){
                const message = error.message || tr('smart.errRunFailed');
                generationRecoveryApply(node, {
                    type:'task-recoverable',
                    taskId:task.taskId,
                    recoverTaskId:error.recoverTaskId,
                    providerId:error.providerId
                        || task.providerId
                        || generationRecoveryProviderId(node, task),
                    error:message
                });
                const taskData = error?.generationTask || {};
                const diagnostics = taskData.diagnostics || {};
                reportedFailures.push(error);
                failureReasons.push(message);
                taskOutcomes.push({
                    index:taskIndex,
                    localTaskId:task.taskId || '',
                    upstreamTaskId:error.recoverTaskId || '',
                    status:'failed',
                    runMs:Math.max(0, Number((taskData.updated_at - taskData.created_at) * 1000) || 0),
                    technicalError:message,
                    httpStatus:Number(diagnostics.http_status || taskData.status_code || 0),
                    errorCode:diagnostics.tasks?.[0]?.upstream_error_code || '',
                    providerId:diagnostics.provider_id || task.providerId || '',
                    billingEvidence:diagnostics.tasks?.[0]?.billing_evidence
                        || diagnostics.billing_evidence
                        || {},
                });
                render();
                generationRecoveryPersistenceModule.schedule();
                return;
            }
            generationRecoveryApply(node, {
                type:'task-failed',
                taskId:task.taskId
            });
            generationRecoveryFinalizeImageProcessor(
                node,
                error?.generationTask || task,
                error
            );
            if(!node.pending
                && generationRecoveryTasks(node).length === 0
                && !(node.images || []).length
                && !node.generationBatchId){
                delete node.w;
                delete node.h;
            }
            failures.push(error);
            reportedFailures.push(error);
            failureReasons.push(error.message || tr('smart.errRunFailed'));
            const taskData = error?.generationTask || {};
            const diagnostics = taskData.diagnostics || {};
            taskOutcomes.push({
                index:taskIndex,
                localTaskId:task.taskId || '',
                upstreamTaskId:diagnostics.upstream_task_ids?.[0]
                    || diagnostics.tasks?.[0]?.upstream_task_id
                    || task.recoverTaskId
                    || '',
                status:'failed',
                runMs:Math.max(0, Number((taskData.updated_at - taskData.created_at) * 1000) || 0),
                technicalError:error.message || tr('smart.errRunFailed'),
                httpStatus:Number(diagnostics.http_status || taskData.status_code || error.status || 0),
                errorCode:diagnostics.tasks?.[0]?.upstream_error_code || '',
                providerId:diagnostics.provider_id || task.providerId || '',
                billingEvidence:diagnostics.tasks?.[0]?.billing_evidence
                    || diagnostics.billing_evidence
                    || {},
            });
            render();
            generationRecoveryPersistenceModule.schedule();
        }
    }));
    if(reportedFailures.length){
        const operationName = generationRecoveryFailureModule.actionName(logContext.run || node, tr);
        const aggregateFailure = () => generationRecoveryFailureModule.aggregate(
            taskOutcomes,
            tr,
            typeof trf === 'function' ? trf : (key, values) => `${key} ${JSON.stringify(values)}`,
            {actionName:operationName}
        );
        const aggregate = aggregateFailure();
        node.generationRunFeedback = {
            successfulCount,
            failedCount:reportedFailures.length,
            reasonCategories:(aggregate.reasons || []).map(item => item.category).slice(0, 8),
            finishedAt:nowMs()
        };
        if(successfulCount === 0
            && typeof restoreGenerationPresentationSnapshot === 'function'){
            restoreGenerationPresentationSnapshot(node);
        } else if(successfulCount > 0) {
            delete node.generationPreviousPresentation;
        }
        const runMs = Math.max(0, nowMs() - Number(logContext.runLogStart || nowMs()));
        const entry = batchManaged ? null : addSmartGenerationLog({
            run:logContext.run,
            outputs:successfulOutputs,
            runMs,
            error:failureReasons[0] || tr('smart.errRunFailed'),
            status:aggregate.status,
            tasks:taskOutcomes.slice().sort((a, b) => a.index - b.index),
            diagnostics:reportedFailures[0]?.generationTask?.diagnostics || null,
        });
        reportedFailures.forEach(error => {
            if(error && typeof error === 'object') error.smartGenerationLogged = true;
        });
        if(!batchManaged){
            toast(aggregate.message, {
                persistent:true,
                detailLogId:entry?.id || '',
                detailRunId:logContext.run?.generationRunId || '',
                heading:aggregate.title,
                headingFactory:() => aggregateFailure().title,
                textFactory:() => aggregateFailure().message,
            });
        }
    } else if(!generationRecoveryTasks(node).some(task => task.failed)){
        delete node.generationRunFeedback;
        delete node.generationPreviousPresentation;
    }
    if(failures.length && !(node.images || []).length){
        throw failures[0];
    }
    return {
        deferred,
        observer:false,
        logged:Boolean(reportedFailures.length),
        outputs:successfulOutputs
    };
}
function generationRecoveryResumeKey(node, tasks){
    return JSON.stringify([
        String(node?.id || ''),
        String(node?.generationOperationId || ''),
        tasks.map(task => String(task?.taskId || '')).filter(Boolean).sort()
    ]);
}
async function generationRecoveryResumeNode(
    node,
    logContext={},
    {initiatedHere=false,batchManaged=false}={}
){
    const tasks = generationRecoveryTasks(node);
    if(!node || !tasks.length) return;
    if(
        !initiatedHere
        && !await generationRecoveryOwnedByCurrentActor(tasks)
    ){
        return {deferred:true, observer:true};
    }
    const key = generationRecoveryResumeKey(node, tasks);
    const active = generationRecoveryActiveNodeResumes.get(key);
    if(active) return active;
    const promise = Promise.resolve().then(() => generationRecoveryResumeNodeOnce(
        node,
        tasks,
        logContext,
        {batchManaged}
    ));
    generationRecoveryActiveNodeResumes.set(key, promise);
    try {
        return await promise;
    } finally {
        if(generationRecoveryActiveNodeResumes.get(key) === promise){
            generationRecoveryActiveNodeResumes.delete(key);
        }
    }
}
async function generationRecoverySettle(node, submission, options={}){
    if(!submission || !['pending','queued'].includes(submission.state)){
        throw new Error('Generation Recovery requires a pending or queued submission');
    }
    if(submission.state === 'queued'){
        await generationRecoverySetQueued(node, {
            ...submission.signal,
            ...(options.submissionSnapshot
                ? {submissionSnapshot:{...options.submissionSnapshot}}
                : {})
        }, {initiatedHere:true});
        toast((
            submission.signal?.message
            || generationRecoveryQueueText(submission.signal?.queueInfo)
        ).slice(0, 160));
        return {
            state:'queued',
            kind:submission.kind || submission.signal?.kind || 'image',
            urls:[],
            applied:true,
            deferred:true
        };
    }
    const before = new Set(
        (node?.images || []).map(item => `${item?.kind || ''}|${item?.url || ''}`)
    );
    if(options.archiveExisting){
        generationRecoveryOutputModule.apply({
            node,
            kind:submission.kind || 'image',
            strategy:'archive'
        });
    }
    generationRecoveryApply(node, {
        type:'submitted',
        tasks:(submission.tasks || []).map(task => ({
            ...task,
            ...(options.submissionSnapshot
                ? {submissionSnapshot:{...options.submissionSnapshot}}
                : {})
        })),
        expectedCount:(submission.tasks || []).length,
        startedAt:Number(node.runStartedAt || 0) || nowMs()
    });
    render();
    generationRecoveryPersistenceModule.schedule();
    await generationRecoveryPersistenceModule.save();
    if(typeof generationRecoveryPersistenceModule.synced === 'function'){
        await generationRecoveryPersistenceModule.synced({timeout:5000});
    }
    const recoveryState = await generationRecoveryResumeNode(
        node,
        options.logContext || {},
        {
            initiatedHere:true,
            batchManaged:Boolean(options.batchManaged)
        }
    );
    if(node.jimengPending
        || generationRecoveryTasks(node).some(task => task.failed && task.recoverTaskId)){
        return {
            state:node.jimengPending ? 'queued' : 'pending',
            kind:submission.kind || 'image',
            urls:[],
            applied:true,
            deferred:true,
            logged:Boolean(recoveryState?.logged)
        };
    }
    const recoveredOutputs = Array.isArray(recoveryState?.outputs)
        ? recoveryState.outputs
        : node.images || [];
    const urls = recoveredOutputs.filter(item =>
        item?.url && !before.has(`${item.kind || ''}|${item.url}`)
    );
    if(recoveryState?.deferred && !urls.length){
        return {
            state:'pending',
            kind:submission.kind || 'image',
            urls:[],
            applied:true,
            deferred:true
        };
    }
    return {
        state:'completed',
        kind:submission.kind || mediaKindForUrls(urls, 'image'),
        urls,
        applied:true,
        deferred:false,
        logged:Boolean(recoveryState?.logged)
    };
}
function generationRecoveryResume(){
    const taskResumptions = nodes
        .filter(node => generationRecoveryTasks(node).length)
        .map(node => generationRecoveryResumeNode(node));
    const queueResumptions = nodes
        .filter(node => node?.jimengPending?.submitId)
        .map(async node => {
            if(!await generationRecoveryOwnedByCurrentActor([node.jimengPending])){
                return {deferred:true, observer:true};
            }
            generationRecoveryApply(node, {type:'queue-querying', querying:false});
            await generationRecoveryStartQueuePoll(node, {initiatedHere:true});
            return {deferred:false, observer:false};
        });
    return Promise.all([...taskResumptions, ...queueResumptions]);
}
function generationRecoveryRecover({nodeId='', taskId='', kind='auto'}={}){
    const node = nodes.find(item => item.id === nodeId);
    if(!node) return;
    if(kind === 'jimeng' || (kind === 'auto' && node.jimengPending)){
        return generationRecoveryQueryQueue(nodeId);
    }
    const recoverable = generationRecoveryTasks(node).find(task =>
        task.failed
        && task.recoverTaskId
        && (!taskId || task.taskId === taskId || task.recoverTaskId === taskId)
    );
    return recoverable
        ? generationRecoveryQueryImageTask(nodeId, recoverable.taskId)
        : undefined;
}
function generationRecoveryStatus({nodeId='', node=null}={}){
    const target = node || (nodeId
        ? nodes.find(item => item.id === nodeId)
        : null);
    const pendingTasks = generationRecoveryTasks(target).map(task => ({...task}));
    return {
        pendingTasks,
        recoverableTask:pendingTasks.find(
            task => task.failed && task.recoverTaskId
        ) || null,
        queued:Boolean(target?.jimengPending),
        queue:target?.jimengPending ? {...target.jimengPending} : null
    };
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.generationRecovery = Object.freeze({
    settle({node=null, submission=null, archiveExisting=false, logContext={},submissionSnapshot=null,batchManaged=false}={}){
        return generationRecoverySettle(node, submission, {
            archiveExisting,
            logContext,
            submissionSnapshot,
            batchManaged
        });
    },
    resume(){
        return generationRecoveryResume();
    },
    restoreActive({runs=[]}={}){
        return generationRecoveryRestoreActiveRuns(runs);
    },
    recover(options={}){
        return generationRecoveryRecover(options);
    },
    status(options={}){
        return generationRecoveryStatus(options);
    }
});
