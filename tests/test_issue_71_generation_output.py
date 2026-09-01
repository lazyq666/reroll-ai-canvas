import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PENDING_MODULE = ROOT / "static/js/smart-canvas/generation-pending.js"
OUTPUT_MODULE = ROOT / "static/js/smart-canvas/generation-output.js"
MUTATION_MODULE = ROOT / "static/js/smart-canvas/canvas-mutation.js"
RUN_MODULE = ROOT / "static/js/smart-canvas/generation-run.js"


class Issue71GenerationOutputTests(unittest.TestCase):
    def run_node(self, body: str):
        script = textwrap.dedent(
            f"""
            const fs = require('fs');
            const vm = require('vm');
            const pendingSource = fs.readFileSync({json.dumps(str(PENDING_MODULE))}, 'utf8');
            const outputSource = fs.readFileSync({json.dumps(str(OUTPUT_MODULE))}, 'utf8');
            let nextId = 0;
            const sandbox = {{
                window:{{SmartCanvasModules:{{
                    canvasMutation:{{
                        create:()=>null,
                        connect:()=>true,
                    }},
                }}}},
                canvas:{{connections:[]}}, nodes:[],
                selectedId:'', selectedImage:{{nodeId:'',index:-1}},
                activeComposerSubject:null, lastComposerNodeId:'',
                MEDIA_NODE_DEFAULT_SCALE:1,
                MEDIA_GROUP_DEFAULT_SCALE:0.9,
                MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE:0.8,
                uid:prefix => `${{prefix}}-${{++nextId}}`,
                nowMs:() => 200,
                nodeRect:node => ({{x:node?.x||0,y:node?.y||0,width:200,height:120}}),
                pendingBoxSize:() => ({{w:260,h:180}}),
                isSmartImageNode:node => node?.type === 'smart-image',
                isHistoryGroupNode:()=>false,
                attachRunMeta:(node, meta) => Object.assign(node, meta ? {{runPrompt:meta.prompt}} : {{}}),
                stripRunInputMeta:meta => meta,
                stripImageGenerationMeta:item => item,
                resultMediaUrls:value => Array.isArray(value) ? value : [value],
                copyMediaSizeFields:(source, target) => ({{...target}}),
                liveSmartNode:node => node,
                markSmartNodeComplete:node => {{ node.pending=0; node.running=false; return node; }},
                downstreamNodesForId:()=>[], mediaNodeDefaultScale:()=>1,
                clearSourceBusyStateIfDownstreamDone:()=>false,
                tr:key => key,
            }};
            vm.createContext(sandbox);
            vm.runInContext(pendingSource, sandbox);
            vm.runInContext(outputSource, sandbox);
            const output = sandbox.window.SmartCanvasModules.generationOutput;
            {body}
            """
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_duplicate_urls_collapse_to_one_stable_generation_output(self):
        payload = self.run_node(
            """
            const node = {
                id:'node-a', type:'smart-image',
                images:[
                    {url:'a.png',kind:'image',outputId:'out-a'},
                    {url:'same.png',kind:'image',outputId:'out-b-first'},
                    {url:'same.png',kind:'image',outputId:'out-b-selected'},
                ],
                activeOutputId:'out-b-selected',
            };
            output.ensureNodeState({node});
            const firstPass = node.images.map(item => item.outputId);
            const activeUrl = node.images.find(item => item.outputId === node.activeOutputId)?.url || '';
            output.ensureNodeState({node});
            process.stdout.write(JSON.stringify({
                count:node.images.length,
                urls:node.images.map(item => item.url),
                ids:firstPass,
                activeOutputId:node.activeOutputId,
                activeUrl,
                stable:firstPass.join('|') === node.images.map(item => item.outputId).join('|'),
            }));
            """
        )
        self.assertEqual(payload["count"], 2)
        self.assertEqual(payload["urls"], ["a.png", "same.png"])
        self.assertEqual(len(set(payload["ids"])), 2)
        self.assertEqual(payload["activeUrl"], "same.png")
        self.assertEqual(payload["activeOutputId"], payload["ids"][1])
        self.assertTrue(payload["stable"])

    def test_completion_does_not_steal_selection_changed_during_run(self):
        payload = self.run_node(
            """
            const node = {
                id:'node-a', type:'smart-image',
                images:[
                    {url:'a.png',kind:'image',outputId:'out-a'},
                    {url:'b.png',kind:'image',outputId:'out-b'},
                ],
                activeOutputId:'out-a',
            };
            const snapshot = output.submissionSnapshot({node});
            node.activeOutputId = 'out-b';
            output.apply({
                node,
                outputs:[{url:'c.png',kind:'image'}],
                strategy:'append',
                submissionSnapshot:snapshot,
            });
            process.stdout.write(JSON.stringify({
                activeOutputId:node.activeOutputId,
                outputCount:node.images.length,
                hasNewOutput:node.hasNewGenerationOutput,
            }));
            """
        )
        self.assertEqual(payload["activeOutputId"], "out-b")
        self.assertEqual(payload["outputCount"], 3)
        self.assertTrue(payload["hasNewOutput"])

    def test_partial_task_results_ignore_replayed_outputs_and_keep_active_selection(self):
        payload = self.run_node(
            """
            const node = {
                id:'node-a', type:'smart-image',
                images:[{url:'old.png',kind:'image',outputId:'out-old'}],
                activeOutputId:'out-old',
                pendingTasks:[{taskId:'one'},{taskId:'two'}],
                pending:2,
            };
            output.apply({
                node,
                outputs:[
                    {url:'same.png',kind:'image'},
                    {url:'same.png',kind:'image'},
                ],
                kind:'image', strategy:'task', taskId:'one',
            });
            output.apply({
                node, outputs:[], kind:'image', strategy:'task', taskId:'two',
            });
            process.stdout.write(JSON.stringify({
                urls:node.images.map(item => item.url),
                ids:node.images.map(item => item.outputId),
                activeOutputId:node.activeOutputId,
                hasNewOutput:node.hasNewGenerationOutput,
            }));
            """
        )
        self.assertEqual(payload["urls"], ["old.png", "same.png"])
        self.assertEqual(len(set(payload["ids"])), 2)
        self.assertEqual(payload["activeOutputId"], "out-old")
        self.assertTrue(payload["hasNewOutput"])

    def test_duplicate_uses_selected_output_and_connected_generation_references(self):
        payload = self.run_node(
            """
            const source = {
                id:'node-b', type:'smart-image', generationOutputNode:true,
                images:[
                    {url:'b1.png',kind:'image',outputId:'out-b1',inputInstanceId:'source-input'},
                    {url:'b2.png',kind:'image',outputId:'out-b2'},
                    {url:'b3.png',kind:'image',outputId:'out-b3'},
                    {url:'b4.png',kind:'image',outputId:'out-b4'},
                ],
                activeOutputId:'out-b2',
                runInputRefs:[{
                    url:'b1.png', nodeId:'node-b', imageIndex:0,
                    outputId:'out-b1', kind:'image',
                }],
                runPromptRefs:[{
                    url:'b1.png', nodeId:'node-b', imageIndex:0,
                    outputId:'out-b1', kind:'image',
                }],
                runPrompt:'combine the two references',
                runSettings:{engine:'api'},
            };
            const connectedRefs = [
                {url:'same.png',nodeId:'reference-group',imageIndex:0,kind:'image',inputInstanceId:'instance-a'},
                {url:'same.png',nodeId:'reference-group',imageIndex:1,kind:'image',inputInstanceId:'instance-b'},
            ];
            sandbox.activeInputImagesFor = node =>
                node.id === source.id ? connectedRefs.map(ref => ({...ref})) : [];
            const firstCopy = JSON.parse(JSON.stringify(source));
            output.prepareDuplicate({source,copy:firstCopy});
            firstCopy.id = 'node-b-copy';
            const secondCopy = JSON.parse(JSON.stringify(firstCopy));
            output.prepareDuplicate({source:firstCopy,copy:secondCopy});
            process.stdout.write(JSON.stringify({
                selectedUrl:firstCopy.images[0]?.url || '',
                selectedId:firstCopy.images[0]?.outputId || '',
                selectedInputInstanceId:firstCopy.images[0]?.inputInstanceId || '',
                sourceSelectedId:source.activeOutputId,
                recipeUrls:firstCopy.recipeSourceRefs.map(ref => ref.url),
                runInputUrls:firstCopy.runInputRefs.map(ref => ref.url),
                runPromptUrls:firstCopy.runPromptRefs.map(ref => ref.url),
                repeatedRecipeUrls:secondCopy.recipeSourceRefs.map(ref => ref.url),
            }));
            """
        )
        self.assertEqual(payload["selectedUrl"], "b2.png")
        self.assertNotEqual(payload["selectedId"], payload["sourceSelectedId"])
        self.assertEqual(payload["selectedInputInstanceId"], "")
        self.assertEqual(payload["recipeUrls"], ["same.png", "same.png"])
        self.assertEqual(payload["runInputUrls"], ["same.png", "same.png"])
        self.assertEqual(payload["runPromptUrls"], ["same.png", "same.png"])
        self.assertEqual(payload["repeatedRecipeUrls"], ["same.png", "same.png"])

    def test_deferred_batch_selects_first_new_output_only_if_selection_is_unchanged(self):
        payload = self.run_node(
            """
            const unchanged = {
                id:'unchanged', type:'smart-image', generationOutputNode:true,
                images:[{url:'old.png',kind:'image',outputId:'out-old'}],
                activeOutputId:'out-old',
                pendingTasks:[{
                    taskId:'task-a',
                    submissionSnapshot:{activeOutputId:'out-old',outputCount:1},
                }],
                pending:1,
            };
            output.apply({
                node:unchanged, taskId:'task-a', strategy:'task',
                outputs:[{url:'new.png',kind:'image'}],
            });
            const changed = {
                id:'changed', type:'smart-image', generationOutputNode:true,
                images:[
                    {url:'a.png',kind:'image',outputId:'out-a'},
                    {url:'b.png',kind:'image',outputId:'out-b'},
                ],
                activeOutputId:'out-b',
                pendingTasks:[{
                    taskId:'task-b',
                    submissionSnapshot:{activeOutputId:'out-a',outputCount:2},
                }],
                pending:1,
            };
            output.apply({
                node:changed, taskId:'task-b', strategy:'task',
                outputs:[{url:'c.png',kind:'image'}],
            });
            process.stdout.write(JSON.stringify({
                unchangedActive:unchanged.images.find(
                    item => item.outputId === unchanged.activeOutputId
                )?.url,
                changedActive:changed.activeOutputId,
                changedHasNew:changed.hasNewGenerationOutput,
            }));
            """
        )
        self.assertEqual(payload["unchangedActive"], "new.png")
        self.assertEqual(payload["changedActive"], "out-b")
        self.assertTrue(payload["changedHasNew"])

    def test_queued_completion_appends_and_honors_submission_selection_snapshot(self):
        payload = self.run_node(
            """
            const unchanged = {
                id:'unchanged', type:'smart-image', generationOutputNode:true,
                images:[{url:'old.png',kind:'image',outputId:'out-old'}],
                activeOutputId:'out-old',
                jimengPending:{
                    submitId:'queued-a', kind:'image',
                    submissionSnapshot:{activeOutputId:'out-old',outputCount:1},
                },
            };
            output.apply({
                node:unchanged, strategy:'queued',
                outputs:[{url:'new.png',kind:'image'}],
                submissionSnapshot:unchanged.jimengPending.submissionSnapshot,
            });
            const changed = {
                id:'changed', type:'smart-image', generationOutputNode:true,
                images:[
                    {url:'a.png',kind:'image',outputId:'out-a'},
                    {url:'b.png',kind:'image',outputId:'out-b'},
                ],
                activeOutputId:'out-b',
                jimengPending:{
                    submitId:'queued-b', kind:'image',
                    submissionSnapshot:{activeOutputId:'out-a',outputCount:2},
                },
            };
            output.apply({
                node:changed, strategy:'queued',
                outputs:[{url:'c.png',kind:'image'}],
                submissionSnapshot:changed.jimengPending.submissionSnapshot,
            });
            process.stdout.write(JSON.stringify({
                unchangedUrls:unchanged.images.map(item => item.url),
                unchangedActive:unchanged.images.find(
                    item => item.outputId === unchanged.activeOutputId
                )?.url,
                changedUrls:changed.images.map(item => item.url),
                changedActive:changed.activeOutputId,
                changedHasNew:changed.hasNewGenerationOutput,
            }));
            """
        )
        self.assertEqual(payload["unchangedUrls"], ["old.png", "new.png"])
        self.assertEqual(payload["unchangedActive"], "new.png")
        self.assertEqual(payload["changedUrls"], ["a.png", "b.png", "c.png"])
        self.assertEqual(payload["changedActive"], "out-b")
        self.assertTrue(payload["changedHasNew"])

    def test_recovery_success_assigns_applied_additions_before_counting(self):
        recovery = (ROOT / "static/js/smart-canvas/generation-recovery.js").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            "const additions = generationRecoveryOutputModule.apply({", recovery
        )
        self.assertIn("submissionSnapshot:{...task.submissionSnapshot}", recovery)

    def test_legacy_group_migration_pins_outgoing_connection_identity(self):
        payload = self.run_node(
            """
            sandbox.isHistoryGroupNode = node => Boolean(node?.historyFor);
            const owner = {
                id:'owner',type:'smart-image',generationOutputNode:true,
                images:[{url:'current.png',kind:'image',outputId:'current'}],
                activeOutputId:'current',
            };
            const legacy = {
                id:'legacy',type:'smart-image',historyFor:'owner',
                images:[
                    {url:'history-a.png',kind:'image',outputId:'history-a'},
                    {url:'history-b.png',kind:'image',outputId:'history-b'},
                ],
                activeOutputId:'history-b',
            };
            const consumer = {id:'consumer',type:'smart-image',images:[]};
            sandbox.nodes.push(owner, legacy, consumer);
            sandbox.canvas.nodes = sandbox.nodes;
            sandbox.canvas.connections = [
                {from:'owner',to:'legacy',kind:'history'},
                {from:'legacy',to:'consumer',kind:'input'},
            ];
            const migrated = output.migrateLegacyGroups();
            const connection = sandbox.canvas.connections.find(item => item.to === 'consumer');
            process.stdout.write(JSON.stringify({
                migrated,
                from:connection?.from,
                sourceOutputId:connection?.sourceOutputId,
                legacyRemoved:!sandbox.nodes.some(node => node.id === 'legacy'),
            }));
            """
        )
        self.assertTrue(payload["migrated"])
        self.assertEqual(payload["from"], "owner")
        self.assertEqual(payload["sourceOutputId"], "history-b")
        self.assertTrue(payload["legacyRemoved"])

    def test_source_files_encode_new_node_regeneration_and_recipe_duplicate(self):
        mutation = MUTATION_MODULE.read_text(encoding="utf-8")
        run = RUN_MODULE.read_text(encoding="utf-8")
        regenerate = run[run.index("async function regenerateGenerationRun") :]

        self.assertIn("generationOutputModule.prepareDuplicate", mutation)
        self.assertIn("generationOutputModule.createPending({", regenerate)
        self.assertIn("strategy:'pending'", regenerate)
        self.assertNotIn("strategy:'append'", regenerate)
        self.assertIn("inheritSourceConnections", regenerate)
        self.assertNotIn("const shouldCreateBranchOutput = groupRun || (nodeHasImages", run)
        self.assertIn("submissionSnapshot", regenerate)
        self.assertNotIn("generationOutputEnsureHistoryGroup", OUTPUT_MODULE.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
