import json
import subprocess
import unittest
from pathlib import Path

from tests.smart_canvas_test_support import read_smart_canvas_scripts


ROOT = Path(__file__).resolve().parents[1]


class SmartCanvasContextMenuNavigationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = (ROOT / "static/smart-canvas.html").read_text(encoding="utf-8")
        cls.style = (ROOT / "static/css/smart-canvas.css").read_text(encoding="utf-8")
        cls.script = read_smart_canvas_scripts(ROOT)
        cls.server = (
            ROOT / "backend" / "main.py"
        ).read_text(encoding="utf-8")

    def test_context_menu_is_an_accessible_screen_space_portal(self):
        world = self.page.index('id="world"')
        menu = self.page.index('id="smartNodeContextMenu"')
        self.assertLess(world, menu)
        context_menu = self.page[menu:menu + 360]
        self.assertTrue(self.page[:menu].endswith('<ic-smart-node-context-menu '))
        self.assertIn('label="节点操作"', context_menu)
        self.assertIn('tabindex="0" aria-label="智能画布"', self.page)
        self.assertIn('smartNodeContextMenu.showAt(event.clientX, event.clientY, shell)', self.script)
        self.assertIn("smartNodeContextMenu.addEventListener('ic-select'", self.script)
        self.assertNotIn("smartNodeContextMenu.addEventListener('keydown'", self.script)
        self.assertIn("e.key === 'ContextMenu'", self.script)

    def test_create_menu_consumes_the_public_context_menu(self):
        start = self.page.index('id="createMenu"')
        end = self.page.index('id="fileInput"', start)
        menu = self.page[start:end]
        self.assertTrue(self.page[:start].endswith('<ic-menu '))
        self.assertIn('id="createMenu" class="create-menu"', menu)
        self.assertIn('trigger="dropdown" selection="command"', menu)
        self.assertIn('size="small"', menu)
        self.assertIn('data-legal-combination="dropdown-command-small"', menu)
        self.assertEqual(menu.count('<ic-menu-item'), 9)
        self.assertEqual(menu.count('kind="command"'), 9)
        self.assertNotIn('<button', menu)
        self.assertNotIn('smart-context-menu-', menu)
        self.assertNotIn("create-card", menu)
        expected_order = (
            'value="upload"', 'value="prompt"', 'value="generate"',
            'data-create-menu-structure-separator', 'value="group"', 'value="frame"',
            'value="splitter"', 'value="loop"', 'data-create-menu-paste-separator',
            'value="paste"', 'value="batch-import"',
        )
        positions = [menu.index(marker) for marker in expected_order]
        self.assertEqual(positions, sorted(positions))
        self.assertIn('value="upload" icon="upload" label="上传媒体" data-i18n-label="smart.uploadMedia"', menu)
        self.assertIn('value="generate" icon="generate" label="生成图片/视频" data-i18n-label="smart.action.generateMedia"', menu)
        self.assertIn('value="group" icon="group" label="编组" data-i18n-label="smart.group"', menu)
        self.assertIn('value="frame" icon="frame" label="分区" data-i18n-label="smart.frame"', menu)
        self.assertIn('value="paste" icon="paste" label="粘贴节点" data-i18n-label="smart.contextPaste" hidden disabled', menu)
        self.assertIn('value="batch-import" icon="upload" label="批量导入节点" data-i18n-label="smart.batchImportNodes" hidden', menu)
        self.assertIn('createMenu.showAt(event.clientX, event.clientY, shell)', self.script)
        self.assertIn("createMenu?.addEventListener('ic-select'", self.script)
        self.assertNotIn("createMenu?.addEventListener('keydown'", self.script)
        self.assertIn("if(type === 'upload')", self.script)
        self.assertIn("pendingGroupUploadPoint = groupId ? null : p", self.script)
        self.assertIn("else if(type === 'generate')", self.script)
        self.assertIn("created.referenceGenerationKind = 'image'", self.script)
        self.assertIn("created.title = tr('smart.generationNode')", self.script)
        self.assertIn("created.runSettings = settingsForStorage({", self.script)
        self.assertIn("render({syncVirtualization:false,nodeIds:[created.id]})", self.script)
        self.assertIn("if(type === 'batch-import')", self.script)
        self.assertIn("return openSmartNodePackageImportDialog()", self.script)

    def test_common_actions_support_single_and_multi_selection(self):
        for action in (
            "copy", "duplicate", "paste", "delete", "group-selection",
            "frame-selection", "clear-selection",
        ):
            self.assertIn(f"'{action}'", self.script)
        self.assertNotIn("'arrange-selection'", self.script)
        self.assertIn("function canvasMutationDuplicate(", self.script)
        self.assertIn("canvasMutationPlanDrafts(copies,{", self.script)
        self.assertIn("arrangement:'rigid'", self.script)
        self.assertNotIn("function canvasMutationDuplicateOffset(", self.script)
        self.assertIn("canvasMutation.duplicate({", self.script)
        self.assertIn("if((e.ctrlKey || e.metaKey) && key === 'd'", self.script)
        self.assertIn(
            "const liveIds = "
            "window.SmartCanvasModules.viewportSelection.selection.ids()",
            self.script,
        )

    def test_copy_as_image_uses_figma_shortcut_on_each_platform(self):
        self.assertIn(
            "if(key === 'copy-image') return apple ? '⇧⌘C' : 'Ctrl+Shift+C'",
            self.script,
        )
        self.assertEqual(
            self.script.count(
                "smartContextMenuItem('copy-image', tr('smart.contextCopyAsImage'), "
                "'copy-image', smartShortcutLabel('copy-image'))"
            ),
            2,
        )
        shortcut = "if((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && key === 'c'"
        plain_copy = "if((e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'c'"
        self.assertIn(shortcut, self.script)
        self.assertIn("const item = smartSelectedCopyImageItem()", self.script)
        self.assertIn("copySmartImageToClipboard(item)", self.script)
        self.assertLess(self.script.index(shortcut), self.script.index(plain_copy))

    def test_type_specific_actions_cover_media_groups_prompts_and_sections(self):
        for action in (
            "replace-media", "set-canvas-cover", "regenerate",
            "view-run-info", "extract-frame", "ungroup", "remove-media",
            "remove-media-from-group", "run-group", "remove-from-group", "disconnect-all",
            "edit-prompt", "save-prompt-preset", "run-loop", "rename-frame",
            "ungroup-frame", "delete-frame-all", "edit-text",
        ):
            self.assertIn(f"'{action}'", self.script)
        menu_start = self.script.index("function smartContextMenuSections")
        menu_end = self.script.index("\nfunction renderSmartNodeContextMenu", menu_start)
        node_menu = self.script[menu_start:menu_end]
        self.assertNotIn("'reverse-prompt'", node_menu)
        self.assertNotIn("'preview-media'", node_menu)
        self.assertNotIn("smartContextMenuItem('paste'", node_menu)
        toolbar_start = self.script.index("function smartNodeToolbarHtml")
        toolbar_end = self.script.index("\nfunction duplicateSmartNodeMediaToCanvas", toolbar_start)
        toolbar = self.script[toolbar_start:toolbar_end]
        self.assertIn("{key:'reverse-prompt'", toolbar)
        self.assertIn("openAiProcessorForSmartImage('reverse-prompt', nodeId, index)", self.script)
        self.assertIn("openCreateMenu(e, {allowPaste:true})", self.script)
        self.assertIn("if(type === 'paste') return pasteNodes(p)", self.script)
        self.assertNotIn("action === 'preview-media'", self.script)
        self.assertIn("function smartNodeHasRegenerationSnapshot", self.script)
        self.assertIn("function smartContextMenuSections", self.script)
        self.assertIn("cover_url:item.url", self.script)
        self.assertIn("canvas.cover_image", self.script)

    def test_inactive_prompt_text_is_a_node_context_target(self):
        editable_start = self.script.index("function isEditableTarget")
        editable_end = self.script.index("\nfunction safeScale", editable_start)
        editable = self.script[editable_start:editable_end]
        self.assertIn(
            '.prompt-node-text[contenteditable="false"]',
            editable,
        )
        self.assertIn("if(inactivePromptSurface) return false", editable)
        handler_start = self.script.index("shell.oncontextmenu = e => {")
        handler_end = self.script.index("\n};", handler_start)
        handler = self.script[handler_start:handler_end]
        self.assertLess(
            handler.index("isEditableTarget(e.target, {contextMenu:true})"),
            handler.index("const nodeEl = e.target.closest('.image-node')"),
        )

    def test_node_delete_button_is_replaced_by_context_menu(self):
        self.assertNotIn("node-delete", self.script)
        self.assertNotIn(".node-delete", self.style)
        self.assertNotIn("image-delete", self.script)
        self.assertNotIn(".mini-x", self.style)
        self.assertIn("smart.contextDelete", self.script)

    def test_figma_pointer_hand_and_temporary_pan_modes_are_wired(self):
        self.assertIn('id="smartHandTool"', self.page)
        self.assertIn("let smartBaseTool = 'pointer'", self.script)
        self.assertIn("function smartEffectiveTool()", self.script)
        self.assertIn("setSmartBaseTool(key === 'h' ? 'hand' : 'pointer')", self.script)
        self.assertIn("e.code === 'Space'", self.script)
        self.assertIn("event.button === 1", self.script)
        self.assertIn(
            "window.SmartCanvasModules.viewportSelection.selection.box.update(e)",
            self.script,
        )
        self.assertIn(".shell.tool-hand", self.style)
        self.assertIn(".shell.temporary-pan", self.style)

    def test_connection_cut_stops_canvas_selection_before_deleting(self):
        start = self.script.index("function smartConnectionLayerBindDelegatedEvents")
        end = self.script.index(
            "\n    function smartConnectionLayerEnsureSvg",
            start,
        )
        binding = self.script[start:end]
        self.assertIn("svg.addEventListener('mousedown'", binding)
        self.assertIn("event.stopPropagation()", binding)
        self.assertIn("dependencies.onDisconnect?.({", binding)
        self.assertIn("canvasMutation.disconnect({indexes});", self.script)

    def test_reverse_prompt_endpoint_rechecks_canvas_and_local_image(self):
        self.assertIn('@app.post("/api/smart-canvas/image-caption")', self.server)
        self.assertIn("load_canvas(payload.canvas_id, write=True)", self.server)
        self.assertIn('"/assets/"', self.server)
        self.assertNotIn('"/output/"', self.server)
        self.assertIn('"/api/storage-files/"', self.server)
        self.assertIn("Image.open(path)", self.server)
        self.assertIn("caption_image_with_provider", self.server)

    def test_reverse_prompt_opens_the_library_dialog_before_creating_a_node(self):
        start = self.script.index("async function openAiProcessorForSmartImage")
        end = self.script.index("function createPromptNodeFromContextText", start)
        body = self.script[start:end]
        self.assertIn("aiProcessorPromptGroups()", body)
        self.assertIn("aiProcessorModelEntries(processor==='reverse-prompt'?'text':'image')", body)
        self.assertIn("await ensureAiProcessorDialog()", body)
        self.assertIn("dialog.groups=groups", body)
        self.assertIn("dialog.models=aiProcessorDialogModels(models)", body)
        self.assertIn("await dialog.show()", body)
        self.assertNotIn("canvasMutation.create({", body)
        self.assertNotIn("smart.reversePromptInstruction", body)

    def test_reverse_prompt_confirmation_uses_selected_template_and_model(self):
        start = self.script.index("async function createAndRunReversePromptNode")
        end = self.script.index("async function aiProcessorSourceSize", start)
        body = self.script[start:end]
        self.assertIn("canvasMutation.create({", body)
        self.assertIn("llmEnabled:true", body)
        self.assertIn("llmInstruction:String(template.positive", body)
        self.assertIn("llmProvider:model.provider_id", body)
        self.assertIn("llmModel:model.model", body)
        self.assertIn("llmInputMedia:inputMedia", body)
        self.assertIn(
            "canvasMutation.connect({fromId:source.id,toId:node.id,input:true})",
            body,
        )
        self.assertIn("await runPromptLLMNode(node.id,{", body)
        self.assertIn("throwOnSubmissionFailure:true", body)
        self.assertIn("onAccepted:async()=>", body)
        self.assertNotIn("openSmartContextResult", body)
        self.assertIn("reveal:true", body)
        self.assertNotIn("stableHeight", body)
        self.assertNotIn("data:{w:", body)
        run_start = self.script.index("async function runPromptLLMNode")
        run_end = self.script.index("function ungroupNode", run_start)
        run_body = self.script[run_start:run_end]
        self.assertIn("textGenerationOutput:true", run_body)
        self.assertIn("textGenerationPending:true", run_body)
        self.assertIn("anchor:{kind:'source',sourceNodeId:node.id}", run_body)
        self.assertIn("relation:'downstream'", run_body)
        self.assertIn("arrangement:'single'", run_body)
        self.assertIn("reveal:true", run_body)
        self.assertNotIn("data:{w:", run_body)

    def test_reverse_prompt_node_declares_stable_source_placement(self):
        start = self.script.index("async function createAndRunReversePromptNode")
        end = self.script.index("async function aiProcessorSourceSize", start)
        body = self.script[start:end]
        result = subprocess.run(
            [
                "node",
                "-e",
                f"""
const nodes = [{{
    id:'source-1', type:'smart-image', x:20, y:30, w:240, h:180,
    images:[{{url:'source.png', kind:'image'}}]
}}];
let createRequest = null;
let ranNodeId = '';
const canvasMutation = {{
    history:() => true,
    create:request => {{
        createRequest = request;
        if(!request.options?.placement && request.options?.positionMode !== 'exact'){{
            throw new Error('Canvas Mutation create requires placement or exact mode');
        }}
        return {{id:'prompt-1', type:'smart-prompt', ...request.data}};
    }},
    connect:() => true,
    remove:() => true,
}};
const mediaKindForItem = item => item.kind;
const stripImageGenerationMeta = item => item;
const tr = key => key;
const render = () => {{}};
const canvasPersistence = {{schedule:() => {{}}}};
const toast = () => {{}};
const aiProcessorDialog = {{pending:true,hide:async () => {{}}}};
let aiProcessorDialogContext = {{}};
const runPromptLLMNode = async (nodeId, options) => {{ ranNodeId = nodeId; await options.onAccepted?.({{nodeId}}); }};
let selectedId = '';
let selectedIds = [];
let selectedImage = {{nodeId:'', index:-1}};
{body}
(async () => {{
    await createAndRunReversePromptNode(
        {{sourceNodeId:'source-1', imageIndex:0, libraryId:'system'}},
        {{id:'template-1', positive:'describe image'}},
        {{provider_id:'provider-1', model:'model-1'}}
    );
    process.stdout.write(JSON.stringify({{createRequest, ranNodeId}}));
}})().catch(error => {{
    console.error(error.message || error);
    process.exit(1);
}});
""",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        request = payload["createRequest"]
        self.assertNotIn("w", request["data"])
        self.assertNotIn("h", request["data"])
        self.assertTrue(request["data"]["llmEnabled"])
        self.assertEqual(request["data"]["llmInstruction"], "describe image")
        self.assertEqual(request["data"]["llmInputMedia"][0]["url"], "source.png")
        self.assertTrue(request["options"]["reveal"])
        self.assertEqual(
            request["options"]["placement"],
            {
                "anchor": {"kind": "source", "sourceNodeId": "source-1"},
                "relation": "downstream",
                "arrangement": "single",
            },
        )
        self.assertEqual(payload["ranNodeId"], "prompt-1")

    def test_reverse_prompt_dialog_is_created_lazily_from_the_formal_component(self):
        self.assertIn("customElements.whenDefined('ic-ai-processor-dialog')", self.script)
        self.assertIn("document.createElement('ic-ai-processor-dialog')", self.script)
        self.assertIn("addEventListener('ic-confirm'", self.script)
        self.assertIn("addEventListener('ic-cancel'", self.script)
        component = (ROOT / "static/js/infinite-canvas-ui/ai-processor-dialog.js").read_text(encoding="utf-8")
        self.assertIn("name.includes('反推')", component)

    def test_inactive_prompt_generation_editor_uses_node_context_menu(self):
        self.assertIn(
            "'.prompt-node-text, .prompt-llm-instruction'",
            self.script,
        )
        self.assertIn(
            "{editor, wasActive:document.activeElement === editor}",
            self.script,
        )
        self.assertIn(
            "isEditableTarget(e.target, {contextMenu:true})",
            self.script,
        )

    def test_image_menu_omits_editor_and_asset_library_actions(self):
        self.assertNotIn("smartContextMenuItem('edit-media'", self.script)
        self.assertNotIn('id="assetDestinationLibrary"', self.page)
        self.assertNotIn('id="assetDestinationCategory"', self.page)
        self.assertNotIn("openAssetDestinationPicker", self.script)
        self.assertNotIn("'add-selection-assets'", self.script)

    def test_delete_targets_selected_media_inside_smart_group(self):
        start = self.script.index("function smartDeleteSelectionTarget")
        end = self.script.index("\nfunction deleteSelectedSmartSelection", start)
        helper = self.script[start:end]
        result = subprocess.run(
            [
                "node",
                "-e",
                f"""
{helper}
const group = {{id:'group-1', type:'smart-group', images:[{{url:'a'}}, {{url:'b'}}], items:['prompt-1']}};
const prompt = {{id:'prompt-1', type:'smart-prompt', images:[]}};
const standalone = {{id:'image-1', type:'smart-image', images:[{{url:'c'}}]}};
const nodes = [group, prompt, standalone];
const targets = [
    smartDeleteSelectionTarget(nodes, 'group-1', [], {{nodeId:'group-1', index:1}}),
    smartDeleteSelectionTarget(nodes, 'prompt-1', [], {{nodeId:'', index:-1}}),
    smartDeleteSelectionTarget(nodes, 'image-1', [], {{nodeId:'image-1', index:0}}),
    smartDeleteSelectionTarget(nodes, '', ['group-1', 'prompt-1'], {{nodeId:'group-1', index:0}})
];
console.log(JSON.stringify(targets));
""",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout.strip(),
            (
                '[{"kind":"media","nodeId":"group-1","index":1},'
                '{"kind":"nodes","ids":["prompt-1"]},'
                '{"kind":"nodes","ids":["image-1"]},'
                '{"kind":"nodes","ids":["group-1","prompt-1"]}]'
            ),
        )
        self.assertIn("deleteSelectedSmartSelection({preserveFrameContents:", self.script)

    def test_delete_selected_group_media_keeps_container_and_other_members(self):
        target_start = self.script.index("function smartDeleteSelectionTarget")
        target_end = self.script.index("\nfunction deleteSelectedSmartSelection", target_start)
        delete_selected_start = target_end + 1
        delete_selected_end = self.script.index(
            "\nfunction smartShortcutLabel",
            delete_selected_start,
        )
        delete_image_start = self.script.index("function deleteImage")
        delete_image_end = self.script.index("\nasync function renameSmartNodeImage", delete_image_start)
        functions = (
            self.script[target_start:target_end]
            + "\n"
            + self.script[delete_selected_start:delete_selected_end]
            + "\n"
            + self.script[delete_image_start:delete_image_end]
        )
        result = subprocess.run(
            [
                "node",
                "-e",
                f"""
let nodes = [
    {{id:'group-1', type:'smart-group', title:'编组', images:[{{url:'a'}}, {{url:'b'}}], items:['prompt-1']}},
    {{id:'prompt-1', type:'smart-prompt', images:[]}}
];
let selectedId = 'group-1';
let selectedIds = [];
let selectedImage = {{nodeId:'group-1', index:1}};
const canvas = {{connections:[]}};
function render() {{}}
const canvasPersistence = {{schedule() {{}}}};
const canvasMutation = {{
    history() {{}},
    remove({{nodeIds}}) {{
        const ids = new Set(nodeIds);
        nodes = nodes.filter(node => !ids.has(node.id));
        nodes.forEach(node => {{
            if(Array.isArray(node.items)){{
                node.items = node.items.filter(id => !ids.has(id));
            }}
        }});
        if(ids.has(selectedId)) selectedId = '';
        selectedIds = selectedIds.filter(id => !ids.has(id));
        if(ids.has(selectedImage.nodeId)){{
            selectedImage = {{nodeId:'', index:-1}};
        }}
        return true;
    }},
}};
const smartContainer = {{
    remove(nodeIds, options={{}}) {{
        return canvasMutation.remove({{nodeIds, options}});
    }},
}};
{functions}
deleteSelectedSmartSelection();
const afterMediaDelete = JSON.parse(JSON.stringify({{nodes, selectedId, selectedImage}}));
selectedId = 'prompt-1';
selectedImage = {{nodeId:'', index:-1}};
deleteSelectedSmartSelection();
console.log(JSON.stringify({{afterMediaDelete, afterMemberDelete:{{nodes, selectedId, selectedImage}}}}));
""",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout.strip(),
            (
                '{"afterMediaDelete":{"nodes":['
                '{"id":"group-1","type":"smart-group","title":"编组","images":[{"url":"a"}],"items":["prompt-1"]},'
                '{"id":"prompt-1","type":"smart-prompt","images":[]}],'
                '"selectedId":"group-1","selectedImage":{"nodeId":"group-1","index":0}},'
                '"afterMemberDelete":{"nodes":['
                '{"id":"group-1","type":"smart-group","title":"编组","images":[{"url":"a"}],"items":[]}],'
                '"selectedId":"","selectedImage":{"nodeId":"","index":-1}}}'
            ),
        )

    def test_removing_one_of_two_generated_images_keeps_media_display_size(self):
        delete_image_start = self.script.index("function deleteImage")
        delete_image_end = self.script.index(
            "\nasync function renameSmartNodeImage",
            delete_image_start,
        )
        delete_image = self.script[delete_image_start:delete_image_end]
        geometry_module = ROOT / "static/js/smart-canvas/node-geometry.js"
        result = subprocess.run(
            [
                "node",
                "-e",
                f"""
const MEDIA_NODE_DEFAULT_SCALE = 2;
const MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE = 1.6;
const MEDIA_GROUP_DEFAULT_SCALE = 0.8;
const geometry = require({json.dumps(str(geometry_module))});
let nodes = [{{
    id:'generated-1',
    type:'smart-image',
    title:'Group',
    generationOutputNode:true,
    scale:MEDIA_GROUP_DEFAULT_SCALE,
    images:[
        {{url:'first.png', outputId:'output-1', natural_w:300, natural_h:200}},
        {{url:'second.png', outputId:'output-2', natural_w:300, natural_h:200}},
    ],
}}];
let selectedImage = {{nodeId:'generated-1', index:1}};
const canvasMutation = {{history() {{}}}};
const canvasPersistence = {{schedule() {{}}}};
function render() {{}}
function tr(key) {{ return key; }}
function generationOutputMediaDisplaySize() {{
    return {{width:300, height:200}};
}}
function preserveGenerationOutputMediaDisplaySize(node, size) {{
    node.generationMediaW = size.width;
    node.generationMediaH = size.height;
}}
{delete_image}
deleteImage('generated-1', 1);
const sizeAfterRemoval = geometry.createSession({{nodes, connections:[]}})
    .measure('generated-1').footprint;
console.log(JSON.stringify({{
    imageCount:nodes[0].images.length,
    sizeAfterRemoval,
}}));
""",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout.strip(),
            (
                '{"imageCount":1,'
                '"sizeAfterRemoval":{"x":0,"y":0,"width":300,"height":200}}'
            ),
        )

    def test_javascript_syntax(self):
        result = subprocess.run(
            ["node", "--check", str(ROOT / "static/js/smart-canvas.js")],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
