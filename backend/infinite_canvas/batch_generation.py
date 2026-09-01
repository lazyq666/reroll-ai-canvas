"""Batch image generation as one Workspace-owned domain facade."""

from __future__ import annotations

import copy
import asyncio
import inspect
import itertools
import json
import logging
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, Mapping, Optional


MAX_GENERATION_RUNS = 500
MAX_GENERATION_OUTPUTS = 1000
MAX_PROMPT_MODULES = 10
MAX_IMAGE_VARIABLES = 20
DEFAULT_BATCH_CONCURRENCY = 2
MAX_BATCH_CONCURRENCY = 32


class BatchGenerationError(RuntimeError):
    pass


class BatchGenerationValidation(BatchGenerationError):
    pass


Submit = Callable[..., Awaitable[Mapping[str, Any]]]
InspectRun = Callable[..., Any]
CancelRun = Callable[..., Any]
TaskValidator = Callable[[Mapping[str, Any]], None]


def _clean_options(values: Any) -> list:
    if not isinstance(values, list):
        return []
    return [copy.deepcopy(value) for value in values if value not in (None, "")]


def _effective_image_variables(values: Any) -> list[Dict[str, Any]]:
    if not isinstance(values, list):
        return []
    effective = []
    for value in values:
        if not isinstance(value, Mapping):
            continue
        options = _clean_options(value.get("options"))
        if not options:
            continue
        variable = copy.deepcopy(dict(value))
        variable["options"] = options
        effective.append(variable)
    return effective


def _prompt_option_text(value: Any) -> str:
    if isinstance(value, Mapping):
        for key in ("value", "content", "text"):
            if value.get(key) not in (None, ""):
                return str(value.get(key))
        return ""
    return str(value or "")


def _prompt_option_reference(
    value: Any, *, module_name: str
) -> Optional[Dict[str, str]]:
    if not isinstance(value, Mapping):
        return None
    relative_path = str(
        value.get("relative_path") or value.get("relativePath") or ""
    ).strip()
    name = str(value.get("name") or "").strip()
    if not name and relative_path:
        name = relative_path.replace("\\", "/").rstrip("/").split("/")[-1]
    if not name and not relative_path:
        return None
    return {
        "module": module_name,
        "name": name or relative_path,
        "relative_path": relative_path or name,
    }


def _batch_default_name(snapshot: Mapping[str, Any], timestamp: float) -> str:
    model_names = []
    for value in _clean_options(snapshot.get("models")):
        if isinstance(value, Mapping):
            label = str(value.get("name") or value.get("model") or "").strip()
        else:
            label = str(value or "").strip()
        if label and label not in model_names:
            model_names.append(label)

    ratio_names = []
    for value in _clean_options(snapshot.get("ratios")):
        label = str(value or "").strip()
        if label and label not in ratio_names:
            ratio_names.append(label)

    settings = snapshot.get("settings") or {}
    resolution = str(settings.get("resolution") or "auto").strip()
    created = time.strftime("%m-%d %H:%M", time.localtime(timestamp))
    return "·".join((
        "+".join(model_names) or "auto",
        "+".join(ratio_names) or "auto",
        resolution,
        created,
    ))


def _setting_count(
    settings: Mapping[str, Any],
    key: str,
    *,
    legacy_key: str = "",
    label: str,
) -> int:
    raw = settings.get(key)
    if raw in (None, "") and legacy_key:
        raw = settings.get(legacy_key)
    try:
        value = int(raw or 1)
    except (TypeError, ValueError) as exc:
        raise BatchGenerationValidation(f"{label}必须是 1 到 8") from exc
    if value < 1 or value > 8:
        raise BatchGenerationValidation(f"{label}必须是 1 到 8")
    return value


def _desired_concurrency(settings: Mapping[str, Any]) -> int:
    raw = settings.get("desired_concurrency")
    if raw in (None, ""):
        return DEFAULT_BATCH_CONCURRENCY
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise BatchGenerationValidation(
            "期望并发必须是自动或 1 到 32"
        ) from exc
    if value == 0:
        return value
    if value < 1 or value > MAX_BATCH_CONCURRENCY:
        raise BatchGenerationValidation("期望并发必须是自动或 1 到 32")
    return value


def _result_outputs(value: Any) -> list[str]:
    outputs: list[str] = []

    def collect(item: Any) -> None:
        if isinstance(item, str):
            if item and item not in outputs:
                outputs.append(item)
            return
        if isinstance(item, (list, tuple)):
            for child in item:
                collect(child)
            return
        if not isinstance(item, Mapping):
            return
        if str(item.get("type") or "").lower() in {"url", "image"}:
            collect(item.get("value"))
        for key in ("urls", "images", "outputs", "url"):
            if key in item:
                collect(item.get(key))

    collect(value)
    return outputs


class BatchGeneration:
    """Own combinations, snapshots, persistence, execution and permissions."""

    def __init__(
        self,
        database_path: Path,
        *,
        submit: Submit,
        inspect_run: Optional[InspectRun] = None,
        cancel_run: Optional[CancelRun] = None,
        task_validator: Optional[TaskValidator] = None,
        now: Callable[[], float] = time.time,
        system_limit: int = MAX_BATCH_CONCURRENCY,
        provider_limit: int = MAX_BATCH_CONCURRENCY,
        user_limit: int = MAX_BATCH_CONCURRENCY,
        scheduler_interval: float = 1.0,
    ) -> None:
        self._database_path = Path(database_path)
        self._submit = submit
        self._inspect_run = inspect_run
        self._cancel_run = cancel_run
        self._task_validator = task_validator
        self._now = now
        self._system_limit = min(
            MAX_BATCH_CONCURRENCY, max(1, int(system_limit))
        )
        self._provider_limit = min(
            MAX_BATCH_CONCURRENCY, max(1, int(provider_limit))
        )
        self._user_limit = min(
            MAX_BATCH_CONCURRENCY, max(1, int(user_limit))
        )
        self._scheduler_interval = max(0.01, float(scheduler_interval))
        self._dispatch_lock = asyncio.Lock()
        self._scheduler_task: Optional[asyncio.Task[Any]] = None
        self._scheduler_wakeup: Optional[asyncio.Event] = None
        self._scheduler_stopping = False
        self._last_owner = ""
        self._last_batch_by_owner: Dict[str, str] = {}
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        self._database_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(str(self._database_path))
        connection.row_factory = sqlite3.Row
        return connection

    def _ensure_schema(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS batches (
                    id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    snapshot TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS batch_tasks (
                    batch_id TEXT NOT NULL,
                    task_index INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    task TEXT NOT NULL,
                    run_id TEXT NOT NULL DEFAULT '',
                    outputs TEXT NOT NULL DEFAULT '[]',
                    error TEXT NOT NULL DEFAULT '',
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (batch_id, task_index)
                );
                """
            )
            columns = {
                row[1] for row in connection.execute(
                    "PRAGMA table_info(batch_tasks)"
                )
            }
            if "attempt_count" not in columns:
                connection.execute(
                    "ALTER TABLE batch_tasks ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0"
                )

    def preview(self, value: Mapping[str, Any]) -> Dict[str, Any]:
        request = copy.deepcopy(dict(value or {}))
        prompt_modules = request.get("prompt_modules") or []
        raw_image_variables = request.get("image_variables") or []
        if len(prompt_modules) > MAX_PROMPT_MODULES:
            raise BatchGenerationValidation("最多支持 10 个提示词模块")
        if len(raw_image_variables) > MAX_IMAGE_VARIABLES:
            raise BatchGenerationValidation(
                f"最多支持 {MAX_IMAGE_VARIABLES} 个图片变量"
            )
        image_variables = _effective_image_variables(raw_image_variables)

        dimensions = []
        for module in prompt_modules:
            module_name = str((module or {}).get("name") or "")
            options = [
                (
                    _prompt_option_text(option),
                    _prompt_option_reference(
                        option, module_name=module_name
                    ),
                )
                for option in _clean_options((module or {}).get("options"))
                if _prompt_option_text(option).strip()
            ]
            if not options:
                raise BatchGenerationValidation("提示词模块必须至少包含一个选项")
            dimensions.append(options)
        for variable in image_variables:
            options = _clean_options((variable or {}).get("options"))
            if not options:
                raise BatchGenerationValidation("图片变量必须至少包含一个选项")
            dimensions.append(options)

        models = _clean_options(request.get("models")) or [""]
        ratios = _clean_options(request.get("ratios")) or [""]
        dimensions.extend((models, ratios))
        combinations = list(itertools.product(*dimensions))
        run_count = len(combinations)
        settings = copy.deepcopy(request.get("settings") or {})
        settings["desired_concurrency"] = _desired_concurrency(settings)
        outputs_per_submission = _setting_count(
            settings,
            "outputs_per_submission",
            legacy_key="outputs_per_run",
            label="每次提交输出数",
        )
        submissions_per_task = _setting_count(
            settings,
            "submissions_per_task",
            label="每任务提交次数",
        )
        submission_count = run_count * submissions_per_task
        output_count = submission_count * outputs_per_submission
        if run_count > MAX_GENERATION_RUNS:
            raise BatchGenerationValidation(
                "单批次最多支持 500 个 Generation Run，请减少变量选项"
            )
        if output_count > MAX_GENERATION_OUTPUTS:
            raise BatchGenerationValidation(
                "单批次最多预计 1000 个 Generation Output，"
                "请减少任务、每任务提交次数或每次提交输出数"
            )

        prompt_count = len(prompt_modules)
        image_count = len(image_variables)
        tasks = []
        for index, combination in enumerate(combinations):
            prompt_choices = combination[:prompt_count]
            image_values = combination[prompt_count:prompt_count + image_count]
            model_value = combination[-2]
            if isinstance(model_value, Mapping):
                model = str(model_value.get("model") or "")
                model_name = str(model_value.get("name") or model)
                provider_id = str(
                    model_value.get("provider_id")
                    or settings.get("provider_id")
                    or ""
                )
            else:
                model = str(model_value or "")
                model_name = model
                provider_id = str(settings.get("provider_id") or "")
            task = {
                "index": index,
                "prompt": ",\n".join(choice[0] for choice in prompt_choices),
                "prompt_references": [
                    copy.deepcopy(choice[1])
                    for choice in prompt_choices
                    if choice[1]
                ],
                "reference_images": list(image_values),
                "model": model,
                "model_name": model_name,
                "provider_id": provider_id,
                "ratio": combination[-1],
                "outputs": (
                    outputs_per_submission * submissions_per_task
                ),
                "outputs_per_submission": outputs_per_submission,
                "submissions": submissions_per_task,
                "settings": copy.deepcopy(settings),
            }
            self._validate_task(task)
            tasks.append(task)
        return {
            "generation_run_count": run_count,
            "estimated_submission_count": submission_count,
            "estimated_output_count": output_count,
            "tasks": tasks,
        }

    async def start(self, value: Mapping[str, Any], *, owner: str) -> Dict[str, Any]:
        snapshot = copy.deepcopy(dict(value or {}))
        settings = copy.deepcopy(snapshot.get("settings") or {})
        settings["desired_concurrency"] = _desired_concurrency(settings)
        snapshot["settings"] = settings
        preview = self.preview(snapshot)
        snapshot["image_variables"] = _effective_image_variables(
            snapshot.get("image_variables")
        )
        excluded = {
            int(index) for index in snapshot.get("excluded", [])
            if isinstance(index, int) or str(index).isdigit()
        }
        batch_id = "batch_" + uuid.uuid4().hex
        timestamp = float(self._now())
        name = str(snapshot.get("name") or "").strip()
        if not name:
            name = _batch_default_name(snapshot, timestamp)
            prefix = str(snapshot.get("name_prefix") or "").strip().strip("_")
            if prefix:
                name = f"{prefix}_{name}"
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO batches VALUES (?, ?, ?, ?, ?, ?, ?)",
                (batch_id, str(owner), name, "running", json.dumps(
                    snapshot, ensure_ascii=False
                ), timestamp, timestamp),
            )
            for task in preview["tasks"]:
                if task["index"] in excluded:
                    continue
                stored_task = copy.deepcopy(task)
                stored_task["batch_name"] = name
                connection.execute(
                    "INSERT INTO batch_tasks (batch_id, task_index, status, task) VALUES (?, ?, ?, ?)",
                    (batch_id, task["index"], "queued", json.dumps(
                        stored_task, ensure_ascii=False
                    )),
                )

        self._wake_scheduler()
        await self._dispatch_available()
        return self.get(batch_id, owner=str(owner))

    def _require_batch(
        self,
        batch_id: str,
        *,
        owner: str = "",
        admin: bool = False,
    ) -> sqlite3.Row:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM batches WHERE id=?", (str(batch_id),)
            ).fetchone()
        if row is None or (not admin and row["owner"] != str(owner)):
            raise KeyError(batch_id)
        return row

    def _scheduler_state(self) -> tuple:
        with self._connect() as connection:
            active_rows = connection.execute(
                """
                SELECT t.batch_id, t.task, b.owner
                FROM batch_tasks t JOIN batches b ON b.id=t.batch_id
                WHERE t.run_id<>'' AND t.status IN ('queued','running')
                  AND b.status<>'deleted'
                """
            ).fetchall()
            candidate_rows = connection.execute(
                """
                SELECT t.batch_id, t.task_index, t.task, b.owner,
                       b.snapshot, b.created_at
                FROM batch_tasks t JOIN batches b ON b.id=t.batch_id
                WHERE t.run_id='' AND t.status='queued' AND b.status='running'
                ORDER BY b.created_at, t.task_index
                """
            ).fetchall()
        system_active = len(active_rows)
        provider_active: Dict[str, int] = {}
        user_active: Dict[str, int] = {}
        batch_active: Dict[str, int] = {}
        for row in active_rows:
            task = json.loads(row["task"])
            provider = str(task.get("provider_id") or "")
            provider_active[provider] = provider_active.get(provider, 0) + 1
            user_active[row["owner"]] = user_active.get(row["owner"], 0) + 1
            batch_active[row["batch_id"]] = batch_active.get(row["batch_id"], 0) + 1
        return (
            system_active,
            provider_active,
            user_active,
            batch_active,
            list(candidate_rows),
        )

    def _select_candidate(self, state: tuple) -> Optional[sqlite3.Row]:
        system_active, provider_active, user_active, batch_active, candidates = state
        if system_active >= self._system_limit:
            return None
        candidates.sort(key=lambda row: (
            row["owner"] == self._last_owner,
            row["batch_id"] == self._last_batch_by_owner.get(row["owner"], ""),
            row["created_at"],
            row["task_index"],
        ))
        for row in candidates:
            task = json.loads(row["task"])
            provider = str(task.get("provider_id") or "")
            settings = json.loads(row["snapshot"]).get("settings") or {}
            raw_desired = settings.get("desired_concurrency")
            desired = (
                DEFAULT_BATCH_CONCURRENCY
                if raw_desired in (None, "")
                else int(raw_desired)
            )
            batch_limit = min(
                self._system_limit,
                self._user_limit,
                self._provider_limit,
                desired if desired > 0 else self._user_limit,
            )
            if provider_active.get(provider, 0) >= self._provider_limit:
                continue
            if user_active.get(row["owner"], 0) >= self._user_limit:
                continue
            if batch_active.get(row["batch_id"], 0) >= batch_limit:
                continue
            return row
        return None

    async def _dispatch_available(self) -> None:
        async with self._dispatch_lock:
            # Slot counts come from SQLite, so reconcile every batch before
            # completed runs can be mistaken for active work.
            self._refresh_all_runs()
            while True:
                state = self._scheduler_state()
                candidate = self._select_candidate(state)
                if candidate is None:
                    break
                task = json.loads(candidate["task"])
                self._last_owner = candidate["owner"]
                self._last_batch_by_owner[candidate["owner"]] = candidate["batch_id"]
                try:
                    self._validate_task(task)
                    result = self._submit(
                        task,
                        owner=candidate["owner"],
                        batch_id=candidate["batch_id"],
                    )
                    if inspect.isawaitable(result):
                        result = await result
                    result = dict(result or {})
                    self._finish_task(
                        candidate["batch_id"],
                        candidate["task_index"],
                        status=str(result.get("status") or "succeeded"),
                        run_id=str(result.get("run_id") or ""),
                        outputs=result.get("outputs") or [],
                        attempted=True,
                    )
                except Exception as exc:
                    self._finish_task(
                        candidate["batch_id"],
                        candidate["task_index"],
                        status="failed",
                        error=str(exc),
                        attempted=True,
                    )
                self._finish_batch(candidate["batch_id"])

    def _validate_task(self, task: Mapping[str, Any]) -> None:
        if self._task_validator is None:
            return
        try:
            self._task_validator(task)
        except BatchGenerationValidation as exc:
            index = int(task.get("index") or 0) + 1
            raise BatchGenerationValidation(
                f"任务 {index}：{exc}"
            ) from exc

    def _scheduler_has_work(self) -> bool:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT 1
                FROM batch_tasks t JOIN batches b ON b.id=t.batch_id
                WHERE (
                    t.run_id<>'' AND t.status IN ('queued','running')
                    AND b.status<>'deleted'
                ) OR (
                    t.run_id='' AND t.status='queued' AND b.status='running'
                )
                LIMIT 1
                """
            ).fetchone()
        return row is not None

    def _wake_scheduler(self) -> None:
        if self._scheduler_wakeup is not None:
            self._scheduler_wakeup.set()

    async def _scheduler_loop(self) -> None:
        while not self._scheduler_stopping:
            try:
                await self._dispatch_available()
                has_work = self._scheduler_has_work()
            except Exception:
                logging.exception("batch generation scheduler tick failed")
                has_work = True
            if self._scheduler_stopping:
                break
            wakeup = self._scheduler_wakeup
            if wakeup is None:
                break
            wakeup.clear()
            if has_work:
                try:
                    await asyncio.wait_for(
                        wakeup.wait(), timeout=self._scheduler_interval
                    )
                except asyncio.TimeoutError:
                    pass
            else:
                if self._scheduler_has_work():
                    continue
                await wakeup.wait()

    async def start_scheduler(self) -> None:
        task = self._scheduler_task
        if task is not None and not task.done():
            return
        self._scheduler_stopping = False
        self._scheduler_wakeup = asyncio.Event()
        self._scheduler_task = asyncio.create_task(
            self._scheduler_loop(),
            name="infinite-canvas-batch-generation-scheduler",
        )
        self._wake_scheduler()
        await asyncio.sleep(0)

    async def stop_scheduler(self) -> None:
        task = self._scheduler_task
        if task is None:
            return
        self._scheduler_stopping = True
        self._wake_scheduler()
        if task is not asyncio.current_task():
            await asyncio.gather(task, return_exceptions=True)
        if self._scheduler_task is task:
            self._scheduler_task = None
            self._scheduler_wakeup = None

    async def query(
        self,
        batch_id: str,
        *,
        owner: str = "",
        admin: bool = False,
    ) -> Dict[str, Any]:
        row = self._require_batch(batch_id, owner=owner, admin=admin)
        self._refresh_runs(batch_id, row["owner"])
        await self._dispatch_available()
        return self.get(batch_id, owner=owner, admin=admin)

    def pause(self, batch_id: str, *, owner: str = "", admin: bool = False) -> Dict[str, Any]:
        self._require_batch(batch_id, owner=owner, admin=admin)
        with self._connect() as connection:
            connection.execute(
                "UPDATE batches SET status='paused', updated_at=? WHERE id=? AND status IN ('running','queued')",
                (float(self._now()), batch_id),
            )
        return self.get(batch_id, owner=owner, admin=admin)

    async def resume(self, batch_id: str, *, owner: str = "", admin: bool = False) -> Dict[str, Any]:
        self._require_batch(batch_id, owner=owner, admin=admin)
        with self._connect() as connection:
            connection.execute(
                "UPDATE batches SET status='running', updated_at=? WHERE id=? AND status='paused'",
                (float(self._now()), batch_id),
            )
        self._wake_scheduler()
        await self._dispatch_available()
        return self.get(batch_id, owner=owner, admin=admin)

    async def cancel(
        self,
        batch_id: str,
        *,
        owner: str = "",
        admin: bool = False,
    ) -> Dict[str, Any]:
        row = self._require_batch(batch_id, owner=owner, admin=admin)
        batch_owner = str(row["owner"])
        async with self._dispatch_lock:
            self._refresh_runs(batch_id, batch_owner)
            with self._connect() as connection:
                connection.execute(
                    """
                    UPDATE batch_tasks SET status='cancelled'
                    WHERE batch_id=? AND run_id='' AND status='queued'
                    """,
                    (batch_id,),
                )
                connection.execute(
                    "UPDATE batches SET status='cancelled', updated_at=? WHERE id=?",
                    (float(self._now()), batch_id),
                )
                active_rows = connection.execute(
                    """
                    SELECT task_index, run_id FROM batch_tasks
                    WHERE batch_id=? AND run_id<>''
                      AND status IN ('queued','running')
                    """,
                    (batch_id,),
                ).fetchall()
            for active_row in active_rows:
                result: Any = None
                error = ""
                try:
                    if self._cancel_run is not None:
                        result = self._cancel_run(
                            active_row["run_id"], owner=batch_owner
                        )
                        if inspect.isawaitable(result):
                            result = await result
                except Exception as exc:
                    error = f"取消 Generation Run 失败：{exc}"
                if isinstance(result, Mapping):
                    result_status = str(result.get("status") or "")
                    run_result = result.get("result")
                    run_error = str(result.get("error") or "")
                else:
                    result_status = str(getattr(result, "status", "") or "")
                    run_result = getattr(result, "result", None)
                    run_error = str(getattr(result, "error", "") or "")
                status = (
                    result_status
                    if result_status in {"succeeded", "failed", "cancelled"}
                    else "cancelled"
                )
                self._finish_task(
                    batch_id,
                    active_row["task_index"],
                    status=status,
                    run_id=active_row["run_id"],
                    outputs=_result_outputs(run_result),
                    error=error or run_error,
                )
        self._wake_scheduler()
        await self._dispatch_available()
        return self.get(batch_id, owner=owner, admin=admin)

    def list(
        self,
        *,
        owner: str = "",
        admin: bool = False,
        creator: str = "",
        status: str = "",
    ) -> list:
        clauses = ["status<>'deleted'"]
        values = []
        if not admin:
            clauses.append("owner=?")
            values.append(str(owner))
        elif creator:
            clauses.append("owner=?")
            values.append(str(creator))
        if status:
            clauses.append("status=?")
            values.append(str(status))
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT id, owner FROM batches WHERE "
                + " AND ".join(clauses)
                + " ORDER BY created_at DESC",
                tuple(values),
            ).fetchall()
        return [
            self.get(row["id"], owner=owner, admin=admin)
            for row in rows
        ]

    def rename(
        self,
        batch_id: str,
        name: str,
        *,
        owner: str = "",
        admin: bool = False,
    ) -> Dict[str, Any]:
        self._require_batch(batch_id, owner=owner, admin=admin)
        clean = " ".join(str(name or "").split()).strip()[:120]
        if not clean:
            raise BatchGenerationValidation("批次名称不能为空")
        with self._connect() as connection:
            connection.execute(
                "UPDATE batches SET name=?, updated_at=? WHERE id=?",
                (clean, float(self._now()), batch_id),
            )
        return self.get(batch_id, owner=owner, admin=admin)

    async def retry_failed(
        self,
        batch_id: str,
        *,
        owner: str = "",
        admin: bool = False,
    ) -> Dict[str, Any]:
        self._require_batch(batch_id, owner=owner, admin=admin)
        with self._connect() as connection:
            updated = connection.execute(
                """
                UPDATE batch_tasks
                SET status='queued', run_id='', outputs='[]', error=''
                WHERE batch_id=? AND status='failed'
                """,
                (batch_id,),
            ).rowcount
            if updated:
                connection.execute(
                    "UPDATE batches SET status='running', updated_at=? WHERE id=?",
                    (float(self._now()), batch_id),
                )
        self._wake_scheduler()
        await self._dispatch_available()
        return self.get(batch_id, owner=owner, admin=admin)

    async def rerun(
        self,
        batch_id: str,
        *,
        owner: str = "",
        admin: bool = False,
    ) -> Dict[str, Any]:
        row = self._require_batch(batch_id, owner=owner, admin=admin)
        snapshot = json.loads(row["snapshot"])
        snapshot["name"] = f"{row['name']} · 重跑"
        return await self.start(snapshot, owner=row["owner"])

    async def resume_pending(self) -> None:
        self._refresh_all_runs()
        self._wake_scheduler()
        await self._dispatch_available()

    def _finish_task(
        self,
        batch_id: str,
        task_index: int,
        *,
        status: str,
        run_id: str = "",
        outputs: Any = None,
        error: str = "",
        attempted: bool = False,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                "UPDATE batch_tasks SET status=?, run_id=?, outputs=?, error=?, attempt_count=attempt_count+? WHERE batch_id=? AND task_index=?",
                (status, run_id, json.dumps(outputs or [], ensure_ascii=False),
                 error, 1 if attempted else 0, batch_id, task_index),
            )

    def _finish_batch(self, batch_id: str) -> None:
        with self._connect() as connection:
            batch = connection.execute(
                "SELECT status FROM batches WHERE id=?", (batch_id,)
            ).fetchone()
            if batch is None or batch["status"] in {"cancelled", "deleted"}:
                return
            statuses = [row[0] for row in connection.execute(
                "SELECT status FROM batch_tasks WHERE batch_id=?", (batch_id,)
            )]
            failed = any(status == "failed" for status in statuses)
            succeeded = any(status == "succeeded" for status in statuses)
            active = any(status in {"queued", "running"} for status in statuses)
            if batch["status"] == "paused" and active:
                status = "paused"
            else:
                status = "running" if active else (
                "partially_failed" if failed and succeeded else (
                    "failed" if failed else "completed"
                )
            )
            connection.execute(
                "UPDATE batches SET status=?, updated_at=? WHERE id=?",
                (status, float(self._now()), batch_id),
            )

    def get(self, batch_id: str, *, owner: str = "", admin: bool = False) -> Dict[str, Any]:
        batch = self._require_batch(batch_id, owner=owner, admin=admin)
        self._refresh_runs(str(batch_id), batch["owner"])
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM batches WHERE id=?", (str(batch_id),)
            ).fetchone()
            task_rows = connection.execute(
                "SELECT * FROM batch_tasks WHERE batch_id=? ORDER BY task_index",
                (str(batch_id),),
            ).fetchall()
        tasks = []
        counts = {"queued": 0, "running": 0, "succeeded": 0, "failed": 0, "cancelled": 0}
        for task_row in task_rows:
            task = json.loads(task_row["task"])
            task.update({
                "status": task_row["status"],
                "run_id": task_row["run_id"],
                "outputs": json.loads(task_row["outputs"]),
                "error": task_row["error"],
                "attempt_count": task_row["attempt_count"],
            })
            tasks.append(task)
            counts[task_row["status"]] = counts.get(task_row["status"], 0) + 1
        return {
            "id": row["id"], "owner": row["owner"], "name": row["name"],
            "status": row["status"], "snapshot": json.loads(row["snapshot"]),
            "created_at": row["created_at"], "updated_at": row["updated_at"],
            "progress": {**counts, "total": len(tasks)}, "tasks": tasks,
        }

    def _refresh_runs(self, batch_id: str, owner: str) -> None:
        if self._inspect_run is None:
            return
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT task_index, run_id, status FROM batch_tasks
                WHERE batch_id=? AND run_id<>'' AND (
                    status IN ('queued','running')
                    OR (status='succeeded' AND outputs='[]')
                )
                """,
                (batch_id,),
            ).fetchall()
        changed = False
        for row in rows:
            try:
                run = self._inspect_run(row["run_id"], owner=owner)
            except Exception:
                continue
            status = str(getattr(run, "status", "") or "")
            if status not in {"succeeded", "failed", "cancelled"}:
                if status == "running" and row["status"] != "running":
                    self._finish_task(batch_id, row["task_index"], status="running", run_id=row["run_id"])
                    changed = True
                continue
            result = getattr(run, "result", None)
            outputs = _result_outputs(result)
            self._finish_task(
                batch_id,
                row["task_index"],
                status=status,
                run_id=row["run_id"],
                outputs=outputs,
                error=str(getattr(run, "error", "") or ""),
            )
            changed = True
        if changed:
            self._finish_batch(batch_id)

    def _refresh_all_runs(self) -> None:
        if self._inspect_run is None:
            return
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT DISTINCT t.batch_id, b.owner
                FROM batch_tasks t JOIN batches b ON b.id=t.batch_id
                WHERE t.run_id<>'' AND t.status IN ('queued','running')
                """
            ).fetchall()
        for row in rows:
            self._refresh_runs(row["batch_id"], row["owner"])


__all__ = [
    "BatchGeneration", "BatchGenerationError", "BatchGenerationValidation",
    "DEFAULT_BATCH_CONCURRENCY", "MAX_BATCH_CONCURRENCY",
    "MAX_GENERATION_OUTPUTS", "MAX_GENERATION_RUNS",
]
