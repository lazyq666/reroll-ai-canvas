#!/usr/bin/env python3
"""Generate and synchronize the Account Avatar asset-graph version."""

import argparse
import hashlib
import re
import urllib.parse
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AVATAR_ROOT = ROOT / "static" / "images" / "avatars"
VERSION_FILE = AVATAR_ROOT / "VERSION"
TEXT_SOURCES = (
    ROOT / "static" / "js" / "account-avatar.js",
    ROOT / "static" / "css" / "account-avatar.css",
    ROOT / "static" / "js" / "canvas-list-presence.js",
    ROOT / "static" / "js" / "smart-canvas" / "realtime-presence.js",
)
REFERENCE_PATHS = (
    "/static/css/account-avatar.css",
    "/static/images/avatars/manifest.json",
    "/static/js/account-avatar.js",
    "/static/js/canvas-list-presence.js",
    "/static/js/smart-canvas/realtime-presence.js",
)
REFERENCE_PATTERN = re.compile(
    rf"(?P<path>{'|'.join(re.escape(path) for path in REFERENCE_PATHS)})"
    r"(?P<query>\?[^\"'`\s)<>]*)?"
)
RUNTIME_VERSION_PATTERN = re.compile(
    r"(?P<prefix>const ASSET_VERSION = ['\"])(?P<version>[^'\"]+)(?P<suffix>['\"];?)"
)
SOURCE_SUFFIXES = {".css", ".html", ".js"}


def replace_query_version(match: re.Match, version: str) -> str:
    parts = [part for part in (match.group("query") or "")[1:].split("&") if part]
    parts = [
        part
        for part in parts
        if urllib.parse.unquote_plus(part.partition("=")[0]) != "v"
    ]
    parts.append(f"v={version}")
    return f"{match.group('path')}?{'&'.join(parts)}"


def normalize_text(source: str) -> str:
    normalized = REFERENCE_PATTERN.sub(
        lambda match: replace_query_version(match, "<ACCOUNT_AVATAR_VERSION>"),
        source,
    )
    return RUNTIME_VERSION_PATTERN.sub(
        lambda match: (
            f"{match.group('prefix')}<ACCOUNT_AVATAR_VERSION>"
            f"{match.group('suffix')}"
        ),
        normalized,
    )


def fingerprint_sources() -> list[Path]:
    sources = list(TEXT_SOURCES)
    sources.extend(sorted(AVATAR_ROOT.glob("*.json")))
    sources.extend(sorted(AVATAR_ROOT.glob("*.png")))
    return sorted(sources, key=lambda path: path.relative_to(ROOT).as_posix())


def generated_version() -> str:
    digest = hashlib.sha256()
    for path in fingerprint_sources():
        relative = path.relative_to(ROOT).as_posix()
        content = path.read_bytes()
        if path.suffix in {".css", ".js", ".json"}:
            content = normalize_text(content.decode("utf-8")).encode("utf-8")
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(content)
        digest.update(b"\0")
    return f"account-avatar-{digest.hexdigest()[:12]}"


def source_files():
    for path in (ROOT / "static").rglob("*"):
        if path.is_file() and path.suffix in SOURCE_SUFFIXES:
            yield path


def updated_source(source: str, version: str) -> str:
    updated = REFERENCE_PATTERN.sub(
        lambda match: replace_query_version(match, version),
        source,
    )
    return RUNTIME_VERSION_PATTERN.sub(
        lambda match: (
            f"{match.group('prefix')}{version}{match.group('suffix')}"
        ),
        updated,
    )


def mismatches(version: str) -> list[str]:
    errors = []
    for path in source_files():
        source = path.read_text(encoding="utf-8")
        if updated_source(source, version) != source:
            errors.append(path.relative_to(ROOT).as_posix())
    return errors


def check(version: str) -> int:
    current = VERSION_FILE.read_text(encoding="utf-8").strip() if VERSION_FILE.exists() else ""
    errors = []
    if current != version:
        errors.append(
            f"{VERSION_FILE.relative_to(ROOT)}: expected {version}, found {current or '<missing>'}"
        )
    errors.extend(mismatches(version))
    if errors:
        print("Account Avatar asset version is out of sync:")
        for error in errors:
            print(f"- {error}")
        print("Run: python3 scripts/sync_account_avatar_asset_version.py")
        return 1
    print(f"Account Avatar asset version is current: {version}")
    return 0


def synchronize(version: str) -> int:
    changed = []
    for path in source_files():
        source = path.read_text(encoding="utf-8")
        updated = updated_source(source, version)
        if updated != source:
            path.write_text(updated, encoding="utf-8")
            changed.append(path.relative_to(ROOT).as_posix())
    previous = VERSION_FILE.read_text(encoding="utf-8").strip() if VERSION_FILE.exists() else ""
    if previous != version:
        VERSION_FILE.write_text(f"{version}\n", encoding="utf-8")
        changed.append(VERSION_FILE.relative_to(ROOT).as_posix())
    print(f"Account Avatar asset version: {version}")
    print(f"Updated {len(changed)} file(s).")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    version = generated_version()
    return check(version) if args.check else synchronize(version)


if __name__ == "__main__":
    raise SystemExit(main())
