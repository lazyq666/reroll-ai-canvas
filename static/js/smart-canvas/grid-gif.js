const ERROR_KEYS = new Set(['noTransparency','emptySource','countMismatch','tooComplex','invalid','invalidBoundaries']);

export function gridGifErrorMessage(error, translate = key => window.StudioI18n.t(`smart.gif.${key}`)) {
    return translate(ERROR_KEYS.has(error?.code) ? error.code : 'failed')
        .replace('{detected}', error?.detected ?? '').replace('{expected}', error?.expected ?? '');
}

async function processGridGif({sourceUrl, rows, cols, delay, fillColor, signal, boundaries, anchors, transparent = false}, analyzeOnly) {
    const fail = (detail = {}) => Object.assign(new Error(gridGifErrorMessage(detail)), detail);
    let bitmap;
    try {
        const response = await fetch(sourceUrl, {signal});
        if (!response.ok) throw fail();
        bitmap = await createImageBitmap(await response.blob());
        if (bitmap.width * bitmap.height > 64_000_000) throw fail();
    } catch {
        bitmap?.close();
        throw fail();
    }
    return new Promise((resolve, reject) => {
        let worker;
        const cleanup = () => { clearTimeout(timer); worker?.terminate(); bitmap?.close(); signal?.removeEventListener('abort', abort); };
        const abort = () => { cleanup(); reject(fail()); };
        const timer = setTimeout(() => { cleanup(); reject(fail()); }, 120_000);
        try {
            if (signal?.aborted) { abort(); return; }
            signal?.addEventListener('abort', abort, {once:true});
            worker = new Worker(new URL('./grid-gif-worker.js?v=4', import.meta.url), {type:'module'});
            worker.onmessage = ({data}) => {
                cleanup();
                if (data.error) reject(fail(data.error));
                else resolve(analyzeOnly ? data : {...data, blob:new Blob([data.bytes], {type:'image/gif'})});
            };
            worker.onerror = () => { cleanup(); reject(fail()); };
            worker.postMessage({bitmap, rows, cols, delay, fillColor, analyzeOnly, boundaries, anchors, transparent}, [bitmap]);
            bitmap = null;
        } catch {
            cleanup(); reject(fail());
        }
    });
}

export const createGridGif = options => processGridGif(options, false);
export const analyzeGridGif = options => processGridGif(options, true);
