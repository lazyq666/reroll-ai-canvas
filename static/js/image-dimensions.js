/* Shared pixel-dimension validation. Limits come from the model capability catalog. */
(() => {
    function active(width, height) {
        return String(width ?? '') !== '' || String(height ?? '') !== '';
    }
    function validate(widthValue, heightValue, limits) {
        if(!limits) return 'unsupported';
        if(String(widthValue ?? '') === '' || String(heightValue ?? '') === '') return 'incomplete';
        const width = Number(widthValue), height = Number(heightValue);
        if(![width,height].every(value => Number.isFinite(value) && value > 0)) return 'positive';
        if(Math.max(width,height) > limits.maximum_edge) return 'edge';
        if(![width,height].every(value => Number.isInteger(value) && value % limits.multiple === 0)) return 'multiple';
        if(Math.max(width,height) > Math.min(width,height) * limits.maximum_aspect) return 'aspect';
        if(width * height < limits.minimum_pixels) return 'minimum_pixels';
        if(width * height > limits.maximum_pixels) return 'maximum_pixels';
        return '';
    }
    globalThis.RerollImageDimensions = Object.freeze({active,validate});
})();
