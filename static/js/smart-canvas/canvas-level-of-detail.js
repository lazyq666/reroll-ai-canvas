/*
 * Smart Canvas Level of Detail
 *
 * Translates Canvas Viewport scale into one stable presentation mode. It owns
 * the far/detail hysteresis and a resource generation used to reject late
 * media work. It never changes the Smart Canvas model.
 */
(function installCanvasLevelOfDetail(root, factory) {
    const levelOfDetail = factory();
    if (typeof module === 'object' && module.exports) module.exports = levelOfDetail;
    root.SmartCanvasModules = root.SmartCanvasModules || {};
    root.SmartCanvasModules.canvasLevelOfDetail = levelOfDetail;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createCanvasLevelOfDetail() {
    const DEFAULT_ENTER_THRESHOLD = 0.23;
    const EXIT_GAP = 0.05;
    let enabled = true;
    let enterThreshold = DEFAULT_ENTER_THRESHOLD;
    let mode = 'detail';
    let scale = 1;
    let resourceGeneration = 0;
    let resourceDiagnostics = Object.freeze({
        renderSetCount: 0,
        mountedNodeCount: 0,
        warmNodeCount: 0,
        warmMediaCount: 0,
        imagePreviewCounts: Object.freeze({512: 0, 1024: 0, 2048: 0, other: 0}),
        videoElementCount: 0,
        lastMaterializationDuration: 0,
    });

    function clampThreshold(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return DEFAULT_ENTER_THRESHOLD;
        return Math.max(0.1, Math.min(1, number));
    }

    function snapshot(changed = false, previousMode = mode) {
        return Object.freeze({
            mode,
            enabled,
            scale,
            enterThreshold,
            exitThreshold: enterThreshold + EXIT_GAP,
            resourceGeneration,
            ...resourceDiagnostics,
            changed: Boolean(changed),
            previousMode,
        });
    }

    function update(nextScale) {
        const number = Number(nextScale);
        scale = Number.isFinite(number) && number > 0 ? number : 1;
        const previous = mode;
        if (!enabled) mode = 'detail';
        else if (mode === 'detail' && scale < enterThreshold) mode = 'far';
        else if (mode === 'far' && scale > enterThreshold + EXIT_GAP) mode = 'detail';
        const changed = previous !== mode;
        if (changed) resourceGeneration += 1;
        return snapshot(changed, previous);
    }

    function configure(options = {}) {
        const previousEnabled = enabled;
        const previousThreshold = enterThreshold;
        if (Object.prototype.hasOwnProperty.call(options, 'enabled')) enabled = Boolean(options.enabled);
        if (Object.prototype.hasOwnProperty.call(options, 'enterThreshold')) {
            enterThreshold = clampThreshold(options.enterThreshold);
        }
        if (previousEnabled !== enabled || previousThreshold !== enterThreshold) {
            resourceGeneration += 1;
        }
        return update(Object.prototype.hasOwnProperty.call(options, 'scale') ? options.scale : scale);
    }

    function invalidateResources() {
        resourceGeneration += 1;
        return resourceGeneration;
    }

    function noteResources(values = {}) {
        const previewCounts = values.imagePreviewCounts || {};
        resourceDiagnostics = Object.freeze({
            renderSetCount: Math.max(0, Number(values.renderSetCount) || 0),
            mountedNodeCount: Math.max(0, Number(values.mountedNodeCount) || 0),
            warmNodeCount: Math.max(0, Number(values.warmNodeCount) || 0),
            warmMediaCount: Math.max(0, Number(values.warmMediaCount) || 0),
            imagePreviewCounts: Object.freeze({
                512: Math.max(0, Number(previewCounts[512]) || 0),
                1024: Math.max(0, Number(previewCounts[1024]) || 0),
                2048: Math.max(0, Number(previewCounts[2048]) || 0),
                other: Math.max(0, Number(previewCounts.other) || 0),
            }),
            videoElementCount: Math.max(0, Number(values.videoElementCount) || 0),
            lastMaterializationDuration: Math.max(0, Number(values.lastMaterializationDuration) || 0),
        });
        return snapshot(false);
    }

    function reset(options = {}) {
        enabled = Object.prototype.hasOwnProperty.call(options, 'enabled')
            ? Boolean(options.enabled)
            : true;
        enterThreshold = clampThreshold(options.enterThreshold ?? DEFAULT_ENTER_THRESHOLD);
        mode = 'detail';
        scale = 1;
        resourceGeneration = 0;
        resourceDiagnostics = Object.freeze({
            renderSetCount: 0,
            mountedNodeCount: 0,
            warmNodeCount: 0,
            warmMediaCount: 0,
            imagePreviewCounts: Object.freeze({512: 0, 1024: 0, 2048: 0, other: 0}),
            videoElementCount: 0,
            lastMaterializationDuration: 0,
        });
        return update(options.scale ?? 1);
    }

    return Object.freeze({
        configure,
        update,
        diagnostics: snapshot,
        invalidateResources,
        noteResources,
        reset,
    });
});
