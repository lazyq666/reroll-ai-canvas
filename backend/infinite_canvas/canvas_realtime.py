"""Authoritative mutation engine for realtime Smart Canvas documents.

The module is deliberately transport-agnostic.  HTTP/WebSocket adapters own
authentication and persistence; this module owns deterministic document
mutation, revision ordering, idempotence, validation, tombstones, and safe
per-actor inverse operations.
"""

from __future__ import annotations

import copy
import base64
import hashlib
import json
import math
import re
import time
import zlib
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Tuple


REALTIME_META_KEY = "_realtime"
REALTIME_HISTORY_LIMIT = 200
REALTIME_RECEIPT_LIMIT = 1000
REALTIME_SEEN_BLOOM_BITS = 1 << 20
REALTIME_SEEN_BLOOM_HASHES = 7
REALTIME_SEEN_BLOOM_RAW_PREFIX = "raw-v1:"
OPERATION_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{8,160}$")
MISSING = object()
INTERNAL_LINEAGE_FIELDS = {
    "if_operation",
    "if_version_absent",
    "restore_version",
    "if_overlap_versions",
    "restore_overlap_versions",
    "legacy_overlap_conflict",
    "legacy_lineage_conflict",
    "lineage_path",
    "if_node_operation",
    "if_node_version_absent",
    "restore_node_version",
    "preserve_node_version",
    "if_exist_operation",
    "if_exist_version_absent",
    "restore_exist_version",
    "restore_from",
}


class CanvasRealtimeError(ValueError):
    """A deterministic mutation rejection suitable for a client response."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        revision: int = 0,
        retry_changes: Dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.revision = int(revision or 0)
        self.retry_changes = _clone(retry_changes) if retry_changes else None


@dataclass(frozen=True)
class CanvasMutationResult:
    operation_id: str
    revision: int
    actor_id: str
    changes: Dict[str, Any]
    duplicate: bool = False
    reverts_operation_id: str = ""
    undoable: bool = True
    non_undoable_canvas_roots: Tuple[str, ...] = ()

    def message(self) -> Dict[str, Any]:
        return {
            "type": "canvas_mutation",
            "operation_id": self.operation_id,
            "revision": self.revision,
            "actor_id": self.actor_id,
            "changes": copy.deepcopy(self.changes),
            "duplicate": self.duplicate,
            "reverts_operation_id": self.reverts_operation_id,
            "undoable": self.undoable,
            "non_undoable_canvas_roots": list(
                self.non_undoable_canvas_roots
            ),
        }


def _clone(value: Any) -> Any:
    return copy.deepcopy(value)


def _stable_hash(value: Any) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _seen_bloom_bytes(state: Dict[str, Any]) -> bytearray:
    encoded = str(state.get("seen_operations") or "")
    expected_length = REALTIME_SEEN_BLOOM_BITS // 8
    if encoded:
        try:
            if encoded.startswith(REALTIME_SEEN_BLOOM_RAW_PREFIX):
                decoded = base64.b64decode(
                    encoded[len(REALTIME_SEEN_BLOOM_RAW_PREFIX) :]
                )
            else:
                decoded = zlib.decompress(base64.b64decode(encoded))
            if len(decoded) == expected_length:
                return bytearray(decoded)
        except (ValueError, zlib.error):
            pass
    bloom = bytearray(expected_length)
    for operation_id in (state.get("receipts") or {}):
        _seen_bloom_mark(bloom, str(operation_id))
    return bloom


def _seen_bloom_positions(operation_id: str):
    digest = hashlib.sha256(operation_id.encode("utf-8")).digest()
    for index in range(REALTIME_SEEN_BLOOM_HASHES):
        offset = index * 4
        yield int.from_bytes(digest[offset : offset + 4], "big") % (
            REALTIME_SEEN_BLOOM_BITS
        )


def _seen_bloom_mark(bloom: bytearray, operation_id: str) -> None:
    for position in _seen_bloom_positions(operation_id):
        bloom[position // 8] |= 1 << (position % 8)


def _seen_bloom_contains(
    state: Dict[str, Any],
    operation_id: str,
    bloom: bytearray | None = None,
) -> bool:
    bloom = bloom if bloom is not None else _seen_bloom_bytes(state)
    return all(
        bloom[position // 8] & (1 << (position % 8))
        for position in _seen_bloom_positions(operation_id)
    )


def _seen_bloom_add(
    state: Dict[str, Any],
    operation_id: str,
    bloom: bytearray | None = None,
) -> None:
    bloom = bloom if bloom is not None else _seen_bloom_bytes(state)
    _seen_bloom_mark(bloom, operation_id)
    state["seen_operations"] = (
        REALTIME_SEEN_BLOOM_RAW_PREFIX
        + base64.b64encode(bytes(bloom)).decode("ascii")
    )


def seen_operations_encoding_diagnostics(
    *,
    saturated_operation_count: int = 24_000,
    sample_count: int = 25,
) -> Dict[str, Any]:
    """Measure the persisted idempotency ledger at formal-suite saturation."""

    bloom = bytearray(REALTIME_SEEN_BLOOM_BITS // 8)
    for index in range(saturated_operation_count):
        _seen_bloom_mark(bloom, f"saturated-operation-{index:05d}")
    legacy_encoded = base64.b64encode(
        zlib.compress(bytes(bloom), level=6)
    ).decode("ascii")
    legacy_state = {"seen_operations": legacy_encoded}
    legacy_zlib_decode_supported = _seen_bloom_contains(
        legacy_state,
        "saturated-operation-00000",
    )

    format_state = {"seen_operations": legacy_encoded}
    _seen_bloom_add(format_state, "format-probe-operation")
    current_encoded = str(format_state.get("seen_operations") or "")
    storage_format = (
        "raw-v1" if current_encoded.startswith("raw-v1:") else "legacy-zlib"
    )
    latencies_ms: List[float] = []
    round_trip_passed = True
    for index in range(sample_count):
        operation_id = f"encoding-sample-{index:05d}"
        state = {"seen_operations": current_encoded}
        started_ns = time.perf_counter_ns()
        _seen_bloom_add(state, operation_id)
        latencies_ms.append(
            (time.perf_counter_ns() - started_ns) / 1_000_000
        )
        round_trip_passed = round_trip_passed and _seen_bloom_contains(
            state,
            operation_id,
        )
    sorted_latencies = sorted(latencies_ms)
    p95_index = max(0, math.ceil(len(sorted_latencies) * 0.95) - 1)
    return {
        "saturated_operation_count": saturated_operation_count,
        "sample_count": sample_count,
        "seen_operations_storage_format": storage_format,
        "legacy_zlib_decode_supported": legacy_zlib_decode_supported,
        "seen_operations_round_trip_passed": round_trip_passed,
        "seen_operations_encode_p95_ms": round(
            sorted_latencies[p95_index],
            3,
        ),
        "seen_operations_encode_latencies_ms": [
            round(value, 3) for value in latencies_ms
        ],
    }


def _state(canvas: Dict[str, Any]) -> Dict[str, Any]:
    state = canvas.get(REALTIME_META_KEY)
    if not isinstance(state, dict):
        state = {}
        canvas[REALTIME_META_KEY] = state
    state["enabled"] = True
    state.setdefault("receipts", {})
    state.setdefault("history", [])
    state.setdefault("tombstones", {})
    state.setdefault("versions", {})
    canvas["revision"] = max(0, int(canvas.get("revision") or 0))
    return state


def enable_realtime(canvas: Dict[str, Any]) -> bool:
    """Enable authoritative writes for a Smart Canvas without changing revision."""

    was_enabled = bool(canvas.get(REALTIME_META_KEY, {}).get("enabled"))
    _state(canvas)
    return not was_enabled


def realtime_enabled(canvas: Dict[str, Any]) -> bool:
    return bool(canvas.get(REALTIME_META_KEY, {}).get("enabled"))


def public_snapshot(canvas: Dict[str, Any]) -> Dict[str, Any]:
    """Return the shared document only; client-local view state is omitted."""

    snapshot = _clone(canvas)
    snapshot.pop(REALTIME_META_KEY, None)
    snapshot.pop("_generation_runs", None)
    snapshot.pop("viewport", None)
    snapshot["revision"] = max(0, int(snapshot.get("revision") or 0))
    snapshot["nodes"] = (
        snapshot.get("nodes") if isinstance(snapshot.get("nodes"), list) else []
    )
    snapshot["connections"] = (
        snapshot.get("connections")
        if isinstance(snapshot.get("connections"), list)
        else []
    )
    return snapshot


def _public_state_equal(
    before: Dict[str, Any],
    after: Dict[str, Any],
) -> bool:
    """Compare shared fields without cloning large Node payloads."""

    excluded = {REALTIME_META_KEY, "_generation_runs", "viewport"}
    keys = (set(before) | set(after)) - excluded
    for key in keys:
        if key == "revision":
            if max(0, int(before.get(key) or 0)) != max(
                0, int(after.get(key) or 0)
            ):
                return False
            continue
        if key in {"nodes", "connections"}:
            before_value = before.get(key)
            after_value = after.get(key)
            if (before_value if isinstance(before_value, list) else []) != (
                after_value if isinstance(after_value, list) else []
            ):
                return False
            continue
        if (key in before) != (key in after):
            return False
        if before.get(key) != after.get(key):
            return False
    return True


def _operation_id(operation: Dict[str, Any]) -> str:
    value = str(operation.get("operation_id") or "").strip()
    if not OPERATION_ID_RE.fullmatch(value):
        raise CanvasRealtimeError(
            "invalid_operation_id",
            "operation_id 必须为 8-160 位稳定标识。",
        )
    return value


def _path(value: Any) -> Tuple[str, ...]:
    if (
        not isinstance(value, list)
        or not value
        or len(value) > 8
        or any(
            not isinstance(part, str)
            or not part
            or len(part) > 120
            for part in value
        )
    ):
        raise CanvasRealtimeError("invalid_path", "Mutation 字段路径无效。")
    return tuple(value)


def _path_get(target: Dict[str, Any], path: Tuple[str, ...]) -> Any:
    current: Any = target
    for part in path:
        if not isinstance(current, dict) or part not in current:
            return MISSING
        current = current[part]
    return current


def _path_set(target: Dict[str, Any], path: Tuple[str, ...], value: Any) -> None:
    current = target
    for part in path[:-1]:
        child = current.get(part)
        if not isinstance(child, dict):
            child = {}
            current[part] = child
        current = child
    current[path[-1]] = _clone(value)


def _path_unset(target: Dict[str, Any], path: Tuple[str, ...]) -> None:
    current: Any = target
    for part in path[:-1]:
        if not isinstance(current, dict):
            return
        current = current.get(part)
    if isinstance(current, dict):
        current.pop(path[-1], None)


def _path_key(scope: str, identifier: str, path: Tuple[str, ...]) -> str:
    encoded = json.dumps(path, ensure_ascii=False, separators=(",", ":"))
    return f"{scope}:{identifier}:{encoded}"


def _decode_path_key(
    key: str,
) -> Tuple[str, str, Tuple[str, ...]] | None:
    if key.startswith("node:"):
        body = key[len("node:") :]
        scope = "node"
        separator = body.find(":[")
        while separator >= 0:
            identifier = body[:separator]
            encoded = body[separator + 1 :]
            try:
                decoded = json.loads(encoded)
            except (TypeError, ValueError):
                separator = body.find(":[", separator + 2)
                continue
            if isinstance(decoded, list) and all(
                isinstance(part, str) for part in decoded
            ):
                return scope, identifier, tuple(decoded)
            separator = body.find(":[", separator + 2)
        return None
    elif key.startswith("canvas::"):
        scope, identifier, encoded = "canvas", "", key[len("canvas::") :]
    else:
        return None
    try:
        decoded = json.loads(encoded)
    except (TypeError, ValueError):
        return None
    if not isinstance(decoded, list) or not all(
        isinstance(part, str) for part in decoded
    ):
        return None
    return scope, identifier, tuple(decoded)


class _PathVersionIndex:
    """Index field clocks by owner and prefix for bounded overlap lookups."""

    def __init__(self, versions: Dict[str, str]) -> None:
        self.versions = versions
        self._exact: Dict[
            Tuple[str, str, Tuple[str, ...]], str
        ] = {}
        self._descendants: Dict[
            Tuple[str, str, Tuple[str, ...]], set[str]
        ] = {}
        for key in versions:
            self._add(key)

    def _add(self, key: str) -> None:
        decoded = _decode_path_key(key)
        if decoded is None:
            return
        scope, identifier, path = decoded
        self._exact[(scope, identifier, path)] = key
        for size in range(1, len(path) + 1):
            prefix = path[:size]
            self._descendants.setdefault(
                (scope, identifier, prefix), set()
            ).add(key)

    def _remove(self, key: str) -> None:
        decoded = _decode_path_key(key)
        if decoded is None:
            return
        scope, identifier, path = decoded
        self._exact.pop((scope, identifier, path), None)
        for size in range(1, len(path) + 1):
            prefix_key = (scope, identifier, path[:size])
            descendants = self._descendants.get(prefix_key)
            if descendants is None:
                continue
            descendants.discard(key)
            if not descendants:
                self._descendants.pop(prefix_key, None)

    def sync(self, key: str) -> None:
        self._remove(key)
        if key in self.versions:
            self._add(key)

    def overlap_keys(
        self,
        scope: str,
        identifier: str,
        path: Tuple[str, ...],
    ) -> set[str]:
        keys = set(
            self._descendants.get((scope, identifier, path), set())
        )
        exact = self._exact.get((scope, identifier, path))
        if exact:
            keys.discard(exact)
        for size in range(1, len(path)):
            ancestor = self._exact.get(
                (scope, identifier, path[:size])
            )
            if ancestor:
                keys.add(ancestor)
        return keys


def _paths_overlap(left: Tuple[str, ...], right: Tuple[str, ...]) -> bool:
    shortest = min(len(left), len(right))
    return left[:shortest] == right[:shortest]


def _overlap_version_fields(
    versions: Dict[str, str],
    scope: str,
    identifier: str,
    path: Tuple[str, ...],
    *,
    path_index: _PathVersionIndex | None = None,
) -> Dict[str, str]:
    if path_index is not None:
        return {
            key: str(versions.get(key) or "")
            for key in path_index.overlap_keys(scope, identifier, path)
            if key in versions
        }
    return {
        key: str(value or "")
        for key, value in versions.items()
        if (
            (decoded := _decode_path_key(key)) is not None
            and decoded[0] == scope
            and decoded[1] == identifier
            and decoded[2] != path
            and _paths_overlap(decoded[2], path)
        )
    }


def _transition_overlap_versions(
    versions: Dict[str, str],
    scope: str,
    identifier: str,
    path: Tuple[str, ...],
    entry: Dict[str, Any],
    *,
    operation_id: str,
    revision: int,
    restore_versions: bool,
    transitioned_version_keys: set[str] | None = None,
    transitioned_owners: set[Tuple[str, str]] | None = None,
    preflight_complete: bool = False,
    path_index: _PathVersionIndex | None = None,
) -> Tuple[Dict[str, str], Dict[str, str]]:
    """Advance related parent/child clocks and return their inverse lineage."""

    if restore_versions and entry.get("legacy_overlap_conflict"):
        raise CanvasRealtimeError(
            "undo_conflict",
            "该操作之后已有协作修改，无法安全撤销。",
            revision=revision,
        )

    previous = _overlap_version_fields(
        versions,
        scope,
        identifier,
        path,
        path_index=path_index,
    )
    ancestors = {
        key: value
        for key, value in previous.items()
        if (
            (decoded := _decode_path_key(key)) is not None
            and len(decoded[2]) < len(path)
        )
    }
    raw_expected = entry.get("if_overlap_versions")
    raw_restore = entry.get("restore_overlap_versions")
    if restore_versions and isinstance(raw_expected, dict):
        if preflight_complete:
            restore = raw_restore if isinstance(raw_restore, dict) else {}
            for key in set(previous) | {str(item) for item in restore}:
                if key in (transitioned_version_keys or set()):
                    continue
                restored = str(restore.get(key) or "")
                if restored:
                    versions[key] = restored
                else:
                    versions.pop(key, None)
                if path_index is not None:
                    path_index.sync(key)
            current = _overlap_version_fields(
                versions,
                scope,
                identifier,
                path,
                path_index=path_index,
            )
            return previous, current
        if (scope, identifier) in (transitioned_owners or set()):
            return previous, previous
        if transitioned_version_keys and any(
            (
                decoded := _decode_path_key(touched)
            ) is not None
            and decoded[0] == scope
            and decoded[1] == identifier
            and _paths_overlap(decoded[2], path)
            for touched in transitioned_version_keys
        ):
            return previous, previous
        expected = {
            str(key): str(value or "") for key, value in raw_expected.items()
        }
        ignored = set(transitioned_version_keys or set())
        matched_transition = False
        for key in set(previous) | set(expected):
            decoded = _decode_path_key(key)
            if decoded and any(
                (
                    transitioned := _decode_path_key(touched)
                ) is not None
                and transitioned[:2] == decoded[:2]
                and _paths_overlap(transitioned[2], decoded[2])
                for touched in transitioned_version_keys or set()
            ):
                ignored.add(key)
                matched_transition = True
        if matched_transition:
            return previous, previous
        if {
            key: value for key, value in previous.items() if key not in ignored
        } != {
            key: value for key, value in expected.items() if key not in ignored
        }:
            raise CanvasRealtimeError(
                "undo_conflict",
                "该操作之后已有协作修改，无法安全撤销。",
                revision=revision,
            )
        restore = raw_restore if isinstance(raw_restore, dict) else {}
        for key in set(previous) | {str(item) for item in restore}:
            restored = str(restore.get(key) or "")
            if restored:
                versions[key] = restored
            else:
                versions.pop(key, None)
            if path_index is not None:
                path_index.sync(key)
    else:
        for key in previous:
            decoded = _decode_path_key(key)
            if decoded and len(decoded[2]) < len(path):
                continue
            versions[key] = operation_id
            if path_index is not None:
                path_index.sync(key)
    current = _overlap_version_fields(
        versions,
        scope,
        identifier,
        path,
        path_index=path_index,
    )
    if not restore_versions:
        current = {
            **current,
            **ancestors,
        }
    return previous, current


def _node_key(node_id: str, kind: str = "changed") -> str:
    return f"node:{node_id}:{kind}"


def _connection_key(connection: Dict[str, Any]) -> str:
    return "\x1f".join(
        (
            str(connection.get("from") or ""),
            str(connection.get("to") or ""),
            str(connection.get("kind") or "flow"),
        )
    )


def _version_matches(
    versions: Dict[str, str],
    key: str,
    expected: Any,
    revision: int,
    *,
    expect_absent: bool = False,
) -> None:
    if expect_absent and key in versions:
        raise CanvasRealtimeError(
            "undo_conflict",
            "该操作之后已有协作修改，无法安全撤销。",
            revision=revision,
        )
    if expected and versions.get(key) != expected:
        raise CanvasRealtimeError(
            "undo_conflict",
            "该操作之后已有协作修改，无法安全撤销。",
            revision=revision,
        )


def _transition_version(
    versions: Dict[str, str],
    key: str,
    entry: Dict[str, Any],
    *,
    operation_id: str,
    revision: int,
    restore_versions: bool,
    prefix: str = "",
    skip_guard: bool = False,
    path_index: _PathVersionIndex | None = None,
) -> Tuple[str, str]:
    """Validate and transition one logical mutation version."""

    if restore_versions and entry.get("legacy_lineage_conflict"):
        raise CanvasRealtimeError(
            "undo_conflict",
            "该操作之后已有协作修改，无法安全撤销。",
            revision=revision,
        )

    if_prefix = f"if_{prefix}_" if prefix else "if_"
    restore_key = f"restore_{prefix}_version" if prefix else "restore_version"
    if not skip_guard:
        _version_matches(
            versions,
            key,
            entry.get(f"{if_prefix}operation"),
            revision,
            expect_absent=bool(entry.get(f"{if_prefix}version_absent")),
        )
    previous_version = str(versions.get(key) or "")
    if restore_versions and restore_key in entry:
        current_version = str(entry.get(restore_key) or "")
        if current_version:
            versions[key] = current_version
        else:
            versions.pop(key, None)
    else:
        current_version = operation_id
        versions[key] = current_version
    if path_index is not None:
        path_index.sync(key)
    return previous_version, current_version


def _inverse_version_fields(
    expected_version: str,
    previous_version: str,
    *,
    prefix: str = "",
) -> Dict[str, Any]:
    if_prefix = f"if_{prefix}_" if prefix else "if_"
    restore_key = f"restore_{prefix}_version" if prefix else "restore_version"
    fields: Dict[str, Any] = {restore_key: previous_version}
    if expected_version:
        fields[f"{if_prefix}operation"] = expected_version
    else:
        fields[f"{if_prefix}version_absent"] = True
    return fields


def _transition_node_aggregate(
    versions: Dict[str, str],
    node_id: str,
    entry: Dict[str, Any],
    *,
    operation_id: str,
    revision: int,
    restore_versions: bool,
) -> Tuple[str, str, bool]:
    """Softly restore a Node aggregate while preserving disjoint later edits."""

    key = _node_key(node_id)
    if restore_versions and entry.get("preserve_node_version"):
        current_version = str(versions.get(key) or "")
        return current_version, current_version, False
    lineage_keys = {
        "if_node_operation",
        "if_node_version_absent",
        "restore_node_version",
    }
    if restore_versions and not lineage_keys.intersection(entry):
        current_version = str(versions.get(key) or "")
        return current_version, current_version, False
    if restore_versions and lineage_keys.intersection(entry):
        expected_version = str(entry.get("if_node_operation") or "")
        expected_absent = bool(entry.get("if_node_version_absent"))
        matches = (
            key not in versions
            if expected_absent
            else bool(expected_version) and versions.get(key) == expected_version
        )
        if not matches:
            current_version = str(versions.get(key) or "")
            return current_version, current_version, False
    previous_version, current_version = _transition_version(
        versions,
        key,
        entry,
        operation_id=operation_id,
        revision=revision,
        restore_versions=restore_versions,
        prefix="node",
    )
    return previous_version, current_version, True


def _refresh_node_aggregate_versions(state: Dict[str, Any]) -> None:
    """Derive each Node aggregate from its active field/existence clocks."""

    versions: Dict[str, str] = state["versions"]
    revision_by_operation = {
        str(record.get("operation_id") or ""): int(record.get("revision") or 0)
        for record in state["history"]
    }
    candidates: Dict[str, Tuple[int, str]] = {}
    aggregate_keys = {
        key for key in versions if key.startswith("node:") and key.endswith(":changed")
    }
    for key, raw_version in list(versions.items()):
        node_id = ""
        if key.startswith("node:") and key.endswith(":exist"):
            node_id = key[len("node:") : -len(":exist")]
        else:
            decoded = _decode_path_key(key)
            if decoded and decoded[0] == "node":
                node_id = decoded[1]
        if not node_id:
            continue
        version = str(raw_version or "")
        rank = revision_by_operation.get(version, -1)
        if node_id not in candidates or rank >= candidates[node_id][0]:
            candidates[node_id] = (rank, version)
    for key in aggregate_keys:
        versions.pop(key, None)
    for node_id, (_rank, version) in candidates.items():
        if version:
            versions[_node_key(node_id)] = version


def _empty_changes() -> Dict[str, List[Any]]:
    return {
        "node_creates": [],
        "node_updates": [],
        "node_unsets": [],
        "node_deletes": [],
        "connection_adds": [],
        "connection_removes": [],
        "canvas_updates": [],
        "canvas_unsets": [],
    }


def _without_canvas_root(
    changes: Dict[str, List[Any]],
    root: str,
) -> Dict[str, List[Any]]:
    """Remove one top-level Canvas field from persisted/public mutations.

    Generation logs are still accepted by the legacy Canvas persistence path
    during the SQLite migration window, but they are long-lived records rather
    than undoable document state. Keeping a complete before/after logs array in
    every history row was the largest source of Canvas file amplification.
    """

    filtered = _empty_changes()
    for action, entries in changes.items():
        if action not in ("canvas_updates", "canvas_unsets"):
            filtered[action] = _clone(entries)
            continue
        filtered[action] = [
            _clone(entry)
            for entry in entries
            if not (
                isinstance(entry, dict)
                and _path(entry.get("path"))[0] == root
            )
        ]
    return filtered


def normalize_changes(value: Any) -> Dict[str, List[Any]]:
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise CanvasRealtimeError("invalid_changes", "Mutation changes 必须是对象。")
    changes = _empty_changes()
    for key in changes:
        items = value.get(key, [])
        if not isinstance(items, list):
            raise CanvasRealtimeError(
                "invalid_changes",
                f"Mutation {key} 必须是数组。",
            )
        if len(items) > 5000:
            raise CanvasRealtimeError(
                "mutation_too_large",
                "单次 Mutation 包含过多变更。",
            )
        changes[key] = _clone(items)
    if sum(len(items) for items in changes.values()) > 5000:
        raise CanvasRealtimeError(
            "mutation_too_large",
            "单次 Mutation 包含过多变更。",
        )
    return changes


def _coalesce_path_changes(
    changes: Dict[str, List[Any]],
    *,
    allow_internal_overlap: bool = False,
) -> Dict[str, List[Any]]:
    """Collapse repeated field intents to their observable final action."""

    paths_by_owner: Dict[Tuple[str, str], List[Tuple[str, ...]]] = {}
    actions_by_target: Dict[Tuple[str, str, Tuple[str, ...]], str] = {}
    for action in ("node_updates", "node_unsets"):
        for raw in changes[action]:
            entry = raw if isinstance(raw, dict) else {}
            owner = ("node", str(entry.get("id") or ""))
            paths_by_owner.setdefault(owner, []).append(
                _path(entry.get("path"))
            )
            target = (*owner, _path(entry.get("path")))
            previous_action = actions_by_target.setdefault(target, action)
            if previous_action != action:
                raise CanvasRealtimeError(
                    "invalid_changes",
                    "同一 Mutation 不能同时设置并删除同一字段。",
                )
    for action in ("canvas_updates", "canvas_unsets"):
        for raw in changes[action]:
            entry = raw if isinstance(raw, dict) else {}
            paths_by_owner.setdefault(("canvas", ""), []).append(
                _path(entry.get("path"))
            )
            path = _path(entry.get("path"))
            target = ("canvas", "", path)
            previous_action = actions_by_target.setdefault(target, action)
            if previous_action != action:
                raise CanvasRealtimeError(
                    "invalid_changes",
                    "同一 Mutation 不能同时设置并删除同一字段。",
                )
    if not allow_internal_overlap:
        for owner_paths in paths_by_owner.values():
            ordered_paths = sorted(set(owner_paths))
            for path, other in zip(ordered_paths, ordered_paths[1:]):
                if other[: len(path)] == path:
                    raise CanvasRealtimeError(
                        "invalid_changes",
                        "同一 Mutation 不能同时修改父字段与子字段。",
                    )

    coalesced = _empty_changes()
    for action in (
        "node_creates",
        "node_deletes",
        "connection_adds",
        "connection_removes",
    ):
        coalesced[action] = _clone(changes[action])

    node_actions: Dict[Tuple[str, Tuple[str, ...]], Tuple[str, Dict[str, Any]]] = {}
    for action in ("node_updates", "node_unsets"):
        for raw in changes[action]:
            entry = raw if isinstance(raw, dict) else {}
            target = (str(entry.get("id") or ""), _path(entry.get("path")))
            node_actions[target] = (action, _clone(entry))
    for action, entry in node_actions.values():
        coalesced[action].append(entry)

    canvas_actions: Dict[Tuple[str, ...], Tuple[str, Dict[str, Any]]] = {}
    for action in ("canvas_updates", "canvas_unsets"):
        for raw in changes[action]:
            entry = raw if isinstance(raw, dict) else {}
            canvas_actions[_path(entry.get("path"))] = (action, _clone(entry))
    for action, entry in canvas_actions.values():
        coalesced[action].append(entry)
    return coalesced


def _public_changes(changes: Dict[str, List[Any]]) -> Dict[str, List[Any]]:
    """Remove server-only lineage metadata from broadcast mutations."""

    def clean(entry: Any) -> Any:
        if not isinstance(entry, dict):
            return _clone(entry)
        return {
            key: _clone(value)
            for key, value in entry.items()
            if key not in INTERNAL_LINEAGE_FIELDS
        }

    public = _empty_changes()
    for raw in changes["node_creates"]:
        if (
            isinstance(raw, dict)
            and not raw.get("id")
            and isinstance(raw.get("node"), dict)
        ):
            public["node_creates"].append(_clone(raw["node"]))
        else:
            public["node_creates"].append(_clone(raw))
    for action in ("node_updates", "node_unsets", "node_deletes"):
        public[action] = [clean(entry) for entry in changes[action]]
    for raw in changes["connection_adds"]:
        if (
            isinstance(raw, dict)
            and not raw.get("from")
            and not raw.get("to")
            and isinstance(raw.get("connection"), dict)
        ):
            public["connection_adds"].append(_clone(raw["connection"]))
        else:
            public["connection_adds"].append(_clone(raw))
    for raw in changes["connection_removes"]:
        cleaned = clean(raw)
        if isinstance(cleaned, dict):
            cleaned.pop("connection", None)
        public["connection_removes"].append(cleaned)
    for action in ("canvas_updates", "canvas_unsets"):
        public[action] = [clean(entry) for entry in changes[action]]
    return public


_PLACEMENT_NON_OBSTACLE_TYPES = {"smart-frame", "smart-text", "smart-brush"}
_PLACEMENT_DEFAULT_SIZES = {
    "smart-prompt": (316.0, 180.0),
    "smart-splitter": (316.0, 240.0),
    "smart-loop": (340.0, 168.0),
    "smart-group": (340.0, 286.0),
}


def _placement_node(raw: Any) -> Dict[str, Any]:
    entry = raw if isinstance(raw, dict) else {}
    if not entry.get("id") and isinstance(entry.get("node"), dict):
        return entry["node"]
    return entry


def _placement_rect(node: Dict[str, Any]) -> Tuple[float, float, float, float]:
    node_type = str(node.get("type") or "smart-image")
    default_width, default_height = _PLACEMENT_DEFAULT_SIZES.get(
        node_type,
        (316.0, 194.0),
    )

    def positive(value: Any, fallback: float) -> float:
        try:
            result = float(value)
        except (TypeError, ValueError):
            return fallback
        return result if math.isfinite(result) and result > 24 else fallback

    def coordinate(value: Any) -> float:
        try:
            result = float(value)
        except (TypeError, ValueError):
            return 0.0
        return result if math.isfinite(result) else 0.0

    width = positive(node.get("w"), default_width)
    height = positive(node.get("h"), default_height)
    return (
        coordinate(node.get("x")) - 100.0,
        coordinate(node.get("y")) - 48.0,
        width + 200.0,
        height + 96.0,
    )


def _placement_rects_overlap(
    left: Tuple[float, float, float, float],
    right: Tuple[float, float, float, float],
) -> bool:
    return (
        left[0] < right[0] + right[2]
        and left[0] + left[2] > right[0]
        and left[1] < right[1] + right[3]
        and left[1] + left[3] > right[1]
    )


def _created_nodes_collide(
    canvas: Dict[str, Any],
    changes: Dict[str, List[Any]],
    competitor_ids: set[str],
) -> bool:
    created = [_placement_node(raw) for raw in changes["node_creates"]]
    created_ids = {str(node.get("id") or "") for node in created}
    obstacles = [
        node
        for node in canvas.get("nodes", [])
        if isinstance(node, dict)
        and str(node.get("id") or "") not in created_ids
        and str(node.get("id") or "") in competitor_ids
        and str(node.get("type") or "smart-image")
        not in _PLACEMENT_NON_OBSTACLE_TYPES
    ]
    obstacle_rects = [_placement_rect(node) for node in obstacles]
    return any(
        _placement_rects_overlap(_placement_rect(node), obstacle)
        for node in created
        if str(node.get("type") or "smart-image")
        not in _PLACEMENT_NON_OBSTACLE_TYPES
        for obstacle in obstacle_rects
    )


def _placement_competitor_ids(
    canvas: Dict[str, Any],
    history: List[Dict[str, Any]],
    after_revision: int,
    current_revision: int,
) -> set[str]:
    competitors: set[str] = set()
    retained_revisions = [
        int(record.get("revision") or 0)
        for record in history
        if int(record.get("revision") or 0) > 0
    ]
    # A base immediately before the oldest retained record is still fully
    # covered. Older bases may have lost placement changes to history trimming,
    # so current Nodes become conservative candidates; the geometry check below
    # still prevents this fallback from becoming a blanket stale-write reject.
    history_covers_base = bool(retained_revisions) and (
        min(retained_revisions) <= after_revision + 1
    )
    if after_revision < current_revision and not history_covers_base:
        competitors.update(
            str(node.get("id") or "")
            for node in canvas.get("nodes", [])
            if isinstance(node, dict) and str(node.get("id") or "")
        )
    placement_fields = {
        "x",
        "y",
        "w",
        "h",
        "scale",
        "images",
        "generationMediaW",
        "generationMediaH",
    }
    for record in history:
        if int(record.get("revision") or 0) <= after_revision:
            continue
        record_changes = record.get("changes")
        if not isinstance(record_changes, dict):
            continue
        for raw in record_changes.get("node_creates", []):
            node = _placement_node(raw)
            node_id = str(node.get("id") or "")
            if node_id:
                competitors.add(node_id)
        for action in ("node_updates", "node_unsets"):
            for raw in record_changes.get(action, []):
                entry = raw if isinstance(raw, dict) else {}
                path = entry.get("path")
                if (
                    isinstance(path, list)
                    and path
                    and str(path[0]) in placement_fields
                ):
                    node_id = str(entry.get("id") or "")
                    if node_id:
                        competitors.add(node_id)
    return competitors


def _apply_restore_placement_overrides(
    changes: Dict[str, List[Any]],
    raw_overrides: Any,
    revision: int,
) -> None:
    if raw_overrides in (None, {}):
        return
    if not isinstance(raw_overrides, dict):
        raise CanvasRealtimeError(
            "invalid_changes",
            "恢复位置覆盖必须是 Node ID 到坐标的对象。",
            revision=revision,
        )
    restored = {
        str(node.get("id") or ""): node
        for node in (_placement_node(raw) for raw in changes["node_creates"])
    }
    if set(map(str, raw_overrides)) - set(restored):
        raise CanvasRealtimeError(
            "invalid_changes",
            "恢复位置覆盖包含非恢复 Node。",
            revision=revision,
        )
    for raw_id, raw_position in raw_overrides.items():
        if not isinstance(raw_position, dict):
            raise CanvasRealtimeError(
                "invalid_changes",
                "恢复位置覆盖缺少有效坐标。",
                revision=revision,
            )
        try:
            x = float(raw_position.get("x"))
            y = float(raw_position.get("y"))
        except (TypeError, ValueError):
            x = y = math.nan
        if not math.isfinite(x) or not math.isfinite(y):
            raise CanvasRealtimeError(
                "invalid_changes",
                "恢复位置覆盖缺少有效坐标。",
                revision=revision,
            )
        restored[str(raw_id)]["x"] = x
        restored[str(raw_id)]["y"] = y


def _normal_changes_have_internal_metadata(
    changes: Dict[str, List[Any]],
) -> bool:
    for action in (
        "node_updates",
        "node_unsets",
        "node_deletes",
        "connection_removes",
        "canvas_updates",
        "canvas_unsets",
    ):
        for raw in changes[action]:
            if isinstance(raw, dict) and INTERNAL_LINEAGE_FIELDS.intersection(raw):
                return True
    for action in ("node_creates", "connection_adds"):
        for raw in changes[action]:
            if isinstance(raw, dict) and INTERNAL_LINEAGE_FIELDS.intersection(raw):
                return True
    return any(
        isinstance(raw, dict)
        and not raw.get("id")
        and isinstance(raw.get("node"), dict)
        for raw in changes["node_creates"]
    ) or any(
        isinstance(raw, dict)
        and not raw.get("from")
        and not raw.get("to")
        and isinstance(raw.get("connection"), dict)
        for raw in changes["connection_adds"]
    )


def _field_entry_key(action: str, raw: Any) -> str:
    entry = raw if isinstance(raw, dict) else {}
    path = _path(entry.get("lineage_path") or entry.get("path"))
    if action.startswith("node_"):
        return _path_key("node", str(entry.get("id") or ""), path)
    return _path_key("canvas", "", path)


def _field_entries(changes: Any):
    value = changes if isinstance(changes, dict) else {}
    for action in (
        "node_updates",
        "node_unsets",
        "canvas_updates",
        "canvas_unsets",
    ):
        for raw in value.get(action, []):
            if isinstance(raw, dict):
                yield _field_entry_key(action, raw), raw


def _connection_entries(changes: Any):
    value = changes if isinstance(changes, dict) else {}
    for action in ("connection_adds", "connection_removes"):
        for raw in value.get(action, []):
            entry = raw if isinstance(raw, dict) else {}
            connection = (
                entry.get("connection")
                if not entry.get("from")
                and not entry.get("to")
                and isinstance(entry.get("connection"), dict)
                else entry
            )
            if isinstance(connection, dict):
                yield f"connection:{_connection_key(connection)}", entry


def _legacy_fence(key: str) -> str:
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:20]
    return f"$legacy:{digest}"


def _migrate_field_lineage(state: Dict[str, Any]) -> None:
    """Backfill logical predecessors for histories written before schema 2."""

    if int(state.get("lineage_schema") or 0) >= 2:
        return
    history = sorted(
        state["history"], key=lambda record: int(record.get("revision") or 0)
    )
    if not history:
        state["lineage_schema"] = 2
        return
    known_from_start = int(history[0].get("revision") or 0) <= 1
    clocks: Dict[str, str] = {}
    transitions_by_operation: Dict[
        str, Dict[str, Tuple[str, str]]
    ] = {}
    touched_keys = set()
    legacy_inverse_entries: List[Tuple[str, Dict[str, Any]]] = []

    for record in history:
        operation_id = str(record.get("operation_id") or "")
        target_id = str(record.get("reverts_operation_id") or "")
        inverse_value = (
            record.get("inverse") if isinstance(record.get("inverse"), dict) else {}
        )
        change_field_key_counts: Dict[str, int] = {}
        for key, _entry in _field_entries(record.get("changes")):
            change_field_key_counts[key] = change_field_key_counts.get(key, 0) + 1
        unsafe_duplicate_keys = {
            key for key, count in change_field_key_counts.items() if count > 1
        }
        seen_inverse_field_keys = set()
        for action in (
            "node_updates",
            "node_unsets",
            "canvas_updates",
            "canvas_unsets",
        ):
            unique_entries = []
            for raw in inverse_value.get(action, []):
                if not isinstance(raw, dict):
                    continue
                key = _field_entry_key(action, raw)
                if key in unsafe_duplicate_keys:
                    raw["legacy_lineage_conflict"] = True
                if key in seen_inverse_field_keys:
                    continue
                seen_inverse_field_keys.add(key)
                unique_entries.append(raw)
            if action in inverse_value:
                inverse_value[action] = unique_entries
        if target_id and target_id in transitions_by_operation:
            transitions = {
                key: (after, before)
                for key, (before, after) in transitions_by_operation[
                    target_id
                ].items()
            }
        else:
            keys = {
                key for key, _entry in _field_entries(record.get("changes"))
            }
            keys.update(
                key for key, _entry in _field_entries(record.get("inverse"))
            )
            keys.update(
                key
                for key, _entry in _connection_entries(record.get("changes"))
            )
            keys.update(
                key
                for key, _entry in _connection_entries(record.get("inverse"))
            )
            transitions = {}
            for key in keys:
                before = clocks.get(
                    key, "" if known_from_start else _legacy_fence(key)
                )
                transitions[key] = (before, operation_id)
        for key, (_before, after) in transitions.items():
            clocks[key] = after
            touched_keys.add(key)
        transitions_by_operation[operation_id] = transitions

        for key, entry in _field_entries(record.get("inverse")):
            transition = transitions.get(key)
            if not transition:
                continue
            before, after = transition
            legacy_entry = "restore_version" not in entry
            for field in ("if_operation", "if_version_absent", "restore_version"):
                entry.pop(field, None)
            entry.update(_inverse_version_fields(after, before))
            if legacy_entry and key.startswith("node:"):
                for field in (
                    "if_node_operation",
                    "if_node_version_absent",
                    "restore_node_version",
                ):
                    entry.pop(field, None)
                entry["preserve_node_version"] = True
            if legacy_entry:
                legacy_inverse_entries.append((key, entry))
        for key, entry in list(_connection_entries(inverse_value)):
            transition = transitions.get(key)
            if not transition:
                continue
            before, after = transition
            wrapper = entry
            if not isinstance(entry.get("connection"), dict):
                raw_adds = inverse_value.get("connection_adds", [])
                if entry in raw_adds:
                    index = raw_adds.index(entry)
                    wrapper = {"connection": _clone(entry)}
                    raw_adds[index] = wrapper
            for field in ("if_operation", "if_version_absent", "restore_version"):
                wrapper.pop(field, None)
            wrapper.update(_inverse_version_fields(after, before))

    versions: Dict[str, str] = state["versions"]
    for key in touched_keys:
        version = clocks.get(key, "")
        if version:
            versions[key] = version
        else:
            versions.pop(key, None)
    known_path_keys = {
        key
        for key in set(versions) | touched_keys
        if _decode_path_key(key) is not None
    }
    for key, entry in legacy_inverse_entries:
        decoded = _decode_path_key(key)
        if not decoded:
            continue
        if any(
            (
                other_decoded := _decode_path_key(other)
            ) is not None
            and other != key
            and other_decoded[:2] == decoded[:2]
            and _paths_overlap(other_decoded[2], decoded[2])
            for other in known_path_keys
        ):
            entry["legacy_overlap_conflict"] = True
    state["lineage_schema"] = 2


def _node_map(canvas: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {
        str(node.get("id")): node
        for node in (canvas.get("nodes") or [])
        if isinstance(node, dict) and node.get("id")
    }


def _find_connection(
    connections: List[Dict[str, Any]],
    key: str,
) -> Tuple[int, Dict[str, Any] | None]:
    for index, connection in enumerate(connections):
        if isinstance(connection, dict) and _connection_key(connection) == key:
            return index, connection
    return -1, None


def _validate_groups(canvas: Dict[str, Any], revision: int) -> None:
    nodes = _node_map(canvas)
    group_children: Dict[str, List[str]] = {}
    member_owner: Dict[str, str] = {}
    for node_id, node in nodes.items():
        if node.get("type") != "smart-group":
            continue
        items = node.get("items")
        if items is None:
            items = []
        if not isinstance(items, list):
            raise CanvasRealtimeError(
                "invalid_group",
                "Smart Group items 必须是数组。",
                revision=revision,
            )
        normalized = [str(item) for item in items if str(item)]
        if len(normalized) != len(set(normalized)):
            raise CanvasRealtimeError(
                "invalid_group",
                "Smart Group 不能包含重复成员。",
                revision=revision,
            )
        for member_id in normalized:
            member = nodes.get(member_id)
            if (
                member_id == node_id
                or not member
                or member.get("type") == "smart-frame"
            ):
                raise CanvasRealtimeError(
                    "invalid_group",
                    "Smart Group 包含无效成员。",
                    revision=revision,
                )
            existing_owner = member_owner.get(member_id)
            if existing_owner and existing_owner != node_id:
                raise CanvasRealtimeError(
                    "invalid_group_owner",
                    "Smart Group 成员只能属于一个编组。",
                    revision=revision,
                )
            member_owner[member_id] = node_id
        member_order = node.get("memberOrder")
        images = node.get("images") or []
        versioned_media = isinstance(images, list) and any(
            isinstance(image, dict) and image.get("groupMemberId")
            for image in images
        )
        if (
            member_order is None
            and (node.get("memberOrderVersion") is not None or versioned_media)
        ):
            raise CanvasRealtimeError(
                "invalid_group_order",
                "Smart Group 成员顺序不能被旧版本客户端移除。",
                revision=revision,
            )
        if member_order is not None:
            if (
                node.get("memberOrderVersion") != 1
                or not isinstance(member_order, list)
            ):
                raise CanvasRealtimeError(
                    "invalid_group_order",
                    "Smart Group 成员顺序版本无效。",
                    revision=revision,
                )
            if not isinstance(images, list):
                raise CanvasRealtimeError(
                    "invalid_group_order",
                    "Smart Group 媒体成员必须是数组。",
                    revision=revision,
                )
            media_ids = []
            for image in images:
                media_id = (
                    str(image.get("groupMemberId") or "")
                    if isinstance(image, dict)
                    else ""
                )
                if not media_id:
                    raise CanvasRealtimeError(
                        "invalid_group_order",
                        "Smart Group 媒体成员缺少稳定标识。",
                        revision=revision,
                    )
                media_ids.append(media_id)
            ordered_nodes = []
            ordered_media = []
            seen_order_entries = set()
            for entry in member_order:
                if not isinstance(entry, dict):
                    raise CanvasRealtimeError(
                        "invalid_group_order",
                        "Smart Group 成员顺序无效。",
                        revision=revision,
                    )
                kind = str(entry.get("kind") or "")
                entry_id = str(entry.get("id") or "")
                key = (kind, entry_id)
                if (
                    kind not in {"node", "media"}
                    or not entry_id
                    or key in seen_order_entries
                ):
                    raise CanvasRealtimeError(
                        "invalid_group_order",
                        "Smart Group 成员顺序无效。",
                        revision=revision,
                    )
                seen_order_entries.add(key)
                if kind == "node":
                    ordered_nodes.append(entry_id)
                else:
                    ordered_media.append(entry_id)
            if ordered_nodes != normalized or ordered_media != media_ids:
                raise CanvasRealtimeError(
                    "invalid_group_order",
                    "Smart Group 成员顺序与成员数据不一致。",
                    revision=revision,
                )
        group_children[node_id] = [
            member_id
            for member_id in normalized
            if nodes.get(member_id, {}).get("type") == "smart-group"
        ]

    def visit(node_id: str, trail: set[str]) -> None:
        if node_id in trail:
            raise CanvasRealtimeError(
                "invalid_group",
                "Smart Group 不能循环包含。",
                revision=revision,
            )
        next_trail = {*trail, node_id}
        for child_id in group_children.get(node_id, []):
            visit(child_id, next_trail)

    for group_id in group_children:
        visit(group_id, set())


def _validate_connections(canvas: Dict[str, Any], revision: int) -> None:
    node_ids = set(_node_map(canvas))
    seen = set()
    for connection in canvas.get("connections") or []:
        if not isinstance(connection, dict):
            raise CanvasRealtimeError(
                "invalid_connection",
                "Connection 数据无效。",
                revision=revision,
            )
        source = str(connection.get("from") or "")
        target = str(connection.get("to") or "")
        key = _connection_key(connection)
        if (
            not source
            or not target
            or source == target
            or source not in node_ids
            or target not in node_ids
            or key in seen
        ):
            raise CanvasRealtimeError(
                "invalid_connection",
                "Connection 不能重复、自环或指向不存在的 Node。",
                revision=revision,
            )
        seen.add(key)


def _record_inverse_set(
    inverse_updates: List[Dict[str, Any]],
    inverse_unsets: List[Dict[str, Any]],
    *,
    identifier: str = "",
    path: Tuple[str, ...],
    lineage_path: Tuple[str, ...] | None = None,
    old_value: Any,
    expected_version: str,
    previous_version: str,
    overlap_expected_versions: Dict[str, str] | None = None,
    overlap_previous_versions: Dict[str, str] | None = None,
    node_expected_version: str = "",
    node_previous_version: str = "",
    node_version_changed: bool = False,
) -> None:
    base = {
        "path": list(path),
        **_inverse_version_fields(expected_version, previous_version),
    }
    if lineage_path is not None and lineage_path != path:
        base["lineage_path"] = list(lineage_path)
    if overlap_expected_versions is not None:
        base["if_overlap_versions"] = overlap_expected_versions
        base["restore_overlap_versions"] = overlap_previous_versions or {}
    if identifier:
        base["id"] = identifier
        if node_version_changed:
            base.update(
                _inverse_version_fields(
                    node_expected_version,
                    node_previous_version,
                    prefix="node",
                )
            )
        else:
            base["preserve_node_version"] = True
    if old_value is MISSING:
        inverse_unsets.append(base)
    else:
        inverse_updates.append({**base, "value": _clone(old_value)})


def _path_mutation_snapshot(
    target: Dict[str, Any], path: Tuple[str, ...]
) -> Tuple[Tuple[str, ...], Any]:
    """Capture the nearest ancestor a nested write may replace."""

    current: Any = target
    for index, part in enumerate(path[:-1]):
        if not isinstance(current, dict) or part not in current:
            return path[: index + 1], MISSING
        child = current[part]
        if not isinstance(child, dict):
            return path[: index + 1], _clone(child)
        current = child
    return path, _path_get(target, path)


def _prune_shadowed_inverse_fields(
    inverse: Dict[str, List[Any]],
) -> None:
    for update_action, unset_action, owner_scope in (
        ("node_updates", "node_unsets", "node"),
        ("canvas_updates", "canvas_unsets", "canvas"),
    ):
        entries = []
        for action in (update_action, unset_action):
            for entry in inverse[action]:
                if not isinstance(entry, dict):
                    continue
                owner = str(entry.get("id") or "") if owner_scope == "node" else ""
                entries.append((action, entry, owner, _path(entry.get("path"))))
        shadowed = set()
        previous_by_owner: Dict[str, Tuple[str, ...]] = {}
        for _action, entry, owner, path in sorted(
            entries,
            key=lambda item: (item[2], item[3]),
        ):
            previous = previous_by_owner.get(owner)
            if (
                previous is not None
                and len(previous) < len(path)
                and path[: len(previous)] == previous
            ):
                shadowed.add(id(entry))
                continue
            previous_by_owner[owner] = path
        for action in (update_action, unset_action):
            inverse[action] = [
                entry for entry in inverse[action] if id(entry) not in shadowed
            ]


def _apply_changes(
    canvas: Dict[str, Any],
    changes: Dict[str, List[Any]],
    *,
    operation_id: str,
    revision: int,
    restore_versions: bool = False,
    validate_structure: bool = True,
) -> Dict[str, List[Any]]:
    changes = _coalesce_path_changes(
        changes,
        allow_internal_overlap=restore_versions,
    )
    state = _state(canvas)
    versions: Dict[str, str] = state["versions"]
    tombstones: Dict[str, Any] = state["tombstones"]
    path_index = _PathVersionIndex(versions)
    inverse = _empty_changes()
    canvas.setdefault("nodes", [])
    canvas.setdefault("connections", [])
    nodes = _node_map(canvas)
    touched_node_path_keys = set()
    transitioned_version_keys: set[str] = set()
    transitioned_owners: set[Tuple[str, str]] = set()
    if restore_versions:
        inverse_field_keys = {key for key, _entry in _field_entries(changes)}
        for key, entry in _field_entries(changes):
            decoded_key = _decode_path_key(key)
            internal_overlap_keys = set()
            if decoded_key is not None:
                internal_overlap_keys = (
                    path_index.overlap_keys(*decoded_key)
                    & inverse_field_keys
                )
            current_scope_versions = (
                _overlap_version_fields(
                    versions,
                    decoded_key[0],
                    decoded_key[1],
                    decoded_key[2],
                    path_index=path_index,
                )
                if decoded_key is not None
                else {}
            )
            raw_expected = entry.get("if_overlap_versions")
            expected_overlap = (
                {
                    str(item): str(value or "")
                    for item, value in raw_expected.items()
                }
                if isinstance(raw_expected, dict)
                else None
            )
            unexpected_descendant_versions = {
                candidate: value
                for candidate, value in current_scope_versions.items()
                if candidate not in internal_overlap_keys
                and (
                    expected_overlap is None
                    or candidate not in expected_overlap
                )
                and decoded_key is not None
                and (
                    candidate_decoded := _decode_path_key(candidate)
                ) is not None
                and len(candidate_decoded[2]) > len(decoded_key[2])
            }
            if unexpected_descendant_versions and any(
                value != entry.get("if_operation")
                for value in unexpected_descendant_versions.values()
            ):
                raise CanvasRealtimeError(
                    "undo_conflict",
                    "该操作之后已有协作修改，无法安全撤销。",
                    revision=revision,
                )
            _version_matches(
                versions,
                key,
                entry.get("if_operation"),
                revision,
                expect_absent=bool(entry.get("if_version_absent")),
            )
            if expected_overlap is not None:
                allowed_shadow_versions = {
                    candidate
                    for candidate, value in unexpected_descendant_versions.items()
                    if value == entry.get("if_operation")
                }
                current_overlap = {
                    item: value
                    for item, value in current_scope_versions.items()
                    if item not in inverse_field_keys
                    and item not in allowed_shadow_versions
                }
                expected_overlap = {
                    item: value
                    for item, value in expected_overlap.items()
                    if item not in inverse_field_keys
                }
                if current_overlap != expected_overlap:
                    raise CanvasRealtimeError(
                        "undo_conflict",
                        "该操作之后已有协作修改，无法安全撤销。",
                        revision=revision,
                    )

    for raw in changes["node_creates"]:
        entry = raw if isinstance(raw, dict) else {}
        wrapped = (
            not entry.get("id") and isinstance(entry.get("node"), dict)
        )
        if wrapped and not restore_versions:
            raise CanvasRealtimeError(
                "invalid_changes",
                "普通 Mutation 不能提交服务端内部恢复元数据。",
                revision=revision,
            )
        lineage = entry if wrapped else {}
        node = entry.get("node") if wrapped else entry
        node = _clone(node) if isinstance(node, dict) else {}
        node_id = str(node.get("id") or "")
        restore_from = str(lineage.get("restore_from") or "")
        if not node_id or len(node_id) > 160:
            raise CanvasRealtimeError(
                "invalid_node",
                "创建的 Node 缺少有效 ID。",
                revision=revision,
            )
        if node_id in nodes:
            raise CanvasRealtimeError(
                "node_exists",
                "Node 已存在。",
                revision=revision,
            )
        tombstone = tombstones.get(node_id)
        if tombstone and str(tombstone.get("operation_id") or "") != restore_from:
            raise CanvasRealtimeError(
                "node_deleted",
                "已删除的 Node 不能被迟到操作重新创建。",
                revision=revision,
            )
        if restore_from and not (
            lineage.get("if_operation") or lineage.get("if_version_absent")
        ):
            _version_matches(
                versions,
                _node_key(node_id, "exist"),
                restore_from,
                revision,
            )
        tombstones.pop(node_id, None)
        previous_exist_version, current_exist_version = _transition_version(
            versions,
            _node_key(node_id, "exist"),
            lineage,
            operation_id=operation_id,
            revision=revision,
            restore_versions=restore_versions,
        )
        previous_node_version, current_node_version = _transition_version(
            versions,
            _node_key(node_id),
            lineage,
            operation_id=operation_id,
            revision=revision,
            restore_versions=restore_versions,
            prefix="node",
        )
        canvas["nodes"].append(node)
        nodes[node_id] = node
        inverse["node_deletes"].append(
            {
                "id": node_id,
                **_inverse_version_fields(
                    current_node_version,
                    previous_node_version,
                ),
                **_inverse_version_fields(
                    current_exist_version,
                    previous_exist_version,
                    prefix="exist",
                ),
            }
        )

    for raw in changes["node_updates"]:
        entry = raw if isinstance(raw, dict) else {}
        node_id = str(entry.get("id") or "")
        path = _path(entry.get("path"))
        lineage_path = _path(entry.get("lineage_path")) if entry.get(
            "lineage_path"
        ) else path
        if path[0] == "id":
            raise CanvasRealtimeError(
                "invalid_path",
                "Node ID 不可修改。",
                revision=revision,
            )
        node = nodes.get(node_id)
        if not node:
            raise CanvasRealtimeError(
                "node_deleted",
                "目标 Node 已删除，Mutation 被拒绝。",
                revision=revision,
            )
        inverse_path, old_value = _path_mutation_snapshot(node, path)
        effective_lineage_path = (
            path
            if restore_versions and entry.get("lineage_path")
            else inverse_path
        )
        key = _path_key("node", node_id, effective_lineage_path)
        previous_overlap_versions, current_overlap_versions = (
            _transition_overlap_versions(
                versions,
                "node",
                node_id,
                effective_lineage_path,
                entry,
                operation_id=operation_id,
                revision=revision,
                restore_versions=restore_versions,
                transitioned_version_keys=transitioned_version_keys,
                transitioned_owners=transitioned_owners,
                preflight_complete=restore_versions,
                path_index=path_index,
            )
        )
        previous_version, current_version = _transition_version(
            versions,
            key,
            entry,
            operation_id=operation_id,
            revision=revision,
            restore_versions=restore_versions,
            skip_guard=restore_versions,
            path_index=path_index,
        )
        touched_node_path_keys.add(key)
        transitioned_version_keys.add(key)
        transitioned_owners.add(("node", node_id))
        (
            previous_node_version,
            current_node_version,
            node_version_changed,
        ) = _transition_node_aggregate(
            versions,
            node_id,
            entry,
            operation_id=operation_id,
            revision=revision,
            restore_versions=restore_versions,
        )
        _path_set(node, path, entry.get("value"))
        _record_inverse_set(
            inverse["node_updates"],
            inverse["node_unsets"],
            identifier=node_id,
            path=inverse_path,
            lineage_path=effective_lineage_path,
            old_value=old_value,
            expected_version=current_version,
            previous_version=previous_version,
            overlap_expected_versions=current_overlap_versions,
            overlap_previous_versions=previous_overlap_versions,
            node_expected_version=current_node_version,
            node_previous_version=previous_node_version,
            node_version_changed=node_version_changed,
        )

    for raw in changes["node_unsets"]:
        entry = raw if isinstance(raw, dict) else {}
        node_id = str(entry.get("id") or "")
        path = _path(entry.get("path"))
        lineage_path = _path(entry.get("lineage_path")) if entry.get(
            "lineage_path"
        ) else path
        if path[0] == "id":
            raise CanvasRealtimeError(
                "invalid_path",
                "Node ID 不可修改。",
                revision=revision,
            )
        node = nodes.get(node_id)
        if not node:
            raise CanvasRealtimeError(
                "node_deleted",
                "目标 Node 已删除，Mutation 被拒绝。",
                revision=revision,
            )
        key = _path_key("node", node_id, lineage_path)
        previous_overlap_versions, current_overlap_versions = (
            _transition_overlap_versions(
                versions,
                "node",
                node_id,
                lineage_path,
                entry,
                operation_id=operation_id,
                revision=revision,
                restore_versions=restore_versions,
                transitioned_version_keys=transitioned_version_keys,
                transitioned_owners=transitioned_owners,
                preflight_complete=restore_versions,
                path_index=path_index,
            )
        )
        previous_version, current_version = _transition_version(
            versions,
            key,
            entry,
            operation_id=operation_id,
            revision=revision,
            restore_versions=restore_versions,
            skip_guard=restore_versions,
            path_index=path_index,
        )
        touched_node_path_keys.add(key)
        transitioned_version_keys.add(key)
        transitioned_owners.add(("node", node_id))
        (
            previous_node_version,
            current_node_version,
            node_version_changed,
        ) = _transition_node_aggregate(
            versions,
            node_id,
            entry,
            operation_id=operation_id,
            revision=revision,
            restore_versions=restore_versions,
        )
        old_value = _path_get(node, path)
        _path_unset(node, path)
        _record_inverse_set(
            inverse["node_updates"],
            inverse["node_unsets"],
            identifier=node_id,
            path=path,
            lineage_path=lineage_path,
            old_value=old_value,
            expected_version=current_version,
            previous_version=previous_version,
            overlap_expected_versions=current_overlap_versions,
            overlap_previous_versions=previous_overlap_versions,
            node_expected_version=current_node_version,
            node_previous_version=previous_node_version,
            node_version_changed=node_version_changed,
        )

    for raw in changes["connection_removes"]:
        entry = raw if isinstance(raw, dict) else {}
        key = _connection_key(entry)
        index, connection = _find_connection(canvas["connections"], key)
        guarded = any(
            name in entry
            for name in ("if_operation", "if_version_absent", "restore_version")
        )
        if index < 0 and not guarded:
            continue
        previous_version, current_version = _transition_version(
            versions,
            f"connection:{key}",
            entry,
            operation_id=operation_id,
            revision=revision,
            restore_versions=restore_versions,
        )
        removed_connection = connection or entry.get("connection")
        if not isinstance(removed_connection, dict):
            raise CanvasRealtimeError(
                "undo_conflict",
                "该操作之后已有协作修改，无法安全撤销。",
                revision=revision,
            )
        inverse["connection_adds"].append(
            {
                "connection": _clone(removed_connection),
                **_inverse_version_fields(
                    current_version,
                    previous_version,
                ),
            }
        )
        if index >= 0:
            canvas["connections"].pop(index)

    delete_entries: List[Dict[str, Any]] = []
    seen_delete_ids = set()
    for raw in changes["node_deletes"]:
        if isinstance(raw, str):
            entry = {"id": raw}
        elif isinstance(raw, dict):
            entry = raw
        else:
            raise CanvasRealtimeError(
                "invalid_node",
                "删除的 Node ID 无效。",
                revision=revision,
            )
        node_id = str(entry.get("id") or "")
        if node_id and node_id not in seen_delete_ids:
            seen_delete_ids.add(node_id)
            delete_entries.append(entry)

    requested_delete_ids = {
        str(entry.get("id") or "") for entry in delete_entries
    }
    guarded_delete_ids = {
        str(entry.get("id") or "")
        for entry in delete_entries
        if any(
            name in entry
            for name in (
                "if_operation",
                "if_version_absent",
                "restore_version",
                "if_exist_operation",
                "if_exist_version_absent",
                "restore_exist_version",
            )
        )
    }
    for node_id in guarded_delete_ids:
        if node_id not in nodes:
            raise CanvasRealtimeError(
                "undo_conflict",
                "该操作之后已有协作修改，无法安全撤销。",
                revision=revision,
            )
        unexpected_connection = any(
            (
                str(connection.get("from") or "") == node_id
                or str(connection.get("to") or "") == node_id
            )
            for connection in canvas["connections"]
        )
        unexpected_reference = any(
            owner_id not in requested_delete_ids
            and (
                (
                    isinstance(owner.get("items"), list)
                    and node_id in {
                        str(item) for item in owner["items"]
                    }
                )
                or str(owner.get("frameId") or "") == node_id
                or str(owner.get("historyFor") or "") == node_id
                or (
                    isinstance(owner.get("inputNodeIds"), list)
                    and node_id in {
                        str(item) for item in owner["inputNodeIds"]
                    }
                )
            )
            for owner_id, owner in nodes.items()
        )
        if unexpected_connection or unexpected_reference:
            raise CanvasRealtimeError(
                "undo_conflict",
                "该操作之后已有协作修改，无法安全撤销。",
                revision=revision,
            )

    delete_ids = {
        node_id for node_id in requested_delete_ids if node_id in nodes
    }
    for entry in delete_entries:
        node_id = str(entry.get("id") or "")
        node = nodes.get(node_id)
        if not node:
            continue
        previous_node_version, current_node_version = _transition_version(
            versions,
            _node_key(node_id),
            entry,
            operation_id=operation_id,
            revision=revision,
            restore_versions=restore_versions,
        )
        previous_exist_version, current_exist_version = _transition_version(
            versions,
            _node_key(node_id, "exist"),
            entry,
            operation_id=operation_id,
            revision=revision,
            restore_versions=restore_versions,
            prefix="exist",
        )
        inverse["node_creates"].append(
            {
                "node": _clone(node),
                "restore_from": operation_id,
                **_inverse_version_fields(
                    current_exist_version,
                    previous_exist_version,
                ),
                **_inverse_version_fields(
                    current_node_version,
                    previous_node_version,
                    prefix="node",
                ),
            }
        )

    removed_connections = [
        _clone(connection)
        for connection in canvas["connections"]
        if (
            str(connection.get("from") or "") in delete_ids
            or str(connection.get("to") or "") in delete_ids
        )
    ]
    canvas["connections"] = [
        connection
        for connection in canvas["connections"]
        if (
            str(connection.get("from") or "") not in delete_ids
            and str(connection.get("to") or "") not in delete_ids
        )
    ]
    for connection in removed_connections:
        connection_key = _connection_key(connection)
        previous_version, current_version = _transition_version(
            versions,
            f"connection:{connection_key}",
            {},
            operation_id=operation_id,
            revision=revision,
            restore_versions=restore_versions,
        )
        inverse["connection_adds"].append(
            {
                "connection": _clone(connection),
                **_inverse_version_fields(current_version, previous_version),
            }
        )

    for owner_id, owner in list(nodes.items()):
        if owner_id in delete_ids:
            continue
        for field in ("inputNodeIds", "items"):
            references = owner.get(field)
            if not (
                isinstance(references, list)
                and any(str(item) in delete_ids for item in references)
            ):
                continue
            path = (field,)
            key = _path_key("node", owner_id, path)
            old_references = _clone(references)
            owner[field] = [
                item for item in references if str(item) not in delete_ids
            ]
            if key in touched_node_path_keys:
                continue
            previous_overlap_versions, current_overlap_versions = (
                _transition_overlap_versions(
                    versions,
                    "node",
                    owner_id,
                    path,
                    {},
                    operation_id=operation_id,
                    revision=revision,
                    restore_versions=restore_versions,
                    transitioned_version_keys=transitioned_version_keys,
                    transitioned_owners=transitioned_owners,
                    preflight_complete=restore_versions,
                    path_index=path_index,
                )
            )
            previous_version, current_version = _transition_version(
                versions,
                key,
                {},
                operation_id=operation_id,
                revision=revision,
                restore_versions=restore_versions,
                path_index=path_index,
            )
            touched_node_path_keys.add(key)
            transitioned_version_keys.add(key)
            transitioned_owners.add(("node", owner_id))
            (
                previous_node_version,
                current_node_version,
                node_version_changed,
            ) = _transition_node_aggregate(
                versions,
                owner_id,
                {},
                operation_id=operation_id,
                revision=revision,
                restore_versions=restore_versions,
            )
            _record_inverse_set(
                inverse["node_updates"],
                inverse["node_unsets"],
                identifier=owner_id,
                path=path,
                old_value=old_references,
                expected_version=current_version,
                previous_version=previous_version,
                overlap_expected_versions=current_overlap_versions,
                overlap_previous_versions=previous_overlap_versions,
                node_expected_version=current_node_version,
                node_previous_version=previous_node_version,
                node_version_changed=node_version_changed,
            )
        if str(owner.get("frameId") or "") in delete_ids:
            path = ("frameId",)
            key = _path_key("node", owner_id, path)
            old_frame = owner.get("frameId")
            owner.pop("frameId", None)
            if key in touched_node_path_keys:
                continue
            previous_overlap_versions, current_overlap_versions = (
                _transition_overlap_versions(
                    versions,
                    "node",
                    owner_id,
                    path,
                    {},
                    operation_id=operation_id,
                    revision=revision,
                    restore_versions=restore_versions,
                    transitioned_version_keys=transitioned_version_keys,
                    transitioned_owners=transitioned_owners,
                    preflight_complete=restore_versions,
                    path_index=path_index,
                )
            )
            previous_version, current_version = _transition_version(
                versions,
                key,
                {},
                operation_id=operation_id,
                revision=revision,
                restore_versions=restore_versions,
                path_index=path_index,
            )
            touched_node_path_keys.add(key)
            transitioned_version_keys.add(key)
            transitioned_owners.add(("node", owner_id))
            (
                previous_node_version,
                current_node_version,
                node_version_changed,
            ) = _transition_node_aggregate(
                versions,
                owner_id,
                {},
                operation_id=operation_id,
                revision=revision,
                restore_versions=restore_versions,
            )
            _record_inverse_set(
                inverse["node_updates"],
                inverse["node_unsets"],
                identifier=owner_id,
                path=path,
                old_value=old_frame,
                expected_version=current_version,
                previous_version=previous_version,
                overlap_expected_versions=current_overlap_versions,
                overlap_previous_versions=previous_overlap_versions,
                node_expected_version=current_node_version,
                node_previous_version=previous_node_version,
                node_version_changed=node_version_changed,
            )

    if delete_ids:
        canvas["nodes"] = [
            candidate
            for candidate in canvas["nodes"]
            if str(candidate.get("id") or "") not in delete_ids
        ]
        for node_id in delete_ids:
            if node_id in nodes:
                nodes.pop(node_id, None)
                tombstones[node_id] = {"operation_id": operation_id}

    for raw in changes["connection_adds"]:
        entry = raw if isinstance(raw, dict) else {}
        wrapped = (
            not entry.get("from")
            and not entry.get("to")
            and isinstance(entry.get("connection"), dict)
        )
        if wrapped and not restore_versions:
            raise CanvasRealtimeError(
                "invalid_changes",
                "普通 Mutation 不能提交服务端内部恢复元数据。",
                revision=revision,
            )
        lineage = entry if wrapped else {}
        connection_value = entry.get("connection") if wrapped else entry
        connection = _clone(connection_value)
        source = str(connection.get("from") or "")
        target = str(connection.get("to") or "")
        key = _connection_key(connection)
        if (
            not source
            or not target
            or source == target
            or source not in nodes
            or target not in nodes
        ):
            raise CanvasRealtimeError(
                "invalid_connection",
                "Connection 不能自环或指向不存在的 Node。",
                revision=revision,
            )
        index, _ = _find_connection(canvas["connections"], key)
        if index >= 0:
            if restore_versions or any(
                name in lineage
                for name in ("if_operation", "if_version_absent", "restore_version")
            ):
                raise CanvasRealtimeError(
                    "undo_conflict",
                    "该操作之后已有协作修改，无法安全撤销。",
                    revision=revision,
                )
            continue
        previous_version, current_version = _transition_version(
            versions,
            f"connection:{key}",
            lineage,
            operation_id=operation_id,
            revision=revision,
            restore_versions=restore_versions,
        )
        canvas["connections"].append(connection)
        inverse["connection_removes"].append(
            {
                "from": source,
                "to": target,
                "kind": connection.get("kind") or "flow",
                "connection": _clone(connection),
                **_inverse_version_fields(
                    current_version,
                    previous_version,
                ),
            }
        )

    allowed_canvas_roots = {"title", "icon", "settings", "logs"}
    for action, inverse_action, unset_inverse in (
        ("canvas_updates", "canvas_updates", "canvas_unsets"),
        ("canvas_unsets", "canvas_updates", "canvas_unsets"),
    ):
        for raw in changes[action]:
            entry = raw if isinstance(raw, dict) else {}
            path = _path(entry.get("path"))
            lineage_path = _path(entry.get("lineage_path")) if entry.get(
                "lineage_path"
            ) else path
            if path[0] not in allowed_canvas_roots:
                raise CanvasRealtimeError(
                    "invalid_path",
                    "该 Canvas 字段不属于共享实时文档。",
                    revision=revision,
                )
            if action == "canvas_updates":
                inverse_path, old_value = _path_mutation_snapshot(canvas, path)
            else:
                inverse_path, old_value = path, _path_get(canvas, path)
            effective_lineage_path = (
                path
                if restore_versions and entry.get("lineage_path")
                else inverse_path
            )
            key = _path_key("canvas", "", effective_lineage_path)
            previous_overlap_versions, current_overlap_versions = (
                _transition_overlap_versions(
                    versions,
                    "canvas",
                    "",
                    effective_lineage_path,
                    entry,
                    operation_id=operation_id,
                    revision=revision,
                    restore_versions=restore_versions,
                    transitioned_version_keys=transitioned_version_keys,
                    transitioned_owners=transitioned_owners,
                    preflight_complete=restore_versions,
                    path_index=path_index,
                )
            )
            previous_version, current_version = _transition_version(
                versions,
                key,
                entry,
                operation_id=operation_id,
                revision=revision,
                restore_versions=restore_versions,
                skip_guard=restore_versions,
                path_index=path_index,
            )
            transitioned_version_keys.add(key)
            transitioned_owners.add(("canvas", ""))
            if action == "canvas_updates":
                _path_set(canvas, path, entry.get("value"))
            else:
                _path_unset(canvas, path)
            _record_inverse_set(
                inverse[inverse_action],
                inverse[unset_inverse],
                path=inverse_path,
                lineage_path=effective_lineage_path,
                old_value=old_value,
                expected_version=current_version,
                previous_version=previous_version,
                overlap_expected_versions=current_overlap_versions,
                overlap_previous_versions=previous_overlap_versions,
            )

    if validate_structure:
        _validate_groups(canvas, revision)
        _validate_connections(canvas, revision)
    _prune_shadowed_inverse_fields(inverse)
    return inverse


def _trim_mapping(mapping: Dict[str, Any], limit: int) -> None:
    while len(mapping) > limit:
        mapping.pop(next(iter(mapping)))


def _trim_history(history: List[Dict[str, Any]]) -> None:
    if len(history) > REALTIME_HISTORY_LIMIT:
        del history[: len(history) - REALTIME_HISTORY_LIMIT]


def apply_operation(
    canvas: Dict[str, Any],
    operation: Dict[str, Any],
    actor_id: str,
    *,
    _validate_structure: bool = True,
) -> CanvasMutationResult:
    """Apply one mutation to ``canvas`` in server order.

    The caller must serialize calls for a canvas and persist the mutated
    dictionary only after this function succeeds.
    """

    if not isinstance(operation, dict):
        raise CanvasRealtimeError("invalid_operation", "Mutation 必须是对象。")
    operation_id = _operation_id(operation)
    actor_id = str(actor_id or "").strip()
    if not actor_id:
        raise CanvasRealtimeError("unauthorized", "缺少操作用户。")
    working = _clone(canvas)
    state = _state(working)
    revision = int(working.get("revision") or 0)
    base_revision = int(operation.get("base_revision") or 0)
    if base_revision > revision:
        raise CanvasRealtimeError(
            "revision_ahead",
            "客户端 Revision 超前，必须重新同步。",
            revision=revision,
        )
    receipt = state["receipts"].get(operation_id)
    if receipt:
        if str(receipt.get("actor_id") or "") != actor_id:
            raise CanvasRealtimeError(
                "operation_collision",
                "operation_id 已被其他用户使用。",
                revision=revision,
            )
        reverts_operation_id = str(
            operation.get("reverts_operation_id") or ""
        ).strip()
        requested_hash = _stable_hash(
            {
                "reverts_operation_id": reverts_operation_id,
                **(
                    {"placement_overrides": operation.get("placement_overrides")}
                    if operation.get("placement_overrides")
                    else {}
                ),
            }
            if reverts_operation_id
            else {"changes": normalize_changes(operation.get("changes"))}
        )
        if receipt.get("hash") and receipt.get("hash") != requested_hash:
            raise CanvasRealtimeError(
                "operation_collision",
                "相同 operation_id 的 Mutation 内容不一致。",
                revision=revision,
            )
        return CanvasMutationResult(
            operation_id=operation_id,
            revision=int(receipt.get("revision") or revision),
            actor_id=actor_id,
            changes=_empty_changes(),
            duplicate=True,
            reverts_operation_id=str(
                receipt.get("reverts_operation_id") or ""
            ),
            undoable=bool(receipt.get("undoable", True)),
            non_undoable_canvas_roots=("logs",),
        )
    seen_bloom = _seen_bloom_bytes(state)
    if _seen_bloom_contains(state, operation_id, seen_bloom):
        return CanvasMutationResult(
            operation_id=operation_id,
            revision=revision,
            actor_id=actor_id,
            changes=_empty_changes(),
            duplicate=True,
            undoable=False,
            non_undoable_canvas_roots=("logs",),
        )

    _migrate_field_lineage(state)
    _refresh_node_aggregate_versions(state)

    reverts_operation_id = str(
        operation.get("reverts_operation_id") or ""
    ).strip()
    source_record = None
    if reverts_operation_id:
        source_record = next(
            (
                record
                for record in reversed(state["history"])
                if record.get("operation_id") == reverts_operation_id
            ),
            None,
        )
        if not source_record:
            raise CanvasRealtimeError(
                "undo_not_found",
                "待撤销操作已不在安全历史范围内。",
                revision=revision,
            )
        if source_record.get("actor_id") != actor_id:
            raise CanvasRealtimeError(
                "undo_forbidden",
                "只能撤销当前用户自己的操作。",
                revision=revision,
            )
        if source_record.get("undone_by"):
            raise CanvasRealtimeError(
                "undo_conflict",
                "该操作已经撤销。",
                revision=revision,
            )
        changes = normalize_changes(source_record.get("inverse"))
        _apply_restore_placement_overrides(
            changes,
            operation.get("placement_overrides"),
            revision,
        )
        competitor_ids = _placement_competitor_ids(
            working,
            state["history"],
            int(source_record.get("revision") or 0),
            revision,
        )
        if changes["node_creates"] and _created_nodes_collide(
            working,
            changes,
            competitor_ids,
        ):
            raise CanvasRealtimeError(
                "placement_conflict",
                "恢复位置已被更早确认的 Node 占用；请基于最新 Revision 重新放置。",
                revision=revision,
                retry_changes=_public_changes(changes),
            )
    else:
        changes = normalize_changes(operation.get("changes"))
        if _normal_changes_have_internal_metadata(changes):
            raise CanvasRealtimeError(
                "invalid_changes",
                "普通 Mutation 不能提交服务端内部恢复元数据。",
                revision=revision,
            )
        if base_revision < revision and changes["node_creates"]:
            competitor_ids = _placement_competitor_ids(
                working,
                state["history"],
                base_revision,
                revision,
            )
            if _created_nodes_collide(working, changes, competitor_ids):
                raise CanvasRealtimeError(
                    "placement_conflict",
                    "目标位置已被较新确认的 Node 占用；请基于最新 Revision 重新放置新 Node。",
                    revision=revision,
                )

    inverse = _apply_changes(
        working,
        changes,
        operation_id=operation_id,
        revision=revision,
        restore_versions=bool(reverts_operation_id),
        validate_structure=_validate_structure,
    )
    if _public_state_equal(canvas, working):
        return CanvasMutationResult(
            operation_id=operation_id,
            revision=revision,
            actor_id=actor_id,
            changes=_empty_changes(),
            duplicate=False,
            reverts_operation_id=reverts_operation_id,
            undoable=False,
            non_undoable_canvas_roots=("logs",),
        )
    next_revision = revision + 1
    working["revision"] = next_revision
    working_state = _state(working)
    for tombstone in working_state["tombstones"].values():
        if tombstone.get("operation_id") == operation_id:
            tombstone["revision"] = next_revision
    undoable_changes = _without_canvas_root(changes, "logs")
    undoable_inverse = _without_canvas_root(inverse, "logs")
    undoable = any(undoable_changes.values())
    record = {
        "operation_id": operation_id,
        "actor_id": actor_id,
        "revision": next_revision,
        "base_revision": base_revision,
        "changes": undoable_changes,
        "inverse": undoable_inverse,
        "reverts_operation_id": reverts_operation_id,
        "hash": _stable_hash(changes),
    }
    if undoable:
        working_state["history"].append(record)
    working_state["lineage_schema"] = 2
    _trim_history(working_state["history"])
    if source_record:
        working_source = next(
            (
                item
                for item in reversed(working_state["history"])
                if item.get("operation_id") == reverts_operation_id
            ),
            None,
        )
        if working_source:
            working_source["undone_by"] = operation_id
    _refresh_node_aggregate_versions(working_state)
    receipt = {
        "actor_id": actor_id,
        "revision": next_revision,
        "reverts_operation_id": reverts_operation_id,
        "undoable": undoable,
        "hash": _stable_hash(
            {
                "reverts_operation_id": reverts_operation_id,
                **(
                    {"placement_overrides": operation.get("placement_overrides")}
                    if operation.get("placement_overrides")
                    else {}
                ),
            }
            if reverts_operation_id
            else {"changes": changes}
        ),
    }
    working_state["receipts"][operation_id] = receipt
    _seen_bloom_add(working_state, operation_id, seen_bloom)
    _trim_mapping(working_state["receipts"], REALTIME_RECEIPT_LIMIT)
    canvas.clear()
    canvas.update(working)
    return CanvasMutationResult(
        operation_id=operation_id,
        revision=next_revision,
        actor_id=actor_id,
        changes=_public_changes(undoable_changes),
        duplicate=False,
        reverts_operation_id=reverts_operation_id,
        undoable=undoable,
        non_undoable_canvas_roots=("logs",),
    )


def apply_single_node_position_operation(
    canvas_id: str,
    node: Dict[str, Any] | None,
    realtime_state: Dict[str, Any],
    revision: int,
    operation: Dict[str, Any],
    actor_id: str,
) -> Tuple[Dict[str, Any], CanvasMutationResult]:
    """Apply a pre-qualified x/y Mutation without materializing the full graph.

    Canvas Store owns the strict qualification step. This adapter deliberately
    reuses the complete operation engine for revision, field lineage, inverse,
    history, receipt-Bloom, and error semantics while omitting Group and
    Connection graph validation that an x/y-only change cannot affect.
    """

    canvas = {
        "id": str(canvas_id or ""),
        "revision": max(0, int(revision or 0)),
        # Store just decoded these transaction-local values. ``apply_operation``
        # owns the single defensive clone before mutating them.
        "nodes": [node] if isinstance(node, dict) else [],
        "connections": [],
        REALTIME_META_KEY: realtime_state,
    }
    result = apply_operation(
        canvas,
        operation,
        actor_id,
        _validate_structure=False,
    )
    return canvas, result
