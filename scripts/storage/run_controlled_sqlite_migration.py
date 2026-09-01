#!/usr/bin/env python3
"""Trigger and verify the public controlled JSON/JSON to SQLite/SQLite cutover."""

from __future__ import annotations

import argparse
import getpass
import hashlib
import http.cookiejar
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path


PASSWORD_ENV = "INFINITE_CANVAS_MIGRATION_ADMIN_PASSWORD"
TERMINAL_RUN_STATUSES = {"succeeded", "failed", "cancelled", "discarded"}


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:3001")
    parser.add_argument("--admin-username", required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument(
        "--migration-id",
        default=datetime.now(timezone.utc).strftime("sqlite-cutover-%Y%m%dT%H%M%SZ"),
    )
    parser.add_argument("--confirm-stop-and-migrate", action="store_true")
    parser.add_argument("--restart-timeout-seconds", type=int, default=180)
    parser.add_argument("--report-root", type=Path, required=True)
    arguments = parser.parse_args()
    parsed = urllib.parse.urlparse(arguments.base_url)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or not parsed.port
    ):
        parser.error("--base-url must be an explicit localhost HTTP service")
    if not arguments.migration_id or len(arguments.migration_id) > 128:
        parser.error("--migration-id must be between 1 and 128 characters")
    if not all(
        character.isalnum() or character in "_.:-"
        for character in arguments.migration_id
    ):
        parser.error("--migration-id contains unsupported characters")
    if arguments.restart_timeout_seconds < 10:
        parser.error("--restart-timeout-seconds must be at least 10")
    arguments.base_url = arguments.base_url.rstrip("/")
    arguments.workspace = arguments.workspace.expanduser().resolve()
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
    timeout: float = 20,
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
        with opener.open(request, timeout=timeout) as response:
            decoded = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_code = ""
        try:
            error_payload = json.loads(exc.read().decode("utf-8"))
            if isinstance(error_payload, dict):
                error_code = str(error_payload.get("reason") or "")
        except (ValueError, UnicodeError):
            pass
        suffix = f":{error_code}" if error_code else ""
        raise RuntimeError(
            f"{method} {path} returned HTTP {exc.code}{suffix}"
        ) from exc
    except (OSError, ValueError, UnicodeError) as exc:
        raise RuntimeError(f"{method} {path} did not return usable JSON") from exc
    if not isinstance(decoded, dict):
        raise RuntimeError(f"{method} {path} returned a non-object payload")
    return decoded


def _non_terminal_run_count(generation_runs_path: Path) -> int:
    try:
        payload = json.loads(generation_runs_path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return 0
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("generation_runs_source_unreadable") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("runs"), list):
        raise RuntimeError("generation_runs_source_invalid")
    return sum(
        not isinstance(run, dict)
        or str(run.get("status") or "") not in TERMINAL_RUN_STATUSES
        for run in payload["runs"]
    )


def _sqlite_quick_check(database: Path) -> bool:
    if not database.is_file() or database.stat().st_size <= 0:
        return False
    uri = f"file:{urllib.parse.quote(str(database))}?mode=ro"
    try:
        connection = sqlite3.connect(uri, uri=True)
        row = connection.execute("PRAGMA quick_check").fetchone()
        connection.close()
    except sqlite3.Error:
        return False
    return bool(row and row[0] == "ok")


def _sqlite_generation_log_count(database: Path) -> int:
    uri = f"file:{urllib.parse.quote(str(database))}?mode=ro"
    try:
        connection = sqlite3.connect(uri, uri=True)
        row = connection.execute("SELECT COUNT(*) FROM canvas_logs").fetchone()
        connection.close()
    except sqlite3.Error as exc:
        raise RuntimeError("generation_history_sqlite_unreadable") from exc
    return int(row[0]) if row else -1


def _sqlite_global_publication_counts(database: Path) -> tuple[int, int, int]:
    uri = f"file:{urllib.parse.quote(str(database))}?mode=ro"
    try:
        connection = sqlite3.connect(uri, uri=True)
        history = int(
            connection.execute("SELECT COUNT(*) FROM generation_history").fetchone()[0]
        )
        receipts = int(
            connection.execute(
                "SELECT COUNT(*) FROM generation_publication_receipts"
            ).fetchone()[0]
        )
        pending = int(
            connection.execute(
                """
                SELECT COUNT(*) FROM generation_publication_receipts
                WHERE state <> 'completed'
                """
            ).fetchone()[0]
        )
        connection.close()
    except sqlite3.Error as exc:
        raise RuntimeError("global_generation_publication_sqlite_unreadable") from exc
    return history, receipts, pending


def _workspace_fingerprint(workspace: Path) -> str:
    return hashlib.sha256(str(workspace).encode("utf-8")).hexdigest()[:16]


def main() -> int:
    arguments = _arguments()
    report_directory = _report_directory(arguments.report_root)
    data = arguments.workspace / "data"
    assets = arguments.workspace / "assets"
    authority_path = data / "storage-authority.json"
    canvas_database = data / "canvas-content.sqlite3"
    run_database = data / "generation-runs.sqlite3"
    recovery_root = data / "recovery" / arguments.migration_id
    summary: dict[str, object] = {
        "schema_version": 1,
        "status": "environment_not_ready",
        "executed": False,
        "exit_code": 2,
        "migration_id": arguments.migration_id,
        "workspace_name": arguments.workspace.name,
        "workspace_path_fingerprint": _workspace_fingerprint(arguments.workspace),
        "storage_authority": "unknown",
        "canvas_database_verified": False,
        "generation_run_database_verified": False,
        "generation_history_verified": False,
        "legacy_generation_log_count": 0,
        "imported_generation_log_count": 0,
        "recovery_manifest_verified": False,
        "reasons": [],
    }
    failure = ""
    try:
        if not data.is_dir() or not assets.is_dir():
            raise RuntimeError("workspace_layout_invalid")
        if authority_path.exists() or canvas_database.exists() or run_database.exists():
            raise RuntimeError("workspace_already_has_sqlite_cutover_artifacts")
        non_terminal_runs = _non_terminal_run_count(data / "generation-runs.json")
        summary["non_terminal_generation_run_count"] = non_terminal_runs
        if non_terminal_runs:
            raise RuntimeError("non_terminal_generation_runs")
        opener_cookies = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(opener_cookies)
        )
        runtime = _json_request(opener, arguments.base_url, "/api/runtime/status")
        if str(runtime.get("stage") or "") != "ready":
            raise RuntimeError("runtime_not_ready")
        if int(runtime.get("blocking_generation_runs") or 0):
            raise RuntimeError("active_generation_runs")
        if not arguments.confirm_stop_and_migrate:
            raise RuntimeError("explicit_stop_and_migrate_confirmation_required")
        admin_password = os.environ.get(PASSWORD_ENV) or ""
        if not admin_password:
            if not sys.stdin.isatty():
                raise RuntimeError("admin_password_required")
            admin_password = getpass.getpass("Reroll 管理员密码：")
        _json_request(
            opener,
            arguments.base_url,
            "/api/auth/login",
            method="POST",
            payload={
                "username": arguments.admin_username,
                "password": admin_password,
            },
        )
        current = _json_request(opener, arguments.base_url, "/api/auth/me")
        user = current.get("user")
        if not isinstance(user, dict) or str(user.get("role") or "") != "admin":
            raise RuntimeError("admin_session_required")
        migration_status = _json_request(
            opener,
            arguments.base_url,
            "/api/runtime/storage-migration",
            method="POST",
            payload={
                "migration_id": arguments.migration_id,
                "approved": True,
            },
            timeout=arguments.restart_timeout_seconds,
        )
        summary["executed"] = True
        if str(migration_status.get("stage") or "") != "stopping":
            raise RuntimeError("maintenance_restart_not_started")
        deadline = time.monotonic() + arguments.restart_timeout_seconds
        runtime_ready = False
        while time.monotonic() < deadline:
            try:
                status = _json_request(
                    opener,
                    arguments.base_url,
                    "/api/runtime/status",
                    timeout=5,
                )
                runtime_ready = str(status.get("stage") or "") == "ready"
                if runtime_ready:
                    break
            except RuntimeError:
                pass
            time.sleep(0.5)
        if not runtime_ready:
            raise RuntimeError("runtime_did_not_return_ready_after_cutover")
        try:
            authority = json.loads(authority_path.read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("storage_authority_manifest_unreadable") from exc
        if (
            not isinstance(authority, dict)
            or authority.get("canvas") != "sqlite"
            or authority.get("generation_runs") != "sqlite"
            or authority.get("migration_id") != arguments.migration_id
        ):
            raise RuntimeError("storage_authority_manifest_invalid")
        canvas_verified = _sqlite_quick_check(canvas_database)
        runs_verified = _sqlite_quick_check(run_database)
        recovery_verified = (
            recovery_root.joinpath("recovery-manifest.json").is_file()
            and recovery_root.joinpath("preparation-report.json").is_file()
            and recovery_root.joinpath(
                "legacy", "legacy-archive-report.json"
            ).is_file()
        )
        try:
            preparation = json.loads(
                recovery_root.joinpath("preparation-report.json").read_text(
                    encoding="utf-8-sig"
                )
            )
            legacy_log_count = int(
                preparation.get("legacy_generation_log_count")
            )
            imported_log_count = int(
                preparation.get("imported_generation_log_count")
            )
            global_audit = preparation.get("global_history_audit") or {}
            publication_audit = preparation.get("publication_audit") or {}
            legacy_global_history_count = int(global_audit.get("source_count") or 0)
            imported_global_history_count = int(global_audit.get("imported_count") or 0)
            imported_publication_receipt_count = int(
                publication_audit.get("receipt_count") or 0
            )
            pending_publication_count = int(
                publication_audit.get("pending_count") or 0
            )
        except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise RuntimeError("generation_history_report_unreadable") from exc
        sqlite_log_count = _sqlite_generation_log_count(canvas_database)
        (
            sqlite_global_history_count,
            sqlite_publication_receipt_count,
            sqlite_pending_publication_count,
        ) = _sqlite_global_publication_counts(run_database)
        history_verified = (
            preparation.get("status") == "ready"
            and preparation.get("phase") == "complete"
            and legacy_log_count == imported_log_count == sqlite_log_count
            and legacy_global_history_count
            == imported_global_history_count
            == sqlite_global_history_count
            and imported_publication_receipt_count
            == sqlite_publication_receipt_count
            and pending_publication_count == sqlite_pending_publication_count
        )
        if (
            not canvas_verified
            or not runs_verified
            or not recovery_verified
            or not history_verified
        ):
            raise RuntimeError("post_cutover_verification_failed")
        summary.update(
            {
                "status": "passed",
                "executed": True,
                "exit_code": 0,
                "storage_authority": "sqlite",
                "canvas_database_verified": True,
                "generation_run_database_verified": True,
                "generation_history_verified": True,
                "legacy_generation_log_count": legacy_log_count,
                "imported_generation_log_count": imported_log_count,
                "legacy_global_history_count": legacy_global_history_count,
                "imported_global_history_count": imported_global_history_count,
                "imported_publication_receipt_count": (
                    imported_publication_receipt_count
                ),
                "pending_publication_count": pending_publication_count,
                "legacy_generation_json_archived": True,
                "recovery_manifest_verified": True,
                "runtime_ready_after_cutover": True,
                "reasons": [],
            }
        )
    except (Exception, KeyboardInterrupt) as exc:
        failure = str(exc) or type(exc).__name__
        summary["reasons"] = [failure]
        if summary.get("executed"):
            summary["status"] = "failed"
            summary["exit_code"] = 1
    report_directory.joinpath("summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"report_directory": str(report_directory)}))
    return int(summary["exit_code"])


if __name__ == "__main__":
    raise SystemExit(main())
