const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/js/smart-canvas.js','utf8');
function functionSource(name) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\n}',start) + 2;
    assert.ok(start>=0 && end>start);
    return source.slice(start,end);
}
test('generated remote video uses the same application proxy as video playback', async () => {
    const remote='https://media.example.invalid/generated.mp4';
    const ctx = {
        videoGifPending:new Set(), render(){}, toast(){}, tr:key=>key,
        smartOriginalMediaUrl:item=>typeof item==='string'?item:item.url,
        fileNameFromUrl:url=>url.split('/').pop(),
        publishGifResult:async()=>{},
        loadVideoGif:async()=>({createVideoGif:async ({sourceUrl})=>{
            if(sourceUrl===remote) throw new Error('GIF 合成失败，请减少原图尺寸后重试。');
            assert.ok(sourceUrl.startsWith('/api/download-output?inline=1&'));
            assert.equal(new URL(sourceUrl,'http://localhost').searchParams.get('url'),remote);
            return {};
        }}),
    };
    vm.createContext(ctx);
    for(const name of ['localDisplayUrlForMediaItem','imageForDisplay','proxiedMediaUrl','displayMediaUrl']) vm.runInContext(functionSource(name),ctx);
    vm.runInContext('async '+functionSource('convertSmartVideoToGif').replace(/import\([^)]*\)/,'loadVideoGif()'),ctx);
    await ctx.convertSmartVideoToGif({id:'test-generated-video',images:[{url:remote,kind:'video'}]},0);
    assert.equal(ctx.videoGifPending.size,0);
});
