// Shared piecewise-linear ownership boundaries. Coordinates are normalized;
// each vertical point's y is relative to its own row band.
export function createOwnershipBoundaries(rows, cols) {
    return {
        rowCuts:Array.from({length:rows + 1}, (_, i) => i / rows),
        columns:Array.from({length:rows}, () => Array.from({length:cols - 1}, (_, col) =>
            [0, .25, .5, .75, 1].map(y => ({x:(col + 1) / cols, y})))),
    };
}

export function boundaryX(points, y) {
    if (y <= points[0].y) return points[0].x;
    if (y >= points.at(-1).y) return points.at(-1).x;
    let low = 1, high = points.length - 1;
    while (low < high) { const mid = (low + high) >> 1; if (points[mid].y < y) low = mid + 1; else high = mid; }
    const next = low;
    const a = points[next - 1], b = points[next];
    return a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y);
}

export function validOwnershipBoundaries(value, rows, cols) {
    if (!value || value.rowCuts?.length !== rows + 1 || value.columns?.length !== rows
        || value.rowCuts[0] !== 0 || value.rowCuts[rows] !== 1) return false;
    if (value.rowCuts.some((y, i) => !Number.isFinite(y) || y < 0 || y > 1 || (i && y <= value.rowCuts[i - 1]))) return false;
    if (value.rowLines && (value.rowLines.length !== rows - 1 || !validLines(value.rowLines))) return false;
    return value.columns.every(lines => lines.length === cols - 1 && validLines(lines));
}

function validLines(lines) {
    if (lines.some(points => !Array.isArray(points) || points.length < 2 || points.length > 4096
        || points[0].y !== 0 || points.at(-1).y !== 1
        || points.some((p, i) => !Number.isFinite(p.x) || !Number.isFinite(p.y)
            || p.x <= 0 || p.x >= 1 || p.y < 0 || p.y > 1 || (i && p.y <= points[i - 1].y)))) return false;
    const levels = [...new Set(lines.flatMap(points => points.map(point => point.y)))];
    return levels.every(y => lines.every((points, i) => !i || boundaryX(points, y) > boundaryX(lines[i - 1], y)));
}

// A seam treats complete bodies as side constraints and detached pixels as
// obstacles. Search lanes keep boundaries ordered; proximity does not assign
// effects. Explicit user boundaries bypass automatic placement.
function traceSeam(source, labels, sides, {top, bottom, start, end, nominal, cellSize, transpose = false}) {
    const {data} = source;
    const width = transpose ? source.height : source.width;
    const height = transpose ? source.width : source.height;
    const pixel = transpose ? (x, y) => x * source.width + y : (x, y) => y * source.width + x;
    const bandHeight = bottom - top;
    const span = end - start + 1;
    if (span < 1 || bandHeight < 1) return [{x:nominal / width,y:0},{x:nominal / width,y:1}];

    const costs = new Float32Array(span * bandHeight);
    const radius = Math.max(1, Math.min(4, Math.round(cellSize / 100)));
    const prefix = new Uint32Array(width + 1);
    for (let y = top; y < bottom; y++) {
        let left = 0, right = width;
        prefix.fill(0);
        for (let x = 0; x < width; x++) {
            const p = pixel(x, y), side = sides.get(labels[p]);
            if (side !== undefined) {
                if (side < 0) left = Math.max(left, x + 1);
                else right = Math.min(right, x);
            }
            // A small clearance around visible pixels joins tiny gaps
            // in an effect trail without merging the actual sprites.
            let ink = 0;
            for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy++) {
                if (data[pixel(x, yy) * 4 + 3] > 8) ink++;
            }
            prefix[x + 1] = prefix[x] + ink;
        }
        for (let x = start; x <= end; x++) {
            const ink = prefix[Math.min(width, x + radius + 1)] - prefix[Math.max(0, x - radius)];
            const violation = Math.max(0, left + 1 - x) + Math.max(0, x - right + 1);
            costs[(y - top) * span + x - start] = violation * 100000 + ink * 100
                + Math.abs(x - nominal) / Math.max(1, cellSize);
        }
    }
    let previous = Float64Array.from(costs.subarray(0, span)), current = new Float64Array(span);
    const back = new Int8Array(costs.length);
    for (let y = 1; y < bandHeight; y++) {
        for (let x = 0; x < span; x++) {
            let best = Infinity, delta = 0;
            for (let step = -2; step <= 2; step++) {
                const from = x + step;
                if (from < 0 || from >= span) continue;
                const cost = previous[from] + Math.abs(step) * .4;
                if (cost < best) { best = cost; delta = step; }
            }
            current[x] = best + costs[y * span + x]; back[y * span + x] = delta;
        }
        [previous, current] = [current, previous];
    }
    let last = 0;
    for (let x = 1; x < span; x++) if (previous[x] < previous[last]) last = x;
    const path = new Int32Array(bandHeight);
    for (let y = bandHeight - 1; y >= 0; y--) { path[y] = start + last; last += back[y * span + last]; }
    // Simplify only when the replacement has no greater obstacle cost.
    // This avoids reintroducing collisions while reducing edit handles.
    const vertices = new Set([0, bandHeight - 1]);
    const segments = [[0, bandHeight - 1]];
    while (segments.length) {
        const [from, to] = segments.pop();
        let split = -1, deviation = 0;
        for (let y = from + 1; y < to; y++) {
            const x = path[from] + (path[to] - path[from]) * (y - from) / (to - from);
            const at = y * span + Math.round(x) - start;
            const error = Math.abs(x - path[y]);
            const blocked = costs[at] > costs[y * span + path[y] - start] + 1;
            const score = error + (blocked ? 1000 : 0);
            if ((error > 1 || blocked) && score > deviation) { deviation = score; split = y; }
        }
        if (split >= 0) { vertices.add(split); segments.push([from, split], [split, to]); }
    }
    const points = [{x:path[0] / width, y:0},
        ...[...vertices].sort((a,b) => a-b).map(y => ({x:path[y] / width, y:(y + .5) / bandHeight})),
        {x:path[bandHeight - 1] / width, y:1}];
    for (let i = points.length - 2; i > 0; i--) {
        const a = points[i-1], b = points[i], c = points[i+1];
        if (Math.abs((b.x-a.x)*(c.y-b.y)-(c.x-b.x)*(b.y-a.y)) < 1e-12) points.splice(i,1);
    }
    if (points.length > 4096) throw new Error('tooComplex');
    return points;
}

export function rowBoundaryY(boundaries, row, x) {
    if (row === 0) return 0;
    if (row === boundaries.columns.length) return 1;
    const points = boundaries.rowLines?.[row - 1];
    if (!points) return boundaries.rowCuts[row];
    // Row lines store the same (offset, progress) format as column lines;
    // progress is horizontal for these transposed seams.
    return boundaryX(points, x);
}

export function ownershipRowBand(boundaries, row) {
    if (!boundaries.rowLines) return [boundaries.rowCuts[row], boundaries.rowCuts[row + 1]];
    const top = row ? Math.min(...boundaries.rowLines[row - 1].map(p => p.x)) : 0;
    const bottom = row < boundaries.columns.length - 1 ? Math.max(...boundaries.rowLines[row].map(p => p.x)) : 1;
    return [top, bottom];
}

export function automaticOwnershipBoundaries(source, labels, bodies, rows, cols) {
    const {width, height} = source;
    const boundaries = createOwnershipBoundaries(rows, cols);
    boundaries.rowLines = [];
    const lane = (size, count, index) => ({
        start:Math.max(1, Math.ceil((index + .5) * size / count)),
        end:Math.min(size - 1, Math.floor((index + 1.5) * size / count) - 1),
        nominal:(index + 1) * size / count, cellSize:size / count,
    });
    for (let row = 0; row < rows - 1; row++) {
        const sides = new Map(bodies.map((body, i) => [body.id, Math.floor(i / cols) <= row ? -1 : 1]));
        boundaries.rowLines.push(traceSeam(source, labels, sides, {
            top:0, bottom:width, ...lane(height, rows, row), transpose:true,
        }));
    }
    for (let row = 0; row < rows; row++) {
        const [top, bottom] = ownershipRowBand(boundaries, row);
        for (let col = 0; col < cols - 1; col++) {
            const sides = new Map(bodies.slice(row * cols, (row + 1) * cols).map((body, i) => [body.id, i <= col ? -1 : 1]));
            boundaries.columns[row][col] = traceSeam(source, labels, sides, {
                top:Math.round(top * height), bottom:Math.round(bottom * height), ...lane(width, cols, col),
            });
        }
    }
    return boundaries;
}

export function createOwnershipResolver(boundaries) {
    const rows = boundaries.columns.length, cols = boundaries.columns[0].length + 1;
    const bands = Array.from({length:rows}, (_, row) => ownershipRowBand(boundaries, row));
    return (x, y) => {
        let row = 0;
        while (row < rows - 1 && y >= rowBoundaryY(boundaries, row + 1, x)) row++;
        const [top, bottom] = bands[row];
        const localY = Math.max(0, Math.min(1, (y - top) / (bottom - top)));
        const found = boundaries.columns[row].findIndex(points => x < boundaryX(points, localY));
        return row * cols + (found < 0 ? cols - 1 : found);
    };
}

export function ownershipFrame(boundaries, x, y) {
    return createOwnershipResolver(boundaries)(x, y);
}
