(function installCanvasCommitLane(global){
'use strict';

function stableValue(value){
    if(Array.isArray(value)) return value.map(stableValue);
    if(value && typeof value === 'object'){
        return Object.keys(value).sort().reduce((result,key) => {
            result[key] = stableValue(value[key]);
            return result;
        },{});
    }
    return value;
}
function intentKey(intent){
    return JSON.stringify(stableValue(intent || {}));
}
function safeId(value){
    return String(value || '').replace(/[^A-Za-z0-9_.:-]+/g,'-').slice(0,80);
}
function operationId(action,clientId){
    const random = global.crypto?.randomUUID?.().replaceAll('-','')
        || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    return `prompt:${safeId(action) || 'commit'}:${safeId(clientId) || 'client'}:${random}`.slice(0,160);
}
function responseError(response,data){
    const detail = data?.detail;
    const error = new Error(
        detail?.message || detail || data?.message || '当前画布提示词保存失败'
    );
    error.code = String(detail?.code || data?.code || `http_${response.status}`);
    error.status = response.status;
    error.revision = Number(detail?.revision ?? data?.revision ?? 0);
    return error;
}
function promptConflict(message='这条当前画布提示词已被协作者修改，请保留草稿并重新确认'){
    const error = new Error(message);
    error.code = 'prompt_template_conflict';
    error.status = 409;
    return error;
}

function createCanvasCommitLane(options={}){
    const canvasId = () => String(
        typeof options.canvasId === 'function' ? options.canvasId() : options.canvasId
    ).trim();
    const clientId = () => String(
        typeof options.clientId === 'function' ? options.clientId() : options.clientId
    ).trim();
    const checkpoint = typeof options.checkpoint === 'function'
        ? options.checkpoint
        : async () => ({revision:0});
    const resync = typeof options.resync === 'function'
        ? options.resync
        : async () => true;
    const observeExternalCommit = typeof options.observeExternalCommit === 'function'
        ? options.observeExternalCommit
        : async () => true;
    const onPromptState = typeof options.onPromptState === 'function'
        ? options.onPromptState
        : () => {};
    const request = typeof options.fetch === 'function'
        ? options.fetch
        : (...args) => global.fetch(...args);
    const failedOperations = new Map();
    let lane = Promise.resolve();

    async function loadPromptState(){
        const response = await request(
            `/api/canvases/${encodeURIComponent(canvasId())}/prompt-templates`
        );
        const data = await response.json().catch(() => ({}));
        if(!response.ok) throw responseError(response,data);
        onPromptState(data);
        return data;
    }
    function currentRevision(value){
        return Math.max(0,Number(value?.revision ?? value ?? 0) || 0);
    }
    function targetUnchanged(intent,state){
        if(!['update','delete','promote'].includes(intent.action)) return true;
        const target = (state?.templates || []).find(
            item => String(item?.id || '') === String(intent.itemId || '')
        );
        return Boolean(
            target
            && intent.expectedItemVersion
            && String(target.item_version || '') === String(intent.expectedItemVersion)
        );
    }
    async function submit(intent,opId,baseRevision){
        const id = encodeURIComponent(canvasId());
        const common = {
            operation_id:opId,
            base_revision:baseRevision,
            client_id:clientId(),
        };
        let url = `/api/canvases/${id}/prompt-templates`;
        let method = 'POST';
        let body = null;
        if(intent.action === 'create'){
            body = {...common, name:intent.name, positive:intent.positive, cover:intent.cover || ''};
        } else if(intent.action === 'update'){
            url += `/${encodeURIComponent(intent.itemId)}`;
            method = 'PATCH';
            body = {...common, expected_item_version:intent.expectedItemVersion || '', name:intent.name, positive:intent.positive, cover:intent.cover};
        } else if(intent.action === 'delete'){
            url += `/${encodeURIComponent(intent.itemId)}`;
            method = 'DELETE';
            const query = new URLSearchParams({...common, base_revision:String(baseRevision), expected_item_version:intent.expectedItemVersion || ''});
            url += `?${query}`;
        } else if(intent.action === 'copy'){
            url = `/api/prompt-libraries/items/${encodeURIComponent(intent.sourceItemId)}/copy-to-canvas`;
            body = {...common, canvas_id:canvasId(), library_id:intent.libraryId || ''};
        } else if(intent.action === 'promote'){
            url += `/${encodeURIComponent(intent.itemId)}/promote`;
            body = {...common, expected_item_version:intent.expectedItemVersion || '', library_id:intent.libraryId || '', category:intent.categoryId || ''};
        } else {
            throw new Error(`Unsupported Prompt intent: ${intent.action || ''}`);
        }
        const init = {method};
        if(body){
            init.headers = {'Content-Type':'application/json'};
            init.body = JSON.stringify(body);
        }
        const response = await request(url,init);
        const data = await response.json().catch(() => ({}));
        if(!response.ok) throw responseError(response,data);
        return data;
    }
    async function run(intent,opId){
        let staleRetries = 0;
        let networkRetries = 0;
        for(;;){
            const checkpointState = await checkpoint({reason:'prompt-commit'});
            const revision = currentRevision(checkpointState);
            try {
                const data = await submit(intent,opId,revision);
                await observeExternalCommit({
                    operationId:opId,
                    revision:Number(data.revision || 0),
                    updatedAt:Number(data.updated_at || data.canvas?.updated_at || 0),
                });
                onPromptState(data);
                return Object.freeze({
                    operationId:opId,
                    revision:Number(data.revision || 0),
                    duplicate:Boolean(data.duplicate),
                    data,
                });
            } catch(error){
                if(error?.code === 'stale_prompt_templates' && staleRetries < 1){
                    staleRetries += 1;
                    await resync({reason:'stale-prompt-templates'});
                    const state = await loadPromptState();
                    if(!targetUnchanged(intent,state)) throw promptConflict();
                    continue;
                }
                const networkFailure = !Number(error?.status || 0);
                if(networkFailure && networkRetries < 1){
                    networkRetries += 1;
                    try { await resync({reason:'prompt-response-lost'}); } catch(_error) {}
                    continue;
                }
                throw error;
            }
        }
    }
    function commitPrompt(intent={}){
        const frozenIntent = Object.freeze({...intent});
        const key = intentKey(frozenIntent);
        const opId = failedOperations.get(key)
            || operationId(frozenIntent.action,clientId());
        const task = async () => {
            try {
                const outcome = await run(frozenIntent,opId);
                failedOperations.delete(key);
                return outcome;
            } catch(error){
                failedOperations.set(key,opId);
                throw error;
            }
        };
        const result = lane.then(task,task);
        lane = result.catch(() => undefined);
        return result;
    }
    return Object.freeze({commitPrompt});
}

global.InfiniteCanvasModules = global.InfiniteCanvasModules || {};
global.InfiniteCanvasModules.CanvasCommitLane = Object.freeze({
    create:createCanvasCommitLane,
});
})(window);
