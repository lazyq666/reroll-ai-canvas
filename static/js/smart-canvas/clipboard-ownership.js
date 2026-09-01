/*
 * Smart Canvas clipboard ownership
 *
 * The system clipboard marker proves which Node Package was copied last.
 * The marker intentionally contains no Canvas content.
 */
(function initSmartCanvasClipboardOwnership(global){
    const VERSION = 2;
    const MIME = 'application/x-infinite-canvas-node-clipboard';

    function newCopyId(){
        if(global.crypto?.randomUUID) return global.crypto.randomUUID();
        if(global.crypto?.getRandomValues){
            const bytes = new Uint8Array(16);
            global.crypto.getRandomValues(bytes);
            return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
        }
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    function markerText(copyId){
        return JSON.stringify({version:VERSION, copyId:String(copyId || '')});
    }

    function writeMarker(dataTransfer, copyId){
        const value = markerText(copyId);
        if(!dataTransfer?.setData || !copyId) return false;
        try {
            dataTransfer.setData(MIME, value);
            return dataTransfer.getData?.(MIME) === value;
        } catch(_error){
            return false;
        }
    }

    function readMarker(dataTransfer){
        if(!dataTransfer?.getData) return null;
        try {
            const marker = JSON.parse(dataTransfer.getData(MIME) || 'null');
            if(Number(marker?.version) !== VERSION || !String(marker?.copyId || '')) return null;
            return {version:VERSION, copyId:String(marker.copyId)};
        } catch(_error){
            return null;
        }
    }

    function matches(marker, payload){
        return Number(marker?.version) === VERSION
            && Number(payload?.version) === VERSION
            && Boolean(marker?.copyId)
            && marker.copyId === payload.copyId;
    }

    global.SmartCanvasModules = global.SmartCanvasModules || {};
    global.SmartCanvasModules.clipboardOwnership = Object.freeze({
        VERSION,
        MIME,
        newCopyId,
        markerText,
        writeMarker,
        readMarker,
        matches
    });
})(window);
