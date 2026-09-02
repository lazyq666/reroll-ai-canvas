"""Run the side-effect-free shell with supervised restart semantics."""

from __future__ import annotations

import asyncio
import os

import uvicorn

from .bootstrap import create_default_application


RESTART_EXIT_CODE = 75
SUPERVISOR_FD_ENV = "INFINITE_CANVAS_SUPERVISOR_FD"
SUPERVISOR_PID_ENV = "INFINITE_CANVAS_SUPERVISOR_PID"


def _server_host() -> str:
    return str(os.getenv("INFINITE_CANVAS_HOST") or "0.0.0.0").strip()


def _server_port() -> int:
    raw_port = str(os.getenv("INFINITE_CANVAS_PORT") or "3000").strip()
    try:
        port = int(raw_port)
    except ValueError as exc:
        raise ValueError(
            "INFINITE_CANVAS_PORT must be between 1 and 65535"
        ) from exc
    if not 1 <= port <= 65535:
        raise ValueError(
            "INFINITE_CANVAS_PORT must be between 1 and 65535"
        )
    return port


async def _wait_for_restart(restart_signal) -> None:
    while not restart_signal.is_set():
        await asyncio.sleep(0.1)


def _supervisor_fd() -> int | None:
    raw_fd = str(os.getenv(SUPERVISOR_FD_ENV) or "").strip()
    if not raw_fd:
        return None
    try:
        fd = int(raw_fd)
    except ValueError:
        return None
    return fd if fd >= 0 else None


async def _wait_for_supervisor(fd: int) -> None:
    loop = asyncio.get_running_loop()
    disconnected = loop.create_future()

    def supervisor_ready() -> None:
        try:
            payload = os.read(fd, 1)
        except OSError:
            payload = b""
        if not payload and not disconnected.done():
            disconnected.set_result(None)

    loop.add_reader(fd, supervisor_ready)
    try:
        await disconnected
    finally:
        loop.remove_reader(fd)
        try:
            os.close(fd)
        except OSError:
            pass


def _supervisor_pid() -> int | None:
    raw_pid = str(os.getenv(SUPERVISOR_PID_ENV) or "").strip()
    if not raw_pid:
        return None
    try:
        pid = int(raw_pid)
    except ValueError:
        return None
    return pid if pid > 0 and pid != os.getpid() else None


def _process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


async def _wait_for_supervisor_process(pid: int) -> None:
    while _process_alive(pid):
        await asyncio.sleep(0.25)


async def serve() -> int:
    application, _runtime, restart_signal = create_default_application()
    config = uvicorn.Config(
        application,
        host=_server_host(),
        port=_server_port(),
        ws_ping_interval=None,
        ws_ping_timeout=None,
        log_level="info",
    )
    server = uvicorn.Server(config)
    server_task = asyncio.create_task(server.serve())
    restart_task = asyncio.create_task(_wait_for_restart(restart_signal))
    supervisor_fd = _supervisor_fd()
    supervisor_pid = _supervisor_pid()
    supervisor_task = (
        asyncio.create_task(_wait_for_supervisor(supervisor_fd))
        if supervisor_fd is not None
        else (
            asyncio.create_task(
                _wait_for_supervisor_process(supervisor_pid)
            )
            if supervisor_pid is not None
            else None
        )
    )
    watched_tasks = {server_task, restart_task}
    if supervisor_task is not None:
        watched_tasks.add(supervisor_task)
    done, _pending = await asyncio.wait(
        watched_tasks,
        return_when=asyncio.FIRST_COMPLETED,
    )
    restart_requested = restart_task in done and restart_signal.is_set()
    supervisor_disconnected = (
        supervisor_task is not None and supervisor_task in done
    )
    if restart_requested or supervisor_disconnected:
        server.should_exit = True
    await server_task
    pending_watchers = [restart_task]
    if supervisor_task is not None:
        pending_watchers.append(supervisor_task)
    for task in pending_watchers:
        if not task.done():
            task.cancel()
    await asyncio.gather(*pending_watchers, return_exceptions=True)
    return RESTART_EXIT_CODE if restart_signal.is_set() else 0


def main() -> int:
    try:
        return asyncio.run(serve())
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
