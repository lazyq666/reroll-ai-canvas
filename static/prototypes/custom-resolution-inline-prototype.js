import '/static/js/infinite-canvas-ui/core.js';
// Throwaway decoration of a real picker instance, not a production capability implementation.
await Promise.all(['ic-generation-settings-picker','ic-select','ic-prompt-composer','ic-icon-button'].map(tag=>customElements.whenDefined(tag)));
const $=id=>document.getElementById(id),tr=key=>window.StudioI18n.t('laz84.'+key),t=key=>window.StudioI18n.t(key);
const picker=$('sizes');
const initial=()=>({mode:'standard',width:'',height:'',model:'gpt2',enabled:{gpt2:true,sunburst:true,flare:true,banana:false}});
let state=initial(),scenario='happy',step=0,adjustment=null;
function dimensionError(){
 if(state.width===''||state.height==='')return 'inlineIncomplete';
 if(![state.width,state.height].every(n=>Number.isFinite(n)&&n>0))return 'positive';
 if(Math.max(state.width,state.height)>3840)return 'edge';
 if(Math.max(state.width,state.height)/Math.min(state.width,state.height)>3)return 'ratioError';
 if(state.width*state.height<655360)return 'pixelsLow';
 if(state.width*state.height>8294400)return 'pixelsHigh';
 if(![state.width,state.height].every(n=>Number.isInteger(n)&&n%16===0))return 'roundingHint';
 return '';
}
// Round once on commit, ties upward; never round while the user is typing.
function commitDimension(key){
 const value=state[key];
 if(Number.isFinite(value)&&value>0&&value<=3840){
  const rounded=Math.max(16,Math.round(value/16)*16);
  if(rounded!==value){state[key]=rounded;adjustment={width:state.width,height:state.height}}
 }
 const input=picker.shadowRoot.querySelector(key==='width'?'#pixelWidth':'#pixelHeight');
 if(input)input.value=state[key];
 update();
}
const supported=()=>state.model!=='banana'&&state.enabled[state.model];
const valid=()=>[state.width,state.height].every(n=>Number.isInteger(n)&&n>0&&n<=3840&&n%16===0)&&Math.max(state.width,state.height)/Math.min(state.width,state.height)<=3&&state.width*state.height>=655360&&state.width*state.height<=8294400;
const baseRender=picker.render.bind(picker);
// Retain native ratio, resolution, quality, overlay positioning and dismissal behavior.
picker.render=function(){
 baseRender();
 const panel=this.panel;
 const originalSections=[...panel.querySelectorAll('.setting-section')];
 originalSections.slice(0,2).forEach(el=>el.dataset.standardSize='');
 const style=document.createElement('style');style.textContent=`.size-modes{display:flex;gap:4px;padding:3px;background:var(--ui-color-surface-subtle);border-radius:var(--ui-radius-s)}.size-modes button{flex:1;font:var(--ui-text-body-compact);padding:8px 4px;border:1px solid transparent;border-radius:var(--ui-radius-s);background:transparent;color:var(--ui-color-text-tertiary);cursor:pointer}.size-modes button[aria-pressed=true]{background:var(--ui-color-surface);border-color:var(--ui-color-border-secondary);color:var(--ui-color-text-primary)}.pixel-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.pixel-heading button{border:0;background:transparent;color:var(--ui-color-text-tertiary);font:var(--ui-text-caption);cursor:pointer}.pixel-pair{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:end}.pixel-pair label{display:grid;gap:6px;font:var(--ui-text-caption);color:var(--ui-color-text-tertiary)}.pixel-pair input{box-sizing:border-box;width:100%;min-width:0;height:34px;border:1px solid var(--ui-color-border-secondary);border-radius:var(--ui-radius-s);background:var(--ui-color-surface);color:var(--ui-color-text-primary);padding:6px 8px;font:var(--ui-text-body)}.pixel-pair input[aria-invalid=true]{border-color:var(--ui-color-border-danger)}.pixel-pair button{height:34px;padding:4px 6px;color:var(--ui-color-text-primary);background:transparent;border:0;cursor:pointer}.pixel-help{font:var(--ui-text-caption);color:var(--ui-color-text-tertiary);margin:8px 0 0}.pixel-error{color:var(--ui-color-text-danger)}button:focus-visible,input:focus-visible{outline:var(--ui-focus-ring);outline-offset:var(--ui-focus-ring-offset)}[hidden]{display:none!important}`;
 this.shadowRoot.append(style);
 const fields=document.createElement('div');fields.dataset.customSize='';
 fields.innerHTML=`<div class="pixel-heading"><span class="setting-label"></span><button id="clearPixels" type="button"></button></div><div class="pixel-pair"><label><input id="pixelWidth" type="number" min="16" max="3840" step="16" aria-describedby="pixelError"></label><button type="button"><ic-icon name="switch-horizontal" size="small" aria-hidden="true"></ic-icon></button><label><input id="pixelHeight" type="number" min="16" max="3840" step="16" aria-describedby="pixelError"></label></div><p id="pixelError" class="pixel-help" role="status"></p>`;
 fields.querySelector('.setting-label').textContent=tr('custom');
 fields.querySelector('#clearPixels').textContent=tr('clear');
 fields.querySelector('#clearPixels').onclick=()=>{state.width='';state.height='';adjustment=null;update()};
 fields.querySelector('#pixelWidth').setAttribute('placeholder',tr('widthPlaceholder'));
 fields.querySelector('#pixelHeight').setAttribute('placeholder',tr('heightPlaceholder'));
 fields.querySelector('#pixelWidth').setAttribute('aria-label',tr('width'));
 fields.querySelector('#pixelHeight').setAttribute('aria-label',tr('height'));
 const swap=fields.querySelector('.pixel-pair button');swap.setAttribute('aria-label',tr('swap'));swap.onclick=()=>{adjustment=null;[state.width,state.height]=[state.height,state.width];update()};
 for(const [id,key] of [['pixelWidth','width'],['pixelHeight','height']]){
  const input=fields.querySelector('#'+id);
  input.oninput=e=>{adjustment=null;state[key]=e.target.value===''?'':Number(e.target.value);update()};
  input.onblur=()=>commitDimension(key);
  input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();commitDimension(key)}};
 }
 originalSections[1].after(fields);
 update();
};
function update(){
 state.mode=supported()&&(state.width!==''||state.height!=='')?'custom':'standard';
 const exact=state.mode==='custom',ok=!exact||valid(),root=picker.shadowRoot;
 root.querySelectorAll('[data-standard-size]').forEach(el=>{el.inert=exact;el.setAttribute('aria-disabled',String(exact));el.style.opacity=exact?'0.35':'';el.querySelectorAll('button').forEach(b=>b.disabled=exact);el.querySelector('ic-aspect-ratio-picker')?.toggleAttribute('disabled',exact)});
 const custom=root.querySelector('[data-custom-size]');if(custom)custom.hidden=!supported();
 const clear=root.querySelector('#clearPixels');if(clear)clear.hidden=!exact;
 for(const [id,key] of [['pixelWidth','width'],['pixelHeight','height']]){const el=root.querySelector('#'+id);if(el){if(root.activeElement!==el)el.value=state[key];el.setAttribute('aria-invalid',!ok)}}
 const message=root.querySelector('#pixelError');if(message){const error=exact?dimensionError():'';const adjusted=exact&&adjustment?window.StudioI18n.format('laz84.adjusted',adjustment):'';message.textContent=[adjusted,error?tr(error):''].filter(Boolean).join(' ');message.hidden=!message.textContent;message.classList.toggle('pixel-error',Boolean(error)&&error!=='roundingHint')}
 const label=root.querySelector('.trigger-label');if(label)label.textContent=exact?`${state.width||'—'} × ${state.height||'—'} px / ${picker.qualityLabels()[picker.quality]}`:`${picker.ratioText()} / ${picker.resolutionText()} / ${picker.qualityLabels()[picker.quality]}`;
 $('runBtn').toggleAttribute('disabled',!ok);$('submitted').textContent='';
 $('status').textContent=supported()?tr(exact?'inlineInactive':'inlineHint'):tr(state.model==='banana'?'unsupported':'capOff');
 $('dialogModel').textContent=$('model').querySelector(`option[value="${state.model}"]`).textContent;
 $('capability').checked=supported();$('capability').disabled=state.model==='banana';$('capHint').textContent=tr(state.model==='banana'?'unknown':'capHint');
 $('walkHelp').textContent=tr(scenario==='happy'?'inlineHappy':scenario+'Help');$('step').textContent=step===3?tr('complete'):window.StudioI18n.format('laz84.step',{n:step+1});$('next').disabled=step===3;
 document.querySelectorAll('[data-scenario]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.scenario===scenario));
 if(picker.open)queueMicrotask(()=>picker.positionPanel());
}
function localize(){
 for(const [attr,key] of [['ratio-label','laz84.ratio'],['resolution-label','laz84.tier'],['quality-label','smart.quality'],['quality-auto-label','smart.qualityAuto'],['quality-low-label','smart.qualityLow'],['quality-medium-label','smart.qualityMid'],['quality-high-label','smart.qualityHigh']])picker.setAttribute(attr,t(key));
 picker.render();characters();
 $('count').syncOptions();$('count').selectionChanged();
}
function characters(){$('promptCharacterCount').textContent=window.StudioI18n.format('laz84.chars',{n:[...$('promptInput').textContent].length})}
$('promptInput').textContent=tr('prompt');$('promptInput').addEventListener('input',characters);
picker.addEventListener('ic-change',update);
$('model').addEventListener('change',()=>{state.model=$('model').value;if(!supported()){state.mode='standard';state.width='';state.height='';adjustment=null;}update()});
$('capability').onchange=e=>{state.enabled[state.model]=e.target.checked;if(!supported()){state.mode='standard';state.width='';state.height='';adjustment=null;}update()};
$('details').onclick=()=>{picker.hide();$('dialog').showModal()};$('close').onclick=()=>$('dialog').close();
$('runBtn').onclick=()=>{if(state.mode==='custom'&&!valid())return;picker.hide();$('submitted').textContent=tr('sent')};
$('language').onclick=()=>window.StudioI18n.toggle();window.addEventListener('studio-lang-change',localize);
$('theme').onclick=()=>{document.documentElement.classList.toggle('theme-dark');document.body.classList.toggle('theme-dark')};
$('composerFocusToggle').onclick=()=>{const open=$('composer').classList.toggle('focused');$('composerFocusBackdrop').classList.toggle('open',open);$('composerFocusToggle').setAttribute('aria-expanded',open);if(picker.open)picker.positionPanel()};
const actions={happy:[()=>state.width=1920,()=>state.height=1088,()=>{state.width='';state.height='';adjustment=null}],error:[()=>{state.mode='custom';state.width=1920;state.height=1080},()=>commitDimension('height'),()=>{}],fallback:[()=>{state.width=1536;state.height=864},()=>{state.model='banana';state.width='';state.height='';state.mode='standard';$('model').value='banana'},()=>{state.model='gpt2';$('model').value='gpt2'}]};
document.querySelectorAll('[data-scenario]').forEach(b=>b.onclick=()=>{scenario=b.dataset.scenario;step=0;adjustment=null;state=initial();$('model').value='gpt2';picker.ratio='16:9';picker.resolution='2K';update();picker.show()});
$('next').onclick=()=>{actions[scenario][step++]();update();picker.show();if(scenario==='error'&&step===3)$('submitted').textContent=tr('sent')};
window.StudioI18n.apply();localize();
