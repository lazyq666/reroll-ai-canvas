const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('static/js/batch-generation.js', 'utf8');
const start = source.indexOf('    async function openBatch(batchId)');
const end = source.indexOf('    function historyPromptSummary', start);
(async () => {
    let requestCount = 0, rendered = 0;
    const timers = [];
    const detail = {hidden:false};
    const box = {
        currentBatchId:'batch', batchPollTimer:null,
        $:()=>detail,
        fetchJson:async()=>{if(++requestCount===1) throw Error('temporary 503'); return {id:'batch'};},
        renderBatchDetail:()=>rendered++, console:{error(){}},
        setTimeout:fn=>{timers.push(fn); return timers.length;}, clearTimeout(){},
    };
    vm.createContext(box); vm.runInContext(source.slice(start,end),box);
    await box.openBatch('batch');
    assert.equal(timers.length,1,'A temporary failure must schedule another detail query');
    await timers.shift()();
    assert.equal(rendered,1);
    // Leaving the detail view must not let a stale retry reopen it.
    requestCount=0;
    await box.openBatch('batch');
    detail.hidden=true;
    await timers.shift()();
    assert.equal(requestCount,1);
    console.log('PASS: batch detail resumes after one failed query and stops when hidden');
})().catch(error=>{console.error(error);process.exitCode=1;});
