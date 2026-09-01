import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "static/js/smart-canvas.js"
MATTING_MODULE = ROOT / "static/js/smart-canvas/smart-matting.js"
PERSISTENCE_MODULE = ROOT / "static/js/smart-canvas/canvas-persistence.js"


class SmartCanvasSmartMattingModuleTests(unittest.TestCase):
    def test_matting_lifecycle_is_owned_by_its_module(self):
        host = HOST.read_text(encoding="utf-8")
        source = MATTING_MODULE.read_text(encoding="utf-8")
        persistence = PERSISTENCE_MODULE.read_text(encoding="utf-8")

        for implementation in (
            "function smartMattingJobActive(",
            "function smartMattingStatusText(",
            "function smartMattingPendingHtml(",
            "function smartMattingFailNode(",
            "function smartMattingCompleteNode(",
            "function smartMattingFetchStatus(",
            "function smartMattingStartPoll(",
            "function smartMattingResume(",
            "async function smartMattingRun(",
        ):
            with self.subTest(implementation=implementation):
                self.assertIn(implementation, source)
                self.assertNotIn(implementation, host)

        self.assertIn("window.SmartCanvasModules.smartMatting", source)
        self.assertIn("smartMatting.run({node, imageIndex:index})", host)
        self.assertIn("smartMattingModule.resume();", persistence)
        self.assertIn(
            "smartMattingModule.isActive({job:node.mattingJob})",
            persistence,
        )
        self.assertIn(
            "smartMatting.pendingHtml({node, layout, elapsed:generationPendingNodeElapsed(node)})",
            host,
        )
        self.assertIn("pendingHtml({node=null, layout=null, elapsed=''", source)
        self.assertIn("<ic-generation-pending", source)
        self.assertIn("<ic-alert", source)
        self.assertIn("displaySize:{width:sourceRect.width,height:sourceRect.height}", source)
        self.assertNotIn("smart.mattingSingleTask", source)
        self.assertNotIn("jimeng-pending-cell", source)
        self.assertNotIn("data-lucide", source)
        self.assertNotIn("function runSmartImageMatting(", host)
        self.assertNotIn("function resumeMattingPendingNodes(", host)
        self.assertNotIn("function startMattingPoll(", host)

    def test_public_interface_submits_polls_and_completes_output(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(
                {json.dumps(str(MATTING_MODULE))},
                'utf8',
            );
            const input = {{
                id:'source',
                type:'smart-image',
                w:320,
                h:240,
                images:[{{url:'source.png',name:'source.png',kind:'image'}}],
            }};
            const nodes = [input];
            const events = [];
            let nextId = 0;
            const sandbox = {{
                window:{{
                    SmartCanvasModules:{{
                        generationOutput:{{
                            createPending({{sourceNode, expectedCount, connectSource, displaySize}}){{
                                const output = {{
                                    id:`output-${{++nextId}}`,
                                    type:'smart-image',
                                    images:[],
                                    pending:expectedCount,
                                    sourceNodeId:sourceNode.id,
                                    connectSource,
                                    displaySize,
                                }};
                                nodes.push(output);
                                return output;
                            }},
                            apply({{node, outputs, strategy, skipShift}}){{
                                node.images = outputs.map(item => ({{...item}}));
                                node.pending = 0;
                                node.running = false;
                                node.runFinishedAt = 200;
                                events.push({{type:'apply',strategy,skipShift}});
                                return node.images;
                            }},
                        }},
                        canvasPersistence:{{
                            schedule:() => events.push({{type:'save'}}),
                        }},
                        canvasMutation:{{
                            history:() => events.push({{type:'undo'}}),
                        }},
                    }},
                }},
                nodes,
                canvasId:'canvas-1',
                smartClientId:'client-1',
                selectedId:'',
                selectedIds:[],
                selectedImage:{{nodeId:'',index:-1}},
                imageForDisplay:item => item,
                mediaKindForItem:item => item?.kind || 'image',
                nodeRect:node => ({{width:node.w,height:node.h}}),
                nowMs:() => 200,
                render:() => events.push({{type:'render'}}),
                toast:message => events.push({{type:'toast',message}}),
                escapeHtml:value => String(value ?? '')
                    .replaceAll('&','&amp;')
                    .replaceAll('<','&lt;')
                    .replaceAll('>','&gt;'),
                escapeAttr:value => String(value ?? '')
                    .replaceAll('&','&amp;')
                    .replaceAll('"','&quot;')
                    .replaceAll('<','&lt;')
                    .replaceAll('>','&gt;'),
                responseErrorMessage:async (_response, fallback) => fallback,
                fetch:async (url, options={{}}) => {{
                    if(options.method === 'POST'){{
                        events.push({{type:'submit',url,body:JSON.parse(options.body)}});
                        return {{
                            ok:true,
                            json:async () => ({{
                                job_id:'job-1',
                                status:'queued',
                                position:1,
                            }}),
                        }};
                    }}
                    events.push({{type:'poll',url}});
                    return {{
                        ok:true,
                        json:async () => ({{
                            job_id:'job-1',
                            status:'succeeded',
                            output_url:'cutout.png',
                            output_name:'cutout.png',
                            model:'birefnet-general',
                            width:640,
                            height:480,
                        }}),
                    }};
                }},
                setTimeout,
                clearTimeout,
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const matting = sandbox.window.SmartCanvasModules.smartMatting;
            (async () => {{
                const pendingHtml = matting.pendingHtml({{
                    node:{{mattingJob:{{status:'queued',position:2}}}},
                    layout:{{width:320,height:180}},
                }});
                const output = await matting.run({{
                    nodeId:'source',
                    imageIndex:0,
                }});
                await new Promise(resolve => setTimeout(resolve, 20));
                process.stdout.write(JSON.stringify({{
                    methods:Object.keys(matting).sort(),
                    activeQueued:matting.isActive({{job:{{status:'queued'}}}}),
                    activeFailed:matting.isActive({{job:{{status:'failed'}}}}),
                    pendingHtml,
                    output:{{
                        id:output?.id,
                        title:output?.title,
                        pending:output?.pending,
                        running:output?.running,
                        image:output?.images?.[0],
                        result:output?.mattingResult,
                        hasJob:Boolean(output?.mattingJob),
                        displaySize:output?.displaySize,
                    }},
                    submit:events.find(event => event.type === 'submit'),
                    poll:events.find(event => event.type === 'poll'),
                    apply:events.find(event => event.type === 'apply'),
                    toast:events.filter(event => event.type === 'toast').at(-1),
                }}));
            }})().catch(error => {{
                process.stderr.write(error.stack || error.message);
                process.exitCode = 1;
            }});
            """
        )
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(
            payload["methods"],
            ["isActive", "pendingHtml", "resume", "run"],
        )
        self.assertTrue(payload["activeQueued"])
        self.assertFalse(payload["activeFailed"])
        self.assertIn("第 2 位", payload["pendingHtml"])
        self.assertIn("<ic-generation-pending", payload["pendingHtml"])
        self.assertIn("data-matting-pending", payload["pendingHtml"])
        self.assertIn('state="queued"', payload["pendingHtml"])
        self.assertIn("width:320px;height:180px", payload["pendingHtml"])
        self.assertEqual(payload["submit"]["url"], "/api/smart-canvas/matting")
        self.assertEqual(payload["submit"]["body"]["canvas_id"], "canvas-1")
        self.assertEqual(payload["submit"]["body"]["node_id"], "source")
        self.assertEqual(
            payload["poll"]["url"],
            "/api/smart-canvas/matting/job-1",
        )
        self.assertEqual(payload["apply"], {
            "type": "apply",
            "strategy": "replace",
            "skipShift": True,
        })
        self.assertEqual(payload["output"]["title"], "抠图结果")
        self.assertEqual(payload["output"]["displaySize"], {"width": 320, "height": 240})
        self.assertEqual(payload["output"]["pending"], 0)
        self.assertFalse(payload["output"]["running"])
        self.assertEqual(payload["output"]["image"]["url"], "cutout.png")
        self.assertEqual(payload["output"]["image"]["natural_w"], 640)
        self.assertEqual(payload["output"]["image"]["natural_h"], 480)
        self.assertEqual(
            payload["output"]["result"]["model"],
            "birefnet-general",
        )
        self.assertFalse(payload["output"]["hasJob"])
        self.assertEqual(payload["toast"]["message"], "抠图完成")


if __name__ == "__main__":
    unittest.main()
