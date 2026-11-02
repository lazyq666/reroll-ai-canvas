const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {test} = require('node:test');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(execFileSync(process.env.PYTHON || 'python3',
    ['tests/canvas_noop_ack_fixture.py'], {cwd:root, encoding:'utf8'}));
const source = fs.readFileSync(path.join(root, 'static/js/smart-canvas/canvas-persistence.js'), 'utf8');

function harness() {
    const sent = [], closes = [], history = [], timers = [];
    const initial = structuredClone(fixture.snapshot.canvas);
    const socket = {readyState:1, send:value=>sent.push(JSON.parse(value)),
        close:(code, reason)=>closes.push({code, reason})};
    const context = vm.createContext({
        window:{WebSocket:{OPEN:1}, addEventListener(){},
            localStorage:{getItem:()=>null, setItem(){}, removeItem(){}},
            SmartCanvasModules:{nodeGeometry:require('../static/js/smart-canvas/node-geometry.js'),
                canvasMutation:{history:value=>history.push(value)},
                generationRun:{resume(){}}, smartMatting:{resume(){}}}},
        document:{getElementById:()=>null, addEventListener(){}, activeElement:{matches:()=>false}},
        canvasId:'canvas-test', smartClientId:'fixture-client', canvas:initial, nodes:initial.nodes,
        settings:initial.settings, canvasDefaultSmartSettings:initial.settings, initialSmartSettings:{},
        selectionState:null, lastComposerNodeId:'', socket,
        normalizeLegacySmartNode:node=>({...node}), cloneSmartSettings:structuredClone,
        savePromptDraftForCurrent(){}, stripImageGenerationMeta:item=>({...item}),
        mediaItemForStorage:item=>({...item}), settingsForStorage:value=>({...value}),
        render(){}, scheduleConnectionLayerRefresh(){}, tr:key=>key, toast(){},
        setTimeout:fn=>(timers.push(fn), timers.length), clearTimeout(){},
        setInterval:()=>1, clearInterval(){}, Date, JSON, Promise,
    });
    vm.runInContext(source, context);
    vm.runInContext(`canvasPersistenceConfirmedDocument=canvasPersistenceCompactDocument(canvas);
        canvasPersistenceRevision=canvas.revision; canvasPersistenceStatusValue='ready';
        canvasPersistenceSocket=socket;`, context);
    const persistence = context.window.SmartCanvasModules.canvasPersistence;
    return {context, sent, closes, history, persistence,
        read:code=>vm.runInContext(code, context),
        receive(message) {
            context.message = structuredClone(message);
            return vm.runInContext('canvasPersistenceHandleSocketMessage({data:JSON.stringify(message)})', context);
        },
        send(operation=fixture.operation, {sealed=false, optimistic=true}={}) {
            context.operation = structuredClone(operation);
            context.options = {operationId:operation.operation_id, baseRevision:operation.base_revision, sealed, optimistic};
            vm.runInContext(`canvasPersistenceAssignDocument(canvasPersistenceApplyChanges(
                canvasPersistenceConfirmedDocument,operation.changes));
                canvasPersistenceSendOperation(operation.changes,options);`, context);
        },
    };
}

test('a real first no-op receipt completes once without closing, resending or adding undo', async () => {
    assert.equal(fixture.acknowledgement.changed, false);
    assert.equal(fixture.acknowledgement.duplicate, false);
    const h = harness(); h.send(); h.receive(fixture.acknowledgement);
    assert.deepEqual(h.closes, []);
    assert.equal(h.persistence.status().pending, false);
    h.receive(fixture.duplicate); h.receive(fixture.acknowledgement);
    await h.persistence.save();
    assert.equal(h.sent.length, 1);
    assert.equal(h.persistence.status().revision, 7);
    assert.deepEqual(h.history, []);
});

test('no-op receipts can wait between real revisions without creating a queued revision gap', () => {
    const h = harness(); h.send(fixture.queued_operation);
    h.persistence.hold({scope:'drag'});
    h.receive(fixture.remote8); h.receive(fixture.queued_acknowledgement);
    h.receive(fixture.queued_acknowledgement); // Replayed before the hold releases.
    h.receive(fixture.remote9);
    assert.deepEqual(h.closes, []);
    assert.equal(h.read('canvasPersistenceObservedRevision()'), 9);
    h.persistence.release({scope:'drag'});
    assert.deepEqual(h.closes, []);
    assert.equal(h.persistence.status().revision, 9);
    assert.equal(h.context.nodes[0].y, 22);
    assert.equal(h.persistence.status().pending, false);
    assert.equal(h.sent.length, 1);
});

for(const sealed of [false, true]) test(`no-op preserves and submits later edits (sealed=${sealed})`, () => {
    const h = harness(); h.send(fixture.operation, {sealed});
    h.context.nodes[0].x = 30;
    h.receive(fixture.acknowledgement);
    assert.deepEqual(h.closes, []);
    assert.equal(h.context.nodes[0].x, 30);
    assert.equal(h.sent.length, 2);
    const next = h.sent[1].operation;
    assert.notEqual(next.operation_id, fixture.operation.operation_id);
    assert.equal(next.base_revision, 7);
    assert.deepEqual(next.changes.node_updates, [{id:'a', path:['x'], value:30}]);
    h.receive({type:'canvas_mutation', operation_id:next.operation_id, revision:8,
        changes:next.changes, changed:true, undoable:true});
    assert.equal(h.persistence.status().pending, false);
    assert.equal(h.context.nodes[0].x, 30);
});

test('focused editing defers the no-op receipt and retains edits made while waiting', () => {
    const h = harness(); h.send();
    h.context.document.activeElement.matches = ()=>true;
    h.receive(fixture.acknowledgement);
    h.context.nodes[0].x = 35;
    assert.equal(h.persistence.status().pending, true);
    assert.deepEqual(h.closes, []);
    h.context.document.activeElement.matches = ()=>false;
    h.read('canvasPersistenceFlushQueuedMessages()');
    assert.equal(h.context.nodes[0].x, 35);
    assert.equal(h.sent.length, 2);
    assert.deepEqual(h.sent[1].operation.changes.node_updates, [{id:'a', path:['x'], value:35}]);
});

test('a reconnect snapshot supersedes buffered revisions and safely accepts a replayed no-op', () => {
    const h = harness(); h.send(); h.persistence.hold({scope:'drag'});
    h.receive(fixture.remote8);
    const snapshot = structuredClone(fixture.snapshot);
    snapshot.revision = snapshot.canvas.revision = 8;
    snapshot.canvas.nodes[0].y = 21;
    h.receive(snapshot);
    h.receive(fixture.duplicate);
    h.persistence.release({scope:'drag'});
    assert.deepEqual(h.closes, []);
    assert.equal(h.persistence.status().revision, 8);
    assert.equal(h.context.nodes[0].y, 21);
    assert.equal(h.persistence.status().pending, false);
    assert.equal(h.sent.length, 2, 'only the same operation is resent after reconnect');
    assert.equal(h.sent[1].operation.operation_id, fixture.operation.operation_id);
});

test('no-op handling does not acknowledge another operation or hide missing versions', () => {
    const h = harness(); h.send();
    h.receive({...fixture.acknowledgement, operation_id:'another-request'});
    assert.equal(h.read('canvasPersistenceInFlight.operation.operation_id'), fixture.operation.operation_id);
    h.receive({...fixture.acknowledgement, revision:9});
    assert.equal(h.closes.length, 1);
    assert.equal(h.closes[0].reason, 'resync:revision-gap');
    assert.equal(h.persistence.status().pending, true);
});

test('a refresh snapshot keeps newer buffered mutations that arrived after it was read', () => {
    const h = harness(); h.persistence.hold({scope:'drag'});
    h.receive(fixture.remote8); h.receive(fixture.remote9);
    const snapshot = structuredClone(fixture.snapshot);
    snapshot.revision = snapshot.canvas.revision = 8;
    snapshot.canvas.nodes[0].y = 21;
    h.receive(snapshot);
    h.persistence.release({scope:'drag'});
    assert.equal(h.context.nodes[0].y, 22);
    assert.equal(h.persistence.status().revision, 9);
    assert.deepEqual(h.closes, []);
});

test('a changed:false message carrying changes cannot silently bypass revision checks', () => {
    const h = harness(); h.send();
    h.receive({...fixture.acknowledgement, changes:fixture.remote8.changes});
    assert.equal(h.closes.length, 1);
    assert.equal(h.closes[0].reason, 'resync:invalid-message');
    assert.equal(h.context.nodes[0].y, 20);
    assert.equal(h.persistence.status().pending, true);
});

test('JSON object key order is irrelevant, but media array order and values still matter', async () => {
    const h = harness();
    h.context.nodes[0].images = [Object.fromEntries(Object.entries(h.context.nodes[0].images[0]).reverse())];
    await h.persistence.save();
    assert.equal(h.sent.length, 0, 'reordered media keys must not create an endless stream of equivalent saves');
    assert.equal(h.read('canvasPersistenceEqual([{a:1,b:2}], [{b:2,a:1}])'), true);
    assert.equal(h.read('canvasPersistenceEqual([1,2], [2,1])'), false);
    assert.equal(h.read('canvasPersistenceEqual({a:1}, {a:2})'), false);
});
