(function installImageStudioGeometry(root, factory) {
    const geometry = factory();
    if (typeof module === 'object' && module.exports) module.exports = geometry;
    root.SmartCanvasModules = root.SmartCanvasModules || {};
    root.SmartCanvasModules.imageStudioGeometry = geometry;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createImageStudioGeometry() {
    const MIN_CROP_SIZE = 24;
    const MAX_GRID_GAP = 240;

    function finiteNumber(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function normalizedBounds(bounds = {}) {
        return {
            w: Math.max(1, finiteNumber(bounds.w ?? bounds.width, 1)),
            h: Math.max(1, finiteNumber(bounds.h ?? bounds.height, 1)),
        };
    }

    function normalizedRect(rect = {}, bounds = {}) {
        const size = normalizedBounds(bounds);
        return {
            x: finiteNumber(rect.x),
            y: finiteNumber(rect.y),
            w: Math.max(MIN_CROP_SIZE, finiteNumber(rect.w ?? rect.width, size.w)),
            h: Math.max(MIN_CROP_SIZE, finiteNumber(rect.h ?? rect.height, size.h)),
        };
    }

    function clampRect(rect, bounds) {
        const size = normalizedBounds(bounds);
        const next = normalizedRect(rect, size);
        next.w = Math.max(MIN_CROP_SIZE, Math.min(next.w, size.w));
        next.h = Math.max(MIN_CROP_SIZE, Math.min(next.h, size.h));
        next.x = Math.max(0, Math.min(next.x, size.w - next.w));
        next.y = Math.max(0, Math.min(next.y, size.h - next.h));
        return next;
    }

    function fitCrop({ bounds, rect, ratio = null } = {}) {
        const size = normalizedBounds(bounds);
        const source = normalizedRect(rect, size);
        let width = source.w;
        let height = source.h;
        const aspect = finiteNumber(ratio);

        if (aspect > 0) {
            if (width / height > aspect) width = height * aspect;
            else height = width / aspect;
            if (width > size.w) {
                width = size.w;
                height = width / aspect;
            }
            if (height > size.h) {
                height = size.h;
                width = height * aspect;
            }
        } else {
            width = Math.min(width, size.w);
            height = Math.min(height, size.h);
        }

        const centerX = source.x + source.w / 2;
        const centerY = source.y + source.h / 2;
        return clampRect({
            x: Math.round(centerX - width / 2),
            y: Math.round(centerY - height / 2),
            w: Math.round(width),
            h: Math.round(height),
        }, size);
    }

    function aspectCornerRect(bounds, anchorX, anchorY, movingX, movingY, ratio, handle) {
        const size = normalizedBounds(bounds);
        const aspect = Math.max(Number.EPSILON, finiteNumber(ratio, 1));
        let width = Math.max(MIN_CROP_SIZE, Math.abs(movingX - anchorX));
        let height = Math.max(MIN_CROP_SIZE, Math.abs(movingY - anchorY));
        if (width / height > aspect) width = height * aspect;
        else height = width / aspect;
        const directionX = handle.includes('w') ? -1 : 1;
        const directionY = handle.includes('n') ? -1 : 1;
        width = Math.min(width, directionX < 0 ? anchorX : size.w - anchorX);
        height = Math.min(height, directionY < 0 ? anchorY : size.h - anchorY);
        if (width / height > aspect) width = height * aspect;
        else height = width / aspect;
        return {
            x: directionX < 0 ? anchorX - width : anchorX,
            y: directionY < 0 ? anchorY - height : anchorY,
            w: width,
            h: height,
        };
    }

    function resizeCrop({ bounds, start, dx = 0, dy = 0, ratio = null, handle = 'se' } = {}) {
        const size = normalizedBounds(bounds);
        const source = normalizedRect(start, size);
        const normalizedHandle = handle === 'resize' ? 'se' : String(handle || 'se');
        const aspect = finiteNumber(ratio);

        if (!(aspect > 0)) {
            let left = source.x;
            let top = source.y;
            let right = source.x + source.w;
            let bottom = source.y + source.h;
            if (normalizedHandle.includes('w')) left += dx;
            if (normalizedHandle.includes('e')) right += dx;
            if (normalizedHandle.includes('n')) top += dy;
            if (normalizedHandle.includes('s')) bottom += dy;
            const next = {
                x: Math.min(left, right - MIN_CROP_SIZE),
                y: Math.min(top, bottom - MIN_CROP_SIZE),
            };
            next.w = Math.max(MIN_CROP_SIZE, right - next.x);
            next.h = Math.max(MIN_CROP_SIZE, bottom - next.y);
            return next;
        }

        const centerX = source.x + source.w / 2;
        const centerY = source.y + source.h / 2;
        if (normalizedHandle === 'e' || normalizedHandle === 'w') {
            let width = Math.max(
                MIN_CROP_SIZE,
                normalizedHandle === 'e' ? source.w + dx : source.w - dx,
            );
            const maxWidth = normalizedHandle === 'e' ? size.w - source.x : source.x + source.w;
            const maxHeight = Math.max(MIN_CROP_SIZE, 2 * Math.min(centerY, size.h - centerY));
            width = Math.min(width, maxWidth, maxHeight * aspect);
            const height = width / aspect;
            return {
                x: Math.round(normalizedHandle === 'e' ? source.x : source.x + source.w - width),
                y: Math.round(centerY - height / 2),
                w: Math.round(width),
                h: Math.round(height),
            };
        }

        if (normalizedHandle === 'n' || normalizedHandle === 's') {
            let height = Math.max(
                MIN_CROP_SIZE,
                normalizedHandle === 's' ? source.h + dy : source.h - dy,
            );
            const maxHeight = normalizedHandle === 's' ? size.h - source.y : source.y + source.h;
            const maxWidth = Math.max(MIN_CROP_SIZE, 2 * Math.min(centerX, size.w - centerX));
            height = Math.min(height, maxHeight, maxWidth / aspect);
            const width = height * aspect;
            return {
                x: Math.round(centerX - width / 2),
                y: Math.round(normalizedHandle === 's' ? source.y : source.y + source.h - height),
                w: Math.round(width),
                h: Math.round(height),
            };
        }

        const anchorX = normalizedHandle.includes('w') ? source.x + source.w : source.x;
        const anchorY = normalizedHandle.includes('n') ? source.y + source.h : source.y;
        const movingX = normalizedHandle.includes('w') ? source.x + dx : source.x + source.w + dx;
        const movingY = normalizedHandle.includes('n') ? source.y + dy : source.y + source.h + dy;
        const next = aspectCornerRect(
            size,
            anchorX,
            anchorY,
            movingX,
            movingY,
            aspect,
            normalizedHandle,
        );
        return {
            x: Math.round(next.x),
            y: Math.round(next.y),
            w: Math.round(next.w),
            h: Math.round(next.h),
        };
    }

    function splitGrid({ width, height, rows = 1, cols = 1, gap = 0, lines = null } = {}) {
        const canvasWidth = Math.max(1, finiteNumber(width, 1));
        const canvasHeight = Math.max(1, finiteNumber(height, 1));
        const safeGap = Math.max(0, Math.min(MAX_GRID_GAP, finiteNumber(gap)));
        const halfGap = safeGap / 2;
        let horizontalCuts;
        let verticalCuts;

        if (Array.isArray(lines)) {
            const horizontal = [...new Set(
                lines
                    .filter(line => line?.type === 'h')
                    .map(line => finiteNumber(line.pos) * canvasHeight),
            )].sort((a, b) => a - b);
            const vertical = [...new Set(
                lines
                    .filter(line => line?.type === 'v')
                    .map(line => finiteNumber(line.pos) * canvasWidth),
            )].sort((a, b) => a - b);
            horizontalCuts = [0, ...horizontal, canvasHeight];
            verticalCuts = [0, ...vertical, canvasWidth];
        } else {
            const rowCount = Math.max(1, Math.min(21, Math.round(finiteNumber(rows, 1))));
            const columnCount = Math.max(1, Math.min(21, Math.round(finiteNumber(cols, 1))));
            horizontalCuts = Array.from({ length: rowCount + 1 }, (_, index) => index * canvasHeight / rowCount);
            verticalCuts = Array.from({ length: columnCount + 1 }, (_, index) => index * canvasWidth / columnCount);
        }

        const rects = [];
        for (let row = 0; row < horizontalCuts.length - 1; row++) {
            for (let col = 0; col < verticalCuts.length - 1; col++) {
                const y1 = Math.round(row === 0 ? horizontalCuts[row] : horizontalCuts[row] + halfGap);
                const y2 = Math.round(
                    row === horizontalCuts.length - 2
                        ? horizontalCuts[row + 1]
                        : horizontalCuts[row + 1] - halfGap,
                );
                const x1 = Math.round(col === 0 ? verticalCuts[col] : verticalCuts[col] + halfGap);
                const x2 = Math.round(
                    col === verticalCuts.length - 2
                        ? verticalCuts[col + 1]
                        : verticalCuts[col + 1] - halfGap,
                );
                if (x2 > x1 && y2 > y1) {
                    rects.push({ row, col, x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
                }
            }
        }
        return rects;
    }

    function describeGrid(rects = [], groupId = '') {
        return {
            type: 'grid-split',
            groupId,
            rows: Math.max(1, ...rects.map(rect => Number(rect.row || 0) + 1)),
            cols: Math.max(1, ...rects.map(rect => Number(rect.col || 0) + 1)),
        };
    }

    function scaleImage({ width, height, scale = 0.5 } = {}) {
        const sourceW = Math.max(1, Math.round(finiteNumber(width, 1)));
        const sourceH = Math.max(1, Math.round(finiteNumber(height, 1)));
        const normalizedScale = Math.max(
            0.05,
            Math.min(1, Math.round(finiteNumber(scale, 0.5) * 100) / 100),
        );
        return {
            sourceW,
            sourceH,
            scale: normalizedScale,
            targetW: Math.max(1, Math.round(sourceW * normalizedScale)),
            targetH: Math.max(1, Math.round(sourceH * normalizedScale)),
        };
    }

    function layoutGrid({ items = [], order = [], rows = null, cols = null, gap = 0 } = {}) {
        const byIndex = new Map(items.map(item => [Number(item.index), item]));
        const ordered = [
            ...order.map(index => byIndex.get(Number(index))).filter(Boolean),
            ...items.filter(item => !order.some(index => Number(index) === Number(item.index))),
        ];
        const autoCols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, ordered.length))));
        const columnCount = Math.max(1, Number(cols || autoCols) || autoCols);
        const rowCount = Math.max(1, Number(rows || Math.ceil(ordered.length / columnCount)) || 1);
        const maxWidth = Math.max(1, ...ordered.map(item => finiteNumber(item.w ?? item.width, 512)));
        const maxHeight = Math.max(1, ...ordered.map(item => finiteNumber(item.h ?? item.height, 512)));
        const previewScale = Math.min(1, 420 / Math.max(maxWidth, maxHeight));
        const cellW = Math.max(1, Math.round(maxWidth * previewScale));
        const cellH = Math.max(1, Math.round(maxHeight * previewScale));
        const safeGap = Math.max(0, Math.min(MAX_GRID_GAP, finiteNumber(gap)));
        return {
            rows: rowCount,
            cols: columnCount,
            cellW,
            cellH,
            gap: safeGap,
            items: ordered.map((item, position) => ({
                index: Number(item.index),
                x: (position % columnCount) * (cellW + safeGap),
                y: Math.floor(position / columnCount) * (cellH + safeGap),
                w: cellW,
                h: cellH,
            })),
        };
    }

    return Object.freeze({
        fitCrop,
        resizeCrop,
        splitGrid,
        describeGrid,
        scaleImage,
        layoutGrid,
    });
});
