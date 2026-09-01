"""Serialized WebSocket delivery for application and Canvas channels."""

from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass, field
import json
import os
import time
from typing import Any, Dict, List, Mapping


DEFAULT_CANVAS_CONNECTION_LIMIT = 20
CANVAS_CONNECTION_LIMIT_ENV = "INFINITE_CANVAS_REALTIME_CONNECTION_LIMIT"
CANVAS_SEND_QUEUE_MAX_MESSAGES = 64
CANVAS_SEND_QUEUE_MAX_BYTES = 16 * 1024 * 1024
CANVAS_RESYNC_CLOSE_CODE = 4409
CANVAS_ENCODE_YIELD_BYTES = 256 * 1024


def configured_canvas_connection_limit(
    environment: Mapping[str, str] | None = None,
) -> int:
    source = os.environ if environment is None else environment
    raw_value = str(
        source.get(
            CANVAS_CONNECTION_LIMIT_ENV,
            DEFAULT_CANVAS_CONNECTION_LIMIT,
        )
    ).strip()
    try:
        limit = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"{CANVAS_CONNECTION_LIMIT_ENV} must be a positive integer"
        ) from exc
    if limit < 1:
        raise ValueError(
            f"{CANVAS_CONNECTION_LIMIT_ENV} must be a positive integer"
        )
    return limit


@dataclass
class _CanvasOutbound:
    queue: asyncio.Queue[tuple[str, int, Dict[str, Any] | None]]
    task: asyncio.Task[Any] | None = None
    wake: asyncio.Event = field(default_factory=asyncio.Event)
    pending_messages: int = 0
    pending_bytes: int = 0
    last_revision: int | None = None
    presence_snapshot: tuple[str, int] | None = None
    presence_membership: tuple[str, int] | None = None
    presence_pointers: Dict[str, Dict[str, Any]] = field(default_factory=dict)


class ConnectionManager:
    """Transport adapter shared by application events and Canvas Sync."""

    def __init__(
        self,
        *,
        canvas_connection_limit: int | None = None,
        canvas_queue_max_messages: int = CANVAS_SEND_QUEUE_MAX_MESSAGES,
        canvas_queue_max_bytes: int = CANVAS_SEND_QUEUE_MAX_BYTES,
    ) -> None:
        self.active_connections: List[Any] = []
        self.user_connections: Dict[str, Any] = {}
        self.connection_clients: Dict[Any, str] = {}
        self.canvas_connections: Dict[str, Dict[Any, str]] = {}
        self.canvas_connection_ids: Dict[Any, str] = {}
        self.canvas_outbound: Dict[Any, _CanvasOutbound] = {}
        self.canvas_close_tasks: set[asyncio.Task[Any]] = set()
        self.canvas_connection_limit = (
            configured_canvas_connection_limit()
            if canvas_connection_limit is None
            else configured_canvas_connection_limit(
                {CANVAS_CONNECTION_LIMIT_ENV: str(canvas_connection_limit)}
            )
        )
        self.canvas_queue_max_messages = max(
            1,
            int(canvas_queue_max_messages),
        )
        self.canvas_queue_max_bytes = max(
            1024,
            int(canvas_queue_max_bytes),
        )
        self.notification_effects: Dict[Any, deque[str]] = {}
        self.notification_effect_sets: Dict[Any, set[str]] = {}

    async def connect(self, websocket: Any, client_id: str | None = None) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)
        self.connection_clients[websocket] = client_id or f"anon-{id(websocket)}"
        if client_id:
            self.user_connections[client_id] = websocket
        print(
            "WS Connected. "
            f"Total: {len(self.active_connections)}, "
            f"Online: {self.online_count()}"
        )
        await self.broadcast_count()

    async def disconnect(
        self,
        websocket: Any,
        client_id: str | None = None,
    ) -> None:
        self.forget_connection(websocket, client_id)
        print(
            "WS Disconnected. "
            f"Total: {len(self.active_connections)}, "
            f"Online: {self.online_count()}"
        )
        await self.broadcast_count()

    def forget_connection(
        self,
        websocket: Any,
        client_id: str | None = None,
    ) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        known_client_id = self.connection_clients.pop(websocket, None)
        self.notification_effects.pop(websocket, None)
        self.notification_effect_sets.pop(websocket, None)
        resolved_client_id = client_id or known_client_id
        if (
            resolved_client_id
            and self.user_connections.get(resolved_client_id) is websocket
        ):
            del self.user_connections[resolved_client_id]

    def online_count(self) -> int:
        visible_clients = {
            client_id
            for client_id in self.connection_clients.values()
            if client_id and not str(client_id).startswith("canvas_")
        }
        return len(visible_clients)

    async def broadcast_count(self) -> None:
        count = self.online_count()
        data = json.dumps({"type": "stats", "online_count": count})
        for connection in self.active_connections[:]:
            try:
                await connection.send_text(data)
            except Exception as exc:
                print(f"Broadcast error: {exc}")
                self.forget_connection(connection)

    async def broadcast_new_image(
        self,
        image_data: dict,
        *,
        effect_id: str = "",
    ) -> None:
        data = json.dumps({"type": "new_image", "data": image_data})
        for connection in self.active_connections[:]:
            seen = self.notification_effect_sets.setdefault(
                connection, set()
            )
            if effect_id and effect_id in seen:
                continue
            try:
                await connection.send_text(data)
                if effect_id:
                    order = self.notification_effects.setdefault(
                        connection, deque()
                    )
                    order.append(effect_id)
                    seen.add(effect_id)
                    while len(order) > 2048:
                        seen.discard(order.popleft())
            except Exception as exc:
                print(f"Broadcast image error: {exc}")
                self.forget_connection(connection)

    async def broadcast_canvas_updated(
        self,
        canvas_id: str,
        updated_at: int,
        client_id: str = "",
    ) -> None:
        data = json.dumps(
            {
                "type": "canvas_updated",
                "canvas_id": canvas_id,
                "updated_at": updated_at,
                "client_id": client_id or "",
            }
        )
        for connection in self.active_connections[:]:
            try:
                await connection.send_text(data)
            except Exception as exc:
                print(f"Broadcast canvas error: {exc}")
                self.forget_connection(connection)

    async def send_personal_message(self, message: dict, client_id: str) -> None:
        websocket = self.user_connections.get(client_id)
        if websocket:
            try:
                await websocket.send_text(json.dumps(message))
            except Exception as exc:
                print(f"Personal message error for {client_id}: {exc}")

    async def connect_canvas(
        self,
        websocket: Any,
        canvas_id: str,
        client_id: str,
    ) -> bool:
        connections = self.canvas_connections.setdefault(canvas_id, {})
        if len(connections) >= self.canvas_connection_limit:
            await websocket.accept()
            await websocket.close(
                code=4429,
                reason=(
                    "同一 Smart Canvas 最多 "
                    f"{self.canvas_connection_limit} 条实时客户端连接"
                ),
            )
            return False
        connections[websocket] = client_id
        self.canvas_connection_ids[websocket] = canvas_id
        try:
            await websocket.accept()
        except Exception:
            self.disconnect_canvas(websocket, canvas_id)
            raise
        outbound = _CanvasOutbound(queue=asyncio.Queue())
        self.canvas_outbound[websocket] = outbound
        outbound.task = asyncio.create_task(
            self._canvas_send_worker(websocket, canvas_id, outbound)
        )
        return True

    def disconnect_canvas(self, websocket: Any, canvas_id: str) -> None:
        self.canvas_connection_ids.pop(websocket, None)
        connections = self.canvas_connections.get(canvas_id)
        if connections is not None:
            connections.pop(websocket, None)
            if not connections:
                self.canvas_connections.pop(canvas_id, None)
        outbound = self.canvas_outbound.pop(websocket, None)
        if outbound is None or outbound.task is None:
            return
        try:
            current = asyncio.current_task()
        except RuntimeError:
            current = None
        if outbound.task is not current and not outbound.task.done():
            outbound.task.cancel()

    async def _canvas_send_worker(
        self,
        websocket: Any,
        canvas_id: str,
        outbound: _CanvasOutbound,
    ) -> None:
        try:
            while True:
                await outbound.wake.wait()
                while True:
                    if not outbound.queue.empty():
                        payload, byte_size, timing_message = outbound.queue.get_nowait()
                        try:
                            if timing_message is not None:
                                timing_message[
                                    "server_send_worker_started_monotonic_ns"
                                ] = time.monotonic_ns()
                                # Let other ready Canvas send workers start before one
                                # socket performs its transport write. This keeps
                                # simultaneous heartbeats fair without bypassing the
                                # per-connection serialization queue.
                                await asyncio.sleep(0)
                                payload, _timed_byte_size = self._encode_canvas_message(
                                    timing_message
                                )
                            await websocket.send_text(payload)
                        finally:
                            outbound.pending_messages = max(
                                0,
                                outbound.pending_messages - 1,
                            )
                            outbound.pending_bytes = max(
                                0,
                                outbound.pending_bytes - byte_size,
                            )
                            outbound.queue.task_done()
                        continue
                    if outbound.presence_snapshot is not None:
                        payload, _byte_size = outbound.presence_snapshot
                        outbound.presence_snapshot = None
                        await websocket.send_text(payload)
                        continue
                    if outbound.presence_membership is not None:
                        payload, _byte_size = outbound.presence_membership
                        outbound.presence_membership = None
                        await websocket.send_text(payload)
                        continue
                    if outbound.presence_pointers:
                        updates = list(outbound.presence_pointers.values())
                        outbound.presence_pointers.clear()
                        payload, _byte_size = self._encode_canvas_message(
                            {
                                "type": "presence_batch",
                                "protocol_version": 1,
                                "updates": updates,
                            }
                        )
                        await websocket.send_text(payload)
                        continue
                    outbound.wake.clear()
                    break
        except asyncio.CancelledError:
            raise
        except Exception:
            pass
        finally:
            if self.canvas_outbound.get(websocket) is outbound:
                self.disconnect_canvas(websocket, canvas_id)

    @staticmethod
    def _encode_canvas_message(message: Dict[str, Any]) -> tuple[str, int]:
        payload = json.dumps(
            message,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        return payload, len(payload.encode("utf-8"))

    @staticmethod
    async def _encode_canvas_message_cooperatively(
        message: Dict[str, Any],
    ) -> tuple[str, int]:
        encoder = json.JSONEncoder(
            ensure_ascii=False,
            separators=(",", ":"),
        )
        parts: list[str] = []
        byte_size = 0
        uninterrupted_bytes = 0
        for part in encoder.iterencode(message):
            part_byte_size = len(part.encode("utf-8"))
            parts.append(part)
            byte_size += part_byte_size
            uninterrupted_bytes += part_byte_size
            if uninterrupted_bytes >= CANVAS_ENCODE_YIELD_BYTES:
                uninterrupted_bytes = 0
                await asyncio.sleep(0)
        return "".join(parts), byte_size

    def _schedule_canvas_close(
        self,
        websocket: Any,
        canvas_id: str,
        *,
        reason: str,
    ) -> None:
        self.disconnect_canvas(websocket, canvas_id)

        async def close() -> None:
            try:
                await websocket.close(
                    code=CANVAS_RESYNC_CLOSE_CODE,
                    reason=reason,
                )
            except Exception:
                pass

        task = asyncio.create_task(close())
        self.canvas_close_tasks.add(task)
        task.add_done_callback(self.canvas_close_tasks.discard)

    def _enqueue_canvas_message(
        self,
        websocket: Any,
        canvas_id: str,
        message: Dict[str, Any],
        payload: str,
        byte_size: int,
    ) -> bool:
        outbound = self.canvas_outbound.get(websocket)
        if outbound is None:
            return False
        message_type = str(message.get("type") or "")
        revision = max(0, int(message.get("revision") or 0))
        if message_type == "canvas_snapshot":
            outbound.last_revision = revision
        elif (
            message_type == "canvas_mutation"
            and not message.get("duplicate")
            and message.get("changed") is not False
        ):
            if (
                outbound.last_revision is not None
                and revision != outbound.last_revision + 1
            ):
                self._schedule_canvas_close(
                    websocket,
                    canvas_id,
                    reason="实时 Revision 不连续，请重新进入画布同步",
                )
                return False
            outbound.last_revision = revision
        if (
            outbound.pending_messages >= self.canvas_queue_max_messages
            or outbound.pending_bytes + byte_size
            > self.canvas_queue_max_bytes
        ):
            self._schedule_canvas_close(
                websocket,
                canvas_id,
                reason="实时消息积压，请重新进入画布同步",
            )
            return False
        outbound.pending_messages += 1
        outbound.pending_bytes += byte_size
        timing_message = (
            dict(message)
            if "server_received_monotonic_ns" in message
            else None
        )
        outbound.queue.put_nowait((payload, byte_size, timing_message))
        outbound.wake.set()
        return True

    async def send_canvas_message(
        self,
        websocket: Any,
        message: Dict[str, Any],
    ) -> bool:
        try:
            if message.get("type") == "pong":
                payload, byte_size = self._encode_canvas_message(message)
            else:
                payload, byte_size = (
                    await self._encode_canvas_message_cooperatively(
                        message,
                    )
                )
        except Exception:
            return False
        canvas_id = self.canvas_connection_ids.get(websocket, "")
        if not canvas_id:
            return False
        return self._enqueue_canvas_message(
            websocket,
            canvas_id,
            message,
            payload,
            byte_size,
        )

    async def broadcast_canvas_message(
        self,
        canvas_id: str,
        message: Dict[str, Any],
    ) -> None:
        payload, byte_size = (
            await self._encode_canvas_message_cooperatively(
                message,
            )
        )
        connections = list(self.canvas_connections.get(canvas_id, {}))
        for websocket in connections:
            self._enqueue_canvas_message(
                websocket,
                canvas_id,
                message,
                payload,
                byte_size,
            )

    async def send_presence_membership(
        self,
        websocket: Any,
        message: Dict[str, Any],
    ) -> bool:
        outbound = self.canvas_outbound.get(websocket)
        if outbound is None:
            return False
        try:
            payload, byte_size = self._encode_canvas_message(message)
        except Exception:
            return False
        if message.get("type") == "presence_snapshot":
            outbound.presence_snapshot = (payload, byte_size)
            outbound.presence_membership = None
        else:
            outbound.presence_membership = (payload, byte_size)
        outbound.wake.set()
        return True

    async def broadcast_presence_membership(
        self,
        canvas_id: str,
        message: Dict[str, Any],
        *,
        exclude: Any | None = None,
        fallback_snapshots: Mapping[Any, Dict[str, Any]] | None = None,
    ) -> None:
        try:
            payload, byte_size = self._encode_canvas_message(message)
        except Exception:
            return
        for websocket in list(self.canvas_connections.get(canvas_id, {})):
            if websocket is exclude:
                continue
            outbound = self.canvas_outbound.get(websocket)
            if outbound is None:
                continue
            if message.get("type") == "presence_snapshot":
                outbound.presence_snapshot = (payload, byte_size)
                outbound.presence_membership = None
            elif (
                outbound.presence_snapshot is not None
                or outbound.presence_membership is not None
            ):
                snapshot = (fallback_snapshots or {}).get(websocket)
                if snapshot is None:
                    continue
                try:
                    snapshot_payload, snapshot_byte_size = (
                        self._encode_canvas_message(snapshot)
                    )
                except Exception:
                    continue
                outbound.presence_snapshot = (
                    snapshot_payload,
                    snapshot_byte_size,
                )
                outbound.presence_membership = None
            else:
                outbound.presence_membership = (payload, byte_size)
            outbound.wake.set()

    async def broadcast_presence_batch(
        self,
        canvas_id: str,
        message: Dict[str, Any],
    ) -> None:
        updates = message.get("updates")
        if not isinstance(updates, list):
            return
        for websocket in list(self.canvas_connections.get(canvas_id, {})):
            outbound = self.canvas_outbound.get(websocket)
            if outbound is None:
                continue
            for update in updates:
                if not isinstance(update, dict):
                    continue
                participant_id = str(update.get("participant_id") or "")
                if participant_id:
                    outbound.presence_pointers[participant_id] = dict(update)
            if outbound.presence_pointers:
                outbound.wake.set()

    def clear_presence_participant(
        self,
        canvas_id: str,
        participant_id: str,
    ) -> None:
        for websocket in list(self.canvas_connections.get(canvas_id, {})):
            outbound = self.canvas_outbound.get(websocket)
            if outbound is not None:
                outbound.presence_pointers.pop(participant_id, None)

    async def close_for_workspace_move(self) -> None:
        """Close every live channel before the frozen Workspace copy."""

        sockets = set(self.active_connections)
        for connections in self.canvas_connections.values():
            sockets.update(connections)
        for canvas_id, connections in list(self.canvas_connections.items()):
            for websocket in list(connections):
                self.disconnect_canvas(websocket, canvas_id)
        for websocket in sockets:
            try:
                await websocket.close(
                    code=1012,
                    reason="工作区正在搬家，请稍后重新进入",
                )
            except Exception:
                pass
        self.active_connections.clear()
        self.user_connections.clear()
        self.connection_clients.clear()
        self.canvas_connections.clear()
        self.canvas_connection_ids.clear()
        self.canvas_outbound.clear()
        close_tasks = list(self.canvas_close_tasks)
        for task in close_tasks:
            task.cancel()
        if close_tasks:
            await asyncio.gather(*close_tasks, return_exceptions=True)
        self.canvas_close_tasks.clear()
        self.notification_effects.clear()
        self.notification_effect_sets.clear()


__all__ = [
    "CANVAS_CONNECTION_LIMIT_ENV",
    "DEFAULT_CANVAS_CONNECTION_LIMIT",
    "ConnectionManager",
    "configured_canvas_connection_limit",
]
