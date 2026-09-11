/* Device-owned submission receipts. Provider execution survives this page. */
(() => {
    let identity = null;
    let initialization = null;
    let refreshTimer = null;
    const records = new Map();
    const activePolls = new Map();
    const api = '/api/local-generation-submissions';
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const text = key => typeof tr === 'function' ? tr(key) : key;
    const errorKey = code => ({
        local_generation_full:'smart.localGenerationFull',
        local_generation_too_large:'smart.localGenerationTooLarge',
        local_generation_uncertain:'smart.localGenerationUncertain',
        local_generation_permission_lost:'smart.editPermissionLost',
        local_generation_workspace_changed:'smart.localGenerationWorkspaceChanged',
        local_generation_unavailable:'smart.localGenerationUnavailable',
        local_generation_storage_failed:'smart.localGenerationStorageFailed',
        local_generation_target_changed:'smart.runReplaced',
    }[code] || 'smart.localGenerationFailed');

    async function request(url, options={}) {
        const response = await fetch(url, {...options, cache:'no-store'});
        const data = await response.json();
        if(!response.ok) {
            const error = new Error(text(errorKey(data.code || data.detail?.code)));
            error.status = response.status;
            error.code = data.code || data.detail?.code || '';
            throw error;
        }
        return data;
    }
    function remember(record) {
        const previous = records.get(record.id);
        records.set(record.id, record);
        if(previous?.status !== record.status || previous?.error !== record.error) {
            if(typeof render === 'function') render();
        }
        return record;
    }
    async function initialize() {
        if(!initialization) initialization = request(api).then(data => {
            identity = {workspace_id:data.workspace_id, actor_id:data.actor_id, enabled:Boolean(data.enabled)};
            return identity;
        }).catch(error => {
            initialization = null;
            if(error.status === 404) return null;
            throw error;
        });
        return initialization;
    }
    function forNode(node) {
        return [...records.values()].find(record =>
            record.operation_id === node?.generationOperationId
            && record.target_ids?.includes(node.id)
            && !['accepted','cancelled'].includes(record.status)
        ) || null;
    }
    function keyFor(record) {
        if(record.status === 'uncertain') return 'smart.localGenerationUncertain';
        if(record.status === 'failed') return errorKey(record.error);
        if(record.error?.startsWith('cloud_storage_')) return 'smart.localGenerationReconnecting';
        return record.status === 'submitting' ? 'smart.generationSubmitting' : 'smart.localGenerationWaiting';
    }
    async function poll(record) {
        if(activePolls.has(record.id)) return activePolls.get(record.id);
        const pending = (async () => {
            while(true) {
                remember(record);
                if(record.status === 'accepted') return record.result;
                if(['failed','uncertain','cancelled'].includes(record.status)) {
                    const error = new Error(text(keyFor(record)));
                    error.generationLocallyAccepted = true;
                    error.localSubmissionPending = record.status === 'uncertain';
                    throw error;
                }
                await sleep(750);
                try {
                    record = await request(`${api}/${encodeURIComponent(record.id)}`);
                } catch(error) {
                    if(error.status && error.status < 500) {
                        error.generationLocallyAccepted = true;
                        throw error;
                    }
                    // A failed status read says nothing about the queued command.
                    // Keep its identity and wait; do not create a second command.
                    await sleep(1500);
                }
            }
        })();
        activePolls.set(record.id, pending);
        try { return await pending; }
        finally { activePolls.delete(record.id); }
    }
    async function post(endpoint, payload, context) {
        const admission = context.localSubmission;
        const persistence = window.SmartCanvasModules.canvasPersistence;
        const command = {
            workspace_id:admission.identity.workspace_id,
            actor_id:admission.identity.actor_id,
            canvas_id:context.canvasId,
            operation_id:context.operationId,
            request_index:Number(payload.generation_request_index || 0),
            client_id:typeof smartClientId === 'string' ? smartClientId : '',
            endpoint, payload,
            checkpoints:persistence.sealGeneration(),
            target_ids:context.nodeIds?.length ? context.nodeIds : [context.nodeId],
        };
        let record;
        const body = JSON.stringify(command);
        while(!record) {
            try {
                record = await request(api, {
                    method:'POST', headers:{'Content-Type':'application/json'}, body
                });
            } catch(error) {
                if(error.status && (error.status < 500 || error.code)) throw error;
                // Only retry local admission, with exactly the same immutable
                // body. Its unique journal key returns the original receipt;
                // this never replays the Provider request. Do not acknowledge
                // acceptance to the composer until a durable receipt arrives.
                await sleep(1500);
            }
        }
        remember(record);
        admission.accepted.add(command.request_index);
        if(!admission.notified && admission.accepted.size >= admission.expected) {
            admission.notified = true;
            await admission.onLocalAccepted?.({
                node:typeof nodes !== 'undefined' ? nodes.find(node => node.id === context.nodeId) : null,
                submission:{state:'local-accepted'}
            });
        }
        return poll(record);
    }
    async function resume() {
        clearTimeout(refreshTimer);
        try {
            if(!await initialize() || !identity.enabled || typeof canvasId === 'undefined') return;
            const data = await request(`${api}?canvas_id=${encodeURIComponent(canvasId)}`);
            if(data.workspace_id !== identity.workspace_id || data.actor_id !== identity.actor_id) return;
            for(const record of data.submissions) remember(record);
            const returned = new Set(data.submissions.map(record => record.id));
            let removed = false;
            for(const [id] of records) {
                if(!returned.has(id) && !activePolls.has(id)) { records.delete(id); removed = true; }
            }
            if(removed && typeof render === 'function') render();
        } catch(_error) {
            // Existing task feedback stays visible while the service reconnects.
        } finally {
            if(identity?.enabled) refreshTimer = setTimeout(resume, 4000);
        }
    }
    async function recover(nodeId) {
        const node = typeof nodes !== 'undefined' ? nodes.find(item => item.id === nodeId) : null;
        const record = forNode(node);
        if(!record) return;
        try {
            remember(await request(`${api}/${encodeURIComponent(record.id)}/retry`, {method:'POST'}));
            await resume();
        } catch(error) {
            if(typeof toast === 'function') toast(error.message, {tone:'danger'});
        }
    }
    window.SmartCanvasModules = window.SmartCanvasModules || {};
    window.SmartCanvasModules.localGenerationSubmissions = Object.freeze({
        initialize, identity:() => identity && {...identity}, post, resume, forNode, keyFor, recover,
        async context({settings={}, onLocalAccepted}={}) {
            const current = await initialize();
            if(!current?.enabled || !onLocalAccepted) return null;
            return {identity:{...current}, onLocalAccepted, accepted:new Set(), notified:false,
                expected:settings.engine === 'modelscope' ? Math.max(1, Math.min(8, Math.trunc(Number(settings.count || 1)))) : 1};
        }
    });
})();
