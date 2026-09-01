import csv
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Response, WebSocket, WebSocketDisconnect


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "performance" / "run_live_collaboration_acceptance.py"


class LiveCollaborationAcceptanceCliTests(unittest.TestCase):
    def test_existing_service_runs_robot_mutations_without_generation_and_cleans_exact_objects(self):
        state = {
            "applications": {},
            "accounts": {},
            "canvas": None,
            "revision": 0,
            "connections": [],
            "generation_requests": 0,
            "create_canvas_requests": 0,
            "read_canvas_requests": 0,
            "publish_generation_on_read": 0,
            "deleted_accounts": [],
            "purged_canvases": [],
            "forced_placement_conflicts": 1,
            "forced_revision_resyncs": 1,
            "forced_fatal_closes": 0,
            "operation_revisions": {},
            "presence_updates": 0,
        }
        app = FastAPI()

        @app.get("/api/runtime/status")
        async def runtime_status():
            return {
                "stage": "ready",
                "blocking_generation_runs": 0,
            }

        @app.post("/api/auth/login")
        async def login(response: Response):
            response.set_cookie("ic_session", "admin-session")
            return {"user": {"id": "admin-1", "role": "admin"}}

        @app.get("/api/auth/me")
        async def auth_me():
            return {"user": {"id": "admin-1", "role": "admin"}}

        @app.get("/api/projects")
        async def projects():
            return {"projects": [{"id": "default", "name": "Default"}]}

        @app.get("/api/auth/registration")
        async def registration_status():
            return {
                "enabled": True,
                "max_accounts": 20,
                "active_accounts": 15,
                "pending_applications": 0,
                "remaining": 5,
            }

        @app.post("/api/auth/register")
        async def register(payload: dict):
            if len(state["applications"]) >= 5:
                raise HTTPException(status_code=409, detail="account capacity reached")
            application_id = f"application-{len(state['applications']) + 1}"
            state["applications"][application_id] = payload
            return {"application": {"id": application_id}}

        @app.post("/api/admin/account-applications/{application_id}/approve")
        async def approve(application_id: str):
            user_id = f"robot-user-{len(state['accounts']) + 1}"
            state["accounts"][user_id] = state["applications"][application_id]
            return {"user": {"id": user_id}}

        @app.put("/api/admin/accounts/{user_id}/project-permissions")
        async def permissions(user_id: str, payload: dict):
            return {"user_id": user_id, "project_ids": payload["project_ids"]}

        @app.delete("/api/admin/accounts/{user_id}")
        async def delete_account(user_id: str):
            state["deleted_accounts"].append(user_id)
            return {"deleted": True}

        @app.post("/api/auth/logout")
        async def logout():
            return {"ok": True}

        @app.post("/api/canvases")
        async def create_canvas(payload: dict):
            state["create_canvas_requests"] += 1
            state["canvas"] = {
                "id": "acceptance-canvas-1",
                "title": payload["title"],
                "revision": 0,
                "nodes": [],
                "connections": [],
            }
            return {"canvas": state["canvas"]}

        @app.get("/api/canvases")
        async def list_canvases(project: str = ""):
            return {"canvases": [state["canvas"]] if state["canvas"] else []}

        @app.get("/api/canvases/{canvas_id}")
        async def read_canvas(canvas_id: str):
            assert state["canvas"]["id"] == canvas_id
            state["read_canvas_requests"] += 1
            if (
                state["publish_generation_on_read"]
                and state["read_canvas_requests"]
                >= state["publish_generation_on_read"]
            ):
                state["canvas"]["nodes"][0]["images"].append(
                    {"url": "/assets/generated-during-grace.png"}
                )
                state["publish_generation_on_read"] = 0
            return {"canvas": state["canvas"]}

        @app.delete("/api/canvases/{canvas_id}")
        async def delete_canvas(canvas_id: str):
            return {"deleted": canvas_id}

        @app.delete("/api/canvases/{canvas_id}/purge")
        async def purge_canvas(canvas_id: str):
            state["purged_canvases"].append(canvas_id)
            return {"purged": canvas_id}

        @app.websocket("/ws/canvases/{canvas_id}")
        async def canvas_socket(websocket: WebSocket, canvas_id: str):
            await websocket.accept()
            state["connections"].append(websocket)
            await websocket.send_json(
                {
                    "type": "canvas_snapshot",
                    "revision": state["revision"],
                    "canvas": state["canvas"],
                }
            )
            try:
                while True:
                    message = json.loads(await websocket.receive_text())
                    if message.get("type") == "presence_update":
                        state["presence_updates"] += 1
                        continue
                    if message.get("type") != "canvas_mutation":
                        continue
                    operation = message["operation"]
                    changes = operation.get("changes") or {}
                    operation_id = operation["operation_id"]
                    duplicate_revision = state["operation_revisions"].get(
                        operation_id
                    )
                    if duplicate_revision is not None:
                        await websocket.send_json(
                            {
                                "type": "canvas_mutation",
                                "operation_id": operation_id,
                                "revision": duplicate_revision,
                                "duplicate": True,
                            }
                        )
                        continue
                    if (
                        changes.get("node_updates")
                        and state["forced_fatal_closes"]
                    ):
                        state["forced_fatal_closes"] -= 1
                        await websocket.close(
                            code=4403,
                            reason="edit permission lost",
                        )
                        continue
                    if (
                        changes.get("node_creates")
                        and state["forced_placement_conflicts"]
                    ):
                        state["forced_placement_conflicts"] -= 1
                        state["revision"] += 1
                        state["canvas"]["revision"] = state["revision"]
                        external_payload = {
                            "type": "canvas_mutation",
                            "operation_id": "human:concurrent-canvas-change",
                            "revision": state["revision"],
                        }
                        for connection in list(state["connections"]):
                            await connection.send_json(external_payload)
                        await websocket.send_json(
                            {
                                "type": "mutation_rejected",
                                "operation_id": operation["operation_id"],
                                "code": "placement_conflict",
                                "revision": state["revision"],
                            }
                        )
                        continue
                    if (
                        changes.get("node_creates")
                        and state["forced_revision_resyncs"]
                    ):
                        state["forced_revision_resyncs"] -= 1
                        state["revision"] += 2
                        state["canvas"]["revision"] = state["revision"]
                        close_after_commit = True
                    else:
                        close_after_commit = False
                    if (
                        changes.get("node_creates")
                        and operation.get("base_revision") < state["revision"]
                        and not close_after_commit
                    ):
                        await websocket.send_json(
                            {
                                "type": "mutation_rejected",
                                "operation_id": operation["operation_id"],
                                "code": "placement_conflict",
                                "revision": state["revision"],
                            }
                        )
                        continue
                    state["revision"] += 1
                    for node in changes.get("node_creates") or []:
                        state["canvas"]["nodes"].append(node)
                    for update in changes.get("node_updates") or []:
                        node = next(
                            item
                            for item in state["canvas"]["nodes"]
                            if item["id"] == update["id"]
                        )
                        node[update["path"][0]] = update["value"]
                    state["canvas"]["revision"] = state["revision"]
                    state["operation_revisions"][operation_id] = state["revision"]
                    payload = {
                        "type": "canvas_mutation",
                        "operation_id": operation_id,
                        "revision": state["revision"],
                    }
                    if close_after_commit:
                        for connection in list(state["connections"]):
                            await connection.close(
                                code=4409,
                                reason="Canvas Revision requires resync",
                            )
                        continue
                    for connection in list(state["connections"]):
                        await connection.send_json(payload)
            except (RuntimeError, WebSocketDisconnect):
                pass
            finally:
                if websocket in state["connections"]:
                    state["connections"].remove(websocket)

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
            with tempfile.TemporaryDirectory() as temporary:
                report_root = Path(temporary) / "reports"
                environment = os.environ.copy()
                environment["INFINITE_CANVAS_ACCEPTANCE_ADMIN_PASSWORD"] = (
                    "admin-secret-value"
                )
                completed = subprocess.run(
                    [
                        sys.executable,
                        str(SCRIPT),
                        "--base-url",
                        f"http://127.0.0.1:{port}",
                        "--admin-username",
                        "admin",
                        "--robot-rounds",
                        "2",
                        "--round-interval-seconds",
                        "0.01",
                        "--pointer-hz",
                        "10",
                        "--ack-p99-gate-ms",
                        "300",
                        "--start-immediately",
                        "--cleanup-test-canvas",
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
                cleanup = json.loads(
                    report_directory.joinpath("cleanup.json").read_text(
                        encoding="utf-8"
                    )
                )
                with report_directory.joinpath("metrics.csv").open(
                    newline="", encoding="utf-8"
                ) as metrics_file:
                    metrics = list(csv.DictReader(metrics_file))
                report_text = "\n".join(
                    path.read_text(encoding="utf-8", errors="replace")
                    for path in report_directory.iterdir()
                    if path.is_file()
                )

                self.assertEqual("passed", summary["status"])
                self.assertEqual(9, summary["robot_count"])
                self.assertEqual(9, summary["robot_session_count"])
                self.assertEqual(5, summary["robot_account_count"])
                self.assertEqual(6, summary["distinct_authenticated_actor_count"])
                self.assertEqual(18, summary["robot_mutation_count"])
                self.assertEqual(1, summary["placement_conflict_retry_count"])
                self.assertEqual(9, summary["robot_node_create_count"])
                self.assertEqual(9, summary["robot_node_move_count"])
                self.assertTrue(summary["operation_ids_unique"])
                self.assertTrue(summary["operation_ids_complete"])
                self.assertTrue(summary["revision_sequence_contiguous"])
                self.assertEqual(
                    9, summary["realtime_revision_stream_client_count"]
                )
                self.assertEqual(0, summary["realtime_revision_gap_count"])
                self.assertEqual(0, summary["realtime_revision_reorder_count"])
                self.assertTrue(summary["realtime_revision_streams_caught_up"])
                self.assertEqual(9, summary["realtime_resync_count"])
                self.assertEqual(
                    {"4409": 9}, summary["realtime_close_code_counts"]
                )
                self.assertTrue(summary["final_node_projection_consistent"])
                self.assertEqual(0, summary["final_node_projection_mismatch_count"])
                self.assertEqual(300, summary["ack_p99_gate_ms"])
                self.assertTrue(summary["ack_latency_gate_passed"])
                self.assertEqual(
                    {str(position) for position in range(1, 10)},
                    set(summary["node_move_queue_position_distribution"]),
                )
                operation_ids = [metric["operation_id"] for metric in metrics]
                self.assertTrue(all(operation_ids))
                self.assertEqual(len(operation_ids), len(set(operation_ids)))
                self.assertEqual(
                    9,
                    sum(
                        int(metric["realtime_resync_retries"])
                        for metric in metrics
                    ),
                )
                positions_by_round = {}
                for metric in metrics:
                    positions_by_round.setdefault(
                        metric["round_number"], []
                    ).append(int(metric["queue_position"]))
                self.assertEqual({"1", "2"}, set(positions_by_round))
                self.assertTrue(
                    all(
                        sorted(positions) == list(range(1, 10))
                        for positions in positions_by_round.values()
                    )
                )
                self.assertEqual(0, summary["generation_requests_submitted"])
                self.assertEqual("acceptance-canvas-1", summary["canvas_id"])
                self.assertTrue(summary["existing_service_left_running"])
                self.assertEqual(5, len(cleanup["account_ids"]))
                self.assertEqual(
                    ["acceptance-canvas-1"], cleanup["canvas_ids"]
                )
                self.assertTrue(cleanup["canvas_purged"])
                self.assertTrue(cleanup["accounts_removed"])
                self.assertEqual(
                    0, cleanup["out_of_allowlist_deletion_attempt_count"]
                )
                self.assertEqual(0, cleanup["generated_media_deletion_attempt_count"])
                self.assertNotIn("admin-secret-value", report_text)
                self.assertEqual(0, state["generation_requests"])
                self.assertEqual(18, len(state["operation_revisions"]))
                self.assertGreater(state["presence_updates"], 0)
                self.assertEqual(10, summary["presence_pointer_hz"])
                self.assertGreater(summary["presence_pointer_updates_sent"], 0)
                self.assertEqual(
                    [f"robot-user-{index}" for index in range(1, 6)],
                    state["deleted_accounts"],
                )
                self.assertEqual(
                    ["acceptance-canvas-1"], state["purged_canvases"]
                )
                self.assertFalse(server.should_exit)

                state["applications"] = {}
                state["accounts"] = {}
                state["deleted_accounts"] = []
                state["purged_canvases"] = []
                state["revision"] = 1116
                state["read_canvas_requests"] = 0
                state["publish_generation_on_read"] = 3
                state["canvas"] = {
                    "id": "existing-canvas-1",
                    "title": "10 人协作验收 c2fcffcc7c",
                    "kind": "smart",
                    "revision": state["revision"],
                    "nodes": [
                        {
                            "id": "existing-generation-node",
                            "images": [{"url": "/assets/existing.png"}],
                        }
                    ],
                    "connections": [],
                }
                reused = subprocess.run(
                    [
                        sys.executable,
                        str(SCRIPT),
                        "--base-url",
                        f"http://127.0.0.1:{port}",
                        "--admin-username",
                        "admin",
                        "--canvas-id",
                        "existing-canvas-1",
                        "--robot-rounds",
                        "2",
                        "--round-interval-seconds",
                        "0.01",
                        "--start-immediately",
                        "--require-human-generation",
                        "--human-generation-grace-seconds",
                        "1",
                        "--cleanup-test-canvas",
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
                self.assertEqual(0, reused.returncode, reused.stderr)
                reused_output = json.loads(reused.stdout)
                reused_directory = Path(reused_output["report_directory"])
                reused_summary = json.loads(
                    reused_directory.joinpath("summary.json").read_text(
                        encoding="utf-8"
                    )
                )
                reused_cleanup = json.loads(
                    reused_directory.joinpath("cleanup.json").read_text(
                        encoding="utf-8"
                    )
                )
                self.assertEqual("existing", reused_summary["canvas_source"])
                self.assertEqual(1, reused_summary["initial_node_count"])
                self.assertEqual(1, reused_summary["initial_generation_output_count"])
                self.assertEqual(1, reused_summary["manual_generation_output_count"])
                self.assertTrue(reused_summary["manual_generation_observed"])
                self.assertEqual([], reused_cleanup["canvas_ids"])
                self.assertFalse(reused_cleanup["canvas_purged"])
                self.assertEqual([], state["purged_canvases"])
                self.assertEqual(1, state["create_canvas_requests"])
                node_ids = [node["id"] for node in state["canvas"]["nodes"]]
                self.assertIn("existing-generation-node", node_ids)
                self.assertEqual(len(node_ids), len(set(node_ids)))
                self.assertFalse(
                    any(
                        node_id.startswith("live-acceptance-robot-node-")
                        for node_id in node_ids
                    )
                )

                state["applications"] = {}
                state["accounts"] = {}
                state["deleted_accounts"] = []
                state["revision"] = 2000
                state["forced_fatal_closes"] = 1
                state["canvas"] = {
                    "id": "fatal-close-canvas-1",
                    "title": "Fatal close diagnostics",
                    "kind": "smart",
                    "revision": state["revision"],
                    "nodes": [],
                    "connections": [],
                }
                failed = subprocess.run(
                    [
                        sys.executable,
                        str(SCRIPT),
                        "--base-url",
                        f"http://127.0.0.1:{port}",
                        "--admin-username",
                        "admin",
                        "--canvas-id",
                        "fatal-close-canvas-1",
                        "--robot-count",
                        "1",
                        "--robot-rounds",
                        "2",
                        "--round-interval-seconds",
                        "0.01",
                        "--start-immediately",
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
                self.assertEqual(1, failed.returncode, failed.stderr)
                failed_output = json.loads(failed.stdout)
                failed_directory = Path(failed_output["report_directory"])
                failed_summary = json.loads(
                    failed_directory.joinpath("summary.json").read_text(
                        encoding="utf-8"
                    )
                )
                with failed_directory.joinpath("metrics.csv").open(
                    newline="", encoding="utf-8"
                ) as metrics_file:
                    failed_metrics = list(csv.DictReader(metrics_file))
                self.assertEqual("failed", failed_summary["status"])
                self.assertEqual(1, failed_summary["robot_mutation_count"])
                self.assertEqual(
                    ["robot_realtime_closed:4403:edit permission lost"],
                    failed_summary["reasons"],
                )
                self.assertEqual(
                    {"4403": 1},
                    failed_summary["realtime_close_code_counts"],
                )
                self.assertEqual(1, len(failed_metrics))
        finally:
            server.should_exit = True
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
