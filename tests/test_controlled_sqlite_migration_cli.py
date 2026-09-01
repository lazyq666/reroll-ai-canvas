import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Response


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "storage" / "run_controlled_sqlite_migration.py"


class ControlledSqliteMigrationCliTests(unittest.TestCase):
    def test_confirmed_cli_uses_public_maintenance_endpoint_and_verifies_cutover(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "workspace"
            data = workspace / "data"
            assets = workspace / "assets"
            report_root = root / "reports"
            data.joinpath("canvases").mkdir(parents=True)
            assets.mkdir()
            data.joinpath("generation-runs.json").write_text(
                json.dumps({"runs": [{"id": "run-1", "status": "succeeded"}]}),
                encoding="utf-8",
            )
            state = {"migration_calls": 0}
            app = FastAPI()

            @app.get("/api/runtime/status")
            async def runtime_status():
                return {"stage": "ready", "blocking_generation_runs": 0}

            @app.post("/api/auth/login")
            async def login(response: Response):
                response.set_cookie("ic_session", "admin-session")
                return {"user": {"id": "admin-1", "role": "admin"}}

            @app.get("/api/auth/me")
            async def auth_me():
                return {"user": {"id": "admin-1", "role": "admin"}}

            @app.post("/api/runtime/storage-migration")
            async def migrate(payload: dict):
                self.assertTrue(payload["approved"])
                migration_id = payload["migration_id"]
                state["migration_calls"] += 1
                for database in (
                    data / "canvas-content.sqlite3",
                    data / "generation-runs.sqlite3",
                ):
                    connection = sqlite3.connect(database)
                    connection.execute("CREATE TABLE proof (id TEXT PRIMARY KEY)")
                    connection.commit()
                    connection.close()
                connection = sqlite3.connect(data / "generation-runs.sqlite3")
                connection.execute(
                    "CREATE TABLE generation_history (history_id TEXT PRIMARY KEY)"
                )
                connection.execute(
                    """
                    CREATE TABLE generation_publication_receipts (
                        effect_id TEXT PRIMARY KEY,
                        state TEXT NOT NULL
                    )
                    """
                )
                connection.commit()
                connection.close()
                connection = sqlite3.connect(data / "canvas-content.sqlite3")
                connection.execute(
                    "CREATE TABLE canvas_logs (log_id TEXT PRIMARY KEY)"
                )
                connection.executemany(
                    "INSERT INTO canvas_logs(log_id) VALUES (?)",
                    [("legacy-log-1",), ("legacy-log-2",)],
                )
                connection.commit()
                connection.close()
                data.joinpath("storage-authority.json").write_text(
                    json.dumps(
                        {
                            "schema_version": 1,
                            "workspace_id": "workspace-1",
                            "migration_id": migration_id,
                            "canvas": "sqlite",
                            "generation_runs": "sqlite",
                        }
                    ),
                    encoding="utf-8",
                )
                recovery = data / "recovery" / migration_id
                recovery.mkdir(parents=True)
                recovery.joinpath("recovery-manifest.json").write_text(
                    json.dumps({"schema_version": 1, "sources": []}),
                    encoding="utf-8",
                )
                recovery.joinpath("preparation-report.json").write_text(
                    json.dumps(
                        {
                            "schema_version": 1,
                            "status": "ready",
                            "phase": "complete",
                            "legacy_generation_log_count": 2,
                            "imported_generation_log_count": 2,
                            "global_history_audit": {
                                "source_count": 0,
                                "imported_count": 0,
                            },
                            "publication_audit": {
                                "receipt_count": 0,
                                "pending_count": 0,
                            },
                        }
                    ),
                    encoding="utf-8",
                )
                legacy = recovery / "legacy"
                legacy.mkdir()
                data.joinpath("generation-runs.json").replace(
                    legacy / "generation-runs.json"
                )
                legacy.joinpath("legacy-archive-report.json").write_text(
                    json.dumps(
                        {
                            "schema_version": 1,
                            "status": "complete",
                            "files": [
                                {
                                    "relative_path": "data/generation-runs.json",
                                    "state": "archived",
                                }
                            ],
                        }
                    ),
                    encoding="utf-8",
                )
                return {"stage": "stopping", "blocking_generation_runs": 0}

            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
            reservation.close()
            server = uvicorn.Server(
                uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
            )
            thread = threading.Thread(target=server.run, daemon=True)
            thread.start()
            deadline = time.monotonic() + 5
            while not server.started and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue(server.started)
            try:
                environment = os.environ.copy()
                environment["INFINITE_CANVAS_MIGRATION_ADMIN_PASSWORD"] = (
                    "migration-admin-secret"
                )
                completed = subprocess.run(
                    [
                        sys.executable,
                        str(SCRIPT),
                        "--base-url",
                        f"http://127.0.0.1:{port}",
                        "--admin-username",
                        "admin",
                        "--workspace",
                        str(workspace),
                        "--migration-id",
                        "migration-test-cutover",
                        "--confirm-stop-and-migrate",
                        "--report-root",
                        str(report_root),
                    ],
                    cwd=ROOT,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=environment,
                    timeout=20,
                    check=False,
                )

                self.assertEqual(0, completed.returncode, completed.stderr)
                output = json.loads(completed.stdout)
                report_directory = Path(output["report_directory"])
                summary = json.loads(
                    report_directory.joinpath("summary.json").read_text(
                        encoding="utf-8"
                    )
                )
                report_text = "\n".join(
                    path.read_text(encoding="utf-8", errors="replace")
                    for path in report_directory.iterdir()
                    if path.is_file()
                )
                self.assertEqual("passed", summary["status"])
                self.assertEqual("sqlite", summary["storage_authority"])
                self.assertTrue(summary["canvas_database_verified"])
                self.assertTrue(summary["generation_run_database_verified"])
                self.assertTrue(summary["generation_history_verified"])
                self.assertEqual(2, summary["legacy_generation_log_count"])
                self.assertEqual(2, summary["imported_generation_log_count"])
                self.assertTrue(summary["recovery_manifest_verified"])
                self.assertTrue(summary["legacy_generation_json_archived"])
                self.assertEqual(1, state["migration_calls"])
                self.assertNotIn(str(workspace), report_text)
                self.assertNotIn("migration-admin-secret", report_text)
            finally:
                server.should_exit = True
                thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
