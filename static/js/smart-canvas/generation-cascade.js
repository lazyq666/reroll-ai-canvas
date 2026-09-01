/*
 * Smart Canvas Smart Cascade Module
 *
 * Owns connected Node traversal, loop rounds, parallel scheduling, stop state
 * and connection progress. Individual Generation Runs are delegated through
 * the Generation Run Adapter exposed by the Generation Run Module.
 */
const cascadeSettingsModule = window.SmartCanvasModules?.generationSettings;
if(!cascadeSettingsModule) throw new Error('Generation Settings Module failed to load');
const cascadeRunAdapter = window.SmartCanvasModules?.generationRun?.cascadeAdapter;
if(!cascadeRunAdapter) throw new Error('Generation Run Adapter failed to load');
const generationCascadePersistenceModule = window.SmartCanvasModules?.canvasPersistence;
if(!generationCascadePersistenceModule) throw new Error('Canvas Persistence Module failed to load');
const generationCascadeMutationModule = window.SmartCanvasModules?.canvasMutation;
if(!generationCascadeMutationModule) throw new Error('Canvas Mutation Module failed to load');

const smartCascadeFallbacks = Object.freeze({
    'canvas.loopImageLabel':'循环图片 {n}',
    'canvas.imageNumber':'图{number}',
    'smart.stopping':'停止中...',
    'smart.stopRunning':'停止运行',
    'smart.loopStopped':'已停止批量运行',
    'smart.stopRequested':'已请求停止，当前任务完成后停止',
    'smart.selectChainTail':'请选择链路结尾图片节点',
    'smart.loopNoChain':'批量运行节点未连接可运行的图片链路',
    'smart.loopParallelRoundsDone':'已并发完成 {n} 个任务',
    'smart.loopRunRoundsDone':'已完成 {n} 个任务',
    'smart.loopRunDone':'批量运行完成',
    'smart.errRunFailed':'生成失败',
    'smart.loopNotFound':'没有找到批量运行节点',
    'smart.connectLoopDownstream':'请把批量运行节点连接到下游图片链路'
});
function smartCascadeText(key, values={}){
    const translated = typeof tr === 'function' ? tr(key) : window.StudioI18n?.t?.(key);
    const text = translated && translated !== key ? translated : (smartCascadeFallbacks[key] || key);
    return Object.entries(values).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), text);
}
function generationCascadeReferenceSnapshot(ref={}){
    return {
        url:ref?.url || '',
        name:ref?.name || '',
        nodeId:ref?.nodeId || '',
        imageIndex:ref?.imageIndex ?? '',
        outputId:ref?.outputId || '',
        inputInstanceId:ref?.inputInstanceId || '',
        kind:ref?.kind || '',
        role:ref?.role || ''
    };
}

let smartCascadeRunning = false;
let smartCascadeActiveLoopId = '';
let smartCascadeStopRequested = false;
let smartCascadeSilentSelection = false;
let smartCascadeRunPath = null;
const smartCascadeRuns = new Map();
let smartLoopContext = null;

function activeSmartCascadeCount(){ return smartCascadeRuns.size; }
function smartCascadeRunForLoop(loopId){ return loopId ? smartCascadeRuns.get(loopId) || null : null; }
function smartCascadeIsLoopRunning(loopId){ return Boolean(smartCascadeRunForLoop(loopId)); }
function syncSmartCascadeLegacyState(preferredLoopId=''){
    const activeIds = [...smartCascadeRuns.keys()];
    smartCascadeRunning = activeIds.length > 0;
    smartCascadeActiveLoopId = preferredLoopId && smartCascadeRuns.has(preferredLoopId)
        ? preferredLoopId
        : (activeIds[0] || '');
    const activeRun = smartCascadeActiveLoopId ? smartCascadeRuns.get(smartCascadeActiveLoopId) : null;
    smartCascadeStopRequested = Boolean(activeRun?.stopRequested);
    smartCascadeRunPath = activeRun?.runPath || null;
}
function smartCascadeAnyRunning(){ return smartCascadeRunning || activeSmartCascadeCount() > 0; }
function smartCascadeEdgeState(edgeKey){
    for(const run of smartCascadeRuns.values()){
        const state = run?.runPath?.states?.[edgeKey];
        if(state) return state;
    }
    return smartCascadeRunPath?.states?.[edgeKey] || '';
}
function smartCascadePathForCtx(ctx=null){
    return ctx?.runState?.runPath || ctx?.runPath || smartCascadeRunPath;
}
function loopOutputSlotsForRoot(rootNode){
    if(!rootNode?.id) return [];
    return downstreamNodesForId(rootNode.id)
        .filter(n => isSmartImageNode(n) && !isHistoryGroupNode(n))
        .sort((a, b) => {
            const ax = Number(a.x) || 0, bx = Number(b.x) || 0;
            if(ax !== bx) return ax - bx;
            return (Number(a.y) || 0) - (Number(b.y) || 0);
        });
}
function loopOutputSlotForRound(rootNode, loopNode, roundIndex, slotIndex){
    if(!rootNode?.id) return null;
    const candidates = loopOutputSlotsForRoot(rootNode)
        .filter(node => node.sourceNodeId === rootNode.id)
        .filter(node => !loopNode?.id || !node.loopSourceId || node.loopSourceId === loopNode.id);
    const untagged = candidates.filter(node => !Number.isFinite(Number(node.loopRoundIndex)) && !Number.isFinite(Number(node.loopSlotIndex)));
    return candidates.find(node => Number(node.loopRoundIndex) === Number(roundIndex))
        || candidates.find(node => Number(node.loopSlotIndex) === Number(slotIndex))
        || untagged[Math.max(0, Number(slotIndex) || 0)]
        || null;
}
function tagLoopOutputSlot(output, rootNode, loopNode, roundIndex, slotIndex){
    if(!output) return output;
    output.sourceNodeId = rootNode?.id || output.sourceNodeId || '';
    output.loopSourceId = loopNode?.id || output.loopSourceId || '';
    output.loopRootId = rootNode?.id || output.loopRootId || '';
    output.loopRoundIndex = Number(roundIndex) || 0;
    output.loopSlotIndex = Math.max(0, Number(slotIndex) || 0);
    return output;
}
function createLoopOutputSlot(rootNode, roundIndex, roundOffset=0, options={}){
    const rootRect = nodeRect(rootNode);
    const output = JSON.parse(JSON.stringify(rootNode));
    clearSmartNodeTransientRunState(output, {clearRunHistory:true});
    output.id = uid('smart');
    output.type = 'smart-image';
    output.x = 0;
    output.y = 0;
    output.title = `Image ${roundIndex}`;
    output.images = [];
    output.pending = options.pending ? Math.max(1, Number(options.pending) || 1) : 0;
    output.running = Boolean(options.pending);
    output.queued = Boolean(options.queued);
    if(options.pending){
        output.runStartedAt = nowMs();
        output.runTimerHidden = false;
    }
    output.created_at = Date.now();
    output.w = Math.max(1,Number(rootRect.width) || 260);
    output.h = Math.max(1,Number(rootRect.height) || 180);
    output.generationMediaW = output.w;
    output.generationMediaH = output.h;
    delete output.historyFor;
    delete output.isHistoryGroup;
    delete output.sourceNodeId;
    delete output.runAt;
    delete output.runPrompt;
    delete output.runModelPrompt;
    delete output.runPromptRefs;
    delete output.runInputRefs;
    delete output.runFinishedAt;
    delete output.runElapsedMs;
    output.inputNodeIds = [];
    delete output.blockedInputRefs;
    delete output.inputRefOrder;
    delete output.manualInputRefs;
    tagLoopOutputSlot(output, rootNode, options.loopNode || null, roundIndex, options.slotIndex ?? roundOffset);
    generationCascadeMutationModule.create({
        kind:'prepared',
        data:{node:output},
        options:{
            skipUndo:true,
            select:false,
            render:false,
            save:false,
            placement:{
                anchor:{kind:'source',sourceNodeId:rootNode.id},
                relation:'downstream',
                arrangement:'single'
            }
        }
    });
    generationCascadeMutationModule.connect({
        fromId:rootNode.id,
        toId:output.id,
        kind:'flow'
    });
    const runPath = smartCascadePathForCtx(options.ctx || options.runState);
    if(runPath?.states) runPath.states[`${rootNode.id}->${output.id}`] = 'wait';
    return output;
}
function finishLoopTargetPreviewState(node){
    if(!node) return;
    node = liveSmartNode(node);
    markSmartNodeComplete(node);
    if((node.images || []).some(img => img?.url)){
        node.title = node.images.length > 1 ? 'Group' : 'Image';
        node.scale = node.images.length > 1 ? MEDIA_GROUP_DEFAULT_SCALE : MEDIA_NODE_DEFAULT_SCALE;
        node.outputKind = mediaKindForUrls(node.images || [], (node.images || []).some(isVideoMediaItem) ? 'video' : 'image');
        delete node.w;
        delete node.h;
    }
}
function refsForDirectLoopRound(loopNode, loopIndex, total){
    if(!loopNode?.imageInput) return [];
    return outputImagesForNode(loopNode, true, {index:loopIndex, total, nodeId:loopNode.id})
        .filter(ref => ref?.url)
        .map((ref, index) => ({
            ...ref,
            role:ref.role || `image_${index + 1}`,
            name:ref.name || smartCascadeText('canvas.loopImageLabel', {n:loopIndex + index})
        }));
}
function showDirectLoopRoundPreview(loopNode, target, refs, loopIndex, total){
    if(!loopNode?.imageInput || !isSmartImageNode(target)) return false;
    const cleanRefs = (refs || []).filter(ref => ref?.url);
    if(!cleanRefs.length) return false;
    const mediaDisplaySize = typeof generationOutputMediaDisplaySize === 'function'
        ? generationOutputMediaDisplaySize(target)
        : null;
    const preview = cleanRefs.map((ref, index) => stripImageGenerationMeta({
        url:ref.url || '',
        name:ref.name || smartCascadeText('canvas.loopImageLabel', {n:loopIndex + index}),
        kind:ref.kind || (isVideoMediaItem(ref) ? 'video' : 'image'),
        nodeId:ref.nodeId || '',
        imageIndex:ref.imageIndex ?? '',
        loopInputPreview:true
    })).filter(ref => ref.url);
    if(!preview.length) return false;
    target.images = preview;
    target.pending = 0;
    target.running = true;
    target.runStartedAt = nowMs();
    delete target.runFinishedAt;
    delete target.runElapsedMs;
    target.runTimerHidden = false;
    target.runInputRefs = cleanRefs.map(generationCascadeReferenceSnapshot).filter(ref => ref.url);
    target.outputKind = mediaKindForUrls(preview, preview.some(isVideoMediaItem) ? 'video' : 'image');
    target.scale = preview.length > 1 ? MEDIA_GROUP_DEFAULT_SCALE : MEDIA_NODE_DEFAULT_SCALE;
    target.title = total > 1 ? `Image ${loopIndex}/${total}` : (target.title || 'Image');
    delete target.w;
    delete target.h;
    if(typeof preserveGenerationOutputMediaDisplaySize === 'function'){
        preserveGenerationOutputMediaDisplaySize(target,mediaDisplaySize);
    }
    render();
    return true;
}
function directImageInputsFor(node){
    const upstream = smartImageUsesWorkflowInput(node) ? workflowInputNodesFor(node) : inputNodesFor(node);
    return upstream
        .filter(n => isSmartImageNode(n) && !isHistoryGroupNode(n) && (n.images || []).some(img => img?.url))
        .sort((a, b) => {
            const ax = Number(a.x) || 0, bx = Number(b.x) || 0;
            if(ax !== bx) return bx - ax;
            return (Number(a.y) || 0) - (Number(b.y) || 0);
        });
}
function directImageInputsForKinds(node, kinds=['input']){
    const upstream = upstreamNodesForKinds(node, kinds);
    return upstream
        .filter(n => isSmartImageNode(n) && !isHistoryGroupNode(n) && (n.images || []).some(img => img?.url))
        .sort((a, b) => {
            const ax = Number(a.x) || 0, bx = Number(b.x) || 0;
            if(ax !== bx) return bx - ax;
            return (Number(a.y) || 0) - (Number(b.y) || 0);
        });
}
function primaryImageInputFor(node, options={}){
    const direct = options.includeFlow
        ? directImageInputsForKinds(node, ['input', 'flow'])[0]
        : directImageInputsFor(node)[0];
    if(direct) return direct;
    const inputs = options.includeFlow
        ? upstreamNodesForKinds(node, ['input', 'flow'])
        : (smartImageUsesWorkflowInput(node) ? workflowInputNodesFor(node) : inputNodesFor(node));
    const loop = inputs.find(n => n?.type === 'smart-loop');
    if(loop?.imageInput){
        const upstream = upstreamNodesForKinds(loop, options.includeFlow ? ['input', 'flow'] : ['input'])
            .find(n => isSmartImageNode(n) && (n.images || []).some(img => img?.url));
        if(upstream) return upstream;
    }
    return null;
}
function hasDownstreamImageNode(node){
    return downstreamNodesForId(node?.id).some(n => isSmartImageNode(n) && !isHistoryGroupNode(n));
}
function isGeneratedOutputForNode(sourceNode, targetNode){
    return Boolean(sourceNode?.id && targetNode?.sourceNodeId === sourceNode.id);
}
function downstreamWorkflowImageTargetsFor(node){
    return downstreamImageTargetsFor(node).filter(target => !isGeneratedOutputForNode(node, target));
}
function hasDownstreamWorkflowImageNode(node){
    return downstreamWorkflowImageTargetsFor(node).length > 0;
}
function smartImageChainTo(nodeId, options={}){
    const tail = nodes.find(n => n.id === nodeId);
    if(!isSmartImageNode(tail) || isHistoryGroupNode(tail)) return [];
    const chain = [];
    const seen = new Set();
    let cur = tail;
    while(cur && !seen.has(cur.id)){
        seen.add(cur.id);
        chain.unshift(cur);
        cur = primaryImageInputFor(cur, options);
    }
    return chain;
}
function upstreamNodesForId(nodeId, kinds=['input']){
    const result = [];
    const seen = new Set([nodeId]);
    const walk = id => {
        upstreamNodesForKinds(nodes.find(n => n.id === id), kinds).forEach(input => {
            if(seen.has(input.id)) return;
            seen.add(input.id);
            walk(input.id);
            result.push(input);
        });
    };
    walk(nodeId);
    return result;
}
function resolveSmartCascadeLoop(nodeId){
    const loops = upstreamNodesForId(nodeId, ['input', 'flow']).filter(n => n.type === 'smart-loop');
    if(!loops.length) return null;
    const loop = loops[loops.length - 1];
    return {node:loop, count:smartLoopCount(loop), mode:loop.mode === 'parallel' ? 'parallel' : 'serial'};
}
function relayLoopPromptNodesForEdge(sourceNode, targetNode){
    if(!sourceNode?.id || !targetNode?.id) return [];
    const directLoopIds = new Set(promptInputNodesFor(targetNode)
        .filter(n => n?.type === 'smart-loop' && n.showPrompt)
        .map(n => n.id));
    return inputNodesFor(sourceNode)
        .filter(n => n?.type === 'smart-loop' && n.showPrompt && !directLoopIds.has(n.id));
}
function relayLoopPromptNodesForTarget(node){
    if(!node?.id) return [];
    return inputNodesFor(node).filter(n => n?.type === 'smart-loop' && n.showPrompt);
}
function downstreamNodesForId(nodeId){
    const result = [];
    const seen = new Set([nodeId]);
    const walk = id => {
        (canvas?.connections || [])
            .filter(conn => conn.from === id && ['input','flow'].includes(conn.kind || 'flow'))
            .map(conn => nodes.find(n => n.id === conn.to))
            .filter(Boolean)
            .forEach(next => {
                if(seen.has(next.id)) return;
                seen.add(next.id);
                result.push(next);
                walk(next.id);
            });
    };
    walk(nodeId);
    return result;
}
function downstreamImageTargetsFor(node){
    if(!node?.id) return [];
    return (canvas?.connections || [])
        .filter(conn => conn.from === node.id && ['input','flow'].includes(conn.kind || 'flow'))
        .map(conn => nodes.find(n => n.id === conn.to))
        .filter(n => isSmartImageNode(n) && !isHistoryGroupNode(n))
        .sort((a, b) => {
            const ax = Number(a.x) || 0, bx = Number(b.x) || 0;
            if(ax !== bx) return ax - bx;
            return (Number(a.y) || 0) - (Number(b.y) || 0);
        });
}
function downstreamCascadeTargetsFor(node){
    if(!node?.id) return [];
    return (canvas?.connections || [])
        .filter(conn => conn.from === node.id && ['input','flow'].includes(conn.kind || 'flow'))
        .map(conn => nodes.find(n => n.id === conn.to))
        .filter(n => n && !isHistoryGroupNode(n) && (isSmartImageNode(n) || n.type === 'smart-loop'))
        .sort((a, b) => {
            const ax = Number(a.x) || 0, bx = Number(b.x) || 0;
            if(ax !== bx) return ax - bx;
            return (Number(a.y) || 0) - (Number(b.y) || 0);
        });
}
function directLoopRunTargets(loop){
    if(!loop?.id) return [];
    return downstreamImageTargetsFor(loop)
        .filter(node => !hasDownstreamWorkflowImageNode(node));
}
function smartCascadeGraphForTail(tail){
    const path = smartImageChainTo(tail?.id, {includeFlow:true})
        .filter(n => isSmartImageNode(n) && !isHistoryGroupNode(n));
    if(!path.length) return {root:null, path:[], edges:[], children:new Map()};
    const loop = resolveSmartCascadeLoop(tail?.id);
    const loopRoots = loop?.node?.id ? downstreamImageTargetsFor(loop.node) : [];
    const loopRoot = loopRoots.find(n => path.some(p => p.id === n.id));
    const root = loopRoot || path[0];
    const edges = [];
    const children = new Map();
    const seenEdges = new Set();
    const visiting = new Set();
    const walk = node => {
        if(!node?.id || visiting.has(node.id)) return;
        visiting.add(node.id);
        const targets = downstreamCascadeTargetsFor(node);
        children.set(node.id, targets);
        targets.forEach(target => {
            const key = `${node.id}->${target.id}`;
            if(!seenEdges.has(key)){
                seenEdges.add(key);
                edges.push({source:node, target, key});
            }
            walk(target);
        });
        visiting.delete(node.id);
    };
    walk(root);
    return {root, path, edges, children};
}
function cascadeTailForLoop(loopId){
    const loop = nodes.find(n => n.id === loopId && n.type === 'smart-loop');
    const directTargets = directLoopRunTargets(loop);
    if(directTargets.length) return directTargets[directTargets.length - 1];
    const directImages = downstreamImageTargetsFor({id:loopId});
    const directIds = new Set(directImages.map(n => n.id));
    const candidates = downstreamNodesForId(loopId)
        .filter(n => isSmartImageNode(n))
        .filter(n => !isHistoryGroupNode(n))
        .filter(n => canRunSmartCascade(n));
    if(!candidates.length) return null;
    return candidates.sort((a, b) => {
        const ad = directIds.has(a.id) ? 1 : 0;
        const bd = directIds.has(b.id) ? 1 : 0;
        if(ad !== bd) return ad - bd;
        const ax = Number(a.x) || 0, bx = Number(b.x) || 0;
        if(ax !== bx) return bx - ax;
        return (Number(b.y) || 0) - (Number(a.y) || 0);
    })[0];
}
function canRunSmartCascade(node){
    if(!isSmartImageNode(node) || isHistoryGroupNode(node)) return false;
    const graph = smartCascadeGraphForTail(node);
    const loop = resolveSmartCascadeLoop(node.id);
    if(loop && isDirectLoopTargetRun(loop, node, graph)) return true;
    if(hasDownstreamImageNode(node)) return false;
    if(graph.edges.length) return true;
    return Boolean(loop);
}
function isDirectLoopTargetRun(loop, tail, graph){
    if(!loop?.node?.id || !tail?.id) return false;
    if(graph?.root?.id !== tail.id) return false;
    if(hasDownstreamWorkflowImageNode(tail)) return false;
    return downstreamImageTargetsFor(loop.node).some(node => node.id === tail.id);
}
function cascadeConnectionKeys(){
    const keys = new Set();
    const addKey = (from, to) => {
        if(from && to) keys.add(`${from}->${to}`);
    };
    const activeLoopIds = new Set(smartCascadeRuns.keys());
    const loops = activeLoopIds.size
        ? nodes.filter(n => n?.type === 'smart-loop' && activeLoopIds.has(n.id))
        : nodes.filter(n => n?.type === 'smart-loop');
    loops.forEach(loop => {
        const tail = cascadeTailForLoop(loop.id);
        if(!tail) return;
        const graph = smartCascadeGraphForTail(tail);
        if(!graph.root) return;
        const chainIds = new Set(graph.path.map(n => n.id));
        graph.edges.forEach(edge => addKey(edge.source.id, edge.target.id));
        (canvas?.connections || []).forEach(conn => {
            if((conn.kind || 'flow') === 'history') return;
            const toNode = nodes.find(n => n.id === conn.to);
            if(conn.from === loop.id && (chainIds.has(conn.to) || downstreamNodesForId(conn.to).some(n => chainIds.has(n.id)))){
                addKey(conn.from, conn.to);
            }
            if(toNode && chainIds.has(toNode.id)){
                inputNodesFor(toNode)
                    .filter(n => n?.type === 'smart-loop' && n.showPrompt)
                    .forEach(inputLoop => addKey(inputLoop.id, toNode.id));
            }
        });
    });
    return keys;
}
function appendCascadeRefsToReceiver(node, refs, ctx=smartLoopContext){
    return cascadeRunAdapter.appendRefs({node, refs, context:ctx});
}
function cascadeRefsFromOutputs(outputs, targetNode){
    return (outputs || []).filter(img => img?.url).map((img, index) => ({
        url:img.url,
        name:img.name || smartCascadeText('canvas.imageNumber', {number: index + 1}),
        kind:img.kind || 'image',
        role:`image_${index + 1}`,
        nodeId:targetNode?.id || '',
        imageIndex:targetNode ? (targetNode.images || []).length - outputs.length + index : index
    }));
}
function smartCascadeStopText(stopping=false){
    return stopping ? smartCascadeText('smart.stopping') : smartCascadeText('smart.stopRunning');
}
function smartCascadeAbortError(){
    const err = new Error(smartCascadeText('smart.loopStopped'));
    err.smartCascadeStopped = true;
    return err;
}
function throwIfSmartCascadeStopRequested(runState=null){
    if(runState?.stopRequested || (!runState && smartCascadeStopRequested)) throw smartCascadeAbortError();
}
function requestSmartCascadeStop(loopId=''){
    const runState = loopId
        ? smartCascadeRunForLoop(loopId)
        : (smartCascadeRuns.get(smartCascadeActiveLoopId) || [...smartCascadeRuns.values()][0] || null);
    if(runState){
        if(runState.stopRequested) return;
        runState.stopRequested = true;
        syncSmartCascadeLegacyState(runState.runKey || runState.loopId || loopId);
    } else {
        if(!smartCascadeRunning || smartCascadeStopRequested) return;
        smartCascadeStopRequested = true;
    }
    toast(smartCascadeText('smart.stopRequested'));
    render();
}
function smartCascadeParallelLimit(chain=[]){
    const hasComfy = (chain || []).some(node => cascadeSettingsModule.forNode(node?.id || '')?.engine === 'comfy');
    return hasComfy ? Math.max(1, Math.min(6, Number(comfyInstanceCount) || 1)) : 6;
}
async function runSmartCascadeRoundsWithLimit(roundIndexes, limit, runner, runState=null){
    let next = 0;
    const workerCount = Math.max(1, Math.min(Number(limit) || 1, roundIndexes.length));
    const workers = Array.from({length:workerCount}, async () => {
        while(next < roundIndexes.length){
            if(runState?.stopRequested || (!runState && smartCascadeStopRequested)) break;
            const roundOffset = next++;
            const current = roundIndexes[roundOffset];
            try {
                await runner(current, roundOffset);
            } catch(e) {
                if(e?.smartCascadeStopped) break;
                throw e;
            }
        }
    });
    await Promise.all(workers);
}
async function runSmartCascade(targetNode=null){
    const tail = targetNode || window.SmartCanvasModules.viewportSelection.selection.node();
    if(!canRunSmartCascade(tail)){ toast(smartCascadeText('smart.selectChainTail')); return; }
    savePromptDraftForCurrent();
    const graph = smartCascadeGraphForTail(tail);
    const chain = graph.path;
    const loop = resolveSmartCascadeLoop(tail.id);
    const loopId = loop?.node?.id || '';
    if(loopId && smartCascadeIsLoopRunning(loopId)){ requestSmartCascadeStop(loopId); return; }
    if(!loopId && smartCascadeAnyRunning()){ requestSmartCascadeStop(); return; }
    const directLoopTargetRun = Boolean(loop && isDirectLoopTargetRun(loop, tail, graph));
    const singleNodeLoopRun = Boolean(loop && (chain.length === 1 || directLoopTargetRun));
    if(!graph.edges.length && !singleNodeLoopRun){ toast(smartCascadeText('smart.loopNoChain')); return; }
    const originalSelected = selectedId;
    const originalPromptHtml = promptInput.innerHTML;
    const runKey = loopId || `cascade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const runState = {runKey, loopId, stopRequested:false, runPath:null};
    smartCascadeRuns.set(runKey, runState);
    syncSmartCascadeLegacyState(runKey);
    smartCascadeSilentSelection = true;
    runBtn.disabled = true;
    generationCascadeMutationModule.history({action:'push'});
    const totalRounds = loop?.count || 1;
    const startIndex = Math.max(1, Number(loop?.node?.loopStart) || 1);
    const batchSize = loop?.node?.imageInput ? Math.max(1, Math.min(100, Number(loop.node.imageBatchSize) || 1)) : 1;
    const endIndex = startIndex + (totalRounds - 1) * batchSize;
    const loopMode = loop?.mode === 'parallel' ? 'parallel' : 'serial';
    const parallelLimit = loopMode === 'parallel' && totalRounds > 1 ? smartCascadeParallelLimit(chain) : 1;
    const precreateSingleSlots = singleNodeLoopRun && loopMode === 'parallel' && totalRounds > 1 && parallelLimit > 1;
    let singleLoopSlots = [];
    if(singleNodeLoopRun){
        runState.runPath = {states:{}};
        smartCascadeRunPath = runState.runPath;
        singleLoopSlots = Array.from({length:totalRounds}, (_, round) => {
            const loopIndex = startIndex + round * batchSize;
            const slot = loopOutputSlotForRound(tail, loop.node, loopIndex, round);
            return slot ? tagLoopOutputSlot(slot, tail, loop.node, loopIndex, round) : null;
        });
        singleLoopSlots.filter(Boolean).forEach(slot => {
            runState.runPath.states[`${tail.id}->${slot.id}`] = 'wait';
        });
        if(precreateSingleSlots){
            for(let slotOffset = 0; slotOffset < totalRounds; slotOffset++){
                if(singleLoopSlots[slotOffset]) continue;
                const loopIndex = startIndex + slotOffset * batchSize;
                singleLoopSlots[slotOffset] = createLoopOutputSlot(tail, loopIndex, slotOffset, {
                    queued:true,
                    loopNode:loop.node,
                    slotIndex:slotOffset,
                    runState
                });
            }
        }
        render();
    }
    if(!singleNodeLoopRun){
        const runStates = {};
        if(loop?.node?.id && graph.root?.id) runStates[`${loop.node.id}->${graph.root.id}`] = 'wait';
        graph.edges.forEach(edge => { runStates[edge.key] = 'wait'; });
        runState.runPath = {states:runStates};
        smartCascadeRunPath = runState.runPath;
        scheduleConnectionLayerRefresh();
        updateComposer();
    }
    try {
        const runRound = async (loopIndex=startIndex, options={}) => {
            throwIfSmartCascadeStopRequested(runState);
            const ctx = loop
                ? {
                    index:loopIndex,
                    total:endIndex,
                    nodeId:loop.node.id,
                    forceWorkflow:chain.length > 1 && !singleNodeLoopRun,
                    runState,
                    roundOutputs:new Map()
                }
                : {runState, roundOutputs:new Map()};
            if(parallelLimit === 1) smartLoopContext = ctx;
            if(singleNodeLoopRun){
                const refs = refsForDirectLoopRound(loop.node, loopIndex, endIndex);
                if(directLoopTargetRun && parallelLimit === 1){
                    showDirectLoopRoundPreview(loop.node, tail, refs, loopIndex, endIndex);
                }
                const slotIndex = Math.max(0, Math.floor((loopIndex - startIndex) / batchSize));
                const outputTarget = tagLoopOutputSlot(
                    options.outputTarget
                        || singleLoopSlots[slotIndex]
                        || loopOutputSlotForRound(tail, loop.node, loopIndex, slotIndex)
                        || createLoopOutputSlot(tail, loopIndex, slotIndex, {
                            loopNode:loop.node,
                            slotIndex,
                            runState
                        }),
                    tail,
                    loop.node,
                    loopIndex,
                    slotIndex
                );
                singleLoopSlots[slotIndex] = outputTarget;
                await cascadeRunAdapter.executeLoopRound({
                    loopNode:loop.node,
                    rootNode:tail,
                    outputSlot:outputTarget,
                    loopIndex,
                    context:ctx
                });
                return;
            }
            const producedRefs = new Map();
            const runBranch = async (source, incomingRefs=[]) => {
                throwIfSmartCascadeStopRequested(runState);
                let targets = graph.children.get(source.id) || [];
                const loopPrompts = isSmartImageNode(source) ? upstreamLoopPromptNodesFor(source) : [];
                const sourceLoopPrompts = isSmartImageNode(source) ? relayLoopPromptNodesForTarget(source) : [];
                if(runState.runPath && sourceLoopPrompts.length && source?.id){
                    sourceLoopPrompts.forEach(loopNode => {
                        runState.runPath.states[`${loopNode.id}->${source.id}`] = 'done';
                    });
                    scheduleConnectionLayerRefresh();
                }
                if(loopPrompts.length && targets.length > 1){
                    const firstLoop = loopPrompts[0];
                    const startBase = Math.max(1, Number(firstLoop.loopStart) || 1);
                    const currentIndex = Math.max(1, Number(ctx?.index || startBase) || startBase);
                    const selectedTarget = targets[(currentIndex - 1) % targets.length];
                    if(runState.runPath && firstLoop?.id && source?.id){
                        runState.runPath.states[`${firstLoop.id}->${source.id}`] = 'done';
                        scheduleConnectionLayerRefresh();
                    }
                    targets = [selectedTarget].filter(Boolean);
                }
                let sharedRefs = incomingRefs;
                for(let index = 0; index < targets.length; index++){
                    throwIfSmartCascadeStopRequested(runState);
                    const target = targets[index];
                    const edgeKey = `${source.id}->${target.id}`;
                    let outputs = [];
                    const targetChildren = (graph.children.get(target.id) || [])
                        .filter(child => child && child.type !== 'smart-loop');
                    const targetIsLeaf = target.type !== 'smart-loop' && targetChildren.length === 0;
                    const relayLoops = isSmartImageNode(source) && isSmartImageNode(target)
                        ? relayLoopPromptNodesForEdge(source, target)
                        : [];
                    const stepCtx = relayLoops.length && isSmartImageNode(target)
                        ? {
                            ...(ctx || {}),
                            appendLoopOutputs:Boolean(ctx?.nodeId && targetIsLeaf),
                            relayPromptNodeIds:[
                                ...new Set([...(ctx?.relayPromptNodeIds || []), ...relayLoops.map(n => n.id)])
                            ]
                        }
                        : {...(ctx || {}), appendLoopOutputs:Boolean(ctx?.nodeId && targetIsLeaf)};
                    try {
                        if(runState.runPath && relayLoops.length && source?.id && isSmartImageNode(target)){
                            relayLoops.forEach(loopNode => {
                                runState.runPath.states[`${loopNode.id}->${source.id}`] = 'done';
                            });
                            scheduleConnectionLayerRefresh();
                        }
                        if(runState.runPath){
                            runState.runPath.states[edgeKey] = 'active';
                            scheduleConnectionLayerRefresh();
                        }
                        if(target.type === 'smart-loop'){
                            outputs = outputImagesForNode(source, true, ctx).filter(img => img?.url);
                            sharedRefs = cascadeRefsFromOutputs(outputs, source);
                        } else if(index === 0){
                            outputs = await cascadeRunAdapter.executeStep({
                                sourceNode:source,
                                targetNode:target,
                                inputRefs:incomingRefs,
                                context:stepCtx
                            });
                            sharedRefs = cascadeRefsFromOutputs(outputs, target);
                        } else {
                            outputs = appendCascadeRefsToReceiver(target, sharedRefs, stepCtx);
                        }
                    } catch(err) {
                        if(/缺少提示词|需要输入文本|need prompt/i.test(err.message || '') && incomingRefs.length){
                            outputs = appendCascadeRefsToReceiver(target, incomingRefs, stepCtx);
                            if(index === 0) sharedRefs = cascadeRefsFromOutputs(outputs, target);
                        } else {
                            throw err;
                        }
                    }
                    if(runState.runPath){
                        runState.runPath.states[edgeKey] = 'done';
                        scheduleConnectionLayerRefresh();
                    }
                    const refs = target.type === 'smart-loop'
                        ? sharedRefs
                        : (index === 0 ? sharedRefs : cascadeRefsFromOutputs(outputs, target));
                    producedRefs.set(target.id, refs);
                    throwIfSmartCascadeStopRequested(runState);
                    await runBranch(target, refs);
                }
            };
            const rootRefs = defaultReferenceImagesFor(graph.root, true, ctx).filter(img => img?.url);
            producedRefs.set(graph.root.id, rootRefs);
            await runBranch(graph.root, rootRefs);
        };
        const roundIndexes = Array.from({length:totalRounds}, (_, round) => startIndex + round * batchSize);
        if(loopMode === 'parallel' && totalRounds > 1){
            const parallelTargets = singleNodeLoopRun ? singleLoopSlots : [];
            if(parallelTargets.length) render();
            await runSmartCascadeRoundsWithLimit(roundIndexes, parallelLimit, (loopIndex, roundOffset) => {
                const outputTarget = parallelTargets[roundOffset] || null;
                return runRound(loopIndex, {outputTarget});
            }, runState);
        } else {
            for(const loopIndex of roundIndexes){
                throwIfSmartCascadeStopRequested(runState);
                await runRound(loopIndex);
            }
        }
        throwIfSmartCascadeStopRequested(runState);
        if(parallelLimit === 1) smartLoopContext = null;
        selectedId = '';
        selectedIds = [];
        selectedImage = {nodeId:'', index:-1};
        activeComposerSubject = null;
        lastComposerNodeId = '';
        composer.classList.remove('open');
        promptInput.innerHTML = originalPromptHtml;
        generationCascadePersistenceModule.schedule();
        toast(
            totalRounds > 1
                ? smartCascadeText(loopMode === 'parallel' ? 'smart.loopParallelRoundsDone' : 'smart.loopRunRoundsDone', {n:totalRounds})
                : smartCascadeText('smart.loopRunDone'),
            {tone:'success'},
        );
    } catch(e) {
        if(parallelLimit === 1) smartLoopContext = null;
        selectedId = originalSelected;
        promptInput.innerHTML = originalPromptHtml;
        if(!e?.smartGenerationLogged){
            const stopped = Boolean(e?.smartCascadeStopped);
            toast(
                stopped ? smartCascadeText('smart.loopStopped') : (e.message || smartCascadeText('smart.errRunFailed')).slice(0, 160),
                {tone:stopped ? 'neutral' : 'danger'},
            );
        }
    } finally {
        smartCascadeRuns.delete(runKey);
        syncSmartCascadeLegacyState();
        smartCascadeSilentSelection = false;
        syncRunButtonState();
        if(directLoopTargetRun) finishLoopTargetPreviewState(tail);
        generationCascadePersistenceModule.schedule();
        render();
    }
}
function runSmartCascadeFromLoop(loopId){
    const loop = nodes.find(n => n.id === loopId && n.type === 'smart-loop');
    if(!loop){ toast(smartCascadeText('smart.loopNotFound')); return; }
    const tail = cascadeTailForLoop(loop.id);
    if(!tail){ toast(smartCascadeText('smart.connectLoopDownstream')); return; }
    selectedId = tail.id;
    selectedIds = [];
    selectedImage = {nodeId:'', index:-1};
    return runSmartCascade(tail);
}
function smartCascadeStatus({nodeId='', node=null, connectionKeys=[]}={}){
    const target = node || (nodeId ? nodes.find(item => item.id === nodeId) : null);
    const resolvedLoop = target?.type === 'smart-loop'
        ? target
        : ((target?.id || nodeId) ? resolveSmartCascadeLoop(target?.id || nodeId)?.node : null);
    const loopId = resolvedLoop?.id || '';
    const loopRun = loopId ? smartCascadeRunForLoop(loopId) : null;
    const connectionSet = cascadeConnectionKeys();
    return {
        loopId,
        loopRunning:Boolean(loopRun),
        loopStopping:Boolean(loopRun?.stopRequested),
        stopText:smartCascadeStopText(Boolean(loopRun?.stopRequested)),
        anyRunning:smartCascadeAnyRunning(),
        silentSelection:smartCascadeSilentSelection,
        activeConnectionCount:(smartCascadeRunPath?.states
            && Object.values(smartCascadeRunPath.states).filter(state => state && state !== 'done').length) || 0,
        cascadeConnectionKeys:[...connectionSet],
        connectionStates:(connectionKeys || []).map(key => smartCascadeEdgeState(key))
    };
}
function smartCascadeStop({loopId='', nodeId=''}={}){
    const target = nodeId ? nodes.find(item => item.id === nodeId) : null;
    const resolvedLoopId = loopId
        || (target?.type === 'smart-loop' ? target.id : resolveSmartCascadeLoop(target?.id || nodeId)?.node?.id)
        || '';
    return requestSmartCascadeStop(resolvedLoopId);
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.generationCascade = Object.freeze({
    run({nodeId='', node=null}={}){
        const target = node || (nodeId ? nodes.find(item => item.id === nodeId) : window.SmartCanvasModules.viewportSelection.selection.node());
        return runSmartCascadeFromLoop(nodeId || target?.id || '');
    },
    stop(options={}){
        return smartCascadeStop(options);
    },
    status(options={}){
        return smartCascadeStatus(options);
    },
    context(){
        return smartLoopContext;
    },
    noteManualSelection(){
        if(smartCascadeAnyRunning()) smartCascadeSilentSelection = false;
    }
});
