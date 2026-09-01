(function(root, factory){
    const api = factory();
    if(typeof module === 'object' && module.exports) module.exports = api;
    if(root) root.SmartImageResolution = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
    const PREVIEW_SIZES = Object.freeze([512, 1024, 2048]);

    function renderedPixelLongSide({width=0, height=0, canvasScale=1, devicePixelRatio=1}={}){
        const displayLongSide = Math.max(0, Number(width) || 0, Number(height) || 0);
        const scale = Math.max(0.01, Number(canvasScale) || 1);
        const dpr = Math.max(1, Number(devicePixelRatio) || 1);
        return displayLongSide * scale * dpr;
    }

    function choosePreviewSize(metrics={}){
        const requiredPixels = renderedPixelLongSide(metrics);
        const target = PREVIEW_SIZES.find(size => requiredPixels <= size) || PREVIEW_SIZES[PREVIEW_SIZES.length - 1];
        const currentSize = Number(metrics.currentSize) || 0;
        const currentIndex = PREVIEW_SIZES.indexOf(currentSize);
        if(currentIndex < 0 || target === currentSize) return target;

        if(target > currentSize && requiredPixels <= currentSize * 1.1) return currentSize;
        const previousSize = PREVIEW_SIZES[currentIndex - 1] || 0;
        if(target < currentSize && previousSize && requiredPixels >= previousSize * 0.9) return currentSize;
        return target;
    }

    return Object.freeze({PREVIEW_SIZES, renderedPixelLongSide, choosePreviewSize});
});
