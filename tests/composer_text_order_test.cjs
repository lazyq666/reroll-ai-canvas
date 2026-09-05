const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const node = {id:'generation',localTextRefs:[{url:'a.txt',inputInstanceId:'txt',textSnapshot:'TXT'}]};
let textRefs = [{id:'a',text:'A'}, {id:'b',text:'B'}];
const promptInput = {childNodes:[{nodeType:3,textContent:'Composer'}]};
const sandbox = {
    window:{SmartCanvasModules:{smartContainer:{isGroup:n=>n.type === 'smart-group'}}},
    Node:{TEXT_NODE:3,ELEMENT_NODE:1}, promptInput, settings:{engine:'api'},
    blockedInputRefKeys:()=>new Set(), inputRefKey:ref=>`instance|${ref.inputInstanceId}`,
    uniqueReferenceImages:items=>items, composerTextReferenceNodesFor:()=>textRefs,
    textForNode:ref=>ref.text, mediaKindForItem:()=> 'image',
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/js/smart-canvas/prompt-authoring.js'),'utf8'), sandbox);
const resolve=()=>sandbox.window.SmartCanvasModules.promptAuthoring.resolve({node,defaultImages:[
    {url:'one.png',inputInstanceId:'one'}, {url:'two.png',inputInstanceId:'two'},
]});
assert.equal(resolve().prompt,'Composer\n\nA\n\nB\n\nTXT');
node.inputRefOrder=['instance|two','text|b','instance|txt','text|a','instance|one'];
let result=resolve();
assert.equal(result.prompt,'Composer\n\nB\n\nTXT\n\nA');
assert.deepEqual(Array.from(result.textInputs,entry=>entry.key),['text|b','instance|txt','text|a']);
assert.deepEqual(Array.from(result.refs,ref=>ref.inputInstanceId),['two','one']);
const migrationNode={...node,promptDraftText:'Composer',promptDraftHtml:'Composer'};
const migration=sandbox.window.SmartCanvasModules.promptAuthoring.migrationSnapshot({
    node:migrationNode,
    canvas:{nodes:[migrationNode,...textRefs.map(ref=>({...ref,type:'smart-prompt'}))],connections:textRefs.map(ref=>({from:ref.id,to:node.id,kind:'input'}))}
});
assert.equal(migration.prompt,result.prompt,'Migration resolver follows the same text order');
promptInput.childNodes=[];
assert.equal(resolve().prompt,'B\n\nTXT\n\nA');
textRefs=[textRefs[0],{id:'c',text:'C'}];
assert.equal(resolve().prompt,'TXT\n\nA\n\nC');
node.localTextRefs[0].textError='Decode error';
assert.equal(resolve().validationErrors.length,1);
node.type='smart-group'; node.text='Group';
textRefs=[node,...textRefs];
node.inputRefOrder=['text|a', 'text|generation','instance|txt'];
assert.equal(resolve().prompt,'A\n\nGroup\n\nTXT\n\nC');
console.log('Composer text ordering: PASS (draft, mixed text, media order, removal, new inputs, groups, validation)');
