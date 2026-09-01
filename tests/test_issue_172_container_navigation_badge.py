from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class Issue172ContainerNavigationBadgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.host = (ROOT / "static/js/smart-canvas.js").read_text(encoding="utf-8")
        cls.style = (ROOT / "static/css/smart-canvas.css").read_text(encoding="utf-8")

    def test_far_container_badge_is_rendered_inside_frame_and_smart_group_nodes(self):
        start = self.host.index("function smartContainerNavigationBadgeHtml")
        end = self.host.index("\nfunction ", start + 1)
        helper = self.host[start:end]
        self.assertIn("smartContainer.isFrame(node)", helper)
        self.assertIn("node?.type !== 'smart-group'", helper)
        self.assertIn('class="smart-container-navigation-badge"', helper)

        render_start = self.host.index("const canvasFarMode = canvasLevelOfDetail.diagnostics().mode === 'far'")
        render_end = self.host.index("\n        return {node, html};", render_start)
        render = self.host[render_start:render_end]
        self.assertIn("runtimeStatus:canvasFarMode", render)
        self.assertIn("? smartContainerNavigationBadgeHtml(node, navigationTitle)", render)
        self.assertIn(
            "nodeFarMode || body.includes('data-generation-pending-node') ? '' : runTimePillHtml(node)",
            render,
        )
        self.assertNotIn("scheduleSmartCanvasNavigationLabels();", render)

    def test_container_badge_uses_node_like_geometry_and_screen_stable_scale(self):
        self.assertIn(
            ".smart-container-navigation-badge {",
            self.style,
        )
        badge_start = self.style.index(".smart-container-navigation-badge {")
        badge_end = self.style.index("}", badge_start)
        badge_rule = self.style[badge_start:badge_end]
        self.assertIn("border:var(--ui-border-width-thin) solid var(--ui-color-border-nodes)", badge_rule)
        self.assertIn("border-radius:var(--ui-radius-s)", badge_rule)
        self.assertIn("transform:scale(var(--smart-selection-handle-inverse-scale))", badge_rule)
        self.assertIn("pointer-events:auto", badge_rule)

    def test_badge_drag_uses_the_parent_nodes_existing_move_interaction(self):
        bind_start = self.host.index("function bindNodeEvents()")
        bind_end = self.host.index("\nfunction smartDeleteSelectionTarget", bind_start)
        binding = self.host[bind_start:bind_end]
        self.assertIn("el.onmousedown = beginNodeDrag", binding)
        self.assertIn("const navigationBadge = el.querySelector('.smart-container-navigation-badge')", binding)
        self.assertIn("navigationBadge?.addEventListener('mousedown'", binding)
        self.assertIn("window.SmartCanvasModules.viewportSelection.selection.refresh()", binding)
        self.assertIn("beginNodeDrag(e)", binding)


if __name__ == "__main__":
    unittest.main()
