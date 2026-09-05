/*
 * Smart Canvas Generation Output Module
 *
 * Owns Generation Output normalization, stable identity, Pending Node creation,
 * and result application. The apply Interface accepts one strategy:
 * replace, append, loop, pending, queued, task or archive.
 */
const generationOutputPendingModule = window.SmartCanvasModules?.generationPending;
if(!generationOutputPendingModule) throw new Error('Pending Node Module failed to load');
const generationOutputMutationModule = window.SmartCanvasModules?.canvasMutation;
if(!generationOutputMutationModule) throw new Error('Canvas Mutation Module failed to load');
const GENERATION_OUTPUT_GALLERY_MIGRATION_VERSION = 2;
const GENERATION_OUTPUT_INFO_KEYS = Object.freeze([
    'runSettings',
    'runModelPrompt',
    'runPrompt',
    'runInputRefs',
    'runPromptRefs',
    'generationInputSnapshot',
    'promptDraftHtml',
    'promptDraftText',
    'sourceNodeId',
    'runAt',
    'runStartedAt',
    'runFinishedAt',
    'runElapsedMs',
    'runTimerHidden',
    'outputKind',
    'referenceGenerationKind'
]);
const GENERATION_OUTPUT_GALLERY_STATE_KEYS = Object.freeze([
    'activeOutputId',
    'hasNewGenerationOutput',
    'generationBatchAutoSelectedOutputId',
    'generationBatchId',
    'generationBatchLayout',
    'generationBatchSourceNodeId',
    'generationSlotIndex',
    'generationSlotCount',
    'pending',
    'running',
    'queued',
    'pendingTasks',
    'jimengPending',
    'generationOperationId',
    'generationRunFeedback',
    'generationPreviousPresentation',
    '_runMetaTargetId',
    '_selectAfterRunId'
]);

function generationOutputClonePersistentValue(value){
    if(value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}
function generationOutputCopyInfo(source,target){
    GENERATION_OUTPUT_INFO_KEYS.forEach(key => {
        if(!Object.prototype.hasOwnProperty.call(source || {},key)) return;
        const value = generationOutputClonePersistentValue(source[key]);
        if(value !== undefined) target[key] = value;
    });
    return target;
}
function generationOutputClearGalleryState(node){
    GENERATION_OUTPUT_GALLERY_STATE_KEYS.forEach(key => delete node[key]);
    return node;
}

function generationOutputConnectionsFrom(node, kinds=['input']){
    if(!node) return [];
    const allowed = new Set(kinds);
    return (canvas?.connections || []).filter(connection =>
        connection.from === node.id
        && allowed.has(connection.kind || 'flow')
    );
}
function generationOutputCaptureMediaDisplaySize(node){
    return typeof generationOutputMediaDisplaySize === 'function'
        ? generationOutputMediaDisplaySize(node)
        : null;
}
function generationOutputPreserveMediaDisplaySize(node,size){
    return typeof preserveGenerationOutputMediaDisplaySize === 'function'
        ? preserveGenerationOutputMediaDisplaySize(node,size)
        : false;
}
function generationOutputIncomingConnections(node){
    if(!node?.id) return [];
    const incoming = (canvas?.connections || [])
        .filter(connection =>
            connection.to === node.id
            && ['input','flow'].includes(connection.kind || 'flow')
        )
        .map(connection => ({...connection}));
    const keys = new Set(incoming.map(connection =>
        `${connection.from}|${connection.kind || 'flow'}`
    ));
    (node.inputNodeIds || []).forEach(from => {
        const key = `${from}|input`;
        if(!from || keys.has(key)) return;
        keys.add(key);
        incoming.push({from,to:node.id,kind:'input'});
    });
    return incoming;
}
function generationOutputIncomingAnchor(sourceNode, incomingConnections=[]){
    const sourceNodeIds = [...new Set(incomingConnections.map(connection=>connection.from)
        .filter(id=>id!==sourceNode.id && nodes.some(node=>node.id===id)))];
    return sourceNodeIds.length ? {kind:'source',sourceNodeIds,sourceNodeId:sourceNodeIds[0]}
        : {kind:'source',sourceNodeId:sourceNode.id};
}
function generationOutputCloneIncomingConnections(incomingConnections=[], outputs=[]){
    return outputs.flatMap(output => incomingConnections.map(connection => ({
        ...connection,
        fromId:connection.from,
        toId:output.id,
        exact:true
    })));
}
function generationOutputAddExactConnection(connection){
    const from = String(connection?.fromId || connection?.from || '');
    const to = String(connection?.toId || connection?.to || '');
    const kind = String(connection?.kind || 'flow');
    if(!from || !to || from === to) return false;
    canvas.connections = canvas.connections || [];
    if(canvas.connections.some(item =>
        item.from === from
        && item.to === to
        && (item.kind || 'flow') === kind
    )) return false;
    const exact = {...connection,from,to,kind};
    delete exact.fromId;
    delete exact.toId;
    delete exact.input;
    delete exact.exact;
    canvas.connections.push(exact);
    if(kind === 'input'){
        const target = nodes.find(node => node.id === to);
        if(target){
            target.inputNodeIds = Array.from(new Set([
                ...(target.inputNodeIds || []),from
            ]));
        }
    }
    return true;
}
function generationOutputReferenceKind(node, preferredKind=''){
    return [
        preferredKind,
        node?.referenceGenerationKind,
        node?.outputKind,
        node?.generationInputSnapshot?.settings?.apiKind,
        node?.runSettings?.apiKind,
        ...(node?.images || []).map(item => item?.kind)
    ].map(kind => String(kind || '')).find(kind =>
        ['image','video'].includes(kind)
    ) || '';
}
function generationOutputHasReliableReferenceEvidence(node){
    if(!node || node.generationOutputNode !== true) return false;
    return Boolean(
        ['image','video'].includes(String(node.referenceGenerationKind || ''))
        || ['image','video'].includes(String(node.outputKind || ''))
        || node.generationBatchId
        || node.generationOperationId
        || (node.images || []).some(item => item?.generatedResult === true)
    );
}
function generationOutputEnsureReferenceKind(node, preferredKind=''){
    if(!node || node.generationOutputNode !== true) return '';
    const kind = generationOutputReferenceKind(node, preferredKind);
    if(kind) node.referenceGenerationKind = kind;
    return kind;
}
function generationOutputRepairReferenceKind(node){
    return generationOutputHasReliableReferenceEvidence(node)
        ? generationOutputEnsureReferenceKind(node)
        : '';
}
function generationOutputParallelReferenceKind(sourceNode, outputKind='image'){
    return generationOutputReferenceKind(sourceNode, outputKind);
}
function generationOutputBatchAnchor(sourceNode){
    return generationOutputIncomingAnchor(sourceNode,generationOutputIncomingConnections(sourceNode));
}
function generationOutputCreatePendingBatch(sourceNode, expectedCount, meta, options={}){
    if(!sourceNode) return [];
    const count = Math.max(2,Math.min(8,Number(expectedCount) || 1));
    const reuseSource = options.reuseSource === true;
    const reusedSnapshot = reuseSource ? generationOutputClonePersistentValue(sourceNode) : null;
    const pendingBox = pendingBoxSize(1, {
        sourceNode,
        refs:options.refs || meta?.promptRefs || [],
        settings:meta?.settings || options.settings || null
    });
    const generationBatchId = options.generationBatchId || uid('generation-batch');
    const generationBatchLayout = options.batchLayout === 'vertical'
        ? 'vertical'
        : options.batchLayout === 'horizontal'
            ? 'horizontal'
            : typeof smartGenerationBatchLayout !== 'undefined'
                && smartGenerationBatchLayout === 'vertical'
                ? 'vertical'
                : 'horizontal';
    const generationBatchSourceNodeId = String(
        options.generationBatchSourceNodeId || sourceNode.id
    );
    const createdAt = Date.now();
    const inheritSourceConnections = options.inheritSourceConnections === true;
    const createParallelOutputs = reuseSource || inheritSourceConnections;
    const parallelReferenceKind = generationOutputParallelReferenceKind(
        sourceNode,
        options.outputKind
    );
    const incomingConnections = createParallelOutputs
        ? generationOutputIncomingConnections(sourceNode)
        : [];
    const outputs = Array.from({length:count}, (_,slotIndex) => {
        const output = reuseSource && slotIndex === 0
            ? sourceNode
            : {
                id:uid('smart'),
                type:'smart-image',
                x:0,
                y:0,
                created_at:createdAt + slotIndex
            };
        Object.assign(output, {
            title:'Image',
            generationOutputNode:true,
            generationBatchId,
            generationBatchLayout,
            generationBatchSourceNodeId,
            generationSlotIndex:slotIndex,
            generationSlotCount:count,
            outputKind:options.outputKind || 'image',
            images:[],
            pending:1,
            runStartedAt:nowMs(),
            runTimerHidden:false,
            w:pendingBox.w,
            h:pendingBox.h,
            generationMediaW:pendingBox.w,
            generationMediaH:pendingBox.h,
            generationStableOuterSize:true,
            scale:MEDIA_NODE_DEFAULT_SCALE
        });
        if(parallelReferenceKind) output.referenceGenerationKind = parallelReferenceKind;
        output._selectAfterRunId = options.selectOutput
            ? output.id
            : sourceNode.id;
        let outputMeta = meta;
        if(reuseSource) outputMeta = {...meta,sourceNodeId:output.id};
        else if(options.stripInputMeta) outputMeta = stripRunInputMeta(meta);
        attachRunMeta(output, outputMeta);
        return output;
    });
    const connectionTargets = reuseSource ? outputs.slice(1) : outputs;
    const hasParallelConnections = createParallelOutputs && incomingConnections.length > 0;
    try {
        generationOutputMutationModule.createBatch({
            drafts:outputs,
            intent:{
                ...(options.placementViewport ? {viewport:options.placementViewport} : {}),
                anchor:generationOutputBatchAnchor(sourceNode),
                relation:'downstream',
                arrangement:`${generationBatchLayout}-batch`
            },
            connections:hasParallelConnections
                ? generationOutputCloneIncomingConnections(
                    incomingConnections,
                    connectionTargets
                )
                : options.connectSource === null
                ? []
                : connectionTargets.map(output => ({
                    fromId:sourceNode.id,
                    toId:output.id,
                    ...(options.connectSource === false ? {kind:'flow'} : {input:true})
                })),
            options:{
                skipUndo:true,
                select:false,
                render:false,
                save:false,
                ...(reuseSource ? {existingNodeIds:[sourceNode.id]} : {})
            }
        });
    } catch(error){
        if(reusedSnapshot){
            Object.keys(sourceNode).forEach(key=>delete sourceNode[key]);
            Object.assign(sourceNode,reusedSnapshot);
        }
        throw error;
    }
    selectedId = sourceNode.id;
    selectedImage = {nodeId:'',index:-1};
    return outputs;
}
function generationOutputCreatePending(sourceNode, expectedCount, meta, options={}){
    if(!sourceNode) return null;
    const displayWidth = Number(options.displaySize?.width || options.displaySize?.w);
    const displayHeight = Number(options.displaySize?.height || options.displaySize?.h);
    const pendingBox = Number.isFinite(displayWidth)
        && displayWidth > 24
        && Number.isFinite(displayHeight)
        && displayHeight > 24
        ? {w:Math.round(displayWidth),h:Math.round(displayHeight)}
        : pendingBoxSize(expectedCount, {
            sourceNode,
            refs:options.refs || meta?.promptRefs || [],
            settings:meta?.settings || options.settings || null
        });
    const output = {
        id:uid('smart'),
        type:'smart-image',
        x:0,
        y:0,
        title:'Image',
        generationOutputNode:true,
        outputKind:options.outputKind || 'image',
        images:[],
        pending:Math.max(1, Number(expectedCount) || 1),
        runStartedAt:nowMs(),
        runTimerHidden:false,
        w:pendingBox.w,
        h:pendingBox.h,
        generationMediaW:pendingBox.w,
        generationMediaH:pendingBox.h,
        generationStableOuterSize:true,
        scale:MEDIA_NODE_DEFAULT_SCALE,
        created_at:Date.now()
    };
    const inheritSourceConnections = options.inheritSourceConnections === true;
    const incomingConnections = inheritSourceConnections
        ? generationOutputIncomingConnections(sourceNode)
        : [];
    const parallelReferenceKind = generationOutputParallelReferenceKind(
        sourceNode,
        options.outputKind
    );
    if(parallelReferenceKind) output.referenceGenerationKind = parallelReferenceKind;
    output._selectAfterRunId = options.selectOutput ? output.id : sourceNode.id;
    const placement = {
        ...(options.placementViewport ? {viewport:options.placementViewport} : {}),
        anchor:generationOutputBatchAnchor(sourceNode),
        relation:'downstream',
        arrangement:'single'
    };
    if(incomingConnections.length){
        generationOutputMutationModule.createBatch({
            drafts:[output],
            intent:placement,
            connections:generationOutputCloneIncomingConnections(
                incomingConnections,
                [output]
            ),
            options:{
                skipUndo:true,
                select:false,
                render:false,
                save:false
            }
        });
    } else {
        generationOutputMutationModule.create({
            kind:'prepared',
            data:{node:output},
            options:{
                skipUndo:true,
                select:false,
                render:false,
                save:false,
                placement
            }
        });
    }
    if(!incomingConnections.length && options.connectSource === null){
        // Parallel generation from a root node stays visually adjacent without
        // inventing a source relationship between two independent runs.
    } else if(!incomingConnections.length && options.connectSource === false){
        generationOutputMutationModule.connect({
            fromId:sourceNode.id,
            toId:output.id,
            kind:'flow'
        });
    } else if(!incomingConnections.length){
        generationOutputMutationModule.connect({
            fromId:sourceNode.id,
            toId:output.id,
            input:true
        });
    }
    attachRunMeta(
        output,
        options.stripInputMeta ? stripRunInputMeta(meta) : meta
    );
    selectedId = sourceNode.id;
    selectedImage = {nodeId:'', index:-1};
    return output;
}
function generationOutputTitle(kind='image', count=1){
    if(Number(count) > 1){
        if(kind === 'video') return 'Videos';
        if(kind === 'audio') return 'Audios';
        if(kind === 'text') return 'Texts';
        return 'Group';
    }
    if(kind === 'video') return 'Video';
    if(kind === 'audio') return 'Audio';
    if(kind === 'text') return 'Text';
    if(kind === 'file') return 'File';
    return 'Image';
}
function generationOutputArtifactKey(item){
    if(!item?.url) return '';
    return `${item.kind || 'image'}|${String(item.url)}`;
}
function generationOutputIdentity(item=null){
    const key = generationOutputArtifactKey(item);
    if(!key) return uid('output');
    let hash = 2166136261;
    for(let index = 0; index < key.length; index++){
        hash ^= key.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `output-${(hash >>> 0).toString(36)}`;
}
function generationOutputWithIdentity(item){
    if(!item || !item.url) return null;
    return {
        ...item,
        outputId:String(item.outputId || item.generationOutputId || generationOutputIdentity(item))
    };
}
function generationOutputClean(items=[]){
    const seen = new Set();
    return (items || [])
        .filter(item => item?.url && !item.loopInputPreview)
        .map(item => generationOutputWithIdentity(
            stripImageGenerationMeta({...item})
        ))
        .filter(item => {
            const key = generationOutputArtifactKey(item);
            if(seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}
function generationOutputEnsureNodeState(node){
    if(!node) return null;
    const activeArtifactKey = generationOutputArtifactKey(
        (node.images || []).find(item => item?.outputId === node.activeOutputId)
    );
    node.images = generationOutputClean(node.images || []);
    const ids = new Set(node.images.map(item => item.outputId));
    if(!ids.has(node.activeOutputId)){
        node.activeOutputId = (
            activeArtifactKey
                ? node.images.find(item => generationOutputArtifactKey(item) === activeArtifactKey)?.outputId
                : ''
        ) || node.images[0]?.outputId || '';
    }
    if(!node.activeOutputId) delete node.activeOutputId;
    return node;
}
function generationOutputActive(node){
    generationOutputEnsureNodeState(node);
    return (node?.images || []).find(
        item => item.outputId === node.activeOutputId
    ) || node?.images?.[0] || null;
}
function generationOutputSubmissionSnapshot(node){
    generationOutputEnsureNodeState(node);
    return Object.freeze({
        nodeId:String(node?.id || ''),
        activeOutputId:String(node?.activeOutputId || ''),
        outputCount:Array.isArray(node?.images) ? node.images.length : 0
    });
}
function generationOutputReferenceBelongsToNode(ref, node){
    if(!ref || !node) return false;
    if(ref.nodeId && String(ref.nodeId) === String(node.id || '')) return true;
    const outputId = String(ref.outputId || '');
    if(outputId && (node.images || []).some(
        item => String(item?.outputId || '') === outputId
    )){
        return true;
    }
    if(ref.inputInstanceId || outputId || ref.nodeId) return false;
    return Boolean(ref.url && (node.images || []).some(
        item => item?.url === ref.url
    ));
}
function generationOutputDuplicateRecipeRefs(source){
    const stored = ['recipeSourceRefs','runInputRefs','runPromptRefs']
        .map(key => Array.isArray(source?.[key])
            ? source[key].filter(ref => ref?.url)
            : [])
        .find(refs => refs.length) || [];
    const storedOnlyReferencesOwnOutput = stored.length > 0
        && stored.every(ref => generationOutputReferenceBelongsToNode(ref, source));
    let connected = [];
    if(!stored.length || storedOnlyReferencesOwnOutput){
        if(typeof activeInputImagesFor === 'function'){
            connected = activeInputImagesFor(source).filter(ref => ref?.url);
        } else if(typeof inputImagesFor === 'function'){
            connected = inputImagesFor(source).filter(ref => ref?.url);
        }
    }
    const selected = connected.length ? connected : stored;
    const seen = new Set();
    return selected.filter(ref => {
        const key = ref.inputInstanceId
            ? `instance|${ref.inputInstanceId}`
            : ref.outputId
            ? `output|${ref.outputId}`
            : ref.nodeId && Number.isFinite(Number(ref.imageIndex))
                ? `node|${ref.nodeId}|${Number(ref.imageIndex)}`
                : `url|${ref.url}`;
        if(seen.has(key)) return false;
        seen.add(key);
        return true;
    }).map(ref => ({...ref}));
}
function generationOutputPrepareDuplicate(source, copy){
    if(!copy) return copy;
    generationOutputEnsureNodeState(source);
    const active = generationOutputActive(source);
    const duplicatedActive = active
        ? {...active, outputId:generationOutputIdentity()}
        : null;
    if(duplicatedActive){
        delete duplicatedActive.inputInstanceId;
        delete duplicatedActive.instance_id;
    }
    copy.images = duplicatedActive ? [duplicatedActive] : [];
    copy.activeOutputId = copy.images[0]?.outputId || '';
    if(!copy.activeOutputId) delete copy.activeOutputId;
    const recipeRefs = generationOutputDuplicateRecipeRefs(source);
    copy.recipeSourceRefs = recipeRefs.map(ref => ({...ref}));
    if(recipeRefs.length){
        copy.runInputRefs = recipeRefs.map(ref => ({...ref}));
        if(Array.isArray(copy.runPromptRefs)){
            copy.runPromptRefs = recipeRefs.map(ref => ({...ref}));
        }
    }
    copy.copiedGenerationRecipe = Boolean(
        copy.recipeSourceRefs.length
        || copy.runPrompt
        || copy.runModelPrompt
        || copy.runSettings
    );
    delete copy.hasNewGenerationOutput;
    return copy;
}
function generationOutputMigrateLegacyGroups(){
    if(!Array.isArray(nodes) || !canvas) return false;
    const legacyGroups = nodes.filter(group =>
        isHistoryGroupNode(group)
        && group.historyFor
        && (canvas.connections || []).some(connection =>
            connection.from === group.historyFor
            && connection.to === group.id
            && (connection.kind || 'flow') === 'history'
        )
    );
    if(!legacyGroups.length) return false;
    legacyGroups.forEach(group => {
        const owner = nodes.find(node => node.id === group.historyFor);
        if(!owner) return;
        generationOutputEnsureNodeState(owner);
        generationOutputEnsureNodeState(group);
        const migrated = [
            ...(group.images || []).slice().reverse(),
            ...(owner.images || [])
        ];
        owner.images = generationOutputClean(migrated);
        if(!owner.activeOutputId){
            owner.activeOutputId = owner.images.at(-1)?.outputId || '';
        }
        const byLegacyIndex = (group.images || []).map(item =>
            owner.images.find(candidate => candidate.outputId === item.outputId)
        );
        const legacyActiveOutputId = generationOutputActive(group)?.outputId || '';
        nodes.forEach(node => {
            for(const key of ['runInputRefs','runPromptRefs','manualInputRefs','recipeSourceRefs']){
                if(!Array.isArray(node?.[key])) continue;
                node[key] = node[key].map(ref => {
                    if(ref?.nodeId !== group.id) return ref;
                    const target = byLegacyIndex[Number(ref.imageIndex) || 0];
                    const imageIndex = Math.max(0, owner.images.findIndex(
                        item => item.outputId === target?.outputId
                    ));
                    return {
                        ...ref,
                        nodeId:owner.id,
                        imageIndex,
                        outputId:target?.outputId || ''
                    };
                });
            }
        });
        canvas.connections = (canvas.connections || [])
            .filter(connection => !(
                connection.from === owner.id
                && connection.to === group.id
                && (connection.kind || 'flow') === 'history'
            ))
            .map(connection => {
                const fromLegacyGroup = connection.from === group.id;
                return {
                    ...connection,
                    from:fromLegacyGroup ? owner.id : connection.from,
                    to:connection.to === group.id ? owner.id : connection.to,
                    ...(fromLegacyGroup
                        ? {sourceOutputId:String(
                            connection.sourceOutputId || legacyActiveOutputId
                        )}
                        : {})
                };
            })
            .filter(connection => connection.from !== connection.to);
    });
    const legacyIds = new Set(legacyGroups.map(group => group.id));
    nodes = nodes.filter(node => !legacyIds.has(node.id));
    canvas.nodes = nodes;
    return true;
}
function generationOutputSplitReferenceOwners(source, ownerByOutputId){
    nodes.forEach(node => {
        for(const key of ['runInputRefs','runPromptRefs','manualInputRefs','recipeSourceRefs']){
            if(!Array.isArray(node?.[key])) continue;
            node[key] = node[key].map(ref => {
                const outputId = String(ref?.outputId || '');
                const owner = outputId ? ownerByOutputId.get(outputId) : null;
                if(!owner || owner.id === source.id) return ref;
                if(ref?.nodeId && String(ref.nodeId) !== String(source.id)) return ref;
                return {...ref,nodeId:owner.id,imageIndex:0};
            });
        }
    });
}
function generationOutputSplitCompletedImages(source, options={}){
    if(!source || !isSmartImageNode(source) || source.generationOutputNode !== true){
        return [source].filter(Boolean);
    }
    generationOutputEnsureReferenceKind(source, 'image');
    generationOutputEnsureNodeState(source);
    const images = (source.images || []).filter(image => image?.url);
    if(images.length <= 1 || String(source.outputKind || images[0]?.kind || 'image') !== 'image'){
        return [source];
    }
    const incomingConnections = generationOutputIncomingConnections(source);
    const retainedOutputId = String(
        options.retainedOutputId || source.activeOutputId || images[0]?.outputId || ''
    );
    const retainedIndex = Math.max(0,images.findIndex(image =>
        String(image?.outputId || '') === retainedOutputId
    ));
    const retained = images[retainedIndex] || images[0];
    const splitImages = images
        .map((image,index) => ({image,index}))
        .filter(item => item.index !== retainedIndex);
    const batchId = String(source.generationBatchId || uid('generation-batch'));
    const batchLayout = options.batchLayout === 'vertical'
        ? 'vertical'
        : options.batchLayout === 'horizontal'
            ? 'horizontal'
            : source.generationBatchLayout === 'vertical'
                ? 'vertical'
                : source.generationBatchLayout === 'horizontal'
                    ? 'horizontal'
                    : typeof smartGenerationBatchLayout !== 'undefined'
                        && smartGenerationBatchLayout === 'vertical'
                        ? 'vertical'
                        : 'horizontal';
    const anchor = generationOutputIncomingAnchor(source, incomingConnections);
    const batchSourceNodeId = String(
        source.generationBatchSourceNodeId
        || source.sourceNodeId
        || anchor.sourceNodeId
        || source.id
    );
    const createdAt = Number(source.created_at || Date.now());
    const drafts = splitImages.map(({image,index}) => generationOutputCopyInfo(
        source,
        {
            id:uid('smart'),
            type:'smart-image',
            x:0,
            y:0,
            title:generationOutputTitle('image',1),
            images:[{...image}],
            generationOutputNode:true,
            generationBatchId:batchId,
            generationBatchLayout:batchLayout,
            generationBatchSourceNodeId:batchSourceNodeId,
            generationSlotIndex:index,
            generationSlotCount:images.length,
            outputKind:'image',
            scale:MEDIA_NODE_DEFAULT_SCALE,
            created_at:createdAt + index + 1
        }
    ));
    source.images = [{...retained}];
    source.title = generationOutputTitle('image',1);
    generationOutputClearGalleryState(source);
    Object.assign(source, {
        generationBatchId:batchId,
        generationBatchLayout:batchLayout,
        generationBatchSourceNodeId:batchSourceNodeId,
        generationSlotIndex:retainedIndex,
        generationSlotCount:images.length,
        outputKind:'image'
    });
    generationOutputEnsureReferenceKind(source, 'image');
    generationOutputMutationModule.createBatch({
        drafts,
        intent:{
            anchor:generationOutputBatchAnchor(source),
            relation:'downstream',
            arrangement:`${batchLayout}-batch`
        },
        connections:generationOutputCloneIncomingConnections(
            incomingConnections,
            drafts
        ),
        options:{
            skipUndo:true,
            select:false,
            render:false,
            save:false
        }
    });
    const owners = [source,...drafts];
    const ownerByOutputId = new Map(owners.map(node => [
        String(node.images[0]?.outputId || ''),node
    ]).filter(([outputId]) => outputId));
    canvas.connections = (canvas.connections || []).map(connection => {
        if(connection.from !== source.id || !connection.sourceOutputId) return connection;
        const owner = ownerByOutputId.get(String(connection.sourceOutputId));
        return owner && owner.id !== source.id
            ? {...connection,from:owner.id}
            : connection;
    });
    generationOutputSplitReferenceOwners(source, ownerByOutputId);
    if(selectedImage?.nodeId === source.id){
        const selectedOutput = images[Number(selectedImage.index) || 0];
        const owner = ownerByOutputId.get(String(selectedOutput?.outputId || ''));
        if(owner) selectedImage = {nodeId:owner.id,index:0};
    }
    return owners;
}
function generationOutputLegacySplitFingerprint(node){
    const runAt = Number(node?.runAt || 0);
    if(!runAt) return '';
    return JSON.stringify([
        runAt,
        String(node.runModelPrompt || ''),
        String(node.runPrompt || ''),
        node.runSettings || null,
        node.generationInputSnapshot || null
    ]);
}
function generationOutputRepairLegacySplitBatches(){
    const candidates = nodes.filter(node =>
        isSmartImageNode(node)
        && node.generationOutputNode === true
        && !node.generationBatchId
        && (node.images || []).filter(image => image?.url).length === 1
        && generationOutputLegacySplitFingerprint(node)
    );
    const groups = new Map();
    candidates.forEach(node => {
        const fingerprint = generationOutputLegacySplitFingerprint(node);
        if(!groups.has(fingerprint)) groups.set(fingerprint,[]);
        groups.get(fingerprint).push(node);
    });
    let changed = false;
    groups.forEach(group => {
        if(group.length < 2 || group.length > 8) return;
        const ordered = group.slice().sort((left,right) =>
            Number(left.created_at || 0) - Number(right.created_at || 0)
            || String(left.id).localeCompare(String(right.id))
        );
        const created = ordered.map(node => Number(node.created_at || 0));
        if(!created.every(value => value > 0)
            || Math.max(...created) - Math.min(...created) > 8){
            return;
        }
        const connected = ordered.filter(node =>
            generationOutputIncomingConnections(node).length > 0
        );
        if(connected.length !== 1) return;
        const source = connected[0];
        const incomingConnections = generationOutputIncomingConnections(source);
        const batchId = uid('generation-batch');
        const anchor = generationOutputIncomingAnchor(source,incomingConnections);
        const batchSourceNodeId = String(
            source.sourceNodeId || anchor.sourceNodeId || source.id
        );
        ordered.forEach((node,index) => Object.assign(node, {
            generationBatchId:batchId,
            generationBatchLayout:'vertical',
            generationBatchSourceNodeId:batchSourceNodeId,
            generationSlotIndex:index,
            generationSlotCount:ordered.length
        }));
        generationOutputCloneIncomingConnections(
            incomingConnections,
            ordered.filter(node => node.id !== source.id)
        ).forEach(generationOutputAddExactConnection);
        const ownerByOutputId = new Map(ordered.map(node => [
            String(node.images[0]?.outputId || ''),node
        ]).filter(([outputId]) => outputId));
        canvas.connections = (canvas.connections || []).map(connection => {
            if(connection.from !== source.id || !connection.sourceOutputId) return connection;
            const owner = ownerByOutputId.get(String(connection.sourceOutputId));
            return owner && owner.id !== source.id
                ? {...connection,from:owner.id}
                : connection;
        });
        generationOutputSplitReferenceOwners(source,ownerByOutputId);
        changed = true;
    });
    return changed;
}
function generationOutputMigrateLegacyGalleries(){
    if(!Array.isArray(nodes) || !canvas) return false;
    const currentVersion = Number(
        canvas.migrationVersions?.generationOutputGallerySplit || 0
    );
    if(currentVersion >= GENERATION_OUTPUT_GALLERY_MIGRATION_VERSION){
        return false;
    }
    let changed = generationOutputRepairLegacySplitBatches();
    const candidates = nodes.filter(node =>
        isSmartImageNode(node)
        && node.generationOutputNode === true
        && Array.isArray(node.images)
        && node.images.filter(image => image?.url).length > 1
    );
    candidates.forEach(source => {
        generationOutputSplitCompletedImages(source, {
            retainedOutputId:String(source.activeOutputId || ''),
            batchLayout:source.generationBatchLayout || 'vertical'
        });
        changed = true;
    });
    canvas.nodes = nodes;
    canvas.migrationVersions = {
        ...(canvas.migrationVersions || {}),
        generationOutputGallerySplit:GENERATION_OUTPUT_GALLERY_MIGRATION_VERSION
    };
    return changed || currentVersion < GENERATION_OUTPUT_GALLERY_MIGRATION_VERSION;
}
function generationOutputNormalize(outputs=[], kind='image', options={}){
    const generatedResult = options.generatedResult !== false;
    const defaultName = options.defaultName !== false;
    const extension = kind === 'video'
        ? 'mp4'
        : kind === 'audio'
            ? 'mp3'
            : kind === 'text'
                ? 'txt'
                : 'png';
    const mediaItems = resultMediaUrls(outputs);
    return generationOutputClean(mediaItems.map((item, index) => {
        const source = typeof item === 'object' && item ? item : {};
        const url = typeof item === 'string' ? item : source.url || '';
        const itemKind = source.kind || kind;
        const normalized = {
            url,
            kind:itemKind
        };
        normalized.outputId = String(
            source.outputId
            || source.generationOutputId
            || generationOutputIdentity(normalized)
        );
        const name = source.name
            || (defaultName ? `output-${index + 1}.${extension}` : '');
        if(name) normalized.name = name;
        if(generatedResult) normalized.generatedResult = true;
        return stripImageGenerationMeta(
            copyMediaSizeFields(source, normalized)
        );
    }).filter(item => item.url));
}
function generationOutputReplace(node, outputs, kind='image', meta=null, options={}){
    if(!node || !outputs?.length) return [];
    node = liveSmartNode(node);
    const existing = generationOutputClean(node.images || []);
    const mediaDisplaySize = existing.length
        ? generationOutputCaptureMediaDisplaySize(node)
        : null;
    const next = generationOutputClean(outputs);
    if(!next.length) return [];
    if(existing.length && next.some(item => item.generatedResult)){
        const additions = generationOutputAppend(
            node,
            next,
            kind,
            {skipShift:Boolean(options.skipShift)}
        );
        if(meta) attachRunMeta(node, meta);
        return additions;
    }
    node.images = next;
    node.generationOutputNode = true;
    node.activeOutputId = next[0]?.outputId || '';
    delete node.hasNewGenerationOutput;
    markSmartNodeComplete(node, meta);
    node.outputKind = kind;
    generationOutputEnsureReferenceKind(node, kind);
    node.title = generationOutputTitle(kind, node.images.length);
    node.scale = node.images.length > 1
        ? MEDIA_GROUP_DEFAULT_SCALE
        : MEDIA_NODE_DEFAULT_SCALE;
    delete node.w;
    delete node.h;
    generationOutputPreserveMediaDisplaySize(node,mediaDisplaySize);
    if(meta) attachRunMeta(node, meta);
    selectedImage = {nodeId:'', index:-1};
    return next;
}
function generationOutputAppend(node, outputs, kind='image', options={}){
    if(!node || !outputs?.length) return [];
    node = liveSmartNode(node);
    const existing = generationOutputClean(node.images || []);
    const mediaDisplaySize = existing.length
        ? generationOutputCaptureMediaDisplaySize(node)
        : null;
    generationOutputEnsureNodeState(node);
    const activeBefore = node.activeOutputId || '';
    const seen = new Set(existing.map(item => generationOutputArtifactKey(item)));
    const next = generationOutputClean(outputs).filter(item => {
        const key = generationOutputArtifactKey(item);
        if(seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    if(!next.length) return [];
    node.images = [...existing, ...next];
    node.generationOutputNode = true;
    const submittedActive = options.submissionSnapshot?.activeOutputId ?? null;
    const submittedCount = Number(options.submissionSnapshot?.outputCount ?? -1);
    if(!existing.length){
        node.activeOutputId = next[0]?.outputId || '';
    } else if(submittedActive !== null
        && activeBefore === submittedActive
        && existing.length === submittedCount){
        node.activeOutputId = next[0]?.outputId || activeBefore;
        delete node.hasNewGenerationOutput;
    } else if(submittedActive !== null){
        node.activeOutputId = activeBefore;
        node.hasNewGenerationOutput = true;
    }
    markSmartNodeComplete(node);
    node.outputKind = kind;
    generationOutputEnsureReferenceKind(node, kind);
    node.title = generationOutputTitle(kind, node.images.length);
    delete node.w;
    delete node.h;
    generationOutputPreserveMediaDisplaySize(node,mediaDisplaySize);
    return next;
}
function generationOutputAppendLoop(node, outputs, kind='image', context=null){
    if(!node || !outputs?.length) return [];
    return generationOutputAppend(node, outputs, kind, {skipShift:true});
}
function generationOutputCompletePending(node, outputs, kind='image', meta=null){
    if(!node) return [];
    node = liveSmartNode(node);
    const afterRunSelection = node._selectAfterRunId || node.id;
    const mediaDisplaySize = (node.images || []).length
        ? generationOutputCaptureMediaDisplaySize(node)
        : null;
    const normalized = generationOutputClean(outputs);
    node.images = normalized;
    if(normalized.length) node.generationOutputNode = true;
    markSmartNodeComplete(node, meta);
    node.outputKind = kind;
    generationOutputEnsureReferenceKind(node, kind);
    node.title = generationOutputTitle(kind, normalized.length);
    node.scale = mediaNodeDefaultScale(node);
    delete node.w;
    delete node.h;
    generationOutputPreserveMediaDisplaySize(node,mediaDisplaySize);
    const metaTarget = node._runMetaTargetId
        ? nodes.find(candidate => candidate.id === node._runMetaTargetId)
        : node;
    if(metaTarget) attachRunMeta(metaTarget, meta);
    node.images = (node.images || []).map(item =>
        stripImageGenerationMeta(item)
    );
    generationOutputSplitCompletedImages(node);
    clearSourceBusyStateIfDownstreamDone(
        nodes.find(candidate => candidate.id === meta?.sourceNodeId)
    );
    if(!selectedId || selectedId === node.id){
        selectedId = afterRunSelection;
    }
    delete node._runMetaTargetId;
    delete node._selectAfterRunId;
    if(activeComposerSubject?.id && selectedId === activeComposerSubject.id){
        lastComposerNodeId = `${selectedId}:node`;
    }
    selectedImage = {nodeId:'', index:-1};
    return normalized;
}
function generationOutputApplyPendingTransition(node, event){
    if(!node) return null;
    const next = generationOutputPendingModule.transition(
        generationOutputPendingModule.snapshot(node),
        event
    );
    generationOutputPendingModule.keys.forEach(key => {
        if(Object.prototype.hasOwnProperty.call(next, key)) node[key] = next[key];
        else delete node[key];
    });
    return node;
}
function generationOutputCompleteQueued(node, outputs, kind='image', submissionSnapshot=null){
    const additions = generationOutputAppend(
        node,
        outputs,
        kind,
        {skipShift:true, submissionSnapshot}
    );
    generationOutputApplyPendingTransition(node, {
        type:'queue-succeeded',
        now:nowMs()
    });
    generationOutputSplitCompletedImages(node);
    return additions;
}
function generationOutputCompleteTask(node, taskId, outputs, kind='image'){
    if(!node || !taskId) return [];
    const currentNode = (nodes || []).find(candidate => candidate.id === node.id);
    if(node.generationBatchId && !currentNode) return [];
    if(currentNode) node = currentNode;
    node.images = generationOutputClean(node.images || []);
    generationOutputEnsureNodeState(node);
    const mediaDisplaySize = node.images.length
        ? generationOutputCaptureMediaDisplaySize(node)
        : null;
    const task = generationOutputPendingModule.tasks(node).find(
        candidate => candidate.taskId === taskId
    );
    const submissionSnapshot = task?.submissionSnapshot || null;
    const activeBefore = node.activeOutputId || '';
    const existingCount = node.images.length;
    const seen = new Set(node.images.map(item => generationOutputArtifactKey(item)));
    const additions = generationOutputClean(outputs).filter(item => {
        const key = generationOutputArtifactKey(item);
        if(!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    generationOutputApplyPendingTransition(node, {
        type:'task-succeeded',
        taskId,
        outputs:additions,
        kind,
        now:nowMs()
    });
    generationOutputEnsureNodeState(node);
    if(additions.length) node.generationOutputNode = true;
    if(additions.length) generationOutputEnsureReferenceKind(node, kind);
    if(existingCount && additions.length){
        const submittedActive = submissionSnapshot?.activeOutputId ?? null;
        const submittedCount = Number(submissionSnapshot?.outputCount ?? -1);
        const autoSelected = String(node.generationBatchAutoSelectedOutputId || '');
        if(submittedActive !== null
            && activeBefore === submittedActive
            && existingCount === submittedCount){
            node.activeOutputId = additions[0]?.outputId || activeBefore;
            node.generationBatchAutoSelectedOutputId = node.activeOutputId;
            delete node.hasNewGenerationOutput;
        } else if(autoSelected && activeBefore === autoSelected){
            node.activeOutputId = activeBefore;
            delete node.hasNewGenerationOutput;
        } else {
            node.activeOutputId = activeBefore;
            node.hasNewGenerationOutput = true;
        }
    }
    if(!node.pending && generationOutputPendingModule.tasks(node).length === 0){
        delete node.generationBatchAutoSelectedOutputId;
        delete node.w;
        delete node.h;
        // Choose the scale from the final single-image or unsplit media contents.
        generationOutputSplitCompletedImages(node);
        node.title = generationOutputTitle(kind, node.images.length);
        if(node.images.length > 1
            && (
                !Number.isFinite(Number(node.scale))
                || Number(node.scale) === MEDIA_NODE_DEFAULT_SCALE
                || Number(node.scale) === MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE
            )){
            node.scale = MEDIA_GROUP_DEFAULT_SCALE;
        } else {
            node.scale = mediaNodeDefaultScale(node);
        }
    }
    generationOutputPreserveMediaDisplaySize(node,mediaDisplaySize);
    return additions;
}
function generationOutputApply(options={}){
    const node = options.node || null;
    const kind = options.kind || 'image';
    const strategy = options.strategy || 'replace';
    if(strategy === 'archive'){
        return generationOutputClean(node?.images || []);
    }
    const normalized = generationOutputNormalize(
        options.outputs || [],
        kind,
        {
            generatedResult:options.generatedResult,
            defaultName:options.defaultName
        }
    );
    if(strategy === 'replace'){
        return generationOutputReplace(
            node,
            normalized,
            kind,
            options.meta || null,
            {skipShift:Boolean(options.skipShift)}
        );
    }
    if(strategy === 'append'){
        return generationOutputAppend(
            node,
            normalized,
            kind,
            {
                skipShift:Boolean(options.skipShift),
                submissionSnapshot:options.submissionSnapshot || null
            }
        );
    }
    if(strategy === 'loop'){
        return generationOutputAppendLoop(
            node,
            normalized,
            kind,
            options.context || null
        );
    }
    if(strategy === 'pending'){
        return generationOutputCompletePending(
            node,
            normalized,
            kind,
            options.meta || null
        );
    }
    if(strategy === 'queued'){
        return generationOutputCompleteQueued(
            node,
            normalized,
            kind,
            options.submissionSnapshot || null
        );
    }
    if(strategy === 'task'){
        return generationOutputCompleteTask(
            node,
            options.taskId || '',
            normalized,
            kind
        );
    }
    throw new Error(`Unsupported Generation Output strategy: ${strategy}`);
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.generationOutput = Object.freeze({
    sourceAnchor({sourceNode}={}){
        return generationOutputBatchAnchor(sourceNode);
    },
    ensureNodeState({node=null}={}){
        return generationOutputEnsureNodeState(node);
    },
    repairReferenceKind({node=null}={}){
        return generationOutputRepairReferenceKind(node);
    },
    active({node=null}={}){
        const active = generationOutputActive(node);
        return active ? {...active} : null;
    },
    select({node=null,outputId=''}={}){
        generationOutputEnsureNodeState(node);
        if(!node?.images?.some(item => item.outputId === outputId)) return false;
        node.activeOutputId = outputId;
        delete node.hasNewGenerationOutput;
        return true;
    },
    submissionSnapshot({node=null}={}){
        return generationOutputSubmissionSnapshot(node);
    },
    prepareDuplicate({source=null,copy=null}={}){
        return generationOutputPrepareDuplicate(source, copy);
    },
    migrateLegacyGroups(){
        return generationOutputMigrateLegacyGroups();
    },
    migrateLegacyGalleries(){
        return generationOutputMigrateLegacyGalleries();
    },
    createPending({
        sourceNode=null,
        placementViewport=null,
        expectedCount=1,
        meta=null,
        connectSource=true,
        selectOutput=false,
        refs=[],
        settings=null,
        displaySize=null,
        outputKind='image',
        stripInputMeta=false,
        inheritSourceConnections=false
    }={}){
        return generationOutputCreatePending(
            sourceNode,
            expectedCount,
            meta,
            {
                placementViewport,
                connectSource,
                selectOutput,
                refs,
                settings,
                displaySize,
                outputKind,
                stripInputMeta,
                inheritSourceConnections
            }
        );
    },
    createPendingBatch({
        sourceNode=null,
        placementViewport=null,
        expectedCount=2,
        meta=null,
        connectSource=true,
        selectOutput=false,
        refs=[],
        settings=null,
        outputKind='image',
        stripInputMeta=false,
        generationBatchId='',
        batchLayout='',
        generationBatchSourceNodeId='',
        reuseSource=false,
        inheritSourceConnections=false
    }={}){
        return generationOutputCreatePendingBatch(
            sourceNode,
            expectedCount,
            meta,
            {
                placementViewport,
                connectSource,
                selectOutput,
                refs,
                settings,
                outputKind,
                stripInputMeta,
                generationBatchId,
                batchLayout,
                generationBatchSourceNodeId,
                reuseSource,
                inheritSourceConnections
            }
        );
    },
    normalize({
        outputs=[],
        kind='image',
        generatedResult=true,
        defaultName=true
    }={}){
        return generationOutputNormalize(outputs, kind, {
            generatedResult,
            defaultName
        });
    },
    apply(options={}){
        return generationOutputApply(options);
    }
});
