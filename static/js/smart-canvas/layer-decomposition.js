/* Smart Canvas image layer decomposition controller. */
(function(){
    const PROVIDER = 'apimart';
    const MODEL = 'seedream-5-0-pro';
    const OPERATION = 'image.layer_decomposition';
    const ACTIVE = new Set(['submitting','queued','running','recoverable']);

    function create(options={}){
        const polls = new Map();
        const getNodes = options.nodes || (() => []);
        const text = options.text || (key => key);
        const format = options.format || ((key, values={}) => Object.entries(values).reduce(
            (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)),
            text(key)
        ));
        const notify = options.toast || (() => {});
        const save = options.save || (() => {});
        const checkpoint = options.checkpoint || (async () => {});
        const redraw = options.render || (() => {});
        const now = options.now || (() => Date.now());
        const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
        const responseError = options.responseError || (async response => response.text());
        let dialogContext = null;
        let dialogBound = false;

        function jobActive(job){
            return Boolean(job && ACTIVE.has(String(job.status || '')));
        }
        function findNode(id){
            return getNodes().find(node => node.id === id) || null;
        }
        function setJob(node, patch){
            if(!node) return;
            node.layerDecompositionJob = {
                ...(node.layerDecompositionJob || {}),
                ...patch,
                updatedAt:now()
            };
            node.pending = ['submitting','queued','running'].includes(
                node.layerDecompositionJob.status
            ) ? 1 : 0;
            node.running = node.layerDecompositionJob.status === 'running';
            redraw();
            save(node);
        }
        function fail(node, message, recoverable=false, technicalMessage=''){
            const fallback = text('smart.layerDecompositionFailed');
            const detail = String(message || fallback).slice(0, 500);
            setJob(node, {
                status:recoverable ? 'recoverable' : 'failed',
                message:recoverable ? text('smart.layerDecompositionRecoverable') : fallback,
                error:detail,
                technicalError:String(technicalMessage || '').slice(0, 500),
                recoverable:Boolean(recoverable)
            });
            notify(detail.slice(0, 160));
        }
        function priceText(resolutionTier){
            const maximum = ['1K','1.5K'].includes(String(resolutionTier))
                ? '0.765'
                : '1.53';
            return format('smart.layerDecompositionPriceEstimate', {amount:maximum});
        }
        function updateDialogPrice(dialog){
            const tier = dialog?.querySelector('[data-layer-resolution]')?.value || '2K';
            const price = dialog?.querySelector('[data-layer-price]');
            if(price) price.textContent = priceText(tier);
        }
        async function status(taskId){
            const response = await fetch(
                `/api/canvas-layer-decomposition-tasks/${encodeURIComponent(taskId)}`
            );
            if(!response.ok){
                throw new Error(await responseError(
                    response, text('smart.layerDecompositionQueryFailed')
                ));
            }
            return response.json();
        }
        function poll(node){
            const taskId = String(node?.layerDecompositionJob?.taskId || '');
            if(!node || !taskId || !jobActive(node.layerDecompositionJob)) return null;
            if(polls.has(taskId)) return polls.get(taskId);
            const nodeId = node.id;
            const promise = (async () => {
                let errors = 0;
                for(let attempt = 0; attempt < 19200; attempt += 1){
                    const current = findNode(nodeId);
                    if(!current || current.layerDecompositionJob?.taskId !== taskId) return;
                    try {
                        const data = await status(taskId);
                        errors = 0;
                        if(data.status === 'succeeded'){
                            try {
                                options.applyResult?.(current, data.result || {}, data);
                            } catch(error){
                                fail(
                                    current,
                                    text('smart.layerDecompositionInvalidResult'),
                                    true,
                                    error?.message
                                );
                            }
                            return;
                        }
                        if(['failed','cancelled','discarded'].includes(data.status)){
                            fail(
                                current,
                                text('smart.layerDecompositionFailed'),
                                Boolean(data.recoverable),
                                data.error || data.message || ''
                            );
                            return;
                        }
                        setJob(current, {
                            status:data.status === 'running' ? 'running' : 'queued',
                            message:data.message || ''
                        });
                    } catch(error){
                        errors += 1;
                        if(errors >= 8){
                            fail(
                                current,
                                text('smart.layerDecompositionQueryFailed'),
                                true,
                                error?.message
                            );
                            return;
                        }
                    }
                    await sleep(1500);
                }
                fail(findNode(nodeId), text('smart.layerDecompositionTimeout'), true);
            })().finally(() => polls.delete(taskId));
            polls.set(taskId, promise);
            return promise;
        }
        async function run({node,imageIndex=0,resolutionTier='2K',prompt=''}={}){
            const source = node?.images?.[Number(imageIndex) || 0];
            if(!node || !source?.url){
                notify(text('smart.selectImageNode'));
                return null;
            }
            const capability = await options.capability.load(PROVIDER, MODEL, OPERATION);
            if(capability.support_state !== 'supported'){
                notify(text('smart.layerDecompositionUnavailable'));
                return null;
            }
            const validation = options.capability.validate(capability, {
                inputs:{text:String(prompt || '').trim() ? 1 : 0,image:1,video:0,audio:0,file:0},
                inputRoles:{image:['source']},
                parameters:{resolution_tier:resolutionTier,count:1},
                catalogRevision:capability.catalog_revision
            });
            if(!validation.valid){
                notify(text('smart.layerDecompositionInvalid'));
                return null;
            }
            const pending = options.createPending?.(node, Number(imageIndex) || 0);
            if(!pending) return null;
            pending.generationOperationId = pending.generationOperationId
                || `layer-decomposition-${now()}-${Math.random().toString(36).slice(2, 9)}`;
            pending.layerDecompositionSourceNodeId = node.id;
            pending.layerDecompositionSourceImageIndex = Number(imageIndex) || 0;
            setJob(pending, {status:'submitting',taskId:'',submittedAt:now()});
            try {
                await checkpoint();
                const response = await fetch('/api/canvas-layer-decomposition-tasks', {
                    method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({
                        provider_id:PROVIDER,
                        model:MODEL,
                        resolution_tier:resolutionTier,
                        prompt:String(prompt || '').trim(),
                        image:{
                            url:source.url,
                            role:'source',
                            natural_w:Number(source.natural_w || source.width || 0),
                            natural_h:Number(source.natural_h || source.height || 0)
                        },
                        source_media_id:String(
                            source.media_id
                            || source.output_media_id
                            || source.asset_id
                            || `${options.canvasId?.() || 'canvas'}:${node.id}:${Number(imageIndex) || 0}`
                        ),
                        catalog_revision:capability.catalog_revision,
                        canvas_id:options.canvasId?.() || '',
                        node_id:pending.id,
                        generation_operation_id:pending.generationOperationId,
                        generation_request_index:0
                    })
                });
                if(!response.ok){
                    throw new Error(await responseError(
                        response, text('smart.layerDecompositionSubmitFailed')
                    ));
                }
                const data = await response.json();
                setJob(pending, {
                    taskId:data.task_id,
                    status:data.status === 'running' ? 'running' : 'queued'
                });
                poll(pending);
                return pending;
            } catch(error){
                fail(
                    pending,
                    text('smart.layerDecompositionSubmitFailed'),
                    false,
                    error?.message
                );
                return pending;
            }
        }
        function bindDialog(dialog){
            if(dialogBound || !dialog) return;
            dialogBound = true;
            dialog.querySelector('[data-layer-cancel]')?.addEventListener('click', () => dialog.hide?.('cancelled'));
            dialog.querySelector('[data-layer-resolution]')?.addEventListener(
                'change',
                () => updateDialogPrice(dialog)
            );
            dialog.querySelector('[data-layer-submit]')?.addEventListener('click', async () => {
                if(!dialogContext) return;
                const resolutionTier = dialog.querySelector('[data-layer-resolution]')?.value || '2K';
                const prompt = dialog.querySelector('[data-layer-prompt]')?.value || '';
                const context = dialogContext;
                dialogContext = null;
                await dialog.hide?.('accepted');
                run({...context,resolutionTier,prompt});
            });
        }
        async function open({node,imageIndex=0}={}){
            const dialog = document.getElementById('layerDecompositionDialog');
            if(!dialog) return null;
            bindDialog(dialog);
            dialogContext = {node,imageIndex};
            const submit = dialog.querySelector('[data-layer-submit]');
            const statusLine = dialog.querySelector('[data-layer-capability-status]');
            if(submit) submit.disabled = true;
            if(statusLine) statusLine.textContent = text('smart.layerDecompositionChecking');
            const capability = await options.capability.load(PROVIDER, MODEL, OPERATION);
            const supported = capability.support_state === 'supported';
            if(submit) submit.disabled = !supported;
            if(statusLine) statusLine.textContent = text(supported
                ? 'smart.layerDecompositionReady'
                : 'smart.layerDecompositionUnavailable');
            updateDialogPrice(dialog);
            await dialog.show?.();
            return capability;
        }
        function resume(){
            let count = 0;
            getNodes().forEach(node => {
                if(jobActive(node?.layerDecompositionJob) && node.layerDecompositionJob.taskId){
                    poll(node);
                    count += 1;
                }
            });
            return count;
        }
        return Object.freeze({
            open, run, resume, isActive:job => jobActive(job),
            pendingHtml({node,layout={},elapsed=''}={}){
                const job = node?.layerDecompositionJob || {};
                if(job.status === 'failed' || job.status === 'recoverable'){
                    return `<div class="layer-decomposition-feedback" style="width:${Number(layout.width)||260}px;height:${Number(layout.height)||180}px"><ic-alert tone="danger" heading="${text('smart.layerDecompositionFailed')}">${job.error || text('smart.layerDecompositionRecoverable')}</ic-alert></div>`;
                }
                return `<ic-generation-pending data-generation-pending-node kind="image" state="${job.status === 'running' ? 'generating' : 'queued'}" count="1" label="${text('smart.layerDecompositionRunning')}"${elapsed ? ` elapsed="${elapsed}"` : ''}></ic-generation-pending>`;
            },
            waitForIdle:() => Promise.all([...polls.values()])
        });
    }

    window.SmartCanvasModules = window.SmartCanvasModules || {};
    window.SmartCanvasModules.layerDecomposition = Object.freeze({create});
})();
