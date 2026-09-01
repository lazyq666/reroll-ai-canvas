/*
 * Node Geometry external interface
 *
 * createSession(snapshot, previewOverlay?) treats the supplied Smart Canvas
 * snapshot as immutable. previewOverlay.nodes may contain complete replacement
 * Nodes keyed by id. A session exposes one
 * measure(nodeId) query and memoizes its frozen result for the session lifetime.
 * Every persisted Smart Canvas Node role is measured without consulting DOM
 * state. Unknown Node types return supported:false.
 */
(function installNodeGeometry(root, factory) {
    const geometry = factory();
    if (typeof module === 'object' && module.exports) module.exports = geometry;
    root.SmartCanvasModules = root.SmartCanvasModules || {};
    root.SmartCanvasModules.nodeGeometry = geometry;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createNodeGeometry() {
    const DEFAULT_SCALE = 2;
    const MAX_IMAGE_WIDTH = 260;
    const MAX_IMAGE_HEIGHT = 220;
    const MEDIA_GROUP_DEFAULT_SCALE = 0.8;
    const MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE = 1.6;
    const MEDIA_GROUP_THUMB_BASE = 224;
    const MEDIA_GROUP_THUMB_MAX = 128;
    const MEDIA_GROUP_MAX_VISIBLE_ROWS = 3;
    const MEDIA_GROUP_PADDING = 32;
    const MEDIA_GROUP_GAP = 8;
    const MEDIA_NAME_ROW_HEIGHT = 20;
    const MINIMUM_NODE_SIZE = 48;
    const INTERACTION_INSET = Object.freeze({left:100,right:100,top:48,bottom:48});
    const PROMPT_WIDTH = 316;
    const PROMPT_COLLAPSED_HEIGHT = 180;
    const PROMPT_GENERATION_HEIGHT = 270;
    const PROMPT_INPUT_MEDIA_HEIGHT = 53;
    const PROMPT_UPSTREAM_TEXT_HEIGHT = 74;
    const PROMPT_CONTENT_MIN_HEIGHT = 240;
    const PROMPT_CONTENT_MAX_HEIGHT = 520;
    const DEFAULT_LAYOUTS = Object.freeze({
        'smart-prompt':{width:PROMPT_WIDTH,height:PROMPT_COLLAPSED_HEIGHT},
        'smart-splitter':{width:316,height:240},
        'smart-loop':{width:360,height:406},
        'smart-group':{width:340,height:286},
        'smart-frame':{width:680,height:420},
        'smart-text':{width:240,height:120},
        'smart-brush':{width:240,height:120}
    });

    function mediaSize(image) {
        const width = Number(
            image?.natural_w
            || image?.width
            || image?.w
            || image?.layout_w
            || image?.preview_w
            || 0
        );
        const height = Number(
            image?.natural_h
            || image?.height
            || image?.h
            || image?.layout_h
            || image?.preview_h
            || 0
        );
        return Number.isFinite(width)
            && width > 0
            && Number.isFinite(height)
            && height > 0
            ? {width, height}
            : null;
    }

    function isStillImage(image) {
        const kind = String(image?.kind || '').toLowerCase();
        if (['audio', 'video', 'text', 'file'].includes(kind)) return false;
        const url = String(image?.url || '').toLowerCase();
        return !/\.(mp4|webm|mov|m4v|avi|mkv|mp3|wav|m4a|aac|ogg|flac|txt|json|csv|srt|vtt|md)(\?|$)/.test(url);
    }

    function isSingleImageNode(node) {
        return Boolean(
            node
            && (node.type === 'smart-image' || !node.type)
            && Array.isArray(node.images)
            && node.images.length === 1
            && (isStillImage(node.images[0])
                || ['video','audio','file'].includes(String(node.images[0]?.kind || '').toLowerCase()))
        );
    }

    function isImageNode(node) {
        return Boolean(node && (node.type === 'smart-image' || !node.type));
    }

    function explicitLayout(node, fallback) {
        const width = Number(node?.w);
        const height = Number(node?.h);
        return {
            cols:1,
            rows:1,
            width:Math.round(Number.isFinite(width) && width > 24 ? width : fallback.width),
            height:Math.round(Number.isFinite(height) && height > 24 ? height : fallback.height),
            thumb:96,
            single:true
        };
    }

    function brushLayout(node) {
        const width = Number(node?.w);
        const height = Number(node?.h);
        const fallback = DEFAULT_LAYOUTS['smart-brush'];
        return {
            cols:1,
            rows:1,
            width:Number.isFinite(width) && width > 0 ? width : fallback.width,
            height:Number.isFinite(height) && height > 0 ? height : fallback.height,
            thumb:1,
            single:true
        };
    }

    function promptHasInputMedia(node) {
        if (node?.promptHasInputMedia === true) return true;
        return [node?.llmInputMedia, node?.manualInputRefs]
            .some(items => Array.isArray(items) && items.some(item => item?.url));
    }

    function promptLayout(node) {
        const explicitWidth = Number(node?.w);
        const explicitHeight = Number(node?.h);
        if (
            Number.isFinite(explicitWidth) && explicitWidth > 24
            && Number.isFinite(explicitHeight) && explicitHeight > 24
        ) {
            return explicitLayout(node, DEFAULT_LAYOUTS['smart-prompt']);
        }
        if (node?.llmEnabled) {
            return {
                cols:1,
                rows:1,
                width:PROMPT_WIDTH,
                height:PROMPT_GENERATION_HEIGHT
                    + (promptHasInputMedia(node) ? PROMPT_INPUT_MEDIA_HEIGHT : 0)
                    + (node?.promptHasUpstreamText === true ? PROMPT_UPSTREAM_TEXT_HEIGHT : 0),
                thumb:96,
                single:true
            };
        }
        const text = String(node?.text || '').trim();
        if (text) {
            return {
                cols:1,
                rows:1,
                width:PROMPT_WIDTH,
                height:Math.max(
                    PROMPT_CONTENT_MIN_HEIGHT,
                    Math.min(
                        PROMPT_CONTENT_MAX_HEIGHT,
                        140 + Math.ceil(text.length / 32) * 22
                    )
                ),
                thumb:96,
                single:true
            };
        }
        return explicitLayout(node, DEFAULT_LAYOUTS['smart-prompt']);
    }

    function imageNodeLayout(node) {
        if (isSingleImageNode(node)) return singleImageLayout(node);
        const images = Array.isArray(node?.images) ? node.images : [];
        const explicitWidth = Number(node?.w);
        const explicitHeight = Number(node?.h);
        if (
            images.length <= 1
            && Number.isFinite(explicitWidth) && explicitWidth > 24
            && Number.isFinite(explicitHeight) && explicitHeight > 24
        ) {
            return explicitLayout(node, {width:explicitWidth,height:explicitHeight});
        }
        if (!images.length) {
            const scale = effectiveScale(node);
            return explicitLayout(node, Number(node?.pending) > 0 || node?.queued
                ? {width:260 * scale,height:180 * scale}
                : {width:316,height:194});
        }
        const scale = multiImageScale(node);
        const count = images.length;
        const thumb = Math.min(MEDIA_GROUP_THUMB_MAX, Math.round(MEDIA_GROUP_THUMB_BASE * scale));
        const grid = images.find(image => image?.grid?.type === 'grid-split')?.grid;
        if (
            Number.isFinite(explicitWidth) && explicitWidth > 40
            && Number.isFinite(explicitHeight) && explicitHeight > 40
        ) {
            const fitted = boundedMultiMediaGridLayout(images, explicitWidth, explicitHeight, {
                fixedCols:grid ? Math.max(1, Number(grid.cols || 1)) : 0
            });
            return {
                ...fitted,
                width:Math.round(explicitWidth),
                height:Math.round(explicitHeight),
                single:false
            };
        }
        const cols = grid
            ? Math.max(1, Number(grid.cols || 1))
            : Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))));
        const rows = grid
            ? Math.max(1, Number(grid.rows || 1))
            : Math.ceil(count / cols);
        const visibleRows = Math.min(MEDIA_GROUP_MAX_VISIBLE_ROWS, rows);
        const gridHeight = multiMediaGridHeight(images, cols, thumb, visibleRows);
        return {
            cols,
            rows,
            visibleRows,
            width:Math.max(
                Math.round(226 * scale),
                cols * (thumb + MEDIA_GROUP_GAP) + MEDIA_GROUP_PADDING
            ),
            height:gridHeight + MEDIA_GROUP_PADDING,
            thumb,
            gridHeight,
            single:false
        };
    }

    function mediaAspectRatio(image) {
        const size = mediaSize(image);
        return size ? size.width / size.height : 1;
    }

    function multiMediaGridHeight(images, cols, thumb, visibleRows) {
        const rows = [];
        const rowCount = Math.min(
            Math.ceil(images.length / Math.max(1, cols)),
            Math.max(1, visibleRows)
        );
        for (let row = 0; row < rowCount; row += 1) {
            const items = images.slice(row * cols, row * cols + cols);
            const mediaHeight = Math.max(...items.map(image => (
                Math.round(thumb / Math.max(.05, mediaAspectRatio(image)))
            )), 1);
            rows.push(mediaHeight + MEDIA_NAME_ROW_HEIGHT);
        }
        return rows.reduce((sum, height) => sum + height, 0)
            + Math.max(0, rows.length - 1) * MEDIA_GROUP_GAP;
    }

    function boundedMultiMediaGridLayout(images, explicitWidth, explicitHeight, {fixedCols=0} = {}) {
        const count = Math.max(1, images.length);
        const innerWidth = Math.max(28, explicitWidth - MEDIA_GROUP_PADDING);
        const capacity = Math.max(
            1,
            Math.floor((innerWidth + MEDIA_GROUP_GAP) / (MEDIA_GROUP_THUMB_MAX + MEDIA_GROUP_GAP))
        );
        const fittedCols = Math.max(
            1,
            Math.min(count, fixedCols > 0 ? Math.round(fixedCols) : capacity)
        );
        const fittedThumb = Math.max(
            28,
            Math.min(
                MEDIA_GROUP_THUMB_MAX,
                Math.floor((innerWidth - Math.max(0, fittedCols - 1) * MEDIA_GROUP_GAP) / fittedCols)
            )
        );
        const rows = Math.ceil(count / fittedCols);
        const fullGridHeight = multiMediaGridHeight(images, fittedCols, fittedThumb, rows);
        return {
            cols:fittedCols,
            rows,
            visibleRows:rows,
            thumb:fittedThumb,
            gridHeight:Math.min(fullGridHeight, Math.max(1, Math.floor(explicitHeight - MEDIA_GROUP_PADDING))),
            fullGridHeight,
            single:false
        };
    }

    function multiImageScale(node) {
        const scale = Number(node?.scale);
        if (scale === MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE) return MEDIA_GROUP_DEFAULT_SCALE;
        return Number.isFinite(scale) && scale > 0 ? scale : MEDIA_GROUP_DEFAULT_SCALE;
    }

    function singleImageLayout(node) {
        const image = node.images[0];
        const size = mediaSize(image);
        const savedMediaWidth = Number(node.generationMediaW);
        const savedMediaHeight = Number(node.generationMediaH);
        if (
            Number.isFinite(savedMediaWidth)
            && savedMediaWidth > 24
            && Number.isFinite(savedMediaHeight)
            && savedMediaHeight > 24
        ) {
            return {
                cols:1,
                rows:1,
                width:Math.round(savedMediaWidth),
                height:Math.round(savedMediaHeight),
                thumb:Math.round(96 * effectiveScale(node)),
                single:true
            };
        }
        const explicitWidth = Number(node.w);
        const explicitHeight = Number(node.h);
        if (
            Number.isFinite(explicitWidth)
            && explicitWidth > 24
            && Number.isFinite(explicitHeight)
            && explicitHeight > 24
        ) {
            const width = Math.round(explicitWidth);
            const height = size
                ? Math.max(1, Math.round(width / (size.width / size.height)))
                : Math.round(explicitHeight);
            return {
                cols:1,
                rows:1,
                width,
                height,
                thumb:Math.round(96 * effectiveScale(node)),
                single:true
            };
        }
        const scale = effectiveScale(node);
        if (size) {
            const fit = Math.min(
                MAX_IMAGE_WIDTH * scale / size.width,
                MAX_IMAGE_HEIGHT * scale / size.height
            );
            return {
                cols:1,
                rows:1,
                width:Math.max(1, Math.round(size.width * fit)),
                height:Math.max(1, Math.round(size.height * fit)),
                thumb:Math.round(96 * scale),
                single:true
            };
        }
        return {
            cols:1,
            rows:1,
            width:Math.round(MAX_IMAGE_WIDTH * scale),
            height:Math.round(180 * scale),
            thumb:Math.round(96 * scale),
            single:true
        };
    }

    function effectiveScale(node) {
        const scale = Number(node?.scale);
        return Number.isFinite(scale) && scale > 0 ? scale : DEFAULT_SCALE;
    }

    function deepFreeze(value) {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
        Object.values(value).forEach(deepFreeze);
        return Object.freeze(value);
    }

    function diagnosticsForSingleImage(node, size) {
        const diagnostics = [];
        const nodeId = String(node.id || '');
        const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
        if (
            (hasOwn(node, 'x') && !Number.isFinite(Number(node.x)))
            || (hasOwn(node, 'y') && !Number.isFinite(Number(node.y)))
        ) {
            diagnostics.push({
                code:'invalid-node-position',
                nodeId,
                path:'x/y'
            });
        }
        const hasPersistedSize = hasOwn(node, 'w') || hasOwn(node, 'h');
        const persistedWidth = Number(node.w);
        const persistedHeight = Number(node.h);
        if (
            hasPersistedSize
            && !(
                Number.isFinite(persistedWidth)
                && persistedWidth > 24
                && Number.isFinite(persistedHeight)
                && persistedHeight > 24
            )
        ) {
            diagnostics.push({
                code:'invalid-persisted-dimensions',
                nodeId,
                path:'w/h'
            });
        }
        const image = node.images[0];
        const dimensionKeys = [
            'natural_w',
            'natural_h',
            'width',
            'height',
            'w',
            'h',
            'layout_w',
            'layout_h',
            'preview_w',
            'preview_h'
        ];
        const hasImageDimensions = dimensionKeys.some(key => hasOwn(image, key));
        if (!size) {
            diagnostics.push({
                code:hasImageDimensions
                    ? 'invalid-image-dimensions'
                    : 'missing-image-dimensions',
                nodeId,
                path:'images[0]'
            });
        }
        if (
            hasOwn(node, 'scale')
            && !(Number.isFinite(Number(node.scale)) && Number(node.scale) > 0)
        ) {
            diagnostics.push({
                code:'invalid-node-scale',
                nodeId,
                path:'scale'
            });
        }
        return diagnostics;
    }

    function diagnosticsForNode(node, layout) {
        if (isSingleImageNode(node)) return diagnosticsForSingleImage(node, mediaSize(node.images[0]));
        const diagnostics = [];
        const nodeId = String(node?.id || '');
        const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
        const minimumPersistedDimension = node?.type === 'smart-brush' ? 0 : 24;
        if (
            (hasOwn(node, 'x') && !Number.isFinite(Number(node.x)))
            || (hasOwn(node, 'y') && !Number.isFinite(Number(node.y)))
        ) diagnostics.push({code:'invalid-node-position',nodeId,path:'x/y'});
        if (
            !Number.isFinite(Number(layout?.width)) || Number(layout.width) <= 0
            || !Number.isFinite(Number(layout?.height)) || Number(layout.height) <= 0
        ) diagnostics.push({code:'invalid-node-dimensions',nodeId,path:'w/h'});
        if (
            (hasOwn(node, 'w') || hasOwn(node, 'h'))
            && !(Number.isFinite(Number(node.w))
                && Number(node.w) > minimumPersistedDimension
                && Number.isFinite(Number(node.h))
                && Number(node.h) > minimumPersistedDimension)
        ) diagnostics.push({code:'invalid-persisted-dimensions',nodeId,path:'w/h'});
        return diagnostics;
    }

    function nodeRole(node) {
        if (node?.type === 'smart-frame') return 'frame';
        if (node?.type === 'smart-group') return 'smart-group';
        if (node?.type === 'smart-text') return 'text-annotation';
        if (node?.type === 'smart-brush') return 'drawing';
        if (node?.type === 'smart-prompt') return node?.llmEnabled ? 'prompt-generation' : 'prompt';
        return String(node?.type || 'smart-image');
    }

    function measureNode(node) {
        const type = String(node?.type || 'smart-image');
        if (!isImageNode(node) && !DEFAULT_LAYOUTS[type]) {
            return deepFreeze({
                nodeId:String(node?.id || ''),
                supported:false,
                diagnostics:[]
            });
        }
        const layout = isImageNode(node)
            ? imageNodeLayout(node)
            : type === 'smart-prompt'
                ? promptLayout(node)
                : type === 'smart-brush'
                    ? brushLayout(node)
                    : explicitLayout(node, DEFAULT_LAYOUTS[type]);
        const x = Number.isFinite(Number(node.x)) ? Number(node.x) : 0;
        const y = Number.isFinite(Number(node.y)) ? Number(node.y) : 0;
        const footprint = {
            x,
            y,
            width:layout.width,
            height:layout.height
        };
        const centerX = x + layout.width / 2;
        const centerY = y + layout.height / 2;
        const size = isSingleImageNode(node) ? mediaSize(node.images[0]) : null;
        const diagnostics = diagnosticsForNode(node, layout);
        const placementObstacle = !['smart-frame','smart-text','smart-brush'].includes(type);
        const interactionFootprint = placementObstacle
            ? {
                x:x - INTERACTION_INSET.left,
                y:y - INTERACTION_INSET.top,
                width:layout.width + INTERACTION_INSET.left + INTERACTION_INSET.right,
                height:layout.height + INTERACTION_INSET.top + INTERACTION_INSET.bottom
            }
            : {...footprint};
        return deepFreeze({
            nodeId:String(node.id || ''),
            supported:true,
            footprint,
            interactionFootprint,
            layout,
            role:nodeRole(node),
            placementObstacle,
            spatialContainer:type === 'smart-frame',
            constraints:{
                minimum:{
                    width:MINIMUM_NODE_SIZE,
                    height:MINIMUM_NODE_SIZE
                },
                aspectRatio:size
                    ? size.width / size.height
                    : layout.width / layout.height
            },
            anchors:{
                input:{x, y:centerY},
                output:{x:x + layout.width, y:centerY},
                historyInput:{x:centerX, y},
                historyOutput:{x:centerX, y:y + layout.height}
            },
            diagnostics
        });
    }

    function overlayNodesById(previewOverlay) {
        const overlayNodes = previewOverlay?.nodes;
        if (overlayNodes && typeof overlayNodes === 'object') {
            return new Map(
                Object.entries(overlayNodes)
                    .filter(([, node]) => node && typeof node === 'object')
            );
        }
        return new Map();
    }

    function createSession(snapshot = {}, previewOverlay = null) {
        const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
        const nodesById = new Map(
            nodes
                .filter(node => node && node.id !== undefined && node.id !== null)
                .map(node => [String(node.id), node])
        );
        const previewNodesById = overlayNodesById(previewOverlay);
        const memo = new Map();
        return Object.freeze({
            measure(nodeId) {
                const key = String(nodeId ?? '');
                if (!memo.has(key)) {
                    const effectiveNode = previewNodesById.has(key)
                        ? previewNodesById.get(key)
                        : nodesById.get(key);
                    memo.set(key, measureNode(effectiveNode));
                }
                return memo.get(key);
            }
        });
    }

    return Object.freeze({createSession});
});
