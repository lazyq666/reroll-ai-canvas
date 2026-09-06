"""Export recordings of the running Reroll UI; never renders substitute UI."""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path


CLIPS = {
    "tool-layers": [("layers-start", 0, 65), ("layers-result", 0, 110)],
    "tool-angle": [("angle", 0, 100)],
    "tool-cutout": [("matting-compare", 0, 115)],
    "tool-lighting": [("lighting", 0, 120)],
    "tool-depth": [("depth-start", 0, 40), ("depth-compare", 0, 115)],
    "tool-reverse-panel": [("reverse-panel", 0, 65)],
    "accounts-permissions": [("accounts-permissions", 0, 90)],
    "sharing": [("sharing", 0, 80)],
    "templates": [("templates-browse", 0, 100)],
    "assets": [("assets-browse-insert", 0, 125)],
    "quick-tools-short": [
        ("layers-result", 10, 50), ("angle", 25, 65),
        ("matting-compare", 25, 65), ("lighting", 30, 70),
        ("depth-compare", 30, 70), ("reverse-panel", 10, 50),
    ],
    "quick-tools": [
        ("layers-start", 10, 40), ("layers-result", 10, 55),
        ("angle", 15, 90), ("matting-compare", 10, 100),
        ("lighting", 15, 110), ("depth-compare", 10, 100),
        ("reverse-panel", 10, 65),
    ],
    "libraries": [("templates-browse", 0, 100), ("assets-browse-insert", 0, 125)],
    "accounts-sharing": [("accounts-permissions", 0, 90), ("sharing", 0, 80)],
}


def command(*args: str) -> None:
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)


def export(raw: Path, out: Path, name: str) -> dict:
    frames = []
    for source, start, end in CLIPS[name]:
        directory = raw / source
        stamps = json.loads((directory / "frames.json").read_text())
        if len(stamps) < end:
            raise ValueError(f"Incomplete capture: {source}")
        for index in range(start, end):
            path = directory / stamps[index]["file"]
            if not path.is_file():
                raise FileNotFoundError(path)
            duration = (stamps[index + 1]["at"] - stamps[index]["at"]
                        if index + 1 < len(stamps) else 0.1)
            frames.append((path, max(0.001, duration)))
    duration = sum(seconds for _, seconds in frames)
    with tempfile.TemporaryDirectory(prefix="reroll-real-export-") as temp:
        concat = Path(temp) / "frames.ffconcat"
        lines = ["ffconcat version 1.0"]
        for path, seconds in frames:
            escaped = str(path).replace("'", "'\\''")
            lines.extend([f"file '{escaped}'", f"duration {seconds:.6f}"])
        lines.append(lines[-2])
        concat.write_text("\n".join(lines) + "\n")
        movie = out / f"{name}-zh.mp4"
        command("ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-safe", "0", "-f", "concat", "-i", str(concat),
                "-t", f"{duration:.6f}", "-r", "30", "-c:v", "libx264",
                "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", "-an", str(movie))
        command("ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(movie), "-vf",
                "fps=10,scale=960:-1:flags=lanczos,split[a][b];"
                "[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a",
                "-loop", "0", str(out / f"{name}-zh.gif"))
        command("ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-ss", str(min(duration * 0.45, 4)), "-i", str(movie),
                "-frames:v", "1", str(out / f"{name}-zh.png"))
    return {
        "name": name, "duration_seconds": round(duration, 3),
        "sources": CLIPS[name], "captured_frames": len(frames),
        "files": {suffix: (out / f"{name}-zh.{suffix}").stat().st_size
                  for suffix in ("mp4", "gif", "png")},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, default=Path("/tmp/reroll-live-recordings"))
    parser.add_argument("--clip", choices=CLIPS, action="append")
    args = parser.parse_args()
    out = Path(__file__).resolve().parent / "exports"
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "manifest.json"
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    results = {clip["name"]: clip for clip in previous.get("clips", [])}
    for name in args.clip or CLIPS:
        result = export(args.raw.resolve(), out, name)
        results[name] = result
        print(f"{name}: {result['duration_seconds']:.1f}s", flush=True)
    manifest = {
        "source": "Live Reroll UI at http://127.0.0.1:3000",
        "canvas": "81e968f6dee74fd3a741b9512b5c2fce",
        "language": "zh-CN", "capture_size": [1600, 900],
        "capture_fps_target": 10, "output_fps": 30,
        "timing": "Actual capture timestamps; repeated frames, no motion interpolation",
        "edits": "Hard cuts between real captures; processing waits omitted",
        "clips": list(results.values()),
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
