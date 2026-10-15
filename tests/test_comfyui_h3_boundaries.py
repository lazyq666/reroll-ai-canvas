"""Independent H3 boundary checks; all provider calls are mocked, no GPU work."""
from copy import deepcopy
import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from infinite_canvas.providers import comfyui_impl as provider
from infinite_canvas.providers.comfyui_h3 import compile_h3, h3_capability, validate_references
from tests.test_comfyui_h3 import reference, template


def compile_graph(prompt="", refs=None, **options):
    return compile_h3(template(), prompt, {"references": refs if refs is not None else [reference()], **options}, seed=123)


class H3BoundaryTests(unittest.TestCase):
    def test_all_72_choices_drive_both_stages_and_exact_delivery(self):
        expected={"512p":{"16:9":(896,512),"9:16":(512,896),"1:1":(512,512)},
                  "768p":{"16:9":(1344,768),"9:16":(768,1344),"1:1":(768,768)}}
        aligned={4:107,5:124,6:158,7:175,8:192,9:226,10:243,11:277,12:294,13:328,14:345,15:362}
        for resolution,ratios in expected.items():
            for ratio,(width,height) in ratios.items():
                for duration in range(4,16):
                    with self.subTest(resolution=resolution,ratio=ratio,duration=duration):
                        output=compile_graph(duration=duration,resolution=resolution,aspect_ratio=ratio)
                        graph=output.graph
                        self.assertEqual((width,height),(output.width,output.height))
                        self.assertEqual(aligned[duration],output.frame_count)
                        self.assertEqual((round(width/1.5/32)*32,round(height/1.5/32)*32),
                                         (graph["7"]["inputs"]["width"],graph["7"]["inputs"]["height"]))
                        for nid in ("7","14"):
                            self.assertEqual(aligned[duration],graph[nid]["inputs"]["length"])
                        self.assertEqual((width,height),(graph["13"]["inputs"]["target_width"],graph["13"]["inputs"]["target_height"]))
                        self.assertEqual(["13",2],graph["14"]["inputs"]["height"])
                        self.assertEqual(duration*24,graph["reroll_h3_trim_frames"]["inputs"]["length"])
                        self.assertEqual(f"0:{duration:02d}",graph["reroll_h3_trim_audio"]["inputs"]["end_time"])
                        self.assertEqual(("21",),output.output_node_ids)
                        video=graph["reroll_h3_create_video"]["inputs"]
                        self.assertEqual(24,video["fps"])
                        self.assertEqual(["reroll_h3_trim_frames",0],video["images"])
                        self.assertEqual(["reroll_h3_trim_audio",0],video["audio"])
                        # Native encoding flushes both streams, avoiding VHS shortest
                        # dropping video frames or the final partial AAC packet.
                        self.assertEqual("SaveVideo",graph["21"]["class_type"])
                        self.assertEqual(["reroll_h3_create_video",0],graph["21"]["inputs"]["video"])
                        self.assertEqual("h264",graph["21"]["inputs"]["format.codec"])

    def test_handwritten_tag_spellings_are_validated_then_canonicalized(self):
        refs=[reference(0),reference(1,"video",duration=2,include_audio=True),reference(2,"audio",duration=2)]
        output=compile_graph("<Picture1> < picture 1 > <Image1> Video #1 <Audio2>",refs)
        expected="<Picture 1> <Picture 1> <Picture 1> <Video 1> <Audio 2>"
        for nid in ("7","14"):
            self.assertEqual(expected,output.graph[nid]["inputs"]["prompt"])
        self.assertEqual("An article about Video 2",compile_graph("An article about Video 2").graph["7"]["inputs"]["prompt"])

    def test_every_plugin_tag_spelling_rejects_missing_reference_before_gpu(self):
        for prompt in ("<Picture2>","<picture 2>","<Image 2>","Picture #2","<Picture0>","< Video1 >","<Audio1>"):
            with self.subTest(prompt=prompt),self.assertRaisesRegex(ValueError,"prompt_reference_missing"):
                compile_graph(prompt)

    def test_mutated_critical_edges_do_not_claim_h3_capability(self):
        mutations=[("20","av_latent",["12",0]),("13","av_latent",["7",1]),
                   ("12","latent_image",["14",1]),("19","latent_image",["7",1]),
                   ("15","learned_latent",["12",1]),("15","highres_template",["7",1]),
                   ("12","noise",["99",0]),("19","noise",["99",0]),
                   ("10","conditioning",["14",0]),("15","positive",["7",0]),
                   ("17","conditioning",["7",0])]
        for nid,key,value in mutations:
            graph=template();graph[nid]["inputs"][key]=value
            with self.subTest(node=nid,input=key):
                self.assertIsNone(h3_capability(graph))
                with self.assertRaisesRegex(ValueError,"invalid_template"):
                    compile_h3(graph,"",{"references":[reference()]},seed=1)

    def test_semantic_bridge_and_scalar_parameters_remain_configurable(self):
        graph=template()
        for owner,field,source,bridge in [("10","conditioning","7","bridge-a"),("15","positive","14","bridge-b")]:
            graph[bridge]={"class_type":"MiniMaxH3SemanticBridgeApplyT8","inputs":{"conditioning":[source,0],"strength":0.3}}
            graph[owner]["inputs"][field]=[bridge,0]
        graph["13"]["inputs"]["scale_by"]=2.3
        self.assertIsNotNone(h3_capability(graph))
        compiled=compile_h3(graph,"",{"references":[reference()]},seed=1)
        self.assertEqual(0.3,compiled.graph["bridge-a"]["inputs"]["strength"])

    def test_reference_limits_and_identity_include_every_allowed_instance(self):
        for image_count in range(1,7):
            refs=[reference(index) for index in range(image_count)]
            compiled=compile_graph(refs=refs)
            for ordinal,ref in enumerate(refs):
                for nid in ("7","14"):
                    link=compiled.graph[nid]["inputs"][f"ref_images.ref_image_{ordinal}"]
                    self.assertEqual(f"batch/{ref['name']}",compiled.graph[link[0]]["inputs"]["image"])
        for videos in range(4):
            for audios in range(4):
                refs=[reference(index) for index in range(6)]
                refs += [reference(6+i,"video",duration=2,include_audio=(i%2==0)) for i in range(videos)]
                refs += [reference(9+i,"audio",duration=2) for i in range(audios)]
                output=compile_graph(refs=refs)
                links={k:v for k,v in output.graph["7"]["inputs"].items() if k.startswith("ref_")}
                self.assertEqual(6+videos+audios+(videos+1)//2,len(links))
                self.assertEqual(links,{k:v for k,v in output.graph["14"]["inputs"].items() if k.startswith("ref_")})
        for kind,count in (("image",7),("video",4),("audio",4)):
            with self.subTest(kind=kind),self.assertRaisesRegex(ValueError,"reference_count"):
                compile_graph(refs=[reference(index,kind,duration=2) for index in range(count)])
        for kind in ("video","audio"):
            self.assertIsNotNone(compile_graph(refs=[reference(0,kind,duration=2)]))
        with self.assertRaisesRegex(ValueError,"reference_count"):
            compile_graph(refs=[])

    def test_reference_duration_bounds_total_and_nonfinite_values(self):
        for kind in ("video","audio"):
            for duration in (2,15):
                self.assertEqual(duration,validate_references([reference(0,kind,duration=duration)],require_durations=True)[0]["duration"])
            for duration in (0,-2,1.99,15.1,True,False,float("nan"),float("inf"),"NaN"):
                with self.subTest(kind=kind,duration=duration),self.assertRaisesRegex(ValueError,"reference_duration"):
                    validate_references([reference(0,kind,duration=duration)],require_durations=True)
            validate_references([reference(i,kind,duration=5) for i in range(3)],require_durations=True)
            with self.assertRaisesRegex(ValueError,"duration_total"):
                validate_references([reference(i,kind,duration=5.1) for i in range(3)],require_durations=True)
        validate_references([reference(i,"video",duration=5) for i in range(3)]+[reference(i,"audio",duration=5) for i in range(3)],require_durations=True)

    def test_reference_duration_accepts_only_fifty_milliseconds_of_container_rounding(self):
        for kind in ("video", "audio"):
            with self.subTest(kind=kind):
                accepted = validate_references(
                    [reference(0, kind, duration=15.05)], require_durations=True,
                )
                self.assertEqual(15.05, accepted[0]["duration"])
                with self.assertRaisesRegex(ValueError, "comfy.h3.reference_duration$"):
                    validate_references(
                        [reference(0, kind, duration=15.051)], require_durations=True,
                    )

    def test_each_reference_kind_has_one_shared_fifty_millisecond_total_tolerance(self):
        accepted = []
        for kind in ("video", "audio"):
            with self.subTest(kind=kind):
                refs = [reference(index, kind, duration=duration)
                        for index, duration in enumerate((5, 5, 5.05))]
                validate_references(refs, require_durations=True)
                accepted.extend(refs)
                # Every file is individually valid; the sum crosses the one
                # shared allowance for this kind, not an allowance per file.
                refs[-1]["duration"] = 5.051
                with self.assertRaisesRegex(ValueError, "comfy.h3.reference_duration_total$"):
                    validate_references(refs, require_durations=True)
                refs[-1]["duration"] = 5.05
        # Video and standalone audio retain independent 15.05-second budgets.
        validate_references(accepted, require_durations=True)

    def test_output_duration_rejects_invalid_numbers_and_boolean(self):
        for value in (-4,0,2,3,16,100,4.5,14.9,4.0,15.0,True,False,float("nan"),float("inf"),"4","15",None,[],{}):
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,"invalid_duration"):
                compile_graph(duration=value)

    def test_explicit_invalid_size_values_never_silently_use_defaults(self):
        self.assertEqual((896,512),(compile_graph().width,compile_graph().height))
        for key in ("resolution","aspect_ratio"):
            for value in (False,True,0,None,"",-1,float("nan"),[],{}):
                with self.subTest(key=key,value=value),self.assertRaisesRegex(ValueError,"invalid_resolution"):
                    compile_graph(**{key:value})

    def test_given_seed_is_stable_and_template_seed_never_leaks(self):
        graph=template();graph["11"]["inputs"]["noise_seed"]=999
        snapshot=deepcopy(graph)
        first=compile_h3(graph,"",{"references":[reference()]},seed=123)
        second=compile_h3(graph,"",{"references":[reference()]},seed=123)
        self.assertEqual(first.graph,second.graph)
        self.assertEqual(snapshot,graph)
        self.assertEqual(123,first.graph["11"]["inputs"]["noise_seed"])
        self.assertEqual(["11",0],first.graph["12"]["inputs"]["noise"])
        self.assertEqual(["11",0],first.graph["19"]["inputs"]["noise"])


class H3RemoteProbeBoundaryTests(unittest.TestCase):
    def metadata(self,kind="video",duration=2,audio=True):
        streams=[{"codec_type":kind,"duration":str(duration),"width":320,"height":640}]
        if kind=="video" and audio: streams.append({"codec_type":"audio","duration":str(duration)})
        return SimpleNamespace(returncode=0,stdout=json.dumps({"format":{"duration":str(duration)},"streams":streams}))

    def test_actual_file_duration_overrides_client_claim(self):
        with patch.object(provider.shutil,"which",return_value="/fixture/ffprobe"),patch.object(provider.subprocess,"run",return_value=self.metadata(duration=16)):
            with self.assertRaisesRegex(ValueError,"reference_duration"):
                provider.probe_h3_references([reference(0,"video",duration=2)],"fixture:8188")

    def test_soundtrack_switch_requires_audio_and_preserves_portrait_dimensions(self):
        with patch.object(provider.shutil,"which",return_value="/fixture/ffprobe"),patch.object(provider.subprocess,"run",return_value=self.metadata(audio=False)):
            with self.assertRaisesRegex(ValueError,"audio_track_missing"):
                provider.probe_h3_references([reference(0,"video",include_audio=True)],"fixture:8188")
            probed=provider.probe_h3_references([reference(0,"video",include_audio=False)],"fixture:8188")
        output=compile_graph(refs=probed)
        self.assertEqual((0,608),(output.graph["reroll_h3_ref_0"]["inputs"]["custom_width"],output.graph["reroll_h3_ref_0"]["inputs"]["custom_height"]))
        self.assertNotIn("ref_video_audios.ref_video_audio_0",output.graph["7"]["inputs"])

    def test_remote_kind_mismatch_and_unprobeable_media_fail(self):
        for result in (self.metadata(kind="audio"),SimpleNamespace(returncode=1,stdout="")):
            with self.subTest(result=result),patch.object(provider.shutil,"which",return_value="/fixture/ffprobe"),patch.object(provider.subprocess,"run",return_value=result):
                with self.assertRaisesRegex(ValueError,"duration_unknown"):
                    provider.probe_h3_references([reference(0,"video")],"fixture:8188")
        with patch.object(provider.shutil,"which",return_value=None):
            with self.assertRaisesRegex(ValueError,"duration_unknown"):
                provider.probe_h3_references([reference(0,"audio")],"fixture:8188")


class H3ProviderBoundaryTests(unittest.TestCase):
    def setUp(self):
        from threading import Lock
        self.ports=SimpleNamespace(QUEUE_LOCK=Lock(),QUEUE=[],LOAD_LOCK=Lock(),
                                  COMFYUI_HISTORY_TIMEOUT=2,COMFY_PREVIEW_CLASS_HINTS=("preview",),
                                  COMFY_DEBUG_TEXT_CLASS_HINTS=("showtext",))

    def test_invalid_api_values_tags_and_graph_fail_before_any_network(self):
        from pathlib import Path
        import tempfile
        from tests.runtime_env import ensure_test_workspace
        ensure_test_workspace()
        import main
        cases=[("<Picture2>",{},None,"prompt_reference_missing"),
               ("<Audio1>",{},None,"prompt_reference_missing"),
               ("",{"resolution":False},None,"invalid_resolution"),
               ("",{"aspect_ratio":0},None,"invalid_resolution"),
               ("",{"duration":True},None,"invalid_duration"),
               ("",{},("20","av_latent",["12",0]),"invalid_template")]
        for prompt,options,mutation,code in cases:
            with self.subTest(code=code,prompt=prompt),tempfile.TemporaryDirectory() as tmp:
                graph=template()
                if mutation:
                    nid,key,value=mutation;graph[nid]["inputs"][key]=value
                graph_path=Path(tmp)/"H3.json";graph_path.write_text(json.dumps(graph))
                request=main.GenerateRequest(prompt=prompt,workflow_json="custom/H3.json",workflow_inputs={"references":[reference()],**options})
                with provider.bind_ports(self.ports),patch.object(provider,"workflow_path_from_name",return_value=str(graph_path)),patch.object(provider,"read_workflow_config",return_value={}),patch.object(provider,"probe_h3_references") as probe,patch.object(provider,"connect_events") as events,patch.object(provider.urllib.request,"urlopen") as submit:
                    result=provider.generate(request,publish=False)
                self.assertEqual(f"comfy.h3.{code}",result["error"])
                probe.assert_not_called();events.assert_not_called();submit.assert_not_called()

    def test_each_new_provider_execution_uses_one_seed_for_both_passes(self):
        from pathlib import Path
        import io
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            graph_path=Path(tmp)/"H3.json";graph_path.write_text(json.dumps(template()))
            request=SimpleNamespace(prompt="<Picture1>",workflow_json="custom/H3.json",workflow_inputs={"references":[reference()]},params={},client_id="test",type="workflow",convert_to_jpg=False)
            history={"outputs":{"21":{"gifs":[{"filename":"final.mp4","type":"output"}]}}}
            with provider.bind_ports(self.ports),patch.object(provider,"workflow_path_from_name",return_value=str(graph_path)),patch.object(provider,"read_workflow_config",return_value={}),patch.object(provider,"COMFYUI_INSTANCES",["127.0.0.1:8188"]),patch.object(provider,"BACKEND_LOCAL_LOAD",{}),patch.object(provider,"probe_h3_references",side_effect=lambda refs,_:refs),patch.object(provider,"connect_events",return_value=None),patch.object(provider,"wait_for_history",return_value=history),patch.object(provider.random,"randint",side_effect=[123,456]) as seeds,patch.object(provider.urllib.request,"urlopen",side_effect=[io.BytesIO(b'{"prompt_id":"job-one"}'),io.BytesIO(b'{"prompt_id":"job-two"}')]) as submit:
                first=provider.generate(request,publish=False)
                second=provider.generate(request,publish=False)
            self.assertEqual((123,456),(first["seed"],second["seed"]))
            self.assertEqual(2,seeds.call_count)
            for call,seed in zip(submit.call_args_list,[123,456]):
                graph=json.loads(call.args[0].data)["prompt"]
                self.assertEqual(seed,graph["11"]["inputs"]["noise_seed"])
                self.assertEqual(["11",0],graph["12"]["inputs"]["noise"])
                self.assertEqual(["11",0],graph["19"]["inputs"]["noise"])
                self.assertEqual("<Picture 1>",graph["7"]["inputs"]["prompt"])
                self.assertEqual("<Picture 1>",graph["14"]["inputs"]["prompt"])
