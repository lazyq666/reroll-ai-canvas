/*
 * Smart Canvas Smart Matting Module
 *
 * Owns Smart Matting submission, queue polling, page-load resume, failure
 * handling and Pending Node presentation.
 */
const smartMattingOutputModule = window.SmartCanvasModules?.generationOutput;
if(!smartMattingOutputModule) throw new Error('Generation Output Module failed to load');
const smartMattingPersistenceModule = window.SmartCanvasModules?.canvasPersistence;
if(!smartMattingPersistenceModule) throw new Error('Canvas Persistence Module failed to load');
const smartMattingMutationModule = window.SmartCanvasModules?.canvasMutation;
if(!smartMattingMutationModule) throw new Error('Canvas Mutation Module failed to load');

const smartMattingFallbacks = Object.freeze({
    'smart.mattingFailed':'抠图失败',
    'smart.mattingRunning':'正在执行 BiRefNet + Alpha Matting',
    'smart.queuePosition':'排队等待中（第 {position} 位）',
    'smart.queueWaiting':'排队等待中',
    'smart.mattingSubmitting':'正在提交抠图任务',
    'smart.mattingRetrySource':'请回到原图节点重新发起抠图',
    'smart.mattingResult':'抠图结果',
    'smart.mattingReused':'已复用抠图结果',
    'smart.mattingDone':'抠图完成',
    'smart.mattingQueryFailed':'抠图状态查询失败',
    'smart.mattingTimeout':'抠图等待超时，请重新提交',
    'smart.mattingStateMissing':'抠图提交状态未保存，请重新发起',
    'smart.mattingWaitForSync':'实时连接恢复后即可启动抠图任务',
    'smart.selectImageNode':'请选择一个图片节点',
    'smart.mattingAlreadyQueued':'这张图片已有抠图任务在队列中',
    'smart.mattingSubmitFailed':'抠图任务提交失败'
});
function smartMattingText(key, values={}){
    const translated = typeof tr === 'function' ? tr(key) : window.StudioI18n?.t?.(key);
    const text = translated && translated !== key ? translated : (smartMattingFallbacks[key] || key);
    return Object.entries(values).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), text);
}

const smartMattingActivePolls = new Map();

function smartMattingJobActive(job){
    return Boolean(
        job
        && ['submitting','queued','running'].includes(String(job.status || ''))
    );
}
function smartMattingStatusText(job){
    const status = String(job?.status || 'submitting');
    if(status === 'failed') return job?.message || smartMattingText('smart.mattingFailed');
    if(status === 'running'){
        return job?.message || smartMattingText('smart.mattingRunning');
    }
    if(status === 'queued'){
        const position = Number(job?.position || 0);
        return position > 0
            ? smartMattingText('smart.queuePosition', {position})
            : smartMattingText('smart.queueWaiting');
    }
    return smartMattingText('smart.mattingSubmitting');
}
function smartMattingPendingHtml(node, layout={}, elapsed=''){
    const job = node?.mattingJob || {};
    const failed = job.status === 'failed';
    const text = smartMattingStatusText(job);
    const sub = job.error || smartMattingText('smart.mattingRetrySource');
    const width = Math.max(1, Number(layout.width || 260));
    const height = Math.max(1, Number(layout.height || 180));
    const dimensions = `style="width:${width}px;height:${height}px"`;
    if(failed){
        return `<div class="matting-failure-feedback" data-matting-state="failed" ${dimensions}>
            <ic-alert tone="danger" heading="${escapeAttr(text)}">${escapeHtml(sub)}</ic-alert>
        </div>`;
    }
    const state = job.status === 'running' ? 'generating' : 'queued';
    const elapsedAttribute = String(elapsed || '').trim()
        ? ` elapsed="${escapeAttr(elapsed)}"`
        : '';
    return `<div class="matting-pending-feedback" ${dimensions}>
        <ic-generation-pending data-generation-pending-node data-matting-pending data-matting-state="${state}" kind="image" state="${state}" count="1" label="${escapeAttr(text)}"${elapsedAttribute}></ic-generation-pending>
    </div>`;
}
function smartMattingFailNode(node, message){
    if(!node) return;
    const text = String(message || smartMattingText('smart.mattingFailed')).slice(0, 500);
    node.mattingJob = {
        ...(node.mattingJob || {}),
        status:'failed',
        message:smartMattingText('smart.mattingFailed'),
        error:text,
        updatedAt:nowMs()
    };
    node.pending = 0;
    node.running = false;
    node.runFinishedAt = nowMs();
    if(!node.runStartedAt) node.runStartedAt = node.runFinishedAt;
    node.runElapsedMs = Math.max(
        0,
        node.runFinishedAt
        - Number(node.runStartedAt || node.runFinishedAt)
    );
    node.runTimerHidden = false;
    render();
    smartMattingPersistenceModule.schedule();
    toast(text.slice(0, 160));
}
function smartMattingCompleteNode(node, data){
    if(!node || !data?.output_url) return false;
    const width = Math.max(0, Number(data.width || 0));
    const height = Math.max(0, Number(data.height || 0));
    const additions = smartMattingOutputModule.apply({
        node,
        outputs:[{
            url:data.output_url,
            name:data.output_name || 'matting.png',
            kind:'image',
            ...(width ? {natural_w:width} : {}),
            ...(height ? {natural_h:height} : {})
        }],
        kind:'image',
        strategy:'replace',
        skipShift:true
    });
    if(!additions.length) return false;
    node.title = smartMattingText('smart.mattingResult');
    node.mattingResult = {
        jobId:node.mattingJob?.jobId || data.job_id || '',
        model:data.model || 'birefnet-general',
        sourceNodeId:node.mattingSourceNodeId || '',
        sourceImageIndex:Number(node.mattingSourceImageIndex || 0),
        cached:Boolean(data.cached),
        finishedAt:nowMs()
    };
    delete node.mattingJob;
    render();
    smartMattingPersistenceModule.schedule();
    toast(data.cached ? smartMattingText('smart.mattingReused') : smartMattingText('smart.mattingDone'));
    return true;
}
async function smartMattingFetchStatus(jobId){
    const response = await fetch(
        `/api/smart-canvas/matting/${encodeURIComponent(jobId)}`
    );
    if(!response.ok){
        throw new Error(
            await responseErrorMessage(response, smartMattingText('smart.mattingQueryFailed'))
        );
    }
    return response.json();
}
function smartMattingStartPoll(node){
    const jobId = node?.mattingJob?.jobId;
    if(!node || !jobId || !smartMattingJobActive(node.mattingJob)) return;
    if(smartMattingActivePolls.has(jobId)){
        return smartMattingActivePolls.get(jobId);
    }
    const nodeId = node.id;
    const promise = (async () => {
        let consecutiveErrors = 0;
        for(let attempt = 0; attempt < 19200; attempt++){
            const current = nodes.find(item => item.id === nodeId);
            if(!current || current.mattingJob?.jobId !== jobId) return;
            try {
                const data = await smartMattingFetchStatus(jobId);
                consecutiveErrors = 0;
                const previousSignature = [
                    current.mattingJob?.status || '',
                    Number(current.mattingJob?.position || 0),
                    current.mattingJob?.message || ''
                ].join('|');
                current.mattingJob = {
                    ...(current.mattingJob || {}),
                    jobId,
                    status:data.status || 'queued',
                    position:Number(data.position || 0),
                    queueLength:Number(data.queue_length || 0),
                    message:data.message || '',
                    updatedAt:nowMs()
                };
                current.pending = ['queued','running'].includes(data.status)
                    ? 1
                    : 0;
                current.running = data.status === 'running';
                if(data.status === 'succeeded'){
                    smartMattingCompleteNode(current, data);
                    return;
                }
                if(data.status === 'failed'){
                    smartMattingFailNode(
                        current,
                        data.error || data.message || smartMattingText('smart.mattingFailed')
                    );
                    return;
                }
                const nextSignature = [
                    current.mattingJob.status || '',
                    Number(current.mattingJob.position || 0),
                    current.mattingJob.message || ''
                ].join('|');
                if(nextSignature !== previousSignature){
                    render();
                    smartMattingPersistenceModule.schedule();
                }
            } catch(error){
                consecutiveErrors += 1;
                if(consecutiveErrors >= 8){
                    smartMattingFailNode(
                        current,
                        error.message || smartMattingText('smart.mattingQueryFailed')
                    );
                    return;
                }
            }
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
        const current = nodes.find(item => item.id === nodeId);
        if(current){
            smartMattingFailNode(
                current,
                smartMattingText('smart.mattingTimeout')
            );
        }
    })().finally(() => {
        smartMattingActivePolls.delete(jobId);
    });
    smartMattingActivePolls.set(jobId, promise);
    return promise;
}
function smartMattingResume(){
    let resumed = 0;
    nodes.filter(node =>
        node?.mattingJob
        && smartMattingJobActive(node.mattingJob)
    ).forEach(node => {
        if(node.mattingJob.jobId){
            smartMattingStartPoll(node);
            resumed += 1;
        } else {
            smartMattingFailNode(
                node,
                smartMattingText('smart.mattingStateMissing')
            );
        }
    });
    return resumed;
}
async function smartMattingRun(sourceNode, imageIndex=0){
    const online = typeof smartMattingPersistenceModule.online === 'function'
        ? smartMattingPersistenceModule.online()
        : smartMattingPersistenceModule.editable?.();
    if(
        online === false
    ){
        toast(smartMattingText('smart.mattingWaitForSync'));
        return null;
    }
    const item = imageForDisplay(sourceNode?.images?.[imageIndex]);
    if(!sourceNode || !item?.url || mediaKindForItem(item) !== 'image'){
        toast(smartMattingText('smart.selectImageNode'));
        return null;
    }
    const existing = nodes.find(node =>
        node?.mattingSourceNodeId === sourceNode.id
        && Number(node.mattingSourceImageIndex || 0)
            === Number(imageIndex || 0)
        && smartMattingJobActive(node.mattingJob)
    );
    if(existing){
        selectedId = existing.id;
        selectedIds = [];
        selectedImage = {nodeId:'', index:-1};
        render();
        toast(smartMattingText('smart.mattingAlreadyQueued'));
        return existing;
    }
    smartMattingMutationModule.history({action:'push'});
    const sourceRect = nodeRect(sourceNode);
    const output = smartMattingOutputModule.createPending({
        sourceNode,
        expectedCount:1,
        meta:null,
        connectSource:false,
        displaySize:{width:sourceRect.width,height:sourceRect.height}
    });
    output.title = smartMattingText('smart.mattingResult');
    output.mattingSourceNodeId = sourceNode.id;
    output.mattingSourceImageIndex = Number(imageIndex || 0);
    output.mattingJob = {
        status:'submitting',
        jobId:'',
        message:smartMattingText('smart.mattingSubmitting'),
        submittedAt:nowMs()
    };
    output.pending = 1;
    output.running = false;
    render();
    smartMattingPersistenceModule.schedule();
    try {
        const response = await fetch('/api/smart-canvas/matting', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                canvas_id:canvasId,
                node_id:sourceNode.id,
                image_index:Number(imageIndex || 0),
                client_id:smartClientId
            })
        });
        if(!response.ok){
            throw new Error(
                await responseErrorMessage(response, smartMattingText('smart.mattingSubmitFailed'))
            );
        }
        const data = await response.json();
        const current = nodes.find(node => node.id === output.id);
        if(!current) return null;
        current.mattingJob = {
            ...(current.mattingJob || {}),
            jobId:data.job_id,
            status:data.status || 'queued',
            position:Number(data.position || 0),
            queueLength:Number(data.queue_length || 0),
            message:data.message || '',
            updatedAt:nowMs()
        };
        current.pending = 1;
        render();
        smartMattingPersistenceModule.schedule();
        smartMattingStartPoll(current);
        return current;
    } catch(error){
        smartMattingFailNode(
            nodes.find(node => node.id === output.id),
            error.message || smartMattingText('smart.mattingSubmitFailed')
        );
        return null;
    }
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.smartMatting = Object.freeze({
    run({nodeId='', node=null, imageIndex=0}={}){
        const sourceNode = node
            || (nodeId ? nodes.find(item => item.id === nodeId) : null);
        return smartMattingRun(sourceNode, imageIndex);
    },
    resume(){
        return smartMattingResume();
    },
    isActive({job=null, node=null}={}){
        return smartMattingJobActive(job || node?.mattingJob);
    },
    pendingHtml({node=null, layout=null, elapsed=''}={}){
        return smartMattingPendingHtml(node, layout || {}, elapsed);
    }
});
