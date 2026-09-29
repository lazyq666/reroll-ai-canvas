#!/usr/bin/env python3
"""Provision/join Turso handoff without putting credentials in command arguments."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from infinite_canvas.device_state import DeviceState
from infinite_canvas.handoff_coordinator import OnlineHandoff
from infinite_canvas.workspace_handoff import HandoffError, WorkspaceHandoff
from infinite_canvas.workspace_storage import WorkspaceStorage, application_state_directory
from infinite_canvas.workspace import WorkspaceService, _OCCUPATION_GUARD, _try_exclusive_file_lock, _release_file_lock


def configure(storage, credentials, *, initialize=False, handoff_id=""):
    service = WorkspaceService(storage)
    workspace = service.current()
    identity = service.identity(workspace.directory)
    if not identity:
        raise HandoffError("invalid")
    device = DeviceState(storage.state_dir)
    h = WorkspaceHandoff(workspace.directory, storage.state_dir, identity, device.server_identity())
    online = OnlineHandoff(h, settings={"version": 1, "workspace_id": identity,
                                      "url": credentials["url"], "token": credentials["token"]})
    if initialize:
        # A running server holds this lock; enrollment can never mutate its
        # admission state behind its back. Existing manual seals still need
        # the independently obtained code on first enrollment.
        occupation = service.acquire_occupation(h.server_id, handoff_id=handoff_id)
        try:
            online.register.prepare_schema()
            online.enroll()
        finally:
            occupation.release()
    else:
        # Pairing and token rotation must not modify admission behind a running
        # local server. Do not claim cloud ownership merely to install secrets.
        h.control.mkdir(parents=True, exist_ok=True)
        with (h.control / _OCCUPATION_GUARD).open("a+b") as guard:
            if not _try_exclusive_file_lock(guard):
                raise HandoffError("occupied")
            try:
                online.register.read()  # Never create an authority from a second copy.
                online.install()
            finally:
                _release_file_lock(guard)
    device.remember_workspace_identity(identity)
    return {"workspace_id": identity, "configured": True, "initialized": initialize}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-directory", type=Path)
    parser.add_argument("--connection-file", type=Path)
    parser.add_argument("--initialize", action="store_true")
    parser.add_argument("--handoff-id", default="")
    args = parser.parse_args()
    state = args.state_directory or application_state_directory(ROOT)
    source = args.connection_file or state / "handoff-service.json"
    try:
        if source.is_symlink():
            raise HandoffError("onlineConfiguration")
        credentials = json.loads(source.read_text())
        result = configure(WorkspaceStorage(ROOT, state_dir=state), credentials,
                           initialize=args.initialize, handoff_id=args.handoff_id)
        print(json.dumps(result))
    except Exception as exc:
        # Do not expose raw connection errors or submitted credentials.
        print(getattr(exc, "code", "handoff.onlineConfiguration"), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
