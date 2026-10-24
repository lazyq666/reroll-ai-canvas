"""Strict, identity-only Reroll node reference wire format (LAZ-90)."""

import re
from urllib.parse import unquote


MAX_NODES = 1000
MAX_REFERENCE_BYTES = 131072
_FIELD = r"(?:[A-Za-z0-9_.!~*'()-]|%[0-9A-Fa-f]{2})+"
_REFERENCE = re.compile(rf"Reroll workspace=({_FIELD}) canvas=({_FIELD}) nodes=({_FIELD}(?:,{_FIELD})*)")


class NodeReferenceError(ValueError):
    def __init__(self, code, details=None):
        self.code = code
        self.details = details or {}
        super().__init__(code)


def parse_reference(reference):
    """Decode UTF-8 percent-encoded IDs, never names, URLs or a partial line."""
    if not isinstance(reference, str):
        raise NodeReferenceError("invalid_node_reference")
    try:
        size = len(reference.encode("utf-8"))
    except UnicodeError:
        raise NodeReferenceError("invalid_node_reference") from None
    if size > MAX_REFERENCE_BYTES:
        raise NodeReferenceError("node_reference_too_large", {"maximum_bytes": MAX_REFERENCE_BYTES})
    match = _REFERENCE.fullmatch(reference)
    if not match:
        raise NodeReferenceError("invalid_node_reference")
    encoded = match[3].split(",")
    if len(encoded) > MAX_NODES:
        raise NodeReferenceError("node_reference_too_large", {"maximum_nodes": MAX_NODES})
    try:
        values = [unquote(value, encoding="utf-8", errors="strict")
                  for value in [match[1], match[2], *encoded]]
    except UnicodeError:
        raise NodeReferenceError("invalid_node_reference") from None
    if any(not value or any(ord(char) < 32 or ord(char) == 127 for char in value) for value in values):
        raise NodeReferenceError("invalid_node_reference")
    return {"workspace_id": values[0], "canvas_id": values[1],
            "node_ids": list(dict.fromkeys(values[2:]))}
