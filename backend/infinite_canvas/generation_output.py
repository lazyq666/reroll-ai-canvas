"""Pure Generation Output merge rules shared by storage adapters."""

from __future__ import annotations

import copy
from typing import Any, Dict, Mapping


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
                merged[index] = {**merged[index], **item}
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


__all__ = ["apply_generation_node_changes"]
