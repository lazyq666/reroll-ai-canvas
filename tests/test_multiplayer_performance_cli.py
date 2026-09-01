import csv
import http.server
import importlib.util
import json
import os
import re
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "performance" / "run_multiplayer_canvas.py"


def load_runner_module():
    spec = importlib.util.spec_from_file_location(
        "multiplayer_performance_runner_for_tests",
        SCRIPT,
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@unittest.skipIf(
    os.environ.get("IC_SKIP_PERFORMANCE_TESTS") == "1",
    "performance acceptance requires an explicit controlled-host run",
)
class MultiplayerPerformanceCliTests(unittest.TestCase):
    @classmethod
    def _run_baseline_smoke(cls):
        if hasattr(cls, "_baseline_smoke_cache"):
            return cls._baseline_smoke_cache

        cls._baseline_smoke_temporary = tempfile.TemporaryDirectory()
        root = Path(cls._baseline_smoke_temporary.name)
        workspace = root / "workspace"
        report_root = root / "reports"
        (workspace / "data").mkdir(parents=True)
        (workspace / "assets").mkdir(parents=True)
        reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
        reservation.close()
        completed = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--profile",
                "baseline",
                "--suite",
                "smoke",
                "--port",
                str(port),
                "--workspace",
                str(workspace),
                "--report-root",
                str(report_root),
                "--seed",
                "7425068",
            ],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=60,
            check=False,
        )
        output = json.loads(completed.stdout)
        report_directory = Path(output["report_directory"])
        summary = json.loads(
            report_directory.joinpath("summary.json").read_text(
                encoding="utf-8"
            )
        )
        cleanup = json.loads(
            report_directory.joinpath("cleanup.json").read_text(
                encoding="utf-8"
            )
        )
        cls._baseline_smoke_cache = (
            completed,
            summary,
            cleanup,
            report_directory,
            workspace,
        )
        return cls._baseline_smoke_cache

    @classmethod
    def tearDownClass(cls):
        temporary = getattr(cls, "_baseline_smoke_temporary", None)
        if temporary is not None:
            temporary.cleanup()

    def test_canvas_open_long_task_window_starts_at_card_activation(self):
        tracer = (
            ROOT / "scripts" / "performance" / "trace_browser_settings.cjs"
        ).read_text(encoding="utf-8")
        reset_index = tracer.index(
            "window.__icLongTasks = [];",
            tracer.index("canvasCardReadyMs ="),
        )
        activation_index = tracer.index(
            "const canvasOpenStarted = process.hrtime.bigint();"
        )

        self.assertLess(reset_index, activation_index)

    def test_rss_sampling_follows_the_workspace_service_after_restart(self):
        runner = load_runner_module()

        class StoppedLauncher:
            pid = 999_999_999

            @staticmethod
            def poll():
                return 0

        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            control = workspace / ".infinite-canvas-service"
            control.mkdir()
            control.joinpath("occupation.json").write_text(
                json.dumps({"pid": os.getpid()}),
                encoding="utf-8",
            )

            with mock.patch.object(
                runner,
                "_pid_rss_bytes",
                return_value=12_345,
            ) as sample_pid:
                self.assertEqual(
                    runner._workspace_process_rss_bytes(
                        workspace,
                        StoppedLauncher(),
                    ),
                    12_345,
                )
            sample_pid.assert_called_once_with(os.getpid())

    def test_realtime_encoding_preflight_accepts_saturated_operation_history(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            workspace.mkdir()

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "standard",
                    "--realtime-encoding-preflight",
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            output = json.loads(completed.stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            cleanup = json.loads(
                report_directory.joinpath("cleanup.json").read_text(
                    encoding="utf-8"
                )
            )
            with report_directory.joinpath("metrics.csv").open(
                newline="", encoding="utf-8"
            ) as metrics_file:
                metrics = list(csv.DictReader(metrics_file))

            self.assertEqual(
                0,
                completed.returncode,
                json.dumps(summary, ensure_ascii=False, sort_keys=True),
            )

            self.assertEqual("passed", summary["status"])
            self.assertTrue(summary["executed"])
            self.assertEqual("realtime_encoding_preflight", summary["execution_mode"])
            self.assertEqual(24_000, summary["saturated_operation_count"])
            self.assertEqual("raw-v1", summary["seen_operations_storage_format"])
            self.assertTrue(summary["legacy_zlib_decode_supported"])
            self.assertTrue(summary["seen_operations_round_trip_passed"])
            self.assertLessEqual(summary["seen_operations_encode_p95_ms"], 2)
            self.assertTrue(summary["seen_operations_encode_gate_passed"])
            self.assertEqual(25, len(metrics))
            self.assertTrue(
                all(metric["operation"] == "seen_operation_encode" for metric in metrics)
            )
            self.assertFalse(summary["workspace_changed"])
            self.assertTrue(cleanup["workspace_unchanged"])
            self.assertEqual([], list(workspace.iterdir()))

    def test_standard_suite_refuses_to_masquerade_as_smoke_before_workspace_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            workspace.mkdir()
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "standard",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(2, completed.returncode, completed.stderr)
            output = json.loads(completed.stdout)
            summary = json.loads(
                Path(output["report_directory"])
                .joinpath("summary.json")
                .read_text(encoding="utf-8")
            )
            manifest = json.loads(
                Path(output["report_directory"])
                .joinpath("manifest.json")
                .read_text(encoding="utf-8")
            )
            self.assertEqual(
                {
                    "schema_version": 1,
                    "status": "environment_not_ready",
                    "executed": False,
                    "exit_code": 2,
                    "profile": "baseline",
                    "suite": "standard",
                    "host": "127.0.0.1",
                    "port": port,
                    "seed": 7425068,
                    "reasons": ["suite_not_implemented"],
                    "suite_plan": {
                        "target_duration_seconds": 2_700,
                        "warmup_seconds": 120,
                        "steady_load_seconds": 1_200,
                        "steady_mutations_per_second": 20,
                        "burst_load_seconds": 300,
                        "burst_mutations_per_second": 40,
                        "recovery_observation_seconds": 30,
                        "backend_client_count": 10,
                        "full_browser_client_count": 10,
                        "generation_run_overlap_phases": [
                            "steady",
                            "burst",
                        ],
                        "generation_run_max_concurrency": 6,
                        "generation_run_separate_phase": False,
                        "recovery_gate_seconds": 30,
                        "phases": [
                            {
                                "name": "warmup",
                                "duration_seconds": 120,
                            },
                            {
                                "name": "steady",
                                "duration_seconds": 1_200,
                                "target_mutations_per_second": 20,
                                "browser_client_count": 1,
                                "lightweight_client_count": 9,
                                "generation_runs_active": True,
                            },
                            {
                                "name": "burst",
                                "duration_seconds": 300,
                                "target_mutations_per_second": 40,
                                "browser_client_count": 1,
                                "lightweight_client_count": 9,
                                "generation_runs_active": True,
                            },
                            {
                                "name": "recovery",
                                "duration_seconds": 30,
                            },
                            {
                                "name": "full_browser",
                                "browser_client_count": 10,
                                "lightweight_client_count": 0,
                            },
                        ],
                    },
                    "workspace_changed": False,
                },
                summary,
            )
            self.assertEqual([], list(workspace.iterdir()))
            reusable = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                reusable.bind(("127.0.0.1", port))
            finally:
                reusable.close()

    def test_standard_preflight_writes_a_reproducibility_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            workspace.mkdir()
            expected_commit = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            ).stdout.strip()
            expected_dirty = bool(
                subprocess.run(
                    ["git", "status", "--porcelain"],
                    cwd=ROOT,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=True,
                ).stdout.strip()
            )

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "standard",
                    "--port",
                    "65534",
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(2, completed.returncode, completed.stderr)
            output = json.loads(completed.stdout)
            report_directory = Path(output["report_directory"])
            manifest = json.loads(
                report_directory.joinpath("manifest.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(
                {
                    "schema_version": 1,
                    "profile": "baseline",
                    "suite": "standard",
                    "seed": 7425068,
                    "executed": False,
                    "git_commit": expected_commit,
                    "git_dirty": expected_dirty,
                },
                manifest,
            )
            self.assertEqual([], list(workspace.iterdir()))

    def test_standard_dry_run_executes_short_plan_without_claiming_formal_result(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir(parents=True)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "standard",
                    "--standard-dry-run",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=60,
                check=False,
            )

            self.assertIn(completed.returncode, (0, 1), completed.stderr)
            output = json.loads(completed.stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            manifest = json.loads(
                report_directory.joinpath("manifest.json").read_text(
                    encoding="utf-8"
                )
            )
            cleanup = json.loads(
                report_directory.joinpath("cleanup.json").read_text(
                    encoding="utf-8"
                )
            )
            with report_directory.joinpath("metrics.csv").open(
                newline="", encoding="utf-8"
            ) as metrics_file:
                metrics = list(csv.DictReader(metrics_file))

            self.assertTrue(summary["executed"])
            self.assertEqual("standard", summary["suite"])
            self.assertEqual("standard_dry_run", summary["execution_mode"])
            self.assertFalse(summary["formal_result"])
            self.assertEqual(
                2_700,
                summary["formal_suite_plan"]["target_duration_seconds"],
            )
            self.assertEqual(
                [
                    {
                        "name": "warmup",
                        "duration_seconds": 1,
                        "generation_runs_active": False,
                    },
                    {
                        "name": "steady",
                        "duration_seconds": 1,
                        "target_mutations_per_second": 20,
                        "generation_runs_active": False,
                    },
                    {
                        "name": "burst",
                        "duration_seconds": 1,
                        "target_mutations_per_second": 40,
                        "generation_runs_active": True,
                    },
                    {
                        "name": "recovery",
                        "duration_seconds": 1,
                        "generation_runs_active": False,
                    },
                    {
                        "name": "full_browser",
                        "browser_client_count": 10,
                        "lightweight_client_count": 0,
                        "generation_runs_active": False,
                    },
                ],
                summary["suite_plan"]["phases"],
            )
            self.assertEqual(
                [
                    "warmup",
                    "steady",
                    "burst",
                    "recovery",
                    "full_browser",
                ],
                summary["executed_phase_names"],
            )
            self.assertEqual(1, summary["warmup_duration_seconds"])
            self.assertGreaterEqual(summary["warmup_elapsed_ms"], 900)
            self.assertEqual("burst", summary["generation_overlap_phase"])
            self.assertFalse(summary["generation_separate_mutation_window"])
            self.assertEqual(1, summary["generation_output_count"])
            self.assertEqual(1, summary["generation_log_count"])
            self.assertTrue(summary["generation_final_projections_consistent"])
            self.assertEqual(1, summary["recovery_observation_duration_seconds"])
            self.assertGreaterEqual(summary["recovery_observation_elapsed_ms"], 900)
            self.assertEqual(5, summary["recovery_runtime_status_sample_count"])
            self.assertEqual(0, summary["recovery_runtime_status_timeout_count"])
            self.assertEqual(0, summary["recovery_runtime_status_failure_count"])
            self.assertGreaterEqual(
                summary["recovery_event_loop_lag_sample_count"],
                50,
            )
            self.assertEqual(
                summary["generation_final_revision"],
                summary["recovery_revision_before"],
            )
            self.assertEqual(
                summary["recovery_revision_before"],
                summary["recovery_revision_after"],
            )
            self.assertTrue(summary["recovery_revision_unchanged"])
            self.assertEqual(10, summary["full_browser_client_count"])
            self.assertEqual(0, summary["full_browser_lightweight_client_count"])
            self.assertEqual(10, summary["full_browser_distinct_session_count"])
            self.assertEqual(10, summary["full_browser_isolated_profile_count"])
            self.assertEqual(10, summary["full_browser_first_operable_sample_count"])
            self.assertEqual(10, summary["full_browser_interaction_accepted_count"])
            self.assertEqual(10, summary["full_browser_interaction_restored_count"])
            self.assertTrue(
                summary["browser_canvas_open_first_operable_gate_enforced"]
            )
            self.assertFalse(
                summary["full_browser_first_operable_gate_enforced"]
            )
            self.assertTrue(
                summary["full_browser_first_operable_informational"]
            )
            self.assertEqual(
                1000,
                summary["full_browser_first_operable_reference_ms"],
            )
            self.assertNotIn(
                "first_operable_p95_exceeded",
                summary["full_browser_gate_failure_counts"],
            )
            self.assertEqual(
                summary["browser_canvas_open_console_error_count"],
                sum(
                    summary[
                        "browser_canvas_open_console_error_kind_counts"
                    ].values()
                ),
            )
            self.assertTrue(
                all(
                    re.fullmatch(r"[A-Za-z0-9._-]+", source)
                    for source in summary[
                        "browser_canvas_open_console_error_sources"
                    ]
                )
            )
            self.assertEqual(
                20,
                len(
                    [
                        metric
                        for metric in metrics
                        if metric["operation"] == "steady_node_move"
                    ]
                ),
            )
            self.assertEqual(
                40,
                len(
                    [
                        metric
                        for metric in metrics
                        if metric["operation"] == "burst_node_move"
                    ]
                ),
            )
            self.assertEqual(
                [],
                [
                    metric
                    for metric in metrics
                    if metric["operation"] == "generation_parallel_node_move"
                ],
            )
            warmup_metrics = [
                metric
                for metric in metrics
                if metric["operation"] == "phase_warmup_complete"
            ]
            self.assertEqual(1, len(warmup_metrics))
            self.assertEqual("completed", warmup_metrics[0]["status"])
            self.assertGreaterEqual(
                float(warmup_metrics[0]["ack_latency_ms"]),
                900,
            )
            self.assertLess(
                metrics.index(warmup_metrics[0]),
                next(
                    index
                    for index, metric in enumerate(metrics)
                    if metric["operation"] == "steady_node_move"
                ),
            )
            recovery_operations = [
                metric["operation"]
                for metric in metrics
                if metric["operation"].startswith("phase_recovery_")
            ]
            self.assertEqual(
                ["phase_recovery_started", "phase_recovery_complete"],
                recovery_operations,
            )
            recovery_start_index = next(
                index
                for index, metric in enumerate(metrics)
                if metric["operation"] == "phase_recovery_started"
            )
            recovery_complete_index = next(
                index
                for index, metric in enumerate(metrics)
                if metric["operation"] == "phase_recovery_complete"
            )
            self.assertGreater(
                recovery_start_index,
                max(
                    index
                    for index, metric in enumerate(metrics)
                    if metric["operation"] == "burst_node_move"
                ),
            )
            self.assertLess(
                recovery_complete_index,
                min(
                    index
                    for index, metric in enumerate(metrics)
                    if metric["operation"] == "slow_client_pressure"
                ),
            )
            full_browser_metrics = [
                metric
                for metric in metrics
                if metric["operation"] == "full_browser_first_operable"
            ]
            self.assertEqual(10, len(full_browser_metrics))
            self.assertEqual(
                {f"client-{index:02d}-browser" for index in range(1, 11)},
                {metric["client"] for metric in full_browser_metrics},
            )
            self.assertTrue(
                all(
                    metric["status"] == "accepted"
                    for metric in full_browser_metrics
                )
            )
            self.assertTrue(manifest["executed"])
            self.assertTrue(cleanup["canvas_purged"])
            self.assertTrue(cleanup["generation_media_purged"])
            self.assertTrue(cleanup["provider_settings_restored"])
            self.assertTrue(cleanup["sessions_removed"])
            self.assertTrue(cleanup["accounts_removed"])
            self.assertEqual(
                "canvas_account_create_responses_and_media_delta",
                cleanup["cleanup_allowlist_source"],
            )
            self.assertEqual(
                1,
                len(cleanup["cleanup_allowlist"]["canvas_ids"]),
            )
            self.assertEqual(
                9,
                len(cleanup["cleanup_allowlist"]["account_ids"]),
            )
            self.assertEqual(
                cleanup["generation_media_removed_count"],
                len(cleanup["cleanup_allowlist"]["generated_media_paths"]),
            )
            self.assertEqual(
                0,
                cleanup["out_of_allowlist_deletion_attempt_count"],
            )

    def test_standard_dry_run_rejects_unsafe_or_misleading_modes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            workspace.mkdir()
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.addCleanup(reservation.close)
            reservation.bind(("127.0.0.1", 0))
            reservation.listen()
            port = reservation.getsockname()[1]
            cases = [
                (
                    [
                        "--profile",
                        "baseline",
                        "--suite",
                        "smoke",
                        "--standard-dry-run",
                        "--workspace",
                        str(workspace),
                    ],
                    "--standard-dry-run requires --suite standard",
                ),
                (
                    [
                        "--profile",
                        "real-cli",
                        "--suite",
                        "standard",
                        "--standard-dry-run",
                        "--workspace",
                        str(workspace),
                    ],
                    "--standard-dry-run requires --profile baseline",
                ),
                (
                    [
                        "--profile",
                        "baseline",
                        "--suite",
                        "standard",
                        "--standard-dry-run",
                        "--attach-existing-service",
                    ],
                    "--standard-dry-run cannot use --attach-existing-service",
                ),
                (
                    [
                        "--profile",
                        "baseline",
                        "--suite",
                        "smoke",
                        "--confirm-formal-standard",
                        "--workspace",
                        str(workspace),
                    ],
                    "--confirm-formal-standard requires --suite standard",
                ),
                (
                    [
                        "--profile",
                        "real-cli",
                        "--suite",
                        "standard",
                        "--confirm-formal-standard",
                        "--workspace",
                        str(workspace),
                    ],
                    "--confirm-formal-standard requires --profile baseline",
                ),
                (
                    [
                        "--profile",
                        "baseline",
                        "--suite",
                        "standard",
                        "--confirm-formal-standard",
                        "--attach-existing-service",
                    ],
                    "--confirm-formal-standard cannot use --attach-existing-service",
                ),
                (
                    [
                        "--profile",
                        "baseline",
                        "--suite",
                        "standard",
                        "--confirm-formal-standard",
                        "--standard-dry-run",
                        "--workspace",
                        str(workspace),
                    ],
                    "--confirm-formal-standard cannot use --standard-dry-run",
                ),
            ]
            for index, (arguments, expected_error) in enumerate(cases):
                with self.subTest(expected_error=expected_error):
                    completed = subprocess.run(
                        [
                            sys.executable,
                            str(SCRIPT),
                            *arguments,
                            "--port",
                            str(port),
                            "--report-root",
                            str(root / f"reports-{index}"),
                        ],
                        cwd=ROOT,
                        text=True,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=10,
                        check=False,
                    )

                    self.assertEqual(2, completed.returncode)
                    self.assertEqual("", completed.stdout)
                    self.assertIn(expected_error, completed.stderr)

    def test_extended_standard_dry_run_scales_phase_windows_without_becoming_formal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir(parents=True)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "standard",
                    "--standard-dry-run",
                    "--standard-dry-run-level",
                    "extended",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=120,
                check=False,
            )

            self.assertIn(completed.returncode, (0, 1), completed.stderr)
            output = json.loads(completed.stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            cleanup = json.loads(
                report_directory.joinpath("cleanup.json").read_text(
                    encoding="utf-8"
                )
            )
            with report_directory.joinpath("metrics.csv").open(
                newline="", encoding="utf-8"
            ) as metrics_file:
                metrics = list(csv.DictReader(metrics_file))

            self.assertTrue(summary["executed"])
            self.assertEqual("extended", summary["standard_dry_run_level"])
            self.assertFalse(summary["formal_result"])
            phase_plan = summary["suite_plan"]["phases"]
            self.assertEqual(
                ["warmup", "steady", "burst", "recovery", "full_browser"],
                [phase["name"] for phase in phase_plan],
            )
            self.assertEqual(2, phase_plan[0]["duration_seconds"])
            self.assertEqual(5, phase_plan[1]["duration_seconds"])
            self.assertEqual(3, phase_plan[2]["duration_seconds"])
            self.assertEqual(5, phase_plan[3]["duration_seconds"])
            self.assertEqual(100, summary["steady_mutation_sample_count"])
            self.assertEqual(120, summary["burst_mutation_sample_count"])
            self.assertEqual(
                {"steady": 25, "burst": 15, "recovery": 25},
                summary["runtime_status_samples_by_phase"],
            )
            self.assertEqual(
                [
                    "steady_start",
                    "steady_complete",
                    "burst_complete",
                    "recovery_complete",
                ],
                [
                    sample["phase_boundary"]
                    for sample in summary["server_resource_samples"]
                ],
            )
            self.assertEqual(4, summary["server_resource_sample_count"])
            self.assertGreater(summary["server_rss_baseline_bytes"], 0)
            self.assertGreaterEqual(
                summary["server_rss_peak_bytes"],
                summary["server_rss_baseline_bytes"],
            )
            self.assertEqual(
                128 * 1024 * 1024,
                summary["server_rss_growth_gate_bytes"],
            )
            self.assertGreaterEqual(
                summary["server_rss_workload_growth_bytes"],
                0,
            )
            self.assertLessEqual(
                summary["server_rss_growth_bytes"],
                summary["server_rss_growth_gate_bytes"],
            )
            self.assertTrue(summary["server_resource_growth_gate_passed"])
            self.assertEqual(
                0,
                summary["browser_canvas_open_console_error_count"],
            )
            self.assertEqual(10, summary["full_browser_client_count"])
            self.assertEqual(
                100,
                sum(
                    metric["operation"] == "steady_node_move"
                    for metric in metrics
                ),
            )
            self.assertEqual(
                120,
                sum(
                    metric["operation"] == "burst_node_move"
                    for metric in metrics
                ),
            )
            self.assertTrue(cleanup["full_browser_processes_stopped"])
            self.assertEqual(10, cleanup["full_browser_profiles_removed_count"])
            self.assertTrue(cleanup["canvas_purged"])
            self.assertTrue(cleanup["generation_media_purged"])
            self.assertTrue(cleanup["provider_settings_restored"])
            self.assertTrue(cleanup["sessions_removed"])
            self.assertTrue(cleanup["accounts_removed"])

    def test_endurance_standard_dry_run_extends_load_and_recovery_windows(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir(parents=True)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "standard",
                    "--standard-dry-run",
                    "--standard-dry-run-level",
                    "endurance",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=240,
                check=False,
            )

            self.assertIn(completed.returncode, (0, 1), completed.stderr)
            output = json.loads(completed.stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            cleanup = json.loads(
                report_directory.joinpath("cleanup.json").read_text(
                    encoding="utf-8"
                )
            )

            self.assertTrue(summary["executed"])
            self.assertEqual("endurance", summary["standard_dry_run_level"])
            self.assertFalse(summary["formal_result"])
            phase_plan = summary["suite_plan"]["phases"]
            self.assertEqual(
                [5, 30, 10, 30],
                [phase["duration_seconds"] for phase in phase_plan[:4]],
            )
            self.assertEqual(600, summary["steady_mutation_sample_count"])
            self.assertEqual(400, summary["burst_mutation_sample_count"])
            self.assertEqual(
                {"steady": 150, "burst": 50, "recovery": 150},
                summary["runtime_status_samples_by_phase"],
            )
            self.assertEqual(4, summary["server_resource_sample_count"])
            resource_samples = {
                sample["phase_boundary"]: sample["rss_bytes"]
                for sample in summary["server_resource_samples"]
            }
            self.assertEqual(
                max(
                    0,
                    max(
                        resource_samples["steady_complete"],
                        resource_samples["burst_complete"],
                    )
                    - resource_samples["steady_start"],
                ),
                summary["server_rss_workload_growth_bytes"],
            )
            self.assertLessEqual(
                summary["server_rss_growth_bytes"],
                summary["server_rss_growth_gate_bytes"],
            )
            self.assertTrue(summary["server_resource_growth_gate_passed"])
            self.assertEqual(10, summary["full_browser_client_count"])
            self.assertNotIn(
                "first_operable_p95_exceeded",
                summary["full_browser_gate_failure_counts"],
            )
            self.assertTrue(cleanup["full_browser_processes_stopped"])
            self.assertEqual(10, cleanup["full_browser_profiles_removed_count"])
            self.assertTrue(cleanup["canvas_purged"])
            self.assertTrue(cleanup["generation_media_purged"])
            self.assertTrue(cleanup["provider_settings_restored"])
            self.assertTrue(cleanup["sessions_removed"])
            self.assertTrue(cleanup["accounts_removed"])
            self.assertEqual(
                0,
                cleanup["out_of_allowlist_deletion_attempt_count"],
            )

    def test_overlap_dry_run_starts_generation_before_steady_and_finishes_after_burst(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir(parents=True)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "standard",
                    "--standard-dry-run",
                    "--standard-dry-run-level",
                    "overlap",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=120,
                check=False,
            )

            self.assertIn(completed.returncode, (0, 1), completed.stderr)
            output = json.loads(completed.stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            with report_directory.joinpath("metrics.csv").open(
                newline="", encoding="utf-8"
            ) as metrics_file:
                metrics = list(csv.DictReader(metrics_file))

            self.assertEqual("overlap", summary["standard_dry_run_level"])
            phases = summary["suite_plan"]["phases"]
            self.assertTrue(phases[1]["generation_runs_active"])
            self.assertTrue(phases[2]["generation_runs_active"])
            self.assertEqual(
                ["steady", "burst"],
                summary["generation_overlap_phases"],
            )
            prepare_index = next(
                index
                for index, metric in enumerate(metrics)
                if metric["operation"] == "generation_target_prepare"
            )
            first_steady_index = next(
                index
                for index, metric in enumerate(metrics)
                if metric["operation"] == "steady_node_move"
            )
            last_burst_index = max(
                index
                for index, metric in enumerate(metrics)
                if metric["operation"] == "burst_node_move"
            )
            recovery_index = next(
                index
                for index, metric in enumerate(metrics)
                if metric["operation"] == "phase_recovery_started"
            )
            self.assertLess(prepare_index, first_steady_index)
            self.assertLess(last_burst_index, recovery_index)
            self.assertEqual(40, summary["steady_mutation_sample_count"])
            self.assertEqual(40, summary["burst_mutation_sample_count"])
            self.assertEqual("succeeded", summary["generation_status"])
            self.assertEqual(1, summary["generation_output_count"])

    def test_concurrency_dry_run_executes_six_generation_runs_across_load(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir(parents=True)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "standard",
                    "--standard-dry-run",
                    "--standard-dry-run-level",
                    "concurrency",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=120,
                check=False,
            )

            self.assertIn(completed.returncode, (0, 1), completed.stderr)
            output = json.loads(completed.stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            cleanup = json.loads(
                report_directory.joinpath("cleanup.json").read_text(
                    encoding="utf-8"
                )
            )
            with report_directory.joinpath("metrics.csv").open(
                newline="", encoding="utf-8"
            ) as metrics_file:
                metrics = list(csv.DictReader(metrics_file))

            self.assertEqual("concurrency", summary["standard_dry_run_level"])
            self.assertEqual(
                6,
                summary["suite_plan"]["generation_run_max_concurrency"],
            )
            prepare_indexes = [
                index
                for index, metric in enumerate(metrics)
                if metric["operation"] == "generation_target_prepare"
            ]
            first_steady_index = next(
                index
                for index, metric in enumerate(metrics)
                if metric["operation"] == "steady_node_move"
            )
            self.assertEqual(6, len(prepare_indexes))
            self.assertLess(max(prepare_indexes), first_steady_index)
            self.assertEqual(6, summary["generation_run_count"])
            self.assertEqual(6, summary["generation_provider_request_count"])
            self.assertEqual(
                6,
                summary["generation_provider_peak_in_flight_count"],
            )
            self.assertEqual(6, summary["generation_succeeded_run_count"])
            self.assertEqual(6, summary["generation_output_count"])
            self.assertEqual(6, summary["generation_log_count"])
            self.assertEqual(
                summary["burst_recovery_revision"] + 6,
                summary["generation_final_revision"],
            )
            self.assertTrue(summary["generation_revisions_continuous"])
            self.assertTrue(cleanup["canvas_purged"])
            self.assertTrue(cleanup["generation_media_purged"])
            self.assertEqual(
                0,
                cleanup["out_of_allowlist_deletion_attempt_count"],
            )

    def test_sustained_burst_meets_interaction_latency_and_stops_receive_tasks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir(parents=True)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "standard",
                    "--standard-dry-run",
                    "--standard-dry-run-level",
                    "sustained-burst",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=120,
                check=False,
            )

            output = json.loads(completed.stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            cleanup = json.loads(
                report_directory.joinpath("cleanup.json").read_text(
                    encoding="utf-8"
                )
            )
            with report_directory.joinpath("metrics.csv").open(
                newline="", encoding="utf-8"
            ) as metrics_file:
                metrics = list(csv.DictReader(metrics_file))

            steady = [
                metric
                for metric in metrics
                if metric["operation"] == "steady_node_move"
            ]
            burst = [
                metric
                for metric in metrics
                if metric["operation"] == "burst_node_move"
            ]
            self.assertEqual(
                0,
                completed.returncode,
                json.dumps(summary, ensure_ascii=False, sort_keys=True),
            )
            self.assertEqual("sustained-burst", summary["standard_dry_run_level"])
            self.assertEqual("passed", summary["status"])
            self.assertEqual("", summary["failure_phase"])
            self.assertEqual("", summary["failure_gate"])
            self.assertEqual(
                ["warmup", "steady", "burst", "recovery", "full_browser"],
                summary["completed_phase_names"],
            )
            self.assertEqual(100, len(steady))
            self.assertEqual(1_200, len(burst))
            self.assertLessEqual(summary["burst_mutation_p95_ms"], 150)
            self.assertLessEqual(summary["burst_mutation_p99_ms"], 300)
            self.assertTrue(summary["burst_mutation_gate_passed"])
            self.assertEqual(4096, summary["event_loop_lag_retention_capacity"])
            self.assertEqual(
                {"steady": 250, "burst": 1500, "recovery": 250},
                summary["event_loop_lag_minimum_samples_by_phase"],
            )
            self.assertEqual([], summary["event_loop_lag_truncated_phases"])
            self.assertTrue(summary["event_loop_lag_gate_passed"])
            self.assertTrue(summary["browser_canvas_open_gate_passed"])
            self.assertEqual(250, summary["full_browser_start_stagger_ms"])
            self.assertTrue(summary["full_browser_timing_informational"])
            self.assertTrue(summary["full_browser_gate_passed"])
            burst_revisions = [int(metric["revision"]) for metric in burst]
            self.assertEqual(sorted(set(burst_revisions)), burst_revisions)
            self.assertLessEqual(
                burst_revisions[-1] - burst_revisions[0] + 1 - len(burst),
                summary["browser_canvas_open_background_mutation_count"],
            )
            self.assertTrue(cleanup["async_receive_tasks_stopped"])
            self.assertTrue(cleanup["canvas_purged"])
            self.assertTrue(cleanup["generation_media_purged"])
            self.assertTrue(cleanup["provider_settings_restored"])
            self.assertTrue(cleanup["sessions_removed"])
            self.assertTrue(cleanup["accounts_removed"])
            self.assertEqual(
                0,
                cleanup["out_of_allowlist_deletion_attempt_count"],
            )

    def test_soak_suite_refuses_to_masquerade_as_smoke_before_workspace_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            workspace.mkdir()
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "soak",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(2, completed.returncode, completed.stderr)
            output = json.loads(completed.stdout)
            summary = json.loads(
                Path(output["report_directory"])
                .joinpath("summary.json")
                .read_text(encoding="utf-8")
            )
            self.assertEqual(
                {
                    "schema_version": 1,
                    "status": "environment_not_ready",
                    "executed": False,
                    "exit_code": 2,
                    "profile": "baseline",
                    "suite": "soak",
                    "host": "127.0.0.1",
                    "port": port,
                    "seed": 7425068,
                    "reasons": ["suite_not_implemented"],
                    "suite_plan": {
                        "target_duration_seconds": 7_200,
                        "backend_client_count": 10,
                        "full_browser_client_count": 10,
                        "growth_checks": [
                            "memory",
                            "connections",
                            "queues",
                            "sqlite_wal",
                        ],
                    },
                    "workspace_changed": False,
                },
                summary,
            )
            manifest = json.loads(
                Path(output["report_directory"])
                .joinpath("manifest.json")
                .read_text(encoding="utf-8")
            )
            self.assertEqual("baseline", manifest["profile"])
            self.assertEqual("soak", manifest["suite"])
            self.assertEqual(7425068, manifest["seed"])
            self.assertFalse(manifest["executed"])
            self.assertEqual(
                subprocess.run(
                    ["git", "rev-parse", "HEAD"],
                    cwd=ROOT,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=True,
                ).stdout.strip(),
                manifest["git_commit"],
            )
            self.assertIsInstance(manifest["git_dirty"], bool)
            self.assertEqual([], list(workspace.iterdir()))
            reusable = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                reusable.bind(("127.0.0.1", port))
            finally:
                reusable.close()

    def test_attach_existing_service_requires_an_authenticated_session_without_stopping_it(self):
        class ExistingServiceHandler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/api/runtime/status":
                    payload = {
                        "stage": "ready",
                        "message": "Reroll is ready.",
                        "blocking_generation_runs": 0,
                    }
                    status = 200
                elif self.path == "/api/auth/me":
                    payload = {"detail": "authentication required"}
                    status = 401
                else:
                    payload = {"detail": "not found"}
                    status = 404
                encoded = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def log_message(self, _format, *_args):
                return

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            report_root = root / "reports"
            server = http.server.ThreadingHTTPServer(
                ("127.0.0.1", 0),
                ExistingServiceHandler,
            )
            port = server.server_address[1]
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                completed = subprocess.run(
                    [
                        sys.executable,
                        str(SCRIPT),
                        "--profile",
                        "baseline",
                        "--suite",
                        "smoke",
                        "--attach-existing-service",
                        "--port",
                        str(port),
                        "--report-root",
                        str(report_root),
                        "--seed",
                        "7425068",
                    ],
                    cwd=ROOT,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=False,
                )

                self.assertEqual(2, completed.returncode, completed.stderr)
                self.assertTrue(completed.stdout, completed.stderr)
                output = json.loads(completed.stdout)
                summary = json.loads(
                    Path(output["report_directory"])
                    .joinpath("summary.json")
                    .read_text(encoding="utf-8")
                )
                self.assertEqual(
                    {
                        "schema_version": 1,
                        "status": "environment_not_ready",
                        "executed": False,
                        "exit_code": 2,
                        "profile": "baseline",
                        "suite": "smoke",
                        "service_mode": "existing",
                        "host": "127.0.0.1",
                        "port": port,
                        "seed": 7425068,
                        "reasons": [
                            "existing_service_authentication_required"
                        ],
                        "workspace_changed": False,
                    },
                    summary,
                )
                manifest = json.loads(
                    Path(output["report_directory"])
                    .joinpath("manifest.json")
                    .read_text(encoding="utf-8")
                )
                self.assertEqual("baseline", manifest["profile"])
                self.assertEqual("smoke", manifest["suite"])
                self.assertEqual(7425068, manifest["seed"])
                self.assertFalse(manifest["executed"])
                self.assertEqual(
                    subprocess.run(
                        ["git", "rev-parse", "HEAD"],
                        cwd=ROOT,
                        text=True,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        check=True,
                    ).stdout.strip(),
                    manifest["git_commit"],
                )
                self.assertIsInstance(manifest["git_dirty"], bool)
                connection = socket.create_connection(
                    ("127.0.0.1", port),
                    timeout=1,
                )
                connection.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_occupied_target_port_stops_before_workspace_changes_and_writes_preflight_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            workspace.mkdir()
            listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            port = listener.getsockname()[1]
            try:
                completed = subprocess.run(
                    [
                        sys.executable,
                        str(SCRIPT),
                        "--profile",
                        "baseline",
                        "--suite",
                        "smoke",
                        "--port",
                        str(port),
                        "--workspace",
                        str(workspace),
                        "--report-root",
                        str(report_root),
                        "--seed",
                        "7425068",
                    ],
                    cwd=ROOT,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=False,
                )
            finally:
                listener.close()

            self.assertEqual(2, completed.returncode, completed.stderr)
            output = json.loads(completed.stdout)
            summary = json.loads(
                Path(output["report_directory"])
                .joinpath("summary.json")
                .read_text(encoding="utf-8")
            )
            self.assertEqual(
                {
                    "schema_version": 1,
                    "status": "environment_not_ready",
                    "executed": False,
                    "exit_code": 2,
                    "profile": "baseline",
                    "suite": "smoke",
                    "host": "127.0.0.1",
                    "port": port,
                    "seed": 7425068,
                    "reasons": ["target_port_in_use"],
                    "workspace_changed": False,
                },
                summary,
            )
            self.assertEqual([], list(workspace.iterdir()))

    def test_missing_workspace_is_reported_without_creating_one(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "missing-workspace"
            report_root = root / "reports"
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "smoke",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )

            self.assertEqual(2, completed.returncode, completed.stderr)
            output = json.loads(completed.stdout)
            summary = json.loads(
                Path(output["report_directory"])
                .joinpath("summary.json")
                .read_text(encoding="utf-8")
            )
            self.assertEqual(["workspace_not_found"], summary["reasons"])
            self.assertFalse(summary["executed"])
            self.assertFalse(summary["workspace_changed"])
            self.assertFalse(workspace.exists())

    def test_real_cli_never_falls_back_to_the_baseline_provider(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            empty_bin = root / "bin"
            workspace.mkdir()
            empty_bin.mkdir()
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": str(empty_bin),
                    "CODEX_BIN": "",
                    "ANTIGRAVITY_BIN": "",
                    "AGY_BIN": "",
                    "GEMINI_BIN": "",
                }
            )
            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "real-cli",
                    "--suite",
                    "smoke",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=environment,
                check=False,
            )

            self.assertEqual(2, completed.returncode, completed.stderr)
            output = json.loads(completed.stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            manifest = json.loads(
                report_directory.joinpath("manifest.json").read_text(
                    encoding="utf-8"
                )
            )
            cleanup = json.loads(
                report_directory.joinpath("cleanup.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual("environment_not_ready", summary["status"])
            self.assertFalse(summary["executed"])
            self.assertEqual(2, summary["exit_code"])
            self.assertEqual(
                [
                    "real_cli_codex_not_found",
                    "real_cli_gemini_not_found",
                ],
                summary["reasons"],
            )
            self.assertEqual(
                {
                    "codex": {
                        "status": "missing",
                        "version_checked": False,
                    },
                    "gemini": {
                        "status": "missing",
                        "version_checked": False,
                    },
                },
                summary["real_cli_preflight"],
            )
            self.assertFalse(summary["workspace_changed"])
            self.assertFalse(manifest["executed"])
            self.assertEqual("real-cli", manifest["profile"])
            self.assertEqual("smoke", manifest["suite"])
            self.assertEqual(
                {
                    "schema_version": 1,
                    "workspace_unchanged": True,
                    "generation_probe_executed": False,
                    "workspace_write_executed": False,
                    "out_of_allowlist_deletion_attempt_count": 0,
                },
                cleanup,
            )
            self.assertEqual([], list(workspace.iterdir()))

    def test_confirmed_real_cli_quota_probe_calls_codex_provider_once(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            fake_bin = root / "bin"
            invocation_log = root / "probe-invocations.txt"
            workspace.mkdir()
            fake_bin.mkdir()
            codex = fake_bin / "codex"
            codex.write_text(
                "#!/bin/sh\n"
                'if [ "$1" = "--version" ]; then echo "codex 1.2.3"; exit 0; fi\n'
                'if [ "$1" = "login" ] && [ "$2" = "status" ]; then exit 0; fi\n'
                "exit 64\n",
                encoding="utf-8",
            )
            codex.chmod(0o755)
            agy = fake_bin / "agy"
            agy.write_text(
                "#!/bin/sh\n"
                'if [ "$1" = "--version" ]; then echo "1.1.15"; exit 0; fi\n'
                'if [ "$1" = "models" ] && [ "$2" = "--help" ]; then exit 0; fi\n'
                'if [ "$1" = "models" ]; then echo "gemini-test-model"; exit 0; fi\n'
                "exit 64\n",
                encoding="utf-8",
            )
            agy.chmod(0o755)
            image_skill = fake_bin / "gpt-image-2-skill"
            image_skill.write_text(
                "#!/bin/sh\n"
                'echo called >> "$PROBE_INVOCATION_LOG"\n'
                'while [ "$#" -gt 0 ]; do\n'
                '  if [ "$1" = "--out" ]; then shift; printf "fake-image" > "$1"; fi\n'
                '  shift\n'
                'done\n'
                'echo "account=user@example.test token=secret-value" >&2\n'
                "exit 0\n",
                encoding="utf-8",
            )
            image_skill.chmod(0o755)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()
            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": str(fake_bin),
                    "CODEX_BIN": str(codex),
                    "AGY_BIN": str(agy),
                    "ANTIGRAVITY_BIN": "",
                    "GEMINI_BIN": "",
                    "GPT_IMAGE_2_SKILL_BIN": str(image_skill),
                    "PROBE_INVOCATION_LOG": str(invocation_log),
                }
            )

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "real-cli",
                    "--suite",
                    "smoke",
                    "--confirm-real-generation-quota-probe",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=environment,
                check=False,
            )

            self.assertEqual(2, completed.returncode, completed.stderr)
            output = json.loads(completed.stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            manifest = json.loads(
                report_directory.joinpath("manifest.json").read_text(
                    encoding="utf-8"
                )
            )
            cleanup = json.loads(
                report_directory.joinpath("cleanup.json").read_text(
                    encoding="utf-8"
                )
            )
            with report_directory.joinpath("metrics.csv").open(
                newline="", encoding="utf-8"
            ) as metrics_file:
                metrics = list(csv.DictReader(metrics_file))

            self.assertEqual(["called"], invocation_log.read_text().splitlines())
            self.assertEqual("quota_probe_complete", summary["status"])
            self.assertTrue(summary["executed"])
            self.assertEqual(1, summary["real_generation_call_count"])
            self.assertTrue(summary["real_cli_preflight"]["codex"]["quota_checked"])
            self.assertEqual(
                "available", summary["real_cli_preflight"]["codex"]["quota_status"]
            )
            self.assertFalse(summary["real_cli_preflight"]["gemini"]["quota_checked"])
            self.assertFalse(summary["real_environment_admission"]["safe_to_start"])
            self.assertEqual("unknown", summary["real_environment_admission"]["gemini_quota_status"])
            self.assertFalse(summary["workspace_changed"])
            self.assertTrue(manifest["executed"])
            self.assertEqual(1, len(metrics))
            self.assertEqual("codex", metrics[0]["provider"])
            self.assertEqual("available", metrics[0]["quota_status"])
            self.assertEqual(
                {
                    "schema_version": 1,
                    "workspace_unchanged": True,
                    "generation_probe_executed": True,
                    "real_generation_call_count": 1,
                    "workspace_write_executed": False,
                    "registered_cleanup_paths": 1,
                    "removed_registered_path_count": 1,
                    "out_of_allowlist_deletion_attempt_count": 0,
                },
                cleanup,
            )
            serialized_report = "\n".join(
                path.read_text(encoding="utf-8", errors="replace")
                for path in report_directory.iterdir()
                if path.is_file()
            )
            self.assertNotIn("user@example.test", serialized_report)
            self.assertNotIn("secret-value", serialized_report)
            self.assertEqual([], list(workspace.iterdir()))

    def test_cancelled_real_cli_quota_probe_reports_failure_and_cleans_up(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            fake_bin = root / "bin"
            invocation_log = root / "probe-invocations.txt"
            workspace.mkdir()
            fake_bin.mkdir()
            codex = fake_bin / "codex"
            codex.write_text(
                "#!/bin/sh\n"
                'if [ "$1" = "--version" ]; then echo "codex 1.2.3"; exit 0; fi\n'
                'if [ "$1" = "login" ] && [ "$2" = "status" ]; then exit 0; fi\n'
                "exit 64\n",
                encoding="utf-8",
            )
            codex.chmod(0o755)
            agy = fake_bin / "agy"
            agy.write_text(
                "#!/bin/sh\n"
                'if [ "$1" = "--version" ]; then echo "1.1.15"; exit 0; fi\n'
                'if [ "$1" = "models" ] && [ "$2" = "--help" ]; then exit 0; fi\n'
                'if [ "$1" = "models" ]; then echo "gemini-test-model"; exit 0; fi\n'
                "exit 64\n",
                encoding="utf-8",
            )
            agy.chmod(0o755)
            image_skill = fake_bin / "gpt-image-2-skill"
            image_skill.write_text(
                "#!/bin/sh\n"
                'echo called >> "$PROBE_INVOCATION_LOG"\n'
                "/bin/sleep 30\n",
                encoding="utf-8",
            )
            image_skill.chmod(0o755)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()
            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": str(fake_bin),
                    "CODEX_BIN": str(codex),
                    "AGY_BIN": str(agy),
                    "ANTIGRAVITY_BIN": "",
                    "GEMINI_BIN": "",
                    "GPT_IMAGE_2_SKILL_BIN": str(image_skill),
                    "PROBE_INVOCATION_LOG": str(invocation_log),
                }
            )
            process = subprocess.Popen(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "real-cli",
                    "--suite",
                    "smoke",
                    "--confirm-real-generation-quota-probe",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=environment,
            )
            deadline = time.monotonic() + 10
            while not invocation_log.exists() and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertTrue(invocation_log.exists(), "quota probe did not start")
            process.send_signal(signal.SIGINT)
            stdout, stderr = process.communicate(timeout=10)

            self.assertNotEqual(0, process.returncode, stderr)
            output = json.loads(stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            cleanup = json.loads(
                report_directory.joinpath("cleanup.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(["called"], invocation_log.read_text().splitlines())
            self.assertEqual(
                "quota_probe_cancelled", summary["status"], summary
            )
            self.assertEqual(
                ["real_cli_codex_quota_probe_cancelled"], summary["reasons"]
            )
            self.assertEqual(1, summary["real_generation_call_count"])
            self.assertTrue(cleanup["generation_probe_executed"])
            self.assertEqual(1, cleanup["removed_registered_path_count"])
            self.assertEqual(0, cleanup["out_of_allowlist_deletion_attempt_count"])
            self.assertEqual([], list(workspace.iterdir()))

    def test_real_cli_quota_probe_fails_closed_for_quota_and_timeout(self):
        for mode, expected_reason, expected_quota_status in (
            (
                "quota",
                "real_cli_codex_quota_exhausted",
                "exhausted",
            ),
            (
                "timeout",
                "real_cli_codex_quota_probe_timeout",
                "unavailable",
            ),
            (
                "history-migration",
                "real_cli_codex_history_migration_failed",
                "unavailable",
            ),
        ):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                workspace = root / "workspace"
                report_root = root / "reports"
                fake_bin = root / "bin"
                invocation_log = root / "probe-invocations.txt"
                workspace.mkdir()
                fake_bin.mkdir()
                codex = fake_bin / "codex"
                codex.write_text(
                    "#!/bin/sh\n"
                    'if [ "$1" = "--version" ]; then echo "codex 1.2.3"; exit 0; fi\n'
                    'if [ "$1" = "login" ] && [ "$2" = "status" ]; then exit 0; fi\n'
                    "exit 64\n",
                    encoding="utf-8",
                )
                codex.chmod(0o755)
                agy = fake_bin / "agy"
                agy.write_text(
                    "#!/bin/sh\n"
                    'if [ "$1" = "--version" ]; then echo "1.1.15"; exit 0; fi\n'
                    'if [ "$1" = "models" ] && [ "$2" = "--help" ]; then exit 0; fi\n'
                    'if [ "$1" = "models" ]; then echo "gemini-test-model"; exit 0; fi\n'
                    "exit 64\n",
                    encoding="utf-8",
                )
                agy.chmod(0o755)
                image_skill = fake_bin / "gpt-image-2-skill"
                image_skill.write_text(
                    "#!/bin/sh\n"
                    'echo called >> "$PROBE_INVOCATION_LOG"\n'
                    + (
                        'echo "429 RESOURCE_EXHAUSTED account=user@example.test token=secret-value" >&2\nexit 9\n'
                        if mode == "quota"
                        else (
                            "exec /bin/sleep 30\n"
                            if mode == "timeout"
                            else 'echo "history_migration_failed" >&2\nexit 1\n'
                        )
                    ),
                    encoding="utf-8",
                )
                image_skill.chmod(0o755)
                reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                reservation.bind(("127.0.0.1", 0))
                port = reservation.getsockname()[1]
                reservation.close()
                environment = os.environ.copy()
                environment.update(
                    {
                        "PATH": str(fake_bin),
                        "CODEX_BIN": str(codex),
                        "AGY_BIN": str(agy),
                        "ANTIGRAVITY_BIN": "",
                        "GEMINI_BIN": "",
                        "GPT_IMAGE_2_SKILL_BIN": str(image_skill),
                        "PROBE_INVOCATION_LOG": str(invocation_log),
                        "REAL_GENERATION_QUOTA_PROBE_TIMEOUT_SECONDS": "1",
                    }
                )
                completed = subprocess.run(
                    [
                        sys.executable,
                        str(SCRIPT),
                        "--profile",
                        "real-cli",
                        "--suite",
                        "smoke",
                        "--confirm-real-generation-quota-probe",
                        "--port",
                        str(port),
                        "--workspace",
                        str(workspace),
                        "--report-root",
                        str(report_root),
                    ],
                    cwd=ROOT,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=environment,
                    timeout=10,
                    check=False,
                )

                self.assertEqual(3, completed.returncode, completed.stderr)
                output = json.loads(completed.stdout)
                report_directory = Path(output["report_directory"])
                summary = json.loads(
                    report_directory.joinpath("summary.json").read_text(
                        encoding="utf-8"
                    )
                )
                cleanup = json.loads(
                    report_directory.joinpath("cleanup.json").read_text(
                        encoding="utf-8"
                    )
                )
                self.assertEqual(["called"], invocation_log.read_text().splitlines())
                self.assertEqual("quota_probe_failed", summary["status"])
                self.assertEqual([expected_reason], summary["reasons"])
                self.assertEqual(
                    expected_quota_status,
                    summary["real_cli_preflight"]["codex"]["quota_status"],
                )
                self.assertFalse(summary["real_environment_admission"]["safe_to_start"])
                self.assertEqual(1, cleanup["real_generation_call_count"])
                self.assertEqual(1, cleanup["removed_registered_path_count"])
                serialized_report = "\n".join(
                    path.read_text(encoding="utf-8", errors="replace")
                    for path in report_directory.iterdir()
                    if path.is_file()
                )
                self.assertNotIn("user@example.test", serialized_report)
                self.assertNotIn("secret-value", serialized_report)
                self.assertEqual([], list(workspace.iterdir()))

    def test_real_cli_quota_probe_confirmation_rejects_unsafe_modes(self):
        unsafe_arguments = (
            ("--profile", "baseline", "--suite", "smoke"),
            ("--profile", "real-cli", "--suite", "standard"),
            (
                "--profile",
                "real-cli",
                "--suite",
                "smoke",
                "--attach-existing-service",
            ),
            (
                "--profile",
                "real-cli",
                "--suite",
                "smoke",
                "--standard-dry-run",
            ),
            (
                "--profile",
                "real-cli",
                "--suite",
                "smoke",
                "--confirm-formal-standard",
            ),
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            workspace.mkdir()
            for arguments in unsafe_arguments:
                with self.subTest(arguments=arguments):
                    completed = subprocess.run(
                        [
                            sys.executable,
                            str(SCRIPT),
                            *arguments,
                            "--confirm-real-generation-quota-probe",
                            "--workspace",
                            str(workspace),
                            "--report-root",
                            str(report_root),
                        ],
                        cwd=ROOT,
                        text=True,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        check=False,
                    )
                    self.assertNotEqual(0, completed.returncode)
                    self.assertIn(
                        "--confirm-real-generation-quota-probe",
                        completed.stderr,
                    )
            self.assertFalse(report_root.exists())
            self.assertEqual([], list(workspace.iterdir()))

    def test_real_cli_reports_unsupported_gemini_authentication_probe(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            fake_bin = root / "bin"
            workspace.mkdir()
            fake_bin.mkdir()
            for name, version in (
                ("codex", "codex 1.2.3"),
                ("gemini", "gemini 4.5.6"),
            ):
                executable = fake_bin / name
                authentication_status = (
                    'if [ "$1" = "login" ] && [ "$2" = "status" ]; then\n'
                    "  exit 0\n"
                    "fi\n"
                    if name == "codex"
                    else ""
                )
                executable.write_text(
                    "#!/bin/sh\n"
                    'if [ "$1" = "--version" ]; then\n'
                    f"  echo '{version}'\n"
                    "  exit 0\n"
                    "fi\n"
                    + authentication_status
                    + "exit 64\n",
                    encoding="utf-8",
                )
                executable.chmod(0o755)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()
            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": str(fake_bin),
                    "CODEX_BIN": "",
                    "ANTIGRAVITY_BIN": "",
                    "AGY_BIN": "",
                    "GEMINI_BIN": "",
                }
            )

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "real-cli",
                    "--suite",
                    "smoke",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=environment,
                check=False,
            )

            self.assertEqual(2, completed.returncode, completed.stderr)
            output = json.loads(completed.stdout)
            summary = json.loads(
                Path(output["report_directory"])
                .joinpath("summary.json")
                .read_text(encoding="utf-8")
            )
            self.assertEqual("environment_not_ready", summary["status"])
            self.assertFalse(summary["executed"])
            self.assertEqual(
                ["real_cli_gemini_authentication_check_unsupported"],
                summary["reasons"],
            )
            self.assertEqual(
                {
                    "codex": {
                        "status": "available",
                        "version": "codex 1.2.3",
                        "version_checked": True,
                        "authentication_checked": True,
                        "authenticated": True,
                        "quota_checked": False,
                    },
                    "gemini": {
                        "status": "available",
                        "version": "gemini 4.5.6",
                        "version_checked": True,
                        "authentication_checked": False,
                        "authentication_probe_supported": False,
                        "quota_checked": False,
                    },
                },
                summary["real_cli_preflight"],
            )
            self.assertFalse(summary["workspace_changed"])
            self.assertEqual([], list(workspace.iterdir()))

    def test_real_cli_uses_read_only_agy_models_authentication_probe(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            fake_bin = root / "bin"
            workspace.mkdir()
            fake_bin.mkdir()
            codex = fake_bin / "codex"
            codex.write_text(
                "#!/bin/sh\n"
                'if [ "$1" = "--version" ]; then\n'
                "  echo 'codex 1.2.3'\n"
                "  exit 0\n"
                "fi\n"
                'if [ "$1" = "login" ] && [ "$2" = "status" ]; then\n'
                "  exit 0\n"
                "fi\n"
                "exit 64\n",
                encoding="utf-8",
            )
            codex.chmod(0o755)
            agy = fake_bin / "agy"
            agy.write_text(
                "#!/bin/sh\n"
                'if [ "$1" = "--version" ]; then\n'
                "  echo '1.1.14'\n"
                "  exit 0\n"
                "fi\n"
                'if [ "$1" = "models" ] && [ "$2" = "--help" ]; then\n'
                "  echo 'List available models'\n"
                "  exit 0\n"
                "fi\n"
                'if [ "$1" = "models" ]; then\n'
                "  echo 'gemini-test-model Test Model'\n"
                "  exit 0\n"
                "fi\n"
                "exit 64\n",
                encoding="utf-8",
            )
            agy.chmod(0o755)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()
            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": str(fake_bin),
                    "CODEX_BIN": "",
                    "ANTIGRAVITY_BIN": "",
                    "AGY_BIN": str(agy),
                    "GEMINI_BIN": "",
                }
            )

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "real-cli",
                    "--suite",
                    "smoke",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=environment,
                check=False,
            )

            self.assertEqual(2, completed.returncode, completed.stderr)
            output = json.loads(completed.stdout)
            summary = json.loads(
                Path(output["report_directory"])
                .joinpath("summary.json")
                .read_text(encoding="utf-8")
            )
            self.assertEqual(
                ["real_cli_quota_check_requires_generation"],
                summary["reasons"],
            )
            self.assertEqual(
                {
                    "status": "blocked",
                    "safe_to_start": False,
                    "read_only_preflight_complete": True,
                    "generation_probe_executed": False,
                    "workspace_write_executed": False,
                    "quota_status": "unknown_requires_real_generation",
                    "next_required_authority": (
                        "explicit_real_generation_quota_probe"
                    ),
                },
                summary["real_environment_admission"],
            )
            self.assertEqual(
                {
                    "status": "available",
                    "version": "1.1.14",
                    "version_checked": True,
                    "authentication_checked": True,
                    "authentication_probe_supported": True,
                    "authenticated": True,
                    "quota_checked": False,
                },
                summary["real_cli_preflight"]["gemini"],
            )
            self.assertFalse(summary["workspace_changed"])
            self.assertEqual([], list(workspace.iterdir()))

    def test_real_cli_reports_all_authentication_blockers_without_changing_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            fake_bin = root / "bin"
            workspace.mkdir()
            fake_bin.mkdir()
            codex = fake_bin / "codex"
            codex.write_text(
                "#!/bin/sh\n"
                'if [ "$1" = "--version" ]; then\n'
                "  echo 'codex 1.2.3'\n"
                "  exit 0\n"
                "fi\n"
                'if [ "$1" = "login" ] && [ "$2" = "status" ]; then\n'
                "  echo 'account=user@example.test token=secret-value' >&2\n"
                "  exit 1\n"
                "fi\n"
                "exit 64\n",
                encoding="utf-8",
            )
            codex.chmod(0o755)
            gemini = fake_bin / "gemini"
            gemini.write_text(
                "#!/bin/sh\n"
                'if [ "$1" = "--version" ]; then\n'
                "  echo 'gemini 4.5.6'\n"
                "  exit 0\n"
                "fi\n"
                "exit 64\n",
                encoding="utf-8",
            )
            gemini.chmod(0o755)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()
            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": str(fake_bin),
                    "CODEX_BIN": "",
                    "ANTIGRAVITY_BIN": "",
                    "AGY_BIN": "",
                    "GEMINI_BIN": "",
                }
            )

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "real-cli",
                    "--suite",
                    "smoke",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=environment,
                check=False,
            )

            self.assertEqual(2, completed.returncode, completed.stderr)
            output = json.loads(completed.stdout)
            summary = json.loads(
                Path(output["report_directory"])
                .joinpath("summary.json")
                .read_text(encoding="utf-8")
            )
            self.assertEqual("environment_not_ready", summary["status"])
            self.assertFalse(summary["executed"])
            self.assertEqual(
                [
                    "real_cli_codex_not_authenticated",
                    "real_cli_gemini_authentication_check_unsupported",
                ],
                summary["reasons"],
            )
            self.assertEqual(
                {
                    "status": "unauthenticated",
                    "version": "codex 1.2.3",
                    "version_checked": True,
                    "authentication_checked": True,
                    "authenticated": False,
                    "quota_checked": False,
                },
                summary["real_cli_preflight"]["codex"],
            )
            self.assertEqual(
                {
                    "status": "available",
                    "version": "gemini 4.5.6",
                    "version_checked": True,
                    "authentication_checked": False,
                    "authentication_probe_supported": False,
                    "quota_checked": False,
                },
                summary["real_cli_preflight"]["gemini"],
            )
            self.assertNotIn("user@example.test", json.dumps(summary))
            self.assertNotIn("secret-value", json.dumps(summary))
            self.assertFalse(summary["workspace_changed"])
            self.assertEqual([], list(workspace.iterdir()))

    def test_real_cli_reports_codex_authentication_check_failure_without_changing_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            fake_bin = root / "bin"
            workspace.mkdir()
            fake_bin.mkdir()
            codex = fake_bin / "codex"
            codex.write_text(
                "#!/bin/sh\n"
                'if [ "$1" = "--version" ]; then\n'
                "  echo 'codex 1.2.3'\n"
                '  /bin/chmod 0644 "$0"\n'
                "  exit 0\n"
                "fi\n"
                "exit 64\n",
                encoding="utf-8",
            )
            codex.chmod(0o755)
            gemini = fake_bin / "gemini"
            gemini.write_text(
                "#!/bin/sh\n"
                'if [ "$1" = "--version" ]; then\n'
                "  echo 'gemini 4.5.6'\n"
                "  exit 0\n"
                "fi\n"
                "exit 64\n",
                encoding="utf-8",
            )
            gemini.chmod(0o755)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()
            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": str(fake_bin),
                    "CODEX_BIN": "",
                    "ANTIGRAVITY_BIN": "",
                    "AGY_BIN": "",
                    "GEMINI_BIN": "",
                }
            )

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "real-cli",
                    "--suite",
                    "smoke",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=environment,
                check=False,
            )

            self.assertEqual(2, completed.returncode, completed.stderr)
            output = json.loads(completed.stdout)
            summary = json.loads(
                Path(output["report_directory"])
                .joinpath("summary.json")
                .read_text(encoding="utf-8")
            )
            self.assertEqual("environment_not_ready", summary["status"])
            self.assertFalse(summary["executed"])
            self.assertEqual(
                [
                    "real_cli_codex_authentication_check_failed",
                    "real_cli_gemini_authentication_check_unsupported",
                ],
                summary["reasons"],
            )
            self.assertEqual(
                {
                    "status": "unavailable",
                    "version": "codex 1.2.3",
                    "version_checked": True,
                    "authentication_checked": False,
                    "quota_checked": False,
                },
                summary["real_cli_preflight"]["codex"],
            )
            self.assertEqual(
                {
                    "status": "available",
                    "version": "gemini 4.5.6",
                    "version_checked": True,
                    "authentication_checked": False,
                    "authentication_probe_supported": False,
                    "quota_checked": False,
                },
                summary["real_cli_preflight"]["gemini"],
            )
            self.assertFalse(summary["workspace_changed"])
            self.assertEqual([], list(workspace.iterdir()))

    def test_baseline_smoke_traces_reversible_settings_interaction_in_a_real_browser(self):
        with self.subTest(scenario="shared baseline smoke"):
            completed, summary, _cleanup, _report_directory, _workspace = (
                self._run_baseline_smoke()
            )
            self.assertEqual(
                0,
                completed.returncode,
                json.dumps(
                    {
                        "stderr": completed.stderr,
                        "status": summary.get("status"),
                        "failure_gate": summary.get("failure_gate"),
                        "failure_phase": summary.get("failure_phase"),
                        "runtime_status_p95_ms": summary.get(
                            "runtime_status_p95_ms"
                        ),
                        "event_loop_lag_p99_ms": summary.get(
                            "event_loop_lag_p99_ms"
                        ),
                        "heartbeat_p99_ms": summary.get("heartbeat_p99_ms"),
                        "browser_canvas_open_gate_failures": summary.get(
                            "browser_canvas_open_gate_failures"
                        ),
                    },
                    ensure_ascii=False,
                ),
            )
            self.assertEqual("steady", summary["browser_settings_phase"])
            self.assertEqual(1, summary["browser_settings_tracer_client_count"])
            self.assertEqual(
                9,
                summary["browser_settings_other_lightweight_client_count"],
            )
            self.assertEqual(1, summary["browser_settings_first_operable_sample_count"])
            self.assertLessEqual(
                summary["browser_settings_first_operable_p95_ms"],
                2_000,
            )
            self.assertEqual(
                2_000,
                summary["browser_settings_first_operable_gate_ms"],
            )
            self.assertEqual(
                10_000,
                summary["browser_settings_unresponsive_timeout_ms"],
            )
            self.assertTrue(summary["browser_settings_interaction_accepted"])
            self.assertTrue(summary["browser_settings_interaction_restored"])
            self.assertLessEqual(
                summary["browser_settings_long_task_max_ms"],
                400,
            )
            self.assertEqual(400, summary["browser_settings_long_task_gate_ms"])
            self.assertEqual(0, summary["browser_settings_console_error_count"])
            self.assertEqual(0, summary["browser_settings_page_error_count"])
            self.assertEqual(
                0,
                summary["browser_settings_unhandled_rejection_count"],
            )
            self.assertEqual([], summary["browser_settings_gate_failures"])
            self.assertTrue(summary["browser_settings_gate_passed"])
            self.assertEqual(10, summary["final_projection_client_count"])
            self.assertTrue(summary["final_projections_consistent"])

    def test_baseline_smoke_opens_a_representative_canvas_in_a_real_browser(self):
        with self.subTest(scenario="shared baseline smoke"):
            completed, summary, _cleanup, _report_directory, _workspace = (
                self._run_baseline_smoke()
            )
            self.assertEqual(
                0,
                completed.returncode,
                json.dumps(
                    {
                        "stderr": completed.stderr,
                        "status": summary.get("status"),
                        "failure_gate": summary.get("failure_gate"),
                        "failure_phase": summary.get("failure_phase"),
                        "runtime_status_p95_ms": summary.get(
                            "runtime_status_p95_ms"
                        ),
                        "event_loop_lag_p99_ms": summary.get(
                            "event_loop_lag_p99_ms"
                        ),
                        "heartbeat_p99_ms": summary.get("heartbeat_p99_ms"),
                        "browser_canvas_open_gate_failures": summary.get(
                            "browser_canvas_open_gate_failures"
                        ),
                    },
                    ensure_ascii=False,
                ),
            )
            self.assertEqual(5_242_880, summary["representative_canvas_target_bytes"])
            self.assertGreaterEqual(
                summary["representative_canvas_payload_bytes"],
                5_000_000,
            )
            self.assertLessEqual(
                summary["representative_canvas_payload_bytes"],
                5_500_000,
            )
            self.assertEqual(80, summary["representative_canvas_node_count"])
            self.assertEqual("burst", summary["browser_canvas_open_phase"])
            self.assertEqual(1, summary["browser_canvas_open_tracer_client_count"])
            self.assertEqual(
                9,
                summary["browser_canvas_open_other_lightweight_client_count"],
            )
            self.assertEqual(
                1,
                summary["browser_canvas_open_first_operable_sample_count"],
            )
            self.assertEqual(
                "canvas_card_activation",
                summary["browser_canvas_open_first_operable_origin"],
            )
            self.assertLessEqual(
                summary["browser_canvas_open_first_operable_p95_ms"],
                1_000,
            )
            self.assertEqual(
                1_000,
                summary["browser_canvas_open_first_operable_gate_ms"],
            )
            self.assertEqual(
                10_000,
                summary["browser_canvas_open_unresponsive_timeout_ms"],
            )
            self.assertTrue(summary["browser_canvas_open_interaction_accepted"])
            self.assertTrue(summary["browser_canvas_open_interaction_restored"])
            self.assertLessEqual(summary["browser_canvas_open_long_task_max_ms"], 400)
            self.assertEqual(0, summary["browser_canvas_open_console_error_count"])
            self.assertEqual(0, summary["browser_canvas_open_page_error_count"])
            self.assertEqual(
                0,
                summary["browser_canvas_open_unhandled_rejection_count"],
            )
            self.assertEqual([], summary["browser_canvas_open_gate_failures"])
            self.assertTrue(summary["browser_canvas_open_gate_passed"])
            self.assertEqual(10, summary["final_projection_client_count"])
            self.assertTrue(summary["final_projections_consistent"])

    def test_started_scenario_failure_keeps_reports_and_removes_isolated_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            workspace.mkdir()
            workspace.joinpath("data").write_text(
                "not-a-directory\n", encoding="utf-8"
            )
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "smoke",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=30,
                check=False,
            )

            self.assertEqual(1, completed.returncode, completed.stderr)
            output = json.loads(completed.stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            cleanup = json.loads(
                report_directory.joinpath("cleanup.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual("failed", summary["status"])
            self.assertTrue(summary["executed"])
            self.assertEqual(1, summary["exit_code"])
            self.assertEqual(["scenario_failed"], summary["reasons"])
            self.assertFalse(summary["workspace_changed"])
            self.assertEqual(0, summary["account_count"])
            self.assertEqual(0, summary["canvas_count"])
            self.assertFalse(cleanup["canvas_purged"])
            self.assertTrue(cleanup["sessions_removed"])
            self.assertTrue(cleanup["accounts_removed"])
            self.assertTrue(report_directory.joinpath("server.log").is_file())
            self.assertTrue(report_directory.joinpath("failure.json").is_file())
            self.assertTrue(report_directory.joinpath("metrics.csv").is_file())
            manifest = json.loads(
                report_directory.joinpath("manifest.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual("baseline", manifest["profile"])
            self.assertEqual("smoke", manifest["suite"])
            self.assertEqual(7425068, manifest["seed"])
            self.assertTrue(manifest["executed"])
            self.assertEqual(
                subprocess.run(
                    ["git", "rev-parse", "HEAD"],
                    cwd=ROOT,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=True,
                ).stdout.strip(),
                manifest["git_commit"],
            )
            self.assertIsInstance(manifest["git_dirty"], bool)
            self.assertFalse(report_directory.joinpath("instance-state").exists())
            self.assertFalse(report_directory.joinpath("runtime-state").exists())
            self.assertFalse(report_directory.joinpath("cache-state").exists())

    def test_interrupted_standard_dry_run_reports_incomplete_warmup_and_cleans_up(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir(parents=True)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            process = subprocess.Popen(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "standard",
                    "--standard-dry-run",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            observed_warmup_start = False
            stdout = ""
            stderr = ""
            try:
                deadline = time.monotonic() + 25
                while time.monotonic() < deadline and process.poll() is None:
                    report_directories = (
                        sorted(report_root.iterdir())
                        if report_root.is_dir()
                        else []
                    )
                    if report_directories:
                        metrics_path = report_directories[-1] / "metrics.csv"
                        if metrics_path.is_file():
                            with metrics_path.open(
                                newline="", encoding="utf-8"
                            ) as metrics_file:
                                metrics = list(csv.DictReader(metrics_file))
                            observed_warmup_start = any(
                                metric["operation"] == "phase_warmup_started"
                                and metric["status"] == "started"
                                for metric in metrics
                            )
                            if observed_warmup_start:
                                break
                    time.sleep(0.02)

                if process.poll() is None:
                    process.send_signal(signal.SIGINT)
                stdout, stderr = process.communicate(timeout=20)
            finally:
                if process.poll() is None:
                    process.send_signal(signal.SIGINT)
                    try:
                        process.communicate(timeout=20)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.communicate(timeout=5)

            self.assertTrue(
                observed_warmup_start,
                "metrics.csv did not expose the warmup start before exit; "
                f"returncode={process.returncode}; stdout={stdout!r}; stderr={stderr!r}",
            )
            self.assertEqual(1, process.returncode, stderr)
            output = json.loads(stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            failure = json.loads(
                report_directory.joinpath("failure.json").read_text(
                    encoding="utf-8"
                )
            )
            cleanup = json.loads(
                report_directory.joinpath("cleanup.json").read_text(
                    encoding="utf-8"
                )
            )
            with report_directory.joinpath("metrics.csv").open(
                newline="", encoding="utf-8"
            ) as metrics_file:
                persisted_metrics = list(csv.DictReader(metrics_file))

            self.assertEqual("failed", summary["status"])
            self.assertEqual("standard_dry_run", summary["execution_mode"])
            self.assertFalse(summary["formal_result"])
            self.assertEqual("warmup", summary["failure_phase"])
            self.assertEqual([], summary["completed_phase_names"])
            self.assertEqual("KeyboardInterrupt", failure["exception_type"])
            self.assertEqual("warmup", failure["phase"])
            self.assertEqual(
                ["phase_warmup_started"],
                [
                    metric["operation"]
                    for metric in persisted_metrics
                    if metric["operation"].startswith("phase_warmup_")
                ],
            )
            self.assertEqual(
                [],
                [
                    metric
                    for metric in persisted_metrics
                    if metric["operation"] == "steady_node_move"
                ],
            )
            self.assertTrue(cleanup["canvas_purged"])
            self.assertTrue(cleanup["generation_media_purged"])
            self.assertTrue(cleanup["provider_settings_restored"])
            self.assertTrue(cleanup["sessions_removed"])
            self.assertTrue(cleanup["accounts_removed"])

    def test_confirmed_formal_standard_enters_warmup_and_cleans_on_interrupt(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir(parents=True)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            process = subprocess.Popen(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "standard",
                    "--confirm-formal-standard",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            observed_warmup_start = False
            stdout = ""
            stderr = ""
            try:
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline and process.poll() is None:
                    report_directories = (
                        sorted(report_root.iterdir())
                        if report_root.is_dir()
                        else []
                    )
                    if report_directories:
                        metrics_path = report_directories[-1] / "metrics.csv"
                        if metrics_path.is_file():
                            with metrics_path.open(
                                newline="", encoding="utf-8"
                            ) as metrics_file:
                                metrics = list(csv.DictReader(metrics_file))
                            observed_warmup_start = any(
                                metric["operation"] == "phase_warmup_started"
                                and metric["status"] == "started"
                                for metric in metrics
                            )
                            if observed_warmup_start:
                                break
                    time.sleep(0.02)
                if process.poll() is None:
                    process.send_signal(signal.SIGINT)
                stdout, stderr = process.communicate(timeout=25)
            finally:
                if process.poll() is None:
                    process.send_signal(signal.SIGINT)
                    try:
                        process.communicate(timeout=20)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.communicate(timeout=5)

            self.assertTrue(
                observed_warmup_start,
                "formal metrics.csv did not expose warmup start; "
                f"returncode={process.returncode}; stdout={stdout!r}; stderr={stderr!r}",
            )
            self.assertEqual(1, process.returncode, stderr)
            output = json.loads(stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            failure = json.loads(
                report_directory.joinpath("failure.json").read_text(
                    encoding="utf-8"
                )
            )
            cleanup = json.loads(
                report_directory.joinpath("cleanup.json").read_text(
                    encoding="utf-8"
                )
            )

            self.assertEqual("formal_standard", summary["execution_mode"])
            self.assertTrue(summary["formal_result"])
            self.assertEqual(
                [120, 1200, 300, 30],
                [
                    phase["duration_seconds"]
                    for phase in summary["suite_plan"]["phases"][:4]
                ],
            )
            self.assertGreaterEqual(
                summary[
                    "generation_provider_response_wait_timeout_seconds"
                ],
                1_560,
            )
            self.assertEqual("warmup", summary["failure_phase"])
            self.assertEqual([], summary["completed_phase_names"])
            self.assertEqual("KeyboardInterrupt", failure["exception_type"])
            self.assertEqual("warmup", failure["phase"])
            self.assertTrue(cleanup["canvas_purged"])
            self.assertTrue(cleanup["generation_media_purged"])
            self.assertTrue(cleanup["provider_settings_restored"])
            self.assertTrue(cleanup["sessions_removed"])
            self.assertTrue(cleanup["accounts_removed"])
            self.assertEqual(
                0,
                cleanup["out_of_allowlist_deletion_attempt_count"],
            )

    def test_interrupted_recovery_keeps_confirmed_runtime_status_prefix(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir(parents=True)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            process = subprocess.Popen(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "standard",
                    "--standard-dry-run",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            observed_recovery_metrics: list[dict[str, str]] = []
            stdout = ""
            stderr = ""
            try:
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline and process.poll() is None:
                    report_directories = (
                        sorted(report_root.iterdir())
                        if report_root.is_dir()
                        else []
                    )
                    if report_directories:
                        metrics_path = report_directories[-1] / "metrics.csv"
                        if metrics_path.is_file():
                            with metrics_path.open(
                                newline="", encoding="utf-8"
                            ) as metrics_file:
                                metrics = list(csv.DictReader(metrics_file))
                            recovery_metrics = [
                                metric
                                for metric in metrics
                                if metric["operation"]
                                == "runtime_status_recovery"
                            ]
                            if 0 < len(recovery_metrics) < 5:
                                observed_recovery_metrics = recovery_metrics
                                break
                    time.sleep(0.02)

                if process.poll() is None:
                    process.send_signal(signal.SIGINT)
                stdout, stderr = process.communicate(timeout=20)
            finally:
                if process.poll() is None:
                    process.send_signal(signal.SIGINT)
                    try:
                        process.communicate(timeout=20)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.communicate(timeout=5)

            self.assertTrue(
                observed_recovery_metrics,
                "metrics.csv did not expose a partial recovery runtime-status "
                "prefix; "
                f"returncode={process.returncode}; stdout={stdout!r}; stderr={stderr!r}",
            )
            self.assertEqual(1, process.returncode, stderr)
            output = json.loads(stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            failure = json.loads(
                report_directory.joinpath("failure.json").read_text(
                    encoding="utf-8"
                )
            )
            cleanup = json.loads(
                report_directory.joinpath("cleanup.json").read_text(
                    encoding="utf-8"
                )
            )
            with report_directory.joinpath("metrics.csv").open(
                newline="", encoding="utf-8"
            ) as metrics_file:
                persisted_metrics = list(csv.DictReader(metrics_file))
            persisted_recovery_metrics = [
                metric
                for metric in persisted_metrics
                if metric["operation"] == "runtime_status_recovery"
            ]

            self.assertEqual("failed", summary["status"])
            self.assertEqual("standard_dry_run", summary["execution_mode"])
            self.assertFalse(summary["formal_result"])
            self.assertEqual("recovery", summary["failure_phase"])
            self.assertEqual(
                ["warmup", "steady", "burst"],
                summary["completed_phase_names"],
            )
            self.assertEqual("KeyboardInterrupt", failure["exception_type"])
            self.assertEqual("recovery", failure["phase"])
            self.assertGreaterEqual(
                len(persisted_recovery_metrics),
                len(observed_recovery_metrics),
            )
            self.assertLess(len(persisted_recovery_metrics), 5)
            self.assertTrue(
                all(
                    metric["status"] == "ready"
                    for metric in persisted_recovery_metrics
                )
            )
            self.assertEqual(
                [],
                [
                    metric
                    for metric in persisted_metrics
                    if metric["operation"] == "phase_recovery_complete"
                ],
            )
            self.assertEqual(
                [],
                [
                    metric
                    for metric in persisted_metrics
                    if metric["operation"] == "slow_client_pressure"
                ],
            )
            self.assertTrue(cleanup["canvas_purged"])
            self.assertTrue(cleanup["generation_media_purged"])
            self.assertEqual(1, cleanup["generation_media_removed_count"])
            self.assertTrue(cleanup["provider_settings_restored"])
            self.assertTrue(cleanup["sessions_removed"])
            self.assertTrue(cleanup["accounts_removed"])

    def test_interrupted_full_browser_keeps_completed_samples_and_removes_profiles(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir(parents=True)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            process = subprocess.Popen(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "standard",
                    "--standard-dry-run",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            observed_browser_metrics: list[dict[str, str]] = []
            stdout = ""
            stderr = ""
            try:
                deadline = time.monotonic() + 60
                while time.monotonic() < deadline and process.poll() is None:
                    report_directories = (
                        sorted(report_root.iterdir())
                        if report_root.is_dir()
                        else []
                    )
                    if report_directories:
                        metrics_path = report_directories[-1] / "metrics.csv"
                        if metrics_path.is_file():
                            with metrics_path.open(
                                newline="", encoding="utf-8"
                            ) as metrics_file:
                                metrics = list(csv.DictReader(metrics_file))
                            browser_metrics = [
                                metric
                                for metric in metrics
                                if metric["operation"]
                                == "full_browser_first_operable"
                            ]
                            if 0 < len(browser_metrics) < 10:
                                observed_browser_metrics = browser_metrics
                                break
                    time.sleep(0.05)

                if process.poll() is None:
                    process.send_signal(signal.SIGINT)
                stdout, stderr = process.communicate(timeout=60)
            finally:
                if process.poll() is None:
                    process.send_signal(signal.SIGINT)
                    try:
                        process.communicate(timeout=20)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.communicate(timeout=5)

            self.assertTrue(
                observed_browser_metrics,
                "metrics.csv did not expose completed full-browser samples "
                "before the phase ended; "
                f"returncode={process.returncode}; stdout={stdout!r}; stderr={stderr!r}",
            )
            self.assertEqual(1, process.returncode, stderr)
            output = json.loads(stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            failure = json.loads(
                report_directory.joinpath("failure.json").read_text(
                    encoding="utf-8"
                )
            )
            cleanup = json.loads(
                report_directory.joinpath("cleanup.json").read_text(
                    encoding="utf-8"
                )
            )
            with report_directory.joinpath("metrics.csv").open(
                newline="", encoding="utf-8"
            ) as metrics_file:
                persisted_metrics = list(csv.DictReader(metrics_file))
            persisted_browser_metrics = [
                metric
                for metric in persisted_metrics
                if metric["operation"] == "full_browser_first_operable"
            ]

            self.assertEqual("failed", summary["status"])
            self.assertEqual("full_browser", summary["failure_phase"])
            self.assertEqual(
                ["warmup", "steady", "burst", "recovery"],
                summary["completed_phase_names"],
            )
            self.assertEqual("KeyboardInterrupt", failure["exception_type"])
            self.assertEqual("full_browser", failure["phase"])
            self.assertGreaterEqual(
                len(persisted_browser_metrics),
                len(observed_browser_metrics),
            )
            self.assertLess(len(persisted_browser_metrics), 10)
            self.assertEqual(
                [],
                [
                    metric
                    for metric in persisted_metrics
                    if metric["operation"] == "phase_full_browser_complete"
                ],
            )
            self.assertTrue(cleanup["full_browser_processes_stopped"])
            self.assertEqual(10, cleanup["full_browser_profiles_removed_count"])
            self.assertTrue(cleanup["canvas_purged"])
            self.assertTrue(cleanup["generation_media_purged"])
            self.assertTrue(cleanup["provider_settings_restored"])
            self.assertTrue(cleanup["sessions_removed"])
            self.assertTrue(cleanup["accounts_removed"])

    def test_interrupted_smoke_keeps_previously_confirmed_mutation_metrics(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir(parents=True)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            process = subprocess.Popen(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "smoke",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            observed_metrics: list[dict[str, str]] = []
            stdout = ""
            stderr = ""
            try:
                deadline = time.monotonic() + 20
                steady_deadline: float | None = None
                while time.monotonic() < deadline and process.poll() is None:
                    report_directories = (
                        sorted(report_root.iterdir())
                        if report_root.is_dir()
                        else []
                    )
                    if report_directories:
                        metrics_path = report_directories[-1] / "metrics.csv"
                        if metrics_path.is_file():
                            with metrics_path.open(
                                newline="", encoding="utf-8"
                            ) as metrics_file:
                                metrics = list(csv.DictReader(metrics_file))
                            node_create_metrics = [
                                metric
                                for metric in metrics
                                if metric["operation"] == "node_create"
                                and metric["status"] == "acknowledged"
                            ]
                            steady_metrics = [
                                metric
                                for metric in metrics
                                if metric["operation"] == "steady_node_move"
                                and metric["status"] == "acknowledged"
                            ]
                            if len(node_create_metrics) == 10:
                                steady_deadline = steady_deadline or (
                                    time.monotonic() + 1.5
                                )
                            if 0 < len(steady_metrics) < 20:
                                observed_metrics = steady_metrics
                                break
                            if (
                                steady_deadline is not None
                                and time.monotonic() >= steady_deadline
                            ):
                                break
                    time.sleep(0.02)

                if process.poll() is None:
                    process.send_signal(signal.SIGINT)
                stdout, stderr = process.communicate(timeout=20)
            finally:
                if process.poll() is None:
                    process.send_signal(signal.SIGINT)
                    try:
                        process.communicate(timeout=20)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.communicate(timeout=5)

            self.assertTrue(
                observed_metrics,
                "metrics.csv did not expose a partial confirmed steady Mutation "
                "prefix; "
                f"returncode={process.returncode}; stdout={stdout!r}; stderr={stderr!r}",
            )
            self.assertEqual(1, process.returncode, stderr)
            output = json.loads(stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            cleanup = json.loads(
                report_directory.joinpath("cleanup.json").read_text(
                    encoding="utf-8"
                )
            )
            with report_directory.joinpath("metrics.csv").open(
                newline="", encoding="utf-8"
            ) as metrics_file:
                persisted_metrics = list(csv.DictReader(metrics_file))
            persisted_node_creates = [
                metric
                for metric in persisted_metrics
                if metric["operation"] == "node_create"
                and metric["status"] == "acknowledged"
            ]
            persisted_steady_metrics = [
                metric
                for metric in persisted_metrics
                if metric["operation"] == "steady_node_move"
                and metric["status"] == "acknowledged"
            ]

            self.assertEqual("failed", summary["status"])
            self.assertEqual(1, summary["exit_code"])
            self.assertEqual(["scenario_failed"], summary["reasons"])
            self.assertTrue(cleanup["canvas_purged"])
            self.assertTrue(cleanup["sessions_removed"])
            self.assertTrue(cleanup["accounts_removed"])
            self.assertEqual(
                [str(revision) for revision in range(1, 11)],
                [metric["revision"] for metric in persisted_node_creates],
            )
            self.assertGreaterEqual(
                len(persisted_steady_metrics), len(observed_metrics)
            )
            self.assertEqual(
                [
                    str(revision)
                    for revision in range(11, 11 + len(persisted_steady_metrics))
                ],
                [metric["revision"] for metric in persisted_steady_metrics],
            )

    def test_interrupted_burst_keeps_its_confirmed_mutation_prefix(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir(parents=True)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            process = subprocess.Popen(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "smoke",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            observed_burst_metrics: list[dict[str, str]] = []
            stdout = ""
            stderr = ""
            try:
                deadline = time.monotonic() + 25
                while time.monotonic() < deadline and process.poll() is None:
                    report_directories = (
                        sorted(report_root.iterdir())
                        if report_root.is_dir()
                        else []
                    )
                    if report_directories:
                        metrics_path = report_directories[-1] / "metrics.csv"
                        if metrics_path.is_file():
                            with metrics_path.open(
                                newline="", encoding="utf-8"
                            ) as metrics_file:
                                metrics = list(csv.DictReader(metrics_file))
                            burst_metrics = [
                                metric
                                for metric in metrics
                                if metric["operation"] == "burst_node_move"
                                and metric["status"] == "acknowledged"
                            ]
                            if 0 < len(burst_metrics) < 40:
                                observed_burst_metrics = burst_metrics
                                break
                    time.sleep(0.02)

                if process.poll() is None:
                    process.send_signal(signal.SIGINT)
                stdout, stderr = process.communicate(timeout=20)
            finally:
                if process.poll() is None:
                    process.send_signal(signal.SIGINT)
                    try:
                        process.communicate(timeout=20)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.communicate(timeout=5)

            self.assertGreater(
                len(observed_burst_metrics),
                0,
                "metrics.csv did not expose confirmed burst Mutations before "
                "the burst window ended; "
                f"returncode={process.returncode}; stdout={stdout!r}; stderr={stderr!r}",
            )
            self.assertLess(len(observed_burst_metrics), 40)
            self.assertEqual(1, process.returncode, stderr)
            output = json.loads(stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            cleanup = json.loads(
                report_directory.joinpath("cleanup.json").read_text(
                    encoding="utf-8"
                )
            )
            with report_directory.joinpath("metrics.csv").open(
                newline="", encoding="utf-8"
            ) as metrics_file:
                persisted_metrics = list(csv.DictReader(metrics_file))
            persisted_steady_metrics = [
                metric
                for metric in persisted_metrics
                if metric["operation"] == "steady_node_move"
                and metric["status"] == "acknowledged"
            ]
            persisted_burst_metrics = [
                metric
                for metric in persisted_metrics
                if metric["operation"] == "burst_node_move"
                and metric["status"] == "acknowledged"
            ]

            self.assertEqual("failed", summary["status"])
            self.assertEqual(["scenario_failed"], summary["reasons"])
            self.assertEqual("burst", summary["failure_phase"])
            self.assertEqual("burst_stream", summary["failure_gate"])
            self.assertEqual(["steady"], summary["completed_phase_names"])
            self.assertTrue(cleanup["async_receive_tasks_stopped"])
            self.assertNotIn("Task exception was never retrieved", stderr)
            self.assertTrue(cleanup["canvas_purged"])
            self.assertTrue(cleanup["sessions_removed"])
            self.assertTrue(cleanup["accounts_removed"])
            self.assertEqual(
                [str(revision) for revision in range(11, 31)],
                [metric["revision"] for metric in persisted_steady_metrics],
            )
            self.assertGreaterEqual(
                len(persisted_burst_metrics), len(observed_burst_metrics)
            )
            self.assertEqual(
                [
                    str(revision)
                    for revision in range(32, 32 + len(persisted_burst_metrics))
                ],
                [metric["revision"] for metric in persisted_burst_metrics],
            )

    def test_interrupted_generation_overlap_keeps_confirmed_burst_prefix(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir(parents=True)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            process = subprocess.Popen(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "smoke",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            observed_generation_metrics: list[dict[str, str]] = []
            stdout = ""
            stderr = ""
            try:
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline and process.poll() is None:
                    report_directories = (
                        sorted(report_root.iterdir())
                        if report_root.is_dir()
                        else []
                    )
                    if report_directories:
                        metrics_path = report_directories[-1] / "metrics.csv"
                        if metrics_path.is_file():
                            with metrics_path.open(
                                newline="", encoding="utf-8"
                            ) as metrics_file:
                                metrics = list(csv.DictReader(metrics_file))
                            target_prepared = any(
                                metric["operation"] == "generation_target_prepare"
                                and metric["revision"] == "31"
                                for metric in metrics
                            )
                            burst_metrics = [
                                metric
                                for metric in metrics
                                if metric["operation"] == "burst_node_move"
                                and metric["status"] == "acknowledged"
                            ]
                            if target_prepared and 0 < len(burst_metrics) < 40:
                                observed_generation_metrics = burst_metrics
                                break
                    time.sleep(0.02)

                if process.poll() is None:
                    process.send_signal(signal.SIGINT)
                stdout, stderr = process.communicate(timeout=20)
            finally:
                if process.poll() is None:
                    process.send_signal(signal.SIGINT)
                    try:
                        process.communicate(timeout=20)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.communicate(timeout=5)

            self.assertGreater(
                len(observed_generation_metrics),
                0,
                "metrics.csv did not expose confirmed Generation-parallel "
                "Mutations before the window ended; "
                f"returncode={process.returncode}; stdout={stdout!r}; stderr={stderr!r}",
            )
            self.assertLess(len(observed_generation_metrics), 40)
            self.assertEqual(1, process.returncode, stderr)
            output = json.loads(stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            cleanup = json.loads(
                report_directory.joinpath("cleanup.json").read_text(
                    encoding="utf-8"
                )
            )
            with report_directory.joinpath("metrics.csv").open(
                newline="", encoding="utf-8"
            ) as metrics_file:
                persisted_metrics = list(csv.DictReader(metrics_file))
            persisted_burst_metrics = [
                metric
                for metric in persisted_metrics
                if metric["operation"] == "burst_node_move"
                and metric["status"] == "acknowledged"
            ]
            persisted_generation_metrics = [
                metric
                for metric in persisted_metrics
                if metric["operation"] == "burst_node_move"
                and metric["status"] == "acknowledged"
            ]
            separate_generation_metrics = [
                metric
                for metric in persisted_metrics
                if metric["operation"] == "generation_parallel_node_move"
            ]

            self.assertEqual("failed", summary["status"])
            self.assertEqual(["scenario_failed"], summary["reasons"])
            self.assertTrue(cleanup["canvas_purged"])
            self.assertTrue(cleanup["generation_media_purged"])
            self.assertTrue(cleanup["sessions_removed"])
            self.assertTrue(cleanup["accounts_removed"])
            self.assertEqual(
                [
                    str(revision)
                    for revision in range(32, 32 + len(persisted_burst_metrics))
                ],
                [metric["revision"] for metric in persisted_burst_metrics],
            )
            self.assertGreaterEqual(
                len(persisted_generation_metrics),
                len(observed_generation_metrics),
            )
            self.assertEqual(
                [
                    str(revision)
                    for revision in range(
                        32,
                        32 + len(persisted_generation_metrics),
                    )
                ],
                [metric["revision"] for metric in persisted_generation_metrics],
            )
            self.assertEqual([], separate_generation_metrics)

    def test_baseline_generation_run_overlaps_burst_without_a_separate_mutation_window(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            report_root = root / "reports"
            (workspace / "data").mkdir(parents=True)
            (workspace / "assets").mkdir(parents=True)
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()

            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--profile",
                    "baseline",
                    "--suite",
                    "smoke",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                    "--report-root",
                    str(report_root),
                    "--seed",
                    "7425068",
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=60,
                check=False,
            )

            output = json.loads(completed.stdout)
            report_directory = Path(output["report_directory"])
            summary = json.loads(
                report_directory.joinpath("summary.json").read_text(
                    encoding="utf-8"
                )
            )
            cleanup = json.loads(
                report_directory.joinpath("cleanup.json").read_text(
                    encoding="utf-8"
                )
            )
            with report_directory.joinpath("metrics.csv").open(
                newline="", encoding="utf-8"
            ) as metrics_file:
                metrics = list(csv.DictReader(metrics_file))

            self.assertTrue(summary["executed"])
            self.assertEqual("burst", summary["generation_overlap_phase"])
            self.assertFalse(summary["generation_separate_mutation_window"])
            self.assertEqual(
                "burst_node_move",
                summary["generation_mutation_metric_source"],
            )
            self.assertEqual(
                summary["burst_mutation_sample_count"],
                summary["generation_mutation_sample_count"],
            )
            self.assertEqual(
                summary["burst_mutation_confirmed_revisions"],
                summary["generation_mutation_confirmed_revisions"],
            )
            self.assertEqual(1, summary["generation_run_count"])
            self.assertEqual("succeeded", summary["generation_status"])
            self.assertEqual(1, summary["generation_output_count"])
            self.assertEqual(1, summary["generation_log_count"])
            self.assertTrue(summary["generation_final_projections_consistent"])

            target_metric_indexes = [
                index
                for index, metric in enumerate(metrics)
                if metric["operation"] == "generation_target_prepare"
            ]
            burst_metric_indexes = [
                index
                for index, metric in enumerate(metrics)
                if metric["operation"] == "burst_node_move"
            ]
            separate_generation_metrics = [
                metric
                for metric in metrics
                if metric["operation"] == "generation_parallel_node_move"
            ]
            self.assertEqual(1, len(target_metric_indexes))
            self.assertEqual(40, len(burst_metric_indexes))
            self.assertLess(target_metric_indexes[0], min(burst_metric_indexes))
            self.assertEqual([], separate_generation_metrics)
            self.assertTrue(cleanup["canvas_purged"])
            self.assertTrue(cleanup["generation_media_purged"])
            self.assertTrue(cleanup["sessions_removed"])
            self.assertTrue(cleanup["accounts_removed"])

    def test_baseline_smoke_mutates_one_canvas_from_ten_isolated_sessions_and_purges_it(self):
        with self.subTest(scenario="shared baseline smoke"):
            completed, summary, cleanup, report_directory, workspace = (
                self._run_baseline_smoke()
            )
            self.assertEqual(
                0,
                completed.returncode,
                json.dumps(
                    {
                        "stderr": completed.stderr,
                        "status": summary.get("status"),
                        "failure_gate": summary.get("failure_gate"),
                        "failure_phase": summary.get("failure_phase"),
                        "runtime_status_p95_ms": summary.get(
                            "runtime_status_p95_ms"
                        ),
                        "event_loop_lag_p99_ms": summary.get(
                            "event_loop_lag_p99_ms"
                        ),
                        "heartbeat_p99_ms": summary.get("heartbeat_p99_ms"),
                        "browser_canvas_open_gate_failures": summary.get(
                            "browser_canvas_open_gate_failures"
                        ),
                    },
                    ensure_ascii=False,
                ),
            )
            self.assertEqual("passed", summary["status"])
            self.assertTrue(summary["executed"])
            self.assertEqual(
                {
                    "steady_load_seconds": 1,
                    "steady_mutations_per_second": 20,
                    "burst_load_seconds": 1,
                    "burst_mutations_per_second": 40,
                    "generation_run_overlap_phase": "burst",
                    "generation_run_max_concurrency": 1,
                    "generation_run_separate_phase": False,
                    "recovery_gate_seconds": 30,
                    "backend_client_count": 10,
                    "browser_tracer_client_count": 1,
                    "lightweight_client_count": 9,
                },
                summary["suite_plan"],
            )
            self.assertEqual(10, summary["account_count"])
            self.assertEqual(1, summary["canvas_count"])
            self.assertEqual(9, summary["project_grant_count"])
            self.assertEqual(9, summary["designer_canvas_visibility_count"])
            self.assertEqual(10, summary["mutation_client_count"])
            self.assertEqual(10, summary["mutation_sample_count"])
            self.assertEqual(0, summary["permanent_failure_count"])
            self.assertEqual(list(range(1, 11)), summary["confirmed_revisions"])
            self.assertEqual(
                summary["slow_client_fast_probe_revision"],
                summary["final_revision"],
            )
            self.assertEqual(80, summary["final_node_count"])
            self.assertEqual(10, summary["final_projection_client_count"])
            self.assertTrue(summary["final_projections_consistent"])
            self.assertEqual(20, summary["steady_mutation_target_rate_per_second"])
            self.assertEqual(1, summary["steady_mutation_window_seconds"])
            self.assertEqual(10, summary["steady_mutation_client_count"])
            self.assertEqual(20, summary["steady_mutation_sample_count"])
            self.assertEqual(
                "sender_ack_only",
                summary["steady_mutation_delivery_retention_policy"],
            )
            self.assertEqual(
                200,
                summary["steady_mutation_validated_delivery_count"],
            )
            self.assertEqual(
                20,
                summary["steady_mutation_retained_ack_count"],
            )
            self.assertEqual(0, summary["steady_mutation_permanent_failure_count"])
            self.assertEqual(
                list(range(11, 31)),
                summary["steady_mutation_confirmed_revisions"],
            )
            self.assertLessEqual(summary["steady_mutation_send_window_ms"], 1000)
            self.assertLessEqual(summary["steady_mutation_p95_ms"], 150)
            self.assertLessEqual(summary["steady_mutation_p99_ms"], 300)
            self.assertTrue(summary["steady_mutation_gate_passed"])
            self.assertEqual(40, summary["burst_mutation_target_rate_per_second"])
            self.assertEqual(1, summary["burst_mutation_window_seconds"])
            self.assertEqual(10, summary["burst_mutation_client_count"])
            self.assertEqual(40, summary["burst_mutation_sample_count"])
            self.assertEqual(
                "sender_ack_only",
                summary["burst_mutation_delivery_retention_policy"],
            )
            self.assertEqual(
                400,
                summary["burst_mutation_validated_delivery_count"],
            )
            self.assertEqual(
                40,
                summary["burst_mutation_retained_ack_count"],
            )
            self.assertEqual(0, summary["burst_mutation_permanent_failure_count"])
            self.assertEqual(
                list(range(32, 72)),
                summary["burst_mutation_confirmed_revisions"],
            )
            self.assertLessEqual(summary["burst_mutation_send_window_ms"], 1000)
            self.assertGreaterEqual(summary["burst_mutation_p95_ms"], 0)
            self.assertGreaterEqual(summary["burst_mutation_p99_ms"], 0)
            self.assertEqual(
                summary["burst_mutation_confirmed_revisions"][-1]
                + summary["browser_canvas_open_background_mutation_count"],
                summary["burst_recovery_revision"],
            )
            self.assertLessEqual(summary["burst_recovery_ms"], 30_000)
            self.assertTrue(summary["burst_queue_recovered"])
            self.assertTrue(summary["burst_mutation_gate_passed"])
            self.assertEqual(1, summary["slow_client_count"])
            self.assertEqual(10, summary["slow_client_fast_client_count"])
            self.assertEqual(8, summary["slow_client_pressure_sample_count"])
            self.assertEqual(0, summary["slow_client_fast_failure_count"])
            self.assertEqual(4409, summary["slow_client_close_code"])
            self.assertTrue(summary["slow_client_resync_required"])
            self.assertEqual(
                summary["generation_final_revision"],
                summary["slow_client_revision_before"],
            )
            self.assertEqual(
                summary["slow_client_revision_before"] + 9,
                summary["slow_client_fast_probe_revision"],
            )
            self.assertGreaterEqual(
                summary["slow_client_fast_pressure_p95_ms"], 0
            )
            self.assertGreaterEqual(
                summary["slow_client_fast_pressure_p99_ms"], 0
            )
            self.assertGreaterEqual(
                summary["slow_client_fast_probe_latency_ms"], 0
            )
            self.assertTrue(summary["slow_client_isolated"])
            self.assertTrue(summary["slow_client_gate_passed"])
            self.assertEqual(1, summary["generation_run_count"])
            self.assertEqual("succeeded", summary["generation_status"])
            self.assertEqual(1, summary["generation_output_count"])
            self.assertTrue(summary["generation_output_written_back"])
            self.assertEqual(1, summary["generation_log_count"])
            self.assertEqual("success", summary["generation_log_status"])
            self.assertEqual("burst", summary["generation_overlap_phase"])
            self.assertFalse(summary["generation_separate_mutation_window"])
            self.assertEqual(
                "burst_node_move",
                summary["generation_mutation_metric_source"],
            )
            self.assertEqual(30, summary["generation_revision_before"])
            self.assertEqual(
                summary["burst_recovery_revision"] + 1,
                summary["generation_final_revision"],
            )
            self.assertTrue(summary["generation_revisions_continuous"])
            self.assertEqual(40, summary["generation_mutation_target_rate_per_second"])
            self.assertEqual(1, summary["generation_mutation_window_seconds"])
            self.assertEqual(10, summary["generation_mutation_client_count"])
            self.assertEqual(40, summary["generation_mutation_sample_count"])
            self.assertEqual(
                "sender_ack_only",
                summary["generation_mutation_delivery_retention_policy"],
            )
            self.assertEqual(
                400,
                summary["generation_mutation_validated_delivery_count"],
            )
            self.assertEqual(
                40,
                summary["generation_mutation_retained_ack_count"],
            )
            self.assertEqual(
                0,
                summary["generation_mutation_permanent_failure_count"],
            )
            self.assertEqual(
                list(range(32, 72)),
                summary["generation_mutation_confirmed_revisions"],
            )
            self.assertLessEqual(summary["generation_mutation_send_window_ms"], 1000)
            self.assertGreaterEqual(summary["generation_mutation_p95_ms"], 0)
            self.assertGreaterEqual(summary["generation_mutation_p99_ms"], 0)
            self.assertTrue(summary["generation_mutation_gate_passed"])
            self.assertEqual(
                10,
                summary["generation_final_projection_client_count"],
            )
            self.assertTrue(summary["generation_final_projections_consistent"])
            self.assertEqual(10, summary["runtime_status_sample_count"])
            self.assertEqual(
                {
                    "steady": 5,
                    "burst": 5,
                },
                summary["runtime_status_samples_by_phase"],
            )
            self.assertEqual(0, summary["runtime_status_timeout_count"])
            self.assertEqual(0, summary["runtime_status_failure_count"])
            self.assertLessEqual(summary["runtime_status_p95_ms"], 50)
            self.assertEqual(50, summary["runtime_status_p95_gate_ms"])
            self.assertTrue(summary["runtime_status_gate_passed"])
            self.assertEqual(10, summary["event_loop_lag_probe_interval_ms"])
            self.assertEqual(
                {"steady", "burst"},
                set(summary["event_loop_lag_samples_by_phase"]),
            )
            self.assertTrue(
                all(
                    sample_count >= 50
                    for sample_count in summary[
                        "event_loop_lag_samples_by_phase"
                    ].values()
                )
            )
            self.assertEqual(
                sum(summary["event_loop_lag_samples_by_phase"].values()),
                summary["event_loop_lag_sample_count"],
            )
            self.assertGreaterEqual(summary["event_loop_lag_p99_ms"], 0)
            self.assertLessEqual(summary["event_loop_lag_p99_ms"], 50)
            self.assertEqual(50, summary["event_loop_lag_p99_gate_ms"])
            self.assertTrue(summary["event_loop_lag_gate_passed"])
            self.assertEqual(10, summary["heartbeat_client_count"])
            self.assertEqual(10, summary["heartbeat_sample_count"])
            self.assertEqual(0, summary["heartbeat_failure_count"])
            self.assertEqual(
                summary["final_revision"],
                summary["heartbeat_revision_before"],
            )
            self.assertEqual(
                summary["final_revision"],
                summary["heartbeat_revision_after"],
            )
            self.assertTrue(summary["heartbeat_revision_unchanged"])
            self.assertEqual("process", summary["heartbeat_execution_unit_type"])
            self.assertEqual(10, summary["heartbeat_execution_unit_count"])
            self.assertLessEqual(summary["heartbeat_p99_ms"], 10)
            self.assertEqual(
                "server_received_to_send_worker_started",
                summary["heartbeat_p99_gate_scope"],
            )
            self.assertEqual(10, summary["heartbeat_p99_gate_ms"])
            self.assertTrue(summary["heartbeat_p99_passed"])
            self.assertGreaterEqual(
                summary["heartbeat_end_to_end_p99_ms"],
                summary["heartbeat_p99_ms"],
            )
            self.assertGreaterEqual(
                summary["heartbeat_end_to_end_max_ms"],
                summary["heartbeat_end_to_end_p99_ms"],
            )
            self.assertGreaterEqual(summary["heartbeat_concurrent_median_ms"], 0)
            self.assertGreaterEqual(
                summary["heartbeat_concurrent_max_ms"],
                summary["heartbeat_concurrent_median_ms"],
            )
            self.assertEqual(10, summary["heartbeat_staggered_client_count"])
            self.assertEqual(10, summary["heartbeat_staggered_sample_count"])
            self.assertEqual(0, summary["heartbeat_staggered_failure_count"])
            self.assertEqual(
                summary["final_revision"],
                summary["heartbeat_staggered_revision_before"],
            )
            self.assertEqual(
                summary["final_revision"],
                summary["heartbeat_staggered_revision_after"],
            )
            self.assertTrue(summary["heartbeat_staggered_revision_unchanged"])
            self.assertGreaterEqual(summary["heartbeat_staggered_median_ms"], 0)
            self.assertGreaterEqual(
                summary["heartbeat_staggered_max_ms"],
                summary["heartbeat_staggered_median_ms"],
            )
            self.assertEqual(1, summary["heartbeat_single_connection_client_count"])
            self.assertEqual(10, summary["heartbeat_single_connection_sample_count"])
            self.assertEqual(0, summary["heartbeat_single_connection_failure_count"])
            self.assertEqual(
                summary["final_revision"],
                summary["heartbeat_single_connection_revision_before"],
            )
            self.assertEqual(
                summary["final_revision"],
                summary["heartbeat_single_connection_revision_after"],
            )
            self.assertTrue(summary["heartbeat_single_connection_revision_unchanged"])
            self.assertGreaterEqual(
                summary["heartbeat_single_connection_median_ms"], 0
            )
            self.assertGreaterEqual(
                summary["heartbeat_single_connection_max_ms"],
                summary["heartbeat_single_connection_median_ms"],
            )
            with report_directory.joinpath("metrics.csv").open(
                newline="", encoding="utf-8"
            ) as metrics_file:
                metrics = list(csv.DictReader(metrics_file))
            self.assertEqual(
                [
                    "timestamp",
                    "client",
                    "operation",
                    "status",
                    "ack_latency_ms",
                    "client_to_server_ms",
                    "server_handler_ms",
                    "server_send_queue_ms",
                    "server_after_send_worker_ms",
                    "server_to_client_ms",
                    "execution_unit",
                    "revision",
                ],
                list(metrics[0]),
            )
            mutation_metrics = [
                metric
                for metric in metrics
                if metric["operation"] == "node_create"
            ]
            self.assertEqual(10, len(mutation_metrics))
            self.assertEqual(
                10,
                len({metric["client"] for metric in mutation_metrics}),
            )
            self.assertEqual(
                [str(revision) for revision in range(1, 11)],
                [metric["revision"] for metric in mutation_metrics],
            )
            self.assertTrue(
                all(metric["status"] == "acknowledged" for metric in mutation_metrics)
            )
            self.assertTrue(
                all(float(metric["ack_latency_ms"]) >= 0 for metric in mutation_metrics)
            )
            steady_mutation_metrics = [
                metric
                for metric in metrics
                if metric["operation"] == "steady_node_move"
            ]
            self.assertEqual(20, len(steady_mutation_metrics))
            self.assertEqual(
                10,
                len({metric["client"] for metric in steady_mutation_metrics}),
            )
            self.assertEqual(
                [2] * 10,
                sorted(
                    sum(
                        metric["client"] == client_id
                        for metric in steady_mutation_metrics
                    )
                    for client_id in {
                        metric["client"] for metric in steady_mutation_metrics
                    }
                ),
            )
            self.assertEqual(
                [str(revision) for revision in range(11, 31)],
                [metric["revision"] for metric in steady_mutation_metrics],
            )
            self.assertTrue(
                all(
                    metric["status"] == "acknowledged"
                    for metric in steady_mutation_metrics
                )
            )
            self.assertTrue(
                all(
                    float(metric["ack_latency_ms"]) >= 0
                    for metric in steady_mutation_metrics
                )
            )
            burst_mutation_metrics = [
                metric
                for metric in metrics
                if metric["operation"] == "burst_node_move"
            ]
            self.assertEqual(40, len(burst_mutation_metrics))
            self.assertEqual(
                10,
                len({metric["client"] for metric in burst_mutation_metrics}),
            )
            self.assertEqual(
                [4] * 10,
                sorted(
                    sum(
                        metric["client"] == client_id
                        for metric in burst_mutation_metrics
                    )
                    for client_id in {
                        metric["client"] for metric in burst_mutation_metrics
                    }
                ),
            )
            self.assertEqual(
                [str(revision) for revision in range(32, 72)],
                [metric["revision"] for metric in burst_mutation_metrics],
            )
            self.assertTrue(
                all(
                    metric["status"] == "acknowledged"
                    for metric in burst_mutation_metrics
                )
            )
            burst_recovery_metrics = [
                metric
                for metric in metrics
                if metric["operation"] == "burst_recovery_heartbeat"
            ]
            self.assertEqual(1, len(burst_recovery_metrics))
            self.assertEqual("pong", burst_recovery_metrics[0]["status"])
            self.assertEqual(
                str(summary["burst_recovery_revision"]),
                burst_recovery_metrics[0]["revision"],
            )
            self.assertLessEqual(
                float(burst_recovery_metrics[0]["ack_latency_ms"]),
                30_000,
            )
            slow_pressure_metrics = [
                metric
                for metric in metrics
                if metric["operation"] == "slow_client_pressure"
            ]
            self.assertEqual(8, len(slow_pressure_metrics))
            self.assertEqual(
                [
                    str(revision)
                    for revision in range(
                        summary["slow_client_revision_before"] + 1,
                        summary["slow_client_fast_probe_revision"],
                    )
                ],
                [metric["revision"] for metric in slow_pressure_metrics],
            )
            self.assertTrue(
                all(
                    metric["status"] == "acknowledged"
                    for metric in slow_pressure_metrics
                )
            )
            slow_probe_metrics = [
                metric
                for metric in metrics
                if metric["operation"] == "fast_after_slow_probe"
            ]
            self.assertEqual(1, len(slow_probe_metrics))
            self.assertEqual("acknowledged", slow_probe_metrics[0]["status"])
            self.assertEqual(
                str(summary["final_revision"]),
                slow_probe_metrics[0]["revision"],
            )
            generation_mutation_metrics = [
                metric
                for metric in metrics
                if metric["operation"] == "generation_parallel_node_move"
            ]
            generation_target_metric_indexes = [
                index
                for index, metric in enumerate(metrics)
                if metric["operation"] == "generation_target_prepare"
            ]
            burst_metric_indexes = [
                index
                for index, metric in enumerate(metrics)
                if metric["operation"] == "burst_node_move"
            ]
            self.assertEqual([], generation_mutation_metrics)
            self.assertEqual(1, len(generation_target_metric_indexes))
            self.assertLess(
                generation_target_metric_indexes[0],
                min(burst_metric_indexes),
                "Generation Run must be blocked before burst Mutations start",
            )
            runtime_status_metrics = [
                metric
                for metric in metrics
                if metric["operation"].startswith("runtime_status_")
            ]
            self.assertEqual(10, len(runtime_status_metrics))
            self.assertEqual(
                {
                    "runtime_status_steady": 5,
                    "runtime_status_burst": 5,
                },
                {
                    operation: sum(
                        metric["operation"] == operation
                        for metric in runtime_status_metrics
                    )
                    for operation in {
                        metric["operation"] for metric in runtime_status_metrics
                    }
                },
            )
            self.assertTrue(
                all(metric["status"] == "ready" for metric in runtime_status_metrics)
            )
            self.assertTrue(
                all(
                    float(metric["ack_latency_ms"]) >= 0
                    for metric in runtime_status_metrics
                )
            )
            event_loop_lag_metrics = [
                metric
                for metric in metrics
                if metric["operation"].startswith("event_loop_lag_")
            ]
            self.assertEqual(
                summary["event_loop_lag_sample_count"],
                len(event_loop_lag_metrics),
            )
            self.assertEqual(
                {
                    f"event_loop_lag_{phase}": sample_count
                    for phase, sample_count in summary[
                        "event_loop_lag_samples_by_phase"
                    ].items()
                },
                {
                    operation: sum(
                        metric["operation"] == operation
                        for metric in event_loop_lag_metrics
                    )
                    for operation in {
                        metric["operation"] for metric in event_loop_lag_metrics
                    }
                },
            )
            self.assertTrue(
                all(
                    metric["status"] == "observed"
                    for metric in event_loop_lag_metrics
                )
            )
            self.assertTrue(
                all(
                    float(metric["ack_latency_ms"]) >= 0
                    for metric in event_loop_lag_metrics
                )
            )
            heartbeat_metrics = [
                metric for metric in metrics if metric["operation"] == "heartbeat"
            ]
            self.assertEqual(10, len(heartbeat_metrics))
            self.assertEqual(
                10,
                len({metric["client"] for metric in heartbeat_metrics}),
            )
            self.assertEqual(
                10,
                len({metric["execution_unit"] for metric in heartbeat_metrics}),
            )
            self.assertTrue(
                all(
                    metric["execution_unit"].startswith("process:")
                    for metric in heartbeat_metrics
                )
            )
            self.assertEqual(
                [str(summary["final_revision"])] * 10,
                [metric["revision"] for metric in heartbeat_metrics],
            )
            self.assertTrue(
                all(metric["status"] == "pong" for metric in heartbeat_metrics)
            )
            self.assertTrue(
                all(float(metric["ack_latency_ms"]) >= 0 for metric in heartbeat_metrics)
            )
            for timing_field in (
                "client_to_server_ms",
                "server_handler_ms",
                "server_send_queue_ms",
                "server_after_send_worker_ms",
                "server_to_client_ms",
            ):
                self.assertTrue(
                    all(float(metric[timing_field]) >= 0 for metric in heartbeat_metrics)
                )
            staggered_heartbeat_metrics = [
                metric
                for metric in metrics
                if metric["operation"] == "heartbeat_staggered"
            ]
            self.assertEqual(10, len(staggered_heartbeat_metrics))
            self.assertEqual(
                10,
                len({metric["client"] for metric in staggered_heartbeat_metrics}),
            )
            self.assertEqual(
                [str(summary["final_revision"])] * 10,
                [metric["revision"] for metric in staggered_heartbeat_metrics],
            )
            self.assertTrue(
                all(
                    metric["status"] == "pong"
                    for metric in staggered_heartbeat_metrics
                )
            )
            self.assertTrue(
                all(
                    float(metric["ack_latency_ms"]) >= 0
                    for metric in staggered_heartbeat_metrics
                )
            )
            single_heartbeat_metrics = [
                metric
                for metric in metrics
                if metric["operation"] == "heartbeat_single_connection"
            ]
            self.assertEqual(10, len(single_heartbeat_metrics))
            self.assertEqual(
                {"client-01"},
                {metric["client"] for metric in single_heartbeat_metrics},
            )
            self.assertEqual(
                [str(summary["final_revision"])] * 10,
                [metric["revision"] for metric in single_heartbeat_metrics],
            )
            self.assertTrue(
                all(metric["status"] == "pong" for metric in single_heartbeat_metrics)
            )
            self.assertTrue(
                all(
                    float(metric["ack_latency_ms"]) >= 0
                    for metric in single_heartbeat_metrics
                )
            )
            self.assertTrue(cleanup["canvas_purged"])
            self.assertTrue(cleanup["generation_media_purged"])
            self.assertEqual(1, cleanup["generation_media_removed_count"])
            self.assertTrue(cleanup["sessions_removed"])
            self.assertTrue(cleanup["accounts_removed"])
            self.assertFalse(report_directory.joinpath("instance-state").exists())
            canvas_directory = workspace / "data" / "canvases"
            self.assertEqual(
                [],
                list(canvas_directory.glob("*.json"))
                if canvas_directory.exists()
                else [],
            )
            report_text = "\n".join(
                path.read_text(encoding="utf-8", errors="replace")
                for path in report_directory.rglob("*")
                if path.is_file()
            )
            self.assertNotIn("baseline-admin-password", report_text)
            self.assertNotIn("baseline-designer-password", report_text)
            self.assertNotIn("baseline-generation-private-prompt", report_text)


if __name__ == "__main__":
    unittest.main()
