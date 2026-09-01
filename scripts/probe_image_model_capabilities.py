#!/usr/bin/env python3
"""Opt-in, billable probe for an OpenAI-compatible image endpoint.

The command downloads every returned image and judges support from its actual
file dimensions.  It never edits the production capability configuration.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from infinite_canvas.image_capabilities import (
    COMMON_ASPECT_RATIOS,
    EXTENDED_ASPECT_RATIOS,
    aspect_ratio_value,
)
from infinite_canvas.image_capability_probe import ProbeAttempt, build_probe_report


TIER_LONG_SIDE = {"1K": 1024, "2K": 2048, "4K": 4096}


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--environment", default="openai-compatible-http")
    parser.add_argument("--protocol", choices=("openai", "apimart"), default="openai")
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--api-key-env", default="OPENAI_API_KEY")
    parser.add_argument("--api-key-file", type=Path)
    parser.add_argument("--api-key-name")
    parser.add_argument("--candidate-set", choices=("common", "extended"), default="common")
    parser.add_argument("--candidate-file", type=Path)
    parser.add_argument("--tiers", default="1K")
    parser.add_argument("--attempts", type=int, default=1)
    parser.add_argument("--prompt", default="A plain studio photograph of a red ceramic sphere on a neutral background.")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=180.0)
    parser.add_argument("--yes", action="store_true", help="confirm the displayed billable request count")
    return parser.parse_args(argv)


def candidates(args):
    ratios = list(COMMON_ASPECT_RATIOS if args.candidate_set == "common" else EXTENDED_ASPECT_RATIOS)
    tiers = [item.strip().upper() for item in args.tiers.split(",") if item.strip()]
    if args.candidate_file:
        payload = json.loads(args.candidate_file.read_text(encoding="utf-8"))
        exact = payload.get("candidates")
        if isinstance(exact, list):
            result = []
            for item in exact:
                if not isinstance(item, dict):
                    continue
                ratio = str(item.get("aspect_ratio") or "").strip()
                tier = str(item.get("resolution_tier") or "").strip().upper()
                if ratio and tier:
                    result.append((ratio, tier))
            if result:
                return list(dict.fromkeys(result))
        ratios = list(payload.get("aspect_ratios") or ratios)
        tiers = [str(item).upper() for item in (payload.get("resolution_tiers") or tiers)]
    invalid_tiers = [tier for tier in tiers if tier not in TIER_LONG_SIDE]
    if invalid_tiers:
        raise SystemExit(f"Unsupported probe tiers: {', '.join(invalid_tiers)}")
    return [(ratio, tier) for ratio in ratios for tier in tiers]


def requested_size(ratio: str, tier: str) -> str:
    value = aspect_ratio_value(ratio)
    long_side = TIER_LONG_SIDE[tier]
    if value >= 1:
        width, height = long_side, round(long_side / value)
    else:
        width, height = round(long_side * value), long_side
    width = max(16, round(width / 16) * 16)
    height = max(16, round(height / 16) * 16)
    return f"{width}x{height}"


def classify_error(error: BaseException) -> str:
    if isinstance(error, urllib.error.HTTPError):
        if error.code == 429:
            return "rate_limit"
        if error.code in {402, 403}:
            return "insufficient_balance"
        if error.code >= 500:
            return "server"
        return "rejected"
    if isinstance(error, (TimeoutError, urllib.error.URLError)):
        return "network"
    return "unknown"


def response_image_bytes(payload: dict[str, Any], timeout: float) -> bytes:
    item = (payload.get("data") or [None])[0]
    if not isinstance(item, dict):
        raise ValueError("response does not contain image data")
    if item.get("b64_json"):
        return base64.b64decode(item["b64_json"])
    url = str(item.get("url") or "")
    if not url:
        raise ValueError("response does not contain image url")
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return response.read()


def _walk_values(value: Any):
    yield value
    if isinstance(value, dict):
        for item in value.values():
            yield from _walk_values(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk_values(item)


def apimart_task_id(payload: dict[str, Any]) -> str:
    for value in _walk_values(payload):
        if not isinstance(value, dict):
            continue
        for key in ("task_id", "taskId", "submit_id"):
            if value.get(key):
                return str(value[key])
    return ""


def apimart_status(payload: dict[str, Any]) -> str:
    for value in _walk_values(payload):
        if not isinstance(value, dict):
            continue
        for key in ("status", "task_status"):
            if value.get(key):
                return str(value[key]).strip().upper()
    return ""


def apimart_image_url(payload: dict[str, Any]) -> str:
    for value in _walk_values(payload):
        if not isinstance(value, str):
            continue
        clean = value.split("?", 1)[0].lower()
        if value.startswith(("http://", "https://")) and clean.endswith(
            (".png", ".jpg", ".jpeg", ".webp")
        ):
            return value
    keys = ("url", "image_url", "imageUrl", "output_url", "result_url")
    for value in _walk_values(payload):
        if not isinstance(value, dict):
            continue
        for key in keys:
            candidate = value.get(key)
            if not isinstance(candidate, str):
                continue
            clean = candidate.split("?", 1)[0].lower()
            if candidate.startswith(("http://", "https://")) and clean.endswith(
                (".png", ".jpg", ".jpeg", ".webp")
            ):
                return candidate
    return ""


def authenticated_json(url: str, body: dict[str, Any] | None, api_key: str, timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=(json.dumps(body).encode("utf-8") if body is not None else None),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST" if body is not None else "GET",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def execute_apimart(args, ratio: str, tier: str, attempt: int, api_key: str) -> ProbeAttempt:
    started = time.monotonic()
    tested_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    output_width = output_height = None
    accepted = False
    error_category = error_text = ""
    try:
        payload = authenticated_json(
            args.endpoint,
            {
                "model": args.model,
                "prompt": args.prompt,
                "n": 1,
                "size": ratio,
                "resolution": tier.lower(),
                "official_fallback": False,
            },
            api_key,
            args.timeout,
        )
        url = apimart_image_url(payload)
        task_id = apimart_task_id(payload)
        if not url and task_id:
            journal = args.output_dir / "submitted-tasks.jsonl"
            with journal.open("a", encoding="utf-8") as output:
                output.write(json.dumps({
                    "provider_id": args.provider,
                    "model_id": args.model,
                    "aspect_ratio": ratio,
                    "resolution_tier": tier,
                    "attempt": attempt,
                    "task_id": task_id,
                    "submitted_at": tested_at,
                }, ensure_ascii=False) + "\n")
            parsed = urllib.parse.urlsplit(args.endpoint)
            task_url = f"{parsed.scheme}://{parsed.netloc}/v1/tasks/{urllib.parse.quote(task_id)}"
            deadline = time.monotonic() + args.timeout
            time.sleep(min(10.0, max(0.0, deadline - time.monotonic())))
            while time.monotonic() < deadline:
                payload = authenticated_json(task_url, None, api_key, args.timeout)
                url = apimart_image_url(payload)
                status = apimart_status(payload)
                if url:
                    break
                if status in {"FAILED", "FAILURE", "ERROR", "CANCELLED", "CANCELED"}:
                    raise ValueError(f"APIMART task failed with status {status}")
                time.sleep(min(5.0, max(0.0, deadline - time.monotonic())))
        if not url:
            raise TimeoutError("APIMART task returned no image before timeout")
        with urllib.request.urlopen(url, timeout=args.timeout) as response:
            image_bytes = response.read()
        filename = f"{ratio.replace(':', 'x')}_{tier}_{attempt}.png"
        path = args.output_dir / "images" / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(image_bytes)
        with Image.open(path) as image:
            image.load()
            output_width, output_height = image.size
        accepted = True
    except Exception as error:
        error_category = classify_error(error)
        error_text = str(error).replace(api_key, "[redacted]")[:500]
    return ProbeAttempt(
        provider_id=args.provider,
        model_id=args.model,
        environment=args.environment,
        requested_aspect_ratio=ratio,
        requested_resolution_tier=tier,
        attempt=attempt,
        accepted=accepted,
        output_width=output_width,
        output_height=output_height,
        elapsed_seconds=round(time.monotonic() - started, 3),
        tested_at=tested_at,
        error_category=error_category,
        error=error_text,
    )


def execute(args, ratio: str, tier: str, attempt: int, api_key: str) -> ProbeAttempt:
    if args.protocol == "apimart":
        return execute_apimart(args, ratio, tier, attempt, api_key)
    started = time.monotonic()
    tested_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    output_width = output_height = None
    accepted = False
    error_category = error_text = ""
    try:
        body = json.dumps({
            "model": args.model,
            "prompt": args.prompt,
            "size": requested_size(ratio, tier),
            "n": 1,
        }).encode("utf-8")
        request = urllib.request.Request(
            args.endpoint,
            data=body,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        image_bytes = response_image_bytes(payload, args.timeout)
        filename = f"{ratio.replace(':', 'x')}_{tier}_{attempt}.png"
        path = args.output_dir / "images" / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(image_bytes)
        with Image.open(path) as image:
            image.load()
            output_width, output_height = image.size
        accepted = True
    except Exception as error:
        error_category = classify_error(error)
        error_text = str(error).replace(api_key, "[redacted]")[:500]
    return ProbeAttempt(
        provider_id=args.provider,
        model_id=args.model,
        environment=args.environment,
        requested_aspect_ratio=ratio,
        requested_resolution_tier=tier,
        attempt=attempt,
        accepted=accepted,
        output_width=output_width,
        output_height=output_height,
        elapsed_seconds=round(time.monotonic() - started, 3),
        tested_at=tested_at,
        error_category=error_category,
        error=error_text,
    )


def main(argv=None):
    args = arguments(argv)
    pairs = candidates(args)
    attempts = max(1, int(args.attempts))
    request_count = len(pairs) * attempts
    print(f"Billable requests: {request_count} ({len(pairs)} candidates × {attempts} attempts)")
    if not args.yes:
        print("No requests sent. Re-run with --yes after reviewing the count.")
        return 2
    api_key = os.getenv(args.api_key_env, "")
    if not api_key and args.api_key_file and args.api_key_name:
        try:
            for line in args.api_key_file.read_text(encoding="utf-8-sig").splitlines():
                if line.strip().startswith(f"{args.api_key_name}="):
                    api_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
        except OSError:
            api_key = ""
    if not api_key:
        print("Missing configured probe credential", file=sys.stderr)
        return 2
    args.output_dir.mkdir(parents=True, exist_ok=True)
    results = []
    checkpoint = args.output_dir / "attempts.checkpoint.json"
    for ratio, tier in pairs:
        for attempt in range(1, attempts + 1):
            result = execute(args, ratio, tier, attempt, api_key)
            results.append(result)
            checkpoint.write_text(
                json.dumps([item.evaluated() for item in results], ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(
                f"[{len(results)}/{request_count}] {ratio} {tier}: "
                f"{result.evaluated()['status']}",
                flush=True,
            )
    report = build_probe_report(results)
    (args.output_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.output_dir / "suggested-capability.json").write_text(json.dumps(report["suggested_capability"], ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Report: {args.output_dir / 'report.json'}")
    print("Review the evidence manually before updating the maintained capability file.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
