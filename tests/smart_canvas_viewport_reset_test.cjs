const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const host = fs.readFileSync(path.join(root, 'static/js/smart-canvas.js'), 'utf8');
const classes = new Set(['zoom-preview']);
const sandbox = {
    window:{SmartCanvasModules:{}, addEventListener(){}},
    nodes:[{id:'a', x:1000, y:2000, w:400, h:300}],
    selectedId:'a', selectedIds:['a'], selectedImage:{nodeId:'', index:-1},
    viewport:{x:0, y:0, scale:1}, zoomPreviewState:null,
    shell:{clientWidth:1200, clientHeight:800, style:{},
        classList:{remove(name){classes.delete(name);}},
        getBoundingClientRect(){return {left:0, top:0};}},
    world:{style:{setProperty(){}}, classList:{toggle(){}}},
    smartAnnotationStroke:null, minimap:null,
    nodeRect(node){return {x:node.x, y:node.y, width:node.w, height:node.h};},
    positionCanvasFloatingOverlays(){}, scheduleSmartAdaptiveImageResolution(){},
    console, Set,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'static/js/smart-canvas/viewport-selection.js'), 'utf8'), sandbox);
vm.runInContext(
    host.slice(host.indexOf('function safeScale('), host.indexOf('function nodeScale('))
    + host.slice(host.indexOf('function applySmartCanvasViewportZoom('), host.indexOf('function smartCanvasKeyboardZoomDirection(')), sandbox);
const camera = sandbox.window.SmartCanvasModules.viewportSelection.viewport;
for (let i=0; i<1000; i++) sandbox.applySmartCanvasViewportZoom(1.4);
assert.equal(sandbox.viewport.scale, 8, 'Repeated zoom in stops at 800%');
sandbox.applySmartCanvasViewportZoom(1/1.4);
assert.ok(sandbox.viewport.scale < 8, 'Zoom reverses immediately at maximum');
const anchorX = (600 - sandbox.viewport.x) / sandbox.viewport.scale;
for (let i=0; i<1000; i++) sandbox.applySmartCanvasViewportZoom(1/1.4);
assert.equal(sandbox.viewport.scale, .02, 'Repeated zoom out stops at 2%');
assert.ok(Math.abs((600-sandbox.viewport.x)/sandbox.viewport.scale-anchorX)<1e-6, 'Clamping preserves zoom anchor');
sandbox.applySmartCanvasViewportZoom(1.4);
assert.ok(sandbox.viewport.scale > .02, 'Zoom reverses immediately at minimum');
sandbox.viewport = {x:1e148, y:1e148, scale:1e-148};
camera.apply();
assert.deepEqual({...sandbox.viewport}, {x:600, y:400, scale:.02}, 'Recover corrupt offsets before spatial queries');
const originalNodes = JSON.stringify(sandbox.nodes);
sandbox.viewport = {x:1e148, y:1e148, scale:1e148};
sandbox.zoomPreviewState = {x:1e148, y:1e148, scale:1e148};
sandbox.shell.scrollLeft = 200;
sandbox.shell.scrollTop = 290;
camera.reset();
assert.equal(sandbox.shell.scrollLeft, 0);
assert.equal(sandbox.shell.scrollTop, 0);
assert.equal(sandbox.zoomPreviewState, null);
assert.equal(classes.has('zoom-preview'), false);
assert.ok(sandbox.viewport.scale > .2 && sandbox.viewport.scale <= .82);
assert.equal(sandbox.viewport.x + 1200*sandbox.viewport.scale, 600);
assert.equal(sandbox.viewport.y + 2150*sandbox.viewport.scale, 400);
assert.equal(JSON.stringify(sandbox.nodes), originalNodes, 'Reset does not edit nodes');
assert.equal(sandbox.selectedId, 'a', 'Reset preserves selection');
const resetState = JSON.stringify(sandbox.viewport);
camera.reset();
assert.equal(JSON.stringify(sandbox.viewport), resetState, 'Reset is repeatable');
sandbox.nodes = [];
camera.reset();
assert.deepEqual({...sandbox.viewport}, {x:600, y:400, scale:.45});
console.log('PASS: zoom limits, anchor, extreme viewport recovery, overview exit, selection preservation, empty canvas');
