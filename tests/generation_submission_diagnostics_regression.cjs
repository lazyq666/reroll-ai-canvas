// Exercise the actual HTTP rejection -> Generation Run -> diagnostic chain.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const slice = (file, start, end) => {
    const source = fs.readFileSync(file, 'utf8');
    return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
};
let response;
const sandbox = {window:{SmartCanvasModules:{}}, tr:key=>key, Response,
    fetch:async()=>response};
vm.createContext(sandbox);
for(const name of ['model-capabilities','generation-failure-feedback','generation-provider']){
    vm.runInContext(fs.readFileSync(`static/js/smart-canvas/${name}.js`,'utf8'), sandbox);
}
vm.runInContext(slice('static/js/smart-canvas.js', 'async function smartResponseErrorMessage(', '\nfunction smartDropDataTypes('),sandbox);
vm.runInContext(slice('static/js/smart-canvas/generation-run.js', 'function generationRunFailureDetail(', '\nfunction generationRunNodeFailureFeedback('),sandbox);
(async()=>{
    for(const code of ['repair_invalid','repair_source_changed','repair_media_missing','repair_too_large','future_validation_code']){
        response = new Response(JSON.stringify({detail:{code}}), {status:422});
        let rejection;
        try { await vm.runInContext('generationProviderPostTask("/api/canvas-image-tasks",{})',sandbox); }
        catch(error){ rejection=error; }
        assert.ok(rejection);
        assert.notEqual(rejection.message,'smart.errRunFailed','structured rejection must not collapse into generic failure');
        sandbox.rejection=rejection;
        const detail=vm.runInContext('generationRunFailureDetail(rejection)',sandbox);
        assert.equal(detail.httpStatus,422);
        assert.equal(detail.errorCode,code);
        assert.equal(detail.category,'invalid_parameter');
    }
    response=new Response('Upstream unavailable',{status:503});
    await assert.rejects(vm.runInContext('generationProviderPostTask("/api/canvas-image-tasks",{})',sandbox),
        error=>error.status===503&&error.message==='Upstream unavailable');
    console.log('PASS: structured submission failures retain HTTP status, error code and reason');
})().catch(error=>{console.error(error);process.exitCode=1;});
