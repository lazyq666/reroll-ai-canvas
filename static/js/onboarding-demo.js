/* LAZ-12 throwaway interaction prototype. No application APIs, credentials or disk writes. */
const demoText=(key,vars={})=>StudioI18n.format('demo.'+key,vars);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id);
let step=0,chosen=[],queue=[],current=0,results={},draft={},account={username:'',password:'',confirm:''},folder='~/Documents/Reroll',error='',phase=-1,cliView='',picker=false,existing=false,busy=false,epoch=0;
const scenario={directory:'empty',api:'ok',cli:'signedOut'};
const services=[
{id:'apimart',name:'APIMart',desc:'imagesVideo',mark:'A'},
{id:'modelscope',name:'ModelScope',desc:'models',image:'modelscope.gif'},
{id:'runninghub',name:'RunningHub',desc:'workflow',image:'RunningHub-B.png'},
{id:'volc',key:'volc',desc:'imagesVideo',image:'volcengine-theme-light.svg'},
{id:'other',key:'other',desc:'custom',mark:'+'},
{id:'jimeng',key:'jimeng',desc:'imagesVideo',image:'jimeng.svg',cli:true},
{id:'gpt',name:'GPT CLI',desc:'textImage',image:'chatgpt.svg',cli:true},
{id:'antigravity',name:'Antigravity CLI',desc:'models',image:'gemini.svg',cli:true}];
const service=id=>services.find(s=>s.id===id);
const name=s=>s.key?demoText(s.key):s.name;
const icon=s=>s.image?'<img src="/static/images/providers/'+s.image+'" alt="">':'<span class="monogram">'+s.mark+'</span>';
const iconButton=(id,key,icon,disabled=false)=>'<button type="button" id="'+id+'" class="icon-button" title="'+esc(demoText(key))+'" aria-label="'+esc(demoText(key))+'" '+(disabled?'disabled':'')+'><i data-lucide="'+icon+'" aria-hidden="true"></i></button>';
const folderField=()=>'<div class="field"><label for="folder">'+demoText('folder')+'</label><div class="folder-input"><input id="folder" value="'+esc(folder)+'" autocomplete="off" '+(busy?'disabled':'')+'>'+iconButton('choose','choose','folder-open',busy)+'</div></div>';
const btn=(id,key,primary=false,disabled=false)=>id==='back'?iconButton(id,key,'arrow-left',disabled):'<button id="'+id+'" '+(primary?'class="primary" ':'')+(disabled?'disabled ':'')+'>'+demoText(key)+'</button>';
const title=(a,b)=>'<h1 tabindex="-1">'+demoText(a)+'</h1><p class="subtitle">'+demoText(b)+'</p>';
const field=(id,key,value='',type='text')=>'<label class="field">'+demoText(key)+'<input id="'+id+'" type="'+type+'" value="'+esc(value)+'" autocomplete="off"></label>';
const err=()=>error?'<div class="error" role="alert">'+demoText(error)+'</div>':'';
const listen=(id,fn,event='click')=>{if($(id))$(id).addEventListener(event,fn)};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const stateLine=()=>demoText('state',{n:Object.values(results).filter(v=>v==='connected').length,s:Object.values(results).filter(v=>v==='skipped').length});
function go(n){epoch++;busy=false;step=n;error='';picker=false;existing=false;render();$('content').querySelector('h1')?.focus({preventScroll:true})}
function render(){
$('steps').innerHTML=['admin','workspace','services','connect','ready'].map((k,i)=>'<div class="step '+(i===Math.min(step,4)?'active':'')+'" '+(i===Math.min(step,4)?'aria-current="step"':'')+'><b>'+(step>i?'✓':i+1)+'</b>'+demoText(k)+'</div>').join('');
let html='';
if(step===0){
html=title('admin','adminSub')+'<form id="adminForm">'+field('username','username',account.username)+field('password','password',account.password,'password')+field('confirm','confirm',account.confirm,'password')+'<small>'+demoText('accountHint')+'</small>'+err()+'<div class="actions">'+btn('adminNext','next',true)+'</div></form>';
}else if(step===1){
html=title('workspace','workspaceSub')+'<div class="info"><div class="assets">'+[['media','images'],['history','history'],['canvases','panels-top-left'],['reusable','shapes']].map(([k,icon])=>'<div class="asset"><i data-lucide="'+icon+'" aria-hidden="true"></i><b>'+demoText(k)+'</b></div>').join('')+'</div></div><p class="muted">'+demoText('excluded')+'</p>'+folderField()+(picker?'<div class="info"><b>'+demoText('pickTitle')+'</b><p class="muted">'+demoText('pickerNote')+'</p><select id="pickFolder" aria-label="'+demoText('folder')+'"><option>~/Documents/Reroll</option><option>/Volumes/Creative/Reroll</option><option>~/Pictures/Reroll</option></select></div>':'')+err()+(existing?'<div class="info">'+demoText('existing')+'</div>':'')+'<div class="actions">'+btn('back','back',false,busy)+btn('use',busy?'checking':existing?'open':'use',true,busy)+'</div>';
}else if(step===2){
html=title('selectTitle','selectSub')+[false,true].map(cli=>'<h2>'+demoText(cli?'cli':'api')+'</h2><div class="services">'+services.filter(s=>!!s.cli===cli).map(s=>'<button class="service '+(chosen.includes(s.id)?'selected':'')+'" data-service="'+s.id+'" aria-pressed="'+chosen.includes(s.id)+'">'+icon(s)+'<span><b>'+name(s)+'</b><small>'+demoText(s.desc)+'</small>'+(s.cli?'<small>'+demoText(scenario.cli)+'</small>':'')+'</span><span class="check">'+(chosen.includes(s.id)?'☑':'□')+'</span></button>').join('')+'</div>').join('')+'<div class="actions">'+btn('back','back')+'<button id="configure" class="primary" '+(!chosen.length?'disabled':'')+'>'+demoText('configure',{n:chosen.length})+'</button></div>';
}else if(step===3){
const s=service(queue[current]),d=draft[s.id]||(draft[s.id]={key:'',serviceName:'',url:'',protocol:''});
html='<div class="queue">'+queue.map((id,i)=>'<span class="pill '+(i===current?'current':'')+'">'+(results[id]==='connected'?'✓ ':results[id]==='skipped'?'○ ':'')+name(service(id))+'</span>').join('')+'</div><p class="muted">'+demoText('position',{n:current+1,total:queue.length})+'</p><h1 tabindex="-1">'+name(s)+'</h1>';
if(s.cli){
html+='<p class="subtitle">'+demoText(cliView==='detect'?'detecting':cliView==='absent'?'notInstalled':cliView==='done'?'signedIn':'loggedOut')+'</p>';
if(cliView==='absent')html+=btn('install','install',true);
if(cliView==='install')html+='<div class="info">'+demoText('installHelp')+'</div>'+btn('installed','installed',true);
if(cliView==='signedOut')html+=s.id==='jimeng'?btn('login','login',true):'<div class="info">'+demoText('loginCommand')+'</div>'+btn('cliDone','checkAgain',true);
if(cliView==='qr')html+='<div class="qr"><span>'+demoText('qr')+'</span></div><p class="muted center">'+demoText('qrNote')+'</p>'+btn('cliDone','simulateLogin',true);
if(cliView==='done')html+='<div class="info">✓ '+demoText('connected')+'</div>';
}else{
html+='<p class="subtitle">'+demoText('keySub')+'</p>';
if(s.id==='apimart')html+='<p><a href="https://apimart.ai/keys" target="_blank" rel="noopener noreferrer">'+demoText('getKey')+'</a></p>';
html+='<form id="keyForm"><fieldset '+(busy?'disabled':'')+'>'+(s.id==='other'?field('serviceName','serviceName',d.serviceName)+field('url','url',d.url,'url'):'')+field('key','key',d.key,'password')+'<small>'+demoText('keyHint')+'</small>';
if(d.advanced)html+='<label class="field">'+demoText('protocol')+'<select id="protocol"><option value="openai">OpenAI Compatible</option><option value="gemini">Gemini</option><option value="apimart">APIMart</option></select></label>';
html+=err();
if(phase>=0)html+='<div class="progress">'+['saving','verifying','fetching','classified'].map((k,i)=>'<div style="opacity:'+(phase<i?'.35':'1')+'"><span>'+(phase>i||phase===3?'✓':phase===i?'◌':'○')+'</span>'+demoText(k,{n:s.id==='apimart'?62:12})+'</div>').join('')+(phase===3?'<small>'+demoText('classification')+'</small>':'')+'</div>';
html+='<div class="actions">'+(phase===3?btn('nextService','next',true):btn('connectNow','connectNow',true,busy||!d.key.trim()||(s.id==='other'&&(!d.serviceName.trim()||!d.url.trim()))))+'</div></fieldset></form>';
}
html+='<div class="actions">'+btn('skip','later',false,busy)+'<small>'+stateLine()+'</small></div>';
}else if(step===4){
const usable=Object.values(results).some(v=>v==='connected');
html='<div class="success-mark">'+(usable?'✓':'○')+'</div>'+title(usable?'readyTitle':'noSource',usable?'readySub':'noSourceSub')+'<div class="result"><span>✓ '+demoText('created')+'</span><small>'+esc(account.username)+'</small></div><div class="result"><span>✓ '+demoText('pathReady')+'</span><small>'+esc(folder)+'</small></div>'+queue.map(id=>'<div class="result"><span>'+(results[id]==='connected'?'✓ ':'○ ')+name(service(id))+'</span><small>'+demoText(results[id]||'pending')+(results[id]==='connected'&&!service(id).cli?' · '+demoText('modelCount',{n:id==='apimart'?62:12}):'')+'</small></div>').join('')+'<p class="muted">'+demoText('advanced')+'</p>'+(usable?'<div class="actions">'+btn('startCreating','startCreating',true)+'</div>':'<div class="actions">'+btn('retry','retry',true)+'</div>');
}
$('content').innerHTML=html;StudioI18n.apply();lucide.createIcons({root:$('content')});
bind();
}
function bind(){
listen('back',()=>go(step-1));
if(step===0){
for(const k of ['username','password','confirm'])listen(k,e=>account[k]=e.target.value,'input');
listen('adminForm',e=>{e.preventDefault();if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/.test(account.username)||account.password.length<8||account.password!==account.confirm){error='adminError';render()}else go(1)},'submit');
}
if(step===1){
listen('folder',e=>{folder=e.target.value;existing=false;error=''},'input');
listen('choose',()=>{picker=!picker;render()});
listen('pickFolder',e=>{folder=e.target.value;existing=false;error='';render()},'change');
listen('use',async()=>{if(existing){go(2);return}if(!folder.trim()){error='unavailable';render();return}busy=true;render();const token=epoch;await pause(650);if(token!==epoch)return;busy=false;
if(scenario.directory==='empty')go(2);else if(scenario.directory==='exists'){existing=true;render()}else{error={occupied:'nonempty',blocked:'unavailable',network:'unsupported'}[scenario.directory];render()}});
}
if(step===2){
document.querySelectorAll('[data-service]').forEach(el=>el.onclick=()=>{const id=el.dataset.service;chosen=chosen.includes(id)?chosen.filter(v=>v!==id):[...chosen,id];render();document.querySelector('[data-service="'+id+'"]').focus()});
listen('configure',()=>{queue=[...chosen];current=0;results={};go(3);enterService()});
}
if(step===3){
const s=service(queue[current]),d=draft[s.id];
for(const k of ['key','serviceName','url','protocol'])listen(k,e=>{d[k]=e.target.value;if($('connectNow'))$('connectNow').disabled=busy||!d.key.trim()||(s.id==='other'&&(!d.serviceName.trim()||!d.url.trim()))},k==='protocol'?'change':'input');
listen('keyForm',async e=>{e.preventDefault();if(busy||!$('connectNow')||$('connectNow').disabled)return;busy=true;error='';const token=epoch;const outcome=scenario.api;
for(let i=0;i<4;i++){phase=i;render();await pause(700);if(token!==epoch)return;if(i===1&&outcome==='failure'){error='failed';busy=false;phase=-1;render();return}if(i===2&&s.id==='other'&&outcome==='discoveryFail'&&!d.advanced){d.advanced=true;d.protocol='openai';error='autoFailed';busy=false;phase=-1;render();return}}
results[s.id]='connected';advance();
},'submit');
listen('nextService',advance);
listen('skip',()=>{if(results[s.id]!=='connected')results[s.id]='skipped';advance()});
listen('install',()=>{cliView='install';render()});
listen('installed',()=>{cliView='signedOut';render()});
listen('login',()=>{cliView='qr';render()});
listen('cliDone',completeCLI);
}

listen('startCreating',()=>{if(Object.values(results).some(v=>v==='connected'))window.location.assign('http://127.0.0.1:3001/static/canvas-list.html')});
listen('retry',()=>{current=0;go(3);enterService()});
listen('restart',reset);
}
async function completeCLI(){const token=epoch;busy=true;cliView='done';render();await pause(800);if(token!==epoch)return;results[queue[current]]='connected';advance()}
async function enterService(){
phase=-1;error='';busy=false;const s=service(queue[current]);
if(!s.cli){render();return}
cliView='detect';busy=true;render();const token=epoch;await pause(650);if(token!==epoch)return;busy=false;
if(scenario.cli==='signedIn'){completeCLI();return}
cliView=scenario.cli==='absent'?'absent':'signedOut';render();
}
function advance(){epoch++;busy=false;current++;if(current>=queue.length)go(4);else enterService()}
function reset(){epoch++;step=0;chosen=[];queue=[];results={};draft={};account={username:'',password:'',confirm:''};folder='~/Documents/Reroll';current=0;phase=-1;busy=false;error='';picker=false;existing=false;cliView='';Object.assign(scenario,{directory:'empty',api:'ok',cli:'signedOut'});render();controls()}
function applyScenario(kind,value){
scenario[kind]=value;
epoch++;busy=false;phase=-1;error='';picker=false;existing=false;cliView='';
if(!account.username)account={username:'demo_designer',password:'demo-only-123',confirm:'demo-only-123'};
if(kind==='directory'){
step=1;existing=value==='exists';
error={occupied:'nonempty',blocked:'unavailable',network:'unsupported'}[value]||'';
}else{
step=3;
const active=service(queue[current]);
const id=kind==='cli'?(active?.cli?active.id:'jimeng'):(value==='discoveryFail'?'other':active&&!active.cli?active.id:'apimart');
if(!queue.includes(id))queue.push(id);
chosen=[...queue];current=queue.indexOf(id);delete results[id];
const d=draft[id]||(draft[id]={key:'',serviceName:'',url:'',protocol:''});
if(kind==='cli'){
cliView=value==='absent'?'absent':value==='signedIn'?'done':'signedOut';
if(value==='signedIn'){render();controls();document.querySelector('details').open=false;completeCLI();return}
}else{
d.key=d.key||'demo-key-only';
if(id==='other'){d.serviceName=d.serviceName||demoText('sampleService');d.url=d.url||'https://example.com/v1'}
d.advanced=value==='discoveryFail';
if(d.advanced){d.protocol=d.protocol||'openai';error='autoFailed'}
else if(value==='failure')error='failed';
else{phase=3;results[id]='connected'}
}
}
render();controls();document.querySelector('details').open=false;
$('content').querySelector('h1')?.focus({preventScroll:true});
}
function controls(){
$('controls').innerHTML='<p class="muted">'+demoText('scenarioHint')+'</p>'+[['directory','directoryState',['empty','exists','occupied','blocked','network']],['api','apiState',['ok','failure','discoveryFail']],['cli','cliState',['absent','signedOut','signedIn']]].map(([k,label,values])=>'<label>'+demoText(label)+'<select id="scenario-'+k+'"><option value="" disabled selected>'+demoText('selectScenario')+'</option>'+values.map(v=>'<option value="'+v+'">'+demoText(v)+'</option>').join('')+'</select></label>').join('')+btn('resetDemo','restart');
for(const k of ['directory','api','cli'])listen('scenario-'+k,e=>applyScenario(k,e.target.value),'change');
listen('resetDemo',()=>{reset();document.querySelector('details').open=false});
}
listen('language',()=>{StudioI18n.set(StudioI18n.lang()==='zh'?'en':'zh');$('language').textContent=StudioI18n.lang()==='zh'?'English':'中文';render();controls()});
listen('theme',()=>{const dark=document.documentElement.dataset.uiTheme!=='dark';document.documentElement.dataset.uiTheme=dark?'dark':'light';document.documentElement.style.colorScheme=dark?'dark':'light'});
render();controls();
