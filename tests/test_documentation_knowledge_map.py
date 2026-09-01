import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

CANONICAL_DOCUMENTS = (
    ROOT / "docs" / "README.md",
    ROOT / "docs" / "PROJECT-MAP.md",
    ROOT / "docs" / "adr" / "README.md",
    ROOT / "docs" / "adr" / "0001-workspace-data-boundary.md",
    ROOT / "docs" / "agents" / "change-documentation.md",
    ROOT / "docs" / "current" / "ui-design-guidelines.md",
    ROOT / "docs" / "FEATURE-SPEC-TEMPLATE.md",
)

MARKDOWN_LINK = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")
FEATURE_ROW = re.compile(r"^\| (F\d{2}) \|", re.MULTILINE)


def _local_link_target(document: Path, raw_target: str) -> Path | None:
    target = raw_target.strip().split("#", 1)[0]
    if not target or target.startswith("#") or "://" in target:
        return None
    return (document.parent / target).resolve()


class DocumentationKnowledgeMapTests(unittest.TestCase):
    def test_completion_documentation_is_discoverable_from_agents(self):
        agents = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
        self.assertIn("docs/agents/change-documentation.md", agents)

    def test_canonical_knowledge_documents_exist(self):
        missing = [str(path.relative_to(ROOT)) for path in CANONICAL_DOCUMENTS if not path.is_file()]
        self.assertEqual([], missing)

    def test_canonical_documents_have_no_broken_relative_links(self):
        broken: list[str] = []
        for document in CANONICAL_DOCUMENTS:
            source = document.read_text(encoding="utf-8")
            for match in MARKDOWN_LINK.finditer(source):
                target = _local_link_target(document, match.group(1))
                if target is not None and not target.exists():
                    broken.append(
                        f"{document.relative_to(ROOT)} -> {match.group(1)}"
                    )
        self.assertEqual([], broken)

    def test_project_map_has_one_registry_row_per_feature(self):
        catalog = (ROOT / "docs" / "PROJECT-MAP.md").read_text(
            encoding="utf-8"
        )
        summary_ids = FEATURE_ROW.findall(catalog)
        expected = [f"F{index:02d}" for index in range(1, 16)]

        self.assertEqual(expected, summary_ids)
        self.assertEqual(len(summary_ids), len(set(summary_ids)))

    def test_redundant_document_surfaces_are_removed(self):
        redundant = (
            ROOT / "docs" / "map",
            ROOT / "docs" / "handoffs",
            ROOT / "docs" / "governance",
            ROOT / "docs" / "reference",
            ROOT / "docs" / "specifications",
            ROOT / "docs" / "design-system",
            ROOT / "docs" / "active" / "infinite-canvas-ui-tasks",
            ROOT / "docs" / "roadmap.md",
            ROOT / "docs" / "project-structure.md",
            ROOT / "docs" / "evidence",
        )
        existing = [str(path.relative_to(ROOT)) for path in redundant if path.exists()]
        self.assertEqual([], existing)

    def test_feature_spec_template_covers_cross_functional_contract(self):
        template = (ROOT / "docs" / "FEATURE-SPEC-TEMPLATE.md").read_text(
            encoding="utf-8"
        )
        required_sections = (
            "## 2. Problem Statement",
            "## 4. Actors and permissions",
            "## 6. User journey and interaction contract",
            "## 8. Domain and state model",
            "## 9. Data and persistence",
            "## 10. API / WebSocket / Provider contracts",
            "## 13. Design system contract",
            "## 15. Acceptance and testing",
            "## 17. Traceability",
        )
        for heading in required_sections:
            with self.subTest(heading=heading):
                self.assertIn(heading, template)

    def test_ui_guide_is_written_for_cross_functional_use(self):
        guide = (ROOT / "docs" / "current" / "ui-design-guidelines.md").read_text(
            encoding="utf-8"
        )
        required_sections = (
            "## 1. 产品体验方向",
            "## 3. 浮层与层级规范",
            "## 4. 视觉基础",
            "## 5. 组件选择",
            "## 6. 交互合同",
            "## 8. AI 与开发执行规则",
            "## 9. 验收清单",
        )
        for heading in required_sections:
            with self.subTest(heading=heading):
                self.assertIn(heading, guide)

if __name__ == "__main__":
    unittest.main()
