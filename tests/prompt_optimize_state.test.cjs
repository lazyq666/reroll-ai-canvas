const assert = require('node:assert/strict');
require('../static/js/smart-canvas/prompt-optimize.js');
const {createSession,instruction} = globalThis.SmartCanvasModules.promptOptimize;
const a = {key:'image:a',html:'Original prompt'};
const s = createSession();
const first = s.begin(a);
assert.equal(s.begin(a),null,'duplicate requests must be ignored');
assert.equal(s.finish(first,a,'Result A'),true);
assert.equal(s.begin({...a,html:'Result A'}),null,'same preset result must not be optimized twice');
const second = s.begin({...a,html:'Result A'},'visual');
assert.equal(second.source.html,a.html,'preset changes use the original source');
assert.equal(s.finish(second,{...a,html:'Result A'},'Result B'),true);
assert.equal(s.undo({...a,html:'Result B'}).html,a.html);
assert.equal(s.toggle(a).html,'Result B');
const restored=createSession(JSON.parse(JSON.stringify(s.record)));
assert.equal(restored.canUndo({...a,html:'Result B'}),true);
assert.equal(restored.toggle({...a,html:'Result B'}).html,a.html);
restored.leave();
assert.equal(restored.hasResult(a),true,'leaving a node keeps both variants');
s.edited();
const edited = {...a,html:'My changed result'};
const third = s.begin(edited);
assert.equal(third.source.html,edited.html);
s.edited();
assert.equal(s.finish(third,edited,'Stale result'),false,'edit and undo while pending still invalidate the request');
const fourth = s.begin(a);
assert.equal(s.finish(fourth,{...a,key:'image:b'},'Wrong node'),false);
const fifth = s.begin(a);s.fail(fifth);
assert.equal(s.pending,false);assert.equal(s.canUndo(a),false);
for(const media of ['image','video']) for(const preset of ['smart','preserve','visual']){
    const value = instruction({source:'sunset',media,preset,model:'custom-model'});
    assert.ok(value.includes('sunset')); assert.ok(value.includes('custom-model'));
}
assert.ok(instruction({source:'walk',media:'video',preset:'camera'}).includes('temporal'));
assert.throws(() => instruction({source:'x',media:'image',preset:'camera'}));
console.log('Prompt optimization state contracts passed');

assert.notEqual(instruction({source:'scene',media:'image'}),instruction({source:'scene',media:'video'}));
