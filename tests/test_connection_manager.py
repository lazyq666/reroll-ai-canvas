import asyncio
import json
import os
import unittest
from unittest.mock import AsyncMock, patch

from infinite_canvas.connection_manager import (
    CANVAS_CONNECTION_LIMIT_ENV,
    CANVAS_RESYNC_CLOSE_CODE,
    DEFAULT_CANVAS_CONNECTION_LIMIT,
    ConnectionManager,
    configured_canvas_connection_limit,
)


class FakeWebSocket:
    def __init__(self, *, blocked=False):
        self.accepted = False
        self.sent = []
        self.closed = []
        self.send_started = asyncio.Event()
        self.sent_changed = asyncio.Event()
        self.closed_changed = asyncio.Event()
        self.release_send = asyncio.Event()
        if not blocked:
            self.release_send.set()

    async def accept(self):
        self.accepted = True

    async def send_text(self, payload):
        self.send_started.set()
        await self.release_send.wait()
        self.sent.append(json.loads(payload))
        self.sent_changed.set()

    async def close(self, *, code, reason):
        self.closed.append((code, reason))
        self.closed_changed.set()

    async def wait_for_sent(self, count):
        while len(self.sent) < count:
            self.sent_changed.clear()
            await asyncio.wait_for(self.sent_changed.wait(), timeout=0.5)


class CanvasConnectionLimitConfigurationTests(unittest.TestCase):
    def test_default_limit_is_twenty_connections_per_canvas(self):
        self.assertEqual(DEFAULT_CANVAS_CONNECTION_LIMIT, 20)
        self.assertEqual(configured_canvas_connection_limit({}), 20)

    def test_environment_can_override_the_limit(self):
        with patch.dict(
            os.environ,
            {CANVAS_CONNECTION_LIMIT_ENV: "24"},
        ):
            manager = ConnectionManager()
        self.assertEqual(manager.canvas_connection_limit, 24)

    def test_invalid_environment_limit_fails_explicitly(self):
        for value in ("", "0", "-1", "twenty"):
            with self.subTest(value=value):
                with self.assertRaisesRegex(
                    ValueError,
                    CANVAS_CONNECTION_LIMIT_ENV,
                ):
                    configured_canvas_connection_limit(
                        {CANVAS_CONNECTION_LIMIT_ENV: value}
                    )


class CanvasOutboundQueueTests(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self):
        manager = getattr(self, "manager", None)
        if manager is not None:
            await manager.close_for_workspace_move()

    async def connect(self, websocket, client_id):
        accepted = await self.manager.connect_canvas(
            websocket,
            "canvas-1",
            client_id,
        )
        self.assertTrue(accepted)
        self.assertTrue(websocket.accepted)

    async def test_configured_per_canvas_limit_rejects_the_next_connection(self):
        self.manager = ConnectionManager(canvas_connection_limit=2)
        first = FakeWebSocket()
        second = FakeWebSocket()
        rejected = FakeWebSocket()

        await self.connect(first, "first")
        await self.connect(second, "second")
        accepted = await self.manager.connect_canvas(
            rejected,
            "canvas-1",
            "third",
        )

        self.assertFalse(accepted)
        self.assertTrue(rejected.accepted)
        self.assertEqual(
            rejected.closed,
            [(4429, "同一 Smart Canvas 最多 2 条实时客户端连接")],
        )

    async def test_slow_client_does_not_delay_fast_client(self):
        self.manager = ConnectionManager()
        slow = FakeWebSocket(blocked=True)
        fast = FakeWebSocket()
        await self.connect(slow, "slow")
        await self.connect(fast, "fast")
        snapshot = {
            "type": "canvas_snapshot",
            "canvas_id": "canvas-1",
            "revision": 0,
            "canvas": {"id": "canvas-1", "revision": 0},
        }
        self.assertTrue(
            await self.manager.send_canvas_message(slow, snapshot)
        )
        self.assertTrue(
            await self.manager.send_canvas_message(fast, snapshot)
        )
        await asyncio.wait_for(slow.send_started.wait(), timeout=0.5)
        await fast.wait_for_sent(1)

        await asyncio.wait_for(
            self.manager.broadcast_canvas_message(
                "canvas-1",
                {
                    "type": "canvas_mutation",
                    "revision": 1,
                    "duplicate": False,
                    "changes": {},
                },
            ),
            timeout=0.1,
        )
        await fast.wait_for_sent(2)

        self.assertEqual([item["revision"] for item in fast.sent], [0, 1])
        self.assertEqual(slow.sent, [])
        slow.release_send.set()
        await slow.wait_for_sent(2)
        self.assertEqual([item["revision"] for item in slow.sent], [0, 1])

    async def test_revision_gap_closes_connection_for_resync(self):
        self.manager = ConnectionManager()
        websocket = FakeWebSocket()
        await self.connect(websocket, "gap-client")
        await self.manager.send_canvas_message(
            websocket,
            {
                "type": "canvas_snapshot",
                "canvas_id": "canvas-1",
                "revision": 5,
                "canvas": {"id": "canvas-1", "revision": 5},
            },
        )
        await websocket.wait_for_sent(1)

        await self.manager.broadcast_canvas_message(
            "canvas-1",
            {
                "type": "canvas_mutation",
                "revision": 7,
                "duplicate": False,
                "changes": {},
            },
        )
        await asyncio.wait_for(websocket.closed_changed.wait(), timeout=0.5)

        self.assertEqual(websocket.closed[0][0], CANVAS_RESYNC_CLOSE_CODE)
        self.assertIn("Revision", websocket.closed[0][1])
        self.assertEqual(len(websocket.sent), 1)
        self.assertFalse(
            await self.manager.send_canvas_message(
                websocket,
                {"type": "pong", "revision": 5},
            )
        )

    async def test_queue_overflow_disconnects_only_slow_client(self):
        self.manager = ConnectionManager(canvas_queue_max_messages=2)
        slow = FakeWebSocket(blocked=True)
        fast = FakeWebSocket()
        await self.connect(slow, "slow")
        await self.connect(fast, "fast")
        snapshot = {
            "type": "canvas_snapshot",
            "canvas_id": "canvas-1",
            "revision": 0,
            "canvas": {"id": "canvas-1", "revision": 0},
        }
        await self.manager.send_canvas_message(slow, snapshot)
        await self.manager.send_canvas_message(fast, snapshot)
        await asyncio.wait_for(slow.send_started.wait(), timeout=0.5)
        await fast.wait_for_sent(1)

        for revision in (1, 2):
            await self.manager.broadcast_canvas_message(
                "canvas-1",
                {
                    "type": "canvas_mutation",
                    "revision": revision,
                    "duplicate": False,
                    "changes": {},
                },
            )
        await asyncio.wait_for(slow.closed_changed.wait(), timeout=0.5)
        await fast.wait_for_sent(3)

        self.assertEqual(slow.closed[0][0], CANVAS_RESYNC_CLOSE_CODE)
        self.assertIn("积压", slow.closed[0][1])
        self.assertEqual(
            [item["revision"] for item in fast.sent],
            [0, 1, 2],
        )
        self.assertEqual(fast.closed, [])

    async def test_queue_preserves_per_client_revision_order(self):
        self.manager = ConnectionManager()
        websocket = FakeWebSocket()
        await self.connect(websocket, "ordered")
        await self.manager.send_canvas_message(
            websocket,
            {
                "type": "canvas_snapshot",
                "canvas_id": "canvas-1",
                "revision": 10,
                "canvas": {"id": "canvas-1", "revision": 10},
            },
        )
        for revision in range(11, 16):
            await self.manager.broadcast_canvas_message(
                "canvas-1",
                {
                    "type": "canvas_mutation",
                    "revision": revision,
                    "duplicate": False,
                    "changes": {},
                },
            )
        await websocket.wait_for_sent(6)

        self.assertEqual(
            [message["revision"] for message in websocket.sent],
            list(range(10, 16)),
        )
        self.assertEqual(websocket.closed, [])

    async def test_oversized_snapshot_closes_for_resync(self):
        self.manager = ConnectionManager(canvas_queue_max_bytes=1024)
        websocket = FakeWebSocket()
        await self.connect(websocket, "oversized")

        accepted = await self.manager.send_canvas_message(
            websocket,
            {
                "type": "canvas_snapshot",
                "canvas_id": "canvas-1",
                "revision": 0,
                "canvas": {"payload": "x" * 2048},
            },
        )
        await asyncio.wait_for(websocket.closed_changed.wait(), timeout=0.5)

        self.assertFalse(accepted)
        self.assertEqual(websocket.closed[0][0], CANVAS_RESYNC_CLOSE_CODE)
        self.assertEqual(websocket.sent, [])

    async def test_large_snapshot_encoding_yields_to_the_event_loop(self):
        self.manager = ConnectionManager()
        websocket = FakeWebSocket()
        await self.connect(websocket, "large-snapshot")

        with patch(
            "infinite_canvas.connection_manager.asyncio.sleep",
            new=AsyncMock(),
        ) as cooperative_yield:
            accepted = await self.manager.send_canvas_message(
                websocket,
                {
                    "type": "canvas_snapshot",
                    "canvas_id": "canvas-1",
                    "revision": 0,
                    "canvas": {
                        "nodes": [
                            {"id": f"node-{index}", "payload": "x" * 65_000}
                            for index in range(8)
                        ]
                    },
                },
            )

        self.assertTrue(accepted)
        self.assertGreater(cooperative_yield.await_count, 0)

    async def test_document_messages_preempt_latest_wins_pointer_backlog(self):
        self.manager = ConnectionManager(canvas_queue_max_messages=2)
        websocket = FakeWebSocket(blocked=True)
        await self.connect(websocket, "presence-priority")
        await self.manager.send_canvas_message(
            websocket,
            {
                "type": "canvas_snapshot",
                "canvas_id": "canvas-1",
                "revision": 0,
                "canvas": {"id": "canvas-1", "revision": 0},
            },
        )
        await asyncio.wait_for(websocket.send_started.wait(), timeout=0.5)

        for value in range(100):
            await self.manager.broadcast_presence_batch(
                "canvas-1",
                {
                    "type": "presence_batch",
                    "updates": [
                        {
                            "participant_id": "participant-a",
                            "cursor_version": value + 1,
                            "cursor": {"x": value, "y": value},
                        }
                    ],
                },
            )
        await self.manager.broadcast_canvas_message(
            "canvas-1",
            {
                "type": "canvas_mutation",
                "revision": 1,
                "duplicate": False,
                "changes": {},
            },
        )

        websocket.release_send.set()
        await websocket.wait_for_sent(3)

        self.assertEqual(
            [message["type"] for message in websocket.sent],
            ["canvas_snapshot", "canvas_mutation", "presence_batch"],
        )
        self.assertEqual(
            websocket.sent[-1]["updates"],
            [
                {
                    "participant_id": "participant-a",
                    "cursor_version": 100,
                    "cursor": {"x": 99, "y": 99},
                }
            ],
        )
        self.assertEqual(websocket.closed, [])

    async def test_membership_backlog_folds_to_latest_personal_snapshot(self):
        self.manager = ConnectionManager()
        websocket = FakeWebSocket(blocked=True)
        await self.connect(websocket, "presence-membership")
        await self.manager.send_canvas_message(
            websocket,
            {
                "type": "canvas_snapshot",
                "canvas_id": "canvas-1",
                "revision": 0,
                "canvas": {"id": "canvas-1", "revision": 0},
            },
        )
        await asyncio.wait_for(websocket.send_started.wait(), timeout=0.5)
        await self.manager.broadcast_presence_membership(
            "canvas-1",
            {
                "type": "presence_join",
                "protocol_version": 1,
                "membership_version": 2,
                "member": {"participant_id": "participant-b"},
            },
        )
        latest_snapshot = {
            "type": "presence_snapshot",
            "protocol_version": 1,
            "membership_version": 3,
            "self_participant_id": "participant-a",
            "members": [
                {"participant_id": "participant-a"},
                {"participant_id": "participant-b"},
                {"participant_id": "participant-c"},
            ],
        }
        await self.manager.broadcast_presence_membership(
            "canvas-1",
            {
                "type": "presence_join",
                "protocol_version": 1,
                "membership_version": 3,
                "member": {"participant_id": "participant-c"},
            },
            fallback_snapshots={websocket: latest_snapshot},
        )

        websocket.release_send.set()
        await websocket.wait_for_sent(2)

        self.assertEqual(
            [message["type"] for message in websocket.sent],
            ["canvas_snapshot", "presence_snapshot"],
        )
        self.assertEqual(websocket.sent[-1], latest_snapshot)
        self.assertEqual(websocket.closed, [])


if __name__ == "__main__":
    unittest.main()
