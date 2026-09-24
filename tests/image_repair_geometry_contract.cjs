const assert = require('node:assert/strict');
require('../static/js/smart-canvas/image-repair-geometry.js');
const geometry = globalThis.SmartCanvasModules.imageRepairGeometry;
const models = [
    {id:'other',name:'Other',model:'other'},
    {id:'gpt2',name:'GPT Image 2',model:'gpt-image-2'},
    {id:'flagship',name:'gpt-image-2.5-suburst(旗舰)',model:'custom-route'},
];
assert.equal(geometry.preferredModel(models).id,'flagship');
assert.equal(geometry.preferredModel(models.slice(0,2)).id,'gpt2');
assert.equal(geometry.preferredModel([{id:'id-only',model:'prefix-GPT-IMAGE-2.5-SUBURST'}]).id,'id-only');
assert.equal(geometry.preferredModel([]),null);
for(const region of [
    {x:420,y:220,width:120,height:120},
    {x:0,y:0,width:20,height:30},
    {x:950,y:750,width:50,height:50},
    {x:0,y:0,width:1000,height:800},
]){
    const box=geometry.crop(region,1000,800,['1:1','4:3','3:4','16:9']);
    const [w,h]=box.ratio.split(':').map(Number);
    assert.equal(box.width*h,box.height*w);
    assert.ok(box.x<=region.x && box.y<=region.y);
    assert.ok(box.x+box.width>=region.x+region.width && box.y+box.height>=region.y+region.height);
}
assert.equal(geometry.crop({x:100,y:100,width:100,height:50},1000,800,['1:1','16:9'],'16:9').ratio,'16:9');
assert.equal(geometry.nearestResolution({width:600,height:400},['1K','2K','4K']),'1K');
assert.equal(geometry.nearestResolution({width:1700,height:1200},['1K','2K','4K']),'2K');
assert.equal(geometry.nearestResolution({width:3200,height:2000},['1K','2K','4K']),'4K');
assert.equal(geometry.featherAlpha(20,20,5)[0],26);
assert.equal(geometry.featherAlpha(20,20,5)[10*20+10],255);
assert.equal(geometry.featherAlpha(20,20,0)[0],255);
assert.deepEqual(geometry.scaled({x:10,y:10,width:20,height:10},2),{x:0,y:5,width:40,height:20});
// Exercise the real transport normalizer: editable metadata must survive polling.
const fs=require('node:fs'),vm=require('node:vm');
const host=fs.readFileSync(require('node:path').join(__dirname,'../static/js/smart-canvas.js'),'utf8');
const sandbox={};vm.createContext(sandbox);
vm.runInContext(host.slice(host.indexOf('function resultMediaUrls('),host.indexOf('function mediaKindForUrls(')),sandbox);
const recipe={version:1,source:{url:'/assets/original.png'},patch:{url:'/assets/patch.png'}};
const result=sandbox.resultMediaUrls({image_items:[{url:'/assets/composite.png',local_repair:recipe}],images:['/assets/composite.png']});
assert.equal(result.length,1);
assert.equal(JSON.stringify(result[0].local_repair),JSON.stringify(recipe));
result[0].local_repair.source.url='changed';
assert.equal(recipe.source.url,'/assets/original.png');
console.log('Image repair geometry and result transport contract passed.');
