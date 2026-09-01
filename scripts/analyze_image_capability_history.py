#!/usr/bin/env python3
"""Build a zero-network image capability report from generation history."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from infinite_canvas.image_capability_history import build_history_capability_report


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = arguments(argv)
    payload = json.loads(args.history.read_text(encoding="utf-8-sig"))
    report = build_history_capability_report(payload)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Models: {len(report['models'])}")
    print(f"Successful runs: {report['successful_runs_evaluated']}")
    print(f"Images: {report['images_evaluated']}")
    print("External requests: 0")
    print(f"Report: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
