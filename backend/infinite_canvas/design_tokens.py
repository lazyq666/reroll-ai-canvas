"""Safe editing seam for the project-owned global color tokens."""

from __future__ import annotations

import hashlib
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import Any, Dict, Iterable, List, Mapping, Sequence, Tuple


_TOKEN_NAME = re.compile(r"--[a-z0-9_-]+")
_EDITABLE_COLOR = re.compile(
    r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})"
)
_SIMPLE_SEMANTIC_MAPPING = re.compile(
    r"light-dark\(\s*var\((--ui-palette-[a-z0-9_-]+)\)\s*,\s*"
    r"var\((--ui-palette-[a-z0-9_-]+)\)\s*\)"
)


class DesignTokenError(Exception):
    """Base error exposed by the workbench interface."""


class DesignTokenValidation(DesignTokenError):
    """The proposed change is outside the editable contract."""


class DesignTokenConflict(DesignTokenError):
    """The source changed after the caller loaded its revision."""


@dataclass(frozen=True)
class _Declaration:
    name: str
    value: str
    value_start: int
    value_end: int


def _revision(source: str) -> str:
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def _matching_brace(source: str, opening: int) -> int:
    depth = 0
    quote = ""
    in_comment = False
    index = opening
    while index < len(source):
        char = source[index]
        following = source[index + 1] if index + 1 < len(source) else ""
        if in_comment:
            if char == "*" and following == "/":
                in_comment = False
                index += 2
                continue
        elif quote:
            if char == "\\":
                index += 2
                continue
            if char == quote:
                quote = ""
        elif char == "/" and following == "*":
            in_comment = True
            index += 2
            continue
        elif char in ("'", '"'):
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
        index += 1
    raise DesignTokenValidation("design-tokens.css 的 :root 区块没有闭合")


def _root_bounds(source: str) -> Tuple[int, int]:
    match = re.search(r"(?m)^\s*:root\s*\{", source)
    if not match:
        raise DesignTokenValidation("design-tokens.css 缺少 :root 区块")
    opening = source.find("{", match.start(), match.end())
    return opening + 1, _matching_brace(source, opening)


def _value_end(source: str, start: int, root_end: int) -> int:
    parentheses = 0
    quote = ""
    in_comment = False
    index = start
    while index < root_end:
        char = source[index]
        following = source[index + 1] if index + 1 < root_end else ""
        if in_comment:
            if char == "*" and following == "/":
                in_comment = False
                index += 2
                continue
        elif quote:
            if char == "\\":
                index += 2
                continue
            if char == quote:
                quote = ""
        elif char == "/" and following == "*":
            in_comment = True
            index += 2
            continue
        elif char in ("'", '"'):
            quote = char
        elif char == "(":
            parentheses += 1
        elif char == ")":
            parentheses = max(0, parentheses - 1)
        elif char == ";" and parentheses == 0:
            return index
        index += 1
    raise DesignTokenValidation("Token 声明缺少分号")


def _declarations(source: str) -> List[_Declaration]:
    root_start, root_end = _root_bounds(source)
    declarations: List[_Declaration] = []
    pattern = re.compile(r"(?m)^[ \t]*(--[a-z0-9_-]+)[ \t]*:[ \t]*")
    for match in pattern.finditer(source, root_start, root_end):
        start = match.end()
        end = _value_end(source, start, root_end)
        trimmed_start = start
        while trimmed_start < end and source[trimmed_start].isspace():
            trimmed_start += 1
        trimmed_end = end
        while trimmed_end > trimmed_start and source[trimmed_end - 1].isspace():
            trimmed_end -= 1
        declarations.append(
            _Declaration(
                name=match.group(1),
                value=source[trimmed_start:trimmed_end],
                value_start=trimmed_start,
                value_end=trimmed_end,
            )
        )
    if not declarations:
        raise DesignTokenValidation("design-tokens.css 的 :root 中没有 Token")
    return declarations


def _editable_tokens(declarations: Iterable[_Declaration]) -> List[Dict[str, str]]:
    editable: List[Dict[str, str]] = []
    for declaration in declarations:
        if declaration.name.startswith("--ui-palette-") and _EDITABLE_COLOR.fullmatch(
            declaration.value.strip()
        ):
            editable.append(
                {
                    "name": declaration.name,
                    "kind": "primitive-color",
                    "value": declaration.value.strip(),
                }
            )
            continue
        if not declaration.name.startswith("--ui-color-"):
            continue
        mapping = _SIMPLE_SEMANTIC_MAPPING.fullmatch(declaration.value.strip())
        if mapping:
            editable.append(
                {
                    "name": declaration.name,
                    "kind": "semantic-color",
                    "light": mapping.group(1),
                    "dark": mapping.group(2),
                    "value": declaration.value.strip(),
                }
            )
    return editable


def _validated_replacement(
    change: Mapping[str, Any],
    token: Mapping[str, str],
    palette_names: Sequence[str],
) -> str:
    name = str(change.get("name") or "")
    if token["kind"] == "primitive-color":
        value = str(change.get("value") or "").strip()
        if not _EDITABLE_COLOR.fullmatch(value):
            raise DesignTokenValidation(f"{name} 需要有效的 HEX 颜色值")
        return value

    light = str(change.get("light") or "").strip()
    dark = str(change.get("dark") or "").strip()
    allowed = set(palette_names)
    if light not in allowed or dark not in allowed:
        raise DesignTokenValidation(f"{name} 只能映射到可编辑的原子色板 Token")
    return f"light-dark(var({light}), var({dark}))"


class DesignTokenWorkbench:
    """Load and atomically save the narrow global-color editing interface."""

    def __init__(self, path: Path):
        self._path = Path(path)
        self._lock = RLock()

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            source = self._path.read_text(encoding="utf-8")
            return {
                "revision": _revision(source),
                "tokens": _editable_tokens(_declarations(source)),
            }

    def save(
        self,
        *,
        expected_revision: str,
        changes: Sequence[Mapping[str, Any]],
    ) -> Dict[str, Any]:
        if not changes:
            raise DesignTokenValidation("至少需要修改一个 Token")
        if len(changes) > 100:
            raise DesignTokenValidation("单次最多保存 100 个 Token")

        with self._lock:
            source = self._path.read_text(encoding="utf-8")
            if not expected_revision or expected_revision != _revision(source):
                raise DesignTokenConflict("Token 文件已发生变化，请重新载入后再保存")

            declarations = _declarations(source)
            declarations_by_name = {item.name: item for item in declarations}
            editable = _editable_tokens(declarations)
            editable_by_name = {item["name"]: item for item in editable}
            palette_names = [
                item["name"] for item in editable if item["kind"] == "primitive-color"
            ]
            seen = set()
            replacements = []
            for change in changes:
                name = str(change.get("name") or "")
                if not _TOKEN_NAME.fullmatch(name) or name not in editable_by_name:
                    raise DesignTokenValidation(f"{name or '未命名 Token'} 不在可编辑范围")
                if name in seen:
                    raise DesignTokenValidation(f"{name} 在同一次保存中重复出现")
                seen.add(name)
                declaration = declarations_by_name[name]
                replacement = _validated_replacement(
                    change, editable_by_name[name], palette_names
                )
                replacements.append(
                    (declaration.value_start, declaration.value_end, replacement)
                )

            updated = source
            for start, end, replacement in sorted(replacements, reverse=True):
                updated = updated[:start] + replacement + updated[end:]
            if updated == source:
                raise DesignTokenValidation("修改内容与当前 Token 相同")
            self._write_atomic(updated)
            return {
                "revision": _revision(updated),
                "tokens": _editable_tokens(_declarations(updated)),
            }

    def _write_atomic(self, source: str) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{self._path.name}.",
            suffix=".tmp",
            dir=str(self._path.parent),
        )
        try:
            if self._path.exists():
                os.fchmod(descriptor, self._path.stat().st_mode)
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as handle:
                handle.write(source)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_name, self._path)
        except Exception:
            try:
                os.close(descriptor)
            except OSError:
                pass
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass
            raise
