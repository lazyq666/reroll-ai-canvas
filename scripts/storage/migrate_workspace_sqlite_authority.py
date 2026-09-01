#!/usr/bin/env python3
"""Run or roll back the service-stopped Workspace SQLite authority migration."""

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

from infinite_canvas.offline_sqlite_migration import (
    migrate_workspace_sqlite_authority,
    rollback_workspace_sqlite_authority,
)


def _absolute_path(parser: argparse.ArgumentParser, value: Path, label: str) -> Path:
    expanded = value.expanduser()
    if not expanded.is_absolute():
        parser.error(f"{label} must be an absolute path")
    return expanded.resolve()


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("migrate", "rollback"))
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--migration-id", required=True)
    parser.add_argument("--report-directory", type=Path, required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:3001")
    parser.add_argument("--confirm-service-stopped", action="store_true")
    parser.add_argument(
        "--quarantine-missing-history-id",
        action="append",
        default=[],
        help=(
            "Explicitly omit one irrecoverable Global History record while "
            "preserving the original JSON in recovery/legacy; repeat per ID"
        ),
    )
    parser.add_argument(
        "--confirm-quarantine-broken-history",
        action="store_true",
        help="Confirm that every listed History output is irrecoverably missing",
    )
    arguments = parser.parse_args()
    if not arguments.confirm_service_stopped:
        parser.error("--confirm-service-stopped is required")
    if bool(arguments.quarantine_missing_history_id) != bool(
        arguments.confirm_quarantine_broken_history
    ):
        parser.error(
            "--quarantine-missing-history-id and "
            "--confirm-quarantine-broken-history must be used together"
        )
    if arguments.action == "rollback" and arguments.quarantine_missing_history_id:
        parser.error("History quarantine options are only valid for migrate")
    arguments.workspace = _absolute_path(
        parser, arguments.workspace, "--workspace"
    )
    arguments.report_directory = _absolute_path(
        parser, arguments.report_directory, "--report-directory"
    )
    parsed = urllib.parse.urlparse(arguments.base_url)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or not parsed.port
    ):
        parser.error("--base-url must be an explicit localhost HTTP service")
    arguments.host = parsed.hostname
    arguments.port = int(parsed.port)
    return arguments


def _assert_service_stopped(host: str, port: int) -> None:
    try:
        connection = socket.create_connection((host, port), timeout=1)
    except OSError:
        return
    connection.close()
    raise RuntimeError(f"localhost:{port} 仍在监听，请先停止服务")


def main() -> int:
    arguments = _arguments()
    _assert_service_stopped(arguments.host, arguments.port)
    if arguments.action == "migrate":
        result = migrate_workspace_sqlite_authority(
            arguments.workspace,
            migration_id=arguments.migration_id,
            report_directory=arguments.report_directory,
            quarantine_missing_global_history_ids=(
                arguments.quarantine_missing_history_id
            ),
        )
        payload = {
            "status": result.status,
            "migration_id": result.migration_id,
            "manifest": str(result.manifest),
            "legacy_archive_report": str(result.legacy_archive_report),
            "report": str(result.report),
        }
    else:
        result = rollback_workspace_sqlite_authority(
            arguments.workspace,
            migration_id=arguments.migration_id,
            report_directory=arguments.report_directory,
        )
        payload = {
            "status": "complete",
            "authority": "json",
            "migration_id": result.migration_id,
            "restored_legacy_report": str(result.restored_legacy_report),
            "retired_sqlite_directory": str(result.retired_sqlite_directory),
            "report": str(result.report),
        }
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
