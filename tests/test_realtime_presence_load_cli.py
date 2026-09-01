import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/performance/run_realtime_presence_load.py"


class RealtimePresenceLoadCliTests(unittest.TestCase):
    def test_plan_only_records_the_exact_approved_formal_shape(self):
        with tempfile.TemporaryDirectory() as temporary:
            report = Path(temporary) / "report"
            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--report-directory",
                    str(report),
                    "--plan-only",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            self.assertEqual(0, completed.returncode, completed.stderr)
            summary = json.loads((report / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual("plan_only", summary["status"])
            self.assertEqual(
                {
                    "account_count": 10,
                    "baseline_duration_seconds": 1800,
                    "baseline_pointer_updates_per_account_per_second": 0,
                    "duration_seconds": 1800,
                    "pointer_updates_per_account_per_second": 10,
                    "mutations_per_second": 20,
                    "pointer_latency_p95_gate_ms": 250,
                    "mutation_relative_p95_p99_degradation_gate_percent": 20,
                    "event_loop_probe_interval_ms": 10,
                    "event_loop_lag_p99_gate_ms": 50,
                    "slow_client_contract": "pointer_latest_wins_document_reliable",
                    "required_correctness": [
                        "continuous_revision",
                        "no_canvas_resync",
                        "no_permanent_send_failure",
                        "bounded_server_rss",
                        "bounded_presence_queue_shape",
                    ],
                },
                summary["formal_plan"],
            )

    def test_formal_execution_refuses_an_unmeasured_invocation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            accounts = root / "accounts.json"
            accounts.write_text(
                json.dumps([
                    {"username": f"user-{index}", "password": "password"}
                    for index in range(10)
                ]),
                encoding="utf-8",
            )
            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--canvas-id",
                    "canvas-a",
                    "--accounts-json",
                    str(accounts),
                    "--report-directory",
                    str(root / "report"),
                    "--confirm-formal-load",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            self.assertNotEqual(0, completed.returncode)
            self.assertIn("formal load requires --server-pid", completed.stderr)

    def test_controlled_baseline_requires_zero_pointer_rate(self):
        with tempfile.TemporaryDirectory() as temporary:
            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--mode",
                    "baseline",
                    "--pointer-hz",
                    "1",
                    "--report-directory",
                    str(Path(temporary) / "report"),
                    "--plan-only",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            self.assertNotEqual(0, completed.returncode)
            self.assertIn("baseline mode requires --pointer-hz 0", completed.stderr)

    def test_formal_presence_rejects_an_uncontrolled_baseline(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            accounts = root / "accounts.json"
            accounts.write_text(
                json.dumps([
                    {"username": f"user-{index}", "password": "password"}
                    for index in range(10)
                ]),
                encoding="utf-8",
            )
            baseline = root / "baseline.json"
            baseline.write_text(
                json.dumps({
                    "status": "passed",
                    "run_mode": "presence",
                    "mutation_p95_ms": 10,
                    "mutation_p99_ms": 20,
                }),
                encoding="utf-8",
            )
            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--canvas-id",
                    "canvas-a",
                    "--accounts-json",
                    str(accounts),
                    "--server-pid",
                    "12345",
                    "--baseline-summary",
                    str(baseline),
                    "--report-directory",
                    str(root / "report"),
                    "--confirm-formal-load",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            self.assertNotEqual(0, completed.returncode)
            self.assertIn(
                "baseline summary does not match the controlled formal shape",
                completed.stderr,
            )


if __name__ == "__main__":
    unittest.main()
