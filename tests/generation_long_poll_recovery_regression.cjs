const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('static/js/smart-canvas/generation-recovery.js','utf8');
const start=source.indexOf('async function generationRecoveryPollTask(');
const end=source.indexOf('\nfunction generationRecoveryRecordFailure',start);
let calls=0;
const box={generationRecoveryActiveTaskPolls:new Map(),generationRecoveryTaskStillPending:()=>true,
    generationRecoveryProjectImageProcessor(){},tr:key=>key,setTimeout:fn=>fn(),
    fetch:async()=>{
        calls++;
        if(calls===50) return {ok:false,status:503,text:async()=>'temporary cloud failure'};
        return {ok:true,json:async()=>({status:calls<52?'running':'succeeded',result:{images:['output.png']}})};
    }};
vm.createContext(box);vm.runInContext(source.slice(start,end),box);
box.generationRecoveryPollTask('run','node').then(value=>{
    assert.equal(value.task.status,'succeeded');assert.equal(calls,52);
    console.log('PASS: first transient error after 49 successful polls resumes the same task');
}).catch(error=>{console.error(error);process.exitCode=1;});
