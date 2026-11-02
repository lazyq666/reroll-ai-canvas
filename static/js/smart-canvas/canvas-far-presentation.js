/*
 * Smart Canvas Far Presentation Module
 *
 * Owns the lightweight read-only body used when a Canvas Viewport is far
 * enough that full Node controls and media are not useful. Hosts normalize
 * their domain data into this small presentation interface.
 */
(function installCanvasFarPresentation(root, factory) {
    const presentation = factory();
    if (typeof module === 'object' && module.exports) module.exports = presentation;
    root.SmartCanvasModules = root.SmartCanvasModules || {};
    root.SmartCanvasModules.canvasFarPresentation = presentation;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createCanvasFarPresentation() {
    const PROMPT_LINE_HEIGHT = 9;
    const PROMPT_LINE_GAP = 10;
    const PROMPT_BLOCK_PADDING = 20;
    const NODE_BORDER = 1;
    const MAX_PROMPT_LINES = 24;

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        })[character]);
    }

    function promptLineCount(nodeHeight) {
        const contentHeight = Math.max(
            0,
            Number(nodeHeight || 0)
                - NODE_BORDER * 2
                - PROMPT_BLOCK_PADDING * 2,
        );
        return Math.min(
            MAX_PROMPT_LINES,
            Math.max(1, Math.floor(
                (contentHeight + PROMPT_LINE_GAP)
                / (PROMPT_LINE_HEIGHT + PROMPT_LINE_GAP),
            )),
        );
    }

    function promptSkeleton(label, nodeHeight) {
        const lineCount = promptLineCount(nodeHeight);
        return `<div class="far-prompt-skeleton" role="img" aria-label="${escapeHtml(label)}" data-line-count="${lineCount}">
            ${Array.from({ length:lineCount }, () => '<span class="far-prompt-skeleton-line" aria-hidden="true"></span>').join('')}
        </div>`;
    }

    function imageSkeleton(thumbnail = '') {
        return `<span class="far-node-image-skeleton" aria-hidden="true"${thumbnail ? ` data-far-thumbnail="${escapeHtml(thumbnail)}"` : ''}><ic-icon name="image" size="medium"></ic-icon></span>`;
    }

    // Only mounted nodes enter the queue. Re-evaluate visibility before each request,
    // so a pan or zoom can promote newly visible work and discard obsolete work.
    const queued = new Set();
    let active = 0;
    let scheduled = false;
    function pump() {
        scheduled = false;
        for (const item of queued) if (!item.isConnected) { queued.delete(item); delete item.dataset.farQueued; }
        while (active < 2 && queued.size) {
            const score = item => {
                const r = item.getBoundingClientRect();
                const visible = r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
                return (visible ? 0 : 1e9) + Math.hypot((r.left + r.right) / 2 - innerWidth / 2, (r.top + r.bottom) / 2 - innerHeight / 2);
            };
            const item = [...queued].sort((a,b) => score(a) - score(b))[0];
            queued.delete(item);
            const url = item.dataset.farThumbnail;
            if (!url) continue;
            active++;
            const image = new Image();
            image.className = 'far-node-thumbnail';
            image.alt = '';
            image.draggable = false;
            const done = success => {
                if (!item.isConnected) delete item.dataset.farQueued;
                else if (!success) { item.querySelector('.lod-transition-image')?.remove(); item.classList.remove('has-lod-transition'); }
                else if (success && item.dataset.farThumbnail === url) item.replaceWith(image);
                active--;
                pump();
            };
            image.onload = () => done(true);
            image.onerror = () => done(false);
            image.src = url;
        }
    }
    function queueThumbnails(root) {
        root.querySelectorAll('[data-far-thumbnail]').forEach(item => {
            if (!item.dataset.farQueued) { item.dataset.farQueued = '1'; queued.add(item); }
        });
        if (!scheduled) { scheduled = true; setTimeout(pump, 0); }
    }

    // Keep the currently visible bitmap across a node replacement. The bridge
    // is owned by the new node and disappears as soon as its target is decoded.
    function bridgeTransition(oldNode, newNode) {
        if (!oldNode || !newNode) return;
        const enteringFar = newNode.classList.contains('canvas-lod-node-far');
        const items = node => {
            const found = [...node.querySelectorAll('[data-image-index]')];
            return found.length ? found : [...node.querySelectorAll('.image-wrap')];
        };
        const oldLayers = [...oldNode.querySelectorAll('.layer-decomposition-item[data-layer-key]')];
        const newLayers = [...newNode.querySelectorAll('.layer-decomposition-item[data-layer-key]')];
        const layered = oldLayers.length && newLayers.length;
        const oldItems = layered ? oldLayers : items(oldNode), newItems = layered ? newLayers : items(newNode);
        for (const next of newItems) {
            const index = next.dataset.imageIndex ?? '0';
            const previous = layered ? oldItems.find(item => item.dataset.layerKey === next.dataset.layerKey)
                : oldItems.find(item => (item.dataset.imageIndex ?? '0') === index);
            if (!previous) continue;
            const oldSignature = previous.dataset.mediaSignature || '';
            const newSignature = next.dataset.mediaSignature || '';
            if (oldSignature && newSignature && oldSignature !== newSignature) continue;
            const source = previous.querySelector('canvas.lod-transition-image')
                || previous.querySelector('img.far-node-thumbnail')
                || previous.querySelector('img[data-original-src]:not([data-preview-kind])');
            const width = source?.naturalWidth || (source?.tagName === 'CANVAS' ? source.width : 0);
            const height = source?.naturalHeight || (source?.tagName === 'CANVAS' ? source.height : 0);
            if (!width || !height) continue;
            // Moving an <img> can discard its decoded resource and trigger a
            // new request (especially with no-store). Snapshot only 64 pixels
            // before detaching the old node, and keep that bitmap in memory.
            const bridge = document.createElement('canvas');
            const ratio = Math.min(1, 64 / Math.max(width, height));
            bridge.width = Math.max(1, Math.round(width * ratio));
            bridge.height = Math.max(1, Math.round(height * ratio));
            bridge.className = 'lod-transition-image';
            bridge.setAttribute('aria-hidden', 'true');
            try {
                const context = bridge.getContext('2d');
                if (!context) continue;
                context.drawImage(source, 0, 0, bridge.width, bridge.height);
            } catch (_) { continue; }
            if (enteringFar) {
                const skeleton = next.querySelector('[data-far-thumbnail]');
                if (!skeleton) continue;
                skeleton.classList.add('has-lod-transition');
                skeleton.append(bridge);
            } else {
                const target = next.querySelector('img[data-original-src]:not([data-preview-kind])');
                if (!target || !target.parentElement) continue;
                target.parentElement.classList.add('has-lod-transition');
                target.parentElement.append(bridge);
                const finish = async () => {
                    const requested = target.getAttribute('src');
                    try { if (target.decode) await target.decode(); } catch (_) { return; }
                    if (requested !== target.getAttribute('src') || !target.isConnected || !target.naturalWidth || !bridge.isConnected || bridge.parentElement !== target.parentElement) return;
                    if (target.dataset.mediaState) target.dataset.mediaState = 'ready';
                    target.style.transition = 'none';
                    bridge.remove();
                    target.parentElement.classList.remove('has-lod-transition');
                };
                target.addEventListener('load', finish);
                if (target.complete && target.naturalWidth) void finish();
            }
        }
    }

    function mediaGrid(items, layout) {
        const columns = Math.max(1, Number(layout.cols) || Math.min(4, Math.ceil(Math.sqrt(items.length))));
        const thumb = Math.max(1, Number(layout.thumb) || Math.floor((Number(layout.width) - 32 - (columns - 1) * 8) / columns));
        const height = Math.max(1, Number(layout.gridHeight) || Number(layout.height) - 32);
        const visible = [];
        let top = 0;
        for(let offset = 0; offset < items.length && top < height; offset += columns) {
            const row = items.slice(offset, offset + columns);
            visible.push(...row.map((item, index) => ({...item, index:item.index ?? offset + index})));
            top += Math.max(...row.map(item => thumb / Math.max(.05, Number(item.aspectRatio) || 1))) + 8;
        }
        return `<div class="far-node-media-grid" data-columns="${columns}" data-thumb="${thumb}" data-height="${height}" style="--far-media-cols:${columns};--far-media-thumb:${thumb}px;--far-media-height:${height}px">${visible.map(item => {
            const aspect = Math.max(.05, Number(item.aspectRatio) || 1);
            return `<div class="far-node-media${item.selected ? ' image-selected' : ''}" data-image-index="${escapeHtml(item.index)}" data-media-signature="${escapeHtml(item.signature || '')}" data-aspect="${aspect}" style="aspect-ratio:${aspect}">${item.kind === 'image' ? imageSkeleton(item.thumbnail) : item.markup || `<ic-icon name="${item.kind === 'audio' ? 'audio' : 'video'}" size="medium" aria-hidden="true"></ic-icon>`}</div>`;
        }).join('')}</div>`;
    }

    // Share pages disallow inline style attributes; apply geometry through CSSOM.
    function applyLayout(root) {
        root.querySelectorAll('[data-far-layer]').forEach(layer => {
            for (const property of ['left', 'top', 'width', 'height']) layer.style[property] = `${layer.dataset[property]}%`;
            layer.style.zIndex = layer.dataset.z;
        });
        root.querySelectorAll('.far-node-media-grid').forEach(grid => {
            grid.style.setProperty('--far-media-cols', grid.dataset.columns);
            grid.style.setProperty('--far-media-thumb', `${grid.dataset.thumb}px`);
            grid.style.setProperty('--far-media-height', `${grid.dataset.height}px`);
            grid.querySelectorAll('.far-node-media').forEach(item => {
                item.style.aspectRatio = item.dataset.aspect;
            });
        });
    }

    function render({
        kind = 'other',
        layout = {},
        pending = false,
        group = {},
        media = {},
        layers = [],
        labels = {},
    } = {}) {
        if (kind === 'frame') return '';
        if (layers.length) {
            return `<div class="layer-decomposition-stage far-layer-stage">${layers.map(layer => `<div class="layer-decomposition-item" data-layer-key="${escapeHtml(layer.key || '')}" data-far-layer="1" data-left="${layer.left}" data-top="${layer.top}" data-width="${layer.width}" data-height="${layer.height}" data-z="${layer.z}" style="left:${layer.left}%;top:${layer.top}%;width:${layer.width}%;height:${layer.height}%;z-index:${layer.z}">${imageSkeleton(layer.thumbnail)}</div>`).join('')}</div>`;
        }
        if (kind === 'group') {
            const count = Math.max(0, Number(group.count) || 0);
            if (!count) return '';
            const columns = Math.max(1, Number(group.columns) || 1);
            return `<div class="far-smart-group-media-skeleton" style="--far-group-cols:${columns}" role="img" aria-label="${escapeHtml(labels.group || '')}">
                ${Array.from({ length:count }, () => '<span class="far-smart-group-media-skeleton-item" aria-hidden="true"><ic-icon name="image" size="medium"></ic-icon></span>').join('')}
            </div>`;
        }
        if (pending) {
            return `<div class="far-node-pending"><span>${escapeHtml(labels.pending || '')}</span></div>`;
        }
        if (kind === 'prompt' || kind === 'prompt-generation') {
            return promptSkeleton(labels.prompt || '', layout.height);
        }
        if (media.items?.length > 1) return mediaGrid(media.items, layout);
        if (media.kind === 'audio') {
            const width = Math.max(1, Number(layout.width) || 1);
            const height = Math.max(1, Number(layout.height) || 1);
            return `<div class="far-node-audio node-img media-card media-audio-card" data-image-index="0" data-media-signature="${escapeHtml(media.signature || '')}" style="--node-img-w:${width}px;--node-img-h:${height}px"><ic-icon name="audio" size="large" aria-hidden="true"></ic-icon></div>`;
        }
        if (media.kind === 'image' || media.markup) {
            const width = Math.max(1, Number(layout.width) || 1);
            const height = Math.max(1, Number(layout.height) || 1);
            return `<div class="far-node-media" data-image-index="0" data-media-signature="${escapeHtml(media.signature || '')}" style="--node-img-w:${width}px;--node-img-h:${height}px">${media.kind === 'image' ? imageSkeleton(media.thumbnail) : media.markup}</div>`;
        }
        return `<div class="far-node-marker"><span>${escapeHtml(labels.marker || '')}</span></div>`;
    }

    return Object.freeze({ promptLineCount, render, applyLayout, queueThumbnails, bridgeTransition });
});
