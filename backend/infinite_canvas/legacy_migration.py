"""Verified migration from legacy mixed-data directories.

Legacy installations mixed Workspace Data, device caches, and local metadata
under one directory.  This module classifies every source file, copies it to
the correct boundary, verifies content, and only then allows source removal.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .generation_settings import GenerationSettingsService
from .instance_state import InstanceState


WORKSPACE_DIRECTORIES = frozenset(
    {
        "canvases",
        # Preserve retired GPT conversation data during upgrades. The app no
        # longer reads or writes it, but migration must not reject an existing
        # workspace merely because older versions created this directory.
        "conversations",
        "recovery",
        "update_backups",
        "workflows",
    }
)
WORKSPACE_FILES = frozenset(
    {
        "api_providers.json",
        "auth.db",
        "auth.db-shm",
        "auth.db-wal",
        "available_models.json",
        "generation-effects.json",
        "generation-history.json",
        "generation-runs.json",
        "projects.json",
        "prompt_libraries.json",
        "runninghub_workflows.json",
    }
)
ASSET_DIRECTORIES = frozenset({"input", "output", "uploads"})
DISCARDED_METADATA = frozenset(
    {
        ".DS_Store",
        "Desktop.ini",
        "Thumbs.db",
        "storage_settings.json",
    }
)
DEVICE_STATE_FILES = frozenset(
    {
        "api.env",
        "instance.json",
        "launch.lock",
        "launcher-state.json",
        "provider-connections.json",
        "server-identity.json",
        "workspace-identity.json",
        "workspace-storage.json",
    }
)


class LegacyMigrationError(RuntimeError):
    """Raised before source deletion when a migration is not provably safe."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _inside(candidate: Path, parent: Path) -> bool:
    try:
        candidate.relative_to(parent)
        return True
    except ValueError:
        return False


def _safe_source(path: Path) -> None:
    resolved = path.resolve()
    forbidden = {
        Path(resolved.anchor),
        Path.home().resolve(),
        Path.cwd().resolve(),
    }
    if resolved in forbidden:
        raise LegacyMigrationError(
            f"拒绝迁移或删除高风险来源目录：{resolved}"
        )
    if not resolved.is_dir():
        raise LegacyMigrationError(f"旧数据目录不存在：{resolved}")


@dataclass(frozen=True)
class MigrationItem:
    source: Path
    source_relative: str
    destination_kind: str
    destination_relative: str
    size: int
    sha256: str

    def public(self) -> dict[str, object]:
        return {
            "source": self.source_relative,
            "destination_kind": self.destination_kind,
            "destination": self.destination_relative,
            "bytes": self.size,
            "sha256": self.sha256,
        }


@dataclass(frozen=True)
class MigrationPlan:
    migration_id: str
    source: Path
    workspace: Path
    cache: Path
    state: Path
    items: tuple[MigrationItem, ...]
    discarded: tuple[str, ...]
    unknown: tuple[str, ...]

    @property
    def total_bytes(self) -> int:
        return sum(item.size for item in self.items)

    @property
    def workspace_items(self) -> tuple[MigrationItem, ...]:
        return tuple(
            item
            for item in self.items
            if item.destination_kind.startswith("workspace-")
        )

    @property
    def cache_items(self) -> tuple[MigrationItem, ...]:
        return tuple(
            item
            for item in self.items
            if item.destination_kind == "device-cache"
        )

    def public(self) -> dict[str, object]:
        return {
            "migration_id": self.migration_id,
            "source": str(self.source),
            "workspace": str(self.workspace),
            "device_cache": str(self.cache),
            "device_state": str(self.state),
            "file_count": len(self.items),
            "total_bytes": self.total_bytes,
            "discarded": list(self.discarded),
            "unknown": list(self.unknown),
            "items": [item.public() for item in self.items],
        }


@dataclass(frozen=True)
class MigrationResult:
    plan: MigrationPlan
    source_deleted: bool
    report_path: Path

    def public(self) -> dict[str, object]:
        return {
            **self.plan.public(),
            "source_deleted": self.source_deleted,
            "report_path": str(self.report_path),
        }


def _classify(
    relative: Path,
) -> tuple[str, Path] | None:
    parts = relative.parts
    if not parts:
        return None
    if any(part in DISCARDED_METADATA for part in parts):
        return "discard", Path()
    first = parts[0]
    rest = Path(*parts[1:]) if len(parts) > 1 else Path()
    if first == "data" and parts[1:]:
        return _classify(rest)
    if first == "assets" and parts[1:]:
        return "workspace-assets", rest
    if first in {"media_previews", "media-previews"} and parts[1:]:
        return "device-cache", Path("media-previews") / rest
    if first == "models" and parts[1:]:
        return "device-cache", Path("models") / rest
    if first in WORKSPACE_DIRECTORIES and parts[1:]:
        return "workspace-data", relative
    if len(parts) == 1 and first in WORKSPACE_FILES:
        return "workspace-data", relative
    if first in ASSET_DIRECTORIES and parts[1:]:
        return "workspace-assets", relative
    if len(parts) == 1 and first in DEVICE_STATE_FILES:
        return "device-state-blocked", relative
    return None


def _iter_source_files(source: Path) -> Iterable[Path]:
    for root, directories, names in os.walk(source, followlinks=False):
        root_path = Path(root)
        for name in [*directories, *names]:
            candidate = root_path / name
            if candidate.is_symlink():
                raise LegacyMigrationError(
                    "旧数据目录包含符号链接，无法证明删除安全："
                    f"{candidate.relative_to(source)}"
                )
        for name in names:
            candidate = root_path / name
            if candidate.is_file():
                yield candidate


def _validate_destinations(
    source: Path,
    workspace: Path,
    cache: Path,
    state: Path,
) -> None:
    destinations = (
        ("目标工作区", workspace),
        ("Device Cache", cache),
        ("Device State", state),
    )
    for label, path in destinations:
        if path == Path(path.anchor) or path == Path.home().resolve():
            raise LegacyMigrationError(f"{label}不能是磁盘根目录或用户主目录")
        if _inside(path, source) or _inside(source, path):
            raise LegacyMigrationError(f"{label}不能与旧数据目录互相包含")
    for index, (left_label, left_path) in enumerate(destinations):
        for right_label, right_path in destinations[index + 1 :]:
            if _inside(left_path, right_path) or _inside(
                right_path,
                left_path,
            ):
                raise LegacyMigrationError(
                    f"{left_label}不能与{right_label}互相包含"
                )
    if workspace.exists():
        if not workspace.is_dir():
            raise LegacyMigrationError("目标工作区不是目录")
        if any(workspace.iterdir()):
            raise LegacyMigrationError("目标工作区必须不存在或为空目录")


def build_migration_plan(
    source: str | Path,
    workspace: str | Path,
    cache: str | Path,
    state: str | Path,
) -> MigrationPlan:
    source_path = Path(source).expanduser().resolve()
    workspace_path = Path(workspace).expanduser().resolve()
    cache_path = Path(cache).expanduser().resolve()
    state_path = Path(state).expanduser().resolve()
    _safe_source(source_path)
    _validate_destinations(
        source_path,
        workspace_path,
        cache_path,
        state_path,
    )

    items: list[MigrationItem] = []
    discarded: list[str] = []
    unknown: list[str] = []
    destinations: dict[tuple[str, str], MigrationItem] = {}
    for path in _iter_source_files(source_path):
        relative = path.relative_to(source_path)
        normalized = relative.as_posix()
        classified = _classify(relative)
        if classified is None:
            unknown.append(normalized)
            continue
        kind, destination = classified
        if kind == "discard":
            discarded.append(normalized)
            continue
        if kind == "device-state-blocked":
            unknown.append(
                f"{normalized}（设备状态不能通过工作区迁移脚本删除）"
            )
            continue
        item = MigrationItem(
            source=path,
            source_relative=normalized,
            destination_kind=kind,
            destination_relative=destination.as_posix(),
            size=path.stat().st_size,
            sha256=_sha256(path),
        )
        key = (kind, item.destination_relative)
        existing = destinations.get(key)
        if existing and (
            existing.size != item.size or existing.sha256 != item.sha256
        ):
            unknown.append(
                f"{normalized}（与 {existing.source_relative} 的目标冲突）"
            )
            continue
        if existing is None:
            destinations[key] = item
            items.append(item)

    return MigrationPlan(
        migration_id=uuid.uuid4().hex,
        source=source_path,
        workspace=workspace_path,
        cache=cache_path,
        state=state_path,
        items=tuple(items),
        discarded=tuple(sorted(discarded)),
        unknown=tuple(sorted(unknown)),
    )


def _copy_verified(source: Path, target: Path, expected: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    if _sha256(target) != expected:
        raise LegacyMigrationError(
            f"复制后校验失败：{source} -> {target}"
        )


def _workspace_target(stage: Path, item: MigrationItem) -> Path:
    root = (
        stage / "data"
        if item.destination_kind == "workspace-data"
        else stage / "assets"
    )
    return root.joinpath(*item.destination_relative.split("/"))


def _write_report(
    stage: Path,
    plan: MigrationPlan,
    *,
    source_deleted: bool,
) -> Path:
    report = (
        stage
        / "data"
        / "recovery"
        / "migrations"
        / f"{plan.migration_id}.json"
    )
    report.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        **plan.public(),
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "source_deleted": source_deleted,
    }
    report.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return report


def execute_migration(
    plan: MigrationPlan,
    *,
    delete_source: bool,
) -> MigrationResult:
    """Execute a pre-built plan and optionally remove the exact source."""

    if plan.unknown:
        raise LegacyMigrationError(
            "存在未识别或冲突文件，已取消迁移："
            + "；".join(plan.unknown[:10])
        )
    rebuilt = build_migration_plan(
        plan.source,
        plan.workspace,
        plan.cache,
        plan.state,
    )
    if (
        [(item.source_relative, item.sha256) for item in rebuilt.items]
        != [(item.source_relative, item.sha256) for item in plan.items]
        or rebuilt.discarded != plan.discarded
        or rebuilt.unknown
    ):
        raise LegacyMigrationError(
            "旧数据在预览后发生变化，请重新生成迁移计划"
        )

    plan.workspace.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(
        tempfile.mkdtemp(
            prefix=f".{plan.workspace.name}.migration-",
            dir=str(plan.workspace.parent),
        )
    )
    cache_stage_parent = plan.cache.parent
    cache_stage_parent.mkdir(parents=True, exist_ok=True)
    cache_stage = Path(
        tempfile.mkdtemp(
            prefix=".infinite-canvas-cache-migration-",
            dir=str(cache_stage_parent),
        )
    )
    created_cache_files: list[Path] = []
    state_backup: bytes | None = None
    state_target = plan.state / "provider-connections.json"
    state_existed = state_target.is_file()
    published = False
    source_quarantine: Path | None = None
    deletion_started = False
    try:
        for item in plan.workspace_items:
            _copy_verified(
                item.source,
                _workspace_target(stage, item),
                item.sha256,
            )
        for item in plan.cache_items:
            _copy_verified(
                item.source,
                cache_stage.joinpath(
                    *item.destination_relative.split("/")
                ),
                item.sha256,
            )

        shared_settings = stage / "data" / "api_providers.json"
        staged_connections = stage / ".device-state" / "provider-connections.json"
        if shared_settings.is_file():
            if state_target.is_file():
                staged_connections.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(state_target, staged_connections)
            GenerationSettingsService(
                shared_settings,
                staged_connections,
            ).load()

        workspace_id = str(uuid.uuid4())
        (stage / ".infinite-canvas-workspace.json").write_text(
            json.dumps(
                {"version": 1, "workspace_id": workspace_id},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        InstanceState(plan.state).prepare_auth_database(
            workspace_directory=stage,
            workspace_id=workspace_id,
        )

        for item in plan.cache_items:
            staged = cache_stage.joinpath(
                *item.destination_relative.split("/")
            )
            destination = plan.cache.joinpath(
                *item.destination_relative.split("/")
            )
            if destination.exists():
                if (
                    not destination.is_file()
                    or _sha256(destination) != item.sha256
                ):
                    raise LegacyMigrationError(
                        f"Device Cache 中存在不同内容：{destination}"
                    )
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(
                f".{destination.name}.{plan.migration_id}.tmp"
            )
            shutil.copy2(staged, temporary)
            os.replace(temporary, destination)
            created_cache_files.append(destination)

        if staged_connections.is_file():
            state_target.parent.mkdir(parents=True, exist_ok=True)
            state_backup = (
                state_target.read_bytes() if state_target.is_file() else None
            )
            temporary = state_target.with_name(
                f".{state_target.name}.{plan.migration_id}.tmp"
            )
            shutil.copy2(staged_connections, temporary)
            try:
                temporary.chmod(0o600)
            except OSError:
                pass
            os.replace(temporary, state_target)

        _write_report(stage, plan, source_deleted=False)
        shutil.rmtree(stage / ".device-state", ignore_errors=True)
        if plan.workspace.exists():
            plan.workspace.rmdir()
        os.replace(stage, plan.workspace)
        published = True

        if delete_source:
            source_quarantine = plan.source.with_name(
                f".{plan.source.name}.migrated-{plan.migration_id}"
            )
            os.replace(plan.source, source_quarantine)
            deletion_started = True
            shutil.rmtree(source_quarantine)
            source_quarantine = None

        report_path = (
            plan.workspace
            / "data"
            / "recovery"
            / "migrations"
            / f"{plan.migration_id}.json"
        )
        if delete_source:
            report_payload = json.loads(report_path.read_text(encoding="utf-8"))
            report_payload["source_deleted"] = True
            report_path.write_text(
                json.dumps(report_payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        return MigrationResult(
            plan=plan,
            source_deleted=delete_source,
            report_path=report_path,
        )
    except Exception:
        if (
            source_quarantine is not None
            and source_quarantine.exists()
            and not deletion_started
        ):
            if not plan.source.exists():
                os.replace(source_quarantine, plan.source)
        if (
            published
            and plan.workspace.exists()
            and plan.source.exists()
            and not deletion_started
        ):
            shutil.rmtree(plan.workspace, ignore_errors=True)
        if not deletion_started:
            for path in reversed(created_cache_files):
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass
            if state_backup is not None:
                state_target.write_bytes(state_backup)
            elif not state_existed:
                try:
                    state_target.unlink()
                except FileNotFoundError:
                    pass
        raise
    finally:
        if stage.exists():
            shutil.rmtree(stage, ignore_errors=True)
        if cache_stage.exists():
            shutil.rmtree(cache_stage, ignore_errors=True)


__all__ = [
    "LegacyMigrationError",
    "MigrationItem",
    "MigrationPlan",
    "MigrationResult",
    "build_migration_plan",
    "execute_migration",
]
