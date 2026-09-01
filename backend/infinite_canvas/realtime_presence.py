"""Ephemeral account-level Presence for Smart Canvas realtime sessions.

Presence deliberately lives outside Canvas Sync persistence.  It reuses the
existing WebSocket transport while keeping membership and pointer state in
process memory only.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import math
import os
import time
import uuid
from typing import Any, Dict, Mapping, Protocol


PRESENCE_PROTOCOL_VERSION = 1
PRESENCE_UPDATE_INTERVAL_ENV = "INFINITE_CANVAS_PRESENCE_UPDATE_INTERVAL_MS"
DEFAULT_PRESENCE_UPDATE_INTERVAL_MS = 100
MIN_PRESENCE_UPDATE_INTERVAL_MS = 50
MAX_PRESENCE_UPDATE_INTERVAL_MS = 500
PRESENCE_CONNECTION_TTL_SECONDS = 45.0
PRESENCE_MAX_SAFE_INTEGER = (2**53) - 1


def configured_presence_update_interval(
    environment: Mapping[str, str] | None = None,
) -> int:
    source = os.environ if environment is None else environment
    raw_value = str(
        source.get(
            PRESENCE_UPDATE_INTERVAL_ENV,
            DEFAULT_PRESENCE_UPDATE_INTERVAL_MS,
        )
    ).strip()
    try:
        interval = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"{PRESENCE_UPDATE_INTERVAL_ENV} must be an integer from "
            f"{MIN_PRESENCE_UPDATE_INTERVAL_MS} to "
            f"{MAX_PRESENCE_UPDATE_INTERVAL_MS}"
        ) from exc
    if not MIN_PRESENCE_UPDATE_INTERVAL_MS <= interval <= MAX_PRESENCE_UPDATE_INTERVAL_MS:
        raise ValueError(
            f"{PRESENCE_UPDATE_INTERVAL_ENV} must be an integer from "
            f"{MIN_PRESENCE_UPDATE_INTERVAL_MS} to "
            f"{MAX_PRESENCE_UPDATE_INTERVAL_MS}"
        )
    return interval


class PresenceTransport(Protocol):
    async def send_presence_membership(
        self,
        websocket: Any,
        message: Dict[str, Any],
    ) -> bool: ...

    async def broadcast_presence_membership(
        self,
        canvas_id: str,
        message: Dict[str, Any],
        *,
        exclude: Any | None = None,
        fallback_snapshots: Mapping[Any, Dict[str, Any]] | None = None,
    ) -> None: ...

    async def broadcast_presence_batch(
        self,
        canvas_id: str,
        message: Dict[str, Any],
    ) -> None: ...

    def clear_presence_participant(
        self,
        canvas_id: str,
        participant_id: str,
    ) -> None: ...


class NullRealtimePresence:
    async def join(
        self,
        websocket: Any,
        canvas_id: str,
        actor: Mapping[str, Any],
    ) -> str:
        del websocket, canvas_id, actor
        return ""

    async def leave(self, websocket: Any) -> None:
        del websocket

    async def touch(self, websocket: Any) -> None:
        del websocket

    async def receive_update(
        self,
        websocket: Any,
        message: Mapping[str, Any],
    ) -> None:
        del websocket, message

    async def resync(self, websocket: Any) -> None:
        del websocket


@dataclass
class _PresenceConnection:
    websocket: Any
    canvas_id: str
    participant_id: str
    last_seq: int = -1
    last_seen: float = field(default_factory=time.monotonic)
    rate_window_started: float = field(default_factory=time.monotonic)
    rate_messages: int = 0
    presence_disabled: bool = False


@dataclass
class _PresenceParticipant:
    actor_id: str
    participant_id: str
    username: str
    display_name: str
    avatar_color_slot: int
    pointer_color_slot: int
    connections: set[Any] = field(default_factory=set)
    cursor: Dict[str, float] | None = None
    cursor_version: int = 0
    controlling_websocket: Any | None = None


@dataclass
class _PresenceRoom:
    canvas_id: str
    members: Dict[str, _PresenceParticipant] = field(default_factory=dict)
    membership_version: int = 0
    pending_participants: set[str] = field(default_factory=set)
    flush_task: asyncio.Task[None] | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class RealtimePresenceManager:
    """Account-aggregated, bounded, in-memory Presence authority."""

    def __init__(
        self,
        transport: PresenceTransport,
        *,
        update_interval_ms: int | None = None,
        ttl_seconds: float = PRESENCE_CONNECTION_TTL_SECONDS,
    ) -> None:
        self._transport = transport
        self.update_interval_ms = (
            configured_presence_update_interval()
            if update_interval_ms is None
            else configured_presence_update_interval(
                {PRESENCE_UPDATE_INTERVAL_ENV: str(update_interval_ms)}
            )
        )
        self.batch_window_seconds = min(
            self.update_interval_ms / 2,
            50,
        ) / 1000
        self.ttl_seconds = max(1.0, float(ttl_seconds))
        self._rooms: Dict[str, _PresenceRoom] = {}
        self._connections: Dict[Any, _PresenceConnection] = {}
        self._sweeper_task: asyncio.Task[None] | None = None

    @staticmethod
    def _avatar_slot(actor: Mapping[str, Any]) -> int:
        try:
            slot = int(actor.get("avatar_color_slot") or 0)
        except (TypeError, ValueError):
            slot = 0
        return slot if 1 <= slot <= 10 else 1

    @staticmethod
    def _member_payload(member: _PresenceParticipant) -> Dict[str, Any]:
        return {
            "participant_id": member.participant_id,
            "display_name": member.display_name,
            "username": member.username,
            "avatar_color_slot": member.avatar_color_slot,
            "pointer_color_slot": member.pointer_color_slot,
            "cursor_version": member.cursor_version,
            "cursor": dict(member.cursor) if member.cursor is not None else None,
        }

    def _snapshot(
        self,
        room: _PresenceRoom,
        participant_id: str,
    ) -> Dict[str, Any]:
        return {
            "type": "presence_snapshot",
            "protocol_version": PRESENCE_PROTOCOL_VERSION,
            "update_interval_ms": self.update_interval_ms,
            "membership_version": room.membership_version,
            "self_participant_id": participant_id,
            "members": [
                self._member_payload(member)
                for member in room.members.values()
            ],
        }

    @staticmethod
    def _pointer_slot(room: _PresenceRoom) -> int:
        used = {member.pointer_color_slot for member in room.members.values()}
        for slot in range(1, 11):
            if slot not in used:
                return slot
        return (len(room.members) % 10) + 1

    def _ensure_sweeper(self) -> None:
        if self._sweeper_task is None or self._sweeper_task.done():
            self._sweeper_task = asyncio.create_task(self._sweep_stale_connections())

    async def join(
        self,
        websocket: Any,
        canvas_id: str,
        actor: Mapping[str, Any],
    ) -> str:
        actor_id = str(actor.get("id") or "")
        if (
            not actor_id
            or actor.get("status", "active") != "active"
            or actor.get("role") not in {"admin", "designer"}
        ):
            return ""
        room = self._rooms.setdefault(canvas_id, _PresenceRoom(canvas_id))
        joined = False
        async with room.lock:
            member = room.members.get(actor_id)
            if member is None:
                member = _PresenceParticipant(
                    actor_id=actor_id,
                    participant_id=f"p_{uuid.uuid4().hex}",
                    username=str(actor.get("username") or "")[:120],
                    display_name=(
                        str(actor.get("display_name") or "").strip()
                        or str(actor.get("username") or "").strip()
                    )[:120],
                    avatar_color_slot=self._avatar_slot(actor),
                    pointer_color_slot=self._pointer_slot(room),
                )
                room.members[actor_id] = member
                room.membership_version += 1
                joined = True
            member.connections.add(websocket)
            connection = _PresenceConnection(
                websocket=websocket,
                canvas_id=canvas_id,
                participant_id=member.participant_id,
            )
            self._connections[websocket] = connection
            snapshot = self._snapshot(room, member.participant_id)
            join_message = {
                "type": "presence_join",
                "protocol_version": PRESENCE_PROTOCOL_VERSION,
                "membership_version": room.membership_version,
                "member": self._member_payload(member),
            }
            fallback_snapshots = {
                connection_websocket: self._snapshot(
                    room,
                    connection_member.participant_id,
                )
                for connection_member in room.members.values()
                for connection_websocket in connection_member.connections
                if connection_websocket is not websocket
            }
        await self._transport.send_presence_membership(websocket, snapshot)
        if joined:
            await self._transport.broadcast_presence_membership(
                canvas_id,
                join_message,
                exclude=websocket,
                fallback_snapshots=fallback_snapshots,
            )
        self._ensure_sweeper()
        return member.participant_id

    async def leave(self, websocket: Any) -> None:
        connection = self._connections.pop(websocket, None)
        if connection is None:
            return
        room = self._rooms.get(connection.canvas_id)
        if room is None:
            return
        leave_message: Dict[str, Any] | None = None
        fallback_snapshots: Dict[Any, Dict[str, Any]] = {}
        schedule_cursor = False
        participant_id = connection.participant_id
        async with room.lock:
            member = next(
                (
                    item
                    for item in room.members.values()
                    if item.participant_id == participant_id
                ),
                None,
            )
            if member is None:
                return
            member.connections.discard(websocket)
            if member.controlling_websocket is websocket:
                member.controlling_websocket = None
                if member.cursor is not None:
                    member.cursor = None
                    member.cursor_version += 1
                    schedule_cursor = bool(member.connections)
            if not member.connections:
                room.members.pop(member.actor_id, None)
                room.pending_participants.discard(participant_id)
                room.membership_version += 1
                leave_message = {
                    "type": "presence_leave",
                    "protocol_version": PRESENCE_PROTOCOL_VERSION,
                    "membership_version": room.membership_version,
                    "participant_id": participant_id,
                }
                fallback_snapshots = {
                    connection_websocket: self._snapshot(
                        room,
                        connection_member.participant_id,
                    )
                    for connection_member in room.members.values()
                    for connection_websocket in connection_member.connections
                }
            elif schedule_cursor:
                room.pending_participants.add(participant_id)
                self._schedule_flush(room)
        if leave_message is not None:
            self._transport.clear_presence_participant(
                connection.canvas_id,
                participant_id,
            )
            await self._transport.broadcast_presence_membership(
                connection.canvas_id,
                leave_message,
                exclude=websocket,
                fallback_snapshots=fallback_snapshots,
            )
        if not room.members:
            if room.flush_task is not None:
                room.flush_task.cancel()
            self._rooms.pop(connection.canvas_id, None)

    async def touch(self, websocket: Any) -> None:
        connection = self._connections.get(websocket)
        if connection is not None:
            connection.last_seen = time.monotonic()

    @staticmethod
    def _valid_seq(value: Any) -> bool:
        return (
            isinstance(value, int)
            and not isinstance(value, bool)
            and 0 <= value <= PRESENCE_MAX_SAFE_INTEGER
        )

    @staticmethod
    def _valid_cursor(value: Any) -> bool:
        if value is None:
            return True
        if not isinstance(value, Mapping) or set(value) != {"x", "y"}:
            return False
        return all(
            isinstance(value[key], (int, float))
            and not isinstance(value[key], bool)
            and math.isfinite(float(value[key]))
            for key in ("x", "y")
        )

    def _rate_allowed(self, connection: _PresenceConnection) -> tuple[bool, bool]:
        now = time.monotonic()
        if now - connection.rate_window_started >= 1.0:
            connection.rate_window_started = now
            connection.rate_messages = 0
        connection.rate_messages += 1
        normal_per_second = max(2, math.ceil(1000 / self.update_interval_ms))
        if connection.presence_disabled:
            return False, connection.rate_messages > normal_per_second * 8
        if connection.rate_messages > normal_per_second * 4:
            connection.presence_disabled = True
            return False, False
        return connection.rate_messages <= normal_per_second * 2, False

    async def receive_update(
        self,
        websocket: Any,
        message: Mapping[str, Any],
    ) -> None:
        connection = self._connections.get(websocket)
        if connection is None:
            return
        if set(message) != {"type", "seq", "cursor"}:
            return
        seq = message.get("seq")
        cursor = message.get("cursor")
        if (
            not self._valid_seq(seq)
            or int(seq) <= connection.last_seq
            or not self._valid_cursor(cursor)
        ):
            return
        connection.last_seen = time.monotonic()
        connection.last_seq = int(seq)
        allowed, close_socket = self._rate_allowed(connection)
        if close_socket:
            try:
                await websocket.close(code=4408, reason="Presence update rate exceeded")
            except Exception:
                pass
            return
        room = self._rooms.get(connection.canvas_id)
        if room is None:
            return
        async with room.lock:
            member = next(
                (
                    item
                    for item in room.members.values()
                    if item.participant_id == connection.participant_id
                ),
                None,
            )
            if member is None:
                return
            if not allowed:
                if member.controlling_websocket is websocket and member.cursor is not None:
                    member.controlling_websocket = None
                    member.cursor = None
                    member.cursor_version += 1
                    room.pending_participants.add(member.participant_id)
                    self._schedule_flush(room)
                return
            if cursor is None:
                if member.controlling_websocket is not websocket:
                    return
                member.controlling_websocket = None
                member.cursor = None
            else:
                member.controlling_websocket = websocket
                member.cursor = {
                    "x": float(cursor["x"]),
                    "y": float(cursor["y"]),
                }
            member.cursor_version += 1
            room.pending_participants.add(member.participant_id)
            self._schedule_flush(room)

    def _schedule_flush(self, room: _PresenceRoom) -> None:
        if room.flush_task is None or room.flush_task.done():
            room.flush_task = asyncio.create_task(self._flush_room(room))

    async def _flush_room(self, room: _PresenceRoom) -> None:
        try:
            await asyncio.sleep(self.batch_window_seconds)
            async with room.lock:
                participant_ids = set(room.pending_participants)
                room.pending_participants.clear()
                room.flush_task = None
                members = {
                    member.participant_id: member
                    for member in room.members.values()
                }
                updates = [
                    {
                        "participant_id": participant_id,
                        "cursor_version": members[participant_id].cursor_version,
                        "cursor": (
                            dict(members[participant_id].cursor)
                            if members[participant_id].cursor is not None
                            else None
                        ),
                    }
                    for participant_id in participant_ids
                    if participant_id in members
                ]
            if updates:
                await self._transport.broadcast_presence_batch(
                    room.canvas_id,
                    {
                        "type": "presence_batch",
                        "protocol_version": PRESENCE_PROTOCOL_VERSION,
                        "updates": updates,
                    },
                )
        except asyncio.CancelledError:
            raise

    async def resync(self, websocket: Any) -> None:
        connection = self._connections.get(websocket)
        if connection is None:
            return
        connection.last_seen = time.monotonic()
        room = self._rooms.get(connection.canvas_id)
        if room is None:
            return
        async with room.lock:
            snapshot = self._snapshot(room, connection.participant_id)
        await self._transport.send_presence_membership(websocket, snapshot)

    async def _sweep_stale_connections(self) -> None:
        try:
            while self._connections:
                now = time.monotonic()
                next_deadline = min(
                    connection.last_seen + self.ttl_seconds
                    for connection in self._connections.values()
                )
                await asyncio.sleep(max(0.0, next_deadline - now))
                now = time.monotonic()
                stale = [
                    connection.websocket
                    for connection in self._connections.values()
                    if now - connection.last_seen >= self.ttl_seconds
                ]
                for websocket in stale:
                    await self.leave(websocket)
                    try:
                        await websocket.close(
                            code=1001,
                            reason="Presence connection timed out",
                        )
                    except Exception:
                        pass
        except asyncio.CancelledError:
            raise
        finally:
            self._sweeper_task = None

    async def close_all(self) -> None:
        sockets = list(self._connections)
        for websocket in sockets:
            await self.leave(websocket)
        for room in list(self._rooms.values()):
            if room.flush_task is not None:
                room.flush_task.cancel()
        self._rooms.clear()
        if self._sweeper_task is not None:
            self._sweeper_task.cancel()
            await asyncio.gather(self._sweeper_task, return_exceptions=True)
            self._sweeper_task = None


__all__ = [
    "DEFAULT_PRESENCE_UPDATE_INTERVAL_MS",
    "MAX_PRESENCE_UPDATE_INTERVAL_MS",
    "MIN_PRESENCE_UPDATE_INTERVAL_MS",
    "NullRealtimePresence",
    "PRESENCE_PROTOCOL_VERSION",
    "PRESENCE_UPDATE_INTERVAL_ENV",
    "RealtimePresenceManager",
    "configured_presence_update_interval",
]
