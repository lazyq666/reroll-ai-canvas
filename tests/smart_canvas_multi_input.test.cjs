const {test} = require('node:test');
const assert = require('node:assert/strict');
const planner = require('../static/js/smart-canvas/multi-input.js');
const image = (id,x=0,y=0) => ({id,type:'smart-image',x,y,width:100,height:100,images:[{url:'same.png'}]});
const options = (nodes,ids=nodes.map(node=>node.id)) => ({nodes,ids,measure:node=>node,mediaFor:node=>node.images || [],textFor:node=>node.text || '',running:node=>Boolean(node.running)});

test('visual rows ignore click order, small offsets, holes and language',()=>{
    const nodes = [image('D',300,246),image('B',300,8),image('A',0,0),image('C',0,240)];
    assert.deepEqual(planner.capture(options(nodes)).ids,['A','B','C','D']);
    assert.deepEqual(planner.capture(options(nodes.slice().reverse())).ids,['A','B','C','D']);
    assert.deepEqual(planner.visualOrder([image('b'),image('a')]),['a','b']);
});
test('row tolerance cannot chain two separate rows together',()=>{
    assert.deepEqual(planner.visualOrder([image('c',0,80),image('b',200,40),image('a',100,0)]),['a','b','c']);
});
test('mixed prompts work and unsupported, empty or running sources reject the whole selection',()=>{
    const nodes = [image('a'),{...image('p'),type:'smart-prompt',images:[],text:'Prompt'}];
    assert.equal(planner.capture(options(nodes)).ok,true);
    for(const [patch,reason] of [[{type:'smart-frame'},'unsupported'],[{text:''},'empty'],[{running:true},'running']]){
        assert.equal(planner.capture(options([nodes[0],{...nodes[1],...patch}])).reason,reason);
    }
});
test('group members normalize once but distinct identical media sources remain separate',()=>{
    const nodes = [image('a'),image('b'),{...image('g'),type:'smart-group',items:['a']}];
    assert.deepEqual(planner.capture(options(nodes)).ids,['b','g']);
    nodes[2].items.push('missing');
    assert.equal(planner.capture(options(nodes)).reason,'changed');
});
test('nested groups validate each distinct source once and exclude all members from targets',()=>{
    const nodes = [image('a'),{...image('inner'),type:'smart-group',items:['a']},{...image('outer'),type:'smart-group',items:['inner']}];
    const reads=[];
    const snapshot=planner.capture({...options(nodes),mediaFor:node=>{reads.push(node.id);return node.images;}});
    assert.deepEqual(snapshot.ids,['outer']);
    assert.deepEqual(snapshot.excludedIds.slice().sort(),['a','inner','outer']);
    assert.equal(new Set(reads).size,reads.length);
    nodes[1].items.push('outer');
    assert.equal(planner.capture(options(nodes)).reason,'unsupported');
});
test('moving sources preserves a captured order; changing output identity invalidates it',()=>{
    const nodes = [image('a'),image('b',200)];
    const snapshot = planner.capture(options(nodes));
    nodes[0].x=400;
    assert.deepEqual(planner.validate(snapshot,options(nodes)).ids,['a','b']);
    nodes[0].activeOutputId='new';
    assert.equal(planner.validate(snapshot,options(nodes)).reason,'changed');
});
test('target planning appends missing input connections and rejects cycles and self targets',()=>{
    const nodes = [image('a'),image('b',200),image('target')];
    const snapshot = planner.capture(options(nodes,['a','b']));
    const base = {snapshot,nodes,targetId:'target',running:()=>false,isGeneration:()=>true};
    assert.deepEqual(planner.target({...base,connections:[{from:'a',to:'target',kind:'input'}]}).ids,['b']);
    assert.equal(planner.target({...base,connections:[{from:'target',to:'a',kind:'input'}]}).reason,'cycle');
    assert.equal(planner.target({...base,targetId:'a'}).reason,'target');
    assert.equal(planner.target({...base,running:()=>true}).reason,'running');
});
