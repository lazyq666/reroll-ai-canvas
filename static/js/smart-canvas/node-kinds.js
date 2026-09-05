/*
 * Smart Canvas Node Kinds
 *
 * This module is the canonical seam between persisted Node families and their
 * public presentation roles:
 * - Prompt Nodes contain manually authored prompt text.
 * - Prompt Generation Nodes use a text model to generate prompt text.
 * - Text Annotation Nodes are visual notes created from SmartCanvasDock.
 *
 * Prompt and Prompt Generation Nodes intentionally share the persisted
 * `smart-prompt` family for backward compatibility. Their domain roles are
 * distinguished by `llmEnabled`.
 */
(function initSmartCanvasNodeKinds(global){
    const IMAGE = 'smart-image';
    const LAYER_DECOMPOSITION = 'smart-layer-decomposition';
    const PROMPT = 'smart-prompt';
    const SPLITTER = 'smart-splitter';
    const LOOP = 'smart-loop';
    const SMART_GROUP = 'smart-group';
    const FRAME = 'smart-frame';
    const TEXT_ANNOTATION = 'smart-text';
    const BRUSH_STROKE = 'smart-brush';

    const ROLE_DEFINITIONS = Object.freeze([
        Object.freeze({role:'image', type:IMAGE}),
        Object.freeze({role:'generation', type:IMAGE, discriminator:'referenceGenerationKind'}),
        Object.freeze({role:'prompt', type:PROMPT}),
        Object.freeze({role:'prompt-generation', type:PROMPT, discriminator:'llmEnabled'}),
        Object.freeze({role:'splitter', type:SPLITTER}),
        Object.freeze({role:'loop', type:LOOP}),
        Object.freeze({role:'smart-group', type:SMART_GROUP}),
        Object.freeze({role:'frame', type:FRAME}),
        Object.freeze({role:'text-annotation', type:TEXT_ANNOTATION}),
        Object.freeze({role:'brush-stroke', type:BRUSH_STROKE})
    ]);

    function isPromptFamily(node){
        return node?.type === PROMPT;
    }

    function isPrompt(node){
        return isPromptFamily(node) && !node?.llmEnabled;
    }

    function isPromptGeneration(node){
        return isPromptFamily(node) && Boolean(node?.llmEnabled);
    }

    function isTextAnnotation(node){
        return node?.type === TEXT_ANNOTATION;
    }

    function isImage(node){
        return Boolean(node && (node.type === IMAGE || !node.type));
    }

    function isGeneration(node){
        return isImage(node) && ['image','video'].includes(node?.referenceGenerationKind);
    }

    function isLayerDecomposition(node){
        return node?.type === LAYER_DECOMPOSITION;
    }

    function hasDeliveredMedia(node){
        return isImage(node)
            && Array.isArray(node?.images)
            && node.images.some(item => Boolean(item?.url));
    }

    function isSplitter(node){
        return node?.type === SPLITTER;
    }

    function isLoop(node){
        return node?.type === LOOP;
    }

    function isSmartGroup(node){
        return node?.type === SMART_GROUP;
    }

    function isFrame(node){
        return node?.type === FRAME || node?.type === 'smart-section';
    }

    function isBrushStroke(node){
        return node?.type === BRUSH_STROKE;
    }

    function roleOf(node){
        if(isPromptGeneration(node)) return 'prompt-generation';
        if(isPrompt(node)) return 'prompt';
        if(isGeneration(node) && !hasDeliveredMedia(node)) return 'generation';
        if(isLayerDecomposition(node)) return 'image';
        if(isImage(node)) return 'image';
        if(isSplitter(node)) return 'splitter';
        if(isLoop(node)) return 'loop';
        if(isSmartGroup(node)) return 'smart-group';
        if(isFrame(node)) return 'frame';
        if(isTextAnnotation(node)) return 'text-annotation';
        if(isBrushStroke(node)) return 'brush-stroke';
        return 'other';
    }

    function catalog(){
        return ROLE_DEFINITIONS;
    }

    global.SmartCanvasModules = global.SmartCanvasModules || {};
    global.SmartCanvasModules.nodeKinds = Object.freeze({
        IMAGE,
        LAYER_DECOMPOSITION,
        PROMPT,
        SPLITTER,
        LOOP,
        SMART_GROUP,
        FRAME,
        TEXT_ANNOTATION,
        BRUSH_STROKE,
        catalog,
        isImage,
        isGeneration,
        isLayerDecomposition,
        isPromptFamily,
        isPrompt,
        isPromptGeneration,
        isSplitter,
        isLoop,
        isSmartGroup,
        isFrame,
        isTextAnnotation,
        isBrushStroke,
        roleOf
    });
})(window);
