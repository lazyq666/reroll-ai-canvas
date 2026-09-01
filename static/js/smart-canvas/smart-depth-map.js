/*
 * Smart Canvas Depth Map Module
 *
 * Owns the Image Studio action, nearby Pending Node creation and submission
 * into the durable Generation Run lifecycle.
 */
const smartDepthMapOutputModule = window.SmartCanvasModules?.generationOutput;
if(!smartDepthMapOutputModule) throw new Error('Generation Output Module failed to load');
const smartDepthMapPersistenceModule = window.SmartCanvasModules?.canvasPersistence;
if(!smartDepthMapPersistenceModule) throw new Error('Canvas Persistence Module failed to load');
const smartDepthMapMutationModule = window.SmartCanvasModules?.canvasMutation;
if(!smartDepthMapMutationModule) throw new Error('Canvas Mutation Module failed to load');
const smartDepthMapRecoveryModule = window.SmartCanvasModules?.generationRecovery;
if(!smartDepthMapRecoveryModule) throw new Error('Generation Recovery Module failed to load');
const smartDepthMapImageStudioModule = window.SmartCanvasModules?.imageStudio;
if(!smartDepthMapImageStudioModule) throw new Error('Image Studio Module failed to load');

const smartDepthMapFallbacks = Object.freeze({
    unavailable:'当前图片还不能生成深度图',
    offline:'实时连接恢复后即可生成深度图',
    duplicate:'这张图片已有深度图任务正在处理',
    preparing:'准备处理',
    queued:'等待本地处理',
    submitFailed:'深度图任务提交失败',
    syncFailed:'画布同步完成后才能启动深度图任务'
});
const smartDepthMapText = (key, fallbackName) => {
    const translated = window.StudioI18n?.t?.(key);
    return translated && translated !== key ? translated : smartDepthMapFallbacks[fallbackName];
};

function smartDepthMapJobActive(job){
    return Boolean(job?.active && !['completed','failed'].includes(String(job.phase || '')));
}
function smartDepthMapOperationId(){
    return [
        smartClientId || 'smart-client',
        'depth-map',
        Date.now().toString(36),
        Math.random().toString(36).slice(2,10)
    ].join(':');
}
function smartDepthMapExisting(sourceNodeId, imageIndex){
    return nodes.find(node => (
        node?.depthMapSourceNodeId === sourceNodeId
        && Number(node.depthMapSourceImageIndex || 0) === Number(imageIndex || 0)
        && smartDepthMapJobActive(node.imageProcessorJob)
    ));
}
function smartDepthMapSelectSource(sourceNodeId){
    selectedId = sourceNodeId;
    selectedIds = [];
    selectedImage = {nodeId:'', index:-1};
}
function smartDepthMapFailNode(node, error){
    if(!node) return;
    const message = String(error?.message || smartDepthMapText('smart.depthMapSubmitFailed', 'submitFailed')).slice(0,500);
    node.outputKind = 'depth-map';
    node.title = window.StudioI18n?.t?.('smart.depthMap') || 'Depth map';
    node.imageProcessorJob = {
        ...(node.imageProcessorJob || {}),
        active:false,
        phase:'failed',
        message,
        error:message,
        updatedAt:nowMs()
    };
    node.pending = 0;
    node.running = false;
    render();
    smartDepthMapPersistenceModule.schedule();
    if(!error?.smartGenerationLogged) toast(message.slice(0,160));
}
async function smartDepthMapRun(context=smartDepthMapImageStudioModule.current()){
    if(!context?.nodeId || context.kind !== 'image' || !context.sourceReady){
        toast(smartDepthMapText('smart.depthMapUnavailable', 'unavailable'));
        return null;
    }
    const sourceNode = nodes.find(node => node.id === context.nodeId);
    const imageIndex = Math.max(0, Number(context.imageIndex || 0));
    const sourceImage = imageForDisplay(sourceNode?.images?.[imageIndex]);
    if(!sourceNode || !sourceImage?.url || mediaKindForItem(sourceImage) !== 'image'){
        toast(smartDepthMapText('smart.depthMapUnavailable', 'unavailable'));
        return null;
    }
    smartDepthMapImageStudioModule.close();
    if(
        smartDepthMapPersistenceModule.online?.() === false
        || smartDepthMapPersistenceModule.editable?.() === false
    ){
        toast(smartDepthMapText('smart.depthMapOffline', 'offline'));
        return null;
    }
    const existing = smartDepthMapExisting(sourceNode.id, imageIndex);
    if(existing){
        smartDepthMapSelectSource(sourceNode.id);
        render();
        toast(smartDepthMapText('smart.depthMapDuplicate', 'duplicate'));
        return existing;
    }

    smartDepthMapMutationModule.history({action:'push'});
    const sourceRect = nodeRect(sourceNode);
    const output = smartDepthMapOutputModule.createPending({
        sourceNode,
        expectedCount:1,
        meta:null,
        connectSource:false,
        displaySize:{width:sourceRect.width, height:sourceRect.height},
        outputKind:'depth-map',
        stripInputMeta:true
    });
    const operationId = smartDepthMapOperationId();
    output.title = window.StudioI18n?.t?.('smart.depthMap') || 'Depth map';
    output.outputKind = 'depth-map';
    output.depthMapSourceNodeId = sourceNode.id;
    output.depthMapSourceImageIndex = imageIndex;
    output.generationOperationId = operationId;
    output.imageProcessorJob = {
        active:true,
        processorId:'depth-anything-v2-small',
        phase:'queued',
        progress:0,
        message:smartDepthMapText('smart.depthMapPreparing', 'preparing'),
        taskId:'',
        submittedAt:nowMs(),
        updatedAt:nowMs()
    };
    smartDepthMapSelectSource(sourceNode.id);
    render();
    smartDepthMapPersistenceModule.schedule();

    try {
        await smartDepthMapPersistenceModule.save();
        if(
            typeof smartDepthMapPersistenceModule.synced === 'function'
            && !await smartDepthMapPersistenceModule.synced({timeout:5000})
        ){
            throw new Error(smartDepthMapText('smart.depthMapSyncFailed', 'syncFailed'));
        }
        const response = await fetch('/api/smart-canvas/depth-map', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                canvas_id:canvasId,
                source_node_id:sourceNode.id,
                source_image_index:imageIndex,
                node_id:output.id,
                generation_operation_id:operationId,
                generation_request_index:0
            })
        });
        if(!response.ok){
            throw new Error(await responseErrorMessage(
                response,
                smartDepthMapText('smart.depthMapSubmitFailed', 'submitFailed')
            ));
        }
        const data = await response.json();
        const current = nodes.find(node => (
            node.id === output.id
            && node.generationOperationId === operationId
        ));
        if(!current) return null;
        const taskId = String(data.task_id || '');
        if(!taskId) throw new Error(smartDepthMapText('smart.depthMapSubmitFailed', 'submitFailed'));
        current.imageProcessorJob = {
            ...(current.imageProcessorJob || {}),
            active:true,
            taskId,
            phase:String(data.status || 'queued'),
            message:smartDepthMapText('smart.depthMapQueued', 'queued'),
            updatedAt:nowMs()
        };
        render();
        smartDepthMapPersistenceModule.schedule();
        const result = await smartDepthMapRecoveryModule.settle({
            node:current,
            submission:{
                state:'pending',
                kind:'image',
                tasks:[{
                    taskId,
                    kind:'image',
                    actorId:String(data.actor_id || '')
                }]
            }
        });
        const completed = nodes.find(node => node.id === output.id);
        if(completed && result?.state === 'completed'){
            completed.outputKind = 'depth-map';
            completed.title = window.StudioI18n?.t?.('smart.depthMap') || 'Depth map';
            delete completed.imageProcessorJob;
            render();
            smartDepthMapPersistenceModule.schedule();
        }
        return completed || null;
    } catch(error){
        smartDepthMapFailNode(
            nodes.find(node => node.id === output.id),
            error
        );
        return null;
    }
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.smartDepthMap = Object.freeze({
    run(context=null){
        return smartDepthMapRun(context || smartDepthMapImageStudioModule.current());
    },
    isActive({job=null,node=null}={}){
        return smartDepthMapJobActive(job || node?.imageProcessorJob);
    }
});
