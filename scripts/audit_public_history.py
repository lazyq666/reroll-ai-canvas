#!/usr/bin/env python3
"""Audit blobs and paths reachable from Git refs before making them public."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

from audit_public_tree import MAX_GIT_BLOB_BYTES, TEXT_PATTERNS


ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_HISTORY_PREFIXES = (
    ".agents/",
    ".codex/",
    ".scratch/",
    ".worktrees/",
    "data/",
    "docs/active/infinite-canvas-ui-tasks/",
    "docs/superpowers/",
    "exports/",
    "local-state/",
    "logs/",
    "packages/",
    "python/",
)
FORBIDDEN_HISTORY_NAMES = {
    ".netrc",
    ".npmrc",
    ".pypirc",
    "global_config.json",
    "openai-gpt-account-auth.json",
}
SENSITIVE_SUFFIXES = {".jks", ".key", ".keystore", ".p12", ".pem", ".pfx"}
COMMIT_IDENTITY = re.compile(
    rb"^(author|committer) .+ <([^<>]+)> [0-9]+ [+-][0-9]{4}$",
    re.MULTILINE,
)
ALLOWED_COMMIT_EMAIL_SUFFIXES = (b"@users.noreply.github.com",)


def reachable_object_paths(revision_args: list[str]) -> dict[str, set[str]]:
    completed = subprocess.run(
        ["git", "-c", "core.quotePath=false", "rev-list", "--objects", *revision_args],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        check=True,
        text=True,
    )
    objects: dict[str, set[str]] = {}
    for line in completed.stdout.splitlines():
        object_id, separator, relative = line.partition(" ")
        objects.setdefault(object_id, set())
        if separator:
            objects[object_id].add(relative)
    return objects


def sensitive_history_path(relative: str) -> str | None:
    if any(relative.startswith(prefix) for prefix in FORBIDDEN_HISTORY_PREFIXES):
        return "forbidden historical surface"
    name = Path(relative).name
    if name.startswith(".env") and name != ".env.example":
        return "historical environment file"
    if name in FORBIDDEN_HISTORY_NAMES or Path(name).suffix.lower() in SENSITIVE_SUFFIXES:
        return "historical credential/state file"
    return None


def audit(revision_args: list[str]) -> list[str]:
    objects = reachable_object_paths(revision_args)
    findings: dict[tuple[str, str], set[str]] = {}

    def record(label: str, relative: str, object_id: str) -> None:
        findings.setdefault((label, relative), set()).add(object_id[:12])

    process = subprocess.Popen(
        ["git", "cat-file", "--batch"],
        cwd=ROOT,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
    )
    assert process.stdin is not None
    assert process.stdout is not None

    try:
        for object_id, paths in objects.items():
            process.stdin.write(f"{object_id}\n".encode("ascii"))
            process.stdin.flush()
            header = process.stdout.readline().decode("ascii", errors="replace").strip()
            if header.endswith(" missing"):
                record("missing Git object", "<unknown path>", object_id)
                continue
            _, object_type, size_text = header.split(" ", 2)
            size = int(size_text)
            data = process.stdout.read(size)
            process.stdout.read(1)
            if object_type in {"blob", "commit"}:
                for relative in paths:
                    label = sensitive_history_path(relative)
                    if label:
                        record(label, relative, object_id)
            if object_type == "commit":
                for role, email in COMMIT_IDENTITY.findall(data):
                    if not email.lower().endswith(ALLOWED_COMMIT_EMAIL_SUFFIXES):
                        record(
                            f"personal {role.decode('ascii')} email in commit metadata",
                            "<commit metadata>",
                            object_id,
                        )
            if object_type != "blob":
                continue

            display_paths = sorted(paths) or ["<unknown path>"]
            if size > MAX_GIT_BLOB_BYTES:
                for relative in display_paths:
                    record(
                        "historical blob exceeds GitHub's 100 MiB limit",
                        relative,
                        object_id,
                    )
            if b"\0" in data[:8192]:
                continue
            for label, pattern in TEXT_PATTERNS:
                if pattern.search(data):
                    for relative in display_paths:
                        record(f"historical {label}", relative, object_id)
    finally:
        process.stdin.close()
        process.stdout.close()
        return_code = process.wait()
        if return_code:
            raise RuntimeError(f"git cat-file exited with {return_code}")

    failures: list[str] = []
    for (label, relative), object_ids in sorted(findings.items()):
        samples = ", ".join(sorted(object_ids)[:3])
        suffix = "" if len(object_ids) == 1 else f"; {len(object_ids)} blobs"
        failures.append(f"{label}: {relative} ({samples}{suffix})")
    return failures


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scan every object reachable from one or more refs before publication."
    )
    parser.add_argument(
        "refs",
        nargs="*",
        default=["HEAD"],
        help="Git revisions to scan (default: HEAD)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="scan every local ref; fetch remote refs first when auditing publication",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    revision_args = ["--all"] if args.all else args.refs
    failures = audit(revision_args)
    if failures:
        print("Public-history audit failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("Public-history audit passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
