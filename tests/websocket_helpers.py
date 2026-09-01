"""Helpers for Canvas WebSocket tests that share the Presence transport."""

from __future__ import annotations


PRESENCE_MESSAGE_TYPES = {
    "presence_snapshot",
    "presence_joined",
    "presence_left",
    "presence_update",
}


def receive_canvas_message(socket, expected_type: str, *, limit: int = 16) -> dict:
    """Receive a durable Canvas message while draining transient Presence frames."""

    for _ in range(limit):
        message = socket.receive_json()
        message_type = message.get("type")
        if message_type == expected_type:
            return message
        if message_type not in PRESENCE_MESSAGE_TYPES:
            raise AssertionError(
                f"expected {expected_type!r}, received {message_type!r}: {message!r}"
            )
    raise AssertionError(
        f"expected {expected_type!r} after draining {limit} Presence messages"
    )
