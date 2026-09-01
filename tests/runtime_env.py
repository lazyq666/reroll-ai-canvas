"""Deterministic explicit workspace for tests that import the application."""

from __future__ import annotations

import atexit
import importlib
import os
import sys
import tempfile
from pathlib import Path

from infinite_canvas.workspace_storage import WorkspaceStorage


_RUNTIME = tempfile.TemporaryDirectory(prefix="infinite-canvas-tests-")
atexit.register(_RUNTIME.cleanup)
ROOT = Path(_RUNTIME.name)
DATA_DIR = ROOT / "workspace" / "data"
ASSETS_DIR = ROOT / "workspace" / "assets"
STATE_DIR = ROOT / "state"
CACHE_DIR = ROOT / "cache"
DATA_DIR.mkdir(parents=True, exist_ok=True)
ASSETS_DIR.mkdir(parents=True, exist_ok=True)
STATE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def ensure_test_workspace() -> None:
    os.environ.setdefault("INFINITE_CANVAS_STATE_DIR", str(STATE_DIR))
    os.environ.setdefault("INFINITE_CANVAS_CACHE_DIR", str(CACHE_DIR))
    state = Path(os.environ["INFINITE_CANVAS_STATE_DIR"])
    state.mkdir(parents=True, exist_ok=True)
    WorkspaceStorage(ROOT / "installation", state_dir=state).save_parent(
        ROOT / "workspace"
    )
    os.environ.pop("INFINITE_CANVAS_DATA_DIR", None)
    os.environ.pop("INFINITE_CANVAS_ASSETS_DIR", None)


def configure_test_workspace(workspace: Path, state: Path) -> None:
    workspace = Path(workspace)
    state = Path(state)
    (workspace / "data").mkdir(parents=True, exist_ok=True)
    (workspace / "assets").mkdir(parents=True, exist_ok=True)
    state.mkdir(parents=True, exist_ok=True)
    os.environ["INFINITE_CANVAS_CACHE_DIR"] = str(state.parent / "cache")
    WorkspaceStorage(
        workspace.parent / "installation",
        state_dir=state,
    ).save_parent(workspace)


def unload_main() -> None:
    """Release the imported application's Workspace before re-import tests."""

    module = sys.modules.get("main")
    release = getattr(module, "release_workspace_occupation", None)
    if callable(release):
        release()
    sys.modules.pop("main", None)


def import_fresh_main():
    """Import the app against the deterministic workspace after prior isolation tests."""

    ensure_test_workspace()
    unload_main()
    return importlib.import_module("main")
