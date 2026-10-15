"""Compile the imported H3 two-pass template from one frozen input snapshot.

This adapter is intentionally separate from API providers and generic ComfyUI
field mappings. No prompt or reference filename from the template survives.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import math
import re
from typing import Any

H3_CLASSES = {
    "7": "MiniMaxH3AudioConditioningT8",
    "14": "MiniMaxH3AudioConditioningT8",
    "13": "MiniMaxH3LearnedLatentUpscaleT8Advanced",
    "20": "MiniMaxH3AVDecodeT8",
    "21": "VHS_VideoCombine",
    "11": "RandomNoise",
    "12": "SamplerCustomAdvanced",
    "15": "MiniMaxH3TwoPassLatentReconcileT8Advanced",
    "19": "SamplerCustomAdvanced",
}
DURATIONS = tuple(range(4, 16))
SIZES = {
    "512p": {"16:9": (896, 512), "9:16": (512, 896), "1:1": (512, 512)},
    "768p": {"16:9": (1344, 768), "9:16": (768, 1344), "1:1": (768, 768)},
}


def _conditioning_from(graph: dict, link: Any, source: list) -> bool:
    """Follow conditioning wrappers without fixing their IDs or parameters."""
    visited = set()
    while link != source:
        if (not isinstance(link, list) or len(link) != 2
                or not isinstance(link[0], str) or link[1] != 0
                or link[0] in visited):
            return False
        visited.add(link[0])
        node = graph.get(link[0])
        if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
            return False
        link = node["inputs"].get("conditioning")
    return True


def _sampler_conditioning_from(graph: dict, sampler_id: str, source: list) -> bool:
    link = graph[sampler_id]["inputs"].get("guider")
    if not isinstance(link, list) or len(link) != 2 or link[1] != 0:
        return False
    guider = graph.get(link[0]) if isinstance(link[0], str) else None
    return bool(isinstance(guider, dict)
                and guider.get("class_type") == "BasicGuider"
                and isinstance(guider.get("inputs"), dict)
                and _conditioning_from(graph, guider["inputs"].get("conditioning"), source))


def is_h3_template(graph: dict) -> bool:
    if not isinstance(graph, dict) or not all(
        isinstance(graph.get(nid), dict)
        and graph[nid].get("class_type") == cls
        and isinstance(graph[nid].get("inputs"), dict)
        for nid, cls in H3_CLASSES.items()
    ):
        return False
    # Class names alone can still describe a graph that bypasses the learned
    # upscale or either conditioning stage. These are the supported data paths;
    # sampler settings, model choices and conditioning wrappers stay editable.
    required_links = {
        "12": {"latent_image": ["7", 1], "noise": ["11", 0]},
        "13": {"av_latent": ["12", 1]},
        "15": {"learned_latent": ["13", 0], "highres_template": ["14", 1]},
        "19": {"latent_image": ["15", 0], "noise": ["11", 0]},
        "20": {"av_latent": ["19", 0]},
    }
    return (
        all(graph[nid]["inputs"].get(key) == value
            for nid, inputs in required_links.items() for key, value in inputs.items())
        and _sampler_conditioning_from(graph, "12", ["7", 0])
        and _conditioning_from(graph, graph["15"]["inputs"].get("positive"), ["14", 0])
        and _sampler_conditioning_from(graph, "19", ["15", 1])
    )


def h3_capability(graph: dict, config: dict | None = None) -> dict | None:
    if not is_h3_template(graph):
        return None
    return {
        "adapter": "h3", "output_kind": "video", "min_images": 0,
        "max_images": 6, "max_videos": 3, "max_audios": 3,
        "min_references": 1, "max_references": 12,
        "reference_duration_min": 2, "reference_duration_max": 15,
        "reference_video_total_duration_max": 15,
        "reference_audio_total_duration_max": 15,
        "durations": list(DURATIONS), "resolutions": list(SIZES),
        "aspect_ratios": ["16:9", "9:16", "1:1"],
        "resolution_sizes": {
            key: {ratio: {"width": size[0], "height": size[1]} for ratio, size in values.items()}
            for key, values in SIZES.items()
        },
        "defaults": {"duration": 4, "resolution": "512p", "aspect_ratio": "16:9"},
        "backend": "",
    }


def reference_path(reference: dict) -> str:
    name = str(reference.get("name") or "").strip().replace("\\", "/")
    subfolder = str(reference.get("subfolder") or "").strip().replace("\\", "/")
    if not name or name.startswith("/") or ":" in name or any(p in {"", ".", ".."} for p in name.split("/")):
        raise ValueError("comfy.h3.invalid_reference")
    if subfolder and (subfolder.startswith("/") or ":" in subfolder or any(p in {"", ".", ".."} for p in subfolder.split("/"))):
        raise ValueError("comfy.h3.invalid_reference")
    if reference.get("type", "input") != "input":
        raise ValueError("comfy.h3.invalid_reference")
    return f"{subfolder}/{name}" if subfolder else name


def validate_references(references: Any, *, require_durations: bool = False) -> list[dict]:
    if not isinstance(references, list) or not 1 <= len(references) <= 12:
        raise ValueError("comfy.h3.reference_count")
    counts = {"image": 0, "video": 0, "audio": 0}
    totals = {"video": 0.0, "audio": 0.0}
    result = deepcopy(references)
    for ref in result:
        if not isinstance(ref, dict) or ref.get("kind") not in counts:
            raise ValueError("comfy.h3.reference_kind")
        reference_path(ref)
        kind = ref["kind"]
        counts[kind] += 1
        if "include_audio" in ref and not isinstance(ref["include_audio"], bool):
            raise ValueError("comfy.h3.invalid_reference")
        if kind in totals:
            try:
                duration = float(ref.get("duration"))
            except (TypeError, ValueError):
                if require_durations:
                    raise ValueError("comfy.h3.reference_duration_unknown")
                continue
            if not math.isfinite(duration) or not 2 <= duration <= 15.05:
                raise ValueError("comfy.h3.reference_duration")
            totals[kind] += duration
    if counts["image"] > 6 or counts["video"] > 3 or counts["audio"] > 3:
        raise ValueError("comfy.h3.reference_count")
    if any(total > 15.05 for total in totals.values()):
        raise ValueError("comfy.h3.reference_duration_total")
    return result


# Keep the installed T8 plugin's spelling grammar: explicit angle-bracket
# tags plus English shorthand, including Image aliases and optional spacing.
# Validate before its legacy single-reference/zero-based remapping can change
# which source a handwritten tag names.
MEDIA_TAG_RE = re.compile(
    r"<\s*(Image|Picture|Video|Audio)\s*(\d+)\s*>|"
    r"(?<![\w<])(Image|Picture|Video|Audio)\s*#?\s*(\d+)\b(?!\s*>)",
    re.IGNORECASE,
)


def validate_prompt_tags(prompt: str, references: list[dict]) -> str:
    counts = {
        "Picture": sum(r["kind"] == "image" for r in references),
        "Video": sum(r["kind"] == "video" for r in references),
        "Audio": sum(r["kind"] == "audio" or (r["kind"] == "video" and r.get("include_audio", False)) for r in references),
    }

    def replace(match: re.Match) -> str:
        media_type = (match.group(1) or match.group(3)).lower()
        kind = "Picture" if media_type in {"image", "picture"} else media_type.title()
        number = int(match.group(2) or match.group(4))
        limit = counts[kind]
        # Like T8, unbracketed prose about an absent media kind is ordinary text.
        if not match.group(1) and not limit:
            return match.group(0)
        if not 1 <= number <= limit:
            raise ValueError("comfy.h3.prompt_reference_missing")
        return f"<{kind} {number}>"

    return MEDIA_TAG_RE.sub(replace, prompt)


def _dependencies(value: Any):
    if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and isinstance(value[1], int):
        yield value[0]
    elif isinstance(value, dict):
        for item in value.values():
            yield from _dependencies(item)


def ancestors(graph: dict, roots: list[str]) -> dict:
    """Drop previews and all now-unused sample media/prompt branches."""
    needed = set()
    pending = list(roots)
    while pending:
        nid = pending.pop()
        if nid in needed:
            continue
        if nid not in graph:
            raise ValueError("comfy.h3.invalid_template")
        needed.add(nid)
        pending.extend(_dependencies(graph[nid].get("inputs") or {}))
    return {nid: value for nid, value in graph.items() if nid in needed}


@dataclass(frozen=True)
class CompiledH3:
    graph: dict
    output_node_ids: tuple[str, ...]
    duration: int
    width: int
    height: int
    frame_count: int


def compile_h3(template: dict, prompt: str, inputs: dict, *, seed: int) -> CompiledH3:
    if not is_h3_template(template):
        raise ValueError("comfy.h3.invalid_template")
    if inputs.get("adapter", "h3") != "h3":
        raise ValueError("comfy.h3.invalid_adapter")
    duration = inputs.get("duration", 4)
    if type(duration) is not int or duration not in DURATIONS:
        raise ValueError("comfy.h3.invalid_duration")
    duration = int(duration)
    resolution = inputs.get("resolution", "512p")
    ratio = inputs.get("aspect_ratio", "16:9")
    if (not isinstance(resolution, str) or not isinstance(ratio, str)
            or resolution not in SIZES or ratio not in SIZES[resolution]):
        raise ValueError("comfy.h3.invalid_resolution")
    references = validate_references(inputs.get("references"))
    prompt = validate_prompt_tags(str(prompt or ""), references)
    width, height = SIZES[resolution][ratio]
    low_width = max(32, round(width / 1.5 / 32) * 32)
    low_height = max(32, round(height / 1.5 / 32) * 32)
    requested_frames = duration * 24
    frame_count = requested_frames + (5 - requested_frames % 17) % 17
    graph = deepcopy(template)
    graph["11"]["inputs"]["noise_seed"] = seed
    graph["13"]["inputs"].update({
        "size_mode": "target_dimensions", "target_width": width,
        "target_height": height, "aspect_policy": "honor_dimensions_exp",
        "max_anisotropy": 1.1,
    })
    media_links = {}
    indices = {"image": 0, "video": 0, "audio": 0}
    for index, ref in enumerate(references):
        kind = ref["kind"]
        ordinal = indices[kind]
        indices[kind] += 1
        nid = f"reroll_h3_ref_{index}"
        path = reference_path(ref)
        if kind == "image":
            graph[nid] = {"class_type": "LoadImage", "inputs": {"image": path}}
            media_links[f"ref_images.ref_image_{ordinal}"] = [nid, 0]
        elif kind == "video":
            # Resize along one axis so a portrait reference is not stretched
            # into a landscape output canvas. Dimensions are probed server-side.
            source_width = float(ref.get("width") or 0)
            source_height = float(ref.get("height") or 0)
            max_edge = max(low_width, low_height)
            resize_width = max_edge if source_width >= source_height and source_width > 0 else 0
            resize_height = max_edge if source_height > source_width else 0
            graph[nid] = {"class_type": "VHS_LoadVideo", "inputs": {
                "video": path, "force_rate": 24, "custom_width": resize_width,
                "custom_height": resize_height, "frame_load_cap": 0,
                "skip_first_frames": 0, "select_every_nth": 1, "format": "None",
            }}
            media_links[f"ref_videos.ref_video_{ordinal}"] = [nid, 0]
            if ref.get("include_audio", False):
                # The plugin associates soundtrack slots by video index. It
                # numbers active video soundtracks before standalone audio.
                media_links[f"ref_video_audios.ref_video_audio_{ordinal}"] = [nid, 2]
        else:
            graph[nid] = {"class_type": "LoadAudio", "inputs": {"audio": path}}
            media_links[f"ref_audios.ref_audio_{ordinal}"] = [nid, 0]
    for nid in ("7", "14"):
        old = graph[nid]["inputs"]
        graph[nid]["inputs"] = {
            key: value for key, value in old.items()
            if not key.startswith(("ref_images", "ref_videos", "ref_video_audios", "ref_audios"))
            and key not in {"drive_audio", "final_audio", "first_frame", "last_frame"}
        }
        graph[nid]["inputs"].update(media_links)
        graph[nid]["inputs"].update({
            "prompt": str(prompt or ""), "length": frame_count,
            "task_type": "Ref2VA", "audio_mode": "native",
            "add_source_as_reference": False, "prompt_primary_audio_ordinal": 0,
            "strict_prompt_tags": True,
        })
    graph["7"]["inputs"].update({"width": low_width, "height": low_height})
    graph["14"]["inputs"].update({"width": ["13", 1], "height": ["13", 2]})
    # H3 internally aligns to 17n+5 frames. Deliver the requested exact seconds
    # at 24fps, with the audio cropped to the same interval before encoding.
    graph["reroll_h3_trim_frames"] = {"class_type": "ImageFromBatch", "inputs": {
        "image": ["20", 0], "batch_index": 0, "length": requested_frames,
    }}
    graph["reroll_h3_trim_audio"] = {"class_type": "AudioCrop", "inputs": {
        "audio": ["20", 1], "start_time": "0:00", "end_time": f"0:{duration:02d}",
    }}
    # Encode both already-cropped streams together and flush the final packets.
    # VHS's -shortest mux dropped three video frames at 8s; padding its audio
    # instead truncated half an AAC packet (16ms) at 6s and 10s.
    graph["reroll_h3_create_video"] = {"class_type": "CreateVideo", "inputs": {
        "images": ["reroll_h3_trim_frames", 0], "audio": ["reroll_h3_trim_audio", 0],
        "fps": 24, "bit_depth": 8, "color_space": "sRGB", "codec": "none",
    }}
    graph["21"] = {"class_type": "SaveVideo", "inputs": {
        "video": ["reroll_h3_create_video", 0], "filename_prefix": "Reroll/H3",
        "format": "mp4", "format.codec": "h264",
        "format.codec.encoding": "re-encode", "format.codec.encoding.crf": 22,
    }}
    graph = ancestors(graph, ["21"])
    return CompiledH3(graph, ("21",), duration, width, height, frame_count)
