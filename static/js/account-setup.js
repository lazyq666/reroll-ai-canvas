(() => {
  'use strict';
  const tr = key => window.StudioI18n.t(key);
  const tf = (key, values) => window.StudioI18n.format(key, values);
  const text = (key, values = {}) => window.StudioI18n.format('onboarding.' + key, values);
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const catalog = [
    {id:'apimart', name:'APIMart', description:'imagesVideo', mark:'A'},
    {id:'modelscope', name:'ModelScope', description:'models', image:'modelscope.gif'},
    {id:'runninghub', name:'RunningHub', description:'workflow', image:'RunningHub-B.png'},
    {id:'volcengine', key:'volc', description:'imagesVideo', image:'volcengine-theme-light.svg'},
    {id:'other', key:'other', description:'custom', mark:'+'},
    {id:'jimeng', key:'jimeng', description:'imagesVideo', image:'jimeng.svg', cli:true},
    {id:'codex', name:'GPT CLI', description:'textImage', image:'chatgpt.svg', cli:true},
    {id:'gemini-cli', name:'Antigravity CLI', description:'models', image:'gemini.svg', cli:true},
  ];
  const getService = id => catalog.find(item => item.id === id);
  const name = item => item.key ? text(item.key) : item.name;
  const state = {
    step:0, loading:true, busy:false, error:'', errorValues:{}, account:{username:'',password:'',confirm:''},
    directory:'', inspected:null, selected:[], queue:[], index:0, connected:{}, skipped:[],
    drafts:{}, stage:'', count:0, cli:null, qr:null, help:false, restartNeeded:false,
  };
  let epoch = 0, pollTimer = null, pendingController = null, activeUser = null;
  const queueKey = () => 'reroll_onboarding_queue_' + activeUser;
  const current = () => getService(state.queue[state.index]);
  const on = (id, handler, event='click') => $(id)?.addEventListener(event, handler);
  const inputValue = id => $(id)?.shadowRoot?.querySelector('input')?.value ?? $(id)?.value ?? '';
  function onInput(id, update) {
    const control=$(id); if(!control)return;
    const sync=event=>{
      const input=event.composedPath().find(node=>node instanceof HTMLInputElement);
      const value=input?.value ?? control.value;
      control.value=value; update(value);
    };
    control.addEventListener('input',sync);
    Promise.resolve(control.updateComplete).then(()=>control.shadowRoot?.querySelector('input')?.addEventListener('input',sync));
  }
  const button = (id,key,primary=false,disabled=state.busy) =>
    '<ic-button id="'+id+'" type="button" hierarchy="'+(primary?'primary':'secondary')+'" '+(disabled?'disabled':'')+'>'+text(key)+'</ic-button>';
  const back = () => '<ic-icon-button id="back" icon="back" label="'+escape(text('back'))+'" '+(state.busy?'disabled':'')+'></ic-icon-button>';
  const field = (id,key,value='',type='text',extra='') =>
    '<ic-form-field label="'+escape(text(key))+'"><ic-input id="'+id+'" type="'+type+'" value="'+escape(value)+'" autocomplete="'+(type==='password'?'new-password':'off')+'" '+extra+' '+(state.busy?'disabled':'')+'></ic-input></ic-form-field>';
  const title = (heading,subtitle) => '<h1 tabindex="-1">'+text(heading)+'</h1><p class="subtitle">'+text(subtitle)+'</p>';
  const alert = () => state.error ? '<ic-alert open tone="danger">'+tf(state.error,state.errorValues)+'</ic-alert>' : '';
  const actions = content => '<div class="actions">'+content+'</div>';
  const result = (label,value) => '<div class="result"><span>'+escape(label)+'</span><small>'+escape(value)+'</small></div>';
  const hasSource = () => Object.keys(state.connected).length > 0;

  function stopWork() {
    epoch++;
    clearTimeout(pollTimer);
    pendingController?.abort();
    pendingController = null;
  }
  function setStep(step) {
    stopWork(); state.step=step; state.busy=false; state.error=''; state.stage='';
    render(); $('setup-content').querySelector('h1')?.focus({preventScroll:true});
  }
  async function request(url, body, method=body===undefined?'GET':'POST') {
    const response = await fetch(url, {
      method, credentials:'same-origin', cache:'no-store',
      headers:body===undefined?{}:{'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),
    });
    const payload = await response.json().catch(()=>({}));
    if(!response.ok) {
      const code=payload.reason || payload.detail?.code || (response.status===401?'loginNeeded':response.status===403?'local_client_required':'connection_failed');
      const error=new Error(code); error.status=response.status; error.payload=payload; throw error;
    }
    return payload;
  }
  const setupMessageKeys = {
    local_client_required:'onboarding.local_client_required', cross_site_rejected:'auth.crossSiteRejected',
    setup_already_complete:'auth.setupAlreadyComplete', invalid_username:'auth.usernameInvalid',
    password_too_short:'auth.passwordTooShort', workspace_setup_unavailable:'auth.workspaceSetupUnavailable',
    workspace_setup_failed:'auth.setupFailed', directory_picker_unavailable:'auth.openPickerFailed',
    directory_picker_failed:'auth.chooseDirectoryFailed', directory_required:'auth.directoryRequired',
    workspace_directory_required:'auth.directoryRequired', workspace_directory_unavailable:'auth.directoryUnavailable',
    workspace_storage_unknown:'auth.workspaceStorageUnknown', workspace_storage_network_unsupported:'auth.workspaceNetworkUnsupported',
    workspace_storage_unsupported:'auth.workspaceStorageUnsupported', workspace_source_repository_overlap:'auth.workspaceSourceRepositoryOverlap',
    workspace_directory_non_empty:'auth.workspaceNonEmpty', workspace_directory_incomplete:'auth.workspaceIncomplete',
    workspace_inspection_failed:'auth.inspectRetry', workspace_open_failed:'auth.openWorkspaceRetry',
    setup_workspace_invalid_accounts:'auth.workspaceInvalidAccounts', no_models:'onboarding.noModels',
    not_installed:'onboarding.notInstalled', cli_outdated:'onboarding.cliOutdated', login_unverified:'onboarding.cliUnknown',
  };
  function fail(error,fallback='connection_failed') {
    const code=error?.message || fallback;
    state.error=setupMessageKeys[code] || (window.StudioI18n.t('onboarding.'+code)!=='onboarding.'+code?'onboarding.'+code:'onboarding.'+fallback);
    state.busy=false; render();
  }
  function render() {
    const steps=['admin','workspace','services','connect','ready'];
    $('setup-steps').innerHTML='<ol class="setup-step-list">'+steps.map((key,i)=>'<li class="step '+(i===state.step?'active':'')+'" '+(i===state.step?'aria-current="step"':'')+'><b>'+(i<state.step?'✓':i+1)+'</b>'+text(key)+'</li>').join('')+'</ol>';
    let html='';
    if(state.loading) html='<p>'+text('loading')+'</p>'+alert()+button('reload','retryAction',true,false);
    else if(state.restartNeeded) html=title('workspace','restarting')+alert()+actions(button('restart','restart',true));
    else if(state.step===0) {
      html=title('admin','adminSub')+'<form id="initial-setup-form" class="auth-form">'+
        field('setup-username','username',state.account.username,'text','minlength="3" maxlength="32"')+
        field('setup-password','password',state.account.password,'password','minlength="8"')+
        field('setup-password-confirm','confirm',state.account.confirm,'password','minlength="8"')+
        '<small>'+text('accountHint')+'</small>'+alert()+actions(button('admin-next','next',true))+'</form>';
    } else if(state.step===1) {
      html=title('workspace','workspaceSub')+'<section id="workspace-selection-step"><div class="info"><div class="assets">'+
        [['media','images'],['history','history'],['canvases','panels-top-left'],['reusable','shapes']].map(([key,icon])=>'<div class="asset"><i data-lucide="'+icon+'" aria-hidden="true"></i><b>'+text(key)+'</b></div>').join('')+
        '</div></div><p class="muted">'+text('excluded')+'</p><ic-form-field class="field" label="'+escape(text('folder'))+'"><ic-input end-action id="workspace-directory" value="'+escape(state.directory)+'" '+(state.busy?'disabled':'')+'><ic-icon-button slot="end" id="choose-workspace-directory" icon="project" label="'+escape(text('choose'))+'" '+(state.busy?'disabled':'')+'></ic-icon-button></ic-input></ic-form-field>'+
        (state.inspected?.kind==='existing'?'<ic-alert open tone="info">'+text('existing')+'</ic-alert>':'')+alert()+
        actions(back()+button('inspect-workspace',state.busy?'checking':state.inspected?.kind==='existing'?'open':'use',true))+'</section>';
    } else if(state.step===2) {
      html=title('selectTitle','selectSub')+
        (hasSource()?'<ic-alert open tone="success">'+text('existingConnected',{n:Object.keys(state.connected).length})+'</ic-alert>':'')+
        [false,true].map(cli=>'<h2>'+text(cli?'cli':'api')+'</h2><div class="services">'+catalog.filter(s=>!!s.cli===cli).map(s=>
          '<ic-button class="service '+(state.selected.includes(s.id)?'selected':'')+'" hierarchy="secondary" data-service="'+s.id+'" toggle '+(state.selected.includes(s.id)?'pressed':'')+'><span class="service-content">'+
          (s.image?'<img src="/static/images/providers/'+s.image+'" alt="">':'<span class="monogram">'+s.mark+'</span>')+
          '<span><b>'+name(s)+'</b><small>'+text(s.description)+'</small></span><span class="check">'+(state.selected.includes(s.id)?'☑':'□')+'</span></span></ic-button>').join('')+'</div>').join('')+
        alert()+actions((hasSource()?button('ready','showReady'): '<span></span>')+'<ic-button id="configure" hierarchy="primary" '+(!state.selected.length?'disabled':'')+'>'+text('configure',{n:state.selected.length})+'</ic-button>');
    } else if(state.step===3) {
      const service=current(),d=state.drafts[service.id] ||= {key:'',name:'',url:'',protocol:''};
      html='<div class="queue">'+state.queue.map((id,i)=>'<span class="pill '+(i===state.index?'current':'')+'">'+(state.connected[id]?'✓ ':state.skipped.includes(id)?'○ ':'')+name(getService(id))+'</span>').join('')+'</div><p class="muted">'+text('position',{n:state.index+1,total:state.queue.length})+'</p><h1 tabindex="-1">'+name(service)+'</h1>';
      if(service.cli) {
        html+='<p class="subtitle">'+text(!state.cli?'detecting':!state.cli.installed?'notInstalled':state.cli.version_ok===false?'cliOutdated':state.cli.logged_in===true?'signedIn':state.cli.logged_in===null?'cliUnknown':'loggedOut')+'</p>';
        if(state.help) html+='<div class="info">'+text('installHelp')+'<p><a href="'+installUrl(service.id)+'" target="_blank" rel="noopener noreferrer">'+text('helpLink')+'</a></p></div>';
        if(state.cli?.installed && state.cli.logged_in!==true && service.id!=='jimeng') html+='<div class="info">'+text('loginCommand')+'<pre>'+(service.id==='codex'?'codex login':'agy')+'</pre></div>';
        if(state.qr) html+='<p>'+text('loginWaiting')+'</p>'+(state.qr.url?'<img class="qr-image" src="'+escape(state.qr.url)+'" alt="'+escape(text('qrAlt'))+'">':'')+'<pre class="login-output">'+escape(state.qr.text)+'</pre>';
        html+=alert();
        if(state.cli && !state.busy) html+=actions(button(state.cli.installed?'recheck':'install',state.cli.installed?'checkAgain':'install',true)+(service.id==='jimeng'&&state.cli.installed&&state.cli.logged_in!==true?button('login','login',true):''));
      } else {
        html+='<p class="subtitle">'+text('keySub')+'</p>'+(service.id==='apimart'?'<p><a href="https://apimart.ai/keys" target="_blank" rel="noopener noreferrer">'+text('getKey')+'</a></p>':'')+
          '<form id="key-form" class="auth-form">'+(service.id==='other'?field('service-name','serviceName',d.name)+field('service-url','url',d.url,'url'):'')+
          field('api-key','key',d.key,'password')+'<small>'+text('keyHint')+'</small>';
        if(d.advanced) html+='<ic-select label="'+escape(text('protocol'))+'" id="protocol" value="'+escape(d.protocol || 'openai')+'" '+(state.busy?'disabled':'')+'><option value="openai">'+text('openaiCompatible')+'</option><option value="gemini">Gemini</option><option value="apimart">APIMart</option></ic-select>';
        html+=alert()+actions(button('connect','connectNow',true,state.busy||!d.key.trim()||(service.id==='other'&&(!d.name.trim()||!d.url.trim()))))+'</form>';
      }
      if(state.stage) html+='<div class="ic-progress" role="status">'+text(state.stage==='complete'?'classified':state.stage,{n:state.count})+(state.stage==='complete'?'<small>'+text('classification')+'</small>':'')+'</div>';
      html+=actions(button('skip','later')+'<small>'+text('state',{n:Object.keys(state.connected).length,s:state.skipped.length})+'</small>');
    } else {
      html='<div class="ready-mark">'+(hasSource()?'✓':'○')+'</div>'+title(hasSource()?'readyTitle':'noSource',hasSource()?'readySub':'noSourceSub')+
        result('✓ '+text('created'),state.account.username)+result('✓ '+text('pathReady'),state.directory)+
        Object.entries(state.connected).map(([id,item])=>result('✓ '+(getService(id)?name(getService(id)):item.name),text('modelCount',{n:item.count}))).join('')+
        state.skipped.filter(id=>!state.connected[id]).map(id=>result('○ '+name(getService(id)),text('skipped'))).join('')+
        '<p class="muted">'+text('advanced')+'</p>'+alert()+actions(button(hasSource()?'start-creating':'choose-services',hasSource()?'startCreating':'retry',true));
    }
    $('setup-content').innerHTML=html;
    window.lucide.createIcons({root:$('setup-content')});
    bind();
  }
  function bind() {
    on('reload',boot); on('restart',restart);
    on('back',()=>setStep(state.step-1));
    on('ready',()=>setStep(4)); on('choose-services',()=>setStep(2));
    const adminNext=event=>{
      event?.preventDefault();
      const a=state.account; a.username=inputValue('setup-username');a.password=inputValue('setup-password');a.confirm=inputValue('setup-password-confirm');
      if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/.test(a.username)||a.password.length<8||a.password!==a.confirm) {state.error='onboarding.adminError';render();return}
      setStep(1);
    };
    on('admin-next',adminNext); on('initial-setup-form',adminNext,'submit');
    on('initial-setup-form',event=>{if(event.key==='Enter')adminNext(event)},'keydown');
    for(const [id,key] of [['setup-username','username'],['setup-password','password'],['setup-password-confirm','confirm']]) onInput(id,value=>{state.account[key]=value});
    onInput('workspace-directory',value=>{state.directory=value;state.inspected=null});
    on('choose-workspace-directory',chooseDirectory);
    on('inspect-workspace',inspectWorkspace);
    document.querySelectorAll('[data-service]').forEach(el=>el.addEventListener('click',()=>{
      const id=el.dataset.service;state.selected=state.selected.includes(id)?state.selected.filter(v=>v!==id):[...state.selected,id];render();
    }));
    on('configure',()=>{
      state.queue=[...state.selected];state.index=0;state.skipped=[];
      try{sessionStorage.setItem(queueKey(),JSON.stringify(state.queue))}catch{}
      setStep(3);enterService();
    });
    if(state.step===3) {
      const d=state.drafts[current().id];
      for(const [id,key] of [['api-key','key'],['service-name','name'],['service-url','url']]) onInput(id,value=>{
        d[key]=value;
        if($('connect'))$('connect').disabled=state.busy||!d.key.trim()||(current().id==='other'&&(!d.name.trim()||!d.url.trim()));
      });
      on('protocol',e=>{d.protocol=e.target.value},'change');
    }
    on('key-form',e=>{e.preventDefault();connectService()},'submit');on('connect',connectService);
    on('key-form',e=>{if(e.key==='Enter'&&!e.composedPath().some(node=>node.tagName==='IC-SELECT')&&!$('connect')?.disabled){e.preventDefault();connectService()}},'keydown');
    on('skip',()=>{if(state.busy)return;state.skipped.push(current().id);nextService()});
    on('install',()=>{state.help=true;render()});on('recheck',enterService);on('login',startLogin);
    on('start-creating',async()=>{
      state.busy=true;state.error='';render();
      try{const result=await request('/api/admin/onboarding/complete',{});sessionStorage.removeItem(queueKey());window.location.assign(result.next_url)}
      catch(error){if(error.message==='no_source'){await boot()}fail(error,'finishFailed')}
    });
  }
  async function chooseDirectory() {
    state.busy=true;state.error='';render();
    try {const data=await request('/api/setup/select-directory',{});state.directory=data.workspace_directory;state.inspected=null}
    catch(error){fail(error)}
    finally{state.busy=false;render()}
  }
  async function inspectWorkspace() {
    if(state.busy)return;
    state.busy=true;state.error='';render();
    let submitted=false;
    try {
      const selected=state.directory.trim();
      if(!selected)throw new Error('directory_required');
      if(!state.inspected) {
        let payload=await request('/api/setup/inspect-workspace',{workspace_directory:selected});
        if(payload.message_code==='workspace_directory_unavailable') {
          await request('/api/setup/prepare-directory',{workspace_directory:selected});
          payload=await request('/api/setup/inspect-workspace',{workspace_directory:selected});
        }
        state.directory=payload.workspace_directory||selected;
        if(payload.next_step === 'login') {state.inspected={kind:'existing',next:'login'};state.busy=false;render();return}
        if(payload.next_step !== 'create_admin')throw new Error(payload.reason||payload.message_code||'workspace_directory_unavailable');
        if(String(payload.reason||'').includes('existing')||String(payload.message_code||'').includes('existing')) {
          state.inspected={kind:'existing',next:'create_admin'};state.busy=false;render();return;
        }
        state.inspected={kind:'empty',next:'create_admin'};
      }
      if(state.inspected.next==='login') {
        await request('/api/setup/open-workspace',{workspace_directory:state.directory});
        window.location.replace('/startup');return;
      }
      // Inspection remains the boundary before account/workspace creation.
      submitted=true;
      await request('/api/setup',{
        username:state.account.username.trim(),password:state.account.password,
        workspace_directory:state.directory,
      });
      state.account.password='';state.account.confirm='';
      state.restartNeeded=true; await restart();
    }catch(error){
      // The server may have committed setup before a response was lost.
      if(submitted) {
        const status=await request('/api/setup/status').catch(()=>null);
        if(status && !status.required){
          state.account.password='';state.account.confirm='';
          await boot();return;
        }
      }
      fail(error);
    }
    finally{state.busy=false;render()}
  }
  async function restart() {
    state.busy=true;state.error='';render();
    try{await request('/api/runtime/restart',{cancel_active:false});window.location.replace('/startup')}
    catch(error){fail(error,'restartRetry')}
  }
  function installUrl(id) {
    return {jimeng:'https://jimeng.jianying.com/cli',codex:'https://github.com/openai/codex','gemini-cli':'https://antigravity.google/download'}[id];
  }
  async function enterService() {
    stopWork();state.busy=false;state.error='';state.stage='';state.cli=null;state.qr=null;state.help=false;render();
    if(!current().cli)return;
    await checkCLI(epoch);
  }
  async function checkCLI(token) {
    const id=current().id;
    try {
      const status=await request('/api/admin/onboarding/cli/'+id);
      if(token!==epoch)return;
      state.cli=status;render();
      if(status.logged_in===true&&status.version_ok!==false) {await connectService();return}
      pollTimer=setTimeout(()=>checkCLI(token),5000);
    } catch(error){if(token===epoch)fail(error)}
  }
  async function startLogin() {
    clearTimeout(pollTimer); const token=epoch;
    state.busy=true;state.error='';render();
    try{const data=await request('/api/jimeng/login/start',{});if(token!==epoch)return;applyQR(data);state.busy=false;render();pollTimer=setTimeout(()=>pollLogin(token),2500)}
    catch(error){if(token===epoch)fail(error,'loginFailed')}
  }
  function applyQR(data) {
    let url='';
    try {const parsed=new URL(data.qr_url);if(['https:','http:'].includes(parsed.protocol)||/^data:image\/(png|jpeg|webp);base64,/.test(data.qr_url))url=parsed.href}catch{}
    state.qr={url,text:String(data.text||'')};
  }
  async function pollLogin(token) {
    try {
      const data=await request('/api/jimeng/login/status');if(token!==epoch)return;
      if(data.logged_in){state.qr=null;await enterService();return}
      applyQR(data);render();
      if(data.running)pollTimer=setTimeout(()=>pollLogin(token),2500);
      else fail(new Error('loginFailed'));
    }catch(error){if(token===epoch)fail(error,'loginFailed')}
  }
  async function connectService() {
    if(state.busy||state.stage==='complete')return;
    const service=current(),draft=state.drafts[service.id],token=epoch;
    clearTimeout(pollTimer);state.busy=true;state.error='';state.stage='saving';render();
    pendingController=new AbortController();
    try {
      const response=await fetch('/api/admin/onboarding/connect',{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        signal:pendingController.signal,
        body:JSON.stringify({service:service.id,name:draft.name,base_url:draft.url,api_key:draft.key,protocol:draft.protocol}),
      });
      if(!response.ok){const data=await response.json();throw new Error(data.detail?.code||'connection_failed')}
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',complete=false;
      while(true) {
        const chunk=await reader.read();if(token!==epoch)return;
        buffer+=decoder.decode(chunk.value||new Uint8Array(),{stream:!chunk.done});
        const lines=buffer.split('\n');buffer=lines.pop();
        for(const line of lines) {
          if(!line.trim())continue;
          const event=JSON.parse(line);
          if(event.stage==='error') {
            if(event.code==='auto_failed'){draft.advanced=true;draft.protocol='openai'}
            throw new Error(event.code);
          }
          state.stage=event.stage;
          if(event.stage==='complete'){
            complete=true;state.count=event.count;
            state.connected[service.id]={name:name(service),count:event.count,providerId:event.provider_id};
            draft.key='';
          }
          render();
        }
        if(chunk.done)break;
      }
      if(!complete)throw new Error('connection_failed');
      pollTimer=setTimeout(()=>{if(token===epoch)nextService()},650);
    }catch(error){if(token===epoch&&error.name!=='AbortError'){state.stage='';fail(error)}}
    finally{if(token===epoch){state.busy=state.stage==='complete';render()}}
  }
  function nextService() {
    stopWork();state.index++;state.busy=false;
    if(state.index>=state.queue.length)setStep(4);else enterService();
  }
  async function boot() {
    stopWork();state.loading=true;state.error='';render();
    try {
      const status=await request('/api/setup/status');
      state.directory=status.configured_workspace_directory||'';
      if(status.required){state.step=0;return}
      const identity=await request('/api/auth/me');
      if(!identity.user||identity.user.role!=='admin'){window.location.replace('/login');return}
      activeUser=identity.user.id;state.account.username=identity.user.username;
      const progress=await request('/api/admin/onboarding');
      if(!progress.pending){window.location.replace('/static/canvas-list.html');return}
      state.connected={};
      for(const [id,item] of Object.entries(progress.services))state.connected[getService(id)?id:'other']={...item,providerId:id};
      state.directory=progress.workspace.configured_workspace_directory||state.directory;
      state.step=2;state.restartNeeded=status.workspace_configured===false;
      try{state.selected=JSON.parse(sessionStorage.getItem(queueKey())||'[]').filter(id=>getService(id))}catch{state.selected=[]}
    }catch(error){if(error.status===401){window.location.replace('/login');return}state.error='onboarding.loadFailed'}
    finally{state.loading=state.error==='onboarding.loadFailed';render()}
  }
  on('setup-language',()=>window.StudioI18n.toggle());
  on('setup-theme',()=>{
    const root=document.documentElement,dark=root.dataset.uiTheme!=='dark';
    root.dataset.uiTheme=dark?'dark':'light';root.style.colorScheme=dark?'dark':'light';
  });
  window.addEventListener('studio-lang-change',render);
  window.addEventListener('pagehide',()=>{stopWork();state.account.password='';state.account.confirm='';state.drafts={}});
  Promise.all(['ic-input','ic-button','ic-card','ic-icon-button','ic-form-field','ic-select'].map(name=>customElements.whenDefined(name))).then(boot);
})();
