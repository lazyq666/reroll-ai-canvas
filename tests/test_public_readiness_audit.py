import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_READINESS_WORKFLOW = ROOT / ".github" / "workflows" / "public-readiness.yml"
SPEC = importlib.util.spec_from_file_location(
    "public_tree_audit_script",
    ROOT / "scripts" / "audit_public_tree.py",
)
assert SPEC and SPEC.loader
audit_public_tree = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit_public_tree)
sys.modules["audit_public_tree"] = audit_public_tree

HISTORY_SPEC = importlib.util.spec_from_file_location(
    "public_history_audit_script",
    ROOT / "scripts" / "audit_public_history.py",
)
assert HISTORY_SPEC and HISTORY_SPEC.loader
audit_public_history = importlib.util.module_from_spec(HISTORY_SPEC)
HISTORY_SPEC.loader.exec_module(audit_public_history)


class PublicReadinessAuditTests(unittest.TestCase):
    def test_public_readiness_separates_deterministic_and_performance_gates(self):
        workflow = PUBLIC_READINESS_WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("runs-on: ubuntu-latest", workflow)
        self.assertIn("fetch-depth: 0", workflow)
        self.assertIn('IC_SKIP_PERFORMANCE_TESTS: "1"', workflow)
        self.assertIn('IC_BROWSER_NO_SANDBOX: "1"', workflow)
        self.assertIn("Run deterministic Python test suite", workflow)
        self.assertIn("python scripts/audit_public_history.py HEAD", workflow)

    def test_core_browser_launcher_keeps_no_sandbox_opt_in(self):
        launcher = (ROOT / "tests" / "ic_core_browser_smoke.cjs").read_text(
            encoding="utf-8"
        )

        self.assertIn("process.env.IC_BROWSER_NO_SANDBOX === '1'", launcher)
        self.assertIn("...(NO_SANDBOX ? ['--no-sandbox'] : [])", launcher)

    def test_gitlink_parser_rejects_local_worktree_entries(self):
        output = (
            b"100644 1111111111111111111111111111111111111111 0\tREADME.md\0"
            b"160000 2222222222222222222222222222222222222222 0\t"
            b".worktrees/issue-123\0"
        )

        self.assertEqual(
            [".worktrees/issue-123"],
            audit_public_tree.gitlinks_from_stage_output(output),
        )

    def test_gitlink_parser_accepts_regular_and_executable_files(self):
        output = (
            b"100644 1111111111111111111111111111111111111111 0\tREADME.md\0"
            b"100755 2222222222222222222222222222222222222222 0\t"
            b"scripts/check.py\0"
        )

        self.assertEqual([], audit_public_tree.gitlinks_from_stage_output(output))

    def test_history_path_audit_rejects_local_and_sensitive_surfaces(self):
        self.assertEqual(
            "forbidden historical surface",
            audit_public_history.sensitive_history_path(".worktrees/issue-123"),
        )
        self.assertEqual(
            "forbidden historical surface",
            audit_public_history.sensitive_history_path("exports/report.json"),
        )
        self.assertEqual(
            "historical environment file",
            audit_public_history.sensitive_history_path("deployment/.env.production"),
        )
        self.assertEqual(
            "historical credential/state file",
            audit_public_history.sensitive_history_path("keys/signing.pem"),
        )

    def test_history_path_audit_allows_public_examples_and_source(self):
        self.assertIsNone(
            audit_public_history.sensitive_history_path(".env.example")
        )
        self.assertIsNone(
            audit_public_history.sensitive_history_path("backend/main.py")
        )

    def test_history_identity_audit_allows_github_platform_noreply_addresses(self):
        self.assertTrue(
            audit_public_history.allowed_commit_email(
                b"49699333+dependabot[bot]@users.noreply.github.com"
            )
        )
        self.assertTrue(
            audit_public_history.allowed_commit_email(b"noreply@github.com")
        )
        self.assertFalse(
            audit_public_history.allowed_commit_email(b"maintainer@gmail.com")
        )


if __name__ == "__main__":
    unittest.main()
