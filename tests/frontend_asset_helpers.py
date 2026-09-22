"""Expected generated URLs for non-cache product contract assertions."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def asset_version(path):
    return json.loads((ROOT / 'static/frontend-assets.json').read_text())['assets'][path.lstrip('/')]['version']


def asset_url(path):
    return path + '?v=' + asset_version(path)
