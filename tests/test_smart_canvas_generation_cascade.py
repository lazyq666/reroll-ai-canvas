import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "static/js/smart-canvas.js"
RUN_MODULE = ROOT / "static/js/smart-canvas/generation-run.js"
CASCADE_MODULE = ROOT / "static/js/smart-canvas/generation-cascade.js"


class SmartCanvasGenerationCascadeTests(unittest.TestCase):
    def test_loop_orchestration_is_owned_by_its_module(self):
        run_source = RUN_MODULE.read_text(encoding="utf-8")
        cascade_source = CASCADE_MODULE.read_text(encoding="utf-8")
        host = HOST.read_text(encoding="utf-8")

        for implementation in (
            "function runSmartCascade(",
            "function runSmartCascadeFromLoop(",
            "function requestSmartCascadeStop(",
            "function smartCascadeGraphForTail(",
        ):
            with self.subTest(implementation=implementation):
                self.assertNotIn(implementation, run_source)
                self.assertIn(implementation, cascade_source)

        self.assertIn("cascadeRunAdapter.executeStep", cascade_source)
        self.assertIn("cascadeRunAdapter.executeLoopRound", cascade_source)
        self.assertIn("cascadeRunAdapter.appendRefs", cascade_source)
        self.assertIn("cascadeAdapter:Object.freeze", run_source)
        self.assertIn("activeGenerationCascadeModule()?.run", run_source)
        self.assertIn("activeGenerationCascadeModule()?.status", run_source)
        self.assertIn("if(mode !== 'single') return Promise.resolve(false)", run_source)
        self.assertNotIn("cascadeRunBtn", host)
        self.assertNotIn("mode:'cascade'", host)
        self.assertNotIn("syncCascadeRunButton", cascade_source)
        self.assertNotIn("syncButton(", cascade_source)

    def test_loop_interface_has_idle_status_and_stable_shape(self):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync({json.dumps(str(CASCADE_MODULE))}, 'utf8');
            const sandbox = {{
                window: {{
                    SmartCanvasModules: {{
                        generationSettings: {{forNode: () => ({{engine:'api'}})}},
                        generationRun: {{
                            cascadeAdapter: {{
                                executeStep: async () => [],
                                executeLoopRound: async () => [],
                                appendRefs: () => [],
                            }},
                        }},
                        canvasPersistence: {{
                            schedule: () => {{}},
                        }},
                        canvasMutation: {{
                            history: () => true,
                            create: () => null,
                            connect: () => false,
                        }},
                    }},
                }},
                nodes: [],
                canvas: {{connections: []}},
                selectedNode: () => null,
                isSmartImageNode: () => false,
                isHistoryGroupNode: () => false,
            }};
            vm.createContext(sandbox);
            vm.runInContext(source, sandbox);
            const cascade = sandbox.window.SmartCanvasModules.generationCascade;
            const status = cascade.status({{connectionKeys:['source->target']}});
            process.stdout.write(JSON.stringify({{
                methods:['run','stop','status','context','noteManualSelection']
                    .filter(name => typeof cascade[name] === 'function'),
                context:cascade.context(),
                status,
            }}));
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
            ["run", "stop", "status", "context", "noteManualSelection"],
        )
        self.assertIsNone(payload["context"])
        self.assertFalse(payload["status"]["anyRunning"])
        self.assertFalse(payload["status"]["loopRunning"])
        self.assertEqual(payload["status"]["activeConnectionCount"], 0)
        self.assertEqual(payload["status"]["cascadeConnectionKeys"], [])
        self.assertEqual(payload["status"]["connectionStates"], [""])

    def test_completion_failure_and_user_stop_use_distinct_toast_tones(self):
        cascade_source = CASCADE_MODULE.read_text(encoding="utf-8")

        self.assertIn("{tone:'success'}", cascade_source)
        self.assertIn("const stopped = Boolean(e?.smartCascadeStopped)", cascade_source)
        self.assertIn("{tone:stopped ? 'neutral' : 'danger'}", cascade_source)


if __name__ == "__main__":
    unittest.main()
