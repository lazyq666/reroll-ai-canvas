"""Portable media imports owned by one Workspace."""

from __future__ import annotations

import hashlib
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit

from .workspace_storage import WorkspaceStorageError

from .workspace import Workspace


_MEDIA_EXTENSIONS = {
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".webp": "image",
    ".gif": "image",
    ".bmp": "image",
    ".avif": "image",
    ".mp4": "video",
    ".webm": "video",
    ".mov": "video",
    ".m4v": "video",
    ".flv": "video",
    ".avi": "video",
    ".mkv": "video",
    ".mp3": "audio",
    ".wav": "audio",
    ".m4a": "audio",
    ".aac": "audio",
    ".ogg": "audio",
    ".flac": "audio",
    ".pdf": "file",
    ".txt": "file",
    ".md": "file",
    ".markdown": "file",
    ".csv": "file",
    ".json": "file",
    ".zip": "file",
    ".doc": "file",
    ".docx": "file",
    ".xls": "file",
    ".xlsx": "file",
    ".yaml": "file",
    ".yml": "file",
    ".log": "file",
    ".bin": "file",
}
_CONTENT_TYPE_EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mp4": ".m4a",
    "audio/ogg": ".ogg",
    "application/pdf": ".pdf",
    "application/json": ".json",
    "application/zip": ".zip",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "text/csv": ".csv",
}


@dataclass(frozen=True)
class ManagedMediaImport:
    media_id: str
    url: str
    name: str
    kind: str
    relative_path: str

    def public(self) -> dict[str, str]:
        return {
            "media_id": self.media_id,
            "url": self.url,
            "name": self.name,
            "kind": self.kind,
        }


class WorkspaceMediaService:
    """Copy local media into one Workspace before returning a reference."""

    def __init__(
        self,
        workspace: Workspace,
        *,
        max_bytes: int = 500 * 1024 * 1024,
    ) -> None:
        self._workspace = workspace
        self._max_bytes = max(1, int(max_bytes))

    @property
    def directory(self) -> Path:
        return self._workspace.imported_media

    @staticmethod
    def _media_type(
        name: object,
        content_type: object = "",
    ) -> tuple[str, str]:
        extension = Path(str(name or "")).suffix.lower()
        if extension not in _MEDIA_EXTENSIONS:
            normalized_type = str(content_type or "").split(";", 1)[0].lower()
            extension = _CONTENT_TYPE_EXTENSIONS.get(normalized_type, "")
        kind = _MEDIA_EXTENSIONS.get(extension, "")
        if not kind:
            raise WorkspaceStorageError(
                "此文件类型暂不支持导入工作区"
            )
        return kind, extension

    def _finish(
        self,
        temporary: Path,
        *,
        digest: str,
        extension: str,
        name: str,
        kind: str,
    ) -> ManagedMediaImport:
        filename = f"{digest}{extension}"
        destination = self.directory / filename
        try:
            existing_digest = ""
            if destination.is_file() and not destination.is_symlink():
                existing_hash = hashlib.sha256()
                with destination.open("rb") as existing:
                    for chunk in iter(
                        lambda: existing.read(1024 * 1024),
                        b"",
                    ):
                        existing_hash.update(chunk)
                existing_digest = existing_hash.hexdigest()
            if existing_digest == digest:
                temporary.unlink()
            else:
                os.replace(temporary, destination)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass
        relative_path = f"input/imported/{filename}"
        return ManagedMediaImport(
            media_id=digest,
            url=f"/assets/{relative_path}",
            name=name or filename,
            kind=kind,
            relative_path=relative_path,
        )

    def import_file(self, source: str | Path) -> ManagedMediaImport:
        path = Path(source).expanduser().resolve()
        kind, extension = self._media_type(path.name)
        try:
            if not path.is_file():
                raise OSError
            size = path.stat().st_size
        except OSError as exc:
            raise WorkspaceStorageError(
                "所选本地媒体不存在或无法读取"
            ) from exc
        if size <= 0:
            raise WorkspaceStorageError("所选本地媒体为空")
        if size > self._max_bytes:
            raise WorkspaceStorageError("所选本地媒体过大，无法导入工作区")

        self.directory.mkdir(parents=True, exist_ok=True)
        temporary = self.directory / f".import-{uuid.uuid4().hex}.tmp"
        digest = hashlib.sha256()
        copied = 0
        try:
            with path.open("rb") as source_file, temporary.open("xb") as output:
                while True:
                    chunk = source_file.read(1024 * 1024)
                    if not chunk:
                        break
                    copied += len(chunk)
                    if copied > self._max_bytes:
                        raise WorkspaceStorageError(
                            "所选本地媒体过大，无法导入工作区"
                        )
                    digest.update(chunk)
                    output.write(chunk)
            return self._finish(
                temporary,
                digest=digest.hexdigest(),
                extension=extension,
                name=path.name,
                kind=kind,
            )
        except WorkspaceStorageError:
            raise
        except OSError as exc:
            raise WorkspaceStorageError(
                "无法把本地媒体导入工作区，请检查目录权限后重试"
            ) from exc
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def import_bytes(
        self,
        content: bytes,
        *,
        name: str,
        content_type: str = "",
    ) -> ManagedMediaImport:
        kind, extension = self._media_type(name, content_type)
        if not content:
            raise WorkspaceStorageError("所选本地媒体为空")
        if len(content) > self._max_bytes:
            raise WorkspaceStorageError("所选本地媒体过大，无法导入工作区")
        self.directory.mkdir(parents=True, exist_ok=True)
        temporary = self.directory / f".import-{uuid.uuid4().hex}.tmp"
        try:
            temporary.write_bytes(content)
            return self._finish(
                temporary,
                digest=hashlib.sha256(content).hexdigest(),
                extension=extension,
                name=Path(name or "").name,
                kind=kind,
            )
        except OSError as exc:
            raise WorkspaceStorageError(
                "无法把本地媒体导入工作区，请检查目录权限后重试"
            ) from exc
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def resolve_reference(self, reference: object) -> Path:
        text = unquote(urlsplit(str(reference or "")).path)
        normalized = text.replace("\\", "/").lower()
        prefix = "/assets/input/imported/"
        if not normalized.startswith(prefix):
            raise WorkspaceStorageError("此媒体引用不属于当前工作区")
        filename = normalized[len(prefix):]
        if (
            not filename
            or "/" in filename
            or filename.startswith(".")
            or Path(filename).suffix not in _MEDIA_EXTENSIONS
        ):
            raise WorkspaceStorageError("此媒体引用无效")
        candidate = (self.directory / filename).resolve()
        if candidate.parent != self.directory.resolve() or not candidate.is_file():
            raise WorkspaceStorageError("工作区中的这个媒体暂时不可用")
        return candidate


__all__ = ["ManagedMediaImport", "WorkspaceMediaService"]
