/* Identity-only references. No selection expansion, content serialization or writes. */
(function(root, factory){
    const api = factory();
    if(typeof module === 'object' && module.exports) module.exports = api;
    root.SmartCanvasModules = root.SmartCanvasModules || {};
    root.SmartCanvasModules.nodeReference = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function(){
    const MAX_NODES = 1000, MAX_BYTES = 131072;
    const failure = code => Object.assign(new Error(code), {code});
    function format({workspace_id, canvas_id, node_ids}){
        const ids = [...new Set(node_ids || [])];
        if(!ids.length || [workspace_id,canvas_id,...ids].some(id =>
            typeof id !== 'string' || !id || /[\x00-\x1f\x7f]/.test(id))) throw failure('referenceChanged');
        if(ids.length > MAX_NODES) throw failure('referenceTooLarge');
        let text;
        try {
            text = `Reroll workspace=${encodeURIComponent(workspace_id)} canvas=${encodeURIComponent(canvas_id)} nodes=${ids.map(encodeURIComponent).join(',')}`;
        } catch { throw failure('referenceChanged'); }
        if(text.length > MAX_BYTES) throw failure('referenceTooLarge'); // Encoded text is ASCII.
        return text;
    }
    function shortcut(event, platform){
        return !event.defaultPrevented && !event.repeat && !event.altKey && !event.shiftKey
            && String(event.key).toLowerCase() === 'l'
            && (platform === 'apple' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
    }
    function createCopyAction({capture, save, validate, write, notify}){
        let pending = false;
        return async function copy(){
            if(pending) return false;
            let waiting, preparation, stage = 'referenceSaveFailed';
            pending = true;
            try {
                const target = capture();
                const text = format(target);
                waiting = setTimeout(() => notify('referenceSaving'), 300);
                // Start the clipboard operation in the original user gesture;
                // its text promise resolves only after persistence and validation.
                preparation = (async () => {
                    await save(target);
                    await validate(target, text);
                    stage = 'referenceClipboardFailed';
                    return text;
                })();
                // A rejected data promise does not settle every browser's pending
                // clipboard write promptly. Observe persistence independently.
                await Promise.all([write(preparation), preparation]);
                notify(target.node_ids.length === 1 ? 'referenceCopiedOne' : 'referenceCopiedMany', target.node_ids.length);
                return true;
            } catch(error) {
                // Consume a late save rejection if the browser rejected clipboard
                // access first. It must never produce a later success notification.
                preparation?.catch(() => {});
                const code = error?.code;
                notify(['referenceChanged','referenceTooLarge'].includes(code) ? code
                    : error?.name === 'NotAllowedError' ? 'referenceClipboardFailed' : stage);
                return false;
            } finally {
                clearTimeout(waiting);
                pending = false;
            }
        };
    }
    return Object.freeze({format, shortcut, createCopyAction});
});
