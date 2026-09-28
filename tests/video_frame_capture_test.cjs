const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname,'../static/js/smart-canvas/video-frame-capture.js'),'utf8');
const api = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
test('frame numbering is one-based and end time never exceeds total', async () => {
    const {frameMetrics} = await api;
    assert.deepEqual(frameMetrics({fps:24}, 15, 0), {fps:24,estimated:false,total:360,current:1});
    assert.equal(frameMetrics({fps:24}, 15, 1/24).current, 2);
    assert.equal(frameMetrics({fps:24}, 15, 15).current, 360);
    assert.equal(frameMetrics({fps:24}, 15, -1).current, 1);
    assert.equal(frameMetrics({fps:24}, 15, 99).current, 360);
});
test('unknown frame rate is explicitly estimated; fractional rate is preserved', async () => {
    const {frameMetrics} = await api;
    assert.equal(frameMetrics({}, 15).estimated,true);
    assert.equal(frameMetrics({fps:'invalid'},15).fps,30);
    assert.equal(frameMetrics({frame_rate:30000/1001},10).fps,30000/1001);
    assert.equal(frameMetrics({fps:24},72/24+.0000000001).total,72);
});
test('unknown and live durations do not expose an operable frame range', async () => {
    const {frameMetrics} = await api;
    for(const duration of [NaN,Infinity,0,-1]) assert.equal(frameMetrics({fps:24},duration).total,0);
});
