/*
 * Smart Canvas Opening Module
 *
 * Owns the transient page-opening state, progressive NDJSON reader, and
 * presentation-only Node skeletons. It never writes to Canvas state.
 */
(function(){
    const PHASE_ATTRIBUTE = 'canvasOpeningPhase';
    const FALLBACK_STATUSES = new Set([404,405,406,501]);
    const MAX_SKELETON_NODES = 240;
    const MIN_SKELETON_VISIBLE_MS = 240;
    const TRANSITION_MS = 320;
    let outlineIdentity = null;
    let layer = null;
    let skeletonShownAt = 0;
    let readyTimer = 0;

    function openingText(key,fallback){
        const value = window.StudioI18n?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    function setStatus(key,fallback){
        const status = document.getElementById('canvasOpeningStatus');
        if(!status) return;
        status.dataset.i18n = key;
        status.textContent = openingText(key,fallback);
    }

    function setPhase(value){
        document.documentElement.dataset[PHASE_ATTRIBUTE] = value;
    }

    function openingError(message,status=0){
        const error = new Error(message || 'Smart Canvas opening failed');
        error.status = Number(status || 0);
        return error;
    }

    function safeNumber(value,fallback,minimum,maximum){
        const number = Number(value);
        if(!Number.isFinite(number)) return fallback;
        return Math.max(minimum,Math.min(maximum,number));
    }

    function clearLayer(){
        window.clearTimeout(readyTimer);
        readyTimer = 0;
        layer?.remove?.();
        layer = null;
        outlineIdentity = null;
        skeletonShownAt = 0;
    }

    function skeleton(shape='text',className=''){
        const element = document.createElement('ic-skeleton');
        element.setAttribute('shape',shape);
        if(className) element.className = className;
        return element;
    }

    function outlineMeasurementNode(rawNode){
        const node = {...(rawNode || {})};
        if(Array.isArray(rawNode?.images)){
            node.images = rawNode.images.map(rawMedia => ({
                ...(rawMedia || {}),
                url:rawMedia?.is_still_image === false
                    ? 'canvas-outline.mp4'
                    : 'canvas-outline.png',
            }));
        }
        return node;
    }

    function showOutline(event,canvasId){
        if(
            !event
            || event.type !== 'canvas_outline'
            || String(event.canvas_id || '') !== String(canvasId || '')
            || !Array.isArray(event.nodes)
        ){
            throw openingError('Invalid Canvas outline');
        }
        clearLayer();
        outlineIdentity = Object.freeze({
            canvasId:String(event.canvas_id || ''),
            revision:Math.max(0,Number(event.revision || 0)),
        });
        if(!event.nodes.length) return false;
        const world = document.getElementById('world');
        if(!world) throw openingError('Canvas world is unavailable');
        layer = document.createElement('div');
        layer.className = 'canvas-opening-layer';
        layer.dataset.outlineTotal = String(event.nodes.length);
        layer.setAttribute('aria-hidden','true');
        const measurementNodes = event.nodes.map(outlineMeasurementNode);
        const geometry = window.SmartCanvasModules?.nodeGeometry;
        const geometrySession = geometry?.createSession?.({
            nodes:measurementNodes,
            connections:[],
        });
        const fragment = document.createDocumentFragment();
        event.nodes.slice(0,MAX_SKELETON_NODES).forEach(rawNode => {
            const id = String(rawNode?.id || '').trim();
            if(!id) return;
            const measurement = geometrySession?.measure?.(id);
            const footprint = measurement?.supported
                ? measurement.footprint
                : rawNode;
            const node = document.createElement('div');
            node.className = 'canvas-opening-node';
            node.dataset.outlineNodeId = id;
            node.dataset.outlineNodeType = String(rawNode?.type || 'smart-image');
            node.style.left = `${safeNumber(footprint?.x,0,-1000000,1000000)}px`;
            node.style.top = `${safeNumber(footprint?.y,0,-1000000,1000000)}px`;
            node.style.width = `${safeNumber(footprint?.width ?? rawNode?.w,280,1,1000000)}px`;
            node.style.height = `${safeNumber(footprint?.height ?? rawNode?.h,180,1,1000000)}px`;
            const header = document.createElement('div');
            header.className = 'canvas-opening-node-header';
            header.append(
                skeleton('circle','canvas-opening-node-icon'),
                skeleton('text','canvas-opening-node-title')
            );
            const body = document.createElement('div');
            body.className = 'canvas-opening-node-body';
            body.append(skeleton('rectangle','canvas-opening-node-media'));
            node.append(header,body);
            fragment.append(node);
        });
        layer.append(fragment);
        world.prepend(layer);
        skeletonShownAt = globalThis.performance?.now?.() ?? Date.now();
        setPhase('skeleton');
        setStatus('smart.openingContent','正在打开画布内容…');
        return Boolean(layer.childElementCount);
    }

    function nextPaint(){
        if(typeof requestAnimationFrame !== 'function'){
            return Promise.resolve();
        }
        return new Promise(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
    }

    function validateDocument(documentValue,canvasId){
        if(!documentValue || typeof documentValue !== 'object'){
            throw openingError('Canvas document is missing');
        }
        const documentId = String(
            documentValue.id || documentValue.canvas_id || ''
        );
        if(documentId !== String(canvasId || '')){
            throw openingError('Canvas document identity changed while opening');
        }
        if(outlineIdentity){
            const revision = Math.max(0,Number(documentValue.revision || 0));
            if(
                outlineIdentity.canvasId !== String(canvasId || '')
                || outlineIdentity.revision !== revision
            ){
                throw openingError('Canvas revision changed while opening');
            }
        }
        return documentValue;
    }

    async function readOpeningStream(
        response,
        canvasId,
        outlineReady=null,
        outlineTransform=null
    ){
        if(!response.body?.getReader){
            throw openingError('Streaming response is unavailable');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let documentValue = null;
        let paintedOutline = false;
        let seenOutline = false;
        let seenDocument = false;
        const outlineReadyPromise = Promise.resolve(outlineReady).catch(() => undefined);
        async function consumeLine(line){
            const text = line.trim();
            if(!text) return;
            let event;
            try {
                event = JSON.parse(text);
            } catch(error){
                throw openingError('Canvas opening stream contains invalid JSON');
            }
            if(event?.type === 'canvas_outline'){
                if(seenOutline || seenDocument){
                    throw openingError('Canvas opening events are out of order');
                }
                seenOutline = true;
                await outlineReadyPromise;
                const preparedEvent = typeof outlineTransform === 'function'
                    ? await outlineTransform(event)
                    : event;
                const visible = showOutline(preparedEvent,canvasId);
                if(visible && !paintedOutline){
                    paintedOutline = true;
                    await nextPaint();
                }
                return;
            }
            if(event?.type === 'canvas_document'){
                if(!seenOutline || seenDocument){
                    throw openingError('Canvas opening events are out of order');
                }
                seenDocument = true;
                documentValue = validateDocument(event.canvas,canvasId);
            }
        }
        while(true){
            const {done,value} = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(),{stream:!done});
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for(const line of lines) await consumeLine(line);
            if(done) break;
        }
        if(buffer.trim()) await consumeLine(buffer);
        if(!seenOutline || !seenDocument || !documentValue){
            throw openingError('Canvas opening stream ended before the document');
        }
        return documentValue;
    }

    async function fetchCompleteCanvas(canvasId){
        const response = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}`);
        if(!response.ok){
            throw openingError('Canvas request failed',response.status);
        }
        const data = await response.json().catch(() => ({}));
        return validateDocument(data.canvas,canvasId);
    }

    async function open({canvasId,outlineReady=null,outlineTransform=null}={}){
        const id = String(canvasId || '').trim();
        if(!id) throw openingError('Canvas id is required');
        clearLayer();
        setPhase('awaiting-outline');
        const response = await fetch(
            `/api/canvases/${encodeURIComponent(id)}/open`,
            {headers:{Accept:'application/x-ndjson'}}
        );
        const contentType = String(response.headers.get('content-type') || '');
        if(
            FALLBACK_STATUSES.has(response.status)
            || (response.ok && !contentType.includes('application/x-ndjson'))
        ){
            return fetchCompleteCanvas(id);
        }
        if(!response.ok){
            throw openingError('Canvas opening request failed',response.status);
        }
        return readOpeningStream(
            response,
            id,
            outlineReady,
            outlineTransform
        );
    }

    function prepare(){
        const error = document.getElementById('canvasOpeningError');
        const shell = document.getElementById('shell');
        error?.setAttribute?.('aria-hidden','true');
        shell?.removeAttribute?.('aria-hidden');
        shell?.setAttribute?.('aria-busy','true');
        document.documentElement.classList.remove('smart-canvas-booting');
        setPhase('awaiting-outline');
    }

    function hydrating(){
        setPhase('hydrating');
    }

    function ready(){
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
            || document.documentElement.dataset.uiMotion === 'reduced';
        const completePage = () => {
            setPhase('ready');
            document.getElementById('shell')?.removeAttribute?.('aria-busy');
            setStatus('smart.openingReady','画布已打开');
        };
        if(!layer){
            completePage();
            return;
        }
        const activeLayer = layer;
        const elapsed = skeletonShownAt
            ? (globalThis.performance?.now?.() ?? Date.now()) - skeletonShownAt
            : MIN_SKELETON_VISIBLE_MS;
        const hold = reduced
            ? 0
            : Math.max(0,MIN_SKELETON_VISIBLE_MS - elapsed);
        readyTimer = window.setTimeout(() => {
            readyTimer = 0;
            completePage();
            activeLayer.classList.add('is-completing');
            if(reduced){
                if(layer === activeLayer) clearLayer();
                else activeLayer.remove();
                return;
            }
            const remove = event => {
                if(event && event.target !== activeLayer) return;
                activeLayer.removeEventListener('transitionend',remove);
                if(layer === activeLayer) clearLayer();
                else activeLayer.remove();
            };
            activeLayer.addEventListener('transitionend',remove);
            readyTimer = window.setTimeout(remove,TRANSITION_MS + 80);
        },hold);
    }

    function fail(error){
        clearLayer();
        document.documentElement.classList.remove('smart-canvas-booting');
        setPhase('error');
        const shell = document.getElementById('shell');
        const panel = document.getElementById('canvasOpeningError');
        const message = document.getElementById('canvasOpeningErrorMessage');
        shell?.setAttribute?.('aria-hidden','true');
        shell?.removeAttribute?.('aria-busy');
        panel?.removeAttribute?.('aria-hidden');
        if(message){
            const status = Number(error?.status || 0);
            const [key,fallback] = status === 401
                ? ['smart.openingErrorSession','登录状态已失效，请重新登录。']
                : status === 403
                    ? ['smart.openingErrorPermission','你没有打开此画布的权限。']
                    : status === 404
                        ? ['smart.openingErrorMissing','画布不存在或已被移除。']
                        : ['smart.openingErrorGeneric','画布暂时无法打开，请重试。'];
            message.dataset.i18n = key;
            message.textContent = openingText(key,fallback);
        }
        document.getElementById('canvasOpeningRetry')?.focus?.({preventScroll:true});
    }

    document.getElementById('canvasOpeningRetry')?.addEventListener('click',() => {
        window.location.reload();
    });
    document.getElementById('canvasOpeningBack')?.addEventListener('click',() => {
        window.location.href = '/static/canvas-list.html';
    });

    window.SmartCanvasModules = window.SmartCanvasModules || {};
    window.SmartCanvasModules.canvasOpening = Object.freeze({
        prepare,
        open,
        hydrating,
        ready,
        fail,
    });
})();
