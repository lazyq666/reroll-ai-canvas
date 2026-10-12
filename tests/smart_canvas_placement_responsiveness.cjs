const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
if (process.argv.includes('--worker')) {
    const placement = require('../static/js/smart-canvas/node-placement.js');
    const nodes = Array.from({length:675}, (_, i) => ({
        id:`node-${i}`, type:'smart-image', x:1000+i*351, y:1000+i*277,
        w:280, h:220, images:[],
    }));
    const started = performance.now();
    const result = placement.plan({snapshot:{nodes,connections:[]},
        drafts:[{id:'new',type:'smart-image',w:280,h:220,images:[]}],
        intent:{anchor:{kind:'viewport',x:0,y:0},arrangement:'single'}});
    assert.ok(result.ok);
    assert.deepEqual(result.placements,[{id:'new',x:-140,y:-110}]);
    // Opening a legacy generated gallery also places several new outputs
    // beside an existing source, with an occupied preferred position.
    const source = {id:'source',type:'smart-image',x:0,y:0,w:280,h:220,images:[]};
    const blocker = {...source,id:'blocker',x:344};
    const snapshot = {nodes:[source,blocker,...nodes],connections:[]};
    const drafts = Array.from({length:7},(_,i)=>({...source,id:`output-${i}`}));
    const request = {snapshot,drafts,intent:{
        anchor:{kind:'source',sourceNodeId:source.id},relation:'downstream',
        arrangement:'vertical-batch',viewport:{x:0,y:0,width:1440,height:900},
    }};
    const batch = placement.plan(request);
    assert.ok(batch.ok);
    assert.equal(batch.placements.length,7);
    assert.deepEqual(placement.plan({...request,snapshot:{...snapshot,nodes:[...snapshot.nodes].reverse()}}),batch);
    const geometry = require('../static/js/smart-canvas/node-geometry.js');
    const boxes = geometry.createSession({nodes:[...snapshot.nodes,...drafts.map((draft,i)=>({...draft,...batch.placements[i]}))]});
    const occupied = snapshot.nodes.map(node=>boxes.measure(node.id).interactionFootprint);
    for(const item of batch.placements){
        const box = boxes.measure(item.id).interactionFootprint;
        assert.ok(item.x>=344,'outputs remain downstream of the source');
        assert.ok(!occupied.some(other=>box.x<other.x+other.width && box.x+box.width>other.x
            && box.y<other.y+other.height && box.y+box.height>other.y),'outputs retain obstacle clearance');
        occupied.push(box);
    }
    console.log(`675-node placement: ${Math.round(performance.now()-started)} ms`);
} else {
    const result = spawnSync(process.execPath,[__filename,'--worker'],{timeout:1500,encoding:'utf8'});
    assert.equal(result.error?.code,undefined,'Automatic placement during canvas opening blocks the main thread for over 1.5 seconds');
    assert.equal(result.status,0,result.stderr);
    process.stdout.write(result.stdout);
}
