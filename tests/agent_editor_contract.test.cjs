const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');

test('a claimed request stops offering wait/cancel while generation is in flight', async () => {
    const sent = [];
    let runs = 0;
    let finish;
    const modules = {
        canvasPersistence: {sendPresence: message => sent.push(message), online: () => false, synced: async () => {}},
        generationRun: {run: async () => { runs++; await new Promise(resolve => { finish = resolve; }); }},
    };
    vm.runInNewContext(fs.readFileSync('static/js/smart-canvas/agent-editor.js', 'utf8'), {
        window: {SmartCanvasModules: modules, addEventListener() {}},
        document: {addEventListener() {}},
        setInterval() {}, setTimeout() {}, render() {}, toast() {},
    });
    const editor = modules.agentEditor;
    editor.receive({type:'agent_run_requests', requests:[{id:'request', node_id:'task', state:'queued'}]});
    assert.equal(editor.waiting('task'), true);
    assert.equal(sent[0].type, 'agent_run_claim');
    const claim = {type:'agent_run_claim', id:'request', node_id:'task', state:'claimed', claimed:true};
    editor.receive(claim);
    await new Promise(setImmediate);
    assert.equal(runs, 1);
    assert.equal(editor.waiting('task'), false);
    editor.receive(claim);
    await new Promise(setImmediate);
    assert.equal(runs, 1, 'renewal acknowledgement must not submit twice');
    finish();
    await new Promise(setImmediate);
    await new Promise(setImmediate);
});

test('connection settings omit retired token controls and warnings but retain preferences', async () => {
    let dialog;
    const writes = [];
    const selected = {'#agent-enabled':{checked:true}, '#agent-concurrency':{value:'3'}, '#agent-confirmation':{checked:true}};
    const window = {StudioI18n:{t:key=>key},addEventListener(){}};
    vm.runInNewContext(fs.readFileSync('static/js/agent-access.js','utf8'), {
        window, location:{origin:'http://127.0.0.1:3000',hostname:'127.0.0.1'},
        document:{createElement:()=>dialog={listeners:{},setAttribute(){},addEventListener(k,fn){this.listeners[k]=fn;},querySelector:s=>selected[s],async show(){this.open=true;}},body:{appendChild(){}}},
        customElements:{whenDefined:async()=>{}},
        fetch:async(path,options)=>{
            if(options.method!=='GET') writes.push({path,body:JSON.parse(options.body)});
            return {ok:true,json:async()=>path.endsWith('/me')?{user:{role:'admin'}}:{enabled:true,concurrency:2,confirmation:false,tokens:[{name:'Existing secret client'}]}};
        },
    });
    await window.openAgentAccess();
    assert.doesNotMatch(dialog.innerHTML,/Existing secret client|agent\.tokens|agent\.network|agent\.install\.loopback|<details|data-revoke|data-action="(?:create|copy|copy-simple)"/);
    assert.match(dialog.innerHTML,/agent.install.launchMac/);
    assert.match(dialog.innerHTML,/agent.settings/);
    assert.doesNotMatch(dialog.innerHTML,/agent\.install\.(title|description|notice)|agent\.(concurrencyHint|confirmationHint)/);
    assert.match(dialog.innerHTML,/agent.enabledHint/);
    assert.match(dialog.innerHTML,/agent.install.approve/);
    assert.doesNotMatch(dialog.innerHTML,/data-action="(?:save|close)"|slot="footer"/);
    await dialog.listeners.change({type:'change',target:{id:'agent-concurrency',value:'3'}});
    assert.deepEqual(writes,[{path:'/api/account/agent-access',body:{concurrency:3}}]);
});

test('pairing defers behind a modal, escapes client names, localizes, and never approves twice', async () => {
    let poll, blocker = true, language = 'zh';
    const elements = [], writes = [], events = {};
    class Element {
        constructor() { this.listeners={}; this.open=false; }
        setAttribute() {}
        addEventListener(type, fn) { this.listeners[type]=fn; }
        async show() { this.open=true; }
        async hide() { this.open=false; }
        remove() {}
    }
    const request={id:'request', name:'<script>bad</script>',ip:'127.0.0.1',code:'ABC123'};
    let approved = false, resolveWrite;
    const window={StudioI18n:{t:key=>language+':'+key},addEventListener:(name,fn)=>events[name]=fn,dispatchEvent(){}}; window.top=window;
    vm.runInNewContext(fs.readFileSync('static/js/agent-pairing.js','utf8'),{
        window, document:{visibilityState:'visible',querySelector:()=>blocker,addEventListener(){},createElement:()=>{const el=new Element();elements.push(el);return el;},body:{appendChild(){}}},
        customElements:{whenDefined:async()=>{}},setInterval:fn=>poll=fn,Event,
        fetch:async(path,options)=>{
            if(options){writes.push(JSON.parse(options.body));await new Promise(resolve=>resolveWrite=resolve);approved=true;}
            return {ok:true,json:async()=>options?{state:'approved'}:{requests:approved?[]:[request],account:'designer',enabled:true}};
        },
    });
    await new Promise(setImmediate);
    assert.equal(elements.length,0);
    blocker=false;await poll();
    const dialog=elements[0];
    assert.equal(dialog.open,true);
    assert.ok(dialog.innerHTML.includes('&lt;script&gt;bad&lt;/script&gt;'));
    assert.ok(!dialog.innerHTML.includes('<script>'));
    language='en';events['studio-lang-change']();
    assert.ok(dialog.innerHTML.includes('en:agent.pair.yes'));
    const click={target:{closest:()=>({dataset:{decision:'yes'}})}};
    dialog.listeners.click(click);dialog.listeners.click(click);
    await new Promise(setImmediate);
    assert.deepEqual(writes,[{approve:true}]);
    resolveWrite();await new Promise(setImmediate);
    assert.equal(dialog.open,false);
    await poll();assert.equal(elements.length,1);
});

test('installer download preserves selection, blocks duplicate clicks and recovers from failure', async () => {
    const elements=[], requests=[], events={}; let language='zh', fail=true, status=500, release;
    const selected={'#agent-install-client':{getAttribute:()=> 'claude-code'},'#agent-install-platform':{getAttribute:()=> 'windows'}};
    class Element {
        constructor(tag){this.tag=tag;this.listeners={};elements.push(this);}
        setAttribute(){} addEventListener(name,fn){this.listeners[name]=fn;}
        querySelector(selector){return selected[selector] || null;}
        async show(){this.open=true;} async hide(){this.open=false;}
        remove(){} click(){this.clicked=true;}
    }
    const window={StudioI18n:{t:key=>language+':'+key,lang:()=>language},addEventListener:(key,fn)=>events[key]=fn};
    vm.runInNewContext(fs.readFileSync('static/js/agent-access.js','utf8'),{
        window,location:{origin:'http://192.168.1.8:3000',hostname:'192.168.1.8'},navigator:{userAgent:'Mac'},
        document:{createElement:tag=>new Element(tag),body:{appendChild(){}}},
        customElements:{whenDefined:async()=>{}},URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL(){}},setTimeout(){},
        fetch:async(path,options)=>{
            if(path.endsWith('/agent-installer')) {
                requests.push(JSON.parse(options.body));await new Promise(resolve=>release=resolve);
                return {ok:!fail,status,blob:async()=>({})};
            }
            return {ok:true,json:async()=>path.endsWith('/me')?{user:{role:'designer'}}:{enabled:true,concurrency:2,tokens:[]}};
        },
    });
    await window.openAgentAccess();
    const dialog=elements.find(el=>el.tag==='ic-dialog');
    const event={target:{closest:selector=>selector==='[data-action]'?{dataset:{action:'download-installer'}}:null}};
    const first=dialog.listeners.click(event);
    await dialog.listeners.click(event);
    assert.equal(requests.length,1);
    assert.match(dialog.innerHTML,/zh:agent.install.downloading/);
    assert.match(dialog.innerHTML,/<ic-tabs id="agent-install-client"/);
    assert.match(dialog.innerHTML,/data-value="claude-code" disabled/);
    assert.doesNotMatch(dialog.innerHTML,/<ic-select/);
    release();await first;
    assert.match(dialog.innerHTML,/zh:agent.install.downloadFailed/);
    assert.equal(elements.filter(el=>el.tag==='a').length,0);
    language='en';events['studio-lang-change']();
    assert.match(dialog.innerHTML,/en:agent.install.downloadFailed/);
    status=404;const missing=dialog.listeners.click(event);release();await missing;
    assert.match(dialog.innerHTML,/en:agent.install.serverOutdated/);
    fail=false;status=200;const retry=dialog.listeners.click(event);release();await retry;
    assert.match(dialog.innerHTML,/en:agent.install.downloaded/);
    assert.ok(!dialog.innerHTML.includes('en:agent.install.downloadFailed'));
    assert.equal(requests[1].client,'claude-code');assert.equal(requests[1].platform,'windows');
    assert.equal(requests[1].language,'en');assert.equal(requests[1].url,'http://192.168.1.8:3000');
    const link=elements.find(el=>el.tag==='a');assert.equal(link.clicked,true);
    assert.equal(link.download,'Reroll-MCP-claude-code-windows.zip');
});


test('autosave serializes edits, retains failed changes across closing, and retries the latest values', async () => {
    const writes=[], releases=[];
    const status={innerHTML:''};
    let dialog, failed=false;
    let stored={enabled:true,concurrency:2,confirmation:false};
    const window={StudioI18n:{t:key=>key},addEventListener(){}};
    vm.runInNewContext(fs.readFileSync('static/js/agent-access.js','utf8'),{
        window,document:{createElement:()=>dialog={listeners:{},setAttribute(){},addEventListener(k,fn){this.listeners[k]=fn;},querySelector:s=>s==='#agent-save-status'?status:null,async show(){this.open=true;},async hide(){this.open=false;}},body:{appendChild(){}}},
        customElements:{whenDefined:async()=>{}},
        fetch:async(path,options)=>{
            if(options.method==='PATCH') {
                const values=JSON.parse(options.body);writes.push(values);
                await new Promise(resolve=>releases.push(resolve));
                if(failed)return {ok:false,json:async()=>({code:'failed'})};
                stored={...stored,...values};
            }
            return {ok:true,json:async()=>path.endsWith('/me')?{user:{role:'admin'}}:{...stored}};
        },
    });
    await window.openAgentAccess();
    const change=(id,value)=>{const host={id,...value};return dialog.listeners.change({type:'change',target:{id:'input'},composedPath:()=>[{id:'input'},host]});};
    const first=change('agent-concurrency',{value:'3'});
    await change('agent-concurrency',{value:'4'});
    await change('agent-confirmation',{checked:true});
    assert.deepEqual(writes,[{concurrency:3}]);
    assert.match(status.innerHTML,/agent.saving/);
    releases.shift()();await new Promise(setImmediate);
    assert.deepEqual(writes,[{concurrency:3},{concurrency:4,confirmation:true}]);
    releases.shift()();await first;
    assert.equal(stored.concurrency,4);assert.equal(stored.confirmation,true);
    assert.equal(status.innerHTML,'');
    await change('agent-concurrency',{value:'9'});
    assert.equal(writes.length,2);assert.match(status.innerHTML,/agent.numberInvalid/);
    failed=true;
    const failing=change('agent-concurrency',{value:'5'});
    await change('agent-concurrency',{value:'6'});
    releases.shift()();await failing;
    assert.match(status.innerHTML,/agent.saveFailed/);
    await dialog.hide();await window.openAgentAccess();
    assert.match(dialog.innerHTML,/value="6"/);
    assert.match(status.innerHTML,/agent.saveFailed/);
    failed=false;
    const retry=dialog.listeners.click({target:{closest:()=>({dataset:{action:'retry-save'}})}});
    assert.deepEqual(writes.at(-1),{concurrency:6});
    releases.shift()();await retry;
    assert.equal(stored.concurrency,6);assert.equal(status.innerHTML,'');
});
