/*
 * Smart Canvas Click Spark Feedback
 *
 * Owns visual-only release feedback for pointer gestures that begin on the
 * Smart Canvas content surface. It never dispatches a business click.
 */
(function registerSmartCanvasClickSparkFeedback(){
    const CONFIG = Object.freeze({
        count:8,
        radius:16,
        length:10,
        duration:360,
        maxBursts:3
    });
    const STROKE = Object.freeze({color:1.5, outline:2.4});
    const DPR_LIMIT = 1.5;
    const DRAG_DISTANCE_PX = 4;
    const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
    const DIRECTIONS = Object.freeze(
        Array.from({length:CONFIG.count}, (_, index) => {
            const angle = Math.PI * 2 * index / CONFIG.count;
            return Object.freeze({dx:Math.cos(angle), dy:Math.sin(angle)});
        })
    );

    let activeController = null;

    function createLayer(root){
        const canvas = document.createElement('canvas');
        canvas.className = 'smart-click-spark-feedback';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.dataset.animationState = 'idle';
        canvas.dataset.triggerCount = '0';

        const sparkProbe = document.createElement('span');
        sparkProbe.className = 'smart-click-spark-color-probe';
        sparkProbe.dataset.kind = 'spark';
        sparkProbe.setAttribute('aria-hidden', 'true');

        const outlineProbe = document.createElement('span');
        outlineProbe.className = 'smart-click-spark-color-probe';
        outlineProbe.dataset.kind = 'outline';
        outlineProbe.setAttribute('aria-hidden', 'true');

        root.append(canvas, sparkProbe, outlineProbe);
        return {canvas, sparkProbe, outlineProbe};
    }

    function install(options={}){
        const root = options.root;
        if(!(root instanceof HTMLElement)){
            throw new TypeError('Click Spark feedback requires a root element');
        }
        if(activeController) activeController.destroy();

        const shouldIgnore = typeof options.shouldIgnore === 'function'
            ? options.shouldIgnore
            : () => false;
        const {canvas, sparkProbe, outlineProbe} = createLayer(root);
        const context = canvas.getContext('2d');
        const resizeObserver = new ResizeObserver(resize);
        let bursts = [];
        let press = null;
        let raf = 0;
        let reducedClearTimer = 0;
        let triggerCount = 0;
        let destroyed = false;

        function resize(){
            const rect = root.getBoundingClientRect();
            const dpr = Math.min(window.devicePixelRatio || 1, DPR_LIMIT);
            const width = Math.max(1, Math.round(rect.width * dpr));
            const height = Math.max(1, Math.round(rect.height * dpr));
            if(canvas.width === width && canvas.height === height) return;
            canvas.width = width;
            canvas.height = height;
            canvas.dataset.dpr = String(dpr);
        }

        function clearCanvas(){
            context.setTransform(1, 0, 0, 1, 0, 0);
            context.clearRect(0, 0, canvas.width, canvas.height);
        }

        function prepareContext(){
            const dpr = Number(canvas.dataset.dpr) || 1;
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            context.lineCap = 'round';
        }

        function colors(){
            return {
                color:getComputedStyle(sparkProbe).color,
                outline:getComputedStyle(outlineProbe).color
            };
        }

        function drawReduced(x, y, palette){
            cancelAnimationFrame(raf);
            raf = 0;
            bursts = [];
            clearTimeout(reducedClearTimer);
            clearCanvas();
            prepareContext();
            context.beginPath();
            context.arc(x, y, 2.1, 0, Math.PI * 2);
            context.fillStyle = palette.outline;
            context.fill();
            context.beginPath();
            context.arc(x, y, 1.2, 0, Math.PI * 2);
            context.fillStyle = palette.color;
            context.fill();
            canvas.dataset.animationState = 'idle';
            reducedClearTimer = window.setTimeout(clearCanvas, 120);
        }

        function stroke(visible, outline=false){
            for(const burst of visible){
                const distance = burst.eased * CONFIG.radius;
                const lineLength = CONFIG.length * (1 - burst.eased);
                context.globalAlpha = Math.max(0, 1 - burst.progress);
                context.strokeStyle = outline
                    ? burst.palette.outline
                    : burst.palette.color;
                context.lineWidth = outline ? STROKE.outline : STROKE.color;
                context.beginPath();
                for(const direction of DIRECTIONS){
                    const x1 = burst.x + distance * direction.dx;
                    const y1 = burst.y + distance * direction.dy;
                    context.moveTo(x1, y1);
                    context.lineTo(
                        x1 + lineLength * direction.dx,
                        y1 + lineLength * direction.dy
                    );
                }
                context.stroke();
            }
        }

        function draw(timestamp){
            raf = 0;
            clearCanvas();
            prepareContext();
            const visible = [];
            for(const burst of bursts){
                const progress = (timestamp - burst.start) / CONFIG.duration;
                if(progress >= 1) continue;
                const normalized = Math.max(0, progress);
                visible.push({
                    ...burst,
                    progress:normalized,
                    eased:1 - (1 - normalized) * (1 - normalized)
                });
            }
            bursts = visible.map(({progress, eased, ...burst}) => burst);
            stroke(visible, true);
            stroke(visible, false);
            context.globalAlpha = 1;
            if(bursts.length){
                raf = requestAnimationFrame(draw);
                return;
            }
            canvas.dataset.animationState = 'idle';
        }

        function burstAt(clientX, clientY, gesture='programmatic'){
            if(destroyed || document.hidden) return false;
            const rect = root.getBoundingClientRect();
            if(!rect.width || !rect.height) return false;
            const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
            const y = Math.min(rect.height, Math.max(0, clientY - rect.top));
            const palette = colors();
            triggerCount += 1;
            canvas.dataset.triggerCount = String(triggerCount);
            canvas.dataset.lastGesture = gesture;

            if(window.matchMedia?.(REDUCED_MOTION_QUERY).matches){
                canvas.dataset.lastMotion = 'reduced';
                drawReduced(x, y, palette);
                return true;
            }

            bursts.push({x, y, start:performance.now(), palette});
            if(bursts.length > CONFIG.maxBursts){
                bursts.splice(0, bursts.length - CONFIG.maxBursts);
            }
            canvas.dataset.lastMotion = 'animated';
            canvas.dataset.animationState = 'active';
            if(!raf) raf = requestAnimationFrame(draw);
            return true;
        }

        function begin(event){
            if(event.button !== 0 || shouldIgnore(event.target, event)) return;
            press = {x:event.clientX, y:event.clientY};
        }

        function finish(event){
            const start = press;
            press = null;
            if(!start || event.button !== 0) return;
            const distance = Math.hypot(
                event.clientX - start.x,
                event.clientY - start.y
            );
            burstAt(
                event.clientX,
                event.clientY,
                distance >= DRAG_DISTANCE_PX ? 'drag-release' : 'click'
            );
        }

        function cancelPress(){
            press = null;
        }

        function destroy(){
            if(destroyed) return;
            destroyed = true;
            root.removeEventListener('mousedown', begin, true);
            window.removeEventListener('mouseup', finish, true);
            window.removeEventListener('blur', cancelPress);
            resizeObserver.disconnect();
            cancelAnimationFrame(raf);
            clearTimeout(reducedClearTimer);
            canvas.remove();
            sparkProbe.remove();
            outlineProbe.remove();
            bursts = [];
            press = null;
            if(activeController === controller) activeController = null;
        }

        const controller = Object.freeze({
            config:CONFIG,
            canvas,
            burstAt,
            destroy,
            resolvedColor:() => colors().color,
            status:() => Object.freeze({
                animationActive:Boolean(raf),
                animationState:canvas.dataset.animationState,
                lastGesture:canvas.dataset.lastGesture || '',
                lastMotion:canvas.dataset.lastMotion || '',
                triggerCount
            })
        });

        root.addEventListener('mousedown', begin, true);
        window.addEventListener('mouseup', finish, true);
        window.addEventListener('blur', cancelPress);
        resizeObserver.observe(root);
        resize();
        activeController = controller;
        return controller;
    }

    window.SmartCanvasModules = window.SmartCanvasModules || {};
    window.SmartCanvasModules.clickSparkFeedback = Object.freeze({
        config:CONFIG,
        controller:() => activeController,
        install
    });
})();
