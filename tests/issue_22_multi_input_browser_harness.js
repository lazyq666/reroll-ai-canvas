/* Visible test controls for production Smart Canvas; never loaded by a product page. */
(function(){
    const media = {url:'/test-image.svg',kind:'image',natural_w:240,natural_h:160};
    const image = (id,x,y) => ({id,type:'smart-image',title:id,x,y,w:240,h:160,scale:1,images:[{...media}]});
    const fixture = () => ({canvas:{id:'issue22',title:'Issue 22',nodes:[
        image('A',100,160),image('B',430,168),image('C',100,460),image('D',430,468),
        {id:'P',type:'smart-prompt',x:100,y:160,w:316,h:180,text:'A mountain at sunrise',title:'Prompt'},
        {id:'T',type:'smart-image',x:950,y:300,scale:1,images:[],referenceGenerationKind:'image',title:'Target'}
    ],connections:[],settings:{},logs:[]},config:{apiProviders:[],availableModels:{image:[],video:[],text:[]}}});
    window.SmartCanvasModules.nodeReviewFixture = {create:fixture};
    const panel = document.createElement('section');
    panel.style.cssText='position:fixed;z-index:10000;top:4px;left:80px;padding:8px;background:white;color:black;font:12px system-ui;max-width:1100px';
    panel.innerHTML='<strong>Issue 22 QA</strong> <button id="qa-images">Images</button> <button id="qa-prompt">Prompt</button> <button id="qa-mixed">Mixed</button> <button id="qa-invalid">Invalid</button> <button id="qa-inspect">Inspect</button> <button id="qa-language">中文 / English</button> <button id="qa-theme">Light / dark</button><pre id="qa-result" style="margin:4px;white-space:pre-wrap"></pre>';
    document.body.appendChild(panel);
    const reselect = document.createElement('button');
    reselect.textContent='Reselect sources';
    panel.querySelector('#qa-images').after(reselect);
    for(const state of ['empty','output','running']){
        const button=document.createElement('button');
        button.textContent=`Prompt generation: ${state}`;
        button.onclick=()=>reset(`prompt-${state}`);
        panel.querySelector('#qa-prompt').after(button);
    }
    const inspect = () => {
        panel.querySelector('pre').textContent=JSON.stringify({
            count:nodes.length,selected:selectedId,selectedIds,connections:canvas.connections,
            targets:nodes.filter(node=>node.referenceGenerationKind).map(node=>({id:node.id,kind:node.referenceGenerationKind,x:node.x,y:node.y,height:nodeRect(node).height,inputs:node.inputNodeIds || [],refs:inputImagesFor(node).map(item=>item.nodeId),sourceText:(node.inputNodeIds||[]).map(id=>textForNode(nodes.find(source=>source.id===id))).filter(Boolean)})),
            menu:Boolean(referenceGenerateMenuState),drag:Boolean(portDragState)
        });
    };
    function reset(mode){
        nodes=fixture().canvas.nodes;
        const singlePrompt=mode==='prompt' || mode.startsWith('prompt-');
        if(mode==='images') nodes=nodes.filter(node=>node.id!=='P');
        if(singlePrompt){
            nodes=nodes.filter(node=>['P','T'].includes(node.id));
            nodes.find(node=>node.id==='P').y=300;
            if(mode!=='prompt') Object.assign(nodes.find(node=>node.id==='P'),{
                llmEnabled:true,llmInstruction:'Write a sunrise prompt',
                text:mode==='prompt-empty'?'':'A mountain at sunrise',
                textGenerationPending:mode==='prompt-running',running:mode==='prompt-running'
            });
        }
        if(mode==='mixed'){
            nodes=nodes.filter(node=>['P','B','T'].includes(node.id));
            nodes.find(node=>node.id==='P').y=160;
        }
        if(mode==='invalid'){
            nodes=nodes.filter(node=>['A','B','T'].includes(node.id));
            nodes.find(node=>node.id==='B').images=[];
        }
        canvas.nodes=nodes; canvas.connections=[];
        selectedId=singlePrompt ? 'P' : '';
        selectedIds=singlePrompt ? [] : nodes.filter(node=>node.id!=='T').map(node=>node.id).reverse();
        selectedImage={nodeId:'',index:-1}; viewport={x:0,y:0,scale:0.7};
        render(); window.SmartCanvasModules.viewportSelection.viewport.apply(); inspect();
    }
    for(const mode of ['images','prompt','mixed','invalid']) panel.querySelector(`#qa-${mode}`).onclick=()=>reset(mode);
    panel.querySelector('#qa-inspect').onclick=inspect;
    reselect.onclick=()=>{
        selectedId=''; selectedIds=nodes.filter(node=>['A','B','C','D'].includes(node.id)).map(node=>node.id).reverse();
        render(); inspect();
    };
    panel.querySelector('#qa-language').onclick=()=>window.StudioI18n.set(document.documentElement.lang==='en'?'zh':'en');
    panel.querySelector('#qa-theme').onclick=()=>applyTheme(document.body.classList.contains('theme-dark')?'light':'dark');
    window.addEventListener('load',()=>reset('images'));
})();
