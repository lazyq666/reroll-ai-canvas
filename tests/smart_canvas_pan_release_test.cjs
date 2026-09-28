// LAZ-70: replay the release sequences observed on the production page in Chrome.
// Run: node --test tests/smart_canvas_pan_release_test.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../static/js/smart-canvas.js'), 'utf8');
function slice(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `Missing production seam: ${start}`);
    return source.slice(from, to);
}
function harness(tool = 'pointer', space = false) {
    const classes = new Set(), timers = [], listeners = {}, documentListeners = {};
    const noop = () => {};
    let saves = 0;
    const register = registry => (type, fn, capture = false) => {
        (registry[type] ||= []).push({fn, capture});
    };
    const ctx = {
        window: {addEventListener: register(listeners), SmartCanvasModules: {viewportSelection: {
            viewport: {screenToWorld: e => ({x: e.clientX, y: e.clientY}), apply: noop},
        }}},
        document: {hidden: false, addEventListener: register(documentListeners), body: {classList: {remove: noop}}},
        shell: {classList: {add: name => classes.add(name), remove: name => classes.delete(name)}},
        viewport: {x: 0, y: 0}, panState: null, didPan: false,
        smartMiddlePan: false, smartSpacePan: space,
        smartEffectiveTool: () => ctx.smartMiddlePan || ctx.smartSpacePan ? 'hand' : tool,
        smartCanvasChromeTarget: () => false,
        canvasInteraction: {active: () => false}, canvasPersistence: {schedule: () => saves++},
        smartAnnotationStroke: null, portDragState: null, connectionEraseState: null,
        selectionState: null, previewCompareDrag: false, panoramaState: {drag: null},
        previewPanDrag: null, imageEditPanDrag: null, cropDrag: null,
        llmInstructionResizeState: null, promptSplitResizeState: null,
        closeCreateMenu: noop, closeSmartNodeContextMenu: noop, refreshSmartAnnotationToolbar: noop,
        smartPlaybackPauseForInterruption: noop, hideSmartAnnotationCursor: noop,
        setTimeout: fn => timers.push(fn),
    };
    vm.createContext(ctx);
    vm.runInContext(
        slice('function beginSmartTemporaryPanPointer(event){', "shell.addEventListener('click',") + '\n' +
        slice('window.onmousemove = e => {', 'function smartModalOwnsWheel(){') + '\n' +
        slice("window.addEventListener('blur', () => {", "window.addEventListener('pagehide',"), ctx);
    const event = (overrides = {}) => ({button: 1, buttons: 4, clientX: 100, clientY: 100,
        target: {}, preventDefault: noop, stopPropagation: noop, stopImmediatePropagation: noop, ...overrides});
    function dispatch(type, overrides = {}, stoppedByChild = false) {
        const e = event(overrides);
        for (const {fn, capture} of listeners[type] || []) if (capture) fn(e);
        if (!stoppedByChild) {
            for (const {fn, capture} of listeners[type] || []) if (!capture) fn(e);
            ctx.window[`on${type}`]?.(e);
        }
    }
    function begin(button = 1) {
        ctx.beginSmartTemporaryPanPointer(event({button, buttons: button === 1 ? 4 : 1}));
        dispatch('mousemove', {clientX: 140, buttons: button === 1 ? 4 : 1});
        assert.equal(ctx.viewport.x, 40);
        assert.equal(ctx.didPan, true);
    }
    function assertEnded() {
        dispatch('mousemove', {clientX: 200, buttons: 0});
        assert.equal(ctx.viewport.x, 40, 'released mouse must not move the viewport');
        assert.equal(ctx.panState, null);
        assert.equal(ctx.smartMiddlePan, false);
        assert.equal(classes.has('panning'), false);
        assert.equal(saves, 1, 'finish and save exactly once');
    }
    return {ctx, event, dispatch, begin, assertEnded, timers, documentListeners};
}

test('ordinary middle release ends pan and suppresses the click until the next task', () => {
    const h = harness(); h.begin();
    h.dispatch('mouseup', {buttons: 0});
    h.assertEnded();
    assert.equal(h.ctx.didPan, true);
    h.timers.forEach(fn => fn());
    assert.equal(h.ctx.didPan, false);
});
test('disabled control sends pointerup without mouseup', () => {
    const h = harness(); h.begin();
    h.dispatch('pointerup', {buttons: 0, pointerType: 'mouse'});
    assert.equal(h.ctx.panState, null, 'pointerup must finish before any further movement');
    h.assertEnded();
});
for (const type of ['mousemove', 'pointermove']) test(`audio controls lose both release events: ${type} recovers before child stops propagation`, () => {
    const h = harness(); h.begin();
    h.dispatch(type, {clientX: 200, buttons: 0, pointerType: 'mouse'}, true);
    assert.equal(h.ctx.panState, null);
    h.assertEnded();
});
test('capture handles mouseup stopped by a child; duplicate releases are harmless', () => {
    const h = harness(); h.begin();
    h.dispatch('mouseup', {buttons: 0}, true);
    assert.equal(h.ctx.panState, null);
    h.dispatch('pointerup', {buttons: 0, pointerType: 'mouse'});
    h.dispatch('mouseup', {buttons: 0});
    h.assertEnded();
});
for (const setup of [{tool: 'hand', space: false}, {tool: 'pointer', space: true}]) {
    test(`${setup.space ? 'space' : 'hand'} left drag recovers when release is lost`, () => {
        const h = harness(setup.tool, setup.space); h.begin(0);
        h.dispatch('mousemove', {clientX: 200, buttons: 0});
        h.assertEnded();
        assert.equal(h.ctx.smartSpacePan, setup.space, 'held space remains a temporary tool');
    });
}
test('chord release does not end a pan while its initiating button is held', () => {
    const h = harness(); h.begin();
    h.dispatch('mouseup', {button: 0, buttons: 4});
    assert.ok(h.ctx.panState);
    h.dispatch('mousemove', {clientX: 150, buttons: 6});
    assert.equal(h.ctx.viewport.x, 50);
    h.dispatch('mouseup', {button: 1, buttons: 2});
    assert.equal(h.ctx.panState, null);
});
test('additional button presses cannot replace the initiating button or pan origin', () => {
    const h = harness(); h.begin();
    const original = h.ctx.panState;
    h.ctx.beginSmartTemporaryPanPointer(h.event({button: 0, buttons: 5, clientX: 140}));
    assert.equal(h.ctx.panState, original);
    h.dispatch('mouseup', {button: 0, buttons: 4});
    assert.equal(h.ctx.panState, original);
    h.dispatch('mouseup', {buttons: 0}); h.assertEnded();
});
test('hand drag ends when left is released even if middle remains held', () => {
    const h = harness('hand'); h.begin(0);
    h.ctx.beginSmartTemporaryPanPointer(h.event({button: 1, buttons: 5}));
    h.dispatch('mouseup', {button: 0, buttons: 4});
    assert.equal(h.ctx.panState, null);
    h.assertEnded();
});
test('touch events do not cancel a mouse pan; mouse cancellation does', () => {
    const h = harness(); h.begin();
    for (const type of ['pointerup', 'pointercancel', 'pointermove']) {
        h.dispatch(type, {pointerType: 'touch', button: 0, buttons: 0});
        assert.ok(h.ctx.panState);
    }
    h.dispatch('pointercancel', {pointerType: 'mouse', buttons: 0});
    assert.equal(h.ctx.panState, null);
    h.assertEnded();
});
for (const interruption of ['blur', 'hidden']) test(`${interruption} clears pan and temporary tool`, () => {
    const h = harness('pointer', true); h.begin();
    if (interruption === 'blur') h.dispatch('blur');
    else {
        h.ctx.document.hidden = true;
        h.documentListeners.visibilitychange.forEach(({fn}) => fn());
    }
    h.assertEnded();
    assert.equal(h.ctx.smartSpacePan, false);
});
test('ordinary pointer left drag does not start viewport pan', () => {
    const h = harness();
    h.ctx.beginSmartTemporaryPanPointer(h.event({button: 0, buttons: 1}));
    assert.equal(h.ctx.panState, null);
});
