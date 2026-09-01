import asyncio
import os
from pathlib import Path
import subprocess
import sys
import unittest

from infinite_canvas.realtime_presence import (
    DEFAULT_PRESENCE_UPDATE_INTERVAL_MS,
    PRESENCE_UPDATE_INTERVAL_ENV,
    RealtimePresenceManager,
    configured_presence_update_interval,
)


class FakeWebSocket:
    def __init__(self):
        self.closed = []

    async def close(self, *, code, reason):
        self.closed.append((code, reason))


class RecordingTransport:
    def __init__(self):
        self.personal = []
        self.membership = []
        self.batches = []
        self.cleared = []

    async def send_presence_membership(self, websocket, message):
        self.personal.append((websocket, message))
        return True

    async def broadcast_presence_membership(
        self,
        canvas_id,
        message,
        *,
        exclude=None,
        fallback_snapshots=None,
    ):
        del fallback_snapshots
        self.membership.append((canvas_id, message, exclude))

    async def broadcast_presence_batch(self, canvas_id, message):
        self.batches.append((canvas_id, message))

    def clear_presence_participant(self, canvas_id, participant_id):
        self.cleared.append((canvas_id, participant_id))


class PresenceConfigurationTests(unittest.TestCase):
    def test_default_and_boundaries(self):
        self.assertEqual(
            configured_presence_update_interval({}),
            DEFAULT_PRESENCE_UPDATE_INTERVAL_MS,
        )
        for value in ("50", "100", "500"):
            with self.subTest(value=value):
                self.assertEqual(
                    configured_presence_update_interval(
                        {PRESENCE_UPDATE_INTERVAL_ENV: value}
                    ),
                    int(value),
                )

    def test_invalid_value_fails_startup_contract(self):
        for value in ("", "49", "501", "10.5", "fast"):
            with self.subTest(value=value):
                with self.assertRaisesRegex(
                    ValueError,
                    PRESENCE_UPDATE_INTERVAL_ENV,
                ):
                    configured_presence_update_interval(
                        {PRESENCE_UPDATE_INTERVAL_ENV: value}
                    )

    def test_invalid_environment_stops_application_import(self):
        root = Path(__file__).resolve().parents[1]
        environment = os.environ.copy()
        environment["PYTHONPATH"] = str(root / "backend")
        environment[PRESENCE_UPDATE_INTERVAL_ENV] = "49"
        completed = subprocess.run(
            [sys.executable, "-c", "import main"],
            cwd=root,
            env=environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertNotEqual(0, completed.returncode)
        self.assertIn(PRESENCE_UPDATE_INTERVAL_ENV, completed.stderr)


class RealtimePresenceManagerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.transport = RecordingTransport()
        self.manager = RealtimePresenceManager(
            self.transport,
            update_interval_ms=50,
            ttl_seconds=60,
        )
        self.admin = {
            "id": "account-a",
            "username": "admin",
            "display_name": "Admin",
            "avatar_color_slot": 7,
            "role": "admin",
            "status": "active",
        }

    async def asyncTearDown(self):
        await self.manager.close_all()

    async def test_multiple_connections_share_one_member_and_pointer(self):
        first = FakeWebSocket()
        second = FakeWebSocket()

        participant = await self.manager.join(first, "canvas-a", self.admin)
        same_participant = await self.manager.join(second, "canvas-a", self.admin)

        self.assertEqual(participant, same_participant)
        self.assertEqual(len(self.transport.membership), 1)
        self.assertEqual(self.transport.membership[0][1]["type"], "presence_join")
        second_snapshot = self.transport.personal[-1][1]
        self.assertEqual(second_snapshot["self_participant_id"], participant)
        self.assertEqual(len(second_snapshot["members"]), 1)
        self.assertNotIn("role", second_snapshot["members"][0])
        self.assertNotIn("actor_id", second_snapshot["members"][0])

        await self.manager.receive_update(
            first,
            {"type": "presence_update", "seq": 1, "cursor": {"x": 10, "y": 20}},
        )
        await asyncio.sleep(0.04)
        first_update = self.transport.batches[-1][1]["updates"][0]
        self.assertEqual(first_update["participant_id"], participant)
        self.assertEqual(first_update["cursor"], {"x": 10.0, "y": 20.0})

        await self.manager.receive_update(
            second,
            {"type": "presence_update", "seq": 1, "cursor": {"x": 30, "y": 40}},
        )
        await asyncio.sleep(0.04)
        self.assertEqual(
            self.transport.batches[-1][1]["updates"][0]["cursor"],
            {"x": 30.0, "y": 40.0},
        )

        await self.manager.leave(second)
        await asyncio.sleep(0.04)
        self.assertEqual(
            self.transport.batches[-1][1]["updates"][0]["cursor"],
            None,
        )
        self.assertFalse(any(item[1]["type"] == "presence_leave" for item in self.transport.membership))

        await self.manager.leave(first)
        self.assertEqual(self.transport.membership[-1][1]["type"], "presence_leave")
        self.assertEqual(self.transport.cleared[-1], ("canvas-a", participant))

    async def test_invalid_spoofed_or_stale_updates_are_silent(self):
        websocket = FakeWebSocket()
        await self.manager.join(websocket, "canvas-a", self.admin)
        cases = [
            {"type": "presence_update", "seq": 1, "cursor": {"x": 1, "y": 2}, "display_name": "Spoof"},
            {"type": "presence_update", "seq": True, "cursor": {"x": 1, "y": 2}},
            {"type": "presence_update", "seq": 2, "cursor": {"x": float("inf"), "y": 2}},
            {"type": "presence_update", "seq": 3, "cursor": {"x": 1, "y": 2, "z": 3}},
        ]
        for message in cases:
            await self.manager.receive_update(websocket, message)
        await asyncio.sleep(0.04)

        self.assertEqual(self.transport.batches, [])
        self.assertEqual(websocket.closed, [])

    async def test_resync_replaces_presence_only(self):
        websocket = FakeWebSocket()
        participant = await self.manager.join(websocket, "canvas-a", self.admin)
        self.transport.personal.clear()

        await self.manager.resync(websocket)

        self.assertEqual(len(self.transport.personal), 1)
        snapshot = self.transport.personal[0][1]
        self.assertEqual(snapshot["type"], "presence_snapshot")
        self.assertEqual(snapshot["self_participant_id"], participant)
        self.assertNotIn("revision", snapshot)
        self.assertNotIn("canvas", snapshot)

    async def test_excessive_sender_is_degraded_then_closed(self):
        websocket = FakeWebSocket()
        manager = RealtimePresenceManager(
            self.transport,
            update_interval_ms=500,
            ttl_seconds=60,
        )
        await self.manager.close_all()
        self.manager = manager
        await manager.join(websocket, "canvas-a", self.admin)

        for sequence in range(1, 18):
            await manager.receive_update(
                websocket,
                {
                    "type": "presence_update",
                    "seq": sequence,
                    "cursor": {"x": sequence, "y": sequence},
                },
            )

        self.assertEqual(websocket.closed, [(4408, "Presence update rate exceeded")])

    async def test_stale_connection_is_removed_at_the_ttl(self):
        websocket = FakeWebSocket()
        manager = RealtimePresenceManager(
            self.transport,
            update_interval_ms=50,
            ttl_seconds=1,
        )
        await self.manager.close_all()
        self.manager = manager
        await manager.join(websocket, "canvas-a", self.admin)

        await asyncio.sleep(1.1)

        self.assertEqual(websocket.closed, [(1001, "Presence connection timed out")])
        self.assertEqual(self.transport.membership[-1][1]["type"], "presence_leave")


if __name__ == "__main__":
    unittest.main()
