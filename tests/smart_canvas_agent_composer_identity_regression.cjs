const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const host = read('static/js/smart-canvas.js');
const persistence = read('static/js/smart-canvas/canvas-persistence.js');
const agentId = 'agent:e753d254b2516d877ac0500e682f20b506c98a8e803c5d6f279a3cafa7a784ab:task:0';

function section(source, start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
    return source.slice(from, to);
}

function fixture(id = agentId, {prefixCollision = false} = {}) {
    const node = {id, type:'smart-image', referenceGenerationKind:'video', images:[],
        promptDraftText:'Saved prompt', runSettings:{engine:'api', apiKind:'video', videoDuration:13}};
    // A prefix collision must never redirect an edit or run to a different Node.
    const other = {id:prefixCollision ? 'agent' : 'other', type:'smart-image', promptDraftText:'Other prompt', runSettings:{}};
    const editor = {dataset:{}, innerHTML:'Edited prompt'};
    const calls = [];
    const sandbox = {
        window:{SmartCanvasModules:{}},
        document:{activeElement:editor, getElementById:()=>null},
        nodes:[node, other], lastComposerNodeId:`${id}:node`,
        isSmartRunnableNode:value=>value?.type === 'smart-image',
        promptInput:editor, promptPlainText:()=>editor.innerHTML,
        composer:{classList:{contains:()=>true}, contains:element=>element === editor},
        runBtn:{disabled:false}, composerFocusRevision:0,
        generationRun:{run:options=>{ calls.push(options.nodeId); return true; }},
        syncRunButtonState(){}, setPromptAuthoringFocused(){}, tr:key=>key, toast(){},
        referenceGenerationKind:value=>value.referenceGenerationKind,
        smartNodeInFlight:()=>false,
        canvas:{nodes:[node, other], connections:[]}, canvasPersistenceRevision:3,
        initialSmartSettings:{}, normalizeLegacySmartNode:value=>value,
        selectionState:null, selectedId:'agent', selectedIds:[],
        canvasPersistenceMergeHolds:new Set(), canvasPersistenceQueuedMessages:[],
    };
    vm.createContext(sandbox);
    vm.runInContext(read('static/js/smart-canvas/generation-settings.js'), sandbox);
    vm.runInContext(`
        settings = {engine:'api', apiKind:'video', videoDuration:15};
        smartSettingsForNode = node => cloneSmartSettings(node.runSettings);
        rememberRecentSmartSettings = () => {};
    `, sandbox);
    vm.runInContext(section(host, 'let composerSubmission =', 'function syncRunButtonState('), sandbox);
    vm.runInContext(section(host, 'function savePromptDraftForCurrent(){', 'function setPromptDraftForNode('), sandbox);
    vm.runInContext(section(persistence, 'function canvasPersistenceAssignDocument(', 'function canvasPersistenceEditableElementActive('), sandbox);
    vm.runInContext(section(persistence, 'function canvasRealtimeApplierCanApplyDuringComposerFocus(', 'function canvasPersistenceRemoteDeletesActiveNode('), sandbox);
    return {sandbox, node, other, calls};
}

for (const id of ['smart_example', agentId, 'agent:submission:node:task:0:node']) {
    test(`manual generation submits the complete Node ID: ${id}`, async () => {
        const {sandbox, calls} = fixture(id);
        assert.equal(await sandbox.submitComposerGeneration(), true);
        assert.deepEqual(calls, [id]);
    });
}

test('Agent prompt and parameter edits persist on the Composer Node', () => {
    const {sandbox, node, other} = fixture(agentId, {prefixCollision:true});
    sandbox.savePromptDraftForCurrent();
    assert.equal(node.promptDraftText, 'Edited prompt');
    assert.equal(node.promptDraftHtml, 'Edited prompt');
    assert.equal(node.runSettings.videoDuration, 15);
    vm.runInContext('settings.videoDuration = 10; persistActiveSmartSettings();', sandbox);
    assert.equal(node.runSettings.videoDuration, 10);
    assert.equal(other.promptDraftText, 'Other prompt');
    assert.deepEqual(other.runSettings, {});
});

for (const withSettingsModule of [true, false]) {
    test(`Canvas Sync restores Agent settings (settings module: ${withSettingsModule})`, () => {
        const {sandbox, node} = fixture();
        if (!withSettingsModule) delete sandbox.window.SmartCanvasModules.generationSettings;
        sandbox.canvasPersistenceAssignDocument({
            title:'Test', nodes:[structuredClone(node)], connections:[],
            settings:{engine:'api', apiKind:'image', model:'canvas-default'},
        }, {renderNow:false, adoptDocument:true});
        const restored = vm.runInContext('settings', sandbox);
        assert.equal(restored.apiKind, 'video');
        assert.equal(restored.videoDuration, 13);
    });
}

test('focused Agent Composer defers its own remote patch even if selection differs', () => {
    const {sandbox} = fixture();
    assert.equal(sandbox.canvasRealtimeApplierCanApplyDuringComposerFocus({nodeId:agentId}), false);
    assert.equal(sandbox.canvasRealtimeApplierCanApplyDuringComposerFocus({nodeId:'unrelated'}), true);
});

test('a deleted Agent Node cannot redirect submission to a prefix collision', async () => {
    const {sandbox, calls, node} = fixture(agentId, {prefixCollision:true});
    sandbox.nodes = sandbox.nodes.filter(value=>value !== node);
    assert.equal(await sandbox.submitComposerGeneration(), false);
    assert.deepEqual(calls, []);
});
