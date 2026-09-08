"""Resume a verified cloud-to-local export after a stopped-process failure.

Run with the application stopped. This command never reactivates cloud storage
or exports an earlier local database. It only finishes a durable return journal.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))

from infinite_canvas.content import WorkspaceContent
from infinite_canvas.device_state import DeviceState
from infinite_canvas.storage_authority import resolve_storage_authority
from infinite_canvas.turso_sqlite import TursoError
from infinite_canvas.turso_switch import CloudStorageSwitch
from infinite_canvas.workspace import WorkspaceService
from infinite_canvas.workspace_storage import WorkspaceStorage, application_state_directory


def main():
    state = application_state_directory(ROOT)
    service = WorkspaceService(WorkspaceStorage(ROOT, state_dir=state))
    with service.acquire_occupation(DeviceState(state).server_identity(), remote_authority=True):
        content = WorkspaceContent(service.current())
        authority = resolve_storage_authority(content.storage_authority, service.identity(), supported_modes=('turso',))
        result = CloudStorageSwitch(content, workspace_id=service.identity(), state_directory=state).resume_return(authority.binding_id)
        if result is None:
            raise TursoError('cloud_storage_binding_invalid')
        print(json.dumps(result))


if __name__ == '__main__':
    main()
