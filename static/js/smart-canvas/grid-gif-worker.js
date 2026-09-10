import { GIFEncoder, quantize, applyPalette } from '/static/vendor/gifenc/1.0.3/gifenc.esm.js';
import {extractSpriteFrames, spriteFramePixels} from './sprite-components.js?v=2';

// Encode off the UI thread, retaining only one uncompressed frame at a time.
self.onmessage = ({data:{bitmap, rows, cols, delay, fillColor, analyzeOnly, boundaries, anchors, transparent = false}}) => {
    try {
        if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1
            || rows > 12 || cols > 12 || rows * cols < 2 || rows * cols > 144
            || ![500, 250, 100, 70, 50].includes(delay) || !/^#[0-9a-f]{6}$/i.test(fillColor) || typeof transparent !== 'boolean'
            || bitmap.width < cols || bitmap.height < rows || bitmap.width * bitmap.height > 64_000_000) {
            throw new Error('invalid');
        }
        const sourceCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const sourceContext = sourceCanvas.getContext('2d', {willReadFrequently:true});
        sourceContext.drawImage(bitmap, 0, 0);
        const source = sourceContext.getImageData(0, 0, bitmap.width, bitmap.height);
        const plan = extractSpriteFrames(source, {rows, cols, boundaries, anchors});
        const {width, height, frames} = plan;
        const summary = {width, height, frames:frames.length, sprites:frames, fragments:plan.fragments,
            boundaries:plan.boundaries, anchors:plan.anchors, boundaryConflicts:plan.boundaryConflicts};
        if (analyzeOnly) { self.postMessage(summary); return; }
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d', {willReadFrequently:true});
        const gif = GIFEncoder();
        for (const frame of frames) {
            // Copy only pixels belonging to this sprite, even when another
            // character lies inside its rectangular bounds.
            const pixels = spriteFramePixels(source, plan, frame);
            if (transparent) {
                // GIF supports one transparent palette entry, not partial alpha.
                // Quantize visible pixels only; reserve index 0 so opaque black
                // pixels can never accidentally become transparent.
                let visibleCount = 0;
                for (let p = 3; p < pixels.length; p += 4) if (pixels[p] >= 128) visibleCount++;
                const visible = new Uint8ClampedArray(visibleCount * 4);
                for (let p = 0, next = 0; p < pixels.length; p += 4) {
                    if (pixels[p + 3] >= 128) { visible.set(pixels.subarray(p, p + 4), next); next += 4; }
                }
                const colors = visibleCount ? quantize(visible, 255) : [[0, 0, 0]];
                const indices = applyPalette(pixels, colors);
                for (let p = 0; p < indices.length; p++) indices[p] = pixels[p * 4 + 3] >= 128 ? indices[p] + 1 : 0;
                gif.writeFrame(indices, width, height, {
                    palette:[[0, 0, 0], ...colors], delay, repeat:0,
                    transparent:true, transparentIndex:0, dispose:2,
                });
                continue;
            }
            ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = fillColor;
            ctx.fillRect(0, 0, width, height);
            ctx.globalCompositeOperation = 'source-over';
            const rgba = ctx.getImageData(0, 0, width, height).data;
            const palette = quantize(rgba, 255);
            // Keep the user's exact background color in each frame's palette.
            palette.push([1, 3, 5].map(offset => parseInt(fillColor.slice(offset, offset + 2), 16)));
            gif.writeFrame(applyPalette(rgba, palette), width, height, {palette, delay, repeat:0, dispose:1});
        }
        gif.finish();
        const bytes = gif.bytes();
        self.postMessage({bytes, ...summary}, [bytes.buffer]);
    } catch (error) {
        self.postMessage({error:{code:error.message, detected:error.detected, expected:error.expected}});
    } finally {
        bitmap?.close();
    }
};
