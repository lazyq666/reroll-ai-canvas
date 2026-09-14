const ERROR_KEYS = new Set(['videoLimit', 'videoLoadFailed', 'videoMissing', 'videoDecodeFailed', 'videoSeekFailed', 'videoEncodeFailed', 'videoReadFailed']);

export function videoGifErrorMessage(error, translate = key => window.StudioI18n.t(`smart.gif.${key}`)) {
    return translate(ERROR_KEYS.has(error?.code) ? error.code : 'videoFailed');
}

function failure(code, cause) {
    return Object.assign(new Error(videoGifErrorMessage({code}), {cause}), {code});
}

export function videoGifPlan(duration, width, height) {
    if (!Number.isFinite(duration) || duration <= 0 || duration > 30) throw failure('videoLimit');
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw failure('videoDecodeFailed');
    const scale = Math.min(1, 640 / Math.max(width, height));
    return {width:Math.max(1, Math.round(width * scale)), height:Math.max(1, Math.round(height * scale)), frames:Math.ceil(duration * 10)};
}

export async function createVideoGif({sourceUrl}) {
    const video = document.createElement('video');
    video.muted = true; video.preload = 'auto';
    let worker, objectUrl;
    const waitMedia = (event, action, code) => new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener('error', failed); };
        const done = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(failure(code)); };
        const timer = setTimeout(failed, 15000);
        video.addEventListener(event, done, {once:true}); video.addEventListener('error', failed, {once:true});
        try { action(); } catch { failed(); }
    });
    try {
        // Download through the application's media route first. A local blob
        // supports seeking even when the source server does not support ranges.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60000);
        try {
            const response = await fetch(sourceUrl, {signal:controller.signal});
            if (response.status === 404 || response.status === 410) throw failure('videoMissing');
            if (!response.ok || /text\/html|application\/json/i.test(response.headers.get('content-type') || '')) throw failure('videoLoadFailed');
            const blob = await response.blob();
            if (!blob.size) throw failure('videoLoadFailed');
            objectUrl = URL.createObjectURL(blob);
        } catch (error) {
            throw ERROR_KEYS.has(error.code) ? error : failure('videoLoadFailed', error);
        } finally { clearTimeout(timer); }
        await waitMedia('loadeddata', () => { video.src = objectUrl; video.load(); }, 'videoDecodeFailed');
        if (!Number.isFinite(video.duration)) {
            await waitMedia('seeked', () => { video.currentTime = 1e6; }, 'videoSeekFailed');
        }
        const {width, height, frames} = videoGifPlan(video.duration, video.videoWidth, video.videoHeight);
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d', {willReadFrequently:true});
        try { worker = new Worker(new URL('./video-gif-worker.js?v=1', import.meta.url), {type:'module'}); }
        catch (error) { throw failure('videoEncodeFailed', error); }
        const send = (data, transfer = []) => new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(failure('videoEncodeFailed')), 30000);
            worker.onmessage = ({data}) => { clearTimeout(timer); data.error ? reject(failure('videoEncodeFailed')) : resolve(data); };
            worker.onerror = () => { clearTimeout(timer); reject(failure('videoEncodeFailed')); };
            try { worker.postMessage(data, transfer); }
            catch (error) { clearTimeout(timer); reject(failure('videoEncodeFailed', error)); }
        });
        for (let index = 0; index < frames; index++) {
            const time = index / 10;
            if (video.currentTime !== time) await waitMedia('seeked', () => { video.currentTime = time; }, 'videoSeekFailed');
            let pixels;
            try {
                ctx.drawImage(video, 0, 0, width, height);
                pixels = ctx.getImageData(0, 0, width, height).data;
            } catch (error) { throw failure('videoReadFailed', error); }
            await send({pixels, width, height, delay:Math.max(10, Math.round(Math.min(.1, video.duration-time)*1000))}, [pixels.buffer]);
        }
        const {bytes} = await send({finish:true});
        return {blob:new Blob([bytes], {type:'image/gif'}), width, height};
    } catch (error) {
        throw ERROR_KEYS.has(error.code) ? error : failure('videoFailed', error);
    } finally {
        worker?.terminate(); video.pause(); video.removeAttribute('src'); video.load();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
}
