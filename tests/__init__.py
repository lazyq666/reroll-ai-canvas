"""Test support package with the backend source root on ``sys.path``."""

from __future__ import annotations

import os
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
_python_path = [
    str(BACKEND_ROOT),
    *filter(None, os.environ.get("PYTHONPATH", "").split(os.pathsep)),
]
os.environ["PYTHONPATH"] = os.pathsep.join(dict.fromkeys(_python_path))
