"""Shared Account Avatar asset manifest authority."""

from __future__ import annotations

import json
import secrets
from pathlib import Path
from typing import Any


AVATAR_ASSET_DIRECTORY = (
    Path(__file__).resolve().parents[2] / "static" / "images" / "avatars"
)
AVATAR_ASSET_MANIFEST_PATH = AVATAR_ASSET_DIRECTORY / "manifest.json"


def _load_avatar_assets() -> tuple[str, ...]:
    payload: Any = json.loads(
        AVATAR_ASSET_MANIFEST_PATH.read_text(encoding="utf-8")
    )
    assets = payload.get("assets") if isinstance(payload, dict) else None
    if not isinstance(assets, list):
        raise RuntimeError("Account Avatar manifest must contain an assets list")
    normalized = tuple(str(asset or "").strip() for asset in assets)
    if len(normalized) != 32 or len(set(normalized)) != len(normalized):
        raise RuntimeError("Account Avatar manifest must contain 32 unique assets")
    for asset in normalized:
        if Path(asset).name != asset or not asset.endswith(".png"):
            raise RuntimeError(f"Invalid Account Avatar key: {asset}")
        if not (AVATAR_ASSET_DIRECTORY / asset).is_file():
            raise RuntimeError(f"Missing Account Avatar asset: {asset}")
    return normalized


AVATAR_ASSETS = _load_avatar_assets()
AVATAR_ASSET_SET = frozenset(AVATAR_ASSETS)


def random_avatar_asset(*, excluding: str = "") -> str:
    candidates = tuple(asset for asset in AVATAR_ASSETS if asset != excluding)
    return secrets.choice(candidates or AVATAR_ASSETS)


__all__ = [
    "AVATAR_ASSETS",
    "AVATAR_ASSET_DIRECTORY",
    "AVATAR_ASSET_MANIFEST_PATH",
    "AVATAR_ASSET_SET",
    "random_avatar_asset",
]
