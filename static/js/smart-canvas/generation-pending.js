/*
 * Smart Canvas Pending Node Module
 *
 * Pure state transitions for submitted, queued, recoverable, failed and
 * completed Generation Run tasks. Rendering and persistence stay in the
 * Generation Recovery and Generation Output Implementations.
 */
const GENERATION_PENDING_STATE_KEYS = Object.freeze([
    'pendingTasks',
    'pending',
    'running',
    'jimengPending',
    'images',
    'outputKind',
    'runStartedAt',
    'runFinishedAt',
    'runElapsedMs',
    'runTimerHidden',
    'generationRunFeedback',
]);

function cloneGenerationPendingValue(value){
    if(value === undefined) return undefined;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch(error) {
        if(Array.isArray(value)) return value.map(item => ({...item}));
        return value && typeof value === 'object' ? {...value} : value;
    }
}
function generationPendingSnapshot(node={}){
    node = node || {};
    const snapshot = {};
    GENERATION_PENDING_STATE_KEYS.forEach(key => {
        if(Object.prototype.hasOwnProperty.call(node, key)){
            snapshot[key] = cloneGenerationPendingValue(node[key]);
        }
    });
    if(Array.isArray(snapshot.pendingTasks)) snapshot.pendingTasks = snapshot.pendingTasks.filter(task => task?.taskId);
    else delete snapshot.pendingTasks;
    snapshot.images = Array.isArray(snapshot.images) ? snapshot.images : [];
    snapshot.pending = Math.max(0, Number(snapshot.pending || 0));
    snapshot.running = Boolean(snapshot.running);
    return snapshot;
}
function generationPendingTasks(state={}){
    return (state.pendingTasks || []).filter(task => task?.taskId);
}
function generationPendingOutputKey(item){
    return item?.url ? `${item.kind || 'image'}|${String(item.url)}` : '';
}
function generationPendingFinish(next, now){
    delete next.pendingTasks;
    next.pending = 0;
    next.running = false;
    next.runFinishedAt = Number(now || 0);
    if(!next.runStartedAt) next.runStartedAt = next.runFinishedAt;
    next.runElapsedMs = Math.max(0, next.runFinishedAt - Number(next.runStartedAt || next.runFinishedAt));
    next.runTimerHidden = true;
}
function transitionGenerationPending(state, event={}){
    const next = generationPendingSnapshot(state);
    const type = String(event.type || '');
    const now = Number(event.now || Date.now());
    if(type === 'submitted'){
        delete next.generationRunFeedback;
        next.pendingTasks = (event.tasks || []).filter(task => task?.taskId).map(task => ({...task}));
        next.pending = Math.max(next.pendingTasks.length, Number(event.expectedCount || 0), next.pending);
        next.running = false;
        next.runStartedAt = Number(event.startedAt || next.runStartedAt || now);
        delete next.runFinishedAt;
        delete next.runElapsedMs;
        next.runTimerHidden = false;
        return next;
    }
    if(type === 'task-querying'){
        next.pendingTasks = generationPendingTasks(next).map(task =>
            task.taskId === event.taskId ? {...task, querying:Boolean(event.querying)} : task
        );
        return next;
    }
    if(type === 'task-recoverable'){
        next.pendingTasks = generationPendingTasks(next).map(task => task.taskId === event.taskId ? {
            ...task,
            failed:true,
            querying:false,
            recoverTaskId:event.recoverTaskId || task.recoverTaskId || '',
            providerId:event.providerId || task.providerId || '',
            error:event.error || task.error || ''
        } : task);
        next.pending = Math.max(1, next.pendingTasks.length);
        next.running = false;
        return next;
    }
    if(type === 'task-failed'){
        next.pendingTasks = generationPendingTasks(next).filter(task => task.taskId !== event.taskId);
        next.pending = Math.max(0, next.pending - 1);
        if(!next.pendingTasks.length && !next.pending){
            delete next.pendingTasks;
            next.running = false;
        }
        return next;
    }
    if(type === 'task-succeeded'){
        next.pendingTasks = generationPendingTasks(next).filter(task => task.taskId !== event.taskId);
        next.pending = Math.max(0, next.pending - 1);
        const seen = new Set(next.images.map(generationPendingOutputKey).filter(Boolean));
        const additions = (event.outputs || []).filter(item => {
            const key = generationPendingOutputKey(item);
            if(!item?.url || seen.has(key)) return false;
            seen.add(key);
            return true;
        }).map(item => ({...item}));
        next.images = [...next.images, ...additions];
        if(additions.length) next.outputKind = event.kind || additions[0]?.kind || next.outputKind || 'image';
        if(!next.pendingTasks.length && !next.pending) generationPendingFinish(next, now);
        return next;
    }
    if(type === 'queued'){
        const previous = next.jimengPending?.submitId === event.signal?.submitId ? next.jimengPending : null;
        next.jimengPending = {
            submitId:event.signal?.submitId || '',
            kind:event.signal?.kind || previous?.kind || 'image',
            actorId:event.signal?.actorId || previous?.actorId || '',
            queueInfo:event.signal?.queueInfo || previous?.queueInfo || {},
            message:event.signal?.message || previous?.message || '',
            submissionSnapshot:event.signal?.submissionSnapshot
                || previous?.submissionSnapshot
                || null,
            startedAt:previous?.startedAt || Number(event.startedAt || now),
            updatedAt:now,
            querying:previous ? Boolean(previous.querying) : false
        };
        delete next.pendingTasks;
        next.pending = 0;
        next.running = false;
        if(!next.runStartedAt) next.runStartedAt = next.jimengPending.startedAt;
        delete next.runFinishedAt;
        delete next.runElapsedMs;
        next.runTimerHidden = false;
        return next;
    }
    if(type === 'queue-querying'){
        if(next.jimengPending) next.jimengPending = {...next.jimengPending, querying:Boolean(event.querying)};
        return next;
    }
    if(type === 'queue-updated'){
        if(next.jimengPending){
            next.jimengPending = {
                ...next.jimengPending,
                queueInfo:event.queueInfo || next.jimengPending.queueInfo || {},
                message:event.message || next.jimengPending.message || '',
                updatedAt:now
            };
        }
        return next;
    }
    if(type === 'queue-failed'){
        delete next.jimengPending;
        next.pending = 0;
        next.running = false;
        return next;
    }
    if(type === 'queue-succeeded'){
        delete next.jimengPending;
        generationPendingFinish(next, now);
        return next;
    }
    throw new Error(`Unsupported Pending Node transition: ${type || 'unknown'}`);
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.generationPending = Object.freeze({
    keys:GENERATION_PENDING_STATE_KEYS,
    snapshot(node={}){
        return generationPendingSnapshot(node);
    },
    tasks(node={}){
        return generationPendingTasks(generationPendingSnapshot(node)).map(task => ({...task}));
    },
    transition(state, event){
        return transitionGenerationPending(state, event);
    },
});
