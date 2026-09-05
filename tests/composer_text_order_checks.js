/* Isolated real Smart Canvas page checks; served only by composer_text_order_fixture.cjs. */
window.addEventListener('load', () => {
    const timer=setInterval(() => {
        if(typeof nodes === 'undefined' || !nodes.find(n=>n.id==='generation') || !window.SmartCanvasModules?.canvasMutation) return;
        clearInterval(timer);
        const bar=document.createElement('div');
        bar.id='fixture-controls';
        bar.style='position:fixed;top:0;left:0;z-index:9999;background:white;color:black;padding:4px;display:flex;gap:8px';
        bar.innerHTML='<button id="fixture-select">Select generation</button><button id="fixture-inspect">Inspect prompt</button><button id="fixture-tests">Run checks</button><button id="fixture-language">中文 / English</button><button id="fixture-theme">Light / Dark</button><output id="fixture-result"></output><pre id="fixture-prompt"></pre>';
        document.body.append(bar);
        const select=()=>{selectedId='generation';selectedIds=[];render();};
        const inspect=()=>{
            const value=promptAuthoring.resolve({node:nodes.find(n=>n.id==='generation')});
            document.querySelector('#fixture-prompt').textContent=JSON.stringify({prompt:value.prompt,textOrder:value.textInputs.map(x=>x.key),media:value.refs.map(x=>x.inputInstanceId)});
        };
        bar.querySelector('#fixture-select').onclick=select;
        bar.querySelector('#fixture-inspect').onclick=inspect;
        bar.querySelector('#fixture-language').onclick=()=>window.StudioI18n.set(window.StudioI18n.lang()==='en'?'zh':'en');
        bar.querySelector('#fixture-theme').onclick=()=>{document.documentElement.dataset.uiTheme=document.documentElement.dataset.uiTheme==='dark'?'light':'dark';};
        bar.querySelector('#fixture-tests').onclick=async()=>{
            let passed=0;
            const check=(ok,label)=>{if(!ok)throw Error(label);passed++;};
            const equal=(a,b,label)=>check(JSON.stringify(a)===JSON.stringify(b),`${label}: ${JSON.stringify(a)}`);
            const target=()=>nodes.find(n=>n.id==='generation');
            const resolve=()=>promptAuthoring.resolve({node:target()});
            const order=()=>Array.from(inputThumbsRow.querySelectorAll('[data-text-thumb-index]'),el=>el.dataset.referenceText);
            const settle=()=>new Promise(r=>setTimeout(r,150));
            const sync=async()=>{await settle();document.querySelector('#fixture-tests').focus();await settle();await canvasPersistence.checkpoint();await settle();};
            const drag=(from,to,after=false)=>{
                const dataTransfer=new DataTransfer();
                from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer}));
                const rect=to.getBoundingClientRect();
                const init={bubbles:true,cancelable:true,dataTransfer,clientX:rect.left+rect.width*(after?.8:.2),clientY:rect.top+rect.height/2};
                to.dispatchEvent(new DragEvent('dragover',init));
                check(to.classList.contains(after?'drop-after':'drop-before'),'Insertion marker');
                to.dispatchEvent(new DragEvent('drop',init));
                from.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer}));
            };
            try{
                select();
                canvasMutation.update({nodeId:'generation',mutate:n=>{delete n.inputRefOrder;n.promptDraftHtml='Composer';n.promptDraftText='Composer';},options:{render:true}});
                select();setPromptText('Composer');savePromptDraftForCurrent();await settle();await sync();
                equal(resolve().prompt,'Composer\n\nA\n\nB\n\nTXT','Composer first');
                check([...inputThumbsRow.querySelectorAll('[data-text-thumb-index]')].every(el=>el.draggable&&el.tabIndex===0),'All text references draggable and keyboard focusable');
                drag(inputThumbsRow.querySelector('[data-text-node-id="b"]'),inputThumbsRow.querySelector('[data-text-node-id="a"]'));
                equal(order(),['B','A','TXT'],'Connected text drag');
                equal(resolve().prompt,'Composer\n\nB\n\nA\n\nTXT','Prompt follows drag');
                await sync();
                canvasMutation.history({action:'undo'});await settle();select();
                equal(order(),['A','B','TXT'],'Undo');
                canvasMutation.history({action:'redo'});await settle();select();
                equal(order(),['B','A','TXT'],'Redo');
                drag(inputThumbsRow.querySelector('[data-local-text-instance-id="txt"]'),inputThumbsRow.querySelector('[data-text-node-id="a"]'));
                equal(order(),['B','TXT','A'],'TXT and connected text share order');
                equal(resolve().prompt,'Composer\n\nB\n\nTXT\n\nA','Mixed text prompt');
                const b=inputThumbsRow.querySelector('[data-text-node-id="b"]');
                b.focus();b.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true,cancelable:true}));
                equal(order(),['TXT','B','A'],'Keyboard reorder');
                check(document.activeElement.dataset.textNodeId==='b','Focus follows moved reference');
                drag(inputThumbsRow.querySelector('[data-thumb-index="1"]'),inputThumbsRow.querySelector('[data-thumb-index="0"]'));
                equal(resolve().refs.map(r=>r.inputInstanceId),['image-2','image-1'],'Image drag remains effective');
                equal(order(),['TXT','B','A'],'Image drag preserves text order');
                setPromptText('');savePromptDraftForCurrent();
                equal(resolve().prompt,'TXT\n\nB\n\nA','Blank Composer');
                setPromptText('Composer');savePromptDraftForCurrent();
                selectedId='a';selectedIds=[];render();select();
                equal(resolve().prompt,'Composer\n\nTXT\n\nB\n\nA','Switch away and back');
                const savedOrder=JSON.stringify(target().inputRefOrder);
                for(const lang of ['zh','en']){
                    window.StudioI18n.set(lang);await settle();
                    equal(JSON.stringify(target().inputRefOrder),savedOrder,`${lang} preserves order`);
                    check(inputThumbsRow.querySelector('[data-text-thumb-index]').title.includes(lang==='zh'?'拖动':'Drag'),`${lang} sort hint`);
                }
                const beforeCancel=JSON.stringify(target().inputRefOrder);
                const cancelThumb=inputThumbsRow.querySelector('[data-text-node-id="a"]');
                const canceled=new DataTransfer();
                cancelThumb.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:canceled}));
                cancelThumb.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:canceled}));
                equal(JSON.stringify(target().inputRefOrder),beforeCancel,'Canceled drag preserves order');
                check(!inputThumbsRow.querySelector('.dragging,.drop-before,.drop-after'),'Canceled drag clears markers');
                promptInput.innerHTML='Composer '+mentionTokenHtml(resolve().refs[0]);savePromptDraftForCurrent();
                renderInputThumbsRow(target());
                const mentionedId=resolve().refs[0].inputInstanceId;
                drag(inputThumbsRow.querySelector('[data-thumb-index="0"]'),inputThumbsRow.querySelector('[data-thumb-index="1"]'),true);
                check(resolve().refs[1].inputInstanceId===mentionedId,'Mention identity preserved after image drag');
                check(resolve().prompt.includes(trf('canvas.imageNumber',{number:2})),'Model prompt uses new image number');
                check(promptInput.querySelector('.mention-token-label').textContent.endsWith('2'),'Visible mention is renumbered');
                check(resolve().prompt.indexOf('Composer')<resolve().prompt.indexOf('TXT'),'Composer stays first with mention map');
                setPromptText('Composer');savePromptDraftForCurrent();
                inputThumbsRow.querySelector('[data-local-text-instance-id="txt"]').click();
                check(!referenceViewerBackdrop.hidden&&referenceViewerContent.textContent==='TXT','TXT preview');
                closeReferenceViewer();
                // Copy the graph: order keys must follow the new Prompt Node identities.
                const copied=canvasMutation.duplicate({nodeIds:['a','b','generation'],reveal:false,select:false}).nodes;
                const copiedTarget=copied.find(n=>n.type==='smart-image');
                check(copiedTarget.inputRefOrder.includes(`text|${copied.find(n=>n.text==='b'||n.text==='B').id}`),'Duplicate remaps text order');
                select();
                check(!copiedTarget.inputRefOrder.includes('text|b'),'Duplicate does not retain original text key');
                await sync();
                // Removal uses the public thumbnail event, and undo restores the TXT item.
                inputThumbsRow.querySelector('[data-local-text-instance-id="txt"] .input-thumb-remove').click();
                check(!target().localTextRefs?.length && !resolve().prompt.includes('TXT'),'TXT removal updates prompt');
                await sync();
                canvasMutation.history({action:'undo'});await settle();select();
                check(resolve().prompt.includes('TXT'),'Undo restores TXT');
                await sync();
                const saved=await fetch('/fixture/state').then(r=>r.json());
                equal(saved.canvas.nodes.find(n=>n.id==='generation').inputRefOrder,target().inputRefOrder,'Order persisted through Canvas mutation');
                check(saved.mutations.length>0,'Uses Canvas mutation');
                equal(nodes.filter(n=>['a','b'].includes(n.id)).map(n=>n.text),['A','B'],'Source text unchanged');
                inspect();
                const expectedPrompt=resolve().prompt;
                await runGeneration();
                const submitted=await fetch('/fixture/state').then(r=>r.json());
                equal(submitted.submissions.at(-1)?.prompt,expectedPrompt,'Actual generation request follows visible text order');
                document.querySelector('#fixture-result').textContent=`PASS ${passed} checks`;
            }catch(error){document.querySelector('#fixture-result').textContent=`FAIL after ${passed}: ${error.message}`;console.error(error);}
        };
        select();inspect();
    },50);
});
