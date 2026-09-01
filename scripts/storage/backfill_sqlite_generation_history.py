#!/usr/bin/env python3
"""Backfill legacy Canvas JSON logs into an already-authoritative SQLite store."""

from __future__ import annotations

import argparse
import json
import socket
import sys
import urllib.parse
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from infinite_canvas.content import WorkspaceContent
from infinite_canvas.sqlite_generation_history_backfill import (
    backfill_sqlite_generation_history,
)
from infinite_canvas.workspace import Workspace


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--migration-id", required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:3001")
    parser.add_argument("--confirm-service-stopped", action="store_true")
    arguments = parser.parse_args()
    arguments.workspace = arguments.workspace.expanduser().resolve()
    parsed = urllib.parse.urlparse(arguments.base_url)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or not parsed.port
    ):
        parser.error("--base-url must be an explicit localhost HTTP service")
    arguments.host = parsed.hostname
    arguments.port = int(parsed.port)
    if not arguments.confirm_service_stopped:
        parser.error("--confirm-service-stopped is required")
    return arguments


def _assert_service_stopped(host: str, port: int) -> None:
    try:
        connection = socket.create_connection((host, port), timeout=1)
    except OSError:
        return
    connection.close()
    raise RuntimeError(f"localhost:{port} 仍在监听，请先停止服务")


def _workspace_id(workspace: Path) -> str:
    identity = workspace / ".infinite-canvas-workspace.json"
    try:
        payload = json.loads(identity.read_text(encoding="utf-8-sig"))
        workspace_id = str(payload.get("workspace_id") or "").strip()
    except (OSError, TypeError, ValueError) as exc:
        raise RuntimeError("无法读取 Workspace identity") from exc
    if not workspace_id:
        raise RuntimeError("Workspace identity 为空")
    return workspace_id


def main() -> int:
    arguments = _arguments()
    _assert_service_stopped(arguments.host, arguments.port)
    workspace = Workspace(
        directory=arguments.workspace,
        _records_directory=arguments.workspace / "data",
        _media_directory=arguments.workspace / "assets",
    )
    result = backfill_sqlite_generation_history(
        WorkspaceContent(workspace),
        workspace_id=_workspace_id(arguments.workspace),
        migration_id=arguments.migration_id,
    )
    print(
        json.dumps(
            {
                "status": "complete",
                "migration_id": result.migration_id,
                "source_log_count": result.source_log_count,
                "starting_log_count": result.starting_log_count,
                "imported_log_count": result.imported_log_count,
                "final_log_count": result.final_log_count,
                "source_fingerprint": result.source_fingerprint,
                "report": str(result.report),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
