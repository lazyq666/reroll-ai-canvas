"""Offline preparation for the one-shot JSON/JSON to SQLite/SQLite cutover.

Preparation writes verified databases below the Workspace recovery directory.
It deliberately does not rename them into the authoritative paths and never
writes ``storage-authority.json``.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import urllib.parse
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .canvas_store import (
    CanvasIntent,
    CanvasProjection,
    SqliteCanvasStore,
)
from .content import WorkspaceContent
from .generation_run_lifecycle import map_generation_run_lifecycle
from .generation_run_store import (
    GenerationRunStoreError,
    SqliteGenerationRunStore,
)


_MIGRATION_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
_TERMINAL_RUN_STATUSES = frozenset(
    {"succeeded", "failed", "cancelled", "discarded"}
)


class SqliteMigrationError(RuntimeError):
    """Legacy Workspace data cannot be prepared safely for cutover."""


@dataclass(frozen=True)
class SqliteMigrationPreparation:
    ok: bool
    workspace_id: str
    migration_id: str
    staging_directory: Path
    recovery_manifest: Path
    preparation_report: Path
    canvas_database: Path
    generation_run_database: Path
    canvas_count: int
    legacy_generation_log_count: int
    imported_generation_log_count: int
    imported_generation_run_count: int
    imported_global_history_count: int
    imported_publication_receipt_count: int
    omitted_terminal_run_count: int
    canvas_integrity: Mapping[str, Any]
    generation_run_integrity: Mapping[str, Any]
    composer_audit: Mapping[str, Any]


def _load_json(path: Path, *, missing: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return missing
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise SqliteMigrationError(f"无法读取迁移源文件：{path.name}") from exc


def _legacy_generation_runs(path: Path) -> tuple[Mapping[str, Any], ...]:
    payload = _load_json(path, missing={"runs": []})
    if not isinstance(payload, Mapping):
        raise SqliteMigrationError("generation-runs.json 根节点必须是对象")
    values = payload.get("runs")
    if not isinstance(values, list):
        raise SqliteMigrationError("generation-runs.json runs 必须是数组")
    runs: list[Mapping[str, Any]] = []
    identities: dict[str, str] = {}
    for value in values:
        if not isinstance(value, Mapping):
            raise SqliteMigrationError("generation-runs.json 含无效 Run")
        run_id = str(value.get("id") or "").strip()
        if not run_id:
            raise SqliteMigrationError("generation-runs.json 含无 identity Run")
        digest = hashlib.sha256(
            json.dumps(
                value,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        if run_id in identities:
            raise SqliteMigrationError(
                f"generation-runs.json Run ID 冲突：{run_id}"
            )
        identities[run_id] = digest
        runs.append(value)
    return tuple(runs)


def _legacy_global_history(path: Path) -> tuple[Mapping[str, Any], ...]:
    payload = _load_json(path, missing=[])
    if not isinstance(payload, list):
        raise SqliteMigrationError("generation-history.json 根节点必须是数组")
    records: list[Mapping[str, Any]] = []
    for index, value in enumerate(payload):
        if not isinstance(value, Mapping):
            raise SqliteMigrationError(
                f"generation-history.json 含无效记录：#{index + 1}"
            )
        records.append(value)
    return tuple(records)


def _legacy_publication_receipts(
    path: Path,
) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    payload = _load_json(
        path,
        missing={"version": 2, "effects": {}, "pending": {}},
    )
    if not isinstance(payload, Mapping):
        raise SqliteMigrationError("generation-effects.json 根节点必须是对象")
    effects = payload.get("effects", {})
    pending = payload.get("pending", {})
    if not isinstance(effects, Mapping) or not isinstance(pending, Mapping):
        raise SqliteMigrationError("generation-effects.json receipt 结构无效")

    def normalize(
        values: Mapping[str, Any], *, field: str
    ) -> dict[str, set[str]]:
        normalized: dict[str, set[str]] = {}
        for raw_run_id, raw_names in values.items():
            run_id = str(raw_run_id or "").strip()
            if not run_id or not isinstance(raw_names, list):
                raise SqliteMigrationError(
                    f"generation-effects.json {field} receipt 无效"
                )
            names = {str(name or "").strip() for name in raw_names}
            if "" in names or not names.issubset({"history", "notification"}):
                raise SqliteMigrationError(
                    f"generation-effects.json 含未知 effect：{run_id}"
                )
            if names:
                normalized[run_id] = names
        return normalized

    completed = normalize(effects, field="completed")
    outstanding = normalize(pending, field="pending")
    for run_id, names in tuple(outstanding.items()):
        names.difference_update(completed.get(run_id, set()))
        if not names:
            outstanding.pop(run_id, None)
    return completed, outstanding


def _global_history_run_id(record: Mapping[str, Any]) -> str:
    direct = str(
        record.get("run_id")
        or record.get("runId")
        or record.get("generationRunId")
        or ""
    ).strip()
    if direct:
        return direct
    marker = str(record.get("_effect_id") or "").strip()
    prefix = "generation-run:"
    if marker.startswith(prefix):
        candidate = marker[len(prefix) :]
        if candidate and ":" not in candidate:
            return candidate
    return ""


def normalize_legacy_global_history(
    values: tuple[Mapping[str, Any], ...],
) -> tuple[tuple[str, str, dict[str, Any]], ...]:
    normalized: list[tuple[str, str, dict[str, Any]]] = []
    identities: dict[str, str] = {}
    occurrences: dict[str, int] = {}
    for index, value in enumerate(values):
        record = json.loads(json.dumps(value, ensure_ascii=False))
        run_id = _global_history_run_id(record)
        canonical = {
            str(key): item
            for key, item in record.items()
            if str(key) not in {"_effect_id", "history_id"}
        }
        encoded = json.dumps(
            canonical,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        content_digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
        explicit_id = str(
            record.get("history_id") or record.get("id") or ""
        ).strip()
        if explicit_id:
            history_id = explicit_id
        elif run_id:
            history_id = f"history:run:{run_id}"
        else:
            occurrence = occurrences.get(content_digest, 0)
            occurrences[content_digest] = occurrence + 1
            history_id = "legacy-history:" + hashlib.sha256(
                f"{content_digest}:{occurrence}".encode("utf-8")
            ).hexdigest()
        previous = identities.get(history_id)
        if previous is not None and previous != content_digest:
            raise SqliteMigrationError(
                f"generation-history.json History ID 冲突：{history_id}"
            )
        if previous is not None:
            raise SqliteMigrationError(
                f"generation-history.json 重复 History ID：{history_id}"
            )
        identities[history_id] = content_digest
        record["history_id"] = history_id
        normalized.append((history_id, run_id, record))
    return tuple(normalized)


def _history_output_urls(value: Any) -> tuple[str, ...]:
    values: list[Any] = []
    for key in (
        "images", "videos", "audios", "files", "texts", "outputs",
        "urls", "items", "image_items",
    ):
        current = value.get(key)
        if isinstance(current, list):
            values.extend(current)
    if value.get("url"):
        values.append(value.get("url"))
    urls: list[str] = []
    for item in values:
        if isinstance(item, Mapping):
            item = (
                item.get("url")
                or item.get("path")
                or item.get("src")
                or item.get("uri")
            )
        text = str(item or "").strip()
        if text and text not in urls:
            urls.append(text)
    return tuple(urls)


def _managed_media_path(content: WorkspaceContent, url: str) -> Path | None:
    clean = urllib.parse.unquote(
        str(url or "").split("?", 1)[0]
    ).replace("\\", "/")
    workspace_root = content.canvas_content.parent.parent.resolve()
    assets = (workspace_root / "assets").resolve()
    relative = ""
    if clean.startswith("/assets/"):
        relative = clean[len("/assets/") :]
    elif clean.startswith("/api/storage-files/generated/"):
        relative = "output/" + clean[len("/api/storage-files/generated/") :]
    elif clean.startswith("/api/storage-files/upload/"):
        relative = "input/" + clean[len("/api/storage-files/upload/") :]
    elif clean.startswith("/api/storage-files/local/"):
        relative = "uploads/" + clean[len("/api/storage-files/local/") :]
    else:
        return None
    candidate = (assets / relative.lstrip("/")).resolve()
    try:
        candidate.relative_to(assets)
    except ValueError:
        return None
    return candidate


def _verify_managed_media(
    content: WorkspaceContent,
    value: Mapping[str, Any],
    *,
    label: str,
) -> int:
    verified = 0
    for url in _history_output_urls(value):
        path = _managed_media_path(content, url)
        if path is None:
            raise SqliteMigrationError(
                f"{label} 仍引用未托管输出，无法安全迁移"
            )
        if not path.is_file() or path.is_symlink():
            raise SqliteMigrationError(f"{label} 引用的 Managed Media 缺失")
        verified += 1
    return verified


def _composer_snapshots(document: Mapping[str, Any]) -> tuple[dict[str, Any], ...]:
    node_runtime = shutil.which("node")
    if not node_runtime:
        raise SqliteMigrationError(
            "Composer 冻结审计需要 Node.js 运行前端 Prompt Authoring 规则"
        )
    backend_root = Path(__file__).resolve().parents[1]
    script = backend_root / "scripts" / "composer_migration_snapshot.cjs"
    prompt_authoring = (
        backend_root.parent
        / "static"
        / "js"
        / "smart-canvas"
        / "prompt-authoring.js"
    )
    try:
        result = subprocess.run(
            [node_runtime, str(script), str(prompt_authoring)],
            input=json.dumps(
                {
                    "canvas": {
                        "nodes": document.get("nodes", []),
                        "connections": document.get("connections", []),
                    }
                },
                ensure_ascii=False,
            ),
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise SqliteMigrationError("无法运行 Composer 冻结审计") from exc
    if result.returncode != 0:
        raise SqliteMigrationError("前端 Composer 解析规则执行失败")
    try:
        payload = json.loads(result.stdout)
        snapshots = payload["snapshots"]
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise SqliteMigrationError("前端 Composer 审计返回无效结果") from exc
    if not isinstance(snapshots, list):
        raise SqliteMigrationError("前端 Composer 审计 snapshots 必须是数组")
    values: list[dict[str, Any]] = []
    seen: set[str] = set()
    for snapshot in snapshots:
        if not isinstance(snapshot, Mapping):
            raise SqliteMigrationError("前端 Composer 审计包含无效 Node 快照")
        node_id = str(snapshot.get("nodeId") or "").strip()
        if not node_id or node_id in seen:
            raise SqliteMigrationError("前端 Composer 审计 Node identity 无效")
        seen.add(node_id)
        values.append(dict(snapshot))
    return tuple(values)


def _freeze_composer_nodes(
    document: Mapping[str, Any],
) -> tuple[dict[str, Any], tuple[dict[str, Any], ...], int]:
    frozen = json.loads(json.dumps(document, ensure_ascii=False))
    log_backfilled_node_count = _backfill_composer_from_legacy_logs(frozen)
    snapshots = _composer_snapshots(frozen)
    by_id = {snapshot["nodeId"]: snapshot for snapshot in snapshots}
    for node in frozen.get("nodes", []):
        if not isinstance(node, dict):
            continue
        snapshot = by_id.get(str(node.get("id") or ""))
        if snapshot is None:
            continue
        prompt = str(snapshot.get("prompt") or "")
        refs = json.loads(json.dumps(snapshot.get("refs") or []))
        settings = json.loads(json.dumps(snapshot.get("settings") or {}))
        previous = node.get("generationInputSnapshot")
        previous = previous if isinstance(previous, Mapping) else {}
        node["runModelPrompt"] = prompt
        if not str(node.get("runPrompt") or "").strip():
            node["runPrompt"] = prompt
        node["runInputRefs"] = json.loads(json.dumps(refs))
        node["runPromptRefs"] = json.loads(json.dumps(refs))
        node["runSettings"] = json.loads(json.dumps(settings))
        node["generationInputSnapshot"] = {
            "prompt": prompt,
            "refs": refs,
            "settings": settings,
            "createdAt": previous.get("createdAt", node.get("runAt", 0)),
        }
    return frozen, snapshots, log_backfilled_node_count


def _media_url(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if not isinstance(value, Mapping):
        return ""
    return str(
        value.get("url")
        or value.get("path")
        or value.get("src")
        or value.get("uri")
        or ""
    ).strip()


def _backfill_composer_from_legacy_logs(document: dict[str, Any]) -> int:
    logs = [
        log
        for log in document.get("logs", [])
        if isinstance(log, Mapping)
    ]
    backfilled = 0
    for node in document.get("nodes", []):
        if not isinstance(node, dict) or not _legacy_result_node(node):
            continue
        output_urls = {
            url
            for url in (_media_url(item) for item in node.get("images", []))
            if url
        }
        if not output_urls:
            continue
        matches = []
        for log in logs:
            log_urls = {
                url
                for url in (
                    _media_url(item) for item in log.get("outputs", [])
                )
                if url
            }
            if output_urls & log_urls:
                matches.append(log)
        if len(matches) != 1:
            continue
        match = matches[0]
        input_snapshot = node.get("generationInputSnapshot")
        input_snapshot = input_snapshot if isinstance(input_snapshot, Mapping) else {}
        has_prompt = any(
            str(value or "").strip()
            for value in (
                node.get("runModelPrompt"),
                input_snapshot.get("prompt"),
                node.get("runPrompt"),
                node.get("promptDraftText"),
            )
        )
        stored_ref_lists = [
            node.get("recipeSourceRefs"),
            node.get("runInputRefs"),
            node.get("runPromptRefs"),
            input_snapshot.get("refs"),
        ]
        has_refs = any(
            isinstance(values, list)
            and any(_media_url(value) for value in values)
            for values in stored_ref_lists
        )
        changed = False
        prompt = str(match.get("prompt") or "").strip()
        if not has_prompt and prompt:
            node["runModelPrompt"] = prompt
            node["runPrompt"] = prompt
            changed = True
        refs = match.get("refs")
        if not has_refs and isinstance(refs, list):
            valid_refs = [
                json.loads(json.dumps(ref))
                for ref in refs
                if isinstance(ref, Mapping) and _media_url(ref)
            ]
            if valid_refs:
                node["runInputRefs"] = json.loads(json.dumps(valid_refs))
                node["runPromptRefs"] = json.loads(json.dumps(valid_refs))
                changed = True
        if changed:
            backfilled += 1
    return backfilled


def _legacy_result_node(node: Mapping[str, Any]) -> bool:
    if node.get("generationOutputNode") is True:
        return True
    has_output = any(_media_url(item) for item in node.get("images", []))
    if not has_output:
        return False
    return bool(
        node.get("runAt") is not None
        or str(node.get("runPrompt") or "").strip()
        or str(node.get("runModelPrompt") or "").strip()
        or isinstance(node.get("generationInputSnapshot"), Mapping)
    )


def _composer_difference(
    *,
    canvas_id: str,
    expected: Mapping[str, Any],
    actual: Mapping[str, Any],
) -> list[dict[str, Any]]:
    differences: list[dict[str, Any]] = []
    fields = {
        "prompt": (
            str(expected.get("prompt") or ""),
            str(actual.get("prompt") or ""),
        ),
        "input_media": (
            [
                {"url": str(ref.get("url") or ""), "role": str(ref.get("role") or "")}
                for ref in expected.get("refs", [])
                if isinstance(ref, Mapping)
            ],
            [
                {"url": str(ref.get("url") or ""), "role": str(ref.get("role") or "")}
                for ref in actual.get("refs", [])
                if isinstance(ref, Mapping)
            ],
        ),
        "critical_settings": (
            expected.get("criticalSettings") or {},
            actual.get("criticalSettings") or {},
        ),
    }
    for field, (before, after) in fields.items():
        if before != after:
            before_json = json.dumps(
                before, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            )
            after_json = json.dumps(
                after, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            )
            differences.append(
                {
                    "canvas_id": canvas_id,
                    "node_id": str(expected.get("nodeId") or ""),
                    "field": field,
                    "before_sha256": hashlib.sha256(
                        before_json.encode("utf-8")
                    ).hexdigest(),
                    "after_sha256": hashlib.sha256(
                        after_json.encode("utf-8")
                    ).hexdigest(),
                }
            )
    return differences


def _migration_actor(document: Mapping[str, Any]) -> dict[str, Any]:
    owner_id = str(
        document.get("owner_id")
        or document.get("created_by")
        or "migration-admin"
    )
    return {
        "id": owner_id,
        "username": str(document.get("owner_username") or "migration"),
        "role": "admin",
        "status": "active",
    }


def _operation_id(migration_id: str, canvas_id: str) -> str:
    digest = hashlib.sha256(
        f"{migration_id}:{canvas_id}".encode("utf-8")
    ).hexdigest()
    return f"migration:{digest}"


def normalize_legacy_generation_log(
    value: Any,
    *,
    canvas_id: str,
    index: int,
    used_log_ids: set[str],
    used_run_ids: set[str],
) -> tuple[dict[str, Any], bool, bool]:
    if not isinstance(value, Mapping):
        raise SqliteMigrationError(
            f"Canvas Generation History 含无效记录：{canvas_id}#{index + 1}"
        )
    log = json.loads(json.dumps(value, ensure_ascii=False))
    status = str(log.get("status") or "").strip().lower()
    status = {
        "succeeded": "success",
        "canceled": "cancelled",
    }.get(status, status)
    if not status:
        status = "failed" if str(log.get("error") or "").strip() else "success"
    if status not in {"success", "partial", "failed", "cancelled"}:
        raise SqliteMigrationError(
            f"Canvas Generation History 状态无效：{canvas_id}#{index + 1}"
        )
    log["status"] = status
    original_log_id = str(log.get("id") or log.get("log_id") or "").strip()
    log_id = original_log_id or hashlib.sha256(
        f"{canvas_id}:legacy-log:{index}".encode("utf-8")
    ).hexdigest()
    remapped_log_id = log_id in used_log_ids
    if remapped_log_id:
        log_id = (
            "migration-log-"
            + hashlib.sha256(
                f"{canvas_id}:{index}:{original_log_id}".encode("utf-8")
            ).hexdigest()
        )
    used_log_ids.add(log_id)
    log["id"] = log_id

    run_id = str(
        log.get("runId")
        or log.get("run_id")
        or log.get("generationRunId")
        or ""
    ).strip()
    duplicate_run_id = bool(run_id and run_id in used_run_ids)
    diagnostics = log.get("diagnostics")
    diagnostics = dict(diagnostics) if isinstance(diagnostics, Mapping) else {}
    if remapped_log_id and original_log_id:
        diagnostics["legacy_log_id"] = original_log_id
    if duplicate_run_id:
        diagnostics["legacy_duplicate_generation_run_id"] = run_id
        log.pop("runId", None)
        log.pop("run_id", None)
        log.pop("generationRunId", None)
    elif run_id:
        used_run_ids.add(run_id)
        log["runId"] = run_id
    if diagnostics:
        log["diagnostics"] = diagnostics
    if "durationMs" not in log and "runMs" in log:
        log["durationMs"] = log.get("runMs")
    return log, remapped_log_id, duplicate_run_id


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_recovery_manifest(
    path: Path,
    payload: Mapping[str, Any],
) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _write_preparation_report(
    path: Path,
    *,
    workspace_id: str,
    migration_id: str,
    status: str,
    phase: str,
    details: Mapping[str, Any] | None = None,
) -> None:
    _write_recovery_manifest(
        path,
        {
            "schema_version": 1,
            "workspace_id": workspace_id,
            "migration_id": migration_id,
            "status": status,
            "phase": phase,
            **dict(details or {}),
        },
    )


def _create_recovery_copy(
    content: WorkspaceContent,
    *,
    workspace_id: str,
    migration_id: str,
    migration_root: Path,
) -> Path:
    workspace_root = content.canvas_content.parent.parent.resolve()
    source_directory = migration_root / "source"
    source_paths = sorted(content.smart_canvases.glob("*.json"))
    source_paths.extend(
        path
        for path in (
            content.generation_runs,
            content.generation_history,
            content.generation_effects,
            content.projects,
        )
        if path.exists()
    )
    records: list[dict[str, Any]] = []
    for source in source_paths:
        if source.is_symlink():
            raise SqliteMigrationError(
                f"迁移恢复副本拒绝符号链接：{source.name}"
            )
        resolved = source.resolve()
        try:
            relative = resolved.relative_to(workspace_root)
        except ValueError as exc:
            raise SqliteMigrationError(
                f"迁移源文件超出 Workspace：{source.name}"
            ) from exc
        before = _sha256(resolved)
        destination = source_directory / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(resolved, destination)
        copied = _sha256(destination)
        after = _sha256(resolved)
        if before != copied or before != after:
            raise SqliteMigrationError(
                f"创建恢复副本时源文件发生变化：{source.name}"
            )
        records.append(
            {
                "relative_path": relative.as_posix(),
                "size": destination.stat().st_size,
                "sha256": copied,
            }
        )
    manifest = migration_root / "recovery-manifest.json"
    _write_recovery_manifest(
        manifest,
        {
            "schema_version": 1,
            "workspace_id": workspace_id,
            "migration_id": migration_id,
            "sources": records,
        },
    )
    return manifest


def _load_mapping(path: Path, *, label: str) -> Mapping[str, Any]:
    value = _load_json(path, missing=None)
    if not isinstance(value, Mapping):
        raise SqliteMigrationError(f"{label} 格式无效")
    return value


def _verify_existing_recovery_copy(
    content: WorkspaceContent,
    *,
    workspace_id: str,
    migration_id: str,
    migration_root: Path,
) -> Path:
    manifest_path = migration_root / "recovery-manifest.json"
    manifest = _load_mapping(manifest_path, label="recovery manifest")
    if (
        manifest.get("workspace_id") != workspace_id
        or manifest.get("migration_id") != migration_id
        or not isinstance(manifest.get("sources"), list)
    ):
        raise SqliteMigrationError("已有 recovery manifest 与本次迁移不一致")
    workspace_root = content.canvas_content.parent.parent.resolve()
    for item in manifest["sources"]:
        if not isinstance(item, Mapping):
            raise SqliteMigrationError("已有 recovery manifest source 无效")
        relative = Path(str(item.get("relative_path") or ""))
        if relative.is_absolute() or ".." in relative.parts:
            raise SqliteMigrationError("已有 recovery manifest 路径无效")
        source = (workspace_root / relative).resolve()
        copy_path = (migration_root / "source" / relative).resolve()
        expected = str(item.get("sha256") or "")
        try:
            source.relative_to(workspace_root)
            copy_path.relative_to((migration_root / "source").resolve())
        except ValueError as exc:
            raise SqliteMigrationError("已有 recovery manifest 路径越界") from exc
        if (
            not source.is_file()
            or source.is_symlink()
            or not copy_path.is_file()
            or copy_path.is_symlink()
            or _sha256(source) != expected
            or _sha256(copy_path) != expected
        ):
            raise SqliteMigrationError(
                f"同一 migration ID 的来源已变化：{relative.name}"
            )
    return manifest_path


def _ready_preparation(
    content: WorkspaceContent,
    *,
    workspace_id: str,
    migration_id: str,
    migration_root: Path,
) -> SqliteMigrationPreparation | None:
    report_path = migration_root / "preparation-report.json"
    if not report_path.is_file():
        return None
    report = _load_mapping(report_path, label="preparation report")
    if report.get("status") != "ready" or report.get("phase") != "complete":
        return None
    if (
        report.get("workspace_id") != workspace_id
        or report.get("migration_id") != migration_id
        or report.get("authority_published") is not False
    ):
        raise SqliteMigrationError("已有 preparation report 与本次迁移不一致")
    recovery_manifest = _verify_existing_recovery_copy(
        content,
        workspace_id=workspace_id,
        migration_id=migration_id,
        migration_root=migration_root,
    )
    staging = migration_root / "staging"
    canvas_database = staging / "canvas-content.sqlite3"
    run_database = staging / "generation-runs.sqlite3"
    if (
        not canvas_database.is_file()
        or not run_database.is_file()
        or report.get("canvas_database_sha256") != _sha256(canvas_database)
        or report.get("generation_run_database_sha256") != _sha256(run_database)
    ):
        raise SqliteMigrationError("已有 verified staging 与报告不一致")
    canvas_store = SqliteCanvasStore(canvas_database, workspace_id=workspace_id)
    run_store = SqliteGenerationRunStore(run_database, workspace_id=workspace_id)
    canvas_integrity = canvas_store.integrity()
    run_integrity = run_store.integrity()
    if not canvas_integrity.get("ok") or not run_integrity.get("ok"):
        raise SqliteMigrationError("已有 verified staging 完整性检查失败")
    composer = report.get("composer_audit")
    composer = dict(composer) if isinstance(composer, Mapping) else {}
    return SqliteMigrationPreparation(
        ok=True,
        workspace_id=workspace_id,
        migration_id=migration_id,
        staging_directory=staging,
        recovery_manifest=recovery_manifest,
        preparation_report=report_path,
        canvas_database=canvas_database,
        generation_run_database=run_database,
        canvas_count=int(report.get("canvas_count") or 0),
        legacy_generation_log_count=int(
            report.get("legacy_generation_log_count") or 0
        ),
        imported_generation_log_count=int(
            report.get("imported_generation_log_count") or 0
        ),
        imported_generation_run_count=int(
            report.get("imported_generation_run_count") or 0
        ),
        imported_global_history_count=int(
            (report.get("global_history_audit") or {}).get(
                "imported_count", 0
            )
        ),
        imported_publication_receipt_count=int(
            (report.get("publication_audit") or {}).get("receipt_count", 0)
        ),
        omitted_terminal_run_count=int(
            report.get("omitted_terminal_run_count") or 0
        ),
        canvas_integrity=canvas_integrity,
        generation_run_integrity=run_integrity,
        composer_audit=composer,
    )


def _reset_failed_staging(migration_root: Path) -> None:
    staging = migration_root / "staging"
    for database_name in ("canvas-content.sqlite3", "generation-runs.sqlite3"):
        database = staging / database_name
        for path in (
            database,
            database.with_name(database.name + "-wal"),
            database.with_name(database.name + "-shm"),
        ):
            try:
                path.unlink()
            except FileNotFoundError:
                pass
    report = migration_root / "preparation-report.json"
    if report.is_file():
        attempts = migration_root / "attempts"
        attempts.mkdir(exist_ok=True)
        destination = attempts / f"preparation-report-{uuid.uuid4().hex}.json"
        shutil.copy2(report, destination)


def prepare_sqlite_migration(
    content: WorkspaceContent,
    *,
    workspace_id: str,
    migration_id: str,
) -> SqliteMigrationPreparation:
    """Build and verify staging databases without publishing authority."""

    workspace_id = str(workspace_id or "").strip()
    migration_id = str(migration_id or "").strip()
    if not workspace_id:
        raise SqliteMigrationError("迁移缺少 Workspace identity")
    if (
        not _MIGRATION_ID.fullmatch(migration_id)
        or migration_id in {".", ".."}
    ):
        raise SqliteMigrationError("migration ID 无效")
    if content.storage_authority.exists():
        raise SqliteMigrationError(
            "Workspace 已有 storage-authority.json，拒绝重复准备迁移"
        )
    existing_databases = [
        path
        for path in (
            content.canvas_content,
            content.generation_run_store,
        )
        if path.exists()
    ]
    if existing_databases:
        raise SqliteMigrationError(
            "Workspace 已有正式 SQLite 数据库，拒绝覆盖或混合准备"
        )

    legacy_runs = _legacy_generation_runs(content.generation_runs)
    non_terminal = [
        str(run.get("id") or "unknown")
        for run in legacy_runs
        if str(run.get("status") or "") not in _TERMINAL_RUN_STATUSES
    ]
    if non_terminal:
        raise SqliteMigrationError(
            "仍有未结束 Generation Run，拒绝准备 SQLite 迁移："
            + ", ".join(non_terminal[:10])
        )

    migration_root = (
        content.canvas_content.parent / "recovery" / migration_id
    )
    staging_directory = migration_root / "staging"
    canvas_database = staging_directory / "canvas-content.sqlite3"
    generation_run_database = staging_directory / "generation-runs.sqlite3"
    existing_recovery_manifest: Path | None = None
    if migration_root.exists():
        if not migration_root.is_dir() or migration_root.is_symlink():
            raise SqliteMigrationError("该 migration ID 已存在不安全路径")
        ready = _ready_preparation(
            content,
            workspace_id=workspace_id,
            migration_id=migration_id,
            migration_root=migration_root,
        )
        if ready is not None:
            return ready
        if (migration_root / "recovery-manifest.json").is_file():
            existing_recovery_manifest = _verify_existing_recovery_copy(
                content,
                workspace_id=workspace_id,
                migration_id=migration_id,
                migration_root=migration_root,
            )
        else:
            partial_source = migration_root / "source"
            if partial_source.exists():
                if not partial_source.is_dir() or partial_source.is_symlink():
                    raise SqliteMigrationError("未完成 recovery source 路径不安全")
                attempts = migration_root / "attempts"
                attempts.mkdir(exist_ok=True)
                os.replace(
                    partial_source,
                    attempts / f"partial-source-{uuid.uuid4().hex}",
                )
        _reset_failed_staging(migration_root)
    else:
        migration_root.mkdir(parents=True)
    preparation_report = migration_root / "preparation-report.json"
    phase = "recovery_copy"
    composer_result_node_count = 0
    composer_verified_node_count = 0
    composer_log_backfilled_node_count = 0
    composer_differences: list[dict[str, Any]] = []
    legacy_generation_log_count = 0
    imported_generation_log_count = 0
    remapped_generation_log_id_count = 0
    duplicate_generation_run_id_count = 0
    used_generation_log_ids: set[str] = set()
    imported_generation_run_count = 0
    imported_global_history_count = 0
    imported_publication_receipt_count = 0
    verified_managed_media_count = 0
    pending_publication_count = 0
    unmatched_history_run_ids: set[str] = set()
    imported_history_run_ids: set[str] = set()
    manual_actions: list[dict[str, Any]] = []
    legacy_global_history: tuple[tuple[str, str, dict[str, Any]], ...] = ()
    source_publication_receipt_count = 0
    try:
        recovery_manifest = existing_recovery_manifest or _create_recovery_copy(
            content,
            workspace_id=workspace_id,
            migration_id=migration_id,
            migration_root=migration_root,
        )
        phase = "create_staging"
        staging_directory.mkdir(parents=True)

        phase = "import_canvases"
        canvas_store = SqliteCanvasStore(
            canvas_database,
            workspace_id=workspace_id,
        )
        canvas_count = 0
        recovery_canvases = (
            recovery_manifest.parent / "source" / "data" / "canvases"
        )
        for source in sorted(recovery_canvases.glob("*.json")):
            document = _load_json(source, missing=None)
            if not isinstance(document, Mapping):
                raise SqliteMigrationError(
                    f"Canvas JSON 根节点无效：{source.name}"
                )
            canvas_id = str(document.get("id") or "").strip()
            if not canvas_id or source.stem != canvas_id:
                raise SqliteMigrationError(
                    f"Canvas ID 与文件名不一致：{source.name}"
                )
            phase = "freeze_composer"
            (
                frozen_document,
                composer_before,
                log_backfilled_node_count,
            ) = _freeze_composer_nodes(document)
            composer_result_node_count += len(composer_before)
            composer_log_backfilled_node_count += log_backfilled_node_count
            actor = _migration_actor(frozen_document)
            phase = "import_generation_history"
            legacy_logs = frozen_document.get("logs")
            if legacy_logs is None:
                legacy_logs = []
            if not isinstance(legacy_logs, list):
                raise SqliteMigrationError(
                    f"Canvas Generation History 必须是数组：{canvas_id}"
                )
            used_run_ids: set[str] = set()
            legacy_generation_log_count += len(legacy_logs)
            normalized_logs: list[dict[str, Any]] = []
            for index, legacy_log in enumerate(legacy_logs):
                (
                    normalized_log,
                    remapped_log_id,
                    duplicate_run_id,
                ) = normalize_legacy_generation_log(
                    legacy_log,
                    canvas_id=canvas_id,
                    index=index,
                    used_log_ids=used_generation_log_ids,
                    used_run_ids=used_run_ids,
                )
                normalized_logs.append(normalized_log)
                remapped_generation_log_id_count += int(remapped_log_id)
                duplicate_generation_run_id_count += int(duplicate_run_id)
            phase = "import_canvases"
            canvas_store.commit(
                canvas_id,
                actor,
                CanvasIntent.import_canvas(
                    frozen_document,
                    operation_id=_operation_id(migration_id, canvas_id),
                    generation_history=normalized_logs,
                ),
            )
            imported_generation_log_count += len(normalized_logs)
            imported = canvas_store.read(
                canvas_id,
                actor,
                CanvasProjection.migration_verification(),
            ).canvas
            if (
                imported is None
                or int(imported.get("revision") or 0)
                != max(0, int(frozen_document.get("revision") or 0))
                or list(imported.get("nodes") or [])
                != list(frozen_document.get("nodes") or [])
                or list(imported.get("connections") or [])
                != list(frozen_document.get("connections") or [])
            ):
                raise SqliteMigrationError(
                    f"Canvas 导入后校验失败：{canvas_id}"
                )
            phase = "verify_composer"
            composer_after = _composer_snapshots(imported)
            after_by_id = {
                snapshot["nodeId"]: snapshot for snapshot in composer_after
            }
            for before in composer_before:
                actual = after_by_id.get(before["nodeId"])
                if actual is None:
                    composer_differences.append(
                        {
                            "canvas_id": canvas_id,
                            "node_id": before["nodeId"],
                            "field": "missing_result_node",
                        }
                    )
                    continue
                node_differences = _composer_difference(
                    canvas_id=canvas_id,
                    expected=before,
                    actual=actual,
                )
                composer_differences.extend(node_differences)
                if not node_differences:
                    composer_verified_node_count += 1
            if composer_differences:
                raise SqliteMigrationError(
                    f"Composer 冻结审计失败：{canvas_id}"
                )
            canvas_count += 1

        phase = "initialize_generation_runs"
        run_store = SqliteGenerationRunStore(
            generation_run_database,
            workspace_id=workspace_id,
        )
        recovery_data = recovery_manifest.parent / "source" / "data"
        phase = "import_generation_runs"
        recovery_runs = _legacy_generation_runs(
            recovery_data / "generation-runs.json"
        )
        imported_run_ids: set[str] = set()
        imported_runs: dict[str, Any] = {}
        for legacy_run in recovery_runs:
            mapped = map_generation_run_lifecycle(legacy_run).state
            if mapped.status not in _TERMINAL_RUN_STATUSES:
                raise SqliteMigrationError(
                    f"迁移准备期间出现未结束 Generation Run：{mapped.run_id}"
                )
            try:
                run_store.save(mapped)
            except GenerationRunStoreError as exc:
                raise SqliteMigrationError(
                    f"Generation Run 无法导入：{mapped.run_id} ({exc.code})"
                ) from exc
            imported_run_ids.add(mapped.run_id)
            imported_runs[mapped.run_id] = mapped
            imported_generation_run_count += 1

        phase = "import_global_generation_history"
        legacy_global_history = normalize_legacy_global_history(
            _legacy_global_history(recovery_data / "generation-history.json")
        )
        # SQLite sequence is increasing; reverse insertion preserves the
        # legacy array's stable order for equal timestamps.
        for history_id, run_id, record in reversed(legacy_global_history):
            verified_managed_media_count += _verify_managed_media(
                content,
                record,
                label=f"Global Generation History {history_id}",
            )
            if run_id and run_id not in imported_run_ids:
                unmatched_history_run_ids.add(run_id)
            try:
                run_store.publish_history(
                    run_id,
                    history_id,
                    record,
                    source="legacy-json",
                )
            except GenerationRunStoreError as exc:
                raise SqliteMigrationError(
                    f"Global Generation History 无法导入：{history_id} ({exc.code})"
                ) from exc
            imported_global_history_count += 1
            if run_id:
                imported_history_run_ids.add(run_id)

        phase = "import_generation_publication_receipts"
        completed_receipts, pending_receipts = _legacy_publication_receipts(
            recovery_data / "generation-effects.json"
        )
        source_publication_receipt_count = sum(
            len(names) for names in completed_receipts.values()
        ) + sum(len(names) for names in pending_receipts.values())
        for run_id, names in sorted(completed_receipts.items()):
            for name in sorted(names):
                run_store.seed_publication_receipt(
                    run_id,
                    name,
                    completed=True,
                )
        for run_id, names in sorted(pending_receipts.items()):
            pending_names = set(names)
            if "history" in pending_names and run_id in imported_history_run_ids:
                run_store.seed_publication_receipt(
                    run_id,
                    "history",
                    completed=True,
                )
                pending_names.remove("history")
            if not pending_names:
                continue
            run = imported_runs.get(run_id)
            prepared = run.prepared_output if run is not None else None
            effects = (
                prepared.get("effects")
                if isinstance(prepared, Mapping)
                else None
            )
            if run is None or not isinstance(effects, Mapping):
                manual_actions.append(
                    {
                        "run_id": run_id,
                        "effects": sorted(pending_names),
                        "reason": "durable_run_or_prepared_output_missing",
                    }
                )
                continue
            for name in sorted(pending_names):
                payload = effects.get(name)
                if not isinstance(payload, Mapping):
                    manual_actions.append(
                        {
                            "run_id": run_id,
                            "effects": [name],
                            "reason": "reconstructable_effect_payload_missing",
                        }
                    )
                    continue
                verified = _verify_managed_media(
                    content,
                    payload,
                    label=f"pending {name} receipt {run_id}",
                )
                if verified <= 0:
                    manual_actions.append(
                        {
                            "run_id": run_id,
                            "effects": [name],
                            "reason": "reconstructable_managed_output_missing",
                        }
                    )
                    continue
                verified_managed_media_count += verified
                run_store.seed_publication_receipt(
                    run_id,
                    name,
                    completed=False,
                    payload=payload,
                    created_at=run.updated_at,
                )
                pending_publication_count += 1
        imported_publication_receipt_count = int(
            run_store.integrity()["counts"]["publications"]
        )
        if manual_actions:
            raise SqliteMigrationError(
                "存在无法安全匹配的 pending Generation effect；"
                "请按 preparation report 人工处理后重试"
            )

        phase = "verify_integrity"
        canvas_integrity = canvas_store.integrity()
        run_integrity = run_store.integrity()
        imported_publication_receipt_count = int(
            run_integrity["counts"]["publications"]
        )
        if (
            not canvas_integrity.get("ok")
            or not run_integrity.get("ok")
            or int(canvas_integrity["counts"]["canvases"]) != canvas_count
            or int(canvas_integrity["counts"]["logs"])
            != imported_generation_log_count
            or imported_generation_log_count != legacy_generation_log_count
            or int(run_integrity["counts"]["runs"])
            != imported_generation_run_count
            or int(run_integrity["counts"]["history"])
            != imported_global_history_count
            or int(run_integrity["counts"]["pending_publications"])
            != pending_publication_count
        ):
            raise SqliteMigrationError("SQLite staging 完整性检查失败")
    except Exception as exc:
        try:
            _write_preparation_report(
                preparation_report,
                workspace_id=workspace_id,
                migration_id=migration_id,
                status="failed",
                phase=phase,
                details={
                    "error_type": type(exc).__name__,
                    "reason": (
                        str(exc)
                        if isinstance(exc, SqliteMigrationError)
                        else "unexpected migration preparation failure"
                    ),
                    "authority_published": False,
                    "composer_audit": {
                        "result_node_count": composer_result_node_count,
                        "verified_node_count": composer_verified_node_count,
                        "log_backfilled_node_count": composer_log_backfilled_node_count,
                        "differences": composer_differences,
                    },
                    "generation_history_audit": {
                        "legacy_count": legacy_generation_log_count,
                        "imported_count": imported_generation_log_count,
                        "remapped_log_id_count": remapped_generation_log_id_count,
                        "duplicate_run_id_count": duplicate_generation_run_id_count,
                    },
                    "global_history_audit": {
                        "source_count": len(legacy_global_history),
                        "imported_count": imported_global_history_count,
                        "unmatched_run_ids": sorted(unmatched_history_run_ids),
                    },
                    "publication_audit": {
                        "source_count": source_publication_receipt_count,
                        "receipt_count": imported_publication_receipt_count,
                        "pending_count": pending_publication_count,
                        "manual_actions": manual_actions,
                    },
                    "managed_media_verified_count": verified_managed_media_count,
                },
            )
        except OSError:
            pass
        raise

    _write_preparation_report(
        preparation_report,
        workspace_id=workspace_id,
        migration_id=migration_id,
        status="ready",
        phase="complete",
        details={
            "canvas_count": canvas_count,
            "legacy_generation_log_count": legacy_generation_log_count,
            "imported_generation_log_count": imported_generation_log_count,
            "imported_generation_run_count": imported_generation_run_count,
            "omitted_terminal_run_count": 0,
            "canvas_database_sha256": _sha256(canvas_database),
            "generation_run_database_sha256": _sha256(
                generation_run_database
            ),
            "canvas_integrity": canvas_integrity,
            "generation_run_integrity": run_integrity,
            "composer_audit": {
                "result_node_count": composer_result_node_count,
                "verified_node_count": composer_verified_node_count,
                "log_backfilled_node_count": composer_log_backfilled_node_count,
                "differences": composer_differences,
            },
            "generation_history_audit": {
                "legacy_count": legacy_generation_log_count,
                "imported_count": imported_generation_log_count,
                "remapped_log_id_count": remapped_generation_log_id_count,
                "duplicate_run_id_count": duplicate_generation_run_id_count,
            },
            "global_history_audit": {
                "source_count": len(legacy_global_history),
                "imported_count": imported_global_history_count,
                "unmatched_run_ids": sorted(unmatched_history_run_ids),
            },
            "publication_audit": {
                "source_count": source_publication_receipt_count,
                "receipt_count": imported_publication_receipt_count,
                "pending_count": pending_publication_count,
                "manual_actions": manual_actions,
            },
            "managed_media_verified_count": verified_managed_media_count,
            "authority_published": False,
        },
    )
    return SqliteMigrationPreparation(
        ok=True,
        workspace_id=workspace_id,
        migration_id=migration_id,
        staging_directory=staging_directory,
        recovery_manifest=recovery_manifest,
        preparation_report=preparation_report,
        canvas_database=canvas_database,
        generation_run_database=generation_run_database,
        canvas_count=canvas_count,
        legacy_generation_log_count=legacy_generation_log_count,
        imported_generation_log_count=imported_generation_log_count,
        imported_generation_run_count=imported_generation_run_count,
        imported_global_history_count=imported_global_history_count,
        imported_publication_receipt_count=imported_publication_receipt_count,
        omitted_terminal_run_count=0,
        canvas_integrity=canvas_integrity,
        generation_run_integrity=run_integrity,
        composer_audit={
            "result_node_count": composer_result_node_count,
            "verified_node_count": composer_verified_node_count,
            "log_backfilled_node_count": composer_log_backfilled_node_count,
            "differences": tuple(composer_differences),
        },
    )


__all__ = [
    "SqliteMigrationError",
    "SqliteMigrationPreparation",
    "normalize_legacy_generation_log",
    "prepare_sqlite_migration",
]
