import {automaticOwnershipBoundaries, validOwnershipBoundaries, createOwnershipResolver} from './sprite-ownership.js?v=2';

// Pure geometry: no grid boundary participates in extracting a sprite.
const CORE_ALPHA = 8;
const MAX_COMPONENTS = 65534;
const PADDING = 2;

function neighbors(index, width, height, visit) {
    const x = index % width, y = Math.floor(index / width);
    for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
            if (nx !== x || ny !== y) visit(ny * width + nx);
        }
    }
}

function connectedComponents(data, width, height) {
    const labels = new Uint16Array(width * height);
    const components = [];
    let transparent = false;
    for (let start = 0; start < labels.length; start++) {
        if (data[start * 4 + 3] <= CORE_ALPHA) { transparent = true; continue; }
        if (labels[start]) continue;
        if (components.length >= MAX_COMPONENTS) throw new Error('tooComplex');
        const id = components.length + 1;
        const component = {id, area:0, sumX:0, sumY:0, x:width, y:height, right:0, bottom:0};
        const stack = [start];
        // A scanline flood avoids a per-pixel JS queue on solid sprites.
        while (stack.length) {
            const seed = stack.pop();
            if (labels[seed] || data[seed * 4 + 3] <= CORE_ALPHA) continue;
            const y = Math.floor(seed / width);
            let left = seed % width;
            while (left > 0 && !labels[y * width + left - 1] && data[(y * width + left - 1) * 4 + 3] > CORE_ALPHA) left--;
            let right = left;
            while (right < width && !labels[y * width + right] && data[(y * width + right) * 4 + 3] > CORE_ALPHA) {
                labels[y * width + right] = id;
                component.area++; component.sumX += right; component.sumY += y;
                right++;
            }
            component.x = Math.min(component.x, left); component.right = Math.max(component.right, right);
            component.y = Math.min(component.y, y); component.bottom = Math.max(component.bottom, y + 1);
            for (const adjacentY of [y - 1, y + 1]) {
                if (adjacentY < 0 || adjacentY >= height) continue;
                let inRun = false;
                for (let x = Math.max(0, left - 1); x < Math.min(width, right + 1); x++) {
                    const adjacent = adjacentY * width + x;
                    const visible = !labels[adjacent] && data[adjacent * 4 + 3] > CORE_ALPHA;
                    if (visible && !inRun) stack.push(adjacent);
                    inRun = visible;
                }
            }
        }
        component.cx = component.sumX / component.area;
        component.cy = component.sumY / component.area;
        components.push(component);
    }
    if (!transparent) throw new Error('noTransparency');
    if (!components.length) throw new Error('emptySource');

    // Restore faint anti-aliased edges after labeling. Weak alpha bridges cannot
    // merge two characters: each extra pixel inherits one existing component.
    const queue = [];
    for (let p = 0; p < labels.length; p++) {
        const alpha = data[p * 4 + 3];
        if (!alpha || alpha > CORE_ALPHA) continue;
        let owner = 0;
        neighbors(p, width, height, n => {
            if (!owner && data[n * 4 + 3] > CORE_ALPHA) owner = labels[n];
        });
        if (owner) { labels[p] = owner; queue.push(p); }
    }
    for (let cursor = 0; cursor < queue.length; cursor++) {
        const p = queue[cursor], id = labels[p], component = components[id - 1];
        const x = p % width, y = Math.floor(p / width);
        component.x = Math.min(component.x, x); component.right = Math.max(component.right, x + 1);
        component.y = Math.min(component.y, y); component.bottom = Math.max(component.bottom, y + 1);
        neighbors(p, width, height, n => {
            if (!labels[n] && data[n * 4 + 3] > 0) { labels[n] = id; queue.push(n); }
        });
    }
    return {labels, components};
}

function bodyAnchor(body, source, labels, rows, cols) {
    // Use the lower body/feet, not the bounding-box center of a growing effect.
    const rowCounts = new Uint32Array(source.height);
    for (let y = body.y; y < body.bottom; y++) for (let x = body.x; x < body.right; x++) {
        const p = y * source.width + x;
        if (labels[p] === body.id && source.data[p * 4 + 3] > CORE_ALPHA) rowCounts[y]++;
    }
    const minimum = Math.max(1, Math.round(source.width / cols * .03));
    let foot = body.bottom - 1;
    while (foot > body.y && rowCounts[foot] < minimum) foot--;
    const bandTop = Math.max(body.y, foot - Math.max(1, Math.round(source.height / rows * .2)));
    let sum = 0, count = 0;
    for (let y = bandTop; y <= foot; y++) for (let x = body.x; x < body.right; x++) {
        const p = y * source.width + x;
        if (labels[p] === body.id && source.data[p * 4 + 3] > CORE_ALPHA) { sum += x; count++; }
    }
    return {x:Math.round(count ? sum / count : body.cx), y:foot};
}

function locateBodies(source, labels, components, rows, cols) {
    const bodies = [];
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const votes = new Uint32Array(components.length + 1);
        const x0 = Math.floor((col + .2) * source.width / cols), x1 = Math.ceil((col + .8) * source.width / cols);
        const y0 = Math.floor((row + .4) * source.height / rows), y1 = Math.ceil((row + .98) * source.height / rows);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const p = y * source.width + x;
            if (source.data[p * 4 + 3] > CORE_ALPHA) votes[labels[p]]++;
        }
        let selected = 0;
        for (let id = 1; id < votes.length; id++) if (votes[id] > votes[selected]) selected = id;
        if (selected && votes[selected]) bodies.push(components[selected - 1]);
    }
    if (bodies.length !== rows * cols || new Set(bodies.map(body => body.id)).size !== rows * cols) {
        const error = new Error('countMismatch');
        error.detected = new Set(bodies.map(body => body.id)).size; error.expected = rows * cols;
        throw error;
    }
    return bodies;
}

export function extractSpriteFrames(source, {rows, cols, boundaries = null, anchors = null}) {
    const {data, width, height} = source;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
        || width * height > 64_000_000 || data.length !== width * height * 4
        || !Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1
        || rows > 12 || cols > 12 || rows * cols < 2) throw new Error('invalid');
    if (boundaries && !validOwnershipBoundaries(boundaries, rows, cols)) throw new Error('invalidBoundaries');
    if (anchors && (anchors.length !== rows * cols || anchors.some(a => !Number.isFinite(a.x) || !Number.isFinite(a.y)
        || a.x < 0 || a.x >= width || a.y < 0 || a.y >= height))) throw new Error('invalid');
    const {labels, components} = connectedComponents(data, width, height);
    const ordered = locateBodies(source, labels, components, rows, cols);
    boundaries = boundaries || automaticOwnershipBoundaries(source, labels, ordered, rows, cols);
    const regionAt = createOwnershipResolver(boundaries);
    const owners = new Uint16Array(components.length + 1);
    const resolvedAnchors = ordered.map((body, index) => {
        const anchor = anchors?.[index] || bodyAnchor(body, source, labels, rows, cols);
        return {x:Math.min(width - 1, Math.round(anchor.x)), y:Math.min(height - 1, Math.round(anchor.y))};
    });
    const frames = ordered.map((body, index) => {
        owners[body.id] = index + 1;
        const anchor = resolvedAnchors[index];
        return {x:body.x, y:body.y, right:body.right, bottom:body.bottom,
            anchorX:anchor.x, anchorY:anchor.y, index};
    });
    const fragments = [];
    for (const fragment of components) {
        if (owners[fragment.id]) continue;
        const votes = new Uint32Array(rows * cols);
        // Vote using all visible pixels in a particle, then retain the whole
        // component. Automatic or edited polylines decide ownership.
        for (let y = fragment.y; y < fragment.bottom; y++) for (let x = fragment.x; x < fragment.right; x++) {
            const p = y * width + x;
            if (labels[p] === fragment.id && data[p * 4 + 3] > CORE_ALPHA) votes[regionAt((x+.5)/width,(y+.5)/height)]++;
        }
        let assigned = regionAt( fragment.cx / width, fragment.cy / height);
        for (let index = 0; index < votes.length; index++) if (votes[index] > votes[assigned]) assigned = index;
        owners[fragment.id] = assigned + 1;
        const frame = frames[assigned];
        frame.x = Math.min(frame.x, fragment.x); frame.y = Math.min(frame.y, fragment.y);
        frame.right = Math.max(frame.right, fragment.right); frame.bottom = Math.max(frame.bottom, fragment.bottom);
        fragments.push({area:fragment.area,x:fragment.x,y:fragment.y,w:fragment.right-fragment.x,h:fragment.bottom-fragment.y,index:assigned});
    }
    const left = Math.max(...frames.map(frame => frame.anchorX - frame.x)) + PADDING;
    const right = Math.max(...frames.map(frame => frame.right - frame.anchorX)) + PADDING;
    const top = Math.max(...frames.map(frame => frame.anchorY - frame.y)) + PADDING;
    const bottom = Math.max(...frames.map(frame => frame.bottom - frame.anchorY)) + PADDING;
    for (const frame of frames) {
        frame.w = frame.right - frame.x; frame.h = frame.bottom - frame.y;
        frame.offsetX = left - frame.anchorX; frame.offsetY = top - frame.anchorY;
    }
    if ((left + right) * (top + bottom) * frames.length > 64_000_000) throw new Error('tooComplex');
    // Surface unresolved geometry instead of presenting a fallback seam as a
    // confident automatic result. Pixel extraction still retains whole parts.
    const conflicts = new Set();
    for (let p = 0; p < labels.length; p++) {
        if (!labels[p] || data[p * 4 + 3] <= CORE_ALPHA) continue;
        const region = regionAt( (p % width + .5) / width, (Math.floor(p / width) + .5) / height);
        if (owners[labels[p]] !== region + 1) conflicts.add(labels[p]);
    }
    return {labels, owners, frames, fragments, boundaries, boundaryConflicts:conflicts.size,
        anchors:resolvedAnchors, width:left + right, height:top + bottom};
}

export function spriteFramePixels(source, plan, frame) {
    const pixels = new Uint8ClampedArray(plan.width * plan.height * 4);
    for (let y = frame.y; y < frame.bottom; y++) {
        for (let x = frame.x; x < frame.right; x++) {
            const input = y * source.width + x;
            if (plan.owners[plan.labels[input]] !== frame.index + 1) continue;
            const output = ((y + frame.offsetY) * plan.width + x + frame.offsetX) * 4;
            pixels.set(source.data.subarray(input * 4, input * 4 + 4), output);
        }
    }
    return pixels;
}
