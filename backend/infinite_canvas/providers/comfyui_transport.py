"""ComfyUI execution tracking with WebSocket progress and HTTP recovery."""
from __future__ import annotations

import json
import time
from urllib.parse import urlencode
import requests


def connect_events(backend: str, client_id: str):
    try:
        from websockets.sync.client import connect
        return connect(
            f"ws://{backend}/ws?{urlencode({'clientId': client_id})}",
            open_timeout=3, close_timeout=1, max_size=2**20, proxy=None,
        )
    except Exception:
        # Polling remains authoritative when WS is unavailable or disconnects.
        return None


def history_error(history: dict) -> str:
    status = history.get("status") or {}
    if status.get("status_str") == "error":
        for entry in reversed(status.get("messages") or []):
            if isinstance(entry, (list, tuple)) and len(entry) > 1 and isinstance(entry[1], dict):
                data = entry[1]
                if entry[0] == "execution_interrupted":
                    return "comfy.execution_interrupted"
                message = data.get("exception_message") or data.get("error")
                if message:
                    return str(message)
        return "comfy.execution_failed"
    return ""


def node_stage(node_id: str, classes: dict, adapter: str = "") -> str:
    if adapter == "h3":
        if node_id == "12":
            return "comfy-sampling-first"
        if node_id == "13":
            return "comfy-upscaling"
        if node_id == "19":
            return "comfy-sampling-second"
        if node_id in {"20", "21", "reroll_h3_trim_audio", "reroll_h3_trim_frames", "reroll_h3_create_video"}:
            return "comfy-encoding"
    name = str(classes.get(node_id) or "").lower()
    if "sampler" in name:
        return "comfy-sampling"
    if "save" in name or "videocombine" in name:
        return "comfy-encoding"
    return "comfy-preparing"


def queue_position(queue: dict, prompt_id: str):
    if any(len(item) > 1 and str(item[1]) == prompt_id for item in queue.get("queue_running", [])):
        return "running", None
    pending = sorted(queue.get("queue_pending", []), key=lambda item: (item[0], str(item[1])))
    for index, item in enumerate(pending):
        if len(item) > 1 and str(item[1]) == prompt_id:
            return "queued", index + len(queue.get("queue_running", []))
    return "unknown", None


def wait_for_history(backend, prompt_id, *, get_history, timeout=1800,
                     client_id="", classes=None, adapter="", on_progress=None,
                     events=None, queue_timeout=21600):
    classes = classes or {}
    started = time.monotonic()
    active_started = None
    current_node = ""
    last_payload = None
    next_http = 0.0

    def emit(stage, current=None, total=None, position=None):
        nonlocal last_payload
        percent = min(100.0, max(0.0, current / total * 100)) if total and current is not None else None
        event = {"stage": stage, "progress_current": current,
                 "progress_total": total, "progress_percent": percent,
                 "queue_position": position}
        if on_progress and event != last_payload:
            on_progress(event)
        last_payload = event

    try:
        emit("comfy-queued")
        while True:
            now = time.monotonic()
            if (active_started is not None and now - active_started > timeout) or now - started > queue_timeout + timeout:
                raise TimeoutError("comfy.execution_timeout")
            if now >= next_http:
                response = get_history(backend, prompt_id)
                if prompt_id in response:
                    history = response[prompt_id]
                    error = history_error(history)
                    if error:
                        raise RuntimeError(error)
                    # An output-less failed prompt must never be published as success.
                    if not history.get("outputs"):
                        raise RuntimeError("comfy.execution_no_outputs")
                    return history
                try:
                    queue = requests.get(f"http://{backend}/queue", timeout=5).json()
                    state, position = queue_position(queue, prompt_id)
                    if state == "queued":
                        emit("comfy-queued", position=position)
                        if now - started > queue_timeout:
                            raise TimeoutError("comfy.queue_timeout")
                    elif state == "running" and active_started is None:
                        active_started = now
                        emit("comfy-preparing")
                except requests.RequestException:
                    pass
                next_http = now + 2
            if events is None:
                time.sleep(0.5)
                continue
            try:
                raw = events.recv(timeout=0.5)
                if not isinstance(raw, str):
                    continue
                message = json.loads(raw)
            except TimeoutError:
                continue
            except Exception:
                try:
                    events.close()
                except Exception:
                    pass
                events = None
                continue
            data = message.get("data") or {}
            if str(data.get("prompt_id") or "") != prompt_id:
                continue
            event_type = message.get("type")
            if event_type in {"execution_error", "execution_interrupted"}:
                raise RuntimeError(str(data.get("exception_message") or f"comfy.{event_type}"))
            if event_type == "execution_start":
                active_started = active_started or time.monotonic()
                emit("comfy-preparing")
            elif event_type == "executing" and data.get("node") is not None:
                current_node = str(data["node"])
                active_started = active_started or time.monotonic()
                emit(node_stage(current_node, classes, adapter))
            elif event_type == "progress":
                node = str(data.get("node") or current_node)
                value, maximum = data.get("value"), data.get("max")
                if isinstance(value, (int, float)) and isinstance(maximum, (int, float)) and maximum > 0:
                    emit(node_stage(node, classes, adapter), value, maximum)
            elif event_type in {"execution_success", "executed"}:
                next_http = 0
    finally:
        if events is not None:
            try:
                events.close()
            except Exception:
                pass
