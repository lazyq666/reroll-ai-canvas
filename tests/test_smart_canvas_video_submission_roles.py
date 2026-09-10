"""Exercise video preflight and the emitted request against the real catalog."""

import json
import subprocess
import unittest
from pathlib import Path

from tests.test_model_capabilities import catalog


ROOT = Path(__file__).resolve().parents[1]


class SmartCanvasVideoSubmissionRoleTests(unittest.TestCase):
    def submit(self, roles, mode="multimodal_all_around"):
        registry = catalog()
        capability = registry.resolve("jimeng", "seedance2.0_vip", "video.generate")
        script = r"""
            const fs=require('fs'), vm=require('vm');
            const {capability,roles,mode}=JSON.parse(fs.readFileSync(0,'utf8'));
            const payloads=[];
            const refs=roles.map((role,index)=>({
                url:`/test-${index}.png`,kind:'image',role,inputInstanceId:`ref-${index}`
            }));
            const original=JSON.stringify(refs);
            const sandbox={window:{SmartCanvasModules:{}},URLSearchParams,
                tr:key=>key,trf:(key,values)=>`${key} ${JSON.stringify(values)}`,
                isApiLikeEngine:engine=>engine==='api',
                applyUploadedUrlsToSmartRefs:refs=>refs,manualSmartMediaLinks:()=>[],
                imageRefsOnly:refs=>refs,videoRefsOnly:()=>[],audioRefsOnly:()=>[],
                manualSmartVideoLink:()=>null,videoProviderPlatform:()=>'',
                inputRefKey:ref=>ref.inputInstanceId,smartClientId:'test',
                fetch:async(url,options)=>{
                    if(url.startsWith('/api/model-capabilities?')){
                        return {ok:true,json:async()=>capability};
                    }
                    if(url!=='/api/canvas-video-tasks') throw new Error(`Unexpected URL: ${url}`);
                    payloads.push(JSON.parse(options.body));
                    return {ok:true,json:async()=>({task_id:'mock-task',status:'queued'})};
                }
            };
            vm.createContext(sandbox);
            for(const name of ['model-capabilities','video-capabilities','generation-provider']){
                vm.runInContext(fs.readFileSync(`static/js/smart-canvas/${name}.js`,'utf8'),sandbox);
            }
            (async()=>{
                let error='',submission=null;
                try{
                    submission=await sandbox.window.SmartCanvasModules.generationProvider.submit({
                        prompt:'Video reference test',refs,
                        settings:{engine:'api',apiKind:'video',videoProvider:'jimeng',
                            videoModel:'seedance2.0_vip',videoDuration:7,videoAspect:'4:3',
                            videoResolution:'720p',videoReferenceMode:mode,
                            videoUseFrameRoles:mode==='first_last_frames'}
                    });
                }catch(value){error=value.message;}
                process.stdout.write(JSON.stringify({error,payloads,submission,unchanged:original===JSON.stringify(refs)}));
            })();
        """
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, text=True, capture_output=True,
            input=json.dumps({"capability": capability, "roles": roles, "mode": mode}),
        )
        self.assertEqual(0, result.returncode, result.stderr)
        value = json.loads(result.stdout)
        self.assertTrue(value["unchanged"], "Submission must preserve source references")
        for payload in value["payloads"]:
            parameters = {"duration_seconds": payload["duration"], "resolution": payload["resolution"]}
            if payload["aspect_ratio"] != "adaptive":
                parameters["aspect_ratio"] = payload["aspect_ratio"]
            validation = registry.validate(
                capability, input_counts={"text": 1, "image": len(payload["images"])},
                input_roles={"image": [image.get("role", "") for image in payload["images"]]},
                parameters=parameters, catalog_revision=payload["catalog_revision"],
            )
            self.assertTrue(validation["valid"], validation)
        return value

    def test_all_around_numbered_and_stale_frame_roles_reach_submission(self):
        for roles in (["image_1", "image_2"], ["last_frame", "first_frame"], ["", ""],
                      ["image_1", "image_2", "image_3"]):
            with self.subTest(roles=roles):
                value = self.submit(roles)
                self.assertEqual("", value["error"])
                self.assertEqual("pending", value["submission"]["state"])
                self.assertEqual(1, len(value["payloads"]))
                payload = value["payloads"][0]
                self.assertTrue(payload["multimodal"])
                self.assertEqual((7, "4:3", "720p"),
                                 (payload["duration"], payload["aspect_ratio"], payload["resolution"]))
                self.assertEqual([f"ref-{i}" for i in range(len(roles))],
                                 [image["instance_id"] for image in payload["images"]])
                self.assertTrue(all("role" not in image for image in payload["images"]))

    def test_frames_assign_roles_by_current_order(self):
        for roles in (["image_1"], ["image_1", "image_2"], ["last_frame", "first_frame"]):
            with self.subTest(roles=roles):
                value = self.submit(roles, "first_last_frames")
                self.assertEqual("", value["error"])
                payload = value["payloads"][0]
                self.assertFalse(payload["multimodal"])
                self.assertEqual("adaptive", payload["aspect_ratio"])
                self.assertEqual(["first_frame", "last_frame"][:len(roles)],
                                 [image["role"] for image in payload["images"]])

    def test_frame_and_all_around_reference_limits_still_block_submission(self):
        for mode, count in (("first_last_frames", 3), ("multimodal_all_around", 10)):
            with self.subTest(mode=mode):
                value = self.submit([f"image_{i + 1}" for i in range(count)], mode)
                self.assertIn("smart.videoReferenceInvalid", value["error"])
                self.assertEqual([], value["payloads"])
