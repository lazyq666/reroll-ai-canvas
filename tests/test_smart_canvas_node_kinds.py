import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NODE_KINDS = ROOT / "static" / "js" / "smart-canvas" / "node-kinds.js"


class SmartCanvasNodeKindsTests(unittest.TestCase):
    def test_generation_nodes_with_delivered_media_use_the_image_presentation_role(self):
        script = f"""
            global.window = global;
            require({json.dumps(str(NODE_KINDS))});
            const kinds = window.SmartCanvasModules.nodeKinds;
            process.stdout.write(JSON.stringify({{
                emptyImageGeneration:kinds.roleOf({{
                    type:'smart-image',referenceGenerationKind:'image',images:[]
                }}),
                pendingVideoGeneration:kinds.roleOf({{
                    type:'smart-image',referenceGenerationKind:'video',pending:1,images:[]
                }}),
                deliveredImage:kinds.roleOf({{
                    type:'smart-image',referenceGenerationKind:'image',generationOutputNode:true,
                    images:[{{url:'/result.png',kind:'image'}}]
                }}),
                deliveredVideo:kinds.roleOf({{
                    type:'smart-image',referenceGenerationKind:'video',generationOutputNode:true,
                    images:[{{url:'/result.mp4',kind:'video'}}]
                }}),
                layerDecomposition:kinds.roleOf({{type:'smart-layer-decomposition'}}),
            }}));
        """
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            {
                "emptyImageGeneration": "generation",
                "pendingVideoGeneration": "generation",
                "deliveredImage": "image",
                "deliveredVideo": "image",
                "layerDecomposition": "image",
            },
        )

    def test_prompt_and_dock_text_have_distinct_domain_roles(self):
        script = f"""
            global.window = global;
            require({json.dumps(str(NODE_KINDS))});
            const kinds = window.SmartCanvasModules.nodeKinds;
            process.stdout.write(JSON.stringify({{
                promptType:kinds.PROMPT,
                textAnnotationType:kinds.TEXT_ANNOTATION,
                promptRole:kinds.roleOf({{type:'smart-prompt'}}),
                promptGenerationRole:kinds.roleOf({{type:'smart-prompt',llmEnabled:true}}),
                textAnnotationRole:kinds.roleOf({{type:'smart-text'}}),
                textIsNotPrompt:kinds.isPrompt({{type:'smart-text'}}) === false,
                generationIsNotManualPrompt:kinds.isPrompt({{type:'smart-prompt',llmEnabled:true}}) === false,
                generationIsPromptFamily:kinds.isPromptFamily({{type:'smart-prompt',llmEnabled:true}}),
                generationIsExplicit:kinds.isPromptGeneration({{type:'smart-prompt',llmEnabled:true}}),
                promptIsNotAnnotation:kinds.isTextAnnotation({{type:'smart-prompt'}}) === false,
            }}));
        """
        result = subprocess.run(
            ["node", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            {
                "promptType": "smart-prompt",
                "textAnnotationType": "smart-text",
                "promptRole": "prompt",
                "promptGenerationRole": "prompt-generation",
                "textAnnotationRole": "text-annotation",
                "textIsNotPrompt": True,
                "generationIsNotManualPrompt": True,
                "generationIsPromptFamily": True,
                "generationIsExplicit": True,
                "promptIsNotAnnotation": True,
            },
        )

    def test_node_kind_module_loads_before_canvas_modules(self):
        page = (ROOT / "static" / "smart-canvas.html").read_text(encoding="utf-8")
        self.assertLess(
            page.index("/static/js/smart-canvas/node-kinds.js"),
            page.index("/static/js/smart-canvas/canvas-mutation.js"),
        )

    def test_prompt_creation_uses_prompt_label_not_generic_text_label(self):
        mutation = (
            ROOT / "static" / "js" / "smart-canvas" / "canvas-mutation.js"
        ).read_text(encoding="utf-8")
        self.assertIn("type:canvasMutationNodeKinds?.PROMPT || 'smart-prompt'", mutation)
        self.assertIn("title:String(data.title || canvasMutationText('smart.promptNode'))", mutation)
        self.assertNotIn("title:canvasMutationText('smart.kindText')", mutation)
        host = (ROOT / "static" / "js" / "smart-canvas.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("function smartPromptNodeTitle(node)", host)
        self.assertIn("return tr('smart.promptNode')", host)
        self.assertIn("nodeKinds.isPromptGeneration(node)", host)
        self.assertIn("return tr('smart.promptGenerationNode')", host)
        self.assertIn("canvasMutationText('smart.promptGenerationNode')", mutation)


if __name__ == "__main__":
    unittest.main()
