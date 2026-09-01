#!/usr/bin/env python3
"""Run the Issue #196 authenticated Presence + Mutation load gate."""

from __future__ import annotations

import argparse
import asyncio
from collections import deque
import csv
import hashlib
import http.cookiejar
import json
import math
from pathlib import Path
import subprocess
import time
import urllib.parse
import urllib.request
import uuid
from typing import Any

import websockets


FORMAL_ACCOUNT_COUNT = 10
FORMAL_DURATION_SECONDS = 30 * 60
FORMAL_POINTER_HZ = 10
FORMAL_MUTATIONS_PER_SECOND = 20
MAX_WEBSOCKET_MESSAGE_BYTES = 16 * 1024 * 1024
POINTER_LATENCY_RETENTION_SECONDS = 30.0
FORMAL_SAMPLE_COMPLETION_RATIO = 0.95
RSS_GROWTH_GATE_BYTES = 128 * 1024 * 1024


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=("presence", "baseline"),
        default="presence",
        help="run the Presence load or its controlled no-Pointer baseline",
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:3000")
    parser.add_argument("--canvas-id", default="")
    parser.add_argument("--accounts-json", type=Path)
    parser.add_argument("--duration-seconds", type=int, default=FORMAL_DURATION_SECONDS)
    parser.add_argument("--pointer-hz", type=int)
    parser.add_argument(
        "--mutations-per-second",
        type=int,
        default=FORMAL_MUTATIONS_PER_SECOND,
    )
    parser.add_argument("--slow-client-index", type=int, default=9)
    parser.add_argument("--server-pid", type=int)
    parser.add_argument("--baseline-summary", type=Path)
    parser.add_argument("--report-directory", type=Path, required=True)
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--confirm-formal-baseline", action="store_true")
    parser.add_argument("--confirm-formal-load", action="store_true")
    result = parser.parse_args()
    if result.pointer_hz is None:
        result.pointer_hz = 0 if result.mode == "baseline" else FORMAL_POINTER_HZ
    if result.duration_seconds < 1:
        parser.error("--duration-seconds must be positive")
    if result.mutations_per_second < 1:
        parser.error("--mutations-per-second must be positive")
    if result.mode == "baseline" and result.pointer_hz != 0:
        parser.error("baseline mode requires --pointer-hz 0")
    if result.mode == "presence" and result.pointer_hz < 1:
        parser.error("presence mode requires --pointer-hz to be positive")
    if not result.plan_only and (not result.canvas_id or result.accounts_json is None):
        parser.error("--canvas-id and --accounts-json are required for execution")
    if result.confirm_formal_baseline and result.confirm_formal_load:
        parser.error("formal baseline and Presence confirmations are mutually exclusive")
    if (result.confirm_formal_baseline or result.confirm_formal_load) and result.plan_only:
        parser.error("formal confirmation cannot be combined with --plan-only")
    if result.confirm_formal_baseline and result.mode != "baseline":
        parser.error("--confirm-formal-baseline requires --mode baseline")
    if result.confirm_formal_load and result.mode != "presence":
        parser.error("--confirm-formal-load requires --mode presence")
    return result


def formal_plan() -> dict[str, Any]:
    return {
        "account_count": FORMAL_ACCOUNT_COUNT,
        "baseline_duration_seconds": FORMAL_DURATION_SECONDS,
        "baseline_pointer_updates_per_account_per_second": 0,
        "duration_seconds": FORMAL_DURATION_SECONDS,
        "pointer_updates_per_account_per_second": FORMAL_POINTER_HZ,
        "mutations_per_second": FORMAL_MUTATIONS_PER_SECOND,
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
    }


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[max(0, math.ceil(len(ordered) * fraction) - 1)], 3)


def read_accounts(path: Path) -> list[dict[str, str]]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, list):
        raise ValueError("accounts JSON must be a list")
    accounts = []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("every account entry must be an object")
        username = str(item.get("username") or "").strip()
        password = str(item.get("password") or "")
        if not username or not password:
            raise ValueError("every account requires username and password")
        accounts.append({"username": username, "password": password})
    if len({item["username"] for item in accounts}) != len(accounts):
        raise ValueError("accounts must be unique")
    return accounts


def login(base_url: str, account: dict[str, str]) -> tuple[str, str]:
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/auth/login",
        data=json.dumps(account).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with opener.open(request, timeout=10) as response:
        payload = json.load(response)
    user = payload.get("user") or {}
    cookie_header = "; ".join(f"{cookie.name}={cookie.value}" for cookie in jar)
    if not cookie_header or not user.get("id"):
        raise RuntimeError(f"login failed for {account['username']}")
    return cookie_header, str(user["id"])


def authenticated_json(base_url: str, cookie_header: str, path: str) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        headers={"Cookie": cookie_header},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        value = json.load(response)
    if not isinstance(value, dict):
        raise RuntimeError(f"{path} returned a non-object")
    return value


def rss_bytes(pid: int | None) -> int:
    if not pid:
        return 0
    try:
        completed = subprocess.run(
            ["/bin/ps", "-o", "rss=", "-p", str(pid)],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    except OSError:
        # A restricted test runner may deny process inspection. Keep the
        # Event Loop probe alive and report the RSS gate as unavailable.
        return 0
    try:
        return int(completed.stdout.strip()) * 1024 if completed.returncode == 0 else 0
    except ValueError:
        return 0


async def receive_until(connection: Any, expected: str) -> dict[str, Any]:
    while True:
        message = json.loads(await asyncio.wait_for(connection.recv(), timeout=10))
        if isinstance(message, dict) and message.get("type") == expected:
            return message


async def run_load(options: argparse.Namespace, accounts: list[dict[str, str]]) -> dict[str, Any]:
    parsed = urllib.parse.urlparse(options.base_url)
    websocket_scheme = "wss" if parsed.scheme == "https" else "ws"
    websocket_base = f"{websocket_scheme}://{parsed.netloc}"
    sessions = [await asyncio.to_thread(login, options.base_url, item) for item in accounts]
    connections = []
    initial_revisions: list[int] = []
    participant_ids: list[str] = []
    for index, (cookie_header, _account_id) in enumerate(sessions):
        client_id = urllib.parse.quote(f"presence-load-{index + 1}-{uuid.uuid4().hex[:8]}")
        connection = await websockets.connect(
            f"{websocket_base}/ws/canvases/{urllib.parse.quote(options.canvas_id)}?client_id={client_id}",
            additional_headers={"Cookie": cookie_header},
            proxy=None,
            open_timeout=10,
            close_timeout=3,
            max_size=MAX_WEBSOCKET_MESSAGE_BYTES,
            max_queue=64,
        )
        canvas_snapshot = await receive_until(connection, "canvas_snapshot")
        presence_snapshot = await receive_until(connection, "presence_snapshot")
        connections.append(connection)
        initial_revisions.append(int(canvas_snapshot.get("revision") or 0))
        participant_ids.append(str(presence_snapshot.get("self_participant_id") or ""))

    if len(set(participant_ids)) != len(accounts) or not all(participant_ids):
        raise RuntimeError("accounts did not receive unique Presence participant IDs")
    if len(set(initial_revisions)) != 1:
        raise RuntimeError("clients opened at different Canvas revisions")

    stop = asyncio.Event()
    send_stop = asyncio.Event()
    started_at: dict[int, float] = {}
    started_order: deque[tuple[int, float]] = deque()
    mutation_started_at: dict[str, float] = {}
    pointer_latencies: list[float] = []
    mutation_latencies: list[float] = []
    pointer_receipts = [0 for _ in connections]
    pointer_sent_sequences = [0 for _ in connections]
    pointer_latest_received = [
        [0 for _ in connections]
        for _ in connections
    ]
    latest_revisions = initial_revisions[:]
    revision_errors: list[str] = []
    protocol_errors: list[str] = []
    event_loop_lags: list[float] = []
    event_loop_sequence = 0
    event_loop_interval = 0
    rss_samples: list[int] = []

    async def receiver(index: int, connection: Any) -> None:
        try:
            while not stop.is_set():
                raw = await connection.recv()
                message = json.loads(raw)
                message_type = str(message.get("type") or "")
                if message_type == "presence_batch":
                    for update in message.get("updates") or []:
                        cursor = update.get("cursor") if isinstance(update, dict) else None
                        if not isinstance(cursor, dict):
                            continue
                        marker = int(float(cursor.get("x", -1)))
                        sent = started_at.get(marker)
                        if sent is not None:
                            pointer_receipts[index] += 1
                            sender_index = marker // 1_000_000_000 - 1
                            sequence = marker % 1_000_000_000
                            if 0 <= sender_index < len(connections):
                                pointer_latest_received[index][sender_index] = max(
                                    pointer_latest_received[index][sender_index],
                                    sequence,
                                )
                            if index == 0:
                                pointer_latencies.append((time.perf_counter() - sent) * 1000)
                elif message_type == "canvas_mutation" and not message.get("duplicate"):
                    revision = int(message.get("revision") or 0)
                    if revision != latest_revisions[index] + 1:
                        revision_errors.append(
                            f"client {index}: {latest_revisions[index]} -> {revision}"
                        )
                    latest_revisions[index] = revision
                    operation_id = str(message.get("operation_id") or "")
                    sent = mutation_started_at.pop(operation_id, None) if index == 0 else None
                    if index == 0 and sent is not None:
                        mutation_latencies.append((time.perf_counter() - sent) * 1000)
                elif message_type == "mutation_rejected":
                    protocol_errors.append(f"mutation_rejected:{message.get('code')}")
                elif message_type == "canvas_snapshot":
                    protocol_errors.append("unexpected_canvas_resync")
        except websockets.ConnectionClosed as error:
            if not stop.is_set():
                protocol_errors.append(f"connection_{index}_closed:{error.code}")

    async def pointer_sender(index: int, connection: Any) -> None:
        interval = 1 / options.pointer_hz
        sequence = 0
        deadline = time.perf_counter()
        while not send_stop.is_set():
            sequence += 1
            marker = (index + 1) * 1_000_000_000 + sequence
            started = time.perf_counter()
            started_at[marker] = started
            started_order.append((marker, started))
            pointer_sent_sequences[index] = sequence
            retention_cutoff = started - POINTER_LATENCY_RETENTION_SECONDS
            while started_order and started_order[0][1] < retention_cutoff:
                expired_marker, expired_started = started_order.popleft()
                if started_at.get(expired_marker) == expired_started:
                    started_at.pop(expired_marker, None)
            await connection.send(json.dumps({
                "type": "presence_update",
                "seq": sequence,
                "cursor": {"x": marker, "y": index + sequence / 1000},
            }, separators=(",", ":")))
            deadline += interval
            await asyncio.sleep(max(0, deadline - time.perf_counter()))

    async def mutation_sender(mutation_connections: list[Any]) -> None:
        interval = 1 / options.mutations_per_second
        sequence = 0
        deadline = time.perf_counter()
        while not send_stop.is_set():
            sequence += 1
            connection_index = (sequence - 1) % len(mutation_connections)
            connection = mutation_connections[connection_index]
            operation_id = f"presence-load:{sequence}:{uuid.uuid4().hex[:8]}"
            mutation_started_at[operation_id] = time.perf_counter()
            await connection.send(json.dumps({
                "type": "canvas_mutation",
                "canvas_id": options.canvas_id,
                "operation": {
                    "operation_id": operation_id,
                    "base_revision": latest_revisions[connection_index],
                    "changes": {"canvas_updates": [{
                        "path": ["title"],
                        "value": f"Presence load {sequence}",
                    }]},
                },
            }, separators=(",", ":")))
            deadline += interval
            await asyncio.sleep(max(0, deadline - time.perf_counter()))

    async def slow_reader_probe() -> None:
        index = options.slow_client_index
        if index < 0 or index >= len(connections):
            return
        transport = connections[index].transport
        while not stop.is_set():
            await asyncio.sleep(5)
            if stop.is_set():
                return
            transport.pause_reading()
            await asyncio.sleep(0.4)
            transport.resume_reading()

    async def resource_probe() -> None:
        nonlocal event_loop_sequence, event_loop_interval
        while not stop.is_set():
            rss_samples.append(await asyncio.to_thread(rss_bytes, options.server_pid))
            try:
                payload = await asyncio.to_thread(
                    authenticated_json,
                    options.base_url,
                    sessions[0][0],
                    "/api/runtime/status?include_event_loop_lag=true"
                    f"&event_loop_lag_after_sequence={event_loop_sequence}",
                )
                snapshot = payload.get("event_loop_lag") or {}
                event_loop_interval = int(
                    snapshot.get("probe_interval_ms") or event_loop_interval
                )
                for sample in snapshot.get("samples") or []:
                    sequence = int(sample.get("sequence") or 0)
                    if sequence > event_loop_sequence:
                        event_loop_lags.append(float(sample.get("lag_ms") or 0))
                        event_loop_sequence = sequence
            except Exception as error:
                protocol_errors.append(f"resource_probe:{type(error).__name__}")
            await asyncio.sleep(2)

    tasks = [
        asyncio.create_task(
            receiver(index, connection),
            name=f"receiver-{index}",
        )
        for index, connection in enumerate(connections)
    ]
    if options.mode == "presence":
        tasks.extend(
            asyncio.create_task(
                pointer_sender(index, connection),
                name=f"pointer-sender-{index}",
            )
            for index, connection in enumerate(connections)
        )
    tasks.extend((
        # Round-robin the aggregate write target across the collaborating
        # accounts. One WebSocket receive loop intentionally serializes its
        # own messages; concentrating 20 mutation/s on a single connection
        # measures that client loop rather than the Canvas room target load.
        asyncio.create_task(mutation_sender(connections), name="mutation-sender"),
        asyncio.create_task(slow_reader_probe(), name="slow-reader-probe"),
        asyncio.create_task(resource_probe(), name="resource-probe"),
    ))
    try:
        await asyncio.sleep(options.duration_seconds)
        send_stop.set()
        await asyncio.sleep(1)
    finally:
        send_stop.set()
        stop.set()
        for task in tasks:
            task.cancel()
        task_results = await asyncio.gather(*tasks, return_exceptions=True)
        for task, task_result in zip(tasks, task_results):
            if isinstance(task_result, BaseException) and not isinstance(
                task_result,
                asyncio.CancelledError,
            ):
                protocol_errors.append(
                    f"task_{task.get_name()}:{type(task_result).__name__}"
                )
        await asyncio.gather(*(connection.close() for connection in connections), return_exceptions=True)

    final_canvas = await asyncio.to_thread(
        authenticated_json,
        options.base_url,
        sessions[0][0],
        f"/api/canvases/{urllib.parse.quote(options.canvas_id)}",
    )
    final_revision = int((final_canvas.get("canvas") or {}).get("revision") or 0)
    return {
        "pointer_latencies": pointer_latencies,
        "mutation_latencies": mutation_latencies,
        "pointer_receipts": pointer_receipts,
        "pointer_sent_sequences": pointer_sent_sequences,
        "pointer_latest_received": pointer_latest_received,
        "initial_revision": initial_revisions[0],
        "latest_revisions": latest_revisions,
        "final_revision": final_revision,
        "revision_errors": revision_errors,
        "protocol_errors": protocol_errors,
        "event_loop_lags": event_loop_lags,
        "event_loop_interval_ms": event_loop_interval,
        "rss_samples": [value for value in rss_samples if value > 0],
    }


def account_identity_digest(accounts: list[dict[str, str]]) -> str:
    return hashlib.sha256(
        "\n".join(sorted(item["username"] for item in accounts)).encode("utf-8")
    ).hexdigest()


def summarize(options: argparse.Namespace, accounts: list[dict[str, str]], result: dict[str, Any]) -> dict[str, Any]:
    pointer_p95 = percentile(result["pointer_latencies"], 0.95)
    mutation_p95 = percentile(result["mutation_latencies"], 0.95)
    mutation_p99 = percentile(result["mutation_latencies"], 0.99)
    event_loop_p99 = percentile(result["event_loop_lags"], 0.99)
    baseline: dict[str, Any] = {}
    if options.baseline_summary:
        baseline = json.loads(options.baseline_summary.read_text(encoding="utf-8"))
    baseline_p95 = baseline.get("mutation_p95_ms")
    baseline_p99 = baseline.get("mutation_p99_ms")
    degradation_p95 = (
        round((mutation_p95 / float(baseline_p95) - 1) * 100, 3)
        if mutation_p95 is not None and baseline_p95 else None
    )
    degradation_p99 = (
        round((mutation_p99 / float(baseline_p99) - 1) * 100, 3)
        if mutation_p99 is not None and baseline_p99 else None
    )
    rss_values = result["rss_samples"]
    rss_growth = max(0, rss_values[-1] - rss_values[0]) if len(rss_values) >= 2 else None
    rss_peak_growth = (
        max(0, max(rss_values) - rss_values[0])
        if len(rss_values) >= 2
        else None
    )
    expected_final = result["initial_revision"] + len(result["mutation_latencies"])
    expected_mutation_samples = options.duration_seconds * options.mutations_per_second
    minimum_mutation_samples = math.floor(
        expected_mutation_samples * FORMAL_SAMPLE_COMPLETION_RATIO
    )
    pointer_final_lag_by_client = [
        [
            max(0, sent - received)
            for sent, received in zip(
                result["pointer_sent_sequences"],
                client_received,
            )
        ]
        for client_received in result["pointer_latest_received"]
    ]
    gates: dict[str, bool] = {
        "mutation_sample_completion": (
            len(result["mutation_latencies"]) >= minimum_mutation_samples
        ),
        "event_loop": (
            result["event_loop_interval_ms"] == 10
            and event_loop_p99 is not None and event_loop_p99 <= 50
        ),
        "revision": (
            not result["revision_errors"]
            and len(set(result["latest_revisions"])) == 1
            and result["final_revision"] == result["latest_revisions"][0]
            and result["final_revision"] == expected_final
        ),
        "transport": not result["protocol_errors"],
        "rss_bounded": (
            rss_peak_growth is not None
            and rss_peak_growth <= RSS_GROWTH_GATE_BYTES
        ),
        "slow_client_document_reliable": (
            0 <= options.slow_client_index < len(result["latest_revisions"])
            and result["latest_revisions"][options.slow_client_index] == result["final_revision"]
        ),
    }
    if options.mode == "presence":
        gates.update({
            "pointer_latency": pointer_p95 is not None and pointer_p95 <= 250,
            "pointer_latest_wins": (
                bool(result["pointer_sent_sequences"])
                and all(result["pointer_sent_sequences"])
                and all(
                    lag == 0
                    for client_lags in pointer_final_lag_by_client
                    for lag in client_lags
                )
            ),
            "mutation_relative": (
                degradation_p95 is not None and degradation_p95 <= 20
                and degradation_p99 is not None and degradation_p99 <= 20
            ),
        })
    formal_shape = (
        len(accounts) == FORMAL_ACCOUNT_COUNT
        and options.duration_seconds == FORMAL_DURATION_SECONDS
        and options.pointer_hz == (
            0 if options.mode == "baseline" else FORMAL_POINTER_HZ
        )
        and options.mutations_per_second == FORMAL_MUTATIONS_PER_SECOND
    )
    return {
        "schema_version": 1,
        "status": "passed" if all(gates.values()) and formal_shape else "failed",
        "run_mode": options.mode,
        "formal_shape": formal_shape,
        "account_count": len(accounts),
        "duration_seconds": options.duration_seconds,
        "pointer_hz": options.pointer_hz,
        "mutations_per_second": options.mutations_per_second,
        "account_identity_digest": account_identity_digest(accounts),
        "server_pid": options.server_pid,
        "pointer_sample_count": len(result["pointer_latencies"]),
        "pointer_p95_ms": pointer_p95,
        "mutation_sample_count": len(result["mutation_latencies"]),
        "mutation_p95_ms": mutation_p95,
        "mutation_p99_ms": mutation_p99,
        "baseline_mutation_p95_ms": baseline_p95,
        "baseline_mutation_p99_ms": baseline_p99,
        "mutation_p95_degradation_percent": degradation_p95,
        "mutation_p99_degradation_percent": degradation_p99,
        "event_loop_sample_count": len(result["event_loop_lags"]),
        "event_loop_probe_interval_ms": result["event_loop_interval_ms"],
        "event_loop_p99_ms": event_loop_p99,
        "rss_sample_count": len(rss_values),
        "rss_growth_bytes": rss_growth,
        "rss_peak_growth_bytes": rss_peak_growth,
        "rss_growth_gate_bytes": RSS_GROWTH_GATE_BYTES,
        "initial_revision": result["initial_revision"],
        "final_revision": result["final_revision"],
        "pointer_receipts_by_client": result["pointer_receipts"],
        "pointer_sent_sequences": result["pointer_sent_sequences"],
        "pointer_latest_received_by_client_and_sender": result[
            "pointer_latest_received"
        ],
        "pointer_final_lag_by_client_and_sender": pointer_final_lag_by_client,
        "expected_mutation_sample_count": expected_mutation_samples,
        "minimum_mutation_sample_count": minimum_mutation_samples,
        "revision_errors": result["revision_errors"],
        "protocol_errors": result["protocol_errors"],
        "gates": gates,
    }


def validated_baseline(
    options: argparse.Namespace,
    accounts: list[dict[str, str]],
) -> dict[str, Any]:
    if options.baseline_summary is None:
        raise SystemExit("formal Presence load requires --baseline-summary")
    try:
        baseline = json.loads(options.baseline_summary.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as error:
        raise SystemExit("baseline summary is not readable JSON") from error
    expected = {
        "status": "passed",
        "run_mode": "baseline",
        "formal_shape": True,
        "account_count": FORMAL_ACCOUNT_COUNT,
        "duration_seconds": FORMAL_DURATION_SECONDS,
        "pointer_hz": 0,
        "mutations_per_second": FORMAL_MUTATIONS_PER_SECOND,
        "account_identity_digest": account_identity_digest(accounts),
        "server_pid": options.server_pid,
    }
    mismatches = [
        key
        for key, expected_value in expected.items()
        if baseline.get(key) != expected_value
    ]
    if mismatches:
        raise SystemExit(
            "baseline summary does not match the controlled formal shape: "
            + ", ".join(mismatches)
        )
    for key in ("mutation_p95_ms", "mutation_p99_ms"):
        value = baseline.get(key)
        if not isinstance(value, (int, float)) or value <= 0:
            raise SystemExit(f"baseline summary requires a positive {key}")
    return baseline


def write_report(directory: Path, summary: dict[str, Any], result: dict[str, Any] | None = None) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    directory.joinpath("summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if result is None:
        return
    with directory.joinpath("metrics.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(("kind", "latency_ms"))
        writer.writerows(("pointer", round(value, 3)) for value in result["pointer_latencies"])
        writer.writerows(("mutation", round(value, 3)) for value in result["mutation_latencies"])


def main() -> int:
    options = arguments()
    if options.plan_only:
        summary = {"schema_version": 1, "status": "plan_only", "formal_plan": formal_plan()}
        write_report(options.report_directory, summary)
        print(json.dumps(summary, ensure_ascii=False))
        return 0
    accounts = read_accounts(options.accounts_json)
    if options.confirm_formal_baseline:
        if len(accounts) != FORMAL_ACCOUNT_COUNT:
            raise SystemExit("formal baseline requires exactly 10 accounts")
        if options.server_pid is None:
            raise SystemExit("formal baseline requires --server-pid")
        if (
            options.duration_seconds != FORMAL_DURATION_SECONDS
            or options.pointer_hz != 0
            or options.mutations_per_second != FORMAL_MUTATIONS_PER_SECOND
        ):
            raise SystemExit("formal baseline parameters must match the Approved Feature Spec")
    if options.confirm_formal_load:
        if len(accounts) != FORMAL_ACCOUNT_COUNT:
            raise SystemExit("formal load requires exactly 10 accounts")
        if options.server_pid is None:
            raise SystemExit("formal load requires --server-pid")
        if (
            options.duration_seconds != FORMAL_DURATION_SECONDS
            or options.pointer_hz != FORMAL_POINTER_HZ
            or options.mutations_per_second != FORMAL_MUTATIONS_PER_SECOND
        ):
            raise SystemExit("formal load parameters must match the Approved Feature Spec")
        validated_baseline(options, accounts)
    result = asyncio.run(run_load(options, accounts))
    summary = summarize(options, accounts, result)
    write_report(options.report_directory, summary, result)
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if summary["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
