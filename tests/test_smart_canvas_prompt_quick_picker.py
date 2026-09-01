import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SmartCanvasPromptQuickPickerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = (ROOT / "static" / "smart-canvas.html").read_text(encoding="utf-8")
        cls.script = (ROOT / "static" / "js" / "smart-canvas.js").read_text(encoding="utf-8")
        cls.authoring = (
            ROOT / "static" / "js" / "smart-canvas" / "prompt-authoring.js"
        ).read_text(encoding="utf-8")
        cls.mutation = (
            ROOT / "static" / "js" / "smart-canvas" / "canvas-mutation.js"
        ).read_text(encoding="utf-8")
        cls.viewport = (
            ROOT / "static" / "js" / "smart-canvas" / "viewport-selection.js"
        ).read_text(encoding="utf-8")
        cls.styles = (ROOT / "static" / "css" / "smart-canvas.css").read_text(
            encoding="utf-8"
        )
        cls.mention_picker = (
            ROOT / "static" / "js" / "infinite-canvas-ui" / "mention-picker.js"
        ).read_text(encoding="utf-8")
        cls.i18n_loader = (ROOT / "static" / "js" / "i18n.js").read_text(
            encoding="utf-8"
        )

    def test_at_picker_uses_input_references_and_adds_an_attachment(self):
        self.assertIn("function inputMentionCandidateImages(node)", self.script)
        self.assertIn("function renderMentionPicker()", self.script)
        self.assertNotIn("/api/asset-library", self.script)
        self.assertIn("function selectMentionReference(item)", self.script)
        self.assertIn("addManualReferenceToNode(node, item, {", self.script)
        self.assertIn("preventDuplicate:true", self.script)
        self.assertIn("consumePromptTrigger('@')", self.script)
        self.assertIn("function promptQuickTargetNode()", self.script)
        self.assertIn("syncPromptNodeEditor(node, editor)", self.script)

    def test_slash_picker_inserts_editable_template_text(self):
        self.assertIn("function showPromptTemplateQuickPicker(", self.script)
        self.assertIn("function insertPromptTemplateText(template)", self.script)
        self.assertIn("document.createTextNode(`${text} `)", self.script)
        self.assertNotIn("function promptTemplateTokenMarkup", self.script)
        self.assertIn("savePromptDraftForCurrent()", self.script)
        self.assertIn("promptAuthoring.plainText(editor)", self.script)

    def test_prompt_node_uses_a_rich_editor_for_at_and_slash(self):
        self.assertIn('class="prompt-node-text prompt-node-control"', self.script)
        self.assertIn(
            'class="prompt-node-control prompt-llm-instruction"', self.script
        )
        self.assertIn('contenteditable="false"', self.script)
        self.assertIn("maybeOpenMentionPicker(editor, node", self.script)
        self.assertIn("handlePromptQuickPickerKeydown(event, editor)", self.script)
        self.assertIn("promptNodeEditorHtml(node)", self.script)
        self.assertIn("promptLlmInstructionEditorHtml(node)", self.script)
        self.assertIn("syncPromptLlmInstructionEditor(node, editor)", self.script)
        self.assertIn("llmInstructionHtml:String(data.llmInstructionHtml || '')", self.mutation)

    def test_typed_query_fuzzy_filters_references_and_templates(self):
        self.assertIn("function promptQuickTriggerAtCaret(", self.script)
        self.assertIn("function promptQuickFuzzyScore(", self.script)
        self.assertIn("function promptQuickRank(", self.script)
        self.assertIn("promptQuickQuery = trigger.query", self.script)
        self.assertIn("promptTemplateSearchText(item)", self.script)
        search_text_start = self.script.index("function promptTemplateSearchText(")
        search_text_end = self.script.index(
            "function activePromptTemplateGroups()", search_text_start
        )
        search_text = self.script[search_text_start:search_text_end]
        self.assertNotIn("template?.scene", search_text)
        self.assertNotIn("template?.scene_en", search_text)
        self.assertNotIn("template?.cover", search_text)
        template_picker_start = self.script.index(
            "function renderPromptTemplateQuickPicker()"
        )
        template_picker_end = self.script.index(
            "mentionPicker.items =", template_picker_start
        )
        template_search_fields = self.script[
            template_picker_start:template_picker_end
        ]
        self.assertIn("promptQuickTemplateCategoryLabel(item)", template_search_fields)
        self.assertNotIn(
            "promptLibraries.find(library => library.id === item.libraryId)?.name",
            template_search_fields,
        )
        self.assertIn("promptQuickDomPointAtTextOffset", self.script)
        self.assertIn("compositionstart", self.script)
        self.assertIn("compositionend", self.script)

    def test_only_a_newly_typed_trigger_can_open_the_picker(self):
        self.assertIn("quickOpenIntent(options={})", self.authoring)
        self.assertIn("allowOpen:promptAuthoring.quickOpenIntent(event)", self.script)
        self.assertIn("if(!activeSession && !allowOpen) return;", self.script)

    def test_space_closes_the_active_trigger_and_a_later_symbol_starts_fresh(self):
        script = textwrap.dedent(
            """
            const fs = require('fs');
            const vm = require('vm');
            const authoringSource = fs.readFileSync(__AUTHORING__, 'utf8');
            const hostSource = fs.readFileSync(__HOST__, 'utf8');
            const start = hostSource.indexOf('function promptQuickTriggerAtCaret');
            const end = hostSource.indexOf('\\nfunction promptQuickDomPointAtTextOffset', start);
            const sandbox = {
                window:{SmartCanvasModules:{smartContainer:{isGroup:()=>false}}},
                promptInput:null,
                currentText:'',
                promptQuickEditor:()=>null,
                textBeforeCaret:()=>sandbox.currentText,
                promptQuickNormalize:value=>String(value || '').trim().toLowerCase(),
            };
            vm.createContext(sandbox);
            vm.runInContext(authoringSource, sandbox);
            sandbox.promptAuthoring = sandbox.window.SmartCanvasModules.promptAuthoring;
            vm.runInContext(hostSource.slice(start, end), sandbox);
            const trigger = text => {
                sandbox.currentText = text;
                return sandbox.promptQuickTriggerAtCaret();
            };
            process.stdout.write(JSON.stringify({
                atSpace:trigger('@ '),
                slashSpace:trigger('/ '),
                atRestart:trigger('@ @'),
                slashRestart:trigger('/ /'),
            }));
            """
        ).replace("__AUTHORING__", json.dumps(str(ROOT / "static/js/smart-canvas/prompt-authoring.js"))).replace(
            "__HOST__", json.dumps(str(ROOT / "static/js/smart-canvas.js"))
        )
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(
            {
                "atSpace": None,
                "slashSpace": None,
                "atRestart": {"trigger": "@", "rawQuery": "", "query": "", "start": 2},
                "slashRestart": {"trigger": "/", "rawQuery": "", "query": "", "start": 2},
            },
            json.loads(result.stdout),
        )

    def test_visual_newlines_are_prompt_quick_picker_trigger_boundaries(self):
        self.assertIn("function promptQuickDomText(root)", self.script)
        self.assertIn("if(node.tagName === 'BR')", self.script)
        self.assertIn("return promptQuickRangeText(range);", self.script)
        self.assertIn("const length = promptQuickRangeText(probe).length", self.script)

    def test_picker_supports_arrow_navigation_enter_and_escape(self):
        handler_start = self.script.index("function handlePromptQuickPickerKeydown")
        handler_end = self.script.index("function insertMentionToken", handler_start)
        handler = self.script[handler_start:handler_end]
        self.assertIn("mentionPicker.handleKeydown?.(event)", handler)
        self.assertIn("event.key === 'Enter'", self.mention_picker)
        self.assertIn("event.key === 'Escape'", self.mention_picker)
        self.assertIn("event.key === 'ArrowDown'", self.mention_picker)
        self.assertIn("event.key === 'ArrowUp'", self.mention_picker)
        self.assertIn("ensureVisible: true", self.mention_picker)
        self.assertIn("scrollIntoView?.({ block: 'nearest' })", self.mention_picker)
        self.assertIn(
            "editor.onkeyup = event => {\n        if(event.key === 'ArrowDown' || event.key === 'ArrowUp') return;",
            self.script,
        )
        self.assertIn(
            "if(event.key === 'Escape' || event.key === 'ArrowDown' || event.key === 'ArrowUp') return;",
            self.script,
        )

    def test_clicking_elsewhere_in_composer_or_text_editor_closes_picker(self):
        composer_start = self.script.index("composer.addEventListener('pointerdown'")
        composer_end = self.script.index("composerFocusToggle?.addEventListener", composer_start)
        composer_handlers = self.script[composer_start:composer_end]
        self.assertIn(
            "composer.addEventListener('click', event => {",
            composer_handlers,
        )
        self.assertIn("}, true);", composer_handlers)
        self.assertIn("closeMentionPicker()", composer_handlers)
        rich_editor_start = self.script.index("function bindPromptNodeRichEditor")
        rich_editor_end = self.script.index("function bindPromptNodeControls", rich_editor_start)
        rich_editor = self.script[rich_editor_start:rich_editor_end]
        self.assertIn(
            "if(!event.target.closest?.('ic-mention-picker')) closeMentionPicker();",
            rich_editor,
        )
        self.assertNotIn(
            "!event.target.closest('#promptInput') && !event.target.closest('.prompt-node-text')",
            self.script,
        )

    def test_legacy_template_tags_expand_to_editable_text(self):
        self.assertIn("root.querySelectorAll?.('.prompt-template-token')", self.authoring)
        self.assertIn("document.createTextNode(token.dataset.promptText || '')", self.authoring)
        self.assertNotIn("type:'template'", self.authoring)
        self.assertIn("return escapeHtml(item.dataset.promptText || '')", self.script)

    def test_quick_picker_matches_the_requested_visual_language(self):
        picker_render = self.script.index("function renderPromptTemplateQuickPicker")
        picker_pointer_binding = self.script.index(
            "mentionPicker.show(presentation.anchor, {",
            picker_render,
        )
        picker_markup = self.script[picker_render:picker_pointer_binding]
        self.assertLess(picker_render, picker_pointer_binding)
        self.assertIn('<ic-mention-picker id="mentionPicker"', self.page)
        self.assertNotIn(".prompt-template-token", self.styles)
        self.assertNotIn(".prompt-quick-header", self.styles)
        self.assertNotIn(".prompt-quick-footer", self.styles)
        self.assertNotIn("promptQuickPickerHeaderMarkup", self.script)
        self.assertNotIn("promptQuickPickerFooterMarkup", self.script)
        self.assertNotIn(".prompt-quick-primary-tabs", self.styles)
        self.assertNotIn(".prompt-quick-category-tabs", self.styles)
        self.assertNotIn("data-quick-template-library", self.script)
        self.assertNotIn("data-quick-template-category", self.script)
        self.assertIn("function promptQuickTemplateItems()", self.script)
        self.assertIn("function promptQuickTemplateCategoryLabel(template)", self.script)
        self.assertIn(
            "if(library?.scope === 'canvas' || library?.id === 'canvas') return tr('smart.currentCanvas')",
            self.script,
        )
        self.assertIn("promptLibraries.flatMap", self.script)
        self.assertIn("icon:'book-text'", picker_markup)
        self.assertNotIn('data-lucide="wand-sparkles"', picker_markup)
        self.assertNotIn("prompt-template-quick-thumb", picker_markup)
        self.assertNotIn(".prompt-template-quick-icon", self.styles)
        self.assertNotIn(".prompt-template-quick-name", self.styles)
        self.assertNotIn(".prompt-template-quick-category", self.styles)
        self.assertIn("height:1.5rem", self.mention_picker)
        self.assertIn("width:auto", self.mention_picker)
        self.assertIn("max-width:60%", self.mention_picker)
        self.assertIn("color:var(--ui-color-text-secondary)", self.mention_picker)
        self.assertIn("color:var(--ui-color-text-tertiary)", self.mention_picker)
        self.assertIn(
            "max-height:var(--ic-mention-picker-max-height, 18rem)",
            self.mention_picker,
        )
        self.assertIn("function promptQuickPickerContainer", self.script)
        self.assertIn("function promptQuickPickerPresentation", self.script)
        self.assertIn("placement:'overlay-block-end'", self.script)
        self.assertIn("promptInput?.closest?.('.composer-card')", self.script)
        self.assertIn("editor?.closest?.('.image-node')", self.script)
        self.assertNotIn("function positionMentionPickerAtContainer", self.script)
        self.assertIn("`${anchor.width}px`", self.mention_picker)
        self.assertIn("const gap = rootFontSize * 0.25", self.mention_picker)
        self.assertNotIn("function scheduleMentionPickerPosition()", self.script)
        self.assertNotIn("window.scheduleMentionPickerPosition?.()", self.viewport)
        self.assertNotIn("positionMentionPickerAtCaret", self.script)
        self.assertIn("overflow-x:hidden", self.mention_picker)
        self.assertIn("overflow-y:auto", self.mention_picker)
        self.assertIn("var(--ui-shadow-raised)", self.mention_picker)
        self.assertNotIn(".mention-picker.prompt-quick-node-target", self.styles)
        self.assertNotIn("bindPromptQuickTabScrolling()", self.script)

    def test_changed_assets_are_cache_busted(self):
        self.assertRegex(self.page, r"smart-canvas\.css\?v=[^\"']+")
        self.assertRegex(self.page, r"prompt-authoring\.js\?v=[^\"']+")
        self.assertRegex(self.page, r"smart-canvas\.js\?v=[^\"']+")
        self.assertRegex(self.i18n_loader, r"const VERSION = 'i18n-[0-9a-f]{12}'")

    def test_canvas_media_pagination_appends_without_replacing_visible_items(self):
        script = textwrap.dedent(
            """
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(__HOST__, 'utf8');
            const start = source.indexOf('function mentionMediaIdentityKeys');
            const end = source.indexOf('\\nfunction showMentionPicker', start);
            const candidates = Array.from({length:61}, (_, index) => ({
                id:'media-' + index,
                url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
                name:'媒体 ' + index,
                kind:'image',
                width:1,
                height:1
            }));
            const mentionPicker = {
                setAttribute:()=>{}, show:()=>{},
                set tabs(value){}, set activeTab(value){},
                set loading(value){}, set error(value){},
                set hasMore(value){ this.hasMoreValue = value; },
                set items(value){ this.itemsValue = value; }
            };
            const sandbox = {
                URLSearchParams,
                mentionSourceTab:'canvas', mentionLastQuery:'', promptQuickQuery:'',
                mentionCanvasOffset:60, mentionAssetItems:[], mentionAssetCursor:'',
                mentionAssetLoading:false, mentionAssetLoaded:false,
                mentionAssetError:'', mentionAssetRequest:0,
                promptQuickPickerItems:[], promptQuickPickerMode:'', mentionInsertMode:'token',
                mentionPicker, promptInput:{}, composer:null,
                queueMicrotask:()=>{}, fetch:async()=>({ok:true,json:async()=>({})}),
                inputMentionCandidateImages:()=>candidates, promptQuickTargetNode:()=>null,
                promptQuickNormalize:value=>String(value), inputRefKey:item=>item.id,
                mediaKindForItem:item=>item.kind||'image', smartMediaPreviewUrl:item=>item.url,
                tr:key=>key, promptQuickEditor:()=>({}),
                promptQuickPickerPresentation:()=>({anchor:null}),
                renderInputThumbsRow:()=>{}, smartResponseErrorMessage:async()=>''
            };
            vm.createContext(sandbox);
            vm.runInContext(source.slice(start,end),sandbox);
            sandbox.renderMentionPicker();
            process.stdout.write(JSON.stringify({
                count:mentionPicker.itemsValue.length,
                first:mentionPicker.itemsValue[0]?.value,
                last:mentionPicker.itemsValue.at(-1)?.value,
                hasMore:mentionPicker.hasMoreValue
            }));
            """
        ).replace("__HOST__", json.dumps(str(ROOT / "static/js/smart-canvas.js")))
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(
            {"count": 61, "first": "media-0", "last": "media-60", "hasMore": False},
            json.loads(result.stdout),
        )

    def test_media_picker_does_not_truncate_cumulative_pages(self):
        self.assertNotIn("value.slice(0, 60).map(normalizeItem)", self.mention_picker)
        self.assertIn(
            "mentionAssetItems = mentionAssetItems.concat(loadedItems.filter",
            self.script,
        )
        self.assertNotIn(
            "mentionPicker.setActiveIndex(0, {ensureVisible:true})", self.script
        )

    def test_empty_asset_library_finishes_loading_without_refetch_loop(self):
        script = textwrap.dedent(
            """
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(__HOST__, 'utf8');
            const start = source.indexOf('function mentionMediaIdentityKeys');
            const end = source.indexOf('\\nfunction showMentionPicker', start);
            const microtasks = [];
            let fetchCount = 0;
            const mentionPicker = {
                setAttribute:()=>{},
                show:()=>{},
                set tabs(value){},
                set activeTab(value){},
                set loading(value){ this.loadingValue = value; },
                set error(value){},
                set hasMore(value){},
                set items(value){ this.itemCount = value.length; }
            };
            const sandbox = {
                URLSearchParams,
                mentionSourceTab:'assets', mentionLastQuery:'', promptQuickQuery:'',
                mentionCanvasOffset:0, mentionAssetItems:[], mentionAssetCursor:'',
                mentionAssetLoading:false, mentionAssetLoaded:false,
                mentionAssetError:'', mentionAssetRequest:0,
                promptQuickPickerItems:[], promptQuickPickerMode:'', mentionInsertMode:'token',
                mentionPicker, promptInput:{}, composer:null,
                queueMicrotask:callback=>microtasks.push(callback),
                fetch:async()=>{ fetchCount += 1; return {ok:true,json:async()=>({items:[],next_cursor:''})}; },
                inputMentionCandidateImages:()=>[], promptQuickTargetNode:()=>null,
                promptQuickNormalize:value=>String(value), inputRefKey:()=>'',
                mediaKindForItem:item=>item.kind||'image', smartMediaPreviewUrl:item=>item.url,
                tr:key=>key, promptQuickEditor:()=>({}),
                promptQuickPickerPresentation:()=>({anchor:null}),
                renderInputThumbsRow:()=>{}, smartResponseErrorMessage:async()=>''
            };
            vm.createContext(sandbox);
            vm.runInContext(source.slice(start,end),sandbox);
            (async()=>{
                sandbox.renderMentionPicker();
                for(let index=0; index<3 && microtasks.length; index += 1){
                    await microtasks.shift()();
                }
                process.stdout.write(JSON.stringify({
                    fetchCount,
                    queuedMicrotasks:microtasks.length,
                    loading:mentionPicker.loadingValue,
                    itemCount:mentionPicker.itemCount
                }));
            })().catch(error=>{ console.error(error); process.exitCode=1; });
            """
        ).replace("__HOST__", json.dumps(str(ROOT / "static/js/smart-canvas.js")))
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(0, result.returncode, result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(1, value["fetchCount"])
        self.assertEqual(0, value["queuedMicrotasks"])
        self.assertFalse(value["loading"])
        self.assertEqual(0, value["itemCount"])

    def test_referenced_media_is_decorated_numbered_and_sorted_first(self):
        script = textwrap.dedent(
            """
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(__HOST__, 'utf8');
            const start = source.indexOf('function mentionMediaIdentityKeys');
            const end = source.indexOf('\\nfunction renderMentionPicker', start);
            const node = {id:'target'};
            const references = [
                {url:'media://scene', media_id:'scene-a', kind:'image'},
                {url:'media://role', kind:'image'}
            ];
            const candidates = [
                {url:'media://other', name:'其他原名', kind:'image'},
                {url:'media://role', name:'角色原名', kind:'image'},
                {url:'media://scene', media_id:'scene-b', name:'场景版本 B', kind:'image'},
                {url:'media://scene', media_id:'scene-a', name:'场景原名', kind:'image'}
            ];
            const sandbox = {
                visibleReferenceImagesFor:()=>references,
                composerInputMediaLabel:(ref, counters) => {
                    counters.image = (counters.image || 0) + 1;
                    return '图片' + counters.image;
                },
                inputRefKey:item=>'url|' + item.url,
                mediaKindForItem:item=>item.kind,
                smartMediaPreviewUrl:item=>item.url,
                tr:key=>key
            };
            vm.createContext(sandbox);
            vm.runInContext(source.slice(start,end),sandbox);
            const decorated = sandbox.mentionPickerCandidatesWithReferenceState(candidates,node);
            const pickerItems = decorated.map(sandbox.mentionPickerMediaItem);
            process.stdout.write(JSON.stringify({
                urls:decorated.map(item=>item.url),
                labels:pickerItems.map(item=>item.label),
                badges:pickerItems.map(item=>item.badge),
                leading:pickerItems.map(item=>item.leading)
            }));
            """
        ).replace("__HOST__", json.dumps(str(ROOT / "static/js/smart-canvas.js")))
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(
            {
                "urls": ["media://scene", "media://role", "media://other", "media://scene"],
                "labels": ["图片1", "图片2", "其他原名", "场景版本 B"],
                "badges": ["图片1", "图片2", "", ""],
                "leading": [True, True, False, False],
            },
            json.loads(result.stdout),
        )

    def test_picker_selection_does_not_add_an_existing_media_reference(self):
        script = textwrap.dedent(
            """
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(__HOST__, 'utf8');
            const start = source.indexOf('function addManualReferenceToNode');
            const end = source.indexOf('\\nfunction addManualReferenceToSelectedNode', start);
            let closed = 0;
            let rendered = 0;
            let history = 0;
            const existing = {url:'media://scene', inputInstanceId:'manual_existing'};
            const node = {id:'target', manualInputRefs:[existing]};
            const sandbox = {
                mentionReferenceStateForNode:()=>new Map(),
                mentionReferenceStateForItem:()=>({ref:existing}),
                closeMentionPicker:()=>{ closed += 1; },
                renderInputThumbsRow:()=>{ rendered += 1; },
                window:{SmartCanvasModules:{
                    viewportSelection:{selection:{node:()=>node}},
                    referenceInstances:{manual:()=>{ throw new Error('duplicate was recreated'); }}
                }},
                canvasMutation:{history:()=>{ history += 1; }}
            };
            vm.createContext(sandbox);
            vm.runInContext(source.slice(start,end),sandbox);
            const result = sandbox.addManualReferenceToNode(
                node,
                {url:'media://scene'},
                {closePicker:true, preventDuplicate:true}
            );
            process.stdout.write(JSON.stringify({result, closed, rendered, history}));
            """
        ).replace("__HOST__", json.dumps(str(ROOT / "static/js/smart-canvas.js")))
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(0, result.returncode, result.stderr)
        value = json.loads(result.stdout)
        self.assertFalse(value["result"]["added"])
        self.assertTrue(value["result"]["duplicate"])
        self.assertEqual("manual_existing", value["result"]["ref"]["inputInstanceId"])
        self.assertEqual(1, value["closed"])
        self.assertEqual(1, value["rendered"])
        self.assertEqual(0, value["history"])

    def test_picker_inserts_a_token_for_an_existing_reference(self):
        script = textwrap.dedent(
            """
            const fs = require('fs');
            const vm = require('vm');
            const source = fs.readFileSync(__HOST__, 'utf8');
            const start = source.indexOf('function selectMentionReference(item)');
            const end = source.indexOf('\\nfunction addManualReferenceToNode', start);
            let inserted = [];
            let focused = 0;
            const promptInput = {dataset:{}, focus:()=>{ focused += 1; }};
            const node = {id:'target'};
            const existing = {url:'media://existing', inputInstanceId:'manual_existing'};
            const sandbox = {
                promptInput,
                mentionInsertMode:'token',
                promptQuickEditor:()=>promptInput,
                promptQuickTargetNode:()=>node,
                consumePromptTrigger:()=>{},
                syncPromptLlmInstructionEditor:()=>{},
                syncPromptNodeEditor:()=>{},
                addManualReferenceToNode:()=>({
                    added:false,
                    duplicate:true,
                    node,
                    ref:existing
                }),
                insertMentionToken:(ref, editor)=>inserted.push({ref, editor}),
                savePromptDraftForCurrent:()=>{},
                render:()=>{},
                requestAnimationFrame:callback=>callback(),
                beginPromptNodeTextEdit:()=>{},
                canvasPersistence:{schedule:()=>{}}
            };
            vm.createContext(sandbox);
            vm.runInContext(source.slice(start,end),sandbox);
            sandbox.selectMentionReference(existing);
            process.stdout.write(JSON.stringify({
                inserted:inserted.length,
                inputInstanceId:inserted[0]?.ref?.inputInstanceId || '',
                focused
            }));
            """
        ).replace("__HOST__", json.dumps(str(ROOT / "static/js/smart-canvas.js")))
        result = subprocess.run(
            ["node", "-e", script], cwd=ROOT, capture_output=True, text=True
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(
            {"inserted": 1, "inputInstanceId": "manual_existing", "focused": 1},
            json.loads(result.stdout),
        )


if __name__ == "__main__":
    unittest.main()
