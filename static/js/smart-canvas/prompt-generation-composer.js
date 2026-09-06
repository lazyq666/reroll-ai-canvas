/* Dedicated text authoring surface. Node fields remain the only saved draft;
 * this controller owns selection routing, DOM lifetime and the local session. */
(function initPromptGenerationComposer(global){
    const shellTemplate = document.getElementById('composerCardTemplate');
    let root, editor, modelHost, refsHost, upstreamHost, run, expand, errorBox, dialog;
    let targetId = '', contextId = '', modelSignature = '', refsSignature = '', upstreamSignature = '';
    let renderedHtml = '', composing = false, expanded = false;
    const submitting = new Set();
    const drafts = new Map();
    let baseline = '', conflict = false, conflictActions;
    let savedRange = null, savedScroll = 0, expansionRevision = 0;
    const version = node => JSON.stringify([node?.llmInstruction ?? node?.text ?? '',node?.llmInstructionHtml || '']);
    const draftKey = () => `${contextId}:${targetId}`;
    const current = () => nodes.find(node => node.id === targetId);
    const eligible = node => global.SmartCanvasModules.nodeKinds.isPromptGeneration(node);
    const owns = element => Boolean(root && element && root.contains(element));
    function ensure(){
        if(root) return;
        root = document.createElement('section');
        root.id = 'promptGenerationComposer';
        root.className = 'composer text-generation-composer';
        root.hidden = true;
        // Consume the production media Composer shell; only its purpose-specific slots differ.
        const card = shellTemplate.content.firstElementChild.cloneNode(true);
        editor = card.querySelector('#promptInput');
        run = card.querySelector('#runBtn');
        expand = card.querySelector('#composerFocusToggle');
        refsHost = card.querySelector('#inputThumbsRow');
        for(const element of card.querySelectorAll('[id]')) element.removeAttribute('id');
        for(const element of [editor,run,expand]){
            for(const attr of [...element.attributes]) if(attr.name.startsWith('data-i18n')) element.removeAttribute(attr.name);
        }
        editor.id = 'textPromptInput';
        editor.classList.add('prompt-llm-instruction','composer-prompt-input');
        editor.removeAttribute('aria-describedby');
        run.className = 'text-composer-run run-btn';
        expand.setAttribute('data-text-expand','');
        refsHost.classList.add('has-items');
        refsHost.innerHTML = '';
        const inputs = document.createElement('div');
        inputs.className = 'text-composer-inputs';
        refsHost.replaceWith(inputs);
        inputs.append(refsHost);
        upstreamHost = document.createElement('details');
        upstreamHost.className = 'text-composer-upstream';
        upstreamHost.hidden = true;
        upstreamHost.innerHTML = '<summary></summary><div></div>';
        inputs.append(upstreamHost);
        modelHost = document.createElement('div');
        modelHost.className = 'dynamic-params text-composer-model';
        card.querySelector('.param-row').replaceChildren(modelHost);
        root.append(card);
        errorBox = document.createElement('ic-alert');
        errorBox.className = 'text-composer-error';
        errorBox.setAttribute('tone','danger');
        errorBox.hidden = true;
        root.append(errorBox);
        conflictActions = document.createElement('div');
        conflictActions.className = 'text-composer-conflict';
        conflictActions.hidden = true;
        conflictActions.innerHTML = '<ic-button data-text-conflict="saved" hierarchy="secondary"></ic-button><ic-button data-text-conflict="local" hierarchy="primary"></ic-button>';
        root.append(conflictActions);
        shell.append(root);
        conflictActions.addEventListener('click', event => {
            const choice = event.target.closest('[data-text-conflict]')?.dataset.textConflict;
            if(!choice || !current() || !canvasPersistence.editable()) return;
            baseline = version(current());
            conflict = false;
            drafts.delete(draftKey());
            if(choice === 'saved') editor.innerHTML = promptLlmInstructionEditorHtml(current());
            else persist();
            renderedHtml = editor.innerHTML;
            showError('');
            syncState();
        });
        for(const name of ['pointerdown','mousedown','click','dblclick','contextmenu','wheel']){
            root.addEventListener(name, event => event.stopPropagation());
        }
        root.addEventListener('keydown', event => {
            if(event.key === 'Escape' && !event.defaultPrevented){
                event.preventDefault();
                if(expanded) setExpanded(false);
                else editor.blur();
            }
            event.stopPropagation();
        });
        editor.addEventListener('compositionstart', () => { composing = true; });
        editor.addEventListener('compositionend', () => { composing = false; });
        editor.addEventListener('input', () => queueMicrotask(() => { renderedHtml = editor.innerHTML; syncState(); }));
        run.addEventListener('click', () => submit(targetId));
        expand.addEventListener('click', () => setExpanded(!expanded));
        window.addEventListener('beforeunload', flush, {capture:true});
        window.addEventListener('pagehide', flush);
        window.addEventListener('blur', flush);
    }
    function flush(){
        const node = current();
        if(!eligible(node) || !root || root.hidden || !canvasPersistence.editable() || composing) return;
        if(editor.innerHTML !== renderedHtml) persist();
        if(conflict) drafts.set(draftKey(),{html:editor.innerHTML,baseline});
        renderedHtml = editor.innerHTML;
    }
    function persist(){
        const node = current();
        if(!node || !canvasPersistence.editable()) return;
        const rawHtml = editor.innerHTML;
        const html = /^(?:<br>|<div><br><\/div>)$/i.test(rawHtml.trim()) ? '' : rawHtml;
        const text = promptAuthoring.plainText(editor);
        if(node.llmInstructionHtml === html && node.llmInstruction === text) return;
        if(version(node) !== baseline || conflict){
            conflict = true;
            drafts.set(draftKey(),{html,baseline});
            syncState();
            return;
        }
        canvasMutation.update({nodeId:node.id,mutate:live => {
            live.llmInstructionHtml = html; live.llmInstruction = text; live.text = text;
        },options:{render:false,select:false}});
        baseline = JSON.stringify([text,html]);
    }
    function syncState(){
        if(!root || root.hidden) return;
        const node = current();
        const entries = smartModelCatalog('text');
        const entry = entries.find(item => item.provider_id === node?.llmProvider && item.model === node?.llmModel);
        const canEdit = canvasPersistence.editable();
        const offline = !canvasPersistence.online();
        editor.contentEditable = canEdit ? 'true' : 'false';
        const uncertain = nodes.some(item => item.sourceNodeId === targetId && item.textSubmissionUnknown && item.textGenerationPending && !item.pendingTasks?.length);
        run.disabled = conflict || uncertain || offline || !canEdit || !entry || !promptNodeLLMInputText(node).trim() || submitting.has(targetId);
        run.setAttribute('aria-busy', String(submitting.has(targetId)));
        run.icon = submitting.has(targetId) ? 'loader' : 'submit';
        run.label = tr(submitting.has(targetId) ? 'smart.textComposer.submitting' : 'smart.textComposer.run');
        root.setAttribute('aria-label', tr('smart.promptGenerationNode'));
        editor.setAttribute('aria-label', tr('smart.promptEditor'));
        editor.dataset.placeholder = tr('smart.textComposer.placeholder');
        expand.label = tr(expanded ? 'smart.collapseEditor' : 'smart.focusEdit');
        expand.icon = expanded ? 'collapse-editor' : 'focus-editor';
        expand.setAttribute('aria-expanded', String(expanded));
        const invalidKey = !entries.length ? 'smart.textComposer.noModels' : !entry ? 'smart.textComposer.modelUnavailable' : '';
        root.dataset.validation = invalidKey;
        conflictActions.hidden = !conflict;
        conflictActions.querySelector('[data-text-conflict="saved"]').textContent = tr('smart.textComposer.useSaved');
        conflictActions.querySelector('[data-text-conflict="local"]').textContent = tr('smart.textComposer.keepLocal');
        if(conflict) showError(tr('smart.textComposer.conflict'));
        else if(uncertain) showError(tr('smart.textComposer.uncertain'));
        else if(offline) showError(tr('smart.syncIncompleteGeneration'));
        else if(invalidKey) showError(tr(invalidKey));
        else if(errorBox.dataset.validation){ errorBox.hidden = true; delete errorBox.dataset.validation; }
        if(conflict || uncertain || offline || invalidKey) errorBox.dataset.validation = 'state';
        syncPromptCharacterCount(editor);
    }
    function showError(message){
        if(!errorBox) return;
        errorBox.hidden = !message;
        errorBox.textContent = message || '';
    }
    function update(node){
        const nextContext = String(canvasId || '');
        const nextId = eligible(node) && canvasPersistence.editable() ? node.id : '';
        if(!root && !nextId) return false;
        ensure();
        if(nextId !== targetId || contextId !== nextContext){
            flush();
            if(owns(promptQuickTargetEl)) closeMentionPicker();
            if(expanded) setExpanded(false);
            if(targetId) canvasVirtualization.unpin(targetId,'text-composer');
            targetId = nextId;
            contextId = nextContext;
            modelSignature = refsSignature = upstreamSignature = '';
            showError('');
            conflict = false;
            if(node && nextId){
                editor.dataset.nodeId = nextId;
                const draft = drafts.get(draftKey());
                baseline = draft?.baseline || version(node);
                conflict = Boolean(draft);
                editor.innerHTML = draft?.html ?? promptLlmInstructionEditorHtml(node);
                renderedHtml = editor.innerHTML;
                // Event handlers resolve the live Node after Canvas Sync replaces objects.
                bindPromptNodeRichEditor(root,node,editor,{instruction:true});
                canvasVirtualization.pin(nextId,'text-composer');
            }
        }
        root.hidden = !nextId;
        root.classList.toggle('open', Boolean(nextId));
        if(!nextId) return false;
        // Reconcile remote state without replacing a focused editor or its IME range.
        if(!conflict && document.activeElement !== editor && !composing && !owns(promptQuickTargetEl)){
            const html = promptLlmInstructionEditorHtml(node);
            if(html !== renderedHtml){ editor.innerHTML = html; renderedHtml = html; }
            baseline = version(node);
        }
        if(version(node) !== baseline){
            conflict = true;
            drafts.set(draftKey(),{html:editor.innerHTML,baseline});
        }
        const lang = global.StudioI18n?.lang?.() || 'zh';
        const signature = JSON.stringify([lang,smartModelCatalog('text'),node.llmProvider,node.llmModel]);
        if(signature !== modelSignature){
            modelSignature = signature;
            modelHost.innerHTML = promptNodeModelSelectHtml(node);
            const select = modelHost.querySelector('ic-select');
            select.addEventListener('change', () => {
                const entry = smartModelCatalog('text').find(item => item.id === select.value);
                if(!entry || !current() || !canvasPersistence.editable()) return;
                canvasMutation.update({nodeId:targetId,mutate:live => {
                    live.llmProvider = entry.provider_id; live.llmModel = entry.model;
                },options:{render:false,select:false}});
                showError('');
                syncState();
            });
        }
        const refs = promptNodeInputImages(node);
        const nextRefs = JSON.stringify([lang,refs,node.blockedInputRefs]);
        if(nextRefs !== refsSignature){
            refsSignature = nextRefs;
            const manual = new Set(manualReferenceImagesFor(node).map(inputRefKey));
            const counters = {image:0,video:0,audio:0,text:0,file:0};
            const thumbs = refs.map((ref,index) => composerInputMediaThumbHtml(node,ref,index,manual,counters)).join('');
            const label = escapeAttr(tr('smart.uploadLocalReference'));
            refsHost.innerHTML = `<div class="input-thumb-list ${refs.length > 1 ? 'is-scrollable' : refs.length ? 'is-single' : 'empty'}">${thumbs}<button class="input-thumb-add" type="button" data-input-add-reference title="${label}" aria-label="${label}"><ic-icon name="upload" aria-hidden="true"></ic-icon></button></div>`;
            bindSmartPreviewImageFallbacks(refsHost);
            bindInputThumbsDrag(node,refs,manual,{root:refsHost,onRefresh:() => render()});
            bindInputThumbReferenceActions(refsHost,node,{onRefresh:() => render()});
        }
        if(syncComposerMentionTokenLabels(node,refs,editor)) renderedHtml = editor.innerHTML;
        const text = promptNodeUpstreamPromptText(node);
        if(upstreamSignature !== lang + text){
            upstreamSignature = lang + text;
            upstreamHost.hidden = !text;
            upstreamHost.querySelector('summary').textContent = tr('smart.referencedText');
            upstreamHost.querySelector('div').textContent = text;
        }
        syncState();
        position();
        return true;
    }
    function position(){
        if(!root || root.hidden || expanded || !current()) return;
        positionComposerForNode(current(),root);
        if(smartCanvasDockPosition === 'left'){
            const width = Math.min(parseFloat(root.style.width),shell.clientWidth - 102);
            root.style.width = `${Math.max(0,width)}px`;
            root.style.left = `${Math.max(88,Math.min(parseFloat(root.style.left),shell.clientWidth-width-14))}px`;
        }
        const maxTop = Math.max(14,shell.clientHeight - root.offsetHeight - 14);
        root.style.top = `${Math.max(14,Math.min(parseFloat(root.style.top) || 14,maxTop))}px`;
    }
    function focus(node){
        if(!eligible(node)) return false;
        update(node);
        editor.focus({preventScroll:true});
        setPromptCaretToEnd(editor);
        return true;
    }
    async function setExpanded(value){
        if(!root || root.hidden || expanded === value) return;
        const revision = ++expansionRevision;
        const selection = window.getSelection();
        if(selection?.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)){
            const range = selection.getRangeAt(0);
            savedRange = {start:range.startContainer,startOffset:range.startOffset,end:range.endContainer,endOffset:range.endOffset};
        }
        savedScroll = editor.scrollTop;
        flush();
        closeMentionPicker();
        expanded = value;
        if(value){
            if(!dialog){
                dialog = document.createElement('ic-dialog');
                dialog.id = 'textComposerDialog';
                dialog.setAttribute('size','large');
                dialog.setAttribute('without-visible-header','');
                dialog.addEventListener('ic-hide', event => { if(event.target === dialog && expanded) restore(); });
                document.body.append(dialog);
            }
            dialog.setAttribute('label',tr('smart.promptGenerationNode'));
            root.classList.add('text-composer-expanded','focused');
            dialog.append(root);
            await dialog.updateComplete;
            if(revision !== expansionRevision) return;
            await dialog.show();
            if(revision === expansionRevision && expanded) restoreSelection();
        }else{
            restore();
            await dialog?.hide();
            if(revision === expansionRevision) restoreSelection();
        }
        syncState();
    }
    function restore(){
        expanded = false;
        root.classList.remove('text-composer-expanded','focused');
        shell.append(root);
        position();
        syncState();
    }
    function restoreSelection(){
        editor.focus({preventScroll:true});
        if(savedRange && editor.contains(savedRange.start) && editor.contains(savedRange.end)){
            const selection = window.getSelection();
            const range = document.createRange();
            range.setStart(savedRange.start,savedRange.startOffset);
            range.setEnd(savedRange.end,savedRange.endOffset);
            selection.removeAllRanges();
            selection.addRange(range);
        }
        editor.scrollTop = savedScroll;
    }
    async function submit(id,options={}){
        if(submitting.has(id)) return;
        const node = nodes.find(item => item.id === id);
        if(!eligible(node) || !canvasPersistence.editable()) return;
        flush();
        if(targetId === id && conflict) return;
        if(nodes.some(item => item.sourceNodeId === id && item.textSubmissionUnknown && item.textGenerationPending && !item.pendingTasks?.length)) return;
        if(!canvasPersistence.online()){
            showError(tr('smart.syncIncompleteGeneration')); return;
        }
        submitting.add(id);
        showError('');
        syncState();
        try{
            await runPromptLLMNode(id,{...options,onAccepted:() => { submitting.delete(id); syncState(); }});
        }catch(error){
            if(targetId === id) showError(error.message || tr('smart.promptLlmFailed'));
        }finally{
            submitting.delete(id);
            syncState();
        }
    }
    global.SmartCanvasModules = global.SmartCanvasModules || {};
    global.SmartCanvasModules.promptGenerationComposer = Object.freeze({update,position,focus,owns,submit,persist,
        expand:node => { if(targetId !== node.id) focus(node); return setExpanded(true); },
        refresh:() => { if(targetId) update(current()); },
        editorFor:node => node?.id === targetId ? editor : null
    });
})(window);
