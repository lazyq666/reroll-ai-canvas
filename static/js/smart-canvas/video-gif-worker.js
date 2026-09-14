import {GIFEncoder, quantize, applyPalette} from '/static/vendor/gifenc/1.0.3/gifenc.esm.js';
const gif = GIFEncoder();
self.onmessage = ({data}) => {
    try {
        if (data.finish) {
            gif.finish();
            const bytes = gif.bytes();
            self.postMessage({bytes}, [bytes.buffer]);
        } else {
            const {pixels, width, height, delay} = data;
            const palette = quantize(pixels, 256);
            gif.writeFrame(applyPalette(pixels, palette), width, height, {palette, delay, repeat:0, dispose:1});
            self.postMessage({ready:true});
        }
    } catch { self.postMessage({error:true}); }
};
