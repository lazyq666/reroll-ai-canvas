#!/usr/bin/env python3
"""Run a human-plus-robots acceptance check against an existing service."""

from __future__ import annotations

import argparse
import asyncio
import csv
import getpass
import http.cookiejar
import json
import math
import os
import re
import secrets
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
from datetime import datetime, timezone
from pathlib import Path

import websockets


PASSWORD_ENV = "INFINITE_CANVAS_ACCEPTANCE_ADMIN_PASSWORD"
MAX_ROBOT_COUNT = 9
MAX_PLACEMENT_CONFLICT_RETRIES = 8
MAX_REALTIME_RESYNCS_PER_ROBOT = 16
CANVAS_RESYNC_CLOSE_CODE = 4409


class _RobotMutationRejected(RuntimeError):
    def __init__(self, code: str, revision: int):
        super().__init__(f"robot_mutation_rejected:{code}")
        self.code = code
        self.revision = revision


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:3001")
    parser.add_argument("--admin-username", required=True)
    parser.add_argument("--canvas-id", default="")
    parser.add_argument("--robot-count", type=int, default=9)
    parser.add_argument("--robot-rounds", type=int, default=120)
    parser.add_argument("--round-interval-seconds", type=float, default=1.0)
    parser.add_argument(
        "--pointer-hz",
        type=float,
        default=0.0,
        help="publish each robot's ephemeral Presence pointer at up to 10 Hz",
    )
    parser.add_argument("--ack-p95-gate-ms", type=float, default=500.0)
    parser.add_argument("--ack-p99-gate-ms", type=float, default=1_000.0)
    parser.add_argument(
        "--human-generation-grace-seconds",
        type=float,
        default=180.0,
    )
    parser.add_argument("--start-immediately", action="store_true")
    parser.add_argument("--open-human-canvas", action="store_true")
    parser.add_argument("--require-human-generation", action="store_true")
    parser.add_argument("--cleanup-test-canvas", action="store_true")
    parser.add_argument("--report-root", type=Path, required=True)
    arguments = parser.parse_args()
    parsed = urllib.parse.urlparse(arguments.base_url)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or not parsed.port
    ):
        parser.error("--base-url must be an explicit localhost HTTP service")
    if not 1 <= arguments.robot_count <= MAX_ROBOT_COUNT:
        parser.error(f"--robot-count must be between 1 and {MAX_ROBOT_COUNT}")
    if not 1 <= arguments.robot_rounds <= 3600:
        parser.error("--robot-rounds must be between 1 and 3600")
    if not 0 <= arguments.round_interval_seconds <= 60:
        parser.error("--round-interval-seconds must be between 0 and 60")
    if not 0 <= arguments.pointer_hz <= 10:
        parser.error("--pointer-hz must be between 0 and 10")
    if arguments.ack_p95_gate_ms <= 0:
        parser.error("--ack-p95-gate-ms must be positive")
    if arguments.ack_p99_gate_ms <= 0:
        parser.error("--ack-p99-gate-ms must be positive")
    if not 0 <= arguments.human_generation_grace_seconds <= 1800:
        parser.error(
            "--human-generation-grace-seconds must be between 0 and 1800"
        )
    arguments.canvas_id = str(arguments.canvas_id or "").strip()
    if arguments.canvas_id and not re.fullmatch(
        r"[A-Za-z0-9._:-]{1,128}", arguments.canvas_id
    ):
        parser.error("--canvas-id must be a safe explicit Canvas ID")
    arguments.base_url = arguments.base_url.rstrip("/")
    return arguments


def _report_directory(report_root: Path) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    directory = report_root / f"{timestamp}-{uuid.uuid4().hex[:8]}"
    directory.mkdir(parents=True, exist_ok=False)
    return directory.resolve()


def _json_request(
    opener: urllib.request.OpenerDirector,
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    payload: object | None = None,
) -> dict[str, object]:
    body = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        f"{base_url}{path}",
        data=body,
        method=method,
        headers=headers,
    )
    try:
        with opener.open(request, timeout=15) as response:
            decoded = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"{method} {path} returned HTTP {exc.code}") from exc
    except (OSError, ValueError, UnicodeError) as exc:
        raise RuntimeError(f"{method} {path} did not return usable JSON") from exc
    if not isinstance(decoded, dict):
        raise RuntimeError(f"{method} {path} returned a non-object payload")
    return decoded


def _cookie_header(cookie_jar: http.cookiejar.CookieJar) -> str:
    return "; ".join(f"{cookie.name}={cookie.value}" for cookie in cookie_jar)


def _percentile(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    rank = max(0, math.ceil(percentile * len(ordered)) - 1)
    return round(ordered[rank], 3)


async def _receive_object(connection: object) -> dict[str, object]:
    raw = await asyncio.wait_for(connection.recv(), timeout=15)
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise RuntimeError("Canvas WebSocket returned a non-object payload")
    return payload


async def _run_robot_mutations(
    *,
    base_url: str,
    canvas_id: str,
    robot_sessions: list[tuple[str, http.cookiejar.CookieJar]],
    rounds: int,
    interval_seconds: float,
    pointer_hz: float,
    mutation_namespace: str,
) -> tuple[list[dict[str, object]], dict[str, object], str]:
    parsed = urllib.parse.urlparse(base_url)
    websocket_scheme = "wss" if parsed.scheme == "https" else "ws"
    websocket_base = f"{websocket_scheme}://{parsed.netloc}"
    robot_count = len(robot_sessions)
    connections: list[object | None] = [None] * robot_count
    send_locks = [asyncio.Lock() for _ in range(robot_count)]
    receive_tasks: list[asyncio.Task[None] | None] = [None] * robot_count
    pending: dict[str, tuple[int, asyncio.Future[dict[str, object]]]] = {}
    latest_revision = 0
    metrics: list[dict[str, object]] = []
    stream_last_revisions: list[int] = [0] * robot_count
    robot_resync_counts: list[int] = [0] * robot_count
    realtime_close_code_counts: dict[int, int] = {}
    realtime_revision_gap_count = 0
    realtime_revision_reorder_count = 0
    realtime_revision_target = 0
    realtime_revision_streams_caught_up = False
    presence_pointer_updates_sent = 0
    presence_pointer_send_error_count = 0
    pointer_tasks: list[asyncio.Task[None]] = []
    pointer_stop = asyncio.Event()
    robot_failure = ""

    async def receive_loop(robot_index: int, connection: object) -> None:
        nonlocal latest_revision
        nonlocal realtime_revision_gap_count
        nonlocal realtime_revision_reorder_count
        try:
            while True:
                message = await _receive_object(connection)
                message_type = str(message.get("type") or "")
                if message_type == "canvas_snapshot":
                    latest_revision = max(
                        latest_revision,
                        int(message.get("revision", 0) or 0),
                    )
                    continue
                if message_type == "mutation_rejected":
                    rejected_revision = int(message.get("revision", 0) or 0)
                    latest_revision = max(latest_revision, rejected_revision)
                    operation_id = str(message.get("operation_id") or "")
                    waiting = pending.get(operation_id)
                    if waiting is not None and waiting[0] == robot_index:
                        waiting[1].set_exception(
                            _RobotMutationRejected(
                                str(message.get("code") or "unknown"),
                                rejected_revision,
                            )
                        )
                    continue
                if message_type != "canvas_mutation":
                    continue
                incoming_revision = int(message.get("revision", 0) or 0)
                previous_revision = stream_last_revisions[robot_index]
                duplicate = bool(message.get("duplicate"))
                if incoming_revision > previous_revision + 1:
                    realtime_revision_gap_count += (
                        incoming_revision - previous_revision - 1
                    )
                elif incoming_revision <= previous_revision and not duplicate:
                    realtime_revision_reorder_count += 1
                if not duplicate:
                    stream_last_revisions[robot_index] = max(
                        previous_revision,
                        incoming_revision,
                    )
                latest_revision = max(latest_revision, incoming_revision)
                operation_id = str(message.get("operation_id") or "")
                waiting = pending.get(operation_id)
                if waiting is not None and waiting[0] == robot_index:
                    waiting[1].set_result(message)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            for waiting_index, future in list(pending.values()):
                if waiting_index == robot_index and not future.done():
                    future.set_exception(exc)
            raise

    async def connect_robot(robot_index: int) -> None:
        nonlocal latest_revision
        client_id, cookie_jar = robot_sessions[robot_index]
        previous_task = receive_tasks[robot_index]
        previous_connection = connections[robot_index]
        if previous_task is not None:
            if not previous_task.done():
                previous_task.cancel()
            await asyncio.gather(previous_task, return_exceptions=True)
        if previous_connection is not None:
            await previous_connection.close()
        query_client = urllib.parse.quote(client_id, safe="")
        connection = await websockets.connect(
            f"{websocket_base}/ws/canvases/{canvas_id}"
            f"?client_id={query_client}",
            additional_headers={"Cookie": _cookie_header(cookie_jar)},
            proxy=None,
            open_timeout=10,
            close_timeout=3,
            max_size=16 * 1024 * 1024,
        )
        snapshot = await _receive_object(connection)
        if snapshot.get("type") != "canvas_snapshot":
            await connection.close()
            raise RuntimeError(f"{client_id} did not receive a Canvas Snapshot")
        snapshot_revision = int(snapshot.get("revision", 0) or 0)
        latest_revision = max(latest_revision, snapshot_revision)
        stream_last_revisions[robot_index] = snapshot_revision
        connections[robot_index] = connection
        receive_tasks[robot_index] = asyncio.create_task(
            receive_loop(robot_index, connection)
        )

    async def resync_robot(robot_index: int, exc: BaseException) -> None:
        if not isinstance(exc, websockets.ConnectionClosed):
            raise exc
        close_code = int(exc.code or 0)
        close_reason = str(exc.reason or "").strip()
        realtime_close_code_counts[close_code] = (
            realtime_close_code_counts.get(close_code, 0) + 1
        )
        if close_code != CANVAS_RESYNC_CLOSE_CODE:
            reason_suffix = f":{close_reason}" if close_reason else ""
            raise RuntimeError(
                f"robot_realtime_closed:{close_code}{reason_suffix}"
            ) from exc
        if robot_resync_counts[robot_index] >= MAX_REALTIME_RESYNCS_PER_ROBOT:
            raise RuntimeError("robot_realtime_resync_limit_exceeded") from exc
        robot_resync_counts[robot_index] += 1
        await connect_robot(robot_index)

    async def ensure_robot_connected(robot_index: int) -> int:
        task = receive_tasks[robot_index]
        if task is None:
            await connect_robot(robot_index)
            return 0
        if not task.done():
            return 0
        try:
            task.result()
        except BaseException as exc:
            await resync_robot(robot_index, exc)
            return 1
        raise RuntimeError("robot_realtime_receive_loop_stopped")

    try:
        for robot_index in range(robot_count):
            await connect_robot(robot_index)

        async def publish_pointer(robot_index: int) -> None:
            nonlocal presence_pointer_updates_sent
            nonlocal presence_pointer_send_error_count
            sequence = 0
            phase_offset = robot_index * (math.tau / max(1, robot_count))
            interval = 1 / pointer_hz
            while not pointer_stop.is_set():
                connection = connections[robot_index]
                if connection is not None:
                    sequence += 1
                    phase = phase_offset + sequence * 0.16
                    cursor = {
                        "x": round(
                            220 + robot_index * 145 + math.cos(phase) * 90,
                            3,
                        ),
                        "y": round(
                            240 + (robot_index % 3) * 190
                            + math.sin(phase * 1.3) * 75,
                            3,
                        ),
                    }
                    try:
                        async with send_locks[robot_index]:
                            await connection.send(
                                json.dumps(
                                    {
                                        "type": "presence_update",
                                        "seq": sequence,
                                        "cursor": cursor,
                                    },
                                    ensure_ascii=False,
                                )
                            )
                        presence_pointer_updates_sent += 1
                    except websockets.ConnectionClosed:
                        presence_pointer_send_error_count += 1
                try:
                    await asyncio.wait_for(pointer_stop.wait(), timeout=interval)
                except asyncio.TimeoutError:
                    pass

        if pointer_hz > 0:
            pointer_tasks = [
                asyncio.create_task(publish_pointer(robot_index))
                for robot_index in range(robot_count)
            ]

        async def submit_mutation(robot_index: int, round_index: int) -> None:
            client_id = robot_sessions[robot_index][0]
            operation_id = (
                f"{mutation_namespace}:{client_id}:"
                f"round-{round_index + 1:04d}"
            )
            started_ns = time.perf_counter_ns()
            node_id = (
                f"{mutation_namespace}-robot-node-{robot_index + 1:02d}"
            )
            changes = (
                {
                    "node_creates": [
                        {
                            "id": node_id,
                            "type": "smart-image",
                            "x": 120 + robot_index * 150,
                            "y": 160 + robot_index * 80,
                        }
                    ]
                }
                if round_index == 0
                else {
                    "node_updates": [
                        {
                            "id": node_id,
                            "path": ["x"],
                            "value": 120 + robot_index * 150 + round_index * 8,
                        }
                    ]
                }
            )
            placement_conflict_retries = 0
            realtime_resync_retries = 0
            while True:
                realtime_resync_retries += await ensure_robot_connected(
                    robot_index
                )
                connection = connections[robot_index]
                if connection is None:
                    raise RuntimeError("robot_realtime_connection_unavailable")
                future: asyncio.Future[dict[str, object]] = (
                    asyncio.get_running_loop().create_future()
                )
                pending[operation_id] = (robot_index, future)
                try:
                    async with send_locks[robot_index]:
                        await connection.send(
                            json.dumps(
                                {
                                    "type": "canvas_mutation",
                                    "canvas_id": canvas_id,
                                    "operation": {
                                        "operation_id": operation_id,
                                        "base_revision": latest_revision,
                                        "changes": changes,
                                    },
                                },
                                ensure_ascii=False,
                            )
                        )
                    message = await asyncio.wait_for(future, timeout=15)
                    break
                except websockets.ConnectionClosed as exc:
                    await resync_robot(robot_index, exc)
                    realtime_resync_retries += 1
                except _RobotMutationRejected as exc:
                    if (
                        round_index != 0
                        or exc.code != "placement_conflict"
                        or placement_conflict_retries
                        >= MAX_PLACEMENT_CONFLICT_RETRIES
                    ):
                        raise
                    placement_conflict_retries += 1
                    await asyncio.sleep(0)
                finally:
                    waiting = pending.get(operation_id)
                    if waiting is not None and waiting[1] is future:
                        pending.pop(operation_id, None)
            acknowledged_ns = time.perf_counter_ns()
            metrics.append(
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "client": client_id,
                    "operation_id": operation_id,
                    "round_number": round_index + 1,
                    "operation": (
                        "node_create" if round_index == 0 else "node_move"
                    ),
                    "placement_conflict_retries": placement_conflict_retries,
                    "realtime_resync_retries": realtime_resync_retries,
                    "status": "acknowledged",
                    "ack_latency_ms": round(
                        (acknowledged_ns - started_ns) / 1_000_000,
                        3,
                    ),
                    "revision": int(message.get("revision", 0) or 0),
                }
            )

        for round_index in range(rounds):
            round_started = time.monotonic()
            round_metric_start = len(metrics)
            if round_index == 0:
                # Placement creation deliberately follows server order so every
                # robot starts from the latest authoritative revision. Later
                # move rounds remain concurrent across all robot sessions.
                for robot_index in range(len(robot_sessions)):
                    await submit_mutation(robot_index, round_index)
            else:
                await asyncio.gather(
                    *(
                        submit_mutation(robot_index, round_index)
                        for robot_index in range(len(robot_sessions))
                    )
                )
            round_metrics = metrics[round_metric_start:]
            for queue_position, metric in enumerate(
                sorted(round_metrics, key=lambda item: int(item["revision"])),
                start=1,
            ):
                metric["queue_position"] = queue_position
            elapsed = time.monotonic() - round_started
            remaining = interval_seconds - elapsed
            if remaining > 0 and round_index + 1 < rounds:
                await asyncio.sleep(remaining)
        realtime_revision_target = max(
            (int(metric["revision"]) for metric in metrics),
            default=latest_revision,
        )
        catch_up_deadline = time.monotonic() + 5
        while (
            any(
                revision < realtime_revision_target
                for revision in stream_last_revisions
            )
            and time.monotonic() < catch_up_deadline
        ):
            await asyncio.sleep(0.01)
        realtime_revision_streams_caught_up = bool(stream_last_revisions) and all(
            revision >= realtime_revision_target
            for revision in stream_last_revisions
        )
    except Exception as exc:
        robot_failure = str(exc) or type(exc).__name__
    finally:
        pointer_stop.set()
        if pointer_tasks:
            await asyncio.gather(*pointer_tasks, return_exceptions=True)
        active_tasks = [task for task in receive_tasks if task is not None]
        for task in active_tasks:
            task.cancel()
        if active_tasks:
            await asyncio.gather(*active_tasks, return_exceptions=True)
        for connection in connections:
            if connection is not None:
                await connection.close()
    return metrics, {
        "realtime_revision_stream_client_count": len(stream_last_revisions),
        "realtime_revision_gap_count": realtime_revision_gap_count,
        "realtime_revision_reorder_count": realtime_revision_reorder_count,
        "realtime_revision_target": realtime_revision_target,
        "realtime_revision_stream_last_revisions": list(
            stream_last_revisions
        ),
        "realtime_revision_streams_caught_up": (
            realtime_revision_streams_caught_up
        ),
        "realtime_resync_count": sum(robot_resync_counts),
        "realtime_close_code_counts": {
            str(code): count
            for code, count in sorted(realtime_close_code_counts.items())
        },
        "presence_pointer_hz": pointer_hz,
        "presence_pointer_updates_sent": presence_pointer_updates_sent,
        "presence_pointer_send_error_count": (
            presence_pointer_send_error_count
        ),
    }, robot_failure


def _generation_output_count(canvas: dict[str, object]) -> int:
    count = 0
    for node in canvas.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        count += sum(
            isinstance(item, dict) and bool(str(item.get("url") or ""))
            for item in node.get("images") or []
        )
    return count


def _generation_output_refs(canvas: dict[str, object]) -> set[str]:
    refs: set[str] = set()
    for node in canvas.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        for item in node.get("images") or []:
            if not isinstance(item, dict):
                continue
            ref = str(item.get("url") or "").strip()
            if ref:
                refs.add(ref)
    return refs


def _open_human_canvas(url: str) -> bool:
    """Open the local Canvas URL without making browser failure fatal."""
    try:
        return bool(webbrowser.open(url, new=2))
    except (OSError, webbrowser.Error):
        return False


def main() -> int:
    arguments = _arguments()
    report_directory = _report_directory(arguments.report_root)
    metrics_path = report_directory / "metrics.csv"
    admin_password = os.environ.get(PASSWORD_ENV) or ""
    if not admin_password:
        if not sys.stdin.isatty():
            summary = {
                "schema_version": 1,
                "status": "environment_not_ready",
                "executed": False,
                "exit_code": 2,
                "reasons": ["admin_password_required"],
            }
            report_directory.joinpath("summary.json").write_text(
                json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print(json.dumps({"report_directory": str(report_directory)}))
            return 2
        admin_password = getpass.getpass("Reroll 管理员密码：")

    admin_cookies = http.cookiejar.CookieJar()
    admin = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(admin_cookies)
    )
    robot_openers: list[urllib.request.OpenerDirector] = []
    robot_sessions: list[tuple[str, http.cookiejar.CookieJar]] = []
    robot_credentials: list[str] = []
    account_ids: list[str] = []
    canvas_id = ""
    canvas_created_for_test = False
    canvas_purged = False
    accounts_removed = False
    sessions_removed = False
    failure = ""
    metrics: list[dict[str, object]] = []
    realtime_diagnostics: dict[str, object] = {
        "realtime_revision_stream_client_count": 0,
        "realtime_revision_gap_count": 0,
        "realtime_revision_reorder_count": 0,
        "realtime_revision_target": 0,
        "realtime_revision_stream_last_revisions": [],
        "realtime_revision_streams_caught_up": False,
        "realtime_resync_count": 0,
        "realtime_close_code_counts": {},
        "presence_pointer_hz": arguments.pointer_hz,
        "presence_pointer_updates_sent": 0,
        "presence_pointer_send_error_count": 0,
    }
    generation_outputs = 0
    initial_generation_outputs = 0
    initial_output_refs: set[str] = set()
    initial_node_count = 0
    human_generation_wait_seconds = 0.0
    runtime_ready_after = False
    final_node_projection_mismatch_count = 0
    final_node_projection_checked = False
    suffix = uuid.uuid4().hex[:10]
    mutation_namespace = f"live-acceptance-{suffix}"
    robot_password = secrets.token_urlsafe(24)
    human_url = ""
    try:
        runtime = _json_request(admin, arguments.base_url, "/api/runtime/status")
        if str(runtime.get("stage") or "") != "ready":
            raise RuntimeError("existing_service_not_ready")
        if int(runtime.get("blocking_generation_runs") or 0):
            raise RuntimeError("active_generation_runs")
        _json_request(
            admin,
            arguments.base_url,
            "/api/auth/login",
            method="POST",
            payload={
                "username": arguments.admin_username,
                "password": admin_password,
            },
        )
        current = _json_request(admin, arguments.base_url, "/api/auth/me")
        user = current.get("user")
        if not isinstance(user, dict) or str(user.get("role") or "") != "admin":
            raise RuntimeError("admin_session_required")
        projects = _json_request(admin, arguments.base_url, "/api/projects").get(
            "projects"
        )
        if not isinstance(projects, list) or not projects:
            raise RuntimeError("default_project_unavailable")
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
            raise RuntimeError("default_project_unavailable")
        project_id = str(default_project["id"])
        registration = _json_request(
            admin,
            arguments.base_url,
            "/api/auth/registration",
        )
        if not bool(registration.get("enabled", False)):
            raise RuntimeError("robot_registration_disabled")
        remaining_accounts = int(
            registration.get("remaining", arguments.robot_count) or 0
        )
        robot_account_count = min(arguments.robot_count, remaining_accounts)
        if robot_account_count < 1:
            raise RuntimeError("no_temporary_robot_account_capacity")
        for index in range(1, robot_account_count + 1):
            username = f"acceptance_robot_{suffix}_{index:02d}"
            registered = _json_request(
                urllib.request.build_opener(),
                arguments.base_url,
                "/api/auth/register",
                method="POST",
                payload={
                    "username": username,
                    "display_name": f"验收机器人 {index:02d}",
                    "password": robot_password,
                },
            )
            application = registered.get("application")
            if not isinstance(application, dict) or not application.get("id"):
                raise RuntimeError("robot_registration_failed")
            approved = _json_request(
                admin,
                arguments.base_url,
                f"/api/admin/account-applications/{application['id']}/approve",
                method="POST",
            )
            robot_user = approved.get("user")
            if not isinstance(robot_user, dict) or not robot_user.get("id"):
                raise RuntimeError("robot_approval_failed")
            user_id = str(robot_user["id"])
            account_ids.append(user_id)
            _json_request(
                admin,
                arguments.base_url,
                f"/api/admin/accounts/{user_id}/project-permissions",
                method="PUT",
                payload={"project_ids": [project_id]},
            )
            robot_credentials.append(username)
        for index in range(1, arguments.robot_count + 1):
            username = robot_credentials[(index - 1) % len(robot_credentials)]
            cookies = http.cookiejar.CookieJar()
            robot = urllib.request.build_opener(
                urllib.request.HTTPCookieProcessor(cookies)
            )
            _json_request(
                robot,
                arguments.base_url,
                "/api/auth/login",
                method="POST",
                payload={"username": username, "password": robot_password},
            )
            robot_openers.append(robot)
            robot_sessions.append((f"robot-{index:02d}", cookies))
        if arguments.canvas_id:
            existing = _json_request(
                admin,
                arguments.base_url,
                f"/api/canvases/{urllib.parse.quote(arguments.canvas_id)}",
            )
            canvas = existing.get("canvas")
            if not isinstance(canvas, dict) or not canvas.get("id"):
                raise RuntimeError("existing_test_canvas_unavailable")
            if str(canvas.get("kind") or "smart") != "smart":
                raise RuntimeError("existing_test_canvas_not_smart")
            canvas_id = str(canvas["id"])
        else:
            created = _json_request(
                admin,
                arguments.base_url,
                "/api/canvases",
                method="POST",
                payload={
                    "title": f"10 人协作验收 {suffix}",
                    "icon": "activity",
                    "kind": "smart",
                },
            )
            canvas = created.get("canvas")
            if not isinstance(canvas, dict) or not canvas.get("id"):
                raise RuntimeError("test_canvas_creation_failed")
            canvas_id = str(canvas["id"])
            canvas_created_for_test = True
        initial_node_count = len(
            [
                node
                for node in canvas.get("nodes") or []
                if isinstance(node, dict)
            ]
        )
        initial_output_refs = _generation_output_refs(canvas)
        initial_generation_outputs = len(initial_output_refs)
        for robot in robot_openers:
            visible = _json_request(
                robot,
                arguments.base_url,
                f"/api/canvases?project={urllib.parse.quote(project_id)}",
            ).get("canvases")
            if not isinstance(visible, list) or canvas_id not in {
                str(item.get("id") or "")
                for item in visible
                if isinstance(item, dict)
            }:
                raise RuntimeError("robot_canvas_visibility_failed")
        human_url = (
            f"{arguments.base_url}/static/smart-canvas.html?"
            f"id={urllib.parse.quote(canvas_id)}"
        )
        if not arguments.start_immediately:
            print(f"请打开并加入测试画布：{human_url}", file=sys.stderr)
            if arguments.open_human_canvas and not _open_human_canvas(human_url):
                print(
                    "未能自动打开浏览器，请复制上面的地址手动打开。",
                    file=sys.stderr,
                )
            input("准备好后按 Enter，9 个机器人将开始操作：")
        metrics, realtime_diagnostics, robot_failure = asyncio.run(
            _run_robot_mutations(
                base_url=arguments.base_url,
                canvas_id=canvas_id,
                robot_sessions=robot_sessions,
                rounds=arguments.robot_rounds,
                interval_seconds=arguments.round_interval_seconds,
                pointer_hz=arguments.pointer_hz,
                mutation_namespace=mutation_namespace,
            )
        )
        if robot_failure:
            raise RuntimeError(robot_failure)
        final = _json_request(
            admin,
            arguments.base_url,
            f"/api/canvases/{canvas_id}",
        ).get("canvas")
        if not isinstance(final, dict):
            raise RuntimeError("final_canvas_projection_unavailable")
        expected_nodes = {
            f"{mutation_namespace}-robot-node-{index:02d}"
            for index in range(1, arguments.robot_count + 1)
        }
        actual_nodes = {
            str(node.get("id") or "")
            for node in final.get("nodes") or []
            if isinstance(node, dict)
        }
        if not expected_nodes <= actual_nodes:
            raise RuntimeError("robot_nodes_missing_from_final_canvas")
        final_nodes_by_id = {
            str(node.get("id") or ""): node
            for node in final.get("nodes") or []
            if isinstance(node, dict)
        }
        expected_move_offset = max(0, arguments.robot_rounds - 1) * 8
        final_node_projection_mismatch_count = sum(
            final_nodes_by_id.get(node_id, {}).get("x")
            != 120 + robot_index * 150 + expected_move_offset
            or final_nodes_by_id.get(node_id, {}).get("y")
            != 160 + robot_index * 80
            for robot_index in range(arguments.robot_count)
            for node_id in [
                f"{mutation_namespace}-robot-node-{robot_index + 1:02d}"
            ]
        )
        final_node_projection_checked = True
        if final_node_projection_mismatch_count:
            raise RuntimeError("robot_final_node_projection_mismatch")
        generation_outputs = len(
            _generation_output_refs(final) - initial_output_refs
        )
        if (
            arguments.require_human_generation
            and generation_outputs < 1
            and arguments.human_generation_grace_seconds > 0
        ):
            wait_started = time.monotonic()
            deadline = (
                wait_started + arguments.human_generation_grace_seconds
            )
            while generation_outputs < 1:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                time.sleep(min(1.0, remaining))
                observed = _json_request(
                    admin,
                    arguments.base_url,
                    f"/api/canvases/{canvas_id}",
                ).get("canvas")
                if not isinstance(observed, dict):
                    raise RuntimeError("generation_grace_canvas_unavailable")
                final = observed
                generation_outputs = len(
                    _generation_output_refs(final) - initial_output_refs
                )
            human_generation_wait_seconds = round(
                time.monotonic() - wait_started,
                3,
            )
        latencies = [float(metric["ack_latency_ms"]) for metric in metrics]
        if _percentile(latencies, 0.95) > arguments.ack_p95_gate_ms:
            raise RuntimeError("robot_ack_p95_gate_failed")
        if _percentile(latencies, 0.99) > arguments.ack_p99_gate_ms:
            raise RuntimeError("robot_ack_p99_gate_failed")
        if arguments.require_human_generation and generation_outputs < 1:
            raise RuntimeError("manual_generation_not_observed")
    except (Exception, KeyboardInterrupt) as exc:
        failure = str(exc) or type(exc).__name__
    finally:
        try:
            runtime_after = _json_request(
                admin, arguments.base_url, "/api/runtime/status"
            )
            runtime_ready_after = str(runtime_after.get("stage") or "") == "ready"
            cleanup_blocked = int(
                runtime_after.get("blocking_generation_runs") or 0
            ) > 0
        except RuntimeError:
            cleanup_blocked = True
        if (
            canvas_id
            and canvas_created_for_test
            and arguments.cleanup_test_canvas
            and not cleanup_blocked
        ):
            try:
                _json_request(
                    admin,
                    arguments.base_url,
                    f"/api/canvases/{canvas_id}",
                    method="DELETE",
                )
                _json_request(
                    admin,
                    arguments.base_url,
                    f"/api/canvases/{canvas_id}/purge",
                    method="DELETE",
                )
                canvas_purged = True
            except RuntimeError:
                pass
        sessions_removed = True
        for robot in robot_openers:
            try:
                _json_request(
                    robot,
                    arguments.base_url,
                    "/api/auth/logout",
                    method="POST",
                )
            except RuntimeError:
                sessions_removed = False
        accounts_removed = bool(account_ids) and not cleanup_blocked
        if not cleanup_blocked:
            for user_id in account_ids:
                try:
                    _json_request(
                        admin,
                        arguments.base_url,
                        f"/api/admin/accounts/{user_id}",
                        method="DELETE",
                    )
                except RuntimeError:
                    accounts_removed = False

    with metrics_path.open("w", newline="", encoding="utf-8") as metrics_file:
        writer = csv.DictWriter(
            metrics_file,
            fieldnames=(
                "timestamp",
                "client",
                "operation_id",
                "round_number",
                "queue_position",
                "operation",
                "placement_conflict_retries",
                "realtime_resync_retries",
                "status",
                "ack_latency_ms",
                "revision",
            ),
        )
        writer.writeheader()
        writer.writerows(metrics)
    latencies = [float(metric["ack_latency_ms"]) for metric in metrics]
    expected_count = arguments.robot_count * arguments.robot_rounds
    operation_ids = [
        str(metric.get("operation_id") or "") for metric in metrics
    ]
    expected_operation_ids = {
        f"{mutation_namespace}:robot-{robot_index + 1:02d}:"
        f"round-{round_index + 1:04d}"
        for round_index in range(arguments.robot_rounds)
        for robot_index in range(arguments.robot_count)
    }
    revisions = [int(metric["revision"]) for metric in metrics]
    robot_ack_revisions_unique = len(revisions) == len(set(revisions))
    revision_sequence_contiguous = (
        int(realtime_diagnostics["realtime_revision_stream_client_count"])
        == arguments.robot_count
        and int(realtime_diagnostics["realtime_revision_gap_count"]) == 0
        and int(realtime_diagnostics["realtime_revision_reorder_count"]) == 0
        and bool(realtime_diagnostics["realtime_revision_streams_caught_up"])
    )
    operation_ids_unique = len(operation_ids) == len(set(operation_ids))
    operation_ids_complete = set(operation_ids) == expected_operation_ids
    final_node_projection_consistent = (
        final_node_projection_checked
        and final_node_projection_mismatch_count == 0
    )
    robot_ack_p95_ms = _percentile(latencies, 0.95)
    robot_ack_p99_ms = _percentile(latencies, 0.99)
    ack_latency_gate_passed = (
        bool(latencies)
        and robot_ack_p95_ms <= arguments.ack_p95_gate_ms
        and robot_ack_p99_ms <= arguments.ack_p99_gate_ms
    )
    node_move_queue_position_distribution = {}
    for queue_position in range(1, arguments.robot_count + 1):
        position_latencies = [
            float(metric["ack_latency_ms"])
            for metric in metrics
            if metric["operation"] == "node_move"
            and int(metric.get("queue_position") or 0) == queue_position
        ]
        node_move_queue_position_distribution[queue_position] = {
            "sample_count": len(position_latencies),
            "p50_ms": (
                round(statistics.median(position_latencies), 3)
                if position_latencies
                else 0
            ),
            "p95_ms": _percentile(position_latencies, 0.95),
            "p99_ms": _percentile(position_latencies, 0.99),
        }
    passed = (
        not failure
        and len(metrics) == expected_count
        and operation_ids_unique
        and operation_ids_complete
        and robot_ack_revisions_unique
        and revision_sequence_contiguous
        and final_node_projection_consistent
        and ack_latency_gate_passed
    )
    summary = {
        "schema_version": 1,
        "status": "passed" if passed else "failed",
        "executed": True,
        "exit_code": 0 if passed else 1,
        "service_mode": "existing",
        "base_url": arguments.base_url,
        "robot_count": arguments.robot_count,
        "robot_session_count": len(robot_sessions),
        "robot_account_count": len(account_ids),
        "distinct_authenticated_actor_count": 1 + len(account_ids),
        "human_participant_count": 1,
        "robot_rounds": arguments.robot_rounds,
        "robot_mutation_count": len(metrics),
        "robot_node_create_count": sum(
            metric["operation"] == "node_create" for metric in metrics
        ),
        "robot_node_move_count": sum(
            metric["operation"] == "node_move" for metric in metrics
        ),
        "placement_conflict_retry_count": sum(
            int(metric.get("placement_conflict_retries") or 0)
            for metric in metrics
        ),
        "operation_ids_unique": operation_ids_unique,
        "operation_ids_complete": operation_ids_complete,
        "robot_ack_revisions_unique": robot_ack_revisions_unique,
        "revision_sequence_contiguous": revision_sequence_contiguous,
        **realtime_diagnostics,
        "final_node_projection_consistent": final_node_projection_consistent,
        "final_node_projection_mismatch_count": (
            final_node_projection_mismatch_count
        ),
        "robot_ack_p50_ms": (
            round(statistics.median(latencies), 3) if latencies else 0
        ),
        "robot_ack_p95_ms": robot_ack_p95_ms,
        "robot_ack_p99_ms": robot_ack_p99_ms,
        "ack_p95_gate_ms": arguments.ack_p95_gate_ms,
        "ack_p99_gate_ms": arguments.ack_p99_gate_ms,
        "ack_latency_gate_passed": ack_latency_gate_passed,
        "node_move_queue_position_distribution": (
            node_move_queue_position_distribution
        ),
        "canvas_id": canvas_id,
        "canvas_source": "created" if canvas_created_for_test else "existing",
        "mutation_namespace": mutation_namespace,
        "initial_node_count": initial_node_count,
        "initial_generation_output_count": initial_generation_outputs,
        "human_canvas_url": human_url,
        "manual_generation_observed": generation_outputs > 0,
        "manual_generation_output_count": generation_outputs,
        "human_generation_grace_seconds": (
            arguments.human_generation_grace_seconds
        ),
        "human_generation_wait_seconds": human_generation_wait_seconds,
        "generation_requests_submitted": 0,
        "existing_service_left_running": runtime_ready_after,
        "reasons": [failure] if failure else [],
    }
    cleanup = {
        "schema_version": 1,
        "cleanup_allowlist_source": "public_create_responses",
        "canvas_ids": (
            [canvas_id]
            if canvas_id
            and canvas_created_for_test
            and arguments.cleanup_test_canvas
            else []
        ),
        "account_ids": account_ids,
        "canvas_purged": canvas_purged,
        "accounts_removed": accounts_removed,
        "sessions_removed": sessions_removed,
        "generated_media_deletion_attempt_count": 0,
        "out_of_allowlist_deletion_attempt_count": 0,
    }
    report_directory.joinpath("summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    report_directory.joinpath("cleanup.json").write_text(
        json.dumps(cleanup, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"report_directory": str(report_directory)}))
    return int(summary["exit_code"])


if __name__ == "__main__":
    raise SystemExit(main())
