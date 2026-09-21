"""Pure Generation Output merge rules shared by storage adapters."""

from __future__ import annotations

import copy
import mimetypes
from pathlib import PurePosixPath
from typing import Any, Dict, Mapping
from urllib.parse import unquote, urlsplit


_MEDIA_EXTENSIONS = {
    ".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".tif",
    ".tiff", ".webp", ".m4v", ".mkv", ".mov", ".mp4", ".webm", ".aac",
    ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".txt",
}
_KIND_FALLBACK_EXTENSIONS = {
    "image": ".png",
    "video": ".mp4",
    "audio": ".mp3",
    "text": ".txt",
}


def _media_kind(value: Mapping[str, Any]) -> str:
    kind = str(value.get("kind") or value.get("type") or "image").strip().lower()
    return kind if kind in _KIND_FALLBACK_EXTENSIONS else "image"


def _extension_from_value(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.startswith("data:"):
        mime = text[5:].split(";", 1)[0].strip().lower()
        extension = mimetypes.guess_extension(mime, strict=False) or ""
        return ".jpg" if extension == ".jpe" else extension.lower()
    path = unquote(urlsplit(text).path)
    suffix = PurePosixPath(path).suffix.lower()
    return suffix if suffix in _MEDIA_EXTENSIONS else ""


def _generation_output_extension(value: Mapping[str, Any], kind: str) -> str:
    extension = _extension_from_value(value.get("url"))
    if extension:
        return extension
    for key in ("mime", "mime_type", "mimeType", "content_type", "contentType"):
        mime = str(value.get(key) or "").split(";", 1)[0].strip().lower()
        if not mime:
            continue
        guessed = mimetypes.guess_extension(mime, strict=False) or ""
        guessed = ".jpg" if guessed == ".jpe" else guessed.lower()
        if guessed in _MEDIA_EXTENSIONS:
            return guessed
    extension = _extension_from_value(value.get("name"))
    return extension or _KIND_FALLBACK_EXTENSIONS[kind]


def _initialize_generation_output_names(values: Any) -> list[dict[str, Any]]:
    counters: dict[str, int] = {}
    named: list[dict[str, Any]] = []
    for raw in values if isinstance(values, list) else []:
        item = copy.deepcopy(dict(raw)) if isinstance(raw, Mapping) else {
            "url": str(raw or ""),
            "kind": "image",
        }
        if not str(item.get("url") or "").strip():
            named.append(item)
            continue
        kind = _media_kind(item)
        counters[kind] = counters.get(kind, 0) + 1
        item["kind"] = kind
        item["name"] = (
            f"{kind}-{counters[kind]:02d}"
            f"{_generation_output_extension(item, kind)}"
        )
        named.append(item)
    return named


def _output_key(value: Any) -> str:
    if isinstance(value, Mapping):
        url = str(value.get("url") or "").strip()
        kind = str(value.get("kind") or "image").strip() or "image"
        return f"{kind}\x1f{url}" if url else ""
    url = str(value or "").strip()
    return f"image\x1f{url}" if url else ""


def _merge_outputs(existing: Any, additions: Any) -> list[Any]:
    merged: list[Any] = []
    indexes: dict[str, int] = {}
    for value in [
        *(existing if isinstance(existing, list) else []),
        *(additions if isinstance(additions, list) else []),
    ]:
        item = copy.deepcopy(value)
        key = _output_key(item)
        if key and key in indexes:
            index = indexes[key]
            if isinstance(merged[index], Mapping) and isinstance(item, Mapping):
                existing_name = str(merged[index].get("name") or "").strip()
                merged[index] = {**merged[index], **item}
                if existing_name:
                    merged[index]["name"] = existing_name
            continue
        if key:
            indexes[key] = len(merged)
        merged.append(item)
    return merged


def apply_generation_node_changes(
    node: Mapping[str, Any],
    node_changes: Mapping[str, Any],
    *,
    run_id: str,
    initialize_names: bool = True,
) -> Dict[str, Any]:
    """Return one updated Node while preserving concurrent Run outputs.

    ``id`` and ``generationOperationId`` are Target Guard identity and cannot
    be overwritten by a Provider result. When images arrive, pending state is
    derived from the remaining task list so concurrent completions accumulate
    rather than letting the last request replace earlier outputs.
    """

    updated = copy.deepcopy(dict(node))
    changes = copy.deepcopy(dict(node_changes or {}))
    incoming_images = changes.pop("images", None)
    if isinstance(incoming_images, list):
        if initialize_names:
            incoming_images = _initialize_generation_output_names(incoming_images)
        updated["images"] = _merge_outputs(
            updated.get("images"),
            incoming_images,
        )
        try:
            pending_before = max(0, int(updated.get("pending") or 0))
        except (TypeError, ValueError):
            pending_before = 0
        pending_after = max(0, pending_before - 1)
        pending_tasks = updated.get("pendingTasks")
        if isinstance(pending_tasks, list):
            remaining_tasks = [
                copy.deepcopy(task)
                for task in pending_tasks
                if not (
                    isinstance(task, Mapping)
                    and str(task.get("taskId") or "") == str(run_id or "")
                )
            ]
            if len(remaining_tasks) < len(pending_tasks):
                pending_after = max(pending_after, len(remaining_tasks))
                if remaining_tasks:
                    updated["pendingTasks"] = remaining_tasks
                else:
                    updated.pop("pendingTasks", None)
        if "pending" in changes:
            changes["pending"] = pending_after
        if "running" in changes:
            changes["running"] = pending_after > 0
    for key, value in changes.items():
        if key in {"id", "generationOperationId"}:
            continue
        updated[str(key)] = copy.deepcopy(value)
    return updated


def apply_generation_result_nodes(
    node: Mapping[str, Any],
    node_changes: Mapping[str, Any],
    peers: list[Mapping[str, Any]],
    *,
    run_id: str,
) -> list[Dict[str, Any]]:
    """Project a shared Run onto its existing slots before merging each Node.

    The submitted task records identify shared Runs. Before those records are
    saved, the pre-submission input snapshot supplies the frozen output count.
    Independent per-slot Runs retain the ordinary single-target merge.
    """
    task = next(
        (task for task in (node.get("pendingTasks") or [])
         if isinstance(task, Mapping) and task.get("taskId") == run_id),
        None,
    )
    snapshot = node.get("generationInputSnapshot") or {}
    settings = snapshot.get("settings", {}) if isinstance(snapshot, Mapping) else {}
    count = (
        task.get("generationSlotCount") if task is not None
        else settings.get("count") if isinstance(settings, Mapping) else None
    )
    outputs = node_changes.get("images")
    named_outputs = (
        _initialize_generation_output_names(outputs)
        if isinstance(outputs, list)
        else outputs
    )
    if (not isinstance(count, int) or isinstance(count, bool) or not 2 <= count <= 8
            or not node.get("generationBatchId") or not isinstance(outputs, list)):
        changes = {**node_changes, "images": named_outputs} if isinstance(outputs, list) else node_changes
        return [apply_generation_node_changes(
            node,
            changes,
            run_id=run_id,
            initialize_names=False,
        )]

    updated = []
    for candidate in peers:
        index = candidate.get("generationSlotIndex")
        tasks = candidate.get("pendingTasks") or []
        if (candidate.get("generationBatchId") != node.get("generationBatchId")
                or candidate.get("generationOperationId") != node.get("generationOperationId")
                or candidate.get("generationSlotCount") != count
                or not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < count
                or (tasks and not any(isinstance(task, Mapping) and task.get("taskId") == run_id for task in tasks))):
            continue
        # Surplus outputs belong only to the final slot, which may split them.
        changes = {
            **node_changes,
            "images": named_outputs[index:] if index == count - 1 else named_outputs[index:index + 1],
        }
        updated.append(apply_generation_node_changes(
            candidate,
            changes,
            run_id=run_id,
            initialize_names=False,
        ))
    return updated


__all__ = ["apply_generation_node_changes", "apply_generation_result_nodes"]
