const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const refs = [
    {url:'voice.mp3',name:'voice.mp3',kind:'audio',inputInstanceId:'audio'},
    {url:'villager.jpg',name:'villager.jpg',kind:'image',inputInstanceId:'image-1'},
    {url:'wolf.jpg',name:'wolf.jpg',kind:'image',inputInstanceId:'image-2'},
    {url:'scene.mp4',name:'scene.mp4',kind:'video',inputInstanceId:'video'}
];
const token = ref => ({
    nodeType:1,
    classList:{contains:name=>name === 'mention-image-token'},
    dataset:{url:ref.url,name:ref.name,kind:ref.kind,inputInstanceId:ref.inputInstanceId}
});
const promptInput = {childNodes:[
    token(refs[0]), {nodeType:3,textContent:' 控制语速； '},
    token(refs[1]), {nodeType:3,textContent:' 控制村民； '},
    token(refs[2]), {nodeType:3,textContent:' 控制狼人； '},
    token(refs[3]), {nodeType:3,textContent:' 控制镜头。'}
]};
const key = ref => `instance|${ref.inputInstanceId}`;
const translations = {
    'smart.kindImage':'图片', 'smart.kindVideo':'视频', 'smart.kindAudio':'音频',
    'smart.mediaNumber':'{kind}{count}', 'canvas.imageNumber':'图{number}',
    'smart.referenceMapLine':'{label}：{name}',
    'smart.refMapHeader':'参考素材：', 'smart.refUserNeed':'用户需求：'
};
const sandbox = {
    window:{SmartCanvasModules:{smartContainer:{isGroup:()=>false}}},
    Node:{TEXT_NODE:3,ELEMENT_NODE:1}, promptInput, settings:{engine:'api',apiKind:'video'},
    blockedInputRefKeys:()=>new Set(), inputRefKey:key,
    uniqueReferenceImages:items=>{
        const seen=new Set();
        return items.filter(item=>{
            const identity=key(item);
            if(seen.has(identity)) return false;
            seen.add(identity);
            return true;
        });
    },
    composerTextReferenceNodesFor:()=>[], textForNode:()=>'',
    mediaKindForItem:ref=>ref.kind || 'image', tr:key=>translations[key] || key
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/js/smart-canvas/prompt-authoring.js'),'utf8'),sandbox);
const result = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({node:{id:'target'},defaultImages:refs});
assert.deepEqual(Array.from(result.refs,ref=>ref.kind),['audio','image','image','video']);
assert.equal(result.prompt,[
    '参考素材：',
    '图1：villager.jpg',
    '图2：wolf.jpg',
    '视频1：scene.mp4',
    '音频1：voice.mp3',
    '',
    '用户需求：',
    '音频1 控制语速； 图1 控制村民； 图2 控制狼人； 视频1 控制镜头。'
].join('\n'));
const english = {
    ...translations,
    'smart.kindVideo':'Video', 'smart.kindAudio':'Audio',
    'smart.mediaNumber':'{kind} {count}', 'canvas.imageNumber':'Image {number}',
    'smart.referenceMapLine':'{label}: {name}',
    'smart.refMapHeader':'References:', 'smart.refUserNeed':'User request:'
};
sandbox.tr = key => english[key] || key;
const englishPrompt = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({node:{id:'target'},defaultImages:refs}).prompt;
assert.match(englishPrompt,/^References:\nImage 1: villager\.jpg\nImage 2: wolf\.jpg\nVideo 1: scene\.mp4\nAudio 1: voice\.mp3\n/);
assert.match(englishPrompt,/Audio 1 控制语速； Image 1 控制村民； Image 2 控制狼人； Video 1 控制镜头。$/);

const dreaminaSettings = {
    engine:'api',apiKind:'video',videoProvider:'jimeng',
    videoReferenceMode:'multimodal_all_around',videoUseFrameRoles:false
};
const dreamina = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({
    node:{id:'target'},defaultImages:refs,settings:dreaminaSettings
});
assert.equal(dreamina.prompt,
    '@音频1 控制语速； @图片1 控制村民； @图片2 控制狼人； @视频1 控制镜头。');
assert.equal(dreamina.displayPrompt,
    '@voice.mp3 控制语速； @villager.jpg 控制村民； @wolf.jpg 控制狼人； @scene.mp4 控制镜头。');
assert.deepEqual(Array.from(dreamina.refs,ref=>ref.inputInstanceId),['audio','image-1','image-2','video']);

const firstLast = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({
    node:{id:'target'},defaultImages:refs,
    settings:{...dreaminaSettings,videoReferenceMode:'first_last_frames',videoUseFrameRoles:true}
});
assert.match(firstLast.prompt,/^References:\n/);

const duplicateA = {url:'shared.jpg',name:'same.jpg',kind:'image',inputInstanceId:'first'};
const duplicateB = {url:'shared.jpg',name:'same.jpg',kind:'image',inputInstanceId:'second'};
promptInput.childNodes = [token(duplicateB),{nodeType:3,textContent:' 追赶 '},token(duplicateA)];
const reordered = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({
    node:{id:'target'},defaultImages:[duplicateA,duplicateB],settings:dreaminaSettings
});
assert.equal(reordered.prompt,'@图片2 追赶 @图片1');
assert.deepEqual(Array.from(reordered.refs,ref=>ref.inputInstanceId),['first','second']);

promptInput.childNodes = [{nodeType:3,textContent:'村民在雨中奔跑。'}];
const unmentioned = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({
    node:{id:'target'},defaultImages:[duplicateA],settings:dreaminaSettings
});
assert.equal(unmentioned.prompt,'村民在雨中奔跑。');
promptInput.childNodes = [token(duplicateA),{nodeType:3,textContent:' 旁边写上 @标题'}];
const literalAt = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({
    node:{id:'target'},defaultImages:[duplicateA],settings:dreaminaSettings
});
assert.equal(literalAt.prompt,'@图片1 旁边写上 @标题');
console.log('Composer mixed media references: PASS');
