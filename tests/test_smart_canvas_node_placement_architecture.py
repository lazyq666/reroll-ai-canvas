import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SMART = ROOT / "static" / "js" / "smart-canvas"
HOST = ROOT / "static" / "js" / "smart-canvas.js"


class SmartCanvasNodePlacementArchitectureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.host = HOST.read_text(encoding="utf-8")
        cls.geometry = (SMART / "node-geometry.js").read_text(encoding="utf-8")
        cls.placement = (SMART / "node-placement.js").read_text(encoding="utf-8")
        cls.mutation = (SMART / "canvas-mutation.js").read_text(encoding="utf-8")
        cls.interaction = (SMART / "canvas-interaction.js").read_text(
            encoding="utf-8"
        )
        cls.container = (SMART / "smart-container.js").read_text(
            encoding="utf-8"
        )
        cls.output = (SMART / "generation-output.js").read_text(encoding="utf-8")
        cls.cascade = (SMART / "generation-cascade.js").read_text(encoding="utf-8")
        cls.studio = (SMART / "image-studio.js").read_text(encoding="utf-8")

    def test_placement_is_a_pure_deep_module_with_one_public_interface(self):
        self.assertIn("return Object.freeze({plan});", self.placement)
        self.assertIn("geometry.createSession", self.placement)
        for forbidden in (
            "document.",
            "localStorage",
            "fetch(",
            "XMLHttpRequest",
            "render(",
            "canvasPersistence",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, self.placement)
        for leaked_policy in (
            "maxCandidates",
            "maxRings",
            "safetyLeft",
            "candidateList",
        ):
            self.assertNotIn(leaked_policy, self.placement)

    def test_legacy_distributed_search_and_post_completion_shifting_are_deleted(self):
        combined = "\n".join(
            (self.host, self.output, self.cascade, self.studio, self.mutation)
        )
        for removed in (
            "generationOutputFindBatchPosition",
            "generationOutputNextPosition",
            "generationOutputShiftFollowingNodes",
            "openNodePositionNear",
            "canvasMutationDuplicateOffset",
            "canvasMutationRectsOverlap",
        ):
            with self.subTest(removed=removed):
                self.assertNotIn(removed, combined)
        for caller in (
            self.host,
            self.output,
            self.cascade,
            self.studio,
            self.mutation,
        ):
            self.assertNotRegex(caller, r"for\s*\([^\n]*\bring\b")

    def test_automatic_entrypoints_delegate_semantic_intent_to_canvas_mutation(self):
        self.assertIn("canvasMutationPlanDrafts([node], options.placement)", self.mutation)
        self.assertIn("options.positionMode !== 'exact'", self.mutation)
        self.assertIn("canvasMutationPlanDrafts(staged, intent)", self.mutation)
        self.assertIn("generationOutputMutationModule.createBatch({", self.output)
        self.assertIn("arrangement:`${generationBatchLayout}-batch`", self.output)
        self.assertIn("arrangement:'single'", self.host)
        self.assertIn("sourceNodeId", self.host)
        self.assertNotRegex(
            self.studio,
            r"sourceRect\.(?:x|width)\s*\+\s*240",
        )

    def test_reverse_prompt_delegates_geometry_and_placement_to_the_modules(self):
        start = self.host.index("async function createAndRunReversePromptNode")
        end = self.host.index("async function aiProcessorSourceSize", start)
        reverse = self.host[start:end]
        self.assertIn("anchor:{kind:'source',sourceNodeId:source.id}", reverse)
        self.assertIn("reveal:true", reverse)
        self.assertNotIn("data:{w:", reverse)
        self.assertNotIn("promptNodeExpandedHeight(node)", reverse)
        self.assertIn("canvasMutationStabilizeDraftGeometry(node)", self.mutation)
        self.assertIn("type === 'smart-prompt'", self.geometry)
        self.assertNotIn("return 270 +", self.host)

    def test_image_and_reference_node_creation_always_declare_positioning(self):
        image_start = self.host.index("function createImageNodeAt(")
        image_end = self.host.index("\nfunction mediaLayoutSize(", image_start)
        image_creation = self.host[image_start:image_end]
        self.assertIn("mutationOptions.positionMode === 'exact'", image_creation)
        self.assertIn("mutationOptions.placement = sourceNodeId", image_creation)
        self.assertIn("anchor:{kind:point ? 'point' : 'viewport'", image_creation)

        reference_start = self.host.index("function createReferencedNode(")
        reference_end = self.host.index(
            "\nfunction createReferencedNodeFromMenu(", reference_start
        )
        reference_creation = self.host[reference_start:reference_end]
        self.assertIn("anchor:{kind:'source',sourceNodeId:sourceNode.id}", reference_creation)
        self.assertIn("const createOptions = explicitPoint ? exactOptions : placementOptions", reference_creation)
        self.assertIn("createImageNodeAt(imagePoint, [], {select:true,...createOptions})", reference_creation)
        self.assertIn(
            "created.y = p.y - Number(created.h || promptNodeLayoutSize(created).height) / 2;",
            reference_creation,
        )
        self.assertIn("isUpstreamInput ? p.x - 316 : p.x", reference_creation)
        self.assertIn("(isUpstreamInput ? -1 : 1) * emptyLayout.width / 2", reference_creation)

        menu_start = self.host.index("function createNodeFromMenu(")
        menu_end = self.host.index("\nfunction smartCanvasChromeTarget(", menu_start)
        menu_creation = self.host[menu_start:menu_end]
        self.assertIn("anchor:{kind:'point',x:p.x,y:p.y}", menu_creation)
        self.assertGreaterEqual(menu_creation.count("options:{placement,reveal:true}"), 5)

    def test_pending_outputs_declare_stable_outer_geometry_before_placement(self):
        self.assertGreaterEqual(
            self.output.count("generationStableOuterSize:true"), 2
        )
        self.assertGreaterEqual(
            self.output.count("generationMediaW:pendingBox.w"), 2
        )
        self.assertGreaterEqual(
            self.output.count("generationMediaH:pendingBox.h"), 2
        )

    def test_detached_media_pointer_drag_uses_manual_exact_positioning(self):
        start = self.interaction.index("function smartCanvasInteractionMoveDetach(")
        end = self.interaction.index("function smartCanvasInteractionMoveNodes(", start)
        detach = self.interaction[start:end]
        self.assertIn("positionMode:'exact'", detach)
        self.assertIn("reveal:false", detach)
        self.assertGreaterEqual(self.container.count("positionMode:'exact'"), 2)
        self.assertIn("positionMode:'exact'", self.host)

    def test_script_order_loads_geometry_then_placement_before_mutation(self):
        page = (ROOT / "static" / "smart-canvas.html").read_text(
            encoding="utf-8"
        )
        geometry = page.index("/static/js/smart-canvas/node-geometry.js")
        placement = page.index("/static/js/smart-canvas/node-placement.js")
        selection = page.index("/static/js/smart-canvas/selection-arrangement.js")
        mutation = page.index("/static/js/smart-canvas/canvas-mutation.js")
        self.assertLess(geometry, placement)
        self.assertLess(placement, selection)
        self.assertLess(selection, mutation)


if __name__ == "__main__":
    unittest.main()
