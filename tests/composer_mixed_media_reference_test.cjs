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
    'smart.mediaNumber':'{kind}{count}', 'canvas.imageNumber':'图{number}'
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
assert.equal(result.prompt,'音频1 控制语速； 图1 控制村民； 图2 控制狼人； 视频1 控制镜头。');
assert.equal(result.mentioned,true);
const english = {
    ...translations,
    'smart.kindVideo':'Video', 'smart.kindAudio':'Audio',
    'smart.mediaNumber':'{kind} {count}', 'canvas.imageNumber':'Image {number}'
};
sandbox.tr = key => english[key] || key;
const englishPrompt = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({node:{id:'target'},defaultImages:refs}).prompt;
assert.equal(englishPrompt,'Audio 1 控制语速； Image 1 控制村民； Image 2 控制狼人； Video 1 控制镜头。');
sandbox.tr = key => translations[key] || key;

const mixedParts = promptInput.childNodes;
promptInput.childNodes = [
    {nodeType:3,textContent:'以 '},token(refs[1]),
    {nodeType:3,textContent:' 为底图，把 '},token(refs[2]),
    {nodeType:3,textContent:' 放在右侧。'}
];
for(const provider of [
    {provider_id:'custom-api',model:'gemini-3.1-flash-image'},
    {provider_id:'apimart',model:'gpt-image-2'},
    {provider_id:'apimart',model:'gpt-image-2.5-flare'}
]){
    const imageMode = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({
        node:{id:'target'},defaultImages:[refs[1],refs[2]],
        settings:{engine:'api',apiKind:'image',...provider}
    });
    assert.equal(imageMode.prompt,'以 图1 为底图，把 图2 放在右侧。');
    assert.deepEqual(Array.from(imageMode.refs,ref=>ref.inputInstanceId),['image-1','image-2']);
}
promptInput.childNodes = mixedParts;

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
assert.equal(firstLast.prompt,result.prompt);
assert.equal(firstLast.refs[1].role,'last_frame');

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
assert.equal(unmentioned.mentioned,false);
promptInput.childNodes = [token(duplicateA),{nodeType:3,textContent:' 旁边写上 @标题'}];
const literalAt = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({
    node:{id:'target'},defaultImages:[duplicateA],settings:dreaminaSettings
});
assert.equal(literalAt.prompt,'@图片1 旁边写上 @标题');
console.log('Composer mixed media references: PASS');

// H3 compiles only structured mentions for the selected workflow, with video
// soundtracks numbered before standalone audio. Ordinary API text is unchanged.
sandbox.smartComfyCapability = source => source.engine === 'comfy' && source.comfyWorkflow === 'H3.json' ? {adapter:'h3'} : null;
const h3Settings = {engine:'comfy',comfyMode:'custom',comfyWorkflow:'H3.json',comfyVideoAudio:{'instance|video':true}};
promptInput.childNodes = mixedParts;
const h3Node = {id:'h3',inputRefOrder:['instance|image-2','instance|video','instance|audio','instance|image-1']};
const h3 = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({node:h3Node,defaultImages:refs,settings:h3Settings});
assert.equal(h3.prompt,'<Audio 2> 控制语速； <Picture 2> 控制村民； <Picture 1> 控制狼人； <Video 1> 控制镜头。');
assert.deepEqual(Array.from(h3.refs,ref=>ref.inputInstanceId),['image-2','video','audio','image-1']);
assert.equal(h3.refs.find(ref=>ref.kind==='video').include_audio,true);
assert.equal(h3.displayPrompt,dreamina.displayPrompt);
sandbox.tr = key => english[key] || key;
const h3English = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({node:h3Node,defaultImages:refs,settings:h3Settings});
assert.equal(h3English.prompt,h3.prompt);
sandbox.tr = key => translations[key] || key;
const h3Muted = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({node:h3Node,defaultImages:refs,settings:{...h3Settings,comfyVideoAudio:{}}});
assert.ok(h3Muted.prompt.startsWith('<Audio 1>'));
const apiAfterH3 = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({node:{id:'target'},defaultImages:refs,settings:dreaminaSettings});
assert.equal(apiAfterH3.prompt,dreamina.prompt);
assert.ok(apiAfterH3.refs.every(ref=>!Object.hasOwn(ref,'include_audio')));
promptInput.childNodes = [token(duplicateB),{nodeType:3,textContent:' sees '},token(duplicateA),{nodeType:3,textContent:' and literal 图1'}];
const h3Duplicates = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({node:{id:'duplicates'},defaultImages:[duplicateA,duplicateB],settings:h3Settings});
assert.equal(h3Duplicates.prompt,'<Picture 2> sees <Picture 1> and literal 图1');
assert.deepEqual(Array.from(h3Duplicates.refs,ref=>ref.inputInstanceId),['first','second']);
console.log('H3 reference ordering and API isolation: PASS');

// Removing a referenced instance is caught for H3 before dispatch.
sandbox.blockedInputRefKeys = () => new Set(['instance|second']);
const h3Missing = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({node:{id:'deleted'},defaultImages:[duplicateA,duplicateB],settings:h3Settings});
assert.equal(h3Missing.validationErrors[0],'smart.workflowErrorPromptReference');
assert.deepEqual(Array.from(h3Missing.refs,ref=>ref.inputInstanceId),['first']);


// Duplicate video URLs are independent instances. Reordering or deleting one
// cannot move its original-audio choice to another instance or stale the labels.
sandbox.blockedInputRefKeys = () => new Set();
const videoA={url:'same.mp4',name:'same.mp4',kind:'video',inputInstanceId:'video-a'};
const videoB={...videoA,inputInstanceId:'video-b'};
const audioA={url:'same.wav',name:'same.wav',kind:'audio',inputInstanceId:'audio-a'};
const audioB={...audioA,inputInstanceId:'audio-b'};
const duplicateMedia=[videoA,videoB,audioA,audioB];
promptInput.childNodes=duplicateMedia.flatMap((ref,index)=>[...(index ? [{nodeType:3,textContent:' / '}] : []),token(ref)]);
for(const [selected,expected] of [
  [[], '<Video 1> / <Video 2> / <Audio 1> / <Audio 2>'],
  [['video-b'], '<Video 1> / <Video 2> / <Audio 2> / <Audio 3>'],
  [['video-a','video-b'], '<Video 1> / <Video 2> / <Audio 3> / <Audio 4>']
]){
  const source={...h3Settings,comfyVideoAudio:Object.fromEntries(selected.map(id=>[`instance|${id}`,true]))};
  const ordered=sandbox.window.SmartCanvasModules.promptAuthoring.resolve({node:{id:'media'},defaultImages:duplicateMedia,settings:source});
  assert.equal(ordered.prompt,expected);
  const reversed=sandbox.window.SmartCanvasModules.promptAuthoring.resolve({
    node:{id:'media',inputRefOrder:['instance|audio-b','instance|video-b','instance|audio-a','instance|video-a']},
    defaultImages:duplicateMedia,settings:source
  });
  assert.equal(reversed.prompt,`<Video 2> / <Video 1> / <Audio ${selected.length+2}> / <Audio ${selected.length+1}>`);
  assert.deepEqual(Array.from(reversed.refs.filter(ref=>ref.kind==='video'),ref=>[ref.inputInstanceId,ref.include_audio]),
    [['video-b',selected.includes('video-b')],['video-a',selected.includes('video-a')]]);
}
sandbox.blockedInputRefKeys=()=>new Set(['instance|video-b']);
promptInput.childNodes=[token(videoA),{nodeType:3,textContent:' with '},token(audioA)];
const deletedAudio=sandbox.window.SmartCanvasModules.promptAuthoring.resolve({
  node:{id:'media'},defaultImages:duplicateMedia,
  settings:{...h3Settings,comfyVideoAudio:{'instance|video-b':true}}
});
assert.equal(deletedAudio.prompt,'<Video 1> with <Audio 1>');
assert.equal(deletedAudio.validationErrors.length,0);
assert.equal(deletedAudio.refs.find(ref=>ref.kind==='video').include_audio,false);
console.log('H3 duplicate video/audio instance boundaries: PASS');
