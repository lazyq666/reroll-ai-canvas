"""Workspace-owned Prompt Library data and cover media."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import uuid
from pathlib import Path
from urllib.parse import unquote, urlsplit

from .workspace import Workspace
from .workspace_storage import WorkspaceStorageError


_COVER_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"})
_COVER_CONTENT_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif",
}
_COVER_FILENAME = re.compile(
    r"^[0-9a-f]{64}\.(?:png|jpe?g|webp|gif|avif)$"
)
_LEGACY_COVER_PREFIX = "/assets/input/imported/"
_COVER_URL_PREFIX = "/api/prompt-libraries/covers/"


class PromptLibraryStorage:
    """Own the complete movable Prompt Library bundle behind one interface."""

    def __init__(
        self,
        workspace: Workspace,
        *,
        max_cover_bytes: int = 100 * 1024 * 1024,
    ) -> None:
        self._workspace = workspace
        self._max_cover_bytes = max(1, int(max_cover_bytes))

    @property
    def directory(self) -> Path:
        return self._workspace.prompt_library_directory

    @property
    def data_file(self) -> Path:
        return self._workspace.prompt_libraries

    @property
    def covers_directory(self) -> Path:
        return self._workspace.prompt_library_covers

    @property
    def legacy_data_file(self) -> Path:
        return self._workspace.legacy_prompt_libraries

    @property
    def recovery_directory(self) -> Path:
        return self.directory / "recovery"

    @property
    def migration_manifest(self) -> Path:
        return self.directory / "migration-v1.json"

    @staticmethod
    def _atomic_write(path: Path, content: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("xb") as output:
                output.write(content)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    @classmethod
    def _json_bytes(cls, data: object) -> bytes:
        return json.dumps(
            data,
            ensure_ascii=False,
            indent=2,
        ).encode("utf-8")

    @staticmethod
    def _cover_extension(name: object, content_type: object = "") -> str:
        extension = Path(str(name or "")).suffix.lower()
        normalized_type = str(content_type or "").split(";", 1)[0].lower()
        if extension == ".jpeg":
            extension = ".jpg"
        if extension not in _COVER_EXTENSIONS:
            extension = next(
                (
                    candidate
                    for candidate, mime in _COVER_CONTENT_TYPES.items()
                    if mime == normalized_type and candidate != ".jpeg"
                ),
                "",
            )
        if extension not in _COVER_EXTENSIONS:
            raise WorkspaceStorageError("提示词模板封面只支持图片文件")
        if normalized_type and not normalized_type.startswith("image/"):
            raise WorkspaceStorageError("提示词模板封面只支持图片文件")
        return extension

    def import_cover_bytes(
        self,
        content: bytes,
        *,
        name: object,
        content_type: object = "",
    ) -> dict[str, str]:
        extension = self._cover_extension(name, content_type)
        if not content:
            raise WorkspaceStorageError("所选封面图片为空")
        if len(content) > self._max_cover_bytes:
            raise WorkspaceStorageError("所选封面图片过大")
        digest = hashlib.sha256(content).hexdigest()
        filename = f"{digest}{extension}"
        destination = self.covers_directory / filename
        if destination.is_file() and not destination.is_symlink():
            if hashlib.sha256(destination.read_bytes()).hexdigest() == digest:
                return {
                    "media_id": digest,
                    "url": f"{_COVER_URL_PREFIX}{filename}",
                    "name": Path(str(name or filename)).name,
                    "kind": "image",
                }
        self._atomic_write(destination, content)
        return {
            "media_id": digest,
            "url": f"{_COVER_URL_PREFIX}{filename}",
            "name": Path(str(name or filename)).name,
            "kind": "image",
        }

    def resolve_cover(self, filename: object) -> tuple[Path, str]:
        safe_name = unquote(urlsplit(str(filename or "")).path).replace("\\", "/")
        if "/" in safe_name or not _COVER_FILENAME.fullmatch(safe_name):
            raise WorkspaceStorageError("无效的提示词模板封面地址")
        candidate = (self.covers_directory / safe_name).resolve()
        if (
            candidate.parent != self.covers_directory.resolve()
            or not candidate.is_file()
            or candidate.is_symlink()
        ):
            raise WorkspaceStorageError("提示词模板封面不存在")
        return candidate, _COVER_CONTENT_TYPES[candidate.suffix.lower()]

    def _migrate_cover(self, reference: object) -> tuple[str, bool]:
        path = unquote(urlsplit(str(reference or "")).path).replace("\\", "/")
        if not path.startswith(_LEGACY_COVER_PREFIX):
            return str(reference or ""), False
        filename = path[len(_LEGACY_COVER_PREFIX):]
        if not filename or "/" in filename:
            return str(reference or ""), False
        source = (self._workspace.imported_media / filename).resolve()
        if (
            source.parent != self._workspace.imported_media.resolve()
            or not source.is_file()
            or source.is_symlink()
        ):
            return str(reference or ""), False
        imported = self.import_cover_bytes(
            source.read_bytes(),
            name=filename,
        )
        return imported["url"], True

    def migrate_legacy_layout(self) -> bool:
        """Publish the directory layout once, retaining the old JSON for rollback."""

        if self.data_file.exists() or not self.legacy_data_file.exists():
            return False
        legacy_bytes = self.legacy_data_file.read_bytes()
        try:
            legacy_data = json.loads(legacy_bytes.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise WorkspaceStorageError(
                "旧提示词库数据无法安全迁移；原文件已保留"
            ) from exc
        if not isinstance(legacy_data, dict):
            raise WorkspaceStorageError(
                "旧提示词库数据格式无效；原文件已保留"
            )

        migrated = copy.deepcopy(legacy_data)
        migrated_covers = 0
        missing_covers: list[str] = []
        for library in migrated.get("libraries") or []:
            if not isinstance(library, dict):
                continue
            for item in library.get("items") or []:
                if not isinstance(item, dict) or not item.get("cover"):
                    continue
                next_cover, copied = self._migrate_cover(item.get("cover"))
                if copied:
                    item["cover"] = next_cover
                    migrated_covers += 1
                elif str(item.get("cover") or "").startswith(
                    _LEGACY_COVER_PREFIX
                ):
                    missing_covers.append(str(item.get("cover")))

        legacy_digest = hashlib.sha256(legacy_bytes).hexdigest()
        backup = self.recovery_directory / (
            f"prompt_libraries-{legacy_digest[:12]}.json"
        )
        self._atomic_write(backup, legacy_bytes)
        self._atomic_write(
            self.migration_manifest,
            self._json_bytes(
                {
                    "version": 1,
                    "source": "data/prompt_libraries.json",
                    "authority": "data/prompt-libraries/prompt_libraries.json",
                    "backup": (
                        "data/prompt-libraries/recovery/" + backup.name
                    ),
                    "source_sha256": legacy_digest,
                    "migrated_covers": migrated_covers,
                    "missing_covers": missing_covers,
                }
            ),
        )
        # Publish the new authority last. Any earlier failure leaves the old
        # JSON authoritative, while copied covers and recovery files are safe
        # to reuse on a deterministic retry.
        self._atomic_write(self.data_file, self._json_bytes(migrated))
        try:
            self.legacy_data_file.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            # The new authority and verified recovery copy are already durable.
            # Keeping the legacy source is safe and allows an operator to retry.
            pass
        return True

    def load(self) -> object:
        self.migrate_legacy_layout()
        return json.loads(self.data_file.read_text(encoding="utf-8-sig"))

    def save(self, data: object) -> None:
        self.migrate_legacy_layout()
        self._atomic_write(self.data_file, self._json_bytes(data))


__all__ = ["PromptLibraryStorage"]
