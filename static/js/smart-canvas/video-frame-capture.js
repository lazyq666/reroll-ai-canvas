/* Canvas-local frame picking. Draft PNGs stay local until confirmation. */
export function frameMetrics(item, duration, time = 0) {
    const value = Number(item.fps || item.frameRate || item.frame_rate || item.framespersecond || item.frames_per_second);
    const known = Number.isFinite(value) && value > 0 && value <= 240;
    const fps = known ? value : 30;
    const total = Number.isFinite(duration) && duration > 0 ? Math.max(1, Math.ceil(duration * fps - 1e-6)) : 0;
    return {fps, estimated:!known, total, current:total ? Math.min(total, Math.max(1, Math.floor(Math.max(0, time) * fps + 1e-3) + 1)) : 0};
}

export function createFrameCapture({host, video, item, tr, trf, position, commit, onClose, mode = 'custom'}) {
    const abort = new AbortController();
    const {signal} = abort;
    const drafts = [];
    const urls = new Set();
    const originalLoop = video.loop;
    let closed = false, busy = false, ready = false, errorKey = '', thumbnailsStarted = false;
    let seekQueue = Promise.resolve();
    let seekFailed = false;
    let pendingFrame = null, queuedFrame = null, seekingTask = null;
    const panel = document.createElement('section');
    panel.className = 'smart-frame-capture';
    panel.tabIndex = -1;
    panel.setAttribute('role', 'region');
    panel.innerHTML = `<div class="smart-frame-timeline"><div class="smart-frame-film" aria-hidden="true"></div><input type="range" min="1" max="1" step="1" value="1"><span class="smart-frame-playhead"></span></div><div class="smart-frame-actions"><div class="smart-frame-progress"><ic-icon-button data-play icon="play-filled" hierarchy="quiet" size="small"></ic-icon-button><span data-counter></span></div><div class="smart-frame-picks"><div class="smart-frame-rail"></div><ic-button data-capture hierarchy="secondary" size="small"><ic-icon name="camera" slot="start"></ic-icon><span data-capture-label></span></ic-button><ic-icon-button data-add-capture icon="camera" hierarchy="secondary" size="small" hidden></ic-icon-button></div><ic-button data-confirm hierarchy="primary" size="small"></ic-button><ic-icon-button data-close icon="close" hierarchy="quiet" size="small"></ic-icon-button></div><div class="smart-frame-message" role="status"></div>`;
    host.append(panel);
    const q = selector => panel.querySelector(selector);
    const slider = q('input');
    const thumbVideo = document.createElement('video');
    thumbVideo.muted = true;
    thumbVideo.preload = 'auto';
    thumbVideo.crossOrigin = 'anonymous';
    const metrics = () => frameMetrics(item, video.duration, video.currentTime);
    const label = frame => trf('smart.capture.frameLabel', {frame});
    const bind = (el, name, handler) => el.addEventListener(name, handler, {signal});
    function update() {
        if(closed) return;
        const m = metrics();
        ready = !video.error && video.readyState >= 2 && m.total > 0 && video.videoWidth > 0;
        panel.setAttribute('aria-label', tr('smart.capture.title'));
        panel.setAttribute('aria-busy', String(busy));
        slider.max = String(m.total || 1);
        const seekable = !video.error && video.readyState >= 1 && m.total > 0;
        const displayedFrame = pendingFrame ?? m.current;
        slider.value = String(displayedFrame || 1);
        // Seeking temporarily drops readyState to HAVE_METADATA. Keep the native
        // range enabled so Chrome retains the active pointer drag.
        slider.disabled = !seekable || busy;
        slider.setAttribute('aria-label', tr('smart.capture.timeline'));
        slider.setAttribute('aria-valuetext', label(displayedFrame));
        q('[data-counter]').textContent = m.total ? trf(m.estimated ? 'smart.capture.estimatedCounter' : 'smart.capture.counter', {...m,current:displayedFrame}) : tr('smart.capture.loading');
        q('[data-counter]').title = trf(m.estimated ? 'smart.capture.estimatedHint' : 'smart.capture.fpsHint', {fps:m.fps});
        q('.smart-frame-playhead').style.left = `${m.total > 1 ? (displayedFrame - 1) / (m.total - 1) * 100 : 0}%`;
        q('[data-play]').setAttribute('icon', video.paused ? 'play-filled' : 'pause-filled');
        q('[data-play]').setAttribute('label', tr(video.paused ? 'smart.capture.play' : 'smart.capture.pause'));
        q('[data-play]').toggleAttribute('disabled', !ready || busy);
        for(const button of panel.querySelectorAll('[data-capture],[data-add-capture]')) button.toggleAttribute('disabled', !ready || busy || video.seeking || drafts.length >= 24);
        q('[data-capture]').hidden = drafts.length > 0;
        q('[data-add-capture]').hidden = drafts.length === 0;
        q('[data-add-capture]').setAttribute('label', tr('smart.capture.take'));
        q('[data-capture]').setAttribute('title', tr(drafts.length >= 24 ? 'smart.capture.limit' : 'smart.capture.take'));
        q('[data-capture-label]').textContent = tr('smart.capture.take');
        q('[data-capture]').setAttribute('aria-label', tr('smart.capture.take'));
        q('[data-confirm]').textContent = tr(busy ? 'smart.capture.saving' : 'smart.capture.confirm');
        q('[data-confirm]').toggleAttribute('disabled', !drafts.length || busy);
        q('[data-close]').setAttribute('label', tr('smart.capture.cancel'));
        q('[data-close]').toggleAttribute('disabled', busy);
        q('.smart-frame-message').textContent = errorKey ? tr(errorKey) : !seekable ? tr('smart.capture.loading') : '';
        q('[data-confirm]').setAttribute('title', tr(drafts.length ? 'smart.capture.confirm' : 'smart.capture.empty'));
        panel.querySelectorAll('[data-frame]').forEach(button => button.setAttribute('aria-label', trf('smart.capture.remove', {frame:button.dataset.frame})));
    }
    function waitMedia(media, event, action) {
        return new Promise((resolve, reject) => {
            const events = event === 'ready' ? ['loadeddata','seeked','canplay'] : [event];
            const finish = error => {
                clearTimeout(timer);
                events.forEach(name => media.removeEventListener(name, done)); media.removeEventListener('error', fail); signal.removeEventListener('abort', cancel);
                error ? reject(error) : resolve();
            };
            const done = () => { if(event !== 'ready' || media.readyState >= 2) finish(); };
            const fail = () => finish(new Error('media'));
            const cancel = () => finish(new Error('closed'));
            const timer = setTimeout(fail, 12000);
            events.forEach(name => media.addEventListener(name, done)); media.addEventListener('error', fail, {once:true}); signal.addEventListener('abort', cancel, {once:true});
            if(signal.aborted) return cancel();
            try { action(); if(event === 'ready') done(); } catch { fail(); }
        });
    }
    async function seek(media, time) {
        if(Math.abs(media.currentTime - time) < .00001 && !media.seeking && media.readyState >= 2) return;
        await waitMedia(media, 'seeked', () => { media.currentTime = time; });
    }
    function seekFrame(frame) {
        if(closed) return Promise.resolve();
        const m = metrics();
        pendingFrame = Math.max(1, Math.min(m.total || 1, frame));
        queuedFrame = pendingFrame;
        video.pause();
        update();
        if(!seekingTask){
            seekingTask = (async () => {
                // Keep only the newest pointer position while the decoder is busy.
                // Replaying every intermediate drag event makes release feel stuck.
                while(queuedFrame !== null && !closed){
                    const targetFrame = queuedFrame;
                    queuedFrame = null;
                    try {
                        const {fps} = metrics();
                        // Seek inside the sample interval, avoiding rounded boundaries.
                        await seek(video, Math.min(video.duration - 0.000001, (targetFrame - 0.5) / fps));
                        seekFailed = false;
                    } catch {
                        seekFailed = true;
                        errorKey = 'smart.capture.seekFailed';
                    }
                }
            })().finally(() => {
                pendingFrame = null;
                seekingTask = null;
                update();
            });
            seekQueue = seekingTask;
        }
        return seekQueue;
    }
    function picture(media, width = media.videoWidth, height = media.videoHeight) {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(media, 0, 0, width, height);
        return canvas;
    }
    async function thumbnails() {
        if(thumbnailsStarted || !ready || mode !== 'custom') return;
        thumbnailsStarted = true;
        try {
            await waitMedia(thumbVideo, 'ready', () => { thumbVideo.src = video.currentSrc || video.src; thumbVideo.load(); });
            for(let i = 0; i < 10 && !closed; i++) {
                await seek(thumbVideo, (metrics().total - 1) / metrics().fps * i / 9);
                const thumb = picture(thumbVideo, 96, 54);
                q('.smart-frame-film').append(thumb);
            }
        } catch { /* Scrubbing remains usable when a source cannot provide a filmstrip. */ }
        finally { thumbVideo.removeAttribute('src'); thumbVideo.load(); }
    }
    async function capture() {
        if(!ready || busy || drafts.length >= 24) return;
        busy = true; video.pause(); update();
        try {
            await seekQueue;
            if(seekFailed) throw new Error('seek');
            if(video.seeking) await waitMedia(video, 'seeked', () => {});
            if(closed) return;
            const frame = metrics().current;
            if(drafts.some(draft => draft.frame === frame)) { errorKey = 'smart.capture.duplicate'; return; }
            const canvas = picture(video);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if(!blob) throw new Error('capture');
            if(closed) return;
            const url = URL.createObjectURL(blob); urls.add(url);
            const draft = {blob, frame, width:canvas.width, height:canvas.height, url}; drafts.push(draft);
            const button = document.createElement('button'); button.type = 'button'; button.dataset.frame = String(frame);
            const img = document.createElement('img'); img.src = url; img.alt = '';
            const number = document.createElement('span'); number.textContent = String(frame);
            const remove = document.createElement('span'); remove.className = 'smart-frame-remove'; remove.textContent = '×'; remove.setAttribute('aria-hidden', 'true');
            button.append(img, number, remove);
            bind(button, 'click', () => {
                if(busy) return;
                drafts.splice(drafts.indexOf(draft), 1); URL.revokeObjectURL(url); urls.delete(url); button.remove(); errorKey = ''; update();
            });
            q('.smart-frame-rail').append(button); button.scrollIntoView({block:'nearest', inline:'nearest'});
            errorKey = '';
        } catch { errorKey = 'smart.capture.failed'; }
        finally { busy = false; update(); }
    }
    async function confirm() {
        if(busy || !drafts.length) return;
        busy = true; video.pause(); update();
        try { await commit(drafts); close(true); }
        catch { errorKey = 'smart.capture.saveFailed'; }
        finally { busy = false; update(); }
    }
    function close(force = false) {
        if(closed || (busy && !force)) return;
        closed = true; abort.abort(); video.pause(); video.loop = originalLoop;
        thumbVideo.pause(); thumbVideo.removeAttribute('src'); thumbVideo.load();
        for(const url of urls) URL.revokeObjectURL(url);
        panel.remove(); onClose();
    }
    bind(slider, 'input', () => { errorKey = ''; seekFrame(Number(slider.value)); });
    bind(q('[data-play]'), 'click', async () => {
        try { if(video.paused) { if(video.ended) await seekFrame(1); await video.play(); } else video.pause(); }
        catch { errorKey = 'smart.capture.playFailed'; update(); }
    });
    bind(q('[data-capture]'), 'click', capture);
    bind(q('[data-add-capture]'), 'click', capture);
    bind(q('[data-confirm]'), 'click', confirm);
    bind(q('[data-close]'), 'click', () => close());
    for(const event of ['pointerdown','mousedown','click','dblclick','wheel']) bind(panel, event, e => e.stopPropagation());
    bind(panel, 'keydown', event => {
        if(event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        else if(event.target === panel && ['ArrowLeft','ArrowRight','Home','End',' '].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            if(busy || !ready) return;
            if(event.key === ' ') q('[data-play]').click();
            else seekFrame(event.key === 'Home' ? 1 : event.key === 'End' ? metrics().total : (pendingFrame ?? metrics().current) + (event.key === 'ArrowLeft' ? -1 : 1));
        } else event.stopPropagation();
    });
    for(const event of ['loadeddata','durationchange','timeupdate','play','pause','seeked','seeking','ended']) bind(video, event, () => { update(); thumbnails(); });
    bind(video, 'error', () => { errorKey = 'smart.capture.loadFailed'; update(); });
    bind(window, 'studio-lang-change', update);
    video.pause(); video.loop = false; update(); position(panel); panel.focus({preventScroll:true});
    const initialization = (async () => {
        try {
            if(!ready) await waitMedia(video, 'ready', () => {});
            update(); thumbnails();
            if(mode !== 'custom') { await seekFrame(mode === 'first' ? 1 : metrics().total); await capture(); if(drafts.length) await confirm(); }
        } catch { errorKey = 'smart.capture.loadFailed'; update(); }
    })();
    return {panel, video, close, update, position:() => position(panel), initialization};
}
