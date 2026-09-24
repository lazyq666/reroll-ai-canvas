/* Real-page integration checks, launched by the isolated fixture's visible button. */
window.runImageRepairChecks = async function(){
    const report=document.getElementById('fixture-result');
    report.textContent='Running…';
    const $=id=>document.getElementById(`imageRepair${id}`);
    const assert=(condition,message)=>{if(!condition)throw new Error(message);};
    const until=async(check,message)=>{
        const deadline=Date.now()+15000;
        while(Date.now()<deadline){if(await check())return;await new Promise(r=>setTimeout(r,40));}
        throw new Error(message);
    };
    const edit=(id,value,event='change')=>{$(id).value=String(value);$(id).dispatchEvent(new Event(event,{bubbles:true}));};
    const state=()=>fetch('/fixture/state').then(r=>r.json());
    const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const editor=window.SmartCanvasModules.imageStudio;
    const open=async nodeId=>{
        editor.open({nodeId,mode:'local-repair'});
        await until(()=>$('Status').textContent!==tr('smart.repair.loading'),'editor load');
        await settle();
    };
    try {
        window.StudioI18n.set('zh');
        await open('layer-source');
        assert($('Model').value==='flagship','flagship model preference');
        $('Clear').click();$('Rectangle').click();
        const canvas=$('Canvas'),rect=canvas.getBoundingClientRect();
        const pointer=(type,x,y)=>canvas.dispatchEvent(new PointerEvent(type,{pointerId:1,button:0,bubbles:true,clientX:rect.x+x*rect.width,clientY:rect.y+y*rect.height}));
        // Synthetic events cannot capture a native pointer; the fixture brackets that DOM API only.
        const capture=canvas.setPointerCapture;canvas.setPointerCapture=()=>{};
        pointer('pointerdown',.38,.50);pointer('pointermove',.52,.67);pointer('pointerup',.52,.67);
        canvas.setPointerCapture=capture;
        assert(!$('CropPreview').hidden,'crop preview');
        const size=$('CropSize').textContent;
        assert(size.includes('1:1'),'standard ratio');
        assert($('Resolution').value==='1K','nearest tier');
        edit('Prompt','Remove the dark mark','input');
        await settle();
        $('Undo').click();assert($('Generate').disabled,'undo clears selection');
        canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,shiftKey:true,bubbles:true}));
        assert(!$('Generate').disabled,'redo restores selection');
        editor.close();await open('layer-source');
        assert($('CropSize').textContent===size,'selection draft survives reopen');
        assert($('Prompt').value==='Remove the dark mark','prompt draft survives reopen');
        const before=(await state()).submissions.length;
        $('Generate').click();
        await until(()=>$('Adjustment').hidden===false,'generated result enters adjustment');
        await until(()=>$('Status').textContent===tr('smart.repair.adjustHint'),'patch loaded');
        const accepted=await state(),request=accepted.submissions.at(-1);
        assert(accepted.submissions.length===before+1,'one submission');
        assert(request.model==='gpt-image-2.5-suburst','preferred model submitted');
        assert(request.reference_images.length===1&&request.local_repair.source.url==='/assets/source.png','only cropped input submitted');
        const result=nodes.findLast(n=>n.images?.some(i=>i.local_repair));
        assert(result&&result.id!=='layer-source','original kept with separate output');
        const initialX=Number($('X').value);
        canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
        assert(Number($('X').value)===initialX+1,'keyboard adjusts patch without navigating images');
        edit('X',120);edit('Scale',120,'input');edit('Feather',7,'input');
        $('Feather').dispatchEvent(new Event('change',{bubbles:true}));
        const x=Number($('X').value);
        editor.close();await open(result.id);
        assert(Number($('X').value)===x&&Number($('Feather').value)===7,'adjustment draft survives reopen');
        window.StudioI18n.set('en');
        assert($('Heading').textContent===tr('smart.repair.adjust'),'dynamic English heading');
        assert($('X').getAttribute('label')===tr('smart.repair.x'),'English field labels');
        $('Save').click();
        await until(()=>$('Status').textContent===tr('smart.repair.saved'),'save composition');
        const saved=await state(),media=saved.canvas.nodes.find(n=>n.id===result.id).images[0];
        assert(media.url==='/assets/adjusted.png'&&media.local_repair.feather===7,'persist flattened output and recipe');
        assert(media.local_repair.transform.x===x,'persist original-pixel transform');
        assert(saved.submissions.length===before+1,'adjustment does not regenerate');
        $('Psd').click();await until(async()=>(await state()).psdExports.length>0,'PSD request');
        await until(()=>!$('Psd').disabled,'PSD complete');
        editor.close();await open(result.id);
        assert(Number($('X').value)===x&&$('Save').disabled,'saved recipe reopens cleanly');
        window.StudioI18n.set('zh');
        assert($('Heading').textContent===tr('smart.repair.adjust'),'Chinese restored');
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        assert($('Canvas').getContext('2d').getImageData(400,200,1,1).data[0]!==228,'language switch retains rendered original');
        editor.close();
        await window.SmartCanvasModules.generationRun.regenerate({nodeId:result.id});
        const regenerated=(await state()).submissions.at(-1);
        assert(regenerated.local_repair.source.url==='/assets/source.png','regeneration preserves repair composition');
        await open(result.id);
        report.textContent='PASS: selection, model, generation, transform, draft, save, i18n, PSD';
    } catch(error){report.textContent='FAIL: '+error.message;console.error(error);}
};

window.addEventListener('load',()=>{
    const timer=setInterval(()=>{
        const bar=document.getElementById('fixture-controls');if(!bar)return;clearInterval(timer);
        const button=document.createElement('button');button.textContent='Open saved repair';bar.append(button);
        button.onclick=()=>{const result=nodes.findLast(n=>n.images?.some(i=>i.local_repair));if(result)window.SmartCanvasModules.imageStudio.open({nodeId:result.id,mode:'local-repair'});};
    },50);
});
