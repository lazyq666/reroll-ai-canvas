(function(root){
    'use strict';

    // Display vocabulary is independent of the selected generation model.
    const PRESETS = [
        [1,1],[2,3],[3,2],[3,4],[4,3],[9,16],[16,9],[21,9],[9,21],
        [5,4],[4,5],[2,1],[1,2],[3,1],[1,3],[4,1],[1,4],[8,1],[1,8]
    ];
    const MAX_EXACT_PART = 20;
    const MAX_CROP_LOSS = 0.01;

    function pixel(value){
        if(typeof value !== 'number' && typeof value !== 'string') return 0;
        const number = Number(value);
        return Number.isSafeInteger(number) && number > 0 ? number : 0;
    }

    function dimensions(image){
        // Never mix a natural width with a fallback height or use preview/layout sizes.
        for(const [widthKey,heightKey] of [['natural_w','natural_h'],['width','height'],['w','h']]){
            const width = pixel(image?.[widthKey]);
            const height = pixel(image?.[heightKey]);
            if(width && height) return {width,height};
        }
        return null;
    }

    function gcd(a,b){
        while(b){ const remainder = a % b; a = b; b = remainder; }
        return a;
    }

    function aspectRatio(width,height){
        width = pixel(width);
        height = pixel(height);
        if(!width || !height) return null;
        const divisor = gcd(width,height);
        const reducedWidth = width / divisor;
        const reducedHeight = height / divisor;
        const exact = PRESETS.find(([w,h]) => {
            const divisor = gcd(w,h);
            return reducedWidth === w / divisor && reducedHeight === h / divisor;
        });
        if(exact) return {width:exact[0],height:exact[1],approximate:false};
        if(Math.max(reducedWidth,reducedHeight) <= MAX_EXACT_PART){
            return {width:reducedWidth,height:reducedHeight,approximate:false};
        }
        const actual = width / height;
        let nearest = null;
        let nearestError = Infinity;
        for(const [w,h] of PRESETS){
            const candidate = w / h;
            const error = 1 - Math.min(actual / candidate, candidate / actual);
            if(error < nearestError){
                nearest = {width:w,height:h,approximate:false};
                nearestError = error;
            }
        }
        // Within tolerance, present the familiar preset without an approximation marker.
        // The small epsilon only absorbs floating-point noise at the inclusive 1% boundary.
        if(nearestError <= MAX_CROP_LOSS + Number.EPSILON * 8) return nearest;
        const longPart = Number((Math.max(width,height) / Math.min(width,height)).toFixed(2));
        const w = width >= height ? longPart : 1;
        const h = width >= height ? 1 : longPart;
        return {width:w,height:h,approximate:true};
    }

    const metadata = Object.freeze({dimensions,aspectRatio});
    if(typeof module === 'object' && module.exports) module.exports = metadata;
    else {
        root.SmartCanvasModules = root.SmartCanvasModules || {};
        root.SmartCanvasModules.imageMetadata = metadata;
    }
})(typeof window !== 'undefined' ? window : globalThis);
