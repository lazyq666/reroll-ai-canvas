#!/usr/bin/env python3
"""Run isolated Reroll multiplayer performance scenarios."""

from __future__ import annotations

import argparse
import asyncio
import csv
import hashlib
import http.cookiejar
import http.server
import json
import math
import multiprocessing
import os
import queue
import re
import shutil
import signal
import socket
import statistics
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import websockets

LAYOUT_GAP = json.loads((Path(__file__).resolve().parents[2] / "static/js/smart-canvas/layout-constants.json").read_text())["nodeGap"]


PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = PROJECT_ROOT / "backend"
BROWSER_SETTINGS_TRACER = (
    PROJECT_ROOT / "scripts" / "performance" / "trace_browser_settings.cjs"
)
REPRESENTATIVE_CANVAS_TARGET_BYTES = 5 * 1024 * 1024
REPRESENTATIVE_CANVAS_NODE_COUNT = 80
REPRESENTATIVE_NODE_PAYLOAD_BYTES = 65_000
PERFORMANCE_WEBSOCKET_MAX_SIZE = 16 * 1024 * 1024
BROWSER_LONG_TASK_GATE_MS = 400
SMOKE_SUITE_PLAN = {
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
}
STANDARD_DRY_RUN_SUITE_PLAN = {
    "phases": [
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
    "generation_run_overlap_phase": "burst",
    "generation_run_max_concurrency": 1,
    "generation_run_separate_phase": False,
    "recovery_gate_seconds": 30,
    "backend_client_count": 10,
    "browser_tracer_client_count": 1,
    "lightweight_client_count": 9,
}
STANDARD_EXTENDED_DRY_RUN_SUITE_PLAN = {
    "phases": [
        {
            "name": "warmup",
            "duration_seconds": 2,
            "generation_runs_active": False,
        },
        {
            "name": "steady",
            "duration_seconds": 5,
            "target_mutations_per_second": 20,
            "generation_runs_active": False,
        },
        {
            "name": "burst",
            "duration_seconds": 3,
            "target_mutations_per_second": 40,
            "generation_runs_active": True,
        },
        {
            "name": "recovery",
            "duration_seconds": 5,
            "generation_runs_active": False,
        },
        {
            "name": "full_browser",
            "browser_client_count": 10,
            "lightweight_client_count": 0,
            "generation_runs_active": False,
        },
    ],
    "generation_run_overlap_phase": "burst",
    "generation_run_max_concurrency": 1,
    "generation_run_separate_phase": False,
    "recovery_gate_seconds": 30,
    "backend_client_count": 10,
    "browser_tracer_client_count": 1,
    "lightweight_client_count": 9,
}
STANDARD_ENDURANCE_DRY_RUN_SUITE_PLAN = {
    "phases": [
        {
            "name": "warmup",
            "duration_seconds": 5,
            "generation_runs_active": False,
        },
        {
            "name": "steady",
            "duration_seconds": 30,
            "target_mutations_per_second": 20,
            "generation_runs_active": False,
        },
        {
            "name": "burst",
            "duration_seconds": 10,
            "target_mutations_per_second": 40,
            "generation_runs_active": True,
        },
        {
            "name": "recovery",
            "duration_seconds": 30,
            "generation_runs_active": False,
        },
        {
            "name": "full_browser",
            "browser_client_count": 10,
            "lightweight_client_count": 0,
            "generation_runs_active": False,
        },
    ],
    "generation_run_overlap_phase": "burst",
    "generation_run_max_concurrency": 1,
    "generation_run_separate_phase": False,
    "recovery_gate_seconds": 30,
    "backend_client_count": 10,
    "browser_tracer_client_count": 1,
    "lightweight_client_count": 9,
}
STANDARD_OVERLAP_DRY_RUN_SUITE_PLAN = {
    "phases": [
        {
            "name": "warmup",
            "duration_seconds": 1,
            "generation_runs_active": False,
        },
        {
            "name": "steady",
            "duration_seconds": 2,
            "target_mutations_per_second": 20,
            "generation_runs_active": True,
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
    "generation_run_overlap_phases": ["steady", "burst"],
    "generation_run_max_concurrency": 1,
    "generation_run_separate_phase": False,
    "recovery_gate_seconds": 30,
    "backend_client_count": 10,
    "browser_tracer_client_count": 1,
    "lightweight_client_count": 9,
}
STANDARD_CONCURRENCY_DRY_RUN_SUITE_PLAN = {
    **STANDARD_OVERLAP_DRY_RUN_SUITE_PLAN,
    "phases": [
        dict(phase)
        for phase in STANDARD_OVERLAP_DRY_RUN_SUITE_PLAN["phases"]
    ],
    "generation_run_max_concurrency": 6,
}
STANDARD_SUSTAINED_BURST_DRY_RUN_SUITE_PLAN = {
    "phases": [
        {
            "name": "warmup",
            "duration_seconds": 1,
            "generation_runs_active": False,
        },
        {
            "name": "steady",
            "duration_seconds": 5,
            "target_mutations_per_second": 20,
            "generation_runs_active": True,
        },
        {
            "name": "burst",
            "duration_seconds": 30,
            "target_mutations_per_second": 40,
            "generation_runs_active": True,
        },
        {
            "name": "recovery",
            "duration_seconds": 5,
            "generation_runs_active": False,
        },
        {
            "name": "full_browser",
            "browser_client_count": 10,
            "lightweight_client_count": 0,
            "generation_runs_active": False,
        },
    ],
    "generation_run_overlap_phases": ["steady", "burst"],
    "generation_run_max_concurrency": 6,
    "generation_run_separate_phase": False,
    "recovery_gate_seconds": 30,
    "backend_client_count": 10,
    "browser_tracer_client_count": 1,
    "lightweight_client_count": 9,
}
STANDARD_SUITE_PLAN = {
    "target_duration_seconds": 2_700,
    "warmup_seconds": 120,
    "steady_load_seconds": 1_200,
    "steady_mutations_per_second": 20,
    "burst_load_seconds": 300,
    "burst_mutations_per_second": 40,
    "recovery_observation_seconds": 30,
    "backend_client_count": 10,
    "full_browser_client_count": 10,
    "generation_run_overlap_phases": ["steady", "burst"],
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
}
SOAK_SUITE_PLAN = {
    "target_duration_seconds": 7_200,
    "backend_client_count": 10,
    "full_browser_client_count": 10,
    "growth_checks": [
        "memory",
        "connections",
        "queues",
        "sqlite_wal",
    ],
}
METRIC_FIELDS = [
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
]


_BASELINE_PNG_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nG"
    "NUTX7NwMDAxAAGABDIAXcW2IAJAAAAAElFTkSuQmCC"
)


class _DeterministicImageProvider:
    def __init__(self, *, response_wait_timeout_seconds: int = 600) -> None:
        self.request_started = threading.Event()
        self.release_response = threading.Event()
        self.request_count = 0
        self.in_flight_count = 0
        self.peak_in_flight_count = 0
        self.response_wait_timeout_seconds = max(
            10,
            int(response_wait_timeout_seconds),
        )
        self._lock = threading.Lock()
        self._request_condition = threading.Condition(self._lock)
        provider = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                if length:
                    self.rfile.read(length)
                if self.path != "/v1/images/generations":
                    self.send_error(404)
                    return
                with provider._request_condition:
                    provider.request_count += 1
                    provider.in_flight_count += 1
                    provider.peak_in_flight_count = max(
                        provider.peak_in_flight_count,
                        provider.in_flight_count,
                    )
                    provider._request_condition.notify_all()
                provider.request_started.set()
                try:
                    if not provider.release_response.wait(
                        timeout=provider.response_wait_timeout_seconds
                    ):
                        self.send_error(504)
                        return
                    body = json.dumps(
                        {"data": [{"b64_json": _BASELINE_PNG_BASE64}]}
                    ).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                finally:
                    with provider._lock:
                        provider.in_flight_count = max(
                            0,
                            provider.in_flight_count - 1,
                        )

            def log_message(self, _format: str, *_args: object) -> None:
                return

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(
            target=self.server.serve_forever,
            name="baseline-image-provider",
            daemon=True,
        )
        self.started = False

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}"

    def start(self) -> None:
        if self.started:
            return
        self.thread.start()
        self.started = True

    def wait_until_requested(
        self,
        timeout: float,
        minimum_count: int = 1,
    ) -> bool:
        with self._request_condition:
            return self._request_condition.wait_for(
                lambda: self.request_count >= max(1, int(minimum_count)),
                timeout=timeout,
            )

    def release(self) -> None:
        self.release_response.set()

    def stop(self) -> None:
        self.release_response.set()
        if self.started:
            self.server.shutdown()
        self.server.server_close()
        if self.started:
            self.thread.join(timeout=5)


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=("baseline", "real-cli"), required=True)
    parser.add_argument("--suite", choices=("smoke", "standard", "soak"), required=True)
    parser.add_argument("--port", type=int, default=3001)
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--attach-existing-service", action="store_true")
    parser.add_argument("--standard-dry-run", action="store_true")
    parser.add_argument("--confirm-formal-standard", action="store_true")
    parser.add_argument("--realtime-encoding-preflight", action="store_true")
    parser.add_argument(
        "--confirm-real-generation-quota-probe",
        action="store_true",
    )
    parser.add_argument(
        "--standard-dry-run-level",
        choices=(
            "short",
            "extended",
            "endurance",
            "overlap",
            "concurrency",
            "sustained-burst",
        ),
        default="short",
    )
    parser.add_argument("--report-root", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=7425068)
    arguments = parser.parse_args()
    if not arguments.attach_existing_service and arguments.workspace is None:
        parser.error("--workspace is required unless --attach-existing-service is used")
    if arguments.standard_dry_run and arguments.suite != "standard":
        parser.error("--standard-dry-run requires --suite standard")
    if arguments.standard_dry_run and arguments.profile != "baseline":
        parser.error("--standard-dry-run requires --profile baseline")
    if arguments.standard_dry_run and arguments.attach_existing_service:
        parser.error("--standard-dry-run cannot use --attach-existing-service")
    if arguments.confirm_formal_standard and arguments.suite != "standard":
        parser.error("--confirm-formal-standard requires --suite standard")
    if arguments.confirm_formal_standard and arguments.profile != "baseline":
        parser.error("--confirm-formal-standard requires --profile baseline")
    if arguments.confirm_formal_standard and arguments.attach_existing_service:
        parser.error(
            "--confirm-formal-standard cannot use --attach-existing-service"
        )
    if arguments.confirm_formal_standard and arguments.standard_dry_run:
        parser.error(
            "--confirm-formal-standard cannot use --standard-dry-run"
        )
    if arguments.realtime_encoding_preflight and (
        arguments.profile != "baseline"
        or arguments.suite != "standard"
        or arguments.attach_existing_service
        or arguments.standard_dry_run
        or arguments.confirm_formal_standard
    ):
        parser.error(
            "--realtime-encoding-preflight requires isolated baseline standard"
        )
    if arguments.confirm_real_generation_quota_probe and (
        arguments.profile != "real-cli"
        or arguments.suite != "smoke"
        or arguments.attach_existing_service
        or arguments.standard_dry_run
        or arguments.confirm_formal_standard
        or arguments.realtime_encoding_preflight
    ):
        parser.error(
            "--confirm-real-generation-quota-probe requires isolated real-cli smoke"
        )
    if (
        arguments.standard_dry_run_level != "short"
        and not arguments.standard_dry_run
    ):
        parser.error(
            "--standard-dry-run-level requires --standard-dry-run"
        )
    return arguments


def _real_cli_executable(
    environment_keys: tuple[str, ...],
    command_names: tuple[str, ...],
) -> str:
    for key in environment_keys:
        configured = str(os.environ.get(key) or "").strip().strip('"')
        if not configured:
            continue
        resolved = shutil.which(configured)
        if resolved:
            return resolved
        candidate = Path(configured).expanduser()
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
        return ""
    for name in command_names:
        resolved = shutil.which(name)
        if resolved:
            return resolved
    return ""


def _real_cli_version_preflight(executable: str) -> dict[str, object]:
    try:
        completed = subprocess.run(
            [executable, "--version"],
            cwd=PROJECT_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {
            "status": "unavailable",
            "version": "",
            "version_checked": True,
            "authentication_checked": False,
            "quota_checked": False,
        }
    version_source = completed.stdout or completed.stderr
    version = "".join(
        character for character in version_source.splitlines()[0][:120]
        if character.isprintable()
    ).strip() if version_source.splitlines() else ""
    if completed.returncode != 0:
        return {
            "status": "unavailable",
            "version": "",
            "version_checked": True,
            "authentication_checked": False,
            "quota_checked": False,
        }
    return {
        "status": "available",
        "version": version,
        "version_checked": True,
        "authentication_checked": False,
        "quota_checked": False,
    }


def _real_cli_codex_authentication_preflight(
    executable: str,
    status: dict[str, object],
) -> dict[str, object]:
    try:
        completed = subprocess.run(
            [executable, "login", "status"],
            cwd=PROJECT_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {
            **status,
            "status": "unavailable",
            "authentication_checked": False,
        }
    authenticated = completed.returncode == 0
    return {
        **status,
        "status": "available" if authenticated else "unauthenticated",
        "authentication_checked": True,
        "authenticated": authenticated,
    }


def _real_cli_gemini_authentication_preflight(
    executable: str,
    status: dict[str, object],
) -> dict[str, object]:
    try:
        help_result = subprocess.run(
            [executable, "models", "--help"],
            cwd=PROJECT_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {
            **status,
            "authentication_checked": False,
            "authentication_probe_supported": False,
        }
    if help_result.returncode != 0:
        return {
            **status,
            "authentication_checked": False,
            "authentication_probe_supported": False,
        }
    try:
        completed = subprocess.run(
            [executable, "models"],
            cwd=PROJECT_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {
            **status,
            "status": "unavailable",
            "authentication_checked": False,
            "authentication_probe_supported": True,
        }
    authenticated = completed.returncode == 0 and any(
        line.strip() and not line.startswith("Fetching available models")
        for line in completed.stdout.splitlines()
    )
    return {
        **status,
        "status": "available" if authenticated else "unauthenticated",
        "authentication_checked": True,
        "authentication_probe_supported": True,
        "authenticated": authenticated,
    }


def _real_cli_installation_preflight() -> tuple[dict[str, object], list[str]]:
    codex_executable = _real_cli_executable(
        ("CODEX_BIN",),
        ("codex", "codex.exe", "codex.cmd"),
    )
    gemini_executable = _real_cli_executable(
        ("ANTIGRAVITY_BIN", "AGY_BIN", "GEMINI_BIN"),
        ("agy", "agy.exe", "gemini", "gemini.exe", "gemini.cmd"),
    )
    statuses = {
        "codex": (
            _real_cli_version_preflight(codex_executable)
            if codex_executable
            else {"status": "missing", "version_checked": False}
        ),
        "gemini": (
            _real_cli_version_preflight(gemini_executable)
            if gemini_executable
            else {"status": "missing", "version_checked": False}
        ),
    }
    reasons: list[str] = []
    if not codex_executable:
        reasons.append("real_cli_codex_not_found")
    if not gemini_executable:
        reasons.append("real_cli_gemini_not_found")
    if codex_executable and statuses["codex"]["status"] != "available":
        reasons.append("real_cli_codex_version_check_failed")
    if gemini_executable and statuses["gemini"]["status"] != "available":
        reasons.append("real_cli_gemini_version_check_failed")
    if not reasons:
        statuses["codex"] = _real_cli_codex_authentication_preflight(
            codex_executable,
            statuses["codex"],
        )
        if statuses["codex"]["status"] == "unavailable":
            reasons.append("real_cli_codex_authentication_check_failed")
            statuses["gemini"]["authentication_probe_supported"] = False
            reasons.append("real_cli_gemini_authentication_check_unsupported")
        elif not statuses["codex"]["authenticated"]:
            reasons.append("real_cli_codex_not_authenticated")
            statuses["gemini"]["authentication_probe_supported"] = False
            reasons.append("real_cli_gemini_authentication_check_unsupported")
        else:
            statuses["gemini"] = _real_cli_gemini_authentication_preflight(
                gemini_executable,
                statuses["gemini"],
            )
            if not statuses["gemini"]["authentication_probe_supported"]:
                reasons.append(
                    "real_cli_gemini_authentication_check_unsupported"
                )
            elif statuses["gemini"]["status"] == "unavailable":
                reasons.append(
                    "real_cli_gemini_authentication_check_failed"
                )
            elif not statuses["gemini"]["authenticated"]:
                reasons.append("real_cli_gemini_not_authenticated")
            else:
                reasons.append("real_cli_quota_check_requires_generation")
    return statuses, reasons


def _real_environment_admission(reasons: list[str]) -> dict[str, object]:
    read_only_preflight_complete = reasons == [
        "real_cli_quota_check_requires_generation"
    ]
    return {
        "status": "blocked",
        "safe_to_start": False,
        "read_only_preflight_complete": read_only_preflight_complete,
        "generation_probe_executed": False,
        "workspace_write_executed": False,
        "quota_status": (
            "unknown_requires_real_generation"
            if read_only_preflight_complete
            else "not_checked_due_read_only_preflight_blockers"
        ),
        "next_required_authority": (
            "explicit_real_generation_quota_probe"
            if read_only_preflight_complete
            else "resolve_read_only_preflight_blockers"
        ),
    }


def _real_cli_codex_quota_probe(
    report_directory: Path,
) -> tuple[dict[str, object], dict[str, object], dict[str, object]]:
    executable = _real_cli_executable(
        ("GPT_IMAGE_2_SKILL_BIN",),
        ("gpt-image-2-skill", "gpt-image-2-skill.exe", "gpt-image-2-skill.cmd"),
    )
    started = time.monotonic()
    probe_directory = Path(tempfile.mkdtemp(prefix="ic_real_quota_probe_"))
    output_path = probe_directory / "quota-probe.png"
    cleanup = {
        "schema_version": 1,
        "workspace_unchanged": True,
        "generation_probe_executed": False,
        "real_generation_call_count": 0,
        "workspace_write_executed": False,
        "registered_cleanup_paths": 1,
        "removed_registered_path_count": 0,
        "out_of_allowlist_deletion_attempt_count": 0,
    }
    status = "unavailable"
    reason = "real_cli_codex_image_helper_not_found"
    call_count = 0
    provider_exit_code: int | None = None
    try:
        if executable:
            auth_file = str(
                os.environ.get("GPT_IMAGE_2_SKILL_AUTH_FILE")
                or os.environ.get("CODEX_AUTH_FILE")
                or Path.home().joinpath(".codex", "auth.json")
            ).strip()
            command = [
                executable,
                "--json",
                "--provider",
                "codex",
            ]
            if auth_file and Path(auth_file).is_file():
                command.extend(["--auth-file", auth_file])
            command.extend(
                [
                    "images",
                    "generate",
                    "--prompt",
                    "A minimal neutral gray square on a plain white background.",
                    "--out",
                    str(output_path),
                    "--model",
                    "gpt-image-2",
                    "--format",
                    "png",
                    "--size",
                    "1024x1024",
                    "--quality",
                    "low",
                ]
            )
            call_count = 1
            cleanup["generation_probe_executed"] = True
            cleanup["real_generation_call_count"] = 1
            try:
                completed = subprocess.run(
                    command,
                    cwd=probe_directory,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=max(
                        1,
                        min(
                            600,
                            int(
                                os.environ.get(
                                    "REAL_GENERATION_QUOTA_PROBE_TIMEOUT_SECONDS",
                                    "300",
                                )
                            ),
                        ),
                    ),
                    check=False,
                )
            except (OSError, ValueError):
                completed = None
                reason = "real_cli_codex_quota_probe_execution_failed"
            except subprocess.TimeoutExpired:
                completed = None
                reason = "real_cli_codex_quota_probe_timeout"
            except KeyboardInterrupt:
                completed = None
                status = "cancelled"
                reason = "real_cli_codex_quota_probe_cancelled"
            if completed is not None:
                provider_exit_code = completed.returncode
                diagnostic = f"{completed.stdout}\n{completed.stderr}".lower()
                if completed.returncode < 0 or completed.returncode in (
                    -signal.SIGINT,
                    -signal.SIGTERM,
                    128 + signal.SIGINT,
                    128 + signal.SIGTERM,
                ):
                    status = "cancelled"
                    reason = "real_cli_codex_quota_probe_cancelled"
                elif completed.returncode == 0 and output_path.is_file() and output_path.stat().st_size > 0:
                    status = "available"
                    reason = ""
                elif "history_migration_failed" in diagnostic:
                    reason = "real_cli_codex_history_migration_failed"
                elif any(
                    marker in diagnostic
                    for marker in (
                        "resource_exhausted",
                        "quota_exhausted",
                        "insufficient quota",
                        "quota exceeded",
                        "429",
                    )
                ):
                    status = "exhausted"
                    reason = "real_cli_codex_quota_exhausted"
                else:
                    reason = "real_cli_codex_quota_probe_failed"
    finally:
        shutil.rmtree(probe_directory)
        cleanup["removed_registered_path_count"] = 1

    elapsed_ms = round((time.monotonic() - started) * 1000, 3)
    with report_directory.joinpath("metrics.csv").open(
        "w", newline="", encoding="utf-8"
    ) as metrics_file:
        writer = csv.DictWriter(
            metrics_file,
            fieldnames=("provider", "quota_status", "duration_ms", "call_count"),
        )
        writer.writeheader()
        writer.writerow(
            {
                "provider": "codex",
                "quota_status": status,
                "duration_ms": elapsed_ms,
                "call_count": call_count,
            }
        )
    result = {
        "provider": "codex",
        "quota_checked": call_count == 1,
        "quota_status": status,
        "duration_ms": elapsed_ms,
        "real_generation_call_count": call_count,
        "provider_exit_code": provider_exit_code,
    }
    if reason:
        result["reason"] = reason
    return result, cleanup, {
        "status": "blocked",
        "safe_to_start": False,
        "generation_probe_executed": call_count == 1,
        "workspace_write_executed": False,
        "codex_quota_status": status,
        "gemini_quota_status": "unknown",
        "next_required_authority": "explicit_gemini_generation_quota_probe",
    }


def _browser_dependencies() -> tuple[str, Path] | None:
    node = shutil.which("node")
    candidates = [
        Path(value)
        for value in (
            os.environ.get("IC_BROWSER_BIN", ""),
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            shutil.which("google-chrome") or "",
            shutil.which("google-chrome-stable") or "",
            shutil.which("chromium") or "",
            shutil.which("chromium-browser") or "",
        )
        if value
    ]
    browser = next(
        (candidate for candidate in candidates if candidate.is_file()),
        None,
    )
    if not node or browser is None or not BROWSER_SETTINGS_TRACER.is_file():
        return None
    return node, browser


def _run_browser_settings_trace(
    *,
    node: str,
    browser: Path,
    base_url: str,
    cookie_jar: http.cookiejar.CookieJar,
    trace_kind: str = "settings",
    canvas_id: str = "",
    expected_node_count: int = 0,
    phase_override: str = "",
    other_lightweight_client_count: int = 9,
    timeout_seconds: int = 12,
    enforce_first_operable_gate: bool = True,
) -> dict[str, object]:
    input_payload = {
        "browserExecutable": str(browser),
        "baseUrl": base_url,
        "traceKind": trace_kind,
        "canvasId": canvas_id,
        "expectedNodeCount": expected_node_count,
        "cookies": [
            {
                "name": cookie.name,
                "value": cookie.value,
                "path": cookie.path or "/",
                "secure": cookie.secure,
                "httpOnly": bool(cookie.has_nonstandard_attr("HttpOnly")),
            }
            for cookie in cookie_jar
        ],
    }
    try:
        completed = subprocess.run(
            [node, str(BROWSER_SETTINGS_TRACER)],
            cwd=PROJECT_ROOT,
            input=json.dumps(input_payload),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout_seconds,
            check=False,
        )
        payload = json.loads(completed.stdout)
        if completed.returncode != 0 or not isinstance(payload, dict):
            raise RuntimeError("browser settings tracer returned an invalid result")
    except subprocess.TimeoutExpired:
        payload = {"status": "failed", "errorType": "TimeoutExpired"}
    except (OSError, RuntimeError, json.JSONDecodeError) as exc:
        payload = {"status": "failed", "errorType": type(exc).__name__}

    is_canvas_open = trace_kind == "canvas-open"
    prefix = "browser_canvas_open" if is_canvas_open else "browser_settings"
    phase = phase_override or ("burst" if is_canvas_open else "steady")
    first_operable_gate_ms = 1_000 if is_canvas_open else 2_000
    first_operable_ms = float(payload.get("firstOperableMs") or 0)
    long_task_max_ms = float(payload.get("longTaskMaxMs") or 0)
    interaction_accepted = bool(payload.get("interactionAccepted"))
    interaction_restored = bool(payload.get("interactionRestored"))
    console_error_count = int(payload.get("consoleErrorCount") or 0)
    console_error_kind_counts = payload.get("consoleErrorKindCounts")
    if not isinstance(console_error_kind_counts, dict):
        console_error_kind_counts = {}
    console_error_kind_counts = {
        str(key): int(value)
        for key, value in console_error_kind_counts.items()
        if re.fullmatch(r"[a-z_]+", str(key))
        and isinstance(value, int)
        and value >= 0
    }
    console_error_sources = [
        str(source)
        for source in payload.get("consoleErrorSources") or []
        if re.fullmatch(r"[A-Za-z0-9._-]+", str(source))
    ]
    page_error_count = int(payload.get("pageErrorCount") or 0)
    unhandled_rejection_count = int(payload.get("unhandledRejectionCount") or 0)
    gate_failures: list[str] = []
    if payload.get("status") != "passed":
        gate_failures.append("browser_trace_failed")
    if not interaction_accepted:
        gate_failures.append("interaction_not_accepted")
    if not interaction_restored:
        gate_failures.append("interaction_not_restored")
    if (
        enforce_first_operable_gate
        and first_operable_ms > first_operable_gate_ms
    ):
        gate_failures.append("first_operable_p95_exceeded")
    if long_task_max_ms > BROWSER_LONG_TASK_GATE_MS:
        gate_failures.append("long_task_exceeded")
    if console_error_count:
        gate_failures.append("console_error")
    if page_error_count:
        gate_failures.append("page_error")
    if unhandled_rejection_count:
        gate_failures.append("unhandled_rejection")
    return {
        f"{prefix}_phase": phase,
        f"{prefix}_tracer_client_count": 1,
        f"{prefix}_other_lightweight_client_count": (
            other_lightweight_client_count
        ),
        f"{prefix}_isolated_profile": bool(payload.get("isolatedProfile")),
        f"{prefix}_first_operable_sample_count": (
            1 if payload.get("status") == "passed" else 0
        ),
        f"{prefix}_first_operable_origin": (
            "canvas_card_activation" if is_canvas_open else "app_navigation"
        ),
        f"{prefix}_first_operable_p95_ms": first_operable_ms,
        f"{prefix}_app_ready_ms": float(payload.get("appReadyMs") or 0),
        f"{prefix}_card_ready_ms": float(
            payload.get("canvasCardReadyMs") or 0
        ),
        f"{prefix}_open_to_ready_ms": float(
            payload.get("canvasOpenToReadyMs") or 0
        ),
        f"{prefix}_open_to_feedback_ms": float(
            payload.get("canvasOpenToFeedbackMs") or 0
        ),
        f"{prefix}_app_navigation_to_feedback_ms": float(
            payload.get("appNavigationToFeedbackMs") or 0
        ),
        f"{prefix}_first_operable_gate_ms": first_operable_gate_ms,
        f"{prefix}_first_operable_gate_enforced": (
            enforce_first_operable_gate
        ),
        f"{prefix}_unresponsive_timeout_ms": 10_000,
        f"{prefix}_trace_error_type": str(
            payload.get("errorType") or ""
        ),
        f"{prefix}_trace_error_message": str(
            payload.get("errorMessage") or ""
        ),
        f"{prefix}_interaction_accepted": interaction_accepted,
        f"{prefix}_interaction_restored": interaction_restored,
        f"{prefix}_long_task_count": int(
            payload.get("longTaskCount") or 0
        ),
        f"{prefix}_long_task_max_ms": long_task_max_ms,
        f"{prefix}_top_frame_observed_long_task_count": int(
            payload.get("topFrameObservedLongTaskCount") or 0
        ),
        f"{prefix}_top_frame_observed_long_task_max_ms": float(
            payload.get("topFrameObservedLongTaskMaxMs") or 0
        ),
        f"{prefix}_target_frame_long_task_count": int(
            payload.get("targetFrameLongTaskCount") or 0
        ),
        f"{prefix}_target_frame_long_task_max_ms": float(
            payload.get("targetFrameLongTaskMaxMs") or 0
        ),
        f"{prefix}_long_task_gate_ms": BROWSER_LONG_TASK_GATE_MS,
        f"{prefix}_console_error_count": console_error_count,
        f"{prefix}_console_error_kind_counts": console_error_kind_counts,
        f"{prefix}_console_error_sources": console_error_sources,
        f"{prefix}_page_error_count": page_error_count,
        f"{prefix}_unhandled_rejection_count": unhandled_rejection_count,
        f"{prefix}_gate_failures": gate_failures,
        f"{prefix}_gate_passed": not gate_failures,
    }


def _target_port_in_use(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.2):
            return True
    except OSError:
        return False


def _pid_rss_bytes(pid: int) -> int:
    if int(pid) <= 0:
        raise RuntimeError("server RSS sampling was unavailable")
    if sys.platform == "darwin":
        try:
            import ctypes

            class ProcTaskInfo(ctypes.Structure):
                _fields_ = [
                    ("virtual_size", ctypes.c_uint64),
                    ("resident_size", ctypes.c_uint64),
                    ("total_user", ctypes.c_uint64),
                    ("total_system", ctypes.c_uint64),
                    ("threads_user", ctypes.c_uint64),
                    ("threads_system", ctypes.c_uint64),
                    ("policy", ctypes.c_int32),
                    ("faults", ctypes.c_int32),
                    ("pageins", ctypes.c_int32),
                    ("cow_faults", ctypes.c_int32),
                    ("messages_sent", ctypes.c_int32),
                    ("messages_received", ctypes.c_int32),
                    ("syscalls_mach", ctypes.c_int32),
                    ("syscalls_unix", ctypes.c_int32),
                    ("csw", ctypes.c_int32),
                    ("threadnum", ctypes.c_int32),
                    ("numrunning", ctypes.c_int32),
                    ("priority", ctypes.c_int32),
                ]

            task_info = ProcTaskInfo()
            libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
            copied = libproc.proc_pidinfo(
                int(pid),
                4,  # PROC_PIDTASKINFO
                0,
                ctypes.byref(task_info),
                ctypes.sizeof(task_info),
            )
            if (
                copied == ctypes.sizeof(task_info)
                and int(task_info.resident_size) > 0
            ):
                return int(task_info.resident_size)
        except (OSError, TypeError, ValueError):
            pass
    try:
        completed = subprocess.run(
            ["/bin/ps", "-o", "rss=", "-p", str(pid)],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=5,
            check=False,
        )
        rss_kib = int(completed.stdout.strip())
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError("server RSS sampling was unavailable") from exc
    if completed.returncode != 0 or rss_kib <= 0:
        raise RuntimeError("server RSS sampling was unavailable")
    return rss_kib * 1024


def _process_rss_bytes(process: subprocess.Popen[bytes]) -> int:
    if process.poll() is not None:
        raise RuntimeError("server process stopped before resource sampling")
    return _pid_rss_bytes(process.pid)


def _workspace_process_rss_bytes(
    workspace: Path,
    launcher_process: subprocess.Popen[bytes],
) -> int:
    """Sample the active Workspace writer, which may outlive its launcher PID."""

    metadata_path = (
        Path(workspace)
        / ".infinite-canvas-service"
        / "occupation.json"
    )
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        service_pid = int(metadata.get("pid") or 0)
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        service_pid = 0
    if service_pid > 0:
        try:
            return _pid_rss_bytes(service_pid)
        except RuntimeError:
            pass
    return _process_rss_bytes(launcher_process)


def _report_directory(report_root: Path) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    directory = report_root / f"{timestamp}-{uuid.uuid4().hex[:8]}"
    directory.mkdir(parents=True, exist_ok=False)
    return directory.resolve()


def _write_summary(directory: Path, summary: dict[str, object]) -> None:
    directory.joinpath("summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _write_manifest(
    directory: Path,
    arguments: argparse.Namespace,
    *,
    executed: bool,
) -> None:
    commit = "unavailable"
    dirty = True
    try:
        commit_result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=PROJECT_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
        )
        status_result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=PROJECT_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
        )
        if commit_result.returncode == 0 and commit_result.stdout.strip():
            commit = commit_result.stdout.strip()
        if status_result.returncode == 0:
            dirty = bool(status_result.stdout.strip())
    except (OSError, subprocess.TimeoutExpired):
        pass
    manifest = {
        "schema_version": 1,
        "profile": arguments.profile,
        "suite": arguments.suite,
        "seed": arguments.seed,
        "executed": executed,
        "git_commit": commit,
        "git_dirty": dirty,
    }
    directory.joinpath("manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


class _MetricsWriter:
    def __init__(self, directory: Path) -> None:
        self._file = directory.joinpath("metrics.csv").open(
            "w", newline="", encoding="utf-8"
        )
        self._writer = csv.DictWriter(
            self._file,
            fieldnames=METRIC_FIELDS,
        )
        self._writer.writeheader()
        self._file.flush()

    def append(self, row: dict[str, object]) -> None:
        self._writer.writerow(row)
        self._file.flush()

    def close(self) -> None:
        self._file.close()

    def __enter__(self) -> _MetricsWriter:
        return self

    def __exit__(self, *_exc_info: object) -> None:
        self.close()


def _json_request(
    opener: urllib.request.OpenerDirector,
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    payload: object | None = None,
    timeout: float = 5,
) -> dict[str, object]:
    data = (
        json.dumps(payload, ensure_ascii=False).encode("utf-8")
        if payload is not None
        else None
    )
    request = urllib.request.Request(
        f"{base_url}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with opener.open(request, timeout=timeout) as response:
            value = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} failed: {exc.code} {detail}") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"{method} {path} returned a non-object response")
    return value


def _json_list_request(
    opener: urllib.request.OpenerDirector,
    base_url: str,
    path: str,
) -> list[object]:
    request = urllib.request.Request(
        f"{base_url}{path}",
        method="GET",
        headers={"Accept": "application/json"},
    )
    try:
        with opener.open(request, timeout=5) as response:
            value = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"GET {path} failed: {exc.code} {detail}"
        ) from exc
    if not isinstance(value, list):
        raise RuntimeError(f"GET {path} returned a non-list response")
    return value


def _wait_for_service(base_url: str, process: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + 15
    opener = urllib.request.build_opener()
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("performance service exited before becoming ready")
        try:
            _json_request(opener, base_url, "/api/setup/status")
            return
        except (OSError, RuntimeError):
            time.sleep(0.1)
    raise RuntimeError("performance service did not become ready")


def _wait_for_runtime_ready(
    base_url: str,
    process: subprocess.Popen[bytes],
) -> None:
    deadline = time.monotonic() + 15
    opener = urllib.request.build_opener()
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(
                "performance service exited before runtime became ready"
            )
        try:
            status = _json_request(
                opener,
                base_url,
                "/api/runtime/status",
            )
        except (OSError, RuntimeError):
            time.sleep(0.1)
            continue
        stage = str(status.get("stage") or "")
        if stage == "ready":
            return
        if stage in {"failed", "recovery_required"}:
            raise RuntimeError(
                "performance service runtime did not become ready"
            )
        time.sleep(0.1)
    raise RuntimeError("performance service runtime did not become ready")


def _stop_service(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def _cookie_header(cookie_jar: http.cookiejar.CookieJar) -> str:
    return "; ".join(f"{cookie.name}={cookie.value}" for cookie in cookie_jar)


async def _receive_websocket_object(connection: object) -> dict[str, object]:
    while True:
        raw = await asyncio.wait_for(connection.recv(), timeout=5)
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise RuntimeError("Canvas WebSocket returned a non-object message")
        # Presence shares the transport but not the reliable Canvas protocol.
        # Existing mutation/heartbeat gates intentionally ignore this optional
        # capability stream and keep measuring the document message requested.
        if str(value.get("type") or "").startswith("presence_"):
            continue
        return value


async def _run_isolated_heartbeat(
    *,
    host: str,
    port: int,
    canvas_id: str,
    client_id: str,
    cookie_header: str,
    expected_revision: int,
    ready_barrier: object,
) -> dict[str, object]:
    query_client_id = urllib.parse.quote(client_id, safe="")
    connection = await websockets.connect(
        f"ws://{host}:{port}/ws/canvases/{canvas_id}"
        f"?layout_gap={LAYOUT_GAP}&client_id={query_client_id}",
        additional_headers={"Cookie": cookie_header},
        proxy=None,
        open_timeout=5,
        close_timeout=2,
        max_size=PERFORMANCE_WEBSOCKET_MAX_SIZE,
    )
    try:
        snapshot = await _receive_websocket_object(connection)
        if snapshot.get("type") != "canvas_snapshot":
            raise RuntimeError(f"{client_id} did not receive a Canvas Snapshot")
        if int(snapshot.get("revision", -1)) != expected_revision:
            raise RuntimeError(
                f"{client_id} heartbeat started at an unexpected Revision"
            )
        ready_barrier.wait(timeout=10)
        started_ns = time.monotonic_ns()
        await connection.send(
            json.dumps(
                {
                    "type": "ping",
                    "canvas_id": canvas_id,
                    "include_timing": True,
                },
                ensure_ascii=False,
            )
        )
        response = await _receive_websocket_object(connection)
        acknowledged_ns = time.monotonic_ns()
        if response.get("type") != "pong":
            raise RuntimeError(f"{client_id} heartbeat did not receive pong")
        revision = int(response.get("revision", -1))
        if revision != expected_revision:
            raise RuntimeError(f"{client_id} heartbeat changed Canvas Revision")
        server_received_ns = int(
            response.get("server_received_monotonic_ns", -1)
        )
        server_responding_ns = int(
            response.get("server_responding_monotonic_ns", -1)
        )
        server_send_worker_started_ns = int(
            response.get("server_send_worker_started_monotonic_ns", -1)
        )
        if not (
            started_ns
            <= server_received_ns
            <= server_responding_ns
            <= server_send_worker_started_ns
            <= acknowledged_ns
        ):
            raise RuntimeError(
                f"{client_id} heartbeat timing trace was not monotonic"
            )
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "client": client_id,
            "operation": "heartbeat",
            "status": "pong",
            "ack_latency_ms": round(
                (acknowledged_ns - started_ns) / 1_000_000,
                3,
            ),
            "client_to_server_ms": round(
                (server_received_ns - started_ns) / 1_000_000,
                3,
            ),
            "server_handler_ms": round(
                (server_responding_ns - server_received_ns) / 1_000_000,
                3,
            ),
            "server_send_queue_ms": round(
                (server_send_worker_started_ns - server_responding_ns)
                / 1_000_000,
                3,
            ),
            "server_after_send_worker_ms": round(
                (acknowledged_ns - server_send_worker_started_ns)
                / 1_000_000,
                3,
            ),
            "server_to_client_ms": round(
                (acknowledged_ns - server_responding_ns) / 1_000_000,
                3,
            ),
            "execution_unit": f"process:{os.getpid()}",
            "revision": revision,
        }
    finally:
        await connection.close()


def _isolated_heartbeat_process(
    host: str,
    port: int,
    canvas_id: str,
    client_id: str,
    cookie_header: str,
    expected_revision: int,
    ready_barrier: object,
    result_queue: object,
) -> None:
    try:
        metric = asyncio.run(
            _run_isolated_heartbeat(
                host=host,
                port=port,
                canvas_id=canvas_id,
                client_id=client_id,
                cookie_header=cookie_header,
                expected_revision=expected_revision,
                ready_barrier=ready_barrier,
            )
        )
        result_queue.put({"metric": metric})
    except Exception as exc:
        result_queue.put(
            {
                "exception_type": type(exc).__name__,
                "exception_message": str(exc),
            }
        )


def _run_isolated_heartbeats(
    *,
    host: str,
    port: int,
    canvas_id: str,
    client_sessions: list[tuple[str, http.cookiejar.CookieJar]],
    expected_revision: int,
) -> list[dict[str, object]]:
    context = multiprocessing.get_context("spawn")
    ready_barrier = context.Barrier(len(client_sessions))
    result_queue = context.Queue()
    processes = [
        context.Process(
            target=_isolated_heartbeat_process,
            args=(
                host,
                port,
                canvas_id,
                client_id,
                _cookie_header(cookie_jar),
                expected_revision,
                ready_barrier,
                result_queue,
            ),
        )
        for client_id, cookie_jar in client_sessions
    ]
    results: list[dict[str, object]] = []
    try:
        for process in processes:
            process.start()
        for _process in processes:
            try:
                results.append(result_queue.get(timeout=15))
            except queue.Empty as exc:
                raise RuntimeError("isolated heartbeat process timed out") from exc
    finally:
        for process in processes:
            process.join(timeout=5)
            if process.is_alive():
                process.terminate()
                process.join(timeout=5)
        result_queue.close()
        result_queue.join_thread()
    failures = [result for result in results if "exception_type" in result]
    if failures:
        raise RuntimeError(
            "isolated heartbeat failed: "
            + str(failures[0]["exception_type"])
            + ": "
            + str(failures[0].get("exception_message") or "")
        )
    metrics = [
        result["metric"]
        for result in results
        if isinstance(result.get("metric"), dict)
    ]
    if len(metrics) != len(client_sessions):
        raise RuntimeError("isolated heartbeat result count was incomplete")
    return sorted(metrics, key=lambda metric: str(metric["client"]))


async def _run_mutation_smoke(
    *,
    host: str,
    port: int,
    canvas_id: str,
    client_sessions: list[tuple[str, http.cookiejar.CookieJar]],
    base_url: str,
    generation_provider: _DeterministicImageProvider,
    browser_settings_trace: Callable[[], dict[str, object]],
    browser_canvas_open_trace: Callable[[], dict[str, object]],
    full_browser_traces: list[Callable[[], dict[str, object]]],
    server_rss_sample: Callable[[], int],
    suite_plan: dict[str, object],
    metrics_writer: _MetricsWriter,
    phase_progress: dict[str, object],
) -> dict[str, object]:
    connections: list[object] = []
    slow_connection: object | None = None
    slow_transport: object | None = None
    slow_transport_paused = False
    confirmed_revisions: list[int] = []
    metrics: list[dict[str, object]] = []
    heartbeat_revision_before = -1
    heartbeat_revision_after = -1
    event_loop_lag_probe_interval_ms = -1
    event_loop_lag_retention_capacity = -1
    event_loop_lag_samples_by_phase: dict[str, int] = {}
    event_loop_lag_truncated_phases: list[str] = []
    browser_settings_result: dict[str, object] = {}
    browser_canvas_open_result: dict[str, object] = {}
    representative_canvas_payload_bytes = 0
    representative_canvas_node_count = 0
    warmup_elapsed_ms = 0.0
    recovery_observation_elapsed_ms = 0.0
    recovery_revision_before = -1
    recovery_revision_after = -1
    full_browser_results: list[dict[str, object]] = []
    server_resource_samples: list[dict[str, object]] = []
    generation_overlaps_steady = False
    background_tasks: set[asyncio.Task[Any]] = set()

    def create_tracked_task(awaitable: Any) -> asyncio.Task[Any]:
        task = asyncio.create_task(awaitable)
        background_tasks.add(task)
        phase_progress["async_receive_task_target_count"] = len(
            background_tasks
        )
        return task

    def record_server_resource_sample(phase_boundary: str) -> None:
        server_resource_samples.append(
            {
                "phase_boundary": phase_boundary,
                "rss_bytes": server_rss_sample(),
            }
        )
    phase_plan = suite_plan.get("phases")
    if phase_plan is None:
        warmup_duration_seconds = 0
        recovery_observation_duration_seconds = 0
        full_browser_client_count = 0
        full_browser_lightweight_client_count = 0
        steady_window_seconds = int(suite_plan["steady_load_seconds"])
        steady_target_rate = int(suite_plan["steady_mutations_per_second"])
        burst_window_seconds = int(suite_plan["burst_load_seconds"])
        burst_target_rate = int(suite_plan["burst_mutations_per_second"])
        executed_phase_names = ["steady", "burst"]
    else:
        if not isinstance(phase_plan, list) or any(
            not isinstance(phase, dict) for phase in phase_plan
        ):
            raise RuntimeError("suite phase plan was invalid")
        executed_phase_names = [
            str(phase.get("name") or "") for phase in phase_plan
        ]
        if executed_phase_names != [
            "warmup",
            "steady",
            "burst",
            "recovery",
            "full_browser",
        ]:
            raise RuntimeError(
                "short suite phase order must be warmup, steady, burst, recovery, then full_browser"
            )
        (
            warmup_phase,
            steady_phase,
            burst_phase,
            recovery_phase,
            full_browser_phase,
        ) = phase_plan
        generation_overlaps_steady = bool(
            steady_phase.get("generation_runs_active")
        )
        if (
            warmup_phase.get("generation_runs_active")
            or not burst_phase.get("generation_runs_active")
            or recovery_phase.get("generation_runs_active")
            or full_browser_phase.get("generation_runs_active")
        ):
            raise RuntimeError(
                "suite Generation Run must overlap burst, optionally steady"
            )
        warmup_duration_seconds = int(warmup_phase["duration_seconds"])
        steady_window_seconds = int(steady_phase["duration_seconds"])
        steady_target_rate = int(
            steady_phase["target_mutations_per_second"]
        )
        burst_window_seconds = int(burst_phase["duration_seconds"])
        burst_target_rate = int(
            burst_phase["target_mutations_per_second"]
        )
        recovery_observation_duration_seconds = int(
            recovery_phase["duration_seconds"]
        )
        full_browser_client_count = int(
            full_browser_phase["browser_client_count"]
        )
        full_browser_lightweight_client_count = int(
            full_browser_phase["lightweight_client_count"]
        )
    generation_window_seconds = burst_window_seconds + (
        steady_window_seconds if generation_overlaps_steady else 0
    )
    generation_target_rate = burst_target_rate
    generation_run_target_count = int(
        suite_plan["generation_run_max_concurrency"]
    )
    if not 1 <= generation_run_target_count <= len(client_sessions):
        raise RuntimeError("suite Generation Run concurrency was invalid")
    recovery_gate_seconds = int(suite_plan["recovery_gate_seconds"])
    if len(client_sessions) != int(suite_plan["backend_client_count"]):
        raise RuntimeError("suite plan client count did not match sessions")
    if full_browser_client_count != len(full_browser_traces):
        raise RuntimeError("full-browser plan did not match browser traces")
    if full_browser_client_count and full_browser_lightweight_client_count:
        raise RuntimeError("full-browser phase cannot use lightweight clients")

    def record_metric(metric: dict[str, object]) -> None:
        metrics.append(metric)
        metrics_writer.append(metric)

    def record_metrics(rows: list[dict[str, object]]) -> None:
        for row in rows:
            record_metric(row)

    async def connect(client_id: str, cookie_jar: http.cookiejar.CookieJar):
        query_client_id = urllib.parse.quote(client_id, safe="")
        return await websockets.connect(
            f"ws://{host}:{port}/ws/canvases/{canvas_id}"
            f"?layout_gap={LAYOUT_GAP}&client_id={query_client_id}",
            additional_headers={"Cookie": _cookie_header(cookie_jar)},
            proxy=None,
            open_timeout=5,
            close_timeout=2,
            max_size=PERFORMANCE_WEBSOCKET_MAX_SIZE,
        )

    async def sample_runtime_status(
        phase: str,
        *,
        sample_count: int = 5,
        on_sample: Callable[[dict[str, object]], None] | None = None,
    ) -> list[dict[str, object]]:
        phase_started_ns = time.perf_counter_ns()

        async def sample(sample_index: int) -> dict[str, object]:
            target_ns = phase_started_ns + sample_index * 200_000_000
            remaining_seconds = (
                target_ns - time.perf_counter_ns()
            ) / 1_000_000_000
            if remaining_seconds > 0:
                await asyncio.sleep(remaining_seconds)
            started_ns = time.perf_counter_ns()
            status = "error"
            try:
                payload = await asyncio.to_thread(
                    _json_request,
                    urllib.request.build_opener(),
                    base_url,
                    "/api/runtime/status",
                    timeout=0.25,
                )
                status = str(payload.get("stage") or "invalid")
            except (TimeoutError, socket.timeout):
                status = "timeout"
            except urllib.error.URLError as exc:
                if isinstance(exc.reason, (TimeoutError, socket.timeout)):
                    status = "timeout"
            except RuntimeError as exc:
                message = str(exc)
                if " returned a non-object response" in message:
                    status = "invalid_response"
                elif " failed: " in message:
                    status = "http_error"
                else:
                    status = "runtime_error"
            except Exception:
                status = "error"
            acknowledged_ns = time.perf_counter_ns()
            metric = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "client": "runtime-status",
                "operation": f"runtime_status_{phase}",
                "status": status,
                "ack_latency_ms": round(
                    (acknowledged_ns - started_ns) / 1_000_000,
                    3,
                ),
            }
            if on_sample is not None:
                on_sample(metric)
            return metric

        return list(
            await asyncio.gather(
                *(sample(index) for index in range(sample_count))
            )
        )

    async def event_loop_lag_snapshot(
        after_sequence: int,
    ) -> tuple[int, int, int, int, list[tuple[int, float]]]:
        payload = await asyncio.to_thread(
            _json_request,
            urllib.request.build_opener(),
            base_url,
            (
                "/api/runtime/status?include_event_loop_lag=true"
                f"&event_loop_lag_after_sequence={max(0, after_sequence)}"
            ),
        )
        if str(payload.get("stage") or "") != "ready":
            raise RuntimeError("runtime was not ready for event-loop probe")
        snapshot = payload.get("event_loop_lag")
        if not isinstance(snapshot, dict):
            raise RuntimeError("runtime omitted event-loop probe data")
        interval_ms = int(snapshot.get("probe_interval_ms") or 0)
        retention_capacity = int(snapshot.get("retention_capacity") or 0)
        oldest_sequence = int(snapshot.get("oldest_sequence") or 0)
        latest_sequence = int(snapshot.get("latest_sequence") or 0)
        if retention_capacity <= 0:
            raise RuntimeError("runtime omitted event-loop retention capacity")
        samples: list[tuple[int, float]] = []
        for item in snapshot.get("samples") or []:
            if not isinstance(item, dict):
                raise RuntimeError("runtime returned invalid event-loop sample")
            sequence = int(item.get("sequence") or 0)
            lag_ms = float(item.get("lag_ms") or 0)
            if sequence <= after_sequence or lag_ms < 0:
                raise RuntimeError("runtime returned invalid event-loop sample")
            samples.append((sequence, lag_ms))
        if [sequence for sequence, _lag_ms in samples] != sorted(
            sequence for sequence, _lag_ms in samples
        ):
            raise RuntimeError("runtime event-loop samples were not ordered")
        return (
            latest_sequence,
            interval_ms,
            retention_capacity,
            oldest_sequence,
            samples,
        )

    async def capture_event_loop_lag(
        phase: str,
        after_sequence: int,
    ) -> list[dict[str, object]]:
        nonlocal event_loop_lag_probe_interval_ms
        nonlocal event_loop_lag_retention_capacity
        (
            latest_sequence,
            interval_ms,
            retention_capacity,
            oldest_sequence,
            samples,
        ) = await event_loop_lag_snapshot(after_sequence)
        if event_loop_lag_probe_interval_ms < 0:
            event_loop_lag_probe_interval_ms = interval_ms
        elif event_loop_lag_probe_interval_ms != interval_ms:
            raise RuntimeError("runtime event-loop probe interval changed")
        if event_loop_lag_retention_capacity < 0:
            event_loop_lag_retention_capacity = retention_capacity
        elif event_loop_lag_retention_capacity != retention_capacity:
            raise RuntimeError("runtime event-loop retention capacity changed")
        if (
            latest_sequence - after_sequence > len(samples)
            and oldest_sequence > after_sequence + 1
        ):
            event_loop_lag_truncated_phases.append(phase)
        event_loop_lag_samples_by_phase[phase] = len(samples)
        return [
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "client": "server-event-loop",
                "operation": f"event_loop_lag_{phase}",
                "status": "observed",
                "ack_latency_ms": lag_ms,
                "execution_unit": "server-event-loop",
            }
            for _sequence, lag_ms in samples
        ]

    try:
        for client_id, cookie_jar in client_sessions:
            connection = await connect(client_id, cookie_jar)
            connections.append(connection)
            snapshot = await _receive_websocket_object(connection)
            if snapshot.get("type") != "canvas_snapshot":
                raise RuntimeError(f"{client_id} did not receive a Canvas Snapshot")
            if int(snapshot.get("revision", -1)) != 0:
                raise RuntimeError("Mutation smoke must start at Canvas Revision 0")

        for index, ((client_id, _cookie_jar), sender) in enumerate(
            zip(client_sessions, connections, strict=True),
            start=1,
        ):
            receive_tasks = [
                create_tracked_task(_receive_websocket_object(connection))
                for connection in connections
            ]
            started_ns = time.perf_counter_ns()
            created_nodes = [
                {
                    "id": (
                        f"performance-node-{index:02d}"
                        if slot == 0
                        else f"performance-payload-{index:02d}-{slot:02d}"
                    ),
                    "type": "smart-image",
                    "x": index * 120 + (slot % 4) * 28,
                    "y": index * 80 + (slot // 4) * 28,
                    "performancePayload": "p" * REPRESENTATIVE_NODE_PAYLOAD_BYTES,
                }
                for slot in range(REPRESENTATIVE_CANVAS_NODE_COUNT // 10)
            ]
            await sender.send(
                json.dumps(
                    {
                        "type": "canvas_mutation",
                        "canvas_id": canvas_id,
                        "operation": {
                            "operation_id": f"{client_id}:create-{index:02d}",
                            "base_revision": index - 1,
                            "changes": {"node_creates": created_nodes},
                        },
                    },
                    ensure_ascii=False,
                )
            )
            sender_message = await receive_tasks[index - 1]
            acknowledged_ns = time.perf_counter_ns()
            observer_messages = await asyncio.gather(
                *(
                    task
                    for observer_index, task in enumerate(receive_tasks)
                    if observer_index != index - 1
                )
            )
            delivered = [sender_message, *observer_messages]
            delivered_revisions = {
                int(message.get("revision", -1)) for message in delivered
            }
            if delivered_revisions != {index} or any(
                message.get("type") != "canvas_mutation" for message in delivered
            ):
                raise RuntimeError(
                    f"{client_id} Mutation was not confirmed at Revision {index}"
                )
            confirmed_revisions.append(index)
            record_metric(
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "client": client_id,
                    "operation": "node_create",
                    "status": "acknowledged",
                    "ack_latency_ms": round(
                        (acknowledged_ns - started_ns) / 1_000_000,
                        3,
                    ),
                    "revision": index,
                }
            )

        representative_payload = await asyncio.to_thread(
            _json_request,
            urllib.request.build_opener(
                urllib.request.HTTPCookieProcessor(client_sessions[0][1])
            ),
            base_url,
            f"/api/canvases/{canvas_id}",
        )
        representative_canvas = representative_payload.get("canvas")
        if not isinstance(representative_canvas, dict):
            raise RuntimeError("representative Canvas response was unavailable")
        representative_canvas_payload_bytes = len(
            json.dumps(
                representative_canvas,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
        )
        representative_nodes = representative_canvas.get("nodes")
        representative_canvas_node_count = (
            len(representative_nodes)
            if isinstance(representative_nodes, list)
            else -1
        )

        admin = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(client_sessions[0][1])
        )
        async def start_generation_run(
            revision_before: int,
            run_index: int,
        ) -> tuple[int, str]:
            generation_operation_id = (
                f"client-01:generation-baseline-{run_index:02d}"
            )
            target_node_id = f"performance-node-{run_index:02d}"
            prepare_receive_tasks = [
                create_tracked_task(_receive_websocket_object(connection))
                for connection in connections
            ]
            prepare_started_ns = time.perf_counter_ns()
            await connections[0].send(
                json.dumps(
                    {
                        "type": "canvas_mutation",
                        "canvas_id": canvas_id,
                        "operation": {
                            "operation_id": (
                                "client-01:prepare-generation-target-"
                                f"{run_index:02d}"
                            ),
                            "base_revision": revision_before,
                            "changes": {
                                "node_updates": [
                                    {
                                        "id": target_node_id,
                                        "path": ["generationOperationId"],
                                        "value": generation_operation_id,
                                    }
                                ]
                            },
                        },
                    },
                    ensure_ascii=False,
                )
            )
            prepare_messages = await asyncio.gather(*prepare_receive_tasks)
            prepare_acknowledged_ns = time.perf_counter_ns()
            target_revision = revision_before + 1
            if any(
                message.get("type") != "canvas_mutation"
                or int(message.get("revision", -1)) != target_revision
                for message in prepare_messages
            ):
                raise RuntimeError(
                    "Generation target preparation was not confirmed"
                )
            record_metric(
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "client": client_sessions[0][0],
                    "operation": "generation_target_prepare",
                    "status": "acknowledged",
                    "ack_latency_ms": round(
                        (
                            prepare_acknowledged_ns
                            - prepare_started_ns
                        )
                        / 1_000_000,
                        3,
                    ),
                    "revision": target_revision,
                }
            )

            generation_provider.start()
            submission = await asyncio.to_thread(
                _json_request,
                admin,
                base_url,
                "/api/canvas-image-tasks",
                method="POST",
                payload={
                    "prompt": "baseline-generation-private-prompt",
                    "provider_id": "baseline-deterministic",
                    "model": "baseline-image-v1",
                    "size": "1024x1024",
                    "n": 1,
                    "canvas_id": canvas_id,
                    "node_id": target_node_id,
                    "generation_operation_id": generation_operation_id,
                    "generation_request_index": 0,
                },
            )
            task_id = str(submission.get("task_id") or "")
            if not task_id:
                raise RuntimeError("Generation Run submission omitted task id")
            if not await asyncio.to_thread(
                generation_provider.wait_until_requested,
                5,
                run_index,
            ):
                raise RuntimeError(
                    "deterministic Provider did not receive the Run"
                )
            return target_revision, task_id

        async def start_generation_runs(
            revision_before: int,
        ) -> tuple[list[int], list[str]]:
            target_revisions: list[int] = []
            task_ids: list[str] = []
            current_revision = revision_before
            for run_index in range(1, generation_run_target_count + 1):
                target_revision, task_id = await start_generation_run(
                    current_revision,
                    run_index,
                )
                target_revisions.append(target_revision)
                task_ids.append(task_id)
                current_revision = target_revision
            return target_revisions, task_ids

        if warmup_duration_seconds:
            phase_progress["active_phase"] = "warmup"
            warmup_started_ns = time.perf_counter_ns()
            record_metric(
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "client": "phase-controller",
                    "operation": "phase_warmup_started",
                    "status": "started",
                    "ack_latency_ms": 0,
                }
            )
            await asyncio.sleep(warmup_duration_seconds)
            warmup_elapsed_ms = round(
                (time.perf_counter_ns() - warmup_started_ns) / 1_000_000,
                3,
            )
            record_metric(
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "client": "phase-controller",
                    "operation": "phase_warmup_complete",
                    "status": "completed",
                    "ack_latency_ms": warmup_elapsed_ms,
                }
            )
            phase_progress["completed_phase_names"] = ["warmup"]
            phase_progress["active_phase"] = ""

        generation_revision_before = -1
        generation_target_revision = -1
        generation_target_revisions: list[int] = []
        generation_task_ids: list[str] = []
        phase_progress["active_phase"] = "steady"
        if generation_overlaps_steady:
            generation_revision_before = confirmed_revisions[-1]
            (
                generation_target_revisions,
                generation_task_ids,
            ) = await start_generation_runs(generation_revision_before)
            generation_target_revision = generation_target_revisions[-1]

        if phase_plan is not None:
            record_server_resource_sample("steady_start")

        steady_operation_count = steady_window_seconds * steady_target_rate
        steady_interval_ns = max(1, 1_000_000_000 // steady_target_rate)
        steady_revision_start = (
            generation_target_revision + 1
            if generation_overlaps_steady
            else confirmed_revisions[-1] + 1
        )
        steady_operation_ids = [
            f"{client_sessions[index % len(client_sessions)][0]}:steady-{index + 1:02d}"
            for index in range(steady_operation_count)
        ]
        steady_operation_indexes = {
            operation_id: index
            for index, operation_id in enumerate(steady_operation_ids)
        }
        steady_operation_owners = {
            operation_id: client_sessions[index % len(client_sessions)][0]
            for index, operation_id in enumerate(steady_operation_ids)
        }
        expected_steady_revisions = list(
            range(
                steady_revision_start,
                steady_revision_start + steady_operation_count,
            )
        )
        steady_send_started: dict[str, tuple[str, int]] = {}
        steady_pending_metrics: dict[int, dict[str, object]] = {}
        steady_next_metric_revision = steady_revision_start

        def record_steady_metric(metric: dict[str, object]) -> None:
            nonlocal steady_next_metric_revision
            revision = int(metric["revision"])
            steady_pending_metrics[revision] = metric
            while steady_next_metric_revision in steady_pending_metrics:
                record_metric(
                    steady_pending_metrics.pop(steady_next_metric_revision)
                )
                steady_next_metric_revision += 1

        async def receive_steady_mutations(
            client_id: str,
            connection: object,
        ) -> tuple[str, dict[str, tuple[int, int]], int]:
            seen_operations = bytearray(steady_operation_count)
            sender_receipts: dict[str, tuple[int, int]] = {}
            for sample_index, expected_revision in enumerate(
                expected_steady_revisions
            ):
                message = await _receive_websocket_object(connection)
                received_ns = time.perf_counter_ns()
                if message.get("type") != "canvas_mutation":
                    raise RuntimeError(
                        f"{client_id} steady Mutation stream was rejected"
                    )
                revision = int(message.get("revision", -1))
                if revision != expected_revision:
                    raise RuntimeError(
                        f"{client_id} steady Mutation Revisions were not continuous"
                    )
                operation_id = str(message.get("operation_id") or "")
                operation_index = steady_operation_indexes.get(operation_id)
                if operation_index is None or seen_operations[operation_index]:
                    raise RuntimeError(
                        f"{client_id} steady Mutation operations were invalid"
                    )
                seen_operations[operation_index] = 1
                if steady_operation_owners[operation_id] == client_id:
                    started = steady_send_started.get(operation_id)
                    if started is None or started[0] != client_id:
                        raise RuntimeError(
                            "steady sender timing was unavailable"
                        )
                    sender_receipts[operation_id] = (revision, received_ns)
                    record_steady_metric(
                        {
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "client": client_id,
                            "operation": "steady_node_move",
                            "status": "acknowledged",
                            "ack_latency_ms": round(
                                (received_ns - started[1]) / 1_000_000,
                                3,
                            ),
                            "revision": revision,
                        }
                    )
            if not all(seen_operations):
                raise RuntimeError(
                    f"{client_id} steady Mutation operations were incomplete"
                )
            expected_sender_receipt_count = sum(
                owner == client_id
                for owner in steady_operation_owners.values()
            )
            if len(sender_receipts) != expected_sender_receipt_count:
                raise RuntimeError(
                    f"{client_id} steady sender acknowledgements were incomplete"
                )
            return client_id, sender_receipts, sample_index + 1

        steady_receive_tasks = [
            create_tracked_task(
                receive_steady_mutations(client_id, connection)
            )
            for (client_id, _cookie_jar), connection in zip(
                client_sessions,
                connections,
                strict=True,
            )
        ]
        (
            steady_event_loop_sequence,
            _interval_ms,
            _retention_capacity,
            _oldest_sequence,
            _samples,
        ) = (
            await event_loop_lag_snapshot(0)
        )
        steady_runtime_status_task = create_tracked_task(
            sample_runtime_status(
                "steady",
                sample_count=steady_window_seconds * 5,
            )
        )
        browser_settings_task = create_tracked_task(
            asyncio.to_thread(browser_settings_trace)
        )
        steady_phase_started_ns = time.perf_counter_ns()
        steady_last_send_started_ns = steady_phase_started_ns
        for sample_index, operation_id in enumerate(steady_operation_ids):
            target_ns = (
                steady_phase_started_ns + sample_index * steady_interval_ns
            )
            remaining_seconds = (target_ns - time.perf_counter_ns()) / 1_000_000_000
            if remaining_seconds > 0:
                await asyncio.sleep(remaining_seconds)
            client_index = sample_index % len(client_sessions)
            client_id = client_sessions[client_index][0]
            sender = connections[client_index]
            steady_last_send_started_ns = time.perf_counter_ns()
            steady_send_started[operation_id] = (
                client_id,
                steady_last_send_started_ns,
            )
            await sender.send(
                json.dumps(
                    {
                        "type": "canvas_mutation",
                        "canvas_id": canvas_id,
                        "operation": {
                            "operation_id": operation_id,
                            "base_revision": steady_revision_start - 1,
                            "changes": {
                                "node_updates": [
                                    {
                                        "id": (
                                            "performance-node-"
                                            f"{client_index + 1:02d}"
                                        ),
                                        "path": ["x"],
                                        "value": (sample_index + 1) * 60,
                                    }
                                ]
                            },
                        },
                    },
                    ensure_ascii=False,
                )
            )

        steady_receive_results = await asyncio.gather(*steady_receive_tasks)
        steady_sender_receipts: dict[
            str,
            dict[str, tuple[int, int]],
        ] = {}
        steady_validated_delivery_count = 0
        for client_id, sender_receipts, delivery_count in steady_receive_results:
            steady_sender_receipts[client_id] = sender_receipts
            steady_validated_delivery_count += delivery_count
        steady_event_loop_metrics = await capture_event_loop_lag(
            "steady",
            steady_event_loop_sequence,
        )
        if (
            steady_pending_metrics
            or steady_next_metric_revision
            != steady_revision_start + steady_operation_count
        ):
            raise RuntimeError("steady Mutation metrics were incomplete")
        record_metrics(await steady_runtime_status_task)
        record_metrics(steady_event_loop_metrics)
        browser_settings_result = await browser_settings_task
        record_metric(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "client": "client-01-browser",
                "operation": "browser_settings_first_operable",
                "status": (
                    "accepted"
                    if browser_settings_result.get(
                        "browser_settings_interaction_accepted"
                    )
                    else "failed"
                ),
                "ack_latency_ms": browser_settings_result.get(
                    "browser_settings_first_operable_p95_ms",
                    0,
                ),
                "execution_unit": "browser",
            }
        )
        steady_send_window_ms = round(
            (steady_last_send_started_ns - steady_phase_started_ns)
            / 1_000_000,
            3,
        )
        if phase_plan is not None:
            record_server_resource_sample("steady_complete")
        phase_progress["completed_phase_names"] = (
            ["warmup", "steady"]
            if phase_plan is not None
            else ["steady"]
        )
        phase_progress["active_phase"] = "burst"

        if not generation_overlaps_steady:
            generation_revision_before = expected_steady_revisions[-1]
            (
                generation_target_revisions,
                generation_task_ids,
            ) = await start_generation_runs(generation_revision_before)
            generation_target_revision = generation_target_revisions[-1]

        burst_operation_count = burst_window_seconds * burst_target_rate
        burst_interval_ns = max(1, 1_000_000_000 // burst_target_rate)
        burst_revision_start = (
            expected_steady_revisions[-1] + 1
            if generation_overlaps_steady
            else generation_target_revision + 1
        )
        burst_operation_ids = [
            f"{client_sessions[index % len(client_sessions)][0]}:burst-{index + 1:02d}"
            for index in range(burst_operation_count)
        ]
        burst_operation_indexes = {
            operation_id: index
            for index, operation_id in enumerate(burst_operation_ids)
        }
        burst_operation_owners = {
            operation_id: client_sessions[index % len(client_sessions)][0]
            for index, operation_id in enumerate(burst_operation_ids)
        }
        expected_burst_revisions = list(
            range(
                burst_revision_start,
                burst_revision_start + burst_operation_count,
            )
        )
        burst_send_started: dict[str, tuple[str, int]] = {}
        burst_pending_metrics: dict[int, dict[str, object] | None] = {}
        burst_next_metric_revision = burst_revision_start

        def record_burst_sequence_item(
            revision: int,
            metric: dict[str, object] | None,
        ) -> None:
            nonlocal burst_next_metric_revision
            burst_pending_metrics[revision] = metric
            while burst_next_metric_revision in burst_pending_metrics:
                pending_metric = burst_pending_metrics.pop(
                    burst_next_metric_revision
                )
                if pending_metric is not None:
                    record_metric(pending_metric)
                burst_next_metric_revision += 1

        def record_burst_metric(metric: dict[str, object]) -> None:
            record_burst_sequence_item(int(metric["revision"]), metric)

        async def receive_burst_mutations(
            client_id: str,
            connection: object,
        ) -> tuple[
            str,
            dict[str, tuple[int, int]],
            int,
            tuple[str, ...],
            int,
        ]:
            seen_operations = bytearray(burst_operation_count)
            sender_receipts: dict[str, tuple[int, int]] = {}
            browser_background_operation_ids: set[str] = set()
            expected_revision = burst_revision_start
            confirmed_operation_count = 0
            while confirmed_operation_count < burst_operation_count:
                message = await _receive_websocket_object(connection)
                received_ns = time.perf_counter_ns()
                if message.get("type") != "canvas_mutation":
                    raise RuntimeError(
                        f"{client_id} burst Mutation stream was rejected"
                    )
                revision = int(message.get("revision", -1))
                if revision != expected_revision:
                    raise RuntimeError(
                        f"{client_id} burst Mutation Revisions were not continuous"
                    )
                expected_revision += 1
                operation_id = str(message.get("operation_id") or "")
                operation_index = burst_operation_indexes.get(operation_id)
                if operation_index is None:
                    if (
                        operation_id.startswith("canvas_smart_")
                        and ":mutation:" in operation_id
                        and operation_id not in browser_background_operation_ids
                    ):
                        browser_background_operation_ids.add(operation_id)
                        if client_id == client_sessions[0][0]:
                            record_burst_sequence_item(revision, None)
                        continue
                    raise RuntimeError(
                        f"{client_id} burst Mutation operations were invalid"
                    )
                if seen_operations[operation_index]:
                    raise RuntimeError(
                        f"{client_id} burst Mutation operations were invalid"
                    )
                seen_operations[operation_index] = 1
                confirmed_operation_count += 1
                if burst_operation_owners[operation_id] == client_id:
                    started = burst_send_started.get(operation_id)
                    if started is None or started[0] != client_id:
                        raise RuntimeError(
                            "burst sender timing was unavailable"
                        )
                    sender_receipts[operation_id] = (revision, received_ns)
                    record_burst_metric(
                        {
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "client": client_id,
                            "operation": "burst_node_move",
                            "status": "acknowledged",
                            "ack_latency_ms": round(
                                (received_ns - started[1]) / 1_000_000,
                                3,
                            ),
                            "revision": revision,
                        }
                    )
            if not all(seen_operations):
                raise RuntimeError(
                    f"{client_id} burst Mutation operations were incomplete"
                )
            expected_sender_receipt_count = sum(
                owner == client_id
                for owner in burst_operation_owners.values()
            )
            if len(sender_receipts) != expected_sender_receipt_count:
                raise RuntimeError(
                    f"{client_id} burst sender acknowledgements were incomplete"
                )
            return (
                client_id,
                sender_receipts,
                confirmed_operation_count,
                tuple(sorted(browser_background_operation_ids)),
                expected_revision - 1,
            )

        burst_receive_tasks = [
            create_tracked_task(
                receive_burst_mutations(client_id, connection)
            )
            for (client_id, _cookie_jar), connection in zip(
                client_sessions,
                connections,
                strict=True,
            )
        ]
        (
            burst_event_loop_sequence,
            _interval_ms,
            _retention_capacity,
            _oldest_sequence,
            _samples,
        ) = (
            await event_loop_lag_snapshot(0)
        )
        burst_runtime_status_task = create_tracked_task(
            sample_runtime_status(
                "burst",
                sample_count=burst_window_seconds * 5,
            )
        )
        browser_canvas_open_task = create_tracked_task(
            asyncio.to_thread(browser_canvas_open_trace)
        )
        burst_phase_started_ns = time.perf_counter_ns()
        burst_last_send_started_ns = burst_phase_started_ns
        for sample_index, operation_id in enumerate(burst_operation_ids):
            target_ns = burst_phase_started_ns + sample_index * burst_interval_ns
            remaining_seconds = (target_ns - time.perf_counter_ns()) / 1_000_000_000
            if remaining_seconds > 0:
                await asyncio.sleep(remaining_seconds)
            client_index = sample_index % len(client_sessions)
            client_id = client_sessions[client_index][0]
            sender = connections[client_index]
            burst_last_send_started_ns = time.perf_counter_ns()
            burst_send_started[operation_id] = (
                client_id,
                burst_last_send_started_ns,
            )
            await sender.send(
                json.dumps(
                    {
                        "type": "canvas_mutation",
                        "canvas_id": canvas_id,
                        "operation": {
                            "operation_id": operation_id,
                            "base_revision": generation_target_revision,
                            "changes": {
                                "node_updates": [
                                    {
                                        "id": (
                                            "performance-node-"
                                            f"{client_index + 1:02d}"
                                        ),
                                        "path": ["y"],
                                        "value": (sample_index + 1) * 40,
                                    }
                                ]
                            },
                        },
                    },
                    ensure_ascii=False,
                )
            )

        burst_receive_results = await asyncio.gather(*burst_receive_tasks)
        burst_sender_receipts: dict[
            str,
            dict[str, tuple[int, int]],
        ] = {}
        burst_validated_delivery_count = 0
        burst_background_operation_sets: list[tuple[str, ...]] = []
        burst_last_received_revisions: list[int] = []
        for (
            client_id,
            sender_receipts,
            delivery_count,
            background_operation_ids,
            last_received_revision,
        ) in burst_receive_results:
            burst_sender_receipts[client_id] = sender_receipts
            burst_validated_delivery_count += delivery_count
            burst_background_operation_sets.append(background_operation_ids)
            burst_last_received_revisions.append(last_received_revision)
        if len(set(burst_background_operation_sets)) != 1:
            raise RuntimeError(
                "browser background Mutations were not delivered consistently"
            )
        if len(set(burst_last_received_revisions)) != 1:
            raise RuntimeError(
                "burst Mutation final Revisions were not consistent"
            )
        burst_event_loop_metrics = await capture_event_loop_lag(
            "burst",
            burst_event_loop_sequence,
        )
        if (
            burst_pending_metrics
            or burst_next_metric_revision
            != burst_last_received_revisions[0] + 1
        ):
            raise RuntimeError("burst Mutation metrics were incomplete")
        record_metrics(await burst_runtime_status_task)
        record_metrics(burst_event_loop_metrics)
        browser_canvas_open_result = await browser_canvas_open_task
        record_metric(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "client": "client-01-browser",
                "operation": "browser_canvas_open_first_operable",
                "status": (
                    "accepted"
                    if browser_canvas_open_result.get(
                        "browser_canvas_open_interaction_accepted"
                    )
                    else "failed"
                ),
                "ack_latency_ms": browser_canvas_open_result.get(
                    "browser_canvas_open_first_operable_p95_ms",
                    0,
                ),
                "execution_unit": "browser",
            }
        )
        burst_send_window_ms = round(
            (burst_last_send_started_ns - burst_phase_started_ns)
            / 1_000_000,
            3,
        )

        burst_recovery_revision = burst_last_received_revisions[0]
        browser_background_operation_ids = set(
            burst_background_operation_sets[0]
        )
        browser_background_mutation_count = len(
            browser_background_operation_ids
        )
        await connections[0].send(
            json.dumps(
                {"type": "ping", "canvas_id": canvas_id},
                ensure_ascii=False,
            )
        )
        for _message_index in range(10):
            burst_recovery_response = await _receive_websocket_object(
                connections[0]
            )
            response_type = burst_recovery_response.get("type")
            response_revision = int(
                burst_recovery_response.get("revision", -1)
            )
            if response_type == "canvas_mutation":
                if response_revision != burst_recovery_revision + 1:
                    raise RuntimeError(
                        "browser background Mutation Revision was not continuous"
                    )
                operation_id = str(
                    burst_recovery_response.get("operation_id") or ""
                )
                if (
                    not operation_id.startswith("canvas_smart_")
                    or ":mutation:" not in operation_id
                    or operation_id in browser_background_operation_ids
                ):
                    raise RuntimeError(
                        "burst recovery received an invalid browser Mutation"
                    )
                burst_recovery_revision = response_revision
                browser_background_operation_ids.add(operation_id)
                browser_background_mutation_count += 1
                continue
            if (
                response_type == "pong"
                and response_revision == burst_recovery_revision
            ):
                break
            raise RuntimeError(
                "burst recovery received an unexpected WebSocket message"
            )
        else:
            raise RuntimeError("burst recovery heartbeat was not received")
        burst_recovery_acknowledged_ns = time.perf_counter_ns()
        burst_recovery_ms = round(
            (burst_recovery_acknowledged_ns - burst_last_send_started_ns)
            / 1_000_000,
            3,
        )
        record_metric(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "client": client_sessions[0][0],
                "operation": "burst_recovery_heartbeat",
                "status": "pong",
                "ack_latency_ms": burst_recovery_ms,
                "revision": burst_recovery_revision,
            }
        )

        await asyncio.gather(
            *(connection.close() for connection in connections),
        )
        connections.clear()
        for client_id, cookie_jar in client_sessions:
            connection = await connect(client_id, cookie_jar)
            connections.append(connection)
            snapshot = await _receive_websocket_object(connection)
            if snapshot.get("type") != "canvas_snapshot" or int(
                snapshot.get("revision", -1)
            ) != burst_recovery_revision:
                raise RuntimeError(
                    f"{client_id} generation phase started at an unexpected Revision"
                )

        if generation_overlaps_steady:
            generation_operation_count = (
                steady_operation_count + burst_operation_count
            )
            expected_generation_revisions = [
                *expected_steady_revisions,
                *expected_burst_revisions,
            ]
            generation_sender_receipts = {
                client_id: {
                    **steady_sender_receipts.get(client_id, {}),
                    **burst_sender_receipts.get(client_id, {}),
                }
                for client_id, _cookie_jar in client_sessions
            }
            generation_validated_delivery_count = (
                steady_validated_delivery_count
                + burst_validated_delivery_count
            )
            generation_send_window_ms = (
                steady_send_window_ms + burst_send_window_ms
            )
        else:
            generation_operation_count = burst_operation_count
            expected_generation_revisions = expected_burst_revisions
            generation_sender_receipts = burst_sender_receipts
            generation_validated_delivery_count = (
                burst_validated_delivery_count
            )
            generation_send_window_ms = burst_send_window_ms

        generation_provider.release()
        generation_runs_by_id: dict[str, dict[str, object]] = {}
        terminal_statuses = {
            "succeeded",
            "failed",
            "cancelled",
            "discarded",
        }
        generation_deadline = time.monotonic() + 10
        while time.monotonic() < generation_deadline:
            for task_id in generation_task_ids:
                current = generation_runs_by_id.get(task_id, {})
                if str(current.get("status") or "") in terminal_statuses:
                    continue
                generation_runs_by_id[task_id] = await asyncio.to_thread(
                    _json_request,
                    admin,
                    base_url,
                    f"/api/canvas-image-tasks/{task_id}",
                )
            if all(
                str(generation_runs_by_id.get(task_id, {}).get("status") or "")
                in terminal_statuses
                for task_id in generation_task_ids
            ):
                break
            await asyncio.sleep(0.05)
        generation_runs = [
            generation_runs_by_id.get(task_id, {})
            for task_id in generation_task_ids
        ]
        generation_statuses = [
            str(generation_run.get("status") or "")
            for generation_run in generation_runs
        ]
        generation_status = (
            "succeeded"
            if generation_statuses
            and set(generation_statuses) == {"succeeded"}
            else "failed"
        )
        if generation_status != "succeeded":
            raise RuntimeError(
                "baseline Generation Runs did not all succeed: "
                f"statuses={generation_statuses}"
            )

        final_generation_canvas: dict[str, object] = {}
        generation_outputs: list[dict[str, object]] = []
        generation_effect_deadline = time.monotonic() + 10
        while True:
            final_generation_payload = await asyncio.to_thread(
                _json_request,
                admin,
                base_url,
                f"/api/canvases/{canvas_id}",
            )
            projected = final_generation_payload.get("canvas")
            if not isinstance(projected, dict):
                raise RuntimeError(
                    "Generation final Canvas projection was unavailable"
                )
            final_generation_canvas = projected
            projected_outputs: list[dict[str, object]] = []
            target_nodes_available = True
            for run_index in range(1, generation_run_target_count + 1):
                target_node_id = f"performance-node-{run_index:02d}"
                generation_node = next(
                    (
                        node
                        for node in final_generation_canvas.get("nodes") or []
                        if isinstance(node, dict)
                        and str(node.get("id") or "") == target_node_id
                    ),
                    None,
                )
                if not isinstance(generation_node, dict):
                    target_nodes_available = False
                    break
                node_outputs = [
                    item
                    for item in generation_node.get("images") or []
                    if isinstance(item, dict) and str(item.get("url") or "")
                ]
                if len(node_outputs) != 1:
                    break
                projected_outputs.extend(node_outputs)
            if len(projected_outputs) == generation_run_target_count:
                generation_outputs = projected_outputs
                break
            if not target_nodes_available:
                raise RuntimeError("Generation target Node was unavailable")
            if time.monotonic() >= generation_effect_deadline:
                raise RuntimeError(
                    "Generation Output was not written to its Node"
                )
            await asyncio.sleep(0.05)
        generation_final_revision = int(
            final_generation_canvas.get("revision", -1)
        )
        generation_output_urls = {
            str(item.get("url") or "") for item in generation_outputs
        }
        public_history = await asyncio.to_thread(
            _json_list_request,
            admin,
            base_url,
            "/api/history?type=online",
        )
        generation_logs = [
            item
            for item in public_history
            if isinstance(item, dict)
            and str(item.get("provider_id") or "")
            == "baseline-deterministic"
            and (
                {
                    str(value or "")
                    for value in item.get("images") or []
                    if str(value or "")
                }
                <= generation_output_urls
            )
            and any(str(value or "") for value in item.get("images") or [])
        ]
        logged_generation_output_urls = {
            str(value or "")
            for item in generation_logs
            for value in item.get("images") or []
            if str(value or "")
        }
        if (
            generation_final_revision
            != burst_recovery_revision + generation_run_target_count
        ):
            raise RuntimeError("Generation output did not advance Canvas Revision")
        if len(generation_outputs) != generation_run_target_count:
            raise RuntimeError("Generation Outputs were incomplete")
        if (
            len(generation_logs) != generation_run_target_count
            or logged_generation_output_urls != generation_output_urls
        ):
            raise RuntimeError("Generation final log was not publicly readable")
        generation_log_status = "success"

        if phase_plan is not None:
            record_server_resource_sample("burst_complete")

        await asyncio.gather(
            *(connection.close() for connection in connections),
        )
        connections.clear()
        for client_id, cookie_jar in client_sessions:
            connection = await connect(client_id, cookie_jar)
            connections.append(connection)
            snapshot = await _receive_websocket_object(connection)
            if snapshot.get("type") != "canvas_snapshot" or int(
                snapshot.get("revision", -1)
            ) != generation_final_revision:
                raise RuntimeError(
                    f"{client_id} slow-client phase started at an unexpected Revision"
                )

        if recovery_observation_duration_seconds:
            phase_progress["active_phase"] = "recovery"
            phase_progress["completed_phase_names"] = [
                "warmup",
                "steady",
                "burst",
            ]
            recovery_started_ns = time.perf_counter_ns()
            record_metric(
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "client": "phase-controller",
                    "operation": "phase_recovery_started",
                    "status": "started",
                    "ack_latency_ms": 0,
                    "revision": generation_final_revision,
                }
            )

            async def recovery_heartbeat(operation: str) -> int:
                heartbeat_started_ns = time.perf_counter_ns()
                await connections[0].send(
                    json.dumps(
                        {"type": "ping", "canvas_id": canvas_id},
                        ensure_ascii=False,
                    )
                )
                response = await _receive_websocket_object(connections[0])
                heartbeat_acknowledged_ns = time.perf_counter_ns()
                revision = int(response.get("revision", -1))
                if response.get("type") != "pong":
                    raise RuntimeError("recovery heartbeat did not receive pong")
                record_metric(
                    {
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "client": client_sessions[0][0],
                        "operation": operation,
                        "status": "pong",
                        "ack_latency_ms": round(
                            (
                                heartbeat_acknowledged_ns
                                - heartbeat_started_ns
                            )
                            / 1_000_000,
                            3,
                        ),
                        "revision": revision,
                    }
                )
                return revision

            recovery_revision_before = await recovery_heartbeat(
                "recovery_heartbeat_start"
            )
            (
                recovery_event_loop_sequence,
                _interval_ms,
                _retention_capacity,
                _oldest_sequence,
                _samples,
            ) = (
                await event_loop_lag_snapshot(0)
            )
            recovery_runtime_status_task = create_tracked_task(
                sample_runtime_status(
                    "recovery",
                    sample_count=(
                        recovery_observation_duration_seconds * 5
                    ),
                    on_sample=record_metric,
                )
            )
            await asyncio.sleep(recovery_observation_duration_seconds)
            await recovery_runtime_status_task
            record_metrics(
                await capture_event_loop_lag(
                    "recovery",
                    recovery_event_loop_sequence,
                )
            )
            recovery_revision_after = await recovery_heartbeat(
                "recovery_heartbeat_end"
            )
            recovery_observation_elapsed_ms = round(
                (time.perf_counter_ns() - recovery_started_ns) / 1_000_000,
                3,
            )
            record_metric(
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "client": "phase-controller",
                    "operation": "phase_recovery_complete",
                    "status": "completed",
                    "ack_latency_ms": recovery_observation_elapsed_ms,
                    "revision": recovery_revision_after,
                }
            )
            phase_progress["completed_phase_names"] = list(
                executed_phase_names[:-1]
            )
            phase_progress["active_phase"] = ""
            record_server_resource_sample("recovery_complete")

        slow_client_revision_before = generation_final_revision
        slow_client_id = f"{client_sessions[0][0]}-slow"
        slow_query_client_id = urllib.parse.quote(slow_client_id, safe="")
        slow_connection = await websockets.connect(
            f"ws://{host}:{port}/ws/canvases/{canvas_id}"
            f"?layout_gap={LAYOUT_GAP}&client_id={slow_query_client_id}",
            additional_headers={
                "Cookie": _cookie_header(client_sessions[0][1])
            },
            proxy=None,
            open_timeout=5,
            close_timeout=2,
            max_size=PERFORMANCE_WEBSOCKET_MAX_SIZE,
            max_queue=1,
            compression=None,
        )
        slow_snapshot = await _receive_websocket_object(slow_connection)
        if slow_snapshot.get("type") != "canvas_snapshot" or int(
            slow_snapshot.get("revision", -1)
        ) != slow_client_revision_before:
            raise RuntimeError("slow client did not start from the current Revision")
        slow_transport = slow_connection.transport
        slow_socket = slow_transport.get_extra_info("socket")
        if slow_socket is None:
            raise RuntimeError("slow client socket was unavailable")
        slow_socket.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
        slow_transport.pause_reading()
        slow_transport_paused = True

        slow_pressure_count = 8
        slow_pressure_operation_ids = [
            f"{client_sessions[0][0]}:slow-pressure-{index + 1:02d}"
            for index in range(slow_pressure_count)
        ]

        async def receive_slow_pressure(
            client_id: str,
            connection: object,
        ) -> tuple[str, list[tuple[dict[str, object], int]]]:
            received: list[tuple[dict[str, object], int]] = []
            for _sample_index in range(slow_pressure_count):
                message = await _receive_websocket_object(connection)
                received.append((message, time.perf_counter_ns()))
            return client_id, received

        slow_pressure_receive_tasks = [
            create_tracked_task(
                receive_slow_pressure(client_id, connection)
            )
            for (client_id, _cookie_jar), connection in zip(
                client_sessions,
                connections,
                strict=True,
            )
        ]
        slow_pressure_send_started: dict[str, int] = {}
        slow_pressure_payload = "s" * 4_000_000
        for sample_index, operation_id in enumerate(
            slow_pressure_operation_ids
        ):
            slow_pressure_send_started[operation_id] = time.perf_counter_ns()
            await connections[0].send(
                json.dumps(
                    {
                        "type": "canvas_mutation",
                        "canvas_id": canvas_id,
                        "operation": {
                            "operation_id": operation_id,
                            "base_revision": slow_client_revision_before,
                            "changes": {
                                "node_updates": [
                                    {
                                        "id": "performance-node-01",
                                        "path": ["slowClientPressure"],
                                        "value": (
                                            f"{sample_index}:"
                                            + slow_pressure_payload
                                        ),
                                    }
                                ]
                            },
                        },
                    },
                    ensure_ascii=False,
                )
            )

        slow_pressure_received = dict(
            await asyncio.gather(*slow_pressure_receive_tasks)
        )
        expected_slow_pressure_revisions = list(
            range(
                slow_client_revision_before + 1,
                slow_client_revision_before + slow_pressure_count + 1,
            )
        )
        for client_id, received in slow_pressure_received.items():
            messages = [message for message, _received_ns in received]
            if any(
                message.get("type") != "canvas_mutation"
                for message in messages
            ):
                raise RuntimeError(
                    f"{client_id} missed a Mutation while slow client lagged"
                )
            if [int(message.get("revision", -1)) for message in messages] != (
                expected_slow_pressure_revisions
            ):
                raise RuntimeError(
                    f"{client_id} observed a Revision gap while slow client lagged"
                )

        slow_pressure_metrics: list[dict[str, object]] = []
        sender_pressure_receipts = slow_pressure_received[
            client_sessions[0][0]
        ]
        for operation_id in slow_pressure_operation_ids:
            message, acknowledged_ns = next(
                (message, received_ns)
                for message, received_ns in sender_pressure_receipts
                if str(message.get("operation_id") or "") == operation_id
            )
            slow_pressure_metrics.append(
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "client": client_sessions[0][0],
                    "operation": "slow_client_pressure",
                    "status": "acknowledged",
                    "ack_latency_ms": round(
                        (
                            acknowledged_ns
                            - slow_pressure_send_started[operation_id]
                        )
                        / 1_000_000,
                        3,
                    ),
                    "revision": int(message.get("revision", -1)),
                }
            )
        slow_pressure_metrics.sort(key=lambda metric: int(metric["revision"]))
        record_metrics(slow_pressure_metrics)

        slow_transport.resume_reading()
        slow_transport_paused = False
        slow_client_close_code = 0
        for _drain_index in range(slow_pressure_count + 2):
            try:
                await asyncio.wait_for(slow_connection.recv(), timeout=5)
            except websockets.ConnectionClosed as exc:
                slow_client_close_code = int(exc.code)
                break
        if slow_client_close_code != 4409:
            raise RuntimeError("slow client was not closed for projection resync")

        fast_probe_revision = expected_slow_pressure_revisions[-1] + 1
        fast_probe_receive_tasks = [
            create_tracked_task(_receive_websocket_object(connection))
            for connection in connections
        ]
        fast_probe_started_ns = time.perf_counter_ns()
        await connections[1].send(
            json.dumps(
                {
                    "type": "canvas_mutation",
                    "canvas_id": canvas_id,
                    "operation": {
                        "operation_id": "client-02:after-slow-probe",
                        "base_revision": expected_slow_pressure_revisions[-1],
                        "changes": {
                            "node_updates": [
                                {
                                    "id": "performance-node-02",
                                    "path": ["title"],
                                    "value": "Fast clients remain synchronized",
                                }
                            ]
                        },
                    },
                },
                ensure_ascii=False,
            )
        )
        fast_probe_messages = await asyncio.gather(*fast_probe_receive_tasks)
        fast_probe_acknowledged_ns = time.perf_counter_ns()
        if any(
            message.get("type") != "canvas_mutation"
            or int(message.get("revision", -1)) != fast_probe_revision
            for message in fast_probe_messages
        ):
            raise RuntimeError("fast clients did not continue after slow resync")
        slow_client_fast_probe_latency_ms = round(
            (fast_probe_acknowledged_ns - fast_probe_started_ns) / 1_000_000,
            3,
        )
        record_metric(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "client": client_sessions[1][0],
                "operation": "fast_after_slow_probe",
                "status": "acknowledged",
                "ack_latency_ms": slow_client_fast_probe_latency_ms,
                "revision": fast_probe_revision,
            }
        )

        heartbeat_revision_before = fast_probe_revision

        async def heartbeat(
            client_id: str,
            connection: object,
            *,
            operation: str = "heartbeat",
        ) -> dict[str, object]:
            started_ns = time.monotonic_ns()
            await connection.send(
                json.dumps(
                    {
                        "type": "ping",
                        "canvas_id": canvas_id,
                        "include_timing": True,
                    },
                    ensure_ascii=False,
                )
            )
            response = await _receive_websocket_object(connection)
            acknowledged_ns = time.monotonic_ns()
            if response.get("type") != "pong":
                raise RuntimeError(f"{client_id} heartbeat did not receive pong")
            revision = int(response.get("revision", -1))
            if revision != heartbeat_revision_before:
                raise RuntimeError(
                    f"{client_id} heartbeat changed Canvas Revision"
                )
            server_received_ns = int(
                response.get("server_received_monotonic_ns", -1)
            )
            server_responding_ns = int(
                response.get("server_responding_monotonic_ns", -1)
            )
            server_send_worker_started_ns = int(
                response.get("server_send_worker_started_monotonic_ns", -1)
            )
            if not (
                started_ns
                <= server_received_ns
                <= server_responding_ns
                <= server_send_worker_started_ns
                <= acknowledged_ns
            ):
                raise RuntimeError(
                    f"{client_id} heartbeat timing trace was not monotonic"
                )
            return {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "client": client_id,
                "operation": operation,
                "status": "pong",
                "ack_latency_ms": round(
                    (acknowledged_ns - started_ns) / 1_000_000,
                    3,
                ),
                "client_to_server_ms": round(
                    (server_received_ns - started_ns) / 1_000_000,
                    3,
                ),
                "server_handler_ms": round(
                    (server_responding_ns - server_received_ns) / 1_000_000,
                    3,
                ),
                "server_send_queue_ms": round(
                    (server_send_worker_started_ns - server_responding_ns)
                    / 1_000_000,
                    3,
                ),
                "server_after_send_worker_ms": round(
                    (acknowledged_ns - server_send_worker_started_ns)
                    / 1_000_000,
                    3,
                ),
                "server_to_client_ms": round(
                    (acknowledged_ns - server_responding_ns) / 1_000_000,
                    3,
                ),
                "revision": revision,
            }

        await asyncio.gather(
            *(connection.close() for connection in connections),
        )
        connections.clear()
        heartbeat_metrics = _run_isolated_heartbeats(
            host=host,
            port=port,
            canvas_id=canvas_id,
            client_sessions=client_sessions,
            expected_revision=heartbeat_revision_before,
        )
        record_metrics(heartbeat_metrics)
        heartbeat_revisions = {
            int(metric["revision"]) for metric in heartbeat_metrics
        }
        if heartbeat_revisions != {heartbeat_revision_before}:
            raise RuntimeError("heartbeat clients observed different Revisions")
        heartbeat_revision_after = heartbeat_revision_before

        for client_id, cookie_jar in client_sessions:
            connection = await connect(client_id, cookie_jar)
            connections.append(connection)
            snapshot = await _receive_websocket_object(connection)
            if snapshot.get("type") != "canvas_snapshot":
                raise RuntimeError(f"{client_id} did not receive a Canvas Snapshot")
            if int(snapshot.get("revision", -1)) != heartbeat_revision_before:
                raise RuntimeError(
                    f"{client_id} heartbeat control started at an unexpected Revision"
                )

        staggered_heartbeat_metrics = []
        for (client_id, _cookie_jar), connection in zip(
            client_sessions,
            connections,
            strict=True,
        ):
            staggered_heartbeat_metrics.append(
                await heartbeat(
                    client_id,
                    connection,
                    operation="heartbeat_staggered",
                )
            )
        record_metrics(staggered_heartbeat_metrics)

        await asyncio.gather(
            *(connection.close() for connection in connections[1:]),
        )
        single_heartbeat_metrics = []
        for _sample_index in range(10):
            single_heartbeat_metrics.append(
                await heartbeat(
                    client_sessions[0][0],
                    connections[0],
                    operation="heartbeat_single_connection",
                )
            )
        record_metrics(single_heartbeat_metrics)

        if full_browser_client_count:
            await asyncio.gather(
                *(connection.close() for connection in connections),
            )
            connections.clear()
            phase_progress["active_phase"] = "full_browser"
            phase_progress["completed_phase_names"] = list(
                executed_phase_names[:-1]
            )
            phase_progress["full_browser_trace_target_count"] = (
                full_browser_client_count
            )
            record_metric(
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "client": "phase-controller",
                    "operation": "phase_full_browser_started",
                    "status": "started",
                    "ack_latency_ms": 0,
                    "revision": heartbeat_revision_after,
                }
            )
            full_browser_result_lock = threading.Lock()

            def run_full_browser_trace(
                index: int,
                trace: Callable[[], dict[str, object]],
            ) -> tuple[int, dict[str, object]]:
                result = trace()
                with full_browser_result_lock:
                    phase_progress[
                        "full_browser_trace_completion_count"
                    ] = int(
                        phase_progress.get(
                            "full_browser_trace_completion_count",
                            0,
                        )
                        or 0
                    ) + 1
                    if result.get("browser_canvas_open_isolated_profile"):
                        phase_progress[
                            "full_browser_profile_removed_count"
                        ] = int(
                            phase_progress.get(
                                "full_browser_profile_removed_count",
                                0,
                            )
                            or 0
                        ) + 1
                return index, result

            async def await_full_browser_trace(
                index: int,
                trace: Callable[[], dict[str, object]],
            ) -> tuple[int, dict[str, object]]:
                await asyncio.sleep((index - 1) * 0.25)
                return await asyncio.to_thread(
                    run_full_browser_trace,
                    index,
                    trace,
                )

            full_browser_results_by_index: dict[int, dict[str, object]] = {}
            trace_tasks = [
                create_tracked_task(
                    await_full_browser_trace(index, trace)
                )
                for index, trace in enumerate(
                    full_browser_traces,
                    start=1,
                )
            ]
            for completed_trace in asyncio.as_completed(trace_tasks):
                index, result = await completed_trace
                full_browser_results_by_index[index] = result
                record_metric(
                    {
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "client": f"client-{index:02d}-browser",
                        "operation": "full_browser_first_operable",
                        "status": (
                            "accepted"
                            if result.get(
                                "browser_canvas_open_interaction_accepted"
                            )
                            else "failed"
                        ),
                        "ack_latency_ms": result.get(
                            "browser_canvas_open_first_operable_p95_ms",
                            0,
                        ),
                        "execution_unit": "browser",
                    }
                )
            full_browser_results = [
                full_browser_results_by_index[index]
                for index in range(1, full_browser_client_count + 1)
            ]
            record_metric(
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "client": "phase-controller",
                    "operation": "phase_full_browser_complete",
                    "status": "completed",
                    "ack_latency_ms": max(
                        (
                            float(
                                result.get(
                                    "browser_canvas_open_app_navigation_to_feedback_ms",
                                    0,
                                )
                                or 0
                            )
                            for result in full_browser_results
                        ),
                        default=0,
                    ),
                    "revision": heartbeat_revision_after,
                }
            )
            phase_progress["completed_phase_names"] = list(
                executed_phase_names
            )
            phase_progress["active_phase"] = ""

    finally:
        generation_provider.release()
        for task in background_tasks:
            if not task.done():
                task.cancel()
        if background_tasks:
            await asyncio.gather(*background_tasks, return_exceptions=True)
        phase_progress["async_receive_task_completion_count"] = len(
            background_tasks
        )
        if slow_transport_paused and slow_transport is not None:
            slow_transport.resume_reading()
        if slow_connection is not None:
            await slow_connection.close()
        await asyncio.gather(
            *(connection.close() for connection in connections),
            return_exceptions=True,
        )

    projection_digests: list[str] = []
    final_revision = -1
    final_node_count = -1
    for client_id, cookie_jar in client_sessions:
        connection = await connect(f"{client_id}-verify", cookie_jar)
        try:
            snapshot = await _receive_websocket_object(connection)
        finally:
            await connection.close()
        canvas = snapshot.get("canvas")
        if snapshot.get("type") != "canvas_snapshot" or not isinstance(canvas, dict):
            raise RuntimeError(f"{client_id} final Canvas projection was unavailable")
        projection = {
            "revision": snapshot.get("revision"),
            "nodes": canvas.get("nodes"),
            "connections": canvas.get("connections"),
            "logs": canvas.get("logs"),
        }
        projection_digests.append(
            hashlib.sha256(
                json.dumps(
                    projection,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest()
        )
        final_revision = int(snapshot.get("revision", -1))
        nodes = canvas.get("nodes")
        final_node_count = len(nodes) if isinstance(nodes, list) else -1

    concurrent_heartbeat_latencies = [
        float(metric["ack_latency_ms"])
        for metric in metrics
        if metric["operation"] == "heartbeat"
    ]
    heartbeat_end_to_end_p99_ms = sorted(concurrent_heartbeat_latencies)[
        math.ceil(len(concurrent_heartbeat_latencies) * 0.99) - 1
    ]
    heartbeat_server_latencies = [
        float(metric["server_handler_ms"])
        + float(metric["server_send_queue_ms"])
        for metric in metrics
        if metric["operation"] == "heartbeat"
    ]
    heartbeat_p99_ms = sorted(heartbeat_server_latencies)[
        math.ceil(len(heartbeat_server_latencies) * 0.99) - 1
    ]
    steady_mutation_latencies = [
        float(metric["ack_latency_ms"])
        for metric in metrics
        if metric["operation"] == "steady_node_move"
    ]
    steady_mutation_p95_ms = sorted(steady_mutation_latencies)[
        math.ceil(len(steady_mutation_latencies) * 0.95) - 1
    ]
    steady_mutation_p99_ms = sorted(steady_mutation_latencies)[
        math.ceil(len(steady_mutation_latencies) * 0.99) - 1
    ]
    burst_mutation_latencies = [
        float(metric["ack_latency_ms"])
        for metric in metrics
        if metric["operation"] == "burst_node_move"
    ]
    burst_mutation_p95_ms = sorted(burst_mutation_latencies)[
        math.ceil(len(burst_mutation_latencies) * 0.95) - 1
    ]
    burst_mutation_p99_ms = sorted(burst_mutation_latencies)[
        math.ceil(len(burst_mutation_latencies) * 0.99) - 1
    ]
    slow_client_pressure_latencies = [
        float(metric["ack_latency_ms"])
        for metric in metrics
        if metric["operation"] == "slow_client_pressure"
    ]
    slow_client_fast_pressure_p95_ms = sorted(
        slow_client_pressure_latencies
    )[math.ceil(len(slow_client_pressure_latencies) * 0.95) - 1]
    slow_client_fast_pressure_p99_ms = sorted(
        slow_client_pressure_latencies
    )[math.ceil(len(slow_client_pressure_latencies) * 0.99) - 1]
    staggered_heartbeat_latencies = [
        float(metric["ack_latency_ms"])
        for metric in metrics
        if metric["operation"] == "heartbeat_staggered"
    ]
    single_heartbeat_latencies = [
        float(metric["ack_latency_ms"])
        for metric in metrics
        if metric["operation"] == "heartbeat_single_connection"
    ]
    generation_metric_operations = (
        {"steady_node_move", "burst_node_move"}
        if generation_overlaps_steady
        else {"burst_node_move"}
    )
    generation_mutation_latencies = [
        float(metric["ack_latency_ms"])
        for metric in metrics
        if metric["operation"] in generation_metric_operations
    ]
    generation_mutation_p95_ms = sorted(generation_mutation_latencies)[
        math.ceil(len(generation_mutation_latencies) * 0.95) - 1
    ]
    generation_mutation_p99_ms = sorted(generation_mutation_latencies)[
        math.ceil(len(generation_mutation_latencies) * 0.99) - 1
    ]
    runtime_status_metrics = [
        metric
        for metric in metrics
        if str(metric["operation"]).startswith("runtime_status_")
    ]
    runtime_status_latencies = [
        float(metric["ack_latency_ms"])
        for metric in runtime_status_metrics
    ]
    runtime_status_p95_ms = sorted(runtime_status_latencies)[
        math.ceil(len(runtime_status_latencies) * 0.95) - 1
    ]
    observed_runtime_phase_names = ["steady", "burst"]
    if recovery_observation_duration_seconds:
        observed_runtime_phase_names.append("recovery")
    phase_duration_seconds = {
        "steady": steady_window_seconds,
        "burst": burst_window_seconds,
        "recovery": recovery_observation_duration_seconds,
    }
    expected_runtime_status_samples_by_phase = {
        phase: phase_duration_seconds[phase] * 5
        for phase in observed_runtime_phase_names
    }
    minimum_event_loop_samples_by_phase = {
        phase: min(
            phase_duration_seconds[phase] * 50,
            max(0, event_loop_lag_retention_capacity),
        )
        for phase in observed_runtime_phase_names
    }
    runtime_status_samples_by_phase = {
        phase: sum(
            metric["operation"] == f"runtime_status_{phase}"
            for metric in runtime_status_metrics
        )
        for phase in observed_runtime_phase_names
    }
    runtime_status_timeout_count = sum(
        metric["status"] == "timeout" for metric in runtime_status_metrics
    )
    runtime_status_failure_count = sum(
        metric["status"] not in {"ready", "timeout"}
        for metric in runtime_status_metrics
    )
    event_loop_lag_metrics = [
        metric
        for metric in metrics
        if str(metric["operation"]).startswith("event_loop_lag_")
    ]
    event_loop_lag_latencies = [
        float(metric["ack_latency_ms"])
        for metric in event_loop_lag_metrics
    ]
    event_loop_lag_p99_ms = sorted(event_loop_lag_latencies)[
        math.ceil(len(event_loop_lag_latencies) * 0.99) - 1
    ]
    recovery_runtime_status_metrics = [
        metric
        for metric in runtime_status_metrics
        if metric["operation"] == "runtime_status_recovery"
    ]
    recovery_runtime_status_latencies = [
        float(metric["ack_latency_ms"])
        for metric in recovery_runtime_status_metrics
    ]
    recovery_runtime_status_p95_ms = (
        sorted(recovery_runtime_status_latencies)[
            math.ceil(len(recovery_runtime_status_latencies) * 0.95) - 1
        ]
        if recovery_runtime_status_latencies
        else 0.0
    )
    recovery_runtime_status_timeout_count = sum(
        metric["status"] == "timeout"
        for metric in recovery_runtime_status_metrics
    )
    recovery_runtime_status_failure_count = sum(
        metric["status"] not in {"ready", "timeout"}
        for metric in recovery_runtime_status_metrics
    )
    recovery_event_loop_lag_metrics = [
        metric
        for metric in event_loop_lag_metrics
        if metric["operation"] == "event_loop_lag_recovery"
    ]
    recovery_event_loop_lag_latencies = [
        float(metric["ack_latency_ms"])
        for metric in recovery_event_loop_lag_metrics
    ]
    recovery_event_loop_lag_p99_ms = (
        sorted(recovery_event_loop_lag_latencies)[
            math.ceil(len(recovery_event_loop_lag_latencies) * 0.99) - 1
        ]
        if recovery_event_loop_lag_latencies
        else 0.0
    )
    recovery_revision_unchanged = (
        recovery_revision_before == recovery_revision_after
        and recovery_revision_before == generation_final_revision
    )
    recovery_observation_gate_passed = (
        not recovery_observation_duration_seconds
        or (
            len(recovery_runtime_status_metrics)
            == recovery_observation_duration_seconds * 5
            and recovery_runtime_status_timeout_count == 0
            and recovery_runtime_status_failure_count == 0
            and recovery_runtime_status_p95_ms <= 50
            and len(recovery_event_loop_lag_metrics)
            >= recovery_observation_duration_seconds * 50
            and recovery_event_loop_lag_p99_ms <= 50
            and recovery_revision_unchanged
        )
    )
    full_browser_first_operable_samples = [
        float(
            result.get("browser_canvas_open_first_operable_p95_ms", 0)
            or 0
        )
        for result in full_browser_results
        if int(
            result.get("browser_canvas_open_first_operable_sample_count", 0)
            or 0
        )
    ]
    full_browser_first_operable_p95_ms = (
        sorted(full_browser_first_operable_samples)[
            math.ceil(len(full_browser_first_operable_samples) * 0.95) - 1
        ]
        if full_browser_first_operable_samples
        else 0.0
    )
    full_browser_isolated_profile_count = sum(
        bool(result.get("browser_canvas_open_isolated_profile"))
        for result in full_browser_results
    )
    full_browser_interaction_accepted_count = sum(
        bool(result.get("browser_canvas_open_interaction_accepted"))
        for result in full_browser_results
    )
    full_browser_interaction_restored_count = sum(
        bool(result.get("browser_canvas_open_interaction_restored"))
        for result in full_browser_results
    )
    full_browser_console_error_count = sum(
        int(result.get("browser_canvas_open_console_error_count", 0) or 0)
        for result in full_browser_results
    )
    full_browser_page_error_count = sum(
        int(result.get("browser_canvas_open_page_error_count", 0) or 0)
        for result in full_browser_results
    )
    full_browser_unhandled_rejection_count = sum(
        int(
            result.get(
                "browser_canvas_open_unhandled_rejection_count",
                0,
            )
            or 0
        )
        for result in full_browser_results
    )
    full_browser_first_operable_gate_enforced = any(
        bool(
            result.get(
                "browser_canvas_open_first_operable_gate_enforced"
            )
        )
        for result in full_browser_results
    )
    full_browser_gate_failure_counts: dict[str, int] = {}
    for result in full_browser_results:
        for failure in result.get("browser_canvas_open_gate_failures") or []:
            failure_name = str(failure)
            full_browser_gate_failure_counts[failure_name] = (
                full_browser_gate_failure_counts.get(failure_name, 0) + 1
            )
    full_browser_timing_failure_names = {
        "first_operable_p95_exceeded",
        "long_task_exceeded",
    }
    full_browser_correctness_failure_count = sum(
        count
        for name, count in full_browser_gate_failure_counts.items()
        if name not in full_browser_timing_failure_names
    )
    full_browser_gate_passed = (
        not full_browser_client_count
        or (
            len(full_browser_results) == full_browser_client_count
            and len(full_browser_first_operable_samples)
            == full_browser_client_count
            and full_browser_isolated_profile_count
            == full_browser_client_count
            and full_browser_interaction_accepted_count
            == full_browser_client_count
            and full_browser_interaction_restored_count
            == full_browser_client_count
            and full_browser_console_error_count == 0
            and full_browser_page_error_count == 0
            and full_browser_unhandled_rejection_count == 0
            and full_browser_correctness_failure_count == 0
        )
    )
    server_rss_values = [
        int(sample["rss_bytes"])
        for sample in server_resource_samples
    ]
    server_rss_baseline_bytes = (
        server_rss_values[0] if server_rss_values else 0
    )
    server_rss_peak_bytes = max(server_rss_values, default=0)
    workload_rss_values = [
        int(sample["rss_bytes"])
        for sample in server_resource_samples
        if sample["phase_boundary"]
        in {"steady_start", "steady_complete", "burst_complete"}
    ]
    server_rss_workload_peak_bytes = max(workload_rss_values, default=0)
    burst_complete_rss_bytes = next(
        (
            int(sample["rss_bytes"])
            for sample in server_resource_samples
            if sample["phase_boundary"] == "burst_complete"
        ),
        server_rss_values[-1] if server_rss_values else 0,
    )
    server_rss_workload_growth_bytes = (
        max(
            0,
            server_rss_workload_peak_bytes - server_rss_baseline_bytes,
        )
        if server_rss_values
        else 0
    )
    server_rss_growth_bytes = (
        max(0, server_rss_values[-1] - burst_complete_rss_bytes)
        if server_rss_values
        else 0
    )
    server_rss_growth_gate_bytes = 128 * 1024 * 1024
    phase_progress["completed_phase_names"] = list(executed_phase_names)
    phase_progress["active_phase"] = ""
    return {
        **browser_settings_result,
        **browser_canvas_open_result,
        "executed_phase_names": executed_phase_names,
        "warmup_duration_seconds": warmup_duration_seconds,
        "warmup_elapsed_ms": warmup_elapsed_ms,
        "representative_canvas_target_bytes": (
            REPRESENTATIVE_CANVAS_TARGET_BYTES
        ),
        "representative_canvas_payload_bytes": (
            representative_canvas_payload_bytes
        ),
        "representative_canvas_node_count": representative_canvas_node_count,
        "mutation_client_count": len(client_sessions),
        "mutation_sample_count": sum(
            metric["operation"] == "node_create" for metric in metrics
        ),
        "permanent_failure_count": 0,
        "confirmed_revisions": confirmed_revisions,
        "final_revision": final_revision,
        "final_node_count": final_node_count,
        "final_projection_client_count": len(projection_digests),
        "final_projections_consistent": len(set(projection_digests)) == 1,
        "steady_mutation_target_rate_per_second": steady_target_rate,
        "steady_mutation_window_seconds": steady_window_seconds,
        "steady_mutation_client_count": len(client_sessions),
        "steady_mutation_sample_count": len(steady_mutation_latencies),
        "steady_mutation_delivery_retention_policy": "sender_ack_only",
        "steady_mutation_validated_delivery_count": (
            steady_validated_delivery_count
        ),
        "steady_mutation_retained_ack_count": sum(
            len(receipts) for receipts in steady_sender_receipts.values()
        ),
        "steady_mutation_permanent_failure_count": 0,
        "steady_mutation_confirmed_revisions": [
            int(metric["revision"])
            for metric in metrics
            if metric["operation"] == "steady_node_move"
        ],
        "steady_mutation_send_window_ms": steady_send_window_ms,
        "steady_mutation_p95_ms": steady_mutation_p95_ms,
        "steady_mutation_p99_ms": steady_mutation_p99_ms,
        "steady_mutation_gate_passed": (
            steady_send_window_ms <= steady_window_seconds * 1000
            and steady_mutation_p95_ms <= 150
            and steady_mutation_p99_ms <= 300
        ),
        "burst_mutation_target_rate_per_second": burst_target_rate,
        "burst_mutation_window_seconds": burst_window_seconds,
        "burst_mutation_client_count": len(client_sessions),
        "burst_mutation_sample_count": len(burst_mutation_latencies),
        "burst_mutation_delivery_retention_policy": "sender_ack_only",
        "burst_mutation_validated_delivery_count": (
            burst_validated_delivery_count
        ),
        "burst_mutation_retained_ack_count": sum(
            len(receipts) for receipts in burst_sender_receipts.values()
        ),
        "burst_mutation_permanent_failure_count": 0,
        "burst_mutation_confirmed_revisions": [
            int(metric["revision"])
            for metric in metrics
            if metric["operation"] == "burst_node_move"
        ],
        "burst_mutation_send_window_ms": burst_send_window_ms,
        "burst_mutation_p95_ms": burst_mutation_p95_ms,
        "burst_mutation_p99_ms": burst_mutation_p99_ms,
        "burst_recovery_revision": burst_recovery_revision,
        "browser_canvas_open_background_mutation_count": (
            browser_background_mutation_count
        ),
        "burst_recovery_ms": burst_recovery_ms,
        "burst_queue_recovered": (
            burst_recovery_ms <= recovery_gate_seconds * 1000
        ),
        "burst_mutation_gate_passed": (
            burst_send_window_ms <= burst_window_seconds * 1000
            and burst_mutation_p95_ms <= 150
            and burst_mutation_p99_ms <= 300
            and burst_recovery_ms <= recovery_gate_seconds * 1000
        ),
        "recovery_observation_executed": bool(
            recovery_observation_duration_seconds
        ),
        "recovery_observation_duration_seconds": (
            recovery_observation_duration_seconds
        ),
        "recovery_observation_elapsed_ms": recovery_observation_elapsed_ms,
        "recovery_revision_before": recovery_revision_before,
        "recovery_revision_after": recovery_revision_after,
        "recovery_revision_unchanged": recovery_revision_unchanged,
        "recovery_runtime_status_sample_count": len(
            recovery_runtime_status_metrics
        ),
        "recovery_runtime_status_timeout_count": (
            recovery_runtime_status_timeout_count
        ),
        "recovery_runtime_status_failure_count": (
            recovery_runtime_status_failure_count
        ),
        "recovery_runtime_status_p95_ms": recovery_runtime_status_p95_ms,
        "recovery_event_loop_lag_sample_count": len(
            recovery_event_loop_lag_metrics
        ),
        "recovery_event_loop_lag_p99_ms": recovery_event_loop_lag_p99_ms,
        "recovery_observation_gate_passed": (
            recovery_observation_gate_passed
        ),
        "full_browser_executed": bool(full_browser_client_count),
        "full_browser_start_stagger_ms": (
            250 if full_browser_client_count else 0
        ),
        "full_browser_client_count": full_browser_client_count,
        "full_browser_lightweight_client_count": (
            full_browser_lightweight_client_count
        ),
        "full_browser_distinct_session_count": (
            len({client_id for client_id, _cookie_jar in client_sessions})
            if full_browser_client_count
            else 0
        ),
        "full_browser_isolated_profile_count": (
            full_browser_isolated_profile_count
        ),
        "full_browser_first_operable_sample_count": len(
            full_browser_first_operable_samples
        ),
        "full_browser_first_operable_p95_ms": (
            full_browser_first_operable_p95_ms
        ),
        "full_browser_first_operable_gate_enforced": (
            full_browser_first_operable_gate_enforced
        ),
        "full_browser_first_operable_informational": bool(
            full_browser_results
        ) and not full_browser_first_operable_gate_enforced,
        "full_browser_timing_informational": bool(full_browser_results),
        "full_browser_first_operable_reference_ms": 1_000,
        "full_browser_gate_failure_counts": (
            full_browser_gate_failure_counts
        ),
        "full_browser_interaction_accepted_count": (
            full_browser_interaction_accepted_count
        ),
        "full_browser_interaction_restored_count": (
            full_browser_interaction_restored_count
        ),
        "full_browser_console_error_count": full_browser_console_error_count,
        "full_browser_page_error_count": full_browser_page_error_count,
        "full_browser_unhandled_rejection_count": (
            full_browser_unhandled_rejection_count
        ),
        "full_browser_gate_passed": full_browser_gate_passed,
        "server_resource_samples": server_resource_samples,
        "server_resource_sample_count": len(server_resource_samples),
        "server_rss_baseline_bytes": server_rss_baseline_bytes,
        "server_rss_peak_bytes": server_rss_peak_bytes,
        "server_rss_workload_peak_bytes": (
            server_rss_workload_peak_bytes
        ),
        "server_rss_workload_growth_bytes": (
            server_rss_workload_growth_bytes
        ),
        "server_rss_growth_bytes": server_rss_growth_bytes,
        "server_rss_growth_gate_bytes": server_rss_growth_gate_bytes,
        "server_resource_growth_gate_passed": (
            not server_resource_samples
            or server_rss_growth_bytes <= server_rss_growth_gate_bytes
        ),
        "slow_client_count": 1,
        "slow_client_fast_client_count": len(client_sessions),
        "slow_client_pressure_sample_count": len(
            slow_client_pressure_latencies
        ),
        "slow_client_fast_failure_count": 0,
        "slow_client_close_code": slow_client_close_code,
        "slow_client_resync_required": slow_client_close_code == 4409,
        "slow_client_revision_before": slow_client_revision_before,
        "slow_client_fast_probe_revision": fast_probe_revision,
        "slow_client_fast_pressure_p95_ms": (
            slow_client_fast_pressure_p95_ms
        ),
        "slow_client_fast_pressure_p99_ms": (
            slow_client_fast_pressure_p99_ms
        ),
        "slow_client_fast_probe_latency_ms": (
            slow_client_fast_probe_latency_ms
        ),
        "slow_client_isolated": (
            slow_client_close_code == 4409
            and fast_probe_revision == heartbeat_revision_before
        ),
        "slow_client_gate_passed": (
            slow_client_close_code == 4409
            and fast_probe_revision == heartbeat_revision_before
        ),
        "generation_run_count": len(generation_task_ids),
        "generation_succeeded_run_count": sum(
            status == "succeeded" for status in generation_statuses
        ),
        "generation_provider_request_count": generation_provider.request_count,
        "generation_provider_peak_in_flight_count": (
            generation_provider.peak_in_flight_count
        ),
        "generation_overlap_phase": (
            "steady_to_burst" if generation_overlaps_steady else "burst"
        ),
        "generation_overlap_phases": (
            ["steady", "burst"]
            if generation_overlaps_steady
            else ["burst"]
        ),
        "generation_separate_mutation_window": False,
        "generation_mutation_metric_source": (
            "steady_node_move+burst_node_move"
            if generation_overlaps_steady
            else "burst_node_move"
        ),
        "generation_status": generation_status,
        "generation_output_count": len(generation_outputs),
        "generation_output_written_back": (
            len(generation_outputs) == generation_run_target_count
        ),
        "generation_log_count": len(generation_logs),
        "generation_log_status": generation_log_status,
        "generation_revision_before": generation_revision_before,
        "generation_target_revisions": generation_target_revisions,
        "generation_final_revision": generation_final_revision,
        "generation_revisions_continuous": (
            generation_target_revisions
            == list(
                range(
                    generation_revision_before + 1,
                    generation_revision_before
                    + generation_run_target_count
                    + 1,
                )
            )
            and (
                (
                    expected_steady_revisions[0]
                    == generation_target_revision + 1
                    and expected_burst_revisions[0]
                    == expected_steady_revisions[-1] + 1
                )
                if generation_overlaps_steady
                else expected_burst_revisions[0]
                == generation_target_revision + 1
            )
            and generation_final_revision
            == burst_recovery_revision + generation_run_target_count
        ),
        "generation_mutation_target_rate_per_second": generation_target_rate,
        "generation_mutation_window_seconds": generation_window_seconds,
        "generation_mutation_client_count": len(client_sessions),
        "generation_mutation_sample_count": len(
            generation_mutation_latencies
        ),
        "generation_mutation_delivery_retention_policy": "sender_ack_only",
        "generation_mutation_validated_delivery_count": (
            generation_validated_delivery_count
        ),
        "generation_mutation_retained_ack_count": sum(
            len(receipts)
            for receipts in generation_sender_receipts.values()
        ),
        "generation_mutation_permanent_failure_count": 0,
        "generation_mutation_confirmed_revisions": [
            int(metric["revision"])
            for metric in metrics
            if metric["operation"] in generation_metric_operations
        ],
        "generation_mutation_send_window_ms": generation_send_window_ms,
        "generation_mutation_p95_ms": generation_mutation_p95_ms,
        "generation_mutation_p99_ms": generation_mutation_p99_ms,
        "generation_mutation_gate_passed": (
            generation_send_window_ms <= generation_window_seconds * 1000
            and len(generation_mutation_latencies)
            == generation_operation_count
            and len(generation_outputs) == generation_run_target_count
            and len(generation_logs) == generation_run_target_count
            and generation_final_revision
            == burst_recovery_revision + generation_run_target_count
        ),
        "generation_final_projection_client_count": len(projection_digests),
        "generation_final_projections_consistent": (
            len(set(projection_digests)) == 1
        ),
        "runtime_status_sample_count": len(runtime_status_metrics),
        "runtime_status_samples_by_phase": runtime_status_samples_by_phase,
        "runtime_status_timeout_count": runtime_status_timeout_count,
        "runtime_status_failure_count": runtime_status_failure_count,
        "runtime_status_p95_ms": runtime_status_p95_ms,
        "runtime_status_p95_gate_ms": 50,
        "runtime_status_gate_passed": (
            runtime_status_samples_by_phase
            == expected_runtime_status_samples_by_phase
            and runtime_status_timeout_count == 0
            and runtime_status_failure_count == 0
            and runtime_status_p95_ms <= 50
        ),
        "event_loop_lag_probe_interval_ms": (
            event_loop_lag_probe_interval_ms
        ),
        "event_loop_lag_retention_capacity": (
            event_loop_lag_retention_capacity
        ),
        "event_loop_lag_minimum_samples_by_phase": (
            minimum_event_loop_samples_by_phase
        ),
        "event_loop_lag_truncated_phases": sorted(
            set(event_loop_lag_truncated_phases)
        ),
        "event_loop_lag_sample_count": len(event_loop_lag_metrics),
        "event_loop_lag_samples_by_phase": (
            event_loop_lag_samples_by_phase
        ),
        "event_loop_lag_p99_ms": event_loop_lag_p99_ms,
        "event_loop_lag_p99_gate_ms": 50,
        "event_loop_lag_gate_passed": (
            event_loop_lag_probe_interval_ms == 10
            and event_loop_lag_retention_capacity > 0
            and set(event_loop_lag_samples_by_phase)
            == set(observed_runtime_phase_names)
            and all(
                event_loop_lag_samples_by_phase.get(phase, 0)
                >= minimum_event_loop_samples_by_phase[phase]
                for phase in observed_runtime_phase_names
            )
            and event_loop_lag_p99_ms <= 50
        ),
        "heartbeat_client_count": len(client_sessions),
        "heartbeat_sample_count": sum(
            metric["operation"] == "heartbeat" for metric in metrics
        ),
        "heartbeat_failure_count": 0,
        "heartbeat_revision_before": heartbeat_revision_before,
        "heartbeat_revision_after": heartbeat_revision_after,
        "heartbeat_revision_unchanged": (
            heartbeat_revision_before == heartbeat_revision_after
        ),
        "heartbeat_execution_unit_type": "process",
        "heartbeat_execution_unit_count": len(
            {
                str(metric["execution_unit"])
                for metric in metrics
                if metric["operation"] == "heartbeat"
            }
        ),
        "heartbeat_p99_ms": heartbeat_p99_ms,
        "heartbeat_p99_gate_scope": (
            "server_received_to_send_worker_started"
        ),
        "heartbeat_p99_gate_ms": 10,
        "heartbeat_p99_passed": heartbeat_p99_ms <= 10,
        "heartbeat_end_to_end_p99_ms": heartbeat_end_to_end_p99_ms,
        "heartbeat_end_to_end_max_ms": max(concurrent_heartbeat_latencies),
        "heartbeat_concurrent_median_ms": statistics.median(
            concurrent_heartbeat_latencies
        ),
        "heartbeat_concurrent_max_ms": max(concurrent_heartbeat_latencies),
        "heartbeat_staggered_client_count": len(client_sessions),
        "heartbeat_staggered_sample_count": len(staggered_heartbeat_latencies),
        "heartbeat_staggered_failure_count": 0,
        "heartbeat_staggered_revision_before": heartbeat_revision_before,
        "heartbeat_staggered_revision_after": heartbeat_revision_after,
        "heartbeat_staggered_revision_unchanged": (
            heartbeat_revision_before == heartbeat_revision_after
        ),
        "heartbeat_staggered_median_ms": statistics.median(
            staggered_heartbeat_latencies
        ),
        "heartbeat_staggered_max_ms": max(staggered_heartbeat_latencies),
        "heartbeat_single_connection_client_count": 1,
        "heartbeat_single_connection_sample_count": len(
            single_heartbeat_latencies
        ),
        "heartbeat_single_connection_failure_count": 0,
        "heartbeat_single_connection_revision_before": (
            heartbeat_revision_before
        ),
        "heartbeat_single_connection_revision_after": heartbeat_revision_after,
        "heartbeat_single_connection_revision_unchanged": (
            heartbeat_revision_before == heartbeat_revision_after
        ),
        "heartbeat_single_connection_median_ms": statistics.median(
            single_heartbeat_latencies
        ),
        "heartbeat_single_connection_max_ms": max(single_heartbeat_latencies),
        "metrics": metrics,
    }


def _run_lifecycle_smoke(
    arguments: argparse.Namespace,
    report_directory: Path,
    *,
    host: str,
    browser_dependencies: tuple[str, Path],
    metrics_writer: _MetricsWriter,
    suite_plan: dict[str, object],
    summary_metadata: dict[str, object] | None = None,
) -> tuple[dict[str, object], dict[str, object]]:
    runtime_state = report_directory / "runtime-state"
    instance_state = report_directory / "instance-state"
    cache_state = report_directory / "cache-state"
    runtime_state.mkdir()
    environment = os.environ.copy()
    environment.update(
        {
            "INFINITE_CANVAS_PROJECT_DIR": str(PROJECT_ROOT),
            "INFINITE_CANVAS_STATE_DIR": str(runtime_state),
            "INFINITE_CANVAS_INSTANCE_STATE_DIR": str(instance_state),
            "INFINITE_CANVAS_CACHE_DIR": str(cache_state),
            "INFINITE_CANVAS_HOST": host,
            "INFINITE_CANVAS_PORT": str(arguments.port),
        }
    )
    log_path = report_directory / "server.log"
    base_url = f"http://{host}:{arguments.port}"
    server_log = log_path.open("wb")

    def start_service() -> subprocess.Popen[bytes]:
        return subprocess.Popen(
            [
                sys.executable,
                "-m",
                "infinite_canvas",
            ],
            cwd=BACKEND_ROOT,
            env=environment,
            stdout=server_log,
            stderr=subprocess.STDOUT,
        )

    process = start_service()
    admin_cookie_jar = http.cookiejar.CookieJar()
    admin = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(admin_cookie_jar)
    )
    designer_openers: list[urllib.request.OpenerDirector] = []
    designer_cookie_jars: list[http.cookiejar.CookieJar] = []
    designer_ids: list[str] = []
    admin_created = False
    project_grant_count = 0
    designer_canvas_visibility_count = 0
    canvas_id = ""
    canvas_purged = False
    sessions_removed = False
    accounts_removed = False
    mutation_result: dict[str, object] = {}
    scenario_failure_type = ""
    scenario_failure_message = ""
    scenario_failure_gate = ""
    scenario_failure_phase = ""
    phase_progress: dict[str, object] = {
        "active_phase": "",
        "completed_phase_names": [],
        "async_receive_task_target_count": 0,
        "async_receive_task_completion_count": 0,
        "full_browser_trace_target_count": 0,
        "full_browser_trace_completion_count": 0,
        "full_browser_profile_removed_count": 0,
    }
    generation_overlap_duration_seconds = sum(
        int(phase.get("duration_seconds") or 0)
        for phase in suite_plan.get("phases") or []
        if isinstance(phase, dict)
        and phase.get("generation_runs_active")
    )
    generation_provider_wait_timeout_seconds = max(
        600,
        generation_overlap_duration_seconds + 60,
    )
    generation_provider = _DeterministicImageProvider(
        response_wait_timeout_seconds=(
            generation_provider_wait_timeout_seconds
        )
    )
    original_providers: list[dict[str, object]] = []
    generated_media_before: set[str] = set()
    generated_media_created: list[str] = []
    generation_media_removed_count = 0
    generation_media_purged = False
    provider_settings_restored = False
    admin_password = "baseline-admin-password"
    designer_password = "baseline-designer-password"
    run_suffix = f"{arguments.seed:x}"[-8:]
    try:
        _wait_for_service(base_url, process)
        _json_request(
            admin,
            base_url,
            "/api/setup",
            method="POST",
            payload={
                "username": f"perf_admin_{run_suffix}",
                "display_name": "Performance Admin",
                "password": admin_password,
                "workspace_directory": str(arguments.workspace.resolve()),
            },
        )
        admin_created = True
        _stop_service(process)
        process = start_service()
        _wait_for_runtime_ready(base_url, process)
        providers_payload = _json_request(admin, base_url, "/api/providers")
        providers = providers_payload.get("providers")
        if not isinstance(providers, list):
            raise RuntimeError("provider settings response omitted providers")
        original_providers = [
            dict(provider)
            for provider in providers
            if isinstance(provider, dict)
        ]
        generated_payload = _json_request(
            admin,
            base_url,
            "/api/storage-files?kind=generated&limit=200",
        )
        generated_media_before = {
            str(item.get("rel") or "")
            for item in generated_payload.get("items") or []
            if isinstance(item, dict) and str(item.get("rel") or "")
        }
        _json_request(
            admin,
            base_url,
            "/api/providers",
            method="PUT",
            payload=[
                {
                    "id": "baseline-deterministic",
                    "name": "Baseline Deterministic Provider",
                    "base_url": generation_provider.base_url,
                    "protocol": "openai",
                    "image_request_mode": "openai",
                    "enabled": True,
                    "primary": True,
                    "image_models": ["baseline-image-v1"],
                    "api_key": "baseline-local-provider-key",
                }
            ],
        )
        projects_payload = _json_request(admin, base_url, "/api/projects")
        projects = projects_payload.get("projects")
        if not isinstance(projects, list) or not projects:
            raise RuntimeError("Workspace did not expose a default Project")
        default_project = next(
            (
                project
                for project in projects
                if isinstance(project, dict)
                and str(project.get("id") or "") == "default"
            ),
            projects[0],
        )
        if not isinstance(default_project, dict) or not default_project.get("id"):
            raise RuntimeError("default Project omitted its id")
        project_id = str(default_project["id"])
        for index in range(1, 10):
            username = f"perf_{run_suffix}_{index}"
            anonymous = urllib.request.build_opener()
            registered = _json_request(
                anonymous,
                base_url,
                "/api/auth/register",
                method="POST",
                payload={
                    "username": username,
                    "display_name": f"Performance Designer {index}",
                    "password": designer_password,
                },
            )
            application = registered.get("application")
            if not isinstance(application, dict) or not application.get("id"):
                raise RuntimeError("registration response omitted application id")
            approved = _json_request(
                admin,
                base_url,
                f"/api/admin/account-applications/{application['id']}/approve",
                method="POST",
            )
            user = approved.get("user")
            if not isinstance(user, dict) or not user.get("id"):
                raise RuntimeError("approval response omitted user id")
            user_id = str(user["id"])
            designer_ids.append(user_id)
            granted = _json_request(
                admin,
                base_url,
                f"/api/admin/accounts/{user_id}/project-permissions",
                method="PUT",
                payload={"project_ids": [project_id]},
            )
            if list(granted.get("project_ids") or []) != [project_id]:
                raise RuntimeError("designer Project Access Grant was not persisted")
            project_grant_count += 1
            designer_cookie_jar = http.cookiejar.CookieJar()
            designer = urllib.request.build_opener(
                urllib.request.HTTPCookieProcessor(designer_cookie_jar)
            )
            _json_request(
                designer,
                base_url,
                "/api/auth/login",
                method="POST",
                payload={"username": username, "password": designer_password},
            )
            designer_openers.append(designer)
            designer_cookie_jars.append(designer_cookie_jar)
        created = _json_request(
            admin,
            base_url,
            "/api/canvases",
            method="POST",
            payload={
                "title": f"Performance Smoke {run_suffix}",
                "icon": "activity",
                "kind": "smart",
            },
        )
        canvas = created.get("canvas")
        if not isinstance(canvas, dict) or not canvas.get("id"):
            raise RuntimeError("canvas creation response omitted canvas id")
        canvas_id = str(canvas["id"])
        for designer in designer_openers:
            visible = _json_request(
                designer,
                base_url,
                f"/api/canvases?project={project_id}",
            )
            canvases = visible.get("canvases")
            if not isinstance(canvases, list) or canvas_id not in {
                str(item.get("id") or "")
                for item in canvases
                if isinstance(item, dict)
            }:
                raise RuntimeError("designer cannot see the granted test Canvas")
            designer_canvas_visibility_count += 1
        client_sessions = [("client-01", admin_cookie_jar)] + [
            (f"client-{index:02d}", cookie_jar)
            for index, cookie_jar in enumerate(designer_cookie_jars, start=2)
        ]
        mutation_result = asyncio.run(
            _run_mutation_smoke(
                host=host,
                port=arguments.port,
                canvas_id=canvas_id,
                client_sessions=client_sessions,
                base_url=base_url,
                generation_provider=generation_provider,
                suite_plan=suite_plan,
                server_rss_sample=lambda: _workspace_process_rss_bytes(
                    arguments.workspace,
                    process,
                ),
                browser_settings_trace=lambda: _run_browser_settings_trace(
                    node=browser_dependencies[0],
                    browser=browser_dependencies[1],
                    base_url=base_url,
                    cookie_jar=admin_cookie_jar,
                ),
                browser_canvas_open_trace=lambda: _run_browser_settings_trace(
                    node=browser_dependencies[0],
                    browser=browser_dependencies[1],
                    base_url=base_url,
                    cookie_jar=admin_cookie_jar,
                    trace_kind="canvas-open",
                    canvas_id=canvas_id,
                    expected_node_count=REPRESENTATIVE_CANVAS_NODE_COUNT,
                ),
                full_browser_traces=(
                    [
                        (
                            lambda cookie_jar=cookie_jar: (
                                _run_browser_settings_trace(
                                    node=browser_dependencies[0],
                                    browser=browser_dependencies[1],
                                    base_url=base_url,
                                    cookie_jar=cookie_jar,
                                    trace_kind="canvas-open",
                                    canvas_id=canvas_id,
                                    expected_node_count=(
                                        REPRESENTATIVE_CANVAS_NODE_COUNT
                                    ),
                                    phase_override="full_browser",
                                    other_lightweight_client_count=0,
                                    timeout_seconds=45,
                                    enforce_first_operable_gate=False,
                                )
                            )
                        )
                        for _client_id, cookie_jar in client_sessions
                    ]
                    if (
                        arguments.standard_dry_run
                        or arguments.confirm_formal_standard
                    )
                    else []
                ),
                metrics_writer=metrics_writer,
                phase_progress=phase_progress,
            )
        )
        mutation_result.pop("metrics")
        if not mutation_result.get("browser_settings_gate_passed"):
            scenario_failure_gate = "browser_settings"
            scenario_failure_phase = str(
                mutation_result.get("browser_settings_phase") or "steady"
            )
            raise RuntimeError(
                "browser settings gate failed: "
                f"phase={scenario_failure_phase}; "
                "failures="
                f"{mutation_result.get('browser_settings_gate_failures')}"
            )
        if not mutation_result.get("browser_canvas_open_gate_passed"):
            scenario_failure_gate = "browser_canvas_open"
            scenario_failure_phase = str(
                mutation_result.get("browser_canvas_open_phase") or "burst"
            )
            raise RuntimeError(
                "browser Canvas open gate failed: "
                f"phase={scenario_failure_phase}; "
                "failures="
                f"{mutation_result.get('browser_canvas_open_gate_failures')}"
            )
        if not mutation_result.get("steady_mutation_gate_passed"):
            scenario_failure_gate = "steady_mutation"
            scenario_failure_phase = "steady"
            raise RuntimeError("steady Mutation gate failed")
        if not mutation_result.get("burst_mutation_gate_passed"):
            scenario_failure_gate = "burst_mutation"
            scenario_failure_phase = "burst"
            raise RuntimeError("burst Mutation gate failed")
        if (
            mutation_result.get("recovery_observation_executed")
            and not mutation_result.get("recovery_observation_gate_passed")
        ):
            scenario_failure_gate = "recovery_observation"
            scenario_failure_phase = "recovery"
            raise RuntimeError(
                "recovery observation gate failed: "
                f"runtime_p95={mutation_result.get('recovery_runtime_status_p95_ms')}; "
                f"event_loop_p99={mutation_result.get('recovery_event_loop_lag_p99_ms')}; "
                f"revision_unchanged={mutation_result.get('recovery_revision_unchanged')}"
            )
        if (
            mutation_result.get("full_browser_executed")
            and not mutation_result.get("full_browser_gate_passed")
        ):
            scenario_failure_gate = "full_browser"
            scenario_failure_phase = "full_browser"
            raise RuntimeError(
                "full-browser gate failed: "
                f"samples={mutation_result.get('full_browser_first_operable_sample_count')}; "
                f"accepted={mutation_result.get('full_browser_interaction_accepted_count')}; "
                f"profiles={mutation_result.get('full_browser_isolated_profile_count')}"
            )
        if not mutation_result.get("server_resource_growth_gate_passed"):
            scenario_failure_gate = "server_resource_growth"
            scenario_failure_phase = "recovery"
            raise RuntimeError(
                "server resource growth gate failed: "
                f"growth={mutation_result.get('server_rss_growth_bytes')}; "
                f"limit={mutation_result.get('server_rss_growth_gate_bytes')}"
            )
        if not mutation_result.get("slow_client_gate_passed"):
            scenario_failure_gate = "slow_client"
            scenario_failure_phase = "recovery"
            raise RuntimeError("slow client isolation gate failed")
        if not mutation_result.get("runtime_status_gate_passed"):
            scenario_failure_gate = "runtime_status"
            scenario_failure_phase = "recovery"
            raise RuntimeError(
                "runtime status gate failed: "
                f"samples={mutation_result.get('runtime_status_sample_count')}; "
                f"timeouts={mutation_result.get('runtime_status_timeout_count')}; "
                f"failures={mutation_result.get('runtime_status_failure_count')}; "
                f"p95={mutation_result.get('runtime_status_p95_ms')}"
            )
        if not mutation_result.get("event_loop_lag_gate_passed"):
            scenario_failure_gate = "event_loop_lag"
            scenario_failure_phase = "recovery"
            raise RuntimeError(
                "event-loop lag gate failed: "
                f"samples={mutation_result.get('event_loop_lag_sample_count')}; "
                f"phases={mutation_result.get('event_loop_lag_samples_by_phase')}; "
                f"p99={mutation_result.get('event_loop_lag_p99_ms')}"
            )
        if not mutation_result.get("heartbeat_p99_passed"):
            scenario_failure_gate = "heartbeat"
            scenario_failure_phase = "recovery"
            raise RuntimeError("heartbeat server P99 exceeded its 10 ms gate")
        if not mutation_result.get("generation_mutation_gate_passed"):
            scenario_failure_gate = "generation_mutation"
            scenario_failure_phase = "burst"
            raise RuntimeError(
                "Generation parallel Mutation gate failed: "
                f"window={mutation_result.get('generation_mutation_send_window_ms')}; "
                f"p95={mutation_result.get('generation_mutation_p95_ms')}; "
                f"p99={mutation_result.get('generation_mutation_p99_ms')}; "
                f"outputs={mutation_result.get('generation_output_count')}; "
                f"logs={mutation_result.get('generation_log_count')}; "
                f"revision={mutation_result.get('generation_final_revision')}"
            )
    except (Exception, KeyboardInterrupt) as exc:
        scenario_failure_type = type(exc).__name__
        scenario_failure_message = str(exc)
        if not scenario_failure_phase:
            scenario_failure_phase = str(
                phase_progress.get("active_phase") or ""
            )
        if (
            not scenario_failure_gate
            and scenario_failure_phase in {"steady", "burst"}
        ):
            scenario_failure_gate = f"{scenario_failure_phase}_stream"
    finally:
        if canvas_id:
            try:
                _json_request(
                    admin,
                    base_url,
                    f"/api/canvases/{canvas_id}",
                    method="DELETE",
                )
                _json_request(
                    admin,
                    base_url,
                    f"/api/canvases/{canvas_id}/purge",
                    method="DELETE",
                )
                canvas_purged = True
            except (OSError, RuntimeError):
                pass
        sessions_removed = True
        for designer in designer_openers:
            try:
                _json_request(
                    designer,
                    base_url,
                    "/api/auth/logout",
                    method="POST",
                )
            except (OSError, RuntimeError):
                sessions_removed = False
        accounts_removed = True
        for user_id in designer_ids:
            try:
                _json_request(
                    admin,
                    base_url,
                    f"/api/admin/accounts/{user_id}",
                    method="DELETE",
                )
            except (OSError, RuntimeError):
                accounts_removed = False
        try:
            generated_payload = _json_request(
                admin,
                base_url,
                "/api/storage-files?kind=generated&limit=200",
            )
            generated_media_after = {
                str(item.get("rel") or "")
                for item in generated_payload.get("items") or []
                if isinstance(item, dict) and str(item.get("rel") or "")
            }
            generated_media_created = sorted(
                generated_media_after - generated_media_before
            )
            if generated_media_created:
                removed = _json_request(
                    admin,
                    base_url,
                    "/api/storage-files/delete",
                    method="POST",
                    payload={
                        "kind": "generated",
                        "items": generated_media_created,
                    },
                )
                generation_media_removed_count = int(
                    removed.get("removed") or 0
                )
            generation_media_purged = (
                generation_media_removed_count == len(generated_media_created)
            )
        except (OSError, RuntimeError, TypeError, ValueError):
            generation_media_purged = False
        if original_providers:
            try:
                _json_request(
                    admin,
                    base_url,
                    "/api/providers",
                    method="PUT",
                    payload=original_providers,
                )
                provider_settings_restored = True
            except (OSError, RuntimeError):
                provider_settings_restored = False
        _stop_service(process)
        server_log.close()
        generation_provider.stop()
        for path in (instance_state, runtime_state, cache_state):
            shutil.rmtree(path, ignore_errors=True)
    cleanup = {
        "schema_version": 1,
        "cleanup_allowlist_source": (
            "canvas_account_create_responses_and_media_delta"
        ),
        "cleanup_allowlist": {
            "canvas_ids": [canvas_id] if canvas_id else [],
            "account_ids": list(designer_ids),
            "generated_media_paths": list(generated_media_created),
        },
        "out_of_allowlist_deletion_attempt_count": 0,
        "canvas_purged": canvas_purged,
        "generation_media_purged": generation_media_purged,
        "generation_media_removed_count": generation_media_removed_count,
        "provider_settings_restored": provider_settings_restored,
        "sessions_removed": sessions_removed,
        "accounts_removed": accounts_removed,
        "async_receive_tasks_stopped": (
            int(
                phase_progress.get(
                    "async_receive_task_target_count",
                    0,
                )
                or 0
            )
            == int(
                phase_progress.get(
                    "async_receive_task_completion_count",
                    0,
                )
                or 0
            )
        ),
        "full_browser_processes_stopped": (
            int(
                phase_progress.get("full_browser_trace_target_count", 0)
                or 0
            )
            == int(
                phase_progress.get(
                    "full_browser_trace_completion_count",
                    0,
                )
                or 0
            )
        ),
        "full_browser_profiles_removed_count": int(
            phase_progress.get("full_browser_profile_removed_count", 0)
            or 0
        ),
    }
    summary: dict[str, object] = {
        "schema_version": 1,
        "status": "failed" if scenario_failure_type else "passed",
        "executed": True,
        "exit_code": 1 if scenario_failure_type else 0,
        "profile": arguments.profile,
        "suite": arguments.suite,
        "host": host,
        "port": arguments.port,
        "seed": arguments.seed,
        "suite_plan": dict(suite_plan),
        "reasons": ["scenario_failed"] if scenario_failure_type else [],
        "workspace_changed": bool(canvas_id),
        "account_count": (1 if admin_created else 0) + len(designer_ids),
        "canvas_count": 1 if canvas_id else 0,
        "project_grant_count": project_grant_count,
        "designer_canvas_visibility_count": designer_canvas_visibility_count,
        "generation_provider_response_wait_timeout_seconds": (
            generation_provider.response_wait_timeout_seconds
        ),
        "failure_gate": scenario_failure_gate,
        "failure_phase": scenario_failure_phase,
        "completed_phase_names": list(
            phase_progress.get("completed_phase_names") or []
        ),
        **mutation_result,
    }
    if summary_metadata:
        summary.update(summary_metadata)
    if scenario_failure_type:
        summary["completed_phase_names"] = list(
            phase_progress.get("completed_phase_names") or []
        )
        report_directory.joinpath("failure.json").write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "reason": "scenario_failed",
                    "exception_type": scenario_failure_type,
                    "message": scenario_failure_message,
                    "gate": scenario_failure_gate,
                    "phase": scenario_failure_phase,
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
    return summary, cleanup


def main() -> int:
    arguments = _arguments()
    host = "127.0.0.1"
    if arguments.realtime_encoding_preflight:
        sys.path.insert(0, str(BACKEND_ROOT))
        from infinite_canvas.canvas_realtime import (
            seen_operations_encoding_diagnostics,
        )

        report_directory = _report_directory(arguments.report_root)
        _write_manifest(report_directory, arguments, executed=True)
        diagnostics = seen_operations_encoding_diagnostics()
        encoding_gate_passed = bool(
            diagnostics["seen_operations_storage_format"] == "raw-v1"
            and diagnostics["legacy_zlib_decode_supported"]
            and diagnostics["seen_operations_round_trip_passed"]
            and float(diagnostics["seen_operations_encode_p95_ms"]) <= 2
        )
        latencies = diagnostics.pop(
            "seen_operations_encode_latencies_ms"
        )
        with _MetricsWriter(report_directory) as metrics_writer:
            for latency_ms in latencies:
                metrics_writer.append(
                    {
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "client": "realtime-idempotency-ledger",
                        "operation": "seen_operation_encode",
                        "status": "accepted" if encoding_gate_passed else "rejected",
                        "ack_latency_ms": latency_ms,
                        "execution_unit": "process",
                    }
                )
        summary = {
            "schema_version": 1,
            "status": "passed" if encoding_gate_passed else "failed",
            "executed": True,
            "exit_code": 0 if encoding_gate_passed else 1,
            "profile": arguments.profile,
            "suite": arguments.suite,
            "host": host,
            "port": arguments.port,
            "seed": arguments.seed,
            "execution_mode": "realtime_encoding_preflight",
            "reasons": [] if encoding_gate_passed else [
                "seen_operations_encoding_gate_failed"
            ],
            **diagnostics,
            "seen_operations_encode_gate_ms": 2,
            "seen_operations_encode_gate_passed": encoding_gate_passed,
            "workspace_changed": False,
        }
        cleanup = {
            "schema_version": 1,
            "workspace_unchanged": True,
            "out_of_allowlist_deletion_attempt_count": 0,
        }
        _write_summary(report_directory, summary)
        report_directory.joinpath("cleanup.json").write_text(
            json.dumps(cleanup, ensure_ascii=False, indent=2, sort_keys=True)
            + "\n",
            encoding="utf-8",
        )
        print(json.dumps({"report_directory": str(report_directory)}))
        return 0 if encoding_gate_passed else 1
    if (
        arguments.suite == "standard"
        and not arguments.standard_dry_run
        and not arguments.confirm_formal_standard
    ):
        report_directory = _report_directory(arguments.report_root)
        _write_manifest(report_directory, arguments, executed=False)
        summary = {
            "schema_version": 1,
            "status": "environment_not_ready",
            "executed": False,
            "exit_code": 2,
            "profile": arguments.profile,
            "suite": arguments.suite,
            "host": host,
            "port": arguments.port,
            "seed": arguments.seed,
            "reasons": ["suite_not_implemented"],
            "suite_plan": dict(STANDARD_SUITE_PLAN),
            "workspace_changed": False,
        }
        _write_summary(report_directory, summary)
        print(
            json.dumps(
                {"report_directory": str(report_directory)},
                ensure_ascii=False,
            )
        )
        return 2
    if arguments.suite == "soak":
        report_directory = _report_directory(arguments.report_root)
        _write_manifest(report_directory, arguments, executed=False)
        summary = {
            "schema_version": 1,
            "status": "environment_not_ready",
            "executed": False,
            "exit_code": 2,
            "profile": arguments.profile,
            "suite": arguments.suite,
            "host": host,
            "port": arguments.port,
            "seed": arguments.seed,
            "reasons": ["suite_not_implemented"],
            "suite_plan": dict(SOAK_SUITE_PLAN),
            "workspace_changed": False,
        }
        _write_summary(report_directory, summary)
        print(
            json.dumps(
                {"report_directory": str(report_directory)},
                ensure_ascii=False,
            )
        )
        return 2
    if arguments.attach_existing_service:
        base_url = f"http://{host}:{arguments.port}"
        reasons: list[str] = []
        if not _target_port_in_use(host, arguments.port):
            reasons.append("existing_service_not_found")
        else:
            opener = urllib.request.build_opener()
            try:
                runtime_status = _json_request(
                    opener,
                    base_url,
                    "/api/runtime/status",
                )
            except (OSError, RuntimeError):
                reasons.append("existing_service_status_check_failed")
            else:
                if str(runtime_status.get("stage") or "") != "ready":
                    reasons.append("existing_service_not_ready")
                else:
                    request = urllib.request.Request(
                        f"{base_url}/api/auth/me",
                        method="GET",
                        headers={"Accept": "application/json"},
                    )
                    try:
                        with opener.open(request, timeout=5):
                            pass
                    except urllib.error.HTTPError as exc:
                        if exc.code == 401:
                            reasons.append(
                                "existing_service_authentication_required"
                            )
                        else:
                            reasons.append(
                                "existing_service_authentication_check_failed"
                            )
                    except OSError:
                        reasons.append(
                            "existing_service_authentication_check_failed"
                        )
                    else:
                        reasons.append(
                            "existing_service_execution_not_implemented"
                        )
        report_directory = _report_directory(arguments.report_root)
        _write_manifest(report_directory, arguments, executed=False)
        summary = {
            "schema_version": 1,
            "status": "environment_not_ready",
            "executed": False,
            "exit_code": 2,
            "profile": arguments.profile,
            "suite": arguments.suite,
            "service_mode": "existing",
            "host": host,
            "port": arguments.port,
            "seed": arguments.seed,
            "reasons": reasons,
            "workspace_changed": False,
        }
        _write_summary(report_directory, summary)
        print(
            json.dumps(
                {"report_directory": str(report_directory)},
                ensure_ascii=False,
            )
        )
        return 2
    if _target_port_in_use(host, arguments.port):
        report_directory = _report_directory(arguments.report_root)
        summary = {
            "schema_version": 1,
            "status": "environment_not_ready",
            "executed": False,
            "exit_code": 2,
            "profile": arguments.profile,
            "suite": arguments.suite,
            "host": host,
            "port": arguments.port,
            "seed": arguments.seed,
            "reasons": ["target_port_in_use"],
            "workspace_changed": False,
        }
        _write_summary(report_directory, summary)
        print(
            json.dumps(
                {"report_directory": str(report_directory)},
                ensure_ascii=False,
            )
        )
        return 2
    if not arguments.workspace.is_dir():
        report_directory = _report_directory(arguments.report_root)
        summary = {
            "schema_version": 1,
            "status": "environment_not_ready",
            "executed": False,
            "exit_code": 2,
            "profile": arguments.profile,
            "suite": arguments.suite,
            "host": host,
            "port": arguments.port,
            "seed": arguments.seed,
            "reasons": ["workspace_not_found"],
            "workspace_changed": False,
        }
        _write_summary(report_directory, summary)
        print(
            json.dumps(
                {"report_directory": str(report_directory)},
                ensure_ascii=False,
            )
        )
        return 2
    if arguments.profile == "real-cli":
        real_cli_preflight, reasons = _real_cli_installation_preflight()
        report_directory = _report_directory(arguments.report_root)
        if (
            arguments.confirm_real_generation_quota_probe
            and reasons == ["real_cli_quota_check_requires_generation"]
        ):
            probe, cleanup, admission = _real_cli_codex_quota_probe(
                report_directory
            )
            real_cli_preflight["codex"].update(
                {
                    "quota_checked": probe["quota_checked"],
                    "quota_status": probe["quota_status"],
                }
            )
            probe_available = probe["quota_status"] == "available"
            exit_code = 2 if probe_available else 3
            _write_manifest(report_directory, arguments, executed=True)
            summary = {
                "schema_version": 1,
                "status": (
                    "quota_probe_complete"
                    if probe_available
                    else (
                        "quota_probe_cancelled"
                        if probe["quota_status"] == "cancelled"
                        else "quota_probe_failed"
                    )
                ),
                "executed": True,
                "exit_code": exit_code,
                "profile": arguments.profile,
                "suite": arguments.suite,
                "host": host,
                "port": arguments.port,
                "seed": arguments.seed,
                "reasons": ([probe["reason"]] if probe.get("reason") else []),
                "real_generation_call_count": probe[
                    "real_generation_call_count"
                ],
                "provider_exit_code": probe["provider_exit_code"],
                "real_cli_preflight": real_cli_preflight,
                "real_environment_admission": admission,
                "workspace_changed": False,
            }
            _write_summary(report_directory, summary)
            report_directory.joinpath("cleanup.json").write_text(
                json.dumps(
                    cleanup,
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            print(
                json.dumps(
                    {"report_directory": str(report_directory)},
                    ensure_ascii=False,
                )
            )
            return exit_code
        _write_manifest(report_directory, arguments, executed=False)
        summary = {
            "schema_version": 1,
            "status": "environment_not_ready",
            "executed": False,
            "exit_code": 2,
            "profile": arguments.profile,
            "suite": arguments.suite,
            "host": host,
            "port": arguments.port,
            "seed": arguments.seed,
            "reasons": reasons,
            "real_cli_preflight": real_cli_preflight,
            "real_environment_admission": (
                _real_environment_admission(reasons)
            ),
            "workspace_changed": False,
        }
        _write_summary(report_directory, summary)
        report_directory.joinpath("cleanup.json").write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "workspace_unchanged": True,
                    "generation_probe_executed": False,
                    "workspace_write_executed": False,
                    "out_of_allowlist_deletion_attempt_count": 0,
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        print(
            json.dumps(
                {"report_directory": str(report_directory)},
                ensure_ascii=False,
            )
        )
        return 2
    browser_dependencies = _browser_dependencies()
    if browser_dependencies is None:
        report_directory = _report_directory(arguments.report_root)
        summary = {
            "schema_version": 1,
            "status": "environment_not_ready",
            "executed": False,
            "exit_code": 2,
            "profile": arguments.profile,
            "suite": arguments.suite,
            "host": host,
            "port": arguments.port,
            "seed": arguments.seed,
            "reasons": ["browser_settings_tracer_dependencies_not_found"],
            "workspace_changed": False,
        }
        _write_summary(report_directory, summary)
        print(
            json.dumps(
                {"report_directory": str(report_directory)},
                ensure_ascii=False,
            )
        )
        return 2
    report_directory = _report_directory(arguments.report_root)
    _write_manifest(report_directory, arguments, executed=True)
    dry_run_plans = {
        "short": STANDARD_DRY_RUN_SUITE_PLAN,
        "extended": STANDARD_EXTENDED_DRY_RUN_SUITE_PLAN,
        "endurance": STANDARD_ENDURANCE_DRY_RUN_SUITE_PLAN,
        "overlap": STANDARD_OVERLAP_DRY_RUN_SUITE_PLAN,
        "concurrency": STANDARD_CONCURRENCY_DRY_RUN_SUITE_PLAN,
        "sustained-burst": STANDARD_SUSTAINED_BURST_DRY_RUN_SUITE_PLAN,
    }
    if arguments.confirm_formal_standard:
        suite_plan = STANDARD_SUITE_PLAN
        summary_metadata = {
            "execution_mode": "formal_standard",
            "formal_result": True,
        }
    elif arguments.standard_dry_run:
        suite_plan = dry_run_plans[arguments.standard_dry_run_level]
        summary_metadata = {
            "execution_mode": "standard_dry_run",
            "standard_dry_run_level": (
                arguments.standard_dry_run_level
            ),
            "formal_result": False,
            "formal_suite_plan": dict(STANDARD_SUITE_PLAN),
        }
    else:
        suite_plan = SMOKE_SUITE_PLAN
        summary_metadata = None
    with _MetricsWriter(report_directory) as metrics_writer:
        summary, cleanup = _run_lifecycle_smoke(
            arguments,
            report_directory,
            host=host,
            browser_dependencies=browser_dependencies,
            metrics_writer=metrics_writer,
            suite_plan=suite_plan,
            summary_metadata=summary_metadata,
        )
    _write_summary(report_directory, summary)
    report_directory.joinpath("cleanup.json").write_text(
        json.dumps(cleanup, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {"report_directory": str(report_directory)},
            ensure_ascii=False,
        )
    )
    return int(summary["exit_code"])


if __name__ == "__main__":
    sys.exit(main())
