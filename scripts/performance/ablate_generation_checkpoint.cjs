// Negative control: reuse the real text-generation/persistence test harness,
// remove only its save-confirmation guard, and require the unsafe attempt.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const root = path.resolve(__dirname, '../..');
process.chdir(root);
const filename = path.join(root, 'tests/smart_canvas_text_generation_sync_regression.cjs');
const fixture = fs.readFileSync(filename, 'utf8');
const start = fixture.indexOf('\n(async()=>{');
assert.ok(start > 0, 'The text-generation test harness must still have its test body');
const experiment = new Module(filename, module);
experiment.filename = filename;
experiment.paths = Module._nodeModulePaths(path.dirname(filename));
experiment._compile(fixture.slice(0, start) + `
(async()=>{
    dropReceipts=true;
    ownsEditor=true;
    sandbox.canvasPersistence={...persistence,synced:async()=>true};
    sandbox.generationRun={restoreActive:async()=>{}};
    sandbox.window.SmartCanvasModules.generationRecovery.resume=async()=>{};
    sandbox.generationRecovery=sandbox.window.SmartCanvasModules.generationRecovery;
    let unconfirmedSubmission=false;
    const checkedFetch=sandbox.fetch;
    sandbox.fetch=async()=>{
        unconfirmedSubmission=persistence.status().pending;
        return checkedFetch();
    };
    sandbox.nodes.push({id:'ablation-target',type:'smart-prompt',x:0,y:400,
        llmEnabled:true,llmInstruction:'Synthetic checkpoint experiment',
        llmProvider:'apimart',llmModel:'gemini-3.7-flash'});
    await assert.rejects(vm.runInContext(
        "runPromptLLMNode('ablation-target',{throwOnSubmissionFailure:true})",sandbox),
        error=>error.code==='ERR_ASSERTION' && unconfirmedSubmission===true);
    console.log(JSON.stringify({experiment:'remove_generation_checkpoint',
        submission_before_save_confirmed:unconfirmedSubmission,decision:'retain_checkpoint'}));
})().catch(error=>{console.error(error);process.exitCode=1;});
`, filename);
