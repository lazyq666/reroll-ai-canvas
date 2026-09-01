#!/usr/bin/env python3
"""Run the standard Smart Matting concurrency capacity benchmark."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from infinite_canvas.device_cache import application_cache_directory
from infinite_canvas.matting_capacity import (
    build_standard_source,
    machine_profile,
    markdown_report,
    parse_levels,
    recommend_capacity,
    run_capacity_level,
    source_sha256,
)
from infinite_canvas.matting_service import BiRefNetMattingEngine


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="测量当前设备的 Smart Matting 最高稳定档位与建议并行数。",
    )
    parser.add_argument("--levels", default="1,2,3,4", help="递增并行档位")
    parser.add_argument("--jobs-per-level", type=int, default=4)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--width", type=int, default=2048)
    parser.add_argument("--height", type=int, default=1536)
    parser.add_argument("--model-dir", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = arguments()
    try:
        levels = parse_levels(args.levels)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    if args.jobs_per_level < 1 or args.jobs_per_level > 100:
        raise SystemExit("--jobs-per-level 必须处于 1-100")
    if args.width < 256 or args.height < 256:
        raise SystemExit("标准输入宽高必须至少为 256")

    model_dir = (
        args.model_dir.expanduser().resolve()
        if args.model_dir
        else application_cache_directory(ROOT) / "models" / "matting"
    )
    output_directory = (
        args.output_dir.expanduser().resolve()
        if args.output_dir
        else Path("/private/tmp/ic-matting-capacity")
        / dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    )
    config = {
        "levels": levels,
        "jobs_per_level": args.jobs_per_level,
        "standard_size": [args.width, args.height],
        "model_dir": str(model_dir),
    }
    engine = BiRefNetMattingEngine(model_dir=str(model_dir))
    config["model"] = engine.spec.name
    preview = {
        "machine": machine_profile(),
        "config": config,
        "model_ready": engine.model_ready(),
    }
    if args.dry_run:
        print(json.dumps(preview, ensure_ascii=False, indent=2))
        return 0

    machine = preview["machine"]
    output_directory.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ic-matting-capacity-") as temporary:
        temporary_directory = Path(temporary)
        source_path = temporary_directory / "standard-source.png"
        if args.input:
            if not args.input.expanduser().is_file():
                raise SystemExit(f"输入图片不存在：{args.input}")
            from PIL import Image, ImageOps

            with Image.open(args.input.expanduser()) as opened:
                image = ImageOps.exif_transpose(opened).convert("RGB")
                image.save(source_path, "PNG", optimize=False)
        else:
            build_standard_source(source_path, (args.width, args.height))

        from PIL import Image

        with Image.open(source_path) as source_image:
            source_size = source_image.size
        warmup_path = temporary_directory / "warmup.png"
        warmup_started = time.perf_counter()
        engine.remove_background(str(source_path), str(warmup_path))
        warmup_ms = round((time.perf_counter() - warmup_started) * 1000.0, 3)

        results = []
        physical_memory_mb = float(machine.get("physical_memory_mb") or 0.0)
        for level in levels:
            result = run_capacity_level(
                engine,
                source_path,
                temporary_directory / f"level-{level}",
                concurrency=level,
                jobs=max(args.jobs_per_level, level),
            )
            results.append(result)
            print(
                f"并行 {level}: {result['succeeded']}/{result['jobs']} 成功，"
                f"P95 {result['p95_ms']:.0f} ms，"
                f"吞吐 {result['throughput_jobs_per_minute']:.2f} 任务/分钟",
                file=sys.stderr,
                flush=True,
            )
            if result["failures"]:
                print("当前档位存在失败任务，停止测试更高并行数。", file=sys.stderr)
                break
            if (
                physical_memory_mb > 0
                and float(result["peak_rss_mb"]) / physical_memory_mb > 0.85
            ):
                print(
                    "当前档位峰值内存已超过 85% 安全水位，停止测试更高并行数。",
                    file=sys.stderr,
                )
                break
        report = {
            "schema_version": 1,
            "created_at": dt.datetime.now(dt.timezone.utc).astimezone().isoformat(),
            "machine": machine,
            "config": config,
            "model": engine.spec.name,
            "warmup_ms": warmup_ms,
            "source": {
                "kind": "provided" if args.input else "standard-generated",
                "width": source_size[0],
                "height": source_size[1],
                "sha256": source_sha256(source_path),
            },
            "results": results,
            "recommendation": recommend_capacity(
                results,
                physical_memory_mb=physical_memory_mb,
            ),
        }

    json_path = output_directory / "report.json"
    markdown_path = output_directory / "report.md"
    json_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    markdown_path.write_text(markdown_report(report), encoding="utf-8")
    print(
        json.dumps(
            {
                "report_json": str(json_path),
                "report_markdown": str(markdown_path),
                **report["recommendation"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
