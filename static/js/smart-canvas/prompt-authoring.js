/*
 * Smart Canvas Prompt Authoring Module
 *
 * Owns restoration and resolution of the complete Generation Recipe: authored
 * text, mention tokens, upstream prompts and referenced media. Composer preview
 * and Generation Run submission must consume this same interface.
 */
const promptAuthoringContainerModule = window.SmartCanvasModules?.smartContainer;
if(!promptAuthoringContainerModule) throw new Error('Smart Container Module failed to load');

const promptAuthoringFallbacks = Object.freeze({
    'smart.kindAudio':'音频',
    'smart.kindImage':'图片',
    'canvas.imageNumber':'图{number}',
    'smart.mediaNumber':'{kind}{count}',
    'smart.referenceMapLine':'图{number}：{name}',
    'smart.refMapHeader':'下面是参考图编号：',
    'smart.refUserNeed':'用户需求：',
    'smart.localTextTooLarge':'本次生成合并的 TXT 文本超过 2MB'
});
const promptCharacterSegmenter = new Intl.Segmenter(undefined, {
    granularity:'grapheme'
});
function promptAuthoringText(key, values={}){
    const translated = typeof tr === 'function'
        ? tr(key)
        : window.StudioI18n?.t?.(key);
    const text = translated && translated !== key
        ? translated
        : (promptAuthoringFallbacks[key] || key);
    return Object.entries(values).reduce(
        (result,[name,value]) => result.replaceAll(`{${name}}`, String(value)),
        text
    );
}

function promptAuthoringQuickTrigger(text='', caret=0){
    const before = String(text || '').slice(0, Math.max(0, Number(caret) || 0));
    const match = before.match(/(?:^|\s)([\/@])([^\/@\n]*)$/);
    if(!match || /^\s/.test(match[2] || '')) return '';
    return match[1];
}
function promptAuthoringQuickOpenIntent(options={}){
    if(options.isComposing || options.inputType !== 'insertText') return false;
    return options.data === '@' || options.data === '/';
}
function promptAuthoringWheelIntent(options={}){
    if(options.modal) return 'modal';
    if(options.modifier) return 'zoom';
    if(options.farPresentation) return 'pan';
    if(options.localOwnsWheel) return 'local';
    if(options.localCanScroll) return 'local';
    return 'pan';
}

function collectPromptAuthoringParts(root=promptInput){
    if(!root) return [];
    // One-way compatibility migration: old Prompt Template tokens carried a
    // frozen text snapshot. They now become ordinary editable text as soon as
    // the authoring surface is restored or resolved.
    root.querySelectorAll?.('.prompt-template-token').forEach(token => {
        token.replaceWith(document.createTextNode(token.dataset.promptText || ''));
    });
    const parts = [];
    const walk = node => {
        if(node.nodeType === Node.TEXT_NODE){
            if(node.textContent) parts.push({type:'text', text:node.textContent});
            return;
        }
        if(node.nodeType !== Node.ELEMENT_NODE) return;
        if(node.classList?.contains('mention-image-token')){
            let assetUris = {};
            try { assetUris = JSON.parse(node.dataset.assetUris || '{}') || {}; } catch(e) { assetUris = {}; }
            const kind = node.dataset.kind || 'image';
            parts.push({
                type:'image',
                kind,
                url:node.dataset.url || '',
                name:node.dataset.name || (kind === 'audio' ? promptAuthoringText('smart.kindAudio') : promptAuthoringText('smart.kindImage')),
                nodeId:node.dataset.nodeId || '',
                imageIndex:Number(node.dataset.imageIndex || 0),
                outputId:node.dataset.outputId || '',
                inputInstanceId:node.dataset.inputInstanceId || '',
                asset_uris:assetUris
            });
            return;
        }
        if(node.tagName === 'BR'){
            parts.push({type:'text', text:'\n'});
            return;
        }
        const blockTags = new Set(['DIV','P','LI','SECTION','ARTICLE','HEADER','FOOTER','BLOCKQUOTE']);
        const isBlock = node !== root && blockTags.has(node.tagName);
        if(isBlock && parts.length && parts[parts.length - 1]?.text && !/\n$/.test(parts[parts.length - 1].text)){
            parts.push({type:'text', text:'\n'});
        }
        node.childNodes.forEach(walk);
        if(isBlock) parts.push({type:'text', text:'\n'});
    };
    root.childNodes.forEach(walk);
    return parts;
}
function promptAuthoringCharacterText(root=promptInput){
    return collectPromptAuthoringParts(root)
        .filter(part => part.type === 'text')
        .map(part => part.text || '')
        .join('')
        .replace(/\r/g, '');
}
function promptAuthoringCharacterCount(text=''){
    let count = 0;
    for(const _segment of promptCharacterSegmenter.segment(String(text ?? ''))) count += 1;
    return count;
}
function promptAuthoringPlainText(parts){
    let text = '';
    (parts || []).forEach(part => {
        if(part.type === 'text'){
            text += part.text || '';
            return;
        }
        if(part.type === 'image') text += `@${part.name || promptAuthoringText('smart.kindImage')}`;
    });
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function promptAuthoringReferenceBelongsToNode(ref, node){
    if(!ref || !node) return false;
    if(ref.nodeId && String(ref.nodeId) === String(node.id || '')) return true;
    if(ref.outputId && (node.images || []).some(
        item => String(item?.outputId || '') === String(ref.outputId)
    )){
        return true;
    }
    if(ref.inputInstanceId || ref.outputId || ref.nodeId) return false;
    return Boolean(ref.url && (node.images || []).some(item => item?.url === ref.url));
}
function promptAuthoringStoredImages(node){
    if(!node) return [];
    return ['recipeSourceRefs','runInputRefs','runPromptRefs']
        .map(key => Array.isArray(node[key])
            ? node[key].filter(ref => ref?.url).map(ref => ({...ref}))
            : [])
        .find(refs => refs.length) || [];
}
function promptAuthoringDefaultImages(node, overrideDefaultImages=null, consumeDefault=false, context=null){
    if(Array.isArray(overrideDefaultImages)) return overrideDefaultImages;
    const stored = promptAuthoringStoredImages(node);
    const connected = typeof activeInputImagesFor === 'function'
        ? activeInputImagesFor(node, consumeDefault, context).filter(ref => ref?.url)
        : [];
    const manual = typeof manualReferenceImagesFor === 'function'
        ? manualReferenceImagesFor(node).filter(ref => ref?.url && ref?.kind !== 'text')
        : [];
    // Live Connections are the current input contract. Frozen Generation Run
    // references remain on the Node for history/rerun, but must not resurrect
    // a source that has been disconnected or deleted while another live input
    // still exists.
    if(connected.length){
        return uniqueReferenceImages([...connected, ...manual]);
    }
    const storedOnlyReferencesOwnOutput = stored.length > 0
        && stored.every(ref => promptAuthoringReferenceBelongsToNode(ref, node));
    if(stored.length && !(storedOnlyReferencesOwnOutput && connected.length)){
        return uniqueReferenceImages([...stored, ...connected, ...manual]);
    }
    return defaultReferenceImagesFor(node, consumeDefault, context);
}
function promptAuthoringTextReferences(node, context=null){
    if(!node || typeof composerTextReferenceNodesFor !== 'function') return [];
    return composerTextReferenceNodesFor(node, context);
}
function promptAuthoringInputText(node, textRefs, context=null){
    const seen = new Set();
    return (textRefs || [])
        .filter(ref => ref?.id !== node?.id)
        .map(ref => textForNode(ref, context).trim())
        .filter(text => {
            if(!text || seen.has(text)) return false;
            seen.add(text);
            return true;
        })
        .join('\n\n');
}
function promptAuthoringLocalTextReferences(node){
    return Array.isArray(node?.localTextRefs)
        ? node.localTextRefs.filter(ref => ref?.url).map(ref => ({...ref}))
        : [];
}
function promptAuthoringLocalTextValidation(refs){
    const errors = (refs || []).filter(ref => ref?.textError).map(ref => `${ref.name || 'TXT'}：${ref.textError}`);
    const totalBytes = (refs || []).reduce((sum, ref) => sum + Math.max(0, Number(ref?.textBytes || 0)), 0);
    if(totalBytes > 2 * 1024 * 1024) errors.push(promptAuthoringText('smart.localTextTooLarge'));
    return errors;
}
function promptAuthoringJoinUnique(parts){
    const seen = new Set();
    return (parts || []).map(value => String(value || '').trim()).filter(value => {
        if(!value || seen.has(value)) return false;
        seen.add(value);
        return true;
    }).join('\n\n');
}
function promptAuthoringDraftFromInput(node, inputText=''){
    if(!node) return {html:'', text:''};
    inputText = String(inputText || '').trim();
    const hasDraft = Object.prototype.hasOwnProperty.call(node, 'promptDraftHtml')
        || Object.prototype.hasOwnProperty.call(node, 'promptDraftText');
    const draftHtml = String(node.promptDraftHtml || '');
    const draftText = String(node.promptDraftText || '').trim();
    const runPrompt = String(node.runPrompt || '').trim();
    const duplicatedResolvedPrompt = Boolean(
        inputText
        && draftText === inputText
        && runPrompt === inputText
    );
    const restoreGenerationSnapshot = Boolean(
        node.generationOutputNode
        && runPrompt
        && (
            (!draftHtml && !draftText)
            || duplicatedResolvedPrompt
        )
    );
    // A Generation Output may have no authored draft when its prompt came
    // entirely from upstream text Nodes. Its frozen runPrompt is still the
    // original generation information and must remain visible when selected.
    if(restoreGenerationSnapshot){
        const rebuilt = typeof promptHtmlWithMentionTokens === 'function'
            ? promptHtmlWithMentionTokens(runPrompt, node.runPromptRefs || [])
            : '';
        return {
            html:rebuilt || '',
            text:runPrompt,
            restoredGenerationSnapshot:true
        };
    }
    if(duplicatedResolvedPrompt) return {html:'', text:''};
    if(hasDraft) return {html:draftHtml, text:String(node.promptDraftText || '')};
    if(inputText && runPrompt === inputText) return {html:'', text:''};
    const rebuilt = typeof promptHtmlWithMentionTokens === 'function'
        ? promptHtmlWithMentionTokens(runPrompt, node.runPromptRefs || [])
        : '';
    return {html:rebuilt || '', text:runPrompt};
}
function promptAuthoringDraft(node, context=null){
    if(!node) return {html:'', text:''};
    const textRefs = promptAuthoringTextReferences(node, context);
    const inputText = promptAuthoringInputText(node, textRefs, context).trim();
    return promptAuthoringDraftFromInput(node, inputText);
}
function restorePromptAuthoring(node, context=null){
    const draft = promptAuthoringDraft(node, context);
    promptInput.innerHTML = draft.html;
    collectPromptAuthoringParts(promptInput);
    if(!draft.html && draft.text) setPromptText(draft.text);
    return {...draft};
}
function resolvePromptAuthoring(node, overrideDefaultImages=null, consumeDefault=false, context=null, sourceSettings=settings){
    const parts = collectPromptAuthoringParts();
    const originalPrompt = promptAuthoringPlainText(parts);
    const blockedRefs = blockedInputRefKeys(node);
    const filteredDefaultImages = promptAuthoringDefaultImages(
        node,
        overrideDefaultImages,
        consumeDefault,
        context
    )
        .filter(img => !blockedRefs.has(inputRefKey(img)));
    const mentionedRefs = parts
        .filter(part => part.type === 'image' && part.url && !blockedRefs.has(inputRefKey(part)))
        .map(part => ({...part, kind:part.kind || 'image'}));
    const frameRoles = sourceSettings?.apiKind === 'video' && sourceSettings?.videoUseFrameRoles;
    const refs = promptAuthoringMigrationOrderRefs(
        node,
        uniqueReferenceImages([...filteredDefaultImages, ...mentionedRefs]),
        inputRefKey
    )
        .map((img, index) => ({
            ...img,
            role:promptAuthoringMigrationReferenceRole(index, frameRoles)
        }));
    let hasMentionToken = false;
    const refMap = new Map();
    refs.forEach((img, index) => refMap.set(inputRefKey(img), index + 1));
    let body = '';
    parts.forEach(part => {
        if(part.type === 'text'){
            body += part.text;
            return;
        }
        if(!part.url) return;
        hasMentionToken = true;
        const mentionedKey = inputRefKey(part);
        if(blockedRefs.has(mentionedKey) || !refMap.has(mentionedKey)){
            body += `@${part.name || promptAuthoringText('smart.kindImage')}`;
            return;
        }
        body += promptAuthoringText('canvas.imageNumber', {number: refMap.get(mentionedKey)});
    });
    body = promptAuthoringNormalizeMigrationPrompt(body);
    const textRefs = promptAuthoringTextReferences(node, context);
    const groupPrompt = promptAuthoringContainerModule.isGroup(node) ? textForNode(node, context).trim() : '';
    const inputPrompt = promptAuthoringInputText(node, textRefs, context);
    const localTextRefs = promptAuthoringLocalTextReferences(node);
    const localTextPrompt = localTextRefs.map(ref => String(ref.textSnapshot || '').trim()).filter(Boolean).join('\n\n');
    const validationErrors = promptAuthoringLocalTextValidation(localTextRefs);
    body = promptAuthoringJoinUnique([groupPrompt, inputPrompt, localTextPrompt, body]);
    if(!body && sourceSettings?.engine === 'runninghub') body = rhDefaultPromptSuggestion();
    const displayPrompt = originalPrompt || body;
    const resolvedRefs = refs.map((img, index) => ({
        url:img.url,
        name:img.name || promptAuthoringText('canvas.imageNumber', {number: index + 1}),
        kind:img.kind || mediaKindForItem(img),
        nodeId:img.nodeId || '',
        imageIndex:img.imageIndex ?? '',
        outputId:img.outputId || '',
        inputInstanceId:img.inputInstanceId || '',
        asset_uris:img.asset_uris || {},
        ...Object.fromEntries(
            ['natural_w','natural_h','naturalWidth','naturalHeight','width','height','w','h']
                .map(key => [key, Number(img[key])])
                .filter(([, value]) => Number.isFinite(value) && value > 0)
        ),
        role:img.role || `image_${index + 1}`
    }));
    if(hasMentionToken && refs.length){
        const mapText = refs.map((img, i) => promptAuthoringText('smart.referenceMapLine', {number: i + 1, name: img.name || promptAuthoringText('smart.mediaNumber', {kind: promptAuthoringText('smart.kindImage'), count: i + 1})})).join('\n');
        return {
            prompt:`${promptAuthoringText('smart.refMapHeader')}\n${mapText}\n\n${promptAuthoringText('smart.refUserNeed')}\n${body}`,
            displayPrompt,
            refs:resolvedRefs,
            textRefs:textRefs.map(ref => ({...ref})),
            localTextRefs,
            validationErrors,
            mentioned:true
        };
    }
    return {
        prompt:body,
        displayPrompt,
        refs:resolvedRefs,
        textRefs:textRefs.map(ref => ({...ref})),
        localTextRefs,
        validationErrors,
        mentioned:false
    };
}
function resolvePromptAuthoringFromNodeDraft(node, defaultImages, context=null, sourceSettings=settings){
    const oldHtml = promptInput.innerHTML;
    restorePromptAuthoring(node, context);
    try {
        return resolvePromptAuthoring(node, defaultImages, false, context, sourceSettings);
    } finally {
        promptInput.innerHTML = oldHtml;
    }
}

// One-shot storage migration uses this pure snapshot path from Node.js. Keep
// normalization here, beside the live Composer resolver, so migration and the
// browser cannot silently grow two different definitions of Prompt Authoring.
const promptAuthoringMigrationSettingKeys = Object.freeze([
    'engine','apiKind','provider_id','model','ratio','resolution','customRatio',
    'customRatioWidth','customRatioHeight','customSize','customWidth','customHeight',
    'quality','count','videoProvider','videoModel','videoDuration','videoAspect',
    'videoResolution','videoEnhancePrompt','videoEnableUpsample','videoWatermark',
    'videoCameraFixed','videoGenerateAudio','videoReferenceMode','videoMultimodal',
    'videoUseFrameRoles','msgenModel','msCustomModel','msRatio','msResolution',
    'msCustomRatio','msCustomRatioWidth','msCustomRatioHeight','msCustomSize',
    'msCustomWidth','msCustomHeight','comfyMode','comfyWorkflow','comfyParams',
    'rhConfigKey','rhPayment','rhInstanceType','rhParams','rhRandomActive',
    'width','height','enhanceStrength','enhanceUpscale','enhanceUpscaleRes',
    'editUpscale','editUpscaleRes'
]);
function promptAuthoringMigrationClone(value, fallback){
    try {
        return JSON.parse(JSON.stringify(value));
    } catch(e) {
        return fallback;
    }
}
function promptAuthoringNormalizeMigrationPrompt(value){
    return String(value || '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
function promptAuthoringMigrationRefKey(ref={}){
    if(!ref?.url) return '';
    if(ref.inputInstanceId) return `instance|${ref.inputInstanceId}`;
    if(ref.outputId) return `output|${ref.outputId}`;
    const nodeId = String(ref.nodeId || '');
    const imageIndex = Number.isFinite(Number(ref.imageIndex))
        ? String(Number(ref.imageIndex))
        : '';
    if(nodeId && imageIndex !== '') return `${nodeId}|${imageIndex}`;
    return `url|${ref.url}`;
}
function promptAuthoringMigrationUniqueRefs(refs=[]){
    const seen = new Set();
    return (refs || []).filter(ref => {
        const key = promptAuthoringMigrationRefKey(ref);
        if(!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
function promptAuthoringMigrationOrderRefs(node, refs=[], keyForRef=promptAuthoringMigrationRefKey){
    const values = [...(refs || [])];
    const order = Array.isArray(node?.inputRefOrder) ? node.inputRefOrder.filter(Boolean) : [];
    if(!order.length || values.length < 2) return values;
    const ranks = new Map(order.map((key, index) => [key, index]));
    return values.map((item, index) => ({
        item,
        index,
        rank:ranks.has(keyForRef(item)) ? ranks.get(keyForRef(item)) : Number.MAX_SAFE_INTEGER
    })).sort((a, b) => (a.rank - b.rank) || (a.index - b.index)).map(entry => entry.item);
}
function promptAuthoringMigrationReferenceRole(index, frameRoles=false, existingRole=''){
    if(frameRoles){
        if(index === 0) return 'first_frame';
        if(index === 1) return 'last_frame';
    }
    return String(existingRole || `image_${index + 1}`);
}
function promptAuthoringMigrationSourceImages(source, connection={}){
    const images = Array.isArray(source?.images) ? source.images : [];
    const pinned = String(connection?.sourceOutputId || '');
    let selected = images;
    if(pinned) selected = images.filter(image => String(image?.outputId || '') === pinned);
    else if(source?.generationOutputNode && images.length > 1){
        const active = String(source?.activeOutputId || '');
        selected = active
            ? images.filter(image => String(image?.outputId || '') === active)
            : images.slice(0, 1);
    }
    return selected.filter(image => image?.url).map((image, index) => ({
        ...promptAuthoringMigrationClone(image, {}),
        nodeId:String(source?.id || ''),
        imageIndex:Number.isFinite(Number(image?.imageIndex))
            ? Number(image.imageIndex)
            : images.indexOf(image),
        kind:image?.kind || 'image',
        name:image?.name || promptAuthoringText('canvas.imageNumber', {number:index + 1})
    }));
}
function promptAuthoringMigrationConnectedRefs(canvas, node){
    const nodeMap = new Map((canvas?.nodes || []).map(item => [String(item?.id || ''), item]));
    const connections = (canvas?.connections || []).filter(connection => (
        String(connection?.to || '') === String(node?.id || '')
        && (connection?.kind || 'flow') === 'input'
    ));
    const legacyIds = connections.length
        ? []
        : (Array.isArray(node?.inputNodeIds) ? node.inputNodeIds : []);
    return [
        ...connections.flatMap(connection => (
            promptAuthoringMigrationSourceImages(
                nodeMap.get(String(connection?.from || '')),
                connection
            )
        )),
        ...legacyIds.flatMap(sourceId => (
            promptAuthoringMigrationSourceImages(nodeMap.get(String(sourceId || '')))
        ))
    ];
}
function promptAuthoringMigrationTextPrompt(canvas, node){
    const nodeMap = new Map((canvas?.nodes || []).map(item => [String(item?.id || ''), item]));
    const sourceIds = (canvas?.connections || [])
        .filter(connection => (
            String(connection?.to || '') === String(node?.id || '')
            && (connection?.kind || 'flow') === 'input'
        ))
        .map(connection => String(connection?.from || ''));
    if(!sourceIds.length && Array.isArray(node?.inputNodeIds)){
        sourceIds.push(...node.inputNodeIds.map(value => String(value || '')));
    }
    const seen = new Set();
    return sourceIds.map(id => nodeMap.get(id)).map(source => {
        if(source?.type !== 'smart-prompt') return '';
        return promptAuthoringNormalizeMigrationPrompt(source?.text);
    }).filter(text => {
        if(!text || seen.has(text)) return false;
        seen.add(text);
        return true;
    }).join('\n\n');
}
function promptAuthoringMigrationDraftText(node, inputText=''){
    const inputPrompt = promptAuthoringNormalizeMigrationPrompt(inputText);
    return promptAuthoringNormalizeMigrationPrompt(
        promptAuthoringDraftFromInput(node, inputPrompt).text
    );
}
function promptAuthoringMigrationPrompt(canvas, node, inputSnapshot={}){
    const inputPrompt = promptAuthoringMigrationTextPrompt(canvas, node);
    const draftPrompt = promptAuthoringMigrationDraftText(node, inputPrompt);
    const localTextPrompt = (Array.isArray(node?.localTextRefs) ? node.localTextRefs : [])
        .map(ref => promptAuthoringNormalizeMigrationPrompt(ref?.textSnapshot))
        .filter(Boolean)
        .join('\n\n');
    if(inputPrompt){
        const seen = new Set();
        return [inputPrompt, localTextPrompt, draftPrompt].filter(value => {
            const text = promptAuthoringNormalizeMigrationPrompt(value);
            if(!text || seen.has(text)) return false;
            seen.add(text);
            return true;
        }).join('\n\n');
    }
    return promptAuthoringNormalizeMigrationPrompt(
        node?.runModelPrompt
        || inputSnapshot.prompt
        || [localTextPrompt, draftPrompt].filter(Boolean).join('\n\n')
    );
}
function promptAuthoringMigrationCriticalSettings(settingsValue={}){
    const source = settingsValue && typeof settingsValue === 'object' ? settingsValue : {};
    return Object.fromEntries(promptAuthoringMigrationSettingKeys
        .filter(key => Object.prototype.hasOwnProperty.call(source, key))
        .map(key => [key, promptAuthoringMigrationClone(source[key], null)]));
}
function promptAuthoringIsMigrationResultNode(node){
    if(!node || typeof node !== 'object') return false;
    if(node.generationOutputNode === true) return true;
    const hasOutput = Array.isArray(node.images) && node.images.some(item => item?.url);
    if(!hasOutput) return false;
    return Boolean(
        node.runAt != null
        || String(node.runPrompt || '').trim()
        || String(node.runModelPrompt || '').trim()
        || (node.generationInputSnapshot && typeof node.generationInputSnapshot === 'object')
    );
}
function promptAuthoringMigrationSnapshot(canvas, node){
    const inputSnapshot = node?.generationInputSnapshot && typeof node.generationInputSnapshot === 'object'
        ? node.generationInputSnapshot
        : {};
    const settingsValue = node?.runSettings && typeof node.runSettings === 'object'
        ? node.runSettings
        : (inputSnapshot.settings && typeof inputSnapshot.settings === 'object' ? inputSnapshot.settings : {});
    const connected = promptAuthoringMigrationConnectedRefs(canvas, node);
    const manual = Array.isArray(node?.manualInputRefs) ? node.manualInputRefs.filter(ref => ref?.url && ref?.kind !== 'text') : [];
    const storedKeys = ['recipeSourceRefs','runInputRefs','runPromptRefs'];
    const hasStoredRefs = storedKeys.some(key => Array.isArray(node?.[key]))
        || Array.isArray(inputSnapshot.refs);
    const stored = storedKeys
        .map(key => Array.isArray(node?.[key]) ? node[key].filter(ref => ref?.url) : [])
        .find(items => items.length)
        || (Array.isArray(inputSnapshot.refs) ? inputSnapshot.refs.filter(ref => ref?.url) : []);
    const self = promptAuthoringMigrationSourceImages(node);
    let refs = connected.length
        ? [...connected, ...manual]
        : stored.length
        ? [...stored, ...manual]
        : hasStoredRefs
        ? [...manual]
        : [...self, ...manual];
    const blocked = new Set(Array.isArray(node?.blockedInputRefs) ? node.blockedInputRefs : []);
    refs = promptAuthoringMigrationUniqueRefs(refs)
        .filter(ref => !blocked.has(promptAuthoringMigrationRefKey(ref)));
    refs = promptAuthoringMigrationOrderRefs(node, refs);
    const frameRoles = settingsValue?.apiKind === 'video' && settingsValue?.videoUseFrameRoles;
    refs = refs.map((ref, index) => ({
        ...promptAuthoringMigrationClone(ref, {}),
        url:String(ref?.url || ''),
        name:String(ref?.name || promptAuthoringText('canvas.imageNumber', {number:index + 1})),
        kind:String(ref?.kind || 'image'),
        nodeId:String(ref?.nodeId || ''),
        imageIndex:ref?.imageIndex ?? '',
        outputId:String(ref?.outputId || ''),
        inputInstanceId:String(ref?.inputInstanceId || ''),
        role:promptAuthoringMigrationReferenceRole(index, frameRoles, ref?.role)
    }));
    const prompt = promptAuthoringMigrationPrompt(canvas, node, inputSnapshot);
    return {
        nodeId:String(node?.id || ''),
        prompt,
        refs,
        settings:promptAuthoringMigrationClone(settingsValue, {}),
        criticalSettings:promptAuthoringMigrationCriticalSettings(settingsValue)
    };
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.promptAuthoring = Object.freeze({
    quickTrigger({text='',caret=0}={}){
        return promptAuthoringQuickTrigger(text, caret);
    },
    quickOpenIntent(options={}){
        return promptAuthoringQuickOpenIntent(options);
    },
    wheelIntent(options={}){
        return promptAuthoringWheelIntent(options);
    },
    parts(root=promptInput){
        return collectPromptAuthoringParts(root).map(part => ({...part}));
    },
    plainText(root=promptInput){
        return promptAuthoringPlainText(collectPromptAuthoringParts(root));
    },
    characterText(root=promptInput){
        return promptAuthoringCharacterText(root);
    },
    characterCount(text=''){
        return promptAuthoringCharacterCount(text);
    },
    restore({nodeId='', node=null, context=null}={}){
        const target = node || (nodeId ? nodes.find(item => item.id === nodeId) : null);
        return restorePromptAuthoring(target, context);
    },
    resolve({nodeId='', node=null, defaultImages=null, consumeDefault=false, context=null, settings:sourceSettings=null}={}){
        const target = node || (nodeId ? nodes.find(item => item.id === nodeId) : window.SmartCanvasModules.viewportSelection.selection.node());
        if(!target) return {prompt:'', displayPrompt:'', refs:[], textRefs:[], mentioned:false};
        return resolvePromptAuthoring(target, defaultImages, consumeDefault, context, sourceSettings || settings);
    },
    resolveFromNodeDraft({nodeId='', node=null, defaultImages=null, context=null, settings:sourceSettings=null}={}){
        const target = node || (nodeId ? nodes.find(item => item.id === nodeId) : null);
        if(!target) return {prompt:'', displayPrompt:'', refs:[], textRefs:[], mentioned:false};
        return resolvePromptAuthoringFromNodeDraft(target, defaultImages, context, sourceSettings || settings);
    },
    migrationSnapshot({canvas:sourceCanvas=null, node=null}={}){
        if(!node) return {nodeId:'', prompt:'', refs:[], settings:{}, criticalSettings:{}};
        return promptAuthoringMigrationSnapshot(sourceCanvas || {nodes:[],connections:[]}, node);
    },
    isMigrationResultNode(node){
        return promptAuthoringIsMigrationResultNode(node);
    },
});
