"""Repeatable local capacity measurements for Smart Matting."""

from __future__ import annotations

import hashlib
import math
import os
import platform
import statistics
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, Iterable, List

from PIL import Image, ImageDraw, ImageOps

try:
    import resource
except ImportError:  # pragma: no cover - unavailable on Windows
    resource = None


MAX_BENCHMARK_CONCURRENCY = 8
CAPACITY_POLICY = {
    "stable_memory_fraction_max": 0.85,
    "recommended_memory_fraction_max": 0.75,
    "stable_p95_baseline_multiplier_max": 3.0,
    "recommended_p95_baseline_multiplier_max": 2.5,
    "minimum_incremental_throughput_gain": 0.10,
}


def parse_levels(value: str) -> List[int]:
    text = str(value or "").strip()
    if not text:
        raise ValueError("并行档位不能为空")
    try:
        levels = [int(part.strip()) for part in text.split(",")]
    except (TypeError, ValueError) as exc:
        raise ValueError("并行档位必须是逗号分隔的整数") from exc
    if (
        not levels
        or any(level < 1 or level > MAX_BENCHMARK_CONCURRENCY for level in levels)
        or levels != sorted(set(levels))
    ):
        raise ValueError(
            f"并行档位必须递增、不可重复，并处于 1-{MAX_BENCHMARK_CONCURRENCY}"
        )
    return levels


def percentile(values: Iterable[float], fraction: float) -> float:
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return 0.0
    index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * fraction) - 1))
    return ordered[index]


def _sysctl_value(name: str) -> str:
    try:
        result = subprocess.run(
            ["sysctl", "-n", name],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def physical_memory_bytes() -> int:
    if platform.system() == "Darwin":
        try:
            return max(0, int(_sysctl_value("hw.memsize")))
        except ValueError:
            return 0
    meminfo = Path("/proc/meminfo")
    if meminfo.is_file():
        try:
            for line in meminfo.read_text(encoding="utf-8").splitlines():
                if line.startswith("MemTotal:"):
                    return int(line.split()[1]) * 1024
        except (OSError, ValueError, IndexError):
            pass
    try:
        return int(os.sysconf("SC_PHYS_PAGES")) * int(os.sysconf("SC_PAGE_SIZE"))
    except (AttributeError, OSError, TypeError, ValueError):
        return 0


def peak_rss_mb() -> float:
    if resource is None:
        return 0.0
    high_water = float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    if platform.system() != "Darwin":
        high_water *= 1024.0
    return round(high_water / (1024.0 * 1024.0), 2)


def machine_profile() -> Dict[str, Any]:
    memory_bytes = physical_memory_bytes()
    return {
        "system": platform.system(),
        "release": platform.release(),
        "machine": platform.machine(),
        "model": _sysctl_value("hw.model") if platform.system() == "Darwin" else "",
        "cpu_count": os.cpu_count() or 0,
        "physical_memory_mb": round(memory_bytes / (1024 * 1024), 2),
        "python": platform.python_version(),
    }


def build_standard_source(path: Path, size: tuple[int, int]) -> None:
    """Create a deterministic 2K-class scene with detailed foreground edges."""

    width, height = size
    gradient = Image.linear_gradient("L").resize(size)
    background = ImageOps.colorize(gradient, "#17324d", "#d6b68a").convert("RGB")
    draw = ImageDraw.Draw(background)
    tile = max(24, min(width, height) // 32)
    for row, y in enumerate(range(0, height, tile)):
        for column, x in enumerate(range(0, width, tile)):
            if (row + column) % 2:
                draw.rectangle(
                    (x, y, min(width, x + tile), min(height, y + tile)),
                    fill=(48 + (column % 5) * 7, 75 + (row % 7) * 5, 92),
                )

    center_x = width // 2
    head_radius = max(24, min(width, height) // 10)
    head_top = height // 7
    draw.ellipse(
        (
            center_x - head_radius,
            head_top,
            center_x + head_radius,
            head_top + head_radius * 2,
        ),
        fill="#e5b487",
        outline="#3b241d",
        width=max(2, tile // 10),
    )
    shoulder_y = head_top + head_radius * 2
    hem_y = int(height * 0.84)
    draw.polygon(
        (
            (center_x - int(width * 0.22), shoulder_y + tile),
            (center_x - int(width * 0.1), shoulder_y),
            (center_x + int(width * 0.1), shoulder_y),
            (center_x + int(width * 0.24), shoulder_y + tile * 2),
            (center_x + int(width * 0.16), hem_y),
            (center_x - int(width * 0.17), hem_y),
        ),
        fill="#d84a3a",
        outline="#2a1820",
    )
    for offset in range(-head_radius, head_radius, max(3, tile // 8)):
        draw.line(
            (
                center_x + offset,
                head_top + head_radius // 3,
                center_x + offset * 2,
                shoulder_y + tile * 2,
            ),
            fill="#2b1a18",
            width=max(1, tile // 18),
        )
    background.save(path, "PNG", optimize=False)


def _validate_output(path: Path, expected_size: tuple[int, int]) -> None:
    with Image.open(path) as image:
        image.load()
        if image.mode != "RGBA":
            raise ValueError(f"产物不是 RGBA PNG：{image.mode}")
        if image.size != expected_size:
            raise ValueError(f"产物尺寸错误：{image.size} != {expected_size}")


def run_capacity_level(
    engine: Any,
    source_path: Path,
    output_directory: Path,
    *,
    concurrency: int,
    jobs: int,
) -> Dict[str, Any]:
    with Image.open(source_path) as source_image:
        expected_size = source_image.size
    output_directory.mkdir(parents=True, exist_ok=True)

    def execute(index: int) -> Dict[str, Any]:
        output_path = output_directory / f"c{concurrency}-job-{index}.png"
        started = time.perf_counter()
        engine.remove_background(str(source_path), str(output_path))
        _validate_output(output_path, expected_size)
        return {
            "job": index,
            "duration_ms": round((time.perf_counter() - started) * 1000.0, 3),
        }

    started = time.perf_counter()
    cpu_started = time.process_time()
    successes: List[Dict[str, Any]] = []
    failures: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(
        max_workers=concurrency,
        thread_name_prefix="matting-capacity",
    ) as executor:
        futures = {
            executor.submit(execute, index): index
            for index in range(1, jobs + 1)
        }
        for future in as_completed(futures):
            index = futures[future]
            try:
                successes.append(future.result())
            except Exception as exc:
                failures.append({"job": index, "error": str(exc)[:500]})

    elapsed = max(0.000001, time.perf_counter() - started)
    cpu_elapsed = max(0.0, time.process_time() - cpu_started)
    durations = [item["duration_ms"] for item in successes]
    return {
        "concurrency": concurrency,
        "jobs": jobs,
        "succeeded": len(successes),
        "failures": failures,
        "elapsed_ms": round(elapsed * 1000.0, 3),
        "p50_ms": round(statistics.median(durations), 3) if durations else 0.0,
        "p95_ms": round(percentile(durations, 0.95), 3),
        "throughput_jobs_per_minute": round(len(successes) * 60.0 / elapsed, 3),
        "process_cpu_percent_of_machine": round(
            (cpu_elapsed / elapsed) * 100.0 / max(1, os.cpu_count() or 1),
            2,
        ),
        "peak_rss_mb": peak_rss_mb(),
        "job_durations_ms": sorted(durations),
    }


def recommend_capacity(
    results: List[Dict[str, Any]],
    *,
    physical_memory_mb: float = 0.0,
) -> Dict[str, Any]:
    ordered = sorted(results, key=lambda item: int(item["concurrency"]))
    if not ordered or int(ordered[0]["concurrency"]) != 1:
        raise ValueError("容量测试必须包含并行 1 的基线")
    baseline = ordered[0]
    baseline_p95 = max(1.0, float(baseline.get("p95_ms") or 0.0))
    baseline_memory_fraction = (
        float(baseline.get("peak_rss_mb") or 0.0) / physical_memory_mb
        if physical_memory_mb > 0
        else 0.0
    )
    if (
        baseline.get("failures")
        or baseline_memory_fraction > CAPACITY_POLICY["stable_memory_fraction_max"]
    ):
        reason = (
            "串行基线存在失败任务"
            if baseline.get("failures")
            else "串行基线峰值内存超过物理内存的 85%"
        )
        return {
            "highest_stable_tested": 0,
            "recommended_concurrency": 0,
            "rejected": {"1": reason},
            "policy": dict(CAPACITY_POLICY),
        }
    recommended = 1
    highest_stable = 0
    accepted_throughput = max(
        0.0, float(baseline.get("throughput_jobs_per_minute") or 0.0)
    )
    rejected: Dict[str, str] = {}

    for result in ordered:
        concurrency = int(result["concurrency"])
        key = str(concurrency)
        failures = list(result.get("failures") or [])
        memory_fraction = (
            float(result.get("peak_rss_mb") or 0.0) / physical_memory_mb
            if physical_memory_mb > 0
            else 0.0
        )
        p95_ratio = float(result.get("p95_ms") or 0.0) / baseline_p95
        stable_reason = ""
        if failures:
            stable_reason = "存在失败任务"
        elif memory_fraction > CAPACITY_POLICY["stable_memory_fraction_max"]:
            stable_reason = "峰值内存超过物理内存的 85%"
        elif p95_ratio > CAPACITY_POLICY["stable_p95_baseline_multiplier_max"]:
            stable_reason = "单任务 P95 超过串行基线的 3 倍"
        if stable_reason:
            rejected[key] = stable_reason
            continue
        highest_stable = max(highest_stable, concurrency)

        if concurrency == 1:
            continue
        throughput = float(result.get("throughput_jobs_per_minute") or 0.0)
        if memory_fraction > CAPACITY_POLICY["recommended_memory_fraction_max"]:
            rejected[key] = "峰值内存超过建议的 75% 安全水位"
        elif (
            p95_ratio
            > CAPACITY_POLICY["recommended_p95_baseline_multiplier_max"]
        ):
            rejected[key] = "单任务 P95 超过建议的 2.5 倍基线"
        elif throughput < accepted_throughput * (
            1.0 + CAPACITY_POLICY["minimum_incremental_throughput_gain"]
        ):
            rejected[key] = "相对上一建议档位的吞吐提升不足 10%"
        elif concurrency == recommended + 1:
            recommended = concurrency
            accepted_throughput = throughput
        else:
            rejected[key] = "较低并行档位未通过建议 Gate"

    return {
        "highest_stable_tested": highest_stable,
        "recommended_concurrency": recommended,
        "rejected": rejected,
        "policy": dict(CAPACITY_POLICY),
    }


def source_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def markdown_report(report: Dict[str, Any]) -> str:
    machine = report["machine"]
    recommendation = report["recommendation"]
    lines = [
        "# Smart Matting 容量测试报告",
        "",
        f"- 时间：{report['created_at']}",
        f"- 设备：{machine.get('model') or machine.get('machine') or 'unknown'}",
        f"- CPU 逻辑核心：{machine.get('cpu_count') or 'unknown'}",
        f"- 物理内存：{machine.get('physical_memory_mb') or 'unknown'} MB",
        f"- 输入：{report['source']['width']}×{report['source']['height']} PNG",
        f"- 最高稳定测试档位：{recommendation['highest_stable_tested']}",
        f"- 建议日常并行数：{recommendation['recommended_concurrency']}",
        "",
        "| 并行数 | 成功/总数 | P50 | P95 | 吞吐（任务/分钟） | 峰值 RSS |",
        "| ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for result in report["results"]:
        lines.append(
            "| {concurrency} | {succeeded}/{jobs} | {p50_ms:.0f} ms | "
            "{p95_ms:.0f} ms | {throughput_jobs_per_minute:.2f} | "
            "{peak_rss_mb:.0f} MB |".format(**result)
        )
    lines.extend(
        (
            "",
            "“最高稳定测试档位”只代表本次固定输入和测试时长内未越过稳定 Gate；",
            "“建议日常并行数”还要求内存、延迟与增量吞吐保留安全余量。",
            "",
        )
    )
    return "\n".join(lines)


__all__ = [
    "build_standard_source",
    "machine_profile",
    "markdown_report",
    "parse_levels",
    "recommend_capacity",
    "run_capacity_level",
    "source_sha256",
]
