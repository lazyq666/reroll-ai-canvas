"""Workspace-owned generated artifacts and maintenance locations."""

from __future__ import annotations

from pathlib import Path

from .workspace import Workspace


APPLICATION_UPDATE_ROOT_FILES = frozenset(
    {
        "VERSION",
        "backend/launcher.py",
        "backend/main.py",
        "requirements.lock.txt",
        "requirements.txt",
    }
)
APPLICATION_UPDATE_RUNTIME_FILES = frozenset(
    {
        "backend/infinite_canvas/__init__.py",
        "backend/infinite_canvas/__main__.py",
        "backend/infinite_canvas/api_settings_transfer.py",
        "backend/infinite_canvas/app.py",
        "backend/infinite_canvas/asset_library.py",
        "backend/infinite_canvas/artifacts.py",
        "backend/infinite_canvas/auth_system.py",
        "backend/infinite_canvas/batch_generation.py",
        "backend/infinite_canvas/bootstrap.py",
        "backend/infinite_canvas/canvas_permissions.py",
        "backend/infinite_canvas/canvas_list_index.py",
        "backend/infinite_canvas/canvas_opening.py",
        "backend/infinite_canvas/canvas_realtime.py",
        "backend/infinite_canvas/canvas_sync.py",
        "backend/infinite_canvas/cli_updates.py",
        "backend/infinite_canvas/connection_manager.py",
        "backend/infinite_canvas/realtime_presence.py",
        "backend/infinite_canvas/content.py",
        "backend/infinite_canvas/controlled_storage_migration.py",
        "backend/infinite_canvas/device_cache.py",
        "backend/infinite_canvas/device_state.py",
        "backend/infinite_canvas/design_tokens.py",
        "backend/infinite_canvas/generation_runs.py",
        "backend/infinite_canvas/generation_publication.py",
        "backend/infinite_canvas/generation_run_store.py",
        "backend/infinite_canvas/generation_settings.py",
        "backend/infinite_canvas/image_capabilities.py",
        "backend/infinite_canvas/installation.py",
        "backend/infinite_canvas/instance_state.py",
        "backend/infinite_canvas/legacy_migration.py",
        "backend/infinite_canvas/legacy_generation_archive.py",
        "backend/infinite_canvas/matting_capacity.py",
        "backend/infinite_canvas/matting_service.py",
        "backend/infinite_canvas/media.py",
        "backend/infinite_canvas/model_capabilities.py",
        "backend/infinite_canvas/model_capability_matrix.py",
        "backend/infinite_canvas/model_capability_discovery.py",
        "backend/infinite_canvas/model_capability_workbench.py",
        "backend/infinite_canvas/outbound_security.py",
        "backend/infinite_canvas/providers/__init__.py",
        "backend/infinite_canvas/providers/cli_impl.py",
        "backend/infinite_canvas/providers/comfyui_impl.py",
        "backend/infinite_canvas/providers/core.py",
        "backend/infinite_canvas/providers/http_impl.py",
        "backend/infinite_canvas/providers/implementation.py",
        "backend/infinite_canvas/providers/inspection_impl.py",
        "backend/infinite_canvas/providers/inspector.py",
        "backend/infinite_canvas/providers/modelscope_impl.py",
        "backend/infinite_canvas/providers/ports.py",
        "backend/infinite_canvas/providers/runninghub_impl.py",
        "backend/infinite_canvas/providers/runtime.py",
        "backend/infinite_canvas/prompt_library.py",
        "backend/infinite_canvas/runtime.py",
        "backend/infinite_canvas/offline_sqlite_migration.py",
        "backend/infinite_canvas/sqlite_authority_publish.py",
        "backend/infinite_canvas/sqlite_legacy_export.py",
        "backend/infinite_canvas/sqlite_migration.py",
        "backend/infinite_canvas/sqlite_publication_upgrade.py",
        "backend/infinite_canvas/sqlite_workspace_bootstrap.py",
        "backend/infinite_canvas/storage_authority.py",
        "backend/infinite_canvas/video_capabilities.py",
        "backend/infinite_canvas/workspace.py",
        "backend/infinite_canvas/workspace_storage.py",
        "backend/infinite_canvas/workspace_storage_composition.py",
        "backend/scripts/__init__.py",
        "backend/scripts/admin/__init__.py",
        "backend/scripts/admin/manage_users.py",
        "backend/scripts/migrate_legacy_data.py",
    }
)
APPLICATION_UPDATE_FILES = (
    APPLICATION_UPDATE_ROOT_FILES | APPLICATION_UPDATE_RUNTIME_FILES
)


class WorkspaceArtifacts:
    """Resolve generated, cached, and maintenance files for one Workspace."""

    def __init__(self, workspace: Workspace) -> None:
        self._workspace = workspace

    @property
    def managed_media(self) -> Path:
        return self._workspace.managed_media

    @property
    def generation_inputs(self) -> Path:
        return self._workspace.generation_inputs

    @property
    def generation_outputs(self) -> Path:
        return self._workspace.generation_outputs

    @property
    def local_uploads(self) -> Path:
        return self._workspace.local_uploads

    @property
    def available_models(self) -> Path:
        return self._workspace.available_models

    @property
    def update_staging(self) -> Path:
        return self._workspace.update_staging

    @property
    def update_backups(self) -> Path:
        return self._workspace.update_backups

    @property
    def recovery_copies(self) -> Path:
        return self._workspace.recovery_copies

    def ensure_directories(self) -> tuple[Path, ...]:
        directories = (
            self.managed_media,
            self.generation_inputs,
            self.generation_outputs,
            self.local_uploads,
        )
        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)
        return directories

    @staticmethod
    def is_update_backup_file(path: object) -> bool:
        relative = str(path or "").replace("\\", "/").lstrip("/")
        if (
            not relative
            or any(
                part in {"", ".", ".."}
                for part in relative.split("/")
            )
        ):
            return False
        return (
            relative in APPLICATION_UPDATE_FILES
            or relative.startswith(
                ("static/", "resources/", "backend/scripts/")
            )
        )


__all__ = [
    "APPLICATION_UPDATE_FILES",
    "APPLICATION_UPDATE_ROOT_FILES",
    "APPLICATION_UPDATE_RUNTIME_FILES",
    "WorkspaceArtifacts",
]
