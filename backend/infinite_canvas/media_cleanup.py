"""Manual, conservative collection of unreferenced Workspace media.

The application freezes HTTP work and realtime mutations during collection.
Only a previously previewed set can be removed; references are read again at
confirmation. Media used during this service session is temporarily pinned.
"""

from __future__ import annotations

import asyncio
import html
import json
import os
import re
import sqlite3
import stat
import threading
import time
import uuid
import unicodedata
from contextlib import asynccontextmanager, closing
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote

from .media import _MEDIA_EXTENSIONS


# Legacy Canvas snapshots can contain inline media and exceed 64 MiB.
_MAX_JSON_REFERENCE_BYTES = 256 * 1024 * 1024
_LEGACY_MATTING_MODELS = {
    ('models', 'matting', 'birefnet-general.onnx'),
    ('models', 'matting', 'birefnet-general-lite.onnx'),
}


class MediaCleanupError(Exception):
    def __init__(self, code: str = "unreadable") -> None:
        super().__init__(code)
        self.code = code


class MediaCleanupGate:
    """Drain admitted requests and mutations before the short exclusive scan."""

    def __init__(self) -> None:
        self._condition = asyncio.Condition()
        self._active = 0
        self._exclusive = False

    @asynccontextmanager
    async def activity(self):
        async with self._condition:
            await self._condition.wait_for(lambda: not self._exclusive)
            self._active += 1
        try:
            yield
        finally:
            async with self._condition:
                self._active -= 1
                self._condition.notify_all()

    @asynccontextmanager
    async def exclusive(self):
        async with self._condition:
            if self._exclusive:
                raise MediaCleanupError("busy")
            self._exclusive = True
        try:
            async with self._condition:
                try:
                    await asyncio.wait_for(
                        self._condition.wait_for(lambda: self._active == 0), 10
                    )
                except TimeoutError as exc:
                    raise MediaCleanupError("busy") from exc
            yield
        finally:
            async with self._condition:
                self._exclusive = False
                self._condition.notify_all()


class MediaCleanupTraffic:
    """ASGI admission, including uploads and reads that lazily persist data."""

    def __init__(self, app, *, gate, lease, admission=None) -> None:
        self.app, self.gate, self.lease = app, gate, lease
        self.admission = admission

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        cleanup_paths = {
            "/api/workspace-storage-settings/cleanup/scan",
            "/api/workspace-storage-settings/cleanup/confirm",
            "/api/workspace-storage-settings/cloud",
        }
        if scope["type"] != "http" or path in cleanup_paths:
            return await self.app(scope, receive, send)
        async with self.gate.activity():
            code = self.admission(path) if self.admission else None
            if code:
                from starlette.responses import JSONResponse
                return await JSONResponse({'code': code, 'detail': {'code': code}}, status_code=503)(scope, receive, send)
            if path.startswith(("/assets/", "/api/storage-files/")):
                self.lease(path)
            await self.app(scope, receive, send)


@dataclass(frozen=True)
class Candidate:
    relative: str
    fingerprint: tuple[int, int, int, int, int]

    @property
    def size(self) -> int:
        return self.fingerprint[2]


class WorkspaceMediaCleanup:
    def __init__(self, *, now=time.time) -> None:
        self._now = now
        self._started = now()
        self._leases: set[str] = set()
        self._lease_lock = threading.Lock()
        self._plans: dict[str, tuple] = {}

    @staticmethod
    def _tokens(value: str) -> set[str]:
        # Basenames and content identities also protect old relative/absolute
        # URLs, Markdown references and URL aliases. Ambiguity retains bytes.
        decoded = unicodedata.normalize("NFC", html.unescape(unquote(value))).casefold()
        tokens = set(re.findall(r"[\w.\-]+", decoded))
        for segment in re.split(r'''[/\\"'<>?\#\r\n]''', decoded):
            tokens.add(segment)
            tokens.add(segment.rstrip(")] \t"))
        return tokens

    def lease(self, value: str) -> None:
        with self._lease_lock:
            self._leases.update(self._tokens(value))

    @staticmethod
    def _fingerprint(path: Path) -> tuple[int, int, int, int, int]:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise MediaCleanupError()
        return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

    def _collect_value(self, value, used: set[str]) -> None:
        if isinstance(value, str):
            used.update(self._tokens(value))
        elif isinstance(value, dict):
            for key, item in value.items():
                self._collect_value(key, used)
                self._collect_value(item, used)
        elif isinstance(value, list):
            for item in value:
                self._collect_value(item, used)

    @staticmethod
    def _close_backup_containers(text: str) -> str:
        # Some legacy corrupt-* backups end after a complete JSON value. Only
        # append missing object/array delimiters; never invent or discard a
        # string/value. json.loads below still validates the entire document.
        closers: list[str] = []
        quoted = escaped = False
        for char in text:
            if quoted:
                if escaped:
                    escaped = False
                elif char == '\\':
                    escaped = True
                elif char == '"':
                    quoted = False
            elif char == '"':
                quoted = True
            elif char in '{[':
                closers.append('}' if char == '{' else ']')
            elif char in '}]':
                if not closers or closers.pop() != char:
                    raise MediaCleanupError()
        if quoted or not closers:
            raise MediaCleanupError()
        return text + ''.join(reversed(closers))

    def _reference_json(self, path: Path, *, recovery_backup: bool):
        if path.stat().st_size > _MAX_JSON_REFERENCE_BYTES:
            raise MediaCleanupError()
        text = path.read_text(encoding='utf-8-sig')
        try:
            return json.loads(text)
        except json.JSONDecodeError as error:
            if (not recovery_backup
                    or not re.fullmatch(r'.+\.corrupt-\d{8}-\d{6}\.json\.bak', path.name)
                    or error.pos < len(text.rstrip())):
                raise
            return json.loads(self._close_backup_containers(text))

    def _database(self, path: Path, used: set[str]) -> None:
        # Reconnect catch-up events and idempotency acknowledgements are not
        # restorable content. Bounded canvas_mutations *are* roots (both sides).
        ignored = {"canvas_events", "canvas_operation_receipts", "applied_generation_effects"}
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as connection:
            connection.execute("BEGIN")
            if connection.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise MediaCleanupError()
            tables = [row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )]
            for table in tables:
                if table in ignored or table.startswith("sqlite_"):
                    continue
                quoted = '"' + table.replace('"', '""') + '"'
                query = f"SELECT * FROM {quoted}"
                if table == "generation_log_payloads":
                    query += " WHERE payload_digest IN (SELECT payload_digest FROM canvas_logs)"
                if table in {"generation_effect_outbox", "generation_publication_receipts"}:
                    # Pending retry payloads are durable reference roots below;
                    # only a claimed writer (or unknown state) prevents scanning.
                    if connection.execute(f"SELECT 1 FROM {quoted} WHERE state NOT IN ('pending', 'completed') LIMIT 1").fetchone():
                        raise MediaCleanupError("busy")
                cursor = connection.execute(query)
                columns = [column[0] for column in cursor.description]
                for row in cursor:
                    for column, value in zip(columns, row):
                        if isinstance(value, bytes):
                            raise MediaCleanupError()
                        if column.endswith("_json") and value is not None:
                            self._collect_value(json.loads(value), used)
                        else:
                            self._collect_value(value, used)

    @staticmethod
    def _empty_publication_sidecar(path: Path) -> bool:
        # Publishing a verified SQLite backup renames the main file, but its
        # integrity-check connection can leave empty WAL/index sidecars behind.
        # Only a known publication with no remaining database and an empty WAL
        # is proven to contain no recoverable references. Keep the files intact.
        match = re.fullmatch(
            r"\.(canvas-content\.sqlite3|generation-runs\.sqlite3)\."
            r"[a-f0-9]{32}\.(?:publish|resume)-(?:wal|shm)", path.name
        )
        if not match:
            return False
        temporary = path.with_name(path.name.rsplit('-', 1)[0])
        wal = temporary.with_name(temporary.name + '-wal')
        return (
            path.with_name(match[1]).is_file()
            and not temporary.exists()
            and wal.is_file()
            and not wal.is_symlink()
            and wal.stat().st_size == 0
        )

    def _references(self, root: Path, *, sqlite_authority: bool) -> set[str]:
        used: set[str] = set()
        data = root / "data"
        if not data.is_dir() or data.is_symlink():
            raise MediaCleanupError()
        if sqlite_authority and not all((data / name).is_file() for name in (
            "canvas-content.sqlite3", "generation-runs.sqlite3"
        )):
            raise MediaCleanupError()
        def fail(_error):
            raise MediaCleanupError()
        for directory, dirs, files in os.walk(data, followlinks=False, onerror=fail):
            folder = Path(directory)
            if any((folder / name).is_symlink() for name in dirs + files):
                raise MediaCleanupError()
            if sqlite_authority and folder == data:
                dirs[:] = [name for name in dirs if name != "canvases"]
            for name in files:
                path = folder / name
                if name == ".DS_Store":
                    continue
                if sqlite_authority and folder == data and self._empty_publication_sidecar(path):
                    continue
                if sqlite_authority and folder == data and name in {
                    "generation-history.json", "generation-runs.json", "generation-effects.json"
                }:
                    continue
                relative = path.relative_to(data).parts
                if relative in _LEGACY_MATTING_MODELS and stat.S_ISREG(path.lstat().st_mode):
                    # Known regenerable model caches from the old Workspace
                    # layout contain no Canvas references. Leave their bytes.
                    continue
                recovery_backup = relative[0] == 'recovery' and name.endswith('.json.bak')
                if path.suffix in {".sqlite3", ".db"}:
                    self._database(path, used)
                elif name.endswith(("-wal", "-shm", "-journal")):
                    if not path.with_name(re.sub(r"-(wal|shm|journal)$", "", name)).is_file():
                        raise MediaCleanupError()
                elif path.suffix == ".json" or recovery_backup:
                    payload = self._reference_json(path, recovery_backup=recovery_backup)
                    if folder == data and name == "generation-effects.json" and isinstance(payload, dict) and payload.get("pending"):
                        raise MediaCleanupError("busy")
                    self._collect_value(payload, used)
                elif path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg"}:
                    # Dedicated covers are outside the candidate directories.
                    continue
                elif path.suffix.lower() in {".txt", ".md", ".yaml", ".yml"}:
                    self._collect_value(path.read_text(encoding="utf-8"), used)
                else:
                    # Unknown records/recovery files must not be silently lost.
                    raise MediaCleanupError()
        with self._lease_lock:
            used.update(self._leases)
        return used

    def _candidates(self, root: Path, *, sqlite_authority: bool) -> list[Candidate]:
        if (root / "assets").is_symlink():
            raise MediaCleanupError()
        used = self._references(root, sqlite_authority=sqlite_authority)
        result = []
        for kind in ("input", "output", "uploads"):
            base = root / "assets" / kind
            if base.is_symlink() or not base.exists():
                continue
            for directory, dirs, files in os.walk(base, followlinks=False):
                folder = Path(directory)
                dirs[:] = [name for name in dirs if not name.startswith('.') and not (folder / name).is_symlink()]
                for name in files:
                    path = folder / name
                    if (name.startswith(".") or not re.fullmatch(r"[\w .-]+", name)
                            or path.suffix.lower() not in _MEDIA_EXTENSIONS
                            or unicodedata.normalize("NFC", name).casefold() in used
                            or (re.fullmatch(r"[a-f0-9]{64}", path.stem) and path.stem in used)):
                        continue
                    try:
                        fingerprint = self._fingerprint(path)
                    except (OSError, MediaCleanupError):
                        continue
                    # Uploads/results from this process remain protected even
                    # between returning their URL and saving a canvas/draft.
                    if max(fingerprint[3:]) >= int(self._started * 1_000_000_000):
                        continue
                    result.append(Candidate(str(path.relative_to(root)), fingerprint))
        return result

    def scan(self, root: Path, owner: str, *, sqlite_authority: bool) -> dict:
        try:
            candidates = self._candidates(root, sqlite_authority=sqlite_authority)
        except (OSError, ValueError, sqlite3.Error) as exc:
            raise MediaCleanupError() from exc
        self._plans = {key: plan for key, plan in self._plans.items()
                       if plan[0] > self._now() and plan[2] != owner}
        if len(self._plans) >= 16:
            self._plans.pop(next(iter(self._plans)))
        token = uuid.uuid4().hex
        self._plans[token] = (self._now() + 600, str(root), owner, candidates)
        return {"scan_id": token, "file_count": len(candidates),
                "total_bytes": sum(item.size for item in candidates)}

    def confirm(self, root: Path, owner: str, scan_id: str, *, sqlite_authority: bool) -> dict:
        plan = self._plans.get(scan_id)
        if not plan or plan[0] <= self._now() or plan[1:3] != (str(root), owner):
            raise MediaCleanupError("expired")
        try:
            eligible = {item.relative: item for item in self._candidates(
                root, sqlite_authority=sqlite_authority
            )}
        except (OSError, ValueError, sqlite3.Error) as exc:
            raise MediaCleanupError() from exc
        self._plans.pop(scan_id)
        removed = total = failed = skipped = 0
        for item in plan[3]:
            if eligible.get(item.relative) != item:
                skipped += 1
                continue
            path = root / item.relative
            try:
                # Recheck physical identity immediately before deletion, and
                # never follow replaced parent directories out of Workspace.
                if path.resolve() != path or self._fingerprint(path) != item.fingerprint:
                    skipped += 1
                    continue
                path.unlink()
                removed += 1
                total += item.size
            except (OSError, MediaCleanupError):
                failed += 1
        return {"file_count": removed, "total_bytes": total,
                "skipped_count": skipped, "failed_count": failed}
