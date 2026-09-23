/* Real Smart Canvas acceptance; served only by continue_editing_manual_server.py. */
(async () => {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const assert = (ok, message) => { if(!ok) throw new Error(message); };
    for(let i=0; i<200 && !window.SmartCanvasModules?.canvasPersistence?.online(); i++) await pause(50);
    const report = document.createElement('pre');
    report.id = 'continue-editing-report';
    report.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;padding:12px;background:#fff;color:#111;max-width:460px;white-space:pre-wrap';
    document.body.append(report);
    const passed = [];
    try {
        const refs = ['first','second'].map(inputInstanceId => ({
            url:'/static/images/test/fixture.svg', kind:'image', name:inputInstanceId,
            inputInstanceId, asset_uris:{test:inputInstanceId}
        }));
        const originalSettings = {engine:'api',apiKind:'image',apiProvider:'manual-mock',apiModel:'mock-image-1',count:1,aspect:'1:1'};
        const source = {
            id:'continue-editing-source',type:'smart-image',x:100,y:120,w:260,h:260,scale:1,
            referenceGenerationKind:'image',generationOutputNode:true,outputKind:'image',
            images:[{url:'/static/images/test/fixture.svg',kind:'image',name:'Original result'}],
            runPrompt:'Original prompt', runModelPrompt:'Original upstream text\n\nOriginal prompt',
            promptDraftText:'Later unsent draft',promptDraftHtml:'Later unsent draft',
            runSettings:{...originalSettings,count:3},
            generationInputSnapshot:{prompt:'Original upstream text\n\nOriginal prompt',refs,settings:originalSettings}
        };
        nodes.push(source); canvas.nodes = nodes;
        selectedId=source.id; selectedIds=[]; viewport.x=0; viewport.y=0; viewport.scale=1;
        render(); updateComposer();
        const originalSnapshot = JSON.stringify(source.generationInputSnapshot);
        const originalMedia = JSON.stringify(source.images.map(({url,kind,name})=>({url,kind,name})));
        const countBefore = nodes.length;
        await pause(100);
        document.querySelector(`[data-node-id="${source.id}"][data-smart-node-action="continue-editing"]`).click();
        const draft = nodes.find(node=>node.id===selectedId);
        assert(nodes.length===countBefore+1 && draft.id!==source.id, 'Creates exactly one selected draft');
        assert(draft.images.length===0 && !draft.pending && !draft.running && !draft.generationInputSnapshot, 'Draft is idle and has no result or run history');
        assert(draft.promptDraftText===source.generationInputSnapshot.prompt, 'Uses frozen full prompt, not later edits');
        assert(draft.runSettings.count===1, 'Uses frozen settings, not later edits');
        assert(draft.manualInputRefs.length===2, 'Preserves duplicate media instances');
        assert(!canvas.connections.some(c=>c.to===draft.id || c.from===draft.id), 'Does not invent connections or reference the old result');
        assert(document.activeElement===promptInput, 'Composer receives keyboard focus');
        await pause(250);
        const composerRect = composer.getBoundingClientRect();
        assert(composerRect.top>=0 && composerRect.bottom<=innerHeight, 'Composer is visible after creating draft');
        assert(JSON.stringify(source.generationInputSnapshot)===originalSnapshot && JSON.stringify(source.images.map(({url,kind,name})=>({url,kind,name})))===originalMedia, 'Original run and result unchanged');
        draft.manualInputRefs[0].asset_uris.test='edited';
        assert(source.generationInputSnapshot.refs[0].asset_uris.test==='first', 'Deep reference isolation');
        const restored = JSON.parse(JSON.stringify(draft));
        assert(restored.promptDraftText===draft.promptDraftText && restored.manualInputRefs.length===2, 'Draft persists through serialization');
        passed.push('PASS: toolbar, focus, frozen recipe, duplicate references, independent draft');
        const resolved = window.SmartCanvasModules.promptAuthoring.resolve({node:draft});
        assert(resolved.prompt===source.generationInputSnapshot.prompt && resolved.refs.length===2, 'Submission resolves complete frozen prompt and references');
        const legacy = {...source,id:'continue-editing-legacy',generationInputSnapshot:undefined};
        nodes.push(legacy);
        const legacyDraft = window.SmartCanvasModules.generationOutput.continueEditing({source:legacy});
        assert(legacyDraft.promptDraftText===legacy.runModelPrompt, 'Legacy result uses stored run prompt');
        const video = {...source,id:'continue-editing-video',outputKind:'video',referenceGenerationKind:'video',
            images:[{url:'/test-video.mp4',kind:'video'}],
            generationInputSnapshot:{...source.generationInputSnapshot,settings:{...originalSettings,apiKind:'video',videoAspect:'9:16'}}};
        nodes.push(video);
        const videoDraft = window.SmartCanvasModules.generationOutput.continueEditing({source:video});
        assert(videoDraft.referenceGenerationKind==='video' && videoDraft.h>videoDraft.w, 'Video draft retains video settings and aspect');
        assert(window.SmartCanvasModules.generationOutput.continueEditing({source:{...source,images:[]}})===null, 'No draft action for empty nodes');
        assert(window.SmartCanvasModules.generationOutput.continueEditing({source:{...source,queuedGenerationRun:{}}})===null, 'No draft action for queued nodes');
        passed.push('PASS: complete submission inputs, legacy results, video aspect, eligibility');
        selectedId=source.id; selectedIds=[]; render(); updateComposer();
        for(const lang of ['en','zh']){
            window.StudioI18n.set(lang);
            await pause(100);
            const button = document.querySelector(`[data-node-id="${source.id}"][data-smart-node-action="continue-editing"]`);
            assert(button.textContent.trim()===(lang==='en'?'Continue editing':'继续编辑'), 'Dynamic toolbar language switch');
            const sections = smartContextMenuSections({nodeId:source.id,mediaIndex:0});
            assert(sections.flat().some(item=>item.action==='continue-editing' && item.label===(lang==='en'?'Continue editing':'继续编辑')), 'Context menu language switch');
        }
        assert(promptInput.contentEditable==='true', 'Original composer stays editable');
        passed.push('PASS: Chinese/English toolbar and context menu, original composer editing');
        const savedSubmit = submitGenerationProvider;
        const submissions=[];
        submitGenerationProvider = async request => {
            submissions.push(request);
            return generationProviderCompleted(['/static/images/test/fixture.svg'], 'image');
        };
        try {
            const submitDraft=window.SmartCanvasModules.generationOutput.continueEditing({source});
            updateComposer();
            assert(submissions.length===0, 'Continue editing never calls provider');
            const beforeSubmit=nodes.length;
            await window.SmartCanvasModules.generationRun.run({nodeId:submitDraft.id});
            assert(submissions.length===1, 'Explicit submission calls provider once');
            const completed = nodes.find(node=>node.id===submitDraft.id);
            assert(nodes.length===beforeSubmit && completed?.images.length===1, `Submission reuses draft without intermediate node: ${JSON.stringify({beforeSubmit,after:nodes.length,completed})}`);
            assert(submissions[0].prompt===source.generationInputSnapshot.prompt && submissions[0].refs.length===2, 'Provider receives original recipe');
            assert(JSON.stringify(source.generationInputSnapshot)===originalSnapshot, 'Submission preserves original run');
            passed.push('PASS: explicit submission only, draft reused as output, original run preserved');
        } finally { submitGenerationProvider=savedSubmit; }
        const parent = {id:'continue-parent',type:'smart-image',generationOutputNode:true,x:-300,y:120,images:[
            {url:'/static/images/test/fixture.svg#first-output',kind:'image',outputId:'parent-out-1'},
            {url:'/static/images/test/fixture.svg',kind:'image',outputId:'parent-out-2'}
        ]};
        const textParent = {id:'continue-text-parent',type:'smart-prompt',x:-300,y:420,text:'Upstream instruction'};
        nodes.push(parent,textParent);
        const connectedSource=nodes.find(node=>node.id===source.id);
        canvas.connections.push(
            {from:parent.id,to:source.id,kind:'input',sourceOutputId:'parent-out-2',sourceImageIndex:1},
            {from:textParent.id,to:source.id,kind:'input'}
        );
        const connectedRefs=activeInputImagesFor(connectedSource);
        assert(connectedRefs.length===1, `Fixture selects one parent output: ${JSON.stringify({connectedRefs,parent,connections:canvas.connections.filter(c=>c.to===source.id)})}`);
        connectedSource.generationInputSnapshot={prompt:'Upstream instruction\n\nOriginal prompt',
            refs:[...connectedRefs,{...refs[0],inputInstanceId:'independent-manual'}],settings:originalSettings};
        const originalConnections=JSON.stringify(canvas.connections);
        const connectedDraft=window.SmartCanvasModules.generationOutput.continueEditing({source:connectedSource});
        updateComposer();
        const inherited=canvas.connections.filter(c=>c.to===connectedDraft.id);
        assert(inherited.length===2, 'Draft preserves all parent connections');
        assert(inherited.find(c=>c.from===parent.id)?.sourceOutputId==='parent-out-2', 'Preserves selected parent output');
        assert(connectedDraft.manualInputRefs.length===1, 'Connected input is not also copied as manual media');
        const connectedRequest=window.SmartCanvasModules.promptAuthoring.resolve({node:connectedDraft});
        assert(connectedRequest.refs.length===2, 'One connected reference and one deliberate duplicate');
        assert(connectedRequest.prompt==='Upstream instruction\n\nOriginal prompt', 'Connected text is included exactly once');
        const savedGraph=JSON.parse(JSON.stringify(canvas));
        assert(savedGraph.connections.filter(c=>c.to===connectedDraft.id).length===2, 'Connections survive serialization');
        assert(JSON.stringify(canvas.connections.filter(c=>c.to!==connectedDraft.id))===originalConnections, 'Original parent relationships unchanged');
        window.SmartCanvasModules.canvasMutation.disconnect({nodeIds:[connectedDraft.id],mode:'input'});
        const disconnectedRequest=window.SmartCanvasModules.promptAuthoring.resolve({node:connectedDraft});
        assert(disconnectedRequest.refs.length===1 && disconnectedRequest.prompt==='Original prompt', 'Disconnecting draft removes only its connected inputs');
        assert(canvas.connections.filter(c=>c.to===source.id).length===2, 'Disconnecting draft preserves original parents');
        passed.push('PASS: inherited parents, selected output, independent manual duplicate, upstream text once, saved connections, independent disconnect');
        nodes=nodes.filter(node=>node.id===source.id); canvas.nodes=nodes;
        canvas.connections=[];
        viewport.x=100; viewport.y=80;
        window.SmartCanvasModules.viewportSelection.viewport.apply();
        selectedId=source.id; selectedIds=[]; render(); updateComposer();
        applyTheme(new URLSearchParams(location.search).get('theme')==='dark'?'dark':'light');
        report.textContent=passed.join('\n');
    } catch(error) {
        report.textContent=[...passed,`FAIL: ${error.stack || error}`].join('\n');
    }
})();
