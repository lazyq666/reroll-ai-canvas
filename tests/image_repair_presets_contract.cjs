const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let resources,language='zh';
const window={StudioI18n:{register:items=>{resources=items;},t:key=>resources[key][language]}};
const sandbox=vm.createContext({window});
for(const file of ['static/js/i18n/smart-canvas.js','static/js/smart-canvas/image-repair-presets.js']){
    vm.runInContext(fs.readFileSync(file,'utf8'),sandbox);
}
const presets=window.SmartCanvasModules.imageRepairPresets;
for(language of ['zh','en']){
    for(const key of ['hand','fingers','smearing']){
        const legacy='legacy'+key[0].toUpperCase()+key.slice(1);
        assert.notEqual(presets.defaults(key),presets.defaults(legacy));
        assert.equal(presets.resolve({[key]:presets.defaults(legacy)})[key],presets.defaults(key));
        assert.equal(presets.resolve({[key]:'Custom repair'})[key],'Custom repair');
        assert.equal(presets.resolve({[key]:''})[key],'');
    }
    const current=presets.defaults('suffix');
    assert.ok(current.includes('precisely aligned with the source image'));
    assert.equal(presets.resolve({suffix:presets.defaults('legacySuffix')}).suffix,current);
    assert.equal(presets.resolve({suffix:'Custom alignment rule'}).suffix,'Custom alignment rule');
    assert.equal(presets.resolve({suffix:''}).suffix,'');
    assert.equal(presets.prompt({},'hand').split(current).length,2,'suffix is inserted exactly once');
}
console.log('PASS: final repair prompts and aligned suffix upgrade only old defaults; custom and empty values survive in both languages');
