const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const host = fs.readFileSync(path.join(__dirname, '../static/js/smart-canvas.js'), 'utf8');
const source = host.slice(host.indexOf('async function openSmartCanvasLog'), host.indexOf('\nlet smartCanvasTaskDialogController'));
const loader = host.slice(host.indexOf('async function loadSmartCanvasLogs'), host.indexOf('\nfunction addSmartGenerationLog'));
const modal = fs.readFileSync(path.join(__dirname, '../static/js/smart-canvas/generation-log-modal.js'), 'utf8');
const feedback = fs.readFileSync(path.join(__dirname, '../static/js/smart-canvas/generation-failure-feedback.js'), 'utf8');
const messages = fs.readFileSync(path.join(__dirname, '../static/js/i18n/smart-canvas.js'), 'utf8');
function element(){
    return {innerHTML:'', attrs:{}, hidden:true, listeners:{},
        setAttribute(key, value){ this.attrs[key] = value; },
        addEventListener(key, callback){ this.listeners[key] = callback; },
        querySelector(){ return null; }, removeAttribute(){}};
}
function harness(){
    const index = element(), detail = element(), lightbox = element();
    lightbox.querySelector = () => element();
    const root = element();
    root.localName = 'ic-dialog';
    let opened = false, requests = [], focusCalls = 0, shows = 0;
    root.querySelector = key => ({'[data-generation-log-index]':index, '[data-generation-log-detail]':detail, '[data-generation-log-lightbox]':lightbox})[key];
    root.hasAttribute = () => opened;
    root.show = async () => { opened = true; shows++; };
    root.hide = async () => { opened = false; };
    const state = {
        canvas:{logs:[]}, canvasId:'fixture', smartCanvasLogsHydrated:false,
        smartCanvasLogLoadPromise:null, smartCanvasLogOpenSequence:0,
        console:{warn(){}}, document:{activeElement:null, addEventListener(){}},
        requestAnimationFrame(){ focusCalls++; },
        normalizePersistedSmartCanvasLog:log => log,
        fetch:() => new Promise(resolve => requests.push(resolve)),
        deactivateSmartAnnotationTool(){}, smartLogModal:root,
    };
    const translations = {};
    state.StudioI18n = {register:entries => Object.assign(translations, entries)};
    state.window = state;
    vm.createContext(state);
    vm.runInContext(modal, state);
    vm.runInContext(feedback, state);
    vm.runInContext(messages, state);
    let language = 'zh';
    state.smartGenerationLogModal = state.SmartCanvasModules.generationLogModal.create({
        root, getLogs:() => state.canvas.logs,
        failureFeedback:state.SmartCanvasModules.generationFailureFeedback,
        translate:key => translations?.[key]?.[language] || key,
        onRetry:(logId, runId) => state.openSmartCanvasLog(logId, runId),
    });
    vm.runInContext(loader + '\n' + source, state);
    return {state, root, index, detail, requests,
        opened:() => opened, shows:() => shows, focusCalls:() => focusCalls,
        language(value){ language = value; state.smartGenerationLogModal.render(); },
        complete(logs=[], ok=true){ requests.shift()({ok,status:ok ? 200 : 503,json:async () => ({logs})}); },
    };
}
const log = (id, runId=id) => ({id,runId,status:'success',createdAt:Date.now(),prompt:id});
(async () => {
    const h = harness();
    const opening = h.state.openSmartCanvasLog('', 'target-run');
    assert.equal(h.opened(), true, 'The dialog must open before history returns');
    assert.match(h.index.innerHTML, /ic-skeleton/);
    assert.match(h.detail.innerHTML, /ic-skeleton/);
    assert.equal(h.index.attrs['aria-busy'], 'true');
    h.language('en');
    assert.match(h.index.innerHTML, /Loading generation logs/);
    assert.match(h.index.innerHTML, /ic-skeleton/, 'Language switching must preserve loading');
    h.complete([log('first'), log('target', 'target-run')]);
    await opening;
    assert.match(h.detail.innerHTML, /data-log-id="target"/);
    assert.doesNotMatch(h.index.innerHTML, /ic-skeleton/);
    assert.equal(h.index.attrs['aria-busy'], 'false');
    await h.state.openSmartCanvasLog();
    assert.equal(h.requests.length, 0, 'Loaded history is reused');

    const closed = harness();
    const closingLoad = closed.state.openSmartCanvasLog();
    closed.state.closeSmartCanvasLog();
    closed.complete([log('late')]);
    await closingLoad;
    assert.equal(closed.opened(), false, 'Late history must not reopen a closed dialog');
    assert.equal(closed.shows(), 1);
    assert.equal(closed.focusCalls(), 0, 'Late history must not steal focus');

    const race = harness();
    const first = race.state.openSmartCanvasLog('first');
    race.state.closeSmartCanvasLog();
    const second = race.state.openSmartCanvasLog('second');
    assert.equal(race.requests.length, 1, 'Rapid reopening shares the pending request');
    race.complete([log('first'), log('second')]);
    await Promise.all([first, second]);
    assert.match(race.detail.innerHTML, /data-log-id="second"/);
    assert.equal(race.focusCalls(), 1);

    const failed = harness();
    const failure = failed.state.openSmartCanvasLog('target');
    failed.complete([], false);
    await failure;
    assert.match(failed.detail.innerHTML, /data-generation-log-retry/);
    assert.doesNotMatch(failed.detail.innerHTML, /canvas.noLogs|ic-skeleton/);
    assert.match(failed.detail.innerHTML, /生成日志加载失败/);
    failed.language('en');
    assert.match(failed.detail.innerHTML, /Couldn’t load generation logs/);
    assert.match(failed.detail.innerHTML, /data-generation-log-retry/);
    failed.root.listeners.click({target:{closest:key => key === '[data-generation-log-retry]'}});
    assert.match(failed.index.innerHTML, /ic-skeleton/);
    failed.complete([log('first'), log('target')]);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(failed.detail.innerHTML, /data-log-id="target"/);

    const empty = harness();
    const emptyLoad = empty.state.openSmartCanvasLog();
    empty.complete();
    await emptyLoad;
    assert.match(empty.detail.innerHTML, /generation-log-empty/);
    assert.doesNotMatch(empty.detail.innerHTML, /ic-skeleton|data-generation-log-retry/);

    // Real saved failures retain the classification from the older client.
    // New rules must be applied to that diagnostic when displaying history.
    const historical = harness();
    const historyLoad = historical.state.openSmartCanvasLog('old-layer-failure');
    historical.complete([{
        ...log('old-layer-failure'), status:'failed',
        errorDetail:{category:'unknown',titleKey:'smart.error.unknown.title',
            descriptionKey:'smart.error.unknown.description',actionKey:'smart.error.unknown.action',
            technicalError:'画布仍在同步，请稍后重试保存提示词'},
    }]);
    await historyLoad;
    assert.match(historical.index.innerHTML, /画布同步未完成/);
    assert.match(historical.detail.innerHTML, /本次生成请求未提交/);
    historical.language('en');
    assert.match(historical.index.innerHTML, /Canvas sync incomplete/);
    assert.match(historical.detail.innerHTML, /This generation request was not submitted/);
    historical.language('zh');
    assert.match(historical.detail.innerHTML, /画布仍在同步，请稍后重试保存提示词/);
    console.log('Generation log loading regression passed: immediate skeleton, selection, cache, close, reopen, failure/retry, empty, language rerender.');
})().catch(error => { console.error(error); process.exitCode = 1; });
