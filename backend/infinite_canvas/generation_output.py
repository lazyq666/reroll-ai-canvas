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
    if (not isinstance(count, int) or isinstance(count, bool) or not 2 <= count <= 8
            or not node.get("generationBatchId") or not isinstance(outputs, list)):
        return [apply_generation_node_changes(node, node_changes, run_id=run_id)]

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
            "images": outputs[index:] if index == count - 1 else outputs[index:index + 1],
        }
        updated.append(apply_generation_node_changes(candidate, changes, run_id=run_id))
    return updated


__all__ = ["apply_generation_node_changes", "apply_generation_result_nodes"]
