/*
 * Smart Canvas Persistence Module
 *
 * Owns the confirmed Snapshot, Canvas Revision, attribute-level Mutation
 * projection, the dedicated realtime WebSocket, reconnect/resync, and the
 * boundary between shared Canvas data and local Viewport/Selection state.
 */
let canvasPersistenceSaveTimer = null;
let canvasPersistenceReconnectTimer = null;
let canvasPersistenceHeartbeatTimer = null;
let canvasPersistenceReadyTimer = null;
let canvasPersistenceStatusRevealTimer = null;
let canvasPersistenceSocket = null;
let canvasPersistenceStatusValue = 'idle';
let canvasPersistenceReconnectAttempt = 0;
let canvasPersistenceRevision = 0;
let canvasPersistenceConfirmedDocument = null;
let canvasPersistenceOpeningSourceDocument = null;
let canvasPersistenceOpeningBaselineDocument = null;
let canvasPersistenceInFlight = null;
let canvasPersistencePendingSave = false;
let canvasPersistenceOperationCounter = 0;
let canvasPersistenceLastPongAt = 0;
let canvasPersistenceLastOfflineToastAt = 0;
let canvasPersistenceIntentionalClose = false;
let canvasPersistenceConnectionIssueStartedAt = 0;
let canvasPersistenceLocalStorageWarned = false;
let canvasPersistencePlacementRetryPending = false;
let canvasPersistenceRestorePlacementRetry = null;
let canvasPersistenceTransientSession = false;
const canvasPersistenceMergeHolds = new Set();
const canvasPersistenceQueuedMessages = [];
const canvasPersistenceExternalCommits = new Map();
const CANVAS_PERSISTENCE_STATUS_DELAY_MS = 5000;
const CANVAS_PERSISTENCE_LOCAL_SCHEMA = 1;
const CANVAS_PERSISTENCE_LOCAL_KEY_PREFIX =
    'infiniteCanvasRealtimePending:v1:';

const canvasPersistenceFallbacks = Object.freeze({
    'smart.localStorageLow':'浏览器本地空间不足，待同步修改可能无法在刷新后恢复',
    'smart.title':'智能画布',
    'canvas.smartCanvas':'智能画布',
    'smart.syncPreparing':'正在准备实时协作…',
    'smart.syncConnecting':'正在连接实时协作…',
    'smart.syncReady':'实时协作已连接',
    'smart.syncReconnecting':'连接恢复中，画布修改将在恢复后自动同步…',
    'smart.syncError':'实时同步失败，点击重试',
    'smart.syncRecovered':'实时连接已恢复',
    'smart.syncUnavailableDiscarded':'实时同步不可用，已取消未保存的共享画布修改',
    'smart.noCollaborativeUndo':'没有可撤销的协作操作',
    'smart.syncBeforeUndo':'实时同步完成后才能撤销',
    'smart.collaborationSubmitFailed':'协作操作未能提交',
    'smart.sessionExpired':'登录状态已失效，请重新登录',
    'smart.editPermissionLost':'已失去该画布的编辑权限',
    'smart.realtimeUnsupported':'画布不存在或不支持实时编辑',
    'smart.realtimeFull':'该画布已达到当前配置的实时连接上限',
    'smart.toastCanvasFail':'智能画布加载失败',
    'smart.canvasStillSyncing':'画布仍在同步，请稍后重试保存提示词'
});
function canvasPersistenceText(key){
    const translated = typeof tr === 'function'
        ? tr(key)
        : window.StudioI18n?.t?.(key);
    return translated && translated !== key
        ? translated
        : (canvasPersistenceFallbacks[key] || key);
}

function canvasPersistenceGenerationRun(){
    const module = window.SmartCanvasModules?.generationRun;
    if(!module) throw new Error('Generation Run Module failed to load');
    return module;
}
function canvasPersistenceSmartMatting(){
    const module = window.SmartCanvasModules?.smartMatting;
    if(!module) throw new Error('Smart Matting Module failed to load');
    return module;
}
function canvasPersistenceMutation(){
    return window.SmartCanvasModules?.canvasMutation || null;
}
function canvasPersistenceClone(value){
    if(value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}
function canvasPersistencePlainObject(value){
    return Boolean(
        value
        && typeof value === 'object'
        && !Array.isArray(value)
    );
}
function canvasPersistenceEqual(left,right){
    if(left === right) return true;
    return JSON.stringify(left) === JSON.stringify(right);
}
function canvasPersistenceConnectionKey(connection={}){
    return [
        connection.from || '',
        connection.to || '',
        connection.kind || 'flow'
    ].join('\u001f');
}
function canvasPersistenceEmptyChanges(){
    return {
        node_creates:[],
        node_updates:[],
        node_unsets:[],
        node_deletes:[],
        connection_adds:[],
        connection_removes:[],
        canvas_updates:[],
        canvas_unsets:[]
    };
}
function canvasPersistenceChangesEmpty(changes={}){
    return Object.values(changes).every(items =>
        !Array.isArray(items) || items.length === 0
    );
}
function canvasPersistenceChangesOnlyNodePositions(changes={}){
    if(!canvasPersistencePlainObject(changes)) return false;
    const allowedKeys = new Set(Object.keys(canvasPersistenceEmptyChanges()));
    if(Object.keys(changes).some(key => !allowedKeys.has(key))) return false;
    const updates = Array.isArray(changes.node_updates)
        ? changes.node_updates
        : [];
    if(!updates.length || updates.length > 2) return false;
    const nodeId = String(updates[0]?.id || '');
    const fields = new Set();
    if(!nodeId) return false;
    for(const update of updates){
        const path = Array.isArray(update?.path) ? update.path : [];
        const field = path.length === 1 ? String(path[0] || '') : '';
        if(
            String(update?.id || '') !== nodeId
            || !['x','y'].includes(field)
            || fields.has(field)
            || typeof update?.value !== 'number'
            || !Number.isFinite(update.value)
        ){
            return false;
        }
        fields.add(field);
    }
    return Object.entries(changes).every(([key, items]) => (
        key === 'node_updates'
        || (Array.isArray(items) && items.length === 0)
    ));
}
function canvasPersistenceNodePositionPatch(changes={}){
    if(!canvasPersistenceChangesOnlyNodePositions(changes)) return null;
    const updates = changes.node_updates || [];
    const values = {};
    updates.forEach(update => {
        values[String(update.path[0])] = update.value;
    });
    return Object.freeze({
        nodeId:String(updates[0].id),
        values:Object.freeze(values)
    });
}
function canvasPersistenceLocalStorage(){
    try {
        return window.localStorage || (
            typeof localStorage !== 'undefined' ? localStorage : null
        );
    } catch(error){
        return null;
    }
}
function canvasPersistenceLocalKey(){
    return `${CANVAS_PERSISTENCE_LOCAL_KEY_PREFIX}${String(canvasId || '')}`;
}
function canvasPersistenceClearLocal(){
    const storage = canvasPersistenceLocalStorage();
    if(!storage || !canvasId) return false;
    try {
        storage.removeItem(canvasPersistenceLocalKey());
        return true;
    } catch(error){
        return false;
    }
}
function canvasPersistenceReadLocal(){
    const storage = canvasPersistenceLocalStorage();
    if(!storage || !canvasId) return null;
    try {
        const raw = storage.getItem(canvasPersistenceLocalKey());
        if(!raw) return null;
        const record = JSON.parse(raw);
        if(
            Number(record?.schema || 0) !== CANVAS_PERSISTENCE_LOCAL_SCHEMA
            || String(record?.canvas_id || '') !== String(canvasId)
            || !canvasPersistencePlainObject(record?.changes)
        ){
            storage.removeItem(canvasPersistenceLocalKey());
            return null;
        }
        return record;
    } catch(error){
        return null;
    }
}
function canvasPersistenceWriteLocal(changes={}){
    if(canvasPersistenceChangesEmpty(changes)){
        canvasPersistenceClearLocal();
        return true;
    }
    const storage = canvasPersistenceLocalStorage();
    if(!storage || !canvasId) return false;
    try {
        storage.setItem(canvasPersistenceLocalKey(),JSON.stringify({
            schema:CANVAS_PERSISTENCE_LOCAL_SCHEMA,
            canvas_id:String(canvasId),
            base_revision:canvasPersistenceRevision,
            saved_at:Date.now(),
            changes:canvasPersistenceClone(changes)
        }));
        return true;
    } catch(error){
        if(!canvasPersistenceLocalStorageWarned){
            canvasPersistenceLocalStorageWarned = true;
            toast(canvasPersistenceText('smart.localStorageLow'));
        }
        return false;
    }
}
function canvasPersistencePersistLocal(documentValue=null){
    const baseline = canvasPersistenceDiffBaseline();
    if(!baseline) return false;
    const current = documentValue
        ? canvasPersistenceCompactDocument(documentValue)
        : canvasPersistenceSharedDocument();
    const changes = canvasPersistenceDiff(
        baseline,
        current
    );
    canvasPersistenceWriteLocal(changes);
    return changes;
}
function canvasPersistenceRestoreLocal(documentValue={}){
    const record = canvasPersistenceReadLocal();
    if(!record || canvasPersistenceChangesEmpty(record.changes)){
        return canvasPersistenceCompactDocument(documentValue);
    }
    const confirmed = canvasPersistenceCompactDocument(documentValue);
    const restored = canvasPersistenceApplyChanges(
        confirmed,
        record.changes
    );
    const effectiveChanges = canvasPersistenceDiff(confirmed,restored);
    if(canvasPersistenceChangesEmpty(effectiveChanges)){
        canvasPersistenceClearLocal();
        return confirmed;
    }
    canvasPersistencePendingSave = true;
    canvasPersistenceWriteLocal(effectiveChanges);
    return restored;
}
function canvasPersistenceRestoreOpeningOutline(event={}){
    const record = canvasPersistenceReadLocal();
    if(
        event?.type !== 'canvas_outline'
        || !Array.isArray(event.nodes)
        || !record
        || canvasPersistenceChangesEmpty(record.changes)
    ){
        return event;
    }
    const restored = canvasPersistenceApplyChanges({
        title:'',
        icon:'sparkles',
        nodes:event.nodes,
        connections:[],
        settings:{}
    },record.changes);
    return {
        ...event,
        nodes:restored.nodes
    };
}
function canvasPersistencePrepareNodes(){
    nodes.forEach(node => {
        node.images = (node.images || []).map(image =>
            mediaItemForStorage(stripImageGenerationMeta(image))
        );
        if(node.runSettings){
            node.runSettings = settingsForStorage(node.runSettings);
        }
    });
    if(canvas) canvas.nodes = nodes;
}
function canvasPersistenceSharedDocument(){
    savePromptDraftForCurrent();
    canvasPersistencePrepareNodes();
    const sharedSettings = settingsForStorage(
        canvasDefaultSmartSettings || initialSmartSettings
    );
    sharedSettings.generationBatchLayout = (
        typeof smartGenerationBatchLayout !== 'undefined'
        && smartGenerationBatchLayout === 'vertical'
    ) ? 'vertical' : 'horizontal';
    if(canvas) canvas.settings = sharedSettings;
    const confirmedNodes = new Map(
        (canvasPersistenceDiffBaseline()?.nodes || []).map(node => [String(node?.id || ''), node])
    );
    const sharedNodes = nodes.map(node => {
        const shared = canvasPersistenceClone(node);
        if(shared.queuedGenerationRun){
            delete shared.queuedGenerationRun;
            const confirmed = confirmedNodes.get(String(node?.id || ''));
            if(Object.prototype.hasOwnProperty.call(confirmed || {}, 'queued')){
                shared.queued = Boolean(confirmed.queued);
            } else {
                delete shared.queued;
            }
        }
        return shared;
    });
    return canvasPersistenceCompactDocument({
        title:canvas?.title || canvasPersistenceText('smart.title'),
        icon:canvas?.icon || 'sparkles',
        nodes:sharedNodes,
        connections:canvas?.connections || [],
        settings:sharedSettings
    });
}
function canvasPersistenceCompactDocument(source={}){
    return canvasPersistenceClone({
        title:source.title || canvasPersistenceText('smart.title'),
        icon:source.icon || 'sparkles',
        nodes:Array.isArray(source.nodes) ? source.nodes : [],
        connections:Array.isArray(source.connections)
            ? source.connections
            : [],
        settings:canvasPersistencePlainObject(source.settings)
            ? source.settings
            : {}
    });
}
function canvasPersistenceDiffBaseline(){
    return canvasPersistenceOpeningBaselineDocument
        || canvasPersistenceConfirmedDocument;
}
function canvasPersistencePathGet(target,path=[]){
    let current = target;
    for(const part of path){
        if(!canvasPersistencePlainObject(current)
            || !Object.prototype.hasOwnProperty.call(current,part)){
            return {exists:false,value:undefined};
        }
        current = current[part];
    }
    return {exists:true,value:current};
}
function canvasPersistencePathSet(target,path=[],value){
    if(!path.length) return false;
    let current = target;
    path.slice(0,-1).forEach(part => {
        if(!canvasPersistencePlainObject(current[part])){
            current[part] = {};
        }
        current = current[part];
    });
    current[path[path.length - 1]] = canvasPersistenceClone(value);
    return true;
}
function canvasPersistencePathUnset(target,path=[]){
    if(!path.length) return false;
    let current = target;
    for(const part of path.slice(0,-1)){
        if(!canvasPersistencePlainObject(current)) return false;
        current = current[part];
    }
    if(!canvasPersistencePlainObject(current)) return false;
    delete current[path[path.length - 1]];
    return true;
}
function canvasPersistenceDiffObject(before,after,path,onSet,onUnset){
    const previous = canvasPersistencePlainObject(before) ? before : {};
    const next = canvasPersistencePlainObject(after) ? after : {};
    const keys = new Set([
        ...Object.keys(previous),
        ...Object.keys(next)
    ]);
    keys.forEach(key => {
        const nextPath = [...path,key];
        const had = Object.prototype.hasOwnProperty.call(previous,key);
        const has = Object.prototype.hasOwnProperty.call(next,key);
        if(!has){
            onUnset(nextPath);
            return;
        }
        if(!had){
            onSet(nextPath,next[key]);
            return;
        }
        if(
            canvasPersistencePlainObject(previous[key])
            && canvasPersistencePlainObject(next[key])
        ){
            canvasPersistenceDiffObject(
                previous[key],
                next[key],
                nextPath,
                onSet,
                onUnset
            );
            return;
        }
        if(!canvasPersistenceEqual(previous[key],next[key])){
            onSet(nextPath,next[key]);
        }
    });
}
function canvasPersistenceDiff(before={},after={}){
    const changes = canvasPersistenceEmptyChanges();
    const beforeNodes = new Map(
        (before.nodes || []).map(node => [String(node.id || ''),node])
    );
    const afterNodes = new Map(
        (after.nodes || []).map(node => [String(node.id || ''),node])
    );
    afterNodes.forEach((node,nodeId) => {
        if(!nodeId) return;
        const previous = beforeNodes.get(nodeId);
        if(!previous){
            changes.node_creates.push(canvasPersistenceClone(node));
            return;
        }
        canvasPersistenceDiffObject(
            previous,
            node,
            [],
            (path,value) => {
                if(path[0] === 'id') return;
                changes.node_updates.push({
                    id:nodeId,
                    path,
                    value:canvasPersistenceClone(value)
                });
            },
            path => {
                if(path[0] === 'id') return;
                changes.node_unsets.push({id:nodeId,path});
            }
        );
    });
    beforeNodes.forEach((_node,nodeId) => {
        if(nodeId && !afterNodes.has(nodeId)){
            changes.node_deletes.push(nodeId);
        }
    });
    const beforeConnections = new Map(
        (before.connections || []).map(connection => [
            canvasPersistenceConnectionKey(connection),
            connection
        ])
    );
    const afterConnections = new Map(
        (after.connections || []).map(connection => [
            canvasPersistenceConnectionKey(connection),
            connection
        ])
    );
    afterConnections.forEach((connection,key) => {
        const previous = beforeConnections.get(key);
        if(!previous || !canvasPersistenceEqual(previous,connection)){
            if(previous){
                changes.connection_removes.push(
                    canvasPersistenceClone(previous)
                );
            }
            changes.connection_adds.push(canvasPersistenceClone(connection));
        }
    });
    beforeConnections.forEach((connection,key) => {
        if(!afterConnections.has(key)){
            changes.connection_removes.push(canvasPersistenceClone(connection));
        }
    });
    const beforeCanvas = {
        title:before.title,
        icon:before.icon,
        settings:before.settings || {}
    };
    const afterCanvas = {
        title:after.title,
        icon:after.icon,
        settings:after.settings || {}
    };
    canvasPersistenceDiffObject(
        beforeCanvas,
        afterCanvas,
        [],
        (path,value) => changes.canvas_updates.push({
            path,
            value:canvasPersistenceClone(value)
        }),
        path => changes.canvas_unsets.push({path})
    );
    return changes;
}
function canvasPersistenceApplyChanges(documentValue,changes={}){
    const documentCopy = canvasPersistenceCompactDocument(documentValue);
    // A vanished endpoint invalidates the entire local operation, not just one wire.
    // This keeps optimistic rebase from leaving a newly created, partly wired target.
    const endpointIds = new Set(documentCopy.nodes.map(node => String(node.id || '')));
    (changes.node_creates || []).forEach(raw => endpointIds.add(String((raw?.node || raw)?.id || '')));
    (changes.node_deletes || []).forEach(raw => endpointIds.delete(String(raw?.id || raw || '')));
    if((changes.connection_adds || []).some(connection =>
        !endpointIds.has(String(connection.from || ''))
        || !endpointIds.has(String(connection.to || ''))
        || connection.from === connection.to
    )) return documentCopy;
    const nodeMap = new Map(
        documentCopy.nodes.map(node => [String(node.id || ''),node])
    );
    (changes.node_creates || []).forEach(raw => {
        const node = canvasPersistencePlainObject(raw?.node)
            ? raw.node
            : raw;
        const nodeId = String(node?.id || '');
        if(!nodeId || nodeMap.has(nodeId)) return;
        const copy = canvasPersistenceClone(node);
        documentCopy.nodes.push(copy);
        nodeMap.set(nodeId,copy);
    });
    (changes.node_updates || []).forEach(update => {
        const node = nodeMap.get(String(update?.id || ''));
        if(node) canvasPersistencePathSet(
            node,
            update.path || [],
            update.value
        );
    });
    (changes.node_unsets || []).forEach(update => {
        const node = nodeMap.get(String(update?.id || ''));
        if(node) canvasPersistencePathUnset(node,update.path || []);
    });
    const deletedIds = new Set(
        (changes.node_deletes || [])
            .map(value => String(
                canvasPersistencePlainObject(value) ? value.id || '' : value || ''
            ))
            .filter(Boolean)
    );
    if(deletedIds.size){
        documentCopy.nodes = documentCopy.nodes.filter(node =>
            !deletedIds.has(String(node.id || ''))
        );
        documentCopy.connections = documentCopy.connections.filter(connection =>
            !deletedIds.has(String(connection.from || ''))
            && !deletedIds.has(String(connection.to || ''))
        );
        documentCopy.nodes.forEach(node => {
            if(Array.isArray(node.inputNodeIds)){
                node.inputNodeIds = node.inputNodeIds.filter(
                    id => !deletedIds.has(String(id || ''))
                );
            }
            if(Array.isArray(node.items)){
                node.items = node.items.filter(
                    id => !deletedIds.has(String(id || ''))
                );
            }
            if(deletedIds.has(String(node.frameId || ''))){
                delete node.frameId;
            }
        });
    }
    const removedKeys = new Set(
        (changes.connection_removes || [])
            .map(canvasPersistenceConnectionKey)
    );
    if(removedKeys.size){
        documentCopy.connections = documentCopy.connections.filter(connection =>
            !removedKeys.has(canvasPersistenceConnectionKey(connection))
        );
    }
    const liveNodeIds = new Set(
        documentCopy.nodes.map(node => String(node.id || ''))
    );
    const connectionKeys = new Set(
        documentCopy.connections.map(canvasPersistenceConnectionKey)
    );
    (changes.connection_adds || []).forEach(connection => {
        const source = String(connection?.from || '');
        const target = String(connection?.to || '');
        const key = canvasPersistenceConnectionKey(connection);
        if(
            !source
            || !target
            || source === target
            || !liveNodeIds.has(source)
            || !liveNodeIds.has(target)
            || connectionKeys.has(key)
        ){
            return;
        }
        documentCopy.connections.push(canvasPersistenceClone(connection));
        connectionKeys.add(key);
    });
    (changes.canvas_updates || []).forEach(update =>
        canvasPersistencePathSet(
            documentCopy,
            update.path || [],
            update.value
        )
    );
    (changes.canvas_unsets || []).forEach(update =>
        canvasPersistencePathUnset(documentCopy,update.path || [])
    );
    return documentCopy;
}
function canvasPersistenceReplanCreatedNodes(changes,confirmedDocument){
    const placement = window.SmartCanvasModules?.nodePlacement;
    const geometry = window.SmartCanvasModules?.nodeGeometry;
    const mutation = canvasPersistenceMutation();
    const createdDrafts = (changes?.node_creates || []).map(raw =>
        canvasPersistencePlainObject(raw?.node) ? raw.node : raw
    ).filter(node => node?.id);
    const exactDrafts = createdDrafts.filter(node =>
        mutation?.placementMode?.({nodeId:node.id}) === 'exact'
    );
    const drafts = createdDrafts.filter(node =>
        mutation?.placementMode?.({nodeId:node.id}) !== 'exact'
    );
    if(!placement?.plan || !geometry?.createSession || !drafts.length) return changes;
    const createdIds = new Set(drafts.map(node => String(node.id)));
    const external = (changes.connection_adds || []).find(connection => {
        const fromCreated = createdIds.has(String(connection?.from || ''));
        const toCreated = createdIds.has(String(connection?.to || ''));
        return fromCreated !== toCreated;
    });
    let anchor = null;
    let relation = 'free';
    if(external){
        const fromCreated = createdIds.has(String(external.from || ''));
        anchor = {
            kind:'source',
            sourceNodeId:fromCreated ? external.to : external.from
        };
        if(!fromCreated && drafts.length === 1){
            const sourceIds = [...new Set((changes.connection_adds || [])
                .filter(connection=>String(connection.to)===String(drafts[0].id) && !createdIds.has(String(connection.from)))
                .map(connection=>String(connection.from)))];
            if(sourceIds.length > 1) anchor.sourceNodeIds = sourceIds;
        }
        relation = fromCreated ? 'upstream' : 'downstream';
    } else {
        const session = geometry.createSession({nodes:drafts,connections:[]});
        const footprints = drafts.map(node => session.measure(node.id).footprint);
        const left = Math.min(...footprints.map(rect => rect.x));
        const top = Math.min(...footprints.map(rect => rect.y));
        const right = Math.max(...footprints.map(rect => rect.x + rect.width));
        const bottom = Math.max(...footprints.map(rect => rect.y + rect.height));
        anchor = {kind:'point',x:(left + right) / 2,y:(top + bottom) / 2};
    }
    const batchIds = new Set(drafts.map(node => String(node.generationBatchId || '')).filter(Boolean));
    const batchLayouts = new Set(drafts
        .filter(node => node.generationBatchId)
        .map(node => node.generationBatchLayout === 'horizontal' ? 'horizontal' : 'vertical'));
    const arrangement = drafts.length === 1
        ? 'single'
        : batchIds.size === 1 && batchLayouts.size === 1
            ? `${[...batchLayouts][0]}-batch`
            : 'rigid';
    const snapshotNodes = [
        ...(confirmedDocument?.nodes || []),
        ...exactDrafts
    ];
    const ownedNodeIds = new Set();
    snapshotNodes.forEach(node => {
        if(node?.type !== 'smart-group') return;
        (node.items || []).forEach(id => ownedNodeIds.add(String(id)));
    });
    const plan = placement.plan({
        snapshot:{
            nodes:snapshotNodes.filter(node =>
                !ownedNodeIds.has(String(node?.id || ''))
            )
        },
        drafts,
        intent:{anchor,relation,arrangement}
    });
    if(!plan.ok) return changes;
    const byId = new Map(plan.placements.map(item => [String(item.id),item]));
    drafts.forEach(node => {
        const position = byId.get(String(node.id));
        if(!position) return;
        node.x = position.x;
        node.y = position.y;
    });
    return changes;
}
function canvasPersistencePlacementOverridesForRetry(changes,confirmedDocument){
    const replanned = canvasPersistenceReplanCreatedNodes(
        changes,
        confirmedDocument
    );
    const overrides = {};
    (replanned?.node_creates || []).forEach(raw => {
        const node = canvasPersistencePlainObject(raw?.node) ? raw.node : raw;
        const x = Number(node?.x);
        const y = Number(node?.y);
        if(!node?.id || !Number.isFinite(x) || !Number.isFinite(y)) return;
        overrides[String(node.id)] = {x,y};
    });
    return overrides;
}
function canvasPersistenceAssignDocument(
    documentValue,
    {renderNow=true,adoptDocument=false,renderOptions=null}={}
){
    const shared = adoptDocument
        ? documentValue
        : canvasPersistenceCompactDocument(documentValue);
    if(!canvas) canvas = {};
    canvas.title = shared.title;
    canvas.icon = shared.icon;
    const existingNodes = new Map(
        (nodes || []).map(node => [String(node.id || ''),node])
    );
    canvas.nodes = shared.nodes.map(sourceNode => {
        // `shared` is exclusively owned here: it was either cloned above or
        // explicitly transferred by the caller. Avoid cloning every node a
        // second time, which is especially costly for large realtime payloads.
        const normalized = normalizeLegacySmartNode(sourceNode);
        if(!normalized?.id) return null;
        const existing = existingNodes.get(String(normalized.id));
        if(!existing) return normalized;
        const queuedGenerationRun = existing.queuedGenerationRun;
        Object.keys(existing).forEach(key => {
            if(!Object.prototype.hasOwnProperty.call(normalized,key)){
                delete existing[key];
            }
        });
        Object.assign(existing,normalized);
        if(queuedGenerationRun){
            existing.queuedGenerationRun = queuedGenerationRun;
            existing.queued = true;
        }
        return existing;
    }).filter(Boolean);
    canvas.connections = shared.connections;
    canvas.settings = shared.settings;
    if(typeof smartGenerationBatchLayout !== 'undefined'){
        smartGenerationBatchLayout = shared.settings?.generationBatchLayout === 'vertical'
            ? 'vertical'
            : 'horizontal';
        if(typeof refreshSmartCanvasSettings === 'function') refreshSmartCanvasSettings();
    }
    // Generation History is independent of the shared Canvas document.
    // Realtime snapshots must never replace the page-local history cache.
    canvas.logs = Array.isArray(canvas.logs) ? canvas.logs : [];
    canvas.revision = canvasPersistenceRevision;
    nodes = canvas.nodes;
    if(
        typeof migrateLegacyLayerDecompositionGroups === 'function'
        && migrateLegacyLayerDecompositionGroups()
    ){
        canvasPersistencePendingSave = true;
    }
    const generationSettingsModule =
        window.SmartCanvasModules?.generationSettings;
    if(generationSettingsModule?.reconcileCanvasSync){
        settings = generationSettingsModule.reconcileCanvasSync({
            canvasSettings:shared.settings
        });
    } else {
        const sharedDefaultSettings = {
            ...initialSmartSettings,
            ...shared.settings
        };
        canvasDefaultSmartSettings =
            cloneSmartSettings(sharedDefaultSettings);
        const activeComposerNodeId =
            typeof lastComposerNodeId === 'string'
                ? String(lastComposerNodeId).split(':')[0]
                : '';
        const activeComposerNode = activeComposerNodeId
            ? nodes.find(
                node =>
                    String(node.id || '') === activeComposerNodeId
            )
            : null;
        settings =
            activeComposerNode
            && typeof smartSettingsForNode === 'function'
                ? smartSettingsForNode(activeComposerNode)
                : sharedDefaultSettings;
    }
    const title = document.getElementById('smartTitle');
    if(title) title.textContent = canvas.title;
    document.title = canvas.title || canvasPersistenceText('canvas.smartCanvas');
    if(renderNow){
        render(renderOptions || {});
        if(typeof scheduleConnectionLayerRefresh === 'function'){
            scheduleConnectionLayerRefresh();
        }
    }
    return shared;
}
function canvasPersistenceEditableElementActive(){
    const active = document.activeElement;
    if(typeof isEditableTarget === 'function' && isEditableTarget(active)){
        return true;
    }
    const nativeSelector = 'input,textarea,select,[contenteditable="true"]';
    return Boolean(
        active?.matches?.(nativeSelector)
        || active?.closest?.(nativeSelector)
    );
}
function canvasPersistenceLocalInteractionActive(){
    return Boolean(
        selectionState
        || canvasPersistenceMergeHolds.size
        || canvasPersistenceEditableElementActive()
    );
}
function canvasRealtimeApplierCanApplyDuringComposerFocus(patch){
    if(
        !patch
        || selectionState
        || canvasPersistenceMergeHolds.size
        || canvasPersistenceQueuedMessages.length
    ) return false;
    const active = document.activeElement;
    const composerElement = typeof composer !== 'undefined'
        ? composer
        : null;
    if(!active || !composerElement?.contains?.(active)) return false;
    const protectedNodeIds = new Set();
    const composerNodeId = typeof lastComposerNodeId === 'string'
        ? String(lastComposerNodeId).split(':')[0]
        : '';
    if(composerNodeId) protectedNodeIds.add(composerNodeId);
    if(typeof selectedId !== 'undefined' && selectedId){
        protectedNodeIds.add(String(selectedId));
    }
    if(typeof selectedIds !== 'undefined' && Array.isArray(selectedIds)){
        selectedIds.forEach(nodeId => protectedNodeIds.add(String(nodeId)));
    }
    return !protectedNodeIds.has(patch.nodeId);
}
function canvasPersistenceRemoteDeletesActiveNode(changes={}){
    const active = window.SmartCanvasModules?.canvasInteraction?.active?.();
    if(!active) return false;
    const activeIds = new Set(active.nodeIds || []);
    const deletedIds = (changes.node_deletes || []).map(value =>
        String(canvasPersistencePlainObject(value) ? value.id || '' : value || '')
    );
    return deletedIds.some(id => activeIds.has(id));
}
function canvasPersistenceHold(scope='canvas-interaction'){
    canvasPersistenceMergeHolds.add(scope || 'canvas-interaction');
    return canvasPersistenceMergeHolds.size;
}
function canvasPersistenceRelease(scope='canvas-interaction'){
    canvasPersistenceMergeHolds.delete(scope || 'canvas-interaction');
    if(!canvasPersistenceMergeHolds.size){
        canvasPersistenceFlushQueuedMessages();
    }
    return canvasPersistenceMergeHolds.size;
}
function canvasPersistenceStatusElement(){
    return document.getElementById('canvasSyncStatus');
}
function canvasPersistenceSetStatus(status,message=''){
    const previousStatus = canvasPersistenceStatusValue;
    canvasPersistenceStatusValue = status;
    const element = canvasPersistenceStatusElement();
    if(!element) return status;
    const wasVisible = !element.hidden;
    clearTimeout(canvasPersistenceReadyTimer);
    clearTimeout(canvasPersistenceStatusRevealTimer);
    element.className = `canvas-sync-status is-${status}`;
    element.textContent = message || ({
        idle:canvasPersistenceText('smart.syncPreparing'),
        connecting:canvasPersistenceText('smart.syncConnecting'),
        ready:canvasPersistenceText('smart.syncReady'),
        reconnecting:canvasPersistenceText('smart.syncReconnecting'),
        error:canvasPersistenceText('smart.syncError')
    }[status] || '');
    element.onclick = status === 'error'
        ? () => canvasPersistenceReconnectNow()
        : null;
    if(['connecting','reconnecting'].includes(status)){
        if(!['connecting','reconnecting'].includes(previousStatus)){
            canvasPersistenceConnectionIssueStartedAt = Date.now();
        }
        const elapsed = Math.max(
            0,
            Date.now() - canvasPersistenceConnectionIssueStartedAt
        );
        const remaining = Math.max(
            0,
            CANVAS_PERSISTENCE_STATUS_DELAY_MS - elapsed
        );
        if(remaining === 0){
            element.hidden = false;
        } else {
            element.hidden = true;
            const revealStatus = status;
            canvasPersistenceStatusRevealTimer = setTimeout(() => {
                if(
                    canvasPersistenceStatusValue === revealStatus
                    || ['connecting','reconnecting'].includes(
                        canvasPersistenceStatusValue
                    )
                ){
                    element.hidden = false;
                }
            },remaining);
        }
    } else if(status === 'ready'){
        const recoveredFromVisibleDisconnect = (
            wasVisible
            && ['connecting','reconnecting'].includes(previousStatus)
        );
        element.textContent = recoveredFromVisibleDisconnect
            ? canvasPersistenceText('smart.syncRecovered')
            : canvasPersistenceText('smart.syncReady');
        element.hidden = !recoveredFromVisibleDisconnect;
        canvasPersistenceReadyTimer = setTimeout(() => {
            if(canvasPersistenceStatusValue === 'ready'){
                element.hidden = true;
            }
        },900);
        canvasPersistenceConnectionIssueStartedAt = 0;
    } else if(status === 'error'){
        element.hidden = false;
        canvasPersistenceConnectionIssueStartedAt = 0;
    } else {
        element.hidden = true;
        canvasPersistenceConnectionIssueStartedAt = 0;
    }
    return status;
}
function canvasPersistenceSocketOpen(){
    const openValue = window.WebSocket?.OPEN ?? 1;
    return Boolean(
        canvasPersistenceSocket
        && canvasPersistenceSocket.readyState === openValue
    );
}
function canvasPersistenceSendPresence(message){
    if(!canvasPersistenceSocketOpen() || !message || typeof message !== 'object') return false;
    canvasPersistenceSocket.send(JSON.stringify(message));
    return true;
}
function canvasPersistenceOnline(){
    return Boolean(
        canvasPersistenceStatusValue === 'ready'
        && canvasPersistenceSocketOpen()
    );
}
function canvasPersistenceEditable(){
    return Boolean(
        canvasPersistenceConfirmedDocument
        && canvasPersistenceStatusValue !== 'error'
    );
}
function canvasPersistenceStartTransientSession({document=null}={}){
    if(!document || typeof document !== 'object') return false;
    canvasPersistenceTransientSession = true;
    canvasPersistenceRevision = Number(document.revision || 0);
    canvasPersistenceConfirmedDocument = canvasPersistenceCompactDocument(
        document
    );
    canvasPersistencePendingSave = false;
    canvasPersistenceSetStatus('ready');
    return true;
}
function canvasPersistenceOperationId(prefix='op'){
    canvasPersistenceOperationCounter += 1;
    return [
        smartClientId || 'smart-client',
        prefix,
        Date.now().toString(36),
        canvasPersistenceOperationCounter.toString(36)
    ].join(':');
}
function canvasPersistenceSendOperation(
    changes,
    {
        revertsOperationId='',
        operationId='',
        optimistic=true,
        placementOverrides=null
    }={}
){
    if(
        !canvasPersistenceOnline()
        || canvasPersistenceInFlight
    ){
        return false;
    }
    const nextOperationId = operationId
        || canvasPersistenceOperationId(
            revertsOperationId ? 'undo' : 'mutation'
        );
    const operation = {
        operation_id:nextOperationId,
        base_revision:canvasPersistenceRevision
    };
    if(revertsOperationId){
        operation.reverts_operation_id = revertsOperationId;
        if(
            canvasPersistencePlainObject(placementOverrides)
            && Object.keys(placementOverrides).length
        ){
            operation.placement_overrides = canvasPersistenceClone(
                placementOverrides
            );
        }
    } else {
        operation.changes = canvasPersistenceClone(changes);
    }
    canvasPersistenceInFlight = {
        operation,
        changes:canvasPersistenceClone(changes || canvasPersistenceEmptyChanges()),
        optimistic:Boolean(optimistic)
    };
    canvasPersistenceSocket.send(JSON.stringify({
        type:'canvas_mutation',
        canvas_id:canvasId,
        operation
    }));
    return nextOperationId;
}
function canvasPersistenceOptimisticDocument(documentValue){
    let optimistic = canvasPersistenceClone(documentValue);
    if(canvasPersistenceInFlight?.optimistic){
        optimistic = canvasPersistenceApplyChanges(
            optimistic,
            canvasPersistenceInFlight.changes
        );
    }
    return optimistic;
}
function canvasPersistencePendingAfterInFlight(currentDocument){
    if(!canvasPersistenceConfirmedDocument || !currentDocument){
        return canvasPersistenceEmptyChanges();
    }
    return canvasPersistenceDiff(
        canvasPersistenceOptimisticDocument(
            canvasPersistenceConfirmedDocument
        ),
        currentDocument
    );
}
function canvasPersistenceRebaseLocalChanges(
    confirmedDocument,
    pendingChanges,
    {includeInFlight=true}={}
){
    let rebased = canvasPersistenceClone(confirmedDocument);
    if(includeInFlight && canvasPersistenceInFlight?.optimistic){
        rebased = canvasPersistenceApplyChanges(
            rebased,
            canvasPersistenceInFlight.changes
        );
    }
    if(!canvasPersistenceChangesEmpty(pendingChanges)){
        rebased = canvasPersistenceApplyChanges(
            rebased,
            pendingChanges
        );
    }
    return rebased;
}
function canvasPersistenceSchedule(delay=450){
    if(canvasPersistenceTransientSession) return true;
    if(
        canvasPersistenceStatusValue === 'error'
        && canvasPersistenceConfirmedDocument
    ){
        let restored = canvasPersistenceClone(
            canvasPersistenceConfirmedDocument
        );
        if(canvasPersistenceInFlight?.optimistic){
            restored = canvasPersistenceApplyChanges(
                restored,
                canvasPersistenceInFlight.changes
            );
        }
        canvasPersistenceAssignDocument(restored);
        if(Date.now() - canvasPersistenceLastOfflineToastAt > 1600){
            canvasPersistenceLastOfflineToastAt = Date.now();
            toast(canvasPersistenceText('smart.syncUnavailableDiscarded'));
        }
        return false;
    }
    canvasPersistencePendingSave = true;
    clearTimeout(canvasPersistenceSaveTimer);
    canvasPersistenceSaveTimer = setTimeout(
        () => canvasPersistenceSave(),
        Math.max(0,Number(delay) || 0)
    );
    return delay;
}
async function canvasPersistenceSave(){
    if(canvasPersistenceTransientSession) return true;
    if(!canvasId || !canvas) return false;
    const baseline = canvasPersistenceDiffBaseline();
    if(!baseline){
        return false;
    }
    const current = canvasPersistenceSharedDocument();
    const changes = canvasPersistenceDiff(
        baseline,
        current
    );
    if(canvasPersistenceChangesEmpty(changes)){
        canvasPersistencePendingSave = false;
        canvasPersistenceClearLocal();
        return true;
    }
    canvasPersistencePendingSave = true;
    canvasPersistenceWriteLocal(changes);
    if(!canvasPersistenceOnline() || canvasPersistenceInFlight){
        return false;
    }
    const operationId = canvasPersistenceSendOperation(changes);
    if(operationId){
        canvasPersistencePendingSave = false;
        return true;
    }
    return false;
}
function canvasPersistenceSynced(timeout=5000){
    if(canvasPersistenceTransientSession) return Promise.resolve(true);
    const deadline = Date.now() + Math.max(250,Number(timeout) || 5000);
    return new Promise(resolve => {
        const check = () => {
            if(
                canvasPersistenceOnline()
                && !canvasPersistencePendingSave
                && !canvasPersistenceInFlight
            ){
                resolve(true);
                return;
            }
            if(Date.now() >= deadline){
                resolve(false);
                return;
            }
            setTimeout(check,25);
        };
        check();
    });
}
function canvasPersistenceRevert(operationId){
    const target = String(operationId || '');
    if(!target){
        return Promise.resolve({
            ok:false,
            message:canvasPersistenceText('smart.noCollaborativeUndo')
        });
    }
    if(
        !canvasPersistenceOnline()
        || canvasPersistenceInFlight
    ){
        return Promise.resolve({
            ok:false,
            message:canvasPersistenceText('smart.syncBeforeUndo')
        });
    }
    const sent = canvasPersistenceSendOperation(
        canvasPersistenceEmptyChanges(),
        {
            revertsOperationId:target,
            optimistic:false
        }
    );
    return Promise.resolve({
        ok:Boolean(sent),
        operationId:sent || '',
        message:sent ? '' : canvasPersistenceText('smart.syncBeforeUndo')
    });
}
function canvasPersistenceRecordAccepted(message){
    if(
        message.undoable === false
        && !message.reverts_operation_id
    ) return false;
    const mutation = canvasPersistenceMutation();
    mutation?.history?.({
        action:'accepted',
        operationId:message.operation_id,
        revertsOperationId:message.reverts_operation_id || ''
    });
    return true;
}
function canvasPersistenceConfirmedAckChanges(message,changes,ownInFlight){
    if(!ownInFlight) return changes;
    const roots = new Set(
        Array.isArray(message.non_undoable_canvas_roots)
            ? message.non_undoable_canvas_roots.map(String)
            : []
    );
    if(!roots.size) return changes;
    const confirmed = canvasPersistenceClone(changes);
    ['canvas_updates','canvas_unsets'].forEach(action => {
        (canvasPersistenceInFlight?.changes?.[action] || []).forEach(entry => {
            if(roots.has(String(entry?.path?.[0] || ''))){
                confirmed[action].push(canvasPersistenceClone(entry));
            }
        });
    });
    return confirmed;
}
function canvasPersistenceReconcileTerminalGenerationState(authoritativeDocument){
    if(
        typeof smartNodeHasDisplayResult !== 'function'
        || typeof markSmartNodeComplete !== 'function'
    ) return false;
    const authoritativeNodes = new Map(
        (authoritativeDocument?.nodes || []).map(node => [String(node?.id || ''), node])
    );
    let changed = false;
    nodes.forEach(node => {
        const authoritative = authoritativeNodes.get(String(node?.id || ''));
        if(!authoritative || node.queuedGenerationRun) return;
        const operationId = String(node.generationOperationId || '');
        if(
            !operationId
            || operationId !== String(authoritative.generationOperationId || '')
            || !smartNodeHasDisplayResult(authoritative)
            || Number(authoritative.pending || 0) > 0
            || authoritative.running
            || authoritative.queued
            || authoritative.jimengPending
        ) return;
        const hasStaleClientState = Boolean(
            Number(node.pending || 0) > 0
            || node.running
            || node.queued
            || node.jimengPending
            || node.pendingTasks?.length
            || node.generationRunFeedback
            || node.runTimerHidden !== true
        );
        if(!hasStaleClientState) return;
        markSmartNodeComplete(node, {hideTimer:true});
        delete node.generationRunFeedback;
        changed = true;
    });
    if(changed) canvasPersistencePendingSave = true;
    return changed;
}
function canvasRealtimeApplierPatchPositionView(node){
    const nodeId = String(node?.id || '');
    if(!nodeId) return false;
    const virtualization = window.SmartCanvasModules?.canvasVirtualization;
    const virtualizationState = virtualization?.reconcile?.({
        fullSync:false,
        nodeIds:[nodeId]
    });
    if(virtualizationState?.changed){
        render({
            syncVirtualization:false,
            skipDynamicParamsRefresh:true,
            preserveMountedNodes:true
        });
        return true;
    }
    const element = typeof world !== 'undefined'
        ? world?.querySelector?.(
            `.image-node[data-id="${CSS.escape(nodeId)}"]`
        )
        : null;
    if(element){
        element.style.left = `${Number(node.x) || 0}px`;
        element.style.top = `${Number(node.y) || 0}px`;
    }
    if(typeof scheduleConnectionLayerRefresh === 'function'){
        scheduleConnectionLayerRefresh();
    }
    if(typeof positionCanvasFloatingOverlays === 'function'){
        positionCanvasFloatingOverlays();
    }
    return true;
}
function canvasRealtimeApplierApplyPosition({
    incomingRevision,
    ownInFlight,
    patch
}={}){
    if(
        !patch
        || ownInFlight
        || canvasPersistenceInFlight
        || canvasPersistencePendingSave
        || !canvasPersistenceConfirmedDocument
    ) return false;
    const confirmedNode = (canvasPersistenceConfirmedDocument.nodes || [])
        .find(node => String(node?.id || '') === patch.nodeId);
    const liveNode = (nodes || [])
        .find(node => String(node?.id || '') === patch.nodeId);
    if(!confirmedNode || !liveNode) return false;
    Object.entries(patch.values).forEach(([field,value]) => {
        confirmedNode[field] = value;
        liveNode[field] = value;
    });
    canvasPersistenceRevision = incomingRevision;
    if(canvas) canvas.revision = incomingRevision;
    canvasRealtimeApplierPatchPositionView(liveNode);
    return true;
}
function canvasRealtimeApplierApply(message){
    const incomingRevision = Number(message.revision || 0);
    const operationId = String(message.operation_id || '');
    const ownInFlight = Boolean(
        canvasPersistenceInFlight
        && canvasPersistenceInFlight.operation.operation_id === operationId
    );
    if(
        !ownInFlight
        && operationId
        && canvasPersistenceExternalCommits.get(operationId) === incomingRevision
        && (
            incomingRevision <= canvasPersistenceRevision
            || canvasPersistenceQueuedMessages.some(
                queued =>
                    String(queued?.operation_id || '') === operationId
                    && Number(queued?.revision || 0) === incomingRevision
            )
        )
    ) return true;
    if(message.duplicate && incomingRevision <= canvasPersistenceRevision){
        if(ownInFlight){
            const acknowledged = canvasPersistenceInFlight;
            canvasPersistenceInFlight = null;
            canvasPersistenceRecordAccepted(message);
            if(
                !acknowledged.optimistic
                && incomingRevision === canvasPersistenceRevision
            ){
                canvasPersistenceAssignDocument(
                    canvasPersistenceConfirmedDocument
                );
            }
            canvasPersistenceSave();
        }
        return true;
    }
    const changes = message.changes || canvasPersistenceEmptyChanges();
    const positionPatch = canvasPersistenceNodePositionPatch(changes);
    const positionOnly = Boolean(positionPatch);
    if(
        canvasPersistenceLocalInteractionActive()
        && !canvasPersistenceRemoteDeletesActiveNode(changes)
    ){
        const expectedQueuedRevision =
            canvasPersistenceRevision
            + canvasPersistenceQueuedMessages.length
            + 1;
        if(incomingRevision !== expectedQueuedRevision){
            canvasPersistenceRequestResync('queued-revision-gap');
            return false;
        }
        if(
            canvasRealtimeApplierCanApplyDuringComposerFocus(positionPatch)
            && canvasRealtimeApplierApplyPosition({
                incomingRevision,
                ownInFlight,
                patch:positionPatch
            })
        ){
            canvasPersistenceRememberExternalCommit(operationId,incomingRevision);
            return true;
        }
        canvasPersistenceQueuedMessages.push(message);
        return true;
    }
    if(
        !ownInFlight
        && canvasPersistenceRemoteDeletesActiveNode(changes)
    ){
        window.SmartCanvasModules?.canvasInteraction?.cancel?.({
            reason:'remote-delete'
        });
    }
    if(incomingRevision !== canvasPersistenceRevision + 1){
        canvasPersistenceRequestResync('revision-gap');
        return false;
    }
    if(canvasRealtimeApplierApplyPosition({
        incomingRevision,
        ownInFlight,
        patch:positionPatch
    })){
        canvasPersistenceRememberExternalCommit(operationId,incomingRevision);
        return true;
    }
    const currentBefore = canvasPersistenceSharedDocument();
    const pending = canvasPersistencePendingAfterInFlight(currentBefore);
    const confirmedChanges = canvasPersistenceConfirmedAckChanges(
        message,
        changes,
        ownInFlight
    );
    canvasPersistenceConfirmedDocument = canvasPersistenceApplyChanges(
        canvasPersistenceConfirmedDocument,
        confirmedChanges
    );
    canvasPersistenceRevision = incomingRevision;
    const rebased = canvasPersistenceRebaseLocalChanges(
        canvasPersistenceConfirmedDocument,
        pending,
        {includeInFlight:!ownInFlight}
    );
    canvasPersistenceAssignDocument(rebased,{
        renderOptions:positionOnly
            ? {skipDynamicParamsRefresh:true}
            : null
    });
    canvasPersistenceReconcileTerminalGenerationState(
        canvasPersistenceConfirmedDocument
    );
    if(ownInFlight){
        canvasPersistenceInFlight = null;
        canvasPersistenceRecordAccepted(message);
    }
    canvasPersistenceRememberExternalCommit(operationId,incomingRevision);
    if(canvasPersistencePendingSave || ownInFlight){
        canvasPersistenceSave();
    }
    return true;
}
function canvasPersistenceRememberExternalCommit(operationId,revision){
    const key = String(operationId || '');
    if(!key) return false;
    canvasPersistenceExternalCommits.set(key,Math.max(0,Number(revision) || 0));
    while(canvasPersistenceExternalCommits.size > 200){
        canvasPersistenceExternalCommits.delete(
            canvasPersistenceExternalCommits.keys().next().value
        );
    }
    return true;
}
function canvasPersistenceObserveExternalCommit({operationId='',revision=0}={}){
    const incomingRevision = Math.max(0,Number(revision) || 0);
    if(!operationId || !incomingRevision) return false;
    if(incomingRevision <= canvasPersistenceRevision){
        canvasPersistenceRememberExternalCommit(operationId,incomingRevision);
        return true;
    }
    const applied = canvasRealtimeApplierApply({
        type:'canvas_mutation',
        canvas_id:canvasId,
        operation_id:String(operationId),
        revision:incomingRevision,
        changes:canvasPersistenceEmptyChanges(),
        duplicate:false,
        reverts_operation_id:'',
        undoable:false,
        non_undoable_canvas_roots:['prompt_templates']
    });
    if(applied){
        canvasPersistenceRememberExternalCommit(operationId,incomingRevision);
    }
    return applied;
}
function canvasPersistenceApplyMutationMessage(message){
    return canvasRealtimeApplierApply(message);
}
const canvasRealtimeApplier = Object.freeze({
    apply(message={}){
        return canvasRealtimeApplierApply(message);
    }
});
function canvasPersistenceFlushQueuedMessages(){
    if(canvasPersistenceLocalInteractionActive()) return false;
    while(canvasPersistenceQueuedMessages.length){
        const message = canvasPersistenceQueuedMessages.shift();
        if(!canvasRealtimeApplier.apply(message)) return false;
    }
    return true;
}
function canvasPersistenceObservedRevision(){
    if(!canvasPersistenceQueuedMessages.length){
        return canvasPersistenceRevision;
    }
    return Number(
        canvasPersistenceQueuedMessages[
            canvasPersistenceQueuedMessages.length - 1
        ]?.revision
        ?? canvasPersistenceRevision
    );
}
function canvasPersistenceApplySnapshot(message){
    const openingSource = canvasPersistenceOpeningSourceDocument;
    const openingBaseline = canvasPersistenceOpeningBaselineDocument;
    const openingSnapshot = Boolean(openingSource && openingBaseline);
    const currentBefore = canvas && canvasPersistenceConfirmedDocument
        ? canvasPersistenceSharedDocument()
        : null;
    let pending = openingSnapshot && currentBefore
        ? canvasPersistenceDiff(openingBaseline,currentBefore)
        : currentBefore && canvasPersistenceConfirmedDocument
            ? canvasPersistencePendingAfterInFlight(currentBefore)
            : canvasPersistenceEmptyChanges();
    if(!currentBefore && !openingSnapshot){
        const localRecord = canvasPersistenceReadLocal();
        if(localRecord){
            pending = canvasPersistenceClone(localRecord.changes);
        }
    }
    canvasPersistenceRevision = Number(
        message.revision
        ?? message.canvas?.revision
        ?? 0
    );
    const snapshotDocument = canvasPersistenceCompactDocument(
        message.canvas || {}
    );
    canvasPersistenceConfirmedDocument = openingSnapshot
        ? canvasPersistenceApplyChanges(
            openingBaseline,
            canvasPersistenceDiff(openingSource,snapshotDocument)
        )
        : snapshotDocument;
    let restorePlacementRetry = null;
    if(canvasPersistencePlacementRetryPending){
        pending = canvasPersistenceReplanCreatedNodes(
            pending,
            canvasPersistenceConfirmedDocument
        );
        canvasPersistencePlacementRetryPending = false;
    }
    if(canvasPersistenceRestorePlacementRetry){
        const retry = canvasPersistenceRestorePlacementRetry;
        const retryChanges = canvasPersistenceClone(retry.changes);
        const placementOverrides = canvasPersistencePlacementOverridesForRetry(
            retryChanges,
            canvasPersistenceConfirmedDocument
        );
        if(Object.keys(placementOverrides).length){
            restorePlacementRetry = {
                revertsOperationId:retry.revertsOperationId,
                placementOverrides
            };
        } else {
            canvasPersistenceMutation()?.history?.({action:'rejected'});
        }
        canvasPersistenceRestorePlacementRetry = null;
    }
    const rebased = canvasPersistenceRebaseLocalChanges(
        canvasPersistenceConfirmedDocument,
        pending
    );
    const hasOptimisticChanges = Boolean(
        canvasPersistenceInFlight?.optimistic
        || !canvasPersistenceChangesEmpty(pending)
    );
    const effectivePending = hasOptimisticChanges
        ? canvasPersistenceDiff(
            canvasPersistenceConfirmedDocument,
            rebased
        )
        : canvasPersistenceEmptyChanges();
    canvasPersistencePendingSave = openingSnapshot
        ? !canvasPersistenceChangesEmpty(effectivePending)
        : (
            canvasPersistencePendingSave
            || !canvasPersistenceChangesEmpty(effectivePending)
        );
    canvasPersistenceOpeningSourceDocument = null;
    canvasPersistenceOpeningBaselineDocument = null;
    canvasPersistenceWriteLocal(effectivePending);
    canvasPersistenceAssignDocument(rebased,{adoptDocument:true});
    canvasPersistenceReconcileTerminalGenerationState(
        canvasPersistenceConfirmedDocument
    );
    canvasPersistenceReconnectAttempt = 0;
    canvasPersistenceSetStatus('ready');
    canvasPersistenceGenerationRun().resume();
    canvasPersistenceSmartMatting().resume();
    if(restorePlacementRetry){
        canvasPersistenceSendOperation(
            canvasPersistenceEmptyChanges(),
            {
                revertsOperationId:restorePlacementRetry.revertsOperationId,
                placementOverrides:restorePlacementRetry.placementOverrides,
                optimistic:false
            }
        );
    } else if(canvasPersistenceInFlight){
        canvasPersistenceSocket.send(JSON.stringify({
            type:'canvas_mutation',
            canvas_id:canvasId,
            operation:canvasPersistenceInFlight.operation
        }));
    } else if(
        canvasPersistencePendingSave
        || !canvasPersistenceChangesEmpty(pending)
    ){
        canvasPersistenceSave();
    }
    return true;
}
function canvasPersistenceHandleRejected(message){
    const operationId = String(message.operation_id || '');
    const rejectedInFlight = (
        canvasPersistenceInFlight
        && canvasPersistenceInFlight.operation.operation_id === operationId
    ) ? canvasPersistenceInFlight : null;
    const followingChanges = rejectedInFlight?.optimistic && canvasPersistenceConfirmedDocument
        ? canvasPersistencePendingAfterInFlight(canvasPersistenceSharedDocument())
        : null;
    if(rejectedInFlight){
        canvasPersistenceInFlight = null;
        if(followingChanges && message.code !== 'placement_conflict'){
            const restored = canvasPersistenceApplyChanges(canvasPersistenceConfirmedDocument,followingChanges);
            canvasPersistencePendingSave = !canvasPersistenceChangesEmpty(followingChanges);
            canvasPersistenceWriteLocal(followingChanges);
            canvasPersistenceAssignDocument(restored);
        }
    }
    const revertsOperationId = String(
        rejectedInFlight?.operation?.reverts_operation_id || ''
    );
    const retryChanges = message.retry_changes;
    const retryingRestore = Boolean(
        message.code === 'placement_conflict'
        && revertsOperationId
        && Array.isArray(retryChanges?.node_creates)
        && retryChanges.node_creates.length
    );
    if(retryingRestore){
        canvasPersistenceRestorePlacementRetry = {
            revertsOperationId,
            changes:canvasPersistenceClone(retryChanges)
        };
    } else if(message.code === 'placement_conflict'){
        canvasPersistencePlacementRetryPending = true;
    }
    if(!retryingRestore){
        canvasPersistenceMutation()?.history?.({action:'rejected'});
    }
    const localizedGroupError = {
        invalid_group_owner:'smart.groupOwnerConflict',
        invalid_group_order:'smart.groupOrderInvalid'
    }[message.code];
    toast(
        localizedGroupError
            ? canvasPersistenceText(localizedGroupError)
            : message.message
                || canvasPersistenceText('smart.collaborationSubmitFailed')
    );
    canvasPersistenceRequestResync(message.code || 'mutation-rejected');
    return false;
}
function canvasPersistenceHandleSocketMessage(event){
    let message = null;
    try {
        message = JSON.parse(event.data);
    } catch(error){
        canvasPersistenceRequestResync('invalid-message');
        return;
    }
    if(message.type === 'canvas_snapshot'){
        canvasPersistenceApplySnapshot(message);
    } else if(message.type === 'canvas_mutation'){
        canvasRealtimeApplier.apply(message);
    } else if(message.type === 'mutation_rejected'){
        canvasPersistenceHandleRejected(message);
    } else if(message.type === 'pong'){
        canvasPersistenceLastPongAt = Date.now();
        if(
            Number(message.revision || 0)
            !== canvasPersistenceObservedRevision()
        ){
            canvasPersistenceRequestResync('heartbeat-revision');
        }
    } else if(String(message.type || '').startsWith('presence_')){
        window.SmartCanvasModules?.realtimePresence?.receive?.(message);
    }
}
function canvasPersistenceStartHeartbeat(){
    clearInterval(canvasPersistenceHeartbeatTimer);
    canvasPersistenceLastPongAt = Date.now();
    canvasPersistenceHeartbeatTimer = setInterval(() => {
        if(!canvasPersistenceSocketOpen()) return;
        if(Date.now() - canvasPersistenceLastPongAt > 35000){
            canvasPersistenceRequestResync('heartbeat-timeout');
            return;
        }
        canvasPersistenceSocket.send(JSON.stringify({
            type:'ping',
            canvas_id:canvasId,
            revision:canvasPersistenceObservedRevision()
        }));
    },15000);
}
function canvasPersistenceConnect(){
    if(!canvasId || !window.WebSocket) return false;
    if(
        canvasPersistenceSocket
        && [window.WebSocket.OPEN,window.WebSocket.CONNECTING]
            .includes(canvasPersistenceSocket.readyState)
    ){
        return true;
    }
    clearTimeout(canvasPersistenceReconnectTimer);
    canvasPersistenceIntentionalClose = false;
    canvasPersistenceSetStatus(
        canvasPersistenceReconnectAttempt ? 'reconnecting' : 'connecting'
    );
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new window.WebSocket(
        `${protocol}://${location.host}/ws/canvases/`
        + `${encodeURIComponent(canvasId)}?client_id=`
        + encodeURIComponent(smartClientId)
    );
    canvasPersistenceSocket = socket;
    socket.onopen = () => {
        canvasPersistenceLastPongAt = Date.now();
        canvasPersistenceStartHeartbeat();
    };
    socket.onmessage = canvasPersistenceHandleSocketMessage;
    socket.onclose = event => {
        if(canvasPersistenceSocket === socket){
            canvasPersistenceSocket = null;
        }
        clearInterval(canvasPersistenceHeartbeatTimer);
        window.SmartCanvasModules?.realtimePresence?.disconnect?.();
        if(canvasPersistenceIntentionalClose) return;
        const fatalMessage = ({
            4401:canvasPersistenceText('smart.sessionExpired'),
            4403:canvasPersistenceText('smart.editPermissionLost'),
            4404:canvasPersistenceText('smart.realtimeUnsupported'),
            4429:canvasPersistenceText('smart.realtimeFull')
        })[Number(event?.code || 0)];
        if(fatalMessage){
            canvasPersistenceSetStatus('error',fatalMessage);
            return;
        }
        canvasPersistenceSetStatus('reconnecting');
        canvasPersistenceReconnectAttempt += 1;
        const delay = Math.min(
            3000,
            350 * (2 ** Math.min(canvasPersistenceReconnectAttempt,4))
        );
        canvasPersistenceReconnectTimer = setTimeout(
            canvasPersistenceConnect,
            delay
        );
    };
    socket.onerror = () => {
        if(socket.readyState < window.WebSocket.CLOSING){
            socket.close();
        }
    };
    return true;
}
function canvasPersistenceRequestResync(_reason=''){
    if(canvasPersistenceSocket){
        canvasPersistenceSocket.close(4000,'resync');
    } else {
        canvasPersistenceConnect();
    }
    return true;
}
async function canvasPersistenceResyncNow(){
    if(!canvasId) return false;
    const response = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}`);
    if(!response.ok) return false;
    const data = await response.json().catch(() => ({}));
    if(!data.canvas) return false;
    canvasPersistenceApplySnapshot({
        type:'canvas_snapshot',
        canvas_id:canvasId,
        revision:Number(data.canvas.revision || 0),
        canvas:data.canvas,
    });
    return true;
}
async function canvasPersistenceCheckpoint({timeout=5000}={}){
    await canvasPersistenceSave();
    const synced = await canvasPersistenceSynced(timeout);
    if(!synced){
        const error = new Error(canvasPersistenceText('smart.canvasStillSyncing'));
        error.code = 'canvas_checkpoint_timeout';
        throw error;
    }
    return Object.freeze({
        revision:canvasPersistenceRevision,
        state:canvasPersistenceStatusValue,
    });
}
function canvasPersistenceReconnectNow(){
    clearTimeout(canvasPersistenceReconnectTimer);
    canvasPersistenceReconnectAttempt = 0;
    if(canvasPersistenceSocket){
        canvasPersistenceSocket.close(4000,'manual-retry');
    } else {
        canvasPersistenceConnect();
    }
    return true;
}
async function canvasPersistenceLoad(){
    if(!canvasId) return null;
    const opening = window.SmartCanvasModules?.canvasOpening || null;
    const viewportModule =
        window.SmartCanvasModules.viewportSelection.viewport;
    const viewportRestore = Promise.resolve().then(() => (
        typeof viewportModule.restore === 'function'
            ? viewportModule.restore()
            : viewportModule.apply()
    )).catch(() => viewportModule.apply());
    try {
        canvasPersistenceOpeningSourceDocument = null;
        canvasPersistenceOpeningBaselineDocument = null;
        if(opening?.open){
            canvas = await opening.open({
                canvasId,
                outlineReady:viewportRestore,
                outlineTransform:canvasPersistenceRestoreOpeningOutline
            });
        } else {
            const response = await fetch(
                `/api/canvases/${encodeURIComponent(canvasId)}`
            );
            if(!response.ok) throw new Error('Canvas request failed');
            const data = await response.json();
            canvas = data.canvas;
        }
        if(!canvas || typeof canvas !== 'object'){
            throw new Error('Canvas document is missing');
        }
        opening?.hydrating?.();
        canvasPersistenceRevision = Number(canvas.revision || 0);
        rememberCanvasListProject(canvas.project || 'default');
        canvasUsesConnections = Object.prototype.hasOwnProperty.call(
            canvas || {},
            'connections'
        );
        canvasPersistenceConfirmedDocument = canvasPersistenceCompactDocument(
            canvas
        );
        canvasPersistenceOpeningSourceDocument = canvasPersistenceClone(
            canvasPersistenceConfirmedDocument
        );
        Object.assign(
            canvas,
            canvasPersistenceRestoreLocal(
                canvasPersistenceConfirmedDocument
            )
        );
        const openingLocalRecord = canvasPersistenceReadLocal();
        const openingLocalChanges = openingLocalRecord
            ? canvasPersistenceClone(openingLocalRecord.changes)
            : canvasPersistenceEmptyChanges();
        document.title = canvas.title || canvasPersistenceText('canvas.smartCanvas');
        const title = document.getElementById('smartTitle');
        if(title) title.textContent = canvas.title || canvasPersistenceText('canvas.smartCanvas');
        nodes = (
            Array.isArray(canvas.nodes) ? canvas.nodes : []
        ).map(normalizeLegacySmartNode).filter(Boolean);
        canvas.nodes = nodes;
        canvas.connections = Array.isArray(canvas.connections)
            ? canvas.connections
            : [];
        if(canvas.settings) settings = {...settings,...canvas.settings};
        smartGenerationBatchLayout = canvas.settings?.generationBatchLayout === 'vertical'
            ? 'vertical'
            : 'horizontal';
        const migratedGenerationOutputs = Boolean(
            window.SmartCanvasModules?.generationOutput?.migrateLegacyGroups?.()
        );
        const migratedGenerationOutputGalleries = Boolean(
            window.SmartCanvasModules?.generationOutput?.migrateLegacyGalleries?.()
        );
        const migratedLayerDecompositionGroups =
            typeof migrateLegacyLayerDecompositionGroups === 'function'
            && migrateLegacyLayerDecompositionGroups();
        const migratedPromptSplits =
            typeof migrateLegacyPromptSplitNodes === 'function'
            && migrateLegacyPromptSplitNodes();
        const generationRunModule = canvasPersistenceGenerationRun();
        const smartMattingModule = canvasPersistenceSmartMatting();
        if(typeof generationRunModule.restoreActive === 'function'){
            await generationRunModule.restoreActive();
        }
        nodes.forEach(node => {
            const pendingTasks = typeof generationRunModule.pendingTasks === 'function'
                ? generationRunModule.pendingTasks({node})
                : generationRunModule.status({node}).pendingTasks;
            if(smartMattingModule.isActive({job:node.mattingJob})){
                node.pending = 1;
                node.running = node.mattingJob.status === 'running';
            } else if(pendingTasks.length){
                node.pending = Math.max(
                    pendingTasks.length,
                    Number(node.pending || 0) || pendingTasks.length
                );
                node.running = false;
            } else if(smartNodeHasDisplayResult(node)){
                markSmartNodeComplete(node,{hideTimer:true});
            } else if(node.pending || node.queued){
                clearSmartNodeBusyState(node);
            }
        });
        const cleanedCompletedState = clearCompletedNodeBusyStates();
        const recoveredLoopOutputs = recoverStuckLoopOutputsFromLogs();
        const hiddenCompletedTimers = hideCompletedRunTimers();
        const cleanedDetachedInputs = cleanupDetachedRunInputRefs();
        normalizeSmartVideoModeSettings(settings,true);
        nodes.forEach(node => {
            if(node.runSettings){
                normalizeSmartVideoModeSettings(node.runSettings,true);
            }
        });
        canvasDefaultSmartSettings = cloneSmartSettings(settings);
        loadRecentSmartSettings();
        if(settings.comfy_workflow && !settings.comfyWorkflow){
            settings.comfyWorkflow = settings.comfy_workflow;
        }
        if(settings.comfy_params && !settings.comfyParams){
            settings.comfyParams = settings.comfy_params;
        }
        updateProviderModels();
        await viewportRestore;
        render();
        opening?.ready?.();
        const normalizedOpeningDocument = canvasPersistenceSharedDocument();
        const sourceWithLocalChanges = canvasPersistenceApplyChanges(
            canvasPersistenceOpeningSourceDocument,
            openingLocalChanges
        );
        const inverseLocalChanges = canvasPersistenceDiff(
            sourceWithLocalChanges,
            canvasPersistenceOpeningSourceDocument
        );
        canvasPersistenceOpeningBaselineDocument =
            canvasPersistenceApplyChanges(
                normalizedOpeningDocument,
                inverseLocalChanges
            );
        if(
            migratedGenerationOutputs
            || migratedGenerationOutputGalleries
            || migratedLayerDecompositionGroups
            || migratedPromptSplits
            || cleanedDetachedInputs
            || cleanedCompletedState
            || recoveredLoopOutputs
            || hiddenCompletedTimers
        ){
            canvasPersistencePendingSave = true;
        }
        generationRunModule.resume();
        smartMattingModule.resume();
        canvasPersistenceConnect();
        return canvas;
    } catch(error){
        canvasPersistenceSetStatus('error');
        toast(canvasPersistenceText('smart.toastCanvasFail'));
        opening?.fail?.(error);
        return null;
    }
}
function canvasPersistenceReceive(message={}){
    if(!message || message.type !== 'canvas_updated') return false;
    if(!canvasId || message.canvas_id !== canvasId) return false;
    if(canvasPersistenceStatusValue === 'ready') return false;
    canvasPersistenceRequestResync('legacy-update');
    return true;
}

document.addEventListener?.('focusout',() => {
    setTimeout(canvasPersistenceFlushQueuedMessages,0);
});
window.addEventListener?.('beforeunload',() => {
    if(canvasPersistencePendingSave || canvasPersistenceInFlight){
        canvasPersistencePersistLocal();
    }
});

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.canvasRealtimeApplier = canvasRealtimeApplier;
window.addEventListener?.('studio-lang-change', () => canvasPersistenceSetStatus(canvasPersistenceStatusValue));

window.SmartCanvasModules.canvasPersistence = Object.freeze({
    startTransientSession({document=null}={}){
        return canvasPersistenceStartTransientSession({document});
    },
    load(){
        return canvasPersistenceLoad();
    },
    schedule({delay=450}={}){
        return canvasPersistenceSchedule(delay);
    },
    save(){
        return canvasPersistenceSave();
    },
    synced({timeout=5000}={}){
        return canvasPersistenceSynced(timeout);
    },
    checkpoint({timeout=5000}={}){
        return canvasPersistenceCheckpoint({timeout});
    },
    observeExternalCommit({operationId='',revision=0}={}){
        return canvasPersistenceObserveExternalCommit({operationId,revision});
    },
    resync(){
        return canvasPersistenceResyncNow();
    },
    receive({message=null}={}){
        return canvasPersistenceReceive(message || {});
    },
    hold({scope='canvas-interaction'}={}){
        return canvasPersistenceHold(scope);
    },
    release({scope='canvas-interaction'}={}){
        return canvasPersistenceRelease(scope);
    },
    editable(){
        return canvasPersistenceEditable();
    },
    online(){
        return canvasPersistenceOnline();
    },
    status(){
        return Object.freeze({
            state:canvasPersistenceStatusValue,
            revision:canvasPersistenceRevision,
            pending:Boolean(
                canvasPersistencePendingSave
                || canvasPersistenceInFlight
            )
        });
    },
    revert({operationId=''}={}){
        return canvasPersistenceRevert(operationId);
    },
    retry(){
        return canvasPersistenceReconnectNow();
    },
    sendPresence(message){
        return canvasPersistenceSendPresence(message);
    }
});
