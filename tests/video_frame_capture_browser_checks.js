/* Disposable real-page acceptance, loaded only by video_node_controls_manual_server.py. */
(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = async check => {
        for(let i=0;i<160;i++){ if(check()) return; await wait(50); }
        throw new Error('Timed out waiting for player state');
    };
    const assert = (condition, message) => { if(!condition) throw new Error(message); };
    await until(() => document.documentElement.dataset.nodesStatus === 'ready');
    nodes.splice(0, nodes.length, ...['landscape','portrait','small'].map((id,index) => ({
        id, type:'smart-image',outputKind:'video',x:150+index*480,y:170,
        w:index===2?200:480,h:index===1?540:270,
        images:[{url:'/static/images/test/fixture.mp4',kind:'video',name:`${id}.mp4`,natural_w:640,natural_h:360,fps:24}],
    })));
    canvas = {id:'video-controls-fixture',nodes,connections:[],logs:[]};
    selectedId='';selectedIds=[];selectedImage={nodeId:'',index:-1};
    viewport.x=0;viewport.y=0;viewport.scale=1;
    window.SmartCanvasModules.viewportSelection.viewport.apply();
    configureSmartCanvasVirtualization();canvasLevelOfDetail.update(1);smartCanvasDetailRecoveryReady=null;
    render();
    selectedId='landscape';selectedImage={nodeId:'landscape',index:0};render();
    const panel=document.createElement('div');
    panel.style.cssText='position:fixed;top:12px;right:12px;z-index:99999;background:#fff;color:#111;padding:12px;font:13px system-ui';
    panel.innerHTML='<button id="capture-language">中文 / English</button> <button id="capture-theme">Light / Dark</button><button id="capture-regression">Run capture regression</button><button id="capture-drag-regression">Run drag regression</button><button id="capture-fullscreen-regression">Run fullscreen regression</button><pre id="capture-report">Ready</pre>';
    document.body.append(panel);
    panel.querySelector('#capture-language').onclick=()=>window.StudioI18n.toggle();
    panel.querySelector('#capture-theme').onclick=()=>applyTheme(document.body.classList.contains('theme-dark')?'light':'dark');
    panel.querySelector('#capture-drag-regression').onclick=async()=>{
        const report=panel.querySelector('#capture-report');
        try {
            smartFrameCapture?.close(true);
            selectedId='landscape';selectedIds=[];selectedImage={nodeId:'landscape',index:0};render();
            await openSmartFrameCapture('landscape',0,'custom');
            const session=smartFrameCapture; await session.initialization;
            const slider=session.panel.querySelector('input');
            const observed=new Promise(resolve=>session.video.addEventListener('seeking',()=>resolve({disabled:slider.disabled,readyState:session.video.readyState,value:slider.value}),{once:true}));
            slider.value='24';slider.dispatchEvent(new Event('input'));
            const state=await observed;
            assert(!state.disabled,'Slider disabled during drag seek: '+JSON.stringify(state));
            for(const frame of [40,15,65]){
                slider.value=String(frame);slider.dispatchEvent(new Event('input'));
            }
            assert(slider.value==='65','Handle must immediately follow the latest pointer position');
            assert(session.panel.querySelector('[data-counter]').textContent.includes('65'),'Counter must follow the handle');
            await until(()=>!session.video.seeking&&Math.abs(session.video.currentTime-64.5/24)<.002);
            assert(slider.value==='65','An older seek callback must not pull the handle backwards');
            report.textContent='PASS timeline remains draggable during decoding\nPASS latest drag position wins without snapping back';report.dataset.result='passed';
        }catch(error){report.textContent='FAIL '+error.message;report.dataset.result='failed';}
    };
    panel.querySelector('#capture-fullscreen-regression').onclick=async()=>{
        const report=panel.querySelector('#capture-report'); const checks=[];
        report.textContent='';delete report.dataset.result;
        const check=(ok,message)=>{assert(ok,message);checks.push('PASS '+message);report.textContent=checks.join('\n');};
        const realUpload=uploadFiles, realtimeMode=canvasMutationRealtimeMode;
        canvasMutationRealtimeMode=()=>false;
        uploadFiles=async files=>files.map(()=>({url:'/static/images/test/fixture.svg'}));
        try {
            smartFrameCapture?.close(true);
            const before=nodes.length;
            openSmartVideoFullscreen('landscape',0);
            await until(()=>currentPreviewVideo()?.readyState>=2);
            const video=currentPreviewVideo();
            const menu=document.getElementById('previewFrameCaptureMenu');
            document.getElementById('previewFrameCaptureTrigger').click();
            await until(()=>menu.hasAttribute('open'));
            check([...menu.querySelectorAll('ic-menu-item')].map(el=>el.getAttribute('value')).join(',')==='first,last,custom','fullscreen entry offers first, last and custom');
            menu.querySelector('[value="custom"]').shadowRoot.querySelector('button').click();
            await until(()=>smartFrameCapture?.fullscreen);
            const session=smartFrameCapture;await session.initialization;
            const section=session.panel, slider=section.querySelector('input');
            check(session.video===video&&section.parentElement===imageEditModal&&section.slot==='footer','same video with capture panel inside fullscreen footer');
            check(getComputedStyle(document.getElementById('imageEditWorkbench')).display==='none','preview dock replaced while selecting frames');
            for(const frame of [12,55]){
                slider.value=String(frame);slider.dispatchEvent(new Event('input'));
                await until(()=>!video.seeking&&Math.abs(video.currentTime-(frame-.5)/24)<.002);
                section.querySelector('[data-capture]:not([hidden]),[data-add-capture]:not([hidden])').click();
                await until(()=>section.querySelectorAll('[data-frame]').length===(frame===12?1:2));
            }
            check(nodes.length===before,'fullscreen drafts stay local until confirm');
            slider.focus();slider.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,composed:true}));
            await wait(80);
            check(Math.abs(video.currentTime-54.5/24)<.002,'fullscreen shortcut does not hijack timeline keys');
            window.StudioI18n.set('en');applyTheme('light');await wait(80);render();
            check(section.isConnected&&section.querySelector('[data-counter]').textContent.includes('frames')&&currentPreviewVideo()===video,'fullscreen preserves player and drafts on language/theme change');
            window.StudioI18n.set('zh');applyTheme('dark');await wait(80);
            check(section.querySelector('[data-counter]').textContent.includes('帧'),'fullscreen Chinese frame counter');
            section.querySelector('[data-confirm]').click();
            await until(()=>nodes.length===before+2&&!smartFrameCapture);
            check(imageStudio.isOpen()&&currentPreviewVideo()===video&&!imageEditModal.classList.contains('frame-capture-open'),'confirm returns to fullscreen preview');
            canvasMutation.history({action:'undo'});
            check(nodes.length===before,'fullscreen batch undone together');
            await exportVideoFrame('custom');await smartFrameCapture.initialization;
            smartFrameCapture.panel.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,composed:true}));
            await wait(80);
            check(!smartFrameCapture&&imageStudio.isOpen(),'Escape cancels capture without leaving fullscreen');
            for(const mode of ['first','last']){
                await exportVideoFrame(mode);await until(()=>!smartFrameCapture);
                check(nodes.at(-1).images[0].kind==='image'&&imageStudio.isOpen(),mode+' shortcut saves to canvas and keeps fullscreen');
            }
            await exportVideoFrame('custom');await smartFrameCapture.initialization;
            openImageEditor('portrait',0,{mode:'preview'});
            check(!smartFrameCapture&&!imageEditModal.querySelector('.smart-frame-capture'),'switching source discards capture session');
            await until(()=>currentPreviewVideo()?.readyState>=2);
            let release;
            uploadFiles=()=>new Promise(resolve=>release=resolve);
            await exportVideoFrame('first');await until(()=>release);
            const closingCount=nodes.length;
            const hiding=imageEditModal.hide('close');
            check(!smartFrameCapture,'native dialog close cancels immediately, before its animation');
            release([{url:'/static/images/test/fixture.svg'}]);await hiding;await wait(100);
            check(!smartFrameCapture&&!imageEditModal.querySelector('.smart-frame-capture')&&nodes.length===closingCount,'closing fullscreen cancels pending save');
            check(video.paused&&video.loop,'closing capture restores player loop');
            report.dataset.result='passed';
        }catch(error){report.textContent+='\nFAIL '+error.stack;report.dataset.result='failed';closeImageEditor();}
        finally {uploadFiles=realUpload;canvasMutationRealtimeMode=realtimeMode;}
    };
    panel.querySelector('#capture-regression').onclick=async()=>{
        const report=panel.querySelector('#capture-report'); const checks=[];
        const check=(ok,message)=>{assert(ok,message);checks.push(message);report.textContent=checks.join('\n');};
        // The disposable server has no acknowledged mutation history. Exercise the
        // same batch through the production local Undo path, then restore the adapter.
        const realtimeMode = canvasMutationRealtimeMode;
        canvasMutationRealtimeMode = () => false;
        try {
            smartFrameCapture?.close(true);
            selectedId='landscape';selectedImage={nodeId:'landscape',index:0};render();
            const before=nodes.length;
            await openSmartFrameCapture('landscape',0,'custom');
            await until(()=>smartFrameCapture?.video.readyState>=2);
            const originalVideo=smartFrameCapture.video;
            const section=smartFrameCapture.panel;
            check(!document.getElementById('imageEditModal').classList.contains('open'),'PASS inline, no preview dialog');
            section.querySelector('input').value='12';section.querySelector('input').dispatchEvent(new Event('input'));
            await until(()=>Math.abs(originalVideo.currentTime-11.5/24)<0.002&&!originalVideo.seeking);
            section.querySelector('[data-capture]:not([hidden]),[data-add-capture]:not([hidden])').click();await until(()=>section.querySelectorAll('[data-frame]').length===1);
            check(nodes.length===before,'PASS drafts do not mutate canvas');
            section.querySelector('[data-capture]:not([hidden]),[data-add-capture]:not([hidden])').click();await wait(50);
            check(section.querySelectorAll('[data-frame]').length===1,'PASS repeated frame deduplicated');
            section.querySelector('[data-frame]').click();
            check(section.querySelector('[data-confirm]').hasAttribute('disabled'),'PASS removing final draft disables confirm');
            const count=Number(section.querySelector('input').max);
            section.querySelector('input').value=String(count);section.querySelector('input').dispatchEvent(new Event('input'));
            await until(()=>Math.abs(originalVideo.currentTime-(count-.5)/24)<0.002&&!originalVideo.seeking);
            check(section.querySelector('[data-counter]').textContent.includes(String(count)),'PASS last frame clamps within duration');
            section.querySelector('[data-capture]:not([hidden]),[data-add-capture]:not([hidden])').click();await until(()=>section.querySelectorAll('[data-frame]').length===1);
            window.StudioI18n.set('en');await wait(80);
            check(section.querySelector('[data-counter]').textContent.includes('frames')&&section.querySelector('[data-confirm]').textContent==='Confirm','PASS dynamic English');
            window.StudioI18n.set('zh');await wait(80);
            check(section.querySelector('[data-counter]').textContent.includes('帧')&&section.isConnected,'PASS dynamic Chinese');
            applyTheme('dark');render();await wait(80);window.StudioI18n.set('en');await wait(80);
            check(smartFrameCapture?.video===originalVideo&&section.isConnected&&section.querySelector('[data-counter]').textContent.includes('frames'),'PASS theme and language redraw preserve capture player');
            window.StudioI18n.set('zh');
            smartFrameCapture.close();check(nodes.length===before,'PASS cancel discards drafts');
            check(originalVideo.paused&&originalVideo.loop&&smartPlaybackEntry('landscape',0).loop,'PASS close pauses and restores loop');
            const realUpload=uploadFiles;let uploads=0;
            uploadFiles=async files=>{uploads++;if(uploads===1)throw new Error('test offline');return files.map(()=>({url:'/static/images/test/fixture.svg'}));};
            try {
                await openSmartFrameCapture('landscape',0,'first');await until(()=>smartFrameCapture?.panel.querySelector('.smart-frame-message').textContent.includes('保存失败'));
                check(nodes.length===before&&smartFrameCapture.panel.querySelectorAll('[data-frame]').length===1,'PASS upload failure keeps draft');
                smartFrameCapture.panel.querySelector('[data-confirm]').click();await until(()=>nodes.length===before+1);
                check(uploads===2&&nodes.at(-1).images[0].kind==='image','PASS retry creates image');
            } finally {uploadFiles=realUpload;}
            check(!smartFrameCapture,'PASS success closes session');
            uploadFiles=async files=>files.map(()=>({url:'/static/images/test/fixture.svg'}));
            try {
                selectedId='landscape';selectedIds=[];selectedImage={nodeId:'landscape',index:0};render();
                await openSmartFrameCapture('landscape',0,'custom');
                await until(()=>smartFrameCapture?.video.readyState>=2);
                const batchPanel=smartFrameCapture.panel;
                const media=smartFrameCapture.video;
                for(const frame of [2,24]){
                    batchPanel.querySelector('input').value=String(frame);batchPanel.querySelector('input').dispatchEvent(new Event('input'));
                    await until(()=>!media.seeking&&Math.abs(media.currentTime-(frame-.5)/24)<0.002);
                    await until(()=>!batchPanel.querySelector('[data-capture]:not([hidden]),[data-add-capture]:not([hidden])').hasAttribute('disabled'));
                    await wait(30);
                    batchPanel.querySelector('[data-capture]:not([hidden]),[data-add-capture]:not([hidden])').click();await until(()=>batchPanel.querySelectorAll('[data-frame]').length===(frame===2?1:2));
                }
                const batchBefore=nodes.length;
                batchPanel.querySelector('[data-confirm]').click();await until(()=>nodes.length===batchBefore+2);
                check(nodes.at(-1).images[0].autoName&&nodes.at(-2).images[0].autoName,'PASS batch uses canvas media naming');
                canvasMutation.history({action:'undo'});
                check(nodes.length===batchBefore,'PASS one undo removes whole capture batch');
                selectedId='landscape';selectedIds=[];selectedImage={nodeId:'landscape',index:0};render();
                let releaseUpload;
                uploadFiles=()=>new Promise(resolve=>{releaseUpload=resolve;});
                await openSmartFrameCapture('landscape',0,'last');await until(()=>releaseUpload);
                const cancelledBefore=nodes.length;
                smartFrameCapture.close(true);releaseUpload([{url:'/static/images/test/fixture.svg'}]);await wait(100);
                check(nodes.length===cancelledBefore,'PASS cancelled async save cannot create nodes');
            }finally {uploadFiles=realUpload;}
            report.dataset.result='passed';
        } catch(error) {report.textContent+='\nFAIL '+error.stack;report.dataset.result='failed';}
        finally {canvasMutationRealtimeMode = realtimeMode;}
    };
})();
