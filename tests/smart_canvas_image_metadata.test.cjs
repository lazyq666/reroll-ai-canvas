const assert = require('node:assert/strict');
const {test} = require('node:test');
const metadata = require('../static/js/smart-canvas/image-metadata.js');

test('recognizable exact ratios win, including the conventional 21:9 spelling', () => {
    for(const [w,h,a,b] of [[1024,1024,1,1],[1536,1024,3,2],[2100,900,21,9],[900,2100,9,21],[1200,1000,6,5],[1344,768,7,4],[1900,1700,19,17]]){
        assert.deepEqual(metadata.aspectRatio(w,h), {width:a,height:b,approximate:false});
    }
});

test('images within 1% use a standard ratio without an approximation marker', () => {
    for(const [w,h,a,b] of [[1000,667,3,2],[1920,1088,16,9],[1366,768,16,9],[1024,1023,1,1]]){
        const ratio = metadata.aspectRatio(w,h);
        assert.equal(ratio.approximate, false);
        assert.deepEqual([ratio.width,ratio.height], [a,b]);
    }
});

test('images outside the 1% tolerance use a marked short decimal', () => {
    for(const [w,h,a,b] of [[1024,600,1.71,1],[2560,1080,2.37,1]]){
        assert.deepEqual(metadata.aspectRatio(w,h), {width:a,height:b,approximate:true});
    }
});

test('the inclusive 1% boundary is stable under rotation and scaling', () => {
    assert.deepEqual(metadata.aspectRatio(990,1000), {width:1,height:1,approximate:false});
    assert.deepEqual(metadata.aspectRatio(991,1000), {width:1,height:1,approximate:false});
    assert.deepEqual(metadata.aspectRatio(989,1000), {width:1,height:1.01,approximate:true});
    for(const [w,h] of [[990,1000],[989,1000],[1920,1088],[1024,600],[2560,1080]]){
        const original = metadata.aspectRatio(w,h);
        const rotated = metadata.aspectRatio(h,w);
        assert.deepEqual([rotated.width,rotated.height], [original.height,original.width]);
        assert.equal(rotated.approximate, original.approximate);
        assert.deepEqual(metadata.aspectRatio(w*4,h*4), original);
    }
});

test('dimensions are valid pixel pairs and never mix sources or use previews', () => {
    assert.deepEqual(metadata.dimensions({natural_w:1920,natural_h:1088,width:512,height:288}), {width:1920,height:1088});
    assert.deepEqual(metadata.dimensions({natural_w:1920,width:1000,height:667}), {width:1000,height:667});
    assert.deepEqual(metadata.dimensions({natural_w:Infinity,natural_h:500,w:'1200',h:'1000'}), {width:1200,height:1000});
    for(const image of [{natural_w:1920,height:1080},{layout_w:512,layout_h:288},{width:0,height:1024},{width:4.5,height:3},{width:true,height:100},null]){
        assert.equal(metadata.dimensions(image), null);
    }
    for(const value of [0,-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1,null,undefined,true,'']){
        assert.equal(metadata.aspectRatio(value,1000), null);
        assert.equal(metadata.aspectRatio(1000,value), null);
    }
});
