#!/usr/bin/env python3
"""Reject Web Awesome details outside the Reroll UI adapter seam."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATIC_ROOT = ROOT / "static"
ADAPTER_ROOT = STATIC_ROOT / "js" / "infinite-canvas-ui"
ADAPTER_ENGINE = STATIC_ROOT / "css" / "webawesome-engine.css"
VENDOR_ROOT = STATIC_ROOT / "vendor"
SOURCE_SUFFIXES = {".css", ".html", ".js"}
VENDOR_TOKENS = re.compile(r"\bwa-[a-z][a-z0-9-]*|--wa-|vendor/webawesome")


def is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def audit_boundary() -> dict[str, object]:
    sources = sorted(
        path
        for path in STATIC_ROOT.rglob("*")
        if path.is_file()
        and path.suffix in SOURCE_SUFFIXES
        and not is_within(path, VENDOR_ROOT)
        and not is_within(path, ADAPTER_ROOT)
        and path != ADAPTER_ENGINE
    )
    usages: list[dict[str, object]] = []
    for path in sources:
        for line_number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            match = VENDOR_TOKENS.search(line)
            if match:
                usages.append(
                    {
                        "file": path.relative_to(ROOT).as_posix(),
                        "line": line_number,
                        "token": match.group(0),
                    }
                )
    return {
        "adapter": ADAPTER_ROOT.relative_to(ROOT).as_posix(),
        "scannedFiles": len(sources),
        "directVendorUsages": usages,
    }


def main() -> int:
    report = audit_boundary()
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    if report["directVendorUsages"]:
        print(
            "Web Awesome details must stay inside the Reroll UI adapter.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
