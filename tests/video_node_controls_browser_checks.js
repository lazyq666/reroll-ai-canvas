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
        w:index===2?200:400,h:index===1?540:260,
        images:[{url:'/static/images/test/fixture.mp4',kind:'video',name:`${id}.mp4`,natural_w:640,natural_h:360}],
    })));
    canvas = {id:'video-controls-fixture',nodes,connections:[],logs:[]};
    selectedId='';selectedIds=[];selectedImage={nodeId:'',index:-1};
    viewport.x=0;viewport.y=0;viewport.scale=1;
    window.SmartCanvasModules.viewportSelection.viewport.apply();
    configureSmartCanvasVirtualization();canvasLevelOfDetail.update(1);smartCanvasDetailRecoveryReady=null;
    render();
    const panel=document.createElement('div');
    panel.style.cssText='position:fixed;top:12px;right:12px;z-index:99999;background:#fff;color:#111;padding:12px;font:13px system-ui;max-width:420px';
    panel.innerHTML='<button id="run-player-checks">Run player checks</button> <button id="player-language">中文 / English</button> <button id="player-theme">Light / Dark</button><pre id="player-report" style="white-space:pre-wrap;max-height:230px;overflow:auto">Ready</pre>';
    document.body.append(panel);
    panel.querySelector('#player-language').onclick=()=>window.StudioI18n.toggle();
    panel.querySelector('#player-theme').onclick=()=>applyTheme(document.body.classList.contains('theme-dark')?'light':'dark');
    panel.querySelector('#run-player-checks').onclick=async()=>{
        const report=panel.querySelector('#player-report');const passed=[];
        const check=(ok,message)=>{assert(ok,message);passed.push(message);report.textContent=passed.join('\n');};
        try{
            const media=smartPlaybackActivateVideo('landscape',0,{play:false});
            await until(()=>media.readyState>=2);
            const control=media.parentElement.querySelector('ic-media-player-controls');
            await until(()=>control?.dataset.icContractStatus==='ready');
            check(control.media===media&&!media.controls,'PASS: node binds the existing native engine');
            control.shadowRoot.querySelector('[data-play]').click();await until(()=>!media.paused);
            check(!media.paused,'PASS: play button starts video');
            control.shadowRoot.querySelector('[data-play]').click();
            check(media.paused,'PASS: pause button stops video');
            const pill=control.shadowRoot.querySelector('.pill');
            const durationDescriptor=Object.getOwnPropertyDescriptor(media,'duration');
            const timeDescriptor=Object.getOwnPropertyDescriptor(media,'currentTime');
            try{
                for(const duration of [65,605,3665]){
                    Object.defineProperty(media,'duration',{configurable:true,value:duration});
                    const widths=[];
                    for(const time of [0,1,8,9,10,59,60,599,600,3599,3600].filter(time=>time<=duration)){
                        Object.defineProperty(media,'currentTime',{configurable:true,value:time});
                        media.dispatchEvent(new Event('timeupdate'));
                        widths.push(pill.getBoundingClientRect().width);
                    }
                    assert(Math.max(...widths)-Math.min(...widths)<0.1,`Pill shifts across timestamp rollover: ${duration} ${widths}`);
                }
            }finally{
                if(durationDescriptor)Object.defineProperty(media,'duration',durationDescriptor);else delete media.duration;
                if(timeDescriptor)Object.defineProperty(media,'currentTime',timeDescriptor);else delete media.currentTime;
                media.dispatchEvent(new Event('timeupdate'));
            }
            check(true,'PASS: time pill width stays fixed across digits, minutes and hours');
            const mute=control.shadowRoot.querySelector('[data-mute]');const beforeMute=media.muted;
            mute.click();check(media.muted!==beforeMute,'PASS: mute toggles');
            media.volume=0;media.muted=false;mute.click();
            check(media.volume>0&&!media.muted,'PASS: unmute recovers zero volume');
            const seek=control.shadowRoot.querySelector('[data-seek]');
            seek.value=Math.min(1,media.duration/2);seek.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
            await until(()=>!media.seeking);
            check(Math.abs(media.currentTime-seek.value)<0.1,'PASS: seek changes media time');
            const before=nodes.find(n=>n.id==='landscape');const position={x:before.x,y:before.y};
            seek.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,composed:true,button:0,detail:2}));
            check(!imageStudio.isOpen()&&!canvasInteraction.active()&&before.x===position.x&&before.y===position.y,'PASS: controls do not drag or expand the node');
            window.StudioI18n.set('en');await wait(100);
            let currentControl=document.querySelector('.image-node[data-id="landscape"] ic-media-player-controls');
            check(currentControl.shadowRoot.querySelector('[data-seek]').label==='Playback position','PASS: English dynamic labels');
            window.StudioI18n.set('zh');await wait(100);
            currentControl=document.querySelector('.image-node[data-id="landscape"] ic-media-player-controls');
            check(currentControl.shadowRoot.querySelector('[data-seek]').label==='播放进度','PASS: Chinese dynamic labels');
            const original=currentControl.media;await until(()=>original.readyState>=2);await wait(100);original.volume=0.4;original.playbackRate=1.25;await wait(100);
            const events=[];['emptied','loadstart'].forEach(type=>original.addEventListener(type,()=>events.push(type)));
            currentControl.shadowRoot.querySelector('[data-expand]').click();
            await until(()=>imageStudio.isOpen()&&!original.paused);await wait(100);
            check(document.getElementById('previewCurrentVideo')===original&&!original.controls&&events.length===0,'PASS: full screen retains the same engine without reloading '+JSON.stringify({same:document.getElementById('previewCurrentVideo')===original,controls:original.controls,events}));
            const expanded=document.querySelector('.preview-frame ic-media-player-controls[expanded]');
            check(expanded===currentControl&&expanded.media===original,'PASS: full screen reuses the same custom controls');
            const loop=expanded.shadowRoot.querySelector('[data-loop]');
            const loopBefore=original.loop;loop.click();await wait(50);
            check(original.loop!==loopBefore&&loop.hasAttribute('pressed')===original.loop,'PASS: full screen loop icon controls the shared loop state');
            const pausedBefore=original.paused;
            expanded.shadowRoot.querySelector('[data-play]').click();
            check(original.paused!==pausedBefore,'PASS: full screen play/pause works');
            const fullscreenSeek=expanded.shadowRoot.querySelector('[data-seek]');
            fullscreenSeek.value=1;fullscreenSeek.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
            await until(()=>!original.seeking);
            check(Math.abs(original.currentTime-1)<0.1,'PASS: full screen custom seek works');
            window.StudioI18n.set('en');await wait(100);
            check(expanded.shadowRoot.querySelector('[data-expand]').label==='Exit fullscreen'&&expanded.shadowRoot.querySelector('[data-loop]').label===(original.loop?'Turn loop off':'Turn loop on'),'PASS: full screen English loop and collapse labels');
            window.StudioI18n.set('zh');await wait(100);
            check(expanded.shadowRoot.querySelector('[data-expand]').label==='退出全屏','PASS: full screen Chinese collapse label');
            expanded.shadowRoot.querySelector('[data-expand]').click();await until(()=>!imageStudio.isOpen());await wait(400);
            const returned=document.querySelector('.image-node[data-id="landscape"] video');
            check(returned===original&&original.paused&&!original.controls&&original.volume===0.4&&original.playbackRate===1.25,'PASS: return pauses same engine and restores custom controls '+JSON.stringify({same:returned===original,paused:original.paused,controls:original.controls,volume:original.volume,rate:original.playbackRate}));
            const inlineControl=returned.parentElement.querySelector('ic-media-player-controls');
            check(inlineControl===currentControl&&!inlineControl.hasAttribute('expanded')&&original.loop!==loopBefore,'PASS: collapse returns the same controls and loop state');
            inlineControl.shadowRoot.querySelector('[data-loop]').click();await wait(50);
            check(original.loop===loopBefore,'PASS: inline loop icon uses the same coordinator');
            smartPlaybackActivateVideo('landscape',0,{play:true});await until(()=>!original.paused);
            const second=smartPlaybackActivateVideo('portrait',0,{play:false});await until(()=>second.readyState>=2);
            smartPlaybackActivateVideo('portrait',0,{play:true});await until(()=>!second.paused);
            check(original.paused,'PASS: only one canvas video plays');
            smartPlaybackPauseForInterruption('test');
            check(second.paused,'PASS: interruption pauses playback');
            const savedSource=second.src;
            second.dispatchEvent(new Event('error'));await wait(150);
            check(Boolean(document.querySelector('.image-node[data-id="portrait"] .smart-video-play')),'PASS: error restores retry cover');
            const retried=smartPlaybackActivateVideo('portrait',0,{play:false});await until(()=>retried.readyState>=2);
            check(retried.src===savedSource&&!retried.controls,'PASS: retry restores custom player');
            report.textContent=passed.join('\n')+'\nALL CHECKS PASSED';
        }catch(error){report.textContent=passed.join('\n')+'\nFAIL: '+error.stack;}
    };
})();
