/*
 * Smart Canvas Virtualization Module
 *
 * The complete Smart Canvas remains owned by the host data model. This module
 * owns only spatial lookup, the Canvas Viewport Render Set, temporary pins and
 * animation-frame coalescing. It never reads Node DOM as model state.
 */
(function installCanvasVirtualization(root, factory) {
    const virtualization = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = virtualization;
    root.SmartCanvasModules = root.SmartCanvasModules || {};
    root.SmartCanvasModules.canvasVirtualization = virtualization;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createCanvasVirtualization(root) {
    const DEFAULT_CELL_SIZE = 1024;
    const DEFAULT_OVERSCAN_VIEWPORTS = 1;
    const entries = new Map();
    const cells = new Map();
    const explicitPins = new Map();
    let configuration = null;
    let renderSet = new Set();
    let expandedViewport = null;
    let scheduledFrame = 0;
    let scheduledModelIds = new Set();
    let scheduledFullSync = false;
    let lastViewportSignature = '';
    let lastDurationMs = 0;
    let lastSpatialIndexDurationMs = 0;
    let lastMaterializationDurationMs = 0;
    let lastActualMountedNodeCount = 0;
    let lastCandidateCount = 0;
    let lastConnectionCount = 0;
    let lastWarmNodeCount = 0;
    let lastWarmMediaCount = 0;

    function finite(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function normalizedRect(rect = {}) {
        const width = Math.max(1, finite(rect.width, 1));
        const height = Math.max(1, finite(rect.height, 1));
        return Object.freeze({
            x: finite(rect.x),
            y: finite(rect.y),
            width,
            height,
        });
    }

    function intersects(left, right) {
        return left.x < right.x + right.width
            && left.x + left.width > right.x
            && left.y < right.y + right.height
            && left.y + left.height > right.y;
    }

    function cellRange(rect) {
        const cellSize = Math.max(64, finite(configuration?.cellSize, DEFAULT_CELL_SIZE));
        return {
            minX: Math.floor(rect.x / cellSize),
            maxX: Math.floor((rect.x + rect.width) / cellSize),
            minY: Math.floor(rect.y / cellSize),
            maxY: Math.floor((rect.y + rect.height) / cellSize),
        };
    }

    function cellKeys(rect) {
        const range = cellRange(rect);
        const keys = [];
        for (let y = range.minY; y <= range.maxY; y += 1) {
            for (let x = range.minX; x <= range.maxX; x += 1) keys.push(`${x}:${y}`);
        }
        return keys;
    }

    function removeEntry(nodeId) {
        const key = String(nodeId || '');
        const previous = entries.get(key);
        if (!previous) return false;
        previous.cells.forEach(cellKey => {
            const bucket = cells.get(cellKey);
            bucket?.delete(key);
            if (!bucket?.size) cells.delete(cellKey);
        });
        entries.delete(key);
        return true;
    }

    function geometrySignature(node = {}) {
        const images = Array.isArray(node.images) ? node.images : [];
        return JSON.stringify([
            finite(node.x), finite(node.y), finite(node.w), finite(node.h),
            finite(node.scale, 1), String(node.type || 'smart-image'),
            Boolean(node.pending), Boolean(node.queued), Boolean(node.generationOutputNode),
            finite(node.generationMediaW), finite(node.generationMediaH),
            String(node.activeOutputId || ''), Boolean(node.llmEnabled),
            Boolean(node.llmSystemEnabled), Boolean(node.promptSplitEnabled),
            finite(node.llmInstructionHeight), finite(node.promptSplitPreviewHeight),
            Array.isArray(node.items) ? node.items : [],
            images.map(image => [
                String(image?.kind || ''), String(image?.url || ''),
                finite(image?.natural_w || image?.width || image?.w || image?.layout_w || image?.preview_w),
                finite(image?.natural_h || image?.height || image?.h || image?.layout_h || image?.preview_h),
                String(image?.outputId || ''),
            ]),
        ]);
    }

    function now() {
        return root.performance?.now?.() ?? Date.now();
    }

    function upsert(
        node,
        measureNode = configuration?.measureNode,
        { forceMeasure = false } = {},
    ) {
        const nodeId = String(node?.id || '');
        if (!nodeId || typeof measureNode !== 'function') return false;
        const signature = geometrySignature(node);
        const previous = entries.get(nodeId);
        if (!forceMeasure && previous?.signature === signature) return false;
        const rect = normalizedRect(measureNode(node));
        const keys = cellKeys(rect);
        removeEntry(nodeId);
        entries.set(nodeId, { nodeId, rect, signature, cells: keys });
        keys.forEach(cellKey => {
            let bucket = cells.get(cellKey);
            if (!bucket) {
                bucket = new Set();
                cells.set(cellKey, bucket);
            }
            bucket.add(nodeId);
        });
        return true;
    }

    function syncAll(
        nodes = configuration?.getNodes?.() || [],
        { forceMeasure = false } = {},
    ) {
        const liveIds = new Set();
        (nodes || []).forEach(node => {
            const nodeId = String(node?.id || '');
            if (!nodeId) return;
            liveIds.add(nodeId);
            upsert(node, configuration?.measureNode, { forceMeasure });
        });
        [...entries.keys()].forEach(nodeId => {
            if (!liveIds.has(nodeId)) removeEntry(nodeId);
        });
    }

    function syncIds(nodeIds = []) {
        const nodes = configuration?.getNodes?.() || [];
        const byId = new Map(nodes.map(node => [String(node?.id || ''), node]));
        [...new Set(nodeIds || [])].forEach(value => {
            const nodeId = String(value || '');
            const node = byId.get(nodeId);
            if (node) upsert(node);
            else removeEntry(nodeId);
        });
    }

    function viewportRect() {
        const viewport = configuration?.getViewport?.() || {};
        const shell = configuration?.getShellSize?.() || {};
        const scale = Math.max(0.0001, finite(viewport.scale, 1));
        const width = Math.max(1, finite(shell.width, 1) / scale);
        const height = Math.max(1, finite(shell.height, 1) / scale);
        return normalizedRect({
            x: -finite(viewport.x) / scale,
            y: -finite(viewport.y) / scale,
            width,
            height,
        });
    }

    function expandedRect() {
        const visible = viewportRect();
        const factor = Math.max(0, finite(
            configuration?.overscanViewports,
            DEFAULT_OVERSCAN_VIEWPORTS,
        ));
        return normalizedRect({
            x: visible.x - visible.width * factor,
            y: visible.y - visible.height * factor,
            width: visible.width * (1 + factor * 2),
            height: visible.height * (1 + factor * 2),
        });
    }

    function query(rect) {
        const ids = new Set();
        cellKeys(rect).forEach(cellKey => {
            cells.get(cellKey)?.forEach(nodeId => ids.add(nodeId));
        });
        return [...ids].filter(nodeId => {
            const entry = entries.get(nodeId);
            return Boolean(entry && intersects(entry.rect, rect));
        });
    }

    function pinnedIds() {
        const pins = new Set();
        explicitPins.forEach((reasons, nodeId) => {
            if (reasons.size) pins.add(nodeId);
        });
        (configuration?.getPinnedNodeIds?.() || []).forEach(value => {
            const nodeId = String(value || '');
            if (nodeId) pins.add(nodeId);
        });
        return pins;
    }

    function setEquals(left, right) {
        return left.size === right.size && [...left].every(value => right.has(value));
    }

    function reconcile({ fullSync = false, nodeIds = [] } = {}) {
        const started = now();
        if (fullSync || entries.size === 0) {
            syncAll(undefined, { forceMeasure:Boolean(fullSync) });
        }
        else if (nodeIds?.length) syncIds(nodeIds);
        const nextExpandedViewport = expandedRect();
        const candidates = query(nextExpandedViewport);
        const pins = pinnedIds();
        const nextRenderSet = new Set(candidates);
        pins.forEach(nodeId => {
            if (entries.has(nodeId)) nextRenderSet.add(nodeId);
        });
        const changed = !setEquals(renderSet, nextRenderSet);
        const viewportSignature = [
            nextExpandedViewport.x,
            nextExpandedViewport.y,
            nextExpandedViewport.width,
            nextExpandedViewport.height,
        ].map(value => Math.round(value * 100) / 100).join(':');
        const viewportChanged = viewportSignature !== lastViewportSignature;
        renderSet = nextRenderSet;
        expandedViewport = nextExpandedViewport;
        lastViewportSignature = viewportSignature;
        lastCandidateCount = candidates.length;
        lastSpatialIndexDurationMs = now() - started;
        lastDurationMs = lastSpatialIndexDurationMs;
        return Object.freeze({
            ids: Object.freeze([...renderSet]),
            changed,
            viewportChanged,
            expandedViewport,
        });
    }

    function request({ fullSync = false, nodeIds = [] } = {}) {
        scheduledFullSync = scheduledFullSync || Boolean(fullSync);
        (nodeIds || []).forEach(nodeId => scheduledModelIds.add(String(nodeId || '')));
        if (scheduledFrame) return scheduledFrame;
        const schedule = root.requestAnimationFrame || (callback => root.setTimeout(callback, 0));
        scheduledFrame = schedule(() => {
            scheduledFrame = 0;
            const ids = [...scheduledModelIds].filter(Boolean);
            scheduledModelIds = new Set();
            const shouldFullSync = scheduledFullSync;
            scheduledFullSync = false;
            const result = reconcile({ fullSync: shouldFullSync, nodeIds: ids });
            if (result.changed || result.viewportChanged) configuration?.onRefresh?.(result);
        });
        return scheduledFrame;
    }

    function pin(nodeIds, reason = 'interaction') {
        const values = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
        values.forEach(value => {
            const nodeId = String(value || '');
            if (!nodeId) return;
            let reasons = explicitPins.get(nodeId);
            if (!reasons) {
                reasons = new Set();
                explicitPins.set(nodeId, reasons);
            }
            reasons.add(String(reason || 'interaction'));
        });
        request();
    }

    function unpin(nodeIds, reason = 'interaction') {
        const values = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
        values.forEach(value => {
            const nodeId = String(value || '');
            const reasons = explicitPins.get(nodeId);
            if (!reasons) return;
            reasons.delete(String(reason || 'interaction'));
            if (!reasons.size) explicitPins.delete(nodeId);
        });
        request();
    }

    function connectionVisible({ fromRect, toRect, kind = 'flow', pinned = false } = {}) {
        if (pinned || !expandedViewport) return true;
        const from = normalizedRect(fromRect);
        const to = normalizedRect(toRect);
        const history = kind === 'history';
        const fx = history ? from.x + from.width / 2 : from.x + from.width;
        const fy = history ? from.y + from.height : from.y + from.height / 2;
        const tx = history ? to.x + to.width / 2 : to.x;
        const ty = history ? to.y : to.y + to.height / 2;
        const dx = Math.max(50, Math.abs(tx - fx) * 0.45);
        const dy = Math.max(36, Math.abs(ty - fy) * 0.45);
        const points = history
            ? [[fx, fy], [fx, fy + dy], [tx, ty - dy], [tx, ty]]
            : [[fx, fy], [fx + dx, fy], [tx - dx, ty], [tx, ty]];
        const xs = points.map(point => point[0]);
        const ys = points.map(point => point[1]);
        const bounds = normalizedRect({
            x: Math.min(...xs) - 12,
            y: Math.min(...ys) - 12,
            width: Math.max(...xs) - Math.min(...xs) + 24,
            height: Math.max(...ys) - Math.min(...ys) + 24,
        });
        return intersects(bounds, expandedViewport);
    }

    function noteConnections(count) {
        lastConnectionCount = Math.max(0, Number(count) || 0);
    }

    function noteMaterialization({
        duration = 0,
        mountedNodeCount = 0,
        warmNodeCount = 0,
        warmMediaCount = 0,
    } = {}) {
        lastMaterializationDurationMs = Math.max(0, Number(duration) || 0);
        lastActualMountedNodeCount = Math.max(0, Number(mountedNodeCount) || 0);
        lastWarmNodeCount = Math.max(0, Number(warmNodeCount) || 0);
        lastWarmMediaCount = Math.max(0, Number(warmMediaCount) || 0);
        lastDurationMs = Math.max(
            lastSpatialIndexDurationMs,
            lastMaterializationDurationMs,
        );
    }

    function diagnostics() {
        return Object.freeze({
            totalNodeCount: entries.size,
            mountedNodeCount: lastActualMountedNodeCount || renderSet.size,
            visibleCandidateCount: lastCandidateCount,
            pinnedCount: pinnedIds().size,
            reconciliationDuration: Math.max(
                lastDurationMs,
                lastSpatialIndexDurationMs,
                lastMaterializationDurationMs,
            ),
            spatialIndexDuration: lastSpatialIndexDurationMs,
            materializationDuration: lastMaterializationDurationMs,
            connectionCount: lastConnectionCount,
            warmNodeCount: lastWarmNodeCount,
            warmMediaCount: lastWarmMediaCount,
        });
    }

    function configure(options = {}) {
        configuration = {
            cellSize: DEFAULT_CELL_SIZE,
            overscanViewports: DEFAULT_OVERSCAN_VIEWPORTS,
            ...options,
        };
        return api;
    }

    function reset() {
        entries.clear();
        cells.clear();
        explicitPins.clear();
        renderSet = new Set();
        expandedViewport = null;
        lastViewportSignature = '';
        lastCandidateCount = 0;
        lastConnectionCount = 0;
        lastDurationMs = 0;
        lastSpatialIndexDurationMs = 0;
        lastMaterializationDurationMs = 0;
        lastActualMountedNodeCount = 0;
        lastWarmNodeCount = 0;
        lastWarmMediaCount = 0;
    }

    const api = Object.freeze({
        configure,
        reconcile,
        request,
        pin,
        unpin,
        connectionVisible,
        noteConnections,
        noteMaterialization,
        diagnostics,
        reset,
    });
    return api;
});
