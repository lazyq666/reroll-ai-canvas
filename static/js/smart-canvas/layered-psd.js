/* Persist the current Layer Decomposition Node, then download its server-built PSD. */
(function(root){
    'use strict';

    const PSD_MEDIA_TYPE = 'image/vnd.adobe.photoshop';
    const activeExports = new Set();

    function looksLikePsd(buffer){
        if(!buffer || typeof buffer.byteLength !== 'number' || buffer.byteLength < 40) return false;
        const bytes = new Uint8Array(buffer);
        const view = new DataView(buffer);
        if(
            bytes[0] !== 0x38
            || bytes[1] !== 0x42
            || bytes[2] !== 0x50
            || bytes[3] !== 0x53
            || view.getUint16(4) !== 1
        ) return false;
        for(let offset=6;offset<12;offset+=1){
            if(bytes[offset] !== 0) return false;
        }
        const channels = view.getUint16(12);
        const height = view.getUint32(14);
        const width = view.getUint32(18);
        return channels === 4
            && height > 0
            && width > 0
            && height <= 30000
            && width <= 30000
            && view.getUint16(22) === 8
            && view.getUint16(24) === 3;
    }

    function downloadName(contentDisposition){
        const header = String(contentDisposition || '');
        const extended = header.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
        const fallback = header.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
        let name = extended?.[1] || fallback?.[1] || fallback?.[2] || 'layered-export.psd';
        name = String(name).trim().replace(/^"|"$/g, '');
        if(extended){
            try { name = decodeURIComponent(name); } catch(_error) {}
        }
        name = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^\.+/, '').trim();
        if(!name) name = 'layered-export.psd';
        if(!name.toLowerCase().endsWith('.psd')) name += '.psd';
        return name.slice(0, 128);
    }

    function busy(button, active){
        if(!button) return;
        button.disabled = Boolean(active);
        button.toggleAttribute?.('aria-busy', Boolean(active));
    }

    function triggerDownload(blob, name){
        const href = root.URL.createObjectURL(blob);
        const anchor = root.document.createElement('a');
        anchor.hidden = true;
        anchor.href = href;
        anchor.download = name;
        root.document.body.append(anchor);
        anchor.click();
        anchor.remove();
        root.setTimeout(() => root.URL.revokeObjectURL(href), 0);
    }

    async function download({canvasId='', nodeId=''}={}){
        const normalizedCanvasId = String(canvasId || '').trim();
        const normalizedNodeId = String(nodeId || '').trim();
        const exportKey = `${normalizedCanvasId}\n${normalizedNodeId}`;
        if(!normalizedCanvasId || !normalizedNodeId || activeExports.has(exportKey)) return false;
        const button = root.document.getElementById('layerDecompositionPsdDownload');
        activeExports.add(exportKey);
        busy(button, true);
        try {
            const checkpoint = root.SmartCanvasModules?.canvasPersistence?.checkpoint;
            if(typeof checkpoint !== 'function' || typeof root.fetch !== 'function'){
                throw new Error('layered_psd_unavailable');
            }
            await checkpoint.call(root.SmartCanvasModules.canvasPersistence, {timeout:5000});
            const response = await root.fetch(
                `/api/canvases/${encodeURIComponent(normalizedCanvasId)}/layer-decompositions/${encodeURIComponent(normalizedNodeId)}/psd`,
                {
                    method:'POST',
                    credentials:'same-origin',
                    cache:'no-store',
                    headers:{Accept:PSD_MEDIA_TYPE},
                }
            );
            const mediaType = String(response?.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
            if(!response?.ok || mediaType !== PSD_MEDIA_TYPE) throw new Error('layered_psd_failed');
            const blob = await response.blob();
            const buffer = await blob.arrayBuffer();
            if(!looksLikePsd(buffer)) throw new Error('layered_psd_invalid');
            const name = downloadName(response.headers.get('content-disposition'));
            triggerDownload(blob, name);
            return true;
        } catch(_error){
            const message = typeof root.tr === 'function'
                ? root.tr('smart.layerPsdDownloadFailed')
                : root.StudioI18n?.t?.('smart.layerPsdDownloadFailed') || 'smart.layerPsdDownloadFailed';
            root.toast?.(message, {tone:'danger'});
            return false;
        } finally {
            activeExports.delete(exportKey);
            busy(button, false);
        }
    }

    root.SmartCanvasModules = root.SmartCanvasModules || {};
    root.SmartCanvasModules.layeredPsd = Object.freeze({download});
})(window);
