/*
 * Smart Canvas Mutation Module
 *
 * Owns local Node/Connection creation, duplication, removal, connection
 * maintenance and Undo history. Callers express domain actions through one
 * Interface; selection, rendering and Canvas Sync side effects stay here.
 */
const canvasMutationPersistenceModule = window.SmartCanvasModules?.canvasPersistence;
if(!canvasMutationPersistenceModule){
    throw new Error('Canvas Persistence Module failed to load');
}
const canvasMutationNodeKinds = window.SmartCanvasModules?.nodeKinds;
const canvasMutationNodeGeometry = window.SmartCanvasModules?.nodeGeometry;
if(!canvasMutationNodeGeometry?.createSession){
    throw new Error('Node Geometry Module failed to load');
}
const canvasMutationPlacements = new Map();

const canvasMutationFallbacks = Object.freeze({
    'smart.toastNoUndo':'没有可撤销的操作',
    'smart.undoUnavailable':'该操作暂时无法撤销',
    'smart.toastUndone':'已撤销',
    'smart.noRedo':'没有可重做的操作',
    'smart.redoUnavailable':'该操作暂时无法重做',
    'smart.createImportNode':'上传节点',
    'smart.kindText':'文本',
    'smart.separator':'分隔符',
    'smart.smartGroup':'编组',
    'smart.frameNumber':'分区 {number}',
    'smart.frameDefault':'分区',
    'smart.promptGenerationNode':'提示词生成'
});
function canvasMutationText(key, values={}){
    const translated = typeof tr === 'function'
        ? tr(key)
        : window.StudioI18n?.t?.(key);
    const text = translated && translated !== key
        ? translated
        : (canvasMutationFallbacks[key] || key);
    return Object.entries(values).reduce(
        (result,[name,value]) => result.replaceAll(`{${name}}`, String(value)),
        text
    );
}

const CANVAS_MUTATION_UNDO_LIMIT = 20;
const canvasMutationUndoStack = [];
const canvasMutationAcceptedUndoStack = [];
const canvasMutationAcceptedRedoStack = [];
let canvasMutationUndoSuppressed = false;
let canvasMutationPendingUndoSnapshot = null;
let canvasMutationPendingRevert = null;

function canvasMutationRealtimeMode(){
    return typeof canvasMutationPersistenceModule.status === 'function'
        && typeof canvasMutationPersistenceModule.revert === 'function';
}

function canvasMutationSnapshot(){
    return {
        nodes:JSON.parse(JSON.stringify(nodes)),
        connections:JSON.parse(JSON.stringify(canvas?.connections || [])),
        selectedId,
        selectedIds:selectedIds.slice(),
        selectedImage:{...selectedImage}
    };
}
function canvasMutationHistory(action='push',details={}){
    if(action === 'snapshot') return canvasMutationSnapshot();
    if(action === 'capture'){
        canvasMutationPendingUndoSnapshot = canvasMutationSnapshot();
        return true;
    }
    if(action === 'commit'){
        if(!canvasMutationPendingUndoSnapshot) return false;
        if(canvasMutationRealtimeMode()){
            canvasMutationPendingUndoSnapshot = null;
            return true;
        }
        canvasMutationUndoStack.push(canvasMutationPendingUndoSnapshot);
        if(canvasMutationUndoStack.length > CANVAS_MUTATION_UNDO_LIMIT){
            canvasMutationUndoStack.shift();
        }
        canvasMutationPendingUndoSnapshot = null;
        return true;
    }
    if(action === 'discard'){
        const discarded = Boolean(canvasMutationPendingUndoSnapshot);
        canvasMutationPendingUndoSnapshot = null;
        return discarded;
    }
    if(action === 'accepted'){
        const operationId = String(details.operationId || '');
        const revertsOperationId = String(
            details.revertsOperationId || ''
        );
        if(!operationId) return false;
        if(
            revertsOperationId
            && canvasMutationPendingRevert?.target === revertsOperationId
        ){
            if(canvasMutationPendingRevert.mode === 'undo'){
                const index = canvasMutationAcceptedUndoStack
                    .lastIndexOf(revertsOperationId);
                if(index >= 0) canvasMutationAcceptedUndoStack.splice(index,1);
                canvasMutationAcceptedRedoStack.push(operationId);
            } else {
                const index = canvasMutationAcceptedRedoStack
                    .lastIndexOf(revertsOperationId);
                if(index >= 0) canvasMutationAcceptedRedoStack.splice(index,1);
                canvasMutationAcceptedUndoStack.push(operationId);
            }
            canvasMutationPendingRevert = null;
            return true;
        }
        if(!revertsOperationId){
            canvasMutationAcceptedUndoStack.push(operationId);
            if(
                canvasMutationAcceptedUndoStack.length
                > CANVAS_MUTATION_UNDO_LIMIT
            ){
                canvasMutationAcceptedUndoStack.shift();
            }
            canvasMutationAcceptedRedoStack.length = 0;
        }
        return true;
    }
    if(action === 'rejected'){
        canvasMutationPendingRevert = null;
        return true;
    }
    if(action === 'undo'){
        if(canvasMutationRealtimeMode()){
            if(canvasMutationPendingRevert) return false;
            const operationId = canvasMutationAcceptedUndoStack.at(-1);
            if(!operationId){
                toast(canvasMutationText('smart.toastNoUndo'));
                return false;
            }
            canvasMutationPendingRevert = {
                target:operationId,
                mode:'undo'
            };
            canvasMutationPersistenceModule
                .revert({operationId})
                .then(result => {
                    if(result?.ok) return;
                    canvasMutationPendingRevert = null;
                    toast(result?.message || canvasMutationText('smart.undoUnavailable'));
                });
            return true;
        }
        if(!canvasMutationUndoStack.length){
            toast(canvasMutationText('smart.toastNoUndo'));
            return false;
        }
        const snapshot = canvasMutationUndoStack.pop();
        canvasMutationUndoSuppressed = true;
        nodes = snapshot.nodes;
        if(canvas) canvas.connections = snapshot.connections;
        selectedId = snapshot.selectedId;
        selectedIds = snapshot.selectedIds;
        selectedImage = snapshot.selectedImage;
        activeComposerSubject = null;
        lastComposerNodeId = '';
        render();
        canvasMutationPersistenceModule.schedule();
        canvasMutationUndoSuppressed = false;
        toast(canvasMutationText('smart.toastUndone'));
        return true;
    }
    if(action === 'redo'){
        if(!canvasMutationRealtimeMode() || canvasMutationPendingRevert){
            return false;
        }
        const operationId = canvasMutationAcceptedRedoStack.at(-1);
        if(!operationId){
            toast(canvasMutationText('smart.noRedo'));
            return false;
        }
        canvasMutationPendingRevert = {
            target:operationId,
            mode:'redo'
        };
        canvasMutationPersistenceModule
            .revert({operationId})
            .then(result => {
                if(result?.ok) return;
                canvasMutationPendingRevert = null;
                toast(result?.message || canvasMutationText('smart.redoUnavailable'));
            });
        return true;
    }
    if(action !== 'push'){
        throw new Error(`Unknown Canvas Mutation history action: ${action}`);
    }
    if(canvasMutationRealtimeMode()) return true;
    if(canvasMutationUndoSuppressed || !canvas) return false;
    canvasMutationUndoStack.push(canvasMutationSnapshot());
    if(canvasMutationUndoStack.length > CANVAS_MUTATION_UNDO_LIMIT){
        canvasMutationUndoStack.shift();
    }
    return true;
}
function canvasMutationApplySelection(node, options={}){
    if(options.select === false || !node) return;
    selectedId = node.id;
    selectedIds = [];
    selectedImage = {nodeId:'', index:-1};
}
function canvasMutationPlanDrafts(drafts=[], intent={}){
    const context = JSON.parse(JSON.stringify(intent));
    if(!Object.prototype.hasOwnProperty.call(context,'viewport')) {
        context.viewport = window.SmartCanvasModules?.viewportSelection?.viewport?.bounds?.() || null;
    }
    const planner = window.SmartCanvasModules?.nodePlacement;
    if(!planner?.plan) throw new Error('Node Placement Module failed to load');
    const plan = planner.plan({snapshot:{nodes},drafts,intent:context});
    if(!plan?.ok){
        const error = new Error('Canvas Mutation could not place draft Nodes');
        error.diagnostics = plan?.diagnostics || [];
        throw error;
    }
    const placement = {mode:context.anchor?.kind==='point' ? 'exact' : 'auto',
        gap:canvasMutationNodeGeometry.nodeGap,collectionId:String(drafts[0]?.id || ''),
        intent:{...context,frameId:plan.frameId}};
    drafts.forEach(node=>canvasMutationPlacements.set(String(node.id),{...placement,frameUpdates:plan.frameUpdates || []}));
    const positions = new Map(plan.placements.map(position=>[String(position.id),position]));
    drafts.forEach(draft=>{
        const position = positions.get(String(draft.id));
        draft.x = position.x;
        draft.y = position.y;
    });
    return plan;
}
function canvasMutationFinalizePlacement(drafts=[]){
    const frames = new Map();
    drafts.forEach(node=>(canvasMutationPlacements.get(String(node.id))?.frameUpdates || []).forEach(update=>frames.set(update.id,update)));
    frames.forEach(update=>{
        const frame=nodes.find(node=>node.id===update.id && node.type==='smart-frame');
        if(frame) Object.assign(frame,update);
    });
    window.SmartCanvasModules?.smartContainer?.reconcileFrames?.();
}
function canvasMutationStabilizeDraftGeometry(node){
    if(!node?.id) return node;
    const measurement = canvasMutationNodeGeometry.createSession({
        nodes:[node],
        connections:[]
    }).measure(node.id);
    if(!measurement?.supported || measurement.diagnostics?.length){
        const error = new Error('Canvas Mutation could not stabilize draft Node geometry');
        error.diagnostics = measurement?.diagnostics || [];
        throw error;
    }
    node.w = Math.round(measurement.footprint.width);
    node.h = Math.round(measurement.footprint.height);
    return node;
}
function canvasMutationReveal(nodeList=[], options={}){
    if(!options.reveal) return false;
    return Boolean(
        window.SmartCanvasModules?.viewportSelection?.viewport?.reveal?.(
            canvasMutationBounds(nodeList),
            {smooth:options.smoothReveal !== false}
        )
    );
}
function canvasMutationCreate(kind='image', data={}, options={}){
    const x = Number(data.x) || 0;
    const y = Number(data.y) || 0;
    let node = null;
    if(kind === 'prepared'){
        node = data.node || null;
    } else if(kind === 'image'){
        const nodeImages = (data.images || []).map(image => ({...image}));
        node = {
            id:uid('smart'),
            type:'smart-image',
            x,
            y,
            title:nodeImages.length > 1
                ? 'Group'
                : nodeImages.length
                    ? 'Image'
                    : canvasMutationText('smart.createImportNode'),
            images:nodeImages,
            created_at:Date.now()
        };
        node.scale = nodeImages.length > 1
            ? MEDIA_GROUP_DEFAULT_SCALE
            : mediaNodeDefaultScale(node);
        inheritNodeMetaFromImage(node);
    } else if(kind === 'prompt'){
        const entry = smartModelCatalog('text')[0];
        const providerId = entry?.provider_id || resolveChatProviderId();
        const requestedWidth = Number(data.w);
        const requestedHeight = Number(data.h);
        node = {
            id:uid('prompt'),
            type:canvasMutationNodeKinds?.PROMPT || 'smart-prompt',
            x,
            y,
            title:String(data.title || canvasMutationText('smart.promptNode')),
            text:String(data.text || ''),
            llmEnabled:Boolean(data.llmEnabled),
            llmProvider:String(data.llmProvider || providerId),
            llmModel:String(data.llmModel || entry?.model || resolveChatModel('', providerId)),
            llmSystemEnabled:Boolean(data.llmSystemEnabled),
            llmSystemPrompt:String(data.llmSystemPrompt || 'You are a helpful prompt assistant.'),
            llmInstruction:String(data.llmInstruction || ''),
            llmInstructionHtml:String(data.llmInstructionHtml || ''),
            created_at:Date.now()
        };
        const hasRequestedWidth = Number.isFinite(requestedWidth) && requestedWidth > 24;
        const hasRequestedHeight = Number.isFinite(requestedHeight) && requestedHeight > 24;
        if(hasRequestedWidth && hasRequestedHeight){
            node.w = Math.round(requestedWidth);
            node.h = Math.round(requestedHeight);
        }
        if(Number.isFinite(Number(data.llmInstructionHeight))){
            node.llmInstructionHeight = Math.round(Number(data.llmInstructionHeight));
        }
        if(data.llmTemplateId) node.llmTemplateId = String(data.llmTemplateId);
        if(data.llmTemplateLibraryId){
            node.llmTemplateLibraryId = String(data.llmTemplateLibraryId);
        }
        if(Array.isArray(data.llmInputMedia)){
            node.llmInputMedia = data.llmInputMedia.map(item => ({...item}));
        }
        if(data.textGenerationOutput) node.textGenerationOutput = true;
        if(data.textGenerationPending) node.textGenerationPending = true;
        canvasMutationStabilizeDraftGeometry(node);
        if(hasRequestedWidth) node.w = Math.round(requestedWidth);
        if(hasRequestedHeight) node.h = Math.round(requestedHeight);
    } else if(kind === 'splitter'){
        node = {
            id:uid('splitter'),
            type:'smart-splitter',
            x,
            y,
            w:316,
            h:240,
            title:canvasMutationText('smart.separator'),
            separator:';',
            created_at:Date.now()
        };
    } else if(kind === 'loop'){
        node = {
            id:uid('loop'),
            type:'smart-loop',
            x,
            y,
            w:360,
            h:406,
            title:canvasMutationText('smart.loop'),
            count:1,
            mode:'serial',
            showPrompt:false,
            imageInput:false,
            loopStart:1,
            imageBatchSize:1,
            variablePrompt:'',
            created_at:Date.now()
        };
    } else if(kind === 'group'){
        node = {
            id:uid('group'),
            type:'smart-group',
            x,
            y,
            w:SMART_GROUP_DEFAULT_WIDTH,
            h:SMART_GROUP_DEFAULT_HEIGHT,
            title:canvasMutationText('smart.smartGroup'),
            items:[],
            images:[],
            memberOrderVersion:1,
            memberOrder:[],
            created_at:Date.now()
        };
    } else if(kind === 'frame'){
        node = {
            id:uid('frame'),
            type:'smart-frame',
            x,
            y,
            w:Math.max(
                SMART_FRAME_MIN_WIDTH,
                Math.round(Number(data.w) || SMART_FRAME_DEFAULT_WIDTH)
            ),
            h:Math.max(
                SMART_FRAME_MIN_HEIGHT,
                Math.round(Number(data.h) || SMART_FRAME_DEFAULT_HEIGHT)
            ),
            title:String(
                data.title
                || canvasMutationText('smart.frameNumber', {number: nodes.filter(
                    node => node?.type === 'smart-frame'
                ).length + 1})
            ),
            frameColor:SMART_FRAME_COLORS.includes(data.frameColor)
                ? data.frameColor
                : SMART_FRAME_DEFAULT_COLOR,
            items:Array.isArray(data.items)
                ? Array.from(new Set(data.items))
                : [],
            created_at:Date.now()
        };
    } else {
        throw new Error(`Unknown Canvas Mutation Node kind: ${kind}`);
    }
    if(!node) return null;
    if(options.placement){
        if(options.positionMode === 'exact'){
            throw new Error('Canvas Mutation cannot combine placement with exact mode');
        }
        canvasMutationPlanDrafts([node], options.placement);
    } else if(options.positionMode !== 'exact'){
        throw new Error('Canvas Mutation create requires placement or exact mode');
    }
    if(options.positionMode === 'exact') canvasMutationPlacements.set(String(node.id),{mode:'exact',gap:canvasMutationNodeGeometry.nodeGap});
    if(!options.skipUndo) canvasMutationHistory('push');
    nodes.push(node);
    canvasMutationFinalizePlacement([node]);
    canvasMutationApplySelection(node, options);
    if(options.render !== false){
        render({syncVirtualization:false,nodeIds:[node.id]});
    }
    canvasMutationReveal([node],options);
    if(options.save !== false) canvasMutationPersistenceModule.schedule();
    return node;
}
function canvasMutationCreateBatch({drafts=[],intent={},connections=[],options={}}={}){
    if(!canvas || !Array.isArray(drafts) || !drafts.length) return [];
    const staged = drafts.filter(Boolean);
    if(!staged.length) return [];
    const existingNodeIds = new Set(
        (options.existingNodeIds || []).map(value => String(value || '')).filter(Boolean)
    );
    const existingDrafts = staged.filter(node => existingNodeIds.has(String(node?.id || '')));
    if(existingDrafts.some(node => !nodes.some(candidate => candidate.id === node.id))){
        throw new Error('Canvas Mutation existing batch Node is missing');
    }
    const added = staged.filter(node=>!existingNodeIds.has(String(node.id)));
    const availableIds=new Set([...nodes,...added].map(node=>node.id));
    if(new Set(staged.map(node=>node.id)).size!==staged.length
        || added.some(node=>!node.id || nodes.some(existing=>existing.id===node.id))
        || connections.some(connection=>{
            const from=connection.fromId || connection.from, to=connection.toId || connection.to;
            return !availableIds.has(from) || !availableIds.has(to) || from===to;
        })) throw new Error('Canvas Mutation batch contains invalid identities or connections');
    // A reused result keeps its identity and coordinates, and remains an obstacle.
    if(added.length) canvasMutationPlanDrafts(added,intent);
    if(!options.skipUndo) canvasMutationHistory('push');
    nodes.push(...added);
    canvasMutationFinalizePlacement(added);
    (connections || []).forEach(connection => {
        if(connection?.exact) canvasMutationConnectExact(connection);
        else canvasMutationConnect(connection);
    });
    if(options.select !== false){
        selectedId = staged.length === 1 ? staged[0].id : '';
        selectedIds = staged.length > 1 ? staged.map(node => node.id) : [];
        selectedImage = {nodeId:'',index:-1};
    }
    if(options.render !== false){
        render({syncVirtualization:false,nodeIds:staged.map(node => node.id)});
    }
    canvasMutationReveal(staged,options);
    if(options.save !== false) canvasMutationPersistenceModule.schedule();
    return staged;
}
function canvasMutationUpdate(nodeId, mutate, options={}){
    const node = nodes.find(candidate => String(candidate?.id || '') === String(nodeId || ''));
    if(!node || typeof mutate !== 'function') return null;
    if(!options.skipUndo) canvasMutationHistory('push');
    const result = mutate(node);
    if(result === false) return null;
    canvasMutationApplySelection(node, options);
    if(options.imageIndex != null){
        selectedImage = {nodeId:node.id,index:Number(options.imageIndex) || 0};
    }
    if(options.render !== false){
        render({syncVirtualization:false,nodeIds:[node.id]});
    }
    canvasMutationReveal([node],options);
    if(options.save !== false) canvasMutationPersistenceModule.schedule();
    return node;
}

function canvasMutationArrange({placements=[],frameUpdates=[],options={}}={}){
    if(!canvas || !Array.isArray(placements) || !placements.length) return false;
    const byId = new Map(nodes.map(node => [String(node?.id || ''),node]));
    const targets = placements.map(position => ({
        position,
        node:byId.get(String(position?.id || ''))
    })).filter(item => item.node);
    if(targets.length !== placements.length) return false;
    const translate = (node,dx,dy,seen=new Set()) => {
        if(!node || seen.has(String(node.id || ''))) return;
        seen.add(String(node.id || ''));
        node.x = Math.round((Number(node.x) || 0) + dx);
        node.y = Math.round((Number(node.y) || 0) + dy);
        if(['smart-group','smart-frame'].includes(node.type)){
            (node.items || []).forEach(memberId =>
                translate(byId.get(String(memberId || '')),dx,dy,seen)
            );
        }
    };
    if(!options.skipUndo) canvasMutationHistory('push');
    const moved = new Set();
    targets.forEach(({node,position}) => {
        if(moved.has(String(node.id))) return;
        const dx = Math.round(Number(position.x) - (Number(node.x) || 0));
        const dy = Math.round(Number(position.y) - (Number(node.y) || 0));
        const before = new Set();
        translate(node,dx,dy,before);
        before.forEach(id => moved.add(id));
    });
    (frameUpdates || []).forEach(update => {
        const frame = byId.get(String(update?.id || ''));
        if(frame?.type !== 'smart-frame') return;
        ['x','y','w','h'].forEach(key => {
            const value = Number(update[key]);
            if(Number.isFinite(value)) frame[key] = Math.round(value);
        });
    });
    window.SmartCanvasModules?.smartContainer?.reconcileFrames?.();
    if(options.render !== false) render();
    if(options.save !== false) canvasMutationPersistenceModule.schedule();
    return true;
}
function canvasMutationCloneNode(node){
    const copy = JSON.parse(JSON.stringify(node));
    copy.id = uid(
        node.type === 'smart-prompt'
            ? 'prompt'
            : node.type === 'smart-splitter'
                ? 'splitter'
            : node.type === 'smart-loop'
                ? 'loop'
                : node.type === 'smart-group'
                    ? 'group'
                    : node.type === 'smart-frame'
                        ? 'frame'
                        : 'smart'
    );
    copy.x = Number(node.x) || 0;
    copy.y = Number(node.y) || 0;
    clearSmartNodeTransientRunState(copy, {clearRunHistory:true});
    const generationOutputModule = window.SmartCanvasModules?.generationOutput;
    if(isSmartImageNode(node) && node.generationOutputNode && generationOutputModule?.prepareDuplicate){
        generationOutputModule.prepareDuplicate({source:node,copy});
    }
    if(copy.type === 'smart-group') copy.title = copy.title || canvasMutationText('smart.smartGroup');
    if(copy.type === 'smart-frame') copy.title = copy.title || canvasMutationText('smart.frameDefault');
    return copy;
}
function canvasMutationBounds(nodeList=[]){
    const rects = nodeList.filter(Boolean).map(nodeRect);
    if(!rects.length) return {x:0,y:0,width:0,height:0};
    const left = Math.min(...rects.map(rect => rect.x));
    const top = Math.min(...rects.map(rect => rect.y));
    const right = Math.max(...rects.map(rect => rect.x + rect.width));
    const bottom = Math.max(...rects.map(rect => rect.y + rect.height));
    return {x:left,y:top,width:right - left,height:bottom - top};
}
function canvasMutationDuplicate(options={}){
    if(!canvas || isEditableTarget(document.activeElement)){
        return {nodes:[],anchor:null};
    }
    const mode = options.mode || 'offset';
    const sourceNodes = Array.isArray(options.sourceNodes)
        ? options.sourceNodes.filter(Boolean)
        : (options.nodeIds || window.SmartCanvasModules.viewportSelection.selection.ids())
            .map(id => nodes.find(node => node.id === id))
            .filter(Boolean);
    if(!sourceNodes.length) return {nodes:[],anchor:null};
    const idMap = new Map();
    const copies = sourceNodes.map(node => {
        const copy = canvasMutationCloneNode(node);
        idMap.set(node.id, copy.id);
        return copy;
    });
    const preserveExternal = Boolean(options.preserveConnections);
    const sourceIds = new Set(sourceNodes.map(node => node.id));
    const existingNodeIds = new Set(nodes.map(node => node.id));
    const connectionCandidates = Array.isArray(options.connections)
        ? options.connections
        : (canvas.connections || []);
    const sourceConnections = connectionCandidates.filter(connection => {
        const internal = sourceIds.has(connection.from)
            && sourceIds.has(connection.to);
        const externalInput = preserveExternal
            && !sourceIds.has(connection.from)
            && existingNodeIds.has(connection.from)
            && sourceIds.has(connection.to)
            && (connection.kind || 'flow') === 'input';
        return internal || externalInput;
    });
    copies.forEach((copy,index) => {
        const source = sourceNodes[index];
        if(
            copy.type === 'smart-group'
            && window.SmartCanvasModules?.smartContainer?.remapCopy
        ){
            window.SmartCanvasModules.smartContainer.remapCopy(
                copy,
                source,
                idMap
            );
        } else if(Array.isArray(copy.items)){
            copy.items = copy.items.map(id => idMap.get(id)).filter(Boolean);
        }
        if(Array.isArray(copy.inputRefOrder)){
            copy.inputRefOrder = copy.inputRefOrder.map(key => typeof key === 'string' && key.startsWith('text|')
                ? `text|${idMap.get(key.slice(5)) || key.slice(5)}` : key);
        }
        if(Array.isArray(copy.inputNodeIds)){
            const sourceNodeId = sourceNodes[index]?.id;
            const validInputIds = new Set(sourceConnections
                .filter(connection =>
                    connection.to === sourceNodeId
                    && (connection.kind || 'flow') === 'input'
                )
                .map(connection => connection.from));
            copy.inputNodeIds = copy.inputNodeIds
                .filter(id => validInputIds.has(id))
                .map(id => idMap.get(id) || id)
                .filter(Boolean);
        }
        if(copy.sourceNodeId){
            copy.sourceNodeId = preserveExternal
                ? (idMap.get(copy.sourceNodeId) || copy.sourceNodeId)
                : (idMap.get(copy.sourceNodeId) || '');
        }
    });
    if(mode === 'offset'){
        canvasMutationPlanDrafts(copies,{
            anchor:{kind:'source',sourceNodeIds:sourceNodes.map(node=>node.id)},
            alignment:'center',
            relation:'downstream',
            arrangement:'rigid'
        });
    } else if(['point','viewport'].includes(mode)){
        const explicitPoint = mode === 'point' ? options.point || lastMouseWorld : null;
        const point = explicitPoint || options.point || window.SmartCanvasModules.viewportSelection.viewport.center();
        canvasMutationPlanDrafts(copies,{
            anchor:{kind:explicitPoint ? 'point' : 'viewport',x:point.x,y:point.y},
            relation:'free',
            arrangement:'rigid'
        });
    }
    if(!options.skipUndo) canvasMutationHistory('push');
    const newConnections = sourceConnections.map(connection => {
        const from = idMap.get(connection.from)
            || (preserveExternal ? connection.from : '');
        const sourceCopy = copies.find(copy => copy.id === from);
        return {
            ...connection,
            from,
            to:idMap.get(connection.to)
                || (preserveExternal ? connection.to : ''),
            ...(sourceCopy?.generationOutputNode && sourceCopy.activeOutputId
                ? {sourceOutputId:sourceCopy.activeOutputId}
                : {})
        };
    }).filter(connection =>
        connection.from
        && connection.to
        && connection.from !== connection.to
    );
    const nextConnections = [...(canvas.connections || [])];
    newConnections.forEach(connection => {
        const kind = connection.kind || 'flow';
        if(nextConnections.some(existing =>
            existing.from === connection.from
            && existing.to === connection.to
            && (existing.kind || 'flow') === kind
        )){
            return;
        }
        nextConnections.push(connection);
    });
    canvas.connections = nextConnections;
    nodes.push(...copies);
    canvasMutationFinalizePlacement(copies);
    newConnections.forEach(connection => {
        if((connection.kind || 'flow') !== 'input') return;
        const target = copies.find(copy => copy.id === connection.to)
            || nodes.find(node => node.id === connection.to);
        if(!target) return;
        target.inputNodeIds = Array.from(new Set([
            ...(target.inputNodeIds || []),
            connection.from
        ]));
    });
    if(mode === 'alt'){
        selectedId = '';
        selectedIds = [];
        selectedImage = {nodeId:'',index:-1};
    } else if(options.select !== false){
        selectedId = copies.length === 1 ? copies[0].id : '';
        selectedIds = copies.length > 1
            ? copies.map(node => node.id)
            : [];
        selectedImage = {nodeId:'',index:-1};
    }
    const anchorSourceId = options.anchorNodeId || sourceNodes[0].id;
    const anchor = copies.find(copy => copy.id === idMap.get(anchorSourceId))
        || copies[0];
    if(options.render !== false){
        render({
            syncVirtualization:false,
            nodeIds:copies.map(node => node.id)
        });
    }
    canvasMutationReveal(copies,{
        ...options,
        reveal:options.reveal !== false && mode !== 'alt'
    });
    if(options.save !== false) canvasMutationPersistenceModule.schedule();
    if(options.message) toast(options.message.replace('{count}', copies.length));
    return {nodes:copies,anchor};
}
function canvasMutationRemove(nodeIds=[], options={}){
    const requested = nodeIds.filter(id =>
        nodes.some(node => node.id === id)
    );
    if(!requested.length) return false;
    if(!options.skipUndo) canvasMutationHistory('push');
    const deleteIds = new Set(requested);
    nodes.forEach(node => {
        if(isHistoryGroupNode(node) && deleteIds.has(node.historyFor)){
            deleteIds.add(node.id);
        }
    });
    nodes = nodes.filter(node => !deleteIds.has(node.id));
    deleteIds.forEach(nodeId => canvasMutationPlacements.delete(String(nodeId)));
    if(canvas){
        canvas.connections = (canvas.connections || []).filter(connection =>
            !deleteIds.has(connection.from)
            && !deleteIds.has(connection.to)
        );
    }
    nodes.forEach(node => {
        if(Array.isArray(node.inputNodeIds)){
            node.inputNodeIds = node.inputNodeIds.filter(
                inputId => !deleteIds.has(inputId)
            );
        }
        if(Array.isArray(node.items)){
            node.items = node.items.filter(
                itemId => !deleteIds.has(itemId)
            );
        }
        if(Array.isArray(node.memberOrder)){
            node.memberOrder = node.memberOrder.filter(entry =>
                entry?.kind !== 'node' || !deleteIds.has(entry.id)
            );
        }
    });
    if(deleteIds.has(selectedId)) selectedId = '';
    selectedIds = selectedIds.filter(id => !deleteIds.has(id));
    if(deleteIds.has(selectedImage.nodeId)){
        selectedImage = {nodeId:'',index:-1};
    }
    if(options.render !== false){
        render({syncVirtualization:false,nodeIds:[...deleteIds]});
    }
    if(options.save !== false) canvasMutationPersistenceModule.schedule();
    return true;
}
function canvasMutationAddConnection(fromId, toId, kind='flow'){
    if(!fromId || !toId || fromId === toId || !canvas) return false;
    canvas.connections = canvas.connections || [];
    if(canvas.connections.some(connection =>
        connection.from === fromId
        && connection.to === toId
        && (connection.kind || 'flow') === kind
    )){
        return false;
    }
    const source = nodes.find(node => node.id === fromId);
    const sourceOutputId = isSmartImageNode(source) && source.generationOutputNode
        ? String(source.activeOutputId || source.images?.[0]?.outputId || '')
        : '';
    canvas.connections.push({
        from:fromId,
        to:toId,
        kind,
        ...(sourceOutputId ? {sourceOutputId} : {})
    });
    return true;
}
function canvasMutationConnectExact(options={}){
    const fromId = String(options.fromId || options.from || '');
    const toId = String(options.toId || options.to || '');
    const kind = String(options.kind || 'flow');
    if(
        !fromId
        || !toId
        || fromId === toId
        || !nodes.some(node => node.id === fromId)
        || !nodes.some(node => node.id === toId)
    ) return false;
    canvas.connections = canvas.connections || [];
    if(canvas.connections.some(connection =>
        connection.from === fromId
        && connection.to === toId
        && (connection.kind || 'flow') === kind
    )) return false;
    const connection = {...options,from:fromId,to:toId,kind};
    delete connection.fromId;
    delete connection.toId;
    delete connection.input;
    delete connection.exact;
    canvas.connections.push(connection);
    if(kind === 'input'){
        const target = nodes.find(node => node.id === toId);
        target.inputNodeIds = Array.from(new Set([
            ...(target.inputNodeIds || []),
            fromId
        ]));
    }
    return true;
}
function canvasMutationConnect(options={}){
    const fromId = options.fromId || '';
    const toId = options.toId || '';
    const kind = options.kind || (options.input ? 'input' : 'flow');
    const from = nodes.find(node => node.id === fromId);
    const to = nodes.find(node => node.id === toId);
    if(
        !from
        || !to
        || from.id === to.id
        || from.type === 'smart-frame'
        || to.type === 'smart-frame'
    ){
        return false;
    }
    if(!options.input){
        return canvasMutationAddConnection(fromId, toId, kind);
    }
    if(to.type === 'smart-loop'){
        const groupImages = from.type === 'smart-group'
            ? imagesForNode(from).filter(image => image?.url)
            : [];
        const groupPrompts = from.type === 'smart-group'
            ? promptTextItemsForNode(from).filter(Boolean)
            : [];
        const looksImage = isSmartImageNode(from)
            || groupImages.length > 0
            || (from.type === 'smart-loop' && from.imageInput);
        const looksPrompt = from.type === 'smart-prompt'
            || from.type === 'smart-splitter'
            || groupPrompts.length > 0
            || (from.type === 'smart-loop' && from.showPrompt);
        if(looksImage && !to.imageInput) to.imageInput = true;
        if(looksPrompt && !to.showPrompt) to.showPrompt = true;
        if(looksImage || looksPrompt) fitSmartLoopNode(to);
        if(!(Boolean(to.imageInput) && looksImage)
            && !(Boolean(to.showPrompt) && looksPrompt)){
            return false;
        }
    }
    to.inputNodeIds = Array.from(
        new Set([...(to.inputNodeIds || []),from.id])
    );
    canvasMutationAddConnection(from.id, to.id, 'input');
    const hasMediaInput = to.type === 'smart-prompt' && (
        (typeof outputImagesForNode === 'function'
            && outputImagesForNode(from).some(item => item?.url))
        || (from.images || []).some(item => item?.url)
    );
    if(hasMediaInput){
        to.llmEnabled = true;
        to.title = canvasMutationText('smart.promptGenerationNode');
        if(typeof promptNodeExpandedHeight === 'function'){
            to.h = promptNodeExpandedHeight(to);
        }
    }
    return true;
}
function canvasMutationConnectSources({sourceIds=[],targetId='',draft=null,point=null}={}){
    if(!canvas || !sourceIds.length) return null;
    const sources = [...new Set(sourceIds)].map(id => nodes.find(node => node.id === id));
    const target = draft || nodes.find(node => node.id === targetId);
    if(!target || sources.some(node => !node || node.id === target.id)) return null;
    if(draft && nodes.some(node => node.id === draft.id)) return null;
    const existing = new Set((canvas.connections || []).filter(connection => connection.to === target.id && connection.kind === 'input').map(connection => connection.from));
    const missing = sources.filter(node => !existing.has(node.id));
    if(!missing.length) return {target,changed:false};
    const connections = missing.map(source => {
        const sourceOutputId = isSmartImageNode(source) && source.generationOutputNode
            ? String(source.activeOutputId || source.images?.[0]?.outputId || '') : '';
        return {from:source.id,to:target.id,kind:'input',...(sourceOutputId ? {sourceOutputId} : {})};
    });
    // Plan everything before changing live nodes; failed placement leaves no partial graph.
    if(draft){
        canvasMutationPlanDrafts([draft],{
            anchor:point ? {kind:'point',x:point.x,y:point.y,attachment:'left-middle'}
                : {kind:'source',sourceNodeIds:sourceIds},
            relation:'downstream',arrangement:'single'
        });
    }
    canvasMutationHistory('capture');
    if(draft){
        nodes.push(draft);
        canvasMutationFinalizePlacement([draft]);
    }
    target.inputNodeIds = [...new Set([...(target.inputNodeIds || []),...missing.map(node => node.id)])];
    canvas.connections = [...(canvas.connections || []),...connections];
    canvasMutationApplySelection(target);
    canvasMutationHistory('commit');
    render();
    if(draft && !point) canvasMutationReveal([draft],{reveal:true});
    canvasMutationPersistenceModule.save?.();
    return {target,changed:true};
}
function canvasMutationDisconnect(options={}){
    if(!canvas || !Array.isArray(canvas.connections)) return false;
    let indexes = [];
    if(options.nodeIds?.length){
        const ids = new Set(options.nodeIds);
        const mode = options.mode || 'all';
        indexes = canvas.connections.map((connection, index) => {
            if(mode === 'input') return ids.has(connection.to) ? index : -1;
            if(mode === 'output') return ids.has(connection.from) ? index : -1;
            return ids.has(connection.from) || ids.has(connection.to)
                ? index
                : -1;
        }).filter(index => index >= 0);
    } else {
        indexes = (
            Array.isArray(options.indexes)
                ? options.indexes
                : String(options.indexes || '').split(',')
        ).map(value => Number(value))
            .filter(index =>
                Number.isInteger(index)
                && index >= 0
                && index < canvas.connections.length
            );
    }
    const indexSet = new Set(indexes);
    const removed = canvas.connections.filter(
        (_connection, index) => indexSet.has(index)
    );
    if(!removed.length) return false;
    if(!options.skipUndo) canvasMutationHistory('push');
    canvas.connections = canvas.connections.filter(
        (_connection, index) => !indexSet.has(index)
    );
    removed.forEach(connection => {
        const toNode = nodes.find(node => node.id === connection.to);
        if(toNode && Array.isArray(toNode.inputNodeIds)){
            toNode.inputNodeIds = toNode.inputNodeIds.filter(
                id => id !== connection.from
            );
        }
        if(toNode && ['input','flow'].includes(connection.kind || 'flow')){
            clearDetachedRunInputRefs(toNode);
        }
        if((connection.kind || 'flow') === 'history'){
            const group = nodes.find(node =>
                node.id === connection.to
                && isHistoryGroupNode(node)
                && node.historyFor === connection.from
            );
            demoteHistoryGroupNode(group);
        }
    });
    if(options.render !== false) render();
    if(options.save !== false) canvasMutationPersistenceModule.schedule();
    return true;
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
const canvasMutationApi = {
    history(options={}){
        return canvasMutationHistory(options.action || 'push',options);
    },
    create({kind='image',data={},options={}}={}){
        return canvasMutationCreate(kind, data, options);
    },
    createBatch(options={}){
        return canvasMutationCreateBatch(options);
    },
    update({nodeId='',mutate,options={}}={}){
        return canvasMutationUpdate(nodeId, mutate, options);
    },
    arrange(options={}){
        return canvasMutationArrange(options);
    },
    duplicate(options={}){
        return canvasMutationDuplicate(options);
    },
    remove({nodeIds=[],options={}}={}){
        return canvasMutationRemove(nodeIds, options);
    },
    connect(options={}){
        return canvasMutationConnect(options);
    },
    connectSources(options={}){
        return canvasMutationConnectSources(options);
    },
    disconnect(options={}){
        return canvasMutationDisconnect(options);
    }
};
Object.defineProperty(canvasMutationApi,'placementIntent',{
    enumerable:false,
    value:({nodeId=''}={}) => {
        const placement=canvasMutationPlacements.get(String(nodeId));
        if(!placement) return null;
        const {frameUpdates,...intent}=placement;
        return JSON.parse(JSON.stringify(intent));
    }
});
window.SmartCanvasModules.canvasMutation = Object.freeze(canvasMutationApi);
