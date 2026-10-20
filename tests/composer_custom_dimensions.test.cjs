const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('static/js/smart-canvas.js');
const noop = () => {};
const settle = () => new Promise(resolve => setImmediate(resolve));

function composer({cached=true}={}){
    const listeners = {};
    const picker = {dataset:{},addEventListener:(name,listener) => { listeners[name] = listener; }};
    const node = {id:'custom-dimensions-node'};
    const sandbox = {
        window:{SmartCanvasModules:{viewportSelection:{selection:{node:() => node}}}}, URLSearchParams,
        settings:{engine:'api',apiKind:'image',provider_id:'test',model:'custom-model',ratio:'wide',resolution:'2k',count:1},
        runBtn:{disabled:false,dataset:{}},composerSubmission:null,composerPromptOptimizer:null,
        generationRun:{status:() => ({loopRunning:false})},isSmartRunnableNode:() => true,isApiLikeEngine:() => true,
        tr:key => key,escapeAttr:String,escapeHtml:String,
        smartModelCatalog:() => ['custom-model','other-custom-model','preset-model'].map(model => ({id:model,model,provider_id:'test'})),
        smartImageCapabilityReferences:() => [],activeSettingsSubject:() => node,
        persistActiveSmartSettings:noop,rememberRecentSmartSettings:noop,normalizeSmartVideoModeSettings:noop,
        canvasPersistence:{schedule:noop},engineSelect:{},
        dynamicParams:{classList:{toggle:noop},querySelectorAll:selector => (
            selector === 'ic-generation-settings-picker[data-smart-generation-settings]' ? [picker] : []
        )},
        smartComposerSelectionValidationActive:() => true,smartComposerOwnedOverlayOpen:() => false,
        scheduleDynamicParamsRefresh:noop,openControlState:() => null,dynamicParamsScrollSnapshot:() => null,
        restoreOpenControl:noop,restoreDynamicParamsScroll:noop,updatePromptPlaceholder:noop,
        smartComfyOutputKind:() => '',clearVolcengineSelectionOutsideVolcengine:noop,syncApiKindToggleVisibility:noop,
        sanitizeSmartApiSelection:noop,normalizeApiSizeSettings:noop,
        renderCatalogModelControl:() => '',renderCountVisualControl:() => '',renderTransparentPngControl:() => '',
    };
    vm.createContext(sandbox);
    for(const file of ['static/js/image-dimensions.js','static/js/smart-canvas/image-capabilities.js']){
        vm.runInContext(read(file), sandbox);
    }
    // Exercise the real setting event, model switch, render, reconciliation and button update together.
    for(const [start,end] of [
        ['function smartImageCapabilitySelection(', 'function smartImageCapabilityReferences('],
        ['function smartCurrentImageCapability(', 'const pendingSmartImageCapabilityKeys'],
        ['const pendingSmartImageCapabilityKeys', 'function renderCountVisualControl('],
        ['function renderDynamicParams(', 'function renderApiVideoParams('],
        ['function setDynamicSetting(', 'async function loadConfig('],
        ['let smartImageCapabilityLoadSequence', 'let smartVideoCapabilityLoadSequence'],
        ['function syncRunButtonState(', 'function canvasImageDragPayload('],
    ]){
        const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
        assert.ok(from >= 0 && to > from, start);
        vm.runInContext(source.slice(from, to), sandbox);
    }
    const api = sandbox.window.SmartCanvasModules.imageCapabilities;
    const base = {...api.fallback(),known:true,model_capability:{}};
    const custom = {...base,supports_custom_resolution:true,custom_size_limits:{
        multiple:16,maximum_edge:3840,maximum_aspect:3,minimum_pixels:655360,maximum_pixels:8294400,
    }};
    const cache = vm.runInContext('smartImageCapabilityCache', sandbox);
    cache.set('test\u001fcustom-model', custom);
    cache.set('test\u001fother-custom-model', custom);
    let resolveCapability;
    const loaded = new Promise(resolve => { resolveCapability = resolve; });
    sandbox.window.SmartCanvasModules.modelCapabilities = {load:() => loaded};
    if(cached) cache.set('test\u001fpreset-model', {...base,supports_custom_resolution:false});
    sandbox.bindDynamicParams();
    const dimensions = (width,height) => listeners['ic-change']({
        stopPropagation:noop,detail:{field:'customSize',value:{width,height}},
    });
    return {sandbox,api,dimensions,load:(overrides={}) => resolveCapability({
        operation:'image.generate',media_contract:{...base,supports_custom_resolution:false},...overrides,
    })};
}

test('switching from invalid custom dimensions to a cached preset model enables generation', async () => {
    const {sandbox,api,dimensions} = composer();
    dimensions('4096','1024');
    assert.equal(sandbox.runBtn.disabled,true);
    sandbox.setDynamicSetting('modelChoice','preset-model');
    await settle();
    assert.equal(sandbox.settings.pixelWidth,'');
    assert.equal(sandbox.settings.pixelHeight,'');
    assert.equal(api.validate(sandbox.settings,{capability:sandbox.smartCurrentImageCapability()}).valid,true);
    assert.equal(sandbox.runBtn.disabled,false,'valid model settings must release the previous dimension error');
});

test('an uncached model refreshes generation after its capability arrives', async () => {
    const {sandbox,dimensions,load} = composer({cached:false});
    dimensions('4096','1024');
    sandbox.setDynamicSetting('modelChoice','preset-model');
    assert.equal(sandbox.runBtn.disabled,true,'unconfirmed custom dimensions remain blocked');
    load();
    await settle();
    assert.equal(sandbox.settings.pixelWidth,'');
    assert.equal(sandbox.runBtn.disabled,false);
});

test('another custom-size model keeps invalid dimensions blocked and allows correction or clearing', async () => {
    const {sandbox,dimensions} = composer();
    dimensions('4096','1024');
    sandbox.setDynamicSetting('modelChoice','other-custom-model');
    await settle();
    assert.equal(sandbox.settings.pixelWidth,'4096');
    assert.equal(sandbox.runBtn.disabled,true);
    dimensions('1920','1088');
    assert.equal(sandbox.runBtn.disabled,false);
    dimensions('1920','');
    assert.equal(sandbox.runBtn.disabled,true);
    dimensions('','');
    assert.equal(sandbox.runBtn.disabled,false);
});

test('model reconciliation cannot unlock a submission in progress', async () => {
    const {sandbox,dimensions} = composer();
    dimensions('4096','1024');
    sandbox.composerSubmission = {nodeId:'custom-dimensions-node'};
    sandbox.syncRunButtonState();
    sandbox.setDynamicSetting('modelChoice','preset-model');
    await settle();
    assert.equal(sandbox.settings.pixelWidth,'');
    assert.equal(sandbox.runBtn.disabled,true);
    assert.equal(sandbox.runBtn.loading,true);
});

test('a render deferred by an open settings popover refreshes the button when it resumes', async () => {
    const {sandbox,dimensions} = composer();
    dimensions('4096','1024');
    sandbox.smartComposerOwnedOverlayOpen = () => true;
    sandbox.setDynamicSetting('modelChoice','preset-model');
    await settle();
    sandbox.smartComposerOwnedOverlayOpen = () => false;
    sandbox.renderDynamicParams();
    assert.equal(sandbox.runBtn.disabled,false);
});


test('published unified capability clears hidden dimensions even when the legacy known flag is false', async () => {
    const {sandbox,api,dimensions,load} = composer({cached:false});
    dimensions('1920','656');
    sandbox.setDynamicSetting('modelChoice','preset-model');
    assert.equal(sandbox.runBtn.disabled,true);
    load({catalog_revision:'published-revision',support_state:'supported',media_contract:{
        ...api.fallback('test','preset-model'),known:false,supports_custom_resolution:false,
    }});
    await settle();
    assert.equal(sandbox.settings.pixelWidth,'','hidden dimensions must be reconciled against the published contract');
    assert.equal(sandbox.settings.pixelHeight,'');
    assert.equal(sandbox.settings.ratio,'wide');
    assert.equal(sandbox.settings.resolution,'2k');
    assert.equal(api.resolveForSubmission(sandbox.settings,[],sandbox.smartCurrentImageCapability()).valid,true);
    assert.equal(sandbox.runBtn.disabled,false);
});

test('a failed unified capability load preserves dimensions until the model can be confirmed', async () => {
    const {sandbox,api,dimensions,load} = composer({cached:false});
    dimensions('1920','656');
    sandbox.setDynamicSetting('modelChoice','preset-model');
    load({catalog_revision:'',support_state:'unknown',media_contract:api.fallback('test','preset-model')});
    await settle();
    assert.equal(sandbox.settings.pixelWidth,'1920');
    assert.equal(sandbox.settings.pixelHeight,'656');
    assert.equal(sandbox.runBtn.disabled,true);
});

test('opening a saved node reconciles inherited dimensions without requiring a model change', async () => {
    const {sandbox,api,load} = composer({cached:false});
    load({catalog_revision:'published-revision',support_state:'supported',media_contract:{
        ...api.fallback('test','preset-model'),supports_custom_resolution:false,
    }});
    await api.load('test','preset-model');
    Object.assign(sandbox.settings,{model:'preset-model',pixelWidth:'1920',pixelHeight:'656'});
    sandbox.syncRunButtonState();
    assert.equal(sandbox.runBtn.disabled,true);
    sandbox.renderDynamicParams();
    assert.equal(sandbox.settings.pixelWidth,'');
    assert.equal(sandbox.settings.pixelHeight,'');
    assert.equal(sandbox.runBtn.disabled,false);
});
