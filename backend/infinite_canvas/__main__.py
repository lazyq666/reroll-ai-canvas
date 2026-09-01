"""Run the side-effect-free shell with supervised restart semantics."""

from __future__ import annotations

import asyncio
import os

import uvicorn

from .bootstrap import create_default_application


RESTART_EXIT_CODE = 75


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


async def serve() -> int:
    application, _runtime, restart_signal = create_default_application()
    host = str(
        os.getenv("INFINITE_CANVAS_HOST") or "127.0.0.1"
    ).strip()
    config = uvicorn.Config(
        application,
        host=host,
        port=_server_port(),
        ws_ping_interval=None,
        ws_ping_timeout=None,
        log_level="info",
    )
    server = uvicorn.Server(config)
    server_task = asyncio.create_task(server.serve())
    restart_task = asyncio.create_task(_wait_for_restart(restart_signal))
    done, _pending = await asyncio.wait(
        {server_task, restart_task},
        return_when=asyncio.FIRST_COMPLETED,
    )
    if restart_task in done and restart_signal.is_set():
        server.should_exit = True
    await server_task
    restart_task.cancel()
    await asyncio.gather(restart_task, return_exceptions=True)
    return RESTART_EXIT_CODE if restart_signal.is_set() else 0


def main() -> int:
    try:
        return asyncio.run(serve())
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
