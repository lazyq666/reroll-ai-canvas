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

    function render({
        kind = 'other',
        layout = {},
        pending = false,
        group = {},
        media = {},
        labels = {},
    } = {}) {
        if (kind === 'frame') return '';
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
        if (media.kind === 'audio') {
            const width = Math.max(1, Number(layout.width) || 1);
            const height = Math.max(1, Number(layout.height) || 1);
            return `<div class="far-node-audio node-img media-card media-audio-card" data-image-index="0" data-media-signature="${escapeHtml(media.signature || '')}" style="--node-img-w:${width}px;--node-img-h:${height}px"><ic-icon name="audio" size="large" aria-hidden="true"></ic-icon></div>`;
        }
        if (media.markup) {
            const width = Math.max(1, Number(layout.width) || 1);
            const height = Math.max(1, Number(layout.height) || 1);
            return `<div class="far-node-media" data-image-index="0" data-media-signature="${escapeHtml(media.signature || '')}" style="--node-img-w:${width}px;--node-img-h:${height}px">${media.markup}</div>`;
        }
        return `<div class="far-node-marker"><span>${escapeHtml(labels.marker || '')}</span></div>`;
    }

    return Object.freeze({ promptLineCount, render });
});
