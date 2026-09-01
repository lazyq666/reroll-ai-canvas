#!/usr/bin/env python3
"""Measure single-Node x/y Canvas Mutation commits in a temporary Authority."""

from __future__ import annotations

import argparse
import json
import logging
import math
import platform
import sqlite3
import statistics
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from infinite_canvas.canvas_store import (  # noqa: E402
    CanvasIntent,
    CanvasProjection,
    SqliteCanvasStore,
)


ADMIN = {
    "id": "performance-admin",
    "username": "performance-admin",
    "role": "admin",
    "status": "active",
}
STORE_P95_HARD_GATE_MS = 20.0
STORE_P95_TARGET_MS = 12.0


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--samples", type=int, default=50)
    arguments = parser.parse_args()
    if arguments.rounds < 1 or arguments.samples < 20:
        parser.error("--rounds must be positive and --samples must be at least 20")
    return arguments


def _percentile(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    rank = max(0, math.ceil(len(ordered) * percentile) - 1)
    return round(ordered[rank], 3)


def _fixture() -> dict[str, Any]:
    payload = "p" * 6650
    nodes = [
        {
            "id": f"node-{index:03d}",
            "type": "smart-prompt" if index % 2 else "smart-image",
            "x": index * 10,
            "y": index * -5,
            "prompt": payload,
            "metadata": {"fixture": True, "index": index},
        }
        for index in range(461)
    ]
    return {
        "id": "canvas-fast-path-performance",
        "kind": "smart",
        "title": "Synthetic Move Performance",
        "icon": "sparkles",
        "owner_id": ADMIN["id"],
        "owner_username": ADMIN["username"],
        "visibility": "shared",
        "created_by": ADMIN["id"],
        "updated_by": ADMIN["id"],
        "owner": "Synthetic Fixture",
        "color": "blue",
        "pinned": False,
        "project": "default",
        "created_at": 1,
        "updated_at": 1,
        "revision": 0,
        "settings": {"quality": "high"},
        "nodes": nodes,
        "connections": [
            {
                "from": f"node-{index:03d}",
                "to": f"node-{index + 1:03d}",
                "kind": "input",
            }
            for index in range(321)
        ],
    }


class _TraceHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__(logging.DEBUG)
        self.traces: list[dict[str, Any]] = []

    def emit(self, record: logging.LogRecord) -> None:
        message = record.getMessage()
        prefix = "canvas_mutation_timing "
        if message.startswith(prefix):
            self.traces.append(json.loads(message[len(prefix) :]))


def _commit_move(
    store: SqliteCanvasStore,
    revision: int,
    operation_id: str,
    value: float,
    *,
    force_generic: bool = False,
) -> tuple[int, float]:
    changes: dict[str, Any] = {
        "node_updates": [
            {"id": "node-000", "path": ["x"], "value": value}
        ]
    }
    if force_generic:
        changes["future_action"] = []
    started_ns = time.perf_counter_ns()
    commit = store.commit(
        "canvas-fast-path-performance",
        ADMIN,
        CanvasIntent.canvas_mutation(
            {
                "operation_id": operation_id,
                "base_revision": revision,
                "changes": changes,
            }
        ),
    )
    return commit.revision, (time.perf_counter_ns() - started_ns) / 1_000_000


def _round(round_index: int, sample_count: int) -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as temporary:
        database = Path(temporary) / "canvas-content.sqlite3"
        store = SqliteCanvasStore(
            database,
            workspace_id=f"synthetic-performance-{round_index}",
        )
        canvas = _fixture()
        store.commit(
            canvas["id"],
            ADMIN,
            CanvasIntent.import_canvas(
                canvas,
                operation_id=f"fixture:import-{round_index:02d}",
            ),
        )
        revision = 0
        for index in range(200):
            revision, _latency = _commit_move(
                store,
                revision,
                f"fixture:history-{round_index:02d}-{index:04d}",
                float(index),
            )

        with sqlite3.connect(str(database)) as connection:
            realtime_payload_bytes = int(
                connection.execute(
                    "SELECT length(payload_json) FROM canvas_realtime_state"
                ).fetchone()[0]
            )

        logger = logging.getLogger("infinite_canvas.canvas_store")
        previous_level = logger.level
        handler = _TraceHandler()
        logger.setLevel(logging.DEBUG)
        logger.addHandler(handler)
        try:
            fast_latencies = []
            for index in range(sample_count):
                revision, latency = _commit_move(
                    store,
                    revision,
                    f"measured:fast-{round_index:02d}-{index:04d}",
                    -index - 0.5,
                )
                fast_latencies.append(latency)
            generic_latencies = []
            for index in range(sample_count):
                revision, latency = _commit_move(
                    store,
                    revision,
                    f"measured:generic-{round_index:02d}-{index:04d}",
                    index + 0.25,
                    force_generic=True,
                )
                generic_latencies.append(latency)
        finally:
            logger.removeHandler(handler)
            logger.setLevel(previous_level)

        snapshot = store.read(
            canvas["id"], ADMIN, CanvasProjection.public_snapshot()
        ).canvas
        duplicate_operation = {
            "operation_id": f"measured:generic-{round_index:02d}-{sample_count - 1:04d}",
            "base_revision": revision - 1,
            "changes": {
                "node_updates": [
                    {
                        "id": "node-000",
                        "path": ["x"],
                        "value": sample_count - 1 + 0.25,
                    }
                ],
                "future_action": [],
            },
        }
        duplicate = store.commit(
            canvas["id"],
            ADMIN,
            CanvasIntent.canvas_mutation(duplicate_operation),
        )
        hit_traces = [trace for trace in handler.traces if trace.get("hit")]
        fallback_categories: dict[str, int] = {}
        for trace in handler.traces:
            category = str(trace.get("fallback") or "")
            if category:
                fallback_categories[category] = (
                    fallback_categories.get(category, 0) + 1
                )
        return {
            "round": round_index + 1,
            "fast_p50_ms": _percentile(fast_latencies, 0.50),
            "fast_p95_ms": _percentile(fast_latencies, 0.95),
            "fast_p99_ms": _percentile(fast_latencies, 0.99),
            "generic_p50_ms": _percentile(generic_latencies, 0.50),
            "generic_p95_ms": _percentile(generic_latencies, 0.95),
            "generic_p99_ms": _percentile(generic_latencies, 0.99),
            "fast_path_hit_rate": round(len(hit_traces) / sample_count, 4),
            "fallback_categories": fallback_categories,
            "realtime_payload_bytes": realtime_payload_bytes,
            "final_revision": revision,
            "final_projection_consistent": (
                snapshot["revision"] == revision
                and snapshot["nodes"][0]["x"] == sample_count - 1 + 0.25
                and len(snapshot["nodes"]) == 461
                and len(snapshot["connections"]) == 321
            ),
            "duplicate_receipt_consistent": (
                duplicate.duplicate and duplicate.revision == revision
            ),
        }


def main() -> int:
    arguments = _arguments()
    canvas = _fixture()
    rounds = [_round(index, arguments.samples) for index in range(arguments.rounds)]
    fast_p95_values = [float(item["fast_p95_ms"]) for item in rounds]
    generic_p95_values = [float(item["generic_p95_ms"]) for item in rounds]
    worst_fast_p95 = max(fast_p95_values)
    report = {
        "status": "passed" if worst_fast_p95 <= STORE_P95_HARD_GATE_MS else "failed",
        "scope": "offline_canvas_store_commit_seam",
        "queue_position_distribution": (
            "not_applicable; same-Canvas queue behavior is covered by Canvas Sync "
            "and requires the separate live multiplayer gate"
        ),
        "gate": {
            "p95_hard_gate_ms": STORE_P95_HARD_GATE_MS,
            "p95_target_ms": STORE_P95_TARGET_MS,
            "hard_gate_passed": worst_fast_p95 <= STORE_P95_HARD_GATE_MS,
            "target_passed": worst_fast_p95 <= STORE_P95_TARGET_MS,
        },
        "aggregate": {
            "worst_fast_p95_ms": round(worst_fast_p95, 3),
            "median_fast_p95_ms": round(statistics.median(fast_p95_values), 3),
            "median_generic_p95_ms": round(
                statistics.median(generic_p95_values), 3
            ),
            "median_p95_reduction_percent": round(
                (
                    1
                    - statistics.median(fast_p95_values)
                    / statistics.median(generic_p95_values)
                )
                * 100,
                1,
            ),
        },
        "fixture": {
            "node_count": len(canvas["nodes"]),
            "connection_count": len(canvas["connections"]),
            "node_payload_bytes": sum(
                len(
                    json.dumps(
                        node,
                        ensure_ascii=False,
                        sort_keys=True,
                        separators=(",", ":"),
                    ).encode("utf-8")
                )
                for node in canvas["nodes"]
            ),
            "history_count": 200,
            "sample_count_per_path_per_round": arguments.samples,
        },
        "environment": {
            "python": platform.python_version(),
            "sqlite": sqlite3.sqlite_version,
            "platform": platform.platform(),
            "machine": platform.machine(),
        },
        "rounds": rounds,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
