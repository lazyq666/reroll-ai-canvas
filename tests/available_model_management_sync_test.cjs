const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const stateTools = require('../static/js/available-model-management-state.js');
const source = fs.readFileSync(path.join(__dirname, '../static/js/available-model-management.js'), 'utf8');
class Element {
  constructor() { this.children = []; this.dataset = {}; this.listeners = {}; this.classList = {add(){}, remove(){}}; }
  setAttribute(key, value) { this[key] = value; }
  toggleAttribute(key, value) { this[key] = value; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function harness() {
  const listeners = {};
  const elements = new Map();
  const channels = [];
  const original = {id:'alpha:image-a',model:'image-a',name:'Custom image',provider_id:'alpha',visible:true};
  let server = {image:[original],video:[],text:[]};
  let gets = 0;
  let delayed = null;
  let failure = false;
  const window = { AvailableModelManagementState: stateTools, addEventListener(type, fn) {
    (listeners[type] ||= []).push(fn);
  }, location:{origin:'http://test.local'} };
  const document = {
    visibilityState:'visible', addEventListener(){},
    getElementById(id) { if (!elements.has(id)) elements.set(id,new Element()); return elements.get(id); },
    createElement(tag) { const element = new Element(); if (tag === "template") element.content = {firstElementChild:null}; return element; },
  };
  const context = vm.createContext({window, document, parent:{postMessage(){}}, setTimeout, clearTimeout,
    HTMLInputElement: Element, customElements:{whenDefined:()=>new Promise(()=>{})},
    BroadcastChannel: class { constructor() { channels.push(this); } postMessage(){} addEventListener(type, fn){ this[type]=fn; } },
    fetch: async (url, options) => {
      gets += options?.method === 'PUT' ? 0 : 1;
      if (options?.method === 'PUT') {
        const payload = JSON.parse(options.body);
        for (const row of Object.values(server).flat()) if (payload.names[row.id]) row.name = payload.names[row.id];
      } else if (delayed) {
        const pending = delayed;
        delayed = null;
        return pending;
      }
      if (failure) throw new Error('test network failure');
      return {ok:true,json:async()=>({models:structuredClone(server)})};
    },
  });
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'window.testState = state; window.testCommit = commitChanges; })();'), context);
  await tick();
  return {window, listeners, channels, original, setServer(value){server=value;}, get gets(){return gets;}, get message(){return elements.get("page-message").textContent;},
    fail(value){failure=value;},
    delayNextGet(){ let resolve; delayed=new Promise(done=>{resolve=done;}); return models=>resolve({ok:true,json:async()=>({models})}); },
    emit(type, data) { for (const fn of listeners[type] || []) fn({data,origin:'http://test.local'}); }};
}
(async()=>{
  const app = await harness();
  assert.equal(app.window.testState.models.image.length,1);
  app.setServer({image:[],video:[],text:[]});
  app.emit('message',{type:'providers-changed'});
  await tick();
  assert.equal(app.window.testState.models.image.length,0,'removed API model must disappear from the already-open model settings page');
  const fresh = {...app.original,id:'alpha:new',model:'new'};
  app.setServer({image:[fresh],video:[],text:[]});
  app.channels[0].onmessage({data:{type:'models-changed'}});
  await tick();
  assert.equal(app.window.testState.models.image[0].id,'alpha:new','other tabs must synchronize added models');

  const editor = await harness();
  editor.window.testState.models.image[0].name = 'Unsaved label';
  editor.window.testState.dirtyNames.set(editor.original.id,'Unsaved label');
  editor.window.testState.revision++;
  editor.setServer({image:[editor.original,fresh],video:[],text:[]});
  editor.emit('message',{type:'providers-changed'});
  await tick();
  assert.equal(editor.gets,1,'external refresh waits for unsaved edits');
  assert.equal(editor.window.testState.models.image[0].name,'Unsaved label');
  await editor.window.testCommit();
  await tick();
  assert.equal(editor.window.testState.models.image.length,2);
  assert.equal(editor.window.testState.models.image[0].name,'Unsaved label');
  editor.window.testState.dirtyNames.set(editor.original.id,'Edited while removed');
  editor.setServer({image:[fresh],video:[],text:[]});
  assert.equal(await editor.window.testCommit(),true,'concurrently deleted rows do not cause endless save failures: '+editor.message);
  assert.equal(editor.window.testState.models.image.length,1);

  const slow = await harness();
  const finishOld = slow.delayNextGet();
  slow.emit('focus');
  await tick();
  slow.setServer({image:[],video:[],text:[]});
  slow.emit('message',{type:'providers-changed'});
  finishOld({image:[slow.original],video:[],text:[]});
  await tick();
  assert.equal(slow.window.testState.models.image.length,0,'a slow old response must not restore removed rows');

  app.fail(true);
  app.emit('focus');
  await tick();
  assert.equal(app.window.testState.models.image.length,1,'a fetch failure preserves existing rows');
  app.fail(false);
  app.setServer({image:[],video:[],text:[]});
  app.emit('focus');
  await tick();
  assert.equal(app.window.testState.models.image.length,0,'returning to the page retries failed refresh');
  console.log('Model management synchronization: notification, cross-tab, pending edits, concurrent removal, stale response, retry passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
