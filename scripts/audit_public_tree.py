#!/usr/bin/env python3
"""Fail when the tracked tree contains common public-release blockers."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAX_GIT_BLOB_BYTES = 100 * 1024 * 1024
ALLOWED_SENSITIVE_NAMES = {".env.example"}
FORBIDDEN_DOCUMENT_SURFACES = (
    "docs/active/infinite-canvas-ui-tasks/",
    "docs/superpowers/",
    "exports/",
)
FORBIDDEN_TRACKED_SURFACES = (
    ".agents/",
    ".codex/",
    ".scratch/",
    ".worktrees/",
)
REQUIRED_PUBLIC_FILES = (
    "LICENSE",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "THIRD_PARTY_NOTICES.md",
    "requirements.lock.txt",
)

TEXT_PATTERNS = (
    ("private key", re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")),
    ("AWS access key", re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("GitHub token", re.compile(rb"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b")),
    ("Slack token", re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{20,}\b")),
    ("Google API key", re.compile(rb"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("long sk-style token", re.compile(rb"\bsk-[A-Za-z0-9_-]{32,}\b")),
    ("credentialed database URL", re.compile(rb"\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://[^\s:/]+:[^\s/@]+@")),
    ("personal macOS path", re.compile(rb"/" rb"Users/(?!you(?:/|\b)|demo(?:/|\b)|example(?:/|\b))[^/\s]+/")),
)


def tracked_files() -> list[Path]:
    completed = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        check=True,
    )
    return [ROOT / item.decode("utf-8") for item in completed.stdout.split(b"\0") if item]


def gitlinks_from_stage_output(output: bytes) -> list[str]:
    gitlinks: list[str] = []
    for item in output.split(b"\0"):
        if not item:
            continue
        metadata, relative = item.split(b"\t", 1)
        mode = metadata.split(b" ", 1)[0]
        if mode == b"160000":
            gitlinks.append(relative.decode("utf-8"))
    return gitlinks


def tracked_gitlinks() -> list[str]:
    completed = subprocess.run(
        ["git", "ls-files", "--stage", "-z"],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        check=True,
    )
    return gitlinks_from_stage_output(completed.stdout)


def audit() -> list[str]:
    failures: list[str] = []
    relative_paths: list[str] = []

    for relative in tracked_gitlinks():
        failures.append(f"tracked Gitlink/submodule is not allowed: {relative}")

    for path in tracked_files():
        relative = path.relative_to(ROOT).as_posix()
        if not path.is_file():
            continue
        if any(relative.startswith(prefix) for prefix in FORBIDDEN_TRACKED_SURFACES):
            failures.append(f"tracked local tooling surface: {relative}")
        relative_paths.append(relative)

        if any(relative.startswith(prefix) for prefix in FORBIDDEN_DOCUMENT_SURFACES):
            failures.append(f"forbidden completed/internal surface: {relative}")

        if path.name.startswith(".env") and path.name not in ALLOWED_SENSITIVE_NAMES:
            failures.append(f"tracked environment file: {relative}")
        if path.suffix.lower() in {".pem", ".p12", ".pfx"}:
            failures.append(f"tracked credential container: {relative}")

        try:
            size = path.stat().st_size
            data = path.read_bytes()
        except OSError as exc:
            failures.append(f"cannot inspect {relative}: {exc}")
            continue

        if size > MAX_GIT_BLOB_BYTES:
            failures.append(f"tracked file exceeds GitHub's 100 MiB limit: {relative}")
        if b"\0" in data[:8192]:
            continue

        for label, pattern in TEXT_PATTERNS:
            if pattern.search(data):
                failures.append(f"{label}: {relative}")

    tracked = set(relative_paths)
    for required in REQUIRED_PUBLIC_FILES:
        if required not in tracked:
            failures.append(f"missing public-readiness file: {required}")

    return sorted(set(failures))


def main() -> int:
    failures = audit()
    if failures:
        print("Public-tree audit failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("Public-tree audit passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
