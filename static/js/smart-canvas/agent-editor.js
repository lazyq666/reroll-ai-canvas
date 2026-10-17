/* Private editor context and leased Agent execution via the existing run owner. */
(() => {
    const active = new Map(), requested = new Set(), confirmations = new Map();
    let lastSent=0, focused=false, queued=[];
    const send = message => window.SmartCanvasModules?.canvasPersistence?.sendPresence(message);
    const tr = key => window.StudioI18n?.t?.(key) || key;
    function reportContext() {
        if(Date.now()-lastSent<500 || !window.SmartCanvasModules?.canvasPersistence?.online()) return;
        lastSent=Date.now();
        const selection=window.SmartCanvasModules.viewportSelection;
        const ids=selection.selection.ids();
        send({type:'editor_context',focused:focused && !document.hidden,viewport:selection.viewport.bounds(),selection:ids.map(id=>({node_id:id,indices:selectedImage?.nodeId===id && selectedImage.index>=0?[selectedImage.index]:null}))});
        focused=false;
        for(const id of active.keys()) send({type:'agent_run_renew',id});
    }
    function focus() { focused=!document.hidden; reportContext(); }
    window.addEventListener('focus',focus);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden && document.hasFocus()) focus();});
    document.addEventListener('pointerdown',focus,{passive:true});
    document.addEventListener('keydown',focus,{passive:true});
    setInterval(reportContext,15000);
    setTimeout(()=>{focused=document.hasFocus(); reportContext();},1500);
    async function confirm(request) {
        if(confirmations.size) return;
        const dialog=document.createElement('ic-confirmation-dialog');
        const translate=()=>{dialog.label=tr('agent.confirmRun');dialog.description=tr('agent.confirmRunBody');dialog.textContent=tr('agent.confirmRunBody');dialog.confirmLabel=tr('agent.run');dialog.cancelLabel=tr('common.cancel');};
        translate(); window.addEventListener('studio-lang-change',translate);
        const close=async()=>{await dialog.hide();dialog.remove();window.removeEventListener('studio-lang-change',translate);confirmations.delete(request.id);};
        const finish=async accept=>{send({type:'agent_run_confirm',id:request.id,accept});await close();};
        confirmations.set(request.id,close);
        dialog.addEventListener('ic-confirm',()=>finish(true),{once:true});dialog.addEventListener('ic-cancel',()=>finish(false),{once:true});
        document.body.appendChild(dialog);await dialog.show();
    }
    async function execute(message) {
        requested.delete(message.id);
        if(!message.claimed || active.has(message.id)) return;
        active.set(message.id,true);
        let accepted=false;
        try {
            // Synchronize the accepted Mutation before normal generation preflight.
            await window.SmartCanvasModules.canvasPersistence.synced({forGeneration:true});
            await window.SmartCanvasModules.generationRun.run({nodeId:message.node_id,fromDraft:true,onAccepted:()=>{accepted=true;},onLocalAccepted:()=>{accepted=true;}});
        } finally {
            send({type:'agent_run_report',id:message.id,submitted:accepted});
            active.delete(message.id); reportContext();
        }
    }
    function receive(message) {
        if(message.type==='agent_submission_notice') {
            toast(window.StudioI18n.format('agent.added',{count:message.count}),{duration:8000,actionLabel:tr('agent.view'),onAction:()=>{
                const frame=nodes.find(n=>n.id===message.frame_id);
                if(frame) window.SmartCanvasModules.viewportSelection.viewport.centerOn({x:frame.x+frame.w/2,y:frame.y+frame.h/2});
            }});
        } else if(message.type==='agent_run_requests') {
            const previous=JSON.stringify(queued);
            queued=message.requests.filter(r=>['queued','awaiting_confirmation'].includes(r.state));
            for(const [id,close] of confirmations) if(!queued.some(r=>r.id===id && r.state==='awaiting_confirmation')) void close();
            if(previous!==JSON.stringify(queued)) render();
            for(const request of queued) {
                if(request.state==='awaiting_confirmation') {void confirm(request);continue;}
                if(!active.has(request.id) && !requested.has(request.id)) {requested.add(request.id);send({type:'agent_run_claim',id:request.id});}
            }
        } else if(message.type==='agent_run_claim') {
            // A claim acknowledgement precedes the next context heartbeat. Stop
            // advertising a cancellable waiting request as soon as it is claimed.
            if(message.state && !['queued','awaiting_confirmation'].includes(message.state)) {
                const previous=queued.length;
                queued=queued.filter(r=>r.id!==message.id);
                if(previous!==queued.length) render();
            }
            void execute(message).catch(()=>toast(tr('agent.runFailed')));
        }
    }
    window.SmartCanvasModules.agentEditor=Object.freeze({receive,reportContext,
        reconnect(){requested.clear();lastSent=0;setTimeout(reportContext,0);},
        waiting(nodeId){return queued.some(r=>r.node_id===nodeId);},
        cancel(nodeId){for(const r of queued.filter(r=>r.node_id===nodeId)) send({type:'agent_run_cancel',id:r.id});}
    });
})();
