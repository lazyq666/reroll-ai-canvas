/* Smart Canvas reference-instance identity helpers. */
let smartReferenceInstanceSequence = 0;

function smartReferenceNewInstanceId(prefix='input'){
    const safePrefix = String(prefix || 'input').replace(/[^a-z0-9_-]+/gi, '-');
    if(globalThis.crypto?.randomUUID) return `${safePrefix}_${globalThis.crypto.randomUUID()}`;
    smartReferenceInstanceSequence += 1;
    return `${safePrefix}_${Date.now().toString(36)}_${smartReferenceInstanceSequence.toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
function smartReferenceInstanceKey(reference={}){
    if(!reference?.url) return '';
    if(reference.inputInstanceId) return `instance|${reference.inputInstanceId}`;
    if(reference.outputId) return `output|${reference.outputId}`;
    const nodeId = String(reference.nodeId || '');
    const imageIndex = Number.isFinite(Number(reference.imageIndex))
        ? String(Number(reference.imageIndex))
        : '';
    if(nodeId && imageIndex !== '') return `${nodeId}|${imageIndex}`;
    return `url|${reference.url}`;
}
function smartReferenceUniqueInstances(references=[]){
    const seen = new Set();
    return (references || []).filter(reference => {
        const key = smartReferenceInstanceKey(reference);
        if(!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
function smartReferenceManualInstance(reference={}){
    return {
        ...(reference || {}),
        inputInstanceId:smartReferenceNewInstanceId('manual')
    };
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.referenceInstances = Object.freeze({
    newId:smartReferenceNewInstanceId,
    key:smartReferenceInstanceKey,
    unique:smartReferenceUniqueInstances,
    manual:smartReferenceManualInstance
});
