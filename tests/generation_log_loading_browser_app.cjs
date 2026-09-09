// Real Smart Canvas with held history responses; no workspace or cloud writes.
// Run: node tests/generation_log_loading_browser_app.cjs
// stdin: hold | success | empty | error. Reload the page for a fresh history cache.
const readline = require('node:readline');
const {fixture, startServer, CANVAS_ID, json} = require('./generation_log_modal_browser_smoke.cjs');
const data = fixture();
let mode = 'hold';
let pending = [];
function respond(response){
    if(mode === 'error') return json(response, {detail:'Fixture history unavailable'}, 503);
    json(response, {logs:mode === 'empty' ? [] : data.logs, next_cursor:''});
}
data.respondLogs = (_request, response) => {
    console.log(`History request: ${mode}`);
    if(mode === 'hold') pending.push(response);
    else respond(response);
};
startServer(data).then(server => {
    console.log(`http://127.0.0.1:${server.address().port}/static/smart-canvas.html?id=${CANVAS_ID}`);
    readline.createInterface({input:process.stdin}).on('line', line => {
        if(!['hold', 'success', 'empty', 'error'].includes(line.trim())) return;
        mode = line.trim();
        if(mode !== 'hold'){
            pending.splice(0).forEach(respond);
        }
        console.log(`History mode: ${mode}`);
    });
});
