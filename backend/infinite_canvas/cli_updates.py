"""Device-local CLI version discovery and administrator-visible reminders.

The module keeps vendor-specific release parsing behind adapters.  Its scope
is deliberately read-only: it never installs, upgrades, or executes
instructions returned by a remote endpoint.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import gzip
import html
import io
import json
import os
import platform
import re
import shutil
import subprocess
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Mapping, Sequence


DREAMINA_RELEASE_URL = (
    "https://lf3-static.bytednsdoc.com/obj/eden-cn/psj_hupthlyk/"
    "ljhwZthlaukjlkulzlp/version.json"
)
CODEX_RELEASE_URL = "https://api.github.com/repos/openai/codex/releases/latest"
CODEX_RELEASE_PAGE = "https://github.com/openai/codex/releases/latest"
CODEX_NPM_RELEASE_URL = "https://registry.npmjs.org/@openai%2Fcodex/latest"
CODEX_HOMEBREW_RELEASE_URL = "https://formulae.brew.sh/api/cask/codex.json"
ANTIGRAVITY_DOWNLOAD_URL = "https://antigravity.google/download"
ANTIGRAVITY_CHANGELOG_URL = "https://antigravity.google/changelog?tab=cli"

_VERSION_RE = re.compile(
    r"(?<![0-9A-Za-z])v?(\d+)\.(\d+)\.(\d+)"
    r"(?:[-._]?([0-9A-Za-z][0-9A-Za-z.-]*))?",
    re.IGNORECASE,
)


class CliUpdateError(RuntimeError):
    """A safe, user-displayable CLI maintenance failure."""

    def __init__(self, message: str, *, code: str = "action_failed", diagnostic: str = "") -> None:
        super().__init__(message)
        self.code = code
        self.diagnostic = str(diagnostic or "")[:1000]


@dataclass(frozen=True)
class ParsedVersion:
    numbers: tuple[int, int, int]
    prerelease: tuple[tuple[int, Any], ...] = ()

    @property
    def is_prerelease(self) -> bool:
        return bool(self.prerelease)


def parse_version(value: object) -> ParsedVersion | None:
    match = _VERSION_RE.search(str(value or ""))
    if not match:
        return None
    parts: list[tuple[int, Any]] = []
    for token in re.split(r"[.-]", match.group(4) or ""):
        if not token:
            continue
        parts.append((0, int(token)) if token.isdigit() else (1, token.lower()))
    return ParsedVersion(tuple(int(match.group(i)) for i in range(1, 4)), tuple(parts))


def compare_versions(left: object, right: object) -> int | None:
    """Return -1/0/1, keeping stable releases newer than prereleases."""

    a, b = parse_version(left), parse_version(right)
    if a is None or b is None:
        return None
    if a.numbers != b.numbers:
        return -1 if a.numbers < b.numbers else 1
    if a.prerelease == b.prerelease:
        return 0
    if not a.prerelease:
        return 1
    if not b.prerelease:
        return -1
    for ai, bi in zip(a.prerelease, b.prerelease):
        if ai == bi:
            continue
        if ai[0] != bi[0]:
            return -1 if ai[0] < bi[0] else 1
        return -1 if ai[1] < bi[1] else 1
    return -1 if len(a.prerelease) < len(b.prerelease) else 1


def _utc_iso(timestamp: float | None = None) -> str:
    return dt.datetime.fromtimestamp(
        time.time() if timestamp is None else timestamp, tz=dt.timezone.utc
    ).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _strip_markup(value: object, limit: int = 6000) -> str:
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def _default_fetch(url: str, *, timeout: float = 8.0) -> tuple[bytes, Mapping[str, str]]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
            "User-Agent": "Reroll-CLI-Update-Checker/1",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        headers = dict(response.headers.items())
        body = response.read(2_000_001)
    if len(body) > 2_000_000:
        raise CliUpdateError("Release metadata is too large.", code="invalid_metadata")
    content_encoding = next(
        (
            str(value).lower()
            for key, value in headers.items()
            if str(key).lower() == "content-encoding"
        ),
        "",
    )
    if "gzip" in content_encoding:
        with gzip.GzipFile(fileobj=io.BytesIO(body)) as compressed:
            body = compressed.read(2_000_001)
        if len(body) > 2_000_000:
            raise CliUpdateError("Release metadata is too large.", code="invalid_metadata")
    return body, headers


def _run_version_command(argv: Sequence[str], timeout: float = 8.0) -> tuple[bool, str]:
    try:
        completed = subprocess.run(
            list(argv),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return False, str(exc)[:600]
    output = (completed.stdout or completed.stderr or "").strip()
    return completed.returncode == 0, output[:1000]


def _run_version(executable: str, timeout: float = 8.0) -> tuple[bool, str]:
    return _run_version_command([executable, "--version"], timeout=timeout)


def _resolved_executable(value: object) -> str:
    raw = str(value or "").strip().strip('"')
    if not raw:
        return ""
    found = shutil.which(raw) if not os.path.isabs(raw) else raw
    return os.path.realpath(found) if found and os.path.isfile(found) else ""


@dataclass
class CliAdapter:
    id: str
    display_name: str
    executable: Callable[[], str]
    release_url: str
    source_url: str
    fetch: Callable[..., tuple[bytes, Mapping[str, str]]] = _default_fetch

    def local(self) -> dict[str, Any]:
        executable = _resolved_executable(self.executable())
        if not executable:
            return {"installed": False, "path": "", "version": "", "raw_version": ""}
        ok, raw = _run_version(executable)
        parsed = parse_version(raw)
        return {
            # The executable path is the installation signal.  A failed or
            # unfamiliar version command is a distinct "uncomparable" state,
            # not evidence that the CLI is absent.
            "installed": True,
            "path": executable,
            "version": (
                ".".join(str(part) for part in parsed.numbers)
                + ("-" + ".".join(str(item[1]) for item in parsed.prerelease) if parsed and parsed.prerelease else "")
                if parsed else ""
            ),
            "raw_version": raw,
        }

    def remote(self, channel: str = "") -> dict[str, Any]:  # pragma: no cover - abstract seam
        raise NotImplementedError

    def channel(self, executable: str) -> str:
        return "manual"

    def uncomparable_detail_key(self) -> str:
        return "cliUpdates.uncomparableDetail"

    def check(self) -> dict[str, Any]:
        checked_at = _utc_iso()
        local = self.local()
        base = {
            "id": self.id,
            "display_name": self.display_name,
            "checked_at": checked_at,
            "source_url": self.source_url,
            "platform": platform.system().lower(),
            "architecture": platform.machine().lower(),
            **local,
            "local_version": str(local.get("version") or ""),
        }
        if not local["installed"]:
            return {**base, "state": "not_installed", "update_available": False}
        channel = self.channel(local["path"])
        base["channel"] = channel
        try:
            remote = self.remote(channel)
        except Exception as exc:
            return {
                **base,
                "state": "check_failed",
                "update_available": False,
                "error": str(exc)[:1000],
            }
        available = str(remote.get("version") or "")
        relation = compare_versions(local.get("version"), available)
        result = {
            **base,
            "available_version": available,
            "release_date": str(remote.get("release_date") or ""),
            "release_notes": _strip_markup(remote.get("release_notes")),
            "release_notes_available": bool(_strip_markup(remote.get("release_notes"))),
        }
        if relation is None:
            return {
                **result,
                "state": "uncomparable",
                "update_available": False,
                "detail_key": self.uncomparable_detail_key(),
            }
        if relation >= 0:
            return {**result, "state": "current", "update_available": False}
        if parse_version(local.get("version")) and parse_version(local.get("version")).is_prerelease:
            # A prerelease is never silently "downgraded" to an older stable train.
            local_numbers = parse_version(local.get("version")).numbers
            remote_numbers = parse_version(available).numbers if parse_version(available) else ()
            if remote_numbers < local_numbers:
                return {**result, "state": "current", "update_available": False}
        return {**result, "state": "update_available", "update_available": True}


class DreaminaAdapter(CliAdapter):
    version_command: Callable[[str], Sequence[str]] | None = None

    def local(self) -> dict[str, Any]:
        executable = _resolved_executable(self.executable())
        if not executable:
            return {"installed": False, "path": "", "version": "", "raw_version": ""}
        attempts = ("--version", "-V", "version")
        raw = ""
        for flag in attempts:
            argv = (
                list(self.version_command(flag))
                if callable(self.version_command)
                else [executable, flag]
            )
            ok, output = _run_version_command(argv)
            if ok:
                raw = output or raw
            elif not raw:
                raw = output
            if ok and parse_version(output):
                raw = output
                break
        parsed = parse_version(raw)
        build_identity = ""
        build_time = ""
        if not parsed:
            try:
                payload = json.loads(raw)
                if isinstance(payload, dict):
                    build_identity = str(
                        payload.get("version") or payload.get("commit") or ""
                    ).strip()
                    build_time = str(
                        payload.get("build_time") or payload.get("buildTime") or ""
                    ).strip()[:64]
            except (TypeError, ValueError):
                pass
        return {
            "installed": True,
            "path": executable,
            "version": ".".join(str(part) for part in parsed.numbers) if parsed else "",
            "local_display_version": (
                ".".join(str(part) for part in parsed.numbers)
                if parsed
                else build_identity
            ),
            "local_build_time": build_time,
            "raw_version": raw,
        }

    def remote(self, channel: str = "") -> dict[str, Any]:
        raw, _headers = self.fetch(self.release_url, timeout=8.0)
        payload = json.loads(raw.decode("utf-8-sig"))
        if not isinstance(payload, dict) or not parse_version(payload.get("version")):
            raise CliUpdateError("Dreamina release metadata has no comparable version.", code="invalid_metadata")
        return {
            "version": payload.get("version"),
            "release_date": payload.get("release_date") or payload.get("releaseDate"),
            "release_notes": payload.get("release_notes") or payload.get("releaseNotes"),
        }

    def uncomparable_detail_key(self) -> str:
        return "cliUpdates.uncomparableDreamina"


class CodexAdapter(CliAdapter):
    def _github_release(self) -> dict[str, Any]:
        raw, _headers = self.fetch(self.release_url, timeout=8.0)
        payload = json.loads(raw.decode("utf-8-sig"))
        if not isinstance(payload, dict) or payload.get("prerelease") is True:
            raise CliUpdateError("Codex latest release metadata is not a stable release.", code="prerelease_metadata")
        version = payload.get("tag_name") or payload.get("name")
        if not parse_version(version):
            raise CliUpdateError("Codex release metadata has no comparable version.", code="invalid_metadata")
        return {
            "version": version,
            "release_date": payload.get("published_at") or payload.get("created_at"),
            "release_notes": payload.get("body"),
        }

    def remote(self, channel: str = "") -> dict[str, Any]:
        if channel not in {"npm", "homebrew"}:
            return self._github_release()
        if channel == "npm":
            raw, _headers = self.fetch(CODEX_NPM_RELEASE_URL, timeout=8.0)
            payload = json.loads(raw.decode("utf-8-sig"))
            version = payload.get("version") if isinstance(payload, dict) else ""
        else:
            raw, _headers = self.fetch(CODEX_HOMEBREW_RELEASE_URL, timeout=8.0)
            payload = json.loads(raw.decode("utf-8-sig"))
            version = payload.get("version") if isinstance(payload, dict) else ""
        if not parse_version(version):
            raise CliUpdateError(f"Codex {channel} metadata has no comparable version.", code="invalid_metadata")
        try:
            github = self._github_release()
        except Exception:
            github = {}
        same_release = compare_versions(version, github.get("version")) == 0
        return {
            "version": version,
            "release_date": github.get("release_date") if same_release else "",
            "release_notes": github.get("release_notes") if same_release else "",
        }

    def channel(self, executable: str) -> str:
        normalized = executable.replace("\\", "/").lower()
        if "/node_modules/@openai/codex" in normalized or "/npm/" in normalized:
            return "npm"
        if "/caskroom/codex/" in normalized or "/homebrew/" in normalized:
            return "homebrew"
        return "standalone"

class AntigravityAdapter(CliAdapter):
    def remote(self, channel: str = "") -> dict[str, Any]:
        raw, _headers = self.fetch(self.release_url, timeout=8.0)
        page = raw.decode("utf-8", errors="replace")
        match = re.search(
            r'<a\b[^>]*href=["\'][^"\']*changelog\?tab=cli[^"\']*["\'][^>]*>'
            r"\s*v?(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?)\s*</a>",
            page,
            re.IGNORECASE | re.DOTALL,
        )
        if not match:
            raise CliUpdateError("Antigravity download page has no comparable CLI version.", code="invalid_metadata")
        notes = ""
        release_date = ""
        try:
            changelog_raw, _ = self.fetch(ANTIGRAVITY_CHANGELOG_URL, timeout=8.0)
            changelog = changelog_raw.decode("utf-8", errors="replace")
            version_pattern = re.escape(match.group(1))
            section = re.search(
                rf"v?{version_pattern}.{0,1600}", changelog, re.IGNORECASE | re.DOTALL
            )
            notes = _strip_markup(section.group(0) if section else "")
            date_match = re.search(
                r"(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}",
                section.group(0) if section else "",
            )
            release_date = date_match.group(0) if date_match else ""
        except Exception:
            pass
        return {"version": match.group(1), "release_date": release_date, "release_notes": notes}

@dataclass
class CliUpdateManager:
    adapters: Sequence[CliAdapter]
    configured_ids: Callable[[], Iterable[str]] = lambda: ()
    now: Callable[[], float] = time.time
    _results: dict[str, dict[str, Any]] = field(default_factory=dict, init=False)
    _dismissed: set[str] = field(default_factory=set, init=False)
    _check_lock: asyncio.Lock = field(default_factory=asyncio.Lock, init=False)
    _state_lock: threading.RLock = field(default_factory=threading.RLock, init=False)
    _checking: bool = field(default=False, init=False)

    def snapshot(self) -> dict[str, Any]:
        with self._state_lock:
            items = [dict(self._results.get(adapter.id) or self._placeholder(adapter)) for adapter in self.adapters]
            checking = self._checking
            dismissed = set(self._dismissed)
        return {
            "session_id": str(id(self)),
            "checking": checking,
            "items": items,
            "notification_items": [
                item for item in items
                if item.get("update_available") and item.get("id") not in dismissed
            ],
        }

    def _placeholder(self, adapter: CliAdapter) -> dict[str, Any]:
        return {
            "id": adapter.id,
            "display_name": adapter.display_name,
            "state": "pending" if self._checking else "not_checked",
            "update_available": False,
        }

    async def check_all(self, *, force: bool = False) -> dict[str, Any]:
        async with self._check_lock:
            if self._results and not force:
                return self.snapshot()
            with self._state_lock:
                self._checking = True
            try:
                try:
                    configured = {str(value) for value in self.configured_ids()}
                except Exception as exc:
                    with self._state_lock:
                        for adapter in self.adapters:
                            self._results[adapter.id] = {
                                **self._placeholder(adapter),
                                "state": "check_failed",
                                "checked_at": _utc_iso(self.now()),
                                "error": str(exc)[:1000],
                            }
                else:
                    tasks = []
                    active_adapters = []
                    for adapter in self.adapters:
                        if adapter.id not in configured:
                            with self._state_lock:
                                self._results[adapter.id] = {
                                    **self._placeholder(adapter),
                                    "state": "not_configured",
                                    "checked_at": _utc_iso(self.now()),
                                }
                            continue
                        active_adapters.append(adapter)
                        tasks.append(asyncio.to_thread(adapter.check))
                    checked = await asyncio.gather(*tasks, return_exceptions=True)
                    with self._state_lock:
                        for adapter, value in zip(active_adapters, checked):
                            if isinstance(value, Exception):
                                value = {
                                    **self._placeholder(adapter),
                                    "state": "check_failed",
                                    "checked_at": _utc_iso(self.now()),
                                    "error": str(value)[:1000],
                                }
                            self._results[adapter.id] = dict(value)
            finally:
                with self._state_lock:
                    self._checking = False
            return self.snapshot()

    def dismiss(self, cli_ids: Iterable[str]) -> dict[str, Any]:
        known = {adapter.id for adapter in self.adapters}
        with self._state_lock:
            self._dismissed.update(str(value) for value in cli_ids if str(value) in known)
        return self.snapshot()


def build_default_manager(
    *,
    dreamina_executable: Callable[[], str],
    codex_executable: Callable[[], str],
    antigravity_executable: Callable[[], str],
    configured_ids: Callable[[], Iterable[str]],
    dreamina_version_command: Callable[[str], Sequence[str]] | None = None,
) -> CliUpdateManager:
    dreamina = DreaminaAdapter("jimeng", "Dreamina CLI", dreamina_executable, DREAMINA_RELEASE_URL, "https://jimeng.jianying.com/cli")
    dreamina.version_command = dreamina_version_command
    return CliUpdateManager(
        adapters=(
            dreamina,
            CodexAdapter("codex", "Codex CLI", codex_executable, CODEX_RELEASE_URL, CODEX_RELEASE_PAGE),
            AntigravityAdapter("gemini-cli", "Antigravity CLI", antigravity_executable, ANTIGRAVITY_DOWNLOAD_URL, ANTIGRAVITY_CHANGELOG_URL),
        ),
        configured_ids=configured_ids,
    )


__all__ = [
    "AntigravityAdapter",
    "CliAdapter",
    "CliUpdateError",
    "CliUpdateManager",
    "CodexAdapter",
    "DreaminaAdapter",
    "build_default_manager",
    "compare_versions",
    "parse_version",
]
