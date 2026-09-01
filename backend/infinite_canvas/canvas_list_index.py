"""Rebuildable lightweight index for canvas-list queries.

Smart-canvas documents remain authoritative.  This index only stores fields needed
by the workspace list and reparses a document when its file signature changes.
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import Any, Callable, Dict, List, Optional

from .canvas_permissions import can_access_canvas


INDEX_VERSION = 1
INDEX_PARSE_BUDGET = 50
INDEX_PROJECT_PARSE_BUDGET = 500
DEFAULT_PROJECT_ID = "default"
IMAGE_EXTENSIONS = {".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"}


@dataclass(frozen=True)
class CanvasListPage:
    records: List[Dict[str, Any]]
    next_cursor: str
    total: int
    rebuilding: bool = False
    index_error: bool = False


def _asset_url(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ("url", "path", "src", "uri", "output", "output_url", "outputUrl"):
            text = str(value.get(key) or "").strip()
            if text:
                return text
    return ""


def _is_image(value: Any, url: str) -> bool:
    if isinstance(value, dict) and str(value.get("kind") or "").lower() == "image":
        return True
    clean = url.split("?", 1)[0].split("#", 1)[0].lower()
    return Path(clean).suffix in IMAGE_EXTENSIONS


def _cover_record(document: Dict[str, Any]) -> Dict[str, Any]:
    explicit = document.get("cover_image")
    if isinstance(explicit, dict):
        url = _asset_url(explicit)
        if url:
            try:
                image_index = max(0, int(explicit.get("image_index") or 0))
            except (TypeError, ValueError):
                image_index = 0
            return {
                "cover_url": url,
                "cover_custom": True,
                "cover_node_id": str(explicit.get("node_id") or ""),
                "cover_image_index": image_index,
            }

    nodes = document.get("nodes") if isinstance(document.get("nodes"), list) else []
    for node_index, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        images = node.get("images") if isinstance(node.get("images"), list) else []
        for image_index, value in enumerate(images):
            url = _asset_url(value)
            if url and _is_image(value, url):
                return {
                    "cover_url": url,
                    "cover_custom": False,
                    "cover_node_id": str(node.get("id") or f"node_{node_index}"),
                    "cover_image_index": image_index,
                }
    return {
        "cover_url": "",
        "cover_custom": False,
        "cover_node_id": "",
        "cover_image_index": 0,
    }


def _summary(document: Dict[str, Any]) -> Dict[str, Any]:
    nodes = document.get("nodes") if isinstance(document.get("nodes"), list) else []
    record = {
        "id": str(document.get("id") or ""),
        "title": str(document.get("title") or "未命名画布"),
        "icon": str(document.get("icon") or "🧩"),
        "kind": "smart" if document.get("kind") == "smart" else "classic",
        "owner_id": str(document.get("owner_id") or ""),
        "owner_username": str(document.get("owner_username") or ""),
        "visibility": document.get("visibility") if document.get("visibility") in {"shared", "private"} else "shared",
        "created_by": str(document.get("created_by") or ""),
        "updated_by": str(document.get("updated_by") or ""),
        "owner": str(document.get("owner") or "")[:40],
        "color": str(document.get("color") or "")[:32],
        "pinned": bool(document.get("pinned") or False),
        "project": str(document.get("project") or "").strip() or DEFAULT_PROJECT_ID,
        "board_x": document.get("board_x"),
        "board_y": document.get("board_y"),
        "created_at": document.get("created_at", 0),
        "updated_at": document.get("updated_at", 0),
        "revision": max(0, int(document.get("revision") or 0)),
        "deleted_at": document.get("deleted_at", 0),
        "node_count": len(nodes),
    }
    record.update(_cover_record(document))
    return record


class CanvasListIndex:
    """Incremental derived index over the current workspace canvas directory."""

    def __init__(
        self,
        directory: Callable[[], Path],
        *,
        index_file: Callable[[], Path],
        document_loader: Optional[Callable[[Path], Dict[str, Any]]] = None,
        record_loader: Optional[
            Callable[
                [Optional[Dict[str, Any]]],
                Optional[List[Dict[str, Any]]],
            ]
        ] = None,
        record_builder: Callable[[Dict[str, Any]], Dict[str, Any]] = _summary,
    ):
        self._directory = directory
        self._index_file = index_file
        self._document_loader = document_loader
        self._record_loader = record_loader
        self._record_builder = record_builder
        self.document_parse_count = 0
        self._lock = RLock()

    @property
    def index_path(self) -> Path:
        return Path(self._index_file())

    def _load(self) -> tuple[Dict[str, Any], bool]:
        try:
            value = json.loads(self.index_path.read_text(encoding="utf-8"))
            if value.get("version") != INDEX_VERSION or not isinstance(value.get("entries"), dict):
                raise ValueError("unsupported index")
            return value, True
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return {
                "version": INDEX_VERSION,
                "entries": {},
                "failures": {},
                "complete": False,
            }, False

    @staticmethod
    def _project_route(path: Path) -> Optional[str]:
        """Stream the authoritative top-level project field without loading nodes.

        The scanner tracks JSON nesting, strings, and escapes, so nested
        ``project`` keys cannot affect routing. It returns ``None`` only when the
        document cannot establish a top-level object route; full parsing remains
        authoritative for every record and permission field.
        """

        depth = 0
        in_string = False
        escaped = False
        token: List[str] = []
        capture = ""
        expecting_key = False
        last_key = ""
        expecting_project_value = False
        try:
            with path.open("r", encoding="utf-8") as handle:
                while chunk := handle.read(16 * 1024):
                    for character in chunk:
                        if in_string:
                            if escaped:
                                if capture:
                                    token.append("\\")
                                    token.append(character)
                                escaped = False
                                continue
                            if character == "\\":
                                escaped = True
                                continue
                            if character != '"':
                                if capture:
                                    token.append(character)
                                continue
                            in_string = False
                            if capture:
                                try:
                                    value = json.loads('"' + "".join(token) + '"')
                                except (ValueError, TypeError, json.JSONDecodeError):
                                    return None
                                if capture == "key":
                                    last_key = str(value)
                                    expecting_key = False
                                else:
                                    return str(value or DEFAULT_PROJECT_ID)
                            capture = ""
                            token = []
                            continue
                        if character == '"':
                            in_string = True
                            token = []
                            if depth == 1 and expecting_key:
                                capture = "key"
                            elif depth == 1 and expecting_project_value:
                                capture = "project"
                                expecting_project_value = False
                            else:
                                capture = ""
                            continue
                        if character == "{":
                            depth += 1
                            if depth == 1:
                                expecting_key = True
                            continue
                        if character == "[":
                            depth += 1
                            continue
                        if character in "}]":
                            depth -= 1
                            if depth == 0:
                                return DEFAULT_PROJECT_ID
                            continue
                        if depth == 1 and character == ":":
                            expecting_project_value = last_key == "project"
                            continue
                        if depth == 1 and character == ",":
                            expecting_key = True
                            last_key = ""
                            expecting_project_value = False
        except (OSError, UnicodeError):
            return None
        return None

    def _save(self, value: Dict[str, Any]) -> None:
        path = self.index_path
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_name, path)
        finally:
            if os.path.exists(temporary_name):
                os.unlink(temporary_name)

    def _sync(
        self,
        *,
        parse_budget: int = INDEX_PARSE_BUDGET,
        project: str = "",
        target_count: int = 0,
    ) -> Dict[str, Any]:
        directory = Path(self._directory())
        directory.mkdir(parents=True, exist_ok=True)
        state, index_valid = self._load()
        old_entries = state["entries"]
        old_failures = state.get("failures") if isinstance(state.get("failures"), dict) else {}
        paths = {path.stem: path for path in sorted(directory.glob("*.json"))}
        entries: Dict[str, Any] = {}
        failures: Dict[str, Any] = {}
        candidates: List[tuple[Path, List[int], Optional[str]]] = []
        changed = not index_valid
        for stem, path in paths.items():
            try:
                stat = path.stat()
            except OSError:
                continue
            signature = [stat.st_mtime_ns, stat.st_size]
            cached = old_entries.get(stem)
            if isinstance(cached, dict) and cached.get("signature") == signature and isinstance(cached.get("record"), dict):
                entries[stem] = cached
                continue
            cached_failure = old_failures.get(stem)
            if isinstance(cached_failure, dict) and cached_failure.get("signature") == signature:
                failures[stem] = cached_failure
                continue
            # Changed documents are withheld until reparsed.  In particular, an
            # old shared/private value must never remain authorization input.
            candidates.append((path, signature, self._project_route(path)))
        if project:
            candidates.sort(key=lambda item: (item[2] != project, str(item[0])))
        budget = max(1, int(parse_budget or INDEX_PARSE_BUDGET))
        current_project_count = sum(
            1
            for entry in entries.values()
            if entry.get("record", {}).get("project") == project
        ) if project else 0
        if project:
            selected_candidates = [
                candidate for candidate in candidates if candidate[2] == project
            ][:budget]
            if not selected_candidates and current_project_count < target_count:
                selected_candidates = [
                    candidate for candidate in candidates if candidate[2] is None
                ][:budget]
        else:
            selected_candidates = candidates[:budget]
        processed_paths = set()
        for path, signature, _route in selected_candidates:
            processed_paths.add(path)
            try:
                document = self._document_loader(path) if self._document_loader else json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(document, dict):
                    raise ValueError("canvas document must be an object")
                # A loader may perform an authorized legacy migration and
                # atomically rewrite the source document.
                stat = path.stat()
                signature = [stat.st_mtime_ns, stat.st_size]
                record = self._record_builder(document)
                canvas_id = record.get("id") or path.stem
                record["id"] = canvas_id
                entries[canvas_id] = {"signature": signature, "record": record}
                if canvas_id != path.stem:
                    entries.pop(path.stem, None)
                self.document_parse_count += 1
                if project and record.get("project") == project:
                    current_project_count += 1
                changed = True
            except Exception:
                entries.pop(path.stem, None)
                failures[path.stem] = {"signature": signature}
                changed = True
        remaining = [
            candidate for candidate in candidates if candidate[0] not in processed_paths
        ]
        query_rebuilding = (
            any(hint == project for _path, _signature, hint in remaining)
            or (
                current_project_count < target_count
                and any(hint is None for _path, _signature, hint in remaining)
            )
        ) if project else bool(remaining)
        complete = not remaining and not failures
        if set(entries) != set(old_entries):
            changed = True
        if bool(state.get("complete")) != complete:
            changed = True
        if failures != old_failures:
            changed = True
        if changed or not self.index_path.exists():
            state = {
                "version": INDEX_VERSION,
                "entries": entries,
                "failures": failures,
                "complete": complete,
            }
            self._save(state)
        result = dict(state)
        # Cached parse failures are a separate terminal signal. They must not
        # suppress cursors for healthy records or cause clients to retry forever.
        result["_query_rebuilding"] = query_rebuilding
        return result

    def list_records(
        self,
        actor: Optional[Dict[str, Any]],
        *,
        project: str = "",
        deleted: bool = False,
        cursor: str = "",
        limit: int = 0,
        parse_budget: Optional[int] = None,
    ) -> CanvasListPage:
        effective_budget = (
            int(parse_budget)
            if parse_budget is not None
            else INDEX_PROJECT_PARSE_BUDGET if project and limit > 0 else 1_000_000_000
        )
        if self._record_loader is not None:
            loaded = self._record_loader(actor)
        else:
            loaded = None
        if loaded is not None:
            state = {
                "entries": {
                    f"{index}:{record.get('id', '')}": {"record": dict(record)}
                    for index, record in enumerate(loaded)
                    if isinstance(record, dict)
                },
                "failures": {},
                "_query_rebuilding": False,
            }
        else:
            with self._lock:
                state = self._sync(
                    parse_budget=effective_budget,
                    project=project,
                    target_count=max(0, int(cursor or 0) if str(cursor or "").isdigit() else 0)
                    + max(0, int(limit or 0)),
                )
        records = []
        for entry in state["entries"].values():
            record = entry.get("record") if isinstance(entry, dict) else None
            if not isinstance(record, dict) or not can_access_canvas(actor, record):
                continue
            is_deleted = bool(record.get("deleted_at"))
            if is_deleted != bool(deleted):
                continue
            if project and record.get("project") != project:
                continue
            records.append(dict(record))
        records.sort(
            key=lambda item: (
                0 if item.get("pinned") and not deleted else 1,
                -int(item.get("deleted_at") if deleted else item.get("updated_at") or item.get("created_at") or 0),
                str(item.get("id") or ""),
            )
        )
        total = len(records)
        rebuilding = bool(state.get("_query_rebuilding"))
        index_error = bool(state.get("failures"))
        if rebuilding:
            # The sorted set changes as the derived index grows. Restarting from
            # the first page lets clients merge by ID until a stable snapshot is
            # available; applying an old numeric offset would permanently skip
            # records inserted before that offset.
            offset = 0
        else:
            try:
                offset = max(0, int(cursor or 0))
            except (TypeError, ValueError):
                offset = 0
        if limit <= 0:
            return CanvasListPage(records[offset:], "", total, rebuilding, index_error)
        size = min(max(1, int(limit)), 200)
        page = records[offset : offset + size]
        # A full page returns a cursor even when it lands exactly on the end.  The
        # next request then authoritatively confirms exhaustion without ambiguity.
        next_cursor = "" if rebuilding else (
            str(offset + len(page)) if len(page) == size else ""
        )
        return CanvasListPage(page, next_cursor, total, rebuilding, index_error)


__all__ = ["CanvasListIndex", "CanvasListPage"]
