#!/usr/bin/env python3
"""Verify the frozen Web Awesome package against its official npm archive."""

from __future__ import annotations

import base64
import hashlib
import json
import sys
import tarfile
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
RELEASE_ROOT = ROOT / "static" / "vendor" / "webawesome" / "3.10.0"
METADATA_PATH = RELEASE_ROOT / "release.json"


def digest(path: Path, algorithm: str) -> str:
    hasher = hashlib.new(algorithm)
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def verify_release() -> dict[str, object]:
    metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    archive_path = RELEASE_ROOT / metadata["archive"]
    package_root = RELEASE_ROOT / metadata["packageRoot"]

    actual_sha256 = digest(archive_path, "sha256")
    actual_sha512 = digest(archive_path, "sha512")
    actual_sha1 = digest(archive_path, "sha1")
    actual_integrity = "sha512-" + base64.b64encode(
        bytes.fromhex(actual_sha512)
    ).decode("ascii")

    expected_hashes = {
        "archiveSha256": actual_sha256,
        "archiveSha512": actual_sha512,
        "npmIntegrity": actual_integrity,
        "npmShasum": actual_sha1,
    }
    for field, actual in expected_hashes.items():
        if metadata[field] != actual:
            raise ValueError(f"{field} mismatch: expected {metadata[field]}, got {actual}")

    with tarfile.open(archive_path, "r:gz") as archive:
        archived: dict[str, tarfile.TarInfo] = {}
        for member in archive.getmembers():
            member_path = PurePosixPath(member.name)
            if not member_path.parts or member_path.parts[0] != "package":
                raise ValueError(f"unexpected archive path: {member.name}")
            if member.isfile():
                relative = PurePosixPath(*member_path.parts[1:]).as_posix()
                archived[relative] = member

        installed = {
            path.relative_to(package_root).as_posix(): path
            for path in package_root.rglob("*")
            if path.is_file()
        }
        if archived.keys() != installed.keys():
            missing = sorted(archived.keys() - installed.keys())
            extra = sorted(installed.keys() - archived.keys())
            raise ValueError(
                f"package file set mismatch: missing={missing[:5]}, extra={extra[:5]}"
            )

        for relative, member in archived.items():
            archived_file = archive.extractfile(member)
            if archived_file is None:
                raise ValueError(f"cannot read archived file: {relative}")
            expected = hashlib.sha256(archived_file.read()).digest()
            actual = hashlib.sha256(installed[relative].read_bytes()).digest()
            if actual != expected:
                raise ValueError(f"package file differs from archive: {relative}")

    package = json.loads((package_root / "package.json").read_text(encoding="utf-8"))
    if package["name"] != metadata["package"]:
        raise ValueError("package name does not match release metadata")
    if package["version"] != metadata["version"]:
        raise ValueError("package version does not match release metadata")
    if package["license"] != metadata["license"]:
        raise ValueError("package license does not match release metadata")
    if not (package_root / "LICENSE.md").is_file():
        raise ValueError("MIT license file is missing")
    if len(installed) != metadata["expectedFileCount"]:
        raise ValueError(
            f"file count mismatch: expected {metadata['expectedFileCount']}, got {len(installed)}"
        )

    return {
        "package": package["name"],
        "version": package["version"],
        "license": package["license"],
        "archiveFiles": len(archived),
        "installedFiles": len(installed),
        "sha256": actual_sha256,
        "npmIntegrity": actual_integrity,
        "runtimeDistribution": metadata["runtimeDistribution"],
    }


def main() -> int:
    try:
        print(json.dumps(verify_release(), ensure_ascii=False, sort_keys=True))
    except Exception as error:  # pragma: no cover - CLI failure path
        print(f"Web Awesome vendor verification failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
