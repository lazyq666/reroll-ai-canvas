const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let resources,language='zh';
const window={StudioI18n:{register:items=>{resources=items;},t:key=>resources[key][language]}};
const sandbox=vm.createContext({window});
for(const file of ['static/js/i18n/smart-canvas.js','static/js/smart-canvas/image-repair-presets.js']){
    vm.runInContext(fs.readFileSync(file,'utf8'),sandbox);
}
const presets=window.SmartCanvasModules.imageRepairPresets;
for(language of ['zh','en']){
    const current=presets.defaults('suffix');
    assert.ok(current.includes('precisely aligned with the source image'));
    assert.equal(presets.resolve({suffix:presets.defaults('legacySuffix')}).suffix,current);
    assert.equal(presets.resolve({suffix:'Custom alignment rule'}).suffix,'Custom alignment rule');
    assert.equal(presets.resolve({suffix:''}).suffix,'');
    assert.equal(presets.prompt({},'hand').split(current).length,2,'suffix is inserted exactly once');
}
console.log('PASS: aligned suffix upgrades only the old default and preserves custom or empty suffixes');
