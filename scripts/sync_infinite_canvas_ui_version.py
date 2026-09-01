#!/usr/bin/env python3
"""Generate and synchronize the Infinite Canvas UI asset version."""

import argparse
import hashlib
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UI_ROOT = ROOT / "static" / "js" / "infinite-canvas-ui"
VERSION_FILE = UI_ROOT / "VERSION"
FINGERPRINT_STYLES = (
    ROOT / "static" / "css" / "design-tokens.css",
    ROOT / "static" / "css" / "webawesome-engine.css",
)
SCAN_ROOTS = (ROOT / "static", ROOT / "backend", ROOT / "tests")
SOURCE_SUFFIXES = {".html", ".js", ".py"}
VERSIONED_MODULE_PATTERN = re.compile(
    r"(?P<prefix>(?P<specifier>(?:/static/js/infinite-canvas-ui/|\.\.?/)"
    r"[^\"'`\s?<>]+\.js)\?v=)(?P<version>[^\"'`\s)<>;]+)"
)


def is_ui_module_reference(path: Path, match: re.Match) -> bool:
    specifier = match.group("specifier")
    if specifier.startswith("/static/js/infinite-canvas-ui/"):
        return True
    if not path.is_relative_to(UI_ROOT):
        return False

    target = (path.parent / specifier).resolve()
    return target.is_relative_to(UI_ROOT)


def replace_ui_versions(path: Path, source: str, version: str) -> str:
    def replacement(match: re.Match) -> str:
        if not is_ui_module_reference(path, match):
            return match.group(0)
        return f"{match.group('prefix')}{version}"

    return VERSIONED_MODULE_PATTERN.sub(replacement, source)


def fingerprint_sources():
    paths = list(UI_ROOT.rglob("*.js"))
    paths.extend(path for path in FINGERPRINT_STYLES if path.exists())
    return sorted(paths, key=lambda path: path.relative_to(ROOT).as_posix())


def generated_version() -> str:
    digest = hashlib.sha256()
    for path in fingerprint_sources():
        relative_path = path.relative_to(ROOT).as_posix()
        source = path.read_text(encoding="utf-8")
        normalized = replace_ui_versions(path, source, "<IC_UI_VERSION>")
        digest.update(relative_path.encode("utf-8"))
        digest.update(b"\0")
        digest.update(normalized.encode("utf-8"))
        digest.update(b"\0")
    return f"ic-ui-{digest.hexdigest()[:12]}"


def source_files():
    for directory in SCAN_ROOTS:
        for path in directory.rglob("*"):
            if path.is_file() and path.suffix in SOURCE_SUFFIXES:
                yield path


def mismatched_references(version: str):
    mismatches = []
    for path in source_files():
        source = path.read_text(encoding="utf-8")
        for match in VERSIONED_MODULE_PATTERN.finditer(source):
            if not is_ui_module_reference(path, match):
                continue
            if match.group("version") != version:
                mismatches.append(
                    f"{path.relative_to(ROOT)}: {match.group('specifier')}?v={match.group('version')}"
                )
    return mismatches


def check(version: str) -> int:
    current = VERSION_FILE.read_text(encoding="utf-8").strip() if VERSION_FILE.exists() else ""
    errors = []
    if current != version:
        errors.append(f"{VERSION_FILE.relative_to(ROOT)}: expected {version}, found {current or '<missing>'}")
    errors.extend(mismatched_references(version))
    if errors:
        print("Infinite Canvas UI asset version is out of sync:")
        for error in errors:
            print(f"- {error}")
        print("Run: python3 scripts/sync_infinite_canvas_ui_version.py")
        return 1

    print(f"Infinite Canvas UI asset version is current: {version}")
    return 0


def synchronize(version: str) -> int:
    changed = []
    for path in source_files():
        source = path.read_text(encoding="utf-8")
        updated = replace_ui_versions(path, source, version)
        if updated != source:
            path.write_text(updated, encoding="utf-8")
            changed.append(path.relative_to(ROOT).as_posix())

    previous = VERSION_FILE.read_text(encoding="utf-8").strip() if VERSION_FILE.exists() else ""
    if previous != version:
        VERSION_FILE.write_text(f"{version}\n", encoding="utf-8")
        changed.append(VERSION_FILE.relative_to(ROOT).as_posix())

    print(f"Infinite Canvas UI asset version: {version}")
    print(f"Updated {len(changed)} file(s).")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail when the generated version is not synchronized")
    args = parser.parse_args()
    version = generated_version()
    return check(version) if args.check else synchronize(version)


if __name__ == "__main__":
    raise SystemExit(main())
