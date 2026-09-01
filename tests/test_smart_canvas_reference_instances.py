import json
import subprocess
import textwrap
import unittest
from pathlib import Path

from infinite_canvas.video_capabilities import VideoCapabilityRegistry


ROOT = Path(__file__).resolve().parents[1]
REFERENCE_MODULE = ROOT / "static/js/smart-canvas/reference-instances.js"
VIDEO_MODULE = ROOT / "static/js/smart-canvas/video-capabilities.js"
PROMPT_MODULE = ROOT / "static/js/smart-canvas/prompt-authoring.js"
PROVIDER_MODULE = ROOT / "static/js/smart-canvas/generation-provider.js"
HOST = ROOT / "static/js/smart-canvas.js"
CAPABILITIES = ROOT / "resources/video-model-capabilities.json"


class SmartCanvasReferenceInstanceTests(unittest.TestCase):
    def run_node(self, body: str, modules=()):
        sources = "\n".join(
            f"vm.runInContext(fs.readFileSync({json.dumps(str(path))}, 'utf8'), sandbox);"
            for path in modules
        )
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const sandbox = {{window:{{SmartCanvasModules:{{}}}}, URLSearchParams}};
            sandbox.globalThis = sandbox;
            vm.createContext(sandbox);
            {sources}
            {body}
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(0, result.returncode, result.stderr)
        return json.loads(result.stdout)

    def test_same_url_instances_remain_distinct_but_same_instance_is_idempotent(self):
        value = self.run_node(
            """
            const api = sandbox.window.SmartCanvasModules.referenceInstances;
            const first = {url:'same.png',outputId:'output-a'};
            const second = {url:'same.png',outputId:'output-b'};
            const manualA = api.manual({url:'same.png'});
            const manualB = api.manual({url:'same.png'});
            const unique = api.unique([first, first, second, manualA, manualA, manualB]);
            const afterRemovingA = unique.filter(ref => api.key(ref) !== api.key(manualA));
            process.stdout.write(JSON.stringify({
                keys:unique.map(api.key),
                manualIds:[manualA.inputInstanceId,manualB.inputInstanceId],
                remainingKeys:afterRemovingA.map(api.key)
            }));
            """,
            (REFERENCE_MODULE,),
        )
        self.assertEqual(4, len(value["keys"]))
        self.assertEqual(4, len(set(value["keys"])))
        self.assertNotEqual(*value["manualIds"])
        self.assertNotIn(f"instance|{value['manualIds'][0]}", value["remainingKeys"])
        self.assertIn(f"instance|{value['manualIds'][1]}", value["remainingKeys"])

    def test_prompt_mentions_map_equal_urls_by_instance_key(self):
        script = textwrap.dedent(
            """
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(__PROMPT_MODULE__, 'utf8');
            const token = (instanceId, name) => ({
                nodeType:1,
                classList:{contains:value => value === 'mention-image-token'},
                dataset:{kind:'image',url:'same.png',name,inputInstanceId:instanceId,imageIndex:'0'},
                tagName:'SPAN', childNodes:[]
            });
            const promptInput = {childNodes:[
                token('instance-a','甲'),
                {nodeType:3,textContent:' 和 '},
                token('instance-b','乙')
            ],innerHTML:''};
            const node = {id:'target'};
            const refs = [
                {url:'same.png',name:'甲',kind:'image',inputInstanceId:'instance-a'},
                {url:'same.png',name:'乙',kind:'image',inputInstanceId:'instance-b'}
            ];
            const key = ref => ref.inputInstanceId ? `instance|${ref.inputInstanceId}` : `url|${ref.url}`;
            const sandbox = {
                window:{SmartCanvasModules:{smartContainer:{isGroup:()=>false},viewportSelection:{selection:{node:()=>node}}}},
                Node:{TEXT_NODE:3,ELEMENT_NODE:1}, promptInput, nodes:[node], settings:{engine:'api'},
                blockedInputRefKeys:()=>new Set(), inputRefKey:key,
                uniqueReferenceImages:items => {const seen=new Set();return items.filter(item=>{const k=key(item);if(seen.has(k))return false;seen.add(k);return true;});},
                orderReferenceImagesForNode:(_node,items)=>items,
                defaultReferenceImagesFor:()=>refs, composerTextReferenceNodesFor:()=>[],
                textForNode:()=>'', mediaKindForItem:item=>item.kind||'image',
                rhDefaultPromptSuggestion:()=>'', tr:key=>key
            };
            vm.createContext(sandbox);
            vm.runInContext(source,sandbox);
            const result = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({node,defaultImages:refs});
            process.stdout.write(JSON.stringify({
                refs:result.refs.map(ref=>ref.inputInstanceId),
                prompt:result.prompt
            }));
            """
        ).replace("__PROMPT_MODULE__", json.dumps(str(PROMPT_MODULE)))
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(0, result.returncode, result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(["instance-a", "instance-b"], value["refs"])
        self.assertIn("图1 和 图2", value["prompt"])

    def test_deleted_source_is_not_restored_from_a_generation_snapshot(self):
        script = textwrap.dedent(
            """
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(__PROMPT_MODULE__, 'utf8');
            const node = {
                id:'video-target',
                runInputRefs:[
                    {url:'same.png',name:'节点 A',kind:'image',nodeId:'node-a',imageIndex:0,outputId:'output-a'},
                    {url:'same.png',name:'节点 B',kind:'image',nodeId:'node-b',imageIndex:0,outputId:'output-b'}
                ]
            };
            const liveA = {url:'same.png',name:'节点 A',kind:'image',nodeId:'node-a',imageIndex:0,outputId:'output-a'};
            const key = ref => ref.outputId ? `output|${ref.outputId}` : `url|${ref.url}`;
            const sandbox = {
                window:{SmartCanvasModules:{smartContainer:{isGroup:()=>false},viewportSelection:{selection:{node:()=>node}}}},
                Node:{TEXT_NODE:3,ELEMENT_NODE:1}, promptInput:{childNodes:[],innerHTML:''},
                nodes:[node,{id:'node-a'}], settings:{engine:'api',apiKind:'video',videoUseFrameRoles:true},
                blockedInputRefKeys:()=>new Set(), inputRefKey:key,
                uniqueReferenceImages:items => {const seen=new Set();return items.filter(item=>{const k=key(item);if(seen.has(k))return false;seen.add(k);return true;});},
                orderReferenceImagesForNode:(_node,items)=>items,
                activeInputImagesFor:()=>[liveA], manualReferenceImagesFor:()=>[],
                defaultReferenceImagesFor:()=>[liveA], composerTextReferenceNodesFor:()=>[],
                textForNode:()=>'', mediaKindForItem:item=>item.kind||'image',
                rhDefaultPromptSuggestion:()=>'', tr:key=>key
            };
            vm.createContext(sandbox);
            vm.runInContext(source,sandbox);
            const result = sandbox.window.SmartCanvasModules.promptAuthoring.resolve({node});
            process.stdout.write(JSON.stringify(result.refs.map(ref => ({
                nodeId:ref.nodeId,
                outputId:ref.outputId,
                role:ref.role
            }))));
            """
        ).replace("__PROMPT_MODULE__", json.dumps(str(PROMPT_MODULE)))
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(
            [{"nodeId": "node-a", "outputId": "output-a", "role": "first_frame"}],
            json.loads(result.stdout),
        )

    def test_thumbnail_labels_follow_the_current_generation_kind(self):
        script = textwrap.dedent(
            """
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(__HOST__, 'utf8');
            const thumbStart = source.indexOf('function composerInputMediaLabel');
            const thumbEnd = source.indexOf('\\nfunction promptNodeInputThumbsHtml', thumbStart);
            const renderStart = source.indexOf('function renderInputThumbsRow');
            const renderEnd = source.indexOf('\\nfunction showInputTextPreviewTooltip', renderStart);
            const inputThumbsRow = {
                dataset:{}, innerHTML:'',
                classList:{toggle:()=>{}}
            };
            const refs = [
                {url:'same.png',kind:'image',outputId:'a'},
                {url:'same.png',kind:'image',outputId:'b'}
            ];
            const settings = {engine:'api',apiKind:'video',videoUseFrameRoles:true};
            const labels = {
                'smart.videoFirstFrame':'首帧', 'smart.videoLastFrame':'尾帧',
                'smart.kindImage':'图片', 'smart.inputUpstream':'上游',
                'smart.inputNum':'输入 {n}', 'smart.removeReference':'移除',
                'smart.addReference':'添加', 'smart.collapseReference':'收起'
            };
            const sandbox = {
                window:{SmartCanvasModules:{}}, settings, inputThumbsRow,
                mentionInsertMode:'token',
                promptAuthoring:{resolve:()=>({refs,textRefs:[]})},
                syncComposerMentionTokenLabels:()=>false,
                syncJimengModelPillForRefs:()=>{}, syncJimengVideoModelPillForRefs:()=>{},
                manualReferenceImagesFor:()=>[], inputRefKey:ref=>`output|${ref.outputId}`,
                textForNode:()=>'', smartImageMode:()=>'', hideInputTextPreviewTooltip:()=>{},
                tr:key=>labels[key]||key,
                trf:(key,values)=>key==='smart.mediaNumber' ? `${values.kind}${values.count}` : key,
                isApiLikeEngine:engine=>engine==='api',
                mediaKindForItem:ref=>ref.kind||'image', isVideoMediaItem:()=>false,
                isSelfReferenceForNode:()=>false, smartPreviewImgHtml:()=>'<img>',
                smartVideoPreviewHtml:()=>'<video>', escapeHtml:value=>String(value),
                smartOriginalMediaUrl:ref=>ref.url, smartMediaPreviewUrl:ref=>ref.url,
                smartImagePerformanceOptimization:true, displayMediaUrl:ref=>ref.url,
                escapeAttr:value=>String(value), promptInputNodesFor:()=>[],
                bindSmartPreviewImageFallbacks:()=>{}, bindInputThumbsDrag:()=>{},
                bindInputThumbReferenceActions:()=>{}, bindInputTextReferencePreviews:()=>{},
                refreshIcons:()=>{}
            };
            vm.createContext(sandbox);
            vm.runInContext(source.slice(thumbStart,thumbEnd),sandbox);
            vm.runInContext(source.slice(renderStart,renderEnd),sandbox);
            sandbox.renderInputThumbsRow({id:'video-target'});
            const videoHtml = inputThumbsRow.innerHTML;
            settings.apiKind = 'image';
            sandbox.renderInputThumbsRow({id:'video-target'});
            process.stdout.write(JSON.stringify({videoHtml,imageHtml:inputThumbsRow.innerHTML}));
            """
        ).replace("__HOST__", json.dumps(str(HOST)))
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(0, result.returncode, result.stderr)
        value = json.loads(result.stdout)
        self.assertIn("首帧", value["videoHtml"])
        self.assertIn("尾帧", value["videoHtml"])
        self.assertIn("图片1", value["imageHtml"])
        self.assertIn("图片2", value["imageHtml"])
        self.assertNotIn("首帧", value["imageHtml"])
        self.assertNotIn("尾帧", value["imageHtml"])

    def test_composer_mention_labels_follow_thumb_order_and_removed_reference(self):
        script = textwrap.dedent(
            """
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(__HOST__, 'utf8');
            const labelStart = source.indexOf('function composerInputMediaLabel');
            const labelEnd = source.indexOf('\\nfunction composerInputMediaThumbHtml', labelStart);
            const syncStart = source.indexOf('function composerMentionTokenReference');
            const syncEnd = source.indexOf('\\nfunction renderInputThumbsRow', syncStart);
            const activeNode = {id:'target'};
            let savedDrafts = 0;
            const tokens = [];
            function token(outputId, name){
                const label = {
                    textContent:name,
                    classList:{add:value => { label.className = value; }}
                };
                const spacer = {nodeType:3,textContent:' '};
                const item = {
                    dataset:{url:'same.png',kind:'image',name,outputId,imageIndex:'0'},
                    nextSibling:spacer,
                    removed:false,
                    querySelector:selector => selector.includes('span') ? label : null,
                    remove(){ this.removed = true; }
                };
                tokens.push(item);
                return {item,label,spacer};
            }
            const first = token('a','原图 A');
            const second = token('b','原图 B');
            const promptInput = {
                dataset:{},
                querySelectorAll:() => tokens.filter(item => !item.removed)
            };
            const sandbox = {
                settings:{engine:'api',apiKind:'image',videoUseFrameRoles:false},
                promptInput,
                Node:{TEXT_NODE:3},
                activeComposerNode:()=>activeNode,
                savePromptDraftForCurrent:()=>{ savedDrafts += 1; },
                inputRefKey:ref=>ref.outputId ? `output|${ref.outputId}` : `url|${ref.url}`,
                mediaKindForItem:ref=>ref.kind||'image',
                isApiLikeEngine:engine=>engine==='api',
                tr:key=>key==='smart.kindImage' ? '图片' : key,
                trf:(key,values)=>key==='smart.mediaNumber' ? `${values.kind}${values.count}` : key
            };
            vm.createContext(sandbox);
            vm.runInContext(source.slice(labelStart,labelEnd),sandbox);
            vm.runInContext(source.slice(syncStart,syncEnd),sandbox);
            const a = {url:'same.png',kind:'image',outputId:'a'};
            const b = {url:'same.png',kind:'image',outputId:'b'};
            sandbox.syncComposerMentionTokenLabels(activeNode,[a,b]);
            const initial = [first.item.dataset.name,second.item.dataset.name];
            sandbox.syncComposerMentionTokenLabels(activeNode,[b,a]);
            const reordered = [first.item.dataset.name,second.item.dataset.name];
            sandbox.removeComposerMentionTokensForReference(activeNode,'output|b');
            process.stdout.write(JSON.stringify({
                initial,
                reordered,
                labelText:[first.label.textContent,second.label.textContent],
                removed:[first.item.removed,second.item.removed],
                removedSpacer:second.spacer.textContent,
                savedDrafts
            }));
            """
        ).replace("__HOST__", json.dumps(str(HOST)))
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(0, result.returncode, result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(["图片1", "图片2"], value["initial"])
        self.assertEqual(["图片2", "图片1"], value["reordered"])
        self.assertEqual(["图片2", "图片1"], value["labelText"])
        self.assertEqual([False, True], value["removed"])
        self.assertEqual("", value["removedSpacer"])
        self.assertEqual(3, value["savedDrafts"])

        host = HOST.read_text(encoding="utf-8")
        self.assertGreaterEqual(
            host.count("removeComposerMentionTokensForReference(node, key)"), 2
        )

    def test_frame_limits_are_json_driven_and_do_not_truncate_inputs(self):
        value = self.run_node(
            """
            const api = sandbox.window.SmartCanvasModules.videoCapabilities;
            const capability = api.clean({provider_id:'jimeng',known:true,commands:{
                frames2video:{image_count:{minimum:1,maximum:2}}
            }},'jimeng','seedance2.0');
            const one = [{url:'same.png',kind:'image',inputInstanceId:'a'}];
            const two = [...one,{url:'same.png',kind:'image',inputInstanceId:'b'}];
            const three = [...two,{url:'third.png',kind:'image',inputInstanceId:'c'}];
            const resolve = refs => api.resolve({videoUseFrameRoles:true},refs,capability);
            const unknown = api.resolve(
                {videoUseFrameRoles:true},
                one,
                api.fallback('other-provider','unregistered-model')
            );
            process.stdout.write(JSON.stringify({
                one:api.validateReferences(resolve(one)),
                two:api.validateReferences(resolve(two)),
                three:api.validateReferences(resolve(three)),
                unknown:api.validateReferences(unknown),
                threeCount:resolve(three).counts.image,
                sourceCount:three.length
            }));
            """,
            (VIDEO_MODULE,),
        )
        self.assertTrue(value["one"]["valid"])
        self.assertTrue(value["two"]["valid"])
        self.assertFalse(value["three"]["valid"])
        self.assertTrue(value["unknown"]["valid"])
        self.assertEqual(2, value["three"]["maximum"])
        self.assertEqual(3, value["threeCount"])
        self.assertEqual(3, value["sourceCount"])

    def test_mode_switch_keeps_instance_order(self):
        value = self.run_node(
            """
            const api = sandbox.window.SmartCanvasModules.videoCapabilities;
            const capability = api.clean({provider_id:'jimeng',known:true,commands:{
                frames2video:{image_count:{minimum:1,maximum:2}},
                multimodal2video:{inputs:{total_count:{minimum:1,maximum:9}}}
            }},'jimeng','seedance2.0');
            const refs = [
                {url:'same.png',kind:'image',inputInstanceId:'a'},
                {url:'same.png',kind:'image',inputInstanceId:'b'}
            ];
            const omni = api.resolve({videoUseFrameRoles:false},refs,capability);
            const frames = api.resolve({videoUseFrameRoles:true},refs,capability);
            const swapped = [refs[1],refs[0]];
            process.stdout.write(JSON.stringify({
                ids:refs.map(ref=>ref.inputInstanceId),
                omniCount:omni.counts.image,
                frameCount:frames.counts.image,
                swapped:swapped.map(ref=>ref.inputInstanceId)
            }));
            """,
            (VIDEO_MODULE,),
        )
        self.assertEqual(["a", "b"], value["ids"])
        self.assertEqual(2, value["omniCount"])
        self.assertEqual(2, value["frameCount"])
        self.assertEqual(["b", "a"], value["swapped"])

    def test_provider_submits_equal_urls_as_first_and_last_frame(self):
        script = textwrap.dedent(
            """
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(__PROVIDER_MODULE__,'utf8');
            let requestBody = null;
            let fetchCount = 0;
            const videoCapabilities = {
                load:async()=>({known:true,commands:{frames2video:{image_count:{minimum:1,maximum:2}}}}),
                applyComposerOptions:settings=>settings,
                resolve:(_settings,refs,capability)=>({command:'frames2video',counts:{image:refs.length,total:refs.length},reference_limit:capability.commands.frames2video.image_count,command_capability:capability.commands.frames2video}),
                reconcile:(settings,refs,capability)=>({settings,state:{command:'frames2video',counts:{image:refs.length,total:refs.length},reference_limit:capability.commands.frames2video.image_count,command_capability:capability.commands.frames2video}}),
                validateReferences:state=>({valid:state.counts.image>=1&&state.counts.image<=2,count:state.counts.image,minimum:1,maximum:2})
            };
            const sandbox = {
                window:{SmartCanvasModules:{videoCapabilities}},
                isApiLikeEngine:()=>true, smartCatalogHasSelection:()=>true,
                applyUploadedUrlsToSmartRefs:refs=>refs, manualSmartMediaLinks:()=>[],
                manualSmartVideoLink:()=>null, videoProviderPlatform:()=>'',
                imageRefsOnly:refs=>refs.filter(ref=>ref.kind==='image'), videoRefsOnly:()=>[], audioRefsOnly:()=>[],
                mediaKindForItem:ref=>ref.kind||'image', inputRefKey:ref=>`instance|${ref.inputInstanceId}`,
                resultMediaUrls:value=>value.videos||[], mediaKindForUrls:()=> 'video',
                tr:key=>key, trf:(key,values)=>`${key}:${JSON.stringify(values)}`,
                fetch:async(_url,options)=>{fetchCount+=1;requestBody=JSON.parse(options.body);return {ok:true,json:async()=>({videos:['out.mp4']})};}
            };
            vm.createContext(sandbox);vm.runInContext(source,sandbox);
            const submit = sandbox.window.SmartCanvasModules.generationProvider.submit;
            const settings = {engine:'api',apiKind:'video',videoProvider:'jimeng',videoModel:'seedance2.0',videoUseFrameRoles:true};
            submit({
                prompt:'move',
                refs:[
                    {url:'same.png',kind:'image',inputInstanceId:'a'},
                    {url:'same.png',kind:'image',inputInstanceId:'b'}
                ],
                settings
            }).then(async()=>{
                const submittedImages = requestBody.images;
                let overflowError = '';
                try {
                    await submit({
                        prompt:'move',settings,
                        refs:[
                            {url:'same.png',kind:'image',inputInstanceId:'a'},
                            {url:'same.png',kind:'image',inputInstanceId:'b'},
                            {url:'third.png',kind:'image',inputInstanceId:'c'}
                        ]
                    });
                } catch(error) { overflowError = error.message; }
                process.stdout.write(JSON.stringify({submittedImages,overflowError,fetchCount}));
            });
            """
        ).replace("__PROVIDER_MODULE__", json.dumps(str(PROVIDER_MODULE)))
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(0, result.returncode, result.stderr)
        value = json.loads(result.stdout)
        images = value["submittedImages"]
        self.assertEqual(["same.png", "same.png"], [item["url"] for item in images])
        self.assertEqual(["first_frame", "last_frame"], [item["role"] for item in images])
        self.assertEqual(["a", "b"], [item["instance_id"] for item in images])
        self.assertIn("smart.videoReferenceInvalid", value["overflowError"])
        self.assertEqual(1, value["fetchCount"])

    def test_config_and_host_expose_instance_contract(self):
        config = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
        for profile in config["capability_profiles"].values():
            self.assertEqual(
                {"minimum": 1, "maximum": 2},
                profile["commands"]["frames2video"]["image_count"],
            )
        host = HOST.read_text(encoding="utf-8")
        self.assertIn("referenceInstances.unique(images)", host)
        self.assertNotIn("seen.has(img.url)", host)
        self.assertIn("smart.videoFirstFrame", host)
        self.assertIn("smart.videoLastFrame", host)

    def test_backend_registry_returns_model_profile_limits(self):
        registry = VideoCapabilityRegistry(CAPABILITIES)
        value = registry.public("jimeng", "seedance2.5")
        self.assertTrue(value["known"])
        self.assertEqual(
            {"minimum": 1, "maximum": 2},
            value["commands"]["frames2video"]["image_count"],
        )
        single = registry.validate_references(
            "jimeng",
            "seedance2.5",
            images=[{"url": "same.png", "role": "first_frame"}],
        )
        overflow = registry.validate_references(
            "jimeng",
            "seedance2.5",
            images=[
                {"url": "same.png", "role": "first_frame"},
                {"url": "same.png", "role": "last_frame"},
                {"url": "third.png"},
            ],
        )
        self.assertTrue(single["valid"])
        self.assertFalse(overflow["valid"])
        self.assertEqual(3, overflow["count"])


if __name__ == "__main__":
    unittest.main()
