/* Test controls for the isolated local acceptance fixture. */
window.addEventListener('load', () => {
 const bar=document.createElement('div');
 bar.style='position:fixed;top:0;left:0;z-index:9999;background:white;color:black;padding:5px;display:flex;gap:8px';
 bar.innerHTML='<button id="fixture-select">Select generation</button><button id="fixture-language">中文 / English</button><button id="fixture-theme">Light / Dark</button><button id="fixture-release">Release cloud</button><button id="fixture-inspect">Inspect queue</button><output id="fixture-report"></output>';
 document.body.append(bar);
 bar.querySelector('#fixture-select').onclick=()=>{selectedId='generation';selectedIds=[];render();};
 bar.querySelector('#fixture-language').onclick=()=>window.StudioI18n.set(window.StudioI18n.lang()==='en'?'zh':'en');
 bar.querySelector('#fixture-theme').onclick=()=>{document.documentElement.dataset.uiTheme=document.documentElement.dataset.uiTheme==='dark'?'light':'dark';};
 bar.querySelector('#fixture-release').onclick=()=>fetch('/fixture/release');
 bar.querySelector('#fixture-inspect').onclick=async()=>{const s=await fetch('/fixture/state').then(r=>r.json());bar.querySelector('#fixture-report').textContent=JSON.stringify({released:s.released,queued:s.staged.length,commits:s.mutations.length,prompts:s.submissions.map(x=>x.payload.prompt),targets:s.submissions.map(x=>x.target_ids),visible:nodes.filter(n=>n.generationOperationId).map(n=>({id:n.id,operation:n.generationOperationId,record:window.SmartCanvasModules.localGenerationSubmissions.forNode(n)}))});};
});
