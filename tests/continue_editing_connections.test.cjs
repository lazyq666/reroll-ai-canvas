const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = {id:'result', images:[{url:'result.png'}],
    generationInputSnapshot:{prompt:'Original prompt', refs:[], settings:{apiKind:'image'}},
    inputNodeIds:['legacy-parent']};
const connections = [
    {from:'image-parent',to:'result',kind:'input',sourceOutputId:'output-2',sourceImageIndex:1},
    {from:'flow-parent',to:'result',kind:'flow'},
    {from:'result',to:'child',kind:'input'}
];
const before = JSON.stringify(connections);
const sandbox = {
    window:{SmartCanvasModules:{generationPending:{},canvasPersistence:{editable:()=>true},canvasMutation:{
        create({data}) { sandbox.nodes.push(data.node); return data.node; },
        createBatch({drafts,connections:added}) {
            sandbox.nodes.push(...drafts);
            for(const c of added) sandbox.generationOutputAddExactConnection(c);
            return drafts;
        }
    }}},
    nodes:[source,...['image-parent','flow-parent','legacy-parent','child'].map(id=>({id}))],
    canvas:{connections}, smartNodeHasRegenerationSnapshot:()=>true, smartNodeInFlight:()=>false,
    pendingBoxSize:()=>({w:200,h:200}),uid:()=> 'draft',tr:x=>x,escapeHtml:x=>x,
    MEDIA_NODE_DEFAULT_SCALE:1,inputRefKey:ref=>ref.inputInstanceId,
    activeInputImagesFor:()=>[], composerTextReferenceNodesFor:()=>[],
    promptAuthoringTextReferences:()=>[],promptAuthoringOrderedTextInputs:()=>[],promptAuthoringJoinUnique:parts=>parts.join('\n\n'),
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/js/smart-canvas/generation-output.js'),'utf8'),sandbox);
const draft = sandbox.window.SmartCanvasModules.generationOutput.continueEditing({source});
const incoming = sandbox.canvas.connections.filter(c=>c.to===draft.id);
assert.equal(incoming.length,3,'Continue editing must inherit both explicit and legacy parent connections');
assert.equal(incoming.find(c=>c.from==='image-parent').sourceOutputId,'output-2');
assert.equal(incoming.find(c=>c.from==='image-parent').sourceImageIndex,1);
assert.equal(incoming.find(c=>c.from==='flow-parent').kind,'flow');
assert.deepEqual(Array.from(draft.inputNodeIds),['image-parent','legacy-parent']);
assert.equal(JSON.stringify(sandbox.canvas.connections.slice(0,3)),before,'Original relationships remain untouched');
assert.ok(!incoming.some(c=>c.from===source.id),'Result must not become an input');
assert.ok(!sandbox.canvas.connections.some(c=>c.from===draft.id),'Do not copy outgoing relationships');
console.log('Continue editing parent connections: PASS');

sandbox.smartNodeInFlight = node => Boolean(node.running || node.pending || node.queuedGenerationRun);
let draftSequence = 0;
sandbox.uid = () => `pending-draft-${++draftSequence}`;
for (const activity of [{running:true,pending:1},{queuedGenerationRun:{operationId:'queued-operation'}}]) {
    const pending = {id:'pending-source',images:[],...activity,generationOperationId:'original-operation',
        promptDraftText:'Later edit',runSettings:{apiKind:'image',count:3},
        generationInputSnapshot:{prompt:'Frozen prompt',settings:{apiKind:'image',count:1},
            refs:[{url:'ref.png',inputInstanceId:'one'},{url:'ref.png',inputInstanceId:'two'}]}};
    const original = JSON.stringify(pending);
    const pendingDraft = sandbox.window.SmartCanvasModules.generationOutput.continueEditing({source:pending});
    assert.ok(pendingDraft,'In-flight media must support continue editing before a result exists');
    assert.equal(pendingDraft.promptDraftText,'Frozen prompt');
    assert.equal(pendingDraft.runSettings.count,1);
    assert.equal(pendingDraft.manualInputRefs.length,2);
    for (const key of ['running','pending','queuedGenerationRun','generationOperationId','generationInputSnapshot']) {
        assert.equal(pendingDraft[key],undefined,`Draft must not inherit ${key}`);
    }
    pendingDraft.manualInputRefs[0].url='edited.png';
    pendingDraft.runSettings.count=5;
    assert.equal(JSON.stringify(pending),original,'Editing the draft must not change the original task');
}
assert.equal(sandbox.window.SmartCanvasModules.generationOutput.continueEditing({source:{...source,images:[]}}),null);
sandbox.window.SmartCanvasModules.canvasPersistence.editable = () => false;
assert.equal(sandbox.window.SmartCanvasModules.generationOutput.continueEditing({source:{...source,images:[],pending:1}}),null);
console.log('Pending continue editing: frozen recipe, isolation, state cleanup and read-only gate PASS');
