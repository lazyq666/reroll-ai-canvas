(async function(){
    await Promise.all(['ic-select','ic-textarea','ic-button'].map(name=>customElements.whenDefined(name)));
    const tr = key => window.StudioI18n.t(key);
    const byId = id => document.getElementById(id);
    const media = byId('optimizationMedia'), model = byId('optimizationModel'), preset = byId('optimizationPreset'), instructions = byId('optimizationInstructions');
    const form = byId('settingsForm'), save = byId('saveOptimizationSettings'), message = byId('settingsMessage'), reload = byId('reloadSettings');
    const repair = window.SmartCanvasModules.imageRepairPresets, suffix = byId('repairSuffix');
    const defaults = window.SmartCanvasModules.promptOptimize.defaults;
    let draft, models=[], active='smart', activeMedia='image', messageKey='smart.optimize.loadingSettings', saving=false;
    function notify(key,tone='neutral'){
        messageKey=key;message.removeAttribute('data-i18n');message.textContent=tr(key);message.setAttribute('tone',tone);message.hidden=false;
    }
    function capture(){
        if(!draft) return;
        if(activeMedia==='repair'){draft.repair[active]=instructions.value;draft.repair.suffix=suffix.value;return;}
        const profile=draft[activeMedia];
        profile.instructions[active]=instructions.value;
        if(model.value==='__unavailable__') return;
        const chosen=models.find(entry=>entry.id===model.value);
        profile.provider=chosen?.provider_id || '';profile.model=chosen?.model || '';
    }
    function render(){
        if(!draft) return;
        const isRepair=activeMedia==='repair';
        model.hidden=isRepair;suffix.hidden=!isRepair;
        const bind=(element,attribute,key)=>{element.setAttribute('data-i18n-'+attribute,key);element.setAttribute(attribute,tr(key));};
        bind(preset,'label',isRepair?'smart.repair.presets':'smart.optimize.editPreset');
        bind(instructions,'label',isRepair?'smart.repair.presetBody':'smart.optimize.instructions');
        const hint=byId('instructionsHint'), hintKey=isRepair?'smart.repair.settingsHint':'smart.optimize.instructionsHint';
        hint.setAttribute('data-i18n',hintKey);hint.textContent=tr(hintKey);
        if(isRepair){
            preset.replaceChildren(...repair.keys.map(key=>new Option(tr('smart.repair.preset.'+key),key)));
            preset.syncOptions();preset.value=active;instructions.value=draft.repair[active];suffix.value=draft.repair.suffix;return;
        }
        const profile=draft[activeMedia];
        model.replaceChildren(new Option(tr('smart.optimize.autoModel'),'__default__'));
        for(const entry of models) model.append(new Option(`${entry.provider_name || entry.provider_id} · ${entry.name || entry.model}`,entry.id));
        const chosen=models.find(entry=>entry.provider_id===profile.provider && entry.model===profile.model);
        if(profile.provider && !chosen){
            const missing=new Option(tr('smart.optimize.unavailableModel'),'__unavailable__');missing.disabled=true;model.append(missing);
        }
        model.syncOptions();model.value=profile.provider ? chosen?.id || '__unavailable__' : '__default__';
        preset.replaceChildren(...Object.keys(defaults[activeMedia]).map(key=>new Option(tr('smart.optimize.'+key),key)));
        preset.syncOptions();preset.value=active;
        instructions.value=profile.instructions[active];
    }
    async function load(){
        form.inert=true;reload.hidden=true;notify('smart.optimize.loadingSettings');
        try {
            const responses=await Promise.all([fetch('/api/prompt-optimization-settings'),fetch('/api/available-models')]);
            if(responses.some(response=>!response.ok)) throw new Error('Settings unavailable');
            const [configuration,catalog]=await Promise.all(responses.map(response=>response.json()));
            draft=configuration;draft.repair=repair.resolve(draft.repair);
            for(const kind of ['image','video']){
                draft[kind].default_preset=defaults[kind][draft[kind].default_preset] ? draft[kind].default_preset : 'smart';
                draft[kind].instructions=Object.fromEntries(Object.entries(defaults[kind]).map(([key,value])=>[key,draft[kind].instructions?.[key]?.trim() ? draft[kind].instructions[key] : value]));
            }
            active=activeMedia==='repair'?repair.keys[0]:draft[activeMedia].default_preset;models=catalog.models?.text || [];render();form.inert=false;message.hidden=true;
        } catch(error){notify('smart.optimize.loadFailed','danger');reload.hidden=false;}
    }
    media.addEventListener('change',()=>{
        if(!draft || (!defaults[media.value] && media.value!=='repair')) return;
        capture();activeMedia=media.value;active=activeMedia==='repair'?repair.keys[0]:draft[activeMedia].default_preset;render();
    });
    preset.addEventListener('change',()=>{
        if(activeMedia==='repair'){capture();active=preset.value;instructions.value=draft.repair[active];return;}
        if(!draft || !defaults[activeMedia][preset.value]) return;
        capture();active=preset.value;draft[activeMedia].default_preset=active;instructions.value=draft[activeMedia].instructions[active];
    });
    instructions.addEventListener('input',capture);
    suffix.addEventListener('input',capture);
    model.addEventListener('change',capture);
    byId('restoreInstructions').addEventListener('click',()=>{instructions.value=activeMedia==='repair'?repair.defaults(active):defaults[activeMedia][active];if(activeMedia==='repair')suffix.value=repair.defaults('suffix');capture();});
    save.addEventListener('click',async()=>{
        if(saving || !draft) return;
        capture();
        if(Object.values(draft.repair).some(value=>[...value].length>6000)){notify('smart.optimize.ruleTooLong','danger');return;}
        if(['image','video'].some(kind=>Object.values(draft[kind].instructions).some(value=>[...value].length>6000))){notify('smart.optimize.ruleTooLong','danger');return;}
        if(['image','video'].some(kind=>draft[kind].provider && !models.some(entry=>entry.provider_id===draft[kind].provider && entry.model===draft[kind].model))){notify('smart.optimize.unavailableModel','danger');return;}
        saving=true;save.loading=true;form.inert=true;
        try {
            const response=await fetch('/api/prompt-optimization-settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});
            if(!response.ok) throw new Error('Save failed');
            draft=await response.json();notify(activeMedia==='repair'?'smart.repair.settingsSaved':'smart.optimize.savedSettings','success');
        } catch(error){notify('smart.optimize.saveFailed','danger');}
        finally {saving=false;save.loading=false;form.inert=false;}
    });
    reload.addEventListener('click',load);
    window.addEventListener('studio-lang-change',()=>{capture();render();media.syncOptions();media.selectionChanged();if(!message.hidden) message.textContent=tr(messageKey);document.title=tr('smart.optimize.settingsTitle');});
    window.addEventListener('message',event=>{if(event.origin===location.origin && event.data?.type==='studio-lang') window.StudioI18n.set(event.data.lang);});
    await load();
})();
